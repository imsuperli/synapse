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
  type LayoutChangeEvent
} from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { Eraser, Keyboard as KeyboardIcon, RotateCw, Square } from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { TerminalWebView, type TerminalWebViewHandle } from '../../../../../src/terminal/TerminalWebView'
import {
  clearTerminal,
  connectToHost,
  loadHostById,
  parseTerminalOutputEvent,
  parseTerminalSubscribeResult,
  requestTerminalHistory,
  requestWindowList,
  sendTerminalInput,
  startRemoteWindow,
  stopRemotePane,
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
import type { ConnectionLogEntry, ConnectionState, HostProfile } from '../../../../../src/transport/types'
import type { MobileTerminalTheme } from '../../../../../src/terminal/mobile-terminal-theme'
import { colors, radii, spacing, typography } from '../../../../../src/theme/mobile-theme'
import { useMobileI18n, type MobileTranslate } from '../../../../../src/i18n'

type TerminalLiveAccessoryInput = ReturnType<typeof createTerminalLiveAccessoryInput>

const DEFAULT_COLS = 80
const DEFAULT_ROWS = 24
const TERMINAL_INCREMENTAL_SYNC_MS = 1500
const TERMINAL_PANE_STATUS_SYNC_MS = 3000

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
  const runIdRef = useRef(0)
  const lastSeqRef = useRef(0)
  const resyncingRef = useRef(false)
  const viewportRef = useRef<{ cols: number; rows: number }>({
    cols: DEFAULT_COLS,
    rows: DEFAULT_ROWS
  })
  const terminalHeightRef = useRef<number | undefined>(undefined)
  const activeHandleRef = useRef<string | null>(terminalHandle)
  const activeSessionTabTypeRef = useRef<'terminal' | null>('terminal')
  const liveInputRef = useRef<TextInput | null>(null)
  const liveInputFocusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const repeatTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const repeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const sendLiveTerminalInputRef = useRef<TerminalLiveInputSender>(async () => false)
  const [host, setHost] = useState<HostProfile | null>(null)
  const [connectionState, setConnectionState] = useState<ConnectionState | 'loading'>('loading')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [logs, setLogs] = useState<ConnectionLogEntry[]>([])
  const [liveInputCapture, setLiveInputCapture] = useState('')
  const [keyboardHeight, setKeyboardHeight] = useState(0)
  const [windowPanes, setWindowPanes] = useState<RemotePaneSummary[]>([])
  const [startingTabPaneKey, setStartingTabPaneKey] = useState<string | null>(null)
  const [stopping, setStopping] = useState(false)
  const [terminalRunning, setTerminalRunning] = useState(true)
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

  const cleanup = useCallback(() => {
    runIdRef.current += 1
    resyncingRef.current = false
    unsubscribeRef.current?.()
    unsubscribeRef.current = null
    clientRef.current?.close()
    clientRef.current = null
    clearTerminalLiveInputFocusTimer(liveInputFocusTimerRef)
    stopAccessoryRepeat()
  }, [stopAccessoryRepeat])

  const measureAndFitLocalTerminal = useCallback(async () => {
    const terminal = terminalRef.current
    if (!terminal) {
      return
    }
    const measured = await terminal.measureFitDimensions(terminalHeightRef.current)
    if (!measured) {
      return
    }
    viewportRef.current = measured
    terminal.resize(measured.cols, measured.rows)
  }, [])

  const loadWindowPaneTabs = useCallback(
    async (client: RpcClient) => {
      try {
        const windows = await requestWindowList(client)
        const currentWindow = windows.find((window) => window.windowId === windowId)
        setWindowPanes(currentWindow?.panes.filter((pane) => pane.kind === 'terminal') ?? [])
        return currentWindow?.panes.find((pane) => pane.paneId === paneId && pane.kind === 'terminal') ?? null
      } catch {
        setWindowPanes([])
        return null
      }
    },
    [paneId, windowId]
  )

  const loadTerminalHistorySnapshot = useCallback(
    async (client: RpcClient, runId: number) => {
      const history = await requestTerminalHistory(client, windowId, paneId)
      if (runIdRef.current !== runId) {
        return null
      }
      lastSeqRef.current = history.lastSeq
      terminalRef.current?.init(
        viewportRef.current.cols,
        viewportRef.current.rows,
        history.chunks.join(''),
        false
      )
      await terminalRef.current?.awaitReady()
      if (runIdRef.current !== runId) {
        return null
      }
      return history
    },
    [paneId, windowId]
  )

  const startTerminalSubscription = useCallback(
    (client: RpcClient, runId: number) => {
      unsubscribeRef.current?.()
      const subscribeParams = {
        windowId,
        paneId,
        sinceSeq: lastSeqRef.current
      }
      unsubscribeRef.current = client.subscribe(
        'terminal.subscribe',
        subscribeParams,
        (payload) => {
          const subscription = parseTerminalSubscribeResult(payload)
          if (subscription) {
            if (subscription.gap) {
              lastSeqRef.current = Math.max(lastSeqRef.current, subscription.lastSeq)
              subscribeParams.sinceSeq = lastSeqRef.current
            }
            if (subscription.gap && !resyncingRef.current) {
              resyncingRef.current = true
              setLoading(true)
              unsubscribeRef.current?.()
              unsubscribeRef.current = null
              void (async () => {
                try {
                  const history = await loadTerminalHistorySnapshot(client, runId)
                  if (!history || runIdRef.current !== runId) {
                    return
                  }
                  await measureAndFitLocalTerminal()
                  if (runIdRef.current !== runId) {
                    return
                  }
                  startTerminalSubscription(client, runId)
                  setLoading(false)
                } catch (err) {
                  if (runIdRef.current === runId) {
                    setError(err instanceof Error ? err.message : String(err))
                    setLoading(false)
                  }
                } finally {
                  resyncingRef.current = false
                }
              })()
            }
            return
          }

          const event = parseTerminalOutputEvent(payload)
          if (!event || event.windowId !== windowId || event.paneId !== paneId) {
            return
          }
          if (event.seq > 0 && event.seq <= lastSeqRef.current) {
            return
          }
          lastSeqRef.current = Math.max(lastSeqRef.current, event.seq)
          subscribeParams.sinceSeq = lastSeqRef.current
          terminalRef.current?.write(event.data)
        }
      )
    },
    [loadTerminalHistorySnapshot, measureAndFitLocalTerminal, paneId, windowId]
  )

  const syncTerminalIncrement = useCallback(async () => {
    const client = clientRef.current
    if (!client || loading || resyncingRef.current) {
      return
    }
    try {
      const sinceSeq = lastSeqRef.current
      const history = await requestTerminalHistory(client, windowId, paneId, sinceSeq)
      if (history.gap) {
        if (resyncingRef.current) {
          return
        }
        resyncingRef.current = true
        setLoading(true)
        try {
          await loadTerminalHistorySnapshot(client, runIdRef.current)
          await measureAndFitLocalTerminal()
        } finally {
          resyncingRef.current = false
          setLoading(false)
        }
        return
      }
      if (history.lastSeq <= sinceSeq || history.chunks.length === 0) {
        lastSeqRef.current = Math.max(lastSeqRef.current, history.lastSeq)
        return
      }
      if (lastSeqRef.current !== sinceSeq) {
        return
      }
      terminalRef.current?.write(history.chunks.join(''))
      lastSeqRef.current = Math.max(lastSeqRef.current, history.lastSeq)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (/terminal not found|terminal_not_found/i.test(message)) {
        setTerminalRunning(false)
        setError(t('terminal.stoppedOnDesktop'))
      }
    }
  }, [
    loadTerminalHistorySnapshot,
    loading,
    measureAndFitLocalTerminal,
    paneId,
    t,
    windowId
  ])

  const syncPaneStatus = useCallback(async () => {
    const client = clientRef.current
    if (!client) {
      return
    }
    const currentPane = await loadWindowPaneTabs(client)
    if (currentPane && !currentPane.running) {
      setTerminalRunning(false)
      setError(t('terminal.stoppedOnDesktop'))
    }
  }, [loadWindowPaneTabs, t])

  const openTerminal = useCallback(async () => {
    cleanup()
    const runId = runIdRef.current
    setLoading(true)
    setError(null)
    setConnectionState('loading')
    logsRef.current = []
    setLogs([])
    setWindowPanes([])
    setStartingTabPaneKey(null)
    setStopping(false)
    setTerminalRunning(true)

    try {
      const loadedHost = await loadHostById(hostId)
      if (!loadedHost) {
        throw new Error(t('terminal.hostNotFound'))
      }
      if (runIdRef.current !== runId) {
        return
      }
      setHost(loadedHost)
      const client = connectToHost(loadedHost, {
        onStateChange: setConnectionState,
        onLog: appendLog
      })
      clientRef.current = client
      void loadWindowPaneTabs(client)

      const history = await loadTerminalHistorySnapshot(client, runId)
      if (!history || runIdRef.current !== runId) {
        return
      }
      await measureAndFitLocalTerminal()
      if (runIdRef.current !== runId) {
        return
      }

      startTerminalSubscription(client, runId)
      setLoading(false)
    } catch (err) {
      if (runIdRef.current !== runId) {
        return
      }
      setError(err instanceof Error ? err.message : String(err))
      setLoading(false)
    }
  }, [
    appendLog,
    cleanup,
    hostId,
    loadWindowPaneTabs,
    loadTerminalHistorySnapshot,
    measureAndFitLocalTerminal,
    startTerminalSubscription,
    t
  ])

  useFocusEffect(
    useCallback(() => {
      void openTerminal()
      const subscription = AppState.addEventListener('change', (state) => {
        if (state === 'active') {
          clientRef.current?.notifyForeground()
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
      void sendTerminalInput(client, windowId, paneId, bytes).catch((err) => {
        setError(err instanceof Error ? err.message : String(err))
      })
    },
    [paneId, windowId]
  )

  const handleClear = useCallback(async () => {
    const client = clientRef.current
    if (!client) {
      return
    }
    try {
      const result = await clearTerminal(client, windowId, paneId)
      if (result.windowId === windowId && result.paneId === paneId) {
        lastSeqRef.current = Math.max(lastSeqRef.current, result.lastSeq)
      }
      terminalRef.current?.clear()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [paneId, windowId])

  const handleStop = useCallback(async () => {
    const client = clientRef.current
    if (!client || stopping) {
      return
    }
    setStopping(true)
    setError(null)
    try {
      await stopRemotePane(client, windowId, paneId)
      setTerminalRunning(false)
      setError(t('terminal.stopped'))
      router.replace(`/h/${hostId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setStopping(false)
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
      const paneKey = `${pane.windowId}:${pane.paneId}`
      setStartingTabPaneKey(paneKey)
      setError(null)
      try {
        await startRemoteWindow(client, pane.windowId, pane.paneId)
        await loadWindowPaneTabs(client)
        router.replace(targetPath)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setStartingTabPaneKey(null)
      }
    },
    [hostId, loadWindowPaneTabs, paneId, router, t]
  )

  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      terminalHeightRef.current = event.nativeEvent.layout.height
      void measureAndFitLocalTerminal()
    },
    [measureAndFitLocalTerminal]
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
      return sendTerminalInput(client, windowId, paneId, text).then(
        () => true,
        (err) => {
          setError(err instanceof Error ? err.message : String(err))
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
    const updateKeyboardHeight = (event: KeyboardEvent) => {
      setKeyboardHeight(Math.max(0, event.endCoordinates.height - insets.bottom))
    }
    const showSub = Keyboard.addListener('keyboardDidShow', updateKeyboardHeight)
    const hideSub = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0))
    return () => {
      showSub.remove()
      hideSub.remove()
      clearTerminalLiveInputFocusTimer(liveInputFocusTimerRef)
      stopAccessoryRepeat()
    }
  }, [insets.bottom, stopAccessoryRepeat])

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

  const keyboardLift = keyboardHeight > 0 ? keyboardHeight : 0
  const passiveDictationState = { isStarting: false, isRecording: false, isProcessing: false }

  return (
    <View style={styles.container}>
      <View style={styles.toolbar}>
        <View style={styles.titleBlock}>
          <Text style={styles.title}>{host?.name ?? t('common.terminal')}</Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {windowId}:{paneId} - {connectionLabel(connectionState, t)}
          </Text>
        </View>
        <View style={styles.toolbarActions}>
          <Pressable style={styles.iconButton} onPress={() => void openTerminal()}>
            <RotateCw size={18} color={colors.textPrimary} />
          </Pressable>
          <Pressable style={styles.iconButton} onPress={() => void handleClear()}>
            <Eraser size={18} color={colors.textPrimary} />
          </Pressable>
          <Pressable
            style={[styles.iconButton, stopping && styles.iconButtonDisabled]}
            disabled={stopping}
            onPress={() => void handleStop()}
            accessibilityLabel={t('overview.stopTerminal')}
          >
            <Square size={17} color={colors.statusRed} fill={colors.statusRed} />
          </Pressable>
        </View>
      </View>

      {windowPanes.length > 1 ? (
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
        <TerminalWebView
          ref={terminalRef}
          terminalTheme={terminalTheme}
          onWebReady={() => void measureAndFitLocalTerminal()}
          onTerminalInput={handleTerminalInput}
          onEngineError={setError}
        />
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
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgBase
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle
  },
  titleBlock: {
    flex: 1,
    minWidth: 0
  },
  title: {
    color: colors.textPrimary,
    fontSize: typography.bodySize,
    fontWeight: '700'
  },
  subtitle: {
    color: colors.textSecondary,
    fontFamily: typography.monoFamily,
    fontSize: typography.metaSize,
    marginTop: 2
  },
  toolbarActions: {
    flexDirection: 'row',
    gap: spacing.sm
  },
  iconButton: {
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
    backgroundColor: colors.terminalBg
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
