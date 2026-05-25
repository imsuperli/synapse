import { ProjectConfig } from './project-config';
import type { SSHAuthType, SSHRoutingMode } from './ssh';
import type { ChatPaneState } from './chat';
import type { CodePaneRunTargetCustomization } from './electron-api';

/**
 * 窗口状态枚举
 * 定义窗口在生命周期中的各种状态
 */
export enum WindowStatus {
  Running = 'running',           // 运行中
  WaitingForInput = 'waiting',   // 等待输入
  Completed = 'completed',       // 已完成
  Error = 'error',               // 出错
  Restoring = 'restoring',       // 恢复中（启动时）
  Paused = 'paused'              // 兼容旧数据；新逻辑不再使用
}

export type PaneBackend = 'local' | 'ssh';
export type PaneKind = 'terminal' | 'browser' | 'code' | 'chat';

export interface BrowserPaneState {
  url: string;
}

export interface CodePaneOpenFile {
  path: string;
  pinned?: boolean;
  preview?: boolean;
}

export interface CodePaneBookmark {
  id: string;
  filePath: string;
  lineNumber: number;
  column: number;
  label?: string;
  createdAt: string;
}

export type CodePaneSidebarView = 'files' | 'search' | 'scm' | 'problems';

export interface CodePaneSidebarState {
  visible: boolean;
  activeView: CodePaneSidebarView;
  width: number;
  lastExpandedWidth?: number;
}

export interface CodePaneBottomPanelState {
  height: number;
}

export interface CodePaneLayoutState {
  sidebar: CodePaneSidebarState;
  bottomPanel?: CodePaneBottomPanelState;
  editorSplit?: {
    visible: boolean;
    size: number;
    secondaryFilePath: string | null;
  };
}

export interface CodePaneDebugState {
  watchExpressions?: string[];
  exceptionBreakpoints?: Array<{
    id: 'all';
    enabled: boolean;
  }>;
}

export interface CodePaneSavePipelineState {
  formatOnSave?: boolean;
  organizeImportsOnSave?: boolean;
  lintOnSave?: boolean;
}

export type CodePaneSaveQualityStepId = 'format' | 'organize-imports' | 'lint' | 'write';
export type CodePaneSaveQualityStepStatus = 'running' | 'passed' | 'skipped' | 'warning' | 'error';

export interface CodePaneSaveQualityStep {
  id: CodePaneSaveQualityStepId;
  status: CodePaneSaveQualityStepStatus;
  message?: string;
  issueCount?: number;
}

export interface CodePaneSaveQualityState {
  status: 'idle' | 'running' | 'passed' | 'warning' | 'error';
  message?: string;
  updatedAt?: string;
  steps?: CodePaneSaveQualityStep[];
}

export interface CodePaneState {
  rootPath: string;
  openFiles: CodePaneOpenFile[];
  activeFilePath: string | null;
  selectedPath?: string | null;
  expandedPaths?: string[];
  runConfigurations?: Record<string, CodePaneRunTargetCustomization>;
  bookmarks?: CodePaneBookmark[];
  breakpoints?: Array<{
    filePath: string;
    lineNumber: number;
    condition?: string;
    logMessage?: string;
    enabled?: boolean;
  }>;
  viewMode?: 'editor' | 'diff';
  diffTargetPath?: string | null;
  layout?: CodePaneLayoutState;
  debug?: CodePaneDebugState;
  savePipeline?: CodePaneSavePipelineState;
  qualityGate?: CodePaneSaveQualityState;
}

export interface PaneCapabilities {
  canOpenLocalFolder: boolean;
  canOpenInIDE: boolean;
  canWatchGitBranch: boolean;
  canReconnect: boolean;
  canOpenSFTP: boolean;
  canManagePortForwards: boolean;
  canCloneSession: boolean;
}

export interface SshPaneBinding {
  profileId: string;
  host?: string;
  port?: number;
  user?: string;
  authType?: SSHAuthType;
  remoteCwd?: string;
  routingMode?: SSHRoutingMode;
  jumpHostProfileId?: string;
  proxyCommand?: string;
  reuseSession?: boolean;
}

export type WindowKind = 'local' | 'ssh' | 'mixed';
export type WindowOwnerType = 'standalone' | 'canvas-owned';

/**
 * 窗格接口
 * 表示一个终端窗格的状态（拆分后的单个终端）
 */
export interface Pane {
  id: string;                    // UUID
  cwd: string;                   // 工作目录路径
  command: string;               // 启动的 shell 程序（如 "pwsh.exe"）
  status: WindowStatus;          // 当前状态
  pid: number | null;            // 进程 PID
  kind?: PaneKind;               // 窗格类型，缺失时视为 terminal
  backend?: PaneBackend;         // 会话后端类型，缺失时视为 local
  sessionId?: string;            // 统一会话标识，逐步替代仅依赖 pid 的索引
  capabilities?: PaneCapabilities; // pane 能力描述，用于 UI/主进程按能力分流
  ssh?: SshPaneBinding;          // SSH pane 绑定信息
  browser?: BrowserPaneState;    // 浏览器 pane 元数据
  code?: CodePaneState;          // Monaco code pane 元数据
  chat?: ChatPaneState;          // Chat pane 元数据
  lastOutput?: string;           // 最新输出摘要（前 100 字符）

  // tmux 兼容层扩展字段（用于 Claude Code Agent Teams）
  /** Pane 标题（通过 tmux select-pane -T 设置） */
  title?: string;

  /** 边框颜色（通过 tmux select-pane -P 或 set-option 设置） */
  borderColor?: string;

  /** 激活时的边框颜色（通过 tmux set-option pane-active-border-style 设置） */
  activeBorderColor?: string;

  /** 团队名称（Claude Agent Teams） */
  teamName?: string;

  /** Agent ID（唯一标识符） */
  agentId?: string;

  /** Agent 名称（显示名称） */
  agentName?: string;

  /** Agent 颜色（用于 UI 标识） */
  agentColor?: string;

  /** Teammate 模式：tmux（真实 tmux）、in-process（进程内模拟）、auto（自动检测） */
  teammateMode?: 'tmux' | 'in-process' | 'auto';

  /** tmux 管理的 pane 子树作用域（运行态） */
  tmuxScopeId?: string;
}

/**
 * 布局节点 - 窗格节点（叶子节点）
 */
export interface PaneNode {
  type: 'pane';
  id: string;                    // 窗格 ID
  pane: Pane;                    // 窗格数据
}

/**
 * 布局节点 - 拆分节点（分支节点）
 */
export interface SplitNode {
  type: 'split';
  direction: 'horizontal' | 'vertical';  // 拆分方向
  sizes: number[];               // 每个子节点的大小比例（总和为 1）
  children: LayoutNode[];        // 子节点列表
}

/**
 * 布局节点类型（递归）
 */
export type LayoutNode = PaneNode | SplitNode;

/**
 * 窗口接口
 * 表示一个终端窗口的完整状态（可包含多个窗格）
 */
export interface Window {
  id: string;                    // UUID
  name: string;                  // 窗口名称（用户可自定义）
  layout: LayoutNode;            // 布局树（根节点）
  activePaneId: string;          // 当前激活的窗格 ID
  createdAt: string;             // 创建时间（ISO 8601）
  lastActiveAt: string;          // 最后活跃时间
  archived?: boolean;            // 是否已归档
  kind?: WindowKind;             // 窗口类型，可由 pane backend 动态推导
  tags?: string[];               // 资产标签
  favorite?: boolean;            // 是否收藏
  projectConfig?: ProjectConfig; // 项目配置（从 copilot.json 读取）
  gitBranch?: string;            // Git 分支名称（如果是 git 仓库）
  claudeModel?: string;          // Claude 模型名称（运行态）
  claudeModelId?: string;        // Claude 模型 ID（运行态）
  claudeContextPercentage?: number; // Claude 上下文占比（运行态）
  claudeCost?: number;           // Claude 成本统计（运行态）
  ephemeral?: boolean;           // 运行态临时窗口，不参与持久化/恢复
  sshTabOwnerWindowId?: string;  // 兼容旧数据；新逻辑不再依赖 owner 绑定
  ownerType?: WindowOwnerType;   // 窗口归属，缺失时视为 standalone
  ownerCanvasWorkspaceId?: string | null; // canvas-owned 窗口所属画布 ID
}

/**
 * @deprecated 使用 Window 接口代替
 * 保留用于向后兼容
 */
export type TerminalWindow = Window;

/**
 * 旧版窗口接口（用于数据迁移）
 */
export interface LegacyWindow {
  id: string;
  name: string;
  workingDirectory: string;
  command: string;
  status: WindowStatus;
  pid: number | null;
  createdAt: string;
  lastActiveAt: string;
  model?: string;
  lastOutput?: string;
  archived?: boolean;
}
