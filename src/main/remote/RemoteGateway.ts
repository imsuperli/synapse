import { randomBytes } from 'crypto';
import type { WebSocket } from 'ws';
import type { ProcessManager } from '../services/ProcessManager';
import type { Workspace } from '../types/workspace';
import type { RemoteDeviceScope } from '../../shared/remote/methods';
import { createPairingOfferPayload, encodePairingOffer } from '../../shared/remote/pairing';
import { RemoteDeviceRegistry, type RemoteDeviceEntry } from './RemoteDeviceRegistry';
import { loadOrCreateRemoteKeypair, type RemoteE2EEKeypair } from './RemoteKeypairStore';
import {
  DEFAULT_REMOTE_WS_PORT,
  RemoteWebSocketTransport,
  type RemoteWebSocketTransportOptions,
} from './RemoteWebSocketTransport';
import { RemoteE2EEChannel } from './RemoteE2EEChannel';
import { RemoteDispatcher } from './RemoteDispatcher';
import { RemoteStateProvider } from './RemoteStateProvider';
import {
  RemoteSettingsStore,
  type RemoteSettings,
  type RemoteSettingsPatch,
  validateEndpointOverride,
} from './RemoteSettingsStore';

type RemoteGatewayOptions = {
  processManager: ProcessManager;
  userDataPath: string;
  hostName?: string;
  appVersion?: string;
  wsPort?: number;
  getCurrentWorkspace?: () => Workspace | null;
  transportOptions?: Partial<RemoteWebSocketTransportOptions>;
};

export type RemotePairingOfferResult =
  | { available: false }
  | {
      available: true;
      pairingUrl: string;
      endpoint: string;
      deviceId: string;
      expiresAt: number | null;
    };

export class RemoteGateway {
  private readonly processManager: ProcessManager;
  private readonly userDataPath: string;
  private readonly hostName: string | undefined;
  private readonly appVersion: string | undefined;
  private readonly wsPort: number;
  private readonly transportOptions: Partial<RemoteWebSocketTransportOptions>;
  private readonly settingsStore: RemoteSettingsStore;
  private readonly deviceRegistry: RemoteDeviceRegistry;
  private readonly keypair: RemoteE2EEKeypair;
  private readonly dispatcher: RemoteDispatcher;
  private transport: RemoteWebSocketTransport | null = null;
  private e2eeChannels = new Map<WebSocket, RemoteE2EEChannel>();
  private wsConnectionIds = new Map<WebSocket, string>();

  constructor(options: RemoteGatewayOptions) {
    this.processManager = options.processManager;
    this.userDataPath = options.userDataPath;
    this.hostName = options.hostName;
    this.appVersion = options.appVersion;
    this.wsPort = options.wsPort ?? DEFAULT_REMOTE_WS_PORT;
    this.transportOptions = options.transportOptions ?? {};
    this.settingsStore = new RemoteSettingsStore(this.userDataPath);
    this.deviceRegistry = new RemoteDeviceRegistry(this.userDataPath);
    this.keypair = loadOrCreateRemoteKeypair(this.userDataPath);
    const stateProvider = options.getCurrentWorkspace
      ? new RemoteStateProvider({
          getCurrentWorkspace: options.getCurrentWorkspace,
          processManager: this.processManager,
        })
      : undefined;
    this.dispatcher = new RemoteDispatcher({
      processManager: this.processManager,
      deviceRegistry: this.deviceRegistry,
      appVersion: this.appVersion,
      hostName: this.hostName,
      stateProvider,
      onDeviceRevoked: (device) => {
        this.transport?.terminateClientConnections(device.token);
      },
    });
  }

  async start(): Promise<void> {
    if (this.transport) {
      return;
    }
    const settings = this.settingsStore.getSettings();
    const transport = new RemoteWebSocketTransport({
      host: this.transportOptions.host ?? settings.bindHost,
      port: this.transportOptions.port ?? settings.preferredPort ?? this.wsPort,
      tlsCert: this.transportOptions.tlsCert,
      tlsKey: this.transportOptions.tlsKey,
      heartbeatIntervalMs: this.transportOptions.heartbeatIntervalMs,
      preAuthTimeoutMs: this.transportOptions.preAuthTimeoutMs,
    });
    this.transport = transport;

    transport.onMessage((msg, _reply, ws) => {
      let channel = this.e2eeChannels.get(ws);
      if (!channel) {
        const connectionId = randomBytes(8).toString('hex');
        this.wsConnectionIds.set(ws, connectionId);
        channel = this.createChannel(ws, transport);
        this.e2eeChannels.set(ws, channel);
      }
      channel.handleRawMessage(msg);
    });

    transport.onConnectionClose((_clientId, ws) => {
      this.e2eeChannels.get(ws)?.destroy();
      this.e2eeChannels.delete(ws);
      const connectionId = this.wsConnectionIds.get(ws);
      if (connectionId) {
        this.dispatcher.cleanupConnection(connectionId);
        this.wsConnectionIds.delete(ws);
      }
    });

    await transport.start();
  }

  async startFromSavedSettings(): Promise<void> {
    const settings = this.settingsStore.getSettings();
    if (settings.enabled && settings.startOnLaunch) {
      await this.start();
    }
  }

  async stop(): Promise<void> {
    for (const channel of this.e2eeChannels.values()) {
      channel.destroy();
    }
    this.e2eeChannels.clear();
    for (const connectionId of this.wsConnectionIds.values()) {
      this.dispatcher.cleanupConnection(connectionId);
    }
    this.wsConnectionIds.clear();
    const transport = this.transport;
    this.transport = null;
    if (transport) {
      await transport.stop();
    }
  }

  getDeviceRegistry(): RemoteDeviceRegistry {
    return this.deviceRegistry;
  }

  getWebSocketEndpoint(): string | null {
    return this.transport?.endpoint ?? null;
  }

  getSettings(): RemoteSettings {
    return this.settingsStore.getSettings();
  }

  async updateSettings(patch: RemoteSettingsPatch): Promise<{
    settings: RemoteSettings;
    endpoint: string | null;
  }> {
    const previous = this.settingsStore.getSettings();
    const normalizedPatch = normalizeGatewaySettingsPatch(patch);
    const next = this.settingsStore.update(normalizedPatch);
    const shouldRestart = this.transport !== null && didTransportSettingsChange(previous, next);

    try {
      if (!next.enabled) {
        await this.stop();
      } else if (shouldRestart) {
        await this.stop();
        await this.start();
      } else {
        await this.start();
      }
    } catch (error) {
      this.settingsStore.replace(previous);
      if (previous.enabled && previous.startOnLaunch) {
        await this.stop().catch(() => undefined);
        await this.start().catch(() => undefined);
      }
      throw error;
    }

    return {
      settings: this.settingsStore.getSettings(),
      endpoint: this.getWebSocketEndpoint(),
    };
  }

  listDevices(): readonly RemoteDeviceEntry[] {
    return this.deviceRegistry.listDevices();
  }

  revokeDevice(deviceId: string): boolean {
    const removed = this.deviceRegistry.removeDevice(deviceId);
    if (!removed) {
      return false;
    }
    this.transport?.terminateClientConnections(removed.token);
    return true;
  }

  createPairingOffer(args: {
    address?: string | null;
    name?: string;
    rotate?: boolean;
    scope?: RemoteDeviceScope;
  }): RemotePairingOfferResult {
    const rawEndpoint = this.getWebSocketEndpoint();
    if (!rawEndpoint) {
      return { available: false };
    }
    const settings = this.settingsStore.getSettings();
    const scope = args.scope ?? 'mobile.control';
    const deviceName = args.name ?? `Mobile ${new Date().toLocaleDateString()}`;
    const advertisedAddress = args.address ?? settings.manualEndpoint ?? settings.selectedAddress;
    if (!advertisedAddress?.trim()) {
      return { available: false };
    }
    validateEndpointOverride(advertisedAddress, settings.acceptedPlainWsNonLocal);
    const endpoint = resolvePairingEndpoint(rawEndpoint, advertisedAddress);
    const device = args.rotate
      ? this.deviceRegistry.rotatePendingDevice(deviceName, scope)
      : this.deviceRegistry.getOrCreatePendingDevice(deviceName, scope);
    const pairingUrl = encodePairingOffer(createPairingOfferPayload({
      endpoint,
      deviceToken: device.token,
      publicKeyB64: this.keypair.publicKeyB64,
      scope,
      hostName: this.hostName,
    }));
    return {
      available: true,
      pairingUrl,
      endpoint,
      deviceId: device.deviceId,
      expiresAt: device.pendingExpiresAt,
    };
  }

  private createChannel(ws: WebSocket, transport: RemoteWebSocketTransport): RemoteE2EEChannel {
    const channel = new RemoteE2EEChannel(ws, {
      serverSecretKey: this.keypair.secretKey,
      validateToken: (token) => this.deviceRegistry.validateToken(token) !== null,
      onReady: (readyChannel) => {
        if (readyChannel.deviceToken) {
          transport.setClientId(ws, readyChannel.deviceToken);
        }
      },
      onError: (code, reason) => {
        this.e2eeChannels.get(ws)?.destroy();
        this.e2eeChannels.delete(ws);
        ws.close(code, reason);
      },
    });

    const sendEncryptedJson = (encryptedReply: (response: string) => boolean, payload: unknown) => {
      const sent = encryptedReply(JSON.stringify(payload));
      if (!sent && ws.readyState === ws.OPEN) {
        ws.close(1013, 'Backpressure limit exceeded');
      }
    };

    channel.onMessage((plaintext, encryptedReply) => {
      const authenticatedDeviceToken = this.e2eeChannels.get(ws)?.deviceToken ?? null;
      const device = authenticatedDeviceToken
        ? this.deviceRegistry.validateToken(authenticatedDeviceToken)
        : null;
      const connectionId = this.wsConnectionIds.get(ws);
      if (!device || !connectionId) {
        sendEncryptedJson(encryptedReply, {
          id: 'unknown',
          ok: false,
          error: { code: 'unauthorized', message: 'Unauthorized' },
        });
        return;
      }
      void this.dispatcher.dispatchRaw(
        plaintext,
        { device, connectionId },
        (event) => sendEncryptedJson(encryptedReply, event),
      ).then((response) => {
        sendEncryptedJson(encryptedReply, response);
      }).catch((error) => {
        sendEncryptedJson(encryptedReply, {
          id: 'unknown',
          ok: false,
          error: {
            code: 'internal_error',
            message: error instanceof Error ? error.message : String(error),
          },
        });
      });
    });

    return channel;
  }
}

export function resolvePairingEndpoint(rawEndpoint: string, address: string | null | undefined): string {
  const endpoint = new URL(rawEndpoint);
  const override = address?.trim();
  if (!override) {
    endpoint.hostname = '127.0.0.1';
    return formatWebSocketUrl(endpoint);
  }
  if (/^wss?:\/\//i.test(override)) {
    return formatWebSocketUrl(new URL(override));
  }
  const parsed = parsePairingAddressOverride(override);
  endpoint.hostname = parsed.host.includes(':')
    ? `[${parsed.host.replace(/^\[|\]$/g, '')}]`
    : parsed.host;
  if (parsed.port) {
    endpoint.port = parsed.port;
  }
  return formatWebSocketUrl(endpoint);
}

function parsePairingAddressOverride(address: string): { host: string; port: string | null } {
  if (address.startsWith('[') || address.split(':').length === 2) {
    try {
      const parsed = new URL(`ws://${address}`);
      return { host: parsed.hostname.replace(/^\[|\]$/g, ''), port: parsed.port || null };
    } catch {
      return { host: address, port: null };
    }
  }
  return { host: address, port: null };
}

function formatWebSocketUrl(url: URL): string {
  const formatted = url.toString();
  return url.pathname === '/' && !url.search && !url.hash ? formatted.replace(/\/$/, '') : formatted;
}

function normalizeGatewaySettingsPatch(patch: RemoteSettingsPatch): RemoteSettingsPatch {
  const next = { ...patch };
  if (next.enabled === true && next.startOnLaunch === undefined) {
    next.startOnLaunch = true;
  }
  if (next.enabled === false && next.startOnLaunch === undefined) {
    next.startOnLaunch = false;
  }
  if (next.acceptPlainWsNonLocal === true) {
    next.acceptedPlainWsNonLocal = true;
  }
  return next;
}

function didTransportSettingsChange(previous: RemoteSettings, next: RemoteSettings): boolean {
  return previous.bindHost !== next.bindHost
    || previous.preferredPort !== next.preferredPort;
}
