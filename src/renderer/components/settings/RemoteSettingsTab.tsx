import React, { useEffect, useMemo, useState } from 'react';
import * as Switch from '@radix-ui/react-switch';
import { Cloud, Copy, QrCode, RefreshCw, Trash2, Wifi } from 'lucide-react';
import type {
  RemoteDevice,
  RemoteNetworkInterface,
  RemotePairingQR,
  RemoteSettings,
  RemoteStatus,
} from '../../../shared/types/electron-api';
import { CompactSettingRow, CompactSettingsSection } from './CompactSettings';
import { idePopupActionButtonClassName, idePopupSecondaryButtonClassName } from '../ui/ide-popup';
import { useI18n } from '../../i18n';

function joinClassNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

const switchRootClassName = 'relative h-6 w-10 flex-shrink-0 rounded-full bg-[rgb(var(--muted))] transition-colors data-[state=checked]:bg-[rgb(var(--primary))] disabled:cursor-not-allowed disabled:opacity-70';
const switchThumbClassName = 'block h-5 w-5 translate-x-0.5 rounded-full bg-[color-mix(in_srgb,rgb(var(--background))_92%,transparent)] shadow-sm transition-transform data-[state=checked]:translate-x-[18px]';
const secondaryButtonClassName = `${idePopupSecondaryButtonClassName} h-9 rounded-lg px-3 text-sm`;
const primaryButtonClassName = `${idePopupActionButtonClassName('primary')} h-9 min-w-0 rounded-lg px-3 text-sm`;
const inputClassName = 'h-9 w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--input))] px-3 text-sm text-[rgb(var(--foreground))] outline-none transition-colors placeholder:text-[rgb(var(--muted-foreground))] focus:border-[rgb(var(--ring))]';
const CUSTOM_ADDRESS_VALUE = '__custom_endpoint__';

const defaultRemoteSettings: RemoteSettings = {
  enabled: false,
  bindHost: '0.0.0.0',
  preferredPort: 6868,
  selectedAddress: null,
  manualEndpoint: null,
  acceptedPlainWsNonLocal: false,
  startOnLaunch: false,
  relayEnabled: false,
  relayEndpoint: null,
};

const defaultRemoteStatus: RemoteStatus = {
  ready: false,
  endpoint: null,
  settings: defaultRemoteSettings,
};

export function RemoteSettingsTab() {
  const { language, t } = useI18n();
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState<RemoteStatus>(defaultRemoteStatus);
  const [interfaces, setInterfaces] = useState<RemoteNetworkInterface[]>([]);
  const [selectedAddress, setSelectedAddress] = useState<string>('');
  const [customEndpoint, setCustomEndpoint] = useState('');
  const [useCustomEndpoint, setUseCustomEndpoint] = useState(false);
  const [relayEnabled, setRelayEnabled] = useState(false);
  const [relayEndpoint, setRelayEndpoint] = useState('');
  const [acceptPlainWsNonLocal, setAcceptPlainWsNonLocal] = useState(false);
  const [pairing, setPairing] = useState<RemotePairingQR | null>(null);
  const [devices, setDevices] = useState<RemoteDevice[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void refreshRemoteState();
  }, []);

  const effectiveAddress = useMemo(() => (
    useCustomEndpoint ? customEndpoint.trim() : selectedAddress
  ) || undefined, [
    customEndpoint,
    selectedAddress,
    useCustomEndpoint,
  ]);
  const addressSelectValue = useCustomEndpoint ? CUSTOM_ADDRESS_VALUE : selectedAddress;
  const requiresPlainWsAcknowledgement = useCustomEndpoint && customEndpoint.trim()
    ? endpointRequiresPlainWsAcknowledgement(customEndpoint)
    : false;
  const relayRequiresPlainWsAcknowledgement = relayEnabled && relayEndpoint.trim()
    ? endpointRequiresPlainWsAcknowledgement(relayEndpoint)
    : false;
  const canGeneratePairing = enabled
    && (relayEnabled ? Boolean(relayEndpoint.trim()) : Boolean(effectiveAddress))
    && (!requiresPlainWsAcknowledgement || acceptPlainWsNonLocal)
    && (!relayRequiresPlainWsAcknowledgement || acceptPlainWsNonLocal);
  const selectedAddressMissing = !useCustomEndpoint
    && Boolean(selectedAddress)
    && !interfaces.some((iface) => iface.address === selectedAddress);

  async function refreshRemoteState() {
    setError(null);
    try {
      const [statusResponse, interfacesResponse, devicesResponse] = await Promise.all([
        window.electronAPI.remoteGetStatus(),
        window.electronAPI.remoteListNetworkInterfaces(),
        window.electronAPI.remoteListDevices(),
      ]);

      if (statusResponse.success && statusResponse.data) {
        setStatus(statusResponse.data);
        setEnabled(statusResponse.data.settings.enabled);
        setCustomEndpoint(statusResponse.data.settings.manualEndpoint ?? '');
        setUseCustomEndpoint(Boolean(statusResponse.data.settings.manualEndpoint));
        setSelectedAddress(statusResponse.data.settings.selectedAddress ?? '');
        setRelayEnabled(statusResponse.data.settings.relayEnabled);
        setRelayEndpoint(statusResponse.data.settings.relayEndpoint ?? '');
        setAcceptPlainWsNonLocal(statusResponse.data.settings.acceptedPlainWsNonLocal);
      }
      if (interfacesResponse.success && interfacesResponse.data) {
        setInterfaces(interfacesResponse.data.interfaces);
        setSelectedAddress((current) => current || interfacesResponse.data!.interfaces[0]?.address || '');
      }
      if (devicesResponse.success && devicesResponse.data) {
        setDevices(devicesResponse.data.devices);
      }

      const firstError = statusResponse.error || interfacesResponse.error || devicesResponse.error;
      if (firstError) {
        setError(firstError);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function refreshNetworkInterfaces() {
    setError(null);
    try {
      const response = await window.electronAPI.remoteListNetworkInterfaces();
      if (!response.success || !response.data) {
        throw new Error(response.error || t('settings.remote.error.networkRefreshFailed'));
      }
      setInterfaces(response.data.interfaces);
      setSelectedAddress((current) => current || response.data!.interfaces[0]?.address || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function toggleRemote(nextEnabled: boolean) {
    setLoading(true);
    setError(null);
    try {
      const response = await window.electronAPI.remoteUpdateSettings({
        enabled: nextEnabled,
        selectedAddress: useCustomEndpoint ? null : selectedAddress || null,
        manualEndpoint: useCustomEndpoint ? customEndpoint.trim() || null : null,
        relayEnabled,
        relayEndpoint: relayEndpoint.trim() || null,
        acceptPlainWsNonLocal,
      });
      if (!response.success || !response.data) {
        throw new Error(response.error || t('settings.remote.error.updateFailed'));
      }
      setEnabled(response.data.settings.enabled);
      setStatus({
        ready: response.data.endpoint !== null,
        endpoint: response.data.endpoint,
        settings: response.data.settings,
      });
      if (!response.data.settings.enabled) {
        setPairing(null);
      }
      await refreshRemoteState();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function generatePairing(rotate = false) {
    if (!enabled) {
      return;
    }
    setLoading(true);
    setError(null);
    setCopied(false);
    try {
      if (!relayEnabled && !effectiveAddress) {
        throw new Error(t('settings.remote.error.missingAddress'));
      }
      if (relayEnabled && !relayEndpoint.trim()) {
        throw new Error(t('settings.remote.error.missingRelayEndpoint'));
      }
      const settingsResponse = await window.electronAPI.remoteUpdateSettings({
        selectedAddress: useCustomEndpoint ? null : selectedAddress || null,
        manualEndpoint: useCustomEndpoint ? customEndpoint.trim() || null : null,
        relayEnabled,
        relayEndpoint: relayEndpoint.trim() || null,
        acceptPlainWsNonLocal,
      });
      if (!settingsResponse.success || !settingsResponse.data) {
        throw new Error(settingsResponse.error || t('settings.remote.error.updateFailed'));
      }
      setStatus({
        ready: settingsResponse.data.endpoint !== null,
        endpoint: settingsResponse.data.endpoint,
        settings: settingsResponse.data.settings,
      });
      const response = rotate
        ? await window.electronAPI.remoteRotatePairingQR({ address: effectiveAddress })
        : await window.electronAPI.remoteGetPairingQR({ address: effectiveAddress });
      if (!response.success || !response.data) {
        throw new Error(response.error || t('settings.remote.error.pairingFailed'));
      }
      setPairing(response.data);
      if (!response.data.available) {
        setError(t('settings.remote.error.notReady'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function revokeDevice(deviceId: string) {
    setLoading(true);
    setError(null);
    try {
      const response = await window.electronAPI.remoteRevokeDevice(deviceId);
      if (!response.success || !response.data?.revoked) {
        throw new Error(response.error || t('settings.remote.error.revokeFailed'));
      }
      await refreshRemoteState();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function confirmRevokeDevice(device: RemoteDevice) {
    if (!window.confirm(t('settings.remote.revokeDeviceConfirm', { name: device.name }))) {
      return;
    }
    await revokeDevice(device.deviceId);
  }

  async function copyPairingCode() {
    if (!pairing?.pairingUrl) {
      return;
    }
    await navigator.clipboard?.writeText(pairing.pairingUrl);
    setCopied(true);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <CompactSettingsSection
        title={t('settings.remote.title')}
        help={t('settings.remote.description')}
        icon={<Wifi size={15} />}
      >
        <CompactSettingRow
          label={t('settings.remote.enableLabel')}
          help={t('settings.remote.enableDescription')}
          controlClassName="justify-between"
        >
          <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
            <span
              className={joinClassNames(
                'rounded-full px-2 py-0.5 text-xs font-medium',
                enabled
                  ? 'bg-[rgb(var(--success))]/14 text-[rgb(var(--success))]'
                  : 'bg-[rgb(var(--secondary))] text-[rgb(var(--muted-foreground))]',
              )}
            >
              {enabled ? t('settings.remote.status.enabled') : t('settings.remote.status.disabled')}
            </span>
            <span className="min-w-0 max-w-full truncate text-xs text-[rgb(var(--muted-foreground))]">
              {status.endpoint
                ? t('settings.remote.serviceRunning', { endpoint: status.endpoint })
                : t('settings.remote.serviceStopped')}
            </span>
          </div>
          <Switch.Root
            checked={enabled}
            onCheckedChange={(checked) => void toggleRemote(checked)}
            disabled={loading}
            className={switchRootClassName}
            aria-label={t('settings.remote.enableLabel')}
          >
            <Switch.Thumb className={switchThumbClassName} />
          </Switch.Root>
        </CompactSettingRow>

        <CompactSettingRow
          label={t('settings.remote.addressLabel')}
          help={t('settings.remote.addressDescription')}
          disabled={!enabled}
        >
          <div className="flex w-full max-w-[520px] flex-col items-stretch gap-2">
            <div className="flex min-w-0 gap-2">
              <select
                aria-label={t('settings.remote.addressLabel')}
                className={`${inputClassName} min-w-0 flex-1`}
                value={addressSelectValue}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  setPairing(null);
                  setCopied(false);
                  if (nextValue === CUSTOM_ADDRESS_VALUE) {
                    setUseCustomEndpoint(true);
                    setSelectedAddress('');
                    return;
                  }
                  setUseCustomEndpoint(false);
                  setSelectedAddress(nextValue);
                  setCustomEndpoint('');
                  setAcceptPlainWsNonLocal(false);
                }}
                disabled={!enabled || loading}
              >
                {interfaces.length === 0 && (
                  <option value="">{t('settings.remote.addressNoInterfaces')}</option>
                )}
                {interfaces.map((iface) => (
                  <option key={`${iface.name}:${iface.address}`} value={iface.address}>
                    {iface.address} ({iface.name})
                  </option>
                ))}
                {selectedAddressMissing && (
                  <option value={selectedAddress}>{selectedAddress}</option>
                )}
                <option value={CUSTOM_ADDRESS_VALUE}>{t('settings.remote.addressCustom')}</option>
              </select>
              <button
                type="button"
                className={`${secondaryButtonClassName} shrink-0`}
                onClick={() => void refreshNetworkInterfaces()}
                disabled={!enabled || loading}
              >
                <RefreshCw size={14} />
                {t('settings.remote.refreshNetworks')}
              </button>
            </div>

            {useCustomEndpoint && (
              <input
                className={inputClassName}
                value={customEndpoint}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  setPairing(null);
                  setCopied(false);
                  setCustomEndpoint(nextValue);
                  if (!endpointRequiresPlainWsAcknowledgement(nextValue)) {
                    setAcceptPlainWsNonLocal(false);
                  }
                }}
                placeholder={t('settings.remote.customEndpointPlaceholder')}
                disabled={!enabled || loading}
              />
            )}

            {requiresPlainWsAcknowledgement && (
              <label className="flex items-start gap-2 rounded-lg border border-[rgb(var(--warning))]/40 bg-[rgb(var(--warning))]/10 px-3 py-2 text-xs leading-5 text-[rgb(var(--muted-foreground))]">
                <input
                  type="checkbox"
                  checked={acceptPlainWsNonLocal}
                  onChange={(event) => setAcceptPlainWsNonLocal(event.target.checked)}
                  className="mt-1"
                  disabled={!enabled || loading}
                />
                <span>{t('settings.remote.plainWsAcknowledgement')}</span>
              </label>
            )}
          </div>
        </CompactSettingRow>

        <CompactSettingRow
          label={t('settings.remote.relayLabel')}
          help={t('settings.remote.relayDescription')}
          disabled={!enabled}
          controlClassName="justify-between"
        >
          <div className="flex w-full max-w-[520px] flex-col items-stretch gap-2">
            <div className="flex min-w-0 items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <Cloud size={15} className="shrink-0 text-[rgb(var(--muted-foreground))]" />
                <span className="truncate text-sm text-[rgb(var(--foreground))]">
                  {relayEnabled
                    ? t('settings.remote.relayStatus.enabled')
                    : t('settings.remote.relayStatus.disabled')}
                </span>
              </div>
              <Switch.Root
                checked={relayEnabled}
                onCheckedChange={(checked) => {
                  setRelayEnabled(checked);
                  setPairing(null);
                  setCopied(false);
                }}
                disabled={!enabled || loading}
                className={switchRootClassName}
                aria-label={t('settings.remote.relayLabel')}
              >
                <Switch.Thumb className={switchThumbClassName} />
              </Switch.Root>
            </div>

            {relayEnabled && (
              <input
                className={inputClassName}
                value={relayEndpoint}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  setPairing(null);
                  setCopied(false);
                  setRelayEndpoint(nextValue);
                  if (!endpointRequiresPlainWsAcknowledgement(nextValue)) {
                    setAcceptPlainWsNonLocal(false);
                  }
                }}
                placeholder={t('settings.remote.relayEndpointPlaceholder')}
                disabled={!enabled || loading}
              />
            )}

            {relayRequiresPlainWsAcknowledgement && (
              <label className="flex items-start gap-2 rounded-lg border border-[rgb(var(--warning))]/40 bg-[rgb(var(--warning))]/10 px-3 py-2 text-xs leading-5 text-[rgb(var(--muted-foreground))]">
                <input
                  type="checkbox"
                  checked={acceptPlainWsNonLocal}
                  onChange={(event) => setAcceptPlainWsNonLocal(event.target.checked)}
                  className="mt-1"
                  disabled={!enabled || loading}
                />
                <span>{t('settings.remote.plainWsAcknowledgement')}</span>
              </label>
            )}
          </div>
        </CompactSettingRow>
      </CompactSettingsSection>

      <CompactSettingsSection
        title={t('settings.remote.pairingTitle')}
        help={t('settings.remote.pairingDescription')}
        icon={<QrCode size={15} />}
        actions={
          <button
            type="button"
            className={primaryButtonClassName}
            onClick={() => void generatePairing(Boolean(pairing?.available))}
            disabled={!canGeneratePairing || loading}
          >
            <QrCode size={14} />
            {pairing?.available
              ? t('settings.remote.regenerateQr')
              : t('settings.remote.generateQr')}
          </button>
        }
      >
        <div className="space-y-3 px-4 py-3">
          {pairing?.available ? (
            <div className="grid gap-4 rounded-[14px] border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--secondary))_42%,transparent)] p-4 md:grid-cols-[minmax(0,256px)_minmax(0,1fr)]">
              {pairing.qrDataUrl && (
                <div className="mx-auto flex w-full max-w-60 items-center justify-center rounded-xl bg-white p-2 shadow-sm md:mx-0">
                  <img
                    src={pairing.qrDataUrl}
                    alt={t('settings.remote.qrAlt')}
                    className="block aspect-square w-full max-w-full"
                    style={{ imageRendering: 'crisp-edges' }}
                  />
                </div>
              )}
              <div className="min-w-0 space-y-3">
                <div>
                  <div className="text-xs font-medium uppercase tracking-wide text-[rgb(var(--muted-foreground))]">
                    {t('settings.remote.mobileConnectsTo')}
                  </div>
                  <div className="break-all text-sm text-[rgb(var(--foreground))]">
                    {pairing.relayEndpoint ?? pairing.endpoint}
                  </div>
                  {pairing.relayEndpoint && pairing.endpoint && !isLoopbackEndpoint(pairing.endpoint) && (
                    <div className="mt-1 break-all text-xs text-[rgb(var(--muted-foreground))]">
                      {t('settings.remote.directFallback', { endpoint: pairing.endpoint })}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  className={secondaryButtonClassName}
                  onClick={() => void copyPairingCode()}
                  disabled={!pairing.pairingUrl}
                >
                  <Copy size={14} />
                  {copied ? t('settings.remote.copied') : t('settings.remote.copyPairingCode')}
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-[rgb(var(--border))] px-4 py-5 text-sm text-[rgb(var(--muted-foreground))]">
              {enabled
                ? t('settings.remote.pairingEmpty')
                : t('settings.remote.pairingDisabled')}
            </div>
          )}
        </div>
      </CompactSettingsSection>

      <CompactSettingsSection title={t('settings.remote.devicesTitle')} icon={<Wifi size={15} />}>
        {devices.length === 0 ? (
          <div className="px-4 py-6 text-sm text-[rgb(var(--muted-foreground))]">
            {t('settings.remote.devicesEmpty')}
          </div>
        ) : (
          devices.map((device) => (
            <CompactSettingRow key={device.deviceId} label={device.name}>
              <div className="flex min-w-0 items-center justify-end gap-3">
                <div className="min-w-0 text-right text-xs text-[rgb(var(--muted-foreground))]">
                  {t('settings.remote.deviceLastSeen', {
                    time: formatDeviceTime(device.lastSeenAt, language, t('settings.remote.deviceNeverSeen')),
                  })}
                </div>
                <button
                  type="button"
                  className={secondaryButtonClassName}
                  onClick={() => void confirmRevokeDevice(device)}
                  disabled={loading}
                >
                  <Trash2 size={14} />
                  {t('settings.remote.revokeDevice')}
                </button>
              </div>
            </CompactSettingRow>
          ))
        )}
      </CompactSettingsSection>

      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}
    </div>
  );
}

function formatDeviceTime(timestamp: number, language: string, neverText: string): string {
  if (!timestamp) {
    return neverText;
  }
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return neverText;
  }
  return date.toLocaleString(language);
}

function endpointRequiresPlainWsAcknowledgement(endpoint: string): boolean {
  const trimmed = endpoint.trim();
  if (!trimmed || trimmed.toLowerCase().startsWith('wss://')) {
    return false;
  }
  const host = extractEndpointHost(trimmed);
  return host !== null && !isLocalOrPrivateHost(host);
}

function extractEndpointHost(endpoint: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(endpoint)) {
    try {
      return new URL(endpoint).hostname;
    } catch {
      return null;
    }
  }
  if (endpoint.startsWith('[')) {
    const end = endpoint.indexOf(']');
    return end > 0 ? endpoint.slice(1, end) : endpoint;
  }
  const [host] = endpoint.split(':', 1);
  return host || null;
}

function isLoopbackEndpoint(endpoint: string): boolean {
  const host = extractEndpointHost(endpoint);
  if (!host) {
    return false;
  }
  const normalized = host.replace(/^\[|\]$/g, '').toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

function isLocalOrPrivateHost(host: string): boolean {
  const normalized = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    normalized === 'localhost'
    || normalized.endsWith('.localhost')
    || normalized.endsWith('.local')
    || normalized.endsWith('.ts.net')
  ) {
    return true;
  }
  if (normalized === '::1') {
    return true;
  }
  if (normalized.includes(':')) {
    return normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:');
  }
  const parts = normalized.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = parts;
  return a === 10
    || a === 127
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 169 && b === 254)
    || (a === 100 && b >= 64 && b <= 127);
}
