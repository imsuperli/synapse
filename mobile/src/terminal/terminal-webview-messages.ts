import type { TerminalOscLinkRange } from './terminal-osc-link-ranges'
import type { MobileTerminalTheme } from './mobile-terminal-theme'

export type TerminalTextScaleMode = 'font-size' | 'viewport-zoom' | 'mobile-reflow'

export type TerminalWebViewCommand =
  | { type: 'write'; id?: number; data: string }
  | {
      type: 'init'
      id?: number
      cols: number
      rows: number
      initialData?: string
      oscLinks?: TerminalOscLinkRange[]
      terminalTheme?: MobileTerminalTheme
      fontScale?: number
      textScaleMode?: TerminalTextScaleMode
      // Why: width-reflow re-streams replay the same content rewrapped at new
      // cols; preserve the reader's scroll position instead of jumping to bottom.
      preserveScroll?: boolean
      // Remote terminal history is a raw PTY stream. Do not trim bytes before the
      // last alternate-screen enter sequence, or dynamic CLIs can lose context.
      preserveFullInitialData?: boolean
    }
  | {
      type: 'set-font-scale'
      id?: number
      fontScale: number
      textScaleMode?: TerminalTextScaleMode
    }
  | { type: 'resize'; id?: number; cols: number; rows: number }
  | { type: 'reflow'; id?: number; cols: number; rows: number }
  | { type: 'clear'; id?: number }
  | { type: 'measure'; id?: number; containerHeight?: number }
  | { type: 'reset-zoom'; id?: number }
  | { type: 'restore-foreground'; id?: number }
  | { type: 'reveal-live-input'; id?: number }
  | { type: 'restore-keyboard-viewport'; id?: number }
  | { type: 'set-live-input-text'; id?: number; text: string }
  | { type: 'cancel-select'; id?: number }
  | { type: 'do-select-all'; id?: number }
  | { type: 'set-theme'; id?: number; terminalTheme?: MobileTerminalTheme }
