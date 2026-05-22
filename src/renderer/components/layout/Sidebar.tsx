import React, { Suspense, lazy, useState, useEffect, useMemo, useRef } from 'react';
import { Plus, Settings, HelpCircle, Archive, FolderPlus, Search, X, Trash2, Terminal, Compass, Folder, Grid, Orbit, ChevronRight, ChevronDown, Tag, Check, Edit2 } from 'lucide-react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { StatusBar } from '../StatusBar';
import { BatchCreateWindowDialog } from '../BatchCreateWindowDialog';
import { ConfirmDialog } from '../ConfirmDialog';
import { CategoryDropZone } from '../dnd/CategoryDropZone';
import { CustomCategory } from '../../../shared/types/custom-category';
import { SSHCredentialState, SSHProfile } from '../../../shared/types/ssh';
import { useWindowStore } from '../../stores/windowStore';
import { useI18n } from '../../i18n';
import { getStandalonePersistableWindows, getStandaloneSSHProfileId, isEphemeralSSHCloneWindow } from '../../utils/sshWindowBindings';
import { getAllWindowIds } from '../../utils/groupLayoutHelpers';
import { TerminalTypeLogo } from '../icons/TerminalTypeLogo';
import { getWindowKind } from '../../../shared/utils/terminalCapabilities';
import { getSidebarCardCounts } from '../../utils/cardCollection';
import { getRecentTerminalWindows } from '../../utils/recentTerminals';
import { destroySSHWindowFamilyResources, destroyWindowResourcesAndRemoveRecord } from '../../utils/windowDestruction';
import {
  idePopupInputClassName,
  idePopupSecondaryButtonClassName,
  idePopupSurfaceClassName,
} from '../ui/ide-popup';

const LazySettingsPanel = lazy(async () => ({
  default: (await import('../SettingsPanel')).SettingsPanel,
}));

const LazyQuickNavPanel = lazy(async () => ({
  default: (await import('../QuickNavPanel')).QuickNavPanel,
}));

const LazyAboutPanel = lazy(async () => ({
  default: (await import('../AboutPanel')).AboutPanel,
}));

interface SidebarProps {
  appName?: string;
  version?: string;
  onCreateWindow?: () => void;
  onCreateGroup?: () => void;
  sshEnabled?: boolean;
  sshProfileCount?: number;
  sshProfiles?: SSHProfile[];
  onSSHProfileSaved?: (profile: SSHProfile, credentialState: SSHCredentialState) => void;
  currentTab?: 'all' | 'active' | 'archived' | string;
  recentTerminalLimit?: number;
  onTabChange?: (tab: 'all' | 'active' | 'archived' | string) => void;
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
}

export function Sidebar({
  appName = 'Synapse',
  version = '0.1.0',
  onCreateWindow,
  onCreateGroup,
  sshEnabled = false,
  sshProfiles = [],
  onSSHProfileSaved,
  currentTab = 'active',
  recentTerminalLimit,
  onTabChange,
  searchQuery = '',
  onSearchChange,
}: SidebarProps) {
  const { t } = useI18n();
  const windows = useWindowStore((state) => state.windows);
  const groups = useWindowStore((state) => state.groups);
  const canvasWorkspaces = useWindowStore((state) => state.canvasWorkspaces);
  const mruList = useWindowStore((state) => state.mruList);
  const addWindow = useWindowStore((state) => state.addWindow);
  const customCategories = useWindowStore((state) => state.customCategories);
  const syncCustomCategories = useWindowStore((state) => state.syncCustomCategories);
  const addCustomCategory = useWindowStore((state) => state.addCustomCategory);
  const updateCustomCategory = useWindowStore((state) => state.updateCustomCategory);
  const removeCustomCategory = useWindowStore((state) => state.removeCustomCategory);
  const persistableWindows = useMemo(() => getStandalonePersistableWindows(windows), [windows]);

  const activeWindows = persistableWindows.filter(w => !w.archived);
  const archivedWindows = persistableWindows.filter(w => w.archived);
  const groupedWindowIds = useMemo(
    () => new Set(groups.flatMap((group) => getAllWindowIds(group.layout))),
    [groups],
  );
  const visibleActiveWindows = useMemo(
    () => activeWindows.filter((window) => !groupedWindowIds.has(window.id)),
    [activeWindows, groupedWindowIds],
  );
  const recentActiveWindows = useMemo(
    () => getRecentTerminalWindows(visibleActiveWindows, mruList, recentTerminalLimit),
    [mruList, recentTerminalLimit, visibleActiveWindows],
  );
  const localActiveWindows = activeWindows.filter(w => getWindowKind(w) !== 'ssh');
  const sshActiveWindows = sshEnabled
    ? activeWindows.filter((window) => getWindowKind(window) === 'ssh')
    : [];
  const counts = useMemo(
    () => getSidebarCardCounts(windows, groups, canvasWorkspaces, { sshEnabled, sshProfiles }),
    [canvasWorkspaces, groups, sshEnabled, sshProfiles, windows],
  );
  const allCount = counts.all;
  const activeCount = recentActiveWindows.length;
  const archivedCount = counts.archived;
  const localCount = counts.local;
  const sshCount = counts.ssh;
  const canvasCount = counts.canvas;
  const [isBatchDialogOpen, setIsBatchDialogOpen] = useState(false);
  const [isConfirmDialogOpen, setIsConfirmDialogOpen] = useState(false);
  const [isSettingsPanelOpen, setIsSettingsPanelOpen] = useState(false);
  const [hasMountedSettingsPanel, setHasMountedSettingsPanel] = useState(false);
  const [isQuickNavPanelOpen, setIsQuickNavPanelOpen] = useState(false);
  const [isAboutPanelOpen, setIsAboutPanelOpen] = useState(false);
  const [categoryToDelete, setCategoryToDelete] = useState<CustomCategory | null>(null);

  // 自定义分类折叠/展开
  const [customExpanded, setCustomExpanded] = useState(true);
  // 内联创建分类
  const [isCreatingCategory, setIsCreatingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const createInputRef = useRef<HTMLInputElement>(null);
  // 内联编辑分类
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);
  const sidebarTooltipClass = `${idePopupSurfaceClassName} z-[1100] rounded px-2 py-1 text-xs text-[rgb(var(--foreground))] shadow-xl`;
  const sidebarInputClass = `${idePopupInputClassName} rounded-md px-2 py-1.5 text-[rgb(var(--foreground))] focus:ring-1 focus:ring-[rgb(var(--ring))] focus:border-transparent`;
  const sidebarInlineInputClass = `${idePopupInputClassName} rounded px-1.5 py-0.5 text-sm focus:border-[rgb(var(--ring))] focus:ring-0`;
  const sidebarIconButtonClass = 'rounded transition-colors text-[rgb(var(--muted-foreground))] hover:text-[rgb(var(--foreground))]';
  const sidebarTabIconSlotClass = 'inline-flex h-6 w-6 shrink-0 items-center justify-center';

  // 从 settings 同步分类数据
  useEffect(() => {
    const loadCategories = async () => {
      try {
        const response = await window.electronAPI.getSettings();
        if (response.success && response.data?.customCategories) {
          syncCustomCategories(response.data.customCategories);
        }
      } catch (error) {
        console.error('Failed to load custom categories:', error);
      }
    };
    loadCategories();
  }, [syncCustomCategories]);

  // 获取顶级分类（没有父分类的）
  const topLevelCategories = customCategories
    .filter(c => !c.parentId)
    .sort((a, b) => a.order - b.order);

  // 创建分类时自动聚焦
  useEffect(() => {
    if (isCreatingCategory && createInputRef.current) {
      createInputRef.current.focus();
    }
  }, [isCreatingCategory]);

  // 编辑分类时自动聚焦
  useEffect(() => {
    if (editingCategoryId && editInputRef.current) {
      editInputRef.current.focus();
    }
  }, [editingCategoryId]);

  const handleCreateCategory = async () => {
    const name = newCategoryName.trim();
    if (!name) return;
    try {
      await addCustomCategory({
        name,
        icon: '📌',
        windowIds: [],
        groupIds: [],
        sshProfileIds: [],
        order: topLevelCategories.length,
      });
      setNewCategoryName('');
      setIsCreatingCategory(false);
    } catch (error) {
      console.error('Failed to create category:', error);
    }
  };

  const handleStartEdit = (category: CustomCategory) => {
    setEditingCategoryId(category.id);
    setEditName(category.name);
  };

  const handleSaveEdit = async () => {
    if (!editingCategoryId) return;
    const name = editName.trim();
    if (!name) {
      setEditingCategoryId(null);
      return;
    }
    try {
      await updateCustomCategory(editingCategoryId, { name });
      setEditingCategoryId(null);
    } catch (error) {
      console.error('Failed to update category:', error);
    }
  };

  const handleBatchCreate = async (selectedPaths: string[]) => {
    for (const path of selectedPaths) {
      try {
        const result = await window.electronAPI.createWindow({
          workingDirectory: path,
        });

        if (result.success && result.data) {
          addWindow(result.data);
        } else if (result.error) {
          console.error(`Failed to create window for ${path}:`, result.error);
        }
      } catch (error) {
        console.error(`Failed to create window for ${path}:`, error);
      }
    }
  };

  const removeWindowRecords = async (windowIds: string[]) => {
    const uniqueWindowIds = Array.from(new Set(windowIds));

    for (const windowId of uniqueWindowIds) {
      const win = useWindowStore.getState().windows.find((window) => window.id === windowId);
      if (!win || win.ephemeral) {
        continue;
      }

      if (getWindowKind(win) === 'ssh') {
        await destroySSHWindowFamilyResources(win, {
          removeTargetRecord: true,
          includeOwnedClones: true,
        });
        continue;
      }

      await destroyWindowResourcesAndRemoveRecord(win.id);
    }
  };

  const handleClearActiveWindows = async () => {
    try {
      await removeWindowRecords(recentActiveWindows.map((window) => window.id));
    } catch (error) {
      console.error('Failed to clear active windows:', error);
    }
  };

  const handleClearArchivedWindows = async () => {
    try {
      await removeWindowRecords(archivedWindows.map((window) => window.id));
    } catch (error) {
      console.error('Failed to clear archived windows:', error);
    }
  };

  const handleClearAllWindows = async () => {
    try {
      await removeWindowRecords(persistableWindows.map((window) => window.id));
    } catch (error) {
      console.error('Failed to clear all windows:', error);
    }
  };

  const handleClearLocalWindows = async () => {
    try {
      await removeWindowRecords(localActiveWindows.map((window) => window.id));
    } catch (error) {
      console.error('Failed to clear local windows:', error);
    }
  };

  const handleClearSSHWindows = async () => {
    try {
      await removeWindowRecords(sshActiveWindows.map((window) => window.id));
    } catch (error) {
      console.error('Failed to clear SSH windows:', error);
    }
  };

  // 根据当前标签获取清空函数和窗口数量
  const getClearHandler = () => {
    if (currentTab === 'active') {
      return { handler: handleClearActiveWindows, count: recentActiveWindows.length };
    } else if (currentTab === 'archived') {
      return { handler: handleClearArchivedWindows, count: archivedWindows.length };
    } else if (currentTab === 'all') {
      return { handler: handleClearAllWindows, count: persistableWindows.length };
    } else if (currentTab === 'local') {
      return { handler: handleClearLocalWindows, count: localActiveWindows.length };
    } else if (currentTab === 'ssh') {
      return { handler: handleClearSSHWindows, count: sshActiveWindows.length };
    }
    return { handler: null, count: 0 };
  };

  /** 计算分类中的有效项目数 */
  const getCategoryCount = (category: CustomCategory) => {
    const validWindowIds = category.windowIds.filter(id => windows.some(w => w.id === id));
    const profileIdsFromWindows = new Set(
      validWindowIds
        .map((id) => {
          const windowItem = windows.find((window) => window.id === id);
          return windowItem ? getStandaloneSSHProfileId(windowItem) : null;
        })
        .filter((id): id is string => Boolean(id)),
    );
    const wCount = validWindowIds.length;
    const gCount = category.groupIds.filter(id => groups.some(g => g.id === id)).length;
    const sCount = (category.sshProfileIds ?? []).filter((id) => (
      sshProfiles.some((profile) => profile.id === id) && !profileIdsFromWindows.has(id)
    )).length;
    return wCount + gCount + sCount;
  };

  return (
    <>
      <aside
        className="w-64 h-full border-r border-[rgb(var(--border))] flex flex-col"
        style={{
          background: 'var(--appearance-sidebar-surface-background)',
          backdropFilter: 'blur(12px)',
        }}
      >
        {/* 顶部间距，与右侧卡片对齐 */}
        <div className="h-4" />

        {/* 搜索框 - 全局搜索，始终显示 */}
        {(allCount > 0) && (
          <div className="px-4 pb-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[rgb(var(--muted-foreground))]" size={14} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => onSearchChange?.(e.target.value)}
                placeholder={t('common.searchWindows')}
                className={`w-full pl-8 pr-7 py-1.5 text-sm ${sidebarInputClass}`}
              />
              {searchQuery && (
                <Tooltip.Provider>
                  <Tooltip.Root delayDuration={300}>
                    <Tooltip.Trigger asChild>
                      <button
                        onClick={() => onSearchChange?.('')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-[rgb(var(--muted-foreground))] hover:text-[rgb(var(--foreground))] transition-colors"
                      >
                        <X size={12} />
                      </button>
                    </Tooltip.Trigger>
                    <Tooltip.Portal>
                      <Tooltip.Content className={sidebarTooltipClass} side="top" sideOffset={5}>
                        {t('common.clearSearch')}
                      </Tooltip.Content>
                    </Tooltip.Portal>
                  </Tooltip.Root>
                </Tooltip.Provider>
              )}
            </div>
          </div>
        )}

        {/* 状态分类 */}
        <div className="px-4 py-4 border-b border-[rgb(var(--border))]">
          <h3 className="text-xs font-semibold text-[rgb(var(--muted-foreground))] tracking-wide mb-3" style={{ letterSpacing: '0.05em' }}>
            {t('sidebar.section.statusSummary')}
          </h3>
          <StatusBar
            currentTab={currentTab}
            onTabChange={onTabChange}
            sshEnabled={sshEnabled}
            sshProfiles={sshProfiles}
          />
        </div>

        {/* 窗格管理 */}
        <div className="flex-1 px-4 py-4 overflow-y-auto border-b border-[rgb(var(--border))]">
          <h3 className="text-xs font-semibold text-[rgb(var(--muted-foreground))] tracking-wide mb-3 flex items-center justify-between" style={{ letterSpacing: '0.05em' }}>
            <span>{t('sidebar.section.windowManagement')}</span>
          </h3>
          {/* Tab buttons */}
          <div className="flex flex-col gap-2">
            <button
              onClick={() => onTabChange?.('active')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors ${
                currentTab === 'active'
                  ? 'bg-[rgb(var(--accent))] text-[rgb(var(--primary))] font-medium'
                  : 'text-[rgb(var(--foreground))] hover:bg-[rgb(var(--accent))]'
              }`}
            >
              <span aria-hidden="true" className={sidebarTabIconSlotClass}>
                <Terminal className="h-4 w-4 shrink-0" />
              </span>
              <span>{t('sidebar.tab.active')}</span>
              {activeCount > 0 && (
                <span className="ml-auto text-xs">{activeCount}</span>
              )}
            </button>

            {/* 本地终端 */}
            <button
              onClick={() => onTabChange?.('local')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors ${
                currentTab === 'local'
                  ? 'bg-[rgb(var(--accent))] text-[rgb(var(--primary))] font-medium'
                  : 'text-[rgb(var(--foreground))] hover:bg-[rgb(var(--accent))]'
              }`}
            >
              <span aria-hidden="true" className={sidebarTabIconSlotClass}>
                <TerminalTypeLogo variant="local" size="xs" />
              </span>
              <span>{t('sidebar.tab.local')}</span>
              {localCount > 0 && (
                <span className="ml-auto text-xs">{localCount}</span>
              )}
            </button>

            {/* 远程终端 */}
            <button
              onClick={() => onTabChange?.('ssh')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors ${
                currentTab === 'ssh'
                  ? 'bg-[rgb(var(--accent))] text-[rgb(var(--primary))] font-medium'
                  : 'text-[rgb(var(--foreground))] hover:bg-[rgb(var(--accent))]'
              }`}
            >
              <span aria-hidden="true" className={sidebarTabIconSlotClass}>
                <TerminalTypeLogo variant="ssh" size="xs" />
              </span>
              <span>{t('sidebar.tab.ssh')}</span>
              {sshCount > 0 && (
                <span className="ml-auto text-xs">{sshCount}</span>
              )}
            </button>

            <button
              onClick={() => onTabChange?.('canvas')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors ${
                currentTab === 'canvas'
                  ? 'bg-[rgb(var(--accent))] text-[rgb(var(--primary))] font-medium'
                  : 'text-[rgb(var(--foreground))] hover:bg-[rgb(var(--accent))]'
              }`}
            >
              <span aria-hidden="true" className={sidebarTabIconSlotClass}>
                <Orbit className="h-4 w-4 shrink-0" />
              </span>
              <span>{t('sidebar.tab.canvas')}</span>
              {canvasCount > 0 && (
                <span className="ml-auto text-xs">{canvasCount}</span>
              )}
            </button>

            <button
              onClick={() => onTabChange?.('archived')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors ${
                currentTab === 'archived'
                  ? 'bg-[rgb(var(--accent))] text-[rgb(var(--primary))] font-medium'
                  : 'text-[rgb(var(--foreground))] hover:bg-[rgb(var(--accent))]'
              }`}
            >
              <span aria-hidden="true" className={sidebarTabIconSlotClass}>
                <Archive className="h-4 w-4 shrink-0" />
              </span>
              <span>{t('sidebar.tab.archived')}</span>
              {archivedCount > 0 && (
                <span className="ml-auto text-xs">{archivedCount}</span>
              )}
            </button>
            <button
              onClick={() => onTabChange?.('all')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors ${
                currentTab === 'all'
                  ? 'bg-[rgb(var(--accent))] text-[rgb(var(--primary))] font-medium'
                  : 'text-[rgb(var(--foreground))] hover:bg-[rgb(var(--accent))]'
              }`}
            >
              <span aria-hidden="true" className={sidebarTabIconSlotClass}>
                <Grid className="h-4 w-4 shrink-0" />
              </span>
              <span>{t('sidebar.tab.all')}</span>
              {allCount > 0 && (
                <span className="ml-auto text-xs">{allCount}</span>
              )}
            </button>
          </div>

          {/* 分隔线 */}
          <div className="my-3 border-t border-[rgb(var(--border))]" />

          {/* 可折叠的自定义分类区域 */}
          <div className="flex flex-col">
            {/* 自定义主菜单按钮 */}
            <button
              onClick={() => setCustomExpanded(!customExpanded)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm text-[rgb(var(--foreground))] hover:bg-[rgb(var(--accent))] transition-colors"
            >
              {customExpanded ? (
                <ChevronDown className="h-4 w-4 flex-shrink-0" />
              ) : (
                <ChevronRight className="h-4 w-4 flex-shrink-0" />
              )}
              <Tag className="h-4 w-4 flex-shrink-0" />
              <span className="font-medium">{t('sidebar.customCategories')}</span>
              {topLevelCategories.length > 0 && (
                <span className="ml-auto text-xs text-[rgb(var(--muted-foreground))]">{topLevelCategories.length}</span>
              )}
            </button>

            {/* 展开后的子分类列表 */}
            {customExpanded && (
              <div className="flex flex-col gap-0.5 mt-1">
                {topLevelCategories.map((category) => (
                  <CategoryDropZone
                    key={category.id}
                    categoryId={category.id}
                    windowIds={category.windowIds}
                    groupIds={category.groupIds}
                    sshProfileIds={category.sshProfileIds ?? []}
                  >
                    <div
                      className={`flex items-center gap-2 pl-8 pr-2 py-1.5 rounded-lg text-sm transition-colors cursor-pointer group ${
                        currentTab === category.id
                          ? 'bg-[rgb(var(--accent))] text-[rgb(var(--primary))] font-medium'
                          : 'text-[rgb(var(--foreground))] hover:bg-[rgb(var(--accent))]'
                      }`}
                      onClick={() => onTabChange?.(category.id)}
                    >
                      {/* 图标和名称（或编辑输入框） */}
                      {editingCategoryId === category.id ? (
                        <>
                          <span className="flex-shrink-0 text-sm">{category.icon || '📌'}</span>
                          <input
                            ref={editInputRef}
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveEdit();
                              if (e.key === 'Escape') setEditingCategoryId(null);
                            }}
                            onBlur={handleSaveEdit}
                            onClick={(e) => e.stopPropagation()}
                            className={`flex-1 min-w-0 ${sidebarInlineInputClass}`}
                          />
                          <Tooltip.Provider>
                            <Tooltip.Root delayDuration={300}>
                              <Tooltip.Trigger asChild>
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleSaveEdit(); }}
                                  className="flex-shrink-0 w-5 h-5 flex items-center justify-center text-green-400 hover:text-green-300 rounded transition-colors"
                                >
                                  <Check className="h-3 w-3" />
                                </button>
                              </Tooltip.Trigger>
                              <Tooltip.Portal>
                                <Tooltip.Content className={sidebarTooltipClass} side="top" sideOffset={5}>
                                  {t('common.save')}
                                </Tooltip.Content>
                              </Tooltip.Portal>
                            </Tooltip.Root>
                          </Tooltip.Provider>
                          <Tooltip.Provider>
                            <Tooltip.Root delayDuration={300}>
                              <Tooltip.Trigger asChild>
                                <button
                                  onClick={(e) => { e.stopPropagation(); setEditingCategoryId(null); }}
                                  className={`flex-shrink-0 h-5 w-5 flex items-center justify-center ${sidebarIconButtonClass}`}
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </Tooltip.Trigger>
                              <Tooltip.Portal>
                                <Tooltip.Content className={sidebarTooltipClass} side="top" sideOffset={5}>
                                  {t('common.cancel')}
                                </Tooltip.Content>
                              </Tooltip.Portal>
                            </Tooltip.Root>
                          </Tooltip.Provider>
                        </>
                      ) : (
                        <>
                          <span className="flex-shrink-0 text-sm">{category.icon || '📌'}</span>
                          <span className="flex-1 truncate">{category.name}</span>
                          {getCategoryCount(category) > 0 && (
                            <span className="flex-shrink-0 text-xs text-[rgb(var(--muted-foreground))]">
                              {getCategoryCount(category)}
                            </span>
                          )}
                          {/* 悬停时显示编辑和删除按钮 */}
                          <div className="flex-shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Tooltip.Provider>
                              <Tooltip.Root delayDuration={300}>
                                <Tooltip.Trigger asChild>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleStartEdit(category); }}
                                    className={`h-5 w-5 flex items-center justify-center hover:bg-[rgb(var(--accent))] ${sidebarIconButtonClass}`}
                                  >
                                    <Edit2 className="h-3 w-3" />
                                  </button>
                                </Tooltip.Trigger>
                                <Tooltip.Portal>
                                  <Tooltip.Content className={sidebarTooltipClass} side="top" sideOffset={5}>
                                    {t('category.rename')}
                                  </Tooltip.Content>
                                </Tooltip.Portal>
                              </Tooltip.Root>
                            </Tooltip.Provider>
                            <Tooltip.Provider>
                              <Tooltip.Root delayDuration={300}>
                                <Tooltip.Trigger asChild>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); setCategoryToDelete(category); }}
                                    className="h-5 w-5 flex items-center justify-center rounded text-[rgb(var(--muted-foreground))] transition-colors hover:bg-[rgb(var(--accent))] hover:text-red-400"
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </button>
                                </Tooltip.Trigger>
                                <Tooltip.Portal>
                                  <Tooltip.Content className={sidebarTooltipClass} side="top" sideOffset={5}>
                                    {t('category.delete')}
                                  </Tooltip.Content>
                                </Tooltip.Portal>
                              </Tooltip.Root>
                            </Tooltip.Provider>
                          </div>
                        </>
                      )}
                    </div>
                  </CategoryDropZone>
                ))}

                {/* 内联创建分类 */}
                {isCreatingCategory ? (
                  <div className="flex items-center gap-1.5 pl-8 pr-2 py-1.5">
                    <span className="flex-shrink-0 text-sm">📁</span>
                    <input
                      ref={createInputRef}
                      value={newCategoryName}
                      onChange={(e) => setNewCategoryName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleCreateCategory();
                        if (e.key === 'Escape') {
                          setIsCreatingCategory(false);
                          setNewCategoryName('');
                        }
                      }}
                      onBlur={() => {
                        // 如果有内容，自动保存；如果没有内容，自动取消
                        if (newCategoryName.trim()) {
                          handleCreateCategory();
                        } else {
                          setIsCreatingCategory(false);
                          setNewCategoryName('');
                        }
                      }}
                      placeholder={t('category.namePlaceholder')}
                      className={`flex-1 min-w-0 ${sidebarInlineInputClass}`}
                    />
                  </div>
                ) : (
                  <button
                    onClick={() => setIsCreatingCategory(true)}
                    className="flex items-center gap-2 pl-8 pr-2 py-1.5 rounded-lg text-sm text-[rgb(var(--muted-foreground))] hover:bg-[rgb(var(--accent))] hover:text-[rgb(var(--foreground))] transition-colors"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>{t('sidebar.newCategory')}</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Bottom section */}
        <div className="space-y-2 p-4">
          {/* Settings and Help row */}
          <div className="flex items-center gap-2">
            <button
              className="flex-1 flex items-center justify-start gap-2 px-3 py-2 rounded-lg text-sm text-[rgb(var(--foreground))] hover:bg-[rgb(var(--accent))] hover:text-[rgb(var(--accent-foreground))] transition-colors"
              onClick={() => {
                setHasMountedSettingsPanel(true);
                setIsSettingsPanelOpen(true);
              }}
            >
              <Settings className="h-4 w-4" />
              <span>{t('settings.title')}</span>
            </button>
            <Tooltip.Provider>
              <Tooltip.Root delayDuration={300}>
                <Tooltip.Trigger asChild>
                  <button
                    className="flex items-center justify-center w-9 h-9 rounded-lg text-[rgb(var(--foreground))] hover:bg-[rgb(var(--accent))] transition-colors"
                    onClick={() => setIsQuickNavPanelOpen(true)}
                  >
                    <Compass className="h-4 w-4" />
                  </button>
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Content className={sidebarTooltipClass} side="top" sideOffset={5}>
                    {t('quickNav.title')}
                  </Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip.Root>
            </Tooltip.Provider>
            <Tooltip.Provider>
              <Tooltip.Root delayDuration={300}>
                <Tooltip.Trigger asChild>
                  <button
                    className="flex items-center justify-center w-9 h-9 rounded-lg text-[rgb(var(--foreground))] hover:bg-[rgb(var(--accent))] transition-colors"
                    onClick={() => setIsAboutPanelOpen(true)}
                    aria-label={t('about.title')}
                  >
                    <HelpCircle className="h-4 w-4" />
                  </button>
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Content className={sidebarTooltipClass} side="top" sideOffset={5}>
                    {t('about.title')}
                  </Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip.Root>
            </Tooltip.Provider>
          </div>

          {/* New Terminal button */}
          <button
            onClick={onCreateWindow}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-[rgb(var(--primary))] text-[rgb(var(--primary-foreground))] font-medium hover:opacity-90 transition-opacity"
          >
            <Plus className="h-4 w-4" />
            <span>{t('common.newTerminal')}</span>
          </button>

          {/* Batch button - always show */}
          <button
            onClick={() => setIsBatchDialogOpen(true)}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-[rgb(var(--primary))] text-[rgb(var(--primary-foreground))] font-medium hover:opacity-90 transition-opacity"
          >
            <FolderPlus className="h-4 w-4" />
            <span>{t('sidebar.batchAdd')}</span>
          </button>

          {/* Create Group button */}
          {activeWindows.length >= 2 && (
            <button
              onClick={onCreateGroup}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-[rgb(var(--primary))] text-[rgb(var(--primary-foreground))] font-medium hover:opacity-90 transition-opacity"

            >
              <Folder className="h-4 w-4" />
              <span>{t('sidebar.createGroup')}</span>
            </button>
          )}

          {/* Clear button - show for all tabs when there are windows */}
          {(() => {
            const { handler, count } = getClearHandler();
            if (!handler || count === 0) return null;

            let buttonText = '';
            if (currentTab === 'active') {
              buttonText = t('sidebar.clearActiveWindows');
            } else if (currentTab === 'archived') {
              buttonText = t('sidebar.clearArchivedWindows');
            } else if (currentTab === 'all') {
              buttonText = t('sidebar.clearAllWindows');
            } else if (currentTab === 'local') {
              buttonText = t('sidebar.clearLocalWindows');
            } else if (currentTab === 'ssh') {
              buttonText = t('sidebar.clearSSHWindows');
            }

            return (
              <button
                onClick={() => setIsConfirmDialogOpen(true)}
                className="w-full flex items-center justify-center gap-2 rounded-lg border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--secondary))_72%,transparent)] px-4 py-2 text-[rgb(var(--muted-foreground))] transition-colors hover:border-red-500/40 hover:bg-red-600 hover:text-white"

              >
                <Trash2 className="h-4 w-4" />
                <span>{buttonText}</span>
              </button>
            );
          })()}
        </div>
      </aside>

      <BatchCreateWindowDialog
        open={isBatchDialogOpen}
        onOpenChange={setIsBatchDialogOpen}
        onConfirm={handleBatchCreate}
      />

      <ConfirmDialog
        open={isConfirmDialogOpen}
        onOpenChange={setIsConfirmDialogOpen}
        title={
          currentTab === 'active'
            ? t('sidebar.confirmClearActiveTitle')
            : currentTab === 'archived'
            ? t('sidebar.confirmClearArchivedTitle')
            : currentTab === 'all'
            ? t('sidebar.confirmClearAllTitle')
            : currentTab === 'local'
            ? t('sidebar.confirmClearLocalTitle')
            : currentTab === 'ssh'
            ? t('sidebar.confirmClearSSHTitle')
            : t('sidebar.confirmClearActiveTitle')
        }
        description={
          currentTab === 'active'
            ? t('sidebar.confirmClearActiveDescription', { count: recentActiveWindows.length })
            : currentTab === 'archived'
            ? t('sidebar.confirmClearArchivedDescription', { count: archivedWindows.length })
            : currentTab === 'all'
            ? t('sidebar.confirmClearAllDescription', { count: persistableWindows.length })
            : currentTab === 'local'
            ? t('sidebar.confirmClearLocalDescription', { count: localActiveWindows.length })
            : currentTab === 'ssh'
            ? t('sidebar.confirmClearSSHDescription', { count: sshActiveWindows.length })
            : t('sidebar.confirmClearActiveDescription', { count: 0 })
        }
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        onConfirm={getClearHandler().handler || (() => {})}
        variant="danger"
      />

      {hasMountedSettingsPanel && (
        <Suspense fallback={null}>
          <LazySettingsPanel
            open={isSettingsPanelOpen}
            onClose={() => setIsSettingsPanelOpen(false)}
          />
        </Suspense>
      )}

      {isQuickNavPanelOpen && (
        <Suspense fallback={null}>
          <LazyQuickNavPanel
            open={isQuickNavPanelOpen}
            onClose={() => setIsQuickNavPanelOpen(false)}
          />
        </Suspense>
      )}

      {isAboutPanelOpen && (
        <Suspense fallback={null}>
          <LazyAboutPanel
            open={isAboutPanelOpen}
            onClose={() => setIsAboutPanelOpen(false)}
            appName={appName}
            version={version}
          />
        </Suspense>
      )}

      <ConfirmDialog
        open={!!categoryToDelete}
        onOpenChange={(open) => { if (!open) setCategoryToDelete(null); }}
        title={t('category.delete')}
        description={
          categoryToDelete
            ? t('category.deleteConfirm', { name: categoryToDelete.name })
            : ''
        }
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        onConfirm={async () => {
          if (categoryToDelete) {
            await removeCustomCategory(categoryToDelete.id);
            // 如果当前选中的是被删除的分类，切换到活跃终端
            if (currentTab === categoryToDelete.id) {
              onTabChange?.('active');
            }
            setCategoryToDelete(null);
          }
        }}
        variant="danger"
      />
    </>
  );
}
