import type { ConnectionState } from '../transport/types'

const TRANSIENT_TERMINAL_CONNECTION_ERRORS = new Set(['Connection interrupted'])

export function terminalErrorAfterConnectionState(
  error: string | null,
  state: ConnectionState
): string | null {
  if (state === 'connected' && error && TRANSIENT_TERMINAL_CONNECTION_ERRORS.has(error)) {
    return null
  }
  return error
}
