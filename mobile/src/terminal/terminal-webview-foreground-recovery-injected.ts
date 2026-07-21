// Android can suspend a WebView without completing its current touch sequence.
// This routine is invoked explicitly after React Native reports AppState active.
export const TERMINAL_FOREGROUND_RECOVERY_JS = String.raw`
  function restoreTerminalAfterForeground() {
    if (ts.momentumId !== null) {
      cancelAnimationFrame(ts.momentumId);
      ts.momentumId = null;
    }
    resetSmoothScrollOffset();
    resetTouchDispatcherState();
    surfaceTouchActive = false;
    historyTopPending = false;
    historyTopPullDistance = 0;
    lastGestureDiagnosticRoute = '';
    ts.isPinching = false;
    ts.pinchDist = 0;
    ts.pinchScale = 0;
    ts.pinchSurfX = 0;
    ts.pinchSurfY = 0;
    ts.velY = 0;
    ts.accumDelta = 0;
    ts.lastTime = 0;
    userScale = 1;
    clampPan();
    updateTransform();
    if (term && term.rows > 0) {
      try { term.refresh(0, term.rows - 1); } catch (e) {}
    }
    scheduleCursorOverlayUpdate();
    emitKeyboardAvoidanceMetrics();
  }
`
