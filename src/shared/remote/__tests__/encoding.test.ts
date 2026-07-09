import { describe, expect, it } from 'vitest';
import {
  base64ToBytes,
  base64UrlToBytes,
  bytesToBase64,
  bytesToBase64Url,
  bytesToUtf8,
  utf8ToBytes,
} from '../encoding';

describe('remote encoding helpers', () => {
  it('round trips utf8 content without Node Buffer', () => {
    const value = 'Synapse remote 控制';

    expect(bytesToUtf8(utf8ToBytes(value))).toBe(value);
  });

  it('round trips base64 bytes', () => {
    const bytes = new Uint8Array([0, 1, 2, 253, 254, 255]);
    const encoded = bytesToBase64(bytes);

    expect(encoded).toBe('AAEC/f7/');
    expect(base64ToBytes(encoded)).toEqual(bytes);
  });

  it('round trips base64url bytes without padding', () => {
    const bytes = utf8ToBytes('pairing payload');
    const encoded = bytesToBase64Url(bytes);

    expect(encoded).not.toContain('=');
    expect(encoded).not.toContain('+');
    expect(encoded).not.toContain('/');
    expect(bytesToUtf8(base64UrlToBytes(encoded))).toBe('pairing payload');
  });
});
