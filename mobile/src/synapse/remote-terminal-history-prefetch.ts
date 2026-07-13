import type { RemoteTerminalHistoryPage } from './remote-terminal-history-state'

export type RemoteTerminalHistoryPrefetchState = {
  pages: RemoteTerminalHistoryPage[]
  nextBeforeSeq: number
  hasMoreBefore: boolean
  cachedBytes: number
}

export function createRemoteTerminalHistoryPrefetchState(): RemoteTerminalHistoryPrefetchState {
  return {
    pages: [],
    nextBeforeSeq: 0,
    hasMoreBefore: false,
    cachedBytes: 0
  }
}

export function resetRemoteTerminalHistoryPrefetchState(
  state: RemoteTerminalHistoryPrefetchState,
  firstSeq = 0,
  hasMoreBefore = false
): void {
  state.pages = []
  state.nextBeforeSeq = Math.max(0, Math.floor(firstSeq))
  state.hasMoreBefore = hasMoreBefore && state.nextBeforeSeq > 1
  state.cachedBytes = 0
}

export function canPrefetchRemoteTerminalHistory(
  state: RemoteTerminalHistoryPrefetchState,
  maxCachedBytes: number
): boolean {
  return state.hasMoreBefore && state.nextBeforeSeq > 1 && state.cachedBytes < maxCachedBytes
}

export function cacheRemoteTerminalHistoryPage(
  state: RemoteTerminalHistoryPrefetchState,
  page: RemoteTerminalHistoryPage
): boolean {
  if (page.chunks.length === 0) {
    state.hasMoreBefore = false
    return false
  }
  if (
    page.firstSeq <= 0 ||
    page.lastSeq < page.firstSeq ||
    page.lastSeq >= state.nextBeforeSeq
  ) {
    return false
  }
  state.pages.push(page)
  state.nextBeforeSeq = page.firstSeq
  state.hasMoreBefore = page.hasMoreBefore && page.firstSeq > 1
  state.cachedBytes += page.chunks.reduce((total, chunk) => total + chunk.length, 0)
  return true
}

export function takePrefetchedRemoteTerminalHistory(
  state: RemoteTerminalHistoryPrefetchState
): { pages: RemoteTerminalHistoryPage[]; hasMoreBefore: boolean } {
  const pages = state.pages
  state.pages = []
  state.cachedBytes = 0
  return { pages, hasMoreBefore: state.hasMoreBefore }
}
