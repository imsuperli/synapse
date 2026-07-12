import type { TerminalKeyboardAvoidanceMetrics } from './terminal-webview-contract'

type TerminalKeyboardAvoidanceOptions = {
  keyboardLift: number
  terminalFrameHeight: number
  metrics: TerminalKeyboardAvoidanceMetrics | null
}

export function getTerminalKeyboardAvoidanceLift({
  keyboardLift,
  terminalFrameHeight,
  metrics
}: TerminalKeyboardAvoidanceOptions): number {
  const lift = Math.max(0, keyboardLift)
  if (lift <= 0) {
    return 0
  }
  if (
    !metrics ||
    metrics.rows <= 0 ||
    terminalFrameHeight <= 0 ||
    !Number.isFinite(metrics.cursorBottomPx) ||
    !Number.isFinite(metrics.rowHeightPx) ||
    metrics.rowHeightPx <= 0
  ) {
    return lift
  }
  if (metrics.altScreen) {
    return lift
  }

  const raisedDockTop = terminalFrameHeight - lift
  return Math.min(
    lift,
    Math.max(0, metrics.cursorBottomPx + metrics.rowHeightPx - raisedDockTop)
  )
}
