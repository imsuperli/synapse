import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TerminalPane } from '../TerminalPane';
import { WindowStatus } from '../../types/window';

type MockRenderService = {
  _isPaused: boolean;
  _needsFullRefresh: boolean;
  _pausedResizeTask: {
    flush: ReturnType<typeof vi.fn>;
  };
  handleDevicePixelRatioChange: ReturnType<typeof vi.fn>;
  handleResize: ReturnType<typeof vi.fn>;
  refreshRows: ReturnType<typeof vi.fn>;
};

type MockTerminalInstance = {
  focus: ReturnType<typeof vi.fn>;
  refresh: ReturnType<typeof vi.fn>;
  scrollToLine: ReturnType<typeof vi.fn>;
  onScroll: ReturnType<typeof vi.fn>;
  textarea: HTMLTextAreaElement | null;
  cols: number;
  rows: number;
  buffer: {
    active: {
      viewportY: number;
      baseY: number;
    };
  };
  _core: {
    _renderService: MockRenderService;
  };
};

const { fitAddonInstances, terminalInstances, terminalScrollCallbacks } = vi.hoisted(() => ({
  fitAddonInstances: [] as Array<{
    fit: ReturnType<typeof vi.fn>;
  }>,
  terminalInstances: [] as MockTerminalInstance[],
  terminalScrollCallbacks: [] as Array<(viewportY: number) => void>,
}));

vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn(function MockTerminal() {
    const renderService: MockRenderService = {
      _isPaused: false,
      _needsFullRefresh: false,
      _pausedResizeTask: {
        flush: vi.fn(),
      },
      handleDevicePixelRatioChange: vi.fn(),
      handleResize: vi.fn(),
      refreshRows: vi.fn(),
    };
    const instance = {
      loadAddon: vi.fn(),
      registerLinkProvider: vi.fn(() => ({ dispose: vi.fn() })),
      open: vi.fn((container?: HTMLElement) => {
        if (!container || instance.textarea) {
          return;
        }

        const textarea = document.createElement('textarea');
        instance.textarea = textarea;
        container.appendChild(textarea);
      }),
      focus: vi.fn(),
      blur: vi.fn(),
      dispose: vi.fn(),
      refresh: vi.fn(),
      write: vi.fn(),
      paste: vi.fn(),
      getSelection: vi.fn().mockReturnValue(''),
      onData: vi.fn(() => ({ dispose: vi.fn() })),
      onSelectionChange: vi.fn(() => ({ dispose: vi.fn() })),
      onScroll: vi.fn((callback: (viewportY: number) => void) => {
        terminalScrollCallbacks.push(callback);
        return { dispose: vi.fn() };
      }),
      scrollToLine: vi.fn((line: number) => {
        instance.buffer.active.viewportY = line;
        terminalScrollCallbacks.forEach((callback) => callback(line));
      }),
      textarea: null,
      attachCustomKeyEventHandler: vi.fn(),
      options: {},
      cols: 120,
      rows: 40,
      buffer: {
        active: {
          viewportY: 0,
          baseY: 0,
        },
      },
      _core: {
        _renderService: renderService,
      },
    };
    terminalInstances.push(instance);
    return instance;
  }),
}));

vi.mock('../../utils/xtermAddonFit', () => ({
  FitAddon: vi.fn(function MockFitAddon() {
    const instance = {
      fit: vi.fn(),
    };
    fitAddonInstances.push(instance);
    return instance;
  }),
}));

vi.mock('../../api/ptyDataBus', () => ({
  subscribeToPanePtyData: vi.fn(() => vi.fn()),
}));

vi.mock('../../styles/xterm.css', () => ({}));

function waitForTerminalMountResizeSettle(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 220));
}

function waitForVisibleRepaintDelay(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 160));
}

describe('TerminalPane resize on resume', () => {
  const originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
  const originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;

  beforeEach(() => {
    vi.clearAllMocks();
    fitAddonInstances.length = 0;
    terminalInstances.length = 0;
    terminalScrollCallbacks.length = 0;

    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => 900,
    });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get: () => 600,
    });

    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    if (originalClientWidth) {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalClientWidth);
    }
    if (originalClientHeight) {
      Object.defineProperty(HTMLElement.prototype, 'clientHeight', originalClientHeight);
    }

    if (originalRequestAnimationFrame) {
      vi.stubGlobal('requestAnimationFrame', originalRequestAnimationFrame);
    }
    if (originalCancelAnimationFrame) {
      vi.stubGlobal('cancelAnimationFrame', originalCancelAnimationFrame);
    }
  });

  it('forces fit and pty resize when pane resumes from paused', async () => {
    const { rerender } = render(
      <TerminalPane
        windowId="win-1"
        pane={{
          id: 'pane-1',
          cwd: 'D:\\tmp',
          command: 'pwsh.exe',
          status: WindowStatus.Paused,
          pid: 1234,
        }}
        isActive
        isWindowActive
        onActivate={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(window.electronAPI.ptyResize).toHaveBeenCalled();
    });

    vi.mocked(window.electronAPI.ptyResize).mockClear();
    fitAddonInstances[0]?.fit.mockClear();

    rerender(
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
      />
    );

    await waitFor(() => {
      expect(fitAddonInstances[0]?.fit).toHaveBeenCalledTimes(1);
      expect(window.electronAPI.ptyResize).toHaveBeenCalledWith('win-1', 'pane-1', 120, 40);
    });
  });

  it('forces fit and pty resize when the pane count changes after a split', async () => {
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
        layoutPaneCount={1}
        isActive
        isWindowActive
        onActivate={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(window.electronAPI.ptyResize).toHaveBeenCalled();
    });

    vi.mocked(window.electronAPI.ptyResize).mockClear();
    fitAddonInstances[0]?.fit.mockClear();

    rerender(
      <TerminalPane
        windowId="win-1"
        pane={{
          id: 'pane-1',
          cwd: 'D:\\tmp',
          command: 'pwsh.exe',
          status: WindowStatus.Running,
          pid: 1234,
        }}
        layoutPaneCount={2}
        isActive
        isWindowActive
        onActivate={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(fitAddonInstances[0]?.fit).toHaveBeenCalled();
      expect(window.electronAPI.ptyResize).toHaveBeenCalledWith('win-1', 'pane-1', 120, 40);
    });
  });

  it('recovers a paused xterm render service without resizing the PTY when the terminal window becomes active', async () => {
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
        isWindowActive={false}
        onActivate={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(terminalInstances[0]).toBeDefined();
    });
    await waitForTerminalMountResizeSettle();

    const terminal = terminalInstances[0];
    const renderService = terminal!._core._renderService;
    renderService._isPaused = true;
    renderService._needsFullRefresh = true;
    renderService._pausedResizeTask.flush.mockClear();
    renderService.handleResize.mockClear();
    renderService.handleDevicePixelRatioChange.mockClear();
    renderService.refreshRows.mockClear();
    terminal?.refresh.mockClear();
    fitAddonInstances[0]?.fit.mockClear();
    vi.mocked(window.electronAPI.ptyResize).mockClear();

    rerender(
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
      />
    );

    await waitFor(() => {
      expect(renderService._isPaused).toBe(false);
      expect(renderService._needsFullRefresh).toBe(false);
      expect(fitAddonInstances[0]?.fit).toHaveBeenCalled();
      expect(renderService._pausedResizeTask.flush).toHaveBeenCalled();
      expect(renderService.handleResize).toHaveBeenCalledWith(120, 40);
      expect(renderService.handleDevicePixelRatioChange).toHaveBeenCalled();
      expect(renderService.refreshRows).toHaveBeenCalledWith(0, 39, true);
      expect(terminal?.refresh).toHaveBeenCalledWith(0, 39);
      expect(window.electronAPI.ptyResize).not.toHaveBeenCalled();
    });
  });

  it('re-focuses the active pane when pane count changes and focus drifted outside', async () => {
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
        layoutPaneCount={1}
        isActive
        isWindowActive
        onActivate={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(window.electronAPI.ptyResize).toHaveBeenCalled();
    });

    const outsideButton = document.createElement('button');
    document.body.appendChild(outsideButton);
    outsideButton.focus();

    const terminal = terminalInstances[0];
    expect(terminal).toBeDefined();
    terminal?.focus.mockClear();

    rerender(
      <TerminalPane
        windowId="win-1"
        pane={{
          id: 'pane-1',
          cwd: 'D:\\tmp',
          command: 'pwsh.exe',
          status: WindowStatus.Running,
          pid: 1234,
        }}
        layoutPaneCount={2}
        isActive
        isWindowActive
        onActivate={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(terminal?.focus).toHaveBeenCalled();
    });

    outsideButton.remove();
  });

  it('refreshes the visible terminal viewport when the app regains focus', async () => {
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
      />
    );

    await waitFor(() => {
      expect(window.electronAPI.ptyResize).toHaveBeenCalled();
    });
    await waitForTerminalMountResizeSettle();

    const terminal = terminalInstances[0];
    expect(terminal).toBeDefined();
    terminal?.refresh.mockClear();
    vi.mocked(window.electronAPI.ptyResize).mockClear();

    window.dispatchEvent(new Event('focus'));

    await waitFor(() => {
      expect(terminal?.refresh).toHaveBeenCalledWith(0, 39);
    });
    expect(window.electronAPI.ptyResize).not.toHaveBeenCalled();
  });

  it('recovers a paused xterm render service when the app regains focus', async () => {
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
      />
    );

    await waitFor(() => {
      expect(window.electronAPI.ptyResize).toHaveBeenCalled();
    });
    await waitForTerminalMountResizeSettle();

    const terminal = terminalInstances[0];
    expect(terminal).toBeDefined();
    const renderService = terminal!._core._renderService;
    renderService._isPaused = true;
    renderService._needsFullRefresh = true;
    renderService._pausedResizeTask.flush.mockClear();
    renderService.handleResize.mockClear();
    renderService.handleDevicePixelRatioChange.mockClear();
    renderService.refreshRows.mockClear();
    terminal?.refresh.mockClear();
    vi.mocked(window.electronAPI.ptyResize).mockClear();

    window.dispatchEvent(new Event('focus'));

    await waitFor(() => {
      expect(renderService._isPaused).toBe(false);
      expect(renderService._needsFullRefresh).toBe(false);
      expect(renderService._pausedResizeTask.flush).toHaveBeenCalledTimes(1);
      expect(renderService.handleResize).toHaveBeenCalledWith(120, 40);
      expect(renderService.handleDevicePixelRatioChange).toHaveBeenCalledTimes(1);
      expect(renderService.refreshRows).toHaveBeenCalledWith(0, 39, true);
      expect(terminal?.refresh).toHaveBeenCalledWith(0, 39);
    });
    expect(window.electronAPI.ptyResize).not.toHaveBeenCalled();
  });

  it('preserves the terminal viewport when focus recovery briefly jumps to the first line', async () => {
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
      />
    );

    await waitFor(() => {
      expect(terminalInstances[0]).toBeDefined();
    });
    await waitForTerminalMountResizeSettle();

    const terminal = terminalInstances[0]!;
    terminal.buffer.active.baseY = 240;
    terminal.buffer.active.viewportY = 120;
    terminalScrollCallbacks.forEach((callback) => callback(120));
    terminal.scrollToLine.mockClear();

    window.dispatchEvent(new Event('blur'));
    window.dispatchEvent(new Event('focus'));

    terminal.buffer.active.viewportY = 0;
    terminalScrollCallbacks.forEach((callback) => callback(0));

    await waitFor(() => {
      expect(terminal.scrollToLine).toHaveBeenCalledWith(120);
    });
    expect(terminal.buffer.active.viewportY).toBe(120);
  });

  it('preserves the terminal viewport when focus recovery briefly jumps to the bottom', async () => {
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
      />
    );

    await waitFor(() => {
      expect(terminalInstances[0]).toBeDefined();
    });
    await waitForTerminalMountResizeSettle();

    const terminal = terminalInstances[0]!;
    terminal.buffer.active.baseY = 240;
    terminal.buffer.active.viewportY = 120;
    terminalScrollCallbacks.forEach((callback) => callback(120));
    terminal.scrollToLine.mockClear();

    window.dispatchEvent(new Event('blur'));
    window.dispatchEvent(new Event('focus'));

    terminal.buffer.active.viewportY = 240;
    terminalScrollCallbacks.forEach((callback) => callback(240));

    await waitFor(() => {
      expect(terminal.scrollToLine).toHaveBeenCalledWith(120);
    });
    expect(terminal.buffer.active.viewportY).toBe(120);
  });

  it('continues following the bottom when output grows while the viewport was already at the bottom', async () => {
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
      />
    );

    await waitFor(() => {
      expect(terminalInstances[0]).toBeDefined();
    });
    await waitForTerminalMountResizeSettle();

    const terminal = terminalInstances[0]!;
    terminal.buffer.active.baseY = 240;
    terminal.buffer.active.viewportY = 240;
    terminalScrollCallbacks.forEach((callback) => callback(240));
    terminal.scrollToLine.mockClear();

    window.dispatchEvent(new Event('blur'));

    terminal.buffer.active.baseY = 250;
    terminal.buffer.active.viewportY = 250;
    terminalScrollCallbacks.forEach((callback) => callback(250));

    expect(terminal.scrollToLine).not.toHaveBeenCalled();
    expect(terminal.buffer.active.viewportY).toBe(250);
  });

  it('recovers a stale render surface on scroll without fitting or resizing the PTY', async () => {
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
      />
    );

    await waitFor(() => {
      expect(window.electronAPI.ptyResize).toHaveBeenCalled();
    });
    await waitForTerminalMountResizeSettle();

    const terminal = terminalInstances[0]!;
    const renderService = terminal._core._renderService;
    renderService._isPaused = true;
    renderService._needsFullRefresh = true;
    renderService._pausedResizeTask.flush.mockClear();
    renderService.handleResize.mockClear();
    renderService.handleDevicePixelRatioChange.mockClear();
    renderService.refreshRows.mockClear();
    terminal.refresh.mockClear();
    fitAddonInstances[0]?.fit.mockClear();
    vi.mocked(window.electronAPI.ptyResize).mockClear();

    terminalScrollCallbacks.forEach((callback) => callback(24));

    await waitFor(() => {
      expect(renderService._isPaused).toBe(false);
      expect(renderService._needsFullRefresh).toBe(false);
      expect(renderService._pausedResizeTask.flush).toHaveBeenCalledTimes(1);
      expect(renderService.handleResize).toHaveBeenCalledWith(120, 40);
      expect(renderService.handleDevicePixelRatioChange).toHaveBeenCalledTimes(1);
      expect(renderService.refreshRows).toHaveBeenCalledWith(0, 39, true);
      expect(terminal.refresh).toHaveBeenCalledWith(0, 39);
    });
    expect(fitAddonInstances[0]?.fit).not.toHaveBeenCalled();
    expect(window.electronAPI.ptyResize).not.toHaveBeenCalled();
  });

  it('focuses the helper textarea without allowing focus to scroll the viewport', async () => {
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
      />
    );

    await waitFor(() => {
      expect(terminalInstances[0]?.textarea).toBeInstanceOf(HTMLTextAreaElement);
    });

    const textarea = terminalInstances[0]!.textarea!;
    const focusSpy = vi.spyOn(textarea, 'focus');
    fireEvent.click(container.querySelector('[data-terminal-input-region="true"]')!);

    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('does not recover a hidden terminal viewport when the app regains focus', async () => {
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
      />
    );

    await waitFor(() => {
      expect(window.electronAPI.ptyResize).toHaveBeenCalled();
    });
    await waitForTerminalMountResizeSettle();

    const terminalRegion = container.querySelector('[data-terminal-input-region="true"]') as HTMLElement | null;
    expect(terminalRegion).not.toBeNull();
    terminalRegion!.style.display = 'none';

    const terminal = terminalInstances[0];
    expect(terminal).toBeDefined();
    const renderService = terminal!._core._renderService;
    terminal?.refresh.mockClear();
    renderService._pausedResizeTask.flush.mockClear();
    renderService.handleResize.mockClear();
    renderService.handleDevicePixelRatioChange.mockClear();
    renderService.refreshRows.mockClear();
    fitAddonInstances[0]?.fit.mockClear();

    window.dispatchEvent(new Event('focus'));

    await waitForVisibleRepaintDelay();

    expect(fitAddonInstances[0]?.fit).not.toHaveBeenCalled();
    expect(renderService._pausedResizeTask.flush).not.toHaveBeenCalled();
    expect(renderService.handleResize).not.toHaveBeenCalled();
    expect(renderService.handleDevicePixelRatioChange).not.toHaveBeenCalled();
    expect(renderService.refreshRows).not.toHaveBeenCalled();
    expect(terminal?.refresh).not.toHaveBeenCalled();
  });

  it('shows the tmux close button only on hover', () => {
    const onClose = vi.fn();
    const { container } = render(
      <TerminalPane
        windowId="win-1"
        pane={{
          id: 'pane-1',
          cwd: 'D:\\tmp',
          command: 'pwsh.exe',
          status: WindowStatus.Running,
          pid: 1234,
          title: 'agent-1',
          agentName: 'agent-1',
        }}
        isActive
        isWindowActive
        onActivate={vi.fn()}
        onClose={onClose}
      />
    );

    expect(screen.queryByRole('button', { name: '关闭窗格' })).not.toBeInTheDocument();

    fireEvent.mouseEnter(container.firstElementChild as HTMLElement);

    const closeButton = screen.getByRole('button', { name: '关闭窗格' });
    expect(closeButton).toBeInTheDocument();
    expect(closeButton).not.toHaveClass('absolute');

    fireEvent.click(closeButton);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
