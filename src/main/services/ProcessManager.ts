import { EventEmitter } from 'events';
import { platform, tmpdir } from 'os';
import { appendFileSync, chmodSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import * as path from 'path';
import { randomUUID } from 'crypto';
import {
  IProcessManager,
  SSHExecCommandCallbacks,
  SSHExecCommandHandle,
  SSHSessionConfig,
  TerminalConfig,
  ProcessHandle,
  ProcessInfo,
  ProcessStatus,
  ZmodemDialogHandlers,
} from '../types/process';
import { Settings } from '../types/workspace';
import { StatusDetectorImpl, IStatusDetector } from './StatusDetector';
import { WindowStatus } from '../../shared/types/window';
import { ActiveSSHPortForward, ForwardedPortConfig, SSHSftpDirectoryListing, SSHSessionMetrics } from '../../shared/types/ssh';
import type { PtyKeyboardProtocolState } from '../../shared/types/electron-api';
import type { TerminalScreenSnapshot } from '../../shared/remote/terminal-protocol';
import { getLatestEnvironmentVariables } from '../utils/environment';
import { ITmuxCompatService, TmuxPaneId } from '../../shared/types/tmux';
import { getTmuxShimDir } from '../utils/tmux-shim-path';
import {
  cloneKeyboardProtocolState,
  createDefaultKeyboardProtocolState,
  type TrackedKeyboardProtocolState,
  updateKeyboardProtocolStateFromOutput,
} from './ptyKeyboardProtocolState';
import { resolveNodePath } from '../utils/node-path';
import { resolveShellProgram } from '../utils/shell';
import { chatDebugError, chatDebugInfo, previewText } from '../utils/chatDebugLog';
import { ISSHConnectionPool, SSHConnectionPool } from './ssh/SSHConnectionPool';
import { ISSHKnownHostsStore } from './ssh/SSHKnownHostsStore';
import { SSHPtySession } from './ssh/SSHPtySession';
import type { ISSHHostKeyPromptService } from './ssh/SSHHostKeyPromptService';
import {
  consumeTerminalOscColorQueries,
  type TerminalOscColorQueryReplyColors,
} from '../../shared/terminal-osc-color-query';

type PaneHistoryEntry = {
  seq: number;
  data: string;
};

type PtyOutputChunk = {
  data: string;
  seq?: number;
};

type PaneHistoryBuffer = {
  entries: PaneHistoryEntry[];
  totalLength: number;
  nextSeq: number;
  lastSeq: number;
  evictedBeforeSeq: number;
  keyboardState: TrackedKeyboardProtocolState;
};

type PaneHistoryEntriesResult = {
  entries: PaneHistoryEntry[];
  firstSeq: number;
  lastSeq: number;
  evictedBeforeSeq: number;
  gap: boolean;
  hasMoreBefore: boolean;
};

type PaneHistoryReadLimits = {
  limitBytes?: number;
  limitChunks?: number;
};

// 灏濊瘯瀵煎叆 node-pty锛屽鏋滃け璐ュ垯浣跨敤 mock
let pty: any;
try {
  const testPty = process.env.NODE_ENV === 'test'
    ? (globalThis as { __SYNAPSE_TEST_NODE_PTY__?: unknown }).__SYNAPSE_TEST_NODE_PTY__
    : undefined;
  pty = testPty ?? require('node-pty');
} catch {
  pty = null;
}

/**
 * ProcessManager - 缁堢杩涚▼绠＄悊鏈嶅姟
 * 
 * 璐熻矗鍒涘缓銆佺洃鎺у拰缁堟缁堢杩涚▼
 * 浣跨敤 node-pty 杩涜璺ㄥ钩鍙?PTY 杩涚▼绠＄悊
 * 
 * NOTE: 褰撳墠瀹炵幇浣跨敤 mock PTY锛屽緟 node-pty 缂栬瘧鐜灏辩华鍚庢浛鎹负鐪熷疄瀹炵幇
 */
export class ProcessManager extends EventEmitter implements IProcessManager {
  private processes: Map<number, ProcessInfo>;
  private ptys: Map<number, any>;
  private ptyDisposables: Map<number, Array<{ dispose: () => void }>>;
  private processCleanupTimers: Map<number, NodeJS.Timeout>;
  private ptyOutputBuffers: Map<number, PtyOutputChunk[]>; // 缂撳瓨 PTY 鍒濆杈撳嚭
  private ptyDataSubscribers: Map<number, Set<(chunk: PtyOutputChunk) => void>>;
  private terminalOscColorQueryPending: Map<number, string>;
  private paneHistoryBuffers: Map<string, PaneHistoryBuffer>;
  private terminalScreenSnapshots: Map<string, TerminalScreenSnapshot>;
  private paneIndex: Map<string, number>; // "windowId:paneId" 鈫?pid 绱㈠紩锛岀敤浜?O(1) 鏌ユ壘
  private sessionIndex: Map<string, string>; // "windowId:paneId" -> sessionId
  private pidToSessionId: Map<number, string>;
  private sessionIdToPid: Map<string, number>;
  private nextPid: number;
  private statusDetector: IStatusDetector;
  private cachedSpawnEnv: NodeJS.ProcessEnv | null;
  private cachedSpawnEnvAt: number;
  private cachedSpawnEnvShellKey: string | null;
  private readonly SPAWN_ENV_CACHE_TTL_MS = 30000;
  private readonly PANE_HISTORY_CHUNK_LIMIT = 250_000;
  private readonly PANE_HISTORY_CHAR_LIMIT = 20_000_000;
  private readonly getSettings: (() => Settings | null | undefined) | null;
  private tmuxCompatService: ITmuxCompatService | null;
  private sshKnownHostsStore: ISSHKnownHostsStore | null;
  private sshHostKeyPromptService: ISSHHostKeyPromptService | null;
  private readonly sshConnectionPool: ISSHConnectionPool;
  private zmodemDialogHandlers: ZmodemDialogHandlers | null;
  private conPtyWarmupPromise: Promise<void> | null;
  private conPtyWarmupCompleted: boolean;

  constructor(
    getSettings?: () => Settings | null | undefined,
    tmuxCompatService?: ITmuxCompatService,
    sshKnownHostsStore?: ISSHKnownHostsStore,
    sshHostKeyPromptService?: ISSHHostKeyPromptService,
  ) {
    super();
    this.processes = new Map();
    this.ptys = new Map();
    this.ptyDisposables = new Map();
    this.processCleanupTimers = new Map();
    this.ptyOutputBuffers = new Map();
    this.ptyDataSubscribers = new Map();
    this.terminalOscColorQueryPending = new Map();
    this.paneHistoryBuffers = new Map();
    this.terminalScreenSnapshots = new Map();
    this.paneIndex = new Map();
    this.sessionIndex = new Map();
    this.pidToSessionId = new Map();
    this.sessionIdToPid = new Map();
    this.nextPid = 1000;  // Start from 1000 for mock PIDs
    this.statusDetector = new StatusDetectorImpl();
    this.cachedSpawnEnv = null;
    this.cachedSpawnEnvAt = 0;
    this.cachedSpawnEnvShellKey = null;
    this.getSettings = getSettings ?? null;
    this.tmuxCompatService = tmuxCompatService ?? null;
    this.sshKnownHostsStore = sshKnownHostsStore ?? null;
    this.sshHostKeyPromptService = sshHostKeyPromptService ?? null;
    this.sshConnectionPool = new SSHConnectionPool({
      knownHostsStore: this.sshKnownHostsStore,
      hostKeyPromptService: this.sshHostKeyPromptService,
    });
    this.zmodemDialogHandlers = null;
    this.conPtyWarmupPromise = null;
    this.conPtyWarmupCompleted = false;
    // ??????? StatusDetector ??????? StatusPoller ??????
  }

  /**
   * 璁剧疆 TmuxCompatService锛堣В鍐冲惊鐜緷璧栵細ProcessManager 鍜?TmuxCompatService 浜掔浉寮曠敤锛?
   */
  setTmuxCompatService(service: ITmuxCompatService): void {
    this.tmuxCompatService = service;
  }

  setSSHKnownHostsStore(store: ISSHKnownHostsStore): void {
    this.sshKnownHostsStore = store;
    this.sshConnectionPool.setKnownHostsStore(store);
  }

  setSSHHostKeyPromptService(service: ISSHHostKeyPromptService): void {
    this.sshHostKeyPromptService = service;
    this.sshConnectionPool.setHostKeyPromptService(service);
  }

  setZmodemDialogHandlers(handlers: ZmodemDialogHandlers): void {
    this.zmodemDialogHandlers = handlers;
  }

  async warmupConPtyDll(): Promise<void> {
    if (this.conPtyWarmupCompleted) {
      return;
    }

    if (this.conPtyWarmupPromise) {
      return this.conPtyWarmupPromise;
    }

    this.conPtyWarmupPromise = this.performConPtyDllWarmup().finally(() => {
      this.conPtyWarmupCompleted = true;
      this.conPtyWarmupPromise = null;
    });

    return this.conPtyWarmupPromise;
  }

  private async performConPtyDllWarmup(): Promise<void> {
    if (platform() !== 'win32' || !pty) {
      return;
    }

    if (!this.shouldUseBundledConptyDll()) {
      console.log('[ProcessManager] Skipping ConPTY DLL warmup because bundled conpty.dll is disabled');
      return;
    }

    const warmupStartAt = Date.now();
    console.log('[ProcessManager] Starting ConPTY DLL warmup...');

    let dummyPty: any = null;
    try {
      dummyPty = pty.spawn('cmd.exe', ['/c', 'exit'], {
        name: 'xterm-256color',
        cols: 80,
        rows: 30,
        cwd: process.cwd(),
        env: process.env,
        useConpty: true,
        useConptyDll: true,
      });

      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          try { dummyPty.kill(); } catch {}
          resolve();
        }, 2000);

        dummyPty.onExit?.(() => {
          clearTimeout(timeout);
          resolve();
        });

        dummyPty.onData?.(() => {
          // Ignore data, just need to listen so the PTY doesn't block
        });
      });

      console.log(`[ProcessManager] ConPTY DLL warmup completed in ${Date.now() - warmupStartAt}ms`);
    } catch (error) {
      console.error('[ProcessManager] ConPTY DLL warmup failed:', error);
      try { dummyPty?.kill(); } catch {}
    }
  }

  /**
   * ????????
   */

  async spawnTerminal(config: TerminalConfig): Promise<ProcessHandle> {
    const backend = config.backend ?? 'local';

    // Validate working directory for local sessions only.
    if (backend === 'local' && !existsSync(config.workingDirectory)) {
      throw new Error(`Working directory does not exist: ${config.workingDirectory}`);
    }

    // 鍒涘缓 PTY 杩涚▼锛堢湡瀹炴垨 mock锛?
    let ptyProcess: any;
    let pid: number;
    const sessionId = randomUUID();
    let command = config.command;

    if (backend === 'local') {
      // Resolve the executable and args that will actually be passed to node-pty.
      const launchCommand = this.resolveLaunchCommand(config);
      command = launchCommand.command;

      await this.ensureTmuxRpcServer(config);

      if (pty) {
        // 浣跨敤鐪熷疄鐨?node-pty
        ptyProcess = this.createRealPty(config, launchCommand.file, launchCommand.args);
        pid = ptyProcess.pid;
      } else {
        // 浣跨敤 mock PTY
        pid = this.nextPid++;
        ptyProcess = this.createMockPty(pid, config);
      }
    } else {
      const sshConfig = this.requireSSHConfig(config.ssh);
      command = sshConfig.command ?? command ?? '';
      pid = this.nextPid++;
      ptyProcess = await SSHPtySession.create({
        pid,
        ssh: sshConfig,
        connectionPool: this.sshConnectionPool,
        initialCols: config.initialCols,
        initialRows: config.initialRows,
        zmodemDialogs: this.zmodemDialogHandlers ?? undefined,
      });
    }

    // Store process info
    const terminalCols = typeof ptyProcess.cols === 'number'
      ? ptyProcess.cols
      : config.initialCols ?? 80;
    const terminalRows = typeof ptyProcess.rows === 'number'
      ? ptyProcess.rows
      : config.initialRows ?? 30;
    const processInfo: ProcessInfo = {
      sessionId,
      backend,
      pid,
      status: ProcessStatus.Alive,
      workingDirectory: config.workingDirectory,
      command,
      profileId: config.ssh?.profileId,
      terminalCols,
      terminalRows,
      windowId: config.windowId,
      paneId: config.paneId,
    };
    this.processes.set(pid, processInfo);
    this.ptys.set(pid, ptyProcess);

    // 缁存姢 paneIndex 绱㈠紩锛岀敤浜?O(1) 鏌ユ壘
    const paneKey = this.getPaneKey(config.windowId, config.paneId);
    this.paneIndex.set(paneKey, pid);
    this.sessionIndex.set(paneKey, sessionId);
    this.pidToSessionId.set(pid, sessionId);
    this.sessionIdToPid.set(sessionId, pid);

    // 鍒濆鍖栬緭鍑虹紦鍐插尯锛岀敤浜庣紦瀛樻棭鏈熻緭鍑猴紙閬垮厤绔炴€佹潯浠跺鑷存暟鎹涪澶憋級
    this.ptyOutputBuffers.set(pid, []);
    this.resetPaneHistory(config.windowId, config.paneId);

    // Start tracking this PID before registering listeners (avoids race condition)
    this.statusDetector.trackPid(pid, { virtual: backend === 'ssh' });

    // 绔嬪嵆寮€濮嬬紦瀛?PTY 杈撳嚭锛堝湪浠讳綍璁㈤槄涔嬪墠锛?
    const onDataDisposable = ptyProcess.onData((data: string) => {
      const colorQueryResult = consumeTerminalOscColorQueries(
        data,
        this.terminalOscColorQueryPending.get(pid) ?? '',
        this.getTerminalOscColorQueryReplyColors(),
      );
      if (colorQueryResult.pending) {
        this.terminalOscColorQueryPending.set(pid, colorQueryResult.pending);
      } else {
        this.terminalOscColorQueryPending.delete(pid);
      }
      for (const reply of colorQueryResult.replies) {
        // Keep protocol replies in the PTY output callback so renderer frame
        // scheduling and remote input cannot overtake Codex's query timeout.
        try {
          ptyProcess.write(reply);
        } catch {
          // The PTY can exit between its final output event and this reply.
        }
      }
      const outputData = colorQueryResult.output;
      if (!outputData) {
        return;
      }
      if (this.tmuxCompatService && config.windowId && config.paneId) {
        this.tmuxCompatService.observePaneOutput(config.windowId, config.paneId, outputData);
      }
      const seq = this.appendPaneHistory(config.windowId, config.paneId, outputData);
      const buffer = this.ptyOutputBuffers.get(pid);
      if (buffer) {
        buffer.push({ data: outputData, seq });
        // 闄愬埗缂撳啿鍖哄ぇ灏忥紝閬垮厤鍐呭瓨娉勬紡锛堝鍔犲埌 500 鏉℃秷鎭紝瑕嗙洊鏇村鍚姩杈撳嚭锛?
        if (buffer.length > 500) {
          buffer.shift();
        }
      }

      const subscribers = this.ptyDataSubscribers.get(pid);
      if (subscribers && subscribers.size > 0) {
        const chunk = { data: outputData, seq };
        for (const subscriber of subscribers) {
          subscriber(chunk);
        }
      }
      this.statusDetector.onPtyData(pid, outputData);
    });

    // Register PTY listeners for status detection and save disposables
    const disposables: Array<{ dispose: () => void }> = [];

    // 淇濆瓨 PTY 数据监听器
    if (onDataDisposable && typeof onDataDisposable.dispose === 'function') {
      disposables.push(onDataDisposable);
    }

    const onExitDisposable = ptyProcess.onExit((event: { exitCode: number; signal?: number } | number) => {
      const exitCode = typeof event === 'number' ? event : event?.exitCode ?? 0;
      this.finalizeProcessExit(pid, exitCode);
    });
    if (onExitDisposable && typeof onExitDisposable.dispose === 'function') {
      disposables.push(onExitDisposable);
    }

    // Save disposables for cleanup
    this.ptyDisposables.set(pid, disposables);

    // Emit process-created event
    this.emit('process-created', processInfo);

    return {
      pid,
      sessionId,
      pty: ptyProcess,
    };
  }

  /**
   * 缁堟鎸囧畾杩涚▼
   */
  async killProcess(pid: number): Promise<void> {
    const processInfo = this.processes.get(pid);
    if (!processInfo) {
      throw new Error(`Process not found: ${pid}`);
    }

    if (processInfo.status === ProcessStatus.Exited) {
      throw new Error(`Process already exited: ${pid}`);
    }

    this.disposePtyDisposables(pid);

    // 瀹為檯缁堟 PTY 杩涚▼
    const ptyProcess = this.ptys.get(pid);
    if (ptyProcess && typeof ptyProcess.kill === 'function') {
      try {
        if (platform() === 'win32') {
          // Windows: 浣跨敤 taskkill 寮哄埗缁堟杩涚▼鏍?
          this.killProcessTreeWindows(pid);
        } else {
          // Unix: 浣跨敤 SIGTERM 淇″彿娓╁拰鍦扮粓姝㈣繘绋?
          ptyProcess.kill('SIGTERM');
        }
      } catch (error) {
        // 蹇界暐閿欒锛屽洜涓鸿繘绋嬪彲鑳藉凡缁忛€€鍑?
        if (process.env.NODE_ENV === 'development') {
          console.log(`PTY process ${pid} already exited or kill failed`);
        }
      }
    }

    this.finalizeProcessExit(pid, 0);
  }

  /**
   * 鑾峰彇杩涚▼鐘舵€?
   */
  getProcessStatus(pid: number): ProcessInfo | null {
    return this.processes.get(pid) || null;
  }

  /**
   * 鍒楀嚭鎵€鏈夎繘绋?
   */
  listProcesses(): ProcessInfo[] {
    return Array.from(this.processes.values());
  }

  /**
   * 閫氳繃 windowId 鍜?paneId 鏌ユ壘 PID锛圤(1) 鏌ユ壘锛?
   *
   * @returns PID 鎴?null锛堝鏋滄湭鎵惧埌锛?
   */
  getPidByPane(windowId: string, paneId?: string): number | null {
    const paneKey = this.getPaneKey(windowId, paneId);
    return this.paneIndex.get(paneKey) ?? null;
  }

  getSessionIdByPane(windowId: string, paneId?: string): string | null {
    const paneKey = this.getPaneKey(windowId, paneId);
    return this.sessionIndex.get(paneKey) ?? null;
  }

  listSSHPortForwards(windowId: string, paneId: string): ActiveSSHPortForward[] {
    const pty = this.requireSSHPortForwardSession(windowId, paneId);
    return pty.listPortForwards();
  }

  async addSSHPortForward(
    windowId: string,
    paneId: string,
    forward: ForwardedPortConfig,
  ): Promise<ActiveSSHPortForward> {
    const pty = this.requireSSHPortForwardSession(windowId, paneId);
    return pty.addPortForward(forward);
  }

  async removeSSHPortForward(windowId: string, paneId: string, forwardId: string): Promise<void> {
    const pty = this.requireSSHPortForwardSession(windowId, paneId);
    await pty.removePortForward(forwardId);
  }

  async listSSHSftpDirectory(windowId: string, paneId: string, path?: string): Promise<SSHSftpDirectoryListing> {
    const pty = this.requireSSHSftpSession(windowId, paneId);
    return pty.listSftpDirectory(path);
  }

  async getSSHSessionMetrics(windowId: string, paneId: string, path?: string): Promise<SSHSessionMetrics> {
    const pty = this.requireSSHSftpSession(windowId, paneId);
    return pty.getSSHSessionMetrics(path);
  }

  async downloadSSHSftpFile(
    windowId: string,
    paneId: string,
    remotePath: string,
    localPath: string,
  ): Promise<void> {
    const pty = this.requireSSHSftpSession(windowId, paneId);
    await pty.downloadSftpFile(remotePath, localPath);
  }

  async uploadSSHSftpFiles(
    windowId: string,
    paneId: string,
    remotePath: string,
    localPaths: string[],
  ): Promise<number> {
    const pty = this.requireSSHSftpSession(windowId, paneId);
    return pty.uploadSftpFiles(remotePath, localPaths);
  }

  async uploadSSHSftpDirectory(
    windowId: string,
    paneId: string,
    remotePath: string,
    localDirectoryPath: string,
  ): Promise<number> {
    const pty = this.requireSSHSftpSession(windowId, paneId);
    return pty.uploadSftpDirectory(remotePath, localDirectoryPath);
  }

  async downloadSSHSftpDirectory(
    windowId: string,
    paneId: string,
    remotePath: string,
    localPath: string,
  ): Promise<void> {
    const pty = this.requireSSHSftpSession(windowId, paneId);
    await pty.downloadSftpDirectory(remotePath, localPath);
  }

  async createSSHSftpDirectory(
    windowId: string,
    paneId: string,
    parentPath: string,
    name: string,
  ): Promise<string> {
    const pty = this.requireSSHSftpSession(windowId, paneId);
    return pty.createSftpDirectory(parentPath, name);
  }

  async deleteSSHSftpEntry(windowId: string, paneId: string, remotePath: string): Promise<void> {
    const pty = this.requireSSHSftpSession(windowId, paneId);
    await pty.deleteSftpEntry(remotePath);
  }

  async execSSHCommand(windowId: string, paneId: string, command: string): Promise<string> {
    chatDebugInfo('ProcessManager.execSSHCommand', 'Executing SSH command', {
      windowId,
      paneId,
      commandPreview: previewText(command, 240),
    });

    try {
      const pid = this.getPidByPane(windowId, paneId);
      if (pid === null) {
        throw new Error(`Pane not found: ${windowId}/${paneId}`);
      }

      const ptySession = this.ptys.get(pid);
      if (!ptySession || !isSSHExecSession(ptySession)) {
        throw new Error(`SSH session not found for pane: ${windowId}/${paneId}`);
      }

      const output = await ptySession.execCommand(command);
      chatDebugInfo('ProcessManager.execSSHCommand', 'SSH command completed', {
        windowId,
        paneId,
        outputLength: output.length,
        outputPreview: previewText(output, 240),
      });
      return output;
    } catch (error) {
      chatDebugError('ProcessManager.execSSHCommand', 'SSH command failed', {
        windowId,
        paneId,
        commandPreview: previewText(command, 240),
        error,
      });
      throw error;
    }
  }

  async execSSHCommandDetailed(windowId: string, paneId: string, command: string): Promise<import('../types/process').SSHExecCommandResult> {
    chatDebugInfo('ProcessManager.execSSHCommandDetailed', 'Executing SSH command', {
      windowId,
      paneId,
      commandPreview: previewText(command, 240),
    });

    const pid = this.getPidByPane(windowId, paneId);
    if (pid === null) {
      throw new Error(`Pane not found: ${windowId}/${paneId}`);
    }

    const ptySession = this.ptys.get(pid);
    if (!ptySession || !isSSHExecDetailedSession(ptySession)) {
      throw new Error(`SSH session not found for pane: ${windowId}/${paneId}`);
    }

    const result = await ptySession.execCommandResult(command);
    chatDebugInfo('ProcessManager.execSSHCommandDetailed', 'SSH command completed', {
      windowId,
      paneId,
      exitCode: result.exitCode,
      stdoutLength: result.stdout.length,
      stderrLength: result.stderr.length,
      stdoutPreview: previewText(result.stdout, 240),
      stderrPreview: previewText(result.stderr, 240),
    });
    return result;
  }

  async execSSHCommandDetailedStreaming(
    windowId: string,
    paneId: string,
    command: string,
    callbacks?: SSHExecCommandCallbacks,
  ): Promise<SSHExecCommandHandle> {
    chatDebugInfo('ProcessManager.execSSHCommandDetailedStreaming', 'Executing SSH command', {
      windowId,
      paneId,
      commandPreview: previewText(command, 240),
    });

    const pid = this.getPidByPane(windowId, paneId);
    if (pid === null) {
      throw new Error(`Pane not found: ${windowId}/${paneId}`);
    }

    const ptySession = this.ptys.get(pid);
    if (!ptySession || !isSSHExecStreamSession(ptySession)) {
      throw new Error(`SSH session not found for pane: ${windowId}/${paneId}`);
    }

    const handle = await ptySession.execCommandStream(command, callbacks);
    void handle.result.then((result) => {
      chatDebugInfo('ProcessManager.execSSHCommandDetailedStreaming', 'SSH command completed', {
        windowId,
        paneId,
        exitCode: result.exitCode,
        stdoutLength: result.stdout.length,
        stderrLength: result.stderr.length,
        stdoutPreview: previewText(result.stdout, 240),
        stderrPreview: previewText(result.stderr, 240),
      });
    }).catch((error) => {
      chatDebugError('ProcessManager.execSSHCommandDetailedStreaming', 'SSH command failed', {
        windowId,
        paneId,
        commandPreview: previewText(command, 240),
        error,
      });
    });

    return handle;
  }

  /**
   * 鐢熸垚 paneIndex 鐨?key
   */
  private getPaneKey(windowId: string | undefined, paneId: string | undefined): string {
    return `${windowId ?? ''}:${paneId ?? ''}`;
  }

  private requireSSHPortForwardSession(windowId: string, paneId: string): {
    listPortForwards(): ActiveSSHPortForward[];
    addPortForward(config: ForwardedPortConfig): Promise<ActiveSSHPortForward>;
    removePortForward(forwardId: string): Promise<void>;
  } {
    const pid = this.getPidByPane(windowId, paneId);
    if (pid === null) {
      throw new Error(`Pane not found: ${windowId}/${paneId}`);
    }

    const pty = this.ptys.get(pid);
    if (!pty || !isSSHPortForwardSession(pty)) {
      throw new Error(`SSH session not found for pane: ${windowId}/${paneId}`);
    }

    return pty;
  }

  private requireSSHSftpSession(windowId: string, paneId: string): {
    listSftpDirectory(path?: string): Promise<SSHSftpDirectoryListing>;
    getSSHSessionMetrics(path?: string): Promise<SSHSessionMetrics>;
    downloadSftpFile(remotePath: string, localPath: string): Promise<void>;
    uploadSftpFiles(remotePath: string, localPaths: string[]): Promise<number>;
    uploadSftpDirectory(remotePath: string, localDirectoryPath: string): Promise<number>;
    downloadSftpDirectory(remotePath: string, localPath: string): Promise<void>;
    createSftpDirectory(parentPath: string, name: string): Promise<string>;
    deleteSftpEntry(remotePath: string): Promise<void>;
  } {
    const pid = this.getPidByPane(windowId, paneId);
    if (pid === null) {
      throw new Error(`Pane not found: ${windowId}/${paneId}`);
    }

    const pty = this.ptys.get(pid);
    if (!pty || !isSSHSftpSession(pty)) {
      throw new Error(`SSH SFTP session not found for pane: ${windowId}/${paneId}`);
    }

    return pty;
  }

  /**
   * 鑾峰彇绐楁牸鐘舵€侊紙閫氳繃 windowId 鍜?paneId锛?
   */
  async getPaneStatus(windowId: string, paneId: string): Promise<WindowStatus> {
    const processInfo = Array.from(this.processes.values()).find(
      p => p.windowId === windowId && p.paneId === paneId
    );
    if (!processInfo) {
      throw new Error(`Pane not found: ${windowId}/${paneId}`);
    }
    return this.statusDetector.detectStatus(processInfo.pid);
  }

  /**
   * 鑾峰彇 StatusDetector 瀹炰緥锛堜緵 StatusPoller 浣跨敤锛?
   */
  getStatusDetector(): IStatusDetector {
    return this.statusDetector;
  }

  /**
   * 璁㈤槄鐘舵€佸彉鍖栦簨浠讹紝杩斿洖鍙栨秷璁㈤槄鍑芥暟
   */
  subscribeStatusChange(callback: (pid: number, status: WindowStatus) => void): () => void {
    return this.statusDetector.subscribeStatusChange(callback);
  }

  private getTerminalOscColorQueryReplyColors(): TerminalOscColorQueryReplyColors {
    const presetId = this.getSettings?.()?.appearance?.skin?.presetId;
    return {
      foreground: presetId === 'paper'
        ? '#1f2329'
        : presetId === 'obsidian' || presetId === 'custom'
          ? '#d7d7d7'
          : '#cccccc',
      // TerminalPane uses a transparent xterm background; xterm reports its
      // transparent color channel as black for OSC 11.
      background: '#000000',
    };
  }

  /**
   * 鍚?PTY 鍐欏叆鏁版嵁锛堢敤鎴疯緭鍏ワ級
   */
  writeToPty(pid: number, data: string): void {
    const processInfo = this.processes.get(pid);
    if (!processInfo || processInfo.status === ProcessStatus.Exited) {
      return;
    }

    const pty = this.ptys.get(pid);
    if (pty) {
      // Windows 剪贴板换行符为 \r\n，直接写入 PTY 会导致双重换行，统一转为 \r
      pty.write(data.replace(/\r\n/g, '\r'));
    }
  }

  /**
   * 璋冩暣 PTY 澶у皬
   */
  resizePty(pid: number, cols: number, rows: number): void {
    const processInfo = this.processes.get(pid);
    if (!processInfo || processInfo.status === ProcessStatus.Exited) {
      return;
    }

    const pty = this.ptys.get(pid);
    if (pty) {
      try {
        pty.resize(cols, rows);
        processInfo.terminalCols = cols;
        processInfo.terminalRows = rows;
      } catch (error) {
        // Window teardown can race with a final resize after the PTY has exited.
        if (this.isExitedPtyResizeError(error)) {
          this.finalizeProcessExit(pid, processInfo.exitCode ?? 0);
          return;
        }
        throw error;
      }
    }
  }

  /**
   * 璁㈤槄 PTY 鏁版嵁杈撳嚭锛岃繑鍥炲彇娑堣闃呭嚱鏁?
   *
   * 娉ㄦ剰锛氶娆¤闃呮椂浼氬厛鍙戦€佺紦瀛樼殑鍒濆杈撳嚭锛岄伩鍏嶇珵鎬佹潯浠跺鑷存暟鎹涪澶?
   */
  subscribePtyData(pid: number, callback: (data: string, seq?: number) => void): () => void {
    if (!this.ptys.has(pid)) return () => {};

    const safeCallback = (chunk: PtyOutputChunk) => {
      try {
        callback(chunk.data, chunk.seq);
      } catch (error) {
        console.error(`[ProcessManager] PTY data callback error for pid ${pid}:`, error);
        // 涓嶈璁╅敊璇腑鏂?PTY 鏁版嵁娴?
      }
    };

    // 鍏堝彂閫佺紦瀛樼殑鍒濆杈撳嚭锛堝鏋滄湁锛?
    const buffer = this.ptyOutputBuffers.get(pid);
    if (buffer && buffer.length > 0) {
      // 浣跨敤 setImmediate 寮傛鍙戦€侊紝閬垮厤闃诲
      setImmediate(() => {
        for (const chunk of buffer) {
          safeCallback(chunk);
        }
      });
      // 娓呯┖缂撳啿鍖猴紝閬垮厤閲嶅鍙戦€?
      this.ptyOutputBuffers.delete(pid);
    }

    const subscribers = this.ptyDataSubscribers.get(pid) ?? new Set<(chunk: PtyOutputChunk) => void>();
    subscribers.add(safeCallback);
    this.ptyDataSubscribers.set(pid, subscribers);

    // 杩斿洖娓呯悊鍑芥暟
    return () => {
      const currentSubscribers = this.ptyDataSubscribers.get(pid);
      if (!currentSubscribers) {
        return;
      }

      currentSubscribers.delete(safeCallback);
      if (currentSubscribers.size === 0) {
        this.ptyDataSubscribers.delete(pid);
      }
    };
  }

  /**
   * 妫€鏌?PTY 杈撳嚭缂撳啿鍖烘槸鍚︽湁鏁版嵁锛堢敤浜庡垽鏂?PTY 鏄惁宸茶緭鍑哄垵濮嬪寲淇℃伅锛?
   */
  hasPtyOutput(pid: number): boolean {
    const buffer = this.ptyOutputBuffers.get(pid);
    return buffer ? buffer.length > 0 : false;
  }

  getPtyHistory(paneId: string): {
    chunks: string[];
    firstSeq: number;
    lastSeq: number;
    evictedBeforeSeq: number;
    keyboardState: PtyKeyboardProtocolState;
  };
  getPtyHistory(windowId: string, paneId: string): {
    chunks: string[];
    firstSeq: number;
    lastSeq: number;
    evictedBeforeSeq: number;
    keyboardState: PtyKeyboardProtocolState;
  };
  getPtyHistory(windowIdOrPaneId: string, paneId?: string): {
    chunks: string[];
    firstSeq: number;
    lastSeq: number;
    evictedBeforeSeq: number;
    keyboardState: PtyKeyboardProtocolState;
  } {
    const history = this.getPaneHistoryBuffer(windowIdOrPaneId, paneId);
    if (!history) {
      return {
        chunks: [],
        firstSeq: 0,
        lastSeq: 0,
        evictedBeforeSeq: 0,
        keyboardState: cloneKeyboardProtocolState(createDefaultKeyboardProtocolState()),
      };
    }

    return {
      chunks: history.entries.map((entry) => entry.data),
      firstSeq: getPaneHistoryFirstSeq(history),
      lastSeq: history.lastSeq,
      evictedBeforeSeq: history.evictedBeforeSeq,
      keyboardState: cloneKeyboardProtocolState(history.keyboardState),
    };
  }

  getPtyHistoryEntriesSince(
    paneId: string,
    sinceSeq?: number,
  ): PaneHistoryEntriesResult;
  getPtyHistoryEntriesSince(
    windowId: string,
    paneId: string,
    sinceSeq?: number,
  ): PaneHistoryEntriesResult;
  getPtyHistoryEntriesSince(
    windowIdOrPaneId: string,
    paneIdOrSinceSeq: string | number = 0,
    maybeSinceSeq?: number,
  ): PaneHistoryEntriesResult {
    const paneId = typeof paneIdOrSinceSeq === 'string' ? paneIdOrSinceSeq : undefined;
    const sinceSeq = typeof paneIdOrSinceSeq === 'number' ? paneIdOrSinceSeq : maybeSinceSeq ?? 0;
    const history = this.getPaneHistoryBuffer(windowIdOrPaneId, paneId);
    if (!history) {
      return {
        entries: [],
        firstSeq: 0,
        lastSeq: 0,
        evictedBeforeSeq: 0,
        gap: false,
        hasMoreBefore: false,
      };
    }

    const firstSeq = getPaneHistoryFirstSeq(history);
    return {
      entries: history.entries.filter((entry) => entry.seq > sinceSeq),
      firstSeq,
      lastSeq: history.lastSeq,
      evictedBeforeSeq: history.evictedBeforeSeq,
      gap: history.evictedBeforeSeq > sinceSeq,
      hasMoreBefore: false,
    };
  }

  getPtyHistoryEntriesBefore(
    paneId: string,
    beforeSeq?: number,
    limits?: PaneHistoryReadLimits,
  ): PaneHistoryEntriesResult;
  getPtyHistoryEntriesBefore(
    windowId: string,
    paneId: string,
    beforeSeq?: number,
    limits?: PaneHistoryReadLimits,
  ): PaneHistoryEntriesResult;
  getPtyHistoryEntriesBefore(
    windowIdOrPaneId: string,
    paneIdOrBeforeSeq?: string | number,
    beforeSeqOrLimits?: number | PaneHistoryReadLimits,
    maybeLimits?: PaneHistoryReadLimits,
  ): PaneHistoryEntriesResult {
    const paneId = typeof paneIdOrBeforeSeq === 'string' ? paneIdOrBeforeSeq : undefined;
    const beforeSeq = typeof paneIdOrBeforeSeq === 'number'
      ? paneIdOrBeforeSeq
      : typeof beforeSeqOrLimits === 'number'
        ? beforeSeqOrLimits
        : Number.MAX_SAFE_INTEGER;
    const limits = (
      typeof paneIdOrBeforeSeq === 'number'
        ? beforeSeqOrLimits
        : maybeLimits
    ) as PaneHistoryReadLimits | undefined;
    const history = this.getPaneHistoryBuffer(windowIdOrPaneId, paneId);
    if (!history) {
      return {
        entries: [],
        firstSeq: 0,
        lastSeq: 0,
        evictedBeforeSeq: 0,
        gap: false,
        hasMoreBefore: false,
      };
    }

    const maxBytes = normalizeHistoryLimit(limits?.limitBytes, Number.POSITIVE_INFINITY);
    const maxChunks = normalizeHistoryLimit(limits?.limitChunks, Number.POSITIVE_INFINITY);
    const firstAvailableSeq = getPaneHistoryFirstSeq(history);
    const selected: PaneHistoryEntry[] = [];
    let totalLength = 0;
    for (let index = history.entries.length - 1; index >= 0; index -= 1) {
      const entry = history.entries[index]!;
      if (entry.seq >= beforeSeq) {
        continue;
      }
      if (selected.length >= maxChunks) {
        break;
      }
      if (selected.length > 0 && totalLength + entry.data.length > maxBytes) {
        break;
      }
      selected.push(entry);
      totalLength += entry.data.length;
    }

    selected.reverse();
    const firstReturnedSeq = selected[0]?.seq ?? 0;
    const hasMoreBefore = selected.length > 0 && firstReturnedSeq > firstAvailableSeq;
    return {
      entries: selected,
      firstSeq: firstReturnedSeq,
      lastSeq: selected.at(-1)?.seq ?? 0,
      evictedBeforeSeq: history.evictedBeforeSeq,
      gap: history.evictedBeforeSeq > 0 && !hasMoreBefore,
      hasMoreBefore,
    };
  }

  clearPtyHistory(paneId: string): void;
  clearPtyHistory(windowId: string, paneId: string): void;
  clearPtyHistory(windowIdOrPaneId: string, paneId?: string): void {
    const history = this.getPaneHistoryBuffer(windowIdOrPaneId, paneId);
    if (!history) {
      return;
    }

    history.entries = [];
    history.totalLength = 0;
    history.evictedBeforeSeq = Math.max(history.evictedBeforeSeq, history.lastSeq);
    history.nextSeq = Math.max(history.nextSeq, history.lastSeq + 1);
  }

  getLatestPaneOutputSeq(paneId: string): number;
  getLatestPaneOutputSeq(windowId: string, paneId: string): number;
  getLatestPaneOutputSeq(windowIdOrPaneId: string, paneId?: string): number {
    return this.getPaneHistoryBuffer(windowIdOrPaneId, paneId)?.lastSeq ?? 0;
  }

  updateTerminalScreenSnapshot(snapshot: TerminalScreenSnapshot): void {
    if (
      !snapshot.windowId ||
      !snapshot.paneId ||
      !Number.isFinite(snapshot.cols) ||
      !Number.isFinite(snapshot.rows) ||
      !Number.isFinite(snapshot.outputSeq)
    ) {
      return;
    }

    if (!snapshot.alternate) {
      this.clearTerminalScreenSnapshot(snapshot.windowId, snapshot.paneId);
      return;
    }

    this.terminalScreenSnapshots.set(this.getPaneKey(snapshot.windowId, snapshot.paneId), {
      ...snapshot,
      cols: Math.max(1, Math.floor(snapshot.cols)),
      rows: Math.max(1, Math.floor(snapshot.rows)),
      cursorX: Math.max(0, Math.floor(snapshot.cursorX)),
      cursorY: Math.max(0, Math.floor(snapshot.cursorY)),
      data: snapshot.data,
      capturedAt: snapshot.capturedAt || new Date().toISOString(),
      outputSeq: Math.max(0, Math.floor(snapshot.outputSeq)),
    });
  }

  getTerminalScreenSnapshot(windowId: string, paneId: string): TerminalScreenSnapshot | undefined {
    const snapshot = this.terminalScreenSnapshots.get(this.getPaneKey(windowId, paneId));
    return snapshot ? { ...snapshot } : undefined;
  }

  clearTerminalScreenSnapshot(windowId: string | undefined, paneId: string | undefined): void {
    if (!paneId) {
      return;
    }
    this.terminalScreenSnapshots.delete(this.getPaneKey(windowId, paneId));
    this.terminalScreenSnapshots.delete(paneId);
  }

  /**
   * 閿€姣?ProcessManager锛岄噴鏀捐祫婧?
   */
  async destroy(progressCallback?: (current: number, total: number) => void): Promise<void> {
    console.log('[ProcessManager] Starting destroy...');

    // 鍏堝仠姝㈢姸鎬佹娴嬪櫒锛岄伩鍏嶅湪娓呯悊杩囩▼涓Е鍙戞娴?
    this.statusDetector.destroy();

    for (const cleanupTimer of this.processCleanupTimers.values()) {
      clearTimeout(cleanupTimer);
    }
    this.processCleanupTimers.clear();

    // 娓呯悊鎵€鏈?PTY 浜嬩欢鐩戝惉鍣?
    for (const [pid, disposables] of this.ptyDisposables.entries()) {
      disposables.forEach(d => {
        try {
          d.dispose();
        } catch (error) {
          // 蹇界暐娓呯悊閿欒
        }
      });
    }
    this.ptyDisposables.clear();

    // 鏀堕泦鎵€鏈?PTY 杩涚▼鐨?PID
    const pidsToKill: number[] = [];

    // 绗竴姝ワ細灏濊瘯浼橀泤缁堟锛圫IGTERM锛?
    for (const [pid, pty] of this.ptys.entries()) {
      const processInfo = this.processes.get(pid);
      if (processInfo?.backend !== 'ssh') {
        pidsToKill.push(pid);
      }
      if (pty && typeof pty.kill === 'function') {
        try {
          if (processInfo?.backend === 'ssh') {
            pty.kill('SIGTERM');
            console.log(`[ProcessManager] Closed SSH session for PID ${pid}`);
          } else if (platform() === 'win32') {
            // node-pty's Windows kill path may surface taskkill output through the
            // attached console. Keep local PTYs for the silent batch taskkill phase.
          } else {
            // 鍏堜娇鐢?SIGTERM 浼橀泤缁堟
            pty.kill('SIGTERM');
            console.log(`[ProcessManager] Sent SIGTERM to PTY process ${pid}`);
          }
        } catch (error) {
          // 蹇界暐閿欒锛屽洜涓鸿繘绋嬪彲鑳藉凡缁忛€€鍑?
          if (process.env.NODE_ENV === 'development') {
            console.log(`[ProcessManager] PTY process ${pid} already exited or kill failed`);
          }
        }
      }
    }

    const totalProcesses = pidsToKill.length;

    // 绛夊緟 300ms 璁╄繘绋嬫湁鏈轰細浼橀泤閫€鍑?
    if (pidsToKill.length > 0) {
      console.log('[ProcessManager] Waiting 300ms for graceful shutdown...');
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    // 绗簩姝ワ細寮哄埗缁堟鎵€鏈夎繘绋嬪強鍏跺瓙杩涚▼鏍?
    if (pidsToKill.length > 0) {
      console.log('[ProcessManager] Force killing remaining processes and their children...');

      if (platform() === 'win32') {
        // Windows: 浣跨敤 taskkill /T 涓€娆℃€х粓姝㈣繘绋嬫爲锛岄伩鍏嶉€掑綊鏌ヨ
        // 杩欐瘮閫愪釜鏌ヨ瀛愯繘绋嬪揩寰楀锛屼笖涓嶄細闃诲涓荤嚎绋嬪お涔?
        await this.killProcessTreesBatch(pidsToKill, progressCallback, totalProcesses);
      } else {
        // Unix/macOS: 浣跨敤杩涚▼缁勭粓姝㈠瓙杩涚▼
        await this.killProcessTreesUnix(pidsToKill, progressCallback, totalProcesses);
      }
    }

    // 涓嶇瓑寰呰繘绋嬮€€鍑猴紝鐩存帴娓呯悊
    this.processes.clear();
    this.ptys.clear();
    this.terminalOscColorQueryPending.clear();
    this.paneHistoryBuffers.clear();
    this.paneIndex.clear();
    this.sessionIndex.clear();
    this.pidToSessionId.clear();
    this.sessionIdToPid.clear();
    await this.sshConnectionPool.destroy();

    console.log('[ProcessManager] Destroy completed');
  }

  private requireSSHConfig(config?: SSHSessionConfig): SSHSessionConfig {
    if (!config) {
      throw new Error('SSH terminal config is missing SSH session details');
    }

    return config;
  }

  /**
   * 鎵归噺缁堟杩涚▼鏍戯紙Windows锛?
   * 浣跨敤 taskkill /T 涓€娆℃€х粓姝㈣繘绋嬫爲锛岄伩鍏嶉€掑綊鏌ヨ瀛愯繘绋?
   */
  private async killProcessTreesBatch(
    pids: number[],
    progressCallback?: (current: number, total: number) => void,
    total?: number
  ): Promise<void> {
    const totalProcesses = total || pids.length;
    let processedCount = 0;

    // 鍒嗘壒澶勭悊锛屾瘡鎵规渶澶?10 涓繘绋嬶紝閬垮厤鍛戒护琛岃繃闀?
    const batchSize = 10;
    for (let i = 0; i < pids.length; i += batchSize) {
      const batch = pids.slice(i, i + batchSize);

      // 浣跨敤 Promise.all 骞惰缁堟澶氫釜杩涚▼鏍?
      await Promise.all(
        batch.map(async (pid) => {
          try {
            // 浣跨敤 taskkill /F /T 寮哄埗缁堟杩涚▼鏍?
            // /F: 寮哄埗缁堟
            // /T: 缁堟杩涚▼鍙婂叾鎵€鏈夊瓙杩涚▼
            await new Promise<void>((resolve) => {
              // 浣跨敤 setImmediate 灏?execSync 鏀惧埌涓嬩竴涓簨浠跺惊鐜紝閬垮厤闃诲 UI
              setImmediate(() => {
                try {
                  execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' });
                  console.log(`[ProcessManager] Killed process tree for PID ${pid}`);
                } catch (error) {
                  // 杩涚▼鍙兘宸茬粡閫€鍑猴紝蹇界暐閿欒
                  console.log(`[ProcessManager] Process ${pid} already exited`);
                }
                resolve();
              });
            });
          } catch (error) {
            console.log(`[ProcessManager] Failed to kill process ${pid}`);
          }
        })
      );

      // 鏇存柊杩涘害锛堟瘡鎵瑰鐞嗗畬鍚庢洿鏂颁竴娆★紝鍑忓皯 IPC 璋冪敤棰戠巼锛?
      processedCount += batch.length;
      if (progressCallback) {
        progressCallback(Math.min(processedCount, totalProcesses), totalProcesses);
      }

      // 姣忔壒涔嬮棿鐭殏寤惰繜锛岃 UI 鏈夋満浼氭洿鏂?
      if (i + batchSize < pids.length) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
  }

  /**
   * 鎵归噺缁堟杩涚▼鏍戯紙Unix/macOS锛?
   * 浣跨敤杩涚▼缁?(PGID) 缁堟鏁翠釜杩涚▼鏍?
   */
  private async killProcessTreesUnix(
    pids: number[],
    progressCallback?: (current: number, total: number) => void,
    total?: number
  ): Promise<void> {
    const totalProcesses = total || pids.length;
    let processedCount = 0;

    // 鍒嗘壒澶勭悊锛屾瘡鎵规渶澶?10 涓繘绋?
    const batchSize = 10;
    for (let i = 0; i < pids.length; i += batchSize) {
      const batch = pids.slice(i, i + batchSize);

      // 浣跨敤 Promise.all 骞惰缁堟澶氫釜杩涚▼鏍?
      await Promise.all(
        batch.map(async (pid) => {
          try {
            await new Promise<void>((resolve) => {
              setImmediate(() => {
                try {
                  // 鏂规硶1: 灏濊瘯缁堟杩涚▼缁勶紙璐?PID 琛ㄧず杩涚▼缁勶級
                  // 杩欎細缁堟璇ヨ繘绋嬪強鍏舵墍鏈夊瓙杩涚▼
                  try {
                    process.kill(-pid, 'SIGKILL');
                    console.log(`[ProcessManager] Killed process group -${pid}`);
                  } catch (pgidError) {
                    // 濡傛灉杩涚▼缁勭粓姝㈠け璐ワ紝灏濊瘯鐩存帴缁堟杩涚▼
                    try {
                      process.kill(pid, 'SIGKILL');
                      console.log(`[ProcessManager] Killed process ${pid}`);
                    } catch (pidError) {
                      console.log(`[ProcessManager] Process ${pid} already exited`);
                    }
                  }

                  // 鏂规硶2: 浣跨敤 pkill 缁堟瀛愯繘绋嬶紙澶囩敤鏂规锛?
                  // pkill -P <pid> 浼氱粓姝㈡墍鏈夌埗杩涚▼涓?<pid> 鐨勫瓙杩涚▼
                  try {
                    execSync(`pkill -9 -P ${pid}`, { stdio: 'ignore' });
                    console.log(`[ProcessManager] Killed children of process ${pid}`);
                  } catch (error) {
                    // 蹇界暐閿欒锛屽彲鑳芥病鏈夊瓙杩涚▼
                  }
                } catch (error) {
                  console.log(`[ProcessManager] Failed to kill process ${pid}`);
                }
                resolve();
              });
            });
          } catch (error) {
            console.log(`[ProcessManager] Failed to kill process ${pid}`);
          }
        })
      );

      // 鏇存柊杩涘害锛堟瘡鎵瑰鐞嗗畬鍚庢洿鏂颁竴娆★紝鍑忓皯 IPC 璋冪敤棰戠巼锛?
      processedCount += batch.length;
      if (progressCallback) {
        progressCallback(Math.min(processedCount, totalProcesses), totalProcesses);
      }

      // 姣忔壒涔嬮棿鐭殏寤惰繜锛岃 UI 鏈夋満浼氭洿鏂?
      if (i + batchSize < pids.length) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
  }

  /**
   * Windows: 寮哄埗缁堟杩涚▼鏍?
   */
  private killProcessTreeWindows(pid: number): void {
    try {
      // 浣跨敤 taskkill /F /T 寮哄埗缁堟杩涚▼鍙婂叾鎵€鏈夊瓙杩涚▼
      execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' });
      console.log(`[ProcessManager] Killed process tree for PID ${pid}`);
    } catch (error) {
      // 杩涚▼鍙兘宸茬粡閫€鍑猴紝蹇界暐閿欒
      console.log(`[ProcessManager] Process ${pid} already exited or kill failed`);
    }
  }

  /**
   * 鑾峰彇鐢ㄤ簬鍒涘缓 PTY 鐨勭幆澧冨彉閲忥紙甯︾煭鏈熺紦瀛橈級
   * 璇存槑锛歐indows 涓嬭鍙栨敞鍐岃〃鏄悓姝ュ懡浠わ紝缂撳瓨鍙樉钁楅檷浣庡崱椤挎鐜囥€?
   */
  private getSpawnEnvironment(preferredShellProgram?: string): NodeJS.ProcessEnv {
    const shellKey = preferredShellProgram?.trim() || '';
    const now = Date.now();
    if (
      this.cachedSpawnEnv &&
      this.cachedSpawnEnvShellKey === shellKey &&
      now - this.cachedSpawnEnvAt < this.SPAWN_ENV_CACHE_TTL_MS
    ) {
      return this.cachedSpawnEnv;
    }

    this.cachedSpawnEnv = getLatestEnvironmentVariables({
      preferredShellProgram,
    });
    this.cachedSpawnEnvAt = now;
    this.cachedSpawnEnvShellKey = shellKey;
    return this.cachedSpawnEnv;
  }

  /**
   * 鍒涘缓 Mock PTY 杩涚▼锛堜粎鍦?node-pty 涓嶅彲鐢ㄦ椂浣跨敤锛?
   */
  private createMockPty(pid: number, config: TerminalConfig): any {
    // Mock 瀹炵幇
    const dataCallbacks: Array<(data: string) => void> = [];
    const exitCallbacks: Array<(exitCode: number) => void> = [];

    const mockPty = {
      pid,
      cols: config.initialCols ?? 80,
      rows: config.initialRows ?? 30,
      onData: (callback: (data: string) => void) => {
        dataCallbacks.push(callback);
        // Mock: 妯℃嫙缁堢杈撳嚭
        setTimeout(() => {
          callback(`Mock terminal started in ${config.workingDirectory}\r\n`);
          callback(`$ `); // 鏄剧ず鎻愮ず绗?
        }, 100);
      },
      onExit: (callback: (exitCode: number) => void) => {
        exitCallbacks.push(callback);
      },
      write: (data: string) => {
        // Mock: 鍥炴樉鐢ㄦ埛杈撳叆骞舵ā鎷熷懡浠ゆ墽琛?
        dataCallbacks.forEach(cb => {
          cb(data); // 鍥炴樉杈撳叆

          // 濡傛灉鏄洖杞︼紝妯℃嫙鍛戒护鎵ц
          if (data === '\r') {
            cb('\r\n$ '); // 鏂拌 + 鎻愮ず绗?
          }
        });
      },
      resize: (cols: number, rows: number) => {
        // Mock: 妯℃嫙璋冩暣缁堢澶у皬锛堟棤闇€瀹為檯鎿嶄綔锛?
        mockPty.cols = cols;
        mockPty.rows = rows;
      },
      kill: () => {
        // Mock: 妯℃嫙缁堟杩涚▼
        exitCallbacks.forEach(cb => cb(0));
        this.killProcess(pid);
      },
    };
    return mockPty;
  }

  /**
   * 鍒涘缓鐪熷疄鐨?PTY 杩涚▼锛堜娇鐢?node-pty锛?
   */
  private createRealPty(config: TerminalConfig, executable: string, args: string[]): any {
    this.ensureNodePtySpawnHelperExecutable();

    // 鑾峰彇鏈€鏂扮殑绯荤粺鐜鍙橀噺锛圵indows 浠庢敞鍐岃〃璇诲彇锛宮acOS/Linux 浣跨敤 process.env锛?
    const latestEnv = this.getSpawnEnvironment(executable);

    // 娓呯悊鐜鍙橀噺锛岀Щ闄ゅ彲鑳藉鑷村啿绐佺殑鍙橀噺
    const cleanEnv = { ...latestEnv };
    delete cleanEnv.CLAUDECODE; // 绉婚櫎 Claude Code 鐜鍙橀噺锛岄伩鍏嶅祵濂椾細璇濇娴?
    delete cleanEnv.VSCODE_INJECTION; // 绉婚櫎 VS Code 娉ㄥ叆鍙橀噺

    // 娉ㄥ叆绐楀彛 ID 鐜鍙橀噺锛堜緵 statusLine 鎻掍欢浣跨敤锛?
    cleanEnv.AUSOME_TERMINAL_WINDOW_ID = config.windowId;

    // 鍚堝苟鐢ㄦ埛鎻愪緵鐨勭幆澧冨彉閲忥紙濡傛灉鏈夛級
    if (config.env) {
      Object.assign(cleanEnv, config.env);
    }

    // 娉ㄥ叆 tmux 鍏煎鐜鍙橀噺锛堝鏋滃惎鐢級
    if (this.shouldEnableTmuxCompat()) {
      const tmuxEnv = this.buildTmuxEnvironment(config, cleanEnv);
      Object.assign(cleanEnv, tmuxEnv);
      this.appendTmuxDebugFile('tmux environment injected into PTY', {
        windowId: config.windowId,
        paneId: config.paneId,
        executable,
        args,
        cwd: config.workingDirectory,
        tmux: cleanEnv.TMUX,
        tmuxPane: cleanEnv.TMUX_PANE,
        rpcPath: cleanEnv.AUSOME_TMUX_RPC,
        logFile: cleanEnv.AUSOME_TMUX_LOG_FILE,
        nodePath: cleanEnv.AUSOME_NODE_PATH,
      }, cleanEnv.AUSOME_TMUX_LOG_FILE);

      if (process.env.AUSOME_TMUX_DEBUG === '1') {
        console.log('[ProcessManager] Injected tmux environment:', {
          TMUX: cleanEnv.TMUX,
          TMUX_PANE: cleanEnv.TMUX_PANE,
          AUSOME_TERMINAL_WINDOW_ID: cleanEnv.AUSOME_TERMINAL_WINDOW_ID,
          AUSOME_TERMINAL_PANE_ID: cleanEnv.AUSOME_TERMINAL_PANE_ID,
          AUSOME_TMUX_RPC: cleanEnv.AUSOME_TMUX_RPC,
        });
      }
    }

    // macOS: 确保 LANG 设置为 UTF-8，避免从 Finder 启动时中文乱码
    if (platform() === 'darwin' && !cleanEnv.LANG) {
      cleanEnv.LANG = 'en_US.UTF-8';
    }

    // 创建真实的 PTY 进程
    const ptySpawnOptions: Record<string, unknown> = {
      name: 'xterm-256color',
      cols: config.initialCols ?? 80,
      rows: config.initialRows ?? 30,
      cwd: config.workingDirectory,
      env: cleanEnv,
    };

    if (platform() === 'win32') {
      const useBundledConptyDll = this.shouldUseBundledConptyDll();
      ptySpawnOptions.useConpty = true;
      if (useBundledConptyDll) {
        ptySpawnOptions.useConptyDll = true;
      }
    }

    try {
      this.appendTmuxDebugFile('spawning PTY', {
        executable,
        args,
        cwd: config.workingDirectory,
        platform: platform(),
        tmuxEnabled: this.shouldEnableTmuxCompat(),
      }, cleanEnv.AUSOME_TMUX_LOG_FILE);
      console.log('[ProcessManager] Spawning PTY:', {
        executable,
        args,
        cwd: config.workingDirectory,
        platform: platform(),
      });

      const ptyProcess = pty.spawn(executable, args, ptySpawnOptions);
      this.guardExitedWindowsPtyResize(ptyProcess);
      this.appendTmuxDebugFile('PTY spawned', {
        pid: ptyProcess.pid,
        executable,
        args,
        cwd: config.workingDirectory,
      }, cleanEnv.AUSOME_TMUX_LOG_FILE);
      return ptyProcess;
    } catch (error) {
      this.appendTmuxDebugFile('PTY spawn failed', {
        executable,
        args,
        cwd: config.workingDirectory,
        error: error instanceof Error ? {
          name: error.name,
          message: error.message,
          stack: error.stack,
        } : String(error),
      }, cleanEnv.AUSOME_TMUX_LOG_FILE);
      console.error('[ProcessManager] Failed to spawn PTY:', {
        error,
        executable,
        args,
        cwd: config.workingDirectory,
        cwdExists: existsSync(config.workingDirectory),
        executableExists: existsSync(executable),
      });
      throw error;
    }
  }

  private guardExitedWindowsPtyResize(ptyProcess: any): void {
    const agent = ptyProcess?._agent;
    if (!agent || typeof agent.resize !== 'function' || agent.__synapseResizeGuarded) {
      return;
    }

    const originalResize = agent.resize.bind(agent);
    Object.defineProperty(agent, '__synapseResizeGuarded', {
      value: true,
      configurable: true,
    });

    agent.resize = (...args: unknown[]) => {
      try {
        return originalResize(...args);
      } catch (error) {
        if (!this.isExitedPtyResizeError(error)) {
          throw error;
        }

        const pid = typeof ptyProcess?.pid === 'number' ? ptyProcess.pid : null;
        if (pid !== null) {
          this.finalizeProcessExit(pid, this.readPtyExitCode(ptyProcess) ?? 0);
        }
      }
    };
  }

  private readPtyExitCode(ptyProcess: any): number | undefined {
    try {
      const ptyExitCode = ptyProcess?.exitCode;
      if (typeof ptyExitCode === 'number') {
        return ptyExitCode;
      }
    } catch {
      // Ignore exit code getter failures from partially torn down PTYs.
    }

    try {
      const agentExitCode = ptyProcess?._agent?.exitCode;
      return typeof agentExitCode === 'number' ? agentExitCode : undefined;
    } catch {
      return undefined;
    }
  }

  private ensureNodePtySpawnHelperExecutable(): void {
    if (platform() !== 'darwin') {
      return;
    }

    const helperCandidates = [
      path.join(process.cwd(), 'node_modules', 'node-pty', 'prebuilds', 'darwin-arm64', 'spawn-helper'),
      path.join(process.cwd(), 'node_modules', 'node-pty', 'prebuilds', 'darwin-x64', 'spawn-helper'),
      path.join(__dirname, '..', '..', '..', 'node_modules', 'node-pty', 'prebuilds', 'darwin-arm64', 'spawn-helper'),
      path.join(__dirname, '..', '..', '..', 'node_modules', 'node-pty', 'prebuilds', 'darwin-x64', 'spawn-helper'),
    ];

    for (const helperPath of helperCandidates) {
      if (!existsSync(helperPath)) {
        continue;
      }

      try {
        chmodSync(helperPath, 0o755);
      } catch (error) {
        console.error('[ProcessManager] Failed to chmod node-pty spawn-helper:', {
          helperPath,
          error,
        });
      }
    }
  }

  private resolveLaunchCommand(config: TerminalConfig): { command: string; file: string; args: string[] } {
    const command = resolveShellProgram({
      preferredShellProgram: config.command,
      settings: this.getSettings?.() ?? null,
    });
    const tokens = this.tokenizeCommand(command);

    if (tokens.length === 0) {
      throw new Error('Terminal command resolved to an empty value');
    }

    const explicitExecutable = this.findExplicitExecutable(tokens);
    if (explicitExecutable) {
      // macOS: 标准 shell 以 login shell 启动，确保环境变量完整继承
      this.ensureLoginShell(explicitExecutable);
      return {
        command,
        file: explicitExecutable.file,
        args: explicitExecutable.args,
      };
    }

    const result = {
      command,
      file: tokens[0],
      args: tokens.slice(1),
    };
    this.ensureLoginShell(result);
    return result;
  }

  /**
   * Unix (macOS/Linux): 为标准 shell 添加 -l (login) 参数
   * 确保从桌面环境（Finder/GNOME/KDE）启动时 nvm/pyenv/rbenv 等工具的 PATH 可用
   */
  private ensureLoginShell(launch: { file: string; args: string[] }): void {
    const currentPlatform = process.platform;
    if (currentPlatform === 'win32') return;

    const shellName = path.basename(launch.file);
    const isStandardShell = ['zsh', 'bash', 'sh', 'fish'].includes(shellName);
    if (!isStandardShell) return;

    // 如果已经有 -l 或 --login 参数，不重复添加
    if (launch.args.some(a => a === '-l' || a === '--login')) return;

    // macOS login shell 会经过 /etc/zprofile(path_helper)，它可能重建 PATH，
    // 导致前置注入的 tmux shim 目录被冲掉，Claude 最终调用到真实 tmux。
    // 在启用 tmux PATH 注入时，优先保留父进程 PATH，避免 Agent Teams 失效。
    const settings = this.getSettings?.();
    if (
      currentPlatform === 'darwin'
      && (settings?.tmux?.enabled ?? false)
      && (settings?.tmux?.autoInjectPath ?? true)
    ) {
      return;
    }

    launch.args.unshift('-l');
  }

  private findExplicitExecutable(tokens: string[]): { file: string; args: string[] } | null {
    for (let i = tokens.length; i >= 1; i--) {
      const candidate = tokens.slice(0, i).join(' ');
      if (existsSync(candidate)) {
        return {
          file: candidate,
          args: tokens.slice(i),
        };
      }
    }

    return null;
  }

  private tokenizeCommand(command: string): string[] {
    const tokens: string[] = [];
    let current = '';
    let quote: '"' | "'" | null = null;

    for (const char of command.trim()) {
      if ((char === '"' || char === '\'') && quote === null) {
        quote = char;
        continue;
      }

      if (char === quote) {
        quote = null;
        continue;
      }

      if (/\s/.test(char) && quote === null) {
        if (current) {
          tokens.push(current);
          current = '';
        }
        continue;
      }

      current += char;
    }

    if (current) {
      tokens.push(current);
    }

    return tokens;
  }

  private shouldUseBundledConptyDll(): boolean {
    if (platform() !== 'win32') {
      return false;
    }

    const override = process.env.AUSOME_USE_CONPTY_DLL?.trim().toLowerCase();
    if (override === '1' || override === 'true') {
      return true;
    }
    if (override === '0' || override === 'false') {
      return false;
    }

    return this.getSettings?.()?.terminal?.useBundledConptyDll ?? true;
  }

  /**
   * 妫€鏌ユ槸鍚﹀惎鐢?tmux 鍏煎妯″紡
   */
  private async ensureTmuxRpcServer(config: TerminalConfig): Promise<void> {
    const logFile = this.getTmuxDebugLogFilePath();
    this.appendTmuxDebugFile('ensureTmuxRpcServer invoked', {
      tmuxCompatEnabled: this.shouldEnableTmuxCompat(),
      windowId: config.windowId,
      paneId: config.paneId,
    }, logFile);

    if (!this.shouldEnableTmuxCompat()) {
      return;
    }

    if (!this.tmuxCompatService) {
      this.appendTmuxDebugFile('tmux compat service unavailable during ensureTmuxRpcServer', {
        windowId: config.windowId,
        paneId: config.paneId,
      }, logFile);
      console.warn('[ProcessManager] Tmux compat enabled but service is unavailable, skipping RPC server ensure');
      return;
    }

    if (!config.windowId) {
      this.appendTmuxDebugFile('windowId missing during ensureTmuxRpcServer', {
        paneId: config.paneId,
      }, logFile);
      console.warn('[ProcessManager] Tmux compat enabled but windowId is missing, skipping RPC server ensure');
      return;
    }

    try {
      const socketPath = await this.tmuxCompatService.ensureRpcServer(config.windowId);
      this.appendTmuxDebugFile('tmux RPC server ensured', {
        windowId: config.windowId,
        socketPath,
      }, logFile);
      console.log(`[ProcessManager] Ensured tmux RPC server for windowId=${config.windowId} at ${socketPath}`);
    } catch (error) {
      this.appendTmuxDebugFile('tmux RPC server ensure failed', {
        windowId: config.windowId,
        error: error instanceof Error ? {
          name: error.name,
          message: error.message,
          stack: error.stack,
        } : String(error),
      }, logFile);
      throw error;
    }
  }

  private shouldEnableTmuxCompat(): boolean {
    const settings = this.getSettings?.();
    return settings?.tmux?.enabled ?? false;
  }

  /**
   * 鏋勫缓 tmux 鐜鍙橀噺
   */
  private buildTmuxEnvironment(config: TerminalConfig, baseEnv: NodeJS.ProcessEnv): Partial<NodeJS.ProcessEnv> {
    const tmuxLogFile = this.getTmuxDebugLogFilePath();

    if (!this.tmuxCompatService) {
      this.appendTmuxDebugFile('skipping tmux environment injection because service is unavailable', {
        windowId: config.windowId,
        paneId: config.paneId,
      }, tmuxLogFile);
      console.warn('[ProcessManager] TmuxCompatService not available, skipping tmux environment injection');
      return {};
    }

    if (!config.windowId || !config.paneId) {
      this.appendTmuxDebugFile('skipping tmux environment injection because pane identity is incomplete', {
        windowId: config.windowId,
        paneId: config.paneId,
      }, tmuxLogFile);
      console.warn('[ProcessManager] windowId or paneId missing, skipping tmux environment injection');
      return {};
    }

    const existingTmuxPaneId = this.tmuxCompatService.getTmuxPaneId(config.windowId, config.paneId);
    const tmuxPaneId = existingTmuxPaneId ?? this.tmuxCompatService.allocatePaneId();

    if (!existingTmuxPaneId) {
      this.tmuxCompatService.registerPane(tmuxPaneId, config.windowId, config.paneId);
    }

    const rpcSocketPath = this.getRpcSocketPath(config.windowId);

    const tmuxSocketPath = platform() === 'win32'
      ? `\\\\.\\pipe\\ausome-tmux-default`
      : `/tmp/tmux-${process.getuid?.() ?? 1000}/default`;

    const tmuxValue = `${tmuxSocketPath},${process.pid},0`;

    const settings = this.getSettings?.();
    const autoInjectPath = settings?.tmux?.autoInjectPath ?? true;

    const currentPath = baseEnv.Path || baseEnv.PATH || process.env.Path || process.env.PATH || '';
    let newPath = currentPath;
    let fakeTmuxDir: string | undefined;
    if (autoInjectPath) {
      fakeTmuxDir = this.getFakeTmuxDir();
      newPath = `${fakeTmuxDir}${path.delimiter}${currentPath}`;
    }

    // Resolve absolute path to node so the tmux shim script can find it
    // even when Electron's PATH doesn't include the node binary directory.
    // In Electron, process.execPath points to the Electron binary, not node.
    const preferredShell = resolveShellProgram({
      settings: this.getSettings?.() ?? null,
    });
    const isElectron = process.versions && process.versions.electron;
    const nodePath = isElectron
      ? resolveNodePath({
          currentPath,
          env: baseEnv,
          preferredShell,
        })
      : process.execPath;

    this.appendTmuxDebugFile('buildTmuxEnvironment', {
      windowId: config.windowId,
      paneId: config.paneId,
      tmuxPaneId,
      rpcSocketPath,
      tmuxValue,
      autoInjectPath,
      fakeTmuxDir,
      nodePath,
      preferredShell,
      isElectron: Boolean(isElectron),
    }, tmuxLogFile);

    return {
      CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',
      TMUX: tmuxValue,
      AUSOME_TMUX_EXPECTED_TMUX: tmuxValue,
      TMUX_PANE: tmuxPaneId,
      AUSOME_TERMINAL_WINDOW_ID: config.windowId,
      AUSOME_TERMINAL_PANE_ID: config.paneId,
      AUSOME_TMUX_RPC: rpcSocketPath,
      AUSOME_TMUX_LOG_FILE: tmuxLogFile,
      AUSOME_NODE_PATH: nodePath,
      ...(baseEnv.AUSOME_TMUX_DEBUG === '1' ? { AUSOME_TMUX_DEBUG: '1' } : {}),
      PATH: newPath,
      Path: newPath,
    };
  }
  private getFakeTmuxDir(): string {
    try {
      return getTmuxShimDir();
    } catch (error) {
      console.error('[ProcessManager] Failed to resolve tmux shim dir:', error);
      return path.join(process.cwd(), 'resources', 'bin');
    }
  }
  private getRpcSocketPath(windowId: string): string {
    if (this.tmuxCompatService) {
      return this.tmuxCompatService.getRpcSocketPath(windowId);
    }

    if (platform() === 'win32') {
      return `\\\\.\\pipe\\ausome-tmux-${windowId}`;
    } else {
      return `/tmp/ausome-tmux-${windowId}.sock`;
    }
  }

  private getTmuxDebugLogFilePath(): string {
    return path.join(tmpdir(), 'synapse-tmux-debug.log');
  }

  private appendTmuxDebugFile(
    message: string,
    extra?: unknown,
    logFile: string = this.getTmuxDebugLogFilePath(),
  ): void {
    const payload = extra === undefined
      ? ''
      : ` ${JSON.stringify(extra, (_key, value) => value instanceof Error ? {
          name: value.name,
          message: value.message,
          stack: value.stack,
        } : value)}`;

    try {
      appendFileSync(logFile, `[ProcessManager ${new Date().toISOString()}] ${message}${payload}\n`, 'utf8');
    } catch {
      // ignore file logging failures
    }
  }

  rebindPaneProcess(oldWindowId: string, paneId: string, newWindowId: string, newPaneId: string = paneId): void {
    const oldKey = this.getPaneKey(oldWindowId, paneId);
    const pid = this.paneIndex.get(oldKey);
    if (!pid) {
      return;
    }
    const sessionId = this.sessionIndex.get(oldKey) ?? null;

    const newKey = this.getPaneKey(newWindowId, newPaneId);
    if (oldKey !== newKey) {
      this.paneIndex.delete(oldKey);
      this.paneIndex.set(newKey, pid);
      if (sessionId) {
        this.sessionIndex.delete(oldKey);
        this.sessionIndex.set(newKey, sessionId);
      }
    }

    const history = this.paneHistoryBuffers.get(oldKey);
    if (history && oldKey !== newKey) {
      this.paneHistoryBuffers.delete(oldKey);
      this.paneHistoryBuffers.set(newKey, history);
    }
    const screenSnapshot = this.terminalScreenSnapshots.get(oldKey);
    if (screenSnapshot && oldKey !== newKey) {
      this.terminalScreenSnapshots.delete(oldKey);
      this.terminalScreenSnapshots.set(newKey, {
        ...screenSnapshot,
        windowId: newWindowId,
        paneId: newPaneId,
      });
    }
    if (paneId !== newPaneId) {
      const legacyHistory = this.paneHistoryBuffers.get(paneId);
      if (legacyHistory) {
        this.paneHistoryBuffers.delete(paneId);
        this.paneHistoryBuffers.set(newPaneId, legacyHistory);
      }
      const legacyScreenSnapshot = this.terminalScreenSnapshots.get(paneId);
      if (legacyScreenSnapshot) {
        this.terminalScreenSnapshots.delete(paneId);
        this.terminalScreenSnapshots.set(newPaneId, {
          ...legacyScreenSnapshot,
          windowId: newWindowId,
          paneId: newPaneId,
        });
      }
    }

    const processInfo = this.processes.get(pid);
    if (processInfo) {
      processInfo.windowId = newWindowId;
      processInfo.paneId = newPaneId;
    }
  }

  private disposePtyDisposables(pid: number): void {
    const disposables = this.ptyDisposables.get(pid);
    if (!disposables) {
      return;
    }

    disposables.forEach(d => {
      try {
        d.dispose();
      } catch {
        // Ignore PTY listener cleanup failures.
      }
    });
    this.ptyDisposables.delete(pid);
  }

  private finalizeProcessExit(pid: number, exitCode: number): void {
    const processInfo = this.processes.get(pid);
    if (!processInfo || processInfo.status === ProcessStatus.Exited) {
      return;
    }

    this.disposePtyDisposables(pid);
    this.ptyOutputBuffers.delete(pid);
    this.terminalOscColorQueryPending.delete(pid);
    this.ptys.delete(pid);
    if (processInfo.paneId) {
      this.paneHistoryBuffers.delete(this.getPaneKey(processInfo.windowId, processInfo.paneId));
      this.paneHistoryBuffers.delete(processInfo.paneId);
      this.clearTerminalScreenSnapshot(processInfo.windowId, processInfo.paneId);
    }

    const paneKey = this.getPaneKey(processInfo.windowId, processInfo.paneId);
    this.paneIndex.delete(paneKey);
    this.sessionIndex.delete(paneKey);
    this.pidToSessionId.delete(pid);
    this.sessionIdToPid.delete(processInfo.sessionId);

    processInfo.status = ProcessStatus.Exited;
    processInfo.exitCode = exitCode;

    this.statusDetector.onProcessExit(pid, exitCode);
    this.emit('process-exited', processInfo);
    this.scheduleProcessCleanup(pid);
  }

  private resetPaneHistory(windowId?: string, paneId?: string): void {
    if (!paneId) {
      return;
    }

    this.paneHistoryBuffers.delete(paneId);
    this.clearTerminalScreenSnapshot(windowId, paneId);
    this.paneHistoryBuffers.set(this.getPaneKey(windowId, paneId), {
      entries: [],
      totalLength: 0,
      nextSeq: 1,
      lastSeq: 0,
      evictedBeforeSeq: 0,
      keyboardState: createDefaultKeyboardProtocolState(),
    });
  }

  getPaneTerminalDimensions(paneId: string): { cols?: number; rows?: number };
  getPaneTerminalDimensions(windowId: string, paneId: string): { cols?: number; rows?: number };
  getPaneTerminalDimensions(windowIdOrPaneId: string, paneId?: string): { cols?: number; rows?: number } {
    for (const processInfo of this.processes.values()) {
      if (
        processInfo.status === ProcessStatus.Exited ||
        processInfo.paneId !== (paneId ?? windowIdOrPaneId) ||
        (paneId && processInfo.windowId !== windowIdOrPaneId)
      ) {
        continue;
      }
      const cols = processInfo.terminalCols;
      const rows = processInfo.terminalRows;
      return {
        ...(typeof cols === 'number' && cols > 0 ? { cols } : {}),
        ...(typeof rows === 'number' && rows > 0 ? { rows } : {}),
      };
    }
    return {};
  }

  private appendPaneHistory(windowId: string | undefined, paneId: string | undefined, data: string): number | undefined {
    if (!paneId || !data) {
      return undefined;
    }

    const historyKey = this.getPaneKey(windowId, paneId);
    const history = this.paneHistoryBuffers.get(historyKey) ?? {
      entries: [],
      totalLength: 0,
      nextSeq: 1,
      lastSeq: 0,
      evictedBeforeSeq: 0,
      keyboardState: createDefaultKeyboardProtocolState(),
    };

    const seq = history.nextSeq++;
    history.entries.push({ seq, data });
    history.totalLength += data.length;
    history.lastSeq = seq;
    updateKeyboardProtocolStateFromOutput(history.keyboardState, data);

    while (
      history.entries.length > this.PANE_HISTORY_CHUNK_LIMIT
      || history.totalLength > this.PANE_HISTORY_CHAR_LIMIT
    ) {
      const removed = history.entries.shift();
      if (!removed) {
        break;
      }
      history.totalLength -= removed.data.length;
      history.evictedBeforeSeq = Math.max(history.evictedBeforeSeq, removed.seq);
    }

    this.paneHistoryBuffers.set(historyKey, history);
    return seq;
  }

  private getPaneHistoryBuffer(windowIdOrPaneId: string, paneId?: string): PaneHistoryBuffer | undefined {
    if (paneId) {
      return this.paneHistoryBuffers.get(this.getPaneKey(windowIdOrPaneId, paneId));
    }

    const legacyHistory = this.paneHistoryBuffers.get(windowIdOrPaneId);
    if (legacyHistory) {
      return legacyHistory;
    }

    for (const processInfo of this.processes.values()) {
      if (processInfo.paneId !== windowIdOrPaneId || processInfo.status === ProcessStatus.Exited) {
        continue;
      }
      return this.paneHistoryBuffers.get(this.getPaneKey(processInfo.windowId, processInfo.paneId));
    }

    return undefined;
  }

  private scheduleProcessCleanup(pid: number): void {
    if (this.processCleanupTimers.has(pid)) {
      return;
    }

    const cleanupTimer = setTimeout(() => {
      this.processCleanupTimers.delete(pid);
      this.processes.delete(pid);
      this.ptyDataSubscribers.delete(pid);
      this.statusDetector.untrackPid(pid);
    }, 1000);
    cleanupTimer.unref();

    this.processCleanupTimers.set(pid, cleanupTimer);
  }

  private isExitedPtyResizeError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /Cannot resize a pty that has already exited/i.test(message);
  }
}

function getPaneHistoryFirstSeq(history: PaneHistoryBuffer): number {
  const firstEntry = history.entries[0];
  if (firstEntry) {
    return firstEntry.seq;
  }
  return history.lastSeq > 0 ? history.lastSeq + 1 : 0;
}

function normalizeHistoryLimit(value: number | undefined, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  return fallback;
}

function isSSHPortForwardSession(value: unknown): value is {
  listPortForwards(): ActiveSSHPortForward[];
  addPortForward(config: ForwardedPortConfig): Promise<ActiveSSHPortForward>;
  removePortForward(forwardId: string): Promise<void>;
} {
  return Boolean(
    value
    && typeof value === 'object'
    && typeof (value as { listPortForwards?: unknown }).listPortForwards === 'function'
    && typeof (value as { addPortForward?: unknown }).addPortForward === 'function'
    && typeof (value as { removePortForward?: unknown }).removePortForward === 'function',
  );
}

function isSSHSftpSession(value: unknown): value is {
  listSftpDirectory(path?: string): Promise<SSHSftpDirectoryListing>;
  getSSHSessionMetrics(path?: string): Promise<SSHSessionMetrics>;
  downloadSftpFile(remotePath: string, localPath: string): Promise<void>;
  uploadSftpFiles(remotePath: string, localPaths: string[]): Promise<number>;
  uploadSftpDirectory(remotePath: string, localDirectoryPath: string): Promise<number>;
  downloadSftpDirectory(remotePath: string, localPath: string): Promise<void>;
  createSftpDirectory(parentPath: string, name: string): Promise<string>;
  deleteSftpEntry(remotePath: string): Promise<void>;
} {
  return Boolean(
    value
    && typeof value === 'object'
    && typeof (value as { listSftpDirectory?: unknown }).listSftpDirectory === 'function'
    && typeof (value as { getSSHSessionMetrics?: unknown }).getSSHSessionMetrics === 'function'
    && typeof (value as { downloadSftpFile?: unknown }).downloadSftpFile === 'function'
    && typeof (value as { uploadSftpFiles?: unknown }).uploadSftpFiles === 'function'
    && typeof (value as { uploadSftpDirectory?: unknown }).uploadSftpDirectory === 'function'
    && typeof (value as { downloadSftpDirectory?: unknown }).downloadSftpDirectory === 'function'
    && typeof (value as { createSftpDirectory?: unknown }).createSftpDirectory === 'function'
    && typeof (value as { deleteSftpEntry?: unknown }).deleteSftpEntry === 'function'
  );
}

function isSSHExecSession(value: unknown): value is {
  execCommand(command: string): Promise<string>;
} {
  return Boolean(
    value
    && typeof value === 'object'
    && typeof (value as { execCommand?: unknown }).execCommand === 'function'
  );
}

function isSSHExecDetailedSession(value: unknown): value is {
  execCommandResult(command: string): Promise<import('../types/process').SSHExecCommandResult>;
} {
  return Boolean(
    value
    && typeof value === 'object'
    && typeof (value as { execCommandResult?: unknown }).execCommandResult === 'function'
  );
}

function isSSHExecStreamSession(value: unknown): value is {
  execCommandStream(
    command: string,
    callbacks?: import('../types/process').SSHExecCommandCallbacks,
  ): Promise<import('../types/process').SSHExecCommandHandle>;
} {
  return Boolean(
    value
    && typeof value === 'object'
    && typeof (value as { execCommandStream?: unknown }).execCommandStream === 'function'
  );
}
