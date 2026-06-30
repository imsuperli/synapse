import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type {
  AgentPendingApproval,
  AgentPendingInteraction,
  AgentRespondApprovalRequest,
  AgentSendRequest,
  AgentSubmitInteractionRequest,
  AgentTaskSnapshot,
} from '../../../../shared/types/agent';
import type {
  AgentApprovalRequestEvent,
  AgentApprovalResultEvent,
  AgentCommandEvent,
  AgentCommandOutputEvent,
  AgentInteractionRequestEvent,
  AgentInteractionResultEvent,
  AgentOffloadRef,
  AgentReasoningEvent,
  AgentSystemNoticeEvent,
  AgentTimelineEvent,
  AgentToolCallEvent,
  AgentToolResultEvent,
} from '../../../../shared/types/agentTimeline';
import type {
  ChatMessage,
  LLMProviderConfig,
  ToolCall,
  ToolResult,
} from '../../../../shared/types/chat';
import { resolveToolApprovalDecision } from '../../../services/chat/ToolApprovalPolicy';
import { ChatService } from '../../../services/chat/ChatService';
import { ToolExecutor } from '../../../services/chat/ToolExecutor';
import { previewText } from '../../../utils/chatDebugLog';
import {
  ContextManager,
  type ContextSummaryInput,
} from '../context/ContextManager';
import { parseAssistantSections } from '../assistant-message';
import { buildAgentSystemPrompt } from '../prompts/system';
import type { RemoteTerminalManager, RemoteCommandHandle } from '../../integrations/remote-terminal';
import type { InteractionRequest } from '../../services/interaction-detector';
import type { McpHub } from '../../services/mcp/McpHub';
import type { SkillsManager } from '../../services/skills/SkillsManager';

const MAX_AGENT_TOOL_ROUNDS = 8;
const OFFLOAD_THRESHOLD = 14_000;
const OFFLOAD_PREVIEW_HEAD = 6_000;
const OFFLOAD_PREVIEW_TAIL = 3_000;
const AGENT_OFFLOAD_DIR = path.join(os.tmpdir(), 'synapse-agent-offload');
const RUNNING_STATE_SYNC_DEBOUNCE_MS = 80;
const STREAM_PREVIEW_FLUSH_INTERVAL_MS = 140;
const STREAM_PREVIEW_MAX_BUFFER_CHARS = 96;
const CONTEXT_COMPACTION_SYSTEM_PROMPT = [
  '你正在执行一次上下文检查点压缩，为后续继续对话的模型生成交接摘要。',
  '摘要必须保留：当前进展和关键决定、用户明确偏好和约束、已经执行过的命令/工具及结果、仍待完成的下一步、继续时必须知道的关键数据或文件路径。',
  '不要编造没有出现在原始对话里的事实。不要输出寒暄。用中文，结构清晰，尽量压缩但不要丢失排障结论和操作状态。',
].join('\n');
type ApprovalResolution = 'approved' | 'rejected' | 'cancelled';

interface AgentTaskDependencies {
  chatService: ChatService;
  toolExecutor: ToolExecutor | null;
  remoteTerminalManager: RemoteTerminalManager | null;
  skillsManager: SkillsManager;
  mcpHub: McpHub;
  commandSecurityEnabled: boolean;
  postState: (snapshot: AgentTaskSnapshot) => void;
  postEvent: (payload: { paneId: string; taskId: string; event: AgentTimelineEvent }) => void;
  postError: (payload: { paneId: string; taskId: string; error: string }) => void;
}

function cloneSnapshot(snapshot: AgentTaskSnapshot): AgentTaskSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as AgentTaskSnapshot;
}

async function maybeOffloadContent(
  taskId: string,
  prefix: string,
  content: string,
): Promise<{ content: string; offloadRef?: AgentOffloadRef }> {
  if (content.length <= OFFLOAD_THRESHOLD) {
    return { content };
  }

  await fs.mkdir(AGENT_OFFLOAD_DIR, { recursive: true });
  const fileName = `${prefix}-${Date.now()}-${taskId}.log`;
  const filePath = path.join(AGENT_OFFLOAD_DIR, fileName);
  await fs.writeFile(filePath, content, 'utf8');

  const preview = `${content.slice(0, OFFLOAD_PREVIEW_HEAD)}\n\n...[offloaded ${content.length - OFFLOAD_PREVIEW_HEAD - OFFLOAD_PREVIEW_TAIL} chars]...\n\n${content.slice(-OFFLOAD_PREVIEW_TAIL)}`;
  return {
    content: `${preview}\n\n[full output offloaded to ${filePath}]`,
    offloadRef: {
      id: uuidv4(),
      path: filePath,
      preview: previewText(content, 360),
      totalChars: content.length,
    },
  };
}

function stripTerminalControlSequences(content: string): string {
  return content
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1B\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\r/g, '');
}

export class AgentTask {
  private readonly snapshot: AgentTaskSnapshot;
  private readonly contextManager: ContextManager;
  private readonly deps: AgentTaskDependencies;
  private currentProvider: LLMProviderConfig | null = null;
  private latestRequest: AgentSendRequest | null = null;
  private runPromise: Promise<void> | null = null;
  private abortController: AbortController | null = null;
  private activeRemoteCommand: RemoteCommandHandle | null = null;
  private activeSilentCommandCancel: (() => void) | null = null;
  private activeToolCall: ToolCall | null = null;
  private pendingApprovalResolver: ((resolution: ApprovalResolution) => void) | null = null;
  private pendingInteractionBridge:
    | {
        interactionId: string;
        interactionType: AgentPendingInteraction['interactionType'];
        sendInput: (input: string, appendNewline?: boolean) => void;
        cancel: () => void;
      }
    | null = null;
  private isCancelled = false;
  private commandOutputSeq = 0;
  private pendingStateSyncTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(snapshot: AgentTaskSnapshot, deps: AgentTaskDependencies) {
    this.snapshot = cloneSnapshot(snapshot);
    this.deps = deps;
    this.contextManager = new ContextManager(snapshot.messages);
  }

  static prepareSnapshotForRestore(snapshot: AgentTaskSnapshot): AgentTaskSnapshot {
    const restored = cloneSnapshot(snapshot);
    const now = new Date().toISOString();
    const hadInFlightStatus = ['running', 'waiting_approval', 'waiting_interaction'].includes(restored.status);
    const hadPendingApproval = Boolean(restored.pendingApproval);
    const hadPendingInteraction = Boolean(restored.pendingInteraction);

    if (!hadInFlightStatus && !hadPendingApproval && !hadPendingInteraction) {
      return restored;
    }

    restored.timeline = restored.timeline.map((event) => {
      if (!event.status || !['pending', 'running', 'streaming'].includes(event.status)) {
        return event;
      }

      if (event.kind === 'tool-call') {
        return {
          ...event,
          status: 'cancelled',
          toolCall: {
            ...event.toolCall,
            status: 'error',
            reason: event.toolCall.reason ?? 'Execution was interrupted while restoring the agent runtime.',
          },
        };
      }

      return {
        ...event,
        status: 'cancelled',
      };
    });

    if (restored.pendingApproval) {
      restored.timeline.push({
        id: `approval-result-${restored.pendingApproval.approvalId}`,
        taskId: restored.taskId,
        paneId: restored.paneId,
        timestamp: now,
        kind: 'approval-result',
        status: 'completed',
        approvalId: restored.pendingApproval.approvalId,
        approved: false,
        reason: 'Pending approval expired after the agent runtime was restored.',
      });
    }

    if (restored.pendingInteraction) {
      restored.timeline.push({
        id: `interaction-result-${restored.pendingInteraction.interactionId}`,
        taskId: restored.taskId,
        paneId: restored.paneId,
        timestamp: now,
        kind: 'interaction-result',
        status: 'completed',
        interactionId: restored.pendingInteraction.interactionId,
        commandId: restored.pendingInteraction.commandId,
        cancelled: true,
      });
    }

    restored.pendingApproval = undefined;
    restored.pendingInteraction = undefined;
    restored.status = 'cancelled';
    restored.error = undefined;
    restored.updatedAt = now;
    restored.timeline.push({
      id: `notice-${uuidv4()}`,
      taskId: restored.taskId,
      paneId: restored.paneId,
      timestamp: now,
      kind: 'system-notice',
      status: 'completed',
      level: 'warning',
      content: 'Recovered persisted agent history. Live execution could not be resumed and was cancelled.',
    });

    return restored;
  }

  getSnapshot(): AgentTaskSnapshot {
    return cloneSnapshot(this.snapshot);
  }

  start(request: AgentSendRequest, provider: LLMProviderConfig): void {
    if (this.runPromise) {
      throw new Error('Agent task is still busy.');
    }

    this.resetTransientStateForNewRun();
    this.currentProvider = provider;
    this.latestRequest = request;
    this.snapshot.providerId = request.providerId;
    this.snapshot.model = request.model;
    this.snapshot.linkedPaneId = request.linkedPaneId;
    this.snapshot.sshContext = request.sshContext;
    this.snapshot.status = 'running';
    this.snapshot.error = undefined;
    this.snapshot.updatedAt = new Date().toISOString();

    if (this.snapshot.messages.length === 0 && request.seedMessages?.length) {
      this.snapshot.messages = [...request.seedMessages];
      this.contextManager.replaceMessages(this.snapshot.messages);
      this.emitNotice('warning', 'Imported existing chat transcript into the new agent runtime.');
    }

    const userMessage: ChatMessage = {
      id: uuidv4(),
      role: 'user',
      content: request.text,
      timestamp: new Date().toISOString(),
    };
    this.snapshot.messages.push(userMessage);
    this.contextManager.appendMessage(userMessage);
    this.appendEvent({
      id: userMessage.id,
      taskId: this.snapshot.taskId,
      paneId: this.snapshot.paneId,
      timestamp: userMessage.timestamp,
      kind: 'user-message',
      status: 'completed',
      content: request.text,
    });
    this.syncState();

    this.runPromise = this.runLoop().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      this.snapshot.error = message;
      this.setStatus(this.isCancelled ? 'cancelled' : 'failed');
      this.deps.postError({
        paneId: this.snapshot.paneId,
        taskId: this.snapshot.taskId,
        error: message,
      });
    }).finally(() => {
      this.runPromise = null;
      this.syncState();
    });
  }

  cancel(): void {
    this.isCancelled = true;
    this.abortController?.abort();
    this.activeRemoteCommand?.cancel();
    this.activeSilentCommandCancel?.();
    this.clearPendingApproval('Task cancelled while awaiting approval.', 'cancelled');
    this.clearPendingInteraction(true);
    this.markToolCallCancelled(this.activeToolCall, 'Task cancelled before the tool call completed.');
    this.setStatus('cancelled');
  }

  respondApproval(request: AgentRespondApprovalRequest): void {
    if (!this.snapshot.pendingApproval || !this.pendingApprovalResolver) {
      throw new Error('No pending approval for this task.');
    }

    if (this.snapshot.pendingApproval.approvalId !== request.approvalId) {
      throw new Error(`Stale approval response: ${request.approvalId}`);
    }

    const pendingApproval = this.snapshot.pendingApproval;
    const approvalResult: AgentApprovalResultEvent = {
      id: `approval-result-${pendingApproval.approvalId}`,
      taskId: this.snapshot.taskId,
      paneId: this.snapshot.paneId,
      timestamp: new Date().toISOString(),
      kind: 'approval-result',
      status: 'completed',
      approvalId: pendingApproval.approvalId,
      approved: request.approved,
      reason: request.approved ? undefined : 'Rejected by user',
    };
    this.appendEvent(approvalResult);
    this.snapshot.pendingApproval = undefined;
    const resolve = this.pendingApprovalResolver;
    this.pendingApprovalResolver = null;
    if (!this.isCancelled) {
      this.setStatus('running');
    }
    resolve(request.approved ? 'approved' : 'rejected');
  }

  submitInteraction(request: AgentSubmitInteractionRequest): void {
    if (!this.snapshot.pendingInteraction || !this.pendingInteractionBridge) {
      throw new Error('No pending interaction for this task.');
    }

    if (this.snapshot.pendingInteraction.interactionId !== request.interactionId) {
      throw new Error(`Stale interaction response: ${request.interactionId}`);
    }

    const pendingInteraction = this.snapshot.pendingInteraction;
    const bridge = this.pendingInteractionBridge;
    const appendNewline = pendingInteraction.interactionType !== 'pager';
    if (request.cancel) {
      bridge.cancel();
    } else {
      bridge.sendInput(request.input ?? '', appendNewline);
    }

    const interactionResult: AgentInteractionResultEvent = {
      id: `interaction-result-${pendingInteraction.interactionId}`,
      taskId: this.snapshot.taskId,
      paneId: this.snapshot.paneId,
      timestamp: new Date().toISOString(),
      kind: 'interaction-result',
      status: 'completed',
      interactionId: pendingInteraction.interactionId,
      commandId: pendingInteraction.commandId,
      inputPreview: request.cancel
        ? undefined
        : pendingInteraction.secret
          ? '***'
          : (request.input ?? '').slice(0, 120),
      cancelled: request.cancel,
    };
    this.appendEvent(interactionResult);
    this.snapshot.pendingInteraction = undefined;
    this.pendingInteractionBridge = null;
    if (!this.isCancelled) {
      this.setStatus('running');
    }
  }

  private async runLoop(): Promise<void> {
    for (let round = 0; round < MAX_AGENT_TOOL_ROUNDS; round += 1) {
      if (this.isCancelled || !this.latestRequest || !this.currentProvider) {
        return;
      }

      await this.maybeCompactContextBeforeTurn();

      const toolCalls = await this.performAssistantTurn();
      if (this.isCancelled) {
        return;
      }

      if (!toolCalls?.length) {
        this.setStatus('completed');
        return;
      }

      for (const toolCall of toolCalls) {
        if (this.isCancelled) {
          return;
        }
        await this.executeToolCall(toolCall);
      }
    }

    this.emitNotice('error', 'Agent exceeded the maximum recursive tool rounds and stopped.');
    this.setStatus('failed');
  }

  private async maybeCompactContextBeforeTurn(): Promise<void> {
    const compaction = await this.contextManager.maybeCompact({
      summarizer: async (input) => this.summarizeContext(input),
    });

    if (!compaction) {
      return;
    }

    this.snapshot.messages = this.contextManager.getMessages();
    this.appendEvent({
      id: `context-summary-${Date.now()}`,
      taskId: this.snapshot.taskId,
      paneId: this.snapshot.paneId,
      timestamp: new Date().toISOString(),
      kind: 'context-summary',
      status: 'completed',
      summary: [
        compaction.summary,
        '',
        `[compacted ${compaction.compactedMessageCount} earlier messages; preserved ${compaction.preservedMessageCount} recent messages; estimated tokens ${compaction.estimatedTokensBefore} -> ${compaction.estimatedTokensAfter}${compaction.usedFallback ? '; fallback summary' : ''}]`,
      ].join('\n'),
    });
  }

  private async summarizeContext(input: ContextSummaryInput): Promise<string> {
    if (!this.latestRequest || !this.currentProvider) {
      return '';
    }

    const prompt = [
      `请把下面较早的对话压缩成不超过约 ${input.maxSummaryTokens} tokens 的上下文检查点摘要。`,
      '最近两轮用户对话会在摘要后原样保留，所以这里重点总结更早内容中后续仍需要知道的信息。',
      '',
      input.transcript,
    ].join('\n');
    let fullContent = '';
    let streamError: string | null = null;
    const abortController = new AbortController();

    await this.deps.chatService.streamChat(
      {
        paneId: `${this.snapshot.paneId}:context-compaction`,
        windowId: this.snapshot.windowId,
        messages: [{
          id: `context-compaction-input-${Date.now()}`,
          role: 'user',
          content: prompt,
          timestamp: new Date().toISOString(),
        }],
        providerId: this.currentProvider.id,
        model: this.snapshot.model,
        enableTools: false,
        systemPrompt: CONTEXT_COMPACTION_SYSTEM_PROMPT,
        systemPromptMode: 'replace',
        _provider: this.currentProvider,
      } as Parameters<ChatService['streamChat']>[0] & { _provider: LLMProviderConfig },
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
      throw new Error(streamError);
    }

    return fullContent;
  }

  private async performAssistantTurn(): Promise<ToolCall[] | undefined> {
    if (!this.latestRequest || !this.currentProvider) {
      return undefined;
    }

    const turnId = uuidv4();
    const reasoningEventId = `reasoning-${turnId}`;
    const assistantEventId = `assistant-${turnId}`;
    let aggregated = '';
    let toolCalls: ToolCall[] | undefined;
    let streamError: string | null = null;
    let pendingPreviewBuffer = '';
    let pendingPreviewFlushTimer: ReturnType<typeof setTimeout> | null = null;

    const emitStreamingSections = () => {
      let emitted = false;
      const sections = parseAssistantSections(aggregated);

      if (sections.reasoning) {
        const reasoningEvent: AgentReasoningEvent = {
          id: reasoningEventId,
          taskId: this.snapshot.taskId,
          paneId: this.snapshot.paneId,
          timestamp: new Date().toISOString(),
          kind: 'reasoning',
          status: 'streaming',
          content: sections.reasoning,
        };
        this.appendEvent(reasoningEvent, 'skip');
        emitted = true;
      }

      if (sections.response) {
        this.appendEvent({
          id: assistantEventId,
          taskId: this.snapshot.taskId,
          paneId: this.snapshot.paneId,
          timestamp: new Date().toISOString(),
          kind: 'assistant-message',
          status: 'streaming',
          content: sections.response,
        }, 'skip');
        emitted = true;
      }

      if (emitted) {
        this.syncState('immediate');
      }
    };

    const clearPreviewFlushTimer = () => {
      if (pendingPreviewFlushTimer) {
        clearTimeout(pendingPreviewFlushTimer);
        pendingPreviewFlushTimer = null;
      }
    };

    const flushStreamingPreview = () => {
      if (!pendingPreviewBuffer) {
        return;
      }

      pendingPreviewBuffer = '';
      emitStreamingSections();
    };

    const scheduleStreamingPreviewFlush = (immediate = false) => {
      if (immediate) {
        clearPreviewFlushTimer();
        flushStreamingPreview();
        return;
      }

      if (pendingPreviewFlushTimer) {
        return;
      }

      pendingPreviewFlushTimer = setTimeout(() => {
        pendingPreviewFlushTimer = null;
        flushStreamingPreview();
      }, STREAM_PREVIEW_FLUSH_INTERVAL_MS);
    };

    this.abortController = new AbortController();
    const systemPrompt = buildAgentSystemPrompt({
      request: this.latestRequest,
      skillsManager: this.deps.skillsManager,
      mcpHub: this.deps.mcpHub,
    });

    await this.deps.chatService.streamChat(
      {
        ...this.latestRequest,
        paneId: this.snapshot.paneId,
        windowId: this.snapshot.windowId,
        messages: this.contextManager.getMessages(),
        providerId: this.currentProvider.id,
        model: this.snapshot.model,
        enableTools: this.latestRequest.enableTools,
        systemPrompt,
        _provider: this.currentProvider,
      } as Parameters<ChatService['streamChat']>[0] & { _provider: LLMProviderConfig },
      {
        onChunk: (chunk) => {
          aggregated += chunk;
          pendingPreviewBuffer += chunk;
          const shouldFlushImmediately = pendingPreviewBuffer.length >= STREAM_PREVIEW_MAX_BUFFER_CHARS
            || /[\n\r]/.test(chunk)
            || /[.!?;:。！？；：]$/.test(pendingPreviewBuffer.trimEnd())
            || chunk.includes('```')
            || chunk.includes('<thinking>')
            || chunk.includes('</thinking>');

          scheduleStreamingPreviewFlush(shouldFlushImmediately);
        },
        onDone: (fullContent, nextToolCalls) => {
          aggregated = fullContent;
          toolCalls = nextToolCalls?.map((toolCall) => ({
            ...toolCall,
            status: 'pending',
          }));
          scheduleStreamingPreviewFlush(true);
        },
        onError: (error) => {
          streamError = error;
          scheduleStreamingPreviewFlush(true);
        },
      },
      this.abortController.signal,
    );

    scheduleStreamingPreviewFlush(true);

    if (streamError) {
      throw new Error(streamError);
    }

    const sections = parseAssistantSections(aggregated);
    if (sections.reasoning) {
      this.appendEvent({
        id: reasoningEventId,
        taskId: this.snapshot.taskId,
        paneId: this.snapshot.paneId,
        timestamp: new Date().toISOString(),
        kind: 'reasoning',
        status: 'completed',
        content: sections.reasoning,
      });
    }

    const assistantMessage: ChatMessage = {
      id: assistantEventId,
      role: 'assistant',
      content: sections.response || aggregated.trim(),
      timestamp: new Date().toISOString(),
      model: this.snapshot.model,
      toolCalls,
    };
    this.snapshot.messages.push(assistantMessage);
    this.contextManager.appendMessage(assistantMessage);
    this.appendEvent({
      id: assistantEventId,
      taskId: this.snapshot.taskId,
      paneId: this.snapshot.paneId,
      timestamp: assistantMessage.timestamp,
      kind: 'assistant-message',
      status: 'completed',
      content: assistantMessage.content,
    });

    for (const toolCall of toolCalls ?? []) {
      const event: AgentToolCallEvent = {
        id: `tool-${toolCall.id}`,
        taskId: this.snapshot.taskId,
        paneId: this.snapshot.paneId,
        timestamp: new Date().toISOString(),
        kind: 'tool-call',
        status: 'pending',
        toolCall,
      };
      this.appendEvent(event);
    }

    return toolCalls;
  }

  private async executeToolCall(toolCall: ToolCall): Promise<void> {
    this.activeToolCall = toolCall;
    const toolEventId = `tool-${toolCall.id}`;
    try {
      this.appendEvent({
        id: toolEventId,
        taskId: this.snapshot.taskId,
        paneId: this.snapshot.paneId,
        timestamp: new Date().toISOString(),
        kind: 'tool-call',
        status: 'running',
        toolCall: {
          ...toolCall,
          status: 'executing',
        },
      });

      let result: ToolResult;

      if (toolCall.name === 'execute_command') {
        const approvalDecision = resolveToolApprovalDecision(toolCall, {
          commandSecurityEnabled: this.deps.commandSecurityEnabled,
        });

        if (approvalDecision.action === 'block') {
          result = {
            toolCallId: toolCall.id,
            content: `命令被安全策略阻止：${approvalDecision.reason ?? 'blocked'}`,
            isError: true,
          };
          await this.finishToolCall(toolCall, result, 'blocked');
          return;
        }

        if (approvalDecision.action === 'ask') {
          const approval = await this.waitForApproval(toolCall, approvalDecision.reason);
          if (approval === 'cancelled' || this.isCancelled) {
            this.markToolCallCancelled(toolCall, 'Task cancelled while awaiting approval.');
            return;
          }

          if (approval === 'rejected') {
            result = {
              toolCallId: toolCall.id,
              content: '用户拒绝了该命令的执行',
              isError: true,
            };
            await this.finishToolCall(toolCall, result, 'rejected');
            return;
          }
        }
      }

      if (!this.snapshot.sshContext || !this.deps.toolExecutor) {
        result = {
          toolCallId: toolCall.id,
          content: '缺少 SSH 上下文或工具执行器，无法继续执行远端工具。',
          isError: true,
        };
        await this.finishToolCall(toolCall, result, 'error');
        return;
      }

      if (toolCall.name === 'execute_command' && this.deps.remoteTerminalManager) {
        result = toolCall.params.interactive === true
          ? await this.executeRemoteCommand(toolCall)
          : await this.executeSilentRemoteCommand(toolCall);
        if (this.isCancelled) {
          this.markToolCallCancelled(toolCall, 'Task cancelled during remote command execution.');
          return;
        }
        await this.finishToolCall(toolCall, result, result.isError ? 'error' : 'completed');
        return;
      }

      result = await this.deps.toolExecutor.execute(toolCall, this.snapshot.sshContext);
      if (this.isCancelled) {
        this.markToolCallCancelled(toolCall, 'Task cancelled during tool execution.');
        return;
      }
      await this.finishToolCall(toolCall, result, result.isError ? 'error' : 'completed');
    } finally {
      if (this.activeToolCall?.id === toolCall.id) {
        this.activeToolCall = null;
      }
    }
  }

  private async executeRemoteCommand(toolCall: ToolCall): Promise<ToolResult> {
    if (!this.snapshot.sshContext || !this.deps.remoteTerminalManager) {
      return {
        toolCallId: toolCall.id,
        content: 'Remote terminal runtime unavailable.',
        isError: true,
      };
    }

    const command = String(toolCall.params.command ?? '');
    const interactive = toolCall.params.interactive === true;
    const commandEventId = `command-${toolCall.id}`;
    const host = this.snapshot.sshContext.host;

    const commandEvent: AgentCommandEvent = {
      id: commandEventId,
      taskId: this.snapshot.taskId,
      paneId: this.snapshot.paneId,
      timestamp: new Date().toISOString(),
      kind: 'command',
      status: 'running',
      commandId: commandEventId,
      host,
      command,
      interactive,
    };
    this.appendEvent(commandEvent);

    this.activeRemoteCommand = this.deps.remoteTerminalManager.runCommand({
      windowId: this.snapshot.sshContext.windowId,
      paneId: this.snapshot.sshContext.paneId,
      command,
      callbacks: {
        onOutput: (chunk) => {
          const sanitized = stripTerminalControlSequences(chunk);
          if (!sanitized.trim()) {
            return;
          }
          this.commandOutputSeq += 1;
          const event: AgentCommandOutputEvent = {
            id: `command-output-${toolCall.id}-${this.commandOutputSeq}`,
            taskId: this.snapshot.taskId,
            paneId: this.snapshot.paneId,
            timestamp: new Date().toISOString(),
            kind: 'command-output',
            status: 'completed',
            commandId: commandEventId,
            stream: 'pty',
            content: sanitized,
          };
          this.appendEvent(event);
        },
        onInteraction: (request) => {
          this.presentInteraction(toolCall, request);
        },
      },
    });

    const commandResult = await this.activeRemoteCommand.result;
    this.activeRemoteCommand = null;
    this.pendingInteractionBridge = null;
    this.snapshot.pendingInteraction = undefined;

    this.appendEvent({
      ...commandEvent,
      status: this.isCancelled
        ? 'cancelled'
        : commandResult.timedOut
          ? 'error'
          : 'completed',
      exitCode: commandResult.exitCode,
    });

    const normalized = await maybeOffloadContent(
      this.snapshot.taskId,
      `command-${toolCall.id}`,
      stripTerminalControlSequences(commandResult.output),
    );
    if (normalized.offloadRef) {
      this.snapshot.offloadRefs.push(normalized.offloadRef);
    }

    const detailSuffix = commandResult.exitCode !== 0
      ? `\n\n[exit code: ${commandResult.exitCode}]`
      : '';
    const content = normalized.content
      ? `${normalized.content}${detailSuffix}`
      : `(command completed with no output)${detailSuffix}`;
    return {
      toolCallId: toolCall.id,
      content,
      isError: commandResult.timedOut,
    };
  }

  private async executeSilentRemoteCommand(toolCall: ToolCall): Promise<ToolResult> {
    if (!this.snapshot.sshContext || !this.deps.remoteTerminalManager) {
      return {
        toolCallId: toolCall.id,
        content: 'Remote terminal runtime unavailable.',
        isError: true,
      };
    }

    const command = String(toolCall.params.command ?? '');
    const commandEventId = `command-${toolCall.id}`;
    const host = this.snapshot.sshContext.host;
    const commandEvent: AgentCommandEvent = {
      id: commandEventId,
      taskId: this.snapshot.taskId,
      paneId: this.snapshot.paneId,
      timestamp: new Date().toISOString(),
      kind: 'command',
      status: 'running',
      commandId: commandEventId,
      host,
      command,
      interactive: false,
    };
    this.appendEvent(commandEvent);

    let handle;
    try {
      handle = await this.deps.remoteTerminalManager.runSilentCommand({
        windowId: this.snapshot.sshContext.windowId,
        paneId: this.snapshot.sshContext.paneId,
        command,
        callbacks: {
          onStdout: (chunk) => {
            const sanitized = stripTerminalControlSequences(chunk);
            if (!sanitized) {
              return;
            }

            this.commandOutputSeq += 1;
            this.appendEvent({
              id: `command-output-${toolCall.id}-${this.commandOutputSeq}`,
              taskId: this.snapshot.taskId,
              paneId: this.snapshot.paneId,
              timestamp: new Date().toISOString(),
              kind: 'command-output',
              status: 'completed',
              commandId: commandEventId,
              stream: 'stdout',
              content: sanitized,
            });
          },
          onStderr: (chunk) => {
            const sanitized = stripTerminalControlSequences(chunk);
            if (!sanitized) {
              return;
            }

            this.commandOutputSeq += 1;
            this.appendEvent({
              id: `command-output-${toolCall.id}-${this.commandOutputSeq}`,
              taskId: this.snapshot.taskId,
              paneId: this.snapshot.paneId,
              timestamp: new Date().toISOString(),
              kind: 'command-output',
              status: 'completed',
              commandId: commandEventId,
              stream: 'stderr',
              content: sanitized,
            });
          },
        },
      });
      this.activeSilentCommandCancel = handle.cancel;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.appendEvent({
        ...commandEvent,
        status: 'error',
      });
      return {
        toolCallId: toolCall.id,
        content: message,
        isError: true,
      };
    }

    let result;
    try {
      result = await handle.result;
    } finally {
      if (this.activeSilentCommandCancel === handle.cancel) {
        this.activeSilentCommandCancel = null;
      }
    }

    const stdout = stripTerminalControlSequences(result.stdout).trimEnd();
    const stderr = stripTerminalControlSequences(result.stderr).trimEnd();
    const sections = [
      stdout,
      stderr ? `[stderr]\n${stderr}` : '',
      result.exitCode !== 0 ? `[exit code: ${result.exitCode}]` : '',
    ].filter(Boolean);
    const mergedOutput = sections.join('\n\n');

    this.appendEvent({
      ...commandEvent,
      status: 'completed',
      exitCode: result.exitCode,
    });

    const normalized = await maybeOffloadContent(
      this.snapshot.taskId,
      `command-${toolCall.id}`,
      mergedOutput,
    );
    if (normalized.offloadRef) {
      this.snapshot.offloadRefs.push(normalized.offloadRef);
    }

    return {
      toolCallId: toolCall.id,
      content: normalized.content || '(command completed with no output)',
      isError: false,
    };
  }

  private presentInteraction(toolCall: ToolCall, request: InteractionRequest): void {
    const pendingInteraction: AgentPendingInteraction = {
      interactionId: request.interactionId,
      commandId: `command-${toolCall.id}`,
      interactionType: request.interactionType,
      prompt: request.prompt,
      options: request.options,
      submitLabel: request.submitLabel,
      secret: request.secret,
      createdAt: new Date().toISOString(),
    };
    this.snapshot.pendingInteraction = pendingInteraction;
    this.pendingInteractionBridge = this.activeRemoteCommand
      ? {
          interactionId: request.interactionId,
          interactionType: request.interactionType,
          sendInput: this.activeRemoteCommand.sendInput,
          cancel: this.activeRemoteCommand.cancel,
        }
      : null;

    const event: AgentInteractionRequestEvent = {
      id: `interaction-${request.interactionId}`,
      taskId: this.snapshot.taskId,
      paneId: this.snapshot.paneId,
      timestamp: new Date().toISOString(),
      kind: 'interaction-request',
      status: 'pending',
      interactionId: request.interactionId,
      commandId: `command-${toolCall.id}`,
      interactionType: request.interactionType,
      prompt: request.prompt,
      options: request.options,
      submitLabel: request.submitLabel,
      secret: request.secret,
    };
    this.setStatus('waiting_interaction');
    this.appendEvent(event);
  }

  private resetTransientStateForNewRun(): void {
    this.isCancelled = false;
    this.abortController = null;
    this.activeRemoteCommand = null;
    this.activeSilentCommandCancel = null;
    this.activeToolCall = null;
    this.pendingApprovalResolver = null;
    this.pendingInteractionBridge = null;
    this.snapshot.pendingApproval = undefined;
    this.snapshot.pendingInteraction = undefined;
  }

  private clearPendingApproval(reason: string, resolution: ApprovalResolution): void {
    if (!this.snapshot.pendingApproval) {
      this.pendingApprovalResolver = null;
      return;
    }

    const pendingApproval = this.snapshot.pendingApproval;
    this.appendEvent({
      id: `approval-result-${pendingApproval.approvalId}`,
      taskId: this.snapshot.taskId,
      paneId: this.snapshot.paneId,
      timestamp: new Date().toISOString(),
      kind: 'approval-result',
      status: 'completed',
      approvalId: pendingApproval.approvalId,
      approved: false,
      reason,
    });
    this.snapshot.pendingApproval = undefined;
    const resolve = this.pendingApprovalResolver;
    this.pendingApprovalResolver = null;
    resolve?.(resolution);
  }

  private clearPendingInteraction(cancelled: boolean): void {
    if (!this.snapshot.pendingInteraction) {
      this.pendingInteractionBridge = null;
      return;
    }

    const pendingInteraction = this.snapshot.pendingInteraction;
    this.appendEvent({
      id: `interaction-result-${pendingInteraction.interactionId}`,
      taskId: this.snapshot.taskId,
      paneId: this.snapshot.paneId,
      timestamp: new Date().toISOString(),
      kind: 'interaction-result',
      status: 'completed',
      interactionId: pendingInteraction.interactionId,
      commandId: pendingInteraction.commandId,
      cancelled,
    });
    this.snapshot.pendingInteraction = undefined;
    this.pendingInteractionBridge = null;
  }

  private markToolCallCancelled(toolCall: ToolCall | null, reason: string): void {
    if (!toolCall) {
      return;
    }

    this.appendEvent({
      id: `tool-${toolCall.id}`,
      taskId: this.snapshot.taskId,
      paneId: this.snapshot.paneId,
      timestamp: new Date().toISOString(),
      kind: 'tool-call',
      status: 'cancelled',
      toolCall: {
        ...toolCall,
        status: 'error',
        reason,
      },
    });
  }

  private async waitForApproval(toolCall: ToolCall, reason?: string): Promise<ApprovalResolution> {
    const pendingApproval: AgentPendingApproval = {
      approvalId: uuidv4(),
      toolCall,
      reason,
      createdAt: new Date().toISOString(),
    };
    this.snapshot.pendingApproval = pendingApproval;

    const event: AgentApprovalRequestEvent = {
      id: `approval-${pendingApproval.approvalId}`,
      taskId: this.snapshot.taskId,
      paneId: this.snapshot.paneId,
      timestamp: new Date().toISOString(),
      kind: 'approval-request',
      status: 'pending',
      approvalId: pendingApproval.approvalId,
      toolCall,
      reason,
    };
    this.setStatus('waiting_approval');
    this.appendEvent(event);

    return await new Promise<ApprovalResolution>((resolve) => {
      this.pendingApprovalResolver = resolve;
      this.syncState();
    });
  }

  private async finishToolCall(
    toolCall: ToolCall,
    result: ToolResult,
    status: ToolCall['status'],
  ): Promise<void> {
    const normalized = await maybeOffloadContent(
      this.snapshot.taskId,
      `tool-${toolCall.id}`,
      result.content,
    );
    if (normalized.offloadRef) {
      this.snapshot.offloadRefs.push(normalized.offloadRef);
    }

    this.appendEvent({
      id: `tool-${toolCall.id}`,
      taskId: this.snapshot.taskId,
      paneId: this.snapshot.paneId,
      timestamp: new Date().toISOString(),
      kind: 'tool-call',
      status: result.isError ? 'error' : 'completed',
      toolCall: {
        ...toolCall,
        status,
        result: normalized.content,
      },
    });

    const toolResultEvent: AgentToolResultEvent = {
      id: `tool-result-${toolCall.id}`,
      taskId: this.snapshot.taskId,
      paneId: this.snapshot.paneId,
      timestamp: new Date().toISOString(),
      kind: 'tool-result',
      status: 'completed',
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      content: normalized.content,
      isError: result.isError,
      offloadRef: normalized.offloadRef,
    };
    this.appendEvent(toolResultEvent);

    const toolResultMessage: ChatMessage = {
      id: `tool-result-message-${toolCall.id}-${Date.now()}`,
      role: 'user',
      content: '',
      timestamp: new Date().toISOString(),
      toolResult: {
        toolCallId: toolCall.id,
        content: normalized.content,
        isError: result.isError,
      },
    };
    this.snapshot.messages.push(toolResultMessage);
    this.contextManager.appendMessage(toolResultMessage);
  }

  private appendEvent(
    event: AgentTimelineEvent,
    syncMode: 'auto' | 'immediate' | 'defer' | 'skip' = 'auto',
  ): void {
    const existingIndex = this.snapshot.timeline.findIndex((item) => item.id === event.id);
    if (existingIndex >= 0) {
      this.snapshot.timeline[existingIndex] = event;
    } else {
      this.snapshot.timeline.push(event);
    }

    this.snapshot.updatedAt = new Date().toISOString();
    this.deps.postEvent({
      paneId: this.snapshot.paneId,
      taskId: this.snapshot.taskId,
      event,
    });

    if (syncMode === 'skip') {
      return;
    }

    if (syncMode === 'immediate') {
      this.syncState('immediate');
      return;
    }

    if (syncMode === 'defer') {
      this.syncState('defer');
      return;
    }

    this.syncState(this.shouldDeferStateSync() ? 'defer' : 'immediate');
  }

  private emitNotice(level: AgentSystemNoticeEvent['level'], content: string): void {
    this.appendEvent({
      id: `notice-${uuidv4()}`,
      taskId: this.snapshot.taskId,
      paneId: this.snapshot.paneId,
      timestamp: new Date().toISOString(),
      kind: 'system-notice',
      status: 'completed',
      level,
      content,
    });
  }

  private setStatus(status: AgentTaskSnapshot['status']): void {
    this.snapshot.status = status;
    this.snapshot.updatedAt = new Date().toISOString();
    this.syncState();
  }

  private shouldDeferStateSync(): boolean {
    return this.snapshot.status === 'running'
      && !this.snapshot.pendingApproval
      && !this.snapshot.pendingInteraction;
  }

  private syncState(mode: 'immediate' | 'defer' = 'immediate'): void {
    if (mode === 'defer') {
      if (this.pendingStateSyncTimer) {
        return;
      }

      this.pendingStateSyncTimer = setTimeout(() => {
        this.pendingStateSyncTimer = null;
        this.deps.postState(this.getSnapshot());
      }, RUNNING_STATE_SYNC_DEBOUNCE_MS);
      return;
    }

    if (this.pendingStateSyncTimer) {
      clearTimeout(this.pendingStateSyncTimer);
      this.pendingStateSyncTimer = null;
    }

    this.deps.postState(this.getSnapshot());
  }
}
