import type { Terminal } from '@xterm/xterm';

type XtermBufferState = {
  scrollTop: number;
  scrollBottom: number;
};

type XtermScrollbackCore = {
  _bufferService?: {
    buffer: XtermBufferState;
    scroll: (eraseAttr: unknown, isWrapped?: boolean) => void;
  };
  _inputHandler?: {
    _eraseAttrData?: () => unknown;
    _dirtyRowTracker?: {
      markRangeDirty?: (start: number, end: number) => void;
    };
  };
};

type TerminalWithScrollbackCore = Terminal & {
  _core?: XtermScrollbackCore;
};

/**
 * Preserve rows removed by CSI S when the scroll region starts at row 1.
 *
 * Codex uses this sequence when its inline composer/status viewport grows.
 * xterm's default SU handler deletes the rows that leave the top of the
 * region. The normal-buffer scroll path keeps them in scrollback while also
 * keeping rows below a partial scroll region in place.
 */
export function installTerminalScrollbackPreservation(terminal: Terminal): () => void {
  const core = (terminal as TerminalWithScrollbackCore)._core;
  const bufferService = core?._bufferService;
  const inputHandler = core?._inputHandler;
  const eraseAttrData = inputHandler?._eraseAttrData;
  if (!bufferService || !inputHandler || !eraseAttrData) {
    return () => undefined;
  }

  const disposable = terminal.parser.registerCsiHandler({ final: 'S' }, (params) => {
    const buffer = bufferService.buffer;
    if (terminal.buffer.active.type !== 'normal' || buffer.scrollTop !== 0) {
      return false;
    }

    const regionHeight = buffer.scrollBottom - buffer.scrollTop + 1;
    if (regionHeight <= 0) {
      return false;
    }

    const rawCount = params[0];
    if (Array.isArray(rawCount)) {
      return false;
    }

    const requestedCount = rawCount || 1;
    const scrollCount = Math.min(Math.max(1, requestedCount), regionHeight);
    const eraseAttr = eraseAttrData.call(inputHandler);
    for (let index = 0; index < scrollCount; index += 1) {
      bufferService.scroll(eraseAttr);
    }
    inputHandler._dirtyRowTracker?.markRangeDirty?.(buffer.scrollTop, buffer.scrollBottom);
    return true;
  });

  return () => disposable.dispose();
}
