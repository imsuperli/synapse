import { describe, expect, it } from 'vitest'
import {
  appendRemoteTerminalData,
  appendRemoteTerminalHistoryIncrement,
  appendRemoteTerminalIncrementalSnapshot,
  buildRemoteTerminalInitialData,
  createRemoteTerminalHistoryState,
  MAX_REMOTE_TERMINAL_HISTORY_CHARS,
  prependRemoteTerminalHistoryPage,
  replaceRemoteTerminalHistorySnapshot,
  resetRemoteTerminalHistoryState
} from './remote-terminal-history-state'

describe('remote terminal history state', () => {
  it('keeps a renderer screen snapshot between history and later output', () => {
    const state = createRemoteTerminalHistoryState()
    replaceRemoteTerminalHistorySnapshot(state, {
      serialized: 'old<screen>tail',
      firstSeq: 2,
      lastSeq: 4,
      hasMoreBefore: true,
      screenSnapshotOffset: 3,
      screenSnapshotLength: 8
    })

    expect(state.chunks).toEqual(['old', 'tail'])
    expect(buildRemoteTerminalInitialData(state)).toBe('old<screen>tail')

    expect(appendRemoteTerminalData(state, 5, 'live').data).toBe('live')
    expect(buildRemoteTerminalInitialData(state)).toBe('old<screen>taillive')

    prependRemoteTerminalHistoryPage(state, {
      chunks: ['older-'],
      firstSeq: 1,
      lastSeq: 1,
      hasMoreBefore: false
    })
    expect(buildRemoteTerminalInitialData(state)).toBe('older-old<screen>taillive')
  })

  it('queues live output that jumps ahead until incremental history fills the gap', () => {
    const state = createRemoteTerminalHistoryState()
    replaceRemoteTerminalHistorySnapshot(state, {
      serialized: '100',
      firstSeq: 100,
      lastSeq: 100,
      hasMoreBefore: false
    })

    expect(appendRemoteTerminalData(state, 103, '103')).toMatchObject({
      data: '',
      needsHistorySync: true
    })
    expect(state.lastSeq).toBe(100)

    const result = appendRemoteTerminalHistoryIncrement(state, {
      chunks: ['101', '102'],
      firstSeq: 101,
      lastSeq: 102,
      hasMoreBefore: false
    })

    expect(result.data).toBe('101102103')
    expect(state.lastSeq).toBe(103)
    expect(state.pendingDataBySeq.size).toBe(0)
  })

  it('drops a queued live event when the history response already contains it', () => {
    const state = createRemoteTerminalHistoryState()
    replaceRemoteTerminalHistorySnapshot(state, {
      serialized: '100',
      firstSeq: 100,
      lastSeq: 100,
      hasMoreBefore: false
    })

    appendRemoteTerminalData(state, 103, 'live-103')
    const result = appendRemoteTerminalHistoryIncrement(state, {
      chunks: ['101', '102', 'history-103'],
      firstSeq: 101,
      lastSeq: 103,
      hasMoreBefore: false
    })

    expect(result).toEqual({
      data: '101102history-103',
      needsHistorySync: false,
      overflowed: false
    })
    expect(state.pendingDataBySeq.size).toBe(0)
    expect(state.pendingDataBytes).toBe(0)
  })

  it('drops overlap when live output wins a race with an incremental response', () => {
    const state = createRemoteTerminalHistoryState()
    replaceRemoteTerminalHistorySnapshot(state, {
      serialized: '10',
      firstSeq: 10,
      lastSeq: 10,
      hasMoreBefore: false
    })
    expect(appendRemoteTerminalData(state, 11, '11').data).toBe('11')

    const result = appendRemoteTerminalHistoryIncrement(state, {
      chunks: ['11', '12', '13'],
      firstSeq: 11,
      lastSeq: 13,
      hasMoreBefore: false
    })

    expect(result.data).toBe('1213')
    expect(state.lastSeq).toBe(13)
    expect(buildRemoteTerminalInitialData(state)).toBe('10111213')
  })

  it('applies a reconnect snapshot only when its requested cursor still matches', () => {
    const state = createRemoteTerminalHistoryState()
    replaceRemoteTerminalHistorySnapshot(state, {
      serialized: '10',
      firstSeq: 10,
      lastSeq: 10,
      hasMoreBefore: false
    })

    expect(appendRemoteTerminalIncrementalSnapshot(state, {
      serialized: '1112',
      requestedSinceSeq: 10,
      firstSeq: 11,
      lastSeq: 12,
      hasMoreAfter: true
    })).toEqual({
      data: '1112',
      needsHistorySync: true,
      overflowed: false
    })
    expect(state.lastSeq).toBe(12)

    expect(appendRemoteTerminalIncrementalSnapshot(state, {
      serialized: 'stale',
      requestedSinceSeq: 10,
      firstSeq: 11,
      lastSeq: 11,
      hasMoreAfter: false
    })).toEqual({
      data: '',
      needsHistorySync: true,
      overflowed: false
    })
    expect(buildRemoteTerminalInitialData(state)).toBe('101112')
  })

  it('drops queued live output already covered by a reconnect snapshot', () => {
    const state = createRemoteTerminalHistoryState()
    replaceRemoteTerminalHistorySnapshot(state, {
      serialized: '10',
      firstSeq: 10,
      lastSeq: 10,
      hasMoreBefore: false
    })
    appendRemoteTerminalData(state, 13, 'live-13')

    const result = appendRemoteTerminalIncrementalSnapshot(state, {
      serialized: '111213',
      requestedSinceSeq: 10,
      firstSeq: 11,
      lastSeq: 13,
      hasMoreAfter: false
    })

    expect(result).toEqual({
      data: '111213',
      needsHistorySync: false,
      overflowed: false
    })
    expect(state.pendingDataBySeq.size).toBe(0)
    expect(state.pendingDataBytes).toBe(0)
  })

  it('does not duplicate an overlapping older-history page', () => {
    const state = createRemoteTerminalHistoryState()
    replaceRemoteTerminalHistorySnapshot(state, {
      serialized: '345',
      firstSeq: 3,
      lastSeq: 5,
      hasMoreBefore: true
    })

    const prepended = prependRemoteTerminalHistoryPage(state, {
      chunks: ['1', '2', '3'],
      firstSeq: 1,
      lastSeq: 3,
      hasMoreBefore: false
    })

    expect(prepended).toEqual(['1', '2'])
    expect(buildRemoteTerminalInitialData(state)).toBe('12345')
    expect(state.firstSeq).toBe(1)
  })

  it('retains the desktop eviction boundary when older history is prepended', () => {
    const state = createRemoteTerminalHistoryState()
    replaceRemoteTerminalHistorySnapshot(state, {
      serialized: 'recent',
      firstSeq: 10,
      lastSeq: 10,
      hasMoreBefore: true
    })

    prependRemoteTerminalHistoryPage(state, {
      chunks: ['old'],
      firstSeq: 4,
      lastSeq: 9,
      hasMoreBefore: false,
      gap: true,
      evictedBeforeSeq: 3
    })

    expect(state).toMatchObject({
      gap: true,
      evictedBeforeSeq: 3,
      hasMoreBefore: false
    })
  })

  it('tracks retained history and requests compaction at the desktop source budget', () => {
    const state = createRemoteTerminalHistoryState()
    replaceRemoteTerminalHistorySnapshot(state, {
      serialized: 'seed',
      firstSeq: 1,
      lastSeq: 1,
      hasMoreBefore: false
    })

    expect(state.retainedChars).toBe(4)
    state.retainedChars = MAX_REMOTE_TERMINAL_HISTORY_CHARS
    const result = appendRemoteTerminalData(state, 2, 'x')

    expect(result.overflowed).toBe(true)
    expect(state.budgetExceeded).toBe(true)

    resetRemoteTerminalHistoryState(state)
    expect(state.retainedChars).toBe(0)
    expect(state.budgetExceeded).toBe(false)
  })
})
