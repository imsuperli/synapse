import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SSH_READY_TIMEOUT_MS } from '../../../shared/utils/sshDefaults';
import type { SSHSessionConfig } from '../../types/process';
import { buildSSHConnectionKey, SSHConnectionPool } from '../ssh/SSHConnectionPool';

function createSSHConfig(overrides: Partial<SSHSessionConfig> = {}): SSHSessionConfig {
  return {
    profileId: 'profile-1',
    host: '10.0.0.21',
    port: 22,
    user: 'root',
    authType: 'password',
    privateKeys: [],
    password: 'secret',
    keepaliveInterval: 30,
    keepaliveCountMax: 3,
    readyTimeout: null,
    verifyHostKeys: true,
    agentForward: false,
    reuseSession: true,
    forwardedPorts: [],
    ...overrides,
  };
}

describe('SSHConnectionPool', () => {
  it('reuses the same connection while matching reusable sessions are active', async () => {
    const connect = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    const firstConnection = {
      connect,
      close,
      attachServiceListener: vi.fn().mockReturnValue(vi.fn()),
      openForwardOut: vi.fn(),
      listPortForwards: vi.fn().mockReturnValue([]),
      addPortForward: vi.fn(),
      removePortForward: vi.fn(),
      isClosed: vi.fn().mockReturnValue(false),
    };
    const createConnection = vi.fn().mockReturnValue(firstConnection);
    const pool = new SSHConnectionPool({ createConnection });
    const config = createSSHConfig();

    const leaseA = await pool.acquire(config);
    const leaseB = await pool.acquire(config);

    expect(createConnection).toHaveBeenCalledTimes(1);
    expect(leaseA.connection).toBe(leaseB.connection);

    await leaseA.release();
    expect(close).not.toHaveBeenCalled();

    await leaseB.release();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('creates dedicated connections when reuseSession is disabled', async () => {
    const createConnection = vi.fn()
      .mockReturnValueOnce({
        connect: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        attachServiceListener: vi.fn().mockReturnValue(vi.fn()),
        openForwardOut: vi.fn(),
        listPortForwards: vi.fn().mockReturnValue([]),
        addPortForward: vi.fn(),
        removePortForward: vi.fn(),
        isClosed: vi.fn().mockReturnValue(false),
      })
      .mockReturnValueOnce({
        connect: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        attachServiceListener: vi.fn().mockReturnValue(vi.fn()),
        openForwardOut: vi.fn(),
        listPortForwards: vi.fn().mockReturnValue([]),
        addPortForward: vi.fn(),
        removePortForward: vi.fn(),
        isClosed: vi.fn().mockReturnValue(false),
      });
    const pool = new SSHConnectionPool({ createConnection });
    const config = createSSHConfig({ reuseSession: false });

    const leaseA = await pool.acquire(config);
    const leaseB = await pool.acquire(config);

    expect(createConnection).toHaveBeenCalledTimes(2);
    expect(leaseA.connection).not.toBe(leaseB.connection);
  });

  it('includes routing and verification settings in the reuse key', () => {
    const baseKey = buildSSHConnectionKey(createSSHConfig());
    const jumpKey = buildSSHConnectionKey(createSSHConfig({ jumpHostProfileId: 'jump-1' }));
    const proxyKey = buildSSHConnectionKey(createSSHConfig({ proxyCommand: 'nc %h %p' }));
    const relaxedVerifyKey = buildSSHConnectionKey(createSSHConfig({ verifyHostKeys: false }));
    const customLocaleKey = buildSSHConnectionKey(createSSHConfig({
      remoteLocaleMode: 'custom',
      remoteLocale: 'zh_CN.UTF-8',
    }));
    const algorithmKey = buildSSHConnectionKey(createSSHConfig({
      algorithms: {
        kex: ['diffie-hellman-group14-sha256'],
        hostKey: ['ssh-ed25519'],
        cipher: ['aes128-gcm@openssh.com'],
        hmac: ['hmac-sha2-256'],
        compression: ['none'],
      },
    }));

    expect(jumpKey).not.toBe(baseKey);
    expect(proxyKey).not.toBe(baseKey);
    expect(relaxedVerifyKey).not.toBe(baseKey);
    expect(customLocaleKey).not.toBe(baseKey);
    expect(algorithmKey).not.toBe(baseKey);
  });

  it('treats an omitted ready timeout as the default timeout in the reuse key', () => {
    expect(buildSSHConnectionKey(createSSHConfig({ readyTimeout: null })))
      .toBe(buildSSHConnectionKey(createSSHConfig({ readyTimeout: DEFAULT_SSH_READY_TIMEOUT_MS })));
    expect(buildSSHConnectionKey(createSSHConfig({ readyTimeout: DEFAULT_SSH_READY_TIMEOUT_MS + 1 })))
      .not.toBe(buildSSHConnectionKey(createSSHConfig({ readyTimeout: null })));
  });
});
