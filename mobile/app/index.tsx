import { useCallback, useState } from 'react'
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { Link, useFocusEffect, useRouter } from 'expo-router'
import { Languages, Plus, Server, Trash2 } from 'lucide-react-native'
import { loadHosts, removeHost } from '../src/transport/host-store'
import type { HostProfile } from '../src/transport/types'
import { colors, radii, spacing, typography } from '../src/theme/mobile-theme'
import { useMobileI18n } from '../src/i18n'

export default function HostListScreen() {
  const router = useRouter()
  const { t, nextLanguageLabel, toggleLanguage } = useMobileI18n()
  const [hosts, setHosts] = useState<HostProfile[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [removingHostId, setRemovingHostId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setRefreshing(true)
    setError(null)
    try {
      setHosts(await loadHosts())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRefreshing(false)
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      void refresh()
    }, [refresh])
  )

  const removePairedHost = useCallback(async (hostId: string) => {
    setRemovingHostId(hostId)
    setError(null)
    try {
      await removeHost(hostId)
      setHosts((current) => current.filter((host) => host.id !== hostId))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRemovingHostId(null)
    }
  }, [])

  const confirmRemoveHost = useCallback(
    (host: HostProfile) => {
      Alert.alert(t('home.removeHostTitle'), t('home.removeHostMessage'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('home.removeHost'),
          style: 'destructive',
          onPress: () => void removePairedHost(host.id)
        }
      ])
    },
    [removePairedHost, t]
  )

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>{t('home.welcomeTitle')}</Text>
          <Text style={styles.subtitle}>{t('home.subtitle')}</Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable
            style={styles.languageButton}
            onPress={() => void toggleLanguage()}
            accessibilityLabel={t('home.language')}
          >
            <Languages size={17} color={colors.textPrimary} />
            <Text style={styles.languageButtonText}>{nextLanguageLabel}</Text>
          </Pressable>
          <Link href="/pair-scan" asChild>
            <Pressable style={styles.primaryButton}>
              <Plus size={18} color={colors.bgBase} />
              <Text style={styles.primaryButtonText}>{t('home.pair')}</Text>
            </Pressable>
          </Link>
        </View>
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <FlatList
        data={hosts}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        contentContainerStyle={hosts.length === 0 ? styles.emptyList : styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Server size={28} color={colors.textSecondary} />
            <Text style={styles.emptyTitle}>{t('home.emptyTitle')}</Text>
            <Text style={styles.emptyText}>{t('home.emptyText')}</Text>
            <Link href="/pair-scan" asChild>
              <Pressable style={styles.secondaryButton}>
                <Text style={styles.secondaryButtonText}>{t('home.scanOrPaste')}</Text>
              </Pressable>
            </Link>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [styles.hostRow, pressed && styles.pressed]}
            onPress={() => router.push(`/h/${item.id}`)}
          >
            <View style={styles.hostIcon}>
              <Server size={18} color={colors.textPrimary} />
            </View>
            <View style={styles.hostMain}>
              <Text style={styles.hostName}>{item.name}</Text>
              <Text style={styles.hostEndpoint} numberOfLines={1}>
                {item.relayEndpoint ? `${t('common.relay')} ${item.relayEndpoint}` : item.endpoint}
              </Text>
            </View>
            <Pressable
              disabled={removingHostId === item.id}
              style={[styles.deleteHostButton, removingHostId === item.id && styles.deleteHostButtonDisabled]}
              onPress={(event) => {
                event.stopPropagation()
                confirmRemoveHost(item)
              }}
              accessibilityLabel={t('home.removeHost')}
            >
              {removingHostId === item.id ? (
                <ActivityIndicator color={colors.statusRed} />
              ) : (
                <Trash2 size={17} color={colors.statusRed} />
              )}
            </Pressable>
          </Pressable>
        )}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgBase,
    padding: spacing.lg
  },
  header: {
    alignItems: 'stretch',
    gap: spacing.md,
    marginBottom: spacing.lg
  },
  headerCopy: {
    minWidth: 0
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm
  },
  title: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: '700'
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: typography.bodySize,
    marginTop: 2,
    lineHeight: 20
  },
  primaryButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surfaceBright,
    borderRadius: radii.button,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  primaryButtonText: {
    color: colors.bgBase,
    fontSize: typography.bodySize,
    fontWeight: '700'
  },
  languageButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radii.button,
    minWidth: 104,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm
  },
  languageButtonText: {
    color: colors.textPrimary,
    fontSize: typography.metaSize,
    fontWeight: '700'
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radii.button,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  secondaryButtonText: {
    color: colors.textPrimary,
    fontWeight: '600'
  },
  list: {
    gap: spacing.sm
  },
  emptyList: {
    flexGrow: 1,
    justifyContent: 'center'
  },
  empty: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg
  },
  emptyTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '700'
  },
  emptyText: {
    color: colors.textSecondary,
    textAlign: 'center'
  },
  hostRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.bgPanel,
    borderRadius: radii.row,
    padding: spacing.md
  },
  hostIcon: {
    width: 38,
    height: 38,
    borderRadius: radii.button,
    backgroundColor: colors.bgRaised,
    alignItems: 'center',
    justifyContent: 'center'
  },
  hostMain: {
    flex: 1,
    minWidth: 0
  },
  hostName: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '700'
  },
  hostEndpoint: {
    color: colors.textSecondary,
    fontSize: typography.metaSize,
    marginTop: 2
  },
  deleteHostButton: {
    width: 34,
    height: 34,
    borderRadius: radii.button,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgRaised,
    borderWidth: 1,
    borderColor: colors.borderSubtle
  },
  deleteHostButtonDisabled: {
    opacity: 0.52
  },
  pressed: {
    opacity: 0.74
  },
  errorText: {
    color: colors.statusRed,
    marginBottom: spacing.md
  }
})
