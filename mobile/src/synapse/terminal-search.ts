import type { RemoteTerminalSummary, RemoteWindowSummary } from './remote'

export function normalizeTerminalSearchQuery(value: string): string {
  return value.trim().toLowerCase()
}

function matchesSearch(parts: Array<string | null | undefined>, query: string): boolean {
  if (!query) {
    return true
  }
  return parts.some((part) => part?.toLowerCase().includes(query))
}

export function filterWindows(
  windows: RemoteWindowSummary[],
  query: string
): RemoteWindowSummary[] {
  if (!query) {
    return windows
  }
  return windows.flatMap((window) => {
    const filteredPanes = window.panes.filter((pane) =>
      matchesSearch(
        [
          window.name,
          pane.title,
          pane.command,
          pane.cwd,
          pane.pid == null ? null : String(pane.pid),
          pane.backend,
          pane.status
        ],
        query
      )
    )
    if (filteredPanes.length === 0) {
      return []
    }
    return [
      {
        ...window,
        panes: filteredPanes,
        terminalPaneCount: filteredPanes.filter((pane) => pane.kind === 'terminal').length
      }
    ]
  })
}

export function filterTerminals(
  terminals: RemoteTerminalSummary[],
  query: string
): RemoteTerminalSummary[] {
  if (!query) {
    return terminals
  }
  return terminals.filter((terminal) =>
    matchesSearch(
      [
        terminal.command,
        terminal.workingDirectory,
        terminal.backend,
        terminal.status,
        terminal.pid ? String(terminal.pid) : null,
        terminal.windowId,
        terminal.paneId
      ],
      query
    )
  )
}
