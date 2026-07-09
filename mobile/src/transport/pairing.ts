import {
  decodePairingOffer,
  parsePairingCode as parseSharedPairingCode,
  type PairingOffer
} from '../../../src/shared/remote/pairing'

export function decodePairingUrl(url: string): PairingOffer | null {
  try {
    return decodePairingOffer(url)
  } catch {
    return null
  }
}

// Why: system camera apps hand us the raw custom-scheme URL. Keeping
// extraction here makes QR scan, paste, and external deep-link flows
// accept the same URL shapes.
export function extractPairingCodeFromUrl(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url.trim())
  } catch {
    return null
  }
  if (
    parsed.protocol !== 'synapse:'
    || parsed.hostname.toLowerCase() !== 'pair'
    || (parsed.pathname !== '' && parsed.pathname !== '/')
  ) {
    return null
  }
  return parsed.searchParams.get('code') || (parsed.hash ? parsed.hash.slice(1) || null : null)
}

// Why: accept either a `synapse://pair?...` URL or the bare base64
// string so the paste-pair flow can take whichever the user actually
// copied from desktop.
export function parsePairingCode(input: string): PairingOffer | null {
  return parseSharedPairingCode(input)
}
