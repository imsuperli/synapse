import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { randomBytes } from 'crypto';

const SECURE_FILE_MODE = 0o600;

export function hardenExistingSecureFile(filePath: string): void {
  if (!existsSync(filePath) || process.platform === 'win32') {
    return;
  }
  chmodSync(filePath, SECURE_FILE_MODE);
}

export function readJsonFileIfPresent<T>(filePath: string, maxBytes: number): T | null {
  if (!existsSync(filePath)) {
    return null;
  }
  hardenExistingSecureFile(filePath);
  if (statSync(filePath).size > maxBytes) {
    throw new Error(`Secure file is too large: ${filePath}`);
  }
  return JSON.parse(readFileSync(filePath, 'utf-8')) as T;
}

export function writeSecureJsonFile(filePath: string, data: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(data, null, 2)}\n`, {
    encoding: 'utf-8',
    mode: SECURE_FILE_MODE,
  });
  if (process.platform !== 'win32') {
    chmodSync(tempPath, SECURE_FILE_MODE);
  }
  renameSync(tempPath, filePath);
  hardenExistingSecureFile(filePath);
}
