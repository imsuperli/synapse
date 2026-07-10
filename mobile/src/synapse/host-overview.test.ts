import { describe, expect, it, vi } from 'vitest'

vi.mock('../transport/host-store', () => ({
  loadHosts: vi.fn(),
  updateLastConnected: vi.fn()
}))

vi.mock('../transport/rpc-client', () => ({
  connect: vi.fn()
}))

import {
  canCreateWindow,
  canUseWindowList,
  flattenTerminalPanes,
  loadHostOverviewData
} from './host-overview'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'

function mockClient(responses: Record<string, RpcResponse>): RpcClient {
  return {
    sendRequest: vi.fn(async (method: string) => {
      const response = responses[method]
      if (!response) {
        throw new Error(`Unexpected method: ${method}`)
      }
      return response
    }),
    subscribe: vi.fn(),
    updateTerminalSubscriptionViewport: vi.fn(),
    getState: () => 'connected',
    getReconnectAttempt: () => 0,
    getLastConnectedAt: () => Date.now(),
    onStateChange: vi.fn(),
    notifyForeground: vi.fn(),
    close: vi.fn()
  } as unknown as RpcClient
}

describe('Synapse Mobile host overview data', () => {
  it('uses terminal.list for the default mobile.control scope', async () => {
    const client = mockClient({
      'status.get': {
        id: 'rpc-1',
        ok: true,
        result: { ok: true, protocolVersion: 1, deviceScope: 'mobile.control' }
      },
      'remote.capabilities': {
        id: 'rpc-2',
        ok: true,
        result: { protocolVersion: 1, methods: ['window.list', 'terminal.list'] }
      },
      'terminal.list': {
        id: 'rpc-3',
        ok: true,
        result: {
          terminals: [
            {
              windowId: 'w1',
              paneId: 'p1',
              sessionId: 's1',
              pid: 7,
              backend: 'local',
              status: 'alive',
              workingDirectory: '/repo'
            }
          ]
        }
      }
    })

    await expect(loadHostOverviewData(client)).resolves.toMatchObject({
      mode: 'terminals',
      deviceScope: 'mobile.control',
      canCreateWindow: false,
      groups: [],
      terminals: [{ windowId: 'w1', paneId: 'p1' }]
    })
    expect(client.sendRequest).not.toHaveBeenCalledWith('window.list', expect.anything())
  })

  it('uses window.list when scope and capabilities allow it', async () => {
    const client = mockClient({
      'status.get': {
        id: 'rpc-1',
        ok: true,
        result: { ok: true, protocolVersion: 1, deviceScope: 'mobile.window-control' }
      },
      'remote.capabilities': {
        id: 'rpc-2',
        ok: true,
        result: {
          protocolVersion: 1,
          methods: ['window.create', 'window.list', 'pane.list', 'terminal.list']
        }
      },
      'window.list': {
        id: 'rpc-3',
        ok: true,
        result: {
          windows: [
            {
              windowId: 'w1',
              name: 'Workspace',
              kind: 'local',
              archived: false,
              activePaneId: 'p1',
              createdAt: '2026-07-08T00:00:00.000Z',
              lastActiveAt: '2026-07-08T00:00:00.000Z',
              paneCount: 1,
              terminalPaneCount: 1,
              panes: [
                {
                  windowId: 'w1',
                  paneId: 'p1',
                  active: true,
                  kind: 'terminal',
                  backend: 'local',
                  status: 'waiting',
                  running: true,
                  pid: 8,
                  sessionId: 's1',
                  cwd: '/repo',
                  command: 'bash'
                }
              ]
            }
          ],
          groups: [
            {
              groupId: 'g1',
              name: 'Phone Group',
              archived: false,
              activeWindowId: 'w1',
              createdAt: '2026-07-08T00:00:00.000Z',
              lastActiveAt: '2026-07-08T00:00:00.000Z',
              windowCount: 1,
              layout: { type: 'window', id: 'w1' },
              windows: [
                {
                  windowId: 'w1',
                  name: 'Workspace',
                  kind: 'local',
                  archived: false,
                  activePaneId: 'p1',
                  createdAt: '2026-07-08T00:00:00.000Z',
                  lastActiveAt: '2026-07-08T00:00:00.000Z',
                  paneCount: 1,
                  terminalPaneCount: 1,
                  panes: [
                    {
                      windowId: 'w1',
                      paneId: 'p1',
                      active: true,
                      kind: 'terminal',
                      backend: 'local',
                      status: 'waiting',
                      running: true,
                      pid: 8,
                      sessionId: 's1',
                      cwd: '/repo',
                      command: 'bash'
                    }
                  ]
                }
              ]
            }
          ]
        }
      }
    })

    await expect(loadHostOverviewData(client)).resolves.toMatchObject({
      mode: 'windows',
      deviceScope: 'mobile.window-control',
      canCreateWindow: true,
      windows: [{ windowId: 'w1', name: 'Workspace' }],
      groups: [{ groupId: 'g1', name: 'Phone Group' }],
      terminals: [{ windowId: 'w1', paneId: 'p1', pid: 8 }]
    })
    expect(client.sendRequest).toHaveBeenCalledWith('window.list', { terminalOnly: true })
    expect(client.sendRequest).not.toHaveBeenCalledWith('terminal.list')
  })

  it('keeps window.list behind both scope and capability checks', () => {
    expect(canUseWindowList('mobile.control', ['window.list'])).toBe(false)
    expect(canUseWindowList('mobile.window-control', [])).toBe(false)
    expect(canUseWindowList('mobile.admin', ['window.list'])).toBe(true)
    expect(canCreateWindow('mobile.control', ['window.create'])).toBe(false)
    expect(canCreateWindow('mobile.window-control', ['window.create'])).toBe(true)
  })

  it('flattens running and stopped terminal panes into terminal routes', () => {
    expect(
      flattenTerminalPanes([
        {
          windowId: 'w1',
          name: 'Workspace',
          kind: 'mixed',
          archived: false,
          activePaneId: 'p1',
          createdAt: '',
          lastActiveAt: '',
          paneCount: 3,
          terminalPaneCount: 2,
          panes: [
            {
              windowId: 'w1',
              paneId: 'p1',
              active: true,
              kind: 'terminal',
              backend: 'ssh',
              status: 'waiting',
              running: true,
              pid: 9,
              sessionId: 's1',
              cwd: '/repo',
              command: 'zsh'
            },
            {
              windowId: 'w1',
              paneId: 'p2',
              active: false,
              kind: 'terminal',
              backend: 'local',
              status: 'completed',
              running: false,
              pid: null,
              sessionId: null,
              cwd: '/tmp',
              command: 'bash'
            },
            {
              windowId: 'w1',
              paneId: 'p3',
              active: false,
              kind: 'code',
              backend: null,
              status: 'completed',
              running: false,
              pid: null,
              sessionId: null,
              cwd: null,
              command: null
            }
          ]
        }
      ])
    ).toEqual([
      {
        windowId: 'w1',
        paneId: 'p1',
        sessionId: 's1',
        pid: 9,
        backend: 'ssh',
        status: 'alive',
        workingDirectory: '/repo',
        command: 'zsh'
      },
      {
        windowId: 'w1',
        paneId: 'p2',
        sessionId: 'w1:p2',
        pid: 0,
        backend: 'local',
        status: 'exited',
        workingDirectory: '/tmp',
        command: 'bash'
      }
    ])
  })
})
