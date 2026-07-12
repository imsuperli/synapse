import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const routeSource = readFileSync(
  new URL('../../app/h/[hostId]/t/[windowId]/[paneId].tsx', import.meta.url),
  'utf8'
)

describe('Synapse Mobile terminal route wiring', () => {
  it('subscribes to a binary terminal stream before rendering live output', () => {
    const subscribeIndex = routeSource.indexOf("client.subscribe(\n          'terminal.subscribe'")
    const snapshotIndex = routeSource.indexOf('const snapshot = parseTerminalScrollbackEvent(payload)')
    const applyIndex = routeSource.indexOf('await applyTerminalScrollbackSnapshot(')

    expect(subscribeIndex).toBeGreaterThanOrEqual(0)
    expect(snapshotIndex).toBeGreaterThan(subscribeIndex)
    expect(applyIndex).toBeGreaterThan(snapshotIndex)
    expect(routeSource).toContain('terminalRef.current?.init(\n        viewport.cols,\n        viewport.rows,')
    expect(routeSource).toContain('sinceSeq: lastSeqRef.current')
    expect(routeSource).toContain('capabilities: { terminalBinaryStream: 1 }')
    expect(routeSource).toContain('parseTerminalSubscribedEvent(payload)')
    expect(routeSource).toContain('parseTerminalScrollbackEvent(payload)')
    expect(routeSource).toContain('parseTerminalDataEvent(payload)')
    expect(routeSource).toContain('parseTerminalStreamErrorEvent(payload)')
    expect(routeSource).toContain('const screenSnapshotDataRef = useRef(\'\')')
    expect(routeSource).toContain('const screenSnapshotTailChunkCountRef = useRef(0)')
    expect(routeSource).toContain('const buildTerminalInitialData = useCallback(() => {')
    expect(routeSource).toContain('historyChunksRef.current = snapshot.serialized ? [snapshot.serialized] : []')
    expect(routeSource).toContain('screenSnapshotTailChunkCountRef.current = 0')
    expect(routeSource).toContain('buildTerminalInitialData()')
    expect(routeSource).not.toContain('viewport: viewportRef.current')
    expect(routeSource).not.toContain('resizeTerminal(client')
    expect(routeSource).not.toContain('terminal.resize(')
    expect(routeSource).not.toContain('parseTerminalOutputEvent(payload)')
    expect(routeSource).not.toContain('parseTerminalSubscribeResult(payload)')
    expect(routeSource).not.toContain('loadTerminalHistorySnapshot(client, runId)')
    expect(routeSource).toContain('terminalRef.current?.resetZoom()')
    expect(routeSource).toContain('undefined,\n        true')
  })

  it('loads older terminal history when the WebView reaches the top of scrollback', () => {
    expect(routeSource).toContain('const TERMINAL_HISTORY_PAGE_BYTES = 192 * 1024')
    expect(routeSource).toContain('const TERMINAL_HISTORY_PAGE_CHUNKS = 50_000')
    expect(routeSource).toContain('const loadedFirstSeqRef = useRef(0)')
    expect(routeSource).toContain('const historyChunksRef = useRef<string[]>([])')
    expect(routeSource).toContain('const hasMoreHistoryBeforeRef = useRef(false)')
    expect(routeSource).toContain('const handleHistoryTopReached = useCallback(() => {')
    expect(routeSource).toContain('beforeSeq,\n          limitBytes: TERMINAL_HISTORY_PAGE_BYTES')
    expect(routeSource).toContain('historyChunksRef.current = [...history.chunks, ...historyChunksRef.current]')
    expect(routeSource).toContain('const screenSnapshotInsertAt = historyChunksRef.current.length - tailChunkCount')
    expect(routeSource).toContain('historyChunksRef.current.slice(0, screenSnapshotInsertAt).join(\'\')')
    expect(routeSource).toContain('onHistoryTopReached={handleHistoryTopReached}')
    expect(routeSource).toContain("t('terminal.loadingOlderHistory')")
  })

  it('resynchronizes from history when the terminal subscription reports a gap', () => {
    expect(routeSource).toContain('unsubscribeRef.current?.()')
    expect(routeSource).toContain('startTerminalSubscription(client, runId)')
    expect(routeSource).toContain('await startTerminalSubscription(client, runId)')
  })

  it('reloads terminal history and subscriptions when the desktop restarts the same pane', () => {
    expect(routeSource).toContain('function terminalPaneRuntimeKey(pane: RemotePaneSummary | null): string | null')
    expect(routeSource).toContain('const currentPaneRuntimeKeyRef = useRef<string | null>(null)')
    expect(routeSource).toContain('const previousRuntimeKey = currentPaneRuntimeKeyRef.current')
    expect(routeSource).toContain('previousRuntimeKey && runtimeKey && previousRuntimeKey !== runtimeKey')
    expect(routeSource).toContain('await reloadCurrentTerminalStream(client)')
    expect(routeSource).toContain('lastSeqRef.current = 0')
  })

  it('guards terminal background polling against overlapping stale responses', () => {
    expect(routeSource).toContain('const terminalIncrementSyncInFlightRef = useRef(false)')
    expect(routeSource).toContain('const paneStatusSyncInFlightRef = useRef(false)')
    expect(routeSource).toContain('terminalIncrementSyncInFlightRef.current')
    expect(routeSource).toContain('paneStatusSyncInFlightRef.current')
    expect(routeSource).toContain('runIdRef.current !== runId || clientRef.current !== client')
    expect(routeSource).toContain('terminalIncrementSyncInFlightRef.current = false')
    expect(routeSource).toContain('paneStatusSyncInFlightRef.current = false')
  })

  it('maps protocol-level terminal errors to user-facing messages', () => {
    expect(routeSource).toContain('function terminalErrorMessage(err: unknown, t: MobileTranslate): string')
    expect(routeSource).toContain("t('terminal.stoppedOnDesktop')")
    expect(routeSource).toContain("t('terminal.workspaceNotLoaded')")
    expect(routeSource).toContain('setError(terminalErrorMessage(err, t))')
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

  it('places terminal actions in the native header without a second toolbar row', () => {
    expect(routeSource).toContain('<Stack.Screen')
    expect(routeSource).toContain("headerTitle: ''")
    expect(routeSource).toContain('headerRight: () => (')
    expect(routeSource).toContain('style={styles.navIconButton}')
    expect(routeSource).not.toContain('<View style={styles.toolbar}>')
    expect(routeSource).not.toContain("<Text style={styles.title}>{t('common.terminal')}</Text>")
    expect(routeSource).not.toContain('{windowId}:{paneId}')
    expect(routeSource).not.toContain('preserveGridOnTextScale')
  })

  it('persists mobile-only terminal text scale changes', () => {
    expect(routeSource).toContain('loadTerminalTextScale')
    expect(routeSource).toContain('saveTerminalTextScale(scale)')
    expect(routeSource).toContain('const [terminalTextScale, setTerminalTextScale] = useState(1)')
    expect(routeSource).toContain('textScale={terminalTextScale}')
    expect(routeSource).toContain('textScaleMode="viewport-zoom"')
    expect(routeSource).toContain('onTextScaleChange={handleTextScaleChange}')
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
