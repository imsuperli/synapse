import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Archive, Bookmark, BookmarkCheck, Check, ChevronDown, ChevronRight, Copy, FolderOpen, History, ListTodo, MessageSquarePlus, SendHorizonal, Sparkles, Square, Undo2, X } from 'lucide-react';
import type { AgentTaskSnapshot } from '../../shared/types/agent';
import type { AgentTimelineEvent } from '../../shared/types/agentTimeline';
import type { CanvasActivityEvent, CanvasWorkspace } from '../../shared/types/canvas';
import type { ChatContextFragment, ChatMessage, ChatSettings, ChatSshContext, LLMProviderConfig } from '../../shared/types/chat';
import type { AggregatedSessionEntry, TaskActivityEvent, TaskArtifactRecord } from '../../shared/types/task';
import type { Pane } from '../types/window';
import { getAllPanes } from '../utils/layoutHelpers';
import { useI18n } from '../i18n';
import { useWindowStore } from '../stores/windowStore';
import { preventMouseButtonFocus } from '../utils/buttonFocus';
import { getPaneBackend, isTerminalPane } from '../../shared/utils/terminalCapabilities';
import { WORKSPACE_SETTINGS_UPDATED_EVENT } from '../utils/settingsEvents';
import { selectPreferredChatLinkedPaneId } from '../utils/chatPane';
import {
  buildChatSystemPrompt,
  mergeChatSettingsWithCanvasDefaults,
  normalizeChatSettings,
  resolveChatContextFragments,
} from '../utils/chatContext';
import {
  buildChatConversationTitle,
  createChatConversationHistoryId,
  getLatestChatConversationHistory,
  loadChatConversationHistory,
  normalizeAgentSnapshotForHistory,
  upsertChatConversationHistory,
  type ChatConversationHistoryEntry,
} from '../utils/chatHistory';
import { TaskPlanPane } from './chat/TaskPlanPane';
import { buildTaskActivityStream } from '../utils/taskActivity';
import { extractTaskPlan } from '../utils/taskPlan';
import { AgentTimeline } from './agent/AgentTimeline';
import { renderMarkdownLike } from './agent/RichText';
import {
  idePopupBarePanelClassName,
  idePopupCardClassName,
  idePopupEmptyStateClassName,
  idePopupSecondaryButtonClassName,
  idePopupSelectContentClassName,
  idePopupSubtlePanelClassName,
} from './ui/ide-popup';
import { AppTooltip } from './ui/AppTooltip';

export interface ChatPaneProps {
  windowId: string;
  pane: Pane;
  isActive: boolean;
  onActivate: () => void;
  onClose?: () => void;
}

interface ProviderModelOption {
  value: string;
  providerId: string;
  model: string;
  label: string;
}

interface MessageActionBarProps {
  copied: boolean;
  copyLabel: string;
  rollbackLabel?: string;
  onCopy: () => void;
  onRollback?: () => void;
}

const chatHeaderIconButtonClassName = [
  'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
  'text-[rgb(var(--muted-foreground))] leading-none transition-colors duration-200',
  'hover:bg-[rgb(var(--accent))] hover:text-[rgb(var(--foreground))]',
  'disabled:cursor-not-allowed disabled:opacity-45',
].join(' ');

const CHAT_HEADER_ICON_SIZE = 18;

function createCheckpointId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `chat-checkpoint-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function encodeProviderModelSelection(providerId: string, model: string): string {
  return JSON.stringify([providerId, model]);
}

function decodeProviderModelSelection(value: string): { providerId: string; model: string } | null {
  try {
    const parsed = JSON.parse(value);
    if (
      Array.isArray(parsed)
      && parsed.length === 2
      && typeof parsed[0] === 'string'
      && typeof parsed[1] === 'string'
    ) {
      return {
        providerId: parsed[0],
        model: parsed[1],
      };
    }
  } catch {
    return null;
  }

  return null;
}

function collectProviderModels(provider: LLMProviderConfig, activeModel?: string): string[] {
  const nextModels = [
    provider.defaultModel,
    ...(provider.models ?? []),
    activeModel,
  ].filter((model): model is string => Boolean(model && model.trim()));

  return Array.from(new Set(nextModels));
}

function buildProviderModelOptions(
  providers: LLMProviderConfig[],
  activeProviderId?: string,
  activeModel?: string,
): ProviderModelOption[] {
  return providers.flatMap((provider) => {
    const models = collectProviderModels(
      provider,
      provider.id === activeProviderId ? activeModel : undefined,
    );

    return models.map((model) => ({
      value: encodeProviderModelSelection(provider.id, model),
      providerId: provider.id,
      model,
      label: `${provider.name} / ${model}`,
    }));
  });
}

function ControlSelect({
  ariaLabel,
  value,
  onChange,
  disabled = false,
  icon,
  minWidthClass = 'min-w-[140px]',
  children,
}: {
  ariaLabel: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  icon?: React.ReactNode;
  minWidthClass?: string;
  children: React.ReactNode;
}) {
  const hasIcon = Boolean(icon);
  const selectClassName = [
    'h-9 min-w-0 w-full appearance-none rounded-[16px] border border-[rgb(var(--border))]',
    'bg-[color-mix(in_srgb,rgb(var(--secondary))_72%,transparent)]',
    'py-0 pr-8 text-sm leading-5 text-[rgb(var(--foreground))] outline-none',
    'shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] transition-[border-color,box-shadow,background-color]',
    'hover:bg-[rgb(var(--accent))] focus:border-[rgb(var(--ring))] focus:ring-2 focus:ring-[rgb(var(--ring))]/20',
    'sm:w-auto',
  ].join(' ');

  return (
    <label className={`relative inline-flex max-w-full items-center ${minWidthClass}`}>
      <span className="sr-only">{ariaLabel}</span>
      {hasIcon ? (
        <span className="pointer-events-none absolute left-3 text-[rgb(var(--muted-foreground))]">
          {icon}
        </span>
      ) : null}
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className={`${selectClassName} ${hasIcon ? 'pl-9' : 'pl-3'} disabled:cursor-not-allowed disabled:opacity-50`}
      >
        {children}
      </select>
      <ChevronDown size={14} className="pointer-events-none absolute right-3 text-[rgb(var(--muted-foreground))]" />
    </label>
  );
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  if (typeof document === 'undefined') {
    throw new Error('Clipboard is unavailable.');
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'absolute';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();

  try {
    document.execCommand('copy');
  } finally {
    document.body.removeChild(textarea);
  }
}

function cloneChatMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message) => ({
    ...message,
    toolCalls: message.toolCalls?.map((toolCall) => ({
      ...toolCall,
      params: { ...toolCall.params },
    })),
    toolResult: message.toolResult ? { ...message.toolResult } : undefined,
  }));
}

function hasConversationContent(messages: ChatMessage[], agent?: AgentTaskSnapshot): boolean {
  return messages.length > 0 || Boolean(agent?.timeline.length);
}

function formatHistoryTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }

  return date.toLocaleString(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function createTaskActivityId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `task-activity-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createCanvasActivityId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `canvas-activity-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function truncateActivityMessage(value: string, maxLength = 160): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function findCanvasWindowBlock(workspace: CanvasWorkspace, windowId: string): { id: string } | null {
  for (let index = workspace.blocks.length - 1; index >= 0; index -= 1) {
    const block = workspace.blocks[index];
    if (block.type === 'window' && block.windowId === windowId) {
      return block;
    }
  }

  return null;
}

function resolveCanvasActivityTarget(windowId: string): { workspaceId: string; blockId?: string } | null {
  const { activeCanvasWorkspaceId, canvasWorkspaces } = useWindowStore.getState();
  const availableWorkspaces = canvasWorkspaces.filter((workspace) => !workspace.archived);

  if (activeCanvasWorkspaceId) {
    const activeWorkspace = availableWorkspaces.find((workspace) => workspace.id === activeCanvasWorkspaceId);
    const activeBlock = activeWorkspace ? findCanvasWindowBlock(activeWorkspace, windowId) : null;
    if (activeWorkspace && activeBlock) {
      return {
        workspaceId: activeWorkspace.id,
        blockId: activeBlock.id,
      };
    }
  }

  const matches = availableWorkspaces.flatMap((workspace) => {
    const block = findCanvasWindowBlock(workspace, windowId);
    return block ? [{ workspaceId: workspace.id, blockId: block.id }] : [];
  });

  return matches.length === 1 ? matches[0] : null;
}

function resolveCanvasWorkspaceForWindow(windowId: string): CanvasWorkspace | null {
  const { activeCanvasWorkspaceId, canvasWorkspaces } = useWindowStore.getState();
  const availableWorkspaces = canvasWorkspaces.filter((workspace) => !workspace.archived);

  if (activeCanvasWorkspaceId) {
    const activeWorkspace = availableWorkspaces.find((workspace) => workspace.id === activeCanvasWorkspaceId);
    if (activeWorkspace && findCanvasWindowBlock(activeWorkspace, windowId)) {
      return activeWorkspace;
    }
  }

  const matches = availableWorkspaces.filter((workspace) => findCanvasWindowBlock(workspace, windowId));
  return matches.length === 1 ? matches[0] : null;
}

function buildRollbackSnapshot(
  task: AgentTaskSnapshot | undefined,
  messageId: string,
  paneId: string,
  windowId: string,
): AgentTaskSnapshot | undefined {
  if (!task) {
    return undefined;
  }

  const rollbackMessageIndex = task.messages.findIndex((message) => (
    message.id === messageId && message.role === 'user'
  ));
  if (rollbackMessageIndex < 0) {
    return normalizeAgentSnapshotForHistory(task, paneId, windowId);
  }

  const nextMessages = task.messages.slice(0, rollbackMessageIndex);
  if (nextMessages.length === 0) {
    return undefined;
  }

  const rollbackTimelineIndex = task.timeline.findIndex((event) => (
    event.kind === 'user-message' && event.id === messageId
  ));
  const nextTimeline = rollbackTimelineIndex >= 0
    ? task.timeline.slice(0, rollbackTimelineIndex)
    : task.timeline;

  return normalizeAgentSnapshotForHistory({
    ...task,
    paneId,
    windowId,
    status: 'completed',
    timeline: nextTimeline,
    messages: nextMessages,
    pendingApproval: undefined,
    pendingInteraction: undefined,
    error: undefined,
    updatedAt: new Date().toISOString(),
  }, paneId, windowId);
}

function MessageActionBar({
  copied,
  copyLabel,
  rollbackLabel,
  onCopy,
  onRollback,
}: MessageActionBarProps) {
  const actionButtonClassName =
    'inline-flex h-7 w-7 items-center justify-center rounded-[10px] border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--background))_82%,transparent)] text-[rgb(var(--muted-foreground))] transition-colors duration-150 hover:border-[rgb(var(--ring))] hover:bg-[rgb(var(--accent))] hover:text-[rgb(var(--foreground))]';
  return (
    <div className="pointer-events-none flex items-center gap-1 opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
      {onRollback ? (
        <button
          type="button"
          tabIndex={-1}
          aria-label={rollbackLabel}
          onMouseDown={preventMouseButtonFocus}
          onClick={onRollback}
          className={actionButtonClassName}
        >
          <Undo2 size={13} strokeWidth={1.9} />
        </button>
      ) : null}
      <button
        type="button"
        tabIndex={-1}
        aria-label={copyLabel}
        onMouseDown={preventMouseButtonFocus}
        onClick={onCopy}
        className={actionButtonClassName}
      >
        {copied ? <Check size={13} strokeWidth={2.2} /> : <Copy size={13} strokeWidth={1.9} />}
      </button>
    </div>
  );
}

function renderLegacyMessage(
  message: ChatMessage,
  {
    copied,
    copyLabel,
    rollbackLabel,
    onCopy,
    onRollback,
  }: {
    copied: boolean;
    copyLabel: string;
    rollbackLabel?: string;
    onCopy: () => void;
    onRollback?: () => void;
  },
) {
  if (message.role === 'user' && !message.toolResult) {
    return (
      <div className="group flex items-center justify-end gap-2">
        <MessageActionBar
          copied={copied}
          copyLabel={copyLabel}
          rollbackLabel={rollbackLabel}
          onCopy={onCopy}
          onRollback={onRollback}
        />
        <div className={`${idePopupSubtlePanelClassName} max-w-[78%] rounded-[22px] px-4 py-3 sm:max-w-[68%]`}>
          <div className="space-y-2 text-[15px] leading-6 text-[rgb(var(--foreground))]">
            {renderMarkdownLike(message.content)}
          </div>
        </div>
      </div>
    );
  }

  if (message.toolResult) {
    return (
      <div className={`${idePopupCardClassName} rounded-[20px] px-4 py-3 text-[rgb(var(--foreground))]`}>
        <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-6 text-[rgb(var(--foreground))]">
          {message.toolResult.content}
        </pre>
      </div>
    );
  }

  return (
    <div className="group relative">
      <div className="absolute right-0 top-0 z-10">
        <MessageActionBar
          copied={copied}
          copyLabel={copyLabel}
          onCopy={onCopy}
        />
      </div>
      <div className="pr-10">
        <div className="space-y-2 text-[15px] leading-6 text-[rgb(var(--foreground))]">
          {renderMarkdownLike(message.content)}
        </div>
      </div>
    </div>
  );
}

function hasExecutableSshBinding(pane: Pane | null | undefined): boolean {
  if (!pane || getPaneBackend(pane) !== 'ssh') {
    return false;
  }

  return Boolean(
    pane.ssh?.profileId?.trim()
      || (pane.ssh?.host?.trim() && pane.ssh?.user?.trim()),
  );
}

function createOptimisticId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getPathLeaf(path?: string): string | undefined {
  if (!path) {
    return undefined;
  }

  const segments = path.split(/[\\/]/).filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : undefined;
}

function isGenericWindowName(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  return normalized === 'ai chat'
    || normalized === 'chat window'
    || normalized === 'ssh window'
    || normalized === 'local window'
    || normalized === 'terminal window'
    || normalized.endsWith(' window');
}

function resolveEmptyConversationTarget(
  terminalWindowName: string | undefined,
  linkedPane: Pane | null,
): string | undefined {
  if (linkedPane) {
    const cwdTarget = getPathLeaf(linkedPane.cwd)
      ?? getPathLeaf(linkedPane.ssh?.remoteCwd);
    if (cwdTarget) {
      return cwdTarget;
    }

    const sshHost = linkedPane.ssh?.host?.trim();
    if (sshHost) {
      return sshHost;
    }
  }

  const trimmedWindowName = terminalWindowName?.trim();
  if (trimmedWindowName && !isGenericWindowName(trimmedWindowName)) {
    return trimmedWindowName;
  }

  return undefined;
}

function createLegacyTimeline(messages: ChatMessage[]): AgentTimelineEvent[] {
  return messages.flatMap((message): AgentTimelineEvent[] => {
    if (message.toolResult) {
      return [{
        id: `legacy-tool-result-${message.id}`,
        taskId: 'legacy',
        paneId: 'legacy',
        timestamp: message.timestamp,
        kind: 'tool-result',
        status: message.toolResult.isError ? 'error' : 'completed',
        toolCallId: message.toolResult.toolCallId,
        content: message.toolResult.content,
        isError: message.toolResult.isError,
      }];
    }

    if (message.role === 'assistant') {
      return [{
        id: `legacy-assistant-${message.id}`,
        taskId: 'legacy',
        paneId: 'legacy',
        timestamp: message.timestamp,
        kind: 'assistant-message',
        status: 'completed',
        content: message.content,
      }];
    }

    if (message.role === 'system') {
      return [{
        id: `legacy-system-${message.id}`,
        taskId: 'legacy',
        paneId: 'legacy',
        timestamp: message.timestamp,
        kind: 'system-notice',
        status: 'completed',
        level: 'info',
        content: message.content,
      }];
    }

    return [{
      id: `legacy-user-${message.id}`,
      taskId: 'legacy',
      paneId: 'legacy',
      timestamp: message.timestamp,
      kind: 'user-message',
      status: 'completed',
      content: message.content,
    }];
  });
}

function buildOptimisticAgentTask({
  windowId,
  paneId,
  providerId,
  model,
  text,
  linkedPaneId,
  sshContext,
  previousMessages,
  previousTask,
}: {
  windowId: string;
  paneId: string;
  providerId: string;
  model: string;
  text: string;
  linkedPaneId?: string;
  sshContext?: ChatSshContext;
  previousMessages: ChatMessage[];
  previousTask?: AgentTaskSnapshot;
}): AgentTaskSnapshot {
  const timestamp = new Date().toISOString();
  const taskId = previousTask?.taskId ?? createOptimisticId('optimistic-task');
  const userMessageId = createOptimisticId('optimistic-user');
  const reasoningEventId = createOptimisticId('reasoning-optimistic');
  const baseTimeline = previousTask?.timeline ?? createLegacyTimeline(previousMessages);
  const userMessage: ChatMessage = {
    id: userMessageId,
    role: 'user',
    content: text,
    timestamp,
  };

  return {
    taskId,
    paneId,
    windowId,
    status: 'running',
    providerId,
    model,
    linkedPaneId,
    sshContext,
    timeline: [
      ...baseTimeline,
      {
        id: userMessageId,
        taskId,
        paneId,
        timestamp,
        kind: 'user-message',
        status: 'completed',
        content: text,
      },
      {
        id: reasoningEventId,
        taskId,
        paneId,
        timestamp,
        kind: 'reasoning',
        status: 'streaming',
        content: '',
      },
    ],
    messages: [
      ...(previousTask?.messages ?? previousMessages),
      userMessage,
    ],
    offloadRefs: [...(previousTask?.offloadRefs ?? [])],
    pendingApproval: undefined,
    pendingInteraction: undefined,
    error: undefined,
    createdAt: previousTask?.createdAt ?? timestamp,
    updatedAt: timestamp,
    usage: previousTask?.usage,
  };
}

function isOptimisticReasoningEvent(event: AgentTimelineEvent): boolean {
  return event.kind === 'reasoning' && event.id.startsWith('reasoning-optimistic-');
}

function isInternalBootstrapEvent(event: AgentTimelineEvent): boolean {
  return event.kind === 'user-message'
    || event.kind === 'system-notice'
    || event.kind === 'context-summary';
}

function isRenderableAssistantProgressEvent(event: AgentTimelineEvent): boolean {
  switch (event.kind) {
    case 'reasoning':
      return Boolean(event.content.trim());
    case 'assistant-message':
      return Boolean(event.content.trim());
    case 'tool-call':
    case 'tool-result':
    case 'command':
    case 'command-output':
    case 'approval-request':
    case 'interaction-request':
      return true;
    default:
      return false;
  }
}

function hasVisibleAgentProgress(events: AgentTimelineEvent[]): boolean {
  return events.some((event) => (
    !isInternalBootstrapEvent(event)
    && isRenderableAssistantProgressEvent(event)
  ));
}

function isOptimisticAgentTask(task: AgentTaskSnapshot | null | undefined): boolean {
  if (!task) {
    return false;
  }

  return task.taskId.startsWith('optimistic-task-')
    || task.timeline.some(isOptimisticReasoningEvent);
}

function mergeAgentTaskWithOptimisticReasoning(
  task: AgentTaskSnapshot,
  optimisticTask?: AgentTaskSnapshot | null,
): AgentTaskSnapshot {
  const optimisticReasoningEvents = optimisticTask?.timeline
    .filter(isOptimisticReasoningEvent)
    .map((event) => ({
      ...event,
      taskId: task.taskId,
      paneId: task.paneId,
    })) ?? [];

  if (
    task.status !== 'running'
    || optimisticReasoningEvents.length === 0
    || hasVisibleAgentProgress(task.timeline)
  ) {
    return task;
  }

  const existingEventIds = new Set(task.timeline.map((event) => event.id));

  return {
    ...task,
    timeline: [
      ...task.timeline,
      ...optimisticReasoningEvents.filter((event) => !existingEventIds.has(event.id)),
    ],
  };
}

function selectNewestAgentTask(
  primary?: AgentTaskSnapshot | null,
  secondary?: AgentTaskSnapshot | null,
): AgentTaskSnapshot | undefined {
  if (!primary) {
    return secondary ?? undefined;
  }

  if (!secondary) {
    return primary;
  }

  return primary.updatedAt >= secondary.updatedAt ? primary : secondary;
}

function isScrollContainerNearBottom(element: HTMLDivElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= 32;
}

export const ChatPane: React.FC<ChatPaneProps> = ({
  windowId,
  pane,
  onActivate,
  onClose,
}) => {
  const { t } = useI18n();
  const updatePane = useWindowStore((state) => state.updatePane);
  const updatePaneRuntime = useWindowStore((state) => state.updatePaneRuntime);
  const paneRef = useRef(pane);
  const hasLiveTaskRef = useRef(false);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const autoScrollPinnedRef = useRef(true);
  const autoScrollFrameRef = useRef<number | null>(null);
  const hasAttemptedHistoryHydrationRef = useRef(false);
  const historyMenuRef = useRef<HTMLDivElement | null>(null);
  const historyButtonRef = useRef<HTMLButtonElement | null>(null);
  const copyResetTimerRef = useRef<number | null>(null);
  const checkpointSavedResetTimerRef = useRef<number | null>(null);
  const lastCanvasErrorSignatureRef = useRef<string | null>(null);
  const [composerValue, setComposerValue] = useState('');
  const [settings, setSettings] = useState<ChatSettings>(() => normalizeChatSettings(undefined));
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [optimisticTask, setOptimisticTask] = useState<AgentTaskSnapshot | null>(null);
  const [liveAgentTask, setLiveAgentTask] = useState<AgentTaskSnapshot | null>(null);
  const [historyEntries, setHistoryEntries] = useState<ChatConversationHistoryEntry[]>([]);
  const [aggregatedSessions, setAggregatedSessions] = useState<AggregatedSessionEntry[]>([]);
  const [taskArtifacts, setTaskArtifacts] = useState<TaskArtifactRecord[]>([]);
  const [manualActivity, setManualActivity] = useState<TaskActivityEvent[]>([]);
  const [historyMenuOpen, setHistoryMenuOpen] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [checkpointSaved, setCheckpointSaved] = useState(false);
  const [planPaneOpen, setPlanPaneOpen] = useState(false);
  const [artifactSaving, setArtifactSaving] = useState(false);
  const [enhancementSummaryOpen, setEnhancementSummaryOpen] = useState(false);

  useEffect(() => {
    paneRef.current = pane;
  }, [pane]);

  useEffect(() => {
    setLiveAgentTask(null);
    setOptimisticTask(null);
    setAggregatedSessions(pane.chat?.aggregatedSessions ?? []);
    setTaskArtifacts(pane.chat?.artifacts ?? []);
    setManualActivity(pane.chat?.activity ?? []);
    autoScrollPinnedRef.current = true;
    hasAttemptedHistoryHydrationRef.current = false;
    setHistoryMenuOpen(false);
    setCopiedMessageId(null);
    setCheckpointSaved(false);
    setPlanPaneOpen(false);
    setEnhancementSummaryOpen(false);
  }, [pane.id]);

  const windows = useWindowStore((state) => state.windows);
  const currentWindow = useMemo(
    () => windows.find((window) => window.id === windowId) ?? null,
    [windowId, windows],
  );
  const terminalPaneEntries = useMemo(() => (
    windows.flatMap((window) => getAllPanes(window.layout)
      .filter((candidate) => isTerminalPane(candidate))
      .map((candidate) => ({
        windowId: window.id,
        windowName: window.name,
        pane: candidate,
      })))
  ), [windows]);
  const terminalPanes = useMemo(
    () => terminalPaneEntries.map((entry) => entry.pane),
    [terminalPaneEntries],
  );

  const chatState = pane.chat ?? { messages: [] };
  const canvasWorkspace = useMemo(
    () => resolveCanvasWorkspaceForWindow(windowId),
    [windowId, windows],
  );
  const refreshHistoryEntries = useCallback(() => {
    setHistoryEntries(loadChatConversationHistory(windowId));
  }, [windowId]);
  const persistedAgentState = useMemo(() => {
    if (optimisticTask && (!chatState.agent || chatState.agent.updatedAt < optimisticTask.updatedAt)) {
      return optimisticTask;
    }

    if (!chatState.agent) {
      return optimisticTask ?? undefined;
    }

    return mergeAgentTaskWithOptimisticReasoning(chatState.agent, optimisticTask);
  }, [chatState.agent, optimisticTask]);
  const agentState = useMemo(() => {
    const freshestTask = selectNewestAgentTask(persistedAgentState, liveAgentTask);
    if (!freshestTask) {
      return undefined;
    }

    return mergeAgentTaskWithOptimisticReasoning(freshestTask, optimisticTask);
  }, [liveAgentTask, optimisticTask, persistedAgentState]);
  const resolvedLinkedPaneId = selectPreferredChatLinkedPaneId(terminalPanes, chatState.linkedPaneId);
  const linkedPane = useMemo(
    () => terminalPanes.find((candidate) => candidate.id === resolvedLinkedPaneId) ?? null,
    [resolvedLinkedPaneId, terminalPanes],
  );
  const linkedPaneEntry = useMemo(
    () => terminalPaneEntries.find((entry) => entry.pane.id === resolvedLinkedPaneId) ?? null,
    [resolvedLinkedPaneId, terminalPaneEntries],
  );
  const optimisticSshContext = useMemo(() => {
    if (!linkedPane || getPaneBackend(linkedPane) !== 'ssh' || !linkedPane.ssh) {
      return undefined;
    }

    const host = linkedPane.ssh.host?.trim();
    const user = linkedPane.ssh.user?.trim();
    if (!host || !user) {
      return undefined;
    }

    return {
      host,
      user,
      cwd: linkedPane.cwd || linkedPane.ssh.remoteCwd,
      windowId: linkedPaneEntry?.windowId ?? windowId,
      paneId: linkedPane.id,
    };
  }, [linkedPane, linkedPaneEntry?.windowId, windowId]);
  const hasExecutableLinkedSsh = hasExecutableSshBinding(linkedPane);
  const providers = settings.providers;
  const selectedProviderId = chatState.activeProviderId ?? agentState?.providerId ?? settings.activeProviderId ?? providers[0]?.id ?? '';
  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId) ?? null;
  const selectedModel = chatState.activeModel ?? agentState?.model ?? selectedProvider?.defaultModel ?? selectedProvider?.models[0] ?? '';
  const selectedProviderModelValue = selectedProvider && selectedModel
    ? encodeProviderModelSelection(selectedProvider.id, selectedModel)
    : '';
  const isBusy = agentState
    ? ['running', 'waiting_approval', 'waiting_interaction'].includes(agentState.status)
    : Boolean(chatState.isStreaming);
  const canSend = Boolean(selectedProvider && selectedModel && !isBusy);
  const checkpoints = chatState.checkpoints ?? [];
  const windowStoreCanvasActivity = useWindowStore((state) => state.canvasActivity);
  const currentWindowCwd = useMemo(() => (
    currentWindow
      ? getAllPanes(currentWindow.layout).find((candidate) => candidate.cwd?.trim())?.cwd
      : undefined
  ), [currentWindow]);

  const currentConversationId = chatState.conversationId;
  const appendManualActivity = useCallback((event: Omit<TaskActivityEvent, 'id' | 'timestamp'>) => {
    setManualActivity((currentEvents) => ([
      ...currentEvents.slice(-39),
      {
        id: createTaskActivityId(),
        timestamp: new Date().toISOString(),
        ...event,
      },
    ]));
  }, []);

  const canvasEventsForWindow = useMemo(() => (
    windowStoreCanvasActivity.filter((event) => event.windowId === windowId || event.paneId === pane.id)
  ), [pane.id, windowId, windowStoreCanvasActivity]);

  const extractedPlan = useMemo(() => (
    extractTaskPlan({
      assistantMessages: chatState.messages
        .filter((message) => message.role === 'assistant' && !message.toolResult)
        .map((message) => message.content),
      agent: agentState,
    })
  ), [agentState, chatState.messages]);

  const taskActivity = useMemo(() => (
    buildTaskActivityStream({
      conversationId: currentConversationId,
      messages: chatState.messages,
      agent: agentState,
      canvasEvents: canvasEventsForWindow,
      artifacts: taskArtifacts,
      manualEvents: manualActivity,
    })
  ), [agentState, canvasEventsForWindow, chatState.messages, currentConversationId, manualActivity, taskArtifacts]);

  const appendCanvasActivityEvent = useCallback((
    type: CanvasActivityEvent['type'],
    title: string,
    message?: string,
    extras?: Partial<Omit<CanvasActivityEvent, 'id' | 'workspaceId' | 'timestamp' | 'type' | 'title' | 'message'>>,
  ) => {
    const target = resolveCanvasActivityTarget(windowId);
    if (!target) {
      return;
    }

    useWindowStore.getState().appendCanvasActivity({
      id: createCanvasActivityId(),
      workspaceId: target.workspaceId,
      timestamp: new Date().toISOString(),
      type,
      title,
      message,
      windowId,
      blockId: target.blockId,
      ...extras,
    });
  }, [windowId]);

  const appendCanvasAgentError = useCallback((message: string, signature: string) => {
    if (!message || lastCanvasErrorSignatureRef.current === signature) {
      return;
    }

    lastCanvasErrorSignatureRef.current = signature;
    appendCanvasActivityEvent('agent-error', t('chatPane.activityAgentError'), truncateActivityMessage(message), {
      paneId: pane.id,
    });
  }, [appendCanvasActivityEvent, pane.id, t]);

  const persistChatState = useCallback((
    updater: (currentChat: NonNullable<Pane['chat']>) => NonNullable<Pane['chat']>,
    runtimeOnly = false,
  ) => {
    const currentChat = {
      messages: [],
      ...(paneRef.current.chat ?? {}),
    };
    const nextChat = updater(currentChat);

    paneRef.current = {
      ...paneRef.current,
      chat: nextChat,
    };

    const update = runtimeOnly ? updatePaneRuntime : updatePane;
    update(windowId, pane.id, { chat: nextChat });
  }, [pane.id, updatePane, updatePaneRuntime, windowId]);

  const refreshAggregatedSessions = useCallback(async () => {
    try {
      const cwd = linkedPane?.cwd || currentWindowCwd;
      const response = await window.electronAPI.listAggregatedSessions({
        cwd: cwd || undefined,
        limit: 24,
      });
      if (response.success && response.data) {
        setAggregatedSessions(response.data);
        persistChatState((currentChat) => ({
          ...currentChat,
          aggregatedSessions: response.data,
        }), true);
      }
    } catch (error) {
      console.error('Failed to load aggregated sessions:', error);
    }
  }, [currentWindowCwd, linkedPane?.cwd, persistChatState]);

  const refreshTaskArtifacts = useCallback(async (conversationId?: string) => {
    try {
      const response = await window.electronAPI.listTaskArtifacts({
        windowId,
        paneId: pane.id,
        conversationId,
      });
      if (response.success && response.data) {
        setTaskArtifacts(response.data);
        persistChatState((currentChat) => ({
          ...currentChat,
          artifacts: response.data,
        }), true);
      }
    } catch (error) {
      console.error('Failed to load task artifacts:', error);
    }
  }, [pane.id, persistChatState, windowId]);

  const syncAgentTask = useCallback((task: NonNullable<NonNullable<Pane['chat']>['agent']>) => {
    hasLiveTaskRef.current = true;
    setLiveAgentTask(task);
    const runtimeOnly = task.status === 'running';
    persistChatState((currentChat) => ({
      ...currentChat,
      agent: mergeAgentTaskWithOptimisticReasoning(task, currentChat.agent),
      messages: task.messages,
      activeProviderId: task.providerId,
      activeModel: task.model,
      linkedPaneId: task.linkedPaneId ?? currentChat.linkedPaneId,
      isStreaming: task.status === 'running',
    }), runtimeOnly);
  }, [persistChatState]);

  const syncRunningAgentTask = useCallback((task: NonNullable<NonNullable<Pane['chat']>['agent']>) => {
    hasLiveTaskRef.current = true;
    setLiveAgentTask(task);

    const currentChat = paneRef.current.chat;
    const needsRuntimeSync = currentChat?.activeProviderId !== task.providerId
      || currentChat?.activeModel !== task.model
      || currentChat?.linkedPaneId !== task.linkedPaneId
      || currentChat?.isStreaming !== true;

    if (!needsRuntimeSync) {
      return;
    }

    persistChatState((currentChat) => ({
      ...currentChat,
      activeProviderId: task.providerId,
      activeModel: task.model,
      linkedPaneId: task.linkedPaneId ?? currentChat.linkedPaneId,
      isStreaming: true,
    }), true);
  }, [persistChatState]);

  const resetCurrentAgentTask = useCallback(async (taskId?: string) => {
    if (!taskId) {
      return;
    }

    const response = await window.electronAPI.agentResetTask({
      paneId: pane.id,
      taskId,
    });
    if (!response.success) {
      throw new Error(response.error || 'Failed to reset agent task');
    }
  }, [pane.id]);

  const replaceConversationState = useCallback(({
    conversationId,
    messages,
    agent,
    activeProviderId,
    activeModel,
    linkedPaneId,
  }: {
    conversationId?: string;
    messages: ChatMessage[];
    agent?: AgentTaskSnapshot;
    activeProviderId?: string;
    activeModel?: string;
    linkedPaneId?: string;
  }) => {
    hasLiveTaskRef.current = false;
    setLiveAgentTask(null);
    setOptimisticTask(null);
    setErrorMessage(null);
    autoScrollPinnedRef.current = true;
    persistChatState((currentChat) => ({
      ...currentChat,
      conversationId,
      messages: cloneChatMessages(messages),
      agent,
      activeProviderId: activeProviderId ?? currentChat.activeProviderId,
      activeModel: activeModel ?? currentChat.activeModel,
      linkedPaneId: linkedPaneId ?? currentChat.linkedPaneId,
      isStreaming: false,
    }));
  }, [persistChatState]);

  const handleCopyMessage = useCallback(async (messageId: string, content: string) => {
    try {
      await copyTextToClipboard(content);
      setCopiedMessageId(messageId);
      if (copyResetTimerRef.current !== null) {
        window.clearTimeout(copyResetTimerRef.current);
      }
      copyResetTimerRef.current = window.setTimeout(() => {
        setCopiedMessageId((currentMessageId) => (
          currentMessageId === messageId ? null : currentMessageId
        ));
        copyResetTimerRef.current = null;
      }, 1200);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const handleRestoreConversation = useCallback(async (entry: ChatConversationHistoryEntry) => {
    if (isBusy) {
      return;
    }

    try {
      await resetCurrentAgentTask(agentState?.taskId);
      setComposerValue('');
      hasAttemptedHistoryHydrationRef.current = true;
      replaceConversationState({
        conversationId: entry.id,
        messages: entry.messages,
        agent: normalizeAgentSnapshotForHistory(entry.agent, pane.id, windowId),
        activeProviderId: entry.activeProviderId,
        activeModel: entry.activeModel,
        linkedPaneId: entry.linkedPaneId,
      });
      setHistoryMenuOpen(false);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }, [agentState?.taskId, isBusy, pane.id, replaceConversationState, resetCurrentAgentTask, windowId]);

  const handleRestoreAggregatedSession = useCallback(async (entry: AggregatedSessionEntry) => {
    if (isBusy) {
      return;
    }

    try {
      const response = await window.electronAPI.restoreAggregatedSession({ entryId: entry.id });
      if (!response.success || !response.data) {
        throw new Error(response.error || 'Failed to restore aggregated session');
      }

      await resetCurrentAgentTask(agentState?.taskId);
      setComposerValue('');
      hasAttemptedHistoryHydrationRef.current = true;
      replaceConversationState({
        conversationId: response.data.conversationId,
        messages: response.data.messages,
        agent: undefined,
        linkedPaneId: resolvedLinkedPaneId,
      });
      appendManualActivity({
        conversationId: response.data.conversationId,
        paneId: pane.id,
        windowId,
        kind: 'history-restored',
        title: t('chatPane.activityHistoryRestored'),
        message: entry.title,
        metadata: {
          source: entry.source,
          restoreKind: response.data.restoreKind,
        },
      });
      setHistoryMenuOpen(false);
      void refreshTaskArtifacts(response.data.conversationId);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }, [
    agentState?.taskId,
    appendManualActivity,
    isBusy,
    pane.id,
    refreshTaskArtifacts,
    replaceConversationState,
    resetCurrentAgentTask,
    resolvedLinkedPaneId,
    t,
    windowId,
  ]);

  const handleRollbackToMessage = useCallback(async (messageId: string, content: string) => {
    if (isBusy) {
      return;
    }

    const rollbackMessageIndex = chatState.messages.findIndex((message) => message.id === messageId);
    if (rollbackMessageIndex < 0) {
      return;
    }

    try {
      await resetCurrentAgentTask(agentState?.taskId);
      setComposerValue(content);
      hasAttemptedHistoryHydrationRef.current = true;
      const nextMessages = chatState.messages.slice(0, rollbackMessageIndex);
      const nextAgent = buildRollbackSnapshot(agentState ?? chatState.agent, messageId, pane.id, windowId);
      replaceConversationState({
        conversationId: nextMessages.length > 0 || nextAgent
          ? (chatState.conversationId ?? createChatConversationHistoryId())
          : undefined,
        messages: nextMessages,
        agent: nextAgent,
        linkedPaneId: resolvedLinkedPaneId,
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }, [
    agentState,
    chatState.agent,
    chatState.conversationId,
    chatState.messages,
    isBusy,
    pane.id,
    replaceConversationState,
    resetCurrentAgentTask,
    resolvedLinkedPaneId,
    windowId,
  ]);

  const loadSettings = useCallback(async () => {
    try {
      const response = await window.electronAPI.getSettings();
      if (response.success && response.data) {
        const normalized = normalizeChatSettings(response.data.chat);
        setSettings(mergeChatSettingsWithCanvasDefaults(normalized, canvasWorkspace));
      }
    } catch (error) {
      console.error('Failed to load chat settings:', error);
    } finally {
      setSettingsLoaded(true);
    }
  }, [canvasWorkspace?.chatDefaults?.contextFilePaths, canvasWorkspace?.chatDefaults?.workspaceInstructions]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    const handleSettingsUpdated = () => {
      void loadSettings();
    };

    window.addEventListener(WORKSPACE_SETTINGS_UPDATED_EVENT, handleSettingsUpdated);
    return () => {
      window.removeEventListener(WORKSPACE_SETTINGS_UPDATED_EVENT, handleSettingsUpdated);
    };
  }, [loadSettings]);

  useEffect(() => {
    refreshHistoryEntries();
  }, [refreshHistoryEntries]);

  useEffect(() => {
    void refreshAggregatedSessions();
  }, [refreshAggregatedSessions]);

  useEffect(() => {
    void refreshTaskArtifacts(currentConversationId);
  }, [currentConversationId, refreshTaskArtifacts]);

  useEffect(() => () => {
    if (copyResetTimerRef.current !== null) {
      window.clearTimeout(copyResetTimerRef.current);
      copyResetTimerRef.current = null;
    }
    if (checkpointSavedResetTimerRef.current !== null) {
      window.clearTimeout(checkpointSavedResetTimerRef.current);
      checkpointSavedResetTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!historyMenuOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (
        target
        && (historyMenuRef.current?.contains(target) || historyButtonRef.current?.contains(target))
      ) {
        return;
      }

      setHistoryMenuOpen(false);
    };

    window.addEventListener('mousedown', handlePointerDown);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
    };
  }, [historyMenuOpen]);

  useEffect(() => {
    if (hasAttemptedHistoryHydrationRef.current) {
      return;
    }

    if (hasConversationContent(chatState.messages, chatState.agent ?? agentState)) {
      hasAttemptedHistoryHydrationRef.current = true;
      return;
    }

    hasAttemptedHistoryHydrationRef.current = true;
    const latestEntry = getLatestChatConversationHistory(windowId);
    if (!latestEntry) {
      return;
    }

    replaceConversationState({
      conversationId: latestEntry.id,
      messages: latestEntry.messages,
      agent: normalizeAgentSnapshotForHistory(latestEntry.agent, pane.id, windowId),
      activeProviderId: latestEntry.activeProviderId,
      activeModel: latestEntry.activeModel,
      linkedPaneId: latestEntry.linkedPaneId,
    });
  }, [
    agentState,
    chatState.agent,
    chatState.messages,
    pane.id,
    replaceConversationState,
    windowId,
  ]);

  useEffect(() => {
    const conversationId = chatState.conversationId;
    const stableAgent = normalizeAgentSnapshotForHistory(chatState.agent ?? agentState, pane.id, windowId);
    if (!hasConversationContent(chatState.messages, stableAgent)) {
      refreshHistoryEntries();
      return;
    }

    if (!conversationId) {
      persistChatState((currentChat) => ({
        ...currentChat,
        conversationId: createChatConversationHistoryId(),
      }));
      return;
    }

    const referenceMessages = chatState.messages.length > 0
      ? chatState.messages
      : stableAgent?.messages ?? [];

    setHistoryEntries(upsertChatConversationHistory({
      id: conversationId,
      windowId,
      title: buildChatConversationTitle(referenceMessages),
      createdAt: stableAgent?.createdAt ?? referenceMessages[0]?.timestamp ?? new Date().toISOString(),
      updatedAt: stableAgent?.updatedAt ?? referenceMessages.at(-1)?.timestamp ?? new Date().toISOString(),
      linkedPaneId: chatState.linkedPaneId,
      activeProviderId: chatState.activeProviderId ?? stableAgent?.providerId,
      activeModel: chatState.activeModel ?? stableAgent?.model,
      messages: cloneChatMessages(referenceMessages),
      agent: stableAgent,
    }));
  }, [
    agentState,
    chatState.activeModel,
    chatState.activeProviderId,
    chatState.agent,
    chatState.conversationId,
    chatState.linkedPaneId,
    chatState.messages,
    pane.id,
    persistChatState,
    refreshHistoryEntries,
    windowId,
  ]);

  useEffect(() => {
    persistChatState((currentChat) => ({
      ...currentChat,
      activity: taskActivity,
      plan: {
        items: extractedPlan.items,
        updatedAt: extractedPlan.updatedAt,
        source: extractedPlan.source,
      },
    }), true);
  }, [extractedPlan.items, extractedPlan.source, extractedPlan.updatedAt, persistChatState, taskActivity]);

  const handleTranscriptScroll = useCallback(() => {
    const element = scrollContainerRef.current;
    if (!element) {
      return;
    }

    autoScrollPinnedRef.current = isScrollContainerNearBottom(element);
  }, []);

  useEffect(() => {
    if (!autoScrollPinnedRef.current) {
      return;
    }

    if (typeof window.requestAnimationFrame !== 'function') {
      const element = scrollContainerRef.current;
      if (element) {
        element.scrollTop = element.scrollHeight;
      }
      return;
    }

    if (autoScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(autoScrollFrameRef.current);
    }

    autoScrollFrameRef.current = window.requestAnimationFrame(() => {
      autoScrollFrameRef.current = null;
      const element = scrollContainerRef.current;
      if (!element || !autoScrollPinnedRef.current) {
        return;
      }

      element.scrollTop = element.scrollHeight;
    });

    return () => {
      if (autoScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(autoScrollFrameRef.current);
        autoScrollFrameRef.current = null;
      }
    };
  }, [agentState?.updatedAt, agentState?.status, chatState.messages.length]);

  useEffect(() => {
    const handleTaskState = (_event: unknown, payload: { paneId: string; task: NonNullable<NonNullable<Pane['chat']>['agent']> }) => {
      if (payload.paneId !== pane.id || !payload.task) {
        return;
      }

      setErrorMessage(payload.task.error ?? null);
      if (payload.task.status === 'running') {
        syncRunningAgentTask(payload.task);
      } else {
        syncAgentTask(payload.task);
      }
      if (payload.task.status === 'failed' && payload.task.error) {
        appendCanvasAgentError(payload.task.error, `${payload.task.taskId}:${payload.task.error}`);
      }
      setOptimisticTask((currentTask) => {
        if (!currentTask) {
          return null;
        }

        const keepOptimisticTask = payload.task.status === 'running'
          && !hasVisibleAgentProgress(payload.task.timeline);
        if (!keepOptimisticTask) {
          return null;
        }

        return {
          ...currentTask,
          taskId: payload.task.taskId,
          updatedAt: payload.task.updatedAt,
          providerId: payload.task.providerId,
          model: payload.task.model,
          linkedPaneId: payload.task.linkedPaneId,
          sshContext: payload.task.sshContext,
        };
      });
    };

    const handleTaskError = (_event: unknown, payload: { paneId: string; error: string }) => {
      if (payload.paneId !== pane.id) {
        return;
      }
      setErrorMessage(payload.error);
      appendCanvasAgentError(payload.error, `${pane.id}:${payload.error}`);
    };

    window.electronAPI.onAgentTaskState(handleTaskState);
    window.electronAPI.onAgentTaskError(handleTaskError);

    void window.electronAPI.agentGetTask({ paneId: pane.id }).then((response) => {
      if (response.success && response.data) {
        if (response.data.status === 'running') {
          syncRunningAgentTask(response.data);
        } else {
          syncAgentTask(response.data);
        }
      } else if (paneRef.current.chat?.agent && !isOptimisticAgentTask(paneRef.current.chat.agent)) {
        return window.electronAPI.agentRestoreTask({
          task: paneRef.current.chat.agent,
        }).then((restoreResponse) => {
          if (restoreResponse.success && restoreResponse.data) {
            syncAgentTask(restoreResponse.data);
          } else {
            hasLiveTaskRef.current = false;
          }
        });
      } else {
        hasLiveTaskRef.current = false;
      }
    }).catch((error) => {
      console.error('Failed to hydrate agent task:', error);
      hasLiveTaskRef.current = false;
    });

    return () => {
      window.electronAPI.offAgentTaskState(handleTaskState);
      window.electronAPI.offAgentTaskError(handleTaskError);
    };
  }, [appendCanvasAgentError, pane.id, syncAgentTask, syncRunningAgentTask]);

  const handleProviderModelChange = useCallback((value: string) => {
    if (!value) {
      persistChatState((currentChat) => ({
        ...currentChat,
        activeProviderId: undefined,
        activeModel: '',
      }));
      return;
    }

    const nextSelection = decodeProviderModelSelection(value);
    if (!nextSelection) {
      return;
    }

    persistChatState((currentChat) => ({
      ...currentChat,
      activeProviderId: nextSelection.providerId,
      activeModel: nextSelection.model,
    }));
  }, [persistChatState]);

  const handleNewConversation = useCallback(() => {
    if (isBusy) {
      return;
    }

    void (async () => {
      try {
        const response = await window.electronAPI.agentResetTask({
          paneId: pane.id,
          taskId: agentState?.taskId,
        });
        if (!response.success) {
          throw new Error(response.error || 'Failed to reset agent task');
        }

        setComposerValue('');
        setErrorMessage(null);
        hasLiveTaskRef.current = false;
        setLiveAgentTask(null);
        setOptimisticTask(null);
        hasAttemptedHistoryHydrationRef.current = true;
        persistChatState((currentChat) => ({
          ...currentChat,
          conversationId: undefined,
          messages: [],
          agent: undefined,
          artifacts: [],
          activity: [],
          plan: undefined,
          isStreaming: false,
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setErrorMessage(message);
      }
    })();
  }, [agentState?.taskId, isBusy, pane.id, persistChatState]);

  const handleCancelStreaming = useCallback(async () => {
    try {
      await window.electronAPI.agentCancel({
        paneId: pane.id,
        taskId: agentState?.taskId,
      });
    } catch (error) {
      console.error('Failed to cancel agent task:', error);
    }
  }, [agentState, pane.id]);

  const resolveContextFragments = useCallback((messageText: string): Promise<ChatContextFragment[]> => (
    resolveChatContextFragments(settings, messageText)
  ), [settings]);

  const handleSaveCheckpoint = useCallback(() => {
    const snapshotMessages = chatState.messages.length > 0
      ? cloneChatMessages(chatState.messages)
      : cloneChatMessages(agentState?.messages ?? []);
    const checkpoint = {
      id: createCheckpointId(),
      title: buildChatConversationTitle(snapshotMessages),
      createdAt: new Date().toISOString(),
      messages: snapshotMessages,
      agent: normalizeAgentSnapshotForHistory(agentState ?? chatState.agent, pane.id, windowId),
      composerValue,
      linkedPaneId: resolvedLinkedPaneId,
    };

    persistChatState((currentChat) => ({
      ...currentChat,
      checkpoints: [checkpoint, ...(currentChat.checkpoints ?? [])].slice(0, 20),
    }));
    setCheckpointSaved(true);
    if (checkpointSavedResetTimerRef.current !== null) {
      window.clearTimeout(checkpointSavedResetTimerRef.current);
    }
    checkpointSavedResetTimerRef.current = window.setTimeout(() => {
      setCheckpointSaved(false);
      checkpointSavedResetTimerRef.current = null;
    }, 1200);
    appendCanvasActivityEvent('checkpoint-saved', t('chatPane.activityCheckpointSaved'), checkpoint.title, {
      paneId: pane.id,
    });
  }, [
    appendCanvasActivityEvent,
    agentState,
    chatState.agent,
    chatState.messages,
    composerValue,
    pane.id,
    persistChatState,
    resolvedLinkedPaneId,
    t,
    windowId,
  ]);

  const handleRestoreCheckpoint = useCallback(async (checkpointId: string) => {
    const checkpoint = checkpoints.find((item) => item.id === checkpointId);
    if (!checkpoint || isBusy) {
      return;
    }

    try {
      await resetCurrentAgentTask(agentState?.taskId);
      setComposerValue(checkpoint.composerValue ?? '');
      replaceConversationState({
        conversationId: chatState.conversationId ?? createChatConversationHistoryId(),
        messages: checkpoint.messages,
        agent: normalizeAgentSnapshotForHistory(checkpoint.agent, pane.id, windowId),
        linkedPaneId: checkpoint.linkedPaneId,
      });
      setHistoryMenuOpen(false);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }, [
    agentState?.taskId,
    checkpoints,
    chatState.conversationId,
    isBusy,
    pane.id,
    replaceConversationState,
    resetCurrentAgentTask,
    windowId,
  ]);

  const handleSaveArtifact = useCallback(async () => {
    const transcriptMessages = chatState.messages.length > 0
      ? chatState.messages
      : agentState?.messages ?? [];
    if (transcriptMessages.length === 0 && !agentState) {
      return;
    }

    setArtifactSaving(true);
    try {
      const title = buildChatConversationTitle(transcriptMessages);
      const markdown = transcriptMessages
        .map((message) => `## ${message.role}\n\n${message.content}`)
        .join('\n\n');
      const response = await window.electronAPI.saveTaskArtifact({
        kind: 'conversation',
        title,
        windowId,
        paneId: pane.id,
        conversationId: currentConversationId,
        markdown,
        preview: title,
      });
      if (!response.success || !response.data) {
        throw new Error(response.error || 'Failed to save task artifact');
      }

      if (extractedPlan.items.length > 0) {
        await window.electronAPI.saveTaskArtifact({
          kind: 'plan',
          title: `${title} Plan`,
          windowId,
          paneId: pane.id,
          conversationId: currentConversationId,
          json: {
            items: extractedPlan.items,
            updatedAt: extractedPlan.updatedAt,
            source: extractedPlan.source,
          },
          preview: extractedPlan.items[0]?.text,
        });
      }

      appendManualActivity({
        conversationId: currentConversationId,
        paneId: pane.id,
        windowId,
        kind: 'artifact-saved',
        title: t('chatPane.activityArtifactSaved'),
        message: response.data.title,
        metadata: {
          artifactId: response.data.id,
          kind: response.data.kind,
        },
      });
      void refreshTaskArtifacts(currentConversationId);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setArtifactSaving(false);
    }
  }, [
    agentState,
    appendManualActivity,
    chatState.messages,
    currentConversationId,
    pane.id,
    refreshTaskArtifacts,
    t,
    windowId,
  ]);

  const handleDeleteArtifact = useCallback(async (artifactId: string) => {
    try {
      const response = await window.electronAPI.deleteTaskArtifact(artifactId);
      if (!response.success) {
        throw new Error(response.error || 'Failed to delete task artifact');
      }
      void refreshTaskArtifacts(currentConversationId);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }, [currentConversationId, refreshTaskArtifacts]);

  const resolveSshContext = useCallback(async (): Promise<ChatSshContext | undefined> => {
    if (!linkedPane || getPaneBackend(linkedPane) !== 'ssh' || !linkedPane.ssh) {
      return undefined;
    }

    const cwd = linkedPane.cwd || linkedPane.ssh.remoteCwd;
    const host = linkedPane.ssh.host?.trim();
    const user = linkedPane.ssh.user?.trim();
    if (host && user) {
      return {
        host,
        user,
        cwd,
        windowId,
        paneId: linkedPane.id,
      };
    }

    const profileId = linkedPane.ssh.profileId?.trim();
    if (!profileId) {
      return undefined;
    }

    const profileResponse = await window.electronAPI.getSSHProfile(profileId);
    if (!profileResponse.success || !profileResponse.data) {
      throw new Error(profileResponse.error || 'Linked SSH profile could not be loaded.');
    }

    return {
      host: profileResponse.data.host,
      user: profileResponse.data.user,
      cwd,
      windowId: linkedPaneEntry?.windowId ?? windowId,
      paneId: linkedPane.id,
    };
  }, [linkedPane, linkedPaneEntry?.windowId, windowId]);

  const handleSend = useCallback(async () => {
    const trimmed = composerValue.trim();
    if (!trimmed || !selectedProvider || !selectedModel || isBusy) {
      return;
    }

    const previousHasLiveTask = hasLiveTaskRef.current;
    const conversationId = chatState.conversationId ?? createChatConversationHistoryId();
    const previousChat = {
      ...chatState,
      messages: cloneChatMessages(chatState.messages),
      agent: agentState,
    };
    const seedMessages = hasLiveTaskRef.current ? undefined : chatState.messages;
    const optimisticTask = buildOptimisticAgentTask({
      windowId,
      paneId: pane.id,
      providerId: selectedProvider.id,
      model: selectedModel,
      text: trimmed,
      linkedPaneId: resolvedLinkedPaneId,
      sshContext: optimisticSshContext,
      previousMessages: chatState.messages,
      previousTask: agentState,
    });

    setComposerValue('');
    setErrorMessage(null);
    autoScrollPinnedRef.current = true;
    hasAttemptedHistoryHydrationRef.current = true;
    setLiveAgentTask(optimisticTask);
    setOptimisticTask(optimisticTask);
    lastCanvasErrorSignatureRef.current = null;
    persistChatState((currentChat) => ({
      ...currentChat,
      conversationId,
      messages: optimisticTask.messages,
      agent: optimisticTask,
      activeProviderId: selectedProvider.id,
      activeModel: selectedModel,
      linkedPaneId: resolvedLinkedPaneId,
      isStreaming: true,
    }), true);
    appendCanvasActivityEvent('chat-sent', t('chatPane.activityChatSent'), truncateActivityMessage(trimmed), {
      paneId: pane.id,
    });

    let sshContext: ChatSshContext | undefined;
    try {
      const contextFragments = await resolveContextFragments(trimmed);
      sshContext = await resolveSshContext();
      const systemPrompt = buildChatSystemPrompt(settings);

      persistChatState((currentChat) => ({
        ...currentChat,
        contextFragments,
      }), true);

      const response = await window.electronAPI.agentSend({
        paneId: pane.id,
        windowId,
        text: trimmed,
        providerId: selectedProvider.id,
        model: selectedModel,
        systemPrompt,
        enableTools: Boolean(sshContext),
        linkedPaneId: resolvedLinkedPaneId,
        sshContext,
        contextFragments,
        seedMessages,
      });

      if (!response.success) {
        throw new Error(response.error || t('chatPane.sendFailed'));
      }

      hasLiveTaskRef.current = true;
      const responseData = response.data;
      if (responseData?.taskId) {
        setOptimisticTask((currentTask) => (currentTask
          ? {
              ...currentTask,
              taskId: responseData.taskId,
              status: responseData.status ?? currentTask.status,
              updatedAt: new Date().toISOString(),
            }
          : currentTask));
        persistChatState((currentChat) => {
          if (!currentChat.agent) {
            return currentChat;
          }

          return {
            ...currentChat,
            agent: {
              ...currentChat.agent,
              taskId: responseData.taskId,
              status: responseData.status ?? currentChat.agent.status,
            },
          };
        }, true);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setErrorMessage(message);
      appendCanvasAgentError(message, `send:${message}`);
      hasLiveTaskRef.current = previousHasLiveTask;
      setLiveAgentTask(null);
      setOptimisticTask(null);
      persistChatState(() => ({
        ...previousChat,
        isStreaming: false,
      }), true);
    }
  }, [
    agentState,
    chatState.conversationId,
    chatState.messages,
    composerValue,
    isBusy,
    linkedPane,
    pane.id,
    appendCanvasActivityEvent,
    appendCanvasAgentError,
    persistChatState,
    resolvedLinkedPaneId,
    resolveSshContext,
    selectedModel,
    selectedProvider,
    settings.defaultSystemPrompt,
    settings.workspaceInstructions,
    optimisticSshContext,
    resolveContextFragments,
    t,
    windowId,
  ]);

  const handleComposerKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  }, [handleSend]);

  const handleApprovalResponse = useCallback((approvalId: string, approved: boolean) => {
    if (!agentState) {
      return;
    }

    void window.electronAPI.agentRespondApproval({
      paneId: pane.id,
      taskId: agentState.taskId,
      approvalId,
      approved,
    });
  }, [agentState, pane.id]);

  const handleSubmitInteraction = useCallback((interactionId: string, value: string) => {
    if (!agentState) {
      return;
    }

    void window.electronAPI.agentSubmitInteraction({
      paneId: pane.id,
      taskId: agentState.taskId,
      interactionId,
      input: value,
    });
  }, [agentState, pane.id]);

  const handleCancelInteraction = useCallback((interactionId: string) => {
    if (!agentState) {
      return;
    }

    void window.electronAPI.agentSubmitInteraction({
      paneId: pane.id,
      taskId: agentState.taskId,
      interactionId,
      cancel: true,
    });
  }, [agentState, pane.id]);

  const providerModelOptions = useMemo(() => (
    buildProviderModelOptions(providers, selectedProvider?.id, selectedModel)
  ), [providers, selectedModel, selectedProvider?.id]);
  const legacyUserRoundById = useMemo(() => {
    const rounds = new Map<string, number>();
    let round = 0;
    for (const message of chatState.messages) {
      if (message.role !== 'user' || message.toolResult) {
        continue;
      }

      round += 1;
      rounds.set(message.id, round);
    }

    return rounds;
  }, [chatState.messages]);

  const assistantLabel = t('chatPane.agentName');
  const copyMessageLabel = t('chatPane.copyMessage');
  const copiedMessageLabel = t('chatPane.copied');
  const canSaveCheckpoint = !isBusy && (chatState.messages.length > 0 || Boolean(agentState?.messages.length));
  const canSaveArtifact = !artifactSaving && (chatState.messages.length > 0 || Boolean(agentState?.messages.length));
  const checkpointButtonLabel = !canSaveCheckpoint
    ? t('chatPane.saveCheckpointDisabled')
    : checkpointSaved
      ? t('chatPane.checkpointSaved')
      : t('chatPane.saveCheckpoint');
  const artifactButtonLabel = canSaveArtifact
    ? t('chatPane.saveArtifact')
    : t('chatPane.saveArtifactDisabled');
  const sshConnected = hasExecutableLinkedSsh;
  const sshSignalTitle = sshConnected ? t('chatPane.sshConnected') : t('chatPane.sshDisconnected');
  const planStatusLabels: Record<NonNullable<typeof extractedPlan.items[number]>['status'], string> = {
    pending: t('chatPane.planStatus.pending'),
    running: t('chatPane.planStatus.running'),
    completed: t('chatPane.planStatus.completed'),
    blocked: t('chatPane.planStatus.blocked'),
    cancelled: t('chatPane.planStatus.cancelled'),
  };
  const emptyConversationTarget = resolveEmptyConversationTarget(currentWindow?.name, linkedPane)
    ?? t('chatPane.emptyWritingFallback');
  const hasEnhancementSummary = aggregatedSessions.length > 0 || taskArtifacts.length > 0 || taskActivity.length > 0;

  return (
    <div
      data-testid="chat-pane-root"
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
      style={{
        backgroundColor: 'var(--appearance-pane-background)',
      }}
      onMouseDown={onActivate}
    >
      <div
        className="border-b border-[rgb(var(--border))] px-3 py-2"
        style={{
          backgroundColor: 'var(--appearance-pane-chrome-background)',
        }}
      >
        <div className="mx-auto flex w-full max-w-[860px] items-center justify-between gap-3">
          <div className="min-w-0 flex items-center gap-2.5">
            <div
              role="status"
              aria-label={sshSignalTitle}
              title={sshSignalTitle}
              className="inline-flex h-6 items-center rounded-full border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--secondary))_72%,transparent)] px-2"
            >
              <span
                className={`h-2.5 w-2.5 rounded-full ${sshConnected ? 'bg-[rgb(var(--success))] shadow-[0_0_8px_rgba(22,198,12,0.45)]' : 'bg-[rgb(var(--destructive))] shadow-[0_0_8px_rgba(231,72,86,0.38)]'}`}
                aria-hidden="true"
              />
            </div>
            <span className="truncate text-[13px] font-semibold tracking-[0.02em] text-[rgb(var(--foreground))]">
              {t('chatPane.title')}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <div className="relative">
              <AppTooltip content={t('chatPane.history')} placement="pane-corner">
                <span className="inline-flex">
                  <button
                    ref={historyButtonRef}
                    type="button"
                    tabIndex={-1}
                    aria-label={t('chatPane.history')}
                    onMouseDown={preventMouseButtonFocus}
                    onClick={() => setHistoryMenuOpen((open) => !open)}
                    className={chatHeaderIconButtonClassName}
                  >
                    <History size={CHAT_HEADER_ICON_SIZE} strokeWidth={1.9} />
                  </button>
                </span>
              </AppTooltip>

              {historyMenuOpen ? (
                <div
                  ref={historyMenuRef}
                  className={`absolute right-0 top-[calc(100%+10px)] z-30 w-[320px] overflow-hidden rounded-[20px] p-2 ${idePopupSelectContentClassName}`}
                >
                  <div className="px-2 pb-2 pt-1 text-[11px] font-medium tracking-[0.08em] text-[rgb(var(--muted-foreground))]">
                    {t('chatPane.history')}
                  </div>
                  {historyEntries.length > 0 || checkpoints.length > 0 || aggregatedSessions.length > 0 ? (
                    <div className="max-h-[360px] space-y-3 overflow-y-auto">
                      {historyEntries.length > 0 ? (
                        <div className="space-y-1">
                          {historyEntries.map((entry) => {
                            const isCurrentConversation = entry.id === chatState.conversationId;
                            return (
                              <button
                                key={entry.id}
                                type="button"
                                onClick={() => {
                                  void handleRestoreConversation(entry);
                                }}
                                className={`flex w-full flex-col rounded-[16px] px-3 py-2.5 text-left transition-colors ${isCurrentConversation ? 'bg-[color-mix(in_srgb,rgb(var(--secondary))_72%,transparent)] text-[rgb(var(--foreground))]' : 'text-[rgb(var(--foreground))] hover:bg-[rgb(var(--accent))]'}`}
                              >
                                <span className="truncate text-[13px] font-medium leading-5">
                                  {entry.title}
                                </span>
                                <span className="mt-1 text-[11px] leading-5 text-[rgb(var(--muted-foreground))]">
                                  {formatHistoryTimestamp(entry.updatedAt)}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                      {aggregatedSessions.length > 0 ? (
                        <div className="space-y-1">
                          <div className="px-2 pb-1 pt-1 text-[11px] font-medium tracking-[0.08em] text-[rgb(var(--muted-foreground))]">
                            {t('chatPane.aggregatedSessions')}
                          </div>
                          {aggregatedSessions.map((entry) => (
                            <button
                              key={entry.id}
                              type="button"
                              onClick={() => {
                                void handleRestoreAggregatedSession(entry);
                              }}
                              className="flex w-full items-start justify-between gap-3 rounded-[16px] px-3 py-2.5 text-left text-[rgb(var(--foreground))] transition-colors hover:bg-[rgb(var(--accent))]"
                            >
                              <div className="min-w-0">
                                <div className="truncate text-[13px] font-medium leading-5">
                                  {entry.title}
                                </div>
                                <div className="mt-1 text-[11px] leading-5 text-[rgb(var(--muted-foreground))]">
                                  {entry.sourceLabel} · {formatHistoryTimestamp(new Date(entry.updatedAt).toISOString())}
                                </div>
                                {entry.preview ? (
                                  <div className="mt-1 line-clamp-2 text-[11px] leading-5 text-[rgb(var(--muted-foreground))]">
                                    {entry.preview}
                                  </div>
                                ) : null}
                              </div>
                              <div className="shrink-0 text-[11px] leading-5 text-[rgb(var(--muted-foreground))]">
                                {t('chatPane.restoreHistory')}
                              </div>
                            </button>
                          ))}
                        </div>
                      ) : null}
                      {checkpoints.length > 0 ? (
                        <div className="space-y-1">
                          <div className="px-2 pb-1 pt-1 text-[11px] font-medium tracking-[0.08em] text-[rgb(var(--muted-foreground))]">
                            {t('chatPane.checkpoints')}
                          </div>
                          {checkpoints.map((checkpoint) => (
                            <button
                              key={checkpoint.id}
                              type="button"
                              onClick={() => {
                                void handleRestoreCheckpoint(checkpoint.id);
                              }}
                              className="flex w-full items-center justify-between gap-3 rounded-[16px] px-3 py-2.5 text-left text-[rgb(var(--foreground))] transition-colors hover:bg-[rgb(var(--accent))]"
                            >
                              <div className="min-w-0">
                                <div className="truncate text-[13px] font-medium leading-5">
                                  {checkpoint.title}
                                </div>
                                <div className="mt-1 text-[11px] leading-5 text-[rgb(var(--muted-foreground))]">
                                  {formatHistoryTimestamp(checkpoint.createdAt)}
                                </div>
                              </div>
                              <div className="shrink-0 text-[11px] leading-5 text-[rgb(var(--muted-foreground))]">
                                {t('chatPane.restoreCheckpoint')}
                              </div>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="rounded-[16px] px-3 py-3 text-sm leading-6 text-[rgb(var(--muted-foreground))]">
                      {t('chatPane.historyEmpty')}
                    </div>
                  )}
                </div>
              ) : null}
            </div>

            <AppTooltip content={t('chatPane.newConversation')} placement="pane-corner">
              <span className="inline-flex">
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={t('chatPane.newConversation')}
                  onMouseDown={preventMouseButtonFocus}
                  onClick={handleNewConversation}
                  disabled={isBusy}
                  className={`${chatHeaderIconButtonClassName} ${isBusy ? 'pointer-events-none' : ''}`}
                >
                  <MessageSquarePlus size={CHAT_HEADER_ICON_SIZE} strokeWidth={1.9} />
                </button>
              </span>
            </AppTooltip>

            <AppTooltip content={checkpointButtonLabel} placement="pane-corner">
              <span className="inline-flex">
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={checkpointButtonLabel}
                  onMouseDown={preventMouseButtonFocus}
                  onClick={handleSaveCheckpoint}
                  disabled={!canSaveCheckpoint}
                  className={`${chatHeaderIconButtonClassName} ${!canSaveCheckpoint ? 'pointer-events-none' : ''}`}
                >
                  {checkpointSaved ? (
                    <BookmarkCheck size={CHAT_HEADER_ICON_SIZE} strokeWidth={1.9} />
                  ) : (
                    <Bookmark size={CHAT_HEADER_ICON_SIZE} strokeWidth={1.9} />
                  )}
                </button>
              </span>
            </AppTooltip>

            <AppTooltip content={artifactButtonLabel} placement="pane-corner">
              <span className="inline-flex">
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={artifactButtonLabel}
                  onMouseDown={preventMouseButtonFocus}
                  onClick={() => {
                    void handleSaveArtifact();
                  }}
                  disabled={!canSaveArtifact}
                  className={`${chatHeaderIconButtonClassName} ${!canSaveArtifact ? 'pointer-events-none' : ''}`}
                >
                  <Archive size={CHAT_HEADER_ICON_SIZE} strokeWidth={1.9} />
                </button>
              </span>
            </AppTooltip>

            <AppTooltip content={t('chatPane.plan')} placement="pane-corner">
              <span className="inline-flex">
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={t('chatPane.plan')}
                  onMouseDown={preventMouseButtonFocus}
                  onClick={() => setPlanPaneOpen((open) => !open)}
                  className={chatHeaderIconButtonClassName}
                >
                  <ListTodo size={CHAT_HEADER_ICON_SIZE} strokeWidth={1.9} />
                </button>
              </span>
            </AppTooltip>

            {onClose && (
              <AppTooltip content={t('common.close')} placement="pane-corner">
                <span className="inline-flex">
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label={t('common.close')}
                    onMouseDown={preventMouseButtonFocus}
                    onClick={onClose}
                    className={chatHeaderIconButtonClassName}
                  >
                    <X size={CHAT_HEADER_ICON_SIZE} strokeWidth={1.9} />
                  </button>
                </span>
              </AppTooltip>
            )}
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-y-auto px-4 pb-4 pt-1"
          onScroll={handleTranscriptScroll}
        >
          <div className="mx-auto flex min-h-full w-full max-w-[860px] flex-col">
            {hasEnhancementSummary ? (
              <div className="pb-4 pt-3">
                <div className={`${idePopupCardClassName} rounded-[20px] px-4 py-3`}>
                  <button
                    type="button"
                    onClick={() => setEnhancementSummaryOpen((open) => !open)}
                    className="flex w-full items-center justify-between gap-3 text-left"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-semibold uppercase tracking-[0.08em] text-[rgb(var(--muted-foreground))]">
                        {t('chatPane.workspaceEnhancements')}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-2 text-xs text-[rgb(var(--muted-foreground))]">
                        {taskActivity.length > 0 ? <span>{t('chatPane.activityCount', { count: taskActivity.length })}</span> : null}
                        {taskArtifacts.length > 0 ? <span>{t('chatPane.artifactCount', { count: taskArtifacts.length })}</span> : null}
                        {aggregatedSessions.length > 0 ? <span>{t('chatPane.aggregatedSessionCount', { count: aggregatedSessions.length })}</span> : null}
                      </div>
                    </div>
                    <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[rgb(var(--border))] text-[rgb(var(--muted-foreground))]">
                      {enhancementSummaryOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </span>
                  </button>

                  {enhancementSummaryOpen ? (
                    <div className="mt-3 space-y-3">
                      {taskActivity.length > 0 ? (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-xs font-semibold uppercase tracking-[0.08em] text-[rgb(var(--muted-foreground))]">
                              {t('chatPane.activity')}
                            </div>
                            <div className="text-xs text-[rgb(var(--muted-foreground))]">
                              {t('chatPane.activityCount', { count: taskActivity.length })}
                            </div>
                          </div>
                          {taskActivity.slice(-4).map((event) => (
                            <div key={event.id} className="rounded-[16px] border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--secondary))_54%,transparent)] px-3 py-2.5">
                              <div className="flex items-center justify-between gap-3">
                                <div className="truncate text-sm font-medium text-[rgb(var(--foreground))]">{event.title}</div>
                                <div className="shrink-0 text-[11px] text-[rgb(var(--muted-foreground))]">
                                  {formatHistoryTimestamp(event.timestamp)}
                                </div>
                              </div>
                              {event.message ? (
                                <div className="mt-1 text-xs leading-5 text-[rgb(var(--muted-foreground))]">
                                  {event.message}
                                </div>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      ) : null}

                      {taskArtifacts.length > 0 ? (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-xs font-semibold uppercase tracking-[0.08em] text-[rgb(var(--muted-foreground))]">
                              {t('chatPane.artifacts')}
                            </div>
                            <div className="text-xs text-[rgb(var(--muted-foreground))]">
                              {t('chatPane.artifactCount', { count: taskArtifacts.length })}
                            </div>
                          </div>
                          {taskArtifacts.slice(0, 3).map((artifact) => (
                            <div key={artifact.id} className="flex items-center justify-between gap-3 rounded-[16px] border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--secondary))_54%,transparent)] px-3 py-2.5">
                              <div className="min-w-0">
                                <div className="truncate text-sm font-medium text-[rgb(var(--foreground))]">{artifact.title}</div>
                                <div className="mt-1 text-xs text-[rgb(var(--muted-foreground))]">
                                  {formatHistoryTimestamp(artifact.createdAt)}
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    void window.electronAPI.openFolder(artifact.filePath);
                                  }}
                                  className={`${idePopupSecondaryButtonClassName} inline-flex h-8 items-center gap-1 rounded-[12px] px-3 text-xs`}
                                >
                                  <FolderOpen size={13} />
                                  {t('common.open')}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    void handleDeleteArtifact(artifact.id);
                                  }}
                                  className={`${idePopupSecondaryButtonClassName} inline-flex h-8 items-center rounded-[12px] px-3 text-xs`}
                                >
                                  {t('common.delete')}
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          {!settingsLoaded ? (
            <div className={`${idePopupCardClassName} rounded-[24px] px-5 py-4 text-sm text-[rgb(var(--muted-foreground))]`}>
              {t('common.loading')}
            </div>
          ) : providers.length === 0 ? (
            <div className="flex gap-3 pt-6">
              <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-[18px] border border-[rgb(var(--border))] bg-[rgb(var(--accent))] text-[rgb(var(--primary))]">
                <Sparkles size={15} />
              </div>
              <div className="max-w-3xl">
                <div className="inline-flex items-center rounded-full border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--secondary))_72%,transparent)] px-3 py-1 text-xs font-medium text-[rgb(var(--muted-foreground))]">
                  {assistantLabel}
                </div>
                <div className="mt-4 text-[15px] leading-7 text-[rgb(var(--foreground))]">{t('chatPane.noProviderTitle')}</div>
                <p className="mt-2 text-sm leading-7 text-[rgb(var(--muted-foreground))]">{t('chatPane.noProviderDescription')}</p>
              </div>
            </div>
          ) : checkpoints.length > 0 && !agentState && chatState.messages.length === 0 ? (
            <div className="space-y-3 pt-4">
              {checkpoints.map((checkpoint) => (
                <button
                  key={checkpoint.id}
                  type="button"
                  onClick={() => {
                    void handleRestoreCheckpoint(checkpoint.id);
                  }}
                  className={`${idePopupCardClassName} flex w-full items-center justify-between rounded-[20px] px-4 py-3 text-left transition-colors hover:bg-[rgb(var(--accent))]`}
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-[rgb(var(--foreground))]">{checkpoint.title}</div>
                    <div className="mt-1 text-xs text-[rgb(var(--muted-foreground))]">{formatHistoryTimestamp(checkpoint.createdAt)}</div>
                  </div>
                  <div className="text-xs text-[rgb(var(--muted-foreground))]">
                    {t('chatPane.restoreCheckpoint')}
                  </div>
                </button>
              ))}
            </div>
          ) : agentState ? (
            <>
              <AgentTimeline
                task={agentState}
                assistantLabel={assistantLabel}
                copiedMessageId={copiedMessageId}
                copyMessageLabel={copyMessageLabel}
                copiedMessageLabel={copiedMessageLabel}
                onApprove={(approvalId) => handleApprovalResponse(approvalId, true)}
                onReject={(approvalId) => handleApprovalResponse(approvalId, false)}
                onSubmitInteraction={handleSubmitInteraction}
                onCancelInteraction={handleCancelInteraction}
                onCopyMessage={handleCopyMessage}
                onRollbackMessage={handleRollbackToMessage}
                rollbackLabelFormatter={(round) => t('chatPane.rollbackToRound', { round })}
              />
            </>
          ) : chatState.messages.length > 0 ? (
            <div className="space-y-6 pt-4">
              {chatState.messages.map((message, index) => (
                <div key={message.id}>
                  {renderLegacyMessage(message, {
                    copied: copiedMessageId === message.id,
                    copyLabel: copiedMessageId === message.id ? copiedMessageLabel : copyMessageLabel,
                    rollbackLabel: message.role === 'user'
                      ? t('chatPane.rollbackToRound', { round: legacyUserRoundById.get(message.id) ?? index + 1 })
                      : undefined,
                    onCopy: () => {
                      void handleCopyMessage(message.id, message.content);
                    },
                    onRollback: message.role === 'user'
                      ? () => {
                          void handleRollbackToMessage(message.id, message.content);
                        }
                      : undefined,
                  })}
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center py-10">
              <div className="flex max-w-[520px] flex-col items-center text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-[20px] border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--secondary))_72%,transparent)] text-[rgb(var(--foreground))] shadow-[0_18px_45px_-28px_rgba(0,0,0,0.9)]">
                  <Sparkles size={18} />
                </div>
                <div className="mt-6 text-[28px] font-semibold tracking-[-0.03em] text-[rgb(var(--foreground))] sm:text-[32px]">
                  {t('chatPane.emptyWritingWithAi', { target: emptyConversationTarget })}
                </div>
                <p className="mt-3 max-w-[420px] text-sm leading-7 text-[rgb(var(--muted-foreground))]">
                  {sshConnected ? t('chatPane.emptyDescriptionLinked') : t('chatPane.emptyDescription')}
                </p>
              </div>
            </div>
          )}
        </div>
        </div>

        {planPaneOpen ? (
          <TaskPlanPane
            items={extractedPlan.items}
            updatedAt={extractedPlan.updatedAt}
            onClose={() => setPlanPaneOpen(false)}
            title={t('chatPane.closePlan')}
            emptyLabel={t('chatPane.planEmpty')}
            badgeLabel={t('chatPane.planBadge')}
            statusLabelFormatter={(status) => planStatusLabels[status]}
          />
        ) : null}
      </div>

      <div className="px-4 pb-4 pt-2">
        <div className="mx-auto w-full max-w-[860px]">
          {errorMessage && (
            <div className="mb-3 rounded-[20px] border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {errorMessage}
            </div>
          )}

          <div className={`${idePopupCardClassName} rounded-[24px] p-2.5 shadow-[0_24px_50px_-38px_rgba(0,0,0,0.98)]`}>
            <textarea
              value={composerValue}
              onChange={(event) => setComposerValue(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder={providers.length === 0 ? t('chatPane.disabledPlaceholder') : t('chatPane.inputPlaceholder')}
              disabled={!providers.length || isBusy}
              rows={3}
              className="max-h-[168px] min-h-[72px] w-full resize-none bg-transparent px-2 py-1.5 text-[14px] leading-6 text-[rgb(var(--foreground))] outline-none placeholder:text-[rgb(var(--muted-foreground))] disabled:cursor-not-allowed disabled:opacity-60"
            />

            <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 flex-1 items-center justify-start">
                <ControlSelect
                  ariaLabel={t('chatPane.providerModelLabel')}
                  value={selectedProviderModelValue}
                  onChange={handleProviderModelChange}
                  disabled={!providers.length}
                  minWidthClass="w-full sm:w-fit sm:min-w-[220px] sm:max-w-[280px]"
                >
                  <option value="">{t('chatPane.providerModelPlaceholder')}</option>
                  {providerModelOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </ControlSelect>
              </div>

              <div className="flex items-center justify-end">
                {isBusy ? (
                  <button
                    type="button"
                    onClick={() => {
                      void handleCancelStreaming();
                    }}
                    className={`${idePopupSecondaryButtonClassName} inline-flex h-9 items-center gap-2 rounded-[16px] px-4 text-sm font-medium`}
                  >
                    <Square size={12} />
                    {t('chatPane.cancel')}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      void handleSend();
                    }}
                    disabled={!canSend || !composerValue.trim()}
                    className="inline-flex h-9 items-center gap-2 rounded-[16px] bg-[rgb(var(--primary))] px-4 text-sm font-medium text-[rgb(var(--primary-foreground))] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <SendHorizonal size={14} />
                    {t('chatPane.send')}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
