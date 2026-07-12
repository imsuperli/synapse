import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  AppState,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type KeyboardEvent,
  type LayoutChangeEvent,
} from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { Eraser, Keyboard as KeyboardIcon, RotateCw, Square } from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  TerminalWebView,
  type TerminalKeyboardAvoidanceMetrics,
  type TerminalWebViewHandle
} from '../../../../../src/terminal/TerminalWebView'
import {
  clearTerminal,
  connectToHost,
  loadHostById,
  requestTerminalHistory,
  requestWindowList,
  sendTerminalInput,
  startRemoteWindow,
  stopRemotePane,
  type RemoteWindowGroupSummary,
  type RemotePaneSummary
} from '../../../../../src/synapse/remote'
import { MobileTerminalLiveInputStatus } from '../../../../../src/session/MobileTerminalLiveInputStatus'
import {
  getDefaultTerminalAccessoryBuiltInIds,
  getVisibleTerminalAccessoryKeys
} from '../../../../../src/terminal/terminal-accessory-layout'
import { createTerminalLiveAccessoryInput } from '../../../../../src/terminal/terminal-live-accessory-input'
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
import { loadTerminalTextScale, saveTerminalTextScale } from '../../../../../src/storage/preferences'
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

type TerminalLiveAccessoryInput = ReturnType<typeof createTerminalLiveAccessoryInput>

const DEFAULT_COLS = 80
const DEFAULT_ROWS = 30
const TERMINAL_INCREMENTAL_SYNC_MS = 1500
const TERMINAL_PANE_STATUS_SYNC_MS = 3000
const TERMINAL_HISTORY_PAGE_BYTES = 192 * 1024
const TERMINAL_HISTORY_PAGE_CHUNKS = 50_000
const TERMINAL_INCREMENTAL_SYNC_PAGE_LIMIT = 32

type TerminalViewport = {
  cols: number
  rows: number
}

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

function terminalPaneLabel(pane: RemotePaneSummary, t: MobileTranslate): string {
  return pane.title || pane.command || pane.cwd?.split(/[\\/]/).filter(Boolean).at(-1) || t('common.terminal')
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

function isStartableLocalPane(pane: RemotePaneSummary): boolean {
  return pane.kind === 'terminal' && !pane.running && (pane.backend ?? 'local') === 'local'
}

function getActiveTerminalPane(panes: RemotePaneSummary[], activePaneId: string): RemotePaneSummary | null {
  return panes.find((pane) => pane.paneId === activePaneId && pane.kind === 'terminal') ??
    panes.find((pane) => pane.kind === 'terminal') ??
    null
}

function terminalPaneRuntimeKey(pane: RemotePaneSummary | null | undefined): string | null {
  if (!pane?.running) {
    return null
  }
  const session = pane.sessionId ?? ''
  const pid = pane.pid == null ? '' : String(pane.pid)
  return session || pid ? `${session}:${pid}` : null
}

function normalizeTerminalViewport(
  viewport: { cols?: number; rows?: number } | null | undefined,
  fallback: TerminalViewport
): TerminalViewport {
  const cols = typeof viewport?.cols === 'number' && viewport.cols > 0
    ? Math.floor(viewport.cols)
    : fallback.cols
  const rows = typeof viewport?.rows === 'number' && viewport.rows > 0
    ? Math.floor(viewport.rows)
    : fallback.rows
  return { cols, rows }
}

function sameTerminalViewport(a: TerminalViewport, b: TerminalViewport): boolean {
  return a.cols === b.cols && a.rows === b.rows
}

function terminalErrorMessage(err: unknown, t: MobileTranslate): string {
  const message = err instanceof Error ? err.message : String(err)
  if (/terminal not found|terminal_not_found|pane_not_found|window_not_found/i.test(message)) {
    return t('terminal.stoppedOnDesktop')
  }
  if (/remote_start_ssh_not_supported/i.test(message)) {
    return t('terminal.onlyLocalStart')
  }
  if (/workspace_not_loaded/i.test(message)) {
    return t('terminal.workspaceNotLoaded')
  }
  return message
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
    requestedSinceSeq: typeof event.requestedSinceSeq === 'number'
      ? event.requestedSinceSeq
      : 0,
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
    cursor: colors.textPrimary,
    cursorAccent: colors.terminalBg,
    selectionBackground: 'rgba(59,130,246,0.35)',
    black: '#1f2335',
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
  const raw = Array.isArray(value) ? value[0] ?? '' : value ?? ''
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

export default function RemoteTerminalScreen() {
  const params = useLocalSearchParams<{ hostId?: string; windowId?: string; paneId?: string }>()
  const hostId = getParam(params.hostId)
  const windowId = getParam(params.windowId)
  const paneId = getParam(params.paneId)
  const terminalHandle = `${windowId}:${paneId}`
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { t } = useMobileI18n()
  const terminalRef = useRef<TerminalWebViewHandle | null>(null)
  const clientRef = useRef<RpcClient | null>(null)
  const unsubscribeRef = useRef<(() => void) | null>(null)
  const terminalSubscribeParamsRef = useRef<TerminalSubscribeParams | null>(null)
  const terminalSubscriptionGenerationRef = useRef(0)
  const terminalHistoryGenerationRef = useRef(0)
  const runIdRef = useRef(0)
  const terminalHistoryRef = useRef(createRemoteTerminalHistoryState())
  const terminalInitializedRef = useRef(false)
  const terminalWebReadyRef = useRef(false)
  const resyncingRef = useRef(false)
  const loadingOlderHistoryRef = useRef(false)
  const viewportRef = useRef<TerminalViewport>({
    cols: DEFAULT_COLS,
    rows: DEFAULT_ROWS
  })
  const activeHandleRef = useRef<string | null>(terminalHandle)
  const activeSessionTabTypeRef = useRef<'terminal' | null>('terminal')
  const liveInputRef = useRef<TextInput | null>(null)
  const liveInputFocusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const repeatTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const repeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const sendLiveTerminalInputRef = useRef<TerminalLiveInputSender>(async () => false)
  const currentPaneRuntimeKeyRef = useRef<string | null>(null)
  const terminalIncrementSyncInFlightRef = useRef(false)
  const syncTerminalIncrementRef = useRef<(() => Promise<void>) | null>(null)
  const paneStatusSyncInFlightRef = useRef(false)
  const [connectionState, setConnectionState] = useState<ConnectionState | 'loading'>('loading')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [logs, setLogs] = useState<ConnectionLogEntry[]>([])
  const [liveInputCapture, setLiveInputCapture] = useState('')
  const [keyboardHeight, setKeyboardHeight] = useState(0)
  const [terminalFrameHeight, setTerminalFrameHeight] = useState(0)
  const [terminalKeyboardMetrics, setTerminalKeyboardMetrics] =
    useState<TerminalKeyboardAvoidanceMetrics | null>(null)
  const [windowPanes, setWindowPanes] = useState<RemotePaneSummary[]>([])
  const [groupWindowTabs, setGroupWindowTabs] = useState<RemoteWindowGroupSummary['windows']>([])
  const [startingTabPaneKey, setStartingTabPaneKey] = useState<string | null>(null)
  const [stopping, setStopping] = useState(false)
  const [terminalRunning, setTerminalRunning] = useState(true)
  const [terminalTextScale, setTerminalTextScale] = useState(1)
  const [loadingOlderHistory, setLoadingOlderHistory] = useState(false)
  const [historyNotice, setHistoryNotice] = useState<string | null>(null)
  const logsRef = useRef<ConnectionLogEntry[]>([])
  const liveInputTerminalHandles = useMemo(() => new Set([terminalHandle]), [terminalHandle])
  const liveInputTerminalHandlesRef = useRef<Set<string>>(new Set([terminalHandle]))
  const accessoryKeys = useMemo(
    () => getVisibleTerminalAccessoryKeys(getDefaultTerminalAccessoryBuiltInIds()),
    []
  )

  activeHandleRef.current = terminalHandle
  activeSessionTabTypeRef.current = 'terminal'
  liveInputTerminalHandlesRef.current = liveInputTerminalHandles

  const appendLog = useCallback((entry: ConnectionLogEntry) => {
    logsRef.current = [...logsRef.current, entry].slice(-40)
    setLogs(logsRef.current)
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

  const stopTerminalSubscription = useCallback(() => {
    terminalSubscriptionGenerationRef.current += 1
    unsubscribeRef.current?.()
    unsubscribeRef.current = null
    terminalSubscribeParamsRef.current = null
  }, [])

  const cleanup = useCallback(() => {
    runIdRef.current += 1
    terminalHistoryGenerationRef.current += 1
    resyncingRef.current = false
    loadingOlderHistoryRef.current = false
    terminalIncrementSyncInFlightRef.current = false
    paneStatusSyncInFlightRef.current = false
    stopTerminalSubscription()
    clientRef.current?.close()
    clientRef.current = null
    clearTerminalLiveInputFocusTimer(liveInputFocusTimerRef)
    stopAccessoryRepeat()
    setLoadingOlderHistory(false)
  }, [stopAccessoryRepeat, stopTerminalSubscription])

  const refitTerminalToPhone = useCallback(() => {
    terminalRef.current?.resetZoom()
  }, [])

  const buildTerminalInitialData = useCallback(() => {
    return buildRemoteTerminalInitialData(terminalHistoryRef.current)
  }, [])

  const updateTerminalSubscriptionCursor = useCallback(() => {
    if (terminalSubscribeParamsRef.current) {
      terminalSubscribeParamsRef.current.sinceSeq = terminalHistoryRef.current.lastSeq
    }
  }, [])

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
      try {
        const { windows, groups } = await requestWindowList(client)
        if (runIdRef.current !== expectedRunId || clientRef.current !== client) {
          return null
        }
        const currentWindow = windows.find((window) => window.windowId === windowId)
        setWindowPanes(currentWindow?.panes.filter((pane) => pane.kind === 'terminal') ?? [])
        const currentGroup = groups.find((group) =>
          group.windows.some((window) => window.windowId === windowId)
        )
        setGroupWindowTabs(currentGroup?.windows ?? [])
        return currentWindow?.panes.find((pane) => pane.paneId === paneId && pane.kind === 'terminal') ?? null
      } catch {
        if (runIdRef.current === expectedRunId && clientRef.current === client) {
          setWindowPanes([])
          setGroupWindowTabs([])
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
      replaceRemoteTerminalHistorySnapshot(terminalHistoryRef.current, snapshot)
      updateTerminalSubscriptionCursor()
      setHistoryNotice(snapshot.gap && !snapshot.hasMoreBefore ? t('terminal.historyStartReached') : null)
      const viewport = normalizeTerminalViewport(snapshot, viewportRef.current)
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
      if (
        runIdRef.current !== runId ||
        clientRef.current !== client ||
        terminalSubscriptionGenerationRef.current !== subscriptionGeneration
      ) {
        return null
      }
      return snapshot
    },
    [buildTerminalInitialData, paneId, t, updateTerminalSubscriptionCursor, windowId]
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
              } else {
                setError(terminalErrorMessage(streamError.message, t))
              }
              return
            }
            const subscribed = parseTerminalSubscribedEvent(payload)
            if (subscribed) {
              return
            }
            const snapshot = parseTerminalScrollbackEvent(payload)
            if (snapshot) {
              if (appliedSnapshot) {
                const nextViewport = normalizeTerminalViewport(snapshot, viewportRef.current)
                if (!sameTerminalViewport(nextViewport, viewportRef.current)) {
                  viewportRef.current = nextViewport
                  terminalRef.current?.resize(nextViewport.cols, nextViewport.rows)
                }
                if (snapshot.incremental) {
                  const appended = appendRemoteTerminalIncrementalSnapshot(
                    terminalHistoryRef.current,
                    snapshot
                  )
                  if (appended.data) {
                    terminalRef.current?.write(appended.data)
                  }
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
                    if (runIdRef.current === runId && clientRef.current === client) {
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
              terminalRef.current?.write(appended.data)
            }
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
      paneId,
      stopTerminalSubscription,
      t,
      updateTerminalSubscriptionCursor,
      windowId
    ]
  )

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
      terminalInitializedRef.current = false
      const snapshot = await startTerminalSubscription(client, runId, { sinceSeq: 0 })
      if (!snapshot || runIdRef.current !== runId || clientRef.current !== client) {
        return false
      }
      setTerminalRunning(true)
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
        const historyViewport = normalizeTerminalViewport(history, viewportRef.current)
        if (!sameTerminalViewport(historyViewport, viewportRef.current)) {
          viewportRef.current = historyViewport
          terminalRef.current?.resize(historyViewport.cols, historyViewport.rows)
        }
        if (history.gap) {
          if (resyncingRef.current) {
            return
          }
          resyncingRef.current = true
          setLoading(true)
          try {
            await reloadSnapshotForCurrentRun()
          } finally {
            if (runIdRef.current === runId && clientRef.current === client) {
              resyncingRef.current = false
              setLoading(false)
            }
          }
          return
        }
        const appended = appendRemoteTerminalHistoryIncrement(
          terminalHistoryRef.current,
          history
        )
        if (appended.overflowed) {
          if (resyncingRef.current) {
            return
          }
          resyncingRef.current = true
          setLoading(true)
          try {
            await reloadSnapshotForCurrentRun()
          } finally {
            if (runIdRef.current === runId && clientRef.current === client) {
              resyncingRef.current = false
              setLoading(false)
            }
          }
          return
        }
        if (appended.data) {
          terminalRef.current?.write(appended.data)
        }
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
    startTerminalSubscription,
    stopTerminalSubscription,
    t,
    updateTerminalSubscriptionCursor,
    windowId
  ])
  syncTerminalIncrementRef.current = syncTerminalIncrement

  const reloadCurrentTerminalStream = useCallback(
    async (client: RpcClient) => {
      if (resyncingRef.current) {
        return
      }
      const runId = runIdRef.current
      resyncingRef.current = true
      setLoading(true)
      setError(null)
      terminalHistoryGenerationRef.current += 1
      resetRemoteTerminalHistoryState(terminalHistoryRef.current)
      terminalInitializedRef.current = false
      try {
        const snapshot = await startTerminalSubscription(client, runId, { sinceSeq: 0 })
        if (!snapshot || runIdRef.current !== runId || clientRef.current !== client) {
          return
        }
        setTerminalRunning(true)
      } catch (err) {
        if (runIdRef.current === runId && clientRef.current === client) {
          setError(terminalErrorMessage(err, t))
        }
      } finally {
        if (runIdRef.current === runId && clientRef.current === client) {
          setLoading(false)
          resyncingRef.current = false
        }
      }
    },
    [startTerminalSubscription, t]
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
        setTerminalRunning(false)
        setError(t('terminal.stoppedOnDesktop'))
        return
      }
      const runtimeKey = terminalPaneRuntimeKey(currentPane)
      const previousRuntimeKey = currentPaneRuntimeKeyRef.current
      currentPaneRuntimeKeyRef.current = runtimeKey
      if (!currentPane.running) {
        stopTerminalSubscription()
        setTerminalRunning(false)
        setError(t('terminal.stoppedOnDesktop'))
        return
      }
      if (!terminalRunning || (previousRuntimeKey && runtimeKey && previousRuntimeKey !== runtimeKey)) {
        await reloadCurrentTerminalStream(client)
      }
    } finally {
      if (runIdRef.current === runId && clientRef.current === client) {
        paneStatusSyncInFlightRef.current = false
      }
    }
  }, [loadWindowPaneTabs, reloadCurrentTerminalStream, stopTerminalSubscription, t, terminalRunning])

  const openTerminal = useCallback(async () => {
    cleanup()
    const runId = runIdRef.current
    setLoading(true)
    setError(null)
    setConnectionState('loading')
    logsRef.current = []
    setLogs([])
    setWindowPanes([])
    setGroupWindowTabs([])
    setStartingTabPaneKey(null)
    setStopping(false)
    setTerminalRunning(true)
    setTerminalKeyboardMetrics(null)
    setLoadingOlderHistory(false)
    setHistoryNotice(null)
    resetRemoteTerminalHistoryState(terminalHistoryRef.current)
    terminalInitializedRef.current = false
    loadingOlderHistoryRef.current = false
    currentPaneRuntimeKeyRef.current = null

    try {
      const loadedHost = await loadHostById(hostId)
      if (!loadedHost) {
        throw new Error(t('terminal.hostNotFound'))
      }
      if (runIdRef.current !== runId) {
        return
      }
      const client = connectToHost(loadedHost, {
        onStateChange: (state) => {
          if (runIdRef.current === runId) {
            setConnectionState(state)
          }
        },
        onLog: (entry) => {
          if (runIdRef.current === runId) {
            appendLog(entry)
          }
        }
      })
      clientRef.current = client
      const currentPane = await loadWindowPaneTabs(client, runId)
      if (runIdRef.current !== runId || clientRef.current !== client) {
        return
      }
      currentPaneRuntimeKeyRef.current = terminalPaneRuntimeKey(currentPane)

      const snapshot = await startTerminalSubscription(client, runId)
      if (!snapshot || runIdRef.current !== runId || clientRef.current !== client) {
        return
      }

      setLoading(false)
    } catch (err) {
      if (runIdRef.current !== runId) {
        return
      }
      setError(terminalErrorMessage(err, t))
      setLoading(false)
    }
  }, [
    appendLog,
    cleanup,
    hostId,
    loadWindowPaneTabs,
    startTerminalSubscription,
    t
  ])

  useFocusEffect(
    useCallback(() => {
      void openTerminal()
      const subscription = AppState.addEventListener('change', (state) => {
        if (state === 'active') {
          clientRef.current?.notifyForeground()
          setTimeout(() => {
            void syncTerminalIncrementRef.current?.()
          }, 150)
        }
      })
      return () => {
        subscription.remove()
        cleanup()
      }
    }, [cleanup, openTerminal])
  )

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
        terminalHistoryRef.current.lastSeq = result.lastSeq
        terminalHistoryRef.current.firstSeq = result.lastSeq + 1
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

  const handlePaneTabPress = useCallback(
    async (pane: RemotePaneSummary) => {
      if (pane.paneId === paneId) {
        return
      }
      const targetPath = `/h/${hostId}/t/${encodeURIComponent(pane.windowId)}/${encodeURIComponent(pane.paneId)}`
      if (pane.running) {
        router.replace(targetPath)
        return
      }
      if (!isStartableLocalPane(pane)) {
        setError(t('terminal.onlyLocalStart'))
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
        router.replace(targetPath)
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
    [hostId, loadWindowPaneTabs, paneId, router, t]
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
      const targetPath = `/h/${hostId}/t/${encodeURIComponent(pane.windowId)}/${encodeURIComponent(pane.paneId)}`
      if (pane.running) {
        router.replace(targetPath)
        return
      }
      if (!isStartableLocalPane(pane)) {
        setError(t('terminal.onlyLocalStart'))
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
        router.replace(targetPath)
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
    [hostId, loadWindowPaneTabs, router, t, windowId]
  )

  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const nextHeight = Math.max(0, event.nativeEvent.layout.height)
      setTerminalFrameHeight((current) => current === nextHeight ? current : nextHeight)
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

  const canSend = connectionState === 'connected' && !loading && terminalRunning && !stopping

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
    terminalRef.current?.revealLiveInput()
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

  const handleHistoryTopReached = useCallback(() => {
    const client = clientRef.current
    if (
      !client ||
      loading ||
      resyncingRef.current ||
      loadingOlderHistoryRef.current ||
      !terminalHistoryRef.current.hasMoreBefore
    ) {
      return
    }
    const beforeSeq = terminalHistoryRef.current.firstSeq
    if (beforeSeq <= 1) {
      terminalHistoryRef.current.hasMoreBefore = false
      setHistoryNotice(t('terminal.historyStartReached'))
      return
    }
    const runId = runIdRef.current
    const historyGeneration = terminalHistoryGenerationRef.current
    loadingOlderHistoryRef.current = true
    setLoadingOlderHistory(true)
    setHistoryNotice(null)
    void (async () => {
      try {
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
          return
        }
        const prepended = prependRemoteTerminalHistoryPage(terminalHistoryRef.current, history)
        if (prepended.length === 0) {
          if (!history.hasMoreBefore) {
            setHistoryNotice(t('terminal.historyStartReached'))
          }
          return
        }
        if (history.gap && !history.hasMoreBefore) {
          setHistoryNotice(t('terminal.historyStartReached'))
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
      } catch (err) {
        if (runIdRef.current === runId && clientRef.current === client) {
          setError(terminalErrorMessage(err, t))
        }
      } finally {
        if (runIdRef.current === runId && clientRef.current === client) {
          loadingOlderHistoryRef.current = false
          setLoadingOlderHistory(false)
        }
      }
    })()
  }, [buildTerminalInitialData, loading, paneId, t, windowId])

  useEffect(() => {
    const updateKeyboardHeight = (event: KeyboardEvent) => {
      setKeyboardHeight(Math.max(0, event.endCoordinates.height))
    }
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'
    const showSub = Keyboard.addListener(showEvent, updateKeyboardHeight)
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0))
    return () => {
      showSub.remove()
      hideSub.remove()
      clearTerminalLiveInputFocusTimer(liveInputFocusTimerRef)
      stopAccessoryRepeat()
    }
  }, [stopAccessoryRepeat])

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
  const passiveDictationState = { isStarting: false, isRecording: false, isProcessing: false }
  const showGroupWindowTabs = groupWindowTabs.length > 1

  return (
    <>
      <Stack.Screen
        options={{
          headerTitle: '',
          headerRight: () => (
            <View style={styles.navActions}>
              <Pressable style={styles.navIconButton} onPress={() => void openTerminal()}>
                <RotateCw size={18} color={colors.textPrimary} />
              </Pressable>
              <Pressable style={styles.navIconButton} onPress={() => void handleClear()}>
                <Eraser size={18} color={colors.textPrimary} />
              </Pressable>
              <Pressable
                style={[styles.navIconButton, stopping && styles.iconButtonDisabled]}
                disabled={stopping}
                onPress={() => void handleStop()}
                accessibilityLabel={t('overview.stopTerminal')}
              >
                <Square size={17} color={colors.statusRed} fill={colors.statusRed} />
              </Pressable>
            </View>
          )
        }}
      />
      <View style={styles.container}>

      {showGroupWindowTabs ? (
        <View style={styles.paneTabs}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.paneTabContent}
          >
            {groupWindowTabs.map((window) => {
              const active = window.windowId === windowId
              const pane = getActiveTerminalPane(window.panes, window.activePaneId)
              const paneKey = pane ? `${pane.windowId}:${pane.paneId}` : window.windowId
              const starting = startingTabPaneKey === paneKey
              const disabled = !pane || (!active && !pane.running && !isStartableLocalPane(pane))
              return (
                <Pressable
                  key={window.windowId}
                  disabled={disabled || starting}
                  style={({ pressed }) => [
                    styles.paneTab,
                    active && styles.paneTabActive,
                    disabled && styles.paneTabDisabled,
                    pressed && styles.paneTabPressed
                  ]}
                  onPress={() => void handleGroupWindowTabPress(window)}
                >
                  <View
                    style={[
                      styles.paneTabDot,
                      { backgroundColor: pane ? terminalPaneStatusColor(pane) : colors.borderSubtle }
                    ]}
                  />
                  <Text
                    style={[styles.paneTabText, active && styles.paneTabTextActive]}
                    numberOfLines={1}
                  >
                    {starting ? t('common.starting') : window.name}
                  </Text>
                </Pressable>
              )
            })}
          </ScrollView>
        </View>
      ) : windowPanes.length > 1 ? (
        <View style={styles.paneTabs}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.paneTabContent}
          >
            {windowPanes.map((pane, index) => {
              const active = pane.paneId === paneId
              const paneKey = `${pane.windowId}:${pane.paneId}`
              const starting = startingTabPaneKey === paneKey
              const disabled = !active && !pane.running && !isStartableLocalPane(pane)
              return (
                <Pressable
                  key={paneKey}
                  disabled={disabled || starting}
                  style={({ pressed }) => [
                    styles.paneTab,
                    active && styles.paneTabActive,
                    disabled && styles.paneTabDisabled,
                    pressed && styles.paneTabPressed
                  ]}
                  onPress={() => void handlePaneTabPress(pane)}
                >
                  <View
                    style={[
                      styles.paneTabDot,
                      { backgroundColor: terminalPaneStatusColor(pane) }
                    ]}
                  />
                  <Text
                    style={[styles.paneTabText, active && styles.paneTabTextActive]}
                    numberOfLines={1}
                  >
                    {starting
                      ? t('common.starting')
                      : terminalPaneLabel(pane, t) || `${t('overview.pane')} ${index + 1}`}
                  </Text>
                </Pressable>
              )
            })}
          </ScrollView>
        </View>
      ) : null}

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <View style={styles.terminalFrame} onLayout={handleLayout}>
        <View
          style={[
            styles.terminalSurface,
            terminalKeyboardLift > 0 && { transform: [{ translateY: -terminalKeyboardLift }] }
          ]}
        >
          <TerminalWebView
            ref={terminalRef}
            terminalTheme={terminalTheme}
            textScale={terminalTextScale}
            textScaleMode="viewport-zoom"
            onWebReady={handleTerminalWebReady}
            onTerminalInput={handleTerminalInput}
            onEngineError={setError}
            onTextScaleChange={handleTextScaleChange}
            onKeyboardAvoidanceMetrics={handleKeyboardAvoidanceMetrics}
            onHistoryTopReached={handleHistoryTopReached}
          />
        </View>
        {loadingOlderHistory || historyNotice ? (
          <View style={styles.historyBanner}>
            {loadingOlderHistory ? <ActivityIndicator size="small" color={colors.textSecondary} /> : null}
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
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.accessoryContent}
            keyboardShouldPersistTaps="always"
          >
            <Pressable
              style={({ pressed }) => [
                styles.accessoryKey,
                pressed && styles.accessoryKeyPressed,
                !canSend && styles.accessoryKeyDisabled
              ]}
              disabled={!canSend}
              onPress={() => void handlePaste()}
              accessibilityLabel={t('terminal.pasteAccessibility')}
            >
              <Text style={[styles.accessoryKeyText, !canSend && styles.accessoryKeyTextDisabled]}>
                {t('terminal.paste')}
              </Text>
            </Pressable>
            {accessoryKeys.map((key) => (
              <Pressable
                key={key.id}
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
                  const input = createTerminalLiveAccessoryInput(key)
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
                  void handleAccessoryKey(createTerminalLiveAccessoryInput(key))
                }}
                accessibilityLabel={key.accessibilityLabel ?? t('terminal.sendKey', { key: key.label })}
              >
                <Text
                  style={[styles.accessoryKeyText, !canSend && styles.accessoryKeyTextDisabled]}
                >
                  {key.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        <View style={styles.liveInputBar}>
          <Pressable
            style={({ pressed }) => [
              styles.liveInputFocusTarget,
              pressed && styles.liveInputFocusTargetPressed,
              !canSend && styles.liveInputFocusTargetDisabled
            ]}
            disabled={!canSend}
            onPress={focusLiveInput}
            accessibilityRole="button"
            accessibilityLabel={t('terminal.showKeyboard')}
            accessibilityHint={t('terminal.showKeyboardHint')}
          >
            <KeyboardIcon size={16} color={colors.textSecondary} strokeWidth={2} />
            <MobileTerminalLiveInputStatus dictation={passiveDictationState} isAttaching={false} />
          </Pressable>
          <TextInput
            ref={liveInputRef}
            style={styles.liveInputCapture}
            value={liveInputCapture}
            onChangeText={handleLiveInputChange}
            onKeyPress={handleLiveInputKeyPress}
            onSubmitEditing={handleLiveInputSubmit}
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
  paneTabContent: {
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
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
  paneTabDisabled: {
    opacity: 0.45
  },
  paneTabPressed: {
    backgroundColor: colors.borderSubtle
  },
  paneTabDot: {
    width: 7,
    height: 7,
    borderRadius: 4
  },
  paneTabText: {
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
    zIndex: 20
  },
  accessoryBar: {
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
    backgroundColor: colors.bgPanel
  },
  accessoryContent: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    gap: spacing.xs
  },
  accessoryKey: {
    backgroundColor: colors.bgRaised,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs,
    borderRadius: radii.button,
    minWidth: 36,
    alignItems: 'center'
  },
  accessoryKeyPressed: {
    backgroundColor: colors.borderSubtle
  },
  accessoryKeyDisabled: {
    opacity: 0.35
  },
  accessoryKeyText: {
    color: colors.textSecondary,
    fontFamily: typography.monoFamily,
    fontSize: 12
  },
  accessoryKeyTextDisabled: {
    color: colors.textMuted
  },
  liveInputBar: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
    backgroundColor: colors.bgPanel
  },
  liveInputFocusTarget: {
    flex: 1,
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.bgRaised,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radii.input,
    paddingHorizontal: spacing.sm + 2
  },
  liveInputFocusTargetPressed: {
    backgroundColor: colors.borderSubtle
  },
  liveInputFocusTargetDisabled: {
    opacity: 0.45
  },
  liveInputCapture: {
    position: 'absolute',
    opacity: 0,
    width: 1,
    height: 1,
    color: colors.textPrimary
  }
})
