import { join } from 'path';
import { generateKeyPair, publicKeyToBase64 } from '../../shared/remote/e2ee-crypto';
import { readJsonFileIfPresent, writeSecureJsonFile } from './RemoteSecureFile';

export const REMOTE_E2EE_KEYPAIR_FILENAME = 'synapse-remote-e2ee-keypair.json';

const KEYPAIR_VERSION = 1;
const MAX_KEYPAIR_FILE_BYTES = 8 * 1024;

type KeypairFile = {
  v: number;
  publicKeyB64: string;
  secretKeyB64: string;
};

export type RemoteE2EEKeypair = {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
  publicKeyB64: string;
};

export function loadOrCreateRemoteKeypair(userDataPath: string): RemoteE2EEKeypair {
  const filePath = join(userDataPath, REMOTE_E2EE_KEYPAIR_FILENAME);
  try {
    const raw = readJsonFileIfPresent<KeypairFile>(filePath, MAX_KEYPAIR_FILE_BYTES);
    if (raw?.v === KEYPAIR_VERSION && raw.publicKeyB64 && raw.secretKeyB64) {
      const publicKey = Uint8Array.from(Buffer.from(raw.publicKeyB64, 'base64'));
      const secretKey = Uint8Array.from(Buffer.from(raw.secretKeyB64, 'base64'));
      if (publicKey.length === 32 && secretKey.length === 32) {
        return { publicKey, secretKey, publicKeyB64: raw.publicKeyB64 };
      }
    }
  } catch {
    // Corrupt key material is replaced below.
  }

  const keypair = generateKeyPair();
  const publicKeyB64 = publicKeyToBase64(keypair.publicKey);
  const data: KeypairFile = {
    v: KEYPAIR_VERSION,
    publicKeyB64,
    secretKeyB64: Buffer.from(keypair.secretKey).toString('base64'),
  };
  writeSecureJsonFile(filePath, data);
  return {
    publicKey: keypair.publicKey,
    secretKey: keypair.secretKey,
    publicKeyB64,
  };
}
