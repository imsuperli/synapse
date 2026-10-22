import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  join(process.cwd(), 'src/renderer/components/settings/RemoteSettingsTab.tsx'),
  'utf8',
);

describe('RemoteSettingsTab wiring', () => {
  it('confirms device revocation before sending the IPC request', () => {
    expect(source).toContain('async function confirmRevokeDevice(device: RemoteDevice)');
    expect(source).toContain("window.confirm(t('settings.remote.revokeDeviceConfirm', { name: device.name }))");
    expect(source).toContain('await revokeDevice(device.deviceId)');
    expect(source).toContain('onClick={() => void confirmRevokeDevice(device)}');
  });

  it('surfaces remote state loading failures in the settings panel', () => {
    expect(source).toContain('async function refreshRemoteState()');
    expect(source).toContain('} catch (err) {');
    expect(source).toContain('setError(err instanceof Error ? err.message : String(err));');
  });

  it('enables remote control before persisting an address that may need acknowledgement', () => {
    const toggleBlock = source.slice(
      source.indexOf('async function toggleRemote('),
      source.indexOf('async function generatePairing('),
    );
    expect(toggleBlock).toContain('remoteUpdateSettings({\n        enabled: nextEnabled,\n      })');
    expect(toggleBlock).not.toContain('selectedAddress:');
    expect(toggleBlock).not.toContain('manualEndpoint:');
  });

  it('shows plain ws acknowledgement for a selected public-looking interface address', () => {
    expect(source).toContain('const selectedAddressRequiresPlainWsAcknowledgement');
    expect(source).toContain('|| selectedAddressRequiresPlainWsAcknowledgement');
    expect(source).toContain(
      '(requiresPlainWsAcknowledgement || selectedAddressRequiresPlainWsAcknowledgement)',
    );
  });
});
