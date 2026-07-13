import { useCallback, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  AppState,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View
} from 'react-native'
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import {
  Check,
  Filter,
  Layers,
  Play,
  Plus,
  RotateCw,
  Search,
  Server,
  Settings,
  Square,
  TerminalSquare,
  X
} from 'lucide-react-native'
import {
  connectToHost,
  createRemoteWindow,
  createRemoteGroup,
  deleteRemoteGroup,
  deleteRemoteWindow,
  requestSSHProfileList,
  startRemoteWindow,
  stopRemotePane,
  type RemoteWindowGroupSummary,
  type RemotePaneSummary,
  type RemoteSSHProfileSummary,
  type RemoteTerminalSummary,
  type WindowCreateParams,
  type RemoteWindowSummary
} from '../../../src/synapse/remote'
import { loadHostOverviewData } from '../../../src/synapse/host-overview'
import { loadHosts } from '../../../src/transport/host-store'
import {
  filterTerminals,
  filterWindows,
  normalizeTerminalSearchQuery
} from '../../../src/synapse/terminal-search'
import type { RpcClient } from '../../../src/transport/rpc-client'
import type { ConnectionLogEntry, ConnectionState, HostProfile } from '../../../src/transport/types'
import { colors, radii, spacing, typography } from '../../../src/theme/mobile-theme'
import { useMobileI18n, type MobileTranslate } from '../../../src/i18n'
import { BottomDrawer } from '../../../src/components/BottomDrawer'
import { CreateTerminalDrawer } from '../../../src/components/CreateTerminalDrawer'

function getParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}

const OVERVIEW_STATUS_SYNC_MS = 2500
const DEFAULT_REMOTE_START_VIEWPORT = { cols: 80, rows: 30 }
const HOST_SWITCH_TIMEOUT_MS = 15000

type OverviewItem =
  | { type: 'group'; group: RemoteWindowGroupSummary }
  | { type: 'window'; window: RemoteWindowSummary }
  | { type: 'terminal'; terminal: RemoteTerminalSummary }

type TerminalListFilter = 'recent' | 'local' | 'remote'

const TERMINAL_LIST_FILTERS: TerminalListFilter[] = ['recent', 'local', 'remote']

function paneTitle(pane: RemotePaneSummary, t: MobileTranslate): string {
  return pane.title || pane.command || pane.cwd?.split(/[\\/]/).filter(Boolean).at(-1) || t('common.terminal')
}

function backendLabel(backend: string | null | undefined, t: MobileTranslate): string {
  switch (backend ?? 'local') {
    case 'local':
      return t('overview.backendLocal')
    case 'ssh':
      return t('overview.backendSsh')
    default:
      return backend ?? t('overview.backendLocal')
  }
}

function terminalListFilterLabel(filter: TerminalListFilter, t: MobileTranslate): string {
  switch (filter) {
    case 'local':
      return t('overview.filterLocal')
    case 'remote':
      return t('overview.filterRemote')
    case 'recent':
    default:
      return t('overview.filterRecent')
  }
}

function backendMatchesTerminalListFilter(
  backend: string | null | undefined,
  filter: TerminalListFilter
): boolean {
  if (filter === 'recent') {
    return true
  }
  const normalizedBackend = backend ?? 'local'
  return filter === 'local' ? normalizedBackend === 'local' : normalizedBackend !== 'local'
}

function terminalMatchesTerminalListFilter(
  terminal: RemoteTerminalSummary,
  filter: TerminalListFilter
): boolean {
  return backendMatchesTerminalListFilter(terminal.backend, filter)
}

function paneMatchesTerminalListFilter(
  pane: RemotePaneSummary,
  filter: TerminalListFilter
): boolean {
  return pane.kind === 'terminal' && backendMatchesTerminalListFilter(pane.backend, filter)
}

function windowWithFilteredPanes(
  window: RemoteWindowSummary,
  panes: RemotePaneSummary[]
): RemoteWindowSummary | null {
  const terminalPanes = panes.filter((pane) => pane.kind === 'terminal')
  if (terminalPanes.length === 0) {
    return null
  }
  return {
    ...window,
    activePaneId: panes.some((pane) => pane.paneId === window.activePaneId)
      ? window.activePaneId
      : terminalPanes[0]?.paneId ?? '',
    paneCount: panes.length,
    terminalPaneCount: terminalPanes.length,
    panes
  }
}

function filterWindowForTerminalListFilter(
  window: RemoteWindowSummary,
  filter: TerminalListFilter
): RemoteWindowSummary | null {
  if (filter === 'recent') {
    return windowWithFilteredPanes(
      window,
      window.panes.filter((pane) => pane.kind === 'terminal')
    )
  }
  return windowWithFilteredPanes(
    window,
    window.panes.filter((pane) => paneMatchesTerminalListFilter(pane, filter))
  )
}

function filterGroupForTerminalListFilter(
  group: RemoteWindowGroupSummary,
  filter: TerminalListFilter
): RemoteWindowGroupSummary | null {
  const windows = group.windows.flatMap((window) => {
    const filtered = filterWindowForTerminalListFilter(window, filter)
    return filtered ? [filtered] : []
  })
  if (windows.length === 0) {
    return null
  }
  return {
    ...group,
    activeWindowId: windows.some((window) => window.windowId === group.activeWindowId)
      ? group.activeWindowId
      : windows[0]?.windowId ?? '',
    windowCount: windows.length,
    windows
  }
}

function paneMeta(pane: RemotePaneSummary, t: MobileTranslate): string {
  const backend = backendLabel(pane.backend, t)
  const cwd = pane.cwd || t('overview.unknownCwd')
  return pane.running
    ? `${backend} - ${t('overview.pid')} ${pane.pid ?? '-'} - ${cwd}`
    : `${backend} - ${cwd}`
}

function windowPaneCountLabel(count: number, t: MobileTranslate): string {
  return t(
    count === 1 ? 'overview.windowTerminalPaneCountOne' : 'overview.windowTerminalPaneCountMany',
    { count }
  )
}

function statusLabel(status: string, running: boolean, t: MobileTranslate): string {
  if (running) {
    return t('overview.running')
  }
  if (status === 'error') {
    return t('overview.error')
  }
  if (status === 'restoring') {
    return t('common.starting')
  }
  return t('overview.stopped')
}

function statusColor(status: string, running: boolean): string {
  if (running) {
    return colors.statusGreen
  }
  if (status === 'restoring') {
    return colors.statusAmber
  }
  if (status === 'error') {
    return colors.statusRed
  }
  return colors.borderSubtle
}

function getActiveTerminalPane(window: RemoteWindowSummary): RemotePaneSummary | null {
  return (
    window.panes.find((pane) => pane.paneId === window.activePaneId && pane.kind === 'terminal') ??
    window.panes.find((pane) => pane.kind === 'terminal') ??
    null
  )
}

function isStartableLocalPane(pane: RemotePaneSummary): boolean {
  return pane.kind === 'terminal' && !pane.running && (pane.backend ?? 'local') === 'local'
}

function windowTopBorderColor(window: RemoteWindowSummary): string {
  const runningPane = window.panes.find((pane) => pane.running)
  if (runningPane) {
    return statusColor(runningPane.status, true)
  }
  const errorPane = window.panes.find((pane) => pane.status === 'error')
  if (errorPane) {
    return colors.statusRed
  }
  const restoringPane = window.panes.find((pane) => pane.status === 'restoring')
  if (restoringPane) {
    return colors.statusAmber
  }
  return colors.borderSubtle
}

function windowHasRunningTerminal(window: RemoteWindowSummary): boolean {
  return window.panes.some((pane) => pane.kind === 'terminal' && pane.running)
}

function groupHasRunningTerminal(group: RemoteWindowGroupSummary): boolean {
  return group.windows.some(windowHasRunningTerminal)
}

function timeValue(value: string | null | undefined): number {
  if (!value) {
    return 0
  }
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function windowSortTime(window: RemoteWindowSummary): number {
  return timeValue(window.lastActiveAt || window.createdAt)
}

function groupSortTime(group: RemoteWindowGroupSummary): number {
  return Math.max(
    timeValue(group.lastActiveAt || group.createdAt),
    ...group.windows.map(windowSortTime)
  )
}

function compareWindowsRunningFirst(a: RemoteWindowSummary, b: RemoteWindowSummary): number {
  const runningDelta = Number(windowHasRunningTerminal(b)) - Number(windowHasRunningTerminal(a))
  if (runningDelta !== 0) {
    return runningDelta
  }
  return windowSortTime(b) - windowSortTime(a)
}

function compareTerminalsRunningFirst(a: RemoteTerminalSummary, b: RemoteTerminalSummary): number {
  return Number(b.status === 'alive') - Number(a.status === 'alive')
}

function overviewItemRunning(item: OverviewItem): boolean {
  if (item.type === 'group') {
    return groupHasRunningTerminal(item.group)
  }
  if (item.type === 'window') {
    return windowHasRunningTerminal(item.window)
  }
  return item.terminal.status === 'alive'
}

function overviewItemSortTime(item: OverviewItem): number {
  if (item.type === 'group') {
    return groupSortTime(item.group)
  }
  if (item.type === 'window') {
    return windowSortTime(item.window)
  }
  return 0
}

function compareOverviewItemsRunningFirst(a: OverviewItem, b: OverviewItem): number {
  const aRunning = overviewItemRunning(a)
  const bRunning = overviewItemRunning(b)
  const runningDelta = Number(bRunning) - Number(aRunning)
  if (runningDelta !== 0) {
    return runningDelta
  }
  return overviewItemSortTime(b) - overviewItemSortTime(a)
}

function replaceWindowInGroups(
  groups: RemoteWindowGroupSummary[],
  replacement: RemoteWindowSummary
): RemoteWindowGroupSummary[] {
  return groups.map((group) => ({
    ...group,
    windows: group.windows.map((window) =>
      window.windowId === replacement.windowId ? replacement : window
    )
  }))
}

function filterSelectableWindowIds(
  selectedWindowIds: string[],
  windows: RemoteWindowSummary[],
  groups: RemoteWindowGroupSummary[]
): string[] {
  const liveWindowIds = new Set(windows.map((window) => window.windowId))
  const groupedWindowIds = new Set(
    groups.flatMap((group) => group.windows.map((window) => window.windowId))
  )
  return selectedWindowIds.filter(
    (windowId) => liveWindowIds.has(windowId) && !groupedWindowIds.has(windowId)
  )
}

function switcherHostEndpointLabel(host: HostProfile, t: MobileTranslate): string {
  return host.relayEndpoint ? `${t('common.relay')} ${host.relayEndpoint}` : host.endpoint
}

function withSwitchTimeout<T>(promise: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeout = setTimeout(() => reject(new Error('Connection timeout')), HOST_SWITCH_TIMEOUT_MS)
  })
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout) {
      clearTimeout(timeout)
    }
  })
}

function overviewErrorMessage(err: unknown, t: MobileTranslate): string {
  const message = err instanceof Error ? err.message : String(err)
  if (/remote_start_ssh_not_supported/i.test(message)) {
    return t('overview.onlyLocalStart')
  }
  if (/window_not_found/i.test(message)) {
    return t('overview.windowNotFound')
  }
  if (/pane_not_found|terminal_not_found/i.test(message)) {
    return t('overview.paneNotFound')
  }
  if (/workspace_not_loaded/i.test(message)) {
    return t('overview.workspaceNotLoaded')
  }
  if (/invalid working directory|unable to resolve working directory/i.test(message)) {
    return t('overview.invalidWorkingDirectory')
  }
  if (/ssh profile not found/i.test(message)) {
    return t('overview.sshProfileNotFound')
  }
  if (/ssh authentication failed|all configured authentication methods failed/i.test(message)) {
    return t('overview.sshAuthenticationFailed')
  }
  if (/remote_ssh_.*_unavailable|ssh session services are not initialized/i.test(message)) {
    return t('createTerminal.remoteUnavailable')
  }
  return message
}

export default function HostOverviewScreen() {
  const params = useLocalSearchParams<{ hostId?: string }>()
  const hostId = getParam(params.hostId)
  const router = useRouter()
  const { t } = useMobileI18n()
  const { width: screenWidth } = useWindowDimensions()
  const [, setConnectionState] = useState<ConnectionState | 'loading'>('loading')
  const [terminals, setTerminals] = useState<RemoteTerminalSummary[]>([])
  const [windows, setWindows] = useState<RemoteWindowSummary[]>([])
  const [groups, setGroups] = useState<RemoteWindowGroupSummary[]>([])
  const [overviewMode, setOverviewMode] = useState<'terminals' | 'windows'>('terminals')
  const [canCreateWindow, setCanCreateWindow] = useState(false)
  const [canCreateSSHWindow, setCanCreateSSHWindow] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchVisible, setSearchVisible] = useState(false)
  const [showFilterModal, setShowFilterModal] = useState(false)
  const [terminalListFilter, setTerminalListFilter] = useState<TerminalListFilter>('recent')
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [creatingWindow, setCreatingWindow] = useState(false)
  const [showCreateWindowDrawer, setShowCreateWindowDrawer] = useState(false)
  const [createWindowFormKey, setCreateWindowFormKey] = useState(0)
  const [createWindowError, setCreateWindowError] = useState<string | null>(null)
  const [sshProfiles, setSSHProfiles] = useState<RemoteSSHProfileSummary[]>([])
  const [loadingSSHProfiles, setLoadingSSHProfiles] = useState(false)
  const [sshProfilesError, setSSHProfilesError] = useState<string | null>(null)
  const [creatingGroup, setCreatingGroup] = useState(false)
  const [startingPaneKey, setStartingPaneKey] = useState<string | null>(null)
  const [stoppingPaneKey, setStoppingPaneKey] = useState<string | null>(null)
  const [deletingWindowId, setDeletingWindowId] = useState<string | null>(null)
  const [deletingGroupId, setDeletingGroupId] = useState<string | null>(null)
  const [groupSelectionMode, setGroupSelectionMode] = useState(false)
  const [selectedGroupWindowIds, setSelectedGroupWindowIds] = useState<string[]>([])
  const [pairedHosts, setPairedHosts] = useState<HostProfile[]>([])
  const [hostSwitcherOpen, setHostSwitcherOpen] = useState(false)
  const [switchingHostId, setSwitchingHostId] = useState<string | null>(null)
  const [hostSwitchError, setHostSwitchError] = useState<string | null>(null)
  const clientRef = useRef<RpcClient | null>(null)
  const logsRef = useRef<ConnectionLogEntry[]>([])
  const loadGenerationRef = useRef(0)
  const syncOverviewStateInFlightRef = useRef(false)
  const createWindowOperationRef = useRef<symbol | null>(null)
  const sshProfileLoadOperationRef = useRef<symbol | null>(null)

  const normalizedSearchQuery = useMemo(
    () => normalizeTerminalSearchQuery(searchQuery),
    [searchQuery]
  )
  const groupedWindowIds = useMemo(() => {
    const ids = new Set<string>()
    for (const group of groups) {
      for (const window of group.windows) {
        ids.add(window.windowId)
      }
    }
    return ids
  }, [groups])
  const filterActiveCount = terminalListFilter === 'recent' ? 0 : 1
  const filterLabel = terminalListFilterLabel(terminalListFilter, t)
  const ungroupedFilteredWindows = useMemo(
    () =>
      windows
        .filter((window) => !groupedWindowIds.has(window.windowId))
        .flatMap((window) => {
          const filteredWindow = filterWindowForTerminalListFilter(window, terminalListFilter)
          return filteredWindow ? [filteredWindow] : []
        }),
    [groupedWindowIds, terminalListFilter, windows]
  )
  const groupableWindowCount = useMemo(
    () => ungroupedFilteredWindows.length,
    [ungroupedFilteredWindows]
  )
  const visibleWindows = useMemo(
    () =>
      filterWindows(
        ungroupedFilteredWindows,
        normalizedSearchQuery
      ).sort(compareWindowsRunningFirst),
    [normalizedSearchQuery, ungroupedFilteredWindows]
  )
  const visibleGroups = useMemo(
    () =>
      groups
        .flatMap((group) => {
          const filteredGroup = filterGroupForTerminalListFilter(group, terminalListFilter)
          if (!filteredGroup) {
            return []
          }
          if (!normalizedSearchQuery) {
            return [filteredGroup]
          }
          const matchesGroupName = filteredGroup.name.toLowerCase().includes(normalizedSearchQuery)
          const filteredWindows = filterWindows(filteredGroup.windows, normalizedSearchQuery)
          if (!matchesGroupName && filteredWindows.length === 0) {
            return []
          }
          return [
            {
              ...filteredGroup,
              windows: (matchesGroupName ? filteredGroup.windows : filteredWindows)
                .slice()
                .sort(compareWindowsRunningFirst)
            }
          ]
        })
        .sort((a, b) => {
          const runningDelta = Number(groupHasRunningTerminal(b)) - Number(groupHasRunningTerminal(a))
          if (runningDelta !== 0) {
            return runningDelta
          }
          return groupSortTime(b) - groupSortTime(a)
        }),
    [groups, normalizedSearchQuery, terminalListFilter]
  )
  const visibleTerminals = useMemo(
    () =>
      filterTerminals(
        terminals.filter((terminal) => terminalMatchesTerminalListFilter(terminal, terminalListFilter)),
        normalizedSearchQuery
      ).sort(compareTerminalsRunningFirst),
    [normalizedSearchQuery, terminalListFilter, terminals]
  )
  const overviewItems = useMemo<OverviewItem[]>(
    () => {
      if (overviewMode === 'windows') {
        return [
          ...visibleGroups.map((group) => ({ type: 'group' as const, group })),
          ...visibleWindows.map((window) => ({ type: 'window' as const, window }))
        ].sort(compareOverviewItemsRunningFirst)
      }
      return visibleTerminals.map((terminal) => ({ type: 'terminal', terminal }))
    },
    [overviewMode, visibleGroups, visibleTerminals, visibleWindows]
  )
  const hasSearchQuery = normalizedSearchQuery.length > 0
  const canUseGroupSelection = overviewMode === 'windows' && groupableWindowCount >= 2
  const hostSwitcherPanelWidth = Math.min(286, Math.max(220, screenWidth - spacing.lg * 2))
  const appendLog = useCallback((entry: ConnectionLogEntry) => {
    logsRef.current = [...logsRef.current, entry].slice(-80)
  }, [])

  const closeClient = useCallback(() => {
    loadGenerationRef.current += 1
    syncOverviewStateInFlightRef.current = false
    createWindowOperationRef.current = null
    sshProfileLoadOperationRef.current = null
    clientRef.current?.close()
    clientRef.current = null
  }, [])

  const loadAndConnect = useCallback(async () => {
    closeClient()
    const loadId = loadGenerationRef.current
    const isCurrentLoad = () => loadGenerationRef.current === loadId
    let client: RpcClient | null = null
    setRefreshing(true)
    setCreatingWindow(false)
    setConnectionState('loading')
    setError(null)
    logsRef.current = []
    setTerminals([])
    setWindows([])
    setGroups([])
    setOverviewMode('terminals')
    setCanCreateWindow(false)
    setCanCreateSSHWindow(false)
    setShowCreateWindowDrawer(false)
    setCreateWindowError(null)
    setSSHProfiles([])
    setLoadingSSHProfiles(false)
    setSSHProfilesError(null)
    setStartingPaneKey(null)
    setStoppingPaneKey(null)
    setGroupSelectionMode(false)
    setSelectedGroupWindowIds([])
    setHostSwitchError(null)
    try {
      const hosts = await loadHosts()
      if (!isCurrentLoad()) {
        return
      }
      setPairedHosts(hosts)
      const loadedHost = hosts.find((host) => host.id === hostId) ?? null
      if (!loadedHost) {
        setError(t('overview.hostNotFound'))
        setConnectionState('disconnected')
        return
      }
      client = connectToHost(loadedHost, {
        onStateChange: (state) => {
          if (isCurrentLoad()) {
            setConnectionState(state)
          }
        },
        onLog: (entry) => {
          if (isCurrentLoad()) {
            appendLog(entry)
          }
        }
      })
      if (!isCurrentLoad()) {
        client.close()
        return
      }
      clientRef.current = client
      const overview = await loadHostOverviewData(client)
      if (!isCurrentLoad() || clientRef.current !== client) {
        client.close()
        return
      }
      setOverviewMode(overview.mode)
      setCanCreateWindow(overview.canCreateWindow)
      setCanCreateSSHWindow(overview.canCreateSSHWindow)
      setWindows(overview.windows)
      setGroups(overview.groups)
      setSelectedGroupWindowIds((current) =>
        filterSelectableWindowIds(current, overview.windows, overview.groups)
      )
      setTerminals(
        overview.terminals.filter((terminal) => terminal.windowId && terminal.paneId)
      )
    } catch (err) {
      if (isCurrentLoad()) {
        setError(overviewErrorMessage(err, t))
      }
    } finally {
      if (isCurrentLoad()) {
        setRefreshing(false)
      }
    }
  }, [appendLog, closeClient, hostId, t])

  useFocusEffect(
    useCallback(() => {
      void loadAndConnect()
      return () => closeClient()
    }, [closeClient, loadAndConnect])
  )

  const openPane = useCallback(
    async (pane: RemotePaneSummary) => {
      if (pane.kind !== 'terminal') {
        return
      }
      const paneKey = `${pane.windowId}:${pane.paneId}`
      const loadId = loadGenerationRef.current
      let operationClient: RpcClient | null = null
      try {
        setError(null)
        if (!pane.running) {
          if (!isStartableLocalPane(pane)) {
            setError(t('overview.onlyLocalStart'))
            return
          }
          const client = clientRef.current
          if (!client) {
            setError(t('overview.notConnected'))
            return
          }
          operationClient = client
          setStartingPaneKey(paneKey)
          const result = await startRemoteWindow(
            client,
            pane.windowId,
            pane.paneId,
            DEFAULT_REMOTE_START_VIEWPORT
          )
          if (loadGenerationRef.current !== loadId || clientRef.current !== client) {
            return
          }
          const nextPane = result.pane ?? result.startedPanes[0] ?? pane
          setWindows((current) =>
            current.map((window) =>
              window.windowId === result.window.windowId ? result.window : window
            )
          )
          setGroups((current) => replaceWindowInGroups(current, result.window))
          router.push(
            `/h/${hostId}/t/${encodeURIComponent(nextPane.windowId)}/${encodeURIComponent(nextPane.paneId)}`
          )
          return
        }
        router.push(
          `/h/${hostId}/t/${encodeURIComponent(pane.windowId)}/${encodeURIComponent(pane.paneId)}`
        )
      } catch (err) {
        if (!operationClient || (loadGenerationRef.current === loadId && clientRef.current === operationClient)) {
          setError(overviewErrorMessage(err, t))
        }
      } finally {
        if (!operationClient || (loadGenerationRef.current === loadId && clientRef.current === operationClient)) {
          setStartingPaneKey(null)
        }
      }
    },
    [hostId, router, t]
  )

  const openWindow = useCallback(
    async (window: RemoteWindowSummary) => {
      const pane = getActiveTerminalPane(window)
      if (pane) {
        await openPane(pane)
      }
    },
    [openPane]
  )

  const openGroup = useCallback(
    async (group: RemoteWindowGroupSummary) => {
      const activeWindow =
        group.windows.find((window) => window.windowId === group.activeWindowId) ??
        group.windows[0]
      if (activeWindow) {
        await openWindow(activeWindow)
      }
    },
    [openWindow]
  )

  const openTerminal = useCallback(
    (terminal: RemoteTerminalSummary) => {
      if (terminal.status !== 'alive') {
        setError(t('overview.onlyLocalStart'))
        return
      }
      router.push(
        `/h/${hostId}/t/${encodeURIComponent(terminal.windowId ?? '')}/${encodeURIComponent(terminal.paneId ?? '')}`
      )
    },
    [hostId, router, t]
  )

  const loadSSHProfilesForCreate = useCallback(async () => {
    if (!canCreateSSHWindow) {
      sshProfileLoadOperationRef.current = null
      setSSHProfiles([])
      setSSHProfilesError(null)
      setLoadingSSHProfiles(false)
      return
    }
    const client = clientRef.current
    if (!client) {
      sshProfileLoadOperationRef.current = null
      setLoadingSSHProfiles(false)
      setSSHProfilesError(t('overview.notConnected'))
      return
    }
    const loadId = loadGenerationRef.current
    const operationId = Symbol('load-ssh-profiles')
    sshProfileLoadOperationRef.current = operationId
    setLoadingSSHProfiles(true)
    setSSHProfilesError(null)
    try {
      const profiles = await requestSSHProfileList(client)
      if (
        loadGenerationRef.current !== loadId ||
        clientRef.current !== client ||
        sshProfileLoadOperationRef.current !== operationId
      ) {
        return
      }
      setSSHProfiles(profiles)
    } catch (err) {
      if (
        loadGenerationRef.current === loadId &&
        clientRef.current === client &&
        sshProfileLoadOperationRef.current === operationId
      ) {
        setSSHProfilesError(overviewErrorMessage(err, t))
      }
    } finally {
      if (sshProfileLoadOperationRef.current === operationId) {
        sshProfileLoadOperationRef.current = null
        if (loadGenerationRef.current === loadId && clientRef.current === client) {
          setLoadingSSHProfiles(false)
        }
      }
    }
  }, [canCreateSSHWindow, t])

  const openCreateWindowDrawer = useCallback(() => {
    if (!canCreateWindow) {
      setError(t('overview.createUnavailable'))
      return
    }
    if (!clientRef.current) {
      setError(t('overview.notConnected'))
      return
    }
    setError(null)
    setShowFilterModal(false)
    setHostSwitcherOpen(false)
    setHostSwitchError(null)
    setCreateWindowError(null)
    setSSHProfiles([])
    setSSHProfilesError(null)
    setCreateWindowFormKey((current) => current + 1)
    setShowCreateWindowDrawer(true)
    if (canCreateSSHWindow) {
      void loadSSHProfilesForCreate()
    }
  }, [canCreateSSHWindow, canCreateWindow, loadSSHProfilesForCreate, t])

  const closeCreateWindowDrawer = useCallback(() => {
    if (!creatingWindow) {
      sshProfileLoadOperationRef.current = null
      setShowCreateWindowDrawer(false)
      setCreateWindowError(null)
      setLoadingSSHProfiles(false)
      setSSHProfilesError(null)
    }
  }, [creatingWindow])

  const handleCreateWindow = useCallback(async (params: WindowCreateParams) => {
    if (createWindowOperationRef.current) {
      return
    }
    if (!canCreateWindow || (params.backend === 'ssh' && !canCreateSSHWindow)) {
      setCreateWindowError(t('overview.createUnavailable'))
      return
    }
    const client = clientRef.current
    if (!client) {
      setCreateWindowError(t('overview.notConnected'))
      return
    }
    const loadId = loadGenerationRef.current
    const operationId = Symbol('create-window')
    createWindowOperationRef.current = operationId
    setCreatingWindow(true)
    setCreateWindowError(null)
    try {
      const result = await createRemoteWindow(client, {
        ...params,
        initialCols: DEFAULT_REMOTE_START_VIEWPORT.cols,
        initialRows: DEFAULT_REMOTE_START_VIEWPORT.rows
      })
      if (loadGenerationRef.current !== loadId || clientRef.current !== client) {
        return
      }
      setWindows((current) => [result.window, ...current.filter((window) => window.windowId !== result.window.windowId)])
      setTerminals((current) => [
        {
          windowId: result.pane.windowId,
          paneId: result.pane.paneId,
          sessionId: result.pane.sessionId ?? `${result.pane.windowId}:${result.pane.paneId}`,
          pid: result.pane.pid ?? 0,
          backend: result.pane.backend ?? 'local',
          status: result.pane.running ? 'alive' : 'exited',
          workingDirectory: result.pane.cwd ?? '',
          command: result.pane.command ?? undefined
        },
        ...current.filter(
          (terminal) =>
            terminal.windowId !== result.pane.windowId || terminal.paneId !== result.pane.paneId
        )
      ])
      setOverviewMode('windows')
      setShowCreateWindowDrawer(false)
      setCreateWindowError(null)
      router.push(
        `/h/${hostId}/t/${encodeURIComponent(result.pane.windowId)}/${encodeURIComponent(result.pane.paneId)}`
      )
    } catch (err) {
      if (loadGenerationRef.current === loadId && clientRef.current === client) {
        setCreateWindowError(t('overview.createFailed', { message: overviewErrorMessage(err, t) }))
      }
    } finally {
      if (createWindowOperationRef.current === operationId) {
        createWindowOperationRef.current = null
        if (loadGenerationRef.current === loadId && clientRef.current === client) {
          setCreatingWindow(false)
        }
      }
    }
  }, [canCreateSSHWindow, canCreateWindow, hostId, router, t])

  const toggleGroupWindowSelection = useCallback((windowId: string) => {
    setSelectedGroupWindowIds((current) =>
      current.includes(windowId)
        ? current.filter((id) => id !== windowId)
        : [...current, windowId]
    )
  }, [])

  const handleCreateGroup = useCallback(async () => {
    const client = clientRef.current
    if (!client) {
      setError(t('overview.notConnected'))
      return
    }
    if (selectedGroupWindowIds.length < 2) {
      setError(t('overview.selectGroupWindows'))
      return
    }
    const loadId = loadGenerationRef.current
    setCreatingGroup(true)
    setError(null)
    try {
      const result = await createRemoteGroup(client, selectedGroupWindowIds, t('overview.defaultGroupName'))
      if (loadGenerationRef.current !== loadId || clientRef.current !== client) {
        return
      }
      setGroups((current) => [
        result.group,
        ...current.filter((group) => group.groupId !== result.group.groupId)
      ])
      setSelectedGroupWindowIds([])
      setGroupSelectionMode(false)
    } catch (err) {
      if (loadGenerationRef.current === loadId && clientRef.current === client) {
        setError(overviewErrorMessage(err, t))
      }
    } finally {
      if (loadGenerationRef.current === loadId && clientRef.current === client) {
        setCreatingGroup(false)
      }
    }
  }, [selectedGroupWindowIds, t])

  const handleGroupAction = useCallback(async () => {
    if (!groupSelectionMode) {
      if (!canUseGroupSelection) {
        setError(t('overview.selectGroupWindows'))
        return
      }
      setGroupSelectionMode(true)
      setSelectedGroupWindowIds([])
      setError(null)
      return
    }
    await handleCreateGroup()
  }, [canUseGroupSelection, groupSelectionMode, handleCreateGroup, t])

  const cancelGroupSelection = useCallback(() => {
    setGroupSelectionMode(false)
    setSelectedGroupWindowIds([])
    setError(null)
  }, [])

  const handleDeleteWindow = useCallback(
    (windowId: string) => {
      const deleteWindow = async () => {
        const client = clientRef.current
        if (!client) {
          setError(t('overview.notConnected'))
          return
        }
        const loadId = loadGenerationRef.current
        setDeletingWindowId(windowId)
        setError(null)
        try {
          const result = await deleteRemoteWindow(client, windowId)
          if (loadGenerationRef.current !== loadId || clientRef.current !== client) {
            return
          }
          setWindows((current) => current.filter((window) => window.windowId !== result.windowId))
          setGroups(result.groups)
          setSelectedGroupWindowIds((current) => current.filter((id) => id !== result.windowId))
        } catch (err) {
          if (loadGenerationRef.current === loadId && clientRef.current === client) {
            setError(overviewErrorMessage(err, t))
          }
        } finally {
          if (loadGenerationRef.current === loadId && clientRef.current === client) {
            setDeletingWindowId(null)
          }
        }
      }

      Alert.alert(t('overview.deleteWindowTitle'), t('overview.deleteWindowMessage'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('overview.deleteWindow'),
          style: 'destructive',
          onPress: () => void deleteWindow()
        }
      ])
    },
    [t]
  )

  const handleDeleteGroup = useCallback(
    (groupId: string) => {
      const deleteGroup = async () => {
        const client = clientRef.current
        if (!client) {
          setError(t('overview.notConnected'))
          return
        }
        const loadId = loadGenerationRef.current
        setDeletingGroupId(groupId)
        setError(null)
        try {
          const result = await deleteRemoteGroup(client, groupId)
          if (loadGenerationRef.current !== loadId || clientRef.current !== client) {
            return
          }
          setGroups((current) => current.filter((group) => group.groupId !== result.groupId))
        } catch (err) {
          if (loadGenerationRef.current === loadId && clientRef.current === client) {
            setError(overviewErrorMessage(err, t))
          }
        } finally {
          if (loadGenerationRef.current === loadId && clientRef.current === client) {
            setDeletingGroupId(null)
          }
        }
      }

      Alert.alert(t('overview.deleteGroupTitle'), t('overview.deleteGroupMessage'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('overview.deleteGroup'),
          style: 'destructive',
          onPress: () => void deleteGroup()
        }
      ])
    },
    [t]
  )

  const syncOverviewState = useCallback(async () => {
    const client = clientRef.current
    if (!client || refreshing || syncOverviewStateInFlightRef.current) {
      return
    }
    syncOverviewStateInFlightRef.current = true
    try {
      const overview = await loadHostOverviewData(client)
      if (clientRef.current !== client) {
        return
      }
      setOverviewMode(overview.mode)
      setCanCreateWindow(overview.canCreateWindow)
      setCanCreateSSHWindow(overview.canCreateSSHWindow)
      setWindows(overview.windows)
      setGroups(overview.groups)
      setSelectedGroupWindowIds((current) =>
        filterSelectableWindowIds(current, overview.windows, overview.groups)
      )
      setTerminals(
        overview.terminals.filter((terminal) => terminal.windowId && terminal.paneId)
      )
      setError(null)
    } catch (err) {
      if (clientRef.current !== client) {
        return
      }
      setError(overviewErrorMessage(err, t))
    } finally {
      if (clientRef.current === client) {
        syncOverviewStateInFlightRef.current = false
      }
    }
  }, [refreshing, t])

  const handleStopPane = useCallback(
    async (pane: RemotePaneSummary) => {
      const client = clientRef.current
      if (!client) {
        setError(t('overview.notConnected'))
        return
      }
      const paneKey = `${pane.windowId}:${pane.paneId}`
      const loadId = loadGenerationRef.current
      setStoppingPaneKey(paneKey)
      setError(null)
      try {
        const result = await stopRemotePane(client, pane.windowId, pane.paneId)
        if (loadGenerationRef.current !== loadId || clientRef.current !== client) {
          return
        }
        setWindows((current) =>
          current.map((window) =>
            window.windowId === result.window.windowId ? result.window : window
          )
        )
        setGroups((current) => replaceWindowInGroups(current, result.window))
        setTerminals((current) =>
          current.map((terminal) =>
            terminal.windowId === result.pane.windowId && terminal.paneId === result.pane.paneId
              ? {
                  ...terminal,
                  pid: 0,
                  sessionId: `${result.pane.windowId}:${result.pane.paneId}`,
                  status: 'exited'
                }
              : terminal
          )
        )
      } catch (err) {
        if (loadGenerationRef.current === loadId && clientRef.current === client) {
          setError(overviewErrorMessage(err, t))
        }
      } finally {
        if (loadGenerationRef.current === loadId && clientRef.current === client) {
          setStoppingPaneKey(null)
        }
      }
    },
    [t]
  )

  const switchToHost = useCallback(
    async (host: HostProfile) => {
      if (host.id === hostId) {
        setHostSwitcherOpen(false)
        setHostSwitchError(null)
        return
      }
      if (switchingHostId) {
        return
      }

      let client: RpcClient | null = null
      setSwitchingHostId(host.id)
      setHostSwitchError(null)
      try {
        client = connectToHost(host)
        await withSwitchTimeout(loadHostOverviewData(client))
        client.close()
        client = null
        setHostSwitcherOpen(false)
        router.replace(`/h/${host.id}`)
      } catch (err) {
        client?.close()
        setHostSwitchError(
          t('overview.switchHostFailed', {
            name: host.name,
            message: err instanceof Error ? err.message : String(err)
          })
        )
      } finally {
        setSwitchingHostId(null)
      }
    },
    [hostId, router, switchingHostId, t]
  )

  useFocusEffect(
    useCallback(() => {
      const timer = setInterval(() => {
        void syncOverviewState()
      }, OVERVIEW_STATUS_SYNC_MS)
      return () => clearInterval(timer)
    }, [syncOverviewState])
  )

  useFocusEffect(
    useCallback(() => {
      const subscription = AppState.addEventListener('change', (state) => {
        if (state !== 'active') {
          return
        }
        clientRef.current?.notifyForeground()
        void syncOverviewState()
      })
      return () => subscription.remove()
    }, [syncOverviewState])
  )

  return (
    <>
      <Stack.Screen
        options={{
          headerTitle: t('overview.windowsTitle')
        }}
      />
      <View style={styles.container}>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <View style={styles.actionToolbar}>
        <View style={styles.toolbarLeadingActions}>
          {pairedHosts.length > 1 ? (
            <Pressable
              style={[
                styles.navIconButton,
                hostSwitcherOpen && styles.iconButtonActive
              ]}
              onPress={() => {
                setShowFilterModal(false)
                if (hostSwitcherOpen) {
                  setHostSwitchError(null)
                }
                setHostSwitcherOpen(!hostSwitcherOpen)
              }}
              accessibilityRole="button"
              accessibilityLabel={t('overview.switchHost')}
              accessibilityState={{ expanded: hostSwitcherOpen }}
            >
              <Server size={18} color={colors.textPrimary} />
            </Pressable>
          ) : null}
          <Pressable
            style={[
              styles.navIconButton,
              filterActiveCount > 0 && styles.iconButtonActive
            ]}
            onPress={() => {
              setHostSwitcherOpen(false)
              setHostSwitchError(null)
              setShowFilterModal(true)
            }}
            accessibilityRole="button"
            accessibilityLabel={`${t('overview.filter')}: ${filterLabel}`}
          >
            <Filter size={18} color={colors.textPrimary} />
          </Pressable>
        </View>
        <View style={styles.toolbarActions}>
          {groupSelectionMode ? (
            <>
              <Pressable
                style={[
                  styles.navIconButton,
                  (selectedGroupWindowIds.length < 2 || creatingGroup) &&
                    styles.iconButtonDisabled
                ]}
                disabled={selectedGroupWindowIds.length < 2 || creatingGroup}
                onPress={() => void handleGroupAction()}
                accessibilityLabel={t('overview.confirmCreateGroup')}
              >
                {creatingGroup ? (
                  <ActivityIndicator color={colors.textPrimary} size="small" />
                ) : (
                  <Check size={18} color={colors.textPrimary} />
                )}
              </Pressable>
              <Pressable
                style={styles.navIconButton}
                onPress={cancelGroupSelection}
                accessibilityLabel={t('overview.cancelGroupSelection')}
              >
                <X size={18} color={colors.textPrimary} />
              </Pressable>
            </>
          ) : (
            <>
              <Pressable
                style={[
                  styles.navIconButton,
                  (!canCreateWindow || creatingWindow) && styles.iconButtonDisabled
                ]}
                disabled={!canCreateWindow || creatingWindow}
                onPress={openCreateWindowDrawer}
                accessibilityLabel={t('overview.newTerminal')}
              >
                {creatingWindow ? (
                  <ActivityIndicator color={colors.textPrimary} size="small" />
                ) : (
                  <Plus size={18} color={colors.textPrimary} />
                )}
              </Pressable>
              {overviewMode === 'windows' ? (
                <Pressable
                  style={[
                    styles.navIconButton,
                    (!canUseGroupSelection || creatingGroup) && styles.iconButtonDisabled
                  ]}
                  disabled={!canUseGroupSelection || creatingGroup}
                  onPress={() => void handleGroupAction()}
                  accessibilityLabel={t('overview.groupSelection')}
                >
                  {creatingGroup ? (
                    <ActivityIndicator color={colors.textPrimary} size="small" />
                  ) : (
                    <Layers size={18} color={colors.textPrimary} />
                  )}
                </Pressable>
              ) : null}
              <Pressable
                style={styles.navIconButton}
                onPress={() => void loadAndConnect()}
                accessibilityLabel={t('common.retry')}
              >
                <RotateCw size={18} color={colors.textPrimary} />
              </Pressable>
              <Pressable
                style={[
                  styles.navIconButton,
                  (searchVisible || hasSearchQuery) && styles.iconButtonActive
                ]}
                onPress={() => setSearchVisible((visible) => !visible)}
                accessibilityLabel={t('overview.searchPlaceholder')}
              >
                <Search size={18} color={colors.textPrimary} />
              </Pressable>
              <Pressable
                style={styles.navIconButton}
                onPress={() => router.push(`/h/${hostId}/settings`)}
                accessibilityLabel={t('nav.hostSettings')}
              >
                <Settings size={18} color={colors.textPrimary} />
              </Pressable>
            </>
          )}
        </View>
      </View>
      {overviewMode === 'windows' && groupSelectionMode ? (
        <Text style={styles.selectionHint}>
          {selectedGroupWindowIds.length >= 2
            ? t('overview.groupSelectionReady', { count: selectedGroupWindowIds.length })
            : t('overview.groupSelectionHint')}
        </Text>
      ) : null}
      {searchVisible || hasSearchQuery ? (
        <View style={styles.searchBox}>
          <Search size={16} color={colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder={t('overview.searchPlaceholder')}
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            clearButtonMode="while-editing"
            selectionColor={colors.accentBlue}
          />
          <Pressable
            style={styles.searchCloseButton}
            onPress={() => {
              setSearchQuery('')
              setSearchVisible(false)
            }}
            accessibilityLabel={t('common.cancel')}
          >
            <X size={16} color={colors.textSecondary} />
          </Pressable>
        </View>
      ) : null}
      <FlatList
        data={overviewItems}
        keyExtractor={(item) =>
          item.type === 'window'
            ? `window:${item.window.windowId}`
            : item.type === 'group'
              ? `group:${item.group.groupId}`
              : `terminal:${item.terminal.windowId}:${item.terminal.paneId}:${item.terminal.sessionId}`
        }
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void loadAndConnect()} />
        }
        contentContainerStyle={
          overviewItems.length === 0 ? styles.emptyList : styles.list
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            {refreshing ? (
              <ActivityIndicator color={colors.textSecondary} />
            ) : (
              <TerminalSquare size={28} color={colors.textSecondary} />
            )}
            <Text style={styles.emptyTitle}>
              {refreshing
                ? t('overview.loadingTerminals')
                : hasSearchQuery
                  ? t('overview.emptySearchTitle')
                  : t('overview.emptyTitle')}
            </Text>
            <Text style={styles.emptyText}>
              {hasSearchQuery
                ? t('overview.emptySearchText')
                : overviewMode === 'windows'
                  ? t('overview.emptyWindowsText')
                  : t('overview.emptyTerminalsText')}
            </Text>
          </View>
        }
        renderItem={({ item }) =>
          item.type === 'group'
            ? renderGroupItem(
                item.group,
                deletingGroupId,
                openGroup,
                openWindow,
                handleDeleteGroup,
                t
              )
            : item.type === 'window'
            ? renderWindowItem(
                item.window,
                startingPaneKey,
                stoppingPaneKey,
                deletingWindowId,
                groupSelectionMode,
                selectedGroupWindowIds,
                openWindow,
                openPane,
                handleStopPane,
                toggleGroupWindowSelection,
                handleDeleteWindow,
                t
              )
            : renderTerminalItem(item.terminal, openTerminal, t)
        }
      />
      <CreateTerminalDrawer
        key={createWindowFormKey}
        visible={showCreateWindowDrawer}
        canCreateSSH={canCreateSSHWindow}
        sshProfiles={sshProfiles}
        loadingSSHProfiles={loadingSSHProfiles}
        sshProfilesError={sshProfilesError}
        submitting={creatingWindow}
        submitError={createWindowError}
        onRetrySSHProfiles={() => void loadSSHProfilesForCreate()}
        onSubmit={(params) => void handleCreateWindow(params)}
        onClose={closeCreateWindowDrawer}
      />
      <BottomDrawer visible={showFilterModal} onClose={() => setShowFilterModal(false)}>
        <View style={styles.filterModalHeader}>
          <Text style={styles.filterModalTitle}>{t('overview.filterTitle')}</Text>
          {filterActiveCount > 0 ? (
            <Pressable
              onPress={() => {
                setTerminalListFilter('recent')
                setSelectedGroupWindowIds([])
              }}
              accessibilityRole="button"
              accessibilityLabel={t('overview.filterReset')}
            >
              <Text style={styles.clearFiltersText}>{t('overview.filterReset')}</Text>
            </Pressable>
          ) : null}
        </View>
        <Text style={styles.filterSectionLabel}>{t('overview.filterScope')}</Text>
        <View style={styles.filterGroup}>
          {TERMINAL_LIST_FILTERS.map((filter, index) => {
            const selected = filter === terminalListFilter
            return (
              <View key={filter}>
                {index > 0 ? <View style={styles.filterSeparator} /> : null}
                <Pressable
                  style={styles.filterRow}
                  onPress={() => {
                    if (filter !== terminalListFilter) {
                      setTerminalListFilter(filter)
                      setSelectedGroupWindowIds([])
                    }
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                >
                  <Text style={styles.filterRowText}>
                    {terminalListFilterLabel(filter, t)}
                  </Text>
                  {selected ? <Check size={14} color={colors.textPrimary} /> : null}
                </Pressable>
              </View>
            )
          })}
        </View>
      </BottomDrawer>
      {pairedHosts.length > 1 && hostSwitcherOpen ? (
        <View style={styles.hostSwitcherDock} pointerEvents="box-none">
          <View style={[styles.hostSwitcherPanel, { width: hostSwitcherPanelWidth }]}>
            <View style={styles.hostSwitcherHeader}>
              <Text style={styles.hostSwitcherTitle}>{t('overview.switchHost')}</Text>
              <Pressable
                style={styles.hostSwitcherCloseButton}
                onPress={() => {
                  setHostSwitcherOpen(false)
                  setHostSwitchError(null)
                }}
                accessibilityLabel={t('common.cancel')}
              >
                <X size={16} color={colors.textPrimary} />
              </Pressable>
            </View>
            <ScrollView
              style={styles.hostSwitcherList}
              contentContainerStyle={styles.hostSwitcherListContent}
              showsVerticalScrollIndicator={false}
            >
              {pairedHosts.map((host) => {
                const current = host.id === hostId
                const switching = switchingHostId === host.id
                return (
                  <Pressable
                    key={host.id}
                    disabled={current || switchingHostId !== null}
                    style={({ pressed }) => [
                      styles.hostSwitcherRow,
                      current && styles.hostSwitcherRowCurrent,
                      pressed && styles.pressed,
                      switchingHostId !== null && !switching && !current && styles.disabledRow
                    ]}
                    onPress={() => void switchToHost(host)}
                  >
                    <View style={styles.hostSwitcherIcon}>
                      {switching ? (
                        <ActivityIndicator color={colors.textSecondary} />
                      ) : (
                        <Server size={16} color={colors.textPrimary} />
                      )}
                    </View>
                    <View style={styles.hostSwitcherMain}>
                      <Text style={styles.hostSwitcherName} numberOfLines={1}>
                        {host.name}
                      </Text>
                      <Text style={styles.hostSwitcherEndpoint} numberOfLines={1}>
                        {current
                          ? t('overview.currentHost')
                          : switching
                            ? t('overview.switchingHost')
                            : switcherHostEndpointLabel(host, t)}
                      </Text>
                    </View>
                  </Pressable>
                )
              })}
            </ScrollView>
            {hostSwitchError ? (
              <Text style={styles.hostSwitcherError}>{hostSwitchError}</Text>
            ) : null}
          </View>
        </View>
      ) : null}
      </View>
    </>
  )
}

function renderTerminalItem(
  item: RemoteTerminalSummary,
  onOpen: (terminal: RemoteTerminalSummary) => void,
  t: MobileTranslate
) {
  return (
    <TerminalListRow
      terminal={item}
      badge={item.status === 'alive' ? t('overview.running') : t('overview.stopped')}
      onPress={() => onOpen(item)}
      t={t}
    />
  )
}

function PaneCardRow({
  pane,
  active,
  disabled,
  starting,
  stopping,
  selectionMode = false,
  onPress,
  onStop,
  t
}: {
  pane: RemotePaneSummary
  active: boolean
  disabled: boolean
  starting: boolean
  stopping: boolean
  selectionMode?: boolean
  onPress: () => void
  onStop: () => void
  t: MobileTranslate
}) {
  const content = (
    <>
      <View style={styles.paneMain}>
        <View style={styles.terminalTitleRow}>
          <Text style={styles.terminalTitle} numberOfLines={1}>
            {paneTitle(pane, t)}
          </Text>
          <Text style={styles.badge}>
            {starting ? t('common.starting') : statusLabel(pane.status, pane.running, t)}
          </Text>
        </View>
        <Text style={styles.terminalMeta} numberOfLines={1}>
          {paneMeta(pane, t)}
        </Text>
      </View>
      <View
        style={[
          styles.paneInlineStatusDot,
          { backgroundColor: statusColor(pane.status, pane.running) }
        ]}
      />
      {!selectionMode && pane.running ? (
        <Pressable
          disabled={stopping}
          style={[styles.stopIcon, stopping && styles.iconButtonDisabled]}
          onPress={(event) => {
            event.stopPropagation()
            onStop()
          }}
          accessibilityLabel={t('overview.stopTerminal')}
        >
          <Square size={13} color={colors.statusRed} fill={colors.statusRed} />
        </Pressable>
      ) : !selectionMode && isStartableLocalPane(pane) ? (
        <View style={styles.startIcon}>
          <Play size={13} color={colors.accentBlue} fill={colors.accentBlue} />
        </View>
      ) : null}
    </>
  )

  if (selectionMode) {
    return (
      <View
        style={[
          styles.paneRow,
          active && styles.activePaneRow,
          disabled && styles.disabledRow
        ]}
      >
        {content}
      </View>
    )
  }

  return (
    <Pressable
      disabled={disabled}
      style={({ pressed }) => [
        styles.paneRow,
        active && styles.activePaneRow,
        disabled && styles.disabledRow,
        pressed && styles.pressed
      ]}
      onPress={onPress}
    >
      {content}
    </Pressable>
  )
}

function renderWindowItem(
  item: RemoteWindowSummary,
  startingPaneKey: string | null,
  stoppingPaneKey: string | null,
  deletingWindowId: string | null,
  groupSelectionMode: boolean,
  selectedGroupWindowIds: string[],
  onOpenWindow: (window: RemoteWindowSummary) => void | Promise<void>,
  onOpenPane: (pane: RemotePaneSummary) => void | Promise<void>,
  onStopPane: (pane: RemotePaneSummary) => void | Promise<void>,
  onToggleGroupSelection: (windowId: string) => void,
  onDeleteWindow: (windowId: string) => void | Promise<void>,
  t: MobileTranslate
) {
  const activePane = getActiveTerminalPane(item)
  const selectedForGroup = selectedGroupWindowIds.includes(item.windowId)
  const deleting = deletingWindowId === item.windowId
  return (
    <Pressable
      style={({ pressed }) => [
        styles.windowCard,
        { borderTopColor: windowTopBorderColor(item) },
        selectedForGroup && styles.selectedWindowCard,
        pressed && styles.pressed
      ]}
      onPress={() => {
        if (groupSelectionMode) {
          onToggleGroupSelection(item.windowId)
          return
        }
        void onOpenWindow(item)
      }}
      disabled={(groupSelectionMode ? false : !activePane) || deleting}
    >
      <View style={styles.windowHeader}>
        <View style={styles.windowTitleGroup}>
          <View style={styles.windowIcon}>
            {item.terminalPaneCount > 1 ? (
              <Layers size={18} color={colors.textPrimary} />
            ) : (
              <TerminalSquare size={18} color={colors.textPrimary} />
            )}
          </View>
          <View style={styles.windowTitleText}>
            <Text style={styles.windowTitle} numberOfLines={1}>
              {item.name}
            </Text>
            <Text style={styles.windowMeta}>
              {windowPaneCountLabel(item.terminalPaneCount, t)}
            </Text>
          </View>
        </View>
        <View style={styles.windowActions}>
          {groupSelectionMode ? (
            <Pressable
              style={[styles.selectButton, selectedForGroup && styles.selectButtonActive]}
              onPress={(event) => {
                event.stopPropagation()
                onToggleGroupSelection(item.windowId)
              }}
              accessibilityLabel={t('overview.selectForGroup')}
            >
              <Text style={[styles.selectButtonText, selectedForGroup && styles.selectButtonTextActive]}>
                {selectedForGroup ? '✓' : ''}
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            style={[styles.deleteButton, deleting && styles.iconButtonDisabled]}
            disabled={deleting}
            onPress={(event) => {
              event.stopPropagation()
              void onDeleteWindow(item.windowId)
            }}
            accessibilityLabel={t('overview.deleteWindow')}
          >
            <Text style={styles.deleteButtonText}>×</Text>
          </Pressable>
        </View>
      </View>
      {item.panes.map((pane) => {
        const paneKey = `${pane.windowId}:${pane.paneId}`
        const starting = startingPaneKey === paneKey
        const stopping = stoppingPaneKey === paneKey
        const canOpen = pane.running || isStartableLocalPane(pane)
        return (
          <PaneCardRow
            key={`${pane.windowId}:${pane.paneId}`}
            pane={pane}
            active={pane.paneId === item.activePaneId}
            disabled={groupSelectionMode ? false : !canOpen || starting}
            selectionMode={groupSelectionMode}
            starting={starting}
            stopping={stopping}
            onPress={() => void onOpenPane(pane)}
            onStop={() => void onStopPane(pane)}
            t={t}
          />
        )
      })}
    </Pressable>
  )
}

function renderGroupItem(
  item: RemoteWindowGroupSummary,
  deletingGroupId: string | null,
  onOpenGroup: (group: RemoteWindowGroupSummary) => void | Promise<void>,
  onOpenWindow: (window: RemoteWindowSummary) => void | Promise<void>,
  onDeleteGroup: (groupId: string) => void | Promise<void>,
  t: MobileTranslate
) {
  const deleting = deletingGroupId === item.groupId
  return (
    <Pressable
      style={({ pressed }) => [styles.groupCard, pressed && styles.pressed]}
      onPress={() => void onOpenGroup(item)}
      disabled={deleting}
    >
      <View style={styles.groupHeader}>
        <View style={styles.windowTitleGroup}>
          <View style={styles.windowIcon}>
            <Layers size={18} color={colors.textPrimary} />
          </View>
          <View style={styles.windowTitleText}>
            <Text style={styles.windowTitle} numberOfLines={1}>
              {item.name}
            </Text>
            <Text style={styles.windowMeta}>
              {t('overview.groupWindowCount', { count: item.windowCount })}
            </Text>
          </View>
        </View>
        <Pressable
          style={[styles.deleteButton, deleting && styles.iconButtonDisabled]}
          disabled={deleting}
          onPress={(event) => {
            event.stopPropagation()
            void onDeleteGroup(item.groupId)
          }}
          accessibilityLabel={t('overview.deleteGroup')}
        >
          {deleting ? (
            <ActivityIndicator color={colors.statusRed} />
          ) : (
            <Text style={styles.deleteButtonText}>×</Text>
          )}
        </Pressable>
      </View>
      <View style={styles.groupWindows}>
        {item.windows.map((window) => {
          const pane = getActiveTerminalPane(window)
          return (
            <Pressable
              key={window.windowId}
              disabled={!pane}
              style={({ pressed }) => [styles.groupWindowRow, pressed && styles.pressed]}
              onPress={(event) => {
                event.stopPropagation()
                void onOpenWindow(window)
              }}
            >
              <TerminalSquare size={15} color={colors.textPrimary} />
              <View style={styles.groupWindowMain}>
                <Text style={styles.groupWindowTitle} numberOfLines={1}>
                  {window.name}
                </Text>
                <Text style={styles.groupWindowMeta} numberOfLines={1}>
                  {windowPaneCountLabel(window.terminalPaneCount, t)}
                </Text>
              </View>
            </Pressable>
          )
        })}
      </View>
    </Pressable>
  )
}

function TerminalListRow({
  terminal,
  disabled = false,
  badge,
  onPress,
  t
}: {
  terminal: RemoteTerminalSummary
  disabled?: boolean
  badge?: string
  onPress: () => void
  t: MobileTranslate
}) {
  return (
    <Pressable
      disabled={disabled}
      style={({ pressed }) => [
        styles.terminalRow,
        disabled && styles.disabledRow,
        pressed && styles.pressed
      ]}
      onPress={onPress}
    >
      <View style={styles.terminalIcon}>
        <TerminalSquare size={18} color={colors.textPrimary} />
      </View>
      <View style={styles.terminalMain}>
        <View style={styles.terminalTitleRow}>
          <Text style={styles.terminalTitle} numberOfLines={1}>
            {terminal.command || `${terminal.windowId}:${terminal.paneId}`}
          </Text>
          {badge ? <Text style={styles.badge}>{badge}</Text> : null}
        </View>
        <Text style={styles.terminalMeta} numberOfLines={1}>
          {backendLabel(terminal.backend, t)} - {t('overview.pid')} {terminal.pid || '-'} -{' '}
          {terminal.workingDirectory || t('overview.unknownCwd')}
        </Text>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgBase,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
    paddingBottom: spacing.lg,
    gap: spacing.sm
  },
  hostSwitcherDock: {
    position: 'absolute',
    right: 0,
    top: 104,
    zIndex: 20,
    elevation: 8
  },
  hostSwitcherPanel: {
    width: 286,
    maxWidth: 286,
    borderTopLeftRadius: radii.card,
    borderBottomLeftRadius: radii.card,
    borderWidth: 1,
    borderRightWidth: 0,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.bgPanel,
    padding: spacing.sm,
    gap: spacing.sm
  },
  hostSwitcherHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm
  },
  hostSwitcherTitle: {
    color: colors.textPrimary,
    fontSize: typography.bodySize,
    fontWeight: '700'
  },
  hostSwitcherCloseButton: {
    width: 30,
    height: 30,
    borderRadius: radii.button,
    backgroundColor: colors.bgRaised,
    alignItems: 'center',
    justifyContent: 'center'
  },
  hostSwitcherList: {
    maxHeight: 320
  },
  hostSwitcherListContent: {
    gap: spacing.xs
  },
  hostSwitcherRow: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radii.row,
    backgroundColor: colors.bgRaised,
    padding: spacing.sm
  },
  hostSwitcherRowCurrent: {
    borderColor: colors.accentBlue
  },
  hostSwitcherIcon: {
    width: 32,
    height: 32,
    borderRadius: radii.button,
    backgroundColor: colors.bgPanel,
    alignItems: 'center',
    justifyContent: 'center'
  },
  hostSwitcherMain: {
    flex: 1,
    minWidth: 0
  },
  hostSwitcherName: {
    color: colors.textPrimary,
    fontSize: typography.bodySize,
    fontWeight: '700'
  },
  hostSwitcherEndpoint: {
    color: colors.textSecondary,
    fontSize: typography.metaSize,
    marginTop: 2
  },
  hostSwitcherError: {
    color: colors.statusRed,
    fontSize: typography.metaSize,
    lineHeight: 18
  },
  actionToolbar: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs
  },
  toolbarLeadingActions: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs
  },
  toolbarActions: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.xs
  },
  filterModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.xs,
    marginBottom: spacing.md
  },
  filterModalTitle: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '700'
  },
  clearFiltersText: {
    color: colors.textSecondary,
    fontSize: typography.metaSize,
    fontWeight: '700'
  },
  filterSectionLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.xs
  },
  filterGroup: {
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radii.row,
    backgroundColor: colors.bgPanel,
    marginBottom: spacing.md
  },
  filterRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  filterRowText: {
    flex: 1,
    minWidth: 0,
    color: colors.textPrimary,
    fontSize: typography.bodySize,
    fontWeight: '600'
  },
  filterSeparator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.borderSubtle,
    marginHorizontal: spacing.md
  },
  navIconButton: {
    width: 32,
    height: 32,
    borderRadius: radii.button,
    backgroundColor: colors.bgRaised,
    alignItems: 'center',
    justifyContent: 'center'
  },
  iconButtonActive: {
    borderWidth: 1,
    borderColor: colors.accentBlue
  },
  iconButtonDisabled: {
    opacity: 0.52
  },
  errorText: {
    color: colors.statusRed,
    fontSize: typography.bodySize,
    lineHeight: 20
  },
  selectionHint: {
    color: colors.textMuted,
    fontSize: typography.metaSize,
    marginTop: -spacing.sm
  },
  searchBox: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.bgPanel,
    borderRadius: radii.input,
    paddingHorizontal: spacing.md
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    color: colors.textPrimary,
    fontSize: typography.bodySize,
    paddingVertical: spacing.sm
  },
  searchCloseButton: {
    width: 28,
    height: 28,
    borderRadius: radii.button,
    alignItems: 'center',
    justifyContent: 'center'
  },
  list: {
    gap: spacing.md,
    paddingTop: spacing.xs,
    paddingBottom: spacing.md
  },
  windowCard: {
    gap: spacing.md,
    borderWidth: 1,
    borderTopWidth: 3,
    borderColor: colors.borderStrong,
    backgroundColor: colors.bgCard,
    borderRadius: radii.row,
    padding: spacing.md,
    shadowColor: '#000000',
    shadowOpacity: 0.22,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2
  },
  selectedWindowCard: {
    borderColor: colors.accentBlue
  },
  groupCard: {
    gap: spacing.md,
    borderWidth: 1,
    borderLeftWidth: 4,
    borderColor: colors.borderStrong,
    borderLeftColor: colors.statusPurple,
    backgroundColor: colors.bgCard,
    borderRadius: radii.row,
    padding: spacing.md,
    shadowColor: '#000000',
    shadowOpacity: 0.24,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md
  },
  windowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md
  },
  windowTitleGroup: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm
  },
  windowIcon: {
    width: 38,
    height: 38,
    borderRadius: radii.button,
    backgroundColor: colors.bgRaised,
    alignItems: 'center',
    justifyContent: 'center'
  },
  windowTitleText: {
    flex: 1,
    minWidth: 0
  },
  windowTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '700'
  },
  windowMeta: {
    color: colors.textMuted,
    fontSize: typography.metaSize,
    marginTop: 2
  },
  windowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs
  },
  selectButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgRaised,
    borderWidth: 1,
    borderColor: colors.borderSubtle
  },
  selectButtonActive: {
    borderColor: colors.accentBlue,
    backgroundColor: 'rgba(59,130,246,0.16)'
  },
  selectButtonText: {
    color: colors.textSecondary,
    fontSize: 15,
    fontWeight: '700'
  },
  selectButtonTextActive: {
    color: colors.accentBlue
  },
  deleteButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgRaised,
    borderWidth: 1,
    borderColor: colors.borderSubtle
  },
  deleteButtonText: {
    color: colors.statusRed,
    fontSize: 18,
    lineHeight: 20,
    fontWeight: '700'
  },
  groupWindows: {
    gap: spacing.sm
  },
  groupWindowRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.button,
    backgroundColor: colors.bgInset,
    paddingHorizontal: spacing.sm
  },
  groupWindowMain: {
    flex: 1,
    minWidth: 0
  },
  groupWindowTitle: {
    color: colors.textPrimary,
    fontSize: typography.bodySize,
    fontWeight: '700'
  },
  groupWindowMeta: {
    color: colors.textMuted,
    fontSize: typography.metaSize,
    marginTop: 1
  },
  emptyList: {
    flexGrow: 1,
    justifyContent: 'center'
  },
  empty: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg
  },
  emptyTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '700'
  },
  emptyText: {
    color: colors.textSecondary,
    textAlign: 'center'
  },
  terminalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.bgCard,
    borderRadius: radii.row,
    padding: spacing.md,
    shadowColor: '#000000',
    shadowOpacity: 0.2,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2
  },
  terminalIcon: {
    width: 38,
    height: 38,
    borderRadius: radii.button,
    backgroundColor: colors.bgRaised,
    alignItems: 'center',
    justifyContent: 'center'
  },
  terminalMain: {
    flex: 1,
    minWidth: 0
  },
  terminalTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm
  },
  terminalTitle: {
    flex: 1,
    minWidth: 0,
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '700'
  },
  badge: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase'
  },
  terminalMeta: {
    color: colors.textSecondary,
    fontSize: typography.metaSize,
    marginTop: 2
  },
  paneRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.bgInset,
    borderRadius: radii.button,
    paddingVertical: spacing.sm,
    paddingLeft: spacing.sm,
    paddingRight: spacing.sm,
    overflow: 'hidden'
  },
  activePaneRow: {
    borderColor: colors.accentBlue
  },
  paneInlineStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4
  },
  paneMain: {
    flex: 1,
    minWidth: 0
  },
  startIcon: {
    width: 26,
    height: 26,
    borderRadius: radii.button,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(59,130,246,0.12)'
  },
  stopIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgPanel
  },
  pressed: {
    opacity: 0.74
  },
  disabledRow: {
    opacity: 0.52
  }
})
