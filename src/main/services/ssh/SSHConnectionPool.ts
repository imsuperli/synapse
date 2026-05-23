import type { SSHSessionConfig } from '../../types/process';
import { resolveSSHReadyTimeoutMs } from '../../../shared/utils/sshDefaults';
import type { ISSHKnownHostsStore } from './SSHKnownHostsStore';
import type { ISSHHostKeyPromptService } from './SSHHostKeyPromptService';
import {
  ISSHConnection,
  SSHClientConnection,
  SSHClientConnectionDependencies,
} from './SSHClientConnection';

export interface SSHConnectionPoolLease {
  connection: ISSHConnection;
  release(): Promise<void>;
}

export interface ISSHConnectionPool {
  acquire(config: SSHSessionConfig, serviceListener?: (data: string) => void): Promise<SSHConnectionPoolLease>;
  setKnownHostsStore(store: ISSHKnownHostsStore | null): void;
  setHostKeyPromptService(service: ISSHHostKeyPromptService | null): void;
  destroy(): Promise<void>;
}

export interface SSHConnectionPoolOptions extends SSHClientConnectionDependencies {
  createConnection?: (config: SSHSessionConfig, dependencies: SSHClientConnectionDependencies) => ISSHConnection;
}

type PooledConnectionEntry = {
  connection: ISSHConnection;
  refCount: number;
};

export class SSHConnectionPool implements ISSHConnectionPool {
  private readonly entries = new Map<string, PooledConnectionEntry>();
  private readonly createConnection: (config: SSHSessionConfig, dependencies: SSHClientConnectionDependencies) => ISSHConnection;
  private knownHostsStore: ISSHKnownHostsStore | null;
  private hostKeyPromptService: ISSHHostKeyPromptService | null;

  constructor(options: SSHConnectionPoolOptions = {}) {
    this.knownHostsStore = options.knownHostsStore ?? null;
    this.hostKeyPromptService = options.hostKeyPromptService ?? null;
    this.createConnection = options.createConnection ?? ((config, dependencies) => (
      new SSHClientConnection(config, dependencies)
    ));
  }

  setKnownHostsStore(store: ISSHKnownHostsStore | null): void {
    this.knownHostsStore = store;
  }

  setHostKeyPromptService(service: ISSHHostKeyPromptService | null): void {
    this.hostKeyPromptService = service;
  }

  async acquire(config: SSHSessionConfig, serviceListener?: (data: string) => void): Promise<SSHConnectionPoolLease> {
    if (!config.reuseSession) {
      const connection = this.createConnection(config, this.getDependencies());
      const detachServiceListener = serviceListener
        ? connection.attachServiceListener(serviceListener)
        : null;

      try {
        await connection.connect();
      } catch (error) {
        detachServiceListener?.();
        throw error;
      }

      return this.createOneShotLease(connection, detachServiceListener);
    }

    const key = buildSSHConnectionKey(config);
    let entry = this.entries.get(key);

    if (entry?.connection.isClosed()) {
      this.entries.delete(key);
      entry = undefined;
    }

    if (!entry) {
      entry = {
        connection: this.createConnection(config, this.getDependencies()),
        refCount: 0,
      };
      this.entries.set(key, entry);
    }

    entry.refCount += 1;
    const detachServiceListener = serviceListener
      ? entry.connection.attachServiceListener(serviceListener)
      : null;

    try {
      await entry.connection.connect();
    } catch (error) {
      detachServiceListener?.();
      await this.releaseEntry(key, entry);
      throw error;
    }

    let released = false;
    return {
      connection: entry.connection,
      release: async () => {
        if (released) {
          return;
        }

        released = true;
        detachServiceListener?.();
        await this.releaseEntry(key, entry as PooledConnectionEntry);
      },
    };
  }

  async destroy(): Promise<void> {
    const entries = Array.from(this.entries.values());
    this.entries.clear();
    await Promise.allSettled(entries.map(async (entry) => {
      await entry.connection.close();
    }));
  }

  private getDependencies(): SSHClientConnectionDependencies {
    return {
      knownHostsStore: this.knownHostsStore,
      hostKeyPromptService: this.hostKeyPromptService,
      connectionPool: this,
    };
  }

  private createOneShotLease(
    connection: ISSHConnection,
    detachServiceListener: (() => void) | null,
  ): SSHConnectionPoolLease {
    let released = false;

    return {
      connection,
      release: async () => {
        if (released) {
          return;
        }

        released = true;
        detachServiceListener?.();
        await connection.close();
      },
    };
  }

  private async releaseEntry(key: string, entry: PooledConnectionEntry): Promise<void> {
    entry.refCount = Math.max(entry.refCount - 1, 0);

    const activeEntry = this.entries.get(key);
    if (!activeEntry || activeEntry !== entry) {
      await entry.connection.close();
      return;
    }

    if (entry.refCount > 0 && !entry.connection.isClosed()) {
      return;
    }

    this.entries.delete(key);
    await entry.connection.close();
  }
}

export function buildSSHConnectionKey(config: SSHSessionConfig): string {
  return JSON.stringify({
    host: config.host,
    port: config.port,
    user: config.user,
    authType: config.authType,
    privateKeys: [...config.privateKeys].sort(),
    keepaliveInterval: config.keepaliveInterval,
    keepaliveCountMax: config.keepaliveCountMax,
    readyTimeout: resolveSSHReadyTimeoutMs(config.readyTimeout),
    verifyHostKeys: config.verifyHostKeys,
    agentForward: config.agentForward,
    jumpHostProfileId: config.jumpHostProfileId ?? null,
    jumpHost: config.jumpHost ? buildSSHConnectionKey(config.jumpHost) : null,
    proxyCommand: config.proxyCommand ?? null,
    socksProxyHost: config.socksProxyHost ?? null,
    socksProxyPort: config.socksProxyPort ?? null,
    httpProxyHost: config.httpProxyHost ?? null,
    httpProxyPort: config.httpProxyPort ?? null,
    algorithms: config.algorithms ? {
      kex: [...config.algorithms.kex],
      hostKey: [...config.algorithms.hostKey],
      cipher: [...config.algorithms.cipher],
      hmac: [...config.algorithms.hmac],
      compression: [...config.algorithms.compression],
    } : null,
    forwardedPorts: config.forwardedPorts.map((forward) => ({
      id: forward.id,
      type: forward.type,
      host: forward.host,
      port: forward.port,
      targetAddress: forward.targetAddress,
      targetPort: forward.targetPort,
      description: forward.description ?? null,
    })),
    remoteLocaleMode: config.remoteLocaleMode ?? 'auto',
    remoteLocale: config.remoteLocale ?? null,
  });
}
