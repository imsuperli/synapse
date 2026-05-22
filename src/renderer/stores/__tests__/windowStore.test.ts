import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWindowStore, WindowStatus } from '../windowStore';
import { createSinglePaneWindow } from '../../utils/layoutHelpers';
import type { Window } from '../../types/window';

function createWindow(overrides: Partial<Window> & {
  id: string;
  name?: string;
  cwd?: string;
  command?: string;
  status?: WindowStatus;
}): Window {
  const base = createSinglePaneWindow(
    overrides.name ?? `Window ${overrides.id}`,
    overrides.cwd ?? `/workspace/${overrides.id}`,
    overrides.command ?? 'bash',
  );

  const nextWindow: Window = {
    ...base,
    ...overrides,
  };

  if (nextWindow.layout.type === 'pane' && overrides.status) {
    nextWindow.layout = {
      ...nextWindow.layout,
      pane: {
        ...nextWindow.layout.pane,
        status: overrides.status,
        pid: overrides.status === WindowStatus.Completed ? null : nextWindow.layout.pane.pid,
      },
    };
  }

  return nextWindow;
}

describe('windowStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWindowStore.setState({
      windows: [],
      groups: [],
      canvasWorkspaces: [],
      canvasWorkspaceTemplates: [],
      canvasActivity: [],
      activeWindowId: null,
      activeCanvasWorkspaceId: null,
      startedCanvasWorkspaceIds: [],
      activeGroupId: null,
      mruList: [],
      groupMruList: [],
      customCategories: [],
      sidebarExpanded: false,
      sidebarWidth: 200,
      terminalSidebarSections: {
        archived: false,
        canvas: true,
        local: true,
        ssh: true,
      },
      terminalSidebarFilter: 'all',
    });
  });

  describe('addWindow', () => {
    it('adds a window to the store', () => {
      const window = createWindow({ id: 'win-1' });

      useWindowStore.getState().addWindow(window);

      const state = useWindowStore.getState();
      expect(state.windows).toHaveLength(1);
      expect(state.windows[0]).toEqual(window);
      expect(state.mruList).toEqual(['win-1']);
    });

    it('adds multiple windows and preserves insertion order in state', () => {
      const window1 = createWindow({ id: 'win-1' });
      const window2 = createWindow({ id: 'win-2' });

      useWindowStore.getState().addWindow(window1);
      useWindowStore.getState().addWindow(window2);

      const state = useWindowStore.getState();
      expect(state.windows).toHaveLength(2);
      expect(state.windows.map((window) => window.id)).toEqual(['win-1', 'win-2']);
      expect(state.mruList).toEqual(['win-2', 'win-1']);
    });
  });

  describe('removeWindow', () => {
    it('removes a window by id', () => {
      const window = createWindow({ id: 'win-1' });

      useWindowStore.getState().addWindow(window);
      useWindowStore.getState().removeWindow('win-1');

      expect(useWindowStore.getState().windows).toHaveLength(0);
    });

    it('clears activeWindowId when removing the active window', () => {
      const window = createWindow({ id: 'win-1' });

      useWindowStore.getState().addWindow(window);
      useWindowStore.getState().setActiveWindow('win-1');
      useWindowStore.getState().removeWindow('win-1');

      expect(useWindowStore.getState().activeWindowId).toBeNull();
    });

    it('keeps activeWindowId when removing a different window', () => {
      const window1 = createWindow({ id: 'win-1' });
      const window2 = createWindow({ id: 'win-2' });

      useWindowStore.getState().addWindow(window1);
      useWindowStore.getState().addWindow(window2);
      useWindowStore.getState().setActiveWindow('win-1');
      useWindowStore.getState().removeWindow('win-2');

      expect(useWindowStore.getState().activeWindowId).toBe('win-1');
    });
  });

  describe('updateWindowStatus', () => {
    it('updates all panes to the given status for a single-pane window', () => {
      const window = createWindow({ id: 'win-1', status: WindowStatus.Running });

      useWindowStore.getState().addWindow(window);
      useWindowStore.getState().updateWindowStatus('win-1', WindowStatus.Completed);

      const storedWindow = useWindowStore.getState().windows[0];
      expect(storedWindow.layout.type).toBe('pane');
      if (storedWindow.layout.type === 'pane') {
        expect(storedWindow.layout.pane.status).toBe(WindowStatus.Completed);
      }
    });

    it('updates lastActiveAt when status changes', () => {
      const window = createWindow({
        id: 'win-1',
        createdAt: '2024-01-01T00:00:00.000Z',
        lastActiveAt: '2024-01-01T00:00:00.000Z',
      });

      useWindowStore.getState().addWindow(window);
      useWindowStore.getState().updateWindowStatus('win-1', WindowStatus.WaitingForInput);

      expect(useWindowStore.getState().windows[0]?.lastActiveAt).not.toBe('2024-01-01T00:00:00.000Z');
    });
  });

  describe('setActiveWindow', () => {
    it('sets the active window id', () => {
      const window = createWindow({ id: 'win-1' });

      useWindowStore.getState().addWindow(window);
      useWindowStore.getState().setActiveWindow('win-1');

      expect(useWindowStore.getState().activeWindowId).toBe('win-1');
    });

    it('updates lastActiveAt when activating a window', () => {
      const window = createWindow({
        id: 'win-1',
        createdAt: '2024-01-01T00:00:00.000Z',
        lastActiveAt: '2024-01-01T00:00:00.000Z',
      });

      useWindowStore.getState().addWindow(window);
      useWindowStore.getState().setActiveWindow('win-1');

      expect(useWindowStore.getState().windows[0]?.lastActiveAt).not.toBe('2024-01-01T00:00:00.000Z');
    });
  });

  describe('getWindowById', () => {
    it('returns a window by id', () => {
      const window = createWindow({ id: 'win-1' });

      useWindowStore.getState().addWindow(window);

      expect(useWindowStore.getState().getWindowById('win-1')).toEqual(window);
    });

    it('returns undefined for a missing window', () => {
      expect(useWindowStore.getState().getWindowById('missing')).toBeUndefined();
    });
  });

  describe('active and archived windows', () => {
    it('returns active and archived windows from current store shape', () => {
      const activeWindow = createWindow({ id: 'active-1' });
      const archivedWindow = createWindow({ id: 'archived-1', archived: true });

      useWindowStore.getState().addWindow(activeWindow);
      useWindowStore.getState().addWindow(archivedWindow);

      expect(useWindowStore.getState().getActiveWindows().map((window) => window.id)).toEqual(['active-1']);
      expect(useWindowStore.getState().getArchivedWindows().map((window) => window.id)).toEqual(['archived-1']);
    });
  });

  describe('custom category SSH profiles', () => {
    it('adds and removes an SSH profile from a custom category', async () => {
      useWindowStore.setState({
        customCategories: [{
          id: 'category-1',
          name: 'Production',
          icon: 'pin',
          windowIds: [],
          groupIds: [],
          order: 0,
          createdAt: '2026-05-22T00:00:00.000Z',
          updatedAt: '2026-05-22T00:00:00.000Z',
        }],
      });

      await useWindowStore.getState().addSSHProfileToCategory('category-1', 'profile-1');

      expect(useWindowStore.getState().customCategories[0]?.sshProfileIds).toEqual(['profile-1']);
      expect(useWindowStore.getState().getSSHProfileCategories('profile-1').map((category) => category.id)).toEqual(['category-1']);

      await useWindowStore.getState().removeSSHProfileFromCategory('category-1', 'profile-1');

      expect(useWindowStore.getState().customCategories[0]?.sshProfileIds).toEqual([]);
      expect(useWindowStore.getState().getSSHProfileCategories('profile-1')).toEqual([]);
    });
  });

  describe('edge cases', () => {
    it('does not throw when removing a missing window', () => {
      expect(() => {
        useWindowStore.getState().removeWindow('missing');
      }).not.toThrow();
    });

    it('does not throw when updating a missing window status', () => {
      expect(() => {
        useWindowStore.getState().updateWindowStatus('missing', WindowStatus.Completed);
      }).not.toThrow();
    });

    it('does not throw when setting a missing window as active', () => {
      expect(() => {
        useWindowStore.getState().setActiveWindow('missing');
      }).not.toThrow();

      expect(useWindowStore.getState().activeWindowId).toBe('missing');
    });
  });

  describe('canvas workspace runtime', () => {
    it('toggles started canvas workspaces', () => {
      useWindowStore.getState().setCanvasWorkspaceStarted('canvas-1', true);
      expect(useWindowStore.getState().isCanvasWorkspaceStarted('canvas-1')).toBe(true);

      useWindowStore.getState().setCanvasWorkspaceStarted('canvas-1', false);
      expect(useWindowStore.getState().isCanvasWorkspaceStarted('canvas-1')).toBe(false);
    });

    it('removes canvas-owned blocks when removing a canvas-owned window', () => {
      const canvasOwnedWindow = createWindow({
        id: 'canvas-window-1',
        name: 'Canvas Window',
        ownerType: 'canvas-owned',
        ownerCanvasWorkspaceId: 'canvas-1',
        status: WindowStatus.Completed,
      });

      useWindowStore.setState({
        windows: [canvasOwnedWindow],
        canvasWorkspaces: [{
          id: 'canvas-1',
          name: 'Canvas',
          createdAt: '2026-05-07T00:00:00.000Z',
          updatedAt: '2026-05-07T00:00:00.000Z',
          blocks: [{
            id: 'block-1',
            type: 'window',
            windowId: 'canvas-window-1',
            x: 0,
            y: 0,
            width: 320,
            height: 220,
            zIndex: 1,
          }],
          links: [{
            id: 'link-1',
            fromBlockId: 'block-1',
            toBlockId: 'block-1',
            kind: 'related',
            createdAt: '2026-05-07T00:00:00.000Z',
          }],
          viewport: { tx: 0, ty: 0, zoom: 1 },
          nextZIndex: 2,
        }],
      });

      useWindowStore.getState().removeWindow('canvas-window-1');

      const canvasWorkspace = useWindowStore.getState().canvasWorkspaces[0];
      expect(canvasWorkspace?.blocks).toEqual([]);
      expect(canvasWorkspace?.links).toEqual([]);
    });
  });
});
