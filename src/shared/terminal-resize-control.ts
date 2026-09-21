export const SYNAPSE_TERMINAL_RESIZE_OSC = 777;

const RESIZE_PAYLOAD_PATTERN = /^synapse-resize:(\d+):(\d+)$/;

export type TerminalReplaySize = {
  cols: number;
  rows: number;
};

export type TerminalReplayOperation =
  | { type: 'data'; data: string }
  | ({ type: 'resize' } & TerminalReplaySize);

export function createTerminalResizeControl(cols: number, rows: number): string {
  const safeCols = Math.max(2, Math.floor(cols));
  const safeRows = Math.max(1, Math.floor(rows));
  return `\u001b]${SYNAPSE_TERMINAL_RESIZE_OSC};synapse-resize:${safeCols}:${safeRows}\u0007`;
}

export function parseTerminalResizeControl(payload: string): TerminalReplaySize | null {
  const match = RESIZE_PAYLOAD_PATTERN.exec(payload);
  if (!match) {
    return null;
  }

  const cols = Number(match[1]);
  const rows = Number(match[2]);
  if (!Number.isInteger(cols) || cols < 2 || !Number.isInteger(rows) || rows < 1) {
    return null;
  }

  return { cols, rows };
}

export function splitTerminalResizeControls(data: string): TerminalReplayOperation[] {
  const operations: TerminalReplayOperation[] = [];
  const pattern = /\u001b\]777;synapse-resize:(\d+):(\d+)(?:\u0007|\u001b\\)/g;
  let offset = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(data)) !== null) {
    if (match.index > offset) {
      operations.push({ type: 'data', data: data.slice(offset, match.index) });
    }
    const size = parseTerminalResizeControl(`synapse-resize:${match[1]}:${match[2]}`);
    if (size) {
      operations.push({ type: 'resize', ...size });
    } else {
      operations.push({ type: 'data', data: match[0] });
    }
    offset = pattern.lastIndex;
  }

  if (offset < data.length) {
    operations.push({ type: 'data', data: data.slice(offset) });
  }
  return operations;
}
