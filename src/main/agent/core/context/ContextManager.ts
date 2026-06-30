import type { ChatMessage } from '../../../../shared/types/chat';

const DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS = 1_000_000;
const DEFAULT_AUTO_COMPACT_RATIO = 0.9;
const DEFAULT_PRESERVE_RECENT_USER_TURNS = 2;
const DEFAULT_SUMMARY_TOKEN_BUDGET = 8_000;
const SUMMARY_MESSAGE_PREFIX = 'CONTEXT CHECKPOINT SUMMARY';
const MIN_MESSAGES_FOR_COMPACTION = 6;

export interface ContextSummaryInput {
  messages: ChatMessage[];
  transcript: string;
  maxSummaryTokens: number;
}

export interface ContextCompactionOptions {
  modelContextWindowTokens?: number;
  autoCompactRatio?: number;
  preserveRecentUserTurns?: number;
  maxSummaryTokens?: number;
  summarizer?: (input: ContextSummaryInput) => Promise<string>;
  now?: () => Date;
  force?: boolean;
}

export interface ContextCompactionResult {
  summary: string;
  originalMessageCount: number;
  compactedMessageCount: number;
  preservedMessageCount: number;
  estimatedTokensBefore: number;
  estimatedTokensAfter: number;
  usedFallback: boolean;
}

function messageBody(message: ChatMessage): string {
  return message.toolResult?.content || message.content;
}

function estimateTextTokens(value: string): number {
  let asciiChars = 0;
  let nonAsciiChars = 0;

  for (const char of value) {
    if (char.charCodeAt(0) <= 0x7f) {
      asciiChars += 1;
    } else {
      nonAsciiChars += 1;
    }
  }

  return Math.ceil(asciiChars / 4) + nonAsciiChars;
}

function estimateMessageTokens(message: ChatMessage): number {
  const toolCallTokens = message.toolCalls?.reduce((sum, toolCall) => (
    sum + estimateTextTokens(`${toolCall.name}\n${JSON.stringify(toolCall.params)}\n${toolCall.result ?? ''}`)
  ), 0) ?? 0;
  return 8 + estimateTextTokens(messageBody(message)) + toolCallTokens;
}

function isSummaryMessage(message: ChatMessage): boolean {
  return message.content.startsWith(`${SUMMARY_MESSAGE_PREFIX}\n`);
}

function isRealUserMessage(message: ChatMessage): boolean {
  return message.role === 'user' && !message.toolResult && !isSummaryMessage(message);
}

function summarizeMessage(message: ChatMessage): string {
  const prefix = message.role === 'assistant'
    ? 'assistant'
    : message.role === 'system'
      ? 'system'
      : message.toolResult
        ? 'tool'
        : 'user';
  const body = message.toolResult?.content || message.content;
  const compact = body.replace(/\s+/g, ' ').trim();
  return `${prefix}: ${compact.slice(0, 720)}`;
}

function buildTranscript(messages: ChatMessage[]): string {
  return messages.map((message, index) => {
    const toolCalls = message.toolCalls?.length
      ? `\nTool calls: ${message.toolCalls.map((toolCall) => `${toolCall.name}(${toolCall.id})`).join(', ')}`
      : '';
    const toolResult = message.toolResult
      ? `\nTool result for ${message.toolResult.toolCallId}${message.toolResult.isError ? ' (error)' : ''}:`
      : '';
    return [
      `## ${index + 1}. ${message.role}`,
      toolCalls,
      toolResult,
      messageBody(message),
    ].filter(Boolean).join('\n');
  }).join('\n\n');
}

function buildFallbackSummary(messages: ChatMessage[]): string {
  return [
    '模型摘要不可用，以下是本地生成的上下文检查点摘要。',
    '',
    '已压缩的较早对话：',
    ...messages.map((message) => `- ${summarizeMessage(message)}`),
    '',
    '继续时请优先依赖后续未压缩的最近两轮完整对话；上方摘要只作为较早上下文的线索。',
  ].join('\n');
}

function clampPositiveInteger(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || value === undefined || value <= 0) {
    return fallback;
  }

  return Math.floor(value);
}

function normalizeSummary(summary: string, fallbackMessages: ChatMessage[]): { summary: string; usedFallback: boolean } {
  const trimmed = summary.trim();
  if (trimmed) {
    return {
      summary: trimmed,
      usedFallback: false,
    };
  }

  return {
    summary: buildFallbackSummary(fallbackMessages),
    usedFallback: true,
  };
}

export class ContextManager {
  private messages: ChatMessage[];

  constructor(seedMessages: ChatMessage[] = []) {
    this.messages = [...seedMessages];
  }

  getMessages(): ChatMessage[] {
    return [...this.messages];
  }

  replaceMessages(messages: ChatMessage[]): void {
    this.messages = [...messages];
  }

  appendMessage(message: ChatMessage): void {
    this.messages.push(message);
  }

  estimateTokens(): number {
    return this.messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0);
  }

  async maybeCompact(options: ContextCompactionOptions = {}): Promise<ContextCompactionResult | undefined> {
    const estimatedTokensBefore = this.estimateTokens();
    const modelContextWindowTokens = clampPositiveInteger(
      options.modelContextWindowTokens,
      DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS,
    );
    const triggerTokens = Math.floor(
      modelContextWindowTokens * (options.autoCompactRatio ?? DEFAULT_AUTO_COMPACT_RATIO),
    );

    if (!options.force && (
      estimatedTokensBefore <= triggerTokens
      || this.messages.length < MIN_MESSAGES_FOR_COMPACTION
    )) {
      return undefined;
    }

    const preserveRecentUserTurns = clampPositiveInteger(
      options.preserveRecentUserTurns,
      DEFAULT_PRESERVE_RECENT_USER_TURNS,
    );
    const protectedStartIndex = this.findProtectedStartIndex(preserveRecentUserTurns);
    if (protectedStartIndex <= 0) {
      return undefined;
    }

    const compacted = this.messages.slice(0, protectedStartIndex);
    const remaining = this.messages.slice(protectedStartIndex);
    const transcript = buildTranscript(compacted);
    const maxSummaryTokens = clampPositiveInteger(options.maxSummaryTokens, DEFAULT_SUMMARY_TOKEN_BUDGET);

    let normalized: { summary: string; usedFallback: boolean };
    try {
      const generatedSummary = options.summarizer
        ? await options.summarizer({
            messages: compacted,
            transcript,
            maxSummaryTokens,
          })
        : '';
      normalized = normalizeSummary(generatedSummary, compacted);
    } catch {
      normalized = {
        summary: buildFallbackSummary(compacted),
        usedFallback: true,
      };
    }

    const now = options.now?.() ?? new Date();
    const summary = `${SUMMARY_MESSAGE_PREFIX}\n${normalized.summary}`;

    this.messages = [{
      id: `context-summary-${Date.now()}`,
      role: 'user',
      content: summary,
      timestamp: now.toISOString(),
    }, ...remaining];

    return {
      summary,
      originalMessageCount: compacted.length + remaining.length,
      compactedMessageCount: compacted.length,
      preservedMessageCount: remaining.length,
      estimatedTokensBefore,
      estimatedTokensAfter: this.estimateTokens(),
      usedFallback: normalized.usedFallback,
    };
  }

  private findProtectedStartIndex(preserveRecentUserTurns: number): number {
    let remainingUserTurns = preserveRecentUserTurns;

    for (let index = this.messages.length - 1; index >= 0; index -= 1) {
      if (!isRealUserMessage(this.messages[index])) {
        continue;
      }

      remainingUserTurns -= 1;
      if (remainingUserTurns === 0) {
        return index;
      }
    }

    return 0;
  }
}
