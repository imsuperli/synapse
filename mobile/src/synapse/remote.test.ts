import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../transport/host-store', () => ({
  loadHosts: vi.fn(),
  updateLastConnected: vi.fn(() => Promise.resolve())
}))

vi.mock('../transport/rpc-client', () => ({
  connect: vi.fn()
}))

import {
  clearTerminal,
  connectToHost,
  createRemoteGroup,
  createRemoteWindow,
  deleteRemoteGroup,
  deleteRemotePane,
  deleteRemoteWindow,
  parseGroupCreateResult,
  parseGroupDeleteResult,
  parseGroupWindowRemoveResult,
  parsePaneDeleteResult,
  parseRemoteStatus,
  parseWindowCreateResult,
  parseWindowDeleteResult,
  parsePaneCloseResult,
  parseSSHProfileList,
  parseTerminalClearResult,
  parseTerminalHistory,
  parseTerminalList,
  parseTerminalOutputEvent,
  parseTerminalSubscribeResult,
  parseWindowCloseResult,
  parseWindowList,
  requestWindowList,
  requestSSHProfileList,
  requestTerminalHistory,
  requestTerminalList,
  sendTerminalInput,
  removeRemoteWindowFromGroup,
  startRemoteWindow,
  stopRemotePane,
  stopRemoteWindow
} from './remote'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import { connect } from '../transport/rpc-client'
import { updateLastConnected } from '../transport/host-store'

function mockClient(response: RpcResponse): RpcClient {
  return {
    sendRequest: vi.fn().mockResolvedValue(response),
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

describe('Synapse remote terminal helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('passes saved relay settings into the RPC client', () => {
    connectToHost({
      id: 'host-1',
      name: 'Desktop',
      endpoint: 'ws://127.0.0.1:6868',
      connectionRoute: 'relay',
      deviceToken: 'device-token',
      publicKeyB64: 'server-key',
      relayEndpoint: 'wss://relay.example.com/v1/relay',
      relaySessionId: 'relay-session',
      relayClientToken: 'relay-client-token',
      lastConnected: 0
    })

    expect(connect).toHaveBeenCalledWith(
      'ws://127.0.0.1:6868',
      'device-token',
      'server-key',
      expect.objectContaining({
        onStateChange: expect.any(Function),
        relay: {
          endpoint: 'wss://relay.example.com/v1/relay',
          sessionId: 'relay-session',
          clientToken: 'relay-client-token'
        }
      })
    )
  })

  it('uses the direct endpoint when direct is selected even if relay credentials exist', () => {
    connectToHost({
      id: 'host-direct',
      name: 'Desktop',
      endpoint: 'ws://192.168.1.10:6868',
      connectionRoute: 'direct',
      deviceToken: 'device-token',
      publicKeyB64: 'server-key',
      relayEndpoint: 'wss://relay.example.com/v1/relay',
      relaySessionId: 'relay-session',
      relayClientToken: 'relay-client-token',
      lastConnected: 0
    })

    expect(connect).toHaveBeenCalledWith(
      'ws://192.168.1.10:6868',
      'device-token',
      'server-key',
      expect.objectContaining({ relay: undefined })
    )
  })

  it('updates lastConnected only after the host reaches connected state', () => {
    const onStateChange = vi.fn()
    connectToHost(
      {
        id: 'host-connected',
        name: 'Desktop',
        endpoint: 'ws://127.0.0.1:6868',
        connectionRoute: 'direct',
        deviceToken: 'device-token',
        publicKeyB64: 'server-key',
        lastConnected: 0
      },
      { onStateChange }
    )

    const options = vi.mocked(connect).mock.calls.at(-1)?.[3] as {
      onStateChange?: (state: string) => void
    }
    expect(updateLastConnected).not.toHaveBeenCalled()

    options.onStateChange?.('connecting')
    expect(onStateChange).toHaveBeenCalledWith('connecting')
    expect(updateLastConnected).not.toHaveBeenCalled()

    options.onStateChange?.('connected')
    options.onStateChange?.('connected')
    expect(onStateChange).toHaveBeenCalledWith('connected')
    expect(updateLastConnected).toHaveBeenCalledTimes(1)
    expect(updateLastConnected).toHaveBeenCalledWith('host-connected')
  })

  it('accepts an optional authenticated direct endpoint in remote status', () => {
    expect(
      parseRemoteStatus({
        ok: true,
        protocolVersion: 1,
        deviceScope: 'mobile.window-control',
        directEndpoint: ' ws://10.0.0.8:6868 '
      })
    ).toEqual({
      ok: true,
      protocolVersion: 1,
      deviceScope: 'mobile.window-control',
      directEndpoint: 'ws://10.0.0.8:6868'
    })
    expect(
      parseRemoteStatus({
        ok: true,
        protocolVersion: 1,
        deviceScope: 'mobile.window-control',
        directEndpoint: 'https://not-a-websocket.example.com'
      })
    ).not.toHaveProperty('directEndpoint')
  })

  it('parses only controllable terminal list entries', () => {
    expect(
      parseTerminalList({
        id: 'rpc-1',
        ok: true,
        result: {
          terminals: [
            {
              windowId: 'w1',
              paneId: 'p1',
              sessionId: 's1',
              pid: 42,
              backend: 'ssh',
              status: 'alive',
              workingDirectory: '/repo',
              command: 'bash',
              profileId: 'prod'
            },
            { windowId: null, paneId: 'p2', sessionId: 'diagnostic' },
            { windowId: 'w3', paneId: null, sessionId: 'diagnostic' }
          ]
        }
      })
    ).toEqual([
      {
        windowId: 'w1',
        paneId: 'p1',
        sessionId: 's1',
        pid: 42,
        backend: 'ssh',
        status: 'alive',
        workingDirectory: '/repo',
        command: 'bash',
        profileId: 'prod'
      }
    ])
  })

  it('normalizes terminal history and preserves gap state', () => {
    expect(
      parseTerminalHistory({
        windowId: 'w1',
        paneId: 'p1',
        chunks: ['hello', 123, 'world'],
        firstSeq: 2,
        lastSeq: 4,
        latestSeq: 8,
        hasMoreAfter: true,
        gap: true,
        hasMoreBefore: true,
        evictedBeforeSeq: 1,
        cols: 144,
        rows: 36,
        keyboardState: { bracketedPasteMode: true },
        screenSnapshot: {
          windowId: 'w1',
          paneId: 'p1',
          cols: 144,
          rows: 36,
          cursorX: 4,
          cursorY: 8,
          alternate: true,
          data: '\u001b[?1049h\u001b[2J\u001b[Hworking',
          capturedAt: '2026-07-11T10:30:00.000Z',
          outputSeq: 4
        }
      })
    ).toEqual({
      windowId: 'w1',
      paneId: 'p1',
      chunks: ['hello', 'world'],
      firstSeq: 2,
      lastSeq: 4,
      latestSeq: 8,
      hasMoreAfter: true,
      gap: true,
      hasMoreBefore: true,
      evictedBeforeSeq: 1,
      cols: 144,
      rows: 36,
      keyboardState: { bracketedPasteMode: true },
      screenSnapshot: {
        windowId: 'w1',
        paneId: 'p1',
        cols: 144,
        rows: 36,
        cursorX: 4,
        cursorY: 8,
        alternate: true,
        data: '\u001b[?1049h\u001b[2J\u001b[Hworking',
        capturedAt: '2026-07-11T10:30:00.000Z',
        outputSeq: 4
      }
    })
  })

  it('parses terminal subscription metadata and rejects non-subscribe payloads', () => {
    expect(
      parseTerminalSubscribeResult({
        subscriptionId: 'sub-1',
        firstSeq: 3,
        lastSeq: 7,
        gap: true
      })
    ).toEqual({
      subscriptionId: 'sub-1',
      firstSeq: 3,
      lastSeq: 7,
      gap: true
    })
    expect(parseTerminalSubscribeResult({ windowId: 'w1', paneId: 'p1', data: 'out' })).toBeNull()
  })

  it('parses terminal clear results and rejects malformed clear responses', () => {
    expect(
      parseTerminalClearResult({
        windowId: 'w1',
        paneId: 'p1',
        cleared: true,
        lastSeq: 12
      })
    ).toEqual({
      windowId: 'w1',
      paneId: 'p1',
      cleared: true,
      lastSeq: 12
    })
    expect(() => parseTerminalClearResult({ windowId: 'w1', paneId: 'p1' })).toThrow(
      'Invalid terminal clear response'
    )
  })


  it('parses terminal output events and rejects malformed events', () => {
    expect(
      parseTerminalOutputEvent({
        windowId: 'w1',
        paneId: 'p1',
        seq: 9,
        data: 'out'
      })
    ).toEqual({ windowId: 'w1', paneId: 'p1', seq: 9, data: 'out' })
    expect(parseTerminalOutputEvent({ windowId: 'w1', data: 'out' })).toBeNull()
  })

  it('uses Synapse terminal RPC method names', async () => {
    const client = mockClient({ id: 'rpc-1', ok: true, result: { terminals: [] } })

    await expect(requestTerminalList(client)).resolves.toEqual([])

    expect(client.sendRequest).toHaveBeenCalledWith('terminal.list')
  })

  it('sends terminal history, input, and clear RPC requests', async () => {
    const client = mockClient({
      id: 'rpc-1',
      ok: true,
      result: {
        windowId: 'w1',
        paneId: 'p1',
        chunks: [],
        firstSeq: 0,
        lastSeq: 0,
        gap: false,
        cleared: true
      }
    })

    await requestTerminalHistory(client, 'w1', 'p1')
    await requestTerminalHistory(client, 'w1', 'p1', { sinceSeq: 12 })
    await requestTerminalHistory(client, 'w1', 'p1', { beforeSeq: 12, limitBytes: 4096 })
    await sendTerminalInput(client, 'w1', 'p1', 'ls\n')
    await clearTerminal(client, 'w1', 'p1')

    expect(client.sendRequest).toHaveBeenNthCalledWith(1, 'terminal.history', {
      windowId: 'w1',
      paneId: 'p1'
    })
    expect(client.sendRequest).toHaveBeenNthCalledWith(2, 'terminal.history', {
      windowId: 'w1',
      paneId: 'p1',
      sinceSeq: 12
    })
    expect(client.sendRequest).toHaveBeenNthCalledWith(3, 'terminal.history', {
      windowId: 'w1',
      paneId: 'p1',
      beforeSeq: 12,
      limitBytes: 4096
    })
    expect(client.sendRequest).toHaveBeenNthCalledWith(
      4,
      'terminal.send',
      {
        windowId: 'w1',
        paneId: 'p1',
        data: 'ls\n'
      },
      { waitForConnection: false }
    )
    expect(client.sendRequest).toHaveBeenNthCalledWith(5, 'terminal.clear', {
      windowId: 'w1',
      paneId: 'p1'
    })
  })

  it('starts a remote window pane through the window.start RPC', async () => {
    const client = mockClient({
      id: 'rpc-1',
      ok: true,
      result: {
        window: {
          windowId: 'w1',
          name: 'Workspace',
          activePaneId: 'p1',
          paneCount: 1,
          terminalPaneCount: 1,
          panes: [
            {
              windowId: 'w1',
              paneId: 'p1',
              kind: 'terminal',
              backend: 'local',
              status: 'waiting',
              running: true,
              pid: 42,
              sessionId: 's1',
              cwd: '/repo',
              command: 'bash'
            }
          ]
        },
        pane: {
          windowId: 'w1',
          paneId: 'p1',
          kind: 'terminal',
          backend: 'local',
          status: 'waiting',
          running: true,
          pid: 42,
          sessionId: 's1',
          cwd: '/repo',
          command: 'bash'
        },
        startedPanes: []
      }
    })

    await expect(startRemoteWindow(client, 'w1', 'p1', { cols: 132, rows: 34 })).resolves.toMatchObject({
      pane: { windowId: 'w1', paneId: 'p1', running: true }
    })
    expect(client.sendRequest).toHaveBeenCalledWith('window.start', {
      windowId: 'w1',
      paneId: 'p1',
      initialCols: 132,
      initialRows: 34
    })
  })

  it('creates a remote local terminal window through the window.create RPC', async () => {
    const client = mockClient({
      id: 'rpc-1',
      ok: true,
      result: {
        window: {
          windowId: 'w-new',
          name: 'Mobile Shell',
          activePaneId: 'p-new',
          paneCount: 1,
          terminalPaneCount: 1,
          panes: [
            {
              windowId: 'w-new',
              paneId: 'p-new',
              kind: 'terminal',
              backend: 'local',
              status: 'waiting',
              running: true,
              pid: 44,
              sessionId: 's-new',
              cwd: '/repo',
              command: 'bash'
            }
          ]
        },
        pane: {
          windowId: 'w-new',
          paneId: 'p-new',
          kind: 'terminal',
          backend: 'local',
          status: 'waiting',
          running: true,
          pid: 44,
          sessionId: 's-new',
          cwd: '/repo',
          command: 'bash'
        }
      }
    })

    await expect(createRemoteWindow(client, {
      backend: 'local',
      workingDirectory: '/repo',
      name: 'Mobile Shell',
      initialCols: 100,
      initialRows: 30
    })).resolves.toMatchObject({
      pane: { windowId: 'w-new', paneId: 'p-new', running: true }
    })
    expect(client.sendRequest).toHaveBeenCalledWith('window.create', {
      backend: 'local',
      workingDirectory: '/repo',
      name: 'Mobile Shell',
      initialCols: 100,
      initialRows: 30
    })
  })

  it('loads safe SSH profile summaries without desktop credentials', async () => {
    const client = mockClient({
      id: 'rpc-1',
      ok: true,
      result: {
        profiles: [
          {
            profileId: 'profile-1',
            name: 'Production',
            host: 'prod.example.com',
            port: 22,
            user: 'deploy',
            defaultRemoteCwd: '/srv/app',
            remoteCommand: null
          }
        ]
      }
    })

    await expect(requestSSHProfileList(client)).resolves.toEqual([
      {
        profileId: 'profile-1',
        name: 'Production',
        host: 'prod.example.com',
        port: 22,
        user: 'deploy',
        defaultRemoteCwd: '/srv/app',
        remoteCommand: null
      }
    ])
    expect(client.sendRequest).toHaveBeenCalledWith('ssh.profile.list')
    expect(parseSSHProfileList({ profiles: [{ password: 'secret' }] })).toEqual({ profiles: [] })
  })

  it('creates an SSH terminal using only the desktop profile reference', async () => {
    const pane = {
      windowId: 'w-ssh',
      paneId: 'p-ssh',
      kind: 'terminal',
      backend: 'ssh',
      status: 'waiting',
      running: true,
      pid: 45,
      sessionId: 's-ssh',
      cwd: '/srv/app',
      command: 'zsh'
    }
    const client = mockClient({
      id: 'rpc-1',
      ok: true,
      result: {
        window: {
          windowId: 'w-ssh',
          name: 'Production',
          activePaneId: 'p-ssh',
          panes: [pane]
        },
        pane
      }
    })

    await expect(createRemoteWindow(client, {
      backend: 'ssh',
      profileId: 'profile-1',
      workingDirectory: '/srv/app',
      initialCols: 100,
      initialRows: 30
    })).resolves.toMatchObject({
      pane: { windowId: 'w-ssh', paneId: 'p-ssh', backend: 'ssh' }
    })
    expect(client.sendRequest).toHaveBeenCalledWith('window.create', {
      backend: 'ssh',
      profileId: 'profile-1',
      workingDirectory: '/srv/app',
      initialCols: 100,
      initialRows: 30
    })
  })

  it('parses window lists with group summaries', () => {
    const windowPayload = {
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
          pid: 42,
          sessionId: 's1',
          cwd: '/repo',
          command: 'bash'
        }
      ]
    }

    expect(
      parseWindowList({
        windows: [windowPayload],
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
            windows: [windowPayload]
          }
        ]
      })
    ).toMatchObject({
      windows: [{ windowId: 'w1', panes: [{ paneId: 'p1', running: true }] }],
      groups: [{ groupId: 'g1', windows: [{ windowId: 'w1' }] }]
    })
  })

  it('stops remote windows and panes through the window close RPCs', async () => {
    const windowClosePayload = {
      window: {
        windowId: 'w1',
        name: 'Workspace',
        activePaneId: 'p1',
        paneCount: 1,
        terminalPaneCount: 1,
        panes: [
          {
            windowId: 'w1',
            paneId: 'p1',
            kind: 'terminal',
            backend: 'local',
            status: 'completed',
            running: false,
            pid: null,
            sessionId: null,
            cwd: '/repo',
            command: 'bash'
          }
        ]
      },
      stoppedPanes: [
        {
          windowId: 'w1',
          paneId: 'p1',
          kind: 'terminal',
          backend: 'local',
          status: 'completed',
          running: false,
          pid: null,
          sessionId: null,
          cwd: '/repo',
          command: 'bash'
        }
      ]
    }
    const paneClosePayload = {
      window: windowClosePayload.window,
      pane: windowClosePayload.stoppedPanes[0]
    }
    expect(parseWindowCloseResult(windowClosePayload)).toMatchObject({
      window: { windowId: 'w1' },
      stoppedPanes: [{ paneId: 'p1', running: false }]
    })
    expect(parsePaneCloseResult(paneClosePayload)).toMatchObject({
      window: { windowId: 'w1' },
      pane: { paneId: 'p1', running: false }
    })

    const windowClient = mockClient({ id: 'rpc-1', ok: true, result: windowClosePayload })
    const paneClient = mockClient({ id: 'rpc-2', ok: true, result: paneClosePayload })

    await expect(stopRemoteWindow(windowClient, 'w1')).resolves.toMatchObject({
      window: { windowId: 'w1' }
    })
    await expect(stopRemotePane(paneClient, 'w1', 'p1')).resolves.toMatchObject({
      pane: { paneId: 'p1', running: false }
    })
    expect(windowClient.sendRequest).toHaveBeenCalledWith('window.close', { windowId: 'w1' })
    expect(paneClient.sendRequest).toHaveBeenCalledWith('pane.close', {
      windowId: 'w1',
      paneId: 'p1'
    })
  })

  it('deletes windows and manages groups through window-control RPCs', async () => {
    const groupCreatePayload = {
      group: {
        groupId: 'g1',
        name: 'Phone Group',
        archived: false,
        activeWindowId: 'w1',
        createdAt: '2026-07-08T00:00:00.000Z',
        lastActiveAt: '2026-07-08T00:00:00.000Z',
        windowCount: 2,
        layout: {
          type: 'split',
          direction: 'horizontal',
          sizes: [0.5, 0.5],
          children: [
            { type: 'window', id: 'w1' },
            { type: 'window', id: 'w2' }
          ]
        },
        windows: []
      }
    }
    const deleteWindowClient = mockClient({
      id: 'rpc-1',
      ok: true,
      result: { deleted: true, windowId: 'w1', groups: [] }
    })
    const createGroupClient = mockClient({
      id: 'rpc-2',
      ok: true,
      result: groupCreatePayload
    })
    const deleteGroupClient = mockClient({
      id: 'rpc-3',
      ok: true,
      result: { deleted: true, groupId: 'g1' }
    })
    const replacementPane = {
      windowId: 'w1',
      paneId: 'p2',
      kind: 'terminal',
      backend: 'local',
      status: 'waiting',
      running: true,
      pid: 22,
      sessionId: 'session-22',
      cwd: '/repo',
      command: 'bash'
    }
    const replacementWindow = {
      windowId: 'w1',
      name: 'Workspace',
      activePaneId: 'p2',
      paneCount: 1,
      terminalPaneCount: 1,
      panes: [replacementPane]
    }
    const deletePanePayload = {
      deleted: true,
      deletedPaneId: 'p1',
      window: replacementWindow,
      replacementPane
    }
    const removeGroupWindowPayload = {
      removed: true,
      groupId: 'g1',
      windowId: 'w2',
      dissolved: true,
      group: null,
      replacementWindow,
      replacementPane
    }
    const deletePaneClient = mockClient({ id: 'rpc-4', ok: true, result: deletePanePayload })
    const removeGroupWindowClient = mockClient({
      id: 'rpc-5',
      ok: true,
      result: removeGroupWindowPayload
    })

    await expect(deleteRemoteWindow(deleteWindowClient, 'w1')).resolves.toEqual({
      deleted: true,
      windowId: 'w1',
      groups: []
    })
    await expect(createRemoteGroup(createGroupClient, ['w1', 'w2'], 'Phone Group')).resolves.toMatchObject({
      group: { groupId: 'g1', name: 'Phone Group', windowCount: 2 }
    })
    await expect(deleteRemoteGroup(deleteGroupClient, 'g1')).resolves.toEqual({
      deleted: true,
      groupId: 'g1'
    })
    await expect(deleteRemotePane(deletePaneClient, 'w1', 'p1')).resolves.toMatchObject({
      deleted: true,
      deletedPaneId: 'p1',
      replacementPane: { paneId: 'p2' }
    })
    await expect(
      removeRemoteWindowFromGroup(removeGroupWindowClient, 'g1', 'w2')
    ).resolves.toMatchObject({
      removed: true,
      dissolved: true,
      replacementWindow: { windowId: 'w1' },
      replacementPane: { paneId: 'p2' }
    })

    expect(parseWindowDeleteResult({ deleted: true, windowId: 'w1', groups: [] })).toEqual({
      deleted: true,
      windowId: 'w1',
      groups: []
    })
    expect(parseGroupCreateResult(groupCreatePayload)).toMatchObject({
      group: { groupId: 'g1', name: 'Phone Group', windowCount: 2 }
    })
    expect(parseGroupDeleteResult({ deleted: true, groupId: 'g1' })).toEqual({
      deleted: true,
      groupId: 'g1'
    })
    expect(parsePaneDeleteResult(deletePanePayload)).toMatchObject({
      deleted: true,
      replacementPane: { paneId: 'p2' }
    })
    expect(parseGroupWindowRemoveResult(removeGroupWindowPayload)).toMatchObject({
      removed: true,
      dissolved: true,
      replacementPane: { paneId: 'p2' }
    })
    expect(deleteWindowClient.sendRequest).toHaveBeenCalledWith('window.delete', { windowId: 'w1' })
    expect(createGroupClient.sendRequest).toHaveBeenCalledWith('group.create', {
      windowIds: ['w1', 'w2'],
      name: 'Phone Group'
    })
    expect(deleteGroupClient.sendRequest).toHaveBeenCalledWith('group.delete', { groupId: 'g1' })
    expect(deletePaneClient.sendRequest).toHaveBeenCalledWith('pane.delete', {
      windowId: 'w1',
      paneId: 'p1'
    })
    expect(removeGroupWindowClient.sendRequest).toHaveBeenCalledWith('group.window.remove', {
      groupId: 'g1',
      windowId: 'w2'
    })
  })

  it('requests window lists with terminal-only summaries', async () => {
    const client = mockClient({
      id: 'rpc-1',
      ok: true,
      result: { windows: [], groups: [] }
    })

    await expect(requestWindowList(client)).resolves.toEqual({ windows: [], groups: [] })
    expect(client.sendRequest).toHaveBeenCalledWith('window.list', { terminalOnly: true })
  })

  it('rejects malformed window create responses', () => {
    expect(() => parseWindowCreateResult({ window: null, pane: null })).toThrow(
      'Invalid window create response'
    )
    expect(() => parseWindowCreateResult({
      window: { windowId: 'w1', name: 'Wrong pane', panes: [] },
      pane: { windowId: 'w1', paneId: 'p1', kind: 'terminal' }
    })).toThrow('Invalid window create response')
  })

  it('throws RPC error messages from terminal helpers', async () => {
    const client = mockClient({
      id: 'rpc-1',
      ok: false,
      error: { code: 'terminal_not_found', message: 'Terminal not found' }
    })

    await expect(sendTerminalInput(client, 'w1', 'p1', 'x')).rejects.toThrow(
      'Terminal not found'
    )
  })
})
