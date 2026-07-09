import { mkdtempSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  REMOTE_SETTINGS_FILENAME,
  RemoteSettingsStore,
  validateEndpointOverride,
} from '../RemoteSettingsStore';

describe('RemoteSettingsStore', () => {
  let tempDir: string | null = null;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  function createStore(): RemoteSettingsStore {
    tempDir = mkdtempSync(join(tmpdir(), 'synapse-remote-settings-'));
    return new RemoteSettingsStore(tempDir);
  }

  it('defaults to deny-by-default settings', () => {
    const store = createStore();

    expect(store.getSettings()).toEqual({
      enabled: false,
      bindHost: '0.0.0.0',
      preferredPort: 6868,
      selectedAddress: null,
      manualEndpoint: null,
      acceptedPlainWsNonLocal: false,
      startOnLaunch: false,
      relayEnabled: false,
      relayEndpoint: null,
    });
  });

  it('persists settings and preserves unspecified fields on patch update', () => {
    const store = createStore();

    store.update({
      selectedAddress: '100.64.1.20',
      manualEndpoint: 'wss://synapse.example.com',
      relayEndpoint: 'wss://relay.example.com',
    });
    store.update({ enabled: true, relayEnabled: true });

    const reloaded = new RemoteSettingsStore(tempDir!);
    expect(reloaded.getSettings()).toMatchObject({
      enabled: true,
      selectedAddress: '100.64.1.20',
      manualEndpoint: 'wss://synapse.example.com',
      relayEnabled: true,
      relayEndpoint: 'wss://relay.example.com/v1/relay',
    });
  });

  it('requires a relay endpoint when relay mode is enabled', () => {
    const store = createStore();

    expect(() => store.update({ relayEnabled: true })).toThrow(/Relay endpoint is required/);
  });

  it('rejects public-looking plain ws endpoints without acknowledgement', () => {
    expect(() => validateEndpointOverride('ws://public.example.com')).toThrow(
      /explicit acknowledgement/,
    );
    expect(() => validateEndpointOverride('public.example.com')).toThrow(
      /explicit acknowledgement/,
    );
  });

  it('allows private plain ws endpoints and acknowledged public plain ws endpoints', () => {
    expect(validateEndpointOverride('192.168.1.20').requiresAcknowledgement).toBe(false);
    expect(validateEndpointOverride('100.64.1.20').requiresAcknowledgement).toBe(false);
    expect(validateEndpointOverride('desktop.tailnet.ts.net').requiresAcknowledgement).toBe(false);
    expect(validateEndpointOverride('wss://public.example.com').requiresAcknowledgement).toBe(false);
    expect(validateEndpointOverride('ws://public.example.com', true)).toMatchObject({
      requiresAcknowledgement: true,
    });
  });

  it('writes settings files with owner-only mode on unix', () => {
    if (process.platform === 'win32') {
      return;
    }
    const store = createStore();

    store.update({ enabled: true });

    const mode = statSync(join(tempDir!, REMOTE_SETTINGS_FILENAME)).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
