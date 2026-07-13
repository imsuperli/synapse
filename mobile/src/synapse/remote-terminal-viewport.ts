export type RemoteTerminalViewport = {
  cols: number
  rows: number
}

export function normalizeDesktopTerminalViewport(
  viewport: { cols?: number; rows?: number } | null | undefined,
  fallback: RemoteTerminalViewport
): RemoteTerminalViewport {
  const cols = typeof viewport?.cols === 'number' && viewport.cols > 0
    ? Math.floor(viewport.cols)
    : fallback.cols
  const rows = typeof viewport?.rows === 'number' && viewport.rows > 0
    ? Math.floor(viewport.rows)
    : fallback.rows
  return { cols, rows }
}

export function resolveMobileTerminalViewport(
  desktopViewport: RemoteTerminalViewport,
  fittedPhoneRows: number
): RemoteTerminalViewport {
  const phoneRows = Number.isFinite(fittedPhoneRows) && fittedPhoneRows > 0
    ? Math.floor(fittedPhoneRows)
    : 0
  return {
    cols: desktopViewport.cols,
    rows: Math.max(desktopViewport.rows, phoneRows)
  }
}

export function sameRemoteTerminalViewport(
  a: RemoteTerminalViewport,
  b: RemoteTerminalViewport
): boolean {
  return a.cols === b.cols && a.rows === b.rows
}
