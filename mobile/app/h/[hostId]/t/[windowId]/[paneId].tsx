import { useCallback, useRef, useState } from 'react'
import {
  ActivityIndicator,
  AppState,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent
} from 'react-native'
import { useFocusEffect, useLocalSearchParams } from 'expo-router'
import { Eraser, RotateCw } from 'lucide-react-native'
import { TerminalWebView, type TerminalWebViewHandle } from '../../../../../src/terminal/TerminalWebView'
import {
  clearTerminal,
  connectToHost,
  loadHostById,
  parseTerminalOutputEvent,
  parseTerminalSubscribeResult,
  requestTerminalHistory,
  resizeTerminal,
  sendTerminalInput
} from '../../../../../src/synapse/remote'
import type { RpcClient } from '../../../../../src/transport/rpc-client'
import type { ConnectionLogEntry, ConnectionState, HostProfile } from '../../../../../src/transport/types'
import type { MobileTerminalTheme } from '../../../../../src/terminal/mobile-terminal-theme'
import { colors, radii, spacing, typography } from '../../../../../src/theme/mobile-theme'

const DEFAULT_COLS = 80
const DEFAULT_ROWS = 24

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

export default function RemoteTerminalScreen() {
  const params = useLocalSearchParams<{ hostId?: string; windowId?: string; paneId?: string }>()
  const hostId = getParam(params.hostId)
  const windowId = getParam(params.windowId)
  const paneId = getParam(params.paneId)
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
  const [host, setHost] = useState<HostProfile | null>(null)
  const [connectionState, setConnectionState] = useState<ConnectionState | 'loading'>('loading')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [logs, setLogs] = useState<ConnectionLogEntry[]>([])
  const logsRef = useRef<ConnectionLogEntry[]>([])

  const appendLog = useCallback((entry: ConnectionLogEntry) => {
    logsRef.current = [...logsRef.current, entry].slice(-40)
    setLogs(logsRef.current)
  }, [])

  const cleanup = useCallback(() => {
    runIdRef.current += 1
    resyncingRef.current = false
    unsubscribeRef.current?.()
    unsubscribeRef.current = null
    clientRef.current?.close()
    clientRef.current = null
  }, [])

  const measureAndResize = useCallback(async () => {
    const client = clientRef.current
    const terminal = terminalRef.current
    if (!client || !terminal) {
      return
    }
    const measured = await terminal.measureFitDimensions(terminalHeightRef.current)
    if (!measured) {
      return
    }
    viewportRef.current = measured
    terminal.resize(measured.cols, measured.rows)
    await resizeTerminal(client, windowId, paneId, measured.cols, measured.rows).catch((err) => {
      setError(err instanceof Error ? err.message : String(err))
    })
  }, [paneId, windowId])

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
        sinceSeq: lastSeqRef.current,
        viewport: viewportRef.current
      }
      unsubscribeRef.current = client.subscribe(
        'terminal.subscribe',
        subscribeParams,
        (payload) => {
          const subscription = parseTerminalSubscribeResult(payload)
          if (subscription) {
            lastSeqRef.current = Math.max(lastSeqRef.current, subscription.lastSeq)
            subscribeParams.sinceSeq = lastSeqRef.current
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
                  await measureAndResize()
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
    [loadTerminalHistorySnapshot, measureAndResize, paneId, windowId]
  )

  const openTerminal = useCallback(async () => {
    cleanup()
    const runId = runIdRef.current
    setLoading(true)
    setError(null)
    setConnectionState('loading')
    logsRef.current = []
    setLogs([])

    try {
      const loadedHost = await loadHostById(hostId)
      if (!loadedHost) {
        throw new Error('Host not found. Pair this desktop again.')
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

      const history = await loadTerminalHistorySnapshot(client, runId)
      if (!history || runIdRef.current !== runId) {
        return
      }
      await measureAndResize()
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
    loadTerminalHistorySnapshot,
    measureAndResize,
    startTerminalSubscription
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

  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      terminalHeightRef.current = event.nativeEvent.layout.height
      void measureAndResize()
    },
    [measureAndResize]
  )

  return (
    <View style={styles.container}>
      <View style={styles.toolbar}>
        <View style={styles.titleBlock}>
          <Text style={styles.title}>{host?.name ?? 'Terminal'}</Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {windowId}:{paneId} - {connectionLabel(connectionState)}
          </Text>
        </View>
        <View style={styles.toolbarActions}>
          <Pressable style={styles.iconButton} onPress={() => void openTerminal()}>
            <RotateCw size={18} color={colors.textPrimary} />
          </Pressable>
          <Pressable style={styles.iconButton} onPress={() => void handleClear()}>
            <Eraser size={18} color={colors.textPrimary} />
          </Pressable>
        </View>
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <View style={styles.terminalFrame} onLayout={handleLayout}>
        <TerminalWebView
          ref={terminalRef}
          terminalTheme={terminalTheme}
          onWebReady={() => void measureAndResize()}
          onTerminalInput={handleTerminalInput}
          onEngineError={setError}
        />
        {loading ? (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator color={colors.textSecondary} />
            <Text style={styles.loadingText}>Loading terminal...</Text>
          </View>
        ) : null}
      </View>

      {logs.length > 0 && error ? (
        <View style={styles.logPreview}>
          <Text style={styles.logText}>{logs[logs.length - 1]?.message}</Text>
        </View>
      ) : null}
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
  }
})
