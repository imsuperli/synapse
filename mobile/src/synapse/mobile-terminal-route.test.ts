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
    expect(routeSource).toContain('const viewport = updateTerminalViewportFromDesktop(snapshot, false)')
    expect(routeSource).not.toContain('fitTerminalRowsToPhone')
    expect(routeSource).not.toContain('fittedPhoneRowsRef')
    expect(routeSource).toContain('sinceSeq: options.sinceSeq ?? terminalHistoryRef.current.lastSeq')
    expect(routeSource).toContain('capabilities: { terminalBinaryStream: 1 }')
    expect(routeSource).toContain('parseTerminalSubscribedEvent(payload)')
    expect(routeSource).toContain('parseTerminalScrollbackEvent(payload)')
    expect(routeSource).toContain('parseTerminalDataEvent(payload)')
    expect(routeSource).toContain('parseTerminalStreamErrorEvent(payload)')
    expect(routeSource).toContain('terminalHistoryRef: { current: createRemoteTerminalHistoryState() }')
    expect(routeSource).toContain('const buildTerminalInitialData = useCallback(() => {')
    expect(routeSource).toContain('replaceRemoteTerminalHistorySnapshot(terminalHistoryRef.current, snapshot)')
    expect(routeSource).toContain('screenSnapshotOffset?: number')
    expect(routeSource).toContain('screenSnapshotLength?: number')
    expect(routeSource).toContain('buildTerminalInitialData()')
    expect(routeSource).not.toContain('viewport: viewportRef.current')
    expect(routeSource).not.toContain('resizeTerminal(client')
    expect(routeSource).not.toContain('terminal.resize(')
    expect(routeSource).not.toContain('parseTerminalOutputEvent(payload)')
    expect(routeSource).not.toContain('parseTerminalSubscribeResult(payload)')
    expect(routeSource).not.toContain('loadTerminalHistorySnapshot(client, runId)')
    expect(routeSource).toContain('runtime?.terminalRef.current?.resetZoom()')
    expect(routeSource).toContain('undefined,\n        true')
  })

  it('loads older terminal history when the WebView reaches the top of scrollback', () => {
    expect(routeSource).toContain('const TERMINAL_HISTORY_PAGE_BYTES = 192 * 1024')
    expect(routeSource).toContain('const TERMINAL_HISTORY_PAGE_CHUNKS = 50_000')
    expect(routeSource).toContain('const TERMINAL_HISTORY_PREFETCH_BYTES = 768 * 1024')
    expect(routeSource).toContain('const handleHistoryTopReached = useCallback(() => {')
    expect(routeSource).toContain('await prefetchOlderTerminalHistory()')
    expect(routeSource).toContain('takePrefetchedRemoteTerminalHistory(prefetch)')
    expect(routeSource).toContain('prependRemoteTerminalHistoryPage(\n            terminalHistoryRef.current,\n            page')
    expect(routeSource).toContain('buildRemoteTerminalInitialData(terminalHistoryRef.current)')
    expect(routeSource).toContain('handleHistoryTopReachedRef.current?.()')
    expect(routeSource).toContain("t('terminal.loadingOlderHistory')")
    expect(routeSource).toContain('void prefetchOlderTerminalHistory().catch(() => {})')
    expect(routeSource).toContain('void activatePrefetchedTerminalHistory().catch((err) => {')
    expect(routeSource).not.toContain('prefetchAndActivateInitialTerminalHistory')
    expect(routeSource).not.toContain("activatePrefetchedTerminalHistory('initial')")
    expect(routeSource).not.toContain('initialHistoryActivatedRef')
    expect(routeSource).toContain('snapshot.evictedBeforeSeq')
    expect(routeSource).toContain('terminalHistoryBoundaryMessage(terminalHistoryRef.current, t)')
  })

  it('resynchronizes from history when the terminal subscription reports a gap', () => {
    expect(routeSource).toContain('unsubscribeRef.current?.()')
    expect(routeSource).toContain('startTerminalSubscription(client, runId, { sinceSeq: 0 })')
    expect(routeSource).toContain('await reloadSnapshotForCurrentRun()')
  })

  it('reloads terminal history and subscriptions when the desktop restarts the same pane', () => {
    expect(routeSource).toContain(
      'function terminalPaneRuntimeKey(pane: RemotePaneSummary | null | undefined): string | null'
    )
    expect(routeSource).toContain('currentPaneRuntimeKeyRef: { current: null as string | null }')
    expect(routeSource).toContain('const previousRuntimeKey = currentPaneRuntimeKeyRef.current')
    expect(routeSource).toContain('previousRuntimeKey && runtimeKey && previousRuntimeKey !== runtimeKey')
    expect(routeSource).toContain('await reloadCurrentTerminalStream(client)')
    expect(routeSource).toContain('resetRemoteTerminalHistoryState(terminalHistoryRef.current)')
  })

  it('distinguishes a deleted pane from a transient window-list failure', () => {
    expect(routeSource).toContain('return undefined')
    expect(routeSource).toContain('if (currentPane === undefined)')
    expect(routeSource).toContain('if (currentPane === null)')
    expect(routeSource).toContain("setError(t('terminal.stoppedOnDesktop'))")
  })

  it('guards terminal background polling against overlapping stale responses', () => {
    expect(routeSource).toContain('terminalIncrementSyncInFlightRef: { current: false }')
    expect(routeSource).toContain('paneStatusSyncInFlightRef: { current: false }')
    expect(routeSource).toContain('terminalIncrementSyncInFlightRef.current')
    expect(routeSource).toContain('paneStatusSyncInFlightRef.current')
    expect(routeSource).toContain('runIdRef.current !== runId || clientRef.current !== client')
    expect(routeSource).toContain('terminalIncrementSyncInFlightRef.current = false')
    expect(routeSource).toContain('paneStatusSyncInFlightRef.current = false')
    expect(routeSource).toContain('const windowListGenerationRef = useRef(0)')
    expect(routeSource).toContain('windowListGenerationRef.current !== requestGeneration')
  })

  it('invalidates stale subscription frames and history responses after an in-place reload', () => {
    expect(routeSource).toContain('terminalSubscriptionGenerationRef: { current: 0 }')
    expect(routeSource).toContain('terminalHistoryGenerationRef: { current: 0 }')
    expect(routeSource).toContain(
      'terminalSubscriptionGenerationRef.current !== subscriptionGeneration'
    )
    expect(routeSource).toContain('terminalHistoryGenerationRef.current !== historyGeneration')
    expect(routeSource).toContain('terminalHistoryGenerationRef.current += 1')
  })

  it('maps protocol-level terminal errors to user-facing messages', () => {
    expect(routeSource).toContain('function terminalErrorMessage(err: unknown, t: MobileTranslate): string')
    expect(routeSource).toContain("t('terminal.stoppedOnDesktop')")
    expect(routeSource).toContain("t('terminal.workspaceNotLoaded')")
    expect(routeSource).toContain('setError(terminalErrorMessage(err, t))')
  })

  it('ignores duplicate sequenced terminal events after replay or reconnect', () => {
    expect(routeSource).toContain('appendRemoteTerminalData(')
    expect(routeSource).toContain('appendRemoteTerminalHistoryIncrement(')
    expect(routeSource).toContain('appendRemoteTerminalIncrementalSnapshot(')
    expect(routeSource).toContain('if (appliedSnapshot)')
    expect(routeSource).toContain('void syncTerminalIncrementRef.current?.()')
    expect(routeSource).toContain('terminalSubscribeParamsRef.current.sinceSeq = terminalHistoryRef.current.lastSeq')
  })

  it('preserves both desktop grid dimensions on mobile', () => {
    expect(routeSource).toContain('desktopViewportRef: {')
    expect(routeSource).toContain('const nextViewport = resolveMobileTerminalViewport(desktopViewport)')
    expect(routeSource).toContain('terminalRef.current?.resize(nextViewport.cols, nextViewport.rows)')
    expect(routeSource).not.toContain('fittedPhoneRowsRef')
    expect(routeSource).not.toContain('measureFitDimensions(')
    expect(routeSource).not.toContain('resizeTerminal(client')
  })

  it('routes user input and clear through Synapse terminal RPC helpers', () => {
    expect(routeSource).toContain('handleTerminalInput(bytes)')
    expect(routeSource).toContain('sendTerminalInput(client, windowId, paneId, bytes)')
    expect(routeSource).toContain('const result = await clearTerminal(client, windowId, paneId)')
    expect(routeSource).toContain('terminalHistoryRef.current.lastSeq = result.lastSeq')
    expect(routeSource).toContain('terminalRef.current?.clear()')
  })

  it('moves only covered terminal content and restores the full viewport after keyboard hide', () => {
    expect(routeSource).toContain('getTerminalKeyboardAvoidanceLift({')
    expect(routeSource).toContain('metrics: terminalKeyboardMetrics')
    expect(routeSource).toContain('handleKeyboardAvoidanceMetrics(metrics)')
    expect(routeSource).toContain('{ transform: [{ translateY: -terminalKeyboardLift }] }')
    expect(routeSource).not.toContain('terminalKeyboardLift > 0 && { transform:')
    expect(routeSource).toContain('runtime?.terminalRef.current?.revealLiveInput()')
    expect(routeSource).toContain('runtime?.terminalRef.current?.restoreKeyboardViewport()')
    expect(routeSource).toContain('const restoreTerminalAfterKeyboard = useCallback(() => {')
    expect(routeSource).toContain("Keyboard.addListener('keyboardDidHide', restoreTerminalAfterKeyboard)")
    expect(routeSource).toContain('if (!Keyboard.isVisible()) {')
    expect(routeSource).toContain('liveInputRef.current?.blur()')
    expect(routeSource).toContain('Keyboard.dismiss()')
    expect(routeSource).toContain("overflow: 'hidden'")
    expect(routeSource).toContain("Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'")
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
    expect(routeSource).toContain('styles.navIconButton')
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
    expect(routeSource).toContain('textScaleMode="mobile-reflow"')
    expect(routeSource).toContain('onTextScaleChange={handleTextScaleChange}')
    expect(routeSource).toContain(
      'onMobileReflowRefreshRequest={handleMobileReflowRefreshRequest}'
    )
  })

  it('exposes bounded copyable terminal diagnostics directly on mobile', () => {
    expect(routeSource).toContain('createTerminalDiagnosticBuffer()')
    expect(routeSource).toContain("appendDiagnostic('network', 'connection-state'")
    expect(routeSource).toContain("appendDiagnostic('mobile', 'history-prefetch-batch'")
    expect(routeSource).toContain("appendDiagnostic('mobile', 'history-activation-result'")
    expect(routeSource).toContain('onDiagnostic={handleTerminalWebViewDiagnostic}')
    expect(routeSource).toContain('<TerminalDiagnosticsModal')
    expect(routeSource).toContain('formatTerminalDiagnostics(diagnosticsBufferRef.current')
    expect(routeSource).toContain("accessibilityLabel={t('terminal.openDiagnostics')}")
  })

  it('automatically dismisses the terminal history boundary notice', () => {
    expect(routeSource).toContain('const TERMINAL_HISTORY_NOTICE_MS = 3_000')
    expect(routeSource).toContain('if (!historyNotice) {')
    expect(routeSource).toContain('setHistoryNotice(null)')
    expect(routeSource).toContain('}, TERMINAL_HISTORY_NOTICE_MS)')
    expect(routeSource).toContain('return () => clearTimeout(timer)')
    expect(routeSource).toContain(
      'if (!prefetched.hasMoreBefore && activeHandleRef.current === terminalHandle)'
    )
    expect(routeSource).toContain(
      'setLoadingOlderHistory(false)\n      setHistoryNotice(null)\n      activeHandleRef.current = targetHandle\n      setActiveTerminal('
    )
  })

  it('renders same-window terminal pane tabs without changing desktop layout', () => {
    expect(routeSource).toContain('requestWindowList(client)')
    expect(routeSource).toContain('windowPanes.length > 1')
    expect(routeSource).toContain('activateTerminalTarget(pane.windowId, pane.paneId)')
    expect(routeSource).toContain('startRemoteWindow(client, pane.windowId, pane.paneId, viewportRef.current)')
    expect(routeSource).not.toContain('pane.focus')
    expect(routeSource).not.toContain('window.activate')
  })

  it('keeps recent terminal tabs resident instead of navigating through cold routes', () => {
    expect(routeSource).toContain('const [residentTerminalHandles, setResidentTerminalHandles]')
    expect(routeSource).toContain('selectRemoteTerminalResidentSessions({')
    expect(routeSource).toContain('residentTerminalHandles.map((handle) => (')
    expect(routeSource).toContain('<TerminalPaneView')
    expect(routeSource).not.toContain('router.replace(targetPath)')
  })

  it('coalesces small foreground deltas and replaces large backlogs with a compact snapshot', () => {
    expect(routeSource).toContain('terminalRenderPausedRef.current = true')
    expect(routeSource).toContain('decideRemoteTerminalForegroundRecovery({')
    expect(routeSource).toContain("decision === 'compact-snapshot'")
    expect(routeSource).toContain("decision === 'coalesced-write'")
    expect(routeSource).toContain('limitBytes: TERMINAL_FOREGROUND_SMALL_DELTA_BYTES')
  })

  it('renders window tabs for grouped windows before falling back to same-window pane tabs', () => {
    expect(routeSource).toContain('const showGroupWindowTabs = groupWindowTabs.length > 1')
    expect(routeSource).toContain('showGroupWindowTabs ?')
    expect(routeSource).toContain('groupWindowTabs.map((window) => {')
    expect(routeSource).toContain('getActiveTerminalPane(window.panes, window.activePaneId)')
    expect(routeSource).toContain('handleGroupWindowTabPress(window)')
    expect(routeSource).toContain(': windowPanes.length > 1 ?')
  })

  it('provides explicit and long-press tab deletion with confirmation and exact replacement routing', () => {
    expect(routeSource).toContain("type TabDeleteMode = 'pane' | 'group'")
    expect(routeSource).toContain('function ManagedTerminalTab(')
    expect(routeSource).toContain("enterTabDeleteMode('pane')")
    expect(routeSource).toContain("enterTabDeleteMode('group')")
    expect(routeSource).toContain("handleTabLongPress('pane')")
    expect(routeSource).toContain("handleTabLongPress('group')")
    expect(routeSource).toContain('styles.paneTabDeleteButton')
    expect(routeSource).toContain("t('common.done')")
    expect(routeSource).toContain("Alert.alert(\n        t('terminal.deletePaneTitle')")
    expect(routeSource).toContain("Alert.alert(\n        t('terminal.removeGroupWindowTitle')")
    expect(routeSource).toContain("BackHandler.addEventListener('hardwareBackPress'")
    expect(routeSource).toContain('deleteRemotePane(client, pane.windowId, pane.paneId)')
    expect(routeSource).toContain(
      'removeRemoteWindowFromGroup(client, groupId, groupWindow.windowId)'
    )
    expect(routeSource).toContain(
      'navigateToReplacementPane(client, result.replacementPane, runId)'
    )
  })

  it('cleans up subscriptions and sockets when leaving the terminal screen', () => {
    expect(routeSource).toContain('unsubscribeRef.current?.()')
    expect(routeSource).toContain('clientRef.current?.close()')
    expect(routeSource).toContain("AppState.addEventListener('change'")
    expect(routeSource).toContain('clientRef.current?.notifyForeground()')
  })
})
