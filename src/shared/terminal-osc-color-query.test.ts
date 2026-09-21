import { describe, expect, it } from 'vitest';
import {
  consumeTerminalOscColorQueries,
  parseTerminalOscColorQuery,
  terminalOscColorQueryReply,
} from './terminal-osc-color-query';

const colors = {
  foreground: '#d7d7d7',
  background: '#000000',
};

describe('terminal OSC color queries', () => {
  it('produces the exact xterm-compatible foreground and background replies', () => {
    expect(terminalOscColorQueryReply(colors, 10)).toBe(
      '\x1b]10;rgb:d7d7/d7d7/d7d7\x1b\\',
    );
    expect(terminalOscColorQueryReply(colors, 11)).toBe(
      '\x1b]11;rgb:0000/0000/0000\x1b\\',
    );
  });

  it('consumes complete ST and BEL terminated queries without hiding other output', () => {
    const result = consumeTerminalOscColorQueries(
      'before\x1b]10;?\x1b\\middle\x1b]11;?\x07after',
      '',
      colors,
    );

    expect(result).toEqual({
      output: 'beforemiddleafter',
      pending: '',
      replies: [
        '\x1b]10;rgb:d7d7/d7d7/d7d7\x1b\\',
        '\x1b]11;rgb:0000/0000/0000\x1b\\',
      ],
    });
  });

  it('answers a combined foreground and background query in protocol order', () => {
    const result = consumeTerminalOscColorQueries('\x1b]10;?;?\x1b\\', '', colors);

    expect(result.output).toBe('');
    expect(result.replies).toEqual([
      '\x1b]10;rgb:d7d7/d7d7/d7d7\x1b\\',
      '\x1b]11;rgb:0000/0000/0000\x1b\\',
    ]);
  });

  it('holds a split query until its ST terminator is complete', () => {
    const first = consumeTerminalOscColorQueries('prompt\x1b]10;?\x1b', '', colors);
    expect(first).toEqual({
      output: 'prompt',
      pending: '\x1b]10;?\x1b',
      replies: [],
    });

    const second = consumeTerminalOscColorQueries('\\tail', first.pending, colors);
    expect(second).toEqual({
      output: 'tail',
      pending: '',
      replies: ['\x1b]10;rgb:d7d7/d7d7/d7d7\x1b\\'],
    });
  });

  it('preserves color-setting commands and query-shaped malformed data exactly', () => {
    const data = '\x1b]10;#123456\x1b\\x\x1b]11;?not-a-query\x07';
    const result = consumeTerminalOscColorQueries(data, '', colors);

    expect(result).toEqual({ output: data, pending: '', replies: [] });
  });

  it('recognizes only exact supported query bodies', () => {
    expect(parseTerminalOscColorQuery('\x1b]10;?\x1b\\', 0).kind).toBe('match');
    expect(parseTerminalOscColorQuery('\x1b]10;?;?\x1b\\', 0).kind).toBe('match');
    expect(parseTerminalOscColorQuery('\x1b]11;?;?\x1b\\', 0).kind).toBe('none');
  });
});
