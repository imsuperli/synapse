import { useCallback, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View
} from 'react-native'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { RotateCw, Settings, TerminalSquare } from 'lucide-react-native'
import { ConnectionLog } from '../../../src/components/ConnectionLog'
import {
  connectToHost,
  loadHostById,
  type RemoteTerminalSummary,
  type RemoteWindowSummary
} from '../../../src/synapse/remote'
import { loadHostOverviewData } from '../../../src/synapse/host-overview'
import type { RpcClient } from '../../../src/transport/rpc-client'
import type { ConnectionLogEntry, ConnectionState, HostProfile } from '../../../src/transport/types'
import { colors, radii, spacing, typography } from '../../../src/theme/mobile-theme'

function getParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}

function connectionLabel(state: ConnectionState | 'loading'): string {
  switch (state) {
    case 'connected':
      return 'Connected'
    case 'connecting':
      return 'Connecting'
    case 'handshaking':
      return 'Securing channel'
    case 'reconnecting':
      return 'Reconnecting'
    case 'auth-failed':
      return 'Auth failed'
    case 'disconnected':
      return 'Disconnected'
    case 'loading':
      return 'Loading'
  }
}

type OverviewItem =
  | { type: 'window'; window: RemoteWindowSummary }
  | { type: 'terminal'; terminal: RemoteTerminalSummary }

export default function HostOverviewScreen() {
  const params = useLocalSearchParams<{ hostId?: string }>()
  const hostId = getParam(params.hostId)
  const router = useRouter()
  const [host, setHost] = useState<HostProfile | null>(null)
  const [connectionState, setConnectionState] = useState<ConnectionState | 'loading'>('loading')
  const [terminals, setTerminals] = useState<RemoteTerminalSummary[]>([])
  const [windows, setWindows] = useState<RemoteWindowSummary[]>([])
  const [overviewMode, setOverviewMode] = useState<'terminals' | 'windows'>('terminals')
  const [logs, setLogs] = useState<ConnectionLogEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const clientRef = useRef<RpcClient | null>(null)
  const logsRef = useRef<ConnectionLogEntry[]>([])

  const overviewItems = useMemo<OverviewItem[]>(
    () =>
      overviewMode === 'windows'
        ? windows.map((window) => ({ type: 'window', window }))
        : terminals.map((terminal) => ({ type: 'terminal', terminal })),
    [overviewMode, terminals, windows]
  )

  const appendLog = useCallback((entry: ConnectionLogEntry) => {
    logsRef.current = [...logsRef.current, entry].slice(-80)
    setLogs(logsRef.current)
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
    setLogs([])
    setTerminals([])
    setWindows([])
    setOverviewMode('terminals')
    try {
      const loadedHost = await loadHostById(hostId)
      if (!loadedHost) {
        setHost(null)
        setError('Host not found. Pair this desktop again.')
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
      setWindows(overview.windows)
      const nextTerminals = overview.terminals
      setTerminals(
        nextTerminals.filter(
          (terminal) => terminal.windowId && terminal.paneId && terminal.status === 'alive'
        )
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRefreshing(false)
    }
  }, [appendLog, closeClient, hostId])

  useFocusEffect(
    useCallback(() => {
      void loadAndConnect()
      return () => closeClient()
    }, [closeClient, loadAndConnect])
  )

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.hostTitleBlock}>
          <Text style={styles.title}>{host?.name ?? 'Synapse Desktop'}</Text>
          <Text style={styles.endpoint} numberOfLines={1}>
            {host?.endpoint ?? hostId}
          </Text>
        </View>
        <View style={styles.headerActions}>
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
        <Text style={styles.statusText}>{connectionLabel(connectionState)}</Text>
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <Text style={styles.sectionTitle}>
        {overviewMode === 'windows' ? 'Windows and Panes' : 'Running Terminals'}
      </Text>
      <FlatList
        data={overviewItems}
        keyExtractor={(item) =>
          item.type === 'window'
            ? item.window.windowId
            : `${item.terminal.windowId}:${item.terminal.paneId}:${item.terminal.sessionId}`
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
                ? 'Loading terminals'
                : overviewMode === 'windows'
                  ? 'No terminal panes'
                  : 'No running terminal panes'}
            </Text>
            <Text style={styles.emptyText}>
              {overviewMode === 'windows'
                ? 'Open or restore a terminal pane in Synapse desktop, then refresh this screen.'
                : 'Open a terminal pane in Synapse desktop, then refresh this screen.'}
            </Text>
          </View>
        }
        renderItem={({ item }) =>
          item.type === 'window'
            ? renderWindowItem(item.window, hostId, router)
            : renderTerminalItem(item.terminal, hostId, router)
        }
      />

      {logs.length > 0 ? <ConnectionLog entries={logs} title="Connection log" /> : null}
    </View>
  )
}

type HostRouter = ReturnType<typeof useRouter>

function renderTerminalItem(
  item: RemoteTerminalSummary,
  hostId: string,
  router: HostRouter
) {
  return (
    <TerminalListRow
      terminal={item}
      disabled={item.status !== 'alive'}
      onPress={() =>
        router.push(
          `/h/${hostId}/t/${encodeURIComponent(item.windowId ?? '')}/${encodeURIComponent(item.paneId ?? '')}`
        )
      }
    />
  )
}

function renderWindowItem(
  item: RemoteWindowSummary,
  hostId: string,
  router: HostRouter
) {
  return (
    <View style={styles.windowGroup}>
      <View style={styles.windowHeader}>
        <Text style={styles.windowTitle} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={styles.windowMeta}>
          {item.terminalPaneCount} terminal {item.terminalPaneCount === 1 ? 'pane' : 'panes'}
        </Text>
      </View>
      {item.panes.map((pane) => {
        const terminal: RemoteTerminalSummary = {
          windowId: pane.windowId,
          paneId: pane.paneId,
          sessionId: pane.sessionId ?? `${pane.windowId}:${pane.paneId}`,
          pid: pane.pid ?? 0,
          backend: pane.backend ?? 'local',
          status: pane.running ? 'alive' : 'exited',
          workingDirectory: pane.cwd ?? '',
          command: pane.command ?? pane.title
        }
        return (
          <TerminalListRow
            key={`${pane.windowId}:${pane.paneId}`}
            terminal={terminal}
            disabled={!pane.running}
            badge={pane.running ? 'running' : pane.status}
            onPress={() =>
              router.push(
                `/h/${hostId}/t/${encodeURIComponent(pane.windowId)}/${encodeURIComponent(pane.paneId)}`
              )
            }
          />
        )
      })}
    </View>
  )
}

function TerminalListRow({
  terminal,
  disabled = false,
  badge,
  onPress
}: {
  terminal: RemoteTerminalSummary
  disabled?: boolean
  badge?: string
  onPress: () => void
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
          {terminal.backend} - pid {terminal.pid || '-'} - {terminal.workingDirectory || 'unknown cwd'}
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
  list: {
    gap: spacing.sm
  },
  windowGroup: {
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.bgPanel,
    borderRadius: radii.row,
    padding: spacing.sm
  },
  windowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.xs
  },
  windowTitle: {
    flex: 1,
    minWidth: 0,
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '700'
  },
  windowMeta: {
    color: colors.textMuted,
    fontSize: typography.metaSize
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
    borderColor: colors.borderSubtle,
    backgroundColor: colors.bgPanel,
    borderRadius: radii.row,
    padding: spacing.md
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
  pressed: {
    opacity: 0.74
  },
  disabledRow: {
    opacity: 0.52
  }
})
