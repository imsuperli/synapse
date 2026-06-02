import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Loader2, MessageSquarePlus, X } from 'lucide-react';
import type { ChatMessage } from '../../shared/types/chat';
import { renderMarkdownLike } from './agent/RichText';

interface MiniAskOverlayProps {
  open: boolean;
  onClose: () => void;
}

type MiniAskMessage = ChatMessage;

function createMiniAskMessage(role: ChatMessage['role'], content: string): MiniAskMessage {
  return {
    id: `mini-ask-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    timestamp: new Date().toISOString(),
  };
}

function getConversationMessages(messages: MiniAskMessage[]): ChatMessage[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    content: message.content,
    timestamp: message.timestamp,
  }));
}

export const MiniAskOverlay: React.FC<MiniAskOverlayProps> = ({ open, onClose }) => {
  const [value, setValue] = useState('');
  const [messages, setMessages] = useState<MiniAskMessage[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const requestSeqRef = useRef(0);
  const hasConversation = messages.length > 0 || isSending || Boolean(error);

  useEffect(() => {
    if (!open) {
      return;
    }

    const focusTimer = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 40);

    return () => window.clearTimeout(focusTimer);
  }, [open]);

  useEffect(() => {
    if (!open || !scrollRef.current) {
      return;
    }

    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, open]);

  const trimmedValue = value.trim();
  const canSend = trimmedValue.length > 0 && !isSending;

  const handleReset = useCallback(() => {
    requestSeqRef.current += 1;
    setMessages([]);
    setError(null);
    setIsSending(false);
    setValue('');
    inputRef.current?.focus();
  }, []);

  const handleSend = useCallback(() => {
    const prompt = value.trim();
    if (!prompt || isSending) {
      return;
    }

    const requestSeq = ++requestSeqRef.current;
    const userMessage = createMiniAskMessage('user', prompt);
    const historyBeforeUser = getConversationMessages(messages);
    setMessages((currentMessages) => [...currentMessages, userMessage]);
    setValue('');
    setError(null);
    setIsSending(true);

    void (async () => {
      try {
        const response = await window.electronAPI.chatCompleteText({
          purpose: 'mini-ask',
          prompt,
          messages: historyBeforeUser,
        });

        if (requestSeqRef.current !== requestSeq) {
          return;
        }

        if (!response.success || !response.data) {
          throw new Error(response.error || '生成失败');
        }

        const assistantMessage = createMiniAskMessage('assistant', response.data.content);
        setMessages((currentMessages) => [...currentMessages, assistantMessage]);
      } catch (sendError) {
        if (requestSeqRef.current !== requestSeq) {
          return;
        }

        setError(sendError instanceof Error ? sendError.message : String(sendError));
      } finally {
        if (requestSeqRef.current === requestSeq) {
          setIsSending(false);
        }
      }
    })();
  }, [isSending, messages, value]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    event.stopPropagation();
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const handleOverlayKeyDown = useCallback((event: React.KeyboardEvent<HTMLElement>) => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  }, [onClose]);

  const containerStyle = useMemo<React.CSSProperties>(() => ({
    width: hasConversation ? 'min(440px, calc(100vw - 32px))' : 'min(408px, calc(100vw - 32px))',
    height: hasConversation ? 'min(560px, calc(100vh - 96px))' : 91,
  }), [hasConversation]);

  if (!open) {
    return null;
  }

  return (
    <div
      data-mini-ask-overlay="true"
      className="fixed bottom-6 left-1/2 z-[12000] -translate-x-1/2"
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <section
        className="flex overflow-hidden rounded-[22px] border border-[rgb(var(--border))]/80 bg-[color-mix(in_srgb,rgb(var(--card))_88%,transparent)] text-[rgb(var(--foreground))] shadow-[0_24px_80px_rgba(0,0,0,0.48)] backdrop-blur-2xl transition-[width,height] duration-200"
        style={containerStyle}
        aria-label="问一问"
        onKeyDown={handleOverlayKeyDown}
      >
        <div className="flex min-h-0 w-full flex-col">
          {hasConversation && (
            <div className="flex items-center justify-end gap-1 border-b border-[rgb(var(--border))]/70 px-3 py-2">
              <button
                type="button"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[rgb(var(--muted-foreground))] transition-colors hover:bg-[rgb(var(--accent))] hover:text-[rgb(var(--foreground))]"
                aria-label="新对话"
                onClick={handleReset}
              >
                <MessageSquarePlus size={16} />
              </button>
              <button
                type="button"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[rgb(var(--muted-foreground))] transition-colors hover:bg-[rgb(var(--accent))] hover:text-[rgb(var(--foreground))]"
                aria-label="收起"
                onClick={onClose}
              >
                <X size={17} />
              </button>
            </div>
          )}

          {hasConversation && (
            <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-auto px-4 py-4">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[88%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm leading-6 ${
                      message.role === 'user'
                        ? 'bg-[rgb(var(--accent))] text-[rgb(var(--foreground))]'
                        : 'text-[rgb(var(--foreground))]'
                    }`}
                  >
                    {message.role === 'assistant'
                      ? renderMarkdownLike(message.content)
                      : message.content}
                  </div>
                </div>
              ))}

              {isSending && (
                <div className="flex items-center gap-2 text-xs text-[rgb(var(--muted-foreground))]">
                  <Loader2 size={14} className="animate-spin" />
                  正在思考
                </div>
              )}

              {error && (
                <div className="rounded-lg border border-[rgb(var(--error))]/30 bg-[rgb(var(--error))]/10 px-3 py-2 text-xs leading-5 text-[rgb(var(--error))]">
                  {error}
                </div>
              )}
            </div>
          )}

          <div className="mt-auto px-3 pb-3 pt-3">
            <div className="rounded-[18px] bg-[rgb(var(--secondary))]/90 px-3 py-2">
              <textarea
                ref={inputRef}
                value={value}
                rows={1}
                className="block max-h-24 min-h-[24px] w-full resize-none bg-transparent text-sm leading-6 text-[rgb(var(--foreground))] outline-none placeholder:text-[rgb(var(--muted-foreground))]"
                placeholder="和synapse说点什么"
                onChange={(event) => setValue(event.target.value)}
                onKeyDown={handleKeyDown}
              />
              <div className="mt-2 flex h-7 items-center gap-2">
                <button
                  type="button"
                  className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-[rgb(var(--foreground))] transition-colors hover:bg-[rgb(var(--accent))]"
                >
                  synapse
                  <span className="text-[10px] text-[rgb(var(--muted-foreground))]">⌄</span>
                </button>
                <button
                  type="button"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[rgb(var(--muted-foreground))] transition-colors hover:bg-[rgb(var(--accent))] hover:text-[rgb(var(--foreground))]"
                  aria-label="新对话"
                  onClick={handleReset}
                >
                  <MessageSquarePlus size={14} />
                </button>
                <button
                  type="button"
                  className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-full bg-[rgb(var(--foreground))]/18 text-[rgb(var(--foreground))] transition-colors hover:bg-[rgb(var(--foreground))]/28 disabled:cursor-not-allowed disabled:opacity-45"
                  aria-label="发送"
                  disabled={!canSend}
                  onClick={handleSend}
                >
                  {isSending ? <Loader2 size={16} className="animate-spin" /> : <ArrowUp size={17} />}
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
