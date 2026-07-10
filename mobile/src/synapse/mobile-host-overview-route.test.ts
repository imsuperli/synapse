import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const routeSource = readFileSync(
  new URL('../../app/h/[hostId]/index.tsx', import.meta.url),
  'utf8'
)

describe('Synapse Mobile host overview route wiring', () => {
  it('keeps grouped windows out of the standalone window card list', () => {
    expect(routeSource).toContain('const groupedWindowIds = useMemo(() => {')
    expect(routeSource).toContain('windows.filter((window) => !groupedWindowIds.has(window.windowId))')
    expect(routeSource).toContain('...visibleGroups.map((group) => ({ type: \'group\' as const, group }))')
    expect(routeSource).toContain('...visibleWindows.map((window) => ({ type: \'window\' as const, window }))')
  })

  it('shows all group members when the search query matches the group name', () => {
    expect(routeSource).toContain('const matchesGroupName = group.name.toLowerCase().includes(normalizedSearchQuery)')
    expect(routeSource).toContain('windows: matchesGroupName ? group.windows : filteredWindows')
  })

  it('disables mobile window creation when the paired host scope cannot create windows', () => {
    expect(routeSource).toContain('disabled={!canCreateWindow || creatingWindow}')
  })

  it('starts and creates mobile terminals with an explicit default viewport', () => {
    expect(routeSource).toContain('const DEFAULT_REMOTE_START_VIEWPORT = { cols: 80, rows: 30 }')
    expect(routeSource).toContain('createRemoteWindow(client, DEFAULT_REMOTE_START_VIEWPORT)')
    expect(routeSource).toContain('startRemoteWindow(\n            client,\n            pane.windowId,\n            pane.paneId,\n            DEFAULT_REMOTE_START_VIEWPORT\n          )')
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
    expect(routeSource).toContain("overviewMode === 'windows' || groupSelectionMode ?")
    expect(routeSource).toContain('!groupSelectionMode && !canUseGroupSelection')
  })

  it('renders a side-docked host switcher that verifies connection before routing', () => {
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
    expect(routeSource).toContain("pairedHosts.length > 1 ?")
  })

  it('places overview actions in the native header and removes the duplicate desktop status row', () => {
    expect(routeSource).toContain('<Stack.Screen')
    expect(routeSource).toContain("headerTitle: ''")
    expect(routeSource).toContain('headerRight: () => (')
    expect(routeSource).toContain('styles.navNewTerminalButton')
    expect(routeSource).toContain('styles.navStatusDot')
    expect(routeSource).not.toContain("<Text style={styles.title}>{t('nav.desktop')}</Text>")
    expect(routeSource).not.toContain('connectionLabel(connectionState, t)')
    expect(routeSource).not.toContain('hostEndpointLabel')
  })

  it('confirms destructive window and group deletes before sending RPC requests', () => {
    expect(routeSource).toContain("import {\n  ActivityIndicator,\n  Alert,")
    expect(routeSource).toContain("Alert.alert(t('overview.deleteWindowTitle'), t('overview.deleteWindowMessage')")
    expect(routeSource).toContain("Alert.alert(t('overview.deleteGroupTitle'), t('overview.deleteGroupMessage')")
    expect(routeSource).toContain('deleteRemoteWindow(client, windowId)')
    expect(routeSource).toContain('deleteRemoteGroup(client, groupId)')
  })
})
