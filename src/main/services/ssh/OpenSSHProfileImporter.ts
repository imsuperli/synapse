import fs from 'fs/promises';
import path from 'path';
import { createHash, randomUUID } from 'crypto';
import SSHConfig, { Directive, LineType } from 'ssh-config';
import type { ForwardedPortConfig, SSHProfileInput } from '../../../shared/types/ssh';

type ImportedProfile = {
  id: string;
  input: SSHProfileInput;
};

export interface OpenSSHProfileImporterOptions {
  homeDir?: string;
}

const SIMPLE_ALIAS_PATTERN = /^[A-Za-z0-9._-]+$/;
const DISABLED_PROXY_JUMP_VALUES = new Set(['none']);

export class OpenSSHProfileImporter {
  private readonly homeDir: string;
  private readonly sshDir: string;

  constructor(options: OpenSSHProfileImporterOptions = {}) {
    this.homeDir = options.homeDir ?? process.env.HOME ?? process.env.USERPROFILE ?? '';
    this.sshDir = path.join(this.homeDir, '.ssh');
  }

  async importProfiles(): Promise<ImportedProfile[]> {
    if (!this.homeDir) {
      return [];
    }

    const configPath = path.join(this.sshDir, 'config');
    const config = await parseSSHConfigFile(configPath, this.sshDir);
    return convertToImportedProfiles(config, this.homeDir);
  }

  async detectPrivateKeys(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.sshDir, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .filter((name) => /^id_[A-Za-z0-9._-]+$/.test(name) && !name.endsWith('.pub'))
        .sort()
        .map((name) => path.join(this.sshDir, name));
    } catch (error) {
      if (isMissingFileError(error)) {
        return [];
      }

      throw error;
    }
  }
}

async function parseSSHConfigFile(
  filePath: string,
  sshDir: string,
  visited = new Set<string>(),
): Promise<SSHConfig> {
  if (visited.has(filePath)) {
    return SSHConfig.parse('');
  }
  visited.add(filePath);

  let raw = '';
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (isMissingFileError(error)) {
      return SSHConfig.parse('');
    }

    throw error;
  }

  const parsed = SSHConfig.parse(raw);
  const merged = SSHConfig.parse('');

  for (const entry of parsed) {
    if (entry.type === LineType.DIRECTIVE && entry.param.toLowerCase() === 'include') {
      for (const includePath of await resolveIncludeMatches(extractDirectiveValues(entry), sshDir)) {
        const stat = await fs.stat(includePath);
        if (stat.isDirectory()) {
          continue;
        }

        const nestedConfig = await parseSSHConfigFile(includePath, sshDir, visited);
        merged.push(...nestedConfig);
      }
      continue;
    }

    merged.push(entry);
  }

  return merged;
}

async function resolveIncludeMatches(patterns: string[], sshDir: string): Promise<string[]> {
  const results = new Set<string>();

  for (const pattern of patterns) {
    const resolvedPattern = resolveIncludePattern(pattern, sshDir);
    for await (const match of fs.glob(resolvedPattern)) {
      results.add(path.resolve(match));
    }
  }

  return Array.from(results).sort();
}

function resolveIncludePattern(pattern: string, sshDir: string): string {
  if (path.isAbsolute(pattern)) {
    return pattern;
  }

  if (pattern.startsWith('~/')) {
    return path.join(sshDir, '..', pattern.slice(2));
  }

  return path.join(sshDir, pattern);
}

async function convertToImportedProfiles(config: SSHConfig, homeDir: string): Promise<ImportedProfile[]> {
  const profilesByAlias = new Map<string, ImportedProfile>();

  for (const entry of config) {
    if (entry.type !== LineType.DIRECTIVE || entry.param.toLowerCase() !== 'host') {
      continue;
    }

    for (const alias of extractDirectiveValues(entry)) {
      if (!alias || hasWildcards(alias) || profilesByAlias.has(alias)) {
        continue;
      }

      const settings = config.compute(alias, { ignoreCase: true });
      const imported = convertHostToImportedProfile(alias, settings, homeDir);
      profilesByAlias.set(alias, imported);
    }
  }

  return Array.from(profilesByAlias.values()).sort((left, right) => (
    left.input.name.localeCompare(right.input.name)
  ));
}

function convertHostToImportedProfile(
  alias: string,
  settings: Record<string, string | string[]>,
  homeDir: string,
): ImportedProfile {
  const resolvedHost = readFirstString(settings.hostname) ?? alias;
  const privateKeys = expandIdentityFiles(settings.identityfile, homeDir);
  const proxyJump = readFirstString(settings.proxyjump);
  const jumpHostProfileId = resolveJumpHostReference(proxyJump);
  const proxyCommand = normalizeOptionalString(readFirstString(settings.proxycommand));
  const remoteCommand = normalizeOptionalString(readFirstString(settings.remotecommand));
  const routingMode = jumpHostProfileId ? 'jumpHost' : proxyCommand ? 'proxyCommand' : 'direct';

  return {
    id: buildImportedProfileId(alias),
    input: {
      name: `${alias} (.ssh/config)`,
      host: resolvedHost,
      port: readInteger(settings.port, 22),
      user: readFirstString(settings.user) ?? process.env.USER ?? process.env.USERNAME ?? 'root',
      auth: privateKeys.length > 0 ? 'publicKey' : 'agent',
      privateKeys,
      keepaliveInterval: readInteger(settings.serveraliveinterval, 30),
      keepaliveCountMax: readInteger(settings.serveralivecountmax, 3),
      readyTimeout: readPositiveInteger(settings.connecttimeout, null, 1000),
      verifyHostKeys: true,
      x11: readYesNo(settings.forwardx11, false),
      skipBanner: false,
      ...(routingMode !== 'direct' ? { routingMode } : {}),
      ...(jumpHostProfileId ? { jumpHostProfileId } : {}),
      agentForward: readYesNo(settings.forwardagent, false),
      warnOnClose: true,
      ...(proxyCommand ? { proxyCommand } : {}),
      reuseSession: true,
      forwardedPorts: [
        ...readForwardedPorts(settings.localforward, 'local'),
        ...readForwardedPorts(settings.remoteforward, 'remote'),
        ...readForwardedPorts(settings.dynamicforward, 'dynamic'),
      ],
      ...(remoteCommand ? { remoteCommand } : {}),
      tags: [],
    },
  };
}

function buildImportedProfileId(alias: string): string {
  return `openssh-config:${createHash('sha256').update(alias).digest('hex')}`;
}

function hasWildcards(value: string): boolean {
  return /[*?]/.test(value);
}

function extractDirectiveValues(entry: Directive): string[] {
  if (typeof entry.value === 'string') {
    return entry.value.trim().split(/\s+/).filter(Boolean);
  }

  return entry.value.map((value) => value.val.trim()).filter(Boolean);
}

function readFirstString(value: string | string[] | undefined): string | undefined {
  if (typeof value === 'string') {
    const normalized = normalizeOptionalString(value);
    return normalized || undefined;
  }

  if (Array.isArray(value)) {
    const normalizedItems = value
      .map((item) => normalizeOptionalString(item))
      .filter((item): item is string => Boolean(item));
    return normalizedItems[0];
  }

  return undefined;
}

function readInteger(
  value: string | string[] | undefined,
  fallback: number,
  multiplier = 1,
): number {
  const normalized = readFirstString(value);
  if (!normalized) {
    return fallback;
  }

  const parsed = Number(normalized);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return fallback;
  }

  return parsed * multiplier;
}

function readPositiveInteger(
  value: string | string[] | undefined,
  fallback: number | null,
  multiplier = 1,
): number | null {
  const normalized = readFirstString(value);
  if (!normalized) {
    return fallback;
  }

  const parsed = Number(normalized);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed * multiplier;
}

function readYesNo(value: string | string[] | undefined, fallback: boolean): boolean {
  const normalized = readFirstString(value)?.toLowerCase();
  if (normalized === 'yes') {
    return true;
  }
  if (normalized === 'no') {
    return false;
  }

  return fallback;
}

function expandIdentityFiles(value: string | string[] | undefined, homeDir: string): string[] {
  const items = typeof value === 'string'
    ? [value]
    : Array.isArray(value)
      ? value
      : [];

  return Array.from(new Set(
    items
      .map((item) => normalizeOptionalString(item))
      .filter(Boolean)
      .map((item) => expandHomePath(item as string, homeDir)),
  ));
}

function expandHomePath(value: string, homeDir: string): string {
  if (value === '~') {
    return homeDir;
  }

  if (value.startsWith('~/')) {
    return path.join(homeDir, value.slice(2));
  }

  return value;
}

function resolveJumpHostReference(proxyJump: string | undefined): string | undefined {
  const normalized = normalizeOptionalString(proxyJump);
  if (!normalized) {
    return undefined;
  }

  if (DISABLED_PROXY_JUMP_VALUES.has(normalized.toLowerCase())) {
    return undefined;
  }

  if (!SIMPLE_ALIAS_PATTERN.test(normalized)) {
    return undefined;
  }

  return buildImportedProfileId(normalized);
}

function readForwardedPorts(
  value: string | string[] | undefined,
  type: ForwardedPortConfig['type'],
): ForwardedPortConfig[] {
  const items = typeof value === 'string'
    ? [value]
    : Array.isArray(value)
      ? value
      : [];

  return items
    .map((item) => parseForwardedPort(item, type))
    .filter((item): item is ForwardedPortConfig => Boolean(item));
}

function parseForwardedPort(
  value: string,
  type: ForwardedPortConfig['type'],
): ForwardedPortConfig | null {
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  if (type === 'dynamic') {
    const bind = parseBindTarget(normalized);
    if (!bind) {
      return null;
    }

    return {
      id: randomUUID(),
      type,
      host: bind.host,
      port: bind.port,
      targetAddress: 'socks',
      targetPort: 0,
      description: normalized,
    };
  }

  const [bindSpec, targetSpec] = normalized.split(/\s+/, 2);
  if (!bindSpec || !targetSpec) {
    return null;
  }

  const bind = parseBindTarget(bindSpec);
  const target = parseBindTarget(targetSpec, true);
  if (!bind || !target) {
    return null;
  }

  return {
    id: randomUUID(),
    type,
    host: bind.host,
    port: bind.port,
    targetAddress: target.host,
    targetPort: target.port,
    description: normalized,
  };
}

function parseBindTarget(
  value: string,
  requireHost = false,
): { host: string; port: number } | null {
  const parts = value.split(':').map((item) => item.trim()).filter(Boolean);
  if (parts.length === 0) {
    return null;
  }

  if (parts.length === 1) {
    const port = Number(parts[0]);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return null;
    }

    return {
      host: requireHost ? '' : '127.0.0.1',
      port,
    };
  }

  const port = Number(parts.at(-1));
  const host = parts.slice(0, -1).join(':');
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
    return null;
  }

  return {
    host,
    port,
  };
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return !!error && typeof error === 'object' && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT';
}
