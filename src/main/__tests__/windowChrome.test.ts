import { describe, expect, it } from 'vitest';
import { getMainWindowChromeOptions, resolveMainWindowCloseAction } from '../windowChrome';

describe('main window chrome', () => {
  it('uses native macOS traffic lights with a hidden title bar', () => {
    expect(getMainWindowChromeOptions('darwin')).toEqual({
      frame: true,
      titleBarStyle: 'hidden',
    });
  });

  it('keeps the custom frameless chrome on Windows and Linux', () => {
    expect(getMainWindowChromeOptions('win32')).toEqual({ frame: false });
    expect(getMainWindowChromeOptions('linux')).toEqual({ frame: false });
  });

  it('returns to the home view before applying platform close behavior', () => {
    expect(resolveMainWindowCloseAction('darwin', 'terminal', false)).toBe('return-home');
    expect(resolveMainWindowCloseAction('darwin', 'canvas', false)).toBe('return-home');
    expect(resolveMainWindowCloseAction('win32', 'terminal', false)).toBe('return-home');
  });

  it('hides a macOS home window and shuts down a Windows home window', () => {
    expect(resolveMainWindowCloseAction('darwin', 'unified', false)).toBe('hide');
    expect(resolveMainWindowCloseAction('win32', 'unified', false)).toBe('shutdown');
  });

  it('allows the native close while the app is already quitting', () => {
    expect(resolveMainWindowCloseAction('darwin', 'terminal', true)).toBe('allow-close');
    expect(resolveMainWindowCloseAction('win32', 'unified', true)).toBe('allow-close');
  });
});
