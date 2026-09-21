import { Terminal } from '@xterm/xterm';
import { describe, expect, it } from 'vitest';
import { installTerminalScrollbackPreservation } from '../terminalScrollbackPreservation';

function writeTerminal(terminal: Terminal, data: string): Promise<void> {
  return new Promise((resolve) => terminal.write(data, resolve));
}

function readNormalBufferLines(terminal: Terminal): string[] {
  return Array.from(
    { length: terminal.buffer.normal.length },
    (_, index) => terminal.buffer.normal.getLine(index)?.translateToString(true) ?? '',
  );
}

function readVisibleNormalBufferLines(terminal: Terminal): string[] {
  const start = terminal.buffer.normal.viewportY;
  return readNormalBufferLines(terminal).slice(start, start + terminal.rows);
}

describe('terminal scrollback preservation', () => {
  it('keeps history when the Codex inline viewport grows', async () => {
    const terminal = new Terminal({ cols: 20, rows: 10, scrollback: 100 });
    const dispose = installTerminalScrollbackPreservation(terminal);

    try {
      await writeTerminal(
        terminal,
        Array.from(
          { length: 20 },
          (_, index) => `LINE-${String(index + 1).padStart(2, '0')}\r\n`,
        ).join(''),
      );

      const visibleBefore = readVisibleNormalBufferLines(terminal);

      // Codex grows its lower composer/status viewport by scrolling the upper
      // history region. Its ratatui backend emits DECSTBM + SU + DECSTBM reset.
      await writeTerminal(terminal, '\x1b[1;7r');
      await writeTerminal(terminal, '\x1b[3');
      await writeTerminal(terminal, 'S\x1b[r');

      const allLinesAfter = readNormalBufferLines(terminal);
      const visibleAfter = readVisibleNormalBufferLines(terminal);
      expect(allLinesAfter).toEqual(expect.arrayContaining([
        'LINE-12',
        'LINE-13',
        'LINE-14',
      ]));
      expect(visibleAfter.slice(7)).toEqual(visibleBefore.slice(7));
      expect(visibleAfter.slice(0, 7)).toEqual([
        'LINE-15',
        'LINE-16',
        'LINE-17',
        'LINE-18',
        '',
        '',
        '',
      ]);
    } finally {
      dispose();
      terminal.dispose();
    }
  });

  it('keeps the viewport stable while the user is reading earlier output', async () => {
    const terminal = new Terminal({ cols: 20, rows: 10, scrollback: 100 });
    const dispose = installTerminalScrollbackPreservation(terminal);

    try {
      await writeTerminal(
        terminal,
        Array.from({ length: 30 }, (_, index) => `LINE-${index + 1}\r\n`).join(''),
      );
      terminal.scrollLines(-5);
      const viewportYBefore = terminal.buffer.normal.viewportY;

      await writeTerminal(terminal, '\x1b[1;7r\x1b[2S\x1b[r');

      expect(terminal.buffer.normal.viewportY).toBe(viewportYBefore);
    } finally {
      dispose();
      terminal.dispose();
    }
  });

  it('keeps visible history stable when live output reaches the scrollback limit', async () => {
    const terminal = new Terminal({ cols: 20, rows: 10, scrollback: 100 });
    const dispose = installTerminalScrollbackPreservation(terminal);

    try {
      await writeTerminal(
        terminal,
        Array.from({ length: 110 }, (_, index) => `OLD-${index + 1}\r\n`).join(''),
      );
      terminal.scrollToLine(40);
      const viewportYBefore = terminal.buffer.normal.viewportY;
      const visibleBefore = readVisibleNormalBufferLines(terminal);

      await writeTerminal(
        terminal,
        Array.from({ length: 60 }, (_, index) => `NEW-${index + 1}\r\n`).join(''),
      );

      expect(terminal.options.scrollback).toBe(1000);
      expect(terminal.buffer.normal.viewportY).toBe(viewportYBefore);
      expect(readVisibleNormalBufferLines(terminal)).toEqual(visibleBefore);
    } finally {
      dispose();
      terminal.dispose();
    }
  });

  it('releases temporary scrollback after the reader returns to live output', async () => {
    const terminal = new Terminal({ cols: 20, rows: 10, scrollback: 100 });
    const dispose = installTerminalScrollbackPreservation(terminal);

    try {
      await writeTerminal(
        terminal,
        Array.from({ length: 110 }, (_, index) => `OLD-${index + 1}\r\n`).join(''),
      );
      terminal.scrollToLine(40);
      await writeTerminal(terminal, 'NEW\r\n');
      expect(terminal.options.scrollback).toBe(1000);

      terminal.scrollToBottom();
      await writeTerminal(terminal, 'LIVE\r\n');

      expect(terminal.options.scrollback).toBe(100);
      expect(terminal.buffer.normal.viewportY).toBe(terminal.buffer.normal.baseY);
    } finally {
      dispose();
      terminal.dispose();
    }
  });

  it('restores xterm scrolling when the preservation handler is disposed', async () => {
    const terminal = new Terminal({ cols: 20, rows: 10, scrollback: 100 });
    const dispose = installTerminalScrollbackPreservation(terminal);

    try {
      await writeTerminal(
        terminal,
        Array.from({ length: 110 }, (_, index) => `OLD-${index + 1}\r\n`).join(''),
      );
      terminal.scrollToLine(40);
      const viewportYBefore = terminal.buffer.normal.viewportY;
      dispose();

      await writeTerminal(terminal, 'NEW\r\n');

      expect(terminal.options.scrollback).toBe(100);
      expect(terminal.buffer.normal.viewportY).toBe(viewportYBefore - 1);
    } finally {
      terminal.dispose();
    }
  });

  it('leaves scroll regions that do not start at row 1 to xterm', async () => {
    const terminal = new Terminal({ cols: 20, rows: 10, scrollback: 100 });
    const dispose = installTerminalScrollbackPreservation(terminal);

    try {
      await writeTerminal(
        terminal,
        Array.from({ length: 20 }, (_, index) => `LINE-${index + 1}\r\n`).join(''),
      );
      const baseYBefore = terminal.buffer.normal.baseY;

      await writeTerminal(terminal, '\x1b[2;7r\x1b[3S\x1b[r');

      expect(terminal.buffer.normal.baseY).toBe(baseYBefore);
    } finally {
      dispose();
      terminal.dispose();
    }
  });

  it('does not add alternate-screen region scrolls to normal scrollback', async () => {
    const terminal = new Terminal({ cols: 20, rows: 10, scrollback: 100 });
    const dispose = installTerminalScrollbackPreservation(terminal);

    try {
      await writeTerminal(terminal, 'NORMAL\r\n\x1b[?1049h');
      const normalLengthBefore = terminal.buffer.normal.length;

      await writeTerminal(terminal, 'ALT-1\r\nALT-2\r\n\x1b[1;7r\x1b[2S\x1b[r');

      expect(terminal.buffer.normal.length).toBe(normalLengthBefore);
      expect(terminal.buffer.active.type).toBe('alternate');
    } finally {
      dispose();
      terminal.dispose();
    }
  });
});
