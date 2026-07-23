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

    const result = await provider.createWindow({
      backend: 'local',
      name: 'Mobile Shell',
      workingDirectory: '/repo',
    });

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

  it('lists safe SSH profile summaries and creates a synchronized SSH window', async () => {
    const workspace = createWorkspace();
    const sshWindow = createRunningTerminalWindow('win-ssh-created', 'Production');
    sshWindow.kind = 'ssh';
    if (sshWindow.layout.type === 'pane') {
      sshWindow.layout.pane.backend = 'ssh';
      sshWindow.layout.pane.cwd = '/srv/app';
      sshWindow.layout.pane.command = 'zsh';
      sshWindow.layout.pane.ssh = { profileId: 'profile-1' };
    }
    const processes = [{
      windowId: sshWindow.id,
      paneId: sshWindow.activePaneId,
      pid: 999,
      sessionId: 'session-999',
      status: ProcessStatus.Alive,
    }];
    const listSSHProfiles = vi.fn(async () => [{
      id: 'profile-1',
      name: 'Production',
      host: 'prod.example.com',
      port: 22,
      user: 'deploy',
      defaultRemoteCwd: '/srv/app',
      remoteCommand: 'zsh',
      privateKeys: ['/secret/id_ed25519'],
      notes: 'not exposed to mobile',
    }] as any);
    const createSSHWindow = vi.fn(async () => sshWindow);
    const onWindowCreated = vi.fn();
    const provider = new RemoteStateProvider({
      getCurrentWorkspace: () => workspace,
      processManager: { listProcesses: vi.fn(() => processes) } as any,
      listSSHProfiles,
      createSSHWindow,
      onWindowCreated,
    });

    await expect(provider.listSSHProfiles()).resolves.toEqual({
      profiles: [{
        profileId: 'profile-1',
        name: 'Production',
        host: 'prod.example.com',
        port: 22,
        user: 'deploy',
        defaultRemoteCwd: '/srv/app',
        remoteCommand: 'zsh',
      }],
    });

    const result = await provider.createWindow({
      backend: 'ssh',
      profileId: 'profile-1',
      workingDirectory: '/srv/app',
      name: 'Deploy shell',
      initialCols: 100,
      initialRows: 30,
    });

    expect(createSSHWindow).toHaveBeenCalledWith({
      backend: 'ssh',
      profileId: 'profile-1',
      workingDirectory: '/srv/app',
      name: 'Deploy shell',
      initialCols: 100,
      initialRows: 30,
    });
    expect(result).toMatchObject({
      window: { windowId: 'win-ssh-created', kind: 'ssh' },
      pane: {
        windowId: 'win-ssh-created',
        paneId: 'win-ssh-created-pane',
        backend: 'ssh',
        running: true,
      },
    });
    expect(workspace.windows.at(-1)).toBe(sshWindow);
    expect(onWindowCreated).toHaveBeenCalledWith({ window: sshWindow, workspace });
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

    await expect(provider.createWindow({ backend: 'local', workingDirectory: '/repo' })).rejects.toThrow(
      'spawn_failed',
    );
    expect(workspace.windows).toHaveLength(originalWindowCount);
  });

  it('starts stopped SSH panes from their persisted profile binding', async () => {
    const workspace = createWorkspace();
    const processes = [{
      windowId: 'win-1',
      paneId: 'pane-terminal',
      pid: 111,
      sessionId: 'stored-session',
      status: ProcessStatus.Exited,
    }];
    const startSSHTerminalPane = vi.fn(async () => {
      processes.push({
        windowId: 'win-1',
        paneId: 'pane-terminal',
        pid: 777,
        sessionId: 'ssh-session-777',
        status: ProcessStatus.Alive,
      });
      return {
        pid: 777,
        sessionId: 'ssh-session-777',
        status: WindowStatus.WaitingForInput,
      };
    });
    const onWindowRuntimeUpdated = vi.fn();
    const provider = new RemoteStateProvider({
      getCurrentWorkspace: () => workspace,
      processManager: { listProcesses: vi.fn(() => processes) } as any,
      startSSHTerminalPane,
      onWindowRuntimeUpdated,
    });

    const result = await provider.startWindow({
      windowId: 'win-1',
      paneId: 'pane-terminal',
      initialCols: 132,
      initialRows: 38,
    });

    expect(startSSHTerminalPane).toHaveBeenCalledWith({
      windowId: 'win-1',
      paneId: 'pane-terminal',
      profileId: 'prod',
      workingDirectory: '/repo',
      command: 'bash',
      initialCols: 132,
      initialRows: 38,
    });
    expect(result).toMatchObject({
      pane: {
        paneId: 'pane-terminal',
        backend: 'ssh',
        running: true,
        pid: 777,
        sessionId: 'ssh-session-777',
      },
      startedPanes: [{ paneId: 'pane-terminal' }],
    });
    expect(onWindowRuntimeUpdated).toHaveBeenCalledWith({
      window: workspace.windows[0],
      workspace,
    });
  });

  it('does not mutate a stopped SSH pane when the SSH starter is unavailable', async () => {
    const workspace = createWorkspace();
    const targetWindow = workspace.windows[0];
    if (!targetWindow || targetWindow.layout.type !== 'split') {
      throw new Error('expected mixed window fixture');
    }
    const targetNode = targetWindow.layout.children[0];
    if (!targetNode || targetNode.type !== 'pane') {
      throw new Error('expected SSH pane fixture');
    }
    const pane = targetNode.pane;
    const originalRuntime = { status: pane.status, pid: pane.pid, sessionId: pane.sessionId };
    const provider = new RemoteStateProvider({
      getCurrentWorkspace: () => workspace,
      processManager: { listProcesses: vi.fn(() => []) } as any,
      startLocalTerminalPane: vi.fn(),
    });

    await expect(
      provider.startWindow({ windowId: 'win-1', paneId: 'pane-terminal' }),
    ).rejects.toThrow('remote_ssh_window_start_unavailable');
    expect(pane).toMatchObject(originalRuntime);
  });

  it('rejects an SSH restart with no persisted profile before spawning', async () => {
    const workspace = createWorkspace();
    const targetWindow = workspace.windows[0];
    if (!targetWindow || targetWindow.layout.type !== 'split') {
      throw new Error('expected mixed window fixture');
    }
    const targetNode = targetWindow.layout.children[0];
    if (!targetNode || targetNode.type !== 'pane') {
      throw new Error('expected SSH pane fixture');
    }
    targetNode.pane.ssh = undefined;
    const startSSHTerminalPane = vi.fn();
    const provider = new RemoteStateProvider({
      getCurrentWorkspace: () => workspace,
      processManager: { listProcesses: vi.fn(() => []) } as any,
      startSSHTerminalPane,
    });

    await expect(
      provider.startWindow({ windowId: 'win-1', paneId: 'pane-terminal' }),
    ).rejects.toThrow('remote_ssh_pane_profile_missing');
    expect(startSSHTerminalPane).not.toHaveBeenCalled();
    expect(targetNode.pane.status).toBe(WindowStatus.WaitingForInput);
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

  it('deletes a pane from the shared layout and returns the exact surviving terminal', async () => {
    const workspace = createWorkspace();
    const splitWindow = createSplitTerminalWindow('win-split', ['pane-a', 'pane-b'], 'pane-a');
    workspace.windows.push(splitWindow);
    const stopWindowPanes = vi.fn();
    const onPaneDeleted = vi.fn();
    const onWorkspaceLayoutUpdated = vi.fn();
    const provider = new RemoteStateProvider({
      getCurrentWorkspace: () => workspace,
      processManager: { listProcesses: vi.fn(() => []) } as any,
      stopWindowPanes,
      onPaneDeleted,
      onWorkspaceLayoutUpdated,
    });

    const result = await provider.deletePane({ windowId: 'win-split', paneId: 'pane-a' });

    expect(stopWindowPanes).toHaveBeenCalledWith({
      windowId: 'win-split',
      paneIds: ['pane-a'],
    });
    expect(splitWindow.layout).toMatchObject({
      type: 'split',
      sizes: [1],
      children: [{ type: 'pane', id: 'pane-b' }],
    });
    expect(splitWindow.activePaneId).toBe('pane-b');
    expect(result).toMatchObject({
      deleted: true,
      deletedPaneId: 'pane-a',
      window: {
        windowId: 'win-split',
        activePaneId: 'pane-b',
        terminalPaneCount: 1,
      },
      replacementPane: {
        windowId: 'win-split',
        paneId: 'pane-b',
      },
    });
    expect(onPaneDeleted).toHaveBeenCalledWith({
      windowId: 'win-split',
      paneId: 'pane-a',
      workspace,
    });
    expect(onWorkspaceLayoutUpdated).toHaveBeenCalledWith({ workspace });
  });

  it('preserves the desktop active pane when deleting a different pane', async () => {
    const workspace = createWorkspace();
    const splitWindow = createSplitTerminalWindow('win-split', ['pane-a', 'pane-b', 'pane-c'], 'pane-c');
    workspace.windows.push(splitWindow);
    const provider = new RemoteStateProvider({
      getCurrentWorkspace: () => workspace,
      processManager: { listProcesses: vi.fn(() => []) } as any,
      stopWindowPanes: vi.fn(),
    });

    const result = await provider.deletePane({ windowId: 'win-split', paneId: 'pane-a' });

    expect(splitWindow.activePaneId).toBe('pane-c');
    expect(result.replacementPane.paneId).toBe('pane-b');
  });

  it('serializes concurrent pane deletion so a rejected last-pane request does not stop it', async () => {
    const workspace = createWorkspace();
    workspace.windows.push(createSplitTerminalWindow('win-split', ['pane-a', 'pane-b'], 'pane-a'));
    let releaseFirstStop: (() => void) | null = null;
    const stopWindowPanes = vi.fn(async ({ paneIds }: { paneIds: string[] }) => {
      if (paneIds[0] === 'pane-a') {
        await new Promise<void>((resolve) => {
          releaseFirstStop = resolve;
        });
      }
    });
    const provider = new RemoteStateProvider({
      getCurrentWorkspace: () => workspace,
      processManager: { listProcesses: vi.fn(() => []) } as any,
      stopWindowPanes,
    });

    const firstDelete = provider.deletePane({ windowId: 'win-split', paneId: 'pane-a' });
    await vi.waitFor(() => expect(stopWindowPanes).toHaveBeenCalledTimes(1));
    const secondDelete = provider.deletePane({ windowId: 'win-split', paneId: 'pane-b' });
    await Promise.resolve();
    expect(stopWindowPanes).toHaveBeenCalledTimes(1);

    releaseFirstStop?.();
    await expect(firstDelete).resolves.toMatchObject({ deletedPaneId: 'pane-a' });
    await expect(secondDelete).rejects.toThrow('pane_delete_last_pane');
    expect(stopWindowPanes).toHaveBeenCalledTimes(1);
  });

  it('refuses to delete the only pane or the last terminal pane', async () => {
    const workspace = createWorkspace();
    workspace.windows.push(createTerminalWindow('win-only', 'Only'));
    const stopWindowPanes = vi.fn();
    const provider = new RemoteStateProvider({
      getCurrentWorkspace: () => workspace,
      processManager: { listProcesses: vi.fn(() => []) } as any,
      stopWindowPanes,
    });

    await expect(
      provider.deletePane({ windowId: 'win-only', paneId: 'win-only-pane' }),
    ).rejects.toThrow('pane_delete_last_pane');
    await expect(
      provider.deletePane({ windowId: 'win-1', paneId: 'pane-terminal' }),
    ).rejects.toThrow('pane_delete_last_terminal');
    expect(stopWindowPanes).not.toHaveBeenCalled();
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

  it('removes a window from a group without deleting or stopping its terminal', async () => {
    const workspace = createWorkspace();
    workspace.windows.push(createTerminalWindow('win-local', 'Local'));
    workspace.windows.push(createTerminalWindow('win-peer', 'Peer'));
    workspace.windows.push(createTerminalWindow('win-other', 'Other'));
    workspace.groups = [createGroupFixture('group-1', ['win-local', 'win-peer', 'win-other'])];
    workspace.groups[0]!.activeWindowId = 'win-peer';
    const stopWindowPanes = vi.fn();
    const onWorkspaceLayoutUpdated = vi.fn();
    const provider = new RemoteStateProvider({
      getCurrentWorkspace: () => workspace,
      processManager: { listProcesses: vi.fn(() => []) } as any,
      stopWindowPanes,
      onWorkspaceLayoutUpdated,
    });

    const result = await provider.removeWindowFromGroup({
      groupId: 'group-1',
      windowId: 'win-peer',
    });

    expect(stopWindowPanes).not.toHaveBeenCalled();
    expect(workspace.windows.map((window) => window.id)).toContain('win-peer');
    expect(workspace.groups).toHaveLength(1);
    expect(getGroupFixtureWindowIds(workspace.groups[0]!.layout)).toEqual(['win-local', 'win-other']);
    expect(workspace.groups[0]!.activeWindowId).toBe('win-local');
    expect(result).toMatchObject({
      removed: true,
      groupId: 'group-1',
      windowId: 'win-peer',
      dissolved: false,
      replacementWindow: { windowId: 'win-other' },
      replacementPane: { windowId: 'win-other', paneId: 'win-other-pane' },
    });
    expect(onWorkspaceLayoutUpdated).toHaveBeenCalledWith({ workspace });
  });

  it('dissolves a two-window group while preserving both window records', async () => {
    const workspace = createWorkspace();
    workspace.windows.push(createTerminalWindow('win-local', 'Local'));
    workspace.windows.push(createTerminalWindow('win-peer', 'Peer'));
    workspace.groups = [createGroupFixture('group-1', ['win-local', 'win-peer'])];
    const provider = new RemoteStateProvider({
      getCurrentWorkspace: () => workspace,
      processManager: { listProcesses: vi.fn(() => []) } as any,
    });

    const result = await provider.removeWindowFromGroup({
      groupId: 'group-1',
      windowId: 'win-local',
    });

    expect(result).toMatchObject({
      removed: true,
      dissolved: true,
      group: null,
      replacementWindow: { windowId: 'win-peer' },
      replacementPane: { paneId: 'win-peer-pane' },
    });
    expect(workspace.groups).toEqual([]);
    expect(workspace.windows.map((window) => window.id)).toEqual(
      expect.arrayContaining(['win-local', 'win-peer']),
    );
  });

  it('rejects creating a group with windows already in an active group', async () => {
    const workspace = createWorkspace();
    workspace.windows.push(createTerminalWindow('win-local', 'Local'));
    workspace.windows.push(createTerminalWindow('win-peer', 'Peer'));
    workspace.windows.push(createTerminalWindow('win-other', 'Other'));
    workspace.groups = [createGroupFixture('group-1', ['win-local', 'win-peer'])];
    const onWorkspaceLayoutUpdated = vi.fn();
    const provider = new RemoteStateProvider({
      getCurrentWorkspace: () => workspace,
      processManager: { listProcesses: vi.fn(() => []) } as any,
      onWorkspaceLayoutUpdated,
    });

    await expect(
      provider.createGroup({
        name: 'Duplicate Group',
        windowIds: ['win-local', 'win-other'],
      }),
    ).rejects.toThrow('window_already_grouped');

    expect(workspace.groups).toHaveLength(1);
    expect(workspace.groups[0]?.id).toBe('group-1');
    expect(onWorkspaceLayoutUpdated).not.toHaveBeenCalled();
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

function createSplitTerminalWindow(id: string, paneIds: string[], activePaneId: string): Window {
  return {
    id,
    name: 'Split',
    activePaneId,
    createdAt: '2026-07-08T00:00:00.000Z',
    lastActiveAt: '2026-07-08T01:00:00.000Z',
    layout: {
      type: 'split',
      direction: 'horizontal',
      sizes: paneIds.map(() => 1 / paneIds.length),
      children: paneIds.map((paneId) => ({
        type: 'pane' as const,
        id: paneId,
        pane: {
          id: paneId,
          cwd: '/repo',
          command: 'bash',
          status: WindowStatus.Completed,
          pid: null,
          backend: 'local' as const,
        },
      })),
    },
  };
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

function getGroupFixtureWindowIds(layout: Workspace['groups'][number]['layout']): string[] {
  if (layout.type === 'window') {
    return [layout.id];
  }
  return layout.children.flatMap((child) => getGroupFixtureWindowIds(child));
}
