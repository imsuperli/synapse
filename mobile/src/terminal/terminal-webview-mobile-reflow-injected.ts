// Remote-only mobile projection support injected into XTERM_HTML. The source
// terminal always parses PTY bytes at the desktop grid. A second, visible term
// projects normal output or a serialized complex-screen snapshot at phone width.
export const TERMINAL_MOBILE_REFLOW_JS = String.raw`
  // Local snapshot rebuilds depend on this source buffer. Lowering its limit
  // irreversibly discards history before the replacement projection is built.
  var MOBILE_REFLOW_SOURCE_SCROLLBACK = 30000;
  var MOBILE_REFLOW_REFRESH_DELAY_MS = 120;
  var MOBILE_CODEX_HARD_WRAP_MAX_SLACK = 12;
  var mobileSourceTerm = null;
  var mobileSourceSerializeAddon = null;
  var mobileSourceCols = 80;
  var mobileSourceRows = 24;
  var mobileReflowLayout = 'none';
  var mobileWriteQueue = [];
  var mobileWritesDraining = false;
  var mobileProjectionDirty = false;
  var mobileRefreshTimer = null;
  var mobileRefreshRequested = false;
  var mobileRefreshForceReplay = false;
  var mobileSourceSwitching = false;
  var mobileRetiredSurfaces = [];
  var mobileRetiredTerms = [];
  var mobileControlSequenceState = 'ground';
  var mobileProjectedContentRows = 0;
  var mobileCarriageReturnPending = false;
  var mobileSnapshotRefreshTimer = null;
  var mobileSnapshotBuildInFlight = false;
  var mobileSnapshotBuildToken = 0;
  var mobileSnapshotPendingReason = '';
  var mobileSnapshotBuildOldLayout = '';
  var mobileSourceRevision = 0;
  var mobileLiveInputText = '';
  var mobileSnapshotProjectionPlan = null;
  var mobileSnapshotRefreshDeferredForInteraction = false;
  var mobileAdaptiveRefreshDeferredForInteraction = false;

  function mobileViewportInteractionActive() {
    return !!(
      surfaceTouchActive ||
      (typeof ts !== 'undefined' && ts && (ts.isPinching || ts.momentumId !== null))
    );
  }

  function deferMobileProjectionRefreshForInteraction(reason) {
    if (
      mobileSnapshotRefreshTimer !== null ||
      mobileSnapshotBuildInFlight ||
      mobileSnapshotPendingReason
    ) {
      mobileSnapshotRefreshDeferredForInteraction = true;
      mobileSnapshotPendingReason =
        mobileSnapshotPendingReason || reason || 'viewport-interaction';
    }
    if (mobileRefreshTimer !== null) {
      mobileAdaptiveRefreshDeferredForInteraction = true;
    }
    clearMobileRefreshTimer();
    clearMobileSnapshotRefreshTimer();
  }

  function resumeMobileProjectionRefreshAfterInteraction() {
    if (mobileViewportInteractionActive() || !isMobileReflowTextScale()) return;
    if (
      mobileSnapshotRefreshDeferredForInteraction ||
      mobileSnapshotPendingReason ||
      (!mobileSourceCanUseAdaptiveLayout() && mobileProjectionDirty)
    ) {
      mobileSnapshotRefreshDeferredForInteraction = false;
      mobileAdaptiveRefreshDeferredForInteraction = false;
      scheduleMobileSnapshotProjection(mobileSnapshotPendingReason || 'viewport-interaction-end');
      return;
    }
    if (
      mobileAdaptiveRefreshDeferredForInteraction ||
      mobileProjectionDirty ||
      mobileRefreshForceReplay
    ) {
      mobileAdaptiveRefreshDeferredForInteraction = false;
      requestMobileProjectionRefresh('viewport-interaction-end', mobileRefreshForceReplay);
    }
  }

  function isMobileReflowTextScale() {
    return textScaleMode === 'mobile-reflow';
  }

  function isMobileReflowAdaptiveLayout() {
    return isMobileReflowTextScale() && mobileReflowLayout === 'adaptive';
  }

  function isMobileReflowSnapshotLayout() {
    return isMobileReflowTextScale() && mobileReflowLayout === 'snapshot';
  }

  function isMobileReflowProjectionLayout() {
    return isMobileReflowAdaptiveLayout() || isMobileReflowSnapshotLayout();
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

  function clearMobileSnapshotRefreshTimer() {
    if (mobileSnapshotRefreshTimer !== null) {
      clearTimeout(mobileSnapshotRefreshTimer);
      mobileSnapshotRefreshTimer = null;
    }
  }

  function resetMobileWriteState() {
    mobileWriteQueue = [];
    mobileWritesDraining = false;
    mobileProjectionDirty = false;
    mobileRefreshRequested = false;
    mobileRefreshForceReplay = false;
    mobileSourceSwitching = false;
    mobileControlSequenceState = 'ground';
    mobileProjectedContentRows = 0;
    mobileCarriageReturnPending = false;
    mobileSnapshotBuildToken++;
    mobileSnapshotBuildInFlight = false;
    mobileSnapshotPendingReason = '';
    mobileSnapshotBuildOldLayout = '';
    mobileSourceRevision = 0;
    mobileSnapshotProjectionPlan = null;
    mobileSnapshotRefreshDeferredForInteraction = false;
    mobileAdaptiveRefreshDeferredForInteraction = false;
    clearMobileRefreshTimer();
    clearMobileSnapshotRefreshTimer();
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

  function createMobileProjectionTerminal(cols, rows, targetSurface) {
    var projection = createMobileTerminal(cols, rows, currentTextScale, 30000);
    projection.open(targetSurface || surface);
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

  function untrackRetiredTerminalReplacement(oldTerm, oldSurface) {
    mobileRetiredSurfaces = mobileRetiredSurfaces.filter(function(candidate) {
      return candidate !== oldSurface;
    });
    mobileRetiredTerms = mobileRetiredTerms.filter(function(candidate) {
      return candidate !== oldTerm;
    });
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

  function mobileSourceLineTextEnd(line, startCol) {
    if (!line || !mobileSourceTerm) return startCol;
    for (var col = mobileSourceTerm.cols - 1; col >= startCol; col--) {
      var cell = line.getCell(col);
      if (!cell || cell.getWidth() === 0) continue;
      if (cell.getChars()) return col + Math.max(1, cell.getWidth());
    }
    return startCol;
  }

  function mobileSourceLinePlainText(line, startCol) {
    var endCol = mobileSourceLineTextEnd(line, startCol);
    var text = '';
    for (var col = startCol; col < endCol; col++) {
      var cell = line.getCell(col);
      if (!cell || cell.getWidth() === 0) continue;
      text += cell.getChars() || ' ';
    }
    return { text: text, endCol: endCol };
  }

  function mobileSourceCellText(line, col) {
    if (!line) return '';
    var cell = line.getCell(col);
    return cell && cell.getWidth() !== 0 ? cell.getChars() : '';
  }

  function mobileSourceCellIsBlank(line, col) {
    var text = mobileSourceCellText(line, col);
    return text === '' || text === ' ';
  }

  function mobileSourceCellHasAttributes(line, col) {
    if (!line) return false;
    var cell = line.getCell(col);
    try {
      return !!(cell && cell.isAttributeDefault && !cell.isAttributeDefault());
    } catch (e) {
      return false;
    }
  }

  function findMobileCodexActivePromptRow(buffer) {
    if (!buffer || !mobileSourceTerm) return -1;
    var cursorRow = (buffer.baseY || 0) + (buffer.cursorY || 0);
    var firstSearchRow = Math.max(0, cursorRow - Math.max(1, mobileSourceTerm.rows));
    for (var promptRow = cursorRow; promptRow >= firstSearchRow; promptRow--) {
      var promptLine = buffer.getLine(promptRow);
      var prompt = mobileSourceCellText(promptLine, 0);
      if (
        !promptLine ||
        promptLine.isWrapped ||
        (prompt !== '\u203a' && prompt !== '!') ||
        !mobileSourceCellIsBlank(promptLine, 1)
      ) {
        continue;
      }
      var reachesCursor = true;
      for (var row = promptRow + 1; row <= cursorRow; row++) {
        var continuation = buffer.getLine(row);
        if (
          !continuation ||
          continuation.isWrapped ||
          !mobileSourceCellIsBlank(continuation, 0) ||
          !mobileSourceCellIsBlank(continuation, 1)
        ) {
          reachesCursor = false;
          break;
        }
      }
      if (reachesCursor) return promptRow;
    }
    return -1;
  }

  function mobileCodexRowText(line, startCol) {
    return mobileSourceLinePlainText(line, startCol).text;
  }

  function mobileCodexRowHasTranscriptPrefix(line) {
    var first = mobileSourceCellText(line, 0);
    return (
      ((first === '\u203a' || first === '!' || first === '\u2022') &&
        mobileSourceCellIsBlank(line, 1)) ||
      (mobileSourceCellIsBlank(line, 0) && mobileSourceCellIsBlank(line, 1))
    );
  }

  function mobileCodexRowStartsOutputBlock(line) {
    return (
      mobileSourceCellText(line, 0) === '\u2022' &&
      mobileSourceCellIsBlank(line, 1) &&
      mobileSourceCellHasAttributes(line, 0)
    );
  }

  function mobileCodexRowStartsStructure(line) {
    var text = mobileCodexRowText(line, 2).trim();
    if (!text) return true;
    if (/^[\u2500-\u257f]/.test(text)) return true;
    if (/^(?:[-*+>]|#{1,6})\s/.test(text)) return true;
    if (/^\d+[.)]\s/.test(text)) return true;
    return false;
  }

  function mobileCodexRowIsRule(line) {
    var text = mobileCodexRowText(line, 2).trim();
    var compact = text.replace(/\s/g, '');
    if (compact.length < 4) return false;
    var structuralCount = 0;
    for (var index = 0; index < compact.length; index++) {
      if (/[-_=\u2500-\u257f]/.test(compact.charAt(index))) structuralCount++;
    }
    return structuralCount / compact.length >= 0.6;
  }

  function mobileCodexHardWrapSkip(previousLine, line) {
    if (
      !previousLine ||
      !line ||
      previousLine.isWrapped ||
      line.isWrapped ||
      !mobileCodexRowHasTranscriptPrefix(previousLine) ||
      !mobileSourceCellIsBlank(line, 0) ||
      !mobileSourceCellIsBlank(line, 1) ||
      mobileCodexRowIsRule(previousLine) ||
      mobileCodexRowStartsStructure(line) ||
      mobileCodexRowIsRule(line)
    ) {
      return 0;
    }
    var previousEnd = mobileSourceLineTextEnd(previousLine, 0);
    var maxSlack = Math.min(
      MOBILE_CODEX_HARD_WRAP_MAX_SLACK,
      Math.max(4, Math.floor(mobileSourceTerm.cols / 8))
    );
    var slack = Math.max(0, mobileSourceTerm.cols - previousEnd);
    if (previousEnd < mobileSourceTerm.cols - maxSlack) return 0;

    // Codex word wrapping removes the separator before drawing the next
    // physical row. Keep one of its two layout blanks only when a non-full
    // ASCII prose row proves that a word-boundary space was consumed.
    var previousText = mobileCodexRowText(previousLine, 0).trimEnd();
    var nextText = mobileCodexRowText(line, 2).trimStart();
    var restoresWordSpace =
      slack > 0 &&
      /[A-Za-z0-9,.;:!?)]$/.test(previousText) &&
      /^[A-Za-z0-9([]/.test(nextText);
    return restoresWordSpace ? 1 : 2;
  }

  function findMobileCodexComposerProjectionPlan(buffer) {
    var inputText = mobileLiveInputText;
    if (
      !buffer ||
      !mobileSourceTerm ||
      typeof inputText !== 'string' ||
      inputText.length === 0 ||
      inputText.indexOf('\r') !== -1 ||
      inputText.indexOf('\n') !== -1
    ) {
      return null;
    }
    var cursorRow = (buffer.baseY || 0) + (buffer.cursorY || 0);
    var cursorCol = buffer.cursorX || 0;
    var promptRow = findMobileCodexActivePromptRow(buffer);
    if (promptRow < 0) return null;
    // Codex draws a logical textarea as independent desktop-grid rows. Only
    // join them when the mobile input field proves the complete text and the
    // source cursor proves that the matched block is the active composer.
    var promptLine = buffer.getLine(promptRow);
    var prompt = mobileSourceCellText(promptLine, 0);
    var expectedText = prompt === '!' && inputText.charAt(0) === '!'
      ? inputText.slice(1)
      : inputText;
    var joinedText = '';
    var rowSkips = {};
    var lastCandidateRow = Math.min(
      buffer.length - 1,
      promptRow + Math.max(1, mobileSourceTerm.rows) - 1
    );
    for (var row = promptRow; row <= lastCandidateRow; row++) {
      var line = buffer.getLine(row);
      if (
        !line ||
        line.isWrapped ||
        (row > promptRow &&
          (!mobileSourceCellIsBlank(line, 0) || !mobileSourceCellIsBlank(line, 1)))
      ) {
        break;
      }
      var lineText = mobileSourceLinePlainText(line, 2);
      if (
        row > promptRow &&
        expectedText.charAt(joinedText.length) === ' ' &&
        expectedText.slice(joinedText.length + 1, joinedText.length + 1 + lineText.text.length) ===
          lineText.text
      ) {
        joinedText += ' ';
        rowSkips[row] = 1;
      } else if (row > promptRow) {
        rowSkips[row] = 2;
      }
      joinedText += lineText.text;
      if (expectedText.slice(0, joinedText.length) !== joinedText) break;
      if (joinedText !== expectedText) continue;
      if (
        row > promptRow &&
        row === cursorRow &&
        cursorCol === lineText.endCol
      ) {
        return {
          startRow: promptRow,
          endRow: row,
          rowSkips: rowSkips,
          sourceRevision: mobileSourceRevision
        };
      }
      if (row >= cursorRow) break;
    }
    return null;
  }

  function findMobileCodexSnapshotProjectionPlan(buffer) {
    if (!buffer || !mobileSourceTerm) return null;
    var promptRow = findMobileCodexActivePromptRow(buffer);
    if (promptRow < 0) return null;
    var cursorRow = (buffer.baseY || 0) + (buffer.cursorY || 0);
    var composerPlan = findMobileCodexComposerProjectionPlan(buffer);
    var rowSkips = {};
    var hasRows = false;
    if (composerPlan) {
      for (
        var composerRow = composerPlan.startRow + 1;
        composerRow <= composerPlan.endRow;
        composerRow++
      ) {
        rowSkips[composerRow] = composerPlan.rowSkips[composerRow] || 2;
        hasRows = true;
      }
    }
    var composerHasExplicitNewline =
      mobileLiveInputText.indexOf('\r') !== -1 || mobileLiveInputText.indexOf('\n') !== -1;
    var inOutputBlock = false;
    for (var row = 1; row < buffer.length; row++) {
      var previousLine = buffer.getLine(row - 1);
      var previousPrefix = mobileSourceCellText(previousLine, 0);
      if (mobileCodexRowStartsOutputBlock(previousLine)) {
        inOutputBlock = true;
      } else if (previousPrefix === '\u203a' || previousPrefix === '!') {
        inOutputBlock = false;
      }
      if (rowSkips[row]) continue;
      var inActiveComposer = row > promptRow && row <= cursorRow;
      if (composerHasExplicitNewline && inActiveComposer) continue;
      if (!inActiveComposer && !inOutputBlock) continue;
      var skip = mobileCodexHardWrapSkip(previousLine, buffer.getLine(row));
      if (skip > 0) {
        rowSkips[row] = skip;
        hasRows = true;
      }
    }
    return hasRows
      ? { rowSkips: rowSkips, sourceRevision: mobileSourceRevision }
      : null;
  }

  function mobileSnapshotRowSkip(plan, row) {
    if (!plan) return 0;
    if (plan.rowSkips && plan.rowSkips[row]) return plan.rowSkips[row];
    return row > plan.startRow && row <= plan.endRow ? 2 : 0;
  }

  function mobileSnapshotProjectionLine(buffer, line, row, plan) {
    var skip = mobileSnapshotRowSkip(plan, row);
    if (!line || skip === 0) return line;
    var cols = mobileSourceTerm.cols;
    return {
      isWrapped: true,
      length: cols,
      getCell: function(col, reusableCell) {
        if (col >= 0 && col + skip < cols) {
          return line.getCell(col + skip, reusableCell);
        }
        return buffer.getNullCell();
      },
      translateToString: function(trimRight, startCol, endCol) {
        var start = Math.max(0, startCol || 0) + skip;
        var end = typeof endCol === 'number'
          ? Math.min(cols, endCol + skip)
          : cols;
        return line.translateToString(trimRight, start, end);
      }
    };
  }

  function mobileSnapshotProjectionBuffer(buffer, plan) {
    if (!plan) return buffer;
    // SerializeAddon reads this facade; the canonical source lines are never
    // mutated. Continuations lose Codex's layout columns and advertise a soft
    // boundary; word wraps retain one blank when Codex consumed a separator.
    return {
      type: buffer.type,
      length: buffer.length,
      baseY: buffer.baseY,
      viewportY: buffer.viewportY,
      cursorX: Math.max(
        0,
        (buffer.cursorX || 0) - mobileSnapshotRowSkip(
          plan,
          (buffer.baseY || 0) + (buffer.cursorY || 0)
        )
      ),
      cursorY: buffer.cursorY,
      getNullCell: function() { return buffer.getNullCell(); },
      getLine: function(row) {
        return mobileSnapshotProjectionLine(buffer, buffer.getLine(row), row, plan);
      }
    };
  }

  function mobileProjectedCursorWithinLine(
    line,
    sourceCursorCol,
    targetRow,
    targetCol,
    targetCols
  ) {
    var sourceLimit = Math.min(mobileSourceTerm.cols, Math.max(0, sourceCursorCol));
    for (var col = 0; col < sourceLimit; col++) {
      var cell = line.getCell(col);
      if (!cell || cell.getWidth() === 0) continue;
      var width = Math.max(1, cell.getWidth());
      if (targetCol + width > targetCols) {
        targetRow++;
        targetCol = 0;
      }
      targetCol += width;
    }
    return {
      contentRow: targetRow,
      col: Math.max(0, Math.min(targetCols - 1, targetCol))
    };
  }

  function configureMobileSnapshotCursor(targetTerm, projectedCursor) {
    if (!targetTerm) return;
    // The projection's parser ends at the final serialized status row. Hide
    // that synthetic xterm cursor and render the mapped source cursor instead.
    targetTerm.options.cursorInactiveStyle = 'none';
    targetTerm.__mobileSnapshotCursor = projectedCursor;
  }

  function mobileSourceCanUseAdaptiveLayout() {
    return (
      mobileControlSequenceState === 'ground' &&
      !mobileCarriageReturnPending &&
      !mobileSourceHasCustomScreenState() &&
      mobileSourceCursorIsAtContentEnd()
    );
  }

  function mobileSourceRequiresExactGrid() {
    return mobileSourceMouseTrackingMode() !== 'none';
  }

  function canBuildMobileSnapshotProjection() {
    return !!(
      mobileSourceTerm &&
      mobileSourceSerializeAddon &&
      typeof mobileSourceSerializeAddon._serializeBufferByRange === 'function' &&
      !mobileSourceRequiresExactGrid()
    );
  }

  function serializeMobileSnapshotProjection() {
    if (!canBuildMobileSnapshotProjection()) return null;
    var source = mobileSourceTerm;
    var buffer = source.buffer && source.buffer.active;
    if (!buffer || buffer.length <= 0) return '';
    // The pinned SerializeAddon has no public active-buffer-only API. Its range
    // serializer is bundled with this WebView and avoids replaying desktop modes
    // or the final desktop cursor move into the phone-width projection.
    var plan = findMobileCodexSnapshotProjectionPlan(buffer);
    mobileSnapshotProjectionPlan = plan;
    var serialized = mobileSourceSerializeAddon._serializeBufferByRange(
      source,
      mobileSnapshotProjectionBuffer(buffer, plan),
      { start: 0, end: buffer.length - 1 },
      true
    );
    return makeMobileSerializedProjectionReflowSafe(serialized);
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

  function collectMobileProjectedOscLinks(targetCols, cursorTargetTerm) {
    var source = mobileSourceTerm;
    var service = mobileSourceOscLinkService();
    mobileProjectedContentRows = 0;
    if (!source || targetCols <= 0) return [];
    var buffer = isMobileReflowSnapshotLayout()
      ? source.buffer.active
      : source.buffer.normal;
    var links = [];
    var targetRow = 0;
    var targetCol = 0;
    var active = null;
    var projectedCursor = null;
    var projectedBgMode = 0;
    var projectedBgColor = -1;
    var projectionPlan = isMobileReflowSnapshotLayout() &&
      mobileSnapshotProjectionPlan &&
      mobileSnapshotProjectionPlan.sourceRevision === mobileSourceRevision
      ? mobileSnapshotProjectionPlan
      : null;

    function closeActive() {
      if (active && active.endCol > active.startCol) links.push(active);
      active = null;
    }

    function prepareProjectedCell(width) {
      if (targetCol + width > targetCols) {
        closeActive();
        targetRow++;
        targetCol = 0;
      }
    }

    function advanceProjectedCell(width) {
      prepareProjectedCell(width);
      targetCol += width;
    }

    function advanceProjectedBlanks(width) {
      for (var index = 0; index < width; index++) {
        advanceProjectedCell(1);
      }
    }

    function updateProjectedBackground(cell) {
      var mode = 0;
      var color = -1;
      try {
        mode = cell && cell.getBgColorMode ? cell.getBgColorMode() : 0;
        color = cell && cell.getBgColor ? cell.getBgColor() : -1;
      } catch (e) {}
      var changed = mode !== projectedBgMode || color !== projectedBgColor;
      projectedBgMode = mode;
      projectedBgColor = color;
      return changed;
    }

    var cursorRow = (buffer.baseY || 0) + (buffer.cursorY || 0);
    var lastSourceRow = Math.min(buffer.length - 1, cursorRow);
    for (var candidateRow = buffer.length - 1; candidateRow > lastSourceRow; candidateRow--) {
      var candidateLine = mobileSnapshotProjectionLine(
        buffer,
        buffer.getLine(candidateRow),
        candidateRow,
        projectionPlan
      );
      if (mobileSourceLineContentEnd(candidateLine) > 0) {
        lastSourceRow = candidateRow;
        break;
      }
    }
    for (var row = 0; row <= lastSourceRow; row++) {
      var line = mobileSnapshotProjectionLine(
        buffer,
        buffer.getLine(row),
        row,
        projectionPlan
      );
      if (!line) continue;
      if (row > 0 && !line.isWrapped) {
        closeActive();
        targetRow++;
        targetCol = 0;
      }
      if (cursorTargetTerm && row === cursorRow) {
        projectedCursor = mobileProjectedCursorWithinLine(
          line,
          Math.max(
            0,
            (buffer.cursorX || 0) - mobileSnapshotRowSkip(projectionPlan, row)
          ),
          targetRow,
          targetCol,
          targetCols
        );
      }
      var lineLength = mobileSourceLineContentEnd(line);
      var scanEnd = Math.min(mobileSourceTerm.cols, lineLength + 1);
      // SerializeAddon advances blank runs only when later content or a
      // background transition flushes them. Its trailing CSI X erases cells
      // without moving the projection cursor.
      var pendingBlankWidth = 0;
      for (var col = 0; col < scanEnd; col++) {
        var cell = line.getCell(col);
        if (!cell || cell.getWidth() === 0) continue;
        var width = Math.max(1, cell.getWidth());
        var backgroundChanged = updateProjectedBackground(cell);
        var chars = cell.getChars();
        if (!chars) {
          if (backgroundChanged) {
            advanceProjectedBlanks(pendingBlankWidth);
            pendingBlankWidth = 0;
          }
          closeActive();
          pendingBlankWidth += width;
          continue;
        }
        advanceProjectedBlanks(pendingBlankWidth);
        pendingBlankWidth = 0;
        prepareProjectedCell(width);
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
    if (cursorTargetTerm) {
      configureMobileSnapshotCursor(cursorTargetTerm, projectedCursor);
    }
    return links;
  }

  function setMobileLiveInputText(text) {
    var nextText = typeof text === 'string' ? text : '';
    if (nextText === mobileLiveInputText) return;
    mobileLiveInputText = nextText;
    var buffer = mobileSourceTerm && mobileSourceTerm.buffer
      ? mobileSourceTerm.buffer.active
      : null;
    if (
      isMobileReflowSnapshotLayout() &&
      (nextText.length === 0 || findMobileCodexActivePromptRow(buffer) >= 0)
    ) {
      scheduleMobileSnapshotProjection('live-input-text');
    }
  }

  function readMobileSimpleCsi(data, index) {
    var cursor;
    if (data.charCodeAt(index) === 0x1b && data.charAt(index + 1) === '[') {
      cursor = index + 2;
    } else if (data.charCodeAt(index) === 0x9b) {
      cursor = index + 1;
    } else {
      return null;
    }
    var paramsStart = cursor;
    while (cursor < data.length) {
      var code = data.charCodeAt(cursor);
      if (code < 0x30 || code > 0x39) break;
      cursor++;
    }
    if (cursor >= data.length) return null;
    var finalCode = data.charCodeAt(cursor);
    if (finalCode < 0x40 || finalCode > 0x7e) return null;
    return {
      end: cursor + 1,
      final: data.charAt(cursor),
      params: data.slice(paramsStart, cursor)
    };
  }

  function mobileSimpleCsiCount(token) {
    if (!token || token.params === '') return 1;
    return parseInt(token.params, 10);
  }

  function mobileSimpleCsiMatches(token, final, count) {
    return !!token && token.final === final && mobileSimpleCsiCount(token) === count;
  }

  function matchMobileSerializerSoftWrapRepair(data, index) {
    var cursor = index;
    while (data.charAt(cursor) === '-') cursor++;
    var blankCount = cursor - index - 1;
    if (blankCount < 0) return null;
    var cursorLeft = readMobileSimpleCsi(data, cursor);
    if (!mobileSimpleCsiMatches(cursorLeft, 'D', 1)) return null;
    cursor = cursorLeft.end;
    var eraseDash = readMobileSimpleCsi(data, cursor);
    if (!mobileSimpleCsiMatches(eraseDash, 'X', 1)) return null;
    cursor = eraseDash.end;
    if (blankCount === 0) return { end: cursor, blankCount: 0 };
    var cursorUp = readMobileSimpleCsi(data, cursor);
    if (!mobileSimpleCsiMatches(cursorUp, 'A', 1)) return null;
    cursor = cursorUp.end;
    var sourceAdvance = mobileSourceCols - blankCount;
    var cursorForward = readMobileSimpleCsi(data, cursor);
    if (!mobileSimpleCsiMatches(cursorForward, 'C', sourceAdvance)) return null;
    cursor = cursorForward.end;
    var eraseBlanks = readMobileSimpleCsi(data, cursor);
    if (!mobileSimpleCsiMatches(eraseBlanks, 'X', blankCount)) return null;
    cursor = eraseBlanks.end;
    var cursorBack = readMobileSimpleCsi(data, cursor);
    if (!mobileSimpleCsiMatches(cursorBack, 'D', sourceAdvance)) return null;
    cursor = cursorBack.end;
    var cursorDown = readMobileSimpleCsi(data, cursor);
    if (!mobileSimpleCsiMatches(cursorDown, 'B', 1)) return null;
    return { end: cursorDown.end, blankCount: blankCount };
  }

  function removeTrailingMobileErase(data, count) {
    var escErase = '\x1b[' + count + 'X';
    if (data.slice(-escErase.length) === escErase) {
      return data.slice(0, -escErase.length);
    }
    var c1Erase = '\x9b' + count + 'X';
    return data.slice(-c1Erase.length) === c1Erase
      ? data.slice(0, -c1Erase.length)
      : data;
  }

  function makeMobileSerializedProjectionReflowSafe(serialized) {
    if (typeof serialized !== 'string' || serialized.length === 0) return '';
    serialized = serialized
      .replace(/\x1b\[\?25l/g, '\x1b[?25h')
      .replace(/\x9b\?25l/g, '\x1b[?25h');
    var result = '';
    var index = 0;
    while (index < serialized.length) {
      if (serialized.charAt(index) === '-') {
        var repair = matchMobileSerializerSoftWrapRepair(serialized, index);
        if (repair) {
          if (repair.blankCount > 0) {
            result = removeTrailingMobileErase(result, repair.blankCount);
          }
          index = repair.end;
          continue;
        }
      }
      var token = readMobileSimpleCsi(serialized, index);
      if (token && token.final === 'C') {
        var count = mobileSimpleCsiCount(token);
        if (!isFinite(count) || count <= 0) count = 1;
        result += ' '.repeat(Math.min(mobileSourceCols, count));
        index = token.end;
        continue;
      }
      result += serialized.charAt(index);
      index++;
    }
    return result;
  }

  function mobileProjectionDimensionsForTerm(targetTerm) {
    var cell = null;
    try {
      var core = targetTerm && targetTerm._core;
      cell = core && core._renderService && core._renderService.dimensions
        ? core._renderService.dimensions.css.cell
        : null;
    } catch (e) {}
    var cellW = cell && cell.width ? cell.width : 0;
    var cellH = cell && cell.height ? cell.height : 0;
    if (cellW <= 0 || cellH <= 0) return null;
    return {
      cols: Math.max(MIN_FIT_COLS, Math.floor(window.innerWidth / cellW)),
      rows: Math.max(8, Math.floor(window.innerHeight / cellH))
    };
  }

  function mobileProjectionDimensions() {
    return mobileProjectionDimensionsForTerm(term);
  }

  function waitForMobileProjectionDimensions(targetTerm, callback) {
    var attempts = 0;
    function attempt() {
      attempts++;
      var dimensions = mobileProjectionDimensionsForTerm(targetTerm);
      if (dimensions || attempts >= FIT_RETRY_MAX_FRAMES) {
        callback(dimensions);
        return;
      }
      requestAnimationFrame(attempt);
    }
    requestAnimationFrame(attempt);
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
      emitHistoryMetrics();
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
    var projectionLayout = mobileReflowLayout;
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
      initialOscLinks = collectMobileProjectedOscLinks(
        dimensions.cols,
        projectionLayout === 'snapshot' ? term : null
      );
      mobileSourceTerm.options.scrollback = projectionLayout === 'adaptive'
        ? MOBILE_REFLOW_SOURCE_SCROLLBACK
        : 30000;
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
          mobileLayout: projectionLayout,
          sourceCols: mobileSourceCols,
          sourceRows: mobileSourceRows
        });
      });
    }
    requestAnimationFrame(waitForDimensions);
  }

  function mobileProjectionScrollAnchor(targetTerm) {
    var buffer = targetTerm && targetTerm.buffer && targetTerm.buffer.active;
    if (!buffer) return -1;
    return Math.max(0, (buffer.baseY || 0) - (buffer.viewportY || 0));
  }

  function restoreMobileProjectionScroll(targetTerm, anchorRows) {
    if (anchorRows <= 0 || !targetTerm || !targetTerm.buffer || !targetTerm.buffer.active) return;
    var buffer = targetTerm.buffer.active;
    try {
      targetTerm.scrollToLine(Math.max(0, (buffer.baseY || 0) - anchorRows));
    } catch (e) {}
  }

  function discardMobileSnapshotReplacement(
    token,
    gen,
    nextTerm,
    nextSurface,
    oldTerm,
    oldSurface,
    oldLayout,
    error
  ) {
    var replacementWasCurrent = term === nextTerm;
    try { if (nextTerm) nextTerm.dispose(); } catch (e) {}
    if (nextSurface && nextSurface !== oldSurface) nextSurface.remove();

    if (token !== mobileSnapshotBuildToken) {
      // A clear/re-init invalidates the build generation. Only restore the old
      // projection when this callback is still in the same terminal generation;
      // a newer init owns the shared term/surface variables.
      if (gen === terminalGeneration && replacementWasCurrent) {
        term = oldTerm;
        surface = oldSurface;
        mobileReflowLayout = oldLayout;
        if (oldSurface && !document.getElementById('terminal-surface')) {
          oldSurface.id = 'terminal-surface';
        }
        ready = true;
        attachTermObservers();
      }
      return;
    }
    untrackRetiredTerminalReplacement(oldTerm, oldSurface);
    term = oldTerm;
    surface = oldSurface;
    mobileReflowLayout = oldLayout;
    mobileSnapshotBuildOldLayout = '';
    if (oldSurface && !document.getElementById('terminal-surface')) {
      oldSurface.id = 'terminal-surface';
    }
    mobileSnapshotBuildInFlight = false;
    ready = true;
    if (replacementWasCurrent) attachTermObservers();
    if (error) {
      reportEngineError('mobile snapshot projection failed', error, false);
      if (oldLayout !== 'source') {
        switchMobileToSourceLayout('snapshot-build-failed');
      }
      return;
    }
    if (mobileSnapshotPendingReason) {
      scheduleMobileSnapshotProjection(mobileSnapshotPendingReason);
    }
  }

  function scheduleMobileSnapshotProjection(reason) {
    if (!isMobileReflowTextScale() || !canBuildMobileSnapshotProjection()) return false;
    mobileSnapshotPendingReason = reason || mobileSnapshotPendingReason || 'source-update';
    if (mobileViewportInteractionActive()) return true;
    if (mobileSnapshotBuildInFlight || mobileSnapshotRefreshTimer !== null) return true;
    mobileSnapshotRefreshTimer = setTimeout(function() {
      mobileSnapshotRefreshTimer = null;
      rebuildMobileSnapshotProjection(mobileSnapshotPendingReason || 'source-update');
    }, MOBILE_REFLOW_REFRESH_DELAY_MS);
    return true;
  }

  function rebuildMobileSnapshotProjection(reason) {
    if (
      !isMobileReflowTextScale() ||
      mobileSnapshotBuildInFlight ||
      !canBuildMobileSnapshotProjection() ||
      !term ||
      !surface ||
      mobileViewportInteractionActive()
    ) {
      return;
    }
    var serialized;
    try {
      serialized = serializeMobileSnapshotProjection();
    } catch (e) {
      reportEngineError('mobile snapshot serialization failed', e, false);
      switchMobileToSourceLayout('snapshot-serialization-failed');
      return;
    }
    if (serialized === null) return;
    mobileSnapshotBuildInFlight = true;
    mobileSnapshotPendingReason = '';
    var token = ++mobileSnapshotBuildToken;
    var gen = terminalGeneration;
    var sourceRevision = mobileSourceRevision;
    var oldTerm = term;
    var oldSurface = surface;
    var oldLayout = mobileReflowLayout;
    mobileSnapshotBuildOldLayout = oldLayout;
    var scrollAnchorRows = mobileProjectionScrollAnchor(oldTerm);
    var dimensions = null;
    var nextSurface = null;
    var nextTerm = null;
    try {
      nextSurface = prepareMobileReplacementSurface(oldTerm, oldSurface);
      nextTerm = createMobileProjectionTerminal(
        Math.max(MIN_FIT_COLS, oldTerm.cols || 80),
        Math.max(8, oldTerm.rows || 24),
        nextSurface
      );
      waitForMobileProjectionDimensions(nextTerm, function(measuredDimensions) {
        if (token !== mobileSnapshotBuildToken || gen !== terminalGeneration) {
          discardMobileSnapshotReplacement(
            token,
            gen,
            nextTerm,
            nextSurface,
            oldTerm,
            oldSurface,
            oldLayout,
            null
          );
          return;
        }
        if (!measuredDimensions) {
          discardMobileSnapshotReplacement(
            token,
            gen,
            nextTerm,
            nextSurface,
            oldTerm,
            oldSurface,
            oldLayout,
            new Error('target font metrics unavailable')
          );
          return;
        }
        dimensions = measuredDimensions;
        try {
          nextTerm.resize(dimensions.cols, dimensions.rows);
          nextTerm.write(serialized, function() {
            if (token !== mobileSnapshotBuildToken || gen !== terminalGeneration) {
              discardMobileSnapshotReplacement(
                token,
                gen,
                nextTerm,
                nextSurface,
                oldTerm,
                oldSurface,
                oldLayout,
                null
              );
              return;
            }
            if (mobileViewportInteractionActive()) {
              mobileSnapshotPendingReason = reason || 'viewport-interaction';
              discardMobileSnapshotReplacement(
                token,
                gen,
                nextTerm,
                nextSurface,
                oldTerm,
                oldSurface,
                oldLayout,
                null
              );
              return;
            }
            try {
              var latestViewportY = oldTerm && oldTerm.buffer && oldTerm.buffer.active
                ? Math.max(0, oldTerm.buffer.active.viewportY || 0)
                : 0;
              disposeTermObservers();
              term = nextTerm;
              surface = nextSurface;
              mobileReflowLayout = 'snapshot';
              initRows = dimensions.rows;
              initialOscLinks = collectMobileProjectedOscLinks(dimensions.cols, nextTerm);
              mobileSourceTerm.options.scrollback = 30000;
              if (autoScrollDisabled) {
                try { nextTerm.scrollToLine(latestViewportY); } catch (e) {}
              } else {
                try { nextTerm.scrollToBottom(); } catch (e) {}
              }
              initialOscLinkRowOffset = Math.max(
                0,
                mobileProjectedContentRows - (nextTerm.buffer.normal.length || 0)
              );
              captureInitialOscLinkTexts();
              initialOscLinkEvictionReady = true;
              applyFitScale('mobile-snapshot-' + reason, function() {
                if (token !== mobileSnapshotBuildToken || gen !== terminalGeneration) return;
                nextSurface.style.visibility = 'visible';
                nextSurface.style.position = '';
                nextSurface.style.left = '';
                nextSurface.style.top = '';
                disposeMobileRetiredReplacements(nextTerm, nextSurface);
                mobileSnapshotBuildInFlight = false;
                mobileSnapshotBuildOldLayout = '';
                mobileProjectionDirty = false;
                ready = true;
                attachTermObservers();
                emitKeyboardAvoidanceMetrics();
                emitDiagnostic('mobile-reflow-layout', {
                  layout: 'snapshot',
                  reason: reason,
                  sourceRevision: sourceRevision
                });
                pumpMobileWrites();
                if (mobileSourceRevision !== sourceRevision || mobileSnapshotPendingReason) {
                  scheduleMobileSnapshotProjection(
                    mobileSnapshotPendingReason || 'source-updated-during-build'
                  );
                }
              });
            } catch (e) {
              discardMobileSnapshotReplacement(
                token,
                gen,
                nextTerm,
                nextSurface,
                oldTerm,
                oldSurface,
                oldLayout,
                e
              );
            }
          });
        } catch (e) {
          discardMobileSnapshotReplacement(
            token,
            gen,
            nextTerm,
            nextSurface,
            oldTerm,
            oldSurface,
            oldLayout,
            e
          );
        }
      });
    } catch (e) {
      discardMobileSnapshotReplacement(
        token,
        gen,
        nextTerm,
        nextSurface,
        oldTerm,
        oldSurface,
        oldLayout,
        e
      );
    }
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
        if (!mobileSourceSerializeAddon || mobileSourceRequiresExactGrid()) {
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
        var serialized;
        if (mobileSourceCanUseAdaptiveLayout()) {
          serialized = mobileSourceSerializeAddon.serialize({
            excludeAltBuffer: true,
            excludeModes: false
          });
          serialized = makeMobileSerializedProjectionReflowSafe(serialized);
          mobileReflowLayout = 'adaptive';
        } else {
          try {
            serialized = serializeMobileSnapshotProjection();
          } catch (e) {
            reportEngineError('mobile snapshot serialization failed', e, false);
            openMobileSourceAsVisible(
              gen,
              oldTerm,
              oldSurface,
              replayData.length,
              preserveScroll,
              preserveFullInitialData,
              'snapshot-error'
            );
            return;
          }
          if (serialized === null) {
            openMobileSourceAsVisible(
              gen,
              oldTerm,
              oldSurface,
              replayData.length,
              preserveScroll,
              preserveFullInitialData,
              'snapshot-unavailable'
            );
            return;
          }
          mobileReflowLayout = 'snapshot';
        }
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
      emitDiagnostic('mobile-reflow-dirty', { reason: reason });
    }
  }

  function requestMobileProjectionRefresh(reason, forceReplay) {
    if (!isMobileReflowTextScale() || mobileRefreshRequested) return;
    mobileRefreshForceReplay = mobileRefreshForceReplay || forceReplay === true;
    if (mobileViewportInteractionActive()) {
      markMobileProjectionDirty(reason + '-deferred');
      return;
    }
    clearMobileRefreshTimer();
    mobileRefreshTimer = setTimeout(function() {
      mobileRefreshTimer = null;
      if (!isMobileReflowTextScale() || mobileRefreshRequested) return;
      var shouldForceReplay = mobileRefreshForceReplay;
      mobileRefreshForceReplay = false;
      if (!shouldForceReplay && !mobileSourceCanUseAdaptiveLayout()) {
        if (!scheduleMobileSnapshotProjection(reason + '-snapshot')) {
          switchMobileToSourceLayout(reason + '-unstable');
        }
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
    if (!mobileSourceCanUseAdaptiveLayout()) {
      if (!scheduleMobileSnapshotProjection(reason + '-snapshot')) {
        switchMobileToSourceLayout(reason + '-fallback');
      }
      return;
    }
    requestMobileProjectionRefresh(reason);
  }

  function handleMobileSourceBatch(data, safe) {
    emitModesIfChanged();
    if (mobileReflowLayout === 'source') {
      if (!autoScrollDisabled && term) {
        try { term.scrollToBottom(); } catch (e) {}
      }
      if (mobileSourceCanUseAdaptiveLayout()) requestMobileProjectionRefresh('source-stable');
      return;
    }
    if (mobileReflowLayout === 'snapshot') {
      if (mobileSourceRequiresExactGrid()) {
        switchMobileToSourceLayout('snapshot-exact-grid-required');
      } else if (mobileSourceCanUseAdaptiveLayout()) {
        requestMobileProjectionRefresh('snapshot-source-stable');
      } else {
        scheduleMobileSnapshotProjection('snapshot-source-update');
      }
      return;
    }
    if (mobileReflowLayout !== 'adaptive') return;
    if (mobileControlSequenceState !== 'ground' || mobileCarriageReturnPending) {
      markMobileProjectionDirty('partial-control-sequence');
      return;
    }
    if (!mobileSourceCanUseAdaptiveLayout()) {
      if (!scheduleMobileSnapshotProjection('source-grid-required')) {
        switchMobileToSourceLayout('source-grid-required');
      }
      return;
    }
    if (safe && !mobileProjectionDirty && !mobileRefreshRequested && term) {
      term.write(data, function() {
        if (!autoScrollDisabled && term) {
          try { term.scrollToBottom(); } catch (e) {}
        }
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
      mobileSourceRevision++;
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
    if (mobileReflowLayout === 'snapshot') {
      scheduleMobileSnapshotProjection(reason);
      return;
    }
    markMobileProjectionDirty(reason);
    requestMobileProjectionRefresh(reason, true);
  }

  function resizeMobileProjectionForViewport(reason) {
    if (!isMobileReflowProjectionLayout() || !term) return false;
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
    if (mobileSnapshotBuildInFlight && term && surface) {
      var replacementTerm = term;
      var replacementSurface = surface;
      var previousTerm = mobileRetiredTerms[mobileRetiredTerms.length - 1];
      var previousSurface = mobileRetiredSurfaces[mobileRetiredSurfaces.length - 1];
      if (
        previousTerm &&
        previousSurface &&
        previousTerm !== mobileSourceTerm &&
        replacementTerm !== previousTerm
      ) {
        try { replacementTerm.dispose(); } catch (e) {}
        replacementSurface.remove();
        term = previousTerm;
        surface = previousSurface;
        mobileReflowLayout = mobileSnapshotBuildOldLayout || mobileReflowLayout;
        untrackRetiredTerminalReplacement(previousTerm, previousSurface);
        if (!document.getElementById('terminal-surface')) {
          previousSurface.id = 'terminal-surface';
        }
      }
    }
    resetMobileWriteState();
    if (mobileSourceTerm) {
      try { mobileSourceTerm.clear(); mobileSourceTerm.reset(); } catch (e) {}
    }
    if (term && term !== mobileSourceTerm) {
      try {
        term.clear();
        term.reset();
        term.__mobileSnapshotCursor = isMobileReflowSnapshotLayout()
          ? { contentRow: 0, col: 0 }
          : null;
      } catch (e) {}
    }
  }
`;
