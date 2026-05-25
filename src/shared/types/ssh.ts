export type SSHAuthType =
  | 'password'
  | 'publicKey'
  | 'agent'
  | 'keyboardInteractive';

export type SSHRemoteLocaleMode = 'auto' | 'custom';

export type SSHRoutingMode =
  | 'direct'
  | 'jumpHost'
  | 'proxyCommand'
  | 'socks'
  | 'http';

export type SSHAlgorithmType =
  | 'kex'
  | 'hostKey'
  | 'cipher'
  | 'hmac'
  | 'compression';

export type SSHAlgorithmPreferences = Record<SSHAlgorithmType, string[]>;

export interface SSHAlgorithmCatalog {
  defaults: SSHAlgorithmPreferences;
  supported: SSHAlgorithmPreferences;
}

export type SSHPortForwardType =
  | 'local'
  | 'remote'
  | 'dynamic';

export interface ForwardedPortConfig {
  id: string;
  type: SSHPortForwardType;
  host: string;
  port: number;
  targetAddress: string;
  targetPort: number;
  description?: string;
}

export type SSHPortForwardSource = 'profile' | 'session';

export interface ActiveSSHPortForward extends ForwardedPortConfig {
  source: SSHPortForwardSource;
}

export interface SSHSftpEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isSymbolicLink: boolean;
  symlinkTargetPath?: string | null;
  symlinkTargetIsDirectory?: boolean | null;
  size: number;
  modifiedAt: string | null;
}

export interface SSHSftpDirectoryListing {
  path: string;
  entries: SSHSftpEntry[];
}

export interface SSHSessionMemoryMetrics {
  totalBytes: number | null;
  usedBytes: number | null;
  usedPercent: number | null;
}

export interface SSHSessionDiskMetrics {
  path: string;
  totalBytes: number | null;
  usedBytes: number | null;
  usedPercent: number | null;
}

export interface SSHSessionMetrics {
  hostname: string | null;
  platform: string | null;
  cpuCores: number | null;
  loadAverage: number[];
  memory: SSHSessionMemoryMetrics | null;
  disk: SSHSessionDiskMetrics | null;
  sampledAt: string;
}

export interface KnownHostEntry {
  id: string;
  host: string;
  port: number;
  algorithm: string;
  digest: string;
  createdAt: string;
  updatedAt: string;
}

export interface SSHProfile {
  id: string;
  name: string;
  host: string;
  port: number;
  user: string;
  auth: SSHAuthType;
  privateKeys: string[];
  keepaliveInterval: number;
  keepaliveCountMax: number;
  readyTimeout: number | null;
  verifyHostKeys: boolean;
  x11: boolean;
  skipBanner: boolean;
  routingMode?: SSHRoutingMode;
  jumpHostProfileId?: string;
  agentForward: boolean;
  warnOnClose: boolean;
  proxyCommand?: string;
  socksProxyHost?: string;
  socksProxyPort?: number;
  httpProxyHost?: string;
  httpProxyPort?: number;
  reuseSession: boolean;
  algorithms?: SSHAlgorithmPreferences;
  forwardedPorts: ForwardedPortConfig[];
  remoteLocaleMode?: SSHRemoteLocaleMode;
  remoteLocale?: string;
  remoteCommand?: string;
  defaultRemoteCwd?: string;
  tags: string[];
  notes?: string;
  icon?: string;
  color?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SSHProfileInput extends Omit<SSHProfile, 'id' | 'createdAt' | 'updatedAt'> {}

export type SSHProfilePatch = Partial<SSHProfileInput>;

export interface SSHCredentialState {
  hasPassword: boolean;
  hasPassphrase: boolean;
}

export interface SSHImportResult {
  profiles: SSHProfile[];
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
}

export type SSHVaultStorageMode = 'electron-safe-storage' | 'plain-text-fallback';

export interface SSHVaultEntry {
  profileId: string;
  password?: string;
  privateKeyPassphrases?: Record<string, string>;
  updatedAt: string;
}
