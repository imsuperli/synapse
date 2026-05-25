import {
  ActiveSSHPortForward,
  ForwardedPortConfig,
  SSHAlgorithmPreferences,
  SSHAuthType,
  SSHRemoteLocaleMode,
  SSHRoutingMode,
  SSHSftpDirectoryListing,
  SSHSessionMetrics,
} from '../../shared/types/ssh';
import { PaneBackend } from '../../shared/types/window';

/**
 * 统一的 PTY 接口
 * 兼容 node-pty 的 IPty 接口和 mock 实现
 */
export interface IPty {
  pid: number;
  cols: number;
  rows: number;
  process: string;
  handleFlowControl: boolean;

  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;

  onData(listener: (data: string) => void): { dispose(): void };
  onExit(listener: (exitCode: { exitCode: number; signal?: number }) => void): { dispose(): void };
}

// 终端配置
export interface TerminalConfig {
  workingDirectory: string;
  command?: string;  // 可选，指定要启动的 shell 程序
  env?: Record<string, string>;
  name?: string;  // 窗口名称
  windowId?: string;  // 关联的窗口 ID
  paneId?: string;  // 关联的窗格 ID（用于拆分功能）
  backend?: PaneBackend;
  ssh?: SSHSessionConfig;
  initialCols?: number;  // 终端初始列数（来自渲染进程的实际尺寸）
  initialRows?: number;  // 终端初始行数（来自渲染进程的实际尺寸）
}

export interface SSHSessionConfig {
  profileId: string;
  host: string;
  port: number;
  user: string;
  authType: SSHAuthType;
  privateKeys: string[];
  privateKeyPassphrases?: Record<string, string>;
  password?: string;
  keepaliveInterval: number;
  keepaliveCountMax: number;
  readyTimeout: number | null;
  verifyHostKeys: boolean;
  agentForward: boolean;
  reuseSession: boolean;
  routingMode: SSHRoutingMode;
  jumpHost?: SSHSessionConfig;
  jumpHostProfileId?: string;
  proxyCommand?: string;
  socksProxyHost?: string;
  socksProxyPort?: number;
  httpProxyHost?: string;
  httpProxyPort?: number;
  forwardedPorts: ForwardedPortConfig[];
  algorithms?: SSHAlgorithmPreferences;
  x11?: boolean;
  skipBanner?: boolean;
  remoteLocaleMode?: SSHRemoteLocaleMode;
  remoteLocale?: string;
  remoteCwd?: string;
  command?: string;
}

export interface ZmodemDialogHandlers {
  selectSendFiles?: () => Promise<string[] | null>;
  chooseSavePath?: (suggestedName: string) => Promise<string | null>;
}

// 进程句柄
export interface ProcessHandle {
  pid: number;
  sessionId: string;
  pty: IPty;
}

// 进程状态
export enum ProcessStatus {
  Alive = 'alive',
  Exited = 'exited',
}

// 进程信息
export interface ProcessInfo {
  sessionId: string;
  backend: PaneBackend;
  pid: number;
  status: ProcessStatus;
  exitCode?: number;
  workingDirectory: string;
  command?: string;
  profileId?: string;
  windowId?: string;  // 关联的窗口 ID
  paneId?: string;  // 关联的窗格 ID
}

export interface SSHExecCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface SSHExecCommandCallbacks {
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}

export interface SSHExecCommandHandle {
  result: Promise<SSHExecCommandResult>;
  cancel: () => void;
}

// ProcessManager 接口
export interface IProcessManager {
  spawnTerminal(config: TerminalConfig): Promise<ProcessHandle>;
  killProcess(pid: number): Promise<void>;
  getProcessStatus(pid: number): ProcessInfo | null;
  getSessionIdByPane(windowId: string, paneId?: string): string | null;
  listSSHPortForwards(windowId: string, paneId: string): ActiveSSHPortForward[];
  addSSHPortForward(windowId: string, paneId: string, forward: ForwardedPortConfig): Promise<ActiveSSHPortForward>;
  removeSSHPortForward(windowId: string, paneId: string, forwardId: string): Promise<void>;
  listSSHSftpDirectory(windowId: string, paneId: string, path?: string): Promise<SSHSftpDirectoryListing>;
  getSSHSessionMetrics(windowId: string, paneId: string, path?: string): Promise<SSHSessionMetrics>;
  downloadSSHSftpFile(windowId: string, paneId: string, remotePath: string, localPath: string): Promise<void>;
  uploadSSHSftpFiles(windowId: string, paneId: string, remotePath: string, localPaths: string[]): Promise<number>;
  uploadSSHSftpDirectory(windowId: string, paneId: string, remotePath: string, localDirectoryPath: string): Promise<number>;
  downloadSSHSftpDirectory(windowId: string, paneId: string, remotePath: string, localPath: string): Promise<void>;
  createSSHSftpDirectory(windowId: string, paneId: string, parentPath: string, name: string): Promise<string>;
  deleteSSHSftpEntry(windowId: string, paneId: string, remotePath: string): Promise<void>;
  /** 通过已有 SSH 会话执行非交互式命令，返回 stdout */
  execSSHCommand(windowId: string, paneId: string, command: string): Promise<string>;
  execSSHCommandDetailedStreaming(
    windowId: string,
    paneId: string,
    command: string,
    callbacks?: SSHExecCommandCallbacks,
  ): Promise<SSHExecCommandHandle>;
  listProcesses(): ProcessInfo[];
  getPaneStatus(windowId: string, paneId: string): Promise<import('../../renderer/types/window').WindowStatus>;
  subscribeStatusChange(callback: (pid: number, status: import('../../renderer/types/window').WindowStatus) => void): void;
  destroy(): Promise<void>;
}
