import type { RemoteTerminalHistoryPage } from './remote-terminal-history-state'

export type RemoteTerminalHistoryPrefetchState = {
  pages: RemoteTerminalHistoryPage[]
  nextBeforeSeq: number
  hasMoreBefore: boolean
  cachedBytes: number
  gap: boolean
  evictedBeforeSeq: number
}

export function createRemoteTerminalHistoryPrefetchState(): RemoteTerminalHistoryPrefetchState {
  return {
    pages: [],
    nextBeforeSeq: 0,
    hasMoreBefore: false,
    cachedBytes: 0,
    gap: false,
    evictedBeforeSeq: 0
  }
}

export function resetRemoteTerminalHistoryPrefetchState(
  state: RemoteTerminalHistoryPrefetchState,
  firstSeq = 0,
  hasMoreBefore = false,
  gap = false,
  evictedBeforeSeq = 0
): void {
  state.pages = []
  state.nextBeforeSeq = Math.max(0, Math.floor(firstSeq))
  state.hasMoreBefore = hasMoreBefore && state.nextBeforeSeq > 1
  state.cachedBytes = 0
  state.gap = gap
  state.evictedBeforeSeq = Math.max(0, Math.floor(evictedBeforeSeq))
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
  state.gap ||= page.gap === true
  state.evictedBeforeSeq = Math.max(
    state.evictedBeforeSeq,
    Math.max(0, Math.floor(page.evictedBeforeSeq ?? 0))
  )
  if (page.chunks.length === 0) {
    state.hasMoreBefore = false
    return false
  }
  if (page.firstSeq <= 0 || page.lastSeq < page.firstSeq || page.lastSeq >= state.nextBeforeSeq) {
    return false
  }
  state.pages.push(page)
  state.nextBeforeSeq = page.firstSeq
  state.hasMoreBefore = page.hasMoreBefore && page.firstSeq > 1
  state.cachedBytes += page.chunks.reduce((total, chunk) => total + chunk.length, 0)
  return true
}

export function takePrefetchedRemoteTerminalHistory(
  state: RemoteTerminalHistoryPrefetchState,
  limits: { maxPages?: number; maxBytes?: number } = {}
): {
  pages: RemoteTerminalHistoryPage[]
  hasMoreBefore: boolean
  gap: boolean
  evictedBeforeSeq: number
} {
  const maxPages = normalizeTakeLimit(limits.maxPages)
  const maxBytes = normalizeTakeLimit(limits.maxBytes)
  const pages: RemoteTerminalHistoryPage[] = []
  let takenBytes = 0
  for (const page of state.pages) {
    if (pages.length >= maxPages) {
      break
    }
    const pageBytes = page.chunks.reduce((total, chunk) => total + chunk.length, 0)
    if (pages.length > 0 && takenBytes + pageBytes > maxBytes) {
      break
    }
    pages.push(page)
    takenBytes += pageBytes
  }
  state.pages = state.pages.slice(pages.length)
  state.cachedBytes = Math.max(0, state.cachedBytes - takenBytes)
  const lastPage = pages.at(-1)
  return {
    pages,
    hasMoreBefore: lastPage ? lastPage.hasMoreBefore === true : state.hasMoreBefore,
    gap: state.gap,
    evictedBeforeSeq: state.evictedBeforeSeq
  }
}

function normalizeTakeLimit(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return Number.POSITIVE_INFINITY
  }
  return Math.max(1, Math.floor(value))
}
