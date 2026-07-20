import { readFileSync } from 'node:fs'
import { Script } from 'node:vm'
import { parse } from 'acorn'
import { describe, expect, it } from 'vitest'
import { XTERM_ENGINE_CSS, XTERM_ENGINE_JS } from './terminal-webview-engine.generated'
import { XTERM_HTML } from './terminal-webview-html'

const terminalHtmlSource = readFileSync(
  new URL('./terminal-webview-html.ts', import.meta.url),
  'utf8'
)

describe('terminal WebView bundled engine', () => {
  it('keeps the assembled terminal HTML free of external engine URLs', () => {
    expect(XTERM_HTML).not.toMatch(/\bhttps?:\/\//)
    expect(XTERM_HTML).not.toContain('cdn.jsdelivr.net')
    expect(XTERM_HTML).not.toContain('<script src=')
    expect(XTERM_HTML).not.toContain('rel="stylesheet" href=')
  })

  it('parses the bundled engine at the Chrome 74 syntax floor', () => {
    expect(() => parse(XTERM_ENGINE_JS, { ecmaVersion: 2019 })).not.toThrow()
  })

  // Why: the context deliberately omits WeakRef (Chrome 84+) / structuredClone
  // (Chrome 98+) and supplies an Element without replaceChildren (Chrome 86+) —
  // the engine must evaluate on older WebViews via its own guarded runtime shims,
  // which are the linchpin of the old-WebView support (esbuild lowers syntax only).
  it('exposes the xterm globals and installs the old-WebView runtime shims', () => {
    const window: Record<string, unknown> = {}
    class ElementStub {}
    const context = {
      window,
      self: window,
      document: {},
      Element: ElementStub,
      navigator: {
        platform: 'Linux armv8l',
        userAgent: 'Mozilla/5.0 Chrome/74.0.3729.157'
      },
      console,
      setTimeout,
      clearTimeout,
      queueMicrotask,
      URL
    }

    new Script(XTERM_ENGINE_JS).runInNewContext(context)

    expect(window).toMatchObject({
      Terminal: expect.any(Function),
      SerializeAddon: { SerializeAddon: expect.any(Function) },
      Unicode11Addon: { Unicode11Addon: expect.any(Function) },
      WebglAddon: { WebglAddon: expect.any(Function) }
    })

    const weakRef = window.WeakRef as (new (target: unknown) => { deref(): unknown }) | undefined
    expect(typeof weakRef).toBe('function')
    const token = {}
    expect(new weakRef!(token).deref()).toBe(token)
    expect(typeof window.structuredClone).toBe('function')
    expect(typeof (ElementStub.prototype as { replaceChildren?: unknown }).replaceChildren).toBe(
      'function'
    )
  })

  it('keeps the bundled engine from breaking out of its inline script/style tags', () => {
    // Why: the engine JS/CSS are inlined into <script>/<style> blocks. </script
    // and </style are neutralized at build time; the tokenizer-escape openers that
    // could swallow the rest of the document must also be absent from the bundle.
    expect(XTERM_ENGINE_JS).not.toMatch(/<\/script/i)
    expect(XTERM_ENGINE_JS).not.toMatch(/<script/i)
    expect(XTERM_ENGINE_JS).not.toContain('<!--')
    expect(XTERM_ENGINE_CSS).not.toMatch(/<\/style/i)
  })

  it('reports WebView message handler failures instead of swallowing them', () => {
    const start = terminalHtmlSource.indexOf('function handleIncomingMessage')
    const end = terminalHtmlSource.indexOf("window.addEventListener('resize'", start)
    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)
    const handlerSource = terminalHtmlSource.slice(start, end)

    expect(handlerSource).toContain('reportEngineError(')
    expect(handlerSource).toContain("'terminal init failed'")
    expect(handlerSource).toContain("'terminal message failed'")
    expect(handlerSource).not.toContain('catch(ex) {}')
  })

  it('classifies runtime errors by a document-scoped ever-ready latch', () => {
    // Why: init() flips `ready` false on every re-init (live width reflow keeps the
    // old surface visible meanwhile), so the fatal default and the init-catch must
    // key off `everReady` — otherwise a transient reflow error blanks a live
    // terminal behind the fatal overlay. The latch stays set for the document.
    expect(terminalHtmlSource).toContain('var everReady = false;')
    expect(terminalHtmlSource).toContain('everReady = true;')
    expect(terminalHtmlSource).toContain('fatal === undefined ? !everReady : !!fatal')
    expect(terminalHtmlSource).toContain("msg.type === 'init' && !everReady")
    expect(terminalHtmlSource).not.toMatch(/fatal === undefined \? !ready\b/)
  })

  it('bounds error capture and non-fatal reporting on a degraded engine', () => {
    // Why: a constructed-but-broken engine can throw per render frame; both
    // onerror capture sites must cap the buffer and non-fatal notifies must
    // stop flooding RN while fatal reports always emit.
    const capSites = terminalHtmlSource.match(/__engineErrors\.length < 20/g) ?? []
    expect(capSites.length).toBe(2)
    expect(terminalHtmlSource).toContain('nonFatalErrorNotifies > 5')
  })

  it('refreshes keyboard avoidance metrics after local clear and resize operations', () => {
    const resizeStart = terminalHtmlSource.indexOf('function resize(cols, rows)')
    const resizeEnd = terminalHtmlSource.indexOf('function notify(msg)', resizeStart)
    const resizeSource = terminalHtmlSource.slice(resizeStart, resizeEnd)
    expect(resizeSource).toContain('term.resize(cols || term.cols, rows || term.rows);')
    expect(resizeSource).toContain('emitKeyboardAvoidanceMetrics();')

    const clearStart = terminalHtmlSource.indexOf("msg.type === 'clear'")
    const clearEnd = terminalHtmlSource.indexOf("msg.type === 'measure'", clearStart)
    const clearSource = terminalHtmlSource.slice(clearStart, clearEnd)
    expect(clearSource).toContain('clearMobileReflowTerminals();')
    expect(clearSource).toContain('term.clear();')
    expect(clearSource).toContain('term.reset();')
    expect(clearSource).toContain('emitKeyboardAvoidanceMetrics();')
  })

  it('keeps the terminal cursor visible while React Native owns keyboard focus', () => {
    const terminalStart = terminalHtmlSource.indexOf('term = new Terminal({')
    const terminalEnd = terminalHtmlSource.indexOf('});', terminalStart)
    expect(terminalStart).toBeGreaterThanOrEqual(0)
    expect(terminalEnd).toBeGreaterThan(terminalStart)
    const terminalOptions = terminalHtmlSource.slice(terminalStart, terminalEnd)

    expect(terminalOptions).toContain('cursorBlink: true')
    expect(terminalOptions).toContain("cursorStyle: 'bar'")
    expect(terminalOptions).toContain("cursorInactiveStyle: 'bar'")
    expect(terminalOptions).toContain('cursorWidth: 3')
    expect(terminalOptions).not.toContain("cursorInactiveStyle: 'none'")
    expect(terminalHtmlSource).toContain('function ensureTerminalCursorVisible(targetTerm)')
    expect(terminalHtmlSource).toContain("targetTerm.write('\\x1b[?25h')")
    expect(terminalHtmlSource).toContain('ensureTerminalCursorVisible(term);')
    expect(terminalHtmlSource).toContain('function updateCursorOverlay()')
    expect(terminalHtmlSource).toContain('function resolveCursorOverlayPosition(')
    expect(terminalHtmlSource).toContain("cursorOverlay.className = 'mobile-cursor-overlay'")
    expect(terminalHtmlSource).toContain("cursorOverlay.style.width = (3 / totalScale) + 'px'")
    expect(terminalHtmlSource).toContain('term.onCursorMove(scheduleCursorOverlayUpdate)')
    expect(terminalHtmlSource).toContain('cursorOverlayAttached: Boolean(cursorOverlay')
    expect(terminalHtmlSource).toContain('cursorOverlayVisible: Boolean(cursorOverlay')
  })

  it('reports scaled cursor coordinates and can return live input to the latest line', () => {
    const metricsStart = terminalHtmlSource.indexOf('function emitKeyboardAvoidanceMetrics()')
    const metricsEnd = terminalHtmlSource.indexOf('function attachTermObservers()', metricsStart)
    const metricsSource = terminalHtmlSource.slice(metricsStart, metricsEnd)
    expect(metricsSource).toContain('getCellHeight() * getTotalScale()')
    expect(metricsSource).toContain('cursorBottomPx: cursorBottomPx')
    expect(metricsSource).toContain('rowHeightPx: rowHeightPx')
    expect(metricsSource).toContain('(buffer.baseY || 0) - (buffer.viewportY || 0)')

    expect(terminalHtmlSource).toContain('function revealLiveInput()')
    expect(terminalHtmlSource).toContain("msg.type === 'reveal-live-input'")
    expect(terminalHtmlSource).toContain('term.scrollToBottom();')
    expect(terminalHtmlSource).toContain('panY = window.innerHeight - cursorBottomPx;')
  })

  it('restores the full viewport after keyboard avoidance without changing the terminal grid', () => {
    const restoreStart = terminalHtmlSource.indexOf('function restoreKeyboardViewport()')
    const restoreEnd = terminalHtmlSource.indexOf('function attachTermObservers()', restoreStart)
    const restoreSource = terminalHtmlSource.slice(restoreStart, restoreEnd)

    expect(terminalHtmlSource).toContain("msg.type === 'restore-keyboard-viewport'")
    expect(restoreSource).toContain('resetSmoothScrollOffset();')
    expect(restoreSource).toContain('clampPan();')
    expect(restoreSource).toContain('updateTransform();')
    expect(restoreSource).toContain('emitKeyboardAvoidanceMetrics();')
    expect(restoreSource).not.toContain('term.resize(')
    expect(restoreSource).not.toContain('applyFitScale(')
  })
})
