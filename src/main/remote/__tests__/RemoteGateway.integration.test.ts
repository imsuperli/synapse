import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import WebSocket, { type RawData } from 'ws';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { REMOTE_METHODS } from '../../../shared/remote/methods';
import { parsePairingCode } from '../../../shared/remote/pairing';
import {
  decrypt,
  deriveSharedKey,
  encrypt,
  generateKeyPair,
  publicKeyFromBase64,
} from '../../../shared/remote/e2ee-crypto';
import { RemoteGateway } from '../RemoteGateway';
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
});

function createProcessManager() {
  return {
    listProcesses: vi.fn(() => []),
    getPidByPane: vi.fn(() => null),
    getPtyHistory: vi.fn(),
    getLatestPaneOutputSeq: vi.fn(() => 0),
    getPtyHistoryEntriesSince: vi.fn(() => ({
      entries: [],
      firstSeq: 0,
      lastSeq: 0,
      evictedBeforeSeq: 0,
      gap: false,
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
