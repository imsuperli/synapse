import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const routeSource = readFileSync(
  new URL('../../app/h/[hostId]/t/[windowId]/[paneId].tsx', import.meta.url),
  'utf8'
)

describe('Synapse Mobile terminal route wiring', () => {
  it('loads terminal history before subscribing to live output', () => {
    const historyIndex = routeSource.indexOf('requestTerminalHistory(client, windowId, paneId)')
    const subscribeIndex = routeSource.indexOf("client.subscribe(\n        'terminal.subscribe'")

    expect(historyIndex).toBeGreaterThanOrEqual(0)
    expect(subscribeIndex).toBeGreaterThan(historyIndex)
    expect(routeSource).toContain('sinceSeq: lastSeqRef.current')
    expect(routeSource).toContain('viewport: viewportRef.current')
    expect(routeSource).toContain('subscribeParams.sinceSeq = lastSeqRef.current')
    expect(routeSource).toContain('parseTerminalOutputEvent(payload)')
    expect(routeSource).toContain('parseTerminalSubscribeResult(payload)')
    expect(routeSource).toContain('loadTerminalHistorySnapshot(client, runId)')
  })

  it('resynchronizes from history when the terminal subscription reports a gap', () => {
    expect(routeSource).toContain('subscription.gap && !resyncingRef.current')
    expect(routeSource).toContain('unsubscribeRef.current?.()')
    expect(routeSource).toContain('startTerminalSubscription(client, runId)')
  })

  it('ignores duplicate sequenced terminal events after replay or reconnect', () => {
    expect(routeSource).toContain('event.seq > 0 && event.seq <= lastSeqRef.current')
    expect(routeSource).toContain('lastSeqRef.current = Math.max(lastSeqRef.current, event.seq)')
  })

  it('routes user input, resize, and clear through Synapse terminal RPC helpers', () => {
    expect(routeSource).toContain('onTerminalInput={handleTerminalInput}')
    expect(routeSource).toContain('sendTerminalInput(client, windowId, paneId, bytes)')
    expect(routeSource).toContain(
      'resizeTerminal(client, windowId, paneId, measured.cols, measured.rows)'
    )
    expect(routeSource).toContain('const result = await clearTerminal(client, windowId, paneId)')
    expect(routeSource).toContain('lastSeqRef.current = Math.max(lastSeqRef.current, result.lastSeq)')
    expect(routeSource).toContain('terminalRef.current?.clear()')
  })

  it('cleans up subscriptions and sockets when leaving the terminal screen', () => {
    expect(routeSource).toContain('unsubscribeRef.current?.()')
    expect(routeSource).toContain('clientRef.current?.close()')
    expect(routeSource).toContain("AppState.addEventListener('change'")
    expect(routeSource).toContain('clientRef.current?.notifyForeground()')
  })
})
