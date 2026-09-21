import { parsePairingCode } from './pairing'
import type { PairingOffer } from './types'

export type PairConfirmRouteState =
  | { kind: 'ready'; offer: PairingOffer; errorCode: null }
  | { kind: 'error'; offer: null; errorCode: 'missing-code' | 'invalid-code' }

export function resolvePairConfirmRouteState(code: string | undefined): PairConfirmRouteState {
  if (!code) {
    return { kind: 'error', offer: null, errorCode: 'missing-code' }
  }

  const offer = parsePairingCode(code)
  if (!offer) {
    return { kind: 'error', offer: null, errorCode: 'invalid-code' }
  }

  return { kind: 'ready', offer, errorCode: null }
}
