import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket, type RawData } from 'ws';
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

  it('drops queued messages from a disconnected client before the host rejoins', async () => {
    server = await startRelay();
    const session = createSession();
    const firstHost = await connect(hostUrl(session));

    const firstHostClose = onceClose(firstHost);
    firstHost.close();
    await firstHostClose;

    const staleClient = await connect(clientUrl(session));
    staleClient.send('stale-client-hello');
    const staleClientClose = onceClose(staleClient);
    staleClient.close();
    await staleClientClose;

    const currentClient = await connect(clientUrl(session));
    currentClient.send('current-client-hello');

    const secondHost = new WebSocket(hostUrl(session));
    sockets.push(secondHost);
    const secondHostMessage = onceMessage(secondHost);
    await onceOpen(secondHost);

    expect(await secondHostMessage).toBe('current-client-hello');
    await expect(noMessage(secondHost, 50)).resolves.toBeUndefined();
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

  it('closes the paired host when a client connection is replaced', async () => {
    server = await startRelay();
    const session = createSession();
    const host = await connect(hostUrl(session));
    const firstClient = await connect(clientUrl(session));

    const hostClose = onceClose(host);
    const firstClientClose = onceClose(firstClient);
    const secondClient = await connect(clientUrl(session));

    await expect(firstClientClose).resolves.toMatchObject({ code: 4003 });
    await expect(hostClose).resolves.toMatchObject({
      code: 4004,
      reason: 'Relay peer was replaced',
    });
    expect(secondClient.readyState).toBe(WebSocket.OPEN);
    expect(server.getStats()).toMatchObject({
      sessions: 1,
      connections: 1,
      pairedSessions: 0,
    });
  });

  it('closes the paired peer when either side disconnects', async () => {
    server = await startRelay();
    const hostDisconnectSession = createSession();
    const hostA = await connect(hostUrl(hostDisconnectSession));
    const clientA = await connect(clientUrl(hostDisconnectSession));

    const clientAClose = onceClose(clientA);
    hostA.close();
    await expect(clientAClose).resolves.toMatchObject({
      code: 4004,
      reason: 'Relay peer disconnected',
    });

    const clientDisconnectSession = createSession();
    const hostB = await connect(hostUrl(clientDisconnectSession));
    const clientB = await connect(clientUrl(clientDisconnectSession));

    const hostBClose = onceClose(hostB);
    clientB.close();
    await expect(hostBClose).resolves.toMatchObject({
      code: 4004,
      reason: 'Relay peer disconnected',
    });
  });

  it('keeps separate relay sessions isolated when one client reconnects', async () => {
    server = await startRelay();
    const sessionA = createSession();
    const sessionB = createSession();
    const hostA = await connect(hostUrl(sessionA));
    const clientA = await connect(clientUrl(sessionA));
    const hostB = await connect(hostUrl(sessionB));
    const clientB = await connect(clientUrl(sessionB));

    const hostAClose = onceClose(hostA);
    const clientAClose = onceClose(clientA);
    await connect(clientUrl(sessionA));
    await expect(clientAClose).resolves.toMatchObject({ code: 4003 });
    await expect(hostAClose).resolves.toMatchObject({ code: 4004 });

    const clientBMessage = onceMessage(clientB);
    hostB.send('session-b-host-message');
    expect(await clientBMessage).toBe('session-b-host-message');

    const hostBMessage = onceMessage(hostB);
    clientB.send('session-b-client-message');
    expect(await hostBMessage).toBe('session-b-client-message');

    expect(server.getStats()).toMatchObject({
      sessions: 2,
      connections: 3,
      pairedSessions: 1,
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

function noMessage(socket: WebSocket, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('message', onMessage);
      resolve();
    }, ms);
    const onMessage = (data: RawData) => {
      clearTimeout(timer);
      reject(new Error(`Unexpected relay message: ${data.toString()}`));
    };
    socket.once('message', onMessage);
  });
}
