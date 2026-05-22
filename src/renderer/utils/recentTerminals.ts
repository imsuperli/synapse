import type { Window } from '../types/window';
import { normalizeRecentTerminalLimit } from '../../shared/utils/recentTerminals';

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
