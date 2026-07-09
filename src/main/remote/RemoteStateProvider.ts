import type { ProcessManager } from '../services/ProcessManager';
import { ProcessStatus } from '../types/process';
import type { Workspace } from '../types/workspace';
import { WindowStatus, type LayoutNode, type Pane, type PaneBackend, type PaneKind, type Window } from '../../shared/types/window';
import type {
  PaneListResult,
  RemotePaneSummary,
  RemoteWindowSummary,
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
  }) => Promise<{ pid: number; sessionId: string; status: WindowStatus }>;
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

export class RemoteStateProvider {
  constructor(private readonly options: RemoteStateProviderOptions) {}

  listWindows(options: ListOptions = {}): WindowListResult {
    const workspace = this.options.getCurrentWorkspace();
    if (!workspace) {
      return { windows: [] };
    }

    const livePaneProcesses = this.getLivePaneProcesses();
    const windows = workspace.windows
      .filter((window) => options.includeArchived || !window.archived)
      .map((window) => this.summarizeWindow(window, livePaneProcesses, options))
      .filter((window) => !options.terminalOnly || window.terminalPaneCount > 0);

    return { windows };
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
    return {
      window,
      pane: findResultPane(window, options.paneId ?? targetWindow.activePaneId),
      startedPanes: window.panes.filter((pane) => startedPaneIds.includes(pane.paneId)),
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
