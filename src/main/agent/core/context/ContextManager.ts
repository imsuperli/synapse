import type { ChatMessage } from '../../../../shared/types/chat';

const DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS = 1_000_000;
const DEFAULT_AUTO_COMPACT_RATIO = 0.9;
const DEFAULT_PRESERVE_RECENT_USER_TURNS = 2;
const DEFAULT_PRESERVE_RECENT_MESSAGES = 12;
const DEFAULT_SUMMARY_TOKEN_BUDGET = 8_000;
const DEFAULT_SUMMARY_INPUT_RATIO = 0.65;
const DEFAULT_SUMMARY_OUTPUT_RATIO = 0.15;
const SUMMARY_PROMPT_RESERVE_TOKENS = 2_000;
const SUMMARY_MESSAGE_PREFIX = 'CONTEXT CHECKPOINT SUMMARY';
const MIN_MESSAGES_FOR_COMPACTION = 6;

export interface ContextSummaryInput {
  messages: ChatMessage[];
  transcript: string;
  transcriptEstimatedTokens: number;
  transcriptTruncated: boolean;
  maxSummaryTokens: number;
}

export interface ContextCompactionOptions {
  modelContextWindowTokens?: number;
  autoCompactRatio?: number;
  preserveRecentUserTurns?: number;
  preserveRecentMessages?: number;
  maxSummaryTokens?: number;
  maxSummaryInputTokens?: number;
  summarizer?: (input: ContextSummaryInput) => Promise<string>;
  now?: () => Date;
  force?: boolean;
  shouldAbort?: () => boolean;
}

export interface ContextCompactionResult {
  summary: string;
  originalMessageCount: number;
  compactedMessageCount: number;
  preservedMessageCount: number;
  estimatedTokensBefore: number;
  estimatedTokensAfter: number;
  summaryInputEstimatedTokens: number;
  summaryInputTruncated: boolean;
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

function formatTranscriptMessage(message: ChatMessage, index: number): string {
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
}

function buildTranscript(messages: ChatMessage[]): string {
  return messages.map(formatTranscriptMessage).join('\n\n');
}

function truncateToEstimatedTokens(value: string, maxTokens: number): string {
  if (estimateTextTokens(value) <= maxTokens) {
    return value;
  }

  const suffix = '\n...[truncated for context compaction input budget]';
  let low = 0;
  let high = value.length;
  let best = '';

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = `${value.slice(0, mid)}${suffix}`;
    if (estimateTextTokens(candidate) <= maxTokens) {
      best = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return best || suffix.trim();
}

function buildBudgetedTranscript(
  messages: ChatMessage[],
  maxTranscriptTokens: number,
): { transcript: string; estimatedTokens: number; truncated: boolean } {
  const fullTranscript = buildTranscript(messages);
  const fullTokens = estimateTextTokens(fullTranscript);
  if (fullTokens <= maxTranscriptTokens) {
    return {
      transcript: fullTranscript,
      estimatedTokens: fullTokens,
      truncated: false,
    };
  }

  const headBudget = Math.max(800, Math.floor(maxTranscriptTokens * 0.25));
  const tailBudget = Math.max(1_200, Math.floor(maxTranscriptTokens * 0.65));
  const headLines: string[] = [];
  let headTokens = 0;
  let headCount = 0;

  for (const message of messages) {
    const line = `- ${summarizeMessage(message)}`;
    const lineTokens = estimateTextTokens(`${line}\n`);
    if (headTokens + lineTokens > headBudget) {
      break;
    }
    headLines.push(line);
    headTokens += lineTokens;
    headCount += 1;
  }

  const tailSections: string[] = [];
  let tailTokens = 0;
  let tailCount = 0;

  for (let index = messages.length - 1; index >= headCount; index -= 1) {
    let section = formatTranscriptMessage(messages[index], index);
    let sectionTokens = estimateTextTokens(`${section}\n\n`);
    if (sectionTokens > tailBudget && tailCount === 0) {
      section = truncateToEstimatedTokens(section, tailBudget);
      sectionTokens = estimateTextTokens(`${section}\n\n`);
    }
    if (tailCount > 0 && tailTokens + sectionTokens > tailBudget) {
      break;
    }
    tailSections.unshift(section);
    tailTokens += sectionTokens;
    tailCount += 1;
  }

  const omittedCount = Math.max(0, messages.length - headCount - tailCount);
  const transcript = [
    `原始待压缩消息共 ${messages.length} 条，估算 ${fullTokens} tokens；以下输入已按摘要预算预压缩。`,
    '',
    headLines.length ? '较早消息本地索引摘要：' : '',
    ...headLines,
    omittedCount > 0 ? `\n[中间 ${omittedCount} 条消息已从摘要输入中省略；如有必要，可从上方摘要和下方最近原文推断连续状态。]` : '',
    tailSections.length ? '\n最近待压缩消息原文片段：' : '',
    ...tailSections,
  ].filter(Boolean).join('\n');
  const boundedTranscript = truncateToEstimatedTokens(transcript, maxTranscriptTokens);

  return {
    transcript: boundedTranscript,
    estimatedTokens: estimateTextTokens(boundedTranscript),
    truncated: true,
  };
}

function buildFallbackSummary(messages: ChatMessage[], maxSummaryTokens: number): string {
  const header = [
    '模型摘要不可用，以下是本地生成的上下文检查点摘要。',
    '',
    '已压缩的较早对话：',
  ];
  const footer = [
    '',
    '继续时请优先依赖后续未压缩的最近两轮完整对话；上方摘要只作为较早上下文的线索。',
  ];
  const lines = [...header];
  let omitted = 0;

  for (let index = 0; index < messages.length; index += 1) {
    const line = `- ${summarizeMessage(messages[index])}`;
    const candidate = [...lines, line, ...footer].join('\n');
    if (estimateTextTokens(candidate) > maxSummaryTokens) {
      omitted = messages.length - index;
      break;
    }
    lines.push(line);
  }

  if (omitted > 0) {
    const omittedLine = `- [本地摘要预算已满，另有 ${omitted} 条较早消息未逐条展开。]`;
    if (estimateTextTokens([...lines, omittedLine, ...footer].join('\n')) <= maxSummaryTokens) {
      lines.push(omittedLine);
    }
  }

  return truncateToEstimatedTokens([...lines, ...footer].join('\n'), maxSummaryTokens);
}

function clampPositiveInteger(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || value === undefined || value <= 0) {
    return fallback;
  }

  return Math.floor(value);
}

function normalizeSummary(
  summary: string,
  fallbackMessages: ChatMessage[],
  maxSummaryTokens: number,
): { summary: string; usedFallback: boolean } {
  const trimmed = summary.trim();
  if (trimmed) {
    return {
      summary: truncateToEstimatedTokens(trimmed, maxSummaryTokens),
      usedFallback: false,
    };
  }

  return {
    summary: buildFallbackSummary(fallbackMessages, maxSummaryTokens),
    usedFallback: true,
  };
}

interface CompactionPlan {
  prefix: ChatMessage[];
  compacted: ChatMessage[];
  suffix: ChatMessage[];
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

    if (options.shouldAbort?.()) {
      return undefined;
    }

    const preserveRecentUserTurns = clampPositiveInteger(
      options.preserveRecentUserTurns,
      DEFAULT_PRESERVE_RECENT_USER_TURNS,
    );
    const preserveRecentMessages = clampPositiveInteger(
      options.preserveRecentMessages,
      DEFAULT_PRESERVE_RECENT_MESSAGES,
    );
    const plan = this.createCompactionPlan(preserveRecentUserTurns, preserveRecentMessages);
    if (!plan) {
      return undefined;
    }

    const { prefix, compacted, suffix } = plan;
    const requestedMaxSummaryTokens = clampPositiveInteger(options.maxSummaryTokens, DEFAULT_SUMMARY_TOKEN_BUDGET);
    const maxSummaryTokens = Math.min(
      requestedMaxSummaryTokens,
      Math.max(1_000, Math.floor(modelContextWindowTokens * DEFAULT_SUMMARY_OUTPUT_RATIO)),
    );
    const maxSafeSummaryInputTokens = Math.max(
      1_000,
      modelContextWindowTokens - maxSummaryTokens - SUMMARY_PROMPT_RESERVE_TOKENS,
    );
    const requestedMaxSummaryInputTokens = clampPositiveInteger(
      options.maxSummaryInputTokens,
      Math.min(
        maxSafeSummaryInputTokens,
        Math.max(1_000, Math.floor(modelContextWindowTokens * DEFAULT_SUMMARY_INPUT_RATIO)),
      ),
    );
    const maxSummaryInputTokens = Math.min(requestedMaxSummaryInputTokens, maxSafeSummaryInputTokens);
    const budgetedTranscript = buildBudgetedTranscript(compacted, maxSummaryInputTokens);

    let normalized: { summary: string; usedFallback: boolean };
    try {
      const generatedSummary = options.summarizer
        ? await options.summarizer({
            messages: compacted,
            transcript: budgetedTranscript.transcript,
            transcriptEstimatedTokens: budgetedTranscript.estimatedTokens,
            transcriptTruncated: budgetedTranscript.truncated,
            maxSummaryTokens,
          })
        : '';
      if (options.shouldAbort?.()) {
        return undefined;
      }
      normalized = normalizeSummary(generatedSummary, compacted, maxSummaryTokens);
    } catch {
      if (options.shouldAbort?.()) {
        return undefined;
      }
      normalized = {
        summary: buildFallbackSummary(compacted, maxSummaryTokens),
        usedFallback: true,
      };
    }

    if (options.shouldAbort?.()) {
      return undefined;
    }

    const now = options.now?.() ?? new Date();
    const summary = `${SUMMARY_MESSAGE_PREFIX}\n${normalized.summary}`;

    this.messages = [...prefix, {
      id: `context-summary-${now.getTime()}`,
      role: 'user',
      content: summary,
      timestamp: now.toISOString(),
    }, ...suffix];

    return {
      summary,
      originalMessageCount: prefix.length + compacted.length + suffix.length,
      compactedMessageCount: compacted.length,
      preservedMessageCount: prefix.length + suffix.length,
      estimatedTokensBefore,
      estimatedTokensAfter: this.estimateTokens(),
      summaryInputEstimatedTokens: budgetedTranscript.estimatedTokens,
      summaryInputTruncated: budgetedTranscript.truncated,
      usedFallback: normalized.usedFallback,
    };
  }

  private createCompactionPlan(
    preserveRecentUserTurns: number,
    preserveRecentMessages: number,
  ): CompactionPlan | undefined {
    const protectedStartIndex = this.findProtectedStartIndex(preserveRecentUserTurns);
    if (protectedStartIndex > 0) {
      return {
        prefix: [],
        compacted: this.messages.slice(0, protectedStartIndex),
        suffix: this.messages.slice(protectedStartIndex),
      };
    }

    const firstUserIndex = this.messages.findIndex(isRealUserMessage);
    if (firstUserIndex < 0) {
      return undefined;
    }

    const recentStartIndex = Math.max(firstUserIndex + 1, this.messages.length - preserveRecentMessages);
    if (recentStartIndex <= firstUserIndex + 1) {
      return undefined;
    }

    return {
      prefix: this.messages.slice(0, firstUserIndex + 1),
      compacted: this.messages.slice(firstUserIndex + 1, recentStartIndex),
      suffix: this.messages.slice(recentStartIndex),
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
