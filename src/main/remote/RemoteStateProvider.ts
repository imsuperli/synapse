import type { ProcessManager } from '../services/ProcessManager';
import { ProcessStatus } from '../types/process';
import type { Workspace } from '../types/workspace';
import type { LayoutNode, Pane, PaneBackend, PaneKind, Window } from '../../shared/types/window';
import type {
  PaneListResult,
  RemotePaneSummary,
  RemoteWindowSummary,
  WindowListResult,
} from '../../shared/remote/window-protocol';

type RemoteStateProviderOptions = {
  getCurrentWorkspace: () => Workspace | null;
  processManager: ProcessManager;
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
