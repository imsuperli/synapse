import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installTerminalImeFix, type ImeCompositionState } from '../terminalImeFix';

describe('installTerminalImeFix', () => {
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;

  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
  });

  afterEach(() => {
    if (originalRequestAnimationFrame) {
      vi.stubGlobal('requestAnimationFrame', originalRequestAnimationFrame);
    }
    vi.restoreAllMocks();
  });

  it('blocks render churn during composition and restores xterm internals afterwards', () => {
    const textarea = document.createElement('textarea');
    const originalRenderRows = vi.fn();
    const originalUpdateCompositionElements = vi.fn();
    const refresh = vi.fn();
    const compositionState: ImeCompositionState = { isComposing: false };

    const terminal = {
      textarea,
      rows: 24,
      refresh,
      _core: {
        _renderService: {
          _renderRows: originalRenderRows,
        },
        _compositionHelper: {
          updateCompositionElements: originalUpdateCompositionElements,
        },
      },
    } as any;

    const dispose = installTerminalImeFix(terminal, compositionState);

    textarea.dispatchEvent(new Event('compositionstart'));

    expect(compositionState.isComposing).toBe(true);

    terminal._core._renderService._renderRows(0, 10);
    terminal._core._compositionHelper.updateCompositionElements();
    terminal._core._compositionHelper.updateCompositionElements();

    expect(originalRenderRows).not.toHaveBeenCalled();
    expect(originalUpdateCompositionElements).toHaveBeenCalledTimes(1);

    textarea.dispatchEvent(new Event('compositionend'));

    expect(compositionState.isComposing).toBe(false);

    terminal._core._renderService._renderRows(0, 10);
    terminal._core._compositionHelper.updateCompositionElements();

    expect(originalRenderRows).toHaveBeenCalledTimes(1);
    expect(originalUpdateCompositionElements).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledWith(0, 23);

    dispose();
  });

  it('ends xterm internal composition state when the helper textarea blurs', () => {
    const terminalElement = document.createElement('div');
    const textarea = document.createElement('textarea');
    terminalElement.appendChild(textarea);
    const compositionState: ImeCompositionState = { isComposing: false };
    const compositionHelper = {
      isComposing: false,
      compositionend: vi.fn(() => {
        compositionHelper.isComposing = false;
      }),
      updateCompositionElements: vi.fn(),
    };

    // xterm registers these listeners before Synapse installs its compatibility layer.
    textarea.addEventListener('compositionstart', () => {
      compositionHelper.isComposing = true;
    });
    textarea.addEventListener('compositionend', () => {
      compositionHelper.isComposing = false;
    });
    textarea.addEventListener('blur', () => {
      textarea.value = '';
    });

    const terminal = {
      element: terminalElement,
      textarea,
      rows: 24,
      refresh: vi.fn(),
      _core: {
        _compositionHelper: compositionHelper,
      },
    } as any;

    const dispose = installTerminalImeFix(terminal, compositionState);

    textarea.dispatchEvent(new Event('compositionstart'));
    expect(compositionState.isComposing).toBe(true);
    expect(compositionHelper.isComposing).toBe(true);

    textarea.dispatchEvent(new Event('blur'));

    expect(compositionState.isComposing).toBe(false);
    expect(compositionHelper.isComposing).toBe(false);
    expect(compositionHelper.compositionend).toHaveBeenCalledTimes(1);

    dispose();
  });

  it('forwards macOS IME insertText events that arrive before keyCode 229', () => {
    const terminalElement = document.createElement('div');
    const textarea = document.createElement('textarea');
    terminalElement.appendChild(textarea);
    const targetInput = vi.fn();
    const targetKeyDown = vi.fn();
    const forwarded: string[] = [];
    const fallbackInput = vi.fn();
    const wasUserInput: Array<boolean | undefined> = [];
    textarea.addEventListener('input', targetInput);
    textarea.addEventListener('keydown', targetKeyDown);

    const terminal = {
      element: terminalElement,
      textarea,
      rows: 24,
      refresh: vi.fn(),
      _core: {
        coreService: {
          triggerDataEvent: (data: string, userInput?: boolean) => {
            forwarded.push(data);
            wasUserInput.push(userInput);
          },
        },
      },
    } as any;
    const dispose = installTerminalImeFix(
      terminal,
      { isComposing: false },
      {
        platform: 'darwin',
        onCompatibilityInput: fallbackInput,
      },
    );

    textarea.value = '一';
    textarea.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      composed: true,
      data: '一',
      inputType: 'insertText',
    }));

    const imeKeyDown = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'y',
    });
    Object.defineProperty(imeKeyDown, 'keyCode', { value: 229 });
    textarea.dispatchEvent(imeKeyDown);

    textarea.value = '个';
    textarea.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      composed: true,
      data: '个',
      inputType: 'insertText',
    }));

    expect(forwarded).toEqual(['一', '个']);
    expect(wasUserInput).toEqual([true, true]);
    expect(fallbackInput).not.toHaveBeenCalled();
    expect(textarea.value).toBe('');
    expect(targetInput).not.toHaveBeenCalled();
    expect(targetKeyDown).not.toHaveBeenCalled();

    dispose();
  });

  it('leaves normal keydown-before-input delivery to xterm', () => {
    const terminalElement = document.createElement('div');
    const textarea = document.createElement('textarea');
    terminalElement.appendChild(textarea);
    const targetInput = vi.fn();
    const targetKeyDown = vi.fn();
    const forwarded: string[] = [];
    textarea.addEventListener('input', targetInput);
    textarea.addEventListener('keydown', targetKeyDown);

    const terminal = {
      element: terminalElement,
      textarea,
      rows: 24,
      refresh: vi.fn(),
    } as any;
    const dispose = installTerminalImeFix(
      terminal,
      { isComposing: false },
      {
        platform: 'darwin',
        onCompatibilityInput: (data) => forwarded.push(data),
      },
    );

    const keyDown = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'a',
    });
    Object.defineProperty(keyDown, 'keyCode', { value: 65 });
    textarea.dispatchEvent(keyDown);
    textarea.value = 'a';
    textarea.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      composed: true,
      data: 'a',
      inputType: 'insertText',
    }));

    expect(forwarded).toEqual([]);
    expect(targetKeyDown).toHaveBeenCalledTimes(1);
    expect(targetInput).toHaveBeenCalledTimes(1);

    dispose();
  });

  it('does not change input delivery outside macOS', () => {
    const terminalElement = document.createElement('div');
    const textarea = document.createElement('textarea');
    terminalElement.appendChild(textarea);
    const targetInput = vi.fn();
    const forwarded: string[] = [];
    textarea.addEventListener('input', targetInput);

    const terminal = {
      element: terminalElement,
      textarea,
      rows: 24,
      refresh: vi.fn(),
    } as any;
    const dispose = installTerminalImeFix(
      terminal,
      { isComposing: false },
      {
        platform: 'win32',
        onCompatibilityInput: (data) => forwarded.push(data),
      },
    );

    textarea.value = '一';
    textarea.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      composed: true,
      data: '一',
      inputType: 'insertText',
    }));

    expect(forwarded).toEqual([]);
    expect(targetInput).toHaveBeenCalledTimes(1);
    expect(textarea.value).toBe('一');

    dispose();
  });

  it('does not intercept text committed by a real composition sequence', () => {
    const terminalElement = document.createElement('div');
    const textarea = document.createElement('textarea');
    terminalElement.appendChild(textarea);
    const targetInput = vi.fn();
    const forwarded: string[] = [];
    textarea.addEventListener('input', targetInput);

    const terminal = {
      element: terminalElement,
      textarea,
      rows: 24,
      refresh: vi.fn(),
    } as any;
    const dispose = installTerminalImeFix(
      terminal,
      { isComposing: false },
      {
        platform: 'darwin',
        onCompatibilityInput: (data) => forwarded.push(data),
      },
    );

    textarea.dispatchEvent(new Event('compositionstart'));
    textarea.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      composed: true,
      data: '一',
      inputType: 'insertText',
      isComposing: true,
    }));
    textarea.dispatchEvent(new Event('compositionend'));
    textarea.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      composed: true,
      data: '一',
      inputType: 'insertText',
    }));

    expect(forwarded).toEqual([]);
    expect(targetInput).toHaveBeenCalledTimes(2);

    dispose();
  });

  it('rebases xterm composition slicing when macOS IME replaces the saved prefix', () => {
    const terminalElement = document.createElement('div');
    const textarea = document.createElement('textarea');
    terminalElement.appendChild(textarea);
    const compositionPosition = { start: 0, end: 0 };
    const compositionHelper = {
      isComposing: false,
      _compositionPosition: compositionPosition,
      compositionend: vi.fn(),
      updateCompositionElements: vi.fn(),
    };
    const startSeenByXterm: number[] = [];

    textarea.addEventListener('compositionstart', () => {
      compositionHelper.isComposing = true;
      compositionPosition.start = textarea.value.length;
    });
    textarea.addEventListener('compositionend', () => {
      startSeenByXterm.push(compositionPosition.start);
      compositionHelper.isComposing = false;
    });

    const terminal = {
      element: terminalElement,
      textarea,
      rows: 24,
      refresh: vi.fn(),
      _core: {
        _compositionHelper: compositionHelper,
      },
    } as any;
    const dispose = installTerminalImeFix(
      terminal,
      { isComposing: false },
      { platform: 'darwin', onCompatibilityInput: vi.fn() },
    );

    textarea.value = 'x';
    textarea.dispatchEvent(new Event('compositionstart', { bubbles: true }));
    textarea.value = '一个。';
    textarea.dispatchEvent(new Event('compositionend', { bubbles: true }));

    expect(startSeenByXterm).toEqual([0]);

    dispose();
  });

  it('preserves xterm composition slicing when macOS IME keeps the saved prefix', () => {
    const terminalElement = document.createElement('div');
    const textarea = document.createElement('textarea');
    terminalElement.appendChild(textarea);
    const compositionPosition = { start: 0, end: 0 };
    const compositionHelper = {
      isComposing: false,
      _compositionPosition: compositionPosition,
      compositionend: vi.fn(),
      updateCompositionElements: vi.fn(),
    };
    const startSeenByXterm: number[] = [];

    textarea.addEventListener('compositionstart', () => {
      compositionHelper.isComposing = true;
      compositionPosition.start = textarea.value.length;
    });
    textarea.addEventListener('compositionend', () => {
      startSeenByXterm.push(compositionPosition.start);
      compositionHelper.isComposing = false;
    });

    const terminal = {
      element: terminalElement,
      textarea,
      rows: 24,
      refresh: vi.fn(),
      _core: {
        _compositionHelper: compositionHelper,
      },
    } as any;
    const dispose = installTerminalImeFix(
      terminal,
      { isComposing: false },
      { platform: 'darwin', onCompatibilityInput: vi.fn() },
    );

    textarea.value = 'x';
    textarea.dispatchEvent(new Event('compositionstart', { bubbles: true }));
    textarea.value = 'x一个。';
    textarea.dispatchEvent(new Event('compositionend', { bubbles: true }));

    expect(startSeenByXterm).toEqual([1]);

    dispose();
  });
});
