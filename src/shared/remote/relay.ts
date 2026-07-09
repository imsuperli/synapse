export const DEFAULT_RELAY_PATH = '/v1/relay';

export type RelayHostUrlConfig = {
  sessionId: string;
  hostToken: string;
  clientTokenHash: string;
  ttlSeconds?: number;
};

export type RelayClientUrlConfig = {
  sessionId: string;
  clientToken: string;
};

export function normalizeRelayEndpoint(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('Relay endpoint is required');
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error('Relay endpoint must be a valid ws:// or wss:// URL');
  }

  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    throw new Error('Relay endpoint must use ws:// or wss://');
  }
  if (url.username || url.password) {
    throw new Error('Relay endpoint must not include credentials');
  }
  if (url.search || url.hash) {
    throw new Error('Relay endpoint must not include query parameters or fragments');
  }

  if (url.pathname === '' || url.pathname === '/') {
    url.pathname = DEFAULT_RELAY_PATH;
  } else if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.replace(/\/+$/, '');
  }

  return url.toString();
}

export function buildRelayHostUrl(endpoint: string, config: RelayHostUrlConfig): string {
  const url = new URL(normalizeRelayEndpoint(endpoint));
  url.searchParams.set('role', 'host');
  url.searchParams.set('sessionId', config.sessionId);
  url.searchParams.set('hostToken', config.hostToken);
  url.searchParams.set('clientTokenHash', config.clientTokenHash);
  if (config.ttlSeconds !== undefined) {
    url.searchParams.set('ttlSeconds', String(Math.max(1, Math.floor(config.ttlSeconds))));
  }
  return url.toString();
}

export function buildRelayClientUrl(endpoint: string, config: RelayClientUrlConfig): string {
  const url = new URL(normalizeRelayEndpoint(endpoint));
  url.searchParams.set('role', 'client');
  url.searchParams.set('sessionId', config.sessionId);
  url.searchParams.set('clientToken', config.clientToken);
  return url.toString();
}
