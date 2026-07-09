import { useCallback, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Check, X } from 'lucide-react-native'
import { ConnectionLog } from '../src/components/ConnectionLog'
import { getNextHostName, saveHost } from '../src/transport/host-store'
import { resolvePairConfirmRouteState } from '../src/transport/pair-confirm-state'
import {
  startPairingConnectionAttempt,
  type PairingConnectionAttempt
} from '../src/transport/pairing-connection-attempt'
import { connect } from '../src/transport/rpc-client'
import type { ConnectionLogEntry, PairingOffer, RpcResponse } from '../src/transport/types'
import { colors, radii, spacing, typography } from '../src/theme/mobile-theme'

const PAIRING_OVERALL_TIMEOUT_MS = 25_000

export default function PairConfirmScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{ code?: string }>()
  const state = resolvePairConfirmRouteState(
    Array.isArray(params.code) ? params.code[0] : params.code
  )
  const [status, setStatus] = useState<'ready' | 'connecting' | 'error'>(
    state.kind === 'ready' ? 'ready' : 'error'
  )
  const [errorMessage, setErrorMessage] = useState(
    state.kind === 'error' ? state.errorMessage : ''
  )
  const [logs, setLogs] = useState<ConnectionLogEntry[]>([])
  const logsRef = useRef<ConnectionLogEntry[]>([])
  const activeAttemptRef = useRef<PairingConnectionAttempt | null>(null)
  const mountedRef = useRef(true)

  const setRootRef = useCallback((node: View | null) => {
    if (node) {
      mountedRef.current = true
      return
    }
    mountedRef.current = false
    activeAttemptRef.current?.dispose()
    activeAttemptRef.current = null
  }, [])

  const appendLog = useCallback((entry: ConnectionLogEntry) => {
    logsRef.current = [...logsRef.current, entry]
    setLogs(logsRef.current)
  }, [])

  const pairAndSave = useCallback(
    async (offer: PairingOffer) => {
      setStatus('connecting')
      setErrorMessage('')
      logsRef.current = []
      setLogs([])
      let client: ReturnType<typeof connect> | null = null
      activeAttemptRef.current?.dispose()
      const attempt = startPairingConnectionAttempt({
        timeoutMs: PAIRING_OVERALL_TIMEOUT_MS,
        closeClient: () => client?.close()
      })
      activeAttemptRef.current = attempt

      let response: RpcResponse
      try {
        client = connect(offer.endpoint, offer.deviceToken, offer.publicKeyB64, {
          onLog: (entry) => {
            if (mountedRef.current && activeAttemptRef.current === attempt) {
              appendLog(entry)
            }
          }
        })
        response = await client.sendRequest('status.get')
      } catch (err) {
        const timedOut = attempt.timedOut
        const current = activeAttemptRef.current === attempt
        attempt.dispose()
        if (activeAttemptRef.current === attempt) {
          activeAttemptRef.current = null
        }
        if (!mountedRef.current || !current) {
          return
        }
        setStatus('error')
        setErrorMessage(
          timedOut
            ? `Couldn't connect within ${PAIRING_OVERALL_TIMEOUT_MS / 1000}s. Check the desktop endpoint.`
            : `Cannot connect to Synapse desktop: ${err instanceof Error ? err.message : String(err)}`
        )
        return
      }

      const current = activeAttemptRef.current === attempt
      attempt.dispose()
      if (activeAttemptRef.current === attempt) {
        activeAttemptRef.current = null
      }
      if (!mountedRef.current || !current) {
        return
      }

      if (!response.ok) {
        setStatus('error')
        setErrorMessage(
          response.error.code === 'unauthorized'
            ? 'Authentication failed. Regenerate the QR code on desktop and pair again.'
            : `Synapse desktop rejected pairing: ${response.error.message}`
        )
        return
      }

      try {
        const hostId = `host-${Date.now()}`
        await saveHost({
          id: hostId,
          name: offer.hostName || (await getNextHostName()),
          endpoint: offer.endpoint,
          deviceToken: offer.deviceToken,
          publicKeyB64: offer.publicKeyB64,
          relaySessionId: offer.relaySessionId,
          lastConnected: Date.now()
        })
        router.replace(`/h/${hostId}`)
      } catch (err) {
        setStatus('error')
        setErrorMessage(
          `Pairing succeeded but saving the host failed: ${err instanceof Error ? err.message : String(err)}`
        )
      }
    },
    [appendLog, router]
  )

  const offer = state.kind === 'ready' ? state.offer : null

  return (
    <View ref={setRootRef} style={styles.container}>
      <View style={styles.panel}>
        <Text style={styles.title}>Confirm Pairing</Text>
        {offer ? (
          <>
            <Text style={styles.label}>Desktop endpoint</Text>
            <Text style={styles.endpoint} numberOfLines={2}>
              {offer.endpoint}
            </Text>
            {offer.hostName ? <Text style={styles.hostName}>{offer.hostName}</Text> : null}
          </>
        ) : null}

        {status === 'connecting' ? (
          <View style={styles.statusBlock}>
            <ActivityIndicator color={colors.textSecondary} />
            <Text style={styles.statusText}>Connecting...</Text>
          </View>
        ) : null}

        {status === 'error' ? (
          <View style={styles.statusBlock}>
            <X size={22} color={colors.statusRed} />
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        ) : null}

        {logs.length > 0 ? <ConnectionLog entries={logs} title="Pairing log" /> : null}

        <View style={styles.actions}>
          <Pressable style={styles.secondaryButton} onPress={() => router.replace('/')}>
            <Text style={styles.secondaryButtonText}>Cancel</Text>
          </Pressable>
          <Pressable
            disabled={!offer || status === 'connecting'}
            style={[styles.primaryButton, (!offer || status === 'connecting') && styles.disabled]}
            onPress={() => offer && void pairAndSave(offer)}
          >
            <Check size={16} color={colors.bgBase} />
            <Text style={styles.primaryButtonText}>Pair</Text>
          </Pressable>
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: colors.bgBase,
    padding: spacing.lg
  },
  panel: {
    gap: spacing.md
  },
  title: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: '700'
  },
  label: {
    color: colors.textMuted,
    fontFamily: typography.monoFamily,
    fontSize: typography.metaSize,
    textTransform: 'uppercase'
  },
  endpoint: {
    color: colors.textPrimary,
    fontFamily: typography.monoFamily,
    fontSize: typography.bodySize,
    lineHeight: 20
  },
  hostName: {
    color: colors.textSecondary,
    fontSize: typography.bodySize
  },
  statusBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm
  },
  statusText: {
    color: colors.textSecondary,
    fontSize: typography.bodySize
  },
  errorText: {
    flex: 1,
    color: colors.statusRed,
    fontSize: typography.bodySize,
    lineHeight: 20
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.sm
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.textPrimary,
    borderRadius: radii.button,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm
  },
  primaryButtonText: {
    color: colors.bgBase,
    fontWeight: '700'
  },
  secondaryButton: {
    borderRadius: radii.button,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm
  },
  secondaryButtonText: {
    color: colors.textSecondary,
    fontWeight: '600'
  },
  disabled: {
    opacity: 0.45
  }
})
