// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { TERMINAL_TEXT_SCALES } from '../storage/preferences'
import { XTERM_HTML } from './terminal-webview-html'

function iifeSource(): string {
  const start = XTERM_HTML.indexOf('(function() {')
  const end = XTERM_HTML.lastIndexOf('})();')
  return XTERM_HTML.slice(start, end + '})();'.length)
}

function bodyMarkup(): string {
  const start = XTERM_HTML.indexOf('<body>') + '<body>'.length
  const end = XTERM_HTML.indexOf('<script>', start)
  return XTERM_HTML.slice(start, end)
}

type TerminalGeometry = {
  cols: number
  rows: number
  cellWidth: number
  cellHeight: number
}

function makeTerminal({ cols, rows, cellWidth, cellHeight }: TerminalGeometry) {
  return {
    cols,
    rows,
    options: { fontSize: 13 },
    modes: {},
    element: { scrollWidth: cols * cellWidth, scrollHeight: rows * cellHeight },
    _core: {
      _renderService: { dimensions: { css: { cell: { width: cellWidth, height: cellHeight } } } }
    },
    buffer: {
      active: {
        viewportY: 0,
        baseY: 0,
        length: 1,
        cursorY: 0,
        type: 'normal' as const,
        getLine() {
          return {
            translateToString: () => '',
            getCell: () => ({ extended: undefined })
          }
        }
      }
    },
    write(_data: string, callback?: () => void) {
      callback?.()
    },
    open() {},
    resize() {},
    clear() {},
    reset() {},
    refresh() {
      refreshCalls += 1
    },
    selectAll() {},
    clearSelection() {},
    select() {},
    scrollLines() {},
    scrollToBottom() {},
    getSelection: () => '',
    onLineFeed: () => ({ dispose() {} }),
    onScroll: () => ({ dispose() {} }),
    onWriteParsed: () => ({ dispose() {} }),
    dispose() {}
  }
}

type PostedMessage = Record<string, unknown>

let refreshCalls = 0

function boot(overrides: Partial<TerminalGeometry> = {}): PostedMessage[] {
  const geometry: TerminalGeometry = {
    cols: overrides.cols ?? 120,
    rows: overrides.rows ?? 24,
    cellWidth: overrides.cellWidth ?? 8,
    cellHeight: overrides.cellHeight ?? 15
  }
  const posted: PostedMessage[] = []
  const webWindow = window as unknown as { Terminal: unknown; ReactNativeWebView: unknown }
  webWindow.Terminal = function (options: { cols?: number; rows?: number }) {
    return makeTerminal({
      ...geometry,
      cols: options.cols ?? geometry.cols,
      rows: options.rows ?? geometry.rows
    })
  }
  webWindow.ReactNativeWebView = {
    postMessage(message: string) {
      posted.push(JSON.parse(message))
    }
  }
  document.body.innerHTML = bodyMarkup()
  // eslint-disable-next-line no-new-func
  new Function(iifeSource())()
  window.dispatchEvent(
    new MessageEvent('message', {
      data: JSON.stringify({
        type: 'init',
        cols: geometry.cols,
        rows: geometry.rows,
        initialData: '',
        fontScale: 1,
        textScaleMode: 'viewport-zoom'
      })
    })
  )
  return posted
}

function fireSurfaceTouch(type: string, touches: Array<{ x: number; y: number }>): void {
  const surface = document.getElementById('terminal-surface') as HTMLElement
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'touches', {
    value: touches.map((point, index) => ({
      identifier: index,
      clientX: point.x,
      clientY: point.y,
      target: surface
    }))
  })
  surface.dispatchEvent(event)
}

function sendWebViewMessage(message: Record<string, unknown>): void {
  window.dispatchEvent(
    new MessageEvent('message', {
      data: JSON.stringify(message)
    })
  )
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 50))

describe('terminal WebView pinch zoom', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: 360, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: 640, configurable: true })
    refreshCalls = 0
  })

  it('does not persist a smaller text scale when a two-finger move arrives before pinch start is initialized', async () => {
    const posted = boot()
    await settle()

    fireSurfaceTouch('touchmove', [
      { x: 100, y: 120 },
      { x: 220, y: 120 }
    ])
    fireSurfaceTouch('touchend', [])

    const fontScaleEvents = posted.filter((message) => message.type === 'font-scale-changed')
    expect(fontScaleEvents.at(-1)).toEqual({ type: 'font-scale-changed', fontScale: 1 })
    expect(fontScaleEvents).not.toContainEqual({ type: 'font-scale-changed', fontScale: 0.5 })
  })

  it('offers smaller text presets below the default size', () => {
    expect([...TERMINAL_TEXT_SCALES]).toEqual([0.5, 0.75, 1, 1.25, 1.5, 2])
  })

  it('persists a smaller preset after pinching below the default size', async () => {
    const posted = boot()
    await settle()

    fireSurfaceTouch('touchstart', [
      { x: 100, y: 120 },
      { x: 220, y: 120 }
    ])
    fireSurfaceTouch('touchmove', [
      { x: 130, y: 120 },
      { x: 190, y: 120 }
    ])
    fireSurfaceTouch('touchend', [])

    expect(posted.filter((message) => message.type === 'font-scale-changed').at(-1)).toEqual({
      type: 'font-scale-changed',
      fontScale: 0.5
    })
  })

  it('clears an interrupted pinch and redraws without changing the text scale', async () => {
    const posted = boot()
    await settle()
    const refreshCallsBeforeRestore = refreshCalls

    fireSurfaceTouch('touchstart', [
      { x: 100, y: 120 },
      { x: 220, y: 120 }
    ])
    fireSurfaceTouch('touchmove', [
      { x: 130, y: 120 },
      { x: 190, y: 120 }
    ])
    sendWebViewMessage({ type: 'restore-foreground' })
    fireSurfaceTouch('touchend', [])

    expect(refreshCalls).toBeGreaterThan(refreshCallsBeforeRestore)
    expect(posted.some((message) => message.type === 'font-scale-changed')).toBe(false)

    fireSurfaceTouch('touchstart', [{ x: 180, y: 280 }])
    fireSurfaceTouch('touchmove', [{ x: 180, y: 380 }])
    fireSurfaceTouch('touchend', [])

    expect(posted.filter((message) => message.type === 'font-scale-changed')).toHaveLength(0)
    expect(posted.filter((message) => message.type === 'history-top')).toHaveLength(1)
  })

  it.each([1.25, 1.5, 2])(
    'hands a downward pull at a clamped viewport edge to history at %sx',
    async (fontScale) => {
      const posted = boot()
      await settle()
      sendWebViewMessage({
        type: 'set-font-scale',
        fontScale,
        textScaleMode: 'viewport-zoom'
      })

      fireSurfaceTouch('touchstart', [{ x: 180, y: 280 }])
      fireSurfaceTouch('touchmove', [{ x: 181, y: 340 }])

      expect(posted.some((message) => message.type === 'history-top')).toBe(false)
      expect(posted).toContainEqual(
        expect.objectContaining({
          type: 'diagnostic',
          event: 'gesture-route',
          metrics: expect.objectContaining({ route: 'buffer-scroll-handoff' })
        })
      )

      fireSurfaceTouch('touchmove', [{ x: 181, y: 380 }])
      fireSurfaceTouch('touchend', [])

      expect(posted.filter((message) => message.type === 'history-top')).toHaveLength(1)
    }
  )

  it('does not load history for a small touch wobble at the loaded top', async () => {
    const posted = boot()
    await settle()

    fireSurfaceTouch('touchstart', [{ x: 180, y: 280 }])
    fireSurfaceTouch('touchmove', [{ x: 180, y: 300 }])
    fireSurfaceTouch('touchend', [])

    expect(posted.some((message) => message.type === 'history-top')).toBe(false)
  })

  it('keeps consuming a dominant horizontal gesture when the zoomed canvas moves', async () => {
    const posted = boot()
    await settle()
    sendWebViewMessage({
      type: 'set-font-scale',
      fontScale: 2,
      textScaleMode: 'viewport-zoom'
    })

    fireSurfaceTouch('touchstart', [{ x: 220, y: 300 }])
    fireSurfaceTouch('touchmove', [{ x: 140, y: 304 }])

    expect(posted.some((message) => message.type === 'history-top')).toBe(false)
    expect(posted).toContainEqual(
      expect.objectContaining({
        type: 'diagnostic',
        event: 'gesture-route',
        metrics: expect.objectContaining({ route: 'viewport-pan', panChanged: true })
      })
    )
  })

  it('keeps generic fit measurement independent of remote CSS scaling', async () => {
    const posted = boot()
    await settle()

    sendWebViewMessage({ type: 'measure', containerHeight: 640 })

    expect(posted.filter((message) => message.type === 'measure-result').at(-1)).toEqual({
      type: 'measure-result',
      cols: 45,
      rows: 42
    })
  })

  it('preserves the logged 228x70 desktop grid and uniformly covers a 369x600 viewport', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 369, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: 600, configurable: true })
    const posted = boot({
      cols: 228,
      rows: 70,
      cellWidth: 7.547169811320755,
      cellHeight: 15.09433962264151
    })
    await settle()

    const fit = posted.find(
      (message) => message.type === 'diagnostic' && message.event === 'fit-scale'
    )
    const fitIndex = posted.indexOf(fit ?? {})
    const readyIndex = posted.findIndex((message) => message.type === 'ready')
    const metrics = fit?.metrics as Record<string, number> | undefined
    expect(metrics).toBeDefined()
    expect(metrics?.cols).toBe(228)
    expect(metrics?.rows).toBe(70)
    expect(metrics?.fitScale).toBeCloseTo(600 / (70 * 15.09433962264151), 5)
    expect((metrics?.expectedWidth ?? 0) * (metrics?.fitScale ?? 0)).toBeGreaterThan(369)
    expect((metrics?.expectedHeight ?? 0) * (metrics?.fitScale ?? 0)).toBeCloseTo(600, 4)
    expect(fitIndex).toBeGreaterThanOrEqual(0)
    expect(readyIndex).toBeGreaterThan(fitIndex)
    expect(document.getElementById('terminal-surface')?.style.visibility).toBe('visible')
  })
})
