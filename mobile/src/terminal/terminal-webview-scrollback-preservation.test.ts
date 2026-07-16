import { Terminal } from '@xterm/xterm'
import { describe, expect, it } from 'vitest'
import { XTERM_HTML } from './terminal-webview-html'
import { TERMINAL_SCROLLBACK_PRESERVATION_JS } from './terminal-webview-scrollback-preservation-injected'

type ScrollbackInstaller = (terminal: Terminal) => { dispose(): void }

function createInstaller(): ScrollbackInstaller {
  return new Function(
    `${TERMINAL_SCROLLBACK_PRESERVATION_JS}; return installMobileTerminalScrollbackPreservation;`
  )() as ScrollbackInstaller
}

function writeTerminal(terminal: Terminal, data: string): Promise<void> {
  return new Promise((resolve) => terminal.write(data, resolve))
}

function readNormalBufferLines(terminal: Terminal): string[] {
  return Array.from(
    { length: terminal.buffer.normal.length },
    (_, index) => terminal.buffer.normal.getLine(index)?.translateToString(true) ?? ''
  )
}

describe('mobile terminal scrollback preservation', () => {
  it('installs the preservation handler in every WebView terminal instance', () => {
    expect(XTERM_HTML).toContain('installMobileTerminalScrollbackPreservation(term);')
  })

  it('keeps rows removed by Codex top-anchored region scrolling', async () => {
    const terminal = new Terminal({ cols: 20, rows: 10, scrollback: 100 })
    const disposable = createInstaller()(terminal)

    try {
      await writeTerminal(
        terminal,
        Array.from(
          { length: 20 },
          (_, index) => `LINE-${String(index + 1).padStart(2, '0')}\r\n`
        ).join('')
      )

      await writeTerminal(terminal, '\x1b[1;7r\x1b[3S\x1b[r')

      expect(readNormalBufferLines(terminal)).toEqual(
        expect.arrayContaining(['LINE-12', 'LINE-13', 'LINE-14'])
      )
      expect(terminal.buffer.normal.baseY).toBeGreaterThan(11)
    } finally {
      disposable.dispose()
      terminal.dispose()
    }
  })

  it('does not turn alternate-screen region scrolling into normal history', async () => {
    const terminal = new Terminal({ cols: 20, rows: 10, scrollback: 100 })
    const disposable = createInstaller()(terminal)

    try {
      await writeTerminal(terminal, 'NORMAL\r\n\x1b[?1049h')
      const normalLengthBefore = terminal.buffer.normal.length

      await writeTerminal(terminal, 'ALT-1\r\nALT-2\r\n\x1b[1;7r\x1b[2S\x1b[r')

      expect(terminal.buffer.normal.length).toBe(normalLengthBefore)
      expect(terminal.buffer.active.type).toBe('alternate')
    } finally {
      disposable.dispose()
      terminal.dispose()
    }
  })
})
