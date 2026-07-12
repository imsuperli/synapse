import type { WebSocket } from 'ws';
import { describe, expect, it, vi } from 'vitest';
import {
  decrypt,
  deriveSharedKey,
  encrypt,
  generateKeyPair,
} from '../../../shared/remote/e2ee-crypto';
import { MAX_E2EE_BUFFERED_AMOUNT, RemoteE2EEChannel } from '../RemoteE2EEChannel';

describe('RemoteE2EEChannel', () => {
  it('applies backpressure limits to encrypted text replies', () => {
    const serverKeypair = generateKeyPair();
    const mobileKeypair = generateKeyPair();
    const ws = createMockWebSocket();
    const onError = vi.fn();
    let readyChannel: RemoteE2EEChannel | null = null;
    let replyResult: boolean | null = null;

    const channel = new RemoteE2EEChannel(ws, {
      serverSecretKey: serverKeypair.secretKey,
      validateToken: (token) => token === 'device-token',
      onReady: (ready) => {
        readyChannel = ready;
      },
      onError,
    });

    channel.handleRawMessage(JSON.stringify({
      type: 'e2ee_hello',
      publicKeyB64: Buffer.from(mobileKeypair.publicKey).toString('base64'),
    }));
    expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'e2ee_ready' }));

    const sharedKey = deriveSharedKey(mobileKeypair.secretKey, serverKeypair.publicKey);
    channel.handleRawMessage(encrypt(JSON.stringify({
      type: 'e2ee_auth',
      deviceToken: 'device-token',
    }), sharedKey));
    expect(readyChannel).toBe(channel);
    expect(decrypt(String(ws.sent.at(-1)), sharedKey)).toBe(
      JSON.stringify({ type: 'e2ee_authenticated' }),
    );

    ws.send.mockClear();
    onError.mockClear();
    channel.onMessage((_plaintext, encryptedReply) => {
      replyResult = encryptedReply(JSON.stringify({ ok: true }));
    });

    ws.bufferedAmount = MAX_E2EE_BUFFERED_AMOUNT + 1;
    channel.handleRawMessage(encrypt(JSON.stringify({
      id: 'req-1',
      method: 'status.get',
    }), sharedKey));

    expect(replyResult).toBe(false);
    expect(ws.send).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(1013, 'Backpressure limit exceeded');
  });

  it('treats malformed encrypted text frames as decrypt failures instead of throwing', () => {
    const serverKeypair = generateKeyPair();
    const mobileKeypair = generateKeyPair();
    const ws = createMockWebSocket();
    const onError = vi.fn();

    const channel = new RemoteE2EEChannel(ws, {
      serverSecretKey: serverKeypair.secretKey,
      validateToken: (token) => token === 'device-token',
      onReady: vi.fn(),
      onError,
    });

    channel.handleRawMessage(JSON.stringify({
      type: 'e2ee_hello',
      publicKeyB64: Buffer.from(mobileKeypair.publicKey).toString('base64'),
    }));

    expect(() => channel.handleRawMessage('{"type":"e2ee_hello"}')).not.toThrow();
    expect(onError).not.toHaveBeenCalled();

    for (let index = 0; index < 4; index += 1) {
      channel.handleRawMessage('{"type":"e2ee_hello"}');
    }

    expect(onError).toHaveBeenCalledWith(4003, 'Too many decryption failures');
  });
});

function createMockWebSocket(): WebSocket & {
  send: ReturnType<typeof vi.fn>;
  sent: unknown[];
  bufferedAmount: number;
} {
  const sent: unknown[] = [];
  const ws = {
    OPEN: 1,
    readyState: 1,
    bufferedAmount: 0,
    sent,
    send: vi.fn((payload: unknown) => {
      sent.push(payload);
    }),
  };
  return ws as unknown as WebSocket & {
    send: ReturnType<typeof vi.fn>;
    sent: unknown[];
    bufferedAmount: number;
  };
}
