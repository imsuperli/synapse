import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type {
  CanvasActivityEvent,
  CanvasWorkspace,
  CanvasWorkspaceTemplate,
} from '../../shared/types/canvas';
import { Window, WindowStatus, Pane, LayoutNode, CodePaneState } from '../types/window';
import { WindowGroup, GroupLayoutNode } from '../../shared/types/window-group';
import { CustomCategory } from '../../shared/types/custom-category';
import {
  splitPane as splitPaneInLayout,
  closePane as closePaneInLayout,
  movePane as movePaneInLayout,
  updatePaneInLayout,
  updateSplitSizes as updateSplitSizesInLayout,
  getAllPanes,
  findPaneNode,
  collapseTmuxAgentPanesForDestroyedSession,
} from '../utils/layoutHelpers';
import {
  getAllWindowIds,
  removeWindowFromGroup as removeWindowFromGroupLayout,
  updateGroupSplitSizes as updateGroupSplitSizesInLayout,
  addWindowToGroup as addWindowToGroupInLayout,
  getWindowCount,
} from '../utils/groupLayoutHelpers';
import { getPersistableWindows } from '../utils/sshWindowBindings';
import { getWindowKind } from '../../shared/utils/terminalCapabilities';
import { isLegacyPausedStatus } from '../utils/windowLifecycle';
import { updateSettingsCategories } from './categoryHelpers';
import { usePaneNoteStore } from './paneNoteStore';

// 全局标志：是否启用自动保存
let autoSaveEnabled = true;
const WINDOW_STORE_AUTOSAVE_STATE_KEY = '__copilotTerminalWindowStoreAutoSaveState__';
const RENDERER_AUTOSAVE_DEBOUNCE_MS = 80;
const runtimeOnlyPaneFields = new Set<keyof Pane>([
  'status',
  'pid',
  'sessionId',
  'lastOutput',
  'title',
  'borderColor',
  'activeBorderColor',
  'teamName',
  'agentId',
  'agentName',
  'agentColor',
  'teammateMode',
  'tmuxScopeId',
]);

type PendingAutoSavePayload = {
  groups: WindowGroup[];
  canvasWorkspaces: CanvasWorkspace[];
  canvasWorkspaceTemplates: CanvasWorkspaceTemplate[];
  canvasActivity: CanvasActivityEvent[];
  persistableWindows: Window[];
  signature: string;
};

type WindowStoreAutoSaveState = {
  timer: ReturnType<typeof setTimeout> | null;
  pendingPayload: PendingAutoSavePayload | null;
  lastSentSignature: string | null;
  lifecycleBound: boolean;
};

const fallbackAutoSaveState: WindowStoreAutoSaveState = {
  timer: null,
  pendingPayload: null,
  lastSentSignature: null,
  lifecycleBound: false,
};

const autoSavePaneSignatureCache = new WeakMap<Pane, string>();
const autoSaveLayoutSignatureCache = new WeakMap<LayoutNode, string>();
const autoSaveWindowSignatureCache = new WeakMap<Window, string>();
const autoSaveGroupLayoutSignatureCache = new WeakMap<GroupLayoutNode, string>();
const autoSaveGroupSignatureCache = new WeakMap<WindowGroup, string>();

function getWindowStoreAutoSaveState(): WindowStoreAutoSaveState {
  if (typeof window === 'undefined') {
    return fallbackAutoSaveState;
  }

  const host = window as typeof window & {
    [WINDOW_STORE_AUTOSAVE_STATE_KEY]?: WindowStoreAutoSaveState;
  };
  if (!host[WINDOW_STORE_AUTOSAVE_STATE_KEY]) {
    host[WINDOW_STORE_AUTOSAVE_STATE_KEY] = {
      timer: null,
      pendingPayload: null,
      lastSentSignature: null,
      lifecycleBound: false,
    };
  }

  return host[WINDOW_STORE_AUTOSAVE_STATE_KEY]!;
}

function clearScheduledAutoSave(state = getWindowStoreAutoSaveState()): void {
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
  state.pendingPayload = null;
}

function sanitizePaneForAutoSave(pane: Pane): unknown {
  const {
    status,
    pid,
    sessionId,
    lastOutput,
    title,
    borderColor,
    activeBorderColor,
    teamName,
    agentId,
    agentName,
    agentColor,
    teammateMode,
    tmuxScopeId,
    ...persistedPane
  } = pane;

  if (persistedPane.kind === 'browser') {
    return {
      ...persistedPane,
      cwd: '',
      command: '',
    };
  }

  if (persistedPane.kind === 'code') {
    return {
      ...persistedPane,
      command: '',
    };
  }

  if (persistedPane.backend !== 'ssh' || !persistedPane.ssh) {
    return persistedPane;
  }

  return {
    ...persistedPane,
    ssh: {
      profileId: persistedPane.ssh.profileId,
    },
  };
}

function getAutoSavePaneSignature(pane: Pane): string {
  const cachedSignature = autoSavePaneSignatureCache.get(pane);
  if (cachedSignature) {
    return cachedSignature;
  }

  const signature = JSON.stringify(sanitizePaneForAutoSave(pane));
  autoSavePaneSignatureCache.set(pane, signature);
  return signature;
}

function getAutoSaveLayoutSignature(layout: LayoutNode): string {
  const cachedSignature = autoSaveLayoutSignatureCache.get(layout);
  if (cachedSignature) {
    return cachedSignature;
  }

  const signature = layout.type === 'pane'
    ? `{"type":"pane","id":${JSON.stringify(layout.id)},"pane":${getAutoSavePaneSignature(layout.pane)}}`
    : `{"type":"split","direction":${JSON.stringify(layout.direction)},"sizes":${JSON.stringify(layout.sizes)},"children":[${layout.children.map((child) => getAutoSaveLayoutSignature(child)).join(',')}]}`
  ;
  autoSaveLayoutSignatureCache.set(layout, signature);
  return signature;
}

function getAutoSaveWindowSignature(window: Window): string {
  const cachedSignature = autoSaveWindowSignatureCache.get(window);
  if (cachedSignature) {
    return cachedSignature;
  }

  const {
    claudeModel,
    claudeModelId,
    claudeContextPercentage,
    claudeCost,
    layout,
    ...persistedWindow
  } = window;
  const windowPrefix = JSON.stringify(persistedWindow).slice(0, -1);
  const signature = `${windowPrefix},"layout":${getAutoSaveLayoutSignature(layout)}}`;
  autoSaveWindowSignatureCache.set(window, signature);
  return signature;
}

function getAutoSaveGroupLayoutSignature(layout: GroupLayoutNode): string {
  const cachedSignature = autoSaveGroupLayoutSignatureCache.get(layout);
  if (cachedSignature) {
    return cachedSignature;
  }

  const signature = layout.type === 'window'
    ? `{"type":"window","id":${JSON.stringify(layout.id)}}`
    : `{"type":"split","direction":${JSON.stringify(layout.direction)},"sizes":${JSON.stringify(layout.sizes)},"children":[${layout.children.map((child) => getAutoSaveGroupLayoutSignature(child)).join(',')}]}`
  ;
  autoSaveGroupLayoutSignatureCache.set(layout, signature);
  return signature;
}

function getAutoSaveGroupSignature(group: WindowGroup): string {
  const cachedSignature = autoSaveGroupSignatureCache.get(group);
  if (cachedSignature) {
    return cachedSignature;
  }

  const { layout, ...persistedGroup } = group;
  const groupPrefix = JSON.stringify(persistedGroup).slice(0, -1);
  const signature = `${groupPrefix},"layout":${getAutoSaveGroupLayoutSignature(layout)}}`;
  autoSaveGroupSignatureCache.set(group, signature);
  return signature;
}

function getCanvasWorkspaceSignature(canvasWorkspace: CanvasWorkspace): string {
  return JSON.stringify(canvasWorkspace);
}

function getAutoSaveSignature(
  persistableWindows: Window[],
  groups: WindowGroup[],
  canvasWorkspaces: CanvasWorkspace[],
  canvasWorkspaceTemplates: CanvasWorkspaceTemplate[],
  canvasActivity: CanvasActivityEvent[],
): string {
  return `windows:[${persistableWindows.map((window) => getAutoSaveWindowSignature(window)).join(',')}];groups:[${groups.map((group) => getAutoSaveGroupSignature(group)).join(',')}];canvas:[${canvasWorkspaces.map((canvasWorkspace) => getCanvasWorkspaceSignature(canvasWorkspace)).join(',')}];templates:${JSON.stringify(canvasWorkspaceTemplates)};activity:${JSON.stringify(canvasActivity)}`;
}

function didPersistedWindowChange(previousWindow: Window | undefined, nextWindow: Window): boolean {
  if (!previousWindow) {
    return !nextWindow.ephemeral;
  }

  if (previousWindow.ephemeral && nextWindow.ephemeral) {
    return false;
  }

  if (previousWindow.ephemeral !== nextWindow.ephemeral) {
    return true;
  }

  return getAutoSaveWindowSignature(previousWindow) !== getAutoSaveWindowSignature(nextWindow);
}

function flushPendingAutoSave(): void {
  const state = getWindowStoreAutoSaveState();
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }

  if (!autoSaveEnabled || !window.electronAPI) {
    state.pendingPayload = null;
    return;
  }

  const payload = state.pendingPayload;
  state.pendingPayload = null;
  if (!payload) {
    return;
  }

  if (payload.signature === state.lastSentSignature) {
    return;
  }

  if (payload.canvasWorkspaceTemplates.length > 0 || payload.canvasActivity.length > 0) {
    window.electronAPI.triggerAutoSave(
      payload.persistableWindows,
      payload.groups,
      payload.canvasWorkspaces,
      payload.canvasWorkspaceTemplates,
      payload.canvasActivity,
    );
    state.lastSentSignature = payload.signature;
    return;
  }

  window.electronAPI.triggerAutoSave(
    payload.persistableWindows,
    payload.groups,
    payload.canvasWorkspaces,
  );
  state.lastSentSignature = payload.signature;
}

function ensureAutoSaveLifecycleHooks(): void {
  const state = getWindowStoreAutoSaveState();
  if (state.lifecycleBound || typeof window === 'undefined') {
    return;
  }

  const flush = () => {
    flushPendingAutoSave();
  };

  window.addEventListener('beforeunload', flush);
  window.addEventListener('pagehide', flush);
  state.lifecycleBound = true;
}

/**
 * 触发自动保存
 * 通过 IPC 事件通知主进程触发保存
 * @param windows 当前窗口列表
 * @param groups 当前窗口组列表
 */
function triggerAutoSave(
  windows: Window[],
  groups?: WindowGroup[],
  canvasWorkspaces?: CanvasWorkspace[],
  canvasWorkspaceTemplates?: CanvasWorkspaceTemplate[],
  canvasActivity?: CanvasActivityEvent[],
): void {
  if (!autoSaveEnabled || !window.electronAPI) {
    return;
  }

  ensureAutoSaveLifecycleHooks();
  const state = getWindowStoreAutoSaveState();
  const storeSnapshot = (() => {
    try {
      return useWindowStore.getState();
    } catch {
      return undefined;
    }
  })();
  const resolvedGroups = groups ?? [];
  const resolvedCanvasWorkspaces = canvasWorkspaces ?? [];
  const resolvedCanvasWorkspaceTemplates = canvasWorkspaceTemplates ?? storeSnapshot?.canvasWorkspaceTemplates ?? [];
  const resolvedCanvasActivity = canvasActivity ?? storeSnapshot?.canvasActivity ?? [];
  const persistableWindows = getPersistableWindows(windows);
  state.pendingPayload = {
    groups: resolvedGroups,
    canvasWorkspaces: resolvedCanvasWorkspaces,
    canvasWorkspaceTemplates: resolvedCanvasWorkspaceTemplates,
    canvasActivity: resolvedCanvasActivity,
    persistableWindows,
    signature: getAutoSaveSignature(
      persistableWindows,
      resolvedGroups,
      resolvedCanvasWorkspaces,
      resolvedCanvasWorkspaceTemplates,
      resolvedCanvasActivity,
    ),
  };

  if (state.timer) {
    clearTimeout(state.timer);
  }

  state.timer = setTimeout(() => {
    flushPendingAutoSave();
  }, RENDERER_AUTOSAVE_DEBOUNCE_MS);
}

/**
 * 设置自动保存开关
 */
export function setAutoSaveEnabled(enabled: boolean): void {
  autoSaveEnabled = enabled;
  if (!enabled) {
    const state = getWindowStoreAutoSaveState();
    clearScheduledAutoSave(state);
    state.lastSentSignature = null;
  }
}

export function __flushWindowStoreAutoSaveForTests(): void {
  flushPendingAutoSave();
}

export function __resetWindowStoreAutoSaveStateForTests(): void {
  autoSaveEnabled = true;
  const state = getWindowStoreAutoSaveState();
  clearScheduledAutoSave(state);
  state.lastSentSignature = null;
}

function isRuntimeOnlyPaneUpdate(updateKeys: string[]): boolean {
  return updateKeys.length > 0 && updateKeys.every((key) => runtimeOnlyPaneFields.has(key as keyof Pane));
}

function isRuntimeOnlyCodePaneUpdate(previousCode: CodePaneState | undefined, nextCode: CodePaneState | undefined): boolean {
  if (!previousCode || !nextCode) {
    return false;
  }

  const previousKeys = Object.keys(previousCode);
  const nextKeys = Object.keys(nextCode);
  if (previousKeys.length !== nextKeys.length) {
    return false;
  }

  for (const key of nextKeys) {
    if (!(key in previousCode)) {
      return false;
    }

    const paneKey = key as keyof CodePaneState;
    if (paneKey === 'selectedPath') {
      continue;
    }

    if (previousCode[paneKey] !== nextCode[paneKey]) {
      return false;
    }
  }

  return previousCode.selectedPath !== nextCode.selectedPath;
}

function removePaneNotesForWindow(window: Window | undefined): void {
  if (!window) {
    return;
  }

  removePaneNotesForWindowSnapshot(window.id, getAllPanes(window.layout).map((pane) => pane.id));
}

function removePaneNotesForWindowSnapshot(windowId: string, paneIds: string[]): void {
  const removeNote = usePaneNoteStore.getState().removeNote;
  for (const paneId of paneIds) {
    removeNote(windowId, paneId);
  }
}

export type TerminalSidebarSection = 'archived' | 'local' | 'ssh' | 'canvas';
export type TerminalSidebarFilter = 'all' | 'local' | 'ssh' | 'canvas' | 'archived';

export const TERMINAL_SIDEBAR_PREFERENCES_STORAGE_KEY = 'synapse:terminal-sidebar-preferences';
const LEGACY_TERMINAL_SIDEBAR_PREFERENCES_STORAGE_KEY = 'copilot-terminal:terminal-sidebar-preferences';

const DEFAULT_TERMINAL_SIDEBAR_SECTIONS: Record<TerminalSidebarSection, boolean> = {
  archived: false,
  canvas: true,
  local: true,
  ssh: true,
};

const DEFAULT_TERMINAL_SIDEBAR_FILTER: TerminalSidebarFilter = 'all';

function getRendererLocalStorage(): Storage | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.localStorage;
  } catch (error) {
    console.error('[windowStore] Failed to access localStorage:', error);
    return null;
  }
}

function normalizeTerminalSidebarFilter(value: unknown): TerminalSidebarFilter {
  switch (value) {
    case 'all':
    case 'local':
    case 'ssh':
    case 'canvas':
    case 'archived':
      return value;
    default:
      return DEFAULT_TERMINAL_SIDEBAR_FILTER;
  }
}

function loadTerminalSidebarPreferences(): {
  filter: TerminalSidebarFilter;
  sections: Record<TerminalSidebarSection, boolean>;
} {
  const storage = getRendererLocalStorage();
  if (!storage) {
    return {
      filter: DEFAULT_TERMINAL_SIDEBAR_FILTER,
      sections: { ...DEFAULT_TERMINAL_SIDEBAR_SECTIONS },
    };
  }

  try {
    const rawValue = storage.getItem(TERMINAL_SIDEBAR_PREFERENCES_STORAGE_KEY)
      ?? storage.getItem(LEGACY_TERMINAL_SIDEBAR_PREFERENCES_STORAGE_KEY);
    if (!rawValue) {
      return {
        filter: DEFAULT_TERMINAL_SIDEBAR_FILTER,
        sections: { ...DEFAULT_TERMINAL_SIDEBAR_SECTIONS },
      };
    }

    const parsed = JSON.parse(rawValue) as {
      filter?: unknown;
      sections?: Partial<Record<TerminalSidebarSection, unknown>>;
    };

    return {
      filter: normalizeTerminalSidebarFilter(parsed.filter),
      sections: {
        archived: typeof parsed.sections?.archived === 'boolean'
          ? parsed.sections.archived
          : DEFAULT_TERMINAL_SIDEBAR_SECTIONS.archived,
        canvas: typeof parsed.sections?.canvas === 'boolean'
          ? parsed.sections.canvas
          : DEFAULT_TERMINAL_SIDEBAR_SECTIONS.canvas,
        local: typeof parsed.sections?.local === 'boolean'
          ? parsed.sections.local
          : DEFAULT_TERMINAL_SIDEBAR_SECTIONS.local,
        ssh: typeof parsed.sections?.ssh === 'boolean'
          ? parsed.sections.ssh
          : DEFAULT_TERMINAL_SIDEBAR_SECTIONS.ssh,
      },
    };
  } catch (error) {
    console.error('[windowStore] Failed to parse terminal sidebar preferences:', error);
    return {
      filter: DEFAULT_TERMINAL_SIDEBAR_FILTER,
      sections: { ...DEFAULT_TERMINAL_SIDEBAR_SECTIONS },
    };
  }
}

function persistTerminalSidebarPreferences(
  sections: Record<TerminalSidebarSection, boolean>,
  filter: TerminalSidebarFilter,
): void {
  const storage = getRendererLocalStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(
      TERMINAL_SIDEBAR_PREFERENCES_STORAGE_KEY,
      JSON.stringify({ filter, sections }),
    );
    storage.removeItem(LEGACY_TERMINAL_SIDEBAR_PREFERENCES_STORAGE_KEY);
  } catch (error) {
    console.error('[windowStore] Failed to persist terminal sidebar preferences:', error);
  }
}

const initialTerminalSidebarPreferences = loadTerminalSidebarPreferences();

/**
 * 窗口状态管理 Store 接口
 */
interface WindowStore {
  // 状态
  windows: Window[];
  activeWindowId: string | null;
  canvasWorkspaces: CanvasWorkspace[];
  canvasWorkspaceTemplates: CanvasWorkspaceTemplate[];
  canvasActivity: CanvasActivityEvent[];
  activeCanvasWorkspaceId: string | null;
  startedCanvasWorkspaceIds: string[];
  mruList: string[]; // 最近使用列表（窗口 ID）
  sidebarExpanded: boolean; // 侧边栏是否展开
  sidebarWidth: number; // 侧边栏宽度
  terminalSidebarSections: Record<TerminalSidebarSection, boolean>; // 终端视图侧边栏各分类的折叠状态
  terminalSidebarFilter: TerminalSidebarFilter; // 终端视图侧边栏筛选状态

  // 组相关状态
  groups: WindowGroup[]; // 窗口组列表
  activeGroupId: string | null; // 当前激活的窗口组 ID
  groupMruList: string[]; // 组的 MRU 列表

  // 自定义分类相关状态（本地缓存,从 settings 同步）
  customCategories: CustomCategory[];

  // Actions
  addWindow: (window: Window) => void;
  syncWindow: (window: Window) => void;
  removeWindow: (id: string) => void;
  updateWindow: (id: string, updates: Partial<Window>) => void;
  updateWindowRuntime: (id: string, updates: Partial<Window>) => void;
  /**
   * @deprecated 遗留方法，会更新窗口的所有窗格状态为同一个值。
   * 请使用 updatePane 方法来更新单个窗格的状态。
   * 此方法仅为向后兼容保留，不应在新代码中使用。
   */
  updateWindowStatus: (id: string, status: WindowStatus) => void;
  archiveWindow: (id: string) => void;
  unarchiveWindow: (id: string) => void;
  setActiveWindow: (id: string | null) => void;
  clearWindows: () => void; // 清空所有窗口（用于工作区恢复）
  addCanvasWorkspace: (canvasWorkspace: CanvasWorkspace, options?: { persist?: boolean }) => void;
  updateCanvasWorkspace: (id: string, updates: Partial<CanvasWorkspace>) => void;
  removeCanvasWorkspace: (id: string) => void;
  setActiveCanvasWorkspace: (id: string | null) => void;
  setCanvasWorkspaceStarted: (id: string, started: boolean) => void;
  isCanvasWorkspaceStarted: (id: string) => boolean;
  getCanvasWorkspaceById: (id: string) => CanvasWorkspace | undefined;
  setCanvasWorkspaceTemplates: (templates: CanvasWorkspaceTemplate[]) => void;
  upsertCanvasWorkspaceTemplate: (template: CanvasWorkspaceTemplate) => void;
  removeCanvasWorkspaceTemplate: (id: string) => void;
  appendCanvasActivity: (event: CanvasActivityEvent) => void;
  clearCanvasActivity: (workspaceId?: string) => void;

  // Pane 相关
  updatePane: (windowId: string, paneId: string, updates: Partial<Pane>) => void;
  updatePaneRuntime: (windowId: string, paneId: string, updates: Partial<Pane>) => void;
  clearWindowRuntimeSession: (windowId: string) => void;
  splitPaneInWindow: (
    windowId: string,
    targetPaneId: string,
    direction: 'horizontal' | 'vertical',
    newPane: Pane,
    sizes?: [number, number],
  ) => void;
  placePaneInWindow: (
    windowId: string,
    targetPaneId: string,
    direction: 'horizontal' | 'vertical',
    newPane: Pane,
    insertBefore: boolean,
    sizes?: [number, number],
  ) => void;
  movePaneInWindow: (
    windowId: string,
    paneId: string,
    targetPaneId: string,
    direction: 'horizontal' | 'vertical',
    insertBefore: boolean,
  ) => void;
  closePaneInWindow: (windowId: string, paneId: string, options?: { syncProcess?: boolean }) => void;
  updateSplitSizes: (windowId: string, splitPath: number[], sizes: number[]) => void;
  setActivePane: (windowId: string, paneId: string) => void;

  // MRU 相关
  updateMRU: (windowId: string) => void;
  getMRUWindows: () => Window[];

  // 侧边栏相关
  toggleSidebar: () => void;
  setSidebarWidth: (width: number) => void;
  setTerminalSidebarSectionExpanded: (section: TerminalSidebarSection, expanded: boolean) => void;
  setTerminalSidebarFilter: (filter: TerminalSidebarFilter) => void;

  // 辅助方法
  getWindowById: (id: string) => Window | undefined;
  getPaneById: (windowId: string, paneId: string) => Pane | undefined;
  getActiveWindows: () => Window[]; // 获取未归档的窗口
  getArchivedWindows: () => Window[]; // 获取已归档的窗口

  // Claude 模型相关
  updateClaudeModel: (windowId: string, model?: string, modelId?: string, contextPercentage?: number, cost?: number) => void;

  // 组相关 Actions
  addGroup: (group: WindowGroup) => void;
  removeGroup: (id: string) => void;
  updateGroup: (id: string, updates: Partial<WindowGroup>) => void;
  archiveGroup: (id: string) => void;
  unarchiveGroup: (id: string) => void;
  setActiveGroup: (id: string | null) => void;
  clearGroups: () => void; // 清空所有组（用于工作区恢复）

  // 组布局操作
  addWindowToGroupLayout: (groupId: string, targetWindowId: string, newWindowId: string, direction: 'horizontal' | 'vertical') => void;
  removeWindowFromGroupLayout: (groupId: string, windowId: string) => void;
  rearrangeWindowInGroupLayout: (groupId: string, dragWindowId: string, targetWindowId: string, direction: 'horizontal' | 'vertical', insertBefore: boolean) => void;
  updateGroupSplitSizes: (groupId: string, splitPath: number[], sizes: number[]) => void;
  setActiveWindowInGroup: (groupId: string, windowId: string) => void;

  // 组 MRU 相关
  updateGroupMRU: (groupId: string) => void;
  getMRUGroups: () => WindowGroup[];

  // 组辅助方法
  getGroupById: (id: string) => WindowGroup | undefined;
  getWindowsInGroup: (groupId: string) => Window[];
  getActiveGroups: () => WindowGroup[]; // 获取未归档的组
  getArchivedGroups: () => WindowGroup[]; // 获取已归档的组
  findGroupByWindowId: (windowId: string) => WindowGroup | undefined; // 查找包含指定窗口的组

  // 自定义分类相关 Actions
  syncCustomCategories: (categories: CustomCategory[]) => void; // 从 settings 同步分类数据
  addCustomCategory: (category: Omit<CustomCategory, 'id' | 'createdAt' | 'updatedAt'>) => Promise<string>;
  updateCustomCategory: (id: string, updates: Partial<Omit<CustomCategory, 'id' | 'createdAt'>>) => Promise<void>;
  removeCustomCategory: (id: string) => Promise<void>;
  addWindowToCategory: (categoryId: string, windowId: string) => Promise<void>;
  removeWindowFromCategory: (categoryId: string, windowId: string) => Promise<void>;
  addSSHProfileToCategory: (categoryId: string, profileId: string) => Promise<void>;
  removeSSHProfileFromCategory: (categoryId: string, profileId: string) => Promise<void>;
  addGroupToCategory: (categoryId: string, groupId: string) => Promise<void>;
  removeGroupFromCategory: (categoryId: string, groupId: string) => Promise<void>;

  // 自定义分类辅助方法
  getCustomCategories: () => CustomCategory[];
  getCategoryById: (id: string) => CustomCategory | undefined;
  getWindowCategories: (windowId: string) => CustomCategory[];
  getSSHProfileCategories: (profileId: string) => CustomCategory[];
  getGroupCategories: (groupId: string) => CustomCategory[];
}

/**
 * 创建窗口状态管理 Store
 * 使用 immer 中间件确保不可变更新
 */
export const useWindowStore = create<WindowStore>()(
  immer((set, get) => ({
    // 初始状态
    windows: [],
    activeWindowId: null,
    canvasWorkspaces: [],
    canvasWorkspaceTemplates: [],
    canvasActivity: [],
    activeCanvasWorkspaceId: null,
    startedCanvasWorkspaceIds: [],
    mruList: [],
    sidebarExpanded: false, // 默认折叠
    sidebarWidth: 200, // 默认宽度
    terminalSidebarSections: { ...initialTerminalSidebarPreferences.sections },
    terminalSidebarFilter: initialTerminalSidebarPreferences.filter,

    // 组相关初始状态
    groups: [],
    activeGroupId: null,
    groupMruList: [],

    // 自定义分类相关初始状态（从 settings 加载）
    customCategories: [],

    // 添加窗口
    addWindow: (window) => {
      let shouldPersistChange = false;
      set((state) => {
        const existingIndex = state.windows.findIndex((item) => item.id === window.id);
        const existingWindow = existingIndex >= 0 ? state.windows[existingIndex] : undefined;
        shouldPersistChange = didPersistedWindowChange(existingWindow, window);
        if (existingIndex >= 0) {
          state.windows[existingIndex] = window;
        } else {
          state.windows.push(window);
        }

        // 添加到 MRU 列表首位
        state.mruList = [window.id, ...state.mruList.filter(id => id !== window.id)];
      });
      if (shouldPersistChange) {
        const { windows, groups, canvasWorkspaces } = get();
        triggerAutoSave(windows, groups, canvasWorkspaces);
      }
    },

    // 同步 window（存在则替换，不存在则新增）
    syncWindow: (window) => {
      let shouldPersistChange = false;
      set((state) => {
        const index = state.windows.findIndex((item) => item.id === window.id);
        const existingWindow = index >= 0 ? state.windows[index] : undefined;
        shouldPersistChange = didPersistedWindowChange(existingWindow, window);
        if (index >= 0) {
          state.windows[index] = window;
        } else {
          state.windows.push(window);
        }

        if (!state.mruList.includes(window.id)) {
          state.mruList = [window.id, ...state.mruList];
        }
      });
      if (shouldPersistChange) {
        const { windows, groups, canvasWorkspaces } = get();
        triggerAutoSave(windows, groups, canvasWorkspaces);
      }
    },

    // 删除窗口
    removeWindow: (id) => {
      let didChange = false;
      let shouldPersistChange = false;
      let removedWindowNoteWindowId: string | null = null;
      let removedWindowNotePaneIds: string[] = [];
      let removedCanvasOwnerWorkspaceId: string | null = null;
      set((state) => {
        const existingWindow = state.windows.find((window) => window.id === id);
        if (!existingWindow) {
          return;
        }

        didChange = true;
        shouldPersistChange = !existingWindow.ephemeral;
        removedWindowNoteWindowId = existingWindow.id;
        removedWindowNotePaneIds = getAllPanes(existingWindow.layout).map((pane) => pane.id);
        removedCanvasOwnerWorkspaceId = existingWindow.ownerType === 'canvas-owned'
          ? existingWindow.ownerCanvasWorkspaceId?.trim() || null
          : null;
        state.windows = state.windows.filter(w => w.id !== id);
        if (state.activeWindowId === id) {
          state.activeWindowId = null;
        }

        if (getWindowKind(existingWindow) === 'ssh') {
          const survivingClone = state.windows.find((window) => (
            window.ephemeral
            && getWindowKind(window) === 'ssh'
            && window.sshTabOwnerWindowId?.trim() === id
          ));

          if (survivingClone) {
            const nextOwnerWindowId = survivingClone.id;
            for (const window of state.windows) {
              if (
                window.ephemeral
                && getWindowKind(window) === 'ssh'
                && window.sshTabOwnerWindowId?.trim() === id
              ) {
                window.sshTabOwnerWindowId = nextOwnerWindowId;
              }
            }
          }
        }

        // 从 MRU 列表移除
        state.mruList = state.mruList.filter(wid => wid !== id);

        // 从所有分类中移除该窗口
        state.customCategories.forEach(category => {
          if (category.windowIds.includes(id)) {
            category.windowIds = category.windowIds.filter(wid => wid !== id);
            category.updatedAt = new Date().toISOString();
          }
        });

        // 从所属组中移除窗口
        const groupIndex = state.groups.findIndex(g =>
          getAllWindowIds(g.layout).includes(id)
        );
        if (groupIndex >= 0) {
          const group = state.groups[groupIndex];
          const newLayout = removeWindowFromGroupLayout(group.layout, id);
          if (!newLayout || getWindowCount(newLayout) < 2) {
            // 组内不足 2 个窗口，解散组
            state.groups.splice(groupIndex, 1);
            if (state.activeGroupId === group.id) {
              state.activeGroupId = null;
            }
            state.groupMruList = state.groupMruList.filter(gid => gid !== group.id);
          } else {
            group.layout = newLayout;
            if (group.activeWindowId === id) {
              group.activeWindowId = getAllWindowIds(newLayout)[0];
            }
          }
        }
      });

      if (removedWindowNoteWindowId !== null) {
        removePaneNotesForWindowSnapshot(removedWindowNoteWindowId, removedWindowNotePaneIds);
      }

      if (removedCanvasOwnerWorkspaceId) {
        set((state) => {
          const owningWorkspace = state.canvasWorkspaces.find((workspace) => workspace.id === removedCanvasOwnerWorkspaceId);
          if (!owningWorkspace) {
            return;
          }

          const previousBlockCount = owningWorkspace.blocks.length;
          const nextBlocks = owningWorkspace.blocks.filter((block) => (
            block.type !== 'window' || block.windowId !== id
          ));
          if (nextBlocks.length === previousBlockCount) {
            return;
          }

          const removedBlockIds = new Set(
            owningWorkspace.blocks
              .filter((block) => block.type === 'window' && block.windowId === id)
              .map((block) => block.id),
          );
          owningWorkspace.blocks = nextBlocks;
          owningWorkspace.links = (owningWorkspace.links ?? []).filter((link) => (
            !removedBlockIds.has(link.fromBlockId) && !removedBlockIds.has(link.toBlockId)
          ));
          owningWorkspace.updatedAt = new Date().toISOString();
        });
      }

      if (didChange && shouldPersistChange) {
        const { windows, groups, canvasWorkspaces, customCategories } = get();
        triggerAutoSave(windows, groups, canvasWorkspaces);
        updateSettingsCategories(customCategories).catch(error => {
          console.error('[WindowStore] Failed to save categories after window removal:', error);
        });
        return;
      }

      if (didChange) {
        const { customCategories } = get();
        updateSettingsCategories(customCategories).catch(error => {
          console.error('[WindowStore] Failed to save categories after window removal:', error);
        });
      }
    },

    // 更新窗口（支持更新多个属性）
    updateWindow: (id, updates) => {
      const updateKeys = Object.keys(updates) as Array<keyof Window>;
      if (updateKeys.length === 0) {
        return;
      }

      let didChange = false;
      set((state) => {
        const window = state.windows.find(w => w.id === id);
        if (window) {
          const hasActualChange = updateKeys.some((key) => window[key] !== updates[key]);
          if (!hasActualChange) {
            return;
          }

          didChange = true;
          Object.assign(window, updates);
          window.lastActiveAt = new Date().toISOString();
        }
      });

      if (didChange) {
        const { windows, groups, canvasWorkspaces } = get();
        triggerAutoSave(windows, groups, canvasWorkspaces);
      }
    },

    updateWindowRuntime: (id, updates) => {
      const updateKeys = Object.keys(updates) as Array<keyof Window>;
      if (updateKeys.length === 0) {
        return;
      }

      set((state) => {
        const window = state.windows.find(w => w.id === id);
        if (window) {
          const hasActualChange = updateKeys.some((key) => window[key] !== updates[key]);
          if (!hasActualChange) {
            return;
          }

          Object.assign(window, updates);
        }
      });
    },

    /**
     * @deprecated 遗留方法，会更新窗口的所有窗格状态为同一个值。
     * 请使用 updatePane 方法来更新单个窗格的状态。
     * 此方法仅为向后兼容保留，不应在新代码中使用。
     */
    updateWindowStatus: (id, status) => {
      let didChange = false;
      set((state) => {
        const window = state.windows.find(w => w.id === id);
        if (window) {
          // 更新所有窗格的状态
          const panes = getAllPanes(window.layout);
          const hasActualChange = panes.some((pane) => pane.status !== status);
          if (!hasActualChange) {
            return;
          }

          didChange = true;
          panes.forEach(pane => {
            window.layout = updatePaneInLayout(window.layout, pane.id, { status });
          });
          window.lastActiveAt = new Date().toISOString();
        }
      });

      if (didChange) {
        const { windows, groups, canvasWorkspaces } = get();
        triggerAutoSave(windows, groups, canvasWorkspaces);
      }
    },

    // 更新窗格
    updatePane: (windowId, paneId, updates) => {
      const updateKeys = Object.keys(updates);
      const isRuntimeOnlyUpdate = isRuntimeOnlyPaneUpdate(updateKeys);
      let didChange = false;
      let shouldSkipPersistence = false;

      set((state) => {
        const window = state.windows.find(w => w.id === windowId);
        if (window) {
          const paneNode = findPaneNode(window.layout, paneId);
          if (!paneNode) {
            return;
          }

          const hasActualChange = updateKeys.some((key) => {
            const paneKey = key as keyof Pane;
            return paneNode.pane[paneKey] !== updates[paneKey];
          });

          if (!hasActualChange) {
            return;
          }

          shouldSkipPersistence = isRuntimeOnlyUpdate || (
            updateKeys.length === 1
            && updateKeys[0] === 'code'
            && isRuntimeOnlyCodePaneUpdate(paneNode.pane.code, updates.code as CodePaneState | undefined)
          );
          didChange = true;
          window.layout = updatePaneInLayout(window.layout, paneId, updates);
          if (!shouldSkipPersistence) {
            window.lastActiveAt = new Date().toISOString();
          }
        }
      });

      if (didChange && !shouldSkipPersistence) {
        const { windows, groups, canvasWorkspaces } = get();
        triggerAutoSave(windows, groups, canvasWorkspaces);
      }
    },

    updatePaneRuntime: (windowId, paneId, updates) => {
      const updateKeys = Object.keys(updates);
      if (updateKeys.length === 0) {
        return;
      }

      set((state) => {
        const window = state.windows.find(w => w.id === windowId);
        if (!window) {
          return;
        }

        const paneNode = findPaneNode(window.layout, paneId);
        if (!paneNode) {
          return;
        }

        const hasActualChange = updateKeys.some((key) => {
          const paneKey = key as keyof Pane;
          return paneNode.pane[paneKey] !== updates[paneKey];
        });

        if (!hasActualChange) {
          return;
        }

        window.layout = updatePaneInLayout(window.layout, paneId, updates);
      });
    },

    clearWindowRuntimeSession: (windowId) => {
      let didChange = false;
      let shouldPersistChange = false;

      set((state) => {
        const window = state.windows.find(w => w.id === windowId);
        if (!window) {
          return;
        }

        const collapsedLayout = collapseTmuxAgentPanesForDestroyedSession(window.layout, window.activePaneId);
        if (collapsedLayout) {
          window.layout = collapsedLayout.layout;
          window.activePaneId = collapsedLayout.activePaneId;
          shouldPersistChange = true;
        }

        const panes = getAllPanes(window.layout);
        const needsSessionCleanup = panes.some((pane) => (
          pane.status !== WindowStatus.Completed
          || pane.pid !== null
          || pane.sessionId !== undefined
          || pane.lastOutput !== undefined
          || pane.tmuxScopeId !== undefined
          || isLegacyPausedStatus(pane.status)
        ));

        if (!needsSessionCleanup || panes.length === 0) {
          if (!shouldPersistChange) {
            return;
          }

          didChange = true;
          window.lastActiveAt = new Date().toISOString();
          return;
        }

        didChange = true;
        for (const pane of panes) {
          window.layout = updatePaneInLayout(window.layout, pane.id, {
            status: WindowStatus.Completed,
            pid: null,
            sessionId: undefined,
            lastOutput: undefined,
            tmuxScopeId: undefined,
          });
        }
        window.lastActiveAt = new Date().toISOString();
      });

      if (didChange) {
        const { windows, groups, canvasWorkspaces } = get();
        triggerAutoSave(windows, groups, canvasWorkspaces);
      }
    },

    // 拆分窗格
    splitPaneInWindow: (windowId, targetPaneId, direction, newPane, sizes) => {
      let didChange = false;
      set((state) => {
        const window = state.windows.find(w => w.id === windowId);
        if (window) {
          const newLayout = splitPaneInLayout(window.layout, targetPaneId, direction, newPane, false, sizes);
          if (newLayout) {
            didChange = true;
            window.layout = newLayout;
            // 保持当前激活的窗格不变，不自动切换到新窗格
            window.lastActiveAt = new Date().toISOString();
          }
        }
      });

      if (didChange) {
        const { windows, groups, canvasWorkspaces } = get();
        triggerAutoSave(windows, groups, canvasWorkspaces);
      }
    },

    placePaneInWindow: (windowId, targetPaneId, direction, newPane, insertBefore, sizes) => {
      let didChange = false;
      set((state) => {
        const window = state.windows.find(w => w.id === windowId);
        if (window) {
          const newLayout = splitPaneInLayout(window.layout, targetPaneId, direction, newPane, insertBefore, sizes);
          if (newLayout) {
            didChange = true;
            window.layout = newLayout;
            window.lastActiveAt = new Date().toISOString();
          }
        }
      });

      if (didChange) {
        const { windows, groups, canvasWorkspaces } = get();
        triggerAutoSave(windows, groups, canvasWorkspaces);
      }
    },

    movePaneInWindow: (windowId, paneId, targetPaneId, direction, insertBefore) => {
      if (paneId === targetPaneId) {
        return;
      }

      let didChange = false;
      set((state) => {
        const window = state.windows.find(w => w.id === windowId);
        if (!window) {
          return;
        }

        const newLayout = movePaneInLayout(window.layout, paneId, targetPaneId, direction, insertBefore);
        if (!newLayout || newLayout === window.layout) {
          return;
        }

        window.layout = newLayout;
        window.lastActiveAt = new Date().toISOString();
        didChange = true;
      });

      if (didChange) {
        const { windows, groups, canvasWorkspaces } = get();
        triggerAutoSave(windows, groups, canvasWorkspaces);
      }
    },

    // 关闭窗格
    closePaneInWindow: (windowId, paneId, options) => {
      // 先调用 IPC 关闭 PTY 进程
      if (options?.syncProcess !== false && window.electronAPI) {
        window.electronAPI.closePane(windowId, paneId).catch((error) => {
          console.error('Failed to close pane:', error);
        });
      }

      let didChange = false;
      set((state) => {
        const window = state.windows.find(w => w.id === windowId);
        if (window) {
          const newLayout = closePaneInLayout(window.layout, paneId);
          if (newLayout) {
            didChange = true;
            window.layout = newLayout;
            // 如果关闭的是当前激活的窗格，切换到第一个窗格
            if (window.activePaneId === paneId) {
              const panes = getAllPanes(newLayout);
              window.activePaneId = panes[0]?.id || '';
            }
            window.lastActiveAt = new Date().toISOString();
          }
        }
      });

      if (didChange) {
        const { windows, groups, canvasWorkspaces } = get();
        triggerAutoSave(windows, groups, canvasWorkspaces);
      }
    },

    updateSplitSizes: (windowId, splitPath, sizes) => {
      let didChange = false;

      set((state) => {
        const window = state.windows.find(w => w.id === windowId);
        if (!window) {
          return;
        }

        const nextLayout = updateSplitSizesInLayout(window.layout, splitPath, sizes);
        if (nextLayout === window.layout) {
          return;
        }

        didChange = true;
        window.layout = nextLayout;
        window.lastActiveAt = new Date().toISOString();
      });

      if (didChange) {
        const { windows, groups, canvasWorkspaces } = get();
        triggerAutoSave(windows, groups, canvasWorkspaces);
      }
    },

    // 设置激活的窗格
    setActivePane: (windowId, paneId) => {
      let didSetActivePane = false;
      set((state) => {
        const window = state.windows.find(w => w.id === windowId);
        if (window) {
          if (window.activePaneId === paneId) {
            return;
          }

          window.activePaneId = paneId;
          window.lastActiveAt = new Date().toISOString();
          didSetActivePane = true;
        }
      });

      if (didSetActivePane) {
        window.electronAPI?.setActivePane?.(windowId, paneId).catch((error) => {
          if (process.env.NODE_ENV === 'development') {
            console.error('Failed to sync active pane:', error);
          }
        });
      }
    },

    // 归档窗口
    archiveWindow: (id) => {
      let didArchive = false;
      set((state) => {
        const window = state.windows.find(w => w.id === id);
        if (!window || window.ephemeral || window.archived) {
          return;
        }

        didArchive = true;
        window.archived = true;
        window.lastActiveAt = new Date().toISOString();

        // 如果归档的是当前活跃窗口，清除活跃状态
        if (state.activeWindowId === id) {
          state.activeWindowId = null;
        }

        // 从所属组中移除窗口
        const groupIndex = state.groups.findIndex(g =>
          getAllWindowIds(g.layout).includes(id)
        );
        if (groupIndex >= 0) {
          const group = state.groups[groupIndex];
          const newLayout = removeWindowFromGroupLayout(group.layout, id);
          if (!newLayout || getWindowCount(newLayout) < 2) {
            // 组内不足 2 个窗口，解散组
            state.groups.splice(groupIndex, 1);
            if (state.activeGroupId === group.id) {
              state.activeGroupId = null;
            }
            state.groupMruList = state.groupMruList.filter(gid => gid !== group.id);
          } else {
            group.layout = newLayout;
            if (group.activeWindowId === id) {
              group.activeWindowId = getAllWindowIds(newLayout)[0];
            }
          }
        }
      });
      if (didArchive) {
        const { windows, groups, canvasWorkspaces } = get();
        triggerAutoSave(windows, groups, canvasWorkspaces);
      }
    },

    // 取消归档窗口
    unarchiveWindow: (id) => {
      let didChange = false;
      set((state) => {
        const window = state.windows.find(w => w.id === id);
        if (window) {
          if (!window.archived) {
            return;
          }

          didChange = true;
          window.archived = false;
          window.lastActiveAt = new Date().toISOString();
        }
      });

      if (didChange) {
        const { windows, groups, canvasWorkspaces } = get();
        triggerAutoSave(windows, groups, canvasWorkspaces);
      }
    },

    // 设置活跃窗口（与 activeGroupId 互斥）
    setActiveWindow: (id) => {
      set((state) => {
        state.activeWindowId = id;
        // 激活单窗口时清空 activeGroupId
        if (id) {
          state.activeGroupId = null;
          state.activeCanvasWorkspaceId = null;
          const window = state.windows.find(w => w.id === id);
          if (window) {
            window.lastActiveAt = new Date().toISOString();
          }
          // 更新 MRU 列表
          state.mruList = [id, ...state.mruList.filter(wid => wid !== id)];
        }
      });
    },

    // 清空所有窗口（用于工作区恢复）
    clearWindows: () => {
      const existingWindows = get().windows;
      set((state) => {
        state.windows = [];
        state.activeWindowId = null;
        state.canvasWorkspaces = [];
        state.canvasWorkspaceTemplates = [];
        state.canvasActivity = [];
        state.activeCanvasWorkspaceId = null;
        state.startedCanvasWorkspaceIds = [];
        state.mruList = [];
        state.groups = [];
        state.activeGroupId = null;
        state.groupMruList = [];
      });
      existingWindows.forEach((window) => removePaneNotesForWindow(window));
      // 不触发自动保存，因为这是恢复过程的一部分
    },

    addCanvasWorkspace: (canvasWorkspace, options) => {
      const shouldPersist = options?.persist ?? true;
      set((state) => {
        const existingIndex = state.canvasWorkspaces.findIndex((item) => item.id === canvasWorkspace.id);
        if (existingIndex >= 0) {
          state.canvasWorkspaces[existingIndex] = canvasWorkspace;
        } else {
          state.canvasWorkspaces.push(canvasWorkspace);
        }
      });

      if (shouldPersist) {
        const { windows, groups, canvasWorkspaces } = get();
        triggerAutoSave(windows, groups, canvasWorkspaces);
      }
    },

    updateCanvasWorkspace: (id, updates) => {
      let didChange = false;
      set((state) => {
        const canvasWorkspace = state.canvasWorkspaces.find((item) => item.id === id);
        if (!canvasWorkspace) {
          return;
        }

        const nextWorkspace = {
          ...canvasWorkspace,
          ...updates,
          updatedAt: updates.updatedAt ?? new Date().toISOString(),
        };
        if (JSON.stringify(canvasWorkspace) === JSON.stringify(nextWorkspace)) {
          return;
        }

        didChange = true;
        Object.assign(canvasWorkspace, nextWorkspace);
      });

      if (didChange) {
        const { windows, groups, canvasWorkspaces } = get();
        triggerAutoSave(windows, groups, canvasWorkspaces);
      }
    },

    removeCanvasWorkspace: (id) => {
      let didChange = false;
      set((state) => {
        const previousLength = state.canvasWorkspaces.length;
        state.canvasWorkspaces = state.canvasWorkspaces.filter((item) => item.id !== id);
        state.canvasActivity = state.canvasActivity.filter((item) => item.workspaceId !== id);
        state.windows = state.windows.filter((window) => window.ownerCanvasWorkspaceId !== id);
        state.startedCanvasWorkspaceIds = state.startedCanvasWorkspaceIds.filter((workspaceId) => workspaceId !== id);
        didChange = previousLength !== state.canvasWorkspaces.length;
        if (state.activeCanvasWorkspaceId === id) {
          state.activeCanvasWorkspaceId = null;
        }
      });

      if (didChange) {
        const { windows, groups, canvasWorkspaces } = get();
        triggerAutoSave(windows, groups, canvasWorkspaces);
      }
    },

    setActiveCanvasWorkspace: (id) => {
      set((state) => {
        state.activeCanvasWorkspaceId = id;
        if (id) {
          state.activeWindowId = null;
          state.activeGroupId = null;
        }
      });
    },

    setCanvasWorkspaceStarted: (id, started) => {
      set((state) => {
        const isStarted = state.startedCanvasWorkspaceIds.includes(id);
        if (started) {
          if (!isStarted) {
            state.startedCanvasWorkspaceIds.push(id);
          }
          return;
        }

        if (isStarted) {
          state.startedCanvasWorkspaceIds = state.startedCanvasWorkspaceIds.filter((workspaceId) => workspaceId !== id);
        }
      });
    },

    isCanvasWorkspaceStarted: (id) => get().startedCanvasWorkspaceIds.includes(id),

    getCanvasWorkspaceById: (id) => get().canvasWorkspaces.find((item) => item.id === id),

    setCanvasWorkspaceTemplates: (templates) => {
      set((state) => {
        state.canvasWorkspaceTemplates = templates;
      });
      const { windows, groups, canvasWorkspaces } = get();
      triggerAutoSave(windows, groups, canvasWorkspaces);
    },

    upsertCanvasWorkspaceTemplate: (template) => {
      set((state) => {
        const existingIndex = state.canvasWorkspaceTemplates.findIndex((item) => item.id === template.id);
        if (existingIndex >= 0) {
          state.canvasWorkspaceTemplates[existingIndex] = template;
        } else {
          state.canvasWorkspaceTemplates.push(template);
        }
      });
      const { windows, groups, canvasWorkspaces } = get();
      triggerAutoSave(windows, groups, canvasWorkspaces);
    },

    removeCanvasWorkspaceTemplate: (id) => {
      set((state) => {
        state.canvasWorkspaceTemplates = state.canvasWorkspaceTemplates.filter((item) => item.id !== id);
      });
      const { windows, groups, canvasWorkspaces } = get();
      triggerAutoSave(windows, groups, canvasWorkspaces);
    },

    appendCanvasActivity: (event) => {
      set((state) => {
        state.canvasActivity = [...state.canvasActivity.filter((item) => item.id !== event.id), event]
          .sort((left, right) => left.timestamp.localeCompare(right.timestamp))
          .slice(-200);
      });
      const { windows, groups, canvasWorkspaces } = get();
      triggerAutoSave(windows, groups, canvasWorkspaces);
    },

    clearCanvasActivity: (workspaceId) => {
      set((state) => {
        state.canvasActivity = workspaceId
          ? state.canvasActivity.filter((item) => item.workspaceId !== workspaceId)
          : [];
      });
      const { windows, groups, canvasWorkspaces } = get();
      triggerAutoSave(windows, groups, canvasWorkspaces);
    },

    // 更新 MRU 列表
    updateMRU: (windowId) => {
      set((state) => {
        state.mruList = [windowId, ...state.mruList.filter(id => id !== windowId)];
      });
    },

    // 获取按 MRU 排序的窗口列表
    getMRUWindows: () => {
      const { windows, mruList } = get();
      const persistableWindows = getPersistableWindows(windows);
      const windowMap = new Map(persistableWindows.map(w => [w.id, w]));
      return mruList
        .map(id => windowMap.get(id))
        .filter((w): w is Window => w !== undefined && !w.archived);
    },

    // 切换侧边栏展开/折叠
    toggleSidebar: () => {
      // 添加调试日志，帮助追踪意外的 toggle 调用
      if (process.env.NODE_ENV === 'development') {
        console.trace('[windowStore] toggleSidebar called');
      }

      set((state) => {
        state.sidebarExpanded = !state.sidebarExpanded;
      });
    },

    // 设置侧边栏宽度
    setSidebarWidth: (width) => {
      set((state) => {
        state.sidebarWidth = Math.max(150, Math.min(400, width));
      });
    },

    setTerminalSidebarSectionExpanded: (section, expanded) => {
      set((state) => {
        state.terminalSidebarSections[section] = expanded;
      });
      persistTerminalSidebarPreferences(
        get().terminalSidebarSections,
        get().terminalSidebarFilter,
      );
    },

    setTerminalSidebarFilter: (filter) => {
      set((state) => {
        state.terminalSidebarFilter = filter;
      });
      persistTerminalSidebarPreferences(
        get().terminalSidebarSections,
        get().terminalSidebarFilter,
      );
    },

    // 根据 ID 查找窗口
    getWindowById: (id) => {
      return get().windows.find(w => w.id === id);
    },

    // 根据 ID 查找窗格
    getPaneById: (windowId, paneId) => {
      const window = get().windows.find(w => w.id === windowId);
      if (!window) return undefined;
      const paneNode = findPaneNode(window.layout, paneId);
      return paneNode?.pane;
    },

    // 获取未归档的窗口
    getActiveWindows: () => {
      return getPersistableWindows(get().windows).filter(w => !w.archived);
    },

    // 获取已归档的窗口
    getArchivedWindows: () => {
      return getPersistableWindows(get().windows).filter(w => w.archived);
    },

    // 更新 Claude 模型信息
    updateClaudeModel: (windowId, model, modelId, contextPercentage, cost) => {
      set((state) => {
        const window = state.windows.find(w => w.id === windowId);
        if (window) {
          window.claudeModel = model;
          window.claudeModelId = modelId;
          window.claudeContextPercentage = contextPercentage;
          window.claudeCost = cost;
        }
      });
    },

    // ==================== 组相关 Actions ====================

    // 添加组
    addGroup: (group) => {
      set((state) => {
        state.groups.push(group);
        state.groupMruList = [group.id, ...state.groupMruList.filter(id => id !== group.id)];
      });
      triggerAutoSave(get().windows, get().groups, get().canvasWorkspaces);
    },

    // 删除组（不删除组内窗口）
    removeGroup: (id) => {
      let didChange = false;
      set((state) => {
        const existingGroup = state.groups.find((group) => group.id === id);
        if (!existingGroup) {
          return;
        }

        didChange = true;
        state.groups = state.groups.filter(g => g.id !== id);
        if (state.activeGroupId === id) {
          state.activeGroupId = null;
        }
        state.groupMruList = state.groupMruList.filter(gid => gid !== id);

        // 从所有分类中移除该组
        state.customCategories.forEach(category => {
          if (category.groupIds.includes(id)) {
            category.groupIds = category.groupIds.filter(gid => gid !== id);
            category.updatedAt = new Date().toISOString();
          }
        });
      });

      if (didChange) {
        const { windows, groups, canvasWorkspaces, customCategories } = get();
        triggerAutoSave(windows, groups, canvasWorkspaces);
        updateSettingsCategories(customCategories).catch(error => {
          console.error('[WindowStore] Failed to save categories after group removal:', error);
        });
      }
    },

    // 更新组
    updateGroup: (id, updates) => {
      const updateKeys = Object.keys(updates) as Array<keyof WindowGroup>;
      if (updateKeys.length === 0) {
        return;
      }

      let didChange = false;
      set((state) => {
        const group = state.groups.find(g => g.id === id);
        if (group) {
          const hasActualChange = updateKeys.some((key) => group[key] !== updates[key]);
          if (!hasActualChange) {
            return;
          }

          didChange = true;
          Object.assign(group, updates);
          group.lastActiveAt = new Date().toISOString();
        }
      });

      if (didChange) {
        triggerAutoSave(get().windows, get().groups, get().canvasWorkspaces);
      }
    },

    // 归档组
    archiveGroup: (id) => {
      let didChange = false;
      set((state) => {
        const group = state.groups.find(g => g.id === id);
        if (group) {
          if (group.archived) {
            return;
          }

          didChange = true;
          group.archived = true;
          group.lastActiveAt = new Date().toISOString();

          // 归档组内所有窗口
          const windowIds = getAllWindowIds(group.layout);
          windowIds.forEach(windowId => {
            const window = state.windows.find(w => w.id === windowId);
            if (window && !window.archived) {
              window.archived = true;
              window.lastActiveAt = new Date().toISOString();
            }
          });
        }
        if (state.activeGroupId === id) {
          state.activeGroupId = null;
        }
      });

      if (didChange) {
        triggerAutoSave(get().windows, get().groups, get().canvasWorkspaces);
      }
    },

    // 取消归档组
    unarchiveGroup: (id) => {
      let didChange = false;
      set((state) => {
        const group = state.groups.find(g => g.id === id);
        if (group) {
          if (!group.archived) {
            return;
          }

          didChange = true;
          group.archived = false;
          group.lastActiveAt = new Date().toISOString();

          // 取消归档组内所有窗口
          const windowIds = getAllWindowIds(group.layout);
          windowIds.forEach(windowId => {
            const window = state.windows.find(w => w.id === windowId);
            if (window && window.archived) {
              window.archived = false;
              window.lastActiveAt = new Date().toISOString();
            }
          });
        }
      });

      if (didChange) {
        triggerAutoSave(get().windows, get().groups, get().canvasWorkspaces);
      }
    },

    // 设置活跃组（与 activeWindowId 互斥）
    setActiveGroup: (id) => {
      set((state) => {
        state.activeGroupId = id;
        // 激活组时清空 activeWindowId
        if (id) {
          state.activeWindowId = null;
          const group = state.groups.find(g => g.id === id);
          if (group) {
            group.lastActiveAt = new Date().toISOString();
          }
          state.groupMruList = [id, ...state.groupMruList.filter(gid => gid !== id)];
        }
      });
    },

    // 清空所有组
    clearGroups: () => {
      set((state) => {
        state.groups = [];
        state.activeGroupId = null;
        state.groupMruList = [];
      });
    },

    // ==================== 组布局操作 ====================

    // 添加窗口到组布局
    addWindowToGroupLayout: (groupId, targetWindowId, newWindowId, direction) => {
      let didChange = false;
      set((state) => {
        const group = state.groups.find(g => g.id === groupId);
        if (!group) {
          return;
        }

        // 如果布局是单个窗口节点，创建拆分
        if (group.layout.type === 'window') {
          if (group.layout.id === targetWindowId) {
            group.layout = {
              type: 'split',
              direction,
              sizes: [0.5, 0.5],
              children: [
                group.layout,
                { type: 'window', id: newWindowId },
              ],
            };
            didChange = true;
          }
        } else {
          // 使用工具函数在布局树中添加
          const newLayout = addWindowToGroupInLayout(group.layout, targetWindowId, newWindowId, direction);
          if (newLayout) {
            group.layout = newLayout;
            didChange = true;
          }
        }
        if (didChange) {
          group.lastActiveAt = new Date().toISOString();
        }
      });

      if (didChange) {
        triggerAutoSave(get().windows, get().groups, get().canvasWorkspaces);
      }
    },

    // 从组中移除窗口
    removeWindowFromGroupLayout: (groupId, windowId) => {
      let didChange = false;
      set((state) => {
        const groupIndex = state.groups.findIndex(g => g.id === groupId);
        if (groupIndex < 0) {
          return;
        }

        const group = state.groups[groupIndex];
        const newLayout = removeWindowFromGroupLayout(group.layout, windowId);

        if (!newLayout || getWindowCount(newLayout) < 2) {
          // 组内不足 2 个窗口，解散组
          state.groups.splice(groupIndex, 1);
          didChange = true;
          if (state.activeGroupId === groupId) {
            state.activeGroupId = null;
          }
          state.groupMruList = state.groupMruList.filter(gid => gid !== groupId);
        } else {
          group.layout = newLayout;
          didChange = true;
          if (group.activeWindowId === windowId) {
            group.activeWindowId = getAllWindowIds(newLayout)[0];
          }
          group.lastActiveAt = new Date().toISOString();
        }
      });

      if (didChange) {
        triggerAutoSave(get().windows, get().groups, get().canvasWorkspaces);
      }
    },

    // 组内窗口重新排列（原子操作，避免中间状态触发解散）
    rearrangeWindowInGroupLayout: (groupId, dragWindowId, targetWindowId, direction, insertBefore) => {
      if (dragWindowId === targetWindowId) {
        return;
      }

      let didChange = false;
      set((state) => {
        const group = state.groups.find(g => g.id === groupId);
        if (!group) return;

        // 先移除拖拽的窗口
        const layoutAfterRemove = removeWindowFromGroupLayout(group.layout, dragWindowId);
        if (!layoutAfterRemove) return;

        // 再添加到目标位置
        const finalLayout = addWindowToGroupInLayout(layoutAfterRemove, targetWindowId, dragWindowId, direction, insertBefore);
        if (!finalLayout) return;

        group.layout = finalLayout;
        group.lastActiveAt = new Date().toISOString();
        didChange = true;
      });

      if (didChange) {
        triggerAutoSave(get().windows, get().groups, get().canvasWorkspaces);
      }
    },

    // 更新组布局的 split sizes
    updateGroupSplitSizes: (groupId, splitPath, sizes) => {
      let didChange = false;

      set((state) => {
        const group = state.groups.find(g => g.id === groupId);
        if (!group) return;

        const nextLayout = updateGroupSplitSizesInLayout(group.layout, splitPath, sizes);
        if (nextLayout === group.layout) return;

        didChange = true;
        group.layout = nextLayout;
        group.lastActiveAt = new Date().toISOString();
      });

      if (didChange) {
        const { windows, groups, canvasWorkspaces } = get();
        triggerAutoSave(windows, groups, canvasWorkspaces);
      }
    },

    // 设置组内激活的窗口
    setActiveWindowInGroup: (groupId, windowId) => {
      set((state) => {
        const group = state.groups.find(g => g.id === groupId);
        if (group) {
          group.activeWindowId = windowId;
          group.lastActiveAt = new Date().toISOString();
        }
      });
    },

    // ==================== 组 MRU 相关 ====================

    // 更新组 MRU 列表
    updateGroupMRU: (groupId) => {
      set((state) => {
        state.groupMruList = [groupId, ...state.groupMruList.filter(id => id !== groupId)];
      });
    },

    // 获取按 MRU 排序的组列表
    getMRUGroups: () => {
      const { groups, groupMruList } = get();
      const groupMap = new Map(groups.map(g => [g.id, g]));
      return groupMruList
        .map(id => groupMap.get(id))
        .filter((g): g is WindowGroup => g !== undefined && !g.archived);
    },

    // ==================== 组辅助方法 ====================

    // 根据 ID 查找组
    getGroupById: (id) => {
      return get().groups.find(g => g.id === id);
    },

    // 获取组内的所有窗口
    getWindowsInGroup: (groupId) => {
      const { groups, windows } = get();
      const group = groups.find(g => g.id === groupId);
      if (!group) return [];

      const windowIds = getAllWindowIds(group.layout);
      const windowMap = new Map(windows.map(w => [w.id, w]));
      return windowIds
        .map(id => windowMap.get(id))
        .filter((w): w is Window => w !== undefined);
    },

    // 获取未归档的组
    getActiveGroups: () => {
      return get().groups.filter(g => !g.archived);
    },

    // 获取已归档的组
    getArchivedGroups: () => {
      return get().groups.filter(g => g.archived);
    },

    // 查找包含指定窗口的组
    findGroupByWindowId: (windowId) => {
      return get().groups.find(g =>
        getAllWindowIds(g.layout).includes(windowId)
      );
    },

    // ==================== 自定义分类相关 Actions ====================

    /**
     * 从 settings 同步分类数据
     * 在应用启动或 settings 更新时调用
     */
    syncCustomCategories: (categories) => {
      set((state) => {
        state.customCategories = categories;
      });
    },

    /**
     * 添加自定义分类
     * @param category 分类信息（不包含 id、createdAt、updatedAt）
     * @returns 新创建的分类 ID
     */
    addCustomCategory: async (category) => {
      const now = new Date().toISOString();
      const newCategory: CustomCategory = {
        ...category,
        id: crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,
      };

      // 更新本地状态
      set((state) => {
        state.customCategories.push(newCategory);
      });

      // 保存到 settings
      await updateSettingsCategories(get().customCategories);

      return newCategory.id;
    },

    /**
     * 更新自定义分类
     * @param id 分类 ID
     * @param updates 要更新的字段
     */
    updateCustomCategory: async (id, updates) => {
      const category = get().customCategories.find(c => c.id === id);
      if (!category) {
        console.warn(`[WindowStore] Category not found: ${id}`);
        return;
      }

      set((state) => {
        const index = state.customCategories.findIndex(c => c.id === id);
        if (index >= 0) {
          state.customCategories[index] = {
            ...state.customCategories[index],
            ...updates,
            updatedAt: new Date().toISOString(),
          };
        }
      });

      // 保存到 settings
      await updateSettingsCategories(get().customCategories);
    },

    /**
     * 删除自定义分类
     * @param id 分类 ID
     */
    removeCustomCategory: async (id) => {
      set((state) => {
        state.customCategories = state.customCategories.filter(c => c.id !== id);
        // 同时删除所有子分类
        state.customCategories = state.customCategories.filter(c => c.parentId !== id);
      });

      // 保存到 settings
      await updateSettingsCategories(get().customCategories);
    },

    /**
     * 添加窗口到分类
     * @param categoryId 分类 ID
     * @param windowId 窗口 ID
     */
    addWindowToCategory: async (categoryId, windowId) => {
      const category = get().customCategories.find(c => c.id === categoryId);
      if (!category) {
        console.warn(`[WindowStore] Category not found: ${categoryId}`);
        return;
      }

      // 检查窗口是否存在
      const window = get().windows.find(w => w.id === windowId);
      if (!window) {
        console.warn(`[WindowStore] Window not found: ${windowId}`);
        return;
      }

      // 检查是否已存在
      if (category.windowIds.includes(windowId)) {
        return;
      }

      set((state) => {
        const index = state.customCategories.findIndex(c => c.id === categoryId);
        if (index >= 0) {
          state.customCategories[index].windowIds.push(windowId);
          state.customCategories[index].updatedAt = new Date().toISOString();
        }
      });

      // 保存到 settings
      await updateSettingsCategories(get().customCategories);
    },

    /**
     * 从分类中移除窗口
     * @param categoryId 分类 ID
     * @param windowId 窗口 ID
     */
    removeWindowFromCategory: async (categoryId, windowId) => {
      set((state) => {
        const index = state.customCategories.findIndex(c => c.id === categoryId);
        if (index >= 0) {
          state.customCategories[index].windowIds = state.customCategories[index].windowIds.filter(
            id => id !== windowId
          );
          state.customCategories[index].updatedAt = new Date().toISOString();
        }
      });

      // 保存到 settings
      await updateSettingsCategories(get().customCategories);
    },

    /**
     * 添加 SSH 配置到分类
     * @param categoryId 分类 ID
     * @param profileId SSH 配置 ID
     */
    addSSHProfileToCategory: async (categoryId, profileId) => {
      const category = get().customCategories.find(c => c.id === categoryId);
      if (!category) {
        console.warn(`[WindowStore] Category not found: ${categoryId}`);
        return;
      }

      if ((category.sshProfileIds ?? []).includes(profileId)) {
        return;
      }

      set((state) => {
        const index = state.customCategories.findIndex(c => c.id === categoryId);
        if (index >= 0) {
          const sshProfileIds = state.customCategories[index].sshProfileIds ?? [];
          state.customCategories[index].sshProfileIds = [...sshProfileIds, profileId];
          state.customCategories[index].updatedAt = new Date().toISOString();
        }
      });

      await updateSettingsCategories(get().customCategories);
    },

    /**
     * 从分类中移除 SSH 配置
     * @param categoryId 分类 ID
     * @param profileId SSH 配置 ID
     */
    removeSSHProfileFromCategory: async (categoryId, profileId) => {
      set((state) => {
        const index = state.customCategories.findIndex(c => c.id === categoryId);
        if (index >= 0) {
          state.customCategories[index].sshProfileIds = (state.customCategories[index].sshProfileIds ?? []).filter(
            id => id !== profileId
          );
          state.customCategories[index].updatedAt = new Date().toISOString();
        }
      });

      await updateSettingsCategories(get().customCategories);
    },

    /**
     * 添加组到分类
     * @param categoryId 分类 ID
     * @param groupId 组 ID
     */
    addGroupToCategory: async (categoryId, groupId) => {
      const category = get().customCategories.find(c => c.id === categoryId);
      if (!category) {
        console.warn(`[WindowStore] Category not found: ${categoryId}`);
        return;
      }

      // 检查组是否存在
      const group = get().groups.find(g => g.id === groupId);
      if (!group) {
        console.warn(`[WindowStore] Group not found: ${groupId}`);
        return;
      }

      // 检查是否已存在
      if (category.groupIds.includes(groupId)) {
        return;
      }

      set((state) => {
        const index = state.customCategories.findIndex(c => c.id === categoryId);
        if (index >= 0) {
          state.customCategories[index].groupIds.push(groupId);
          state.customCategories[index].updatedAt = new Date().toISOString();
        }
      });

      // 保存到 settings
      await updateSettingsCategories(get().customCategories);
    },

    /**
     * 从分类中移除组
     * @param categoryId 分类 ID
     * @param groupId 组 ID
     */
    removeGroupFromCategory: async (categoryId, groupId) => {
      set((state) => {
        const index = state.customCategories.findIndex(c => c.id === categoryId);
        if (index >= 0) {
          state.customCategories[index].groupIds = state.customCategories[index].groupIds.filter(
            id => id !== groupId
          );
          state.customCategories[index].updatedAt = new Date().toISOString();
        }
      });

      // 保存到 settings
      await updateSettingsCategories(get().customCategories);
    },

    // ==================== 自定义分类辅助方法 ====================

    /**
     * 获取所有自定义分类
     * @returns 分类列表（按 order 排序）
     */
    getCustomCategories: () => {
      return [...get().customCategories].sort((a, b) => a.order - b.order);
    },

    /**
     * 根据 ID 获取分类
     * @param id 分类 ID
     * @returns 分类对象，如果不存在则返回 undefined
     */
    getCategoryById: (id) => {
      return get().customCategories.find(c => c.id === id);
    },

    /**
     * 获取窗口所属的所有分类
     * @param windowId 窗口 ID
     * @returns 包含该窗口的所有分类
     */
    getWindowCategories: (windowId) => {
      return get().customCategories.filter(c => c.windowIds.includes(windowId));
    },

    /**
     * 获取 SSH 配置所属的所有分类
     * @param profileId SSH 配置 ID
     * @returns 包含该 SSH 配置的所有分类
     */
    getSSHProfileCategories: (profileId) => {
      return get().customCategories.filter(c => (c.sshProfileIds ?? []).includes(profileId));
    },

    /**
     * 获取组所属的所有分类
     * @param groupId 组 ID
     * @returns 包含该组的所有分类
     */
    getGroupCategories: (groupId) => {
      return get().customCategories.filter(c => c.groupIds.includes(groupId));
    },
  }))
);

// Re-export types for convenience
export type { Window };
export type { WindowGroup } from '../../shared/types/window-group';
export { WindowStatus } from '../types/window';
