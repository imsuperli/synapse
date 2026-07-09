import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import {
  createRelaySessionId,
  hashRelayToken,
  SynapseRelayServer,
} from '../SynapseRelayServer';

let server: SynapseRelayServer | null = null;
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) {
    socket.terminate();
  }
  await server?.stop();
  server = null;
});

describe('SynapseRelayServer', () => {
  it('reports health and connection stats', async () => {
    server = await startRelay();

    const response = await fetch(`http://127.0.0.1:${server.resolvedPort}/healthz`);

    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      sessions: 0,
      connections: 0,
      pairedSessions: 0,
    });
  });

  it('pairs host and client sockets and forwards text in both directions', async () => {
    server = await startRelay();
    const session = createSession();
    const host = await connect(hostUrl(session));
    const client = await connect(clientUrl(session));

    const clientMessage = onceMessage(client);
    host.send('from-host');
    expect(await clientMessage).toBe('from-host');

    const hostMessage = onceMessage(host);
    client.send('from-client');
    expect(await hostMessage).toBe('from-client');

    expect(server.getStats()).toEqual({
      sessions: 1,
      connections: 2,
      pairedSessions: 1,
    });
  });

  it('buffers host messages until the client joins', async () => {
    server = await startRelay();
    const session = createSession();
    const host = await connect(hostUrl(session));

    host.send('early-host-hello');

    const client = new WebSocket(clientUrl(session));
    sockets.push(client);
    const message = onceMessage(client);
    await onceOpen(client);

    expect(await message).toBe('early-host-hello');
  });

  it('rejects clients with an invalid token without attaching them to the session', async () => {
    server = await startRelay();
    const session = createSession();
    await connect(hostUrl(session));

    const rejected = new WebSocket(clientUrl({ ...session, clientToken: 'wrong-token-wrong-token-0000' }));
    sockets.push(rejected);
    const close = onceClose(rejected);

    await expect(close).resolves.toMatchObject({ code: 4401 });
    expect(server.getStats()).toMatchObject({
      sessions: 1,
      connections: 1,
      pairedSessions: 0,
    });
  });

  it('replaces an existing host connection after token verification', async () => {
    server = await startRelay();
    const session = createSession();
    const firstHost = await connect(hostUrl(session));

    const firstHostClose = onceClose(firstHost);
    const secondHost = await connect(hostUrl(session));

    await expect(firstHostClose).resolves.toMatchObject({ code: 4003 });
    expect(secondHost.readyState).toBe(WebSocket.OPEN);
    expect(server.getStats()).toMatchObject({
      sessions: 1,
      connections: 1,
      pairedSessions: 0,
    });
  });

  it('enforces per-socket message rate limits', async () => {
    server = await startRelay({ maxMessagesPerMinute: 1 });
    const session = createSession();
    const host = await connect(hostUrl(session));

    host.send('first');
    const close = onceClose(host);
    host.send('second');

    await expect(close).resolves.toMatchObject({ code: 4429 });
  });
});

async function startRelay(options: Partial<ConstructorParameters<typeof SynapseRelayServer>[0]> = {}) {
  const relay = new SynapseRelayServer({
    host: '127.0.0.1',
    port: 0,
    heartbeatIntervalMs: 5_000,
    cleanupIntervalMs: 5_000,
    ...options,
  });
  await relay.start();
  return relay;
}

type TestSession = {
  sessionId: string;
  hostToken: string;
  clientToken: string;
};

function createSession(): TestSession {
  return {
    sessionId: createRelaySessionId(),
    hostToken: 'host-token-host-token-host-token',
    clientToken: 'client-token-client-token-client',
  };
}

function hostUrl(session: TestSession): string {
  return urlWith({
    role: 'host',
    sessionId: session.sessionId,
    hostToken: session.hostToken,
    clientTokenHash: hashRelayToken(session.clientToken),
  });
}

function clientUrl(session: TestSession): string {
  return urlWith({
    role: 'client',
    sessionId: session.sessionId,
    clientToken: session.clientToken,
  });
}

function urlWith(params: Record<string, string>): string {
  if (!server?.endpoint) {
    throw new Error('Relay is not running');
  }
  const url = new URL(`${server.endpoint}${server.relayPath}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

async function connect(url: string): Promise<WebSocket> {
  const socket = new WebSocket(url);
  sockets.push(socket);
  await onceOpen(socket);
  return socket;
}

function onceOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
}

function onceMessage(socket: WebSocket): Promise<string> {
  return new Promise((resolve) => {
    socket.once('message', (data) => {
      resolve(Buffer.isBuffer(data) ? data.toString('utf8') : String(data));
    });
  });
}

function onceClose(socket: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    socket.once('close', (code, reason) => {
      resolve({ code, reason: reason.toString('utf8') });
    });
  });
}
