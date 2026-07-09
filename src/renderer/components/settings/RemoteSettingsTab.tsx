import React, { useEffect, useMemo, useState } from 'react';
import * as Switch from '@radix-ui/react-switch';
import { Copy, QrCode, RefreshCw, Trash2, Wifi } from 'lucide-react';
import type {
  RemoteDevice,
  RemoteNetworkInterface,
  RemotePairingQR,
  RemoteSettings,
  RemoteStatus,
} from '../../../shared/types/electron-api';
import { CompactSettingRow, CompactSettingsSection } from './CompactSettings';
import { idePopupActionButtonClassName, idePopupSecondaryButtonClassName } from '../ui/ide-popup';

function joinClassNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

const switchRootClassName = 'relative h-6 w-10 flex-shrink-0 rounded-full bg-[rgb(var(--muted))] transition-colors data-[state=checked]:bg-[rgb(var(--primary))] disabled:cursor-not-allowed disabled:opacity-70';
const switchThumbClassName = 'block h-5 w-5 translate-x-0.5 rounded-full bg-[color-mix(in_srgb,rgb(var(--background))_92%,transparent)] shadow-sm transition-transform data-[state=checked]:translate-x-[18px]';
const secondaryButtonClassName = `${idePopupSecondaryButtonClassName} h-9 rounded-lg px-3 text-sm`;
const primaryButtonClassName = `${idePopupActionButtonClassName('primary')} h-9 min-w-0 rounded-lg px-3 text-sm`;
const inputClassName = 'h-9 w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--input))] px-3 text-sm text-[rgb(var(--foreground))] outline-none transition-colors placeholder:text-[rgb(var(--muted-foreground))] focus:border-[rgb(var(--ring))]';

const defaultRemoteSettings: RemoteSettings = {
  enabled: false,
  bindHost: '0.0.0.0',
  preferredPort: 6868,
  selectedAddress: null,
  manualEndpoint: null,
  acceptedPlainWsNonLocal: false,
  startOnLaunch: false,
};

const defaultRemoteStatus: RemoteStatus = {
  ready: false,
  endpoint: null,
  settings: defaultRemoteSettings,
};

export function RemoteSettingsTab() {
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState<RemoteStatus>(defaultRemoteStatus);
  const [interfaces, setInterfaces] = useState<RemoteNetworkInterface[]>([]);
  const [selectedAddress, setSelectedAddress] = useState<string>('');
  const [customEndpoint, setCustomEndpoint] = useState('');
  const [acceptPlainWsNonLocal, setAcceptPlainWsNonLocal] = useState(false);
  const [pairing, setPairing] = useState<RemotePairingQR | null>(null);
  const [devices, setDevices] = useState<RemoteDevice[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void refreshRemoteState();
  }, []);

  const effectiveAddress = useMemo(() => customEndpoint.trim() || selectedAddress || undefined, [
    customEndpoint,
    selectedAddress,
  ]);

  async function refreshRemoteState() {
    setError(null);
    const [statusResponse, interfacesResponse, devicesResponse] = await Promise.all([
      window.electronAPI.remoteGetStatus(),
      window.electronAPI.remoteListNetworkInterfaces(),
      window.electronAPI.remoteListDevices(),
    ]);

    if (statusResponse.success && statusResponse.data) {
      setStatus(statusResponse.data);
      setEnabled(statusResponse.data.settings.enabled);
      setCustomEndpoint(statusResponse.data.settings.manualEndpoint ?? '');
      setSelectedAddress(statusResponse.data.settings.selectedAddress ?? '');
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
  }

  async function toggleRemote(nextEnabled: boolean) {
    setLoading(true);
    setError(null);
    try {
      const response = await window.electronAPI.remoteUpdateSettings({
        enabled: nextEnabled,
        selectedAddress: selectedAddress || null,
        manualEndpoint: customEndpoint.trim() || null,
        acceptPlainWsNonLocal,
      });
      if (!response.success || !response.data) {
        throw new Error(response.error || 'Failed to update remote settings');
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
      if (!effectiveAddress) {
        throw new Error('Choose a network address or enter a custom endpoint before generating a mobile QR.');
      }
      const settingsResponse = await window.electronAPI.remoteUpdateSettings({
        selectedAddress: selectedAddress || null,
        manualEndpoint: customEndpoint.trim() || null,
        acceptPlainWsNonLocal,
      });
      if (!settingsResponse.success || !settingsResponse.data) {
        throw new Error(settingsResponse.error || 'Failed to save remote settings');
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
        throw new Error(response.error || 'Failed to generate pairing QR');
      }
      setPairing(response.data);
      if (!response.data.available) {
        setError('Remote service is not ready yet.');
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
        throw new Error(response.error || 'Failed to revoke device');
      }
      await refreshRemoteState();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
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
        title="Remote / Mobile"
        help="Pair Synapse Mobile with this desktop over LAN, Tailscale, a tunnel, or a future Synapse Relay."
        icon={<Wifi size={15} />}
        actions={
          <button
            type="button"
            className={secondaryButtonClassName}
            onClick={() => void refreshRemoteState()}
            disabled={loading}
          >
            Refresh
          </button>
        }
      >
        <CompactSettingRow
          label="Remote control"
          help="Remote control is disabled until you turn it on here."
        >
          <Switch.Root
            checked={enabled}
            onCheckedChange={(checked) => void toggleRemote(checked)}
            disabled={loading}
            className={switchRootClassName}
            aria-label="Remote control"
          >
            <Switch.Thumb className={switchThumbClassName} />
          </Switch.Root>
        </CompactSettingRow>

        <CompactSettingRow label="Service endpoint">
          <div className="min-w-0 text-right text-sm text-[rgb(var(--muted-foreground))]">
            {status.endpoint ?? 'Not running'}
          </div>
        </CompactSettingRow>
      </CompactSettingsSection>

      <CompactSettingsSection
        title="Pairing"
        help="The QR code contains a temporary bearer token. Regenerate it if it may have been exposed."
        icon={<QrCode size={15} />}
        actions={
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              className={secondaryButtonClassName}
              onClick={() => void generatePairing(true)}
              disabled={!enabled || loading}
            >
              <RefreshCw size={14} />
              Regenerate
            </button>
            <button
              type="button"
              className={primaryButtonClassName}
              onClick={() => void generatePairing(false)}
              disabled={!enabled || loading}
            >
              Generate QR
            </button>
          </div>
        }
      >
        <div className="space-y-3 px-4 py-3">
          <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="space-y-2">
              <div className="text-xs font-medium uppercase tracking-wide text-[rgb(var(--muted-foreground))]">
                Network address
              </div>
              <div className="flex flex-wrap gap-2">
                {interfaces.map((iface) => (
                  <button
                    key={`${iface.name}:${iface.address}`}
                    type="button"
                    className={joinClassNames(
                      secondaryButtonClassName,
                      selectedAddress === iface.address && !customEndpoint.trim()
                        && 'border-[rgb(var(--primary))] text-[rgb(var(--primary))]',
                    )}
                    onClick={() => {
                      setSelectedAddress(iface.address);
                      setCustomEndpoint('');
                    }}
                  >
                    {iface.address} ({iface.name})
                  </button>
                ))}
                {interfaces.length === 0 && (
                  <div className="text-sm text-[rgb(var(--muted-foreground))]">
                    No network interfaces found.
                  </div>
                )}
              </div>
            </div>

            <label className="space-y-2">
              <span className="block text-xs font-medium uppercase tracking-wide text-[rgb(var(--muted-foreground))]">
                Custom endpoint
              </span>
              <input
                className={inputClassName}
                value={customEndpoint}
                onChange={(event) => setCustomEndpoint(event.target.value)}
                placeholder="wss://example.com or 100.64.1.20"
              />
            </label>
          </div>

          <label className="flex items-start gap-2 rounded-lg border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--secondary))_32%,transparent)] px-3 py-2 text-sm text-[rgb(var(--muted-foreground))]">
            <input
              type="checkbox"
              checked={acceptPlainWsNonLocal}
              onChange={(event) => setAcceptPlainWsNonLocal(event.target.checked)}
              className="mt-1"
            />
            <span>
              I understand that public-looking plain <span className="font-mono">ws://</span>{' '}
              endpoints should only be used when the network path is otherwise trusted. Use{' '}
              <span className="font-mono">wss://</span> for public internet access.
            </span>
          </label>

          {pairing?.available && (
            <div className="grid gap-4 rounded-[14px] border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--secondary))_42%,transparent)] p-4 md:grid-cols-[minmax(0,384px)_minmax(0,1fr)]">
              {pairing.qrDataUrl && (
                <div className="mx-auto flex w-full max-w-96 items-center justify-center rounded-xl bg-white p-3 shadow-sm md:mx-0">
                  <img
                    src={pairing.qrDataUrl}
                    alt="Synapse Mobile pairing QR"
                    className="block aspect-square w-full max-w-full"
                    style={{ imageRendering: 'crisp-edges' }}
                  />
                </div>
              )}
              <div className="min-w-0 space-y-3">
                <div>
                  <div className="text-xs font-medium uppercase tracking-wide text-[rgb(var(--muted-foreground))]">
                    Advertised endpoint
                  </div>
                  <div className="break-all text-sm text-[rgb(var(--foreground))]">
                    {pairing.endpoint}
                  </div>
                </div>
                <textarea
                  readOnly
                  value={pairing.pairingUrl ?? ''}
                  className="h-24 w-full resize-none rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--input))] p-2 text-xs text-[rgb(var(--foreground))]"
                />
                <button
                  type="button"
                  className={secondaryButtonClassName}
                  onClick={() => void copyPairingCode()}
                  disabled={!pairing.pairingUrl}
                >
                  <Copy size={14} />
                  {copied ? 'Copied' : 'Copy pairing code'}
                </button>
              </div>
            </div>
          )}
        </div>
      </CompactSettingsSection>

      <CompactSettingsSection title="Paired devices" icon={<Wifi size={15} />}>
        {devices.length === 0 ? (
          <div className="px-4 py-6 text-sm text-[rgb(var(--muted-foreground))]">
            No paired mobile devices.
          </div>
        ) : (
          devices.map((device) => (
            <CompactSettingRow
              key={device.deviceId}
              label={device.name}
              help={`Scope: ${device.scope}`}
            >
              <div className="flex min-w-0 items-center justify-end gap-3">
                <div className="min-w-0 text-right text-xs text-[rgb(var(--muted-foreground))]">
                  Last seen {formatDeviceTime(device.lastSeenAt)}
                </div>
                <button
                  type="button"
                  className={secondaryButtonClassName}
                  onClick={() => void revokeDevice(device.deviceId)}
                  disabled={loading}
                >
                  <Trash2 size={14} />
                  Revoke
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

function formatDeviceTime(timestamp: number): string {
  if (!timestamp) {
    return 'never';
  }
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return 'unknown';
  }
  return date.toLocaleString();
}
