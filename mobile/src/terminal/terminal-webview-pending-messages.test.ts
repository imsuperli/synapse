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

  it('treats init as a replay boundary and keeps only writes after it', () => {
    const pending = createTerminalWebViewPendingMessages()
    const send = vi.fn()

    pending.queue({ type: 'write', data: 'covered' })
    pending.queue({ type: 'init', cols: 80, rows: 30, initialData: 'covered' })
    pending.queue({ type: 'write', data: 'after' })
    pending.flush(send)

    expect(send.mock.calls.map(([message]) => message)).toEqual([
      { type: 'init', cols: 80, rows: 30, initialData: 'covered' },
      { type: 'write', data: 'after' }
    ])
  })

  it('reports overflow once and drops writes until a compact init arrives', () => {
    const pending = createTerminalWebViewPendingMessages({
      maxWriteBytes: 5,
      maxWriteMessages: 2
    })
    const send = vi.fn()

    expect(pending.queue({ type: 'write', data: '123' }).writeOverflowed).toBe(false)
    expect(pending.queue({ type: 'write', data: '456' }).writeOverflowed).toBe(true)
    expect(pending.queue({ type: 'write', data: 'ignored' }).writeOverflowed).toBe(false)
    pending.queue({ type: 'set-live-input-text', text: 'kept' })
    pending.queue({ type: 'init', cols: 80, rows: 30, initialData: '123456ignored' })
    pending.queue({ type: 'write', data: 'live' })
    pending.flush(send)

    expect(send.mock.calls.map(([message]) => message)).toEqual([
      { type: 'set-live-input-text', text: 'kept' },
      { type: 'init', cols: 80, rows: 30, initialData: '123456ignored' },
      { type: 'write', data: 'live' }
    ])
  })
})
