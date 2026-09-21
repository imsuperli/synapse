import type { Terminal } from '@xterm/xterm';

type XtermBufferState = {
  scrollTop: number;
  scrollBottom: number;
  lines: {
    isFull: boolean;
  };
};

type XtermScrollbackCore = {
  _bufferService?: {
    buffer: XtermBufferState;
    isUserScrolling: boolean;
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

const READING_SCROLLBACK_MULTIPLIER = 10;
const MAX_READING_SCROLLBACK = 100_000;
const XTERM_DEFAULT_SCROLLBACK = 1000;

/**
 * Preserve Codex history and keep a scrolled-back viewport stable during output.
 *
 * Codex uses this sequence when its inline composer/status viewport grows.
 * xterm's default SU handler deletes the rows that leave the top of the
 * region. The normal-buffer scroll path keeps them in scrollback while also
 * keeping rows below a partial scroll region in place. When that scrollback
 * fills while the user is reading, temporary capacity prevents xterm from
 * decrementing the viewport to row 0 as old rows are evicted.
 */
export function installTerminalScrollbackPreservation(terminal: Terminal): () => void {
  const core = (terminal as TerminalWithScrollbackCore)._core;
  const bufferService = core?._bufferService;
  const inputHandler = core?._inputHandler;
  const eraseAttrData = inputHandler?._eraseAttrData;
  if (!bufferService || !inputHandler || !eraseAttrData) {
    return () => undefined;
  }

  const configuredScrollback = terminal.options.scrollback ?? XTERM_DEFAULT_SCROLLBACK;
  const readingScrollback = Math.max(
    configuredScrollback,
    Math.min(MAX_READING_SCROLLBACK, configuredScrollback * READING_SCROLLBACK_MULTIPLIER),
  );
  const originalScroll = bufferService.scroll;

  const guardedScroll = (eraseAttr: unknown, isWrapped?: boolean) => {
    const buffer = bufferService.buffer;
    const currentScrollback = terminal.options.scrollback ?? configuredScrollback;
    if (terminal.buffer.active.type === 'normal') {
      if (!bufferService.isUserScrolling && currentScrollback > configuredScrollback) {
        // The reader has returned to live output. Trim the temporary headroom
        // before the next scroll, while xterm is already anchored at the bottom.
        terminal.options.scrollback = configuredScrollback;
      } else if (
        bufferService.isUserScrolling
        && buffer.lines.isFull
        && currentScrollback < readingScrollback
      ) {
        // xterm decrements viewportY when a full buffer evicts its oldest row.
        // A large Codex redraw can therefore move a reader straight to row 0.
        // Grow before that eviction so the visible rows remain byte-for-byte stable.
        terminal.options.scrollback = readingScrollback;
      }
    }

    originalScroll.call(bufferService, eraseAttr, isWrapped);
  };
  bufferService.scroll = guardedScroll;

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

  return () => {
    disposable.dispose();
    if (bufferService.scroll === guardedScroll) {
      bufferService.scroll = originalScroll;
    }
  };
}
