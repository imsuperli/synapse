import { v4 as uuidv4 } from 'uuid';
import {
  Window,
  LegacyWindow,
  LayoutNode,
  PaneNode,
  SplitNode,
  Pane,
  WindowStatus,
} from '../types/window';
import { removePaneFromLayout } from '../../shared/utils/layout-tree';
import { getInactiveWindowStatus, isLegacyPausedStatus } from './windowLifecycle';

type DestroyedSessionCollapseResult = {
  layout: LayoutNode;
  activePaneId: string;
};

/**
 * 从旧版 Window 迁移到新版 Window
 */
export function migrateLegacyWindow(legacy: LegacyWindow): Window {
  const paneId = uuidv4();
  const pane: Pane = {
    id: paneId,
    cwd: legacy.workingDirectory,
    command: legacy.command,
    status: legacy.status,
    pid: legacy.pid,
    lastOutput: legacy.lastOutput,
  };

  const layout: PaneNode = {
    type: 'pane',
    id: paneId,
    pane,
  };

  return {
    id: legacy.id,
    name: legacy.name,
    layout,
    activePaneId: paneId,
    createdAt: legacy.createdAt,
    lastActiveAt: legacy.lastActiveAt,
    archived: legacy.archived,
  };
}

/**
 * 创建单窗格的 Window
 */
export function createSinglePaneWindow(
  name: string,
  cwd: string,
  command: string
): Window {
  const windowId = uuidv4();
  const paneId = uuidv4();

  const pane: Pane = {
    id: paneId,
    cwd,
    command,
    status: WindowStatus.Completed,
    pid: null,
  };

  const layout: PaneNode = {
    type: 'pane',
    id: paneId,
    pane,
  };

  return {
    id: windowId,
    name,
    layout,
    activePaneId: paneId,
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
  };
}

/**
 * 在布局树中查找窗格节点
 */
export function findPaneNode(
  layout: LayoutNode,
  paneId: string
): PaneNode | null {
  if (layout.type === 'pane') {
    return layout.id === paneId ? layout : null;
  }

  // SplitNode: 递归查找子节点
  for (const child of layout.children) {
    const found = findPaneNode(child, paneId);
    if (found) return found;
  }

  return null;
}

type PanePathEntry = {
  node: SplitNode;
  childIndex: number;
};

export function findPanePath(
  layout: LayoutNode,
  paneId: string,
  ancestors: PanePathEntry[] = [],
): PanePathEntry[] | null {
  if (layout.type === 'pane') {
    return layout.id === paneId ? ancestors : null;
  }

  for (let index = 0; index < layout.children.length; index += 1) {
    const child = layout.children[index];
    const nextAncestors = [...ancestors, { node: layout, childIndex: index }];
    const found = findPanePath(child, paneId, nextAncestors);
    if (found) {
      return found;
    }
  }

  return null;
}

/**
 * 获取布局树中的所有窗格（优化版：避免创建临时数组）
 */
export function getAllPanes(layout: LayoutNode): Pane[] {
  // 防御性检查：如果 layout 为 undefined 或 null，返回空数组
  if (!layout) {
    console.warn('[getAllPanes] Layout is undefined or null');
    return [];
  }

  const result: Pane[] = [];

  function collect(node: LayoutNode) {
    if (!node) return;

    if (node.type === 'pane') {
      result.push(node.pane);
    } else {
      node.children.forEach(collect);
    }
  }

  collect(layout);
  return result;
}

/**
 * 拆分窗格（在指定窗格位置创建拆分）
 */
export function splitPane(
  layout: LayoutNode,
  targetPaneId: string,
  direction: 'horizontal' | 'vertical',
  newPane: Pane,
  insertBefore: boolean = false,
  sizes?: [number, number],
): LayoutNode | null {
  if (layout.type === 'pane') {
    if (layout.id === targetPaneId) {
      // 找到目标窗格，创建拆分节点
      const newPaneNode: PaneNode = {
        type: 'pane',
        id: newPane.id,
        pane: newPane,
      };

      const splitNode: SplitNode = {
        type: 'split',
        direction,
        sizes: sizes ?? [0.5, 0.5],
        children: insertBefore ? [newPaneNode, layout] : [layout, newPaneNode],
      };

      return splitNode;
    }
    return layout;
  }

  // SplitNode: 递归处理子节点
  const newChildren = layout.children.map(child =>
    splitPane(child, targetPaneId, direction, newPane, insertBefore, sizes)
  );

  // 检查是否有子节点被修改
  const hasChanges = newChildren.some((child, i) => child !== layout.children[i]);
  if (!hasChanges) return layout;

  return {
    ...layout,
    children: newChildren.filter((child): child is LayoutNode => child !== null),
  };
}

function collapseRedundantSplits(layout: LayoutNode): LayoutNode {
  if (layout.type === 'pane') {
    return layout;
  }

  const collapsedChildren = layout.children.map(collapseRedundantSplits);
  if (collapsedChildren.length === 1) {
    return collapsedChildren[0];
  }

  return {
    ...layout,
    children: collapsedChildren,
  };
}

export function movePane(
  layout: LayoutNode,
  sourcePaneId: string,
  targetPaneId: string,
  direction: 'horizontal' | 'vertical',
  insertBefore: boolean = false,
): LayoutNode | null {
  if (sourcePaneId === targetPaneId) {
    return layout;
  }

  const sourcePaneNode = findPaneNode(layout, sourcePaneId);
  if (!sourcePaneNode) {
    return layout;
  }

  const layoutWithoutSource = closePane(layout, sourcePaneId);
  if (!layoutWithoutSource) {
    return layout;
  }

  const collapsedLayout = collapseRedundantSplits(layoutWithoutSource);

  return splitPane(
    collapsedLayout,
    targetPaneId,
    direction,
    sourcePaneNode.pane,
    insertBefore,
  );
}

/**
 * 关闭窗格（从布局树中移除）
 */
export function closePane(
  layout: LayoutNode,
  paneId: string
): LayoutNode | null {
  return removePaneFromLayout(layout, paneId);
}

function hasStrongTmuxAgentMarker(pane: Pane): boolean {
  return Boolean(
    pane.teamName
    || pane.agentId
    || pane.agentName
    || pane.agentColor
  );
}

function hasWeakTmuxAgentMarker(pane: Pane): boolean {
  return Boolean(
    pane.title
    || pane.borderColor
    || pane.activeBorderColor
    || pane.teammateMode === 'tmux'
  );
}

export function isTmuxAgentPane(pane: Pane): boolean {
  return hasStrongTmuxAgentMarker(pane) || hasWeakTmuxAgentMarker(pane);
}

function sanitizePaneForDestroyedSession(pane: Pane): Pane {
  const {
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
    ...restPane
  } = pane;

  return {
    ...restPane,
    status: WindowStatus.Completed,
    pid: null,
  };
}

type ScopedLayoutMatch = {
  path: number[];
  node: LayoutNode;
  panes: Pane[];
};

function findScopedSubtree(
  node: LayoutNode,
  matchesPane: (pane: Pane) => boolean,
  path: number[] = [],
): ScopedLayoutMatch | null {
  if (node.type === 'pane') {
    return matchesPane(node.pane)
      ? { path, node, panes: [node.pane] }
      : null;
  }

  const childMatches = node.children
    .map((child, childIndex) => findScopedSubtree(child, matchesPane, [...path, childIndex]))
    .filter((match): match is ScopedLayoutMatch => match !== null);

  if (childMatches.length === 0) {
    return null;
  }

  if (childMatches.length === 1) {
    return childMatches[0];
  }

  return {
    path,
    node,
    panes: childMatches.flatMap((match) => match.panes),
  };
}

function replaceLayoutNodeAtPath(
  layout: LayoutNode,
  path: number[],
  replacement: LayoutNode,
): LayoutNode {
  if (path.length === 0) {
    return replacement;
  }

  if (layout.type !== 'split') {
    return layout;
  }

  const [childIndex, ...restPath] = path;
  const targetChild = layout.children[childIndex];
  if (!targetChild) {
    return layout;
  }

  const nextChild = replaceLayoutNodeAtPath(targetChild, restPath, replacement);
  if (nextChild === targetChild) {
    return layout;
  }

  return {
    ...layout,
    children: layout.children.map((child, index) => (
      index === childIndex ? nextChild : child
    )),
  };
}

function getPaneToKeep(panes: Pane[]): Pane {
  return panes.find((pane) => !isTmuxAgentPane(pane))
    || panes.find((pane) => !hasStrongTmuxAgentMarker(pane))
    || panes[0];
}

export function collapseTmuxAgentPanesForDestroyedSession(
  layout: LayoutNode,
  activePaneId?: string,
): DestroyedSessionCollapseResult | null {
  let nextLayout = layout;
  let nextActivePaneId = activePaneId;
  let didCollapse = false;

  const scopeIds = Array.from(new Set(
    getAllPanes(layout)
      .map((pane) => pane.tmuxScopeId)
      .filter((scopeId): scopeId is string => Boolean(scopeId))
  ));

  for (const scopeId of scopeIds) {
    const match = findScopedSubtree(nextLayout, (pane) => pane.tmuxScopeId === scopeId);
    if (!match) {
      continue;
    }

    const paneToKeep = getPaneToKeep(match.panes);
    const sanitizedPane = sanitizePaneForDestroyedSession(paneToKeep);
    nextLayout = replaceLayoutNodeAtPath(nextLayout, match.path, {
      type: 'pane',
      id: sanitizedPane.id,
      pane: sanitizedPane,
    });

    if (nextActivePaneId && match.panes.some((pane) => pane.id === nextActivePaneId)) {
      nextActivePaneId = sanitizedPane.id;
    }
    didCollapse = true;
  }

  if (didCollapse) {
    return {
      layout: nextLayout,
      activePaneId: nextActivePaneId || getAllPanes(nextLayout)[0]?.id || '',
    };
  }

  const fallbackMatch = findScopedSubtree(layout, (pane) => isTmuxAgentPane(pane));
  if (!fallbackMatch || fallbackMatch.panes.length <= 1) {
    return null;
  }

  const strongMarkerCount = fallbackMatch.panes.filter(hasStrongTmuxAgentMarker).length;
  const weakMarkerCount = fallbackMatch.panes.filter(hasWeakTmuxAgentMarker).length;
  if (strongMarkerCount === 0 && weakMarkerCount < 2) {
    return null;
  }

  const paneToKeep = getPaneToKeep(fallbackMatch.panes);
  const sanitizedPane = sanitizePaneForDestroyedSession(paneToKeep);
  const collapsedLayout = replaceLayoutNodeAtPath(layout, fallbackMatch.path, {
    type: 'pane',
    id: sanitizedPane.id,
    pane: sanitizedPane,
  });

  return {
    layout: collapsedLayout,
    activePaneId: fallbackMatch.panes.some((pane) => pane.id === activePaneId)
      ? sanitizedPane.id
      : activePaneId || sanitizedPane.id,
  };
}

function normalizeSizes(sizes: number[]): number[] {
  const normalizedSizes = sizes.map(size =>
    Number.isFinite(size) && size > 0 ? size : 0
  );
  const total = normalizedSizes.reduce((sum, size) => sum + size, 0);

  if (total <= 0) {
    return sizes.map(() => 1 / sizes.length);
  }

  return normalizedSizes.map(size => size / total);
}

/**
 * 更新布局树中的窗格数据
 */
export function updatePaneInLayout(
  layout: LayoutNode,
  paneId: string,
  updates: Partial<Pane>
): LayoutNode {
  if (layout.type === 'pane') {
    if (layout.id === paneId) {
      return {
        ...layout,
        pane: {
          ...layout.pane,
          ...updates,
        },
      };
    }
    return layout;
  }

  // SplitNode: 递归更新子节点
  let didChange = false;
  const nextChildren = layout.children.map((child) => {
    const nextChild = updatePaneInLayout(child, paneId, updates);
    if (nextChild !== child) {
      didChange = true;
    }
    return nextChild;
  });

  if (!didChange) {
    return layout;
  }

  return {
    ...layout,
    children: nextChildren,
  };
}

/**
 * 更新布局树中某个 split 节点的 sizes
 * splitPath 使用子节点索引描述从根 split 到目标 split 的路径；根 split 为 []
 */
export function updateSplitSizes(
  layout: LayoutNode,
  splitPath: number[],
  sizes: number[]
): LayoutNode {
  if (layout.type !== 'split') {
    return layout;
  }

  if (splitPath.length === 0) {
    if (sizes.length !== layout.children.length) {
      return layout;
    }

    const nextSizes = normalizeSizes(sizes);
    const didChange = nextSizes.some((size, index) => size !== layout.sizes[index]);
    if (!didChange) {
      return layout;
    }

    return {
      ...layout,
      sizes: nextSizes,
    };
  }

  const [childIndex, ...restPath] = splitPath;
  const targetChild = layout.children[childIndex];
  if (!targetChild || targetChild.type !== 'split') {
    return layout;
  }

  const nextChild = updateSplitSizes(targetChild, restPath, sizes);
  if (nextChild === targetChild) {
    return layout;
  }

  return {
    ...layout,
    children: layout.children.map((child, index) => (
      index === childIndex ? nextChild : child
    )),
  };
}

/**
 * 获取窗口的聚合状态（基于所有窗格的状态）
 */
export function getAggregatedStatus(layout: LayoutNode): WindowStatus {
  // 防御性检查：如果 layout 为 undefined 或 null，返回非运行状态
  if (!layout) {
    console.warn('[getAggregatedStatus] Layout is undefined or null');
    return WindowStatus.Completed;
  }

  return getAggregatedStatusFromPanes(getAllPanes(layout));
}

export function getAggregatedStatusFromPanes(panes: Pane[]): WindowStatus {
  if (panes.length === 0) {
    return WindowStatus.Completed;
  }

  // 如果有任何窗格在运行，则窗口状态为运行中
  if (panes.some(p => p.status === WindowStatus.Running)) {
    return WindowStatus.Running;
  }

  // 如果有任何窗格在启动中，则窗口状态为启动中
  if (panes.some(p => p.status === WindowStatus.Restoring)) {
    return WindowStatus.Restoring;
  }

  // 如果有任何窗格在等待输入，则窗口状态为等待输入
  if (panes.some(p => p.status === WindowStatus.WaitingForInput)) {
    return WindowStatus.WaitingForInput;
  }

  // 如果有任何窗格出错，则窗口状态为出错
  if (panes.some(p => p.status === WindowStatus.Error)) {
    return WindowStatus.Error;
  }

  // 兼容旧数据：Paused 视为无活动会话
  if (panes.every((pane) => (
    pane.status === WindowStatus.Completed || isLegacyPausedStatus(pane.status)
  ))) {
    return WindowStatus.Completed;
  }

  return getInactiveWindowStatus(panes);
}

/**
 * 计算布局树的深度
 */
export function getLayoutDepth(layout: LayoutNode): number {
  if (layout.type === 'pane') {
    return 1;
  }

  const childDepths = layout.children.map(child => getLayoutDepth(child));
  return 1 + Math.max(...childDepths);
}

/**
 * 获取布局树中的窗格数量
 */
export function getPaneCount(layout: LayoutNode): number {
  return getAllPanes(layout).length;
}
