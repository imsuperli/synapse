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
});
