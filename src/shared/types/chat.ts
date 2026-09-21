import type { AgentTaskSnapshot } from './agent';
import type {
  AggregatedSessionEntry,
  AggregatedSessionRestoreKind,
  TaskActivityEvent,
  TaskArtifactRecord,
  TaskPlanItem,
} from './task';

/**
 * Chat 功能相关类型定义
 * 支持 Anthropic Claude API、OpenAI-Compatible Chat Completions 与 Responses 协议
 */

// ─── LLM Provider ────────────────────────────────────────────────────────────

export type LLMProviderType = 'anthropic' | 'openai-compatible';
export type LLMProviderWireApi = 'chat-completions' | 'responses';

export interface LLMProviderConfig {
  id: string;
  type: LLMProviderType;
  name: string;
  /** OpenAI-compatible 协议的 base URL，Anthropic 可留空使用默认值 */
  baseUrl?: string;
  /** OpenAI-compatible provider 使用的协议类型，默认 chat-completions */
  wireApi?: LLMProviderWireApi;
  apiKey: string;
  /** 该 provider 支持的模型列表 */
  models: string[];
  defaultModel: string;
  /** 可选：该 provider/model 使用的上下文窗口 token 数，用于 agent 自动压缩阈值 */
  contextWindowTokens?: number;
}

export interface ChatSettings {
  providers: LLMProviderConfig[];
  /** 当前选中的 provider id */
  activeProviderId?: string;
  /** 全局默认 system prompt */
  defaultSystemPrompt?: string;
  /** 工作区级附加指令，会在默认 system prompt 之后拼接 */
  workspaceInstructions?: string;
  /** 固定纳入对话上下文的工作区文件 */
  contextFilePaths?: string[];
  /** 是否启用命令安全检查，默认 true */
  enableCommandSecurity?: boolean;
}

export interface ChatProviderValidationRequest {
  type?: LLMProviderType;
  baseUrl?: string;
  apiKey: string;
  model?: string;
}

export interface ChatProviderValidationResult {
  resolvedType: LLMProviderType;
  resolvedWireApi?: LLMProviderWireApi;
  normalizedBaseUrl?: string;
  model?: string;
  detectedModels: string[];
  modelListSupported: boolean;
  modelListError?: string;
}

// ─── Tool 定义 ────────────────────────────────────────────────────────────────

export type ToolName =
  | 'execute_command'
  | 'read_file'
  | 'glob_search'
  | 'grep_search'
  | 'ask_followup_question'
  | 'attempt_completion';

export type ToolCallStatus =
  | 'pending'       // 等待安全检查
  | 'approved'      // 用户已批准
  | 'rejected'      // 用户已拒绝
  | 'executing'     // 执行中
  | 'completed'     // 执行完成
  | 'error'         // 执行出错
  | 'blocked';      // 被安全策略阻止

export interface ToolCall {
  id: string;
  name: ToolName;
  params: Record<string, unknown>;
  status: ToolCallStatus;
  /** 执行结果（completed/error 时有值）*/
  result?: string;
  /** 安全检查失败或执行错误的原因 */
  reason?: string;
}

export interface ToolResult {
  toolCallId: string;
  content: string;
  isError?: boolean;
}

// ─── Chat 消息 ────────────────────────────────────────────────────────────────

export type ChatRole = 'user' | 'assistant' | 'system';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  timestamp: string;
  /** 生成该消息的模型（assistant 消息专用）*/
  model?: string;
  /** AI 调用的工具列表（assistant 消息专用）*/
  toolCalls?: ToolCall[];
  /** 工具执行结果（tool_result 消息专用）*/
  toolResult?: ToolResult;
}

// ─── Pane 状态 ────────────────────────────────────────────────────────────────

export interface ChatPaneState {
  messages: ChatMessage[];
  /** 当前绑定的历史会话 id */
  conversationId?: string;
  /** 当前选中的模型 */
  activeModel?: string;
  /** 当前选中的 provider id */
  activeProviderId?: string;
  /** 是否正在流式输出 */
  isStreaming?: boolean;
  /** 关联的终端 pane id，用于获取 SSH 上下文 */
  linkedPaneId?: string;
  /** 最近解析的上下文片段 */
  contextFragments?: ChatContextFragment[];
  /** 手动保存的恢复点 */
  checkpoints?: Array<{
    id: string;
    title: string;
    createdAt: string;
    messages: ChatMessage[];
    agent?: AgentTaskSnapshot;
    composerValue?: string;
    linkedPaneId?: string;
  }>;
  /** 新 agent 子系统快照 */
  agent?: AgentTaskSnapshot;
  /** 统一任务活动流 */
  activity?: TaskActivityEvent[];
  /** 当前解析出的计划 */
  plan?: {
    items: TaskPlanItem[];
    updatedAt?: string;
    source?: string;
  };
  /** 最近访问的聚合会话 */
  aggregatedSessions?: AggregatedSessionEntry[];
  /** 该对话关联的产物摘要 */
  artifacts?: TaskArtifactRecord[];
}

// ─── SSH 上下文 ───────────────────────────────────────────────────────────────

export interface ChatSshContext {
  /** 远程主机地址 */
  host: string;
  /** 登录用户名 */
  user: string;
  /** 当前工作目录 */
  cwd?: string;
  /** 关联的窗口 id */
  windowId: string;
  /** 关联的 pane id */
  paneId: string;
}

// ─── IPC 消息 ─────────────────────────────────────────────────────────────────

/** Renderer → Main：发送消息 */
export interface ChatSendRequest {
  paneId: string;
  windowId: string;
  /** 完整对话历史（不含正在生成的 assistant 消息） */
  messages: ChatMessage[];
  providerId: string;
  model: string;
  systemPrompt?: string;
  /** 默认追加到内置系统提示词；replace 用于轻量通用问答等无需 Chat Pane 默认角色的入口 */
  systemPromptMode?: 'append' | 'replace';
  /** 是否允许工具调用 */
  enableTools?: boolean;
  /** SSH 上下文（有关联终端时提供）*/
  sshContext?: ChatSshContext;
  /** 额外上下文片段（如 @file 扩展结果） */
  contextFragments?: ChatContextFragment[];
  /** 主进程预采集的真实环境信息，供系统提示词使用 */
  environmentDetails?: string;
}

export interface ChatContextFragment {
  type: 'file';
  label: string;
  path: string;
  content: string;
}

export type ChatCompletionPurpose =
  | 'terminal-selection-translate'
  | 'terminal-selection-explain'
  | 'mini-ask';

export interface ChatCompleteTextRequest {
  purpose: ChatCompletionPurpose;
  prompt: string;
  messages?: ChatMessage[];
  systemPrompt?: string;
  providerId?: string;
  model?: string;
}

export interface ChatCompleteTextResult {
  content: string;
  providerId: string;
  model: string;
}

export interface RestoreAggregatedSessionRequest {
  entryId: string;
}

export interface RestoreAggregatedSessionResult {
  conversationId: string;
  title: string;
  restoreKind: AggregatedSessionRestoreKind;
  messages: ChatMessage[];
  metadata?: Record<string, unknown>;
}
