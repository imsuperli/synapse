import { useCallback, useRef, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native'
import { Pressable } from '../src/components/Pressable'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Check, X } from 'lucide-react-native'
import { ConnectionLog } from '../src/components/ConnectionLog'
import { savePairedHost } from '../src/transport/host-store'
import { resolvePairConfirmRouteState } from '../src/transport/pair-confirm-state'
import {
  startPairingConnectionAttempt,
  type PairingConnectionAttempt
} from '../src/transport/pairing-connection-attempt'
import { connect } from '../src/transport/rpc-client'
import { parseRemoteStatus } from '../src/synapse/remote'
import type { ConnectionLogEntry, PairingOffer, RpcResponse } from '../src/transport/types'
import { colors, radii, spacing, typography } from '../src/theme/mobile-theme'
import { normalizeRelayEndpoint } from '../../src/shared/remote/relay'
import { useMobileI18n, type MobileTranslate } from '../src/i18n'

const PAIRING_OVERALL_TIMEOUT_MS = 25_000

function routeErrorMessage(
  errorCode: 'missing-code' | 'invalid-code' | null,
  t: MobileTranslate
): string {
  switch (errorCode) {
    case 'missing-code':
      return t('confirm.missingCode')
    case 'invalid-code':
      return t('confirm.invalidCode')
    case null:
      return ''
  }
}

export default function PairConfirmScreen() {
  const router = useRouter()
  const { t } = useMobileI18n()
  const params = useLocalSearchParams<{ code?: string }>()
  const state = resolvePairConfirmRouteState(
    Array.isArray(params.code) ? params.code[0] : params.code
  )
  const initialOffer = state.kind === 'ready' ? state.offer : null
  const [status, setStatus] = useState<'ready' | 'connecting' | 'error'>(
    state.kind === 'ready' ? 'ready' : 'error'
  )
  const [errorMessage, setErrorMessage] = useState('')
  const [relayEndpointInput, setRelayEndpointInput] = useState(initialOffer?.relayEndpoint ?? '')
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

      const relay = createRelayConnectConfig(offer, relayEndpointInput)
      let response: RpcResponse
      try {
        client = connect(offer.endpoint, offer.deviceToken, offer.publicKeyB64, {
          relay,
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
            ? t('confirm.connectTimeout', { seconds: PAIRING_OVERALL_TIMEOUT_MS / 1000 })
            : t('confirm.connectFailed', {
                message: err instanceof Error ? err.message : String(err)
              })
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
            ? t('confirm.authFailed')
            : t('confirm.rejected', { message: response.error.message })
        )
        return
      }

      try {
        const advertisedDirectEndpoint =
          parseRemoteStatus(response.result).directEndpoint ?? offer.endpoint
        const savedHost = await savePairedHost({
          name: offer.hostName,
          endpoint: advertisedDirectEndpoint,
          deviceToken: offer.deviceToken,
          publicKeyB64: offer.publicKeyB64,
          ...(offer.relaySessionId && offer.relayClientToken && relay
            ? {
                relayEndpoint: relay.endpoint,
                relaySessionId: offer.relaySessionId,
                relayClientToken: offer.relayClientToken
              }
            : {})
        })
        router.replace(`/h/${savedHost.id}`)
      } catch (err) {
        setStatus('error')
        setErrorMessage(
          t('confirm.saveFailed', { message: err instanceof Error ? err.message : String(err) })
        )
      }
    },
    [appendLog, relayEndpointInput, router, t]
  )

  const offer = state.kind === 'ready' ? state.offer : null
  const displayErrorMessage = errorMessage || routeErrorMessage(state.errorCode, t)

  return (
    <View ref={setRootRef} style={styles.container}>
      <View style={styles.panel}>
        <Text style={styles.title}>{t('confirm.title')}</Text>
        {offer ? (
          <>
            <Text style={styles.label}>{t('confirm.desktopEndpoint')}</Text>
            <Text style={styles.endpoint} numberOfLines={2}>
              {offer.endpoint}
            </Text>
            {offer.relayEndpoint && offer.relaySessionId && offer.relayClientToken ? (
              <>
                <Text style={styles.label}>{t('confirm.relayEndpoint')}</Text>
                <TextInput
                  value={relayEndpointInput}
                  onChangeText={setRelayEndpointInput}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  style={styles.input}
                  placeholder="wss://relay.example.com/v1/relay"
                  placeholderTextColor={colors.textMuted}
                />
              </>
            ) : null}
            {offer.hostName ? <Text style={styles.hostName}>{offer.hostName}</Text> : null}
          </>
        ) : null}

        {status === 'connecting' ? (
          <View style={styles.statusBlock}>
            <ActivityIndicator color={colors.textSecondary} />
            <Text style={styles.statusText}>{t('confirm.connecting')}</Text>
          </View>
        ) : null}

        {status === 'error' ? (
          <View style={styles.statusBlock}>
            <X size={22} color={colors.statusRed} />
            <Text style={styles.errorText}>{displayErrorMessage}</Text>
          </View>
        ) : null}

        {logs.length > 0 ? <ConnectionLog entries={logs} title={t('confirm.pairingLog')} /> : null}

        <View style={styles.actions}>
          <Pressable style={styles.secondaryButton} onPress={() => router.replace('/')}>
            <Text style={styles.secondaryButtonText}>{t('confirm.cancel')}</Text>
          </Pressable>
          <Pressable
            disabled={!offer || status === 'connecting'}
            style={[styles.primaryButton, (!offer || status === 'connecting') && styles.disabled]}
            onPress={() => offer && void pairAndSave(offer)}
          >
            <Check size={16} color={colors.bgBase} />
            <Text style={styles.primaryButtonText}>{t('confirm.pair')}</Text>
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
  },
  input: {
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.bgPanel,
    borderRadius: radii.button,
    fontFamily: typography.monoFamily,
    fontSize: typography.metaSize,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  }
})

function createRelayConnectConfig(offer: PairingOffer, relayEndpointInput: string) {
  if (!offer.relayEndpoint || !offer.relaySessionId || !offer.relayClientToken) {
    return undefined
  }
  return {
    endpoint: normalizeRelayEndpoint(relayEndpointInput || offer.relayEndpoint),
    sessionId: offer.relaySessionId,
    clientToken: offer.relayClientToken
  }
}
