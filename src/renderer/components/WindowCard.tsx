import React, { useMemo, useCallback } from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { FolderOpen, Trash2, Play, Square, Loader2, Archive, ArchiveRestore, Edit2, ChevronDown, MoreHorizontal } from 'lucide-react';
import { Pane, Window, WindowStatus } from '../types/window';
import { getStatusLabelKey, getStatusColorValue } from '../utils/statusHelpers';
import { getAggregatedStatusFromPanes, getAllPanes } from '../utils/layoutHelpers';
import { StatusDot } from './StatusDot';
import { IDEIcon } from './icons/IDEIcons';
import { TerminalTypeLogo } from './icons/TerminalTypeLogo';
import { useIDESettings } from '../hooks/useIDESettings';
import { ProjectLinks } from './ProjectLinks';
import { formatRelativeTime, useI18n } from '../i18n';
import { canPaneOpenInIDE, canPaneOpenLocalFolder, getPaneBackend, isTerminalPane } from '../../shared/utils/terminalCapabilities';
import {
  ideMenuContentClassName,
  ideMenuDangerItemClassName,
  ideMenuItemClassName,
  IdeMenuItemContent,
} from './ui/ide-menu';
import {
  idePopupInteractiveListCardClassName,
  idePopupListCardFooterClassName,
  idePopupPillClassName,
  idePopupTonalButtonClassName,
  idePopupTooltipClassName,
} from './ui/ide-popup';

interface WindowCardProps {
  window: Window;
  onClick?: (window: Window) => void;
  onOpenFolder?: (window: Window) => void;
  onDelete?: (windowId: string) => void;
  onStart?: (window: Window) => void;
  onDestroySession?: (window: Window) => void;
  onArchive?: (window: Window) => void;
  onUnarchive?: (window: Window) => void;
  onOpenInIDE?: (ide: string, window: Window) => void;
  onEdit?: (window: Window) => void;
}

/**
 * 智能截断路径，保留完整的文件夹名称，中间用...替代
 * 根据路径长度动态调整保留的层级数
 * @param path 完整路径
 */
function truncatePath(path: string): string {
  // 统一使用正斜杠分割路径
  const normalizedPath = path.replace(/\\/g, '/');
  const segments = normalizedPath.split('/').filter(s => s.length > 0);

  // 检测是否是 Windows 路径（包含盘符）
  const isWindowsPath = /^[A-Za-z]:/.test(path);

  // 如果路径段数较少，直接返回
  if (segments.length <= 4) {
    return path;
  }

  // 根据路径长度动态调整保留的层级数
  const pathLength = path.length;
  let keepSegments = 2; // 默认前后各保留2层

  if (pathLength > 100) {
    keepSegments = 2; // 很长的路径，前后各保留2层
  } else if (pathLength > 70) {
    keepSegments = 2; // 中等长度，前后各保留2层
  } else {
    keepSegments = 3; // 较短路径，前后各保留3层
  }

  // 如果段数不超过保留数的两倍，直接返回
  if (segments.length <= keepSegments * 2) {
    return path;
  }

  // 保留前 keepSegments 段和后 keepSegments 段
  const prefix = segments.slice(0, keepSegments).join('/');
  const suffix = segments.slice(-keepSegments).join('/');

  if (isWindowsPath) {
    // Windows 路径：保持反斜杠格式
    return `${prefix.replace(/\//g, '\\\\')}\\...\\${suffix.replace(/\//g, '\\\\')}`;
  } else {
    // Unix 路径：使用正斜杠
    return `${prefix}/.../${suffix}`;
  }
}

function getWindowKindFromPanes(window: Window, panes: Pane[]): NonNullable<Window['kind']> {
  if (window.kind) {
    return window.kind;
  }

  const backends = new Set<string>();
  for (const pane of panes) {
    if (isTerminalPane(pane)) {
      backends.add(getPaneBackend(pane));
    }
  }

  if (backends.size === 0) {
    return 'local';
  }

  if (backends.size === 1) {
    return backends.has('ssh') ? 'ssh' : 'local';
  }

  return 'mixed';
}

function findActiveTerminalPane(panes: Pane[], activePaneId: string): Pane | null {
  return panes.find((pane) => pane.id === activePaneId && isTerminalPane(pane))
    ?? panes.find((pane) => isTerminalPane(pane))
    ?? null;
}

function getCardTopBorderColor(status: WindowStatus): string {
  if (status === WindowStatus.Completed || status === WindowStatus.Paused) {
    return 'rgb(var(--border))';
  }

  return getStatusColorValue(status);
}

/**
 * WindowCard 组件
 * 显示单个窗口的关键信息和状态
 */
export const WindowCard = React.memo<WindowCardProps>(({
  window,
  onClick,
  onOpenFolder,
  onDelete,
  onStart,
  onDestroySession,
  onArchive,
  onUnarchive,
  onOpenInIDE,
  onEdit
}) => {
  const { enabledIDEs } = useIDESettings();
  const { language, t } = useI18n();

  const {
    activeTerminalPane,
    aggregatedStatus,
    paneCount,
    panes,
    windowKind,
    workingDirectory,
  } = useMemo(() => {
    const nextPanes = getAllPanes(window.layout);
    const nextActiveTerminalPane = findActiveTerminalPane(nextPanes, window.activePaneId);
    const nextWorkingDirectory = nextActiveTerminalPane?.cwd || '';

    if (process.env.NODE_ENV === 'development' && !nextWorkingDirectory) {
      console.warn(`[WindowCard] Window "${window.name}" (${window.id}) has no cwd. Panes:`, nextPanes);
    }

    return {
      activeTerminalPane: nextActiveTerminalPane,
      aggregatedStatus: getAggregatedStatusFromPanes(nextPanes),
      paneCount: nextPanes.length,
      panes: nextPanes,
      windowKind: getWindowKindFromPanes(window, nextPanes),
      workingDirectory: nextWorkingDirectory,
    };
  }, [window]);

  // 检查是否有项目链接
  const hasProjectLinks = useMemo(
    () => Boolean(window.projectConfig?.links && window.projectConfig.links.length > 0),
    [window.projectConfig]
  );

  // 检查是否有左侧快捷方式
  const hasLeftShortcuts = useMemo(
    () => Boolean(
      (activeTerminalPane && canPaneOpenLocalFolder(activeTerminalPane) && workingDirectory)
      || (activeTerminalPane && canPaneOpenInIDE(activeTerminalPane) && enabledIDEs.length > 0)
    ),
    [activeTerminalPane, enabledIDEs.length, workingDirectory]
  );

  // 缓存状态标签
  const statusLabel = useMemo(() => t(getStatusLabelKey(aggregatedStatus)), [aggregatedStatus, t]);
  const tooltipClassName = idePopupTooltipClassName;
  const cardButtonClassName = `${idePopupTonalButtonClassName} shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]`;

  // 缓存格式化的上次运行时间（移除"不到"、"大约"等字样）
  const formattedLastActiveTime = useMemo(() => {
    try {
      return formatRelativeTime(window.lastActiveAt, language);
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.error('Failed to format time:', error, 'lastActiveAt:', window.lastActiveAt);
      }
      return t('common.unknown');
    }
  }, [language, t, window.lastActiveAt]);

  // 缓存格式化的创建时间
  const formattedCreatedTime = useMemo(() => {
    try {
      return new Intl.DateTimeFormat(language, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(window.createdAt));
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.error('Failed to format created time:', error, 'createdAt:', window.createdAt);
      }
      return t('common.unknown');
    }
  }, [language, t, window.createdAt]);

  // 缓存截断后的路径
  const truncatedPath = useMemo(
    () => workingDirectory ? truncatePath(workingDirectory) : '',
    [workingDirectory]
  );

  // 缓存 aria-label
  const ariaLabel = useMemo(
    () => t('windowCard.ariaLabel', { name: window.name, status: statusLabel, cwd: workingDirectory, count: paneCount }),
    [paneCount, statusLabel, t, window.name, workingDirectory]
  );

  // 稳定的键盘事件处理
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onClick?.(window);
      }
    },
    [onClick, window]
  );

  // 阻止按钮点击事件冒泡
  const handleButtonClick = useCallback(
    (e: React.MouseEvent, action: () => void) => {
      e.stopPropagation();
      action();
      // 点击后移除焦点，避免focus样式残留
      (e.currentTarget as HTMLElement).blur();
    },
    []
  );

  // 打开外部链接
  const handleOpenLink = useCallback(
    (e: React.MouseEvent, url: string) => {
      e.stopPropagation();

      // 使用 globalThis 访问全局 window 对象，避免与 prop window 冲突
      if (!globalThis.electronAPI?.openExternalUrl) {
        console.error('openExternalUrl is not available');
        return;
      }

      globalThis.electronAPI.openExternalUrl(url)
        .catch((error: Error) => {
          console.error('Failed to open URL:', error);
        });
    },
    []
  );

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onClick?.(window)}
      onKeyDown={handleKeyDown}
      aria-label={ariaLabel}
      className={`${idePopupInteractiveListCardClassName} flex h-56 min-w-[280px] flex-col`}
      style={{ borderTop: `1px solid ${getCardTopBorderColor(aggregatedStatus)}` }}
    >
      {/* 启动中加载遮罩 */}
      {aggregatedStatus === WindowStatus.Restoring && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-lg bg-[color-mix(in_srgb,rgb(var(--background))_88%,black)] transition-opacity duration-200">
          <Loader2 className="w-12 h-12 text-[rgb(var(--primary))] animate-spin" />
          <div className="text-sm font-medium text-[rgb(var(--foreground))]">{t('windowCard.startingTerminal')}</div>
          <div className="text-xs text-[rgb(var(--muted-foreground))]">{t('windowCard.pleaseWait')}</div>
        </div>
      )}

      {/* 卡片内容 - 占据剩余空间 */}
      <div className="flex-1 p-4 space-y-2 flex flex-col min-h-0">
        {/* 第一行：窗口名称 + 窗格数量 + 状态 */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <TerminalTypeLogo
              variant={windowKind === 'mixed' ? 'mixed' : windowKind === 'ssh' ? 'ssh' : 'local'}
              size="md"
              data-testid={`window-card-logo-${windowKind}`}
            />
            <h3 className="text-base font-semibold text-[rgb(var(--foreground))] truncate">
              {window.name}
            </h3>
            {paneCount > 1 && (
              <span className={`${idePopupPillClassName} flex-shrink-0 py-0.5 text-[rgb(var(--muted-foreground))]`}>
                {t('windowCard.panesCount', { count: paneCount })}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* 始终显示每个窗格的状态圆点 */}
            <div className="flex items-center gap-1.5">
              {panes.map((pane, index) => (
                <Tooltip.Provider key={pane.id}>
                  <Tooltip.Root delayDuration={300}>
                    <Tooltip.Trigger asChild>
                      <div>
                        <StatusDot
                          status={pane.status}
                          size="sm"
                        />
                      </div>
                    </Tooltip.Trigger>
                    <Tooltip.Portal>
                      <Tooltip.Content
                        className={tooltipClassName}
                        side="top"
                        sideOffset={5}
                      >
                        {t('windowCard.pane', { index: index + 1, status: t(getStatusLabelKey(pane.status)) })}
                      </Tooltip.Content>
                    </Tooltip.Portal>
                  </Tooltip.Root>
                </Tooltip.Provider>
              ))}
            </div>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button
                  type="button"
                  aria-label={t('common.more')}
                  onClick={(event) => event.stopPropagation()}
                  className={`flex h-8 w-8 items-center justify-center ${cardButtonClassName}`}
                >
                  <MoreHorizontal size={15} />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  className={`${ideMenuContentClassName} !min-w-[140px]`}
                  side="bottom"
                  align="end"
                  sideOffset={6}
                  onClick={(event) => event.stopPropagation()}
                >
                  {!window.archived ? (
                    <DropdownMenu.Item
                      className={ideMenuItemClassName}
                      onSelect={() => onArchive?.(window)}
                      aria-label={t('terminalView.archive')}
                    >
                      <IdeMenuItemContent icon={<Archive size={14} />} label={t('terminalView.archive')} />
                    </DropdownMenu.Item>
                  ) : (
                    <DropdownMenu.Item
                      className={ideMenuItemClassName}
                      onSelect={() => onUnarchive?.(window)}
                      aria-label={t('windowCard.unarchive')}
                    >
                      <IdeMenuItemContent icon={<ArchiveRestore size={14} />} label={t('windowCard.unarchive')} />
                    </DropdownMenu.Item>
                  )}

                  <DropdownMenu.Item
                    className={ideMenuItemClassName}
                    onSelect={() => onEdit?.(window)}
                    aria-label={t('windowCard.edit')}
                  >
                    <IdeMenuItemContent icon={<Edit2 size={14} />} label={t('windowCard.edit')} />
                  </DropdownMenu.Item>

                  <DropdownMenu.Item
                    className={ideMenuDangerItemClassName}
                    onSelect={() => onDelete?.(window.id)}
                    aria-label={t('common.deleteWindow')}
                  >
                    <IdeMenuItemContent icon={<Trash2 size={14} />} label={t('common.deleteWindow')} />
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
        </div>

        {/* 标题分割线 */}
        <div className="border-t border-[rgb(var(--border))]" />

        {/* 第二行：工作目录路径（小字体，单行显示） */}
        <Tooltip.Provider>
          <Tooltip.Root delayDuration={500}>
            <Tooltip.Trigger asChild>
              <p
                data-testid="working-directory"
                className="text-xs text-[rgb(var(--muted-foreground))] truncate pr-1 min-h-[1.25rem] opacity-80"
              >
                {truncatedPath || `(${t('windowCard.noWorkingDirectory')})`}
              </p>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content
                className={`${tooltipClassName} max-w-md break-all px-3 py-2 text-sm`}
                side="top"
                sideOffset={5}
              >
                {workingDirectory || `(${t('windowCard.noWorkingDirectory')})`}
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        </Tooltip.Provider>

        {/* 第三行：时间信息 */}
        <div className="flex flex-1 flex-wrap content-start items-start justify-between gap-x-4 gap-y-1">
          <div className="flex min-w-0 items-center gap-1.5 whitespace-nowrap">
            <span className="text-xs text-[rgb(var(--muted-foreground))]">
              {t('windowCard.createdAt')}
            </span>
            <span className="flex-shrink-0 text-xs text-[rgb(var(--muted-foreground))]">
              {formattedCreatedTime}
            </span>
          </div>
          <div className="ml-auto flex min-w-0 items-center gap-1.5 whitespace-nowrap">
            <span className="text-xs text-[rgb(var(--muted-foreground))]">
              {t('windowCard.lastRun')}
            </span>
            <span className="flex-shrink-0 text-xs text-[rgb(var(--muted-foreground))]">
              {formattedLastActiveTime}
            </span>
          </div>
        </div>
      </div>

      {/* 底部按钮栏 */}
      <div className={`${idePopupListCardFooterClassName} relative flex flex-shrink-0 flex-wrap items-center gap-1.5 !border-t-transparent px-4 py-2 before:absolute before:left-4 before:right-4 before:top-0 before:border-t before:border-[rgb(var(--border))] before:content-['']`}>
        {aggregatedStatus === WindowStatus.Completed && (
          <Tooltip.Provider>
            <Tooltip.Root delayDuration={300}>
              <Tooltip.Trigger asChild>
                <button
                  onClick={(e) => handleButtonClick(e, () => onStart?.(window))}
                  className={`flex items-center gap-1.5 pl-2 pr-3 py-1.5 text-xs text-[rgb(var(--primary))] ${cardButtonClassName} focus:outline-none focus:ring-2 focus:ring-[rgb(var(--ring))] font-semibold whitespace-nowrap`}
                  aria-label={t('windowCard.start')}
                >
                  <Play size={14} />
                  <span>{t('windowCard.start')}</span>
                </button>
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content
                  className={tooltipClassName}
                  side="top"
                  sideOffset={5}
                >
                  {t('windowCard.start')}
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
          </Tooltip.Provider>
        )}
        {aggregatedStatus === WindowStatus.Restoring && (
          <button
            disabled
            className={`flex items-center gap-1.5 pl-2 pr-3 py-1.5 text-xs text-[rgb(var(--muted-foreground))] ${cardButtonClassName} cursor-not-allowed opacity-60 whitespace-nowrap`}
            aria-label={t('windowCard.starting')}
          >
            <Loader2 size={14} className="animate-spin" />
            <span>{t('windowCard.starting')}</span>
          </button>
        )}
        {(aggregatedStatus === WindowStatus.Running || aggregatedStatus === WindowStatus.WaitingForInput) && (
          <Tooltip.Provider>
            <Tooltip.Root delayDuration={300}>
              <Tooltip.Trigger asChild>
                <button
                  onClick={(e) => handleButtonClick(e, () => onDestroySession?.(window))}
                  className={`flex items-center gap-1.5 pl-2 pr-3 py-1.5 text-xs !text-red-500 ${cardButtonClassName} focus:outline-none focus:ring-2 focus:!ring-red-500/45 whitespace-nowrap`}
                  aria-label={t('windowCard.stop')}
                >
                  <Square size={14} fill="currentColor" />
                  <span>{t('windowCard.stop')}</span>
                </button>
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content
                  className={tooltipClassName}
                  side="top"
                  sideOffset={5}
                >
                  {t('windowCard.stop')}
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
          </Tooltip.Provider>
        )}

        {hasLeftShortcuts && (
          <>
            {activeTerminalPane && canPaneOpenInIDE(activeTerminalPane) && enabledIDEs.slice(0, 3).map((ide) => (
              <Tooltip.Provider key={ide.id}>
                <Tooltip.Root delayDuration={300}>
                  <Tooltip.Trigger asChild>
                    <button
                      onClick={(e) => handleButtonClick(e, () => onOpenInIDE?.(ide.id, window))}
                      className={`flex h-7 w-7 flex-shrink-0 items-center justify-center text-[rgb(var(--foreground))] ${cardButtonClassName} border-0 focus:outline-none focus:ring-0`}
                      aria-label={t('common.openInIDE', { name: ide.name })}
                    >
                      <IDEIcon icon={ide.icon || ''} size={16} />
                    </button>
                  </Tooltip.Trigger>
                  <Tooltip.Portal>
                    <Tooltip.Content
                      className={tooltipClassName}
                      side="top"
                      sideOffset={5}
                    >
                      {t('common.openInIDE', { name: ide.name })}
                    </Tooltip.Content>
                  </Tooltip.Portal>
                </Tooltip.Root>
              </Tooltip.Provider>
            ))}

            {workingDirectory && activeTerminalPane && canPaneOpenLocalFolder(activeTerminalPane) && (
              <Tooltip.Provider>
                <Tooltip.Root delayDuration={300}>
                  <Tooltip.Trigger asChild>
                    <button
                      onClick={(e) => handleButtonClick(e, () => onOpenFolder?.(window))}
                      className={`flex h-7 w-7 flex-shrink-0 items-center justify-center text-[rgb(var(--foreground))] ${cardButtonClassName} focus:outline-none focus:ring-2 focus:ring-[rgb(var(--ring))]`}
                      aria-label={t('common.openFolder')}
                    >
                      <FolderOpen size={16} />
                    </button>
                  </Tooltip.Trigger>
                  <Tooltip.Portal>
                    <Tooltip.Content
                      className={tooltipClassName}
                      side="top"
                      sideOffset={5}
                    >
                      {t('common.openFolder')}
                    </Tooltip.Content>
                  </Tooltip.Portal>
                </Tooltip.Root>
              </Tooltip.Provider>
            )}

            {activeTerminalPane && canPaneOpenInIDE(activeTerminalPane) && enabledIDEs.length > 3 && (
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <button
                    onClick={(e) => e.stopPropagation()}
                    className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-[rgb(var(--muted-foreground))] transition-colors hover:text-[rgb(var(--foreground))] focus:outline-none"
                    aria-label={t('common.more')}
                  >
                    <ChevronDown size={14} />
                  </button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    className={ideMenuContentClassName}
                    side="top"
                    sideOffset={5}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {enabledIDEs.slice(3).map((ide) => (
                      <DropdownMenu.Item
                        key={ide.id}
                        className={ideMenuItemClassName}
                        onSelect={() => onOpenInIDE?.(ide.id, window)}
                      >
                        <IdeMenuItemContent
                          icon={<IDEIcon icon={ide.icon || ''} size={16} />}
                          label={ide.name}
                        />
                      </DropdownMenu.Item>
                    ))}
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            )}
          </>
        )}

        {hasProjectLinks && window.projectConfig?.links && (
          <ProjectLinks
            links={window.projectConfig.links}
            variant="card"
            maxDisplay={2}
            onOpenLink={handleOpenLink}
          />
        )}
      </div>
    </div>
  );
});

WindowCard.displayName = 'WindowCard';
