import { randomUUID } from 'crypto';
import {
  ForwardedPortConfig,
  SSHAuthType,
  SSHPortForwardType,
  SSHProfile,
  SSHProfileInput,
  SSHProfilePatch,
  SSHRoutingMode,
} from '../../../shared/types/ssh';
import {
  normalizeOptionalString,
  readJsonFileOrDefault,
  resolveSSHDataFilePath,
  stripUndefinedProperties,
  uniqueBy,
  uniqueStrings,
  writeJsonFileAtomic,
} from './storeUtils';
import { resolveSSHAlgorithmPreferences } from './SSHAlgorithmCatalog';

interface PersistedSSHProfilesFile {
  version: 1;
  profiles: SSHProfile[];
}

export interface ISSHProfileStore {
  list(): Promise<SSHProfile[]>;
  get(id: string): Promise<SSHProfile | null>;
  create(input: SSHProfileInput): Promise<SSHProfile>;
  update(id: string, patch: SSHProfilePatch): Promise<SSHProfile>;
  upsert(profile: SSHProfile): Promise<SSHProfile>;
  remove(id: string): Promise<void>;
}

export interface SSHProfileStoreOptions {
  filePath?: string;
  now?: () => string;
}

const DEFAULT_PROFILES_FILE_NAME = 'ssh-profiles.json';

export class SSHProfileStore implements ISSHProfileStore {
  private readonly filePath: string;
  private readonly now: () => string;

  constructor(options: SSHProfileStoreOptions = {}) {
    this.filePath = resolveSSHDataFilePath(DEFAULT_PROFILES_FILE_NAME, options.filePath);
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async list(): Promise<SSHProfile[]> {
    const data = await this.readData();
    return data.profiles;
  }

  async get(id: string): Promise<SSHProfile | null> {
    const profileId = requireNonEmptyString(id, 'SSH profile id');
    const data = await this.readData();
    return data.profiles.find((profile) => profile.id === profileId) ?? null;
  }

  async create(input: SSHProfileInput): Promise<SSHProfile> {
    const timestamp = this.now();
    const data = await this.readData();

    const profile = normalizeProfile({
      ...input,
      id: randomUUID(),
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    data.profiles.push(profile);
    await this.writeData(data.profiles);
    return profile;
  }

  async update(id: string, patch: SSHProfilePatch): Promise<SSHProfile> {
    const profileId = requireNonEmptyString(id, 'SSH profile id');
    const normalizedPatch = stripUndefinedProperties(patch as Record<string, unknown>);
    const data = await this.readData();
    const index = data.profiles.findIndex((profile) => profile.id === profileId);

    if (index === -1) {
      throw new Error(`SSH profile not found: ${profileId}`);
    }

    const current = data.profiles[index];
    const updated = normalizeProfile({
      ...current,
      ...normalizedPatch,
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: this.now(),
    });

    data.profiles[index] = updated;
    await this.writeData(data.profiles);
    return updated;
  }

  async upsert(profile: SSHProfile): Promise<SSHProfile> {
    const profileId = requireNonEmptyString(profile.id, 'SSH profile id');
    const data = await this.readData();
    const index = data.profiles.findIndex((item) => item.id === profileId);
    const current = index >= 0 ? data.profiles[index] : null;
    const normalized = normalizeProfile({
      ...profile,
      id: profileId,
      createdAt: current?.createdAt ?? profile.createdAt ?? this.now(),
      updatedAt: this.now(),
    });

    if (index >= 0) {
      data.profiles[index] = normalized;
    } else {
      data.profiles.push(normalized);
    }

    await this.writeData(data.profiles);
    return normalized;
  }

  async remove(id: string): Promise<void> {
    const profileId = requireNonEmptyString(id, 'SSH profile id');
    const data = await this.readData();
    const nextProfiles = data.profiles.filter((profile) => profile.id !== profileId);

    if (nextProfiles.length === data.profiles.length) {
      return;
    }

    await this.writeData(nextProfiles);
  }

  private async readData(): Promise<PersistedSSHProfilesFile> {
    const data = await readJsonFileOrDefault<PersistedSSHProfilesFile>(this.filePath, {
      version: 1,
      profiles: [],
    });

    if (!Array.isArray(data.profiles)) {
      throw new Error('SSH profile store is corrupted: profiles must be an array');
    }

    return {
      version: 1,
      profiles: data.profiles.map((profile) => normalizeProfile(profile)),
    };
  }

  private async writeData(profiles: SSHProfile[]): Promise<void> {
    await writeJsonFileAtomic(this.filePath, {
      version: 1,
      profiles,
    } satisfies PersistedSSHProfilesFile);
  }
}

function normalizeProfile(input: Partial<SSHProfile> & Pick<SSHProfile, 'id' | 'createdAt' | 'updatedAt'>): SSHProfile {
  const id = requireNonEmptyString(input.id, 'SSH profile id');
  const name = requireNonEmptyString(input.name, 'SSH profile name');
  const host = requireNonEmptyString(input.host, 'SSH host');
  const port = normalizePort(input.port ?? 22, 'SSH port');
  const user = requireNonEmptyString(input.user, 'SSH user');
  const auth = normalizeAuthType(input.auth);
  const privateKeys = uniqueStrings(Array.isArray(input.privateKeys) ? input.privateKeys : []);
  const keepaliveInterval = normalizeNonNegativeInteger(input.keepaliveInterval, 'SSH keepalive interval', 30);
  const keepaliveCountMax = normalizeNonNegativeInteger(input.keepaliveCountMax, 'SSH keepalive count max', 3);
  const readyTimeout = normalizeNullablePositiveInteger(input.readyTimeout, 'SSH ready timeout');
  const verifyHostKeys = normalizeBoolean(input.verifyHostKeys, true);
  const x11 = normalizeBoolean(input.x11, false);
  const skipBanner = normalizeBoolean(input.skipBanner, false);
  const routingMode = normalizeRoutingMode(input.routingMode);
  const jumpHostProfileId = normalizeOptionalString(input.jumpHostProfileId);
  const agentForward = normalizeBoolean(input.agentForward, false);
  const warnOnClose = normalizeBoolean(input.warnOnClose, true);
  const proxyCommand = normalizeOptionalString(input.proxyCommand);
  const socksProxyHost = normalizeOptionalString(input.socksProxyHost);
  const socksProxyPort = normalizeOptionalPort(input.socksProxyPort, 'SSH SOCKS proxy port');
  const httpProxyHost = normalizeOptionalString(input.httpProxyHost);
  const httpProxyPort = normalizeOptionalPort(input.httpProxyPort, 'SSH HTTP proxy port');
  const reuseSession = normalizeBoolean(input.reuseSession, true);
  const algorithms = resolveSSHAlgorithmPreferences(input.algorithms);
  const forwardedPorts = normalizeForwardedPorts(input.forwardedPorts);
  const remoteLocaleMode = normalizeRemoteLocaleMode(input.remoteLocaleMode);
  const remoteLocale = normalizeOptionalString(input.remoteLocale);
  const remoteCommand = normalizeOptionalString(input.remoteCommand);
  const defaultRemoteCwd = normalizeOptionalRemoteCwd(input.defaultRemoteCwd);
  const tags = uniqueStrings(Array.isArray(input.tags) ? input.tags : []);
  const notes = normalizeOptionalString(input.notes);
  const icon = normalizeOptionalString(input.icon);
  const color = normalizeOptionalString(input.color);
  const createdAt = requireNonEmptyString(input.createdAt, 'SSH profile createdAt');
  const updatedAt = requireNonEmptyString(input.updatedAt, 'SSH profile updatedAt');

  if (auth === 'publicKey' && privateKeys.length === 0) {
    throw new Error('SSH public key authentication requires at least one private key path');
  }

  if (jumpHostProfileId && jumpHostProfileId === id) {
    throw new Error('SSH jump host profile cannot reference itself');
  }

  if (routingMode === 'jumpHost' && !jumpHostProfileId) {
    throw new Error('SSH jump host routing requires a jump host profile');
  }

  if (routingMode === 'proxyCommand' && !proxyCommand) {
    throw new Error('SSH ProxyCommand routing requires a proxy command');
  }

  if (routingMode === 'socks' && !socksProxyHost) {
    throw new Error('SSH SOCKS proxy routing requires a proxy host');
  }

  if (routingMode === 'http' && !httpProxyHost) {
    throw new Error('SSH HTTP proxy routing requires a proxy host');
  }

  if (!socksProxyHost && socksProxyPort !== undefined) {
    throw new Error('SSH SOCKS proxy host is required when SOCKS proxy port is set');
  }

  if (!httpProxyHost && httpProxyPort !== undefined) {
    throw new Error('SSH HTTP proxy host is required when HTTP proxy port is set');
  }

  return {
    id,
    name,
    host,
    port,
    user,
    auth,
    privateKeys,
    keepaliveInterval,
    keepaliveCountMax,
    readyTimeout,
    verifyHostKeys,
    x11,
    skipBanner,
    ...(routingMode !== 'direct' ? { routingMode } : {}),
    ...(jumpHostProfileId ? { jumpHostProfileId } : {}),
    agentForward,
    warnOnClose,
    ...(proxyCommand ? { proxyCommand } : {}),
    ...(socksProxyHost ? { socksProxyHost } : {}),
    ...(socksProxyPort !== undefined ? { socksProxyPort } : {}),
    ...(httpProxyHost ? { httpProxyHost } : {}),
    ...(httpProxyPort !== undefined ? { httpProxyPort } : {}),
    reuseSession,
    algorithms,
    forwardedPorts,
    ...(remoteLocaleMode !== 'auto' ? { remoteLocaleMode } : {}),
    ...(remoteLocale ? { remoteLocale } : {}),
    ...(remoteCommand ? { remoteCommand } : {}),
    ...(defaultRemoteCwd ? { defaultRemoteCwd } : {}),
    tags,
    ...(notes ? { notes } : {}),
    ...(icon ? { icon } : {}),
    ...(color ? { color } : {}),
    createdAt,
    updatedAt,
  };
}

function normalizeOptionalRemoteCwd(value: unknown): string | undefined {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    return undefined;
  }

  const quote = normalized[0];
  if ((quote === '\'' || quote === '"') && normalized[normalized.length - 1] === quote) {
    const unwrapped = normalized.slice(1, -1).trim();
    return unwrapped || undefined;
  }

  return normalized;
}

function normalizeRemoteLocaleMode(value: unknown): 'auto' | 'custom' {
  return value === 'custom' ? 'custom' : 'auto';
}

function normalizeForwardedPorts(value: unknown): ForwardedPortConfig[] {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error('SSH forwarded ports must be an array');
  }

  return uniqueBy(
    value.map((entry) => normalizeForwardedPort(entry)),
    (entry) => entry.id,
  );
}

function normalizeForwardedPort(value: unknown): ForwardedPortConfig {
  if (!value || typeof value !== 'object') {
    throw new Error('SSH forwarded port entry must be an object');
  }

  const entry = value as Partial<ForwardedPortConfig>;
  const type = normalizePortForwardType(entry.type);
  const id = normalizeOptionalString(entry.id) ?? randomUUID();
  const host = normalizeOptionalString(entry.host) ?? '127.0.0.1';
  const port = normalizePort(entry.port, 'SSH forwarded port bind port');
  const description = normalizeOptionalString(entry.description);

  if (type === 'dynamic') {
    const targetAddress = normalizeOptionalString(entry.targetAddress) ?? 'socks';
    const targetPort = entry.targetPort === undefined || entry.targetPort === null
      ? 0
      : normalizeNonNegativeInteger(entry.targetPort, 'SSH dynamic forward target port', 0);

    return {
      id,
      type,
      host,
      port,
      targetAddress,
      targetPort,
      ...(description ? { description } : {}),
    };
  }

  const targetAddress = requireNonEmptyString(entry.targetAddress, 'SSH forwarded port target address');
  const targetPort = normalizePort(entry.targetPort, 'SSH forwarded port target port');

  return {
    id,
    type,
    host,
    port,
    targetAddress,
    targetPort,
    ...(description ? { description } : {}),
  };
}

function normalizeAuthType(value: unknown): SSHAuthType {
  switch (value) {
    case 'password':
    case 'publicKey':
    case 'agent':
    case 'keyboardInteractive':
      return value;
    default:
      throw new Error(`Unsupported SSH auth type: ${String(value)}`);
  }
}

function normalizeRoutingMode(value: unknown): SSHRoutingMode {
  switch (value) {
    case 'jumpHost':
    case 'proxyCommand':
    case 'socks':
    case 'http':
      return value;
    case 'direct':
    case undefined:
    case null:
    case '':
      return 'direct';
    default:
      throw new Error(`Unsupported SSH routing mode: ${String(value)}`);
  }
}

function normalizePortForwardType(value: unknown): SSHPortForwardType {
  switch (value) {
    case 'local':
    case 'remote':
    case 'dynamic':
      return value;
    default:
      throw new Error(`Unsupported SSH port forward type: ${String(value)}`);
  }
}

function normalizeBoolean(value: unknown, defaultValue: boolean): boolean {
  return typeof value === 'boolean' ? value : defaultValue;
}

function normalizePort(value: unknown, fieldName: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${fieldName} must be an integer between 1 and 65535`);
  }

  return port;
}

function normalizeOptionalPort(value: unknown, fieldName: string): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  return normalizePort(value, fieldName);
}

function normalizeNonNegativeInteger(value: unknown, fieldName: string, defaultValue: number): number {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 0) {
    throw new Error(`${fieldName} must be a non-negative integer`);
  }

  return normalized;
}

function normalizeNullablePositiveInteger(value: unknown, fieldName: string): number | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    throw new Error(`${fieldName} must be a positive integer or null`);
  }

  return normalized;
}

function requireNonEmptyString(value: unknown, fieldName: string): string {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    throw new Error(`${fieldName} is required`);
  }

  return normalized;
}
