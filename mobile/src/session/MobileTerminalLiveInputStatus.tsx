import { StyleSheet, Text, View } from 'react-native'
import { colors, typography } from '../theme/mobile-theme'
import { useMobileI18n } from '../i18n'

type DictationStatus = {
  readonly isStarting: boolean
  readonly isRecording: boolean
  readonly isProcessing: boolean
}

type MobileTerminalLiveInputStatusProps = {
  readonly dictation: DictationStatus
  readonly isAttaching: boolean
}

export function MobileTerminalLiveInputStatus({
  dictation,
  isAttaching
}: MobileTerminalLiveInputStatusProps) {
  const { t } = useMobileI18n()
  const title = dictation.isRecording
    ? t('liveInput.listening')
    : dictation.isProcessing
      ? t('liveInput.processing')
      : dictation.isStarting
        ? t('liveInput.startingMic')
        : t('liveInput.title')
  const detail = dictation.isRecording
    ? t('liveInput.stopMic')
    : dictation.isProcessing
      ? t('liveInput.transcribing')
      : dictation.isStarting
        ? t('liveInput.preparingMic')
        : isAttaching
          ? t('liveInput.uploading')
          : t('liveInput.tapKeyboard')

  return (
    <View style={styles.status}>
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      <Text style={styles.detail} numberOfLines={1}>
        {detail}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  status: {
    flex: 1,
    gap: 1
  },
  title: {
    color: colors.textPrimary,
    fontSize: typography.metaSize,
    fontWeight: '600'
  },
  detail: {
    color: colors.textSecondary,
    fontSize: typography.metaSize,
    fontFamily: typography.monoFamily
  }
})
