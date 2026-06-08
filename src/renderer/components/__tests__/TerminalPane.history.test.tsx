import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetTerminalPaneReplaySessionCacheForTests, TerminalPane } from '../TerminalPane';
import { WindowStatus } from '../../types/window';
import { subscribeToPanePtyData } from '../../api/ptyDataBus';
import { useWindowStore } from '../../stores/windowStore';
import type { PtyDataPayload, PtyKeyboardProtocolState } from '../../../shared/types/electron-api';

const OSC8_CLOSE = '\u001b]8;;\u0007';

const { terminalInstances, ptyCallbacks, terminalDataCallbacks, terminalScrollCallbacks, requestAnimationFrameMock, cancelAnimationFrameMock } = vi.hoisted(() => ({
  terminalInstances: [] as Array<{
    loadAddon: ReturnType<typeof vi.fn>;
    registerLinkProvider: ReturnType<typeof vi.fn>;
    open: ReturnType<typeof vi.fn>;
    focus: ReturnType<typeof vi.fn>;
    blur: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
    paste: ReturnType<typeof vi.fn>;
    reset: ReturnType<typeof vi.fn>;
    getSelection: ReturnType<typeof vi.fn>;
    onData: ReturnType<typeof vi.fn>;
    onSelectionChange: ReturnType<typeof vi.fn>;
    onScroll: ReturnType<typeof vi.fn>;
    scrollToLine: ReturnType<typeof vi.fn>;
    attachCustomKeyEventHandler: ReturnType<typeof vi.fn>;
    options: Record<string, unknown>;
    modes: {
      bracketedPasteMode: boolean;
    };
    buffer: {
      active: {
        viewportY: number;
        baseY: number;
      };
    };
    _core: {
      coreService: {
        decPrivateModes: {
          applicationCursorKeys: boolean;
          applicationKeypad: boolean;
          bracketedPasteMode: boolean;
          sendFocus: boolean;
          win32InputMode: boolean;
        };
        kittyKeyboard: {
          flags: number;
          mainFlags: number;
          altFlags: number;
          mainStack: number[];
          altStack: number[];
        };
      };
      coreMouseService: {
        activeProtocol: string;
        activeEncoding: string;
      };
    };
    cols: number;
    rows: number;
  }>,
  ptyCallbacks: [] as Array<(payload: PtyDataPayload) => void>,
  terminalDataCallbacks: [] as Array<(data: string) => void>,
  terminalScrollCallbacks: [] as Array<(viewportY: number) => void>,
  requestAnimationFrameMock: vi.fn((callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  }),
  cancelAnimationFrameMock: vi.fn(),
}));

vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn(function MockTerminal(this: unknown, options?: Record<string, unknown>) {
    const coreService = {
      decPrivateModes: {
        applicationCursorKeys: false,
        applicationKeypad: false,
        bracketedPasteMode: false,
        sendFocus: false,
        win32InputMode: false,
      },
      kittyKeyboard: {
        flags: 0,
        mainFlags: 0,
        altFlags: 0,
        mainStack: [] as number[],
        altStack: [] as number[],
      },
    };
    const coreMouseService = {
      activeProtocol: 'NONE',
      activeEncoding: 'DEFAULT',
    };
    const instance = {
      loadAddon: vi.fn(),
      registerLinkProvider: vi.fn(() => ({ dispose: vi.fn() })),
      open: vi.fn(),
      focus: vi.fn(),
      blur: vi.fn(),
      dispose: vi.fn(),
      write: vi.fn((data: string, callback?: () => void) => {
        const privateModePattern = /\u001b\[\?([0-9;]*)([hl])/g;
        let privateModeMatch: RegExpExecArray | null;
        while ((privateModeMatch = privateModePattern.exec(data)) !== null) {
          const isSet = privateModeMatch[2] === 'h';
          for (const param of privateModeMatch[1].split(';').map((value) => Number(value))) {
            switch (param) {
              case 1:
                coreService.decPrivateModes.applicationCursorKeys = isSet;
                break;
              case 9:
                coreMouseService.activeProtocol = isSet ? 'X10' : 'NONE';
                break;
              case 66:
                coreService.decPrivateModes.applicationKeypad = isSet;
                break;
              case 1000:
                coreMouseService.activeProtocol = isSet ? 'VT200' : 'NONE';
                break;
              case 1002:
                coreMouseService.activeProtocol = isSet ? 'DRAG' : 'NONE';
                break;
              case 1003:
                coreMouseService.activeProtocol = isSet ? 'ANY' : 'NONE';
                break;
              case 1004:
                coreService.decPrivateModes.sendFocus = isSet;
                break;
              case 1006:
                coreMouseService.activeEncoding = isSet ? 'SGR' : 'DEFAULT';
                break;
              case 1016:
                coreMouseService.activeEncoding = isSet ? 'SGR_PIXELS' : 'DEFAULT';
                break;
              case 2004:
                coreService.decPrivateModes.bracketedPasteMode = isSet;
                break;
              case 9001:
                coreService.decPrivateModes.win32InputMode = isSet;
                break;
            }
          }
        }
        if (data.includes('\u001b=')) {
          coreService.decPrivateModes.applicationKeypad = true;
        }
        if (data.includes('\u001b>')) {
          coreService.decPrivateModes.applicationKeypad = false;
        }
        const kittySetPattern = /\u001b\[=([0-9]+)(?:;([0-9]+))?u/g;
        let kittySetMatch: RegExpExecArray | null;
        while ((kittySetMatch = kittySetPattern.exec(data)) !== null) {
          const flags = Number(kittySetMatch[1]) || 0;
          const mode = kittySetMatch[2] !== undefined ? Number(kittySetMatch[2]) || 1 : 1;
          switch (mode) {
            case 1:
              coreService.kittyKeyboard.flags = flags;
              break;
            case 2:
              coreService.kittyKeyboard.flags |= flags;
              break;
            case 3:
              coreService.kittyKeyboard.flags &= ~flags;
              break;
          }
        }
        if (data.includes('\u001b[c')) {
          terminalDataCallbacks.forEach((terminalDataCallback) => terminalDataCallback('\u001b[?1;2c'));
        }
        callback?.();
      }),
      paste: vi.fn((data: string) => {
        terminalDataCallbacks.forEach((terminalDataCallback) => terminalDataCallback(data));
      }),
      reset: vi.fn(),
      getSelection: vi.fn().mockReturnValue(''),
      onData: vi.fn((callback: (data: string) => void) => {
        terminalDataCallbacks.push(callback);
        return { dispose: vi.fn() };
      }),
      onSelectionChange: vi.fn(() => ({ dispose: vi.fn() })),
      onScroll: vi.fn((callback: (viewportY: number) => void) => {
        terminalScrollCallbacks.push(callback);
        return { dispose: vi.fn() };
      }),
      scrollToLine: vi.fn((line: number) => {
        instance.buffer.active.viewportY = line;
        terminalScrollCallbacks.forEach((callback) => callback(line));
      }),
      attachCustomKeyEventHandler: vi.fn(),
      options: { ...(options ?? {}) },
      modes: {
        get bracketedPasteMode() {
          return coreService.decPrivateModes.bracketedPasteMode;
        },
        set bracketedPasteMode(value: boolean) {
          coreService.decPrivateModes.bracketedPasteMode = value;
        },
      },
      _core: {
        coreService,
        coreMouseService,
      },
      buffer: {
        active: {
          viewportY: 0,
          baseY: 0,
        },
      },
      cols: 120,
      rows: 40,
    };
    terminalInstances.push(instance);
    return instance;
  }),
}));

vi.mock('../../utils/xtermAddonFit', () => ({
  FitAddon: vi.fn(function MockFitAddon() {
    return {
      fit: vi.fn(),
    };
  }),
}));

vi.mock('../../api/ptyDataBus', () => ({
  subscribeToPanePtyData: vi.fn((windowId: string, paneId: string, callback: (payload: PtyDataPayload) => void) => {
    ptyCallbacks.push(callback);
    return vi.fn();
  }),
}));

vi.mock('../../styles/xterm.css', () => ({}));

function createKeyboardState(overrides: Partial<PtyKeyboardProtocolState> = {}): PtyKeyboardProtocolState {
  return {
    applicationCursorKeysMode: overrides.applicationCursorKeysMode ?? false,
    applicationKeypadMode: overrides.applicationKeypadMode ?? false,
    bracketedPasteMode: overrides.bracketedPasteMode ?? false,
    sendFocusMode: overrides.sendFocusMode ?? false,
    win32InputMode: overrides.win32InputMode ?? false,
    mouseTracking: {
      protocol: overrides.mouseTracking?.protocol ?? 'NONE',
      encoding: overrides.mouseTracking?.encoding ?? 'DEFAULT',
    },
    kittyKeyboard: {
      flags: overrides.kittyKeyboard?.flags ?? 0,
      mainFlags: overrides.kittyKeyboard?.mainFlags ?? 0,
      altFlags: overrides.kittyKeyboard?.altFlags ?? 0,
      mainStack: overrides.kittyKeyboard?.mainStack ?? [],
      altStack: overrides.kittyKeyboard?.altStack ?? [],
    },
  };
}

describe('TerminalPane history replay', () => {
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;

  beforeEach(() => {
    vi.clearAllMocks();
    __resetTerminalPaneReplaySessionCacheForTests();
    terminalInstances.length = 0;
    ptyCallbacks.length = 0;
    terminalDataCallbacks.length = 0;
    terminalScrollCallbacks.length = 0;
    useWindowStore.setState({
      windows: [],
      activeWindowId: null,
      mruList: [],
      sidebarExpanded: false,
      sidebarWidth: 200,
      groups: [],
      activeGroupId: null,
      groupMruList: [],
      customCategories: [],
      terminalSidebarSections: {
        archived: false,
        local: true,
        ssh: true,
      },
      terminalSidebarFilter: 'all',
    });
    vi.mocked(window.electronAPI.getPtyHistory).mockReset();
    vi.mocked(window.electronAPI.ptyWrite).mockReset();
    vi.mocked(window.electronAPI.ptyResize).mockReset();
    requestAnimationFrameMock.mockClear();
    cancelAnimationFrameMock.mockClear();
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrameMock);
    vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrameMock);
    vi.mocked(window.electronAPI.ptyWrite).mockResolvedValue(undefined);
    vi.mocked(window.electronAPI.ptyResize).mockResolvedValue(undefined);
    vi.mocked(window.electronAPI.getPtyHistory).mockResolvedValue({
      success: true,
      data: { chunks: ['history-1', 'history-2'], lastSeq: 2 },
    });
  });

  afterEach(() => {
    cleanup();
    if (originalRequestAnimationFrame) {
      vi.stubGlobal('requestAnimationFrame', originalRequestAnimationFrame);
    }
    if (originalCancelAnimationFrame) {
      vi.stubGlobal('cancelAnimationFrame', originalCancelAnimationFrame);
    }
  });

  it('lets the global appearance skin show through the xterm background', async () => {
    render(
      <TerminalPane
        windowId="win-1"
        pane={{
          id: 'pane-1',
          cwd: 'D:\\tmp',
          command: 'pwsh.exe',
          status: WindowStatus.Running,
          pid: 1234,
        }}
        isActive
        isWindowActive
        onActivate={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(terminalInstances).toHaveLength(1);
    });

    expect(terminalInstances[0].options.allowTransparency).toBe(true);
    expect((terminalInstances[0].options.theme as { background?: string }).background).toBe('transparent');
  });

  it('does not report a process exit when mounted with an already completed pane', async () => {
    const onProcessExit = vi.fn();

    render(
      <TerminalPane
        windowId="win-1"
        pane={{
          id: 'pane-1',
          cwd: 'D:\\tmp',
          command: 'pwsh.exe',
          status: WindowStatus.Completed,
          pid: null,
        }}
        isActive
        isWindowActive
        onActivate={vi.fn()}
        onProcessExit={onProcessExit}
      />,
    );

    await waitFor(() => {
      expect(terminalInstances).toHaveLength(1);
    });

    expect(onProcessExit).not.toHaveBeenCalled();
  });

  it('reports a process exit when a live pane transitions to completed', async () => {
    const onProcessExit = vi.fn();
    const { rerender } = render(
      <TerminalPane
        windowId="win-1"
        pane={{
          id: 'pane-1',
          cwd: 'D:\\tmp',
          command: 'pwsh.exe',
          status: WindowStatus.Running,
          pid: 1234,
        }}
        isActive
        isWindowActive
        onActivate={vi.fn()}
        onProcessExit={onProcessExit}
      />,
    );

    await waitFor(() => {
      expect(terminalInstances).toHaveLength(1);
    });
    expect(onProcessExit).not.toHaveBeenCalled();

    rerender(
      <TerminalPane
        windowId="win-1"
        pane={{
          id: 'pane-1',
          cwd: 'D:\\tmp',
          command: 'pwsh.exe',
          status: WindowStatus.Completed,
          pid: null,
        }}
        isActive
        isWindowActive
        onActivate={vi.fn()}
        onProcessExit={onProcessExit}
      />,
    );

    await waitFor(() => {
      expect(onProcessExit).toHaveBeenCalledTimes(1);
    });
  });

  it('enables enhanced keyboard reporting for Windows PTYs', async () => {
    render(
      <TerminalPane
        windowId="win-1"
        pane={{
          id: 'pane-1',
          cwd: 'D:\\tmp',
          command: 'pwsh.exe',
          status: WindowStatus.Running,
          pid: 1234,
        }}
        isActive
        isWindowActive
        onActivate={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(terminalInstances).toHaveLength(1);
    });

    expect(terminalInstances[0].options.vtExtensions).toMatchObject({
      kittyKeyboard: true,
      win32InputMode: true,
    });
    expect(terminalInstances[0].options.windowsPty).toEqual({
      backend: 'conpty',
    });
  });

  it('avoids applying Windows-specific PTY hints on macOS', async () => {
    const originalPlatform = window.electronAPI.platform;
    (window.electronAPI as { platform: string }).platform = 'darwin';

    try {
      render(
        <TerminalPane
          windowId="win-mac"
          pane={{
            id: 'pane-mac',
            cwd: '/tmp',
            command: 'zsh',
            status: WindowStatus.Running,
            pid: 4321,
          }}
          isActive
          isWindowActive
          onActivate={vi.fn()}
        />,
      );

      await waitFor(() => {
        expect(terminalInstances).toHaveLength(1);
      });

      expect(terminalInstances[0].options.vtExtensions).toMatchObject({
        kittyKeyboard: true,
      });
      expect((terminalInstances[0].options.vtExtensions as { win32InputMode?: boolean }).win32InputMode).toBeUndefined();
      expect(terminalInstances[0].options.windowsPty).toBeUndefined();
    } finally {
      (window.electronAPI as { platform: string }).platform = originalPlatform;
    }
  });

  it('replays history on mount and subscribes without buffered replay', async () => {
    render(
      <TerminalPane
        windowId="win-1"
        pane={{
          id: 'pane-1',
          cwd: 'D:\\tmp',
          command: 'pwsh.exe',
          status: WindowStatus.Running,
          pid: 1234,
        }}
        isActive
        isWindowActive
        onActivate={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(window.electronAPI.getPtyHistory).toHaveBeenCalledWith('pane-1');
    });

    expect(subscribeToPanePtyData).toHaveBeenCalledWith(
      'win-1',
      'pane-1',
      expect.any(Function),
      { replayBuffered: false },
    );

    await waitFor(() => {
      expect(terminalInstances[0]?.write).toHaveBeenCalledWith('history-1history-2', expect.any(Function));
    });
  });

  it('writes a small live chunk immediately after idle instead of waiting for the next animation frame', async () => {
    vi.mocked(window.electronAPI.getPtyHistory).mockResolvedValue({
      success: true,
      data: { chunks: [], lastSeq: 0 },
    });

    render(
      <TerminalPane
        windowId="win-1"
        pane={{
          id: 'pane-1',
          cwd: 'D:\\tmp',
          command: 'pwsh.exe',
          status: WindowStatus.Running,
          pid: 1234,
        }}
        isActive
        isWindowActive
        onActivate={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(subscribeToPanePtyData).toHaveBeenCalledWith(
        'win-1',
        'pane-1',
        expect.any(Function),
        { replayBuffered: false },
      );
    });

    requestAnimationFrameMock.mockClear();
    terminalInstances[0].write.mockClear();

    ptyCallbacks[0]({
      windowId: 'win-1',
      paneId: 'pane-1',
      data: 'a',
      seq: 1,
    });

    expect(terminalInstances[0].write).toHaveBeenCalledWith('a');
    expect(requestAnimationFrameMock).not.toHaveBeenCalled();
  });

  it('tracks ssh cwd updates as runtime-only without triggering auto-save', async () => {
    const sshPane = {
      id: 'pane-ssh',
      cwd: '/srv/app',
      command: '',
      status: WindowStatus.WaitingForInput,
      pid: 1234,
      backend: 'ssh' as const,
      ssh: {
        profileId: 'profile-1',
        remoteCwd: '/srv/app',
      },
    };

    useWindowStore.setState({
      windows: [
        {
          id: 'win-ssh',
          name: 'Prod SSH',
          layout: {
            type: 'pane',
            id: 'pane-ssh',
            pane: { ...sshPane },
          },
          activePaneId: 'pane-ssh',
          createdAt: '2026-04-11T00:00:00.000Z',
          lastActiveAt: '2026-04-11T00:00:00.000Z',
        },
      ],
      activeWindowId: 'win-ssh',
      mruList: ['win-ssh'],
    });

    render(
      <TerminalPane
        windowId="win-ssh"
        pane={sshPane}
        isActive
        isWindowActive
        onActivate={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(ptyCallbacks.length).toBeGreaterThanOrEqual(2);
    });

    for (const callback of ptyCallbacks) {
      callback({
        windowId: 'win-ssh',
        paneId: 'pane-ssh',
        data: '\u001b]633;P;Cwd=/srv/app/releases\u0007',
        seq: 1,
      });
    }

    await waitFor(() => {
      expect(useWindowStore.getState().getPaneById('win-ssh', 'pane-ssh')?.cwd).toBe('/srv/app/releases');
    });

    expect(window.electronAPI.triggerAutoSave).not.toHaveBeenCalled();
  });

  it('deduplicates live output that is already covered by the history snapshot', async () => {
    let resolveHistory: ((value: { success: true; data: { chunks: string[]; lastSeq: number } }) => void) | null = null;

    vi.mocked(window.electronAPI.getPtyHistory).mockImplementation(
      () => new Promise((resolve) => {
        resolveHistory = resolve;
      }),
    );

    render(
      <TerminalPane
        windowId="win-1"
        pane={{
          id: 'pane-1',
          cwd: 'D:\\tmp',
          command: 'pwsh.exe',
          status: WindowStatus.Running,
          pid: 1234,
        }}
        isActive
        isWindowActive
        onActivate={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(ptyCallbacks).toHaveLength(1);
    });

    ptyCallbacks[0]?.({ windowId: 'win-1', paneId: 'pane-1', data: 'history-2', seq: 2 });
    resolveHistory?.({
      success: true,
      data: { chunks: ['history-1', 'history-2'], lastSeq: 2 },
    });

    await waitFor(() => {
      expect(terminalInstances[0]?.write).toHaveBeenCalledWith('history-1history-2', expect.any(Function));
    });

    expect(terminalInstances[0]?.write).toHaveBeenCalledTimes(2);
  });

  it('suppresses startup protocol replies from the initial history replay', async () => {
    vi.mocked(window.electronAPI.getPtyHistory).mockResolvedValue({
      success: true,
      data: { chunks: ['\u001b[c'], lastSeq: 1 },
    });

    render(
      <TerminalPane
        windowId="win-1"
        pane={{
          id: 'pane-1',
          cwd: 'D:\\tmp',
          command: 'pwsh.exe',
          status: WindowStatus.Running,
          pid: 1234,
        }}
        isActive
        isWindowActive
        onActivate={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(terminalInstances[0]?.write).toHaveBeenCalled();
    });

    expect(window.electronAPI.ptyWrite).not.toHaveBeenCalledWith(
      'win-1',
      'pane-1',
      '\u001b[?1;2c',
      { source: 'xterm.onData' },
    );

    terminalDataCallbacks.forEach((terminalDataCallback) => terminalDataCallback('user input'));

    expect(window.electronAPI.ptyWrite).toHaveBeenCalledWith(
      'win-1',
      'pane-1',
      'user input',
      { source: 'xterm.onData' },
    );
  });

  it('does not forward xterm focus reports caused by app focus changes', async () => {
    vi.mocked(window.electronAPI.getPtyHistory).mockResolvedValue({
      success: true,
      data: { chunks: [], lastSeq: 0 },
    });

    const { rerender } = render(
      <TerminalPane
        windowId="win-focus-report"
        pane={{
          id: 'pane-focus-report',
          cwd: 'D:\\tmp',
          command: 'codex',
          status: WindowStatus.Running,
          pid: 1234,
        }}
        isActive
        isWindowActive={false}
        onActivate={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(terminalInstances).toHaveLength(1);
    });
    await waitFor(() => {
      expect(terminalInstances[0]?.write).toHaveBeenCalled();
    });

    vi.mocked(window.electronAPI.ptyWrite).mockClear();

    terminalDataCallbacks.forEach((terminalDataCallback) => terminalDataCallback('\u001b[O'));

    expect(window.electronAPI.ptyWrite).not.toHaveBeenCalledWith(
      'win-focus-report',
      'pane-focus-report',
      '\u001b[O',
      { source: 'xterm.onData' },
    );

    rerender(
      <TerminalPane
        windowId="win-focus-report"
        pane={{
          id: 'pane-focus-report',
          cwd: 'D:\\tmp',
          command: 'codex',
          status: WindowStatus.Running,
          pid: 1234,
        }}
        isActive
        isWindowActive
        onActivate={vi.fn()}
      />,
    );

    terminalDataCallbacks.forEach((terminalDataCallback) => terminalDataCallback('\u001b[I'));
    terminalDataCallbacks.forEach((terminalDataCallback) => terminalDataCallback('user input'));

    expect(window.electronAPI.ptyWrite).not.toHaveBeenCalledWith(
      'win-focus-report',
      'pane-focus-report',
      '\u001b[I',
      { source: 'xterm.onData' },
    );
    expect(window.electronAPI.ptyWrite).toHaveBeenCalledWith(
      'win-focus-report',
      'pane-focus-report',
      'user input',
      { source: 'xterm.onData' },
    );
  });

  it('registers terminal link handling and routes OSC 8 activation through electron', async () => {
    render(
      <TerminalPane
        windowId="win-1"
        pane={{
          id: 'pane-1',
          cwd: 'D:\\tmp',
          command: 'pwsh.exe',
          status: WindowStatus.Running,
          pid: 1234,
        }}
        isActive
        isWindowActive
        onActivate={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(terminalInstances[0]?.registerLinkProvider).toHaveBeenCalledTimes(1);
    });

    const linkHandler = terminalInstances[0]?.options.linkHandler as {
      activate: (event: MouseEvent, text: string) => void;
    };

    linkHandler.activate(new MouseEvent('mouseup'), 'https://example.com/docs');

    await waitFor(() => {
      expect(window.electronAPI.openExternalUrl).toHaveBeenCalledWith('https://example.com/docs');
    });
  });

  it('routes right-click paste through direct PTY writes with terminal CR line endings', async () => {
    vi.mocked(window.electronAPI.readClipboardText).mockResolvedValue({
      success: true,
      data: 'first line\r\nsecond line',
    });

    const { container } = render(
      <TerminalPane
        windowId="win-1"
        pane={{
          id: 'pane-1',
          cwd: 'D:\\tmp',
          command: 'pwsh.exe',
          status: WindowStatus.Running,
          pid: 1234,
        }}
        isActive
        isWindowActive
        onActivate={vi.fn()}
      />,
    );

    const terminalContainer = container.querySelector('.overflow-hidden');
    expect(terminalContainer).toBeTruthy();

    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    terminalContainer?.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);

    await waitFor(() => {
      expect(window.electronAPI.ptyWrite).toHaveBeenCalledWith(
        'win-1',
        'pane-1',
        'first line\rsecond line',
        { source: 'context-menu-paste' },
      );
    });
    expect(terminalInstances[0]?.paste).not.toHaveBeenCalled();
  });

  it('wraps right-click paste in bracketed paste mode when enabled', async () => {
    vi.mocked(window.electronAPI.readClipboardText).mockResolvedValue({
      success: true,
      data: 'first line\r\nsecond line',
    });

    const { container } = render(
      <TerminalPane
        windowId="win-1"
        pane={{
          id: 'pane-1',
          cwd: 'D:\\tmp',
          command: 'pwsh.exe',
          status: WindowStatus.Running,
          pid: 1234,
        }}
        isActive
        isWindowActive
        onActivate={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(terminalInstances).toHaveLength(1);
    });
    terminalInstances[0].modes.bracketedPasteMode = true;

    const terminalContainer = container.querySelector('.overflow-hidden');
    expect(terminalContainer).toBeTruthy();

    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    terminalContainer?.dispatchEvent(event);

    await waitFor(() => {
      expect(window.electronAPI.ptyWrite).toHaveBeenCalledWith(
        'win-1',
        'pane-1',
        '\u001b[200~first line\rsecond line\u001b[201~',
        { source: 'context-menu-paste' },
      );
    });
    expect(terminalInstances[0]?.paste).not.toHaveBeenCalled();
  });

  it('does not replay history again when a placeholder pane receives its first pid', async () => {
    const windowId = 'win-placeholder';
    const paneId = 'pane-placeholder';

    vi.mocked(window.electronAPI.getPtyHistory)
      .mockResolvedValueOnce({
        success: true,
        data: { chunks: [], lastSeq: 0 },
      })
      .mockResolvedValueOnce({
        success: true,
        data: { chunks: ['\u001b[c'], lastSeq: 1 },
      });

    const { rerender } = render(
      <TerminalPane
        windowId={windowId}
        pane={{
          id: paneId,
          cwd: 'D:\\tmp',
          command: 'pwsh.exe',
          status: WindowStatus.Restoring,
          pid: null,
        }}
        isActive
        isWindowActive
        onActivate={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(
        vi.mocked(window.electronAPI.getPtyHistory).mock.calls.filter(([id]) => id === paneId),
      ).toHaveLength(1);
    });

    rerender(
      <TerminalPane
        windowId={windowId}
        pane={{
          id: paneId,
          cwd: 'D:\\tmp',
          command: 'pwsh.exe',
          status: WindowStatus.Running,
          pid: 1234,
        }}
        isActive
        isWindowActive
        onActivate={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(
        vi.mocked(window.electronAPI.getPtyHistory).mock.calls.filter(([id]) => id === paneId),
      ).toHaveLength(1);
    });

    expect(terminalInstances[0]?.reset).not.toHaveBeenCalled();
    expect(window.electronAPI.ptyWrite).not.toHaveBeenCalledWith(
      windowId,
      paneId,
      '\u001b[?1;2c',
      { source: 'xterm.onData' },
    );
  });

  it('resets and replays a fresh session when a paused pane starts again with a new pid', async () => {
    const windowId = 'win-fresh';
    const paneId = 'pane-fresh';

    vi.mocked(window.electronAPI.getPtyHistory)
      .mockResolvedValueOnce({
        success: true,
        data: { chunks: ['old-output'], lastSeq: 1 },
      })
      .mockResolvedValueOnce({
        success: true,
        data: { chunks: ['new-output'], lastSeq: 1 },
      });

    const { rerender } = render(
      <TerminalPane
        windowId={windowId}
        pane={{
          id: paneId,
          cwd: 'D:\\tmp',
          command: 'pwsh.exe',
          status: WindowStatus.Running,
          pid: 1111,
        }}
        isActive
        isWindowActive
        onActivate={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(
        vi.mocked(window.electronAPI.getPtyHistory).mock.calls.filter(([id]) => id === paneId),
      ).toHaveLength(1);
    });
    await waitFor(() => {
      expect(terminalInstances[0]?.write).toHaveBeenCalledWith('old-output', expect.any(Function));
    });

    rerender(
      <TerminalPane
        windowId={windowId}
        pane={{
          id: paneId,
          cwd: 'D:\\tmp',
          command: 'pwsh.exe',
          status: WindowStatus.Paused,
          pid: null,
        }}
        isActive
        isWindowActive
        onActivate={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(terminalInstances[0]?.reset).toHaveBeenCalledTimes(1);
    });

    rerender(
      <TerminalPane
        windowId={windowId}
        pane={{
          id: paneId,
          cwd: 'D:\\tmp',
          command: 'pwsh.exe',
          status: WindowStatus.Running,
          pid: 2222,
        }}
        isActive
        isWindowActive
        onActivate={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(
        vi.mocked(window.electronAPI.getPtyHistory).mock.calls.filter(([id]) => id === paneId),
      ).toHaveLength(2);
    });

    expect(terminalInstances[0]?.reset).toHaveBeenCalledTimes(2);
    await waitFor(() => {
      expect(terminalInstances[0]?.write).toHaveBeenLastCalledWith('new-output', expect.any(Function));
    });
  });

  it('suppresses replay-generated DA replies after the same pane session remounts', async () => {
    const windowId = 'win-remount';
    const paneId = 'pane-remount';

    vi.mocked(window.electronAPI.getPtyHistory).mockResolvedValue({
      success: true,
      data: { chunks: ['\u001b[c'], lastSeq: 1 },
    });

    const { unmount } = render(
      <TerminalPane
        windowId={windowId}
        pane={{
          id: paneId,
          cwd: 'D:\\tmp',
          command: 'pwsh.exe',
          status: WindowStatus.Running,
          pid: 1234,
        }}
        isActive
        isWindowActive
        onActivate={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(terminalInstances[0]?.write).toHaveBeenCalled();
    });

    expect(window.electronAPI.ptyWrite).not.toHaveBeenCalledWith(
      windowId,
      paneId,
      '\u001b[?1;2c',
      { source: 'xterm.onData' },
    );

    vi.mocked(window.electronAPI.ptyWrite).mockClear();
    unmount();

    render(
      <TerminalPane
        windowId={windowId}
        pane={{
          id: paneId,
          cwd: 'D:\\tmp',
          command: 'pwsh.exe',
          status: WindowStatus.Running,
          pid: 1234,
        }}
        isActive
        isWindowActive
        onActivate={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(
        vi.mocked(window.electronAPI.getPtyHistory).mock.calls.filter(([id]) => id === paneId),
      ).toHaveLength(2);
    });

    expect(window.electronAPI.ptyWrite).not.toHaveBeenCalledWith(
      windowId,
      paneId,
      '\u001b[?1;2c',
      { source: 'xterm.onData' },
    );
  });

  it('replays keyboard protocol state on same-session remount without echoing query replies back into the PTY', async () => {
    const windowId = 'win-kitty-remount';
    const paneId = 'pane-kitty-remount';

    vi.mocked(window.electronAPI.getPtyHistory).mockResolvedValue({
      success: true,
      data: { chunks: ['before\u001b[?9001h\u001b[=5;2u\u001b[>3u\u001b[<1u\u001b[?uafter'], lastSeq: 1 },
    });

    const { unmount } = render(
      <TerminalPane
        windowId={windowId}
        pane={{
          id: paneId,
          cwd: 'D:\\tmp',
          command: 'pwsh.exe',
          status: WindowStatus.Running,
          pid: 4321,
        }}
        isActive
        isWindowActive
        onActivate={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(terminalInstances[0]?.write).toHaveBeenCalledWith(
        'before\u001b[?9001h\u001b[=5;2u\u001b[>3u\u001b[<1u\u001b[?uafter',
        expect.any(Function),
      );
    });

    unmount();

    render(
      <TerminalPane
        windowId={windowId}
        pane={{
          id: paneId,
          cwd: 'D:\\tmp',
          command: 'pwsh.exe',
          status: WindowStatus.Running,
          pid: 4321,
        }}
        isActive
        isWindowActive
        onActivate={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(terminalInstances[1]?.write).toHaveBeenCalledWith(
        'before\u001b[?9001h\u001b[=5;2u\u001b[>3u\u001b[<1uafter',
        expect.any(Function),
      );
    });

    expect(window.electronAPI.ptyWrite).not.toHaveBeenCalledWith(
      windowId,
      paneId,
      '\u001b[?5u',
      { source: 'xterm.onData' },
    );
  });

  it('closes stale OSC 8 state before replaying history', async () => {
    render(
      <TerminalPane
        windowId="win-osc8-reset"
        pane={{
          id: 'pane-osc8-reset',
          cwd: 'D:\\tmp',
          command: 'pwsh.exe',
          status: WindowStatus.Running,
          pid: 1234,
        }}
        isActive
        isWindowActive
        onActivate={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(terminalInstances[0]?.write.mock.calls[0]?.[0]).toBe(OSC8_CLOSE);
    });
    expect(terminalInstances[0]?.write.mock.calls[1]?.[0]).toBe('history-1history-2');
  });

  it('closes unterminated OSC 8 links during history replay before plain following lines', async () => {
    const osc8Open = '\u001b]8;;https://example.com/docs\u0007';
    vi.mocked(window.electronAPI.getPtyHistory).mockResolvedValue({
      success: true,
      data: { chunks: [`${osc8Open}docs`, '\nplain text'], lastSeq: 2 },
    });

    render(
      <TerminalPane
        windowId="win-osc8-history"
        pane={{
          id: 'pane-osc8-history',
          cwd: 'D:\\tmp',
          command: 'pwsh.exe',
          status: WindowStatus.Running,
          pid: 1234,
        }}
        isActive
        isWindowActive
        onActivate={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(terminalInstances[0]?.write).toHaveBeenCalledWith(
        `${osc8Open}docs${OSC8_CLOSE}\nplain text`,
        expect.any(Function),
      );
    });
  });

  it('closes unterminated OSC 8 links during history replay before full-screen cursor redraws', async () => {
    const osc8Open = '\u001b]8;;https://example.com/docs\u0007';
    vi.mocked(window.electronAPI.getPtyHistory).mockResolvedValue({
      success: true,
      data: { chunks: [`${osc8Open}docs`, '\u001b[12;1Hplain text'], lastSeq: 2 },
    });

    render(
      <TerminalPane
        windowId="win-osc8-cursor-redraw"
        pane={{
          id: 'pane-osc8-cursor-redraw',
          cwd: 'D:\\tmp',
          command: 'pwsh.exe',
          status: WindowStatus.Running,
          pid: 1234,
        }}
        isActive
        isWindowActive
        onActivate={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(terminalInstances[0]?.write).toHaveBeenCalledWith(
        `${osc8Open}docs${OSC8_CLOSE}\u001b[12;1Hplain text`,
        expect.any(Function),
      );
    });
  });

  it('closes split live OSC 8 links before writing following live lines', async () => {
    vi.mocked(window.electronAPI.getPtyHistory).mockResolvedValue({
      success: true,
      data: { chunks: [], lastSeq: 0 },
    });

    render(
      <TerminalPane
        windowId="win-osc8-live"
        pane={{
          id: 'pane-osc8-live',
          cwd: 'D:\\tmp',
          command: 'pwsh.exe',
          status: WindowStatus.Running,
          pid: 1234,
        }}
        isActive
        isWindowActive
        onActivate={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(ptyCallbacks).toHaveLength(1);
    });

    terminalInstances[0].write.mockClear();
    const osc8Open = '\u001b]8;;https://example.com/docs\u0007';
    ptyCallbacks[0]?.({ windowId: 'win-osc8-live', paneId: 'pane-osc8-live', data: `${osc8Open}docs`, seq: 1 });
    ptyCallbacks[0]?.({ windowId: 'win-osc8-live', paneId: 'pane-osc8-live', data: '\nplain text', seq: 2 });

    expect(terminalInstances[0]?.write).toHaveBeenCalledWith(`${osc8Open}docs`);
    expect(terminalInstances[0]?.write).toHaveBeenCalledWith(`${OSC8_CLOSE}\nplain text`);
  });

  it('closes split live OSC 8 links before cursor-positioned redraw output', async () => {
    vi.mocked(window.electronAPI.getPtyHistory).mockResolvedValue({
      success: true,
      data: { chunks: [], lastSeq: 0 },
    });

    render(
      <TerminalPane
        windowId="win-osc8-live-cursor"
        pane={{
          id: 'pane-osc8-live-cursor',
          cwd: 'D:\\tmp',
          command: 'pwsh.exe',
          status: WindowStatus.Running,
          pid: 1234,
        }}
        isActive
        isWindowActive
        onActivate={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(ptyCallbacks).toHaveLength(1);
    });

    terminalInstances[0].write.mockClear();
    const osc8Open = '\u001b]8;;https://example.com/docs\u0007';
    ptyCallbacks[0]?.({ windowId: 'win-osc8-live-cursor', paneId: 'pane-osc8-live-cursor', data: `${osc8Open}docs\u001b[`, seq: 1 });
    ptyCallbacks[0]?.({ windowId: 'win-osc8-live-cursor', paneId: 'pane-osc8-live-cursor', data: '12;1Hplain text', seq: 2 });

    expect(terminalInstances[0]?.write).toHaveBeenCalledWith(`${osc8Open}docs`);
    expect(terminalInstances[0]?.write).toHaveBeenCalledWith(`${OSC8_CLOSE}\u001b[12;1Hplain text`);
  });

  it('applies the pane keyboard state snapshot after replaying stale protocol sequences', async () => {
    const windowId = 'win-keyboard-snapshot';
    const paneId = 'pane-keyboard-snapshot';

    vi.mocked(window.electronAPI.getPtyHistory).mockResolvedValue({
      success: true,
      data: {
        chunks: ['before\u001b[?1;1004;1002;1006;2004;9001h\u001b=\u001b[=5uafter'],
        lastSeq: 1,
        keyboardState: createKeyboardState(),
      },
    });

    render(
      <TerminalPane
        windowId={windowId}
        pane={{
          id: paneId,
          cwd: 'D:\\tmp',
          command: 'pwsh.exe',
          status: WindowStatus.Running,
          pid: 1234,
        }}
        isActive
        isWindowActive
        onActivate={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(terminalInstances[0]?.write).toHaveBeenCalledWith(
        'before\u001b[?1;1004;1002;1006;2004;9001h\u001b=\u001b[=5uafter',
        expect.any(Function),
      );
    });

    await waitFor(() => {
      expect(terminalInstances[0]._core.coreService.decPrivateModes.win32InputMode).toBe(false);
    });
    expect(terminalInstances[0]._core.coreService.decPrivateModes.applicationCursorKeys).toBe(false);
    expect(terminalInstances[0]._core.coreService.decPrivateModes.applicationKeypad).toBe(false);
    expect(terminalInstances[0]._core.coreService.decPrivateModes.bracketedPasteMode).toBe(false);
    expect(terminalInstances[0]._core.coreService.decPrivateModes.sendFocus).toBe(false);
    expect(terminalInstances[0]._core.coreMouseService).toEqual({
      activeProtocol: 'NONE',
      activeEncoding: 'DEFAULT',
    });
    expect(terminalInstances[0]._core.coreService.kittyKeyboard).toEqual({
      flags: 0,
      mainFlags: 0,
      altFlags: 0,
      mainStack: [],
      altStack: [],
    });
  });

  it('preserves active pane keyboard protocol state after replaying history', async () => {
    const windowId = 'win-active-keyboard-snapshot';
    const paneId = 'pane-active-keyboard-snapshot';

    vi.mocked(window.electronAPI.getPtyHistory).mockResolvedValue({
      success: true,
      data: {
        chunks: ['prompt\u001b[?1;1004;1002;1006;2004;9001l\u001b>\u001b[=0u'],
        lastSeq: 1,
        keyboardState: createKeyboardState({
          applicationCursorKeysMode: true,
          applicationKeypadMode: true,
          bracketedPasteMode: true,
          sendFocusMode: true,
          win32InputMode: true,
          mouseTracking: {
            protocol: 'DRAG',
            encoding: 'SGR',
          },
          kittyKeyboard: {
            flags: 5,
            mainFlags: 5,
            altFlags: 3,
            mainStack: [1],
            altStack: [2],
          },
        }),
      },
    });

    render(
      <TerminalPane
        windowId={windowId}
        pane={{
          id: paneId,
          cwd: 'D:\\tmp',
          command: 'pwsh.exe',
          status: WindowStatus.Running,
          pid: 1234,
        }}
        isActive
        isWindowActive
        onActivate={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(terminalInstances[0]?.write).toHaveBeenCalledWith(
        'prompt\u001b[?1;1004;1002;1006;2004;9001l\u001b>\u001b[=0u',
        expect.any(Function),
      );
    });

    await waitFor(() => {
      expect(terminalInstances[0]._core.coreService.decPrivateModes.win32InputMode).toBe(true);
    });
    expect(terminalInstances[0]._core.coreService.decPrivateModes.applicationCursorKeys).toBe(true);
    expect(terminalInstances[0]._core.coreService.decPrivateModes.applicationKeypad).toBe(true);
    expect(terminalInstances[0]._core.coreService.decPrivateModes.bracketedPasteMode).toBe(true);
    expect(terminalInstances[0]._core.coreService.decPrivateModes.sendFocus).toBe(true);
    expect(terminalInstances[0]._core.coreMouseService).toEqual({
      activeProtocol: 'DRAG',
      activeEncoding: 'SGR',
    });
    expect(terminalInstances[0]._core.coreService.kittyKeyboard).toEqual({
      flags: 5,
      mainFlags: 5,
      altFlags: 3,
      mainStack: [1],
      altStack: [2],
    });
  });

  it('resets pane-local keyboard protocol state before replaying a fresh session', async () => {
    vi.mocked(window.electronAPI.getPtyHistory).mockResolvedValue({
      success: true,
      data: { chunks: [], lastSeq: 0 },
    });

    const { rerender } = render(
      <TerminalPane
        windowId="win-fresh-session"
        pane={{
          id: 'pane-fresh-session',
          cwd: 'D:\\tmp',
          command: 'pwsh.exe',
          status: WindowStatus.Paused,
          pid: null,
        }}
        isActive
        isWindowActive
        onActivate={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(terminalInstances).toHaveLength(1);
    });

    terminalInstances[0]._core.coreService.decPrivateModes.applicationCursorKeys = true;
    terminalInstances[0]._core.coreService.decPrivateModes.applicationKeypad = true;
    terminalInstances[0]._core.coreService.decPrivateModes.bracketedPasteMode = true;
    terminalInstances[0]._core.coreService.decPrivateModes.sendFocus = true;
    terminalInstances[0]._core.coreService.decPrivateModes.win32InputMode = true;
    terminalInstances[0]._core.coreMouseService.activeProtocol = 'ANY';
    terminalInstances[0]._core.coreMouseService.activeEncoding = 'SGR_PIXELS';
    terminalInstances[0]._core.coreService.kittyKeyboard.flags = 7;
    terminalInstances[0]._core.coreService.kittyKeyboard.mainFlags = 7;
    terminalInstances[0]._core.coreService.kittyKeyboard.altFlags = 3;
    terminalInstances[0]._core.coreService.kittyKeyboard.mainStack.push(1, 2);
    terminalInstances[0]._core.coreService.kittyKeyboard.altStack.push(4);

    rerender(
      <TerminalPane
        windowId="win-fresh-session"
        pane={{
          id: 'pane-fresh-session',
          cwd: 'D:\\tmp',
          command: 'pwsh.exe',
          status: WindowStatus.Running,
          pid: 9001,
        }}
        isActive
        isWindowActive
        onActivate={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(terminalInstances[0].reset).toHaveBeenCalled();
    });

    expect(terminalInstances[0]._core.coreService.decPrivateModes.applicationCursorKeys).toBe(false);
    expect(terminalInstances[0]._core.coreService.decPrivateModes.applicationKeypad).toBe(false);
    expect(terminalInstances[0]._core.coreService.decPrivateModes.bracketedPasteMode).toBe(false);
    expect(terminalInstances[0]._core.coreService.decPrivateModes.sendFocus).toBe(false);
    expect(terminalInstances[0]._core.coreService.decPrivateModes.win32InputMode).toBe(false);
    expect(terminalInstances[0]._core.coreMouseService).toEqual({
      activeProtocol: 'NONE',
      activeEncoding: 'DEFAULT',
    });
    expect(terminalInstances[0]._core.coreService.kittyKeyboard).toEqual({
      flags: 0,
      mainFlags: 0,
      altFlags: 0,
      mainStack: [],
      altStack: [],
    });
  });

  it('falls back to normal text paste when ssh image upload reports handled false', async () => {
    vi.mocked(window.electronAPI.getPtyHistory).mockResolvedValue({
      success: true,
      data: { chunks: [], lastSeq: 0 },
    });
    vi.mocked(window.electronAPI.readClipboardText).mockResolvedValue({
      success: true,
      data: 'hello from clipboard',
    });
    vi.mocked(window.electronAPI.tryPasteSshClipboardImage).mockResolvedValue({
      success: true,
      data: { handled: false },
    });

    render(
      <TerminalPane
        windowId="win-ssh"
        pane={{
          id: 'pane-ssh',
          cwd: '/srv/app',
          command: '',
          status: WindowStatus.WaitingForInput,
          pid: 1234,
          backend: 'ssh',
          ssh: {
            profileId: 'profile-1',
            remoteCwd: '/srv/app',
          },
        }}
        isActive
        isWindowActive
        onActivate={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(terminalInstances).toHaveLength(1);
    });

    const keyHandler = terminalInstances[0].attachCustomKeyEventHandler.mock.calls[0]?.[0] as (event: KeyboardEvent) => boolean;
    keyHandler({
      type: 'keydown',
      key: 'v',
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as KeyboardEvent);

    await waitFor(() => {
      expect(window.electronAPI.readClipboardText).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(window.electronAPI.ptyWrite).toHaveBeenCalledWith(
        'win-ssh',
        'pane-ssh',
        'hello from clipboard',
        { source: 'clipboard-shortcut' },
      );
    });
    expect(window.electronAPI.tryPasteSshClipboardImage).not.toHaveBeenCalled();
  });

  it('uses restored local bracketed paste state for CRLF clipboard text', async () => {
    vi.mocked(window.electronAPI.getPtyHistory).mockResolvedValue({
      success: true,
      data: {
        chunks: ['codex prompt'],
        lastSeq: 1,
        keyboardState: createKeyboardState({
          bracketedPasteMode: true,
        }),
      },
    });
    vi.mocked(window.electronAPI.readClipboardText).mockResolvedValue({
      success: true,
      data: 'alpha\r\nbeta\r\ngamma',
    });

    render(
      <TerminalPane
        windowId="win-local-codex"
        pane={{
          id: 'pane-local-codex',
          cwd: 'D:\\tmp',
          command: 'codex',
          status: WindowStatus.WaitingForInput,
          pid: 1234,
        }}
        isActive
        isWindowActive
        onActivate={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(terminalInstances[0]._core.coreService.decPrivateModes.bracketedPasteMode).toBe(true);
    });

    const keyHandler = terminalInstances[0].attachCustomKeyEventHandler.mock.calls[0]?.[0] as (event: KeyboardEvent) => boolean;
    keyHandler({
      type: 'keydown',
      key: 'v',
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as KeyboardEvent);

    await waitFor(() => {
      expect(window.electronAPI.ptyWrite).toHaveBeenCalledWith(
        'win-local-codex',
        'pane-local-codex',
        '\u001b[200~alpha\rbeta\rgamma\u001b[201~',
        { source: 'clipboard-shortcut' },
      );
    });
  });

  it('uses restored SSH bracketed paste state for CRLF clipboard text', async () => {
    vi.mocked(window.electronAPI.getPtyHistory).mockResolvedValue({
      success: true,
      data: {
        chunks: ['remote codex prompt'],
        lastSeq: 1,
        keyboardState: createKeyboardState({
          bracketedPasteMode: true,
        }),
      },
    });
    vi.mocked(window.electronAPI.readClipboardText).mockResolvedValue({
      success: true,
      data: 'alpha\r\nbeta\r\ngamma',
    });

    render(
      <TerminalPane
        windowId="win-ssh-codex"
        pane={{
          id: 'pane-ssh-codex',
          cwd: '/srv/app',
          command: 'codex',
          status: WindowStatus.WaitingForInput,
          pid: 1234,
          backend: 'ssh',
          ssh: {
            profileId: 'profile-1',
            remoteCwd: '/srv/app',
          },
        }}
        isActive
        isWindowActive
        onActivate={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(terminalInstances[0]._core.coreService.decPrivateModes.bracketedPasteMode).toBe(true);
    });

    const keyHandler = terminalInstances[0].attachCustomKeyEventHandler.mock.calls[0]?.[0] as (event: KeyboardEvent) => boolean;
    keyHandler({
      type: 'keydown',
      key: 'v',
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as KeyboardEvent);

    await waitFor(() => {
      expect(window.electronAPI.ptyWrite).toHaveBeenCalledWith(
        'win-ssh-codex',
        'pane-ssh-codex',
        '\u001b[200~alpha\rbeta\rgamma\u001b[201~',
        { source: 'clipboard-shortcut' },
      );
    });
    expect(window.electronAPI.tryPasteSshClipboardImage).not.toHaveBeenCalled();
  });

  it('normalizes Ctrl+V line endings to terminal CR before bracketed paste wrapping', async () => {
    vi.mocked(window.electronAPI.getPtyHistory).mockResolvedValue({
      success: true,
      data: { chunks: [], lastSeq: 0 },
    });
    vi.mocked(window.electronAPI.readClipboardText).mockResolvedValue({
      success: true,
      data: 'alpha\r\nbeta\rgamma',
    });

    render(
      <TerminalPane
        windowId="win-1"
        pane={{
          id: 'pane-1',
          cwd: 'D:\\tmp',
          command: 'pwsh.exe',
          status: WindowStatus.WaitingForInput,
          pid: 1234,
        }}
        isActive
        isWindowActive
        onActivate={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(terminalInstances).toHaveLength(1);
    });
    terminalInstances[0].modes.bracketedPasteMode = true;

    const keyHandler = terminalInstances[0].attachCustomKeyEventHandler.mock.calls[0]?.[0] as (event: KeyboardEvent) => boolean;
    keyHandler({
      type: 'keydown',
      key: 'v',
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as KeyboardEvent);

    await waitFor(() => {
      expect(window.electronAPI.ptyWrite).toHaveBeenCalledWith(
        'win-1',
        'pane-1',
        '\u001b[200~alpha\rbeta\rgamma\u001b[201~',
        { source: 'clipboard-shortcut' },
      );
    });
  });

  it('sanitizes ESC characters inside bracketed paste payloads', async () => {
    vi.mocked(window.electronAPI.getPtyHistory).mockResolvedValue({
      success: true,
      data: { chunks: [], lastSeq: 0 },
    });
    vi.mocked(window.electronAPI.readClipboardText).mockResolvedValue({
      success: true,
      data: 'safe\u001b[201~unsafe',
    });

    render(
      <TerminalPane
        windowId="win-1"
        pane={{
          id: 'pane-1',
          cwd: 'D:\\tmp',
          command: 'pwsh.exe',
          status: WindowStatus.WaitingForInput,
          pid: 1234,
        }}
        isActive
        isWindowActive
        onActivate={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(terminalInstances).toHaveLength(1);
    });
    terminalInstances[0].modes.bracketedPasteMode = true;

    const keyHandler = terminalInstances[0].attachCustomKeyEventHandler.mock.calls[0]?.[0] as (event: KeyboardEvent) => boolean;
    keyHandler({
      type: 'keydown',
      key: 'v',
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as KeyboardEvent);

    await waitFor(() => {
      expect(window.electronAPI.ptyWrite).toHaveBeenCalledWith(
        'win-1',
        'pane-1',
        '\u001b[200~safe\u241b[201~unsafe\u001b[201~',
        { source: 'clipboard-shortcut' },
      );
    });
  });

  it('does not synthesize PTY writes for Ctrl+Enter or Ctrl+Tab key presses', async () => {
    vi.mocked(window.electronAPI.getPtyHistory).mockResolvedValue({
      success: true,
      data: { chunks: [], lastSeq: 0 },
    });

    render(
      <TerminalPane
        windowId="win-1"
        pane={{
          id: 'pane-1',
          cwd: 'D:\\tmp',
          command: 'pwsh.exe',
          status: WindowStatus.WaitingForInput,
          pid: 1234,
        }}
        isActive
        isWindowActive
        onActivate={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(terminalInstances).toHaveLength(1);
    });

    vi.mocked(window.electronAPI.ptyWrite).mockClear();
    const keyHandler = terminalInstances[0].attachCustomKeyEventHandler.mock.calls[0]?.[0] as (event: KeyboardEvent) => boolean;

    const ctrlEnterHandledByXterm = keyHandler({
      type: 'keydown',
      key: 'Enter',
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      repeat: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as KeyboardEvent);
    const ctrlTabHandledByXterm = keyHandler({
      type: 'keydown',
      key: 'Tab',
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as KeyboardEvent);

    expect(ctrlEnterHandledByXterm).toBe(true);
    expect(ctrlTabHandledByXterm).toBe(true);
    expect(window.electronAPI.ptyWrite).not.toHaveBeenCalledWith(
      'win-1',
      'pane-1',
      '\n',
      { source: 'ctrl-enter' },
    );
  });

  it('re-focuses xterm when clicking an already active pane', async () => {
    vi.mocked(window.electronAPI.getPtyHistory).mockResolvedValue({
      success: true,
      data: { chunks: [], lastSeq: 0 },
    });

    const { container } = render(
      <TerminalPane
        windowId="win-1"
        pane={{
          id: 'pane-1',
          cwd: 'D:\\tmp',
          command: 'pwsh.exe',
          status: WindowStatus.WaitingForInput,
          pid: 1234,
        }}
        isActive
        isWindowActive
        onActivate={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(terminalInstances).toHaveLength(1);
    });

    const terminal = terminalInstances[0];
    terminal.focus.mockClear();

    const paneRoot = container.firstElementChild as HTMLElement | null;
    expect(paneRoot).not.toBeNull();

    fireEvent.click(paneRoot!);

    expect(terminal.focus).toHaveBeenCalledTimes(1);
  });

  it('re-focuses xterm on terminal-region mousedown even when the pane is already active', async () => {
    vi.mocked(window.electronAPI.getPtyHistory).mockResolvedValue({
      success: true,
      data: { chunks: [], lastSeq: 0 },
    });

    const { container } = render(
      <TerminalPane
        windowId="win-1"
        pane={{
          id: 'pane-1',
          cwd: 'D:\\tmp',
          command: 'pwsh.exe',
          status: WindowStatus.WaitingForInput,
          pid: 1234,
        }}
        isActive
        isWindowActive
        onActivate={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(terminalInstances).toHaveLength(1);
    });

    const terminal = terminalInstances[0];
    terminal.focus.mockClear();

    const terminalRegion = container.querySelector('[data-terminal-input-region="true"]');
    expect(terminalRegion).not.toBeNull();

    fireEvent.mouseDown(terminalRegion!);

    expect(terminal.focus).toHaveBeenCalledTimes(1);
  });

  it('does not text-paste when ssh image upload already handled the clipboard', async () => {
    vi.mocked(window.electronAPI.getPtyHistory).mockResolvedValue({
      success: true,
      data: { chunks: [], lastSeq: 0 },
    });
    vi.mocked(window.electronAPI.readClipboardText).mockResolvedValue({
      success: true,
      data: 'should not be pasted',
    });
    vi.mocked(window.electronAPI.tryPasteSshClipboardImage).mockResolvedValue({
      success: true,
      data: { handled: true, remotePath: '/srv/app/copilot-clipboard.png' },
    });

    render(
      <TerminalPane
        windowId="win-ssh"
        pane={{
          id: 'pane-ssh',
          cwd: '/srv/app',
          command: '',
          status: WindowStatus.WaitingForInput,
          pid: 1234,
          backend: 'ssh',
          ssh: {
            profileId: 'profile-1',
            remoteCwd: '/srv/app',
          },
        }}
        isActive
        isWindowActive
        onActivate={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(terminalInstances).toHaveLength(1);
    });

    const keyHandler = terminalInstances[0].attachCustomKeyEventHandler.mock.calls[0]?.[0] as (event: KeyboardEvent) => boolean;
    keyHandler({
      type: 'keydown',
      key: 'v',
      ctrlKey: false,
      metaKey: false,
      altKey: true,
      shiftKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as KeyboardEvent);

    await waitFor(() => {
      expect(window.electronAPI.tryPasteSshClipboardImage).toHaveBeenCalledWith('win-ssh', 'pane-ssh', '/srv/app');
    });

    await waitFor(() => {
      expect(window.electronAPI.readClipboardText).not.toHaveBeenCalled();
    });
    expect(window.electronAPI.ptyWrite).not.toHaveBeenCalledWith(
      'win-ssh',
      'pane-ssh',
      'should not be pasted',
      { source: 'clipboard-shortcut' },
    );
  });

  it('does not fall back to text paste when ssh image upload fails', async () => {
    vi.mocked(window.electronAPI.getPtyHistory).mockResolvedValue({
      success: true,
      data: { chunks: [], lastSeq: 0 },
    });
    vi.mocked(window.electronAPI.readClipboardText).mockResolvedValue({
      success: true,
      data: 'should not be pasted after image error',
    });
    vi.mocked(window.electronAPI.tryPasteSshClipboardImage).mockResolvedValue({
      success: false,
      error: '图片已识别，但超过 SSH 图片上传大小限制：当前 25.0 MB，限制 20.0 MB',
    });

    render(
      <TerminalPane
        windowId="win-ssh"
        pane={{
          id: 'pane-ssh',
          cwd: '/srv/app',
          command: '',
          status: WindowStatus.WaitingForInput,
          pid: 1234,
          backend: 'ssh',
          ssh: {
            profileId: 'profile-1',
            remoteCwd: '/srv/app',
          },
        }}
        isActive
        isWindowActive
        onActivate={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(terminalInstances).toHaveLength(1);
    });

    const keyHandler = terminalInstances[0].attachCustomKeyEventHandler.mock.calls[0]?.[0] as (event: KeyboardEvent) => boolean;
    keyHandler({
      type: 'keydown',
      key: 'v',
      ctrlKey: false,
      metaKey: false,
      altKey: true,
      shiftKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as KeyboardEvent);

    await waitFor(() => {
      expect(window.electronAPI.tryPasteSshClipboardImage).toHaveBeenCalledWith('win-ssh', 'pane-ssh', '/srv/app');
    });

    expect(window.electronAPI.readClipboardText).not.toHaveBeenCalled();
    expect(window.electronAPI.ptyWrite).not.toHaveBeenCalledWith(
      'win-ssh',
      'pane-ssh',
      'should not be pasted after image error',
      { source: 'clipboard-shortcut' },
    );
  });

  it('uses the latest tracked ssh runtime cwd for image upload shortcuts', async () => {
    vi.mocked(window.electronAPI.getPtyHistory).mockResolvedValue({
      success: true,
      data: { chunks: [], lastSeq: 0 },
    });
    vi.mocked(window.electronAPI.tryPasteSshClipboardImage).mockResolvedValue({
      success: true,
      data: { handled: true, remotePath: '/home/a/copilot-clipboard.png' },
    });

    render(
      <TerminalPane
        windowId="win-ssh"
        pane={{
          id: 'pane-ssh',
          cwd: '~',
          command: '',
          status: WindowStatus.WaitingForInput,
          pid: 1234,
          backend: 'ssh',
          ssh: {
            profileId: 'profile-1',
            remoteCwd: '~',
          },
        }}
        isActive
        isWindowActive
        onActivate={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(terminalInstances).toHaveLength(1);
      expect(ptyCallbacks.length).toBeGreaterThan(0);
    });

    ptyCallbacks[0]({
      windowId: 'win-ssh',
      paneId: 'pane-ssh',
      data: '\u001b]633;P;Cwd=/home/a\u0007',
      seq: 1,
    });

    const keyHandler = terminalInstances[0].attachCustomKeyEventHandler.mock.calls[0]?.[0] as (event: KeyboardEvent) => boolean;
    keyHandler({
      type: 'keydown',
      key: 'v',
      ctrlKey: false,
      metaKey: false,
      altKey: true,
      shiftKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as KeyboardEvent);

    await waitFor(() => {
      expect(window.electronAPI.tryPasteSshClipboardImage).toHaveBeenCalledWith('win-ssh', 'pane-ssh', '/home/a');
    });
  });

  it('uses the saved custom SSH image shortcut for newly mounted SSH terminals', async () => {
    vi.mocked(window.electronAPI.getPtyHistory).mockResolvedValue({
      success: true,
      data: { chunks: [], lastSeq: 0 },
    });
    vi.mocked(window.electronAPI.getSettings).mockResolvedValue({
      success: true,
      data: {
        terminal: {
          useBundledConptyDll: false,
          defaultShellProgram: '',
        },
        sshClipboardImage: {
          enabled: true,
          uploadLocation: 'current-working-directory',
          shortcut: 'ctrl-alt-v',
          customUploadDirectory: '',
          copyRemotePathAfterUpload: true,
          maxUploadBytes: 20 * 1024 * 1024,
        },
      },
    } as Awaited<ReturnType<typeof window.electronAPI.getSettings>>);
    vi.mocked(window.electronAPI.tryPasteSshClipboardImage).mockResolvedValue({
      success: true,
      data: { handled: true, remotePath: '/srv/app/copilot-clipboard.png' },
    });

    render(
      <TerminalPane
        windowId="win-ssh"
        pane={{
          id: 'pane-ssh',
          cwd: '/srv/app',
          command: '',
          status: WindowStatus.WaitingForInput,
          pid: 1234,
          backend: 'ssh',
          ssh: {
            profileId: 'profile-1',
            remoteCwd: '/srv/app',
          },
        }}
        isActive
        isWindowActive
        onActivate={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(terminalInstances).toHaveLength(1);
      expect(window.electronAPI.getSettings).toHaveBeenCalled();
    });

    const keyHandler = terminalInstances[0].attachCustomKeyEventHandler.mock.calls[0]?.[0] as (event: KeyboardEvent) => boolean;

    keyHandler({
      type: 'keydown',
      key: 'v',
      ctrlKey: false,
      metaKey: false,
      altKey: true,
      shiftKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as KeyboardEvent);

    await waitFor(() => {
      expect(window.electronAPI.tryPasteSshClipboardImage).not.toHaveBeenCalled();
    });

    keyHandler({
      type: 'keydown',
      key: 'v',
      ctrlKey: true,
      metaKey: false,
      altKey: true,
      shiftKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as KeyboardEvent);

    await waitFor(() => {
      expect(window.electronAPI.tryPasteSshClipboardImage).toHaveBeenCalledWith('win-ssh', 'pane-ssh', '/srv/app');
    });
  });
});
