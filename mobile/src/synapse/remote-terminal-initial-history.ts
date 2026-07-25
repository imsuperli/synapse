import type { TerminalHistoryMetrics } from '../terminal/terminal-webview-contract'

export const INITIAL_TERMINAL_HISTORY_DELAY_MS = 350
export const INITIAL_TERMINAL_HISTORY_MAX_STAGES = 3
export const INITIAL_TERMINAL_HISTORY_MAX_BYTES = 3 * 192 * 1024
export const INITIAL_TERMINAL_HISTORY_TARGET_SCREENS = 2

export function terminalInitialHistoryTargetReached(
  metrics: TerminalHistoryMetrics | null | undefined
): boolean {
  if (!metrics || metrics.viewportRows <= 0) {
    return false
  }
  const targetRows = Math.max(
    metrics.viewportRows,
    metrics.viewportRows * INITIAL_TERMINAL_HISTORY_TARGET_SCREENS
  )
  return metrics.scrollbackRows >= targetRows && metrics.nonEmptyScrollbackRows >= targetRows
}

export function shouldLoadInitialTerminalHistory(input: {
  metrics: TerminalHistoryMetrics | null | undefined
  stages: number
  activatedBytes: number
  hasMoreBefore: boolean
}): boolean {
  return (
    input.hasMoreBefore &&
    input.stages < INITIAL_TERMINAL_HISTORY_MAX_STAGES &&
    input.activatedBytes < INITIAL_TERMINAL_HISTORY_MAX_BYTES &&
    !terminalInitialHistoryTargetReached(input.metrics)
  )
}
