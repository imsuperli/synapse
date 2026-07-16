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
  desktopViewport: RemoteTerminalViewport
): RemoteTerminalViewport {
  // Remote output is replayed from a PTY that already used this exact grid.
  // Changing only the mobile xterm rows alters cursor addressing, scroll
  // regions, and clear operations, which can turn a valid snapshot blank.
  return { ...desktopViewport }
}

export function sameRemoteTerminalViewport(
  a: RemoteTerminalViewport,
  b: RemoteTerminalViewport
): boolean {
  return a.cols === b.cols && a.rows === b.rows
}
