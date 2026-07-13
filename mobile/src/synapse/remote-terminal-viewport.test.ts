import { describe, expect, it } from 'vitest'
import {
  normalizeDesktopTerminalViewport,
  resolveMobileTerminalViewport,
  sameRemoteTerminalViewport
} from './remote-terminal-viewport'

describe('remote terminal mobile viewport', () => {
  it('fills the phone height without changing the desktop column count', () => {
    const desktop = normalizeDesktopTerminalViewport(
      { cols: 120, rows: 4 },
      { cols: 80, rows: 30 }
    )

    expect(resolveMobileTerminalViewport(desktop, 31)).toEqual({ cols: 120, rows: 31 })
  })

  it('never crops a desktop terminal that is taller than the phone fit', () => {
    expect(resolveMobileTerminalViewport({ cols: 90, rows: 42 }, 30)).toEqual({
      cols: 90,
      rows: 42
    })
  })

  it('normalizes invalid desktop dimensions and compares resolved viewports', () => {
    const viewport = normalizeDesktopTerminalViewport(
      { cols: 0, rows: Number.NaN },
      { cols: 80, rows: 30 }
    )
    expect(viewport).toEqual({ cols: 80, rows: 30 })
    expect(sameRemoteTerminalViewport(viewport, { cols: 80, rows: 30 })).toBe(true)
  })
})
