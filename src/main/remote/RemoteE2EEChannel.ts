// Adapted from Orca's MIT-licensed E2EE channel.
// Copyright (c) 2026 Lovecast Inc.
import type { WebSocket } from 'ws';
import { decrypt, decryptBytes, deriveSharedKey, encrypt, encryptBytes } from '../../shared/remote/e2ee-crypto';

type ChannelState = 'awaiting_hello' | 'awaiting_auth' | 'ready';

const DEFAULT_HANDSHAKE_TIMEOUT_MS = 10_000;
const MAX_CONSECUTIVE_DECRYPT_FAILURES = 5;
export const MAX_E2EE_BUFFERED_AMOUNT = 8 * 1024 * 1024;

type E2EEHello = {
  type: 'e2ee_hello';
  publicKeyB64: string;
};

type E2EEAuth = {
  type: 'e2ee_auth';
  deviceToken: string;
};

export type RemoteE2EEChannelOptions = {
  serverSecretKey: Uint8Array;
  validateToken: (token: string) => boolean;
  onReady: (channel: RemoteE2EEChannel) => void;
  onError: (code: number, reason: string) => void;
  handshakeTimeoutMs?: number;
};

export class RemoteE2EEChannel {
  private state: ChannelState = 'awaiting_hello';
  private sharedKey: Uint8Array | null = null;
  private consecutiveFailures = 0;
  private handshakeTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly ws: WebSocket;
  private readonly serverSecretKey: Uint8Array;
  private readonly validateToken: (token: string) => boolean;
  private readonly onReady: (channel: RemoteE2EEChannel) => void;
  private readonly onError: (code: number, reason: string) => void;
  private messageHandler:
    | ((
        plaintext: string,
        encryptedReply: (response: string) => boolean,
        encryptedBinaryReply: (response: Uint8Array<ArrayBufferLike>) => boolean,
      ) => void)
    | null = null;
  private binaryMessageHandler: ((plaintext: Uint8Array<ArrayBufferLike>) => void) | null = null;

  deviceToken: string | null = null;

  constructor(ws: WebSocket, options: RemoteE2EEChannelOptions) {
    this.ws = ws;
    this.serverSecretKey = options.serverSecretKey;
    this.validateToken = options.validateToken;
    this.onReady = options.onReady;
    this.onError = options.onError;
    this.handshakeTimer = setTimeout(() => {
      this.onError(4002, 'E2EE handshake timeout');
    }, options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS);
    if (typeof this.handshakeTimer.unref === 'function') {
      this.handshakeTimer.unref();
    }
  }

  onMessage(
    handler: (
      plaintext: string,
      encryptedReply: (response: string) => boolean,
      encryptedBinaryReply: (response: Uint8Array<ArrayBufferLike>) => boolean,
    ) => void,
  ): void {
    this.messageHandler = handler;
  }

  onBinaryMessage(handler: (plaintext: Uint8Array<ArrayBufferLike>) => void): void {
    this.binaryMessageHandler = handler;
  }

  handleRawMessage(raw: string | Uint8Array<ArrayBufferLike>): void {
    if (this.state === 'awaiting_hello') {
      if (typeof raw !== 'string') {
        this.onError(4001, 'Invalid handshake message');
        return;
      }
      this.handleHello(raw);
      return;
    }

    if (!this.sharedKey) {
      return;
    }

    if (typeof raw !== 'string') {
      const plaintextBytes = decryptBytes(raw, this.sharedKey);
      if (plaintextBytes === null) {
        this.trackDecryptFailure();
        return;
      }
      this.consecutiveFailures = 0;
      if (this.state !== 'ready') {
        this.onError(4001, 'Invalid binary message before authentication');
        return;
      }
      this.binaryMessageHandler?.(plaintextBytes);
      return;
    }

    const plaintext = decrypt(raw, this.sharedKey);
    if (plaintext === null) {
      this.trackDecryptFailure();
      return;
    }
    this.consecutiveFailures = 0;

    if (this.state === 'awaiting_auth') {
      this.handleAuth(plaintext);
      return;
    }

    const encryptedReply = (response: string): boolean => {
      if (!this.sharedKey || this.ws.readyState !== this.ws.OPEN) {
        return false;
      }
      if (!this.canSendWithoutBackpressure()) {
        return false;
      }
      this.ws.send(encrypt(response, this.sharedKey));
      return true;
    };

    const encryptedBinaryReply = (response: Uint8Array<ArrayBufferLike>): boolean => {
      if (!this.sharedKey || this.ws.readyState !== this.ws.OPEN) {
        return false;
      }
      if (!this.canSendWithoutBackpressure()) {
        return false;
      }
      this.ws.send(Buffer.from(encryptBytes(response, this.sharedKey)), { binary: true });
      return true;
    };

    this.messageHandler?.(plaintext, encryptedReply, encryptedBinaryReply);
  }

  destroy(): void {
    if (this.handshakeTimer) {
      clearTimeout(this.handshakeTimer);
      this.handshakeTimer = null;
    }
    this.sharedKey = null;
    this.messageHandler = null;
    this.binaryMessageHandler = null;
  }

  private handleHello(raw: string): void {
    let hello: E2EEHello;
    try {
      hello = JSON.parse(raw) as E2EEHello;
    } catch {
      this.onError(4001, 'Invalid handshake message');
      return;
    }
    if (hello.type !== 'e2ee_hello' || !hello.publicKeyB64) {
      this.onError(4001, 'Invalid e2ee_hello');
      return;
    }

    const clientPublicKey = Uint8Array.from(Buffer.from(hello.publicKeyB64, 'base64'));
    if (clientPublicKey.length !== 32) {
      this.onError(4001, 'Invalid public key');
      return;
    }

    this.sharedKey = deriveSharedKey(this.serverSecretKey, clientPublicKey);
    this.state = 'awaiting_auth';
    if (this.ws.readyState === this.ws.OPEN) {
      this.ws.send(JSON.stringify({ type: 'e2ee_ready' }));
    }
  }

  private handleAuth(plaintext: string): void {
    let auth: E2EEAuth;
    try {
      auth = JSON.parse(plaintext) as E2EEAuth;
    } catch {
      this.sendEncryptedControl({ type: 'e2ee_error', error: { code: 'bad_auth' } });
      this.onError(4001, 'Invalid e2ee_auth');
      return;
    }

    if (auth.type !== 'e2ee_auth' || !auth.deviceToken) {
      this.sendEncryptedControl({ type: 'e2ee_error', error: { code: 'bad_auth' } });
      this.onError(4001, 'Invalid e2ee_auth');
      return;
    }
    if (!this.validateToken(auth.deviceToken)) {
      this.sendEncryptedControl({ type: 'e2ee_error', error: { code: 'unauthorized' } });
      this.onError(4001, 'Unauthorized');
      return;
    }

    this.deviceToken = auth.deviceToken;
    this.state = 'ready';
    if (this.handshakeTimer) {
      clearTimeout(this.handshakeTimer);
      this.handshakeTimer = null;
    }
    this.sendEncryptedControl({ type: 'e2ee_authenticated' });
    this.onReady(this);
  }

  private sendEncryptedControl(message: unknown): void {
    if (this.ws.readyState === this.ws.OPEN && this.sharedKey) {
      if (!this.canSendWithoutBackpressure()) {
        return;
      }
      this.ws.send(encrypt(JSON.stringify(message), this.sharedKey));
    }
  }

  private trackDecryptFailure(): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= MAX_CONSECUTIVE_DECRYPT_FAILURES) {
      this.onError(4003, 'Too many decryption failures');
    }
  }

  private canSendWithoutBackpressure(): boolean {
    if (this.ws.bufferedAmount <= MAX_E2EE_BUFFERED_AMOUNT) {
      return true;
    }
    this.onError(1013, 'Backpressure limit exceeded');
    return false;
  }
}
