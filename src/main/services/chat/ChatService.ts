/**
 * ChatService — LLM 流式调用核心服务
 * 支持 Anthropic Claude API、OpenAI-Compatible Chat Completions 与 Responses 协议
 */

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { v4 as uuidv4 } from 'uuid';
import type * as ResponsesAPI from 'openai/resources/responses/responses';
import type {
  ChatMessage,
  ChatSendRequest,
  LLMProviderConfig,
  ToolCall,
  ToolName,
} from '../../../shared/types/chat';
import { resolveLLMProviderWireApi } from '../../../shared/utils/chatProvider';
import {
  chatDebugError,
  chatDebugInfo,
  chatDebugWarn,
  getChatDebugLogFilePath,
  previewText,
} from '../../utils/chatDebugLog';

export interface StreamCallbacks {
  onChunk: (chunk: string) => void;
  onDone: (fullContent: string, toolCalls?: ToolCall[]) => void;
  onError: (error: string) => void;
}

/** 工具定义，在 API 调用时传给 LLM */
const TOOL_DEFINITIONS_ANTHROPIC: Anthropic.Tool[] = [
  {
    name: 'execute_command',
    description: '在当前连接的远程服务器上执行 CLI 命令。适合系统诊断、查看日志、检查资源状态等操作。',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: '要在远程服务器上执行的命令' },
        requires_approval: { type: 'boolean', description: '该命令是否需要用户确认才能执行（删除、重启等危险操作设为 true）' },
        interactive: { type: 'boolean', description: '该命令是否可能需要用户输入、确认、密码或分页器交互' },
      },
      required: ['command', 'requires_approval', 'interactive'],
    },
  },
  {
    name: 'read_file',
    description: '读取远程服务器上的文件内容。',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件的绝对路径' },
        limit: { type: 'number', description: '最多读取的行数（默认 200）' },
        offset: { type: 'number', description: '从第几行开始读（0-based，默认 0）' },
      },
      required: ['path'],
    },
  },
  {
    name: 'glob_search',
    description: '在远程服务器上按 glob 模式搜索文件。',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob 模式，如 **/*.log, src/**/*.ts' },
        path: { type: 'string', description: '搜索起始目录（默认当前目录）' },
        limit: { type: 'number', description: '最多返回结果数（默认 100）' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'grep_search',
    description: '在远程服务器上搜索文件内容，支持正则表达式。',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: '正则表达式模式' },
        path: { type: 'string', description: '搜索目录（默认当前目录）' },
        include: { type: 'string', description: '文件过滤 glob，如 *.log, *.{ts,js}' },
        case_sensitive: { type: 'boolean', description: '是否区分大小写（默认 false）' },
        context_lines: { type: 'number', description: '每个匹配前后显示的上下文行数（默认 0）' },
        max_matches: { type: 'number', description: '最多返回匹配数（默认 100）' },
      },
      required: ['pattern'],
    },
  },
];

/** 将 Anthropic 工具定义转换为 OpenAI function_calling 格式 */
const TOOL_DEFINITIONS_OPENAI: OpenAI.ChatCompletionTool[] = TOOL_DEFINITIONS_ANTHROPIC.map(
  (tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  }),
);

const TOOL_DEFINITIONS_RESPONSES: ResponsesAPI.FunctionTool[] = TOOL_DEFINITIONS_ANTHROPIC.map(
  (tool) => ({
    type: 'function' as const,
    name: tool.name,
    description: tool.description,
    parameters: tool.input_schema,
    strict: false,
  }),
);

type OpenAIFunctionCallLike = {
  name?: string;
  arguments?: string;
};

type OpenAIToolCallLike = {
  index?: number;
  id?: string;
  function?: OpenAIFunctionCallLike;
};

type OpenAIMessageLike = {
  content?: unknown;
  tool_calls?: OpenAIToolCallLike[];
  function_call?: OpenAIFunctionCallLike;
};

type OpenAIChoiceLike = {
  delta?: OpenAIMessageLike;
  message?: OpenAIMessageLike;
  text?: unknown;
  finish_reason?: unknown;
};

type OpenAIToolCallRaw = {
  id: string;
  name: string;
  args: string;
};

function summarizeProvider(provider: LLMProviderConfig): Record<string, unknown> {
  return {
    id: provider.id,
    type: provider.type,
    name: provider.name,
    baseUrl: provider.baseUrl ?? null,
    wireApi: resolveLLMProviderWireApi(provider),
    hasApiKey: provider.apiKey.trim().length > 0,
    models: provider.models,
    defaultModel: provider.defaultModel,
  };
}

function summarizeConversation(messages: ChatMessage[]): Record<string, unknown> {
  const lastMessage = messages.at(-1);

  return {
    count: messages.length,
    roles: messages.map((message) => message.role),
    lastMessage: lastMessage
      ? {
          id: lastMessage.id,
          role: lastMessage.role,
          hasToolCalls: Boolean(lastMessage.toolCalls?.length),
          hasToolResult: Boolean(lastMessage.toolResult),
          contentPreview: previewText(lastMessage.content, 240),
        }
      : null,
  };
}

function summarizeToolCalls(toolCalls: ToolCall[]): Array<Record<string, unknown>> {
  return toolCalls.map((toolCall) => ({
    id: toolCall.id,
    name: toolCall.name,
    status: toolCall.status,
    params: toolCall.params,
  }));
}

function extractOpenAITextParts(content: unknown): string[] {
  if (typeof content === 'string') {
    return content ? [content] : [];
  }

  if (!Array.isArray(content)) {
    return [];
  }

  const textParts: string[] = [];
  for (const part of content) {
    if (typeof part === 'string') {
      if (part) {
        textParts.push(part);
      }
      continue;
    }

    if (!part || typeof part !== 'object') {
      continue;
    }

    const candidate = part as {
      text?: unknown;
      content?: unknown;
    };

    if (typeof candidate.text === 'string' && candidate.text) {
      textParts.push(candidate.text);
      continue;
    }

    if (typeof candidate.content === 'string' && candidate.content) {
      textParts.push(candidate.content);
    }
  }

  return textParts;
}

function appendOpenAIToolCalls(
  payload: OpenAIMessageLike | undefined,
  toolCallsRaw: Map<number, OpenAIToolCallRaw>,
): void {
  if (!payload) {
    return;
  }

  if (Array.isArray(payload.tool_calls)) {
    for (const tc of payload.tool_calls) {
      const idx = tc.index ?? 0;
      if (!toolCallsRaw.has(idx)) {
        toolCallsRaw.set(idx, {
          id: tc.id || uuidv4(),
          name: tc.function?.name || '',
          args: '',
        });
      }

      const existing = toolCallsRaw.get(idx)!;
      if (tc.function?.arguments) {
        existing.args += tc.function.arguments;
      }
      if (tc.function?.name) {
        existing.name = tc.function.name;
      }
      if (tc.id) {
        existing.id = tc.id;
      }
    }
    return;
  }

  if (payload.function_call) {
    if (!toolCallsRaw.has(0)) {
      toolCallsRaw.set(0, {
        id: uuidv4(),
        name: payload.function_call.name || '',
        args: '',
      });
    }

    const existing = toolCallsRaw.get(0)!;
    if (payload.function_call.arguments) {
      existing.args += payload.function_call.arguments;
    }
    if (payload.function_call.name) {
      existing.name = payload.function_call.name;
    }
  }
}

function toResponsesInput(messages: ChatMessage[]): ResponsesAPI.ResponseInput {
  const result: ResponsesAPI.ResponseInput = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      continue;
    }

    if (msg.role === 'user') {
      if (msg.toolResult) {
        result.push({
          type: 'function_call_output',
          call_id: msg.toolResult.toolCallId,
          output: msg.toolResult.content,
        } as ResponsesAPI.ResponseInputItem.FunctionCallOutput);
      } else {
        result.push({
          type: 'message',
          role: 'user',
          content: msg.content,
        } as ResponsesAPI.EasyInputMessage);
      }
      continue;
    }

    if (msg.content) {
      result.push({
        type: 'message',
        role: 'assistant',
        content: msg.content,
      } as ResponsesAPI.EasyInputMessage);
    }

    if (msg.toolCalls?.length) {
      for (const toolCall of msg.toolCalls) {
        result.push({
          type: 'function_call',
          call_id: toolCall.id,
          name: toolCall.name,
          arguments: JSON.stringify(toolCall.params),
        } as ResponsesAPI.ResponseFunctionToolCall);
      }
    }
  }

  return result;
}

function extractResponsesOutputText(response: ResponsesAPI.Response | null | undefined): string {
  if (!response) {
    return '';
  }

  if (response.output_text) {
    return response.output_text;
  }

  const textParts: string[] = [];
  for (const item of response.output) {
    if (item.type !== 'message') {
      continue;
    }

    for (const part of item.content) {
      if (part.type === 'output_text') {
        textParts.push(part.text);
      }
    }
  }

  return textParts.join('');
}

function extractResponsesToolCalls(response: ResponsesAPI.Response | null | undefined): OpenAIToolCallRaw[] {
  if (!response) {
    return [];
  }

  return response.output.flatMap((item) => (
    item.type === 'function_call'
      ? [{
          id: item.call_id || item.id || uuidv4(),
          name: item.name,
          args: item.arguments,
        }]
      : []
  ));
}

function parseToolCallParams(rawArgs: string): Record<string, unknown> {
  if (!rawArgs) {
    return {};
  }

  return JSON.parse(rawArgs);
}

function buildToolCallsFromRaw(
  rawCalls: Iterable<OpenAIToolCallRaw>,
  logScope: string,
  paneId: string,
): ToolCall[] {
  const toolCalls: ToolCall[] = [];

  for (const raw of rawCalls) {
    let params: Record<string, unknown> = {};
    if (raw.args) {
      try {
        params = parseToolCallParams(raw.args);
      } catch (error) {
        params = {};
        chatDebugWarn(logScope, 'Failed to parse tool call arguments', {
          paneId,
          toolCallId: raw.id,
          toolName: raw.name,
          argsPreview: previewText(raw.args, 240),
          error,
        });
      }
    }

    toolCalls.push({
      id: raw.id,
      name: raw.name as ToolName,
      params,
      status: 'pending',
    });
  }

  return toolCalls;
}

/** 构建系统提示词 */
function buildSystemPrompt(request: ChatSendRequest): string {
  const { sshContext, systemPrompt, environmentDetails } = request;
  const customPrompt = systemPrompt?.trim();
  if (customPrompt && request.systemPromptMode === 'replace') {
    return customPrompt;
  }

  const contextSection = sshContext
    ? `
当前对话已绑定到一个可执行的远程 SSH 会话：
- 主机: ${sshContext.host}
- 用户: ${sshContext.user}
${sshContext.cwd ? `- 工作目录: ${sshContext.cwd}` : ''}
`
    : `
当前对话没有绑定可执行的远程 SSH 会话。
`;

  const executionRules = sshContext
    ? `
执行规则（必须严格遵守）：
- 这是一个面向远端服务器排障的对话。只要用户在问远端机器的真实状态、配置、日志、进程、网络、资源、文件或错误原因，就应优先直接调用工具获取事实。
- 不要先输出“我先去查看”“我现在执行命令”之类的空话；如果需要查看，就直接发起工具调用。
- 在工具结果返回前，禁止声称“我已经检查过 / 结果显示 / 当前系统是 / 服务状态为”。
- 如果工具不可用、SSH 会话不可执行或命令失败，要明确说明受阻原因；禁止伪造命令输出、禁止假装已经连接或已经执行。
- 只读诊断命令应将 requires_approval 设为 false；有副作用的变更命令才设为 true。
- 优先先做只读诊断，再给出结论或修复建议。
`
    : `
执行规则（必须严格遵守）：
- 你当前没有远端 SSH 执行上下文。
- 禁止声称你已经登录服务器、读取文件、查看日志、执行命令或验证结果。
- 只能明确说明当前缺少可执行连接，并要求用户将 chat 绑定到 SSH pane 后再继续远端诊断。
`;

  const environmentSection = sshContext
    ? `
真实远端环境探测结果（只读采样）：
${environmentDetails?.trim() || '暂无探测结果；如需事实请继续调用工具。'}
`
    : `
真实远端环境探测结果：
无。当前没有可执行的 SSH 连接。
`;

  const defaultPrompt = `你是一个专业的系统管理员助手，帮助用户管理和排查远程服务器问题。
${contextSection}
${environmentSection}
${executionRules}
你可以使用工具在远程服务器上执行操作。遵循以下安全原则：
- 优先使用只读命令进行诊断（ls、cat、grep、ps、df 等）
- 对于可能影响系统状态的操作，将 requires_approval 设为 true
- 禁止执行 rm -rf /、格式化磁盘、重启系统等破坏性命令
- 不要编造执行过程或执行结果`;

  return customPrompt
    ? `${defaultPrompt}\n\n附加用户指令：\n${customPrompt}`
    : defaultPrompt;
}

/** 将 ChatMessage[] 转换为 Anthropic API 格式 */
function toAnthropicMessages(messages: ChatMessage[]): Anthropic.MessageParam[] {
  const result: Anthropic.MessageParam[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') continue; // system prompt 单独传

    if (msg.role === 'user') {
      if (msg.toolResult) {
        // 工具结果消息
        result.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: msg.toolResult.toolCallId,
              content: msg.toolResult.content,
              is_error: msg.toolResult.isError,
            },
          ],
        });
      } else {
        result.push({ role: 'user', content: msg.content });
      }
    } else if (msg.role === 'assistant') {
      const content: Anthropic.MessageParam['content'] = [];
      if (msg.content) {
        content.push({ type: 'text', text: msg.content } as Anthropic.TextBlockParam);
      }
      if (msg.toolCalls?.length) {
        for (const tc of msg.toolCalls) {
          content.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.name,
            input: tc.params,
          } as Anthropic.ToolUseBlockParam);
        }
      }
      if (content.length > 0) {
        result.push({ role: 'assistant', content });
      }
    }
  }

  return result;
}

/** 将 ChatMessage[] 转换为 OpenAI API 格式 */
function toOpenAIMessages(messages: ChatMessage[], systemPrompt: string): OpenAI.ChatCompletionMessageParam[] {
  const result: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
  ];

  for (const msg of messages) {
    if (msg.role === 'system') continue;

    if (msg.role === 'user') {
      if (msg.toolResult) {
        result.push({
          role: 'tool',
          tool_call_id: msg.toolResult.toolCallId,
          content: msg.toolResult.content,
        });
      } else {
        result.push({ role: 'user', content: msg.content });
      }
    } else if (msg.role === 'assistant') {
      const toolCalls = msg.toolCalls?.map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: {
          name: tc.name,
          arguments: JSON.stringify(tc.params),
        },
      }));
      result.push({
        role: 'assistant',
        content: msg.content || null,
        tool_calls: toolCalls?.length ? toolCalls : undefined,
      });
    }
  }

  return result;
}

export class ChatService {
  async streamChat(
    request: ChatSendRequest,
    callbacks: StreamCallbacks,
    signal?: AbortSignal,
  ): Promise<void> {
    // providers 由 chatHandlers 从 settings 读取后注入到 request
    const provider = (request as any)._provider as LLMProviderConfig;
    if (!provider) {
      chatDebugError('ChatService', 'Missing provider configuration on chat request', {
        paneId: request.paneId,
        windowId: request.windowId,
        providerId: request.providerId,
        model: request.model,
        conversation: summarizeConversation(request.messages),
      });
      callbacks.onError('未找到 LLM Provider 配置');
      return;
    }

    chatDebugInfo('ChatService', 'Starting chat stream', {
      paneId: request.paneId,
      windowId: request.windowId,
      provider: summarizeProvider(provider),
      model: request.model,
      enableTools: request.enableTools === true,
      sshContext: request.sshContext
        ? {
            host: request.sshContext.host,
            user: request.sshContext.user,
            cwd: request.sshContext.cwd ?? null,
            windowId: request.sshContext.windowId,
            paneId: request.sshContext.paneId,
          }
        : null,
      conversation: summarizeConversation(request.messages),
    });

    if (provider.type === 'anthropic') {
      await this.streamAnthropic(request, provider, callbacks, signal);
    } else {
      const wireApi = resolveLLMProviderWireApi(provider);
      chatDebugInfo('ChatService', 'Resolved OpenAI-compatible wire API', {
        paneId: request.paneId,
        providerId: provider.id,
        wireApi,
      });

      if (wireApi === 'responses') {
        await this.streamResponses(request, provider, callbacks, signal);
      } else {
        await this.streamOpenAIChatCompletions(request, provider, callbacks, signal);
      }
    }
  }

  private async streamAnthropic(
    request: ChatSendRequest,
    provider: LLMProviderConfig,
    callbacks: StreamCallbacks,
    signal?: AbortSignal,
  ): Promise<void> {
    const client = new Anthropic({
      apiKey: provider.apiKey,
      baseURL: provider.baseUrl || undefined,
    });

    const systemPrompt = buildSystemPrompt(request);
    const messages = toAnthropicMessages(request.messages);
    const tools = request.enableTools ? TOOL_DEFINITIONS_ANTHROPIC : undefined;

    let fullContent = '';
    const toolCallsAccumulator: Map<string, ToolCall> = new Map();
    let eventCount = 0;
    let textChunkCount = 0;
    let toolUseCount = 0;

    chatDebugInfo('ChatService/Anthropic', 'Creating Anthropic stream', {
      paneId: request.paneId,
      provider: summarizeProvider(provider),
      model: request.model,
      systemPromptPreview: previewText(systemPrompt, 240),
      messageCount: messages.length,
      toolCount: tools?.length ?? 0,
    });

    try {
      const stream = await client.messages.create({
        model: request.model,
        max_tokens: 8096,
        system: systemPrompt,
        messages,
        tools,
        stream: true,
      }, { signal });

      chatDebugInfo('ChatService/Anthropic', 'Anthropic stream established', {
        paneId: request.paneId,
        model: request.model,
      });

      for await (const event of stream) {
        eventCount += 1;

        if (signal?.aborted) break;

        const eventSummary: Record<string, unknown> = {
          paneId: request.paneId,
          eventCount,
          type: event.type,
        };

        if (event.type === 'content_block_delta') {
          eventSummary.blockIndex = event.index;
          eventSummary.deltaType = event.delta.type;

          if (event.delta.type === 'text_delta') {
            const chunk = event.delta.text;
            fullContent += chunk;
            textChunkCount += 1;
            eventSummary.chunkLength = chunk.length;
            eventSummary.chunkPreview = previewText(chunk, 160);
            callbacks.onChunk(chunk);
          } else if (event.delta.type === 'input_json_delta') {
            // 工具调用参数累积，在 message_stop 时处理
            const blockIndex = event.index;
            const existing = toolCallsAccumulator.get(String(blockIndex));
            if (existing) {
              (existing as any)._rawInput = ((existing as any)._rawInput || '') + event.delta.partial_json;
            }
            eventSummary.partialJsonLength = event.delta.partial_json.length;
            eventSummary.partialJsonPreview = previewText(event.delta.partial_json, 160);
          }
        } else if (event.type === 'content_block_start') {
          eventSummary.blockIndex = event.index;
          eventSummary.blockType = event.content_block.type;

          if (event.content_block.type === 'tool_use') {
            const tc: ToolCall & { _rawInput?: string } = {
              id: event.content_block.id,
              name: event.content_block.name as ToolName,
              params: {},
              status: 'pending',
              _rawInput: '',
            };
            toolCallsAccumulator.set(String(event.index), tc);
            toolUseCount += 1;
            eventSummary.toolCallId = tc.id;
            eventSummary.toolName = tc.name;
          }
        }

        chatDebugInfo('ChatService/Anthropic', 'Received stream event', eventSummary);
      }

      // 解析工具调用参数
      const toolCalls: ToolCall[] = [];
      for (const tc of toolCallsAccumulator.values()) {
        try {
          tc.params = JSON.parse((tc as any)._rawInput || '{}');
        } catch (error) {
          tc.params = {};
          chatDebugWarn('ChatService/Anthropic', 'Failed to parse tool input JSON', {
            paneId: request.paneId,
            toolCallId: tc.id,
            toolName: tc.name,
            rawInputPreview: previewText((tc as any)._rawInput || '', 240),
            error,
          });
        }
        delete (tc as any)._rawInput;
        toolCalls.push(tc);
      }

      const emptyResponse = fullContent.trim().length === 0 && toolCalls.length === 0;
      if (emptyResponse) {
        chatDebugWarn('ChatService/Anthropic', 'Stream completed with empty response', {
          paneId: request.paneId,
          model: request.model,
          provider: summarizeProvider(provider),
          eventCount,
          textChunkCount,
          toolUseCount,
        });
        callbacks.onError(`LLM 返回空响应，请检查 Base URL、模型名或兼容接口格式。调试日志：${getChatDebugLogFilePath()}`);
        return;
      }

      chatDebugInfo('ChatService/Anthropic', 'Anthropic stream completed', {
        paneId: request.paneId,
        model: request.model,
        eventCount,
        textChunkCount,
        toolUseCount,
        fullContentLength: fullContent.length,
        fullContentPreview: previewText(fullContent, 240),
        toolCalls: summarizeToolCalls(toolCalls),
        emptyResponse,
      });

      callbacks.onDone(fullContent, toolCalls.length > 0 ? toolCalls : undefined);
    } catch (err) {
      if (signal?.aborted) return;
      const message = err instanceof Error ? err.message : String(err);
      chatDebugError('ChatService/Anthropic', 'Anthropic stream failed', {
        paneId: request.paneId,
        model: request.model,
        provider: summarizeProvider(provider),
        error: err,
      });
      callbacks.onError(message);
    }
  }

  private async streamResponses(
    request: ChatSendRequest,
    provider: LLMProviderConfig,
    callbacks: StreamCallbacks,
    signal?: AbortSignal,
  ): Promise<void> {
    const client = new OpenAI({
      apiKey: provider.apiKey,
      baseURL: provider.baseUrl || undefined,
      timeout: 120000, // 120 秒超时
      maxRetries: 2, // 最多重试 2 次
    });

    const systemPrompt = buildSystemPrompt(request);
    const input = toResponsesInput(request.messages);
    const tools = request.enableTools ? TOOL_DEFINITIONS_RESPONSES : undefined;

    let fullContent = '';
    const toolCallsRaw: Map<number, OpenAIToolCallRaw> = new Map();
    let chunkCount = 0;
    let textPartCount = 0;
    let toolCallCount = 0;
    let completedResponse: ResponsesAPI.Response | null = null;
    let streamEventError: string | null = null;

    chatDebugInfo('ChatService/Responses', 'Creating Responses API stream', {
      paneId: request.paneId,
      provider: summarizeProvider(provider),
      model: request.model,
      systemPromptPreview: previewText(systemPrompt, 240),
      inputCount: input.length,
      toolCount: tools?.length ?? 0,
    });

    try {
      const stream = await client.responses.create({
        model: request.model,
        input,
        instructions: systemPrompt,
        tools,
        stream: true,
      }, { signal: signal as AbortSignal });

      chatDebugInfo('ChatService/Responses', 'Responses API stream established', {
        paneId: request.paneId,
        model: request.model,
      });

      for await (const event of stream) {
        chunkCount += 1;

        if (signal?.aborted) {
          break;
        }

        const eventSummary: Record<string, unknown> = {
          paneId: request.paneId,
          chunkCount,
          type: event.type,
        };

        switch (event.type) {
          case 'response.output_text.delta':
            fullContent += event.delta;
            textPartCount += 1;
            eventSummary.deltaLength = event.delta.length;
            eventSummary.deltaPreview = previewText(event.delta, 160);
            callbacks.onChunk(event.delta);
            break;
          case 'response.output_item.added':
          case 'response.output_item.done':
            eventSummary.outputIndex = event.output_index;
            eventSummary.itemType = event.item.type;

            if (event.item.type === 'function_call') {
              const existing = toolCallsRaw.get(event.output_index);
              if (!existing) {
                toolCallCount += 1;
              }
              toolCallsRaw.set(event.output_index, {
                id: event.item.call_id || event.item.id || uuidv4(),
                name: event.item.name,
                args: event.item.arguments || existing?.args || '',
              });
              eventSummary.toolCallId = event.item.call_id || event.item.id || null;
              eventSummary.toolName = event.item.name;
            }
            break;
          case 'response.function_call_arguments.delta': {
            const existing = toolCallsRaw.get(event.output_index) ?? {
              id: event.item_id || uuidv4(),
              name: '',
              args: '',
            };
            existing.args += event.delta;
            toolCallsRaw.set(event.output_index, existing);
            eventSummary.outputIndex = event.output_index;
            eventSummary.itemId = event.item_id;
            eventSummary.deltaLength = event.delta.length;
            eventSummary.deltaPreview = previewText(event.delta, 160);
            break;
          }
          case 'response.function_call_arguments.done': {
            const existing = toolCallsRaw.get(event.output_index) ?? {
              id: event.item_id || uuidv4(),
              name: event.name,
              args: '',
            };
            existing.id = existing.id || event.item_id || uuidv4();
            existing.name = event.name;
            existing.args = event.arguments;
            toolCallsRaw.set(event.output_index, existing);
            eventSummary.outputIndex = event.output_index;
            eventSummary.itemId = event.item_id;
            eventSummary.toolName = event.name;
            eventSummary.argumentsPreview = previewText(event.arguments, 160);
            break;
          }
          case 'response.completed':
            completedResponse = event.response;
            eventSummary.responseId = event.response.id;
            eventSummary.outputCount = event.response.output.length;
            eventSummary.outputTextPreview = previewText(event.response.output_text || '', 160);
            break;
          case 'response.failed':
            completedResponse = event.response;
            streamEventError = event.response.error?.message || 'Responses API request failed';
            eventSummary.responseId = event.response.id;
            eventSummary.error = streamEventError;
            break;
          case 'error':
            streamEventError = event.message || 'Responses API stream error';
            eventSummary.error = streamEventError;
            eventSummary.code = event.code;
            break;
          default:
            break;
        }

        chatDebugInfo('ChatService/Responses', 'Received stream event', eventSummary);
      }

      if (streamEventError) {
        chatDebugError('ChatService/Responses', 'Responses API stream reported an error event', {
          paneId: request.paneId,
          model: request.model,
          provider: summarizeProvider(provider),
          error: streamEventError,
        });
        callbacks.onError(streamEventError);
        return;
      }

      if (!fullContent) {
        fullContent = extractResponsesOutputText(completedResponse);
      }

      if (toolCallsRaw.size === 0 && completedResponse) {
        for (const [index, rawCall] of extractResponsesToolCalls(completedResponse).entries()) {
          toolCallsRaw.set(index, rawCall);
        }
      }

      const toolCalls = buildToolCallsFromRaw(toolCallsRaw.values(), 'ChatService/Responses', request.paneId);
      const emptyResponse = fullContent.trim().length === 0 && toolCalls.length === 0;
      if (emptyResponse) {
        chatDebugWarn('ChatService/Responses', 'Stream completed with empty response', {
          paneId: request.paneId,
          model: request.model,
          provider: summarizeProvider(provider),
          chunkCount,
          textPartCount,
          toolCallCount,
        });
        callbacks.onError(`LLM 返回空响应，请检查 Base URL、模型名或兼容接口格式。调试日志：${getChatDebugLogFilePath()}`);
        return;
      }

      chatDebugInfo('ChatService/Responses', 'Responses API stream completed', {
        paneId: request.paneId,
        model: request.model,
        chunkCount,
        textPartCount,
        toolCallCount,
        fullContentLength: fullContent.length,
        fullContentPreview: previewText(fullContent, 240),
        toolCalls: summarizeToolCalls(toolCalls),
        emptyResponse,
      });

      callbacks.onDone(fullContent, toolCalls.length > 0 ? toolCalls : undefined);
    } catch (err) {
      if (signal?.aborted) return;
      const message = err instanceof Error ? err.message : String(err);
      chatDebugError('ChatService/Responses', 'Responses API stream failed', {
        paneId: request.paneId,
        model: request.model,
        provider: summarizeProvider(provider),
        error: err,
      });
      callbacks.onError(message);
    }
  }

  private async streamOpenAIChatCompletions(
    request: ChatSendRequest,
    provider: LLMProviderConfig,
    callbacks: StreamCallbacks,
    signal?: AbortSignal,
  ): Promise<void> {
    const client = new OpenAI({
      apiKey: provider.apiKey,
      baseURL: provider.baseUrl || undefined,
      timeout: 120000, // 120 秒超时
      maxRetries: 2, // 最多重试 2 次
    });

    const systemPrompt = buildSystemPrompt(request);
    const messages = toOpenAIMessages(request.messages, systemPrompt);
    const tools = request.enableTools ? TOOL_DEFINITIONS_OPENAI : undefined;

    let fullContent = '';
    // 工具调用累积（按 index）
    const toolCallsRaw: Map<number, { id: string; name: string; args: string }> = new Map();
    let chunkCount = 0;
    let textPartCount = 0;

    chatDebugInfo('ChatService/OpenAIChatCompletions', 'Creating OpenAI-compatible stream', {
      paneId: request.paneId,
      provider: summarizeProvider(provider),
      model: request.model,
      systemPromptPreview: previewText(systemPrompt, 240),
      messageCount: messages.length,
      toolCount: tools?.length ?? 0,
    });

    try {
      const stream = await client.chat.completions.create({
        model: request.model,
        messages,
        tools,
        stream: true,
      }, { signal: signal as AbortSignal });

      chatDebugInfo('ChatService/OpenAIChatCompletions', 'OpenAI-compatible stream established', {
        paneId: request.paneId,
        model: request.model,
      });

      for await (const chunk of stream) {
        chunkCount += 1;

        if (signal?.aborted) break;

        const choice = chunk.choices[0] as OpenAIChoiceLike | undefined;
        if (!choice) {
          chatDebugWarn('ChatService/OpenAIChatCompletions', 'Received stream chunk without choices', {
            paneId: request.paneId,
            chunkCount,
            rawChoiceCount: chunk.choices.length,
          });
          continue;
        }

        const delta = choice.delta;
        const deltaTextParts = extractOpenAITextParts(delta?.content);
        const textParts = deltaTextParts.length > 0
          ? deltaTextParts
          : [
              ...extractOpenAITextParts(choice.message?.content),
              ...(typeof choice.text === 'string' && choice.text ? [choice.text] : []),
            ];

        textPartCount += textParts.length;
        for (const textPart of textParts) {
          fullContent += textPart;
          callbacks.onChunk(textPart);
        }

        appendOpenAIToolCalls(delta, toolCallsRaw);
        if (!delta?.tool_calls && !delta?.function_call) {
          appendOpenAIToolCalls(choice.message, toolCallsRaw);
        }

        chatDebugInfo('ChatService/OpenAIChatCompletions', 'Received stream chunk', {
          paneId: request.paneId,
          chunkCount,
          choiceCount: chunk.choices.length,
          finishReason: choice.finish_reason ?? null,
          deltaKeys: delta ? Object.keys(delta) : [],
          messageKeys: choice.message ? Object.keys(choice.message) : [],
          textPartCount: textParts.length,
          textPreview: textParts.map((textPart) => previewText(textPart, 160)),
          hasToolCallDelta: Boolean(
            delta?.tool_calls
            || delta?.function_call
            || choice.message?.tool_calls
            || choice.message?.function_call
          ),
        });
      }

      // 构建 ToolCall 对象
      const toolCalls = buildToolCallsFromRaw(
        toolCallsRaw.values(),
        'ChatService/OpenAIChatCompletions',
        request.paneId,
      );

      const emptyResponse = fullContent.trim().length === 0 && toolCalls.length === 0;
      if (emptyResponse) {
        chatDebugWarn('ChatService/OpenAIChatCompletions', 'Stream completed with empty response', {
          paneId: request.paneId,
          model: request.model,
          provider: summarizeProvider(provider),
          chunkCount,
          textPartCount,
        });
        callbacks.onError(`LLM 返回空响应，请检查 Base URL、模型名或兼容接口格式。调试日志：${getChatDebugLogFilePath()}`);
        return;
      }

      chatDebugInfo('ChatService/OpenAIChatCompletions', 'OpenAI-compatible stream completed', {
        paneId: request.paneId,
        model: request.model,
        chunkCount,
        textPartCount,
        fullContentLength: fullContent.length,
        fullContentPreview: previewText(fullContent, 240),
        toolCalls: summarizeToolCalls(toolCalls),
        emptyResponse,
      });

      callbacks.onDone(fullContent, toolCalls.length > 0 ? toolCalls : undefined);
    } catch (err) {
      if (signal?.aborted) return;
      const message = err instanceof Error ? err.message : String(err);
      chatDebugError('ChatService/OpenAIChatCompletions', 'OpenAI-compatible stream failed', {
        paneId: request.paneId,
        model: request.model,
        provider: summarizeProvider(provider),
        error: err,
      });
      callbacks.onError(message);
    }
  }
}
