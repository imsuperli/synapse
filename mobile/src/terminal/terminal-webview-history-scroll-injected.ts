export const TERMINAL_HISTORY_SCROLL_JS = String.raw`
  function notifyHistoryTopReached() {
    if (surfaceTouchActive || (ts && ts.momentumId !== null)) {
      historyTopPending = true;
      return false;
    }
    historyTopPending = false;
    ts.historyTopDistance = 0;
    emitDiagnostic('history-top', {});
    notify({ type: 'history-top' });
    return true;
  }

  function flushPendingHistoryTopReached() {
    if (!historyTopPending) return false;
    historyTopPending = false;
    return notifyHistoryTopReached();
  }

  function requestHistoryNearTopForDelta(deltaY) {
    if (deltaY >= 0) {
      if (surfaceTouchActive) {
        historyTopPending = false;
        ts.historyTopDistance = 0;
      }
      return false;
    }
    ts.historyTopDistance += -deltaY;
    if (!term || !term.buffer || !term.buffer.active) return false;
    var buffer = term.buffer.active;
    if (buffer.type !== 'normal') return false;
    var thresholdRows = Math.max(2, Math.min(12, Math.floor((term.rows || 1) / 2)));
    if ((buffer.viewportY || 0) > thresholdRows) return false;
    if (ts.historyTopDistance < 24) return false;
    historyTopPending = true;
    return true;
  }
`
