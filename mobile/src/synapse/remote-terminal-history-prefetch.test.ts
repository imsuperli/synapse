import { describe, expect, it } from 'vitest'
import {
  cacheRemoteTerminalHistoryPage,
  canPrefetchRemoteTerminalHistory,
  createRemoteTerminalHistoryPrefetchState,
  resetRemoteTerminalHistoryPrefetchState,
  takePrefetchedRemoteTerminalHistory
} from './remote-terminal-history-prefetch'

describe('remote terminal history prefetch', () => {
  it('caches consecutive older pages and preserves their activation order', () => {
    const state = createRemoteTerminalHistoryPrefetchState()
    resetRemoteTerminalHistoryPrefetchState(state, 10, true)

    expect(cacheRemoteTerminalHistoryPage(state, {
      chunks: ['7', '8', '9'],
      firstSeq: 7,
      lastSeq: 9,
      hasMoreBefore: true
    })).toBe(true)
    expect(cacheRemoteTerminalHistoryPage(state, {
      chunks: ['4', '5', '6'],
      firstSeq: 4,
      lastSeq: 6,
      hasMoreBefore: false
    })).toBe(true)

    const cached = takePrefetchedRemoteTerminalHistory(state)
    expect(cached.pages.map((page) => page.firstSeq)).toEqual([7, 4])
    expect(cached.hasMoreBefore).toBe(false)
    expect(state.pages).toEqual([])
  })

  it('marks history exhausted when the server returns no older chunks', () => {
    const state = createRemoteTerminalHistoryPrefetchState()
    resetRemoteTerminalHistoryPrefetchState(state, 4, true)

    expect(cacheRemoteTerminalHistoryPage(state, {
      chunks: [],
      firstSeq: 0,
      lastSeq: 0,
      hasMoreBefore: false
    })).toBe(false)
    expect(state.hasMoreBefore).toBe(false)
    expect(canPrefetchRemoteTerminalHistory(state, 1024)).toBe(false)
  })

  it('stops background prefetch at the memory bound', () => {
    const state = createRemoteTerminalHistoryPrefetchState()
    resetRemoteTerminalHistoryPrefetchState(state, 3, true)
    cacheRemoteTerminalHistoryPage(state, {
      chunks: ['1234'],
      firstSeq: 2,
      lastSeq: 2,
      hasMoreBefore: true
    })

    expect(canPrefetchRemoteTerminalHistory(state, 4)).toBe(false)
  })

  it('rejects overlapping pages without moving the history cursor', () => {
    const state = createRemoteTerminalHistoryPrefetchState()
    resetRemoteTerminalHistoryPrefetchState(state, 10, true)

    expect(cacheRemoteTerminalHistoryPage(state, {
      chunks: ['overlap'],
      firstSeq: 9,
      lastSeq: 10,
      hasMoreBefore: true
    })).toBe(false)
    expect(state.nextBeforeSeq).toBe(10)
  })

  it('preserves the desktop eviction boundary through cache activation', () => {
    const state = createRemoteTerminalHistoryPrefetchState()
    resetRemoteTerminalHistoryPrefetchState(state, 10, true)

    cacheRemoteTerminalHistoryPage(state, {
      chunks: ['retained'],
      firstSeq: 4,
      lastSeq: 9,
      hasMoreBefore: false,
      gap: true,
      evictedBeforeSeq: 3
    })

    expect(takePrefetchedRemoteTerminalHistory(state)).toMatchObject({
      gap: true,
      evictedBeforeSeq: 3,
      hasMoreBefore: false
    })
  })
})
