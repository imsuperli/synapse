import { z } from 'zod';
import { base64UrlToBytes, bytesToBase64Url, bytesToUtf8, utf8ToBytes } from './encoding';
import { REMOTE_PROTOCOL_VERSION, type RemoteDeviceScope } from './methods';

const PairingScopeSchema = z.enum([
  'mobile.read',
  'mobile.control',
  'mobile.window-control',
  'mobile.admin',
]);

export const PairingOfferSchema = z.object({
  v: z.literal(REMOTE_PROTOCOL_VERSION),
  endpoint: z.string().min(1),
  deviceToken: z.string().min(1),
  publicKeyB64: z.string().min(1),
  scope: PairingScopeSchema,
  hostName: z.string().min(1).optional(),
  relaySessionId: z.string().min(1).optional(),
});

export type PairingOffer = z.infer<typeof PairingOfferSchema>;

export const PAIRING_URL_SCHEME = 'synapse:';
export const PAIRING_URL_HOST = 'pair';

export function encodePairingOffer(offer: PairingOffer): string {
  const validated = PairingOfferSchema.parse(offer);
  const code = bytesToBase64Url(utf8ToBytes(JSON.stringify(validated)));
  return `synapse://pair?code=${code}`;
}

export function decodePairingOffer(url: string): PairingOffer {
  const code = extractPairingCode(url);
  if (!code) {
    throw new Error('Invalid pairing URL: expected synapse://pair?code=...');
  }
  return decodePairingCode(code);
}

export function parsePairingCode(input: string): PairingOffer | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return trimmed.toLowerCase().startsWith('synapse://')
      ? decodePairingOffer(trimmed)
      : decodePairingCode(trimmed);
  } catch {
    return null;
  }
}

export function createPairingOfferPayload(args: {
  endpoint: string;
  deviceToken: string;
  publicKeyB64: string;
  scope?: RemoteDeviceScope;
  hostName?: string;
  relaySessionId?: string;
}): PairingOffer {
  return PairingOfferSchema.parse({
    v: REMOTE_PROTOCOL_VERSION,
    endpoint: args.endpoint,
    deviceToken: args.deviceToken,
    publicKeyB64: args.publicKeyB64,
    scope: args.scope ?? 'mobile.control',
    hostName: args.hostName,
    relaySessionId: args.relaySessionId,
  });
}

function extractPairingCode(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== PAIRING_URL_SCHEME || parsed.hostname !== PAIRING_URL_HOST) {
    return null;
  }
  if (parsed.pathname !== '' && parsed.pathname !== '/') {
    return null;
  }
  return parsed.searchParams.get('code') || (parsed.hash ? parsed.hash.slice(1) || null : null);
}

function decodePairingCode(base64url: string): PairingOffer {
  const json = bytesToUtf8(base64UrlToBytes(base64url));
  return PairingOfferSchema.parse(JSON.parse(json));
}
