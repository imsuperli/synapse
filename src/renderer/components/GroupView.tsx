import React, { Suspense, lazy, useCallback, useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useShallow } from 'zustand/react/shallow';
import { Play, Square, Archive } from 'lucide-react';
import { useWindowStore } from '../stores/windowStore';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { useKeyboardShortcutSettings } from '../hooks/useKeyboardShortcutSettings';
import { GroupSplitLayout } from './GroupSplitLayout';
import { Sidebar } from './Sidebar';
import { WindowGroup } from '../../shared/types/window-group';
import { Pane, Window, WindowStatus } from '../types/window';
import { getAllWindowIds } from '../utils/groupLayoutHelpers';
import { getAllPanes } from '../utils/layoutHelpers';
import type { WindowCardDragItem, DropResult } from './dnd';
import { AppTooltip } from './ui/AppTooltip';
import { startWindowPanes } from '../utils/paneSessionActions';
import type { SSHProfile } from '../../shared/types/ssh';
import { getWindowKind, isTerminalPane } from '../../shared/utils/terminalCapabilities';
import { isEphemeralSSHCloneWindow } from '../utils/sshWindowBindings';
import {
  destroySSHWindowFamilyResources,
  destroyWindowResourcesAndRemoveRecord,
  destroyWindowResourcesKeepRecord,
} from '../utils/windowDestruction';
import { preventMouseButtonFocus } from '../utils/buttonFocus';
import { CUSTOM_TITLEBAR_ACTIONS_SLOT_ID } from './CustomTitleBar';
import { getStartablePanes } from '../utils/windowLifecycle';
import { requestActiveTerminalFocus } from '../utils/terminalFocus';
import type { WindowSwitchHandler } from '../types/windowSwitch';

const LazyQuickSwitcher = lazy(async () => ({
  default: (await import('./QuickSwitcher')).QuickSwitcher,
}));

const LazySettingsPanel = lazy(async () => ({
  default: (await import('./SettingsPanel')).SettingsPanel,
}));

function getStartableTerminalPanes(window: Window): Pane[] {
  return getStartablePanes(window);
}

export interface GroupViewProps {
  group: WindowGroup;
  onReturn: () => void;
  onWindowSwitch: WindowSwitchHandler;
  onGroupSwitch?: (groupId: string) => void;
  onCanvasSwitch?: (canvasWorkspaceId: string) => void;
  isActive: boolean;
  sshProfiles?: SSHProfile[];
}

/**
 * GroupView 组件
 * 组终端视图，显示组内多个窗口的并排布局
 */
export const GroupView: React.FC<GroupViewProps> = ({
  group,
  onReturn,
  onWindowSwitch,
  onGroupSwitch,
  onCanvasSwitch,
  isActive,
  sshProfiles = [],
}) => {
  const keyboardShortcuts = useKeyboardShortcutSettings();
  const [quickSwitcherOpen, setQuickSwitcherOpen] = useState(false);
  const [isSettingsPanelOpen, setIsSettingsPanelOpen] = useState(false);
  const [hasMountedSettingsPanel, setHasMountedSettingsPanel] = useState(false);
  const [titleBarActionsSlot, setTitleBarActionsSlot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    const syncSlot = () => {
      const nextSlot = document.getElementById(CUSTOM_TITLEBAR_ACTIONS_SLOT_ID);
      setTitleBarActionsSlot((currentSlot) => (
        currentSlot === nextSlot ? currentSlot : nextSlot
      ));
    };

    syncSlot();
    window.addEventListener('resize', syncSlot);

    return () => {
      window.removeEventListener('resize', syncSlot);
    };
  }, []);

  const setActiveWindowInGroup = useWindowStore((state) => state.setActiveWindowInGroup);
  const archiveGroup = useWindowStore((state) => state.archiveGroup);
  const archiveWindow = useWindowStore((state) => state.archiveWindow);
  const addWindowToGroupLayout = useWindowStore((state) => state.addWindowToGroupLayout);
  const removeWindowFromGroupLayout = useWindowStore((state) => state.removeWindowFromGroupLayout);
  const rearrangeWindowInGroupLayout = useWindowStore((state) => state.rearrangeWindowInGroupLayout);
  const findGroupByWindowId = useWindowStore((state) => state.findGroupByWindowId);

  const groupWindowIds = useMemo(
    () => getAllWindowIds(group.layout),
    [group.layout],
  );
  const groupWindowIdSet = useMemo(
    () => new Set(groupWindowIds),
    [groupWindowIds],
  );
  const groupWindows = useWindowStore(useShallow(
    (state) => state.windows.filter((window) => groupWindowIdSet.has(window.id)),
  ));
  const groupWindowRuntime = useMemo(() => {
    const windowById = new Map<string, Window>();
    const startablePanesByWindowId = new Map<string, Pane[]>();

    for (const terminalWindow of groupWindows) {
      windowById.set(terminalWindow.id, terminalWindow);

      const startablePanes = getStartableTerminalPanes(terminalWindow);
      if (startablePanes.length > 0) {
        startablePanesByWindowId.set(terminalWindow.id, startablePanes);
      }
    }

    return {
      windowById,
      startablePanesByWindowId,
    };
  }, [groupWindows]);
  const groupStartablePanesByWindowId = groupWindowRuntime.startablePanesByWindowId;
  const groupWindowById = groupWindowRuntime.windowById;
  const activeGroupWindow = groupWindowById.get(group.activeWindowId) ?? null;
  const activeGroupPanes = activeGroupWindow ? getAllPanes(activeGroupWindow.layout) : [];
  const activeGroupPane = activeGroupWindow
    ? activeGroupPanes.find((pane) => pane.id === activeGroupWindow.activePaneId) ?? activeGroupPanes[0] ?? null
    : null;
  const activeGroupTerminalPane = activeGroupPane && isTerminalPane(activeGroupPane)
    ? activeGroupPane
    : null;

  const restoreActiveTerminalFocus = useCallback((options?: { defer?: boolean }) => {
    if (!activeGroupTerminalPane) {
      return;
    }

    requestActiveTerminalFocus({
      windowId: group.activeWindowId,
      paneId: activeGroupTerminalPane.id,
      defer: options?.defer,
    });
  }, [activeGroupTerminalPane, group.activeWindowId]);

  const startStartablePanesForWindow = useCallback(
    async (targetWindow: Window, targetPanes: Pane[]) => {
      if (targetPanes.length > 0) {
        await startWindowPanes(targetWindow, useWindowStore.getState().updatePane, targetPanes);
      }
    },
    [],
  );

  // 自动启动组内所有无活动会话的窗口
  useEffect(() => {
    const autoStartWindows = async () => {
      for (const win of groupWindows) {
        await startStartablePanesForWindow(win, groupStartablePanesByWindowId.get(win.id) ?? []);
      }
    };

    // 只在组视图激活时自动启动
    if (isActive && groupWindows.length > 0) {
      autoStartWindows();
    }
  }, [group.id, isActive]); // 保持原来的依赖项，避免无限循环

  // 快捷键
  useKeyboardShortcuts({
    quickSwitcherShortcut: keyboardShortcuts.quickSwitcher,
    onCtrlTab: () => {
      setQuickSwitcherOpen(true);
    },
    onEscape: () => {
      if (quickSwitcherOpen) {
        setQuickSwitcherOpen(false);
        return true;
      }
      return false;
    },
    enabled: isActive,
  });

  // 处理组内窗口激活
  const handleWindowActivate = useCallback(
    (windowId: string) => {
      setActiveWindowInGroup(group.id, windowId);
    },
    [group.id, setActiveWindowInGroup]
  );

  const destroyWindowIds = useCallback(async (windowIds: string[]) => {
    for (const windowId of windowIds) {
      const targetWindow = useWindowStore.getState().getWindowById(windowId);
      if (!targetWindow) {
        continue;
      }

      if (isEphemeralSSHCloneWindow(targetWindow)) {
        await destroyWindowResourcesAndRemoveRecord(windowId);
        continue;
      }

      if (getWindowKind(targetWindow) === 'ssh') {
        await destroySSHWindowFamilyResources(targetWindow, {
          removeTargetRecord: false,
          includeOwnedClones: true,
        });
        continue;
      }

      await destroyWindowResourcesKeepRecord(windowId);
    }
  }, []);

  // 处理快速切换器选择
  const handleQuickSwitcherSelect = useCallback(
    (windowId: string) => {
      setQuickSwitcherOpen(false);
      // 检查窗口是否在当前组内
      if (groupWindowIdSet.has(windowId)) {
        setActiveWindowInGroup(group.id, windowId);
      } else {
        onWindowSwitch(windowId);
      }
    },
    [group.id, groupWindowIdSet, setActiveWindowInGroup, onWindowSwitch]
  );

  // 处理快速切换器选择窗口组
  const handleQuickSwitcherSelectGroup = useCallback(
    (groupId: string) => {
      setQuickSwitcherOpen(false);
      if (groupId !== group.id) {
        onGroupSwitch?.(groupId);
      }
    },
    [group.id, onGroupSwitch]
  );

  const handleQuickSwitcherSelectCanvas = useCallback(
    (canvasWorkspaceId: string) => {
      setQuickSwitcherOpen(false);
      onCanvasSwitch?.(canvasWorkspaceId);
    },
    [onCanvasSwitch],
  );

  const handleQuickSwitcherClose = useCallback(() => {
    setQuickSwitcherOpen(false);
    restoreActiveTerminalFocus({ defer: true });
  }, [restoreActiveTerminalFocus]);

  const handleSettingsPanelClose = useCallback(() => {
    setIsSettingsPanelOpen(false);
    restoreActiveTerminalFocus({ defer: true });
  }, [restoreActiveTerminalFocus]);

  // 处理归档组
  const handleArchiveGroup = useCallback(async () => {
    const state = useWindowStore.getState();
    const currentGroup = state.getGroupById(group.id);
    const currentLayout = currentGroup?.layout ?? group.layout;
    const persistableWindowIds = getAllWindowIds(currentLayout).filter((windowId) => {
      const targetWindow = state.getWindowById(windowId);
      return Boolean(targetWindow && !targetWindow.ephemeral);
    });

    try {
      await destroyWindowIds(getAllWindowIds(currentLayout));

      if (persistableWindowIds.length === 0) {
        onReturn();
        return;
      }

      const nextState = useWindowStore.getState();
      const activePersistableWindowIds = persistableWindowIds.filter((windowId) => Boolean(nextState.getWindowById(windowId)));
      if (activePersistableWindowIds.length === 0) {
        onReturn();
        return;
      }

      if (activePersistableWindowIds.length === 1) {
        archiveWindow(activePersistableWindowIds[0]);
        onReturn();
        return;
      }

      if (nextState.getGroupById(group.id)) {
        archiveGroup(group.id);
      } else {
        activePersistableWindowIds.forEach((windowId) => {
          archiveWindow(windowId);
        });
      }
      onReturn();
    } catch (error) {
      console.error('Failed to archive group:', error);
    }
  }, [archiveGroup, archiveWindow, destroyWindowIds, group, onReturn]);

  // 处理拖拽窗口到组内
  const handleWindowDrop = useCallback(
    async (dragItem: WindowCardDragItem, dropResult: DropResult) => {
      const dragWindowId = dragItem.windowId;
      const targetWindowId = dropResult.targetWindowId;

      if (!targetWindowId || dragWindowId === targetWindowId) return;

      // 检查拖拽的窗口是否已经在当前组中
      const isInternalDrag = groupWindowIdSet.has(dragWindowId);

      if (isInternalDrag) {
        // 组内拖拽：使用原子操作重新排列窗口（避免中间状态触发解散）
        const direction = (dropResult.position === 'left' || dropResult.position === 'right')
          ? 'horizontal'
          : 'vertical';
        const insertBefore = dropResult.position === 'left' || dropResult.position === 'top';

        rearrangeWindowInGroupLayout(group.id, dragWindowId, targetWindowId, direction, insertBefore);
      } else {
        // 跨组或从主界面拖入：添加新窗口到组
        // 如果拖拽的窗口在另一个组中，先从原组移除
        const sourceGroup = findGroupByWindowId(dragWindowId);
        if (sourceGroup) {
          removeWindowFromGroupLayout(sourceGroup.id, dragWindowId);
        }

        // 确定分割方向
        const direction = (dropResult.position === 'left' || dropResult.position === 'right')
          ? 'horizontal'
          : 'vertical';

        // 添加窗口到当前组
        addWindowToGroupLayout(group.id, targetWindowId, dragWindowId, direction);

        // 自动启动拖入窗口的所有可启动窗格
        const dragWin = useWindowStore.getState().getWindowById(dragWindowId);
        if (dragWin) {
          await startStartablePanesForWindow(dragWin, getStartableTerminalPanes(dragWin));
        }
      }
    },
    [addWindowToGroupLayout, findGroupByWindowId, group.id, groupWindowIdSet, rearrangeWindowInGroupLayout, removeWindowFromGroupLayout, startStartablePanesForWindow]
  );

  // 从组中移除窗口（保持运行）
  const handleRemoveFromGroup = useCallback(async (windowId: string) => {
    // 获取移除前的窗口列表
    const windowIdsBeforeRemove = groupWindowIds;

    // 移除窗口
    removeWindowFromGroupLayout(group.id, windowId);

    // 检查分组是否被解散（窗口数 < 2）
    setTimeout(() => {
      const { getGroupById } = useWindowStore.getState();
      const currentGroup = getGroupById(group.id);

      if (!currentGroup) {
        // 分组已被解散，跳转到剩余的窗口
        const remainingWindowId = windowIdsBeforeRemove.find(id => id !== windowId);
        if (remainingWindowId) {
          onWindowSwitch(remainingWindowId, { exact: true });
        } else {
          // 没有剩余窗口，返回主界面
          onReturn();
        }
      }
    }, 0);
  }, [group.id, groupWindowIds, removeWindowFromGroupLayout, onWindowSwitch, onReturn]);

  // 销毁窗口并从组中移除
  const handleStopAndRemoveFromGroup = useCallback(async (windowId: string) => {
    // 获取移除前的窗口列表
    const windowIdsBeforeRemove = groupWindowIds;
    const targetWindow = groupWindowById.get(windowId) ?? null;

    try {
      await destroyWindowIds([windowId]);
      if (!targetWindow || !isEphemeralSSHCloneWindow(targetWindow)) {
        removeWindowFromGroupLayout(group.id, windowId);
      }
    } catch (error) {
      console.error('Failed to destroy window:', error);
    }

    // 检查分组是否被解散（窗口数 < 2）
    setTimeout(() => {
      const { getGroupById } = useWindowStore.getState();
      const currentGroup = getGroupById(group.id);

      if (!currentGroup) {
        // 分组已被解散，跳转到剩余的窗口
        const remainingWindowId = windowIdsBeforeRemove.find(id => id !== windowId);
        if (remainingWindowId) {
          onWindowSwitch(remainingWindowId, { exact: true });
        } else {
          // 没有剩余窗口，返回主界面
          onReturn();
        }
      }
    }, 0);
  }, [destroyWindowIds, group.id, groupWindowById, groupWindowIds, onReturn, onWindowSwitch, removeWindowFromGroupLayout]);

  // 批量启动组内所有窗口
  const handleStartAll = useCallback(async () => {
    for (const win of groupWindows) {
      await startStartablePanesForWindow(win, groupStartablePanesByWindowId.get(win.id) ?? []);
    }
  }, [groupStartablePanesByWindowId, groupWindows, startStartablePanesForWindow]);

  // 批量销毁组内所有窗口
  const handleDestroyAll = useCallback(async () => {
    try {
      await destroyWindowIds(groupWindowIds);
      onReturn();
    } catch (error) {
      console.error('Failed to destroy all windows in group:', error);
    }
  }, [destroyWindowIds, groupWindowIds, onReturn]);

  const handleSidebarWindowSelect = useCallback((windowId: string) => {
    if (groupWindowIdSet.has(windowId)) {
      setActiveWindowInGroup(group.id, windowId);
    } else {
      onWindowSwitch(windowId);
    }
  }, [group.id, groupWindowIdSet, onWindowSwitch, setActiveWindowInGroup]);

  const handleSidebarGroupSelect = useCallback((groupId: string) => {
    onGroupSwitch?.(groupId);
  }, [onGroupSwitch]);

  const handleSettingsClick = useCallback(() => {
    setHasMountedSettingsPanel(true);
    setIsSettingsPanelOpen(true);
  }, []);

  const toolbarButtonBaseClassName =
    'flex h-6 w-6 items-center justify-center rounded-md border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--secondary))_78%,transparent)] transition-colors';
  const titleBarActions = useMemo(() => {
    if (!isActive || !titleBarActionsSlot) {
      return null;
    }

    return createPortal(
      <div
        data-testid="group-titlebar-actions"
        className="pointer-events-auto flex h-8 items-center justify-end gap-1 px-1.5"
      >
        <AppTooltip content="启动全部" placement="toolbar-trailing">
          <button
            type="button"
            tabIndex={-1}
            onMouseDown={preventMouseButtonFocus}
            onClick={handleStartAll}
            aria-label="启动全部"
            className={`${toolbarButtonBaseClassName} text-emerald-400 hover:border-emerald-400/45 hover:bg-emerald-500/[0.12] hover:text-emerald-300`}
          >
            <Play size={14} fill="currentColor" />
          </button>
        </AppTooltip>

        <AppTooltip
          content="停止全部"
          delayDuration={200}
          placement="toolbar-trailing"
        >
          <button
            type="button"
            tabIndex={-1}
            onMouseDown={preventMouseButtonFocus}
            onClick={handleDestroyAll}
            aria-label="停止全部"
            className={`${toolbarButtonBaseClassName} cursor-pointer text-red-400 hover:border-red-400/45 hover:bg-red-500/[0.12] hover:text-red-300`}
          >
            <Square size={14} fill="currentColor" />
          </button>
        </AppTooltip>

        <AppTooltip content="归档组" placement="toolbar-trailing">
          <button
            type="button"
            tabIndex={-1}
            onMouseDown={preventMouseButtonFocus}
            onClick={handleArchiveGroup}
            aria-label="归档组"
            className={`${toolbarButtonBaseClassName} text-[rgb(var(--muted-foreground))] hover:border-[rgb(var(--ring))] hover:bg-[rgb(var(--accent))] hover:text-[rgb(var(--foreground))]`}
          >
            <Archive size={14} />
          </button>
        </AppTooltip>
      </div>,
      titleBarActionsSlot,
    );
  }, [
    handleArchiveGroup,
    handleDestroyAll,
    handleStartAll,
    isActive,
    titleBarActionsSlot,
    toolbarButtonBaseClassName,
  ]);

  return (
    <div className="flex h-full bg-transparent">
      {/* 侧边栏 */}
      <Sidebar
        activeWindowId={group.activeWindowId}
        activeGroupId={group.id}
        onWindowSelect={handleSidebarWindowSelect}
        onGroupSelect={handleSidebarGroupSelect}
        onCanvasSelect={onCanvasSwitch}
        onSettingsClick={handleSettingsClick}
      />

      {/* 主内容区 */}
      <div className="flex flex-1 flex-col overflow-hidden bg-transparent">
        {titleBarActions}

        {/* 组布局区域 */}
        <div className="flex-1 overflow-hidden">
          <GroupSplitLayout
            groupId={group.id}
            layout={group.layout}
            activeWindowId={group.activeWindowId}
            isGroupActive={isActive}
            onWindowActivate={handleWindowActivate}
            onWindowSwitch={onWindowSwitch}
            onReturn={onReturn}
            onWindowDrop={handleWindowDrop}
            onRemoveFromGroup={handleRemoveFromGroup}
            onStopAndRemoveFromGroup={handleStopAndRemoveFromGroup}
          />
        </div>
      </div>

      {/* 快速切换面板 */}
      {quickSwitcherOpen && (
        <Suspense fallback={null}>
          <LazyQuickSwitcher
            isOpen={quickSwitcherOpen}
            currentWindowId={group.activeWindowId}
            currentGroupId={group.id}
            sshProfiles={sshProfiles}
            onSelect={handleQuickSwitcherSelect}
            onSelectGroup={handleQuickSwitcherSelectGroup}
            onSelectCanvas={handleQuickSwitcherSelectCanvas}
            onClose={handleQuickSwitcherClose}
          />
        </Suspense>
      )}

      {/* 设置面板 */}
      {hasMountedSettingsPanel && (
        <Suspense fallback={null}>
          <LazySettingsPanel
            open={isSettingsPanelOpen}
            onClose={handleSettingsPanelClose}
          />
        </Suspense>
      )}
    </div>
  );
};

GroupView.displayName = 'GroupView';
