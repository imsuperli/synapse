/**
 * 拖拽相关类型定义
 */

/** 拖拽项类型常量 */
export const DragItemTypes = {
  /** 窗口卡片（主界面 CardGrid 中的 WindowCard） */
  WINDOW_CARD: 'WINDOW_CARD',
  /** 组卡片（主界面 CardGrid 中的 GroupCard） */
  GROUP_CARD: 'GROUP_CARD',
  /** SSH 配置卡片（主界面 CardGrid 中无关联窗口的 SSHProfileCard） */
  SSH_PROFILE_CARD: 'SSH_PROFILE_CARD',
  /** 分类项（侧边栏中的 CategoryItem，用于分类排序） */
  CATEGORY_ITEM: 'CATEGORY_ITEM',
  /** 浏览器工具按钮（用于拖拽创建浏览器 pane） */
  BROWSER_TOOL: 'BROWSER_TOOL',
  /** 浏览器 pane（用于拖拽调整位置） */
  BROWSER_PANE: 'BROWSER_PANE',
} as const;

/** WindowCard 拖拽数据 */
export interface WindowCardDragItem {
  type: typeof DragItemTypes.WINDOW_CARD;
  windowId: string;
  windowName: string;
  /** 拖拽来源：cardGrid=主界面卡片, sidebar=侧边栏, groupLayout=组布局内 */
  source: 'cardGrid' | 'sidebar' | 'groupLayout';
  /** 如果窗口属于某个组，记录组 ID */
  sourceGroupId?: string;
}

/** GroupCard 拖拽数据 */
export interface GroupCardDragItem {
  type: typeof DragItemTypes.GROUP_CARD;
  groupId: string;
  groupName: string;
  source: 'cardGrid';
}

/** SSH 配置卡片拖拽数据 */
export interface SSHProfileCardDragItem {
  type: typeof DragItemTypes.SSH_PROFILE_CARD;
  profileId: string;
  profileName: string;
  source: 'cardGrid';
}

export interface BrowserToolDragItem {
  type: typeof DragItemTypes.BROWSER_TOOL;
  windowId: string;
  sourcePaneId: string;
  url: string;
  sourceBrowserPaneId?: string;
}

export interface BrowserPaneDragItem {
  type: typeof DragItemTypes.BROWSER_PANE;
  windowId: string;
  paneId: string;
  url: string;
}

export interface NativeBrowserUrlDragItem {
  urls: string[];
  dataTransfer?: DataTransfer;
}

export type BrowserDropDragItem =
  | BrowserToolDragItem
  | BrowserPaneDragItem
  | NativeBrowserUrlDragItem;

export function isBrowserToolDragItem(item: BrowserDropDragItem): item is BrowserToolDragItem {
  return 'type' in item && item.type === DragItemTypes.BROWSER_TOOL;
}

export function isBrowserPaneDragItem(item: BrowserDropDragItem): item is BrowserPaneDragItem {
  return 'type' in item && item.type === DragItemTypes.BROWSER_PANE;
}

export function isNativeBrowserUrlDragItem(item: BrowserDropDragItem): item is NativeBrowserUrlDragItem {
  return !('type' in item) && Array.isArray((item as NativeBrowserUrlDragItem).urls);
}

/** DropZone 放置位置（用于确定分割方向） */
export type DropPosition = 'left' | 'right' | 'top' | 'bottom' | 'center';

export type PaneDropPosition = DropPosition;

/** DropZone 放置结果 */
export interface DropResult {
  /** 放置位置 */
  position: DropPosition;
  /** 目标窗口 ID（拖到某个窗口上时） */
  targetWindowId?: string;
  /** 目标组 ID（拖到某个组上时） */
  targetGroupId?: string;
  /** 目标画布工作区 ID（拖到某个画布卡片上时） */
  targetCanvasWorkspaceId?: string;
}

export interface PaneDropResult {
  position: PaneDropPosition;
  targetPaneId: string;
  targetWindowId: string;
}
