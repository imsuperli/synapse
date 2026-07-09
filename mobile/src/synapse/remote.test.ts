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
  createRemoteWindow,
  parseWindowCreateResult,
  parseTerminalClearResult,
  parseTerminalHistory,
  parseTerminalList,
  parseTerminalOutputEvent,
  parseTerminalSubscribeResult,
  requestTerminalHistory,
  requestTerminalList,
  sendTerminalInput,
  startRemoteWindow
} from './remote'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import { connect } from '../transport/rpc-client'

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
      {
        relay: {
          endpoint: 'wss://relay.example.com/v1/relay',
          sessionId: 'relay-session',
          clientToken: 'relay-client-token'
        }
      }
    )
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
        gap: true,
        keyboardState: { bracketedPasteMode: true }
      })
    ).toEqual({
      windowId: 'w1',
      paneId: 'p1',
      chunks: ['hello', 'world'],
      firstSeq: 2,
      lastSeq: 4,
      gap: true,
      keyboardState: { bracketedPasteMode: true }
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
    await sendTerminalInput(client, 'w1', 'p1', 'ls\n')
    await clearTerminal(client, 'w1', 'p1')

    expect(client.sendRequest).toHaveBeenNthCalledWith(1, 'terminal.history', {
      windowId: 'w1',
      paneId: 'p1'
    })
    expect(client.sendRequest).toHaveBeenNthCalledWith(2, 'terminal.send', {
      windowId: 'w1',
      paneId: 'p1',
      data: 'ls\n'
    })
    expect(client.sendRequest).toHaveBeenNthCalledWith(3, 'terminal.clear', {
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

    await expect(startRemoteWindow(client, 'w1', 'p1')).resolves.toMatchObject({
      pane: { windowId: 'w1', paneId: 'p1', running: true }
    })
    expect(client.sendRequest).toHaveBeenCalledWith('window.start', {
      windowId: 'w1',
      paneId: 'p1'
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

    await expect(createRemoteWindow(client)).resolves.toMatchObject({
      pane: { windowId: 'w-new', paneId: 'p-new', running: true }
    })
    expect(client.sendRequest).toHaveBeenCalledWith('window.create', {})
  })

  it('rejects malformed window create responses', () => {
    expect(() => parseWindowCreateResult({ window: null, pane: null })).toThrow(
      'Invalid window create response'
    )
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
