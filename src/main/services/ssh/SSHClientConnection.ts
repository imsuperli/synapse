import net from 'net';
import fs from 'fs/promises';
import { createHash } from 'crypto';
import { Client, utils } from 'ssh2';
import type { ClientChannel, ConnectConfig, SFTPWrapper } from 'ssh2';
import type {
  ActiveSSHPortForward,
  ForwardedPortConfig,
  KnownHostEntry,
  SSHAuthType,
  SSHPortForwardSource,
  SSHSftpDirectoryListing,
  SSHSessionMetrics,
} from '../../../shared/types/ssh';
import { SSH_AUTH_FAILED_ERROR_CODE } from '../../../shared/types/electron-api';
import { resolveSSHReadyTimeoutMs } from '../../../shared/utils/sshDefaults';
import type {
  SSHExecCommandCallbacks,
  SSHExecCommandHandle,
  SSHExecCommandResult,
  SSHSessionConfig,
} from '../../types/process';
import type { ISSHKnownHostsStore } from './SSHKnownHostsStore';
import type {
  ISSHHostKeyPromptService,
  SSHHostKeyPromptDecision,
} from './SSHHostKeyPromptService';
import type { ISSHConnectionPool, SSHConnectionPoolLease } from './SSHConnectionPool';
import { ActivePortForwardListener, startPortForwardListener } from './SSHPortForwarding';
import {
  createHttpProxySocket,
  createProxyCommandSocket,
  createSocksProxySocket,
} from './SSHTransportSockets';
import { resolveSSHAlgorithmPreferences } from './SSHAlgorithmCatalog';
import {
  buildSSHLocaleEnvironment,
  wrapExecCommandWithSSHLocale,
} from './SSHLocale';
import { SSHSftpSession } from './SSHSftpSession';
import { connectToX11Display, describeX11DisplaySpec } from './X11Socket';

export interface SSHShellOpenOptions {
  cols: number;
  rows: number;
  x11?: boolean;
  echo?: boolean;
}

export interface SSHForwardOutOptions {
  targetHost: string;
  targetPort: number;
  sourceHost?: string;
  sourcePort?: number;
}

export interface SSHClientConnectionDependencies {
  knownHostsStore?: ISSHKnownHostsStore | null;
  hostKeyPromptService?: ISSHHostKeyPromptService | null;
  connectionPool?: ISSHConnectionPool | null;
}

export interface ISSHConnection {
  connect(serviceListener?: (data: string) => void): Promise<void>;
  attachServiceListener(listener: (data: string) => void): () => void;
  openShell(options: SSHShellOpenOptions): Promise<ClientChannel>;
  openForwardOut(options: SSHForwardOutOptions): Promise<ClientChannel>;
  listPortForwards(): ActiveSSHPortForward[];
  addPortForward(config: ForwardedPortConfig): Promise<ActiveSSHPortForward>;
  removePortForward(forwardId: string): Promise<void>;
  listSftpDirectory(path?: string): Promise<SSHSftpDirectoryListing>;
  getSessionMetrics(path?: string): Promise<SSHSessionMetrics>;
  downloadSftpFile(remotePath: string, localPath: string): Promise<void>;
  uploadSftpFiles(remotePath: string, localPaths: string[]): Promise<number>;
  uploadSftpDirectory(remotePath: string, localDirectoryPath: string): Promise<number>;
  downloadSftpDirectory(remotePath: string, localPath: string): Promise<void>;
  createSftpDirectory(parentPath: string, name: string): Promise<string>;
  deleteSftpEntry(remotePath: string): Promise<void>;
  /** 在远程执行非交互式命令，返回 stdout；非零退出码会 reject */
  execCommand(command: string): Promise<string>;
  execCommandResult(command: string): Promise<SSHExecCommandResult>;
  execCommandStream(
    command: string,
    callbacks?: SSHExecCommandCallbacks,
  ): Promise<SSHExecCommandHandle>;
  close(): Promise<void>;
  isClosed(): boolean;
}

type ActivePortForwardState = {
  forward: ActiveSSHPortForward;
  listener?: ActivePortForwardListener;
  remoteBind?: {
    host: string;
    port: number;
  };
};

interface ConnectTimeoutController {
  pause(): void;
  resume(): void;
  dispose(): void;
}

class SSHAuthenticationError extends Error {
  readonly ipcErrorCode = SSH_AUTH_FAILED_ERROR_CODE;

  constructor(message: string) {
    super(message);
    this.name = 'SSHAuthenticationError';
  }
}

export class SSHClientConnection implements ISSHConnection {
  private readonly ssh: SSHSessionConfig;
  private readonly knownHostsStore: ISSHKnownHostsStore | null;
  private readonly hostKeyPromptService: ISSHHostKeyPromptService | null;
  private readonly connectionPool: ISSHConnectionPool | null;
  private readonly client: Client;
  private readonly serviceListeners = new Set<(data: string) => void>();
  private connectPromise: Promise<void> | null;
  private jumpHostLease: SSHConnectionPoolLease | null;
  private forwardedPortsConfigured: boolean;
  private readonly activePortForwards = new Map<string, ActivePortForwardState>();
  private readonly remotePortForwardKeys = new Map<string, string>();
  private portForwardMutationQueue: Promise<void>;
  private sftpWrapperPromise: Promise<SFTPWrapper> | null;
  private sftpSession: SSHSftpSession | null;
  private ready: boolean;
  private closed: boolean;
  private hostKeyVerificationError: Error | null;
  private connectTimeoutController: ConnectTimeoutController | null;

  constructor(ssh: SSHSessionConfig, dependencies: SSHClientConnectionDependencies = {}) {
    this.ssh = ssh;
    this.knownHostsStore = dependencies.knownHostsStore ?? null;
    this.hostKeyPromptService = dependencies.hostKeyPromptService ?? null;
    this.connectionPool = dependencies.connectionPool ?? null;
    this.client = new Client();
    this.connectPromise = null;
    this.jumpHostLease = null;
    this.forwardedPortsConfigured = false;
    this.portForwardMutationQueue = Promise.resolve();
    this.sftpWrapperPromise = null;
    this.sftpSession = null;
    this.ready = false;
    this.closed = false;
    this.hostKeyVerificationError = null;
    this.connectTimeoutController = null;
  }

  async connect(serviceListener?: (data: string) => void): Promise<void> {
    if (this.closed) {
      throw new Error(`SSH connection is already closed for ${this.ssh.user}@${this.ssh.host}`);
    }

    if (serviceListener) {
      this.attachServiceListener(serviceListener);
    }

    if (this.ready) {
      return;
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = this.performConnect();

    return this.connectPromise;
  }

  attachServiceListener(listener: (data: string) => void): () => void {
    this.serviceListeners.add(listener);

    return () => {
      this.serviceListeners.delete(listener);
    };
  }

  async openShell(options: SSHShellOpenOptions): Promise<ClientChannel> {
    await this.connect();

    const shellEnv = buildRemoteShellEnv(this.ssh);

    return new Promise<ClientChannel>((resolve, reject) => {
      this.client.shell(
        {
          term: 'xterm-256color',
          cols: Math.max(options.cols, 1),
          rows: Math.max(options.rows, 1),
          modes: {
            ECHO: options.echo === false ? 0 : 1,
          },
        },
        {
          ...(Object.keys(shellEnv).length > 0 ? { env: shellEnv } : {}),
          ...(options.x11 ? {
            x11: {
              single: false,
              protocol: 'MIT-MAGIC-COOKIE-1',
              screen: 0,
            },
          } : {}),
        },
        (error, stream) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(stream);
        },
      );
    });
  }

  async openForwardOut(options: SSHForwardOutOptions): Promise<ClientChannel> {
    await this.connect();

    return new Promise<ClientChannel>((resolve, reject) => {
      this.client.forwardOut(
        options.sourceHost ?? '127.0.0.1',
        options.sourcePort ?? 0,
        options.targetHost,
        options.targetPort,
        (error, stream) => {
          if (error) {
            reject(error);
            return;
          }

          resolve(stream);
        },
      );
    });
  }

  listPortForwards(): ActiveSSHPortForward[] {
    return Array.from(this.activePortForwards.values()).map((state) => ({ ...state.forward }));
  }

  async addPortForward(config: ForwardedPortConfig): Promise<ActiveSSHPortForward> {
    await this.connect();

    return this.runPortForwardMutation(async () => {
      const existing = this.activePortForwards.get(config.id);
      if (existing) {
        if (areForwardConfigsEquivalent(existing.forward, config)) {
          return { ...existing.forward };
        }

        throw new Error(`SSH forwarded port id already exists: ${config.id}`);
      }

      const state = await this.activatePortForward(config, 'session');
      this.emitServiceData(`[SSH] Forwarded ${formatForwardedPort(state.forward)}\r\n`);
      return { ...state.forward };
    });
  }

  async removePortForward(forwardId: string): Promise<void> {
    await this.runPortForwardMutation(async () => {
      const state = this.activePortForwards.get(forwardId);
      if (!state) {
        return;
      }

      await this.deactivatePortForward(state);
      this.emitServiceData(`[SSH] Stopped forwarding ${formatForwardedPort(state.forward)}\r\n`);
    });
  }

  async listSftpDirectory(path?: string): Promise<SSHSftpDirectoryListing> {
    const session = await this.getSftpSession();
    return session.listDirectory(path);
  }

  async getSessionMetrics(path?: string): Promise<SSHSessionMetrics> {
    const output = await this.execCommand(buildSSHMetricsCommand(path || this.ssh.remoteCwd || '.'));
    return parseSSHSessionMetrics(output, path || this.ssh.remoteCwd || '.');
  }

  async downloadSftpFile(remotePath: string, localPath: string): Promise<void> {
    const session = await this.getSftpSession();
    await session.downloadFile(remotePath, localPath);
  }

  async uploadSftpFiles(remotePath: string, localPaths: string[]): Promise<number> {
    const session = await this.getSftpSession();
    return session.uploadFiles(remotePath, localPaths);
  }

  async uploadSftpDirectory(remotePath: string, localDirectoryPath: string): Promise<number> {
    const session = await this.getSftpSession();
    return session.uploadDirectory(remotePath, localDirectoryPath);
  }

  async downloadSftpDirectory(remotePath: string, localPath: string): Promise<void> {
    const session = await this.getSftpSession();
    await session.downloadEntry(remotePath, localPath);
  }

  async createSftpDirectory(parentPath: string, name: string): Promise<string> {
    const session = await this.getSftpSession();
    return session.createDirectory(parentPath, name);
  }

  async deleteSftpEntry(remotePath: string): Promise<void> {
    const session = await this.getSftpSession();
    await session.deleteEntry(remotePath);
  }

  async close(): Promise<void> {
    const alreadyClosed = this.closed;

    this.closed = true;
    this.ready = false;
    this.sftpSession = null;
    this.sftpWrapperPromise = null;
    await this.disposeConfiguredPortForwards();

    if (!alreadyClosed) {
      try {
        this.client.end();
      } catch {
        // Ignore teardown races.
      }

      try {
        this.client.destroy();
      } catch {
        // Ignore teardown races.
      }
    }

    await this.releaseJumpHostLease();
  }

  isClosed(): boolean {
    return this.closed;
  }

  private async performConnect(): Promise<void> {
    const knownHosts = await this.loadKnownHosts();
    const connectConfig = await this.buildConnectConfig(knownHosts);

    await new Promise<void>((resolve, reject) => {
      let settled = false;

      const rejectOnce = (error: Error) => {
        if (settled) {
          return;
        }

        settled = true;
        this.disposeConnectTimeoutController();
        this.closed = true;
        this.ready = false;
        reject(error);
      };

      this.connectTimeoutController = createConnectTimeoutController(
        resolveSSHReadyTimeoutMs(this.ssh.readyTimeout),
        () => {
          this.hostKeyVerificationError = new Error('Timed out while waiting for handshake');

          try {
            this.client.end();
          } catch {
            // Ignore connection teardown races during timeout handling.
          }

          try {
            this.client.destroy();
          } catch {
            // Ignore connection teardown races during timeout handling.
          }

          rejectOnce(this.hostKeyVerificationError);
        },
      );

      this.client.setNoDelay(true);

      this.client.on('banner', (message) => {
        if (!this.ssh.skipBanner) {
          this.emitServiceData(`${message}\r\n`);
        }
      });

      this.client.on('keyboard-interactive', (_name, instructions, _lang, prompts, finish) => {
        if (!this.ssh.password) {
          rejectOnce(new Error(instructions || 'SSH keyboard-interactive authentication requires a stored secret'));
          finish(prompts.map(() => ''));
          return;
        }

        finish(prompts.map(() => this.ssh.password as string));
      });

      this.client.on('change password', (message) => {
        rejectOnce(new Error(message || 'SSH server requires a password change before login'));
      });

      this.client.on('tcp connection', (details, accept, rejectIncoming) => {
        void this.handleRemoteForwardConnection(details, accept, rejectIncoming);
      });

      this.client.on('x11', (details, accept, rejectIncoming) => {
        void this.handleX11Connection(details, accept, rejectIncoming);
      });

      this.client.on('ready', () => {
        if (settled) {
          return;
        }

        settled = true;
        this.disposeConnectTimeoutController();
        this.ready = true;
        void this.configureConfiguredPortForwards()
          .finally(() => {
            resolve();
          });
      });

      this.client.on('error', (error) => {
        if (!settled) {
          rejectOnce(normalizeSSHConnectError(this.hostKeyVerificationError ?? error, this.ssh));
        }
      });

      this.client.on('close', () => {
        this.ready = false;
        this.closed = true;

        if (!settled) {
          rejectOnce(normalizeSSHConnectError(
            this.hostKeyVerificationError ?? new Error(`SSH connection closed before ready for ${this.ssh.host}:${this.ssh.port}`),
            this.ssh,
          ));
        }
      });

      this.client.connect(connectConfig);
    });
  }

  private async buildConnectConfig(knownHosts: KnownHostEntry[]): Promise<ConnectConfig> {
    const algorithms = resolveSSHAlgorithmPreferences(this.ssh.algorithms);
    const connectAlgorithms = {
      kex: algorithms.kex,
      serverHostKey: algorithms.hostKey,
      cipher: algorithms.cipher,
      hmac: algorithms.hmac,
      compress: algorithms.compression,
    } as NonNullable<ConnectConfig['algorithms']>;
    const connectConfig: ConnectConfig = {
      host: this.ssh.host,
      port: this.ssh.port,
      username: this.ssh.user,
      keepaliveInterval: this.ssh.keepaliveInterval > 0 ? this.ssh.keepaliveInterval * 1000 : 0,
      keepaliveCountMax: this.ssh.keepaliveCountMax,
      agentForward: this.ssh.agentForward,
      tryKeyboard: this.ssh.authType === 'keyboardInteractive',
      algorithms: connectAlgorithms,
      hostVerifier: (key: Buffer, callback?: (verified: boolean) => void) => {
        void this.verifyHostKey(key, knownHosts)
          .then((verified) => {
            if (callback) {
              callback(verified);
              return;
            }

            return verified;
          })
          .catch((error) => {
            this.hostKeyVerificationError = error instanceof Error
              ? error
              : new Error(String(error));

            if (callback) {
              callback(false);
            }
          });

        return callback ? undefined : false;
      },
    };

    const transportSocket = await this.buildTransportSocket();
    if (transportSocket) {
      connectConfig.sock = transportSocket;
    }

    switch (this.ssh.authType) {
      case 'password':
        if (!this.ssh.password) {
          throw new Error('SSH password authentication requires a stored password');
        }
        connectConfig.password = this.ssh.password;
        break;
      case 'publicKey': {
        const keyPath = this.ssh.privateKeys[0];
        if (!keyPath) {
          throw new Error('SSH public key authentication requires at least one private key path');
        }

        connectConfig.privateKey = await fs.readFile(keyPath, 'utf8');
        connectConfig.passphrase = this.ssh.privateKeyPassphrases?.[keyPath];
        break;
      }
      case 'agent': {
        const agent = process.platform === 'win32' ? 'pageant' : process.env.SSH_AUTH_SOCK;
        if (!agent) {
          throw new Error('SSH agent authentication requested but no local agent is available');
        }

        connectConfig.agent = agent;
        break;
      }
      case 'keyboardInteractive':
        connectConfig.tryKeyboard = true;
        break;
      default:
        throw new Error(`Unsupported SSH auth type: ${String(this.ssh.authType)}`);
    }

    return connectConfig;
  }

  private async buildTransportSocket(): Promise<ConnectConfig['sock'] | undefined> {
    if (this.ssh.proxyCommand) {
      this.emitServiceData(`[SSH] Proxy command: ${this.ssh.proxyCommand}\r\n`);
      return createProxyCommandSocket(this.ssh.proxyCommand, {
        host: this.ssh.host,
        port: this.ssh.port,
        user: this.ssh.user,
      });
    }

    if (this.ssh.jumpHost) {
      if (!this.connectionPool) {
        throw new Error(`SSH jump host requires a connection pool for ${this.ssh.host}:${this.ssh.port}`);
      }

      this.emitServiceData(`[SSH] Jump host: ${this.ssh.jumpHost.user}@${this.ssh.jumpHost.host}:${this.ssh.jumpHost.port}\r\n`);
      this.jumpHostLease = await this.connectionPool.acquire(this.ssh.jumpHost, (data) => {
        this.emitServiceData(data);
      });

      try {
        return await this.jumpHostLease.connection.openForwardOut({
          targetHost: this.ssh.host,
          targetPort: this.ssh.port,
        });
      } catch (error) {
        await this.releaseJumpHostLease();
        throw error;
      }
    }

    if (this.ssh.socksProxyHost) {
      this.emitServiceData(`[SSH] SOCKS proxy: ${this.ssh.socksProxyHost}:${this.ssh.socksProxyPort ?? 1080}\r\n`);
      return createSocksProxySocket({
        host: this.ssh.socksProxyHost,
        port: this.ssh.socksProxyPort ?? 1080,
      }, {
        host: this.ssh.host,
        port: this.ssh.port,
      });
    }

    if (this.ssh.httpProxyHost) {
      this.emitServiceData(`[SSH] HTTP proxy: ${this.ssh.httpProxyHost}:${this.ssh.httpProxyPort ?? 8080}\r\n`);
      return createHttpProxySocket({
        host: this.ssh.httpProxyHost,
        port: this.ssh.httpProxyPort ?? 8080,
      }, {
        host: this.ssh.host,
        port: this.ssh.port,
      });
    }

    return undefined;
  }

  private async getSftpSession(): Promise<SSHSftpSession> {
    if (this.sftpSession) {
      return this.sftpSession;
    }

    this.sftpSession = new SSHSftpSession({
      getWrapper: async () => this.getSftpWrapper(),
    });

    return this.sftpSession;
  }

  private async getSftpWrapper(): Promise<SFTPWrapper> {
    await this.connect();

    if (this.closed) {
      throw new Error(`SSH connection is already closed for ${this.ssh.user}@${this.ssh.host}`);
    }

    if (this.sftpWrapperPromise) {
      return this.sftpWrapperPromise;
    }

    this.sftpWrapperPromise = new Promise<SFTPWrapper>((resolve, reject) => {
      this.client.sftp((error, sftp) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(sftp);
      });
    }).catch((error) => {
      this.sftpWrapperPromise = null;
      throw error;
    });

    return this.sftpWrapperPromise;
  }

  async execCommand(command: string): Promise<string> {
    const result = await this.execCommandResult(command);
    if (result.exitCode !== 0) {
      throw new Error(result.stderr.trim() || result.stdout.trim() || `SSH command exited with code ${result.exitCode}`);
    }

    return result.stdout;
  }

  async execCommandResult(command: string): Promise<SSHExecCommandResult> {
    const handle = await this.execCommandStream(command);
    return handle.result;
  }

  async execCommandStream(
    command: string,
    callbacks?: SSHExecCommandCallbacks,
  ): Promise<SSHExecCommandHandle> {
    await this.connect();
    const wrappedCommand = wrapExecCommandWithSSHLocale(command, this.ssh);

    return new Promise<SSHExecCommandHandle>((resolve, reject) => {
      this.client.exec(wrappedCommand, (error, channel) => {
        if (error) {
          reject(error);
          return;
        }

        let stdout = '';
        let stderr = '';
        let exitCode: number | null = null;
        let settled = false;
        let cancelled = false;

        const result = new Promise<SSHExecCommandResult>((resolveResult, rejectResult) => {
          channel.on('data', (chunk: Buffer | string) => {
            const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
            stdout += text;
            callbacks?.onStdout?.(text);
          });
          channel.stderr?.on('data', (chunk: Buffer | string) => {
            const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
            stderr += text;
            callbacks?.onStderr?.(text);
          });
          channel.on('exit', (code?: number) => {
            exitCode = typeof code === 'number' ? code : (cancelled ? 130 : 0);
          });
          channel.on('close', () => {
            if (settled) {
              return;
            }
            settled = true;
            resolveResult({
              stdout,
              stderr,
              exitCode: exitCode ?? (cancelled ? 130 : 0),
            });
          });
          channel.on('error', (channelError: Error) => {
            if (settled) {
              return;
            }
            if (cancelled) {
              return;
            }
            settled = true;
            rejectResult(channelError);
          });
        });

        resolve({
          result,
          cancel: () => {
            if (settled) {
              return;
            }

            cancelled = true;
            try {
              if (typeof channel.signal === 'function') {
                channel.signal('TERM');
              }
            } catch {
              // Ignore remote signal delivery failures during cancellation.
            }
            try {
              channel.end();
            } catch {
              // Ignore close failures during cancellation.
            }
            try {
              (channel as ClientChannel & { close?: () => void }).close?.();
            } catch {
              // Ignore close failures during cancellation.
            }
          },
        });
      });
    });
  }

  private async configureConfiguredPortForwards(): Promise<void> {
    if (this.forwardedPortsConfigured) {
      return;
    }

    this.forwardedPortsConfigured = true;

    for (const forward of this.ssh.forwardedPorts) {
      try {
        const state = await this.activatePortForward(forward, 'profile');
        this.emitServiceData(`[SSH] Forwarded ${formatForwardedPort(state.forward)}\r\n`);
      } catch (error) {
        this.emitServiceData(`[SSH] Failed to forward ${formatForwardedPort(forward)}: ${formatErrorMessage(error)}\r\n`);
      }
    }
  }

  private async activatePortForward(
    config: ForwardedPortConfig,
    source: SSHPortForwardSource,
  ): Promise<ActivePortForwardState> {
    if (config.type === 'remote') {
      return this.startRemotePortForward(config, source);
    }

    return this.startLocalPortForward(config, source);
  }

  private async startLocalPortForward(
    config: ForwardedPortConfig,
    source: SSHPortForwardSource,
  ): Promise<ActivePortForwardState> {
    const listener = await startPortForwardListener(config, async (request) => {
      let channel: ClientChannel | null = null;

      try {
        channel = await this.openForwardOut({
          sourceHost: request.sourceAddress ?? '127.0.0.1',
          sourcePort: request.sourcePort ?? 0,
          targetHost: request.targetAddress,
          targetPort: request.targetPort,
        });
      } catch (error) {
        request.reject();
        this.emitServiceData(`[SSH] Rejected forwarded connection via ${formatForwardedPort(config)}: ${formatErrorMessage(error)}\r\n`);
        return;
      }

      const socket = request.accept();
      this.bridgeChannelToSocket(channel, socket);
    });

    const state: ActivePortForwardState = {
      forward: {
        ...config,
        source,
      },
      listener,
    };

    this.activePortForwards.set(config.id, state);
    return state;
  }

  private async startRemotePortForward(
    config: ForwardedPortConfig,
    source: SSHPortForwardSource,
  ): Promise<ActivePortForwardState> {
    const boundPort = await new Promise<number>((resolve, reject) => {
      this.client.forwardIn(config.host, config.port, (error, port) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(port ?? config.port);
      });
    });

    const state: ActivePortForwardState = {
      forward: {
        ...config,
        port: boundPort,
        source,
      },
      remoteBind: {
        host: config.host,
        port: boundPort,
      },
    };

    this.activePortForwards.set(config.id, state);
    this.remotePortForwardKeys.set(getRemoteForwardKey(config.host, boundPort), config.id);
    return state;
  }

  private async handleRemoteForwardConnection(
    details: { srcIP: string; srcPort: number; destIP: string; destPort: number },
    accept: () => ClientChannel,
    reject: () => void,
  ): Promise<void> {
    const forward = this.findRemotePortForward(details.destIP, details.destPort);
    if (!forward) {
      reject();
      this.emitServiceData(`[SSH] Rejected incoming remote forward for ${details.destIP}:${details.destPort}\r\n`);
      return;
    }

    const channel = accept();
    const socket = net.connect(forward.targetPort, forward.targetAddress);
    const rejectChannel = () => {
      try {
        channel.close();
      } catch {
        // Ignore teardown races while rejecting the forwarded channel.
      }
    };

    socket.once('error', (error) => {
      this.emitServiceData(`[SSH] Local target ${forward.targetAddress}:${forward.targetPort} rejected remote forward ${formatForwardedPort(forward)}: ${formatErrorMessage(error)}\r\n`);
      rejectChannel();
    });

    socket.once('connect', () => {
      this.bridgeChannelToSocket(channel, socket);
    });
  }

  private async handleX11Connection(
    details: { srcIP: string; srcPort: number },
    accept: () => ClientChannel,
    reject: () => void,
  ): Promise<void> {
    try {
      const socket = await connectToX11Display();
      const channel = accept();
      this.emitServiceData(`[SSH] Forwarded X11 connection from ${details.srcIP}:${details.srcPort} to ${describeX11DisplaySpec()}\r\n`);
      this.bridgeChannelToSocket(channel, socket);
    } catch (error) {
      reject();
      this.emitServiceData(`[SSH] Failed to connect the local X11 display (${describeX11DisplaySpec()}): ${formatErrorMessage(error)}\r\n`);

      if (process.platform === 'win32') {
        this.emitServiceData('[SSH] Install and start a local X server such as VcXsrv or Xming before enabling X11 forwarding.\r\n');
      }
    }
  }

  private findRemotePortForward(host: string, port: number): ActiveSSHPortForward | null {
    const directId = this.remotePortForwardKeys.get(getRemoteForwardKey(host, port));
    if (directId) {
      const directState = this.activePortForwards.get(directId);
      if (directState) {
        return directState.forward;
      }
    }

    for (const state of this.activePortForwards.values()) {
      const forward = state.forward;
      if (forward.type !== 'remote') {
        continue;
      }

      if (forward.port !== port) {
        continue;
      }

      if (isRemoteForwardWildcard(forward.host) || forward.host === host) {
        return forward;
      }
    }

    return null;
  }

  private async deactivatePortForward(state: ActivePortForwardState): Promise<void> {
    this.activePortForwards.delete(state.forward.id);

    if (state.listener) {
      await state.listener.dispose();
      return;
    }

    if (!state.remoteBind) {
      return;
    }

    const { host, port } = state.remoteBind;
    this.remotePortForwardKeys.delete(getRemoteForwardKey(host, port));
    await new Promise<void>((resolve) => {
      try {
        this.client.unforwardIn(host, port, () => {
          resolve();
        });
      } catch {
        resolve();
      }
    });
  }

  private bridgeChannelToSocket(channel: ClientChannel, socket: net.Socket): void {
    channel.on('data', (data: Buffer | string) => {
      socket.write(typeof data === 'string' ? Buffer.from(data, 'utf8') : data);
    });
    channel.stderr?.on('data', (data: Buffer | string) => {
      socket.write(typeof data === 'string' ? Buffer.from(data, 'utf8') : data);
    });
    channel.on('close', () => {
      socket.destroy();
    });
    channel.on('end', () => {
      socket.end();
    });
    channel.on('error', () => {
      socket.destroy();
    });

    socket.on('data', (data) => {
      channel.write(data);
    });
    socket.on('close', () => {
      channel.close();
    });
    socket.on('end', () => {
      channel.end();
    });
    socket.on('error', () => {
      channel.close();
    });
  }

  private async disposeConfiguredPortForwards(): Promise<void> {
    const activeForwards = Array.from(this.activePortForwards.values());
    this.activePortForwards.clear();
    this.remotePortForwardKeys.clear();

    await Promise.allSettled(activeForwards.map(async (state) => {
      if (state.listener) {
        await state.listener.dispose();
        return;
      }

      if (!state.remoteBind) {
        return;
      }

      await new Promise<void>((resolve) => {
        try {
          this.client.unforwardIn(state.remoteBind!.host, state.remoteBind!.port, () => {
            resolve();
          });
        } catch {
          resolve();
        }
      });
    }));
  }

  private emitServiceData(data: string): void {
    for (const listener of this.serviceListeners) {
      listener(data);
    }
  }

  private async runPortForwardMutation<T>(operation: () => Promise<T>): Promise<T> {
    let releaseQueue = () => {};
    const next = new Promise<void>((resolve) => {
      releaseQueue = resolve;
    });
    const previous = this.portForwardMutationQueue;
    this.portForwardMutationQueue = previous.finally(() => next);

    await previous;

    try {
      return await operation();
    } finally {
      releaseQueue();
    }
  }

  private async releaseJumpHostLease(): Promise<void> {
    if (!this.jumpHostLease) {
      return;
    }

    const lease = this.jumpHostLease;
    this.jumpHostLease = null;
    await lease.release();
  }
  private async verifyHostKey(key: Buffer, knownHosts: KnownHostEntry[]): Promise<boolean> {
    const digest = formatHostKeyDigest(key);
    const algorithm = readHostKeyAlgorithm(key);

    if (!this.ssh.verifyHostKeys) {
      return true;
    }

    const exactMatch = knownHosts.find((entry) => (
      entry.algorithm === algorithm && entry.digest === digest
    ));
    if (exactMatch) {
      return true;
    }

    const storedEntry = knownHosts.find((entry) => entry.algorithm === algorithm);
    const reason = storedEntry ? 'mismatch' : 'unknown';

    this.emitServiceData(`[SSH] Host key fingerprint (${algorithm}): ${digest}\r\n`);
    if (storedEntry) {
      this.emitServiceData(`[SSH] Stored fingerprint: ${storedEntry.digest}\r\n`);
    }

    if (!this.hostKeyPromptService) {
      this.hostKeyVerificationError = new Error('SSH host key verification prompt service is unavailable');
      return false;
    }

    this.connectTimeoutController?.pause();

    let decision: SSHHostKeyPromptDecision;
    try {
      decision = await this.hostKeyPromptService.confirm({
        host: this.ssh.host,
        port: this.ssh.port,
        algorithm,
        fingerprint: digest,
        reason,
        ...(storedEntry ? { storedFingerprint: storedEntry.digest } : {}),
      });
    } finally {
      this.connectTimeoutController?.resume();
    }

    if (!decision.trusted) {
      this.hostKeyVerificationError = new Error('SSH host key verification was rejected by the user');
      return false;
    }

    if (decision.persist && this.knownHostsStore) {
      await this.knownHostsStore.upsert({
        host: this.ssh.host,
        port: this.ssh.port,
        algorithm,
        digest,
      });
    }

    return true;
  }

  private async loadKnownHosts(): Promise<KnownHostEntry[]> {
    if (!this.ssh.verifyHostKeys || !this.knownHostsStore) {
      return [];
    }

    const entries = await this.knownHostsStore.list();
    return entries.filter((entry) => entry.host === this.ssh.host && entry.port === this.ssh.port);
  }

  private disposeConnectTimeoutController(): void {
    this.connectTimeoutController?.dispose();
    this.connectTimeoutController = null;
  }

}

function formatHostKeyDigest(key: Buffer): string {
  return `SHA256:${createHash('sha256').update(key).digest('base64')}`;
}

function readHostKeyAlgorithm(key: Buffer): string {
  const parsed = utils.parseKey(key) as { type?: string } | Array<{ type?: string }> | Error;
  if (Array.isArray(parsed)) {
    return parsed[0]?.type || 'unknown';
  }

  if (parsed instanceof Error) {
    return 'unknown';
  }

  return parsed?.type || 'unknown';
}

function formatForwardedPort(forward: ForwardedPortConfig): string {
  if (forward.type === 'dynamic') {
    return `(dynamic) ${forward.host}:${forward.port}`;
  }

  if (forward.type === 'remote') {
    return `(remote) ${forward.host}:${forward.port} -> (local) ${forward.targetAddress}:${forward.targetPort}`;
  }

  return `(local) ${forward.host}:${forward.port} -> (remote) ${forward.targetAddress}:${forward.targetPort}`;
}

function buildRemoteShellEnv(ssh: SSHSessionConfig): Record<string, string> {
  const env: Record<string, string> = {
    COLORTERM: 'truecolor',
    TERM_PROGRAM: 'Synapse',
    ...buildSSHLocaleEnvironment(ssh),
  };

  if (process.env.TERM_PROGRAM_VERSION) {
    env.TERM_PROGRAM_VERSION = process.env.TERM_PROGRAM_VERSION;
  }

  return env;
}

function createConnectTimeoutController(
  timeoutMs: number | null,
  onTimeout: () => void,
): ConnectTimeoutController | null {
  if (!timeoutMs || timeoutMs <= 0) {
    return null;
  }

  let timer: NodeJS.Timeout | null = null;
  let remainingMs = timeoutMs;
  let startedAt = 0;
  let paused = false;
  let disposed = false;

  const clearTimer = () => {
    if (!timer) {
      return;
    }

    clearTimeout(timer);
    timer = null;
  };

  const schedule = () => {
    if (disposed || paused) {
      return;
    }

    clearTimer();
    startedAt = Date.now();
    timer = setTimeout(() => {
      timer = null;
      remainingMs = 0;
      onTimeout();
    }, remainingMs);
  };

  schedule();

  return {
    pause() {
      if (disposed || paused) {
        return;
      }

      paused = true;
      if (timer) {
        remainingMs = Math.max(remainingMs - (Date.now() - startedAt), 1);
        clearTimer();
      }
    },
    resume() {
      if (disposed || !paused) {
        return;
      }

      paused = false;
      schedule();
    },
    dispose() {
      disposed = true;
      clearTimer();
    },
  };
}

function areForwardConfigsEquivalent(
  left: Pick<ForwardedPortConfig, 'type' | 'host' | 'port' | 'targetAddress' | 'targetPort' | 'description'>,
  right: Pick<ForwardedPortConfig, 'type' | 'host' | 'port' | 'targetAddress' | 'targetPort' | 'description'>,
): boolean {
  return (
    left.type === right.type
    && left.host === right.host
    && left.port === right.port
    && left.targetAddress === right.targetAddress
    && left.targetPort === right.targetPort
    && (left.description ?? '') === (right.description ?? '')
  );
}

function getRemoteForwardKey(host: string, port: number): string {
  return `${host}:${port}`;
}

function buildSSHMetricsCommand(targetPath: string): string {
  return `sh -lc '
HOSTNAME_VALUE=$(hostname 2>/dev/null || uname -n 2>/dev/null || printf unknown)
PLATFORM_VALUE=$(uname -s 2>/dev/null || printf unknown)
CPU_CORES=$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || grep -c "^processor" /proc/cpuinfo 2>/dev/null || printf "")
LOAD_VALUE=$(cat /proc/loadavg 2>/dev/null | cut -d" " -f1-3 || uptime 2>/dev/null | sed -n "s/.*load averages\\{0,1\\}: //p" | tr -d "," | awk "{print \\$1\\" \\"\\$2\\" \\"\\$3}" || printf "")
MEM_VALUE=$(awk "/MemTotal/ {total=\\$2} /MemAvailable/ {available=\\$2} END {if (total > 0) printf \\"%s %s\\", total, available}" /proc/meminfo 2>/dev/null || printf "")
DISK_VALUE=$(df -Pk "$1" 2>/dev/null | tail -1 | awk "{print \\$2\\" \\"\\$3\\" \\"\\$5}")
printf "__HOST__%s\\n__PLATFORM__%s\\n__CPU_CORES__%s\\n__LOAD__%s\\n__MEM__%s\\n__DISK__%s\\n" "$HOSTNAME_VALUE" "$PLATFORM_VALUE" "$CPU_CORES" "$LOAD_VALUE" "$MEM_VALUE" "$DISK_VALUE"
' sh ${shellEscape(targetPath)}`;
}

function parseSSHSessionMetrics(output: string, targetPath: string): SSHSessionMetrics {
  const values = new Map<string, string>();

  output.split(/\r?\n/).forEach((line) => {
    const match = /^__(HOST|PLATFORM|CPU_CORES|LOAD|MEM|DISK)__(.*)$/.exec(line.trim());
    if (match) {
      values.set(match[1], match[2].trim());
    }
  });

  const cpuCoresValue = values.get('CPU_CORES') ?? '';
  const cpuCores = cpuCoresValue ? Number.parseInt(cpuCoresValue, 10) : null;

  const loadAverage = (values.get('LOAD') ?? '')
    .split(/\s+/)
    .map((value) => Number.parseFloat(value))
    .filter((value) => Number.isFinite(value));

  const memory = parseMemoryMetrics(values.get('MEM') ?? '');
  const disk = parseDiskMetrics(values.get('DISK') ?? '', targetPath);

  return {
    hostname: values.get('HOST') || null,
    platform: values.get('PLATFORM') || null,
    cpuCores: Number.isFinite(cpuCores) && cpuCores! > 0 ? cpuCores : null,
    loadAverage,
    memory,
    disk,
    sampledAt: new Date().toISOString(),
  };
}

function parseMemoryMetrics(value: string): SSHSessionMetrics['memory'] {
  const [totalKbValue, availableKbValue] = value.split(/\s+/);
  const totalKb = Number.parseInt(totalKbValue ?? '', 10);
  const availableKb = Number.parseInt(availableKbValue ?? '', 10);

  if (!Number.isFinite(totalKb) || totalKb <= 0 || !Number.isFinite(availableKb) || availableKb < 0) {
    return null;
  }

  const totalBytes = totalKb * 1024;
  const usedBytes = Math.max(totalKb - availableKb, 0) * 1024;

  return {
    totalBytes,
    usedBytes,
    usedPercent: totalBytes > 0 ? roundMetric((usedBytes / totalBytes) * 100) : null,
  };
}

function parseDiskMetrics(value: string, targetPath: string): SSHSessionMetrics['disk'] {
  const [totalKbValue, usedKbValue, usedPercentValue] = value.split(/\s+/);
  const totalKb = Number.parseInt(totalKbValue ?? '', 10);
  const usedKb = Number.parseInt(usedKbValue ?? '', 10);
  const usedPercent = Number.parseInt((usedPercentValue ?? '').replace('%', ''), 10);

  if (!Number.isFinite(totalKb) || totalKb <= 0 || !Number.isFinite(usedKb) || usedKb < 0) {
    return null;
  }

  return {
    path: targetPath,
    totalBytes: totalKb * 1024,
    usedBytes: usedKb * 1024,
    usedPercent: Number.isFinite(usedPercent) ? usedPercent : null,
  };
}

function roundMetric(value: number): number {
  return Math.round(value * 10) / 10;
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function isRemoteForwardWildcard(host: string): boolean {
  return host === '' || host === '0.0.0.0' || host === '::' || host === 'localhost';
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeSSHConnectError(error: Error, ssh: SSHSessionConfig): Error {
  if (error instanceof SSHAuthenticationError) {
    return error;
  }

  if (!isSSHAuthenticationFailureMessage(error.message)) {
    return error;
  }

  return new SSHAuthenticationError(getSSHAuthenticationFailureMessage(ssh.authType));
}

function isSSHAuthenticationFailureMessage(message: string): boolean {
  const normalizedMessage = message.trim().toLowerCase();

  return normalizedMessage.includes('all configured authentication methods failed')
    || normalizedMessage.includes('authentication failed')
    || normalizedMessage.includes('permission denied')
    || normalizedMessage.includes('userauth failure');
}

function getSSHAuthenticationFailureMessage(authType: SSHAuthType): string {
  switch (authType) {
    case 'password':
    case 'keyboardInteractive':
      return 'SSH authentication failed. The password or interactive secret was rejected by the server.';
    case 'publicKey':
      return 'SSH authentication failed. The private key or passphrase was rejected by the server.';
    case 'agent':
      return 'SSH authentication failed. The SSH agent identity was rejected by the server.';
    default:
      return 'SSH authentication failed.';
  }
}
