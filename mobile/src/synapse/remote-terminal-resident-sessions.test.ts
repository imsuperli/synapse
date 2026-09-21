import { describe, expect, it } from 'vitest'
import { selectRemoteTerminalResidentSessions } from './remote-terminal-resident-sessions'

describe('remote terminal resident sessions', () => {
  it('keeps repeated A/B switches resident without eviction', () => {
    const first = selectRemoteTerminalResidentSessions({
      residentHandles: ['A'],
      targetHandle: 'B',
      activeHandle: 'A',
      lastUsedAt: new Map([['A', 1], ['B', 2]])
    })
    const second = selectRemoteTerminalResidentSessions({
      residentHandles: first.handles,
      targetHandle: 'A',
      activeHandle: 'B',
      lastUsedAt: new Map([['A', 3], ['B', 2]])
    })

    expect(first).toEqual({ handles: ['A', 'B'], evictedHandle: null })
    expect(second).toEqual({ handles: ['A', 'B'], evictedHandle: null })
  })

  it('evicts only the least recently used inactive session at the limit', () => {
    expect(selectRemoteTerminalResidentSessions({
      residentHandles: ['A', 'B', 'C'],
      targetHandle: 'D',
      activeHandle: 'C',
      lastUsedAt: new Map([['A', 1], ['B', 2], ['C', 3], ['D', 4]])
    })).toEqual({
      handles: ['B', 'C', 'D'],
      evictedHandle: 'A'
    })
  })
})
