import { describe, expect, it } from 'vitest'
import {
  appendTerminalDiagnostic,
  createTerminalDiagnosticBuffer,
  formatTerminalDiagnostics,
  restoreTerminalDiagnosticBuffer,
  serializeTerminalDiagnosticBuffer
} from './terminal-diagnostics'

describe('terminal diagnostics', () => {
  it('keeps a bounded chronological ring', () => {
    const buffer = createTerminalDiagnosticBuffer(2)
    appendTerminalDiagnostic(buffer, { source: 'mobile', event: 'one', ts: 1 })
    appendTerminalDiagnostic(buffer, { source: 'mobile', event: 'two', ts: 2 })
    appendTerminalDiagnostic(buffer, { source: 'mobile', event: 'three', ts: 3 })

    expect(buffer.entries.map((entry) => entry.event)).toEqual(['two', 'three'])
  })

  it('redacts URLs, credentials, and terminal content from copied output', () => {
    const buffer = createTerminalDiagnosticBuffer()
    appendTerminalDiagnostic(buffer, {
      source: 'network',
      event: 'connection',
      ts: 1,
      metrics: {
        detail: 'Relay wss://relay.example.test/path?token=secret-value',
        deviceToken: 'device-secret',
        serialized: 'terminal output must not be exported',
        returnedChars: 42
      }
    })

    const output = formatTerminalDiagnostics(buffer, {
      endpoint: 'https://desktop.example.test/api?code=pairing-secret'
    })

    expect(output).toContain('wss://relay.example.test/[redacted]')
    expect(output).toContain('https://desktop.example.test/[redacted]')
    expect(output).toContain('"returnedChars":42')
    expect(output).not.toContain('secret-value')
    expect(output).not.toContain('device-secret')
    expect(output).not.toContain('terminal output must not be exported')
  })

  it('restores only valid sanitized entries from persisted storage', () => {
    const buffer = createTerminalDiagnosticBuffer()
    appendTerminalDiagnostic(buffer, {
      source: 'webview',
      event: 'gesture-route',
      ts: 10,
      metrics: { route: 'buffer-scroll-handoff', serialized: 'hidden' }
    })

    const restored = restoreTerminalDiagnosticBuffer(serializeTerminalDiagnosticBuffer(buffer))

    expect(restored.entries).toEqual(buffer.entries)
    expect(restored.entries[0]?.metrics.serialized).toBe('[redacted]')
  })
})
