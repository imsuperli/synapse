/**
 * Lightweight Chat IPC handlers.
 *
 * Full chat-pane conversations use the structured agent runtime
 * (`agent-send`). This file only keeps standalone text completion for
 * terminal selection helpers and Mini Ask.
 */

import { ipcMain } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { HandlerContext } from './HandlerContext';
import { successResponse, errorResponse } from './HandlerResponse';
import { ChatService } from '../services/chat/ChatService';
import {
  chatDebugError,
  getChatDebugLogFilePath,
  previewText,
} from '../utils/chatDebugLog';
import type {
  ChatCompleteTextRequest,
  ChatMessage,
  ChatSendRequest,
  LLMProviderConfig,
} from '../../shared/types/chat';

let chatService: ChatService | null = null;

function getChatService(): ChatService {
  if (!chatService) {
    chatService = new ChatService();
  }
  return chatService;
}

async function resolveProvider(ctx: HandlerContext, providerId: string): Promise<LLMProviderConfig | null> {
  const workspace = ctx.getCurrentWorkspace?.();
  const providers = workspace?.settings?.chat?.providers ?? [];
  const provider = providers.find((item) => item.id === providerId) ?? null;

  if (!provider) {
    return null;
  }

  const vaultApiKey = await ctx.chatProviderVaultService?.getApiKey(provider.id);
  return {
    ...provider,
    apiKey: vaultApiKey ?? provider.apiKey,
  };
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
        '你是 Synapse 的通用迷你问答助手，不绑定任何终端、服务器或特定工作流。',
        '你可以回答日常问题、解释概念、协助写作、分析代码片段、给出排查思路或提供操作建议。',
        '用中文优先回答，语气自然直接。问题简单时简短回答，问题复杂时给出清晰步骤。',
        '不要默认把用户问题理解为远程服务器管理问题。',
        '不要要求用户绑定 SSH pane，也不要声称你可以登录服务器、执行命令或查看日志。',
        '如果用户明确询问服务器、命令或日志，只能基于用户提供的信息分析，并说明需要用户提供更多上下文。',
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

function formatChatErrorForRenderer(error: string): string {
  const logFilePath = getChatDebugLogFilePath();
  return error.includes(logFilePath)
    ? error
    : `${error} 调试日志：${logFilePath}`;
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
        systemPromptMode: 'replace',
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
}
