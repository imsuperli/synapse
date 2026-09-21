import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'

import { encodePairingOffer } from '../../../src/shared/remote/pairing'
import { resolvePairConfirmRouteState } from './pair-confirm-state'
import type { PairingOffer } from './types'

function encodeOffer(offer: PairingOffer): string {
  return new URL(encodePairingOffer(offer)).searchParams.get('code') ?? ''
}

describe('resolvePairConfirmRouteState', () => {
  const offer: PairingOffer = {
    v: 1,
    endpoint: 'ws://192.168.1.10:6868',
    deviceToken: 'token-abc',
    publicKeyB64: Buffer.alloc(32, 1).toString('base64'),
    scope: 'mobile.control',
    hostName: 'Synapse'
  }

  it('accepts a valid pairing code', () => {
    expect(resolvePairConfirmRouteState(encodeOffer(offer))).toEqual({
      kind: 'ready',
      offer,
      errorCode: null
    })
  })

  it('accepts a full pairing URL', () => {
    expect(resolvePairConfirmRouteState(`synapse://pair#${encodeOffer(offer)}`)).toEqual({
      kind: 'ready',
      offer,
      errorCode: null
    })
  })

  it('reports a missing pairing code', () => {
    expect(resolvePairConfirmRouteState(undefined)).toEqual({
      kind: 'error',
      offer: null,
      errorCode: 'missing-code'
    })
  })

  it('reports an invalid pairing code', () => {
    expect(resolvePairConfirmRouteState('not a pairing code')).toEqual({
      kind: 'error',
      offer: null,
      errorCode: 'invalid-code'
    })
  })
})
