import type { Terminal } from '@xterm/xterm';

export interface ImeCompositionState {
  isComposing: boolean;
}

type CompositionHelperLike = {
  readonly isComposing?: boolean;
  _compositionPosition?: {
    start: number;
    end: number;
  };
  compositionend?: () => void;
  updateCompositionElements?: (dontRecurse?: boolean) => void;
};

type RenderServiceLike = {
  _renderRows?: (start: number, end: number) => void;
};

type CoreServiceLike = {
  triggerDataEvent?: (data: string, wasUserInput?: boolean) => void;
};

type XtermCoreLike = {
  _compositionHelper?: CompositionHelperLike;
  _renderService?: RenderServiceLike;
  coreService?: CoreServiceLike;
};

type TerminalWithInternals = Terminal & {
  _core?: XtermCoreLike;
};

export interface TerminalImeFixOptions {
  platform?: string;
  onCompatibilityInput?: (data: string) => void;
}

function isLikelyTextKey(event: KeyboardEvent): boolean {
  return event.key.length === 1 && !event.ctrlKey && !event.metaKey;
}

export function installTerminalImeFix(
  terminal: Terminal,
  compositionState: ImeCompositionState,
  options: TerminalImeFixOptions = {},
): () => void {
  const textarea = terminal.textarea;
  if (!textarea) {
    return () => {
      compositionState.isComposing = false;
    };
  }

  const core = (terminal as TerminalWithInternals)._core;
  const renderService = core?._renderService;
  const compositionHelper = core?._compositionHelper;

  let originalRenderRows: ((start: number, end: number) => void) | null = null;
  let originalUpdateCompositionElements: ((dontRecurse?: boolean) => void) | null = null;
  let hasAllowedInitialCompositionAnchorUpdate = false;
  let macImePassthroughActive = false;
  let sawTextKeyDownSinceInput = false;
  let skipCompatibilityInputUntilNextTask = false;
  let compatibilityInputResetTimer: number | null = null;
  let compositionPrefix = '';
  let compositionPrefixWasReplaced = false;
  let compositionPrefixCheckTimer: number | null = null;

  const terminalElement = terminal.element;
  const supportsMacImeCompatibility = options.platform === 'darwin'
    && Boolean(terminalElement && options.onCompatibilityInput);

  const clearCompatibilityInputResetTimer = () => {
    if (compatibilityInputResetTimer !== null) {
      window.clearTimeout(compatibilityInputResetTimer);
      compatibilityInputResetTimer = null;
    }
  };

  const resetMacImePassthrough = () => {
    macImePassthroughActive = false;
    sawTextKeyDownSinceInput = false;
  };

  const clearCompositionPrefixCheckTimer = () => {
    if (compositionPrefixCheckTimer !== null) {
      window.clearTimeout(compositionPrefixCheckTimer);
      compositionPrefixCheckTimer = null;
    }
  };

  const checkForReplacedCompositionPrefix = () => {
    if (
      supportsMacImeCompatibility
      && compositionState.isComposing
      && compositionPrefix
      && !textarea.value.startsWith(compositionPrefix)
    ) {
      compositionPrefixWasReplaced = true;
    }
  };

  const resetCompositionPrefixTracking = () => {
    clearCompositionPrefixCheckTimer();
    compositionPrefix = '';
    compositionPrefixWasReplaced = false;
  };

  const restoreRenderRows = () => {
    if (renderService && originalRenderRows) {
      renderService._renderRows = originalRenderRows;
    }
    originalRenderRows = null;
  };

  const restoreCompositionHelper = () => {
    if (compositionHelper && originalUpdateCompositionElements) {
      compositionHelper.updateCompositionElements = originalUpdateCompositionElements;
    }
    originalUpdateCompositionElements = null;
    hasAllowedInitialCompositionAnchorUpdate = false;
  };

  const handleCompositionStart = () => {
    compositionState.isComposing = true;
    hasAllowedInitialCompositionAnchorUpdate = false;
    clearCompatibilityInputResetTimer();
    skipCompatibilityInputUntilNextTask = false;
    resetMacImePassthrough();
    resetCompositionPrefixTracking();
    const compositionStart = compositionHelper?._compositionPosition?.start ?? textarea.value.length;
    compositionPrefix = textarea.value.slice(0, compositionStart);

    if (renderService?._renderRows && !originalRenderRows) {
      originalRenderRows = renderService._renderRows;
      renderService._renderRows = () => {};
    }

    if (compositionHelper?.updateCompositionElements && !originalUpdateCompositionElements) {
      originalUpdateCompositionElements = compositionHelper.updateCompositionElements.bind(compositionHelper);
      compositionHelper.updateCompositionElements = (dontRecurse?: boolean) => {
        if (!compositionState.isComposing) {
          originalUpdateCompositionElements?.(dontRecurse);
          return;
        }

        if (!hasAllowedInitialCompositionAnchorUpdate) {
          hasAllowedInitialCompositionAnchorUpdate = true;
          originalUpdateCompositionElements?.(dontRecurse);
        }
      };
    }
  };

  const handleCompositionEnd = (finishXtermComposition: boolean) => {
    const shouldRefresh = compositionState.isComposing;

    // xterm does not end its CompositionHelper state on blur/cancel. Its blur
    // handler clears the textarea first, so finalizing here resets the state
    // without forwarding stale composition text to the PTY.
    if (finishXtermComposition && compositionHelper?.isComposing) {
      compositionHelper.compositionend?.();
    }

    compositionState.isComposing = false;
    restoreCompositionHelper();
    restoreRenderRows();
    resetMacImePassthrough();
    resetCompositionPrefixTracking();

    clearCompatibilityInputResetTimer();
    skipCompatibilityInputUntilNextTask = shouldRefresh;
    if (shouldRefresh) {
      compatibilityInputResetTimer = window.setTimeout(() => {
        compatibilityInputResetTimer = null;
        skipCompatibilityInputUntilNextTask = false;
      }, 0);
    }

    if (shouldRefresh) {
      requestAnimationFrame(() => {
        if (typeof terminal.refresh === 'function' && terminal.rows > 0) {
          terminal.refresh(0, terminal.rows - 1);
        }
      });
    }
  };

  const handleMacKeyDownCapture = (event: KeyboardEvent) => {
    if (!supportsMacImeCompatibility || compositionState.isComposing || event.isComposing) {
      return;
    }

    if (event.keyCode === 229) {
      // Apple Pinyin/Sogou passthrough can deliver input before this keydown.
      // xterm's deferred textarea diff can then duplicate or drop a neighbor
      // (xterm.js #5887 and #6045).
      macImePassthroughActive = true;
      sawTextKeyDownSinceInput = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    macImePassthroughActive = false;
    sawTextKeyDownSinceInput = isLikelyTextKey(event);
  };

  const handleMacInputCapture = (event: Event) => {
    if (!supportsMacImeCompatibility || !(event instanceof InputEvent)) {
      return;
    }

    const data = event.data;
    const shouldForward = Boolean(
      data
      && event.inputType === 'insertText'
      && !event.isComposing
      && !compositionState.isComposing
      && !skipCompatibilityInputUntilNextTask
      && (
        macImePassthroughActive
        || (event.composed && !sawTextKeyDownSinceInput)
      )
    );

    sawTextKeyDownSinceInput = false;
    if (!shouldForward || !data) {
      return;
    }

    macImePassthroughActive = true;
    event.preventDefault();
    event.stopPropagation();
    // The input event has already mutated the hidden textarea. Since this path
    // forwards the data itself, retaining that value would make it a stale
    // prefix for the next real composition and can truncate its first glyphs.
    textarea.value = '';
    if (core?.coreService?.triggerDataEvent) {
      core.coreService.triggerDataEvent(data, true);
    } else {
      options.onCompatibilityInput?.(data);
    }
  };

  const handleCompositionUpdate = () => {
    if (!supportsMacImeCompatibility || !compositionPrefix) {
      return;
    }

    clearCompositionPrefixCheckTimer();
    compositionPrefixCheckTimer = window.setTimeout(() => {
      compositionPrefixCheckTimer = null;
      checkForReplacedCompositionPrefix();
    }, 0);
  };

  const handleCompositionEndCapture = () => {
    if (!supportsMacImeCompatibility) {
      return;
    }

    checkForReplacedCompositionPrefix();
    clearCompositionPrefixCheckTimer();
    if (compositionPrefixWasReplaced && compositionHelper?._compositionPosition) {
      // xterm normally slices the committed value from the old prefix length.
      // Once the IME has replaced that prefix, the value contains composition
      // text only and must be read from index zero (xterm.js #6049).
      compositionHelper._compositionPosition.start = 0;
    }
  };

  const handleCompositionEndEvent = () => handleCompositionEnd(false);
  const handleCompositionAbortEvent = () => handleCompositionEnd(true);

  textarea.addEventListener('compositionstart', handleCompositionStart);
  textarea.addEventListener('compositionupdate', handleCompositionUpdate);
  textarea.addEventListener('compositionend', handleCompositionEndEvent);
  textarea.addEventListener('compositioncancel', handleCompositionAbortEvent);
  textarea.addEventListener('blur', handleCompositionAbortEvent);
  terminalElement?.addEventListener('keydown', handleMacKeyDownCapture, true);
  terminalElement?.addEventListener('input', handleMacInputCapture, true);
  terminalElement?.addEventListener('compositionend', handleCompositionEndCapture, true);

  return () => {
    textarea.removeEventListener('compositionstart', handleCompositionStart);
    textarea.removeEventListener('compositionupdate', handleCompositionUpdate);
    textarea.removeEventListener('compositionend', handleCompositionEndEvent);
    textarea.removeEventListener('compositioncancel', handleCompositionAbortEvent);
    textarea.removeEventListener('blur', handleCompositionAbortEvent);
    terminalElement?.removeEventListener('keydown', handleMacKeyDownCapture, true);
    terminalElement?.removeEventListener('input', handleMacInputCapture, true);
    terminalElement?.removeEventListener('compositionend', handleCompositionEndCapture, true);
    clearCompatibilityInputResetTimer();
    clearCompositionPrefixCheckTimer();
    handleCompositionEnd(true);
    clearCompatibilityInputResetTimer();
  };
}
