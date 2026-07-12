export type RemoteTerminalHistoryState = {
  chunks: string[]
  firstSeq: number
  lastSeq: number
  hasMoreBefore: boolean
  screenSnapshotData: string
  screenSnapshotTailChunkCount: number
  pendingDataBySeq: Map<number, string>
  pendingDataBytes: number
}

export type RemoteTerminalSnapshot = {
  serialized: string
  firstSeq: number
  lastSeq: number
  hasMoreBefore: boolean
  screenSnapshotOffset?: number
  screenSnapshotLength?: number
}

export type RemoteTerminalHistoryPage = {
  chunks: string[]
  firstSeq: number
  lastSeq: number
  hasMoreBefore: boolean
}

export type RemoteTerminalIncrementalSnapshot = {
  serialized: string
  requestedSinceSeq: number
  firstSeq: number
  lastSeq: number
  hasMoreAfter: boolean
}

export type RemoteTerminalAppendResult = {
  data: string
  needsHistorySync: boolean
  overflowed: boolean
}

const MAX_PENDING_DATA_ENTRIES = 10_000
const MAX_PENDING_DATA_BYTES = 4 * 1024 * 1024

export function createRemoteTerminalHistoryState(): RemoteTerminalHistoryState {
  return {
    chunks: [],
    firstSeq: 0,
    lastSeq: 0,
    hasMoreBefore: false,
    screenSnapshotData: '',
    screenSnapshotTailChunkCount: 0,
    pendingDataBySeq: new Map(),
    pendingDataBytes: 0
  }
}

export function resetRemoteTerminalHistoryState(state: RemoteTerminalHistoryState): void {
  state.chunks = []
  state.firstSeq = 0
  state.lastSeq = 0
  state.hasMoreBefore = false
  state.screenSnapshotData = ''
  state.screenSnapshotTailChunkCount = 0
  state.pendingDataBySeq.clear()
  state.pendingDataBytes = 0
}

export function replaceRemoteTerminalHistorySnapshot(
  state: RemoteTerminalHistoryState,
  snapshot: RemoteTerminalSnapshot
): void {
  const extracted = extractScreenSnapshot(snapshot)
  state.chunks = extracted.historyChunks
  state.firstSeq = snapshot.firstSeq
  state.lastSeq = snapshot.lastSeq
  state.hasMoreBefore = snapshot.hasMoreBefore
  state.screenSnapshotData = extracted.screenSnapshotData
  state.screenSnapshotTailChunkCount = extracted.tailChunkCount
  state.pendingDataBySeq.clear()
  state.pendingDataBytes = 0
}

export function buildRemoteTerminalInitialData(state: RemoteTerminalHistoryState): string {
  if (!state.screenSnapshotData) {
    return state.chunks.join('')
  }
  const tailChunkCount = Math.min(state.screenSnapshotTailChunkCount, state.chunks.length)
  const insertAt = state.chunks.length - tailChunkCount
  return `${state.chunks.slice(0, insertAt).join('')}${state.screenSnapshotData}${state.chunks.slice(insertAt).join('')}`
}

export function appendRemoteTerminalData(
  state: RemoteTerminalHistoryState,
  seq: number,
  chunk: string
): RemoteTerminalAppendResult {
  if (!Number.isInteger(seq) || seq <= 0 || !chunk) {
    return { data: '', needsHistorySync: false, overflowed: false }
  }
  if (seq <= state.lastSeq || state.pendingDataBySeq.has(seq)) {
    return { data: '', needsHistorySync: false, overflowed: false }
  }
  if (seq > state.lastSeq + 1) {
    state.pendingDataBySeq.set(seq, chunk)
    state.pendingDataBytes += chunk.length
    const overflowed =
      state.pendingDataBySeq.size > MAX_PENDING_DATA_ENTRIES ||
      state.pendingDataBytes > MAX_PENDING_DATA_BYTES
    if (overflowed) {
      state.pendingDataBySeq.clear()
      state.pendingDataBytes = 0
    }
    return { data: '', needsHistorySync: true, overflowed }
  }

  const appended = appendContiguousData(state, seq, chunk)
  return {
    data: appended,
    needsHistorySync: state.pendingDataBySeq.size > 0,
    overflowed: false
  }
}

export function appendRemoteTerminalHistoryIncrement(
  state: RemoteTerminalHistoryState,
  page: RemoteTerminalHistoryPage
): RemoteTerminalAppendResult {
  if (page.chunks.length === 0) {
    return {
      data: '',
      needsHistorySync: state.pendingDataBySeq.size > 0,
      overflowed: false
    }
  }
  if (page.lastSeq - page.firstSeq + 1 !== page.chunks.length) {
    return { data: '', needsHistorySync: true, overflowed: true }
  }
  if (page.firstSeq > state.lastSeq + 1) {
    return { data: '', needsHistorySync: true, overflowed: true }
  }

  const skip = Math.max(0, state.lastSeq - page.firstSeq + 1)
  const freshChunks = page.chunks.slice(skip)
  if (freshChunks.length > 0) {
    if (state.chunks.length === 0 && state.firstSeq <= 0) {
      state.firstSeq = page.firstSeq + skip
    }
    appendHistoryChunks(state, freshChunks)
    state.lastSeq = page.firstSeq + skip + freshChunks.length - 1
  }
  discardPendingDataThrough(state, state.lastSeq)
  const pending = flushPendingData(state)
  return {
    data: `${freshChunks.join('')}${pending}`,
    needsHistorySync: state.pendingDataBySeq.size > 0,
    overflowed: false
  }
}

export function appendRemoteTerminalIncrementalSnapshot(
  state: RemoteTerminalHistoryState,
  snapshot: RemoteTerminalIncrementalSnapshot
): RemoteTerminalAppendResult {
  if (state.lastSeq !== snapshot.requestedSinceSeq) {
    return { data: '', needsHistorySync: true, overflowed: false }
  }
  if (!snapshot.serialized) {
    return {
      data: '',
      needsHistorySync: snapshot.hasMoreAfter || state.pendingDataBySeq.size > 0,
      overflowed: false
    }
  }
  if (
    snapshot.firstSeq !== snapshot.requestedSinceSeq + 1 ||
    snapshot.lastSeq < snapshot.firstSeq
  ) {
    return { data: '', needsHistorySync: true, overflowed: true }
  }
  if (state.chunks.length === 0 && state.firstSeq <= 0) {
    state.firstSeq = snapshot.firstSeq
  }
  appendHistoryChunks(state, [snapshot.serialized])
  state.lastSeq = snapshot.lastSeq
  discardPendingDataThrough(state, state.lastSeq)
  const pending = flushPendingData(state)
  return {
    data: `${snapshot.serialized}${pending}`,
    needsHistorySync: snapshot.hasMoreAfter || state.pendingDataBySeq.size > 0,
    overflowed: false
  }
}

export function prependRemoteTerminalHistoryPage(
  state: RemoteTerminalHistoryState,
  page: RemoteTerminalHistoryPage
): string[] {
  if (page.chunks.length === 0) {
    state.hasMoreBefore = page.hasMoreBefore
    return []
  }
  const currentFirstSeq = state.firstSeq
  const pageLastSeq = page.lastSeq
  const takeCount = currentFirstSeq > 0 && pageLastSeq >= currentFirstSeq
    ? Math.max(0, currentFirstSeq - page.firstSeq)
    : page.chunks.length
  const olderChunks = page.chunks.slice(0, takeCount)
  if (olderChunks.length > 0) {
    state.chunks = [...olderChunks, ...state.chunks]
    state.firstSeq = page.firstSeq
  }
  state.hasMoreBefore = page.hasMoreBefore
  return olderChunks
}

function appendContiguousData(
  state: RemoteTerminalHistoryState,
  seq: number,
  chunk: string
): string {
  if (state.chunks.length === 0 && state.firstSeq <= 0) {
    state.firstSeq = seq
  }
  appendHistoryChunks(state, [chunk])
  state.lastSeq = seq
  return `${chunk}${flushPendingData(state)}`
}

function flushPendingData(state: RemoteTerminalHistoryState): string {
  const chunks: string[] = []
  while (true) {
    const nextSeq = state.lastSeq + 1
    const next = state.pendingDataBySeq.get(nextSeq)
    if (next === undefined) {
      break
    }
    state.pendingDataBySeq.delete(nextSeq)
    state.pendingDataBytes = Math.max(0, state.pendingDataBytes - next.length)
    appendHistoryChunks(state, [next])
    state.lastSeq = nextSeq
    chunks.push(next)
  }
  return chunks.join('')
}

function discardPendingDataThrough(state: RemoteTerminalHistoryState, seq: number): void {
  for (const [pendingSeq, chunk] of state.pendingDataBySeq) {
    if (pendingSeq > seq) {
      continue
    }
    state.pendingDataBySeq.delete(pendingSeq)
    state.pendingDataBytes = Math.max(0, state.pendingDataBytes - chunk.length)
  }
}

function appendHistoryChunks(state: RemoteTerminalHistoryState, chunks: string[]): void {
  state.chunks.push(...chunks)
  if (state.screenSnapshotData) {
    state.screenSnapshotTailChunkCount += chunks.length
  }
}

function extractScreenSnapshot(snapshot: RemoteTerminalSnapshot): {
  historyChunks: string[]
  screenSnapshotData: string
  tailChunkCount: number
} {
  const offset = snapshot.screenSnapshotOffset
  const length = snapshot.screenSnapshotLength
  if (
    typeof offset !== 'number' ||
    typeof length !== 'number' ||
    !Number.isInteger(offset) ||
    !Number.isInteger(length) ||
    offset < 0 ||
    length <= 0 ||
    offset + length > snapshot.serialized.length
  ) {
    return {
      historyChunks: snapshot.serialized ? [snapshot.serialized] : [],
      screenSnapshotData: '',
      tailChunkCount: 0
    }
  }

  const before = snapshot.serialized.slice(0, offset)
  const screenSnapshotData = snapshot.serialized.slice(offset, offset + length)
  const after = snapshot.serialized.slice(offset + length)
  const historyChunks = [before, after].filter((chunk) => chunk.length > 0)
  return {
    historyChunks,
    screenSnapshotData,
    tailChunkCount: after ? 1 : 0
  }
}
