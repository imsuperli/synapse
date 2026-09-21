import { describe, expect, it } from 'vitest'
import {
  INITIAL_TERMINAL_HISTORY_MAX_BYTES,
  INITIAL_TERMINAL_HISTORY_MAX_STAGES,
  shouldLoadInitialTerminalHistory,
  terminalInitialHistoryTargetReached
} from './remote-terminal-initial-history'

const sparseMetrics = {
  viewportRows: 40,
  scrollbackRows: 120,
  nonEmptyScrollbackRows: 12,
  scannedScrollbackRows: 120
}

describe('remote terminal initial history policy', () => {
  it('continues until at least two screens of non-empty scrollback are ready', () => {
    expect(terminalInitialHistoryTargetReached(sparseMetrics)).toBe(false)
    expect(
      terminalInitialHistoryTargetReached({
        ...sparseMetrics,
        scrollbackRows: 80,
        nonEmptyScrollbackRows: 80
      })
    ).toBe(true)
  })

  it('stops at the stage and byte bounds even when Codex output remains sparse', () => {
    expect(
      shouldLoadInitialTerminalHistory({
        metrics: sparseMetrics,
        stages: 0,
        activatedBytes: 0,
        hasMoreBefore: true
      })
    ).toBe(true)
    expect(
      shouldLoadInitialTerminalHistory({
        metrics: sparseMetrics,
        stages: INITIAL_TERMINAL_HISTORY_MAX_STAGES,
        activatedBytes: 0,
        hasMoreBefore: true
      })
    ).toBe(false)
    expect(
      shouldLoadInitialTerminalHistory({
        metrics: sparseMetrics,
        stages: 0,
        activatedBytes: INITIAL_TERMINAL_HISTORY_MAX_BYTES,
        hasMoreBefore: true
      })
    ).toBe(false)
  })

  it('does not schedule work after the desktop history boundary', () => {
    expect(
      shouldLoadInitialTerminalHistory({
        metrics: null,
        stages: 0,
        activatedBytes: 0,
        hasMoreBefore: false
      })
    ).toBe(false)
  })
})
