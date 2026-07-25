import { useCallback, useRef, useState } from 'react'
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { Link, useFocusEffect, useRouter } from 'expo-router'
import { ChevronRight, Cloud, Languages, Pencil, Plus, Server, Trash2, Wifi } from 'lucide-react-native'
import { loadHosts, removeHost, setHostConnectionRoute } from '../src/transport/host-store'
import type { HostConnectionRoute, HostProfile } from '../src/transport/types'
import {
  hostConnectionOptions,
  hostDisplayName,
  hostNetworkAddress
} from '../src/transport/host-display'
import { colors, radii, spacing, typography } from '../src/theme/mobile-theme'
import { useMobileI18n } from '../src/i18n'

export default function HostListScreen() {
  const router = useRouter()
  const { t, nextLanguageLabel, toggleLanguage } = useMobileI18n()
  const [hosts, setHosts] = useState<HostProfile[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [removingHostId, setRemovingHostId] = useState<string | null>(null)
  const [selectingRouteKey, setSelectingRouteKey] = useState<string | null>(null)
  const selectingRouteRef = useRef<string | null>(null)

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

  const openHostRoute = useCallback(
    async (host: HostProfile, route: HostConnectionRoute) => {
      const routeKey = `${host.id}:${route}`
      if (selectingRouteRef.current) {
        return
      }
      selectingRouteRef.current = routeKey
      setSelectingRouteKey(routeKey)
      setError(null)
      try {
        await setHostConnectionRoute(host.id, route)
        setHosts((current) =>
          current.map((saved) =>
            saved.id === host.id ? { ...saved, connectionRoute: route } : saved
          )
        )
        router.push(`/h/${host.id}`)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        selectingRouteRef.current = null
        setSelectingRouteKey(null)
      }
    },
    [router]
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
        keyExtractor={(host) => host.id}
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
        renderItem={({ item: host }) => {
          const removing = removingHostId === host.id
          const name = hostDisplayName(host) ?? t('common.unnamedDesktop')
          const routes = hostConnectionOptions(host)
          return (
            <View style={styles.hostCard}>
              <View style={styles.hostHeader}>
                <View style={styles.hostIcon}>
                  <Server size={18} color={colors.textPrimary} />
                </View>
                <View style={styles.hostMain}>
                  <Text style={styles.hostName} numberOfLines={1}>
                    {name}
                  </Text>
                </View>
                <Pressable
                  disabled={removing}
                  style={[styles.iconButton, removing && styles.iconButtonDisabled]}
                  onPress={() => router.push(`/h/${host.id}/settings`)}
                  accessibilityLabel={t('nav.hostSettings')}
                >
                  <Pencil size={16} color={colors.textPrimary} />
                </Pressable>
                <Pressable
                  disabled={removing}
                  style={[styles.iconButton, removing && styles.iconButtonDisabled]}
                  onPress={() => confirmRemoveHost(host)}
                  accessibilityLabel={t('home.removeHost')}
                >
                  {removing ? (
                    <ActivityIndicator color={colors.statusRed} />
                  ) : (
                    <Trash2 size={17} color={colors.statusRed} />
                  )}
                </Pressable>
              </View>
              <View style={styles.routeList}>
                {routes.map((connection) => {
                  const routeKey = `${host.id}:${connection.route}`
                  const selecting = selectingRouteKey === routeKey
                  const disabled = removing || selectingRouteKey !== null
                  const direct = connection.route === 'direct'
                  const routeLabel = direct ? t('common.direct') : t('common.relay')
                  const address = hostNetworkAddress(connection.endpoint)
                  return (
                    <Pressable
                      key={connection.route}
                      disabled={disabled}
                      style={({ pressed }) => [
                        styles.routeRow,
                        pressed && styles.pressed,
                        disabled && !selecting && styles.routeRowDisabled
                      ]}
                      onPress={() => void openHostRoute(host, connection.route)}
                      accessibilityRole="button"
                      accessibilityLabel={t('home.connectRoute', {
                        name,
                        route: routeLabel,
                        address
                      })}
                    >
                      <View
                        style={[
                          styles.routeIcon,
                          host.connectionRoute === connection.route && styles.routeIconSelected
                        ]}
                      >
                        {direct ? (
                          <Wifi size={17} color={colors.textPrimary} />
                        ) : (
                          <Cloud size={17} color={colors.textPrimary} />
                        )}
                      </View>
                      <View style={styles.routeMain}>
                        <Text style={styles.routeName}>{routeLabel}</Text>
                        <Text style={styles.routeEndpoint} numberOfLines={1}>
                          {address}
                        </Text>
                      </View>
                      {selecting ? (
                        <ActivityIndicator color={colors.textSecondary} />
                      ) : (
                        <ChevronRight size={18} color={colors.textMuted} />
                      )}
                    </Pressable>
                  )
                })}
              </View>
            </View>
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
    gap: spacing.md
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
  hostCard: {
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.bgPanel,
    borderRadius: radii.row,
    overflow: 'hidden'
  },
  hostHeader: {
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
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
  iconButton: {
    width: 34,
    height: 34,
    borderRadius: radii.button,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgRaised,
    borderWidth: 1,
    borderColor: colors.borderSubtle
  },
  iconButtonDisabled: {
    opacity: 0.52
  },
  routeList: {
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle
  },
  routeRow: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle
  },
  routeRowDisabled: {
    opacity: 0.52
  },
  routeIcon: {
    width: 34,
    height: 34,
    borderRadius: radii.button,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgRaised
  },
  routeIconSelected: {
    borderWidth: 1,
    borderColor: colors.accentBlue
  },
  routeMain: {
    flex: 1,
    minWidth: 0
  },
  routeName: {
    color: colors.textPrimary,
    fontSize: typography.bodySize,
    fontWeight: '700'
  },
  routeEndpoint: {
    color: colors.textSecondary,
    fontFamily: typography.monoFamily,
    fontSize: typography.metaSize,
    marginTop: 2
  },
  pressed: {
    opacity: 0.74
  },
  errorText: {
    color: colors.statusRed,
    marginBottom: spacing.md
  }
})
