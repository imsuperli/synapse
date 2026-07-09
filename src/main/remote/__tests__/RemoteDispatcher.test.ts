import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProcessStatus } from '../../types/process';
import { REMOTE_ERROR_CODES } from '../../../shared/remote/errors';
import { REMOTE_METHODS } from '../../../shared/remote/methods';
import { RemoteDeviceRegistry, type RemoteDeviceEntry } from '../RemoteDeviceRegistry';
import { RemoteDispatcher } from '../RemoteDispatcher';

type MockProcessManager = {
  listProcesses: ReturnType<typeof vi.fn>;
  getPidByPane: ReturnType<typeof vi.fn>;
  getPtyHistory: ReturnType<typeof vi.fn>;
  clearPtyHistory: ReturnType<typeof vi.fn>;
  getLatestPaneOutputSeq: ReturnType<typeof vi.fn>;
  getPtyHistoryEntriesSince: ReturnType<typeof vi.fn>;
  subscribePtyData: ReturnType<typeof vi.fn>;
  writeToPty: ReturnType<typeof vi.fn>;
  resizePty: ReturnType<typeof vi.fn>;
};

describe('RemoteDispatcher', () => {
  let tempDir: string | null = null;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  function createHarness(
    scope: RemoteDeviceEntry['scope'] = 'mobile.control',
    options: {
      paired?: boolean;
      onDeviceRevoked?: (device: RemoteDeviceEntry) => void;
      stateProvider?: {
        listWindows: ReturnType<typeof vi.fn>;
        listPanes: ReturnType<typeof vi.fn>;
        startWindow?: ReturnType<typeof vi.fn>;
      };
    } = {},
  ) {
    tempDir = mkdtempSync(join(tmpdir(), 'synapse-remote-dispatcher-'));
    const registry = new RemoteDeviceRegistry(tempDir, { now: () => 10_000 });
    const device = registry.getOrCreatePendingDevice('Phone', scope);
    if (options.paired ?? true) {
      registry.markPairingProbeSucceeded(device.deviceId);
    }
    const processManager = createProcessManager();
    const dispatcher = new RemoteDispatcher({
      processManager: processManager as any,
      deviceRegistry: registry,
      hostName: 'Synapse Test',
      appVersion: '9.9.9',
      stateProvider: options.stateProvider as any,
      onDeviceRevoked: options.onDeviceRevoked,
    });
    return { registry, device, processManager, dispatcher };
  }

  function createProcessManager(): MockProcessManager {
    let outputCallback: ((data: string, seq?: number) => void) | null = null;
    return {
      listProcesses: vi.fn(() => [
        {
          sessionId: 'session-1',
          backend: 'local',
          pid: 123,
          status: ProcessStatus.Alive,
          workingDirectory: '/tmp/project',
          command: 'bash',
          windowId: 'win-1',
          paneId: 'pane-1',
        },
      ]),
      getPidByPane: vi.fn((windowId: string, paneId: string) =>
        windowId === 'win-1' && paneId === 'pane-1' ? 123 : null,
      ),
      getPtyHistory: vi.fn(() => ({
        chunks: ['hello', ' world'],
        firstSeq: 4,
        lastSeq: 5,
        evictedBeforeSeq: 0,
        keyboardState: { applicationCursorKeysMode: false },
      })),
      clearPtyHistory: vi.fn(),
      getLatestPaneOutputSeq: vi.fn(() => 5),
      getPtyHistoryEntriesSince: vi.fn((_paneId: string, sinceSeq: number = 0) => ({
        entries: [
          { seq: 4, data: 'hello' },
          { seq: 5, data: ' world' },
        ].filter((entry) => entry.seq > sinceSeq),
        firstSeq: 4,
        lastSeq: 5,
        evictedBeforeSeq: 0,
        gap: false,
      })),
      subscribePtyData: vi.fn((_pid: number, callback: (data: string, seq?: number) => void) => {
        outputCallback = callback;
        return () => {
          outputCallback = null;
        };
      }),
      writeToPty: vi.fn(),
      resizePty: vi.fn(),
      emitOutput(data: string, seq?: number) {
        outputCallback?.(data, seq);
      },
    } as MockProcessManager & { emitOutput(data: string, seq?: number): void };
  }

  async function dispatch(
    harness: ReturnType<typeof createHarness>,
    method: string,
    params?: unknown,
    events: unknown[] = [],
  ) {
    return harness.dispatcher.dispatchRaw(
      JSON.stringify({ id: 'req-1', method, params }),
      { device: harness.device, connectionId: 'conn-1' },
      (event) => events.push(event),
    );
  }

  function waitForSubscriptionActivation(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
  }

  it('marks a pending device paired only after status.get', async () => {
    const harness = createHarness('mobile.control', { paired: false });

    expect(harness.registry.listDevices()).toHaveLength(0);

    const response = await dispatch(harness, REMOTE_METHODS.STATUS_GET);

    expect(response.ok).toBe(true);
    expect(harness.registry.listDevices()).toHaveLength(1);
  });

  it('rejects business methods before pairing is confirmed with status.get', async () => {
    const harness = createHarness('mobile.control', { paired: false });

    const response = await dispatch(harness, REMOTE_METHODS.TERMINAL_LIST);

    expect(response).toMatchObject({
      ok: false,
      error: { code: REMOTE_ERROR_CODES.UNAUTHORIZED },
    });
  });

  it('lists running terminal sessions without exposing full window state', async () => {
    const harness = createHarness();

    const response = await dispatch(harness, REMOTE_METHODS.TERMINAL_LIST);

    expect(response).toMatchObject({
      ok: true,
      result: {
        terminals: [
          {
            windowId: 'win-1',
            paneId: 'pane-1',
            pid: 123,
            workingDirectory: '/tmp/project',
          },
        ],
      },
    });
  });

  it('routes terminal send to ProcessManager', async () => {
    const harness = createHarness();

    await dispatch(harness, REMOTE_METHODS.TERMINAL_SEND, {
      windowId: 'win-1',
      paneId: 'pane-1',
      data: 'ls\r',
    });

    expect(harness.processManager.writeToPty).toHaveBeenCalledWith(123, 'ls\r');
    expect(harness.processManager.resizePty).not.toHaveBeenCalled();
  });

  it('does not support remote terminal resize', async () => {
    const harness = createHarness();

    const response = await dispatch(harness, 'terminal.resize', {
      windowId: 'win-1',
      paneId: 'pane-1',
      cols: 100,
      rows: 32,
    });

    expect(response).toMatchObject({
      ok: false,
      error: { code: REMOTE_ERROR_CODES.FORBIDDEN },
    });
    expect(harness.processManager.resizePty).not.toHaveBeenCalled();
  });

  it('clears remote terminal replay history without writing to the PTY', async () => {
    const harness = createHarness();

    const response = await dispatch(harness, REMOTE_METHODS.TERMINAL_CLEAR, {
      windowId: 'win-1',
      paneId: 'pane-1',
    });

    expect(response).toEqual({
      id: 'req-1',
      ok: true,
      result: {
        windowId: 'win-1',
        paneId: 'pane-1',
        cleared: true,
        lastSeq: 5,
      },
    });
    expect(harness.processManager.clearPtyHistory).toHaveBeenCalledWith('pane-1');
    expect(harness.processManager.writeToPty).not.toHaveBeenCalled();
  });

  it('rejects control methods for read-only mobile devices', async () => {
    const harness = createHarness('mobile.read');

    const response = await dispatch(harness, REMOTE_METHODS.TERMINAL_SEND, {
      windowId: 'win-1',
      paneId: 'pane-1',
      data: 'danger',
    });

    expect(response).toMatchObject({
      ok: false,
      error: { code: REMOTE_ERROR_CODES.FORBIDDEN },
    });
    expect(harness.processManager.writeToPty).not.toHaveBeenCalled();
  });

  it('emits subscribed terminal output and cleans up by connection', async () => {
    const harness = createHarness();
    const events: unknown[] = [];

    const response = await dispatch(harness, REMOTE_METHODS.TERMINAL_SUBSCRIBE, {
      windowId: 'win-1',
      paneId: 'pane-1',
      sinceSeq: 5,
    }, events);
    expect(response).toMatchObject({
      ok: true,
      result: {
        subscriptionId: expect.any(String),
        firstSeq: 4,
        lastSeq: 5,
        gap: false,
      },
    });

    await waitForSubscriptionActivation();

    (harness.processManager as any).emitOutput('old', 5);
    (harness.processManager as any).emitOutput('new', 6);
    harness.dispatcher.cleanupConnection('conn-1');
    (harness.processManager as any).emitOutput('after-cleanup', 7);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'event',
      payload: {
        windowId: 'win-1',
        paneId: 'pane-1',
        seq: 6,
        data: 'new',
      },
    });
    expect(harness.processManager.resizePty).not.toHaveBeenCalled();
  });

  it('rejects terminal subscription viewport parameters', async () => {
    const harness = createHarness();

    const response = await dispatch(harness, REMOTE_METHODS.TERMINAL_SUBSCRIBE, {
      windowId: 'win-1',
      paneId: 'pane-1',
      sinceSeq: 5,
      viewport: { cols: 42, rows: 12 },
    });

    expect(response).toMatchObject({
      ok: false,
      error: { code: REMOTE_ERROR_CODES.INVALID_PARAMS },
    });
    expect(harness.processManager.subscribePtyData).not.toHaveBeenCalled();
    expect(harness.processManager.resizePty).not.toHaveBeenCalled();
  });

  it('replays terminal history after sinceSeq when a subscription activates', async () => {
    const harness = createHarness();
    const events: unknown[] = [];

    const response = await dispatch(harness, REMOTE_METHODS.TERMINAL_SUBSCRIBE, {
      windowId: 'win-1',
      paneId: 'pane-1',
      sinceSeq: 3,
    }, events);

    expect(response).toMatchObject({
      ok: true,
      result: {
        firstSeq: 4,
        lastSeq: 5,
        gap: false,
      },
    });

    await waitForSubscriptionActivation();

    expect(events).toEqual([
      expect.objectContaining({
        type: 'event',
        payload: {
          windowId: 'win-1',
          paneId: 'pane-1',
          seq: 4,
          data: 'hello',
        },
      }),
      expect.objectContaining({
        type: 'event',
        payload: {
          windowId: 'win-1',
          paneId: 'pane-1',
          seq: 5,
          data: ' world',
        },
      }),
    ]);
  });

  it('reports replay gaps from evicted terminal history', async () => {
    const harness = createHarness();
    harness.processManager.getPtyHistoryEntriesSince.mockReturnValueOnce({
      entries: [
        { seq: 3, data: 'after-gap' },
      ],
      firstSeq: 3,
      lastSeq: 5,
      evictedBeforeSeq: 2,
      gap: true,
    });

    const response = await dispatch(harness, REMOTE_METHODS.TERMINAL_SUBSCRIBE, {
      windowId: 'win-1',
      paneId: 'pane-1',
      sinceSeq: 1,
    });

    expect(response).toMatchObject({
      ok: true,
      result: {
        firstSeq: 3,
        lastSeq: 5,
        gap: true,
      },
    });
  });

  it('does not emit delayed subscription activation after connection cleanup', async () => {
    const harness = createHarness();
    const events: unknown[] = [];

    await dispatch(harness, REMOTE_METHODS.TERMINAL_SUBSCRIBE, {
      windowId: 'win-1',
      paneId: 'pane-1',
      sinceSeq: 3,
    }, events);
    (harness.processManager as any).emitOutput('buffered-before-cleanup', 6);

    harness.dispatcher.cleanupConnection('conn-1');
    await waitForSubscriptionActivation();

    expect(events).toEqual([]);
  });

  it('allows admin devices to list and revoke devices without exposing tokens', async () => {
    const revokedDevices: RemoteDeviceEntry[] = [];
    const harness = createHarness('mobile.admin', {
      onDeviceRevoked: (device) => revokedDevices.push(device),
    });

    const listResponse = await dispatch(harness, REMOTE_METHODS.DEVICE_LIST);
    expect(listResponse).toMatchObject({
      ok: true,
      result: {
        devices: [
          {
            deviceId: harness.device.deviceId,
            name: 'Phone',
            scope: 'mobile.admin',
          },
        ],
      },
    });
    expect(JSON.stringify(listResponse)).not.toContain(harness.device.token);

    const revokeResponse = await dispatch(harness, REMOTE_METHODS.DEVICE_REVOKE, {
      deviceId: harness.device.deviceId,
    });

    expect(revokeResponse).toMatchObject({
      ok: true,
      result: { revoked: true },
    });
    expect(harness.registry.getDevice(harness.device.deviceId)).toBeNull();
    expect(revokedDevices).toEqual([harness.device]);
  });

  it('rejects device admin methods for default mobile control devices', async () => {
    const harness = createHarness('mobile.control');

    const response = await dispatch(harness, REMOTE_METHODS.DEVICE_LIST);

    expect(response).toMatchObject({
      ok: false,
      error: { code: REMOTE_ERROR_CODES.FORBIDDEN },
    });
  });

  it('rejects full window state methods for default mobile control devices', async () => {
    const stateProvider = {
      listWindows: vi.fn(),
      listPanes: vi.fn(),
    };
    const harness = createHarness('mobile.control', { stateProvider });

    const response = await dispatch(harness, REMOTE_METHODS.WINDOW_LIST);

    expect(response).toMatchObject({
      ok: false,
      error: { code: REMOTE_ERROR_CODES.FORBIDDEN },
    });
    expect(stateProvider.listWindows).not.toHaveBeenCalled();
  });

  it('serves window and pane summaries for window-control devices when state provider exists', async () => {
    const stateProvider = {
      listWindows: vi.fn(() => ({
        windows: [
          {
            windowId: 'win-1',
            name: 'Project',
            panes: [],
          },
        ],
      })),
      listPanes: vi.fn(() => ({
        panes: [
          {
            windowId: 'win-1',
            paneId: 'pane-1',
            kind: 'terminal',
          },
        ],
      })),
      startWindow: vi.fn(),
    };
    const harness = createHarness('mobile.window-control', { stateProvider });

    const windowResponse = await dispatch(harness, REMOTE_METHODS.WINDOW_LIST, {
      terminalOnly: true,
    });
    const paneResponse = await dispatch(harness, REMOTE_METHODS.PANE_LIST, {
      windowId: 'win-1',
    });

    expect(windowResponse).toMatchObject({
      ok: true,
      result: {
        windows: [
          {
            windowId: 'win-1',
            name: 'Project',
          },
        ],
      },
    });
    expect(paneResponse).toMatchObject({
      ok: true,
      result: {
        panes: [
          {
            windowId: 'win-1',
            paneId: 'pane-1',
            kind: 'terminal',
          },
        ],
      },
    });
    expect(stateProvider.listWindows).toHaveBeenCalledWith({
      terminalOnly: true,
    });
    expect(stateProvider.listPanes).toHaveBeenCalledWith({
      windowId: 'win-1',
    });
  });

  it('starts a window through the state provider for window-control devices', async () => {
    const stateProvider = {
      listWindows: vi.fn(),
      listPanes: vi.fn(),
      startWindow: vi.fn(() => ({
        window: {
          windowId: 'win-1',
          name: 'Project',
          panes: [],
        },
        pane: {
          windowId: 'win-1',
          paneId: 'pane-1',
          kind: 'terminal',
          running: true,
        },
        startedPanes: [],
      })),
    };
    const harness = createHarness('mobile.window-control', { stateProvider });

    const response = await dispatch(harness, REMOTE_METHODS.WINDOW_START, {
      windowId: 'win-1',
      paneId: 'pane-1',
    });

    expect(response).toMatchObject({
      ok: true,
      result: {
        pane: {
          windowId: 'win-1',
          paneId: 'pane-1',
        },
      },
    });
    expect(stateProvider.startWindow).toHaveBeenCalledWith({
      windowId: 'win-1',
      paneId: 'pane-1',
    });
  });

  it('does not advertise window methods when no state provider is registered', async () => {
    const harness = createHarness('mobile.window-control');

    const capabilities = await dispatch(harness, REMOTE_METHODS.REMOTE_CAPABILITIES);
    const windowResponse = await dispatch(harness, REMOTE_METHODS.WINDOW_LIST);

    expect(capabilities).toMatchObject({
      ok: true,
      result: {
        methods: expect.not.arrayContaining([REMOTE_METHODS.WINDOW_LIST, REMOTE_METHODS.PANE_LIST]),
      },
    });
    expect(windowResponse).toMatchObject({
      ok: false,
      error: { code: REMOTE_ERROR_CODES.METHOD_NOT_FOUND },
    });
  });

  it('advertises only methods allowed by the authenticated device scope', async () => {
    const stateProvider = {
      listWindows: vi.fn(() => ({ windows: [] })),
      listPanes: vi.fn(() => ({ panes: [] })),
      startWindow: vi.fn(),
    };
    const readHarness = createHarness('mobile.read', { stateProvider });
    const adminHarness = createHarness('mobile.admin', { stateProvider });

    const readCapabilities = await dispatch(readHarness, REMOTE_METHODS.REMOTE_CAPABILITIES);
    const adminCapabilities = await dispatch(adminHarness, REMOTE_METHODS.REMOTE_CAPABILITIES);

    expect(readCapabilities).toMatchObject({
      ok: true,
      result: {
        methods: expect.arrayContaining([
          REMOTE_METHODS.STATUS_GET,
          REMOTE_METHODS.TERMINAL_HISTORY,
        ]),
      },
    });
    expect((readCapabilities as any).result.methods).not.toContain(REMOTE_METHODS.TERMINAL_SEND);
    expect((readCapabilities as any).result.methods).not.toContain(REMOTE_METHODS.WINDOW_LIST);
    expect((adminCapabilities as any).result.methods).not.toContain('terminal.resize');
    expect(adminCapabilities).toMatchObject({
      ok: true,
      result: {
        methods: expect.arrayContaining([
          REMOTE_METHODS.WINDOW_LIST,
          REMOTE_METHODS.WINDOW_START,
          REMOTE_METHODS.DEVICE_REVOKE,
        ]),
      },
    });
  });
});
