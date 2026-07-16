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

function makeTerminal() {
  return {
    cols: 120,
    rows: 24,
    options: { fontSize: 13 },
    modes: {},
    element: { scrollWidth: 960, scrollHeight: 360 },
    _core: { _renderService: { dimensions: { css: { cell: { width: 8, height: 15 } } } } },
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
    refresh() {},
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

function boot(): PostedMessage[] {
  const posted: PostedMessage[] = []
  const webWindow = window as unknown as { Terminal: unknown; ReactNativeWebView: unknown }
  webWindow.Terminal = function () {
    return makeTerminal()
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
        cols: 120,
        rows: 24,
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

  it('keeps persistent text presets at fit-to-width or larger', () => {
    expect([...TERMINAL_TEXT_SCALES]).toEqual([1, 1.25, 1.5, 2])
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

      expect(posted.some((message) => message.type === 'history-top')).toBe(true)
      expect(posted).toContainEqual(
        expect.objectContaining({
          type: 'diagnostic',
          event: 'gesture-route',
          metrics: expect.objectContaining({ route: 'buffer-scroll-handoff' })
        })
      )
    }
  )

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

  it('measures rows against the fixed-grid fit scale', async () => {
    const posted = boot()
    await settle()

    sendWebViewMessage({ type: 'measure', containerHeight: 640 })

    expect(posted.filter((message) => message.type === 'measure-result').at(-1)).toEqual({
      type: 'measure-result',
      cols: 45,
      rows: 113
    })
  })
})
