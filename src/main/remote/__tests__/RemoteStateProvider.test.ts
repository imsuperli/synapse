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

    expect(provider.listWindows()).toEqual({ windows: [] });
    expect(provider.listPanes()).toEqual({ panes: [] });
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
