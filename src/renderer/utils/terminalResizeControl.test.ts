import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { createTerminalResizeControl } from '../../shared/terminal-resize-control';
import { writeTerminalWithResizeControls } from './terminalResizeControl';

const require = createRequire(import.meta.url);
const { Terminal } = require('@xterm/xterm') as typeof import('@xterm/xterm');

function writeTerminal(terminal: InstanceType<typeof Terminal>, data: string): Promise<void> {
  return new Promise((resolve) => writeTerminalWithResizeControls(terminal, data, resolve));
}

describe('terminal resize replay control', () => {
  it('resizes at the recorded position without rendering the private marker', async () => {
    const terminal = new Terminal({ cols: 80, rows: 30, scrollback: 100 });
    const observed: Array<{ cols: number; rows: number }> = [];
    const resizeDisposable = terminal.onResize((size) => observed.push(size));

    try {
      await writeTerminal(
        terminal,
        `before${createTerminalResizeControl(120, 40)}after`,
      );

      expect(terminal).toMatchObject({ cols: 120, rows: 40 });
      expect(observed).toContainEqual(expect.objectContaining({ cols: 120, rows: 40 }));
      expect(terminal.buffer.active.getLine(0)?.translateToString(true)).toBe('beforeafter');
    } finally {
      resizeDisposable.dispose();
      terminal.dispose();
    }
  });
});
