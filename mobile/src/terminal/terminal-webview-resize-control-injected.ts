import { SYNAPSE_TERMINAL_RESIZE_OSC } from '../../../src/shared/terminal-resize-control'

export const TERMINAL_RESIZE_CONTROL_JS = String.raw`
  function splitTerminalResizeWriteOperations(data) {
    var operations = [];
    var prefix = String.fromCharCode(27) + ']${SYNAPSE_TERMINAL_RESIZE_OSC};synapse-resize:';
    var bell = String.fromCharCode(7);
    var stringTerminator = String.fromCharCode(27, 92);
    var offset = 0;
    var searchOffset = 0;
    while (searchOffset < data.length) {
      var markerStart = data.indexOf(prefix, searchOffset);
      if (markerStart < 0) break;
      var payloadStart = markerStart + prefix.length;
      var bellEnd = data.indexOf(bell, payloadStart);
      var stringEnd = data.indexOf(stringTerminator, payloadStart);
      var usesBell = bellEnd >= 0 && (stringEnd < 0 || bellEnd < stringEnd);
      var markerEnd = usesBell ? bellEnd : stringEnd;
      if (markerEnd < 0) break;
      var parts = data.slice(payloadStart, markerEnd).split(':');
      var cols = parts.length === 2 ? Math.floor(Number(parts[0]) || 0) : 0;
      var rows = parts.length === 2 ? Math.floor(Number(parts[1]) || 0) : 0;
      if (
        cols < 2 ||
        rows < 1 ||
        String(cols) !== parts[0] ||
        String(rows) !== parts[1]
      ) {
        searchOffset = payloadStart;
        continue;
      }
      if (markerStart > offset) {
        operations.push({ type: 'data', data: data.slice(offset, markerStart) });
      }
      operations.push({ type: 'resize', cols: cols, rows: rows });
      offset = markerEnd + (usesBell ? 1 : 2);
      searchOffset = offset;
    }
    if (offset < data.length) {
      operations.push({ type: 'data', data: data.slice(offset) });
    }
    return operations;
  }

  function writeTerminalWithResizeControls(target, data, done, onResize) {
    var operations = splitTerminalResizeWriteOperations(data || '');
    var index = 0;
    function next() {
      if (index >= operations.length) {
        if (done) done();
        return;
      }
      var operation = operations[index++];
      if (operation.type === 'resize') {
        target.resize(operation.cols, operation.rows);
        if (onResize) onResize(operation.cols, operation.rows);
        next();
        return;
      }
      var completed = false;
      target.write(operation.data, function() {
        if (completed) return;
        completed = true;
        Promise.resolve().then(next);
      });
    }
    next();
  }
`
