import React, { useEffect, useLayoutEffect, useRef, useCallback, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '../utils/xtermAddonFit';
import { GripVertical, Languages, Loader2, MessageCircle, X } from 'lucide-react';
import { Pane, WindowStatus } from '../types/window';
import { useI18n } from '../i18n';
import { subscribeToPanePtyData } from '../api/ptyDataBus';
import type { PtyDataPayload, PtyHistorySnapshot, PtyKeyboardProtocolState } from '../../shared/types/electron-api';
import type { TerminalScreenSnapshot } from '../../shared/remote/terminal-protocol';
import { ensureTerminalFontsLoaded, TERMINAL_FONT_FAMILY } from '../utils/terminalFonts';
import { onTerminalSettingsUpdated } from '../utils/terminalSettingsEvents';
import { installTerminalImeFix, type ImeCompositionState } from '../utils/terminalImeFix';
import {
  createTerminalLinkHandler,
  registerTerminalWebLinks,
  type TerminalLinkInteractionPayload,
} from '../utils/terminalLinks';
import { AppTooltip } from './ui/AppTooltip';
import { useWindowStore } from '../stores/windowStore';
import { WORKSPACE_SETTINGS_UPDATED_EVENT } from '../utils/settingsEvents';
import { setBrowserDropDragActive } from '../utils/browserDropDragState';
import {
  applyTerminalInputToSSHCwdTracker,
  createSSHCwdTrackerState,
  extractLatestOsc7RemoteCwd,
  updateSSHCwdTrackerFromRuntimeCwd,
} from '../utils/sshCwdTracking';
import { isInactiveTerminalPaneStatus } from '../utils/windowLifecycle';
import '../styles/xterm.css';
import { dispatchAppError, dispatchAppSuccess } from '../utils/appNotice';
import type { SSHClipboardImageShortcut } from '../../shared/types/workspace';
import {
  ACTIVE_TERMINAL_FOCUS_REQUEST_EVENT,
  matchesActiveTerminalFocusRequest,
} from '../utils/terminalFocus';
import { createTerminalOsc8Guard, OSC8_HYPERLINK_CLOSE } from '../utils/terminalOsc8Guard';
import { installTerminalScrollbackPreservation } from '../utils/terminalScrollbackPreservation';
import { writeTerminalWithResizeControls } from '../utils/terminalResizeControl';
import { renderMarkdownLike } from './agent/RichText';

const completedReplaySessions = new Set<string>();
const DIRECT_LIVE_OUTPUT_MAX_CHARS = 256;
const DIRECT_LIVE_OUTPUT_IDLE_MS = 12;
const VISIBLE_TERMINAL_REPAINT_DELAY_MS = 120;
const PROGRAMMATIC_FOCUS_REPORT_SUPPRESSION_MS = 120;
const SELECTION_AI_OVERLAY_MARGIN = 6;
const SELECTION_AI_OVERLAY_POINTER_GAP = 10;
const SELECTION_AI_OVERLAY_MIN_WIDTH = 180;
const SELECTION_AI_OVERLAY_MAX_WIDTH = 380;
const SELECTION_AI_OVERLAY_DEFAULT_HEIGHT = 42;
const SELECTION_AI_OVERLAY_HEADER_CHROME_HEIGHT = 58;
const SELECTION_AI_OVERLAY_MIN_CONTENT_HEIGHT = 40;
const SELECTION_AI_OVERLAY_MAX_CONTENT_HEIGHT = 256;
const REPLAY_PROTOCOL_QUERY_PATTERN = new RegExp(
  [
    '\\x1b\\[(?:[>=])?c',
    '\\x1b\\[\\?u',
  ].join('|'),
  'g',
);
const XTERM_FOCUS_IN_REPORT = '\u001b[I';
const XTERM_FOCUS_OUT_REPORT = '\u001b[O';
const TERMINAL_SCREEN_SNAPSHOT_MIN_INTERVAL_MS = 250;
const ALTERNATE_SCREEN_MODE_PATTERN = /\x1b\[\?(?:[0-9;]*;)?(?:47|1047|1048|1049)(?:;[0-9;]*)?[hl]/;

function getDefaultSSHClipboardImageShortcut(platform: string | undefined): SSHClipboardImageShortcut {
  return platform === 'darwin' ? 'ctrl-v' : 'alt-v';
}

function matchesSSHClipboardImageShortcut(
  event: KeyboardEvent,
  shortcut: SSHClipboardImageShortcut,
  isMac: boolean,
): boolean {
  if (event.type !== 'keydown' || event.key.toLowerCase() !== 'v') {
    return false;
  }

  switch (shortcut) {
    case 'alt-v':
      return event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
    case 'ctrl-v':
      return event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey;
    case 'ctrl-alt-v':
      return event.ctrlKey && event.altKey && !event.metaKey && !event.shiftKey;
    case 'cmd-shift-v':
      return isMac && event.metaKey && event.shiftKey && !event.ctrlKey && !event.altKey;
    default:
      return false;
  }
}

function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }

  return Date.now();
}

function isVisibleTerminalContainer(container: HTMLElement): boolean {
  if (container.clientWidth <= 0 || container.clientHeight <= 0) {
    return false;
  }

  const style = window.getComputedStyle(container);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

function refreshTerminalViewport(terminal: Terminal): void {
  if (terminal.rows > 0 && typeof terminal.refresh === 'function') {
    terminal.refresh(0, terminal.rows - 1);
  }
}

function isXtermFocusReport(data: string): boolean {
  return data === XTERM_FOCUS_IN_REPORT || data === XTERM_FOCUS_OUT_REPORT;
}

function getReplaySessionKey(windowId: string, paneId: string, pid: number | null | undefined): string | null {
  if (pid === null || pid === undefined) {
    return null;
  }

  return `${windowId}:${paneId}:${pid}`;
}

function sanitizeTerminalSnapshotLine(text: string): string {
  return text.replace(/\x1b/g, '\u241b').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
}

function createAlternateTerminalScreenSnapshot(
  windowId: string,
  paneId: string,
  terminal: Terminal,
  outputSeq: number,
): TerminalScreenSnapshot | null {
  const buffer = terminal.buffer?.active;
  if (!buffer || buffer.type !== 'alternate') {
    return null;
  }

  const cols = Math.max(1, Math.floor(terminal.cols || 1));
  const rows = Math.max(1, Math.floor(terminal.rows || 1));
  const cursorX = clampNumber(buffer.cursorX ?? 0, 0, Math.max(0, cols - 1));
  const cursorY = clampNumber(buffer.cursorY ?? 0, 0, Math.max(0, rows - 1));
  const lines: string[] = [];
  for (let row = 0; row < rows; row += 1) {
    const line = buffer.getLine(row);
    lines.push(sanitizeTerminalSnapshotLine(line?.translateToString(true, 0, cols) ?? ''));
  }

  return {
    windowId,
    paneId,
    cols,
    rows,
    cursorX,
    cursorY,
    alternate: true,
    data: `\x1b[?1049h\x1b[2J\x1b[H${lines.join('\r\n')}\x1b[${cursorY + 1};${cursorX + 1}H`,
    capturedAt: new Date().toISOString(),
    outputSeq,
  };
}

function shouldCaptureTerminalScreenSnapshot(
  terminal: Terminal,
  data: string,
  hasSnapshot: boolean,
): boolean {
  return terminal.buffer?.active?.type === 'alternate' || hasSnapshot || ALTERNATE_SCREEN_MODE_PATTERN.test(data);
}

export function __resetTerminalPaneReplaySessionCacheForTests(): void {
  completedReplaySessions.clear();
}

/**
 * 根据窗格状态获取顶部边框颜色
 */
function getStatusBorderColor(status: WindowStatus): string {
  switch (status) {
    case WindowStatus.Running:
      return 'border-t-[rgb(var(--appearance-running-accent-rgb))]';
    case WindowStatus.WaitingForInput:
      return 'border-t-[rgb(var(--primary))]';
    case WindowStatus.Completed:
      return 'border-t-[rgb(var(--muted-foreground))]';
    case WindowStatus.Error:
      return 'border-t-[rgb(var(--error))]';
    case WindowStatus.Restoring:
      return 'border-t-[rgb(var(--warning))]';
    default:
      return 'border-t-[rgb(var(--border))]';
  }
}

/**
 * 将 hex 颜色转换为 Tailwind 边框类（如果是自定义颜色则返回 inline style）
 */
function getCustomBorderStyle(color?: string): { className?: string; style?: React.CSSProperties } {
  if (!color) {
    return {};
  }

  // 如果是 hex 颜色，使用 inline style
  if (color.startsWith('#')) {
    return {
      style: { borderTopColor: color }
    };
  }

  return {};
}

function getActivePaneStyle(color?: string): React.CSSProperties | undefined {
  if (!color || !color.startsWith('#')) {
    return undefined;
  }

  return {
    boxShadow: `0 0 0 1px ${color}`,
  };
}

function clampNumber(value: number, min: number, max: number): number {
  if (max <= min) {
    return min;
  }

  return Math.min(Math.max(value, min), max);
}

function readTerminalViewportY(terminal: Terminal): number | null {
  const viewportY = terminal.buffer?.active?.viewportY;
  return typeof viewportY === 'number' && Number.isFinite(viewportY) ? viewportY : null;
}

function readTerminalBaseY(terminal: Terminal): number | null {
  const baseY = terminal.buffer?.active?.baseY;
  return typeof baseY === 'number' && Number.isFinite(baseY) ? baseY : null;
}

function restoreTerminalViewportY(terminal: Terminal, viewportY: number | null): void {
  if (viewportY === null || !Number.isFinite(viewportY)) {
    return;
  }

  const baseY = terminal.buffer?.active?.baseY;
  const maxViewportY = typeof baseY === 'number' && Number.isFinite(baseY)
    ? baseY
    : viewportY;
  const targetViewportY = Math.round(clampNumber(viewportY, 0, Math.max(0, maxViewportY)));
  if (readTerminalViewportY(terminal) === targetViewportY) {
    return;
  }

  terminal.scrollToLine(targetViewportY);
}

type TerminalViewportContentAnchor = {
  text: string;
  rowOffset: number;
  absoluteViewportY: number;
  rowsFromBottom: number;
};

function terminalViewportAnchorLineText(terminal: Terminal, row: number): string {
  try {
    return terminal.buffer.active.getLine(row)?.translateToString(true).slice(0, 512) ?? '';
  } catch {
    return '';
  }
}

function captureTerminalViewportContentAnchor(terminal: Terminal): TerminalViewportContentAnchor {
  const buffer = terminal.buffer.active;
  const viewportY = Math.max(0, buffer.viewportY);
  const baseY = Math.max(0, buffer.baseY);
  const visibleEnd = Math.min(buffer.length, viewportY + Math.max(1, terminal.rows));
  for (let row = viewportY; row < visibleEnd; row += 1) {
    const text = terminalViewportAnchorLineText(terminal, row);
    if (text) {
      return {
        text,
        rowOffset: row - viewportY,
        absoluteViewportY: viewportY,
        rowsFromBottom: Math.max(0, baseY - viewportY),
      };
    }
  }
  return {
    text: '',
    rowOffset: 0,
    absoluteViewportY: viewportY,
    rowsFromBottom: Math.max(0, baseY - viewportY),
  };
}

function restoreTerminalViewportContentAnchor(
  terminal: Terminal,
  anchor: TerminalViewportContentAnchor,
): void {
  const buffer = terminal.buffer.active;
  const baseY = Math.max(0, buffer.baseY);
  const fallbackY = baseY - anchor.rowsFromBottom;
  const expectedRow = fallbackY + anchor.rowOffset;
  let matchedRow = -1;
  if (anchor.text && buffer.length > 0) {
    const center = Math.round(clampNumber(expectedRow, 0, buffer.length - 1));
    const maxRadius = Math.min(buffer.length - 1, 12_000);
    for (let radius = 0; radius <= maxRadius; radius += 1) {
      const before = center - radius;
      if (before >= 0 && terminalViewportAnchorLineText(terminal, before) === anchor.text) {
        matchedRow = before;
        break;
      }
      const after = center + radius;
      if (
        radius > 0
        && after < buffer.length
        && terminalViewportAnchorLineText(terminal, after) === anchor.text
      ) {
        matchedRow = after;
        break;
      }
    }
  }
  const targetY = matchedRow >= 0
    ? matchedRow - anchor.rowOffset
    : Number.isFinite(fallbackY)
      ? fallbackY
      : anchor.absoluteViewportY;
  restoreTerminalViewportY(terminal, targetY);
}

/**
 * 根据窗格状态获取选中时的边框颜色
 */
function getStatusRingColor(status: WindowStatus): string {
  switch (status) {
    case WindowStatus.Running:
      return 'ring-[rgb(var(--appearance-running-accent-rgb))]';
    case WindowStatus.WaitingForInput:
      return 'ring-[rgb(var(--primary))]';
    case WindowStatus.Completed:
      return 'ring-[rgb(var(--muted-foreground))]';
    case WindowStatus.Error:
      return 'ring-[rgb(var(--error))]';
    case WindowStatus.Restoring:
      return 'ring-[rgb(var(--warning))]';
    default:
      return 'ring-[rgb(var(--border))]';
  }
}

function extractPtyHistorySnapshot(response: unknown): PtyHistorySnapshot {
  if (Array.isArray(response)) {
    return {
      chunks: response.filter((chunk): chunk is string => typeof chunk === 'string'),
      firstSeq: 0,
      lastSeq: 0,
      evictedBeforeSeq: 0,
    };
  }

  if (
    response
    && typeof response === 'object'
    && 'success' in response
    && (response as { success?: boolean }).success
  ) {
    const data = (response as { data?: unknown }).data;
    if (
      data
      && typeof data === 'object'
      && 'chunks' in data
      && 'lastSeq' in data
      && Array.isArray((data as { chunks?: unknown }).chunks)
      && typeof (data as { lastSeq?: unknown }).lastSeq === 'number'
    ) {
      const snapshot = data as {
        chunks: unknown[];
        firstSeq?: unknown;
        lastSeq: number;
        evictedBeforeSeq?: unknown;
      };
      return {
        chunks: snapshot.chunks.filter((chunk): chunk is string => typeof chunk === 'string'),
        firstSeq: typeof snapshot.firstSeq === 'number'
          ? snapshot.firstSeq
          : 0,
        lastSeq: snapshot.lastSeq,
        evictedBeforeSeq: typeof snapshot.evictedBeforeSeq === 'number'
          ? snapshot.evictedBeforeSeq
          : 0,
        keyboardState: extractKeyboardProtocolState(data),
      };
    }

    if (Array.isArray(data)) {
      return {
        chunks: data.filter((chunk): chunk is string => typeof chunk === 'string'),
        firstSeq: 0,
        lastSeq: 0,
        evictedBeforeSeq: 0,
      };
    }
  }

  return {
    chunks: [],
    firstSeq: 0,
    lastSeq: 0,
    evictedBeforeSeq: 0,
  };
}

function extractKeyboardProtocolState(data: unknown): PtyKeyboardProtocolState | undefined {
  if (!data || typeof data !== 'object' || !('keyboardState' in data)) {
    return undefined;
  }

  const keyboardState = (data as { keyboardState?: unknown }).keyboardState;
  if (!keyboardState || typeof keyboardState !== 'object') {
    return undefined;
  }

  const kittyKeyboard = (keyboardState as { kittyKeyboard?: unknown }).kittyKeyboard;
  if (!kittyKeyboard || typeof kittyKeyboard !== 'object') {
    return undefined;
  }

  const state = keyboardState as {
    applicationCursorKeysMode?: unknown;
    applicationKeypadMode?: unknown;
    bracketedPasteMode?: unknown;
    sendFocusMode?: unknown;
    win32InputMode?: unknown;
    mouseTracking?: unknown;
  };
  const mouseTracking = state.mouseTracking as {
    protocol?: unknown;
    encoding?: unknown;
  } | undefined;
  const kitty = kittyKeyboard as {
    flags?: unknown;
    mainFlags?: unknown;
    altFlags?: unknown;
    mainStack?: unknown;
    altStack?: unknown;
  };

  if (
    typeof state.win32InputMode !== 'boolean'
    || typeof kitty.flags !== 'number'
    || typeof kitty.mainFlags !== 'number'
    || typeof kitty.altFlags !== 'number'
    || !Array.isArray(kitty.mainStack)
    || !Array.isArray(kitty.altStack)
  ) {
    return undefined;
  }

  return {
    applicationCursorKeysMode: typeof state.applicationCursorKeysMode === 'boolean'
      ? state.applicationCursorKeysMode
      : false,
    applicationKeypadMode: typeof state.applicationKeypadMode === 'boolean'
      ? state.applicationKeypadMode
      : false,
    bracketedPasteMode: typeof state.bracketedPasteMode === 'boolean'
      ? state.bracketedPasteMode
      : false,
    sendFocusMode: typeof state.sendFocusMode === 'boolean'
      ? state.sendFocusMode
      : false,
    win32InputMode: state.win32InputMode,
    mouseTracking: {
      protocol: mouseTracking?.protocol === 'X10'
        || mouseTracking?.protocol === 'VT200'
        || mouseTracking?.protocol === 'DRAG'
        || mouseTracking?.protocol === 'ANY'
        ? mouseTracking.protocol
        : 'NONE',
      encoding: mouseTracking?.encoding === 'SGR' || mouseTracking?.encoding === 'SGR_PIXELS'
        ? mouseTracking.encoding
        : 'DEFAULT',
    },
    kittyKeyboard: {
      flags: kitty.flags,
      mainFlags: kitty.mainFlags,
      altFlags: kitty.altFlags,
      mainStack: kitty.mainStack.filter((entry): entry is number => typeof entry === 'number'),
      altStack: kitty.altStack.filter((entry): entry is number => typeof entry === 'number'),
    },
  };
}

function stripReplayProtocolQueries(data: string): string {
  if (!data) {
    return data;
  }

  return data.replace(REPLAY_PROTOCOL_QUERY_PATTERN, '');
}

type TerminalCoreKeyboardState = {
  decPrivateModes?: {
    applicationCursorKeys?: boolean;
    applicationKeypad?: boolean;
    bracketedPasteMode?: boolean;
    sendFocus?: boolean;
    win32InputMode?: boolean;
  };
  kittyKeyboard?: {
    flags: number;
    mainFlags: number;
    altFlags: number;
    mainStack: number[];
    altStack: number[];
  };
};

type TerminalWithKeyboardState = Terminal & {
  _core?: {
    coreService?: TerminalCoreKeyboardState;
    coreMouseService?: {
      activeProtocol: string;
      activeEncoding: string;
    };
  };
};

type TerminalRenderServiceRecovery = {
  _isPaused?: boolean;
  _needsFullRefresh?: boolean;
  _pausedResizeTask?: {
    flush?: () => void;
  };
  handleDevicePixelRatioChange?: () => void;
  handleResize?: (cols: number, rows: number) => void;
  refreshRows?: (start: number, end: number, sync?: boolean) => void;
};

type TerminalWithRenderService = Terminal & {
  _core?: {
    _renderService?: TerminalRenderServiceRecovery;
  };
};

function getTerminalRenderService(terminal: Terminal): TerminalRenderServiceRecovery | undefined {
  return (terminal as TerminalWithRenderService)._core?._renderService;
}

function terminalRenderSurfaceNeedsRecovery(terminal: Terminal): boolean {
  const renderService = getTerminalRenderService(terminal);
  return Boolean(renderService?._isPaused || renderService?._needsFullRefresh);
}

function resetTerminalKeyboardProtocolState(terminal: Terminal): void {
  applyTerminalKeyboardProtocolState(terminal, {
    applicationCursorKeysMode: false,
    applicationKeypadMode: false,
    bracketedPasteMode: false,
    sendFocusMode: false,
    win32InputMode: false,
    mouseTracking: {
      protocol: 'NONE',
      encoding: 'DEFAULT',
    },
    kittyKeyboard: {
      flags: 0,
      mainFlags: 0,
      altFlags: 0,
      mainStack: [],
      altStack: [],
    },
  });
}

function applyTerminalKeyboardProtocolState(terminal: Terminal, state: PtyKeyboardProtocolState | undefined): void {
  if (!state) {
    return;
  }

  const core = (terminal as TerminalWithKeyboardState)._core;
  const coreState = core?.coreService;
  if (!coreState) {
    return;
  }

  if (coreState.decPrivateModes) {
    coreState.decPrivateModes.applicationCursorKeys = state.applicationCursorKeysMode;
    coreState.decPrivateModes.applicationKeypad = state.applicationKeypadMode;
    coreState.decPrivateModes.bracketedPasteMode = state.bracketedPasteMode;
    coreState.decPrivateModes.sendFocus = state.sendFocusMode;
    coreState.decPrivateModes.win32InputMode = state.win32InputMode;
  }

  if (core?.coreMouseService) {
    core.coreMouseService.activeProtocol = state.mouseTracking.protocol;
    core.coreMouseService.activeEncoding = state.mouseTracking.encoding;
  }

  if (coreState.kittyKeyboard) {
    coreState.kittyKeyboard.flags = state.kittyKeyboard.flags;
    coreState.kittyKeyboard.mainFlags = state.kittyKeyboard.mainFlags;
    coreState.kittyKeyboard.altFlags = state.kittyKeyboard.altFlags;
    coreState.kittyKeyboard.mainStack.length = 0;
    coreState.kittyKeyboard.mainStack.push(...state.kittyKeyboard.mainStack);
    coreState.kittyKeyboard.altStack.length = 0;
    coreState.kittyKeyboard.altStack.push(...state.kittyKeyboard.altStack);
  }
}

function recoverTerminalRenderSurface(terminal: Terminal): void {
  if (terminal.rows <= 0) {
    return;
  }

  const renderService = getTerminalRenderService(terminal);
  if (!renderService) {
    refreshTerminalViewport(terminal);
    return;
  }

  try {
    // xterm's public refresh queues a full refresh but returns while its render service is paused.
    // When IntersectionObserver misses the visible transition, mirror xterm's own resume path.
    renderService._isPaused = false;
    renderService._pausedResizeTask?.flush?.();
    renderService.handleResize?.(terminal.cols, terminal.rows);
    renderService.handleDevicePixelRatioChange?.();
    renderService.refreshRows?.(0, terminal.rows - 1, true);
    renderService._needsFullRefresh = false;
  } catch {
    // Fall back to the public API if the vendored xterm internals change.
  }

  refreshTerminalViewport(terminal);
}

function readRootCssColor(variableName: string, fallback: string): string {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return fallback;
  }

  const value = window.getComputedStyle(document.documentElement).getPropertyValue(variableName).trim();
  return value || fallback;
}

function normalizeTerminalPasteText(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, '\r');
}

function wrapBracketedPasteText(text: string): string {
  return `\x1b[200~${text.replace(/\x1b/g, '\u241b')}\x1b[201~`;
}

function getWindowsTerminalTheme() {
  return {
    background: 'transparent',
    foreground: readRootCssColor('--terminal-foreground', '#cccccc'),
    cursor: readRootCssColor('--terminal-cursor', '#f2f2f2'),
    cursorAccent: readRootCssColor('--terminal-cursor-accent', '#0c0c0c'),
    selectionBackground: readRootCssColor('--terminal-selection', 'rgba(204, 204, 204, 0.28)'),
    black: readRootCssColor('--terminal-black', '#0c0c0c'),
    red: readRootCssColor('--terminal-red', '#c50f1f'),
    green: readRootCssColor('--terminal-green', '#13a10e'),
    yellow: readRootCssColor('--terminal-yellow', '#c19c00'),
    blue: readRootCssColor('--terminal-blue', '#0037da'),
    magenta: readRootCssColor('--terminal-magenta', '#881798'),
    cyan: readRootCssColor('--terminal-cyan', '#3a96dd'),
    white: readRootCssColor('--terminal-white', '#cccccc'),
    brightBlack: readRootCssColor('--terminal-bright-black', '#767676'),
    brightRed: readRootCssColor('--terminal-bright-red', '#e74856'),
    brightGreen: readRootCssColor('--terminal-bright-green', '#16c60c'),
    brightYellow: readRootCssColor('--terminal-bright-yellow', '#f9f1a5'),
    brightBlue: readRootCssColor('--terminal-bright-blue', '#3b78ff'),
    brightMagenta: readRootCssColor('--terminal-bright-magenta', '#b4009e'),
    brightCyan: readRootCssColor('--terminal-bright-cyan', '#61d6d6'),
    brightWhite: readRootCssColor('--terminal-bright-white', '#f2f2f2'),
  };
}

interface TerminalLinkDragOverlayState {
  url: string;
  left: number;
  top: number;
}

type TerminalSelectionAiAction = 'translate' | 'explain';

interface TerminalSelectionAiOverlayPosition {
  left: number;
  top: number;
  maxWidth: number;
  maxHeight: number;
  maxContentHeight: number;
}

interface TerminalSelectionAiOverlayState {
  text: string;
  anchorClientX: number;
  anchorClientY: number;
  left: number;
  top: number;
  maxWidth: number;
  maxHeight: number;
  maxContentHeight: number;
  status: 'idle' | 'loading' | 'done' | 'error';
  action?: TerminalSelectionAiAction;
  result?: string;
  error?: string;
}

interface TerminalLinkDragOverlayProps {
  url: string;
  label: string;
  left: number;
  top: number;
  isDragging: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onDragStateChange: (isDragging: boolean) => void;
}

const TerminalLinkDragOverlay: React.FC<TerminalLinkDragOverlayProps> = ({
  url,
  label,
  left,
  top,
  isDragging,
  onMouseEnter,
  onMouseLeave,
  onDragStateChange,
}) => (
  <div
    className="xterm-hover absolute z-30"
    style={{
      left,
      top,
      opacity: isDragging ? 0.72 : 1,
    }}
    onMouseEnter={onMouseEnter}
    onMouseLeave={onMouseLeave}
  >
    <button
      type="button"
      draggable
      aria-label={label}
      title={url}
      className="flex max-w-[260px] cursor-grab items-center gap-2 rounded-full border border-[rgb(var(--primary))]/45 bg-[color-mix(in_srgb,rgb(var(--background))_92%,transparent)] px-2.5 py-1 text-[11px] text-[rgb(var(--primary))] shadow-[0_8px_24px_rgba(2,6,23,0.45)] backdrop-blur active:cursor-grabbing"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onMouseDown={(event) => {
        event.stopPropagation();
      }}
      onDragStart={(event) => {
        event.stopPropagation();
        event.dataTransfer.effectAllowed = 'copy';
        event.dataTransfer.setData('text/uri-list', url);
        event.dataTransfer.setData('text/plain', url);
        setBrowserDropDragActive(true);
        onDragStateChange(true);
      }}
      onDragEnd={() => {
        setBrowserDropDragActive(false);
        onDragStateChange(false);
      }}
    >
      <GripVertical size={12} className="shrink-0 text-[rgb(var(--primary))]" />
      <span className="truncate">{url}</span>
    </button>
  </div>
);

interface TerminalSelectionAiOverlayProps {
  state: TerminalSelectionAiOverlayState;
  overlayRef: React.RefObject<HTMLDivElement | null>;
  onTranslate: () => void;
  onExplain: () => void;
  onClose: () => void;
}

const TerminalSelectionAiOverlay: React.FC<TerminalSelectionAiOverlayProps> = ({
  state,
  overlayRef,
  onTranslate,
  onExplain,
  onClose,
}) => {
  const isLoading = state.status === 'loading';
  const activeActionLabel = state.action === 'explain' ? '解释' : '翻译';

  return (
    <div
      ref={overlayRef}
      className="absolute z-40 overflow-hidden rounded-lg border border-[rgb(var(--border))]/80 bg-[color-mix(in_srgb,rgb(var(--card))_92%,transparent)] text-[rgb(var(--foreground))] shadow-[0_16px_48px_rgba(0,0,0,0.45)] backdrop-blur-xl"
      style={{
        left: state.left,
        top: state.top,
        maxWidth: state.maxWidth,
        maxHeight: state.maxHeight,
        minWidth: Math.min(SELECTION_AI_OVERLAY_MIN_WIDTH, state.maxWidth),
      }}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <div
        className="flex items-center gap-1.5 px-2 py-1.5"
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <button
          type="button"
          className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-[rgb(var(--foreground))] transition-colors hover:bg-[rgb(var(--accent))]"
          disabled={isLoading}
          onClick={onTranslate}
        >
          <Languages size={14} />
          翻译
        </button>
        <button
          type="button"
          className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-[rgb(var(--foreground))] transition-colors hover:bg-[rgb(var(--accent))]"
          disabled={isLoading}
          onClick={onExplain}
        >
          <MessageCircle size={14} />
          解释
        </button>
        <button
          type="button"
          className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-md text-[rgb(var(--muted-foreground))] transition-colors hover:bg-[rgb(var(--accent))] hover:text-[rgb(var(--foreground))]"
          aria-label="关闭"
          onClick={onClose}
        >
          <X size={14} />
        </button>
      </div>

      {(state.status !== 'idle' || state.result || state.error) && (
        <div className="border-t border-[rgb(var(--border))]/70 py-2 pl-3 pr-1">
          {isLoading ? (
            <div className="flex items-center gap-2 text-xs text-[rgb(var(--muted-foreground))]">
              <Loader2 size={14} className="animate-spin" />
              正在生成{activeActionLabel}...
            </div>
          ) : state.status === 'error' ? (
            <div
              className="select-text overflow-auto pr-2 text-xs leading-5 text-[rgb(var(--error))]"
              style={{ maxHeight: state.maxContentHeight }}
            >
              {state.error || '生成失败'}
            </div>
          ) : (
            <div
              className="select-text overflow-auto pr-3 text-sm leading-6 text-[rgb(var(--foreground))]"
              style={{ maxHeight: state.maxContentHeight }}
            >
              {renderMarkdownLike(state.result ?? '')}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export interface TerminalPaneProps {
  windowId: string;
  pane: Pane;
  layoutPaneCount?: number;
  isActive: boolean; // 是否是当前激活的窗格
  isWindowActive: boolean; // 窗口是否是当前激活的窗口
  ptyInputEnabled?: boolean;
  onActivate: () => void; // 点击激活
  onClose?: () => void; // 关闭窗格（可选，最后一个窗格不显示关闭按钮）
  onProcessExit?: () => void; // 进程退出回调（委托父组件处理）
}

/**
 * TerminalPane 组件
 * 渲染单个终端窗格，包含 xterm.js 实例
 */
export const TerminalPane: React.FC<TerminalPaneProps> = ({
  windowId,
  pane,
  layoutPaneCount = 1,
  isActive,
  isWindowActive,
  ptyInputEnabled = true,
  onActivate,
  onClose,
  onProcessExit,
}) => {
  const { t } = useI18n();
  const paneRootRef = useRef<HTMLDivElement>(null);
  const selectionAiOverlayRef = useRef<HTMLDivElement>(null);
  const terminalContainerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const outputChunksRef = useRef<string[]>([]);
  const outputBufferSizeRef = useRef(0);
  const outputBufferLastSeqRef = useRef<number | undefined>(undefined);
  const outputFlushFrameRef = useRef<number | null>(null);
  const screenSnapshotFrameRef = useRef<number | null>(null);
  const screenSnapshotTrailingTimerRef = useRef<number | null>(null);
  const lastScreenSnapshotSentAtRef = useRef(Number.NEGATIVE_INFINITY);
  const lastScreenSnapshotSignatureRef = useRef('');
  const lastLiveOutputQueuedAtRef = useRef(Number.NEGATIVE_INFINITY);
  const resizeFrameRef = useRef<number | null>(null);
  const repaintFrameRef = useRef<number | null>(null);
  const repaintTimerRef = useRef<number | null>(null);
  const staleRenderRecoveryFrameRef = useRef<number | null>(null);
  const lastContainerSizeRef = useRef({ width: 0, height: 0 });
  const lastSyncedTerminalSizeRef = useRef({ cols: 0, rows: 0 });
  const isActiveRef = useRef(isActive); // 使用 ref 跟踪 isActive 状态
  const isWindowActiveRef = useRef(isWindowActive);
  const lastFocusStateRef = useRef({ isActive, isWindowActive });
  const lastWindowActiveForRecoveryRef = useRef(isWindowActive);
  const ptyInputEnabledRef = useRef(ptyInputEnabled);
  const onActivateRef = useRef(onActivate);
  const suppressNativePasteUntilRef = useRef(0); // 短时间屏蔽原生 paste，避免与手动 Ctrl+V 粘贴重复
  const lastStatusRef = useRef<WindowStatus>(pane.status); // 跟踪上一次的状态
  const lastProcessExitStatusRef = useRef<WindowStatus>(pane.status);
  const lastSessionRef = useRef({ pid: pane.pid, status: pane.status });
  const lastLayoutPaneCountRef = useRef(layoutPaneCount);
  const isHistoryLoadedRef = useRef(false);
  const bufferedLiveDataRef = useRef<PtyDataPayload[]>([]);
  const historyReplayTokenRef = useRef(0);
  const lastAppliedSeqRef = useRef(0);
  const lastRenderedSeqRef = useRef(0);
  const suppressPtyWriteRef = useRef(false);
  const suppressProgrammaticFocusReportUntilRef = useRef(0);
  const liveOsc8GuardRef = useRef(createTerminalOsc8Guard());
  const replayOsc8GuardRef = useRef(createTerminalOsc8Guard());
  const lastKnownViewportYRef = useRef<number | null>(null);
  const lastKnownBaseYRef = useRef<number | null>(null);
  const isWindowFocusedRef = useRef(typeof document === 'undefined' ? true : document.hasFocus());
  const isRestoringViewportRef = useRef(false);
  const isVisibleSurfaceRecoveryPendingRef = useRef(false);
  // 区分“当前会话首次回放”和“同一会话后的补回放”：
  // 首次回放可能包含 PowerShell 启动阶段仍在等待响应的 ESC[c，
  // 这时必须允许 xterm 生成的 DA 响应回写到 PTY。
  const hasCompletedReplayForCurrentSessionRef = useRef(false);
  const replaySessionKeyRef = useRef<string | null>(getReplaySessionKey(windowId, pane.id, pane.pid));
  const replayHistoryRef = useRef<((options?: { resetTerminal?: boolean }) => Promise<void>) | null>(null);
  const imeCompositionStateRef = useRef<ImeCompositionState>({ isComposing: false });
  const sshCwdTrackerRef = useRef(createSSHCwdTrackerState(pane.cwd));
  const linkDragOverlayHideTimerRef = useRef<number | null>(null);
  const isLinkDragOverlayHoveredRef = useRef(false);
  const isLinkDragActiveRef = useRef(false);
  const lastTerminalPointerRef = useRef({ clientX: 0, clientY: 0 });
  const isTerminalPointerDownRef = useRef(false);
  const pendingSelectionAiTextRef = useRef<string | null>(null);
  const selectionAiRequestSeqRef = useRef(0);
  const [isHovered, setIsHovered] = useState(false);
  const [linkDragOverlay, setLinkDragOverlay] = useState<TerminalLinkDragOverlayState | null>(null);
  const [isLinkDragActive, setIsLinkDragActive] = useState(false);
  const [selectionAiOverlay, setSelectionAiOverlay] = useState<TerminalSelectionAiOverlayState | null>(null);
  const sshClipboardImageShortcutRef = useRef<SSHClipboardImageShortcut>(getDefaultSSHClipboardImageShortcut(window.electronAPI?.platform));
  const updatePaneRuntime = useWindowStore((state) => state.updatePaneRuntime);

  // 确定边框颜色：优先使用自定义 borderColor，否则使用状态颜色
  const customBorderStyle = getCustomBorderStyle(pane.borderColor);
  const activePaneStyle = isActive ? getActivePaneStyle(pane.activeBorderColor) : undefined;
  const defaultBorderColor = getStatusBorderColor(pane.status);
  const borderColorClass = customBorderStyle.style ? 'border-t-2' : `border-t-2 ${defaultBorderColor}`;
  const ringColor = getStatusRingColor(pane.status);

  // 是否显示 pane header（当有 title 或 agentName 时显示）
  const showPaneHeader = !!(pane.title || pane.agentName);
  const showCloseButton = Boolean(onClose && isHovered);

  const suppressFocusReportsForWindowTransition = useCallback(() => {
    suppressProgrammaticFocusReportUntilRef.current = Math.max(
      suppressProgrammaticFocusReportUntilRef.current,
      nowMs() + PROGRAMMATIC_FOCUS_REPORT_SUPPRESSION_MS,
    );
  }, []);

  const focusTerminalInput = useCallback((options?: { defer?: boolean; onlyWhenOutsidePane?: boolean; suppressFocusReport?: boolean }) => {
    const runFocus = () => {
      const currentTerminal = terminalRef.current;
      if (!currentTerminal) {
        return;
      }

      if (options?.onlyWhenOutsidePane) {
        const paneRoot = paneRootRef.current;
        const activeElement = document.activeElement;
        if (paneRoot && activeElement instanceof Node && paneRoot.contains(activeElement)) {
          return;
        }
      }

      try {
        if (options?.suppressFocusReport) {
          suppressFocusReportsForWindowTransition();
        }

        currentTerminal.focus();

        const textarea = terminalContainerRef.current?.querySelector('textarea');
        if (textarea instanceof HTMLElement && typeof textarea.focus === 'function') {
          textarea.focus({ preventScroll: true });
        }
      } catch (error) {
        console.error(`[TerminalPane] Error focusing pane ${pane.id}:`, error);
      }
    };

    if (options?.defer) {
      requestAnimationFrame(runFocus);
      return;
    }

    runFocus();
  }, [pane.id, suppressFocusReportsForWindowTransition]);

  const syncPtySize = useCallback((terminal: Terminal, options?: { force?: boolean }) => {
    if (!window.electronAPI) {
      return;
    }

    const { cols, rows } = terminal;
    const lastSize = lastSyncedTerminalSizeRef.current;
    if (!options?.force && lastSize.cols === cols && lastSize.rows === rows) {
      return;
    }

    lastSyncedTerminalSizeRef.current = { cols, rows };
    window.electronAPI.ptyResize(windowId, pane.id, cols, rows);
  }, [pane.id, windowId]);

  const scheduleTerminalScreenSnapshot = useCallback(() => {
    if (screenSnapshotFrameRef.current !== null) {
      return;
    }

    let didRunSynchronously = false;
    const frameId = requestAnimationFrame(() => {
      didRunSynchronously = true;
      screenSnapshotFrameRef.current = null;
      const terminal = terminalRef.current;
      if (!terminal || !window.electronAPI?.updateTerminalScreenSnapshot) {
        return;
      }

      const now = nowMs();
      const snapshot = createAlternateTerminalScreenSnapshot(
        windowId,
        pane.id,
        terminal,
        lastRenderedSeqRef.current,
      );
      if (!snapshot) {
        if (lastScreenSnapshotSignatureRef.current) {
          window.electronAPI.updateTerminalScreenSnapshot({
            windowId,
            paneId: pane.id,
            cols: Math.max(1, Math.floor(terminal.cols || 1)),
            rows: Math.max(1, Math.floor(terminal.rows || 1)),
            cursorX: 0,
            cursorY: 0,
            alternate: false,
            data: '',
            capturedAt: new Date().toISOString(),
            outputSeq: lastRenderedSeqRef.current,
          });
          lastScreenSnapshotSentAtRef.current = now;
        }
        lastScreenSnapshotSignatureRef.current = '';
        return;
      }

      if (now - lastScreenSnapshotSentAtRef.current < TERMINAL_SCREEN_SNAPSHOT_MIN_INTERVAL_MS) {
        if (screenSnapshotTrailingTimerRef.current === null) {
          const delay = Math.max(
            0,
            TERMINAL_SCREEN_SNAPSHOT_MIN_INTERVAL_MS - (now - lastScreenSnapshotSentAtRef.current),
          );
          screenSnapshotTrailingTimerRef.current = window.setTimeout(() => {
            screenSnapshotTrailingTimerRef.current = null;
            scheduleTerminalScreenSnapshot();
          }, delay);
        }
        return;
      }

      const signature = [
        snapshot.cols,
        snapshot.rows,
        snapshot.cursorX,
        snapshot.cursorY,
        snapshot.data,
      ].join(':');
      if (signature === lastScreenSnapshotSignatureRef.current) {
        return;
      }

      lastScreenSnapshotSignatureRef.current = signature;
      lastScreenSnapshotSentAtRef.current = now;
      if (screenSnapshotTrailingTimerRef.current !== null) {
        window.clearTimeout(screenSnapshotTrailingTimerRef.current);
        screenSnapshotTrailingTimerRef.current = null;
      }
      window.electronAPI.updateTerminalScreenSnapshot(snapshot);
    });
    if (!didRunSynchronously) {
      screenSnapshotFrameRef.current = frameId;
    }
  }, [pane.id, windowId]);

  const rememberTerminalViewportY = useCallback((viewportY: number | null) => {
    if (viewportY === null || !Number.isFinite(viewportY) || isRestoringViewportRef.current) {
      return;
    }

    const lastKnownViewportY = lastKnownViewportYRef.current;
    const hasLastKnownViewportY = lastKnownViewportY !== null && Number.isFinite(lastKnownViewportY);
    const savedViewportY = hasLastKnownViewportY ? lastKnownViewportY : null;
    const terminal = terminalRef.current;
    const baseY = terminal ? readTerminalBaseY(terminal) : null;
    const lastKnownBaseY = lastKnownBaseYRef.current;
    const lastKnownWasAtBottom = (
      savedViewportY !== null
      && lastKnownBaseY !== null
      && savedViewportY >= lastKnownBaseY
    );
    const isUnexpectedRecoveryJump = savedViewportY !== null
      && (!isWindowFocusedRef.current || isVisibleSurfaceRecoveryPendingRef.current)
      && (
        (viewportY === 0 && savedViewportY > 0)
        || (baseY !== null && viewportY === baseY && savedViewportY < baseY && !lastKnownWasAtBottom)
      );

    if (isUnexpectedRecoveryJump) {
      if (terminal && isVisibleSurfaceRecoveryPendingRef.current) {
        isRestoringViewportRef.current = true;
        try {
          restoreTerminalViewportY(terminal, savedViewportY);
        } finally {
          isRestoringViewportRef.current = false;
        }
      }
      return;
    }

    lastKnownViewportYRef.current = viewportY;
    lastKnownBaseYRef.current = baseY;
  }, []);

  const captureCurrentTerminalViewportY = useCallback(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }

    rememberTerminalViewportY(readTerminalViewportY(terminal));
  }, [rememberTerminalViewportY]);

  const preserveTerminalViewportY = useCallback((terminal: Terminal, run: () => void) => {
    const lastKnownViewportY = lastKnownViewportYRef.current;
    const lastKnownBaseY = lastKnownBaseYRef.current;
    const currentBaseY = readTerminalBaseY(terminal);
    const viewportYToPreserve = (
      lastKnownViewportY !== null
      && lastKnownBaseY !== null
      && lastKnownViewportY >= lastKnownBaseY
      && currentBaseY !== null
    )
      ? currentBaseY
      : lastKnownViewportY ?? readTerminalViewportY(terminal);

    isRestoringViewportRef.current = true;
    try {
      run();
      restoreTerminalViewportY(terminal, viewportYToPreserve);
    } finally {
      isRestoringViewportRef.current = false;
      rememberTerminalViewportY(readTerminalViewportY(terminal));
    }
  }, [rememberTerminalViewportY]);

  const preserveTerminalViewportContent = useCallback((terminal: Terminal, run: () => void) => {
    const anchor = captureTerminalViewportContentAnchor(terminal);
    isRestoringViewportRef.current = true;
    try {
      run();
      restoreTerminalViewportContentAnchor(terminal, anchor);
    } finally {
      isRestoringViewportRef.current = false;
      rememberTerminalViewportY(readTerminalViewportY(terminal));
    }
  }, [rememberTerminalViewportY]);

  const recoverVisibleTerminalSurface = useCallback(() => {
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    const container = terminalContainerRef.current;
    if (!terminal || !container || !isVisibleTerminalContainer(container)) {
      return;
    }

    lastContainerSizeRef.current = {
      width: container.clientWidth,
      height: container.clientHeight,
    };
    preserveTerminalViewportY(terminal, () => {
      fitAddon?.fit();
      syncPtySize(terminal);
      recoverTerminalRenderSurface(terminal);
    });
  }, [preserveTerminalViewportY, syncPtySize]);

  const scheduleStaleRenderSurfaceRecovery = useCallback(() => {
    const terminal = terminalRef.current;
    const container = terminalContainerRef.current;
    if (!terminal || !container || !isVisibleTerminalContainer(container)) {
      return;
    }

    if (!terminalRenderSurfaceNeedsRecovery(terminal)) {
      return;
    }

    if (staleRenderRecoveryFrameRef.current !== null) {
      return;
    }

    staleRenderRecoveryFrameRef.current = requestAnimationFrame(() => {
      staleRenderRecoveryFrameRef.current = null;

      const currentTerminal = terminalRef.current;
      const currentContainer = terminalContainerRef.current;
      if (!currentTerminal || !currentContainer || !isVisibleTerminalContainer(currentContainer)) {
        return;
      }

      if (!terminalRenderSurfaceNeedsRecovery(currentTerminal)) {
        return;
      }

      preserveTerminalViewportY(currentTerminal, () => {
        recoverTerminalRenderSurface(currentTerminal);
      });
    });
  }, [preserveTerminalViewportY]);

  const scheduleVisibleTerminalRepaint = useCallback((options?: { delayed?: boolean }) => {
    const scheduleFrame = (clearRecoveryPending: boolean) => {
      if (repaintFrameRef.current !== null) {
        return;
      }

      repaintFrameRef.current = requestAnimationFrame(() => {
        repaintFrameRef.current = null;
        recoverVisibleTerminalSurface();
        if (clearRecoveryPending) {
          isVisibleSurfaceRecoveryPendingRef.current = false;
        }
      });
    };

    scheduleFrame(!options?.delayed);

    if (!options?.delayed) {
      return;
    }

    if (repaintTimerRef.current !== null) {
      window.clearTimeout(repaintTimerRef.current);
    }

    repaintTimerRef.current = window.setTimeout(() => {
      repaintTimerRef.current = null;
      scheduleFrame(true);
    }, VISIBLE_TERMINAL_REPAINT_DELAY_MS);
  }, [recoverVisibleTerminalSurface]);

  useEffect(() => {
    sshCwdTrackerRef.current = createSSHCwdTrackerState(pane.cwd);
  }, [pane.id, pane.ssh?.profileId]);

  useEffect(() => {
    sshCwdTrackerRef.current = updateSSHCwdTrackerFromRuntimeCwd(sshCwdTrackerRef.current, pane.cwd);
  }, [pane.cwd]);

  useEffect(() => {
    const sshBinding = pane.ssh;
    if (!sshBinding || !isWindowActive || !isActive) {
      return undefined;
    }

    const unsubscribe = subscribeToPanePtyData(windowId, pane.id, (payload) => {
      const nextRemoteCwd = extractLatestOsc7RemoteCwd(payload.data, sshCwdTrackerRef.current);
      if (!nextRemoteCwd) {
        return;
      }

      sshCwdTrackerRef.current = updateSSHCwdTrackerFromRuntimeCwd(sshCwdTrackerRef.current, nextRemoteCwd);

      if (nextRemoteCwd === pane.cwd) {
        return;
      }

      updatePaneRuntime(windowId, pane.id, { cwd: nextRemoteCwd });
    });

    return unsubscribe;
  }, [isActive, isWindowActive, pane.cwd, pane.id, pane.ssh, updatePaneRuntime, windowId]);

  // 写入系统剪贴板（优先走 Electron IPC，失败时回退到浏览器 API）
  const writeClipboardText = useCallback(async (text: string) => {
    if (!text) return;

    try {
      if (window.electronAPI?.writeClipboardText) {
        await window.electronAPI.writeClipboardText(text);
        return;
      }
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      }
    } catch {
      // 剪贴板失败不应影响终端主流程
    }
  }, []);

  // 读取系统剪贴板（优先走 Electron IPC，失败时回退到浏览器 API）
  const readClipboardText = useCallback(async (): Promise<string> => {
    try {
      if (window.electronAPI?.readClipboardText) {
        const response = await window.electronAPI.readClipboardText();

        if (typeof response === 'string') {
          return response;
        }

        if (
          response &&
          typeof response === 'object' &&
          'success' in response &&
          (response as { success?: boolean }).success
        ) {
          const data = (response as { data?: unknown }).data;
          return typeof data === 'string' ? data : '';
        }
      }

      if (navigator.clipboard?.readText) {
        return await navigator.clipboard.readText();
      }
    } catch {
      // 剪贴板失败不应影响终端主流程
    }

    return '';
  }, []);

  const openExternalUrl = useCallback(async (url: string) => {
    if (!window.electronAPI?.openExternalUrl) {
      return;
    }

    const response = await window.electronAPI.openExternalUrl(url);
    if (
      response &&
      typeof response === 'object' &&
      'success' in response &&
      !(response as { success?: boolean }).success
    ) {
      throw new Error((response as { error?: string }).error || 'Failed to open external URL');
    }
  }, []);

  const clearLinkDragOverlayHideTimer = useCallback(() => {
    if (linkDragOverlayHideTimerRef.current === null) {
      return;
    }

    window.clearTimeout(linkDragOverlayHideTimerRef.current);
    linkDragOverlayHideTimerRef.current = null;
  }, []);

  const hideLinkDragOverlay = useCallback(() => {
    if (isLinkDragActiveRef.current || isLinkDragOverlayHoveredRef.current) {
      return;
    }

    setLinkDragOverlay(null);
  }, []);

  const scheduleLinkDragOverlayHide = useCallback(() => {
    clearLinkDragOverlayHideTimer();
    linkDragOverlayHideTimerRef.current = window.setTimeout(() => {
      linkDragOverlayHideTimerRef.current = null;
      hideLinkDragOverlay();
    }, 90);
  }, [clearLinkDragOverlayHideTimer, hideLinkDragOverlay]);

  const updateLinkDragOverlay = useCallback((payload: TerminalLinkInteractionPayload) => {
    const root = paneRootRef.current;
    const sanitizedUrl = payload.text.trim();
    if (!root || !sanitizedUrl) {
      return;
    }

    clearLinkDragOverlayHideTimer();

    const rootRect = root.getBoundingClientRect();
    const overlayWidth = Math.min(260, Math.max(168, rootRect.width - 24));
    const overlayHeight = 32;
    const left = Math.min(
      Math.max(payload.event.clientX - rootRect.left + 12, 8),
      Math.max(rootRect.width - overlayWidth - 8, 8),
    );
    const top = Math.min(
      Math.max(payload.event.clientY - rootRect.top - overlayHeight - 6, 8),
      Math.max(rootRect.height - overlayHeight - 8, 8),
    );

    setLinkDragOverlay({
      url: sanitizedUrl,
      left,
      top,
    });
  }, [clearLinkDragOverlayHideTimer]);

  const handleTerminalLinkHover = useCallback((payload: TerminalLinkInteractionPayload) => {
    updateLinkDragOverlay(payload);
  }, [updateLinkDragOverlay]);

  const handleTerminalLinkLeave = useCallback(() => {
    scheduleLinkDragOverlayHide();
  }, [scheduleLinkDragOverlayHide]);

  const handleLinkDragOverlayMouseEnter = useCallback(() => {
    isLinkDragOverlayHoveredRef.current = true;
    clearLinkDragOverlayHideTimer();
  }, [clearLinkDragOverlayHideTimer]);

  const handleLinkDragOverlayMouseLeave = useCallback(() => {
    isLinkDragOverlayHoveredRef.current = false;
    scheduleLinkDragOverlayHide();
  }, [scheduleLinkDragOverlayHide]);

  const handleLinkDragOverlayStateChange = useCallback((dragging: boolean) => {
    isLinkDragActiveRef.current = dragging;
    setIsLinkDragActive(dragging);

    if (dragging) {
      clearLinkDragOverlayHideTimer();
      return;
    }

    if (!isLinkDragOverlayHoveredRef.current) {
      setLinkDragOverlay(null);
    }
  }, [clearLinkDragOverlayHideTimer]);

  const positionSelectionAiOverlay = useCallback((
    clientX: number,
    clientY: number,
    measuredSize?: { width?: number; height?: number },
  ): TerminalSelectionAiOverlayPosition => {
    const root = paneRootRef.current;
    if (!root) {
      return {
        left: 8,
        top: 8,
        maxWidth: SELECTION_AI_OVERLAY_MAX_WIDTH,
        maxHeight: SELECTION_AI_OVERLAY_DEFAULT_HEIGHT + SELECTION_AI_OVERLAY_MAX_CONTENT_HEIGHT,
        maxContentHeight: SELECTION_AI_OVERLAY_MAX_CONTENT_HEIGHT,
      };
    }

    const rootRect = root.getBoundingClientRect();
    const visibleLeft = Math.max(rootRect.left, 0) - rootRect.left + SELECTION_AI_OVERLAY_MARGIN;
    const visibleTop = Math.max(rootRect.top, 0) - rootRect.top + SELECTION_AI_OVERLAY_MARGIN;
    const visibleRight = Math.min(rootRect.right, window.innerWidth) - rootRect.left - SELECTION_AI_OVERLAY_MARGIN;
    const visibleBottom = Math.min(rootRect.bottom, window.innerHeight) - rootRect.top - SELECTION_AI_OVERLAY_MARGIN;
    const visibleWidth = Math.max(1, visibleRight - visibleLeft);
    const visibleHeight = Math.max(1, visibleBottom - visibleTop);
    const maxWidth = Math.max(1, Math.min(SELECTION_AI_OVERLAY_MAX_WIDTH, visibleWidth));
    const minWidth = Math.min(SELECTION_AI_OVERLAY_MIN_WIDTH, maxWidth);
    const fallbackWidth = Math.min(
      maxWidth,
      Math.max(minWidth, Math.min(SELECTION_AI_OVERLAY_MAX_WIDTH, rootRect.width - (SELECTION_AI_OVERLAY_MARGIN * 2))),
    );
    const measuredWidth = measuredSize?.width && Number.isFinite(measuredSize.width)
      ? measuredSize.width
      : fallbackWidth;
    const overlayWidth = clampNumber(measuredWidth, minWidth, maxWidth);
    const anchorX = clampNumber(clientX - rootRect.left, visibleLeft, visibleRight);
    const anchorY = clampNumber(clientY - rootRect.top, visibleTop, visibleBottom);
    const left = clampNumber(
      anchorX + SELECTION_AI_OVERLAY_POINTER_GAP,
      visibleLeft,
      Math.max(visibleLeft, visibleRight - overlayWidth),
    );

    const measuredHeight = measuredSize?.height && Number.isFinite(measuredSize.height)
      ? measuredSize.height
      : SELECTION_AI_OVERLAY_DEFAULT_HEIGHT;
    const spaceAbove = Math.max(0, anchorY - SELECTION_AI_OVERLAY_POINTER_GAP - visibleTop);
    const spaceBelow = Math.max(0, visibleBottom - anchorY - SELECTION_AI_OVERLAY_POINTER_GAP);
    const useAbove = spaceAbove >= measuredHeight || spaceAbove >= spaceBelow;
    const preferredSpace = Math.max(useAbove ? spaceAbove : spaceBelow, SELECTION_AI_OVERLAY_DEFAULT_HEIGHT);
    const availableHeight = Math.min(visibleHeight, preferredSpace);
    const maxHeight = Math.max(1, availableHeight);
    const overlayHeight = Math.min(Math.max(measuredHeight, SELECTION_AI_OVERLAY_DEFAULT_HEIGHT), maxHeight);
    const top = useAbove
      ? clampNumber(
          anchorY - SELECTION_AI_OVERLAY_POINTER_GAP - overlayHeight,
          visibleTop,
          Math.max(visibleTop, visibleBottom - overlayHeight),
        )
      : clampNumber(
          anchorY + SELECTION_AI_OVERLAY_POINTER_GAP,
          visibleTop,
          Math.max(visibleTop, visibleBottom - overlayHeight),
        );
    const rawMaxContentHeight = maxHeight - SELECTION_AI_OVERLAY_HEADER_CHROME_HEIGHT;
    const minContentHeight = maxHeight >= SELECTION_AI_OVERLAY_HEADER_CHROME_HEIGHT + SELECTION_AI_OVERLAY_MIN_CONTENT_HEIGHT
      ? SELECTION_AI_OVERLAY_MIN_CONTENT_HEIGHT
      : 0;
    const maxContentHeight = clampNumber(
      rawMaxContentHeight,
      minContentHeight,
      SELECTION_AI_OVERLAY_MAX_CONTENT_HEIGHT,
    );

    return {
      left,
      top,
      maxWidth,
      maxHeight,
      maxContentHeight,
    };
  }, []);

  const updateSelectionAiOverlayPosition = useCallback(() => {
    setSelectionAiOverlay((current) => {
      if (!current) {
        return current;
      }

      const overlayRect = selectionAiOverlayRef.current?.getBoundingClientRect();
      const position = positionSelectionAiOverlay(current.anchorClientX, current.anchorClientY, {
        width: overlayRect?.width,
        height: overlayRect?.height,
      });
      const hasMeaningfulChange = Math.abs(current.left - position.left) > 0.5
        || Math.abs(current.top - position.top) > 0.5
        || Math.abs(current.maxWidth - position.maxWidth) > 0.5
        || Math.abs(current.maxHeight - position.maxHeight) > 0.5
        || Math.abs(current.maxContentHeight - position.maxContentHeight) > 0.5;

      if (!hasMeaningfulChange) {
        return current;
      }

      return {
        ...current,
        ...position,
      };
    });
  }, [positionSelectionAiOverlay]);

  const showSelectionAiOverlay = useCallback((text: string) => {
    const normalizedText = text.trim();
    if (!normalizedText) {
      setSelectionAiOverlay(null);
      return;
    }

    const { clientX, clientY } = lastTerminalPointerRef.current;
    const position = positionSelectionAiOverlay(clientX, clientY);
    selectionAiRequestSeqRef.current += 1;
    setSelectionAiOverlay({
      text: normalizedText,
      anchorClientX: clientX,
      anchorClientY: clientY,
      left: position.left,
      top: position.top,
      maxWidth: position.maxWidth,
      maxHeight: position.maxHeight,
      maxContentHeight: position.maxContentHeight,
      status: 'idle',
    });
  }, [positionSelectionAiOverlay]);

  const hideSelectionAiOverlay = useCallback(() => {
    selectionAiRequestSeqRef.current += 1;
    setSelectionAiOverlay(null);
  }, []);

  const runSelectionAiAction = useCallback((action: TerminalSelectionAiAction) => {
    const currentOverlay = selectionAiOverlay;
    if (!currentOverlay?.text || !window.electronAPI?.chatCompleteText) {
      return;
    }

    const requestSeq = ++selectionAiRequestSeqRef.current;
    const selectedText = currentOverlay.text;
    setSelectionAiOverlay((current) => current && current.text === selectedText
      ? {
          ...current,
          status: 'loading',
          action,
          result: undefined,
          error: undefined,
        }
      : current);

    void (async () => {
      try {
        const prompt = action === 'translate'
          ? `请翻译以下划选内容：\n\n${selectedText}`
          : `请解释以下划选内容的含义：\n\n${selectedText}`;
        const response = await window.electronAPI.chatCompleteText({
          purpose: action === 'translate'
            ? 'terminal-selection-translate'
            : 'terminal-selection-explain',
          prompt,
        });

        if (selectionAiRequestSeqRef.current !== requestSeq) {
          return;
        }

        if (!response.success || !response.data) {
          throw new Error(response.error || '生成失败');
        }

        const result = response.data.content;
        setSelectionAiOverlay((current) => current && current.text === selectedText
          ? {
              ...current,
              status: 'done',
              action,
              result,
              error: undefined,
            }
          : current);
      } catch (error) {
        if (selectionAiRequestSeqRef.current !== requestSeq) {
          return;
        }

        setSelectionAiOverlay((current) => current && current.text === selectedText
          ? {
              ...current,
              status: 'error',
              action,
              error: error instanceof Error ? error.message : String(error),
            }
          : current);
      }
    })();
  }, [selectionAiOverlay]);

  useLayoutEffect(() => {
    if (!selectionAiOverlay) {
      return;
    }

    updateSelectionAiOverlayPosition();
  }, [
    selectionAiOverlay?.status,
    selectionAiOverlay?.action,
    selectionAiOverlay?.result,
    selectionAiOverlay?.error,
    updateSelectionAiOverlayPosition,
  ]);

  useEffect(() => {
    const overlay = selectionAiOverlayRef.current;
    const paneRoot = paneRootRef.current;
    if (!selectionAiOverlay || !overlay) {
      return undefined;
    }

    const resizeObserver = new ResizeObserver(() => {
      updateSelectionAiOverlayPosition();
    });
    resizeObserver.observe(overlay);
    if (paneRoot) {
      resizeObserver.observe(paneRoot);
    }

    window.addEventListener('resize', updateSelectionAiOverlayPosition, true);
    window.addEventListener('scroll', updateSelectionAiOverlayPosition, true);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateSelectionAiOverlayPosition, true);
      window.removeEventListener('scroll', updateSelectionAiOverlayPosition, true);
    };
  }, [selectionAiOverlay, updateSelectionAiOverlayPosition]);

  // 更新 isActive ref
  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

  useEffect(() => {
    isWindowActiveRef.current = isWindowActive;
  }, [isWindowActive]);

  useEffect(() => {
    ptyInputEnabledRef.current = ptyInputEnabled;
  }, [ptyInputEnabled]);

  useEffect(() => {
    onActivateRef.current = onActivate;
  }, [onActivate]);

  useEffect(() => {
    return () => {
      clearLinkDragOverlayHideTimer();
    };
  }, [clearLinkDragOverlayHideTimer]);

  useEffect(() => {
    setLinkDragOverlay(null);
    setSelectionAiOverlay(null);
    pendingSelectionAiTextRef.current = null;
    isTerminalPointerDownRef.current = false;
    setIsLinkDragActive(false);
    isLinkDragOverlayHoveredRef.current = false;
    isLinkDragActiveRef.current = false;
    clearLinkDragOverlayHideTimer();
  }, [clearLinkDragOverlayHideTimer, pane.id, windowId]);

  useEffect(() => {
    if (isActive && isWindowActive) {
      return;
    }

    setLinkDragOverlay(null);
    setSelectionAiOverlay(null);
    pendingSelectionAiTextRef.current = null;
    isTerminalPointerDownRef.current = false;
    setIsLinkDragActive(false);
    isLinkDragOverlayHoveredRef.current = false;
    isLinkDragActiveRef.current = false;
    clearLinkDragOverlayHideTimer();
  }, [clearLinkDragOverlayHideTimer, isActive, isWindowActive]);

  useEffect(() => {
    const sessionKey = getReplaySessionKey(windowId, pane.id, pane.pid);
    replaySessionKeyRef.current = sessionKey;
    hasCompletedReplayForCurrentSessionRef.current = Boolean(
      sessionKey && completedReplaySessions.has(sessionKey),
    );
  }, [windowId, pane.id, pane.pid]);

  const forceResizeToContainer = useCallback(() => {
    lastContainerSizeRef.current = { width: 0, height: 0 };

    if (!terminalRef.current || !fitAddonRef.current || !terminalContainerRef.current) {
      return;
    }

    requestAnimationFrame(() => {
      const container = terminalContainerRef.current;
      const terminal = terminalRef.current;
      const fitAddon = fitAddonRef.current;

      if (!container || !terminal || !fitAddon) return;

      const width = container.clientWidth;
      const height = container.clientHeight;

      if (width > 0 && height > 0) {
        lastContainerSizeRef.current = { width, height };
        preserveTerminalViewportY(terminal, () => {
          fitAddon.fit();
          recoverTerminalRenderSurface(terminal);
          syncPtySize(terminal, { force: true });
        });
      }
    });
  }, [preserveTerminalViewportY, syncPtySize]);

  useEffect(() => {
    const handleVisibleSurfaceRecovery = () => {
      if (document.visibilityState === 'hidden') {
        return;
      }

      suppressFocusReportsForWindowTransition();
      isWindowFocusedRef.current = true;
      isVisibleSurfaceRecoveryPendingRef.current = true;
      scheduleVisibleTerminalRepaint({ delayed: true });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        suppressFocusReportsForWindowTransition();
        captureCurrentTerminalViewportY();
        isWindowFocusedRef.current = false;
        isVisibleSurfaceRecoveryPendingRef.current = false;
        return;
      }

      handleVisibleSurfaceRecovery();
    };

    const handleBlur = () => {
      suppressFocusReportsForWindowTransition();
      captureCurrentTerminalViewportY();
      isWindowFocusedRef.current = false;
      isVisibleSurfaceRecoveryPendingRef.current = false;
    };

    window.addEventListener('focus', handleVisibleSurfaceRecovery);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('pageshow', handleVisibleSurfaceRecovery);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('focus', handleVisibleSurfaceRecovery);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('pageshow', handleVisibleSurfaceRecovery);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [captureCurrentTerminalViewportY, scheduleVisibleTerminalRepaint, suppressFocusReportsForWindowTransition]);

  // 监听窗格状态变化：从无活动会话状态恢复时重置尺寸缓存，强制下次 resize
  useEffect(() => {
    const prevStatus = lastStatusRef.current;
    const currentStatus = pane.status;
    const currentInactive = isInactiveTerminalPaneStatus(currentStatus);
    const previousInactive = isInactiveTerminalPaneStatus(prevStatus);

    if (currentInactive && !previousInactive) {
      historyReplayTokenRef.current += 1;
      isHistoryLoadedRef.current = true;
      bufferedLiveDataRef.current = [];
      lastAppliedSeqRef.current = 0;
      lastRenderedSeqRef.current = 0;
      suppressPtyWriteRef.current = false;
      lastLiveOutputQueuedAtRef.current = Number.NEGATIVE_INFINITY;
      hasCompletedReplayForCurrentSessionRef.current = false;
      const sessionKey = replaySessionKeyRef.current;
      if (sessionKey) {
        completedReplaySessions.delete(sessionKey);
      }
      replaySessionKeyRef.current = null;

      if (outputFlushFrameRef.current !== null) {
        cancelAnimationFrame(outputFlushFrameRef.current);
        outputFlushFrameRef.current = null;
      }
      if (screenSnapshotFrameRef.current !== null) {
        cancelAnimationFrame(screenSnapshotFrameRef.current);
        screenSnapshotFrameRef.current = null;
      }
      if (screenSnapshotTrailingTimerRef.current !== null) {
        window.clearTimeout(screenSnapshotTrailingTimerRef.current);
        screenSnapshotTrailingTimerRef.current = null;
      }
      outputChunksRef.current = [];
      outputBufferSizeRef.current = 0;
      outputBufferLastSeqRef.current = undefined;
      lastScreenSnapshotSignatureRef.current = '';
      lastScreenSnapshotSentAtRef.current = Number.NEGATIVE_INFINITY;
      lastKnownViewportYRef.current = null;
      lastKnownBaseYRef.current = null;
      terminalRef.current?.reset();
    }

    // 从无活动会话状态恢复到 Running/WaitingForInput 时，重置尺寸缓存
    if (
      previousInactive &&
      (currentStatus === WindowStatus.Running || currentStatus === WindowStatus.WaitingForInput || currentStatus === WindowStatus.Restoring)
    ) {
      forceResizeToContainer();
    }

    lastStatusRef.current = currentStatus;
  }, [pane.status, forceResizeToContainer]);

  // 进程退出后通知父组件处理。只响应从活动态进入退出态的变化，避免恢复/挂载已停止窗口时误判为新退出。
  useEffect(() => {
    const previousStatus = lastProcessExitStatusRef.current;
    const currentStatus = pane.status;
    lastProcessExitStatusRef.current = currentStatus;

    const isExited = currentStatus === WindowStatus.Completed || currentStatus === WindowStatus.Error;
    const wasInactive = isInactiveTerminalPaneStatus(previousStatus);
    if (!isExited || wasInactive) return;
    onProcessExit?.();
  }, [pane.status, onProcessExit]);

  // 当窗格激活且窗口激活时，自动聚焦到终端
  useEffect(() => {
    const previousFocusState = lastFocusStateRef.current;
    lastFocusStateRef.current = { isActive, isWindowActive };

    if (!terminalRef.current) return;

    if (isActive) {
      if (isWindowActive) {
        focusTerminalInput({
          defer: true,
          onlyWhenOutsidePane: true,
          suppressFocusReport: previousFocusState.isActive && !previousFocusState.isWindowActive,
        });
      }
      return;
    }

    // 非激活窗格：失焦并隐藏光标。窗口整体失焦时不主动 blur 当前活跃窗格，
    // 避免启用了 focus reporting 的 TUI 把应用切换当成终端输入。
    try {
      terminalRef.current.blur();
      const textarea = terminalContainerRef.current?.querySelector('textarea');
      if (textarea) {
        (textarea as HTMLTextAreaElement).blur();
      }
    } catch (error) {
      console.error(`[TerminalPane] Error blurring pane ${pane.id}:`, error);
    }
  }, [focusTerminalInput, isActive, isWindowActive]);

  useEffect(() => {
    const wasWindowActive = lastWindowActiveForRecoveryRef.current;
    lastWindowActiveForRecoveryRef.current = isWindowActive;

    if (wasWindowActive || !isWindowActive) {
      return;
    }

    scheduleVisibleTerminalRepaint({ delayed: true });
  }, [isWindowActive, scheduleVisibleTerminalRepaint]);

  useEffect(() => {
    if (lastLayoutPaneCountRef.current === layoutPaneCount) {
      return;
    }

    lastLayoutPaneCountRef.current = layoutPaneCount;

    forceResizeToContainer();
    if (isActive && isWindowActive) {
      focusTerminalInput({ onlyWhenOutsidePane: true });
    }
    const delayedResizeTimer = window.setTimeout(() => {
      forceResizeToContainer();
      if (isActive && isWindowActive) {
        focusTerminalInput({ onlyWhenOutsidePane: true });
      }
    }, 120);

    return () => {
      window.clearTimeout(delayedResizeTimer);
    };
  }, [focusTerminalInput, forceResizeToContainer, isActive, isWindowActive, layoutPaneCount]);

  useEffect(() => {
    const handleFocusRequest = (event: Event) => {
      if (!isActive || !isWindowActive) {
        return;
      }

      const detail = (event as CustomEvent<{ windowId: string; paneId?: string | null; defer?: boolean } | undefined>).detail;
      if (!matchesActiveTerminalFocusRequest(detail, windowId, pane.id)) {
        return;
      }

      focusTerminalInput({ defer: detail?.defer });
    };

    window.addEventListener(ACTIVE_TERMINAL_FOCUS_REQUEST_EVENT, handleFocusRequest);
    return () => {
      window.removeEventListener(ACTIVE_TERMINAL_FOCUS_REQUEST_EVENT, handleFocusRequest);
    };
  }, [focusTerminalInput, isActive, isWindowActive, pane.id, windowId]);

  // 监听字体设置更新
  useEffect(() => {
    const unsubscribe = onTerminalSettingsUpdated((settings) => {
      if (!terminalRef.current) return;

      const terminal = terminalRef.current;
      const fitAddon = fitAddonRef.current;

      // 更新字体
      if (settings.fontFamily !== undefined) {
        const fontFamily = settings.fontFamily || TERMINAL_FONT_FAMILY;
        if ('options' in terminal && terminal.options) {
          terminal.options.fontFamily = fontFamily;
        }
      }

      // 更新字号
      if (settings.fontSize !== undefined) {
        const fontSize = settings.fontSize || 14;
        if ('options' in terminal && terminal.options) {
          terminal.options.fontSize = fontSize;
        }
      }

      if (settings.themeChanged && 'options' in terminal && terminal.options) {
        terminal.options.theme = getWindowsTerminalTheme();
      }

      // 重新调整大小以应用新的字体设置
      if (fitAddon) {
        requestAnimationFrame(() => {
          fitAddon.fit();
          refreshTerminalViewport(terminal);
        });
      }
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return undefined;
    }

    const handleWorkspaceSettingsUpdated = (event: Event) => {
      const patch = (event as CustomEvent<{ appearance?: unknown; sshClipboardImage?: { shortcut?: SSHClipboardImageShortcut } } | undefined>).detail;
      if (patch?.sshClipboardImage?.shortcut) {
        sshClipboardImageShortcutRef.current = patch.sshClipboardImage.shortcut;
      }

      if (patch?.appearance && 'options' in terminal && terminal.options) {
        terminal.options.theme = getWindowsTerminalTheme();
        refreshTerminalViewport(terminal);
      }
    };

    window.addEventListener(WORKSPACE_SETTINGS_UPDATED_EVENT, handleWorkspaceSettingsUpdated);

    return () => {
      window.removeEventListener(WORKSPACE_SETTINGS_UPDATED_EVENT, handleWorkspaceSettingsUpdated);
    };
  }, []);

  // 初始化 xterm.js
  useEffect(() => {
    if (!terminalContainerRef.current) return;

    const platform = window.electronAPI?.platform;
    const isMac = platform === 'darwin';
    const isWindows = platform === 'win32';
    const terminalLinkHandler = createTerminalLinkHandler(openExternalUrl, {
      onHover: handleTerminalLinkHover,
      onLeave: handleTerminalLinkLeave,
    });
    const terminal = new Terminal({
      cols: 80,
      rows: 30,
      theme: getWindowsTerminalTheme(),
      allowTransparency: true,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 14,
      lineHeight: 1.2,
      macOptionIsMeta: true,
      macOptionClickForcesSelection: true,
      cursorBlink: true,
      cursorStyle: 'block',
      // @ts-ignore - cursorInactiveStyle 是 xterm.js 的有效选项
      cursorInactiveStyle: 'none',
      scrollback: 10000,
      allowProposedApi: true,
      scrollOnUserInput: true,
      smoothScrollDuration: 0, // 禁用平滑滚动，减少晃动
      linkHandler: terminalLinkHandler,
      // 让终端程序自行协商增强键盘协议，避免宿主层硬编码 CLI 快捷键语义。
      vtExtensions: {
        kittyKeyboard: true,
        ...(isWindows ? { win32InputMode: true } : {}),
      },
      ...(isWindows ? { windowsPty: { backend: 'conpty' as const } } : {}),
    });

    // 异步加载并应用字体与 SSH 图片快捷键设置
    void (async () => {
      try {
        const response = await window.electronAPI?.getSettings?.();
        if (response?.success && response.data) {
          const { terminal: terminalSettings, sshClipboardImage } = response.data;
          const savedShortcut = sshClipboardImage?.shortcut;
          if (savedShortcut) {
            sshClipboardImageShortcutRef.current = savedShortcut;
          }

          if (!terminalSettings) {
            return;
          }

          const { fontFamily, fontSize } = terminalSettings;
          if (fontFamily && 'options' in terminal && terminal.options) {
            terminal.options.fontFamily = fontFamily;
          }
          if (fontSize && 'options' in terminal && terminal.options) {
            terminal.options.fontSize = fontSize;
          }
        }
      } catch (error) {
        console.error('Failed to load font settings:', error);
      }
    })();

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    const webLinkProviderDisposable = registerTerminalWebLinks(terminal, openExternalUrl, {
      onHover: handleTerminalLinkHover,
      onLeave: handleTerminalLinkLeave,
    });
    terminal.open(terminalContainerRef.current);
    const pasteCaptureBlockMs = 300;
    const disposeScrollbackPreservation = installTerminalScrollbackPreservation(terminal);

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    void ensureTerminalFontsLoaded().finally(() => {
      if (terminalRef.current !== terminal || fitAddonRef.current !== fitAddon) {
        return;
      }

      // FontFace finishes asynchronously in Electron; re-apply metrics once the bundled
      // Nerd glyph font is available so Powerline separators do not fall back to tofu.
      if ('options' in terminal && terminal.options) {
        terminal.options.fontFamily = TERMINAL_FONT_FAMILY;
      }
      fitAddon.fit();
      refreshTerminalViewport(terminal);
    });

    const writeGuardedLiveOutput = (data: string, outputSeq?: number) => {
      const currentTerminal = terminalRef.current;
      if (!currentTerminal) {
        return;
      }

      const guardedData = liveOsc8GuardRef.current.sanitize(data);
      if (guardedData) {
        const shouldCaptureSnapshot = shouldCaptureTerminalScreenSnapshot(
          currentTerminal,
          guardedData,
          Boolean(lastScreenSnapshotSignatureRef.current),
        );
        if (shouldCaptureSnapshot) {
          writeTerminalWithResizeControls(currentTerminal, guardedData, () => {
            if (outputSeq !== undefined) {
              lastRenderedSeqRef.current = outputSeq;
            }
            scheduleTerminalScreenSnapshot();
          });
        } else {
          writeTerminalWithResizeControls(currentTerminal, guardedData);
        }
        scheduleStaleRenderSurfaceRecovery();
      } else if (outputSeq !== undefined) {
        lastRenderedSeqRef.current = outputSeq;
      }
    };

    // 批量刷新 PTY 输出：每帧最多写一次，降低高频输出时的重绘抖动
    const flushOutput = () => {
      outputFlushFrameRef.current = null;

      if (outputBufferSizeRef.current === 0 || !terminalRef.current) {
        return;
      }

      if (imeCompositionStateRef.current.isComposing) {
        outputFlushFrameRef.current = requestAnimationFrame(flushOutput);
        return;
      }

      const pending = outputChunksRef.current.length === 1
        ? outputChunksRef.current[0]
        : outputChunksRef.current.join('');
      const pendingLastSeq = outputBufferLastSeqRef.current;
      outputChunksRef.current = [];
      outputBufferSizeRef.current = 0;
      outputBufferLastSeqRef.current = undefined;
      writeGuardedLiveOutput(pending, pendingLastSeq);
    };

    const clearQueuedOutput = () => {
      if (outputFlushFrameRef.current !== null) {
        cancelAnimationFrame(outputFlushFrameRef.current);
        outputFlushFrameRef.current = null;
      }

      outputChunksRef.current = [];
      outputBufferSizeRef.current = 0;
      outputBufferLastSeqRef.current = undefined;
    };

    const queueOutput = (data: string, outputSeq?: number) => {
      if (!data) return;

      const currentTerminal = terminalRef.current;
      const now = nowMs();
      const wasIdle = now - lastLiveOutputQueuedAtRef.current > DIRECT_LIVE_OUTPUT_IDLE_MS;
      lastLiveOutputQueuedAtRef.current = now;

      if (
        currentTerminal
        && outputFlushFrameRef.current === null
        && outputBufferSizeRef.current === 0
        && !imeCompositionStateRef.current.isComposing
        && data.length <= DIRECT_LIVE_OUTPUT_MAX_CHARS
        && wasIdle
      ) {
        writeGuardedLiveOutput(data, outputSeq);
        return;
      }

      // 限制缓冲区大小，避免极端情况下的内存泄漏
      const MAX_BUFFER_SIZE = 100000; // 100KB
      if (outputBufferSizeRef.current + data.length > MAX_BUFFER_SIZE) {
        // 强制刷新缓冲区
        if (outputFlushFrameRef.current !== null) {
          cancelAnimationFrame(outputFlushFrameRef.current);
          outputFlushFrameRef.current = null;
        }
        flushOutput();
      }

      outputChunksRef.current.push(data);
      outputBufferSizeRef.current += data.length;
      if (outputSeq !== undefined) {
        outputBufferLastSeqRef.current = outputSeq;
      }
      if (outputFlushFrameRef.current !== null) {
        return;
      }

      outputFlushFrameRef.current = requestAnimationFrame(flushOutput);
    };

    const writeReplayOutput = (data: string, outputSeq: number) => new Promise<void>((resolve) => {
      const currentTerminal = terminalRef.current;
      if (!currentTerminal) {
        resolve();
        return;
      }

      replayOsc8GuardRef.current.reset();
      const guardedData = replayOsc8GuardRef.current.sanitize(data, { closeAtEnd: true });

      writeTerminalWithResizeControls(currentTerminal, OSC8_HYPERLINK_CLOSE, () => {
        if (!guardedData) {
          lastRenderedSeqRef.current = outputSeq;
          resolve();
          return;
        }

        writeTerminalWithResizeControls(currentTerminal, guardedData, () => {
          lastRenderedSeqRef.current = outputSeq;
          if (
            shouldCaptureTerminalScreenSnapshot(
              currentTerminal,
              guardedData,
              Boolean(lastScreenSnapshotSignatureRef.current),
            )
          ) {
            scheduleTerminalScreenSnapshot();
          }
          resolve();
        });
      });
    });

    const queueLiveOutput = (payload: PtyDataPayload) => {
      if (!payload.data) {
        return;
      }

      if (payload.seq !== undefined && payload.seq <= lastAppliedSeqRef.current) {
        return;
      }

      if (!isHistoryLoadedRef.current) {
        bufferedLiveDataRef.current.push(payload);
        return;
      }

      if (payload.seq !== undefined) {
        lastAppliedSeqRef.current = payload.seq;
      }

      queueOutput(payload.data, payload.seq);
    };

    const replayHistory = async ({ resetTerminal = false }: { resetTerminal?: boolean } = {}) => {
      const token = ++historyReplayTokenRef.current;
      const isReplayStillCurrent = () => (
        token === historyReplayTokenRef.current
        && terminalRef.current === terminal
      );
      isHistoryLoadedRef.current = false;
      bufferedLiveDataRef.current = [];
      lastAppliedSeqRef.current = 0;
      lastRenderedSeqRef.current = 0;
      liveOsc8GuardRef.current.reset();
      replayOsc8GuardRef.current.reset();
      const sessionKey = replaySessionKeyRef.current;
      // 只有同一会话的后续补回放才屏蔽协议响应，避免把旧历史里的 CSI 查询
      // 再次变成 synthetic reply 注入 live PTY。
      const hasCompletedReplayForCurrentSession = Boolean(
        sessionKey && completedReplaySessions.has(sessionKey),
      ) || hasCompletedReplayForCurrentSessionRef.current;
      const shouldStripReplayProtocolQueries = hasCompletedReplayForCurrentSession && !resetTerminal;
      let shouldResumePtyWrites = false;
      let replayKeyboardState: PtyKeyboardProtocolState | undefined;

      if (resetTerminal && terminalRef.current) {
        clearQueuedOutput();
        liveOsc8GuardRef.current.reset();
        replayOsc8GuardRef.current.reset();
        terminalRef.current.reset();
        resetTerminalKeyboardProtocolState(terminalRef.current);
      }

      try {
        const response = await window.electronAPI?.getPtyHistory?.(pane.id);
        if (!isReplayStillCurrent()) {
          return;
        }

        const historySnapshot = extractPtyHistorySnapshot(response);
        replayKeyboardState = historySnapshot.keyboardState;
        lastAppliedSeqRef.current = historySnapshot.lastSeq;
        const replayChunks = historySnapshot.replayChunks ?? historySnapshot.chunks;
        const replayData = shouldStripReplayProtocolQueries
          ? stripReplayProtocolQueries(replayChunks.join(''))
          : replayChunks.join('');
        if (isReplayStillCurrent()) {
          suppressPtyWriteRef.current = true;
          shouldResumePtyWrites = true;
          await writeReplayOutput(replayData, historySnapshot.lastSeq);
        }
      } catch {
        // 历史回放失败不应影响实时输出
      } finally {
        if (shouldResumePtyWrites) {
          suppressPtyWriteRef.current = false;
        }

        if (!isReplayStillCurrent()) {
          return;
        }

        applyTerminalKeyboardProtocolState(terminal, replayKeyboardState);
        isHistoryLoadedRef.current = true;
        hasCompletedReplayForCurrentSessionRef.current = true;
        if (sessionKey) {
          completedReplaySessions.add(sessionKey);
        }
        const bufferedChunks = bufferedLiveDataRef.current;
        bufferedLiveDataRef.current = [];
        for (const payload of bufferedChunks) {
          if (payload.seq !== undefined && payload.seq <= lastAppliedSeqRef.current) {
            continue;
          }
          if (payload.seq !== undefined) {
            lastAppliedSeqRef.current = payload.seq;
          }
          queueOutput(payload.data, payload.seq);
        }
      }
    };

    replayHistoryRef.current = replayHistory;

    // 尺寸同步：仅在容器尺寸实际变化时执行 fit，避免无效重排
    const runResize = () => {
      resizeFrameRef.current = null;

      const container = terminalContainerRef.current;
      const currentTerminal = terminalRef.current;
      const currentFitAddon = fitAddonRef.current;
      if (!container || !currentTerminal || !currentFitAddon) {
        return;
      }

      const width = container.clientWidth;
      const height = container.clientHeight;
      if (width <= 0 || height <= 0) {
        return;
      }

      const last = lastContainerSizeRef.current;
      if (last.width === width && last.height === height) {
        return;
      }

      lastContainerSizeRef.current = { width, height };
      preserveTerminalViewportContent(currentTerminal, () => {
        currentFitAddon.fit();
        refreshTerminalViewport(currentTerminal);
        syncPtySize(currentTerminal);
      });
    };

    const scheduleResize = () => {
      if (resizeFrameRef.current !== null) {
        return;
      }

      resizeFrameRef.current = requestAnimationFrame(runResize);
    };

    // 捕获阶段拦截 Ctrl+V 触发的原生 paste，避免与手动 ptyWrite 双写入
    const suppressNativePaste = (event: ClipboardEvent) => {
      if (Date.now() <= suppressNativePasteUntilRef.current) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    const terminalContainer = terminalContainerRef.current;
    const helperTextarea = terminal.textarea ?? terminalContainer?.querySelector('textarea');
    const handleHelperTextareaFocusTransition = () => {
      if (!isWindowFocusedRef.current || !isWindowActiveRef.current || !document.hasFocus()) {
        suppressFocusReportsForWindowTransition();
      }
    };
    helperTextarea?.addEventListener('focus', handleHelperTextareaFocusTransition, true);
    helperTextarea?.addEventListener('blur', handleHelperTextareaFocusTransition, true);
    helperTextarea?.addEventListener('paste', suppressNativePaste, true);
    terminalContainer?.addEventListener('paste', suppressNativePaste as EventListener, true);

    const performPaste = (text: string, source: 'context-menu-paste' | 'clipboard-shortcut') => {
      const normalizedText = normalizeTerminalPasteText(text);
      if (!normalizedText || !window.electronAPI || !ptyInputEnabledRef.current) {
        return;
      }

      const payload = terminal.modes.bracketedPasteMode
        ? wrapBracketedPasteText(normalizedText)
        : normalizedText;
      window.electronAPI.ptyWrite(windowId, pane.id, payload, { source });
    };

    // 在捕获阶段接管右键粘贴，阻止 xterm 先污染 helper textarea。
    const handleNativeContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();

      if (!isActiveRef.current) {
        onActivateRef.current();
      }

      void (async () => {
        const text = await readClipboardText();
        if (!text) {
          return;
        }

        const currentTerminal = terminalRef.current;
        if (!currentTerminal || currentTerminal !== terminal) {
          return;
        }

        currentTerminal.focus();
        performPaste(text, 'context-menu-paste');
      })();
    };

    terminalContainer?.addEventListener('contextmenu', handleNativeContextMenu, true);

    // 告诉 xterm.js 忽略应用级快捷键
    terminal.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      const isImagePasteShortcut = pane.backend === 'ssh'
        && matchesSSHClipboardImageShortcut(e, sshClipboardImageShortcutRef.current, isMac);
      if (isImagePasteShortcut) {
        e.preventDefault();
        e.stopPropagation();
        suppressNativePasteUntilRef.current = Date.now() + pasteCaptureBlockMs;
        if (isActiveRef.current && ptyInputEnabledRef.current && window.electronAPI?.tryPasteSshClipboardImage) {
          void (async () => {
            const runtimeCwd = sshCwdTrackerRef.current.cwd ?? pane.cwd;
            const imageResult = await window.electronAPI.tryPasteSshClipboardImage(windowId, pane.id, runtimeCwd);
            if (imageResult.success && imageResult.data?.handled) {
              const remotePath = imageResult.data.remotePath ?? '';
              dispatchAppSuccess(remotePath ? t('ssh.clipboardImageUploaded', { path: remotePath }) : t('ssh.clipboardImageUploaded', { path: '' }));
              return;
            }

            if (!imageResult.success) {
              dispatchAppError(imageResult.error || 'Failed to upload clipboard image');
            }
          })();
        }
        return false;
      }

      // 粘贴：macOS 用 ⌘V，Windows/Linux 用 Ctrl+V
      const isPaste = e.type === 'keydown' && e.key.toLowerCase() === 'v' && !e.shiftKey && !e.altKey
        && (isMac ? (e.metaKey && !e.ctrlKey) : (e.ctrlKey && !e.metaKey));
      if (isPaste) {
        e.preventDefault(); // 阻止浏览器默认粘贴行为（否则会通过 xterm textarea 触发第二次粘贴）
        e.stopPropagation();
        suppressNativePasteUntilRef.current = Date.now() + pasteCaptureBlockMs;
        if (isActiveRef.current && ptyInputEnabledRef.current && window.electronAPI) {
          void (async () => {
            const text = await readClipboardText();
            if (text && window.electronAPI && isActiveRef.current && ptyInputEnabledRef.current) {
              performPaste(text, 'clipboard-shortcut');
            }
          })();
        }
        return false; // 阻止 xterm.js 处理粘贴键
      }

      // 其他按键（包括 Ctrl+Enter、Shift+Enter、Ctrl+J 等）继续走 xterm 的默认处理；
      // 像 Ctrl+Tab 这样的组合如果被上层应用快捷键消费，也不会在这里合成额外 PTY 输入。
      return true;
    });

    const handleTerminalData = (data: string) => {
      if (
        isXtermFocusReport(data)
        && (
          !isWindowActiveRef.current
          || nowMs() <= suppressProgrammaticFocusReportUntilRef.current
        )
      ) {
        return;
      }

      if (pane.ssh) {
        const { nextState, resolvedCwd } = applyTerminalInputToSSHCwdTracker(sshCwdTrackerRef.current, data);
        sshCwdTrackerRef.current = nextState;

        if (resolvedCwd && resolvedCwd !== pane.cwd) {
          updatePaneRuntime(windowId, pane.id, { cwd: resolvedCwd });
        }
      }

      // 新会话的首次回放里，xterm 生成的协议响应仍然要回给 PTY；
      // 只有同一会话后续的补回放才需要屏蔽 synthetic reply。
      if (window.electronAPI && !suppressPtyWriteRef.current && ptyInputEnabledRef.current) {
        window.electronAPI.ptyWrite(windowId, pane.id, data, { source: 'xterm.onData' });
      }
    };

    // 监听用户输入。macOS 的兼容输入也走同一处理函数，避免绕过
    // SSH cwd 跟踪、输入权限和历史回放写入保护。
    const dataDisposable = terminal.onData(handleTerminalData);
    const disposeImeFix = installTerminalImeFix(terminal, imeCompositionStateRef.current, {
      platform,
      onCompatibilityInput: handleTerminalData,
    });

    const binaryDisposable = terminal.onBinary?.((data) => {
      if (window.electronAPI && !suppressPtyWriteRef.current && ptyInputEnabledRef.current) {
        window.electronAPI.ptyWrite(windowId, pane.id, data, { source: 'xterm.onBinary' });
      }
    });

    // 划选复制：选中文本自动写入剪贴板
    const selectionDisposable = terminal.onSelectionChange(() => {
      const selection = terminal.getSelection();
      if (!selection) {
        hideSelectionAiOverlay();
        return;
      }
      // 去掉每行尾部空格填充（xterm.js 复制时会包含终端宽度的空格）
      const trimmed = selection.split('\n').map(line => line.trimEnd()).join('\n');
      if (!trimmed.trim()) {
        pendingSelectionAiTextRef.current = null;
        hideSelectionAiOverlay();
        return;
      }
      void writeClipboardText(trimmed);
      if (isTerminalPointerDownRef.current) {
        pendingSelectionAiTextRef.current = trimmed;
        return;
      }
      showSelectionAiOverlay(trimmed);
    });
    const scrollDisposable = terminal.onScroll((viewportY) => {
      rememberTerminalViewportY(viewportY);
      scheduleStaleRenderSurfaceRecovery();
    });

    const unsubscribePtyData = subscribeToPanePtyData(windowId, pane.id, queueLiveOutput, {
      replayBuffered: false,
    });

    // 窗口大小变化时重新调整终端大小
    const handleResize = () => scheduleResize();

    window.addEventListener('resize', handleResize);

    // 使用 ResizeObserver 监听容器大小变化（拆分窗格、调整大小时触发）
    const resizeObserver = new ResizeObserver(() => {
      scheduleResize();
    });

    if (terminalContainerRef.current) {
      resizeObserver.observe(terminalContainerRef.current);
    }

    // 初始化时调整大小
    scheduleResize();
    const initResizeTimer = window.setTimeout(() => scheduleResize(), 100);
    void replayHistory();
    const initialFocusFrame = requestAnimationFrame(() => {
      if (
        terminalRef.current !== terminal
        || !isActiveRef.current
        || !isWindowActiveRef.current
      ) {
        return;
      }
      focusTerminalInput();
    });

    return () => {
      historyReplayTokenRef.current += 1;
      replayHistoryRef.current = null;
      isHistoryLoadedRef.current = true;
      bufferedLiveDataRef.current = [];
      lastAppliedSeqRef.current = 0;
      lastRenderedSeqRef.current = 0;
      suppressPtyWriteRef.current = false;
      lastLiveOutputQueuedAtRef.current = Number.NEGATIVE_INFINITY;
      hasCompletedReplayForCurrentSessionRef.current = false;
      disposeScrollbackPreservation();
      disposeImeFix();
      dataDisposable.dispose();
      binaryDisposable?.dispose();
      selectionDisposable.dispose();
      scrollDisposable.dispose();
      unsubscribePtyData();
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
      window.clearTimeout(initResizeTimer);
      cancelAnimationFrame(initialFocusFrame);

      if (resizeFrameRef.current !== null) {
        cancelAnimationFrame(resizeFrameRef.current);
        resizeFrameRef.current = null;
      }

      if (repaintFrameRef.current !== null) {
        cancelAnimationFrame(repaintFrameRef.current);
        repaintFrameRef.current = null;
      }

      if (repaintTimerRef.current !== null) {
        window.clearTimeout(repaintTimerRef.current);
        repaintTimerRef.current = null;
      }
      if (staleRenderRecoveryFrameRef.current !== null) {
        cancelAnimationFrame(staleRenderRecoveryFrameRef.current);
        staleRenderRecoveryFrameRef.current = null;
      }
      if (screenSnapshotFrameRef.current !== null) {
        cancelAnimationFrame(screenSnapshotFrameRef.current);
        screenSnapshotFrameRef.current = null;
      }
      if (screenSnapshotTrailingTimerRef.current !== null) {
        window.clearTimeout(screenSnapshotTrailingTimerRef.current);
        screenSnapshotTrailingTimerRef.current = null;
      }
      isVisibleSurfaceRecoveryPendingRef.current = false;

      clearQueuedOutput();
      liveOsc8GuardRef.current.reset();
      replayOsc8GuardRef.current.reset();
      suppressNativePasteUntilRef.current = 0;
      helperTextarea?.removeEventListener('focus', handleHelperTextareaFocusTransition, true);
      helperTextarea?.removeEventListener('blur', handleHelperTextareaFocusTransition, true);
      helperTextarea?.removeEventListener('paste', suppressNativePaste, true);
      terminalContainer?.removeEventListener('paste', suppressNativePaste as EventListener, true);
      terminalContainer?.removeEventListener('contextmenu', handleNativeContextMenu, true);
      webLinkProviderDisposable.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [
    windowId,
    pane.id,
    openExternalUrl,
    handleTerminalLinkHover,
    handleTerminalLinkLeave,
    hideSelectionAiOverlay,
    focusTerminalInput,
    preserveTerminalViewportContent,
    rememberTerminalViewportY,
    scheduleTerminalScreenSnapshot,
    scheduleStaleRenderSurfaceRecovery,
    showSelectionAiOverlay,
    syncPtySize,
    suppressFocusReportsForWindowTransition,
  ]); // 依赖均已 useCallback 包裹，保持终端实例生命周期稳定

  useEffect(() => {
    const previousSession = lastSessionRef.current;
    const previousPid = previousSession.pid;
    const nextPid = pane.pid;
    const resumedFromPaused = (
      isInactiveTerminalPaneStatus(previousSession.status)
      && previousPid === null
      && nextPid !== null
    );
    const shouldReplayFreshSession = (
      terminalRef.current !== null
      && nextPid !== null
      && (
        resumedFromPaused
        || (
          // placeholder pane 已经在首次挂载时完成过空历史初始化，
          // 之后 pid 首次落地时直接走 live PTY 即可；再次重放旧历史会把
          // 启动期的控制序列重新喂给 xterm，可能生成过期协议响应回写到 PTY。
          previousPid !== null
          && nextPid !== previousPid
          && (
            isInactiveTerminalPaneStatus(previousSession.status)
            || previousSession.status === WindowStatus.Error
            || previousSession.status === WindowStatus.Restoring
          )
        )
      )
    );

    if (shouldReplayFreshSession) {
      // pid 变化代表启动了新会话，下一次 history replay 可能正好覆盖 shell
      // 启动握手阶段，不能沿用上一会话的 suppress 状态。
      hasCompletedReplayForCurrentSessionRef.current = false;
      void replayHistoryRef.current?.({ resetTerminal: true });
    }

    lastSessionRef.current = {
      pid: nextPid,
      status: pane.status,
    };
  }, [pane.pid, pane.status]);

  // 处理点击激活
  const handleClick = useCallback(() => {
    if (!isActive) {
      onActivate();
      return;
    }

    // 已处于 active 状态时，点击窗格也要把真实键盘焦点抢回给 xterm。
    focusTerminalInput();
  }, [focusTerminalInput, isActive, onActivate]);

  const handleTerminalPointerCapture = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    lastTerminalPointerRef.current = {
      clientX: event.clientX,
      clientY: event.clientY,
    };
  }, []);

  const handleTerminalMouseDownCapture = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    isTerminalPointerDownRef.current = true;
    pendingSelectionAiTextRef.current = null;
    handleTerminalPointerCapture(event);

    if (!isActive) {
      onActivate();
      focusTerminalInput({ defer: true });
      return;
    }

    focusTerminalInput();
  }, [focusTerminalInput, handleTerminalPointerCapture, isActive, onActivate]);

  const handleTerminalMouseUpCapture = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    handleTerminalPointerCapture(event);
    isTerminalPointerDownRef.current = false;

    const pendingSelectionText = pendingSelectionAiTextRef.current;
    pendingSelectionAiTextRef.current = null;
    if (pendingSelectionText?.trim()) {
      showSelectionAiOverlay(pendingSelectionText);
    }
  }, [handleTerminalPointerCapture, showSelectionAiOverlay]);

  useEffect(() => {
    const handleWindowMouseUp = () => {
      if (!isTerminalPointerDownRef.current) {
        return;
      }

      isTerminalPointerDownRef.current = false;
      const pendingSelectionText = pendingSelectionAiTextRef.current;
      pendingSelectionAiTextRef.current = null;
      if (pendingSelectionText?.trim()) {
        showSelectionAiOverlay(pendingSelectionText);
      }
    };

    window.addEventListener('mouseup', handleWindowMouseUp);
    return () => {
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, [showSelectionAiOverlay]);

  return (
    <div
      ref={paneRootRef}
      className={`relative flex h-full min-h-0 min-w-0 flex-col ${
        isActive ? `ring-1 ${ringColor}` : ''
      }`}
      style={{
        ...activePaneStyle,
        backgroundColor: 'var(--appearance-pane-background)',
      }}
      onClick={handleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Pane Header - 显示 tmux 元数据（title, agentName） */}
      {showPaneHeader && (
        <div
          className="flex items-center justify-between border-b border-[rgb(var(--border))] px-2 py-1"
          style={{ backgroundColor: 'var(--appearance-pane-chrome-background)' }}
        >
          <div className="flex items-center gap-2 min-w-0">
            {/* Agent 颜色指示器 */}
            {pane.agentColor && (
              <div
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: pane.agentColor }}
              />
            )}
            {/* Pane 标题或 Agent 名称 */}
            <span className="truncate font-mono text-xs text-[rgb(var(--muted-foreground))]">
              {pane.title || pane.agentName}
            </span>
          </div>
          <div className="flex min-h-6 items-center justify-center gap-1">
            {showCloseButton && (
              <AppTooltip content={t('terminalPane.close')} placement="pane-corner">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose?.();
                  }}
                  className="flex h-6 w-6 items-center justify-center rounded-md border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--secondary))_84%,transparent)] text-[rgb(var(--muted-foreground))] transition-colors hover:border-[rgb(var(--error)/0.40)] hover:bg-[rgb(var(--error)/0.14)] hover:text-[rgb(var(--foreground))] shadow-lg"
                  aria-label={t('terminalPane.close')}
                >
                  <X size={14} />
                </button>
              </AppTooltip>
            )}
          </div>
        </div>
      )}

      {/* 无 header 时，仅在 hover 时显示关闭按钮 */}
      {!showPaneHeader && (
        <div className="absolute top-1 right-1 z-20">
          {showCloseButton && (
            <AppTooltip content={t('terminalPane.close')} placement="pane-corner">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onClose?.();
                }}
                className="flex h-6 w-6 items-center justify-center rounded-md border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--secondary))_84%,transparent)] text-[rgb(var(--muted-foreground))] transition-colors hover:border-[rgb(var(--error)/0.40)] hover:bg-[rgb(var(--error)/0.14)] hover:text-[rgb(var(--foreground))] shadow-lg"
                aria-label={t('terminalPane.close')}
              >
                <X size={14} />
              </button>
            </AppTooltip>
          )}
        </div>
      )}

      {linkDragOverlay && (
        <TerminalLinkDragOverlay
          url={linkDragOverlay.url}
          label={t('terminalPane.dragLinkIntoBrowser')}
          left={linkDragOverlay.left}
          top={linkDragOverlay.top}
          isDragging={isLinkDragActive}
          onMouseEnter={handleLinkDragOverlayMouseEnter}
          onMouseLeave={handleLinkDragOverlayMouseLeave}
          onDragStateChange={handleLinkDragOverlayStateChange}
        />
      )}

      {selectionAiOverlay && (
        <TerminalSelectionAiOverlay
          state={selectionAiOverlay}
          overlayRef={selectionAiOverlayRef}
          onTranslate={() => runSelectionAiAction('translate')}
          onExplain={() => runSelectionAiAction('explain')}
          onClose={hideSelectionAiOverlay}
        />
      )}

      {/* 终端容器 */}
      <div
        ref={terminalContainerRef}
        data-terminal-input-region="true"
        className="min-h-0 min-w-0 flex-1 overflow-hidden pl-1 pr-0"
        onMouseDownCapture={handleTerminalMouseDownCapture}
        onMouseMoveCapture={handleTerminalPointerCapture}
        onMouseUpCapture={handleTerminalMouseUpCapture}
      />
    </div>
  );
};

TerminalPane.displayName = 'TerminalPane';
