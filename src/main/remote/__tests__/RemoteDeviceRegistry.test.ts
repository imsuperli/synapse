import { mkdtempSync, rmSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  REMOTE_DEVICE_REGISTRY_FILENAME,
  RemoteDeviceRegistry,
} from '../RemoteDeviceRegistry';

describe('RemoteDeviceRegistry', () => {
  let tempDir: string | null = null;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  function createRegistry(now: () => number, ttl = 600_000): RemoteDeviceRegistry {
    tempDir = mkdtempSync(join(tmpdir(), 'synapse-remote-registry-'));
    return new RemoteDeviceRegistry(tempDir, {
      now,
      pendingPairingTtlMs: ttl,
    });
  }

  it('coalesces pending devices for the same scope', () => {
    const registry = createRegistry(() => 1_000);

    const first = registry.getOrCreatePendingDevice('Phone');
    const second = registry.getOrCreatePendingDevice('Phone Again');

    expect(second.deviceId).toBe(first.deviceId);
    expect(registry.listDevices({ includePending: true })).toHaveLength(1);
  });

  it('rotates pending devices and invalidates old tokens', () => {
    const registry = createRegistry(() => 1_000);

    const first = registry.getOrCreatePendingDevice('Phone');
    const second = registry.rotatePendingDevice('Phone');

    expect(second.deviceId).not.toBe(first.deviceId);
    expect(registry.validateToken(first.token)).toBeNull();
    expect(registry.validateToken(second.token)?.deviceId).toBe(second.deviceId);
  });

  it('expires pending devices but keeps paired devices', () => {
    let now = 1_000;
    const registry = createRegistry(() => now, 100);

    const pending = registry.getOrCreatePendingDevice('Phone');
    now = 1_200;

    expect(registry.validateToken(pending.token)).toBeNull();

    const paired = registry.getOrCreatePendingDevice('Phone');
    registry.markPairingProbeSucceeded(paired.deviceId);
    now = 2_000;

    expect(registry.validateToken(paired.token)?.deviceId).toBe(paired.deviceId);
    expect(registry.listDevices()).toHaveLength(1);
  });

  it('writes registry files with owner-only mode on unix', () => {
    if (process.platform === 'win32') {
      return;
    }
    const registry = createRegistry(() => 1_000);

    registry.getOrCreatePendingDevice('Phone');

    const mode = statSync(join(tempDir!, REMOTE_DEVICE_REGISTRY_FILENAME)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('drops persisted devices with unknown scopes', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'synapse-remote-registry-'));
    writeFileSync(
      join(tempDir, REMOTE_DEVICE_REGISTRY_FILENAME),
      JSON.stringify([
        {
          deviceId: 'bad-device',
          name: 'Bad',
          token: 'bad-token',
          scope: 'runtime.full',
          pairedAt: 1,
          lastSeenAt: 1,
          pendingExpiresAt: null,
        },
        {
          deviceId: 'good-device',
          name: 'Good',
          token: 'good-token',
          scope: 'mobile.control',
          pairedAt: 1,
          lastSeenAt: 1,
          pendingExpiresAt: null,
        },
      ]),
    );

    const registry = new RemoteDeviceRegistry(tempDir);

    expect(registry.validateToken('bad-token')).toBeNull();
    expect(registry.validateToken('good-token')?.deviceId).toBe('good-device');
    expect(registry.listDevices()).toEqual([
      expect.objectContaining({ deviceId: 'good-device', scope: 'mobile.control' }),
    ]);
  });
});
