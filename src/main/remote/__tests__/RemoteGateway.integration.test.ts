import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import WebSocket, { type RawData } from 'ws';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { REMOTE_METHODS } from '../../../shared/remote/methods';
import { ProcessStatus } from '../../types/process';
import { parsePairingCode } from '../../../shared/remote/pairing';
import {
  decrypt,
  deriveSharedKey,
  encrypt,
  generateKeyPair,
  publicKeyFromBase64,
} from '../../../shared/remote/e2ee-crypto';
import { RemoteGateway, selectPreferredPairingAddress } from '../RemoteGateway';
import { SynapseRelayServer } from '../../../relay/SynapseRelayServer';
import { buildRelayClientUrl } from '../../../shared/remote/relay';

describe('RemoteGateway integration', () => {
  let tempDir: string | null = null;
  let gateway: RemoteGateway | null = null;
  let relay: SynapseRelayServer | null = null;
  let socket: WebSocket | null = null;

  afterEach(async () => {
    socket?.close();
    socket = null;
    await gateway?.stop();
    gateway = null;
    await relay?.stop();
    relay = null;
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it('uses a real network address for relay pairing offers when none is selected', () => {
    expect(selectPreferredPairingAddress({
      ethernet: [{ family: 'IPv4', internal: false, address: '192.168.1.20' } as any],
      tailscale: [{ family: 'IPv4', internal: false, address: '100.64.1.20' } as any],
      loopback: [{ family: 'IPv4', internal: true, address: '127.0.0.1' } as any],
    })).toBe('100.64.1.20');
    expect(selectPreferredPairingAddress({
      loopback: [{ family: 'IPv4', internal: true, address: '127.0.0.1' } as any],
    })).toBeNull();
  });

  it('authenticates an encrypted WebSocket client and dispatches status.get', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'synapse-remote-gateway-'));
    gateway = new RemoteGateway({
      processManager: createProcessManager() as any,
      userDataPath: tempDir,
      hostName: 'Synapse Test',
      appVersion: '9.9.9',
      transportOptions: {
        host: '127.0.0.1',
        port: 0,
        heartbeatIntervalMs: 1_000,
        preAuthTimeoutMs: 5_000,
      },
    });
    await gateway.start();

    const pairing = gateway.createPairingOffer({ address: '127.0.0.1' });
    expect(pairing.available).toBe(true);
    if (!pairing.available) {
      throw new Error('pairing unavailable');
    }
    const offer = parsePairingCode(pairing.pairingUrl);
    expect(offer).not.toBeNull();

    socket = await openWebSocket(offer!.endpoint);
    const mobileKeypair = generateKeyPair();
    const sharedKey = deriveSharedKey(
      mobileKeypair.secretKey,
      publicKeyFromBase64(offer!.publicKeyB64),
    );

    socket.send(JSON.stringify({
      type: 'e2ee_hello',
      publicKeyB64: Buffer.from(mobileKeypair.publicKey).toString('base64'),
    }));
    expect(rawToString(await waitForMessage(socket))).toBe(JSON.stringify({ type: 'e2ee_ready' }));

    socket.send(encrypt(JSON.stringify({
      type: 'e2ee_auth',
      deviceToken: offer!.deviceToken,
    }), sharedKey));

    const authMessage = decrypt(rawToString(await waitForMessage(socket)), sharedKey);
    expect(authMessage).toBe(JSON.stringify({ type: 'e2ee_authenticated' }));
    expect(gateway.listDevices()).toHaveLength(0);

    socket.send(encrypt(JSON.stringify({
      id: 'req-1',
      method: REMOTE_METHODS.STATUS_GET,
    }), sharedKey));

    const statusMessage = decrypt(rawToString(await waitForMessage(socket)), sharedKey);
    expect(JSON.parse(statusMessage ?? '')).toMatchObject({
      id: 'req-1',
      ok: true,
      result: {
        ok: true,
        protocolVersion: 1,
        deviceScope: 'mobile.control',
      },
    });
    expect(gateway.listDevices()).toHaveLength(1);
  });

  it('does not create pending pairing devices when endpoint validation fails', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'synapse-remote-gateway-'));
    gateway = new RemoteGateway({
      processManager: createProcessManager() as any,
      userDataPath: tempDir,
      hostName: 'Synapse Test',
      appVersion: '9.9.9',
      transportOptions: {
        host: '127.0.0.1',
        port: 0,
      },
    });
    await gateway.start();

    expect(() => gateway!.createPairingOffer({ address: 'https://public.example.com' })).toThrow(
      /ws:\/\/ or wss:\/\//,
    );

    expect(gateway.getDeviceRegistry().listDevices({ includePending: true })).toHaveLength(0);
  });

  it('does not create a pairing offer without an advertised address', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'synapse-remote-gateway-'));
    gateway = new RemoteGateway({
      processManager: createProcessManager() as any,
      userDataPath: tempDir,
      hostName: 'Synapse Test',
      appVersion: '9.9.9',
      transportOptions: {
        host: '127.0.0.1',
        port: 0,
      },
    });
    await gateway.start();

    expect(gateway.createPairingOffer({})).toEqual({ available: false });
    expect(gateway.getDeviceRegistry().listDevices({ includePending: true })).toHaveLength(0);
  });

  it('accepts an encrypted mobile client through the configured relay endpoint', async () => {
    relay = new SynapseRelayServer({
      host: '127.0.0.1',
      port: 0,
      heartbeatIntervalMs: 1_000,
      cleanupIntervalMs: 1_000,
    });
    await relay.start();

    tempDir = mkdtempSync(join(tmpdir(), 'synapse-remote-gateway-'));
    gateway = new RemoteGateway({
      processManager: createProcessManager() as any,
      userDataPath: tempDir,
      hostName: 'Synapse Test',
      appVersion: '9.9.9',
      transportOptions: {
        host: '127.0.0.1',
        port: 0,
      },
    });
    await gateway.updateSettings({
      enabled: true,
      relayEnabled: true,
      relayEndpoint: `${relay.endpoint}${relay.relayPath}`,
    });

    const pairing = gateway.createPairingOffer({});
    expect(pairing.available).toBe(true);
    if (!pairing.available) {
      throw new Error('pairing unavailable');
    }
    const offer = parsePairingCode(pairing.pairingUrl);
    expect(offer?.relayEndpoint).toBe(`${relay.endpoint}${relay.relayPath}`);
    expect(offer?.relaySessionId).toBeTruthy();
    expect(offer?.relayClientToken).toBeTruthy();

    await waitFor(() => relay!.getStats().sessions === 1);
    socket = await openWebSocket(buildRelayClientUrl(offer!.relayEndpoint!, {
      sessionId: offer!.relaySessionId!,
      clientToken: offer!.relayClientToken!,
    }));
    const mobileKeypair = generateKeyPair();
    const sharedKey = deriveSharedKey(
      mobileKeypair.secretKey,
      publicKeyFromBase64(offer!.publicKeyB64),
    );

    socket.send(JSON.stringify({
      type: 'e2ee_hello',
      publicKeyB64: Buffer.from(mobileKeypair.publicKey).toString('base64'),
    }));
    expect(rawToString(await waitForMessage(socket))).toBe(JSON.stringify({ type: 'e2ee_ready' }));

    socket.send(encrypt(JSON.stringify({
      type: 'e2ee_auth',
      deviceToken: offer!.deviceToken,
    }), sharedKey));

    const authMessage = decrypt(rawToString(await waitForMessage(socket)), sharedKey);
    expect(authMessage).toBe(JSON.stringify({ type: 'e2ee_authenticated' }));

    socket.send(encrypt(JSON.stringify({
      id: 'req-relay-1',
      method: REMOTE_METHODS.STATUS_GET,
    }), sharedKey));

    const statusMessage = decrypt(rawToString(await waitForMessage(socket)), sharedKey);
    expect(JSON.parse(statusMessage ?? '')).toMatchObject({
      id: 'req-relay-1',
      ok: true,
      result: {
        ok: true,
        protocolVersion: 1,
      },
    });
  });

  it('restores the saved relay session after the desktop gateway restarts', async () => {
    relay = new SynapseRelayServer({
      host: '127.0.0.1',
      port: 0,
      heartbeatIntervalMs: 1_000,
      cleanupIntervalMs: 1_000,
    });
    await relay.start();

    tempDir = mkdtempSync(join(tmpdir(), 'synapse-remote-gateway-'));
    gateway = new RemoteGateway({
      processManager: createProcessManager() as any,
      userDataPath: tempDir,
      hostName: 'Synapse Test',
      appVersion: '9.9.9',
      transportOptions: {
        host: '127.0.0.1',
        port: 0,
      },
    });
    await gateway.updateSettings({
      enabled: true,
      relayEnabled: true,
      relayEndpoint: `${relay.endpoint}${relay.relayPath}`,
    });

    const pairing = gateway.createPairingOffer({});
    expect(pairing.available).toBe(true);
    if (!pairing.available) {
      throw new Error('pairing unavailable');
    }
    const offer = parsePairingCode(pairing.pairingUrl);
    expect(offer).not.toBeNull();

    await waitFor(() => relay!.getStats().sessions === 1);
    socket = await openWebSocket(buildRelayClientUrl(offer!.relayEndpoint!, {
      sessionId: offer!.relaySessionId!,
      clientToken: offer!.relayClientToken!,
    }));
    await authenticateEncryptedClient(socket, offer!);
    socket.close();
    socket = null;

    await gateway.stop();
    gateway = new RemoteGateway({
      processManager: createProcessManager() as any,
      userDataPath: tempDir,
      hostName: 'Synapse Test',
      appVersion: '9.9.9',
      transportOptions: {
        host: '127.0.0.1',
        port: 0,
      },
    });
    await gateway.startFromSavedSettings();

    await waitFor(() => relay!.getStats().sessions === 1);
    socket = await openWebSocket(buildRelayClientUrl(offer!.relayEndpoint!, {
      sessionId: offer!.relaySessionId!,
      clientToken: offer!.relayClientToken!,
    }));
    const sharedKey = await authenticateEncryptedClient(socket, offer!);
    socket.send(encrypt(JSON.stringify({
      id: 'req-after-restart',
      method: REMOTE_METHODS.STATUS_GET,
    }), sharedKey));

    const statusMessage = decrypt(rawToString(await waitForMessage(socket)), sharedKey);
    expect(JSON.parse(statusMessage ?? '')).toMatchObject({
      id: 'req-after-restart',
      ok: true,
      result: {
        ok: true,
        protocolVersion: 1,
      },
    });
  });

  it('accepts direct LAN and relay clients for the same desktop at the same time', async () => {
    relay = new SynapseRelayServer({
      host: '127.0.0.1',
      port: 0,
      heartbeatIntervalMs: 1_000,
      cleanupIntervalMs: 1_000,
    });
    await relay.start();

    tempDir = mkdtempSync(join(tmpdir(), 'synapse-remote-gateway-'));
    gateway = new RemoteGateway({
      processManager: createProcessManager() as any,
      userDataPath: tempDir,
      hostName: 'Synapse Test',
      appVersion: '9.9.9',
      transportOptions: {
        host: '127.0.0.1',
        port: 0,
      },
    });
    await gateway.updateSettings({
      enabled: true,
      relayEnabled: true,
      relayEndpoint: `${relay.endpoint}${relay.relayPath}`,
    });

    const pairing = gateway.createPairingOffer({ address: '127.0.0.1' });
    expect(pairing.available).toBe(true);
    if (!pairing.available) {
      throw new Error('pairing unavailable');
    }
    const offer = parsePairingCode(pairing.pairingUrl);
    expect(offer?.relayEndpoint).toBe(`${relay.endpoint}${relay.relayPath}`);
    expect(offer?.relaySessionId).toBeTruthy();
    expect(offer?.relayClientToken).toBeTruthy();

    await waitFor(() => relay!.getStats().sessions === 1);
    const directSocket = await openWebSocket(offer!.endpoint);
    const relaySocket = await openWebSocket(buildRelayClientUrl(offer!.relayEndpoint!, {
      sessionId: offer!.relaySessionId!,
      clientToken: offer!.relayClientToken!,
    }));

    try {
      const directSharedKey = await authenticateEncryptedClient(directSocket, offer!);
      const relaySharedKey = await authenticateEncryptedClient(relaySocket, offer!);

      directSocket.send(encrypt(JSON.stringify({
        id: 'req-direct',
        method: REMOTE_METHODS.STATUS_GET,
      }), directSharedKey));
      relaySocket.send(encrypt(JSON.stringify({
        id: 'req-relay',
        method: REMOTE_METHODS.STATUS_GET,
      }), relaySharedKey));

      const directStatus = decrypt(rawToString(await waitForMessage(directSocket)), directSharedKey);
      const relayStatus = decrypt(rawToString(await waitForMessage(relaySocket)), relaySharedKey);
      expect(JSON.parse(directStatus ?? '')).toMatchObject({
        id: 'req-direct',
        ok: true,
        result: { ok: true, protocolVersion: 1 },
      });
      expect(JSON.parse(relayStatus ?? '')).toMatchObject({
        id: 'req-relay',
        ok: true,
        result: { ok: true, protocolVersion: 1 },
      });
      expect(relay!.getStats()).toMatchObject({
        sessions: 1,
        connections: 2,
        pairedSessions: 1,
      });
    } finally {
      directSocket.close();
      relaySocket.close();
    }
  });

  it('does not clear pane state when the requested window and pane have no live process', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'synapse-remote-gateway-'));
    const processManager = {
      ...createProcessManager(),
      getPidByPane: vi.fn(() => null),
      getProcessStatus: vi.fn(),
      killProcess: vi.fn(),
    };
    const onPanePtyUnsubscribe = vi.fn();
    const onPaneProcessStopped = vi.fn();
    gateway = new RemoteGateway({
      processManager: processManager as any,
      userDataPath: tempDir,
      onPanePtyUnsubscribe,
      onPaneProcessStopped,
    });

    await (gateway as unknown as StopWindowPanesHarness).stopWindowPanes({
      windowId: 'win-requested',
      paneIds: ['pane-shared'],
    });

    expect(processManager.getPidByPane).toHaveBeenCalledWith('win-requested', 'pane-shared');
    expect(processManager.getProcessStatus).not.toHaveBeenCalled();
    expect(processManager.killProcess).not.toHaveBeenCalled();
    expect(onPanePtyUnsubscribe).not.toHaveBeenCalled();
    expect(onPaneProcessStopped).not.toHaveBeenCalled();
  });

  it('stops and clears only panes that resolve by the requested window and pane ids', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'synapse-remote-gateway-'));
    const processManager = {
      ...createProcessManager(),
      getPidByPane: vi.fn((windowId: string, paneId?: string) =>
        windowId === 'win-1' && paneId === 'pane-1' ? 1001 : null,
      ),
      getProcessStatus: vi.fn(() => ({ status: ProcessStatus.Alive })),
      killProcess: vi.fn(async () => undefined),
    };
    const onPanePtyUnsubscribe = vi.fn();
    const onPaneProcessStopped = vi.fn();
    gateway = new RemoteGateway({
      processManager: processManager as any,
      userDataPath: tempDir,
      onPanePtyUnsubscribe,
      onPaneProcessStopped,
    });

    await (gateway as unknown as StopWindowPanesHarness).stopWindowPanes({
      windowId: 'win-1',
      paneIds: ['pane-1', 'pane-1', 'pane-other'],
    });

    expect(processManager.getPidByPane).toHaveBeenCalledWith('win-1', 'pane-1');
    expect(processManager.getPidByPane).toHaveBeenCalledWith('win-1', 'pane-other');
    expect(processManager.killProcess).toHaveBeenCalledTimes(1);
    expect(processManager.killProcess).toHaveBeenCalledWith(1001);
    expect(onPanePtyUnsubscribe).toHaveBeenCalledTimes(1);
    expect(onPanePtyUnsubscribe).toHaveBeenCalledWith('pane-1');
    expect(onPaneProcessStopped).toHaveBeenCalledTimes(1);
    expect(onPaneProcessStopped).toHaveBeenCalledWith({ windowId: 'win-1', paneId: 'pane-1' });
  });
});

type StopWindowPanesHarness = {
  stopWindowPanes(params: { windowId: string; paneIds: string[] }): Promise<void>;
};

function createProcessManager() {
  return {
    listProcesses: vi.fn(() => []),
    getPidByPane: vi.fn(() => null),
    getPtyHistory: vi.fn(),
    getPaneTerminalDimensions: vi.fn(() => ({})),
    getTerminalScreenSnapshot: vi.fn(() => undefined),
    getLatestPaneOutputSeq: vi.fn(() => 0),
    getPtyHistoryEntriesSince: vi.fn(() => ({
      entries: [],
      firstSeq: 0,
      lastSeq: 0,
      evictedBeforeSeq: 0,
      gap: false,
      hasMoreBefore: false,
    })),
    getPtyHistoryEntriesBefore: vi.fn(() => ({
      entries: [],
      firstSeq: 0,
      lastSeq: 0,
      evictedBeforeSeq: 0,
      gap: false,
      hasMoreBefore: false,
    })),
    subscribePtyData: vi.fn(),
    writeToPty: vi.fn(),
    resizePty: vi.fn(),
  };
}

function openWebSocket(endpoint: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(endpoint);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function waitForMessage(ws: WebSocket): Promise<RawData> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for WebSocket message'));
    }, 5_000);

    const onMessage = (data: RawData) => {
      cleanup();
      resolve(data);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      clearTimeout(timeout);
      ws.off('message', onMessage);
      ws.off('error', onError);
    };

    ws.once('message', onMessage);
    ws.once('error', onError);
  });
}

async function authenticateEncryptedClient(
  ws: WebSocket,
  offer: { publicKeyB64: string; deviceToken: string },
): Promise<Uint8Array> {
  const mobileKeypair = generateKeyPair();
  const sharedKey = deriveSharedKey(
    mobileKeypair.secretKey,
    publicKeyFromBase64(offer.publicKeyB64),
  );

  ws.send(JSON.stringify({
    type: 'e2ee_hello',
    publicKeyB64: Buffer.from(mobileKeypair.publicKey).toString('base64'),
  }));
  expect(rawToString(await waitForMessage(ws))).toBe(JSON.stringify({ type: 'e2ee_ready' }));

  ws.send(encrypt(JSON.stringify({
    type: 'e2ee_auth',
    deviceToken: offer.deviceToken,
  }), sharedKey));

  const authMessage = decrypt(rawToString(await waitForMessage(ws)), sharedKey);
  expect(authMessage).toBe(JSON.stringify({ type: 'e2ee_authenticated' }));
  return sharedKey;
}

function rawToString(data: RawData): string {
  return Array.isArray(data)
    ? Buffer.concat(data).toString('utf-8')
    : Buffer.from(data as Buffer).toString('utf-8');
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > 5_000) {
      throw new Error('Timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
