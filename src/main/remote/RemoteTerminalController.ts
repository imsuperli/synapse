import { randomUUID } from 'crypto';
import type { ProcessManager } from '../services/ProcessManager';
import { ProcessStatus } from '../types/process';
import type {
  RemoteTerminalSummary,
  TerminalHistoryResult,
  TerminalSubscribeResult,
} from '../../shared/remote/terminal-protocol';

export type TerminalOutputPayload = {
  windowId: string;
  paneId: string;
  seq: number;
  data: string;
};

export type TerminalClearResult = {
  windowId: string;
  paneId: string;
  cleared: true;
  lastSeq: number;
};

export class RemoteTerminalController {
  private readonly subscriptions = new Map<string, () => void>();

  constructor(private readonly processManager: ProcessManager) {}

  listRunningTerminals(): RemoteTerminalSummary[] {
    return this.processManager
      .listProcesses()
      .filter((process) => process.windowId && process.paneId)
      .map((process) => ({
        windowId: process.windowId ?? null,
        paneId: process.paneId ?? null,
        sessionId: process.sessionId,
        pid: process.pid,
        backend: process.backend,
        status: process.status === ProcessStatus.Exited ? 'exited' : 'alive',
        workingDirectory: process.workingDirectory,
        command: process.command,
        profileId: process.profileId,
      }));
  }

  getHistory(windowId: string, paneId: string, sinceSeq?: number): TerminalHistoryResult {
    this.requirePid(windowId, paneId);
    const dimensions = this.processManager.getPaneTerminalDimensions(paneId);
    if (typeof sinceSeq === 'number') {
      const history = this.processManager.getPtyHistoryEntriesSince(paneId, sinceSeq);
      return {
        windowId,
        paneId,
        chunks: history.entries.map((entry) => entry.data),
        firstSeq: history.firstSeq,
        lastSeq: history.lastSeq,
        gap: history.gap,
        ...dimensions,
      };
    }
    const history = this.processManager.getPtyHistory(paneId);
    return {
      windowId,
      paneId,
      chunks: history.chunks,
      firstSeq: history.firstSeq,
      lastSeq: history.lastSeq,
      gap: history.evictedBeforeSeq > 0,
      ...dimensions,
      keyboardState: history.keyboardState,
    };
  }

  subscribe(
    windowId: string,
    paneId: string,
    sinceSeq: number | undefined,
    emit: (payload: TerminalOutputPayload) => void,
  ): TerminalSubscribeResult & { activate: () => void; unsubscribe: () => void } {
    const pid = this.requirePid(windowId, paneId);
    const replaySinceSeq = sinceSeq ?? 0;
    const subscriptionId = randomUUID();
    const bufferedLiveOutput: TerminalOutputPayload[] = [];
    let activated = false;
    let closed = false;
    let replayLastSeq = replaySinceSeq;
    const unsubscribeFromPty = this.processManager.subscribePtyData(pid, (data, seq) => {
      if (closed) {
        return;
      }
      const outputSeq = seq ?? 0;
      const payload = {
        windowId,
        paneId,
        seq: outputSeq,
        data,
      };
      if (!activated) {
        bufferedLiveOutput.push(payload);
        return;
      }
      if (shouldEmitTerminalOutput(outputSeq, replayLastSeq)) {
        emit(payload);
      }
    });
    const replay = this.processManager.getPtyHistoryEntriesSince(paneId, replaySinceSeq);
    replayLastSeq = Math.max(replaySinceSeq, replay.lastSeq);
    const closeSubscription = () => {
      if (closed) {
        return;
      }
      closed = true;
      bufferedLiveOutput.length = 0;
      unsubscribeFromPty();
    };
    this.subscriptions.set(subscriptionId, closeSubscription);
    return {
      subscriptionId,
      firstSeq: replay.firstSeq,
      lastSeq: replay.lastSeq,
      gap: replay.gap,
      activate: () => {
        if (activated || closed) {
          return;
        }
        for (const entry of replay.entries) {
          if (closed) {
            return;
          }
          emit({
            windowId,
            paneId,
            seq: entry.seq,
            data: entry.data,
          });
        }
        activated = true;
        for (const payload of bufferedLiveOutput) {
          if (closed) {
            return;
          }
          if (shouldEmitTerminalOutput(payload.seq, replayLastSeq)) {
            emit(payload);
          }
        }
        bufferedLiveOutput.length = 0;
      },
      unsubscribe: () => this.unsubscribe(subscriptionId),
    };
  }

  unsubscribe(subscriptionId: string): boolean {
    const unsubscribe = this.subscriptions.get(subscriptionId);
    if (!unsubscribe) {
      return false;
    }
    this.subscriptions.delete(subscriptionId);
    unsubscribe();
    return true;
  }

  unsubscribeAll(): void {
    for (const subscriptionId of Array.from(this.subscriptions.keys())) {
      this.unsubscribe(subscriptionId);
    }
  }

  send(windowId: string, paneId: string, data: string): void {
    const pid = this.requirePid(windowId, paneId);
    this.processManager.writeToPty(pid, data);
  }

  clear(windowId: string, paneId: string): TerminalClearResult {
    this.requirePid(windowId, paneId);
    this.processManager.clearPtyHistory(paneId);
    return {
      windowId,
      paneId,
      cleared: true,
      lastSeq: this.processManager.getLatestPaneOutputSeq(paneId),
    };
  }

  private requirePid(windowId: string, paneId: string): number {
    const pid = this.processManager.getPidByPane(windowId, paneId);
    if (pid === null) {
      throw new Error('terminal_not_found');
    }
    return pid;
  }
}

function shouldEmitTerminalOutput(outputSeq: number, sinceSeq: number): boolean {
  return outputSeq === 0 || outputSeq > sinceSeq;
}
