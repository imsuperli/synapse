import type { IpcResponse } from '../../shared/types/electron-api';
import { Window } from '../types/window';
import { useWindowStore } from '../stores/windowStore';
import { usePaneNoteStore } from '../stores/paneNoteStore';
import { getDestroyableSSHWindowIds, isEphemeralSSHCloneWindow } from './sshWindowBindings';

const pendingWindowResourceDestructionCounts = new Map<string, number>();

function beginWindowResourceDestruction(windowId: string): () => void {
  pendingWindowResourceDestructionCounts.set(
    windowId,
    (pendingWindowResourceDestructionCounts.get(windowId) ?? 0) + 1,
  );

  return () => {
    const nextCount = (pendingWindowResourceDestructionCounts.get(windowId) ?? 1) - 1;
    if (nextCount <= 0) {
      pendingWindowResourceDestructionCounts.delete(windowId);
      return;
    }

    pendingWindowResourceDestructionCounts.set(windowId, nextCount);
  };
}

export function isWindowResourceDestructionPending(windowId: string): boolean {
  return pendingWindowResourceDestructionCounts.has(windowId);
}

function assertIpcSuccess(response: IpcResponse<void> | undefined, fallbackMessage: string): void {
  if (response && !response.success) {
    throw new Error(response.error || fallbackMessage);
  }
}

async function destroyWindowResources(windowId: string): Promise<void> {
  const closeResponse = await window.electronAPI.closeWindow(windowId);
  assertIpcSuccess(closeResponse, `Failed to close window ${windowId}`);

  const deleteResponse = await window.electronAPI.deleteWindow(windowId);
  assertIpcSuccess(deleteResponse, `Failed to delete window ${windowId}`);
}

export async function destroyWindowResourcesKeepRecord(windowId: string): Promise<void> {
  const endPendingDestruction = beginWindowResourceDestruction(windowId);

  try {
    await destroyWindowResources(windowId);
    usePaneNoteStore.getState().removeWindowNotes(windowId);

    const { getWindowById, clearWindowRuntimeSession } = useWindowStore.getState();
    const targetWindow = getWindowById(windowId);
    if (!targetWindow) {
      return;
    }

    if (targetWindow.ephemeral) {
      useWindowStore.getState().removeWindow(windowId);
      return;
    }

    clearWindowRuntimeSession(windowId);
  } finally {
    endPendingDestruction();
  }
}

export async function destroyWindowResourcesAndRemoveRecord(windowId: string): Promise<void> {
  const endPendingDestruction = beginWindowResourceDestruction(windowId);

  try {
    await destroyWindowResources(windowId);
    usePaneNoteStore.getState().removeWindowNotes(windowId);
    useWindowStore.getState().removeWindow(windowId);
  } finally {
    endPendingDestruction();
  }
}

export async function destroySSHWindowFamilyResources(
  targetWindow: Window,
  options?: {
    removeTargetRecord?: boolean;
    includeOwnedClones?: boolean;
  },
): Promise<string[]> {
  const allWindows = useWindowStore.getState().windows;
  const windowIds = getDestroyableSSHWindowIds(allWindows, targetWindow, {
    includeOwner: !isEphemeralSSHCloneWindow(targetWindow),
    includeOwnedClones: options?.includeOwnedClones ?? !isEphemeralSSHCloneWindow(targetWindow),
  });
  const processedWindowIds: string[] = [];

  for (const windowId of windowIds) {
    const currentWindow = useWindowStore.getState().getWindowById(windowId);
    if (!currentWindow) {
      continue;
    }

    const shouldRemoveRecord = currentWindow.id === targetWindow.id
      ? (currentWindow.ephemeral ? true : Boolean(options?.removeTargetRecord))
      : true;

    if (shouldRemoveRecord) {
      await destroyWindowResourcesAndRemoveRecord(windowId);
    } else {
      await destroyWindowResourcesKeepRecord(windowId);
    }

    processedWindowIds.push(windowId);
  }

  return processedWindowIds;
}
