import { afterEach, describe, expect, it, vi } from 'vitest'
import { encodePairingOffer } from '../../../src/shared/remote/pairing'
import { decodePairingUrl, extractPairingCodeFromUrl, parsePairingCode } from './pairing'

const offer = {
  v: 1,
  endpoint: 'ws://100.102.47.57:6868',
  deviceToken: 'token-abc',
  publicKeyB64: 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=',
  scope: 'mobile.control',
  hostName: 'Synapse'
} as const

function encodeOffer(input = offer): string {
  return new URL(encodePairingOffer(input)).searchParams.get('code') ?? ''
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('pairing deep links', () => {
  it('extracts the QR pairing code from the hash payload', () => {
    expect(extractPairingCodeFromUrl('synapse://pair#abc123')).toBe('abc123')
  })

  it('extracts the pairing code from a query param', () => {
    expect(extractPairingCodeFromUrl('synapse://pair?code=abc123')).toBe('abc123')
  })

  it('accepts scanner casing and surrounding whitespace', () => {
    expect(extractPairingCodeFromUrl('  SYNAPSE://PAIR?code=abc123\n')).toBe('abc123')
  })

  it('rejects lookalike routes', () => {
    expect(extractPairingCodeFromUrl('synapse://pairing?code=abc123')).toBeNull()
    expect(extractPairingCodeFromUrl('synapse://pair-extra?code=abc123')).toBeNull()
    expect(extractPairingCodeFromUrl('legacy://pair?code=abc123')).toBeNull()
  })

  it('prefers the query pairing code when both query and hash are present', () => {
    expect(extractPairingCodeFromUrl('synapse://pair?code=query-code#hash-code')).toBe(
      'query-code'
    )
  })

  it('ignores empty and unrelated URLs', () => {
    expect(extractPairingCodeFromUrl('synapse://pair')).toBeNull()
    expect(extractPairingCodeFromUrl('https://example.com/pair#abc123')).toBeNull()
  })

  it('decodes desktop QR payloads when atob requires base64 padding', () => {
    const realAtob = globalThis.atob
    vi.stubGlobal('atob', (input: string) => {
      if (input.length % 4 !== 0) {
        throw new Error('Invalid base64 length')
      }
      return realAtob(input)
    })

    expect(decodePairingUrl(`synapse://pair?code=${encodeOffer()}`)).toEqual(offer)
  })

  it('parses a full pairing URL and a bare copied code', () => {
    const code = encodeOffer()

    expect(parsePairingCode(`synapse://pair?code=${code}`)).toEqual(offer)
    expect(parsePairingCode(code)).toEqual(offer)
  })
})
