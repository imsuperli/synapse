import { randomUUID } from 'crypto';
import type { ProcessManager } from '../services/ProcessManager';
import { ProcessStatus } from '../types/process';
import type { Workspace } from '../types/workspace';
import { WindowStatus, type LayoutNode, type Pane, type PaneBackend, type PaneKind, type Window } from '../../shared/types/window';
import type { GroupLayoutNode, WindowGroup } from '../../shared/types/window-group';
import type {
  GroupCreateResult,
  GroupDeleteResult,
  WindowCreateResult,
  WindowCloseResult,
  PaneListResult,
  PaneCloseResult,
  RemotePaneSummary,
  RemoteWindowGroupSummary,
  RemoteWindowSummary,
  WindowDeleteResult,
  WindowStartResult,
  WindowListResult,
} from '../../shared/remote/window-protocol';

type RemoteStateProviderOptions = {
  getCurrentWorkspace: () => Workspace | null;
  processManager: ProcessManager;
  startLocalTerminalPane?: (params: {
    windowId: string;
    paneId: string;
    name: string;
    workingDirectory: string;
    command?: string;
    initialCols?: number;
    initialRows?: number;
  }) => Promise<{ pid: number; sessionId: string; status: WindowStatus; command?: string }>;
  onWindowCreated?: (payload: { window: Window; workspace: Workspace }) => void | Promise<void>;
  stopWindowPanes?: (params: { windowId: string; paneIds: string[] }) => Promise<void> | void;
  onWindowDeleted?: (payload: { windowId: string; paneIds: string[]; workspace: Workspace }) => void | Promise<void>;
  onWindowRuntimeUpdated?: (payload: { window: Window; workspace: Workspace }) => void | Promise<void>;
  onWorkspaceLayoutUpdated?: (payload: { workspace: Workspace }) => void | Promise<void>;
};

type ListOptions = {
  includeArchived?: boolean;
  terminalOnly?: boolean;
  windowId?: string;
};

type LivePaneProcess = {
  pid: number;
  sessionId: string;
  status: ProcessStatus;
};

type StartWindowOptions = {
  windowId: string;
  paneId?: string;
  initialCols?: number;
  initialRows?: number;
};

type CreateWindowOptions = {
  name?: string;
  workingDirectory?: string;
  command?: string;
  initialCols?: number;
  initialRows?: number;
};

type CloseWindowOptions = {
  windowId: string;
};

type ClosePaneOptions = {
  windowId: string;
  paneId: string;
};

type DeleteWindowOptions = {
  windowId: string;
};

type CreateGroupOptions = {
  name?: string;
  windowIds: string[];
};

type DeleteGroupOptions = {
  groupId: string;
};

export class RemoteStateProvider {
  constructor(private readonly options: RemoteStateProviderOptions) {}

  listWindows(options: ListOptions = {}): WindowListResult {
    const workspace = this.options.getCurrentWorkspace();
    if (!workspace) {
      return { windows: [], groups: [] };
    }

    const livePaneProcesses = this.getLivePaneProcesses();
    const windows = workspace.windows
      .filter((window) => options.includeArchived || !window.archived)
      .map((window) => this.summarizeWindow(window, livePaneProcesses, options))
      .filter((window) => !options.terminalOnly || window.terminalPaneCount > 0);

    return {
      windows,
      groups: this.summarizeGroups(workspace, livePaneProcesses, options),
    };
  }

  listPanes(options: ListOptions = {}): PaneListResult {
    const windows = this.listWindows({
      includeArchived: options.includeArchived,
      terminalOnly: options.terminalOnly,
    }).windows.filter((window) => !options.windowId || window.windowId === options.windowId);
    return {
      panes: windows.flatMap((window) => window.panes),
    };
  }

  async startWindow(options: StartWindowOptions): Promise<WindowStartResult> {
    const workspace = this.options.getCurrentWorkspace();
    if (!workspace) {
      throw new Error('workspace_not_loaded');
    }

    const targetWindow = workspace.windows.find((window) => window.id === options.windowId);
    if (!targetWindow) {
      throw new Error('window_not_found');
    }

    const livePaneProcesses = this.getLivePaneProcesses();
    const allPanes = collectPanes(targetWindow.layout).filter((pane) => getPaneKind(pane) === 'terminal');
    const requestedPanes = options.paneId
      ? allPanes.filter((pane) => pane.id === options.paneId)
      : allPanes;

    if (options.paneId && requestedPanes.length === 0) {
      throw new Error('pane_not_found');
    }

    const panesToStart = requestedPanes.filter(
      (pane) => !this.isPaneRunning(targetWindow.id, pane, livePaneProcesses),
    );

    if (panesToStart.length === 0) {
      const window = this.summarizeWindow(targetWindow, livePaneProcesses, { terminalOnly: true });
      return {
        window,
        pane: findResultPane(window, options.paneId ?? targetWindow.activePaneId),
        startedPanes: [],
      };
    }

    const nonLocalPane = panesToStart.find((pane) => getPaneBackend(pane, 'terminal') !== 'local');
    if (nonLocalPane) {
      throw new Error('remote_start_ssh_not_supported');
    }

    const startLocalTerminalPane = this.options.startLocalTerminalPane;
    if (!startLocalTerminalPane) {
      throw new Error('remote_window_start_unavailable');
    }

    for (const pane of panesToStart) {
      pane.status = WindowStatus.Restoring;
      pane.pid = null;
      pane.sessionId = undefined;
    }

    targetWindow.lastActiveAt = new Date().toISOString();

    const startedPaneIds: string[] = [];
    for (const pane of panesToStart) {
      try {
        const result = await startLocalTerminalPane({
          windowId: targetWindow.id,
          paneId: pane.id,
          name: targetWindow.name,
          workingDirectory: pane.cwd,
          command: pane.command,
          initialCols: options.initialCols,
          initialRows: options.initialRows,
        });
        pane.pid = result.pid;
        pane.sessionId = result.sessionId;
        pane.status = result.status;
        pane.command = result.command ?? pane.command;
        startedPaneIds.push(pane.id);
      } catch (error) {
        pane.pid = null;
        pane.sessionId = undefined;
        pane.status = WindowStatus.Error;
        throw error;
      }
    }

    const nextLivePaneProcesses = this.getLivePaneProcesses();
    const window = this.summarizeWindow(targetWindow, nextLivePaneProcesses, { terminalOnly: true });
    markWorkspaceUpdated(workspace);
    await this.options.onWindowRuntimeUpdated?.({ window: targetWindow, workspace });
    return {
      window,
      pane: findResultPane(window, options.paneId ?? targetWindow.activePaneId),
      startedPanes: window.panes.filter((pane) => startedPaneIds.includes(pane.paneId)),
    };
  }

  async createWindow(options: CreateWindowOptions = {}): Promise<WindowCreateResult> {
    const workspace = this.options.getCurrentWorkspace();
    if (!workspace) {
      throw new Error('workspace_not_loaded');
    }

    const startLocalTerminalPane = this.options.startLocalTerminalPane;
    if (!startLocalTerminalPane) {
      throw new Error('remote_window_create_unavailable');
    }

    const workingDirectory = options.workingDirectory ?? getDefaultWorkingDirectory(workspace);
    const now = new Date().toISOString();
    const windowId = randomUUID();
    const paneId = randomUUID();
    const windowName = options.name?.trim() || getDefaultWindowName(workingDirectory);
    const pane: Pane = {
      id: paneId,
      cwd: workingDirectory,
      command: options.command ?? '',
      status: WindowStatus.Restoring,
      pid: null,
      backend: 'local',
    };
    const window: Window = {
      id: windowId,
      name: windowName,
      activePaneId: paneId,
      createdAt: now,
      lastActiveAt: now,
      kind: 'local',
      layout: {
        type: 'pane',
        id: paneId,
        pane,
      },
    };

    workspace.windows.push(window);

    try {
      const result = await startLocalTerminalPane({
        windowId,
        paneId,
        name: windowName,
        workingDirectory,
        command: options.command,
        initialCols: options.initialCols,
        initialRows: options.initialRows,
      });
      pane.pid = result.pid;
      pane.sessionId = result.sessionId;
      pane.status = result.status;
      pane.command = result.command ?? pane.command;
    } catch (error) {
      const insertedIndex = workspace.windows.findIndex((item) => item.id === windowId);
      if (insertedIndex >= 0) {
        workspace.windows.splice(insertedIndex, 1);
      }
      throw error;
    }

    markWorkspaceUpdated(workspace);
    await this.options.onWindowCreated?.({ window, workspace });

    const livePaneProcesses = this.getLivePaneProcesses();
    const summary = this.summarizeWindow(window, livePaneProcesses, { terminalOnly: true });
    const summaryPane = findResultPane(summary, paneId);
    if (!summaryPane) {
      throw new Error('created_pane_not_found');
    }
    return {
      window: summary,
      pane: summaryPane,
    };
  }

  async closeWindow(options: CloseWindowOptions): Promise<WindowCloseResult> {
    const workspace = this.options.getCurrentWorkspace();
    if (!workspace) {
      throw new Error('workspace_not_loaded');
    }

    const targetWindow = workspace.windows.find((window) => window.id === options.windowId);
    if (!targetWindow) {
      throw new Error('window_not_found');
    }

    const terminalPanes = collectPanes(targetWindow.layout).filter((pane) => getPaneKind(pane) === 'terminal');
    const paneIds = terminalPanes.map((pane) => pane.id);
    await this.options.stopWindowPanes?.({ windowId: targetWindow.id, paneIds });
    for (const pane of terminalPanes) {
      clearPaneRuntime(pane);
    }
    targetWindow.lastActiveAt = new Date().toISOString();
    markWorkspaceUpdated(workspace);
    await this.options.onWindowRuntimeUpdated?.({ window: targetWindow, workspace });

    const summary = this.summarizeWindow(targetWindow, this.getLivePaneProcesses(), { terminalOnly: true });
    return {
      window: summary,
      stoppedPanes: summary.panes.filter((pane) => paneIds.includes(pane.paneId)),
    };
  }

  async closePane(options: ClosePaneOptions): Promise<PaneCloseResult> {
    const workspace = this.options.getCurrentWorkspace();
    if (!workspace) {
      throw new Error('workspace_not_loaded');
    }

    const targetWindow = workspace.windows.find((window) => window.id === options.windowId);
    if (!targetWindow) {
      throw new Error('window_not_found');
    }

    const targetPane = collectPanes(targetWindow.layout).find((pane) => pane.id === options.paneId);
    if (!targetPane) {
      throw new Error('pane_not_found');
    }
    if (getPaneKind(targetPane) !== 'terminal') {
      throw new Error('pane_not_terminal');
    }

    await this.options.stopWindowPanes?.({ windowId: targetWindow.id, paneIds: [targetPane.id] });
    clearPaneRuntime(targetPane);
    targetWindow.lastActiveAt = new Date().toISOString();
    markWorkspaceUpdated(workspace);
    await this.options.onWindowRuntimeUpdated?.({ window: targetWindow, workspace });

    const summary = this.summarizeWindow(targetWindow, this.getLivePaneProcesses(), { terminalOnly: true });
    const pane = findResultPane(summary, targetPane.id);
    if (!pane) {
      throw new Error('pane_not_found');
    }
    return {
      window: summary,
      pane,
    };
  }

  async deleteWindow(options: DeleteWindowOptions): Promise<WindowDeleteResult> {
    const workspace = this.options.getCurrentWorkspace();
    if (!workspace) {
      throw new Error('workspace_not_loaded');
    }

    const targetIndex = workspace.windows.findIndex((window) => window.id === options.windowId);
    if (targetIndex < 0) {
      throw new Error('window_not_found');
    }

    const targetWindow = workspace.windows[targetIndex]!;
    const panes = collectPanes(targetWindow.layout);
    const terminalPanes = panes.filter((pane) => getPaneKind(pane) === 'terminal');
    await this.options.stopWindowPanes?.({
      windowId: targetWindow.id,
      paneIds: terminalPanes.map((pane) => pane.id),
    });
    workspace.windows.splice(targetIndex, 1);
    workspace.groups = removeWindowFromGroups(workspace.groups, targetWindow.id);
    markWorkspaceUpdated(workspace);
    await this.options.onWindowDeleted?.({
      windowId: targetWindow.id,
      paneIds: panes.map((pane) => pane.id),
      workspace,
    });
    await this.options.onWorkspaceLayoutUpdated?.({ workspace });

    return {
      deleted: true,
      windowId: targetWindow.id,
      groups: this.summarizeGroups(workspace, this.getLivePaneProcesses(), { terminalOnly: true }),
    };
  }

  async createGroup(options: CreateGroupOptions): Promise<GroupCreateResult> {
    const workspace = this.options.getCurrentWorkspace();
    if (!workspace) {
      throw new Error('workspace_not_loaded');
    }
    const windowIds = Array.from(new Set(options.windowIds));
    if (windowIds.length < 2) {
      throw new Error('group_requires_two_windows');
    }
    for (const windowId of windowIds) {
      if (!workspace.windows.some((window) => window.id === windowId && !window.archived)) {
        throw new Error('window_not_found');
      }
    }

    const now = new Date().toISOString();
    const group: WindowGroup = {
      id: randomUUID(),
      name: options.name?.trim() || 'Group',
      layout: buildInitialGroupLayout(windowIds),
      activeWindowId: windowIds[0]!,
      createdAt: now,
      lastActiveAt: now,
    };
    workspace.groups.push(group);
    markWorkspaceUpdated(workspace);
    await this.options.onWorkspaceLayoutUpdated?.({ workspace });

    const summary = this.summarizeGroup(group, workspace, this.getLivePaneProcesses(), { terminalOnly: true });
    if (!summary) {
      throw new Error('group_not_found');
    }
    return { group: summary };
  }

  async deleteGroup(options: DeleteGroupOptions): Promise<GroupDeleteResult> {
    const workspace = this.options.getCurrentWorkspace();
    if (!workspace) {
      throw new Error('workspace_not_loaded');
    }
    const before = workspace.groups.length;
    workspace.groups = workspace.groups.filter((group) => group.id !== options.groupId);
    if (workspace.groups.length === before) {
      throw new Error('group_not_found');
    }
    markWorkspaceUpdated(workspace);
    await this.options.onWorkspaceLayoutUpdated?.({ workspace });
    return {
      deleted: true,
      groupId: options.groupId,
    };
  }

  private summarizeWindow(
    window: Window,
    livePaneProcesses: Map<string, LivePaneProcess>,
    options: ListOptions,
  ): RemoteWindowSummary {
    const allPanes = collectPanes(window.layout);
    const panes = allPanes
      .map((pane) => this.summarizePane(window, pane, livePaneProcesses))
      .filter((pane) => !options.terminalOnly || pane.kind === 'terminal');
    const terminalPaneCount = allPanes.filter((pane) => getPaneKind(pane) === 'terminal').length;

    return {
      windowId: window.id,
      name: window.name,
      kind: window.kind ?? null,
      archived: window.archived === true,
      activePaneId: window.activePaneId,
      createdAt: window.createdAt,
      lastActiveAt: window.lastActiveAt,
      paneCount: allPanes.length,
      terminalPaneCount,
      panes,
    };
  }

  private summarizePane(
    window: Window,
    pane: Pane,
    livePaneProcesses: Map<string, LivePaneProcess>,
  ): RemotePaneSummary {
    const liveProcess = livePaneProcesses.get(getPaneKey(window.id, pane.id));
    const kind = getPaneKind(pane);
    const backend = getPaneBackend(pane, kind);
    return {
      windowId: window.id,
      paneId: pane.id,
      active: window.activePaneId === pane.id,
      kind,
      backend,
      status: pane.status,
      running: liveProcess !== undefined && liveProcess.status !== ProcessStatus.Exited,
      pid: liveProcess?.pid ?? pane.pid ?? null,
      sessionId: liveProcess?.sessionId ?? pane.sessionId ?? null,
      cwd: kind === 'terminal' ? pane.cwd : null,
      command: kind === 'terminal' ? pane.command : null,
      title: pane.title,
    };
  }

  private isPaneRunning(
    windowId: string,
    pane: Pane,
    livePaneProcesses: Map<string, LivePaneProcess>,
  ): boolean {
    const liveProcess = livePaneProcesses.get(getPaneKey(windowId, pane.id));
    return liveProcess !== undefined && liveProcess.status !== ProcessStatus.Exited;
  }

  private getLivePaneProcesses(): Map<string, LivePaneProcess> {
    const result = new Map<string, LivePaneProcess>();
    for (const process of this.options.processManager.listProcesses()) {
      if (!process.windowId || !process.paneId) {
        continue;
      }
      result.set(getPaneKey(process.windowId, process.paneId), {
        pid: process.pid,
        sessionId: process.sessionId,
        status: process.status,
      });
    }
    return result;
  }

  private summarizeGroups(
    workspace: Workspace,
    livePaneProcesses: Map<string, LivePaneProcess>,
    options: ListOptions,
  ): RemoteWindowGroupSummary[] {
    return (workspace.groups ?? [])
      .filter((group) => options.includeArchived || !group.archived)
      .flatMap((group) => {
        const summary = this.summarizeGroup(group, workspace, livePaneProcesses, options);
        return summary ? [summary] : [];
      });
  }

  private summarizeGroup(
    group: WindowGroup,
    workspace: Workspace,
    livePaneProcesses: Map<string, LivePaneProcess>,
    options: ListOptions,
  ): RemoteWindowGroupSummary | null {
    const memberIds = getGroupWindowIds(group.layout);
    const windows = memberIds
      .map((windowId) => workspace.windows.find((window) => window.id === windowId))
      .filter((window): window is Window => isListableWindow(window, options))
      .map((window) => this.summarizeWindow(window, livePaneProcesses, options))
      .filter((window) => !options.terminalOnly || window.terminalPaneCount > 0);
    if (windows.length === 0) {
      return null;
    }
    return {
      groupId: group.id,
      name: group.name,
      archived: group.archived === true,
      activeWindowId: group.activeWindowId,
      createdAt: group.createdAt,
      lastActiveAt: group.lastActiveAt,
      windowCount: memberIds.length,
      layout: group.layout,
      windows,
    };
  }
}

function collectPanes(layout: LayoutNode): Pane[] {
  if (layout.type === 'pane') {
    return [layout.pane];
  }
  return layout.children.flatMap((child) => collectPanes(child));
}

function getPaneKind(pane: Pane): PaneKind {
  return pane.kind ?? 'terminal';
}

function getPaneBackend(pane: Pane, kind: PaneKind): PaneBackend | null {
  if (kind !== 'terminal') {
    return null;
  }
  return pane.backend ?? 'local';
}

function getPaneKey(windowId: string, paneId: string): string {
  return `${windowId}:${paneId}`;
}

function findResultPane(window: RemoteWindowSummary, paneId: string): RemotePaneSummary | null {
  return window.panes.find((pane) => pane.paneId === paneId)
    ?? window.panes.find((pane) => pane.kind === 'terminal')
    ?? null;
}

function clearPaneRuntime(pane: Pane): void {
  pane.status = WindowStatus.Completed;
  pane.pid = null;
  pane.sessionId = undefined;
  pane.lastOutput = undefined;
  pane.tmuxScopeId = undefined;
}

function getDefaultWorkingDirectory(workspace: Workspace): string {
  const recentLocalPane = workspace.windows
    .filter((window) => !window.archived)
    .sort((a, b) => Date.parse(b.lastActiveAt || b.createdAt) - Date.parse(a.lastActiveAt || a.createdAt))
    .flatMap((window) => collectPanes(window.layout))
    .find((pane) => getPaneKind(pane) === 'terminal' && getPaneBackend(pane, 'terminal') === 'local' && pane.cwd);
  return recentLocalPane?.cwd || process.cwd();
}

function getDefaultWindowName(workingDirectory: string): string {
  const normalized = workingDirectory.replace(/[\\/]+$/, '');
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) || 'Terminal';
}

function markWorkspaceUpdated(workspace: Workspace): void {
  workspace.lastSavedAt = new Date().toISOString();
}

function isListableWindow(window: Window | undefined, options: ListOptions): window is Window {
  return Boolean(window) && (options.includeArchived === true || window?.archived !== true);
}

function buildInitialGroupLayout(windowIds: string[]): GroupLayoutNode {
  return {
    type: 'split',
    direction: 'horizontal',
    sizes: windowIds.map(() => 1 / windowIds.length),
    children: windowIds.map((id) => ({ type: 'window', id })),
  };
}

function getGroupWindowIds(layout: GroupLayoutNode): string[] {
  if (layout.type === 'window') {
    return [layout.id];
  }
  return layout.children.flatMap((child) => getGroupWindowIds(child));
}

function removeWindowFromGroups(groups: WindowGroup[], windowId: string): WindowGroup[] {
  return groups.flatMap((group) => {
    const nextLayout = removeWindowFromGroupLayout(group.layout, windowId);
    const nextWindowIds = nextLayout ? getGroupWindowIds(nextLayout) : [];
    if (!nextLayout || nextWindowIds.length < 2) {
      return [];
    }
    return [{
      ...group,
      layout: nextLayout,
      activeWindowId: nextWindowIds.includes(group.activeWindowId)
        ? group.activeWindowId
        : nextWindowIds[0]!,
      lastActiveAt: new Date().toISOString(),
    }];
  });
}

function removeWindowFromGroupLayout(layout: GroupLayoutNode, windowId: string): GroupLayoutNode | null {
  if (layout.type === 'window') {
    return layout.id === windowId ? null : layout;
  }
  const nextChildren = layout.children
    .map((child) => removeWindowFromGroupLayout(child, windowId))
    .filter((child): child is GroupLayoutNode => child !== null);
  if (nextChildren.length === layout.children.length) {
    return layout;
  }
  if (nextChildren.length === 0) {
    return null;
  }
  if (nextChildren.length === 1) {
    return nextChildren[0]!;
  }
  return {
    ...layout,
    children: nextChildren,
    sizes: nextChildren.map(() => 1 / nextChildren.length),
  };
}
