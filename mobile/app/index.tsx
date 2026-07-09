import { useCallback, useState } from 'react'
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { Link, useFocusEffect, useRouter } from 'expo-router'
import { Plus, Server } from 'lucide-react-native'
import { loadHosts } from '../src/transport/host-store'
import type { HostProfile } from '../src/transport/types'
import { colors, radii, spacing, typography } from '../src/theme/mobile-theme'

export default function HostListScreen() {
  const router = useRouter()
  const [hosts, setHosts] = useState<HostProfile[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Synapse Mobile</Text>
          <Text style={styles.subtitle}>Paired desktop hosts</Text>
        </View>
        <Link href="/pair-scan" asChild>
          <Pressable style={styles.primaryButton}>
            <Plus size={18} color={colors.bgBase} />
            <Text style={styles.primaryButtonText}>Pair</Text>
          </Pressable>
        </Link>
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
            <Text style={styles.emptyTitle}>No paired desktops</Text>
            <Text style={styles.emptyText}>Pair from Synapse desktop Settings &gt; Remote.</Text>
            <Link href="/pair-scan" asChild>
              <Pressable style={styles.secondaryButton}>
                <Text style={styles.secondaryButtonText}>Scan QR or paste code</Text>
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
                {item.relayEndpoint ? `Relay ${item.relayEndpoint}` : item.endpoint}
              </Text>
            </View>
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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.lg
  },
  title: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: '700'
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: typography.bodySize,
    marginTop: 2
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
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
  pressed: {
    opacity: 0.74
  },
  errorText: {
    color: colors.statusRed,
    marginBottom: spacing.md
  }
})
