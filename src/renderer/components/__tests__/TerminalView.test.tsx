import React from 'react';
import { act, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TerminalView } from '../TerminalView';
import { CUSTOM_TITLEBAR_ACTIONS_SLOT_ID } from '../CustomTitleBar';
import { useWindowStore } from '../../stores/windowStore';
import { Window, WindowStatus } from '../../types/window';
import { getAllPanes } from '../../utils/layoutHelpers';
import { ACTIVE_TERMINAL_FOCUS_REQUEST_EVENT } from '../../utils/terminalFocus';

vi.mock('../Sidebar', () => ({
  Sidebar: ({
    onOpenCodePane,
    onSettingsClick,
    showOpenCodePaneAction,
    canOpenCodePane,
  }: {
    onOpenCodePane?: () => void;
    onSettingsClick?: () => void;
    showOpenCodePaneAction?: boolean;
    canOpenCodePane?: boolean;
  }) => (
    <div data-testid="sidebar">
      <button type="button" aria-label="open-settings" onClick={() => onSettingsClick?.()}>
        open-settings
      </button>
      {showOpenCodePaneAction ? (
        <button
          type="button"
          aria-label="terminalView.openCode"
          disabled={!canOpenCodePane}
          onClick={() => onOpenCodePane?.()}
        >
          terminalView.openCode
        </button>
      ) : null}
    </div>
  ),
}));

vi.mock('../QuickSwitcher', () => ({
  QuickSwitcher: () => null,
}));

vi.mock('../SettingsPanel', () => ({
  SettingsPanel: ({ open, onClose }: { open: boolean; onClose?: () => void }) => (open ? (
    <div data-testid="settings-panel">
      <button type="button" aria-label="close-settings-panel" onClick={() => onClose?.()}>
        close-settings-panel
      </button>
    </div>
  ) : null),
}));

vi.mock('../RemoteWindowTabs', () => ({
  RemoteWindowTabs: ({
    windows = [],
    onWindowSelect,
    variant,
  }: {
    windows?: Window[];
    onWindowSelect?: (windowId: string) => void;
    variant?: string;
  }) => (
    <div data-testid="remote-window-tabs" data-variant={variant}>
      {windows.map((window) => (
        <button
          key={window.id}
          type="button"
          aria-label={window.name}
          onClick={() => onWindowSelect?.(window.id)}
        >
          {window.name}
        </button>
      ))}
    </div>
  ),
}));

vi.mock('../SplitLayout', () => ({
  SplitLayout: (props: {
    activePaneId?: string;
    onPaneClose?: (paneId: string) => void;
    onPaneExit?: (paneId: string) => void;
  }) => (
    <div data-testid="split-layout">
      {props.onPaneClose && props.activePaneId ? (
        <button type="button" aria-label="close-active-pane" onClick={() => props.onPaneClose?.(props.activePaneId!)}>
          close-active-pane
        </button>
      ) : null}
      {props.onPaneExit && props.activePaneId ? (
        <button type="button" aria-label="exit-active-pane" onClick={() => props.onPaneExit?.(props.activePaneId!)}>
          exit-active-pane
        </button>
      ) : null}
    </div>
  ),
}));

vi.mock('react-dnd', () => ({
  useDrag: () => [{ isDragging: false }, () => undefined, () => undefined],
}));

vi.mock('react-dnd-html5-backend', () => ({
  getEmptyImage: () => ({}),
}));

vi.mock('../dnd', () => ({
  DragItemTypes: {
    BROWSER_TOOL: 'BROWSER_TOOL',
    BROWSER_PANE: 'BROWSER_PANE',
  },
  DropZone: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../ProjectLinks', () => ({
  ProjectLinks: () => null,
}));

vi.mock('../icons/IDEIcons', () => ({
  IDEIcon: () => <span data-testid="ide-icon" />,
}));

vi.mock('../../hooks/useKeyboardShortcuts', () => ({
  useKeyboardShortcuts: () => undefined,
}));

vi.mock('../../hooks/useIDESettings', () => ({
  useIDESettings: () => ({ enabledIDEs: [] }),
}));

vi.mock('../../i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
    language: 'en-US',
    setLanguage: vi.fn(),
  }),
}));

vi.mock('../SSHPortForwardDialog', () => ({
  SSHPortForwardDialog: () => null,
}));

vi.mock('../SSHSftpDialog', () => ({
  SSHSftpDialog: () => null,
}));

vi.mock('../SSHSessionStatusBar', () => ({
  SSHSessionStatusBar: () => null,
}));

function createLocalWindow(status: WindowStatus = WindowStatus.Running): Window {
  const paneId = 'pane-local-1';

  return {
    id: 'win-local-1',
    name: 'Local Window',
    activePaneId: paneId,
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
    layout: {
      type: 'pane',
      id: paneId,
      pane: {
        id: paneId,
        cwd: '/workspace/project',
        command: 'bash',
        status,
        pid: status === WindowStatus.Paused ? null : 101,
      },
    },
  };
}

function createSshWindow(): Window {
  const paneId = 'pane-ssh-1';

  return {
    id: 'win-ssh-1',
    name: 'SSH Window',
    activePaneId: paneId,
    kind: 'ssh',
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
    layout: {
      type: 'pane',
      id: paneId,
      pane: {
        id: paneId,
        cwd: '/srv/app',
        command: '',
        status: WindowStatus.Running,
        pid: 202,
        backend: 'ssh',
        ssh: {
          profileId: 'profile-1',
          host: '10.0.0.20',
          user: 'root',
          remoteCwd: '/srv/app',
          reuseSession: true,
        },
      },
    },
  };
}

function createSshWindowWithChatPane(activePaneId: string = 'pane-ssh-1'): Window {
  return {
    id: 'win-ssh-with-chat-1',
    name: 'SSH Window With Chat',
    activePaneId,
    kind: 'ssh',
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
    layout: {
      type: 'split',
      direction: 'horizontal',
      sizes: [0.65, 0.35],
      children: [
        {
          type: 'pane',
          id: 'pane-ssh-1',
          pane: {
            id: 'pane-ssh-1',
            cwd: '/srv/app',
            command: '',
            status: WindowStatus.Running,
            pid: 202,
            backend: 'ssh',
            ssh: {
              profileId: 'profile-1',
              host: '10.0.0.20',
              user: 'root',
              remoteCwd: '/srv/app',
              reuseSession: true,
            },
          },
        },
        {
          type: 'pane',
          id: 'pane-chat-1',
          pane: {
            id: 'pane-chat-1',
            cwd: '',
            command: '',
            kind: 'chat',
            status: WindowStatus.Paused,
            pid: null,
            chat: {
              messages: [],
              linkedPaneId: 'pane-ssh-1',
            },
          },
        },
      ],
    },
  };
}

function createMixedLocalAndSshWindow(): Window {
  return {
    id: 'win-mixed-1',
    name: 'Mixed Window',
    activePaneId: 'pane-local-1',
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
    layout: {
      type: 'split',
      direction: 'horizontal',
      sizes: [0.5, 0.5],
      children: [
        {
          type: 'pane',
          id: 'pane-local-1',
          pane: {
            id: 'pane-local-1',
            cwd: '/workspace/project',
            command: 'bash',
            status: WindowStatus.Running,
            pid: 101,
          },
        },
        {
          type: 'pane',
          id: 'pane-ssh-1',
          pane: {
            id: 'pane-ssh-1',
            cwd: '/srv/app',
            command: '',
            status: WindowStatus.Running,
            pid: 202,
            backend: 'ssh',
            ssh: {
              profileId: 'profile-1',
              host: '10.0.0.20',
              user: 'root',
              remoteCwd: '/srv/app',
              reuseSession: true,
            },
          },
        },
      ],
    },
  };
}

function createTwoTerminalPaneWindow(options?: {
  status?: WindowStatus;
  secondStatus?: WindowStatus;
  secondPid?: number | null;
}): Window {
  const status = options?.status ?? WindowStatus.Running;
  const secondStatus = options?.secondStatus ?? status;

  return {
    id: 'win-local-split-1',
    name: 'Split Local Window',
    activePaneId: 'pane-local-1',
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
    layout: {
      type: 'split',
      direction: 'horizontal',
      sizes: [0.5, 0.5],
      children: [
        {
          type: 'pane',
          id: 'pane-local-1',
          pane: {
            id: 'pane-local-1',
            cwd: '/workspace/project',
            command: 'bash',
            status,
            pid: status === WindowStatus.Completed || status === WindowStatus.Error || status === WindowStatus.Paused ? null : 101,
          },
        },
        {
          type: 'pane',
          id: 'pane-local-2',
          pane: {
            id: 'pane-local-2',
            cwd: '/workspace/project',
            command: 'bash',
            status: secondStatus,
            pid: options?.secondPid ?? (
              secondStatus === WindowStatus.Completed || secondStatus === WindowStatus.Error || secondStatus === WindowStatus.Paused
                ? null
                : 202
            ),
          },
        },
      ],
    },
  };
}

function createBrowserOnlyWindow(kind: Window['kind'] = 'local'): Window {
  const paneId = 'pane-browser-only-1';

  return {
    id: `win-browser-${kind ?? 'local'}`,
    name: `Browser ${kind ?? 'local'}`,
    activePaneId: paneId,
    kind,
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
    layout: {
      type: 'pane',
      id: paneId,
      pane: {
        id: paneId,
        cwd: '',
        command: '',
        kind: 'browser',
        status: WindowStatus.Paused,
        pid: null,
        browser: {
          url: 'https://example.com',
        },
      },
    },
  };
}

function createTerminalWithTwoBrowsersWindow(): Window {
  return {
    id: 'win-mixed-browser-only-after-close',
    name: 'Terminal With Browsers',
    activePaneId: 'pane-local-1',
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
    layout: {
      type: 'split',
      direction: 'horizontal',
      sizes: [0.34, 0.33, 0.33],
      children: [
        {
          type: 'pane',
          id: 'pane-local-1',
          pane: {
            id: 'pane-local-1',
            cwd: '/workspace/project',
            command: 'bash',
            status: WindowStatus.Running,
            pid: 101,
          },
        },
        {
          type: 'pane',
          id: 'browser-1',
          pane: {
            id: 'browser-1',
            cwd: '',
            command: '',
            kind: 'browser',
            status: WindowStatus.Paused,
            pid: null,
            browser: { url: 'https://example.com/1' },
          },
        },
        {
          type: 'pane',
          id: 'browser-2',
          pane: {
            id: 'browser-2',
            cwd: '',
            command: '',
            kind: 'browser',
            status: WindowStatus.Paused,
            pid: null,
            browser: { url: 'https://example.com/2' },
          },
        },
      ],
    },
  };
}

function createTerminalWithCodePaneWindow(): Window {
  return {
    id: 'win-mixed-code-only-after-close',
    name: 'Terminal With Code Pane',
    activePaneId: 'pane-local-1',
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
    layout: {
      type: 'split',
      direction: 'horizontal',
      sizes: [0.5, 0.5],
      children: [
        {
          type: 'pane',
          id: 'pane-local-1',
          pane: {
            id: 'pane-local-1',
            cwd: '/workspace/project',
            command: 'bash',
            status: WindowStatus.Running,
            pid: 101,
          },
        },
        {
          type: 'pane',
          id: 'code-1',
          pane: {
            id: 'code-1',
            kind: 'code',
            cwd: '/workspace/project',
            command: '',
            status: WindowStatus.Paused,
            pid: null,
            code: {
              rootPath: '/workspace/project',
              openFiles: [],
              activeFilePath: null,
              selectedPath: null,
              viewMode: 'editor',
              diffTargetPath: null,
            },
          },
        },
      ],
    },
  };
}

function createCodeActiveWindow(): Window {
  return {
    id: 'win-code-active-1',
    name: 'Code Active Window',
    activePaneId: 'code-1',
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
    layout: {
      type: 'split',
      direction: 'horizontal',
      sizes: [0.5, 0.5],
      children: [
        {
          type: 'pane',
          id: 'pane-local-1',
          pane: {
            id: 'pane-local-1',
            cwd: '/workspace/project',
            command: 'bash',
            status: WindowStatus.Running,
            pid: 101,
          },
        },
        {
          type: 'pane',
          id: 'code-1',
          pane: {
            id: 'code-1',
            kind: 'code',
            cwd: '/workspace/project',
            command: '',
            status: WindowStatus.Paused,
            pid: null,
            code: {
              rootPath: '/workspace/project',
              openFiles: [],
              activeFilePath: null,
              selectedPath: null,
              viewMode: 'editor',
              diffTargetPath: null,
            },
          },
        },
      ],
    },
  };
}

describe('TerminalView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = `<div id="${CUSTOM_TITLEBAR_ACTIONS_SLOT_ID}"></div>`;
    useWindowStore.setState({
      windows: [],
      groups: [],
      activeWindowId: null,
      activeGroupId: null,
      mruList: [],
      groupMruList: [],
      sidebarExpanded: false,
      sidebarWidth: 200,
    });
  });

  it('renders sidebar and local toolbar actions in normal mode', () => {
    render(
      <TerminalView
        window={createLocalWindow()}
        onReturn={vi.fn()}
        onWindowSwitch={vi.fn()}
        isActive
      />
    );

    expect(screen.getByTestId('sidebar')).toBeInTheDocument();
    expect(screen.getByTestId('split-layout')).toBeInTheDocument();
    expect(screen.getByTestId('terminal-floating-actions')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'terminalView.archive' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'terminalView.openFolder' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'terminalView.splitHorizontal' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'terminalView.splitVertical' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'terminalView.splitBrowser' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'terminalView.openCode' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'terminalView.splitChat' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'terminalView.splitCode' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'terminalView.stop' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'terminalView.restart' })).toBeInTheDocument();
  });

  it('renders floating actions expanded by default in the title bar', () => {
    render(
      <TerminalView
        window={createLocalWindow()}
        onReturn={vi.fn()}
        onWindowSwitch={vi.fn()}
        isActive
      />
    );

    const floatingActions = screen.getByTestId('terminal-floating-actions').firstElementChild as HTMLElement;
    expect(floatingActions).toHaveAttribute('aria-expanded', 'true');
  });

  it('does not render a non-interactive terminal logo inside floating actions', () => {
    render(
      <TerminalView
        window={createLocalWindow()}
        onReturn={vi.fn()}
        onWindowSwitch={vi.fn()}
        isActive
      />
    );

    const logo = screen.getByTestId('terminal-floating-actions').querySelector('[data-terminal-type-logo]');
    expect(logo).toBeNull();
  });

  it('does not mount remote tabs for local terminal windows', () => {
    render(
      <TerminalView
        window={createLocalWindow()}
        onReturn={vi.fn()}
        onWindowSwitch={vi.fn()}
        isActive
      />
    );

    expect(screen.queryByTestId('remote-window-tabs')).not.toBeInTheDocument();
  });

  it('does not render floating chrome for inactive mounted windows', () => {
    render(
      <TerminalView
        window={createLocalWindow()}
        onReturn={vi.fn()}
        onWindowSwitch={vi.fn()}
        isActive={false}
      />
    );

    expect(screen.getByTestId('split-layout')).toBeInTheDocument();
    expect(screen.queryByTestId('terminal-floating-actions')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'terminalView.archive' })).not.toBeInTheDocument();
  });

  it('shows start instead of stop and restart when the active pane is paused', () => {
    render(
      <TerminalView
        window={createLocalWindow(WindowStatus.Paused)}
        onReturn={vi.fn()}
        onWindowSwitch={vi.fn()}
        isActive
      />
    );

    expect(screen.queryByRole('button', { name: 'terminalView.stop' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'terminalView.restart' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'terminalView.start' })).toBeInTheDocument();
  });

  it('hides the sidebar in embedded mode', () => {
    render(
      <TerminalView
        window={createLocalWindow()}
        onReturn={vi.fn()}
        onWindowSwitch={vi.fn()}
        isActive
        embedded
      />
    );

    expect(screen.queryByTestId('sidebar')).not.toBeInTheDocument();
    expect(screen.getByTestId('split-layout')).toBeInTheDocument();
  });

  it('hides standalone chrome while docked into a canvas live block', () => {
    render(
      <TerminalView
        window={createLocalWindow()}
        onReturn={vi.fn()}
        onWindowSwitch={vi.fn()}
        isActive
        canvasLiveDocked
      />
    );

    expect(screen.queryByTestId('sidebar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('terminal-floating-actions')).not.toBeInTheDocument();
    expect(screen.getByTestId('split-layout')).toBeInTheDocument();
  });

  it('keeps canvas embedded pane exits inside the canvas instead of switching views', async () => {
    const currentWindow = createLocalWindow(WindowStatus.Running);
    const onReturn = vi.fn();
    const onWindowSwitch = vi.fn();

    useWindowStore.setState({
      windows: [currentWindow],
      activeWindowId: currentWindow.id,
      mruList: [currentWindow.id],
      sidebarExpanded: false,
      sidebarWidth: 200,
    });

    render(
      <TerminalView
        window={currentWindow}
        onReturn={onReturn}
        onWindowSwitch={onWindowSwitch}
        isActive
        embedded
        canvasEmbedded
      />
    );

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'exit-active-pane' }));
    });

    await waitFor(() => {
      expect(window.electronAPI.closeWindow).toHaveBeenCalledWith(currentWindow.id);
      expect(window.electronAPI.deleteWindow).toHaveBeenCalledWith(currentWindow.id);
    });

    expect(onReturn).not.toHaveBeenCalled();
    expect(onWindowSwitch).not.toHaveBeenCalled();
    const destroyedWindow = useWindowStore.getState().getWindowById(currentWindow.id);
    expect(destroyedWindow?.layout.type === 'pane' && destroyedWindow.layout.pane.status).toBe(WindowStatus.Completed);
  });

  it('cleans up inactive standalone pane exits without switching away from the current view', async () => {
    const inactiveWindow = createLocalWindow(WindowStatus.Running);
    const activeWindow: Window = {
      ...createLocalWindow(WindowStatus.Running),
      id: 'win-local-2',
      name: 'Active Window',
      activePaneId: 'pane-local-2',
      layout: {
        type: 'pane',
        id: 'pane-local-2',
        pane: {
          id: 'pane-local-2',
          cwd: '/workspace/other',
          command: 'bash',
          status: WindowStatus.Running,
          pid: 202,
        },
      },
    };
    const onReturn = vi.fn();
    const onWindowSwitch = vi.fn();

    useWindowStore.setState({
      windows: [inactiveWindow, activeWindow],
      activeWindowId: activeWindow.id,
      mruList: [activeWindow.id, inactiveWindow.id],
      sidebarExpanded: false,
      sidebarWidth: 200,
    });

    render(
      <TerminalView
        window={inactiveWindow}
        onReturn={onReturn}
        onWindowSwitch={onWindowSwitch}
        isActive={false}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'exit-active-pane' }));

    await waitFor(() => {
      expect(window.electronAPI.closeWindow).toHaveBeenCalledWith(inactiveWindow.id);
      expect(window.electronAPI.deleteWindow).toHaveBeenCalledWith(inactiveWindow.id);
    });

    expect(onWindowSwitch).not.toHaveBeenCalled();
    expect(onReturn).not.toHaveBeenCalled();
    expect(useWindowStore.getState().activeWindowId).toBe(activeWindow.id);
  });

  it('preserves inactive split layouts after a whole-window stop completes', () => {
    const inactiveWindow = createTwoTerminalPaneWindow({
      status: WindowStatus.Completed,
      secondStatus: WindowStatus.Completed,
    });
    const activeWindow: Window = {
      ...createLocalWindow(WindowStatus.Running),
      id: 'win-local-2',
      name: 'Active Window',
    };

    useWindowStore.setState({
      windows: [inactiveWindow, activeWindow],
      activeWindowId: activeWindow.id,
      mruList: [activeWindow.id, inactiveWindow.id],
      sidebarExpanded: false,
      sidebarWidth: 200,
    });

    render(
      <TerminalView
        window={inactiveWindow}
        onReturn={vi.fn()}
        onWindowSwitch={vi.fn()}
        isActive={false}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'exit-active-pane' }));

    const updatedWindow = useWindowStore.getState().getWindowById(inactiveWindow.id);
    expect(updatedWindow?.layout.type).toBe('split');
    expect(getAllPanes(updatedWindow!.layout).map((pane) => pane.id)).toEqual(['pane-local-1', 'pane-local-2']);
    expect(window.electronAPI.closePane).not.toHaveBeenCalled();
  });

  it('preserves inactive split layouts while whole-window stop is still pending', async () => {
    let resolveDeleteWindow: ((value: { success: true }) => void) | null = null;
    vi.mocked(window.electronAPI.deleteWindow).mockReturnValueOnce(new Promise((resolve) => {
      resolveDeleteWindow = resolve;
    }));

    const inactiveWindow = createTwoTerminalPaneWindow({
      status: WindowStatus.Running,
      secondStatus: WindowStatus.Running,
    });
    const activeWindow: Window = {
      ...createLocalWindow(WindowStatus.Running),
      id: 'win-local-2',
      name: 'Active Window',
    };

    useWindowStore.setState({
      windows: [inactiveWindow, activeWindow],
      activeWindowId: activeWindow.id,
      mruList: [activeWindow.id, inactiveWindow.id],
      sidebarExpanded: false,
      sidebarWidth: 200,
    });

    render(
      <TerminalView
        window={inactiveWindow}
        onReturn={vi.fn()}
        onWindowSwitch={vi.fn()}
        isActive={false}
      />
    );

    const destroyPromise = import('../../utils/windowDestruction').then(({ destroyWindowResourcesKeepRecord }) => (
      destroyWindowResourcesKeepRecord(inactiveWindow.id)
    ));

    await waitFor(() => {
      expect(window.electronAPI.closeWindow).toHaveBeenCalledWith(inactiveWindow.id);
      expect(window.electronAPI.deleteWindow).toHaveBeenCalledWith(inactiveWindow.id);
    });

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'exit-active-pane' }));
    });

    let updatedWindow = useWindowStore.getState().getWindowById(inactiveWindow.id);
    expect(updatedWindow?.layout.type).toBe('split');
    expect(getAllPanes(updatedWindow!.layout).map((pane) => pane.id)).toEqual(['pane-local-1', 'pane-local-2']);
    expect(window.electronAPI.closePane).not.toHaveBeenCalled();

    resolveDeleteWindow?.({ success: true });
    await destroyPromise;

    updatedWindow = useWindowStore.getState().getWindowById(inactiveWindow.id);
    expect(updatedWindow?.layout.type).toBe('split');
    expect(getAllPanes(updatedWindow!.layout).map((pane) => pane.status)).toEqual([
      WindowStatus.Completed,
      WindowStatus.Completed,
    ]);
  });

  it('preserves active split layouts while whole-window stop is still pending', async () => {
    let resolveDeleteWindow: ((value: { success: true }) => void) | null = null;
    vi.mocked(window.electronAPI.deleteWindow).mockReturnValueOnce(new Promise((resolve) => {
      resolveDeleteWindow = resolve;
    }));

    const currentWindow = createTwoTerminalPaneWindow({
      status: WindowStatus.Running,
      secondStatus: WindowStatus.Running,
    });

    useWindowStore.setState({
      windows: [currentWindow],
      activeWindowId: currentWindow.id,
      mruList: [currentWindow.id],
      sidebarExpanded: false,
      sidebarWidth: 200,
    });

    render(
      <TerminalView
        window={currentWindow}
        onReturn={vi.fn()}
        onWindowSwitch={vi.fn()}
        isActive
      />
    );

    const destroyPromise = import('../../utils/windowDestruction').then(({ destroyWindowResourcesKeepRecord }) => (
      destroyWindowResourcesKeepRecord(currentWindow.id)
    ));

    await waitFor(() => {
      expect(window.electronAPI.closeWindow).toHaveBeenCalledWith(currentWindow.id);
      expect(window.electronAPI.deleteWindow).toHaveBeenCalledWith(currentWindow.id);
    });

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'exit-active-pane' }));
    });

    let updatedWindow = useWindowStore.getState().getWindowById(currentWindow.id);
    expect(updatedWindow?.layout.type).toBe('split');
    expect(getAllPanes(updatedWindow!.layout).map((pane) => pane.id)).toEqual(['pane-local-1', 'pane-local-2']);
    expect(window.electronAPI.closePane).not.toHaveBeenCalled();

    resolveDeleteWindow?.({ success: true });
    await destroyPromise;

    updatedWindow = useWindowStore.getState().getWindowById(currentWindow.id);
    expect(updatedWindow?.layout.type).toBe('split');
    expect(getAllPanes(updatedWindow!.layout).map((pane) => pane.status)).toEqual([
      WindowStatus.Completed,
      WindowStatus.Completed,
    ]);
  });

  it('preserves active stopped split layouts when the terminal view is mounted again', () => {
    const stoppedWindow = createTwoTerminalPaneWindow({
      status: WindowStatus.Completed,
      secondStatus: WindowStatus.Completed,
    });

    useWindowStore.setState({
      windows: [stoppedWindow],
      activeWindowId: stoppedWindow.id,
      mruList: [stoppedWindow.id],
      sidebarExpanded: false,
      sidebarWidth: 200,
    });

    render(
      <TerminalView
        window={stoppedWindow}
        onReturn={vi.fn()}
        onWindowSwitch={vi.fn()}
        isActive
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'exit-active-pane' }));

    const updatedWindow = useWindowStore.getState().getWindowById(stoppedWindow.id);
    expect(updatedWindow?.layout.type).toBe('split');
    expect(getAllPanes(updatedWindow!.layout).map((pane) => pane.id)).toEqual(['pane-local-1', 'pane-local-2']);
    expect(window.electronAPI.closePane).not.toHaveBeenCalled();
  });

  it('still closes one inactive split pane when another terminal pane is still running', () => {
    const inactiveWindow = createTwoTerminalPaneWindow({
      status: WindowStatus.Completed,
      secondStatus: WindowStatus.Running,
    });
    const activeWindow: Window = {
      ...createLocalWindow(WindowStatus.Running),
      id: 'win-local-2',
      name: 'Active Window',
    };

    useWindowStore.setState({
      windows: [inactiveWindow, activeWindow],
      activeWindowId: activeWindow.id,
      mruList: [activeWindow.id, inactiveWindow.id],
      sidebarExpanded: false,
      sidebarWidth: 200,
    });

    render(
      <TerminalView
        window={inactiveWindow}
        onReturn={vi.fn()}
        onWindowSwitch={vi.fn()}
        isActive={false}
      />
    );

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'exit-active-pane' }));
    });

    const updatedWindow = useWindowStore.getState().getWindowById(inactiveWindow.id);
    expect(getAllPanes(updatedWindow!.layout).map((pane) => pane.id)).toEqual(['pane-local-2']);
    expect(window.electronAPI.closePane).toHaveBeenCalledWith(inactiveWindow.id, 'pane-local-1');
  });

  it('keeps remote tabs visible for embedded ssh windows even when inactive', () => {
    render(
      <TerminalView
        window={createSshWindow()}
        onReturn={vi.fn()}
        onWindowSwitch={vi.fn()}
        isActive={false}
        embedded
        groupId="group-1"
      />
    );

    expect(screen.getByTestId('terminal-remote-tabs-header')).toBeInTheDocument();
    expect(screen.getByTestId('remote-window-tabs')).toHaveAttribute('data-variant', 'windowHeader');
  });

  it('switches the active window inside a group when an embedded ssh remote tab is selected', async () => {
    const user = userEvent.setup();
    const ownerWindow = createSshWindow();
    const clonedWindow: Window = {
      ...createSshWindow(),
      id: 'win-ssh-2',
      name: 'SSH Window Clone',
      ephemeral: true,
      sshTabOwnerWindowId: ownerWindow.id,
    };
    const onWindowSwitch = vi.fn();
    const now = new Date().toISOString();
    const group = {
      id: 'group-1',
      name: 'SSH Group',
      activeWindowId: ownerWindow.id,
      createdAt: now,
      lastActiveAt: now,
      layout: {
        type: 'split' as const,
        direction: 'horizontal' as const,
        sizes: [0.5, 0.5],
        children: [
          { type: 'window' as const, id: ownerWindow.id },
          { type: 'window' as const, id: clonedWindow.id },
        ],
      },
    };

    useWindowStore.setState({
      windows: [ownerWindow, clonedWindow],
      groups: [group],
      activeGroupId: group.id,
    });

    render(
      <TerminalView
        window={ownerWindow}
        onReturn={vi.fn()}
        onWindowSwitch={onWindowSwitch}
        isActive={false}
        embedded
        groupId="group-1"
      />
    );

    await user.click(screen.getByRole('button', { name: 'SSH Window Clone' }));

    expect(useWindowStore.getState().groups[0]?.activeWindowId).toBe(clonedWindow.id);
    expect(useWindowStore.getState().activeGroupId).toBe(group.id);
    expect(onWindowSwitch).not.toHaveBeenCalled();
  });

  it('renders ssh-specific toolbar actions for ssh panes', () => {
    render(
      <TerminalView
        window={createSshWindow()}
        onReturn={vi.fn()}
        onWindowSwitch={vi.fn()}
        isActive
      />
    );

    expect(screen.getByRole('button', { name: 'terminalView.openSftp' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'terminalView.showSshMonitor' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'terminalView.managePortForwards' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'terminalView.splitChat' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'terminalView.openFolder' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'terminalView.openCode' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'terminalView.splitCode' })).not.toBeInTheDocument();
  });

  it('requests terminal refocus when closing settings from a terminal-active window', async () => {
    const user = userEvent.setup();
    const focusRequestListener = vi.fn();
    window.addEventListener(ACTIVE_TERMINAL_FOCUS_REQUEST_EVENT, focusRequestListener);

    render(
      <TerminalView
        window={createLocalWindow()}
        onReturn={vi.fn()}
        onWindowSwitch={vi.fn()}
        isActive
      />
    );

    await user.click(screen.getByRole('button', { name: 'open-settings' }));
    expect(await screen.findByTestId('settings-panel')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'close-settings-panel' }));

    await waitFor(() => {
      expect(focusRequestListener).toHaveBeenCalledTimes(1);
    });

    const customEvent = focusRequestListener.mock.calls[0]?.[0] as CustomEvent<{ windowId: string; paneId?: string; defer?: boolean }>;
    expect(customEvent.detail).toEqual({
      windowId: 'win-local-1',
      paneId: 'pane-local-1',
      defer: true,
    });

    window.removeEventListener(ACTIVE_TERMINAL_FOCUS_REQUEST_EVENT, focusRequestListener);
  });

  it('does not request terminal refocus when closing settings from a code-active window', async () => {
    const user = userEvent.setup();
    const focusRequestListener = vi.fn();
    window.addEventListener(ACTIVE_TERMINAL_FOCUS_REQUEST_EVENT, focusRequestListener);

    render(
      <TerminalView
        window={createCodeActiveWindow()}
        onReturn={vi.fn()}
        onWindowSwitch={vi.fn()}
        isActive
      />
    );

    await user.click(screen.getByRole('button', { name: 'open-settings' }));
    expect(await screen.findByTestId('settings-panel')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'close-settings-panel' }));

    await waitFor(() => {
      expect(screen.queryByTestId('settings-panel')).not.toBeInTheDocument();
    });

    expect(focusRequestListener).not.toHaveBeenCalled();
    window.removeEventListener(ACTIVE_TERMINAL_FOCUS_REQUEST_EVENT, focusRequestListener);
  });

  it('does not render the window identity pill when the active pane is a browser pane', () => {
    render(
      <TerminalView
        window={createBrowserOnlyWindow('local')}
        onReturn={vi.fn()}
        onWindowSwitch={vi.fn()}
        isActive
      />
    );

    expect(screen.queryByTestId('toolbar-window-identity')).not.toBeInTheDocument();
  });

  it('keeps the sidebar code pane action disabled when no local project root is available', () => {
    render(
      <TerminalView
        window={createBrowserOnlyWindow('local')}
        onReturn={vi.fn()}
        onWindowSwitch={vi.fn()}
        isActive
      />
    );

    expect(screen.getByRole('button', { name: 'terminalView.openCode' })).toBeDisabled();
  });

  it('does not close a terminal pane when that would leave only browser panes', () => {
    const windowWithBrowsers = createTerminalWithTwoBrowsersWindow();
    useWindowStore.setState({
      windows: [windowWithBrowsers],
      activeWindowId: windowWithBrowsers.id,
      mruList: [],
      sidebarExpanded: false,
      sidebarWidth: 200,
    });

    render(
      <TerminalView
        window={windowWithBrowsers}
        onReturn={vi.fn()}
        onWindowSwitch={vi.fn()}
        isActive
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'close-active-pane' }));

    expect(window.electronAPI.closePane).not.toHaveBeenCalled();
  });

  it('does not close a terminal pane when that would leave only code panes', () => {
    const windowWithCodePane = createTerminalWithCodePaneWindow();
    useWindowStore.setState({
      windows: [windowWithCodePane],
      activeWindowId: windowWithCodePane.id,
      mruList: [],
      sidebarExpanded: false,
      sidebarWidth: 200,
    });

    render(
      <TerminalView
        window={windowWithCodePane}
        onReturn={vi.fn()}
        onWindowSwitch={vi.fn()}
        isActive
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'close-active-pane' }));

    expect(window.electronAPI.closePane).not.toHaveBeenCalled();
  });

  it('creates a linked chat pane from the ssh toolbar', () => {
    const sshWindow = createSshWindow();
    const linkedPaneId = sshWindow.activePaneId;
    useWindowStore.setState({
      windows: [sshWindow],
      activeWindowId: sshWindow.id,
      mruList: [sshWindow.id],
      sidebarExpanded: false,
      sidebarWidth: 200,
    });

    render(
      <TerminalView
        window={sshWindow}
        onReturn={vi.fn()}
        onWindowSwitch={vi.fn()}
        isActive
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'terminalView.splitChat' }));

    const updatedWindow = useWindowStore.getState().getWindowById(sshWindow.id);
    expect(updatedWindow).toBeDefined();
    expect(updatedWindow?.layout.type).toBe('split');
    if (updatedWindow?.layout.type === 'split') {
      expect(updatedWindow.layout.sizes).toEqual([0.7, 0.3]);
    }

    const panes = getAllPanes(updatedWindow!.layout);
    const chatPane = panes.find((pane) => pane.kind === 'chat');
    expect(chatPane).toBeDefined();
    expect(chatPane?.chat?.linkedPaneId).toBe(linkedPaneId);
    expect(updatedWindow?.activePaneId).toBe(chatPane?.id);
  });

  it('creates a chat pane from the ssh pane in a mixed window', () => {
    const mixedWindow = {
      ...createMixedLocalAndSshWindow(),
      activePaneId: 'pane-ssh-1',
    };
    useWindowStore.setState({
      windows: [mixedWindow],
      activeWindowId: mixedWindow.id,
      mruList: [mixedWindow.id],
      sidebarExpanded: false,
      sidebarWidth: 200,
    });

    render(
      <TerminalView
        window={mixedWindow}
        onReturn={vi.fn()}
        onWindowSwitch={vi.fn()}
        isActive
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'terminalView.splitChat' }));

    const updatedWindow = useWindowStore.getState().getWindowById(mixedWindow.id);
    const panes = getAllPanes(updatedWindow!.layout);
    const chatPane = panes.find((pane) => pane.kind === 'chat');

    expect(chatPane?.chat?.linkedPaneId).toBe('pane-ssh-1');
  });

  it('does not offer a second chat pane when the window already has one', () => {
    const sshWindow = createSshWindowWithChatPane('pane-ssh-1');
    useWindowStore.setState({
      windows: [sshWindow],
      activeWindowId: sshWindow.id,
      mruList: [sshWindow.id],
      sidebarExpanded: false,
      sidebarWidth: 200,
    });

    render(
      <TerminalView
        window={sshWindow}
        onReturn={vi.fn()}
        onWindowSwitch={vi.fn()}
        isActive
      />
    );

    expect(screen.queryByRole('button', { name: 'terminalView.splitChat' })).not.toBeInTheDocument();
  });

  it('does not split a chat pane into another chat pane', () => {
    const sshWindow = createSshWindowWithChatPane('pane-chat-1');
    useWindowStore.setState({
      windows: [sshWindow],
      activeWindowId: sshWindow.id,
      mruList: [sshWindow.id],
      sidebarExpanded: false,
      sidebarWidth: 200,
    });

    render(
      <TerminalView
        window={sshWindow}
        onReturn={vi.fn()}
        onWindowSwitch={vi.fn()}
        isActive
      />
    );

    const splitHorizontalButton = screen.getByRole('button', { name: 'terminalView.splitHorizontal' });
    expect(splitHorizontalButton).toBeDisabled();

    fireEvent.click(splitHorizontalButton);

    const updatedWindow = useWindowStore.getState().getWindowById(sshWindow.id);
    const panes = getAllPanes(updatedWindow!.layout);
    expect(panes.filter((pane) => pane.kind === 'chat')).toHaveLength(1);
  });

  it('opens a code pane from the sidebar and places it on the left', () => {
    const localWindow = createLocalWindow();
    useWindowStore.setState({
      windows: [localWindow],
      activeWindowId: localWindow.id,
      mruList: [localWindow.id],
      sidebarExpanded: false,
      sidebarWidth: 200,
    });

    render(
      <TerminalView
        window={localWindow}
        onReturn={vi.fn()}
        onWindowSwitch={vi.fn()}
        isActive
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'terminalView.openCode' }));

    const updatedWindow = useWindowStore.getState().getWindowById(localWindow.id);
    expect(updatedWindow).toBeDefined();
    expect(updatedWindow?.layout.type).toBe('split');

    const panes = getAllPanes(updatedWindow!.layout);
    const codePane = panes.find((pane) => pane.kind === 'code');
    expect(codePane).toBeDefined();
    expect(codePane?.code?.rootPath).toBe('/workspace/project');
    expect(updatedWindow?.activePaneId).toBe(codePane?.id);

    if (updatedWindow?.layout.type === 'split') {
      expect(updatedWindow.layout.sizes).toEqual([0.7, 0.3]);
      expect(updatedWindow.layout.children[0]).toMatchObject({
        type: 'pane',
        pane: {
          kind: 'code',
        },
      });
    }
  });

  it('reuses the existing code pane instead of opening a second one', () => {
    const windowWithCodePane = createTerminalWithCodePaneWindow();
    useWindowStore.setState({
      windows: [windowWithCodePane],
      activeWindowId: windowWithCodePane.id,
      mruList: [windowWithCodePane.id],
      sidebarExpanded: false,
      sidebarWidth: 200,
    });

    render(
      <TerminalView
        window={windowWithCodePane}
        onReturn={vi.fn()}
        onWindowSwitch={vi.fn()}
        isActive
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'terminalView.openCode' }));

    const updatedWindow = useWindowStore.getState().getWindowById(windowWithCodePane.id);
    const panes = getAllPanes(updatedWindow!.layout);
    const codePanes = panes.filter((pane) => pane.kind === 'code');

    expect(codePanes).toHaveLength(1);
    expect(updatedWindow?.activePaneId).toBe('code-1');
    if (updatedWindow?.layout.type === 'split') {
      expect(updatedWindow.layout.sizes).toEqual([0.3, 0.7]);
    }
  });

  it('prevents mouse focus on toolbar action buttons', () => {
    render(
      <TerminalView
        window={createLocalWindow()}
        onReturn={vi.fn()}
        onWindowSwitch={vi.fn()}
        isActive
      />
    );

    const archiveButton = screen.getByRole('button', { name: 'terminalView.archive' });
    expect(archiveButton).toHaveAttribute('tabIndex', '-1');

    const mouseDownEvent = createEvent.mouseDown(archiveButton);
    fireEvent(archiveButton, mouseDownEvent);

    expect(mouseDownEvent.defaultPrevented).toBe(true);
  });

  it('returns to unified view after archive when only paused windows remain', async () => {
    const currentWindow = createLocalWindow(WindowStatus.Running);
    const pausedWindow: Window = {
      ...createLocalWindow(WindowStatus.Paused),
      id: 'win-local-2',
      name: 'Paused Window',
      layout: {
        type: 'pane',
        id: 'pane-local-2',
        pane: {
          id: 'pane-local-2',
          cwd: '/workspace/paused',
          command: 'bash',
          status: WindowStatus.Paused,
          pid: null,
        },
      },
      activePaneId: 'pane-local-2',
    };
    const onReturn = vi.fn();
    const onWindowSwitch = vi.fn();

    useWindowStore.setState({
      windows: [currentWindow, pausedWindow],
      activeWindowId: currentWindow.id,
      mruList: [currentWindow.id, pausedWindow.id],
      sidebarExpanded: false,
      sidebarWidth: 200,
    });

    render(
      <TerminalView
        window={currentWindow}
        onReturn={onReturn}
        onWindowSwitch={onWindowSwitch}
        isActive
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'terminalView.archive' }));

    await waitFor(() => {
      expect(window.electronAPI.closeWindow).toHaveBeenCalledWith(currentWindow.id);
      expect(onReturn).toHaveBeenCalledTimes(1);
    });

    expect(onWindowSwitch).not.toHaveBeenCalled();
    expect(useWindowStore.getState().windows.find((window) => window.id === currentWindow.id)?.archived).toBe(true);
    expect(useWindowStore.getState().windows.find((window) => window.id === pausedWindow.id)?.archived).not.toBe(true);
  });

  it('skips paused windows when choosing the next window after archive', async () => {
    vi.useFakeTimers();

    try {
      const currentWindow = createLocalWindow(WindowStatus.Running);
      const pausedWindow: Window = {
        ...createLocalWindow(WindowStatus.Paused),
        id: 'win-local-2',
        name: 'Paused Window',
        layout: {
          type: 'pane',
          id: 'pane-local-2',
          pane: {
            id: 'pane-local-2',
            cwd: '/workspace/paused',
            command: 'bash',
            status: WindowStatus.Paused,
            pid: null,
          },
        },
        activePaneId: 'pane-local-2',
      };
      const runningWindow: Window = {
        ...createLocalWindow(WindowStatus.Running),
        id: 'win-local-3',
        name: 'Running Window',
        layout: {
          type: 'pane',
          id: 'pane-local-3',
          pane: {
            id: 'pane-local-3',
            cwd: '/workspace/running',
            command: 'bash',
            status: WindowStatus.Running,
            pid: 303,
          },
        },
        activePaneId: 'pane-local-3',
      };
      const onReturn = vi.fn();
      const onWindowSwitch = vi.fn();

      useWindowStore.setState({
        windows: [currentWindow, pausedWindow, runningWindow],
        activeWindowId: currentWindow.id,
        mruList: [currentWindow.id, pausedWindow.id, runningWindow.id],
        sidebarExpanded: false,
        sidebarWidth: 200,
      });

      render(
        <TerminalView
          window={currentWindow}
          onReturn={onReturn}
          onWindowSwitch={onWindowSwitch}
          isActive
        />
      );

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'terminalView.archive' }));
        await vi.advanceTimersByTimeAsync(100);
      });

      expect(onWindowSwitch).toHaveBeenCalledWith(runningWindow.id, { exact: true });
      expect(onWindowSwitch).not.toHaveBeenCalledWith(pausedWindow.id);
      expect(window.electronAPI.closeWindow).toHaveBeenCalledWith(currentWindow.id);

      expect(onReturn).not.toHaveBeenCalled();
      expect(useWindowStore.getState().windows.find((window) => window.id === currentWindow.id)?.archived).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('destroys the current window resources without removing its record when stop is clicked', async () => {
    vi.useFakeTimers();

    try {
      const currentWindow = createLocalWindow(WindowStatus.Running);
      const pausedWindow: Window = {
        ...createLocalWindow(WindowStatus.Paused),
        id: 'win-local-2',
        name: 'Paused Window',
        layout: {
          type: 'pane',
          id: 'pane-local-2',
          pane: {
            id: 'pane-local-2',
            cwd: '/workspace/paused',
            command: 'bash',
            status: WindowStatus.Paused,
            pid: null,
          },
        },
        activePaneId: 'pane-local-2',
      };
      const runningWindow: Window = {
        ...createLocalWindow(WindowStatus.WaitingForInput),
        id: 'win-local-3',
        name: 'Waiting Window',
        layout: {
          type: 'pane',
          id: 'pane-local-3',
          pane: {
            id: 'pane-local-3',
            cwd: '/workspace/waiting',
            command: 'bash',
            status: WindowStatus.WaitingForInput,
            pid: 303,
          },
        },
        activePaneId: 'pane-local-3',
      };
      const onReturn = vi.fn();
      const onWindowSwitch = vi.fn();

      useWindowStore.setState({
        windows: [currentWindow, pausedWindow, runningWindow],
        activeWindowId: currentWindow.id,
        mruList: [currentWindow.id, pausedWindow.id, runningWindow.id],
        sidebarExpanded: false,
        sidebarWidth: 200,
      });

      render(
        <TerminalView
          window={currentWindow}
          onReturn={onReturn}
          onWindowSwitch={onWindowSwitch}
          isActive
        />
      );

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'terminalView.stop' }));
        await vi.advanceTimersByTimeAsync(100);
      });

      expect(onWindowSwitch).toHaveBeenCalledWith(runningWindow.id, { exact: true });
      expect(onWindowSwitch).not.toHaveBeenCalledWith(pausedWindow.id);
      expect(window.electronAPI.closeWindow).toHaveBeenCalledWith(currentWindow.id);
      expect(window.electronAPI.deleteWindow).toHaveBeenCalledWith(currentWindow.id);
      const destroyedWindow = useWindowStore.getState().windows.find((window) => window.id === currentWindow.id);
      expect(destroyedWindow).toBeDefined();
      expect(destroyedWindow?.layout.type === 'pane' && destroyedWindow.layout.pane.status).toBe(WindowStatus.Completed);
      expect(destroyedWindow?.layout.type === 'pane' && destroyedWindow.layout.pane.pid).toBeNull();
      expect(onReturn).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('restarts a running window without deleting its record', async () => {
    const currentWindow = createLocalWindow(WindowStatus.Running);

    vi.mocked(window.electronAPI.startWindow).mockResolvedValueOnce({
      success: true,
      data: {
        pid: 404,
        sessionId: 'session-404',
        status: WindowStatus.WaitingForInput,
      },
    });

    useWindowStore.setState({
      windows: [currentWindow],
      activeWindowId: currentWindow.id,
      mruList: [currentWindow.id],
      sidebarExpanded: false,
      sidebarWidth: 200,
    });

    render(
      <TerminalView
        window={currentWindow}
        onReturn={vi.fn()}
        onWindowSwitch={vi.fn()}
        isActive
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'terminalView.restart' }));

    await waitFor(() => {
      expect(window.electronAPI.closeWindow).toHaveBeenCalledWith(currentWindow.id);
      expect(window.electronAPI.startWindow).toHaveBeenCalled();
    });

    expect(window.electronAPI.deleteWindow).toHaveBeenCalledWith(currentWindow.id);
    expect(useWindowStore.getState().windows.find((window) => window.id === currentWindow.id)).toBeDefined();
  });

  it('does not remove the window record when destroy IPC fails', async () => {
    const currentWindow = createLocalWindow(WindowStatus.Running);

    vi.mocked(window.electronAPI.closeWindow).mockResolvedValueOnce({ success: true });
    vi.mocked(window.electronAPI.deleteWindow).mockResolvedValueOnce({
      success: false,
      error: 'delete failed',
    });

    useWindowStore.setState({
      windows: [currentWindow],
      activeWindowId: currentWindow.id,
      mruList: [currentWindow.id],
      sidebarExpanded: false,
      sidebarWidth: 200,
    });

    render(
      <TerminalView
        window={currentWindow}
        onReturn={vi.fn()}
        onWindowSwitch={vi.fn()}
        isActive
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'terminalView.stop' }));

    await waitFor(() => {
      expect(window.electronAPI.deleteWindow).toHaveBeenCalledWith(currentWindow.id);
    });

    expect(useWindowStore.getState().windows.find((window) => window.id === currentWindow.id)).toBeDefined();
  });
});
