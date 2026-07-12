import { createHash, randomUUID, timingSafeEqual } from 'crypto';
import { createServer, type IncomingMessage, type Server as HttpServer } from 'http';
import { URL } from 'url';
import { WebSocket, WebSocketServer, type RawData } from 'ws';

type RelayRole = 'host' | 'client';

export type SynapseRelayServerOptions = {
  host?: string;
  port?: number;
  path?: string;
  maxSessions?: number;
  maxConnections?: number;
  maxPayloadBytes?: number;
  maxQueuedMessages?: number;
  maxQueuedBytes?: number;
  maxMessagesPerMinute?: number;
  maxBytesPerMinute?: number;
  sessionTtlMs?: number;
  idleTtlMs?: number;
  heartbeatIntervalMs?: number;
  cleanupIntervalMs?: number;
  now?: () => number;
};

export type SynapseRelayServerStats = {
  sessions: number;
  connections: number;
  pairedSessions: number;
};

type RelayMessage = {
  data: Buffer | string;
  isBinary: boolean;
  bytes: number;
};

type RelayQueuedMessage = RelayMessage & {
  sender: RelayPeer;
};

type RelayPeer = {
  role: RelayRole;
  ws: WebSocket;
  connectedAt: number;
  alive: boolean;
  limiter: FixedWindowRateLimiter;
};

type RelaySession = {
  sessionId: string;
  hostTokenHash: string;
  clientTokenHash: string;
  createdAt: number;
  expiresAt: number;
  lastActivityAt: number;
  host: RelayPeer | null;
  client: RelayPeer | null;
  queuedForHost: RelayQueuedMessage[];
  queuedForClient: RelayQueuedMessage[];
  queuedForHostBytes: number;
  queuedForClientBytes: number;
};

const DEFAULT_HOST = '0.0.0.0';
const DEFAULT_PORT = 8787;
const DEFAULT_PATH = '/v1/relay';
const DEFAULT_MAX_SESSIONS = 10_000;
const DEFAULT_MAX_CONNECTIONS = 20_000;
const DEFAULT_MAX_PAYLOAD_BYTES = 1024 * 1024;
const DEFAULT_MAX_QUEUED_MESSAGES = 64;
const DEFAULT_MAX_QUEUED_BYTES = 1024 * 1024;
const DEFAULT_MAX_MESSAGES_PER_MINUTE = 3_600;
const DEFAULT_MAX_BYTES_PER_MINUTE = 64 * 1024 * 1024;
const DEFAULT_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const DEFAULT_IDLE_TTL_MS = 60_000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000;
const DEFAULT_CLEANUP_INTERVAL_MS = 30_000;

const CLOSE_UNAUTHORIZED = 4401;
const CLOSE_NOT_FOUND = 4404;
const CLOSE_EXPIRED = 4408;
const CLOSE_POLICY = 1008;
const CLOSE_OVERLOADED = 1013;
const CLOSE_RATE_LIMIT = 4429;
const CLOSE_PEER_CHANGED = 4004;

export function hashRelayToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function createRelaySessionId(): string {
  return randomUUID();
}

export class SynapseRelayServer {
  private readonly host: string;
  private readonly port: number;
  private readonly path: string;
  private readonly maxSessions: number;
  private readonly maxConnections: number;
  private readonly maxQueuedMessages: number;
  private readonly maxQueuedBytes: number;
  private readonly maxMessagesPerMinute: number;
  private readonly maxBytesPerMinute: number;
  private readonly sessionTtlMs: number;
  private readonly idleTtlMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly cleanupIntervalMs: number;
  private readonly now: () => number;
  private readonly sessions = new Map<string, RelaySession>();
  private server: HttpServer | null = null;
  private wss: WebSocketServer | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: SynapseRelayServerOptions = {}) {
    this.host = options.host ?? DEFAULT_HOST;
    this.port = options.port ?? DEFAULT_PORT;
    this.path = options.path ?? DEFAULT_PATH;
    this.maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS;
    this.maxConnections = options.maxConnections ?? DEFAULT_MAX_CONNECTIONS;
    this.maxQueuedMessages = options.maxQueuedMessages ?? DEFAULT_MAX_QUEUED_MESSAGES;
    this.maxQueuedBytes = options.maxQueuedBytes ?? DEFAULT_MAX_QUEUED_BYTES;
    this.maxMessagesPerMinute = options.maxMessagesPerMinute ?? DEFAULT_MAX_MESSAGES_PER_MINUTE;
    this.maxBytesPerMinute = options.maxBytesPerMinute ?? DEFAULT_MAX_BYTES_PER_MINUTE;
    this.sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
    this.idleTtlMs = options.idleTtlMs ?? DEFAULT_IDLE_TTL_MS;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    this.cleanupIntervalMs = options.cleanupIntervalMs ?? DEFAULT_CLEANUP_INTERVAL_MS;
    this.now = options.now ?? Date.now;
    const maxPayloadBytes = options.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES;
    this.wss = new WebSocketServer({ noServer: true, maxPayload: maxPayloadBytes });
  }

  get endpoint(): string | null {
    if (!this.server) {
      return null;
    }
    return `ws://${this.host}:${this.resolvedPort}`;
  }

  get relayPath(): string {
    return this.path;
  }

  get resolvedPort(): number {
    const address = this.server?.address();
    return address && typeof address === 'object' ? address.port : this.port;
  }

  getStats(): SynapseRelayServerStats {
    let connections = 0;
    let pairedSessions = 0;
    for (const session of this.sessions.values()) {
      if (session.host) {
        connections += 1;
      }
      if (session.client) {
        connections += 1;
      }
      if (session.host && session.client) {
        pairedSessions += 1;
      }
    }
    return {
      sessions: this.sessions.size,
      connections,
      pairedSessions,
    };
  }

  async start(): Promise<void> {
    if (this.server) {
      return;
    }

    const server = createServer((request, response) => {
      if (request.method === 'GET' && request.url?.startsWith('/healthz')) {
        const body = JSON.stringify({ ok: true, ...this.getStats() });
        response.writeHead(200, {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        });
        response.end(body);
        return;
      }
      response.writeHead(404, { 'content-type': 'text/plain' });
      response.end('not found');
    });

    const wss = this.requireWss();
    server.on('upgrade', (request, socket, head) => {
      const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
      if (requestUrl.pathname !== this.path) {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
        socket.destroy();
        return;
      }
      if (this.getStats().connections >= this.maxConnections) {
        socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    });

    wss.on('connection', (ws, request) => this.handleConnection(ws, request));

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.port, this.host, () => {
        server.off('error', reject);
        resolve();
      });
    });

    this.server = server;
    this.startHeartbeat();
    this.startCleanup();
  }

  async stop(): Promise<void> {
    this.stopHeartbeat();
    this.stopCleanup();
    const wss = this.wss;
    if (wss) {
      for (const client of wss.clients) {
        client.terminate();
      }
      wss.removeAllListeners();
      wss.close();
    }
    this.sessions.clear();

    const server = this.server;
    this.server = null;
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  }

  private requireWss(): WebSocketServer {
    if (!this.wss) {
      throw new Error('Relay WebSocket server is not initialized');
    }
    return this.wss;
  }

  private handleConnection(ws: WebSocket, request: IncomingMessage): void {
    const result = this.authenticate(request, ws);
    if (!result.ok) {
      ws.close(result.code, result.reason);
      return;
    }

    const { peer, session } = result;
    peer.ws.on('pong', () => {
      peer.alive = true;
    });
    peer.ws.on('message', (data, isBinary) => this.handlePeerMessage(session, peer, data, isBinary));
    peer.ws.on('close', () => this.detachPeer(session, peer));
    peer.ws.on('error', () => this.detachPeer(session, peer));
    this.flushQueue(session, peer.role);
  }

  private authenticate(
    request: IncomingMessage,
    ws: WebSocket,
  ):
    | { ok: true; session: RelaySession; peer: RelayPeer }
    | { ok: false; code: number; reason: string } {
    const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    const role = requestUrl.searchParams.get('role');
    const sessionId = requestUrl.searchParams.get('sessionId');
    if (role !== 'host' && role !== 'client') {
      return { ok: false, code: CLOSE_POLICY, reason: 'Invalid role' };
    }
    if (!sessionId || !isValidSessionId(sessionId)) {
      return { ok: false, code: CLOSE_POLICY, reason: 'Invalid sessionId' };
    }

    if (role === 'host') {
      return this.authenticateHost(requestUrl, sessionId, ws);
    }
    return this.authenticateClient(requestUrl, sessionId, ws);
  }

  private authenticateHost(
    requestUrl: URL,
    sessionId: string,
    ws: WebSocket,
  ):
    | { ok: true; session: RelaySession; peer: RelayPeer }
    | { ok: false; code: number; reason: string } {
    const hostToken = requestUrl.searchParams.get('hostToken');
    const clientTokenHash = requestUrl.searchParams.get('clientTokenHash');
    if (!hostToken || !isValidRelayToken(hostToken)) {
      return { ok: false, code: CLOSE_POLICY, reason: 'Invalid host token' };
    }

    let session = this.sessions.get(sessionId);
    const hostTokenHash = hashRelayToken(hostToken);
    const now = this.now();

    if (!session) {
      if (this.sessions.size >= this.maxSessions) {
        return { ok: false, code: CLOSE_OVERLOADED, reason: 'Maximum sessions reached' };
      }
      if (!clientTokenHash || !isValidTokenHash(clientTokenHash)) {
        return { ok: false, code: CLOSE_POLICY, reason: 'Invalid client token hash' };
      }
      session = {
        sessionId,
        hostTokenHash,
        clientTokenHash,
        createdAt: now,
        expiresAt: now + this.readSessionTtlMs(requestUrl),
        lastActivityAt: now,
        host: null,
        client: null,
        queuedForHost: [],
        queuedForClient: [],
        queuedForHostBytes: 0,
        queuedForClientBytes: 0,
      };
      this.sessions.set(sessionId, session);
    } else if (this.isExpired(session)) {
      this.closeSession(session, CLOSE_EXPIRED, 'Session expired');
      return { ok: false, code: CLOSE_EXPIRED, reason: 'Session expired' };
    } else if (!safeHashEquals(session.hostTokenHash, hostTokenHash)) {
      return { ok: false, code: CLOSE_UNAUTHORIZED, reason: 'Unauthorized' };
    } else if (clientTokenHash && !safeHashEquals(session.clientTokenHash, clientTokenHash)) {
      return { ok: false, code: CLOSE_POLICY, reason: 'Client token hash mismatch' };
    }

    const peer = this.createPeer('host', ws);
    this.replacePeer(session, peer);
    return { ok: true, session, peer };
  }

  private authenticateClient(
    requestUrl: URL,
    sessionId: string,
    ws: WebSocket,
  ):
    | { ok: true; session: RelaySession; peer: RelayPeer }
    | { ok: false; code: number; reason: string } {
    const clientToken = requestUrl.searchParams.get('clientToken');
    if (!clientToken || !isValidRelayToken(clientToken)) {
      return { ok: false, code: CLOSE_POLICY, reason: 'Invalid client token' };
    }

    const session = this.sessions.get(sessionId);
    if (!session) {
      return { ok: false, code: CLOSE_NOT_FOUND, reason: 'Session not found' };
    }
    if (this.isExpired(session)) {
      this.closeSession(session, CLOSE_EXPIRED, 'Session expired');
      return { ok: false, code: CLOSE_EXPIRED, reason: 'Session expired' };
    }
    if (!safeHashEquals(session.clientTokenHash, hashRelayToken(clientToken))) {
      return { ok: false, code: CLOSE_UNAUTHORIZED, reason: 'Unauthorized' };
    }

    const peer = this.createPeer('client', ws);
    this.replacePeer(session, peer);
    return { ok: true, session, peer };
  }

  private createPeer(role: RelayRole, ws: WebSocket): RelayPeer {
    return {
      role,
      ws,
      connectedAt: this.now(),
      alive: true,
      limiter: new FixedWindowRateLimiter({
        maxMessages: this.maxMessagesPerMinute,
        maxBytes: this.maxBytesPerMinute,
        now: this.now,
      }),
    };
  }

  private replacePeer(session: RelaySession, peer: RelayPeer): void {
    const existing = peer.role === 'host' ? session.host : session.client;
    if (existing && existing.ws !== peer.ws) {
      this.closePeer(session, peer.role, 4003, 'Replaced by newer connection');
      this.closePeer(
        session,
        oppositeRole(peer.role),
        CLOSE_PEER_CHANGED,
        'Relay peer was replaced',
      );
    } else {
      this.clearQueuedMessagesFromSender(session, peer.role);
    }
    if (peer.role === 'host') {
      session.host = peer;
    } else {
      session.client = peer;
    }
    session.lastActivityAt = this.now();
  }

  private handlePeerMessage(
    session: RelaySession,
    peer: RelayPeer,
    data: RawData,
    isBinary: boolean,
  ): void {
    if (!this.isCurrentPeer(session, peer)) {
      return;
    }
    const message = normalizeMessage(data, isBinary);
    if (!peer.limiter.consume(message.bytes)) {
      peer.ws.close(CLOSE_RATE_LIMIT, 'Rate limit exceeded');
      return;
    }
    session.lastActivityAt = this.now();
    peer.alive = true;

    const targetRole: RelayRole = peer.role === 'host' ? 'client' : 'host';
    const target = targetRole === 'host' ? session.host : session.client;
    if (!target || target.ws.readyState !== WebSocket.OPEN) {
      this.enqueueMessage(session, targetRole, message, peer);
      return;
    }
    sendMessage(target.ws, message);
  }

  private enqueueMessage(
    session: RelaySession,
    targetRole: RelayRole,
    message: RelayMessage,
    sender: RelayPeer,
  ): void {
    const queue = targetRole === 'host' ? session.queuedForHost : session.queuedForClient;
    const queuedBytes = targetRole === 'host' ? session.queuedForHostBytes : session.queuedForClientBytes;
    if (
      queue.length >= this.maxQueuedMessages ||
      queuedBytes + message.bytes > this.maxQueuedBytes
    ) {
      sender.ws.close(CLOSE_POLICY, 'Peer is not connected');
      return;
    }
    queue.push({ ...message, sender });
    if (targetRole === 'host') {
      session.queuedForHostBytes += message.bytes;
    } else {
      session.queuedForClientBytes += message.bytes;
    }
  }

  private flushQueue(session: RelaySession, role: RelayRole): void {
    const peer = role === 'host' ? session.host : session.client;
    if (!peer || peer.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    const queue = role === 'host' ? session.queuedForHost : session.queuedForClient;
    const senderRole = oppositeRole(role);
    while (queue.length > 0 && peer.ws.readyState === WebSocket.OPEN) {
      const message = queue.shift()!;
      const currentSender = senderRole === 'host' ? session.host : session.client;
      if (
        !currentSender
        || currentSender.ws !== message.sender.ws
        || currentSender.ws.readyState !== WebSocket.OPEN
      ) {
        continue;
      }
      sendMessage(peer.ws, message);
    }
    if (role === 'host') {
      session.queuedForHostBytes = 0;
    } else {
      session.queuedForClientBytes = 0;
    }
  }

  private isCurrentPeer(session: RelaySession, peer: RelayPeer): boolean {
    return peer.role === 'host'
      ? session.host?.ws === peer.ws
      : session.client?.ws === peer.ws;
  }

  private detachPeer(session: RelaySession, peer: RelayPeer): void {
    if (peer.role === 'host' && session.host?.ws === peer.ws) {
      session.host = null;
      this.clearQueuedMessagesFromSender(session, peer.role);
      this.closePeer(session, 'client', CLOSE_PEER_CHANGED, 'Relay peer disconnected');
    }
    if (peer.role === 'client' && session.client?.ws === peer.ws) {
      session.client = null;
      this.clearQueuedMessagesFromSender(session, peer.role);
      this.closePeer(session, 'host', CLOSE_PEER_CHANGED, 'Relay peer disconnected');
    }
    session.lastActivityAt = this.now();
  }

  private closePeer(
    session: RelaySession,
    role: RelayRole,
    code: number,
    reason: string,
  ): void {
    const peer = role === 'host' ? session.host : session.client;
    if (!peer) {
      return;
    }
    if (role === 'host') {
      session.host = null;
    } else {
      session.client = null;
    }
    this.clearQueuedMessagesFromSender(session, role);
    if (peer.ws.readyState === WebSocket.OPEN || peer.ws.readyState === WebSocket.CONNECTING) {
      peer.ws.close(code, reason);
    }
  }

  private clearQueuedMessagesFromSender(session: RelaySession, senderRole: RelayRole): void {
    if (senderRole === 'host') {
      session.queuedForClient = [];
      session.queuedForClientBytes = 0;
      return;
    }
    session.queuedForHost = [];
    session.queuedForHostBytes = 0;
  }

  private isExpired(session: RelaySession): boolean {
    return this.now() > session.expiresAt;
  }

  private readSessionTtlMs(requestUrl: URL): number {
    const ttlSeconds = Number(requestUrl.searchParams.get('ttlSeconds') ?? '');
    if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
      return this.sessionTtlMs;
    }
    return Math.min(Math.floor(ttlSeconds * 1000), this.sessionTtlMs);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      for (const session of this.sessions.values()) {
        for (const peer of [session.host, session.client]) {
          if (!peer) {
            continue;
          }
          if (!peer.alive) {
            peer.ws.terminate();
            continue;
          }
          peer.alive = false;
          peer.ws.ping();
        }
      }
    }, this.heartbeatIntervalMs);
    this.heartbeatTimer.unref?.();
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private startCleanup(): void {
    this.stopCleanup();
    this.cleanupTimer = setInterval(() => this.cleanupSessions(), this.cleanupIntervalMs);
    this.cleanupTimer.unref?.();
  }

  private stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  private cleanupSessions(): void {
    const now = this.now();
    for (const session of Array.from(this.sessions.values())) {
      if (now > session.expiresAt) {
        this.closeSession(session, CLOSE_EXPIRED, 'Session expired');
        continue;
      }
      if (!session.host && !session.client && now - session.lastActivityAt > this.idleTtlMs) {
        this.sessions.delete(session.sessionId);
      }
    }
  }

  private closeSession(session: RelaySession, code: number, reason: string): void {
    session.host?.ws.close(code, reason);
    session.client?.ws.close(code, reason);
    this.sessions.delete(session.sessionId);
  }
}

type FixedWindowRateLimiterOptions = {
  maxMessages: number;
  maxBytes: number;
  now: () => number;
};

class FixedWindowRateLimiter {
  private readonly maxMessages: number;
  private readonly maxBytes: number;
  private readonly now: () => number;
  private windowStartedAt: number;
  private messages = 0;
  private bytes = 0;

  constructor(options: FixedWindowRateLimiterOptions) {
    this.maxMessages = options.maxMessages;
    this.maxBytes = options.maxBytes;
    this.now = options.now;
    this.windowStartedAt = this.now();
  }

  consume(bytes: number): boolean {
    const now = this.now();
    if (now - this.windowStartedAt >= 60_000) {
      this.windowStartedAt = now;
      this.messages = 0;
      this.bytes = 0;
    }
    this.messages += 1;
    this.bytes += bytes;
    return this.messages <= this.maxMessages && this.bytes <= this.maxBytes;
  }
}

function normalizeMessage(data: RawData, isBinary: boolean): RelayMessage {
  const buffer = Array.isArray(data)
    ? Buffer.concat(data)
    : Buffer.isBuffer(data)
      ? Buffer.from(data)
      : Buffer.from(data as ArrayBuffer);
  if (isBinary) {
    return { data: buffer, isBinary: true, bytes: buffer.byteLength };
  }
  const text = buffer.toString('utf8');
  return { data: text, isBinary: false, bytes: Buffer.byteLength(text) };
}

function sendMessage(ws: WebSocket, message: RelayMessage): void {
  if (ws.readyState !== WebSocket.OPEN) {
    return;
  }
  ws.send(message.data, { binary: message.isBinary });
}

function oppositeRole(role: RelayRole): RelayRole {
  return role === 'host' ? 'client' : 'host';
}

function safeHashEquals(left: string, right: string): boolean {
  if (!isValidTokenHash(left) || !isValidTokenHash(right)) {
    return false;
  }
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

function isValidSessionId(value: string): boolean {
  return /^[A-Za-z0-9._~-]{16,128}$/.test(value);
}

function isValidRelayToken(value: string): boolean {
  return value.length >= 24 && value.length <= 512;
}

function isValidTokenHash(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}
