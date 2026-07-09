import { createHash, randomBytes, randomUUID } from 'crypto';
import WebSocket, { type RawData } from 'ws';
import type { ProcessManager } from '../services/ProcessManager';
import type { Workspace } from '../types/workspace';
import { WindowStatus } from '../../shared/types/window';
import type { RemoteDeviceScope } from '../../shared/remote/methods';
import { PathValidator } from '../utils/pathValidator';
import { resolveShellProgram } from '../utils/shell';
import { createPairingOfferPayload, encodePairingOffer } from '../../shared/remote/pairing';
import {
  buildRelayHostUrl,
  normalizeRelayEndpoint,
} from '../../shared/remote/relay';
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
  onPaneProcessStarted?: (payload: { windowId: string; paneId: string; pid: number }) => void;
  onPaneData?: (payload: { windowId: string; paneId: string; data: string; seq?: number }) => void;
  onPanePtySubscription?: (paneId: string, unsubscribe: () => void) => void;
  onLocalPaneStarted?: (payload: { windowId: string; workingDirectory: string }) => void | Promise<void>;
  transportOptions?: Partial<RemoteWebSocketTransportOptions>;
};

export type RemotePairingOfferResult =
  | { available: false }
  | {
      available: true;
      pairingUrl: string;
      endpoint: string;
      relayEndpoint?: string;
      deviceId: string;
      expiresAt: number | null;
    };

const RELAY_SESSION_TTL_SECONDS = 12 * 60 * 60;
const RELAY_RECONNECT_DELAY_MS = 5_000;

export class RemoteGateway {
  private readonly processManager: ProcessManager;
  private readonly userDataPath: string;
  private readonly hostName: string | undefined;
  private readonly appVersion: string | undefined;
  private readonly wsPort: number;
  private readonly transportOptions: Partial<RemoteWebSocketTransportOptions>;
  private readonly getCurrentWorkspace: (() => Workspace | null) | undefined;
  private readonly onPaneProcessStarted: ((payload: { windowId: string; paneId: string; pid: number }) => void) | undefined;
  private readonly onPaneData: ((payload: { windowId: string; paneId: string; data: string; seq?: number }) => void) | undefined;
  private readonly onPanePtySubscription: ((paneId: string, unsubscribe: () => void) => void) | undefined;
  private readonly onLocalPaneStarted: ((payload: { windowId: string; workingDirectory: string }) => void | Promise<void>) | undefined;
  private readonly settingsStore: RemoteSettingsStore;
  private readonly deviceRegistry: RemoteDeviceRegistry;
  private readonly keypair: RemoteE2EEKeypair;
  private readonly dispatcher: RemoteDispatcher;
  private transport: RemoteWebSocketTransport | null = null;
  private e2eeChannels = new Map<WebSocket, RemoteE2EEChannel>();
  private wsConnectionIds = new Map<WebSocket, string>();
  private relaySockets = new Map<string, WebSocket>();
  private relaySocketDeviceIds = new WeakMap<WebSocket, string>();
  private relayReconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private relayPendingExpiryTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(options: RemoteGatewayOptions) {
    this.processManager = options.processManager;
    this.userDataPath = options.userDataPath;
    this.hostName = options.hostName;
    this.appVersion = options.appVersion;
    this.wsPort = options.wsPort ?? DEFAULT_REMOTE_WS_PORT;
    this.transportOptions = options.transportOptions ?? {};
    this.getCurrentWorkspace = options.getCurrentWorkspace;
    this.onPaneProcessStarted = options.onPaneProcessStarted;
    this.onPaneData = options.onPaneData;
    this.onPanePtySubscription = options.onPanePtySubscription;
    this.onLocalPaneStarted = options.onLocalPaneStarted;
    this.settingsStore = new RemoteSettingsStore(this.userDataPath);
    this.deviceRegistry = new RemoteDeviceRegistry(this.userDataPath);
    this.keypair = loadOrCreateRemoteKeypair(this.userDataPath);
    const stateProvider = options.getCurrentWorkspace
      ? new RemoteStateProvider({
          getCurrentWorkspace: options.getCurrentWorkspace,
          processManager: this.processManager,
          startLocalTerminalPane: (params) => this.startLocalTerminalPane(params),
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
        this.disconnectRelayDevice(device.deviceId);
      },
    });
  }

  async start(): Promise<void> {
    if (this.transport) {
      this.syncRelayHostConnections();
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
      this.handleSocketMessage(ws, msg, (deviceToken) => {
        transport.setClientId(ws, deviceToken);
      });
    });

    transport.onConnectionClose((_clientId, ws) => {
      this.cleanupSocket(ws);
    });

    await transport.start();
    this.syncRelayHostConnections();
  }

  private async startLocalTerminalPane(params: {
    windowId: string;
    paneId: string;
    name: string;
    workingDirectory: string;
    command?: string;
    initialCols?: number;
    initialRows?: number;
  }): Promise<{ pid: number; sessionId: string; status: WindowStatus }> {
    const pathValidation = PathValidator.validate(params.workingDirectory);
    if (!pathValidation.valid) {
      throw new Error(`Invalid working directory: ${pathValidation.reason}`);
    }

    const safePath = PathValidator.getSafePath(params.workingDirectory);
    if (!safePath) {
      throw new Error('Unable to resolve working directory');
    }

    const shellCommand = resolveShellProgram({
      preferredShellProgram: params.command,
      settings: this.getCurrentWorkspace?.()?.settings,
    });

    const handle = await this.processManager.spawnTerminal({
      workingDirectory: safePath,
      command: shellCommand,
      name: params.name,
      windowId: params.windowId,
      paneId: params.paneId,
      initialCols: params.initialCols,
      initialRows: params.initialRows,
    });

    if (!handle.pid || handle.pid <= 0) {
      throw new Error('Terminal process failed to start');
    }

    this.onPaneProcessStarted?.({
      windowId: params.windowId,
      paneId: params.paneId,
      pid: handle.pid,
    });

    const unsubscribe = this.processManager.subscribePtyData(handle.pid, (data: string, seq?: number) => {
      this.onPaneData?.({
        windowId: params.windowId,
        paneId: params.paneId,
        data,
        seq,
      });
    });
    this.onPanePtySubscription?.(params.paneId, unsubscribe);

    await this.onLocalPaneStarted?.({
      windowId: params.windowId,
      workingDirectory: safePath,
    });

    return {
      pid: handle.pid,
      sessionId: handle.sessionId,
      status: WindowStatus.WaitingForInput,
    };
  }

  async startFromSavedSettings(): Promise<void> {
    const settings = this.settingsStore.getSettings();
    if (settings.enabled && settings.startOnLaunch) {
      await this.start();
    }
  }

  async stop(): Promise<void> {
    this.stopRelayHostConnections();
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
    const shouldResetRelay = didRelaySettingsChange(previous, next);

    try {
      if (!next.enabled) {
        await this.stop();
      } else if (shouldRestart) {
        await this.stop();
        await this.start();
      } else {
        if (shouldResetRelay) {
          this.stopRelayHostConnections();
        }
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
    this.disconnectRelayDevice(deviceId);
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
    const relayEndpoint = settings.relayEnabled && settings.relayEndpoint
      ? normalizeRelayEndpoint(settings.relayEndpoint)
      : null;
    const advertisedAddress = args.address ?? settings.manualEndpoint ?? settings.selectedAddress;
    if (!relayEndpoint && !advertisedAddress?.trim()) {
      return { available: false };
    }
    if (advertisedAddress?.trim()) {
      validateEndpointOverride(advertisedAddress, settings.acceptedPlainWsNonLocal);
    }
    const endpoint = resolvePairingEndpoint(rawEndpoint, advertisedAddress);
    const device = args.rotate
      ? this.deviceRegistry.rotatePendingDevice(deviceName, scope)
      : this.deviceRegistry.getOrCreatePendingDevice(deviceName, scope);
    const relay = relayEndpoint
      ? this.createRelaySessionForDevice(device, relayEndpoint)
      : null;
    if (!relay) {
      this.deviceRegistry.setRelaySession(device.deviceId, null);
      this.disconnectRelayDevice(device.deviceId);
    }
    const pairingUrl = encodePairingOffer(createPairingOfferPayload({
      endpoint,
      deviceToken: device.token,
      publicKeyB64: this.keypair.publicKeyB64,
      scope,
      hostName: this.hostName,
      relayEndpoint: relay?.endpoint,
      relaySessionId: relay?.sessionId,
      relayClientToken: relay?.clientToken,
    }));
    return {
      available: true,
      pairingUrl,
      endpoint,
      relayEndpoint: relay?.endpoint,
      deviceId: device.deviceId,
      expiresAt: device.pendingExpiresAt,
    };
  }

  private handleSocketMessage(
    ws: WebSocket,
    msg: string | Uint8Array<ArrayBufferLike>,
    onAuthenticated?: (deviceToken: string) => void,
  ): void {
    let channel = this.e2eeChannels.get(ws);
    if (!channel) {
      const connectionId = randomBytes(8).toString('hex');
      this.wsConnectionIds.set(ws, connectionId);
      channel = this.createChannel(ws, onAuthenticated);
      this.e2eeChannels.set(ws, channel);
    }
    channel.handleRawMessage(msg);
  }

  private cleanupSocket(ws: WebSocket): void {
    this.e2eeChannels.get(ws)?.destroy();
    this.e2eeChannels.delete(ws);
    const connectionId = this.wsConnectionIds.get(ws);
    if (connectionId) {
      this.dispatcher.cleanupConnection(connectionId);
      this.wsConnectionIds.delete(ws);
    }
  }

  private createChannel(
    ws: WebSocket,
    onAuthenticated?: (deviceToken: string) => void,
  ): RemoteE2EEChannel {
    const channel = new RemoteE2EEChannel(ws, {
      serverSecretKey: this.keypair.secretKey,
      validateToken: (token) => this.deviceRegistry.validateToken(token) !== null,
      onReady: (readyChannel) => {
        if (readyChannel.deviceToken) {
          onAuthenticated?.(readyChannel.deviceToken);
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

  private createRelaySessionForDevice(
    device: RemoteDeviceEntry,
    endpoint: string,
  ): { endpoint: string; sessionId: string; clientToken: string } {
    const sessionId = randomUUID();
    const hostToken = createRelayToken();
    const clientToken = createRelayToken();
    const clientTokenHash = hashRelayToken(clientToken);
    const updated = this.deviceRegistry.setRelaySession(device.deviceId, {
      sessionId,
      hostToken,
      clientTokenHash,
    }) ?? device;
    this.restartRelayHostConnection(updated);
    this.schedulePendingRelayExpiry(updated);
    return { endpoint, sessionId, clientToken };
  }

  private syncRelayHostConnections(): void {
    const settings = this.settingsStore.getSettings();
    if (!settings.enabled || !settings.relayEnabled || !settings.relayEndpoint) {
      this.stopRelayHostConnections();
      return;
    }

    const devices = this.deviceRegistry.listDevices({ includePending: true });
    const expectedDeviceIds = new Set<string>();
    for (const device of devices) {
      if (!hasRelaySession(device)) {
        continue;
      }
      expectedDeviceIds.add(device.deviceId);
      this.connectRelayHostForDevice(device);
      this.schedulePendingRelayExpiry(device);
    }

    for (const deviceId of Array.from(this.relaySockets.keys())) {
      if (!expectedDeviceIds.has(deviceId)) {
        this.disconnectRelayDevice(deviceId);
      }
    }
  }

  private restartRelayHostConnection(device: RemoteDeviceEntry): void {
    this.disconnectRelayDevice(device.deviceId);
    this.connectRelayHostForDevice(device);
  }

  private connectRelayHostForDevice(device: RemoteDeviceEntry): void {
    const settings = this.settingsStore.getSettings();
    if (
      !settings.enabled
      || !settings.relayEnabled
      || !settings.relayEndpoint
      || !hasRelaySession(device)
    ) {
      return;
    }
    const existing = this.relaySockets.get(device.deviceId);
    if (
      existing
      && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    const relayEndpoint = normalizeRelayEndpoint(settings.relayEndpoint);
    const relayUrl = buildRelayHostUrl(relayEndpoint, {
      sessionId: device.relaySessionId,
      hostToken: device.relayHostToken,
      clientTokenHash: device.relayClientTokenHash,
      ttlSeconds: RELAY_SESSION_TTL_SECONDS,
    });
    const ws = new WebSocket(relayUrl);
    this.relaySockets.set(device.deviceId, ws);
    this.relaySocketDeviceIds.set(ws, device.deviceId);

    ws.on('message', (data, isBinary) => {
      this.handleSocketMessage(ws, normalizeWebSocketMessage(data, isBinary));
    });
    ws.on('close', () => this.finalizeRelaySocket(ws));
    ws.on('error', () => {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    });
  }

  private finalizeRelaySocket(ws: WebSocket): void {
    this.cleanupSocket(ws);
    const deviceId = this.relaySocketDeviceIds.get(ws);
    if (!deviceId) {
      return;
    }
    if (this.relaySockets.get(deviceId) !== ws) {
      return;
    }
    this.relaySockets.delete(deviceId);
    this.scheduleRelayReconnect(deviceId);
  }

  private scheduleRelayReconnect(deviceId: string): void {
    if (this.relayReconnectTimers.has(deviceId)) {
      return;
    }
    const settings = this.settingsStore.getSettings();
    if (!settings.enabled || !settings.relayEnabled || !settings.relayEndpoint) {
      return;
    }
    const timer = setTimeout(() => {
      this.relayReconnectTimers.delete(deviceId);
      const device = this.deviceRegistry.getDevice(deviceId);
      if (device && hasRelaySession(device)) {
        this.connectRelayHostForDevice(device);
      }
    }, RELAY_RECONNECT_DELAY_MS);
    timer.unref?.();
    this.relayReconnectTimers.set(deviceId, timer);
  }

  private schedulePendingRelayExpiry(device: RemoteDeviceEntry): void {
    const existing = this.relayPendingExpiryTimers.get(device.deviceId);
    if (existing) {
      clearTimeout(existing);
      this.relayPendingExpiryTimers.delete(device.deviceId);
    }
    if (device.lastSeenAt > 0 || device.pendingExpiresAt === null) {
      return;
    }
    const delay = Math.max(0, device.pendingExpiresAt - Date.now() + 100);
    const timer = setTimeout(() => {
      this.relayPendingExpiryTimers.delete(device.deviceId);
      const current = this.deviceRegistry.getDevice(device.deviceId);
      if (!current) {
        this.disconnectRelayDevice(device.deviceId);
      }
    }, delay);
    timer.unref?.();
    this.relayPendingExpiryTimers.set(device.deviceId, timer);
  }

  private disconnectRelayDevice(deviceId: string): void {
    const reconnectTimer = this.relayReconnectTimers.get(deviceId);
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      this.relayReconnectTimers.delete(deviceId);
    }
    const expiryTimer = this.relayPendingExpiryTimers.get(deviceId);
    if (expiryTimer) {
      clearTimeout(expiryTimer);
      this.relayPendingExpiryTimers.delete(deviceId);
    }
    const ws = this.relaySockets.get(deviceId);
    if (!ws) {
      return;
    }
    this.relaySockets.delete(deviceId);
    this.cleanupSocket(ws);
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close();
    }
  }

  private stopRelayHostConnections(): void {
    for (const timer of this.relayReconnectTimers.values()) {
      clearTimeout(timer);
    }
    this.relayReconnectTimers.clear();
    for (const timer of this.relayPendingExpiryTimers.values()) {
      clearTimeout(timer);
    }
    this.relayPendingExpiryTimers.clear();
    for (const deviceId of Array.from(this.relaySockets.keys())) {
      this.disconnectRelayDevice(deviceId);
    }
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

function didRelaySettingsChange(previous: RemoteSettings, next: RemoteSettings): boolean {
  return previous.relayEnabled !== next.relayEnabled
    || previous.relayEndpoint !== next.relayEndpoint;
}

function createRelayToken(): string {
  return randomBytes(32).toString('base64url');
}

function hashRelayToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function hasRelaySession(device: RemoteDeviceEntry): device is RemoteDeviceEntry & {
  relaySessionId: string;
  relayHostToken: string;
  relayClientTokenHash: string;
} {
  return Boolean(device.relaySessionId && device.relayHostToken && device.relayClientTokenHash);
}

function normalizeWebSocketMessage(
  data: RawData,
  isBinary: boolean,
): string | Uint8Array<ArrayBufferLike> {
  if (typeof data === 'string') {
    return data;
  }
  const buffer = Array.isArray(data)
    ? Buffer.concat(data)
    : Buffer.isBuffer(data)
      ? data
      : Buffer.from(data as ArrayBuffer);
  if (isBinary) {
    return new Uint8Array(buffer);
  }
  return buffer.toString();
}
