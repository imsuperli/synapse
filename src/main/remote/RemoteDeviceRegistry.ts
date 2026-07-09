import { randomBytes, randomUUID } from 'crypto';
import { join } from 'path';
import type { RemoteDeviceScope } from '../../shared/remote/methods';
import { readJsonFileIfPresent, writeSecureJsonFile } from './RemoteSecureFile';

export const REMOTE_DEVICE_REGISTRY_FILENAME = 'synapse-remote-devices.json';
export const DEFAULT_PENDING_PAIRING_TTL_MS = 10 * 60 * 1000;

const MAX_REGISTRY_FILE_BYTES = 512 * 1024;

export type RemoteDeviceEntry = {
  deviceId: string;
  name: string;
  token: string;
  scope: RemoteDeviceScope;
  pairedAt: number;
  lastSeenAt: number;
  pendingExpiresAt: number | null;
};

type RemoteDeviceRegistryOptions = {
  pendingPairingTtlMs?: number;
  now?: () => number;
};

export class RemoteDeviceRegistry {
  private readonly registryPath: string;
  private readonly pendingPairingTtlMs: number;
  private readonly now: () => number;
  private devices: RemoteDeviceEntry[] = [];

  constructor(userDataPath: string, options: RemoteDeviceRegistryOptions = {}) {
    this.registryPath = join(userDataPath, REMOTE_DEVICE_REGISTRY_FILENAME);
    this.pendingPairingTtlMs = options.pendingPairingTtlMs ?? DEFAULT_PENDING_PAIRING_TTL_MS;
    this.now = options.now ?? (() => Date.now());
    this.load();
  }

  addPendingDevice(name: string, scope: RemoteDeviceScope = 'mobile.control'): RemoteDeviceEntry {
    this.removeExpiredPendingDevices();
    const createdAt = this.now();
    const entry: RemoteDeviceEntry = {
      deviceId: randomUUID(),
      name,
      token: randomBytes(24).toString('hex'),
      scope,
      pairedAt: createdAt,
      lastSeenAt: 0,
      pendingExpiresAt: createdAt + this.pendingPairingTtlMs,
    };
    this.devices.push(entry);
    this.save();
    return entry;
  }

  getOrCreatePendingDevice(
    name: string,
    scope: RemoteDeviceScope = 'mobile.control',
  ): RemoteDeviceEntry {
    this.removeExpiredPendingDevices();
    const existing = this.devices.find(
      (device) => device.lastSeenAt === 0 && device.scope === scope && !this.isExpired(device),
    );
    return existing ?? this.addPendingDevice(name, scope);
  }

  rotatePendingDevice(name: string, scope: RemoteDeviceScope = 'mobile.control'): RemoteDeviceEntry {
    this.devices = this.devices.filter(
      (device) => device.lastSeenAt !== 0 || device.scope !== scope,
    );
    return this.addPendingDevice(name, scope);
  }

  validateToken(token: string): RemoteDeviceEntry | null {
    this.removeExpiredPendingDevices();
    return this.devices.find((device) => device.token === token) ?? null;
  }

  markPairingProbeSucceeded(deviceId: string): void {
    const device = this.devices.find((candidate) => candidate.deviceId === deviceId);
    if (!device) {
      return;
    }
    device.lastSeenAt = this.now();
    device.pendingExpiresAt = null;
    this.save();
  }

  updateLastSeen(deviceId: string): void {
    const device = this.devices.find((candidate) => candidate.deviceId === deviceId);
    if (!device) {
      return;
    }
    device.lastSeenAt = this.now();
    this.save();
  }

  removeDevice(deviceId: string): RemoteDeviceEntry | null {
    const before = this.devices.length;
    const removed = this.devices.find((device) => device.deviceId === deviceId) ?? null;
    this.devices = this.devices.filter((device) => device.deviceId !== deviceId);
    if (this.devices.length !== before) {
      this.save();
    }
    return removed;
  }

  getDevice(deviceId: string): RemoteDeviceEntry | null {
    this.removeExpiredPendingDevices();
    return this.devices.find((device) => device.deviceId === deviceId) ?? null;
  }

  listDevices(options: { includePending?: boolean } = {}): readonly RemoteDeviceEntry[] {
    this.removeExpiredPendingDevices();
    return options.includePending
      ? [...this.devices]
      : this.devices.filter((device) => device.lastSeenAt > 0);
  }

  private removeExpiredPendingDevices(): void {
    const before = this.devices.length;
    this.devices = this.devices.filter((device) => !this.isExpired(device));
    if (this.devices.length !== before) {
      this.save();
    }
  }

  private isExpired(device: RemoteDeviceEntry): boolean {
    return device.lastSeenAt === 0
      && device.pendingExpiresAt !== null
      && device.pendingExpiresAt <= this.now();
  }

  private load(): void {
    try {
      const parsed = readJsonFileIfPresent<RemoteDeviceEntry[]>(
        this.registryPath,
        MAX_REGISTRY_FILE_BYTES,
      );
      this.devices = Array.isArray(parsed)
        ? parsed.flatMap((device) => normalizeDevice(device))
        : [];
      this.removeExpiredPendingDevices();
    } catch {
      this.devices = [];
    }
  }

  private save(): void {
    writeSecureJsonFile(this.registryPath, this.devices);
  }
}

function normalizeDevice(device: RemoteDeviceEntry): RemoteDeviceEntry[] {
  if (!device || typeof device !== 'object') {
    return [];
  }
  if (!device.deviceId || !device.token || !isRemoteDeviceScope(device.scope)) {
    return [];
  }
  return [
    {
      deviceId: String(device.deviceId),
      name: typeof device.name === 'string' && device.name ? device.name : 'Mobile Device',
      token: String(device.token),
      scope: device.scope,
      pairedAt: Number.isFinite(device.pairedAt) ? device.pairedAt : Date.now(),
      lastSeenAt: Number.isFinite(device.lastSeenAt) ? device.lastSeenAt : 0,
      pendingExpiresAt:
        device.pendingExpiresAt === null || Number.isFinite(device.pendingExpiresAt)
          ? device.pendingExpiresAt
          : null,
    },
  ];
}

function isRemoteDeviceScope(value: unknown): value is RemoteDeviceScope {
  return (
    value === 'mobile.read'
    || value === 'mobile.control'
    || value === 'mobile.window-control'
    || value === 'mobile.admin'
  );
}
