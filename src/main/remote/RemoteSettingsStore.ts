import { join } from 'path';
import { z } from 'zod';
import { DEFAULT_REMOTE_WS_PORT } from './RemoteWebSocketTransport';
import { readJsonFileIfPresent, writeSecureJsonFile } from './RemoteSecureFile';

export const REMOTE_SETTINGS_FILENAME = 'synapse-remote-settings.json';

const MAX_SETTINGS_FILE_BYTES = 128 * 1024;

export type RemoteSettings = {
  enabled: boolean;
  bindHost: string;
  preferredPort: number;
  selectedAddress: string | null;
  manualEndpoint: string | null;
  acceptedPlainWsNonLocal: boolean;
  startOnLaunch: boolean;
};

export type RemoteSettingsPatch = Partial<RemoteSettings> & {
  acceptPlainWsNonLocal?: boolean;
};

export type RemoteEndpointValidationResult = {
  requiresAcknowledgement: boolean;
  reason: string | null;
};

export const DEFAULT_REMOTE_SETTINGS: RemoteSettings = {
  enabled: false,
  bindHost: '0.0.0.0',
  preferredPort: DEFAULT_REMOTE_WS_PORT,
  selectedAddress: null,
  manualEndpoint: null,
  acceptedPlainWsNonLocal: false,
  startOnLaunch: false,
};

const RemoteSettingsSchema = z.object({
  enabled: z.boolean().catch(DEFAULT_REMOTE_SETTINGS.enabled),
  bindHost: z.string().min(1).catch(DEFAULT_REMOTE_SETTINGS.bindHost),
  preferredPort: z.number().int().min(0).max(65_535).catch(DEFAULT_REMOTE_SETTINGS.preferredPort),
  selectedAddress: z.string().min(1).nullable().catch(DEFAULT_REMOTE_SETTINGS.selectedAddress),
  manualEndpoint: z.string().min(1).nullable().catch(DEFAULT_REMOTE_SETTINGS.manualEndpoint),
  acceptedPlainWsNonLocal: z.boolean().catch(DEFAULT_REMOTE_SETTINGS.acceptedPlainWsNonLocal),
  startOnLaunch: z.boolean().catch(DEFAULT_REMOTE_SETTINGS.startOnLaunch),
});

const RemoteSettingsPatchSchema = z.object({
  enabled: z.boolean().optional(),
  bindHost: z.string().trim().min(1).optional(),
  preferredPort: z.number().int().min(0).max(65_535).optional(),
  selectedAddress: z.string().trim().nullable().optional(),
  manualEndpoint: z.string().trim().nullable().optional(),
  acceptedPlainWsNonLocal: z.boolean().optional(),
  acceptPlainWsNonLocal: z.boolean().optional(),
  startOnLaunch: z.boolean().optional(),
}).strict();

export class RemoteSettingsStore {
  private readonly settingsPath: string;
  private settings: RemoteSettings;

  constructor(userDataPath: string) {
    this.settingsPath = join(userDataPath, REMOTE_SETTINGS_FILENAME);
    this.settings = this.load();
  }

  getSettings(): RemoteSettings {
    return { ...this.settings };
  }

  update(patch: RemoteSettingsPatch): RemoteSettings {
    const parsed = normalizeSettingsPatch(patch);
    const next: RemoteSettings = {
      ...this.settings,
      ...parsed,
      acceptedPlainWsNonLocal:
        parsed.acceptPlainWsNonLocal ?? parsed.acceptedPlainWsNonLocal
        ?? this.settings.acceptedPlainWsNonLocal,
    };
    delete (next as RemoteSettings & { acceptPlainWsNonLocal?: boolean }).acceptPlainWsNonLocal;
    validateRemoteSettings(next);
    this.settings = next;
    this.save();
    return this.getSettings();
  }

  replace(settings: RemoteSettings): RemoteSettings {
    const next = normalizeSettings(settings);
    validateRemoteSettings(next);
    this.settings = next;
    this.save();
    return this.getSettings();
  }

  private load(): RemoteSettings {
    try {
      const parsed = readJsonFileIfPresent<unknown>(this.settingsPath, MAX_SETTINGS_FILE_BYTES);
      return parsed ? normalizeSettings(parsed) : { ...DEFAULT_REMOTE_SETTINGS };
    } catch {
      return { ...DEFAULT_REMOTE_SETTINGS };
    }
  }

  private save(): void {
    writeSecureJsonFile(this.settingsPath, this.settings);
  }
}

export function validateRemoteSettings(settings: RemoteSettings): void {
  validateBindHost(settings.bindHost);
  validatePort(settings.preferredPort);
  validateEndpointOverride(settings.manualEndpoint, settings.acceptedPlainWsNonLocal);
  validateEndpointOverride(settings.selectedAddress, settings.acceptedPlainWsNonLocal);
}

export function validateEndpointOverride(
  override: string | null | undefined,
  acceptedPlainWsNonLocal = false,
): RemoteEndpointValidationResult {
  const trimmed = override?.trim();
  if (!trimmed) {
    return { requiresAcknowledgement: false, reason: null };
  }

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    const parsed = parseEndpointUrl(trimmed);
    if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
      throw new Error('Remote endpoint must use ws:// or wss://');
    }
    if (parsed.protocol === 'wss:') {
      return { requiresAcknowledgement: false, reason: null };
    }
    return validatePlainWsHost(parsed.hostname, acceptedPlainWsNonLocal);
  }

  const parsed = parseHostPortOverride(trimmed);
  return validatePlainWsHost(parsed.host, acceptedPlainWsNonLocal);
}

export function isLocalOrPrivateRemoteHost(host: string): boolean {
  const normalized = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    normalized === 'localhost'
    || normalized.endsWith('.localhost')
    || normalized.endsWith('.local')
    || normalized.endsWith('.ts.net')
  ) {
    return true;
  }

  if (normalized === '::1') {
    return true;
  }

  if (normalized.includes(':')) {
    return isPrivateIPv6(normalized);
  }

  return isPrivateIPv4(normalized);
}

function normalizeSettings(input: unknown): RemoteSettings {
  const parsed = RemoteSettingsSchema.parse(input);
  return {
    ...parsed,
    selectedAddress: normalizeNullableString(parsed.selectedAddress),
    manualEndpoint: normalizeNullableString(parsed.manualEndpoint),
  };
}

function normalizeSettingsPatch(patch: RemoteSettingsPatch) {
  const parsed = RemoteSettingsPatchSchema.parse(patch);
  const normalized = { ...parsed };
  if ('selectedAddress' in parsed) {
    normalized.selectedAddress = normalizeNullableString(parsed.selectedAddress);
  }
  if ('manualEndpoint' in parsed) {
    normalized.manualEndpoint = normalizeNullableString(parsed.manualEndpoint);
  }
  return normalized;
}

function normalizeNullableString(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return value ?? null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function validateBindHost(host: string): void {
  if (!host.trim()) {
    throw new Error('Remote bind host is required');
  }
}

function validatePort(port: number): void {
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error('Remote port must be between 0 and 65535');
  }
}

function parseEndpointUrl(endpoint: string): URL {
  try {
    return new URL(endpoint);
  } catch {
    throw new Error('Remote endpoint is not a valid URL');
  }
}

function parseHostPortOverride(address: string): { host: string; port: string | null } {
  if (address.startsWith('[') || address.split(':').length === 2) {
    try {
      const parsed = new URL(`ws://${address}`);
      return { host: parsed.hostname.replace(/^\[|\]$/g, ''), port: parsed.port || null };
    } catch {
      return { host: address, port: null };
    }
  }
  return { host: address, port: null };
}

function validatePlainWsHost(
  host: string,
  acceptedPlainWsNonLocal: boolean,
): RemoteEndpointValidationResult {
  if (isLocalOrPrivateRemoteHost(host)) {
    return { requiresAcknowledgement: false, reason: null };
  }
  if (!acceptedPlainWsNonLocal) {
    throw new Error('Public-looking ws:// remote endpoints require explicit acknowledgement');
  }
  return {
    requiresAcknowledgement: true,
    reason: 'Plain ws:// on a public-looking endpoint was explicitly acknowledged',
  };
}

function isPrivateIPv4(host: string): boolean {
  const parts = host.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = parts;
  return (
    a === 10
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || a === 127
    || (a === 169 && b === 254)
    || (a === 100 && b >= 64 && b <= 127)
  );
}

function isPrivateIPv6(host: string): boolean {
  const normalized = host.toLowerCase();
  return normalized === '::1'
    || normalized.startsWith('fc')
    || normalized.startsWith('fd')
    || normalized.startsWith('fe80:');
}
