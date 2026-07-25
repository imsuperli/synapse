import { useEffect, useRef, useState } from 'react'
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Pressable } from './Pressable'
import * as Clipboard from 'expo-clipboard'
import { Check, Copy, X } from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'

type Props = {
  visible: boolean
  text: string
  title: string
  copyLabel: string
  copiedLabel: string
  closeLabel: string
  onClose: () => void
}

export function TerminalDiagnosticsModal({
  visible,
  text,
  title,
  copyLabel,
  copiedLabel,
  closeLabel,
  onClose
}: Props) {
  const insets = useSafeAreaInsets()
  const [copied, setCopied] = useState(false)
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!visible) {
      setCopied(false)
    }
    return () => {
      if (copiedTimerRef.current) {
        clearTimeout(copiedTimerRef.current)
        copiedTimerRef.current = null
      }
    }
  }, [visible])

  const copyDiagnostics = async () => {
    try {
      await Clipboard.setStringAsync(text)
    } catch {
      return
    }
    setCopied(true)
    if (copiedTimerRef.current) {
      clearTimeout(copiedTimerRef.current)
    }
    copiedTimerRef.current = setTimeout(() => {
      copiedTimerRef.current = null
      setCopied(false)
    }, 1800)
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <View
        style={[
          styles.container,
          { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, spacing.sm) }
        ]}
      >
        <View style={styles.header}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <View style={styles.actions}>
            <Pressable
              style={({ pressed }) => [styles.copyButton, pressed && styles.buttonPressed]}
              onPress={() => void copyDiagnostics()}
              accessibilityRole="button"
              accessibilityLabel={copyLabel}
            >
              {copied ? (
                <Check size={16} color={colors.statusGreen} />
              ) : (
                <Copy size={16} color={colors.textPrimary} />
              )}
              <Text style={[styles.copyText, copied && styles.copiedText]}>
                {copied ? copiedLabel : copyLabel}
              </Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.iconButton, pressed && styles.buttonPressed]}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={closeLabel}
            >
              <X size={19} color={colors.textPrimary} />
            </Pressable>
          </View>
        </View>
        <ScrollView
          style={styles.logSurface}
          contentContainerStyle={styles.logContent}
          showsVerticalScrollIndicator
        >
          <Text selectable style={styles.logText}>
            {text}
          </Text>
        </ScrollView>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgBase
  },
  header: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
    backgroundColor: colors.bgPanel
  },
  title: {
    flex: 1,
    minWidth: 0,
    color: colors.textPrimary,
    fontSize: typography.bodySize,
    fontWeight: '700'
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm
  },
  copyButton: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: radii.button,
    backgroundColor: colors.bgRaised,
    paddingHorizontal: spacing.sm
  },
  copyText: {
    color: colors.textPrimary,
    fontSize: typography.metaSize,
    fontWeight: '700'
  },
  copiedText: {
    color: colors.statusGreen
  },
  iconButton: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.button,
    backgroundColor: colors.bgRaised
  },
  buttonPressed: {
    opacity: 0.7
  },
  logSurface: {
    flex: 1,
    margin: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radii.button,
    backgroundColor: colors.bgInset
  },
  logContent: {
    padding: spacing.md
  },
  logText: {
    color: colors.textSecondary,
    fontFamily: typography.monoFamily,
    fontSize: 11,
    lineHeight: 17
  }
})
