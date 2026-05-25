import React, { useEffect, useMemo, useRef, useState } from 'react'
import * as Select from '@radix-ui/react-select'
import * as Tabs from '@radix-ui/react-tabs'
import { Check, ChevronDown, ChevronRight } from 'lucide-react'
import { Dialog } from './ui/Dialog'
import { Button } from './ui/Button'
import { useWindowStore } from '../stores/windowStore'
import { useI18n } from '../i18n'
import type { Window } from '../types/window'
import type { CanvasWorkspace } from '../../shared/types/canvas'
import { SSHAuthType, SSHCredentialState, SSHProfile, SSHProfileInput, SSHRoutingMode } from '../../shared/types/ssh'
import { DEFAULT_SSH_READY_TIMEOUT_MS } from '../../shared/utils/sshDefaults'
import { TerminalTypeLogo } from './icons/TerminalTypeLogo'
import {
  idePopupActionButtonClassName,
  idePopupBarePanelClassName,
  idePopupCardClassName,
  idePopupInputClassName,
  idePopupPanelClassName,
  idePopupSecondaryButtonClassName,
  idePopupSelectContentClassName,
  idePopupSelectItemClassName,
  idePopupSelectTriggerClassName,
  idePopupSubtlePanelClassName,
} from './ui/ide-popup'

interface CreateWindowDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sshEnabled?: boolean
  availableTabs?: CreateWindowTab[]
  initialTab?: CreateWindowTab
  initialWorkingDirectory?: string
  sshProfiles?: SSHProfile[]
  editingSSHProfile?: SSHProfile | null
  initialSSHProfile?: SSHProfile | null
  sshCredentialState?: SSHCredentialState | null
  onSSHProfileSaved?: (profile: SSHProfile, credentialState: SSHCredentialState) => void
  onSSHProfileConnect?: (profile: SSHProfile) => void | Promise<void>
  onLocalWindowCreated?: (window: Window) => void | Promise<void>
  onCanvasWorkspaceCreated?: (canvasWorkspace: CanvasWorkspace) => void | Promise<void>
  localWindowOwnerCanvasWorkspaceId?: string | null
  sshSubmitMode?: 'save' | 'saveAndConnect'
}

interface ShellProgramOption {
  command: string
  path: string
  isDefault: boolean
}

type CreateWindowTab = 'local' | 'ssh' | 'canvas'
type SSHSettingsTab = 'basic' | 'auth' | 'routing' | 'session'

interface SSHCreateFormState {
  name: string
  host: string
  port: string
  user: string
  auth: SSHAuthType
  privateKeysText: string
  defaultRemoteCwd: string
  remoteCommand: string
  keepaliveInterval: string
  keepaliveCountMax: string
  readyTimeout: string
  verifyHostKeys: boolean
  agentForward: boolean
  skipBanner: boolean
  warnOnClose: boolean
  reuseSession: boolean
  x11: boolean
  routingMode: SSHRoutingMode
  jumpHostProfileId: string
  proxyCommand: string
  socksProxyHost: string
  socksProxyPort: string
  httpProxyHost: string
  httpProxyPort: string
}

const AUTO_SHELL_OPTION_VALUE = '__auto__'
const DEFAULT_SSH_CREDENTIAL_STATE: SSHCredentialState = {
  hasPassword: false,
  hasPassphrase: false,
}

function uniqueList(values: string[]): string[] {
  return Array.from(new Set(values))
}

function parseLineList(value: string): string[] {
  return uniqueList(
    value
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean),
  )
}

function trimOptional(value: string): string | undefined {
  const normalized = value.trim()
  return normalized || undefined
}

function parseOptionalProxyPort(value: string): number | undefined {
  const port = Number(value)
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : undefined
}

function resolveRoutingMode(profile?: SSHProfile | null): SSHRoutingMode {
  return profile?.routingMode ?? 'direct'
}

function createInitialSSHForm(profile?: SSHProfile | null, duplicate = false): SSHCreateFormState {
  const defaultName = duplicate && profile?.name
    ? `copy-${profile.name}`
    : profile?.name ?? ''

  return {
    name: defaultName,
    host: profile?.host ?? '',
    port: String(profile?.port ?? 22),
    user: profile?.user ?? '',
    auth: profile?.auth ?? 'password',
    privateKeysText: profile?.privateKeys.join('\n') ?? '',
    defaultRemoteCwd: profile?.defaultRemoteCwd ?? '',
    remoteCommand: profile?.remoteCommand ?? '',
    keepaliveInterval: String(profile?.keepaliveInterval ?? 30),
    keepaliveCountMax: String(profile?.keepaliveCountMax ?? 3),
    readyTimeout: profile?.readyTimeout ? String(profile.readyTimeout) : '',
    verifyHostKeys: profile?.verifyHostKeys ?? true,
    agentForward: profile?.agentForward ?? false,
    skipBanner: profile?.skipBanner ?? false,
    warnOnClose: profile?.warnOnClose ?? true,
    reuseSession: profile?.reuseSession ?? true,
    x11: profile?.x11 ?? false,
    routingMode: resolveRoutingMode(profile),
    jumpHostProfileId: profile?.jumpHostProfileId ?? '',
    proxyCommand: profile?.proxyCommand ?? '',
    socksProxyHost: profile?.socksProxyHost ?? '',
    socksProxyPort: profile?.socksProxyPort ? String(profile.socksProxyPort) : '1080',
    httpProxyHost: profile?.httpProxyHost ?? '',
    httpProxyPort: profile?.httpProxyPort ? String(profile.httpProxyPort) : '8080',
  }
}

function normalizeAvailableTabs(
  tabs: CreateWindowTab[] | undefined,
  sshEnabled: boolean,
): CreateWindowTab[] | undefined {
  if (!tabs || tabs.length === 0) {
    return undefined
  }

  const nextTabs = Array.from(new Set(tabs)).filter((tab) => (
    tab !== 'ssh' || sshEnabled
  ))

  return nextTabs.length > 0 ? nextTabs : undefined
}

export function CreateWindowDialog({
  open,
  onOpenChange,
  sshEnabled = false,
  availableTabs,
  initialTab,
  initialWorkingDirectory = '',
  sshProfiles = [],
  editingSSHProfile = null,
  initialSSHProfile = null,
  sshCredentialState = null,
  onSSHProfileSaved,
  onSSHProfileConnect,
  onLocalWindowCreated,
  onCanvasWorkspaceCreated,
  localWindowOwnerCanvasWorkspaceId = null,
  sshSubmitMode = 'save',
}: CreateWindowDialogProps) {
  const { t } = useI18n()
  const isEditingSSHProfile = Boolean(editingSSHProfile)
  const isDuplicatingSSHProfile = !isEditingSSHProfile && Boolean(initialSSHProfile)
  const normalizedAvailableTabs = useMemo(
    () => normalizeAvailableTabs(availableTabs, sshEnabled),
    [availableTabs, sshEnabled],
  )
  const resolvedAvailableTabs = useMemo<CreateWindowTab[]>(() => {
    if ((isEditingSSHProfile || isDuplicatingSSHProfile) && sshEnabled) {
      return ['ssh']
    }

    if (normalizedAvailableTabs && normalizedAvailableTabs.length > 0) {
      return normalizedAvailableTabs
    }

    const nextTabs: CreateWindowTab[] = ['local']
    if (sshEnabled) {
      nextTabs.push('ssh')
    }
    nextTabs.push('canvas')
    return nextTabs
  }, [isDuplicatingSSHProfile, isEditingSSHProfile, normalizedAvailableTabs, sshEnabled])
  const resolveInitialTab = useMemo(() => {
    if ((isEditingSSHProfile || isDuplicatingSSHProfile) && sshEnabled && resolvedAvailableTabs.includes('ssh')) {
      return 'ssh' as const
    }

    if (initialTab && resolvedAvailableTabs.includes(initialTab)) {
      return initialTab
    }

    return resolvedAvailableTabs[0] ?? 'local'
  }, [initialTab, isDuplicatingSSHProfile, isEditingSSHProfile, resolvedAvailableTabs, sshEnabled])
  const [activeTab, setActiveTab] = useState<CreateWindowTab>(resolveInitialTab)

  const [name, setName] = useState('')
  const [workingDirectory, setWorkingDirectory] = useState(initialWorkingDirectory)
  const [command, setCommand] = useState('')
  const [canvasName, setCanvasName] = useState('')
  const [canvasWorkingDirectory, setCanvasWorkingDirectory] = useState('')
  const [globalDefaultShell, setGlobalDefaultShell] = useState('')
  const [availableShells, setAvailableShells] = useState<ShellProgramOption[]>([])
  const [pathError, setPathError] = useState('')
  const [isValidating, setIsValidating] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [createError, setCreateError] = useState('')

  const [sshForm, setSSHForm] = useState<SSHCreateFormState>(() => (
    createInitialSSHForm(
      editingSSHProfile ?? initialSSHProfile,
      Boolean(initialSSHProfile) && !Boolean(editingSSHProfile),
    )
  ))
  const [sshPassword, setSSHPassword] = useState('')
  const [sshPassphrases, setSSHPassphrases] = useState<Record<string, string>>({})
  const [sshError, setSSHError] = useState('')
  const [showSSHRequiredErrors, setShowSSHRequiredErrors] = useState(false)
  const [isSavingSSH, setIsSavingSSH] = useState(false)
  const [activeSSHSettingsTab, setActiveSSHSettingsTab] = useState<SSHSettingsTab>('basic')
  const [showSSHPassphrases, setShowSSHPassphrases] = useState(false)
  const [detectKeysMessage, setDetectKeysMessage] = useState('')
  const [isDetectingKeys, setIsDetectingKeys] = useState(false)

  const workingDirInputRef = useRef<HTMLInputElement>(null)
  const canvasNameInputRef = useRef<HTMLInputElement>(null)
  const sshNameInputRef = useRef<HTMLInputElement>(null)
  const latestLocalCommandRef = useRef('')
  const addWindow = useWindowStore((state) => state.addWindow)
  const addCanvasWorkspace = useWindowStore((state) => state.addCanvasWorkspace)
  const canvasWorkspaceCount = useWindowStore((state) => state.canvasWorkspaces.length)
  const windows = useWindowStore((state) => state.windows)

  const currentPrivateKeys = useMemo(
    () => parseLineList(sshForm.privateKeysText),
    [sshForm.privateKeysText],
  )
  const sshRequiredFieldErrors = useMemo(
    () => ({
      host: showSSHRequiredErrors && !sshForm.host.trim(),
      user: showSSHRequiredErrors && !sshForm.user.trim(),
    }),
    [showSSHRequiredErrors, sshForm.host, sshForm.user],
  )
  const sshTemplateProfile = editingSSHProfile ?? initialSSHProfile
  const currentSSHCredentialState = isEditingSSHProfile
    ? (sshCredentialState ?? DEFAULT_SSH_CREDENTIAL_STATE)
    : DEFAULT_SSH_CREDENTIAL_STATE
  const recommendedShell = availableShells.find((shell) => shell.isDefault)
  const autoShellTarget = globalDefaultShell || recommendedShell?.path || ''
  const matchedShell = availableShells.find((shell) => (
    shell.path === command || shell.command === command
  ))
  const selectedShellOptions = command && !matchedShell
    ? [
        {
          command,
          path: command,
          isDefault: false,
        },
        ...availableShells,
      ]
    : availableShells
  const filteredShellOptions = autoShellTarget
    ? selectedShellOptions.filter((shell) => shell.path !== autoShellTarget)
    : selectedShellOptions
  const effectiveSelectedShell = matchedShell?.path ?? command
  const selectedShellValue = !effectiveSelectedShell || effectiveSelectedShell === autoShellTarget
    ? AUTO_SHELL_OPTION_VALUE
    : effectiveSelectedShell
  const autoShellLabel = autoShellTarget
    ? t('createWindow.shellAutoOption', { shell: autoShellTarget })
    : t('createWindow.shellAutoFallback')
  const placeholderName = t('createWindow.defaultName', { count: windows.length + 1 })
  const availableJumpHosts = useMemo(
    () => sshProfiles.filter((profile) => profile.id !== editingSSHProfile?.id),
    [editingSSHProfile?.id, sshProfiles],
  )
  const sshAuthNeedsPassword = sshForm.auth === 'password' || sshForm.auth === 'keyboardInteractive'
  const sshSummaryHost = sshForm.host.trim() || 'host'
  const sshSummaryUser = sshForm.user.trim() || 'user'
  const sshSummaryName = sshForm.name.trim() || sshForm.host.trim() || `${sshSummaryUser}@${sshSummaryHost}`
  const sshSummaryRoute = t(`sshProfileDialog.routing.${sshForm.routingMode}` as any)
  const sshRoutingModes: SSHRoutingMode[] = ['direct', 'jumpHost', 'proxyCommand', 'socks', 'http']

  const setSSHField = <K extends keyof SSHCreateFormState>(field: K, value: SSHCreateFormState[K]) => {
    setSSHForm((previous) => ({
      ...previous,
      [field]: value,
    }))
  }

  const updateLocalCommand = (value: string) => {
    latestLocalCommandRef.current = value
    setCommand(value)
  }

  const resetLocalForm = () => {
    setName('')
    setWorkingDirectory(initialWorkingDirectory)
    updateLocalCommand('')
    setPathError('')
    setCreateError('')
    setIsValidating(false)
  }

  const resetCanvasForm = () => {
    setCanvasName('')
    setCanvasWorkingDirectory('')
  }

  const resetSSHForm = (profile?: SSHProfile | null, duplicate = false) => {
    setSSHForm(createInitialSSHForm(profile, duplicate))
    setSSHPassword('')
    setSSHPassphrases({})
    setSSHError('')
    setShowSSHRequiredErrors(false)
    setActiveSSHSettingsTab('basic')
    setShowSSHPassphrases(false)
    setDetectKeysMessage('')
    setIsDetectingKeys(false)
  }

  const resetDialog = () => {
    setActiveTab(resolveInitialTab)
    resetLocalForm()
    resetCanvasForm()
    resetSSHForm(editingSSHProfile ?? initialSSHProfile, isDuplicatingSSHProfile)
  }

  useEffect(() => {
    if (!open) {
      setGlobalDefaultShell('')
      setAvailableShells([])
      resetDialog()
      return
    }

    let disposed = false

    const loadShellSettings = async () => {
      try {
        const [settingsResponse, shellsResponse] = await Promise.all([
          window.electronAPI.getSettings(),
          window.electronAPI.getAvailableShells(),
        ])

        if (settingsResponse?.success && settingsResponse.data && !disposed) {
          setGlobalDefaultShell(settingsResponse.data.terminal?.defaultShellProgram ?? '')
        }

        if (shellsResponse?.success && shellsResponse.data && !disposed) {
          setAvailableShells(shellsResponse.data)
        }
      } catch (error) {
        if (!disposed) {
          setGlobalDefaultShell('')
          setAvailableShells([])
        }
      }
    }

    void loadShellSettings()

    return () => {
      disposed = true
    }
  }, [open, initialWorkingDirectory, resolveInitialTab])

  useEffect(() => {
    if (!open) {
      return
    }

    if ((isEditingSSHProfile || isDuplicatingSSHProfile) && sshEnabled) {
      setActiveTab('ssh')
      resetSSHForm(editingSSHProfile ?? initialSSHProfile, isDuplicatingSSHProfile)
      resetLocalForm()
      return
    }

    setActiveTab(resolveInitialTab)
    resetLocalForm()
    resetSSHForm()
  }, [editingSSHProfile, initialSSHProfile, isDuplicatingSSHProfile, isEditingSSHProfile, open, resolveInitialTab, sshEnabled])

  useEffect(() => {
    if (!open) {
      return
    }

    const timer = setTimeout(() => {
      if (activeTab === 'ssh' && sshEnabled) {
        sshNameInputRef.current?.focus()
      } else if (activeTab === 'canvas') {
        canvasNameInputRef.current?.focus()
      } else {
        workingDirInputRef.current?.focus()
      }
    }, 0)

    return () => clearTimeout(timer)
  }, [activeTab, open, sshEnabled])

  useEffect(() => {
    if (!workingDirectory || !open || activeTab !== 'local') {
      if (!workingDirectory) {
        setPathError('')
      }
      return
    }

    setIsValidating(true)
    const timer = setTimeout(async () => {
      try {
        const response = await window.electronAPI.validatePath(workingDirectory)
        if (response && response.success) {
          setPathError(response.data ? '' : t('createWindow.errorPathNotFound'))
        } else {
          setPathError(t('createWindow.errorValidationFailed'))
        }
      } catch (error) {
        setPathError(t('createWindow.errorValidationFailed'))
      } finally {
        setIsValidating(false)
      }
    }, 300)

    return () => clearTimeout(timer)
  }, [activeTab, open, t, workingDirectory])

  useEffect(() => {
    setSSHPassphrases((previous) => {
      const next: Record<string, string> = {}
      currentPrivateKeys.forEach((keyPath) => {
        next[keyPath] = previous[keyPath] ?? ''
      })
      return next
    })
  }, [currentPrivateKeys])

  useEffect(() => {
    if (currentPrivateKeys.length === 0) {
      setShowSSHPassphrases(false)
    }
  }, [currentPrivateKeys.length])

  const handleSelectDirectory = async () => {
    try {
      const response = await window.electronAPI.selectDirectory()
      if (response && response.success && response.data) {
        setWorkingDirectory(response.data)
      }
    } catch (error) {
      console.error('Failed to select directory:', error)
    }
  }

  const handleSelectCustomShell = async () => {
    try {
      const response = await window.electronAPI.selectExecutableFile()
      if (response?.success && response.data) {
        updateLocalCommand(response.data)
      }
    } catch (error) {
      console.error('Failed to select custom shell:', error)
    }
  }

  const handleDetectPrivateKeys = async () => {
    setDetectKeysMessage('')
    setSSHError('')
    setIsDetectingKeys(true)

    try {
      const response = await window.electronAPI.detectLocalSSHPrivateKeys()
      if (!response?.success || !response.data) {
        throw new Error(response?.error || t('sshProfileDialog.detectKeysError'))
      }

      if (response.data.length === 0) {
        setDetectKeysMessage(t('sshProfileDialog.detectKeysEmpty'))
        return
      }

      const mergedKeys = uniqueList([
        ...parseLineList(sshForm.privateKeysText),
        ...response.data,
      ])
      setSSHField('privateKeysText', mergedKeys.join('\n'))
      setDetectKeysMessage(t('sshProfileDialog.detectKeysSuccess', { count: response.data.length }))
    } catch (error) {
      setDetectKeysMessage((error as Error).message || t('sshProfileDialog.detectKeysError'))
    } finally {
      setIsDetectingKeys(false)
    }
  }

  const handleLocalSubmit = async () => {
    if (!workingDirectory || pathError || isValidating) {
      return
    }

    setIsCreating(true)
    setCreateError('')

    try {
      const response = await window.electronAPI.createWindow({
        name: name || undefined,
        workingDirectory,
        command: command || latestLocalCommandRef.current || undefined,
      })

      if (response && response.success && response.data) {
        const ownerCanvasWorkspaceId = localWindowOwnerCanvasWorkspaceId?.trim()
        const createdWindow: Window = ownerCanvasWorkspaceId
          ? {
              ...response.data,
              ownerType: 'canvas-owned',
              ownerCanvasWorkspaceId,
            }
          : response.data

        addWindow(createdWindow)
        await onLocalWindowCreated?.(createdWindow)
        onOpenChange(false)
        resetDialog()
      } else {
        throw new Error(response?.error || t('createWindow.errorCreateFailed'))
      }
    } catch (error) {
      let errorMessage = (error as Error).message || t('createWindow.errorCreateFailedRetry')

      if (errorMessage.includes('posix_spawnp failed')) {
        errorMessage = t('createWindow.errorSpawnFailed')
      } else if (errorMessage.includes('Working directory does not exist')) {
        errorMessage = t('createWindow.errorPathNotFound')
      }

      setCreateError(errorMessage)
    } finally {
      setIsCreating(false)
    }
  }

  const handleCanvasSubmit = async () => {
    const now = new Date().toISOString()
    const nextCanvasWorkspace: CanvasWorkspace = {
      id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `canvas-${Date.now()}`,
      name: canvasName.trim() || t('canvas.defaultWorkspaceName', { count: canvasWorkspaceCount + 1 }),
      createdAt: now,
      updatedAt: now,
      workingDirectory: canvasWorkingDirectory.trim() || undefined,
      blocks: [],
      viewport: {
        tx: 0,
        ty: 0,
        zoom: 1,
      },
      nextZIndex: 1,
    }

    addCanvasWorkspace(nextCanvasWorkspace)
    await onCanvasWorkspaceCreated?.(nextCanvasWorkspace)
    onOpenChange(false)
    resetDialog()
  }

  const handleSSHSubmit = async () => {
    const host = sshForm.host.trim()
    const user = sshForm.user.trim()
    const profileName = sshForm.name.trim() || host
    const privateKeys = parseLineList(sshForm.privateKeysText)
    const passwordValue = sshPassword.trim()

    const port = Number(sshForm.port)
    const keepaliveInterval = Number(sshForm.keepaliveInterval)
    const keepaliveCountMax = Number(sshForm.keepaliveCountMax)
    const readyTimeout = sshForm.readyTimeout.trim() ? Number(sshForm.readyTimeout) : null
    const socksProxyPort = parseOptionalProxyPort(sshForm.socksProxyPort)
    const httpProxyPort = parseOptionalProxyPort(sshForm.httpProxyPort)

    setSSHError('')
    setShowSSHRequiredErrors(true)

    if (!host || !user) {
      setActiveSSHSettingsTab('basic')
      setSSHError(t('sshProfileDialog.error.required'))
      return
    }

    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      setSSHError(t('sshProfileDialog.error.port'))
      return
    }

    if (!Number.isInteger(keepaliveInterval) || keepaliveInterval < 0) {
      setSSHError(t('sshProfileDialog.error.keepaliveInterval'))
      return
    }

    if (!Number.isInteger(keepaliveCountMax) || keepaliveCountMax < 0) {
      setSSHError(t('sshProfileDialog.error.keepaliveCount'))
      return
    }

    if (readyTimeout !== null && (!Number.isInteger(readyTimeout) || readyTimeout <= 0)) {
      setSSHError(t('sshProfileDialog.error.readyTimeout'))
      return
    }

    if (sshForm.auth === 'publicKey' && privateKeys.length === 0) {
      setSSHError(t('sshProfileDialog.error.privateKeysRequired'))
      return
    }

    const jumpHostProfileId = trimOptional(sshForm.jumpHostProfileId)
    const proxyCommand = trimOptional(sshForm.proxyCommand)
    const socksProxyHost = trimOptional(sshForm.socksProxyHost)
    const httpProxyHost = trimOptional(sshForm.httpProxyHost)

    if (sshForm.routingMode === 'jumpHost' && !jumpHostProfileId) {
      setSSHError(t('sshProfileDialog.error.jumpHostRequired'))
      return
    }

    if (sshForm.routingMode === 'proxyCommand' && !proxyCommand) {
      setSSHError(t('sshProfileDialog.error.proxyCommandRequired'))
      return
    }

    if (sshForm.routingMode === 'socks') {
      if (!socksProxyHost) {
        setSSHError(t('sshProfileDialog.error.proxyHostRequired'))
        return
      }

      if (socksProxyPort === undefined) {
        setSSHError(t('sshProfileDialog.error.proxyPort'))
        return
      }
    }

    if (sshForm.routingMode === 'http') {
      if (!httpProxyHost) {
        setSSHError(t('sshProfileDialog.error.proxyHostRequired'))
        return
      }

      if (httpProxyPort === undefined) {
        setSSHError(t('sshProfileDialog.error.proxyPort'))
        return
      }
    }

    const input: SSHProfileInput = {
      name: profileName,
      host,
      port,
      user,
      auth: sshForm.auth,
      privateKeys,
      keepaliveInterval,
      keepaliveCountMax,
      readyTimeout,
      verifyHostKeys: sshForm.verifyHostKeys,
      x11: sshForm.x11,
      skipBanner: sshForm.skipBanner,
      routingMode: sshForm.routingMode,
      jumpHostProfileId,
      agentForward: sshForm.agentForward,
      warnOnClose: sshForm.warnOnClose,
      proxyCommand,
      socksProxyHost,
      socksProxyPort: socksProxyHost ? socksProxyPort : undefined,
      httpProxyHost,
      httpProxyPort: httpProxyHost ? httpProxyPort : undefined,
      reuseSession: sshForm.reuseSession,
      algorithms: sshTemplateProfile?.algorithms,
      forwardedPorts: sshTemplateProfile?.forwardedPorts ?? [],
      remoteCommand: trimOptional(sshForm.remoteCommand),
      defaultRemoteCwd: trimOptional(sshForm.defaultRemoteCwd),
      tags: sshTemplateProfile?.tags ?? [],
      notes: sshTemplateProfile?.notes,
      icon: sshTemplateProfile?.icon,
      color: sshTemplateProfile?.color,
    }

    setIsSavingSSH(true)

    try {
      const response = editingSSHProfile
        ? await window.electronAPI.updateSSHProfile(editingSSHProfile.id, input)
        : await window.electronAPI.createSSHProfile(input)
      if (!response?.success || !response.data) {
        throw new Error(response?.error || t('sshProfileDialog.error.saveFailed'))
      }

      const savedProfile = response.data
      const existingPrivateKeys = editingSSHProfile?.privateKeys ?? []

      if (sshAuthNeedsPassword && passwordValue) {
        await window.electronAPI.setSSHPassword(savedProfile.id, passwordValue)
      } else if (!sshAuthNeedsPassword && currentSSHCredentialState.hasPassword) {
        await window.electronAPI.clearSSHPassword(savedProfile.id)
      }

      const keysToClear = new Set<string>()
      if (sshForm.auth !== 'publicKey') {
        existingPrivateKeys.forEach((keyPath) => keysToClear.add(keyPath))
      } else {
        existingPrivateKeys
          .filter((keyPath) => !currentPrivateKeys.includes(keyPath))
          .forEach((keyPath) => keysToClear.add(keyPath))
      }

      await Promise.all(
        Array.from(keysToClear).map((keyPath) => (
          window.electronAPI.clearSSHPrivateKeyPassphrase(savedProfile.id, keyPath)
        )),
      )

      if (sshForm.auth === 'publicKey') {
        await Promise.all(
          currentPrivateKeys
            .filter((keyPath) => sshPassphrases[keyPath]?.trim())
            .map((keyPath) => (
              window.electronAPI.setSSHPrivateKeyPassphrase(
                savedProfile.id,
                keyPath,
                sshPassphrases[keyPath].trim(),
              )
            )),
        )
      }

      const credentialStateResponse = await window.electronAPI.getSSHCredentialState(savedProfile.id)
      const nextCredentialState = credentialStateResponse?.success && credentialStateResponse.data
        ? credentialStateResponse.data
        : DEFAULT_SSH_CREDENTIAL_STATE

      onSSHProfileSaved?.(savedProfile, nextCredentialState)
      if (!isEditingSSHProfile && sshSubmitMode === 'saveAndConnect') {
        await onSSHProfileConnect?.(savedProfile)
      }
      onOpenChange(false)
      resetDialog()
    } catch (error) {
      setSSHError((error as Error).message || t('sshProfileDialog.error.saveFailed'))
    } finally {
      setIsSavingSSH(false)
    }
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()

    if (activeTab === 'ssh' && sshEnabled) {
      await handleSSHSubmit()
      return
    }

    if (activeTab === 'canvas') {
      await handleCanvasSubmit()
      return
    }

    await handleLocalSubmit()
  }

  const renderTabTrigger = (
    value: CreateWindowTab,
    icon: React.ReactNode,
    title: string,
  ) => (
    <Tabs.Trigger
      value={value}
      className="group relative inline-flex shrink-0 items-center justify-center gap-2.5 rounded-[14px] border border-transparent px-5 py-3 text-sm font-medium text-[rgb(var(--muted-foreground))] transition-all hover:text-[rgb(var(--foreground))] data-[state=active]:text-[rgb(var(--foreground))]"
    >
      <span className="transition-colors group-data-[state=active]:text-[rgb(var(--ring))]">
        {icon}
      </span>
      <span className="whitespace-nowrap">{title}</span>
      <span className="absolute inset-x-2 -bottom-0.5 h-0.5 rounded-full bg-[rgb(var(--ring))] opacity-0 transition-opacity group-data-[state=active]:opacity-100" />
    </Tabs.Trigger>
  )

  const renderSSHSettingsTrigger = (
    value: SSHSettingsTab,
    title: string,
  ) => (
    <Tabs.Trigger
      key={value}
      value={value}
      className="rounded-[12px] border border-transparent px-4 py-2.5 text-sm font-medium text-[rgb(var(--muted-foreground))] transition-all hover:bg-[rgb(var(--accent))] hover:text-[rgb(var(--foreground))] data-[state=active]:bg-[color-mix(in_srgb,rgb(var(--card))_78%,transparent)] data-[state=active]:text-[rgb(var(--foreground))] data-[state=active]:shadow-sm"
    >
      {title}
    </Tabs.Trigger>
  )

  const renderSSHSummaryItem = (
    label: string,
    value: string,
  ) => (
    <div className={`${idePopupSubtlePanelClassName} px-3.5 py-2.5`}>
      <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-[rgb(var(--muted-foreground))]">
        {label}
      </div>
      <div className="mt-1 truncate text-sm font-semibold text-[rgb(var(--foreground))]" title={value}>
        {value}
      </div>
    </div>
  )

  const renderBooleanField = (
    id: string,
    checked: boolean,
    label: string,
    onCheckedChange: (checked: boolean) => void,
  ) => (
    <label
      htmlFor={id}
      className={`flex cursor-pointer items-start gap-3 ${idePopupSubtlePanelClassName} px-3.5 py-3 text-sm text-[rgb(var(--foreground))] transition-colors hover:bg-[rgb(var(--accent))]`}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onCheckedChange(event.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--background))_88%,transparent)] text-[rgb(var(--ring))] [color-scheme:dark] focus:ring-[rgb(var(--ring))]"
      />
      <span className="leading-5">{label}</span>
    </label>
  )

  const sectionShellClassName = `${idePopupPanelClassName} rounded-[16px] p-6`
  const fieldLabelClassName = 'mb-2 block text-[13px] font-medium text-[rgb(var(--muted-foreground))]'
  const textFieldClassName = `${idePopupInputClassName} rounded-[12px] py-2.5 [color-scheme:dark]`
  const errorFieldClassName = 'border-status-error focus:border-status-error focus:ring-status-error/80'
  const selectTriggerClassName = `${idePopupSelectTriggerClassName} rounded-[12px] py-2.5 [color-scheme:dark]`
  const selectMenuClassName = `z-[80] w-[var(--radix-select-trigger-width)] rounded-[12px] [color-scheme:dark] ${idePopupSelectContentClassName}`
  const selectItemClassName = `${idePopupSelectItemClassName} rounded-[8px]`
  const compactButtonClassName = 'inline-flex h-10 items-center justify-center rounded-[10px] px-4 text-sm font-medium whitespace-nowrap'
  const compactSecondaryButtonToneClassName = `${idePopupSecondaryButtonClassName} ${compactButtonClassName}`
  const compactPrimaryButtonToneClassName = `${idePopupActionButtonClassName('primary')} ${compactButtonClassName}`
  const dialogActionButtonClassName = 'w-full sm:w-auto sm:min-w-[132px]'
  const sshTabListClassName = 'mb-5 flex gap-1 rounded-[14px] bg-[color-mix(in_srgb,rgb(var(--secondary))_72%,transparent)] p-1'
  const sshRouteTabListClassName = 'grid grid-cols-2 gap-1.5 rounded-[14px] bg-[color-mix(in_srgb,rgb(var(--secondary))_72%,transparent)] p-1 sm:grid-cols-3 lg:grid-cols-5'
  const sshRouteTabTriggerClassName = 'rounded-[10px] border border-transparent px-2.5 py-2 text-xs font-medium text-[rgb(var(--muted-foreground))] transition-all hover:text-[rgb(var(--foreground))] data-[state=active]:border-[rgb(var(--primary))] data-[state=active]:bg-[rgb(var(--primary))] data-[state=active]:text-[rgb(var(--primary-foreground))] data-[state=active]:shadow-sm'
  const sshInlineCardClassName = `${idePopupSubtlePanelClassName} rounded-[14px] p-4`
  const sshRouteSummaryCardClassName = `${idePopupSubtlePanelClassName} rounded-[12px] px-4 py-3`
  const sshActiveRouteClassName = 'rounded-[12px] border border-[rgb(var(--primary))] bg-[color-mix(in_srgb,rgb(var(--primary))_14%,transparent)] px-4 py-3 text-sm text-[rgb(var(--foreground))]'
  const asideCardClassName = `${sectionShellClassName}`
  const localSummaryName = name.trim() || placeholderName
  const localSummaryDirectory = workingDirectory.trim() || t('createWindow.workingDirectoryPlaceholder')
  const localSummaryShell = selectedShellValue === AUTO_SHELL_OPTION_VALUE
    ? autoShellLabel
    : (effectiveSelectedShell || autoShellLabel)
  const localStatusLabel = pathError
    ? t('createWindow.localStatusError')
    : isValidating
      ? t('common.validating')
      : workingDirectory.trim()
        ? t('createWindow.localStatusReady')
        : t('createWindow.localStatusIdle')
  const localStatusClassName = pathError
    ? 'border-status-error/35 bg-status-error/10 text-status-error'
    : workingDirectory.trim() && !isValidating
      ? 'border-[rgb(var(--ring))] bg-[rgba(168,170,88,0.12)] text-[rgb(var(--ring))]'
      : 'border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--secondary))_74%,transparent)] text-[rgb(var(--muted-foreground))]'

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        onOpenChange(isOpen)
        if (!isOpen) {
          resetDialog()
        }
      }}
      title={isEditingSSHProfile ? t('sshProfileDialog.editTitle') : t('createWindow.unifiedTitle')}
      showCloseButton
      closeLabel={t('common.close')}
      overlayStyle={{ zIndex: 10000 }}
      contentStyle={{ zIndex: 10010 }}
      contentClassName="!w-[min(760px,94vw)] !max-w-none flex max-h-[88vh] flex-col overflow-hidden rounded-[20px] border border-[rgb(var(--border))] bg-[linear-gradient(180deg,color-mix(in_srgb,rgb(var(--card))_94%,transparent)_0%,color-mix(in_srgb,rgb(var(--background))_96%,transparent)_100%)] backdrop-blur-xl"
      headerClassName="px-6 pt-5 pb-0"
      bodyClassName="min-h-0 flex-1 px-6 pb-5 [color-scheme:dark]"
      titleClassName="text-lg font-semibold tracking-[-0.01em]"
    >
      <form onSubmit={handleSubmit} role="form" className="flex h-full min-h-0 flex-col">
        <Tabs.Root
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as CreateWindowTab)}
          className="flex min-h-0 flex-1 flex-col"
        >
          {resolvedAvailableTabs.length > 1 && (
            <Tabs.List
              className="flex max-w-full gap-1 overflow-x-auto border-b border-[rgb(var(--border))] pb-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
              aria-label={t('createWindow.modeTabsAriaLabel')}
            >
              {resolvedAvailableTabs.includes('local') && renderTabTrigger(
                'local',
                <TerminalTypeLogo variant="local" size="xs" />,
                t('createWindow.mode.local'),
              )}
              {resolvedAvailableTabs.includes('ssh') && renderTabTrigger(
                'ssh',
                <TerminalTypeLogo variant="ssh" size="xs" />,
                t('createWindow.mode.ssh'),
              )}
              {resolvedAvailableTabs.includes('canvas') && renderTabTrigger(
                'canvas',
                <TerminalTypeLogo variant="group" size="xs" />,
                t('createWindow.mode.canvas'),
              )}
            </Tabs.List>
          )}

          <div className="mt-5 min-h-0 flex-1 overflow-y-auto">
            <Tabs.Content value="local" className="data-[state=inactive]:hidden">
              <div className="mx-auto max-w-[700px]">
                <div className="space-y-5">
                    <section className={sectionShellClassName}>
                      <div className="mb-5 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <TerminalTypeLogo variant="local" size="lg" />
                          <div>
                            <h3 className="text-[15px] font-semibold text-[rgb(var(--foreground))]">
                              {t('createWindow.localSectionTitle')}
                            </h3>
                          </div>
                        </div>

                        <div className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${localStatusClassName}`}>
                          {localStatusLabel}
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div>
                          <label htmlFor="working-directory" className={fieldLabelClassName}>
                            {t('createWindow.workingDirectoryLabel')} <span className="text-status-error">*</span>
                          </label>
                          <div className="flex gap-2">
                            <input
                              id="working-directory"
                              ref={workingDirInputRef}
                              type="text"
                              value={workingDirectory}
                              onChange={(e) => setWorkingDirectory(e.target.value)}
                              placeholder={t('createWindow.workingDirectoryPlaceholder')}
                              required
                              aria-describedby={pathError ? 'path-error' : undefined}
                              className={`flex-1 ${textFieldClassName} ${
                                pathError
                                  ? 'border-status-error focus:ring-status-error/80'
                                  : ''
                              }`}
                            />
                            <Button
                              type="button"
                              variant="secondary"
                              onClick={handleSelectDirectory}
                              className={`${compactButtonClassName} shrink-0`}
                            >
                              {t('common.browse')}
                            </Button>
                          </div>
                          <div className="mt-1.5 min-h-[18px]">
                            {pathError && (
                              <p id="path-error" className="text-[13px] text-status-error" role="alert">
                                {pathError}
                              </p>
                            )}
                            {!pathError && isValidating && (
                              <p className="text-[13px] text-[rgb(var(--muted-foreground))]" aria-live="polite">
                                {t('common.validating')}
                              </p>
                            )}
                          </div>
                        </div>

                        <div>
                          <label htmlFor="command" className={fieldLabelClassName}>
                            {t('createWindow.shellLabel')}
                          </label>
                          <div className="flex gap-2">
                            <div className="min-w-0 flex-1">
                              <Select.Root
                                value={selectedShellValue}
                                onValueChange={(value) => updateLocalCommand(value === AUTO_SHELL_OPTION_VALUE ? '' : value)}
                              >
                                <Select.Trigger
                                  id="command"
                                  className={selectTriggerClassName}
                                >
                                  <span className="min-w-0 flex-1 truncate">
                                    <Select.Value placeholder={t('createWindow.shellPlaceholder')} />
                                  </span>
                                  <Select.Icon className="shrink-0">
                                    <ChevronDown size={16} className="text-[rgb(var(--muted-foreground))]" />
                                  </Select.Icon>
                                </Select.Trigger>

                                <Select.Portal>
                                  <Select.Content
                                    position="popper"
                                    side="bottom"
                                    align="start"
                                    sideOffset={6}
                                    className={selectMenuClassName}
                                  >
                                    <Select.Viewport className="p-1">
                                      <Select.Item value={AUTO_SHELL_OPTION_VALUE} className={selectItemClassName}>
                                        <Select.ItemText className="truncate">
                                          {autoShellLabel}
                                        </Select.ItemText>
                                        <Select.ItemIndicator className="shrink-0">
                                          <Check size={14} />
                                        </Select.ItemIndicator>
                                      </Select.Item>
                                      {filteredShellOptions.map((shell) => (
                                        <Select.Item
                                          key={shell.path}
                                          value={shell.path}
                                          className={selectItemClassName}
                                        >
                                          <Select.ItemText className="truncate">
                                            {shell.path}
                                          </Select.ItemText>
                                          <Select.ItemIndicator className="shrink-0">
                                            <Check size={14} />
                                          </Select.ItemIndicator>
                                        </Select.Item>
                                      ))}
                                    </Select.Viewport>
                                  </Select.Content>
                                </Select.Portal>
                              </Select.Root>
                            </div>
                            <Button
                              type="button"
                              variant="secondary"
                              onClick={handleSelectCustomShell}
                              className={`${compactButtonClassName} shrink-0`}
                            >
                              {t('settings.general.defaultShellCustomButton')}
                            </Button>
                          </div>
                        </div>

                        <div>
                          <label htmlFor="window-name" className={fieldLabelClassName}>
                            {t('createWindow.nameLabel')}
                          </label>
                          <input
                            id="window-name"
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder={placeholderName}
                            className={textFieldClassName}
                          />
                        </div>
                      </div>
                    </section>

                    {createError && (
                      <div className="rounded-[12px] border border-status-error bg-status-error/10 px-4 py-3" role="alert">
                        <p className="text-sm text-status-error">{createError}</p>
                      </div>
                    )}
                </div>
              </div>
            </Tabs.Content>

            <Tabs.Content value="canvas" className="data-[state=inactive]:hidden">
              <div className="mx-auto max-w-[700px]">
                <div className="space-y-5">
                  <section className={sectionShellClassName}>
                    <div className="mb-5 flex items-center gap-3">
                      <TerminalTypeLogo variant="group" size="lg" />
                      <div>
                        <h3 className="text-[15px] font-semibold text-[rgb(var(--foreground))]">
                          {t('createWindow.canvasSectionTitle')}
                        </h3>
                        <p className="mt-1 text-sm text-[rgb(var(--muted-foreground))]">
                          {t('createWindow.canvasSectionDescription')}
                        </p>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div>
                        <label htmlFor="canvas-name" className={fieldLabelClassName}>
                          {t('canvas.workspaceName')}
                        </label>
                        <input
                          id="canvas-name"
                          ref={canvasNameInputRef}
                          type="text"
                          value={canvasName}
                          onChange={(event) => setCanvasName(event.target.value)}
                          placeholder={t('canvas.defaultWorkspaceName', { count: canvasWorkspaceCount + 1 })}
                          className={textFieldClassName}
                        />
                      </div>

                      <div>
                        <label htmlFor="canvas-working-directory" className={fieldLabelClassName}>
                          {t('canvas.workspaceDirectory')}
                        </label>
                        <input
                          id="canvas-working-directory"
                          type="text"
                          value={canvasWorkingDirectory}
                          onChange={(event) => setCanvasWorkingDirectory(event.target.value)}
                          placeholder={t('createWindow.workingDirectoryPlaceholder')}
                          className={textFieldClassName}
                        />
                      </div>
                    </div>
                  </section>
                </div>
              </div>
            </Tabs.Content>

            {sshEnabled && (
              <Tabs.Content value="ssh" className="data-[state=inactive]:hidden">
                <Tabs.Root
                  value={activeSSHSettingsTab}
                  onValueChange={(value) => setActiveSSHSettingsTab(value as SSHSettingsTab)}
                  className="mx-auto max-w-[700px]"
                >
                  <div className="space-y-5">
                      {sshError && (
                        <div
                          id="ssh-form-error"
                          className="rounded-[12px] border border-status-error bg-status-error/10 px-4 py-3"
                          role="alert"
                        >
                          <p className="text-sm text-status-error">{sshError}</p>
                        </div>
                      )}

                      <section className={sectionShellClassName}>
                        <div className="mb-5 flex items-center gap-3">
                          <TerminalTypeLogo variant="ssh" size="lg" />
                          <div className="text-[15px] font-semibold text-[rgb(var(--foreground))]">
                            {sshSummaryName || t('createWindow.mode.ssh')}
                          </div>
                        </div>

                        <Tabs.List
                          className={sshTabListClassName}
                          aria-label={t('createWindow.sshSettingsTabsAriaLabel')}
                        >
                          {renderSSHSettingsTrigger('basic', t('createWindow.sshSections.basic'))}
                          {renderSSHSettingsTrigger('auth', t('createWindow.sshSections.auth'))}
                          {renderSSHSettingsTrigger('routing', t('createWindow.sshSections.routing'))}
                          {renderSSHSettingsTrigger('session', t('createWindow.sshSections.session'))}
                        </Tabs.List>

                        <Tabs.Content value="basic" className="space-y-4 data-[state=inactive]:hidden">
                          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_1.5fr_120px]">
                            <div>
                              <label htmlFor="ssh-profile-name" className={fieldLabelClassName}>
                                {t('sshProfileDialog.nameLabel')}
                              </label>
                              <input
                                id="ssh-profile-name"
                                ref={sshNameInputRef}
                                type="text"
                                value={sshForm.name}
                                onChange={(event) => setSSHField('name', event.target.value)}
                                placeholder={sshForm.host.trim() || 'Prod Ubuntu'}
                                className={textFieldClassName}
                              />
                            </div>

                            <div>
                              <label htmlFor="ssh-host" className={fieldLabelClassName}>
                                {t('sshProfileDialog.hostLabel')} <span className="text-status-error">*</span>
                              </label>
                              <input
                                id="ssh-host"
                                type="text"
                                value={sshForm.host}
                                onChange={(event) => setSSHField('host', event.target.value)}
                                placeholder="example.com"
                                aria-invalid={sshRequiredFieldErrors.host}
                                aria-describedby={sshRequiredFieldErrors.host ? 'ssh-form-error' : undefined}
                                className={`${textFieldClassName} ${sshRequiredFieldErrors.host ? errorFieldClassName : ''}`}
                              />
                            </div>

                            <div>
                              <label htmlFor="ssh-port" className={fieldLabelClassName}>
                                {t('sshProfileDialog.portLabel')}
                              </label>
                              <input
                                id="ssh-port"
                                type="number"
                                min={1}
                                max={65535}
                                value={sshForm.port}
                                onChange={(event) => setSSHField('port', event.target.value)}
                                className={textFieldClassName}
                              />
                            </div>
                          </div>

                          <div>
                            <label htmlFor="ssh-user" className={fieldLabelClassName}>
                              {t('sshProfileDialog.userLabel')} <span className="text-status-error">*</span>
                            </label>
                            <input
                              id="ssh-user"
                              type="text"
                              value={sshForm.user}
                              onChange={(event) => setSSHField('user', event.target.value)}
                              aria-invalid={sshRequiredFieldErrors.user}
                              aria-describedby={sshRequiredFieldErrors.user ? 'ssh-form-error' : undefined}
                              className={`${textFieldClassName} ${sshRequiredFieldErrors.user ? errorFieldClassName : ''}`}
                            />
                          </div>
                        </Tabs.Content>

                        <Tabs.Content value="auth" className="space-y-4 data-[state=inactive]:hidden">
                          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <div>
                              <label htmlFor="ssh-auth" className={fieldLabelClassName}>
                                {t('sshProfileDialog.authLabel')}
                              </label>
                              <select
                                id="ssh-auth"
                                value={sshForm.auth}
                                onChange={(event) => setSSHField('auth', event.target.value as SSHAuthType)}
                                className={textFieldClassName}
                              >
                                <option value="password">{t('createWindow.sshAuth.password')}</option>
                                <option value="publicKey">{t('createWindow.sshAuth.publicKey')}</option>
                                <option value="agent">{t('createWindow.sshAuth.agent')}</option>
                                <option value="keyboardInteractive">{t('createWindow.sshAuth.keyboardInteractive')}</option>
                              </select>
                            </div>

                            {sshAuthNeedsPassword && (
                              <div>
                                <label htmlFor="ssh-password" className={fieldLabelClassName}>
                                  {t('sshProfileDialog.passwordLabel')}
                                </label>
                                <input
                                  id="ssh-password"
                                  type="password"
                                  value={sshPassword}
                                  onChange={(event) => setSSHPassword(event.target.value)}
                                  placeholder={t('sshProfileDialog.passwordPlaceholder')}
                                  className={textFieldClassName}
                                />
                              </div>
                            )}
                          </div>

                          {sshForm.auth === 'publicKey' && (
                            <div className={sshInlineCardClassName}>
                              <div className="flex items-center justify-between">
                                <div className="text-sm font-medium text-[rgb(var(--foreground))]">
                                  {t('sshProfileDialog.privateKeysLabel')}
                                </div>
                                <Button
                                  type="button"
                                  variant="secondary"
                                  onClick={handleDetectPrivateKeys}
                                  className={`${compactButtonClassName} shrink-0`}
                                >
                                  {isDetectingKeys ? t('common.loading') : t('sshProfileDialog.detectKeys')}
                                </Button>
                              </div>

                              <textarea
                                value={sshForm.privateKeysText}
                                onChange={(event) => setSSHField('privateKeysText', event.target.value)}
                                rows={3}
                                placeholder={t('sshProfileDialog.privateKeysPlaceholder')}
                                className={`${textFieldClassName} mt-3 min-h-[90px] resize-y`}
                              />

                              <div className="mt-1.5 min-h-[18px]">
                                {detectKeysMessage && (
                                  <p className="text-xs text-[rgb(var(--muted-foreground))]">{detectKeysMessage}</p>
                                )}
                              </div>

                              {currentPrivateKeys.length > 0 && (
                                <div className="mt-3 border-t border-[rgb(var(--border))] pt-3">
                                  <button
                                    type="button"
                                    onClick={() => setShowSSHPassphrases((previous) => !previous)}
                                    className="flex items-center gap-1.5 text-[13px] font-medium text-[rgb(var(--muted-foreground))] transition-colors hover:text-[rgb(var(--foreground))]"
                                  >
                                    {showSSHPassphrases ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                    <span>{showSSHPassphrases ? t('createWindow.sshPassphrasesHide') : t('createWindow.sshPassphrasesShow')}</span>
                                  </button>

                                  {showSSHPassphrases && (
                                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                                      {currentPrivateKeys.map((keyPath) => (
                                        <div key={keyPath}>
                                          <label className="mb-1 block truncate text-xs text-[rgb(var(--muted-foreground))]" title={keyPath}>
                                            {keyPath}
                                          </label>
                                          <input
                                            type="password"
                                            value={sshPassphrases[keyPath] ?? ''}
                                            onChange={(event) => setSSHPassphrases((previous) => ({
                                              ...previous,
                                              [keyPath]: event.target.value,
                                            }))}
                                            placeholder={t('sshProfileDialog.passphraseInputPlaceholder')}
                                            className={textFieldClassName}
                                          />
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )}

                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            {renderBooleanField('ssh-agent-forward', sshForm.agentForward, t('sshProfileDialog.agentForward'), (checked) => setSSHField('agentForward', checked))}
                            {renderBooleanField('ssh-verify-host-keys', sshForm.verifyHostKeys, t('sshProfileDialog.verifyHostKeys'), (checked) => setSSHField('verifyHostKeys', checked))}
                          </div>
                        </Tabs.Content>

                        <Tabs.Content value="routing" className="space-y-4 data-[state=inactive]:hidden">
                          <div className={sshActiveRouteClassName}>
                            {t('sshProfileDialog.activeRoutingMode', { mode: sshSummaryRoute })}
                          </div>
                          <Tabs.Root
                            value={sshForm.routingMode}
                            onValueChange={(value) => setSSHField('routingMode', value as SSHRoutingMode)}
                          >
                            <Tabs.List className={sshRouteTabListClassName}>
                              {sshRoutingModes.map((mode) => (
                                <Tabs.Trigger
                                  key={mode}
                                  value={mode}
                                  className={sshRouteTabTriggerClassName}
                                  aria-label={t('sshProfileDialog.routingOptionAriaLabel', {
                                    mode: t(`sshProfileDialog.routing.${mode}` as any),
                                    status: mode === sshForm.routingMode
                                      ? t('sshProfileDialog.routingEnabled')
                                      : t('sshProfileDialog.routingAvailable'),
                                  })}
                                >
                                  <span className="flex items-center justify-center gap-1.5">
                                    {mode === sshForm.routingMode && <Check size={13} strokeWidth={2.4} />}
                                    <span>{t(`sshProfileDialog.routing.${mode}` as any)}</span>
                                  </span>
                                </Tabs.Trigger>
                              ))}
                            </Tabs.List>

                            <div className="mt-4">
                              <Tabs.Content value="direct" className="data-[state=inactive]:hidden">
                                <div className={sshRouteSummaryCardClassName}>
                                  <div className="text-sm font-semibold text-[rgb(var(--foreground))]">
                                    {sshSummaryHost}:{sshForm.port.trim() || '22'}
                                  </div>
                                  <p className="mt-1 text-[13px] leading-5 text-[rgb(var(--muted-foreground))]">
                                    {t('createWindow.sshRouteDirectHint')}
                                  </p>
                                </div>
                              </Tabs.Content>

                              <Tabs.Content value="jumpHost" className="data-[state=inactive]:hidden">
                                <label htmlFor="ssh-jump-host" className={fieldLabelClassName}>
                                  {t('sshProfileDialog.jumpHostLabel')}
                                </label>
                                <select
                                  id="ssh-jump-host"
                                  value={sshForm.jumpHostProfileId}
                                  onChange={(event) => setSSHField('jumpHostProfileId', event.target.value)}
                                  className={textFieldClassName}
                                >
                                  <option value="">{t('sshProfileDialog.jumpHostPlaceholder')}</option>
                                  {availableJumpHosts.map((profile) => (
                                    <option key={profile.id} value={profile.id}>
                                      {profile.name}
                                    </option>
                                  ))}
                                </select>
                              </Tabs.Content>

                              <Tabs.Content value="proxyCommand" className="data-[state=inactive]:hidden">
                                <label htmlFor="ssh-proxy-command" className={fieldLabelClassName}>
                                  {t('sshProfileDialog.proxyCommandLabel')}
                                </label>
                                <input
                                  id="ssh-proxy-command"
                                  type="text"
                                  value={sshForm.proxyCommand}
                                  onChange={(event) => setSSHField('proxyCommand', event.target.value)}
                                  placeholder="ssh -W %h:%p bastion"
                                  className={textFieldClassName}
                                />
                              </Tabs.Content>

                              <Tabs.Content value="socks" className="grid gap-4 sm:grid-cols-2 data-[state=inactive]:hidden">
                                <div>
                                  <label htmlFor="ssh-socks-host" className={fieldLabelClassName}>
                                    {t('sshProfileDialog.proxyHostLabel')}
                                  </label>
                                  <input
                                    id="ssh-socks-host"
                                    type="text"
                                    value={sshForm.socksProxyHost}
                                    onChange={(event) => setSSHField('socksProxyHost', event.target.value)}
                                    placeholder="127.0.0.1"
                                    className={textFieldClassName}
                                  />
                                </div>
                                <div>
                                  <label htmlFor="ssh-socks-port" className={fieldLabelClassName}>
                                    {t('sshProfileDialog.proxyPortLabel')}
                                  </label>
                                  <input
                                    id="ssh-socks-port"
                                    type="number"
                                    min={1}
                                    max={65535}
                                    value={sshForm.socksProxyPort}
                                    onChange={(event) => setSSHField('socksProxyPort', event.target.value)}
                                    className={textFieldClassName}
                                  />
                                </div>
                              </Tabs.Content>

                              <Tabs.Content value="http" className="grid gap-4 sm:grid-cols-2 data-[state=inactive]:hidden">
                                <div>
                                  <label htmlFor="ssh-http-host" className={fieldLabelClassName}>
                                    {t('sshProfileDialog.proxyHostLabel')}
                                  </label>
                                  <input
                                    id="ssh-http-host"
                                    type="text"
                                    value={sshForm.httpProxyHost}
                                    onChange={(event) => setSSHField('httpProxyHost', event.target.value)}
                                    placeholder="proxy.example.com"
                                    className={textFieldClassName}
                                  />
                                </div>
                                <div>
                                  <label htmlFor="ssh-http-port" className={fieldLabelClassName}>
                                    {t('sshProfileDialog.proxyPortLabel')}
                                  </label>
                                  <input
                                    id="ssh-http-port"
                                    type="number"
                                    min={1}
                                    max={65535}
                                    value={sshForm.httpProxyPort}
                                    onChange={(event) => setSSHField('httpProxyPort', event.target.value)}
                                    className={textFieldClassName}
                                  />
                                </div>
                              </Tabs.Content>
                            </div>
                          </Tabs.Root>
                        </Tabs.Content>

                        <Tabs.Content value="session" className="space-y-4 data-[state=inactive]:hidden">
                          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <div>
                              <label htmlFor="ssh-remote-cwd" className={fieldLabelClassName}>
                                {t('sshProfileDialog.remoteCwdLabel')}
                              </label>
                              <input
                                id="ssh-remote-cwd"
                                type="text"
                                value={sshForm.defaultRemoteCwd}
                                onChange={(event) => setSSHField('defaultRemoteCwd', event.target.value)}
                                placeholder="/srv/app"
                                className={textFieldClassName}
                              />
                            </div>

                            <div>
                              <label htmlFor="ssh-remote-command" className={fieldLabelClassName}>
                                {t('sshProfileDialog.remoteCommandLabel')}
                              </label>
                              <input
                                id="ssh-remote-command"
                                type="text"
                                value={sshForm.remoteCommand}
                                onChange={(event) => setSSHField('remoteCommand', event.target.value)}
                                placeholder="tmux new -A -s work"
                                className={textFieldClassName}
                              />
                            </div>

                            <div>
                              <label htmlFor="ssh-keepalive-interval" className={fieldLabelClassName}>
                                {t('sshProfileDialog.keepaliveIntervalLabel')}
                              </label>
                              <input
                                id="ssh-keepalive-interval"
                                type="number"
                                min={0}
                                value={sshForm.keepaliveInterval}
                                onChange={(event) => setSSHField('keepaliveInterval', event.target.value)}
                                className={textFieldClassName}
                              />
                            </div>

                            <div>
                              <label htmlFor="ssh-keepalive-count" className={fieldLabelClassName}>
                                {t('sshProfileDialog.keepaliveCountLabel')}
                              </label>
                              <input
                                id="ssh-keepalive-count"
                                type="number"
                                min={0}
                                value={sshForm.keepaliveCountMax}
                                onChange={(event) => setSSHField('keepaliveCountMax', event.target.value)}
                                className={textFieldClassName}
                              />
                            </div>

                            <div className="sm:col-span-2">
                              <label htmlFor="ssh-ready-timeout" className={fieldLabelClassName}>
                                {t('sshProfileDialog.readyTimeoutLabel')}
                              </label>
                              <input
                                id="ssh-ready-timeout"
                                type="number"
                                min={1}
                                value={sshForm.readyTimeout}
                                onChange={(event) => setSSHField('readyTimeout', event.target.value)}
                                placeholder={String(DEFAULT_SSH_READY_TIMEOUT_MS)}
                                className={textFieldClassName}
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            {renderBooleanField('ssh-reuse-session', sshForm.reuseSession, t('sshProfileDialog.reuseSession'), (checked) => setSSHField('reuseSession', checked))}
                            {renderBooleanField('ssh-warn-close', sshForm.warnOnClose, t('sshProfileDialog.warnOnClose'), (checked) => setSSHField('warnOnClose', checked))}
                            {renderBooleanField('ssh-skip-banner', sshForm.skipBanner, t('sshProfileDialog.skipBanner'), (checked) => setSSHField('skipBanner', checked))}
                            {renderBooleanField('ssh-x11', sshForm.x11, t('createWindow.sshX11Label'), (checked) => setSSHField('x11', checked))}
                          </div>
                        </Tabs.Content>
                      </section>
                  </div>
                </Tabs.Root>
              </Tabs.Content>
            )}
          </div>
        </Tabs.Root>

        <div className="mt-5 flex flex-col-reverse gap-2.5 border-t border-[rgb(var(--border))] pt-4 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              onOpenChange(false)
              resetDialog()
            }}
            className={`${compactSecondaryButtonToneClassName} ${dialogActionButtonClassName}`}
          >
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={
              activeTab === 'local'
                ? (!workingDirectory || !!pathError || isValidating || isCreating)
                : activeTab === 'canvas'
                  ? false
                  : isSavingSSH
            }
            aria-busy={activeTab === 'local' ? isCreating : activeTab === 'canvas' ? false : isSavingSSH}
            className={`${compactPrimaryButtonToneClassName} ${dialogActionButtonClassName}`}
          >
            {activeTab === 'local'
              ? (isCreating ? t('common.creating') : t('common.create'))
              : activeTab === 'canvas'
                ? t('common.create')
              : (
                isSavingSSH
                  ? (isEditingSSHProfile ? t('common.saving') : t('createWindow.sshSaving'))
                  : (
                    isEditingSSHProfile
                      ? t('common.save')
                      : (
                        sshSubmitMode === 'saveAndConnect'
                          ? t('createWindow.sshSaveAndConnect')
                          : t('createWindow.sshSave')
                      )
                  )
              )}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
