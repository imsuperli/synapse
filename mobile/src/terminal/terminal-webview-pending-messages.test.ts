import { describe, expect, it, vi } from 'vitest'
import { createTerminalWebViewPendingMessages } from './terminal-webview-pending-messages'

describe('terminal WebView pending messages', () => {
  it('keeps only the latest live input projection hint', () => {
    const pending = createTerminalWebViewPendingMessages()
    const send = vi.fn()

    pending.queue({ type: 'set-live-input-text', text: 'first' })
    pending.queue({ type: 'write', data: 'terminal output' })
    pending.queue({ type: 'set-live-input-text', text: 'latest' })
    pending.flush(send)

    expect(send.mock.calls.map(([message]) => message)).toEqual([
      { type: 'write', data: 'terminal output' },
      { type: 'set-live-input-text', text: 'latest' }
    ])
  })
})
