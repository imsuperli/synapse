/**
 * 窗口组布局操作工具函数
 *
 * 类似 layoutHelpers.ts，提供对组布局树的操作方法。
 */

import { v4 as uuidv4 } from 'uuid';
import {
  WindowGroup,
  GroupLayoutNode,
  WindowNode,
  GroupSplitNode,
} from '../../shared/types/window-group';
import { removeWindowFromGroupLayout } from '../../shared/utils/layout-tree';

/**
 * 在组布局树中查找窗口节点
 */
export function findWindowNode(
  layout: GroupLayoutNode,
  windowId: string
): WindowNode | null {
  if (layout.type === 'window') {
    return layout.id === windowId ? layout : null;
  }

  for (const child of layout.children) {
    const found = findWindowNode(child, windowId);
    if (found) return found;
  }

  return null;
}

/**
 * 获取组布局树中的所有窗口 ID
 */
export function getAllWindowIds(layout: GroupLayoutNode): string[] {
  if (layout.type === 'window') {
    return [layout.id];
  }

  return layout.children.flatMap(getAllWindowIds);
}

/**
 * 创建一个包含两个窗口的组
 */
export function createGroup(
  name: string,
  windowId1: string,
  windowId2: string,
  direction: 'horizontal' | 'vertical' = 'horizontal'
): WindowGroup {
  const groupId = uuidv4();
  const layout: GroupSplitNode = {
    type: 'split',
    direction,
    sizes: [0.5, 0.5],
    children: [
      { type: 'window', id: windowId1 },
      { type: 'window', id: windowId2 },
    ],
  };

  return {
    id: groupId,
    name,
    layout,
    activeWindowId: windowId1,
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
  };
}

/**
 * 添加窗口到组（在指定位置拆分）
 */
export function addWindowToGroup(
  layout: GroupLayoutNode,
  targetWindowId: string,
  newWindowId: string,
  direction: 'horizontal' | 'vertical',
  insertBefore: boolean = false
): GroupLayoutNode | null {
  if (layout.type === 'window') {
    if (layout.id === targetWindowId) {
      const newWindowNode: WindowNode = {
        type: 'window',
        id: newWindowId,
      };

      const splitNode: GroupSplitNode = {
        type: 'split',
        direction,
        sizes: [0.5, 0.5],
        children: insertBefore ? [newWindowNode, layout] : [layout, newWindowNode],
      };

      return splitNode;
    }
    return layout;
  }

  const newChildren = layout.children.map(child =>
    addWindowToGroup(child, targetWindowId, newWindowId, direction, insertBefore)
  );

  const hasChanges = newChildren.some((child, i) => child !== layout.children[i]);
  if (!hasChanges) return layout;

  return {
    ...layout,
    children: newChildren.filter((child): child is GroupLayoutNode => child !== null),
  };
}

/**
 * 从组中移除窗口
 */
export function removeWindowFromGroup(
  layout: GroupLayoutNode,
  windowId: string
): GroupLayoutNode | null {
  return removeWindowFromGroupLayout(layout, windowId);
}

/**
 * 更新组布局树中某个 split 节点的 sizes
 */
export function updateGroupSplitSizes(
  layout: GroupLayoutNode,
  splitPath: number[],
  sizes: number[]
): GroupLayoutNode {
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

  const nextChild = updateGroupSplitSizes(targetChild, restPath, sizes);
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
 * 规范化 sizes 数组（确保总和为 1）
 */
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
 * 计算组布局树的深度
 */
export function getGroupLayoutDepth(layout: GroupLayoutNode): number {
  if (layout.type === 'window') {
    return 1;
  }

  const childDepths = layout.children.map(child => getGroupLayoutDepth(child));
  return 1 + Math.max(...childDepths);
}

/**
 * 获取组中的窗口数量
 */
export function getWindowCount(layout: GroupLayoutNode): number {
  return getAllWindowIds(layout).length;
}

/**
 * 检查组中是否包含指定窗口
 */
export function containsWindow(layout: GroupLayoutNode, windowId: string): boolean {
  return findWindowNode(layout, windowId) !== null;
}

/**
 * 替换组中的窗口 ID（用于窗口 ID 变更时）
 */
export function replaceWindowId(
  layout: GroupLayoutNode,
  oldWindowId: string,
  newWindowId: string
): GroupLayoutNode {
  if (layout.type === 'window') {
    return layout.id === oldWindowId
      ? { ...layout, id: newWindowId }
      : layout;
  }

  return {
    ...layout,
    children: layout.children.map(child =>
      replaceWindowId(child, oldWindowId, newWindowId)
    ),
  };
}
