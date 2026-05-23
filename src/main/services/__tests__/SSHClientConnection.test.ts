import { EventEmitter } from 'events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SSH_AUTH_FAILED_ERROR_CODE } from '../../../shared/types/electron-api';
import { DEFAULT_SSH_READY_TIMEOUT_MS } from '../../../shared/utils/sshDefaults';
import type { SSHSessionConfig } from '../../types/process';
import { SSHClientConnection } from '../ssh/SSHClientConnection';

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

describe('SSHClientConnection', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('opens shells with terminal environment hints for remote prompt compatibility', async () => {
    vi.stubEnv('LANG', 'zh_CN.UTF-8');
    vi.stubEnv('LC_CTYPE', '');
    vi.stubEnv('LC_ALL', '');

    const stream = { id: 'shell-stream' };
    const shell = vi.fn((
      _window: unknown,
      _options: { env?: Record<string, string> },
      callback: (error?: Error, stream?: unknown) => void,
    ) => {
      callback(undefined, stream as any);
      return {};
    });
    const connection = new SSHClientConnection(createSSHConfig());

    (connection as any).ready = true;
    (connection as any).client = { shell };

    await expect(connection.openShell({
      cols: 140,
      rows: 40,
      x11: true,
    })).resolves.toBe(stream);

    expect(shell).toHaveBeenCalledWith(
      expect.objectContaining({
        term: 'xterm-256color',
        cols: 140,
        rows: 40,
        modes: {
          ECHO: 1,
        },
      }),
      expect.objectContaining({
        env: expect.objectContaining({
          COLORTERM: 'truecolor',
          TERM_PROGRAM: 'Synapse',
          LANG: 'zh_CN.UTF-8',
          LC_CTYPE: 'zh_CN.UTF-8',
          LC_ALL: 'zh_CN.UTF-8',
        }),
        x11: expect.objectContaining({
          protocol: 'MIT-MAGIC-COOKIE-1',
        }),
      }),
      expect.any(Function),
    );

    const shellOptions = shell.mock.calls[0]?.[1];
    expect(shellOptions?.env).not.toHaveProperty('GIT_PAGER');
    expect(shellOptions?.env).not.toHaveProperty('LESS');
    expect(shellOptions?.env).not.toHaveProperty('GIT_CONFIG_COUNT');
    expect(shellOptions?.env).not.toHaveProperty('GIT_CONFIG_KEY_0');
    expect(shellOptions?.env).not.toHaveProperty('GIT_CONFIG_VALUE_0');
  });

  it('falls back to en_US.UTF-8 for ssh shells when no locale env is available', async () => {
    vi.stubEnv('LANG', '');
    vi.stubEnv('LC_CTYPE', '');
    vi.stubEnv('LC_ALL', '');

    const stream = { id: 'shell-stream' };
    const shell = vi.fn((
      _window: unknown,
      _options: { env?: Record<string, string> },
      callback: (error?: Error, stream?: unknown) => void,
    ) => {
      callback(undefined, stream as any);
      return {};
    });
    const connection = new SSHClientConnection(createSSHConfig());

    (connection as any).ready = true;
    (connection as any).client = { shell };

    await expect(connection.openShell({
      cols: 100,
      rows: 32,
    })).resolves.toBe(stream);

    expect(shell).toHaveBeenCalledWith(
      expect.objectContaining({
        modes: {
          ECHO: 1,
        },
      }),
      expect.objectContaining({
        env: expect.objectContaining({
          LANG: 'en_US.UTF-8',
          LC_CTYPE: 'en_US.UTF-8',
          LC_ALL: 'en_US.UTF-8',
        }),
      }),
      expect.any(Function),
    );
  });

  it('prefers LC_ALL when building shell locale hints', async () => {
    vi.stubEnv('LANG', 'zh_CN.UTF-8');
    vi.stubEnv('LC_CTYPE', 'zh_CN.GBK');
    vi.stubEnv('LC_ALL', 'ja_JP.UTF-8');

    const stream = { id: 'shell-stream' };
    const shell = vi.fn((
      _window: unknown,
      _options: { env?: Record<string, string> },
      callback: (error?: Error, stream?: unknown) => void,
    ) => {
      callback(undefined, stream as any);
      return {};
    });
    const connection = new SSHClientConnection(createSSHConfig());

    (connection as any).ready = true;
    (connection as any).client = { shell };

    await connection.openShell({
      cols: 100,
      rows: 32,
    });

    expect(shell).toHaveBeenCalledWith(
      expect.objectContaining({
        modes: {
          ECHO: 1,
        },
      }),
      expect.objectContaining({
        env: expect.objectContaining({
          LANG: 'ja_JP.UTF-8',
          LC_CTYPE: 'ja_JP.UTF-8',
          LC_ALL: 'ja_JP.UTF-8',
        }),
      }),
      expect.any(Function),
    );
  });

  it('pauses the handshake timeout while waiting for host-key confirmation', async () => {
    vi.useFakeTimers();

    const promptDeferred = createDeferred<{ trusted: boolean; persist: boolean }>();
    const fakeClient = new FakeSSHClient();
    const connection = new SSHClientConnection(
      createSSHConfig({ readyTimeout: 50 }),
      {
        hostKeyPromptService: {
          confirm: vi.fn().mockReturnValue(promptDeferred.promise),
        },
      },
    );

    (connection as any).client = fakeClient;

    const connectPromise = connection.connect();
    let settled = false;
    void connectPromise.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await flushPromises();
    const connectConfig = fakeClient.lastConnectConfig!;
    const verifierCallback = vi.fn();

    connectConfig.hostVerifier?.(Buffer.from('host-key'), verifierCallback);
    await vi.advanceTimersByTimeAsync(80);

    expect(settled).toBe(false);

    promptDeferred.resolve({ trusted: true, persist: false });
    await vi.advanceTimersByTimeAsync(0);
    fakeClient.emit('ready');

    await expect(connectPromise).resolves.toBeUndefined();
    expect(verifierCallback).toHaveBeenCalledWith(true);
  });

  it('can disable shell echo during remote initialization', async () => {
    const stream = { id: 'shell-stream' };
    const shell = vi.fn((
      _window: unknown,
      _options: { env?: Record<string, string> },
      callback: (error?: Error, stream?: unknown) => void,
    ) => {
      callback(undefined, stream as any);
      return {};
    });
    const connection = new SSHClientConnection(createSSHConfig());

    (connection as any).ready = true;
    (connection as any).client = { shell };

    await expect(connection.openShell({
      cols: 80,
      rows: 24,
      echo: false,
    })).resolves.toBe(stream);

    expect(shell).toHaveBeenCalledWith(
      expect.objectContaining({
        modes: {
          ECHO: 0,
        },
      }),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it('rejects when the SSH handshake exceeds the configured timeout', async () => {
    vi.useFakeTimers();

    const fakeClient = new FakeSSHClient();
    const connection = new SSHClientConnection(createSSHConfig({ readyTimeout: 50 }));
    (connection as any).client = fakeClient;

    const connectPromise = connection.connect();
    const rejectedPromise = connectPromise.then(
      () => null,
      (error) => error as Error,
    );
    await flushPromises();

    await vi.advanceTimersByTimeAsync(60);

    await expect(rejectedPromise).resolves.toBeInstanceOf(Error);
    await expect(rejectedPromise).resolves.toMatchObject({
      message: 'Timed out while waiting for handshake',
    });
    expect(fakeClient.end).toHaveBeenCalledTimes(1);
    expect(fakeClient.destroy).toHaveBeenCalledTimes(1);
  });

  it('uses the default handshake timeout when the profile does not override it', async () => {
    vi.useFakeTimers();

    const fakeClient = new FakeSSHClient();
    const connection = new SSHClientConnection(createSSHConfig({ readyTimeout: null }));
    (connection as any).client = fakeClient;

    const connectPromise = connection.connect();
    const rejectedPromise = connectPromise.then(
      () => null,
      (error) => error as Error,
    );
    await flushPromises();

    await vi.advanceTimersByTimeAsync(DEFAULT_SSH_READY_TIMEOUT_MS - 1);
    expect(fakeClient.destroy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);

    await expect(rejectedPromise).resolves.toMatchObject({
      message: 'Timed out while waiting for handshake',
    });
    expect(fakeClient.end).toHaveBeenCalledTimes(1);
    expect(fakeClient.destroy).toHaveBeenCalledTimes(1);
  });

  it('normalizes ssh2 authentication failures into a coded SSH auth error', async () => {
    const fakeClient = new FakeSSHClient();
    const connection = new SSHClientConnection(createSSHConfig());
    (connection as any).client = fakeClient;

    const connectPromise = connection.connect();
    await flushPromises();
    fakeClient.emit('error', new Error('All configured authentication methods failed'));

    await expect(connectPromise).rejects.toMatchObject({
      message: 'SSH authentication failed. The password or interactive secret was rejected by the server.',
      ipcErrorCode: SSH_AUTH_FAILED_ERROR_CODE,
    });
  });

  it('streams exec stdout and stderr before resolving the final result', async () => {
    vi.stubEnv('LANG', '');
    vi.stubEnv('LC_CTYPE', '');
    vi.stubEnv('LC_ALL', '');

    const channel = new EventEmitter() as EventEmitter & {
      stderr?: EventEmitter;
      end: ReturnType<typeof vi.fn>;
      signal: ReturnType<typeof vi.fn>;
      close?: ReturnType<typeof vi.fn>;
    };
    channel.stderr = new EventEmitter();
    channel.end = vi.fn();
    channel.signal = vi.fn();
    channel.close = vi.fn();

    const exec = vi.fn((command: string, callback: (error?: Error, channel?: unknown) => void) => {
      expect(command).toContain("LANG='\\''en_US.UTF-8'\\'' LC_CTYPE='\\''en_US.UTF-8'\\'' LC_ALL='\\''en_US.UTF-8'\\''");
      expect(command).toContain('uname -a');
      callback(undefined, channel);
    });
    const connection = new SSHClientConnection(createSSHConfig());
    (connection as any).ready = true;
    (connection as any).client = { exec };

    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    const handle = await connection.execCommandStream('uname -a', {
      onStdout: (chunk) => stdoutChunks.push(chunk),
      onStderr: (chunk) => stderrChunks.push(chunk),
    });

    channel.emit('data', Buffer.from('Linux'));
    channel.stderr?.emit('data', Buffer.from(' warning'));
    channel.emit('exit', 3);
    channel.emit('close');

    await expect(handle.result).resolves.toEqual({
      stdout: 'Linux',
      stderr: ' warning',
      exitCode: 3,
    });
    expect(stdoutChunks).toEqual(['Linux']);
    expect(stderrChunks).toEqual([' warning']);
  });

  it('uses a custom remote locale when provided by the ssh config', async () => {
    const channel = new EventEmitter() as EventEmitter & {
      stderr?: EventEmitter;
      end: ReturnType<typeof vi.fn>;
      signal: ReturnType<typeof vi.fn>;
      close?: ReturnType<typeof vi.fn>;
    };
    channel.stderr = new EventEmitter();
    channel.end = vi.fn();
    channel.signal = vi.fn();
    channel.close = vi.fn();

    const exec = vi.fn((command: string, callback: (error?: Error, channel?: unknown) => void) => {
      expect(command).toContain("LANG='\\''zh_CN.UTF-8'\\'' LC_CTYPE='\\''zh_CN.UTF-8'\\'' LC_ALL='\\''zh_CN.UTF-8'\\''");
      expect(command).toContain('printf test');
      callback(undefined, channel);
    });
    const connection = new SSHClientConnection(createSSHConfig({
      remoteLocaleMode: 'custom',
      remoteLocale: 'zh_CN.UTF-8',
    }));
    (connection as any).ready = true;
    (connection as any).client = { exec };

    const handle = await connection.execCommandStream('printf test');
    channel.emit('close');

    await expect(handle.result).resolves.toEqual({
      stdout: '',
      stderr: '',
      exitCode: 0,
    });
  });
});

class FakeSSHClient extends EventEmitter {
  lastConnectConfig: any;
  readonly end = vi.fn();
  readonly destroy = vi.fn();
  readonly setNoDelay = vi.fn();

  connect(config: any): void {
    this.lastConnectConfig = config;
  }
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return { promise, resolve, reject };
}

async function flushPromises(count = 4): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve();
  }
}
