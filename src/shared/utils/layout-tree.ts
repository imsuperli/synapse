import type { GroupLayoutNode } from '../types/window-group';
import type { LayoutNode } from '../types/window';

export function removePaneFromLayout(
  layout: LayoutNode,
  paneId: string,
): LayoutNode | null {
  if (layout.type === 'pane') {
    return layout.id === paneId ? null : layout;
  }

  let hasChanges = false;
  const children: LayoutNode[] = [];
  const sizes: number[] = [];

  layout.children.forEach((child, index) => {
    const nextChild = removePaneFromLayout(child, paneId);
    if (nextChild !== child) {
      hasChanges = true;
    }
    if (nextChild !== null) {
      children.push(nextChild);
      sizes.push(layout.sizes[index] ?? 0);
    }
  });

  if (!hasChanges) {
    return layout;
  }
  if (children.length === 0) {
    return null;
  }
  if (children.length === 1) {
    return {
      ...layout,
      children,
      sizes: [1],
    };
  }

  return {
    ...layout,
    children,
    sizes: children.length === layout.children.length
      ? layout.sizes
      : normalizeSizes(sizes),
  };
}

export function removeWindowFromGroupLayout(
  layout: GroupLayoutNode,
  windowId: string,
): GroupLayoutNode | null {
  if (layout.type === 'window') {
    return layout.id === windowId ? null : layout;
  }

  let hasChanges = false;
  const children: GroupLayoutNode[] = [];
  const sizes: number[] = [];

  layout.children.forEach((child, index) => {
    const nextChild = removeWindowFromGroupLayout(child, windowId);
    if (nextChild !== child) {
      hasChanges = true;
    }
    if (nextChild !== null) {
      children.push(nextChild);
      sizes.push(layout.sizes[index] ?? 0);
    }
  });

  if (!hasChanges) {
    return layout;
  }
  if (children.length === 0) {
    return null;
  }
  if (children.length === 1) {
    return children[0]!;
  }

  return {
    ...layout,
    children,
    sizes: children.length === layout.children.length
      ? layout.sizes
      : normalizeSizes(sizes),
  };
}

function normalizeSizes(sizes: number[]): number[] {
  if (sizes.length === 0) {
    return [];
  }

  const validSizes = sizes.map((size) => (
    Number.isFinite(size) && size > 0 ? size : 0
  ));
  const total = validSizes.reduce((sum, size) => sum + size, 0);
  if (total <= 0) {
    return sizes.map(() => 1 / sizes.length);
  }
  return validSizes.map((size) => size / total);
}
