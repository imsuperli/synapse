import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProcessStatus } from '../../types/process';
import { REMOTE_ERROR_CODES } from '../../../shared/remote/errors';
import { REMOTE_METHODS } from '../../../shared/remote/methods';
import {
  TerminalStreamOpcode,
  decodeTerminalStreamFrame,
  decodeTerminalStreamJson,
  decodeTerminalStreamText,
} from '../../../shared/remote/terminal-stream-protocol';
import { RemoteDeviceRegistry, type RemoteDeviceEntry } from '../RemoteDeviceRegistry';
import { RemoteDispatcher } from '../RemoteDispatcher';

type MockProcessManager = {
  listProcesses: ReturnType<typeof vi.fn>;
  getPidByPane: ReturnType<typeof vi.fn>;
  getPtyHistory: ReturnType<typeof vi.fn>;
  getPaneTerminalDimensions: ReturnType<typeof vi.fn>;
  getTerminalScreenSnapshot: ReturnType<typeof vi.fn>;
  clearPtyHistory: ReturnType<typeof vi.fn>;
  getLatestPaneOutputSeq: ReturnType<typeof vi.fn>;
  getPtyHistoryEntriesSince: ReturnType<typeof vi.fn>;
  getPtyHistoryEntriesBefore: ReturnType<typeof vi.fn>;
  subscribePtyData: ReturnType<typeof vi.fn>;
  writeToPty: ReturnType<typeof vi.fn>;
  resizePty: ReturnType<typeof vi.fn>;
};

const defaultKeyboardState = {
  applicationCursorKeysMode: false,
  applicationKeypadMode: false,
  bracketedPasteMode: false,
  sendFocusMode: false,
  win32InputMode: false,
  mouseTracking: {
    protocol: 'NONE',
    encoding: 'DEFAULT',
  },
  kittyKeyboard: {
    flags: 0,
    mainFlags: 0,
    altFlags: 0,
    mainStack: [],
    altStack: [],
  },
} as const;

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
        closeWindow?: ReturnType<typeof vi.fn>;
        closePane?: ReturnType<typeof vi.fn>;
        deletePane?: ReturnType<typeof vi.fn>;
        deleteWindow?: ReturnType<typeof vi.fn>;
        createGroup?: ReturnType<typeof vi.fn>;
        deleteGroup?: ReturnType<typeof vi.fn>;
        removeWindowFromGroup?: ReturnType<typeof vi.fn>;
        supportsSSHWindowCreation?: ReturnType<typeof vi.fn>;
        listSSHProfiles?: ReturnType<typeof vi.fn>;
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
      getPaneTerminalDimensions: vi.fn(() => ({ cols: 132, rows: 34 })),
      getTerminalScreenSnapshot: vi.fn(() => undefined),
      clearPtyHistory: vi.fn(),
      getLatestPaneOutputSeq: vi.fn(() => 5),
      getPtyHistoryEntriesSince: vi.fn((_windowId: string, _paneId: string, sinceSeq: number = 0) => ({
        entries: [
          { seq: 4, data: 'hello' },
          { seq: 5, data: ' world' },
        ].filter((entry) => entry.seq > sinceSeq),
        firstSeq: 4,
        lastSeq: 5,
        evictedBeforeSeq: 0,
        hasMoreBefore: false,
        gap: false,
      })),
      getPtyHistoryEntriesBefore: vi.fn((_windowId: string, _paneId: string, beforeSeq: number = Number.MAX_SAFE_INTEGER) => ({
        entries: [
          { seq: 4, data: 'hello' },
          { seq: 5, data: ' world' },
        ].filter((entry) => entry.seq < beforeSeq),
        firstSeq: 4,
        lastSeq: 5,
        evictedBeforeSeq: 0,
        gap: false,
        hasMoreBefore: false,
        keyboardState: defaultKeyboardState,
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
    binaryEvents: Uint8Array[] = [],
  ) {
    return harness.dispatcher.dispatchRaw(
      JSON.stringify({ id: 'req-1', method, params }),
      { device: harness.device, connectionId: 'conn-1' },
      (event) => events.push(event),
      (event) => binaryEvents.push(event),
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
    expect(harness.processManager.clearPtyHistory).toHaveBeenCalledWith('win-1', 'pane-1');
    expect(harness.processManager.writeToPty).not.toHaveBeenCalled();
  });

  it('returns incremental terminal history after sinceSeq', async () => {
    const harness = createHarness();

    const response = await dispatch(harness, REMOTE_METHODS.TERMINAL_HISTORY, {
      windowId: 'win-1',
      paneId: 'pane-1',
      sinceSeq: 4,
    });

    expect(response).toEqual({
      id: 'req-1',
      ok: true,
      result: {
        windowId: 'win-1',
        paneId: 'pane-1',
        chunks: [' world'],
        firstSeq: 5,
        lastSeq: 5,
        latestSeq: 5,
        hasMoreAfter: false,
        gap: false,
        hasMoreBefore: false,
        evictedBeforeSeq: 0,
        cols: 132,
        rows: 34,
      },
    });
    expect(harness.processManager.getPtyHistoryEntriesSince).toHaveBeenCalledWith('win-1', 'pane-1', 4);
  });

  it('reports the desktop high-water mark when an incremental page is incomplete', async () => {
    const harness = createHarness();
    harness.processManager.getPtyHistoryEntriesSince.mockReturnValueOnce({
      entries: [
        { seq: 3, data: 'three' },
        { seq: 4, data: 'four' },
        { seq: 5, data: 'five' },
      ],
      firstSeq: 3,
      lastSeq: 5,
      evictedBeforeSeq: 0,
      hasMoreBefore: false,
      gap: false,
    });

    const response = await dispatch(harness, REMOTE_METHODS.TERMINAL_HISTORY, {
      windowId: 'win-1',
      paneId: 'pane-1',
      sinceSeq: 2,
      limitChunks: 1,
    });

    expect(response).toMatchObject({
      ok: true,
      result: {
        chunks: ['three'],
        lastSeq: 3,
        latestSeq: 5,
        hasMoreAfter: true,
      },
    });
  });

  it('reports a history gap when the client cursor is ahead of the current process', async () => {
    const harness = createHarness();

    const response = await dispatch(harness, REMOTE_METHODS.TERMINAL_HISTORY, {
      windowId: 'win-1',
      paneId: 'pane-1',
      sinceSeq: 50,
    });

    expect(response).toMatchObject({
      ok: true,
      result: {
        chunks: [],
        lastSeq: 5,
        gap: true,
      },
    });
  });

  it('returns older terminal history before beforeSeq with page limits', async () => {
    const harness = createHarness();
    harness.processManager.getPtyHistoryEntriesBefore.mockReturnValueOnce({
      entries: [
        { seq: 2, data: 'older' },
        { seq: 3, data: ' page' },
      ],
      firstSeq: 2,
      lastSeq: 3,
      evictedBeforeSeq: 0,
      gap: false,
      hasMoreBefore: true,
    });

    const response = await dispatch(harness, REMOTE_METHODS.TERMINAL_HISTORY, {
      windowId: 'win-1',
      paneId: 'pane-1',
      beforeSeq: 4,
      limitBytes: 4096,
      limitChunks: 20,
    });

    expect(response).toEqual({
      id: 'req-1',
      ok: true,
      result: {
        windowId: 'win-1',
        paneId: 'pane-1',
        chunks: ['older', ' page'],
        firstSeq: 2,
        lastSeq: 3,
        latestSeq: 5,
        hasMoreAfter: false,
        gap: false,
        hasMoreBefore: true,
        evictedBeforeSeq: 0,
        cols: 132,
        rows: 34,
      },
    });
    expect(harness.processManager.getPtyHistoryEntriesBefore).toHaveBeenCalledWith(
      'win-1',
      'pane-1',
      4,
      {
        limitBytes: 4096,
        limitChunks: 20,
      },
    );
  });

  it('includes the latest renderer screen snapshot in terminal history responses', async () => {
    const harness = createHarness();
    harness.processManager.getTerminalScreenSnapshot.mockReturnValueOnce({
      windowId: 'win-1',
      paneId: 'pane-1',
      cols: 120,
      rows: 30,
      cursorX: 4,
      cursorY: 10,
      alternate: true,
      data: '\u001b[?1049h\u001b[2J\u001b[Hworking',
      capturedAt: '2026-07-11T10:30:00.000Z',
      outputSeq: 4,
    });

    const response = await dispatch(harness, REMOTE_METHODS.TERMINAL_HISTORY, {
      windowId: 'win-1',
      paneId: 'pane-1',
      sinceSeq: 4,
    });

    expect(response).toMatchObject({
      ok: true,
      result: {
        screenSnapshot: {
          windowId: 'win-1',
          paneId: 'pane-1',
          alternate: true,
          data: '\u001b[?1049h\u001b[2J\u001b[Hworking',
        },
      },
    });
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
    const binaryEvents: Uint8Array[] = [];

    const response = await dispatch(harness, REMOTE_METHODS.TERMINAL_SUBSCRIBE, {
      windowId: 'win-1',
      paneId: 'pane-1',
      sinceSeq: 5,
      capabilities: { terminalBinaryStream: 1 },
    }, events, binaryEvents);
    expect(response).toMatchObject({
      ok: true,
      streaming: true,
      result: {
        type: 'subscribed',
        subscriptionId: expect.any(String),
        streamId: expect.any(Number),
        firstSeq: 5,
        lastSeq: 5,
        gap: false,
      },
    });

    await waitForSubscriptionActivation();

    (harness.processManager as any).emitOutput('old', 5);
    (harness.processManager as any).emitOutput('new', 6);
    harness.dispatcher.cleanupConnection('conn-1');
    (harness.processManager as any).emitOutput('after-cleanup', 7);

    expect(events).toEqual([]);
    const frames = binaryEvents.map((event) => decodeTerminalStreamFrame(event));
    expect(frames.some((frame) => frame?.opcode === TerminalStreamOpcode.SnapshotStart)).toBe(true);
    expect(frames.some((frame) => frame?.opcode === TerminalStreamOpcode.SnapshotChunk)).toBe(false);
    expect(frames.some((frame) => frame?.opcode === TerminalStreamOpcode.SnapshotEnd)).toBe(true);
    const outputFrames = frames.filter((frame) => frame?.opcode === TerminalStreamOpcode.Output);
    expect(outputFrames).toHaveLength(1);
    expect(decodeTerminalStreamText(outputFrames[0]!.payload)).toBe('new');
    expect(outputFrames[0]!.seq).toBe(6);
    expect(harness.processManager.resizePty).not.toHaveBeenCalled();
  });

  it('rejects terminal subscription viewport parameters', async () => {
    const harness = createHarness();

    const response = await dispatch(harness, REMOTE_METHODS.TERMINAL_SUBSCRIBE, {
      windowId: 'win-1',
      paneId: 'pane-1',
      sinceSeq: 5,
      capabilities: { terminalBinaryStream: 1 },
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
    const binaryEvents: Uint8Array[] = [];

    const response = await dispatch(harness, REMOTE_METHODS.TERMINAL_SUBSCRIBE, {
      windowId: 'win-1',
      paneId: 'pane-1',
      sinceSeq: 3,
      capabilities: { terminalBinaryStream: 1 },
    }, events, binaryEvents);

    expect(response).toMatchObject({
      ok: true,
      streaming: true,
      result: {
        type: 'subscribed',
        streamId: expect.any(Number),
        firstSeq: 4,
        lastSeq: 5,
        gap: false,
      },
    });

    await waitForSubscriptionActivation();

    expect(events).toEqual([]);
    const snapshotText = binaryEvents
      .map((event) => decodeTerminalStreamFrame(event))
      .filter((frame) => frame?.opcode === TerminalStreamOpcode.SnapshotChunk)
      .map((frame) => decodeTerminalStreamText(frame!.payload))
      .join('');
    expect(snapshotText).toBe('hello world');
    const snapshotStart = binaryEvents
      .map((event) => decodeTerminalStreamFrame(event))
      .find((frame) => frame?.opcode === TerminalStreamOpcode.SnapshotStart);
    expect(decodeTerminalStreamJson<Record<string, unknown>>(snapshotStart!.payload)).toMatchObject({
      incremental: true,
      requestedSinceSeq: 3,
      hasMoreAfter: false,
    });
  });

  it('streams the renderer screen snapshot at its captured output sequence', async () => {
    const harness = createHarness();
    const binaryEvents: Uint8Array[] = [];
    harness.processManager.getTerminalScreenSnapshot.mockReturnValueOnce({
      windowId: 'win-1',
      paneId: 'pane-1',
      cols: 132,
      rows: 34,
      cursorX: 2,
      cursorY: 3,
      alternate: true,
      data: '<screen>',
      capturedAt: '2026-07-12T10:00:00.000Z',
      outputSeq: 4,
    });

    await dispatch(harness, REMOTE_METHODS.TERMINAL_SUBSCRIBE, {
      windowId: 'win-1',
      paneId: 'pane-1',
      sinceSeq: 0,
      capabilities: { terminalBinaryStream: 1 },
    }, [], binaryEvents);
    await waitForSubscriptionActivation();

    const frames = binaryEvents.map((event) => decodeTerminalStreamFrame(event));
    const start = frames.find((frame) => frame?.opcode === TerminalStreamOpcode.SnapshotStart);
    const meta = decodeTerminalStreamJson<Record<string, unknown>>(start!.payload);
    const snapshotText = frames
      .filter((frame) => frame?.opcode === TerminalStreamOpcode.SnapshotChunk)
      .map((frame) => decodeTerminalStreamText(frame!.payload))
      .join('');

    expect(snapshotText).toBe('hello<screen> world');
    expect(meta).toMatchObject({
      firstSeq: 4,
      lastSeq: 5,
      screenSnapshotOffset: 5,
      screenSnapshotLength: 8,
    });
  });

  it('rehydrates active TUI mouse modes after truncated recent history', async () => {
    const harness = createHarness();
    const binaryEvents: Uint8Array[] = [];
    harness.processManager.getPtyHistoryEntriesBefore.mockReturnValueOnce({
      entries: [
        { seq: 200, data: 'recent-output' },
      ],
      firstSeq: 200,
      lastSeq: 200,
      evictedBeforeSeq: 0,
      gap: false,
      hasMoreBefore: true,
      keyboardState: {
        ...defaultKeyboardState,
        mouseTracking: {
          protocol: 'DRAG',
          encoding: 'SGR',
        },
      },
    });
    const screenSnapshot = '\u001b[?1049h\u001b[2J\u001b[Hworking 42s';
    harness.processManager.getTerminalScreenSnapshot.mockReturnValueOnce({
      windowId: 'win-1',
      paneId: 'pane-1',
      cols: 132,
      rows: 34,
      cursorX: 12,
      cursorY: 20,
      alternate: true,
      data: screenSnapshot,
      capturedAt: '2026-07-15T06:00:00.000Z',
      outputSeq: 200,
    });

    await dispatch(harness, REMOTE_METHODS.TERMINAL_SUBSCRIBE, {
      windowId: 'win-1',
      paneId: 'pane-1',
      sinceSeq: 0,
      capabilities: { terminalBinaryStream: 1 },
    }, [], binaryEvents);
    await waitForSubscriptionActivation();

    const frames = binaryEvents.map((event) => decodeTerminalStreamFrame(event));
    const start = frames.find((frame) => frame?.opcode === TerminalStreamOpcode.SnapshotStart);
    const meta = decodeTerminalStreamJson<Record<string, unknown>>(start!.payload);
    const snapshotText = frames
      .filter((frame) => frame?.opcode === TerminalStreamOpcode.SnapshotChunk)
      .map((frame) => decodeTerminalStreamText(frame!.payload))
      .join('');

    expect(snapshotText).not.toContain('\u001b[?1002;1006hrecent-output');
    expect(snapshotText).toContain(screenSnapshot);
    expect(snapshotText).toMatch(/\u001b\[\?1002;1006h$/);
    expect(snapshotText.match(/\u001b\[\?1049h/g)).toHaveLength(1);
    expect(meta).toMatchObject({
      screenSnapshotOffset: 'recent-output'.length,
      screenSnapshotLength: screenSnapshot.length,
    });
  });

  it('bounds the initial terminal snapshot so live rendering is not blocked by full history', async () => {
    const harness = createHarness();

    await dispatch(harness, REMOTE_METHODS.TERMINAL_SUBSCRIBE, {
      windowId: 'win-1',
      paneId: 'pane-1',
      sinceSeq: 0,
      capabilities: { terminalBinaryStream: 1 },
    });

    expect(harness.processManager.getPtyHistoryEntriesBefore).toHaveBeenCalledWith(
      'win-1',
      'pane-1',
      Number.MAX_SAFE_INTEGER,
      {
        limitBytes: 128 * 1024,
        limitChunks: 20_000,
      },
    );
  });

  it('replaces an ahead reconnect cursor and resumes output from the new process sequence', async () => {
    const harness = createHarness();
    const binaryEvents: Uint8Array[] = [];

    const response = await dispatch(harness, REMOTE_METHODS.TERMINAL_SUBSCRIBE, {
      windowId: 'win-1',
      paneId: 'pane-1',
      sinceSeq: 50,
      capabilities: { terminalBinaryStream: 1 },
    }, [], binaryEvents);
    await waitForSubscriptionActivation();
    (harness.processManager as any).emitOutput('new-process-output', 6);

    expect(response).toMatchObject({
      ok: true,
      result: {
        firstSeq: 4,
        lastSeq: 5,
      },
    });
    const frames = binaryEvents.map((event) => decodeTerminalStreamFrame(event));
    const start = frames.find((frame) => frame?.opcode === TerminalStreamOpcode.SnapshotStart);
    expect(decodeTerminalStreamJson<Record<string, unknown>>(start!.payload)).toMatchObject({
      incremental: false,
      requestedSinceSeq: 50,
      firstSeq: 4,
      lastSeq: 5,
    });
    const snapshotText = frames
      .filter((frame) => frame?.opcode === TerminalStreamOpcode.SnapshotChunk)
      .map((frame) => decodeTerminalStreamText(frame!.payload))
      .join('');
    expect(snapshotText).toBe('hello world');
    const output = frames.find((frame) => frame?.opcode === TerminalStreamOpcode.Output);
    expect(output?.seq).toBe(6);
    expect(decodeTerminalStreamText(output!.payload)).toBe('new-process-output');
  });

  it('marks incremental snapshots when more retained output remains', async () => {
    const harness = createHarness();
    const binaryEvents: Uint8Array[] = [];
    const first = 'a'.repeat(400 * 1024);
    const second = 'b'.repeat(400 * 1024);
    harness.processManager.getPtyHistoryEntriesSince.mockReturnValueOnce({
      entries: [
        { seq: 4, data: first },
        { seq: 5, data: second },
      ],
      firstSeq: 4,
      lastSeq: 5,
      evictedBeforeSeq: 0,
      gap: false,
      hasMoreBefore: false,
    });

    const response = await dispatch(harness, REMOTE_METHODS.TERMINAL_SUBSCRIBE, {
      windowId: 'win-1',
      paneId: 'pane-1',
      sinceSeq: 3,
      capabilities: { terminalBinaryStream: 1 },
    }, [], binaryEvents);
    await waitForSubscriptionActivation();

    expect(response).toMatchObject({
      ok: true,
      result: { firstSeq: 4, lastSeq: 4 },
    });
    const start = binaryEvents
      .map((event) => decodeTerminalStreamFrame(event))
      .find((frame) => frame?.opcode === TerminalStreamOpcode.SnapshotStart);
    expect(decodeTerminalStreamJson<Record<string, unknown>>(start!.payload)).toMatchObject({
      incremental: true,
      requestedSinceSeq: 3,
      hasMoreAfter: true,
      firstSeq: 4,
      lastSeq: 4,
    });
  });

  it('keeps the latest output sequence when retained history is empty', async () => {
    const harness = createHarness();
    harness.processManager.getPtyHistoryEntriesBefore.mockReturnValueOnce({
      entries: [],
      firstSeq: 0,
      lastSeq: 0,
      evictedBeforeSeq: 5,
      gap: true,
      hasMoreBefore: false,
      keyboardState: defaultKeyboardState,
    });
    harness.processManager.getLatestPaneOutputSeq.mockReturnValueOnce(5);

    const response = await dispatch(harness, REMOTE_METHODS.TERMINAL_SUBSCRIBE, {
      windowId: 'win-1',
      paneId: 'pane-1',
      sinceSeq: 0,
      capabilities: { terminalBinaryStream: 1 },
    });

    expect(response).toMatchObject({
      ok: true,
      result: { firstSeq: 0, lastSeq: 5 },
    });
  });

  it('does not drop output that arrives while the subscription snapshot is read', async () => {
    const harness = createHarness();
    const binaryEvents: Uint8Array[] = [];
    harness.processManager.getLatestPaneOutputSeq.mockReturnValueOnce(5);
    harness.processManager.getPtyHistoryEntriesBefore.mockImplementationOnce(() => {
      (harness.processManager as any).emitOutput('late-output', 6);
      return {
        entries: [
          { seq: 4, data: 'hello' },
          { seq: 5, data: ' world' },
        ],
        firstSeq: 4,
        lastSeq: 5,
        evictedBeforeSeq: 0,
        gap: false,
        hasMoreBefore: false,
        keyboardState: defaultKeyboardState,
      };
    });

    await dispatch(harness, REMOTE_METHODS.TERMINAL_SUBSCRIBE, {
      windowId: 'win-1',
      paneId: 'pane-1',
      sinceSeq: 0,
      capabilities: { terminalBinaryStream: 1 },
    }, [], binaryEvents);
    await waitForSubscriptionActivation();

    const outputFrames = binaryEvents
      .map((event) => decodeTerminalStreamFrame(event))
      .filter((frame) => frame?.opcode === TerminalStreamOpcode.Output);
    expect(outputFrames.map((frame) => ({
      seq: frame!.seq,
      data: decodeTerminalStreamText(frame!.payload),
    }))).toEqual([{ seq: 6, data: 'late-output' }]);
  });

  it('reports replay gaps from evicted terminal history', async () => {
    const harness = createHarness();
    harness.processManager.getPtyHistoryEntriesSince.mockReturnValueOnce({
      entries: [
        { seq: 3, data: 'after-gap' },
        { seq: 4, data: '-continued' },
        { seq: 5, data: '-latest' },
      ],
      firstSeq: 3,
      lastSeq: 5,
      evictedBeforeSeq: 2,
      gap: true,
      hasMoreBefore: false,
    });
    harness.processManager.getPtyHistoryEntriesBefore.mockReturnValueOnce({
      entries: [
        { seq: 3, data: 'after-gap' },
        { seq: 4, data: '-continued' },
        { seq: 5, data: '-latest' },
      ],
      firstSeq: 3,
      lastSeq: 5,
      evictedBeforeSeq: 2,
      gap: true,
      hasMoreBefore: false,
      keyboardState: defaultKeyboardState,
    });

    const response = await dispatch(harness, REMOTE_METHODS.TERMINAL_SUBSCRIBE, {
      windowId: 'win-1',
      paneId: 'pane-1',
      sinceSeq: 1,
      capabilities: { terminalBinaryStream: 1 },
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
      capabilities: { terminalBinaryStream: 1 },
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
      createWindow: vi.fn(),
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
      createWindow: vi.fn(),
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
      createWindow: vi.fn(),
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

  it('creates a local terminal window through the state provider for window-control devices', async () => {
    const stateProvider = {
      listWindows: vi.fn(),
      listPanes: vi.fn(),
      startWindow: vi.fn(),
      createWindow: vi.fn(() => ({
        window: {
          windowId: 'win-created',
          name: 'Mobile Shell',
          panes: [],
        },
        pane: {
          windowId: 'win-created',
          paneId: 'pane-created',
          kind: 'terminal',
          running: true,
        },
      })),
    };
    const harness = createHarness('mobile.window-control', { stateProvider });

    const response = await dispatch(harness, REMOTE_METHODS.WINDOW_CREATE, {
      backend: 'local',
      name: 'Mobile Shell',
      workingDirectory: '/repo',
    });

    expect(response).toMatchObject({
      ok: true,
      result: {
        pane: {
          windowId: 'win-created',
          paneId: 'pane-created',
        },
      },
    });
    expect(stateProvider.createWindow).toHaveBeenCalledWith({
      backend: 'local',
      name: 'Mobile Shell',
      workingDirectory: '/repo',
    });
  });

  it('rejects ambiguous window creation requests without a backend', async () => {
    const stateProvider = {
      listWindows: vi.fn(),
      listPanes: vi.fn(),
      startWindow: vi.fn(),
      createWindow: vi.fn(),
    };
    const harness = createHarness('mobile.window-control', { stateProvider });

    const response = await dispatch(harness, REMOTE_METHODS.WINDOW_CREATE, {
      workingDirectory: '/repo',
    });

    expect(response).toMatchObject({
      ok: false,
      error: { code: REMOTE_ERROR_CODES.INVALID_PARAMS },
    });
    expect(stateProvider.createWindow).not.toHaveBeenCalled();
  });

  it('lists safe SSH profiles and delegates SSH window creation for window-control devices', async () => {
    const stateProvider = {
      listWindows: vi.fn(),
      listPanes: vi.fn(),
      startWindow: vi.fn(),
      supportsSSHWindowCreation: vi.fn(() => true),
      listSSHProfiles: vi.fn(() => ({
        profiles: [{
          profileId: 'profile-1',
          name: 'Production',
          host: 'prod.example.com',
          port: 22,
          user: 'deploy',
          defaultRemoteCwd: '/srv/app',
          remoteCommand: null,
        }],
      })),
      createWindow: vi.fn(() => ({
        window: {
          windowId: 'win-ssh',
          name: 'Production',
          panes: [],
        },
        pane: {
          windowId: 'win-ssh',
          paneId: 'pane-ssh',
          kind: 'terminal',
          backend: 'ssh',
          running: true,
        },
      })),
    };
    const harness = createHarness('mobile.window-control', { stateProvider });

    const capabilities = await dispatch(harness, REMOTE_METHODS.REMOTE_CAPABILITIES);
    const profileResponse = await dispatch(harness, REMOTE_METHODS.SSH_PROFILE_LIST);
    const createResponse = await dispatch(harness, REMOTE_METHODS.WINDOW_CREATE, {
      backend: 'ssh',
      profileId: 'profile-1',
      workingDirectory: '/srv/app',
      initialCols: 100,
      initialRows: 30,
    });

    expect(capabilities).toMatchObject({
      ok: true,
      result: { methods: expect.arrayContaining([REMOTE_METHODS.SSH_PROFILE_LIST]) },
    });
    expect(profileResponse).toMatchObject({
      ok: true,
      result: { profiles: [{ profileId: 'profile-1', name: 'Production' }] },
    });
    expect(createResponse).toMatchObject({
      ok: true,
      result: { pane: { windowId: 'win-ssh', paneId: 'pane-ssh' } },
    });
    expect(stateProvider.createWindow).toHaveBeenCalledWith({
      backend: 'ssh',
      profileId: 'profile-1',
      workingDirectory: '/srv/app',
      initialCols: 100,
      initialRows: 30,
    });
  });

  it('does not expose SSH profile summaries to lower-privilege mobile scopes', async () => {
    const stateProvider = {
      listWindows: vi.fn(),
      listPanes: vi.fn(),
      createWindow: vi.fn(),
      supportsSSHWindowCreation: vi.fn(() => true),
      listSSHProfiles: vi.fn(() => ({ profiles: [] })),
    };
    const harness = createHarness('mobile.control', { stateProvider });

    const response = await dispatch(harness, REMOTE_METHODS.SSH_PROFILE_LIST);

    expect(response).toMatchObject({
      ok: false,
      error: { code: REMOTE_ERROR_CODES.FORBIDDEN },
    });
    expect(stateProvider.listSSHProfiles).not.toHaveBeenCalled();
  });

  it('stops windows and panes through the state provider for window-control devices', async () => {
    const stateProvider = {
      listWindows: vi.fn(),
      listPanes: vi.fn(),
      startWindow: vi.fn(),
      createWindow: vi.fn(),
      closeWindow: vi.fn(() => ({
        window: {
          windowId: 'win-1',
          name: 'Project',
          panes: [],
        },
        stoppedPanes: [],
      })),
      closePane: vi.fn(() => ({
        window: {
          windowId: 'win-1',
          name: 'Project',
          panes: [],
        },
        pane: {
          windowId: 'win-1',
          paneId: 'pane-1',
          kind: 'terminal',
          running: false,
        },
      })),
    };
    const harness = createHarness('mobile.window-control', { stateProvider });

    const windowResponse = await dispatch(harness, REMOTE_METHODS.WINDOW_CLOSE, {
      windowId: 'win-1',
    });
    const paneResponse = await dispatch(harness, REMOTE_METHODS.PANE_CLOSE, {
      windowId: 'win-1',
      paneId: 'pane-1',
    });

    expect(windowResponse).toMatchObject({
      ok: true,
      result: { window: { windowId: 'win-1' } },
    });
    expect(paneResponse).toMatchObject({
      ok: true,
      result: { pane: { paneId: 'pane-1', running: false } },
    });
    expect(stateProvider.closeWindow).toHaveBeenCalledWith({ windowId: 'win-1' });
    expect(stateProvider.closePane).toHaveBeenCalledWith({ windowId: 'win-1', paneId: 'pane-1' });
  });

  it('deletes panes and removes grouped windows through structural window-control RPCs', async () => {
    const replacementPane = {
      windowId: 'win-1',
      paneId: 'pane-2',
      kind: 'terminal',
      running: true,
    };
    const stateProvider = {
      listWindows: vi.fn(),
      listPanes: vi.fn(),
      deletePane: vi.fn(() => ({
        deleted: true,
        deletedPaneId: 'pane-1',
        window: {
          windowId: 'win-1',
          name: 'Project',
          panes: [replacementPane],
        },
        replacementPane,
      })),
      removeWindowFromGroup: vi.fn(() => ({
        removed: true,
        groupId: 'group-1',
        windowId: 'win-1',
        dissolved: false,
        group: null,
        replacementWindow: {
          windowId: 'win-2',
          name: 'Peer',
          panes: [],
        },
        replacementPane: null,
      })),
    };
    const harness = createHarness('mobile.window-control', { stateProvider });

    const paneResponse = await dispatch(harness, REMOTE_METHODS.PANE_DELETE, {
      windowId: 'win-1',
      paneId: 'pane-1',
    });
    const groupResponse = await dispatch(harness, REMOTE_METHODS.GROUP_WINDOW_REMOVE, {
      groupId: 'group-1',
      windowId: 'win-1',
    });

    expect(paneResponse).toMatchObject({
      ok: true,
      result: { deleted: true, replacementPane: { paneId: 'pane-2' } },
    });
    expect(groupResponse).toMatchObject({
      ok: true,
      result: { removed: true, groupId: 'group-1', windowId: 'win-1' },
    });
    expect(stateProvider.deletePane).toHaveBeenCalledWith({
      windowId: 'win-1',
      paneId: 'pane-1',
    });
    expect(stateProvider.removeWindowFromGroup).toHaveBeenCalledWith({
      groupId: 'group-1',
      windowId: 'win-1',
    });
  });

  it('deletes windows and manages groups through the state provider for window-control devices', async () => {
    const stateProvider = {
      listWindows: vi.fn(),
      listPanes: vi.fn(),
      startWindow: vi.fn(),
      createWindow: vi.fn(),
      closeWindow: vi.fn(),
      closePane: vi.fn(),
      deleteWindow: vi.fn(() => ({
        deleted: true,
        windowId: 'win-1',
        groups: [],
      })),
      createGroup: vi.fn(() => ({
        group: {
          groupId: 'group-1',
          name: 'Phone Group',
          archived: false,
          activeWindowId: 'win-1',
          createdAt: '2026-07-08T00:00:00.000Z',
          lastActiveAt: '2026-07-08T00:00:00.000Z',
          windowCount: 2,
          layout: {
            type: 'split',
            direction: 'horizontal',
            sizes: [0.5, 0.5],
            children: [
              { type: 'window', id: 'win-1' },
              { type: 'window', id: 'win-2' },
            ],
          },
          windows: [],
        },
      })),
      deleteGroup: vi.fn(() => ({
        deleted: true,
        groupId: 'group-1',
      })),
    };
    const harness = createHarness('mobile.window-control', { stateProvider });

    const deleteWindowResponse = await dispatch(harness, REMOTE_METHODS.WINDOW_DELETE, {
      windowId: 'win-1',
    });
    const createGroupResponse = await dispatch(harness, REMOTE_METHODS.GROUP_CREATE, {
      name: 'Phone Group',
      windowIds: ['win-1', 'win-2'],
    });
    const deleteGroupResponse = await dispatch(harness, REMOTE_METHODS.GROUP_DELETE, {
      groupId: 'group-1',
    });

    expect(deleteWindowResponse).toMatchObject({
      ok: true,
      result: { deleted: true, windowId: 'win-1' },
    });
    expect(createGroupResponse).toMatchObject({
      ok: true,
      result: { group: { groupId: 'group-1', name: 'Phone Group' } },
    });
    expect(deleteGroupResponse).toMatchObject({
      ok: true,
      result: { deleted: true, groupId: 'group-1' },
    });
    expect(stateProvider.deleteWindow).toHaveBeenCalledWith({ windowId: 'win-1' });
    expect(stateProvider.createGroup).toHaveBeenCalledWith({
      name: 'Phone Group',
      windowIds: ['win-1', 'win-2'],
    });
    expect(stateProvider.deleteGroup).toHaveBeenCalledWith({ groupId: 'group-1' });
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
      createWindow: vi.fn(),
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
          REMOTE_METHODS.PANE_CLOSE,
          REMOTE_METHODS.PANE_DELETE,
          REMOTE_METHODS.GROUP_WINDOW_REMOVE,
          REMOTE_METHODS.DEVICE_REVOKE,
        ]),
      },
    });
  });
});
