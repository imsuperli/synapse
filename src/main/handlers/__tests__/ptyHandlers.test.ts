import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerPtyHandlers } from '../ptyHandlers';
import type { HandlerContext } from '../HandlerContext';

const { mockIpcHandle } = vi.hoisted(() => ({
  mockIpcHandle: vi.fn(),
}));

const { mockIpcOn } = vi.hoisted(() => ({
  mockIpcOn: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: mockIpcHandle,
    on: mockIpcOn,
  },
}));

function getRegisteredHandler(channel: string) {
  const call = mockIpcHandle.mock.calls.find(([name]) => name === channel);
  expect(call, `IPC handler ${channel} should be registered`).toBeTruthy();
  return call?.[1] as (event: unknown, payload: unknown) => Promise<unknown>;
}

function getRegisteredListener(channel: string) {
  const call = mockIpcOn.mock.calls.find(([name]) => name === channel);
  expect(call, `IPC listener ${channel} should be registered`).toBeTruthy();
  return call?.[1] as (event: unknown, payload: unknown) => void;
}

describe('registerPtyHandlers', () => {
  beforeEach(() => {
    mockIpcHandle.mockReset();
    mockIpcOn.mockReset();
  });

  it('returns pane PTY history from ProcessManager', async () => {
    const processManager = {
      getPidByPane: vi.fn(),
      listProcesses: vi.fn(),
      writeToPty: vi.fn(),
      resizePty: vi.fn(),
      getPtyHistory: vi.fn().mockReturnValue({
        chunks: ['line-1', 'line-2'],
        firstSeq: 1,
        lastSeq: 2,
        evictedBeforeSeq: 0,
      }),
    };
    const ctx = {
      processManager,
    } as unknown as HandlerContext;

    registerPtyHandlers(ctx);
    const historyHandler = getRegisteredHandler('get-pty-history');

    const response = await historyHandler({}, { paneId: 'pane-1' }) as {
      success: boolean;
      data?: { chunks: string[]; firstSeq: number; lastSeq: number; evictedBeforeSeq: number };
    };

    expect(processManager.getPtyHistory).toHaveBeenCalledWith('pane-1');
    expect(response).toEqual({
      success: true,
      data: {
        chunks: ['line-1', 'line-2'],
        firstSeq: 1,
        lastSeq: 2,
        evictedBeforeSeq: 0,
      },
    });
  });

  it('records renderer terminal screen snapshots without writing to the PTY', () => {
    const processManager = {
      getPidByPane: vi.fn(),
      listProcesses: vi.fn(),
      writeToPty: vi.fn(),
      resizePty: vi.fn(),
      getPtyHistory: vi.fn(),
      updateTerminalScreenSnapshot: vi.fn(),
    };
    const ctx = {
      processManager,
    } as unknown as HandlerContext;

    registerPtyHandlers(ctx);
    const snapshotListener = getRegisteredListener('terminal-screen-snapshot:update');
    const snapshot = {
      windowId: 'win-1',
      paneId: 'pane-1',
      cols: 120,
      rows: 30,
      cursorX: 2,
      cursorY: 5,
      alternate: true,
      data: '\u001b[?1049h\u001b[2J\u001b[Hworking',
      capturedAt: '2026-07-11T10:30:00.000Z',
    };

    snapshotListener({}, snapshot);

    expect(processManager.updateTerminalScreenSnapshot).toHaveBeenCalledWith(snapshot);
    expect(processManager.writeToPty).not.toHaveBeenCalled();
  });

  it('forwards PTY writes to tmux compat when protocol replies are current', async () => {
    const processManager = {
      getPidByPane: vi.fn().mockReturnValue(1234),
      listProcesses: vi.fn(),
      writeToPty: vi.fn(),
      resizePty: vi.fn(),
      getPtyHistory: vi.fn(),
    };
    const tmuxCompatService = {
      shouldForwardRendererInput: vi.fn().mockReturnValue(true),
      notifyPaneInputWritten: vi.fn(),
    };
    const ctx = {
      processManager,
      tmuxCompatService,
    } as unknown as HandlerContext;

    registerPtyHandlers(ctx);
    const writeHandler = getRegisteredHandler('pty-write');

    const response = await writeHandler({}, {
      windowId: 'win-1',
      paneId: 'pane-1',
      data: '\u001b[?1;2c',
      metadata: { source: 'xterm.onData' },
    }) as { success: boolean };

    expect(tmuxCompatService.shouldForwardRendererInput).toHaveBeenCalledWith(
      'win-1',
      'pane-1',
      '\u001b[?1;2c',
      { source: 'xterm.onData' },
    );
    expect(processManager.writeToPty).toHaveBeenCalledWith(1234, '\u001b[?1;2c');
    expect(tmuxCompatService.notifyPaneInputWritten).toHaveBeenCalledWith(
      'win-1',
      'pane-1',
      '\u001b[?1;2c',
      { source: 'xterm.onData' },
    );
    expect(response).toEqual({ success: true, data: undefined });
  });

  it('suppresses stale renderer protocol replies while still notifying tmux compat', async () => {
    const processManager = {
      getPidByPane: vi.fn().mockReturnValue(1234),
      listProcesses: vi.fn(),
      writeToPty: vi.fn(),
      resizePty: vi.fn(),
      getPtyHistory: vi.fn(),
    };
    const tmuxCompatService = {
      shouldForwardRendererInput: vi.fn().mockReturnValue(false),
      notifyPaneInputWritten: vi.fn(),
    };
    const ctx = {
      processManager,
      tmuxCompatService,
    } as unknown as HandlerContext;

    registerPtyHandlers(ctx);
    const writeHandler = getRegisteredHandler('pty-write');

    const response = await writeHandler({}, {
      windowId: 'win-1',
      paneId: 'pane-1',
      data: '\u001b[?1;2c',
      metadata: { source: 'xterm.onData' },
    }) as { success: boolean };

    expect(processManager.writeToPty).not.toHaveBeenCalled();
    expect(tmuxCompatService.notifyPaneInputWritten).toHaveBeenCalledWith(
      'win-1',
      'pane-1',
      '\u001b[?1;2c',
      { source: 'xterm.onData' },
    );
    expect(response).toEqual({ success: true, data: undefined });
  });
});
