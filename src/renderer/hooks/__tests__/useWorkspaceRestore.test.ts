import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useWorkspaceRestore } from '../useWorkspaceRestore';
import { useWindowStore } from '../../stores/windowStore';
import { WindowStatus } from '../../types/window';
import { Workspace } from '../../../shared/types/workspace';

function createWorkspace(): Workspace {
  return {
    version: '1.0',
    windows: [
      {
        id: 'window-1',
        name: 'Local Terminal',
        activePaneId: 'pane-1',
        createdAt: '2026-04-10T00:00:00.000Z',
        lastActiveAt: '2026-04-10T00:00:00.000Z',
        layout: {
          type: 'pane',
          id: 'pane-node-1',
          pane: {
            id: 'pane-1',
            cwd: '/workspace/project-a',
            command: 'pwsh.exe',
            status: WindowStatus.Paused,
            pid: null,
            backend: 'local',
          },
        },
      },
      {
        id: 'window-2',
        name: 'Remote Terminal',
        activePaneId: 'pane-2',
        createdAt: '2026-04-10T00:01:00.000Z',
        lastActiveAt: '2026-04-10T00:01:00.000Z',
        layout: {
          type: 'pane',
          id: 'pane-node-2',
          pane: {
            id: 'pane-2',
            cwd: '/srv/app',
            command: '/bin/zsh',
            status: WindowStatus.Paused,
            pid: null,
            backend: 'ssh',
            ssh: {
              profileId: 'profile-1',
              host: '10.0.0.21',
              port: 22,
              user: 'root',
              remoteCwd: '/srv/app',
              reuseSession: true,
            },
          },
        },
      },
    ],
    groups: [
      {
        id: 'group-1',
        name: 'Backend',
        layout: {
          type: 'split',
          direction: 'horizontal',
          sizes: [0.5, 0.5],
          children: [
            { type: 'window', id: 'window-1' },
            { type: 'window', id: 'window-2' },
          ],
        },
        activeWindowId: 'window-1',
        createdAt: '2026-04-10T00:02:00.000Z',
        lastActiveAt: '2026-04-10T00:02:00.000Z',
      },
    ],
    canvasWorkspaces: [
      {
        id: 'canvas-1',
        name: 'Ops Board',
        createdAt: '2026-04-10T00:02:30.000Z',
        updatedAt: '2026-04-10T00:03:00.000Z',
        workingDirectory: '/workspace/project-a',
        blocks: [
          {
            id: 'note-1',
            type: 'note',
            x: 24,
            y: 16,
            width: 320,
            height: 180,
            zIndex: 1,
            label: 'Checklist',
            content: 'Review logs',
          },
        ],
        viewport: { tx: 0, ty: 0, zoom: 1 },
        nextZIndex: 2,
      },
    ],
    canvasWorkspaceTemplates: [
      {
        id: 'template-1',
        name: 'Troubleshooting',
        createdAt: '2026-04-10T00:00:00.000Z',
        updatedAt: '2026-04-10T00:00:00.000Z',
        blocks: [],
      },
    ],
    canvasActivity: [
      {
        id: 'activity-1',
        workspaceId: 'canvas-1',
        timestamp: '2026-04-10T00:03:30.000Z',
        type: 'workspace-created',
        title: 'Ops Board',
      },
    ],
    settings: {
      notificationsEnabled: true,
      theme: 'dark',
      autoSave: true,
      autoSaveInterval: 5,
      ides: [],
    },
    lastSavedAt: '2026-04-10T00:03:00.000Z',
  };
}

describe('useWorkspaceRestore', () => {
  let workspaceLoadedHandler: ((event: unknown, workspace: Workspace) => void) | undefined;

  beforeEach(() => {
    workspaceLoadedHandler = undefined;
    useWindowStore.setState({
      windows: [],
      groups: [],
      canvasWorkspaces: [],
      canvasWorkspaceTemplates: [],
      canvasActivity: [],
      activeCanvasWorkspaceId: null,
      activeWindowId: null,
      activeGroupId: null,
      mruList: [],
      groupMruList: [],
      sidebarExpanded: false,
      sidebarWidth: 200,
      customCategories: [],
      terminalSidebarSections: {
        archived: false,
        local: true,
        ssh: true,
      },
      terminalSidebarFilter: 'all',
    });
    vi.clearAllMocks();

    vi.mocked(window.electronAPI.loadWorkspace).mockResolvedValue({
      success: true,
      data: createWorkspace(),
    });
    vi.mocked(window.electronAPI.onWorkspaceLoaded).mockImplementation((handler) => {
      workspaceLoadedHandler = handler as (event: unknown, workspace: Workspace) => void;
    });
  });

  it('registers the workspace listener and requests the current workspace on mount', async () => {
    const { unmount } = renderHook(() => useWorkspaceRestore());

    await waitFor(() => {
      expect(window.electronAPI.onWorkspaceLoaded).toHaveBeenCalledTimes(1);
      expect(window.electronAPI.loadWorkspace).toHaveBeenCalledTimes(1);
    });

    unmount();
  });

  it('restores windows and groups from the initial workspace load', async () => {
    const { unmount } = renderHook(() => useWorkspaceRestore());

    await waitFor(() => {
      expect(useWindowStore.getState().windows).toHaveLength(2);
      expect(useWindowStore.getState().groups).toHaveLength(1);
      expect(useWindowStore.getState().canvasWorkspaces).toHaveLength(1);
      expect(useWindowStore.getState().canvasWorkspaceTemplates).toHaveLength(1);
      expect(useWindowStore.getState().canvasActivity).toHaveLength(1);
    });

    expect(useWindowStore.getState().windows.map((window) => window.id)).toEqual([
      'window-1',
      'window-2',
    ]);
    expect(useWindowStore.getState().groups[0]?.id).toBe('group-1');
    expect(useWindowStore.getState().canvasWorkspaces[0]?.id).toBe('canvas-1');
    expect(useWindowStore.getState().canvasWorkspaceTemplates[0]?.id).toBe('template-1');
    expect(useWindowStore.getState().canvasActivity[0]?.id).toBe('activity-1');

    unmount();
  });

  it('ignores duplicate workspace payloads after the initial restore', async () => {
    const workspace = createWorkspace();
    vi.mocked(window.electronAPI.loadWorkspace).mockResolvedValue({
      success: true,
      data: workspace,
    });

    const { unmount } = renderHook(() => useWorkspaceRestore());

    await waitFor(() => {
      expect(useWindowStore.getState().windows).toHaveLength(2);
    });

    const restoredWindows = useWindowStore.getState().windows;
    workspaceLoadedHandler?.({}, workspace);

    expect(useWindowStore.getState().windows).toBe(restoredWindows);
    expect(useWindowStore.getState().windows).toHaveLength(2);

    unmount();
  });

  it('preserves the active desktop window when a remote workspace update is restored', async () => {
    const { unmount } = renderHook(() => useWorkspaceRestore());

    await waitFor(() => {
      expect(useWindowStore.getState().windows).toHaveLength(2);
    });

    useWindowStore.setState({
      activeWindowId: 'window-2',
      activeGroupId: null,
      activeCanvasWorkspaceId: null,
    });

    const nextWorkspace = createWorkspace();
    nextWorkspace.lastSavedAt = '2026-04-10T00:04:00.000Z';
    nextWorkspace.windows[1] = {
      ...nextWorkspace.windows[1],
      lastActiveAt: '2026-04-10T00:04:00.000Z',
    };

    workspaceLoadedHandler?.({}, nextWorkspace);

    expect(useWindowStore.getState().activeWindowId).toBe('window-2');
    expect(useWindowStore.getState().activeGroupId).toBeNull();
    expect(useWindowStore.getState().activeCanvasWorkspaceId).toBeNull();

    unmount();
  });

  it('preserves the active desktop group when a remote group update is restored', async () => {
    const { unmount } = renderHook(() => useWorkspaceRestore());

    await waitFor(() => {
      expect(useWindowStore.getState().groups).toHaveLength(1);
    });

    useWindowStore.setState({
      activeWindowId: null,
      activeGroupId: 'group-1',
      activeCanvasWorkspaceId: null,
    });

    const nextWorkspace = createWorkspace();
    nextWorkspace.lastSavedAt = '2026-04-10T00:04:30.000Z';
    nextWorkspace.groups[0] = {
      ...nextWorkspace.groups[0],
      lastActiveAt: '2026-04-10T00:04:30.000Z',
    };

    workspaceLoadedHandler?.({}, nextWorkspace);

    expect(useWindowStore.getState().activeWindowId).toBeNull();
    expect(useWindowStore.getState().activeGroupId).toBe('group-1');
    expect(useWindowStore.getState().activeCanvasWorkspaceId).toBeNull();

    unmount();
  });
});
