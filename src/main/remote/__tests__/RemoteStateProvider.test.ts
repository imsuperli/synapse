import { describe, expect, it, vi } from 'vitest';
import { ProcessStatus } from '../../types/process';
import { WindowStatus, type Window } from '../../../shared/types/window';
import type { Workspace } from '../../types/workspace';
import { RemoteStateProvider } from '../RemoteStateProvider';

describe('RemoteStateProvider', () => {
  it('returns safe window and pane summaries from main-owned workspace state', () => {
    const workspace = createWorkspace();
    const processManager = {
      listProcesses: vi.fn(() => [
        {
          windowId: 'win-1',
          paneId: 'pane-terminal',
          pid: 456,
          sessionId: 'live-session',
          status: ProcessStatus.Alive,
        },
      ]),
    };
    const provider = new RemoteStateProvider({
      getCurrentWorkspace: () => workspace,
      processManager: processManager as any,
    });

    expect(provider.listWindows()).toEqual({
      windows: [
        {
          windowId: 'win-1',
          name: 'Project',
          kind: 'mixed',
          archived: false,
          activePaneId: 'pane-code',
          createdAt: '2026-07-08T00:00:00.000Z',
          lastActiveAt: '2026-07-08T01:00:00.000Z',
          paneCount: 2,
          terminalPaneCount: 1,
          panes: [
            {
              windowId: 'win-1',
              paneId: 'pane-terminal',
              active: false,
              kind: 'terminal',
              backend: 'ssh',
              status: WindowStatus.WaitingForInput,
              running: true,
              pid: 456,
              sessionId: 'live-session',
              cwd: '/repo',
              command: 'bash',
              title: 'Shell',
            },
            {
              windowId: 'win-1',
              paneId: 'pane-code',
              active: true,
              kind: 'code',
              backend: null,
              status: WindowStatus.Completed,
              running: false,
              pid: null,
              sessionId: null,
              cwd: null,
              command: null,
            },
          ],
        },
      ],
      groups: [],
    });
  });

  it('filters archived windows and terminal-only panes', () => {
    const workspace = createWorkspace();
    const provider = new RemoteStateProvider({
      getCurrentWorkspace: () => workspace,
      processManager: { listProcesses: vi.fn(() => []) } as any,
    });

    expect(provider.listWindows({ terminalOnly: true })).toMatchObject({
      windows: [
        {
          windowId: 'win-1',
          paneCount: 2,
          terminalPaneCount: 1,
          panes: [
            {
              paneId: 'pane-terminal',
              kind: 'terminal',
              pid: 111,
              sessionId: 'stored-session',
            },
          ],
        },
      ],
    });

    expect(provider.listWindows({ includeArchived: true }).windows.map((window) => window.windowId)).toEqual([
      'win-1',
      'win-archived',
    ]);
  });

  it('includes group summaries with current member window state', () => {
    const workspace = createWorkspace();
    workspace.windows.push(createTerminalWindow('win-local', 'Local'));
    workspace.groups = [
      createGroupFixture('group-1', ['win-1', 'win-local']),
    ];
    const provider = new RemoteStateProvider({
      getCurrentWorkspace: () => workspace,
      processManager: { listProcesses: vi.fn(() => []) } as any,
    });

    expect(provider.listWindows({ terminalOnly: true }).groups).toEqual([
      expect.objectContaining({
        groupId: 'group-1',
        name: 'Mobile Group',
        activeWindowId: 'win-1',
        windowCount: 2,
        windows: [
          expect.objectContaining({ windowId: 'win-1', panes: [expect.objectContaining({ paneId: 'pane-terminal' })] }),
          expect.objectContaining({ windowId: 'win-local', panes: [expect.objectContaining({ paneId: 'win-local-pane' })] }),
        ],
      }),
    ]);
  });

  it('lists panes for a single window without exposing non-terminal internal state', () => {
    const workspace = createWorkspace();
    const provider = new RemoteStateProvider({
      getCurrentWorkspace: () => workspace,
      processManager: { listProcesses: vi.fn(() => []) } as any,
    });

    expect(provider.listPanes({ windowId: 'win-1' })).toEqual({
      panes: [
        expect.objectContaining({
          windowId: 'win-1',
          paneId: 'pane-terminal',
          cwd: '/repo',
          command: 'bash',
        }),
        expect.objectContaining({
          windowId: 'win-1',
          paneId: 'pane-code',
          kind: 'code',
          cwd: null,
          command: null,
        }),
      ],
    });
  });

  it('returns empty lists when no workspace is loaded', () => {
    const provider = new RemoteStateProvider({
      getCurrentWorkspace: () => null,
      processManager: { listProcesses: vi.fn(() => []) } as any,
    });

    expect(provider.listWindows()).toEqual({ windows: [], groups: [] });
    expect(provider.listPanes()).toEqual({ panes: [] });
  });

  it('starts a stopped local terminal pane and updates workspace state', async () => {
    const workspace = createWorkspace();
    workspace.windows.push(createTerminalWindow('win-local', 'Local'));
    const processes: Array<{
      windowId: string;
      paneId: string;
      pid: number;
      sessionId: string;
      status: ProcessStatus;
    }> = [];
    const startLocalTerminalPane = vi.fn(async (params) => {
      processes.push({
        windowId: params.windowId,
        paneId: params.paneId,
        pid: 222,
        sessionId: 'session-222',
        status: ProcessStatus.Alive,
      });
      return {
        pid: 222,
        sessionId: 'session-222',
        status: WindowStatus.WaitingForInput,
      };
    });
    const provider = new RemoteStateProvider({
      getCurrentWorkspace: () => workspace,
      processManager: { listProcesses: vi.fn(() => processes) } as any,
      startLocalTerminalPane,
    });

    const result = await provider.startWindow({ windowId: 'win-local' });

    expect(startLocalTerminalPane).toHaveBeenCalledWith(
      expect.objectContaining({
        windowId: 'win-local',
        paneId: 'win-local-pane',
        workingDirectory: '/archived',
        command: 'bash',
      }),
    );
    expect(result.pane).toMatchObject({
      windowId: 'win-local',
      paneId: 'win-local-pane',
      running: true,
      pid: 222,
      sessionId: 'session-222',
      status: WindowStatus.WaitingForInput,
    });
    expect(workspace.windows.find((window) => window.id === 'win-local')?.layout).toMatchObject({
      pane: {
        pid: 222,
        sessionId: 'session-222',
        status: WindowStatus.WaitingForInput,
        command: 'bash',
      },
    });
  });

  it('creates a new local terminal window and reports it through the mobile summary shape', async () => {
    const workspace = createWorkspace();
    const processes: Array<{
      windowId: string;
      paneId: string;
      pid: number;
      sessionId: string;
      status: ProcessStatus;
    }> = [];
    const startLocalTerminalPane = vi.fn(async (params) => {
      processes.push({
        windowId: params.windowId,
        paneId: params.paneId,
        pid: 333,
        sessionId: 'session-333',
        status: ProcessStatus.Alive,
      });
      return {
        pid: 333,
        sessionId: 'session-333',
        status: WindowStatus.WaitingForInput,
        command: params.command || 'bash',
      };
    });
    const onWindowCreated = vi.fn();
    const provider = new RemoteStateProvider({
      getCurrentWorkspace: () => workspace,
      processManager: { listProcesses: vi.fn(() => processes) } as any,
      startLocalTerminalPane,
      onWindowCreated,
    });

    const result = await provider.createWindow({ name: 'Mobile Shell', workingDirectory: '/repo' });

    expect(startLocalTerminalPane).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Mobile Shell',
        workingDirectory: '/repo',
      }),
    );
    expect(result.window).toMatchObject({
      name: 'Mobile Shell',
      terminalPaneCount: 1,
    });
    expect(result.pane).toMatchObject({
      running: true,
      pid: 333,
      sessionId: 'session-333',
      cwd: '/repo',
      command: 'bash',
    });
    expect(workspace.windows.at(-1)).toMatchObject({
      name: 'Mobile Shell',
      layout: {
        pane: {
          cwd: '/repo',
          pid: 333,
          sessionId: 'session-333',
          command: 'bash',
        },
      },
    });
    expect(onWindowCreated).toHaveBeenCalledWith({
      window: workspace.windows.at(-1),
      workspace,
    });
  });

  it('rolls back the inserted window when remote window creation fails', async () => {
    const workspace = createWorkspace();
    const originalWindowCount = workspace.windows.length;
    const provider = new RemoteStateProvider({
      getCurrentWorkspace: () => workspace,
      processManager: { listProcesses: vi.fn(() => []) } as any,
      startLocalTerminalPane: vi.fn(async () => {
        throw new Error('spawn_failed');
      }),
    });

    await expect(provider.createWindow({ workingDirectory: '/repo' })).rejects.toThrow(
      'spawn_failed',
    );
    expect(workspace.windows).toHaveLength(originalWindowCount);
  });

  it('rejects starting stopped SSH panes from the mobile remote path', async () => {
    const workspace = createWorkspace();
    const provider = new RemoteStateProvider({
      getCurrentWorkspace: () => workspace,
      processManager: { listProcesses: vi.fn(() => []) } as any,
      startLocalTerminalPane: vi.fn(),
    });

    await expect(
      provider.startWindow({ windowId: 'win-1', paneId: 'pane-terminal' }),
    ).rejects.toThrow('remote_start_ssh_not_supported');
  });

  it('stops a single pane while keeping the window record restartable', async () => {
    const workspace = createWorkspace();
    workspace.windows.push(createRunningTerminalWindow('win-local', 'Local'));
    const stopWindowPanes = vi.fn();
    const onWindowRuntimeUpdated = vi.fn();
    const provider = new RemoteStateProvider({
      getCurrentWorkspace: () => workspace,
      processManager: { listProcesses: vi.fn(() => []) } as any,
      stopWindowPanes,
      onWindowRuntimeUpdated,
    });

    const result = await provider.closePane({
      windowId: 'win-local',
      paneId: 'win-local-pane',
    });

    expect(stopWindowPanes).toHaveBeenCalledWith({
      windowId: 'win-local',
      paneIds: ['win-local-pane'],
    });
    expect(result.pane).toMatchObject({
      paneId: 'win-local-pane',
      running: false,
      pid: null,
      sessionId: null,
      status: WindowStatus.Completed,
    });
    expect(workspace.windows.find((window) => window.id === 'win-local')?.layout).toMatchObject({
      pane: {
        status: WindowStatus.Completed,
        pid: null,
        sessionId: undefined,
      },
    });
    expect(onWindowRuntimeUpdated).toHaveBeenCalledWith({
      window: workspace.windows.find((window) => window.id === 'win-local'),
      workspace,
    });
  });

  it('stops every terminal pane in a window', async () => {
    const workspace = createWorkspace();
    workspace.windows.push(createRunningTerminalWindow('win-local', 'Local'));
    const stopWindowPanes = vi.fn();
    const provider = new RemoteStateProvider({
      getCurrentWorkspace: () => workspace,
      processManager: { listProcesses: vi.fn(() => []) } as any,
      stopWindowPanes,
    });

    const result = await provider.closeWindow({ windowId: 'win-local' });

    expect(stopWindowPanes).toHaveBeenCalledWith({
      windowId: 'win-local',
      paneIds: ['win-local-pane'],
    });
    expect(result.stoppedPanes).toEqual([
      expect.objectContaining({
        paneId: 'win-local-pane',
        running: false,
        status: WindowStatus.Completed,
      }),
    ]);
  });

  it('deletes a window and removes dissolved group references', async () => {
    const workspace = createWorkspace();
    workspace.windows.push(createRunningTerminalWindow('win-local', 'Local'));
    workspace.windows.push(createTerminalWindow('win-peer', 'Peer'));
    workspace.groups = [
      createGroupFixture('group-1', ['win-local', 'win-peer']),
    ];
    const stopWindowPanes = vi.fn();
    const onWindowDeleted = vi.fn();
    const onWorkspaceLayoutUpdated = vi.fn();
    const provider = new RemoteStateProvider({
      getCurrentWorkspace: () => workspace,
      processManager: { listProcesses: vi.fn(() => []) } as any,
      stopWindowPanes,
      onWindowDeleted,
      onWorkspaceLayoutUpdated,
    });

    const result = await provider.deleteWindow({ windowId: 'win-local' });

    expect(result).toEqual({
      deleted: true,
      windowId: 'win-local',
      groups: [],
    });
    expect(stopWindowPanes).toHaveBeenCalledWith({
      windowId: 'win-local',
      paneIds: ['win-local-pane'],
    });
    expect(workspace.windows.map((window) => window.id)).not.toContain('win-local');
    expect(workspace.groups).toEqual([]);
    expect(onWindowDeleted).toHaveBeenCalledWith({
      windowId: 'win-local',
      paneIds: ['win-local-pane'],
      workspace,
    });
    expect(onWorkspaceLayoutUpdated).toHaveBeenCalledWith({ workspace });
  });

  it('creates and deletes groups from mobile window-control requests', async () => {
    const workspace = createWorkspace();
    workspace.windows.push(createTerminalWindow('win-local', 'Local'));
    workspace.windows.push(createTerminalWindow('win-peer', 'Peer'));
    const onWorkspaceLayoutUpdated = vi.fn();
    const provider = new RemoteStateProvider({
      getCurrentWorkspace: () => workspace,
      processManager: { listProcesses: vi.fn(() => []) } as any,
      onWorkspaceLayoutUpdated,
    });

    const createResult = await provider.createGroup({
      name: 'Phone Group',
      windowIds: ['win-local', 'win-peer', 'win-local'],
    });

    expect(createResult.group).toMatchObject({
      name: 'Phone Group',
      activeWindowId: 'win-local',
      windowCount: 2,
      windows: [
        expect.objectContaining({ windowId: 'win-local' }),
        expect.objectContaining({ windowId: 'win-peer' }),
      ],
    });
    expect(workspace.groups).toHaveLength(1);
    expect(workspace.groups[0]?.layout).toMatchObject({
      type: 'split',
      direction: 'horizontal',
      children: [
        { type: 'window', id: 'win-local' },
        { type: 'window', id: 'win-peer' },
      ],
    });
    expect(onWorkspaceLayoutUpdated).toHaveBeenCalledWith({ workspace });

    const groupId = createResult.group.groupId;
    await expect(provider.deleteGroup({ groupId })).resolves.toEqual({
      deleted: true,
      groupId,
    });
    expect(workspace.groups).toEqual([]);
  });
});

function createWorkspace(): Workspace {
  return {
    version: '1',
    windows: [
      createMixedWindow(),
      {
        ...createTerminalWindow('win-archived', 'Archived'),
        archived: true,
      },
    ],
    groups: [],
    canvasWorkspaces: [],
    settings: {} as Workspace['settings'],
    lastSavedAt: '2026-07-08T01:00:00.000Z',
  };
}

function createMixedWindow(): Window {
  return {
    id: 'win-1',
    name: 'Project',
    kind: 'mixed',
    activePaneId: 'pane-code',
    createdAt: '2026-07-08T00:00:00.000Z',
    lastActiveAt: '2026-07-08T01:00:00.000Z',
    layout: {
      type: 'split',
      direction: 'horizontal',
      sizes: [0.5, 0.5],
      children: [
        {
          type: 'pane',
          id: 'pane-terminal',
          pane: {
            id: 'pane-terminal',
            kind: 'terminal',
            backend: 'ssh',
            cwd: '/repo',
            command: 'bash',
            status: WindowStatus.WaitingForInput,
            pid: 111,
            sessionId: 'stored-session',
            title: 'Shell',
            ssh: {
              profileId: 'prod',
              host: 'example.com',
              port: 22,
              user: 'deploy',
              authType: 'key',
              routingMode: 'direct',
            },
          },
        },
        {
          type: 'pane',
          id: 'pane-code',
          pane: {
            id: 'pane-code',
            kind: 'code',
            cwd: '/repo',
            command: '',
            status: WindowStatus.Completed,
            pid: null,
            code: {
              rootPath: '/repo',
              openFiles: [{ path: '/repo/secret.ts' }],
              activeFilePath: '/repo/secret.ts',
            },
          },
        },
      ],
    },
  };
}

function createTerminalWindow(id: string, name: string): Window {
  return {
    id,
    name,
    activePaneId: `${id}-pane`,
    createdAt: '2026-07-08T00:00:00.000Z',
    lastActiveAt: '2026-07-08T01:00:00.000Z',
    layout: {
      type: 'pane',
      id: `${id}-pane`,
      pane: {
        id: `${id}-pane`,
        cwd: '/archived',
        command: 'bash',
        status: WindowStatus.Completed,
        pid: null,
        backend: 'local',
      },
    },
  };
}

function createRunningTerminalWindow(id: string, name: string): Window {
  const window = createTerminalWindow(id, name);
  if (window.layout.type === 'pane') {
    window.layout.pane.status = WindowStatus.WaitingForInput;
    window.layout.pane.pid = 999;
    window.layout.pane.sessionId = 'session-999';
  }
  return window;
}

function createGroupFixture(id: string, windowIds: string[]) {
  return {
    id,
    name: 'Mobile Group',
    activeWindowId: windowIds[0]!,
    createdAt: '2026-07-08T02:00:00.000Z',
    lastActiveAt: '2026-07-08T02:00:00.000Z',
    layout: {
      type: 'split' as const,
      direction: 'horizontal' as const,
      sizes: windowIds.map(() => 1 / windowIds.length),
      children: windowIds.map((windowId) => ({ type: 'window' as const, id: windowId })),
    },
  };
}
