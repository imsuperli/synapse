import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog } from './ui/Dialog';
import { Button } from './ui/Button';
import { useI18n } from '../i18n';
import {
  SSHAlgorithmCatalog,
  SSHAlgorithmPreferences,
  SSHAlgorithmType,
  ForwardedPortConfig,
  SSHAuthType,
  SSHCredentialState,
  SSHPortForwardType,
  SSHProfile,
  SSHProfileInput,
  SSHRoutingMode,
} from '../../shared/types/ssh';
import { DEFAULT_SSH_READY_TIMEOUT_MS } from '../../shared/utils/sshDefaults';

interface SSHProfileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profile?: SSHProfile | null;
  profiles?: SSHProfile[];
  credentialState?: SSHCredentialState | null;
  onSaved: (profile: SSHProfile, credentialState: SSHCredentialState) => void;
}

interface SSHProfileFormState {
  name: string;
  host: string;
  port: string;
  user: string;
  auth: SSHAuthType;
  privateKeysText: string;
  defaultRemoteCwd: string;
  remoteCommand: string;
  keepaliveInterval: string;
  keepaliveCountMax: string;
  readyTimeout: string;
  verifyHostKeys: boolean;
  agentForward: boolean;
  skipBanner: boolean;
  warnOnClose: boolean;
  reuseSession: boolean;
  routingMode: SSHRoutingMode;
  jumpHostProfileId: string;
  proxyCommand: string;
  socksProxyHost: string;
  socksProxyPort: string;
  httpProxyHost: string;
  httpProxyPort: string;
  algorithms: SSHAlgorithmPreferences;
  forwardedPorts: ForwardedPortConfig[];
  tagsText: string;
  notes: string;
}

interface SSHPortForwardDraft {
  type: SSHPortForwardType;
  host: string;
  port: string;
  targetAddress: string;
  targetPort: string;
  description: string;
}

const DEFAULT_CREDENTIAL_STATE: SSHCredentialState = {
  hasPassword: false,
  hasPassphrase: false,
};

const SSH_ROUTING_MODES: SSHRoutingMode[] = ['direct', 'jumpHost', 'proxyCommand', 'socks', 'http'];

const SSH_ALGORITHM_GROUPS: Array<{
  type: SSHAlgorithmType;
  labelKey:
    | 'sshProfileDialog.algorithms.kex'
    | 'sshProfileDialog.algorithms.hostKey'
    | 'sshProfileDialog.algorithms.cipher'
    | 'sshProfileDialog.algorithms.hmac'
    | 'sshProfileDialog.algorithms.compression';
}> = [
  { type: 'kex', labelKey: 'sshProfileDialog.algorithms.kex' },
  { type: 'hostKey', labelKey: 'sshProfileDialog.algorithms.hostKey' },
  { type: 'cipher', labelKey: 'sshProfileDialog.algorithms.cipher' },
  { type: 'hmac', labelKey: 'sshProfileDialog.algorithms.hmac' },
  { type: 'compression', labelKey: 'sshProfileDialog.algorithms.compression' },
];

function uniqueList(values: string[]): string[] {
  return Array.from(new Set(values));
}

function parseLineList(value: string): string[] {
  return uniqueList(
    value
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function parseTagList(value: string): string[] {
  return uniqueList(
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function trimOptional(value: string): string | undefined {
  const normalized = value.trim();
  return normalized || undefined;
}

function parseOptionalProxyPort(value: string): number | undefined {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : undefined;
}

function createEmptyAlgorithmPreferences(): SSHAlgorithmPreferences {
  return {
    kex: [],
    hostKey: [],
    cipher: [],
    hmac: [],
    compression: [],
  };
}

function resolveAlgorithmPreferences(
  value?: Partial<SSHAlgorithmPreferences> | null,
  defaults?: SSHAlgorithmPreferences | null,
): SSHAlgorithmPreferences {
  const empty = createEmptyAlgorithmPreferences();
  const fallback = defaults ?? empty;

  return {
    kex: Array.isArray(value?.kex) && value.kex.length > 0 ? [...value.kex] : [...fallback.kex],
    hostKey: Array.isArray(value?.hostKey) && value.hostKey.length > 0 ? [...value.hostKey] : [...fallback.hostKey],
    cipher: Array.isArray(value?.cipher) && value.cipher.length > 0 ? [...value.cipher] : [...fallback.cipher],
    hmac: Array.isArray(value?.hmac) && value.hmac.length > 0 ? [...value.hmac] : [...fallback.hmac],
    compression: Array.isArray(value?.compression) && value.compression.length > 0 ? [...value.compression] : [...fallback.compression],
  };
}

function resolveRoutingMode(profile?: SSHProfile | null): SSHRoutingMode {
  return profile?.routingMode ?? 'direct';
}

function createEmptyPortForwardDraft(): SSHPortForwardDraft {
  return {
    type: 'local',
    host: '127.0.0.1',
    port: '8000',
    targetAddress: '127.0.0.1',
    targetPort: '80',
    description: '',
  };
}

function createInitialForm(profile?: SSHProfile | null): SSHProfileFormState {
  return {
    name: profile?.name ?? '',
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
    routingMode: resolveRoutingMode(profile),
    jumpHostProfileId: profile?.jumpHostProfileId ?? '',
    proxyCommand: profile?.proxyCommand ?? '',
    socksProxyHost: profile?.socksProxyHost ?? '',
    socksProxyPort: profile?.socksProxyPort ? String(profile.socksProxyPort) : '1080',
    httpProxyHost: profile?.httpProxyHost ?? '',
    httpProxyPort: profile?.httpProxyPort ? String(profile.httpProxyPort) : '8080',
    algorithms: resolveAlgorithmPreferences(profile?.algorithms),
    forwardedPorts: profile?.forwardedPorts ?? [],
    tagsText: profile?.tags.join(', ') ?? '',
    notes: profile?.notes ?? '',
  };
}

function readCredentialState(value?: SSHCredentialState | null): SSHCredentialState {
  return value ?? DEFAULT_CREDENTIAL_STATE;
}

export function SSHProfileDialog({
  open,
  onOpenChange,
  profile,
  profiles = [],
  credentialState,
  onSaved,
}: SSHProfileDialogProps) {
  const { t } = useI18n();
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<SSHProfileFormState>(() => createInitialForm(profile));
  const [password, setPassword] = useState('');
  const [clearStoredPassword, setClearStoredPassword] = useState(false);
  const [clearStoredPassphrases, setClearStoredPassphrases] = useState(false);
  const [passphrases, setPassphrases] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [detectKeysMessage, setDetectKeysMessage] = useState('');
  const [isDetectingKeys, setIsDetectingKeys] = useState(false);
  const [newForward, setNewForward] = useState<SSHPortForwardDraft>(() => createEmptyPortForwardDraft());
  const [algorithmCatalog, setAlgorithmCatalog] = useState<SSHAlgorithmCatalog | null>(null);
  const [algorithmCatalogError, setAlgorithmCatalogError] = useState('');

  const currentCredentialState = readCredentialState(credentialState);
  const currentPrivateKeys = useMemo(
    () => parseLineList(form.privateKeysText),
    [form.privateKeysText],
  );
  const activeRoutingModeLabel = t(`sshProfileDialog.routing.${form.routingMode}` as any);
  const availableJumpHosts = useMemo(
    () => profiles.filter((item) => item.id !== profile?.id),
    [profile?.id, profiles],
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    setForm(createInitialForm(profile));
    setPassword('');
    setClearStoredPassword(false);
    setClearStoredPassphrases(false);
    setPassphrases({});
    setSaveError('');
    setDetectKeysMessage('');
    setNewForward(createEmptyPortForwardDraft());
    setAlgorithmCatalogError('');

    setTimeout(() => {
      nameInputRef.current?.focus();
    }, 0);
  }, [open, profile]);

  useEffect(() => {
    if (!open) {
      return;
    }

    let disposed = false;

    const loadAlgorithmCatalog = async () => {
      try {
        const response = await window.electronAPI.getSSHAlgorithmCatalog();
        if (!response.success || !response.data) {
          throw new Error(response.error || t('sshProfileDialog.algorithmsLoadError'));
        }

        const catalog = response.data;

        if (disposed) {
          return;
        }

        setAlgorithmCatalog(catalog);
        setForm((previous) => ({
          ...previous,
          algorithms: resolveAlgorithmPreferences(profile?.algorithms ?? previous.algorithms, catalog.defaults),
        }));
      } catch (error) {
        if (!disposed) {
          setAlgorithmCatalogError((error as Error).message || t('sshProfileDialog.algorithmsLoadError'));
        }
      }
    };

    void loadAlgorithmCatalog();

    return () => {
      disposed = true;
    };
  }, [open, profile?.algorithms, t]);

  useEffect(() => {
    setPassphrases((previous) => {
      const next: Record<string, string> = {};
      currentPrivateKeys.forEach((keyPath) => {
        next[keyPath] = previous[keyPath] ?? '';
      });
      return next;
    });
  }, [currentPrivateKeys]);

  const setField = <K extends keyof SSHProfileFormState>(field: K, value: SSHProfileFormState[K]) => {
    setForm((previous) => ({
      ...previous,
      [field]: value,
    }));
  };

  const authNeedsPassword = form.auth === 'password' || form.auth === 'keyboardInteractive';

  const handleAddPortForward = () => {
    setSaveError('');

    const host = newForward.host.trim() || '127.0.0.1';
    const port = Number(newForward.port);
    const targetAddress = newForward.targetAddress.trim();
    const targetPort = Number(newForward.targetPort);

    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      setSaveError(t('sshProfileDialog.error.forwardBindPort'));
      return;
    }

    if (newForward.type !== 'dynamic') {
      if (!targetAddress) {
        setSaveError(t('sshProfileDialog.error.forwardTargetRequired'));
        return;
      }

      if (!Number.isInteger(targetPort) || targetPort <= 0 || targetPort > 65535) {
        setSaveError(t('sshProfileDialog.error.forwardTargetPort'));
        return;
      }
    }

    const nextForward: ForwardedPortConfig = {
      id: window.crypto?.randomUUID?.() ?? `forward-${Date.now()}`,
      type: newForward.type,
      host,
      port,
      targetAddress: newForward.type === 'dynamic' ? 'socks' : targetAddress,
      targetPort: newForward.type === 'dynamic' ? 0 : targetPort,
      ...(newForward.description.trim() ? { description: newForward.description.trim() } : {}),
    };

    setField('forwardedPorts', [...form.forwardedPorts, nextForward]);
    setNewForward(createEmptyPortForwardDraft());
  };

  const handleRemovePortForward = (forwardId: string) => {
    setField('forwardedPorts', form.forwardedPorts.filter((item) => item.id !== forwardId));
  };

  const handleToggleAlgorithm = (type: SSHAlgorithmType, value: string, checked: boolean) => {
    const currentValues = form.algorithms[type];
    const nextValues = checked
      ? [...currentValues, value]
      : currentValues.filter((item) => item !== value);

    setField('algorithms', {
      ...form.algorithms,
      [type]: uniqueList(nextValues),
    });
  };

  const handleResetAlgorithms = () => {
    if (!algorithmCatalog) {
      return;
    }

    setField('algorithms', resolveAlgorithmPreferences(undefined, algorithmCatalog.defaults));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaveError('');

    const name = form.name.trim();
    const host = form.host.trim();
    const user = form.user.trim();
    const privateKeys = parseLineList(form.privateKeysText);
    const tags = parseTagList(form.tagsText);
    const passwordValue = password.trim();

    const port = Number(form.port);
    const keepaliveInterval = Number(form.keepaliveInterval);
    const keepaliveCountMax = Number(form.keepaliveCountMax);
    const readyTimeout = form.readyTimeout.trim() ? Number(form.readyTimeout) : null;
    const socksProxyPort = parseOptionalProxyPort(form.socksProxyPort);
    const httpProxyPort = parseOptionalProxyPort(form.httpProxyPort);

    if (!name || !host || !user) {
      setSaveError(t('sshProfileDialog.error.required'));
      return;
    }

    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      setSaveError(t('sshProfileDialog.error.port'));
      return;
    }

    if (!Number.isInteger(keepaliveInterval) || keepaliveInterval < 0) {
      setSaveError(t('sshProfileDialog.error.keepaliveInterval'));
      return;
    }

    if (!Number.isInteger(keepaliveCountMax) || keepaliveCountMax < 0) {
      setSaveError(t('sshProfileDialog.error.keepaliveCount'));
      return;
    }

    if (readyTimeout !== null && (!Number.isInteger(readyTimeout) || readyTimeout <= 0)) {
      setSaveError(t('sshProfileDialog.error.readyTimeout'));
      return;
    }

    if (form.auth === 'publicKey' && privateKeys.length === 0) {
      setSaveError(t('sshProfileDialog.error.privateKeysRequired'));
      return;
    }

    const jumpHostProfileId = trimOptional(form.jumpHostProfileId);
    const proxyCommand = trimOptional(form.proxyCommand);
    const socksProxyHost = trimOptional(form.socksProxyHost);
    const httpProxyHost = trimOptional(form.httpProxyHost);

    if (form.routingMode === 'jumpHost' && !jumpHostProfileId) {
      setSaveError(t('sshProfileDialog.error.jumpHostRequired'));
      return;
    }

    if (form.routingMode === 'proxyCommand' && !proxyCommand) {
      setSaveError(t('sshProfileDialog.error.proxyCommandRequired'));
      return;
    }

    if (form.routingMode === 'socks') {
      if (!socksProxyHost) {
        setSaveError(t('sshProfileDialog.error.proxyHostRequired'));
        return;
      }

      if (socksProxyPort === undefined) {
        setSaveError(t('sshProfileDialog.error.proxyPort'));
        return;
      }
    }

    if (form.routingMode === 'http') {
      if (!httpProxyHost) {
        setSaveError(t('sshProfileDialog.error.proxyHostRequired'));
        return;
      }

      if (httpProxyPort === undefined) {
        setSaveError(t('sshProfileDialog.error.proxyPort'));
        return;
      }
    }

    const input: SSHProfileInput = {
      name,
      host,
      port,
      user,
      auth: form.auth,
      privateKeys,
      keepaliveInterval,
      keepaliveCountMax,
      readyTimeout,
      verifyHostKeys: form.verifyHostKeys,
      x11: profile?.x11 ?? false,
      skipBanner: form.skipBanner,
      routingMode: form.routingMode,
      jumpHostProfileId,
      agentForward: form.agentForward,
      warnOnClose: form.warnOnClose,
      proxyCommand,
      socksProxyHost,
      socksProxyPort: socksProxyHost ? socksProxyPort : undefined,
      httpProxyHost,
      httpProxyPort: httpProxyHost ? httpProxyPort : undefined,
      reuseSession: form.reuseSession,
      algorithms: form.algorithms,
      forwardedPorts: form.forwardedPorts,
      remoteCommand: trimOptional(form.remoteCommand),
      defaultRemoteCwd: trimOptional(form.defaultRemoteCwd),
      tags,
      notes: trimOptional(form.notes),
      icon: profile?.icon,
      color: profile?.color,
    };

    setIsSaving(true);
    try {
      const response = profile
        ? await window.electronAPI.updateSSHProfile(profile.id, input)
        : await window.electronAPI.createSSHProfile(input);

      if (!response?.success || !response.data) {
        throw new Error(response?.error || t('sshProfileDialog.error.saveFailed'));
      }

      const savedProfile = response.data;
      const existingPrivateKeys = profile?.privateKeys ?? [];

      if (authNeedsPassword) {
        if (passwordValue) {
          await window.electronAPI.setSSHPassword(savedProfile.id, passwordValue);
        } else if (clearStoredPassword && currentCredentialState.hasPassword) {
          await window.electronAPI.clearSSHPassword(savedProfile.id);
        }
      } else if (currentCredentialState.hasPassword) {
        await window.electronAPI.clearSSHPassword(savedProfile.id);
      }

      const keysToClear = new Set<string>();
      if (clearStoredPassphrases || form.auth !== 'publicKey') {
        [...existingPrivateKeys, ...currentPrivateKeys].forEach((keyPath) => keysToClear.add(keyPath));
      } else {
        existingPrivateKeys
          .filter((keyPath) => !currentPrivateKeys.includes(keyPath))
          .forEach((keyPath) => keysToClear.add(keyPath));
      }

      await Promise.all(
        Array.from(keysToClear).map((keyPath) => (
          window.electronAPI.clearSSHPrivateKeyPassphrase(savedProfile.id, keyPath)
        )),
      );

      if (form.auth === 'publicKey') {
        await Promise.all(
          currentPrivateKeys
            .filter((keyPath) => passphrases[keyPath]?.trim())
            .map((keyPath) => (
              window.electronAPI.setSSHPrivateKeyPassphrase(savedProfile.id, keyPath, passphrases[keyPath].trim())
            )),
        );
      }

      const credentialStateResponse = await window.electronAPI.getSSHCredentialState(savedProfile.id);
      const nextCredentialState = credentialStateResponse?.success && credentialStateResponse.data
        ? credentialStateResponse.data
        : DEFAULT_CREDENTIAL_STATE;

      onSaved(savedProfile, nextCredentialState);
      onOpenChange(false);
    } catch (error) {
      setSaveError((error as Error).message || t('sshProfileDialog.error.saveFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDetectPrivateKeys = async () => {
    setDetectKeysMessage('');
    setIsDetectingKeys(true);

    try {
      const response = await window.electronAPI.detectLocalSSHPrivateKeys();
      if (!response?.success || !response.data) {
        throw new Error(response?.error || t('sshProfileDialog.detectKeysError'));
      }

      if (response.data.length === 0) {
        setDetectKeysMessage(t('sshProfileDialog.detectKeysEmpty'));
        return;
      }

      const mergedKeys = uniqueList([
        ...parseLineList(form.privateKeysText),
        ...response.data,
      ]);
      setField('privateKeysText', mergedKeys.join('\n'));
      setDetectKeysMessage(t('sshProfileDialog.detectKeysSuccess', { count: response.data.length }));
    } catch (error) {
      setDetectKeysMessage((error as Error).message || t('sshProfileDialog.detectKeysError'));
    } finally {
      setIsDetectingKeys(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={profile ? t('sshProfileDialog.editTitle') : t('sshProfileDialog.createTitle')}
      description={t('sshProfileDialog.description')}
      contentClassName="max-w-[760px]"
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label htmlFor="ssh-profile-name" className="block text-sm font-medium text-text-primary mb-2">
              {t('sshProfileDialog.nameLabel')}
            </label>
            <input
              id="ssh-profile-name"
              ref={nameInputRef}
              type="text"
              value={form.name}
              onChange={(event) => setField('name', event.target.value)}
              className="w-full px-3 py-2 bg-bg-app border border-border-subtle rounded text-text-primary placeholder-text-disabled focus:outline-none focus:ring-2 focus:ring-status-running"
            />
          </div>

          <div>
            <label htmlFor="ssh-profile-host" className="block text-sm font-medium text-text-primary mb-2">
              {t('sshProfileDialog.hostLabel')}
            </label>
            <input
              id="ssh-profile-host"
              type="text"
              value={form.host}
              onChange={(event) => setField('host', event.target.value)}
              className="w-full px-3 py-2 bg-bg-app border border-border-subtle rounded text-text-primary placeholder-text-disabled focus:outline-none focus:ring-2 focus:ring-status-running"
            />
          </div>

          <div>
            <label htmlFor="ssh-profile-port" className="block text-sm font-medium text-text-primary mb-2">
              {t('sshProfileDialog.portLabel')}
            </label>
            <input
              id="ssh-profile-port"
              type="number"
              min="1"
              max="65535"
              value={form.port}
              onChange={(event) => setField('port', event.target.value)}
              className="w-full px-3 py-2 bg-bg-app border border-border-subtle rounded text-text-primary placeholder-text-disabled focus:outline-none focus:ring-2 focus:ring-status-running"
            />
          </div>

          <div>
            <label htmlFor="ssh-profile-user" className="block text-sm font-medium text-text-primary mb-2">
              {t('sshProfileDialog.userLabel')}
            </label>
            <input
              id="ssh-profile-user"
              type="text"
              value={form.user}
              onChange={(event) => setField('user', event.target.value)}
              className="w-full px-3 py-2 bg-bg-app border border-border-subtle rounded text-text-primary placeholder-text-disabled focus:outline-none focus:ring-2 focus:ring-status-running"
            />
          </div>

          <div>
            <label htmlFor="ssh-profile-auth" className="block text-sm font-medium text-text-primary mb-2">
              {t('sshProfileDialog.authLabel')}
            </label>
            <select
              id="ssh-profile-auth"
              value={form.auth}
              onChange={(event) => setField('auth', event.target.value as SSHAuthType)}
              className="w-full px-3 py-2 bg-bg-app border border-border-subtle rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-status-running"
            >
              <option value="password">{t('ssh.auth.password')}</option>
              <option value="publicKey">{t('ssh.auth.publicKey')}</option>
              <option value="agent">{t('ssh.auth.agent')}</option>
              <option value="keyboardInteractive">{t('ssh.auth.keyboardInteractive')}</option>
            </select>
          </div>

          <div>
            <label htmlFor="ssh-profile-remote-cwd" className="block text-sm font-medium text-text-primary mb-2">
              {t('sshProfileDialog.remoteCwdLabel')}
            </label>
            <input
              id="ssh-profile-remote-cwd"
              type="text"
              value={form.defaultRemoteCwd}
              onChange={(event) => setField('defaultRemoteCwd', event.target.value)}
              placeholder="~"
              className="w-full px-3 py-2 bg-bg-app border border-border-subtle rounded text-text-primary placeholder-text-disabled focus:outline-none focus:ring-2 focus:ring-status-running"
            />
          </div>

          <div>
            <label htmlFor="ssh-profile-remote-command" className="block text-sm font-medium text-text-primary mb-2">
              {t('sshProfileDialog.remoteCommandLabel')}
            </label>
            <input
              id="ssh-profile-remote-command"
              type="text"
              value={form.remoteCommand}
              onChange={(event) => setField('remoteCommand', event.target.value)}
              className="w-full px-3 py-2 bg-bg-app border border-border-subtle rounded text-text-primary placeholder-text-disabled focus:outline-none focus:ring-2 focus:ring-status-running"
            />
          </div>
        </div>

        <div className="space-y-4 border border-border-subtle rounded-lg px-4 py-4 bg-bg-elevated/40">
          <div>
            <h3 className="text-sm font-semibold text-text-primary">
              {t('sshProfileDialog.routingTitle')}
            </h3>
            <p className="mt-1 text-xs text-text-secondary">
              {t('sshProfileDialog.routingDescription')}
            </p>
          </div>

          <div
            className="rounded-lg border border-[rgb(var(--primary))] bg-[color-mix(in_srgb,rgb(var(--primary))_14%,transparent)] px-4 py-3 text-sm text-text-primary"
            role="status"
          >
            {t('sshProfileDialog.activeRoutingMode', { mode: activeRoutingModeLabel })}
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {SSH_ROUTING_MODES.map((mode) => {
              const selected = mode === form.routingMode;
              const label = t(`sshProfileDialog.routing.${mode}` as any);

              return (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={selected}
                  aria-label={t('sshProfileDialog.routingOptionAriaLabel', {
                    mode: label,
                    status: selected
                      ? t('sshProfileDialog.routingEnabled')
                      : t('sshProfileDialog.routingAvailable'),
                  })}
                  onClick={() => setField('routingMode', mode)}
                  className={[
                    'inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors',
                    selected
                      ? 'border-[rgb(var(--primary))] bg-[rgb(var(--primary))] text-[rgb(var(--primary-foreground))]'
                      : 'border-border-subtle bg-bg-app text-text-secondary hover:border-[rgb(var(--primary))] hover:text-text-primary',
                  ].join(' ')}
                >
                  {selected && <span aria-hidden="true">✓</span>}
                  <span>{label}</span>
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {form.routingMode === 'jumpHost' && (
              <div>
                <label htmlFor="ssh-profile-jump-host" className="block text-sm font-medium text-text-primary mb-2">
                  {t('sshProfileDialog.jumpHostLabel')}
                </label>
                <select
                  id="ssh-profile-jump-host"
                  value={form.jumpHostProfileId}
                  onChange={(event) => setField('jumpHostProfileId', event.target.value)}
                  className="w-full px-3 py-2 bg-bg-app border border-border-subtle rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-status-running"
                >
                  <option value="">{t('sshProfileDialog.jumpHostPlaceholder')}</option>
                  {availableJumpHosts.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} ({item.user}@{item.host}:{item.port})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {form.routingMode === 'proxyCommand' && (
              <div className="sm:col-span-2">
                <label htmlFor="ssh-profile-proxy-command" className="block text-sm font-medium text-text-primary mb-2">
                  {t('sshProfileDialog.proxyCommandLabel')}
                </label>
                <input
                  id="ssh-profile-proxy-command"
                  type="text"
                  value={form.proxyCommand}
                  onChange={(event) => setField('proxyCommand', event.target.value)}
                  placeholder="ssh -W %h:%p bastion"
                  className="w-full px-3 py-2 bg-bg-app border border-border-subtle rounded text-text-primary placeholder-text-disabled focus:outline-none focus:ring-2 focus:ring-status-running"
                />
              </div>
            )}

            {form.routingMode === 'socks' && (
              <>
                <div>
                  <label htmlFor="ssh-profile-socks-host" className="block text-sm font-medium text-text-primary mb-2">
                    {t('sshProfileDialog.proxyHostLabel')}
                  </label>
                  <input
                    id="ssh-profile-socks-host"
                    type="text"
                    value={form.socksProxyHost}
                    onChange={(event) => setField('socksProxyHost', event.target.value)}
                    className="w-full px-3 py-2 bg-bg-app border border-border-subtle rounded text-text-primary placeholder-text-disabled focus:outline-none focus:ring-2 focus:ring-status-running"
                  />
                </div>
                <div>
                  <label htmlFor="ssh-profile-socks-port" className="block text-sm font-medium text-text-primary mb-2">
                    {t('sshProfileDialog.proxyPortLabel')}
                  </label>
                  <input
                    id="ssh-profile-socks-port"
                    type="number"
                    min="1"
                    max="65535"
                    value={form.socksProxyPort}
                    onChange={(event) => setField('socksProxyPort', event.target.value)}
                    className="w-full px-3 py-2 bg-bg-app border border-border-subtle rounded text-text-primary placeholder-text-disabled focus:outline-none focus:ring-2 focus:ring-status-running"
                  />
                </div>
              </>
            )}

            {form.routingMode === 'http' && (
              <>
                <div>
                  <label htmlFor="ssh-profile-http-host" className="block text-sm font-medium text-text-primary mb-2">
                    {t('sshProfileDialog.proxyHostLabel')}
                  </label>
                  <input
                    id="ssh-profile-http-host"
                    type="text"
                    value={form.httpProxyHost}
                    onChange={(event) => setField('httpProxyHost', event.target.value)}
                    className="w-full px-3 py-2 bg-bg-app border border-border-subtle rounded text-text-primary placeholder-text-disabled focus:outline-none focus:ring-2 focus:ring-status-running"
                  />
                </div>
                <div>
                  <label htmlFor="ssh-profile-http-port" className="block text-sm font-medium text-text-primary mb-2">
                    {t('sshProfileDialog.proxyPortLabel')}
                  </label>
                  <input
                    id="ssh-profile-http-port"
                    type="number"
                    min="1"
                    max="65535"
                    value={form.httpProxyPort}
                    onChange={(event) => setField('httpProxyPort', event.target.value)}
                    className="w-full px-3 py-2 bg-bg-app border border-border-subtle rounded text-text-primary placeholder-text-disabled focus:outline-none focus:ring-2 focus:ring-status-running"
                  />
                </div>
              </>
            )}
          </div>
        </div>

        <div className="space-y-4 border border-border-subtle rounded-lg px-4 py-4 bg-bg-elevated/40">
          <div>
            <h3 className="text-sm font-semibold text-text-primary">
              {t('sshProfileDialog.portForwardingTitle')}
            </h3>
            <p className="mt-1 text-xs text-text-secondary">
              {t('sshProfileDialog.portForwardingDescription')}
            </p>
          </div>

          {form.forwardedPorts.length > 0 && (
            <div className="space-y-2">
              {form.forwardedPorts.map((forward) => (
                <div
                  key={forward.id}
                  className="flex items-center justify-between gap-3 rounded border border-border-subtle bg-bg-app px-3 py-2 text-sm text-text-primary"
                >
                  <div className="min-w-0">
                    <div>
                      {forward.type === 'dynamic'
                        ? `${t('sshProfileDialog.forwardType.dynamic')}: ${forward.host}:${forward.port} -> SOCKS`
                        : `${t(`sshProfileDialog.forwardType.${forward.type}`)}: ${forward.host}:${forward.port} -> ${forward.targetAddress}:${forward.targetPort}`}
                    </div>
                    {forward.description && (
                      <div className="text-xs text-text-secondary">
                        {forward.description}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemovePortForward(forward.id)}
                    className="text-xs text-status-error hover:opacity-80"
                  >
                    {t('sshProfileDialog.removePortForward')}
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="ssh-profile-forward-type" className="block text-sm font-medium text-text-primary mb-2">
                {t('sshProfileDialog.portForwardTypeLabel')}
              </label>
              <select
                id="ssh-profile-forward-type"
                value={newForward.type}
                onChange={(event) => setNewForward((previous) => ({
                  ...previous,
                  type: event.target.value as SSHPortForwardType,
                }))}
                className="w-full px-3 py-2 bg-bg-app border border-border-subtle rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-status-running"
              >
                <option value="local">{t('sshProfileDialog.forwardType.local')}</option>
                <option value="remote">{t('sshProfileDialog.forwardType.remote')}</option>
                <option value="dynamic">{t('sshProfileDialog.forwardType.dynamic')}</option>
              </select>
            </div>

            <div>
              <label htmlFor="ssh-profile-forward-host" className="block text-sm font-medium text-text-primary mb-2">
                {t('sshProfileDialog.portForwardHostLabel')}
              </label>
              <input
                id="ssh-profile-forward-host"
                type="text"
                value={newForward.host}
                onChange={(event) => setNewForward((previous) => ({
                  ...previous,
                  host: event.target.value,
                }))}
                className="w-full px-3 py-2 bg-bg-app border border-border-subtle rounded text-text-primary placeholder-text-disabled focus:outline-none focus:ring-2 focus:ring-status-running"
              />
            </div>

            <div>
              <label htmlFor="ssh-profile-forward-port" className="block text-sm font-medium text-text-primary mb-2">
                {t('sshProfileDialog.portForwardPortLabel')}
              </label>
              <input
                id="ssh-profile-forward-port"
                type="number"
                min="1"
                max="65535"
                value={newForward.port}
                onChange={(event) => setNewForward((previous) => ({
                  ...previous,
                  port: event.target.value,
                }))}
                className="w-full px-3 py-2 bg-bg-app border border-border-subtle rounded text-text-primary placeholder-text-disabled focus:outline-none focus:ring-2 focus:ring-status-running"
              />
            </div>

            {newForward.type !== 'dynamic' && (
              <>
                <div>
                  <label htmlFor="ssh-profile-forward-target-host" className="block text-sm font-medium text-text-primary mb-2">
                    {t('sshProfileDialog.portForwardTargetHostLabel')}
                  </label>
                  <input
                    id="ssh-profile-forward-target-host"
                    type="text"
                    value={newForward.targetAddress}
                    onChange={(event) => setNewForward((previous) => ({
                      ...previous,
                      targetAddress: event.target.value,
                    }))}
                    className="w-full px-3 py-2 bg-bg-app border border-border-subtle rounded text-text-primary placeholder-text-disabled focus:outline-none focus:ring-2 focus:ring-status-running"
                  />
                </div>

                <div>
                  <label htmlFor="ssh-profile-forward-target-port" className="block text-sm font-medium text-text-primary mb-2">
                    {t('sshProfileDialog.portForwardTargetPortLabel')}
                  </label>
                  <input
                    id="ssh-profile-forward-target-port"
                    type="number"
                    min="1"
                    max="65535"
                    value={newForward.targetPort}
                    onChange={(event) => setNewForward((previous) => ({
                      ...previous,
                      targetPort: event.target.value,
                    }))}
                    className="w-full px-3 py-2 bg-bg-app border border-border-subtle rounded text-text-primary placeholder-text-disabled focus:outline-none focus:ring-2 focus:ring-status-running"
                  />
                </div>
              </>
            )}

            <div className="sm:col-span-2">
              <label htmlFor="ssh-profile-forward-description" className="block text-sm font-medium text-text-primary mb-2">
                {t('sshProfileDialog.portForwardDescriptionLabel')}
              </label>
              <input
                id="ssh-profile-forward-description"
                type="text"
                value={newForward.description}
                onChange={(event) => setNewForward((previous) => ({
                  ...previous,
                  description: event.target.value,
                }))}
                className="w-full px-3 py-2 bg-bg-app border border-border-subtle rounded text-text-primary placeholder-text-disabled focus:outline-none focus:ring-2 focus:ring-status-running"
              />
            </div>
          </div>

          <div className="flex justify-end">
            <Button
              type="button"
              variant="secondary"
              onClick={handleAddPortForward}
            >
              {t('sshProfileDialog.addPortForward')}
            </Button>
          </div>
        </div>

        {form.auth === 'publicKey' && (
          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <label htmlFor="ssh-profile-keys" className="block text-sm font-medium text-text-primary">
                {t('sshProfileDialog.privateKeysLabel')}
              </label>
              <button
                type="button"
                onClick={handleDetectPrivateKeys}
                disabled={isDetectingKeys}
                className="text-xs text-status-running hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isDetectingKeys ? t('common.loading') : t('sshProfileDialog.detectKeys')}
              </button>
            </div>
            <textarea
              id="ssh-profile-keys"
              value={form.privateKeysText}
              onChange={(event) => setField('privateKeysText', event.target.value)}
              placeholder={t('sshProfileDialog.privateKeysPlaceholder')}
              rows={4}
              className="w-full px-3 py-2 bg-bg-app border border-border-subtle rounded text-text-primary placeholder-text-disabled focus:outline-none focus:ring-2 focus:ring-status-running"
            />
            {detectKeysMessage && (
              <p className="mt-2 text-xs text-text-secondary">
                {detectKeysMessage}
              </p>
            )}

            {currentPrivateKeys.length > 0 && (
              <div className="mt-3 space-y-3">
                {currentCredentialState.hasPassphrase && (
                  <div className="flex items-center justify-between gap-3 text-xs text-text-secondary bg-bg-app border border-border-subtle rounded px-3 py-2">
                    <span>{t('sshProfileDialog.passphraseHint')}</span>
                    <button
                      type="button"
                      onClick={() => setClearStoredPassphrases((value) => !value)}
                      className={`text-xs ${clearStoredPassphrases ? 'text-status-error' : 'text-status-running'}`}
                    >
                      {t('sshProfileDialog.clearSavedPassphrases')}
                    </button>
                  </div>
                )}

                {currentPrivateKeys.map((keyPath) => (
                  <div key={keyPath}>
                    <label className="block text-xs font-medium text-text-secondary mb-1">
                      {keyPath}
                    </label>
                    <input
                      type="password"
                      value={passphrases[keyPath] ?? ''}
                      onChange={(event) => setPassphrases((previous) => ({
                        ...previous,
                        [keyPath]: event.target.value,
                      }))}
                      placeholder={t('sshProfileDialog.passphraseInputPlaceholder')}
                      className="w-full px-3 py-2 bg-bg-app border border-border-subtle rounded text-text-primary placeholder-text-disabled focus:outline-none focus:ring-2 focus:ring-status-running"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {authNeedsPassword && (
          <div>
            <label htmlFor="ssh-profile-password" className="block text-sm font-medium text-text-primary mb-2">
              {t('sshProfileDialog.passwordLabel')}
            </label>
            <input
              id="ssh-profile-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={t('sshProfileDialog.passwordPlaceholder')}
              className="w-full px-3 py-2 bg-bg-app border border-border-subtle rounded text-text-primary placeholder-text-disabled focus:outline-none focus:ring-2 focus:ring-status-running"
            />

            {currentCredentialState.hasPassword && (
              <div className="mt-2 flex items-center justify-between gap-3 text-xs text-text-secondary bg-bg-app border border-border-subtle rounded px-3 py-2">
                <span>{t('sshProfileDialog.savedPasswordHint')}</span>
                <button
                  type="button"
                  onClick={() => setClearStoredPassword((value) => !value)}
                  className={`text-xs ${clearStoredPassword ? 'text-status-error' : 'text-status-running'}`}
                >
                  {t('sshProfileDialog.clearSavedPassword')}
                </button>
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label htmlFor="ssh-profile-keepalive-interval" className="block text-sm font-medium text-text-primary mb-2">
              {t('sshProfileDialog.keepaliveIntervalLabel')}
            </label>
            <input
              id="ssh-profile-keepalive-interval"
              type="number"
              min="0"
              value={form.keepaliveInterval}
              onChange={(event) => setField('keepaliveInterval', event.target.value)}
              className="w-full px-3 py-2 bg-bg-app border border-border-subtle rounded text-text-primary placeholder-text-disabled focus:outline-none focus:ring-2 focus:ring-status-running"
            />
          </div>

          <div>
            <label htmlFor="ssh-profile-keepalive-count" className="block text-sm font-medium text-text-primary mb-2">
              {t('sshProfileDialog.keepaliveCountLabel')}
            </label>
            <input
              id="ssh-profile-keepalive-count"
              type="number"
              min="0"
              value={form.keepaliveCountMax}
              onChange={(event) => setField('keepaliveCountMax', event.target.value)}
              className="w-full px-3 py-2 bg-bg-app border border-border-subtle rounded text-text-primary placeholder-text-disabled focus:outline-none focus:ring-2 focus:ring-status-running"
            />
          </div>

          <div>
            <label htmlFor="ssh-profile-ready-timeout" className="block text-sm font-medium text-text-primary mb-2">
              {t('sshProfileDialog.readyTimeoutLabel')}
            </label>
            <input
              id="ssh-profile-ready-timeout"
              type="number"
              min="1"
              value={form.readyTimeout}
              onChange={(event) => setField('readyTimeout', event.target.value)}
              placeholder={String(DEFAULT_SSH_READY_TIMEOUT_MS)}
              className="w-full px-3 py-2 bg-bg-app border border-border-subtle rounded text-text-primary placeholder-text-disabled focus:outline-none focus:ring-2 focus:ring-status-running"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="flex items-center gap-2 text-sm text-text-primary">
            <input
              type="checkbox"
              checked={form.verifyHostKeys}
              onChange={(event) => setField('verifyHostKeys', event.target.checked)}
            />
            <span>{t('sshProfileDialog.verifyHostKeys')}</span>
          </label>

          <label className="flex items-center gap-2 text-sm text-text-primary">
            <input
              type="checkbox"
              checked={form.reuseSession}
              onChange={(event) => setField('reuseSession', event.target.checked)}
            />
            <span>{t('sshProfileDialog.reuseSession')}</span>
          </label>

          <label className="flex items-center gap-2 text-sm text-text-primary">
            <input
              type="checkbox"
              checked={form.warnOnClose}
              onChange={(event) => setField('warnOnClose', event.target.checked)}
            />
            <span>{t('sshProfileDialog.warnOnClose')}</span>
          </label>

          <label className="flex items-center gap-2 text-sm text-text-primary">
            <input
              type="checkbox"
              checked={form.agentForward}
              onChange={(event) => setField('agentForward', event.target.checked)}
            />
            <span>{t('sshProfileDialog.agentForward')}</span>
          </label>

          <label className="flex items-center gap-2 text-sm text-text-primary">
            <input
              type="checkbox"
              checked={form.skipBanner}
              onChange={(event) => setField('skipBanner', event.target.checked)}
            />
            <span>{t('sshProfileDialog.skipBanner')}</span>
          </label>
        </div>

        <div className="space-y-4 rounded-lg border border-border-subtle px-4 py-4 bg-bg-elevated/40">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold text-text-primary">
                {t('sshProfileDialog.algorithmsTitle')}
              </h3>
              <p className="mt-1 text-xs text-text-secondary">
                {t('sshProfileDialog.algorithmsDescription')}
              </p>
            </div>

            <button
              type="button"
              onClick={handleResetAlgorithms}
              disabled={!algorithmCatalog}
              className="text-xs text-status-running hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {t('sshProfileDialog.algorithmsReset')}
            </button>
          </div>

          {!algorithmCatalog && !algorithmCatalogError && (
            <div className="text-sm text-text-secondary">
              {t('common.loading')}
            </div>
          )}

          {algorithmCatalogError && (
            <div className="rounded-lg border border-status-error/40 bg-status-error/10 px-3 py-2 text-sm text-status-error">
              {algorithmCatalogError}
            </div>
          )}

          {algorithmCatalog && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {SSH_ALGORITHM_GROUPS.map((group) => (
                <div key={group.type} className="rounded-lg border border-border-subtle bg-bg-app/60 px-3 py-3">
                  <h4 className="text-sm font-medium text-text-primary">
                    {t(group.labelKey)}
                  </h4>
                  <div className="mt-3 max-h-40 space-y-2 overflow-y-auto pr-1">
                    {algorithmCatalog.supported[group.type].map((algorithm) => (
                      <label key={algorithm} className="flex items-start gap-2 text-xs text-text-secondary">
                        <input
                          type="checkbox"
                          checked={form.algorithms[group.type].includes(algorithm)}
                          onChange={(event) => handleToggleAlgorithm(group.type, algorithm, event.target.checked)}
                        />
                        <span className="break-all">{algorithm}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="ssh-profile-tags" className="block text-sm font-medium text-text-primary mb-2">
              {t('sshProfileDialog.tagsLabel')}
            </label>
            <input
              id="ssh-profile-tags"
              type="text"
              value={form.tagsText}
              onChange={(event) => setField('tagsText', event.target.value)}
              placeholder="prod, db, cn-shanghai"
              className="w-full px-3 py-2 bg-bg-app border border-border-subtle rounded text-text-primary placeholder-text-disabled focus:outline-none focus:ring-2 focus:ring-status-running"
            />
          </div>

          <div>
            <label htmlFor="ssh-profile-notes" className="block text-sm font-medium text-text-primary mb-2">
              {t('sshProfileDialog.notesLabel')}
            </label>
            <textarea
              id="ssh-profile-notes"
              value={form.notes}
              onChange={(event) => setField('notes', event.target.value)}
              rows={3}
              className="w-full px-3 py-2 bg-bg-app border border-border-subtle rounded text-text-primary placeholder-text-disabled focus:outline-none focus:ring-2 focus:ring-status-running"
            />
          </div>
        </div>

        {saveError && (
          <p className="text-sm text-status-error" role="alert">
            {saveError}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={isSaving}>
            {isSaving ? t('common.saving') : (profile ? t('common.save') : t('common.create'))}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
