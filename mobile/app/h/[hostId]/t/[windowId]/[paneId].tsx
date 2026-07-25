import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  AppState,
  BackHandler,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type KeyboardEvent,
  type LayoutChangeEvent
} from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import {
  Bug,
  Check,
  Eraser,
  Keyboard as KeyboardIcon,
  Pencil,
  RotateCw,
  Square,
  X
} from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  type TerminalKeyboardAvoidanceMetrics,
  type TerminalHistoryMetrics,
  type TerminalWebViewDiagnostic,
  type TerminalWebViewHandle
} from '../../../../../src/terminal/TerminalWebView'
import { TerminalPaneView } from '../../../../../src/session/TerminalPaneView'
import { TerminalDiagnosticsModal } from '../../../../../src/components/TerminalDiagnosticsModal'
import {
  clearTerminal,
  connectToHost,
  deleteRemotePane,
  loadHostById,
  removeRemoteWindowFromGroup,
  requestTerminalHistory,
  requestWindowList,
  sendTerminalInput,
  startRemoteWindow,
  stopRemotePane,
  type RemoteWindowGroupSummary,
  type RemotePaneSummary
} from '../../../../../src/synapse/remote'
import {
  getDefaultTerminalAccessoryBuiltInIds,
  getVisibleTerminalAccessoryKeys
} from '../../../../../src/terminal/terminal-accessory-layout'
import {
  buildTerminalAccessoryPages,
  TERMINAL_ACCESSORY_PAGE_COLUMNS
} from '../../../../../src/terminal/terminal-accessory-pages'
import { createTerminalLiveAccessoryInput } from '../../../../../src/terminal/terminal-live-accessory-input'
import {
  buildTerminalOneShotNativeKeyBytes,
  buildTerminalOneShotTextBytes,
  EMPTY_TERMINAL_ONE_SHOT_MODIFIERS,
  getTerminalOneShotModifierList,
  hasTerminalOneShotModifiers,
  toggleTerminalOneShotModifier,
  type TerminalOneShotModifier,
  type TerminalOneShotModifiers
} from '../../../../../src/terminal/terminal-one-shot-modifiers'
import {
  clearTerminalLiveInputFocusTimer,
  focusTerminalLiveInputTarget,
  isTerminalLiveInputWithinByteLimit,
  scheduleTerminalLiveInputFocus
} from '../../../../../src/terminal/terminal-live-input'
import type { TerminalLiveInputSender } from '../../../../../src/terminal/terminal-live-input-sender'
import { getTerminalLiveInputKeyboardType } from '../../../../../src/terminal/terminal-keyboard-type'
import { normalizeTerminalTextInput } from '../../../../../src/terminal/terminal-text-input-normalization'
import { useTerminalLiveInputCommit } from '../../../../../src/terminal/use-terminal-live-input-commit'
import type { RpcClient } from '../../../../../src/transport/rpc-client'
import type { ConnectionLogEntry, ConnectionState } from '../../../../../src/transport/types'
import type { MobileTerminalTheme } from '../../../../../src/terminal/mobile-terminal-theme'
import { colors, radii, spacing, typography } from '../../../../../src/theme/mobile-theme'
import { useMobileI18n, type MobileTranslate } from '../../../../../src/i18n'
import {
  loadTerminalTextScale,
  saveTerminalTextScale
} from '../../../../../src/storage/preferences'
import { getTerminalKeyboardAvoidanceLift } from '../../../../../src/terminal/terminal-keyboard-avoidance'
import {
  appendRemoteTerminalData,
  appendRemoteTerminalHistoryIncrement,
  appendRemoteTerminalIncrementalSnapshot,
  buildRemoteTerminalInitialData,
  createRemoteTerminalHistoryState,
  prependRemoteTerminalHistoryPage,
  replaceRemoteTerminalHistorySnapshot,
  resetRemoteTerminalHistoryState
} from '../../../../../src/synapse/remote-terminal-history-state'
import {
  cacheRemoteTerminalHistoryPage,
  canPrefetchRemoteTerminalHistory,
  createRemoteTerminalHistoryPrefetchState,
  resetRemoteTerminalHistoryPrefetchState,
  takePrefetchedRemoteTerminalHistory
} from '../../../../../src/synapse/remote-terminal-history-prefetch'
import {
  INITIAL_TERMINAL_HISTORY_DELAY_MS,
  shouldLoadInitialTerminalHistory
} from '../../../../../src/synapse/remote-terminal-initial-history'
import {
  normalizeDesktopTerminalViewport,
  resolveMobileTerminalViewport,
  sameRemoteTerminalViewport,
  type RemoteTerminalViewport
} from '../../../../../src/synapse/remote-terminal-viewport'
import { terminalErrorAfterConnectionState } from '../../../../../src/synapse/terminal-connection-error'
import {
  TERMINAL_FOREGROUND_SMALL_DELTA_BYTES,
  decideRemoteTerminalForegroundRecovery,
  remoteTerminalForegroundRetryDelay
} from '../../../../../src/synapse/remote-terminal-foreground-recovery'
import {
  DEFAULT_REMOTE_TERMINAL_RESIDENT_LIMIT,
  selectRemoteTerminalResidentSessions
} from '../../../../../src/synapse/remote-terminal-resident-sessions'
import {
  appendTerminalDiagnostic,
  createTerminalDiagnosticBuffer,
  formatTerminalDiagnostics,
  type TerminalDiagnosticSource
} from '../../../../../src/diagnostics/terminal-diagnostics'
import {
  loadTerminalDiagnostics,
  saveTerminalDiagnostics
} from '../../../../../src/diagnostics/terminal-diagnostics-storage'

type TerminalLiveAccessoryInput = ReturnType<typeof createTerminalLiveAccessoryInput>

type SuppressedTerminalNativeEdit = {
  expectedText: string
  restoreText: string
}

const DEFAULT_COLS = 80
const DEFAULT_ROWS = 30
const TERMINAL_INCREMENTAL_SYNC_MS = 1500
const TERMINAL_PANE_STATUS_SYNC_MS = 3000
const TERMINAL_HISTORY_PAGE_BYTES = 192 * 1024
const TERMINAL_HISTORY_PAGE_CHUNKS = 50_000
const TERMINAL_HISTORY_PREFETCH_BYTES = 768 * 1024
const TERMINAL_HISTORY_NOTICE_MS = 3_000
const TERMINAL_INCREMENTAL_SYNC_PAGE_LIMIT = 32

type TerminalSubscribedEvent = {
  type: 'subscribed'
  subscriptionId: string
  streamId: number
  firstSeq: number
  lastSeq: number
  gap: boolean
}

type TerminalScrollbackEvent = {
  type: 'scrollback'
  windowId: string
  paneId: string
  serialized: string
  firstSeq: number
  lastSeq: number
  gap: boolean
  hasMoreBefore: boolean
  evictedBeforeSeq: number
  cols?: number
  rows?: number
  incremental: boolean
  requestedSinceSeq: number
  hasMoreAfter: boolean
  screenSnapshotOffset?: number
  screenSnapshotLength?: number
}

type TerminalDataEvent = {
  type: 'data'
  seq: number
  chunk: string
}

type TerminalStreamErrorEvent = {
  type: 'error'
  message: string
}

type TerminalSubscribeParams = {
  windowId: string
  paneId: string
  sinceSeq: number
  capabilities: { terminalBinaryStream: 1 }
}

type TabDeleteMode = 'pane' | 'group'

type ManagedTerminalTabProps = {
  label: string
  statusColor: string
  active: boolean
  normalDisabled: boolean
  starting: boolean
  editing: boolean
  deleting: boolean
  deletionInFlight: boolean
  deleteAccessibilityLabel: string
  onPress: () => void
  onLongPress: () => void
  onDelete: () => void
}

function ManagedTerminalTab({
  label,
  statusColor,
  active,
  normalDisabled,
  starting,
  editing,
  deleting,
  deletionInFlight,
  deleteAccessibilityLabel,
  onPress,
  onLongPress,
  onDelete
}: ManagedTerminalTabProps) {
  return (
    <View style={styles.paneTabWrapper}>
      <Pressable
        style={({ pressed }) => [
          styles.paneTab,
          active && styles.paneTabActive,
          editing && styles.paneTabEditing,
          normalDisabled && styles.paneTabDisabled,
          pressed && !editing && !deletionInFlight && styles.paneTabPressed
        ]}
        onPress={() => {
          if (!editing && !deletionInFlight && !starting && !normalDisabled) {
            onPress()
          }
        }}
        onLongPress={() => {
          if (!deletionInFlight) {
            onLongPress()
          }
        }}
        delayLongPress={450}
        accessibilityRole="tab"
        accessibilityState={{ selected: active, disabled: normalDisabled || starting }}
      >
        <View style={[styles.paneTabDot, { backgroundColor: statusColor }]} />
        <Text style={[styles.paneTabText, active && styles.paneTabTextActive]} numberOfLines={1}>
          {label}
        </Text>
      </Pressable>
      {editing ? (
        <Pressable
          style={({ pressed }) => [
            styles.paneTabDeleteButton,
            pressed && !deletionInFlight && styles.paneTabDeleteButtonPressed,
            deletionInFlight && !deleting && styles.paneTabDeleteButtonDisabled
          ]}
          disabled={deletionInFlight}
          onPress={onDelete}
          hitSlop={4}
          accessibilityRole="button"
          accessibilityLabel={deleteAccessibilityLabel}
        >
          {deleting ? (
            <ActivityIndicator size={12} color={colors.textPrimary} />
          ) : (
            <X size={13} color={colors.textPrimary} strokeWidth={3} />
          )}
        </Pressable>
      ) : null}
    </View>
  )
}

function terminalPaneLabel(pane: RemotePaneSummary, t: MobileTranslate): string {
  return (
    pane.title ||
    pane.command ||
    pane.cwd?.split(/[\\/]/).filter(Boolean).at(-1) ||
    t('common.terminal')
  )
}

function terminalPaneStatusColor(pane: RemotePaneSummary): string {
  if (pane.running || pane.status === 'running' || pane.status === 'waiting') {
    return colors.statusGreen
  }
  if (pane.status === 'restoring') {
    return colors.statusAmber
  }
  if (pane.status === 'error') {
    return colors.statusRed
  }
  return colors.borderSubtle
}

function isStartableTerminalPane(pane: RemotePaneSummary): boolean {
  return pane.kind === 'terminal' && !pane.running
}

function getActiveTerminalPane(
  panes: RemotePaneSummary[],
  activePaneId: string
): RemotePaneSummary | null {
  return (
    panes.find((pane) => pane.paneId === activePaneId && pane.kind === 'terminal') ??
    panes.find((pane) => pane.kind === 'terminal') ??
    null
  )
}

function terminalPaneRuntimeKey(pane: RemotePaneSummary | null | undefined): string | null {
  if (!pane?.running) {
    return null
  }
  const session = pane.sessionId ?? ''
  const pid = pane.pid == null ? '' : String(pane.pid)
  return session || pid ? `${session}:${pid}` : null
}

function terminalErrorMessage(err: unknown, t: MobileTranslate): string {
  const message = err instanceof Error ? err.message : String(err)
  if (/terminal not found|terminal_not_found|pane_not_found|window_not_found/i.test(message)) {
    return t('terminal.stoppedOnDesktop')
  }
  if (
    /remote_start_ssh_not_supported|remote_ssh_window_start_unavailable|SSH session services are not initialized/i.test(
      message
    )
  ) {
    return t('terminal.sshRestartUnavailable')
  }
  if (/remote_ssh_pane_profile_missing|SSH profile not found/i.test(message)) {
    return t('terminal.sshProfileUnavailable')
  }
  if (/SSH authentication failed|SSH .*authentication requires/i.test(message)) {
    return t('terminal.sshCredentialsUnavailable')
  }
  if (/workspace_not_loaded/i.test(message)) {
    return t('terminal.workspaceNotLoaded')
  }
  if (/pane_delete_last_pane|pane_delete_last_terminal/i.test(message)) {
    return t('terminal.cannotDeleteOnlyPane')
  }
  if (/group_not_found|window_not_in_group/i.test(message)) {
    return t('terminal.groupChanged')
  }
  return message
}

function terminalHistoryBoundaryMessage(
  history: { gap: boolean; evictedBeforeSeq: number },
  t: MobileTranslate
): string {
  return history.gap || history.evictedBeforeSeq > 0
    ? t('terminal.historyEvictedOnDesktop')
    : t('terminal.historyStartReached')
}

function parseTerminalSubscribedEvent(value: unknown): TerminalSubscribedEvent | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const event = value as Record<string, unknown>
  if (
    event.type !== 'subscribed' ||
    typeof event.subscriptionId !== 'string' ||
    typeof event.streamId !== 'number'
  ) {
    return null
  }
  return {
    type: 'subscribed',
    subscriptionId: event.subscriptionId,
    streamId: event.streamId,
    firstSeq: typeof event.firstSeq === 'number' ? event.firstSeq : 0,
    lastSeq: typeof event.lastSeq === 'number' ? event.lastSeq : 0,
    gap: event.gap === true
  }
}

function parseTerminalScrollbackEvent(value: unknown): TerminalScrollbackEvent | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const event = value as Record<string, unknown>
  if (
    event.type !== 'scrollback' ||
    typeof event.windowId !== 'string' ||
    typeof event.paneId !== 'string' ||
    typeof event.serialized !== 'string'
  ) {
    return null
  }
  return {
    type: 'scrollback',
    windowId: event.windowId,
    paneId: event.paneId,
    serialized: event.serialized,
    firstSeq: typeof event.firstSeq === 'number' ? event.firstSeq : 0,
    lastSeq: typeof event.lastSeq === 'number' ? event.lastSeq : 0,
    gap: event.gap === true,
    hasMoreBefore: event.hasMoreBefore === true,
    evictedBeforeSeq: typeof event.evictedBeforeSeq === 'number' ? event.evictedBeforeSeq : 0,
    incremental: event.incremental === true,
    requestedSinceSeq: typeof event.requestedSinceSeq === 'number' ? event.requestedSinceSeq : 0,
    hasMoreAfter: event.hasMoreAfter === true,
    ...(typeof event.cols === 'number' && event.cols > 0 ? { cols: event.cols } : {}),
    ...(typeof event.rows === 'number' && event.rows > 0 ? { rows: event.rows } : {}),
    ...(typeof event.screenSnapshotOffset === 'number'
      ? { screenSnapshotOffset: event.screenSnapshotOffset }
      : {}),
    ...(typeof event.screenSnapshotLength === 'number'
      ? { screenSnapshotLength: event.screenSnapshotLength }
      : {})
  }
}

function parseTerminalDataEvent(value: unknown): TerminalDataEvent | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const event = value as Record<string, unknown>
  if (
    event.type !== 'data' ||
    typeof event.chunk !== 'string' ||
    typeof event.seq !== 'number' ||
    !Number.isInteger(event.seq) ||
    event.seq <= 0
  ) {
    return null
  }
  return {
    type: 'data',
    seq: event.seq,
    chunk: event.chunk
  }
}

function parseTerminalStreamErrorEvent(value: unknown): TerminalStreamErrorEvent | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const event = value as Record<string, unknown>
  if (event.type !== 'error' || typeof event.message !== 'string') {
    return null
  }
  return { type: 'error', message: event.message }
}

const terminalTheme: MobileTerminalTheme = {
  theme: {
    background: colors.terminalBg,
    foreground: colors.textPrimary,
    cursor: '#ffffff',
    cursorAccent: colors.terminalBg,
    selectionBackground: 'rgba(59,130,246,0.35)',
    black: colors.terminalBg,
    red: '#f7768e',
    green: '#9ece6a',
    yellow: '#e0af68',
    blue: '#7aa2f7',
    magenta: '#bb9af7',
    cyan: '#7dcfff',
    white: '#c0caf5',
    brightBlack: '#565f89',
    brightRed: '#ff7a93',
    brightGreen: '#b9f27c',
    brightYellow: '#ffcf7a',
    brightBlue: '#8db0ff',
    brightMagenta: '#c7a9ff',
    brightCyan: '#8eeaff',
    brightWhite: '#ffffff'
  }
}

function getParam(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? (value[0] ?? '') : (value ?? '')
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

function createRemoteTerminalSessionRuntime(windowId: string, paneId: string) {
  return {
    windowId,
    paneId,
    handle: `${windowId}:${paneId}`,
    terminalRef: { current: null as TerminalWebViewHandle | null },
    unsubscribeRef: { current: null as (() => void) | null },
    terminalSubscribeParamsRef: { current: null as TerminalSubscribeParams | null },
    terminalSubscriptionGenerationRef: { current: 0 },
    terminalHistoryGenerationRef: { current: 0 },
    terminalHistoryRef: { current: createRemoteTerminalHistoryState() },
    terminalHistoryPrefetchRef: { current: createRemoteTerminalHistoryPrefetchState() },
    terminalHistoryPrefetchPromiseRef: { current: null as Promise<void> | null },
    initialHistoryHydrationPromiseRef: { current: null as Promise<void> | null },
    resumeInitialHistoryHydrationRef: { current: null as (() => Promise<void>) | null },
    initialHistoryStagesRef: { current: 0 },
    initialHistoryActivatedBytesRef: { current: 0 },
    terminalHistoryMetricsRef: { current: null as TerminalHistoryMetrics | null },
    autoScrollDisabledRef: { current: false },
    terminalInitializedRef: { current: false },
    terminalWebReadyRef: { current: false },
    resyncingRef: { current: false },
    loadingOlderHistoryRef: { current: false },
    desktopViewportRef: {
      current: { cols: DEFAULT_COLS, rows: DEFAULT_ROWS } as RemoteTerminalViewport
    },
    viewportRef: {
      current: { cols: DEFAULT_COLS, rows: DEFAULT_ROWS } as RemoteTerminalViewport
    },
    currentPaneRuntimeKeyRef: { current: null as string | null },
    terminalIncrementSyncInFlightRef: { current: false },
    syncTerminalIncrementRef: { current: null as (() => Promise<void>) | null },
    terminalRenderPausedRef: { current: false },
    terminalRenderedSeqRef: { current: 0 },
    terminalPendingOverflowedRef: { current: false },
    foregroundRecoveryRequestedRef: { current: false },
    foregroundRecoveryInFlightRef: { current: false },
    foregroundRecoveryRetryTimerRef: { current: null as ReturnType<typeof setTimeout> | null },
    foregroundRecoveryRetryAttemptRef: { current: 0 },
    recoverTerminalAfterForegroundRef: { current: null as (() => Promise<void>) | null },
    paneStatusSyncInFlightRef: { current: false },
    lastUsedAt: Date.now()
  }
}

type RemoteTerminalSessionRuntime = ReturnType<typeof createRemoteTerminalSessionRuntime>

function clearRemoteTerminalForegroundRecoveryRetry(runtime: RemoteTerminalSessionRuntime): void {
  if (runtime.foregroundRecoveryRetryTimerRef.current) {
    clearTimeout(runtime.foregroundRecoveryRetryTimerRef.current)
    runtime.foregroundRecoveryRetryTimerRef.current = null
  }
  runtime.foregroundRecoveryRetryAttemptRef.current = 0
}

export default function RemoteTerminalScreen() {
  const params = useLocalSearchParams<{ hostId?: string; windowId?: string; paneId?: string }>()
  const hostId = getParam(params.hostId)
  const initialWindowId = getParam(params.windowId)
  const initialPaneId = getParam(params.paneId)
  const [activeTerminal, setActiveTerminal] = useState({
    windowId: initialWindowId,
    paneId: initialPaneId
  })
  const windowId = activeTerminal.windowId
  const paneId = activeTerminal.paneId
  const terminalHandle = `${windowId}:${paneId}`
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { t } = useMobileI18n()
  const clientRef = useRef<RpcClient | null>(null)
  const sessionRuntimesRef = useRef<Map<string, RemoteTerminalSessionRuntime>>(new Map())
  const initialTerminalHandle = `${initialWindowId}:${initialPaneId}`
  const [residentTerminalHandles, setResidentTerminalHandles] = useState([initialTerminalHandle])
  let sessionRuntime = sessionRuntimesRef.current.get(terminalHandle)
  if (!sessionRuntime) {
    sessionRuntime = createRemoteTerminalSessionRuntime(windowId, paneId)
    sessionRuntimesRef.current.set(terminalHandle, sessionRuntime)
  }
  sessionRuntime.lastUsedAt = Date.now()
  const terminalRef = sessionRuntime.terminalRef
  const unsubscribeRef = sessionRuntime.unsubscribeRef
  const terminalSubscribeParamsRef = sessionRuntime.terminalSubscribeParamsRef
  const terminalSubscriptionGenerationRef = sessionRuntime.terminalSubscriptionGenerationRef
  const terminalHistoryGenerationRef = sessionRuntime.terminalHistoryGenerationRef
  const windowListGenerationRef = useRef(0)
  const runIdRef = useRef(0)
  const terminalHistoryRef = sessionRuntime.terminalHistoryRef
  const terminalHistoryPrefetchRef = sessionRuntime.terminalHistoryPrefetchRef
  const terminalHistoryPrefetchPromiseRef = sessionRuntime.terminalHistoryPrefetchPromiseRef
  const initialHistoryHydrationPromiseRef = sessionRuntime.initialHistoryHydrationPromiseRef
  const resumeInitialHistoryHydrationRef = sessionRuntime.resumeInitialHistoryHydrationRef
  const initialHistoryStagesRef = sessionRuntime.initialHistoryStagesRef
  const initialHistoryActivatedBytesRef = sessionRuntime.initialHistoryActivatedBytesRef
  const terminalHistoryMetricsRef = sessionRuntime.terminalHistoryMetricsRef
  const autoScrollDisabledRef = sessionRuntime.autoScrollDisabledRef
  const terminalInitializedRef = sessionRuntime.terminalInitializedRef
  const terminalWebReadyRef = sessionRuntime.terminalWebReadyRef
  const resyncingRef = sessionRuntime.resyncingRef
  const loadingOlderHistoryRef = sessionRuntime.loadingOlderHistoryRef
  const desktopViewportRef = sessionRuntime.desktopViewportRef
  const viewportRef = sessionRuntime.viewportRef
  const activeHandleRef = useRef<string | null>(terminalHandle)
  const activeSessionTabTypeRef = useRef<'terminal' | null>('terminal')
  const liveInputRef = useRef<TextInput | null>(null)
  const liveInputFocusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const keyboardViewportRestoreFrameRef = useRef<ReturnType<typeof requestAnimationFrame> | null>(
    null
  )
  const repeatTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const repeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const tabDeleteModeRef = useRef<TabDeleteMode | null>(null)
  const suppressNextTabPressRef = useRef(false)
  const sendLiveTerminalInputRef = useRef<TerminalLiveInputSender>(async () => false)
  const currentPaneRuntimeKeyRef = sessionRuntime.currentPaneRuntimeKeyRef
  const terminalIncrementSyncInFlightRef = sessionRuntime.terminalIncrementSyncInFlightRef
  const syncTerminalIncrementRef = sessionRuntime.syncTerminalIncrementRef
  const terminalRenderPausedRef = sessionRuntime.terminalRenderPausedRef
  const terminalRenderedSeqRef = sessionRuntime.terminalRenderedSeqRef
  const terminalPendingOverflowedRef = sessionRuntime.terminalPendingOverflowedRef
  const foregroundRecoveryRequestedRef = sessionRuntime.foregroundRecoveryRequestedRef
  const foregroundRecoveryInFlightRef = sessionRuntime.foregroundRecoveryInFlightRef
  const foregroundRecoveryRetryTimerRef = sessionRuntime.foregroundRecoveryRetryTimerRef
  const foregroundRecoveryRetryAttemptRef = sessionRuntime.foregroundRecoveryRetryAttemptRef
  const recoverTerminalAfterForegroundRef = sessionRuntime.recoverTerminalAfterForegroundRef
  const paneStatusSyncInFlightRef = sessionRuntime.paneStatusSyncInFlightRef
  const syncPaneStatusRef = useRef<(() => Promise<void>) | null>(null)
  const openTerminalRef = useRef<(() => Promise<void>) | null>(null)
  const screenFocusedRef = useRef(false)
  const lastOpenedHandleRef = useRef<string | null>(null)
  const handleHistoryTopReachedRef = useRef<(() => void) | null>(null)
  const diagnosticsBufferRef = useRef(createTerminalDiagnosticBuffer())
  const diagnosticsVisibleRef = useRef(false)
  const diagnosticsPersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const diagnosticsStorageLoadedRef = useRef(false)
  const diagnosticsPersistencePendingRef = useRef(false)
  const [connectionState, setConnectionState] = useState<ConnectionState | 'loading'>('loading')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [logs, setLogs] = useState<ConnectionLogEntry[]>([])
  const [liveInputCapture, setLiveInputCaptureState] = useState('')
  const liveInputCaptureRef = useRef('')
  const [oneShotModifiers, setOneShotModifiers] = useState<TerminalOneShotModifiers>(
    EMPTY_TERMINAL_ONE_SHOT_MODIFIERS
  )
  const oneShotModifiersRef = useRef<TerminalOneShotModifiers>(EMPTY_TERMINAL_ONE_SHOT_MODIFIERS)
  const suppressedTerminalNativeEditRef = useRef<SuppressedTerminalNativeEdit | null>(null)
  const [keyboardHeight, setKeyboardHeight] = useState(0)
  const [terminalFrameHeight, setTerminalFrameHeight] = useState(0)
  const [terminalKeyboardMetrics, setTerminalKeyboardMetrics] =
    useState<TerminalKeyboardAvoidanceMetrics | null>(null)
  const [windowPanes, setWindowPanes] = useState<RemotePaneSummary[]>([])
  const [groupWindowTabs, setGroupWindowTabs] = useState<RemoteWindowGroupSummary['windows']>([])
  const [currentGroupId, setCurrentGroupId] = useState<string | null>(null)
  const [startingTabPaneKey, setStartingTabPaneKey] = useState<string | null>(null)
  const [tabDeleteMode, setTabDeleteMode] = useState<TabDeleteMode | null>(null)
  const [deletingTabKey, setDeletingTabKey] = useState<string | null>(null)
  const [stopping, setStopping] = useState(false)
  const [terminalRunning, setTerminalRunning] = useState(true)
  const [terminalTextScale, setTerminalTextScale] = useState(1)
  const [autoScrollDisabled, setAutoScrollDisabled] = useState(autoScrollDisabledRef.current)
  const [loadingOlderHistory, setLoadingOlderHistory] = useState(false)
  const [historyNotice, setHistoryNotice] = useState<string | null>(null)
  const [diagnosticsVisible, setDiagnosticsVisible] = useState(false)
  const [diagnosticsRevision, setDiagnosticsRevision] = useState(0)
  const { width: accessoryPageWidth } = useWindowDimensions()
  const logsRef = useRef<ConnectionLogEntry[]>([])
  const liveInputTerminalHandles = useMemo(() => new Set([terminalHandle]), [terminalHandle])
  const liveInputTerminalHandlesRef = useRef<Set<string>>(new Set([terminalHandle]))
  const accessoryKeys = useMemo(
    () => getVisibleTerminalAccessoryKeys(getDefaultTerminalAccessoryBuiltInIds()),
    []
  )
  const accessoryPages = useMemo(() => buildTerminalAccessoryPages(accessoryKeys), [accessoryKeys])

  useEffect(() => {
    if (!historyNotice) {
      return
    }
    const timer = setTimeout(() => {
      setHistoryNotice(null)
    }, TERMINAL_HISTORY_NOTICE_MS)
    return () => clearTimeout(timer)
  }, [historyNotice])
  const currentTabMode: TabDeleteMode | null =
    groupWindowTabs.length > 1 ? 'group' : windowPanes.length > 1 ? 'pane' : null

  activeHandleRef.current = terminalHandle
  activeSessionTabTypeRef.current = 'terminal'
  liveInputTerminalHandlesRef.current = liveInputTerminalHandles

  useEffect(() => {
    setAutoScrollDisabled(autoScrollDisabledRef.current)
  }, [autoScrollDisabledRef, terminalHandle])

  const setLiveInputCapture = useCallback((text: string) => {
    liveInputCaptureRef.current = text
    setLiveInputCaptureState(text)
  }, [])

  const setTerminalOneShotModifiers = useCallback((modifiers: TerminalOneShotModifiers) => {
    oneShotModifiersRef.current = modifiers
    setOneShotModifiers(modifiers)
  }, [])

  const clearTerminalOneShotModifierState = useCallback(() => {
    if (!hasTerminalOneShotModifiers(oneShotModifiersRef.current)) {
      return
    }
    setTerminalOneShotModifiers(EMPTY_TERMINAL_ONE_SHOT_MODIFIERS)
  }, [setTerminalOneShotModifiers])

  const resetTerminalOneShotModifiers = useCallback(() => {
    suppressedTerminalNativeEditRef.current = null
    clearTerminalOneShotModifierState()
  }, [clearTerminalOneShotModifierState])

  const toggleOneShotModifier = useCallback(
    (modifier: TerminalOneShotModifier) => {
      setTerminalOneShotModifiers(
        toggleTerminalOneShotModifier(oneShotModifiersRef.current, modifier)
      )
    },
    [setTerminalOneShotModifiers]
  )

  const flushDiagnosticsPersistence = useCallback(() => {
    if (diagnosticsPersistTimerRef.current) {
      clearTimeout(diagnosticsPersistTimerRef.current)
      diagnosticsPersistTimerRef.current = null
    }
    if (!diagnosticsStorageLoadedRef.current) {
      diagnosticsPersistencePendingRef.current = true
      return
    }
    diagnosticsPersistencePendingRef.current = false
    void saveTerminalDiagnostics(diagnosticsBufferRef.current).catch(() => {})
  }, [])

  const scheduleDiagnosticsPersistence = useCallback(() => {
    diagnosticsPersistencePendingRef.current = true
    if (!diagnosticsStorageLoadedRef.current) {
      return
    }
    if (diagnosticsPersistTimerRef.current) {
      clearTimeout(diagnosticsPersistTimerRef.current)
    }
    diagnosticsPersistTimerRef.current = setTimeout(() => {
      diagnosticsPersistTimerRef.current = null
      flushDiagnosticsPersistence()
    }, 500)
  }, [flushDiagnosticsPersistence])

  const appendDiagnostic = useCallback(
    (
      source: TerminalDiagnosticSource,
      event: string,
      metrics: Record<string, unknown> = {},
      ts?: number
    ) => {
      appendTerminalDiagnostic(diagnosticsBufferRef.current, {
        source,
        event,
        metrics,
        ...(typeof ts === 'number' ? { ts } : {})
      })
      if (diagnosticsVisibleRef.current) {
        setDiagnosticsRevision((revision) => revision + 1)
      }
      scheduleDiagnosticsPersistence()
    },
    [scheduleDiagnosticsPersistence]
  )

  useEffect(() => {
    let cancelled = false
    void loadTerminalDiagnostics()
      .then((persisted) => {
        if (cancelled) {
          return
        }
        const currentEntries = diagnosticsBufferRef.current.entries
        const entriesByKey = new Map(
          [...persisted.entries, ...currentEntries].map((entry) => [
            `${entry.ts}:${entry.source}:${entry.event}:${JSON.stringify(entry.metrics)}`,
            entry
          ])
        )
        const merged = Array.from(entriesByKey.values())
          .sort((a, b) => a.ts - b.ts)
          .slice(-diagnosticsBufferRef.current.limit)
        diagnosticsBufferRef.current.entries = merged
        diagnosticsStorageLoadedRef.current = true
        if (diagnosticsVisibleRef.current) {
          setDiagnosticsRevision((revision) => revision + 1)
        }
        if (diagnosticsPersistencePendingRef.current) {
          scheduleDiagnosticsPersistence()
        }
      })
      .catch(() => {
        if (cancelled) {
          return
        }
        diagnosticsStorageLoadedRef.current = true
        if (diagnosticsPersistencePendingRef.current) {
          scheduleDiagnosticsPersistence()
        }
      })
    return () => {
      cancelled = true
      if (diagnosticsStorageLoadedRef.current) {
        flushDiagnosticsPersistence()
      } else if (diagnosticsPersistTimerRef.current) {
        clearTimeout(diagnosticsPersistTimerRef.current)
        diagnosticsPersistTimerRef.current = null
      }
    }
  }, [flushDiagnosticsPersistence, scheduleDiagnosticsPersistence])

  const appendLog = useCallback(
    (entry: ConnectionLogEntry) => {
      logsRef.current = [...logsRef.current, entry].slice(-40)
      setLogs(logsRef.current)
      appendDiagnostic(
        'network',
        'connection-log',
        {
          level: entry.level,
          message: entry.message,
          detail: entry.detail ?? null
        },
        entry.ts
      )
    },
    [appendDiagnostic]
  )

  const enterTabDeleteMode = useCallback((mode: TabDeleteMode) => {
    tabDeleteModeRef.current = mode
    setTabDeleteMode(mode)
  }, [])

  const exitTabDeleteMode = useCallback(() => {
    tabDeleteModeRef.current = null
    suppressNextTabPressRef.current = false
    setTabDeleteMode(null)
  }, [])

  const handleTabLongPress = useCallback(
    (mode: TabDeleteMode) => {
      suppressNextTabPressRef.current = true
      enterTabDeleteMode(mode)
    },
    [enterTabDeleteMode]
  )

  const handleManagedTabPress = useCallback((action: () => void) => {
    if (suppressNextTabPressRef.current) {
      suppressNextTabPressRef.current = false
      return
    }
    if (tabDeleteModeRef.current) {
      return
    }
    action()
  }, [])

  const stopAccessoryRepeat = useCallback(() => {
    if (repeatTimeoutRef.current) {
      clearTimeout(repeatTimeoutRef.current)
      repeatTimeoutRef.current = null
    }
    if (repeatIntervalRef.current) {
      clearInterval(repeatIntervalRef.current)
      repeatIntervalRef.current = null
    }
  }, [])

  const cancelKeyboardViewportRestore = useCallback(() => {
    if (keyboardViewportRestoreFrameRef.current === null) {
      return
    }
    cancelAnimationFrame(keyboardViewportRestoreFrameRef.current)
    keyboardViewportRestoreFrameRef.current = null
  }, [])

  const restoreTerminalAfterKeyboard = useCallback(() => {
    setKeyboardHeight(0)
    cancelKeyboardViewportRestore()
    // The native keyboard hide event can precede the WebView's restored layout.
    // Wait for RN layout and the WebView viewport to settle before clamping pan.
    keyboardViewportRestoreFrameRef.current = requestAnimationFrame(() => {
      keyboardViewportRestoreFrameRef.current = requestAnimationFrame(() => {
        keyboardViewportRestoreFrameRef.current = null
        if (!Keyboard.isVisible()) {
          const runtime = activeHandleRef.current
            ? sessionRuntimesRef.current.get(activeHandleRef.current)
            : null
          runtime?.terminalRef.current?.restoreKeyboardViewport()
        }
      })
    })
  }, [cancelKeyboardViewportRestore])

  const stopTerminalSubscription = useCallback(() => {
    terminalSubscriptionGenerationRef.current += 1
    unsubscribeRef.current?.()
    unsubscribeRef.current = null
    terminalSubscribeParamsRef.current = null
  }, [sessionRuntime])

  const cleanup = useCallback(() => {
    runIdRef.current += 1
    windowListGenerationRef.current += 1
    for (const runtime of sessionRuntimesRef.current.values()) {
      runtime.terminalSubscriptionGenerationRef.current += 1
      runtime.terminalHistoryGenerationRef.current += 1
      runtime.unsubscribeRef.current?.()
      runtime.unsubscribeRef.current = null
      runtime.terminalSubscribeParamsRef.current = null
      runtime.resyncingRef.current = false
      runtime.loadingOlderHistoryRef.current = false
      runtime.terminalHistoryPrefetchPromiseRef.current = null
      runtime.initialHistoryHydrationPromiseRef.current = null
      runtime.initialHistoryStagesRef.current = 0
      runtime.initialHistoryActivatedBytesRef.current = 0
      runtime.terminalHistoryMetricsRef.current = null
      runtime.terminalIncrementSyncInFlightRef.current = false
      runtime.terminalRenderPausedRef.current = false
      runtime.terminalRenderedSeqRef.current = 0
      runtime.terminalPendingOverflowedRef.current = false
      runtime.foregroundRecoveryRequestedRef.current = false
      runtime.foregroundRecoveryInFlightRef.current = false
      clearRemoteTerminalForegroundRecoveryRetry(runtime)
      runtime.paneStatusSyncInFlightRef.current = false
      resetRemoteTerminalHistoryPrefetchState(runtime.terminalHistoryPrefetchRef.current)
    }
    clientRef.current?.close()
    clientRef.current = null
    clearTerminalLiveInputFocusTimer(liveInputFocusTimerRef)
    cancelKeyboardViewportRestore()
    stopAccessoryRepeat()
    resetTerminalOneShotModifiers()
    setLoadingOlderHistory(false)
  }, [cancelKeyboardViewportRestore, resetTerminalOneShotModifiers, stopAccessoryRepeat])

  const refitTerminalToPhone = useCallback(() => {
    const runtime = activeHandleRef.current
      ? sessionRuntimesRef.current.get(activeHandleRef.current)
      : null
    runtime?.terminalRef.current?.resetZoom()
  }, [])

  const buildTerminalInitialData = useCallback(() => {
    return buildRemoteTerminalInitialData(terminalHistoryRef.current)
  }, [sessionRuntime])

  const updateTerminalSubscriptionCursor = useCallback(() => {
    if (terminalSubscribeParamsRef.current) {
      terminalSubscribeParamsRef.current.sinceSeq = terminalHistoryRef.current.lastSeq
    }
  }, [sessionRuntime])

  const updateTerminalViewportFromDesktop = useCallback(
    (source: { cols?: number; rows?: number } | null | undefined, resize = true) => {
      const desktopViewport = normalizeDesktopTerminalViewport(source, desktopViewportRef.current)
      desktopViewportRef.current = desktopViewport
      const nextViewport = resolveMobileTerminalViewport(desktopViewport)
      if (sameRemoteTerminalViewport(nextViewport, viewportRef.current)) {
        return nextViewport
      }
      viewportRef.current = nextViewport
      if (resize) {
        terminalRef.current?.resize(nextViewport.cols, nextViewport.rows)
      }
      return nextViewport
    },
    [sessionRuntime]
  )

  const handleTerminalWebReady = useCallback(() => {
    const wasReady = terminalWebReadyRef.current
    terminalWebReadyRef.current = true
    if (!wasReady || !terminalInitializedRef.current) {
      refitTerminalToPhone()
      return
    }
    const viewport = viewportRef.current
    terminalRef.current?.init(
      viewport.cols,
      viewport.rows,
      buildTerminalInitialData(),
      true,
      undefined,
      true
    )
  }, [buildTerminalInitialData, refitTerminalToPhone])

  const loadWindowPaneTabs = useCallback(
    async (client: RpcClient, expectedRunId = runIdRef.current) => {
      const requestGeneration = windowListGenerationRef.current + 1
      windowListGenerationRef.current = requestGeneration
      try {
        const { windows, groups } = await requestWindowList(client)
        if (
          runIdRef.current !== expectedRunId ||
          clientRef.current !== client ||
          windowListGenerationRef.current !== requestGeneration
        ) {
          return undefined
        }
        const currentWindow = windows.find((window) => window.windowId === windowId)
        setWindowPanes(currentWindow?.panes.filter((pane) => pane.kind === 'terminal') ?? [])
        const currentGroup = groups.find((group) =>
          group.windows.some((window) => window.windowId === windowId)
        )
        setCurrentGroupId(currentGroup?.groupId ?? null)
        setGroupWindowTabs(currentGroup?.windows ?? [])
        return (
          currentWindow?.panes.find((pane) => pane.paneId === paneId && pane.kind === 'terminal') ??
          null
        )
      } catch {
        if (
          runIdRef.current === expectedRunId &&
          clientRef.current === client &&
          windowListGenerationRef.current === requestGeneration
        ) {
          setWindowPanes([])
          setGroupWindowTabs([])
          setCurrentGroupId(null)
        }
        return undefined
      }
    },
    [paneId, windowId]
  )

  const applyTerminalScrollbackSnapshot = useCallback(
    async (
      client: RpcClient,
      runId: number,
      snapshot: TerminalScrollbackEvent,
      preserveScroll = false,
      subscriptionGeneration = terminalSubscriptionGenerationRef.current
    ) => {
      if (snapshot.windowId !== windowId || snapshot.paneId !== paneId) {
        return null
      }
      if (
        runIdRef.current !== runId ||
        clientRef.current !== client ||
        terminalSubscriptionGenerationRef.current !== subscriptionGeneration
      ) {
        return null
      }
      terminalHistoryGenerationRef.current += 1
      terminalHistoryPrefetchPromiseRef.current = null
      initialHistoryHydrationPromiseRef.current = null
      initialHistoryStagesRef.current = 0
      initialHistoryActivatedBytesRef.current = 0
      terminalHistoryMetricsRef.current = null
      replaceRemoteTerminalHistorySnapshot(terminalHistoryRef.current, snapshot)
      resetRemoteTerminalHistoryPrefetchState(
        terminalHistoryPrefetchRef.current,
        snapshot.firstSeq,
        snapshot.hasMoreBefore,
        snapshot.gap,
        snapshot.evictedBeforeSeq
      )
      terminalHistoryRef.current.hasMoreBefore = terminalHistoryPrefetchRef.current.hasMoreBefore
      appendDiagnostic('mobile', 'history-snapshot', {
        handle: terminalHandle,
        returnedFirstSeq: snapshot.firstSeq,
        returnedLastSeq: snapshot.lastSeq,
        returnedSeqCount:
          snapshot.firstSeq > 0 && snapshot.lastSeq >= snapshot.firstSeq
            ? snapshot.lastSeq - snapshot.firstSeq + 1
            : 0,
        returnedChars: snapshot.serialized.length,
        pcRetainedFirstSeq: snapshot.lastSeq > 0 ? snapshot.evictedBeforeSeq + 1 : 0,
        pcRetainedLastSeq: snapshot.lastSeq,
        hasMoreBefore: snapshot.hasMoreBefore,
        gap: snapshot.gap,
        evictedBeforeSeq: snapshot.evictedBeforeSeq,
        screenSnapshotChars: snapshot.screenSnapshotLength ?? 0
      })
      updateTerminalSubscriptionCursor()
      if (activeHandleRef.current === terminalHandle) {
        setHistoryNotice(
          snapshot.gap && !snapshot.hasMoreBefore
            ? terminalHistoryBoundaryMessage(terminalHistoryRef.current, t)
            : null
        )
      }
      const viewport = updateTerminalViewportFromDesktop(snapshot, false)
      viewportRef.current = viewport
      terminalRef.current?.init(
        viewport.cols,
        viewport.rows,
        buildTerminalInitialData(),
        preserveScroll,
        undefined,
        true
      )
      terminalInitializedRef.current = true
      await terminalRef.current?.awaitReady()
      terminalRenderedSeqRef.current = Math.max(terminalRenderedSeqRef.current, snapshot.lastSeq)
      if (
        runIdRef.current !== runId ||
        clientRef.current !== client ||
        terminalSubscriptionGenerationRef.current !== subscriptionGeneration
      ) {
        return null
      }
      return snapshot
    },
    [
      buildTerminalInitialData,
      appendDiagnostic,
      paneId,
      t,
      updateTerminalSubscriptionCursor,
      updateTerminalViewportFromDesktop,
      windowId,
      terminalHandle
    ]
  )

  const startTerminalSubscription = useCallback(
    (
      client: RpcClient,
      runId: number,
      options: { preserveScroll?: boolean; sinceSeq?: number } = {}
    ) => {
      stopTerminalSubscription()
      const subscriptionGeneration = terminalSubscriptionGenerationRef.current
      return new Promise<TerminalScrollbackEvent | null>((resolve, reject) => {
        let settled = false
        let appliedSnapshot = false
        const settle = (snapshot: TerminalScrollbackEvent | null) => {
          if (settled) {
            return
          }
          settled = true
          resolve(snapshot)
        }
        const subscribeParams: TerminalSubscribeParams = {
          windowId,
          paneId,
          sinceSeq: options.sinceSeq ?? terminalHistoryRef.current.lastSeq,
          capabilities: { terminalBinaryStream: 1 }
        }
        terminalSubscribeParamsRef.current = subscribeParams
        unsubscribeRef.current = client.subscribe(
          'terminal.subscribe',
          subscribeParams,
          (payload) => {
            if (
              runIdRef.current !== runId ||
              clientRef.current !== client ||
              terminalSubscriptionGenerationRef.current !== subscriptionGeneration
            ) {
              return
            }
            const streamError = parseTerminalStreamErrorEvent(payload)
            if (streamError) {
              if (!settled) {
                reject(new Error(streamError.message))
              } else if (activeHandleRef.current === terminalHandle) {
                setError(terminalErrorMessage(streamError.message, t))
              }
              return
            }
            const subscribed = parseTerminalSubscribedEvent(payload)
            if (subscribed) {
              if (activeHandleRef.current === terminalHandle) {
                setError((current) => terminalErrorAfterConnectionState(current, 'connected'))
              }
              appendDiagnostic('mobile', 'terminal-subscribed', {
                handle: terminalHandle,
                streamId: subscribed.streamId,
                firstSeq: subscribed.firstSeq,
                lastSeq: subscribed.lastSeq,
                gap: subscribed.gap
              })
              return
            }
            const snapshot = parseTerminalScrollbackEvent(payload)
            if (snapshot) {
              if (appliedSnapshot) {
                updateTerminalViewportFromDesktop(snapshot)
                if (snapshot.incremental) {
                  const appended = appendRemoteTerminalIncrementalSnapshot(
                    terminalHistoryRef.current,
                    snapshot
                  )
                  if (appended.data) {
                    if (!terminalRenderPausedRef.current) {
                      terminalRef.current?.write(appended.data)
                      terminalRenderedSeqRef.current = terminalHistoryRef.current.lastSeq
                    }
                  }
                  terminalPendingOverflowedRef.current ||= appended.overflowed
                  updateTerminalSubscriptionCursor()
                  if (appended.needsHistorySync || appended.overflowed) {
                    setTimeout(() => {
                      void syncTerminalIncrementRef.current?.()
                    }, 0)
                  }
                } else if (snapshot.requestedSinceSeq > 0) {
                  void applyTerminalScrollbackSnapshot(
                    client,
                    runId,
                    snapshot,
                    true,
                    subscriptionGeneration
                  ).catch((err) => {
                    if (
                      runIdRef.current === runId &&
                      clientRef.current === client &&
                      activeHandleRef.current === terminalHandle
                    ) {
                      setError(terminalErrorMessage(err, t))
                    }
                  })
                } else {
                  setTimeout(() => {
                    void syncTerminalIncrementRef.current?.()
                  }, 0)
                }
                return
              }
              appliedSnapshot = true
              void (async () => {
                try {
                  const applied = await applyTerminalScrollbackSnapshot(
                    client,
                    runId,
                    snapshot,
                    options.preserveScroll === true,
                    subscriptionGeneration
                  )
                  settle(applied)
                } catch (err) {
                  if (!settled) {
                    reject(err instanceof Error ? err : new Error(String(err)))
                  }
                }
              })()
              return
            }
            const event = parseTerminalDataEvent(payload)
            if (!event) {
              return
            }
            const appended = appendRemoteTerminalData(
              terminalHistoryRef.current,
              event.seq,
              event.chunk
            )
            if (appended.data) {
              if (!terminalRenderPausedRef.current) {
                terminalRef.current?.write(appended.data)
                terminalRenderedSeqRef.current = terminalHistoryRef.current.lastSeq
              }
            }
            terminalPendingOverflowedRef.current ||= appended.overflowed
            updateTerminalSubscriptionCursor()
            if (appended.needsHistorySync) {
              setTimeout(() => {
                void syncTerminalIncrementRef.current?.()
              }, 0)
            }
          }
        )
      })
    },
    [
      applyTerminalScrollbackSnapshot,
      appendDiagnostic,
      paneId,
      stopTerminalSubscription,
      t,
      updateTerminalSubscriptionCursor,
      updateTerminalViewportFromDesktop,
      windowId
    ]
  )

  const prefetchOlderTerminalHistory = useCallback(
    (maxCachedBytes = TERMINAL_HISTORY_PREFETCH_BYTES): Promise<void> => {
      const existing = terminalHistoryPrefetchPromiseRef.current
      if (existing) {
        return existing
      }
      const client = clientRef.current
      if (!client) {
        return Promise.resolve()
      }
      const runId = runIdRef.current
      const historyGeneration = terminalHistoryGenerationRef.current
      let request: Promise<void>
      request = (async () => {
        const prefetch = terminalHistoryPrefetchRef.current
        const requestedBeforeSeq = prefetch.nextBeforeSeq
        let fetchedPages = 0
        let fetchedChunks = 0
        let fetchedChars = 0
        let returnedFirstSeq = 0
        let returnedLastSeq = 0
        let latestSeq = terminalHistoryRef.current.lastSeq
        let result = 'cache-full'
        try {
          while (canPrefetchRemoteTerminalHistory(prefetch, maxCachedBytes)) {
            const beforeSeq = prefetch.nextBeforeSeq
            const history = await requestTerminalHistory(client, windowId, paneId, {
              beforeSeq,
              limitBytes: TERMINAL_HISTORY_PAGE_BYTES,
              limitChunks: TERMINAL_HISTORY_PAGE_CHUNKS
            })
            if (
              runIdRef.current !== runId ||
              clientRef.current !== client ||
              terminalHistoryGenerationRef.current !== historyGeneration
            ) {
              result = 'stale'
              return
            }
            const returnedChars = history.chunks.reduce((total, chunk) => total + chunk.length, 0)
            fetchedPages += history.chunks.length > 0 ? 1 : 0
            fetchedChunks += history.chunks.length
            fetchedChars += returnedChars
            if (history.firstSeq > 0) {
              returnedFirstSeq =
                returnedFirstSeq > 0
                  ? Math.min(returnedFirstSeq, history.firstSeq)
                  : history.firstSeq
            }
            returnedLastSeq = Math.max(returnedLastSeq, history.lastSeq)
            latestSeq = history.latestSeq
            if (!cacheRemoteTerminalHistoryPage(prefetch, history)) {
              result = history.chunks.length > 0 ? 'invalid-page' : 'history-end'
              if (history.chunks.length > 0) {
                prefetch.hasMoreBefore = false
                throw new Error('invalid_terminal_history_page')
              }
              return
            }
          }
        } finally {
          appendDiagnostic('mobile', 'history-prefetch-batch', {
            handle: terminalHandle,
            result,
            requestedBeforeSeq,
            returnedFirstSeq,
            returnedLastSeq,
            fetchedPages,
            fetchedChunks,
            fetchedChars,
            cachedPages: prefetch.pages.length,
            cachedBytes: prefetch.cachedBytes,
            nextBeforeSeq: prefetch.nextBeforeSeq,
            pcRetainedFirstSeq: latestSeq > 0 ? prefetch.evictedBeforeSeq + 1 : 0,
            pcRetainedLastSeq: latestSeq,
            hasMoreBefore: prefetch.hasMoreBefore,
            gap: prefetch.gap,
            evictedBeforeSeq: prefetch.evictedBeforeSeq
          })
        }
      })().finally(() => {
        if (terminalHistoryPrefetchPromiseRef.current === request) {
          terminalHistoryPrefetchPromiseRef.current = null
        }
      })
      terminalHistoryPrefetchPromiseRef.current = request
      return request
    },
    [appendDiagnostic, paneId, terminalHandle, windowId]
  )

  const activatePrefetchedTerminalHistory = useCallback(
    async (
      trigger: 'initial' | 'history-top',
      maxPages = 1
    ): Promise<{ activated: boolean; activatedBytes: number } | null> => {
      const client = clientRef.current
      if (
        !client ||
        loadingOlderHistoryRef.current ||
        resyncingRef.current ||
        terminalRenderPausedRef.current
      ) {
        return null
      }
      const runId = runIdRef.current
      const historyGeneration = terminalHistoryGenerationRef.current
      const prefetch = terminalHistoryPrefetchRef.current
      const hadCachedPages = prefetch.pages.length > 0
      appendDiagnostic('mobile', 'history-activation-start', {
        handle: terminalHandle,
        trigger,
        cachedPages: prefetch.pages.length,
        cachedBytes: prefetch.cachedBytes,
        nextBeforeSeq: prefetch.nextBeforeSeq,
        hasMoreBefore: prefetch.hasMoreBefore
      })
      loadingOlderHistoryRef.current = true
      if (trigger === 'history-top' && activeHandleRef.current === terminalHandle) {
        setLoadingOlderHistory(true)
        setHistoryNotice(null)
      }
      try {
        if (!hadCachedPages && prefetch.hasMoreBefore) {
          await prefetchOlderTerminalHistory(TERMINAL_HISTORY_PAGE_BYTES)
        }
        if (
          runIdRef.current !== runId ||
          clientRef.current !== client ||
          terminalHistoryGenerationRef.current !== historyGeneration ||
          terminalRenderPausedRef.current
        ) {
          return null
        }

        const prefetched = takePrefetchedRemoteTerminalHistory(prefetch, { maxPages })
        const activatedBytes = prefetched.pages.reduce(
          (pageTotal, page) =>
            pageTotal + page.chunks.reduce((chunkTotal, chunk) => chunkTotal + chunk.length, 0),
          0
        )
        terminalHistoryRef.current.hasMoreBefore = prefetched.hasMoreBefore
        terminalHistoryRef.current.gap ||= prefetched.gap
        terminalHistoryRef.current.evictedBeforeSeq = Math.max(
          terminalHistoryRef.current.evictedBeforeSeq,
          prefetched.evictedBeforeSeq
        )
        if (prefetched.pages.length === 0) {
          appendDiagnostic('mobile', 'history-activation-result', {
            handle: terminalHandle,
            trigger,
            result: 'no-pages',
            historyFirstSeq: terminalHistoryRef.current.firstSeq,
            historyLastSeq: terminalHistoryRef.current.lastSeq,
            hasMoreBefore: prefetched.hasMoreBefore,
            gap: terminalHistoryRef.current.gap,
            evictedBeforeSeq: terminalHistoryRef.current.evictedBeforeSeq
          })
          if (
            trigger === 'history-top' &&
            !prefetched.hasMoreBefore &&
            activeHandleRef.current === terminalHandle
          ) {
            setHistoryNotice(terminalHistoryBoundaryMessage(terminalHistoryRef.current, t))
          }
          return { activated: false, activatedBytes: 0 }
        }

        let prependedCount = 0
        for (const page of prefetched.pages) {
          prependedCount += prependRemoteTerminalHistoryPage(
            terminalHistoryRef.current,
            page
          ).length
        }
        terminalHistoryRef.current.hasMoreBefore = prefetched.hasMoreBefore
        if (prependedCount === 0) {
          appendDiagnostic('mobile', 'history-activation-result', {
            handle: terminalHandle,
            trigger,
            result: 'overlap-only',
            pages: prefetched.pages.length,
            historyFirstSeq: terminalHistoryRef.current.firstSeq,
            historyLastSeq: terminalHistoryRef.current.lastSeq,
            hasMoreBefore: prefetched.hasMoreBefore,
            gap: terminalHistoryRef.current.gap,
            evictedBeforeSeq: terminalHistoryRef.current.evictedBeforeSeq
          })
          if (
            trigger === 'history-top' &&
            !prefetched.hasMoreBefore &&
            activeHandleRef.current === terminalHandle
          ) {
            setHistoryNotice(terminalHistoryBoundaryMessage(terminalHistoryRef.current, t))
          }
          return { activated: false, activatedBytes }
        }

        const viewport = viewportRef.current
        terminalRef.current?.init(
          viewport.cols,
          viewport.rows,
          buildTerminalInitialData(),
          true,
          undefined,
          true
        )
        await terminalRef.current?.awaitReady()
        appendDiagnostic('mobile', 'history-activation-result', {
          handle: terminalHandle,
          trigger,
          result: 'activated',
          pages: prefetched.pages.length,
          prependedChunks: prependedCount,
          historyFirstSeq: terminalHistoryRef.current.firstSeq,
          historyLastSeq: terminalHistoryRef.current.lastSeq,
          hasMoreBefore: prefetched.hasMoreBefore,
          gap: terminalHistoryRef.current.gap,
          evictedBeforeSeq: terminalHistoryRef.current.evictedBeforeSeq
        })
        if (
          runIdRef.current === runId &&
          clientRef.current === client &&
          terminalHistoryGenerationRef.current === historyGeneration &&
          prefetch.hasMoreBefore
        ) {
          void prefetchOlderTerminalHistory().catch(() => {})
        }
        return { activated: true, activatedBytes }
      } finally {
        if (runIdRef.current === runId && clientRef.current === client) {
          loadingOlderHistoryRef.current = false
          if (activeHandleRef.current === terminalHandle) {
            setLoadingOlderHistory(false)
          }
        }
      }
    },
    [appendDiagnostic, buildTerminalInitialData, prefetchOlderTerminalHistory, t, terminalHandle]
  )

  const hydrateInitialTerminalHistory = useCallback((): Promise<void> => {
    const existing = initialHistoryHydrationPromiseRef.current
    if (existing) {
      return existing
    }
    const client = clientRef.current
    if (!client) {
      return Promise.resolve()
    }
    const runId = runIdRef.current
    const historyGeneration = terminalHistoryGenerationRef.current
    let request: Promise<void>
    request = (async () => {
      await new Promise((resolve) => setTimeout(resolve, INITIAL_TERMINAL_HISTORY_DELAY_MS))
      while (
        runIdRef.current === runId &&
        clientRef.current === client &&
        terminalHistoryGenerationRef.current === historyGeneration &&
        !terminalRenderPausedRef.current &&
        activeHandleRef.current === terminalHandle
      ) {
        const prefetch = terminalHistoryPrefetchRef.current
        const hasMoreBefore = prefetch.pages.length > 0 || prefetch.hasMoreBefore
        if (
          !shouldLoadInitialTerminalHistory({
            metrics: terminalHistoryMetricsRef.current,
            stages: initialHistoryStagesRef.current,
            activatedBytes: initialHistoryActivatedBytesRef.current,
            hasMoreBefore
          })
        ) {
          break
        }
        const result = await activatePrefetchedTerminalHistory('initial', 1)
        if (!result) {
          break
        }
        initialHistoryStagesRef.current += 1
        initialHistoryActivatedBytesRef.current += result.activatedBytes
        if (!result.activated) {
          break
        }
        await new Promise((resolve) => setTimeout(resolve, INITIAL_TERMINAL_HISTORY_DELAY_MS))
      }
      appendDiagnostic('mobile', 'initial-history-hydration', {
        handle: terminalHandle,
        stages: initialHistoryStagesRef.current,
        activatedBytes: initialHistoryActivatedBytesRef.current,
        scrollbackRows: terminalHistoryMetricsRef.current?.scrollbackRows ?? 0,
        nonEmptyScrollbackRows: terminalHistoryMetricsRef.current?.nonEmptyScrollbackRows ?? 0
      })
    })().finally(() => {
      if (initialHistoryHydrationPromiseRef.current === request) {
        initialHistoryHydrationPromiseRef.current = null
      }
    })
    initialHistoryHydrationPromiseRef.current = request
    return request
  }, [
    activatePrefetchedTerminalHistory,
    appendDiagnostic,
    initialHistoryActivatedBytesRef,
    initialHistoryHydrationPromiseRef,
    initialHistoryStagesRef,
    terminalHandle,
    terminalHistoryMetricsRef
  ])

  const resumeInitialHistoryHydration = useCallback(async (): Promise<void> => {
    const pending = initialHistoryHydrationPromiseRef.current
    if (pending) {
      try {
        await pending
      } catch {}
    }
    if (terminalRenderPausedRef.current) {
      return
    }
    await hydrateInitialTerminalHistory()
  }, [hydrateInitialTerminalHistory, initialHistoryHydrationPromiseRef, terminalRenderPausedRef])
  resumeInitialHistoryHydrationRef.current = resumeInitialHistoryHydration

  const syncTerminalIncrement = useCallback(async () => {
    const client = clientRef.current
    if (!client || loading || resyncingRef.current || terminalIncrementSyncInFlightRef.current) {
      return
    }
    const runId = runIdRef.current
    const historyGeneration = terminalHistoryGenerationRef.current
    let continueImmediately = false
    terminalIncrementSyncInFlightRef.current = true
    const reloadSnapshotForCurrentRun = async () => {
      terminalHistoryGenerationRef.current += 1
      resetRemoteTerminalHistoryState(terminalHistoryRef.current)
      resetRemoteTerminalHistoryPrefetchState(terminalHistoryPrefetchRef.current)
      terminalHistoryPrefetchPromiseRef.current = null
      terminalInitializedRef.current = false
      const snapshot = await startTerminalSubscription(client, runId, { sinceSeq: 0 })
      if (!snapshot || runIdRef.current !== runId || clientRef.current !== client) {
        return false
      }
      setTerminalRunning(true)
      void hydrateInitialTerminalHistory().catch(() => {})
      return true
    }
    try {
      for (let page = 0; page < TERMINAL_INCREMENTAL_SYNC_PAGE_LIMIT; page += 1) {
        const sinceSeq = terminalHistoryRef.current.lastSeq
        const history = await requestTerminalHistory(client, windowId, paneId, {
          sinceSeq,
          limitBytes: TERMINAL_HISTORY_PAGE_BYTES,
          limitChunks: TERMINAL_HISTORY_PAGE_CHUNKS
        })
        if (
          runIdRef.current !== runId ||
          clientRef.current !== client ||
          terminalHistoryGenerationRef.current !== historyGeneration
        ) {
          return
        }
        updateTerminalViewportFromDesktop(history)
        if (history.gap) {
          if (resyncingRef.current) {
            return
          }
          resyncingRef.current = true
          if (activeHandleRef.current === terminalHandle) {
            setLoading(true)
          }
          try {
            await reloadSnapshotForCurrentRun()
          } finally {
            if (runIdRef.current === runId && clientRef.current === client) {
              resyncingRef.current = false
              if (activeHandleRef.current === terminalHandle) {
                setLoading(false)
              }
            }
          }
          return
        }
        const appended = appendRemoteTerminalHistoryIncrement(terminalHistoryRef.current, history)
        if (appended.overflowed) {
          if (resyncingRef.current) {
            return
          }
          resyncingRef.current = true
          if (activeHandleRef.current === terminalHandle) {
            setLoading(true)
          }
          try {
            await reloadSnapshotForCurrentRun()
          } finally {
            if (runIdRef.current === runId && clientRef.current === client) {
              resyncingRef.current = false
              if (activeHandleRef.current === terminalHandle) {
                setLoading(false)
              }
            }
          }
          return
        }
        if (appended.data) {
          if (!terminalRenderPausedRef.current) {
            terminalRef.current?.write(appended.data)
            terminalRenderedSeqRef.current = terminalHistoryRef.current.lastSeq
          }
        }
        terminalPendingOverflowedRef.current ||= appended.overflowed
        updateTerminalSubscriptionCursor()
        if (
          terminalHistoryRef.current.lastSeq <= sinceSeq ||
          (history.chunks.length === 0 && !appended.needsHistorySync)
        ) {
          return
        }
      }
      continueImmediately = true
    } catch (err) {
      if (runIdRef.current !== runId || clientRef.current !== client) {
        return
      }
      const message = err instanceof Error ? err.message : String(err)
      if (/terminal not found|terminal_not_found/i.test(message)) {
        stopTerminalSubscription()
        currentPaneRuntimeKeyRef.current = null
        setTerminalRunning(false)
        setError(t('terminal.stoppedOnDesktop'))
      }
    } finally {
      if (runIdRef.current === runId && clientRef.current === client) {
        terminalIncrementSyncInFlightRef.current = false
        if (continueImmediately) {
          setTimeout(() => {
            void syncTerminalIncrementRef.current?.()
          }, 0)
        }
      }
    }
  }, [
    loading,
    paneId,
    hydrateInitialTerminalHistory,
    startTerminalSubscription,
    stopTerminalSubscription,
    t,
    updateTerminalSubscriptionCursor,
    updateTerminalViewportFromDesktop,
    windowId,
    terminalHandle
  ])
  syncTerminalIncrementRef.current = syncTerminalIncrement

  const clearForegroundRecoveryRetry = useCallback(() => {
    clearRemoteTerminalForegroundRecoveryRetry(sessionRuntime)
  }, [sessionRuntime])

  const scheduleForegroundRecoveryRetry = useCallback(
    (expectedRunId: number, expectedClient: RpcClient) => {
      if (foregroundRecoveryRetryTimerRef.current) {
        return
      }
      const attempt = foregroundRecoveryRetryAttemptRef.current
      const delayMs = remoteTerminalForegroundRetryDelay(attempt)
      foregroundRecoveryRetryAttemptRef.current = attempt + 1
      appendDiagnostic('mobile', 'foreground-recovery-retry', {
        handle: terminalHandle,
        attempt: attempt + 1,
        delayMs
      })
      foregroundRecoveryRetryTimerRef.current = setTimeout(() => {
        foregroundRecoveryRetryTimerRef.current = null
        if (
          runIdRef.current !== expectedRunId ||
          clientRef.current !== expectedClient ||
          AppState.currentState !== 'active' ||
          !screenFocusedRef.current ||
          activeHandleRef.current !== terminalHandle ||
          !foregroundRecoveryRequestedRef.current
        ) {
          return
        }
        void recoverTerminalAfterForegroundRef.current?.()
      }, delayMs)
    },
    [
      appendDiagnostic,
      foregroundRecoveryRequestedRef,
      foregroundRecoveryRetryAttemptRef,
      foregroundRecoveryRetryTimerRef,
      terminalHandle
    ]
  )

  const recoverTerminalAfterForeground = useCallback(async () => {
    const client = clientRef.current
    if (
      !foregroundRecoveryRequestedRef.current ||
      foregroundRecoveryInFlightRef.current ||
      !client ||
      connectionState !== 'connected' ||
      loading
    ) {
      return
    }
    const runId = runIdRef.current
    const historyGeneration = terminalHistoryGenerationRef.current
    foregroundRecoveryInFlightRef.current = true
    try {
      const renderedSeq = terminalRenderedSeqRef.current
      const history = await requestTerminalHistory(client, windowId, paneId, {
        sinceSeq: renderedSeq,
        limitBytes: TERMINAL_FOREGROUND_SMALL_DELTA_BYTES,
        limitChunks: TERMINAL_HISTORY_PAGE_CHUNKS
      })
      if (
        runIdRef.current !== runId ||
        clientRef.current !== client ||
        terminalHistoryGenerationRef.current !== historyGeneration
      ) {
        return
      }
      const appended = appendRemoteTerminalHistoryIncrement(terminalHistoryRef.current, history)
      terminalPendingOverflowedRef.current ||= appended.overflowed
      updateTerminalSubscriptionCursor()
      const decision = decideRemoteTerminalForegroundRecovery({
        renderedSeq,
        receivedSeq: terminalHistoryRef.current.lastSeq,
        latestSeq: history.latestSeq,
        deltaBytes: history.chunks.reduce((total, chunk) => total + chunk.length, 0),
        gap: history.gap,
        hasMoreAfter: history.hasMoreAfter,
        pendingOverflowed: terminalPendingOverflowedRef.current
      })

      if (decision === 'compact-snapshot') {
        terminalHistoryGenerationRef.current += 1
        resetRemoteTerminalHistoryState(terminalHistoryRef.current)
        resetRemoteTerminalHistoryPrefetchState(terminalHistoryPrefetchRef.current)
        terminalHistoryPrefetchPromiseRef.current = null
        initialHistoryHydrationPromiseRef.current = null
        initialHistoryStagesRef.current = 0
        initialHistoryActivatedBytesRef.current = 0
        terminalHistoryMetricsRef.current = null
        terminalInitializedRef.current = false
        terminalPendingOverflowedRef.current = false
        terminalRenderPausedRef.current = false
        const snapshot = await startTerminalSubscription(client, runId, { sinceSeq: 0 })
        if (!snapshot || runIdRef.current !== runId || clientRef.current !== client) {
          return
        }
        terminalRenderedSeqRef.current = terminalHistoryRef.current.lastSeq
        void hydrateInitialTerminalHistory().catch(() => {})
      } else if (decision === 'coalesced-write') {
        const viewport = viewportRef.current
        terminalRef.current?.init(
          viewport.cols,
          viewport.rows,
          buildTerminalInitialData(),
          true,
          undefined,
          true
        )
        terminalRenderedSeqRef.current = terminalHistoryRef.current.lastSeq
        terminalRenderPausedRef.current = false
        await terminalRef.current?.awaitReady()
      } else {
        terminalRenderPausedRef.current = false
      }
      terminalPendingOverflowedRef.current = false
      foregroundRecoveryRequestedRef.current = false
      clearForegroundRecoveryRetry()
    } catch (err) {
      if (runIdRef.current === runId && clientRef.current === client) {
        const message = err instanceof Error ? err.message : String(err)
        if (/terminal not found|terminal_not_found/i.test(message)) {
          terminalRenderPausedRef.current = false
          foregroundRecoveryRequestedRef.current = false
          setTerminalRunning(false)
          setError(t('terminal.stoppedOnDesktop'))
          clearForegroundRecoveryRetry()
        } else {
          terminalRenderPausedRef.current = true
          foregroundRecoveryRequestedRef.current = true
          scheduleForegroundRecoveryRetry(runId, client)
        }
      }
    } finally {
      if (runIdRef.current === runId && clientRef.current === client) {
        foregroundRecoveryInFlightRef.current = false
      }
    }
  }, [
    buildTerminalInitialData,
    clearForegroundRecoveryRetry,
    connectionState,
    loading,
    paneId,
    scheduleForegroundRecoveryRetry,
    hydrateInitialTerminalHistory,
    startTerminalSubscription,
    t,
    updateTerminalSubscriptionCursor,
    windowId
  ])
  recoverTerminalAfterForegroundRef.current = recoverTerminalAfterForeground

  const reloadCurrentTerminalStream = useCallback(
    async (client: RpcClient) => {
      if (resyncingRef.current) {
        return
      }
      const runId = runIdRef.current
      resyncingRef.current = true
      if (activeHandleRef.current === terminalHandle) {
        setLoading(true)
        setError(null)
      }
      terminalHistoryGenerationRef.current += 1
      resetRemoteTerminalHistoryState(terminalHistoryRef.current)
      resetRemoteTerminalHistoryPrefetchState(terminalHistoryPrefetchRef.current)
      terminalHistoryPrefetchPromiseRef.current = null
      terminalInitializedRef.current = false
      try {
        const snapshot = await startTerminalSubscription(client, runId, { sinceSeq: 0 })
        if (!snapshot || runIdRef.current !== runId || clientRef.current !== client) {
          return
        }
        if (activeHandleRef.current === terminalHandle) {
          setTerminalRunning(true)
        }
        void hydrateInitialTerminalHistory().catch(() => {})
      } catch (err) {
        if (
          runIdRef.current === runId &&
          clientRef.current === client &&
          activeHandleRef.current === terminalHandle
        ) {
          setError(terminalErrorMessage(err, t))
        }
      } finally {
        if (runIdRef.current === runId && clientRef.current === client) {
          if (activeHandleRef.current === terminalHandle) {
            setLoading(false)
          }
          resyncingRef.current = false
        }
      }
    },
    [hydrateInitialTerminalHistory, startTerminalSubscription, t, terminalHandle]
  )

  const syncPaneStatus = useCallback(async () => {
    const client = clientRef.current
    if (!client || paneStatusSyncInFlightRef.current) {
      return
    }
    const runId = runIdRef.current
    paneStatusSyncInFlightRef.current = true
    try {
      const currentPane = await loadWindowPaneTabs(client, runId)
      if (runIdRef.current !== runId || clientRef.current !== client) {
        return
      }
      if (currentPane === undefined) {
        return
      }
      if (currentPane === null) {
        currentPaneRuntimeKeyRef.current = null
        stopTerminalSubscription()
        if (activeHandleRef.current === terminalHandle) {
          setTerminalRunning(false)
          setError(t('terminal.stoppedOnDesktop'))
        }
        return
      }
      const runtimeKey = terminalPaneRuntimeKey(currentPane)
      const previousRuntimeKey = currentPaneRuntimeKeyRef.current
      currentPaneRuntimeKeyRef.current = runtimeKey
      if (!currentPane.running) {
        stopTerminalSubscription()
        if (activeHandleRef.current === terminalHandle) {
          setTerminalRunning(false)
          setError(t('terminal.stoppedOnDesktop'))
        }
        return
      }
      if (
        !terminalRunning ||
        (previousRuntimeKey && runtimeKey && previousRuntimeKey !== runtimeKey)
      ) {
        await reloadCurrentTerminalStream(client)
      }
    } finally {
      if (runIdRef.current === runId && clientRef.current === client) {
        paneStatusSyncInFlightRef.current = false
      }
    }
  }, [
    loadWindowPaneTabs,
    reloadCurrentTerminalStream,
    stopTerminalSubscription,
    t,
    terminalHandle,
    terminalRunning
  ])
  syncPaneStatusRef.current = syncPaneStatus

  const openTerminal = useCallback(async () => {
    const runId = runIdRef.current
    if (terminalInitializedRef.current && unsubscribeRef.current && clientRef.current) {
      setLoading(false)
      setError(null)
      setTerminalRunning(true)
      setLoadingOlderHistory(false)
      setHistoryNotice(null)
      refitTerminalToPhone()
      void syncPaneStatusRef.current?.()
      if (terminalRenderPausedRef.current) {
        foregroundRecoveryRequestedRef.current = true
        void recoverTerminalAfterForegroundRef.current?.()
      }
      void hydrateInitialTerminalHistory().catch(() => {})
      return
    }
    setLoading(true)
    setError(null)
    setStartingTabPaneKey(null)
    tabDeleteModeRef.current = null
    suppressNextTabPressRef.current = false
    setTabDeleteMode(null)
    setDeletingTabKey(null)
    setStopping(false)
    setTerminalRunning(true)
    setTerminalKeyboardMetrics(null)
    setLoadingOlderHistory(false)
    setHistoryNotice(null)
    resetRemoteTerminalHistoryState(terminalHistoryRef.current)
    resetRemoteTerminalHistoryPrefetchState(terminalHistoryPrefetchRef.current)
    terminalInitializedRef.current = false
    loadingOlderHistoryRef.current = false
    currentPaneRuntimeKeyRef.current = null
    desktopViewportRef.current = { cols: DEFAULT_COLS, rows: DEFAULT_ROWS }
    viewportRef.current = resolveMobileTerminalViewport(desktopViewportRef.current)

    try {
      let client = clientRef.current
      if (!client) {
        setConnectionState('loading')
        logsRef.current = []
        setLogs([])
        const loadedHost = await loadHostById(hostId)
        if (!loadedHost) {
          throw new Error(t('terminal.hostNotFound'))
        }
        if (runIdRef.current !== runId) {
          return
        }
        client = connectToHost(loadedHost, {
          onStateChange: (state) => {
            if (runIdRef.current === runId) {
              setConnectionState(state)
              setError((current) => terminalErrorAfterConnectionState(current, state))
              appendDiagnostic('network', 'connection-state', {
                state,
                transport: loadedHost.relayEndpoint ? 'relay' : 'direct'
              })
            }
          },
          onLog: (entry) => {
            if (runIdRef.current === runId) {
              appendLog(entry)
            }
          }
        })
        clientRef.current = client
      }
      const currentPane = await loadWindowPaneTabs(client, runId)
      if (runIdRef.current !== runId || clientRef.current !== client) {
        return
      }
      currentPaneRuntimeKeyRef.current = terminalPaneRuntimeKey(currentPane)

      const snapshot = await startTerminalSubscription(client, runId)
      if (!snapshot || runIdRef.current !== runId || clientRef.current !== client) {
        return
      }

      if (activeHandleRef.current === terminalHandle) {
        setLoading(false)
      }
      void hydrateInitialTerminalHistory().catch(() => {})
    } catch (err) {
      if (runIdRef.current !== runId) {
        return
      }
      if (activeHandleRef.current === terminalHandle) {
        setError(terminalErrorMessage(err, t))
        setLoading(false)
      }
    }
  }, [
    appendLog,
    appendDiagnostic,
    hostId,
    loadWindowPaneTabs,
    hydrateInitialTerminalHistory,
    refitTerminalToPhone,
    sessionRuntime,
    startTerminalSubscription,
    t,
    terminalHandle
  ])
  openTerminalRef.current = openTerminal

  useFocusEffect(
    useCallback(() => {
      screenFocusedRef.current = true
      lastOpenedHandleRef.current = activeHandleRef.current
      const keyboardMetrics = Keyboard.metrics()
      setKeyboardHeight(Keyboard.isVisible() ? Math.max(0, keyboardMetrics?.height ?? 0) : 0)
      void openTerminalRef.current?.()
      const subscription = AppState.addEventListener('change', (state) => {
        appendDiagnostic('mobile', 'app-state', { state })
        if (state !== 'active') {
          for (const runtime of sessionRuntimesRef.current.values()) {
            runtime.terminalRenderPausedRef.current = true
            runtime.foregroundRecoveryRequestedRef.current = false
            clearRemoteTerminalForegroundRecoveryRetry(runtime)
          }
          liveInputRef.current?.blur()
          Keyboard.dismiss()
          setKeyboardHeight(0)
          cancelKeyboardViewportRestore()
          resetTerminalOneShotModifiers()
          flushDiagnosticsPersistence()
          return
        }
        const activeRuntime = activeHandleRef.current
          ? sessionRuntimesRef.current.get(activeHandleRef.current)
          : null
        if (activeRuntime) {
          clearRemoteTerminalForegroundRecoveryRetry(activeRuntime)
          activeRuntime.foregroundRecoveryRequestedRef.current = true
        }
        clientRef.current?.notifyForeground()
        if (Keyboard.isVisible()) {
          cancelKeyboardViewportRestore()
          setKeyboardHeight(Math.max(0, Keyboard.metrics()?.height ?? 0))
        } else {
          restoreTerminalAfterKeyboard()
        }
        setTimeout(() => {
          const runtime = activeHandleRef.current
            ? sessionRuntimesRef.current.get(activeHandleRef.current)
            : null
          runtime?.terminalRef.current?.restoreForeground()
          void (async () => {
            await runtime?.recoverTerminalAfterForegroundRef.current?.()
            await runtime?.resumeInitialHistoryHydrationRef.current?.()
          })().catch(() => {})
        }, 150)
      })
      return () => {
        screenFocusedRef.current = false
        subscription.remove()
        liveInputRef.current?.blur()
        Keyboard.dismiss()
        resetTerminalOneShotModifiers()
        cleanup()
      }
    }, [
      cancelKeyboardViewportRestore,
      appendDiagnostic,
      cleanup,
      flushDiagnosticsPersistence,
      resetTerminalOneShotModifiers,
      restoreTerminalAfterKeyboard
    ])
  )

  useEffect(() => {
    resetTerminalOneShotModifiers()
    if (!screenFocusedRef.current || lastOpenedHandleRef.current === terminalHandle) {
      return
    }
    lastOpenedHandleRef.current = terminalHandle
    void openTerminalRef.current?.()
  }, [resetTerminalOneShotModifiers, terminalHandle])

  useEffect(() => {
    if (connectionState === 'connected' && foregroundRecoveryRequestedRef.current) {
      void recoverTerminalAfterForeground()
    }
  }, [connectionState, recoverTerminalAfterForeground])

  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        if (!tabDeleteModeRef.current) {
          return false
        }
        exitTabDeleteMode()
        return true
      })
      return () => subscription.remove()
    }, [exitTabDeleteMode])
  )

  useEffect(() => {
    if (tabDeleteMode && tabDeleteMode !== currentTabMode) {
      exitTabDeleteMode()
    }
  }, [currentTabMode, exitTabDeleteMode, tabDeleteMode])

  const handleTerminalInput = useCallback(
    (bytes: string) => {
      const client = clientRef.current
      if (!client) {
        return
      }
      const runId = runIdRef.current
      void sendTerminalInput(client, windowId, paneId, bytes).catch((err) => {
        if (runIdRef.current === runId && clientRef.current === client) {
          setError(terminalErrorMessage(err, t))
        }
      })
    },
    [paneId, t, windowId]
  )

  const handleClear = useCallback(async () => {
    const client = clientRef.current
    if (!client) {
      return
    }
    const runId = runIdRef.current
    try {
      const result = await clearTerminal(client, windowId, paneId)
      if (runIdRef.current !== runId || clientRef.current !== client) {
        return
      }
      if (result.windowId === windowId && result.paneId === paneId) {
        terminalHistoryGenerationRef.current += 1
        resetRemoteTerminalHistoryState(terminalHistoryRef.current)
        resetRemoteTerminalHistoryPrefetchState(terminalHistoryPrefetchRef.current)
        terminalHistoryPrefetchPromiseRef.current = null
        initialHistoryHydrationPromiseRef.current = null
        initialHistoryStagesRef.current = 0
        initialHistoryActivatedBytesRef.current = 0
        terminalHistoryMetricsRef.current = null
        terminalHistoryRef.current.lastSeq = result.lastSeq
        terminalHistoryRef.current.firstSeq = result.lastSeq + 1
        terminalRenderedSeqRef.current = result.lastSeq
        terminalPendingOverflowedRef.current = false
        updateTerminalSubscriptionCursor()
      }
      setHistoryNotice(null)
      terminalRef.current?.clear()
    } catch (err) {
      if (runIdRef.current === runId && clientRef.current === client) {
        setError(terminalErrorMessage(err, t))
      }
    }
  }, [paneId, t, updateTerminalSubscriptionCursor, windowId])

  const handleStop = useCallback(async () => {
    const client = clientRef.current
    if (!client || stopping) {
      return
    }
    const runId = runIdRef.current
    setStopping(true)
    setError(null)
    try {
      await stopRemotePane(client, windowId, paneId)
      if (runIdRef.current !== runId || clientRef.current !== client) {
        return
      }
      currentPaneRuntimeKeyRef.current = null
      setTerminalRunning(false)
      setError(t('terminal.stopped'))
      router.replace(`/h/${hostId}`)
    } catch (err) {
      if (runIdRef.current === runId && clientRef.current === client) {
        setError(terminalErrorMessage(err, t))
      }
    } finally {
      if (runIdRef.current === runId && clientRef.current === client) {
        setStopping(false)
      }
    }
  }, [hostId, paneId, router, stopping, t, windowId])

  const activateTerminalTarget = useCallback(
    (targetWindowId: string, targetPaneId: string) => {
      const targetHandle = `${targetWindowId}:${targetPaneId}`
      let runtime = sessionRuntimesRef.current.get(targetHandle)
      if (!runtime) {
        runtime = createRemoteTerminalSessionRuntime(targetWindowId, targetPaneId)
        sessionRuntimesRef.current.set(targetHandle, runtime)
      }
      runtime.lastUsedAt = Date.now()

      const residency = selectRemoteTerminalResidentSessions({
        residentHandles: residentTerminalHandles,
        targetHandle,
        activeHandle: activeHandleRef.current,
        lastUsedAt: new Map(
          Array.from(sessionRuntimesRef.current, ([handle, item]) => [handle, item.lastUsedAt])
        ),
        limit: DEFAULT_REMOTE_TERMINAL_RESIDENT_LIMIT
      })
      if (residency.evictedHandle) {
        const evicted = sessionRuntimesRef.current.get(residency.evictedHandle)
        if (evicted) {
          evicted.terminalSubscriptionGenerationRef.current += 1
          evicted.terminalHistoryGenerationRef.current += 1
          evicted.unsubscribeRef.current?.()
          evicted.unsubscribeRef.current = null
          evicted.terminalSubscribeParamsRef.current = null
          evicted.terminalInitializedRef.current = false
          evicted.terminalWebReadyRef.current = false
          evicted.resumeInitialHistoryHydrationRef.current = null
          clearRemoteTerminalForegroundRecoveryRetry(evicted)
        }
      }
      setResidentTerminalHandles(residency.handles)
      setLoadingOlderHistory(false)
      setHistoryNotice(null)
      activeHandleRef.current = targetHandle
      setActiveTerminal({ windowId: targetWindowId, paneId: targetPaneId })
    },
    [residentTerminalHandles]
  )

  const navigateToReplacementPane = useCallback(
    async (client: RpcClient, replacementPane: RemotePaneSummary | null, expectedRunId: number) => {
      if (!replacementPane) {
        router.replace(`/h/${hostId}`)
        return
      }

      let targetPane = replacementPane
      if (!targetPane.running) {
        if (!isStartableTerminalPane(targetPane)) {
          if (runIdRef.current === expectedRunId && clientRef.current === client) {
            setError(t('terminal.restartUnavailable'))
            router.replace(`/h/${hostId}`)
          }
          return
        }
        let startResult: Awaited<ReturnType<typeof startRemoteWindow>>
        try {
          startResult = await startRemoteWindow(
            client,
            targetPane.windowId,
            targetPane.paneId,
            viewportRef.current
          )
        } catch (err) {
          if (runIdRef.current === expectedRunId && clientRef.current === client) {
            setError(terminalErrorMessage(err, t))
            router.replace(`/h/${hostId}`)
          }
          return
        }
        if (runIdRef.current !== expectedRunId || clientRef.current !== client) {
          return
        }
        targetPane =
          startResult.pane ??
          startResult.window.panes.find((pane) => pane.paneId === targetPane.paneId) ??
          targetPane
      }

      if (runIdRef.current !== expectedRunId || clientRef.current !== client) {
        return
      }
      activateTerminalTarget(targetPane.windowId, targetPane.paneId)
    },
    [activateTerminalTarget, hostId, router, t]
  )

  const disposeTerminalRuntime = useCallback((handle: string) => {
    const runtime = sessionRuntimesRef.current.get(handle)
    if (runtime) {
      runtime.terminalSubscriptionGenerationRef.current += 1
      runtime.terminalHistoryGenerationRef.current += 1
      runtime.unsubscribeRef.current?.()
      runtime.unsubscribeRef.current = null
      runtime.resumeInitialHistoryHydrationRef.current = null
      sessionRuntimesRef.current.delete(handle)
    }
    setResidentTerminalHandles((handles) => handles.filter((item) => item !== handle))
  }, [])

  const handleDeletePaneTab = useCallback(
    async (pane: RemotePaneSummary) => {
      const client = clientRef.current
      if (!client || deletingTabKey) {
        return
      }
      const runId = runIdRef.current
      const tabKey = `pane:${pane.windowId}:${pane.paneId}`
      setDeletingTabKey(tabKey)
      setError(null)
      try {
        const result = await deleteRemotePane(client, pane.windowId, pane.paneId)
        if (runIdRef.current !== runId || clientRef.current !== client) {
          return
        }

        disposeTerminalRuntime(`${pane.windowId}:${pane.paneId}`)

        if (pane.windowId === windowId && pane.paneId === paneId) {
          exitTabDeleteMode()
          await navigateToReplacementPane(client, result.replacementPane, runId)
          return
        }

        const nextPanes = result.window.panes.filter((item) => item.kind === 'terminal')
        setWindowPanes(nextPanes)
        if (nextPanes.length <= 1) {
          exitTabDeleteMode()
        }
        await loadWindowPaneTabs(client, runId)
      } catch (err) {
        if (runIdRef.current === runId && clientRef.current === client) {
          setError(terminalErrorMessage(err, t))
          await loadWindowPaneTabs(client, runId)
        }
      } finally {
        if (runIdRef.current === runId && clientRef.current === client) {
          setDeletingTabKey(null)
        }
      }
    },
    [
      deletingTabKey,
      disposeTerminalRuntime,
      exitTabDeleteMode,
      loadWindowPaneTabs,
      navigateToReplacementPane,
      paneId,
      t,
      windowId
    ]
  )

  const confirmPaneTabDeletion = useCallback(
    (pane: RemotePaneSummary) => {
      if (deletingTabKey) {
        return
      }
      Alert.alert(
        t('terminal.deletePaneTitle'),
        t('terminal.deletePaneMessage'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('terminal.deletePaneAction'),
            style: 'destructive',
            onPress: () => void handleDeletePaneTab(pane)
          }
        ]
      )
    },
    [deletingTabKey, handleDeletePaneTab, t]
  )

  const handleRemoveGroupWindowTab = useCallback(
    async (groupWindow: RemoteWindowGroupSummary['windows'][number]) => {
      const client = clientRef.current
      const groupId = currentGroupId
      if (!client || !groupId || deletingTabKey) {
        if (!groupId) {
          setError(t('terminal.groupChanged'))
        }
        return
      }
      const runId = runIdRef.current
      const tabKey = `group:${groupWindow.windowId}`
      setDeletingTabKey(tabKey)
      setError(null)
      try {
        const result = await removeRemoteWindowFromGroup(client, groupId, groupWindow.windowId)
        if (runIdRef.current !== runId || clientRef.current !== client) {
          return
        }

        for (const [handle, runtime] of sessionRuntimesRef.current) {
          if (runtime.windowId === groupWindow.windowId) {
            disposeTerminalRuntime(handle)
          }
        }

        if (groupWindow.windowId === windowId) {
          exitTabDeleteMode()
          await navigateToReplacementPane(client, result.replacementPane, runId)
          return
        }

        setCurrentGroupId(result.group?.groupId ?? null)
        setGroupWindowTabs(result.group?.windows ?? [])
        if (!result.group || result.group.windows.length <= 1) {
          exitTabDeleteMode()
        }
        await loadWindowPaneTabs(client, runId)
      } catch (err) {
        if (runIdRef.current === runId && clientRef.current === client) {
          setError(terminalErrorMessage(err, t))
          await loadWindowPaneTabs(client, runId)
        }
      } finally {
        if (runIdRef.current === runId && clientRef.current === client) {
          setDeletingTabKey(null)
        }
      }
    },
    [
      currentGroupId,
      deletingTabKey,
      disposeTerminalRuntime,
      exitTabDeleteMode,
      loadWindowPaneTabs,
      navigateToReplacementPane,
      t,
      windowId
    ]
  )

  const confirmGroupWindowRemoval = useCallback(
    (groupWindow: RemoteWindowGroupSummary['windows'][number]) => {
      if (deletingTabKey) {
        return
      }
      Alert.alert(
        t('terminal.removeGroupWindowTitle'),
        t('terminal.removeGroupWindowMessage'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('terminal.removeGroupWindowAction'),
            style: 'destructive',
            onPress: () => void handleRemoveGroupWindowTab(groupWindow)
          }
        ]
      )
    },
    [deletingTabKey, handleRemoveGroupWindowTab, t]
  )

  const handlePaneTabPress = useCallback(
    async (pane: RemotePaneSummary) => {
      if (pane.paneId === paneId) {
        return
      }
      if (pane.running) {
        activateTerminalTarget(pane.windowId, pane.paneId)
        return
      }
      if (!isStartableTerminalPane(pane)) {
        setError(t('terminal.restartUnavailable'))
        return
      }
      const client = clientRef.current
      if (!client) {
        setError(t('terminal.notConnected'))
        return
      }
      const runId = runIdRef.current
      const paneKey = `${pane.windowId}:${pane.paneId}`
      setStartingTabPaneKey(paneKey)
      setError(null)
      try {
        await startRemoteWindow(client, pane.windowId, pane.paneId, viewportRef.current)
        if (runIdRef.current !== runId || clientRef.current !== client) {
          return
        }
        await loadWindowPaneTabs(client, runId)
        if (runIdRef.current !== runId || clientRef.current !== client) {
          return
        }
        activateTerminalTarget(pane.windowId, pane.paneId)
      } catch (err) {
        if (runIdRef.current === runId && clientRef.current === client) {
          setError(terminalErrorMessage(err, t))
        }
      } finally {
        if (runIdRef.current === runId && clientRef.current === client) {
          setStartingTabPaneKey(null)
        }
      }
    },
    [activateTerminalTarget, loadWindowPaneTabs, paneId, t]
  )

  const handleGroupWindowTabPress = useCallback(
    async (window: RemoteWindowGroupSummary['windows'][number]) => {
      if (window.windowId === windowId) {
        return
      }
      const pane = getActiveTerminalPane(window.panes, window.activePaneId)
      if (!pane) {
        return
      }
      if (pane.running) {
        activateTerminalTarget(pane.windowId, pane.paneId)
        return
      }
      if (!isStartableTerminalPane(pane)) {
        setError(t('terminal.restartUnavailable'))
        return
      }
      const client = clientRef.current
      if (!client) {
        setError(t('terminal.notConnected'))
        return
      }
      const runId = runIdRef.current
      const paneKey = `${pane.windowId}:${pane.paneId}`
      setStartingTabPaneKey(paneKey)
      setError(null)
      try {
        await startRemoteWindow(client, pane.windowId, pane.paneId, viewportRef.current)
        if (runIdRef.current !== runId || clientRef.current !== client) {
          return
        }
        await loadWindowPaneTabs(client, runId)
        if (runIdRef.current !== runId || clientRef.current !== client) {
          return
        }
        activateTerminalTarget(pane.windowId, pane.paneId)
      } catch (err) {
        if (runIdRef.current === runId && clientRef.current === client) {
          setError(terminalErrorMessage(err, t))
        }
      } finally {
        if (runIdRef.current === runId && clientRef.current === client) {
          setStartingTabPaneKey(null)
        }
      }
    },
    [activateTerminalTarget, loadWindowPaneTabs, t, windowId]
  )

  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const nextHeight = Math.max(0, event.nativeEvent.layout.height)
      setTerminalFrameHeight((current) => (current === nextHeight ? current : nextHeight))
      refitTerminalToPhone()
    },
    [refitTerminalToPhone]
  )

  const handleKeyboardAvoidanceMetrics = useCallback(
    (metrics: TerminalKeyboardAvoidanceMetrics) => {
      setTerminalKeyboardMetrics((current) => {
        if (
          current &&
          current.cursorY === metrics.cursorY &&
          current.rows === metrics.rows &&
          current.altScreen === metrics.altScreen &&
          current.cursorBottomPx === metrics.cursorBottomPx &&
          current.rowHeightPx === metrics.rowHeightPx
        ) {
          return current
        }
        return metrics
      })
    },
    []
  )

  const handleMobileReflowRefreshRequest = useCallback((targetHandle: string) => {
    const runtime = sessionRuntimesRef.current.get(targetHandle)
    if (!runtime?.terminalInitializedRef.current || !runtime.terminalWebReadyRef.current) {
      return
    }
    const viewport = runtime.viewportRef.current
    runtime.terminalRef.current?.init(
      viewport.cols,
      viewport.rows,
      buildRemoteTerminalInitialData(runtime.terminalHistoryRef.current),
      true,
      undefined,
      true
    )
  }, [])

  const canSend = connectionState === 'connected' && !loading && terminalRunning && !stopping

  useEffect(() => {
    if (!canSend) {
      resetTerminalOneShotModifiers()
    }
  }, [canSend, resetTerminalOneShotModifiers])

  const sendLiveTerminalInput = useCallback(
    async (handle: string, bytes: string): Promise<boolean> => {
      if (handle !== terminalHandle) {
        return false
      }
      const text = normalizeTerminalTextInput(bytes)
      if (text.length === 0) {
        return false
      }
      if (!isTerminalLiveInputWithinByteLimit(text)) {
        setError(t('terminal.inputTooLarge'))
        return false
      }
      const client = clientRef.current
      if (!client || connectionState !== 'connected') {
        return false
      }
      const runId = runIdRef.current
      return sendTerminalInput(client, windowId, paneId, text).then(
        () => true,
        (err) => {
          if (runIdRef.current === runId && clientRef.current === client) {
            setError(terminalErrorMessage(err, t))
          }
          return false
        }
      )
    },
    [connectionState, paneId, terminalHandle, t, windowId]
  )
  sendLiveTerminalInputRef.current = sendLiveTerminalInput

  const {
    flushPendingLiveInputBeforeExternalSend,
    handleLiveInputAccessoryBytes,
    handleLiveInputChange,
    handleLiveInputKeyPress,
    handleLiveInputSubmit
  } = useTerminalLiveInputCommit({
    activeHandle: terminalHandle,
    activeHandleRef,
    activeSessionTabType: 'terminal',
    activeSessionTabTypeRef,
    liveInputRef,
    liveInputTerminalHandles,
    liveInputTerminalHandlesRef,
    sendLiveTerminalInputRef,
    setLiveInputCapture
  })

  const focusLiveInput = useCallback(() => {
    if (!canSend) {
      return
    }
    const runtime = activeHandleRef.current
      ? sessionRuntimesRef.current.get(activeHandleRef.current)
      : null
    runtime?.terminalRef.current?.revealLiveInput()
    focusTerminalLiveInputTarget(liveInputRef.current, {
      keyboardHeight,
      refocus: () =>
        scheduleTerminalLiveInputFocus(liveInputFocusTimerRef, () => liveInputRef.current?.focus())
    })
  }, [canSend, keyboardHeight])

  const handleAccessoryKey = useCallback(
    async (input: TerminalLiveAccessoryInput) => {
      if (!canSend) {
        return
      }
      const accessoryCommit = await handleLiveInputAccessoryBytes(input)
      if (accessoryCommit.kind !== 'allow-raw') {
        return
      }
      await sendLiveTerminalInput(terminalHandle, input.bytes)
    },
    [canSend, handleLiveInputAccessoryBytes, sendLiveTerminalInput, terminalHandle]
  )
  const handleAccessoryKeyRef = useRef(handleAccessoryKey)
  handleAccessoryKeyRef.current = handleAccessoryKey

  const toggleTerminalAutoScroll = useCallback(() => {
    const nextDisabled = !autoScrollDisabledRef.current
    autoScrollDisabledRef.current = nextDisabled
    setAutoScrollDisabled(nextDisabled)
    terminalRef.current?.setAutoScrollDisabled(nextDisabled)
  }, [autoScrollDisabledRef, terminalRef])

  const createAccessoryKeyInput = useCallback(
    (key: Parameters<typeof createTerminalLiveAccessoryInput>[0]) => {
      const modifiers = oneShotModifiersRef.current
      clearTerminalOneShotModifierState()
      return createTerminalLiveAccessoryInput(key, getTerminalOneShotModifierList(modifiers))
    },
    [clearTerminalOneShotModifierState]
  )

  const handleLiveInputChangeWithModifiers = useCallback(
    (text: string) => {
      const normalizedText = normalizeTerminalTextInput(text)
      const suppressedEdit = suppressedTerminalNativeEditRef.current
      if (suppressedEdit) {
        suppressedTerminalNativeEditRef.current = null
        if (normalizedText === suppressedEdit.expectedText) {
          const currentText = liveInputCaptureRef.current
          const restoredText =
            currentText === suppressedEdit.restoreText ? suppressedEdit.restoreText : currentText
          setLiveInputCapture(restoredText)
          liveInputRef.current?.setNativeProps({ text: restoredText })
          return
        }
      }

      const modifiers = oneShotModifiersRef.current
      if (!hasTerminalOneShotModifiers(modifiers)) {
        handleLiveInputChange(normalizedText)
        return
      }

      const previousText = liveInputCaptureRef.current
      const bytes = buildTerminalOneShotTextBytes(previousText, normalizedText, modifiers)
      clearTerminalOneShotModifierState()
      if (bytes === null) {
        handleLiveInputChange(normalizedText)
        return
      }

      // The chord replaces the native field edit; resetting the hidden field
      // prevents its ordinary character from being mirrored a second time.
      setLiveInputCapture(previousText)
      liveInputRef.current?.setNativeProps({ text: previousText })
      void handleAccessoryKey({ bytes })
    },
    [
      clearTerminalOneShotModifierState,
      handleAccessoryKey,
      handleLiveInputChange,
      setLiveInputCapture
    ]
  )

  const handleLiveInputKeyPressWithModifiers = useCallback(
    (event: Parameters<typeof handleLiveInputKeyPress>[0]) => {
      const key = event.nativeEvent.key
      // Enter can produce both key and submit events; submit owns it so the
      // terminal receives exactly one carriage return or modified return.
      if (key === 'Enter') {
        handleLiveInputKeyPress(event)
        return
      }
      const modifiers = oneShotModifiersRef.current
      const bytes = buildTerminalOneShotNativeKeyBytes(key, modifiers)
      if (bytes === null) {
        handleLiveInputKeyPress(event)
        return
      }

      if (key === 'Backspace') {
        const previousText = liveInputCaptureRef.current
        suppressedTerminalNativeEditRef.current = {
          expectedText: Array.from(previousText).slice(0, -1).join(''),
          restoreText: previousText
        }
      }
      clearTerminalOneShotModifierState()
      void handleAccessoryKey({ bytes })
    },
    [clearTerminalOneShotModifierState, handleAccessoryKey, handleLiveInputKeyPress]
  )

  const handleLiveInputSubmitWithModifiers = useCallback(() => {
    const modifiers = oneShotModifiersRef.current
    const bytes = buildTerminalOneShotNativeKeyBytes('Enter', modifiers)
    if (bytes === null) {
      handleLiveInputSubmit()
      return
    }
    clearTerminalOneShotModifierState()
    void handleAccessoryKey({ bytes })
  }, [clearTerminalOneShotModifierState, handleAccessoryKey, handleLiveInputSubmit])

  const startAccessoryRepeat = useCallback(
    (input: TerminalLiveAccessoryInput) => {
      stopAccessoryRepeat()
      repeatTimeoutRef.current = setTimeout(() => {
        repeatIntervalRef.current = setInterval(() => {
          void handleAccessoryKeyRef.current(input)
        }, 45)
      }, 400)
    },
    [stopAccessoryRepeat]
  )

  const handleSelectionCopy = useCallback((targetHandle: string, text: string) => {
    if (targetHandle !== activeHandleRef.current || text.length === 0) {
      return
    }
    void Clipboard.setStringAsync(text)
  }, [])

  const handlePaste = useCallback(async () => {
    if (!canSend) {
      return
    }
    const flushed = await flushPendingLiveInputBeforeExternalSend(terminalHandle)
    if (!flushed) {
      return
    }
    const text = await Clipboard.getStringAsync()
    if (text.length > 0) {
      await sendLiveTerminalInput(terminalHandle, text)
    }
  }, [canSend, flushPendingLiveInputBeforeExternalSend, sendLiveTerminalInput, terminalHandle])

  useEffect(() => {
    let cancelled = false
    void loadTerminalTextScale().then((scale) => {
      if (!cancelled) {
        setTerminalTextScale(scale)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  const handleTextScaleChange = useCallback((scale: number) => {
    setTerminalTextScale(scale)
    void saveTerminalTextScale(scale)
  }, [])

  const handleTerminalWebViewDiagnostic = useCallback(
    (targetHandle: string, diagnostic: TerminalWebViewDiagnostic) => {
      appendDiagnostic('webview', diagnostic.event, {
        handle: targetHandle,
        ...diagnostic.metrics
      })
    },
    [appendDiagnostic]
  )

  const handleTerminalHistoryMetrics = useCallback(
    (targetHandle: string, metrics: TerminalHistoryMetrics) => {
      const runtime = sessionRuntimesRef.current.get(targetHandle)
      if (runtime) {
        runtime.terminalHistoryMetricsRef.current = metrics
      }
    },
    []
  )

  const handleHistoryTopReached = useCallback(() => {
    const client = clientRef.current
    if (!client || loading || resyncingRef.current) {
      return
    }
    if (loadingOlderHistoryRef.current) {
      setLoadingOlderHistory(true)
      setHistoryNotice(null)
      return
    }
    const prefetch = terminalHistoryPrefetchRef.current
    if (prefetch.pages.length === 0 && !prefetch.hasMoreBefore) {
      terminalHistoryRef.current.hasMoreBefore = false
      terminalHistoryRef.current.gap ||= prefetch.gap
      terminalHistoryRef.current.evictedBeforeSeq = Math.max(
        terminalHistoryRef.current.evictedBeforeSeq,
        prefetch.evictedBeforeSeq
      )
      setHistoryNotice(terminalHistoryBoundaryMessage(terminalHistoryRef.current, t))
      return
    }
    const runId = runIdRef.current
    void activatePrefetchedTerminalHistory('history-top', 1).catch((err) => {
      if (runIdRef.current === runId && clientRef.current === client) {
        appendDiagnostic('mobile', 'history-activation-error', {
          handle: terminalHandle,
          trigger: 'history-top',
          message: err instanceof Error ? err.message : String(err)
        })
        setError(terminalErrorMessage(err, t))
      }
    })
  }, [activatePrefetchedTerminalHistory, appendDiagnostic, loading, t, terminalHandle])
  handleHistoryTopReachedRef.current = handleHistoryTopReached

  const setTerminalWebViewRef = useCallback((handle: string, ref: TerminalWebViewHandle | null) => {
    const runtime = sessionRuntimesRef.current.get(handle)
    if (runtime) {
      runtime.terminalRef.current = ref
      ref?.setAutoScrollDisabled(runtime.autoScrollDisabledRef.current)
    }
  }, [])

  const handleResidentTerminalWebReady = useCallback(
    (handle: string) => {
      const runtime = sessionRuntimesRef.current.get(handle)
      if (!runtime) {
        return
      }
      runtime.terminalRef.current?.setAutoScrollDisabled(runtime.autoScrollDisabledRef.current)
      if (handle === activeHandleRef.current) {
        handleTerminalWebReady()
        return
      }
      const wasReady = runtime.terminalWebReadyRef.current
      runtime.terminalWebReadyRef.current = true
      if (wasReady && runtime.terminalInitializedRef.current) {
        const viewport = runtime.viewportRef.current
        runtime.terminalRef.current?.init(
          viewport.cols,
          viewport.rows,
          buildRemoteTerminalInitialData(runtime.terminalHistoryRef.current),
          true,
          undefined,
          true
        )
      }
    },
    [handleTerminalWebReady]
  )

  useEffect(() => {
    const updateKeyboardHeight = (event: KeyboardEvent) => {
      cancelKeyboardViewportRestore()
      setKeyboardHeight(Math.max(0, event.endCoordinates.height))
    }
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'
    const showSub = Keyboard.addListener(showEvent, updateKeyboardHeight)
    const hideSub = Keyboard.addListener(hideEvent, restoreTerminalAfterKeyboard)
    const settledHideSub =
      Platform.OS === 'ios'
        ? Keyboard.addListener('keyboardDidHide', restoreTerminalAfterKeyboard)
        : null
    return () => {
      showSub.remove()
      hideSub.remove()
      settledHideSub?.remove()
      clearTerminalLiveInputFocusTimer(liveInputFocusTimerRef)
      cancelKeyboardViewportRestore()
      stopAccessoryRepeat()
    }
  }, [cancelKeyboardViewportRestore, restoreTerminalAfterKeyboard, stopAccessoryRepeat])

  useEffect(() => {
    if (loading || connectionState !== 'connected') {
      return
    }
    const timer = setInterval(() => {
      void syncTerminalIncrement()
    }, TERMINAL_INCREMENTAL_SYNC_MS)
    return () => clearInterval(timer)
  }, [connectionState, loading, syncTerminalIncrement])

  useEffect(() => {
    if (connectionState !== 'connected') {
      return
    }
    const timer = setInterval(() => {
      void syncPaneStatus()
    }, TERMINAL_PANE_STATUS_SYNC_MS)
    return () => clearInterval(timer)
  }, [connectionState, syncPaneStatus])

  const keyboardLift =
    keyboardHeight > 0
      ? Platform.OS === 'ios'
        ? Math.max(0, keyboardHeight - insets.bottom)
        : keyboardHeight
      : 0
  const terminalKeyboardLift = getTerminalKeyboardAvoidanceLift({
    keyboardLift,
    terminalFrameHeight,
    metrics: terminalKeyboardMetrics
  })
  const showGroupWindowTabs = groupWindowTabs.length > 1
  const openDiagnostics = useCallback(() => {
    diagnosticsVisibleRef.current = true
    setDiagnosticsRevision((revision) => revision + 1)
    setDiagnosticsVisible(true)
  }, [])
  const closeDiagnostics = useCallback(() => {
    diagnosticsVisibleRef.current = false
    setDiagnosticsVisible(false)
  }, [])
  const diagnosticsText = useMemo(() => {
    if (!diagnosticsVisible) {
      return ''
    }
    const history = terminalHistoryRef.current
    const prefetch = terminalHistoryPrefetchRef.current
    const viewport = viewportRef.current
    const desktopViewport = desktopViewportRef.current
    return formatTerminalDiagnostics(diagnosticsBufferRef.current, {
      platform: Platform.OS,
      connectionState,
      handle: terminalHandle,
      terminalRunning,
      loading,
      resyncing: resyncingRef.current,
      textScale: terminalTextScale,
      terminalFrameHeight,
      viewportCols: viewport.cols,
      viewportRows: viewport.rows,
      desktopCols: desktopViewport.cols,
      desktopRows: desktopViewport.rows,
      historyFirstSeq: history.firstSeq,
      historyLastSeq: history.lastSeq,
      historyChunks: history.chunks.length,
      historyHasMoreBefore: history.hasMoreBefore,
      historyGap: history.gap,
      evictedBeforeSeq: history.evictedBeforeSeq,
      pendingDataEntries: history.pendingDataBySeq.size,
      pendingDataBytes: history.pendingDataBytes,
      prefetchedPages: prefetch.pages.length,
      prefetchedBytes: prefetch.cachedBytes,
      prefetchNextBeforeSeq: prefetch.nextBeforeSeq,
      prefetchHasMoreBefore: prefetch.hasMoreBefore,
      prefetchGap: prefetch.gap,
      diagnosticsEntries: diagnosticsBufferRef.current.entries.length
    })
  }, [
    connectionState,
    diagnosticsRevision,
    diagnosticsVisible,
    loading,
    terminalFrameHeight,
    terminalHandle,
    terminalRunning,
    terminalTextScale
  ])

  return (
    <>
      <Stack.Screen
        options={{
          headerTitle: '',
          headerRight: () => (
            <View style={styles.navActions}>
              <Pressable
                style={[styles.navIconButton, !canSend && styles.iconButtonDisabled]}
                disabled={!canSend}
                onPress={focusLiveInput}
                accessibilityRole="button"
                accessibilityLabel={t('terminal.showKeyboard')}
                accessibilityHint={t('terminal.showKeyboardHint')}
              >
                <KeyboardIcon size={18} color={colors.textPrimary} />
              </Pressable>
              <Pressable
                style={styles.navIconButton}
                onPress={openDiagnostics}
                accessibilityRole="button"
                accessibilityLabel={t('terminal.openDiagnostics')}
              >
                <Bug size={18} color={colors.textPrimary} />
              </Pressable>
              <Pressable
                style={[styles.navIconButton, deletingTabKey !== null && styles.iconButtonDisabled]}
                disabled={deletingTabKey !== null}
                onPress={() => void openTerminal()}
              >
                <RotateCw size={18} color={colors.textPrimary} />
              </Pressable>
              <Pressable
                style={[styles.navIconButton, deletingTabKey !== null && styles.iconButtonDisabled]}
                disabled={deletingTabKey !== null}
                onPress={() => void handleClear()}
              >
                <Eraser size={18} color={colors.textPrimary} />
              </Pressable>
              <Pressable
                style={[
                  styles.navIconButton,
                  (stopping || deletingTabKey !== null) && styles.iconButtonDisabled
                ]}
                disabled={stopping || deletingTabKey !== null}
                onPress={() => void handleStop()}
                accessibilityLabel={t('overview.stopTerminal')}
              >
                <Square size={17} color={colors.statusRed} fill={colors.statusRed} />
              </Pressable>
            </View>
          )
        }}
      />
      <TerminalDiagnosticsModal
        visible={diagnosticsVisible}
        text={diagnosticsText}
        title={t('terminal.diagnosticsTitle')}
        copyLabel={t('terminal.copyDiagnostics')}
        copiedLabel={t('terminal.diagnosticsCopied')}
        closeLabel={t('terminal.closeDiagnostics')}
        onClose={closeDiagnostics}
      />
      <View style={styles.container}>
        {showGroupWindowTabs ? (
          <View style={styles.paneTabs}>
            <View style={styles.paneTabsRow}>
              <ScrollView
                style={styles.paneTabScroller}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.paneTabContent}
              >
                {groupWindowTabs.map((window) => {
                  const active = window.windowId === windowId
                  const pane = getActiveTerminalPane(window.panes, window.activePaneId)
                  const paneKey = pane ? `${pane.windowId}:${pane.paneId}` : window.windowId
                  const deleteKey = `group:${window.windowId}`
                  const starting = startingTabPaneKey === paneKey
                  const disabled =
                    !pane || (!active && !pane.running && !isStartableTerminalPane(pane))
                  return (
                    <ManagedTerminalTab
                      key={window.windowId}
                      label={starting ? t('common.starting') : window.name}
                      statusColor={pane ? terminalPaneStatusColor(pane) : colors.borderSubtle}
                      active={active}
                      normalDisabled={disabled}
                      starting={starting}
                      editing={tabDeleteMode === 'group'}
                      deleting={deletingTabKey === deleteKey}
                      deletionInFlight={deletingTabKey !== null}
                      deleteAccessibilityLabel={t('terminal.removeGroupWindowAction')}
                      onPress={() =>
                        handleManagedTabPress(() => void handleGroupWindowTabPress(window))
                      }
                      onLongPress={() => handleTabLongPress('group')}
                      onDelete={() => confirmGroupWindowRemoval(window)}
                    />
                  )
                })}
              </ScrollView>
              <Pressable
                style={({ pressed }) => [
                  styles.paneTabManageButton,
                  pressed && !deletingTabKey && styles.paneTabPressed,
                  deletingTabKey && styles.iconButtonDisabled
                ]}
                disabled={deletingTabKey !== null}
                onPress={() => {
                  if (tabDeleteMode === 'group') {
                    exitTabDeleteMode()
                  } else {
                    enterTabDeleteMode('group')
                  }
                }}
                accessibilityRole="button"
                accessibilityLabel={
                  tabDeleteMode === 'group'
                    ? t('terminal.finishManagingTabs')
                    : t('terminal.manageTabs')
                }
              >
                {tabDeleteMode === 'group' ? (
                  <>
                    <Check size={16} color={colors.textPrimary} strokeWidth={2.5} />
                    <Text style={styles.paneTabManageText}>{t('common.done')}</Text>
                  </>
                ) : (
                  <Pencil size={16} color={colors.textSecondary} />
                )}
              </Pressable>
            </View>
          </View>
        ) : windowPanes.length > 1 ? (
          <View style={styles.paneTabs}>
            <View style={styles.paneTabsRow}>
              <ScrollView
                style={styles.paneTabScroller}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.paneTabContent}
              >
                {windowPanes.map((pane, index) => {
                  const active = pane.paneId === paneId
                  const paneKey = `${pane.windowId}:${pane.paneId}`
                  const deleteKey = `pane:${pane.windowId}:${pane.paneId}`
                  const starting = startingTabPaneKey === paneKey
                  const disabled = !active && !pane.running && !isStartableTerminalPane(pane)
                  return (
                    <ManagedTerminalTab
                      key={paneKey}
                      label={
                        starting
                          ? t('common.starting')
                          : terminalPaneLabel(pane, t) || `${t('overview.pane')} ${index + 1}`
                      }
                      statusColor={terminalPaneStatusColor(pane)}
                      active={active}
                      normalDisabled={disabled}
                      starting={starting}
                      editing={tabDeleteMode === 'pane'}
                      deleting={deletingTabKey === deleteKey}
                      deletionInFlight={deletingTabKey !== null}
                      deleteAccessibilityLabel={t('terminal.deletePaneAction')}
                      onPress={() => handleManagedTabPress(() => void handlePaneTabPress(pane))}
                      onLongPress={() => handleTabLongPress('pane')}
                      onDelete={() => confirmPaneTabDeletion(pane)}
                    />
                  )
                })}
              </ScrollView>
              <Pressable
                style={({ pressed }) => [
                  styles.paneTabManageButton,
                  pressed && !deletingTabKey && styles.paneTabPressed,
                  deletingTabKey && styles.iconButtonDisabled
                ]}
                disabled={deletingTabKey !== null}
                onPress={() => {
                  if (tabDeleteMode === 'pane') {
                    exitTabDeleteMode()
                  } else {
                    enterTabDeleteMode('pane')
                  }
                }}
                accessibilityRole="button"
                accessibilityLabel={
                  tabDeleteMode === 'pane'
                    ? t('terminal.finishManagingTabs')
                    : t('terminal.manageTabs')
                }
              >
                {tabDeleteMode === 'pane' ? (
                  <>
                    <Check size={16} color={colors.textPrimary} strokeWidth={2.5} />
                    <Text style={styles.paneTabManageText}>{t('common.done')}</Text>
                  </>
                ) : (
                  <Pencil size={16} color={colors.textSecondary} />
                )}
              </Pressable>
            </View>
          </View>
        ) : null}

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <View style={styles.terminalFrame} onLayout={handleLayout}>
          <View
            style={[styles.terminalSurface, { transform: [{ translateY: -terminalKeyboardLift }] }]}
          >
            {residentTerminalHandles.map((handle) => (
              <TerminalPaneView
                key={handle}
                handle={handle}
                active={handle === terminalHandle}
                keyboardLift={0}
                terminalTheme={terminalTheme}
                textScale={terminalTextScale}
                textScaleMode="mobile-reflow"
                liveInputText={handle === terminalHandle ? liveInputCapture : ''}
                onRef={setTerminalWebViewRef}
                onWebReady={handleResidentTerminalWebReady}
                onSelectionMode={() => {}}
                onSelectionCopy={handleSelectionCopy}
                onSelectionEvicted={() => {}}
                onModesChanged={() => {}}
                onKeyboardAvoidanceMetrics={(targetHandle, metrics) => {
                  if (targetHandle === activeHandleRef.current) {
                    handleKeyboardAvoidanceMetrics(metrics)
                  }
                }}
                onHistoryMetrics={handleTerminalHistoryMetrics}
                onHaptic={() => {}}
                onTerminalInput={(targetHandle, bytes) => {
                  if (targetHandle === activeHandleRef.current) {
                    handleTerminalInput(bytes)
                  }
                }}
                onTerminalTap={(targetHandle) => {
                  if (targetHandle === activeHandleRef.current) {
                    focusLiveInput()
                  }
                }}
                onFileTap={() => {}}
                onOpenUrl={() => {}}
                onTextScaleChange={handleTextScaleChange}
                onEngineError={(targetHandle, message) => {
                  if (targetHandle === activeHandleRef.current) {
                    setError(message)
                  }
                }}
                onHistoryTopReached={(targetHandle) => {
                  if (targetHandle === activeHandleRef.current) {
                    handleHistoryTopReachedRef.current?.()
                  }
                }}
                onMobileReflowRefreshRequest={handleMobileReflowRefreshRequest}
                onDiagnostic={handleTerminalWebViewDiagnostic}
              />
            ))}
          </View>
          {loadingOlderHistory || historyNotice ? (
            <View style={styles.historyBanner}>
              {loadingOlderHistory ? (
                <ActivityIndicator size="small" color={colors.textSecondary} />
              ) : null}
              <Text style={styles.historyBannerText}>
                {loadingOlderHistory ? t('terminal.loadingOlderHistory') : historyNotice}
              </Text>
            </View>
          ) : null}
          {loading ? (
            <View style={styles.loadingOverlay}>
              <ActivityIndicator color={colors.textSecondary} />
              <Text style={styles.loadingText}>{t('terminal.loading')}</Text>
            </View>
          ) : null}
        </View>

        {logs.length > 0 && error ? (
          <View style={styles.logPreview}>
            <Text style={styles.logText}>{logs[logs.length - 1]?.message}</Text>
          </View>
        ) : null}

        <View
          style={[
            styles.commandDock,
            { paddingBottom: insets.bottom, transform: [{ translateY: -keyboardLift }] }
          ]}
        >
          <View style={styles.accessoryBar}>
            <ScrollView
              horizontal
              pagingEnabled
              bounces={false}
              decelerationRate="fast"
              disableIntervalMomentum
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.accessoryPages}
              keyboardShouldPersistTaps="always"
              onScrollBeginDrag={stopAccessoryRepeat}
            >
              {accessoryPages.map((page, pageIndex) => (
                <View
                  key={`accessory-page-${pageIndex}`}
                  style={[styles.accessoryPage, { width: accessoryPageWidth }]}
                >
                  {Array.from({ length: 2 }, (_, rowIndex) => (
                    <View key={`accessory-row-${rowIndex}`} style={styles.accessoryRow}>
                      {page
                        .slice(
                          rowIndex * TERMINAL_ACCESSORY_PAGE_COLUMNS,
                          (rowIndex + 1) * TERMINAL_ACCESSORY_PAGE_COLUMNS
                        )
                        .map((slot, columnIndex) => {
                          const slotKey = `${rowIndex}-${columnIndex}`
                          if (!slot) {
                            return <View key={slotKey} style={styles.accessoryKeyPlaceholder} />
                          }
                          if (slot.type === 'paste') {
                            return (
                              <Pressable
                                key={slot.id}
                                style={({ pressed }) => [
                                  styles.accessoryKey,
                                  pressed && styles.accessoryKeyPressed,
                                  !canSend && styles.accessoryKeyDisabled
                                ]}
                                disabled={!canSend}
                                onPress={() => void handlePaste()}
                                accessibilityLabel={t('terminal.pasteAccessibility')}
                              >
                                <Text
                                  numberOfLines={1}
                                  adjustsFontSizeToFit
                                  minimumFontScale={0.75}
                                  style={[
                                    styles.accessoryKeyText,
                                    !canSend && styles.accessoryKeyTextDisabled
                                  ]}
                                >
                                  {t('terminal.paste')}
                                </Text>
                              </Pressable>
                            )
                          }
                          if (slot.type === 'scroll') {
                            return (
                              <Pressable
                                key={slot.id}
                                style={({ pressed }) => [
                                  styles.accessoryKey,
                                  autoScrollDisabled && styles.accessoryScrollLocked,
                                  pressed && styles.accessoryKeyPressed
                                ]}
                                onPress={toggleTerminalAutoScroll}
                                accessibilityRole="button"
                                accessibilityLabel={
                                  autoScrollDisabled
                                    ? t('terminal.followLatestOutput')
                                    : t('terminal.lockHistoryViewport')
                                }
                                accessibilityState={{ selected: autoScrollDisabled }}
                              >
                                <Text numberOfLines={1} style={styles.accessoryKeyText}>
                                  {'⇳'}
                                </Text>
                              </Pressable>
                            )
                          }
                          if (slot.type === 'modifier') {
                            const active = oneShotModifiers[slot.modifier]
                            return (
                              <Pressable
                                key={slot.id}
                                style={({ pressed }) => [
                                  styles.accessoryKey,
                                  active && styles.accessoryModifierActive,
                                  pressed && styles.accessoryKeyPressed,
                                  !canSend && styles.accessoryKeyDisabled
                                ]}
                                disabled={!canSend}
                                onPress={() => toggleOneShotModifier(slot.modifier)}
                                accessibilityLabel={slot.accessibilityLabel}
                                accessibilityRole="button"
                                accessibilityState={{ selected: active, disabled: !canSend }}
                              >
                                <Text
                                  numberOfLines={1}
                                  style={[
                                    styles.accessoryKeyText,
                                    !canSend && styles.accessoryKeyTextDisabled
                                  ]}
                                >
                                  {slot.label}
                                </Text>
                              </Pressable>
                            )
                          }
                          const key = slot.key
                          return (
                            <Pressable
                              key={slot.id}
                              style={({ pressed }) => [
                                styles.accessoryKey,
                                pressed && styles.accessoryKeyPressed,
                                !canSend && styles.accessoryKeyDisabled
                              ]}
                              disabled={!canSend}
                              onPressIn={() => {
                                if (!key.repeatable) {
                                  return
                                }
                                const input = createAccessoryKeyInput(key)
                                void handleAccessoryKey(input)
                                startAccessoryRepeat(input)
                              }}
                              onPressOut={() => {
                                if (key.repeatable) {
                                  stopAccessoryRepeat()
                                }
                              }}
                              onPress={() => {
                                if (key.repeatable) {
                                  return
                                }
                                void handleAccessoryKey(createAccessoryKeyInput(key))
                              }}
                              accessibilityLabel={
                                key.accessibilityLabel ?? t('terminal.sendKey', { key: key.label })
                              }
                            >
                              <Text
                                numberOfLines={1}
                                adjustsFontSizeToFit
                                minimumFontScale={0.75}
                                style={[
                                  styles.accessoryKeyText,
                                  !canSend && styles.accessoryKeyTextDisabled
                                ]}
                              >
                                {key.label}
                              </Text>
                            </Pressable>
                          )
                        })}
                    </View>
                  ))}
                </View>
              ))}
            </ScrollView>
          </View>

          <TextInput
            ref={liveInputRef}
            style={styles.liveInputCapture}
            value={liveInputCapture}
            onChangeText={handleLiveInputChangeWithModifiers}
            onKeyPress={handleLiveInputKeyPressWithModifiers}
            onSubmitEditing={handleLiveInputSubmitWithModifiers}
            placeholder=""
            showSoftInputOnFocus
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            smartInsertDelete={false}
            autoComplete="off"
            keyboardType={getTerminalLiveInputKeyboardType(Platform.OS)}
            returnKeyType="default"
            blurOnSubmit={false}
            editable={canSend}
            importantForAutofill="no"
          />
        </View>
      </View>
    </>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgBase
  },
  navActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm
  },
  navIconButton: {
    width: 36,
    height: 36,
    borderRadius: radii.button,
    backgroundColor: colors.bgRaised,
    alignItems: 'center',
    justifyContent: 'center'
  },
  iconButtonDisabled: {
    opacity: 0.52
  },
  paneTabs: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
    backgroundColor: colors.bgPanel
  },
  paneTabsRow: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center'
  },
  paneTabScroller: {
    flex: 1
  },
  paneTabContent: {
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  paneTabWrapper: {
    position: 'relative',
    paddingTop: 4,
    paddingRight: 4
  },
  paneTab: {
    maxWidth: 180,
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radii.button,
    backgroundColor: colors.bgRaised,
    paddingHorizontal: spacing.sm
  },
  paneTabActive: {
    borderColor: colors.accentBlue
  },
  paneTabEditing: {
    paddingRight: spacing.xl
  },
  paneTabDisabled: {
    opacity: 0.45
  },
  paneTabPressed: {
    backgroundColor: colors.borderSubtle
  },
  paneTabDeleteButton: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: colors.bgPanel,
    backgroundColor: colors.statusRed,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 3
  },
  paneTabDeleteButtonPressed: {
    opacity: 0.78
  },
  paneTabDeleteButtonDisabled: {
    opacity: 0.35
  },
  paneTabManageButton: {
    minWidth: 36,
    height: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginRight: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radii.button,
    backgroundColor: colors.bgRaised,
    paddingHorizontal: spacing.sm
  },
  paneTabManageText: {
    color: colors.textPrimary,
    fontSize: typography.metaSize,
    fontWeight: '700'
  },
  paneTabDot: {
    width: 7,
    height: 7,
    borderRadius: 4
  },
  paneTabText: {
    flexShrink: 1,
    maxWidth: 140,
    color: colors.textSecondary,
    fontSize: typography.metaSize,
    fontWeight: '700'
  },
  paneTabTextActive: {
    color: colors.textPrimary
  },
  errorText: {
    color: colors.statusRed,
    fontSize: typography.metaSize,
    lineHeight: 18,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  terminalFrame: {
    flex: 1,
    backgroundColor: colors.terminalBg,
    overflow: 'hidden'
  },
  terminalSurface: {
    ...StyleSheet.absoluteFillObject
  },
  historyBanner: {
    position: 'absolute',
    top: spacing.sm,
    alignSelf: 'center',
    maxWidth: '88%',
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radii.button,
    backgroundColor: 'rgba(23, 23, 23, 0.86)',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    zIndex: 12
  },
  historyBannerText: {
    color: colors.textSecondary,
    fontSize: typography.metaSize,
    fontWeight: '600'
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(17,17,17,0.72)',
    gap: spacing.sm
  },
  loadingText: {
    color: colors.textSecondary,
    fontSize: typography.bodySize
  },
  logPreview: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs
  },
  logText: {
    color: colors.textMuted,
    fontFamily: typography.monoFamily,
    fontSize: typography.metaSize
  },
  commandDock: {
    zIndex: 20,
    backgroundColor: colors.terminalBg
  },
  accessoryBar: {
    backgroundColor: colors.terminalBg
  },
  accessoryPages: {
    flexDirection: 'row'
  },
  accessoryPage: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    gap: spacing.xs
  },
  accessoryRow: {
    flexDirection: 'row',
    gap: spacing.xs
  },
  accessoryKey: {
    flex: 1,
    minWidth: 0,
    height: 30,
    paddingHorizontal: 2,
    alignItems: 'center',
    justifyContent: 'center'
  },
  accessoryKeyPlaceholder: {
    flex: 1,
    minWidth: 0,
    height: 30
  },
  accessoryKeyPressed: {
    opacity: 0.65
  },
  accessoryModifierActive: {
    backgroundColor: colors.statusRed
  },
  accessoryScrollLocked: {
    backgroundColor: colors.statusRed
  },
  accessoryKeyDisabled: {
    opacity: 0.35
  },
  accessoryKeyText: {
    color: '#ffffff',
    fontFamily: typography.monoFamily,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center'
  },
  accessoryKeyTextDisabled: {
    color: colors.textMuted
  },
  liveInputCapture: {
    position: 'absolute',
    opacity: 0,
    width: 1,
    height: 1,
    color: colors.textPrimary
  }
})
