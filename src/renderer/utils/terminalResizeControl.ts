import type { Terminal } from '@xterm/xterm';
import { splitTerminalResizeControls } from '../../shared/terminal-resize-control';

type WriteJob = {
  operations: ReturnType<typeof splitTerminalResizeControls>;
  done?: () => void;
};

type WriteState = {
  active: boolean;
  jobs: WriteJob[];
};

const writeStates = new WeakMap<Terminal, WriteState>();

export function writeTerminalWithResizeControls(
  terminal: Terminal,
  data: string,
  done?: () => void,
): void {
  const state = writeStates.get(terminal) ?? { active: false, jobs: [] };
  writeStates.set(terminal, state);
  state.jobs.push({ operations: splitTerminalResizeControls(data), done });
  drainTerminalWrites(terminal, state);
}

function drainTerminalWrites(terminal: Terminal, state: WriteState): void {
  if (state.active) {
    return;
  }
  const job = state.jobs[0];
  if (!job) {
    return;
  }
  const operation = job.operations.shift();
  if (!operation) {
    state.jobs.shift();
    job.done?.();
    drainTerminalWrites(terminal, state);
    return;
  }
  if (operation.type === 'resize') {
    terminal.resize(operation.cols, operation.rows);
    drainTerminalWrites(terminal, state);
    return;
  }
  state.active = true;
  let completed = false;
  terminal.write(operation.data, () => {
    // xterm can invoke the previous write callback again when resize() flushes
    // its write buffer. A repeated callback must not advance this queue twice.
    if (completed) {
      return;
    }
    completed = true;
    queueMicrotask(() => {
      state.active = false;
      drainTerminalWrites(terminal, state);
    });
  });
}
