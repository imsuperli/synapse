import { describe, expect, it } from 'vitest';
import {
  createPairingOfferPayload,
  decodePairingOffer,
  encodePairingOffer,
  parsePairingCode,
} from '../pairing';

describe('remote pairing', () => {
  it('encodes and decodes synapse pairing URLs', () => {
    const offer = createPairingOfferPayload({
      endpoint: 'ws://192.168.1.20:6868',
      deviceToken: 'token-1',
      publicKeyB64: Buffer.alloc(32, 1).toString('base64'),
      scope: 'mobile.control',
      hostName: 'Synapse',
    });

    const url = encodePairingOffer(offer);

    expect(url).toMatch(/^synapse:\/\/pair\?code=/);
    expect(decodePairingOffer(url)).toEqual(offer);
  });

  it('parses a bare pairing code as a paste fallback', () => {
    const offer = createPairingOfferPayload({
      endpoint: 'wss://remote.example.com',
      deviceToken: 'token-2',
      publicKeyB64: Buffer.alloc(32, 2).toString('base64'),
    });
    const url = encodePairingOffer(offer);
    const code = new URL(url).searchParams.get('code');

    expect(code).toBeTruthy();
    expect(parsePairingCode(code!)).toEqual(offer);
  });

  it('encodes relay pairing fields together', () => {
    const offer = createPairingOfferPayload({
      endpoint: 'ws://127.0.0.1:6868',
      deviceToken: 'token-relay',
      publicKeyB64: Buffer.alloc(32, 4).toString('base64'),
      relayEndpoint: 'wss://relay.example.com/v1/relay',
      relaySessionId: 'relay-session-1',
      relayClientToken: 'relay-client-token',
    });

    expect(decodePairingOffer(encodePairingOffer(offer))).toMatchObject({
      relayEndpoint: 'wss://relay.example.com/v1/relay',
      relaySessionId: 'relay-session-1',
      relayClientToken: 'relay-client-token',
    });
  });

  it('rejects partial relay pairing fields', () => {
    expect(() =>
      createPairingOfferPayload({
        endpoint: 'ws://127.0.0.1:6868',
        deviceToken: 'token-relay',
        publicKeyB64: Buffer.alloc(32, 5).toString('base64'),
        relayEndpoint: 'wss://relay.example.com/v1/relay',
      }),
    ).toThrow(/Relay pairing fields/);
  });

  it('rejects Orca pairing URLs', () => {
    expect(parsePairingCode('orca://pair?code=abc')).toBeNull();
  });

  it('rejects runtime-level scopes in mobile pairing payloads', () => {
    expect(() =>
      createPairingOfferPayload({
        endpoint: 'ws://192.168.1.20:6868',
        deviceToken: 'token-3',
        publicKeyB64: Buffer.alloc(32, 3).toString('base64'),
        scope: 'runtime.full' as never,
      }),
    ).toThrow();
  });
});
