import { describe, expect, it } from 'vitest'

import { WindowStatus } from '../../../src/shared/types/window'
import type { RemoteTerminalSummary, RemoteWindowSummary } from './remote'
import {
  filterTerminals,
  filterWindows,
  normalizeTerminalSearchQuery
} from './terminal-search'

describe('mobile terminal search', () => {
  it('normalizes search queries', () => {
    expect(normalizeTerminalSearchQuery('  Repo  ')).toBe('repo')
  })

  it('filters flat terminal rows by command, directory, and ids', () => {
    const terminals: RemoteTerminalSummary[] = [
      {
        windowId: 'win-alpha',
        paneId: 'pane-1',
        sessionId: 's1',
        pid: 111,
        backend: 'local',
        status: 'alive',
        workingDirectory: '/workspace/api',
        command: 'bash'
      },
      {
        windowId: 'win-beta',
        paneId: 'pane-2',
        sessionId: 's2',
        pid: 222,
        backend: 'ssh',
        status: 'exited',
        workingDirectory: '/srv/web',
        command: 'zsh'
      }
    ]

    expect(filterTerminals(terminals, 'api')).toEqual([terminals[0]])
    expect(filterTerminals(terminals, '222')).toEqual([terminals[1]])
    expect(filterTerminals(terminals, 'win-beta')).toEqual([terminals[1]])
  })

  it('filters window cards while keeping matching panes inside a split window', () => {
    const windows: RemoteWindowSummary[] = [
      {
        windowId: 'win-1',
        name: 'Project',
        kind: 'mixed',
        archived: false,
        activePaneId: 'pane-api',
        createdAt: '',
        lastActiveAt: '',
        paneCount: 2,
        terminalPaneCount: 2,
        panes: [
          {
            windowId: 'win-1',
            paneId: 'pane-api',
            active: true,
            kind: 'terminal',
            backend: 'local',
            status: WindowStatus.WaitingForInput,
            running: true,
            pid: 11,
            sessionId: 's1',
            cwd: '/repo/api',
            command: 'bash'
          },
          {
            windowId: 'win-1',
            paneId: 'pane-web',
            active: false,
            kind: 'terminal',
            backend: 'local',
            status: WindowStatus.Completed,
            running: false,
            pid: null,
            sessionId: null,
            cwd: '/repo/web',
            command: 'zsh'
          }
        ]
      }
    ]

    expect(filterWindows(windows, 'web')).toEqual([
      expect.objectContaining({
        windowId: 'win-1',
        terminalPaneCount: 1,
        panes: [expect.objectContaining({ paneId: 'pane-web' })]
      })
    ])
  })
})
