import { useCallback, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { Pencil, Trash2 } from 'lucide-react-native'
import { TextInputModal } from '../../../src/components/TextInputModal'
import { loadHostById } from '../../../src/synapse/remote'
import { removeHost, renameHost } from '../../../src/transport/host-store'
import type { HostProfile } from '../../../src/transport/types'
import { colors, radii, spacing, typography } from '../../../src/theme/mobile-theme'

function getParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}

export default function HostSettingsScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{ hostId?: string }>()
  const hostId = getParam(params.hostId)
  const [host, setHost] = useState<HostProfile | null>(null)
  const [renameVisible, setRenameVisible] = useState(false)
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

  const handleRemove = useCallback(async () => {
    await removeHost(hostId)
    router.replace('/')
  }, [hostId, router])

  return (
    <View style={styles.container}>
      <View>
        <Text style={styles.title}>{host?.name ?? 'Host Settings'}</Text>
        <Text style={styles.endpoint} numberOfLines={2}>
          {host?.endpoint ?? hostId}
        </Text>
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <View style={styles.actions}>
        <Pressable style={styles.actionRow} onPress={() => setRenameVisible(true)}>
          <Pencil size={18} color={colors.textPrimary} />
          <View style={styles.actionText}>
            <Text style={styles.actionTitle}>Rename</Text>
            <Text style={styles.actionMeta}>Change the saved display name on this phone.</Text>
          </View>
        </Pressable>

        <Pressable style={styles.actionRow} onPress={() => void handleRemove()}>
          <Trash2 size={18} color={colors.statusRed} />
          <View style={styles.actionText}>
            <Text style={styles.dangerTitle}>Remove from phone</Text>
            <Text style={styles.actionMeta}>This deletes local metadata and the secure token.</Text>
          </View>
        </Pressable>
      </View>

      <Text style={styles.note}>
        To revoke this phone on the desktop, open Synapse desktop Settings &gt; Remote and revoke
        the paired device.
      </Text>

      <TextInputModal
        visible={renameVisible}
        title="Rename Host"
        defaultValue={host?.name ?? ''}
        submitLabel="Rename"
        onCancel={() => setRenameVisible(false)}
        onSubmit={(value) => {
          setRenameVisible(false)
          void renameHost(hostId, value).then(refresh)
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
