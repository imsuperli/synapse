export const OSC8_HYPERLINK_CLOSE = '\u001b]8;;\u0007';

type OscParserState = 'ground' | 'escape' | 'osc' | 'oscEscape';

export interface TerminalOsc8Guard {
  sanitize(data: string, options?: { closeAtEnd?: boolean }): string;
  reset(): void;
}

const ESC = '\u001b';
const BEL = '\u0007';
const OSC_C1 = '\u009d';
const ST_C1 = '\u009c';
const CAN = '\u0018';
const SUB = '\u001a';
const OSC_PAYLOAD_LIMIT = 8192;

function isLineBreak(char: string): boolean {
  return char === '\n' || char === '\r';
}

function isPrintableText(char: string): boolean {
  return char >= ' ' && char !== ST_C1;
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

  const reset = () => {
    state = 'ground';
    resetOscPayload();
    hyperlinkActive = false;
    activeTextSeen = false;
  };

  const sanitize = (data: string, options: { closeAtEnd?: boolean } = {}) => {
    if (!data) {
      return data;
    }

    const outputParts: string[] = [];
    let lastCopiedIndex = 0;

    const insertCloseBefore = (index: number) => {
      if (lastCopiedIndex < index) {
        outputParts.push(data.slice(lastCopiedIndex, index));
      }
      outputParts.push(OSC8_HYPERLINK_CLOSE);
      lastCopiedIndex = index;
      hyperlinkActive = false;
      activeTextSeen = false;
    };

    for (let index = 0; index < data.length; index += 1) {
      const char = data[index];

      switch (state) {
        case 'ground':
          if (hyperlinkActive && isLineBreak(char)) {
            insertCloseBefore(index);
          }

          if (char === ESC) {
            state = 'escape';
          } else if (char === OSC_C1) {
            state = 'osc';
            resetOscPayload();
          } else if (hyperlinkActive && isPrintableText(char)) {
            activeTextSeen = true;
          }
          break;

        case 'escape':
          if (char === ']') {
            state = 'osc';
            resetOscPayload();
          } else if (char === ESC) {
            state = 'escape';
          } else if (char === OSC_C1) {
            state = 'osc';
            resetOscPayload();
          } else {
            state = 'ground';
          }
          break;

        case 'osc':
          if (char === BEL || char === ST_C1) {
            finishOsc();
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
          if (char === '\\') {
            finishOsc();
          } else {
            resetOscPayload();
          }
          state = 'ground';
          break;
      }
    }

    if (lastCopiedIndex === 0 && outputParts.length === 0 && !(options.closeAtEnd && hyperlinkActive && state === 'ground')) {
      return data;
    }

    if (lastCopiedIndex < data.length) {
      outputParts.push(data.slice(lastCopiedIndex));
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
