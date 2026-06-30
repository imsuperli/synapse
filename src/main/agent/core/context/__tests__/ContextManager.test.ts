import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '../../../../../shared/types/chat';
import { ContextManager } from '../ContextManager';

function message(id: string, role: ChatMessage['role'], content: string): ChatMessage {
  return {
    id,
    role,
    content,
    timestamp: `2026-06-30T00:00:${id.padStart(2, '0')}.000Z`,
  };
}

describe('ContextManager', () => {
  it('summarizes older messages and preserves the latest two user turns verbatim', async () => {
    const messages = [
      message('1', 'user', 'first user request'),
      message('2', 'assistant', 'first assistant answer'),
      message('3', 'user', 'second user request'),
      message('4', 'assistant', 'second assistant answer'),
      message('5', 'user', 'third user request must stay'),
      message('6', 'assistant', 'third assistant answer must stay'),
      message('7', 'user', 'fourth user request must stay'),
      message('8', 'assistant', 'fourth assistant answer must stay'),
    ];
    const summarizer = vi.fn().mockResolvedValue('compressed older context');
    const manager = new ContextManager(messages);

    const result = await manager.maybeCompact({
      force: true,
      summarizer,
      now: () => new Date('2026-06-30T12:00:00.000Z'),
    });

    expect(result).toMatchObject({
      compactedMessageCount: 4,
      preservedMessageCount: 4,
      usedFallback: false,
    });
    expect(summarizer).toHaveBeenCalledWith(expect.objectContaining({
      messages: messages.slice(0, 4),
      transcript: expect.stringContaining('first user request'),
      maxSummaryTokens: expect.any(Number),
    }));
    expect(summarizer.mock.calls[0]?.[0].transcript).toContain('second assistant answer');

    const compactedMessages = manager.getMessages();
    expect(compactedMessages).toHaveLength(5);
    expect(compactedMessages[0]).toMatchObject({
      role: 'user',
      content: 'CONTEXT CHECKPOINT SUMMARY\ncompressed older context',
      timestamp: '2026-06-30T12:00:00.000Z',
    });
    expect(compactedMessages.slice(1).map((item) => item.content)).toEqual([
      'third user request must stay',
      'third assistant answer must stay',
      'fourth user request must stay',
      'fourth assistant answer must stay',
    ]);
  });

  it('does not compact when the estimated token usage is below the trigger budget', async () => {
    const messages = [
      message('1', 'user', 'short'),
      message('2', 'assistant', 'short'),
      message('3', 'user', 'short'),
      message('4', 'assistant', 'short'),
      message('5', 'user', 'short'),
      message('6', 'assistant', 'short'),
    ];
    const summarizer = vi.fn().mockResolvedValue('unused');
    const manager = new ContextManager(messages);

    const result = await manager.maybeCompact({
      modelContextWindowTokens: 1_000_000,
      summarizer,
    });

    expect(result).toBeUndefined();
    expect(summarizer).not.toHaveBeenCalled();
    expect(manager.getMessages()).toEqual(messages);
  });

  it('uses a deterministic fallback summary when model summarization fails', async () => {
    const messages = [
      message('1', 'user', 'old user request'),
      message('2', 'assistant', 'old assistant answer'),
      message('3', 'user', 'middle user request'),
      message('4', 'assistant', 'middle assistant answer'),
      message('5', 'user', 'recent user request'),
      message('6', 'assistant', 'recent assistant answer'),
    ];
    const manager = new ContextManager(messages);

    const result = await manager.maybeCompact({
      force: true,
      summarizer: vi.fn().mockRejectedValue(new Error('503 Service temporarily unavailable')),
    });

    expect(result?.usedFallback).toBe(true);
    const compactedMessages = manager.getMessages();
    expect(compactedMessages[0]?.content).toContain('CONTEXT CHECKPOINT SUMMARY');
    expect(compactedMessages[0]?.content).toContain('模型摘要不可用');
    expect(compactedMessages.map((item) => item.content)).toEqual(expect.arrayContaining([
      'middle user request',
      'middle assistant answer',
      'recent user request',
      'recent assistant answer',
    ]));
  });

  it('does not treat an existing checkpoint summary as a recent user turn', async () => {
    const previousSummary = message(
      '1',
      'user',
      'CONTEXT CHECKPOINT SUMMARY\nprevious compressed state',
    );
    const messages = [
      previousSummary,
      message('2', 'user', 'older real user turn'),
      message('3', 'assistant', 'older answer'),
      message('4', 'user', 'first protected user turn'),
      message('5', 'assistant', 'first protected answer'),
      message('6', 'user', 'second protected user turn'),
      message('7', 'assistant', 'second protected answer'),
    ];
    const summarizer = vi.fn().mockResolvedValue('new compressed state');
    const manager = new ContextManager(messages);

    await manager.maybeCompact({
      force: true,
      summarizer,
    });

    expect(summarizer).toHaveBeenCalledWith(expect.objectContaining({
      messages: [previousSummary, messages[1], messages[2]],
    }));
    expect(manager.getMessages().slice(1).map((item) => item.content)).toEqual([
      'first protected user turn',
      'first protected answer',
      'second protected user turn',
      'second protected answer',
    ]);
  });
});
