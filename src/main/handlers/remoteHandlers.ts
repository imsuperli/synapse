import { ipcMain } from 'electron';
import { networkInterfaces, type NetworkInterfaceInfo } from 'os';
import QRCode from 'qrcode';
import type { RemoteSettingsPatch } from '../remote/RemoteSettingsStore';
import { HandlerContext } from './HandlerContext';
import { successResponse, errorResponse } from './HandlerResponse';

const REMOTE_PAIRING_QR_WIDTH = 512;
const REMOTE_PAIRING_QR_MARGIN = 4;

export type RemoteNetworkInterface = {
  name: string;
  address: string;
};

export function registerRemoteHandlers(ctx: HandlerContext) {
  const { remoteGateway } = ctx;

  ipcMain.handle('remote:listNetworkInterfaces', async () => {
    try {
      return successResponse({ interfaces: getNetworkInterfaces() });
    } catch (error) {
      return errorResponse(error);
    }
  });

  ipcMain.handle('remote:updateSettings', async (_event, args: RemoteSettingsPatch = {}) => {
    try {
      if (!remoteGateway) {
        throw new Error('RemoteGateway not initialized');
      }
      return successResponse(await remoteGateway.updateSettings(args));
    } catch (error) {
      return errorResponse(error);
    }
  });

  ipcMain.handle('remote:getStatus', async () => {
    try {
      if (!remoteGateway) {
        throw new Error('RemoteGateway not initialized');
      }
      return successResponse({
        ready: remoteGateway.getWebSocketEndpoint() !== null,
        endpoint: remoteGateway.getWebSocketEndpoint(),
        settings: remoteGateway.getSettings(),
      });
    } catch (error) {
      return errorResponse(error);
    }
  });

  ipcMain.handle(
    'remote:getPairingQR',
    async (_event, args?: { address?: string; rotate?: boolean }) => {
      try {
        if (!remoteGateway) {
          throw new Error('RemoteGateway not initialized');
        }
        const offer = remoteGateway.createPairingOffer({
          address: args?.address,
          rotate: args?.rotate,
          scope: 'mobile.window-control',
        });
        if (!offer.available) {
          return successResponse({ available: false as const });
        }
        const qrDataUrl = await QRCode.toDataURL(offer.pairingUrl, {
          errorCorrectionLevel: 'M',
          margin: REMOTE_PAIRING_QR_MARGIN,
          width: REMOTE_PAIRING_QR_WIDTH,
        });
        return successResponse({
          available: true as const,
          qrDataUrl,
          pairingUrl: offer.pairingUrl,
          endpoint: offer.endpoint,
          ...(offer.relayEndpoint ? { relayEndpoint: offer.relayEndpoint } : {}),
          deviceId: offer.deviceId,
          expiresAt: offer.expiresAt,
        });
      } catch (error) {
        return errorResponse(error);
      }
    },
  );

  ipcMain.handle('remote:rotatePairingQR', async (_event, args?: { address?: string }) => {
    try {
      if (!remoteGateway) {
        throw new Error('RemoteGateway not initialized');
      }
      const offer = remoteGateway.createPairingOffer({
        address: args?.address,
        rotate: true,
        scope: 'mobile.window-control',
      });
      if (!offer.available) {
        return successResponse({ available: false as const });
      }
      const qrDataUrl = await QRCode.toDataURL(offer.pairingUrl, {
        errorCorrectionLevel: 'M',
        margin: REMOTE_PAIRING_QR_MARGIN,
        width: REMOTE_PAIRING_QR_WIDTH,
      });
      return successResponse({
        available: true as const,
        qrDataUrl,
          pairingUrl: offer.pairingUrl,
          endpoint: offer.endpoint,
          ...(offer.relayEndpoint ? { relayEndpoint: offer.relayEndpoint } : {}),
          deviceId: offer.deviceId,
          expiresAt: offer.expiresAt,
        });
    } catch (error) {
      return errorResponse(error);
    }
  });

  ipcMain.handle('remote:listDevices', async () => {
    try {
      if (!remoteGateway) {
        throw new Error('RemoteGateway not initialized');
      }
      return successResponse({
        devices: remoteGateway.listDevices().map((device) => ({
          deviceId: device.deviceId,
          name: device.name,
          scope: device.scope,
          pairedAt: device.pairedAt,
          lastSeenAt: device.lastSeenAt,
        })),
      });
    } catch (error) {
      return errorResponse(error);
    }
  });

  ipcMain.handle('remote:revokeDevice', async (_event, args: { deviceId: string }) => {
    try {
      if (!remoteGateway) {
        throw new Error('RemoteGateway not initialized');
      }
      return successResponse({ revoked: remoteGateway.revokeDevice(args.deviceId) });
    } catch (error) {
      return errorResponse(error);
    }
  });
}

function getNetworkInterfaces(): RemoteNetworkInterface[] {
  return buildRemoteNetworkInterfaceList(networkInterfaces());
}

export function buildRemoteNetworkInterfaceList(
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>,
): RemoteNetworkInterface[] {
  const result: RemoteNetworkInterface[] = [];
  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs) {
      continue;
    }
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        result.push({ name, address: addr.address });
      }
    }
  }
  return result.sort((a, b) => Number(isTailnetIPv4(b.address)) - Number(isTailnetIPv4(a.address)));
}

function isTailnetIPv4(address: string): boolean {
  const parts = address.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  return parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127;
}
