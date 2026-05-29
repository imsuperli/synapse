import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Activity, Link2, MonitorSmartphone, Save, Square, StickyNote } from 'lucide-react';
import { AppLanguage } from '../../shared/i18n';
import {
  CanvasActivityEvent,
  CanvasBlock,
  CanvasBlockLink,
  CanvasNoteBlock,
  CanvasWindowBlock,
  CanvasWorkspace,
} from '../../shared/types/canvas';
import type { AgentTaskSnapshot } from '../../shared/types/agent';
import type { ChatContextFragment, ChatMessage, ChatSettings, ChatSshContext } from '../../shared/types/chat';
import type { SSHProfile } from '../../shared/types/ssh';
import { getPaneBackend, getWindowKind, isTerminalPane } from '../../shared/utils/terminalCapabilities';
import { formatRelativeTime, useI18n } from '../i18n';
import { useWindowStore } from '../stores/windowStore';
import type { Pane, Window } from '../types/window';
import { getAllPanes, getAggregatedStatus } from '../utils/layoutHelpers';
import { getStatusLabelKey } from '../utils/statusHelpers';
import {
  arrangeCanvasBlocks,
  buildCanvasLinkGeometry,
  type CanvasArrangeMode,
  type CanvasRect,
  type CanvasResizeDirection,
  clampZoom,
  DEFAULT_NOTE_BLOCK_SIZE,
  fitViewportToBlocks,
  findCanvasWindowInsertRect,
  getCanvasBounds,
  getCanvasLiveWindowBlockSize,
  getCanvasWindowBlockSize,
  getIntersectingCanvasBlockIds,
  getWorldPointFromClient,
  moveCanvasBlocks,
  normalizeCanvasRect,
  resizeCanvasBlock,
} from '../utils/canvasWorkspace';
import {
  createTemplateFromWorkspace,
  createDefaultCanvasTemplates,
  findCanvasTemplateInsertOffset,
  instantiateCanvasWorkspaceFromTemplate,
  mergeCanvasWorkspaceContents,
  reconcileCanvasWorkspaceTemplates,
} from '../utils/canvasTemplates';
import { createCanvasWindowDraft } from '../utils/canvasWindowFactory';
import { buildCanvasBlockSummary, buildSelectedCanvasContext, exportCanvasWorkspaceReport, serializeCanvasBlockEvidence } from '../utils/canvasInsights';
import { dispatchAppError, dispatchAppSuccess } from '../utils/appNotice';
import { getSmartBrowserSplitDirection } from '../utils/browserPane';
import { createChatPaneDraft, selectPreferredChatLinkedPaneId } from '../utils/chatPane';
import {
  buildChatSystemPrompt,
  mergeChatSettingsWithCanvasDefaults,
  normalizeChatSettings,
  resolveChatContextFragments,
} from '../utils/chatContext';
import { createChatConversationHistoryId } from '../utils/chatHistory';
import { getCurrentWindowWorkingDirectory } from '../utils/windowWorkingDirectory';
import { startWindowPanes } from '../utils/paneSessionActions';
import { isInactiveTerminalPaneStatus } from '../utils/windowLifecycle';
import { isStandaloneWindow } from '../utils/sshWindowBindings';
import { CanvasArrangeToolbar } from './CanvasArrangeToolbar';
import { CanvasBlockChrome } from './CanvasBlockChrome';
import { CanvasCreateBlockDialog } from './CanvasCreateBlockDialog';
import { CanvasMinimap } from './CanvasMinimap';
import { CanvasWindowPickerDialog } from './CanvasWindowPickerDialog';
import { CUSTOM_TITLEBAR_ACTIONS_SLOT_ID } from './CustomTitleBar';
import { Dialog } from './ui/Dialog';
import { AppTooltip } from './ui/AppTooltip';
import {
  idePopupActionButtonClassName,
  idePopupCardClassName,
  idePopupInputClassName,
  idePopupSecondaryButtonClassName,
} from './ui/ide-popup';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { useKeyboardShortcutSettings } from '../hooks/useKeyboardShortcutSettings';
import { preventMouseButtonFocus } from '../utils/buttonFocus';
import { destroyWindowResourcesAndRemoveRecord } from '../utils/windowDestruction';

const LazyQuickSwitcher = React.lazy(async () => ({
  default: (await import('./QuickSwitcher')).QuickSwitcher,
}));

interface CanvasWorkspaceViewProps {
  canvasWorkspace: CanvasWorkspace;
  sshProfiles?: SSHProfile[];
  onOpenWindow?: (windowId: string) => void;
  onOpenCanvasWorkspace?: (canvasWorkspaceId: string) => void;
  onOpenGroup?: (groupId: string) => void;
  onSelectSSHProfile?: (profile: SSHProfile) => void | Promise<void>;
  renderLiveWindow?: (windowId: string, options: { blockId: string; isActive: boolean }) => React.ReactNode;
  onStopWorkspace?: (canvasWorkspaceId: string) => void | Promise<void>;
}

type DragState =
  | {
      type: 'pan';
      startClientX: number;
      startClientY: number;
      initialViewport: CanvasWorkspace['viewport'];
    }
  | {
      type: 'move';
      startClientX: number;
      startClientY: number;
      blockIds: string[];
      initialPositions: Record<string, { x: number; y: number }>;
    }
  | {
      type: 'resize';
      startClientX: number;
      startClientY: number;
      blockId: string;
      direction: CanvasResizeDirection;
      initialBlock: CanvasBlock;
    }
  | {
      type: 'select';
      startWorldX: number;
      startWorldY: number;
      currentWorldX: number;
      currentWorldY: number;
      baseSelection: string[];
      additive: boolean;
    }
  | null;

function createCanvasBlockId(prefix: 'note' | 'window'): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createCanvasLinkId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `link-${crypto.randomUUID()}`;
  }

  return `link-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createMessageId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const CHAT_PANE_DEFAULT_SPLIT_SIZES: [number, number] = [0.7, 0.3];

function inferCanvasLinkKind(fromBlock: CanvasBlock, toBlock: CanvasBlock): CanvasBlockLink['kind'] {
  if (fromBlock.type === 'note' && toBlock.type === 'window') {
    return 'evidence';
  }

  if (fromBlock.type === 'window' && toBlock.type === 'note') {
    return 'context';
  }

  return 'related';
}

function createOptimisticAgentTask(options: {
  taskId: string;
  paneId: string;
  windowId: string;
  providerId: string;
  model: string;
  linkedPaneId?: string;
  sshContext?: ChatSshContext;
  messages: ChatMessage[];
}): AgentTaskSnapshot {
  const timestamp = new Date().toISOString();
  return {
    taskId: options.taskId,
    paneId: options.paneId,
    windowId: options.windowId,
    status: 'running',
    providerId: options.providerId,
    model: options.model,
    linkedPaneId: options.linkedPaneId,
    sshContext: options.sshContext,
    timeline: [],
    messages: options.messages,
    offloadRefs: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function sanitizeFilename(value: string): string {
  return value
    .trim()
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    || 'canvas-report';
}

function countLinkedWindowBlocks(blocks: CanvasBlock[], windowId: string): number {
  return blocks.filter((block) => block.type === 'window' && block.windowId === windowId).length;
}

function getChatPaneFromWindow(windowItem: ReturnType<typeof useWindowStore.getState>['windows'][number]): Pane | null {
  return getAllPanes(windowItem.layout).find((pane) => pane.kind === 'chat') ?? null;
}

function findCanvasWindowBlockByWindowId(
  blocks: CanvasWorkspace['blocks'],
  windowId: string,
): CanvasWindowBlock | null {
  for (const block of blocks) {
    if (block.type === 'window' && block.windowId === windowId) {
      return block;
    }
  }

  return null;
}

function getTerminalPanesForCanvasWindow(windowItem: Window): Pane[] {
  return getAllPanes(windowItem.layout).filter((pane) => isTerminalPane(pane));
}

function canRenderCanvasLiveWindow(windowItem: Window): boolean {
  const terminalPanes = getTerminalPanesForCanvasWindow(windowItem);
  if (terminalPanes.length === 0) {
    return true;
  }

  return terminalPanes.some((pane) => !isInactiveTerminalPaneStatus(pane.status));
}

function hasOnlyInactiveTerminalPanes(windowItem: Window): boolean {
  const terminalPanes = getTerminalPanesForCanvasWindow(windowItem);
  return terminalPanes.length > 0 && terminalPanes.every((pane) => isInactiveTerminalPaneStatus(pane.status));
}

export const CanvasWorkspaceView: React.FC<CanvasWorkspaceViewProps> = ({
  canvasWorkspace,
  sshProfiles = [],
  onOpenWindow,
  onOpenCanvasWorkspace,
  onOpenGroup,
  onSelectSSHProfile,
  renderLiveWindow,
  onStopWorkspace,
}) => {
  const keyboardShortcuts = useKeyboardShortcutSettings();
  const { t, language } = useI18n();
  const windows = useWindowStore((state) => state.windows);
  const updateCanvasWorkspace = useWindowStore((state) => state.updateCanvasWorkspace);
  const addWindow = useWindowStore((state) => state.addWindow);
  const updatePane = useWindowStore((state) => state.updatePane);
  const updatePaneRuntime = useWindowStore((state) => state.updatePaneRuntime);
  const splitPaneInWindow = useWindowStore((state) => state.splitPaneInWindow);
  const setActivePane = useWindowStore((state) => state.setActivePane);
  const canvasWorkspaceTemplates = useWindowStore((state) => state.canvasWorkspaceTemplates);
  const setCanvasWorkspaceTemplates = useWindowStore((state) => state.setCanvasWorkspaceTemplates);
  const upsertCanvasWorkspaceTemplate = useWindowStore((state) => state.upsertCanvasWorkspaceTemplate);
  const removeCanvasWorkspaceTemplate = useWindowStore((state) => state.removeCanvasWorkspaceTemplate);
  const canvasActivity = useWindowStore((state) => state.canvasActivity);
  const appendCanvasActivity = useWindowStore((state) => state.appendCanvasActivity);
  const clearCanvasActivity = useWindowStore((state) => state.clearCanvasActivity);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [dragState, setDragState] = useState<DragState>(null);
  const [selectedBlockIds, setSelectedBlockIds] = useState<string[]>([]);
  const [lastArrangeMode, setLastArrangeMode] = useState<CanvasArrangeMode | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [relinkingBlockId, setRelinkingBlockId] = useState<string | null>(null);
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const [draftBlockTitle, setDraftBlockTitle] = useState('');
  const [workspaceRenameOpen, setWorkspaceRenameOpen] = useState(false);
  const [workspaceNameDraft, setWorkspaceNameDraft] = useState(canvasWorkspace.name);
  const [chatSettings, setChatSettings] = useState<ChatSettings>(() => normalizeChatSettings(undefined));
  const [quickSwitcherOpen, setQuickSwitcherOpen] = useState(false);
  const [titleBarActionsSlot, setTitleBarActionsSlot] = useState<HTMLElement | null>(null);
  const [canvasSize, setCanvasSize] = useState({
    w: typeof window === 'undefined' ? 1280 : window.innerWidth,
    h: typeof window === 'undefined' ? 720 : window.innerHeight,
  });

  const windowsById = useMemo(
    () => new Map(windows.map((windowItem) => [windowItem.id, windowItem] as const)),
    [windows],
  );
  const workspaceActivity = useMemo(
    () => canvasActivity
      .filter((item) => item.workspaceId === canvasWorkspace.id)
      .slice()
      .sort((left, right) => right.timestamp.localeCompare(left.timestamp)),
    [canvasActivity, canvasWorkspace.id],
  );
  const blockMap = useMemo(
    () => new Map(canvasWorkspace.blocks.map((block) => [block.id, block] as const)),
    [canvasWorkspace.blocks],
  );
  const resolvedTemplates = useMemo(
    () => (
      canvasWorkspaceTemplates.length > 0
        ? reconcileCanvasWorkspaceTemplates(canvasWorkspaceTemplates)
        : createDefaultCanvasTemplates()
    ),
    [canvasWorkspaceTemplates],
  );
  const linkedTerminalPaneEntries = useMemo(() => (
    windows.flatMap((windowItem) => getAllPanes(windowItem.layout)
      .filter((pane) => isTerminalPane(pane))
      .map((pane) => ({ windowId: windowItem.id, pane })))
  ), [windows]);
  const linkedTerminalPanes = useMemo(
    () => linkedTerminalPaneEntries.map((entry) => entry.pane),
    [linkedTerminalPaneEntries],
  );
  const selectedCanvasContext = useMemo(() => buildSelectedCanvasContext({
    workspace: canvasWorkspace,
    windowsById,
    selectedBlockIds,
    t,
  }), [canvasWorkspace, selectedBlockIds, t, windowsById]);
  const selectedBlocks = selectedCanvasContext.selectedBlocks;
  const selectedWindowBlocks = useMemo(
    () => selectedBlocks.filter((block): block is CanvasWindowBlock => block.type === 'window'),
    [selectedBlocks],
  );
  const selectedNoteBlocks = useMemo(
    () => selectedBlocks.filter((block): block is CanvasNoteBlock => block.type === 'note'),
    [selectedBlocks],
  );
  const canvasLinks = canvasWorkspace.links ?? [];
  const linksByBlockId = useMemo(() => {
    const map = new Map<string, CanvasBlockLink[]>();
    for (const link of canvasLinks) {
      const from = map.get(link.fromBlockId) ?? [];
      from.push(link);
      map.set(link.fromBlockId, from);
      const to = map.get(link.toBlockId) ?? [];
      to.push(link);
      map.set(link.toBlockId, to);
    }
    return map;
  }, [canvasLinks]);

  const availableWindows = useMemo(() => {
    const linkedWindowIds = new Set(
      canvasWorkspace.blocks
        .filter((block): block is CanvasWindowBlock => block.type === 'window')
        .map((block) => block.windowId),
    );

    return windows.filter((windowItem) => (
      !windowItem.archived
      && isStandaloneWindow(windowItem)
      && !linkedWindowIds.has(windowItem.id)
    ));
  }, [canvasWorkspace.blocks, windows]);

  const canvasOwnedWindows = useMemo(() => (
    windows.filter((windowItem) => (
      windowItem.ownerType === 'canvas-owned'
      && windowItem.ownerCanvasWorkspaceId === canvasWorkspace.id
    ))
  ), [canvasWorkspace.id, windows]);

  const relinkAvailableWindows = useMemo(() => {
    const relinkingBlock = relinkingBlockId
      ? canvasWorkspace.blocks.find((block): block is CanvasWindowBlock => block.id === relinkingBlockId && block.type === 'window') ?? null
      : null;

    const linkedWindowIds = new Set(
      canvasWorkspace.blocks
        .filter((block): block is CanvasWindowBlock => block.type === 'window')
        .filter((block) => block.id !== relinkingBlock?.id)
        .map((block) => block.windowId),
    );

    return windows.filter((windowItem) => (
      !windowItem.archived
      && isStandaloneWindow(windowItem)
      && !linkedWindowIds.has(windowItem.id)
    ));
  }, [canvasWorkspace.blocks, relinkingBlockId, windows]);

  useEffect(() => {
    const existingIds = new Set(canvasWorkspace.blocks.map((block) => block.id));
    setSelectedBlockIds((previous) => previous.filter((blockId) => existingIds.has(blockId)));
  }, [canvasWorkspace.blocks]);

  useEffect(() => {
    if (canvasWorkspaceTemplates.length === 0) {
      setCanvasWorkspaceTemplates(createDefaultCanvasTemplates());
      return;
    }

    const reconciledTemplates = reconcileCanvasWorkspaceTemplates(canvasWorkspaceTemplates);
    if (JSON.stringify(reconciledTemplates) !== JSON.stringify(canvasWorkspaceTemplates)) {
      setCanvasWorkspaceTemplates(reconciledTemplates);
    }
  }, [canvasWorkspaceTemplates, setCanvasWorkspaceTemplates]);

  useEffect(() => {
    let cancelled = false;

    void window.electronAPI.getSettings().then((response) => {
      if (!cancelled && response.success) {
        setChatSettings(mergeChatSettingsWithCanvasDefaults(
          normalizeChatSettings(response.data?.chat),
          canvasWorkspace,
        ));
      }
    }).catch(() => {
      // Ignore settings load failures and keep defaults.
    });

    return () => {
      cancelled = true;
    };
  }, [canvasWorkspace]);

  useEffect(() => {
    setWorkspaceNameDraft(canvasWorkspace.name);
  }, [canvasWorkspace.name]);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    const syncSlot = () => {
      const nextSlot = document.getElementById(CUSTOM_TITLEBAR_ACTIONS_SLOT_ID);
      setTitleBarActionsSlot((currentSlot) => (
        currentSlot === nextSlot ? currentSlot : nextSlot
      ));
    };

    syncSlot();
    window.addEventListener('resize', syncSlot);

    return () => {
      window.removeEventListener('resize', syncSlot);
    };
  }, []);

  useEffect(() => {
    if (editingBlockId && !canvasWorkspace.blocks.some((block) => block.id === editingBlockId)) {
      setEditingBlockId(null);
      setDraftBlockTitle('');
    }

    if (relinkingBlockId && !canvasWorkspace.blocks.some((block) => block.id === relinkingBlockId)) {
      setRelinkingBlockId(null);
    }
  }, [canvasWorkspace.blocks, editingBlockId, relinkingBlockId]);

  const persistWorkspace = useCallback((
    compute: (current: CanvasWorkspace) => Partial<CanvasWorkspace> | null,
  ): CanvasWorkspace | null => {
    const current = useWindowStore.getState().getCanvasWorkspaceById(canvasWorkspace.id);
    if (!current) {
      return null;
    }

    const updates = compute(current);
    if (!updates) {
      return null;
    }

    updateCanvasWorkspace(canvasWorkspace.id, updates);
    return { ...current, ...updates };
  }, [canvasWorkspace.id, updateCanvasWorkspace]);

  useEffect(() => {
    const inactiveLiveBlockIds = canvasWorkspace.blocks
      .filter((block): block is CanvasWindowBlock => block.type === 'window' && block.displayMode === 'live')
      .filter((block) => {
        const linkedWindow = windowsById.get(block.windowId);
        return linkedWindow ? hasOnlyInactiveTerminalPanes(linkedWindow) : false;
      })
      .map((block) => block.id);

    if (inactiveLiveBlockIds.length === 0) {
      return;
    }

    const inactiveLiveBlockIdSet = new Set(inactiveLiveBlockIds);
    persistWorkspace((current) => {
      let didChange = false;
      const nextBlocks = current.blocks.map((block) => {
        if (
          block.type === 'window'
          && block.displayMode === 'live'
          && inactiveLiveBlockIdSet.has(block.id)
        ) {
          didChange = true;
          return {
            ...block,
            displayMode: 'summary' as const,
          };
        }

        return block;
      });

      return didChange ? { blocks: nextBlocks } : null;
    });
  }, [canvasWorkspace.blocks, persistWorkspace, windowsById]);

  useEffect(() => {
    const node = canvasRef.current;
    if (!node) {
      return;
    }

    const syncSize = () => {
      const rect = node.getBoundingClientRect();
      setCanvasSize({ w: rect.width, h: rect.height });
    };

    syncSize();
    const observer = new ResizeObserver(syncSize);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const createCanvasEvent = useCallback((
    type: CanvasActivityEvent['type'],
    title: string,
    message?: string,
    extras?: Partial<Omit<CanvasActivityEvent, 'id' | 'workspaceId' | 'timestamp' | 'type' | 'title' | 'message'>>,
  ) => {
    appendCanvasActivity({
      id: typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `canvas-activity-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      workspaceId: canvasWorkspace.id,
      timestamp: new Date().toISOString(),
      type,
      title,
      message,
      ...extras,
    });
  }, [appendCanvasActivity, canvasWorkspace.id]);

  const updateViewport = useCallback((tx: number, ty: number, zoom: number) => {
    persistWorkspace(() => ({
      viewport: {
        tx,
        ty,
        zoom: clampZoom(zoom),
      },
    }));
  }, [persistWorkspace]);

  const clearSelection = useCallback(() => {
    setSelectedBlockIds([]);
  }, []);

  const bringBlocksToFront = useCallback((blockIds: string[]): CanvasBlock[] => {
    if (blockIds.length === 0) {
      return [];
    }

    let nextBlocks: CanvasBlock[] = [];
    persistWorkspace((current) => {
      const ids = new Set(blockIds);
      let nextZIndex = current.nextZIndex;
      nextBlocks = current.blocks.map((block) => {
        if (!ids.has(block.id)) {
          return block;
        }

        const elevated = {
          ...block,
          zIndex: nextZIndex,
        };
        nextZIndex += 1;
        return elevated;
      });

      return {
        blocks: nextBlocks,
        nextZIndex,
      };
    });

    return nextBlocks;
  }, [persistWorkspace]);

  const createNoteAtWorld = useCallback((x: number, y: number) => {
    let createdBlockId: string | null = null;

    persistWorkspace((current) => {
      const nextBlock: CanvasNoteBlock = {
        id: createCanvasBlockId('note'),
        type: 'note',
        x,
        y,
        width: DEFAULT_NOTE_BLOCK_SIZE.width,
        height: DEFAULT_NOTE_BLOCK_SIZE.height,
        zIndex: current.nextZIndex,
        label: t('canvas.defaultNoteTitle'),
        content: '',
      };
      createdBlockId = nextBlock.id;

      return {
        blocks: [...current.blocks, nextBlock],
        nextZIndex: current.nextZIndex + 1,
      };
    });

    if (createdBlockId) {
      setSelectedBlockIds([createdBlockId]);
      createCanvasEvent('note-added', t('canvas.addNote'), undefined, {
        blockId: createdBlockId,
      });
    }
  }, [createCanvasEvent, persistWorkspace, t]);

  const createNoteAtClient = useCallback((clientX: number, clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }

    const point = getWorldPointFromClient(clientX, clientY, rect, canvasWorkspace.viewport);
    createNoteAtWorld(point.x, point.y);
  }, [canvasWorkspace.viewport, createNoteAtWorld]);

  const addWindowBlock = useCallback((windowId: string) => {
    const linkedWindow = windowsById.get(windowId);
    if (!linkedWindow) {
      return;
    }

    let createdBlockId: string | null = null;

    persistWorkspace((current) => {
      const size = getCanvasWindowBlockSize(linkedWindow);
      const nextRect = findCanvasWindowInsertRect(current.blocks, size);
      const nextBlock: CanvasWindowBlock = {
        id: createCanvasBlockId('window'),
        type: 'window',
        windowId,
        x: nextRect.x,
        y: nextRect.y,
        width: nextRect.width,
        height: nextRect.height,
        zIndex: current.nextZIndex,
        label: linkedWindow.name,
        displayMode: 'summary',
      };
      createdBlockId = nextBlock.id;

      return {
        blocks: [...current.blocks, nextBlock],
        nextZIndex: current.nextZIndex + 1,
      };
    });

    if (createdBlockId) {
      setSelectedBlockIds([createdBlockId]);
      createCanvasEvent('window-added', linkedWindow.name, undefined, {
        windowId,
        blockId: createdBlockId,
      });
    }
  }, [createCanvasEvent, persistWorkspace, windowsById]);

  const addWindowBlockFromWindow = useCallback((windowItem: typeof windows[number]) => {
    let createdBlockId: string | null = null;

    persistWorkspace((current) => {
      const size = getCanvasWindowBlockSize(windowItem);
      const nextRect = findCanvasWindowInsertRect(current.blocks, size);
      const nextBlock: CanvasWindowBlock = {
        id: createCanvasBlockId('window'),
        type: 'window',
        windowId: windowItem.id,
        x: nextRect.x,
        y: nextRect.y,
        width: nextRect.width,
        height: nextRect.height,
        zIndex: current.nextZIndex,
        label: windowItem.name,
        displayMode: 'summary',
      };
      createdBlockId = nextBlock.id;

      return {
        blocks: [...current.blocks, nextBlock],
        nextZIndex: current.nextZIndex + 1,
      };
    });

    if (createdBlockId) {
      setSelectedBlockIds([createdBlockId]);
      createCanvasEvent('window-added', windowItem.name, undefined, {
        windowId: windowItem.id,
        blockId: createdBlockId,
      });
    }
  }, [createCanvasEvent, persistWorkspace, windows]);

  const updateSingleBlock = useCallback((
    blockId: string,
    updates: Partial<Pick<CanvasBlock, 'x' | 'y' | 'width' | 'height' | 'label'>> & { content?: string },
  ) => {
    persistWorkspace((current) => ({
      blocks: current.blocks.map((block) => {
        if (block.id !== blockId) {
          return block;
        }

        if (block.type === 'window') {
          const nextBlock: CanvasWindowBlock = {
            ...block,
            x: updates.x ?? block.x,
            y: updates.y ?? block.y,
            width: updates.width ?? block.width,
            height: updates.height ?? block.height,
            label: updates.label ?? block.label,
            windowId: block.windowId,
          };
          return nextBlock;
        }

        const nextBlock: CanvasNoteBlock = {
          ...block,
          x: updates.x ?? block.x,
          y: updates.y ?? block.y,
          width: updates.width ?? block.width,
          height: updates.height ?? block.height,
          label: updates.label ?? block.label,
          content: typeof updates.content === 'string' ? updates.content : block.content,
        };
        return nextBlock;
      }),
    }));
  }, [persistWorkspace]);

  const updateChatPaneState = useCallback((
    windowId: string,
    paneId: string,
    updater: (current: NonNullable<Pane['chat']>) => NonNullable<Pane['chat']>,
    runtimeOnly = false,
  ) => {
    const windowItem = useWindowStore.getState().getWindowById(windowId);
    if (!windowItem) {
      return;
    }

    const pane = getAllPanes(windowItem.layout).find((item) => item.id === paneId && item.kind === 'chat');
    if (!pane) {
      return;
    }

    const currentChat = {
      messages: [],
      ...(pane.chat ?? {}),
    };
    const nextChat = updater(currentChat);
    const apply = runtimeOnly ? updatePaneRuntime : updatePane;
    apply(windowId, paneId, { chat: nextChat });
  }, [updatePane, updatePaneRuntime]);

  const ensureCanvasChatTarget = useCallback((preferredWindowBlock?: CanvasWindowBlock | null): {
    windowId: string;
    paneId: string;
    pane: Pane;
    blockId: string;
  } | null => {
    const state = useWindowStore.getState();
    const preferredWindow = preferredWindowBlock ? state.getWindowById(preferredWindowBlock.windowId) : null;
    const preferredPane = preferredWindow ? getChatPaneFromWindow(preferredWindow) : null;
    if (preferredWindow && preferredPane && preferredWindowBlock) {
      return {
        windowId: preferredWindow.id,
        paneId: preferredPane.id,
        pane: preferredPane,
        blockId: preferredWindowBlock.id,
      };
    }

    for (const block of canvasWorkspace.blocks) {
      if (block.type !== 'window') {
        continue;
      }

      const windowItem = state.getWindowById(block.windowId);
      if (!windowItem) {
        continue;
      }

      const chatPane = getChatPaneFromWindow(windowItem);
      if (!chatPane) {
        continue;
      }

      return {
        windowId: windowItem.id,
        paneId: chatPane.id,
        pane: chatPane,
        blockId: block.id,
      };
    }

    const sourceWindowBlock = preferredWindowBlock ?? selectedWindowBlocks[0] ?? null;
    const sourceWindow = sourceWindowBlock ? state.getWindowById(sourceWindowBlock.windowId) : null;
    if (sourceWindow) {
      const panes = getAllPanes(sourceWindow.layout);
      const terminalPane = panes.find((pane) => isTerminalPane(pane)) ?? null;
      if (terminalPane) {
        const newPaneId = createMessageId('canvas-chat-pane');
        const linkedPaneId = selectPreferredChatLinkedPaneId(
          panes,
          getPaneBackend(terminalPane) === 'ssh' ? terminalPane.id : undefined,
        );
        const newPane = createChatPaneDraft(newPaneId, { linkedPaneId });
        const direction = getSmartBrowserSplitDirection(sourceWindow.layout, terminalPane.id);
        splitPaneInWindow(sourceWindow.id, terminalPane.id, direction, newPane, CHAT_PANE_DEFAULT_SPLIT_SIZES);
        setActivePane(sourceWindow.id, newPaneId);

        return {
          windowId: sourceWindow.id,
          paneId: newPaneId,
          pane: newPane,
          blockId: sourceWindowBlock?.id ?? findCanvasWindowBlockByWindowId(canvasWorkspace.blocks, sourceWindow.id)?.id ?? '',
        };
      }
    }

    const draftWindow = createCanvasWindowDraft('chat', {
      name: t('canvas.selectionChatTitle'),
      linkedPaneId: selectPreferredChatLinkedPaneId(linkedTerminalPanes),
      ownerCanvasWorkspaceId: canvasWorkspace.id,
    });
    addWindow(draftWindow);
    addWindowBlockFromWindow(draftWindow);
    const createdBlock = findCanvasWindowBlockByWindowId(
      useWindowStore.getState().getCanvasWorkspaceById(canvasWorkspace.id)?.blocks ?? canvasWorkspace.blocks,
      draftWindow.id,
    );
    if (draftWindow.layout.type !== 'pane' || draftWindow.layout.pane.kind !== 'chat' || !createdBlock) {
      return null;
    }

    return {
      windowId: draftWindow.id,
      paneId: draftWindow.layout.pane.id,
      pane: draftWindow.layout.pane,
      blockId: createdBlock.id,
    };
  }, [
    addWindow,
    addWindowBlockFromWindow,
    canvasWorkspace.blocks,
    canvasWorkspace.id,
    linkedTerminalPanes,
    selectedWindowBlocks,
    setActivePane,
    splitPaneInWindow,
    t,
  ]);

  const startEditingBlockTitle = useCallback((block: CanvasBlock, fallbackTitle: string) => {
    setEditingBlockId(block.id);
    setDraftBlockTitle(block.label ?? fallbackTitle);
  }, []);

  const commitBlockTitle = useCallback((block: CanvasBlock, fallbackTitle: string) => {
    const nextLabel = draftBlockTitle.trim();
    const normalizedFallback = fallbackTitle.trim();

    updateSingleBlock(block.id, {
      label: nextLabel && nextLabel !== normalizedFallback ? nextLabel : '',
    });
    setEditingBlockId(null);
    setDraftBlockTitle('');
  }, [draftBlockTitle, updateSingleBlock]);

  const cancelBlockTitleEdit = useCallback(() => {
    setEditingBlockId(null);
    setDraftBlockTitle('');
  }, []);

  const relinkWindowBlock = useCallback((blockId: string, windowId: string) => {
    const linkedWindow = windowsById.get(windowId);

    persistWorkspace((current) => ({
      blocks: current.blocks.map((block) => {
        if (block.id !== blockId || block.type !== 'window') {
          return block;
        }

        return {
          ...block,
          windowId,
          label: linkedWindow?.name ?? block.label,
        };
      }),
    }));
    setRelinkingBlockId(null);
    if (linkedWindow) {
      createCanvasEvent('window-added', linkedWindow.name, t('canvas.activityRelinkedWindow'), {
        windowId,
        blockId,
      });
    }
  }, [createCanvasEvent, persistWorkspace, windowsById]);

  const toggleWindowDisplayMode = useCallback((blockId: string, displayMode: 'summary' | 'live') => {
    const targetBlock = canvasWorkspace.blocks.find((block) => block.id === blockId);
    const targetWindowId = targetBlock && targetBlock.type === 'window'
      ? targetBlock.windowId
      : undefined;
    const targetWindow = targetWindowId ? windowsById.get(targetWindowId) : undefined;

    if (displayMode === 'live' && targetWindow) {
      void startWindowPanes(targetWindow, updatePane).catch((error) => {
        console.error(`Failed to start canvas live window ${targetWindow.id}:`, error);
      });
    }

    persistWorkspace((current) => ({
      blocks: current.blocks.map((block) => {
        if (block.id !== blockId || block.type !== 'window') {
          if (
            displayMode === 'live'
            && block.type === 'window'
            && targetWindowId === block.windowId
          ) {
            return {
              ...block,
              displayMode: 'summary',
            };
          }

          return block;
        }

        const liveSize = displayMode === 'live' && targetWindow
          ? getCanvasLiveWindowBlockSize(targetWindow)
          : null;

        return {
          ...block,
          displayMode,
          width: liveSize ? Math.max(block.width, liveSize.width) : block.width,
          height: liveSize ? Math.max(block.height, liveSize.height) : block.height,
        };
      }),
    }));
    const block = canvasWorkspace.blocks.find((item) => item.id === blockId);
    if (block?.type === 'window') {
      createCanvasEvent(
        displayMode === 'live' ? 'window-live-opened' : 'window-live-closed',
        block.label || windowsById.get(block.windowId)?.name || t('canvas.unnamedWindow'),
        undefined,
        {
          windowId: block.windowId,
          blockId,
        },
      );
    }
  }, [canvasWorkspace.blocks, createCanvasEvent, persistWorkspace, t, updatePane, windowsById]);

  const deleteBlocks = useCallback((blockIds: string[]) => {
    if (blockIds.length === 0) {
      return;
    }

    const ids = new Set(blockIds);
    const canvasOwnedWindowIds = canvasWorkspace.blocks
      .filter((block): block is CanvasWindowBlock => block.type === 'window' && ids.has(block.id))
      .map((block) => block.windowId)
      .filter((windowId) => {
        const windowItem = windowsById.get(windowId);
        return windowItem?.ownerType === 'canvas-owned' && windowItem.ownerCanvasWorkspaceId === canvasWorkspace.id;
      });

    for (const windowId of canvasOwnedWindowIds) {
      void destroyWindowResourcesAndRemoveRecord(windowId).catch((error) => {
        console.error(`Failed to destroy canvas-owned window ${windowId}:`, error);
      });
    }

    persistWorkspace((current) => ({
      blocks: current.blocks.filter((block) => !ids.has(block.id)),
      links: (current.links ?? []).filter((link) => !ids.has(link.fromBlockId) && !ids.has(link.toBlockId)),
    }));
    setSelectedBlockIds((previous) => previous.filter((blockId) => !ids.has(blockId)));
  }, [canvasWorkspace.blocks, canvasWorkspace.id, persistWorkspace, windowsById]);

  const arrangeCanvas = useCallback((mode: CanvasArrangeMode) => {
    persistWorkspace((current) => ({
      blocks: arrangeCanvasBlocks(current.blocks, mode),
    }));
    setLastArrangeMode(mode);
  }, [persistWorkspace]);

  const fitToContent = useCallback(() => {
    const nextViewport = fitViewportToBlocks(canvasWorkspace.blocks, canvasSize);
    updateViewport(nextViewport.tx, nextViewport.ty, nextViewport.zoom);
  }, [canvasSize, canvasWorkspace.blocks, updateViewport]);

  const handleWorkspaceRenameSave = useCallback(() => {
    const nextName = workspaceNameDraft.trim();
    updateCanvasWorkspace(canvasWorkspace.id, {
      name: nextName || canvasWorkspace.name,
    });
    if (nextName && nextName !== canvasWorkspace.name) {
      createCanvasEvent('workspace-renamed', nextName);
    }
    setWorkspaceRenameOpen(false);
  }, [canvasWorkspace.id, canvasWorkspace.name, createCanvasEvent, updateCanvasWorkspace, workspaceNameDraft]);

  const stopWorkspaceRuntime = useCallback(async () => {
    await onStopWorkspace?.(canvasWorkspace.id);
  }, [canvasWorkspace.id, onStopWorkspace]);

  const titleBarActions = useMemo(() => {
    if (!onStopWorkspace || !titleBarActionsSlot) {
      return null;
    }

    return createPortal(
      <div
        data-testid="canvas-titlebar-actions"
        className="pointer-events-auto flex h-8 items-center justify-end gap-1 px-1.5"
      >
        <AppTooltip content={t('canvas.stopWorkspace')} placement="toolbar-trailing">
          <button
            type="button"
            tabIndex={-1}
            aria-label={t('canvas.stopWorkspace')}
            title={t('canvas.stopWorkspace')}
            onMouseDown={preventMouseButtonFocus}
            onClick={() => {
              void stopWorkspaceRuntime();
            }}
            className="flex h-6 w-6 items-center justify-center rounded-md border border-transparent bg-[color-mix(in_srgb,rgb(var(--secondary))_72%,transparent)] text-red-500 transition-colors hover:border-[rgb(var(--ring))] hover:bg-[rgb(var(--accent))]"
          >
            <Square size={14} fill="currentColor" />
          </button>
        </AppTooltip>
      </div>,
      titleBarActionsSlot,
    );
  }, [onStopWorkspace, stopWorkspaceRuntime, t, titleBarActionsSlot]);

  const handleCreateWindowBlock = useCallback((payload: {
    kind: 'local' | 'ssh' | 'code' | 'browser' | 'chat';
    name?: string;
    workingDirectory?: string;
    command?: string;
    url?: string;
    linkedPaneId?: string;
    sshProfileId?: string;
  }) => {
    const sshProfile = payload.sshProfileId
      ? sshProfiles.find((profile) => profile.id === payload.sshProfileId)
      : undefined;
    const draftWindow = createCanvasWindowDraft(payload.kind, {
      name: payload.name,
      workingDirectory: payload.workingDirectory || canvasWorkspace.workingDirectory,
      command: payload.command,
      url: payload.url,
      linkedPaneId: payload.linkedPaneId,
      sshProfile,
      ownerCanvasWorkspaceId: canvasWorkspace.id,
    });
    addWindow(draftWindow);
    addWindowBlockFromWindow(draftWindow);
  }, [addWindow, addWindowBlockFromWindow, canvasWorkspace.id, canvasWorkspace.workingDirectory, sshProfiles]);

  const handleApplyTemplate = useCallback((templateId: string) => {
    const template = resolvedTemplates.find((item) => item.id === templateId);
    if (!template) {
      return;
    }

    const instantiated = instantiateCanvasWorkspaceFromTemplate(template, {
      name: canvasWorkspace.name,
      workingDirectory: canvasWorkspace.workingDirectory,
      sshProfiles,
    });

    for (const windowItem of instantiated.windows) {
      windowItem.ownerType = 'canvas-owned';
      windowItem.ownerCanvasWorkspaceId = canvasWorkspace.id;
      addWindow(windowItem);
    }

    const templateOffset = findCanvasTemplateInsertOffset(
      canvasWorkspace.blocks,
      instantiated.workspace.blocks,
    );

    const mergedWorkspace = mergeCanvasWorkspaceContents(
      {
        blocks: canvasWorkspace.blocks,
        links: canvasWorkspace.links ?? [],
        nextZIndex: canvasWorkspace.nextZIndex,
      },
      {
        blocks: instantiated.workspace.blocks,
        links: instantiated.workspace.links ?? [],
        nextZIndex: instantiated.workspace.nextZIndex,
      },
      templateOffset,
    );

    updateCanvasWorkspace(canvasWorkspace.id, {
      blocks: mergedWorkspace.blocks,
      links: mergedWorkspace.links,
      nextZIndex: mergedWorkspace.nextZIndex,
      templateId: template.id,
      chatDefaults: instantiated.workspace.chatDefaults,
      exportSettings: instantiated.workspace.exportSettings,
      updatedAt: new Date().toISOString(),
    });
    setSelectedBlockIds([]);
    setTemplatesOpen(false);
    createCanvasEvent('template-applied', template.name, template.description, {
      templateId: template.id,
    });
  }, [
    addWindow,
    canvasWorkspace.id,
    canvasWorkspace.name,
    canvasWorkspace.workingDirectory,
    createCanvasEvent,
    resolvedTemplates,
    sshProfiles,
    updateCanvasWorkspace,
  ]);

  const handleSaveCurrentAsTemplate = useCallback(() => {
    const template = createTemplateFromWorkspace(canvasWorkspace, windowsById);
    upsertCanvasWorkspaceTemplate(template);
    createCanvasEvent('workspace-created', template.name, t('canvas.activityTemplateSaved'), {
      templateId: template.id,
    });
    setTemplatesOpen(true);
  }, [canvasWorkspace, createCanvasEvent, t, upsertCanvasWorkspaceTemplate, windowsById]);

  const createConnectedNoteFromSelection = useCallback((content: string, label?: string) => {
    if (!selectedBlocks.length) {
      return;
    }

    const bounds = getCanvasBounds(selectedBlocks);
    let createdNoteId: string | null = null;

    persistWorkspace((current) => {
      const noteId = createCanvasBlockId('note');
      createdNoteId = noteId;
      const nextBlock: CanvasNoteBlock = {
        id: noteId,
        type: 'note',
        x: bounds.maxX + 60,
        y: bounds.minY,
        width: DEFAULT_NOTE_BLOCK_SIZE.width,
        height: Math.max(DEFAULT_NOTE_BLOCK_SIZE.height, Math.min(420, 140 + content.length / 3)),
        zIndex: current.nextZIndex,
        label: label || t('canvas.defaultNoteTitle'),
        content,
      };
      const nextLinks = [...(current.links ?? [])];
      for (const sourceBlock of selectedBlocks) {
        nextLinks.push({
          id: createCanvasLinkId(),
          fromBlockId: sourceBlock.id,
          toBlockId: noteId,
          kind: inferCanvasLinkKind(sourceBlock, nextBlock),
          createdAt: new Date().toISOString(),
        });
      }

      return {
        blocks: [...current.blocks, nextBlock],
        links: nextLinks,
        nextZIndex: current.nextZIndex + 1,
      };
    });

    if (createdNoteId) {
      setSelectedBlockIds([createdNoteId]);
      createCanvasEvent('evidence-captured', t('canvas.sendToNote'), t('canvas.evidenceCapturedMessage', {
        count: selectedBlocks.length,
      }), {
        blockId: createdNoteId,
        blockIds: selectedBlocks.map((block) => block.id),
      });
    }
  }, [createCanvasEvent, persistWorkspace, selectedBlocks, t]);

  const sendSelectionToNote = useCallback(() => {
    if (!selectedBlocks.length) {
      return;
    }

    const noteBody = [
      `# ${canvasWorkspace.name}`,
      '',
      ...selectedBlocks.map((block) => serializeCanvasBlockEvidence(block, windowsById, t)),
    ].join('\n\n');

    createConnectedNoteFromSelection(noteBody, t('canvas.evidenceNoteTitle'));
  }, [canvasWorkspace.name, createConnectedNoteFromSelection, selectedBlocks, t, windowsById]);

  const toggleSelectedBlockLink = useCallback(() => {
    if (selectedBlockIds.length !== 2) {
      return;
    }

    const [fromBlockId, toBlockId] = selectedBlockIds;
    const fromBlock = blockMap.get(fromBlockId);
    const toBlock = blockMap.get(toBlockId);
    if (!fromBlock || !toBlock) {
      return;
    }

    let removed = false;
    persistWorkspace((current) => {
      const existingLink = (current.links ?? []).find((link) => (
        (link.fromBlockId === fromBlockId && link.toBlockId === toBlockId)
        || (link.fromBlockId === toBlockId && link.toBlockId === fromBlockId)
      ));

      if (existingLink) {
        removed = true;
        return {
          links: (current.links ?? []).filter((link) => link.id !== existingLink.id),
        };
      }

      const nextLink: CanvasBlockLink = {
        id: createCanvasLinkId(),
        fromBlockId,
        toBlockId,
        kind: inferCanvasLinkKind(fromBlock, toBlock),
        createdAt: new Date().toISOString(),
      };

      return {
        links: [...(current.links ?? []), nextLink],
      };
    });

    if (!removed) {
      createCanvasEvent('blocks-linked', t('canvas.linkSelection'), undefined, {
        blockIds: [fromBlockId, toBlockId],
      });
    }
  }, [blockMap, createCanvasEvent, persistWorkspace, selectedBlockIds, t]);

  const exportCurrentReport = useCallback(async () => {
    try {
      const report = exportCanvasWorkspaceReport({
        workspace: canvasWorkspace,
        windowsById,
        t,
        activityItems: workspaceActivity.map((item) => ({
          timestamp: item.timestamp,
          title: item.title,
          message: item.message,
        })),
      });
      const filename = `${sanitizeFilename(report.title)}.md`;

      if (window.electronAPI?.writeClipboardText) {
        await window.electronAPI.writeClipboardText(report.markdown);
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(report.markdown);
      }

      const blob = new Blob([report.markdown], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);

      createCanvasEvent('report-exported', t('canvas.exportReport'), filename);
      dispatchAppSuccess(t('canvas.exportReportSuccess', { filename }));
    } catch (error) {
      dispatchAppError(error instanceof Error ? error.message : String(error));
    }
  }, [canvasWorkspace, createCanvasEvent, t, windowsById, workspaceActivity]);

  const askAIForSelection = useCallback(async () => {
    if (!selectedBlocks.length) {
      return;
    }

    try {
      const providers = chatSettings.providers ?? [];
      const provider = providers.find((item) => item.id === chatSettings.activeProviderId) ?? providers[0];
      const model = provider?.defaultModel ?? provider?.models?.[0];
      if (!provider || !model) {
        dispatchAppError(t('canvas.askAIMissingProvider'));
        return;
      }

      const chatTarget = ensureCanvasChatTarget(selectedWindowBlocks[0] ?? null);
      if (!chatTarget) {
        dispatchAppError(t('canvas.askAIWindowInvalid'));
        return;
      }

      const chatPane = chatTarget.pane;
      const linkedPaneId = chatPane.chat?.linkedPaneId ?? selectPreferredChatLinkedPaneId(linkedTerminalPanes);
      const linkedPaneEntry = linkedTerminalPaneEntries.find((entry) => entry.pane.id === linkedPaneId) ?? null;
      const linkedPane = linkedPaneEntry?.pane ?? null;
      const sshContext: ChatSshContext | undefined = linkedPane && getPaneBackend(linkedPane) === 'ssh' && linkedPane.ssh?.host && linkedPane.ssh?.user
        ? {
            host: linkedPane.ssh.host,
            user: linkedPane.ssh.user,
            cwd: linkedPane.cwd || linkedPane.ssh.remoteCwd,
            windowId: linkedPaneEntry?.windowId ?? chatTarget.windowId,
            paneId: linkedPane.id,
          }
        : undefined;
      const prompt = [
        t('canvas.askAIPromptLead', { count: selectedBlocks.length }),
        '',
        selectedCanvasContext.contextText,
        '',
        t('canvas.askAIPromptTail'),
      ].join('\n');
      const contextFragments = [
        ...selectedCanvasContext.fragments,
        ...await resolveChatContextFragments(chatSettings, prompt),
      ];
      const userMessage: ChatMessage = {
        id: createMessageId('chat-user'),
        role: 'user',
        content: prompt,
        timestamp: new Date().toISOString(),
      };
      const previousMessages = chatPane.chat?.messages ?? [];
      const nextMessages = [...previousMessages, userMessage];
      const optimisticAgent = createOptimisticAgentTask({
        taskId: createMessageId('agent-task'),
        paneId: chatTarget.paneId,
        windowId: chatTarget.windowId,
        providerId: provider.id,
        model,
        linkedPaneId,
        sshContext,
        messages: nextMessages,
      });
      const systemPrompt = buildChatSystemPrompt(chatSettings);

      updateChatPaneState(chatTarget.windowId, chatTarget.paneId, (current) => ({
        ...current,
        conversationId: current.conversationId ?? createChatConversationHistoryId(),
        messages: nextMessages,
        agent: optimisticAgent,
        activeProviderId: provider.id,
        activeModel: model,
        linkedPaneId,
        contextFragments,
        isStreaming: true,
      }), true);

      const response = await window.electronAPI.agentSend({
        paneId: chatTarget.paneId,
        windowId: chatTarget.windowId,
        providerId: provider.id,
        model,
        text: prompt,
        systemPrompt,
        enableTools: Boolean(sshContext),
        linkedPaneId,
        sshContext,
        contextFragments,
        seedMessages: previousMessages,
      });

      if (!response.success) {
        throw new Error(response.error || t('canvas.askAISendFailed'));
      }

      persistWorkspace((current) => {
        const existingPairs = new Set((current.links ?? []).map((link) => `${link.fromBlockId}:${link.toBlockId}`));
        const nextLinks = [...(current.links ?? [])];
        const targetBlock = current.blocks.find((block) => block.id === chatTarget.blockId);
        if (!targetBlock) {
          return null;
        }

        for (const block of selectedBlocks) {
          const pair = `${block.id}:${targetBlock.id}`;
          if (existingPairs.has(pair)) {
            continue;
          }
          nextLinks.push({
            id: createCanvasLinkId(),
            fromBlockId: block.id,
            toBlockId: targetBlock.id,
            kind: inferCanvasLinkKind(block, targetBlock),
            label: 'ask-ai',
            createdAt: new Date().toISOString(),
          });
        }

        return {
          links: nextLinks,
        };
      });

      createCanvasEvent('selection-sent-to-chat', t('canvas.askAI'), t('canvas.selectionSentToChatMessage', {
        count: selectedBlocks.length,
      }), {
        blockIds: selectedBlocks.map((block) => block.id),
        paneId: chatTarget.paneId,
      });
      dispatchAppSuccess(t('canvas.selectionSentToChatMessage', { count: selectedBlocks.length }));
    } catch (error) {
      dispatchAppError(error instanceof Error ? error.message : String(error));
    }
  }, [
    chatSettings.activeProviderId,
    chatSettings.defaultSystemPrompt,
    chatSettings.providers,
    chatSettings.workspaceInstructions,
    createCanvasEvent,
    ensureCanvasChatTarget,
    linkedTerminalPaneEntries,
    linkedTerminalPanes,
    selectedBlocks,
    selectedCanvasContext.contextText,
    selectedCanvasContext.fragments,
    selectedWindowBlocks,
    t,
    updateChatPaneState,
    chatSettings.contextFilePaths,
  ]);

  const selectBlock = useCallback((blockId: string, additive: boolean) => {
    setSelectedBlockIds((previous) => {
      if (additive) {
        return previous.includes(blockId)
          ? previous.filter((item) => item !== blockId)
          : [...previous, blockId];
      }

      if (previous.length === 1 && previous[0] === blockId) {
        return previous;
      }

      return [blockId];
    });
  }, []);

  const handleCanvasWheel = useCallback((event: WheelEvent) => {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }

      const point = getWorldPointFromClient(event.clientX, event.clientY, rect, canvasWorkspace.viewport);
      const nextZoom = clampZoom(canvasWorkspace.viewport.zoom * (event.deltaY > 0 ? 0.92 : 1.08));
      const nextTx = event.clientX - rect.left - point.x * nextZoom;
      const nextTy = event.clientY - rect.top - point.y * nextZoom;
      updateViewport(nextTx, nextTy, nextZoom);
      return;
    }

    event.preventDefault();
    updateViewport(
      canvasWorkspace.viewport.tx - event.deltaX,
      canvasWorkspace.viewport.ty - event.deltaY,
      canvasWorkspace.viewport.zoom,
    );
  }, [canvasWorkspace.viewport, updateViewport]);

  useEffect(() => {
    const canvasNode = canvasRef.current;
    if (!canvasNode) {
      return undefined;
    }

    canvasNode.addEventListener('wheel', handleCanvasWheel, { passive: false });
    return () => {
      canvasNode.removeEventListener('wheel', handleCanvasWheel);
    };
  }, [handleCanvasWheel]);

  useEffect(() => {
    if (!dragState) {
      return;
    }

    const handleMouseMove = (event: MouseEvent) => {
      if (dragState.type === 'pan') {
        updateViewport(
          dragState.initialViewport.tx + (event.clientX - dragState.startClientX),
          dragState.initialViewport.ty + (event.clientY - dragState.startClientY),
          dragState.initialViewport.zoom,
        );
        return;
      }

      if (dragState.type === 'move') {
        const zoom = canvasWorkspace.viewport.zoom;
        const deltaX = (event.clientX - dragState.startClientX) / zoom;
        const deltaY = (event.clientY - dragState.startClientY) / zoom;
        persistWorkspace((current) => ({
          blocks: moveCanvasBlocks(
            current.blocks,
            dragState.blockIds,
            deltaX,
            deltaY,
            dragState.initialPositions,
          ),
        }));
        return;
      }

      if (dragState.type === 'resize') {
        const zoom = canvasWorkspace.viewport.zoom;
        const deltaX = (event.clientX - dragState.startClientX) / zoom;
        const deltaY = (event.clientY - dragState.startClientY) / zoom;
        persistWorkspace((current) => ({
          blocks: current.blocks.map((block) => (
            block.id === dragState.blockId
              ? resizeCanvasBlock(dragState.initialBlock, dragState.direction, deltaX, deltaY)
              : block
          )),
        }));
        return;
      }

      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }

      const worldPoint = getWorldPointFromClient(event.clientX, event.clientY, rect, canvasWorkspace.viewport);
      const nextRect = normalizeCanvasRect(
        dragState.startWorldX,
        dragState.startWorldY,
        worldPoint.x,
        worldPoint.y,
      );
      const nextIds = getIntersectingCanvasBlockIds(canvasWorkspace.blocks, nextRect);

      setDragState((previous) => {
        if (!previous || previous.type !== 'select') {
          return previous;
        }

        return {
          ...previous,
          currentWorldX: worldPoint.x,
          currentWorldY: worldPoint.y,
        };
      });

      setSelectedBlockIds(
        dragState.additive
          ? Array.from(new Set([...dragState.baseSelection, ...nextIds]))
          : nextIds,
      );
    };

    const handleMouseUp = () => {
      setDragState(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [canvasWorkspace.blocks, canvasWorkspace.viewport, dragState, persistWorkspace, updateViewport]);

  useEffect(() => {
    const chatPaneIds = new Set(
      canvasWorkspace.blocks
        .filter((block): block is CanvasWindowBlock => block.type === 'window')
        .map((block) => windowsById.get(block.windowId))
        .flatMap((windowItem) => windowItem ? getAllPanes(windowItem.layout) : [])
        .filter((pane) => pane.kind === 'chat')
        .map((pane) => pane.id),
    );

    const handleTaskState = (_event: unknown, payload: { paneId: string; task: AgentTaskSnapshot }) => {
      if (!chatPaneIds.has(payload.paneId)) {
        return;
      }

      const chatWindow = Array.from(windowsById.values()).find((windowItem) => (
        getAllPanes(windowItem.layout).some((pane) => pane.kind === 'chat' && pane.id === payload.paneId)
      ));
      if (!chatWindow) {
        return;
      }

      updateChatPaneState(chatWindow.id, payload.paneId, (current) => ({
        ...current,
        messages: payload.task.messages,
        agent: payload.task,
        activeProviderId: payload.task.providerId,
        activeModel: payload.task.model,
        linkedPaneId: payload.task.linkedPaneId ?? current.linkedPaneId,
        isStreaming: payload.task.status === 'running',
      }), payload.task.status === 'running');
    };

    const handleTaskError = (_event: unknown, payload: { paneId: string; error: string }) => {
      if (!chatPaneIds.has(payload.paneId)) {
        return;
      }

      const chatWindow = Array.from(windowsById.values()).find((windowItem) => (
        getAllPanes(windowItem.layout).some((pane) => pane.kind === 'chat' && pane.id === payload.paneId)
      ));
      if (!chatWindow) {
        return;
      }

      updateChatPaneState(chatWindow.id, payload.paneId, (current) => ({
        ...current,
        isStreaming: false,
        agent: current.agent
          ? {
              ...current.agent,
              status: 'failed',
              error: payload.error,
              updatedAt: new Date().toISOString(),
            }
          : current.agent,
      }), true);
    };

    window.electronAPI.onAgentTaskState(handleTaskState);
    window.electronAPI.onAgentTaskError(handleTaskError);

    return () => {
      window.electronAPI.offAgentTaskState(handleTaskState);
      window.electronAPI.offAgentTaskError(handleTaskError);
    };
  }, [canvasWorkspace.blocks, updateChatPaneState, windowsById]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName;
      const isTypingTarget = tagName === 'INPUT' || tagName === 'TEXTAREA' || target?.isContentEditable;

      if ((event.key === 'Backspace' || event.key === 'Delete') && !isTypingTarget && selectedBlockIds.length > 0) {
        event.preventDefault();
        deleteBlocks(selectedBlockIds);
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a' && !isTypingTarget) {
        event.preventDefault();
        setSelectedBlockIds(canvasWorkspace.blocks.map((block) => block.id));
      }

      if (event.key === 'Escape') {
        if (quickSwitcherOpen) {
          return;
        }
        setDragState(null);
        clearSelection();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canvasWorkspace.blocks, clearSelection, deleteBlocks, quickSwitcherOpen, selectedBlockIds]);

  useKeyboardShortcuts({
    quickSwitcherShortcut: keyboardShortcuts.quickSwitcher,
    onCtrlTab: () => {
      setQuickSwitcherOpen(true);
    },
    onEscape: () => {
      if (quickSwitcherOpen) {
        setQuickSwitcherOpen(false);
        return true;
      }
      return false;
    },
    enabled: true,
  });

  const worldStyle = useMemo(() => ({
    transform: `translate(${canvasWorkspace.viewport.tx}px, ${canvasWorkspace.viewport.ty}px) scale(${canvasWorkspace.viewport.zoom})`,
    transformOrigin: '0 0',
  }), [canvasWorkspace.viewport.tx, canvasWorkspace.viewport.ty, canvasWorkspace.viewport.zoom]);

  const selectionRect: CanvasRect | null = useMemo(() => {
    if (!dragState || dragState.type !== 'select') {
      return null;
    }

    return normalizeCanvasRect(
      dragState.startWorldX,
      dragState.startWorldY,
      dragState.currentWorldX,
      dragState.currentWorldY,
    );
  }, [dragState]);

  return (
    <div className="absolute inset-0 overflow-hidden bg-[linear-gradient(180deg,color-mix(in_srgb,rgb(var(--background))_88%,transparent)_0%,color-mix(in_srgb,rgb(var(--card))_82%,transparent)_100%)]">
      {titleBarActions}
      <div className="pointer-events-none absolute inset-0 opacity-[0.28]" style={{ background: 'radial-gradient(circle at top, rgb(var(--primary) / 0.14), transparent 30%)' }} />
      <div className="absolute left-5 top-4 z-20 flex max-w-[calc(100%-2.5rem)] items-center gap-3">
        <div className="pointer-events-none flex items-center gap-3 rounded-full border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--background))_76%,transparent)] px-4 py-2 text-sm text-[rgb(var(--muted-foreground))] shadow-[0_10px_28px_rgba(0,0,0,0.18)] backdrop-blur">
          <span className="font-medium text-[rgb(var(--foreground))]">{canvasWorkspace.name}</span>
          <span className="text-[rgb(var(--muted-foreground))]">·</span>
          <span>{t('canvas.blockCount', { count: canvasWorkspace.blocks.length })}</span>
          <span className="text-[rgb(var(--muted-foreground))]">·</span>
          <span>{formatRelativeTime(canvasWorkspace.updatedAt, language as AppLanguage)}</span>
          {selectedBlockIds.length > 0 && (
            <>
              <span className="text-[rgb(var(--muted-foreground))]">·</span>
              <span>{t('canvas.selectionCount', { count: selectedBlockIds.length })}</span>
            </>
          )}
        </div>
      </div>

      <CanvasArrangeToolbar
        blockCount={canvasWorkspace.blocks.length}
        selectedCount={selectedBlockIds.length}
        zoom={canvasWorkspace.viewport.zoom}
        activeArrangeMode={lastArrangeMode}
        canLinkSelection={selectedBlockIds.length === 2}
        onCreateBlock={() => setCreateDialogOpen(true)}
        onOpenTemplates={() => setTemplatesOpen(true)}
        onOpenActivity={() => setActivityOpen(true)}
        activityCount={workspaceActivity.length}
        onAskAI={() => {
          void askAIForSelection();
        }}
        onSendToNote={sendSelectionToNote}
        onLinkSelection={toggleSelectedBlockLink}
        onExportReport={() => {
          void exportCurrentReport();
        }}
        onArrange={arrangeCanvas}
        onResetZoom={() => updateViewport(canvasWorkspace.viewport.tx, canvasWorkspace.viewport.ty, 1)}
        onZoomIn={() => updateViewport(canvasWorkspace.viewport.tx, canvasWorkspace.viewport.ty, canvasWorkspace.viewport.zoom * 1.12)}
        onZoomOut={() => updateViewport(canvasWorkspace.viewport.tx, canvasWorkspace.viewport.ty, canvasWorkspace.viewport.zoom * 0.88)}
        onFitToContent={fitToContent}
        onDeleteSelected={() => deleteBlocks(selectedBlockIds)}
        onRenameWorkspace={() => {
          setWorkspaceNameDraft(canvasWorkspace.name);
          setWorkspaceRenameOpen(true);
        }}
      />

      <div
        ref={canvasRef}
        className="h-full w-full overflow-hidden"
        onMouseDown={(event) => {
          const shouldPan = event.button === 1 || (event.button === 0 && event.altKey);
          if (shouldPan) {
            setDragState({
              type: 'pan',
              startClientX: event.clientX,
              startClientY: event.clientY,
              initialViewport: canvasWorkspace.viewport,
            });
            return;
          }

          if (event.button !== 0) {
            return;
          }

          const rect = canvasRef.current?.getBoundingClientRect();
          if (!rect) {
            return;
          }

          const worldPoint = getWorldPointFromClient(event.clientX, event.clientY, rect, canvasWorkspace.viewport);
          const additive = event.metaKey || event.ctrlKey || event.shiftKey;

          if (!additive) {
            clearSelection();
          }

          setDragState({
            type: 'select',
            startWorldX: worldPoint.x,
            startWorldY: worldPoint.y,
            currentWorldX: worldPoint.x,
            currentWorldY: worldPoint.y,
            baseSelection: additive ? selectedBlockIds : [],
            additive,
          });
        }}
        onDoubleClick={(event) => {
          if (event.target === event.currentTarget) {
            createNoteAtClient(event.clientX, event.clientY);
          }
        }}
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-50"
          style={{
            backgroundImage: 'radial-gradient(rgb(var(--border) / 0.32) 1px, transparent 1px)',
            backgroundSize: `${24 * canvasWorkspace.viewport.zoom}px ${24 * canvasWorkspace.viewport.zoom}px`,
            backgroundPosition: `${canvasWorkspace.viewport.tx}px ${canvasWorkspace.viewport.ty}px`,
          }}
        />

        {canvasWorkspace.blocks.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6">
            <div className="max-w-md rounded-3xl border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--background))_78%,transparent)] px-8 py-7 text-center text-[rgb(var(--foreground))] shadow-[0_24px_80px_rgba(0,0,0,0.24)] backdrop-blur">
              <div className="text-lg font-semibold">{t('canvas.emptyTitle')}</div>
              <p className="mt-2 text-sm leading-6 text-[rgb(var(--muted-foreground))]">{t('canvas.emptyDescription')}</p>
              <p className="mt-4 text-xs uppercase tracking-[0.2em] text-[rgb(var(--muted-foreground))]">
                {availableWindows.length > 0
                  ? t('canvas.availableWindows')
                  : t('canvas.emptyCreateTerminalHint')}
              </p>
            </div>
          </div>
        )}

        <div className="pointer-events-none absolute inset-0" style={worldStyle}>
          {canvasLinks.length > 0 && (
            <svg className="pointer-events-none absolute inset-0 overflow-visible">
              {canvasLinks.map((link) => {
                const fromBlock = blockMap.get(link.fromBlockId);
                const toBlock = blockMap.get(link.toBlockId);
                if (!fromBlock || !toBlock) {
                  return null;
                }

                const geometry = buildCanvasLinkGeometry(fromBlock, toBlock);
                const isSelected = selectedBlockIds.includes(link.fromBlockId) || selectedBlockIds.includes(link.toBlockId);
                return (
                  <g key={link.id}>
                    <path
                      data-testid="canvas-link-path"
                      d={geometry.path}
                      fill="none"
                      stroke={isSelected ? 'rgb(var(--primary) / 0.95)' : 'rgb(var(--muted-foreground) / 0.48)'}
                      strokeWidth={isSelected ? 2.5 : 1.75}
                      strokeDasharray={link.kind === 'depends-on' ? '8 6' : undefined}
                      strokeLinecap="round"
                    />
                    <circle
                      data-testid="canvas-link-midpoint"
                      cx={geometry.midpoint.x}
                      cy={geometry.midpoint.y}
                      r={3}
                      fill="rgb(var(--primary) / 0.95)"
                    />
                    {(link.label || link.kind !== 'related') ? (
                      <text
                        x={geometry.midpoint.x + 8}
                        y={geometry.midpoint.y - 8}
                        fill="rgb(var(--foreground) / 0.9)"
                        fontSize="11"
                      >
                        {link.label || link.kind}
                      </text>
                    ) : null}
                  </g>
                );
              })}
            </svg>
          )}

          {selectionRect && (
            <div
              className="pointer-events-none absolute border border-[rgb(var(--primary))]/70 bg-[rgb(var(--primary))]/10"
              style={{
                left: selectionRect.x,
                top: selectionRect.y,
                width: selectionRect.width,
                height: selectionRect.height,
                zIndex: 9999,
              }}
            />
          )}

          {canvasWorkspace.blocks
            .slice()
            .sort((left, right) => left.zIndex - right.zIndex)
            .map((block) => {
              const selected = selectedBlockIds.includes(block.id);
              const linkedWindow = block.type === 'window' ? windowsById.get(block.windowId) : null;
              const workingDirectory = linkedWindow ? getCurrentWindowWorkingDirectory(linkedWindow) : '';
              const statusLabel = linkedWindow
                ? t(getStatusLabelKey(getAggregatedStatus(linkedWindow.layout)))
                : t('status.noOutput');
              const panes = linkedWindow ? getAllPanes(linkedWindow.layout) : [];
              const activePane = linkedWindow
                ? panes.find((pane) => pane.id === linkedWindow.activePaneId) ?? panes[0] ?? null
                : null;
              const outputPreview = activePane?.lastOutput?.trim() ?? '';
              const isChatWindow = activePane?.kind === 'chat';
              const isBrowserWindow = activePane?.kind === 'browser';
              const isCodeWindow = activePane?.kind === 'code';
              const chatMessageCount = activePane?.kind === 'chat' ? (activePane.chat?.messages?.length ?? 0) : 0;
              const lastChatMessage = activePane?.kind === 'chat'
                ? [...(activePane.chat?.messages ?? [])]
                  .reverse()
                  .find((message) => message.role === 'assistant' || message.role === 'user')
                : null;
              const chatPreview = lastChatMessage?.content?.trim() ?? '';
              const title = block.label || (
                block.type === 'window'
                  ? linkedWindow?.name || t('canvas.missingWindow')
                  : t('canvas.noteUntitled')
              );
              const linkedBlockCount = block.type === 'window'
                ? countLinkedWindowBlocks(canvasWorkspace.blocks, block.windowId)
                : 0;
              const blockSummary = buildCanvasBlockSummary(block, windowsById, t);
              const linkedRelationCount = linksByBlockId.get(block.id)?.length ?? 0;
              const isLiveBlockActive = selectedBlockIds[selectedBlockIds.length - 1] === block.id;

              return (
                <CanvasBlockChrome
                  key={block.id}
                  block={block}
                  title={title}
                  showSummaryOverlay={block.type !== 'window'}
                  summary={{
                    ...blockSummary,
                    metrics: [
                      ...(blockSummary.metrics ?? []),
                      ...(linkedRelationCount > 0 ? [{ label: 'Links', value: String(linkedRelationCount) }] : []),
                    ],
                  }}
                  selected={selected}
                  missing={block.type === 'window' && !linkedWindow}
                  editingTitle={editingBlockId === block.id}
                  titleEditor={editingBlockId === block.id ? (
                    <input
                      value={draftBlockTitle}
                      autoFocus
                      onChange={(event) => setDraftBlockTitle(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          commitBlockTitle(block, title);
                        }

                        if (event.key === 'Escape') {
                          event.preventDefault();
                          cancelBlockTitleEdit();
                        }
                      }}
                      onBlur={() => commitBlockTitle(block, title)}
                      aria-label={t('canvas.blockTitle')}
                      className="w-full rounded-md border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--background))_76%,transparent)] px-2 py-1 text-sm text-[rgb(var(--foreground))] outline-none focus:border-[rgb(var(--ring))]"
                    />
                  ) : undefined}
                  onMouseDown={(event) => {
                    event.stopPropagation();
                    selectBlock(block.id, event.metaKey || event.ctrlKey || event.shiftKey);
                  }}
                  onHeaderMouseDown={(event) => {
                    event.stopPropagation();

                    const additive = event.metaKey || event.ctrlKey || event.shiftKey;
                    const nextSelection = additive
                      ? (selectedBlockIds.includes(block.id) ? selectedBlockIds : [...selectedBlockIds, block.id])
                      : (selectedBlockIds.includes(block.id) ? selectedBlockIds : [block.id]);

                    setSelectedBlockIds(nextSelection);

                    const elevatedBlocks = bringBlocksToFront(nextSelection);
                    const sourceBlocks = elevatedBlocks.length > 0 ? elevatedBlocks : canvasWorkspace.blocks;
                    const blockMap = new Map(sourceBlocks.map((item) => [item.id, item] as const));

                    setDragState({
                      type: 'move',
                      startClientX: event.clientX,
                      startClientY: event.clientY,
                      blockIds: nextSelection,
                      initialPositions: Object.fromEntries(
                        nextSelection.map((blockId) => {
                          const currentBlock = blockMap.get(blockId);
                          return [blockId, { x: currentBlock?.x ?? 0, y: currentBlock?.y ?? 0 }];
                        }),
                      ),
                    });
                  }}
                  onStartTitleEdit={() => startEditingBlockTitle(block, title)}
                  onResizeMouseDown={(event, direction) => {
                    event.stopPropagation();
                    selectBlock(block.id, false);
                    const elevatedBlocks = bringBlocksToFront([block.id]);
                    const currentBlock = elevatedBlocks.find((item) => item.id === block.id) ?? block;

                    setDragState({
                      type: 'resize',
                      startClientX: event.clientX,
                      startClientY: event.clientY,
                      blockId: block.id,
                      direction,
                      initialBlock: currentBlock,
                    });
                  }}
                  onRemove={() => deleteBlocks([block.id])}
                >
                  {block.type === 'window' ? (
                    block.displayMode === 'live' && linkedWindow && canRenderCanvasLiveWindow(linkedWindow) ? (
                      <div className="flex h-full min-h-0 flex-col">
                        <div className="flex items-center justify-between border-b border-[rgb(var(--border))] px-4 py-2 text-xs text-[rgb(var(--muted-foreground))]">
                          <span className="truncate">{workingDirectory || t('canvas.unnamedWindow')}</span>
                          <button
                            type="button"
                            onMouseDown={(event) => event.stopPropagation()}
                            onClick={() => toggleWindowDisplayMode(block.id, 'summary')}
                            className="rounded-full border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--secondary))_68%,transparent)] px-2.5 py-1 text-[11px] font-medium text-[rgb(var(--foreground))] transition hover:border-[rgb(var(--ring))] hover:bg-[rgb(var(--accent))]"
                          >
                            {t('canvas.closeLive')}
                          </button>
                        </div>
                        <div className="min-h-0 flex-1 overflow-hidden">
                          <div
                            className="h-full w-full"
                            onMouseDown={(event) => {
                              event.stopPropagation();
                              selectBlock(block.id, false);
                            }}
                            onClick={(event) => event.stopPropagation()}
                          >
                            {renderLiveWindow?.(linkedWindow.id, { blockId: block.id, isActive: isLiveBlockActive })}
                          </div>
                        </div>
                      </div>
                    ) : (
                    <div className="flex h-full min-h-0 flex-col p-4 text-sm text-[rgb(var(--muted-foreground))]">
                      <div className="min-h-0 flex-1 overflow-hidden">
                        {linkedWindow ? (
                          isChatWindow ? (
                            <div className="mt-3 flex h-full min-h-0 flex-col overflow-hidden">
                              <div className="shrink-0 space-y-2 text-[rgb(var(--muted-foreground))]">
                                <div>{t('canvas.windowStatus', { status: statusLabel })}</div>
                                <div>{t('canvas.chatMessageCount', { count: chatMessageCount })}</div>
                              </div>
                              <div className="mt-3 min-h-0 flex-1 overflow-hidden rounded-2xl border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--secondary))_44%,transparent)] p-3">
                                {chatPreview ? (
                                  <div className="line-clamp-6 break-words whitespace-pre-wrap text-[rgb(var(--foreground))]">
                                    {chatPreview}
                                  </div>
                                ) : (
                                  <div className="text-[rgb(var(--muted-foreground))]">
                                    {t('canvas.chatOpenHint')}
                                  </div>
                                )}
                              </div>
                            </div>
                          ) : isBrowserWindow ? (
                            <div className="mt-3 space-y-2 text-[rgb(var(--muted-foreground))]">
                              <div>{t('canvas.windowStatus', { status: statusLabel })}</div>
                              <div className="line-clamp-2 break-all">
                                {activePane?.browser?.url || 'N/A'}
                              </div>
                              <div className="line-clamp-3">{t('canvas.browserOpenHint')}</div>
                            </div>
                          ) : isCodeWindow ? (
                            <div className="mt-3 space-y-2 text-[rgb(var(--muted-foreground))]">
                              <div>{t('canvas.windowStatus', { status: statusLabel })}</div>
                              <div className="line-clamp-2 break-all">
                                {t('canvas.windowDirectory', {
                                  path: activePane?.code?.rootPath || workingDirectory || 'N/A',
                                })}
                              </div>
                              <div className="line-clamp-3 break-all">
                                {activePane?.code?.activeFilePath
                                  ? t('canvas.codeOpenHintWithFile', { path: activePane.code.activeFilePath })
                                  : t('canvas.codeOpenHint')}
                              </div>
                            </div>
                          ) : (
                            <div className="mt-3 space-y-2 text-[rgb(var(--muted-foreground))]">
                              <div>{t('canvas.windowStatus', { status: statusLabel })}</div>
                              <div className="line-clamp-2 break-all">
                                {t('canvas.windowDirectory', { path: workingDirectory || 'N/A' })}
                              </div>
                              {outputPreview ? (
                                <div className="line-clamp-3 break-words whitespace-pre-wrap">{outputPreview}</div>
                              ) : null}
                            </div>
                          )
                        ) : (
                          <div className="mt-3 space-y-3 text-[rgb(var(--muted-foreground))]">
                            <div className="line-clamp-3">
                              {t('canvas.windowMissingHint')}
                            </div>
                            <button
                              type="button"
                              onMouseDown={(event) => event.stopPropagation()}
                              onClick={() => setRelinkingBlockId(block.id)}
                              className="inline-flex items-center gap-2 rounded-full border border-[rgb(var(--warning))/0.28] bg-[rgb(var(--warning))/0.10] px-3 py-1.5 text-xs font-medium text-[rgb(var(--foreground))] transition hover:bg-[rgb(var(--warning))/0.16]"
                            >
                              <Link2 size={13} />
                              {t('canvas.relinkWindow')}
                            </button>
                          </div>
                        )}
                      </div>

                      {linkedWindow && (
                        <div
                          data-testid={`canvas-window-footer-${block.id}`}
                          className="mt-4 flex shrink-0 flex-col gap-3 border-t border-[rgb(var(--border))] pt-3"
                        >
                          {!isChatWindow && !isBrowserWindow && !isCodeWindow && workingDirectory ? (
                            <div className="max-w-full truncate rounded-full border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--secondary))_42%,transparent)] px-3 py-1 text-[11px] text-[rgb(var(--muted-foreground))]">
                              {`Dir: ${workingDirectory}`}
                            </div>
                          ) : null}

                          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                            <div className="flex min-w-0 flex-wrap items-center gap-2">
                              <span className="rounded-full border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--secondary))_56%,transparent)] px-2.5 py-1 text-xs text-[rgb(var(--muted-foreground))]">
                                {getWindowKind(linkedWindow)}
                              </span>
                              {linkedBlockCount > 1 && (
                                <span className="rounded-full border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--secondary))_56%,transparent)] px-2.5 py-1 text-xs text-[rgb(var(--muted-foreground))]">
                                  {t('canvas.windowLinkedCount', { count: linkedBlockCount })}
                                </span>
                              )}
                            </div>
                            <div className="flex flex-wrap items-center justify-start gap-2 xl:justify-end">
                              <button
                                type="button"
                                onMouseDown={(event) => event.stopPropagation()}
                                onClick={() => onOpenWindow?.(linkedWindow.id)}
                                className="inline-flex min-w-[104px] flex-1 items-center justify-center gap-2 rounded-full border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--secondary))_68%,transparent)] px-3 py-1.5 text-xs font-medium text-[rgb(var(--foreground))] transition hover:border-[rgb(var(--ring))] hover:bg-[rgb(var(--accent))] sm:flex-none"
                              >
                                <MonitorSmartphone size={13} />
                                {isChatWindow
                                  ? t('canvas.openChat')
                                  : isBrowserWindow
                                    ? t('canvas.openBrowser')
                                    : isCodeWindow
                                      ? t('canvas.openCodeWorkspace')
                                      : t('canvas.openTerminal')}
                              </button>
                              <button
                                type="button"
                                onMouseDown={(event) => event.stopPropagation()}
                                onClick={() => toggleWindowDisplayMode(block.id, 'live')}
                                className="inline-flex min-w-[104px] flex-1 items-center justify-center gap-2 rounded-full border border-[rgb(var(--primary))]/30 bg-[rgb(var(--primary))]/10 px-3 py-1.5 text-xs font-medium text-[rgb(var(--primary))] transition hover:bg-[rgb(var(--primary))]/16 sm:flex-none"
                              >
                                <MonitorSmartphone size={13} />
                                {isChatWindow
                                  ? t('canvas.openLiveChat')
                                  : isBrowserWindow
                                    ? t('canvas.openLiveBrowser')
                                    : isCodeWindow
                                      ? t('canvas.openLiveCodeWorkspace')
                                      : t('canvas.openLive')}
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                    )
                  ) : (
                    <div className="flex h-full flex-col">
                      <div className="px-4 pt-3 text-xs uppercase tracking-[0.18em] text-[rgb(var(--muted-foreground))]">
                        <StickyNote size={12} className="mr-2 inline" />
                        {t('canvas.defaultNoteTitle')}
                      </div>
                      {blockSummary.bullets?.length ? (
                        <div className="px-4 pt-2 text-xs text-[rgb(var(--muted-foreground))]">
                          {blockSummary.bullets.slice(0, 2).map((bullet) => (
                            <div key={bullet} className="line-clamp-1">{bullet}</div>
                          ))}
                        </div>
                      ) : null}
                      <textarea
                        value={block.content}
                        onMouseDown={(event) => {
                          event.stopPropagation();
                          selectBlock(block.id, false);
                        }}
                        onChange={(event) => updateSingleBlock(block.id, { content: event.target.value })}
                        placeholder={t('canvas.notePlaceholder')}
                        className="pointer-events-auto h-full w-full resize-none border-0 bg-transparent px-4 pb-4 pt-2 text-sm text-[rgb(var(--foreground))] outline-none placeholder:text-[rgb(var(--muted-foreground))]"
                      />
                    </div>
                  )}
                </CanvasBlockChrome>
              );
            })}
        </div>
      </div>

      <CanvasMinimap
        blocks={canvasWorkspace.blocks}
        viewport={canvasWorkspace.viewport}
        canvasSize={canvasSize}
        onPan={(tx, ty) => updateViewport(tx, ty, canvasWorkspace.viewport.zoom)}
      />

      <CanvasWindowPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        windows={availableWindows}
        onPick={addWindowBlock}
      />

      <CanvasCreateBlockDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        sshProfiles={sshProfiles}
        hasAvailableWindows={availableWindows.length > 0}
        initialWorkingDirectory={canvasWorkspace.workingDirectory}
        onCreateWindow={handleCreateWindowBlock}
        onOpenWindowPicker={() => setPickerOpen(true)}
        onCreateNote={() => {
          const rect = canvasRef.current?.getBoundingClientRect();
          if (!rect) {
            return;
          }

          createNoteAtClient(rect.left + rect.width / 2, rect.top + rect.height / 2);
        }}
      />

      <CanvasWindowPickerDialog
        open={Boolean(relinkingBlockId)}
        onOpenChange={(open) => {
          if (!open) {
            setRelinkingBlockId(null);
          }
        }}
        title={t('canvas.relinkWindow')}
        description={t('canvas.windowRelinkDescription')}
        windows={relinkAvailableWindows}
        onPick={(windowId) => {
          if (relinkingBlockId) {
            relinkWindowBlock(relinkingBlockId, windowId);
          }
        }}
      />

      <Dialog
        open={templatesOpen}
        onOpenChange={setTemplatesOpen}
        title={t('canvas.templates')}
        description={t('canvas.templatesDescription')}
        contentClassName="!max-w-5xl"
        showCloseButton
        closeLabel={t('common.close')}
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm text-[rgb(var(--muted-foreground))]">
              {t('canvas.templateCount', { count: resolvedTemplates.length })}
            </div>
            <button
              type="button"
              onClick={handleSaveCurrentAsTemplate}
              className={idePopupActionButtonClassName()}
            >
              <Save size={14} />
              {t('canvas.saveAsTemplate')}
            </button>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {resolvedTemplates.map((template) => (
              <div key={template.id} className={`${idePopupCardClassName} rounded-2xl p-4`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-[rgb(var(--foreground))]">{template.name}</div>
                    {template.description ? (
                      <p className="mt-1 text-sm leading-6 text-[rgb(var(--muted-foreground))]">{template.description}</p>
                    ) : null}
                  </div>
                  {!template.system ? (
                    <button
                      type="button"
                      onClick={() => removeCanvasWorkspaceTemplate(template.id)}
                      className={idePopupSecondaryButtonClassName}
                    >
                      {t('common.delete')}
                    </button>
                  ) : null}
                </div>
                <div className="mt-3 text-xs text-[rgb(var(--muted-foreground))]">
                  {t('canvas.templateBlockCount', { count: template.blocks.length })}
                </div>
                <div className="mt-4 flex items-center justify-end">
                  <button
                    type="button"
                    onClick={() => handleApplyTemplate(template.id)}
                    className={idePopupActionButtonClassName()}
                  >
                    {t('canvas.applyTemplate')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Dialog>

      <Dialog
        open={activityOpen}
        onOpenChange={setActivityOpen}
        title={t('canvas.activity')}
        description={t('canvas.activityDescription')}
        contentClassName="!max-w-3xl"
        showCloseButton
        closeLabel={t('common.close')}
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm text-[rgb(var(--muted-foreground))]">
              {t('canvas.activityWithCount', { count: workspaceActivity.length })}
            </div>
            <button
              type="button"
              onClick={() => clearCanvasActivity(canvasWorkspace.id)}
              className={idePopupSecondaryButtonClassName}
            >
              {t('canvas.clearActivity')}
            </button>
          </div>
          {workspaceActivity.length === 0 ? (
            <div className="rounded-2xl border border-[rgb(var(--border))] px-4 py-6 text-sm text-[rgb(var(--muted-foreground))]">
              {t('canvas.emptyActivity')}
            </div>
          ) : (
            <div className="space-y-3">
              {workspaceActivity.map((event) => (
                <div key={event.id} className={`${idePopupCardClassName} rounded-2xl p-4`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-sm font-medium text-[rgb(var(--foreground))]">
                        <Activity size={14} />
                        <span className="truncate">{event.title}</span>
                      </div>
                      {event.message ? (
                        <p className="mt-1 text-sm leading-6 text-[rgb(var(--muted-foreground))]">{event.message}</p>
                      ) : null}
                    </div>
                    <div className="shrink-0 text-xs text-[rgb(var(--muted-foreground))]">
                      {formatRelativeTime(event.timestamp, language as AppLanguage)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Dialog>

      <Dialog
        open={workspaceRenameOpen}
        onOpenChange={setWorkspaceRenameOpen}
        title={t('canvas.renameWorkspace')}
        description={t('canvas.renameWorkspaceDescription')}
        contentClassName="!max-w-lg"
        showCloseButton
        closeLabel={t('common.close')}
      >
        <div className="space-y-4">
          <input
            value={workspaceNameDraft}
            onChange={(event) => setWorkspaceNameDraft(event.target.value)}
            autoFocus
            aria-label={t('canvas.workspaceName')}
            className={idePopupInputClassName}
          />
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => setWorkspaceRenameOpen(false)}
              className={idePopupSecondaryButtonClassName}
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={handleWorkspaceRenameSave}
              className={idePopupActionButtonClassName()}
            >
              {t('common.save')}
            </button>
          </div>
        </div>
      </Dialog>

      {quickSwitcherOpen && (
        <React.Suspense fallback={null}>
          <LazyQuickSwitcher
            isOpen={quickSwitcherOpen}
            currentWindowId={null}
            currentCanvasWorkspaceId={canvasWorkspace.id}
            sshProfiles={sshProfiles}
            onSelect={(windowId) => onOpenWindow?.(windowId)}
            onSelectGroup={onOpenGroup}
            onSelectCanvas={onOpenCanvasWorkspace}
            onSelectSSHProfile={onSelectSSHProfile}
            onClose={() => setQuickSwitcherOpen(false)}
          />
        </React.Suspense>
      )}
    </div>
  );
};
