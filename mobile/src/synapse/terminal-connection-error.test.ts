import { describe, expect, it } from 'vitest'

import { terminalErrorAfterConnectionState } from './terminal-connection-error'

describe('terminalErrorAfterConnectionState', () => {
  it('clears a stale interrupted banner after the transport reconnects', () => {
    expect(terminalErrorAfterConnectionState('Connection interrupted', 'connected')).toBeNull()
  })

  it('keeps the interrupted banner until reconnection succeeds', () => {
    expect(terminalErrorAfterConnectionState('Connection interrupted', 'connecting')).toBe(
      'Connection interrupted'
    )
  })

  it('does not hide terminal or authentication failures after reconnecting', () => {
    expect(terminalErrorAfterConnectionState('Terminal stopped on desktop', 'connected')).toBe(
      'Terminal stopped on desktop'
    )
    expect(terminalErrorAfterConnectionState('SSH authentication failed', 'connected')).toBe(
      'SSH authentication failed'
    )
  })
})
