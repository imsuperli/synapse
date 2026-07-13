import { randomUUID } from 'crypto';
import type { ProcessManager } from '../services/ProcessManager';
import { ProcessStatus } from '../types/process';
import type { Workspace } from '../types/workspace';
import type { SSHProfile } from '../../shared/types/ssh';
import { WindowStatus, type LayoutNode, type Pane, type PaneBackend, type PaneKind, type Window } from '../../shared/types/window';
import type { GroupLayoutNode, WindowGroup } from '../../shared/types/window-group';
import { removePaneFromLayout, removeWindowFromGroupLayout } from '../../shared/utils/layout-tree';
import type { SSHProfileListResult } from '../../shared/remote/ssh-protocol';
import type {
  GroupCreateResult,
  GroupDeleteResult,
  GroupWindowRemoveResult,
  WindowCreateResult,
  WindowCloseResult,
  PaneListResult,
  PaneCloseResult,
  PaneDeleteResult,
  RemotePaneSummary,
  RemoteWindowGroupSummary,
  RemoteWindowSummary,
  WindowCreateParams,
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
  listSSHProfiles?: () => Promise<SSHProfile[]>;
  createSSHWindow?: (params: Extract<WindowCreateParams, { backend: 'ssh' }>) => Promise<Window>;
  onWindowCreated?: (payload: { window: Window; workspace: Workspace }) => void | Promise<void>;
  stopWindowPanes?: (params: { windowId: string; paneIds: string[] }) => Promise<void> | void;
  onPaneDeleted?: (payload: { windowId: string; paneId: string; workspace: Workspace }) => void | Promise<void>;
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

type CloseWindowOptions = {
  windowId: string;
};

type ClosePaneOptions = {
  windowId: string;
  paneId: string;
};

type DeletePaneOptions = {
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

type RemoveGroupWindowOptions = {
  groupId: string;
  windowId: string;
};

export class RemoteStateProvider {
  private workspaceMutationQueue: Promise<void> = Promise.resolve();

  constructor(private readonly options: RemoteStateProviderOptions) {}

  private async runWorkspaceMutation<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.workspaceMutationQueue;
    let release: (() => void) | undefined;
    this.workspaceMutationQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release?.();
    }
  }

  supportsSSHWindowCreation(): boolean {
    return Boolean(this.options.listSSHProfiles && this.options.createSSHWindow);
  }

  async listSSHProfiles(): Promise<SSHProfileListResult> {
    if (!this.supportsSSHWindowCreation() || !this.options.listSSHProfiles) {
      throw new Error('remote_ssh_profile_list_unavailable');
    }

    const profiles = await this.options.listSSHProfiles();
    return {
      profiles: profiles
        .map((profile) => ({
          profileId: profile.id,
          name: profile.name,
          host: profile.host,
          port: profile.port,
          user: profile.user,
          defaultRemoteCwd: profile.defaultRemoteCwd?.trim() || null,
          remoteCommand: profile.remoteCommand?.trim() || null,
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    };
  }

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

  async createWindow(options: WindowCreateParams): Promise<WindowCreateResult> {
    const workspace = this.options.getCurrentWorkspace();
    if (!workspace) {
      throw new Error('workspace_not_loaded');
    }

    if (options.backend === 'ssh') {
      return this.createSSHWindow(workspace, options);
    }

    const startLocalTerminalPane = this.options.startLocalTerminalPane;
    if (!startLocalTerminalPane) {
      throw new Error('remote_window_create_unavailable');
    }

    const workingDirectory = options.workingDirectory;
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

  private async createSSHWindow(
    workspace: Workspace,
    options: Extract<WindowCreateParams, { backend: 'ssh' }>,
  ): Promise<WindowCreateResult> {
    const createSSHWindow = this.options.createSSHWindow;
    if (!createSSHWindow || !this.options.listSSHProfiles) {
      throw new Error('remote_ssh_window_create_unavailable');
    }

    const window = await createSSHWindow(options);
    if (workspace.windows.some((item) => item.id === window.id)) {
      throw new Error('created_window_id_conflict');
    }

    const terminalPanes = collectPanes(window.layout).filter((pane) => getPaneKind(pane) === 'terminal');
    const createdPane = terminalPanes.find((pane) => pane.id === window.activePaneId) ?? terminalPanes[0];
    if (!createdPane) {
      throw new Error('created_pane_not_found');
    }

    workspace.windows.push(window);
    markWorkspaceUpdated(workspace);
    await this.options.onWindowCreated?.({ window, workspace });

    const summary = this.summarizeWindow(window, this.getLivePaneProcesses(), { terminalOnly: true });
    const summaryPane = findResultPane(summary, createdPane.id);
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

  async deletePane(options: DeletePaneOptions): Promise<PaneDeleteResult> {
    return this.runWorkspaceMutation(() => this.deletePaneNow(options));
  }

  private async deletePaneNow(options: DeletePaneOptions): Promise<PaneDeleteResult> {
    const initialWorkspace = this.options.getCurrentWorkspace();
    if (!initialWorkspace) {
      throw new Error('workspace_not_loaded');
    }

    const initialWindow = initialWorkspace.windows.find((window) => window.id === options.windowId);
    if (!initialWindow) {
      throw new Error('window_not_found');
    }
    preparePaneDeletion(initialWindow, options.paneId);

    await this.options.stopWindowPanes?.({
      windowId: options.windowId,
      paneIds: [options.paneId],
    });

    // The desktop can change the workspace while process shutdown is awaiting.
    // Re-read and validate the latest layout before applying the structural edit.
    const workspace = this.options.getCurrentWorkspace();
    if (!workspace) {
      throw new Error('workspace_not_loaded');
    }
    const targetWindow = workspace.windows.find((window) => window.id === options.windowId);
    if (!targetWindow) {
      throw new Error('window_not_found');
    }
    const plan = preparePaneDeletion(targetWindow, options.paneId);

    targetWindow.layout = plan.layout;
    if (
      targetWindow.activePaneId === options.paneId
      || !plan.remainingPanes.some((pane) => pane.id === targetWindow.activePaneId)
    ) {
      targetWindow.activePaneId = plan.replacementPaneId;
    }
    targetWindow.lastActiveAt = new Date().toISOString();
    markWorkspaceUpdated(workspace);
    await this.options.onPaneDeleted?.({
      windowId: targetWindow.id,
      paneId: options.paneId,
      workspace,
    });
    await this.options.onWorkspaceLayoutUpdated?.({ workspace });

    const summary = this.summarizeWindow(targetWindow, this.getLivePaneProcesses(), { terminalOnly: true });
    const replacementPane = summary.panes.find((pane) => pane.paneId === plan.replacementPaneId);
    if (!replacementPane) {
      throw new Error('replacement_pane_not_found');
    }
    return {
      deleted: true,
      deletedPaneId: options.paneId,
      window: summary,
      replacementPane,
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
    const groupedWindowIds = new Set(
      workspace.groups
        .filter((group) => !group.archived)
        .flatMap((group) => getGroupWindowIds(group.layout)),
    );
    if (windowIds.some((windowId) => groupedWindowIds.has(windowId))) {
      throw new Error('window_already_grouped');
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

  async removeWindowFromGroup(options: RemoveGroupWindowOptions): Promise<GroupWindowRemoveResult> {
    return this.runWorkspaceMutation(() => this.removeWindowFromGroupNow(options));
  }

  private async removeWindowFromGroupNow(
    options: RemoveGroupWindowOptions,
  ): Promise<GroupWindowRemoveResult> {
    const workspace = this.options.getCurrentWorkspace();
    if (!workspace) {
      throw new Error('workspace_not_loaded');
    }

    const groupIndex = workspace.groups.findIndex((group) => group.id === options.groupId);
    if (groupIndex < 0) {
      throw new Error('group_not_found');
    }

    const group = workspace.groups[groupIndex]!;
    const memberIds = getGroupWindowIds(group.layout);
    if (!memberIds.includes(options.windowId)) {
      throw new Error('window_not_in_group');
    }
    if (!workspace.windows.some((window) => window.id === options.windowId)) {
      throw new Error('window_not_found');
    }

    const replacementWindowId = findReplacementGroupWindowId(
      workspace,
      memberIds,
      options.windowId,
    );
    const nextLayout = removeWindowFromGroupLayout(group.layout, options.windowId);
    const remainingWindowIds = nextLayout ? getGroupWindowIds(nextLayout) : [];
    const dissolved = !nextLayout || remainingWindowIds.length < 2;

    if (dissolved) {
      workspace.groups.splice(groupIndex, 1);
    } else {
      group.layout = nextLayout;
      if (!remainingWindowIds.includes(group.activeWindowId)) {
        group.activeWindowId = remainingWindowIds[0]!;
      }
      group.lastActiveAt = new Date().toISOString();
    }

    markWorkspaceUpdated(workspace);
    await this.options.onWorkspaceLayoutUpdated?.({ workspace });

    const livePaneProcesses = this.getLivePaneProcesses();
    const replacementWindowRecord = replacementWindowId
      ? workspace.windows.find((window) => window.id === replacementWindowId)
      : undefined;
    const replacementWindow = replacementWindowRecord
      ? this.summarizeWindow(replacementWindowRecord, livePaneProcesses, { terminalOnly: true })
      : null;
    const replacementPane = replacementWindow
      ? findResultPane(replacementWindow, replacementWindow.activePaneId)
      : null;
    const updatedGroup = dissolved
      ? null
      : this.summarizeGroup(group, workspace, livePaneProcesses, { terminalOnly: true });

    return {
      removed: true,
      groupId: options.groupId,
      windowId: options.windowId,
      dissolved,
      group: updatedGroup,
      replacementWindow,
      replacementPane,
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

type PaneDeletionPlan = {
  layout: LayoutNode;
  remainingPanes: Pane[];
  replacementPaneId: string;
};

function preparePaneDeletion(window: Window, paneId: string): PaneDeletionPlan {
  const panes = collectPanes(window.layout);
  const paneIndex = panes.findIndex((pane) => pane.id === paneId);
  if (paneIndex < 0) {
    throw new Error('pane_not_found');
  }

  const targetPane = panes[paneIndex]!;
  if (getPaneKind(targetPane) !== 'terminal') {
    throw new Error('pane_not_terminal');
  }
  if (panes.length <= 1) {
    throw new Error('pane_delete_last_pane');
  }

  const remainingPanes = panes.filter((pane) => pane.id !== paneId);
  const nextTerminal = panes
    .slice(paneIndex + 1)
    .find((pane) => getPaneKind(pane) === 'terminal');
  const previousTerminal = panes
    .slice(0, paneIndex)
    .reverse()
    .find((pane) => getPaneKind(pane) === 'terminal');
  const replacementPane = nextTerminal ?? previousTerminal;
  if (!replacementPane) {
    throw new Error('pane_delete_last_terminal');
  }

  const layout = removePaneFromLayout(window.layout, paneId);
  if (!layout || layout === window.layout) {
    throw new Error('pane_not_found');
  }
  return {
    layout,
    remainingPanes,
    replacementPaneId: replacementPane.id,
  };
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

function findReplacementGroupWindowId(
  workspace: Workspace,
  memberIds: string[],
  removedWindowId: string,
): string | null {
  const removedIndex = memberIds.indexOf(removedWindowId);
  const candidateIds = [
    ...memberIds.slice(removedIndex + 1),
    ...memberIds.slice(0, removedIndex).reverse(),
  ];
  return candidateIds.find((windowId) => {
    const window = workspace.windows.find((item) => item.id === windowId);
    return window
      ? collectPanes(window.layout).some((pane) => getPaneKind(pane) === 'terminal')
      : false;
  }) ?? null;
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
