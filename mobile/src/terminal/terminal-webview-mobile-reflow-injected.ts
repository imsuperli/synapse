// Remote-only mobile projection support injected into XTERM_HTML. The source
// terminal always parses PTY bytes at the desktop grid. A second, visible term
// is used only while normal-buffer output can be safely rewrapped for the phone.
export const TERMINAL_MOBILE_REFLOW_JS = String.raw`
  var MOBILE_REFLOW_SOURCE_SCROLLBACK = 256;
  var MOBILE_REFLOW_REFRESH_DELAY_MS = 120;
  var MOBILE_REFLOW_SOURCE_FALLBACK_MS = 500;
  var mobileSourceTerm = null;
  var mobileSourceSerializeAddon = null;
  var mobileSourceCols = 80;
  var mobileSourceRows = 24;
  var mobileReflowLayout = 'none';
  var mobileWriteQueue = [];
  var mobileWritesDraining = false;
  var mobileProjectionDirty = false;
  var mobileProjectionDirtyAt = 0;
  var mobileRefreshTimer = null;
  var mobileRefreshRequested = false;
  var mobileRefreshForceReplay = false;
  var mobileSourceSwitching = false;
  var mobileRetiredSurfaces = [];
  var mobileRetiredTerms = [];
  var mobileControlSequenceState = 'ground';
  var mobileProjectedContentRows = 0;
  var mobileCarriageReturnPending = false;

  function isMobileReflowTextScale() {
    return textScaleMode === 'mobile-reflow';
  }

  function isMobileReflowAdaptiveLayout() {
    return isMobileReflowTextScale() && mobileReflowLayout === 'adaptive';
  }

  function isMobileReflowSourceLayout() {
    return isMobileReflowTextScale() && mobileReflowLayout === 'source';
  }

  function mobileProtocolTerm() {
    if (isMobileReflowTextScale() && mobileSourceTerm) return mobileSourceTerm;
    return term;
  }

  function clearMobileRefreshTimer() {
    if (mobileRefreshTimer !== null) {
      clearTimeout(mobileRefreshTimer);
      mobileRefreshTimer = null;
    }
  }

  function resetMobileWriteState() {
    mobileWriteQueue = [];
    mobileWritesDraining = false;
    mobileProjectionDirty = false;
    mobileProjectionDirtyAt = 0;
    mobileRefreshRequested = false;
    mobileRefreshForceReplay = false;
    mobileSourceSwitching = false;
    mobileControlSequenceState = 'ground';
    mobileProjectedContentRows = 0;
    mobileCarriageReturnPending = false;
    clearMobileRefreshTimer();
  }

  function disposeMobileSourceTerm(exceptTerm) {
    var source = mobileSourceTerm;
    mobileSourceTerm = null;
    mobileSourceSerializeAddon = null;
    mobileReflowLayout = 'none';
    resetMobileWriteState();
    if (source && source !== exceptTerm) {
      try { source.dispose(); } catch (e) {}
    }
  }

  function loadMobileUnicodeAddon(targetTerm) {
    if (!targetTerm || !window.Unicode11Addon || !window.Unicode11Addon.Unicode11Addon) return;
    try {
      targetTerm.loadAddon(new window.Unicode11Addon.Unicode11Addon());
      targetTerm.unicode.activeVersion = '11';
    } catch (e) {}
  }

  function loadMobileWebglAddon(targetTerm) {
    if (!targetTerm || !window.WebglAddon || !window.WebglAddon.WebglAddon) return;
    try {
      var webglAddon = new window.WebglAddon.WebglAddon();
      targetTerm.loadAddon(webglAddon);
      if (webglAddon.onContextLoss) {
        webglAddon.onContextLoss(function() {
          try { webglAddon && webglAddon.dispose && webglAddon.dispose(); } catch (e) {}
        });
      }
    } catch (e) {}
  }

  function createMobileTerminal(cols, rows, fontScale, scrollback) {
    return new Terminal({
      cols: cols || 80,
      rows: rows || 24,
      theme: terminalTheme,
      fontFamily: terminalFontFamily,
      fontSize: fontPxForScale(fontScale),
      fontWeight: '300',
      fontWeightBold: '500',
      scrollback: scrollback,
      disableStdin: true,
      cursorBlink: true,
      cursorStyle: 'bar',
      cursorInactiveStyle: 'bar',
      cursorWidth: 3,
      convertEol: false,
      allowProposedApi: true
    });
  }

  function createMobileSourceTerminal(cols, rows) {
    var source = createMobileTerminal(cols, rows, 1, 30000);
    installMobileTerminalScrollbackPreservation(source);
    loadMobileUnicodeAddon(source);
    if (window.SerializeAddon && window.SerializeAddon.SerializeAddon) {
      try {
        mobileSourceSerializeAddon = new window.SerializeAddon.SerializeAddon();
        source.loadAddon(mobileSourceSerializeAddon);
      } catch (e) {
        mobileSourceSerializeAddon = null;
      }
    }
    return source;
  }

  function createMobileProjectionTerminal(cols, rows) {
    var projection = createMobileTerminal(cols, rows, currentTextScale, 30000);
    projection.open(surface);
    installMobileTerminalScrollbackPreservation(projection);
    loadMobileWebglAddon(projection);
    loadMobileUnicodeAddon(projection);
    return projection;
  }

  function trackRetiredTerminalReplacement(oldTerm, oldSurface) {
    if (oldSurface && mobileRetiredSurfaces.indexOf(oldSurface) === -1) {
      mobileRetiredSurfaces.push(oldSurface);
    }
    if (oldTerm && mobileRetiredTerms.indexOf(oldTerm) === -1) {
      mobileRetiredTerms.push(oldTerm);
    }
  }

  function prepareMobileReplacementSurface(oldTerm, oldSurface) {
    var nextSurface = oldSurface;
    if (oldTerm) {
      trackRetiredTerminalReplacement(oldTerm, oldSurface);
      nextSurface = document.createElement('div');
      nextSurface.id = 'terminal-surface';
      nextSurface.style.visibility = 'hidden';
      nextSurface.style.position = 'absolute';
      nextSurface.style.left = '0';
      nextSurface.style.top = '0';
      nextSurface.style.transform = oldSurface.style.transform;
      document.getElementById('terminal-container').appendChild(nextSurface);
      attachSurfaceEventHandlers(nextSurface);
      oldSurface.removeAttribute('id');
    } else {
      nextSurface.style.visibility = 'hidden';
    }
    return nextSurface;
  }

  function disposeMobileRetiredReplacements(currentTerm, currentSurface) {
    var retiredSurfaces = mobileRetiredSurfaces;
    var retiredTerms = mobileRetiredTerms;
    mobileRetiredSurfaces = [];
    mobileRetiredTerms = [];
    for (var i = 0; i < retiredSurfaces.length; i++) {
      if (retiredSurfaces[i] && retiredSurfaces[i] !== currentSurface) {
        retiredSurfaces[i].remove();
      }
    }
    for (var j = 0; j < retiredTerms.length; j++) {
      var retiredTerm = retiredTerms[j];
      if (retiredTerm && retiredTerm !== currentTerm && retiredTerm !== mobileSourceTerm) {
        try { retiredTerm.dispose(); } catch (e) {}
      }
    }
  }

  function mobileSourceMouseTrackingMode() {
    var source = mobileSourceTerm;
    try {
      var mode = source && source.modes && source.modes.mouseTrackingMode;
      if (mode === 'x10' || mode === 'vt200' || mode === 'drag' || mode === 'any') return mode;
    } catch (e) {}
    return trackedMouseTrackingMode;
  }

  function mobileSourceHasCustomScreenState() {
    var source = mobileSourceTerm;
    if (!source) return true;
    try {
      if (source.buffer.active.type === 'alternate') return true;
      if (
        source.modes &&
        (source.modes.originMode ||
          source.modes.insertMode ||
          source.modes.wraparoundMode === false ||
          source.modes.synchronizedOutputMode)
      ) {
        return true;
      }
      var coreBuffer = source._core && source._core.buffer;
      if (
        coreBuffer &&
        (coreBuffer.scrollTop !== 0 || coreBuffer.scrollBottom !== source.rows - 1)
      ) {
        return true;
      }
      var charsetService = source._core && source._core._charsetService;
      if (charsetService && charsetService.charset) return true;
    } catch (e) {
      return true;
    }
    return mobileSourceMouseTrackingMode() !== 'none';
  }

  function mobileSourceCursorIsAtContentEnd() {
    var source = mobileSourceTerm;
    if (!source || !source.buffer || !source.buffer.normal) return false;
    var buffer = source.buffer.normal;
    var cursorRow = (buffer.baseY || 0) + (buffer.cursorY || 0);
    var cursorCol = buffer.cursorX || 0;
    var line = buffer.getLine(cursorRow);
    if (line && cursorCol !== mobileSourceLineContentEnd(line)) return false;
    if (line && line.translateToString(true, cursorCol).length > 0) return false;
    for (var row = cursorRow + 1; row < buffer.length; row++) {
      var nextLine = buffer.getLine(row);
      if (nextLine && nextLine.translateToString(true).length > 0) return false;
    }
    return true;
  }

  function mobileSourceLineContentEnd(line) {
    if (!line || !mobileSourceTerm) return 0;
    for (var col = mobileSourceTerm.cols - 1; col >= 0; col--) {
      var cell = line.getCell(col);
      if (!cell || cell.getWidth() === 0) continue;
      var hasAttributes = false;
      try {
        hasAttributes = cell.isAttributeDefault && !cell.isAttributeDefault();
      } catch (e) {}
      if (cell.getChars() || mobileCellOscLinkId(cell) || hasAttributes) {
        return Math.min(
          mobileSourceTerm.cols,
          col + Math.max(1, cell.getWidth())
        );
      }
    }
    return 0;
  }

  function mobileSourceCanUseAdaptiveLayout() {
    return (
      mobileControlSequenceState === 'ground' &&
      !mobileCarriageReturnPending &&
      !mobileSourceHasCustomScreenState() &&
      mobileSourceCursorIsAtContentEnd()
    );
  }

  function scanMobileControlSequenceState(data, initialState) {
    var state = initialState || 'ground';
    if (typeof data !== 'string' || data.length === 0) return state;
    for (var index = 0; index < data.length; index++) {
      var code = data.charCodeAt(index);
      var char = data.charAt(index);
      if (state === 'ground') {
        if (code === 0x1b) state = 'escape';
        else if (code === 0x9b) state = 'csi';
        else if (code === 0x9d) state = 'osc';
        else if (code === 0x90 || code === 0x98 || code === 0x9e || code === 0x9f) {
          state = 'string';
        }
        continue;
      }
      if (state === 'escape') {
        if (char === '[') state = 'csi';
        else if (char === ']') state = 'osc';
        else if (char === 'P' || char === 'X' || char === '^' || char === '_') state = 'string';
        else if (code === 0x1b || (code >= 0x20 && code <= 0x2f)) state = 'escape';
        else state = 'ground';
        continue;
      }
      if (state === 'csi') {
        if ((code >= 0x40 && code <= 0x7e) || code === 0x18 || code === 0x1a) {
          state = 'ground';
        } else if (code === 0x1b) {
          state = 'escape';
        }
        continue;
      }
      if (state === 'osc' || state === 'string') {
        if (code === 0x9c || code === 0x18 || code === 0x1a || (state === 'osc' && code === 0x07)) {
          state = 'ground';
        } else if (code === 0x1b) {
          state = state === 'osc' ? 'osc-escape' : 'string-escape';
        }
        continue;
      }
      if (state === 'osc-escape' || state === 'string-escape') {
        if (char === '\\') {
          state = 'ground';
        } else if (code !== 0x1b) {
          state = state === 'osc-escape' ? 'osc' : 'string';
        }
      }
    }
    return state;
  }

  function parseSafeMobileCsi(data, index) {
    var start = index;
    while (index < data.length) {
      var code = data.charCodeAt(index);
      if (code >= 0x40 && code <= 0x7e) {
        var final = data.charAt(index);
        var params = data.slice(start, index);
        if (final === 'm') return index + 1;
        if (
          (final === 'h' || final === 'l') &&
          /^\?(?:25|2004|2026)(?:;(?:25|2004|2026))*$/.test(params)
        ) {
          return index + 1;
        }
        return -1;
      }
      index++;
    }
    return -1;
  }

  function parseSafeMobileOsc(data, index) {
    while (index < data.length) {
      var code = data.charCodeAt(index);
      if (code === 0x07) return index + 1;
      if (code === 0x1b && data.charAt(index + 1) === '\\') return index + 2;
      index++;
    }
    return -1;
  }

  function isSafeMobileProjectionData(data) {
    if (typeof data !== 'string' || data.length === 0) return true;
    var index = 0;
    while (index < data.length) {
      var code = data.charCodeAt(index);
      if (code === 0x1b) {
        var introducer = data.charAt(index + 1);
        if (introducer === '[') {
          index = parseSafeMobileCsi(data, index + 2);
        } else if (introducer === ']') {
          index = parseSafeMobileOsc(data, index + 2);
        } else {
          return false;
        }
        if (index < 0) return false;
        continue;
      }
      if (code === 0x9b) {
        index = parseSafeMobileCsi(data, index + 1);
        if (index < 0) return false;
        continue;
      }
      if (code === 0x9d) {
        index = parseSafeMobileOsc(data, index + 1);
        if (index < 0) return false;
        continue;
      }
      if (code === 0x0d) {
        if (data.charCodeAt(index + 1) !== 0x0a) return false;
        index += 2;
        continue;
      }
      if (
        (code >= 0x00 && code < 0x20 && code !== 0x07) ||
        (code >= 0x7f && code < 0xa0)
      ) {
        return false;
      }
      index++;
    }
    return true;
  }

  function mobileSourceOscLinkService() {
    try {
      var core = mobileSourceTerm && mobileSourceTerm._core;
      if (!core) return null;
      return core._oscLinkService
        || (core._inputHandler && core._inputHandler._oscLinkService)
        || null;
    } catch (e) {
      return null;
    }
  }

  function mobileCellOscLinkId(cell) {
    try {
      return cell && cell.extended && cell.extended.urlId ? cell.extended.urlId : 0;
    } catch (e) {
      return 0;
    }
  }

  function collectMobileProjectedOscLinks(targetCols) {
    var source = mobileSourceTerm;
    var service = mobileSourceOscLinkService();
    mobileProjectedContentRows = 0;
    if (!source || targetCols <= 0) return [];
    var buffer = source.buffer.normal;
    var links = [];
    var targetRow = 0;
    var targetCol = 0;
    var active = null;

    function closeActive() {
      if (active && active.endCol > active.startCol) links.push(active);
      active = null;
    }

    var lastSourceRow = buffer.length - 1;
    if (buffer.length <= source.rows) {
      lastSourceRow = Math.min(
        lastSourceRow,
        (buffer.baseY || 0) + (buffer.cursorY || 0)
      );
    }
    for (var row = 0; row <= lastSourceRow; row++) {
      var line = buffer.getLine(row);
      if (!line) continue;
      if (row > 0 && !line.isWrapped) {
        closeActive();
        targetRow++;
        targetCol = 0;
      }
      var lineLength = mobileSourceLineContentEnd(line);
      for (var col = 0; col < lineLength; col++) {
        var cell = line.getCell(col);
        if (!cell || cell.getWidth() === 0) continue;
        var width = Math.max(1, cell.getWidth());
        if (targetCol + width > targetCols) {
          closeActive();
          targetRow++;
          targetCol = 0;
        }
        var linkId = mobileCellOscLinkId(cell);
        var linkData = linkId && service && service.getLinkData
          ? service.getLinkData(linkId)
          : null;
        var uri = linkData && typeof linkData.uri === 'string' ? linkData.uri : '';
        if (
          active &&
          active.uri === uri &&
          active.row === targetRow &&
          active.endCol === targetCol
        ) {
          active.endCol += width;
        } else {
          closeActive();
          if (uri) {
            active = {
              row: targetRow,
              startCol: targetCol,
              endCol: targetCol + width,
              uri: uri
            };
          }
        }
        targetCol += width;
      }
    }
    closeActive();
    mobileProjectedContentRows = targetRow + 1;
    return links;
  }

  function makeMobileSerializedProjectionReflowSafe(serialized) {
    if (typeof serialized !== 'string' || serialized.length === 0) return '';
    return serialized
      .replace(/\x1b\[\?25l/g, '\x1b[?25h')
      .replace(/\x9b\?25l/g, '\x1b[?25h')
      .replace(/\x1b\[(\d*)C/g, function(_match, countText) {
        var count = countText ? parseInt(countText, 10) : 1;
        if (!isFinite(count) || count <= 0) count = 1;
        return ' '.repeat(Math.min(mobileSourceCols, count));
      })
      .replace(/\x9b(\d*)C/g, function(_match, countText) {
        var count = countText ? parseInt(countText, 10) : 1;
        if (!isFinite(count) || count <= 0) count = 1;
        return ' '.repeat(Math.min(mobileSourceCols, count));
      });
  }

  function mobileProjectionDimensions() {
    var cellW = getCellWidth();
    var cellH = getCellHeight();
    if (cellW <= 0 || cellH <= 0) return null;
    return {
      cols: Math.max(MIN_FIT_COLS, Math.floor(window.innerWidth / cellW)),
      rows: Math.max(8, Math.floor(window.innerHeight / cellH))
    };
  }

  function revealMobileReplacement(gen, oldTerm, oldSurface, reason, metadata) {
    applyFitScale(reason, function() {
      if (gen !== terminalGeneration) return;
      surface.style.visibility = 'visible';
      if (surface !== oldSurface) {
        surface.style.position = '';
        surface.style.left = '';
        surface.style.top = '';
      }
      disposeMobileRetiredReplacements(term, surface);
      ready = true;
      everReady = true;
      attachTermObservers();
      notify({ type: 'ready', cols: term.cols, rows: term.rows });
      emitDiagnostic('terminal-ready', metadata);
      pumpMobileWrites();
    });
  }

  function finishMobileProjectionInit(
    gen,
    oldTerm,
    oldSurface,
    scrollAnchorRows,
    serialized,
    replayLength,
    preserveScroll,
    preserveFullInitialData
  ) {
    var attempts = 0;
    function waitForDimensions() {
      if (gen !== terminalGeneration || !term) return;
      attempts++;
      var dimensions = mobileProjectionDimensions();
      if (!dimensions && attempts < FIT_RETRY_MAX_FRAMES) {
        requestAnimationFrame(waitForDimensions);
        return;
      }
      if (!dimensions) {
        dimensions = {
          cols: Math.max(MIN_FIT_COLS, Math.min(mobileSourceCols, 80)),
          rows: Math.max(8, Math.min(mobileSourceRows, 24))
        };
      }
      term.resize(dimensions.cols, dimensions.rows);
      initRows = dimensions.rows;
      initialOscLinks = collectMobileProjectedOscLinks(dimensions.cols);
      mobileSourceTerm.options.scrollback = MOBILE_REFLOW_SOURCE_SCROLLBACK;
      term.write(serialized, function() {
        if (gen !== terminalGeneration) return;
        if (scrollAnchorRows > 0 && term.buffer && term.buffer.active) {
          try {
            term.scrollToLine(Math.max(0, (term.buffer.active.baseY || 0) - scrollAnchorRows));
          } catch (e) {}
        }
        initialOscLinkRowOffset = Math.max(
          0,
          mobileProjectedContentRows - (term.buffer.normal.length || 0)
        );
        captureInitialOscLinkTexts();
        initialOscLinkEvictionReady = true;
        revealMobileReplacement(gen, oldTerm, oldSurface, 'mobile-reflow-init', {
          initialDataChars: replayLength,
          preserveScroll: preserveScroll === true,
          preserveFullInitialData: preserveFullInitialData === true,
          mobileLayout: 'adaptive',
          sourceCols: mobileSourceCols,
          sourceRows: mobileSourceRows
        });
      });
    }
    requestAnimationFrame(waitForDimensions);
  }

  function openMobileSourceAsVisible(
    gen,
    oldTerm,
    oldSurface,
    replayLength,
    preserveScroll,
    preserveFullInitialData,
    reason
  ) {
    mobileReflowLayout = 'source';
    term = mobileSourceTerm;
    if (!term) return;
    surface = prepareMobileReplacementSurface(oldTerm, oldSurface);
    term.open(surface);
    loadMobileWebglAddon(term);
    requestAnimationFrame(function() {
      if (gen !== terminalGeneration) return;
      captureInitialOscLinkTexts();
      initialOscLinkRowOffset = 0;
      initialOscLinkEvictionReady = true;
      revealMobileReplacement(gen, oldTerm, oldSurface, 'mobile-source-' + reason, {
        initialDataChars: replayLength,
        preserveScroll: preserveScroll === true,
        preserveFullInitialData: preserveFullInitialData === true,
        mobileLayout: 'source',
        sourceCols: mobileSourceCols,
        sourceRows: mobileSourceRows
      });
    });
  }

  function initMobileReflow(
    cols,
    rows,
    initialData,
    nextTheme,
    nextFontScale,
    preserveScroll,
    nextOscLinks,
    preserveFullInitialData
  ) {
    textScaleMode = 'mobile-reflow';
    if (typeof nextFontScale === 'number' && nextFontScale > 0) {
      currentTextScale = snapToTextScalePreset(nextFontScale);
    }
    var oldTerm = term;
    var oldSurface = surface;
    var oldSource = mobileSourceTerm;
    var previousBuffer = preserveScroll && oldTerm && oldTerm.buffer
      ? oldTerm.buffer.active
      : null;
    var scrollAnchorRows = previousBuffer
      ? Math.max(0, (previousBuffer.baseY || 0) - (previousBuffer.viewportY || 0))
      : -1;

    terminalGeneration++;
    var gen = terminalGeneration;
    ready = false;
    userScale = 1;
    resetWriteQueue();
    resetMobileWriteState();
    statusDotPendingSelector = false;
    writesDraining = false;
    afterDrainCallbacks = [];
    firstDataPending = true;
    smoothScrollOffsetY = 0;
    mouseModeScanTail = '';
    trackedMouseTrackingMode = 'none';
    sgrMouseMode = false;
    sgrMousePixelsMode = false;
    lastEmittedModes = {
      bracketedPasteMode: false,
      altScreen: false,
      mouseTrackingMode: 'none',
      sgrMouseMode: false,
      sgrMousePixelsMode: false
    };
    mobileSourceCols = Math.max(2, Math.floor(cols || 80));
    mobileSourceRows = Math.max(1, Math.floor(rows || 24));
    initRows = mobileSourceRows;
    mobileReflowLayout = 'initializing';
    initialOscLinks = Array.isArray(nextOscLinks) ? nextOscLinks : [];
    initialOscLinkRowOffset = 0;
    initialOscLinkEvictionReady = false;
    preservePanOnNextFit = !!(oldTerm && preserveScroll);
    disposeTermObservers();
    resetEvictionCounter();
    cancelSelect();
    clearMobileRefreshTimer();
    if (oldSource && oldSource !== oldTerm) {
      try { oldSource.dispose(); } catch (e) {}
    }

    applyTerminalTheme(nextTheme);
    mobileSourceTerm = createMobileSourceTerminal(mobileSourceCols, mobileSourceRows);
    var replayData = preserveFullInitialData
      ? initialData
      : normalizeInitialData(initialData);
    replayData = normalizeStatusDotPresentation(replayData || '')
      .replace(/\x1b\[\?25l/g, '\x1b[?25h')
      .replace(/\x9b\?25l/g, '\x1b[?25h');
    mobileControlSequenceState = scanMobileControlSequenceState(replayData, 'ground');
    mobileCarriageReturnPending = replayData.charAt(replayData.length - 1) === '\r';
    updateMouseModeFromData(replayData);
    activeAltScreenSnapshot = isAltScreenActive(replayData);

    mobileSourceTerm.write(replayData, function() {
      if (gen !== terminalGeneration || !mobileSourceTerm) return;
      try {
        if (!mobileSourceSerializeAddon || !mobileSourceCanUseAdaptiveLayout()) {
          openMobileSourceAsVisible(
            gen,
            oldTerm,
            oldSurface,
            replayData.length,
            preserveScroll,
            preserveFullInitialData,
            'initial-fallback'
          );
          return;
        }
        var serialized = mobileSourceSerializeAddon.serialize({
          excludeAltBuffer: true,
          excludeModes: false
        });
        serialized = makeMobileSerializedProjectionReflowSafe(serialized);
        mobileReflowLayout = 'adaptive';
        surface = prepareMobileReplacementSurface(oldTerm, oldSurface);
        term = createMobileProjectionTerminal(
          Math.min(mobileSourceCols, 80),
          Math.min(mobileSourceRows, 24)
        );
        finishMobileProjectionInit(
          gen,
          oldTerm,
          oldSurface,
          scrollAnchorRows,
          serialized,
          replayData.length,
          preserveScroll,
          preserveFullInitialData
        );
      } catch (e) {
        reportEngineError('mobile reflow init failed', e, !everReady);
      }
    });
  }

  function markMobileProjectionDirty(reason) {
    if (!mobileProjectionDirty) {
      mobileProjectionDirty = true;
      mobileProjectionDirtyAt = Date.now();
      emitDiagnostic('mobile-reflow-dirty', { reason: reason });
    }
  }

  function requestMobileProjectionRefresh(reason, forceReplay) {
    if (!isMobileReflowTextScale() || mobileRefreshRequested) return;
    mobileRefreshForceReplay = mobileRefreshForceReplay || forceReplay === true;
    clearMobileRefreshTimer();
    mobileRefreshTimer = setTimeout(function() {
      mobileRefreshTimer = null;
      if (!isMobileReflowTextScale() || mobileRefreshRequested) return;
      var shouldForceReplay = mobileRefreshForceReplay;
      mobileRefreshForceReplay = false;
      if (!shouldForceReplay && !mobileSourceCanUseAdaptiveLayout()) {
        switchMobileToSourceLayout(reason + '-unstable');
        return;
      }
      mobileRefreshRequested = true;
      notify({ type: 'mobile-reflow-refresh' });
      emitDiagnostic('mobile-reflow-refresh', { reason: reason });
    }, MOBILE_REFLOW_REFRESH_DELAY_MS);
  }

  function switchMobileToSourceLayout(reason) {
    if (
      !isMobileReflowTextScale() ||
      mobileReflowLayout === 'source' ||
      mobileSourceSwitching ||
      !mobileSourceTerm
    ) {
      return;
    }
    mobileSourceSwitching = true;
    clearMobileRefreshTimer();
    var gen = terminalGeneration;
    var oldTerm = term;
    var oldSurface = surface;
    ready = false;
    mobileReflowLayout = 'source';
    initialOscLinks = [];
    initialOscLinkRowOffset = 0;
    initialOscLinkEvictionReady = false;
    surface = prepareMobileReplacementSurface(oldTerm, oldSurface);
    term = mobileSourceTerm;
    try {
      term.open(surface);
      loadMobileWebglAddon(term);
    } catch (e) {
      mobileSourceSwitching = false;
      reportEngineError('mobile source layout failed', e, false);
      return;
    }
    requestAnimationFrame(function() {
      if (gen !== terminalGeneration || term !== mobileSourceTerm) return;
      applyFitScale('mobile-source-switch', function() {
        if (gen !== terminalGeneration || term !== mobileSourceTerm) return;
        surface.style.visibility = 'visible';
        surface.style.position = '';
        surface.style.left = '';
        surface.style.top = '';
        disposeMobileRetiredReplacements(term, surface);
        mobileSourceSwitching = false;
        mobileProjectionDirty = false;
        ready = true;
        attachTermObservers();
        emitModesIfChanged();
        emitKeyboardAvoidanceMetrics();
        emitDiagnostic('mobile-reflow-layout', { layout: 'source', reason: reason });
        pumpMobileWrites();
        if (mobileSourceCanUseAdaptiveLayout()) {
          requestMobileProjectionRefresh('source-stable');
        }
      });
    });
  }

  function scheduleMobileProjectionRecovery(reason) {
    markMobileProjectionDirty(reason);
    if (Date.now() - mobileProjectionDirtyAt >= MOBILE_REFLOW_SOURCE_FALLBACK_MS) {
      switchMobileToSourceLayout(reason + '-timeout');
      return;
    }
    requestMobileProjectionRefresh(reason);
  }

  function handleMobileSourceBatch(data, safe) {
    emitModesIfChanged();
    if (mobileReflowLayout === 'source') {
      if (mobileSourceCanUseAdaptiveLayout()) requestMobileProjectionRefresh('source-stable');
      return;
    }
    if (mobileReflowLayout !== 'adaptive') return;
    if (mobileControlSequenceState !== 'ground' || mobileCarriageReturnPending) {
      markMobileProjectionDirty('partial-control-sequence');
      return;
    }
    if (!mobileSourceCanUseAdaptiveLayout()) {
      switchMobileToSourceLayout('source-grid-required');
      return;
    }
    if (safe && !mobileProjectionDirty && !mobileRefreshRequested && term) {
      term.write(data, function() {
        if (firstDataPending) {
          firstDataPending = false;
          applyFitScale('first-data');
        }
      });
      return;
    }
    markMobileProjectionDirty('complex-normal-output');
    if (mobileControlSequenceState === 'ground') {
      scheduleMobileProjectionRecovery('complex-normal-output');
    }
  }

  function pumpMobileWrites() {
    if (
      !isMobileReflowTextScale() ||
      !ready ||
      !mobileSourceTerm ||
      mobileWritesDraining ||
      mobileWriteQueue.length === 0
    ) {
      return;
    }
    var batch = mobileWriteQueue;
    mobileWriteQueue = [];
    var parts = [];
    var safe = true;
    for (var i = 0; i < batch.length; i++) {
      parts.push(batch[i].data);
      safe = safe && batch[i].safe;
    }
    var data = parts.join('');
    var source = mobileSourceTerm;
    var generation = terminalGeneration;
    mobileWritesDraining = true;
    source.write(data, function() {
      if (generation !== terminalGeneration || source !== mobileSourceTerm) return;
      ensureTerminalCursorVisible(source);
      mobileWritesDraining = false;
      handleMobileSourceBatch(data, safe);
      pumpMobileWrites();
    });
  }

  function writeMobileReflow(data) {
    var normalized = normalizeStatusDotPresentation(data)
      .replace(/\x1b\[\?25l/g, '\x1b[?25h')
      .replace(/\x9b\?25l/g, '\x1b[?25h');
    var previousControlSequenceState = mobileControlSequenceState;
    var previousCarriageReturnPending = mobileCarriageReturnPending;
    mobileControlSequenceState = scanMobileControlSequenceState(
      normalized,
      previousControlSequenceState
    );
    mobileCarriageReturnPending = normalized.charAt(normalized.length - 1) === '\r';
    mobileWriteQueue.push({
      data: normalized,
      safe:
        previousControlSequenceState === 'ground' &&
        mobileControlSequenceState === 'ground' &&
        !previousCarriageReturnPending &&
        !mobileCarriageReturnPending &&
        isSafeMobileProjectionData(normalized)
    });
    pumpMobileWrites();
  }

  function resizeMobileSource(cols, rows, reason) {
    mobileSourceCols = Math.max(2, Math.floor(cols || mobileSourceCols));
    mobileSourceRows = Math.max(1, Math.floor(rows || mobileSourceRows));
    if (mobileSourceTerm) {
      mobileSourceTerm.resize(mobileSourceCols, mobileSourceRows);
    }
    if (mobileReflowLayout === 'source') {
      initRows = mobileSourceRows;
      applyFitScale(reason);
      emitKeyboardAvoidanceMetrics();
      return;
    }
    markMobileProjectionDirty(reason);
    requestMobileProjectionRefresh(reason, true);
  }

  function resizeMobileProjectionForViewport(reason) {
    if (!isMobileReflowAdaptiveLayout() || !term) return false;
    var dimensions = mobileProjectionDimensions();
    if (!dimensions || dimensions.cols !== term.cols) return false;
    if (dimensions.rows !== term.rows) {
      term.resize(dimensions.cols, dimensions.rows);
      initRows = dimensions.rows;
    }
    applyFitScale(reason);
    emitKeyboardAvoidanceMetrics();
    return true;
  }

  function clearMobileReflowTerminals() {
    resetMobileWriteState();
    if (mobileSourceTerm) {
      try { mobileSourceTerm.clear(); mobileSourceTerm.reset(); } catch (e) {}
    }
    if (term && term !== mobileSourceTerm) {
      try { term.clear(); term.reset(); } catch (e) {}
    }
  }
`;
