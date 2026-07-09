import { describe, expect, it } from 'vitest';
import {
  decrypt,
  deriveSharedKey,
  encrypt,
  generateKeyPair,
  publicKeyFromBase64,
  publicKeyToBase64,
} from '../e2ee-crypto';

describe('remote e2ee crypto', () => {
  it('encrypts and decrypts with derived shared keys', () => {
    const desktop = generateKeyPair();
    const mobile = generateKeyPair();
    const desktopShared = deriveSharedKey(desktop.secretKey, mobile.publicKey);
    const mobileShared = deriveSharedKey(mobile.secretKey, desktop.publicKey);

    const encrypted = encrypt('hello terminal', mobileShared);

    expect(decrypt(encrypted, desktopShared)).toBe('hello terminal');
  });

  it('validates base64 public key length', () => {
    const key = generateKeyPair().publicKey;
    expect(publicKeyFromBase64(publicKeyToBase64(key))).toEqual(key);
    expect(() => publicKeyFromBase64(Buffer.alloc(31).toString('base64'))).toThrow(
      'Invalid public key',
    );
  });
});
