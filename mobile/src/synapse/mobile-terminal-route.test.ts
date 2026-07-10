import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const routeSource = readFileSync(
  new URL('../../app/h/[hostId]/t/[windowId]/[paneId].tsx', import.meta.url),
  'utf8'
)

describe('Synapse Mobile terminal route wiring', () => {
  it('loads terminal history before subscribing to live output without resizing the desktop PTY', () => {
    const historyIndex = routeSource.indexOf('requestTerminalHistory(client, windowId, paneId)')
    const subscribeIndex = routeSource.indexOf("client.subscribe(\n        'terminal.subscribe'")
    const viewportIndex = routeSource.indexOf('const viewport = normalizeTerminalViewport(history, viewportRef.current)')
    const initIndex = routeSource.indexOf('terminalRef.current?.init(\n        viewport.cols,\n        viewport.rows,')

    expect(historyIndex).toBeGreaterThanOrEqual(0)
    expect(subscribeIndex).toBeGreaterThan(historyIndex)
    expect(viewportIndex).toBeGreaterThan(historyIndex)
    expect(initIndex).toBeGreaterThan(viewportIndex)
    expect(routeSource).toContain('sinceSeq: lastSeqRef.current')
    expect(routeSource).not.toContain('viewport: viewportRef.current')
    expect(routeSource).not.toContain('resizeTerminal(client')
    expect(routeSource).not.toContain('terminal.resize(')
    expect(routeSource).toContain('subscribeParams.sinceSeq = lastSeqRef.current')
    expect(routeSource).toContain('parseTerminalOutputEvent(payload)')
    expect(routeSource).toContain('parseTerminalSubscribeResult(payload)')
    expect(routeSource).toContain('loadTerminalHistorySnapshot(client, runId)')
    expect(routeSource).toContain('terminalRef.current?.resetZoom()')
  })

  it('resynchronizes from history when the terminal subscription reports a gap', () => {
    expect(routeSource).toContain('subscription.gap && !resyncingRef.current')
    expect(routeSource).toContain('unsubscribeRef.current?.()')
    expect(routeSource).toContain('startTerminalSubscription(client, runId)')
  })

  it('reloads terminal history and subscriptions when the desktop restarts the same pane', () => {
    expect(routeSource).toContain('function terminalPaneRuntimeKey(pane: RemotePaneSummary | null): string | null')
    expect(routeSource).toContain('const currentPaneRuntimeKeyRef = useRef<string | null>(null)')
    expect(routeSource).toContain('const previousRuntimeKey = currentPaneRuntimeKeyRef.current')
    expect(routeSource).toContain('previousRuntimeKey && runtimeKey && previousRuntimeKey !== runtimeKey')
    expect(routeSource).toContain('await reloadCurrentTerminalStream(client)')
    expect(routeSource).toContain('lastSeqRef.current = 0')
  })

  it('ignores duplicate sequenced terminal events after replay or reconnect', () => {
    expect(routeSource).toContain('event.seq > 0 && event.seq <= lastSeqRef.current')
    expect(routeSource).toContain('lastSeqRef.current = Math.max(lastSeqRef.current, event.seq)')
  })

  it('routes user input and clear through Synapse terminal RPC helpers', () => {
    expect(routeSource).toContain('onTerminalInput={handleTerminalInput}')
    expect(routeSource).toContain('sendTerminalInput(client, windowId, paneId, bytes)')
    expect(routeSource).toContain('const result = await clearTerminal(client, windowId, paneId)')
    expect(routeSource).toContain('lastSeqRef.current = Math.max(lastSeqRef.current, result.lastSeq)')
    expect(routeSource).toContain('terminalRef.current?.clear()')
  })

  it('uses terminal live input wiring for the command dock', () => {
    expect(routeSource).toContain('useTerminalLiveInputCommit({')
    expect(routeSource).toContain('MobileTerminalLiveInputStatus')
    expect(routeSource).toContain('createTerminalLiveAccessoryInput(key)')
    expect(routeSource).toContain('onPressIn={() => {')
    expect(routeSource).toContain('startAccessoryRepeat(input)')
    expect(routeSource).toContain('stopAccessoryRepeat()')
    expect(routeSource).toContain('flushPendingLiveInputBeforeExternalSend(terminalHandle)')
    expect(routeSource).toContain('transform: [{ translateY: -keyboardLift }]')
  })

  it('keeps the remote terminal toolbar compact and preserves the replay grid while zooming text', () => {
    expect(routeSource).toContain("<Text style={styles.title}>{t('common.terminal')}</Text>")
    expect(routeSource).not.toContain('{windowId}:{paneId}')
    expect(routeSource).toContain('preserveGridOnTextScale')
  })

  it('renders same-window terminal pane tabs without changing desktop layout', () => {
    expect(routeSource).toContain('requestWindowList(client)')
    expect(routeSource).toContain('windowPanes.length > 1')
    expect(routeSource).toContain('router.replace(targetPath)')
    expect(routeSource).toContain('startRemoteWindow(client, pane.windowId, pane.paneId, viewportRef.current)')
    expect(routeSource).not.toContain('pane.focus')
    expect(routeSource).not.toContain('window.activate')
  })

  it('renders window tabs for grouped windows before falling back to same-window pane tabs', () => {
    expect(routeSource).toContain('const showGroupWindowTabs = groupWindowTabs.length > 1')
    expect(routeSource).toContain('showGroupWindowTabs ?')
    expect(routeSource).toContain('groupWindowTabs.map((window) => {')
    expect(routeSource).toContain('getActiveTerminalPane(window.panes, window.activePaneId)')
    expect(routeSource).toContain('handleGroupWindowTabPress(window)')
    expect(routeSource).toContain(': windowPanes.length > 1 ?')
  })

  it('cleans up subscriptions and sockets when leaving the terminal screen', () => {
    expect(routeSource).toContain('unsubscribeRef.current?.()')
    expect(routeSource).toContain('clientRef.current?.close()')
    expect(routeSource).toContain("AppState.addEventListener('change'")
    expect(routeSource).toContain('clientRef.current?.notifyForeground()')
  })
})
