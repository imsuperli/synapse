export const TERMINAL_FOREGROUND_SMALL_DELTA_BYTES = 256 * 1024

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
