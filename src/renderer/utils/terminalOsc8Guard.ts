export const OSC8_HYPERLINK_CLOSE = '\u001b]8;;\u0007';

type OscParserState = 'ground' | 'escape' | 'osc' | 'oscEscape' | 'csi';

export interface TerminalOsc8Guard {
  sanitize(data: string, options?: { closeAtEnd?: boolean }): string;
  reset(): void;
}

const ESC = '\u001b';
const BEL = '\u0007';
const OSC_C1 = '\u009d';
const ST_C1 = '\u009c';
const CSI_C1 = '\u009b';
const CAN = '\u0018';
const SUB = '\u001a';
const OSC_PAYLOAD_LIMIT = 8192;
const CSI_PAYLOAD_LIMIT = 1024;

function isLineBreak(char: string): boolean {
  return char === '\n' || char === '\r';
}

function isPrintableText(char: string): boolean {
  return char >= ' ' && char !== ST_C1;
}

function isCsiFinal(char: string): boolean {
  const code = char.charCodeAt(0);
  return code >= 0x40 && code <= 0x7e;
}

function csiPayloadHasSgrReset(payload: string): boolean {
  if (!payload) {
    return true;
  }

  return payload
    .split(';')
    .some((param) => {
      const normalized = param.trim();
      return normalized === '' || normalized.split(':')[0] === '0';
    });
}

function shouldCloseBeforeCsi(payload: string, final: string, activeTextSeen: boolean): boolean {
  if (final !== 'm') {
    return true;
  }

  return activeTextSeen && csiPayloadHasSgrReset(payload);
}

function shouldCloseBeforeEscapeFinal(char: string): boolean {
  return char === 'c'
    || char === 'D'
    || char === 'E'
    || char === 'M'
    || char === '7'
    || char === '8'
    || char === 'H'
    || char === '='
    || char === '>';
}

function parseOsc8Payload(payload: string): 'open' | 'close' | 'ignore' {
  if (!payload.startsWith('8;')) {
    return 'ignore';
  }

  const data = payload.slice(2);
  const delimiterIndex = data.indexOf(';');
  if (delimiterIndex === -1) {
    return 'ignore';
  }

  const params = data.slice(0, delimiterIndex).trim();
  const uri = data.slice(delimiterIndex + 1);
  if (uri) {
    return 'open';
  }

  return params ? 'ignore' : 'close';
}

export function createTerminalOsc8Guard(): TerminalOsc8Guard {
  let state: OscParserState = 'ground';
  let oscPayload = '';
  let oscPayloadOverflow = false;
  let csiPayload = '';
  let csiPayloadOverflow = false;
  let bufferedControl = '';
  let hyperlinkActive = false;
  let activeTextSeen = false;

  const resetOscPayload = () => {
    oscPayload = '';
    oscPayloadOverflow = false;
  };

  const finishOsc = () => {
    if (!oscPayloadOverflow) {
      const action = parseOsc8Payload(oscPayload);
      if (action === 'open') {
        hyperlinkActive = true;
        activeTextSeen = false;
      } else if (action === 'close') {
        hyperlinkActive = false;
        activeTextSeen = false;
      }
    }

    resetOscPayload();
  };

  const appendOscPayload = (char: string) => {
    if (oscPayloadOverflow) {
      return;
    }

    if (oscPayload.length >= OSC_PAYLOAD_LIMIT) {
      oscPayload = '';
      oscPayloadOverflow = true;
      return;
    }

    oscPayload += char;
  };

  const resetCsiPayload = () => {
    csiPayload = '';
    csiPayloadOverflow = false;
  };

  const appendCsiPayload = (char: string) => {
    if (csiPayloadOverflow) {
      return;
    }

    if (csiPayload.length >= CSI_PAYLOAD_LIMIT) {
      csiPayload = '';
      csiPayloadOverflow = true;
      return;
    }

    csiPayload += char;
  };

  const reset = () => {
    state = 'ground';
    resetOscPayload();
    resetCsiPayload();
    bufferedControl = '';
    hyperlinkActive = false;
    activeTextSeen = false;
  };

  const sanitize = (data: string, options: { closeAtEnd?: boolean } = {}) => {
    if (!data) {
      return data;
    }

    const outputParts: string[] = [];

    const insertClose = () => {
      outputParts.push(OSC8_HYPERLINK_CLOSE);
      hyperlinkActive = false;
      activeTextSeen = false;
    };

    const writeControl = (shouldCloseBefore: boolean) => {
      if (shouldCloseBefore) {
        insertClose();
      }
      outputParts.push(bufferedControl);
      bufferedControl = '';
    };

    const writeChar = (char: string) => {
      if (bufferedControl) {
        bufferedControl += char;
      } else {
        outputParts.push(char);
      }
    };

    const beginBufferedControl = (char: string) => {
      if (hyperlinkActive && activeTextSeen) {
        bufferedControl = char;
      } else {
        outputParts.push(char);
      }
    };

    for (let index = 0; index < data.length; index += 1) {
      const char = data[index];

      switch (state) {
        case 'ground':
          if (hyperlinkActive && isLineBreak(char)) {
            insertClose();
          }

          if (char === ESC) {
            beginBufferedControl(char);
            state = 'escape';
          } else if (char === OSC_C1) {
            beginBufferedControl(char);
            state = 'osc';
            resetOscPayload();
          } else if (char === CSI_C1) {
            beginBufferedControl(char);
            state = 'csi';
            resetCsiPayload();
          } else if (hyperlinkActive && isPrintableText(char)) {
            outputParts.push(char);
            activeTextSeen = true;
          } else {
            outputParts.push(char);
          }
          break;

        case 'escape':
          writeChar(char);
          if (char === ']') {
            state = 'osc';
            resetOscPayload();
          } else if (char === '[') {
            state = 'csi';
            resetCsiPayload();
          } else if (char === ESC) {
            state = 'escape';
          } else if (char === OSC_C1) {
            state = 'osc';
            resetOscPayload();
          } else if (char === CSI_C1) {
            state = 'csi';
            resetCsiPayload();
          } else {
            if (bufferedControl) {
              writeControl(hyperlinkActive && shouldCloseBeforeEscapeFinal(char));
            }
            state = 'ground';
          }
          break;

        case 'osc':
          writeChar(char);
          if (char === BEL || char === ST_C1) {
            finishOsc();
            if (bufferedControl) {
              writeControl(false);
            }
            state = 'ground';
          } else if (char === ESC) {
            state = 'oscEscape';
          } else if (char === CAN || char === SUB) {
            resetOscPayload();
            state = 'ground';
          } else {
            appendOscPayload(char);
          }
          break;

        case 'oscEscape':
          writeChar(char);
          if (char === '\\') {
            finishOsc();
            if (bufferedControl) {
              writeControl(false);
            }
          } else {
            resetOscPayload();
            if (bufferedControl) {
              writeControl(false);
            }
          }
          state = 'ground';
          break;

        case 'csi':
          writeChar(char);
          if (char === CAN || char === SUB) {
            resetCsiPayload();
            if (bufferedControl) {
              writeControl(false);
            }
            state = 'ground';
          } else if (char === ESC) {
            resetCsiPayload();
            if (bufferedControl) {
              writeControl(false);
            }
            beginBufferedControl(char);
            state = 'escape';
          } else if (isCsiFinal(char)) {
            if (
              bufferedControl
            ) {
              writeControl(
                hyperlinkActive
                && !csiPayloadOverflow
                && shouldCloseBeforeCsi(csiPayload, char, activeTextSeen),
              );
            }
            resetCsiPayload();
            state = 'ground';
          } else {
            appendCsiPayload(char);
          }
          break;
      }
    }

    if (outputParts.length === 0 && bufferedControl) {
      return '';
    }

    if (options.closeAtEnd && hyperlinkActive && state === 'ground') {
      outputParts.push(OSC8_HYPERLINK_CLOSE);
      hyperlinkActive = false;
      activeTextSeen = false;
    }

    return outputParts.join('');
  };

  return {
    sanitize,
    reset,
  };
}
