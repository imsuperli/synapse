export const TERMINAL_SELECTION_WORD_JS = String.raw`
  function seedWordSelection(col, absRow) {
    var bufferLine = term && term.buffer.active.getLine(absRow);
    var line = getLineText(absRow);
    if (!line || !bufferLine) {
      sel = { anchor: { col: col, row: absRow }, focus: { col: col, row: absRow }, activeHandle: null };
      applyXtermSelection();
      return;
    }
    var cells = [];
    var stringOffset = 0;
    for (var cellCol = 0; cellCol < term.cols; cellCol++) {
      var cell = bufferLine.getCell(cellCol);
      if (!cell || cell.getWidth() === 0) continue;
      var chars = cell.getChars() || ' ';
      cells.push({
        col: cellCol,
        endCol: cellCol + Math.max(1, cell.getWidth()) - 1,
        start: stringOffset,
        end: stringOffset + chars.length,
        chars: chars
      });
      stringOffset += chars.length;
    }
    var tapped = cells.find(function(cell) { return col >= cell.col && col <= cell.endCol; });
    var s = tapped ? tapped.col : col;
    var e = tapped ? tapped.endCol : col;
    if (tapped && typeof Intl !== 'undefined' && Intl.Segmenter) {
      try {
        var segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
        var segments = segmenter.segment(line);
        for (var segment of segments) {
          var segmentEnd = segment.index + segment.segment.length;
          if (tapped.start >= segment.index && tapped.start < segmentEnd && segment.isWordLike) {
            var firstCell = cells.find(function(cell) { return cell.end > segment.index; });
            var lastCell = cells.findLast
              ? cells.findLast(function(cell) { return cell.start < segmentEnd; })
              : cells.slice().reverse().find(function(cell) { return cell.start < segmentEnd; });
            if (firstCell && lastCell) {
              s = firstCell.col;
              e = lastCell.endCol;
            }
            break;
          }
        }
      } catch (err) {}
    } else if (tapped && WORD_RE.test(tapped.chars)) {
      var tappedIndex = cells.indexOf(tapped);
      var startIndex = tappedIndex;
      var endIndex = tappedIndex;
      while (startIndex > 0 && WORD_RE.test(cells[startIndex - 1].chars)) startIndex--;
      while (endIndex + 1 < cells.length && WORD_RE.test(cells[endIndex + 1].chars)) endIndex++;
      s = cells[startIndex].col;
      e = cells[endIndex].endCol;
    }
    sel = {
      anchor: { col: s, row: absRow },
      focus: { col: e, row: absRow },
      activeHandle: null
    };
    applyXtermSelection();
  }
`
