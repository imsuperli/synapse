import { useEffect, useCallback, useRef } from 'react';
import { useWindowStore, setAutoSaveEnabled } from '../stores/windowStore';
import { Workspace } from '../../shared/types/workspace';

function buildWorkspaceRestoreKey(workspace: Workspace): string {
  const windowIds = workspace.windows.map((window) => window.id).join(',');
  const groupIds = (workspace.groups ?? []).map((group) => group.id).join(',');
  const canvasWorkspaceIds = (workspace.canvasWorkspaces ?? []).map((canvasWorkspace) => canvasWorkspace.id).join(',');
  const templateIds = (workspace.canvasWorkspaceTemplates ?? []).map((template) => template.id).join(',');
  const activityIds = (workspace.canvasActivity ?? []).map((activity) => activity.id).join(',');

  return `${workspace.lastSavedAt}|${workspace.windows.length}|${workspace.groups?.length ?? 0}|${workspace.canvasWorkspaces?.length ?? 0}|${workspace.canvasWorkspaceTemplates?.length ?? 0}|${workspace.canvasActivity?.length ?? 0}|${windowIds}|${groupIds}|${canvasWorkspaceIds}|${templateIds}|${activityIds}`;
}

function isWorkspacePayload(value: unknown): value is Workspace {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<Workspace>;
  return Array.isArray(candidate.windows) && Array.isArray(candidate.groups);
}

function resolveRestoredActiveSelection(
  workspace: Workspace,
  previous: {
    activeWindowId: string | null;
    activeGroupId: string | null;
    activeCanvasWorkspaceId: string | null;
  },
): {
  activeWindowId: string | null;
  activeGroupId: string | null;
  activeCanvasWorkspaceId: string | null;
} {
  if (previous.activeWindowId && workspace.windows.some((window) => window.id === previous.activeWindowId)) {
    return {
      activeWindowId: previous.activeWindowId,
      activeGroupId: null,
      activeCanvasWorkspaceId: null,
    };
  }

  if (previous.activeGroupId && (workspace.groups ?? []).some((group) => group.id === previous.activeGroupId)) {
    return {
      activeWindowId: null,
      activeGroupId: previous.activeGroupId,
      activeCanvasWorkspaceId: null,
    };
  }

  if (
    previous.activeCanvasWorkspaceId &&
    (workspace.canvasWorkspaces ?? []).some((canvasWorkspace) => canvasWorkspace.id === previous.activeCanvasWorkspaceId)
  ) {
    return {
      activeWindowId: null,
      activeGroupId: null,
      activeCanvasWorkspaceId: previous.activeCanvasWorkspaceId,
    };
  }

  return {
    activeWindowId: null,
    activeGroupId: null,
    activeCanvasWorkspaceId: null,
  };
}

/**
 * 工作区恢复 Hook
 *
 * 功能：
 * - 监听主进程的 workspace-loaded 事件
 * - 订阅建立后主动拉取当前工作区，避免错过启动时的一次性事件
 * - 立即渲染卡片（无活动会话，不启动 PTY 进程）
 */
export const useWorkspaceRestore = () => {
  const addWindow = useWindowStore((state) => state.addWindow);
  const addGroup = useWindowStore((state) => state.addGroup);
  const addCanvasWorkspace = useWindowStore((state) => state.addCanvasWorkspace);
  const setCanvasWorkspaceTemplates = useWindowStore((state) => state.setCanvasWorkspaceTemplates);
  const clearCanvasActivity = useWindowStore((state) => state.clearCanvasActivity);
  const appendCanvasActivity = useWindowStore((state) => state.appendCanvasActivity);
  const clearWindows = useWindowStore((state) => state.clearWindows);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoredWorkspaceKeyRef = useRef<string | null>(null);

  const scheduleAutoSaveEnable = useCallback(() => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }

    autoSaveTimerRef.current = setTimeout(() => {
      setAutoSaveEnabled(true);
      autoSaveTimerRef.current = null;
      console.log('[useWorkspaceRestore] Auto-save enabled, windows restored without live sessions');
    }, 2000);
  }, []);

  const restoreWorkspace = useCallback((workspace: Workspace) => {
    const restoreKey = buildWorkspaceRestoreKey(workspace);
    if (restoredWorkspaceKeyRef.current === restoreKey) {
      return;
    }

    restoredWorkspaceKeyRef.current = restoreKey;

    console.log(
      `[useWorkspaceRestore] Restoring workspace with ${workspace.windows.length} windows, ${workspace.groups?.length || 0} groups, ${workspace.canvasWorkspaces?.length || 0} canvas workspaces, ${workspace.canvasWorkspaceTemplates?.length || 0} templates, ${workspace.canvasActivity?.length || 0} activity events`,
    );

    setAutoSaveEnabled(false);
    const previousSelection = {
      activeWindowId: useWindowStore.getState().activeWindowId,
      activeGroupId: useWindowStore.getState().activeGroupId,
      activeCanvasWorkspaceId: useWindowStore.getState().activeCanvasWorkspaceId,
    };
    clearWindows();

    for (const window of workspace.windows) {
      addWindow(window);
    }

    if (workspace.groups && workspace.groups.length > 0) {
      for (const group of workspace.groups) {
        addGroup(group);
      }
      console.log(`[useWorkspaceRestore] Restored ${workspace.groups.length} groups`);
    }

    if (workspace.canvasWorkspaces && workspace.canvasWorkspaces.length > 0) {
      for (const canvasWorkspace of workspace.canvasWorkspaces) {
        addCanvasWorkspace(canvasWorkspace, { persist: false });
      }
      console.log(`[useWorkspaceRestore] Restored ${workspace.canvasWorkspaces.length} canvas workspaces`);
    }

    setCanvasWorkspaceTemplates(workspace.canvasWorkspaceTemplates ?? []);
    clearCanvasActivity();
    for (const event of workspace.canvasActivity ?? []) {
      appendCanvasActivity(event);
    }

    useWindowStore.setState(resolveRestoredActiveSelection(workspace, previousSelection));

    console.log(`[useWorkspaceRestore] Restored ${workspace.windows.length} windows`);
    scheduleAutoSaveEnable();
  }, [
    addCanvasWorkspace,
    addGroup,
    addWindow,
    appendCanvasActivity,
    clearCanvasActivity,
    clearWindows,
    scheduleAutoSaveEnable,
    setCanvasWorkspaceTemplates,
  ]);

  useEffect(() => {
    if (!window.electronAPI) {
      console.warn('[useWorkspaceRestore] electronAPI not available');
      return;
    }

    let cancelled = false;

    const handleWorkspaceLoaded = (_event: unknown, workspace: Workspace) => {
      if (!isWorkspacePayload(workspace)) {
        console.error('[useWorkspaceRestore] Ignoring invalid workspace-loaded payload');
        return;
      }

      restoreWorkspace(workspace);
    };

    setAutoSaveEnabled(false);
    window.electronAPI.onWorkspaceLoaded(handleWorkspaceLoaded);

    const restoreInitialWorkspace = async () => {
      try {
        const response = await window.electronAPI.loadWorkspace();

        if (cancelled) {
          return;
        }

        if (!response.success || !isWorkspacePayload(response.data)) {
          console.error('[useWorkspaceRestore] Failed to load workspace:', response.error);
          scheduleAutoSaveEnable();
          return;
        }

        restoreWorkspace(response.data);
      } catch (error) {
        if (!cancelled) {
          console.error('[useWorkspaceRestore] Failed to restore workspace:', error);
          scheduleAutoSaveEnable();
        }
      }
    };

    void restoreInitialWorkspace();

    return () => {
      cancelled = true;

      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }

      setAutoSaveEnabled(true);
      window.electronAPI.offWorkspaceLoaded(handleWorkspaceLoaded);
    };
  }, [restoreWorkspace, scheduleAutoSaveEnable]);
};
