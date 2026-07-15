import { useCallback, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { Link, useFocusEffect, useRouter } from 'expo-router'
import { Languages, Pencil, Plus, Server, Trash2 } from 'lucide-react-native'
import { loadHosts, removeHost } from '../src/transport/host-store'
import type { HostProfile } from '../src/transport/types'
import {
  groupHostsByRelay,
  hostDisplayName,
  hostNetworkAddress
} from '../src/transport/host-display'
import { colors, radii, spacing, typography } from '../src/theme/mobile-theme'
import { useMobileI18n } from '../src/i18n'

type HostListItem =
  | { type: 'group'; id: string; relayEndpoint: string | null }
  | { type: 'host'; host: HostProfile }

export default function HostListScreen() {
  const router = useRouter()
  const { t, nextLanguageLabel, toggleLanguage } = useMobileI18n()
  const [hosts, setHosts] = useState<HostProfile[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [removingHostId, setRemovingHostId] = useState<string | null>(null)
  const hostListItems = useMemo<HostListItem[]>(
    () =>
      groupHostsByRelay(hosts).flatMap((group) => [
        { type: 'group' as const, id: group.id, relayEndpoint: group.relayEndpoint },
        ...group.hosts.map((host) => ({ type: 'host' as const, host }))
      ]),
    [hosts]
  )

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
        data={hostListItems}
        keyExtractor={(item) => (item.type === 'group' ? item.id : `host:${item.host.id}`)}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        contentContainerStyle={hostListItems.length === 0 ? styles.emptyList : styles.list}
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
        renderItem={({ item }) => {
          if (item.type === 'group') {
            return (
              <Text style={styles.hostGroupHeader} numberOfLines={2}>
                {item.relayEndpoint ?? t('common.localNetwork')}
              </Text>
            )
          }

          const host = item.host
          const removing = removingHostId === host.id
          const name = hostDisplayName(host) ?? t('common.unnamedDesktop')
          const address = hostNetworkAddress(host.endpoint)
          return (
            <Pressable
              style={({ pressed }) => [styles.hostRow, pressed && styles.pressed]}
              onPress={() => router.push(`/h/${host.id}`)}
              accessibilityLabel={`${name}, ${t('common.desktopIp', { address })}`}
            >
              <View style={styles.hostIcon}>
                <Server size={18} color={colors.textPrimary} />
              </View>
              <View style={styles.hostMain}>
                <Text style={styles.hostName} numberOfLines={1}>
                  {name}
                </Text>
                <Text style={styles.hostEndpoint} numberOfLines={1}>
                  {t('common.desktopIp', { address })}
                </Text>
              </View>
              <Pressable
                disabled={removing}
                style={[styles.editHostButton, removing && styles.editHostButtonDisabled]}
                onPress={(event) => {
                  event.stopPropagation()
                  router.push(`/h/${host.id}/settings`)
                }}
                accessibilityLabel={t('nav.hostSettings')}
              >
                <Pencil size={16} color={colors.textPrimary} />
              </Pressable>
              <Pressable
                disabled={removing}
                style={[styles.deleteHostButton, removing && styles.deleteHostButtonDisabled]}
                onPress={(event) => {
                  event.stopPropagation()
                  confirmRemoveHost(host)
                }}
                accessibilityLabel={t('home.removeHost')}
              >
                {removing ? (
                  <ActivityIndicator color={colors.statusRed} />
                ) : (
                  <Trash2 size={17} color={colors.statusRed} />
                )}
              </Pressable>
            </Pressable>
          )
        }}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgBase,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg
  },
  header: {
    alignItems: 'stretch',
    gap: spacing.sm,
    marginBottom: spacing.sm
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
    fontSize: 22,
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
  hostGroupHeader: {
    color: colors.textMuted,
    fontFamily: typography.monoFamily,
    fontSize: typography.metaSize,
    fontWeight: '700',
    marginTop: spacing.sm,
    paddingHorizontal: spacing.xs
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
    gap: spacing.sm,
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
  editHostButton: {
    width: 34,
    height: 34,
    borderRadius: radii.button,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgRaised,
    borderWidth: 1,
    borderColor: colors.borderSubtle
  },
  editHostButtonDisabled: {
    opacity: 0.52
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
