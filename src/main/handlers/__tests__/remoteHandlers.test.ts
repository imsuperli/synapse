import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildRemoteNetworkInterfaceList, registerRemoteHandlers } from '../remoteHandlers';
import type { HandlerContext } from '../HandlerContext';

const { mockIpcHandle, mockQrToDataUrl } = vi.hoisted(() => ({
  mockIpcHandle: vi.fn(),
  mockQrToDataUrl: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: mockIpcHandle,
  },
}));

vi.mock('qrcode', () => ({
  default: {
    toDataURL: mockQrToDataUrl,
  },
}));

function getHandler(channel: string) {
  const call = mockIpcHandle.mock.calls.find(([name]) => name === channel);
  expect(call, `IPC handler ${channel} should be registered`).toBeTruthy();
  return call?.[1] as (event: unknown, payload?: any) => Promise<unknown>;
}

describe('registerRemoteHandlers', () => {
  beforeEach(() => {
    mockIpcHandle.mockReset();
    mockQrToDataUrl.mockReset();
    mockQrToDataUrl.mockResolvedValue('data:image/png;base64,qr');
  });

  it('lists non-internal IPv4 interfaces with tailnet addresses first', async () => {
    const interfaces = buildRemoteNetworkInterfaceList({
      en0: [
        { family: 'IPv4', internal: false, address: '192.168.1.20' } as any,
        { family: 'IPv6', internal: false, address: 'fe80::1' } as any,
      ],
      lo0: [{ family: 'IPv4', internal: true, address: '127.0.0.1' } as any],
      tailscale0: [{ family: 'IPv4', internal: false, address: '100.64.1.20' } as any],
    });

    expect(interfaces).toEqual([
      { name: 'tailscale0', address: '100.64.1.20' },
      { name: 'en0', address: '192.168.1.20' },
    ]);
  });

  it('updates persistent gateway settings through remote:updateSettings', async () => {
    const gateway = createGateway();
    registerRemoteHandlers({ remoteGateway: gateway } as unknown as HandlerContext);
    const handler = getHandler('remote:updateSettings');

    await expect(handler({}, {
      enabled: true,
      selectedAddress: '100.64.1.20',
      manualEndpoint: null,
    })).resolves.toEqual({
      success: true,
      data: {
        settings: {
          ...defaultSettings,
          enabled: true,
          selectedAddress: '100.64.1.20',
          startOnLaunch: true,
        },
        endpoint: 'ws://0.0.0.0:6868',
      },
    });

    expect(gateway.updateSettings).toHaveBeenCalledWith({
      enabled: true,
      selectedAddress: '100.64.1.20',
      manualEndpoint: null,
    });
  });

  it('returns status with persisted settings', async () => {
    const gateway = createGateway();
    registerRemoteHandlers({ remoteGateway: gateway } as unknown as HandlerContext);
    const handler = getHandler('remote:getStatus');

    await expect(handler({})).resolves.toEqual({
      success: true,
      data: {
        ready: true,
        endpoint: 'ws://0.0.0.0:6868',
        settings: defaultSettings,
      },
    });
  });

  it('generates a QR pairing response from the gateway offer', async () => {
    const gateway = createGateway();
    registerRemoteHandlers({ remoteGateway: gateway } as unknown as HandlerContext);
    const handler = getHandler('remote:getPairingQR');

    const response = await handler({}, { address: '100.64.1.20' });

    expect(gateway.createPairingOffer).toHaveBeenCalledWith({
      address: '100.64.1.20',
      rotate: undefined,
      scope: 'mobile.control',
    });
    expect(mockQrToDataUrl).toHaveBeenCalledWith('synapse://pair?code=abc', {
      errorCorrectionLevel: 'M',
      margin: 4,
      width: 512,
    });
    expect(response).toEqual({
      success: true,
      data: {
        available: true,
        qrDataUrl: 'data:image/png;base64,qr',
        pairingUrl: 'synapse://pair?code=abc',
        endpoint: 'ws://100.64.1.20:6868',
        deviceId: 'device-1',
        expiresAt: 12345,
      },
    });
  });

  it('revokes devices through the gateway', async () => {
    const gateway = createGateway();
    registerRemoteHandlers({ remoteGateway: gateway } as unknown as HandlerContext);
    const handler = getHandler('remote:revokeDevice');

    await expect(handler({}, { deviceId: 'device-1' })).resolves.toEqual({
      success: true,
      data: { revoked: true },
    });
    expect(gateway.revokeDevice).toHaveBeenCalledWith('device-1');
  });
});

function createGateway() {
  return {
    updateSettings: vi.fn((settings) => Promise.resolve({
      settings: {
        ...defaultSettings,
        ...settings,
        startOnLaunch: settings.enabled === true,
      },
      endpoint: 'ws://0.0.0.0:6868',
    })),
    getWebSocketEndpoint: vi.fn(() => 'ws://0.0.0.0:6868'),
    getSettings: vi.fn(() => defaultSettings),
    createPairingOffer: vi.fn(() => ({
      available: true,
      pairingUrl: 'synapse://pair?code=abc',
      endpoint: 'ws://100.64.1.20:6868',
      deviceId: 'device-1',
      expiresAt: 12345,
    })),
    listDevices: vi.fn(() => []),
    revokeDevice: vi.fn(() => true),
  };
}

const defaultSettings = {
  enabled: false,
  bindHost: '0.0.0.0',
  preferredPort: 6868,
  selectedAddress: null,
  manualEndpoint: null,
  acceptedPlainWsNonLocal: false,
  startOnLaunch: false,
};
