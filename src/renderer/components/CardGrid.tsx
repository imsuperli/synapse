import React, { useCallback, useMemo, useState } from 'react';
import * as ScrollArea from '@radix-ui/react-scroll-area';
import { Search, Folder, Archive } from 'lucide-react';
import { CanvasWorkspace } from '../../shared/types/canvas';
import { useWindowStore } from '../stores/windowStore';
import { sortWindows } from '../utils/sortWindows';
import { getAllPanes } from '../utils/layoutHelpers';
import { WindowCard } from './WindowCard';
import { GroupCard } from './GroupCard';
import { EditWindowPanel } from './EditWindowPanel';
import { EditGroupPanel } from './EditGroupPanel';
import { CreateGroupDialog } from './CreateGroupDialog';
import { NewWindowCard } from './NewWindowCard';
import { MissingWorkingDirectoryDialog } from './MissingWorkingDirectoryDialog';
import { DeleteWindowDialog } from './DeleteWindowDialog';
import { SSHProfileCard } from './SSHProfileCard';
import { DeleteSSHCardDialog } from './DeleteSSHCardDialog';
import { CanvasWorkspaceCard } from './CanvasWorkspaceCard';
import { Dialog } from './ui/Dialog';
import { DraggableWindowCard, DraggableGroupCard, DraggableSSHProfileCard, DropZone } from './dnd';
import type { WindowCardDragItem, DropResult } from './dnd';
import { useWindowDirectoryGuard } from '../hooks/useWindowDirectoryGuard';
import { useDeleteWindowDialog } from '../hooks/useDeleteWindowDialog';
import { Pane, Window, WindowStatus } from '../types/window';
import { WindowGroup } from '../../shared/types/window-group';
import { SSHCredentialState, SSHProfile } from '../../shared/types/ssh';
import { useI18n } from '../i18n';
import { getCurrentWindowWorkingDirectory } from '../utils/windowWorkingDirectory';
import { getCurrentWindowTerminalPane } from '../utils/windowWorkingDirectory';
import { createGroup, getAllWindowIds } from '../utils/groupLayoutHelpers';
import {
  buildStandaloneSSHWindowMap,
  getPersistableWindows,
  getStandalonePersistableWindows,
  getStandaloneSSHProfileId,
  isEphemeralSSHCloneWindow,
} from '../utils/sshWindowBindings';
import { getSSHProfileReferencingWindows } from '../utils/sshWindowDeletion';
import { canPaneOpenInIDE, canPaneOpenLocalFolder, getPaneBackend, isSessionlessPane } from '../../shared/utils/terminalCapabilities';
import { startWindowPanes } from '../utils/paneSessionActions';
import {
  destroySSHWindowFamilyResources,
  destroyWindowResourcesAndRemoveRecord,
  destroyWindowResourcesKeepRecord,
} from '../utils/windowDestruction';
import { createCanvasWindowBlock } from '../utils/canvasWorkspace';
import { getRecentTerminalItems } from '../utils/recentTerminals';
import { matchSearchTermsLiteral } from '../utils/fuzzySearch';
import {
  getCanvasWorkspaceSearchTerms,
  getSSHProfileSearchTerms,
  getSSHTargetLabel,
  getWindowSearchTerms,
  normalizeSearchTerms,
} from '../utils/searchTerms';

// 统一的卡片项类型
type CardItem =
  | { type: 'window'; data: Window }
  | { type: 'group'; data: WindowGroup }
  | { type: 'sshProfile'; data: SSHProfile }
  | { type: 'canvasWorkspace'; data: CanvasWorkspace };

const BUILTIN_TABS = new Set(['all', 'active', 'archived', 'local', 'ssh', 'canvas']);

function sortGroupsByCreatedAt(groups: WindowGroup[]): WindowGroup[] {
  return [...groups].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function sortCanvasWorkspacesByUpdatedAt(canvasWorkspaces: CanvasWorkspace[]): CanvasWorkspace[] {
  return [...canvasWorkspaces].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
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

function isBuiltinTab(tab: string | undefined): boolean {
  if (!tab) {
    return false;
  }

  return BUILTIN_TABS.has(tab) || tab.startsWith('status:');
}

interface CardGridProps {
  onEnterTerminal?: (window: Window) => void;
  onEnterCanvasWorkspace?: (canvasWorkspaceId: string) => void;
  onStopCanvasWorkspace?: (canvasWorkspaceId: string) => void | Promise<void>;
  onDeleteCanvasWorkspace?: (canvasWorkspaceId: string) => void | Promise<void>;
  onEnterGroup?: (group: WindowGroup) => void;
  onCreateWindow?: () => void;
  sshEnabled?: boolean;
  sshProfiles?: SSHProfile[];
  sshCredentialStates?: Record<string, SSHCredentialState>;
  connectingSSHProfileId?: string | null;
  onConnectSSHProfile?: (profile: SSHProfile) => void | Promise<void>;
  onEditSSHProfile?: (profile: SSHProfile) => void;
  onDuplicateSSHProfile?: (profile: SSHProfile) => void;
  onDeleteSSHProfile?: (profile: SSHProfile) => void | Promise<void>;
  searchQuery?: string;
  currentTab?: 'all' | 'active' | 'archived' | string;
  recentTerminalLimit?: number;
}

/**
 * CardGrid 组件
 * 以响应式 CSS Grid 网格布局显示窗口、组、SSH 配置和画布工作区卡片。
 */
export const CardGrid = React.memo<CardGridProps>(({
  onEnterTerminal,
  onEnterCanvasWorkspace,
  onStopCanvasWorkspace,
  onDeleteCanvasWorkspace,
  onEnterGroup,
  onCreateWindow,
  sshEnabled = false,
  sshProfiles = [],
  sshCredentialStates = {},
  connectingSSHProfileId = null,
  onConnectSSHProfile,
  onEditSSHProfile,
  onDuplicateSSHProfile,
  onDeleteSSHProfile,
  searchQuery = '',
  currentTab = 'active',
  recentTerminalLimit,
}) => {
  const { t } = useI18n();
  const windows = useWindowStore((state) => state.windows);
  const activeWindowId = useWindowStore((state) => state.activeWindowId);
  const updatePane = useWindowStore((state) => state.updatePane);
  const updateWindow = useWindowStore((state) => state.updateWindow);
  const archiveWindow = useWindowStore((state) => state.archiveWindow);
  const unarchiveWindow = useWindowStore((state) => state.unarchiveWindow);
  const removeWindow = useWindowStore((state) => state.removeWindow);

  // 组相关的 store 方法
  const groups = useWindowStore((state) => state.groups);
  const canvasWorkspaces = useWindowStore((state) => state.canvasWorkspaces);
  const startedCanvasWorkspaceIds = useWindowStore((state) => state.startedCanvasWorkspaceIds);
  const mruList = useWindowStore((state) => state.mruList);
  const groupMruList = useWindowStore((state) => state.groupMruList);
  const removeGroup = useWindowStore((state) => state.removeGroup);
  const updateGroup = useWindowStore((state) => state.updateGroup);
  const archiveGroup = useWindowStore((state) => state.archiveGroup);
  const unarchiveGroup = useWindowStore((state) => state.unarchiveGroup);
  const updateCanvasWorkspace = useWindowStore((state) => state.updateCanvasWorkspace);
  const removeCanvasWorkspace = useWindowStore((state) => state.removeCanvasWorkspace);

  // 自定义分类
  const customCategories = useWindowStore((state) => state.customCategories);

  const { runWithWindowDirectory, dialogState } = useWindowDirectoryGuard();
  const { requestDeleteWindow, dialogState: deleteDialogState } = useDeleteWindowDialog();
  const [editingWindow, setEditingWindow] = useState<Window | null>(null);
  const [editingGroup, setEditingGroup] = useState<WindowGroup | null>(null);
  const [showCreateGroupDialog, setShowCreateGroupDialog] = useState(false);
  const [sshDeleteTarget, setSSHDeleteTarget] = useState<SSHProfile | null>(null);
  const [sshDeleteError, setSSHDeleteError] = useState('');
  const [isDeletingSSHCard, setIsDeletingSSHCard] = useState(false);
  const [editingCanvasWorkspace, setEditingCanvasWorkspace] = useState<CanvasWorkspace | null>(null);
  const [canvasWorkspaceNameDraft, setCanvasWorkspaceNameDraft] = useState('');
  const [canvasWorkspaceDeleteTarget, setCanvasWorkspaceDeleteTarget] = useState<CanvasWorkspace | null>(null);
  const persistableWindows = useMemo(() => getPersistableWindows(windows), [windows]);
  const standalonePersistableWindows = useMemo(() => getStandalonePersistableWindows(windows), [windows]);
  const windowById = useMemo(
    () => new Map(windows.map((window) => [window.id, window])),
    [windows],
  );

  const sortedSSHProfiles = useMemo(
    () => [...sshProfiles].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [sshProfiles],
  );
  const sshProfileIds = useMemo(
    () => new Set(sshProfiles.map((profile) => profile.id)),
    [sshProfiles],
  );
  const { groupWindowIdsByGroupId, groupedWindowIds } = useMemo(() => {
    const idsByGroupId = new Map<string, string[]>();
    const allGroupedIds = new Set<string>();

    groups.forEach((group) => {
      const ids = getAllWindowIds(group.layout);
      idsByGroupId.set(group.id, ids);
      ids.forEach((id) => allGroupedIds.add(id));
    });

    return {
      groupWindowIdsByGroupId: idsByGroupId,
      groupedWindowIds: allGroupedIds,
    };
  }, [groups]);
  const {
    persistableWindowById,
    statusSetByWindowId,
    windowKindById,
    windowSearchTermsById,
  } = useMemo(() => {
    const nextPersistableWindowById = new Map<string, Window>();
    const nextStatusSetByWindowId = new Map<string, Set<WindowStatus>>();
    const nextWindowKindById = new Map<string, NonNullable<Window['kind']>>();
    const nextWindowSearchTermsById = new Map<string, string[]>();

    persistableWindows.forEach((window) => {
      const panes = getAllPanes(window.layout);
      const statusSet = new Set<WindowStatus>();

      panes.forEach((pane) => {
        statusSet.add(pane.status);
      });

      nextPersistableWindowById.set(window.id, window);
      nextStatusSetByWindowId.set(window.id, statusSet);
      nextWindowKindById.set(window.id, getWindowKindFromPanes(window, panes));
      nextWindowSearchTermsById.set(window.id, normalizeSearchTerms(getWindowSearchTerms(window, {
        workingDirectory: getCurrentWindowWorkingDirectory(window),
      })));
    });

    return {
      persistableWindowById: nextPersistableWindowById,
      statusSetByWindowId: nextStatusSetByWindowId,
      windowKindById: nextWindowKindById,
      windowSearchTermsById: nextWindowSearchTermsById,
    };
  }, [persistableWindows]);
  const getGroupWindows = useCallback(
    (group: WindowGroup) => (
      groupWindowIdsByGroupId.get(group.id)
        ?.map((windowId) => persistableWindowById.get(windowId))
        .filter((window): window is Window => Boolean(window)) ?? []
    ),
    [groupWindowIdsByGroupId, persistableWindowById],
  );
  const groupHasWindowMatching = useCallback(
    (group: WindowGroup, predicate: (window: Window) => boolean) => {
      const windowIds = groupWindowIdsByGroupId.get(group.id);
      if (!windowIds) {
        return false;
      }

      return windowIds.some((windowId) => {
        const window = persistableWindowById.get(windowId);
        return window ? predicate(window) : false;
      });
    },
    [groupWindowIdsByGroupId, persistableWindowById],
  );
  const groupHasStatus = useCallback(
    (group: WindowGroup, status: WindowStatus) => groupHasWindowMatching(
      group,
      (window) => statusSetByWindowId.get(window.id)?.has(status) ?? false,
    ),
    [groupHasWindowMatching, statusSetByWindowId],
  );
  const groupHasKind = useCallback(
    (group: WindowGroup, predicate: (kind: NonNullable<Window['kind']>) => boolean) => groupHasWindowMatching(
      group,
      (window) => predicate(windowKindById.get(window.id) ?? 'local'),
    ),
    [groupHasWindowMatching, windowKindById],
  );
  const standaloneSSHWindowsByProfile = useMemo(
    () => buildStandaloneSSHWindowMap(
      persistableWindows.filter((window) => !groupedWindowIds.has(window.id)),
      sshProfiles.map((profile) => profile.id),
    ),
    [groupedWindowIds, persistableWindows, sshProfiles],
  );
  const activeCustomCategory = useMemo(
    () => customCategories.find((category) => category.id === currentTab) ?? null,
    [currentTab, customCategories],
  );
  const isCustomCategoryTab = useMemo(
    () => !isBuiltinTab(currentTab),
    [currentTab],
  );
  const sshProfilesById = useMemo(
    () => new Map(sshProfiles.map((profile) => [profile.id, profile])),
    [sshProfiles],
  );
  const shouldRenderWindowCard = useCallback((window: Window) => {
    if (window.archived) {
      return true;
    }

    const profileId = getStandaloneSSHProfileId(window);
    if (!profileId) {
      return true;
    }

    return !sshEnabled || !sshProfileIds.has(profileId);
  }, [sshEnabled, sshProfileIds]);
  const activeCanvasWorkspaceItems = useMemo<CardItem[]>(
    () => sortCanvasWorkspacesByUpdatedAt(canvasWorkspaces.filter((canvasWorkspace) => !canvasWorkspace.archived))
      .map((canvasWorkspace) => ({ type: 'canvasWorkspace', data: canvasWorkspace })),
    [canvasWorkspaces],
  );
  const archivedCanvasWorkspaceItems = useMemo<CardItem[]>(
    () => sortCanvasWorkspacesByUpdatedAt(canvasWorkspaces.filter((canvasWorkspace) => canvasWorkspace.archived))
      .map((canvasWorkspace) => ({ type: 'canvasWorkspace', data: canvasWorkspace })),
    [canvasWorkspaces],
  );

  // 根据 currentTab 过滤和排序卡片项
  const cardItems = useMemo<CardItem[]>(() => {
    const filterVisibleStandaloneWindows = (ws: Window[]) => {
      return ws.filter((window) => (
        shouldRenderWindowCard(window) && !groupedWindowIds.has(window.id)
      ));
    };

    if (currentTab === 'active') {
      const activeWindows = standalonePersistableWindows.filter((window) => (
        !window.archived && !groupedWindowIds.has(window.id)
      ));
      const activeGroups = groups.filter((group) => !group.archived);
      const seenSSHProfileIds = new Set<string>();
      return getRecentTerminalItems(activeWindows, activeGroups, mruList, groupMruList, recentTerminalLimit)
        .flatMap<CardItem>((item) => {
          if (item.type === 'group') {
            return [{ type: 'group', data: item.data }];
          }

          const window = item.data;
          if (shouldRenderWindowCard(window)) {
            return [{ type: 'window', data: window }];
          }

          const profileId = getStandaloneSSHProfileId(window);
          if (!profileId || seenSSHProfileIds.has(profileId)) {
            return [];
          }

          const profile = sshProfilesById.get(profileId);
          if (!profile) {
            return [{ type: 'window', data: window }];
          }

          seenSSHProfileIds.add(profileId);
          return [{ type: 'sshProfile', data: profile }];
        });
    }

    // 状态筛选标签
    if (currentTab?.startsWith('status:')) {
      const statusMap: Record<string, WindowStatus> = {
        'status:running': WindowStatus.Running,
        'status:waiting': WindowStatus.WaitingForInput,
        'status:inactive': WindowStatus.Completed,
      };
      const targetStatus = statusMap[currentTab];
      if (!targetStatus) return [];

      // 筛选包含目标状态窗格的未归档窗口
      const matchedWindows = filterVisibleStandaloneWindows(
        standalonePersistableWindows.filter(w => !w.archived && (statusSetByWindowId.get(w.id)?.has(targetStatus) ?? false))
      );
      const windowItems: CardItem[] = sortWindows(matchedWindows, 'createdAt').map(w => ({ type: 'window', data: w }));

      // 筛选包含目标状态窗口的未归档组
      const matchedGroups = groups.filter(g => !g.archived && groupHasStatus(g, targetStatus));
      const groupItems: CardItem[] = sortGroupsByCreatedAt(matchedGroups).map(g => ({ type: 'group', data: g }));

      return [...groupItems, ...windowItems];
    }

    // 本地终端标签
    if (currentTab === 'local') {
      const activeGroups = groups.filter(g => !g.archived);
      const activeWindows = filterVisibleStandaloneWindows(standalonePersistableWindows.filter(w => !w.archived));
      const localWindows = activeWindows.filter(w => windowKindById.get(w.id) !== 'ssh');

      // 过滤包含本地窗口的组
      const localGroups = activeGroups.filter(g => groupHasKind(g, (kind) => kind !== 'ssh'));

      return [
        ...sortGroupsByCreatedAt(localGroups).map(g => ({ type: 'group' as const, data: g })),
        ...sortWindows(localWindows, 'createdAt').map(w => ({ type: 'window' as const, data: w })),
      ];
    }

    // 远程终端标签
    if (currentTab === 'ssh') {
      const activeGroups = groups.filter(g => !g.archived);
      const activeWindows = filterVisibleStandaloneWindows(standalonePersistableWindows.filter(w => !w.archived));
      const sshWindows = activeWindows.filter(w => windowKindById.get(w.id) === 'ssh');

      // 过滤包含 SSH 窗口的组
      const sshGroups = activeGroups.filter(g => groupHasKind(g, (kind) => kind === 'ssh'));

      return [
        ...sortGroupsByCreatedAt(sshGroups).map(g => ({ type: 'group' as const, data: g })),
        ...sortWindows(sshWindows, 'createdAt').map(w => ({ type: 'window' as const, data: w })),
        ...(sshEnabled ? sortedSSHProfiles.map(profile => ({ type: 'sshProfile' as const, data: profile })) : []),
      ];
    }

    if (currentTab === 'canvas') {
      return activeCanvasWorkspaceItems;
    }

    // 自定义分类标签
    if (activeCustomCategory) {
      const seenSSHProfileIds = new Set<string>();
      const categoryGroups = groups.filter((group) => activeCustomCategory.groupIds.includes(group.id));
      const explicitSSHProfileIds = new Set(activeCustomCategory.sshProfileIds ?? []);
      const categoryWindows = sortWindows(
        standalonePersistableWindows.filter((window) => activeCustomCategory.windowIds.includes(window.id)),
        'createdAt',
      );

      const groupItems: CardItem[] = sortGroupsByCreatedAt(categoryGroups).map((group) => ({ type: 'group', data: group }));
      const windowItems: CardItem[] = categoryWindows.flatMap<CardItem>((window) => {
        if (shouldRenderWindowCard(window)) {
          return [{ type: 'window', data: window } satisfies CardItem];
        }

        const profileId = getStandaloneSSHProfileId(window);
        if (!profileId || seenSSHProfileIds.has(profileId)) {
          return [];
        }

        const profile = sshProfilesById.get(profileId);
        if (!profile) {
          return [{ type: 'window', data: window } satisfies CardItem];
        }

        seenSSHProfileIds.add(profileId);
        return [{ type: 'sshProfile', data: profile } satisfies CardItem];
      });
      const sshProfileItems: CardItem[] = sshEnabled
        ? sortedSSHProfiles
          .filter((profile) => explicitSSHProfileIds.has(profile.id) && !seenSSHProfileIds.has(profile.id))
          .map((profile) => ({ type: 'sshProfile', data: profile }))
        : [];

      return [...groupItems, ...windowItems, ...sshProfileItems];
    }

    if (isCustomCategoryTab) {
      return [];
    }

    if (currentTab === 'all') {
      // 全部终端：活跃组 → 活跃窗口 → 归档组 → 归档窗口
      const activeGroups = groups.filter(g => !g.archived);
      const archivedGroups = groups.filter(g => g.archived);
      const activeWindows = filterVisibleStandaloneWindows(standalonePersistableWindows.filter(w => !w.archived));
      const archivedWindows = filterVisibleStandaloneWindows(standalonePersistableWindows.filter(w => w.archived));

      return [
        ...activeCanvasWorkspaceItems,
        ...sortGroupsByCreatedAt(activeGroups).map(g => ({ type: 'group' as const, data: g })),
        ...sortWindows(activeWindows, 'createdAt').map(w => ({ type: 'window' as const, data: w })),
        ...(sshEnabled ? sortedSSHProfiles.map(profile => ({ type: 'sshProfile' as const, data: profile })) : []),
        ...archivedCanvasWorkspaceItems,
        ...sortGroupsByCreatedAt(archivedGroups).map(g => ({ type: 'group' as const, data: g })),
        ...sortWindows(archivedWindows, 'lastActiveAt').map(w => ({ type: 'window' as const, data: w })),
      ];
    }

    if (currentTab === 'archived') {
      // 归档终端：归档组 → 归档窗口
      const archivedGroups = groups.filter(g => g.archived);
      const archivedWindows = filterVisibleStandaloneWindows(standalonePersistableWindows.filter(w => w.archived));

      return [
        ...archivedCanvasWorkspaceItems,
        ...sortGroupsByCreatedAt(archivedGroups).map(g => ({ type: 'group' as const, data: g })),
        ...sortWindows(archivedWindows, 'lastActiveAt').map(w => ({ type: 'window' as const, data: w })),
      ];
    }

    // 活跃终端（默认）：活跃组 → 活跃窗口
    const activeGroups = groups.filter(g => !g.archived);
    const activeWindows = filterVisibleStandaloneWindows(standalonePersistableWindows.filter(w => !w.archived));

    return [
      ...activeCanvasWorkspaceItems,
      ...sortGroupsByCreatedAt(activeGroups).map(g => ({ type: 'group' as const, data: g })),
      ...sortWindows(activeWindows, 'createdAt').map(w => ({ type: 'window' as const, data: w })),
      ...(sshEnabled ? sortedSSHProfiles.map(profile => ({ type: 'sshProfile' as const, data: profile })) : []),
    ];
  }, [activeCanvasWorkspaceItems, activeCustomCategory, archivedCanvasWorkspaceItems, currentTab, groupHasKind, groupHasStatus, groupMruList, groupedWindowIds, groups, isCustomCategoryTab, mruList, recentTerminalLimit, shouldRenderWindowCard, sortedSSHProfiles, sshEnabled, sshProfilesById, standalonePersistableWindows, statusSetByWindowId, windowKindById]);

  // 全局搜索：始终搜索所有终端和组，不受 currentTab 限制
  const allCardItems = useMemo<CardItem[]>(() => {
    // 全部终端：活跃组 → 活跃窗口 → 归档组 → 归档窗口
    const activeGroups = groups.filter(g => !g.archived);
    const archivedGroups = groups.filter(g => g.archived);
    const activeWindows = standalonePersistableWindows.filter(w => !w.archived && !groupedWindowIds.has(w.id) && shouldRenderWindowCard(w));
    const archivedWindows = standalonePersistableWindows.filter(w => w.archived && !groupedWindowIds.has(w.id) && shouldRenderWindowCard(w));

    return [
      ...activeCanvasWorkspaceItems,
      ...sortGroupsByCreatedAt(activeGroups).map(g => ({ type: 'group' as const, data: g })),
      ...sortWindows(activeWindows, 'createdAt').map(w => ({ type: 'window' as const, data: w })),
      ...(sshEnabled ? sortedSSHProfiles.map(profile => ({ type: 'sshProfile' as const, data: profile })) : []),
      ...archivedCanvasWorkspaceItems,
      ...sortGroupsByCreatedAt(archivedGroups).map(g => ({ type: 'group' as const, data: g })),
      ...sortWindows(archivedWindows, 'lastActiveAt').map(w => ({ type: 'window' as const, data: w })),
    ];
  }, [activeCanvasWorkspaceItems, archivedCanvasWorkspaceItems, groupedWindowIds, groups, shouldRenderWindowCard, sshEnabled, sortedSSHProfiles, standalonePersistableWindows]);

  // 根据搜索关键词过滤卡片项（窗口和组）
  const filteredCardItems = useMemo(() => {
    if (!searchQuery.trim()) {
      return cardItems;
    }

    // 使用全局卡片列表进行搜索，而不是当前标签的卡片列表
    return allCardItems.filter((item) => {
      if (item.type === 'window') {
        const win = item.data;
        return matchSearchTermsLiteral(searchQuery, windowSearchTermsById.get(win.id) ?? []);
      }

      if (item.type === 'group') {
        const group = item.data;
        const windowsInGroup = getGroupWindows(group);
        const groupSearchTerms = normalizeSearchTerms([
          group.name,
          ...windowsInGroup.flatMap((win) => windowSearchTermsById.get(win.id) ?? []),
        ]);

        if (matchSearchTermsLiteral(searchQuery, groupSearchTerms)) {
          return true;
        }

        return false;
      }

      if (item.type === 'canvasWorkspace') {
        return matchSearchTermsLiteral(
          searchQuery,
          normalizeSearchTerms(getCanvasWorkspaceSearchTerms(item.data)),
        );
      }

      const profile = item.data;
      return matchSearchTermsLiteral(
        searchQuery,
        normalizeSearchTerms(getSSHProfileSearchTerms(profile, getSSHTargetLabel(profile))),
      );
    });
  }, [allCardItems, cardItems, getGroupWindows, searchQuery, windowSearchTermsById]);

  const handleConnectSSHProfile = useCallback(async (profile: SSHProfile) => {
    await onConnectSSHProfile?.(profile);
  }, [onConnectSSHProfile]);

  const handleEditSSHProfile = useCallback((profile: SSHProfile) => {
    onEditSSHProfile?.(profile);
  }, [onEditSSHProfile]);

  const handleDeleteSSHProfile = useCallback(async (profile: SSHProfile) => {
    setSSHDeleteTarget(profile);
    setSSHDeleteError('');
    setIsDeletingSSHCard(false);
  }, []);

  const resetSSHDeleteDialog = useCallback(() => {
    setSSHDeleteTarget(null);
    setSSHDeleteError('');
    setIsDeletingSSHCard(false);
  }, []);

  const handleSSHDeleteOpenChange = useCallback((open: boolean) => {
    if (!open && !isDeletingSSHCard) {
      resetSSHDeleteDialog();
    }
  }, [isDeletingSSHCard, resetSSHDeleteDialog]);

  const sshDeleteAssociatedWindows = useMemo(
    () => (sshDeleteTarget ? getSSHProfileReferencingWindows(windows, sshDeleteTarget.id) : []),
    [sshDeleteTarget, windows],
  );

  const sshDeleteBlockingWindowCount = useMemo(() => {
    if (!sshDeleteTarget) {
      return 0;
    }

    const boundWindowId = standaloneSSHWindowsByProfile[sshDeleteTarget.id]?.id;
    return getSSHProfileReferencingWindows(windows, sshDeleteTarget.id, {
      excludeWindowIds: boundWindowId ? [boundWindowId] : [],
      includeArchived: false,
      includeEphemeral: false,
    }).length;
  }, [sshDeleteTarget, standaloneSSHWindowsByProfile, windows]);

  const confirmDeleteSSHCard = useCallback(async () => {
    if (!sshDeleteTarget) {
      return;
    }

    setIsDeletingSSHCard(true);
    setSSHDeleteError('');

    const associatedWindows = getSSHProfileReferencingWindows(windows, sshDeleteTarget.id);

    try {
      for (const windowToDelete of associatedWindows) {
        const response = await window.electronAPI.deleteWindow(windowToDelete.id);
        if (response && !response.success) {
          throw new Error(response.error || t('sshDelete.deleteFailed'));
        }
      }

      associatedWindows.forEach((windowToDelete) => {
        removeWindow(windowToDelete.id);
      });

      await onDeleteSSHProfile?.(sshDeleteTarget);
      resetSSHDeleteDialog();
    } catch (error) {
      setSSHDeleteError((error as Error).message || t('sshDelete.deleteFailed'));
      setIsDeletingSSHCard(false);
    }
  }, [onDeleteSSHProfile, removeWindow, resetSSHDeleteDialog, sshDeleteTarget, t, windows]);

  const handleDuplicateSSHProfile = useCallback((profile: SSHProfile) => {
    onDuplicateSSHProfile?.(profile);
  }, [onDuplicateSSHProfile]);

  const handleEditCanvasWorkspace = useCallback((canvasWorkspace: CanvasWorkspace) => {
    setEditingCanvasWorkspace(canvasWorkspace);
    setCanvasWorkspaceNameDraft(canvasWorkspace.name);
  }, []);

  const handleArchiveCanvasWorkspace = useCallback((canvasWorkspace: CanvasWorkspace) => {
    updateCanvasWorkspace(canvasWorkspace.id, { archived: true });
  }, [updateCanvasWorkspace]);

  const handleUnarchiveCanvasWorkspace = useCallback((canvasWorkspace: CanvasWorkspace) => {
    updateCanvasWorkspace(canvasWorkspace.id, { archived: false });
  }, [updateCanvasWorkspace]);

  const handleDeleteCanvasWorkspace = useCallback((canvasWorkspace: CanvasWorkspace) => {
    setCanvasWorkspaceDeleteTarget(canvasWorkspace);
  }, []);

  const handleSaveCanvasWorkspaceEdit = useCallback(() => {
    if (!editingCanvasWorkspace) {
      return;
    }

    updateCanvasWorkspace(editingCanvasWorkspace.id, {
      name: canvasWorkspaceNameDraft.trim() || editingCanvasWorkspace.name,
    });
    setEditingCanvasWorkspace(null);
    setCanvasWorkspaceNameDraft('');
  }, [canvasWorkspaceNameDraft, editingCanvasWorkspace, updateCanvasWorkspace]);

  const confirmDeleteCanvasWorkspace = useCallback(async () => {
    if (!canvasWorkspaceDeleteTarget) {
      return;
    }

    await onDeleteCanvasWorkspace?.(canvasWorkspaceDeleteTarget.id);
    removeCanvasWorkspace(canvasWorkspaceDeleteTarget.id);
    setCanvasWorkspaceDeleteTarget(null);
  }, [canvasWorkspaceDeleteTarget, onDeleteCanvasWorkspace, removeCanvasWorkspace]);

  const handleCardClick = useCallback(
    async (win: Window) => {
      await runWithWindowDirectory(win, async (targetWindow) => {
        onEnterTerminal?.(targetWindow);
      });
    },
    [onEnterTerminal, runWithWindowDirectory]
  );

  const startWindow = useCallback(async (win: Window) => {
    await startWindowPanes(win, updatePane);
  }, [updatePane]);

  const handleStartWindow = useCallback(async (win: Window) => {
    await runWithWindowDirectory(win, startWindow);
  }, [runWithWindowDirectory, startWindow]);

  const destroyWindowIds = useCallback(async (windowIds: string[]) => {
    for (const windowId of windowIds) {
      await destroyWindowResourcesKeepRecord(windowId);
    }
  }, []);
  const destroyAndRemoveWindowIds = useCallback(async (windowIds: string[]) => {
    for (const windowId of windowIds) {
      await destroyWindowResourcesAndRemoveRecord(windowId);
    }
  }, []);

  const handleDestroyWindowSession = useCallback(async (win: Window) => {
    try {
      if (isEphemeralSSHCloneWindow(win)) {
        await destroyWindowResourcesAndRemoveRecord(win.id);
        return;
      }

      await destroyWindowIds([win.id]);
    } catch (error) {
      console.error('Failed to destroy window:', error);
    }
  }, [destroyWindowIds]);

  const handleDestroySSHProfileWindowSession = useCallback(async (win: Window) => {
    try {
      const activeWindowIdAtStart = activeWindowId;
      const destroyedWindowIds = await destroySSHWindowFamilyResources(win, {
        removeTargetRecord: true,
        includeOwnedClones: true,
      });

      if (activeWindowIdAtStart && destroyedWindowIds.includes(activeWindowIdAtStart)) {
        await window.electronAPI.switchToUnifiedView();
      }
    } catch (error) {
      console.error('Failed to destroy SSH profile window:', error);
    }
  }, [activeWindowId]);

  const handleArchiveWindow = useCallback(async (win: Window) => {
    try {
      if (isEphemeralSSHCloneWindow(win)) {
        return;
      }

      await destroyWindowResourcesKeepRecord(win.id);
      // 归档窗口
      archiveWindow(win.id);
    } catch (error) {
      console.error('Failed to archive window:', error);
    }
  }, [archiveWindow]);

  const handleUnarchiveWindow = useCallback(async (win: Window) => {
    try {
      unarchiveWindow(win.id);
    } catch (error) {
      console.error('Failed to unarchive window:', error);
    }
  }, [unarchiveWindow]);

  const handleDeleteWindow = useCallback(async (windowId: string) => {
    const targetWindow = windowById.get(windowId);
    if (!targetWindow) {
      return;
    }

    requestDeleteWindow(targetWindow);
  }, [requestDeleteWindow, windowById]);

  const openFolder = useCallback(async (win: Window) => {
    const activePane = getCurrentWindowTerminalPane(win);
    if (!activePane || !canPaneOpenLocalFolder(activePane)) {
      return;
    }

    const workingDirectory = getCurrentWindowWorkingDirectory(win);
    try {
      await window.electronAPI.openFolder(workingDirectory);
    } catch (error) {
      console.error('Failed to open folder:', error);
    }
  }, []);

  const handleOpenFolder = useCallback(async (win: Window) => {
    await runWithWindowDirectory(win, openFolder);
  }, [openFolder, runWithWindowDirectory]);

  const openInIDE = useCallback(async (ide: string, win: Window) => {
    const activePane = getCurrentWindowTerminalPane(win);
    if (!activePane || !canPaneOpenInIDE(activePane)) {
      return;
    }

    const workingDirectory = getCurrentWindowWorkingDirectory(win);
    try {
      const response = await window.electronAPI.openInIDE(ide, workingDirectory);
      if (!response.success) {
        console.error(`Failed to open in ${ide}:`, response.error);
        // TODO: 显示错误提示
      }
    } catch (error) {
      console.error(`Failed to open in ${ide}:`, error);
    }
  }, []);

  const handleOpenInIDE = useCallback(async (ide: string, win: Window) => {
    await runWithWindowDirectory(win, async (targetWindow) => {
      await openInIDE(ide, targetWindow);
    });
  }, [openInIDE, runWithWindowDirectory]);

  const handleEditWindow = useCallback((win: Window) => {
    setEditingWindow(win);
  }, []);

  const handleSaveEdit = useCallback(async (windowId: string, updates: { name?: string; command?: string; cwd?: string }) => {
    try {
      // 更新窗口名称
      if (updates.name) {
        updateWindow(windowId, { name: updates.name });
      }

      // 更新当前可编辑的 terminal pane
      const window = windowById.get(windowId);
      if (window) {
        const firstPane = getCurrentWindowTerminalPane(window);
        if (firstPane) {
          const paneUpdates: Partial<typeof firstPane> = {};

          if (updates.command && updates.command !== firstPane.command) {
            paneUpdates.command = updates.command;
          }

          if (updates.cwd && updates.cwd !== firstPane.cwd) {
            paneUpdates.cwd = updates.cwd;
          }

          if (Object.keys(paneUpdates).length > 0) {
            updatePane(windowId, firstPane.id, paneUpdates);
          }
        }
      }
    } catch (error) {
      console.error('Failed to update window:', error);
    }
  }, [updateWindow, updatePane, windowById]);

  const handleCloseEdit = useCallback(() => {
    setEditingWindow(null);
  }, []);

  // ==================== 组相关操作处理函数 ====================

  const handleGroupClick = useCallback(
    async (group: WindowGroup) => {
      onEnterGroup?.(group);
    },
    [onEnterGroup]
  );

  const handleStartAllWindows = useCallback(async (group: WindowGroup) => {
    try {
      const windowIds = groupWindowIdsByGroupId.get(group.id) ?? [];
      const windowsToStart = windowIds
        .map((windowId) => windowById.get(windowId))
        .filter((window): window is Window => Boolean(window));

      // 并发启动所有窗口
      await Promise.all(
        windowsToStart.map(async (win) => {
          await startWindow(win);
        })
      );
    } catch (error) {
      console.error('Failed to start all windows in group:', error);
    }
  }, [groupWindowIdsByGroupId, startWindow, windowById]);

  const handleDestroyAllWindowSessions = useCallback(async (group: WindowGroup) => {
    try {
      const windowIds = groupWindowIdsByGroupId.get(group.id) ?? [];
      const windowsToDestroy = windowIds
        .map((windowId) => windowById.get(windowId))
        .filter((window): window is Window => Boolean(window));

      // 并发销毁所有窗口会话
      await Promise.all(
        windowsToDestroy.map(async (win) => {
          try {
            if (isEphemeralSSHCloneWindow(win)) {
              await destroyWindowResourcesAndRemoveRecord(win.id);
              return;
            }

            await destroyWindowIds([win.id]);
          } catch (error) {
            console.error(`Failed to destroy window ${win.id}:`, error);
          }
        })
      );
    } catch (error) {
      console.error('Failed to destroy all windows in group:', error);
    }
  }, [destroyWindowIds, groupWindowIdsByGroupId, windowById]);

  const handleArchiveGroup = useCallback(async (group: WindowGroup) => {
    try {
      // 先销毁组内所有窗口会话
      await handleDestroyAllWindowSessions(group);

      // 调用 archiveGroup 方法（会自动归档组内所有窗口）
      archiveGroup(group.id);
    } catch (error) {
      console.error('Failed to archive group:', error);
    }
  }, [archiveGroup, handleDestroyAllWindowSessions]);

  const handleUnarchiveGroup = useCallback(async (group: WindowGroup) => {
    try {
      // 调用 unarchiveGroup 方法（会自动取消归档组内所有窗口）
      unarchiveGroup(group.id);
    } catch (error) {
      console.error('Failed to unarchive group:', error);
    }
  }, [unarchiveGroup]);

  const handleDeleteGroup = useCallback(async (groupId: string) => {
    try {
      removeGroup(groupId);
    } catch (error) {
      console.error('Failed to delete group:', error);
    }
  }, [removeGroup]);

  const handleEditGroup = useCallback((group: WindowGroup) => {
    setEditingGroup(group);
  }, []);

  const handleSaveGroupEdit = useCallback(async (groupId: string, updates: { name?: string }) => {
    try {
      // 调用 updateGroup 方法更新组名称
      updateGroup(groupId, updates);
    } catch (error) {
      console.error('Failed to update group:', error);
    }
  }, [updateGroup]);

  const handleCloseGroupEdit = useCallback(() => {
    setEditingGroup(null);
  }, []);

  // ==================== 拖拽处理 ====================

  const addGroup = useWindowStore((state) => state.addGroup);
  const findGroupByWindowId = useWindowStore((state) => state.findGroupByWindowId);
  const addWindowToGroupLayout = useWindowStore((state) => state.addWindowToGroupLayout);
  const removeWindowFromGroupLayout = useWindowStore((state) => state.removeWindowFromGroupLayout);

  /** 处理 WindowCard 拖拽到另一个 WindowCard 上 */
  const handleWindowCardDrop = useCallback(
    (dragItem: WindowCardDragItem, dropResult: DropResult) => {
      const { windowId: dragWindowId } = dragItem;
      const { targetCanvasWorkspaceId, targetGroupId, targetWindowId } = dropResult;

      if (targetWindowId && dragWindowId === targetWindowId) return;

      if (targetCanvasWorkspaceId) {
        const targetCanvasWorkspace = useWindowStore.getState().getCanvasWorkspaceById(targetCanvasWorkspaceId);
        const draggedWindow = windowById.get(dragWindowId);
        if (!targetCanvasWorkspace || !draggedWindow) return;

        const alreadyLinked = targetCanvasWorkspace.blocks.some((block) => (
          block.type === 'window' && block.windowId === dragWindowId
        ));
        if (alreadyLinked) return;

        const offsetIndex = targetCanvasWorkspace.blocks.filter((block) => block.type === 'window').length;
        updateCanvasWorkspace(targetCanvasWorkspace.id, {
          blocks: [
            ...targetCanvasWorkspace.blocks,
            createCanvasWindowBlock(
              draggedWindow,
              offsetIndex,
              targetCanvasWorkspace.nextZIndex,
              targetCanvasWorkspace.blocks,
            ),
          ],
          nextZIndex: targetCanvasWorkspace.nextZIndex + 1,
        });
        return;
      }

      const dragGroup = findGroupByWindowId(dragWindowId);
      const targetGroup = targetGroupId
        ? groups.find((group) => group.id === targetGroupId)
        : (targetWindowId ? findGroupByWindowId(targetWindowId) : undefined);
      if (dragGroup && targetGroup && dragGroup.id === targetGroup.id) return;

      if (targetGroup) {
        const targetWindowIds = getAllWindowIds(targetGroup.layout);
        const targetAnchorWindowId = targetWindowId ?? targetWindowIds[0];
        if (!targetAnchorWindowId) return;

        if (dragGroup) {
          removeWindowFromGroupLayout(dragGroup.id, dragWindowId);
        }

        const direction = (dropResult.position === 'left' || dropResult.position === 'right')
          ? 'horizontal'
          : 'vertical';

        addWindowToGroupLayout(targetGroup.id, targetAnchorWindowId, dragWindowId, direction);
        return;
      }

      if (!targetWindowId) return;

      if (!dragGroup && !targetGroup) {
        const dragWin = windowById.get(dragWindowId);
        const targetWin = windowById.get(targetWindowId);
        if (!dragWin || !targetWin) return;

        const direction = (dropResult.position === 'left' || dropResult.position === 'right')
          ? 'horizontal'
          : 'vertical';

        // 根据放置位置决定窗口顺序
        const isReversed = dropResult.position === 'left' || dropResult.position === 'top';
        const firstId = isReversed ? dragWindowId : targetWindowId;
        const secondId = isReversed ? targetWindowId : dragWindowId;

        const groupName = `${dragWin.name} + ${targetWin.name}`;
        const newGroup = createGroup(groupName, firstId, secondId, direction);
        addGroup(newGroup);
      }
    },
    [windowById, updateCanvasWorkspace, findGroupByWindowId, groups, removeWindowFromGroupLayout, addWindowToGroupLayout, addGroup]
  );

  // 是否为自定义分类标签
  const isCustomCategory = isCustomCategoryTab;

  // 自定义分类空状态
  if (isCustomCategory && cardItems.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-zinc-500">
        <Folder size={48} className="mb-4 opacity-50" />
        <p className="text-lg">{t('category.emptyTitle')}</p>
        <p className="text-sm mt-2">{t('category.emptyHint')}</p>
      </div>
    );
  }

  // 归档标签空状态
  if ((currentTab === 'archived' || currentTab === 'canvas') && cardItems.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-zinc-500">
        {currentTab === 'canvas' ? (
          <>
            <Folder size={48} className="mb-4 opacity-50" />
            <p className="text-lg">{t('canvas.emptyTitle')}</p>
            <p className="text-sm mt-2">{t('canvas.emptyDescription')}</p>
          </>
        ) : (
          <>
            <Archive size={48} className="mb-4 opacity-50" />
            <p className="text-lg">{t('archived.emptyTitle')}</p>
          </>
        )}
      </div>
    );
  }

  if (cardItems.length === 0) {
    return null;
  }

  return (
    <>
      <ScrollArea.Root className="h-full" data-testid="card-grid-scroll-root">
        <ScrollArea.Viewport className="h-full w-full">
          <div
            data-testid="card-grid"
            className="grid grid-cols-[repeat(auto-fill,minmax(350px,1fr))] gap-4 p-8"
          >
            {filteredCardItems.map((item) => {
              if (item.type === 'window') {
                const win = item.data;
                return (
                  <DraggableWindowCard
                    key={`window-${win.id}`}
                    windowId={win.id}
                    windowName={win.name}
                    source="cardGrid"
                  >
                    <DropZone
                      targetWindowId={win.id}
                      onDrop={handleWindowCardDrop}
                    >
                      <WindowCard
                        window={win}
                        onClick={handleCardClick}
                        onOpenFolder={handleOpenFolder}
                        onDelete={handleDeleteWindow}
                        onStart={handleStartWindow}
                        onDestroySession={handleDestroyWindowSession}
                        onArchive={handleArchiveWindow}
                        onUnarchive={handleUnarchiveWindow}
                        onOpenInIDE={handleOpenInIDE}
                        onEdit={handleEditWindow}
                      />
                    </DropZone>
                  </DraggableWindowCard>
                );
              }

              if (item.type === 'group') {
                const group = item.data;
                return (
                  <DraggableGroupCard
                    key={`group-${group.id}`}
                    groupId={group.id}
                    groupName={group.name}
                  >
                    <DropZone
                      targetGroupId={group.id}
                      onDrop={handleWindowCardDrop}
                    >
                      <GroupCard
                        group={group}
                        windows={getGroupWindows(group)}
                        onClick={handleGroupClick}
                        onDelete={handleDeleteGroup}
                        onStartAll={handleStartAllWindows}
                        onDestroyAllSessions={handleDestroyAllWindowSessions}
                        onArchive={handleArchiveGroup}
                        onUnarchive={handleUnarchiveGroup}
                        onEdit={handleEditGroup}
                      />
                    </DropZone>
                  </DraggableGroupCard>
                );
              }

              if (item.type === 'canvasWorkspace') {
                return (
                  <DropZone
                    key={`canvas-workspace-${item.data.id}`}
                    targetCanvasWorkspaceId={item.data.id}
                    onDrop={handleWindowCardDrop}
                  >
                    <CanvasWorkspaceCard
                      canvasWorkspace={item.data}
                      isStarted={startedCanvasWorkspaceIds.includes(item.data.id)}
                      onClick={onEnterCanvasWorkspace}
                      onStop={onStopCanvasWorkspace}
                      onRename={handleEditCanvasWorkspace}
                      onArchive={handleArchiveCanvasWorkspace}
                      onUnarchive={handleUnarchiveCanvasWorkspace}
                      onDelete={handleDeleteCanvasWorkspace}
                    />
                  </DropZone>
                );
              }

              const profile = item.data;
              const sshWindow = standaloneSSHWindowsByProfile[profile.id] ?? null;
              const sshCard = (
                <SSHProfileCard
                  key={`ssh-profile-${profile.id}`}
                  profile={profile}
                  window={sshWindow}
                  credentialState={sshCredentialStates[profile.id]}
                  isConnecting={connectingSSHProfileId === profile.id}
                  onConnect={handleConnectSSHProfile}
                  onOpenWindow={() => handleConnectSSHProfile(profile)}
                  onDestroyWindowSession={handleDestroySSHProfileWindowSession}
                  onStartWindow={() => handleConnectSSHProfile(profile)}
                  onArchiveWindow={handleArchiveWindow}
                  onUnarchiveWindow={handleUnarchiveWindow}
                  onEdit={handleEditSSHProfile}
                  onDuplicate={handleDuplicateSSHProfile}
                  onDelete={handleDeleteSSHProfile}
                />
              );

              // 有关联窗口时支持拖拽组合
              if (sshWindow) {
                return (
                  <DraggableWindowCard
                    key={`ssh-profile-${profile.id}`}
                    windowId={sshWindow.id}
                    windowName={sshWindow.name}
                    source="cardGrid"
                  >
                    <DropZone
                      targetWindowId={sshWindow.id}
                      onDrop={handleWindowCardDrop}
                    >
                      {sshCard}
                    </DropZone>
                  </DraggableWindowCard>
                );
              }

              return (
                <DraggableSSHProfileCard
                  key={`ssh-profile-${profile.id}`}
                  profileId={profile.id}
                  profileName={profile.name}
                >
                  {sshCard}
                </DraggableSSHProfileCard>
              );
            })}
            {!searchQuery && <NewWindowCard onClick={onCreateWindow || (() => {})} />}
          </div>
          {/* 无搜索结果提示 */}
          {searchQuery && filteredCardItems.length === 0 && (
            <div className="flex h-64 flex-col items-center justify-center text-[rgb(var(--muted-foreground))]">
              <Search size={48} className="mb-4 opacity-50" />
              <p className="text-lg">{t('common.noMatchingWindows')}</p>
              <p className="text-sm mt-2">{t('common.tryDifferentSearch')}</p>
            </div>
          )}
        </ScrollArea.Viewport>
        <ScrollArea.Scrollbar
          orientation="vertical"
          className="flex w-2.5 touch-none select-none bg-transparent p-0.5 transition-colors hover:bg-[rgb(var(--accent))]/50"
        >
          <ScrollArea.Thumb className="relative flex-1 rounded-full bg-[rgb(var(--muted))] transition-colors hover:bg-[rgb(var(--muted-foreground))]" />
        </ScrollArea.Scrollbar>
      </ScrollArea.Root>

      <MissingWorkingDirectoryDialog {...dialogState} />

      <DeleteWindowDialog {...deleteDialogState} />

      <DeleteSSHCardDialog
        open={Boolean(sshDeleteTarget)}
        profileName={sshDeleteTarget?.name ?? ''}
        associatedWindowCount={sshDeleteAssociatedWindows.length}
        blockingWindowCount={sshDeleteBlockingWindowCount}
        error={sshDeleteError}
        isProcessing={isDeletingSSHCard}
        onOpenChange={handleSSHDeleteOpenChange}
        onConfirm={confirmDeleteSSHCard}
      />

      {editingWindow && (
        <EditWindowPanel
          window={editingWindow}
          onClose={handleCloseEdit}
          onSave={handleSaveEdit}
        />
      )}

      {editingGroup && (
        <EditGroupPanel
          group={editingGroup}
          onClose={handleCloseGroupEdit}
          onSave={handleSaveGroupEdit}
        />
      )}

      {showCreateGroupDialog && (
        <CreateGroupDialog
          open={showCreateGroupDialog}
          onOpenChange={setShowCreateGroupDialog}
        />
      )}

      <Dialog
        open={Boolean(editingCanvasWorkspace)}
        onOpenChange={(open) => {
          if (!open) {
            setEditingCanvasWorkspace(null);
            setCanvasWorkspaceNameDraft('');
          }
        }}
        title={t('canvas.renameWorkspace')}
        description={t('canvas.renameWorkspaceDescription')}
        contentClassName="!max-w-lg"
        showCloseButton
        closeLabel={t('common.close')}
      >
        <div className="space-y-4">
          <input
            value={canvasWorkspaceNameDraft}
            onChange={(event) => setCanvasWorkspaceNameDraft(event.target.value)}
            autoFocus
            aria-label={t('canvas.workspaceName')}
            className="w-full rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--background))] px-3 py-2.5 text-sm text-[rgb(var(--foreground))] outline-none"
          />
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => {
                setEditingCanvasWorkspace(null);
                setCanvasWorkspaceNameDraft('');
              }}
              className="inline-flex items-center rounded-xl border border-[rgb(var(--border))] px-4 py-2 text-sm text-[rgb(var(--foreground))]"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={handleSaveCanvasWorkspaceEdit}
              className="inline-flex items-center rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--accent))] px-4 py-2 text-sm text-[rgb(var(--foreground))]"
            >
              {t('common.save')}
            </button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={Boolean(canvasWorkspaceDeleteTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setCanvasWorkspaceDeleteTarget(null);
          }
        }}
        title={t('canvas.deleteWorkspace')}
        description={t('canvas.deleteWorkspaceDescription')}
        contentClassName="!max-w-lg"
        showCloseButton
        closeLabel={t('common.close')}
      >
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => setCanvasWorkspaceDeleteTarget(null)}
            className="inline-flex items-center rounded-xl border border-[rgb(var(--border))] px-4 py-2 text-sm text-[rgb(var(--foreground))]"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={confirmDeleteCanvasWorkspace}
            className="inline-flex items-center rounded-xl border border-red-500/30 bg-red-500/12 px-4 py-2 text-sm text-red-200"
          >
            {t('common.delete')}
          </button>
        </div>
      </Dialog>
    </>
  );
});

CardGrid.displayName = 'CardGrid';
