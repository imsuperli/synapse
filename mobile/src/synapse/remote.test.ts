import { describe, expect, it, vi } from 'vitest'

vi.mock('../transport/host-store', () => ({
  loadHosts: vi.fn(),
  updateLastConnected: vi.fn()
}))

vi.mock('../transport/rpc-client', () => ({
  connect: vi.fn()
}))

import {
  clearTerminal,
  parseTerminalClearResult,
  parseTerminalHistory,
  parseTerminalList,
  parseTerminalOutputEvent,
  parseTerminalSubscribeResult,
  requestTerminalHistory,
  requestTerminalList,
  resizeTerminal,
  sendTerminalInput
} from './remote'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'

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

  it('sends terminal history, input, resize, and clear RPC requests', async () => {
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
    await resizeTerminal(client, 'w1', 'p1', 100, 32)
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
    expect(client.sendRequest).toHaveBeenNthCalledWith(3, 'terminal.resize', {
      windowId: 'w1',
      paneId: 'p1',
      cols: 100,
      rows: 32
    })
    expect(client.sendRequest).toHaveBeenNthCalledWith(4, 'terminal.clear', {
      windowId: 'w1',
      paneId: 'p1'
    })
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
