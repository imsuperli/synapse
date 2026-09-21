import { useCallback, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Linking,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent
} from 'react-native'
import { Pressable } from '../src/components/Pressable'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ChevronLeft, Clipboard, QrCode } from 'lucide-react-native'
import { TextInputModal } from '../src/components/TextInputModal'
import { extractPairingCodeFromUrl, parsePairingCode } from '../src/transport/pairing'
import { colors, radii, spacing, typography } from '../src/theme/mobile-theme'
import { useMobileI18n } from '../src/i18n'

const SCAN_RETICLE_SCALE = 0.62
const SCAN_RETICLE_MAX_SIZE = 360

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
  const { t } = useMobileI18n()
  const [permission, requestPermission] = useCameraPermissions()
  const [errorMessage, setErrorMessage] = useState('')
  const [pasteVisible, setPasteVisible] = useState(false)
  const [cameraBounds, setCameraBounds] = useState({ width: 0, height: 0 })
  const processingRef = useRef(false)
  const [status, setStatus] = useState<'scanning' | 'error'>('scanning')

  const setRootRef = useCallback((node: View | null) => {
    if (node) {
      processingRef.current = false
      return
    }
  }, [])

  const handleCode = useCallback(
    (input: string, fromQr: boolean) => {
      if (processingRef.current) {
        return
      }
      processingRef.current = true
      const candidate = fromQr ? extractPairingCodeFromUrl(input) ?? input : input.trim()
      if (!parsePairingCode(candidate)) {
        setStatus('error')
        setErrorMessage(
          fromQr
            ? t('pair.invalidQr')
            : t('pair.invalidCode')
        )
        processingRef.current = false
        return
      }
      router.push({ pathname: '/pair-confirm', params: { code: candidate } })
    },
    [router, t]
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
        <Text style={styles.connectingText}>{t('pair.cameraLoading')}</Text>
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
            {canAskAgain ? t('pair.title') : t('pair.cameraDisabledTitle')}
          </Text>
          <Text style={styles.subtitle}>
            {canAskAgain
              ? t('pair.subtitle')
              : t('pair.cameraDisabledSubtitle')}
          </Text>
          <Pressable
            style={styles.primaryButton}
            onPress={canAskAgain ? requestPermission : () => void Linking.openSettings()}
          >
            {canAskAgain ? <QrCode size={16} color={colors.bgBase} /> : null}
            <Text style={styles.primaryButtonText}>
              {canAskAgain ? t('pair.continue') : t('pair.openSettings')}
            </Text>
          </Pressable>
          <Pressable style={styles.pasteButton} onPress={() => setPasteVisible(true)}>
            <Clipboard size={16} color={colors.textSecondary} />
            <Text style={styles.pasteButtonText}>{t('pair.pasteInstead')}</Text>
          </Pressable>
        </View>
        <PairingPasteSheet
          visible={pasteVisible}
          title={t('pair.pasteTitle')}
          message={t('pair.pasteMessage')}
          placeholder={t('pair.pastePlaceholder')}
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
        <Step number={1} text={t('pair.step1')} />
        <Step number={2} text={t('pair.step2')} />
        <Step number={3} text={t('pair.step3')} />
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
            <Text style={styles.pasteButtonText}>{t('pair.orPaste')}</Text>
          </Pressable>
        </>
      ) : null}

      {status === 'error' ? (
        <View style={styles.centered}>
          <Text style={styles.errorText}>{errorMessage}</Text>
          <View style={styles.errorActions}>
            <Pressable style={styles.primaryButton} onPress={retry}>
              <Text style={styles.primaryButtonText}>{t('common.retry')}</Text>
            </Pressable>
            <Pressable
              style={styles.secondaryButton}
              onPress={() => {
                retry()
                setPasteVisible(true)
              }}
            >
              <Text style={styles.secondaryButtonText}>{t('pair.pasteInstead')}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <PairingPasteSheet
        visible={pasteVisible}
        title={t('pair.pasteTitle')}
        message={t('pair.pasteMessage')}
        placeholder={t('pair.pastePlaceholder')}
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
  title,
  message,
  placeholder,
  onSubmit,
  onCancel
}: {
  visible: boolean
  title: string
  message: string
  placeholder: string
  onSubmit: (value: string) => void
  onCancel: () => void
}) {
  return (
    <TextInputModal
      visible={visible}
      title={title}
      message={message}
      placeholder={placeholder}
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
