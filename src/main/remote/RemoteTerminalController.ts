import { randomUUID } from 'crypto';
import type { ProcessManager } from '../services/ProcessManager';
import { ProcessStatus } from '../types/process';
import type {
  RemoteTerminalSummary,
  TerminalHistoryResult,
  TerminalSubscribeResult,
} from '../../shared/remote/terminal-protocol';
import {
  TerminalStreamOpcode,
  encodeTerminalStreamFrame,
  encodeTerminalStreamJson,
  iterateTerminalStreamTextPayloads,
} from '../../shared/remote/terminal-stream-protocol';
import { buildPtyModeRehydrateSequence } from '../services/ptyKeyboardProtocolState';

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

type TerminalHistoryOptions = {
  sinceSeq?: number;
  beforeSeq?: number;
  limitBytes?: number;
  limitChunks?: number;
};

type TerminalStreamSnapshot = {
  serialized: string;
  firstSeq: number;
  lastSeq: number;
  gap: boolean;
  hasMoreBefore: boolean;
  evictedBeforeSeq: number;
  cols?: number;
  rows?: number;
  incremental: boolean;
  requestedSinceSeq: number;
  hasMoreAfter: boolean;
  screenSnapshotOffset?: number;
  screenSnapshotLength?: number;
};

const TERMINAL_STREAM_CHUNK_BYTES = 48 * 1024;
// Keep the first terminal paint small. Older output remains available through
// terminal.history and is prefetched by the mobile client after live streaming
// is active.
const TERMINAL_STREAM_SNAPSHOT_BYTES = 128 * 1024;
const TERMINAL_STREAM_INCREMENT_BYTES = 512 * 1024;
const TERMINAL_STREAM_SNAPSHOT_CHUNKS = 20_000;
const TERMINAL_STREAM_INCREMENT_CHUNKS = 250_000;
let nextTerminalStreamId = 1;

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

  getHistory(windowId: string, paneId: string, options: TerminalHistoryOptions = {}): TerminalHistoryResult {
    this.requirePid(windowId, paneId);
    const dimensions = this.processManager.getPaneTerminalDimensions(windowId, paneId);
    const screenSnapshot = this.processManager.getTerminalScreenSnapshot(windowId, paneId);
    if (typeof options.sinceSeq === 'number') {
      const history = this.processManager.getPtyHistoryEntriesSince(windowId, paneId, options.sinceSeq);
      const cursorAhead = options.sinceSeq > history.lastSeq;
      const entries = this.decorateEntriesForReplay(
        windowId,
        paneId,
        limitHistoryEntriesForward(history.entries, {
          limitBytes: options.limitBytes,
          limitChunks: options.limitChunks,
        }),
      );
      const lastSeq = entries.at(-1)?.seq ?? history.lastSeq;
      return {
        windowId,
        paneId,
        chunks: entries.map((entry) => entry.data),
        firstSeq: entries[0]?.seq ?? history.firstSeq,
        lastSeq,
        latestSeq: history.lastSeq,
        hasMoreAfter: lastSeq < history.lastSeq,
        gap: history.gap || cursorAhead,
        hasMoreBefore: history.hasMoreBefore,
        evictedBeforeSeq: history.evictedBeforeSeq,
        ...dimensions,
        ...(screenSnapshot ? { screenSnapshot } : {}),
      };
    }
    if (
      typeof options.beforeSeq === 'number'
      || typeof options.limitBytes === 'number'
      || typeof options.limitChunks === 'number'
    ) {
      const history = this.processManager.getPtyHistoryEntriesBefore(
        windowId,
        paneId,
        options.beforeSeq,
        {
          limitBytes: options.limitBytes,
          limitChunks: options.limitChunks,
        },
      );
      const replayEntries = this.decorateEntriesForReplay(
        windowId,
        paneId,
        history.entries,
      );
      return {
        windowId,
        paneId,
        chunks: replayEntries.map((entry) => entry.data),
        firstSeq: history.firstSeq,
        lastSeq: history.lastSeq,
        latestSeq: this.processManager.getLatestPaneOutputSeq(windowId, paneId),
        hasMoreAfter: false,
        gap: history.gap,
        hasMoreBefore: history.hasMoreBefore,
        evictedBeforeSeq: history.evictedBeforeSeq,
        ...dimensions,
        ...(screenSnapshot ? { screenSnapshot } : {}),
      };
    }
    const history = this.processManager.getPtyHistory(windowId, paneId);
    return {
      windowId,
      paneId,
      chunks: this.getReplayChunks(windowId, paneId, history.chunks),
      firstSeq: history.firstSeq,
      lastSeq: history.lastSeq,
      latestSeq: history.lastSeq,
      hasMoreAfter: false,
      gap: history.evictedBeforeSeq > 0,
      hasMoreBefore: false,
      evictedBeforeSeq: history.evictedBeforeSeq,
      ...dimensions,
      keyboardState: history.keyboardState,
      ...(screenSnapshot ? { screenSnapshot } : {}),
    };
  }

  subscribe(
    windowId: string,
    paneId: string,
    sinceSeq: number | undefined,
    emitBinary: (payload: Uint8Array<ArrayBufferLike>) => void,
  ): TerminalSubscribeResult & { activate: () => void; unsubscribe: () => void } {
    const pid = this.requirePid(windowId, paneId);
    const subscriptionId = randomUUID();
    const streamId = nextTerminalStreamId++;
    const bufferedLiveOutput: TerminalOutputPayload[] = [];
    let snapshot: TerminalStreamSnapshot | null = null;
    let cursor = 0;
    let activated = false;
    let closed = false;
    let lastEmittedSeq = sinceSeq ?? 0;
    const sendFrame = (
      opcode: TerminalStreamOpcode,
      payload: Uint8Array<ArrayBufferLike> = new Uint8Array(),
      frameSeq = cursor++,
    ) => {
      if (closed) {
        return;
      }
      emitBinary(encodeTerminalStreamFrame({ opcode, streamId, seq: frameSeq, payload }));
    };
    const emitOutput = (payload: TerminalOutputPayload) => {
      if (closed) {
        return;
      }
      if (payload.seq > 0 && payload.seq <= lastEmittedSeq) {
        return;
      }
      sendOutputFrames(sendFrame, payload.data, payload.seq);
      if (payload.seq > 0) {
        lastEmittedSeq = Math.max(lastEmittedSeq, payload.seq);
      }
    };
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
      emitOutput(payload);
    });
    snapshot = this.getSubscriptionSnapshot(windowId, paneId, sinceSeq ?? 0);
    lastEmittedSeq = snapshot.lastSeq;
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
      type: 'subscribed',
      subscriptionId,
      streamId,
      firstSeq: snapshot.firstSeq,
      lastSeq: snapshot.lastSeq,
      gap: snapshot.gap,
      activate: () => {
        if (activated || closed) {
          return;
        }
        sendSnapshotFrames(sendFrame, {
          kind: 'scrollback',
          windowId,
          paneId,
          data: snapshot?.serialized ?? '',
          cols: snapshot?.cols,
          rows: snapshot?.rows,
          firstSeq: snapshot?.firstSeq ?? 0,
          lastSeq: snapshot?.lastSeq ?? 0,
          gap: snapshot?.gap === true,
          hasMoreBefore: snapshot?.hasMoreBefore === true,
          evictedBeforeSeq: snapshot?.evictedBeforeSeq ?? 0,
          incremental: snapshot?.incremental === true,
          requestedSinceSeq: snapshot?.requestedSinceSeq ?? 0,
          hasMoreAfter: snapshot?.hasMoreAfter === true,
          screenSnapshotOffset: snapshot?.screenSnapshotOffset,
          screenSnapshotLength: snapshot?.screenSnapshotLength,
        });
        activated = true;
        for (const payload of bufferedLiveOutput) {
          if (closed) {
            return;
          }
          emitOutput(payload);
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
    this.processManager.clearPtyHistory(windowId, paneId);
    return {
      windowId,
      paneId,
      cleared: true,
      lastSeq: this.processManager.getLatestPaneOutputSeq(windowId, paneId),
    };
  }

  private requirePid(windowId: string, paneId: string): number {
    const pid = this.processManager.getPidByPane(windowId, paneId);
    if (pid === null) {
      throw new Error('terminal_not_found');
    }
    return pid;
  }

  private getRecentSnapshot(windowId: string, paneId: string): TerminalStreamSnapshot {
    const dimensions = this.processManager.getPaneTerminalDimensions(windowId, paneId);
    // Capture the floor before reading history. Output that arrives after this
    // point is either included by the history read or remains in the live queue;
    // it must never be skipped by advertising a newer lastSeq than serialized.
    const latestSeqBeforeHistory = this.processManager.getLatestPaneOutputSeq(windowId, paneId);
    const history = this.processManager.getPtyHistoryEntriesBefore(
      windowId,
      paneId,
      Number.MAX_SAFE_INTEGER,
      {
        limitBytes: TERMINAL_STREAM_SNAPSHOT_BYTES,
        limitChunks: TERMINAL_STREAM_SNAPSHOT_CHUNKS,
      },
    );
    const screenSnapshot = this.processManager.getTerminalScreenSnapshot(windowId, paneId);
    const replayEntries = this.decorateEntriesForReplay(
      windowId,
      paneId,
      history.entries,
    );
    const snapshotLastSeq = replayEntries.at(-1)?.seq ?? latestSeqBeforeHistory;
    let serialized = replayEntries.map((entry) => entry.data).join('');
    let screenSnapshotOffset: number | undefined;
    let screenSnapshotLength: number | undefined;
    if (
      screenSnapshot?.alternate &&
      screenSnapshot.windowId === windowId &&
      screenSnapshot.paneId === paneId &&
      typeof screenSnapshot.outputSeq === 'number' &&
      screenSnapshot.data
    ) {
      const snapshotSeq = Math.max(
        0,
        Math.min(snapshotLastSeq, screenSnapshot.outputSeq),
      );
      let insertOffset = 0;
      for (const entry of replayEntries) {
        if (entry.seq > snapshotSeq) {
          break;
        }
        insertOffset += entry.data.length;
      }
      serialized = `${serialized.slice(0, insertOffset)}${screenSnapshot.data}${serialized.slice(insertOffset)}`;
      screenSnapshotOffset = insertOffset;
      screenSnapshotLength = screenSnapshot.data.length;
    }
    serialized += buildPtyModeRehydrateSequence(history.keyboardState);
    return {
      serialized,
      firstSeq: history.firstSeq,
      lastSeq: snapshotLastSeq,
      gap: history.gap,
      hasMoreBefore: history.hasMoreBefore,
      evictedBeforeSeq: history.evictedBeforeSeq,
      ...dimensions,
      incremental: false,
      requestedSinceSeq: 0,
      hasMoreAfter: false,
      ...(screenSnapshotOffset !== undefined ? { screenSnapshotOffset } : {}),
      ...(screenSnapshotLength !== undefined ? { screenSnapshotLength } : {}),
    };
  }

  private getSubscriptionSnapshot(
    windowId: string,
    paneId: string,
    sinceSeq: number,
  ): TerminalStreamSnapshot {
    if (sinceSeq <= 0) {
      return this.getRecentSnapshot(windowId, paneId);
    }
    const dimensions = this.processManager.getPaneTerminalDimensions(windowId, paneId);
    const history = this.processManager.getPtyHistoryEntriesSince(windowId, paneId, sinceSeq);
    if (history.gap || sinceSeq > history.lastSeq) {
      return {
        ...this.getRecentSnapshot(windowId, paneId),
        requestedSinceSeq: sinceSeq,
      };
    }
    const entries = this.decorateEntriesForReplay(
      windowId,
      paneId,
      limitHistoryEntriesForward(history.entries, {
      limitBytes: TERMINAL_STREAM_INCREMENT_BYTES,
      limitChunks: TERMINAL_STREAM_INCREMENT_CHUNKS,
      }),
    );
    const lastSeq = entries.at(-1)?.seq ?? sinceSeq;
    return {
      serialized: entries.map((entry) => entry.data).join(''),
      firstSeq: entries[0]?.seq ?? sinceSeq,
      lastSeq,
      gap: false,
      hasMoreBefore: false,
      evictedBeforeSeq: history.evictedBeforeSeq,
      ...dimensions,
      incremental: true,
      requestedSinceSeq: sinceSeq,
      hasMoreAfter: lastSeq < history.lastSeq,
    };
  }

  private decorateEntriesForReplay(
    windowId: string,
    paneId: string,
    entries: ReadonlyArray<{ seq: number; data: string }>,
  ): Array<{ seq: number; data: string }> {
    const decorate = (this.processManager as ProcessManager & {
      decoratePtyHistoryEntriesForReplay?: ProcessManager['decoratePtyHistoryEntriesForReplay'];
    }).decoratePtyHistoryEntriesForReplay;
    return typeof decorate === 'function'
      ? decorate.call(this.processManager, windowId, paneId, entries)
      : entries.map((entry) => ({ ...entry }));
  }

  private getReplayChunks(windowId: string, paneId: string, fallback: string[]): string[] {
    const getReplay = (this.processManager as ProcessManager & {
      getPtyReplayChunks?: ProcessManager['getPtyReplayChunks'];
    }).getPtyReplayChunks;
    return typeof getReplay === 'function'
      ? getReplay.call(this.processManager, windowId, paneId)
      : fallback;
  }
}

function sendSnapshotFrames(
  sendFrame: (
    opcode: TerminalStreamOpcode,
    payload?: Uint8Array<ArrayBufferLike>,
    frameSeq?: number,
  ) => void,
  options: {
    kind: 'scrollback';
    windowId: string;
    paneId: string;
    data: string;
    cols?: number;
    rows?: number;
    firstSeq: number;
    lastSeq: number;
    gap: boolean;
    hasMoreBefore: boolean;
    evictedBeforeSeq: number;
    incremental: boolean;
    requestedSinceSeq: number;
    hasMoreAfter: boolean;
    screenSnapshotOffset?: number;
    screenSnapshotLength?: number;
  },
): void {
  sendFrame(
    TerminalStreamOpcode.SnapshotStart,
    encodeTerminalStreamJson({
      kind: options.kind,
      windowId: options.windowId,
      paneId: options.paneId,
      cols: options.cols,
      rows: options.rows,
      firstSeq: options.firstSeq,
      lastSeq: options.lastSeq,
      gap: options.gap,
      hasMoreBefore: options.hasMoreBefore,
      evictedBeforeSeq: options.evictedBeforeSeq,
      incremental: options.incremental,
      requestedSinceSeq: options.requestedSinceSeq,
      hasMoreAfter: options.hasMoreAfter,
      screenSnapshotOffset: options.screenSnapshotOffset,
      screenSnapshotLength: options.screenSnapshotLength,
    }),
  );
  for (const chunk of iterateTerminalStreamTextPayloads(options.data, TERMINAL_STREAM_CHUNK_BYTES)) {
    sendFrame(TerminalStreamOpcode.SnapshotChunk, chunk);
  }
  sendFrame(TerminalStreamOpcode.SnapshotEnd);
}

function sendOutputFrames(
  sendFrame: (
    opcode: TerminalStreamOpcode,
    payload?: Uint8Array<ArrayBufferLike>,
    frameSeq?: number,
  ) => void,
  data: string,
  seq: number,
): void {
  const chunks = Array.from(iterateTerminalStreamTextPayloads(data, TERMINAL_STREAM_CHUNK_BYTES));
  chunks.forEach((chunk, index) => {
    sendFrame(
      TerminalStreamOpcode.Output,
      chunk,
      index === chunks.length - 1 ? seq : 0,
    );
  });
}

function limitHistoryEntriesForward<T extends { data: string }>(
  entries: T[],
  limits: { limitBytes?: number; limitChunks?: number },
): T[] {
  const maxBytes = normalizeHistoryLimit(limits.limitBytes, Number.POSITIVE_INFINITY);
  const maxChunks = normalizeHistoryLimit(limits.limitChunks, Number.POSITIVE_INFINITY);
  const selected: T[] = [];
  let totalLength = 0;
  for (const entry of entries) {
    if (selected.length >= maxChunks) {
      break;
    }
    if (selected.length > 0 && totalLength + entry.data.length > maxBytes) {
      break;
    }
    selected.push(entry);
    totalLength += entry.data.length;
  }
  return selected;
}

function normalizeHistoryLimit(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
}
