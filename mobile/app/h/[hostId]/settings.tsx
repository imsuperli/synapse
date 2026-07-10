import { useCallback, useState } from 'react'
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { Cloud, Languages, Pencil, Trash2 } from 'lucide-react-native'
import { TextInputModal } from '../../../src/components/TextInputModal'
import { loadHostById } from '../../../src/synapse/remote'
import { removeHost, renameHost, updateHostRelayEndpoint } from '../../../src/transport/host-store'
import type { HostProfile } from '../../../src/transport/types'
import { colors, radii, spacing, typography } from '../../../src/theme/mobile-theme'
import { useMobileI18n } from '../../../src/i18n'

function getParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}

export default function HostSettingsScreen() {
  const router = useRouter()
  const { t, nextLanguageLabel, toggleLanguage } = useMobileI18n()
  const params = useLocalSearchParams<{ hostId?: string }>()
  const hostId = getParam(params.hostId)
  const [host, setHost] = useState<HostProfile | null>(null)
  const [renameVisible, setRenameVisible] = useState(false)
  const [relayVisible, setRelayVisible] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setHost(await loadHostById(hostId))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [hostId])

  useFocusEffect(
    useCallback(() => {
      void refresh()
    }, [refresh])
  )

  const handleRemove = useCallback(() => {
    Alert.alert(t('hostSettings.removeTitle'), t('hostSettings.removeConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('hostSettings.remove'),
        style: 'destructive',
        onPress: () => {
          void removeHost(hostId).then(() => router.replace('/')).catch((err) => {
            setError(err instanceof Error ? err.message : String(err))
          })
        }
      }
    ])
  }, [hostId, router, t])

  return (
    <View style={styles.container}>
      <View>
        <Text style={styles.title}>{host?.name ?? t('hostSettings.title')}</Text>
        <Text style={styles.endpoint} numberOfLines={2}>
          {host?.endpoint ?? hostId}
        </Text>
        {host?.relayEndpoint ? (
          <Text style={styles.relayEndpoint} numberOfLines={2}>
            {t('common.relay')} {host.relayEndpoint}
          </Text>
        ) : null}
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <View style={styles.actions}>
        <Pressable style={styles.actionRow} onPress={() => setRenameVisible(true)}>
          <Pencil size={18} color={colors.textPrimary} />
          <View style={styles.actionText}>
            <Text style={styles.actionTitle}>{t('hostSettings.rename')}</Text>
            <Text style={styles.actionMeta}>{t('hostSettings.renameMeta')}</Text>
          </View>
        </Pressable>

        {host?.relayEndpoint && host.relaySessionId && host.relayClientToken ? (
          <Pressable style={styles.actionRow} onPress={() => setRelayVisible(true)}>
            <Cloud size={18} color={colors.textPrimary} />
            <View style={styles.actionText}>
              <Text style={styles.actionTitle}>{t('hostSettings.relayAddress')}</Text>
              <Text style={styles.actionMeta}>{t('hostSettings.relayMeta')}</Text>
            </View>
          </Pressable>
        ) : null}

        <Pressable style={styles.actionRow} onPress={() => void toggleLanguage()}>
          <Languages size={18} color={colors.textPrimary} />
          <View style={styles.actionText}>
            <Text style={styles.actionTitle}>{t('hostSettings.language')}</Text>
            <Text style={styles.actionMeta}>
              {t('hostSettings.languageMeta')} {nextLanguageLabel}
            </Text>
          </View>
        </Pressable>

        <Pressable style={styles.actionRow} onPress={handleRemove}>
          <Trash2 size={18} color={colors.statusRed} />
          <View style={styles.actionText}>
            <Text style={styles.dangerTitle}>{t('hostSettings.remove')}</Text>
            <Text style={styles.actionMeta}>{t('hostSettings.removeMeta')}</Text>
          </View>
        </Pressable>
      </View>

      <Text style={styles.note}>{t('hostSettings.note')}</Text>

      <TextInputModal
        visible={renameVisible}
        title={t('hostSettings.renameTitle')}
        defaultValue={host?.name ?? ''}
        submitLabel={t('hostSettings.renameSubmit')}
        onCancel={() => setRenameVisible(false)}
        onSubmit={(value) => {
          setRenameVisible(false)
          void renameHost(hostId, value).then(refresh)
        }}
      />

      <TextInputModal
        visible={relayVisible}
        title={t('hostSettings.relayTitle')}
        defaultValue={host?.relayEndpoint ?? ''}
        submitLabel={t('common.save')}
        onCancel={() => setRelayVisible(false)}
        onSubmit={(value) => {
          setRelayVisible(false)
          void updateHostRelayEndpoint(hostId, value).then(refresh).catch((err) => {
            setError(err instanceof Error ? err.message : String(err))
          })
        }}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgBase,
    padding: spacing.lg,
    gap: spacing.lg
  },
  title: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: '700'
  },
  endpoint: {
    color: colors.textSecondary,
    fontFamily: typography.monoFamily,
    fontSize: typography.metaSize,
    lineHeight: 18,
    marginTop: 4
  },
  relayEndpoint: {
    color: colors.textSecondary,
    fontFamily: typography.monoFamily,
    fontSize: typography.metaSize,
    lineHeight: 18,
    marginTop: 4
  },
  errorText: {
    color: colors.statusRed,
    fontSize: typography.bodySize
  },
  actions: {
    gap: spacing.sm
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.bgPanel,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radii.row,
    padding: spacing.md
  },
  actionText: {
    flex: 1
  },
  actionTitle: {
    color: colors.textPrimary,
    fontSize: typography.bodySize,
    fontWeight: '700'
  },
  dangerTitle: {
    color: colors.statusRed,
    fontSize: typography.bodySize,
    fontWeight: '700'
  },
  actionMeta: {
    color: colors.textSecondary,
    fontSize: typography.metaSize,
    lineHeight: 17,
    marginTop: 2
  },
  note: {
    color: colors.textMuted,
    fontSize: typography.metaSize,
    lineHeight: 18
  }
})
