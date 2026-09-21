import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerPaneHandlers } from '../paneHandlers';
import type { HandlerContext } from '../HandlerContext';
import type { TerminalConfig } from '../../types/process';

const { mockIpcHandle } = vi.hoisted(() => ({
  mockIpcHandle: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: mockIpcHandle,
  },
}));

const { disposeAgentTaskForPaneMock } = vi.hoisted(() => ({
  disposeAgentTaskForPaneMock: vi.fn(),
}));

vi.mock('../agentHandlers', () => ({
  disposeAgentTaskForPane: disposeAgentTaskForPaneMock,
}));

function getRegisteredHandler(channel: string) {
  const call = mockIpcHandle.mock.calls.find(([name]) => name === channel);
  expect(call, `IPC handler ${channel} should be registered`).toBeTruthy();
  return call?.[1] as (event: unknown, payload: unknown) => Promise<unknown>;
}

describe('registerPaneHandlers', () => {
  beforeEach(() => {
    mockIpcHandle.mockReset();
    disposeAgentTaskForPaneMock.mockReset();
  });

  it('registers split-pane created PTY with StatusPoller', async () => {
    const unsubscribe = vi.fn();
    const processManager = {
      spawnTerminal: vi.fn().mockResolvedValue({ pid: 321, sessionId: 'session-321' }),
      subscribePtyData: vi.fn().mockReturnValue(unsubscribe),
      listProcesses: vi.fn().mockReturnValue([]),
      killProcess: vi.fn(),
    };
    const statusPoller = {
      addPane: vi.fn(),
      removePane: vi.fn(),
    };
    const ptySubscriptionManager = {
      add: vi.fn(),
      remove: vi.fn(),
    };
    const mainWindow = {
      isDestroyed: vi.fn().mockReturnValue(false),
      webContents: {
        send: vi.fn(),
      },
    };
    const ctx = {
      mainWindow,
      processManager,
      statusPoller,
      ptySubscriptionManager,
    } as unknown as HandlerContext;

    registerPaneHandlers(ctx);
    const splitPaneHandler = getRegisteredHandler('split-pane');
    const config: TerminalConfig = {
      workingDirectory: 'D:\\repo',
      windowId: 'win-1',
      paneId: 'pane-2',
      command: 'pwsh.exe',
    };

    const response = await splitPaneHandler({}, config) as { success: boolean; data?: { pid: number; sessionId: string } };

    expect(processManager.spawnTerminal).toHaveBeenCalledWith(config);
    expect(statusPoller.addPane).toHaveBeenCalledWith('win-1', 'pane-2', 321);
    expect(processManager.subscribePtyData).toHaveBeenCalledWith(321, expect.any(Function));
    expect(ptySubscriptionManager.add).toHaveBeenCalledWith('pane-2', unsubscribe);
    expect(response).toEqual({
      success: true,
      data: { pid: 321, sessionId: 'session-321' },
    });

    const outputSubscriber = processManager.subscribePtyData.mock.calls[0]?.[1];
    expect(outputSubscriber).toBeTypeOf('function');

    outputSubscriber?.('pwd\r\n', 7);
    await new Promise((resolve) => setImmediate(resolve));

    expect(mainWindow.webContents.send).toHaveBeenCalledWith('pty-data', {
      windowId: 'win-1',
      paneId: 'pane-2',
      data: 'pwd\r\n',
      seq: 7,
    });
  });

  it('removes closed pane from StatusPoller', async () => {
    const processManager = {
      spawnTerminal: vi.fn(),
      subscribePtyData: vi.fn(),
      listProcesses: vi.fn().mockReturnValue([
        {
          windowId: 'win-1',
          paneId: 'pane-2',
          pid: 321,
        },
      ]),
      killProcess: vi.fn().mockResolvedValue(undefined),
    };
    const statusPoller = {
      addPane: vi.fn(),
      removePane: vi.fn(),
    };
    const ptySubscriptionManager = {
      add: vi.fn(),
      remove: vi.fn(),
    };
    const ctx = {
      mainWindow: null,
      processManager,
      statusPoller,
      ptySubscriptionManager,
    } as unknown as HandlerContext;

    registerPaneHandlers(ctx);
    const closePaneHandler = getRegisteredHandler('close-pane');

    const response = await closePaneHandler({}, {
      windowId: 'win-1',
      paneId: 'pane-2',
    }) as { success: boolean };

    expect(ptySubscriptionManager.remove).toHaveBeenCalledWith('pane-2');
    expect(statusPoller.removePane).toHaveBeenCalledWith('pane-2');
    expect(disposeAgentTaskForPaneMock).toHaveBeenCalledWith('pane-2');
    expect(processManager.killProcess).toHaveBeenCalledWith(321);
    expect(response).toEqual({ success: true, data: undefined });
  });

  it('does not clear pane state when close-pane cannot resolve the requested window and pane', async () => {
    const processManager = {
      spawnTerminal: vi.fn(),
      subscribePtyData: vi.fn(),
      listProcesses: vi.fn().mockReturnValue([
        {
          windowId: 'win-other',
          paneId: 'pane-2',
          pid: 654,
        },
      ]),
      killProcess: vi.fn(),
    };
    const statusPoller = {
      addPane: vi.fn(),
      removePane: vi.fn(),
    };
    const ptySubscriptionManager = {
      add: vi.fn(),
      remove: vi.fn(),
    };
    const ctx = {
      mainWindow: null,
      processManager,
      statusPoller,
      ptySubscriptionManager,
    } as unknown as HandlerContext;

    registerPaneHandlers(ctx);
    const closePaneHandler = getRegisteredHandler('close-pane');

    const response = await closePaneHandler({}, {
      windowId: 'win-1',
      paneId: 'pane-2',
    }) as { success: boolean };

    expect(processManager.killProcess).not.toHaveBeenCalled();
    expect(ptySubscriptionManager.remove).not.toHaveBeenCalled();
    expect(statusPoller.removePane).not.toHaveBeenCalled();
    expect(disposeAgentTaskForPaneMock).not.toHaveBeenCalled();
    expect(response).toEqual({ success: true, data: undefined });
  });
});
