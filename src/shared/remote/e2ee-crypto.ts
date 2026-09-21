// Adapted from Orca's MIT-licensed shared E2EE crypto helpers.
// Copyright (c) 2026 Lovecast Inc.
import nacl from 'tweetnacl';
import { base64ToBytes, bytesToBase64, bytesToUtf8, utf8ToBytes } from './encoding';

export function generateKeyPair(): nacl.BoxKeyPair {
  return nacl.box.keyPair();
}

export function deriveSharedKey(ourSecretKey: Uint8Array, peerPublicKey: Uint8Array): Uint8Array {
  return nacl.box.before(peerPublicKey, ourSecretKey);
}

export function publicKeyFromBase64(b64: string): Uint8Array {
  const key = base64ToBytes(b64);
  if (key.length !== 32) {
    throw new Error(`Invalid public key: expected 32 bytes, got ${key.length}`);
  }
  return key;
}

export function publicKeyToBase64(key: Uint8Array): string {
  if (key.length !== 32) {
    throw new Error(`Invalid public key: expected 32 bytes, got ${key.length}`);
  }
  return bytesToBase64(key);
}

export function encrypt(plaintext: string, sharedKey: Uint8Array): string {
  return bytesToBase64(encryptBytes(utf8ToBytes(plaintext), sharedKey));
}

export function decrypt(encrypted: string, sharedKey: Uint8Array): string | null {
  const bundle = base64ToBytes(encrypted);
  const plaintext = decryptBytes(bundle, sharedKey);
  return plaintext ? bytesToUtf8(plaintext) : null;
}

export function encryptBytes(
  plaintext: Uint8Array,
  sharedKey: Uint8Array,
): Uint8Array {
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const ciphertext = nacl.box.after(plaintext, nonce, sharedKey);
  const bundle = new Uint8Array(nonce.length + ciphertext.length);
  bundle.set(nonce);
  bundle.set(ciphertext, nonce.length);
  return bundle;
}

export function decryptBytes(bundle: Uint8Array, sharedKey: Uint8Array): Uint8Array | null {
  if (bundle.length < nacl.box.nonceLength + nacl.box.overheadLength) {
    return null;
  }
  const nonce = bundle.slice(0, nacl.box.nonceLength);
  const ciphertext = bundle.slice(nacl.box.nonceLength);
  return nacl.box.open.after(ciphertext, nonce, sharedKey) ?? null;
}
