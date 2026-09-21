import { describe, expect, it } from 'vitest';
import {
  buildRelayClientUrl,
  buildRelayHostUrl,
  normalizeRelayEndpoint,
} from '../relay';

describe('remote relay URL helpers', () => {
  it('normalizes relay endpoints to the default path', () => {
    expect(normalizeRelayEndpoint('wss://relay.example.com')).toBe(
      'wss://relay.example.com/v1/relay',
    );
    expect(normalizeRelayEndpoint('ws://127.0.0.1:8787/custom/')).toBe(
      'ws://127.0.0.1:8787/custom',
    );
  });

  it('builds host and client relay URLs without mutating the base endpoint', () => {
    expect(buildRelayHostUrl('wss://relay.example.com', {
      sessionId: 'session-1',
      hostToken: 'host-token',
      clientTokenHash: 'client-token-hash',
      ttlSeconds: 60,
    })).toBe(
      'wss://relay.example.com/v1/relay?role=host&sessionId=session-1&hostToken=host-token&clientTokenHash=client-token-hash&ttlSeconds=60',
    );

    expect(buildRelayClientUrl('wss://relay.example.com/v1/relay', {
      sessionId: 'session-1',
      clientToken: 'client-token',
    })).toBe(
      'wss://relay.example.com/v1/relay?role=client&sessionId=session-1&clientToken=client-token',
    );
  });

  it('rejects endpoints that would hide state in query or fragments', () => {
    expect(() => normalizeRelayEndpoint('https://relay.example.com')).toThrow(/ws:\/\/ or wss:\/\//);
    expect(() => normalizeRelayEndpoint('wss://relay.example.com/v1/relay?x=1')).toThrow(
      /query parameters/,
    );
  });
});
