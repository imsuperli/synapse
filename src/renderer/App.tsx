import React, { Suspense, lazy, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { MainLayout } from './components/layout/MainLayout';
import { Sidebar } from './components/layout/Sidebar';
import { EmptyState } from './components/EmptyState';
import { CardGrid } from './components/CardGrid';
import { CanvasWorkspaceView } from './components/CanvasWorkspaceView';
import { CreateGroupDialog } from './components/CreateGroupDialog';
import { CreateWindowDialog } from './components/CreateWindowDialog';
import { TerminalView } from './components/TerminalView';
import { GroupView } from './components/GroupView';
import { AppNotice } from './components/AppNotice';
import { CleanupOverlay } from './components/CleanupOverlay';
import { AppearanceBackdrop } from './components/AppearanceBackdrop';
import { SSHHostKeyPromptDialog } from './components/SSHHostKeyPromptDialog';
import { SSHPasswordPromptDialog } from './components/SSHPasswordPromptDialog';
import { CustomTitleBar } from './components/CustomTitleBar';
import { Sidebar as TerminalSidebar } from './components/Sidebar';
import { useWindowStore } from './stores/windowStore';
import { useViewSwitcher } from './hooks/useViewSwitcher';
import { useWindowSwitcher } from './hooks/useWindowSwitcher';
import { useWorkspaceRestore } from './hooks/useWorkspaceRestore';
import { subscribeToPaneStatusChange, subscribeToWindowGitBranchChange } from './api/events';
import { Pane, Window, WindowStatus } from './types/window';
import { WindowGroup } from '../shared/types/window-group';
import { I18nProvider } from './i18n';
import { SSHCredentialState, SSHProfile } from '../shared/types/ssh';
import type { SettingsPatch } from '../shared/types/electron-api';
import type { AppearanceSettings } from '../shared/types/appearance';
import type {
  ClaudeModelUpdatedPayload,
  ProjectConfigUpdatedPayload,
  SSHHostKeyPromptPayload,
  TmuxPaneStyleChangedPayload,
  TmuxPaneTitleChangedPayload,
  TmuxWindowRemovedPayload,
  TmuxWindowSyncedPayload,
} from '../shared/types/electron-api';
import type { CanvasWindowBlock, CanvasWorkspace } from '../shared/types/canvas';
import './api/ptyDataBus';
import { getAllPanes } from './utils/layoutHelpers';
import { getAllWindowIds } from './utils/groupLayoutHelpers';
import { WORKSPACE_SETTINGS_UPDATED_EVENT } from './utils/settingsEvents';
import {
  authNeedsPassword,
  SSH_PASSWORD_CLEARED_EVENT,
  SSH_PASSWORD_SAVED_EVENT,
  setSSHPasswordPromptHandler,
  type SSHPasswordPromptRequest,
} from './utils/sshPasswordPrompt';
import { APP_NOTICE_EVENT, type AppNoticeEventDetail } from './utils/appNotice';
import { isSSHPasswordPromptCancelled, runSSHActionWithPasswordRetry } from './utils/sshConnectionRetry';
import { isEphemeralSSHCloneWindow, isStandaloneWindow } from './utils/sshWindowBindings';
import { isBrowserPane } from '../shared/utils/terminalCapabilities';
import {
  createMountedTerminalObservationSnapshot,
  logMountedTerminalObservation,
  markTerminalSwitchVisible,
} from './utils/perfObservability';
import { createCanvasWindowBlock } from './utils/canvasWorkspace';
import {
  applyAppearanceToDocument,
  getAppearanceFromSettings,
} from './utils/appearance';
import { notifyTerminalSettingsUpdated } from './utils/terminalSettingsEvents';
import { useShallow } from 'zustand/react/shallow';
import { canStartPaneSession, hasLiveTerminalSession, isInactiveTerminalPaneStatus } from './utils/windowLifecycle';
import { useKeyboardShortcutSettings } from './hooks/useKeyboardShortcutSettings';
import { matchesKeyboardShortcut } from '../shared/utils/keyboardShortcuts';
import { DEFAULT_RECENT_TERMINAL_LIMIT, normalizeRecentTerminalLimit } from '../shared/utils/recentTerminals';
import { destroyWindowResourcesKeepRecord } from './utils/windowDestruction';
import type { WindowSwitchHandler, WindowSwitchOptions } from './types/windowSwitch';

const QUICK_NAV_DOUBLE_TAP_INTERVAL_MS = 400;
const STARTUP_MASK_HOLD_MS = 40;
const STARTUP_MASK_FADE_MS = 140;
const CANVAS_LIVE_BLOCK_ATTR = 'data-canvas-live-terminal-block-id';
type CanvasLiveTerminalRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};
const LazyQuickNavPanel = lazy(async () => ({
  default: (await import('./components/QuickNavPanel')).QuickNavPanel,
}));
const LazySettingsPanel = lazy(async () => ({
  default: (await import('./components/SettingsPanel')).SettingsPanel,
}));
const UNLOADABLE_HIDDEN_WINDOW_STATUSES = new Set<WindowStatus>([
  WindowStatus.Completed,
  WindowStatus.Error,
]);

function findReusableSSHWindow(windows: Window[], profileId: string, groupedWindowIds: Set<string>): Window | null {
  const matchedWindows = windows.filter((window) => {
    if (
      window.archived
      || !isStandaloneWindow(window)
      || isEphemeralSSHCloneWindow(window)
      || groupedWindowIds.has(window.id)
    ) {
      return false;
    }

    return getAllPanes(window.layout).some((pane) => pane.ssh?.profileId === profileId);
  });

  if (matchedWindows.length === 0) {
    return null;
  }

  matchedWindows.sort((left, right) => (
    new Date(right.lastActiveAt).getTime() - new Date(left.lastActiveAt).getTime()
  ));

  return matchedWindows[0] ?? null;
}

function resolveSSHProfileEntryCwd(profile: SSHProfile): string {
  const normalized = profile.defaultRemoteCwd?.trim();
  return normalized || '~';
}

function resolveSSHProfileEntryCommand(profile: SSHProfile): string {
  return profile.remoteCommand || '';
}

function selectMountedWindowLifecycleRecordKeys(state: { windows: Window[] }): string[] {
  return state.windows.map((window) => {
    const panes = getAllPanes(window.layout);
    let terminalPaneCount = 0;
    let status = WindowStatus.Completed;

    for (const pane of panes) {
      if (pane.kind !== 'browser') {
        terminalPaneCount += 1;
      }

      if (pane.status === WindowStatus.Running) {
        status = WindowStatus.Running;
        break;
      }

      if (pane.status === WindowStatus.Restoring) {
        status = WindowStatus.Restoring;
        continue;
      }

      if (status !== WindowStatus.Restoring && pane.status === WindowStatus.WaitingForInput) {
        status = WindowStatus.WaitingForInput;
        continue;
      }

      if (
        status !== WindowStatus.Restoring
        && status !== WindowStatus.WaitingForInput
        && pane.status === WindowStatus.Error
      ) {
        status = WindowStatus.Error;
        continue;
      }

      if (
        status === WindowStatus.Completed
        && !isInactiveTerminalPaneStatus(pane.status)
      ) {
        status = pane.status;
      }
    }

    return `${window.id}:${status}:${terminalPaneCount}`;
  });
}

function getLiveCanvasWindowBlocks(
  canvasWorkspaces: Pick<CanvasWorkspace, 'id' | 'blocks'>[],
  activeCanvasWorkspaceId: string | null,
  currentView: string,
): CanvasWindowBlock[] {
  if (currentView !== 'canvas' || !activeCanvasWorkspaceId) {
    return [];
  }

  const activeCanvasWorkspace = canvasWorkspaces.find((canvasWorkspace) => canvasWorkspace.id === activeCanvasWorkspaceId);
  if (!activeCanvasWorkspace) {
    return [];
  }

  return activeCanvasWorkspace.blocks.filter((block): block is CanvasWindowBlock => (
    block.type === 'window' && block.displayMode === 'live'
  ));
}

function getLiveCanvasWindowIds(liveBlocks: CanvasWindowBlock[]): Set<string> {
  return new Set(liveBlocks.map((block) => block.windowId));
}

function findCanvasLiveBlockNode(blockId: string): HTMLElement | null {
  const nodes = document.querySelectorAll<HTMLElement>(`[${CANVAS_LIVE_BLOCK_ATTR}]`);
  for (const node of nodes) {
    if (node.getAttribute(CANVAS_LIVE_BLOCK_ATTR) === blockId) {
      return node;
    }
  }

  return null;
}

const MountedTerminalSurface = React.memo(({
  activeLiveCanvasWindowIds,
  canvasLiveRect,
  isVisible,
  onCanvasSwitch,
  onGroupSwitch,
  onReturn,
  onSSHProfileSaved,
  onWindowSwitch,
  sshEnabled,
  sshProfiles,
  windowId,
}: {
  activeLiveCanvasWindowIds: Set<string>;
  canvasLiveRect?: CanvasLiveTerminalRect | null;
  isVisible: boolean;
  onCanvasSwitch: (canvasWorkspaceId: string) => void | Promise<void>;
  onGroupSwitch: (groupId: string) => void | Promise<void>;
  onReturn: () => void;
  onSSHProfileSaved: (profile: SSHProfile, credentialState: SSHCredentialState) => void;
  onWindowSwitch: WindowSwitchHandler;
  sshEnabled: boolean;
  sshProfiles: SSHProfile[];
  windowId: string;
}) => {
  const terminalWindow = useWindowStore((state) => (
    state.windows.find((window) => window.id === windowId) ?? null
  ));

  useEffect(() => {
    if (!isVisible) {
      return;
    }

    markTerminalSwitchVisible(windowId);
  }, [isVisible, windowId]);

  if (!terminalWindow) {
    return null;
  }

  const isMac = window.electronAPI?.platform === 'darwin';
  const titleBarHeight = isMac ? 36 : 32;
  const keepsLayoutWhileHidden = getAllPanes(terminalWindow.layout).some((pane) => isBrowserPane(pane));
  const isCanvasLiveVisible = Boolean(canvasLiveRect);
  const ptyInputEnabled = isVisible || isCanvasLiveVisible || !activeLiveCanvasWindowIds.has(windowId);
  const surfaceStyle: React.CSSProperties = isCanvasLiveVisible && canvasLiveRect
    ? {
        display: 'block',
        opacity: 1,
        visibility: 'visible',
        pointerEvents: 'auto',
        position: 'fixed',
        top: canvasLiveRect.top,
        left: canvasLiveRect.left,
        width: canvasLiveRect.width,
        height: canvasLiveRect.height,
        zIndex: 1010,
      }
    : {
        display: isVisible || keepsLayoutWhileHidden ? 'block' : 'none',
        opacity: isVisible ? 1 : 0,
        visibility: isVisible ? 'visible' : 'hidden',
        pointerEvents: isVisible ? 'auto' : 'none',
        position: 'fixed',
        top: titleBarHeight,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 1000,
      };

  return (
    <div
      className="transition-opacity duration-300"
      style={surfaceStyle}
    >
      <TerminalView
        key={terminalWindow.id}
        window={terminalWindow}
        onReturn={onReturn}
        onWindowSwitch={onWindowSwitch}
        onCanvasSwitch={onCanvasSwitch}
        onGroupSwitch={onGroupSwitch}
        isActive={isVisible || isCanvasLiveVisible}
        canvasLiveDocked={isCanvasLiveVisible}
        ptyInputEnabled={ptyInputEnabled}
        sshEnabled={sshEnabled}
        sshProfiles={sshProfiles}
        onSSHProfileSaved={onSSHProfileSaved}
      />
    </div>
  );
});

MountedTerminalSurface.displayName = 'MountedTerminalSurface';

const ActiveGroupSurface = React.memo(({
  activeGroupId,
  onCanvasSwitch,
  onGroupSwitch,
  onReturn,
  onWindowSwitch,
  sshProfiles,
}: {
  activeGroupId: string;
  onCanvasSwitch: (canvasWorkspaceId: string) => void | Promise<void>;
  onGroupSwitch: (groupId: string) => void | Promise<void>;
  onReturn: () => void;
  onWindowSwitch: WindowSwitchHandler;
  sshProfiles: SSHProfile[];
}) => {
  const activeGroup = useWindowStore((state) => (
    state.groups.find((group) => group.id === activeGroupId) ?? null
  ));

  if (!activeGroup) {
    return null;
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: window.electronAPI?.platform === 'darwin' ? 36 : 32,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 1001,
      }}
    >
      <GroupView
        group={activeGroup}
        onReturn={onReturn}
        onWindowSwitch={onWindowSwitch}
        onGroupSwitch={onGroupSwitch}
        onCanvasSwitch={onCanvasSwitch}
        isActive={true}
        sshProfiles={sshProfiles}
      />
    </div>
  );
});

ActiveGroupSurface.displayName = 'ActiveGroupSurface';

const ActiveCanvasSurface = React.memo(({
  activeCanvasWorkspaceId,
  onCanvasSwitch,
  onExitWorkspace,
  onGroupSwitch,
  onStopWorkspace,
  onWindowSwitch,
  onSSHProfileSaved,
  sshEnabled,
  sshProfiles,
}: {
  activeCanvasWorkspaceId: string;
  onCanvasSwitch: (canvasWorkspaceId: string) => void | Promise<void>;
  onExitWorkspace: () => void | Promise<void>;
  onGroupSwitch: (groupId: string) => void | Promise<void>;
  onStopWorkspace: (canvasWorkspaceId: string) => void | Promise<void>;
  onWindowSwitch: WindowSwitchHandler;
  onSSHProfileSaved: (profile: SSHProfile, credentialState: SSHCredentialState) => void;
  sshEnabled: boolean;
  sshProfiles: SSHProfile[];
}) => {
  const canvasWorkspace = useWindowStore((state) => (
    state.canvasWorkspaces.find((workspace) => workspace.id === activeCanvasWorkspaceId) ?? null
  ));
  const [isSettingsPanelOpen, setIsSettingsPanelOpen] = useState(false);
  const [hasMountedSettingsPanel, setHasMountedSettingsPanel] = useState(false);

  const handleSettingsClick = useCallback(() => {
    setHasMountedSettingsPanel(true);
    setIsSettingsPanelOpen(true);
  }, []);

  if (!canvasWorkspace) {
    return null;
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: window.electronAPI?.platform === 'darwin' ? 36 : 32,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 1000,
      }}
    >
      <div className="flex h-full bg-transparent">
        <TerminalSidebar
          activeWindowId={null}
          activeCanvasWorkspaceId={canvasWorkspace.id}
          onWindowSelect={onWindowSwitch}
          onGroupSelect={onGroupSwitch}
          onCanvasSelect={onCanvasSwitch}
          onCanvasStop={onStopWorkspace}
          onSettingsClick={handleSettingsClick}
          sshEnabled={sshEnabled}
          sshProfiles={sshProfiles}
          onSSHProfileSaved={onSSHProfileSaved}
        />

        <div className="relative min-w-0 flex-1 overflow-hidden">
          <CanvasWorkspaceView
            key={canvasWorkspace.id}
            canvasWorkspace={canvasWorkspace}
            sshProfiles={sshProfiles}
            onOpenWindow={onWindowSwitch}
            onOpenCanvasWorkspace={onCanvasSwitch}
            onOpenGroup={onGroupSwitch}
            onStopWorkspace={onStopWorkspace}
            renderLiveWindow={(windowId, options) => {
              return (
                <div
                  key={windowId}
                  data-canvas-live-terminal-block-id={options.blockId}
                  className="h-full w-full bg-[var(--appearance-pane-background)]"
                  aria-hidden={!options.isActive}
                />
              );
            }}
          />
        </div>

        {hasMountedSettingsPanel && (
          <Suspense fallback={null}>
            <LazySettingsPanel
              open={isSettingsPanelOpen}
              onClose={() => setIsSettingsPanelOpen(false)}
            />
          </Suspense>
        )}
      </div>
    </div>
  );
});

ActiveCanvasSurface.displayName = 'ActiveCanvasSurface';

function AppContent() {
  const addWindow = useWindowStore((state) => state.addWindow);
  const syncWindow = useWindowStore((state) => state.syncWindow);
  const removeWindow = useWindowStore((state) => state.removeWindow);
  const updatePane = useWindowStore((state) => state.updatePane);
  const updatePaneRuntime = useWindowStore((state) => state.updatePaneRuntime);
  const updateWindow = useWindowStore((state) => state.updateWindow);
  const updateWindowRuntime = useWindowStore((state) => state.updateWindowRuntime);
  const updateClaudeModel = useWindowStore((state) => state.updateClaudeModel);
  const storeActiveWindowId = useWindowStore((state) => state.activeWindowId);
  const activeCanvasWorkspaceId = useWindowStore((state) => state.activeCanvasWorkspaceId);
  const setCanvasWorkspaceStarted = useWindowStore((state) => state.setCanvasWorkspaceStarted);
  const activeGroupId = useWindowStore((state) => state.activeGroupId);
  const groups = useWindowStore((state) => state.groups);
  const canvasWorkspaces = useWindowStore((state) => state.canvasWorkspaces);
  const setActiveGroup = useWindowStore((state) => state.setActiveGroup);
  const mountedWindowLifecycleRecordKeys = useWindowStore(useShallow(selectMountedWindowLifecycleRecordKeys));
  const mountedWindowRecordKeys = useMemo(
    () => mountedWindowLifecycleRecordKeys.map((recordKey) => {
      const lastSeparatorIndex = recordKey.lastIndexOf(':');
      return recordKey.slice(0, lastSeparatorIndex);
    }),
    [mountedWindowLifecycleRecordKeys],
  );
  const mountedWindowTerminalPaneCountKeys = useMemo(
    () => mountedWindowLifecycleRecordKeys.map((recordKey) => {
      const firstSeparatorIndex = recordKey.indexOf(':');
      const lastSeparatorIndex = recordKey.lastIndexOf(':');
      return `${recordKey.slice(0, firstSeparatorIndex)}${recordKey.slice(lastSeparatorIndex)}`;
    }),
    [mountedWindowLifecycleRecordKeys],
  );
  const activeWindowTitle = useWindowStore((state) => (
    storeActiveWindowId
      ? state.windows.find((window) => window.id === storeActiveWindowId)?.name ?? ''
      : ''
  ));
  const activeWindowGitBranch = useWindowStore((state) => (
    storeActiveWindowId
      ? state.windows.find((window) => window.id === storeActiveWindowId)?.gitBranch ?? undefined
      : undefined
  ));
  const activeGroupName = useWindowStore((state) => (
    activeGroupId
      ? state.groups.find((group) => group.id === activeGroupId)?.name ?? ''
      : ''
  ));
  const hasPersistedEntries = useWindowStore((state) => (
    state.windows.some((window) => !window.archived)
      || state.groups.some((group) => !group.archived)
      || state.canvasWorkspaces.some((canvasWorkspace) => !canvasWorkspace.archived)
  ));
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [showCreateGroupDialog, setShowCreateGroupDialog] = useState(false);
  const [isSSHDialogOpen, setIsSSHDialogOpen] = useState(false);
  const [editingSSHProfile, setEditingSSHProfile] = useState<SSHProfile | null>(null);
  const [duplicatingSSHProfile, setDuplicatingSSHProfile] = useState<SSHProfile | null>(null);
  const [sshProfiles, setSSHProfiles] = useState<SSHProfile[]>([]);
  const [sshCredentialStates, setSSHCredentialStates] = useState<Record<string, SSHCredentialState>>({});
  const [connectingSSHProfileId, setConnectingSSHProfileId] = useState<string | null>(null);
  const [sshEnabled, setSSHEnabled] = useState(true);
  const [currentTab, setCurrentTab] = useState<'all' | 'active' | 'archived' | string>('active');
  const [recentTerminalLimit, setRecentTerminalLimit] = useState(DEFAULT_RECENT_TERMINAL_LIMIT);
  const [searchQuery, setSearchQuery] = useState(''); // 搜索状态
  const [isQuickNavOpen, setIsQuickNavOpen] = useState(false); // 快捷导航面板状态
  const [sshHostKeyPromptQueue, setSSHHostKeyPromptQueue] = useState<SSHHostKeyPromptPayload[]>([]);
  const [sshPasswordPromptRequest, setSSHPasswordPromptRequest] = useState<SSHPasswordPromptRequest | null>(null);
  const [appNotice, setAppNotice] = useState<{ message: string; tone: 'error' | 'success' } | null>(null);
  const [appVersion, setAppVersion] = useState<{ name: string; version: string }>({
    name: 'Synapse',
    version: '1.0.0',
  });
  const [appearance, setAppearance] = useState<AppearanceSettings>(() => getAppearanceFromSettings());
  const keyboardShortcuts = useKeyboardShortcutSettings();
  const [isStartupMaskVisible, setIsStartupMaskVisible] = useState(true);
  const [isStartupMaskHiding, setIsStartupMaskHiding] = useState(false);
  const [canvasTerminalReturnTargetId, setCanvasTerminalReturnTargetId] = useState<string | null>(null);
  const [canvasCreateContextWorkspaceId, setCanvasCreateContextWorkspaceId] = useState<string | null>(null);
  const [canvasLiveTerminalRects, setCanvasLiveTerminalRects] = useState<Record<string, CanvasLiveTerminalRect>>({});
  const sshPasswordPromptResolverRef = useRef<((password: string | null) => void) | null>(null);
  const appErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startupMaskDismissedRef = useRef(false);
  const startupMaskHoldTimerRef = useRef<number | null>(null);
  const startupMaskRemoveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    applyAppearanceToDocument(appearance);
  }, [appearance]);

  // 获取应用版本信息
  useEffect(() => {
    const fetchVersion = async () => {
      try {
        const result = await window.electronAPI.getAppVersion();
        if (result.success && result.data) {
          setAppVersion(result.data);
        }
      } catch (error) {
        console.error('Failed to get app version:', error);
      }
    };
    fetchVersion();
  }, []);

  const loadWorkspaceSettings = useCallback(async () => {
    try {
      const response = await window.electronAPI.getSettings();
      if (response.success && response.data) {
        if (response.data.defaultSidebarTab) {
          setCurrentTab(response.data.defaultSidebarTab);
        }
        setSSHEnabled(response.data.features?.sshEnabled ?? true);
        setRecentTerminalLimit(normalizeRecentTerminalLimit(response.data.recentTerminalLimit));
        setAppearance(getAppearanceFromSettings(response.data));
        return;
      }

      console.error('Failed to load workspace settings:', response.error);
    } catch (error) {
      console.error('Failed to load workspace settings:', error);
    }
  }, []);

  // 从 settings 恢复上次选择的侧边栏标签
  useEffect(() => {
    void loadWorkspaceSettings();
  }, [loadWorkspaceSettings]);

  useEffect(() => {
    const handleSettingsUpdated = (event: Event) => {
      const patch = (event as CustomEvent<SettingsPatch | undefined>).detail;
      let shouldReloadSettings = false;

      if (typeof patch?.features?.sshEnabled === 'boolean') {
        setSSHEnabled(patch.features.sshEnabled);
      } else if (patch?.features) {
        shouldReloadSettings = true;
      }

      const appearancePatch = patch?.appearance;
      if (appearancePatch) {
        setAppearance((currentAppearance) => getAppearanceFromSettings({
          appearance: {
            ...currentAppearance,
            ...appearancePatch,
            skin: appearancePatch.skin
              ? {
                  ...currentAppearance.skin,
                  ...appearancePatch.skin,
                }
              : currentAppearance.skin,
          },
        }));
        notifyTerminalSettingsUpdated({ themeChanged: true });
      }

      if (!patch || shouldReloadSettings || (!appearancePatch && !patch.features)) {
        void loadWorkspaceSettings();
      }
    };

    window.addEventListener(WORKSPACE_SETTINGS_UPDATED_EVENT, handleSettingsUpdated);
    return () => {
      window.removeEventListener(WORKSPACE_SETTINGS_UPDATED_EVENT, handleSettingsUpdated);
    };
  }, [loadWorkspaceSettings]);

  const getSSHCredentialState = useCallback(async (profileId: string): Promise<SSHCredentialState> => {
    try {
      const response = await window.electronAPI.getSSHCredentialState(profileId);
      if (response?.success && response.data) {
        return response.data;
      }
    } catch (error) {
      console.error(`Failed to load SSH credential state for ${profileId}:`, error);
    }

    return {
      hasPassword: false,
      hasPassphrase: false,
    };
  }, []);

  const loadSSHProfiles = useCallback(async () => {
    try {
      const response = await window.electronAPI.listSSHProfiles();
      if (!response?.success || !response.data) {
        return;
      }

      setSSHProfiles(response.data);

      const entries = await Promise.all(
        response.data.map(async (profile) => ([profile.id, await getSSHCredentialState(profile.id)] as const)),
      );
      setSSHCredentialStates(Object.fromEntries(entries));
    } catch (error) {
      console.error('Failed to load SSH profiles:', error);
    }
  }, [getSSHCredentialState]);

  useEffect(() => {
    void loadSSHProfiles();
  }, [loadSSHProfiles]);

  useEffect(() => {
    const handleSSHPasswordSaved = (event: Event) => {
      const profileId = (event as CustomEvent<{ profileId?: string } | undefined>).detail?.profileId;
      if (!profileId) {
        return;
      }

      setSSHCredentialStates((previousStates) => ({
        ...previousStates,
        [profileId]: {
          ...(previousStates[profileId] ?? { hasPassword: false, hasPassphrase: false }),
          hasPassword: true,
        },
      }));
    };

    window.addEventListener(SSH_PASSWORD_SAVED_EVENT, handleSSHPasswordSaved);
    return () => {
      window.removeEventListener(SSH_PASSWORD_SAVED_EVENT, handleSSHPasswordSaved);
    };
  }, []);

  useEffect(() => {
    const handleSSHPasswordCleared = (event: Event) => {
      const profileId = (event as CustomEvent<{ profileId?: string } | undefined>).detail?.profileId;
      if (!profileId) {
        return;
      }

      setSSHCredentialStates((previousStates) => ({
        ...previousStates,
        [profileId]: {
          ...(previousStates[profileId] ?? { hasPassword: false, hasPassphrase: false }),
          hasPassword: false,
        },
      }));
    };

    window.addEventListener(SSH_PASSWORD_CLEARED_EVENT, handleSSHPasswordCleared);
    return () => {
      window.removeEventListener(SSH_PASSWORD_CLEARED_EVENT, handleSSHPasswordCleared);
    };
  }, []);

  const showAppNotice = useCallback((message: string, tone: 'error' | 'success' = 'error') => {
    const trimmedMessage = message.trim();
    if (!trimmedMessage) {
      return;
    }

    setAppNotice({ message: trimmedMessage, tone });

    if (appErrorTimerRef.current) {
      clearTimeout(appErrorTimerRef.current);
    }

    appErrorTimerRef.current = setTimeout(() => {
      setAppNotice(null);
      appErrorTimerRef.current = null;
    }, 6000);
  }, []);

  useEffect(() => {
    return () => {
      if (appErrorTimerRef.current) {
        clearTimeout(appErrorTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const handleAppNotice = (event: Event) => {
      const detail = (event as CustomEvent<AppNoticeEventDetail | undefined>).detail;
      const message = detail?.message;
      const level = detail?.level ?? 'error';
      if (message) {
        showAppNotice(message, level);
      }
    };

    window.addEventListener(APP_NOTICE_EVENT, handleAppNotice);
    return () => {
      window.removeEventListener(APP_NOTICE_EVENT, handleAppNotice);
    };
  }, [showAppNotice]);

  // 工作区恢复
  useWorkspaceRestore();

  const beginStartupMaskDismiss = useCallback(() => {
    if (startupMaskDismissedRef.current) {
      return;
    }

    startupMaskDismissedRef.current = true;

    if (startupMaskHoldTimerRef.current) {
      window.clearTimeout(startupMaskHoldTimerRef.current);
    }

    if (startupMaskRemoveTimerRef.current) {
      window.clearTimeout(startupMaskRemoveTimerRef.current);
    }

    startupMaskHoldTimerRef.current = window.setTimeout(() => {
      setIsStartupMaskHiding(true);
      startupMaskRemoveTimerRef.current = window.setTimeout(() => {
        setIsStartupMaskVisible(false);
      }, STARTUP_MASK_FADE_MS);
    }, STARTUP_MASK_HOLD_MS);
  }, []);

  useEffect(() => {
    const unsubscribe = window.electronAPI?.onStartupReveal?.(() => {
      beginStartupMaskDismiss();
    });

    const fallbackTimer = window.setTimeout(() => {
      beginStartupMaskDismiss();
    }, 320);

    return () => {
      unsubscribe?.();
      window.clearTimeout(fallbackTimer);

      if (startupMaskHoldTimerRef.current) {
        window.clearTimeout(startupMaskHoldTimerRef.current);
      }

      if (startupMaskRemoveTimerRef.current) {
        window.clearTimeout(startupMaskRemoveTimerRef.current);
      }
    };
  }, [beginStartupMaskDismiss]);

  // 等待首屏至少完成一次绘制，再通知主进程显示窗口，避免使用固定延迟。
  useEffect(() => {
    if (typeof window.requestAnimationFrame !== 'function') {
      const timer = window.setTimeout(() => {
        window.electronAPI.notifyRendererReady();
      }, 0);

      return () => window.clearTimeout(timer);
    }

    let firstFrame: number | null = null;
    let secondFrame: number | null = null;

    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        window.electronAPI.notifyRendererReady();
      });
    });

    return () => {
      if (firstFrame !== null) {
        window.cancelAnimationFrame(firstFrame);
      }
      if (secondFrame !== null) {
        window.cancelAnimationFrame(secondFrame);
      }
    };
  }, []);

  // 全局快捷键：双击配置键唤出快捷导航（必须是两次完整的按下+松开）
  const lastQuickNavKeyUpTime = useRef<number>(0);
  const quickNavKeyPressedDown = useRef<boolean>(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (matchesKeyboardShortcut(e, keyboardShortcuts.quickNav)) {
        // 忽略长按产生的重复事件
        if (e.repeat) return;
        quickNavKeyPressedDown.current = true;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (matchesKeyboardShortcut(e, keyboardShortcuts.quickNav) && quickNavKeyPressedDown.current) {
        quickNavKeyPressedDown.current = false;
        const now = Date.now();
        const timeSinceLastUp = now - lastQuickNavKeyUpTime.current;

        // 两次完整按键（松开间隔必须小于阈值）才触发
        if (timeSinceLastUp < QUICK_NAV_DOUBLE_TAP_INTERVAL_MS && timeSinceLastUp > 0) {
          setIsQuickNavOpen(prev => !prev);
          lastQuickNavKeyUpTime.current = 0; // 重置，避免连续触发
        } else {
          lastQuickNavKeyUpTime.current = now;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyUp, true);
    };
  }, [keyboardShortcuts.quickNav]);

  const {
    currentView,
    switchToTerminalView,
    switchToCanvasView,
    switchToUnifiedView,
    activeCanvasWorkspaceId: currentActiveCanvasWorkspaceId,
    error
  } = useViewSwitcher();

  // 使用统一的窗口切换逻辑
  const { switchToWindow } = useWindowSwitcher(switchToTerminalView);

  // 使用 store 的 activeWindowId，确保状态一致
  const activeWindowId = storeActiveWindowId;
  const [mountedTerminalWindowIds, setMountedTerminalWindowIds] = useState<string[]>([]);
  const groupedWindowIdSet = useMemo(() => {
    const nextIds = new Set<string>();

    for (const group of groups) {
      for (const windowId of getAllWindowIds(group.layout)) {
        nextIds.add(windowId);
      }
    }

    return nextIds;
  }, [groups]);

  useEffect(() => {
    if (!activeWindowId) {
      return;
    }

    setMountedTerminalWindowIds((previousIds) => (
      previousIds.includes(activeWindowId)
        ? previousIds
        : [...previousIds, activeWindowId]
    ));
  }, [activeWindowId]);

  useEffect(() => {
    const statusByWindowId = new Map(
      mountedWindowLifecycleRecordKeys.map((recordKey) => {
        const firstSeparatorIndex = recordKey.indexOf(':');
        const lastSeparatorIndex = recordKey.lastIndexOf(':');
        return [
          recordKey.slice(0, firstSeparatorIndex),
          recordKey.slice(firstSeparatorIndex + 1, lastSeparatorIndex) as WindowStatus,
        ] as const;
      }),
    );
    setMountedTerminalWindowIds((previousIds) => {
      const nextIds = previousIds.filter((id) => {
        const windowStatus = statusByWindowId.get(id);
        if (!windowStatus) {
          return false;
        }

        if (id === activeWindowId) {
          return true;
        }

        return !UNLOADABLE_HIDDEN_WINDOW_STATUSES.has(windowStatus);
      });

      return nextIds.length === previousIds.length ? previousIds : nextIds;
    });
  }, [activeWindowId, mountedWindowLifecycleRecordKeys]);

  // 订阅主进程推送的窗格状态变化事件
  useEffect(() => {
    const unsubscribe = subscribeToPaneStatusChange((windowId, paneId, status) => {
      updatePaneRuntime(windowId, paneId, (
        isInactiveTerminalPaneStatus(status)
          ? {
              status,
              pid: null,
              sessionId: undefined,
              lastOutput: undefined,
              tmuxScopeId: undefined,
            }
          : { status }
      ));
    });
    return () => {
      unsubscribe();
    };
  }, [updatePaneRuntime]);

  useEffect(() => {
    if (!window.electronAPI?.onSSHHostKeyPrompt) {
      return;
    }

    const handleSSHHostKeyPrompt = (_event: unknown, payload: SSHHostKeyPromptPayload) => {
      setSSHHostKeyPromptQueue((currentQueue) => (
        currentQueue.some((entry) => entry.requestId === payload.requestId)
          ? currentQueue
          : [...currentQueue, payload]
      ));
    };

    window.electronAPI.onSSHHostKeyPrompt(handleSSHHostKeyPrompt);

    return () => {
      window.electronAPI?.offSSHHostKeyPrompt?.(handleSSHHostKeyPrompt);
    };
  }, []);

  // 订阅主进程推送的 git 分支变化事件
  useEffect(() => {
    const unsubscribe = subscribeToWindowGitBranchChange((windowId, gitBranch) => {
      updateWindowRuntime(windowId, { gitBranch });
    });
    return () => {
      unsubscribe();
    };
  }, [updateWindowRuntime]);

  // 订阅 tmux pane 元数据变化事件
  useEffect(() => {
    if (
      !window.electronAPI?.onTmuxPaneTitleChanged ||
      !window.electronAPI?.onTmuxPaneStyleChanged ||
      !window.electronAPI?.onTmuxWindowSynced ||
      !window.electronAPI?.onTmuxWindowRemoved
    ) {
      return;
    }

    const handleTitleChanged = (_event: unknown, payload: TmuxPaneTitleChangedPayload) => {
      updatePane(payload.windowId, payload.paneId, { title: payload.title });
    };

    const handleStyleChanged = (_event: unknown, payload: TmuxPaneStyleChangedPayload) => {
      const updates: Partial<Pane> = {};
      if (payload.metadata.borderColor !== undefined) {
        updates.borderColor = payload.metadata.borderColor;
      }
      if (payload.metadata.activeBorderColor !== undefined) {
        updates.activeBorderColor = payload.metadata.activeBorderColor;
      }
      if (payload.metadata.agentName !== undefined) {
        updates.agentName = payload.metadata.agentName;
      }
      if (payload.metadata.agentColor !== undefined) {
        updates.agentColor = payload.metadata.agentColor;
      }
      if (payload.metadata.teamName !== undefined) {
        updates.teamName = payload.metadata.teamName;
      }
      if (Object.keys(updates).length > 0) {
        updatePane(payload.windowId, payload.paneId, updates);
      }
    };

    const handleWindowSynced = (_event: unknown, payload: TmuxWindowSyncedPayload) => {
      syncWindow(payload.window);
    };

    const handleWindowRemoved = (_event: unknown, payload: TmuxWindowRemovedPayload) => {
      removeWindow(payload.windowId);
    };

    window.electronAPI.onTmuxPaneTitleChanged(handleTitleChanged);
    window.electronAPI.onTmuxPaneStyleChanged(handleStyleChanged);
    window.electronAPI.onTmuxWindowSynced(handleWindowSynced);
    window.electronAPI.onTmuxWindowRemoved(handleWindowRemoved);

    return () => {
      window.electronAPI?.offTmuxPaneTitleChanged?.(handleTitleChanged);
      window.electronAPI?.offTmuxPaneStyleChanged?.(handleStyleChanged);
      window.electronAPI?.offTmuxWindowSynced?.(handleWindowSynced);
      window.electronAPI?.offTmuxWindowRemoved?.(handleWindowRemoved);
    };
  }, [removeWindow, syncWindow, updatePane]);

  // 订阅主进程推送的项目配置更新事件
  useEffect(() => {
    if (!window.electronAPI?.onProjectConfigUpdated) return;

    const handleProjectConfigUpdate = (_event: unknown, payload: ProjectConfigUpdatedPayload) => {
      updateWindowRuntime(payload.windowId, { projectConfig: payload.projectConfig ?? undefined });
    };

    window.electronAPI.onProjectConfigUpdated(handleProjectConfigUpdate);

    return () => {
      window.electronAPI?.offProjectConfigUpdated?.(handleProjectConfigUpdate);
    };
  }, [updateWindowRuntime]);

  // 订阅主进程推送的 Claude 模型更新事件
  useEffect(() => {
    if (!window.electronAPI?.onClaudeModelUpdated) return;

    const handleClaudeModelUpdate = (_event: unknown, payload: ClaudeModelUpdatedPayload) => {
      updateClaudeModel(payload.windowId, payload.model, payload.modelId, payload.contextPercentage, payload.cost);
    };

    window.electronAPI.onClaudeModelUpdated(handleClaudeModelUpdate);

    return () => {
      window.electronAPI?.offClaudeModelUpdated?.(handleClaudeModelUpdate);
    };
  }, [updateClaudeModel]);

  const handleEditSSHProfile = useCallback((profile: SSHProfile) => {
    setDuplicatingSSHProfile(null);
    setEditingSSHProfile(profile);
    setIsSSHDialogOpen(true);
  }, []);

  const handleDuplicateSSHProfile = useCallback((profile: SSHProfile) => {
    setEditingSSHProfile(null);
    setDuplicatingSSHProfile(profile);
    setIsSSHDialogOpen(true);
  }, []);

  const handleSSHProfileDialogChange = useCallback((open: boolean) => {
    setIsSSHDialogOpen(open);
    if (!open) {
      setEditingSSHProfile(null);
      setDuplicatingSSHProfile(null);
    }
  }, []);

  const handleSSHProfileSaved = useCallback((profile: SSHProfile, credentialState: SSHCredentialState) => {
    const previousProfile = sshProfiles.find((item) => item.id === profile.id) ?? null;

    if (previousProfile) {
      const previousDefaultRemoteCwd = previousProfile.defaultRemoteCwd?.trim() || '~';
      const nextDefaultRemoteCwd = profile.defaultRemoteCwd?.trim() || '~';
      const windows = useWindowStore.getState().windows;

      for (const sshWindow of windows) {
        const panes = getAllPanes(sshWindow.layout).filter((pane) => pane.ssh?.profileId === profile.id);
        if (panes.length === 0) {
          continue;
        }

        if (sshWindow.name === previousProfile.name && sshWindow.name !== profile.name) {
          updateWindow(sshWindow.id, { name: profile.name });
        }

        for (const pane of panes) {
          if (!canStartPaneSession(pane)) {
            continue;
          }

          const currentRemoteCwd = pane.cwd?.trim() || '~';
          if (currentRemoteCwd === previousDefaultRemoteCwd && currentRemoteCwd !== nextDefaultRemoteCwd) {
            updatePane(sshWindow.id, pane.id, { cwd: nextDefaultRemoteCwd });
          }
        }
      }
    }

    setSSHProfiles((previousProfiles) => {
      const nextProfiles = previousProfiles.some((item) => item.id === profile.id)
        ? previousProfiles.map((item) => (item.id === profile.id ? profile : item))
        : [...previousProfiles, profile];

      return nextProfiles;
    });
    setSSHCredentialStates((previousStates) => ({
      ...previousStates,
      [profile.id]: credentialState,
    }));
  }, [sshProfiles, updatePane, updateWindow]);

  const handleDeleteSSHProfile = useCallback(async (profile: SSHProfile) => {
    if (!window.electronAPI) {
      return;
    }

    const response = await window.electronAPI.deleteSSHProfile(profile.id);
    if (!response?.success) {
      const deleteError = new Error(response?.error || `Failed to delete SSH profile ${profile.id}`);
      console.error('Failed to delete SSH profile:', deleteError);
      throw deleteError;
    }

    const categoriesWithProfile = useWindowStore
      .getState()
      .customCategories
      .filter((category) => (category.sshProfileIds ?? []).includes(profile.id));
    for (const category of categoriesWithProfile) {
      await useWindowStore.getState().removeSSHProfileFromCategory(category.id, profile.id);
    }

    setSSHProfiles((previousProfiles) => previousProfiles.filter((item) => item.id !== profile.id));
    setSSHCredentialStates((previousStates) => {
      const nextStates = { ...previousStates };
      delete nextStates[profile.id];
      return nextStates;
    });
  }, []);

  const handleConnectSSHProfile = useCallback(async (profile: SSHProfile) => {
    if (connectingSSHProfileId) {
      return;
    }

    const windows = useWindowStore.getState().windows;
    const reusableWindow = profile.reuseSession
      ? findReusableSSHWindow(windows, profile.id, groupedWindowIdSet)
      : null;
    if (reusableWindow) {
      const reusablePanes = getAllPanes(reusableWindow.layout).filter((pane) => pane.ssh?.profileId === profile.id);
      const shouldSyncReusableWindow = reusablePanes.length > 0
        && reusablePanes.every((pane) => !hasLiveTerminalSession(pane));

      if (shouldSyncReusableWindow) {
        const nextRemoteCwd = resolveSSHProfileEntryCwd(profile);
        const nextCommand = resolveSSHProfileEntryCommand(profile);

        if (reusableWindow.name !== profile.name) {
          updateWindow(reusableWindow.id, { name: profile.name });
        }

        for (const pane of reusablePanes) {
          const updates: Partial<Pane> = {};

          if (pane.cwd !== nextRemoteCwd) {
            updates.cwd = nextRemoteCwd;
          }

          if ((pane.command || '') !== nextCommand) {
            updates.command = nextCommand;
          }

          if (Object.keys(updates).length > 0) {
            updatePane(reusableWindow.id, pane.id, updates);
          }
        }
      }

      switchToWindow(reusableWindow.id);
      return;
    }

    try {
      setConnectingSSHProfileId(profile.id);
      const response = await runSSHActionWithPasswordRetry({
        request: {
          profileId: profile.id,
          profileName: profile.name,
          host: profile.host,
          user: profile.user,
          authType: profile.auth,
        },
        action: () => window.electronAPI.createSSHWindow({
          profileId: profile.id,
          name: profile.name,
        }),
      });

      if (!response?.success || !response.data) {
        throw new Error(response?.error || `Failed to connect SSH profile ${profile.id}`);
      }

      if (authNeedsPassword(profile.auth)) {
        setSSHCredentialStates((previousStates) => ({
          ...previousStates,
          [profile.id]: {
            ...(previousStates[profile.id] ?? { hasPassword: false, hasPassphrase: false }),
            hasPassword: true,
          },
        }));
      }

      addWindow(response.data);
      switchToWindow(response.data.id);
    } catch (error) {
      console.error('Failed to create SSH window:', error);
      if (!isSSHPasswordPromptCancelled(error)) {
        showAppNotice(error instanceof Error ? error.message : `Failed to connect SSH profile ${profile.id}`, 'error');
      }
    } finally {
      setConnectingSSHProfileId(null);
    }
  }, [addWindow, connectingSSHProfileId, groupedWindowIdSet, showAppNotice, switchToWindow, updatePane, updateWindow]);

  const handleConnectSSHProfileIntoCanvas = useCallback(async (profile: SSHProfile) => {
    if (!canvasCreateContextWorkspaceId || connectingSSHProfileId) {
      return;
    }

    const workspace = useWindowStore.getState().getCanvasWorkspaceById(canvasCreateContextWorkspaceId);
    if (!workspace) {
      return;
    }

    const windows = useWindowStore.getState().windows;
    const reusableWindow = profile.reuseSession
      ? findReusableSSHWindow(windows, profile.id, groupedWindowIdSet)
      : null;

    if (reusableWindow) {
      const alreadyLinked = workspace.blocks.some((block) => (
        block.type === 'window' && block.windowId === reusableWindow.id
      ));

      if (!alreadyLinked) {
        const offsetIndex = workspace.blocks.filter((block) => block.type === 'window').length;
        useWindowStore.getState().updateCanvasWorkspace(canvasCreateContextWorkspaceId, {
          blocks: [
            ...workspace.blocks,
            createCanvasWindowBlock(reusableWindow, offsetIndex, workspace.nextZIndex, workspace.blocks),
          ],
          nextZIndex: workspace.nextZIndex + 1,
        });
      }
      return;
    }

    try {
      setConnectingSSHProfileId(profile.id);
      const response = await runSSHActionWithPasswordRetry({
        request: {
          profileId: profile.id,
          profileName: profile.name,
          host: profile.host,
          user: profile.user,
          authType: profile.auth,
        },
        action: () => window.electronAPI.createSSHWindow({
          profileId: profile.id,
          name: profile.name,
        }),
      });

      if (!response?.success || !response.data) {
        throw new Error(response?.error || `Failed to connect SSH profile ${profile.id}`);
      }

      if (authNeedsPassword(profile.auth)) {
        setSSHCredentialStates((previousStates) => ({
          ...previousStates,
          [profile.id]: {
            ...(previousStates[profile.id] ?? { hasPassword: false, hasPassphrase: false }),
            hasPassword: true,
          },
        }));
      }

      const canvasOwnedWindow: Window = {
        ...response.data,
        ownerType: 'canvas-owned',
        ownerCanvasWorkspaceId: canvasCreateContextWorkspaceId,
      };

      addWindow(canvasOwnedWindow);
      const latestWorkspace = useWindowStore.getState().getCanvasWorkspaceById(canvasCreateContextWorkspaceId);
      if (latestWorkspace) {
        const offsetIndex = latestWorkspace.blocks.filter((block) => block.type === 'window').length;
        useWindowStore.getState().updateCanvasWorkspace(canvasCreateContextWorkspaceId, {
          blocks: [
            ...latestWorkspace.blocks,
            createCanvasWindowBlock(canvasOwnedWindow, offsetIndex, latestWorkspace.nextZIndex, latestWorkspace.blocks),
          ],
          nextZIndex: latestWorkspace.nextZIndex + 1,
        });
      }
    } catch (error) {
      console.error('Failed to create SSH window for canvas:', error);
      if (!isSSHPasswordPromptCancelled(error)) {
        showAppNotice(error instanceof Error ? error.message : `Failed to connect SSH profile ${profile.id}`, 'error');
      }
      throw error;
    } finally {
      setConnectingSSHProfileId(null);
    }
  }, [addWindow, canvasCreateContextWorkspaceId, connectingSSHProfileId, groupedWindowIdSet, showAppNotice]);

  const handleCreateGroup = useCallback(() => {
    setShowCreateGroupDialog(true);
  }, []);

  const handleDialogChange = useCallback((open: boolean) => {
    setIsDialogOpen(open);
    if (!open) {
      setCanvasCreateContextWorkspaceId(null);
    }
  }, []);

  const handleEnterTerminal = useCallback((win: Window) => {
    setCanvasTerminalReturnTargetId(null);
    switchToWindow(win.id);
  }, [switchToWindow]);

  const handleEnterCanvasWorkspace = useCallback(async (canvasWorkspaceId: string) => {
    setCanvasTerminalReturnTargetId(null);
    setCanvasWorkspaceStarted(canvasWorkspaceId, true);
    await switchToCanvasView(canvasWorkspaceId);
  }, [setCanvasWorkspaceStarted, switchToCanvasView]);

  const resetCanvasLiveBlocks = useCallback((canvasWorkspaceId: string) => {
    const workspace = useWindowStore.getState().getCanvasWorkspaceById(canvasWorkspaceId);
    if (!workspace) {
      return;
    }

    const nextBlocks = workspace.blocks.map((block) => (
      block.type === 'window' && block.displayMode === 'live'
        ? { ...block, displayMode: 'summary' as const }
        : block
    ));
    const didChange = nextBlocks.some((block, index) => block !== workspace.blocks[index]);
    if (!didChange) {
      return;
    }

    useWindowStore.getState().updateCanvasWorkspace(canvasWorkspaceId, {
      blocks: nextBlocks,
    });
  }, []);

  const handleStopCanvasWorkspace = useCallback(async (canvasWorkspaceId: string) => {
    resetCanvasLiveBlocks(canvasWorkspaceId);

    const ownedWindows = useWindowStore.getState().windows.filter((windowItem) => (
      windowItem.ownerType === 'canvas-owned'
      && windowItem.ownerCanvasWorkspaceId === canvasWorkspaceId
    ));

    for (const windowItem of ownedWindows) {
      await destroyWindowResourcesKeepRecord(windowItem.id);
    }

    setCanvasWorkspaceStarted(canvasWorkspaceId, false);

    if (currentView === 'canvas' && currentActiveCanvasWorkspaceId === canvasWorkspaceId) {
      setCanvasTerminalReturnTargetId(null);
      await switchToUnifiedView();
    }
  }, [currentActiveCanvasWorkspaceId, currentView, resetCanvasLiveBlocks, setCanvasWorkspaceStarted, switchToUnifiedView]);

  const handleWindowSwitch = useCallback((windowId: string, options?: WindowSwitchOptions) => {
    setCanvasTerminalReturnTargetId(null);
    switchToWindow(windowId, options);
  }, [switchToWindow]);

  const handleWindowSwitchInCurrentContext = useCallback((windowId: string, options?: WindowSwitchOptions) => {
    if (canvasTerminalReturnTargetId) {
      switchToWindow(windowId, options);
      return;
    }

    setCanvasTerminalReturnTargetId(null);
    switchToWindow(windowId, options);
  }, [canvasTerminalReturnTargetId, switchToWindow]);

  const handleWindowSwitchFromCanvasContext = useCallback((windowId: string, options?: WindowSwitchOptions) => {
    setCanvasTerminalReturnTargetId(activeCanvasWorkspaceId ?? currentActiveCanvasWorkspaceId ?? null);
    switchToWindow(windowId, options);
  }, [activeCanvasWorkspaceId, currentActiveCanvasWorkspaceId, switchToWindow]);

  const handleOpenWindowFromCanvas = useCallback((windowId: string, options?: WindowSwitchOptions) => {
    setCanvasTerminalReturnTargetId(activeCanvasWorkspaceId ?? currentActiveCanvasWorkspaceId ?? null);
    switchToWindow(windowId, options);
  }, [activeCanvasWorkspaceId, currentActiveCanvasWorkspaceId, switchToWindow]);

  const handleCanvasSwitchFromTerminalContext = useCallback(async (canvasWorkspaceId: string) => {
    setCanvasTerminalReturnTargetId(null);
    await switchToCanvasView(canvasWorkspaceId);
  }, [switchToCanvasView]);

  const handleGroupSwitchFromCanvasContext = useCallback(async (groupId: string) => {
    setCanvasTerminalReturnTargetId(activeCanvasWorkspaceId ?? currentActiveCanvasWorkspaceId ?? null);
    setActiveGroup(groupId);

    const targetGroup = useWindowStore.getState().groups.find((group) => group.id === groupId);
    if (!targetGroup) {
      console.error('Target group not found:', groupId);
      return;
    }

    try {
      await window.electronAPI.switchToTerminalView(targetGroup.activeWindowId);
    } catch (error) {
      console.error('Failed to notify main process of view change:', error);
    }
  }, [activeCanvasWorkspaceId, currentActiveCanvasWorkspaceId, setActiveGroup]);

  const handleCreateWindow = useCallback(() => {
    setCanvasCreateContextWorkspaceId(null);
    setIsDialogOpen(true);
  }, []);

  const handleCreateTerminalFromCanvas = useCallback((canvasWorkspaceId: string) => {
    setCanvasCreateContextWorkspaceId(canvasWorkspaceId);
    setIsDialogOpen(true);
  }, []);

  const handleCanvasWorkspaceCreated = useCallback(async (canvasWorkspace: { id: string }) => {
    setCanvasCreateContextWorkspaceId(null);
    await switchToCanvasView(canvasWorkspace.id);
  }, [switchToCanvasView]);

  const handleCanvasLocalWindowCreated = useCallback(async (windowItem: Window) => {
    if (!canvasCreateContextWorkspaceId) {
      return;
    }

    const workspace = useWindowStore.getState().getCanvasWorkspaceById(canvasCreateContextWorkspaceId);
    if (!workspace) {
      return;
    }

    const canvasOwnedWindow: Window = windowItem.ownerType === 'canvas-owned'
      && windowItem.ownerCanvasWorkspaceId === canvasCreateContextWorkspaceId
      ? windowItem
      : {
          ...windowItem,
          ownerType: 'canvas-owned',
          ownerCanvasWorkspaceId: canvasCreateContextWorkspaceId,
        };

    if (canvasOwnedWindow !== windowItem) {
      useWindowStore.getState().syncWindow(canvasOwnedWindow);
    }

    const offsetIndex = workspace.blocks.filter((block) => block.type === 'window').length;
    useWindowStore.getState().updateCanvasWorkspace(canvasCreateContextWorkspaceId, {
      blocks: [
        ...workspace.blocks,
        createCanvasWindowBlock(canvasOwnedWindow, offsetIndex, workspace.nextZIndex, workspace.blocks),
      ],
      nextZIndex: workspace.nextZIndex + 1,
    });
  }, [canvasCreateContextWorkspaceId]);

  const handleReturnFromTerminal = useCallback(async () => {
    if (canvasTerminalReturnTargetId) {
      const targetCanvas = useWindowStore.getState().getCanvasWorkspaceById(canvasTerminalReturnTargetId);
      if (targetCanvas && !targetCanvas.archived) {
        await switchToCanvasView(canvasTerminalReturnTargetId);
        return;
      }
    }

    await switchToUnifiedView();
  }, [canvasTerminalReturnTargetId, switchToCanvasView, switchToUnifiedView]);

  const handleReturnFromCanvas = useCallback(async () => {
    setCanvasTerminalReturnTargetId(null);
    await switchToUnifiedView();
  }, [switchToUnifiedView]);

  const handleReturnHome = useCallback(async () => {
    setCanvasTerminalReturnTargetId(null);
    await switchToUnifiedView();
  }, [switchToUnifiedView]);

  const handleTabChange = useCallback((tab: 'all' | 'active' | 'archived' | string) => {
    setCurrentTab(tab);
    // 持久化到 settings
    window.electronAPI?.updateSettings({ defaultSidebarTab: tab }).catch((error) => {
      console.error('Failed to save default sidebar tab:', error);
    });
  }, []);

  // 进入组视图
  const handleEnterGroup = useCallback(async (group: WindowGroup) => {
    // 先设置 activeGroup，这会清除 activeWindowId
    setActiveGroup(group.id);

    // 然后通知主进程切换到终端视图（使用组的活跃窗口 ID）
    // 这样点击关闭按钮时会返回主界面而不是退出软件
    // 注意：switchToTerminalView 会设置 activeWindowId，但由于我们已经设置了 activeGroupId，
    // 渲染时 GroupView 会优先显示（zIndex 更高）
    try {
      await window.electronAPI.switchToTerminalView(group.activeWindowId);
    } catch (error) {
      console.error('Failed to notify main process of view change:', error);
    }
  }, [setActiveGroup]);

  // 从组视图返回
  const handleReturnFromGroup = useCallback(async () => {
    setActiveGroup(null);

    if (canvasTerminalReturnTargetId) {
      const targetCanvas = useWindowStore.getState().getCanvasWorkspaceById(canvasTerminalReturnTargetId);
      if (targetCanvas && !targetCanvas.archived) {
        await switchToCanvasView(canvasTerminalReturnTargetId);
        return;
      }
    }

    await switchToUnifiedView();
  }, [canvasTerminalReturnTargetId, setActiveGroup, switchToCanvasView, switchToUnifiedView]);

  // 切换到其他组
  const handleGroupSwitch = useCallback(async (groupId: string) => {
    // 先设置 activeGroup
    setActiveGroup(groupId);

    // 获取目标组
    const targetGroup = useWindowStore.getState().groups.find((group) => group.id === groupId);
    if (!targetGroup) {
      console.error('Target group not found:', groupId);
      return;
    }

    // 通知主进程切换到终端视图（使用组的活跃窗口 ID）
    try {
      await window.electronAPI.switchToTerminalView(targetGroup.activeWindowId);
    } catch (error) {
      console.error('Failed to notify main process of view change:', error);
    }
  }, [setActiveGroup]);

  const handleGroupSwitchInCurrentContext = useCallback(async (groupId: string) => {
    if (canvasTerminalReturnTargetId) {
      setActiveGroup(groupId);

      const targetGroup = useWindowStore.getState().groups.find((group) => group.id === groupId);
      if (!targetGroup) {
        console.error('Target group not found:', groupId);
        return;
      }

      try {
        await window.electronAPI.switchToTerminalView(targetGroup.activeWindowId);
      } catch (error) {
        console.error('Failed to notify main process of view change:', error);
      }
      return;
    }

    await handleGroupSwitch(groupId);
  }, [canvasTerminalReturnTargetId, handleGroupSwitch, setActiveGroup]);
  const activeSSHHostKeyPrompt = sshHostKeyPromptQueue[0] ?? null;
  const activeLiveCanvasBlocks = useMemo(
    () => getLiveCanvasWindowBlocks(canvasWorkspaces, currentActiveCanvasWorkspaceId, currentView),
    [canvasWorkspaces, currentActiveCanvasWorkspaceId, currentView],
  );
  const activeLiveCanvasWindowIds = useMemo(
    () => getLiveCanvasWindowIds(activeLiveCanvasBlocks),
    [activeLiveCanvasBlocks],
  );
  const activeLiveCanvasBlockIds = useMemo(
    () => activeLiveCanvasBlocks.map((block) => block.id),
    [activeLiveCanvasBlocks],
  );

  useEffect(() => {
    if (activeLiveCanvasBlockIds.length === 0) {
      setCanvasLiveTerminalRects((previousRects) => (
        Object.keys(previousRects).length === 0 ? previousRects : {}
      ));
      return;
    }

    let animationFrameId: number | null = null;
    const activeBlockIds = new Set(activeLiveCanvasBlockIds);

    const readRects = () => {
      const nextRects: Record<string, CanvasLiveTerminalRect> = {};

      for (const blockId of activeBlockIds) {
        const node = findCanvasLiveBlockNode(blockId);
        if (!node) {
          continue;
        }

        const rect = node.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
          continue;
        }

        nextRects[blockId] = {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        };
      }

      setCanvasLiveTerminalRects((previousRects) => {
        const previousKeys = Object.keys(previousRects);
        const nextKeys = Object.keys(nextRects);
        if (
          previousKeys.length === nextKeys.length
          && nextKeys.every((key) => {
            const previousRect = previousRects[key];
            const nextRect = nextRects[key];
            return previousRect
              && Math.abs(previousRect.left - nextRect.left) < 0.5
              && Math.abs(previousRect.top - nextRect.top) < 0.5
              && Math.abs(previousRect.width - nextRect.width) < 0.5
              && Math.abs(previousRect.height - nextRect.height) < 0.5;
          })
        ) {
          return previousRects;
        }

        return nextRects;
      });
    };

    const scheduleReadRects = () => {
      if (animationFrameId !== null) {
        return;
      }

      animationFrameId = window.requestAnimationFrame(() => {
        animationFrameId = null;
        readRects();
      });
    };

    readRects();

    const resizeObserver = new ResizeObserver(scheduleReadRects);
    for (const blockId of activeBlockIds) {
      const node = findCanvasLiveBlockNode(blockId);
      if (node) {
        resizeObserver.observe(node);
      }
    }

    window.addEventListener('resize', scheduleReadRects);
    window.addEventListener('scroll', scheduleReadRects, true);

    return () => {
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
      }

      resizeObserver.disconnect();
      window.removeEventListener('resize', scheduleReadRects);
      window.removeEventListener('scroll', scheduleReadRects, true);
    };
  }, [activeLiveCanvasBlockIds]);
  const canvasLiveRectByWindowId = useMemo(() => {
    const nextRects = new Map<string, CanvasLiveTerminalRect>();

    for (const block of activeLiveCanvasBlocks) {
      const rect = canvasLiveTerminalRects[block.id];
      if (rect) {
        nextRects.set(block.windowId, rect);
      }
    }

    return nextRects;
  }, [activeLiveCanvasBlocks, canvasLiveTerminalRects]);

  const mountedTerminalWindowIdSet = useMemo(() => {
    const nextIds = new Set(mountedTerminalWindowIds);

    // 当切换到一个首次打开的终端窗口时，确保它在当前渲染帧就参与挂载，
    // 避免 activeWindowId 已切换但 mounted 列表尚未同步时出现一帧空白闪烁。
    if (activeWindowId) {
      nextIds.add(activeWindowId);
    }

    for (const windowId of activeLiveCanvasWindowIds) {
      nextIds.add(windowId);
    }

    return nextIds;
  }, [activeLiveCanvasWindowIds, activeWindowId, mountedTerminalWindowIds]);
  const mountedTerminalSurfaceWindowIds = useMemo(
    () => Array.from(mountedTerminalWindowIdSet),
    [mountedTerminalWindowIdSet],
  );
  const mountedTerminalObservation = useMemo(() => (
    createMountedTerminalObservationSnapshot({
      currentView,
      activeWindowId,
      activeGroupId,
      mountedWindowIds: mountedTerminalSurfaceWindowIds,
      mountedWindowStatusKeys: mountedWindowRecordKeys,
      mountedWindowTerminalPaneCountKeys,
    })
  ), [
    activeGroupId,
    activeWindowId,
    currentView,
    mountedTerminalSurfaceWindowIds,
    mountedWindowRecordKeys,
    mountedWindowTerminalPaneCountKeys,
  ]);
  const hasActiveWindows = useMemo(
    () => hasPersistedEntries || (sshEnabled && sshProfiles.length > 0),
    [hasPersistedEntries, sshEnabled, sshProfiles.length]
  );

  useEffect(() => {
    logMountedTerminalObservation(mountedTerminalObservation);
  }, [mountedTerminalObservation]);

  const handleSSHHostKeyPromptDecision = useCallback((decision: { trusted: boolean; persist: boolean }) => {
    setSSHHostKeyPromptQueue((currentQueue) => {
      const currentPrompt = currentQueue[0];
      if (currentPrompt) {
        window.electronAPI.respondSSHHostKeyPrompt({
          requestId: currentPrompt.requestId,
          ...decision,
        });
      }

      return currentQueue.slice(1);
    });
  }, []);

  const openSSHPasswordPrompt = useCallback((request: SSHPasswordPromptRequest) => {
    if (sshPasswordPromptResolverRef.current) {
      sshPasswordPromptResolverRef.current(null);
    }

    setSSHPasswordPromptRequest(request);

    return new Promise<string | null>((resolve) => {
      sshPasswordPromptResolverRef.current = resolve;
    });
  }, []);

  useEffect(() => {
    setSSHPasswordPromptHandler(openSSHPasswordPrompt);

    return () => {
      setSSHPasswordPromptHandler(null);

      if (sshPasswordPromptResolverRef.current) {
        sshPasswordPromptResolverRef.current(null);
        sshPasswordPromptResolverRef.current = null;
      }
    };
  }, [openSSHPasswordPrompt]);

  const closeSSHPasswordPrompt = useCallback((password: string | null) => {
    const resolve = sshPasswordPromptResolverRef.current;
    sshPasswordPromptResolverRef.current = null;
    setSSHPasswordPromptRequest(null);
    resolve?.(password);
  }, []);

  // 计算标题栏标题
  const titleBarTitle = useMemo(() => {
    if (currentView === 'unified') return '';
    if (activeGroupId) {
      return activeGroupName;
    }
    if (currentView === 'canvas') {
      return canvasWorkspaces.find((canvasWorkspace) => canvasWorkspace.id === currentActiveCanvasWorkspaceId)?.name ?? '';
    }
    if (activeWindowId) {
      return activeWindowTitle;
    }
    return '';
  }, [activeGroupId, activeGroupName, activeWindowId, activeWindowTitle, canvasWorkspaces, currentActiveCanvasWorkspaceId, currentView]);

  const titleBarGitBranch = useMemo(() => {
    if (currentView === 'unified' || currentView === 'canvas' || activeGroupId) return undefined;
    return activeWindowGitBranch;
  }, [currentView, activeGroupId, activeWindowGitBranch]);
  const canvasInitialWorkingDirectory = useMemo(() => (
    canvasCreateContextWorkspaceId
      ? (canvasWorkspaces.find((canvasWorkspace) => canvasWorkspace.id === canvasCreateContextWorkspaceId)?.workingDirectory ?? '')
      : ''
  ), [canvasCreateContextWorkspaceId, canvasWorkspaces]);

  return (
    <div className="relative flex h-screen flex-col overflow-hidden">
      <AppearanceBackdrop appearance={appearance} />
      {/* 自定义标题栏 */}
      <CustomTitleBar
        title={titleBarTitle}
        gitBranch={titleBarGitBranch}
        showAppName={currentView === 'unified'}
        appName={appVersion.name}
        onReturn={currentView !== 'unified' ? handleReturnHome : undefined}
        onClose={currentView === 'canvas' ? handleReturnFromCanvas : undefined}
      />

      {/* 内容区域 */}
      <div className="relative z-10 flex-1 overflow-hidden">
        {/* 统一视图 - 淡入淡出 */}
        <div
          className="transition-opacity duration-300 h-full"
          style={{
            display: currentView === 'unified' ? 'block' : 'none',
            opacity: currentView === 'unified' ? 1 : 0,
          }}
        >
        <MainLayout
          sidebar={
            <Sidebar
              appName={appVersion.name}
              version={appVersion.version}
              onCreateWindow={handleCreateWindow}
              sshEnabled={sshEnabled}
              sshProfiles={sshProfiles}
              onSSHProfileSaved={handleSSHProfileSaved}
              sshProfileCount={sshProfiles.length}
              onCreateGroup={handleCreateGroup}
              currentTab={currentTab}
              recentTerminalLimit={recentTerminalLimit}
              onTabChange={handleTabChange}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
            />
          }
        >
          {currentTab === 'active' && !hasActiveWindows ? (
            <EmptyState onCreateWindow={handleCreateWindow} />
          ) : (
            <CardGrid
              onEnterTerminal={handleEnterTerminal}
              onEnterCanvasWorkspace={handleEnterCanvasWorkspace}
              onStopCanvasWorkspace={handleStopCanvasWorkspace}
              onDeleteCanvasWorkspace={handleStopCanvasWorkspace}
              onEnterGroup={handleEnterGroup}
              onCreateWindow={handleCreateWindow}
              sshEnabled={sshEnabled}
              sshProfiles={sshProfiles}
              sshCredentialStates={sshCredentialStates}
              connectingSSHProfileId={connectingSSHProfileId}
              onConnectSSHProfile={handleConnectSSHProfile}
              onEditSSHProfile={handleEditSSHProfile}
              onDuplicateSSHProfile={handleDuplicateSSHProfile}
              onDeleteSSHProfile={handleDeleteSSHProfile}
              searchQuery={searchQuery}
              currentTab={currentTab}
              recentTerminalLimit={recentTerminalLimit}
            />
          )}
        </MainLayout>
      </div>

      {/* 终端视图：窗口一旦打开过就保持挂载，仅切换显示状态，避免返回或窗口切换时销毁 xterm 实例 */}
      {mountedTerminalSurfaceWindowIds.map((windowId) => (
        <MountedTerminalSurface
          key={windowId}
          activeLiveCanvasWindowIds={activeLiveCanvasWindowIds}
          canvasLiveRect={canvasLiveRectByWindowId.get(windowId) ?? null}
          windowId={windowId}
          isVisible={currentView === 'terminal' && activeWindowId === windowId}
          onReturn={handleReturnFromTerminal}
          onWindowSwitch={handleWindowSwitchInCurrentContext}
          onCanvasSwitch={handleCanvasSwitchFromTerminalContext}
          onGroupSwitch={handleGroupSwitchInCurrentContext}
          sshEnabled={sshEnabled}
          sshProfiles={sshProfiles}
          onSSHProfileSaved={handleSSHProfileSaved}
        />
      ))}

      {currentView === 'canvas' && currentActiveCanvasWorkspaceId && (
        <ActiveCanvasSurface
          activeCanvasWorkspaceId={currentActiveCanvasWorkspaceId}
          onWindowSwitch={handleOpenWindowFromCanvas}
          onCanvasSwitch={handleCanvasSwitchFromTerminalContext}
          onGroupSwitch={handleGroupSwitchFromCanvasContext}
          onStopWorkspace={handleStopCanvasWorkspace}
          onExitWorkspace={handleReturnFromCanvas}
          sshEnabled={sshEnabled}
          sshProfiles={sshProfiles}
          onSSHProfileSaved={handleSSHProfileSaved}
        />
      )}

      {error && <AppNotice message={error} />}
      {!error && appNotice && <AppNotice message={appNotice.message} tone={appNotice.tone} />}

      {/* 组视图：当 activeGroupId 有效时显示 */}
      {activeGroupId && (
        <ActiveGroupSurface
          activeGroupId={activeGroupId}
          onReturn={handleReturnFromGroup}
          onWindowSwitch={handleWindowSwitchInCurrentContext}
          onCanvasSwitch={handleCanvasSwitchFromTerminalContext}
          onGroupSwitch={handleGroupSwitchInCurrentContext}
          sshProfiles={sshProfiles}
        />
      )}

      {/* 清理进度覆盖层 */}
      <CleanupOverlay />

      {/* 快捷导航面板 */}
      {isQuickNavOpen && (
        <Suspense fallback={null}>
          <LazyQuickNavPanel
            open={isQuickNavOpen}
            onClose={() => setIsQuickNavOpen(false)}
          />
        </Suspense>
      )}

      {/* 创建组对话框 */}
      {showCreateGroupDialog && (
        <CreateGroupDialog
          open={showCreateGroupDialog}
          onOpenChange={setShowCreateGroupDialog}
        />
      )}

      {sshEnabled && (
        <CreateWindowDialog
          open={isSSHDialogOpen}
          onOpenChange={handleSSHProfileDialogChange}
          sshEnabled={sshEnabled}
          sshProfiles={sshProfiles}
          editingSSHProfile={editingSSHProfile}
          initialSSHProfile={duplicatingSSHProfile}
          sshCredentialState={editingSSHProfile ? sshCredentialStates[editingSSHProfile.id] : null}
          onSSHProfileSaved={handleSSHProfileSaved}
        />
      )}

      <CreateWindowDialog
        open={isDialogOpen}
        onOpenChange={handleDialogChange}
        availableTabs={canvasCreateContextWorkspaceId ? ['local', 'ssh'] : undefined}
        initialTab={canvasCreateContextWorkspaceId ? 'local' : undefined}
        initialWorkingDirectory={canvasInitialWorkingDirectory}
        sshEnabled={sshEnabled}
        sshProfiles={sshProfiles}
        onLocalWindowCreated={handleCanvasLocalWindowCreated}
        onCanvasWorkspaceCreated={handleCanvasWorkspaceCreated}
        onSSHProfileSaved={handleSSHProfileSaved}
        onSSHProfileConnect={handleConnectSSHProfileIntoCanvas}
        localWindowOwnerCanvasWorkspaceId={canvasCreateContextWorkspaceId}
        sshSubmitMode={canvasCreateContextWorkspaceId ? 'saveAndConnect' : 'save'}
      />

      <SSHHostKeyPromptDialog
        request={activeSSHHostKeyPrompt}
        onDecision={handleSSHHostKeyPromptDecision}
      />

      <SSHPasswordPromptDialog
        request={sshPasswordPromptRequest}
        onSubmit={(password) => closeSSHPasswordPrompt(password)}
        onCancel={() => closeSSHPasswordPrompt(null)}
      />
      {isStartupMaskVisible && (
        <div
          className="pointer-events-none fixed inset-0 z-[2000] bg-[rgb(var(--background))] transition-opacity ease-out"
          style={{
            opacity: isStartupMaskHiding ? 0 : 1,
            transitionDuration: `${STARTUP_MASK_FADE_MS}ms`,
          }}
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(39,39,42,0.42),rgba(10,10,10,1)_72%)]" />
        </div>
      )}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <I18nProvider>
      <DndProvider backend={HTML5Backend}>
        <AppContent />
      </DndProvider>
    </I18nProvider>
  );
}
