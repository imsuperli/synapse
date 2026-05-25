import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SSHProfileStore } from '../ssh/SSHProfileStore';

describe('SSHProfileStore', () => {
  let tempDir: string;
  let filePath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'synapse-ssh-profiles-'));
    filePath = path.join(tempDir, 'ssh-profiles.json');
  });

  afterEach(async () => {
    await fs.remove(tempDir);
  });

  it('creates profiles with normalized defaults and persists them', async () => {
    const store = new SSHProfileStore({
      filePath,
      now: () => '2026-03-22T10:00:00.000Z',
    });

    const profile = await store.create({
      name: '  prod-web-01  ',
      host: ' 10.0.0.21 ',
      port: 22,
      user: ' root ',
      auth: 'password',
      privateKeys: [],
      keepaliveInterval: undefined as never,
      keepaliveCountMax: undefined as never,
      readyTimeout: null,
      verifyHostKeys: undefined as never,
      x11: undefined as never,
      skipBanner: undefined as never,
      agentForward: undefined as never,
      warnOnClose: undefined as never,
      reuseSession: undefined as never,
      forwardedPorts: [],
      tags: ['prod', 'prod', ' cn-shanghai '],
      notes: '  web server  ',
    });

    expect(profile.name).toBe('prod-web-01');
    expect(profile.host).toBe('10.0.0.21');
    expect(profile.user).toBe('root');
    expect(profile.keepaliveInterval).toBe(30);
    expect(profile.keepaliveCountMax).toBe(3);
    expect(profile.verifyHostKeys).toBe(true);
    expect(profile.warnOnClose).toBe(true);
    expect(profile.reuseSession).toBe(true);
    expect(profile.remoteLocaleMode).toBeUndefined();
    expect(profile.remoteLocale).toBeUndefined();
    expect(profile.algorithms?.kex.length).toBeGreaterThan(0);
    expect(profile.algorithms?.hostKey.length).toBeGreaterThan(0);
    expect(profile.tags).toEqual(['prod', 'cn-shanghai']);
    expect(profile.notes).toBe('web server');

    const persisted = await fs.readJson(filePath);
    expect(persisted.version).toBe(1);
    expect(persisted.profiles).toHaveLength(1);
    expect(persisted.profiles[0].name).toBe('prod-web-01');
  });

  it('updates profiles without losing createdAt and normalizes optional fields', async () => {
    const store = new SSHProfileStore({
      filePath,
      now: () => '2026-03-22T10:00:00.000Z',
    });

    const profile = await store.create({
      name: 'prod-web-01',
      host: '10.0.0.21',
      port: 22,
      user: 'root',
      auth: 'publicKey',
      privateKeys: ['/keys/id_ed25519'],
      keepaliveInterval: 15,
      keepaliveCountMax: 2,
      readyTimeout: 10000,
      verifyHostKeys: true,
      x11: false,
      skipBanner: false,
      routingMode: 'proxyCommand',
      proxyCommand: 'ssh -W %h:%p old-jump',
      agentForward: false,
      warnOnClose: true,
      reuseSession: true,
      forwardedPorts: [],
      tags: [],
    });

    const updatedStore = new SSHProfileStore({
      filePath,
      now: () => '2026-03-22T11:00:00.000Z',
    });

    const updated = await updatedStore.update(profile.id, {
      notes: '  rotated keys  ',
      privateKeys: ['/keys/id_ed25519', '/keys/id_rsa'],
      proxyCommand: '  ssh -W %h:%p jump ',
      remoteLocaleMode: 'custom',
      remoteLocale: ' zh_CN.UTF-8 ',
      algorithms: {
        kex: ['diffie-hellman-group14-sha256'],
        hostKey: ['ssh-ed25519'],
        cipher: ['aes128-gcm@openssh.com'],
        hmac: ['hmac-sha2-256'],
        compression: ['none'],
      },
    });

    expect(updated.createdAt).toBe('2026-03-22T10:00:00.000Z');
    expect(updated.updatedAt).toBe('2026-03-22T11:00:00.000Z');
    expect(updated.privateKeys).toEqual(['/keys/id_ed25519', '/keys/id_rsa']);
    expect(updated.notes).toBe('rotated keys');
    expect(updated.routingMode).toBe('proxyCommand');
    expect(updated.proxyCommand).toBe('ssh -W %h:%p jump');
    expect(updated.remoteLocaleMode).toBe('custom');
    expect(updated.remoteLocale).toBe('zh_CN.UTF-8');
    expect(updated.algorithms).toEqual({
      kex: ['diffie-hellman-group14-sha256'],
      hostKey: ['ssh-ed25519'],
      cipher: ['aes128-gcm@openssh.com'],
      hmac: ['hmac-sha2-256'],
      compression: ['none'],
    });
  });

  it('defaults missing routingMode to direct while preserving inactive routing details', async () => {
    const store = new SSHProfileStore({
      filePath,
      now: () => '2026-03-22T10:00:00.000Z',
    });

    const profile = await store.create({
      name: 'prod-web-01',
      host: '10.0.0.21',
      port: 22,
      user: 'root',
      auth: 'password',
      privateKeys: [],
      keepaliveInterval: 15,
      keepaliveCountMax: 2,
      readyTimeout: null,
      verifyHostKeys: true,
      x11: false,
      skipBanner: false,
      jumpHostProfileId: 'jump-1',
      proxyCommand: 'ssh -W %h:%p bastion',
      agentForward: false,
      warnOnClose: true,
      reuseSession: true,
      forwardedPorts: [],
      tags: [],
    });

    expect(profile.routingMode).toBeUndefined();
    expect(profile.jumpHostProfileId).toBe('jump-1');
    expect(profile.proxyCommand).toBe('ssh -W %h:%p bastion');
  });

  it('keeps saved route details when switching the active route back to direct', async () => {
    const store = new SSHProfileStore({
      filePath,
      now: () => '2026-03-22T10:00:00.000Z',
    });

    const profile = await store.create({
      name: 'prod-web-01',
      host: '10.0.0.21',
      port: 22,
      user: 'root',
      auth: 'password',
      privateKeys: [],
      keepaliveInterval: 15,
      keepaliveCountMax: 2,
      readyTimeout: null,
      verifyHostKeys: true,
      x11: false,
      skipBanner: false,
      routingMode: 'jumpHost',
      jumpHostProfileId: 'jump-1',
      proxyCommand: 'ssh -W %h:%p bastion',
      agentForward: false,
      warnOnClose: true,
      reuseSession: true,
      forwardedPorts: [],
      tags: [],
    });

    const updated = await store.update(profile.id, {
      routingMode: 'direct',
    });

    expect(updated.routingMode).toBeUndefined();
    expect(updated.jumpHostProfileId).toBe('jump-1');
    expect(updated.proxyCommand).toBe('ssh -W %h:%p bastion');
  });

  it('rejects active routing modes when the required route details are missing', async () => {
    const store = new SSHProfileStore({
      filePath,
      now: () => '2026-03-22T10:00:00.000Z',
    });
    const baseInput = {
      name: 'prod-web-01',
      host: '10.0.0.21',
      port: 22,
      user: 'root',
      auth: 'password' as const,
      privateKeys: [],
      keepaliveInterval: 15,
      keepaliveCountMax: 2,
      readyTimeout: null,
      verifyHostKeys: true,
      x11: false,
      skipBanner: false,
      agentForward: false,
      warnOnClose: true,
      reuseSession: true,
      forwardedPorts: [],
      tags: [],
    };

    await expect(store.create({
      ...baseInput,
      routingMode: 'jumpHost',
    })).rejects.toThrow('requires a jump host profile');
    await expect(store.create({
      ...baseInput,
      routingMode: 'proxyCommand',
    })).rejects.toThrow('requires a proxy command');
    await expect(store.create({
      ...baseInput,
      routingMode: 'socks',
    })).rejects.toThrow('requires a proxy host');
    await expect(store.create({
      ...baseInput,
      routingMode: 'http',
    })).rejects.toThrow('requires a proxy host');
  });

  it('rejects invalid public key profiles without key paths', async () => {
    const store = new SSHProfileStore({ filePath });

    await expect(store.create({
      name: 'prod-web-01',
      host: '10.0.0.21',
      port: 22,
      user: 'root',
      auth: 'publicKey',
      privateKeys: [],
      keepaliveInterval: 15,
      keepaliveCountMax: 2,
      readyTimeout: null,
      verifyHostKeys: true,
      x11: false,
      skipBanner: false,
      agentForward: false,
      warnOnClose: true,
      reuseSession: true,
      forwardedPorts: [],
      tags: [],
    })).rejects.toThrow('requires at least one private key path');
  });

  it('removes persisted profiles', async () => {
    const store = new SSHProfileStore({ filePath });
    const profile = await store.create({
      name: 'prod-web-01',
      host: '10.0.0.21',
      port: 22,
      user: 'root',
      auth: 'password',
      privateKeys: [],
      keepaliveInterval: 15,
      keepaliveCountMax: 2,
      readyTimeout: null,
      verifyHostKeys: true,
      x11: false,
      skipBanner: false,
      agentForward: false,
      warnOnClose: true,
      reuseSession: true,
      forwardedPorts: [],
      tags: [],
    });

    await store.remove(profile.id);

    expect(await store.list()).toEqual([]);
    const persisted = await fs.readJson(filePath);
    expect(persisted.profiles).toEqual([]);
  });
});
