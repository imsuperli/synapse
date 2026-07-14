import { describe, expect, it } from 'vitest'
import {
  TERMINAL_FOREGROUND_SMALL_DELTA_BYTES,
  decideRemoteTerminalForegroundRecovery
} from './remote-terminal-foreground-recovery'

const base = {
  renderedSeq: 10,
  receivedSeq: 10,
  latestSeq: 10,
  deltaBytes: 0,
  gap: false,
  hasMoreAfter: false,
  pendingOverflowed: false
}

describe('remote terminal foreground recovery decision', () => {
  it('does nothing when desktop and mobile render cursors already match', () => {
    expect(decideRemoteTerminalForegroundRecovery(base)).toBe('none')
  })

  it('coalesces a complete small delta into one render', () => {
    expect(decideRemoteTerminalForegroundRecovery({
      ...base,
      receivedSeq: 12,
      latestSeq: 12,
      deltaBytes: 4096
    })).toBe('coalesced-write')
  })

  it('uses a compact snapshot when the bounded probe is incomplete', () => {
    expect(decideRemoteTerminalForegroundRecovery({
      ...base,
      latestSeq: 100,
      deltaBytes: TERMINAL_FOREGROUND_SMALL_DELTA_BYTES,
      hasMoreAfter: true
    })).toBe('compact-snapshot')
  })

  it('uses a compact snapshot for gaps, overflow, or oversized deltas', () => {
    expect(decideRemoteTerminalForegroundRecovery({ ...base, gap: true })).toBe(
      'compact-snapshot'
    )
    expect(decideRemoteTerminalForegroundRecovery({ ...base, pendingOverflowed: true })).toBe(
      'compact-snapshot'
    )
    expect(decideRemoteTerminalForegroundRecovery({
      ...base,
      deltaBytes: TERMINAL_FOREGROUND_SMALL_DELTA_BYTES + 1
    })).toBe('compact-snapshot')
  })
})
