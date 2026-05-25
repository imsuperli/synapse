import { Pane, Window } from '../types/window';
import { getWindowKind, isSessionlessPane, isTerminalPane } from '../../shared/utils/terminalCapabilities';
import { getAllPanes } from './layoutHelpers';

function getPaneSSHTargetKey(pane: Pane): string | null {
  if (isSessionlessPane(pane)) {
    return null;
  }

  const ssh = pane.ssh;
  if (pane.backend !== 'ssh' || !ssh?.profileId) {
    return null;
  }

  const routingMode = ssh.routingMode ?? 'direct';
  const jumpHostProfileId = routingMode === 'jumpHost' ? ssh.jumpHostProfileId?.trim() ?? '' : '';
  const proxyCommand = routingMode === 'proxyCommand' ? ssh.proxyCommand?.trim() ?? '' : '';
  const scopeSuffix = `|route:${routingMode}|jump:${jumpHostProfileId}|proxy:${proxyCommand}`;
  const host = ssh.host?.trim().toLowerCase();

  if (host) {
    const user = ssh.user?.trim() ?? '';
    const port = ssh.port ?? 22;

    return `target:${user}@${host}:${port}${scopeSuffix}`;
  }

  return `profile:${ssh.profileId}${scopeSuffix}`;
}

export function getStandaloneSSHProfileId(window: Window): string | null {
  const panes = getAllPanes(window.layout).filter((pane) => isTerminalPane(pane));
  if (panes.length === 0) {
    return null;
  }

  let profileId: string | null = null;

  for (const pane of panes) {
    const paneProfileId = pane.ssh?.profileId;
    if (pane.backend !== 'ssh' || !paneProfileId) {
      return null;
    }

    if (profileId && paneProfileId !== profileId) {
      return null;
    }

    profileId = paneProfileId;
  }

  return profileId;
}

export function getStandaloneSSHTargetKey(window: Window): string | null {
  const panes = getAllPanes(window.layout).filter((pane) => isTerminalPane(pane));
  if (panes.length === 0) {
    return null;
  }

  let targetKey: string | null = null;

  for (const pane of panes) {
    const paneTargetKey = getPaneSSHTargetKey(pane);
    if (!paneTargetKey) {
      return null;
    }

    if (targetKey && paneTargetKey !== targetKey) {
      return null;
    }

    targetKey = paneTargetKey;
  }

  return targetKey;
}

export function getStandaloneSSHWindowsForTarget(
  windows: Window[],
  targetWindowId: string,
): Window[] {
  const targetWindow = windows.find((window) => window.id === targetWindowId);
  if (!targetWindow || !isStandaloneWindow(targetWindow)) {
    return [];
  }

  const targetKey = targetWindow ? getStandaloneSSHTargetKey(targetWindow) : null;

  return windows.filter((window) => {
    if (window.archived || !isStandaloneWindow(window) || getWindowKind(window) !== 'ssh') {
      return false;
    }

    if (!targetKey) {
      return false;
    }

    return getStandaloneSSHTargetKey(window) === targetKey;
  });
}

export function resolveStandaloneSSHWindowSwitchTarget(
  windows: Window[],
  targetWindowId: string,
  mruList: string[],
): string {
  const targetWindow = windows.find((window) => window.id === targetWindowId);
  if (!targetWindow || (targetWindow.ownerType ?? 'standalone') !== 'standalone') {
    return targetWindowId;
  }

  const familyWindows = getStandaloneSSHWindowsForTarget(windows, targetWindowId).filter((window) => (
    (window.ownerType ?? 'standalone') === 'standalone'
  ));
  if (familyWindows.length === 0) {
    return targetWindowId;
  }

  const familyWindowIds = new Set(familyWindows.map((window) => window.id));
  const preferredWindowId = mruList.find((windowId) => familyWindowIds.has(windowId));

  return preferredWindowId ?? targetWindowId;
}

export function buildStandaloneSSHWindowMap(
  windows: Window[],
  profileIds?: Iterable<string>,
): Record<string, Window> {
  const allowedProfileIds = profileIds ? new Set(profileIds) : null;
  const nextMap: Record<string, Window> = {};

  for (const window of windows) {
    if (window.archived || window.ephemeral || !isStandaloneWindow(window)) {
      continue;
    }

    const profileId = getStandaloneSSHProfileId(window);
    if (!profileId) {
      continue;
    }

    if (allowedProfileIds && !allowedProfileIds.has(profileId)) {
      continue;
    }

    const existing = nextMap[profileId];
    if (!existing) {
      nextMap[profileId] = window;
      continue;
    }

    const existingTime = new Date(existing.lastActiveAt).getTime();
    const currentTime = new Date(window.lastActiveAt).getTime();
    if (currentTime >= existingTime) {
      nextMap[profileId] = window;
    }
  }

  return nextMap;
}

export function isEphemeralSSHCloneWindow(window: Window): boolean {
  return Boolean(window.ephemeral);
}

export function getSSHSessionOwnerWindowId(window: Window): string | null {
  if (getWindowKind(window) !== 'ssh') {
    return null;
  }

  if (window.ephemeral) {
    return window.sshTabOwnerWindowId?.trim() || window.id;
  }

  return window.id;
}

export function getOwnedEphemeralSSHWindows(
  windows: Window[],
  ownerWindowId: string,
): Window[] {
  const normalizedOwnerWindowId = ownerWindowId.trim();
  if (!normalizedOwnerWindowId) {
    return [];
  }

  return windows.filter((window) => (
    isEphemeralSSHCloneWindow(window)
    && getWindowKind(window) === 'ssh'
    && window.sshTabOwnerWindowId?.trim() === normalizedOwnerWindowId
  ));
}

export function getOwnedEphemeralSSHWindowIds(
  windows: Window[],
  ownerWindowId: string,
): string[] {
  return getOwnedEphemeralSSHWindows(windows, ownerWindowId).map((window) => window.id);
}

export function getDestroyableSSHWindowIds(
  windows: Window[],
  targetWindow: Window,
  options?: {
    includeOwner?: boolean;
    includeOwnedClones?: boolean;
  },
): string[] {
  const ownerWindowId = getSSHSessionOwnerWindowId(targetWindow);
  if (!ownerWindowId) {
    return [targetWindow.id];
  }

  const includeOwner = options?.includeOwner ?? true;
  const includeOwnedClones = options?.includeOwnedClones ?? !isEphemeralSSHCloneWindow(targetWindow);
  const windowIds: string[] = [];

  if (includeOwner) {
    windowIds.push(ownerWindowId);
  } else {
    windowIds.push(targetWindow.id);
  }

  if (includeOwnedClones) {
    windowIds.push(...getOwnedEphemeralSSHWindowIds(windows, ownerWindowId));
  }

  if (!includeOwner && !windowIds.includes(targetWindow.id)) {
    windowIds.push(targetWindow.id);
  }

  return Array.from(new Set(windowIds));
}

export function getSSHSessionFamilyWindows(
  windows: Window[],
  targetWindowId: string,
  options?: {
    includeArchived?: boolean;
  },
): Window[] {
  const targetWindow = windows.find((window) => window.id === targetWindowId);
  if (!targetWindow || !isStandaloneWindow(targetWindow)) {
    return [];
  }

  const targetKey = targetWindow ? getStandaloneSSHTargetKey(targetWindow) : null;
  const includeArchived = options?.includeArchived ?? false;

  if (!targetKey) {
    return [];
  }

  return windows.filter((window) => (
    (includeArchived || !window.archived)
    && isStandaloneWindow(window)
    && getWindowKind(window) === 'ssh'
    && getStandaloneSSHTargetKey(window) === targetKey
  ));
}

export function getPersistableWindows(windows: Window[]): Window[] {
  return windows.filter((window) => !window.ephemeral);
}

export function isStandaloneWindow(window: Window): boolean {
  return (window.ownerType ?? 'standalone') === 'standalone';
}

export function getStandaloneWindows(windows: Window[]): Window[] {
  return windows.filter((window) => isStandaloneWindow(window));
}

export function getStandaloneSidebarWindows(
  windows: Window[],
  activeWindowId: string | null,
  mruList: string[],
): Window[] {
  const standaloneWindows = getStandaloneWindows(windows);
  const representatives = new Map<string, Window>();
  const orderedKeys: string[] = [];
  const mruIndexByWindowId = new Map(mruList.map((windowId, index) => [windowId, index]));

  const shouldReplaceRepresentative = (current: Window, candidate: Window): boolean => {
    const currentIsActive = current.id === activeWindowId;
    const candidateIsActive = candidate.id === activeWindowId;
    if (candidateIsActive !== currentIsActive) {
      return candidateIsActive;
    }

    const currentIsPersistable = !current.ephemeral;
    const candidateIsPersistable = !candidate.ephemeral;
    if (candidateIsPersistable !== currentIsPersistable) {
      return candidateIsPersistable;
    }

    const currentMruIndex = mruIndexByWindowId.get(current.id) ?? Number.POSITIVE_INFINITY;
    const candidateMruIndex = mruIndexByWindowId.get(candidate.id) ?? Number.POSITIVE_INFINITY;
    if (candidateMruIndex !== currentMruIndex) {
      return candidateMruIndex < currentMruIndex;
    }

    return false;
  };

  for (const window of standaloneWindows) {
    const representativeKey = getWindowKind(window) === 'ssh'
      ? `ssh-family:${getSSHSessionOwnerWindowId(window) ?? window.id}`
      : `window:${window.id}`;

    const currentRepresentative = representatives.get(representativeKey);
    if (!currentRepresentative) {
      representatives.set(representativeKey, window);
      orderedKeys.push(representativeKey);
      continue;
    }

    if (shouldReplaceRepresentative(currentRepresentative, window)) {
      representatives.set(representativeKey, window);
    }
  }

  return orderedKeys
    .map((key) => representatives.get(key))
    .filter((window): window is Window => Boolean(window));
}

export function getStandalonePersistableWindows(windows: Window[]): Window[] {
  return getPersistableWindows(getStandaloneWindows(windows));
}
