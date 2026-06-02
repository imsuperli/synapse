/**
 * Chat IPC Handlers
 * 负责 LLM 流式调用、工具执行和安全审批流程
 */

import { ipcMain, BrowserWindow } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { HandlerContext } from './HandlerContext';
import { successResponse, errorResponse } from './HandlerResponse';
import { ChatService } from '../services/chat/ChatService';
import { ToolExecutor } from '../services/chat/ToolExecutor';
import { resolveToolApprovalDecision } from '../services/chat/ToolApprovalPolicy';
import {
  chatDebugError,
  chatDebugInfo,
  chatDebugWarn,
  getChatDebugLogFilePath,
  previewText,
} from '../utils/chatDebugLog';
import { resolveLLMProviderWireApi } from '../../shared/utils/chatProvider';
import type {
  ChatMessage,
  ChatCompleteTextRequest,
  ChatSendRequest,
  ChatExecuteToolRequest,
  ChatToolApprovalResponse,
  ToolCall,
  ToolResult,
  LLMProviderConfig,
} from '../../shared/types/chat';

/** 每个 paneId 的流取消控制器 */
const activeStreams = new Map<string, AbortController>();

/** 等待工具审批的 resolver，key = paneId:toolCallId */
const pendingApprovals = new Map<string, (approved: boolean) => void>();

let chatService: ChatService | null = null;

function getChatService(): ChatService {
  if (!chatService) {
    chatService = new ChatService();
  }
  return chatService;
}

function getToolExecutor(ctx: HandlerContext): ToolExecutor | null {
  if (!ctx.processManager) {
    return null;
  }
  return new ToolExecutor(ctx.processManager);
}

const MAX_TOOL_LOOP_ROUNDS = 4;
const CHAT_ENVIRONMENT_DETAILS_MAX_CHARS = 4000;
const CHAT_ENVIRONMENT_PROBE_COMMAND = [
  'printf "[host]\\n"; hostname 2>/dev/null || true',
  'printf "\\n[user]\\n"; id -un 2>/dev/null || whoami 2>/dev/null || true',
  'printf "\\n[cwd]\\n"; pwd 2>/dev/null || true',
  'printf "\\n[shell]\\n"; printf "%s\\n" "${SHELL:-unknown}"',
  'printf "\\n[kernel]\\n"; uname -a 2>/dev/null || true',
  'printf "\\n[os-release]\\n"; if [ -r /etc/os-release ]; then cat /etc/os-release; else echo "unavailable"; fi',
].join('; ');

/** 从 workspace settings 中查找 provider 配置 */
async function resolveProvider(ctx: HandlerContext, providerId: string): Promise<LLMProviderConfig | null> {
  const workspace = ctx.getCurrentWorkspace?.();
  const providers = workspace?.settings?.chat?.providers ?? [];
  const provider = providers.find((p) => p.id === providerId) ?? null;

  if (!provider) {
    return null;
  }

  const vaultApiKey = await ctx.chatProviderVaultService?.getApiKey(provider.id);
  return {
    ...provider,
    apiKey: vaultApiKey ?? provider.apiKey,
  };
}

/** 获取当前 BrowserWindow */
function getWindow(ctx: HandlerContext): BrowserWindow | null {
  return ctx.getMainWindow?.() ?? ctx.mainWindow ?? null;
}

function resolveDefaultProviderId(ctx: HandlerContext): string | null {
  const providers = ctx.getCurrentWorkspace?.()?.settings?.chat?.providers ?? [];
  const activeProviderId = ctx.getCurrentWorkspace?.()?.settings?.chat?.activeProviderId;
  const activeProvider = providers.find((provider) => provider.id === activeProviderId);
  return activeProvider?.id ?? providers[0]?.id ?? null;
}

function createCompleteTextSystemPrompt(request: ChatCompleteTextRequest): string {
  const customPrompt = request.systemPrompt?.trim();
  if (customPrompt) {
    return customPrompt;
  }

  switch (request.purpose) {
    case 'terminal-selection-translate':
      return [
        '你是一个准确、简洁的划词翻译助手。',
        '如果输入不是中文，输出中文，包含音标或读音、词性/短语类型、中文释义和必要例句。',
        '如果输入是中文，输出中文，包含拼音、英文翻译和必要说明。',
        '不要输出 Markdown 表格，不要加入与输入无关的内容。',
      ].join('\n');
    case 'terminal-selection-explain':
      return [
        '你是一个中文解释助手。',
        '用中文解释用户划选内容的含义，说明它在终端、命令、代码或普通语境下可能代表什么。',
        '回答要直接、准确、简洁；不确定时明确说明可能性。',
      ].join('\n');
    case 'mini-ask':
      return [
        '你是 Synapse 的迷你问答助手。',
        '用中文优先回答。保持简洁、可执行，必要时给出步骤或命令。',
        '不要声称你能看到用户未提供的屏幕内容。',
      ].join('\n');
    default:
      return '你是一个中文助手，回答要准确、简洁。';
  }
}

function normalizeCompleteTextRequest(request: unknown): ChatCompleteTextRequest {
  const candidate = request && typeof request === 'object'
    ? request as Partial<ChatCompleteTextRequest>
    : {};
  const prompt = typeof candidate.prompt === 'string' ? candidate.prompt.trim() : '';
  const systemPrompt = typeof candidate.systemPrompt === 'string' ? candidate.systemPrompt : undefined;
  const providerId = typeof candidate.providerId === 'string' ? candidate.providerId.trim() : undefined;
  const model = typeof candidate.model === 'string' ? candidate.model.trim() : undefined;
  const purpose = candidate.purpose === 'terminal-selection-translate'
    || candidate.purpose === 'terminal-selection-explain'
    || candidate.purpose === 'mini-ask'
    ? candidate.purpose
    : 'mini-ask';

  return {
    ...candidate,
    purpose,
    prompt,
    systemPrompt,
    providerId: providerId || undefined,
    model: model || undefined,
    messages: Array.isArray(candidate.messages)
      ? candidate.messages.filter((message): message is ChatMessage => (
          Boolean(message)
          && typeof message === 'object'
          && (
            (message as { role?: unknown }).role === 'user'
            || (message as { role?: unknown }).role === 'assistant'
            || (message as { role?: unknown }).role === 'system'
          )
          && typeof (message as { content?: unknown }).content === 'string'
        ))
      : undefined,
  };
}

function getApprovalKey(paneId: string, toolCallId: string): string {
  return `${paneId}:${toolCallId}`;
}

function isCommandSecurityEnabled(ctx: HandlerContext): boolean {
  return ctx.getCurrentWorkspace?.()?.settings?.chat?.enableCommandSecurity ?? true;
}

function summarizeProvider(provider: LLMProviderConfig): Record<string, unknown> {
  return {
    id: provider.id,
    type: provider.type,
    name: provider.name,
    baseUrl: provider.baseUrl ?? null,
    wireApi: resolveLLMProviderWireApi(provider),
    hasApiKey: provider.apiKey.trim().length > 0,
    defaultModel: provider.defaultModel,
  };
}

function summarizeRequest(request: Pick<ChatSendRequest, 'paneId' | 'windowId' | 'providerId' | 'model' | 'messages' | 'enableTools' | 'sshContext'>): Record<string, unknown> {
  const lastMessage = request.messages.at(-1);

  return {
    paneId: request.paneId,
    windowId: request.windowId,
    providerId: request.providerId,
    model: request.model,
    enableTools: request.enableTools === true,
    messageCount: request.messages.length,
    lastMessage: lastMessage
      ? {
          role: lastMessage.role,
          hasToolCalls: Boolean(lastMessage.toolCalls?.length),
          hasToolResult: Boolean(lastMessage.toolResult),
          contentPreview: previewText(lastMessage.content, 240),
        }
      : null,
    sshContext: request.sshContext
      ? {
          host: request.sshContext.host,
          user: request.sshContext.user,
          cwd: request.sshContext.cwd ?? null,
          windowId: request.sshContext.windowId,
          paneId: request.sshContext.paneId,
        }
      : null,
  };
}

function summarizeToolCall(toolCall: ToolCall): Record<string, unknown> {
  return {
    id: toolCall.id,
    name: toolCall.name,
    status: toolCall.status,
    params: toolCall.params,
  };
}

function formatChatErrorForRenderer(error: string): string {
  const logFilePath = getChatDebugLogFilePath();
  return error.includes(logFilePath)
    ? error
    : `${error} 调试日志：${logFilePath}`;
}

function truncateEnvironmentDetails(content: string): string {
  const trimmed = content.trim();
  if (trimmed.length <= CHAT_ENVIRONMENT_DETAILS_MAX_CHARS) {
    return trimmed;
  }

  return `${trimmed.slice(0, CHAT_ENVIRONMENT_DETAILS_MAX_CHARS)}\n\n[environment details truncated]`;
}

async function collectEnvironmentDetails(
  request: ChatSendRequest,
  toolExecutor: ToolExecutor | null,
): Promise<string | undefined> {
  if (!request.sshContext || !toolExecutor) {
    return undefined;
  }

  const probeToolCall: ToolCall = {
    id: `chat-env-probe-${uuidv4()}`,
    name: 'execute_command',
    params: {
      command: CHAT_ENVIRONMENT_PROBE_COMMAND,
      requires_approval: false,
    },
    status: 'pending',
  };

  const result = await toolExecutor.execute(probeToolCall, request.sshContext);
  if (result.isError) {
    return `环境探测失败：${result.content}`;
  }

  return truncateEnvironmentDetails(result.content);
}

export function registerChatHandlers(ctx: HandlerContext) {

  ipcMain.handle('chat-complete-text', async (_event, rawRequest: unknown) => {
    const request = normalizeCompleteTextRequest(rawRequest);
    try {
      if (!request.prompt) {
        return errorResponse(new Error(formatChatErrorForRenderer('消息不能为空')));
      }

      const providerId = request.providerId || resolveDefaultProviderId(ctx);
      if (!providerId) {
        return errorResponse(new Error(formatChatErrorForRenderer('尚未配置 Chat Provider')));
      }

      const provider = await resolveProvider(ctx, providerId);
      if (!provider) {
        return errorResponse(new Error(formatChatErrorForRenderer(`Provider not found: ${providerId}`)));
      }

      const model = request.model || provider.defaultModel || provider.models[0];
      if (!model) {
        return errorResponse(new Error(formatChatErrorForRenderer(`Provider ${provider.name} 未配置可用模型`)));
      }

      const now = new Date().toISOString();
      const messages: ChatMessage[] = [
        ...(request.messages ?? []),
        {
          id: `complete-text-user-${uuidv4()}`,
          role: 'user',
          content: request.prompt,
          timestamp: now,
        },
      ];
      const serviceRequest: ChatSendRequest & { _provider: LLMProviderConfig } = {
        paneId: `complete-text-${request.purpose}`,
        windowId: 'global',
        messages,
        providerId: provider.id,
        model,
        systemPrompt: createCompleteTextSystemPrompt(request),
        enableTools: false,
        _provider: provider,
      };

      let fullContent = '';
      let streamError: string | null = null;
      const abortController = new AbortController();

      await getChatService().streamChat(
        serviceRequest,
        {
          onChunk: (chunk) => {
            fullContent += chunk;
          },
          onDone: (content) => {
            fullContent = content;
          },
          onError: (error) => {
            streamError = error;
          },
        },
        abortController.signal,
      );

      if (streamError) {
        return errorResponse(new Error(formatChatErrorForRenderer(streamError)));
      }

      return successResponse({
        content: fullContent.trim(),
        providerId: provider.id,
        model,
      });
    } catch (error) {
      chatDebugError('chat-complete-text', 'chat-complete-text handler failed', {
        purpose: request.purpose,
        promptPreview: previewText(request.prompt, 240),
        error,
      });
      return errorResponse(new Error(formatChatErrorForRenderer(error instanceof Error ? error.message : String(error))));
    }
  });

  /**
   * chat-send: 启动 LLM 流式调用
   * 返回 { messageId } 用于后续 chunk/done/error 事件的关联
   */
  ipcMain.handle('chat-send', async (_event, request: ChatSendRequest) => {
    try {
      const { paneId } = request;
      const messageId = uuidv4();

      chatDebugInfo('chat-send', 'Received chat send request', summarizeRequest(request));

      // 取消已有流
      const existing = activeStreams.get(paneId);
      if (existing) {
        existing.abort();
        activeStreams.delete(paneId);
        chatDebugInfo('chat-send', 'Cancelled existing stream before starting a new one', {
          paneId,
        });
      }

      const provider = await resolveProvider(ctx, request.providerId);
      if (!provider) {
        chatDebugWarn('chat-send', 'Provider not found', {
          paneId,
          providerId: request.providerId,
        });
        return errorResponse(new Error(formatChatErrorForRenderer(`Provider not found: ${request.providerId}`)));
      }

      chatDebugInfo('chat-send', 'Resolved provider for chat request', {
        paneId,
        provider: summarizeProvider(provider),
      });

      // 注入 provider 到 request（ChatService 通过 _provider 读取）
      const enrichedRequest = { ...request, _provider: provider };

      const abortController = new AbortController();
      activeStreams.set(paneId, abortController);

      const win = getWindow(ctx);
      const toolExecutor = getToolExecutor(ctx);
      const environmentDetails = await collectEnvironmentDetails(request, toolExecutor);

      // 异步执行流，立即返回 messageId
      runChatStream({ ...enrichedRequest, environmentDetails }, messageId, abortController, win, toolExecutor, ctx);

      return successResponse({ messageId });
    } catch (error) {
      chatDebugError('chat-send', 'chat-send handler failed', {
        request: summarizeRequest(request),
        error,
      });
      return errorResponse(new Error(formatChatErrorForRenderer(error instanceof Error ? error.message : String(error))));
    }
  });

  /**
   * chat-cancel: 取消正在进行的流
   */
  ipcMain.handle('chat-cancel', async (_event, { paneId }: { paneId: string }) => {
    try {
      const controller = activeStreams.get(paneId);
      if (controller) {
        controller.abort();
        activeStreams.delete(paneId);
        chatDebugInfo('chat-cancel', 'Cancelled active chat stream', { paneId });
      }
      return successResponse(undefined);
    } catch (error) {
      chatDebugError('chat-cancel', 'chat-cancel handler failed', {
        paneId,
        error,
      });
      return errorResponse(new Error(formatChatErrorForRenderer(error instanceof Error ? error.message : String(error))));
    }
  });

  /**
   * chat-execute-tool: 直接执行工具（用于 renderer 主动触发）
   */
  ipcMain.handle('chat-execute-tool', async (_event, request: ChatExecuteToolRequest) => {
    try {
      chatDebugInfo('chat-execute-tool', 'Received direct tool execution request', {
        paneId: request.paneId,
        windowId: request.windowId,
        toolCall: summarizeToolCall(request.toolCall),
        sshContext: request.sshContext
          ? {
              host: request.sshContext.host,
              user: request.sshContext.user,
              cwd: request.sshContext.cwd ?? null,
              windowId: request.sshContext.windowId,
              paneId: request.sshContext.paneId,
            }
          : null,
      });

      const toolExecutor = getToolExecutor(ctx);
      if (!toolExecutor) {
        return errorResponse(new Error(formatChatErrorForRenderer('ProcessManager unavailable')));
      }

      if (!request.sshContext) {
        return errorResponse(new Error(formatChatErrorForRenderer('SSH context required for tool execution')));
      }

      const result = await toolExecutor.execute(request.toolCall, request.sshContext);
      return successResponse(result);
    } catch (error) {
      chatDebugError('chat-execute-tool', 'chat-execute-tool handler failed', {
        paneId: request.paneId,
        toolCall: summarizeToolCall(request.toolCall),
        error,
      });
      return errorResponse(new Error(formatChatErrorForRenderer(error instanceof Error ? error.message : String(error))));
    }
  });

  /**
   * chat-respond-tool-approval: 用户审批危险命令的响应
   */
  ipcMain.on('chat-respond-tool-approval', (_event, response: ChatToolApprovalResponse) => {
    chatDebugInfo('chat-respond-tool-approval', 'Received tool approval response', response);
    const approvalKey = getApprovalKey(response.paneId, response.toolCallId);
    const resolver = pendingApprovals.get(approvalKey);
    if (resolver) {
      pendingApprovals.delete(approvalKey);
      resolver(response.approved);
    }
  });
}

/**
 * 异步运行 LLM 流，处理工具调用循环
 */
async function runChatStream(
  request: ChatSendRequest & { _provider: LLMProviderConfig },
  messageId: string,
  abortController: AbortController,
  win: BrowserWindow | null,
  toolExecutor: ToolExecutor | null,
  ctx: HandlerContext,
): Promise<void> {
  const { paneId } = request;
  const service = getChatService();
  const commandSecurityEnabled = isCommandSecurityEnabled(ctx);

  let roundMessageId = messageId;
  const conversationMessages = [...request.messages];

  for (let round = 0; round < MAX_TOOL_LOOP_ROUNDS && !abortController.signal.aborted; round += 1) {
    chatDebugInfo('runChatStream', 'Starting stream round', {
      paneId,
      messageId: roundMessageId,
      round: round + 1,
      provider: summarizeProvider(request._provider),
      model: request.model,
      messageCount: conversationMessages.length,
    });

    let toolCalls: ToolCall[] | undefined;
    let fullContent = '';
    let streamFailed = false;

    await service.streamChat(
      {
        ...request,
        messages: conversationMessages,
      },
      {
        onChunk: (chunk) => {
          win?.webContents.send('chat-stream-chunk', { paneId, chunk, messageId: roundMessageId });
        },
        onDone: (nextFullContent, calls) => {
          fullContent = nextFullContent;
          toolCalls = calls;
          chatDebugInfo('runChatStream', 'Stream round completed', {
            paneId,
            messageId: roundMessageId,
            round: round + 1,
            fullContentLength: nextFullContent.length,
            fullContentPreview: previewText(nextFullContent, 240),
            toolCalls: calls?.map((toolCall) => summarizeToolCall(toolCall)) ?? [],
          });
          win?.webContents.send('chat-stream-done', {
            paneId,
            messageId: roundMessageId,
            fullContent: nextFullContent,
            toolCalls: calls,
            isFinal: !calls?.length,
          });
        },
        onError: (error) => {
          streamFailed = true;
          const frontendError = formatChatErrorForRenderer(error);
          chatDebugError('runChatStream', 'Stream round failed', {
            paneId,
            messageId: roundMessageId,
            round: round + 1,
            error,
            frontendError,
          });
          win?.webContents.send('chat-stream-error', { paneId, error: frontendError });
          activeStreams.delete(paneId);
        },
      },
      abortController.signal,
    );

    if (streamFailed || abortController.signal.aborted) {
      activeStreams.delete(paneId);
      return;
    }

    conversationMessages.push({
      id: roundMessageId,
      role: 'assistant',
      content: fullContent,
      timestamp: new Date().toISOString(),
      toolCalls,
    });

    if (!toolCalls?.length) {
      chatDebugInfo('runChatStream', 'Conversation completed without further tool calls', {
        paneId,
        messageId: roundMessageId,
        round: round + 1,
      });
      activeStreams.delete(paneId);
      return;
    }

    const toolResultMessages = await executeToolCalls(
      {
        paneId,
        toolCalls,
        request,
        win,
        toolExecutor,
        commandSecurityEnabled,
        abortSignal: abortController.signal,
      },
    );

    conversationMessages.push(...toolResultMessages);
    roundMessageId = uuidv4();
  }

  if (!abortController.signal.aborted) {
    chatDebugWarn('runChatStream', 'Exceeded maximum tool loop rounds', {
      paneId,
      maxRounds: MAX_TOOL_LOOP_ROUNDS,
    });
    win?.webContents.send('chat-stream-error', {
      paneId,
      error: formatChatErrorForRenderer('工具调用轮数超过限制，已停止继续执行'),
    });
  }

  activeStreams.delete(paneId);
}

async function executeToolCalls({
  paneId,
  toolCalls,
  request,
  win,
  toolExecutor,
  commandSecurityEnabled,
  abortSignal,
}: {
  paneId: string;
  toolCalls: ToolCall[];
  request: ChatSendRequest & { _provider: LLMProviderConfig };
  win: BrowserWindow | null;
  toolExecutor: ToolExecutor | null;
  commandSecurityEnabled: boolean;
  abortSignal: AbortSignal;
}): Promise<ChatMessage[]> {
  const toolResultMessages: ChatMessage[] = [];

  for (const toolCall of toolCalls) {
    if (abortSignal.aborted) {
      break;
    }

    const result = await executeToolCall({
      paneId,
      toolCall,
      request,
      win,
      toolExecutor,
      commandSecurityEnabled,
      abortSignal,
    });

    toolResultMessages.push({
      id: `tool-result-${toolCall.id}`,
      role: 'user',
      content: '',
      timestamp: new Date().toISOString(),
      toolResult: {
        toolCallId: result.toolCallId,
        content: result.content,
        isError: result.isError,
      },
    });
  }

  return toolResultMessages;
}

async function executeToolCall({
  paneId,
  toolCall,
  request,
  win,
  toolExecutor,
  commandSecurityEnabled,
  abortSignal,
}: {
  paneId: string;
  toolCall: ToolCall;
  request: ChatSendRequest;
  win: BrowserWindow | null;
  toolExecutor: ToolExecutor | null;
  commandSecurityEnabled: boolean;
  abortSignal: AbortSignal;
}): Promise<ToolResult> {
  chatDebugInfo('executeToolCall', 'Preparing tool call execution', {
    paneId,
    toolCall: summarizeToolCall(toolCall),
    hasSshContext: Boolean(request.sshContext),
  });

  if (toolCall.name === 'execute_command') {
    const approvalDecision = resolveToolApprovalDecision(toolCall, {
      commandSecurityEnabled,
    });

    chatDebugInfo('executeToolCall', 'Resolved command approval policy', {
      paneId,
      toolCallId: toolCall.id,
      action: approvalDecision.action,
      reason: approvalDecision.reason ?? null,
    });

    if (approvalDecision.action === 'block') {
      const result: ToolResult = {
        toolCallId: toolCall.id,
        content: `命令被安全策略阻止：${approvalDecision.reason ?? '匹配高危规则'}`,
        isError: true,
      };
      chatDebugWarn('executeToolCall', 'Blocked tool call by security policy', {
        paneId,
        result,
      });
      win?.webContents.send('chat-tool-result', { paneId, ...result });
      return result;
    }

    if (approvalDecision.action === 'ask') {
      const approved = await requestToolApproval(
        win,
        paneId,
        approvalDecision.reason
          ? {
            ...toolCall,
            reason: approvalDecision.reason,
          }
          : toolCall,
        abortSignal,
      );
      if (!approved) {
        const result: ToolResult = {
          toolCallId: toolCall.id,
          content: '用户拒绝了该命令的执行',
          isError: true,
        };
        chatDebugWarn('executeToolCall', 'User rejected tool call execution', {
          paneId,
          result,
        });
        win?.webContents.send('chat-tool-result', { paneId, ...result });
        return result;
      }
    }
  }

  if (!request.sshContext || !toolExecutor) {
    const result: ToolResult = {
      toolCallId: toolCall.id,
      content: '无 SSH 上下文，工具执行需要 SSH 连接',
      isError: true,
    };
    chatDebugWarn('executeToolCall', 'Tool execution failed before dispatch because SSH context is missing', {
      paneId,
      toolCall: summarizeToolCall(toolCall),
      hasToolExecutor: Boolean(toolExecutor),
    });
    win?.webContents.send('chat-tool-result', { paneId, ...result });
    return result;
  }

  const result = await toolExecutor.execute(toolCall, request.sshContext);
  chatDebugInfo('executeToolCall', 'Tool call execution completed', {
    paneId,
    toolCallId: toolCall.id,
    isError: result.isError ?? false,
    contentPreview: previewText(result.content, 240),
  });
  win?.webContents.send('chat-tool-result', { paneId, ...result });
  return result;
}

/**
 * 发送审批请求给 renderer，等待用户响应
 */
function requestToolApproval(
  win: BrowserWindow | null,
  paneId: string,
  toolCall: ToolCall,
  signal?: AbortSignal,
): Promise<boolean> {
  return new Promise((resolve) => {
    const approvalKey = getApprovalKey(paneId, toolCall.id);
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (timeout) {
        clearTimeout(timeout);
      }
      pendingApprovals.delete(approvalKey);
      signal?.removeEventListener('abort', handleAbort);
    };

    const finish = (approved: boolean) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      resolve(approved);
    };

    const handleAbort = () => {
      finish(false);
    };

    pendingApprovals.set(approvalKey, finish);
    chatDebugInfo('requestToolApproval', 'Waiting for renderer approval', {
      paneId,
      toolCall: summarizeToolCall(toolCall),
    });
    win?.webContents.send('chat-tool-approval-request', { paneId, toolCall });

    // 超时 5 分钟自动拒绝
    timeout = setTimeout(() => {
      finish(false);
    }, 5 * 60 * 1000);

    signal?.addEventListener('abort', handleAbort, { once: true });
    if (signal?.aborted) {
      handleAbort();
    }
  });
}
