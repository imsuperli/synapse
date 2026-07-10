import { useCallback, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { Layers, Play, Plus, RotateCw, Search, Settings, Square, TerminalSquare } from 'lucide-react-native'
import {
  connectToHost,
  createRemoteWindow,
  createRemoteGroup,
  deleteRemoteGroup,
  deleteRemoteWindow,
  loadHostById,
  startRemoteWindow,
  stopRemotePane,
  type RemoteWindowGroupSummary,
  type RemotePaneSummary,
  type RemoteTerminalSummary,
  type RemoteWindowSummary
} from '../../../src/synapse/remote'
import { loadHostOverviewData } from '../../../src/synapse/host-overview'
import {
  filterTerminals,
  filterWindows,
  normalizeTerminalSearchQuery
} from '../../../src/synapse/terminal-search'
import type { RpcClient } from '../../../src/transport/rpc-client'
import type { ConnectionLogEntry, ConnectionState, HostProfile } from '../../../src/transport/types'
import { colors, radii, spacing, typography } from '../../../src/theme/mobile-theme'
import { useMobileI18n, type MobileTranslate } from '../../../src/i18n'

function getParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}

const OVERVIEW_STATUS_SYNC_MS = 2500
const DEFAULT_REMOTE_START_VIEWPORT = { cols: 80, rows: 30 }

function connectionLabel(state: ConnectionState | 'loading', t: MobileTranslate): string {
  switch (state) {
    case 'connected':
      return t('common.connected')
    case 'connecting':
      return t('common.connecting')
    case 'handshaking':
      return t('common.handshaking')
    case 'reconnecting':
      return t('common.reconnecting')
    case 'auth-failed':
      return t('common.authFailed')
    case 'disconnected':
      return t('common.disconnected')
    case 'loading':
      return t('common.loading')
  }
}

type OverviewItem =
  | { type: 'group'; group: RemoteWindowGroupSummary }
  | { type: 'window'; window: RemoteWindowSummary }
  | { type: 'terminal'; terminal: RemoteTerminalSummary }

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

export default function HostOverviewScreen() {
  const params = useLocalSearchParams<{ hostId?: string }>()
  const hostId = getParam(params.hostId)
  const router = useRouter()
  const { t } = useMobileI18n()
  const [host, setHost] = useState<HostProfile | null>(null)
  const [connectionState, setConnectionState] = useState<ConnectionState | 'loading'>('loading')
  const [terminals, setTerminals] = useState<RemoteTerminalSummary[]>([])
  const [windows, setWindows] = useState<RemoteWindowSummary[]>([])
  const [groups, setGroups] = useState<RemoteWindowGroupSummary[]>([])
  const [overviewMode, setOverviewMode] = useState<'terminals' | 'windows'>('terminals')
  const [canCreateWindow, setCanCreateWindow] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [creatingWindow, setCreatingWindow] = useState(false)
  const [creatingGroup, setCreatingGroup] = useState(false)
  const [startingPaneKey, setStartingPaneKey] = useState<string | null>(null)
  const [stoppingPaneKey, setStoppingPaneKey] = useState<string | null>(null)
  const [deletingWindowId, setDeletingWindowId] = useState<string | null>(null)
  const [deletingGroupId, setDeletingGroupId] = useState<string | null>(null)
  const [selectedGroupWindowIds, setSelectedGroupWindowIds] = useState<string[]>([])
  const clientRef = useRef<RpcClient | null>(null)
  const logsRef = useRef<ConnectionLogEntry[]>([])

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
  const visibleWindows = useMemo(
    () => filterWindows(
      windows.filter((window) => !groupedWindowIds.has(window.windowId)),
      normalizedSearchQuery
    ),
    [groupedWindowIds, normalizedSearchQuery, windows]
  )
  const visibleGroups = useMemo(
    () =>
      groups
        .flatMap((group) => {
          if (!normalizedSearchQuery) {
            return [group]
          }
          const matchesGroupName = group.name.toLowerCase().includes(normalizedSearchQuery)
          const filteredWindows = filterWindows(group.windows, normalizedSearchQuery)
          if (!matchesGroupName && filteredWindows.length === 0) {
            return []
          }
          return [
            {
              ...group,
              windows: matchesGroupName ? group.windows : filteredWindows
            }
          ]
        }),
    [groups, normalizedSearchQuery]
  )
  const visibleTerminals = useMemo(
    () => filterTerminals(terminals, normalizedSearchQuery),
    [normalizedSearchQuery, terminals]
  )
  const overviewItems = useMemo<OverviewItem[]>(
    () =>
      overviewMode === 'windows'
        ? [
            ...visibleGroups.map((group) => ({ type: 'group' as const, group })),
            ...visibleWindows.map((window) => ({ type: 'window' as const, window }))
          ]
        : visibleTerminals.map((terminal) => ({ type: 'terminal', terminal })),
    [overviewMode, visibleGroups, visibleTerminals, visibleWindows]
  )
  const hasSearchQuery = normalizedSearchQuery.length > 0

  const appendLog = useCallback((entry: ConnectionLogEntry) => {
    logsRef.current = [...logsRef.current, entry].slice(-80)
  }, [])

  const closeClient = useCallback(() => {
    clientRef.current?.close()
    clientRef.current = null
  }, [])

  const loadAndConnect = useCallback(async () => {
    closeClient()
    setRefreshing(true)
    setConnectionState('loading')
    setError(null)
    logsRef.current = []
    setTerminals([])
    setWindows([])
    setGroups([])
    setOverviewMode('terminals')
    setCanCreateWindow(false)
    setStartingPaneKey(null)
    setStoppingPaneKey(null)
    try {
      const loadedHost = await loadHostById(hostId)
      if (!loadedHost) {
        setHost(null)
        setError(t('overview.hostNotFound'))
        setConnectionState('disconnected')
        return
      }
      setHost(loadedHost)
      const client = connectToHost(loadedHost, {
        onStateChange: setConnectionState,
        onLog: appendLog
      })
      clientRef.current = client
      const overview = await loadHostOverviewData(client)
      setOverviewMode(overview.mode)
      setCanCreateWindow(overview.canCreateWindow)
      setWindows(overview.windows)
      setGroups(overview.groups)
      setSelectedGroupWindowIds((current) =>
        filterSelectableWindowIds(current, overview.windows, overview.groups)
      )
      setTerminals(
        overview.terminals.filter((terminal) => terminal.windowId && terminal.paneId)
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRefreshing(false)
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
          setStartingPaneKey(paneKey)
          const result = await startRemoteWindow(
            client,
            pane.windowId,
            pane.paneId,
            DEFAULT_REMOTE_START_VIEWPORT
          )
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
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setStartingPaneKey(null)
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

  const handleCreateWindow = useCallback(async () => {
    if (!canCreateWindow) {
      setError(t('overview.createUnavailable'))
      return
    }
    const client = clientRef.current
    if (!client) {
      setError(t('overview.notConnected'))
      return
    }
    setCreatingWindow(true)
    setError(null)
    try {
      const result = await createRemoteWindow(client, DEFAULT_REMOTE_START_VIEWPORT)
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
      router.push(
        `/h/${hostId}/t/${encodeURIComponent(result.pane.windowId)}/${encodeURIComponent(result.pane.paneId)}`
      )
    } catch (err) {
      setError(t('overview.createFailed', { message: err instanceof Error ? err.message : String(err) }))
    } finally {
      setCreatingWindow(false)
    }
  }, [canCreateWindow, hostId, router, t])

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
    setCreatingGroup(true)
    setError(null)
    try {
      const result = await createRemoteGroup(client, selectedGroupWindowIds, t('overview.defaultGroupName'))
      setGroups((current) => [
        result.group,
        ...current.filter((group) => group.groupId !== result.group.groupId)
      ])
      setSelectedGroupWindowIds([])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setCreatingGroup(false)
    }
  }, [selectedGroupWindowIds, t])

  const handleDeleteWindow = useCallback(
    async (windowId: string) => {
      const client = clientRef.current
      if (!client) {
        setError(t('overview.notConnected'))
        return
      }
      setDeletingWindowId(windowId)
      setError(null)
      try {
        const result = await deleteRemoteWindow(client, windowId)
        setWindows((current) => current.filter((window) => window.windowId !== result.windowId))
        setGroups(result.groups)
        setSelectedGroupWindowIds((current) => current.filter((id) => id !== result.windowId))
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setDeletingWindowId(null)
      }
    },
    [t]
  )

  const handleDeleteGroup = useCallback(
    async (groupId: string) => {
      const client = clientRef.current
      if (!client) {
        setError(t('overview.notConnected'))
        return
      }
      setDeletingGroupId(groupId)
      setError(null)
      try {
        const result = await deleteRemoteGroup(client, groupId)
        setGroups((current) => current.filter((group) => group.groupId !== result.groupId))
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setDeletingGroupId(null)
      }
    },
    [t]
  )

  const syncOverviewState = useCallback(async () => {
    const client = clientRef.current
    if (!client || refreshing) {
      return
    }
    try {
      const overview = await loadHostOverviewData(client)
      setOverviewMode(overview.mode)
      setCanCreateWindow(overview.canCreateWindow)
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
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [refreshing])

  const handleStopPane = useCallback(
    async (pane: RemotePaneSummary) => {
      const client = clientRef.current
      if (!client) {
        setError(t('overview.notConnected'))
        return
      }
      const paneKey = `${pane.windowId}:${pane.paneId}`
      setStoppingPaneKey(paneKey)
      setError(null)
      try {
        const result = await stopRemotePane(client, pane.windowId, pane.paneId)
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
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setStoppingPaneKey(null)
      }
    },
    [t]
  )

  useFocusEffect(
    useCallback(() => {
      const timer = setInterval(() => {
        void syncOverviewState()
      }, OVERVIEW_STATUS_SYNC_MS)
      return () => clearInterval(timer)
    }, [syncOverviewState])
  )

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.hostTitleBlock}>
          <Text style={styles.title}>{host?.name ?? t('overview.hostFallback')}</Text>
          <Text style={styles.endpoint} numberOfLines={1}>
            {host?.endpoint ?? hostId}
          </Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable
            style={[
              styles.iconButton,
              (!canCreateWindow || creatingWindow) && styles.iconButtonDisabled
            ]}
            disabled={!canCreateWindow || creatingWindow}
            onPress={() => void handleCreateWindow()}
            accessibilityLabel={t('overview.newTerminal')}
          >
            {creatingWindow ? (
              <ActivityIndicator color={colors.textPrimary} />
            ) : (
              <Plus size={18} color={colors.textPrimary} />
            )}
          </Pressable>
          <Pressable
            style={[
              styles.iconButton,
              (selectedGroupWindowIds.length < 2 || creatingGroup) && styles.iconButtonDisabled
            ]}
            disabled={selectedGroupWindowIds.length < 2 || creatingGroup}
            onPress={() => void handleCreateGroup()}
            accessibilityLabel={t('overview.createGroup')}
          >
            {creatingGroup ? (
              <ActivityIndicator color={colors.textPrimary} />
            ) : (
              <Layers size={18} color={colors.textPrimary} />
            )}
          </Pressable>
          <Pressable style={styles.iconButton} onPress={() => void loadAndConnect()}>
            <RotateCw size={18} color={colors.textPrimary} />
          </Pressable>
          <Pressable style={styles.iconButton} onPress={() => router.push(`/h/${hostId}/settings`)}>
            <Settings size={18} color={colors.textPrimary} />
          </Pressable>
        </View>
      </View>

      <View style={styles.statusRow}>
        <View
          style={[
            styles.statusDot,
            connectionState === 'connected'
              ? styles.statusGreen
              : connectionState === 'auth-failed'
                ? styles.statusRed
                : styles.statusAmber
          ]}
        />
        <Text style={styles.statusText}>{connectionLabel(connectionState, t)}</Text>
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <Text style={styles.sectionTitle}>
        {overviewMode === 'windows' ? t('overview.windowsTitle') : t('overview.terminalsTitle')}
      </Text>
      {overviewMode === 'windows' ? (
        <Text style={styles.selectionHint}>
          {selectedGroupWindowIds.length >= 2
            ? t('overview.groupSelectionReady', { count: selectedGroupWindowIds.length })
            : t('overview.groupSelectionHint')}
        </Text>
      ) : null}
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
      </View>
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
    </View>
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
  onPress,
  onStop,
  t
}: {
  pane: RemotePaneSummary
  active: boolean
  disabled: boolean
  starting: boolean
  stopping: boolean
  onPress: () => void
  onStop: () => void
  t: MobileTranslate
}) {
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
      <View style={[styles.paneRail, { backgroundColor: statusColor(pane.status, pane.running) }]} />
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
      {pane.running ? (
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
      ) : isStartableLocalPane(pane) ? (
        <View style={styles.startIcon}>
          <Play size={13} color={colors.accentBlue} fill={colors.accentBlue} />
        </View>
      ) : null}
    </Pressable>
  )
}

function renderWindowItem(
  item: RemoteWindowSummary,
  startingPaneKey: string | null,
  stoppingPaneKey: string | null,
  deletingWindowId: string | null,
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
      onPress={() => void onOpenWindow(item)}
      disabled={!activePane || deleting}
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
          <Pressable
            style={[styles.selectButton, selectedForGroup && styles.selectButtonActive]}
            onPress={(event) => {
              event.stopPropagation()
              onToggleGroupSelection(item.windowId)
            }}
            accessibilityLabel={t('overview.selectForGroup')}
          >
            <Text style={[styles.selectButtonText, selectedForGroup && styles.selectButtonTextActive]}>
              {selectedForGroup ? '✓' : '+'}
            </Text>
          </Pressable>
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
      <View style={styles.statusDots}>
        {item.panes.map((pane) => (
          <View
            key={`${pane.windowId}:${pane.paneId}:dot`}
            style={[styles.paneStatusDot, { backgroundColor: statusColor(pane.status, pane.running) }]}
          />
        ))}
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
            disabled={!canOpen || starting}
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
    padding: spacing.lg,
    gap: spacing.md
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md
  },
  hostTitleBlock: {
    flex: 1,
    minWidth: 0
  },
  title: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: '700'
  },
  endpoint: {
    color: colors.textSecondary,
    fontFamily: typography.monoFamily,
    fontSize: typography.metaSize,
    marginTop: 3
  },
  headerActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: spacing.sm
  },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: radii.button,
    backgroundColor: colors.bgRaised,
    alignItems: 'center',
    justifyContent: 'center'
  },
  iconButtonDisabled: {
    opacity: 0.52
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4
  },
  statusGreen: {
    backgroundColor: colors.statusGreen
  },
  statusAmber: {
    backgroundColor: colors.statusAmber
  },
  statusRed: {
    backgroundColor: colors.statusRed
  },
  statusText: {
    color: colors.textSecondary,
    fontSize: typography.bodySize
  },
  errorText: {
    color: colors.statusRed,
    fontSize: typography.bodySize,
    lineHeight: 20
  },
  sectionTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '700'
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
  list: {
    gap: spacing.md,
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
  statusDots: {
    flexDirection: 'row',
    gap: spacing.xs,
    alignItems: 'center'
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
    borderColor: colors.accentBlue
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
  paneStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4
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
    paddingRight: spacing.sm,
    overflow: 'hidden'
  },
  activePaneRow: {
    borderColor: colors.accentBlue
  },
  paneRail: {
    alignSelf: 'stretch',
    width: 3,
    borderRadius: 2
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
