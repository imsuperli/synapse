import type { Window } from '../types/window';
import type { WindowGroup } from '../../shared/types/window-group';
import { normalizeRecentTerminalLimit } from '../../shared/utils/recentTerminals';

export type RecentTerminalItem =
  | { type: 'window'; data: Window }
  | { type: 'group'; data: WindowGroup };

function getTime(value: string | undefined): number {
  const time = Date.parse(value ?? '');
  return Number.isFinite(time) ? time : 0;
}

export function sortRecentTerminalWindows(windows: Window[], mruList: string[]): Window[] {
  const mruIndexByWindowId = new Map(mruList.map((windowId, index) => [windowId, index]));

  return [...windows].sort((left, right) => {
    const leftMruIndex = mruIndexByWindowId.get(left.id);
    const rightMruIndex = mruIndexByWindowId.get(right.id);

    if (leftMruIndex !== undefined && rightMruIndex !== undefined) {
      return leftMruIndex - rightMruIndex;
    }

    if (leftMruIndex !== undefined) {
      return -1;
    }

    if (rightMruIndex !== undefined) {
      return 1;
    }

    const lastActiveDelta = getTime(right.lastActiveAt) - getTime(left.lastActiveAt);
    if (lastActiveDelta !== 0) {
      return lastActiveDelta;
    }

    return getTime(right.createdAt) - getTime(left.createdAt);
  });
}

export function getRecentTerminalWindows(
  windows: Window[],
  mruList: string[],
  limit: unknown,
): Window[] {
  return sortRecentTerminalWindows(windows, mruList).slice(0, normalizeRecentTerminalLimit(limit));
}

function getRecentItemLastActiveAt(item: RecentTerminalItem): string | undefined {
  return item.data.lastActiveAt;
}

function getRecentItemCreatedAt(item: RecentTerminalItem): string | undefined {
  return item.data.createdAt;
}

function getRecentItemMruIndex(
  item: RecentTerminalItem,
  mruIndexByWindowId: Map<string, number>,
  mruIndexByGroupId: Map<string, number>,
): number | undefined {
  return item.type === 'group'
    ? mruIndexByGroupId.get(item.data.id)
    : mruIndexByWindowId.get(item.data.id);
}

export function sortRecentTerminalItems(
  items: RecentTerminalItem[],
  mruList: string[],
  groupMruList: string[],
): RecentTerminalItem[] {
  const mruIndexByWindowId = new Map(mruList.map((windowId, index) => [windowId, index]));
  const mruIndexByGroupId = new Map(groupMruList.map((groupId, index) => [groupId, index]));

  return [...items].sort((left, right) => {
    const leftMruIndex = getRecentItemMruIndex(left, mruIndexByWindowId, mruIndexByGroupId);
    const rightMruIndex = getRecentItemMruIndex(right, mruIndexByWindowId, mruIndexByGroupId);

    if (left.type === right.type) {
      if (leftMruIndex !== undefined && rightMruIndex !== undefined) {
        return leftMruIndex - rightMruIndex;
      }

      if (leftMruIndex !== undefined) {
        return -1;
      }

      if (rightMruIndex !== undefined) {
        return 1;
      }
    }

    const lastActiveDelta = getTime(getRecentItemLastActiveAt(right)) - getTime(getRecentItemLastActiveAt(left));
    if (lastActiveDelta !== 0) {
      return lastActiveDelta;
    }

    return getTime(getRecentItemCreatedAt(right)) - getTime(getRecentItemCreatedAt(left));
  });
}

export function getRecentTerminalItems(
  windows: Window[],
  groups: WindowGroup[],
  mruList: string[],
  groupMruList: string[],
  limit: unknown,
): RecentTerminalItem[] {
  return sortRecentTerminalItems(
    [
      ...windows.map((window): RecentTerminalItem => ({ type: 'window', data: window })),
      ...groups.map((group): RecentTerminalItem => ({ type: 'group', data: group })),
    ],
    mruList,
    groupMruList,
  ).slice(0, normalizeRecentTerminalLimit(limit));
}
