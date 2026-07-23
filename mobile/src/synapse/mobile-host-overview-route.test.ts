import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const routeSource = readFileSync(
  new URL('../../app/h/[hostId]/index.tsx', import.meta.url),
  'utf8'
)

describe('Synapse Mobile host overview route wiring', () => {
  it('keeps grouped windows out of the standalone window card list', () => {
    expect(routeSource).toContain('const groupedWindowIds = useMemo(() => {')
    expect(routeSource).toContain('.filter((window) => !groupedWindowIds.has(window.windowId))')
    expect(routeSource).toContain('...visibleGroups.map((group) => ({ type: \'group\' as const, group }))')
    expect(routeSource).toContain('...visibleWindows.map((window) => ({ type: \'window\' as const, window }))')
  })

  it('shows all group members when the search query matches the group name', () => {
    expect(routeSource).toContain('const filteredGroup = filterGroupForTerminalListFilter(group, terminalListFilter)')
    expect(routeSource).toContain('const matchesGroupName = filteredGroup.name.toLowerCase().includes(normalizedSearchQuery)')
    expect(routeSource).toContain('windows: (matchesGroupName ? filteredGroup.windows : filteredWindows)')
  })

  it('filters overview cards by recent, local, and remote terminal backend', () => {
    expect(routeSource).toContain("type TerminalListFilter = 'recent' | 'local' | 'remote'")
    expect(routeSource).toContain("const TERMINAL_LIST_FILTERS: TerminalListFilter[] = ['recent', 'local', 'remote']")
    expect(routeSource).toContain('function terminalListFilterLabel(filter: TerminalListFilter, t: MobileTranslate): string')
    expect(routeSource).toContain('function filterWindowForTerminalListFilter(')
    expect(routeSource).toContain('function filterGroupForTerminalListFilter(')
    expect(routeSource).toContain("const [terminalListFilter, setTerminalListFilter] = useState<TerminalListFilter>('recent')")
    expect(routeSource).toContain('filterWindowForTerminalListFilter(window, terminalListFilter)')
    expect(routeSource).toContain('terminalMatchesTerminalListFilter(terminal, terminalListFilter)')
    expect(routeSource).toContain('<BottomDrawer visible={showFilterModal} onClose={() => setShowFilterModal(false)}>')
  })

  it('sorts running terminals and windows ahead of stopped items', () => {
    expect(routeSource).toContain('function compareWindowsRunningFirst(')
    expect(routeSource).toContain('function compareTerminalsRunningFirst(')
    expect(routeSource).toContain('function compareOverviewItemsRunningFirst(')
    expect(routeSource).toContain('sort(compareWindowsRunningFirst)')
    expect(routeSource).toContain('sort(compareTerminalsRunningFirst)')
    expect(routeSource).toContain('sort(compareOverviewItemsRunningFirst)')
  })

  it('disables mobile window creation when the paired host scope cannot create windows', () => {
    expect(routeSource).toContain('disabled={!canCreateWindow || creatingWindow}')
  })

  it('starts and creates mobile terminals with an explicit default viewport', () => {
    expect(routeSource).toContain('const DEFAULT_REMOTE_START_VIEWPORT = { cols: 80, rows: 30 }')
    expect(routeSource).toContain('const result = await createRemoteWindow(client, {')
    expect(routeSource).toContain('initialCols: DEFAULT_REMOTE_START_VIEWPORT.cols')
    expect(routeSource).toContain('initialRows: DEFAULT_REMOTE_START_VIEWPORT.rows')
    expect(routeSource).toContain('startRemoteWindow(\n            client,\n            pane.windowId,\n            pane.paneId,\n            DEFAULT_REMOTE_START_VIEWPORT\n          )')
  })

  it('opens a creation form from the plus button and enters only the returned pane', () => {
    expect(routeSource).toContain("import { CreateTerminalDrawer } from '../../../src/components/CreateTerminalDrawer'")
    expect(routeSource).toContain('onPress={openCreateWindowDrawer}')
    expect(routeSource).toContain('<CreateTerminalDrawer')
    expect(routeSource).toContain('onSubmit={(params) => void handleCreateWindow(params)}')
    expect(routeSource).toContain('encodeURIComponent(result.pane.windowId)')
    expect(routeSource).toContain('encodeURIComponent(result.pane.paneId)')
    expect(routeSource).not.toContain('createRemoteWindow(client, DEFAULT_REMOTE_START_VIEWPORT)')
  })

  it('serializes create requests and ignores stale SSH profile loads', () => {
    expect(routeSource).toContain('const createWindowOperationRef = useRef<symbol | null>(null)')
    expect(routeSource).toContain('if (createWindowOperationRef.current)')
    expect(routeSource).toContain("const operationId = Symbol('create-window')")
    expect(routeSource).toContain('const sshProfileLoadOperationRef = useRef<symbol | null>(null)')
    expect(routeSource).toContain('sshProfileLoadOperationRef.current !== operationId')
  })

  it('drops stale group selections when windows disappear or become grouped elsewhere', () => {
    expect(routeSource).toContain('function filterSelectableWindowIds(')
    expect(routeSource).toContain('!groupedWindowIds.has(windowId)')
    expect(routeSource).toContain('filterSelectableWindowIds(current, overview.windows, overview.groups)')
  })

  it('clears stale sync errors after a successful background overview refresh', () => {
    const syncIndex = routeSource.indexOf('const syncOverviewState = useCallback(async () => {')
    const clearIndex = routeSource.indexOf('setError(null)', syncIndex)
    const catchIndex = routeSource.indexOf('} catch (err) {', syncIndex)

    expect(syncIndex).toBeGreaterThanOrEqual(0)
    expect(clearIndex).toBeGreaterThan(syncIndex)
    expect(clearIndex).toBeLessThan(catchIndex)
  })

  it('prevents overlapping background overview refreshes from writing stale host state', () => {
    expect(routeSource).toContain('const syncOverviewStateInFlightRef = useRef(false)')
    expect(routeSource).toContain('syncOverviewStateInFlightRef.current')
    expect(routeSource).toContain('syncOverviewStateInFlightRef.current = true')
    expect(routeSource).toContain('if (clientRef.current !== client) {')
    expect(routeSource).toContain('syncOverviewStateInFlightRef.current = false')
  })

  it('probes and refreshes the host overview when the app returns to foreground', () => {
    expect(routeSource).toContain('AppState')
    expect(routeSource).toContain("AppState.addEventListener('change', (state) => {")
    expect(routeSource).toContain("if (state !== 'active')")
    expect(routeSource).toContain('clientRef.current?.notifyForeground()')
    expect(routeSource).toContain('void syncOverviewState()')
    expect(routeSource).toContain('subscription.remove()')
  })

  it('ignores stale host load and mutation responses after reconnecting or leaving the page', () => {
    expect(routeSource).toContain('const loadGenerationRef = useRef(0)')
    expect(routeSource).toContain('loadGenerationRef.current += 1')
    expect(routeSource).toContain('const isCurrentLoad = () => loadGenerationRef.current === loadId')
    expect(routeSource).toContain('loadGenerationRef.current !== loadId || clientRef.current !== client')
  })

  it('maps protocol-level overview errors to user-facing messages', () => {
    expect(routeSource).toContain('function overviewErrorMessage(err: unknown, t: MobileTranslate): string')
    expect(routeSource).toContain("t('overview.windowNotFound')")
    expect(routeSource).toContain("t('overview.paneNotFound')")
    expect(routeSource).toContain("t('overview.workspaceNotLoaded')")
    expect(routeSource).toContain('setError(overviewErrorMessage(err, t))')
  })

  it('uses explicit search and group-selection modes instead of always showing card plus buttons', () => {
    expect(routeSource).toContain('const [searchVisible, setSearchVisible] = useState(false)')
    expect(routeSource).toContain('setSearchVisible((visible) => !visible)')
    expect(routeSource).toContain('searchVisible || hasSearchQuery ?')
    expect(routeSource).toContain('const [groupSelectionMode, setGroupSelectionMode] = useState(false)')
    expect(routeSource).toContain('if (!groupSelectionMode) {')
    expect(routeSource).toContain('groupSelectionMode ? (')
    expect(routeSource).not.toContain("{selectedForGroup ? '✓' : '+'}")
  })

  it('only exposes group selection when the host has enough ungrouped windows', () => {
    expect(routeSource).toContain('const groupableWindowCount = useMemo(')
    expect(routeSource).toContain("const canUseGroupSelection = overviewMode === 'windows' && groupableWindowCount >= 2")
    expect(routeSource).toContain('if (!canUseGroupSelection) {')
    expect(routeSource).toContain("overviewMode === 'windows' ? (")
    expect(routeSource).toContain('!canUseGroupSelection || creatingGroup')
  })

  it('selects window cards instead of opening panes while building a group', () => {
    expect(routeSource).toContain('if (groupSelectionMode) {\n          onToggleGroupSelection(item.windowId)')
    expect(routeSource).toContain('disabled={(groupSelectionMode ? false : !activePane) || deleting}')
    expect(routeSource).toContain('selectionMode={groupSelectionMode}')
    expect(routeSource).toContain('if (selectionMode) {')
    expect(routeSource).toContain('!selectionMode && pane.running ?')
    expect(routeSource).toContain('!selectionMode && isStartableTerminalPane(pane) ?')
    expect(routeSource).toContain("return pane.kind === 'terminal' && !pane.running")
    expect(routeSource).not.toContain("(pane.backend ?? 'local') === 'local'")
    expect(routeSource).toContain("t('overview.sshCredentialsUnavailable')")
  })

  it('opens the host switcher from the toolbar and verifies connection before routing', () => {
    expect(routeSource).toContain("import { loadHosts } from '../../../src/transport/host-store'")
    expect(routeSource).toContain('useWindowDimensions')
    expect(routeSource).toContain('const hostSwitcherPanelWidth = Math.min(286, Math.max(220, screenWidth - spacing.lg * 2))')
    expect(routeSource).toContain('const [pairedHosts, setPairedHosts] = useState<HostProfile[]>([])')
    expect(routeSource).toContain('const [hostSwitcherOpen, setHostSwitcherOpen] = useState(false)')
    expect(routeSource).toContain('await withSwitchTimeout(loadHostOverviewData(client))')
    expect(routeSource).toContain('router.replace(`/h/${host.id}`)')
    expect(routeSource).toContain('setHostSwitchError(')
    expect(routeSource).toContain('styles.hostSwitcherDock')
    expect(routeSource).toContain('styles.hostSwitcherPanel, { width: hostSwitcherPanelWidth }')
    expect(routeSource).toContain('pairedHosts.length > 1 && hostSwitcherOpen ?')
    expect(routeSource).not.toContain('styles.hostSwitcherTab')
  })

  it('groups the host switcher by relay and shows each paired desktop IP', () => {
    expect(routeSource).toContain("from '../../../src/transport/host-display'")
    expect(routeSource).toContain('const pairedHostGroups = useMemo(() => groupHostsByRelay(pairedHosts), [pairedHosts])')
    expect(routeSource).toContain('pairedHostGroups.map((group) => (')
    expect(routeSource).toContain("group.relayEndpoint ?? t('common.localNetwork')")
    expect(routeSource).toContain('hostNetworkAddress(host.endpoint)')
    expect(routeSource).toContain("t('common.desktopIp', { address })")
    expect(routeSource).not.toContain('switcherHostEndpointLabel')
  })

  it('places overview actions in the second toolbar row and keeps the native header simple', () => {
    expect(routeSource).toContain('<Stack.Screen')
    expect(routeSource).toContain("headerTitle: t('overview.windowsTitle')")
    expect(routeSource).toContain('styles.actionToolbar')
    expect(routeSource).toContain('styles.toolbarLeadingActions')
    expect(routeSource).toContain('styles.toolbarActions')
    expect(routeSource).not.toContain('headerRight: () => (')
    expect(routeSource).not.toContain('styles.navNewTerminalButton')
    expect(routeSource).not.toContain('styles.navStatusDot')
    expect(routeSource).not.toContain("<Text style={styles.title}>{t('nav.desktop')}</Text>")
    expect(routeSource).not.toContain('connectionLabel(connectionState, t)')
    expect(routeSource).not.toContain('hostEndpointLabel')
  })

  it('places the host switch icon immediately before the icon-only filter button', () => {
    const toolbarStart = routeSource.indexOf('<View style={styles.actionToolbar}>')
    const trailingActionsStart = routeSource.indexOf(
      '<View style={styles.toolbarActions}>',
      toolbarStart
    )
    const leadingActions = routeSource.slice(toolbarStart, trailingActionsStart)

    expect(toolbarStart).toBeGreaterThanOrEqual(0)
    expect(trailingActionsStart).toBeGreaterThan(toolbarStart)
    expect(leadingActions).toContain('styles.toolbarLeadingActions')
    expect(leadingActions).toContain('styles.navIconButton')
    expect(leadingActions).toContain('hostSwitcherOpen && styles.iconButtonActive')
    expect(leadingActions).toContain('filterActiveCount > 0 && styles.iconButtonActive')
    const hostSwitchIconIndex = leadingActions.indexOf('<Server size={18}')
    const filterIconIndex = leadingActions.indexOf('<Filter size={18}')
    expect(hostSwitchIconIndex).toBeGreaterThanOrEqual(0)
    expect(filterIconIndex).toBeGreaterThan(hostSwitchIconIndex)
    expect(leadingActions).not.toContain('<Text')
  })

  it('confirms destructive window and group deletes before sending RPC requests', () => {
    expect(routeSource).toContain("import {\n  ActivityIndicator,\n  Alert,")
    expect(routeSource).toContain("Alert.alert(t('overview.deleteWindowTitle'), t('overview.deleteWindowMessage')")
    expect(routeSource).toContain("Alert.alert(t('overview.deleteGroupTitle'), t('overview.deleteGroupMessage')")
    expect(routeSource).toContain('deleteRemoteWindow(client, windowId)')
    expect(routeSource).toContain('deleteRemoteGroup(client, groupId)')
  })
})
