import { useCallback, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent
} from 'react-native'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ChevronLeft, Clipboard, QrCode } from 'lucide-react-native'
import { ConnectionLog } from '../src/components/ConnectionLog'
import { TextInputModal } from '../src/components/TextInputModal'
import { getNextHostName, saveHost } from '../src/transport/host-store'
import { decodePairingUrl, parsePairingCode } from '../src/transport/pairing'
import {
  startPairingConnectionAttempt,
  type PairingConnectionAttempt
} from '../src/transport/pairing-connection-attempt'
import { connect } from '../src/transport/rpc-client'
import type { ConnectionLogEntry, PairingOffer, RpcResponse } from '../src/transport/types'
import { colors, radii, spacing, typography } from '../src/theme/mobile-theme'

const PAIRING_OVERALL_TIMEOUT_MS = 25_000
const SCAN_RETICLE_SCALE = 0.62
const SCAN_RETICLE_MAX_SIZE = 360

type PairingStatus = 'scanning' | 'connecting' | 'error'

function Step({ number, text }: { number: number; text: string }) {
  return (
    <View style={styles.step}>
      <View style={styles.stepBadge}>
        <Text style={styles.stepNumber}>{number}</Text>
      </View>
      <Text style={styles.stepText}>{text}</Text>
    </View>
  )
}

export default function PairScanScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [permission, requestPermission] = useCameraPermissions()
  const [status, setStatus] = useState<PairingStatus>('scanning')
  const [errorMessage, setErrorMessage] = useState('')
  const [pasteVisible, setPasteVisible] = useState(false)
  const [cameraBounds, setCameraBounds] = useState({ width: 0, height: 0 })
  const [logs, setLogs] = useState<ConnectionLogEntry[]>([])
  const logsRef = useRef<ConnectionLogEntry[]>([])
  const processingRef = useRef(false)
  const mountedRef = useRef(true)
  const activeAttemptRef = useRef<PairingConnectionAttempt | null>(null)

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
            ? `Couldn't connect within ${PAIRING_OVERALL_TIMEOUT_MS / 1000}s. Check the log and desktop endpoint.`
            : `Cannot connect to Synapse desktop: ${err instanceof Error ? err.message : String(err)}`
        )
        processingRef.current = false
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
        processingRef.current = false
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
        processingRef.current = false
      }
    },
    [appendLog, router]
  )

  const handleCode = useCallback(
    (input: string, fromQr: boolean) => {
      if (processingRef.current) {
        return
      }
      processingRef.current = true
      const offer = fromQr ? decodePairingUrl(input) : parsePairingCode(input)
      if (!offer) {
        setStatus('error')
        setErrorMessage(
          fromQr
            ? 'Not a valid Synapse pairing QR code.'
            : 'Not a valid pairing code. Copy the code from Synapse desktop and paste again.'
        )
        processingRef.current = false
        return
      }
      void pairAndSave(offer)
    },
    [pairAndSave]
  )

  const handleCameraLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout
    const nextBounds = { width: Math.round(width), height: Math.round(height) }
    setCameraBounds((current) =>
      current.width === nextBounds.width && current.height === nextBounds.height
        ? current
        : nextBounds
    )
  }, [])

  const retry = useCallback(() => {
    activeAttemptRef.current?.dispose()
    activeAttemptRef.current = null
    logsRef.current = []
    setLogs([])
    setStatus('scanning')
    setErrorMessage('')
    processingRef.current = false
  }, [])

  const containerPadding = {
    paddingTop: insets.top + spacing.sm,
    paddingBottom: insets.bottom + spacing.sm
  }
  const reticleSize = Math.min(
    Math.round(Math.min(cameraBounds.width, cameraBounds.height) * SCAN_RETICLE_SCALE),
    SCAN_RETICLE_MAX_SIZE
  )

  if (!permission) {
    return (
      <View ref={setRootRef} style={[styles.container, containerPadding]}>
        <ActivityIndicator color={colors.textSecondary} />
      </View>
    )
  }

  if (!permission.granted) {
    const canAskAgain = permission.canAskAgain !== false
    return (
      <View ref={setRootRef} style={[styles.container, containerPadding]}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <ChevronLeft size={22} color={colors.textSecondary} />
        </Pressable>
        <View style={styles.centered}>
          <Text style={styles.title}>
            {canAskAgain ? 'Pair Synapse Desktop' : 'Camera Access Disabled'}
          </Text>
          <Text style={styles.subtitle}>
            {canAskAgain
              ? 'Scan the QR code from Synapse desktop, or paste the pairing code.'
              : 'Enable camera access in Settings, or paste the pairing code instead.'}
          </Text>
          <Pressable
            style={styles.primaryButton}
            onPress={canAskAgain ? requestPermission : () => void Linking.openSettings()}
          >
            {canAskAgain ? <QrCode size={16} color={colors.bgBase} /> : null}
            <Text style={styles.primaryButtonText}>
              {canAskAgain ? 'Continue' : 'Open Settings'}
            </Text>
          </Pressable>
          <Pressable style={styles.pasteButton} onPress={() => setPasteVisible(true)}>
            <Clipboard size={16} color={colors.textSecondary} />
            <Text style={styles.pasteButtonText}>Paste code instead</Text>
          </Pressable>
        </View>
        <PairingPasteSheet
          visible={pasteVisible}
          onCancel={() => setPasteVisible(false)}
          onSubmit={(value) => {
            setPasteVisible(false)
            handleCode(value, false)
          }}
        />
      </View>
    )
  }

  return (
    <View ref={setRootRef} style={[styles.container, containerPadding]}>
      <Pressable style={styles.backButton} onPress={() => router.back()}>
        <ChevronLeft size={22} color={colors.textSecondary} />
      </Pressable>

      <View style={styles.steps}>
        <Step number={1} text="Open Synapse desktop" />
        <Step number={2} text="Go to Settings > Remote" />
        <Step number={3} text="Scan the QR code" />
      </View>

      {status === 'scanning' ? (
        <>
          {!pasteVisible ? (
            <View style={styles.cameraWrap} onLayout={handleCameraLayout}>
              <CameraView
                style={styles.camera}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={({ data }) => handleCode(data, true)}
              />
              <View style={styles.reticle} pointerEvents="none">
                <View style={[styles.reticleFrame, { width: reticleSize, height: reticleSize }]}>
                  <View style={[styles.corner, styles.cornerTL]} />
                  <View style={[styles.corner, styles.cornerTR]} />
                  <View style={[styles.corner, styles.cornerBL]} />
                  <View style={[styles.corner, styles.cornerBR]} />
                </View>
              </View>
            </View>
          ) : (
            <View style={styles.cameraPlaceholder} />
          )}
          <Pressable style={styles.pasteButton} onPress={() => setPasteVisible(true)}>
            <Clipboard size={16} color={colors.textSecondary} />
            <Text style={styles.pasteButtonText}>Or paste pairing code</Text>
          </Pressable>
        </>
      ) : null}

      {status === 'connecting' ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.textSecondary} />
          <Text style={styles.connectingText}>Connecting to Synapse desktop...</Text>
          <View style={styles.logSlot}>
            <ConnectionLog entries={logs} title="Pairing log" />
          </View>
        </View>
      ) : null}

      {status === 'error' ? (
        <View style={styles.centered}>
          <Text style={styles.errorText}>{errorMessage}</Text>
          {logs.length > 0 ? (
            <View style={styles.logSlot}>
              <ConnectionLog entries={logs} title="Pairing log" />
            </View>
          ) : null}
          <View style={styles.errorActions}>
            <Pressable style={styles.primaryButton} onPress={retry}>
              <Text style={styles.primaryButtonText}>Try Again</Text>
            </Pressable>
            <Pressable
              style={styles.secondaryButton}
              onPress={() => {
                retry()
                setPasteVisible(true)
              }}
            >
              <Text style={styles.secondaryButtonText}>Paste code instead</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <PairingPasteSheet
        visible={pasteVisible}
        onCancel={() => setPasteVisible(false)}
        onSubmit={(value) => {
          setPasteVisible(false)
          handleCode(value, false)
        }}
      />
    </View>
  )
}

function PairingPasteSheet({
  visible,
  onSubmit,
  onCancel
}: {
  visible: boolean
  onSubmit: (value: string) => void
  onCancel: () => void
}) {
  return (
    <TextInputModal
      visible={visible}
      title="Paste pairing code"
      message="Copy the code shown under the QR in Synapse desktop."
      placeholder="synapse://pair?code=... or paste the code"
      onSubmit={onSubmit}
      onCancel={onCancel}
    />
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgBase,
    padding: spacing.lg
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm
  },
  steps: {
    gap: spacing.sm,
    marginBottom: spacing.lg,
    marginLeft: 7
  },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm
  },
  stepBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.bgRaised,
    alignItems: 'center',
    justifyContent: 'center'
  },
  stepNumber: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700'
  },
  stepText: {
    color: colors.textSecondary,
    fontSize: typography.bodySize
  },
  cameraWrap: {
    flex: 1,
    borderRadius: radii.camera,
    overflow: 'hidden'
  },
  cameraPlaceholder: {
    flex: 1,
    backgroundColor: colors.bgPanel,
    borderRadius: radii.camera
  },
  camera: {
    ...StyleSheet.absoluteFillObject
  },
  reticle: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center'
  },
  reticleFrame: {
    position: 'relative'
  },
  corner: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderColor: 'rgba(255,255,255,0.72)'
  },
  cornerTL: {
    top: 0,
    left: 0,
    borderTopWidth: 2.5,
    borderLeftWidth: 2.5,
    borderTopLeftRadius: 6
  },
  cornerTR: {
    top: 0,
    right: 0,
    borderTopWidth: 2.5,
    borderRightWidth: 2.5,
    borderTopRightRadius: 6
  },
  cornerBL: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 2.5,
    borderLeftWidth: 2.5,
    borderBottomLeftRadius: 6
  },
  cornerBR: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 2.5,
    borderRightWidth: 2.5,
    borderBottomRightRadius: 6
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center'
  },
  title: {
    color: colors.textPrimary,
    fontSize: typography.titleSize,
    fontWeight: '700',
    marginBottom: spacing.sm
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: typography.bodySize,
    lineHeight: 20,
    maxWidth: 320,
    textAlign: 'center',
    marginBottom: spacing.xl
  },
  connectingText: {
    color: colors.textSecondary,
    fontSize: typography.bodySize,
    marginTop: spacing.lg
  },
  logSlot: {
    width: '100%',
    marginTop: spacing.lg,
    paddingHorizontal: spacing.sm
  },
  errorText: {
    color: colors.statusRed,
    fontSize: typography.bodySize,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: spacing.xl
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.textPrimary,
    borderRadius: radii.button,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm + 2
  },
  primaryButtonText: {
    color: colors.bgBase,
    fontSize: typography.bodySize,
    fontWeight: '700'
  },
  pasteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.button
  },
  pasteButtonText: {
    color: colors.textSecondary,
    fontSize: typography.bodySize,
    fontWeight: '600'
  },
  errorActions: {
    alignItems: 'center',
    gap: spacing.sm
  },
  secondaryButton: {
    borderRadius: radii.button,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm
  },
  secondaryButtonText: {
    color: colors.textSecondary,
    fontSize: typography.bodySize,
    fontWeight: '600'
  }
})
