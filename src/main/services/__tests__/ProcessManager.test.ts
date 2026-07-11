import { describe, it, expect, beforeEach, vi } from 'vitest';

const ptyTestHarness = vi.hoisted(() => {
  let nextPid = 4321;

  function createMockPtyProcess(pid = nextPid++) {
    return {
      pid,
      onData: vi.fn(() => ({ dispose: vi.fn() })),
      onExit: vi.fn(() => ({ dispose: vi.fn() })),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
    };
  }

  const nodePty = {
    spawn: vi.fn(() => createMockPtyProcess()),
  };

  (globalThis as { __SYNAPSE_TEST_NODE_PTY__?: unknown }).__SYNAPSE_TEST_NODE_PTY__ = nodePty;

  return {
    nodePty,
    createMockPtyProcess,
  };
});

vi.mock('electron', () => ({
  app: {
    getAppPath: () => process.cwd(),
    getPath: () => process.cwd(),
    isPackaged: false,
  },
}));

import { ProcessManager } from '../ProcessManager';
import { ProcessStatus } from '../../types/process';
import { TmuxCompatService } from '../TmuxCompatService';
import { WindowStatus } from '../../../shared/types/window';
import * as fs from 'fs';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';

function getPtyModule() {
  return ptyTestHarness.nodePty;
}

function makeMockPtyProcess(pid = 4321) {
  return ptyTestHarness.createMockPtyProcess(pid);
}

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
  kittyKeyboard: {
    flags: 0,
    mainFlags: 0,
    altFlags: 0,
    mainStack: [],
    altStack: [],
  },
};

describe('ProcessManager', () => {
  let processManager: ProcessManager;
  const testWorkingDir = tmpdir(); // Use real temp directory

  beforeEach(() => {
    processManager = new ProcessManager();
  });

  describe('warmupConPtyDll', () => {
    it('runs ConPTY warmup only once per process manager', async () => {
      if (process.platform !== 'win32') {
        return;
      }

      const ptyModule = (() => {
        return require('node-pty');
      })();

      const spawnSpy = vi.spyOn(ptyModule, 'spawn');
      spawnSpy.mockImplementation(() => {
        let exitHandler: (() => void) | undefined;
        queueMicrotask(() => exitHandler?.());

        return {
          onExit: (handler: () => void) => {
            exitHandler = handler;
            return { dispose: vi.fn() };
          },
          kill: vi.fn(),
        } as any;
      });

      try {
        await Promise.all([
          processManager.warmupConPtyDll(),
          processManager.warmupConPtyDll(),
        ]);
        await processManager.warmupConPtyDll();

        expect(spawnSpy).toHaveBeenCalledOnce();
      } finally {
        spawnSpy.mockRestore();
      }
    });

    it('tracks firstSeq and gap when replay history evicts old chunks', async () => {
      const ptyModule = getPtyModule();
      const dataListeners: Array<(data: string) => void> = [];
      (processManager as unknown as { PANE_HISTORY_CHUNK_LIMIT: number }).PANE_HISTORY_CHUNK_LIMIT = 3;

      const spawnSpy = vi.spyOn(ptyModule, 'spawn');
      spawnSpy.mockImplementation(() => ({
        ...makeMockPtyProcess(4328),
        onData: vi.fn((handler: (data: string) => void) => {
          dataListeners.push(handler);
          return { dispose: vi.fn() };
        }),
      }) as any);

      try {
        await processManager.spawnTerminal({
          workingDirectory: testWorkingDir,
          windowId: 'win-history-evict',
          paneId: 'pane-history-evict',
        });

        for (let i = 1; i <= 5; i += 1) {
          dataListeners.forEach((listener) => listener(`chunk-${i}`));
        }

        expect(processManager.getPtyHistory('pane-history-evict')).toEqual({
          chunks: ['chunk-3', 'chunk-4', 'chunk-5'],
          firstSeq: 3,
          lastSeq: 5,
          evictedBeforeSeq: 2,
          keyboardState: defaultKeyboardProtocolState,
        });

        expect(processManager.getPtyHistoryEntriesSince('pane-history-evict', 1)).toEqual({
          entries: [
            { seq: 3, data: 'chunk-3' },
            { seq: 4, data: 'chunk-4' },
            { seq: 5, data: 'chunk-5' },
          ],
          firstSeq: 3,
          lastSeq: 5,
          evictedBeforeSeq: 2,
          gap: true,
          hasMoreBefore: false,
        });

        expect(processManager.getPtyHistoryEntriesSince('pane-history-evict', 3)).toMatchObject({
          entries: [
            { seq: 4, data: 'chunk-4' },
            { seq: 5, data: 'chunk-5' },
          ],
          gap: false,
        });

        expect(processManager.getPtyHistoryEntriesBefore('pane-history-evict', 5, {
          limitBytes: 8,
        })).toEqual({
          entries: [{ seq: 4, data: 'chunk-4' }],
          firstSeq: 4,
          lastSeq: 4,
          evictedBeforeSeq: 2,
          gap: false,
          hasMoreBefore: true,
        });
      } finally {
        spawnSpy.mockRestore();
      }
    });
  });

  describe('spawnTerminal', () => {
    it('creates a new terminal process with valid config', async () => {
      const config = {
        workingDirectory: testWorkingDir,
        command: 'pwsh.exe',
      };

      const handle = await processManager.spawnTerminal(config);

      expect(handle).toBeDefined();
      expect(handle.pid).toBeGreaterThan(0);
      expect(handle.pty).toBeDefined();
    });

    it('throws error if working directory does not exist', async () => {
      const config = {
        workingDirectory: '/invalid/dir/that/does/not/exist',
      };

      await expect(processManager.spawnTerminal(config)).rejects.toThrow(
        'Working directory does not exist'
      );
    });

    it('uses default shell when command is not provided', async () => {
      const config = {
        workingDirectory: testWorkingDir,
      };

      const handle = await processManager.spawnTerminal(config);
      const status = processManager.getProcessStatus(handle.pid);

      expect(status).toBeDefined();
      expect(status?.command).toBeDefined();
      // Should use platform default shell.
      expect(status?.command).toMatch(/(pwsh|cmd|zsh|bash|sh)/);
    });

    it('tracks terminal dimensions from spawn config and resize events', async () => {
      const handle = await processManager.spawnTerminal({
        workingDirectory: testWorkingDir,
        windowId: 'win-dimensions',
        paneId: 'pane-dimensions',
        initialCols: 120,
        initialRows: 40,
      });

      expect(processManager.getPaneTerminalDimensions('pane-dimensions')).toEqual({
        cols: 120,
        rows: 40,
      });

      processManager.resizePty(handle.pid, 96, 28);

      expect(processManager.getPaneTerminalDimensions('pane-dimensions')).toEqual({
        cols: 96,
        rows: 28,
      });
    });

    it('uses the global default shell when the window does not override it', async () => {
      const processManagerWithGlobalShell = new ProcessManager(
        () => ({
          terminal: {
            useBundledConptyDll: true,
            defaultShellProgram: 'powershell.exe',
          },
        } as any),
      );

      const handle = await processManagerWithGlobalShell.spawnTerminal({
        workingDirectory: testWorkingDir,
      });
      const status = processManagerWithGlobalShell.getProcessStatus(handle.pid);

      expect(status?.command).toBe('powershell.exe');
    });

    it('prefers the window shell over the global default shell', async () => {
      const processManagerWithGlobalShell = new ProcessManager(
        () => ({
          terminal: {
            useBundledConptyDll: true,
            defaultShellProgram: 'powershell.exe',
          },
        } as any),
      );

      const handle = await processManagerWithGlobalShell.spawnTerminal({
        workingDirectory: testWorkingDir,
        command: 'cmd.exe',
      });
      const status = processManagerWithGlobalShell.getProcessStatus(handle.pid);

      expect(status?.command).toBe('cmd.exe');
    });

    it('passes shell arguments through to the real PTY spawn path', async () => {
      const tempDir = mkdtempSync(path.join(tmpdir(), 'synapse-shell-'));
      const shellPath = path.join(tempDir, process.platform === 'win32' ? 'custom shell.exe' : 'custom shell');
      writeFileSync(shellPath, '');

      const ptyModule = getPtyModule();
      const spawnSpy = vi.spyOn(ptyModule, 'spawn');
      spawnSpy.mockImplementation(() => makeMockPtyProcess() as any);

      try {
        const command = `${shellPath} --login --trace`;
        const handle = await processManager.spawnTerminal({
          workingDirectory: testWorkingDir,
          command,
        });

        expect(spawnSpy).toHaveBeenCalledWith(
          shellPath,
          ['--login', '--trace'],
          expect.any(Object),
        );
        expect(processManager.getProcessStatus(handle.pid)?.command).toBe(command);
      } finally {
        spawnSpy.mockRestore();
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('repairs node-pty spawn-helper execute permissions on macOS before spawning', async () => {
      if (process.platform !== 'darwin') {
        return;
      }

      const tempDir = mkdtempSync(path.join(tmpdir(), 'synapse-node-pty-'));
      const helperPath = path.join(tempDir, 'node_modules', 'node-pty', 'prebuilds', 'darwin-arm64', 'spawn-helper');
      writeFileSync(helperPath, '');
      fs.chmodSync(helperPath, 0o600);

      const originalCwd = process.cwd();
      const ptyModule = getPtyModule();
      const spawnSpy = vi.spyOn(ptyModule, 'spawn');
      spawnSpy.mockImplementation(() => makeMockPtyProcess(4323) as any);

      try {
        process.chdir(tempDir);
        const processManagerForMac = new ProcessManager();

        await processManagerForMac.spawnTerminal({
          workingDirectory: testWorkingDir,
          command: '/bin/zsh',
        });

        expect(fs.statSync(helperPath).mode & 0o777).toBe(0o755);
      } finally {
        process.chdir(originalCwd);
        spawnSpy.mockRestore();
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('keeps an explicit shell path with spaces as the executable when no args are provided', async () => {
      const tempDir = mkdtempSync(path.join(tmpdir(), 'synapse-shell-'));
      const shellPath = path.join(tempDir, process.platform === 'win32' ? 'custom shell.exe' : 'custom shell');
      writeFileSync(shellPath, '');

      const ptyModule = getPtyModule();
      const spawnSpy = vi.spyOn(ptyModule, 'spawn');
      spawnSpy.mockImplementation(() => makeMockPtyProcess(4322) as any);

      try {
        await processManager.spawnTerminal({
          workingDirectory: testWorkingDir,
          command: shellPath,
        });

        expect(spawnSpy).toHaveBeenCalledWith(
          shellPath,
          [],
          expect.any(Object),
        );
      } finally {
        spawnSpy.mockRestore();
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('skips forcing a macOS login shell when tmux shim PATH injection is enabled', () => {
      const tempDir = mkdtempSync(path.join(tmpdir(), 'synapse-shell-'));
      const shellPath = path.join(tempDir, 'zsh');
      writeFileSync(shellPath, '');
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      try {
        const tmuxEnabledProcessManager = new ProcessManager(
          () => ({ tmux: { enabled: true, autoInjectPath: true } } as any),
        );

        const launch = (tmuxEnabledProcessManager as any).resolveLaunchCommand({
          workingDirectory: testWorkingDir,
          command: shellPath,
        });

        expect(launch.file).toBe(shellPath);
        expect(launch.args).toEqual([]);
      } finally {
        Object.defineProperty(process, 'platform', { value: originalPlatform });
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('still forces a macOS login shell when tmux shim PATH injection is disabled', () => {
      const tempDir = mkdtempSync(path.join(tmpdir(), 'synapse-shell-'));
      const shellPath = path.join(tempDir, 'zsh');
      writeFileSync(shellPath, '');
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      try {
        const tmuxDisabledProcessManager = new ProcessManager(
          () => ({ tmux: { enabled: true, autoInjectPath: false } } as any),
        );

        const launch = (tmuxDisabledProcessManager as any).resolveLaunchCommand({
          workingDirectory: testWorkingDir,
          command: shellPath,
        });

        expect(launch.file).toBe(shellPath);
        expect(launch.args).toEqual(['-l']);
      } finally {
        Object.defineProperty(process, 'platform', { value: originalPlatform });
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('emits process-created event', async () => {
      const config = {
        workingDirectory: testWorkingDir,
      };

      const eventSpy = vi.fn();
      processManager.on('process-created', eventSpy);

      await processManager.spawnTerminal(config);

      expect(eventSpy).toHaveBeenCalledOnce();
      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          pid: expect.any(Number),
          status: ProcessStatus.Alive,
        })
      );
    });
  });

  describe('killProcess', () => {
    it('terminates an existing process', async () => {
      const config = {
        workingDirectory: testWorkingDir,
      };

      const handle = await processManager.spawnTerminal(config);
      await processManager.killProcess(handle.pid);

      const status = processManager.getProcessStatus(handle.pid);
      expect(status?.status).toBe(ProcessStatus.Exited);
      expect(status?.exitCode).toBe(0);
    });

    it('throws error if process not found', async () => {
      await expect(processManager.killProcess(9999)).rejects.toThrow(
        'Process not found'
      );
    });

    it('throws error if process already exited', async () => {
      const config = {
        workingDirectory: testWorkingDir,
      };

      const handle = await processManager.spawnTerminal(config);
      await processManager.killProcess(handle.pid);

      await expect(processManager.killProcess(handle.pid)).rejects.toThrow(
        'Process already exited'
      );
    });

    it('emits process-exited event', async () => {
      const config = {
        workingDirectory: testWorkingDir,
      };

      const eventSpy = vi.fn();
      processManager.on('process-exited', eventSpy);

      const handle = await processManager.spawnTerminal(config);
      await processManager.killProcess(handle.pid);

      expect(eventSpy).toHaveBeenCalledOnce();
      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          pid: handle.pid,
          status: ProcessStatus.Exited,
          exitCode: 0,
        })
      );
    });
  });

  describe('exit handling', () => {
    it('marks naturally exited processes as exited and removes the pane index', async () => {
      const ptyModule = getPtyModule();
      let exitHandler: ((event: { exitCode: number; signal?: number }) => void) | undefined;

      const spawnSpy = vi.spyOn(ptyModule, 'spawn');
      spawnSpy.mockImplementation(() => ({
        ...makeMockPtyProcess(4323),
        onExit: vi.fn((handler) => {
          exitHandler = handler;
          return { dispose: vi.fn() };
        }),
      }) as any);

      try {
        const handle = await processManager.spawnTerminal({
          workingDirectory: testWorkingDir,
          windowId: 'win-natural-exit',
          paneId: 'pane-natural-exit',
        });

        exitHandler?.({ exitCode: 7 });

        expect(processManager.getProcessStatus(handle.pid)).toEqual(
          expect.objectContaining({
            status: ProcessStatus.Exited,
            exitCode: 7,
          }),
        );
        expect(processManager.getPidByPane('win-natural-exit', 'pane-natural-exit')).toBeNull();
      } finally {
        spawnSpy.mockRestore();
      }
    });

    it('ignores resize when node-pty reports the PTY has already exited', async () => {
      const ptyModule = getPtyModule();
      const resizeSpy = vi.fn(() => {
        throw new Error('Cannot resize a pty that has already exited');
      });

      const spawnSpy = vi.spyOn(ptyModule, 'spawn');
      spawnSpy.mockImplementation(() => ({
        ...makeMockPtyProcess(4324),
        resize: resizeSpy,
      }) as any);

      try {
        const handle = await processManager.spawnTerminal({
          workingDirectory: testWorkingDir,
          windowId: 'win-resize-exit',
          paneId: 'pane-resize-exit',
        });

        expect(() => processManager.resizePty(handle.pid, 120, 40)).not.toThrow();
        expect(processManager.getProcessStatus(handle.pid)).toEqual(
          expect.objectContaining({
            status: ProcessStatus.Exited,
            exitCode: 0,
          }),
        );
        expect(processManager.getPidByPane('win-resize-exit', 'pane-resize-exit')).toBeNull();
      } finally {
        spawnSpy.mockRestore();
      }
    });

    it('ignores deferred Windows agent resize after node-pty marks the PTY exited', async () => {
      const ptyModule = getPtyModule();
      const agentResizeSpy = vi.fn(() => {
        throw new Error('Cannot resize a pty that has already exited');
      });
      const ptyProcess = {
        ...makeMockPtyProcess(4326),
        _agent: {
          resize: agentResizeSpy,
          exitCode: 9,
        },
        resize(cols: number, rows: number) {
          this._agent.resize(cols, rows);
        },
      };

      const spawnSpy = vi.spyOn(ptyModule, 'spawn');
      spawnSpy.mockImplementation(() => ptyProcess as any);

      try {
        const handle = await processManager.spawnTerminal({
          workingDirectory: testWorkingDir,
          windowId: 'win-deferred-resize-exit',
          paneId: 'pane-deferred-resize-exit',
        });

        expect(() => ptyProcess.resize(120, 40)).not.toThrow();
        expect(agentResizeSpy).toHaveBeenCalledWith(120, 40);
        expect(processManager.getProcessStatus(handle.pid)).toEqual(
          expect.objectContaining({
            status: ProcessStatus.Exited,
            exitCode: 9,
          }),
        );
        expect(processManager.getPidByPane('win-deferred-resize-exit', 'pane-deferred-resize-exit')).toBeNull();
      } finally {
        spawnSpy.mockRestore();
      }
    });
  });

  describe('PTY history', () => {
    it('stores replayable history per pane and resets it on a new session', async () => {
      const ptyModule = getPtyModule();
      const dataListeners: Array<(data: string) => void> = [];

      const spawnSpy = vi.spyOn(ptyModule, 'spawn');
      spawnSpy.mockImplementation(() => ({
        ...makeMockPtyProcess(4325),
        onData: vi.fn((handler: (data: string) => void) => {
          dataListeners.push(handler);
          return { dispose: vi.fn() };
        }),
      }) as any);

      try {
        await processManager.spawnTerminal({
          workingDirectory: testWorkingDir,
          windowId: 'win-history',
          paneId: 'pane-history',
        });

        dataListeners.forEach((listener) => listener('first-output'));
        expect(processManager.getPtyHistory('pane-history')).toEqual({
          chunks: ['first-output'],
          firstSeq: 1,
          lastSeq: 1,
          evictedBeforeSeq: 0,
          keyboardState: defaultKeyboardProtocolState,
        });

        dataListeners.length = 0;

        await processManager.spawnTerminal({
          workingDirectory: testWorkingDir,
          windowId: 'win-history',
          paneId: 'pane-history',
        });

        expect(processManager.getPtyHistory('pane-history')).toEqual({
          chunks: [],
          firstSeq: 0,
          lastSeq: 0,
          evictedBeforeSeq: 0,
          keyboardState: defaultKeyboardProtocolState,
        });

        dataListeners.forEach((listener) => listener('second-output'));
        expect(processManager.getPtyHistory('pane-history')).toEqual({
          chunks: ['second-output'],
          firstSeq: 1,
          lastSeq: 1,
          evictedBeforeSeq: 0,
          keyboardState: defaultKeyboardProtocolState,
        });
      } finally {
        spawnSpy.mockRestore();
      }
    });

    it('keeps remote histories separate for panes with the same pane id in different windows', async () => {
      const ptyModule = getPtyModule();
      const dataListeners: Array<(data: string) => void> = [];
      let nextPid = 4520;

      const spawnSpy = vi.spyOn(ptyModule, 'spawn');
      spawnSpy.mockImplementation(() => ({
        ...makeMockPtyProcess(nextPid++),
        onData: vi.fn((handler: (data: string) => void) => {
          dataListeners.push(handler);
          return { dispose: vi.fn() };
        }),
      }) as any);

      try {
        await processManager.spawnTerminal({
          workingDirectory: testWorkingDir,
          windowId: 'win-a',
          paneId: 'pane-shared',
        });

        dataListeners[0]?.('win-a-output');

        await processManager.spawnTerminal({
          workingDirectory: testWorkingDir,
          windowId: 'win-b',
          paneId: 'pane-shared',
        });

        expect(processManager.getPtyHistory('win-a', 'pane-shared')).toEqual({
          chunks: ['win-a-output'],
          firstSeq: 1,
          lastSeq: 1,
          evictedBeforeSeq: 0,
          keyboardState: defaultKeyboardProtocolState,
        });
        expect(processManager.getPtyHistory('win-b', 'pane-shared')).toEqual({
          chunks: [],
          firstSeq: 0,
          lastSeq: 0,
          evictedBeforeSeq: 0,
          keyboardState: defaultKeyboardProtocolState,
        });

        dataListeners[1]?.('win-b-output');

        expect(processManager.getPtyHistoryEntriesSince('win-a', 'pane-shared', 0)).toMatchObject({
          entries: [{ seq: 1, data: 'win-a-output' }],
          lastSeq: 1,
          gap: false,
        });
        expect(processManager.getPtyHistoryEntriesSince('win-b', 'pane-shared', 0)).toMatchObject({
          entries: [{ seq: 1, data: 'win-b-output' }],
          lastSeq: 1,
          gap: false,
        });
      } finally {
        spawnSpy.mockRestore();
      }
    });

    it('clears pane history when the session exits', async () => {
      const ptyModule = getPtyModule();
      const dataListeners: Array<(data: string) => void> = [];
      let exitHandler: ((event: { exitCode: number; signal?: number }) => void) | undefined;

      const spawnSpy = vi.spyOn(ptyModule, 'spawn');
      spawnSpy.mockImplementation(() => ({
        ...makeMockPtyProcess(4326),
        onData: vi.fn((handler: (data: string) => void) => {
          dataListeners.push(handler);
          return { dispose: vi.fn() };
        }),
        onExit: vi.fn((handler) => {
          exitHandler = handler;
          return { dispose: vi.fn() };
        }),
      }) as any);

      try {
        await processManager.spawnTerminal({
          workingDirectory: testWorkingDir,
          windowId: 'win-history-exit',
          paneId: 'pane-history-exit',
        });

        dataListeners.forEach((listener) => listener('stale-output'));
        expect(processManager.getPtyHistory('pane-history-exit')).toEqual({
          chunks: ['stale-output'],
          firstSeq: 1,
          lastSeq: 1,
          evictedBeforeSeq: 0,
          keyboardState: defaultKeyboardProtocolState,
        });

        exitHandler?.({ exitCode: 255 });

        expect(processManager.getPtyHistory('pane-history-exit')).toEqual({
          chunks: [],
          firstSeq: 0,
          lastSeq: 0,
          evictedBeforeSeq: 0,
          keyboardState: defaultKeyboardProtocolState,
        });
      } finally {
        spawnSpy.mockRestore();
      }
    });

    it('clears replayable chunks without resetting output sequence numbers', async () => {
      const ptyModule = getPtyModule();
      const dataListeners: Array<(data: string) => void> = [];

      const spawnSpy = vi.spyOn(ptyModule, 'spawn');
      spawnSpy.mockImplementation(() => ({
        ...makeMockPtyProcess(4329),
        onData: vi.fn((handler: (data: string) => void) => {
          dataListeners.push(handler);
          return { dispose: vi.fn() };
        }),
      }) as any);

      try {
        await processManager.spawnTerminal({
          workingDirectory: testWorkingDir,
          windowId: 'win-history-clear',
          paneId: 'pane-history-clear',
        });

        dataListeners.forEach((listener) => {
          listener('before-1');
          listener('before-2');
        });
        expect(processManager.getLatestPaneOutputSeq('pane-history-clear')).toBe(2);

        processManager.clearPtyHistory('pane-history-clear');

        expect(processManager.getPtyHistory('pane-history-clear')).toEqual({
          chunks: [],
          firstSeq: 3,
          lastSeq: 2,
          evictedBeforeSeq: 2,
          keyboardState: defaultKeyboardProtocolState,
        });
        expect(processManager.getPtyHistoryEntriesSince('pane-history-clear', 2)).toEqual({
          entries: [],
          firstSeq: 3,
          lastSeq: 2,
          evictedBeforeSeq: 2,
          gap: false,
          hasMoreBefore: false,
        });

        dataListeners.forEach((listener) => listener('after-clear'));

        expect(processManager.getPtyHistory('pane-history-clear')).toEqual({
          chunks: ['after-clear'],
          firstSeq: 3,
          lastSeq: 3,
          evictedBeforeSeq: 2,
          keyboardState: defaultKeyboardProtocolState,
        });
        expect(processManager.getPtyHistoryEntriesSince('pane-history-clear', 2)).toEqual({
          entries: [{ seq: 3, data: 'after-clear' }],
          firstSeq: 3,
          lastSeq: 3,
          evictedBeforeSeq: 2,
          gap: false,
          hasMoreBefore: false,
        });
      } finally {
        spawnSpy.mockRestore();
      }
    });

    it('tracks keyboard protocol state independently of replayable history chunks', async () => {
      const ptyModule = getPtyModule();
      const dataListeners: Array<(data: string) => void> = [];

      const spawnSpy = vi.spyOn(ptyModule, 'spawn');
      spawnSpy.mockImplementation(() => ({
        ...makeMockPtyProcess(4327),
        onData: vi.fn((handler: (data: string) => void) => {
          dataListeners.push(handler);
          return { dispose: vi.fn() };
        }),
      }) as any);

      try {
        await processManager.spawnTerminal({
          workingDirectory: testWorkingDir,
          windowId: 'win-keyboard-history',
          paneId: 'pane-keyboard-history',
        });

        dataListeners.forEach((listener) => {
          listener('\u001b[?9001h\u001b[=5u\u001b[>3u');
          listener('\u001b[<1u\u001b[?9001l\u001b[=0u');
        });

        expect(processManager.getPtyHistory('pane-keyboard-history')).toEqual({
          chunks: ['\u001b[?9001h\u001b[=5u\u001b[>3u', '\u001b[<1u\u001b[?9001l\u001b[=0u'],
          firstSeq: 1,
          lastSeq: 2,
          evictedBeforeSeq: 0,
          keyboardState: defaultKeyboardProtocolState,
        });

        dataListeners.forEach((listener) => {
          listener('\u001b[?900');
          listener('1h\u001b[?2004h\u001b[=');
          listener('5');
          listener('u');
        });

        expect(processManager.getPtyHistory('pane-keyboard-history')).toEqual({
          chunks: [
            '\u001b[?9001h\u001b[=5u\u001b[>3u',
            '\u001b[<1u\u001b[?9001l\u001b[=0u',
            '\u001b[?900',
            '1h\u001b[?2004h\u001b[=',
            '5',
            'u',
          ],
          firstSeq: 1,
          lastSeq: 6,
          evictedBeforeSeq: 0,
          keyboardState: {
            ...defaultKeyboardProtocolState,
            bracketedPasteMode: true,
            win32InputMode: true,
            kittyKeyboard: {
              flags: 5,
              mainFlags: 0,
              altFlags: 0,
              mainStack: [],
              altStack: [],
            },
          },
        });

        dataListeners.forEach((listener) => {
          listener('\u001b[=7u\u001b[?1049h\u001b[=3u\u001b[?1049l');
        });

        expect(processManager.getPtyHistory('pane-keyboard-history')).toEqual({
          chunks: [
            '\u001b[?9001h\u001b[=5u\u001b[>3u',
            '\u001b[<1u\u001b[?9001l\u001b[=0u',
            '\u001b[?900',
            '1h\u001b[?2004h\u001b[=',
            '5',
            'u',
            '\u001b[=7u\u001b[?1049h\u001b[=3u\u001b[?1049l',
          ],
          firstSeq: 1,
          lastSeq: 7,
          evictedBeforeSeq: 0,
          keyboardState: {
            ...defaultKeyboardProtocolState,
            bracketedPasteMode: true,
            win32InputMode: true,
            kittyKeyboard: {
              flags: 7,
              mainFlags: 7,
              altFlags: 3,
              mainStack: [],
              altStack: [],
            },
          },
        });
      } finally {
        spawnSpy.mockRestore();
      }
    });
  });

  describe('getProcessStatus', () => {
    it('returns process info for existing process', async () => {
      const config = {
        workingDirectory: testWorkingDir,
      };

      const handle = await processManager.spawnTerminal(config);
      const status = processManager.getProcessStatus(handle.pid);

      expect(status).toBeDefined();
      expect(status?.pid).toBe(handle.pid);
      expect(status?.status).toBe(ProcessStatus.Alive);
      expect(status?.workingDirectory).toBe(testWorkingDir);
    });

    it('returns null for non-existent process', () => {
      const status = processManager.getProcessStatus(9999);
      expect(status).toBeNull();
    });
  });

  describe('listProcesses', () => {
    it('returns empty array when no processes', () => {
      const processes = processManager.listProcesses();
      expect(processes).toEqual([]);
    });

    it('returns all active processes', async () => {
      const config1 = { workingDirectory: testWorkingDir };
      const config2 = { workingDirectory: testWorkingDir };

      const handle1 = await processManager.spawnTerminal(config1);
      const handle2 = await processManager.spawnTerminal(config2);

      const processes = processManager.listProcesses();

      expect(processes).toHaveLength(2);
      expect(processes.map(p => p.pid)).toContain(handle1.pid);
      expect(processes.map(p => p.pid)).toContain(handle2.pid);
    });

    it('excludes terminated processes after cleanup', async () => {
      const config = { workingDirectory: testWorkingDir };

      const handle = await processManager.spawnTerminal(config);
      await processManager.killProcess(handle.pid);

      // Wait for cleanup
      await new Promise(resolve => setTimeout(resolve, 1100));

      const processes = processManager.listProcesses();
      expect(processes).toHaveLength(0);
    });
  });

  describe('process isolation', () => {
    it('single process failure does not affect other processes', async () => {
      const config1 = { workingDirectory: testWorkingDir };
      const config2 = { workingDirectory: testWorkingDir };

      const handle1 = await processManager.spawnTerminal(config1);
      const handle2 = await processManager.spawnTerminal(config2);

      // Kill first process
      await processManager.killProcess(handle1.pid);

      // Second process should still be alive
      const status2 = processManager.getProcessStatus(handle2.pid);
      expect(status2?.status).toBe(ProcessStatus.Alive);
    });
  });

  describe('tmux compatibility', () => {
    it('ensures tmux RPC server before spawning when tmux compat is enabled', async () => {
      const tmuxCompatService = {
        executeCommand: vi.fn(),
        allocatePaneId: vi.fn().mockReturnValue('%1'),
        resolvePaneId: vi.fn().mockReturnValue(null),
        resolveWindowTarget: vi.fn().mockReturnValue(null),
        registerPane: vi.fn(),
        unregisterPane: vi.fn(),
        getOrCreateSession: vi.fn(),
        getTmuxPaneId: vi.fn().mockReturnValue(undefined),
        ensureRpcServer: vi.fn().mockResolvedValue('\\\\.\\pipe\\ausome-tmux-win-rpc'),
        getRpcSocketPath: vi.fn().mockReturnValue('\\\\.\\pipe\\ausome-tmux-win-rpc'),
        destroy: vi.fn(),
      } as any;

      const tmuxEnabledProcessManager = new ProcessManager(
        () => ({ tmux: { enabled: true, autoInjectPath: false } } as any),
        tmuxCompatService,
      );

      const handle = await tmuxEnabledProcessManager.spawnTerminal({
        workingDirectory: testWorkingDir,
        windowId: 'win-rpc',
        paneId: 'pane-rpc',
      });

      expect(tmuxCompatService.ensureRpcServer).toHaveBeenCalledOnce();
      expect(tmuxCompatService.ensureRpcServer).toHaveBeenCalledWith('win-rpc');

      await tmuxEnabledProcessManager.killProcess(handle.pid);
    });

    it('injects the same rpc path as TmuxCompatService exposes', () => {
      const tmuxEnabledProcessManager = new ProcessManager(
        () => ({ tmux: { enabled: true, autoInjectPath: false } } as any),
      );

      const store = {
        windows: [
          {
            id: 'win-sync',
            name: 'Sync Test',
            layout: {
              type: 'pane' as const,
              id: 'pane-sync',
              pane: {
                id: 'pane-sync',
                cwd: testWorkingDir,
                command: 'pwsh.exe',
                status: WindowStatus.WaitingForInput,
                pid: 1001,
              },
            },
            activePaneId: 'pane-sync',
            createdAt: new Date().toISOString(),
            lastActiveAt: new Date().toISOString(),
          },
        ],
      };

      const tmuxCompatService = new TmuxCompatService({
        processManager: {
          spawnTerminal: vi.fn().mockResolvedValue({ pid: 1001, pty: {} }),
          killProcess: vi.fn().mockResolvedValue(undefined),
          getProcessStatus: vi.fn().mockReturnValue(null),
          listProcesses: vi.fn().mockReturnValue([]),
          getPaneStatus: vi.fn().mockResolvedValue('waiting'),
          subscribeStatusChange: vi.fn(),
          destroy: vi.fn().mockResolvedValue(undefined),
          getPidByPane: vi.fn().mockReturnValue(1001),
          writeToPty: vi.fn(),
        },
        getWindowStore: () => store as any,
        updateWindowStore: (updater) => updater(store as any),
        debug: false,
      });

      tmuxEnabledProcessManager.setTmuxCompatService(tmuxCompatService);

      const tmuxEnv = (tmuxEnabledProcessManager as any).buildTmuxEnvironment(
        {
          workingDirectory: testWorkingDir,
          windowId: 'win-sync',
          paneId: 'pane-sync',
        },
        { PATH: '', Path: '' },
      );

      expect(tmuxEnv.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS).toBe('1');
      expect(tmuxEnv.AUSOME_TMUX_RPC).toBe(tmuxCompatService.getRpcSocketPath('win-sync'));
      expect(tmuxEnv.AUSOME_NODE_PATH).toBe(process.execPath);

      tmuxCompatService.destroy();
    });
  });
});
