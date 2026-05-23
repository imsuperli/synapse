import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Search } from 'lucide-react';
import { useWindowStore } from '../stores/windowStore';
import { QuickSwitcherItem } from './QuickSwitcherItem';
import { QuickSwitcherGroupItem } from './QuickSwitcherGroupItem';
import { QuickSwitcherCanvasItem } from './QuickSwitcherCanvasItem';
import { fuzzyMatch } from '../utils/fuzzySearch';
import { Pane, Window, WindowStatus } from '../types/window';
import { WindowGroup } from '../../shared/types/window-group';
import { CanvasWorkspace } from '../../shared/types/canvas';
import { getAggregatedStatus, getAllPanes } from '../utils/layoutHelpers';
import { getCurrentWindowTerminalPane, getCurrentWindowWorkingDirectory } from '../utils/windowWorkingDirectory';
import { getStandaloneSSHProfileId, getStandaloneWindows } from '../utils/sshWindowBindings';
import { useI18n } from '../i18n';
import type { SSHProfile } from '../../shared/types/ssh';
import { getAllWindowIds } from '../utils/groupLayoutHelpers';
import { getWindowKind } from '../../shared/utils/terminalCapabilities';
import {
  IdePopupShell,
  idePopupBadgeClassName,
  idePopupOverlayClassName,
  idePopupScrollAreaClassName,
  idePopupSectionClassName,
  idePopupTitleClassName,
} from './ui/ide-popup';

const QUICK_SWITCHER_KEYCAP_CLASS_NAME = `rounded border px-1.5 py-0.5 ${idePopupBadgeClassName('zinc')}`;

interface QuickSwitcherProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (windowId: string) => void;
  onSelectGroup?: (groupId: string) => void;
  onSelectCanvas?: (canvasWorkspaceId: string) => void;
  currentWindowId: string | null;
  currentGroupId?: string | null;
  currentCanvasWorkspaceId?: string | null;
  sshProfiles?: SSHProfile[];
}

// 统一的列表项类型
type SwitcherItem =
  | {
      type: 'window';
      data: Window;
      displayName: string;
      secondaryText: string;
      status: WindowStatus;
      panes: Pane[];
      windowKind: NonNullable<Window['kind']>;
      activePane: Pane | null;
      workingDirectory: string;
      priority: number;
      lastActiveAtTime: number;
      searchTerms: string[];
    }
  | {
      type: 'group';
      data: WindowGroup;
      windowCount: number;
      windowStatuses: Array<{ id: string; status: WindowStatus }>;
      priority: number;
      lastActiveAtTime: number;
      searchTerms: string[];
    }
  | {
      type: 'canvas';
      data: CanvasWorkspace;
      blockCount: number;
      priority: number;
      lastActiveAtTime: number;
      searchTerms: string[];
    };

function getWindowPriority(window: Window, status: WindowStatus): number {
  if (window.archived) return 4;

  switch (status) {
    case WindowStatus.WaitingForInput:
      return 1;
    case WindowStatus.Running:
      return 2;
    case WindowStatus.Completed:
      return 3;
    default:
      return 3;
  }
}

function getGroupPriority(group: WindowGroup): number {
  return group.archived ? 4 : 0;
}

function getCanvasPriority(canvasWorkspace: CanvasWorkspace): number {
  return canvasWorkspace.archived ? 4 : 0;
}

/**
 * 快速切换面板组件（Ctrl+Tab）
 * 支持搜索和键盘导航，同时显示窗口和窗口组
 */
export const QuickSwitcher: React.FC<QuickSwitcherProps> = ({
  isOpen,
  onClose,
  onSelect,
  onSelectGroup,
  onSelectCanvas,
  currentWindowId,
  currentGroupId,
  currentCanvasWorkspaceId,
  sshProfiles = [],
}) => {
  const { t } = useI18n();
  const windows = useWindowStore((state) => state.windows);
  const groups = useWindowStore((state) => state.groups);
  const canvasWorkspaces = useWindowStore((state) => state.canvasWorkspaces);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);
  const sshProfilesById = useMemo(
    () => new Map(sshProfiles.map((profile) => [profile.id, profile])),
    [sshProfiles],
  );
  const visibleWindows = useMemo(() => getStandaloneWindows(windows), [windows]);
  const preparedWindows = useMemo(() => (
    visibleWindows.map((window) => {
      const panes = getAllPanes(window.layout);
      const status = getAggregatedStatus(window.layout);
      const profileId = getStandaloneSSHProfileId(window);
      const profile = profileId ? sshProfilesById.get(profileId) : undefined;
      const workingDirectory = getCurrentWindowWorkingDirectory(window);
      const activePane = getCurrentWindowTerminalPane(window);
      const windowKind = getWindowKind(window);

      if (!profile) {
        return {
          type: 'window' as const,
          data: window,
          displayName: window.name,
          secondaryText: workingDirectory,
          status,
          panes,
          windowKind,
          activePane,
          workingDirectory,
          priority: getWindowPriority(window, status),
          lastActiveAtTime: new Date(window.lastActiveAt).getTime(),
          searchTerms: [window.name, workingDirectory],
        };
      }

      const targetLabel = `${profile.user}@${profile.host}:${profile.port}`;
      const remoteCwd = workingDirectory || profile.defaultRemoteCwd || '';
      const secondaryText = remoteCwd ? `${targetLabel} | ${remoteCwd}` : targetLabel;

      return {
        type: 'window' as const,
        data: window,
        displayName: profile.name,
        secondaryText,
        status,
        panes,
        windowKind,
        activePane,
        workingDirectory,
        priority: getWindowPriority(window, status),
        lastActiveAtTime: new Date(window.lastActiveAt).getTime(),
        searchTerms: [
          profile.name,
          window.name,
          targetLabel,
          workingDirectory,
          profile.defaultRemoteCwd || '',
          profile.host,
          profile.user,
          profile.notes || '',
          ...profile.tags,
        ],
      };
    })
  ), [sshProfilesById, visibleWindows]);
  const preparedGroups = useMemo(() => {
    const windowById = new Map(preparedWindows.map((item) => [item.data.id, item]));

    return groups.map((group) => {
      const windowIds = getAllWindowIds(group.layout);
      const windowStatuses = windowIds.flatMap((windowId) => {
        const item = windowById.get(windowId);
        return item ? [{ id: windowId, status: item.status }] : [];
      });

      return {
        type: 'group' as const,
        data: group,
        windowCount: windowIds.length,
        windowStatuses,
        priority: getGroupPriority(group),
        lastActiveAtTime: new Date(group.lastActiveAt).getTime(),
        searchTerms: [group.name],
      };
    });
  }, [groups, preparedWindows]);
  const preparedCanvasWorkspaces = useMemo(() => (
    canvasWorkspaces.map((canvasWorkspace) => ({
      type: 'canvas' as const,
      data: canvasWorkspace,
      blockCount: canvasWorkspace.blocks.length,
      priority: getCanvasPriority(canvasWorkspace),
      lastActiveAtTime: new Date(canvasWorkspace.updatedAt).getTime(),
      searchTerms: [
        canvasWorkspace.name,
        canvasWorkspace.workingDirectory ?? '',
        ...canvasWorkspace.blocks.map((block) => block.label ?? ''),
        ...canvasWorkspace.blocks.flatMap((block) => block.type === 'note' ? [block.content] : []),
      ],
    }))
  ), [canvasWorkspaces]);

  // 过滤并合并窗口、窗口组和画布
  const filteredItems = useMemo(() => {
    const filteredWindows: SwitcherItem[] = preparedWindows.filter((item) => (
      item.searchTerms.some((value) => fuzzyMatch(query, value))
    ));

    const filteredGroups: SwitcherItem[] = preparedGroups.filter((item) => (
      item.searchTerms.some((value) => fuzzyMatch(query, value))
    ));

    const filteredCanvasWorkspaces: SwitcherItem[] = preparedCanvasWorkspaces.filter((item) => (
      item.searchTerms.some((value) => fuzzyMatch(query, value))
    ));

    return [...filteredCanvasWorkspaces, ...filteredGroups, ...filteredWindows].sort((a, b) => {
      if (a.type === 'window' && a.data.id === currentWindowId) return -1;
      if (b.type === 'window' && b.data.id === currentWindowId) return 1;
      if (a.type === 'group' && a.data.id === currentGroupId) return -1;
      if (b.type === 'group' && b.data.id === currentGroupId) return 1;
      if (a.type === 'canvas' && a.data.id === currentCanvasWorkspaceId) return -1;
      if (b.type === 'canvas' && b.data.id === currentCanvasWorkspaceId) return 1;

      if (a.type === 'canvas' && b.type !== 'canvas') return -1;
      if (b.type === 'canvas' && a.type !== 'canvas') return 1;
      if (a.type === 'group' && b.type === 'window') return -1;
      if (a.type === 'window' && b.type === 'group') return 1;

      if (a.type === 'window' && b.type === 'window') {
        const priorityA = a.priority;
        const priorityB = b.priority;

        if (priorityA !== priorityB) {
          return priorityA - priorityB;
        }

        return b.lastActiveAtTime - a.lastActiveAtTime;
      }

      if (a.type === 'group' && b.type === 'group') {
        const priorityA = a.priority;
        const priorityB = b.priority;

        if (priorityA !== priorityB) {
          return priorityA - priorityB;
        }

        return b.lastActiveAtTime - a.lastActiveAtTime;
      }

      if (a.type === 'canvas' && b.type === 'canvas') {
        const priorityA = a.priority;
        const priorityB = b.priority;

        if (priorityA !== priorityB) {
          return priorityA - priorityB;
        }

        return b.lastActiveAtTime - a.lastActiveAtTime;
      }

      return 0;
    });
  }, [preparedWindows, preparedGroups, preparedCanvasWorkspaces, query, currentWindowId, currentGroupId, currentCanvasWorkspaceId]);

  useEffect(() => {
    if (!filteredItems.length) {
      setSelectedIndex(0);
      return;
    }

    setSelectedIndex((prev) => Math.min(prev, filteredItems.length - 1));
  }, [filteredItems.length]);

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      setQuery('');
      setSelectedIndex(0);

      const animationFrameId = requestAnimationFrame(() => {
        setIsAnimating(true);
      });

      const focusTimerId = window.setTimeout(() => {
        inputRef.current?.focus();
      }, 50);

      return () => {
        cancelAnimationFrame(animationFrameId);
        window.clearTimeout(focusTimerId);
      };
    }

    setIsAnimating(false);
    const timerId = window.setTimeout(() => {
      setShouldRender(false);
    }, 200);

    return () => window.clearTimeout(timerId);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const moveSelection = (direction: 1 | -1) => {
      if (!filteredItems.length) {
        return;
      }

      setSelectedIndex((prev) => (prev + direction + filteredItems.length) % filteredItems.length);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          e.stopPropagation();
          moveSelection(1);
          break;
        case 'ArrowUp':
          e.preventDefault();
          e.stopPropagation();
          moveSelection(-1);
          break;
        case 'Tab':
          e.preventDefault();
          e.stopPropagation();
          moveSelection(e.shiftKey ? -1 : 1);
          break;
        case 'Enter':
          e.preventDefault();
          e.stopPropagation();
            if (filteredItems[selectedIndex]) {
              const item = filteredItems[selectedIndex];
              if (item.type === 'window') {
                onSelect(item.data.id);
              } else if (item.type === 'group' && onSelectGroup) {
                onSelectGroup(item.data.id);
              } else if (item.type === 'canvas' && onSelectCanvas) {
                onSelectCanvas(item.data.id);
              }
              onClose();
            }
          break;
        case 'Escape':
          e.preventDefault();
          e.stopPropagation();
          onClose();
          break;
      }

      if (e.ctrlKey && e.key === 'n') {
        e.preventDefault();
        e.stopPropagation();
        moveSelection(1);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, filteredItems, selectedIndex, onSelect, onSelectGroup, onSelectCanvas, onClose]);

  useEffect(() => {
    if (!listRef.current || !filteredItems.length) {
      return;
    }

    const selectedElement = listRef.current.children[selectedIndex] as HTMLElement | undefined;
    selectedElement?.scrollIntoView({ block: 'nearest' });
  }, [filteredItems.length, selectedIndex]);

  if (!shouldRender) return null;

  return (
    <>
      <div
        className={`${idePopupOverlayClassName} z-[2000] transition-opacity duration-200 ${
          isAnimating ? 'opacity-60' : 'opacity-0'
        }`}
        onClick={onClose}
      />

      <div
        className={`fixed top-[15%] left-1/2 -translate-x-1/2 z-[2001] w-[800px] max-w-[90vw] transition-all duration-200 ${
          isAnimating ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
        }`}
      >
        <IdePopupShell className="flex max-h-[72vh] flex-col">
          <div className={`${idePopupSectionClassName} px-5 py-3`}>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className={idePopupTitleClassName}>{t('quickSwitcher.title')}</div>
              </div>
              {query ? (
                <span className="rounded-md border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--secondary))_72%,transparent)] px-2 py-1 text-[11px] text-[rgb(var(--muted-foreground))]">
                  {t('quickSwitcher.resultsCount', { count: filteredItems.length })}
                </span>
              ) : null}
            </div>
          </div>

          <div className="border-b border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--secondary))_82%,transparent)] px-5 py-3">
            <div className="flex items-center gap-3">
              <Search size={20} className="shrink-0 text-[rgb(var(--muted-foreground))]" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSelectedIndex(0);
                }}
                placeholder={t('quickSwitcher.searchPlaceholder')}
                className="flex-1 bg-transparent text-base text-[rgb(var(--foreground))] outline-none placeholder:text-[rgb(var(--muted-foreground))]"
              />
            </div>
          </div>

          <div
            ref={listRef}
            className={`max-h-[500px] overflow-y-auto py-2 ${idePopupScrollAreaClassName}`}
            style={{
              scrollbarWidth: 'thin',
              scrollbarColor: 'rgb(var(--border)) transparent',
            }}
          >
            {filteredItems.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <div className="mb-2 text-sm text-[rgb(var(--foreground))]">{t('quickSwitcher.noResults')}</div>
                <div className="text-xs text-[rgb(var(--muted-foreground))]">
                  {query ? t('quickSwitcher.noResultsHint') : t('quickSwitcher.emptyHint')}
                </div>
              </div>
            ) : (
              filteredItems.map((item, index) => (
                <div
                  key={item.type === 'window' ? `window-${item.data.id}` : item.type === 'group' ? `group-${item.data.id}` : `canvas-${item.data.id}`}
                  onClick={() => {
                    if (item.type === 'window') {
                      onSelect(item.data.id);
                    } else if (item.type === 'group' && onSelectGroup) {
                      onSelectGroup(item.data.id);
                    } else if (item.type === 'canvas' && onSelectCanvas) {
                      onSelectCanvas(item.data.id);
                    }
                    onClose();
                  }}
                >
                  {item.type === 'window' ? (
                    <QuickSwitcherItem
                      window={item.data}
                      displayName={item.displayName}
                      secondaryText={item.secondaryText}
                      status={item.status}
                      panes={item.panes}
                      windowKind={item.windowKind}
                      activePane={item.activePane}
                      workingDirectory={item.workingDirectory}
                      isSelected={index === selectedIndex}
                      query={query}
                    />
                  ) : item.type === 'group' ? (
                    <QuickSwitcherGroupItem
                      group={item.data}
                      windowCount={item.windowCount}
                      windowStatuses={item.windowStatuses}
                      isSelected={index === selectedIndex}
                      query={query}
                    />
                  ) : (
                    <QuickSwitcherCanvasItem
                      canvasWorkspace={item.data}
                      isSelected={index === selectedIndex}
                      query={query}
                    />
                  )}
                </div>
              ))
            )}
          </div>

          <div className="border-t border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--secondary))_72%,transparent)] px-5 py-3 text-xs text-[rgb(var(--muted-foreground))]">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1">
                <kbd className={QUICK_SWITCHER_KEYCAP_CLASS_NAME}>↑↓</kbd>
                <span>{t('quickSwitcher.select')}</span>
              </span>
              <span className="flex items-center gap-1">
                <kbd className={QUICK_SWITCHER_KEYCAP_CLASS_NAME}>Enter</kbd>
                <span>{t('quickSwitcher.switch')}</span>
              </span>
              <span className="flex items-center gap-1">
                <kbd className={QUICK_SWITCHER_KEYCAP_CLASS_NAME}>Esc</kbd>
                <span>{t('quickSwitcher.cancel')}</span>
              </span>
            </div>
          </div>
        </IdePopupShell>
      </div>
    </>
  );
};

QuickSwitcher.displayName = 'QuickSwitcher';
