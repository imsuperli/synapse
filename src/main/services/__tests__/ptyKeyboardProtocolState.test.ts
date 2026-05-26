import { describe, expect, it } from 'vitest';
import {
  cloneKeyboardProtocolState,
  createDefaultKeyboardProtocolState,
  updateKeyboardProtocolStateFromOutput,
} from '../ptyKeyboardProtocolState';

const defaultKeyboardProtocolState = {
  applicationCursorKeysMode: false,
  applicationKeypadMode: false,
  bracketedPasteMode: false,
  sendFocusMode: false,
  win32InputMode: false,
  mouseTracking: {
    protocol: 'NONE',
    encoding: 'DEFAULT',
  },
};

describe('ptyKeyboardProtocolState', () => {
  it('tracks win32 and kitty keyboard protocol state', () => {
    const state = createDefaultKeyboardProtocolState();

    updateKeyboardProtocolStateFromOutput(state, '\u001b[?9001h\u001b[=5u\u001b[>3u');

    expect(cloneKeyboardProtocolState(state)).toEqual({
      ...defaultKeyboardProtocolState,
      kittyKeyboard: {
        flags: 3,
        mainFlags: 0,
        altFlags: 0,
        mainStack: [5],
        altStack: [],
      },
      win32InputMode: true,
    });

    updateKeyboardProtocolStateFromOutput(state, '\u001b[<1u\u001b[?9001l\u001b[=0u');

    expect(cloneKeyboardProtocolState(state)).toEqual({
      ...defaultKeyboardProtocolState,
      kittyKeyboard: {
        flags: 0,
        mainFlags: 0,
        altFlags: 0,
        mainStack: [],
        altStack: [],
      },
    });
  });

  it('tracks keyboard protocol sequences split across output chunks', () => {
    const state = createDefaultKeyboardProtocolState();

    updateKeyboardProtocolStateFromOutput(state, '\u001b[?900');
    updateKeyboardProtocolStateFromOutput(state, '1h\u001b[=');
    updateKeyboardProtocolStateFromOutput(state, '5');
    updateKeyboardProtocolStateFromOutput(state, 'u');

    expect(cloneKeyboardProtocolState(state)).toEqual({
      ...defaultKeyboardProtocolState,
      kittyKeyboard: {
        flags: 5,
        mainFlags: 0,
        altFlags: 0,
        mainStack: [],
        altStack: [],
      },
      win32InputMode: true,
    });
  });

  it('tracks xterm input modes that affect local key and mouse encoding', () => {
    const state = createDefaultKeyboardProtocolState();

    updateKeyboardProtocolStateFromOutput(state, '\u001b[?1;1004h');
    updateKeyboardProtocolStateFromOutput(state, '\u001b');
    updateKeyboardProtocolStateFromOutput(state, '=');
    updateKeyboardProtocolStateFromOutput(state, '\u001b[?1002;1006h');

    expect(cloneKeyboardProtocolState(state)).toEqual({
      ...defaultKeyboardProtocolState,
      applicationCursorKeysMode: true,
      applicationKeypadMode: true,
      sendFocusMode: true,
      mouseTracking: {
        protocol: 'DRAG',
        encoding: 'SGR',
      },
      kittyKeyboard: {
        flags: 0,
        mainFlags: 0,
        altFlags: 0,
        mainStack: [],
        altStack: [],
      },
    });

    updateKeyboardProtocolStateFromOutput(state, '\u001b>\u001b[?1;1004;1002;1006l');

    expect(cloneKeyboardProtocolState(state)).toEqual({
      ...defaultKeyboardProtocolState,
      kittyKeyboard: {
        flags: 0,
        mainFlags: 0,
        altFlags: 0,
        mainStack: [],
        altStack: [],
      },
    });
  });

  it('mirrors xterm kitty flag swaps across alternate buffer transitions', () => {
    const state = createDefaultKeyboardProtocolState();

    updateKeyboardProtocolStateFromOutput(state, '\u001b[=7u\u001b[?1049h\u001b[=3u\u001b[?1049l');

    expect(cloneKeyboardProtocolState(state)).toEqual({
      ...defaultKeyboardProtocolState,
      kittyKeyboard: {
        flags: 7,
        mainFlags: 7,
        altFlags: 3,
        mainStack: [],
        altStack: [],
      },
    });
  });

  it('keeps independent kitty stacks for main and alternate buffers', () => {
    const state = createDefaultKeyboardProtocolState();

    updateKeyboardProtocolStateFromOutput(state, '\u001b[=1u\u001b[>2u\u001b[?1049h\u001b[=3u\u001b[>4u');

    expect(cloneKeyboardProtocolState(state)).toEqual({
      ...defaultKeyboardProtocolState,
      kittyKeyboard: {
        flags: 4,
        mainFlags: 2,
        altFlags: 0,
        mainStack: [1],
        altStack: [3],
      },
    });

    updateKeyboardProtocolStateFromOutput(state, '\u001b[?1049l\u001b[<1u');

    expect(cloneKeyboardProtocolState(state)).toEqual({
      ...defaultKeyboardProtocolState,
      kittyKeyboard: {
        flags: 0,
        mainFlags: 2,
        altFlags: 4,
        mainStack: [],
        altStack: [3],
      },
    });
  });

  it('matches xterm kitty stack limit and empty-pop reset behavior', () => {
    const state = createDefaultKeyboardProtocolState();

    for (let flags = 1; flags <= 18; flags += 1) {
      updateKeyboardProtocolStateFromOutput(state, `\u001b[>${flags}u`);
    }

    expect(cloneKeyboardProtocolState(state).kittyKeyboard.mainStack).toHaveLength(16);
    expect(cloneKeyboardProtocolState(state).kittyKeyboard.mainStack[0]).toBe(2);

    updateKeyboardProtocolStateFromOutput(state, '\u001b[<99u');

    expect(cloneKeyboardProtocolState(state).kittyKeyboard).toEqual({
      flags: 0,
      mainFlags: 0,
      altFlags: 0,
      mainStack: [],
      altStack: [],
    });
  });

  it('tracks bracketed paste mode across output chunks', () => {
    const state = createDefaultKeyboardProtocolState();

    updateKeyboardProtocolStateFromOutput(state, '\u001b[?200');
    updateKeyboardProtocolStateFromOutput(state, '4h');

    expect(cloneKeyboardProtocolState(state).bracketedPasteMode).toBe(true);

    updateKeyboardProtocolStateFromOutput(state, '\u001b[?2004l');

    expect(cloneKeyboardProtocolState(state).bracketedPasteMode).toBe(false);
  });

  it('returns clone snapshots that cannot mutate tracked state', () => {
    const state = createDefaultKeyboardProtocolState();
    updateKeyboardProtocolStateFromOutput(state, '\u001b[=5u\u001b[>3u');

    const snapshot = cloneKeyboardProtocolState(state);
    snapshot.kittyKeyboard.flags = 99;
    snapshot.kittyKeyboard.mainStack.push(99);
    snapshot.mouseTracking.protocol = 'ANY';

    expect(cloneKeyboardProtocolState(state)).toEqual({
      ...defaultKeyboardProtocolState,
      kittyKeyboard: {
        flags: 3,
        mainFlags: 0,
        altFlags: 0,
        mainStack: [5],
        altStack: [],
      },
    });
  });
});
