import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useKeyboardShortcuts } from '../useKeyboardShortcuts';
import { getDefaultKeyboardShortcuts } from '../../../shared/utils/keyboardShortcuts';

interface TestHarnessProps {
  onCtrlTab?: () => void;
  onCtrlB?: () => void;
  onCtrlNumber?: (num: number) => void;
  onEscape?: () => boolean | void;
  enabled?: boolean;
}

function TestHarness(props: TestHarnessProps) {
  useKeyboardShortcuts({
    quickSwitcherShortcut: getDefaultKeyboardShortcuts().quickSwitcher,
    ...props,
  });

  return (
    <div>
      <textarea data-testid="xterm-helper" className="xterm-helper-textarea" />
      <button type="button" data-testid="outside-target">outside</button>
      <div data-mini-ask-overlay="true">
        <textarea data-testid="mini-ask-input" />
      </div>
    </div>
  );
}

function dispatchKeyDown(target: EventTarget, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  (target as Element).dispatchEvent(event);
  return event;
}

describe('useKeyboardShortcuts', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not intercept Ctrl+B from the xterm helper textarea', () => {
    const onCtrlB = vi.fn();
    render(<TestHarness onCtrlB={onCtrlB} />);

    const event = dispatchKeyDown(screen.getByTestId('xterm-helper'), {
      key: 'b',
      ctrlKey: true,
    });

    expect(onCtrlB).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('still handles Ctrl+Tab from the xterm helper textarea', () => {
    const onCtrlTab = vi.fn();
    render(<TestHarness onCtrlTab={onCtrlTab} />);

    const event = dispatchKeyDown(screen.getByTestId('xterm-helper'), {
      key: 'Tab',
      ctrlKey: true,
    });

    expect(onCtrlTab).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('handles Ctrl+Tab before the xterm textarea target listener can consume it', () => {
    const onCtrlTab = vi.fn();
    render(<TestHarness onCtrlTab={onCtrlTab} />);

    const targetListener = vi.fn((event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
    });
    const textarea = screen.getByTestId('xterm-helper');
    textarea.addEventListener('keydown', targetListener);

    const event = dispatchKeyDown(textarea, {
      key: 'Tab',
      ctrlKey: true,
    });

    expect(onCtrlTab).toHaveBeenCalledTimes(1);
    expect(targetListener).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it('still handles Escape from the xterm helper textarea when the UI consumes it', () => {
    const onEscape = vi.fn(() => true);
    render(<TestHarness onEscape={onEscape} />);

    const event = dispatchKeyDown(screen.getByTestId('xterm-helper'), {
      key: 'Escape',
    });

    expect(onEscape).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('continues to handle app shortcuts outside terminal input', () => {
    const onCtrlTab = vi.fn();
    render(<TestHarness onCtrlTab={onCtrlTab} />);

    const event = dispatchKeyDown(screen.getByTestId('outside-target'), {
      key: 'Tab',
      ctrlKey: true,
    });

    expect(onCtrlTab).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('does not intercept shortcuts from the mini ask overlay', () => {
    const onCtrlTab = vi.fn();
    render(<TestHarness onCtrlTab={onCtrlTab} />);

    const event = dispatchKeyDown(screen.getByTestId('mini-ask-input'), {
      key: 'Tab',
      ctrlKey: true,
    });

    expect(onCtrlTab).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});
