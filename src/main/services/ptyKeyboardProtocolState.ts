import type { PtyKeyboardProtocolState } from '../../shared/types/electron-api';

export type TrackedKeyboardProtocolState = PtyKeyboardProtocolState & {
  activeAltBuffer: boolean;
  pendingEscapeSequence: string;
};

const KEYBOARD_PROTOCOL_SEQUENCE_TAIL_LIMIT = 64;
const KEYBOARD_PROTOCOL_SEQUENCE_PATTERN = /\x1b\[(?:(\?)([0-9;]*)?([hl])|=([0-9]*)(?:;([0-9]+))?u|>([0-9]*)u|<([0-9]*)u)/g;

export function createDefaultKeyboardProtocolState(): TrackedKeyboardProtocolState {
  return {
    activeAltBuffer: false,
    bracketedPasteMode: false,
    pendingEscapeSequence: '',
    win32InputMode: false,
    kittyKeyboard: {
      flags: 0,
      mainFlags: 0,
      altFlags: 0,
      mainStack: [],
      altStack: [],
    },
  };
}

export function cloneKeyboardProtocolState(state: TrackedKeyboardProtocolState): PtyKeyboardProtocolState {
  return {
    bracketedPasteMode: state.bracketedPasteMode,
    win32InputMode: state.win32InputMode,
    kittyKeyboard: {
      flags: state.kittyKeyboard.flags,
      mainFlags: state.kittyKeyboard.mainFlags,
      altFlags: state.kittyKeyboard.altFlags,
      mainStack: [...state.kittyKeyboard.mainStack],
      altStack: [...state.kittyKeyboard.altStack],
    },
  };
}

function getPendingKeyboardProtocolSequenceTail(data: string): string {
  const start = data.lastIndexOf('\x1b[');
  if (start === -1) {
    return '';
  }

  const tail = data.slice(start);
  if (tail.length > KEYBOARD_PROTOCOL_SEQUENCE_TAIL_LIMIT) {
    return '';
  }

  if (
    tail === '\x1b['
    || /^\x1b\[\?[0-9;]*$/.test(tail)
    || /^\x1b\[=[0-9]*(?:;[0-9]*)?$/.test(tail)
    || /^\x1b\[>[0-9]*$/.test(tail)
    || /^\x1b\[<[0-9]*$/.test(tail)
  ) {
    return tail;
  }

  return '';
}

export function updateKeyboardProtocolStateFromOutput(state: TrackedKeyboardProtocolState, data: string): void {
  const scanData = state.pendingEscapeSequence
    ? `${state.pendingEscapeSequence}${data}`
    : data;
  state.pendingEscapeSequence = getPendingKeyboardProtocolSequenceTail(scanData);
  let match: RegExpExecArray | null;

  KEYBOARD_PROTOCOL_SEQUENCE_PATTERN.lastIndex = 0;
  while ((match = KEYBOARD_PROTOCOL_SEQUENCE_PATTERN.exec(scanData)) !== null) {
    const privateModePrefix = match[1];
    if (privateModePrefix === '?') {
      const params = (match[2] ?? '').split(';').map((value) => Number(value));
      const isSet = match[3] === 'h';
      for (const param of params) {
        if (param === 9001) {
          state.win32InputMode = isSet;
          continue;
        }

        if (param === 2004) {
          state.bracketedPasteMode = isSet;
          continue;
        }

        if (param === 47 || param === 1047 || param === 1049) {
          if (isSet) {
            state.kittyKeyboard.mainFlags = state.kittyKeyboard.flags;
            state.kittyKeyboard.flags = state.kittyKeyboard.altFlags;
            state.activeAltBuffer = true;
          } else {
            state.kittyKeyboard.altFlags = state.kittyKeyboard.flags;
            state.kittyKeyboard.flags = state.kittyKeyboard.mainFlags;
            state.activeAltBuffer = false;
          }
        }
      }
      continue;
    }

    const kittySetFlags = match[4];
    if (kittySetFlags !== undefined) {
      const flags = Number(kittySetFlags) || 0;
      const mode = match[5] !== undefined ? Number(match[5]) || 1 : 1;
      switch (mode) {
        case 1:
          state.kittyKeyboard.flags = flags;
          break;
        case 2:
          state.kittyKeyboard.flags |= flags;
          break;
        case 3:
          state.kittyKeyboard.flags &= ~flags;
          break;
      }
      continue;
    }

    const kittyPushFlags = match[6];
    if (kittyPushFlags !== undefined) {
      const stack = state.activeAltBuffer ? state.kittyKeyboard.altStack : state.kittyKeyboard.mainStack;
      if (stack.length >= 16) {
        stack.shift();
      }
      stack.push(state.kittyKeyboard.flags);
      state.kittyKeyboard.flags = Number(kittyPushFlags) || 0;
      continue;
    }

    const kittyPopCount = match[7];
    if (kittyPopCount !== undefined) {
      const stack = state.activeAltBuffer ? state.kittyKeyboard.altStack : state.kittyKeyboard.mainStack;
      const count = Math.max(1, Number(kittyPopCount) || 1);
      for (let index = 0; index < count && stack.length > 0; index += 1) {
        state.kittyKeyboard.flags = stack.pop() ?? 0;
      }
      if (stack.length === 0 && count > 0) {
        state.kittyKeyboard.flags = 0;
      }
    }
  }
}
