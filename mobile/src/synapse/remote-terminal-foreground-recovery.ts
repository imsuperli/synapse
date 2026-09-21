export const TERMINAL_FOREGROUND_SMALL_DELTA_BYTES = 256 * 1024
export const TERMINAL_FOREGROUND_RETRY_BASE_MS = 500
export const TERMINAL_FOREGROUND_RETRY_MAX_MS = 5_000

export function remoteTerminalForegroundRetryDelay(attempt: number): number {
  const safeAttempt = Math.max(0, Math.floor(attempt))
  return Math.min(
    TERMINAL_FOREGROUND_RETRY_MAX_MS,
    TERMINAL_FOREGROUND_RETRY_BASE_MS * 2 ** Math.min(safeAttempt, 8)
  )
}

export type RemoteTerminalForegroundRecoveryDecision =
  | 'none'
  | 'coalesced-write'
  | 'compact-snapshot'

export function decideRemoteTerminalForegroundRecovery(options: {
  renderedSeq: number
  receivedSeq: number
  latestSeq: number
  deltaBytes: number
  gap: boolean
  hasMoreAfter: boolean
  pendingOverflowed: boolean
}): RemoteTerminalForegroundRecoveryDecision {
  if (
    options.gap ||
    options.hasMoreAfter ||
    options.pendingOverflowed ||
    options.deltaBytes > TERMINAL_FOREGROUND_SMALL_DELTA_BYTES
  ) {
    return 'compact-snapshot'
  }
  if (
    options.receivedSeq > options.renderedSeq ||
    options.latestSeq > options.renderedSeq ||
    options.deltaBytes > 0
  ) {
    return 'coalesced-write'
  }
  return 'none'
}
