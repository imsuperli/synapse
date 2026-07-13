import { useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native'
import { Check, ChevronDown, HardDrive, Server, TerminalSquare } from 'lucide-react-native'
import type { RemoteSSHProfileSummary } from '../synapse/remote'
import type { WindowCreateParams } from '../../../src/shared/remote/window-protocol'
import { buildTerminalCreateParams } from '../synapse/terminal-create'
import { useMobileI18n } from '../i18n'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'
import { BottomDrawer } from './BottomDrawer'

type Props = {
  visible: boolean
  canCreateSSH: boolean
  sshProfiles: RemoteSSHProfileSummary[]
  loadingSSHProfiles: boolean
  sshProfilesError: string | null
  submitting: boolean
  submitError: string | null
  onRetrySSHProfiles: () => void
  onSubmit: (params: WindowCreateParams) => void
  onClose: () => void
}

export function CreateTerminalDrawer({
  visible,
  canCreateSSH,
  sshProfiles,
  loadingSSHProfiles,
  sshProfilesError,
  submitting,
  submitError,
  onRetrySSHProfiles,
  onSubmit,
  onClose
}: Props) {
  const { t } = useMobileI18n()
  const [backend, setBackend] = useState<'local' | 'ssh'>('local')
  const [localWorkingDirectory, setLocalWorkingDirectory] = useState('')
  const [localName, setLocalName] = useState('')
  const [localCommand, setLocalCommand] = useState('')
  const [selectedProfileId, setSelectedProfileId] = useState('')
  const [remoteWorkingDirectory, setRemoteWorkingDirectory] = useState('~')
  const [remoteName, setRemoteName] = useState('')
  const [remoteCommand, setRemoteCommand] = useState('')
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)

  const selectedProfile = useMemo(
    () => sshProfiles.find((profile) => profile.profileId === selectedProfileId) ?? null,
    [selectedProfileId, sshProfiles]
  )

  useEffect(() => {
    if (sshProfiles.length === 0) {
      if (!loadingSSHProfiles) {
        setSelectedProfileId('')
      }
      return
    }
    if (selectedProfile) {
      return
    }
    const firstProfile = sshProfiles[0]!
    setSelectedProfileId(firstProfile.profileId)
    setRemoteWorkingDirectory(firstProfile.defaultRemoteCwd || '~')
    setRemoteCommand(firstProfile.remoteCommand || '')
  }, [loadingSSHProfiles, selectedProfile, sshProfiles])

  const params = useMemo(
    () => buildTerminalCreateParams(
      backend === 'local'
        ? {
            backend,
            workingDirectory: localWorkingDirectory,
            name: localName,
            command: localCommand
          }
        : {
            backend,
            profileId: selectedProfileId,
            workingDirectory: remoteWorkingDirectory,
            name: remoteName,
            command: remoteCommand
          }
    ),
    [
      backend,
      localCommand,
      localName,
      localWorkingDirectory,
      remoteCommand,
      remoteName,
      remoteWorkingDirectory,
      selectedProfileId
    ]
  )
  const canSubmit = Boolean(params) && !submitting && (backend === 'local' || canCreateSSH)

  const close = () => {
    if (!submitting) {
      onClose()
    }
  }

  const selectProfile = (profile: RemoteSSHProfileSummary) => {
    setSelectedProfileId(profile.profileId)
    setRemoteWorkingDirectory(profile.defaultRemoteCwd || '~')
    setRemoteCommand(profile.remoteCommand || '')
    setProfileMenuOpen(false)
  }

  return (
    <BottomDrawer
      visible={visible}
      onClose={close}
      dragContentToDismiss={!submitting}
      dismissible={!submitting}
    >
      <View style={styles.header}>
        <View style={styles.headerIcon}>
          <TerminalSquare size={18} color={colors.textPrimary} />
        </View>
        <View style={styles.headerText}>
          <Text style={styles.title}>{t('createTerminal.title')}</Text>
        </View>
      </View>

      <View style={styles.segmentedControl}>
        <Pressable
          style={[styles.segment, backend === 'local' && styles.segmentSelected]}
          onPress={() => {
            setBackend('local')
            setProfileMenuOpen(false)
          }}
          accessibilityRole="button"
          accessibilityState={{ selected: backend === 'local' }}
        >
          <HardDrive size={16} color={backend === 'local' ? colors.textPrimary : colors.textMuted} />
          <Text style={[styles.segmentText, backend === 'local' && styles.segmentTextSelected]}>
            {t('createTerminal.local')}
          </Text>
        </Pressable>
        <Pressable
          disabled={!canCreateSSH}
          style={[
            styles.segment,
            backend === 'ssh' && styles.segmentSelected,
            !canCreateSSH && styles.disabled
          ]}
          onPress={() => setBackend('ssh')}
          accessibilityRole="button"
          accessibilityState={{ selected: backend === 'ssh', disabled: !canCreateSSH }}
        >
          <Server size={16} color={backend === 'ssh' ? colors.textPrimary : colors.textMuted} />
          <Text style={[styles.segmentText, backend === 'ssh' && styles.segmentTextSelected]}>
            {t('createTerminal.remote')}
          </Text>
        </Pressable>
      </View>

      {backend === 'local' ? (
        <View style={styles.fields}>
          <FieldLabel text={t('createTerminal.workingDirectory')} required />
          <TextInput
            style={styles.input}
            value={localWorkingDirectory}
            onChangeText={setLocalWorkingDirectory}
            placeholder={t('createTerminal.localPathPlaceholder')}
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={4096}
            selectionColor={colors.accentBlue}
            accessibilityLabel={t('createTerminal.workingDirectory')}
          />
          <FieldLabel text={t('createTerminal.name')} />
          <TextInput
            style={styles.input}
            value={localName}
            onChangeText={setLocalName}
            placeholder={t('createTerminal.namePlaceholder')}
            placeholderTextColor={colors.textMuted}
            autoCorrect={false}
            maxLength={120}
            selectionColor={colors.accentBlue}
            accessibilityLabel={t('createTerminal.name')}
          />
          <FieldLabel text={t('createTerminal.command')} />
          <TextInput
            style={styles.input}
            value={localCommand}
            onChangeText={setLocalCommand}
            placeholder={t('createTerminal.localCommandPlaceholder')}
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={500}
            selectionColor={colors.accentBlue}
            accessibilityLabel={t('createTerminal.command')}
          />
        </View>
      ) : (
        <View style={styles.fields}>
          <FieldLabel text={t('createTerminal.sshProfile')} required />
          {loadingSSHProfiles ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={colors.textSecondary} />
              <Text style={styles.loadingText}>{t('createTerminal.loadingProfiles')}</Text>
            </View>
          ) : sshProfilesError ? (
            <View style={styles.inlineErrorBlock}>
              <Text style={styles.errorText}>{sshProfilesError}</Text>
              <Pressable onPress={onRetrySSHProfiles} accessibilityRole="button">
                <Text style={styles.retryText}>{t('common.retry')}</Text>
              </Pressable>
            </View>
          ) : sshProfiles.length === 0 ? (
            <View style={styles.emptyProfiles}>
              <Text style={styles.emptyProfilesTitle}>{t('createTerminal.noProfiles')}</Text>
              <Text style={styles.emptyProfilesText}>{t('createTerminal.noProfilesHint')}</Text>
            </View>
          ) : (
            <View>
              <Pressable
                style={[styles.profileTrigger, profileMenuOpen && styles.profileTriggerOpen]}
                onPress={() => setProfileMenuOpen((open) => !open)}
                accessibilityRole="button"
                accessibilityLabel={t('createTerminal.sshProfile')}
                accessibilityState={{ expanded: profileMenuOpen }}
              >
                <Server size={16} color={colors.textPrimary} />
                <View style={styles.profileText}>
                  <Text style={styles.profileName} numberOfLines={1}>
                    {selectedProfile?.name ?? t('createTerminal.selectProfile')}
                  </Text>
                  {selectedProfile ? (
                    <Text style={styles.profileTarget} numberOfLines={1}>
                      {selectedProfile.user}@{selectedProfile.host}:{selectedProfile.port}
                    </Text>
                  ) : null}
                </View>
                <ChevronDown size={16} color={colors.textSecondary} />
              </Pressable>
              {profileMenuOpen ? (
                <View style={styles.profileMenu}>
                  {sshProfiles.map((profile, index) => {
                    const selected = profile.profileId === selectedProfileId
                    return (
                      <View key={profile.profileId}>
                        {index > 0 ? <View style={styles.profileSeparator} /> : null}
                        <Pressable
                          style={styles.profileRow}
                          onPress={() => selectProfile(profile)}
                          accessibilityRole="button"
                          accessibilityState={{ selected }}
                        >
                          <View style={styles.profileText}>
                            <Text style={styles.profileName} numberOfLines={1}>{profile.name}</Text>
                            <Text style={styles.profileTarget} numberOfLines={1}>
                              {profile.user}@{profile.host}:{profile.port}
                            </Text>
                          </View>
                          {selected ? <Check size={15} color={colors.textPrimary} /> : null}
                        </Pressable>
                      </View>
                    )
                  })}
                </View>
              ) : null}
            </View>
          )}
          <FieldLabel text={t('createTerminal.remoteWorkingDirectory')} required />
          <TextInput
            style={styles.input}
            value={remoteWorkingDirectory}
            onChangeText={setRemoteWorkingDirectory}
            placeholder="~"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={4096}
            selectionColor={colors.accentBlue}
            accessibilityLabel={t('createTerminal.remoteWorkingDirectory')}
          />
          <FieldLabel text={t('createTerminal.name')} />
          <TextInput
            style={styles.input}
            value={remoteName}
            onChangeText={setRemoteName}
            placeholder={selectedProfile?.name ?? t('createTerminal.namePlaceholder')}
            placeholderTextColor={colors.textMuted}
            autoCorrect={false}
            maxLength={120}
            selectionColor={colors.accentBlue}
            accessibilityLabel={t('createTerminal.name')}
          />
          <FieldLabel text={t('createTerminal.command')} />
          <TextInput
            style={styles.input}
            value={remoteCommand}
            onChangeText={setRemoteCommand}
            placeholder={t('createTerminal.remoteCommandPlaceholder')}
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={500}
            selectionColor={colors.accentBlue}
            accessibilityLabel={t('createTerminal.command')}
          />
        </View>
      )}

      {!canCreateSSH ? (
        <Text style={styles.supportText}>{t('createTerminal.remoteUnavailable')}</Text>
      ) : null}
      {submitError ? <Text style={styles.errorText}>{submitError}</Text> : null}

      <View style={styles.actions}>
        <Pressable
          style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]}
          disabled={submitting}
          onPress={close}
          accessibilityRole="button"
        >
          <Text style={styles.cancelText}>{t('common.cancel')}</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            styles.submitButton,
            pressed && styles.pressed,
            !canSubmit && styles.disabled
          ]}
          disabled={!canSubmit}
          onPress={() => {
            if (params) {
              onSubmit(params)
            }
          }}
          accessibilityRole="button"
        >
          {submitting ? (
            <ActivityIndicator color={colors.bgBase} size="small" />
          ) : (
            <TerminalSquare size={16} color={colors.bgBase} />
          )}
          <Text style={styles.submitText}>{t('createTerminal.createAndOpen')}</Text>
        </Pressable>
      </View>
    </BottomDrawer>
  )
}

function FieldLabel({ text, required = false }: { text: string; required?: boolean }) {
  const { t } = useMobileI18n()
  return (
    <View style={styles.labelRow}>
      <Text style={styles.label}>{text}</Text>
      <Text style={styles.optionalLabel}>
        {required ? t('createTerminal.required') : t('createTerminal.optional')}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md
  },
  headerIcon: {
    width: 34,
    height: 34,
    borderRadius: radii.button,
    backgroundColor: colors.bgRaised,
    alignItems: 'center',
    justifyContent: 'center'
  },
  headerText: {
    flex: 1,
    minWidth: 0
  },
  title: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '700'
  },
  segmentedControl: {
    flexDirection: 'row',
    gap: spacing.xs,
    borderRadius: radii.input,
    backgroundColor: colors.bgBase,
    padding: spacing.xs,
    marginBottom: spacing.md
  },
  segment: {
    flex: 1,
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radii.button
  },
  segmentSelected: {
    backgroundColor: colors.bgRaised,
    borderWidth: 1,
    borderColor: colors.borderStrong
  },
  segmentText: {
    color: colors.textMuted,
    fontSize: typography.bodySize,
    fontWeight: '600'
  },
  segmentTextSelected: {
    color: colors.textPrimary
  },
  fields: {
    gap: spacing.sm
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: spacing.xs
  },
  label: {
    color: colors.textSecondary,
    fontSize: typography.metaSize,
    fontWeight: '700'
  },
  optionalLabel: {
    color: colors.textMuted,
    fontSize: 11
  },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radii.input,
    backgroundColor: colors.bgRaised,
    color: colors.textPrimary,
    fontSize: typography.bodySize,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  loadingRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radii.input,
    backgroundColor: colors.bgRaised,
    paddingHorizontal: spacing.md
  },
  loadingText: {
    color: colors.textSecondary,
    fontSize: typography.bodySize
  },
  inlineErrorBlock: {
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.statusRed,
    borderRadius: radii.input,
    backgroundColor: colors.bgRaised,
    padding: spacing.md
  },
  retryText: {
    color: colors.textPrimary,
    fontSize: typography.bodySize,
    fontWeight: '700'
  },
  emptyProfiles: {
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radii.input,
    backgroundColor: colors.bgRaised,
    padding: spacing.md
  },
  emptyProfilesTitle: {
    color: colors.textPrimary,
    fontSize: typography.bodySize,
    fontWeight: '700'
  },
  emptyProfilesText: {
    color: colors.textSecondary,
    fontSize: typography.metaSize,
    lineHeight: 18
  },
  profileTrigger: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radii.input,
    backgroundColor: colors.bgRaised,
    paddingHorizontal: spacing.md
  },
  profileTriggerOpen: {
    borderColor: colors.borderStrong
  },
  profileMenu: {
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.input,
    backgroundColor: colors.bgPanel,
    marginTop: spacing.xs
  },
  profileRow: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  profileText: {
    flex: 1,
    minWidth: 0
  },
  profileName: {
    color: colors.textPrimary,
    fontSize: typography.bodySize,
    fontWeight: '700'
  },
  profileTarget: {
    color: colors.textMuted,
    fontSize: typography.metaSize,
    marginTop: 2
  },
  profileSeparator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.borderSubtle,
    marginHorizontal: spacing.md
  },
  supportText: {
    color: colors.textMuted,
    fontSize: typography.metaSize,
    lineHeight: 18,
    marginTop: spacing.md
  },
  errorText: {
    color: colors.statusRed,
    fontSize: typography.metaSize,
    lineHeight: 18,
    marginTop: spacing.md
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.lg
  },
  cancelButton: {
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.button,
    backgroundColor: colors.bgRaised,
    paddingHorizontal: spacing.lg
  },
  cancelText: {
    color: colors.textSecondary,
    fontSize: typography.bodySize,
    fontWeight: '700'
  },
  submitButton: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radii.button,
    backgroundColor: colors.surfaceBright,
    paddingHorizontal: spacing.lg
  },
  submitText: {
    color: colors.bgBase,
    fontSize: typography.bodySize,
    fontWeight: '800'
  },
  disabled: {
    opacity: 0.48
  },
  pressed: {
    opacity: 0.78
  }
})
