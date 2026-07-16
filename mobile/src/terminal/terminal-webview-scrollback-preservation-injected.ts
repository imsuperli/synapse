export const TERMINAL_SCROLLBACK_PRESERVATION_JS = String.raw`
  function installMobileTerminalScrollbackPreservation(terminal) {
    var core = terminal && terminal._core;
    var bufferService = core && core._bufferService;
    var inputHandler = core && core._inputHandler;
    var eraseAttrData = inputHandler && inputHandler._eraseAttrData;
    if (!bufferService || !inputHandler || !eraseAttrData) {
      return { dispose: function() {} };
    }

    return terminal.parser.registerCsiHandler({ final: 'S' }, function(params) {
      var buffer = bufferService.buffer;
      if (terminal.buffer.active.type !== 'normal' || buffer.scrollTop !== 0) {
        return false;
      }

      var regionHeight = buffer.scrollBottom - buffer.scrollTop + 1;
      if (regionHeight <= 0) {
        return false;
      }

      var rawCount = params[0];
      if (Array.isArray(rawCount)) {
        return false;
      }

      var requestedCount = rawCount || 1;
      var scrollCount = Math.min(Math.max(1, requestedCount), regionHeight);
      var eraseAttr = eraseAttrData.call(inputHandler);
      for (var index = 0; index < scrollCount; index++) {
        bufferService.scroll(eraseAttr);
      }
      var dirtyRowTracker = inputHandler._dirtyRowTracker;
      if (dirtyRowTracker && dirtyRowTracker.markRangeDirty) {
        dirtyRowTracker.markRangeDirty(buffer.scrollTop, buffer.scrollBottom);
      }
      return true;
    });
  }
`
