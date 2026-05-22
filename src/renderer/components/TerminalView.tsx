import React, { Suspense, lazy, useCallback, useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useDrag } from 'react-dnd';
import { getEmptyImage } from 'react-dnd-html5-backend';
import { useShallow } from 'zustand/react/shallow';
import { v4 as uuidv4 } from 'uuid';
import { SplitSquareHorizontal, SplitSquareVertical, Folder, Archive, Square, LogOut, SquareX, RotateCw, Play, Waypoints, FolderTree, Activity, Globe, Plus, MessageSquare, Pin } from 'lucide-react';
import { Window, Pane, WindowStatus } from '../types/window';
import { findPanePath, getAggregatedStatus, getAllPanes } from '../utils/layoutHelpers';
import { Sidebar } from './Sidebar';
import { SplitLayout } from './SplitLayout';
import { RemoteWindowTabs } from './RemoteWindowTabs';
import { useWindowStore } from '../stores/windowStore';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { useKeyboardShortcutSettings } from '../hooks/useKeyboardShortcutSettings';
import { IDEIcon } from './icons/IDEIcons';
import { useIDESettings } from '../hooks/useIDESettings';
import { ProjectLinks } from './ProjectLinks';
import { useI18n } from '../i18n';
import { DragItemTypes, DropZone } from './dnd';
import type { BrowserDropDragItem, BrowserToolDragItem, PaneDropResult, WindowCardDragItem, DropResult } from './dnd';
import { createGroup } from '../utils/groupLayoutHelpers';
import { AppTooltip } from './ui/AppTooltip';
import { CUSTOM_TITLEBAR_ACTIONS_SLOT_ID } from './CustomTitleBar';
import { SSHPortForwardDialog } from './SSHPortForwardDialog';
import { SSHSessionStatusBar } from './SSHSessionStatusBar';
import type { SSHCredentialState, SSHProfile } from '../../shared/types/ssh';
import {
  canPaneOpenInIDE,
  canPaneOpenLocalFolder,
  canPaneWatchGitBranch,
  getPaneBackend,
  getPaneCapabilities,
  getWindowKind,
  isBrowserPane,
  isChatPane,
  isCodePane,
  isSessionlessPane,
  isTerminalPane,
} from '../../shared/utils/terminalCapabilities';
import {
  createPaneDraftFromSource,
  startSplitPaneFromSource,
  startWindowPanes,
} from '../utils/paneSessionActions';
import {
  createBrowserPaneDraft,
  DEFAULT_BROWSER_URL,
  getSmartBrowserSplitDirection,
} from '../utils/browserPane';
import { createCodePaneDraft } from '../utils/codePane';
import { createChatPaneDraft, selectPreferredChatLinkedPaneId } from '../utils/chatPane';
import { setBrowserDropDragActive } from '../utils/browserDropDragState';
import { resolveBrowserDropAction } from '../utils/browserDrop';
import {
  applyWindowStartResult,
  createWindowDraftFromSourcePane,
  startClonedWindowFromSourcePane,
} from '../utils/windowSessionActions';
import {
  getStandalonePersistableWindows,
  getSSHSessionOwnerWindowId,
  getStandaloneSSHWindowsForTarget,
  isEphemeralSSHCloneWindow,
} from '../utils/sshWindowBindings';
import { preventMouseButtonFocus } from '../utils/buttonFocus';
import { requestActiveTerminalFocus } from '../utils/terminalFocus';
import { destroyWindowResourcesKeepRecord, isWindowResourceDestructionPending } from '../utils/windowDestruction';
import { idePopupIconButtonClassName } from './ui/ide-popup';
import { getInactiveWindowStatus, getStartablePanes, hasAnyLiveTerminalSession, isInactiveTerminalPaneStatus } from '../utils/windowLifecycle';
import { appearanceTitlebarSurfaceStyle } from '../utils/appearance';
import { usePaneNoteStore } from '../stores/paneNoteStore';
import type { WindowSwitchHandler } from '../types/windowSwitch';

const CHAT_PANE_DEFAULT_SPLIT_SIZES: [number, number] = [0.7, 0.3];
const CODE_PANE_DEFAULT_SPLIT_SIZES: [number, number] = [0.7, 0.3];

const LazyQuickSwitcher = lazy(async () => ({
  default: (await import('./QuickSwitcher')).QuickSwitcher,
}));

const LazySettingsPanel = lazy(async () => ({
  default: (await import('./SettingsPanel')).SettingsPanel,
}));

const LazySSHSftpDialog = lazy(async () => ({
  default: (await import('./SSHSftpDialog')).SSHSftpDialog,
}));

function getAdjacentSSHWindowId(
  windows: Window[],
  currentWindowId: string,
  excludedWindowIds: Set<string>,
): string | null {
  const currentIndex = windows.findIndex((window) => window.id === currentWindowId);
  if (currentIndex < 0) {
    return null;
  }

  for (let index = currentIndex + 1; index < windows.length; index += 1) {
    const candidate = windows[index];
    if (!excludedWindowIds.has(candidate.id)) {
      return candidate.id;
    }
  }

  for (let index = currentIndex - 1; index >= 0; index -= 1) {
    const candidate = windows[index];
    if (!excludedWindowIds.has(candidate.id)) {
      return candidate.id;
    }
  }

  return null;
}

function getNextWindowAfterClose(
  windows: Window[],
  currentWindowId: string,
  excludedWindowIds: Set<string>,
): string | null {
  const remoteScopedWindows = getStandaloneSSHWindowsForTarget(windows, currentWindowId);
  const adjacentRemoteWindowId = getAdjacentSSHWindowId(remoteScopedWindows, currentWindowId, excludedWindowIds);
  if (adjacentRemoteWindowId) {
    return adjacentRemoteWindowId;
  }

  return getStandalonePersistableWindows(windows).find((window) => (
    !window.archived
    && !excludedWindowIds.has(window.id)
    && hasAnyLiveTerminalSession(window)
  ))?.id ?? null;
}

function SplitBrowserIcon() {
  return (
    <span className="relative inline-flex h-[15px] w-[15px] items-center justify-center">
      <Globe size={15} strokeWidth={1.8} />
      <span className="absolute -right-1 -top-1 flex h-[7px] w-[7px] items-center justify-center text-current">
        <Plus size={6} strokeWidth={2.6} />
      </span>
    </span>
  );
}

function SplitChatIcon() {
  return <MessageSquare size={15} strokeWidth={1.8} />;
}

interface TerminalRemoteWindowTabsProps {
  activeWindowId: string;
  cloneLabel: string;
  closeLabel: string;
  onWindowSelect: (windowId: string) => void;
  onWindowClone: (windowId: string) => void;
  onWindowClose: (windowId: string) => void;
}

const TerminalRemoteWindowTabs = React.memo(({
  activeWindowId,
  cloneLabel,
  closeLabel,
  onWindowSelect,
  onWindowClone,
  onWindowClose,
}: TerminalRemoteWindowTabsProps) => {
  const windows = useWindowStore(useShallow((state) => (
    getStandaloneSSHWindowsForTarget(state.windows, activeWindowId)
  )));

  return (
    <RemoteWindowTabs
      windows={windows}
      activeWindowId={activeWindowId}
      cloneLabel={cloneLabel}
      closeLabel={closeLabel}
      onWindowSelect={onWindowSelect}
      onWindowClone={onWindowClone}
      onWindowClose={onWindowClose}
      variant="windowHeader"
    />
  );
});

TerminalRemoteWindowTabs.displayName = 'TerminalRemoteWindowTabs';

function getAggregatedStatusFromPanes(panes: Pane[]): WindowStatus {
  if (panes.length === 0) {
    return WindowStatus.Completed;
  }

  let hasRunning = false;
  let hasRestoring = false;
  let hasWaiting = false;
  let hasError = false;
  let hasCompleted = false;

  for (const pane of panes) {
    hasRunning ||= pane.status === WindowStatus.Running;
    hasRestoring ||= pane.status === WindowStatus.Restoring;
    hasWaiting ||= pane.status === WindowStatus.WaitingForInput;
    hasError ||= pane.status === WindowStatus.Error;
    hasCompleted ||= isInactiveTerminalPaneStatus(pane.status);
  }

  if (hasRunning) return WindowStatus.Running;
  if (hasRestoring) return WindowStatus.Restoring;
  if (hasWaiting) return WindowStatus.WaitingForInput;
  if (hasError) return WindowStatus.Error;
  if (hasCompleted) return WindowStatus.Completed;
  return getInactiveWindowStatus(panes);
}

function getWindowKindFromPanes(window: Window, panes: Pane[]): NonNullable<Window['kind']> {
  if (window.kind) {
    return window.kind;
  }

  let hasLocal = false;
  let hasSSH = false;

  for (const pane of panes) {
    if (isSessionlessPane(pane)) {
      continue;
    }

    if (getPaneBackend(pane) === 'ssh') {
      hasSSH = true;
    } else {
      hasLocal = true;
    }

    if (hasLocal && hasSSH) {
      return 'mixed';
    }
  }

  return hasSSH ? 'ssh' : 'local';
}

export interface TerminalViewProps {
  window: Window;
  onReturn: () => void;
  onWindowSwitch: WindowSwitchHandler;
  onCanvasSwitch?: (canvasWorkspaceId: string) => void;
  isActive: boolean;
  /** 嵌入模式：在 GroupView 中使用时隐藏侧边栏和返回按钮，但保留顶部工具栏 */
  embedded?: boolean;
  /** 画布嵌入模式：只渲染终端内容，不显示侧栏、标题栏动作和远程标签 */
  canvasEmbedded?: boolean;
  /** 画布实时停靠模式：复用已挂载终端内容，隐藏独立终端 chrome。 */
  canvasLiveDocked?: boolean;
  /** 是否允许此视图把 xterm 输入写回 PTY；隐藏的备用挂载实例会关闭它，避免重复协议响应污染同一会话。 */
  ptyInputEnabled?: boolean;
  /** 所属组 ID（嵌入模式下传入） */
  groupId?: string;
  /** 从组中移除窗口的回调 */
  onRemoveFromGroup?: (windowId: string) => void;
  /** 停止并从组中移除窗口的回调 */
  onStopAndRemoveFromGroup?: (windowId: string) => void;
  /** 切换到指定组的回调 */
  onGroupSwitch?: (groupId: string) => void;
  sshEnabled?: boolean;
  sshProfiles?: SSHProfile[];
  onSSHProfileSaved?: (profile: SSHProfile, credentialState: SSHCredentialState) => void;
}

/**
 * TerminalView 缁勪欢
 * 鏀寔澶氱獥鏍兼媶鍒嗙殑缁堢瑙嗗浘
 */
export const TerminalView: React.FC<TerminalViewProps> = ({
  window: terminalWindow,
  onReturn,
  onWindowSwitch,
  onCanvasSwitch,
  isActive,
  embedded = false,
  canvasEmbedded = false,
  canvasLiveDocked = false,
  ptyInputEnabled = true,
  groupId,
  onRemoveFromGroup,
  onStopAndRemoveFromGroup,
  onGroupSwitch,
  sshEnabled = false,
  sshProfiles = [],
  onSSHProfileSaved,
}) => {
  const { t } = useI18n();
  const { enabledIDEs } = useIDESettings();
  const {
    activePane,
    activeTerminalPane,
    aggregatedStatus,
    existingCodePane,
    firstWatchableGitCwd,
    hasChatPaneInWindow,
    panes,
    terminalPanes,
    windowKind,
  } = useMemo<{
    activePane: Pane | undefined;
    activeTerminalPane: Pane | null;
    aggregatedStatus: WindowStatus;
    existingCodePane: Pane | null;
    firstWatchableGitCwd: string | null;
    hasChatPaneInWindow: boolean;
    panes: Pane[];
    terminalPanes: Pane[];
    windowKind: NonNullable<Window['kind']>;
  }>(() => {
    const nextPanes = getAllPanes(terminalWindow.layout);
    const nextTerminalPanes: Pane[] = [];
    let nextExistingCodePane: Pane | null = null;
    let nextHasChatPane = false;
    let nextFirstWatchableGitCwd: string | null = null;

    nextPanes.forEach((pane) => {
      if (isTerminalPane(pane)) {
        nextTerminalPanes.push(pane);
        if (!nextFirstWatchableGitCwd && pane.cwd && canPaneWatchGitBranch(pane)) {
          nextFirstWatchableGitCwd = pane.cwd;
        }
      }

      if (!nextExistingCodePane && isCodePane(pane)) {
        nextExistingCodePane = pane;
      }

      if (!nextHasChatPane && isChatPane(pane)) {
        nextHasChatPane = true;
      }
    });

    const nextActivePane = nextPanes.find((pane) => pane.id === terminalWindow.activePaneId) ?? nextPanes[0];
    const nextActiveTerminalPane = nextActivePane && isTerminalPane(nextActivePane)
      ? nextActivePane
      : nextTerminalPanes[0] ?? null;

    return {
      activePane: nextActivePane,
      activeTerminalPane: nextActiveTerminalPane,
      aggregatedStatus: getAggregatedStatusFromPanes(nextPanes),
      existingCodePane: nextExistingCodePane,
      firstWatchableGitCwd: nextFirstWatchableGitCwd,
      hasChatPaneInWindow: nextHasChatPane,
      panes: nextPanes,
      terminalPanes: nextTerminalPanes,
      windowKind: getWindowKindFromPanes(terminalWindow, nextPanes),
    };
  }, [terminalWindow]);
  const hasCodePaneInWindow = Boolean(existingCodePane);
  const terminalPaneCount = terminalPanes.length;
  const preferredChatLinkedPaneId = useMemo(
    () => selectPreferredChatLinkedPaneId(panes),
    [panes],
  );
  const activePaneCapabilities = useMemo(
    () => activeTerminalPane ? getPaneCapabilities(activeTerminalPane) : null,
    [activeTerminalPane]
  );
  const isStandaloneSshWindow = windowKind === 'ssh';
  const activeSshRuntimeCwd = activeTerminalPane?.cwd ?? activeTerminalPane?.ssh?.remoteCwd ?? null;
  const visibleIDEs = useMemo(
    () => activePaneCapabilities?.canOpenInIDE ? enabledIDEs : [],
    [activePaneCapabilities?.canOpenInIDE, enabledIDEs]
  );
  const isWindowRunning = aggregatedStatus === WindowStatus.Running || aggregatedStatus === WindowStatus.WaitingForInput;
  const isEphemeralRemoteTab = useMemo(
    () => isEphemeralSSHCloneWindow(terminalWindow),
    [terminalWindow],
  );
  const sidebarActiveWindowId = terminalWindow.id;
  const showRemoteWindowTabs = useMemo(
    () => isStandaloneSshWindow && !canvasEmbedded && !canvasLiveDocked,
    [canvasEmbedded, canvasLiveDocked, isStandaloneSshWindow],
  );
  const showFloatingChrome = isActive && !canvasLiveDocked;
  const canSplitActivePane = useMemo(
    () => Boolean(activePane && !isChatPane(activePane) && !isCodePane(activePane)),
    [activePane],
  );
  const keyboardShortcuts = useKeyboardShortcutSettings();

  // 鍒囨崲闈㈡澘鐘舵€?
  const [quickSwitcherOpen, setQuickSwitcherOpen] = useState(false);
  const [isSettingsPanelOpen, setIsSettingsPanelOpen] = useState(false);
  const [hasMountedSettingsPanel, setHasMountedSettingsPanel] = useState(false);
  const [sshPortForwardTarget, setSSHPortForwardTarget] = useState<{ windowId: string; paneId: string } | null>(null);
  const [sshSftpOpen, setSSHSftpOpen] = useState(false);
  const [sshMetricsOpen, setSSHMetricsOpen] = useState(false);
  const [titleBarActionsSlot, setTitleBarActionsSlot] = useState<HTMLElement | null>(null);

  const restoreActiveTerminalFocus = useCallback((options?: { defer?: boolean }) => {
    if (!activePane || !isTerminalPane(activePane) || !activeTerminalPane) {
      return;
    }

    requestActiveTerminalFocus({
      windowId: terminalWindow.id,
      paneId: activeTerminalPane.id,
      defer: options?.defer,
    });
  }, [activePane, activeTerminalPane, terminalWindow.id]);

  useEffect(() => {
    if (canvasEmbedded || canvasLiveDocked) {
      setTitleBarActionsSlot(null);
      return;
    }

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
  }, [canvasEmbedded, canvasLiveDocked]);

  // Store
  const addWindow = useWindowStore((state) => state.addWindow);
  const removeWindow = useWindowStore((state) => state.removeWindow);
  const splitPaneInWindow = useWindowStore((state) => state.splitPaneInWindow);
  const placePaneInWindow = useWindowStore((state) => state.placePaneInWindow);
  const movePaneInWindow = useWindowStore((state) => state.movePaneInWindow);
  const closePaneInWindow = useWindowStore((state) => state.closePaneInWindow);
  const setActivePane = useWindowStore((state) => state.setActivePane);
  const updateSplitSizes = useWindowStore((state) => state.updateSplitSizes);
  const archiveWindow = useWindowStore((state) => state.archiveWindow);
  const updatePane = useWindowStore((state) => state.updatePane);
  const addGroup = useWindowStore((state) => state.addGroup);
  const setActiveGroup = useWindowStore((state) => state.setActiveGroup);
  const findGroupByWindowId = useWindowStore((state) => state.findGroupByWindowId);
  const addWindowToGroupLayout = useWindowStore((state) => state.addWindowToGroupLayout);
  const removeWindowFromGroupLayout = useWindowStore((state) => state.removeWindowFromGroupLayout);
  const openPaneNoteDraft = usePaneNoteStore((state) => state.openDraft);

  const destroyRemoteWindows = useCallback(
    async (windowIds: string[]) => {
      for (const windowId of windowIds) {
        await destroyWindowResourcesKeepRecord(windowId);
      }
    },
    [],
  );
  const deleteRemoteWindows = useCallback(
    async (windowIds: string[]) => {
      for (const windowId of windowIds) {
        await destroyWindowResourcesKeepRecord(windowId);
        removeWindow(windowId);
      }
    },
    [removeWindow],
  );

  // 纭繚绐楀彛婵€娲绘椂锛屾縺娲荤涓€涓獥鏍?
  useEffect(() => {
    if (!isActive) return;

    // 濡傛灉娌℃湁婵€娲荤殑绐楁牸锛屾垨婵€娲荤殑绐楁牸涓嶅湪褰撳墠绐楁牸鍒楄〃涓紝鍒欐縺娲荤涓€涓獥鏍?
    if (!terminalWindow.activePaneId || !panes.some((pane) => pane.id === terminalWindow.activePaneId)) {
      if (panes.length > 0) {
        setActivePane(terminalWindow.id, panes[0].id);
      }
    }
  }, [isActive, terminalWindow.activePaneId, terminalWindow.id, panes, setActivePane]);

  useEffect(() => {
    if (!isActive || !firstWatchableGitCwd) {
      return undefined;
    }

    // 绐楀彛婵€娲绘椂锛屽惎鍔?git 鍒嗘敮鐩戝惉
    if (window.electronAPI?.startGitWatch) {
      window.electronAPI.startGitWatch(terminalWindow.id, firstWatchableGitCwd).catch((error: any) => {
        // 蹇界暐閿欒
      });
    }

    // 绐楀彛澶辨椿鏃讹紝鍋滄 git 鍒嗘敮鐩戝惉
    return () => {
      if (window.electronAPI?.stopGitWatch) {
        window.electronAPI.stopGitWatch(terminalWindow.id).catch((error: any) => {
          // 蹇界暐閿欒
        });
      }
    };
  }, [firstWatchableGitCwd, isActive, terminalWindow.id]);

  // 蹇嵎閿鐞?
  useKeyboardShortcuts({
    quickSwitcherShortcut: keyboardShortcuts.quickSwitcher,
    onCtrlTab: () => {
      setQuickSwitcherOpen(true);
    },
    onEscape: () => {
      // 鍙湁褰撻潰鏉挎墦寮€鏃舵墠澶勭悊 ESC 閿?
      if (quickSwitcherOpen) {
        setQuickSwitcherOpen(false);
        return true; // 琛ㄧず宸插鐞嗭紝闃绘浼犳挱鍒扮粓绔?
      }
      // 娌℃湁闈㈡澘鎵撳紑鏃讹紝杩斿洖 false锛岃 ESC 閿紶閫掑埌缁堢
      return false;
    },
    enabled: isActive,
  });

  // 澶勭悊绐楁牸婵€娲?
  const handlePaneActivate = useCallback(
    (paneId: string) => {
      setActivePane(terminalWindow.id, paneId);
    },
    [terminalWindow.id, setActivePane]
  );

  // 澶勭悊绐楁牸鍏抽棴
  const handlePaneClose = useCallback(
    (paneId: string) => {
      const paneToClose = panes.find((pane) => pane.id === paneId);
      if (!paneToClose) {
        return;
      }

      if (panes.length <= 1) {
        return;
      }

      const remainingPanes = panes.filter((pane) => pane.id !== paneId);
      if (remainingPanes.length > 0 && remainingPanes.every((pane) => !isTerminalPane(pane))) {
        return;
      }

      closePaneInWindow(terminalWindow.id, paneId);
    },
    [terminalWindow.id, panes, closePaneInWindow]
  );

  const destroyCurrentEphemeralRemoteWindow = useCallback(async () => {
    const allWindows = useWindowStore.getState().windows;
    const closingWindowIdSet = new Set([terminalWindow.id]);
    const nextWindowId = getNextWindowAfterClose(allWindows, terminalWindow.id, closingWindowIdSet);

    if (nextWindowId) {
      onWindowSwitch(nextWindowId, { exact: true });
    }

    await destroyRemoteWindows([terminalWindow.id]);

    if (!nextWindowId) {
      onReturn();
    }
  }, [destroyRemoteWindows, onReturn, onWindowSwitch, terminalWindow.id]);

  const destroyCurrentSSHWindowAfterExit = useCallback(async () => {
    const allWindows = useWindowStore.getState().windows;
    const closingWindowIdSet = new Set([terminalWindow.id]);
    const nextWindowId = getNextWindowAfterClose(allWindows, terminalWindow.id, closingWindowIdSet);

    if (nextWindowId) {
      onWindowSwitch(nextWindowId, { exact: true });
    }

    await deleteRemoteWindows([terminalWindow.id]);

    if (!nextWindowId) {
      onReturn();
    }
  }, [deleteRemoteWindows, onReturn, onWindowSwitch, terminalWindow.id]);

  const handleDeleteWindow = useCallback(async () => {
    if (isEphemeralRemoteTab) {
      await destroyCurrentEphemeralRemoteWindow();
      return;
    }

    try {
      const { windows } = useWindowStore.getState();
      const closingWindowIdSet = new Set([terminalWindow.id]);
      const nextWindowId = getNextWindowAfterClose(windows, terminalWindow.id, closingWindowIdSet);

      if (nextWindowId) {
        onWindowSwitch(nextWindowId, { exact: true });

        setTimeout(async () => {
          try {
            await destroyWindowResourcesKeepRecord(terminalWindow.id);
          } catch (error) {
            console.error('Failed to close and delete window:', error);
          }
        }, 100);
      } else {
        await destroyWindowResourcesKeepRecord(terminalWindow.id);
        onReturn();
      }
    } catch (error) {
      console.error('Failed to delete window:', error);
    }
  }, [destroyCurrentEphemeralRemoteWindow, isEphemeralRemoteTab, onReturn, onWindowSwitch, terminalWindow.id]);

  // 处理窗格进程退出
  const handlePaneExit = useCallback(
    (paneId: string) => {
      if (!terminalWindow) return;
      const exitingPane = panes.find((pane) => pane.id === paneId);

      const shouldPreserveInactiveStoppedSplit = !embedded
        && !isActive
        && terminalPaneCount > 1
        && (
          isWindowResourceDestructionPending(terminalWindow.id)
          || terminalPanes.every((pane) => isInactiveTerminalPaneStatus(pane.status))
        );

      if (exitingPane && isTerminalPane(exitingPane) && shouldPreserveInactiveStoppedSplit) {
        return;
      }

      if (exitingPane && isTerminalPane(exitingPane) && terminalPaneCount <= 1) {
        if (canvasEmbedded) {
          void destroyWindowResourcesKeepRecord(terminalWindow.id).catch((error) => {
            console.error('Failed to destroy canvas embedded window session after pane exit:', error);
          });
          return;
        }

        if (!embedded && !isActive) {
          const destroyExitedWindow = getPaneBackend(exitingPane) === 'ssh'
            ? deleteRemoteWindows([terminalWindow.id])
            : destroyWindowResourcesKeepRecord(terminalWindow.id);

          void destroyExitedWindow.catch((error) => {
            console.error('Failed to destroy inactive window session after pane exit:', error);
          });
          return;
        }

        // 单窗格窗口退出
        if (embedded && onStopAndRemoveFromGroup) {
          // 窗口组内：复用"停止并移除"逻辑
          onStopAndRemoveFromGroup(terminalWindow.id);
        } else if (isEphemeralRemoteTab) {
          void destroyCurrentEphemeralRemoteWindow().catch((error) => {
            console.error('Failed to destroy ephemeral remote window after pane exit:', error);
          });
        } else if (getPaneBackend(exitingPane) === 'ssh') {
          void destroyCurrentSSHWindowAfterExit().catch((error) => {
            console.error('Failed to destroy ssh window after pane exit:', error);
          });
        } else {
          const allWindows = useWindowStore.getState().windows;
          const closingWindowIdSet = new Set([terminalWindow.id]);
          const nextWindowId = getNextWindowAfterClose(allWindows, terminalWindow.id, closingWindowIdSet);
          const hasNonTerminalSibling = panes.some((pane) => pane.id !== paneId);

          if (nextWindowId) {
            onWindowSwitch(nextWindowId, { exact: true });
          }

          void destroyWindowResourcesKeepRecord(terminalWindow.id).then(() => {
            if (!nextWindowId && !hasNonTerminalSibling) {
              onReturn();
            }
          }).catch((error) => {
            console.error('Failed to destroy window session after pane exit:', error);
          });
        }
      } else {
        // 多窗格：复用关闭窗格逻辑
        closePaneInWindow(terminalWindow.id, paneId);
      }
    },
    [
      terminalWindow,
      panes,
      terminalPanes,
      terminalPaneCount,
      canvasEmbedded,
      embedded,
      isActive,
      deleteRemoteWindows,
      onStopAndRemoveFromGroup,
      isEphemeralRemoteTab,
      destroyCurrentEphemeralRemoteWindow,
      destroyCurrentSSHWindowAfterExit,
      closePaneInWindow,
      onWindowSwitch,
      onReturn,
      terminalWindow.id,
    ]
  );

  // 澶勭悊鎷嗗垎绐楁牸
  const handleSplitPane = useCallback(
    async (direction: 'horizontal' | 'vertical') => {
      const activePaneId = terminalWindow.activePaneId;
      if (!activePaneId) return;

      const { getPaneById } = useWindowStore.getState();
      const sourcePane = getPaneById(terminalWindow.id, activePaneId);
      if (!sourcePane) {
        return;
      }

      if (isBrowserPane(sourcePane)) {
        const newPaneId = uuidv4();
        const newPane = createBrowserPaneDraft(newPaneId, sourcePane.browser?.url ?? DEFAULT_BROWSER_URL);
        splitPaneInWindow(terminalWindow.id, activePaneId, direction, newPane);
        return;
      }

      if (isCodePane(sourcePane) || isChatPane(sourcePane)) {
        return;
      }

      const newPaneId = uuidv4();
      const newPane: Pane = createPaneDraftFromSource(sourcePane, newPaneId);

      splitPaneInWindow(terminalWindow.id, activePaneId, direction, newPane);

      try {
        const response = await startSplitPaneFromSource({
          sourceWindowId: terminalWindow.id,
          sourcePane,
          targetWindowId: terminalWindow.id,
          targetPaneId: newPaneId,
        });

        const paneStillExists = useWindowStore.getState().getPaneById(terminalWindow.id, newPaneId);
        if (!paneStillExists) {
          await window.electronAPI.closePane(terminalWindow.id, newPaneId);
          return;
        }

        updatePane(terminalWindow.id, newPaneId, {
          pid: response.pid,
          sessionId: response.sessionId,
          status: response.status,
        });
      } catch (error) {
        console.error('Failed to split pane:', error);
        closePaneInWindow(terminalWindow.id, newPaneId, { syncProcess: false });
        return;
      }
    },
    [activeTerminalPane?.id, t, terminalWindow.id, terminalWindow.activePaneId, splitPaneInWindow, updatePane, closePaneInWindow]
  );

  const handleSplitBrowserPane = useCallback(() => {
    const activePaneId = terminalWindow.activePaneId;
    if (!activePaneId) {
      return;
    }

    const { getPaneById } = useWindowStore.getState();
    const sourcePane = getPaneById(terminalWindow.id, activePaneId);
    if (!sourcePane) {
      return;
    }

    const newPaneId = uuidv4();
    const sourceUrl = isBrowserPane(sourcePane)
      ? sourcePane.browser?.url ?? DEFAULT_BROWSER_URL
      : DEFAULT_BROWSER_URL;
    const newPane = createBrowserPaneDraft(newPaneId, sourceUrl);
    const direction = getSmartBrowserSplitDirection(terminalWindow.layout, activePaneId);

    splitPaneInWindow(terminalWindow.id, activePaneId, direction, newPane);
    setActivePane(terminalWindow.id, newPaneId);
  }, [setActivePane, splitPaneInWindow, terminalWindow.activePaneId, terminalWindow.id, terminalWindow.layout]);

  const resolveCodePaneRootPath = useCallback((): string | null => {
    if (activePane && isCodePane(activePane) && activePane.code?.rootPath) {
      return activePane.code.rootPath;
    }

    if (activeTerminalPane && activeTerminalPane.backend !== 'ssh' && activeTerminalPane.cwd) {
      return activeTerminalPane.cwd;
    }

    const fallbackLocalTerminalPane = panes.find((pane) => (
      isTerminalPane(pane)
      && pane.backend !== 'ssh'
      && Boolean(pane.cwd)
    ));

    return fallbackLocalTerminalPane?.cwd ?? null;
  }, [activePane, activeTerminalPane, panes]);
  const codePaneRootPath = resolveCodePaneRootPath();
  const isSshOnlyWindow = terminalPanes.length > 0
    && terminalPanes.every((pane) => getPaneBackend(pane) === 'ssh');

  const ensureCodePaneWidth = useCallback((codePaneId: string) => {
    const panePath = findPanePath(terminalWindow.layout, codePaneId);
    const parentSplitEntry = panePath?.[panePath.length - 1];
    if (!parentSplitEntry || parentSplitEntry.node.direction !== 'horizontal') {
      return;
    }

    if (parentSplitEntry.node.children.length !== 2) {
      return;
    }

    const splitPath = panePath?.slice(0, -1).map((entry) => entry.childIndex) ?? [];
    const nextSizes: [number, number] = parentSplitEntry.childIndex === 0
      ? CODE_PANE_DEFAULT_SPLIT_SIZES
      : [CODE_PANE_DEFAULT_SPLIT_SIZES[1], CODE_PANE_DEFAULT_SPLIT_SIZES[0]];

    updateSplitSizes(terminalWindow.id, splitPath, nextSizes);
  }, [terminalWindow.id, terminalWindow.layout, updateSplitSizes]);

  const handleOpenCodePane = useCallback(() => {
    if (existingCodePane) {
      ensureCodePaneWidth(existingCodePane.id);
      setActivePane(terminalWindow.id, existingCodePane.id);
      return;
    }

    if (!codePaneRootPath) {
      return;
    }

    const targetPaneId = panes.find((pane) => !isCodePane(pane))?.id ?? terminalWindow.activePaneId;
    if (!targetPaneId) {
      return;
    }

    const newPaneId = uuidv4();
    const newPane = createCodePaneDraft(newPaneId, codePaneRootPath);

    placePaneInWindow(
      terminalWindow.id,
      targetPaneId,
      'horizontal',
      newPane,
      true,
      CODE_PANE_DEFAULT_SPLIT_SIZES,
    );
    setActivePane(terminalWindow.id, newPaneId);
  }, [codePaneRootPath, ensureCodePaneWidth, existingCodePane, panes, placePaneInWindow, setActivePane, terminalWindow.activePaneId, terminalWindow.id]);

  const handleSplitChatPane = useCallback(() => {
    const activePaneId = terminalWindow.activePaneId;
    if (!activePaneId || hasChatPaneInWindow) {
      return;
    }

    const { getPaneById } = useWindowStore.getState();
    const sourcePane = getPaneById(terminalWindow.id, activePaneId);
    const newPaneId = uuidv4();
    const linkedPaneId = sourcePane && isChatPane(sourcePane)
      ? selectPreferredChatLinkedPaneId(
          panes,
          sourcePane.chat?.linkedPaneId ?? preferredChatLinkedPaneId,
        )
      : isTerminalPane(sourcePane ?? ({} as Pane))
        ? selectPreferredChatLinkedPaneId(
            panes,
            getPaneBackend(sourcePane as Pane) === 'ssh' ? sourcePane?.id : undefined,
          )
        : preferredChatLinkedPaneId;
    const newPane = createChatPaneDraft(newPaneId, {
      linkedPaneId,
      activeProviderId: sourcePane && isChatPane(sourcePane) ? sourcePane.chat?.activeProviderId : undefined,
      activeModel: sourcePane && isChatPane(sourcePane) ? sourcePane.chat?.activeModel : undefined,
    });
    const direction = getSmartBrowserSplitDirection(terminalWindow.layout, activePaneId);

    splitPaneInWindow(terminalWindow.id, activePaneId, direction, newPane, CHAT_PANE_DEFAULT_SPLIT_SIZES);
    setActivePane(terminalWindow.id, newPaneId);
  }, [hasChatPaneInWindow, panes, preferredChatLinkedPaneId, setActivePane, splitPaneInWindow, terminalWindow.activePaneId, terminalWindow.id, terminalWindow.layout]);

  const activeBrowserDragUrl = useMemo(() => (
    activePane && isBrowserPane(activePane)
      ? activePane.browser?.url ?? DEFAULT_BROWSER_URL
      : DEFAULT_BROWSER_URL
  ), [activePane]);

  const [{ isDragging: isDraggingBrowserTool }, dragBrowserTool, previewBrowserTool] = useDrag<
    BrowserToolDragItem,
    unknown,
    { isDragging: boolean }
  >(() => ({
    type: DragItemTypes.BROWSER_TOOL,
    canDrag: Boolean(terminalWindow.activePaneId),
    item: () => {
      setBrowserDropDragActive(true);

      return {
        type: DragItemTypes.BROWSER_TOOL,
        windowId: terminalWindow.id,
        sourcePaneId: terminalWindow.activePaneId ?? '',
        url: activeBrowserDragUrl,
      };
    },
    end: () => {
      setBrowserDropDragActive(false);
    },
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  }), [activeBrowserDragUrl, terminalWindow.activePaneId, terminalWindow.id]);

  useEffect(() => {
    previewBrowserTool(getEmptyImage(), { captureDraggingState: true });
  }, [previewBrowserTool]);

  const browserToolButtonRef = useCallback((node: HTMLButtonElement | null) => {
    dragBrowserTool(node);
  }, [dragBrowserTool]);

  const [{ isDragging: isDraggingNoteTool }, dragNoteTool, previewNoteTool] = useDrag<
    { type: 'PANE_NOTE_TOOL'; windowId: string },
    unknown,
    { isDragging: boolean }
  >(() => ({
    type: 'PANE_NOTE_TOOL',
    canDrag: Boolean(activeTerminalPane),
    item: () => ({
      type: 'PANE_NOTE_TOOL',
      windowId: terminalWindow.id,
    }),
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  }), [activeTerminalPane, terminalWindow.id]);

  useEffect(() => {
    previewNoteTool(getEmptyImage(), { captureDraggingState: true });
  }, [previewNoteTool]);

  const noteToolButtonRef = useCallback((node: HTMLButtonElement | null) => {
    dragNoteTool(node);
  }, [dragNoteTool]);

  const handleBrowserPaneDrop = useCallback((
    item: BrowserDropDragItem,
    result: PaneDropResult,
  ) => {
    const targetPane = useWindowStore.getState().getPaneById(terminalWindow.id, result.targetPaneId);
    const action = resolveBrowserDropAction(item, result, targetPane, terminalWindow.id);

    if (action.type === 'none') {
      return;
    }

    if (action.type === 'open-in-browser-pane') {
      updatePane(terminalWindow.id, action.targetPaneId, {
        browser: {
          url: action.url,
        },
      });
      setActivePane(terminalWindow.id, action.targetPaneId);
      return;
    }

    if (action.type === 'create-browser-pane') {
      const newPaneId = uuidv4();
      const newPane = createBrowserPaneDraft(newPaneId, action.url);
      placePaneInWindow(
        terminalWindow.id,
        action.targetPaneId,
        action.direction,
        newPane,
        action.insertBefore,
      );
      setActivePane(terminalWindow.id, newPaneId);
      return;
    }

    movePaneInWindow(
      terminalWindow.id,
      action.paneId,
      action.targetPaneId,
      action.direction,
      action.insertBefore,
    );
    setActivePane(terminalWindow.id, action.paneId);
  }, [movePaneInWindow, placePaneInWindow, setActivePane, terminalWindow.id, updatePane]);

  // 澶勭悊鎵撳紑鏂囦欢澶?
  const handleOpenFolder = useCallback(async () => {
    try {
      if (activeTerminalPane && canPaneOpenLocalFolder(activeTerminalPane) && window.electronAPI) {
        await window.electronAPI.openFolder(activeTerminalPane.cwd);
      }
    } catch (error) {
      console.error('Failed to open folder:', error);
    }
  }, [activeTerminalPane]);

  // 澶勭悊鍦?IDE 涓墦寮€
  const handleOpenInIDE = useCallback(async (ide: string) => {
    try {
      if (activeTerminalPane && canPaneOpenInIDE(activeTerminalPane) && window.electronAPI) {
        const response = await window.electronAPI.openInIDE(ide, activeTerminalPane.cwd);
        if (!response.success) {
          console.error(`Failed to open in ${ide}:`, response.error);
        }
      }
    } catch (error) {
      console.error(`Failed to open in ${ide}:`, error);
    }
  }, [activeTerminalPane]);

  // 仅停止当前窗口会话，保留窗口对象；供 restart 等内部流程复用。
  const handleStopWindowSession = useCallback(async () => {
    try {
      if (isEphemeralRemoteTab) {
        await destroyCurrentEphemeralRemoteWindow();
        return;
      }

      await destroyWindowResourcesKeepRecord(terminalWindow.id);
    } catch (error) {
      console.error('Failed to stop window session:', error);
    }
  }, [destroyCurrentEphemeralRemoteWindow, isEphemeralRemoteTab, terminalWindow]);

  // 处理启动窗口
  const handleStartWindow = useCallback(async () => {
    const latestWindow = useWindowStore.getState().getWindowById(terminalWindow.id) ?? terminalWindow;
    await startWindowPanes(latestWindow, updatePane);
  }, [terminalWindow, updatePane]);

  const handleOpenSSHPortForwards = useCallback(() => {
    if (!activeTerminalPane || !activePaneCapabilities?.canManagePortForwards) {
      return;
    }

    setSSHPortForwardTarget({
      windowId: terminalWindow.id,
      paneId: activeTerminalPane.id,
    });
  }, [activeTerminalPane, activePaneCapabilities, terminalWindow.id]);

  const handleRemoteWindowSelect = useCallback((windowId: string) => {
    if (embedded && groupId) {
      useWindowStore.getState().setActiveWindowInGroup(groupId, windowId);
      return;
    }

    onWindowSwitch(windowId, { exact: true });
  }, [embedded, groupId, onWindowSwitch]);

  const handleCloneRemoteWindow = useCallback(async (windowId: string) => {
    if (embedded) {
      return;
    }

    const sourceWindow = useWindowStore.getState().getWindowById(windowId);
    if (!sourceWindow) {
      return;
    }

    const sourcePanes = getAllPanes(sourceWindow.layout);
    const sourcePane = sourcePanes.find((pane) => pane.id === sourceWindow.activePaneId && isTerminalPane(pane))
      ?? sourcePanes.find((pane) => isTerminalPane(pane));
    if (!sourcePane) {
      return;
    }

    const sourcePaneCapabilities = getPaneCapabilities(sourcePane);
    if (getPaneBackend(sourcePane) !== 'ssh' || !sourcePaneCapabilities.canCloneSession) {
      return;
    }

    const ownerWindowId = getSSHSessionOwnerWindowId(sourceWindow) ?? sourceWindow.id;
    const clonedWindowDraft: Window = {
      ...createWindowDraftFromSourcePane(sourceWindow, sourcePane),
        ephemeral: true,
      sshTabOwnerWindowId: ownerWindowId,
    };

    try {
      const result = await startClonedWindowFromSourcePane({
        sourceWindow,
        sourcePane,
        targetWindow: clonedWindowDraft,
      });

      const startedWindow = applyWindowStartResult(clonedWindowDraft, result);
      addWindow(startedWindow);
      handleRemoteWindowSelect(startedWindow.id);
    } catch (error) {
      console.error('Failed to clone session into a new window:', error);
    }
  }, [addWindow, embedded, handleRemoteWindowSelect]);

  const handleCloseRemoteWindow = useCallback(async (windowId: string) => {
    if (embedded) {
      return;
    }

    const allWindows = useWindowStore.getState().windows;
    const targetWindow = allWindows.find((window) => window.id === windowId);
    if (!targetWindow) {
      return;
    }

    const closingWindowIds = [windowId];
    const closingWindowIdSet = new Set(closingWindowIds);
    const currentWindowWillClose = closingWindowIdSet.has(terminalWindow.id);
    const nextWindowId = currentWindowWillClose
      ? getNextWindowAfterClose(allWindows, terminalWindow.id, closingWindowIdSet)
      : null;

    try {
      if (nextWindowId) {
        handleRemoteWindowSelect(nextWindowId);
      }

      await deleteRemoteWindows(closingWindowIds);

      if (!nextWindowId && currentWindowWillClose) {
        onReturn();
      }
    } catch (error) {
      console.error('Failed to close remote window:', error);
    }
  }, [deleteRemoteWindows, embedded, handleRemoteWindowSelect, onReturn, terminalWindow.id]);

  const handleOpenSSHSftp = useCallback(() => {
    if (!activeTerminalPane || !activePaneCapabilities?.canOpenSFTP) {
      return;
    }

    setSSHSftpOpen((current) => !current);
  }, [activeTerminalPane, activePaneCapabilities, terminalWindow.id]);

  useEffect(() => {
    if (sshSftpOpen && !activePaneCapabilities?.canOpenSFTP) {
      setSSHSftpOpen(false);
    }
  }, [activePaneCapabilities?.canOpenSFTP, sshSftpOpen]);

  const handleSSHSftpOpenChange = useCallback((nextOpen: boolean) => {
    setSSHSftpOpen(nextOpen);
    if (!nextOpen) {
      restoreActiveTerminalFocus({ defer: true });
    }
  }, [restoreActiveTerminalFocus]);

  // 处理重启窗口：先停止，再启动
  const handleRestartWindow = useCallback(async () => {
    if (isEphemeralRemoteTab) {
      return;
    }

    await handleStopWindowSession();
    await handleStartWindow();
  }, [handleStartWindow, handleStopWindowSession, isEphemeralRemoteTab]);

  // 澶勭悊褰掓。绐楀彛
  const handleArchiveWindow = useCallback(async () => {
    if (isEphemeralRemoteTab) {
      return;
    }

    try {
      const { windows } = useWindowStore.getState();
      const closingWindowIdSet = new Set([terminalWindow.id]);
      const nextWindowId = getNextWindowAfterClose(windows, terminalWindow.id, closingWindowIdSet);

      if (nextWindowId) {
        onWindowSwitch(nextWindowId, { exact: true });

        setTimeout(async () => {
          try {
            await destroyWindowResourcesKeepRecord(terminalWindow.id);
            archiveWindow(terminalWindow.id);
          } catch (error) {
            console.error('Failed to close and archive window:', error);
          }
        }, 100);
      } else {
        // 娌℃湁鍏朵粬绐楀彛锛屽叧闂苟褰掓。鍚庤繑鍥炰富鐣岄潰
        await destroyWindowResourcesKeepRecord(terminalWindow.id);
        archiveWindow(terminalWindow.id);
        onReturn();
      }
    } catch (error) {
      console.error('Failed to archive window:', error);
    }
  }, [archiveWindow, isEphemeralRemoteTab, onReturn, onWindowSwitch, terminalWindow.id]);

  // 澶勭悊蹇€熷垏鎹?
  const handleQuickSwitcherSelect = useCallback(
    (windowId: string) => {
      setQuickSwitcherOpen(false);
      onWindowSwitch(windowId);
    },
    [onWindowSwitch]
  );

  // 处理快速切换到窗口组
  const handleQuickSwitcherSelectGroup = useCallback(
    (groupId: string) => {
      setQuickSwitcherOpen(false);
      if (onGroupSwitch) {
        onGroupSwitch(groupId);
      }
    },
    [onGroupSwitch]
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

  const handleSSHPortForwardDialogOpenChange = useCallback((nextOpen: boolean) => {
    if (!nextOpen) {
      setSSHPortForwardTarget(null);
      restoreActiveTerminalFocus({ defer: true });
    }
  }, [restoreActiveTerminalFocus]);

  const handleSSHMetricsClose = useCallback(() => {
    setSSHMetricsOpen(false);
    restoreActiveTerminalFocus({ defer: true });
  }, [restoreActiveTerminalFocus]);

  // 处理拖拽窗口到终端区域创建或调整分组
  const handleWindowDrop = useCallback(
    async (dragItem: WindowCardDragItem, dropResult: DropResult) => {
      const dragWindowId = dragItem.windowId;
      const targetWindowId = terminalWindow.id;

      if (dragWindowId === targetWindowId) return;

      const dragGroup = findGroupByWindowId(dragWindowId);
      const targetGroup = findGroupByWindowId(targetWindowId);

      // 已在同一个组中，忽略
      if (dragGroup && targetGroup && dragGroup.id === targetGroup.id) return;

      const direction = (dropResult.position === 'left' || dropResult.position === 'right')
        ? 'horizontal'
        : 'vertical';

      // 如果拖拽的窗口在另一个组中，先从原组移除
      if (dragGroup) {
        removeWindowFromGroupLayout(dragGroup.id, dragWindowId);
      }

      if (targetGroup) {
        // 目标窗口已在组中 → 添加拖拽窗口到该组
        addWindowToGroupLayout(targetGroup.id, targetWindowId, dragWindowId, direction);
      } else {
        // 两个独立窗口 → 创建新组
        const dragWin = useWindowStore.getState().windows.find((window) => window.id === dragWindowId);
        if (!dragWin) return;

        const isReversed = dropResult.position === 'left' || dropResult.position === 'top';
        const firstId = isReversed ? dragWindowId : targetWindowId;
        const secondId = isReversed ? targetWindowId : dragWindowId;

        const groupName = `${terminalWindow.name} + ${dragWin.name}`;
        const newGroup = createGroup(groupName, firstId, secondId, direction);
        addGroup(newGroup);
        setActiveGroup(newGroup.id);
        // 新组创建后 GroupView 的 auto-start useEffect 会自动启动窗口
        return;
      }

      // 自动启动拖入窗口的所有可启动窗格
      const dragWin = useWindowStore.getState().getWindowById(dragWindowId);
      if (dragWin) {
        const startablePanes = getStartablePanes(dragWin);
        if (startablePanes.length > 0) {
          await startWindowPanes(dragWin, useWindowStore.getState().updatePane, startablePanes);
        }
      }
    },
    [terminalWindow.id, terminalWindow.name, findGroupByWindowId, addGroup, setActiveGroup, addWindowToGroupLayout, removeWindowFromGroupLayout]
  );

  const titleBarActions = useMemo(() => {
    if (!showFloatingChrome) {
      return null;
    }

    const floatingChromeClass = 'pointer-events-auto flex h-8 items-center gap-2 px-1.5';
    const floatingIconButtonClass = `${idePopupIconButtonClassName} h-6 w-6 border-transparent bg-[color-mix(in_srgb,rgb(var(--secondary))_72%,transparent)] text-[rgb(var(--foreground))]`;
    const floatingMutedIconButtonClass = `${idePopupIconButtonClassName} h-6 w-6 border-transparent bg-[color-mix(in_srgb,rgb(var(--secondary))_72%,transparent)]`;
    const floatingDividerClass = 'h-4 w-px bg-[rgb(var(--border))]';

    const actionsContent = (
      <div
        data-testid="terminal-floating-actions"
        className="pointer-events-auto flex max-w-full justify-end pr-1"
      >
        <div
          aria-expanded="true"
          className={floatingChromeClass}
        >
          <div className="flex min-w-max shrink-0 items-center gap-2">
            {terminalWindow.projectConfig && terminalWindow.projectConfig.links.length > 0 && (
              <>
                <ProjectLinks
                  links={terminalWindow.projectConfig.links}
                  variant="toolbar"
                  maxDisplay={6}
                />
                <div className={floatingDividerClass} />
              </>
            )}

            {visibleIDEs.map((ide) => (
              <AppTooltip
                key={ide.id}
                content={t('common.openInIDE', { name: ide.name })}
                placement="toolbar-trailing"
              >
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={t('common.openInIDE', { name: ide.name })}
                  onMouseDown={preventMouseButtonFocus}
                  onClick={() => handleOpenInIDE(ide.id)}
                  className={floatingIconButtonClass}
                >
                  <IDEIcon icon={ide.icon || ''} size={14} />
                </button>
              </AppTooltip>
            ))}

            {!isEphemeralRemoteTab && (
              <AppTooltip content={t('terminalView.archive')} placement="toolbar-trailing">
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={t('terminalView.archive')}
                  onMouseDown={preventMouseButtonFocus}
                  onClick={handleArchiveWindow}
                  className={floatingIconButtonClass}
                >
                  <Archive size={14} />
                </button>
              </AppTooltip>
            )}

            {activePaneCapabilities?.canOpenLocalFolder && (
              <AppTooltip content={t('terminalView.openFolder')} placement="toolbar-trailing">
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={t('terminalView.openFolder')}
                  onMouseDown={preventMouseButtonFocus}
                  onClick={handleOpenFolder}
                  className={floatingIconButtonClass}
                >
                  <Folder size={14} />
                </button>
              </AppTooltip>
            )}

            {activePaneCapabilities?.canOpenSFTP && (
              <>
                <AppTooltip content={t('terminalView.openSftp')} placement="toolbar-trailing">
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label={t('terminalView.openSftp')}
                    onMouseDown={preventMouseButtonFocus}
                    onClick={handleOpenSSHSftp}
                    className={`flex items-center justify-center h-6 w-6 rounded-md transition-colors ${
                      sshSftpOpen
                        ? 'bg-[rgb(var(--primary))]/20 text-[rgb(var(--primary))]'
                        : floatingIconButtonClass
                    }`}
                  >
                    <FolderTree size={14} />
                  </button>
                </AppTooltip>
                <AppTooltip
                  content={sshMetricsOpen ? t('terminalView.hideSshMonitor') : t('terminalView.showSshMonitor')}
                  placement="toolbar-trailing"
                >
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label={sshMetricsOpen ? t('terminalView.hideSshMonitor') : t('terminalView.showSshMonitor')}
                    onMouseDown={preventMouseButtonFocus}
                    onClick={() => setSSHMetricsOpen((current) => !current)}
                    className={`flex items-center justify-center h-6 w-6 rounded-md transition-colors ${
                      sshMetricsOpen
                        ? 'bg-[rgb(var(--primary))]/20 text-[rgb(var(--primary))]'
                        : floatingIconButtonClass
                    }`}
                  >
                    <Activity size={14} />
                  </button>
                </AppTooltip>
              </>
            )}

            {activePaneCapabilities?.canManagePortForwards && (
              <AppTooltip content={t('terminalView.managePortForwards')} placement="toolbar-trailing">
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={t('terminalView.managePortForwards')}
                  onMouseDown={preventMouseButtonFocus}
                  onClick={handleOpenSSHPortForwards}
                  className={floatingIconButtonClass}
                >
                  <Waypoints size={14} />
                </button>
              </AppTooltip>
            )}

            <AppTooltip content={t('terminalView.splitHorizontal')} placement="toolbar-trailing">
              <button
                type="button"
                tabIndex={-1}
                aria-label={t('terminalView.splitHorizontal')}
                onMouseDown={preventMouseButtonFocus}
                onClick={() => handleSplitPane('horizontal')}
                disabled={!canSplitActivePane}
                className={`${floatingIconButtonClass} disabled:cursor-not-allowed disabled:opacity-40`}
              >
                <SplitSquareHorizontal size={14} />
              </button>
            </AppTooltip>

            <AppTooltip content={t('terminalView.splitVertical')} placement="toolbar-trailing">
              <button
                type="button"
                tabIndex={-1}
                aria-label={t('terminalView.splitVertical')}
                onMouseDown={preventMouseButtonFocus}
                onClick={() => handleSplitPane('vertical')}
                disabled={!canSplitActivePane}
                className={`${floatingIconButtonClass} disabled:cursor-not-allowed disabled:opacity-40`}
              >
                <SplitSquareVertical size={14} />
              </button>
            </AppTooltip>

            <AppTooltip content={t('terminalView.splitBrowser')} placement="toolbar-trailing">
              <button
                type="button"
                tabIndex={-1}
                aria-label={t('terminalView.splitBrowser')}
                onClick={handleSplitBrowserPane}
                ref={browserToolButtonRef}
                className={`flex h-6 w-6 items-center justify-center rounded transition-colors ${isDraggingBrowserTool ? 'cursor-grabbing bg-[rgb(var(--primary))]/20 text-[rgb(var(--primary))]' : 'cursor-grab text-[rgb(var(--foreground))] hover:bg-[rgb(var(--accent))] active:cursor-grabbing'}`}
              >
                <SplitBrowserIcon />
              </button>
            </AppTooltip>

            <AppTooltip content={t('paneNote.create')} placement="toolbar-trailing">
              <button
                type="button"
                tabIndex={-1}
                aria-label={t('paneNote.create')}
                ref={noteToolButtonRef}
                onMouseDown={preventMouseButtonFocus}
                onClick={() => {
                  if (!activeTerminalPane) {
                    return;
                  }

                  openPaneNoteDraft(terminalWindow.id, activeTerminalPane.id);
                }}
                className={`flex h-6 w-6 items-center justify-center rounded transition-colors ${isDraggingNoteTool ? 'cursor-grabbing bg-[rgb(var(--primary))]/20 text-[rgb(var(--primary))]' : 'cursor-grab text-[rgb(var(--foreground))] hover:bg-[rgb(var(--accent))] active:cursor-grabbing'}`}
              >
                <Pin size={14} />
              </button>
            </AppTooltip>

            {activePaneCapabilities?.canOpenSFTP && !hasChatPaneInWindow && (
              <AppTooltip content={t('terminalView.splitChat')} placement="toolbar-trailing">
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={t('terminalView.splitChat')}
                  onMouseDown={preventMouseButtonFocus}
                  onClick={handleSplitChatPane}
                  className={floatingIconButtonClass}
                >
                  <SplitChatIcon />
                </button>
              </AppTooltip>
            )}

            {embedded && groupId && (
              <>
                <AppTooltip
                  content={t('terminalView.removeFromGroup')}
                  delayDuration={200}
                  placement="toolbar-trailing"
                >
                  <button
                    type="button"
                    tabIndex={-1}
                    onMouseDown={preventMouseButtonFocus}
                    onClick={() => onRemoveFromGroup?.(terminalWindow.id)}
                    className={floatingMutedIconButtonClass}
                  >
                    <LogOut size={14} />
                  </button>
                </AppTooltip>

                <AppTooltip
                  content={t('terminalView.stopAndRemoveFromGroup')}
                  delayDuration={200}
                  placement="toolbar-trailing"
                >
                  <button
                    type="button"
                    tabIndex={-1}
                    onMouseDown={preventMouseButtonFocus}
                    onClick={() => {
                      if (isWindowRunning) {
                        onStopAndRemoveFromGroup?.(terminalWindow.id);
                      }
                    }}
                    disabled={!isWindowRunning}
                    className={`flex items-center justify-center h-6 w-6 rounded-md border border-transparent bg-[color-mix(in_srgb,rgb(var(--secondary))_72%,transparent)] transition-colors ${
                      isWindowRunning
                        ? 'cursor-pointer text-red-500 hover:border-[rgb(var(--ring))] hover:bg-[rgb(var(--accent))]'
                        : 'cursor-not-allowed text-[rgb(var(--muted-foreground))]'
                    }`}
                  >
                    <SquareX size={14} />
                  </button>
                </AppTooltip>
              </>
            )}

            {!embedded && isWindowRunning && (
              <AppTooltip content={t('terminalView.stop')} placement="toolbar-trailing">
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={t('terminalView.stop')}
                  onMouseDown={preventMouseButtonFocus}
                  onClick={handleDeleteWindow}
                  className="flex h-6 w-6 items-center justify-center rounded-md border border-transparent bg-[color-mix(in_srgb,rgb(var(--secondary))_72%,transparent)] text-red-500 transition-colors hover:border-[rgb(var(--ring))] hover:bg-[rgb(var(--accent))]"
                >
                  <Square size={14} fill="currentColor" />
                </button>
              </AppTooltip>
            )}

            {!embedded && !isEphemeralRemoteTab && (
              <AppTooltip
                content={isWindowRunning ? t('terminalView.restart') : t('terminalView.start')}
                placement="toolbar-trailing"
              >
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={isWindowRunning ? t('terminalView.restart') : t('terminalView.start')}
                  onMouseDown={preventMouseButtonFocus}
                  onClick={isWindowRunning ? handleRestartWindow : handleStartWindow}
                  className={`flex h-6 w-6 items-center justify-center rounded-md border border-transparent bg-[color-mix(in_srgb,rgb(var(--secondary))_72%,transparent)] transition-colors hover:border-[rgb(var(--ring))] hover:bg-[rgb(var(--accent))] ${
                    isWindowRunning ? 'text-yellow-500' : 'text-green-500'
                  }`}
                >
                  {isWindowRunning ? <RotateCw size={14} /> : <Play size={14} fill="currentColor" />}
                </button>
              </AppTooltip>
            )}
          </div>
        </div>
      </div>
    );

    if (titleBarActionsSlot) {
      return createPortal(actionsContent, titleBarActionsSlot);
    }

    return actionsContent;
  }, [
    activePaneCapabilities?.canManagePortForwards,
    activePaneCapabilities?.canOpenLocalFolder,
    activePaneCapabilities?.canOpenSFTP,
    browserToolButtonRef,
    canSplitActivePane,
    embedded,
    groupId,
    handleArchiveWindow,
    handleOpenFolder,
    handleOpenInIDE,
    handleOpenSSHPortForwards,
    handleOpenSSHSftp,
    handleSSHSftpOpenChange,
    handleDeleteWindow,
    handleRestartWindow,
    handleSSHMetricsClose,
    handleSplitBrowserPane,
    handleSplitChatPane,
    handleSplitPane,
    handleStartWindow,
    hasChatPaneInWindow,
    isEphemeralRemoteTab,
    isDraggingBrowserTool,
    isWindowRunning,
    onRemoveFromGroup,
    onStopAndRemoveFromGroup,
    preventMouseButtonFocus,
    showFloatingChrome,
    sshMetricsOpen,
    sshSftpOpen,
    t,
    terminalWindow.id,
    terminalWindow.projectConfig,
    titleBarActionsSlot,
    visibleIDEs,
  ]);

  if (canvasEmbedded || canvasLiveDocked) {
    return (
      <div className="flex h-full w-full min-w-0 overflow-hidden bg-transparent text-[rgb(var(--foreground))]">
        <div className="relative min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <div className="min-w-0 flex-1 overflow-hidden">
              <SplitLayout
                windowId={terminalWindow.id}
                layout={terminalWindow.layout}
                activePaneId={terminalWindow.activePaneId}
                isWindowActive={isActive}
                ptyInputEnabled={ptyInputEnabled}
                onPaneActivate={handlePaneActivate}
                onPaneClose={handlePaneClose}
                onPaneExit={ptyInputEnabled ? handlePaneExit : undefined}
                onBrowserPaneDrop={handleBrowserPaneDrop}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full min-w-0 overflow-hidden bg-transparent text-[rgb(var(--foreground))]">
      {/* 渚ц竟鏍?*/}
      {!embedded && (
        <Sidebar
          activeWindowId={sidebarActiveWindowId}
          activeCanvasWorkspaceId={null}
          onWindowSelect={onWindowSwitch}
          onGroupSelect={onGroupSwitch}
          onCanvasSelect={onCanvasSwitch}
          onSettingsClick={() => {
            setHasMountedSettingsPanel(true);
            setIsSettingsPanelOpen(true);
          }}
          onOpenCodePane={handleOpenCodePane}
          showOpenCodePaneAction={!isSshOnlyWindow || hasCodePaneInWindow}
          canOpenCodePane={hasCodePaneInWindow || Boolean(codePaneRootPath)}
          isCodePaneActive={Boolean(activePane && isCodePane(activePane))}
          sshEnabled={sshEnabled}
          sshProfiles={sshProfiles}
          onSSHProfileSaved={onSSHProfileSaved}
        />
      )}

      {/* 主内容区 */}
      <div className="relative min-w-0 flex-1 flex flex-col overflow-hidden">
        {titleBarActions}
        {showRemoteWindowTabs && (
          <div
            data-testid="terminal-remote-tabs-header"
            className="shrink-0 px-2"
            style={appearanceTitlebarSurfaceStyle}
          >
            <TerminalRemoteWindowTabs
              activeWindowId={terminalWindow.id}
              cloneLabel={t('terminalView.cloneSshTerminal')}
              closeLabel={t('common.destroy')}
              onWindowSelect={handleRemoteWindowSelect}
              onWindowClone={(windowId) => {
                void handleCloneRemoteWindow(windowId);
              }}
              onWindowClose={(windowId) => {
                void handleCloseRemoteWindow(windowId);
              }}
            />
          </div>
        )}
        {/* 缁堢甯冨眬鍖哄煙 */}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {sshSftpOpen && activePaneCapabilities?.canOpenSFTP && (
            <Suspense fallback={null}>
              <LazySSHSftpDialog
                open={sshSftpOpen}
                onOpenChange={handleSSHSftpOpenChange}
                windowId={terminalWindow.id}
                paneId={activeTerminalPane?.id ?? null}
                initialPath={activeSshRuntimeCwd}
                currentCwd={activeSshRuntimeCwd}
              />
            </Suspense>
          )}

          <div className="min-w-0 flex-1 overflow-hidden">
            {embedded ? (
              <SplitLayout
                windowId={terminalWindow.id}
                layout={terminalWindow.layout}
                activePaneId={terminalWindow.activePaneId}
                isWindowActive={isActive}
                ptyInputEnabled={ptyInputEnabled}
                onPaneActivate={handlePaneActivate}
                onPaneClose={handlePaneClose}
                onPaneExit={ptyInputEnabled ? handlePaneExit : undefined}
                onBrowserPaneDrop={handleBrowserPaneDrop}
              />
            ) : (
              <DropZone
                targetWindowId={terminalWindow.id}
                onDrop={handleWindowDrop}
                className="h-full w-full"
              >
                <SplitLayout
                  windowId={terminalWindow.id}
                  layout={terminalWindow.layout}
                  activePaneId={terminalWindow.activePaneId}
                  isWindowActive={isActive}
                  ptyInputEnabled={ptyInputEnabled}
                  onPaneActivate={handlePaneActivate}
                  onPaneClose={handlePaneClose}
                  onPaneExit={ptyInputEnabled ? handlePaneExit : undefined}
                  onBrowserPaneDrop={handleBrowserPaneDrop}
                />
              </DropZone>
            )}
          </div>
        </div>

        {activePaneCapabilities?.canOpenSFTP && sshMetricsOpen && (
          <SSHSessionStatusBar
            windowId={terminalWindow.id}
            paneId={activeTerminalPane?.id ?? null}
            paneStatus={activeTerminalPane?.status ?? null}
            currentCwd={activeSshRuntimeCwd}
            onClose={handleSSHMetricsClose}
          />
        )}
      </div>

      {!embedded && (<>
      {/* 蹇€熷垏鎹㈤潰鏉?*/}
      {quickSwitcherOpen && (
        <Suspense fallback={null}>
          <LazyQuickSwitcher
            isOpen={quickSwitcherOpen}
            currentWindowId={terminalWindow.id}
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
      </>)}

      <SSHPortForwardDialog
        open={Boolean(sshPortForwardTarget)}
        onOpenChange={handleSSHPortForwardDialogOpenChange}
        windowId={sshPortForwardTarget?.windowId ?? null}
        paneId={sshPortForwardTarget?.paneId ?? null}
      />
    </div>
  );
};

TerminalView.displayName = 'TerminalView';
