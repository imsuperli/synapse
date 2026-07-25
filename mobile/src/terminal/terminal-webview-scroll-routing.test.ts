import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// The in-WebView JS lives in terminal-webview-html.ts; the RN wrapper in
// TerminalWebView.tsx. Concatenate both so assertions resolve regardless of file.
const source =
  readFileSync(new URL('./TerminalWebView.tsx', import.meta.url), 'utf8') +
  readFileSync(new URL('./terminal-webview-pending-messages.ts', import.meta.url), 'utf8') +
  readFileSync(new URL('./terminal-webview-url-tap.ts', import.meta.url), 'utf8') +
  readFileSync(new URL('./terminal-webview-tap-dispatch-injected.ts', import.meta.url), 'utf8') +
  readFileSync(new URL('./terminal-webview-mobile-reflow-injected.ts', import.meta.url), 'utf8') +
  readFileSync(new URL('./terminal-webview-html.ts', import.meta.url), 'utf8')

function sliceBetween(startPattern: string, endPattern: string): string {
  const start = source.indexOf(startPattern)
  expect(start).toBeGreaterThanOrEqual(0)
  const end = source.indexOf(endPattern, start)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

describe('TerminalWebView scroll routing', () => {
  it('keeps Android touch drags inside the terminal WebView', () => {
    expect(source).toContain('nestedScrollEnabled')
  })

  it('maps a downward pull at the bottom to older scrollback rows', () => {
    expect(source).toContain('var deltaY = ts.lastY - y;')
    expect(source).toContain('smoothScrollOffsetY -= deltaY;')
    expect(source).toContain('var lines = Math.trunc(-smoothScrollOffsetY / effectiveCellH);')

    const nextViewportY = simulateNormalBufferPull({
      baseY: 120,
      viewportY: 120,
      startY: 300,
      endY: 340,
      cellHeight: 20
    })

    expect(nextViewportY).toBe(118)
  })

  it('routes alternate-screen and mouse-aware scroll before smooth normal scroll while live', () => {
    expect(source).toContain(
      'return !autoScrollDisabled && (\n      isWheelMouseTrackingMode(getMouseTrackingMode()) || isAlternateBufferActive()'
    )

    const touchMoveBlock = sliceBetween(
      "targetSurface.addEventListener('touchmove'",
      '}, { capture: true, passive: false });'
    )
    expect(touchMoveBlock.indexOf('if (shouldRouteScrollToTerminalInput())')).toBeLessThan(
      touchMoveBlock.indexOf('if (enqueueNormalBufferScrollDelta(deltaY))')
    )
    expect(touchMoveBlock).toContain('routeScrollLines(lines, x, y);')

    const momentumBlock = sliceBetween('function momentumStep()', 'if (Math.abs(vel) > MIN_VEL)')
    expect(momentumBlock.indexOf('if (shouldRouteScrollToTerminalInput())')).toBeLessThan(
      momentumBlock.indexOf('if (!applyNormalBufferScrollDelta(delta, false))')
    )
    expect(momentumBlock).toContain('routeScrollLines(lines, ts.lastX, ts.lastY);')
  })

  it('gives explicit history-reading mode ownership before alternate-screen TUI routing', () => {
    const routingDecision = sliceBetween(
      'function shouldRouteScrollToTerminalInput()',
      'function buildMouseWheelScrollInput'
    )
    expect(routingDecision).toContain('!autoScrollDisabled')

    const routeBlock = sliceBetween(
      'function routeScrollLines(lines, clientX, clientY)',
      'function clampNormalScrollLines(lines)'
    )
    const alternateIndex = routeBlock.indexOf('if (alternateBufferActive)')
    const historyIndex = routeBlock.indexOf('if (lines < 0) notifyHistoryTopReached();')
    const inputIndex = routeBlock.indexOf('var input = buildTuiScrollInput(lines, clientX, clientY);')

    expect(alternateIndex).toBeGreaterThanOrEqual(0)
    expect(historyIndex).toBe(-1)
    expect(inputIndex).toBeGreaterThan(alternateIndex)
  })

  it('does not rubber-band normal scroll at scrollback edges', () => {
    expect(source).toContain('function canScrollNormalBufferDelta(deltaY)')
    const smoothScrollBlock = sliceBetween(
      'function applyNormalBufferScrollDelta(deltaY, allowHistoryRequest)',
      'function enqueueNormalBufferScrollDelta(deltaY)'
    )
    expect(smoothScrollBlock).toContain('if (!canScrollNormalBufferDelta(deltaY))')
    expect(smoothScrollBlock).toContain('resetSmoothScrollOffset();')
    expect(smoothScrollBlock).toContain('return false;')
    expect(smoothScrollBlock).toContain('return true;')

    const touchMoveBlock = sliceBetween(
      "targetSurface.addEventListener('touchmove'",
      '}, { capture: true, passive: false });'
    )
    expect(touchMoveBlock).toContain('if (enqueueNormalBufferScrollDelta(deltaY))')
    expect(touchMoveBlock).toContain('ts.velY = 0;')

    const momentumBlock = sliceBetween('function momentumStep()', 'if (Math.abs(vel) > MIN_VEL)')
    expect(momentumBlock).toContain('if (!applyNormalBufferScrollDelta(delta, false))')
    expect(momentumBlock).toContain('ts.momentumId = null;')
  })

  it('does not commit a pending history request when Android cancels the gesture', () => {
    const cancelBlock = sliceBetween(
      "targetSurface.addEventListener('touchcancel'",
      '}, { capture: true, passive: true });'
    )
    expect(cancelBlock).toContain('historyTopPending = false;')
    expect(cancelBlock).not.toContain('flushPendingHistoryTopReached();')
  })

  it('coalesces normal touch scroll row commits onto animation frames', () => {
    const enqueueBlock = sliceBetween(
      'function enqueueNormalBufferScrollDelta(deltaY)',
      'function resetSmoothScrollOffset()'
    )
    expect(enqueueBlock).toContain('pendingNormalScrollDeltaY += deltaY;')
    expect(enqueueBlock).toContain('if (normalScrollFrameId !== null) return true;')
    expect(enqueueBlock).toContain('normalScrollFrameId = requestAnimationFrame(function()')
    expect(enqueueBlock).toContain('applyNormalBufferScrollDelta(delta)')

    const resetBlock = sliceBetween(
      'function resetSmoothScrollOffset()',
      'function cellToViewportPx'
    )
    expect(resetBlock).toContain('pendingNormalScrollDeltaY = 0;')
    expect(resetBlock).toContain('cancelAnimationFrame(normalScrollFrameId);')
  })

  it('drains terminal writes without shifting the queued array', () => {
    expect(source).toContain('var writeQueueHead = 0;')
    expect(source).toContain('function nextQueuedWrite()')
    expect(source).toContain('writeQueueHead++;')
    expect(source).toContain('writeQueue = writeQueue.slice(writeQueueHead);')
    expect(source).not.toContain('writeQueue.shift()')
  })

  it('bounds native-side pending WebView writes while preserving control messages', () => {
    expect(source).toContain('const MAX_PENDING_WEB_WRITE_BYTES = 1_000_000')
    expect(source).toContain('const MAX_PENDING_WEB_WRITE_MESSAGES = 4096')
    expect(source).toContain('let pendingWriteBytes = 0')
    expect(source).toContain('let pendingWriteCount = 0')
    expect(source).toContain('const queue = (msg: TerminalWebViewCommand)')
    expect(source).toContain('pendingWriteCount > maxWriteMessages')
    expect(source).toContain("candidate.type !== 'write' && candidate.type !== 'init'")
    expect(source).toContain('pendingMessages.queue(msg)')
    expect(source).toContain('onPendingWriteOverflow?.()')
    expect(source).not.toContain('pendingMessages.clear()')
    const webReadyBlock = sliceBetween(
      "if (msg.type === 'web-ready')",
      "} else if (msg.type === 'ready')"
    )
    expect(webReadyBlock.indexOf('flushPendingMessages()')).toBeLessThan(
      webReadyBlock.indexOf('onWebReady?.()')
    )
  })

  it('clears WebView await timers when the real response wins', () => {
    const measureBlock = sliceBetween('measureFitDimensions(', 'resetZoom()')
    expect(measureBlock).toContain('clearTimeout(timeout)')
    expect(measureBlock).toContain('measureResolveRef.current === finish')

    const readyBlock = sliceBetween('async awaitReady()', '})')
    expect(readyBlock).toContain('clearTimeout(timeout)')
    expect(readyBlock).toContain('void p.finally')
  })

  it('hides xterm scrollbars and drives the mobile scroll indicator from committed rows', () => {
    expect(source).toContain('<div id="scroll-indicator"><div id="scroll-thumb"></div></div>')
    expect(source).toContain('.xterm .xterm-viewport::-webkit-scrollbar')
    expect(source).toContain('.xterm .xterm-scrollable-element > .xterm-scrollbar')
    expect(source).toContain('overflow-y: hidden !important;')
    expect(source).toContain('display: none !important;')
    expect(source).toContain('function updateScrollIndicator(reveal)')
    expect(source).toContain('buffer.viewportY / maxViewportY')
    expect(source).not.toContain('fractionalRows')
    expect(source).toContain('scrollThumb.style.transform =')
    expect(source).toContain('updateScrollIndicator(true);')
  })

  it('notifies React Native when normal scrollback reaches the loaded top', () => {
    expect(source).toContain("notify({ type: 'history-top' });")
    expect(source).toContain('if (now - lastHistoryTopNotifyAt < 900) return;')
    expect(source).toContain('function requestHistoryTopForDelta(deltaY)')
    expect(source).toContain('if (historyTopPullDistance < 24) return;')
    expect(source).toContain('if (surfaceTouchActive)')
    expect(source).toContain('historyTopPending = true;')
    const touchEndBlock = sliceBetween(
      "targetSurface.addEventListener('touchend'",
      '}, { capture: true, passive: true });'
    )
    expect(touchEndBlock).toContain('surfaceTouchActive = false;')
    expect(touchEndBlock).toContain('flushPendingHistoryTopReached();')
    expect(touchEndBlock).toContain('applyNormalBufferScrollDelta(delta, false)')
  })

  it('only consumes viewport zoom gestures when the canvas actually moves', () => {
    const touchMoveBlock = sliceBetween(
      "targetSurface.addEventListener('touchmove'",
      '}, { capture: true, passive: false });'
    )
    expect(touchMoveBlock).toContain('var horizontalDominant = Math.abs(dx) > Math.abs(dy);')
    expect(touchMoveBlock).toContain('if (panChanged)')
    expect(touchMoveBlock).toContain("viewportZoomPanHandoff ? 'buffer-scroll-handoff'")
    expect(touchMoveBlock.indexOf('if (panChanged)')).toBeLessThan(
      touchMoveBlock.indexOf('if (shouldRouteScrollToTerminalInput())')
    )
  })

  it('never derives remote replay rows from the CSS viewport scale', () => {
    const measureBlock = sliceBetween(
      'function measureFitDimensions(containerHeightPx, retriesLeft)',
      'function handleMsg(msg)'
    )
    expect(measureBlock).toContain('var rows = Math.max(8, Math.floor(vpHeight / cellHeight));')
    expect(measureBlock).not.toContain('fixedGridFitScale')
  })

  it('keeps mobile source-grid glyph size stable while viewport zoom still uses a cover scale', () => {
    const fitBlock = sliceBetween('function computeFitScale()', 'function getTotalScale()')
    expect(fitBlock).toContain('var widthScale = window.innerWidth / termWidth;')
    expect(fitBlock).toContain('if (isMobileReflowSourceLayout())')
    expect(fitBlock).toContain('return 1;')
    expect(fitBlock).toContain('var heightScale = window.innerHeight / termHeight;')
    expect(fitBlock).toContain('return Math.max(widthScale, heightScale);')
    expect(fitBlock).not.toContain('scaleX')
    expect(fitBlock).not.toContain('scaleY')
  })

  it('reveals a replay surface only after its fit transform commits', () => {
    const initBlock = sliceBetween(
      'function initDirect(cols, rows, initialData',
      'function init(cols, rows, initialData'
    )
    expect(initBlock).toContain("surface.style.visibility = 'hidden';")
    expect(initBlock).toContain("applyFitScale('init-replay', function()")
    expect(initBlock.indexOf("surface.style.visibility = 'visible';")).toBeLessThan(
      initBlock.indexOf("notify({ type: 'ready', cols: cols, rows: rows });")
    )
    expect(initBlock.indexOf("applyFitScale('init-replay', function()")).toBeLessThan(
      initBlock.indexOf("surface.style.visibility = 'visible';")
    )
    const mobileRevealBlock = sliceBetween(
      'function revealMobileReplacement(',
      'function finishMobileProjectionInit('
    )
    expect(mobileRevealBlock).toContain("applyFitScale(reason, function()")
    expect(mobileRevealBlock.indexOf("surface.style.visibility = 'visible';")).toBeLessThan(
      mobileRevealBlock.indexOf("notify({ type: 'ready', cols: term.cols, rows: term.rows });")
    )
  })

  it('does not apply fractional smooth scroll transforms to terminal content', () => {
    const updateTransformBlock = sliceBetween(
      'function updateTransform()',
      'function updateScrollIndicator(reveal)'
    )
    expect(updateTransformBlock).toContain(
      "surface.style.transform = 'translate(' + panX + 'px,' + panY + 'px) scale(' + getTotalScale() + ')';"
    )
    expect(source).not.toContain("querySelector('.xterm-screen')")
    expect(source).not.toContain('updateTerminalScreenTransform')
    expect(updateTransformBlock).not.toContain("getVisualPanY() + 'px) scale('")
    expect(updateTransformBlock).not.toContain('smoothScrollOffsetY')
  })

  it('smooths velocity samples and uses lower friction for mobile momentum', () => {
    expect(source).toContain('function updateTouchVelocity(deltaY, dt)')
    expect(source).toContain('ts.velY * 0.55 + instantVelocity * 0.45')
    expect(source).toContain('var FRICTION = 0.972;')
    expect(source).toContain('var MIN_VEL = 0.012;')
  })

  it('keeps selection edge autoscroll active and extends the dragged endpoint', () => {
    const startBlock = sliceBetween('function startEdgeScroll(dir)', 'function stopEdgeScroll()')
    expect(startBlock.indexOf('stopEdgeScroll();')).toBeLessThan(
      startBlock.indexOf('edgeScrollDir = dir;')
    )
    expect(startBlock.indexOf('term.scrollLines(edgeScrollDir);')).toBeLessThan(
      startBlock.indexOf('syncEdgeScrollSelectionEndpoint();')
    )

    const dragMoveBlock = sliceBetween(
      'function handleDragMove(handle, clientX, clientY)',
      '  // Latching document-level touch dispatcher: see'
    )
    expect(dragMoveBlock).toContain('edgeScrollClientX = clientX;')
    expect(dragMoveBlock).toContain('edgeScrollClientY = clientY;')
    expect(dragMoveBlock).toContain('syncSelectionHandleToViewportPoint(handle, clientX, clientY)')
  })

  it('opens links and paths from surface taps before mouse/focus fallback', () => {
    expect(source).toContain('function buildMouseClickInput(clientX, clientY)')
    expect(source).toContain('function isClickMouseTrackingMode(mode)')
    expect(source).toContain("return mode !== 'none';")
    expect(source).toContain('var pixelX = cell.x;')
    expect(source).toContain('var pixelY = cell.y;')
    expect(source).toContain(
      'if (!isSafeSgrMouseCoordinate(cell.x) || !isSafeSgrMouseCoordinate(cell.y)) return'
    )
    expect(source).toContain(
      'if (!isSafeSgrMouseCoordinate(sgrCol) || !isSafeSgrMouseCoordinate(sgrRow)) return'
    )
    expect(source).toContain("if (mouseTrackingMode === 'x10') return pixelPress;")
    expect(source).toContain("if (mouseTrackingMode === 'x10') return sgrPress;")
    expect(source).toContain("if (mouseTrackingMode === 'x10') return press;")
    expect(source).toContain("if (col > 126 || row > 126) return '';")

    const touchEndBlock = sliceBetween(
      "document.addEventListener('touchend'",
      '}, { capture: true, passive: true });'
    )
    expect(touchEndBlock).toContain('notifyTerminalSurfaceTap(tapCandidate.x, tapCandidate.y)')

    const tapHandlerBlock = sliceBetween(
      'function notifyTerminalSurfaceTap(originX, originY)',
      "document.addEventListener('touchstart'"
    )
    expect(tapHandlerBlock.indexOf('oscLinkAtViewportPoint')).toBeLessThan(
      tapHandlerBlock.indexOf('urlAtViewportPoint')
    )
    expect(tapHandlerBlock.indexOf('urlAtViewportPoint')).toBeLessThan(
      tapHandlerBlock.indexOf('filePathAtViewportPoint')
    )
    expect(tapHandlerBlock.indexOf('filePathAtViewportPoint')).toBeLessThan(
      tapHandlerBlock.indexOf('var clickInput = buildMouseClickInput')
    )
    expect(tapHandlerBlock).toContain("notify({ type: 'open-url', url: tappedUrl });")
    expect(tapHandlerBlock).toContain("notify({ type: 'terminal-input', bytes: clickInput });")
    expect(tapHandlerBlock).toContain("notify({ type: 'terminal-tap' });")
  })

})

function simulateNormalBufferPull({
  baseY,
  viewportY,
  startY,
  endY,
  cellHeight
}: {
  baseY: number
  viewportY: number
  startY: number
  endY: number
  cellHeight: number
}): number {
  const deltaY = startY - endY
  if (deltaY > 0 ? viewportY >= baseY : viewportY <= 0) {
    return viewportY
  }
  const smoothScrollOffsetY = -deltaY
  const lines = Math.trunc(-smoothScrollOffsetY / cellHeight)
  const applied = Math.max(lines, -viewportY)
  return viewportY + applied
}
