import { createServer as createHttpServer, type Server as HttpServer } from 'http';
import { createServer as createHttpsServer, type Server as HttpsServer } from 'https';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';

export const DEFAULT_REMOTE_WS_PORT = 6868;

const MAX_WS_MESSAGE_BYTES = 1024 * 1024;
const MAX_WS_CONNECTIONS = 128;
const DEFAULT_PRE_AUTH_TIMEOUT_MS = 10_000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000;

type WebSocketMessagePayload = string | Uint8Array<ArrayBufferLike>;

type WebSocketMessageHandler = (
  msg: WebSocketMessagePayload,
  reply: (response: string) => void,
  ws: WebSocket,
) => void;

export type RemoteWebSocketTransportOptions = {
  host: string;
  port: number;
  tlsCert?: string;
  tlsKey?: string;
  heartbeatIntervalMs?: number;
  preAuthTimeoutMs?: number;
};

export class RemoteWebSocketTransport {
  private readonly host: string;
  private readonly port: number;
  private readonly tlsCert: string | undefined;
  private readonly tlsKey: string | undefined;
  private readonly heartbeatIntervalMs: number;
  private readonly preAuthTimeoutMs: number;
  private httpServer: HttpsServer | HttpServer | null = null;
  private wss: WebSocketServer | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private wsAlive = new WeakSet<WebSocket>();
  private messageHandler: WebSocketMessageHandler | null = null;
  private connectionCloseHandler:
    | ((clientId: string | null, ws: WebSocket, hasOtherConnections: boolean) => void)
    | null = null;
  private wsClientIds = new Map<WebSocket, string>();
  private preAuthTimers = new WeakMap<WebSocket, ReturnType<typeof setTimeout>>();

  constructor(options: RemoteWebSocketTransportOptions) {
    this.host = options.host;
    this.port = options.port;
    this.tlsCert = options.tlsCert;
    this.tlsKey = options.tlsKey;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    this.preAuthTimeoutMs = options.preAuthTimeoutMs ?? DEFAULT_PRE_AUTH_TIMEOUT_MS;
  }

  onMessage(handler: WebSocketMessageHandler): void {
    this.messageHandler = handler;
  }

  onConnectionClose(
    handler: (clientId: string | null, ws: WebSocket, hasOtherConnections: boolean) => void,
  ): void {
    this.connectionCloseHandler = handler;
  }

  setClientId(ws: WebSocket, clientId: string): void {
    this.wsClientIds.set(ws, clientId);
    this.clearPreAuthTimer(ws);
  }

  terminateClientConnections(clientId: string): number {
    const sockets = Array.from(this.wsClientIds.entries())
      .filter(([, candidateClientId]) => candidateClientId === clientId)
      .map(([ws]) => ws);
    for (const ws of sockets) {
      ws.terminate();
    }
    return sockets.length;
  }

  get endpoint(): string | null {
    if (!this.httpServer) {
      return null;
    }
    const protocol = this.tlsCert && this.tlsKey ? 'wss' : 'ws';
    return `${protocol}://${this.host}:${this.resolvedPort}`;
  }

  get resolvedPort(): number {
    const address = this.httpServer?.address();
    return address && typeof address === 'object' ? address.port : this.port;
  }

  async start(): Promise<void> {
    if (this.wss) {
      return;
    }
    let port = this.port;
    try {
      await this.tryListen(port);
    } catch (error) {
      if (isEAddressInUse(error) && port !== 0) {
        port = 0;
        await this.tryListen(port);
        return;
      }
      throw error;
    }
  }

  async stop(): Promise<void> {
    const wss = this.wss;
    const server = this.httpServer;
    this.wss = null;
    this.httpServer = null;
    this.stopHeartbeat();

    if (wss) {
      for (const client of wss.clients) {
        client.terminate();
      }
      wss.close();
    }
    this.wsClientIds.clear();

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

  private createHttpServer(): HttpServer | HttpsServer {
    return this.tlsCert && this.tlsKey
      ? createHttpsServer({ cert: this.tlsCert, key: this.tlsKey })
      : createHttpServer();
  }

  private async tryListen(port: number): Promise<void> {
    const server = this.createHttpServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, this.host, () => {
        server.off('error', reject);
        resolve();
      });
    });

    const wss = new WebSocketServer({
      server,
      maxPayload: MAX_WS_MESSAGE_BYTES,
    });
    wss.on('connection', (ws) => {
      if (wss.clients.size > MAX_WS_CONNECTIONS) {
        ws.close(1013, 'Maximum connections reached');
        return;
      }
      this.handleConnection(ws);
    });

    this.httpServer = server;
    this.wss = wss;
    this.startHeartbeat();
  }

  private handleConnection(ws: WebSocket): void {
    let finalized = false;

    const onPong = (): void => {
      this.wsAlive.add(ws);
    };

    const onMessage = (data: RawData, isBinary: boolean): void => {
      this.wsAlive.add(ws);
      const msg =
        typeof data === 'string'
          ? data
          : isBinary
            ? new Uint8Array(data as Buffer)
            : data.toString();
      this.messageHandler?.(
        msg,
        (response) => {
          if (ws.readyState === ws.OPEN) {
            ws.send(response);
          }
        },
        ws,
      );
    };

    const finalizeConnection = (): void => {
      if (finalized) {
        return;
      }
      finalized = true;
      ws.off('pong', onPong);
      ws.off('message', onMessage);
      ws.off('close', finalizeConnection);
      ws.off('error', onError);
      this.clearPreAuthTimer(ws);
      const clientId = this.wsClientIds.get(ws) ?? null;
      this.wsClientIds.delete(ws);
      const hasOtherConnections =
        clientId !== null && Array.from(this.wsClientIds.values()).includes(clientId);
      this.connectionCloseHandler?.(clientId, ws, hasOtherConnections);
    };

    const onError = (): void => {
      finalizeConnection();
      ws.close();
    };

    const preAuthTimer = setTimeout(() => {
      if (!this.wsClientIds.has(ws)) {
        ws.terminate();
      }
    }, this.preAuthTimeoutMs);
    if (typeof preAuthTimer.unref === 'function') {
      preAuthTimer.unref();
    }
    this.preAuthTimers.set(ws, preAuthTimer);

    this.wsAlive.add(ws);
    ws.on('pong', onPong);
    ws.on('message', onMessage);
    ws.on('close', finalizeConnection);
    ws.on('error', onError);
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) {
      return;
    }
    this.heartbeatTimer = setInterval(() => {
      const wss = this.wss;
      if (!wss) {
        return;
      }
      for (const ws of wss.clients) {
        if (!this.wsAlive.has(ws)) {
          ws.terminate();
          continue;
        }
        this.wsAlive.delete(ws);
        try {
          ws.ping();
        } catch {
          // close/error handlers do the cleanup
        }
      }
    }, this.heartbeatIntervalMs);
    if (typeof this.heartbeatTimer.unref === 'function') {
      this.heartbeatTimer.unref();
    }
  }

  private stopHeartbeat(): void {
    if (!this.heartbeatTimer) {
      return;
    }
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private clearPreAuthTimer(ws: WebSocket): void {
    const timer = this.preAuthTimers.get(ws);
    if (!timer) {
      return;
    }
    clearTimeout(timer);
    this.preAuthTimers.delete(ws);
  }
}

function isEAddressInUse(error: unknown): boolean {
  return Boolean(
    error
      && typeof error === 'object'
      && 'code' in error
      && (error as { code?: unknown }).code === 'EADDRINUSE',
  );
}
