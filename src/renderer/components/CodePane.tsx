import React, {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import * as ContextMenu from '@radix-ui/react-context-menu';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  Activity,
  AlertTriangle,
  Binary,
  Bug,
  Check,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  File as FileIcon,
  FileCode2,
  FlaskConical,
  Folder,
  FolderPlus,
  FolderOpen,
  FolderTree,
  GitBranch,
  GitCompareArrows,
  GitCommitHorizontal,
  GripHorizontal,
  GripVertical,
  History,
  Loader2,
  LocateFixed,
  Lock,
  MoreHorizontal,
  Pin,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings,
  Star,
  type LucideIcon,
  Workflow,
  X,
} from 'lucide-react';
import type {
  CodePaneOpenFile,
  CodePaneState,
  CodePaneSavePipelineState,
  CodePaneSaveQualityState,
  CodePaneSaveQualityStep,
  Pane,
} from '../types/window';
import type {
  CodePaneBreakpoint,
  CodePaneCallHierarchyDirection,
  CodePaneCodeAction,
  CodePaneCodeActionDiagnostic,
  CodePaneDiagnostic,
  CodePaneContentMatch,
  CodePaneDocumentSymbol,
  CodePaneExceptionBreakpoint,
  CodePaneDebugSession,
  CodePaneDebugSessionChangedPayload,
  CodePaneDebugSessionDetails,
  CodePaneDebugSessionOutputPayload,
  CodePaneDebugSessionSnapshot,
  CodePaneDebugScope,
  CodePaneDebugStackFrame,
  CodePaneDebugVariable,
  CodePaneExternalLibrarySection,
  CodePaneGitDiffHunk,
  CodePaneGitBranchEntry,
  CodePaneGitCommitDetails,
  CodePaneGitCommitFileChange,
  CodePaneGitCompareCommitsResult,
  CodePaneGitGraphCommit,
  CodePaneGitBlameLine,
  CodePaneGitConflictDetails,
  CodePaneGitHistoryResult,
  CodePaneGitHistoryEntry,
  CodePaneGitDiffHunksResult,
  CodePaneGitRebasePlanEntry,
  CodePaneGitRebasePlanResult,
  CodePaneGitRepositorySummary,
  CodePaneHoverResult,
  CodePaneFsChangedPayload,
  CodePaneGitStatusEntry,
  CodePaneHierarchyItem,
  CodePaneHierarchyResult,
  CodePaneIndexProgressPayload,
  CodePaneLanguageWorkspaceChangedPayload,
  CodePaneLanguageWorkspaceState,
  CodePaneLocation,
  IpcResponse,
  CodePaneProjectContribution,
  CodePaneProjectCommand,
  CodePaneProjectCommandGroup,
  CodePaneProjectDetailCard,
  CodePaneProjectDiagnostic,
  CodePaneProjectStatusItem,
  CodePaneProjectTreeSection,
  CodePaneProjectTreeItem,
  CodePaneRange,
  CodePaneReadFileResult,
  CodePaneReference,
  CodePaneRunSession,
  CodePaneRunSessionChangedPayload,
  CodePaneRunSessionOutputPayload,
  CodePaneRunTarget,
  CodePaneRunTargetCustomization,
  CodePanePreviewChangeSet,
  CodePanePreviewFileChange,
  CodePanePreviewStats,
  CodePaneSemanticTokensLegend,
  CodePaneSemanticTokensResult,
  CodePaneTextEdit,
  CodePaneTestItem,
  CodePaneTreeEntry,
  CodePaneTypeHierarchyDirection,
  CodePaneWorkspaceSymbol,
} from '../../shared/types/electron-api';
import {
  CODE_PANE_BINARY_FILE_ERROR_CODE,
  CODE_PANE_FILE_TOO_LARGE_ERROR_CODE,
  CODE_PANE_SAVE_CONFLICT_ERROR_CODE,
} from '../../shared/types/electron-api';
import { AppTooltip } from './ui/AppTooltip';
import {
  ideMenuContentClassName,
  ideMenuDangerItemClassName,
  ideMenuItemClassName,
  IdeMenuItemContent,
  IdeMenuSubTriggerContent,
  ideMenuSeparatorClassName,
  ideMenuSubTriggerClassName,
} from './ui/ide-menu';
import { DebugToolWindow } from './code-pane/tool-windows/DebugToolWindow';
import { ConflictResolutionToolWindow } from './code-pane/tool-windows/ConflictResolutionToolWindow';
import { GitHistoryToolWindow } from './code-pane/tool-windows/GitHistoryToolWindow';
import {
  HierarchyToolWindow,
  type HierarchyMode,
  type HierarchyTreeNode,
} from './code-pane/tool-windows/HierarchyToolWindow';
import { PerformanceToolWindow } from './code-pane/tool-windows/PerformanceToolWindow';
import { ProjectToolWindow } from './code-pane/tool-windows/ProjectToolWindow';
import { QuickDocumentationPanel } from './code-pane/QuickDocumentationPanel';
import { RefactorPreviewToolWindow } from './code-pane/tool-windows/RefactorPreviewToolWindow';
import { RunToolWindow } from './code-pane/tool-windows/RunToolWindow';
import {
  SemanticToolWindow,
  type SemanticTokenSummaryEntry,
} from './code-pane/tool-windows/SemanticToolWindow';
import { TestsToolWindow } from './code-pane/tool-windows/TestsToolWindow';
import { WorkspaceToolWindow } from './code-pane/tool-windows/WorkspaceToolWindow';
import { OutlineToolWindow } from './code-pane/tool-windows/OutlineToolWindow';
import { ActionConfirmDialog } from './code-pane/ActionConfirmDialog';
import { ActionInputDialog } from './code-pane/ActionInputDialog';
import { PathMutationDialog } from './code-pane/PathMutationDialog';
import { InlineDiffViewer, splitContentLines } from './code-pane/InlineDiffViewer';
import {
  ExternalChangeReview,
  type ExternalChangeReviewBlock,
} from './code-pane/ExternalChangeReview';
import { BlameGutter } from './code-pane/scm/BlameGutter';
import { CommitWindow } from './code-pane/scm/CommitWindow';
import { GitToolWindow, type GitToolWindowTab } from './code-pane/tool-windows/GitToolWindow';
import { useI18n } from '../i18n';
import { preventMouseButtonFocus } from '../utils/buttonFocus';
import { useWindowStore } from '../stores/windowStore';
import { ensureMonacoEnvironment } from '../utils/monacoEnvironment';
import {
  ensureMonacoLanguageBridge,
  type MonacoLanguageBridge,
} from '../services/code/MonacoLanguageBridge';
import { CodePaneRuntimeStore } from '../stores/codePaneRuntimeStore';
import {
  dedupeProjectRequest,
  getDirectoryCache,
  getExternalLibraryCache,
  getGitBranchesCache,
  getGitGraphCache,
  getGitRebasePlanCache,
  getGitStatusCache,
  getGitSummaryCache,
  invalidateDirectoryCache,
  invalidateProjectCache,
  setExternalLibraryCache,
  setDirectoryCache,
  setGitBranchesCache,
  setGitGraphCache,
  setGitRebasePlanCache,
  setGitStatusCache,
  setGitSummaryCache,
} from '../stores/codePaneProjectCache';
import { getDecodedPathLeafLabel, getPathLeafLabel } from '../utils/pathDisplay';

type MonacoModule = typeof import('monaco-editor');
type MonacoEditor = import('monaco-editor').editor.IStandaloneCodeEditor;
type MonacoDiffEditor = import('monaco-editor').editor.IStandaloneDiffEditor;
type MonacoModel = import('monaco-editor').editor.ITextModel;
type MonacoDisposable = import('monaco-editor').IDisposable;
type MonacoUri = import('monaco-editor').Uri;
type MonacoViewState = import('monaco-editor').editor.ICodeEditorViewState | null;
type MonacoMarker = import('monaco-editor').editor.IMarker;
type MonacoRange = import('monaco-editor').IRange;
type SidebarMode = 'files' | 'search' | 'scm' | 'problems';
type SearchPanelMode = 'contents' | 'symbols' | 'usages';
type SearchEverywhereMode = 'all' | 'commands' | 'recent';
type BottomPanelMode =
  | 'run'
  | 'debug'
  | 'tests'
  | 'project'
  | 'outline'
  | 'git'
  | 'conflict'
  | 'preview'
  | 'history'
  | 'workspace'
  | 'performance'
  | 'hierarchy'
  | 'external-changes'
  | 'semantic';

type CompactDirectoryPresentation = {
  startPath: string;
  displayName: string;
  entry: CodePaneTreeEntry;
  isCompacted: boolean;
  visibleDirectoryPaths: string[];
};

type CompactDirectoryPresentationCacheEntry = {
  entries: CodePaneTreeEntry[];
  presentations: CompactDirectoryPresentation[];
};

type ExplorerTreeRow = {
  key: string;
  sourcePath: string;
  resolvedPath: string;
  entryType: CodePaneTreeEntry['type'];
  depth: number;
  displayName: string;
  title: string;
  isExpanded: boolean;
  isLoading: boolean;
  textClassName: string;
  externalChangeType?: ExternalChangeKind;
};

type RevealExplorerPathOptions = {
  showSidebar?: boolean;
  scrollIntoView?: boolean;
};

type WindowedListSlice<T> = {
  items: T[];
  offsetTop: number;
  totalHeight: number;
  isWindowed: boolean;
};

type WindowedInlineListSlice<T> = {
  items: T[];
  offsetLeft: number;
  totalWidth: number;
  isWindowed: boolean;
};

const CODE_PANE_ROOT_SURFACE_STYLE: React.CSSProperties = {
  backgroundColor: 'var(--appearance-pane-background-strong)',
};

const CODE_PANE_CHROME_SURFACE_STYLE: React.CSSProperties = {
  backgroundColor: 'var(--appearance-pane-chrome-background)',
};

const CODE_PANE_EDITOR_SURFACE_STYLE: React.CSSProperties = {
  backgroundColor: 'var(--appearance-pane-background)',
};

type ContentSearchGroup = {
  filePath: string;
  matches: CodePaneContentMatch[];
};

type UsageSearchGroup = {
  filePath: string;
  references: CodePaneReference[];
};

type SearchSidebarContentRow =
  | {
      kind: 'content-file';
      key: string;
      filePath: string;
    }
  | {
      kind: 'content-match';
      key: string;
      match: CodePaneContentMatch;
    };

type SearchSidebarSymbolRow = {
  key: string;
  symbol: CodePaneWorkspaceSymbol;
};

type SearchSidebarUsageRow =
  | {
      kind: 'usage-file';
      key: string;
      group: UsageSearchGroup;
    }
  | {
      kind: 'usage-reference';
      key: string;
      filePath: string;
      reference: CodePaneReference;
    };

type SearchSidebarRow = SearchSidebarContentRow | SearchSidebarSymbolRow | SearchSidebarUsageRow;

type ProblemGroup = {
  filePath: string;
  entries: Array<MonacoMarker & { filePath: string }>;
};

type ProblemSummary = {
  errorCount: number;
  warningCount: number;
  infoCount: number;
};

const CODE_PANE_SIDEBAR_DEFAULT_WIDTH = 300;
const CODE_PANE_SIDEBAR_MIN_WIDTH = 220;
const CODE_PANE_SIDEBAR_MAX_WIDTH = 520;
const CODE_PANE_EXPLORER_ROW_HEIGHT = 24;
const CODE_PANE_EXPLORER_ROW_OVERSCAN = 10;
const CODE_PANE_EXPLORER_WINDOWING_THRESHOLD = 120;
const CODE_PANE_SEARCH_EVERYWHERE_ROW_HEIGHT = 52;
const CODE_PANE_SEARCH_EVERYWHERE_ROW_OVERSCAN = 8;
const CODE_PANE_SEARCH_EVERYWHERE_WINDOWING_THRESHOLD = 80;
const CODE_PANE_CODE_ACTION_ROW_HEIGHT = 48;
const CODE_PANE_CODE_ACTION_ROW_OVERSCAN = 8;
const CODE_PANE_CODE_ACTION_WINDOWING_THRESHOLD = 60;
const CODE_PANE_BRANCH_MANAGER_ROW_HEIGHT = 28;
const CODE_PANE_BRANCH_MANAGER_ROW_OVERSCAN = 10;
const CODE_PANE_BRANCH_MANAGER_WINDOWING_THRESHOLD = 100;
const CODE_PANE_SEARCH_PANEL_ROW_HEIGHT = 32;
const CODE_PANE_SEARCH_PANEL_ROW_OVERSCAN = 10;
const CODE_PANE_SEARCH_PANEL_WINDOWING_THRESHOLD = 160;
const CODE_PANE_PROBLEMS_ROW_HEIGHT = 28;
const CODE_PANE_PROBLEMS_ROW_OVERSCAN = 10;
const CODE_PANE_PROBLEMS_WINDOWING_THRESHOLD = 120;
const CODE_PANE_OPEN_FILE_TAB_WIDTH = 188;
const CODE_PANE_OPEN_FILE_TAB_OVERSCAN = 4;
const CODE_PANE_OPEN_FILE_TAB_WINDOWING_THRESHOLD = 24;
const CODE_PANE_EXTERNAL_CHANGE_ROW_HEIGHT = 66;
const CODE_PANE_EXTERNAL_CHANGE_ROW_OVERSCAN = 8;
const CODE_PANE_EXTERNAL_CHANGE_WINDOWING_THRESHOLD = 80;
const CODE_PANE_EDITOR_SPLIT_DEFAULT_SIZE = 0.5;
const CODE_PANE_EDITOR_SPLIT_MIN_SIZE = 0.3;
const CODE_PANE_EDITOR_SPLIT_MAX_SIZE = 0.7;
const CODE_PANE_BOTTOM_PANEL_DEFAULT_HEIGHT = 260;
const CODE_PANE_BOTTOM_PANEL_MIN_HEIGHT = 180;
const CODE_PANE_BOTTOM_PANEL_MAX_HEIGHT = 680;
const CODE_PANE_TOP_REGION_MIN_HEIGHT = 180;
const CODE_PANE_STATUS_BAR_RESERVED_HEIGHT = 30;
const CODE_PANE_MAX_RECENT_FILES = 20;
const CODE_PANE_MAX_RECENT_LOCATIONS = 30;
const CODE_PANE_DIRECTORY_REFRESH_CONCURRENCY = 6;
const CODE_PANE_COMPACT_PRELOAD_CONCURRENCY = 4;
const CODE_PANE_MULTI_FILE_SAVE_CONCURRENCY = 3;
const CODE_PANE_REFACTOR_APPLY_CONCURRENCY = 4;
const CODE_PANE_SAVE_GIT_STATUS_REFRESH_DELAY_MS = 350;
const CODE_PANE_MAX_NAVIGATION_HISTORY = 50;
const CODE_PANE_MAX_LOCAL_HISTORY_PER_FILE = 12;
const CODE_PANE_MAX_LOCAL_HISTORY_CONTENT_SIZE = 200_000;
const CODE_PANE_LOCAL_HISTORY_CHANGE_DEBOUNCE_MS = 2500;
const CODE_PANE_MAX_EXTERNAL_CHANGE_ENTRIES = 60;
const CODE_PANE_MAX_OPEN_FILE_TABS = 5;
const CODE_PANE_EXTERNAL_CHANGE_PREVIEW_LINE_LIMIT = 80;
const CODE_PANE_EXTERNAL_CHANGE_INLINE_DIFF_MAX_RENDERED_LINES = 1_200;
const CODE_PANE_EXTERNAL_CHANGE_INLINE_DIFF_MAX_CONTENT_LENGTH = 120_000;
const CODE_PANE_SUPPRESSED_EXTERNAL_CHANGE_TTL_MS = 5000;
const CODE_PANE_FS_CHANGE_FLUSH_DELAY_MS = 48;
const CODE_PANE_EXTERNAL_CHANGE_READ_RETRY_COUNT = 2;
const CODE_PANE_EXTERNAL_CHANGE_READ_RETRY_DELAY_MS = 120;
const CODE_PANE_TODO_TOKENS = ['TODO', 'FIXME', 'XXX'] as const;
const CODE_PANE_SEARCH_CACHE_TTL_MS = 10_000;
const CODE_PANE_TOOL_WINDOW_CACHE_TTL_MS = 5_000;
const CODE_PANE_SAVE_QUALITY_LINT_MARKER_OWNER = 'save-quality-linter';
const CODE_PANE_COMPACT_PACKAGE_SOURCE_ROOTS = [
  ['src', 'main', 'java'],
  ['src', 'test', 'java'],
  ['src', 'main', 'kotlin'],
  ['src', 'test', 'kotlin'],
  ['src', 'main', 'groovy'],
  ['src', 'test', 'groovy'],
  ['src', 'main', 'scala'],
  ['src', 'test', 'scala'],
] as const;
type GitStatusDerivedSnapshot = {
  directoryStatusByPathByRoot: Map<string, Record<string, CodePaneGitStatusEntry['status']>>;
  entriesByPath: Record<string, CodePaneGitStatusEntry>;
  key: string;
};

const emptyGitStatusDerivedSnapshot: GitStatusDerivedSnapshot = {
  directoryStatusByPathByRoot: new Map(),
  entriesByPath: {},
  key: '',
};
const gitStatusDerivedSnapshotCache = new WeakMap<CodePaneGitStatusEntry[], GitStatusDerivedSnapshot>();
const CODE_PANE_DEFAULT_EXCEPTION_BREAKPOINTS: CodePaneExceptionBreakpoint[] = [{
  id: 'all',
  label: 'All Exceptions',
  enabled: false,
}];

type FileNavigationLocation = {
  filePath: string;
  lineNumber: number;
  column: number;
  content?: string;
  language?: string;
  readOnly?: boolean;
  displayPath?: string;
  documentUri?: string;
};

type BannerState = {
  tone: 'warning' | 'error' | 'info';
  message: string;
  filePath?: string;
  showReload?: boolean;
  showOverwrite?: boolean;
};

type FileRuntimeMeta = {
  language: string;
  mtimeMs: number;
  size: number;
  lastSavedAt?: number;
  lastSavedVersionId?: number;
  readOnly?: boolean;
  displayPath?: string;
  documentUri?: string;
};

type EditorSurfaceBindingState = {
  mode: 'editor' | 'diff';
  activeFilePath: string | null;
  secondaryFilePath: string | null;
  diffRequestKey: string | null;
  readonlyPrimary: boolean;
  readonlySecondary: boolean;
};

type NavigationHistoryEntry = {
  filePath: string;
  lineNumber: number;
  column: number;
  displayPath?: string;
};

type SearchEverywhereItem = {
  id: string;
  section: string;
  title: string;
  subtitle?: string;
  meta?: string;
  execute: () => void | Promise<void>;
};

type CodeActionMenuLoadResult = {
  items: CodePaneCodeAction[];
  error: string | null;
};

type CodeActionMenuExecuteResult = {
  close: boolean;
  error?: string | null;
};

type CodeActionMenuControllerHandle = {
  open: () => Promise<void>;
  close: () => boolean;
  isOpen: () => boolean;
};

type SearchEverywhereLoadResult = {
  files: string[];
  symbols: CodePaneWorkspaceSymbol[];
  error: string | null;
};

type SearchEverywhereControllerHandle = {
  open: (mode: SearchEverywhereMode) => void;
  close: () => boolean;
  isOpen: () => boolean;
};

type InspectorPanelMode = 'outline' | 'hierarchy';

type InspectorTargetContext = {
  filePath: string;
  language: string;
  position: {
    lineNumber: number;
    column: number;
  };
};

type CodePaneFsChange = CodePaneFsChangedPayload['changes'][number];
type CodePaneIndexStatus = CodePaneIndexProgressPayload;
type ExternalChangeKind = 'added' | 'modified' | 'deleted';
type ExternalChangeLineEntry = {
  lineNumber: number;
  text: string;
};
type ExternalChangeLineSummary = {
  addedCount: number;
  deletedCount: number;
  addedLines: ExternalChangeLineEntry[];
  deletedLines: ExternalChangeLineEntry[];
  hiddenAddedCount: number;
  hiddenDeletedCount: number;
  isApproximate: boolean;
};
type ExternalChangeEntry = {
  id: string;
  filePath: string;
  relativePath: string;
  previousContent: string | null;
  currentContent: string | null;
  language: string;
  changeType: ExternalChangeKind;
  changedAt: number;
  openedAtChange: boolean;
  canDiff: boolean;
};
type ExternalChangeStateSnapshot = {
  entries: ExternalChangeEntry[];
  entriesByPath: Map<string, ExternalChangeEntry>;
  selectedPath: string | null;
  selectedEntry: ExternalChangeEntry | null;
};
type ExternalChangeReviewState = {
  filePath: string;
  beforeContent: string | null;
  afterContent: string | null;
};
type DefinitionLookupResult = {
  location: CodePaneLocation | null;
  error?: string;
};
type GitSnapshotRefreshOptions = {
  includeGraph?: boolean;
  force?: boolean;
  statusOnly?: boolean;
  delayMs?: number;
};
type PendingGitSnapshotRefresh = {
  includeGraph: boolean;
  force: boolean;
  statusOnly: boolean;
  delayMs?: number;
  resolvers: Array<() => void>;
  rejecters: Array<(error: unknown) => void>;
};
type InFlightGitSnapshotRefresh = PendingGitSnapshotRefresh & {
  promise: Promise<void>;
};
type LoadedDirectoriesRefreshOptions = {
  refreshGitStatus?: boolean;
  refreshExternalLibraries?: boolean;
  forceGitStatusRefresh?: boolean;
};
type PendingLoadedDirectoriesRefresh = {
  refreshGitStatus: boolean;
  refreshExternalLibraries: boolean;
  resolvers: Array<() => void>;
  rejecters: Array<(error: unknown) => void>;
};
type InFlightLoadedDirectoriesRefresh = PendingLoadedDirectoriesRefresh & {
  promise: Promise<void>;
};

type PendingFsChangeDisplayState = {
  filePath: string;
  changedAt: number;
};

function buildContentFromExternalChangeLines(lines: string[]): string {
  return lines.length > 0 ? `${lines.join('\n')}\n` : '';
}

function applyExternalChangeReviewBlock(
  content: string | null,
  startIndex: number,
  deleteCount: number,
  replacementLines: string[],
): string {
  const currentLines = splitContentLines(content);
  currentLines.splice(
    Math.max(0, startIndex),
    Math.max(0, deleteCount),
    ...replacementLines,
  );
  return buildContentFromExternalChangeLines(currentLines);
}

function areGitRevisionDiffRequestsEqual(
  previousRequest: GitRevisionDiffRequest | null,
  nextRequest: GitRevisionDiffRequest | null,
): boolean {
  return previousRequest?.filePath === nextRequest?.filePath
    && previousRequest?.leftCommitSha === nextRequest?.leftCommitSha
    && previousRequest?.rightCommitSha === nextRequest?.rightCommitSha
    && previousRequest?.leftLabel === nextRequest?.leftLabel
    && previousRequest?.rightLabel === nextRequest?.rightLabel;
}

function canGitRefreshRequestSatisfy(
  activeRefresh: Pick<PendingGitSnapshotRefresh, 'includeGraph' | 'force' | 'statusOnly'>,
  requestedRefresh: Pick<PendingGitSnapshotRefresh, 'includeGraph' | 'force' | 'statusOnly'>,
): boolean {
  if (requestedRefresh.includeGraph && !activeRefresh.includeGraph) {
    return false;
  }

  if (requestedRefresh.force && !activeRefresh.force) {
    return false;
  }

  if (!requestedRefresh.statusOnly && activeRefresh.statusOnly) {
    return false;
  }

  return true;
}

type BranchManagerTreeNode =
  | {
    key: string;
    kind: 'folder';
    label: string;
    children: BranchManagerTreeNode[];
    branchCount: number;
  }
  | {
    key: string;
    kind: 'branch';
    label: string;
    branch: CodePaneGitBranchEntry;
  };

type BranchManagerSection = {
  key: 'recent' | 'local' | 'remote';
  label: string;
  count: number;
  nodes: BranchManagerTreeNode[];
};

type BranchManagerBranchBuckets = {
  local: CodePaneGitBranchEntry[];
  remote: CodePaneGitBranchEntry[];
  recent: CodePaneGitBranchEntry[];
};

type BranchManagerTreeFilterResult = {
  count: number;
  nodes: BranchManagerTreeNode[];
};

type BranchManagerVisibleTreeRow = {
  key: string;
  depth: number;
  node: BranchManagerTreeNode;
};

type BranchManagerVisibleSection = BranchManagerSection & {
  rows: BranchManagerVisibleTreeRow[];
};

type BranchManagerQuickAction = {
  id: string;
  label: string;
  shortcut: string;
  icon: LucideIcon;
  disabled: boolean;
  onSelect: () => void;
};

type DebugEvaluationEntry = {
  id: string;
  expression: string;
  value: string;
};

type DebugWatchEntry = {
  id: string;
  expression: string;
  value?: string;
  error?: string;
};

type EditorTarget = 'editor' | 'secondary' | 'diff';
type CodePaneTodoItem = CodePaneContentMatch & {
  token: typeof CODE_PANE_TODO_TOKENS[number];
};
type LocalHistoryEntry = {
  id: string;
  filePath: string;
  label: string;
  reason: 'open' | 'draft' | 'save' | 'restore';
  timestamp: number;
  content: string;
  preview: string;
};

type EditorActionMenuItem = {
  id: string;
  label: string;
  icon?: React.ReactNode;
  disabled?: boolean;
  active?: boolean | (() => boolean);
  onSelect: () => void;
};

type ToolWindowLauncher = {
  id: string;
  label: string;
  icon: LucideIcon;
  disabled?: boolean;
  active?: boolean;
  onClick: () => void;
};

type SidebarTabItem = {
  mode: SidebarMode;
  icon: LucideIcon;
  label: string;
};

type CodePaneCursorSnapshot = {
  lineNumber: number;
  column: number;
  target: EditorTarget;
};

type CodePaneNavigationSnapshot = {
  recentFiles: string[];
  recentLocations: NavigationHistoryEntry[];
  canNavigateBack: boolean;
  canNavigateForward: boolean;
};

class CodePaneCursorStore {
  private snapshot: CodePaneCursorSnapshot = {
    lineNumber: 1,
    column: 1,
    target: 'editor',
  };

  private readonly listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): CodePaneCursorSnapshot => this.snapshot;

  setSnapshot(nextSnapshot: Partial<CodePaneCursorSnapshot>): void {
    const resolvedSnapshot: CodePaneCursorSnapshot = {
      ...this.snapshot,
      ...nextSnapshot,
    };

    if (
      resolvedSnapshot.lineNumber === this.snapshot.lineNumber
      && resolvedSnapshot.column === this.snapshot.column
      && resolvedSnapshot.target === this.snapshot.target
    ) {
      return;
    }

    this.snapshot = resolvedSnapshot;
    for (const listener of Array.from(this.listeners)) {
      listener();
    }
  }
}

class CodePaneNavigationStore {
  private snapshot: CodePaneNavigationSnapshot = {
    recentFiles: [],
    recentLocations: [],
    canNavigateBack: false,
    canNavigateForward: false,
  };

  private readonly listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): CodePaneNavigationSnapshot => this.snapshot;

  setSnapshot(nextSnapshot: Partial<CodePaneNavigationSnapshot>): void {
    const resolvedSnapshot: CodePaneNavigationSnapshot = {
      ...this.snapshot,
      ...nextSnapshot,
    };

    if (
      areStringListsEqual(this.snapshot.recentFiles, resolvedSnapshot.recentFiles)
      && areNavigationHistoryEntriesEqual(this.snapshot.recentLocations, resolvedSnapshot.recentLocations)
      && this.snapshot.canNavigateBack === resolvedSnapshot.canNavigateBack
      && this.snapshot.canNavigateForward === resolvedSnapshot.canNavigateForward
    ) {
      return;
    }

    this.snapshot = resolvedSnapshot;
    for (const listener of Array.from(this.listeners)) {
      listener();
    }
  }
}

function RuntimeActivityIndicator({
  runtimeStore,
  hasActiveTasks,
  label,
}: {
  runtimeStore: CodePaneRuntimeStore;
  hasActiveTasks: boolean;
  label: string;
}) {
  useSyncExternalStore(
    runtimeStore.subscribe.bind(runtimeStore),
    runtimeStore.getVersion.bind(runtimeStore),
    runtimeStore.getVersion.bind(runtimeStore),
  );
  const hasRunningRequests = runtimeStore.getRunningRequests().length > 0;

  if (!hasActiveTasks && !hasRunningRequests) {
    return null;
  }

  return (
    <span className="rounded bg-[rgb(var(--warning)/0.14)] px-1.5 py-0.5 text-[rgb(var(--warning))]">
      {label}
    </span>
  );
}

function useCodePaneCursorSnapshot(cursorStore: CodePaneCursorStore): CodePaneCursorSnapshot {
  return useSyncExternalStore(
    cursorStore.subscribe,
    cursorStore.getSnapshot,
    cursorStore.getSnapshot,
  );
}

function useCodePaneNavigationSnapshot(navigationStore: CodePaneNavigationStore): CodePaneNavigationSnapshot {
  return useSyncExternalStore(
    navigationStore.subscribe,
    navigationStore.getSnapshot,
    navigationStore.getSnapshot,
  );
}

function CursorSideEffects({
  cursorStore,
  isQuickDocumentationOpen,
  isEditorSplitVisible,
  secondaryFilePath,
  viewMode,
  onLoadQuickDocumentation,
  onNormalizeEditorTarget,
}: {
  cursorStore: CodePaneCursorStore;
  isQuickDocumentationOpen: boolean;
  isEditorSplitVisible: boolean;
  secondaryFilePath: string | null;
  viewMode: string;
  onLoadQuickDocumentation: () => void;
  onNormalizeEditorTarget: (target: EditorTarget) => void;
}) {
  const cursorSnapshot = useCodePaneCursorSnapshot(cursorStore);

  useEffect(() => {
    if (!isQuickDocumentationOpen) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      onLoadQuickDocumentation();
    }, 120);

    return () => {
      window.clearTimeout(timer);
    };
  }, [
    cursorSnapshot.column,
    cursorSnapshot.lineNumber,
    cursorSnapshot.target,
    isQuickDocumentationOpen,
    onLoadQuickDocumentation,
  ]);

  useEffect(() => {
    if (viewMode !== 'diff' && cursorSnapshot.target === 'diff') {
      onNormalizeEditorTarget('editor');
      return;
    }

    if ((!isEditorSplitVisible || !secondaryFilePath) && cursorSnapshot.target === 'secondary') {
      onNormalizeEditorTarget('editor');
    }
  }, [
    cursorSnapshot.target,
    isEditorSplitVisible,
    onNormalizeEditorTarget,
    secondaryFilePath,
    viewMode,
  ]);

  return null;
}

function CursorBlameGutter({
  cursorStore,
  enabled,
  loading,
  blameLines,
  onToggle,
  onOpenHistory,
}: {
  cursorStore: CodePaneCursorStore;
  enabled: boolean;
  loading: boolean;
  blameLines: CodePaneGitBlameLine[];
  onToggle: () => void;
  onOpenHistory: (lineNumber: number) => void;
}) {
  const { lineNumber } = useCodePaneCursorSnapshot(cursorStore);
  const blameEntriesByLine = useMemo(() => {
    const nextEntriesByLine = new Map<number, CodePaneGitBlameLine>();
    for (const entry of blameLines) {
      nextEntriesByLine.set(entry.lineNumber, entry);
    }
    return nextEntriesByLine;
  }, [blameLines]);
  const activeBlameEntry = useMemo(() => (
    blameEntriesByLine.get(lineNumber)
    ?? blameLines[0]
    ?? null
  ), [blameEntriesByLine, blameLines, lineNumber]);

  return (
    <BlameGutter
      enabled={enabled}
      loading={loading}
      entry={activeBlameEntry}
      onToggle={onToggle}
      onOpenHistory={() => {
        onOpenHistory(lineNumber);
      }}
    />
  );
}

function EditorActionMenuItemRow({
  item,
  className,
}: {
  item: EditorActionMenuItem;
  className: string;
}) {
  const isActive = typeof item.active === 'function' ? item.active() : Boolean(item.active);

  return (
    <DropdownMenu.Item
      disabled={item.disabled}
      onSelect={item.onSelect}
      className={`${className} ${isActive ? 'bg-[rgb(var(--primary))]/12 text-[rgb(var(--foreground))]' : ''} data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40`}
    >
      <IdeMenuItemContent
        icon={item.icon}
        label={item.label}
        trailing={isActive ? <span className="h-1.5 w-1.5 rounded-full bg-[rgb(var(--success))]" /> : null}
      />
    </DropdownMenu.Item>
  );
}

function LazyContextMenu({
  trigger,
  children,
}: {
  trigger: React.ReactNode;
  children: () => React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <ContextMenu.Root
      onOpenChange={setIsOpen}
    >
      <ContextMenu.Trigger asChild>
        {trigger}
      </ContextMenu.Trigger>
      {isOpen ? children() : null}
    </ContextMenu.Root>
  );
}

const ExplorerTreeRowButton = React.memo(function ExplorerTreeRowButton({
  row,
  isSelected,
  onActivate,
  onPromote,
  onToggleDirectory,
  renderContextMenu,
  t,
}: {
  row: ExplorerTreeRow;
  isSelected: boolean;
  onActivate: (row: ExplorerTreeRow) => void;
  onPromote: (row: ExplorerTreeRow) => void;
  onToggleDirectory: (row: ExplorerTreeRow) => void;
  renderContextMenu: (row: ExplorerTreeRow) => React.ReactNode;
  t: ReturnType<typeof useI18n>['t'];
}) {
  const isDirectory = row.entryType === 'directory';

  return (
    <LazyContextMenu
      key={row.key}
      children={() => renderContextMenu(row)}
      trigger={(
        <button
          type="button"
          onClick={() => {
            onActivate(row);
          }}
          onDoubleClick={() => {
            onPromote(row);
          }}
          className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs transition-colors ${isSelected ? 'bg-[rgb(var(--primary))]/15 text-[rgb(var(--foreground))]' : 'text-[rgb(var(--muted-foreground))] hover:bg-[rgb(var(--accent))] hover:text-[rgb(var(--foreground))]'}`}
          style={{ paddingLeft: `${10 + row.depth * 14}px` }}
          title={row.title}
          data-explorer-path={row.resolvedPath}
        >
          {isDirectory ? (
            <span
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-[rgb(var(--muted-foreground))] hover:bg-[rgb(var(--accent))]"
              aria-label={row.isExpanded ? t('codePane.collapse') : t('codePane.expand')}
              role="button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onToggleDirectory(row);
              }}
            >
              {row.isExpanded ? <ChevronDown size={14} className="shrink-0" /> : <ChevronRight size={14} className="shrink-0" />}
            </span>
          ) : (
            <span className="w-[14px] shrink-0" />
          )}
          {isDirectory ? (
            row.isExpanded ? <FolderOpen size={14} className="shrink-0 text-[rgb(var(--warning))]" /> : <Folder size={14} className="shrink-0 text-[rgb(var(--warning))]" />
          ) : (
            <FileIcon size={14} className="shrink-0 text-[rgb(var(--muted-foreground))]" />
          )}
          <span className={`min-w-0 flex-1 truncate ${row.textClassName}`}>
            {row.displayName}
          </span>
          {row.isLoading && (
            <Loader2 size={12} className="shrink-0 animate-spin text-[rgb(var(--muted-foreground))]" />
          )}
          {row.externalChangeType && (
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${getExternalChangeDotClassName(row.externalChangeType)}`}
              title={t('codePane.externalChangesTab')}
            />
          )}
        </button>
      )}
    />
  );
}, (previousProps, nextProps) => (
  previousProps.isSelected === nextProps.isSelected
  && previousProps.t === nextProps.t
  && previousProps.onActivate === nextProps.onActivate
  && previousProps.onPromote === nextProps.onPromote
  && previousProps.onToggleDirectory === nextProps.onToggleDirectory
  && previousProps.renderContextMenu === nextProps.renderContextMenu
  && previousProps.row.key === nextProps.row.key
  && previousProps.row.sourcePath === nextProps.row.sourcePath
  && previousProps.row.resolvedPath === nextProps.row.resolvedPath
  && previousProps.row.entryType === nextProps.row.entryType
  && previousProps.row.depth === nextProps.row.depth
  && previousProps.row.displayName === nextProps.row.displayName
  && previousProps.row.title === nextProps.row.title
  && previousProps.row.isExpanded === nextProps.row.isExpanded
  && previousProps.row.isLoading === nextProps.row.isLoading
  && previousProps.row.textClassName === nextProps.row.textClassName
  && previousProps.row.externalChangeType === nextProps.row.externalChangeType
));

const SearchResultRowButton = React.memo(function SearchResultRowButton({
  filePath,
  isSelected,
  entryTextClassName,
  relativePath,
  onActivate,
  onPromote,
  renderContextMenu,
}: {
  filePath: string;
  isSelected: boolean;
  entryTextClassName: string;
  relativePath: string;
  onActivate: (filePath: string) => void;
  onPromote: (filePath: string) => void;
  renderContextMenu: (filePath: string) => React.ReactNode;
}) {
  return (
    <LazyContextMenu
      key={filePath}
      children={() => renderContextMenu(filePath)}
      trigger={(
        <button
          type="button"
          onClick={() => {
            onActivate(filePath);
          }}
          onDoubleClick={() => {
            onPromote(filePath);
          }}
          className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs transition-colors ${isSelected ? 'bg-[rgb(var(--primary))]/15 text-[rgb(var(--foreground))]' : 'text-[rgb(var(--muted-foreground))] hover:bg-[rgb(var(--accent))] hover:text-[rgb(var(--foreground))]'}`}
        >
          <FileIcon size={14} className="shrink-0 text-[rgb(var(--muted-foreground))]" />
          <span className={`min-w-0 flex-1 truncate ${entryTextClassName}`}>{getPathLeafLabel(filePath)}</span>
          <span className="max-w-[160px] truncate text-[10px] text-[rgb(var(--muted-foreground))]">
            {relativePath}
          </span>
        </button>
      )}
    />
  );
});

const SidebarRailButton = React.memo(function SidebarRailButton({
  mode,
  icon: Icon,
  label,
  isSelected,
  onSelect,
}: {
  mode: SidebarMode;
  icon: LucideIcon;
  label: string;
  isSelected: boolean;
  onSelect: (mode: SidebarMode) => void;
}) {

  return (
    <AppTooltip content={label} placement="pane-corner">
        <button
          type="button"
          aria-label={label}
          aria-pressed={isSelected}
          onClick={() => {
            onSelect(mode);
          }}
          className={`flex h-8 w-8 items-center justify-center rounded text-[rgb(var(--muted-foreground))] transition-colors ${isSelected ? 'bg-[rgb(var(--accent))] text-[rgb(var(--foreground))]' : 'hover:bg-[rgb(var(--accent))] hover:text-[rgb(var(--foreground))]'}`}
        >
          <Icon size={15} />
        </button>
    </AppTooltip>
  );
});

const ToolWindowRailButton = React.memo(function ToolWindowRailButton({
  label,
  icon: Icon,
  disabled,
  active,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  disabled?: boolean;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <AppTooltip content={label} placement="pane-corner">
        <button
          type="button"
          aria-label={label}
          aria-pressed={active}
          onClick={onClick}
          disabled={disabled}
          className={`flex h-8 w-8 items-center justify-center rounded transition-colors ${
            active
            ? 'bg-[rgb(var(--accent))] text-[rgb(var(--foreground))]'
            : 'text-[rgb(var(--muted-foreground))] hover:bg-[rgb(var(--accent))] hover:text-[rgb(var(--foreground))]'
        } disabled:cursor-not-allowed disabled:opacity-40`}
      >
        <Icon size={15} />
      </button>
    </AppTooltip>
  );
});

const ActivityRail = React.memo(function ActivityRail({
  sidebarTabs,
  toolWindowLaunchers,
  sidebarMode,
  isSidebarVisible,
  onSidebarModeSelect,
}: {
  sidebarTabs: SidebarTabItem[];
  toolWindowLaunchers: ToolWindowLauncher[];
  sidebarMode: SidebarMode;
  isSidebarVisible: boolean;
  onSidebarModeSelect: (mode: SidebarMode) => void;
}) {
  return (
    <div
      data-testid="code-pane-activity-rail"
      className="flex h-full w-10 shrink-0 flex-col border-r border-[rgb(var(--border))]"
      style={CODE_PANE_CHROME_SURFACE_STYLE}
    >
      <div className="flex flex-col items-center gap-0.5 px-0.5 py-1.5">
        {sidebarTabs.map((tab) => (
          <SidebarRailButton
            key={tab.mode}
            mode={tab.mode}
            icon={tab.icon}
            label={tab.label}
            isSelected={sidebarMode === tab.mode && isSidebarVisible}
            onSelect={onSidebarModeSelect}
          />
        ))}
      </div>

      <div className="mt-auto border-t border-[rgb(var(--border))]">
        <div className="flex max-h-full flex-col items-center gap-0.5 overflow-y-auto px-0.5 py-1.5">
          {toolWindowLaunchers.map((item) => (
            <ToolWindowRailButton
              key={item.id}
              label={item.label}
              icon={item.icon}
              disabled={item.disabled}
              active={item.active}
              onClick={item.onClick}
            />
          ))}
        </div>
      </div>
    </div>
  );
});

const OpenFileTab = React.memo(function OpenFileTab({
  path,
  pinned,
  preview,
  isActive,
  isReadOnly,
  entryTextClassName,
  externalChangeType,
  label,
  rootPath,
  renderContextMenu,
  onActivate,
  onClose,
  t,
}: {
  path: string;
  pinned?: boolean;
  preview?: boolean;
  isActive: boolean;
  isReadOnly: boolean;
  entryTextClassName: string;
  externalChangeType?: ExternalChangeKind;
  label: string;
  rootPath: string;
  renderContextMenu: (
    filePath: string,
    entryType: CodePaneTreeEntry['type'],
    options?: {
      allowDiff?: boolean;
      pinned?: boolean;
      showPinToggle?: boolean;
    },
  ) => React.ReactNode;
  onActivate: (filePath: string, options?: { preview?: boolean; promotePreview?: boolean }) => void | Promise<void>;
  onClose: (filePath: string) => void | Promise<void>;
  t: ReturnType<typeof useI18n>['t'];
}) {
  const isPinned = Boolean(pinned);

  return (
    <LazyContextMenu
      children={() => renderContextMenu(path, 'file', {
        allowDiff: isPathInside(rootPath, path),
        pinned: isPinned,
        showPinToggle: true,
      })}
      trigger={(
        <div
          className={`group relative flex min-w-0 max-w-[220px] items-center gap-2 border-r border-[rgb(var(--border))] px-3 py-2 text-xs ${isActive ? 'bg-[rgb(var(--accent))] text-[rgb(var(--foreground))]' : 'text-[rgb(var(--muted-foreground))] hover:bg-[rgb(var(--accent))] hover:text-[rgb(var(--foreground))]'}`}
        >
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
            onClick={() => {
              void onActivate(path);
            }}
            onDoubleClick={() => {
              if (preview) {
                void onActivate(path, { promotePreview: true });
              }
            }}
          >
            <FileIcon size={12} className="shrink-0" />
            {isPinned && <Pin size={10} className="shrink-0 text-[rgb(var(--muted-foreground))]" />}
            {isReadOnly && <Lock size={10} className="shrink-0 text-[rgb(var(--muted-foreground))]" aria-label={t('codePane.readOnly')} />}
            <span className={`truncate ${entryTextClassName}`}>{label}</span>
            {externalChangeType && (
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${getExternalChangeDotClassName(externalChangeType)}`}
                title={t('codePane.externalChangesTab')}
              />
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              void onClose(path);
            }}
            className="rounded p-0.5 text-[rgb(var(--muted-foreground))] transition-colors hover:bg-[rgb(var(--accent))] hover:text-[rgb(var(--foreground))]"
          >
            <X size={11} />
          </button>
        </div>
      )}
    />
  );
});

const SavePipelineToggles = React.memo(function SavePipelineToggles({
  state,
  onToggleFormat,
  onToggleImports,
  onToggleLint,
  t,
}: {
  state: CodePaneSavePipelineState;
  onToggleFormat: () => void;
  onToggleImports: () => void;
  onToggleLint: () => void;
  t: ReturnType<typeof useI18n>['t'];
}) {
  return (
    <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onToggleFormat}
          className={`rounded px-1.5 py-0.5 font-medium transition-colors ${
            state.formatOnSave
            ? 'bg-[rgb(var(--success))/0.14] text-[rgb(var(--success))]'
            : 'bg-[rgb(var(--secondary))] text-[rgb(var(--muted-foreground))] hover:text-[rgb(var(--foreground))]'
        }`}
      >
        {t('codePane.saveQualityFormatToggle')}
      </button>
        <button
          type="button"
          onClick={onToggleImports}
          className={`rounded px-1.5 py-0.5 font-medium transition-colors ${
            state.organizeImportsOnSave
            ? 'bg-[rgb(var(--info))/0.14] text-[rgb(var(--info))]'
            : 'bg-[rgb(var(--secondary))] text-[rgb(var(--muted-foreground))] hover:text-[rgb(var(--foreground))]'
        }`}
      >
        {t('codePane.saveQualityImportsToggle')}
      </button>
        <button
          type="button"
          onClick={onToggleLint}
          className={`rounded px-1.5 py-0.5 font-medium transition-colors ${
            state.lintOnSave
            ? 'bg-[rgb(var(--warning))/0.14] text-[rgb(var(--warning))]'
            : 'bg-[rgb(var(--secondary))] text-[rgb(var(--muted-foreground))] hover:text-[rgb(var(--foreground))]'
        }`}
      >
        {t('codePane.saveQualityLintToggle')}
      </button>
    </div>
  );
});

const SearchEverywhereDialog = React.memo(function SearchEverywhereDialog({
  inputRef,
  mode,
  query,
  items,
  selectedIndex,
  selectedItem,
  error,
  isLoading,
  onClose,
  onModeChange,
  onQueryChange,
  onMoveSelection,
  onExecuteSelected,
  onHoverIndex,
  onExecuteItem,
  t,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  mode: SearchEverywhereMode;
  query: string;
  items: SearchEverywhereItem[];
  selectedIndex: number;
  selectedItem: SearchEverywhereItem | null;
  error: string | null;
  isLoading: boolean;
  onClose: () => void;
  onModeChange: (mode: SearchEverywhereMode) => void;
  onQueryChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onMoveSelection: (direction: 1 | -1) => void;
  onExecuteSelected: () => void;
  onHoverIndex: (index: number) => void;
  onExecuteItem: (item: SearchEverywhereItem) => void;
  t: ReturnType<typeof useI18n>['t'];
}) {
  const listScrollRef = React.useRef<HTMLDivElement | null>(null);
  const [listScrollTop, setListScrollTop] = React.useState(0);
  const [listViewportHeight, setListViewportHeight] = React.useState(0);
  const pendingListScrollTopRef = React.useRef<number | null>(null);
  const listScrollAnimationFrameRef = React.useRef<number | null>(null);
  const sectionedItems = React.useMemo(() => {
    const nextSectionedItems: Array<{ item: SearchEverywhereItem; index: number; showSectionLabel: boolean }> = [];
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index]!;
      const previousItem = index > 0 ? items[index - 1] : null;
      nextSectionedItems.push({
        item,
        index,
        showSectionLabel: !previousItem || previousItem.section !== item.section,
      });
    }
    return nextSectionedItems;
  }, [items]);
  const visibleItems = React.useMemo(() => getWindowedListSlice({
    items: sectionedItems,
    scrollTop: listScrollTop,
    viewportHeight: listViewportHeight,
    rowHeight: CODE_PANE_SEARCH_EVERYWHERE_ROW_HEIGHT,
    overscan: CODE_PANE_SEARCH_EVERYWHERE_ROW_OVERSCAN,
    threshold: CODE_PANE_SEARCH_EVERYWHERE_WINDOWING_THRESHOLD,
  }), [listScrollTop, listViewportHeight, sectionedItems]);

  const scheduleListScrollTopUpdate = React.useCallback((nextScrollTop: number) => {
    pendingListScrollTopRef.current = nextScrollTop;
    if (listScrollAnimationFrameRef.current !== null) {
      return;
    }

    listScrollAnimationFrameRef.current = window.requestAnimationFrame(() => {
      listScrollAnimationFrameRef.current = null;
      const pendingScrollTop = pendingListScrollTopRef.current;
      pendingListScrollTopRef.current = null;
      if (pendingScrollTop !== null) {
        setListScrollTop((currentScrollTop) => (
          currentScrollTop === pendingScrollTop ? currentScrollTop : pendingScrollTop
        ));
      }
    });
  }, []);

  React.useEffect(() => {
    const container = listScrollRef.current;
    if (!container) {
      return;
    }

    const syncViewport = () => {
      setListViewportHeight(container.clientHeight);
      setListScrollTop(container.scrollTop);
    };

    syncViewport();

    const resizeObserver = new ResizeObserver(() => {
      syncViewport();
    });
    resizeObserver.observe(container);
    return () => {
      if (listScrollAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(listScrollAnimationFrameRef.current);
        listScrollAnimationFrameRef.current = null;
      }
      resizeObserver.disconnect();
    };
  }, []);

  return (
    <div className="absolute inset-0 z-30 flex items-start justify-center bg-[color-mix(in_srgb,rgb(var(--background))_74%,transparent)] p-4 backdrop-blur-sm">
      <div className="mt-10 flex w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--background))_96%,transparent)] shadow-2xl">
        <div className="border-b border-[rgb(var(--border))] p-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="text-sm font-medium text-[rgb(var(--foreground))]">{t('codePane.searchEverywhereTitle')}</div>
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 text-[rgb(var(--muted-foreground))] hover:bg-[rgb(var(--accent))] hover:text-[rgb(var(--foreground))]"
            >
              <X size={14} />
            </button>
          </div>
          <div className="mb-3 flex gap-1 rounded bg-[color-mix(in_srgb,rgb(var(--secondary))_72%,transparent)] p-1">
            {([
              ['all', t('codePane.searchEverywhereAll')],
              ['recent', t('codePane.searchEverywhereRecent')],
              ['commands', t('codePane.searchEverywhereCommands')],
            ] as const).map(([nextMode, label]) => (
              <button
                key={nextMode}
                type="button"
                onClick={() => {
                  onModeChange(nextMode);
                }}
                className={`flex-1 rounded px-2 py-1 text-[11px] font-medium transition-colors ${
                  mode === nextMode
                    ? 'bg-[rgb(var(--accent))] text-[rgb(var(--foreground))]'
                    : 'text-[rgb(var(--muted-foreground))] hover:bg-[rgb(var(--accent))] hover:text-[rgb(var(--foreground))]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 rounded border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--secondary))_76%,transparent)] px-3 py-2">
            <Search size={13} className="shrink-0 text-[rgb(var(--muted-foreground))]" />
            <input
              ref={inputRef}
              value={query}
              onChange={onQueryChange}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  onMoveSelection(1);
                  return;
                }

                if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  onMoveSelection(-1);
                  return;
                }

                if (event.key === 'Enter' && selectedItem) {
                  event.preventDefault();
                  onExecuteSelected();
                  return;
                }

                if (event.key === 'Escape') {
                  event.preventDefault();
                  onClose();
                }
              }}
              placeholder={t('codePane.searchEverywherePlaceholder')}
              className="w-full bg-transparent text-sm text-[rgb(var(--foreground))] outline-none placeholder:text-[rgb(var(--muted-foreground))]"
            />
            {isLoading && <Loader2 size={13} className="shrink-0 animate-spin text-[rgb(var(--muted-foreground))]" />}
          </div>
        </div>
        <div
          ref={listScrollRef}
          className="max-h-[60vh] overflow-auto p-2"
          onScroll={(event) => {
            scheduleListScrollTopUpdate(event.currentTarget.scrollTop);
          }}
        >
          {error ? (
            <div className="px-2 py-3 text-sm text-[rgb(var(--error))]">{error}</div>
          ) : items.length > 0 ? (
            visibleItems.isWindowed ? (
              <div style={{ height: `${visibleItems.totalHeight}px`, position: 'relative' }}>
                <div style={{ transform: `translateY(${visibleItems.offsetTop}px)` }}>
                  {visibleItems.items.map(({ item, index, showSectionLabel }) => {
                    const isSelected = index === selectedIndex;
                    return (
                      <React.Fragment key={item.id}>
                        {showSectionLabel && (
                          <div className="px-2 pt-2 text-[11px] font-medium uppercase tracking-[0.12em] text-[rgb(var(--muted-foreground))]">
                            {item.section}
                          </div>
                        )}
                        <button
                          type="button"
                          onMouseEnter={() => {
                            onHoverIndex(index);
                          }}
                          onClick={() => {
                            onExecuteItem(item);
                          }}
                          className={`flex w-full items-start justify-between gap-3 rounded px-2 py-2 text-left transition-colors ${
                            isSelected
                              ? 'bg-[rgb(var(--accent))] text-[rgb(var(--foreground))]'
                              : 'text-[rgb(var(--muted-foreground))] hover:bg-[rgb(var(--accent))] hover:text-[rgb(var(--foreground))]'
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm">{item.title}</div>
                            {item.subtitle && (
                              <div className="mt-1 truncate text-xs text-[rgb(var(--muted-foreground))]">{item.subtitle}</div>
                            )}
                          </div>
                          {item.meta && (
                            <div className="shrink-0 text-[11px] text-[rgb(var(--muted-foreground))]">{item.meta}</div>
                          )}
                        </button>
                      </React.Fragment>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="space-y-1">
                {sectionedItems.map(({ item, index, showSectionLabel }) => {
                  const isSelected = index === selectedIndex;
                  return (
                    <React.Fragment key={item.id}>
                      {showSectionLabel && (
                        <div className="px-2 pt-2 text-[11px] font-medium uppercase tracking-[0.12em] text-[rgb(var(--muted-foreground))]">
                          {item.section}
                        </div>
                      )}
                      <button
                        type="button"
                        onMouseEnter={() => {
                          onHoverIndex(index);
                        }}
                        onClick={() => {
                          onExecuteItem(item);
                        }}
                        className={`flex w-full items-start justify-between gap-3 rounded px-2 py-2 text-left transition-colors ${
                          isSelected
                            ? 'bg-[rgb(var(--accent))] text-[rgb(var(--foreground))]'
                            : 'text-[rgb(var(--muted-foreground))] hover:bg-[rgb(var(--accent))] hover:text-[rgb(var(--foreground))]'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm">{item.title}</div>
                          {item.subtitle && (
                            <div className="mt-1 truncate text-xs text-[rgb(var(--muted-foreground))]">{item.subtitle}</div>
                          )}
                        </div>
                        {item.meta && (
                          <div className="shrink-0 text-[11px] text-[rgb(var(--muted-foreground))]">{item.meta}</div>
                        )}
                      </button>
                    </React.Fragment>
                  );
                })}
              </div>
            )
          ) : (
            <div className="px-2 py-3 text-sm text-[rgb(var(--muted-foreground))]">{t('codePane.searchEverywhereEmpty')}</div>
          )}
        </div>
      </div>
    </div>
  );
});

const SearchEverywhereController = React.memo(React.forwardRef<SearchEverywhereControllerHandle, {
  navigationStore: CodePaneNavigationStore;
  rootPath: string;
  onGetCommandItems: () => SearchEverywhereItem[];
  onLoadResults: (mode: SearchEverywhereMode, query: string) => Promise<SearchEverywhereLoadResult>;
  onOpenEditorLocation: (
    location: FileNavigationLocation,
    options?: {
      preserveTabs?: boolean;
      recordHistory?: boolean;
      recordRecent?: boolean;
      clearForward?: boolean;
    },
  ) => Promise<void>;
  onGetDisplayPath: (filePath: string) => string;
  onGetFileLabel: (filePath: string) => string;
  t: ReturnType<typeof useI18n>['t'];
}>(function SearchEverywhereController({
  navigationStore,
  rootPath,
  onGetCommandItems,
  onLoadResults,
  onOpenEditorLocation,
  onGetDisplayPath,
  onGetFileLabel,
  t,
}, ref) {
  const navigationSnapshot = useCodePaneNavigationSnapshot(navigationStore);
  const recentFiles = navigationSnapshot.recentFiles;
  const recentLocations = navigationSnapshot.recentLocations;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const itemsRef = useRef<SearchEverywhereItem[]>([]);
  const selectedIndexRef = useRef(0);
  const requestIdRef = useRef(0);
  const isOpenRef = useRef(false);
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<SearchEverywhereMode>('all');
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [fileResults, setFileResults] = useState<string[]>([]);
  const [symbolResults, setSymbolResults] = useState<CodePaneWorkspaceSymbol[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const close = useCallback(() => {
    requestIdRef.current += 1;
    if (!isOpenRef.current) {
      return false;
    }
    isOpenRef.current = false;
    setIsOpen((currentOpen) => (currentOpen ? false : currentOpen));
    setQuery((currentQuery) => (currentQuery.length === 0 ? currentQuery : ''));
    setError((currentError) => (currentError === null ? currentError : null));
    setFileResults((currentResults) => (currentResults.length === 0 ? currentResults : []));
    setSymbolResults((currentResults) => (currentResults.length === 0 ? currentResults : []));
    setIsLoading((currentLoading) => (currentLoading ? false : currentLoading));
    setSelectedIndex((currentIndex) => (currentIndex === 0 ? currentIndex : 0));
    return true;
  }, []);

  const open = useCallback((nextMode: SearchEverywhereMode) => {
    isOpenRef.current = true;
    setMode((currentMode) => (currentMode === nextMode ? currentMode : nextMode));
    setQuery((currentQuery) => (currentQuery.length === 0 ? currentQuery : ''));
    setError((currentError) => (currentError === null ? currentError : null));
    setSelectedIndex((currentIndex) => (currentIndex === 0 ? currentIndex : 0));
    setIsOpen((currentOpen) => (currentOpen ? currentOpen : true));
  }, []);

  React.useImperativeHandle(ref, () => ({
    open,
    close,
    isOpen: () => isOpenRef.current,
  }), [close, open]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const trimmedQuery = deferredQuery.trim();
    if (!trimmedQuery || mode === 'commands' || mode === 'recent') {
      requestIdRef.current += 1;
      setFileResults((currentResults) => (currentResults.length === 0 ? currentResults : []));
      setSymbolResults((currentResults) => (currentResults.length === 0 ? currentResults : []));
      setError((currentError) => (currentError === null ? currentError : null));
      setIsLoading((currentLoading) => (currentLoading ? false : currentLoading));
      return undefined;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setIsLoading((currentLoading) => (currentLoading ? currentLoading : true));
    setError((currentError) => (currentError === null ? currentError : null));

    const timer = window.setTimeout(() => {
      void onLoadResults(mode, trimmedQuery).then((result) => {
        if (requestIdRef.current !== requestId) {
          return;
        }

        setFileResults((currentResults) => (
          areStringListsEqual(currentResults, result.files) ? currentResults : result.files
        ));
        setSymbolResults((currentResults) => (
          areWorkspaceSymbolListsEqual(currentResults, result.symbols) ? currentResults : result.symbols
        ));
        setError((currentError) => (
          currentError === result.error ? currentError : result.error
        ));
        setIsLoading((currentLoading) => (currentLoading ? false : currentLoading));
      });
    }, 180);

    return () => {
      window.clearTimeout(timer);
    };
  }, [deferredQuery, isOpen, mode, onLoadResults]);

  const items = useMemo<SearchEverywhereItem[]>(() => {
    if (!isOpen) {
      return [];
    }

    const trimmedQuery = query.trim().toLowerCase();
    const nextItems: SearchEverywhereItem[] = [];
    const commandItems = mode === 'recent' ? [] : onGetCommandItems();
    const matchesQuery = (title: string, meta?: string) => (
      trimmedQuery.length === 0
      || title.toLowerCase().includes(trimmedQuery)
      || meta?.toLowerCase().includes(trimmedQuery)
    );

    if (mode === 'commands') {
      for (const item of commandItems) {
        if (matchesQuery(item.title, item.meta)) {
          nextItems.push(item);
        }
      }
      return nextItems;
    }

    if (mode === 'recent') {
      for (let index = 0; index < recentLocations.length; index += 1) {
        const location = recentLocations[index]!;
        if (
          trimmedQuery.length > 0
          && !getPathLeafLabel(location.displayPath ?? location.filePath).toLowerCase().includes(trimmedQuery)
          && !location.filePath.toLowerCase().includes(trimmedQuery)
        ) {
          continue;
        }

        nextItems.push({
          id: `recent-location-${location.filePath}-${location.lineNumber}-${location.column}-${index}`,
          section: t('codePane.recentLocations'),
          title: getPathLeafLabel(location.displayPath ?? location.filePath) || location.filePath,
          subtitle: location.displayPath ?? getRelativePath(rootPath, location.filePath),
          meta: `${location.lineNumber}:${location.column}`,
          execute: async () => {
            await onOpenEditorLocation(location, {
              preserveTabs: true,
              recordHistory: true,
              recordRecent: true,
              clearForward: true,
            });
          },
        });
      }
      for (const filePath of recentFiles) {
        const displayPath = onGetDisplayPath(filePath);
        if (
          trimmedQuery.length > 0
          && !getPathLeafLabel(displayPath).toLowerCase().includes(trimmedQuery)
          && !displayPath.toLowerCase().includes(trimmedQuery)
        ) {
          continue;
        }

        nextItems.push({
          id: `recent-file-${filePath}`,
          section: t('codePane.recentFiles'),
          title: onGetFileLabel(filePath),
          subtitle: getRelativePath(rootPath, displayPath),
          execute: async () => {
            await onOpenEditorLocation({
              filePath,
              lineNumber: 1,
              column: 1,
            }, {
              preserveTabs: true,
              recordHistory: true,
              recordRecent: true,
              clearForward: true,
            });
          },
        });
      }
      return nextItems;
    }

    for (const item of commandItems) {
      if (matchesQuery(item.title, item.meta)) {
        nextItems.push(item);
      }
    }

    if (trimmedQuery.length === 0) {
      for (let index = 0; index < recentLocations.length; index += 1) {
        const location = recentLocations[index]!;
        nextItems.push({
          id: `search-recent-location-${location.filePath}-${location.lineNumber}-${location.column}-${index}`,
          section: t('codePane.recentLocations'),
          title: getPathLeafLabel(location.displayPath ?? location.filePath) || location.filePath,
          subtitle: location.displayPath ?? getRelativePath(rootPath, location.filePath),
          meta: `${location.lineNumber}:${location.column}`,
          execute: async () => {
            await onOpenEditorLocation(location, {
              preserveTabs: true,
              recordHistory: true,
              recordRecent: true,
              clearForward: true,
            });
          },
        });
      }
      for (const filePath of recentFiles) {
        const displayPath = onGetDisplayPath(filePath);
        nextItems.push({
          id: `search-recent-file-${filePath}`,
          section: t('codePane.recentFiles'),
          title: onGetFileLabel(filePath),
          subtitle: getRelativePath(rootPath, displayPath),
          execute: async () => {
            await onOpenEditorLocation({
              filePath,
              lineNumber: 1,
              column: 1,
            }, {
              preserveTabs: true,
              recordHistory: true,
              recordRecent: true,
              clearForward: true,
            });
          },
        });
      }
    }

    for (const filePath of fileResults) {
      nextItems.push({
        id: `search-file-${filePath}`,
        section: t('codePane.searchEverywhereFilesSection'),
        title: getPathLeafLabel(filePath) || filePath,
        subtitle: getRelativePath(rootPath, filePath),
        execute: async () => {
          await onOpenEditorLocation({
            filePath,
            lineNumber: 1,
            column: 1,
          }, {
            recordHistory: true,
            recordRecent: true,
            clearForward: true,
          });
        },
      });
    }

    for (const symbol of symbolResults) {
      nextItems.push({
        id: `search-symbol-${symbol.filePath}-${symbol.name}-${symbol.range.startLineNumber}-${symbol.range.startColumn}`,
        section: t('codePane.searchEverywhereSymbolsSection'),
        title: symbol.name,
        subtitle: getRelativePath(rootPath, symbol.filePath),
        meta: `${symbol.range.startLineNumber}:${symbol.range.startColumn}`,
        execute: async () => {
          await onOpenEditorLocation({
            filePath: symbol.filePath,
            lineNumber: symbol.range.startLineNumber,
            column: symbol.range.startColumn,
          }, {
            preserveTabs: true,
            recordHistory: true,
            recordRecent: true,
            clearForward: true,
          });
        },
      });
    }

    return nextItems;
  }, [
    fileResults,
    isOpen,
    mode,
    onGetCommandItems,
    onGetDisplayPath,
    onGetFileLabel,
    onOpenEditorLocation,
    query,
    recentFiles,
    recentLocations,
    rootPath,
    symbolResults,
    t,
  ]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setSelectedIndex((currentIndex) => (
      items.length === 0
        ? 0
        : Math.min(currentIndex, items.length - 1)
    ));
  }, [isOpen, items]);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    selectedIndexRef.current = selectedIndex;
  }, [selectedIndex]);

  const handleModeChange = useCallback((nextMode: SearchEverywhereMode) => {
    setMode((currentMode) => (currentMode === nextMode ? currentMode : nextMode));
    setSelectedIndex((currentIndex) => (currentIndex === 0 ? currentIndex : 0));
  }, []);

  const handleQueryChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const nextQuery = event.target.value;
    setQuery((currentQuery) => (
      currentQuery === nextQuery ? currentQuery : nextQuery
    ));
  }, []);

  const handleMoveSelection = useCallback((direction: 1 | -1) => {
    setSelectedIndex((currentIndex) => (
      itemsRef.current.length === 0
        ? 0
        : direction > 0
          ? Math.min(currentIndex + 1, itemsRef.current.length - 1)
          : Math.max(currentIndex - 1, 0)
    ));
  }, []);

  const handleHoverIndex = useCallback((index: number) => {
    setSelectedIndex(index);
  }, []);

  const executeItem = useCallback((item: SearchEverywhereItem | undefined) => {
    if (!item) {
      return;
    }

    close();
    void item.execute();
  }, [close]);

  const handleExecuteItem = useCallback((item: SearchEverywhereItem) => {
    executeItem(item);
  }, [executeItem]);

  const handleExecuteSelected = useCallback(() => {
    executeItem(itemsRef.current[selectedIndexRef.current]);
  }, [executeItem]);

  if (!isOpen) {
    return null;
  }

  const selectedItem = items[selectedIndex] ?? null;
  return (
    <SearchEverywhereDialog
      inputRef={inputRef}
      mode={mode}
      query={query}
      items={items}
      selectedIndex={selectedIndex}
      selectedItem={selectedItem}
      error={error}
      isLoading={isLoading}
      onClose={close}
      onModeChange={handleModeChange}
      onQueryChange={handleQueryChange}
      onMoveSelection={handleMoveSelection}
      onExecuteSelected={handleExecuteSelected}
      onHoverIndex={handleHoverIndex}
      onExecuteItem={handleExecuteItem}
      t={t}
    />
  );
}));

const CodeActionMenuDialog = React.memo(function CodeActionMenuDialog({
  items,
  selectedIndex,
  error,
  isLoading,
  onClose,
  onHoverIndex,
  onExecuteAction,
  t,
}: {
  items: CodePaneCodeAction[];
  selectedIndex: number;
  error: string | null;
  isLoading: boolean;
  onClose: () => void;
  onHoverIndex: (index: number) => void;
  onExecuteAction: (action: CodePaneCodeAction) => void;
  t: ReturnType<typeof useI18n>['t'];
}) {
  const listScrollRef = React.useRef<HTMLDivElement | null>(null);
  const [listScrollTop, setListScrollTop] = React.useState(0);
  const [listViewportHeight, setListViewportHeight] = React.useState(0);
  const pendingListScrollTopRef = React.useRef<number | null>(null);
  const listScrollAnimationFrameRef = React.useRef<number | null>(null);
  const indexedItems = React.useMemo(() => (
    items.map((action, index) => ({ action, index }))
  ), [items]);
  const visibleItems = React.useMemo(() => getWindowedListSlice({
    items: indexedItems,
    scrollTop: listScrollTop,
    viewportHeight: listViewportHeight,
    rowHeight: CODE_PANE_CODE_ACTION_ROW_HEIGHT,
    overscan: CODE_PANE_CODE_ACTION_ROW_OVERSCAN,
    threshold: CODE_PANE_CODE_ACTION_WINDOWING_THRESHOLD,
  }), [indexedItems, listScrollTop, listViewportHeight]);

  const scheduleListScrollTopUpdate = React.useCallback((nextScrollTop: number) => {
    pendingListScrollTopRef.current = nextScrollTop;
    if (listScrollAnimationFrameRef.current !== null) {
      return;
    }

    listScrollAnimationFrameRef.current = window.requestAnimationFrame(() => {
      listScrollAnimationFrameRef.current = null;
      const pendingScrollTop = pendingListScrollTopRef.current;
      pendingListScrollTopRef.current = null;
      if (pendingScrollTop !== null) {
        setListScrollTop((currentScrollTop) => (
          currentScrollTop === pendingScrollTop ? currentScrollTop : pendingScrollTop
        ));
      }
    });
  }, []);

  React.useEffect(() => {
    const container = listScrollRef.current;
    if (!container) {
      return;
    }

    const syncViewport = () => {
      setListViewportHeight(container.clientHeight);
      setListScrollTop(container.scrollTop);
    };

    syncViewport();

    const resizeObserver = new ResizeObserver(() => {
      syncViewport();
    });
    resizeObserver.observe(container);
    return () => {
      if (listScrollAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(listScrollAnimationFrameRef.current);
        listScrollAnimationFrameRef.current = null;
      }
      resizeObserver.disconnect();
    };
  }, []);

  const renderActionItem = React.useCallback(({ action, index }: { action: CodePaneCodeAction; index: number }) => {
    const isSelected = index === selectedIndex;
    return (
      <button
        key={action.id}
        type="button"
        disabled={Boolean(action.disabledReason)}
        onMouseEnter={() => {
          onHoverIndex(index);
        }}
        onClick={() => {
          onExecuteAction(action);
        }}
        className={`flex min-h-12 w-full items-start justify-between gap-3 rounded px-2 py-2 text-left transition-colors ${
          action.disabledReason
            ? 'cursor-not-allowed text-[rgb(var(--muted-foreground))]/60'
            : isSelected
              ? 'bg-[rgb(var(--accent))] text-[rgb(var(--foreground))] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.03)]'
              : 'text-[rgb(var(--foreground))] hover:bg-[rgb(var(--accent))] hover:text-[rgb(var(--foreground))]'
        }`}
      >
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm">{action.title}</div>
          {(action.kind || action.disabledReason) && (
            <div className="mt-1 truncate text-xs text-[rgb(var(--muted-foreground))]">
              {action.disabledReason ?? action.kind}
            </div>
          )}
        </div>
        {action.isPreferred && (
          <div className="shrink-0 rounded border border-[rgb(var(--success))/0.30] bg-[rgb(var(--success))/0.08] px-1.5 py-0.5 text-[10px] font-medium text-[rgb(var(--success))]">
            {t('codePane.codeActionsPreferred')}
          </div>
        )}
      </button>
    );
  }, [onExecuteAction, onHoverIndex, selectedIndex, t]);

  return (
    <div className="absolute inset-0 z-30 flex items-start justify-center bg-[color-mix(in_srgb,rgb(var(--background))_70%,transparent)] p-4 backdrop-blur-sm">
      <div className="mt-16 flex w-full max-w-xl flex-col overflow-hidden rounded-lg border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--background))_96%,transparent)] shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-[rgb(var(--border))] px-3 py-2">
          <div className="text-sm font-medium text-[rgb(var(--foreground))]">{t('codePane.codeActions')}</div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-[rgb(var(--muted-foreground))] hover:bg-[rgb(var(--accent))] hover:text-[rgb(var(--foreground))]"
          >
            <X size={14} />
          </button>
        </div>
        <div
          ref={listScrollRef}
          className="max-h-[50vh] overflow-auto p-2"
          onScroll={(event) => {
            scheduleListScrollTopUpdate(event.currentTarget.scrollTop);
          }}
        >
          {isLoading ? (
            <div className="flex items-center gap-2 px-2 py-3 text-sm text-[rgb(var(--muted-foreground))]">
              <Loader2 size={13} className="animate-spin" />
              {t('codePane.codeActionsLoading')}
            </div>
          ) : error ? (
            <div className="px-2 py-3 text-sm text-[rgb(var(--error))]">{error}</div>
          ) : items.length > 0 ? (
            visibleItems.isWindowed ? (
              <div style={{ height: `${visibleItems.totalHeight}px`, position: 'relative' }}>
                <div style={{ transform: `translateY(${visibleItems.offsetTop}px)` }}>
                  {visibleItems.items.map(renderActionItem)}
                </div>
              </div>
            ) : (
              <div className="space-y-1">
                {indexedItems.map(renderActionItem)}
              </div>
            )
          ) : (
            <div className="px-2 py-3 text-sm text-[rgb(var(--muted-foreground))]">{t('codePane.codeActionsEmpty')}</div>
          )}
        </div>
        {items.length > 0 && !isLoading && (
          <div className="border-t border-[rgb(var(--border))] px-3 py-2 text-[11px] text-[rgb(var(--muted-foreground))]">
            <span>{t('codePane.codeActionsHint')}</span>
          </div>
        )}
      </div>
    </div>
  );
});

const BranchManagerTreeRow = React.memo(function BranchManagerTreeRow({
  node,
  depth,
  isCollapsed,
  menuContainer,
  contextMenuContentClassName,
  contextMenuItemClassName,
  contextMenuDangerItemClassName,
  onToggleNode,
  onCheckoutBranch,
  onRenameBranch,
  onDeleteBranch,
  t,
}: {
  node: BranchManagerTreeNode;
  depth: number;
  isCollapsed: boolean;
  menuContainer: HTMLElement | null;
  contextMenuContentClassName: string;
  contextMenuItemClassName: string;
  contextMenuDangerItemClassName: string;
  onToggleNode: (nodeKey: string) => void;
  onCheckoutBranch: (branch: CodePaneGitBranchEntry) => void;
  onRenameBranch: (branch: CodePaneGitBranchEntry) => void;
  onDeleteBranch: (branch: CodePaneGitBranchEntry) => void;
  t: ReturnType<typeof useI18n>['t'];
}) {
  if (node.kind === 'folder') {
    return (
      <button
        type="button"
        onClick={() => {
          onToggleNode(node.key);
        }}
        className="group flex h-6 w-full items-center gap-1.5 rounded px-1 text-left text-xs text-[rgb(var(--muted-foreground))] transition-colors hover:bg-[rgb(var(--accent))] hover:text-[rgb(var(--foreground))]"
        style={{ paddingLeft: `${10 + (depth * 16)}px` }}
      >
        {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        <Folder size={12} className="text-[rgb(var(--muted-foreground))] group-hover:text-[rgb(var(--foreground))]" />
        <span className="min-w-0 flex-1 truncate">{node.label}</span>
      </button>
    );
  }

  const branch = node.branch;
  const isCurrent = branch.current;
  const isRemote = branch.kind === 'remote';
  const branchMeta = [
    branch.upstream,
    branch.aheadCount > 0 ? `↑ ${branch.aheadCount}` : '',
    branch.behindCount > 0 ? `↓ ${branch.behindCount}` : '',
  ].filter(Boolean).join('  ');

  return (
    <div
      className={`group flex h-7 items-center gap-1.5 rounded pr-1 text-xs transition-colors ${
        isCurrent
          ? 'bg-[rgb(var(--info))/0.14] text-[rgb(var(--foreground))]'
          : 'text-[rgb(var(--foreground))] hover:bg-[rgb(var(--accent))] hover:text-[rgb(var(--foreground))]'
      }`}
      style={{ paddingLeft: `${28 + (depth * 16)}px` }}
    >
      <button
        type="button"
        onClick={() => {
          onCheckoutBranch(branch);
        }}
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
      >
        {isCurrent ? (
          <Star size={12} className="shrink-0 fill-[rgb(var(--warning))] text-[rgb(var(--warning))]" />
        ) : (
          <GitBranch size={12} className={`shrink-0 ${isRemote ? 'text-[rgb(var(--muted-foreground))]' : 'text-[rgb(var(--warning))]'}`} />
        )}
        <span className="min-w-0 flex-1 truncate">{node.label}</span>
        {branchMeta && (
          <span className="hidden max-w-[140px] truncate text-[10px] text-[rgb(var(--muted-foreground))] group-hover:block">
            {branchMeta}
          </span>
        )}
        {isCurrent && (
          <Check size={12} className="shrink-0 text-[rgb(var(--success))]" />
        )}
      </button>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            aria-label={t('codePane.gitBranchActions')}
            onClick={(event) => {
              event.stopPropagation();
            }}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[rgb(var(--muted-foreground))] opacity-0 transition-opacity hover:bg-[rgb(var(--accent))] hover:text-[rgb(var(--foreground))] group-hover:opacity-100"
          >
            <MoreHorizontal size={12} />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal container={menuContainer ?? undefined}>
          <DropdownMenu.Content
            className={contextMenuContentClassName}
            sideOffset={4}
            align="end"
          >
            <DropdownMenu.Item
              onSelect={() => {
                onCheckoutBranch(branch);
              }}
              disabled={branch.current}
              className={`${contextMenuItemClassName} data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40`}
            >
              <IdeMenuItemContent
                icon={<GitBranch size={14} />}
                label={isRemote ? t('codePane.gitCreateTrackingBranch') : t('codePane.gitCheckout')}
              />
            </DropdownMenu.Item>
            {branch.kind === 'local' && (
              <>
                <DropdownMenu.Item
                  onSelect={() => {
                    onRenameBranch(branch);
                  }}
                  className={contextMenuItemClassName}
                >
                  <IdeMenuItemContent
                    icon={<FileIcon size={14} />}
                    label={t('codePane.gitRenameBranch')}
                  />
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  onSelect={() => {
                    onDeleteBranch(branch);
                  }}
                  disabled={branch.current}
                  className={`${contextMenuDangerItemClassName} data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40`}
                >
                  <IdeMenuItemContent
                    icon={<X size={14} />}
                    label={t('codePane.gitDeleteBranch')}
                  />
                </DropdownMenu.Item>
              </>
            )}
            <DropdownMenu.Separator className={ideMenuSeparatorClassName} />
            <DropdownMenu.Item
              onSelect={() => {
                void window.electronAPI.writeClipboardText(branch.name);
              }}
              className={contextMenuItemClassName}
            >
              <IdeMenuItemContent
                icon={<FileIcon size={14} />}
                label={t('codePane.gitCopyBranchName')}
              />
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
});

const BranchManagerPopup = React.memo(function BranchManagerPopup({
  searchInputRef,
  query,
  quickActions,
  sections,
  collapsedNodeKeys,
  gitBranchesCount,
  error,
  isLoading,
  menuContainer,
  contextMenuContentClassName,
  contextMenuItemClassName,
  contextMenuDangerItemClassName,
  onQueryChange,
  onRefresh,
  onOpenWorkbench,
  onToggleNode,
  onCheckoutBranch,
  onRenameBranch,
  onDeleteBranch,
  t,
}: {
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  query: string;
  quickActions: BranchManagerQuickAction[];
  sections: BranchManagerVisibleSection[];
  collapsedNodeKeys: Set<string>;
  gitBranchesCount: number;
  error: string | null;
  isLoading: boolean;
  menuContainer: HTMLElement | null;
  contextMenuContentClassName: string;
  contextMenuItemClassName: string;
  contextMenuDangerItemClassName: string;
  onQueryChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onRefresh: () => void;
  onOpenWorkbench: () => void;
  onToggleNode: (nodeKey: string) => void;
  onCheckoutBranch: (branch: CodePaneGitBranchEntry) => void;
  onRenameBranch: (branch: CodePaneGitBranchEntry) => void;
  onDeleteBranch: (branch: CodePaneGitBranchEntry) => void;
  t: ReturnType<typeof useI18n>['t'];
}) {
  const listScrollRef = React.useRef<HTMLDivElement | null>(null);
  const [listScrollTop, setListScrollTop] = React.useState(0);
  const [listViewportHeight, setListViewportHeight] = React.useState(0);
  const pendingListScrollTopRef = React.useRef<number | null>(null);
  const listScrollAnimationFrameRef = React.useRef<number | null>(null);
  const flattenedRows = React.useMemo(() => {
    const nextRows: Array<{
      section: BranchManagerVisibleSection;
      row: BranchManagerVisibleTreeRow;
    }> = [];
    for (const section of sections) {
      for (const row of section.rows) {
        nextRows.push({ section, row });
      }
    }
    return nextRows;
  }, [sections]);
  const visibleRows = React.useMemo(() => getWindowedListSlice({
    items: flattenedRows,
    scrollTop: listScrollTop,
    viewportHeight: listViewportHeight,
    rowHeight: CODE_PANE_BRANCH_MANAGER_ROW_HEIGHT,
    overscan: CODE_PANE_BRANCH_MANAGER_ROW_OVERSCAN,
    threshold: CODE_PANE_BRANCH_MANAGER_WINDOWING_THRESHOLD,
  }), [flattenedRows, listScrollTop, listViewportHeight]);

  const scheduleListScrollTopUpdate = React.useCallback((nextScrollTop: number) => {
    pendingListScrollTopRef.current = nextScrollTop;
    if (listScrollAnimationFrameRef.current !== null) {
      return;
    }

    listScrollAnimationFrameRef.current = window.requestAnimationFrame(() => {
      listScrollAnimationFrameRef.current = null;
      const pendingScrollTop = pendingListScrollTopRef.current;
      pendingListScrollTopRef.current = null;
      if (pendingScrollTop !== null) {
        setListScrollTop((currentScrollTop) => (
          currentScrollTop === pendingScrollTop ? currentScrollTop : pendingScrollTop
        ));
      }
    });
  }, []);

  React.useEffect(() => {
    const container = listScrollRef.current;
    if (!container) {
      return;
    }

    const syncViewport = () => {
      setListViewportHeight(container.clientHeight);
      setListScrollTop(container.scrollTop);
    };

    syncViewport();

    const resizeObserver = new ResizeObserver(() => {
      syncViewport();
    });
    resizeObserver.observe(container);
    return () => {
      if (listScrollAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(listScrollAnimationFrameRef.current);
        listScrollAnimationFrameRef.current = null;
      }
      resizeObserver.disconnect();
    };
  }, []);

  return (
    <div className="absolute left-0 top-full z-[80] mt-1 flex h-[min(72vh,680px)] w-[360px] flex-col overflow-hidden rounded border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--background))_96%,transparent)] shadow-2xl">
      <div className="flex items-center gap-2 border-b border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--secondary))_76%,transparent)] px-2 py-1.5">
        <div className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--secondary))_72%,transparent)] px-2">
          <Search size={13} className="shrink-0 text-[rgb(var(--muted-foreground))]" />
          <input
            ref={searchInputRef}
            value={query}
            onChange={onQueryChange}
            placeholder={t('codePane.gitBranchSearchPlaceholder')}
            className="min-w-0 flex-1 bg-transparent text-xs text-[rgb(var(--foreground))] outline-none placeholder:text-[rgb(var(--muted-foreground))]"
          />
        </div>
        <button
          type="button"
          aria-label={t('codePane.refresh')}
          onClick={onRefresh}
          className="rounded p-1 text-[rgb(var(--muted-foreground))] hover:bg-[rgb(var(--accent))] hover:text-[rgb(var(--foreground))]"
        >
          {isLoading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
        </button>
        <button
          type="button"
          aria-label={t('codePane.gitOpenWorkbench')}
          onClick={onOpenWorkbench}
          className="rounded p-1 text-[rgb(var(--muted-foreground))] hover:bg-[rgb(var(--accent))] hover:text-[rgb(var(--foreground))]"
        >
          <Settings size={13} />
        </button>
      </div>

      <div
        ref={listScrollRef}
        className="min-h-0 flex-1 overflow-y-auto px-2 py-2"
        onScroll={(event) => {
          scheduleListScrollTopUpdate(event.currentTarget.scrollTop);
        }}
        >
          {quickActions.length > 0 && (
          <div className="mb-3 space-y-0.5 border-b border-[rgb(var(--border))] pb-2">
            {quickActions.map((action) => {
              const ActionIcon = action.icon;
              return (
                <button
                  key={action.id}
                  type="button"
                  disabled={action.disabled}
                  onClick={action.onSelect}
                  className="flex h-7 w-full items-center gap-2 rounded px-2 text-left text-xs text-[rgb(var(--foreground))] transition-colors hover:bg-[rgb(var(--accent))] hover:text-[rgb(var(--foreground))] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ActionIcon size={13} className="shrink-0 text-[rgb(var(--muted-foreground))]" />
                  <span className="min-w-0 flex-1 truncate">{action.label}</span>
                  {action.shortcut && (
                    <span className="text-[10px] text-[rgb(var(--muted-foreground))]">{action.shortcut}</span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {error && (
          <div className="mb-2 rounded border border-[rgb(var(--error))/0.20] bg-[rgb(var(--error))/0.10] px-2 py-1.5 text-xs text-[rgb(var(--error))]">
            {error}
          </div>
        )}

        {isLoading && gitBranchesCount === 0 ? (
          <div className="flex h-32 items-center justify-center gap-2 text-xs text-[rgb(var(--muted-foreground))]">
            <Loader2 size={13} className="animate-spin" />
            {t('codePane.loading')}
          </div>
        ) : sections.length > 0 ? (
          visibleRows.isWindowed ? (
            <div style={{ height: `${visibleRows.totalHeight}px`, position: 'relative' }}>
              <div style={{ transform: `translateY(${visibleRows.offsetTop}px)` }}>
                {visibleRows.items.map(({ row }) => (
                  <BranchManagerTreeRow
                    key={row.key}
                    node={row.node}
                    depth={row.depth}
                    isCollapsed={collapsedNodeKeys.has(row.node.key)}
                    menuContainer={menuContainer}
                    contextMenuContentClassName={contextMenuContentClassName}
                    contextMenuItemClassName={contextMenuItemClassName}
                    contextMenuDangerItemClassName={contextMenuDangerItemClassName}
                    onToggleNode={onToggleNode}
                    onCheckoutBranch={onCheckoutBranch}
                    onRenameBranch={onRenameBranch}
                    onDeleteBranch={onDeleteBranch}
                    t={t}
                  />
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {sections.map((section) => (
                <div key={section.key}>
                  <div className="mb-1 flex h-6 items-center gap-1.5 px-1 text-xs font-medium text-[rgb(var(--muted-foreground))]">
                    <ChevronDown size={12} className="text-[rgb(var(--muted-foreground))]" />
                    <span className="min-w-0 flex-1 truncate">{section.label}</span>
                    <span className="rounded bg-[rgb(var(--secondary))] px-1.5 py-0.5 text-[10px] text-[rgb(var(--muted-foreground))]">
                      {section.count}
                    </span>
                  </div>
                  <div className="space-y-0.5">
                    {section.rows.map((row) => (
                      <BranchManagerTreeRow
                        key={row.key}
                        node={row.node}
                        depth={row.depth}
                        isCollapsed={collapsedNodeKeys.has(row.node.key)}
                        menuContainer={menuContainer}
                        contextMenuContentClassName={contextMenuContentClassName}
                        contextMenuItemClassName={contextMenuItemClassName}
                        contextMenuDangerItemClassName={contextMenuDangerItemClassName}
                        onToggleNode={onToggleNode}
                        onCheckoutBranch={onCheckoutBranch}
                        onRenameBranch={onRenameBranch}
                        onDeleteBranch={onDeleteBranch}
                        t={t}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )
        ) : (
          <div className="flex h-32 items-center justify-center text-xs text-[rgb(var(--muted-foreground))]">
            {t('codePane.gitBranchNoResults')}
          </div>
        )}
      </div>
    </div>
  );
});

const CodeActionMenuController = React.memo(React.forwardRef<CodeActionMenuControllerHandle, {
  onLoadActions: () => Promise<CodeActionMenuLoadResult | null>;
  onExecuteAction: (action: CodePaneCodeAction) => Promise<CodeActionMenuExecuteResult>;
  t: ReturnType<typeof useI18n>['t'];
}>(function CodeActionMenuController({
  onLoadActions,
  onExecuteAction,
  t,
}, ref) {
  const [isOpen, setIsOpen] = useState(false);
  const [items, setItems] = useState<CodePaneCodeAction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const requestIdRef = useRef(0);
  const itemsRef = useRef<CodePaneCodeAction[]>([]);
  const selectedIndexRef = useRef(0);
  const isOpenRef = useRef(false);

  const close = useCallback(() => {
    requestIdRef.current += 1;
    if (!isOpenRef.current) {
      return false;
    }
    isOpenRef.current = false;
    setIsOpen((currentOpen) => (currentOpen ? false : currentOpen));
    setItems((currentItems) => (currentItems.length === 0 ? currentItems : []));
    setError((currentError) => (currentError === null ? currentError : null));
    setIsLoading((currentLoading) => (currentLoading ? false : currentLoading));
    setSelectedIndex((currentIndex) => (currentIndex === 0 ? currentIndex : 0));
    return true;
  }, []);

  const executeAction = useCallback((action: CodePaneCodeAction | undefined) => {
    if (!action || action.disabledReason) {
      return;
    }

    void onExecuteAction(action).then((result) => {
      if (result.close) {
        close();
        return;
      }
      if (result.error !== undefined) {
        setError((currentError) => (
          currentError === result.error ? currentError : result.error ?? null
        ));
      }
    });
  }, [close, onExecuteAction]);

  const open = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    isOpenRef.current = true;
    setIsOpen((currentOpen) => (currentOpen ? currentOpen : true));
    setItems((currentItems) => (currentItems.length === 0 ? currentItems : []));
    setError((currentError) => (currentError === null ? currentError : null));
    setIsLoading((currentLoading) => (currentLoading ? currentLoading : true));
    setSelectedIndex((currentIndex) => (currentIndex === 0 ? currentIndex : 0));

    const result = await onLoadActions();
    if (requestIdRef.current !== requestId) {
      return;
    }

    if (!result) {
      close();
      return;
    }

    startTransition(() => {
      setItems((currentItems) => (
        areCodeActionListsEqual(currentItems, result.items) ? currentItems : result.items
      ));
    });
    setError((currentError) => (
      currentError === result.error ? currentError : result.error
    ));
    setIsLoading((currentLoading) => (currentLoading ? false : currentLoading));
  }, [close, onLoadActions]);

  React.useImperativeHandle(ref, () => ({
    open,
    close,
    isOpen: () => isOpenRef.current,
  }), [close, open]);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    selectedIndexRef.current = selectedIndex;
  }, [selectedIndex]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSelectedIndex((currentIndex) => (
          itemsRef.current.length === 0
            ? 0
            : Math.min(currentIndex + 1, itemsRef.current.length - 1)
        ));
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSelectedIndex((currentIndex) => (
          itemsRef.current.length === 0
            ? 0
            : Math.max(currentIndex - 1, 0)
        ));
        return;
      }

      if (event.key === 'Enter') {
        const selectedAction = itemsRef.current[selectedIndexRef.current];
        if (selectedAction) {
          event.preventDefault();
          executeAction(selectedAction);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [executeAction, isOpen]);

  const handleClose = useCallback(() => {
    close();
  }, [close]);

  const handleHoverIndex = useCallback((index: number) => {
    setSelectedIndex(index);
  }, []);

  const handleExecuteAction = useCallback((action: CodePaneCodeAction) => {
    executeAction(action);
  }, [executeAction]);

  if (!isOpen) {
    return null;
  }

  return (
    <CodeActionMenuDialog
      items={items}
      selectedIndex={selectedIndex}
      error={error}
      isLoading={isLoading}
      onClose={handleClose}
      onHoverIndex={handleHoverIndex}
      onExecuteAction={handleExecuteAction}
      t={t}
    />
  );
}));

const BranchManagerControl = React.memo(function BranchManagerControl({
  gitBranches,
  gitBranchesError,
  gitSummaryBranchLabel,
  isGitBranchesLoading,
  isMac,
  canPushBranch,
  contextMenuContentClassName,
  contextMenuDangerItemClassName,
  contextMenuItemClassName,
  onRefresh,
  onOpenWorkbench,
  onUpdateProject,
  onOpenCommit,
  onPushCurrentBranch,
  onCreateBranch,
  onCheckoutRevision,
  onCheckoutBranch,
  onRenameBranch,
  onDeleteBranch,
  preventFocus,
  t,
}: {
  gitBranches: CodePaneGitBranchEntry[];
  gitBranchesError: string | null;
  gitSummaryBranchLabel: string | null;
  isGitBranchesLoading: boolean;
  isMac: boolean;
  canPushBranch: boolean;
  contextMenuContentClassName: string;
  contextMenuDangerItemClassName: string;
  contextMenuItemClassName: string;
  onRefresh: () => void;
  onOpenWorkbench: () => void;
  onUpdateProject: () => void;
  onOpenCommit: () => void;
  onPushCurrentBranch: () => void;
  onCreateBranch: () => void;
  onCheckoutRevision: () => void;
  onCheckoutBranch: (branch: CodePaneGitBranchEntry) => void;
  onRenameBranch: (branch: CodePaneGitBranchEntry) => void;
  onDeleteBranch: (branch: CodePaneGitBranchEntry) => void;
  preventFocus: (event: React.MouseEvent<HTMLElement>) => void;
  t: ReturnType<typeof useI18n>['t'];
}) {
  const branchManagerRef = useRef<HTMLDivElement | null>(null);
  const branchManagerSearchInputRef = useRef<HTMLInputElement | null>(null);
  const branchManagerTreeFilterCacheRef = useRef<WeakMap<BranchManagerTreeNode[], Map<string, BranchManagerTreeFilterResult>>>(new WeakMap());
  const branchManagerTreeRowsCacheRef = useRef<WeakMap<BranchManagerTreeNode[], Map<string, BranchManagerVisibleTreeRow[]>>>(new WeakMap());
  const [isBranchManagerOpen, setIsBranchManagerOpen] = useState(false);
  const [branchManagerQuery, setBranchManagerQuery] = useState('');
  const deferredBranchManagerQuery = useDeferredValue(branchManagerQuery);
  const [collapsedBranchManagerNodeKeys, setCollapsedBranchManagerNodeKeys] = useState<Set<string>>(() => new Set());
  const branchMenuContainer = branchManagerRef.current;

  const branchManagerBranchBuckets = useMemo<BranchManagerBranchBuckets>(() => {
    if (!isBranchManagerOpen) {
      return {
        local: [],
        remote: [],
        recent: [],
      };
    }

    const local: CodePaneGitBranchEntry[] = [];
    const remote: CodePaneGitBranchEntry[] = [];
    const recent = [...gitBranches];

    for (const branch of gitBranches) {
      if (branch.kind === 'local') {
        local.push(branch);
      } else if (branch.kind === 'remote') {
        remote.push(branch);
      }
    }

    recent.sort((leftBranch, rightBranch) => {
      if (leftBranch.current !== rightBranch.current) {
        return leftBranch.current ? -1 : 1;
      }
      return rightBranch.timestamp - leftBranch.timestamp;
    });
    if (recent.length > 8) {
      recent.length = 8;
    }

    return {
      local,
      remote,
      recent,
    };
  }, [gitBranches, isBranchManagerOpen]);

  const branchManagerBaseSections = useMemo<BranchManagerSection[]>(() => {
    if (!isBranchManagerOpen) {
      return [];
    }
    const { local, remote, recent } = branchManagerBranchBuckets;

    return [
      {
        key: 'recent',
        label: t('codePane.gitRecentBranches'),
        count: recent.length,
        nodes: buildBranchManagerTree(recent, 'recent', (branch) => splitGitBranchPath(branch.shortName || branch.name)),
      },
      {
        key: 'local',
        label: t('codePane.gitLocalBranches'),
        count: local.length,
        nodes: buildBranchManagerTree(local, 'local', (branch) => splitGitBranchPath(branch.shortName || branch.name)),
      },
      {
        key: 'remote',
        label: t('codePane.gitRemoteBranches'),
        count: remote.length,
        nodes: buildBranchManagerTree(remote, 'remote', (branch) => splitGitBranchPath(branch.shortName || branch.name)),
      },
    ];
  }, [branchManagerBranchBuckets, isBranchManagerOpen, t]);

  const branchManagerVisibleSections = useMemo<BranchManagerVisibleSection[]>(() => {
    if (!isBranchManagerOpen) {
      return [];
    }

    const normalizedQuery = deferredBranchManagerQuery.trim().toLowerCase();
    const collapsedNodeKeySignature = getBranchManagerCollapsedNodeKeySignature(collapsedBranchManagerNodeKeys);
    if (!normalizedQuery) {
      const nextSections: BranchManagerVisibleSection[] = [];
      for (const section of branchManagerBaseSections) {
        nextSections.push({
          ...section,
          rows: getCachedFlattenBranchManagerTreeRows(
            branchManagerTreeRowsCacheRef.current,
            section.nodes,
            collapsedBranchManagerNodeKeys,
            collapsedNodeKeySignature,
          ),
        });
      }
      return nextSections;
    }

    const nextSections: BranchManagerVisibleSection[] = [];
    for (const section of branchManagerBaseSections) {
      const filteredSection = getCachedFilteredBranchManagerTreeNodes(
        branchManagerTreeFilterCacheRef.current,
        section.nodes,
        normalizedQuery,
      );
      if (filteredSection.count === 0) {
        continue;
      }

      nextSections.push({
        ...section,
        count: filteredSection.count,
        nodes: filteredSection.nodes,
        rows: getCachedFlattenBranchManagerTreeRows(
          branchManagerTreeRowsCacheRef.current,
          filteredSection.nodes,
          collapsedBranchManagerNodeKeys,
          collapsedNodeKeySignature,
        ),
      });
    }
    return nextSections;
  }, [branchManagerBaseSections, collapsedBranchManagerNodeKeys, deferredBranchManagerQuery, isBranchManagerOpen]);

  const branchManagerQuickActions = useMemo<BranchManagerQuickAction[]>(() => {
    if (!isBranchManagerOpen) {
      return [];
    }

    const actions: BranchManagerQuickAction[] = [
      {
        id: 'update-project',
        label: t('codePane.gitUpdateProject'),
        shortcut: '',
        icon: RefreshCw,
        disabled: false,
        onSelect: onUpdateProject,
      },
      {
        id: 'commit',
        label: t('codePane.gitCommitDots'),
        shortcut: '',
        icon: GitCommitHorizontal,
        disabled: false,
        onSelect: onOpenCommit,
      },
      {
        id: 'push',
        label: t('codePane.gitPushDots'),
        shortcut: isMac ? '⌘⇧K' : 'Ctrl+Shift+K',
        icon: GitBranch,
        disabled: !canPushBranch,
        onSelect: onPushCurrentBranch,
      },
      {
        id: 'new-branch',
        label: t('codePane.gitNewBranchDots'),
        shortcut: isMac ? '⌘⌥N' : 'Ctrl+Alt+N',
        icon: Plus,
        disabled: false,
        onSelect: onCreateBranch,
      },
      {
        id: 'checkout-revision',
        label: t('codePane.gitCheckoutTagOrRevision'),
        shortcut: '',
        icon: GitCompareArrows,
        disabled: false,
        onSelect: onCheckoutRevision,
      },
    ];

    const query = deferredBranchManagerQuery.trim().toLowerCase();
    if (!query) {
      return actions;
    }

    const filteredActions: BranchManagerQuickAction[] = [];
    for (const action of actions) {
      if (
        action.label.toLowerCase().includes(query)
        || action.id.toLowerCase().includes(query)
      ) {
        filteredActions.push(action);
      }
    }
    return filteredActions;
  }, [
    canPushBranch,
    deferredBranchManagerQuery,
    isBranchManagerOpen,
    isMac,
    onCheckoutRevision,
    onCreateBranch,
    onOpenCommit,
    onPushCurrentBranch,
    onUpdateProject,
    t,
  ]);

  const closeBranchManager = useCallback(() => {
    setIsBranchManagerOpen((currentOpen) => (currentOpen ? false : currentOpen));
  }, []);

  const handleBranchManagerToggle = useCallback(() => {
    setIsBranchManagerOpen((currentOpen) => {
      const nextOpen = !currentOpen;
      setBranchManagerQuery((currentQuery) => (currentQuery === '' ? currentQuery : ''));
      if (nextOpen && !isGitBranchesLoading) {
        onRefresh();
      }
      return nextOpen;
    });
  }, [isGitBranchesLoading, onRefresh]);

  const handleBranchManagerQueryChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setBranchManagerQuery(event.target.value);
  }, []);

  const handleBranchManagerToggleNode = useCallback((nodeKey: string) => {
    setCollapsedBranchManagerNodeKeys((currentKeys) => {
      const nextKeys = new Set(currentKeys);
      if (nextKeys.has(nodeKey)) {
        nextKeys.delete(nodeKey);
      } else {
        nextKeys.add(nodeKey);
      }
      return nextKeys;
    });
  }, []);

  const handleBranchManagerRefresh = useCallback(() => {
    onRefresh();
  }, [onRefresh]);

  const handleBranchManagerOpenWorkbench = useCallback(() => {
    closeBranchManager();
    onOpenWorkbench();
  }, [closeBranchManager, onOpenWorkbench]);

  const handleQuickActionSelect = useCallback((action: BranchManagerQuickAction) => {
    closeBranchManager();
    action.onSelect();
  }, [closeBranchManager]);

  const handleBranchCheckout = useCallback((branch: CodePaneGitBranchEntry) => {
    closeBranchManager();
    onCheckoutBranch(branch);
  }, [closeBranchManager, onCheckoutBranch]);

  const handleBranchRename = useCallback((branch: CodePaneGitBranchEntry) => {
    closeBranchManager();
    onRenameBranch(branch);
  }, [closeBranchManager, onRenameBranch]);

  const handleBranchDelete = useCallback((branch: CodePaneGitBranchEntry) => {
    closeBranchManager();
    onDeleteBranch(branch);
  }, [closeBranchManager, onDeleteBranch]);

  useEffect(() => {
    if (!isBranchManagerOpen) {
      return;
    }

    const timer = window.setTimeout(() => {
      branchManagerSearchInputRef.current?.focus();
      branchManagerSearchInputRef.current?.select();
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [isBranchManagerOpen]);

  useEffect(() => {
    if (!isBranchManagerOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (!branchManagerRef.current?.contains(target)) {
        setIsBranchManagerOpen((currentOpen) => (currentOpen ? false : currentOpen));
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsBranchManagerOpen((currentOpen) => (currentOpen ? false : currentOpen));
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isBranchManagerOpen]);

  return (
    <div ref={branchManagerRef} className="relative">
      <button
        type="button"
        tabIndex={-1}
        aria-label={t('codePane.gitBranchManager')}
        aria-expanded={isBranchManagerOpen}
        onMouseDown={preventFocus}
        onClick={handleBranchManagerToggle}
        className={`flex h-6 max-w-[280px] items-center gap-1 rounded border px-2 text-xs font-medium transition-colors ${
          isBranchManagerOpen
            ? 'border-[rgb(var(--primary))]/45 bg-[rgb(var(--primary))]/10 text-[rgb(var(--foreground))]'
            : 'border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--secondary))_76%,transparent)] text-[rgb(var(--foreground))] hover:border-[rgb(var(--ring))] hover:bg-[rgb(var(--accent))]'
        }`}
      >
        <GitBranch
          size={12}
          className={`shrink-0 ${isBranchManagerOpen ? 'text-[rgb(var(--primary))]' : 'text-[rgb(var(--muted-foreground))]'}`}
        />
        <span className="truncate">{gitSummaryBranchLabel ?? t('codePane.gitDetachedHead')}</span>
        <ChevronDown size={12} className="shrink-0 text-[rgb(var(--muted-foreground))]" />
      </button>
      {isBranchManagerOpen && (
        <BranchManagerPopup
          searchInputRef={branchManagerSearchInputRef}
          query={branchManagerQuery}
          quickActions={branchManagerQuickActions.map((action) => ({
            ...action,
            onSelect: () => {
              handleQuickActionSelect(action);
            },
          }))}
          sections={branchManagerVisibleSections}
          collapsedNodeKeys={collapsedBranchManagerNodeKeys}
          gitBranchesCount={gitBranches.length}
          error={gitBranchesError}
          isLoading={isGitBranchesLoading}
          menuContainer={branchMenuContainer}
          contextMenuContentClassName={contextMenuContentClassName}
          contextMenuItemClassName={contextMenuItemClassName}
          contextMenuDangerItemClassName={contextMenuDangerItemClassName}
          onQueryChange={handleBranchManagerQueryChange}
          onRefresh={handleBranchManagerRefresh}
          onOpenWorkbench={handleBranchManagerOpenWorkbench}
          onToggleNode={handleBranchManagerToggleNode}
          onCheckoutBranch={handleBranchCheckout}
          onRenameBranch={handleBranchRename}
          onDeleteBranch={handleBranchDelete}
          t={t}
        />
      )}
    </div>
  );
});

const CodePaneWorkspaceHeader = React.memo(function CodePaneWorkspaceHeader({
  branchManagerControl,
  navigationStore,
  contextMenuContentClassName,
  contextMenuDangerItemClassName,
  contextMenuItemClassName,
  editorActionMenuSections,
  gitOperationLabel,
  gitRepositorySummary,
  isRefreshing,
  activeFilePath,
  onClose,
  onNavigateBack,
  onNavigateForward,
  onOpenSearchEverywhere,
  onWorkspaceRefresh,
  onToggleActiveDiffView,
  onSaveActiveFile,
  onPaneClose,
  preventFocus,
  t,
  viewMode,
}: {
  branchManagerControl: React.ReactNode;
  navigationStore: CodePaneNavigationStore;
  contextMenuContentClassName: string;
  contextMenuDangerItemClassName: string;
  contextMenuItemClassName: string;
  editorActionMenuSections: EditorActionMenuItem[][];
  gitOperationLabel: string;
  gitRepositorySummary: CodePaneGitRepositorySummary | null;
  isRefreshing: boolean;
  activeFilePath: string | null;
  onClose?: () => void;
  onNavigateBack: () => void;
  onNavigateForward: () => void;
  onOpenSearchEverywhere: () => void;
  onWorkspaceRefresh: () => void;
  onToggleActiveDiffView: () => void;
  onSaveActiveFile: () => void;
  onPaneClose: () => void | Promise<void>;
  preventFocus: (event: React.MouseEvent<HTMLElement>) => void;
  t: ReturnType<typeof useI18n>['t'];
  viewMode: string;
}) {
  const navigationSnapshot = useCodePaneNavigationSnapshot(navigationStore);
  const canNavigateBack = navigationSnapshot.canNavigateBack;
  const canNavigateForward = navigationSnapshot.canNavigateForward;
  const diffButtonLabel = viewMode === 'diff' ? t('codePane.showEditor') : t('codePane.showDiff');

  return (
    <div className="flex items-center justify-between gap-2 border-b border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--secondary))_76%,transparent)] px-2 py-1">
      <div className="flex min-w-0 items-center gap-2">
        {branchManagerControl}
        {gitRepositorySummary && gitRepositorySummary.operation !== 'idle' && (
          <span className="rounded bg-[rgb(var(--warning))/0.14] px-1.5 py-0.5 text-[10px] text-[rgb(var(--warning))]">
            {gitOperationLabel}
          </span>
        )}
        {gitRepositorySummary?.hasConflicts && (
          <span className="rounded bg-[rgb(var(--error))/0.14] px-1.5 py-0.5 text-[10px] text-[rgb(var(--error))]">
            {t('codePane.gitConflictsActive')}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1">
        <AppTooltip content={t('codePane.navigateBack')} placement="pane-corner">
          <button
            type="button"
            tabIndex={-1}
            aria-label={t('codePane.navigateBack')}
            onMouseDown={preventFocus}
            onClick={onNavigateBack}
            disabled={!canNavigateBack}
            className="flex h-6 w-6 items-center justify-center rounded bg-[rgb(var(--secondary))] text-[rgb(var(--foreground))] hover:bg-[rgb(var(--accent))] hover:text-[rgb(var(--foreground))] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronLeft size={13} />
          </button>
        </AppTooltip>
        <AppTooltip content={t('codePane.navigateForward')} placement="pane-corner">
          <button
            type="button"
            tabIndex={-1}
            aria-label={t('codePane.navigateForward')}
            onMouseDown={preventFocus}
            onClick={onNavigateForward}
            disabled={!canNavigateForward}
            className="flex h-6 w-6 items-center justify-center rounded bg-[rgb(var(--secondary))] text-[rgb(var(--foreground))] hover:bg-[rgb(var(--accent))] hover:text-[rgb(var(--foreground))] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronRight size={13} />
          </button>
        </AppTooltip>
        <AppTooltip content={t('codePane.searchEverywhereOpen')} placement="pane-corner">
          <button
            type="button"
            tabIndex={-1}
            aria-label={t('codePane.searchEverywhereOpen')}
            onMouseDown={preventFocus}
            onClick={onOpenSearchEverywhere}
            className="flex h-6 w-6 items-center justify-center rounded bg-[rgb(var(--secondary))] text-[rgb(var(--foreground))] hover:bg-[rgb(var(--accent))] hover:text-[rgb(var(--foreground))]"
          >
            <Search size={13} />
          </button>
        </AppTooltip>
        <AppTooltip content={t('codePane.refresh')} placement="pane-corner">
          <button
            type="button"
            tabIndex={-1}
            aria-label={t('codePane.refresh')}
            onMouseDown={preventFocus}
            onClick={onWorkspaceRefresh}
            className="flex h-6 w-6 items-center justify-center rounded bg-[rgb(var(--secondary))] text-[rgb(var(--foreground))] hover:bg-[rgb(var(--accent))] hover:text-[rgb(var(--foreground))]"
          >
            <RefreshCw size={13} className={isRefreshing ? 'animate-spin' : ''} />
          </button>
        </AppTooltip>
        <AppTooltip content={diffButtonLabel} placement="pane-corner">
          <button
            type="button"
            tabIndex={-1}
            aria-label={diffButtonLabel}
            onMouseDown={preventFocus}
            onClick={onToggleActiveDiffView}
            disabled={!activeFilePath}
            className="flex h-6 w-6 items-center justify-center rounded bg-[rgb(var(--secondary))] text-[rgb(var(--foreground))] transition-colors hover:bg-[rgb(var(--accent))] hover:text-[rgb(var(--foreground))] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <GitCompareArrows size={13} />
          </button>
        </AppTooltip>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              tabIndex={-1}
              title={t('codePane.editorActionsMenu')}
              aria-label={t('codePane.editorActionsMenu')}
              onMouseDown={preventFocus}
              className="flex h-6 items-center justify-center rounded bg-[rgb(var(--secondary))] px-1.5 text-[10px] font-medium text-[rgb(var(--foreground))] transition-colors hover:bg-[rgb(var(--accent))] hover:text-[rgb(var(--foreground))]"
            >
              <MoreHorizontal size={13} className="mr-1" />
              {t('common.more')}
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className={contextMenuContentClassName}
              sideOffset={6}
              align="end"
            >
              {editorActionMenuSections.map((section, sectionIndex) => (
                <React.Fragment key={`editor-actions-${sectionIndex}`}>
                  {section.map((item) => (
                    <EditorActionMenuItemRow
                      key={item.id}
                      item={item}
                      className={contextMenuItemClassName}
                    />
                  ))}
                  {sectionIndex < editorActionMenuSections.length - 1 && (
                    <DropdownMenu.Separator className={ideMenuSeparatorClassName} />
                  )}
                </React.Fragment>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        <AppTooltip content={t('common.save')} placement="pane-corner">
          <button
            type="button"
            tabIndex={-1}
            aria-label={t('common.save')}
            onMouseDown={preventFocus}
            onClick={onSaveActiveFile}
            disabled={!activeFilePath}
            className="flex h-6 w-6 items-center justify-center rounded bg-[rgb(var(--secondary))] text-[rgb(var(--foreground))] transition-colors hover:bg-[rgb(var(--accent))] hover:text-[rgb(var(--foreground))] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Save size={13} />
          </button>
        </AppTooltip>
        {onClose && (
          <AppTooltip content={t('terminalPane.close')} placement="pane-corner">
            <button
              type="button"
              tabIndex={-1}
              aria-label={t('terminalPane.close')}
              onMouseDown={preventFocus}
              onClick={(event) => {
                event.stopPropagation();
                void onPaneClose();
              }}
              className="flex h-6 w-6 items-center justify-center rounded bg-[rgb(var(--secondary))] text-[rgb(var(--muted-foreground))] hover:bg-[rgb(var(--error))] hover:text-[rgb(var(--foreground))]"
            >
              <X size={13} />
            </button>
          </AppTooltip>
        )}
      </div>
    </div>
  );
});

const FilesSidebarContent = React.memo(function FilesSidebarContent({
  scrollRef,
  body,
  onLocateActiveFile,
  onExpandSelection,
  onCollapseAll,
  canLocateActiveFile,
  canExpandSelection,
  canCollapseAll,
  t,
}: {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  body: (viewport: FileTreeViewport, searchState: FilesSidebarSearchState) => React.ReactNode;
  onLocateActiveFile: () => void;
  onExpandSelection: () => void;
  onCollapseAll: () => void;
  canLocateActiveFile: boolean;
  canExpandSelection: boolean;
  canCollapseAll: boolean;
  t: ReturnType<typeof useI18n>['t'];
}) {
  const [viewport, setViewport] = React.useState<FileTreeViewport>({
    scrollTop: 0,
    viewportHeight: 0,
  });
  const viewportRef = React.useRef(viewport);
  const pendingViewportRef = React.useRef<FileTreeViewport | null>(null);
  const viewportAnimationFrameRef = React.useRef<number | null>(null);

  const updateViewport = React.useCallback((nextViewport: FileTreeViewport) => {
    const nextNormalizedViewport = {
      scrollTop: Math.max(0, Math.floor(nextViewport.scrollTop / CODE_PANE_EXPLORER_ROW_HEIGHT) * CODE_PANE_EXPLORER_ROW_HEIGHT),
      viewportHeight: Math.max(0, Math.ceil(nextViewport.viewportHeight)),
    };
    const currentViewport = viewportRef.current;
    if (
      currentViewport.scrollTop === nextNormalizedViewport.scrollTop
      && currentViewport.viewportHeight === nextNormalizedViewport.viewportHeight
    ) {
      return;
    }

    viewportRef.current = nextNormalizedViewport;
    setViewport((currentViewport) => (
      currentViewport.scrollTop === nextNormalizedViewport.scrollTop
      && currentViewport.viewportHeight === nextNormalizedViewport.viewportHeight
        ? currentViewport
        : nextNormalizedViewport
    ));
  }, []);

  const scheduleViewportUpdate = React.useCallback((nextViewport: FileTreeViewport) => {
    pendingViewportRef.current = nextViewport;
    if (viewportAnimationFrameRef.current !== null) {
      return;
    }

    viewportAnimationFrameRef.current = window.requestAnimationFrame(() => {
      viewportAnimationFrameRef.current = null;
      const pendingViewport = pendingViewportRef.current;
      pendingViewportRef.current = null;
      if (pendingViewport) {
        updateViewport(pendingViewport);
      }
    });
  }, [updateViewport]);

  React.useEffect(() => {
    const container = scrollRef.current;
    if (!container) {
      return;
    }

    const syncViewport = () => {
      updateViewport({
        scrollTop: container.scrollTop,
        viewportHeight: container.clientHeight,
      });
    };

    syncViewport();

    const resizeObserver = new ResizeObserver(() => {
      syncViewport();
    });
    resizeObserver.observe(container);
    return () => {
      if (viewportAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(viewportAnimationFrameRef.current);
        viewportAnimationFrameRef.current = null;
      }
      resizeObserver.disconnect();
    };
  }, [scrollRef, updateViewport]);

  const searchState = React.useMemo<FilesSidebarSearchState>(() => ({
    trimmedQuery: '',
    results: [],
    isSearching: false,
    error: null,
  }), []);

  return (
    <>
      <div className="border-b border-[rgb(var(--border))] px-2 py-2">
        <div className="flex items-center justify-end gap-1">
          <AppTooltip content={t('codePane.locateActiveFileInExplorer')} placement="pane-corner">
            <button
              type="button"
              aria-label={t('codePane.locateActiveFileInExplorer')}
              disabled={!canLocateActiveFile}
              onClick={onLocateActiveFile}
              className="flex h-7 w-7 items-center justify-center rounded text-[rgb(var(--muted-foreground))] transition-colors hover:bg-[rgb(var(--accent))] hover:text-[rgb(var(--foreground))] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <LocateFixed size={14} />
            </button>
          </AppTooltip>
          <AppTooltip content={t('codePane.expandSelectedInExplorer')} placement="pane-corner">
            <button
              type="button"
              aria-label={t('codePane.expandSelectedInExplorer')}
              disabled={!canExpandSelection}
              onClick={onExpandSelection}
              className="flex h-7 w-7 items-center justify-center rounded text-[rgb(var(--muted-foreground))] transition-colors hover:bg-[rgb(var(--accent))] hover:text-[rgb(var(--foreground))] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronsUpDown size={14} />
            </button>
          </AppTooltip>
          <AppTooltip content={t('codePane.collapseAllInExplorer')} placement="pane-corner">
            <button
              type="button"
              aria-label={t('codePane.collapseAllInExplorer')}
              disabled={!canCollapseAll}
              onClick={onCollapseAll}
              className="flex h-7 w-7 items-center justify-center rounded text-[rgb(var(--muted-foreground))] transition-colors hover:bg-[rgb(var(--accent))] hover:text-[rgb(var(--foreground))] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronsDownUp size={14} />
            </button>
          </AppTooltip>
        </div>
      </div>
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-auto px-1 py-2"
        onScroll={(event) => {
          scheduleViewportUpdate({
            scrollTop: event.currentTarget.scrollTop,
            viewportHeight: event.currentTarget.clientHeight,
          });
        }}
      >
        {body(viewport, searchState)}
      </div>
    </>
  );
});

const SearchSidebarContent = React.memo(function SearchSidebarContent({
  mode,
  initialState,
  usageGroups,
  usageError,
  usagesTargetLabel,
  isFindingUsages,
  rootPath,
  onFindUsages,
  onModeChange,
  onSearchContents,
  onSearchWorkspaceSymbols,
  onPersistState,
  onActivateFile,
  onOpenContentMatch,
  onOpenFileLocation,
  t,
}: {
  mode: SearchPanelMode;
  initialState: SearchSidebarPersistedState;
  usageGroups: UsageSearchGroup[];
  usageError: string | null;
  usagesTargetLabel: string | null;
  isFindingUsages: boolean;
  rootPath: string;
  onFindUsages: () => void;
  onModeChange: (mode: SearchPanelMode) => void;
  onSearchContents: (trimmedQuery: string) => Promise<{
    results: CodePaneContentMatch[];
    error: string | null;
  }>;
  onSearchWorkspaceSymbols: (trimmedQuery: string) => Promise<{
    results: CodePaneWorkspaceSymbol[];
    error: string | null;
  }>;
  onPersistState: (state: SearchSidebarPersistedState) => void;
  onActivateFile: (filePath: string, options?: { preview?: boolean; promotePreview?: boolean }) => void | Promise<void>;
  onOpenContentMatch: (match: CodePaneContentMatch) => void | Promise<void>;
  onOpenFileLocation: (location: FileNavigationLocation) => void | Promise<void>;
  t: ReturnType<typeof useI18n>['t'];
}) {
  const resultsScrollRef = React.useRef<HTMLDivElement | null>(null);
  const [resultsScrollTop, setResultsScrollTop] = React.useState(0);
  const [resultsViewportHeight, setResultsViewportHeight] = React.useState(0);
  const pendingResultsScrollTopRef = React.useRef<number | null>(null);
  const resultsScrollAnimationFrameRef = React.useRef<number | null>(null);
  const [contentQuery, setContentQuery] = React.useState(initialState.contentQuery);
  const deferredContentQuery = useDeferredValue(contentQuery);
  const [contentResults, setContentResults] = React.useState<CodePaneContentMatch[]>(initialState.contentResults);
  const [contentError, setContentError] = React.useState<string | null>(initialState.contentError);
  const [isContentSearching, setIsContentSearching] = React.useState(false);
  const [workspaceSymbolQuery, setWorkspaceSymbolQuery] = React.useState(initialState.workspaceSymbolQuery);
  const deferredWorkspaceSymbolQuery = useDeferredValue(workspaceSymbolQuery);
  const [workspaceSymbolResults, setWorkspaceSymbolResults] = React.useState<CodePaneWorkspaceSymbol[]>(initialState.workspaceSymbolResults);
  const [workspaceSymbolError, setWorkspaceSymbolError] = React.useState<string | null>(initialState.workspaceSymbolError);
  const [isWorkspaceSymbolSearching, setIsWorkspaceSymbolSearching] = React.useState(false);
  const contentSearchRequestIdRef = React.useRef(0);
  const workspaceSymbolSearchRequestIdRef = React.useRef(0);
  const contentGroups = React.useMemo(() => {
    const groups = new Map<string, CodePaneContentMatch[]>();
    for (const match of contentResults) {
      const matches = groups.get(match.filePath) ?? [];
      matches.push(match);
      groups.set(match.filePath, matches);
    }

    const nextGroups: ContentSearchGroup[] = [];
    for (const [filePath, matches] of groups.entries()) {
      nextGroups.push({ filePath, matches });
    }
    return nextGroups;
  }, [contentResults]);
  const contentRows = React.useMemo<SearchSidebarContentRow[]>(() => {
    const nextRows: SearchSidebarContentRow[] = [];
    for (const group of contentGroups) {
      nextRows.push({
        kind: 'content-file',
        key: `file:${group.filePath}`,
        filePath: group.filePath,
      });
      for (const match of group.matches) {
        nextRows.push({
          kind: 'content-match',
          key: `match:${group.filePath}:${match.lineNumber}:${match.column}`,
          match,
        });
      }
    }
    return nextRows;
  }, [contentGroups]);
  const workspaceSymbolRows = React.useMemo<SearchSidebarSymbolRow[]>(() => (
    workspaceSymbolResults.map((symbol) => ({
      key: `${symbol.filePath}:${symbol.name}:${symbol.range.startLineNumber}:${symbol.range.startColumn}`,
      symbol,
    }))
  ), [workspaceSymbolResults]);
  const usageRows = React.useMemo<SearchSidebarUsageRow[]>(() => {
    const nextRows: SearchSidebarUsageRow[] = [];
    for (const group of usageGroups) {
      nextRows.push({
        kind: 'usage-file',
        key: `file:${group.filePath}`,
        group,
      });
      for (const reference of group.references) {
        nextRows.push({
          kind: 'usage-reference',
          key: `reference:${group.filePath}:${reference.range.startLineNumber}:${reference.range.startColumn}`,
          filePath: group.filePath,
          reference,
        });
      }
    }
    return nextRows;
  }, [usageGroups]);
  const activeSearchRows: SearchSidebarRow[] = mode === 'contents'
    ? contentRows
    : mode === 'symbols'
      ? workspaceSymbolRows
      : usageRows;
  const visibleSearchRows = React.useMemo(() => getWindowedListSlice({
    items: activeSearchRows,
    scrollTop: resultsScrollTop,
    viewportHeight: resultsViewportHeight,
    rowHeight: CODE_PANE_SEARCH_PANEL_ROW_HEIGHT,
    overscan: CODE_PANE_SEARCH_PANEL_ROW_OVERSCAN,
    threshold: CODE_PANE_SEARCH_PANEL_WINDOWING_THRESHOLD,
  }), [activeSearchRows, resultsScrollTop, resultsViewportHeight]);
  const headingLabel = mode === 'contents'
    ? t('codePane.searchContents')
    : mode === 'symbols'
      ? t('codePane.workspaceSymbols')
      : t('codePane.findUsages');
  const resultsLabel = mode === 'contents'
    ? t('codePane.searchTab')
    : mode === 'symbols'
      ? t('codePane.workspaceSymbols')
      : t('codePane.findUsages');
  const hasDeferredContentQuery = Boolean(deferredContentQuery.trim());
  const hasDeferredWorkspaceSymbolQuery = Boolean(deferredWorkspaceSymbolQuery.trim());

  const scheduleResultsScrollTopUpdate = React.useCallback((nextScrollTop: number) => {
    pendingResultsScrollTopRef.current = nextScrollTop;
    if (resultsScrollAnimationFrameRef.current !== null) {
      return;
    }

    resultsScrollAnimationFrameRef.current = window.requestAnimationFrame(() => {
      resultsScrollAnimationFrameRef.current = null;
      const pendingScrollTop = pendingResultsScrollTopRef.current;
      pendingResultsScrollTopRef.current = null;
      if (pendingScrollTop !== null) {
        setResultsScrollTop((currentScrollTop) => (
          currentScrollTop === pendingScrollTop ? currentScrollTop : pendingScrollTop
        ));
      }
    });
  }, []);

  React.useEffect(() => {
    const container = resultsScrollRef.current;
    if (!container) {
      return;
    }

    const syncViewport = () => {
      setResultsViewportHeight(container.clientHeight);
      setResultsScrollTop(container.scrollTop);
    };

    syncViewport();

    const resizeObserver = new ResizeObserver(() => {
      syncViewport();
    });
    resizeObserver.observe(container);
    return () => {
      if (resultsScrollAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(resultsScrollAnimationFrameRef.current);
        resultsScrollAnimationFrameRef.current = null;
      }
      resizeObserver.disconnect();
    };
  }, []);

  React.useEffect(() => {
    const container = resultsScrollRef.current;
    if (!container) {
      return;
    }

    container.scrollTop = 0;
    setResultsScrollTop((currentScrollTop) => (currentScrollTop === 0 ? currentScrollTop : 0));
  }, [mode]);

  React.useEffect(() => {
    onPersistState({
      contentQuery,
      contentResults,
      contentError,
      workspaceSymbolQuery,
      workspaceSymbolResults,
      workspaceSymbolError,
    });
  }, [
    contentError,
    contentQuery,
    contentResults,
    onPersistState,
    workspaceSymbolError,
    workspaceSymbolQuery,
    workspaceSymbolResults,
  ]);

  React.useEffect(() => {
    if (mode !== 'contents') {
      return undefined;
    }

    const trimmedQuery = deferredContentQuery.trim();
    if (!trimmedQuery) {
      contentSearchRequestIdRef.current += 1;
      setContentResults((currentResults) => (currentResults.length === 0 ? currentResults : []));
      setIsContentSearching((currentSearching) => (currentSearching ? false : currentSearching));
      setContentError((currentError) => (currentError === null ? currentError : null));
      return undefined;
    }

    const requestId = contentSearchRequestIdRef.current + 1;
    contentSearchRequestIdRef.current = requestId;
    setIsContentSearching((currentSearching) => (currentSearching ? currentSearching : true));
    setContentError((currentError) => (currentError === null ? currentError : null));

    const timer = window.setTimeout(() => {
      void onSearchContents(trimmedQuery).then((result) => {
        if (contentSearchRequestIdRef.current !== requestId) {
          return;
        }

        startTransition(() => {
          setContentResults((currentResults) => (
            areContentMatchListsEqual(currentResults, result.results) ? currentResults : result.results
          ));
        });
        setContentError((currentError) => (
          currentError === result.error ? currentError : result.error
        ));
        setIsContentSearching((currentSearching) => (
          currentSearching ? false : currentSearching
        ));
      });
    }, 220);

    return () => {
      window.clearTimeout(timer);
    };
  }, [deferredContentQuery, mode, onSearchContents]);

  React.useEffect(() => {
    if (mode !== 'symbols') {
      return undefined;
    }

    const trimmedQuery = deferredWorkspaceSymbolQuery.trim();
    if (!trimmedQuery) {
      workspaceSymbolSearchRequestIdRef.current += 1;
      setWorkspaceSymbolResults((currentResults) => (currentResults.length === 0 ? currentResults : []));
      setIsWorkspaceSymbolSearching((currentSearching) => (currentSearching ? false : currentSearching));
      setWorkspaceSymbolError((currentError) => (currentError === null ? currentError : null));
      return undefined;
    }

    const requestId = workspaceSymbolSearchRequestIdRef.current + 1;
    workspaceSymbolSearchRequestIdRef.current = requestId;
    setIsWorkspaceSymbolSearching((currentSearching) => (currentSearching ? currentSearching : true));
    setWorkspaceSymbolError((currentError) => (currentError === null ? currentError : null));

    const timer = window.setTimeout(() => {
      void onSearchWorkspaceSymbols(trimmedQuery).then((result) => {
        if (workspaceSymbolSearchRequestIdRef.current !== requestId) {
          return;
        }

        startTransition(() => {
          setWorkspaceSymbolResults((currentResults) => (
            areWorkspaceSymbolListsEqual(currentResults, result.results) ? currentResults : result.results
          ));
        });
        setWorkspaceSymbolError((currentError) => (
          currentError === result.error ? currentError : result.error
        ));
        setIsWorkspaceSymbolSearching((currentSearching) => (
          currentSearching ? false : currentSearching
        ));
      });
    }, 220);

    return () => {
      window.clearTimeout(timer);
    };
  }, [deferredWorkspaceSymbolQuery, mode, onSearchWorkspaceSymbols]);

  const handleContentQueryChange = React.useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const nextQuery = event.target.value;
    setContentQuery((currentQuery) => (
      currentQuery === nextQuery ? currentQuery : nextQuery
    ));
  }, []);

  const handleWorkspaceSymbolQueryChange = React.useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const nextQuery = event.target.value;
    setWorkspaceSymbolQuery((currentQuery) => (
      currentQuery === nextQuery ? currentQuery : nextQuery
    ));
  }, []);

  const renderContentRow = React.useCallback((row: SearchSidebarContentRow) => {
    if (row.kind === 'content-file') {
      return (
        <button
          key={row.key}
          type="button"
          onClick={() => {
            void onActivateFile(row.filePath, { preview: true });
          }}
          className="flex h-8 w-full items-center gap-2 rounded px-1 text-left text-xs text-[rgb(var(--foreground))] transition-colors hover:bg-[rgb(var(--accent))] hover:text-[rgb(var(--foreground))]"
        >
          <FileIcon size={13} className="shrink-0 text-[rgb(var(--muted-foreground))]" />
          <span className="min-w-0 flex-1 truncate">{getPathLeafLabel(row.filePath)}</span>
          <span className="truncate text-[10px] text-[rgb(var(--muted-foreground))]">
            {getRelativePath(rootPath, row.filePath)}
          </span>
        </button>
      );
    }

    const { match } = row;
    return (
      <button
        key={row.key}
        type="button"
        onClick={() => {
          void onOpenContentMatch(match);
        }}
        className="flex h-8 w-full items-center gap-2 rounded px-1 text-left text-xs text-[rgb(var(--muted-foreground))] transition-colors hover:bg-[rgb(var(--accent))] hover:text-[rgb(var(--foreground))]"
      >
        <span className="w-[44px] shrink-0 text-[10px] text-[rgb(var(--muted-foreground))]">
          {match.lineNumber}:{match.column}
        </span>
        <span className="min-w-0 flex-1 truncate">{match.lineText}</span>
      </button>
    );
  }, [onActivateFile, onOpenContentMatch, rootPath]);

  const renderSymbolRow = React.useCallback((row: SearchSidebarSymbolRow) => {
    const { symbol } = row;
    return (
      <button
        key={row.key}
        type="button"
        onClick={() => {
          void onOpenFileLocation({
            filePath: symbol.filePath,
            lineNumber: symbol.range.startLineNumber,
            column: symbol.range.startColumn,
          });
        }}
        className="flex h-8 w-full items-center gap-2 rounded px-1 text-left text-xs text-[rgb(var(--foreground))] transition-colors hover:bg-[rgb(var(--accent))] hover:text-[rgb(var(--foreground))]"
      >
        <FileCode2 size={13} className="shrink-0 text-[rgb(var(--muted-foreground))]" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[rgb(var(--foreground))]">{symbol.name}</div>
          <div className="truncate text-[10px] text-[rgb(var(--muted-foreground))]">
            {[symbol.containerName, getRelativePath(rootPath, symbol.filePath), `${symbol.range.startLineNumber}:${symbol.range.startColumn}`]
              .filter(Boolean)
              .join(' · ')}
          </div>
        </div>
      </button>
    );
  }, [onOpenFileLocation, rootPath]);

  const renderUsageRow = React.useCallback((row: SearchSidebarUsageRow) => {
    if (row.kind === 'usage-file') {
      return (
        <button
          key={row.key}
          type="button"
          onClick={() => {
            void onActivateFile(row.group.filePath, { preview: true });
          }}
          className="flex h-8 w-full items-center gap-2 rounded px-1 text-left text-xs text-[rgb(var(--foreground))] transition-colors hover:bg-[rgb(var(--accent))] hover:text-[rgb(var(--foreground))]"
        >
          <FileIcon size={13} className="shrink-0 text-[rgb(var(--muted-foreground))]" />
          <span className="min-w-0 flex-1 truncate">{getPathLeafLabel(row.group.filePath)}</span>
          <span className="truncate text-[10px] text-[rgb(var(--muted-foreground))]">
            {getRelativePath(rootPath, row.group.filePath)}
          </span>
        </button>
      );
    }

    const { reference } = row;
    return (
      <button
        key={row.key}
        type="button"
        onClick={() => {
          void onOpenFileLocation({
            filePath: row.filePath,
            lineNumber: reference.range.startLineNumber,
            column: reference.range.startColumn,
          });
        }}
        className="flex h-8 w-full items-center gap-2 rounded px-1 text-left text-xs text-[rgb(var(--muted-foreground))] transition-colors hover:bg-[rgb(var(--accent))] hover:text-[rgb(var(--foreground))]"
      >
        <span className="w-[44px] shrink-0 text-[10px] text-[rgb(var(--muted-foreground))]">
          {reference.range.startLineNumber}:{reference.range.startColumn}
        </span>
        <span className="min-w-0 flex-1 truncate">
          {reference.previewText ?? getRelativePath(rootPath, row.filePath)}
        </span>
      </button>
    );
  }, [onActivateFile, onOpenFileLocation, rootPath]);

  const renderWindowedRows = React.useCallback((children: React.ReactNode) => (
    visibleSearchRows.isWindowed ? (
      <div style={{ height: `${visibleSearchRows.totalHeight}px`, position: 'relative' }}>
        <div style={{ transform: `translateY(${visibleSearchRows.offsetTop}px)` }}>
          {children}
        </div>
      </div>
    ) : children
  ), [visibleSearchRows.isWindowed, visibleSearchRows.offsetTop, visibleSearchRows.totalHeight]);

  return (
    <>
      <div className="border-b border-[rgb(var(--border))] px-2 py-2">
        <div className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.12em] text-[rgb(var(--muted-foreground))]">
          <Search size={12} />
          {headingLabel}
        </div>
        <div className="mb-2 flex gap-1 rounded bg-[color-mix(in_srgb,rgb(var(--secondary))_58%,transparent)] p-1">
          {([
            ['contents', t('codePane.searchModeContents')],
            ['symbols', t('codePane.searchModeSymbols')],
            ['usages', t('codePane.searchModeUsages')],
          ] as const).map(([nextMode, label]) => (
            <button
              key={nextMode}
              type="button"
              onClick={() => {
                onModeChange(nextMode);
              }}
              className={`flex-1 rounded px-2 py-1 text-[11px] font-medium transition-colors ${
                mode === nextMode
                  ? 'bg-[rgb(var(--accent))] text-[rgb(var(--foreground))]'
                  : 'text-[rgb(var(--muted-foreground))] hover:bg-[rgb(var(--accent))] hover:text-[rgb(var(--foreground))]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {mode === 'contents' ? (
          <div className="flex items-center gap-2 rounded border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--secondary))_76%,transparent)] px-2 py-1.5">
            <Search size={12} className="shrink-0 text-[rgb(var(--muted-foreground))]" />
            <input
              value={contentQuery}
              onChange={handleContentQueryChange}
              placeholder={t('codePane.searchContentsPlaceholder')}
              className="w-full bg-transparent text-xs text-[rgb(var(--foreground))] outline-none placeholder:text-[rgb(var(--muted-foreground))]"
            />
            {isContentSearching && <Loader2 size={12} className="shrink-0 animate-spin text-[rgb(var(--muted-foreground))]" />}
          </div>
        ) : mode === 'symbols' ? (
          <div className="flex items-center gap-2 rounded border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--secondary))_76%,transparent)] px-2 py-1.5">
            <Search size={12} className="shrink-0 text-[rgb(var(--muted-foreground))]" />
            <input
              value={workspaceSymbolQuery}
              onChange={handleWorkspaceSymbolQueryChange}
              placeholder={t('codePane.workspaceSymbolsPlaceholder')}
              className="w-full bg-transparent text-xs text-[rgb(var(--foreground))] outline-none placeholder:text-[rgb(var(--muted-foreground))]"
            />
            {isWorkspaceSymbolSearching && <Loader2 size={12} className="shrink-0 animate-spin text-[rgb(var(--muted-foreground))]" />}
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2 rounded border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--secondary))_76%,transparent)] px-2 py-1.5 text-xs text-[rgb(var(--muted-foreground))]">
            <span className="truncate">
              {usagesTargetLabel
                ? t('codePane.findUsagesFor', { symbol: usagesTargetLabel })
                : t('codePane.findUsagesHint')}
            </span>
            <button
              type="button"
              onClick={onFindUsages}
              className="shrink-0 rounded border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--secondary))_74%,transparent)] px-2 py-1 text-[11px] text-[rgb(var(--foreground))] transition-colors hover:border-[rgb(var(--ring))] hover:bg-[rgb(var(--accent))] hover:text-[rgb(var(--foreground))]"
            >
              {t('codePane.findUsages')}
            </button>
          </div>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="border-b border-[rgb(var(--border))] px-2 py-2 text-[11px] font-medium uppercase tracking-[0.12em] text-[rgb(var(--muted-foreground))]">
          {resultsLabel}
        </div>
        <div
          ref={resultsScrollRef}
          className="min-h-0 flex-1 overflow-auto px-2 py-2"
          onScroll={(event) => {
            scheduleResultsScrollTopUpdate(event.currentTarget.scrollTop);
          }}
        >
          {mode === 'contents' ? (
            hasDeferredContentQuery && contentError ? (
              <div className="text-xs text-[rgb(var(--error))]">{contentError}</div>
            ) : hasDeferredContentQuery ? (
              contentRows.length > 0 ? (
                renderWindowedRows(
                  <div className="space-y-1">
                    {visibleSearchRows.items.map((row) => renderContentRow(row as SearchSidebarContentRow))}
                  </div>,
                )
              ) : (
                <div className="text-xs text-[rgb(var(--muted-foreground))]">{t('codePane.searchContentsEmpty')}</div>
              )
            ) : (
              <div className="text-xs text-[rgb(var(--muted-foreground))]">{t('codePane.searchContentsHint')}</div>
            )
          ) : mode === 'symbols' ? (
            hasDeferredWorkspaceSymbolQuery && workspaceSymbolError ? (
              <div className="text-xs text-[rgb(var(--error))]">{workspaceSymbolError}</div>
            ) : hasDeferredWorkspaceSymbolQuery ? (
              workspaceSymbolRows.length > 0 ? (
                renderWindowedRows(
                  <div className="space-y-1">
                    {visibleSearchRows.items.map((row) => renderSymbolRow(row as SearchSidebarSymbolRow))}
                  </div>,
                )
              ) : (
                <div className="text-xs text-[rgb(var(--muted-foreground))]">{t('codePane.workspaceSymbolsEmpty')}</div>
              )
            ) : (
              <div className="text-xs text-[rgb(var(--muted-foreground))]">{t('codePane.workspaceSymbolsHint')}</div>
            )
          ) : usageError ? (
            <div className="text-xs text-[rgb(var(--error))]">{usageError}</div>
          ) : isFindingUsages ? (
            <div className="flex items-center gap-2 text-xs text-[rgb(var(--muted-foreground))]">
              <Loader2 size={12} className="animate-spin" />
              {t('codePane.findUsages')}
            </div>
          ) : usagesTargetLabel ? (
            usageRows.length > 0 ? (
              renderWindowedRows(
                <div className="space-y-1">
                  {visibleSearchRows.items.map((row) => renderUsageRow(row as SearchSidebarUsageRow))}
                </div>,
              )
            ) : (
              <div className="text-xs text-[rgb(var(--muted-foreground))]">{t('codePane.findUsagesEmpty')}</div>
            )
          ) : (
            <div className="text-xs text-[rgb(var(--muted-foreground))]">{t('codePane.findUsagesHint')}</div>
          )}
        </div>
      </div>
    </>
  );
});

const ProblemsSidebarContent = React.memo(function ProblemsSidebarContent({
  groups,
  summary,
  rootPath,
  onOpenFileLocation,
  t,
}: {
  groups: ProblemGroup[];
  summary: ProblemSummary;
  rootPath: string;
  onOpenFileLocation: (location: FileNavigationLocation) => void | Promise<void>;
  t: ReturnType<typeof useI18n>['t'];
}) {
  const listScrollRef = React.useRef<HTMLDivElement | null>(null);
  const [listScrollTop, setListScrollTop] = React.useState(0);
  const [listViewportHeight, setListViewportHeight] = React.useState(0);
  const pendingListScrollTopRef = React.useRef<number | null>(null);
  const listScrollAnimationFrameRef = React.useRef<number | null>(null);
  const flattenedEntries = React.useMemo(() => {
    const nextEntries: Array<{
      filePath: string;
      relativePath: string;
      problem: MonacoMarker & { filePath: string };
      tone: ReturnType<typeof getProblemTone>;
    }> = [];
    for (const group of groups) {
      const relativePath = getRelativePath(rootPath, group.filePath);
      for (const problem of group.entries) {
        nextEntries.push({
          filePath: group.filePath,
          relativePath,
          problem,
          tone: getProblemTone(problem.severity, t),
        });
      }
    }
    return nextEntries;
  }, [groups, rootPath, t]);
  const visibleEntries = React.useMemo(() => getWindowedListSlice({
    items: flattenedEntries,
    scrollTop: listScrollTop,
    viewportHeight: listViewportHeight,
    rowHeight: CODE_PANE_PROBLEMS_ROW_HEIGHT,
    overscan: CODE_PANE_PROBLEMS_ROW_OVERSCAN,
    threshold: CODE_PANE_PROBLEMS_WINDOWING_THRESHOLD,
  }), [flattenedEntries, listScrollTop, listViewportHeight]);

  const scheduleListScrollTopUpdate = React.useCallback((nextScrollTop: number) => {
    pendingListScrollTopRef.current = nextScrollTop;
    if (listScrollAnimationFrameRef.current !== null) {
      return;
    }

    listScrollAnimationFrameRef.current = window.requestAnimationFrame(() => {
      listScrollAnimationFrameRef.current = null;
      const pendingScrollTop = pendingListScrollTopRef.current;
      pendingListScrollTopRef.current = null;
      if (pendingScrollTop !== null) {
        setListScrollTop((currentScrollTop) => (
          currentScrollTop === pendingScrollTop ? currentScrollTop : pendingScrollTop
        ));
      }
    });
  }, []);

  React.useEffect(() => {
    const container = listScrollRef.current;
    if (!container) {
      return;
    }

    const syncViewport = () => {
      setListViewportHeight(container.clientHeight);
      setListScrollTop(container.scrollTop);
    };

    syncViewport();

    const resizeObserver = new ResizeObserver(() => {
      syncViewport();
    });
    resizeObserver.observe(container);
    return () => {
      if (listScrollAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(listScrollAnimationFrameRef.current);
        listScrollAnimationFrameRef.current = null;
      }
      resizeObserver.disconnect();
    };
  }, []);

  return (
    <>
      <div className="border-b border-[rgb(var(--border))] px-2 py-2">
        <div className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.12em] text-[rgb(var(--muted-foreground))]">
          <AlertTriangle size={12} />
          {t('codePane.problemsTab')}
        </div>
        <div className="flex items-center gap-2 text-xs text-[rgb(var(--muted-foreground))]">
          <span>{t('codePane.problemErrors', { count: summary.errorCount })}</span>
          <span>{t('codePane.problemWarnings', { count: summary.warningCount })}</span>
          <span>{t('codePane.problemInfos', { count: summary.infoCount })}</span>
        </div>
      </div>
      <div
        ref={listScrollRef}
        className="min-h-0 flex-1 overflow-auto px-2 py-2"
        onScroll={(event) => {
          scheduleListScrollTopUpdate(event.currentTarget.scrollTop);
        }}
      >
        {groups.length > 0 ? (
          visibleEntries.isWindowed ? (
            <div style={{ height: `${visibleEntries.totalHeight}px`, position: 'relative' }}>
              <div style={{ transform: `translateY(${visibleEntries.offsetTop}px)` }}>
                {visibleEntries.items.map(({ filePath, relativePath, problem, tone }) => (
                  <button
                    key={`${filePath}:${problem.startLineNumber}:${problem.startColumn}:${problem.message}`}
                    type="button"
                    onClick={() => {
                      void onOpenFileLocation({
                        filePath,
                        lineNumber: problem.startLineNumber,
                        column: problem.startColumn,
                      });
                    }}
                    className="flex h-7 w-full items-center gap-2 rounded px-1 py-1 text-left text-xs text-[rgb(var(--foreground))] transition-colors hover:bg-[rgb(var(--accent))] hover:text-[rgb(var(--foreground))]"
                    title={`${getPathLeafLabel(filePath)} · ${relativePath}`}
                  >
                    <span className={`rounded px-1 py-0.5 text-[10px] font-medium uppercase ${tone.className}`}>
                      {tone.label}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{problem.message}</span>
                    <span className="shrink-0 text-[10px] text-[rgb(var(--muted-foreground))]">
                      {problem.startLineNumber}:{problem.startColumn}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {groups.map((group) => (
                <div key={group.filePath} className="space-y-1">
                  <div className="flex items-center gap-2 px-1 py-1 text-xs text-[rgb(var(--foreground))]">
                    <FileIcon size={13} className="shrink-0 text-[rgb(var(--muted-foreground))]" />
                    <span className="min-w-0 flex-1 truncate">{getPathLeafLabel(group.filePath)}</span>
                    <span className="truncate text-[10px] text-[rgb(var(--muted-foreground))]">
                      {getRelativePath(rootPath, group.filePath)}
                    </span>
                  </div>
                  {group.entries.map((problem) => {
                    const tone = getProblemTone(problem.severity, t);
                    return (
                      <button
                        key={`${group.filePath}:${problem.startLineNumber}:${problem.startColumn}:${problem.message}`}
                        type="button"
                        onClick={() => {
                          void onOpenFileLocation({
                            filePath: group.filePath,
                            lineNumber: problem.startLineNumber,
                            column: problem.startColumn,
                          });
                        }}
                        className="flex w-full items-start gap-2 rounded px-1 py-1 text-left text-xs text-[rgb(var(--foreground))] transition-colors hover:bg-[rgb(var(--accent))] hover:text-[rgb(var(--foreground))]"
                      >
                        <span className={`mt-0.5 rounded px-1 py-0.5 text-[10px] font-medium uppercase ${tone.className}`}>
                          {tone.label}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="break-words">{problem.message}</div>
                          <div className="mt-1 text-[10px] text-[rgb(var(--muted-foreground))]">
                            {problem.startLineNumber}:{problem.startColumn}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )
        ) : (
          <div className="text-xs text-[rgb(var(--muted-foreground))]">{t('codePane.noProblems')}</div>
        )}
      </div>
    </>
  );
});

const ScmSidebarContent = React.memo(function ScmSidebarContent({
  repositorySummary,
  branchLabel,
  operationLabel,
  entries,
  selectedPath,
  selectedEntry,
  selectedRelativePath,
  rootPath,
  gitGraphCount,
  showInlineChanges,
  canCopyBranchName,
  onRefreshStatus,
  onOpenRepository,
  onCopyBranchName,
  onStageAll,
  onStash,
  onNewBranch,
  onCheckoutRevision,
  onRebaseContinue,
  onRebaseAbort,
  onOpenCommit,
  onOpenChangesWorkbench,
  onOpenGitLog,
  onSelectEntry,
  onOpenDiff,
  onStagePath,
  onUnstagePath,
  onDiscardPath,
  t,
}: {
  repositorySummary: CodePaneGitRepositorySummary | null;
  branchLabel: string | null;
  operationLabel: string;
  entries: CodePaneGitStatusEntry[];
  selectedPath: string | null;
  selectedEntry: CodePaneGitStatusEntry | null;
  selectedRelativePath: string | null;
  rootPath: string;
  gitGraphCount: number;
  showInlineChanges: boolean;
  canCopyBranchName: boolean;
  onRefreshStatus: () => void;
  onOpenRepository: () => void;
  onCopyBranchName: () => void;
  onStageAll: () => void;
  onStash: () => void;
  onNewBranch: () => void;
  onCheckoutRevision: () => void;
  onRebaseContinue: () => void;
  onRebaseAbort: () => void;
  onOpenCommit: () => void;
  onOpenChangesWorkbench: () => void;
  onOpenGitLog: () => void;
  onSelectEntry: (entry: CodePaneGitStatusEntry) => void;
  onOpenDiff: (filePath: string) => void;
  onStagePath: (filePath: string) => void;
  onUnstagePath: (filePath: string) => void;
  onDiscardPath: (filePath: string, restoreStaged: boolean) => void;
  t: ReturnType<typeof useI18n>['t'];
}) {
  const hasRepositoryContent = Boolean(repositorySummary) || entries.length > 0;

  return (
    <>
      <div className="border-b border-[rgb(var(--border))] px-2 py-2">
        <div className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.12em] text-[rgb(var(--muted-foreground))]">
          <GitBranch size={12} />
          {t('codePane.sourceControl')}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-[rgb(var(--muted-foreground))]">
          {branchLabel ? (
            <span className="rounded border border-[rgb(var(--primary))]/30 bg-[rgb(var(--primary))]/0.08 px-1.5 py-0.5 text-[rgb(var(--primary))]">
              {branchLabel}
            </span>
          ) : null}
          <span>
            {hasRepositoryContent
              ? t('codePane.sourceControlHint')
              : t('codePane.gitRepositoryUnavailable')}
          </span>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
        {hasRepositoryContent ? (
          <div className="space-y-3">
            {repositorySummary && (
              <div className="rounded border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--secondary))_58%,transparent)] p-2">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-[rgb(var(--muted-foreground))]">
                    {t('codePane.gitRepositorySummary')}
                  </div>
                  <button
                    type="button"
                    onClick={onRefreshStatus}
                    className="rounded border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--secondary))_74%,transparent)] p-1 text-[rgb(var(--muted-foreground))] transition-colors hover:border-[rgb(var(--ring))] hover:bg-[rgb(var(--accent))] hover:text-[rgb(var(--foreground))]"
                    aria-label={t('codePane.gitRefreshStatus')}
                  >
                    <RefreshCw size={12} />
                  </button>
                </div>
                {(repositorySummary.operation !== 'idle' || repositorySummary.hasConflicts) && (
                  <div className="mb-2 flex flex-wrap gap-2">
                    {repositorySummary.operation !== 'idle' && (
                      <span className="rounded border border-[rgb(var(--warning))/0.30] bg-[rgb(var(--warning))/0.08] px-1.5 py-0.5 text-[10px] font-medium text-[rgb(var(--warning))]">
                        {operationLabel}
                      </span>
                    )}
                    {repositorySummary.hasConflicts && (
                      <span className="rounded border border-[rgb(var(--error))/0.30] bg-[rgb(var(--error))/0.08] px-1.5 py-0.5 text-[10px] font-medium text-[rgb(var(--error))]">
                        {t('codePane.gitConflictsActive')}
                      </span>
                    )}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2 text-xs text-[rgb(var(--foreground))]">
                  <div className="rounded border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--background))_76%,transparent)] px-2 py-1.5">
                    <div className="text-[10px] uppercase tracking-[0.08em] text-[rgb(var(--muted-foreground))]">{t('codePane.gitBranch')}</div>
                    <div className="mt-1 truncate text-[rgb(var(--foreground))]">{branchLabel ?? t('codePane.gitDetachedHead')}</div>
                  </div>
                  <div className="rounded border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--background))_76%,transparent)] px-2 py-1.5">
                    <div className="text-[10px] uppercase tracking-[0.08em] text-[rgb(var(--muted-foreground))]">{t('codePane.gitUpstream')}</div>
                    <div className="mt-1 truncate text-[rgb(var(--foreground))]">{repositorySummary.upstreamBranch ?? t('codePane.gitNoUpstream')}</div>
                  </div>
                  <div className="rounded border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--background))_76%,transparent)] px-2 py-1.5">
                    <div className="text-[10px] uppercase tracking-[0.08em] text-[rgb(var(--muted-foreground))]">{t('codePane.gitAheadBehind')}</div>
                    <div className="mt-1 text-[rgb(var(--foreground))]">
                      ↑{repositorySummary.aheadCount} ↓{repositorySummary.behindCount}
                    </div>
                  </div>
                  <div className="rounded border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--background))_76%,transparent)] px-2 py-1.5">
                    <div className="text-[10px] uppercase tracking-[0.08em] text-[rgb(var(--muted-foreground))]">{t('codePane.gitOperation')}</div>
                    <div className="mt-1 truncate text-[rgb(var(--foreground))]">{operationLabel}</div>
                  </div>
                  <div className="rounded border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--background))_76%,transparent)] px-2 py-1.5">
                    <div className="text-[10px] uppercase tracking-[0.08em] text-[rgb(var(--muted-foreground))]">{t('codePane.gitConflicts')}</div>
                    <div className="mt-1 truncate text-[rgb(var(--foreground))]">
                      {repositorySummary.hasConflicts
                        ? t('codePane.gitConflictsActive')
                        : t('codePane.gitConflictsNone')}
                    </div>
                  </div>
                  <div className="rounded border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--background))_76%,transparent)] px-2 py-1.5">
                    <div className="text-[10px] uppercase tracking-[0.08em] text-[rgb(var(--muted-foreground))]">{t('codePane.gitRepoRoot')}</div>
                    <div className="mt-1 truncate text-[rgb(var(--foreground))]">{repositorySummary.repoRootPath}</div>
                  </div>
                </div>
              </div>
            )}

            <div className="rounded border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--secondary))_58%,transparent)] p-2">
              <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-[rgb(var(--muted-foreground))]">
                {t('codePane.gitQuickActions')}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={onRefreshStatus}
                  className="rounded border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--secondary))_74%,transparent)] px-2 py-1 text-[11px] text-[rgb(var(--foreground))] transition-colors hover:border-[rgb(var(--ring))] hover:bg-[rgb(var(--accent))]"
                >
                  {t('codePane.gitRefreshStatus')}
                </button>
                <button
                  type="button"
                  onClick={onOpenRepository}
                  className="rounded border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--secondary))_74%,transparent)] px-2 py-1 text-[11px] text-[rgb(var(--foreground))] transition-colors hover:border-[rgb(var(--ring))] hover:bg-[rgb(var(--accent))]"
                >
                  {t('codePane.gitOpenRepository')}
                </button>
                <button
                  type="button"
                  disabled={!canCopyBranchName}
                  onClick={onCopyBranchName}
                  className="rounded border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--secondary))_74%,transparent)] px-2 py-1 text-[11px] text-[rgb(var(--foreground))] transition-colors hover:border-[rgb(var(--ring))] hover:bg-[rgb(var(--accent))] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {t('codePane.gitCopyBranchName')}
                </button>
                <button
                  type="button"
                  disabled={entries.length === 0}
                  onClick={onStageAll}
                  className="rounded border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--secondary))_74%,transparent)] px-2 py-1 text-[11px] text-[rgb(var(--foreground))] transition-colors hover:border-[rgb(var(--ring))] hover:bg-[rgb(var(--accent))] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {t('codePane.gitStageAll')}
                </button>
                <button
                  type="button"
                  onClick={onStash}
                  className="rounded border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--secondary))_74%,transparent)] px-2 py-1 text-[11px] text-[rgb(var(--foreground))] transition-colors hover:border-[rgb(var(--ring))] hover:bg-[rgb(var(--accent))]"
                >
                  {t('codePane.gitStash')}
                </button>
                <button
                  type="button"
                  onClick={onNewBranch}
                  className="rounded border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--secondary))_74%,transparent)] px-2 py-1 text-[11px] text-[rgb(var(--foreground))] transition-colors hover:border-[rgb(var(--ring))] hover:bg-[rgb(var(--accent))]"
                >
                  {t('codePane.gitNewBranchDots')}
                </button>
                <button
                  type="button"
                  onClick={onCheckoutRevision}
                  className="rounded border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--secondary))_74%,transparent)] px-2 py-1 text-[11px] text-[rgb(var(--foreground))] transition-colors hover:border-[rgb(var(--ring))] hover:bg-[rgb(var(--accent))]"
                >
                  {t('codePane.gitCheckoutTagOrRevision')}
                </button>
                {repositorySummary?.operation === 'rebase' && (
                  <>
                    <button
                      type="button"
                      onClick={onRebaseContinue}
                      className="rounded border border-[rgb(var(--warning))/0.30] bg-[rgb(var(--warning))/0.08] px-2 py-1 text-[11px] text-[rgb(var(--warning))] transition-colors hover:border-[rgb(var(--warning))/0.50] hover:bg-[rgb(var(--warning))/0.14]"
                    >
                      {t('codePane.gitRebaseContinue')}
                    </button>
                    <button
                      type="button"
                      onClick={onRebaseAbort}
                      className="rounded border border-[rgb(var(--error))/0.30] bg-[rgb(var(--error))/0.08] px-2 py-1 text-[11px] text-[rgb(var(--error))] transition-colors hover:border-[rgb(var(--error))/0.50] hover:bg-[rgb(var(--error))/0.14]"
                    >
                      {t('codePane.gitRebaseAbort')}
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className="rounded border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--secondary))_58%,transparent)] p-2">
              <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-[rgb(var(--muted-foreground))]">
                {t('codePane.gitComposer')}
              </div>
              <button
                type="button"
                aria-label={t('codePane.gitCommitDots')}
                onClick={onOpenCommit}
                className="flex w-full items-center justify-between rounded border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--background))_76%,transparent)] px-2 py-2 text-left text-xs text-[rgb(var(--foreground))] transition-colors hover:border-[rgb(var(--ring))] hover:bg-[rgb(var(--accent))]"
              >
                <span>{t('codePane.gitCommitDots')}</span>
                <span className="rounded bg-[color-mix(in_srgb,rgb(var(--secondary))_76%,transparent)] px-1.5 py-0.5 text-[10px] text-[rgb(var(--muted-foreground))]">{entries.length}</span>
              </button>
              <div className="mt-2 text-[11px] leading-5 text-[rgb(var(--muted-foreground))]">
                {t('codePane.sourceControlHint')}
              </div>
            </div>

            <div className="rounded border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--secondary))_58%,transparent)] p-2">
              <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-[rgb(var(--muted-foreground))]">
                {t('codePane.gitWorkbenchTab')}
              </div>
              <div className="space-y-2">
                <button
                  type="button"
                  aria-label={t('codePane.gitOpenChangesWorkbench')}
                  onClick={onOpenChangesWorkbench}
                  className="flex w-full items-center justify-between rounded border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--background))_76%,transparent)] px-2 py-2 text-left text-xs text-[rgb(var(--foreground))] transition-colors hover:border-[rgb(var(--ring))] hover:bg-[rgb(var(--accent))]"
                >
                  <span>{t('codePane.gitOpenChangesWorkbench')}</span>
                  <span aria-hidden="true" className="rounded bg-[color-mix(in_srgb,rgb(var(--secondary))_76%,transparent)] px-1.5 py-0.5 text-[10px] text-[rgb(var(--muted-foreground))]">{entries.length}</span>
                </button>
                <button
                  type="button"
                  aria-label={t('codePane.gitOpenWorkbench')}
                  onClick={onOpenGitLog}
                  className="flex w-full items-center justify-between rounded border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--background))_76%,transparent)] px-2 py-2 text-left text-xs text-[rgb(var(--foreground))] transition-colors hover:border-[rgb(var(--ring))] hover:bg-[rgb(var(--accent))]"
                >
                  <span>{t('codePane.gitOpenWorkbench')}</span>
                  <span aria-hidden="true" className="rounded bg-[color-mix(in_srgb,rgb(var(--secondary))_76%,transparent)] px-1.5 py-0.5 text-[10px] text-[rgb(var(--muted-foreground))]">{gitGraphCount}</span>
                </button>
              </div>
            </div>

            {entries.length > 0 && showInlineChanges && (
              <div className="rounded border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--secondary))_58%,transparent)] p-2">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-[rgb(var(--muted-foreground))]">
                    {t('codePane.sourceControl')}
                  </div>
                  <span className="rounded bg-[color-mix(in_srgb,rgb(var(--secondary))_76%,transparent)] px-1.5 py-0.5 text-[10px] text-[rgb(var(--muted-foreground))]">
                    {entries.length}
                  </span>
                </div>

                <div className="space-y-1">
                  {entries.slice(0, 8).map((entry) => {
                    const isSelected = selectedPath === entry.path;
                    const statusTone = getStatusTone(entry.status);
                    return (
                      <div
                        key={entry.path}
                        onClick={() => {
                          onSelectEntry(entry);
                        }}
                        role="listitem"
                        className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors ${
                          isSelected
                            ? 'bg-[rgb(var(--primary))]/15 text-[rgb(var(--foreground))]'
                            : 'text-[rgb(var(--foreground))] hover:bg-[rgb(var(--accent))] hover:text-[rgb(var(--foreground))]'
                        }`}
                      >
                        {statusTone ? (
                          <span className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-medium ${statusTone.className}`}>
                            {statusTone.badge}
                          </span>
                        ) : (
                          <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--secondary))_76%,transparent)] text-[10px] text-[rgb(var(--muted-foreground))]">
                            <FileIcon size={10} />
                          </span>
                        )}
                        <span className={`min-w-0 flex-1 truncate ${getStatusTextClassName(entry.status)}`}>
                          {getPathLeafLabel(entry.path)}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {selectedEntry && (
                  <div className="mt-3 border-t border-[rgb(var(--border))] pt-2">
                    <div className="mb-2 truncate text-[11px] text-[rgb(var(--muted-foreground))]">
                      {selectedRelativePath ?? getRelativePath(rootPath, selectedEntry.path)}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        aria-label={t('codePane.openDiff')}
                        onClick={() => {
                          onOpenDiff(selectedEntry.path);
                        }}
                        className="rounded border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--secondary))_74%,transparent)] px-2 py-1 text-[11px] text-[rgb(var(--foreground))] transition-colors hover:border-[rgb(var(--ring))] hover:bg-[rgb(var(--accent))]"
                      >
                        {t('codePane.openDiff')}
                      </button>
                      {(selectedEntry.unstaged || !selectedEntry.staged) && (
                        <button
                          type="button"
                          aria-label={t('codePane.gitStage')}
                          onClick={() => {
                            onStagePath(selectedEntry.path);
                          }}
                          className="rounded border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--secondary))_74%,transparent)] px-2 py-1 text-[11px] text-[rgb(var(--foreground))] transition-colors hover:border-[rgb(var(--ring))] hover:bg-[rgb(var(--accent))]"
                        >
                          {t('codePane.gitStage')}
                        </button>
                      )}
                      {selectedEntry.staged && (
                        <button
                          type="button"
                          aria-label={t('codePane.gitUnstage')}
                          onClick={() => {
                            onUnstagePath(selectedEntry.path);
                          }}
                          className="rounded border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--secondary))_74%,transparent)] px-2 py-1 text-[11px] text-[rgb(var(--foreground))] transition-colors hover:border-[rgb(var(--ring))] hover:bg-[rgb(var(--accent))]"
                        >
                          {t('codePane.gitUnstage')}
                        </button>
                      )}
                      <button
                        type="button"
                        aria-label={t('codePane.gitDiscard')}
                        onClick={() => {
                          onDiscardPath(selectedEntry.path, Boolean(selectedEntry.staged));
                        }}
                        className="rounded border border-[rgb(var(--error))/0.30] bg-[rgb(var(--error))/0.08] px-2 py-1 text-[11px] text-[rgb(var(--error))] transition-colors hover:border-[rgb(var(--error))/0.50] hover:bg-[rgb(var(--error))/0.14]"
                      >
                        {t('codePane.gitDiscard')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="text-xs text-[rgb(var(--muted-foreground))]">{t('codePane.gitRepositoryUnavailable')}</div>
        )}
      </div>
    </>
  );
});

type SaveFileOptions = {
  overwrite?: boolean;
  skipQualityPipeline?: boolean;
  skipGitRefresh?: boolean;
  waitForLanguageSync?: boolean;
};

type FileTreeViewport = {
  scrollTop: number;
  viewportHeight: number;
};

type FilesSidebarSearchState = {
  trimmedQuery: string;
  results: string[];
  isSearching: boolean;
  error: string | null;
};

type SearchSidebarPersistedState = {
  contentQuery: string;
  contentResults: CodePaneContentMatch[];
  contentError: string | null;
  workspaceSymbolQuery: string;
  workspaceSymbolResults: CodePaneWorkspaceSymbol[];
  workspaceSymbolError: string | null;
};

type GitRevisionDiffRequest = {
  filePath: string;
  leftCommitSha?: string;
  rightCommitSha?: string;
  leftLabel?: string;
  rightLabel?: string;
};

type PathMutationDialogMode = 'create-file' | 'create-folder' | 'rename';

type PathMutationDialogState = {
  mode: PathMutationDialogMode;
  targetPath: string;
  entryType: CodePaneTreeEntry['type'];
  initialValue: string;
};

type CommitWindowState = {
  initialMessage: string;
  preselectedPaths: string[] | null;
  entriesSnapshot: CodePaneGitStatusEntry[];
};

function areCommitWindowStatesEqual(
  previousState: CommitWindowState | null,
  nextState: CommitWindowState | null,
): boolean {
  if (previousState === nextState) {
    return true;
  }

  if (!previousState || !nextState) {
    return false;
  }

  return previousState.initialMessage === nextState.initialMessage
    && areStringArraysEqual(previousState.preselectedPaths, nextState.preselectedPaths)
    && areGitStatusEntriesEqual(previousState.entriesSnapshot, nextState.entriesSnapshot);
}

function areNavigationAvailabilitiesEqual(
  previousAvailability: { canNavigateBack: boolean; canNavigateForward: boolean },
  nextAvailability: { canNavigateBack: boolean; canNavigateForward: boolean },
): boolean {
  return previousAvailability.canNavigateBack === nextAvailability.canNavigateBack
    && previousAvailability.canNavigateForward === nextAvailability.canNavigateForward;
}

function areNavigationHistoryEntriesEqual(
  previousEntries: NavigationHistoryEntry[],
  nextEntries: NavigationHistoryEntry[],
): boolean {
  if (previousEntries.length !== nextEntries.length) {
    return false;
  }

  for (let index = 0; index < previousEntries.length; index += 1) {
    const previousEntry = previousEntries[index];
    const nextEntry = nextEntries[index];
    if (
      previousEntry?.filePath !== nextEntry?.filePath
      || previousEntry?.lineNumber !== nextEntry?.lineNumber
      || previousEntry?.column !== nextEntry?.column
      || previousEntry?.displayPath !== nextEntry?.displayPath
    ) {
      return false;
    }
  }

  return true;
}

function areStringSetsEqual(previousValues: Set<string>, nextValues: Set<string>): boolean {
  if (previousValues.size !== nextValues.size) {
    return false;
  }

  for (const value of previousValues) {
    if (!nextValues.has(value)) {
      return false;
    }
  }

  return true;
}

function areTreeEntriesByDirectoryEqual(
  previousEntries: Record<string, CodePaneTreeEntry[]>,
  nextEntries: Record<string, CodePaneTreeEntry[]>,
): boolean {
  const previousPaths = Object.keys(previousEntries);
  const nextPaths = Object.keys(nextEntries);
  if (previousPaths.length !== nextPaths.length) {
    return false;
  }

  for (const directoryPath of previousPaths) {
    const currentEntries = previousEntries[directoryPath];
    const candidateEntries = nextEntries[directoryPath];
    if (!candidateEntries || !areTreeEntriesEqual(currentEntries ?? [], candidateEntries)) {
      return false;
    }
  }

  return true;
}

function areIndexStatusesEqual(
  previousStatus: CodePaneIndexStatus | null,
  nextStatus: CodePaneIndexStatus | null,
): boolean {
  if (previousStatus === nextStatus) {
    return true;
  }

  if (!previousStatus || !nextStatus) {
    return false;
  }

  return previousStatus.paneId === nextStatus.paneId
    && previousStatus.rootPath === nextStatus.rootPath
    && previousStatus.state === nextStatus.state
    && previousStatus.processedDirectoryCount === nextStatus.processedDirectoryCount
    && previousStatus.totalDirectoryCount === nextStatus.totalDirectoryCount
    && previousStatus.indexedFileCount === nextStatus.indexedFileCount
    && previousStatus.reusedPersistedIndex === nextStatus.reusedPersistedIndex
    && (previousStatus.error ?? '') === (nextStatus.error ?? '');
}

type ActionInputDialogState =
  | {
    kind: 'rename-symbol';
    initialValue: string;
    filePath: string;
    language: string;
    position: {
      lineNumber: number;
      column: number;
    };
  }
  | {
    kind: 'rename-path-preview';
    filePath: string;
    initialValue: string;
  }
  | {
    kind: 'move-path-preview';
    filePath: string;
    initialValue: string;
  }
  | {
    kind: 'compare-file-with-reference';
    filePath: string;
    mode: 'revision' | 'branch';
    initialValue: string;
  }
  | {
    kind: 'checkout-revision';
    initialValue: string;
  }
  | {
    kind: 'cherry-pick';
    initialValue: string;
  }
  | {
    kind: 'checkout-branch';
    initialValue: string;
    createBranch: boolean;
    startPoint?: string;
    detached?: boolean;
    preferExisting?: boolean;
  }
  | {
    kind: 'rename-branch';
    branchName: string;
    initialValue: string;
  }
  | {
    kind: 'stash';
    initialValue: string;
    includeUntracked: boolean;
  };

type ActionConfirmDialogState =
  | {
    kind: 'safe-delete-path';
    filePath: string;
  }
  | {
    kind: 'delete-branch';
    branchName: string;
    force: boolean;
  };

export interface CodePaneProps {
  windowId: string;
  pane: Pane;
  isActive: boolean;
  onActivate: () => void;
  onClose?: () => void;
}

function normalizePath(pathValue: string): string {
  return pathValue.replace(/\\/g, '/').replace(/\/+$/, '');
}

function getPathComparisonKey(pathValue: string): string {
  const normalizedPath = normalizePath(pathValue);
  return window.electronAPI.platform === 'win32'
    ? normalizedPath.toLowerCase()
    : normalizedPath;
}

function isVirtualDocumentPath(pathValue: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(pathValue) && !pathValue.toLowerCase().startsWith('file://');
}

function createFallbackRange(lineNumber: number, column: number): MonacoRange {
  return {
    startLineNumber: lineNumber,
    startColumn: column,
    endLineNumber: lineNumber,
    endColumn: column + 1,
  };
}

function resolveTrackedPath(
  pathValue: string,
  trackedPaths: Iterable<string>,
): string {
  const normalizedPath = normalizePath(pathValue);
  const comparisonKey = getPathComparisonKey(pathValue);
  for (const candidatePath of trackedPaths) {
    if (getPathComparisonKey(candidatePath) === comparisonKey) {
      return candidatePath;
    }
  }
  return normalizedPath;
}

function normalizeSidebarMode(mode: string | undefined): SidebarMode {
  switch (mode) {
    case 'search':
    case 'scm':
    case 'problems':
      return mode;
    case 'files':
    default:
      return 'files';
  }
}

function getBreakpointKey(breakpoint: CodePaneBreakpoint): string {
  return `${normalizePath(breakpoint.filePath)}:${breakpoint.lineNumber}`;
}

function normalizeBreakpoint(
  breakpoint: Partial<CodePaneBreakpoint> & {
    filePath: string;
    lineNumber: number;
  },
): CodePaneBreakpoint {
  const normalizedBreakpoint: CodePaneBreakpoint = {
    filePath: normalizePath(breakpoint.filePath),
    lineNumber: Math.max(1, Math.round(breakpoint.lineNumber)),
  };

  if (typeof breakpoint.id === 'string' && breakpoint.id.trim().length > 0) {
    normalizedBreakpoint.id = breakpoint.id.trim();
  }
  if (breakpoint.condition?.trim()) {
    normalizedBreakpoint.condition = breakpoint.condition.trim();
  }
  if (breakpoint.logMessage?.trim()) {
    normalizedBreakpoint.logMessage = breakpoint.logMessage.trim();
  }
  if (breakpoint.enabled === false) {
    normalizedBreakpoint.enabled = false;
  }

  return normalizedBreakpoint;
}

function normalizeBreakpoints(
  breakpoints: Array<{
    filePath: string;
    lineNumber: number;
    condition?: string;
    logMessage?: string;
    enabled?: boolean;
  }> | undefined | null,
): CodePaneBreakpoint[] {
  const normalizedBreakpoints: CodePaneBreakpoint[] = [];
  const seenKeys = new Set<string>();

  for (const breakpoint of breakpoints ?? []) {
    if (!breakpoint?.filePath || !Number.isFinite(breakpoint.lineNumber)) {
      continue;
    }

    const normalizedBreakpoint = normalizeBreakpoint(breakpoint);
    const breakpointKey = getBreakpointKey(normalizedBreakpoint);
    if (seenKeys.has(breakpointKey)) {
      continue;
    }

    seenKeys.add(breakpointKey);
    normalizedBreakpoints.push(normalizedBreakpoint);
  }

  return normalizedBreakpoints.sort((left, right) => {
    const pathOrder = left.filePath.localeCompare(right.filePath);
    return pathOrder !== 0 ? pathOrder : left.lineNumber - right.lineNumber;
  });
}

function normalizeExceptionBreakpoints(
  breakpoints: Array<{
    id: 'all';
    enabled: boolean;
    label?: string;
  }> | undefined | null,
): CodePaneExceptionBreakpoint[] {
  const allBreakpoint = breakpoints?.find((breakpoint) => breakpoint.id === 'all');
  return [{
    id: 'all',
    label: allBreakpoint?.label ?? CODE_PANE_DEFAULT_EXCEPTION_BREAKPOINTS[0].label,
    enabled: allBreakpoint?.enabled === true,
  }];
}

function normalizeWatchExpressions(watchExpressions: string[] | undefined | null): string[] {
  const normalizedExpressions: string[] = [];
  const seenExpressions = new Set<string>();

  for (const watchExpression of watchExpressions ?? []) {
    const normalizedExpression = watchExpression.trim();
    if (!normalizedExpression || seenExpressions.has(normalizedExpression)) {
      continue;
    }

    seenExpressions.add(normalizedExpression);
    normalizedExpressions.push(normalizedExpression);
  }

  return normalizedExpressions;
}

function areBreakpointsEqual(
  previousBreakpoints: CodePaneBreakpoint[],
  nextBreakpoints: CodePaneBreakpoint[],
): boolean {
  if (previousBreakpoints.length !== nextBreakpoints.length) {
    return false;
  }

  for (let index = 0; index < previousBreakpoints.length; index += 1) {
    const previousBreakpoint = previousBreakpoints[index];
    const nextBreakpoint = nextBreakpoints[index];
    if (
      previousBreakpoint?.id !== nextBreakpoint?.id
      || previousBreakpoint?.filePath !== nextBreakpoint?.filePath
      || previousBreakpoint?.lineNumber !== nextBreakpoint?.lineNumber
      || previousBreakpoint?.condition !== nextBreakpoint?.condition
      || previousBreakpoint?.logMessage !== nextBreakpoint?.logMessage
      || previousBreakpoint?.enabled !== nextBreakpoint?.enabled
    ) {
      return false;
    }
  }

  return true;
}

function areExceptionBreakpointsEqual(
  previousBreakpoints: Array<Pick<CodePaneExceptionBreakpoint, 'id' | 'enabled'> & Partial<Pick<CodePaneExceptionBreakpoint, 'label'>>>,
  nextBreakpoints: Array<Pick<CodePaneExceptionBreakpoint, 'id' | 'enabled'> & Partial<Pick<CodePaneExceptionBreakpoint, 'label'>>>,
): boolean {
  if (previousBreakpoints.length !== nextBreakpoints.length) {
    return false;
  }

  for (let index = 0; index < previousBreakpoints.length; index += 1) {
    const previousBreakpoint = previousBreakpoints[index];
    const nextBreakpoint = nextBreakpoints[index];
    if (
      previousBreakpoint?.id !== nextBreakpoint?.id
      || previousBreakpoint?.enabled !== nextBreakpoint?.enabled
      || (previousBreakpoint?.label ?? CODE_PANE_DEFAULT_EXCEPTION_BREAKPOINTS[0]?.label ?? '')
        !== (nextBreakpoint?.label ?? CODE_PANE_DEFAULT_EXCEPTION_BREAKPOINTS[0]?.label ?? '')
    ) {
      return false;
    }
  }

  return true;
}

function getBreakpointGlyphClassName(breakpoint: CodePaneBreakpoint): string {
  if (breakpoint.enabled === false) {
    return 'code-pane-breakpoint-glyph code-pane-breakpoint-glyph-disabled';
  }
  if (breakpoint.logMessage?.trim()) {
    return 'code-pane-breakpoint-glyph code-pane-breakpoint-glyph-log';
  }
  if (breakpoint.condition?.trim()) {
    return 'code-pane-breakpoint-glyph code-pane-breakpoint-glyph-conditional';
  }
  return 'code-pane-breakpoint-glyph';
}

function formatBreakpointHoverMessage(
  breakpoint: CodePaneBreakpoint,
  t: ReturnType<typeof useI18n>['t'],
): string {
  const details = [t('codePane.breakpointHoverLine', { line: breakpoint.lineNumber })];
  if (breakpoint.enabled === false) {
    details.push(t('codePane.breakpointHoverDisabled'));
  }
  if (breakpoint.condition?.trim()) {
    details.push(t('codePane.breakpointHoverCondition', { condition: breakpoint.condition.trim() }));
  }
  if (breakpoint.logMessage?.trim()) {
    details.push(t('codePane.breakpointHoverLog', { log: breakpoint.logMessage.trim() }));
  }
  return details.join('\n');
}

function getHierarchyNodeKey(item: CodePaneHierarchyItem): string {
  const selectionRange = item.selectionRange;
  return [
    item.filePath,
    selectionRange.startLineNumber,
    selectionRange.startColumn,
    item.name,
  ].join(':');
}

function createHierarchyTreeNode(
  item: CodePaneHierarchyItem,
  children?: CodePaneHierarchyItem[],
): HierarchyTreeNode {
  const childNodes = (children ?? []).map((child) => createHierarchyTreeNode(child));
  return {
    key: getHierarchyNodeKey(item),
    item,
    children: childNodes,
    isExpanded: childNodes.length > 0,
    isLoading: false,
    isExpandable: true,
    error: null,
  };
}

function updateHierarchyTreeNode(
  node: HierarchyTreeNode,
  targetKey: string,
  updater: (candidate: HierarchyTreeNode) => HierarchyTreeNode,
): HierarchyTreeNode {
  if (node.key === targetKey) {
    return updater(node);
  }

  if (node.children.length === 0) {
    return node;
  }

  let didChange = false;
  const nextChildren = node.children.map((child) => {
    const nextChild = updateHierarchyTreeNode(child, targetKey, updater);
    if (nextChild !== child) {
      didChange = true;
    }
    return nextChild;
  });

  if (!didChange) {
    return node;
  }

  return {
    ...node,
    children: nextChildren,
  };
}

function findHierarchyTreeNode(node: HierarchyTreeNode | null, targetKey: string): HierarchyTreeNode | null {
  if (!node) {
    return null;
  }

  if (node.key === targetKey) {
    return node;
  }

  for (const child of node.children) {
    const match = findHierarchyTreeNode(child, targetKey);
    if (match) {
      return match;
    }
  }

  return null;
}

function areHierarchyItemsEqual(
  previousItem?: CodePaneHierarchyItem | null,
  nextItem?: CodePaneHierarchyItem | null,
): boolean {
  if (previousItem === nextItem) {
    return true;
  }

  if (!previousItem || !nextItem) {
    return false;
  }

  return previousItem.name === nextItem.name
    && previousItem.detail === nextItem.detail
    && previousItem.kind === nextItem.kind
    && previousItem.filePath === nextItem.filePath
    && previousItem.displayPath === nextItem.displayPath
    && previousItem.uri === nextItem.uri
    && previousItem.readOnly === nextItem.readOnly
    && previousItem.language === nextItem.language
    && previousItem.content === nextItem.content
    && areRangesEqual(previousItem.range, nextItem.range)
    && areRangesEqual(previousItem.selectionRange, nextItem.selectionRange)
    && areRangeListsEqual(previousItem.relationRanges ?? [], nextItem.relationRanges ?? []);
}

function areRangeListsEqual(previousRanges: CodePaneRange[], nextRanges: CodePaneRange[]): boolean {
  if (previousRanges.length !== nextRanges.length) {
    return false;
  }

  for (let index = 0; index < previousRanges.length; index += 1) {
    if (!areRangesEqual(previousRanges[index], nextRanges[index])) {
      return false;
    }
  }

  return true;
}

function areHierarchyTreeNodesEqual(
  previousNode: HierarchyTreeNode | null,
  nextNode: HierarchyTreeNode | null,
): boolean {
  if (previousNode === nextNode) {
    return true;
  }

  if (!previousNode || !nextNode) {
    return false;
  }

  if (
    previousNode.key !== nextNode.key
    || !areHierarchyItemsEqual(previousNode.item, nextNode.item)
    || previousNode.isExpanded !== nextNode.isExpanded
    || previousNode.isLoading !== nextNode.isLoading
    || previousNode.isExpandable !== nextNode.isExpandable
    || previousNode.error !== nextNode.error
    || previousNode.children.length !== nextNode.children.length
  ) {
    return false;
  }

  for (let index = 0; index < previousNode.children.length; index += 1) {
    if (!areHierarchyTreeNodesEqual(previousNode.children[index] ?? null, nextNode.children[index] ?? null)) {
      return false;
    }
  }

  return true;
}

function summarizeSemanticTokens(result: CodePaneSemanticTokensResult): {
  totalTokens: number;
  summary: SemanticTokenSummaryEntry[];
} {
  const counts = new Map<string, number>();
  const data = result.data ?? [];
  for (let index = 0; index + 4 < data.length; index += 5) {
    const tokenTypeIndex = data[index + 3];
    const tokenType = result.legend.tokenTypes[tokenTypeIndex] ?? `token-${String(tokenTypeIndex)}`;
    counts.set(tokenType, (counts.get(tokenType) ?? 0) + 1);
  }

  const summary: SemanticTokenSummaryEntry[] = [];
  for (const [tokenType, count] of counts.entries()) {
    summary.push({ tokenType, count });
  }
  summary.sort((left, right) => right.count - left.count || left.tokenType.localeCompare(right.tokenType));

  return {
    totalTokens: summary.reduce((total, entry) => total + entry.count, 0),
    summary,
  };
}

function clampSidebarWidth(width: number | undefined | null): number {
  if (!Number.isFinite(width)) {
    return CODE_PANE_SIDEBAR_DEFAULT_WIDTH;
  }

  return Math.min(
    CODE_PANE_SIDEBAR_MAX_WIDTH,
    Math.max(CODE_PANE_SIDEBAR_MIN_WIDTH, Math.round(width as number)),
  );
}

function clampEditorSplitSize(size: number | undefined | null): number {
  if (!Number.isFinite(size)) {
    return CODE_PANE_EDITOR_SPLIT_DEFAULT_SIZE;
  }

  return Math.min(
    CODE_PANE_EDITOR_SPLIT_MAX_SIZE,
    Math.max(CODE_PANE_EDITOR_SPLIT_MIN_SIZE, size ?? CODE_PANE_EDITOR_SPLIT_DEFAULT_SIZE),
  );
}

function getBottomPanelAvailableHeight(containerHeight: number | undefined | null): number {
  if (!Number.isFinite(containerHeight) || (containerHeight as number) <= 0) {
    return CODE_PANE_BOTTOM_PANEL_MAX_HEIGHT;
  }

  return Math.min(
    CODE_PANE_BOTTOM_PANEL_MAX_HEIGHT,
    Math.max(
      0,
      Math.round(containerHeight as number) - CODE_PANE_TOP_REGION_MIN_HEIGHT - CODE_PANE_STATUS_BAR_RESERVED_HEIGHT,
    ),
  );
}

function clampBottomPanelHeight(height: number | undefined | null, maxHeight = CODE_PANE_BOTTOM_PANEL_MAX_HEIGHT): number {
  const resolvedMaxHeight = Math.max(0, Math.round(maxHeight));
  const resolvedMinHeight = Math.min(CODE_PANE_BOTTOM_PANEL_MIN_HEIGHT, resolvedMaxHeight);
  const resolvedHeight = Number.isFinite(height)
    ? Math.round(height as number)
    : CODE_PANE_BOTTOM_PANEL_DEFAULT_HEIGHT;

  return Math.min(
    resolvedMaxHeight,
    Math.max(resolvedMinHeight, resolvedHeight),
  );
}

function getInitialEditorSplitLayout(pane: Pane) {
  return {
    visible: Boolean(pane.code?.layout?.editorSplit?.visible),
    size: clampEditorSplitSize(pane.code?.layout?.editorSplit?.size),
    secondaryFilePath: pane.code?.layout?.editorSplit?.secondaryFilePath ?? null,
  };
}

function getInitialSidebarLayout(pane: Pane): {
  visible: boolean;
  activeView: SidebarMode;
  width: number;
  lastExpandedWidth: number;
} {
  const sidebarState = pane.code?.layout?.sidebar;
  const width = clampSidebarWidth(
    sidebarState?.width
      ?? sidebarState?.lastExpandedWidth
      ?? CODE_PANE_SIDEBAR_DEFAULT_WIDTH,
  );

  return {
    visible: sidebarState?.visible ?? true,
    activeView: normalizeSidebarMode(sidebarState?.activeView),
    width,
    lastExpandedWidth: clampSidebarWidth(sidebarState?.lastExpandedWidth ?? width),
  };
}

function getInitialBottomPanelLayout(pane: Pane): {
  height: number;
} {
  return {
    height: clampBottomPanelHeight(pane.code?.layout?.bottomPanel?.height),
  };
}

function getInitialSavePipelineState(pane: Pane): Required<CodePaneSavePipelineState> {
  return {
    formatOnSave: pane.code?.savePipeline?.formatOnSave ?? false,
    organizeImportsOnSave: pane.code?.savePipeline?.organizeImportsOnSave ?? false,
    lintOnSave: pane.code?.savePipeline?.lintOnSave ?? false,
  };
}

function createFullDocumentRange(content: string) {
  const lines = content.split(/\r?\n/);
  const lastLine = lines.at(-1) ?? '';
  return {
    startLineNumber: 1,
    startColumn: 1,
    endLineNumber: lines.length,
    endColumn: lastLine.length + 1,
  };
}

function createSaveQualityState(config: {
  status: CodePaneSaveQualityState['status'];
  message?: string;
  steps?: CodePaneSaveQualityStep[];
}): CodePaneSaveQualityState {
  return {
    status: config.status,
    ...(config.message ? { message: config.message } : {}),
    ...(config.steps ? { steps: config.steps } : {}),
    updatedAt: new Date().toISOString(),
  };
}

function resolveSaveQualityStatus(steps: CodePaneSaveQualityStep[]): CodePaneSaveQualityState['status'] {
  if (steps.some((step) => step.status === 'error')) {
    return 'error';
  }
  if (steps.some((step) => step.status === 'warning')) {
    return 'warning';
  }
  if (steps.some((step) => step.status === 'running')) {
    return 'running';
  }
  if (steps.some((step) => step.status === 'passed')) {
    return 'passed';
  }
  return 'idle';
}

function updateSaveQualityStep(
  steps: CodePaneSaveQualityStep[],
  nextStep: CodePaneSaveQualityStep,
): CodePaneSaveQualityStep[] {
  const existingIndex = steps.findIndex((step) => step.id === nextStep.id);
  if (existingIndex === -1) {
    return [...steps, nextStep];
  }

  const nextSteps = [...steps];
  nextSteps.splice(existingIndex, 1, nextStep);
  return nextSteps;
}

function getRelativePath(rootPath: string, targetPath: string): string {
  const normalizedRootPath = normalizePath(rootPath);
  const normalizedTargetPath = normalizePath(targetPath);
  const rootPathComparisonKey = getPathComparisonKey(rootPath);
  const targetPathComparisonKey = getPathComparisonKey(targetPath);

  if (targetPathComparisonKey === rootPathComparisonKey) {
    return '';
  }

  if (targetPathComparisonKey.startsWith(`${rootPathComparisonKey}/`)) {
    return normalizedTargetPath.slice(normalizedRootPath.length + 1);
  }

  return normalizedTargetPath;
}

function getParentDirectory(targetPath: string): string {
  const normalizedTargetPath = normalizePath(targetPath);
  const lastSeparatorIndex = normalizedTargetPath.lastIndexOf('/');
  if (lastSeparatorIndex <= 0) {
    return normalizedTargetPath;
  }
  return normalizedTargetPath.slice(0, lastSeparatorIndex);
}

function replacePathLeaf(targetPath: string, nextLeaf: string): string {
  const parentDirectory = getParentDirectory(targetPath);
  return `${parentDirectory}/${nextLeaf}`.replace(/\/{2,}/g, '/');
}

function resolvePathFromRoot(rootPath: string, relativePath: string): string {
  const normalizedRootPath = normalizePath(rootPath);
  const normalizedRelativePath = normalizePath(relativePath).replace(/^\/+/, '');
  if (!normalizedRelativePath) {
    return normalizedRootPath;
  }

  return `${normalizedRootPath}/${normalizedRelativePath}`.replace(/\/{2,}/g, '/');
}

function replacePathPrefix(targetPath: string, sourcePath: string, nextPath: string): string {
  const normalizedTargetPath = normalizePath(targetPath);
  const normalizedSourcePath = normalizePath(sourcePath);
  const normalizedNextPath = normalizePath(nextPath);
  const targetPathComparisonKey = getPathComparisonKey(targetPath);
  const sourcePathComparisonKey = getPathComparisonKey(sourcePath);

  if (targetPathComparisonKey === sourcePathComparisonKey) {
    return normalizedNextPath;
  }

  if (!targetPathComparisonKey.startsWith(`${sourcePathComparisonKey}/`)) {
    return normalizedTargetPath;
  }

  return `${normalizedNextPath}${normalizedTargetPath.slice(normalizedSourcePath.length)}`;
}

function isPathEqualOrDescendant(targetPath: string, basePath: string): boolean {
  const targetPathComparisonKey = getPathComparisonKey(targetPath);
  const basePathComparisonKey = getPathComparisonKey(basePath);
  return targetPathComparisonKey === basePathComparisonKey
    || targetPathComparisonKey.startsWith(`${basePathComparisonKey}/`);
}

function splitGitBranchPath(branchName: string): string[] {
  const segments = branchName.split('/');
  const nextSegments: string[] = [];
  for (const segment of segments) {
    if (segment) {
      nextSegments.push(segment);
    }
  }
  return nextSegments;
}

function getTrackingLocalBranchName(remoteBranchName: string): string {
  const [, ...branchSegments] = splitGitBranchPath(remoteBranchName);
  return branchSegments.join('/') || remoteBranchName;
}

function getCurrentGitBranch(
  branches: CodePaneGitBranchEntry[],
  currentBranchName?: string | null,
): CodePaneGitBranchEntry | null {
  let branchMatchingName: CodePaneGitBranchEntry | null = null;
  for (const branch of branches) {
    if (branch.current) {
      return branch;
    }
    if (!branchMatchingName && currentBranchName && branch.name === currentBranchName) {
      branchMatchingName = branch;
    }
  }
  return branchMatchingName;
}

function getActionInputDialogId(state: ActionInputDialogState): string {
  switch (state.kind) {
    case 'rename-symbol':
      return `rename-symbol:${state.filePath}:${state.position.lineNumber}:${state.position.column}`;
    case 'rename-path-preview':
    case 'move-path-preview':
      return `${state.kind}:${state.filePath}`;
    case 'compare-file-with-reference':
      return `${state.kind}:${state.mode}:${state.filePath}`;
    case 'checkout-revision':
    case 'cherry-pick':
      return state.kind;
    case 'checkout-branch':
      return `${state.kind}:${state.createBranch ? 'create' : 'checkout'}:${state.startPoint ?? ''}:${state.detached ? 'detached' : 'attached'}`;
    case 'rename-branch':
      return `${state.kind}:${state.branchName}`;
    case 'stash':
      return `${state.kind}:${state.includeUntracked ? 'include-untracked' : 'tracked-only'}`;
  }
}

function buildBranchManagerTree(
  branches: CodePaneGitBranchEntry[],
  keyPrefix: string,
  getSegments: (branch: CodePaneGitBranchEntry) => string[],
): BranchManagerTreeNode[] {
  const rootNodes: BranchManagerTreeNode[] = [];

  for (const branch of branches) {
    const segments = getSegments(branch);
    insertBranchManagerTreeNode(rootNodes, segments.length > 0 ? segments : [branch.name], branch, keyPrefix, []);
  }

  return sortBranchManagerTreeNodes(rootNodes);
}

function insertBranchManagerTreeNode(
  nodes: BranchManagerTreeNode[],
  segments: string[],
  branch: CodePaneGitBranchEntry,
  keyPrefix: string,
  parentSegments: string[],
): void {
  if (segments.length <= 1) {
    nodes.push({
      key: `${keyPrefix}:branch:${branch.name}`,
      kind: 'branch',
      label: segments[0] ?? branch.name,
      branch,
    });
    return;
  }

  const [folderLabel, ...restSegments] = segments;
  const folderPath = parentSegments.length > 0
    ? `${parentSegments.join('/')}/${folderLabel}`
    : folderLabel;
  let folderNode = nodes.find((node): node is Extract<BranchManagerTreeNode, { kind: 'folder' }> => (
    node.kind === 'folder' && node.label === folderLabel
  ));

  if (!folderNode) {
    folderNode = {
      key: `${keyPrefix}:folder:${folderPath}`,
      kind: 'folder',
      label: folderLabel,
      children: [],
      branchCount: 0,
    };
    nodes.push(folderNode);
  }

  folderNode.branchCount += 1;
  insertBranchManagerTreeNode(folderNode.children, restSegments, branch, keyPrefix, [...parentSegments, folderLabel]);
}

function sortBranchManagerTreeNodes(nodes: BranchManagerTreeNode[]): BranchManagerTreeNode[] {
  const nextNodes = [...nodes];
  for (let index = 0; index < nextNodes.length; index += 1) {
    const node = nextNodes[index];
    if (node?.kind === 'folder') {
      nextNodes[index] = {
        ...node,
        children: sortBranchManagerTreeNodes(node.children),
      };
    }
  }

  nextNodes.sort((leftNode, rightNode) => {
    if (leftNode.kind !== rightNode.kind) {
      return leftNode.kind === 'folder' ? -1 : 1;
    }

    if (leftNode.kind === 'branch' && rightNode.kind === 'branch') {
      if (leftNode.branch.current !== rightNode.branch.current) {
        return leftNode.branch.current ? -1 : 1;
      }
    }

    return leftNode.label.localeCompare(rightNode.label, undefined, { sensitivity: 'base' });
  });
  return nextNodes;
}

function flattenBranchManagerTreeRows(
  nodes: BranchManagerTreeNode[],
  collapsedNodeKeys: Set<string>,
  depth = 0,
): BranchManagerVisibleTreeRow[] {
  const rows: BranchManagerVisibleTreeRow[] = [];
  const stack: Array<{ node: BranchManagerTreeNode; depth: number }> = [];

  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    stack.push({
      node: nodes[index]!,
      depth,
    });
  }

  while (stack.length > 0) {
    const nextRow = stack.pop()!;
    rows.push({
      key: nextRow.node.key,
      depth: nextRow.depth,
      node: nextRow.node,
    });

    if (nextRow.node.kind === 'folder' && !collapsedNodeKeys.has(nextRow.node.key)) {
      for (let index = nextRow.node.children.length - 1; index >= 0; index -= 1) {
        stack.push({
          node: nextRow.node.children[index]!,
          depth: nextRow.depth + 1,
        });
      }
    }
  }

  return rows;
}

function getBranchManagerCollapsedNodeKeySignature(collapsedNodeKeys: Set<string>): string {
  if (collapsedNodeKeys.size === 0) {
    return '';
  }

  return [...collapsedNodeKeys].sort().join('\u0000');
}

function getCachedFlattenBranchManagerTreeRows(
  cache: WeakMap<BranchManagerTreeNode[], Map<string, BranchManagerVisibleTreeRow[]>>,
  nodes: BranchManagerTreeNode[],
  collapsedNodeKeys: Set<string>,
  collapsedNodeKeySignature: string,
): BranchManagerVisibleTreeRow[] {
  let rowsByState = cache.get(nodes);
  if (!rowsByState) {
    rowsByState = new Map();
    cache.set(nodes, rowsByState);
  }

  const cachedRows = rowsByState.get(collapsedNodeKeySignature);
  if (cachedRows) {
    return cachedRows;
  }

  const rows = flattenBranchManagerTreeRows(nodes, collapsedNodeKeys);
  rowsByState.set(collapsedNodeKeySignature, rows);
  return rows;
}

function getCachedFilteredBranchManagerTreeNodes(
  cache: WeakMap<BranchManagerTreeNode[], Map<string, BranchManagerTreeFilterResult>>,
  nodes: BranchManagerTreeNode[],
  normalizedQuery: string,
): BranchManagerTreeFilterResult {
  if (!normalizedQuery) {
    return {
      count: countBranchManagerTreeNodes(nodes),
      nodes,
    };
  }

  let filteredResultsByQuery = cache.get(nodes);
  if (!filteredResultsByQuery) {
    filteredResultsByQuery = new Map();
    cache.set(nodes, filteredResultsByQuery);
  }

  const cachedResult = filteredResultsByQuery.get(normalizedQuery);
  if (cachedResult) {
    return cachedResult;
  }

  const result = filterBranchManagerTreeNodes(nodes, normalizedQuery);
  filteredResultsByQuery.set(normalizedQuery, result);
  return result;
}

function filterBranchManagerTreeNodes(
  nodes: BranchManagerTreeNode[],
  normalizedQuery: string,
): BranchManagerTreeFilterResult {
  if (!normalizedQuery) {
    return {
      count: countBranchManagerTreeNodes(nodes),
      nodes,
    };
  }

  const filteredNodes: BranchManagerTreeNode[] = [];
  let count = 0;
  for (const node of nodes) {
    if (node.kind === 'branch') {
      if (doesBranchMatchQuery(node.branch, node.label, normalizedQuery)) {
        filteredNodes.push(node);
        count += 1;
      }
      continue;
    }

    const folderMatches = node.label.toLowerCase().includes(normalizedQuery);
    if (folderMatches) {
      filteredNodes.push(node);
      count += node.branchCount;
      continue;
    }

    const filteredChildren = filterBranchManagerTreeNodes(node.children, normalizedQuery);
    if (filteredChildren.count === 0) {
      continue;
    }

    filteredNodes.push({
      ...node,
      children: filteredChildren.nodes,
      branchCount: filteredChildren.count,
    });
    count += filteredChildren.count;
  }

  return {
    count,
    nodes: filteredNodes,
  };
}

function countBranchManagerTreeNodes(nodes: BranchManagerTreeNode[]): number {
  let count = 0;
  for (const node of nodes) {
    count += node.kind === 'folder' ? node.branchCount : 1;
  }
  return count;
}

function doesBranchMatchQuery(
  branch: CodePaneGitBranchEntry,
  label: string,
  normalizedQuery: string,
): boolean {
  if (label.toLowerCase().includes(normalizedQuery)) {
    return true;
  }
  if (branch.name.toLowerCase().includes(normalizedQuery)) {
    return true;
  }
  if (branch.shortName.toLowerCase().includes(normalizedQuery)) {
    return true;
  }
  if (branch.upstream?.toLowerCase().includes(normalizedQuery)) {
    return true;
  }
  if (branch.subject.toLowerCase().includes(normalizedQuery)) {
    return true;
  }
  return branch.shortSha.toLowerCase().includes(normalizedQuery);
}

function isKnownMonacoCancellationError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const maybeError = error as { name?: string; message?: string };
  return maybeError.name === 'Canceled'
    || maybeError.message === 'Canceled'
    || maybeError.message === 'Model not found';
}

function isPathInside(parentPath: string, candidatePath: string): boolean {
  const normalizedParentPath = normalizePath(parentPath);
  const normalizedCandidatePath = normalizePath(candidatePath);
  const parentPathComparisonKey = getPathComparisonKey(parentPath);
  const candidatePathComparisonKey = getPathComparisonKey(candidatePath);
  if (normalizedParentPath.includes('://') || normalizedCandidatePath.includes('://')) {
    return candidatePathComparisonKey === parentPathComparisonKey
      || candidatePathComparisonKey.startsWith(`${parentPathComparisonKey}/`);
  }

  return candidatePathComparisonKey === parentPathComparisonKey
    || candidatePathComparisonKey.startsWith(`${parentPathComparisonKey}/`);
}

function isExternalTreePath(rootPath: string, targetPath: string): boolean {
  return !isPathInside(rootPath, targetPath);
}

function matchesLanguageWorkspaceRoot(
  rootPath: string,
  state: CodePaneLanguageWorkspaceState,
): boolean {
  return state.workspaceRoot === rootPath
    || state.projectRoot === rootPath
    || isPathInside(rootPath, state.projectRoot)
    || isPathInside(state.projectRoot, rootPath);
}

function formatLanguageLabel(languageId: string, unknownLabel: string): string {
  switch (languageId) {
    case 'java':
      return 'Java';
    case 'python':
      return 'Python';
    case 'typescript':
      return 'TypeScript';
    case 'javascript':
      return 'JavaScript';
    case 'go':
      return 'Go';
    default:
      return languageId ? `${languageId.slice(0, 1).toUpperCase()}${languageId.slice(1)}` : unknownLabel;
  }
}

function formatWorkspacePhaseLabel(
  phase: CodePaneLanguageWorkspaceState['phase'],
  t: ReturnType<typeof useI18n>['t'],
): string {
  switch (phase) {
    case 'detecting-project':
      return t('codePane.workspacePhaseDetecting');
    case 'importing-project':
      return t('codePane.workspacePhaseImporting');
    case 'indexing-workspace':
      return t('codePane.workspacePhaseIndexing');
    case 'starting-runtime':
    case 'starting':
      return t('codePane.workspacePhaseStarting');
    case 'ready':
      return t('codePane.workspacePhaseReady');
    case 'degraded':
      return t('codePane.workspacePhaseDegraded');
    case 'error':
      return t('codePane.workspacePhaseError');
    case 'idle':
    default:
      return t('codePane.workspacePhaseIdle');
  }
}

function detectLanguageFromPath(filePath: string): string {
  const baseName = getPathLeafLabel(filePath).toLowerCase();
  const extensionMatch = baseName.match(/\.([^.]+)$/);
  const extension = extensionMatch?.[1] ?? '';

  if (baseName === 'dockerfile') return 'dockerfile';
  if (baseName === '.gitignore') return 'plaintext';
  if (baseName === '.env' || baseName.startsWith('.env.')) return 'shell';

  switch (extension) {
    case 'ts':
    case 'tsx':
      return 'typescript';
    case 'js':
    case 'jsx':
      return 'javascript';
    case 'json':
      return 'json';
    case 'css':
    case 'scss':
    case 'less':
      return 'css';
    case 'html':
    case 'htm':
      return 'html';
    case 'md':
      return 'markdown';
    case 'py':
      return 'python';
    case 'sh':
    case 'bash':
    case 'zsh':
      return 'shell';
    case 'yml':
    case 'yaml':
      return 'yaml';
    case 'xml':
      return 'xml';
    case 'java':
      return 'java';
    case 'go':
      return 'go';
    case 'rs':
      return 'rust';
    case 'c':
      return 'c';
    case 'cc':
    case 'cpp':
    case 'cxx':
    case 'h':
    case 'hpp':
      return 'cpp';
    case 'php':
      return 'php';
    case 'sql':
      return 'sql';
    default:
      return 'plaintext';
  }
}

function isPathAffectedByRemovedDirectory(removedDirectoryPaths: string[], candidatePath: string): boolean {
  return removedDirectoryPaths.some((removedDirectoryPath) => isPathInside(removedDirectoryPath, candidatePath));
}

function getDirectoryRefreshPath(rootPath: string, change: CodePaneFsChange): string | null {
  if (change.type === 'change' || change.type === 'unlink' || change.type === 'unlinkDir') {
    return null;
  }

  const normalizedRootPath = normalizePath(rootPath);
  const normalizedChangedPath = normalizePath(change.path);
  if (normalizedChangedPath === normalizedRootPath) {
    return normalizedRootPath;
  }

  const parentDirectoryPath = getParentDirectory(normalizedChangedPath);
  return isPathInside(normalizedRootPath, parentDirectoryPath) ? parentDirectoryPath : null;
}

function collectDirectoryRefreshPaths(
  rootPath: string,
  changes: CodePaneFsChange[],
  loadedDirectories: Set<string>,
): string[] {
  const shouldRefreshLoadedDirectories = changes.some((change) => (
    change.type !== 'change'
    && change.type !== 'unlink'
    && change.type !== 'unlinkDir'
  ));
  if (!shouldRefreshLoadedDirectories) {
    return [];
  }

  const loadedDirectoryPaths = new Set<string>();
  for (const directoryPath of loadedDirectories) {
    loadedDirectoryPaths.add(normalizePath(directoryPath));
  }
  const normalizedRootPath = normalizePath(rootPath);
  const directoryPathsToRefresh = new Set<string>();

  for (const change of changes) {
    const directoryPath = getDirectoryRefreshPath(rootPath, change);
    if (!directoryPath) {
      continue;
    }

    if (directoryPath === normalizedRootPath || loadedDirectoryPaths.has(directoryPath)) {
      directoryPathsToRefresh.add(directoryPath);
    }
  }

  return [...directoryPathsToRefresh];
}

function createExpandedDirectorySet(rootPath: string, expandedPaths?: string[] | null): Set<string> {
  if (!expandedPaths) {
    return new Set<string>([rootPath]);
  }

  const nextExpandedDirectories = new Set<string>();
  for (const expandedPath of expandedPaths ?? []) {
    if (expandedPath && isPathInside(rootPath, expandedPath)) {
      nextExpandedDirectories.add(expandedPath);
    }
  }
  return nextExpandedDirectories;
}

function isCompactPackageCandidate(rootPath: string, directoryPath: string): boolean {
  if (isExternalTreePath(rootPath, directoryPath)) {
    return false;
  }

  const relativePath = getRelativePath(rootPath, directoryPath);
  if (!relativePath) {
    return false;
  }

  const segments = relativePath.split('/').filter(Boolean);
  if (segments.length <= 3) {
    return false;
  }

  return CODE_PANE_COMPACT_PACKAGE_SOURCE_ROOTS.some((sourceRoot) => (
    sourceRoot.every((segment, index) => segments[index] === segment)
  ));
}

function buildCompactDirectoryPresentation(
  rootPath: string,
  startEntry: CodePaneTreeEntry,
  getDirectoryEntries: (directoryPath: string) => CodePaneTreeEntry[],
): CompactDirectoryPresentation {
  if (startEntry.type !== 'directory' || !isCompactPackageCandidate(rootPath, startEntry.path)) {
    return {
      startPath: startEntry.path,
      displayName: startEntry.name,
      entry: startEntry,
      isCompacted: false,
      visibleDirectoryPaths: [startEntry.path],
    };
  }

  const visibleDirectoryPaths = [startEntry.path];
  const compactedNames = [startEntry.name];
  let currentEntry = startEntry;

  while (true) {
    const childEntries = getDirectoryEntries(currentEntry.path);
    if (childEntries.length !== 1) {
      break;
    }

    const [singleChild] = childEntries;
    if (singleChild.type !== 'directory' || !isCompactPackageCandidate(rootPath, singleChild.path)) {
      break;
    }

    visibleDirectoryPaths.push(singleChild.path);
    compactedNames.push(singleChild.name);
    currentEntry = singleChild;
  }

  return {
    startPath: startEntry.path,
    displayName: compactedNames.length > 1 ? compactedNames.join('.') : startEntry.name,
    entry: currentEntry,
    isCompacted: compactedNames.length > 1,
    visibleDirectoryPaths,
  };
}

function collectGitDirectoryStatuses(
  rootPath: string,
  entries: CodePaneGitStatusEntry[],
): Record<string, CodePaneGitStatusEntry['status']> {
  const snapshot = getGitStatusDerivedSnapshot(entries);
  const cachedDirectoryStatusByPath = snapshot.directoryStatusByPathByRoot.get(rootPath);
  if (cachedDirectoryStatusByPath) {
    return cachedDirectoryStatusByPath;
  }

  const directoryStatusByPath: Record<string, CodePaneGitStatusEntry['status']> = {};

  for (const entry of entries) {
    let currentDirectoryPath = getParentDirectory(entry.path);

    while (currentDirectoryPath && isPathInside(rootPath, currentDirectoryPath)) {
      if (!directoryStatusByPath[currentDirectoryPath]) {
        directoryStatusByPath[currentDirectoryPath] = entry.status;
      }

      if (currentDirectoryPath === rootPath) {
        break;
      }

      const parentDirectoryPath = getParentDirectory(currentDirectoryPath);
      if (!parentDirectoryPath || parentDirectoryPath === currentDirectoryPath) {
        break;
      }

      currentDirectoryPath = parentDirectoryPath;
    }
  }

  snapshot.directoryStatusByPathByRoot.set(rootPath, directoryStatusByPath);
  return directoryStatusByPath;
}

function getWindowedListSlice<T>({
  items,
  scrollTop,
  viewportHeight,
  rowHeight,
  overscan,
  threshold,
}: {
  items: T[];
  scrollTop: number;
  viewportHeight: number;
  rowHeight: number;
  overscan: number;
  threshold: number;
}): WindowedListSlice<T> {
  const totalHeight = items.length * rowHeight;

  if (items.length <= threshold || viewportHeight <= 0) {
    return {
      items,
      offsetTop: 0,
      totalHeight,
      isWindowed: false,
    };
  }

  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const endIndex = Math.min(
    items.length,
    Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan,
  );

  return {
    items: items.slice(startIndex, endIndex),
    offsetTop: startIndex * rowHeight,
    totalHeight,
    isWindowed: true,
  };
}

function getWindowedInlineListSlice<T>({
  items,
  scrollLeft,
  viewportWidth,
  itemWidth,
  overscan,
  threshold,
}: {
  items: T[];
  scrollLeft: number;
  viewportWidth: number;
  itemWidth: number;
  overscan: number;
  threshold: number;
}): WindowedInlineListSlice<T> {
  const totalWidth = items.length * itemWidth;

  if (items.length <= threshold || viewportWidth <= 0) {
    return {
      items,
      offsetLeft: 0,
      totalWidth,
      isWindowed: false,
    };
  }

  const startIndex = Math.max(0, Math.floor(scrollLeft / itemWidth) - overscan);
  const endIndex = Math.min(
    items.length,
    Math.ceil((scrollLeft + viewportWidth) / itemWidth) + overscan,
  );

  return {
    items: items.slice(startIndex, endIndex),
    offsetLeft: startIndex * itemWidth,
    totalWidth,
    isWindowed: true,
  };
}

function shouldAutoLoadCompactDirectoryChildren(rootPath: string, directoryPath: string): boolean {
  const relativePath = getRelativePath(rootPath, directoryPath);
  if (!relativePath) {
    return false;
  }

  const segments = relativePath.split('/').filter(Boolean);
  return CODE_PANE_COMPACT_PACKAGE_SOURCE_ROOTS.some((sourceRoot) => (
    sourceRoot.length === segments.length
      && sourceRoot.every((segment, index) => segments[index] === segment)
  ));
}

function getQualifiedNameForTreePath(
  rootPath: string,
  targetPath: string,
  entryType: CodePaneTreeEntry['type'],
): string | null {
  if (isExternalTreePath(rootPath, targetPath)) {
    return null;
  }

  const relativePath = getRelativePath(rootPath, targetPath);
  if (!relativePath) {
    return null;
  }

  const segments = relativePath.split('/').filter(Boolean);
  if (segments.length <= 3) {
    return null;
  }

  const matchedSourceRoot = CODE_PANE_COMPACT_PACKAGE_SOURCE_ROOTS.find((sourceRoot) => (
    sourceRoot.every((segment, index) => segments[index] === segment)
  ));
  if (!matchedSourceRoot) {
    return null;
  }

  const packageSegments = entryType === 'directory'
    ? segments.slice(matchedSourceRoot.length)
    : segments.slice(matchedSourceRoot.length, -1);
  if (packageSegments.length === 0) {
    return null;
  }

  return packageSegments.join('.');
}

function sortOpenFilesByPinned<T extends { pinned?: boolean; preview?: boolean }>(openFiles: T[]): T[] {
  const pinnedOpenFiles: T[] = [];
  const regularOpenFiles: T[] = [];
  const previewOpenFiles: T[] = [];
  for (const tab of openFiles) {
    if (tab.pinned) {
      pinnedOpenFiles.push(tab);
      continue;
    }

    if (tab.preview) {
      previewOpenFiles.push(tab);
      continue;
    }

    regularOpenFiles.push(tab);
  }
  return [...pinnedOpenFiles, ...regularOpenFiles, ...previewOpenFiles];
}

function areOpenFilesEqual(previousOpenFiles: CodePaneOpenFile[], nextOpenFiles: CodePaneOpenFile[]): boolean {
  if (previousOpenFiles.length !== nextOpenFiles.length) {
    return false;
  }

  for (let index = 0; index < previousOpenFiles.length; index += 1) {
    const previousFile = previousOpenFiles[index];
    const nextFile = nextOpenFiles[index];
    if (
      previousFile?.path !== nextFile?.path
      || Boolean(previousFile?.pinned) !== Boolean(nextFile?.pinned)
      || Boolean(previousFile?.preview) !== Boolean(nextFile?.preview)
    ) {
      return false;
    }
  }

  return true;
}

function areStringArraysEqual(previousValues?: string[] | null, nextValues?: string[] | null): boolean {
  const previousArray = previousValues ?? [];
  const nextArray = nextValues ?? [];
  if (previousArray.length !== nextArray.length) {
    return false;
  }

  for (let index = 0; index < previousArray.length; index += 1) {
    if (previousArray[index] !== nextArray[index]) {
      return false;
    }
  }

  return true;
}

function areCodePaneBookmarksEqual(
  previousBookmarks?: CodePaneState['bookmarks'],
  nextBookmarks?: CodePaneState['bookmarks'],
): boolean {
  const previousArray = previousBookmarks ?? [];
  const nextArray = nextBookmarks ?? [];
  if (previousArray.length !== nextArray.length) {
    return false;
  }

  for (let index = 0; index < previousArray.length; index += 1) {
    const previousBookmark = previousArray[index];
    const nextBookmark = nextArray[index];
    if (
      previousBookmark?.id !== nextBookmark?.id
      || previousBookmark?.filePath !== nextBookmark?.filePath
      || previousBookmark?.lineNumber !== nextBookmark?.lineNumber
      || previousBookmark?.column !== nextBookmark?.column
      || previousBookmark?.label !== nextBookmark?.label
      || previousBookmark?.createdAt !== nextBookmark?.createdAt
    ) {
      return false;
    }
  }

  return true;
}

function arePersistedBreakpointsEqual(
  previousBreakpoints?: CodePaneState['breakpoints'],
  nextBreakpoints?: CodePaneState['breakpoints'],
): boolean {
  const previousArray = previousBreakpoints ?? [];
  const nextArray = nextBreakpoints ?? [];
  if (previousArray.length !== nextArray.length) {
    return false;
  }

  for (let index = 0; index < previousArray.length; index += 1) {
    const previousBreakpoint = previousArray[index];
    const nextBreakpoint = nextArray[index];
    if (
      previousBreakpoint?.filePath !== nextBreakpoint?.filePath
      || previousBreakpoint?.lineNumber !== nextBreakpoint?.lineNumber
      || previousBreakpoint?.condition !== nextBreakpoint?.condition
      || previousBreakpoint?.logMessage !== nextBreakpoint?.logMessage
      || previousBreakpoint?.enabled !== nextBreakpoint?.enabled
    ) {
      return false;
    }
  }

  return true;
}

function areRunTargetConfigurationsEqual(
  previousConfigurations?: CodePaneState['runConfigurations'],
  nextConfigurations?: CodePaneState['runConfigurations'],
): boolean {
  const previousEntries = Object.entries(previousConfigurations ?? {});
  const nextEntries = Object.entries(nextConfigurations ?? {});
  if (previousEntries.length !== nextEntries.length) {
    return false;
  }

  for (const [targetId, previousCustomization] of previousEntries) {
    const nextCustomization = nextConfigurations?.[targetId];
    if (!nextCustomization || !areRunTargetCustomizationsEqual(previousCustomization, nextCustomization)) {
      return false;
    }
  }

  return true;
}

function areCodePaneStatesEqual(previousState: CodePaneState, nextState: CodePaneState): boolean {
  return previousState.rootPath === nextState.rootPath
    && areOpenFilesEqual(previousState.openFiles, nextState.openFiles)
    && (previousState.activeFilePath ?? null) === (nextState.activeFilePath ?? null)
    && (previousState.selectedPath ?? null) === (nextState.selectedPath ?? null)
    && areStringArraysEqual(previousState.expandedPaths, nextState.expandedPaths)
    && (previousState.viewMode ?? 'editor') === (nextState.viewMode ?? 'editor')
    && (previousState.diffTargetPath ?? null) === (nextState.diffTargetPath ?? null)
    && areRunTargetConfigurationsEqual(previousState.runConfigurations, nextState.runConfigurations)
    && areCodePaneBookmarksEqual(previousState.bookmarks, nextState.bookmarks)
    && arePersistedBreakpointsEqual(previousState.breakpoints, nextState.breakpoints)
    && areCodePaneDebugStatesEqual(previousState.debug ?? {}, nextState.debug ?? {})
    && areCodePaneLayoutSidebarsEqual(
      previousState.layout?.sidebar ?? {
        visible: true,
        activeView: 'files',
        width: CODE_PANE_SIDEBAR_DEFAULT_WIDTH,
        lastExpandedWidth: CODE_PANE_SIDEBAR_DEFAULT_WIDTH,
      },
      nextState.layout?.sidebar ?? {
        visible: true,
        activeView: 'files',
        width: CODE_PANE_SIDEBAR_DEFAULT_WIDTH,
        lastExpandedWidth: CODE_PANE_SIDEBAR_DEFAULT_WIDTH,
      },
    )
    && areCodePaneBottomPanelLayoutsEqual(
      previousState.layout?.bottomPanel ?? { height: CODE_PANE_BOTTOM_PANEL_DEFAULT_HEIGHT },
      nextState.layout?.bottomPanel ?? { height: CODE_PANE_BOTTOM_PANEL_DEFAULT_HEIGHT },
    )
    && areCodePaneEditorSplitLayoutsEqual(
      previousState.layout?.editorSplit ?? {
        visible: false,
        size: CODE_PANE_EDITOR_SPLIT_DEFAULT_SIZE,
        secondaryFilePath: null,
      },
      nextState.layout?.editorSplit ?? {
        visible: false,
        size: CODE_PANE_EDITOR_SPLIT_DEFAULT_SIZE,
        secondaryFilePath: null,
      },
    )
    && (previousState.savePipeline?.formatOnSave ?? false) === (nextState.savePipeline?.formatOnSave ?? false)
    && (previousState.savePipeline?.organizeImportsOnSave ?? false) === (nextState.savePipeline?.organizeImportsOnSave ?? false)
    && (previousState.savePipeline?.lintOnSave ?? false) === (nextState.savePipeline?.lintOnSave ?? false);
}

function upsertOpenFileTab(
  existingTabs: CodePaneOpenFile[],
  filePath: string,
  options?: {
    preview?: boolean;
    promote?: boolean;
    pinned?: boolean;
  },
) {
  const shouldOpenAsPreview = Boolean(options?.preview) && !options?.pinned;
  const nextTabs = shouldOpenAsPreview
    ? existingTabs.filter((tab) => !tab.preview || tab.path === filePath)
    : [...existingTabs];
  const existingTabIndex = nextTabs.findIndex((tab) => tab.path === filePath);

  if (existingTabIndex >= 0) {
    const existingTab = nextTabs[existingTabIndex];
    const isPinned = options?.pinned ?? existingTab.pinned ?? false;
    nextTabs[existingTabIndex] = {
      ...existingTab,
      pinned: isPinned || undefined,
      preview: isPinned || options?.promote
        ? false
        : shouldOpenAsPreview
          ? true
          : existingTab.preview,
    };
  } else {
    nextTabs.push({
      path: filePath,
      pinned: options?.pinned,
      preview: shouldOpenAsPreview || undefined,
    });
  }

  const pinnedTabs = nextTabs.filter((tab) => tab.pinned);
  const unpinnedTabs = nextTabs.filter((tab) => !tab.pinned);
  if (unpinnedTabs.length > CODE_PANE_MAX_OPEN_FILE_TABS) {
    const removableTabIndex = unpinnedTabs.findIndex((tab) => tab.path !== filePath);
    if (removableTabIndex >= 0) {
      unpinnedTabs.splice(removableTabIndex, 1);
    } else {
      unpinnedTabs.splice(0, unpinnedTabs.length - CODE_PANE_MAX_OPEN_FILE_TABS);
    }
  }

  return sortOpenFilesByPinned([
    ...pinnedTabs,
    ...unpinnedTabs,
  ]);
}

function isSameNavigationLocation(
  left: Pick<NavigationHistoryEntry, 'filePath' | 'lineNumber' | 'column'> | null | undefined,
  right: Pick<NavigationHistoryEntry, 'filePath' | 'lineNumber' | 'column'> | null | undefined,
): boolean {
  if (!left || !right) {
    return false;
  }

  return left.filePath === right.filePath
    && left.lineNumber === right.lineNumber
    && left.column === right.column;
}

function getStatusTone(status?: CodePaneGitStatusEntry['status']): {
  badge: string;
  className: string;
} | null {
  switch (status) {
    case 'modified':
      return { badge: 'M', className: 'border border-[rgb(var(--warning))/0.30] bg-[rgb(var(--warning))/0.08] text-[rgb(var(--warning))]' };
    case 'untracked':
      return { badge: 'U', className: 'border border-[rgb(var(--success))/0.30] bg-[rgb(var(--success))/0.08] text-[rgb(var(--success))]' };
    case 'added':
      return { badge: 'A', className: 'border border-[rgb(var(--success))/0.30] bg-[rgb(var(--success))/0.08] text-[rgb(var(--success))]' };
    case 'deleted':
      return { badge: 'D', className: 'border border-[rgb(var(--error))/0.30] bg-[rgb(var(--error))/0.08] text-[rgb(var(--error))]' };
    case 'renamed':
      return { badge: 'R', className: 'border border-[rgb(var(--info))/0.30] bg-[rgb(var(--info))/0.08] text-[rgb(var(--info))]' };
    default:
      return null;
  }
}

function getStatusTextClassName(status?: CodePaneGitStatusEntry['status']): string {
  switch (status) {
    case 'modified':
      return 'text-[rgb(var(--warning))]';
    case 'untracked':
    case 'added':
      return 'text-[rgb(var(--success))]';
    case 'deleted':
      return 'text-[rgb(var(--error))]';
    case 'renamed':
      return 'text-[rgb(var(--info))]';
    default:
      return '';
  }
}

function getExternalChangeTextClassName(changeType?: ExternalChangeKind): string {
  switch (changeType) {
    case 'added':
      return 'text-[rgb(var(--success))]';
    case 'deleted':
      return 'text-[rgb(var(--error))]';
    case 'modified':
      return 'text-[rgb(var(--info))]';
    default:
      return '';
  }
}

function getExternalChangeEntriesKey(entries: ExternalChangeEntry[]): string {
  if (entries.length === 0) {
    return '';
  }

  return entries
    .map((entry) => `${entry.filePath}:${entry.changeType}:${entry.changedAt}:${entry.openedAtChange ? 1 : 0}`)
    .join('\u0000');
}

function getExternalChangeDotClassName(changeType: ExternalChangeKind): string {
  switch (changeType) {
    case 'added':
      return 'bg-[rgb(var(--success))] shadow-[0_0_0_3px_rgba(22,198,12,0.12)]';
    case 'deleted':
      return 'bg-[rgb(var(--error))] shadow-[0_0_0_3px_rgba(231,72,86,0.12)]';
    case 'modified':
    default:
      return 'bg-[rgb(var(--info))] shadow-[0_0_0_3px_rgba(97,214,214,0.12)]';
  }
}

function formatExternalChangeTime(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = `${date.getHours()}`.padStart(2, '0');
  const minutes = `${date.getMinutes()}`.padStart(2, '0');
  const seconds = `${date.getSeconds()}`.padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

function createEmptyExternalChangeLineSummary(): ExternalChangeLineSummary {
  return {
    addedCount: 0,
    deletedCount: 0,
    addedLines: [],
    deletedLines: [],
    hiddenAddedCount: 0,
    hiddenDeletedCount: 0,
    isApproximate: false,
  };
}

function createExternalChangeStateSnapshot(
  entries: ExternalChangeEntry[],
  selectedPath: string | null,
): ExternalChangeStateSnapshot {
  const entriesByPath = new Map<string, ExternalChangeEntry>();
  let selectedEntry: ExternalChangeEntry | null = null;

  for (const entry of entries) {
    entriesByPath.set(entry.filePath, entry);
    if (!selectedEntry && selectedPath && entry.filePath === selectedPath) {
      selectedEntry = entry;
    }
  }

  return {
    entries,
    entriesByPath,
    selectedPath,
    selectedEntry: selectedEntry ?? entries[0] ?? null,
  };
}

function splitExternalChangeContentLines(content: string | null): string[] {
  if (content === null) {
    return [];
  }

  const normalizedContent = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!normalizedContent) {
    return [];
  }

  const lines = normalizedContent.split('\n');
  if (normalizedContent.endsWith('\n')) {
    lines.pop();
  }
  return lines;
}

function createLinePreview(lines: string[]): ExternalChangeLineEntry[] {
  return lines.slice(0, CODE_PANE_EXTERNAL_CHANGE_PREVIEW_LINE_LIMIT).map((text, index) => ({
    lineNumber: index + 1,
    text,
  }));
}

function createExternalChangeLineSummary(
  previousContent: string | null,
  currentContent: string | null,
): ExternalChangeLineSummary {
  if (previousContent === null && currentContent === null) {
    return createEmptyExternalChangeLineSummary();
  }

  if (previousContent === null) {
    const addedLines = splitExternalChangeContentLines(currentContent);
    const previewLines = createLinePreview(addedLines);
    return {
      addedCount: addedLines.length,
      deletedCount: 0,
      addedLines: previewLines,
      deletedLines: [],
      hiddenAddedCount: Math.max(0, addedLines.length - previewLines.length),
      hiddenDeletedCount: 0,
      isApproximate: false,
    };
  }

  if (currentContent === null) {
    const deletedLines = splitExternalChangeContentLines(previousContent);
    const previewLines = createLinePreview(deletedLines);
    return {
      addedCount: 0,
      deletedCount: deletedLines.length,
      addedLines: [],
      deletedLines: previewLines,
      hiddenAddedCount: 0,
      hiddenDeletedCount: Math.max(0, deletedLines.length - previewLines.length),
      isApproximate: false,
    };
  }

  const previousLines = splitExternalChangeContentLines(previousContent);
  const currentLines = splitExternalChangeContentLines(currentContent);
  let prefixLength = 0;
  while (
    prefixLength < previousLines.length
    && prefixLength < currentLines.length
    && previousLines[prefixLength] === currentLines[prefixLength]
  ) {
    prefixLength += 1;
  }

  let previousSuffixIndex = previousLines.length - 1;
  let currentSuffixIndex = currentLines.length - 1;
  while (
    previousSuffixIndex >= prefixLength
    && currentSuffixIndex >= prefixLength
    && previousLines[previousSuffixIndex] === currentLines[currentSuffixIndex]
  ) {
    previousSuffixIndex -= 1;
    currentSuffixIndex -= 1;
  }

  const deletedChangedLines = previousLines.slice(prefixLength, previousSuffixIndex + 1);
  const addedChangedLines = currentLines.slice(prefixLength, currentSuffixIndex + 1);
  const deletedPreview = deletedChangedLines
    .slice(0, CODE_PANE_EXTERNAL_CHANGE_PREVIEW_LINE_LIMIT)
    .map((text, index) => ({
      lineNumber: prefixLength + index + 1,
      text,
    }));
  const addedPreview = addedChangedLines
    .slice(0, CODE_PANE_EXTERNAL_CHANGE_PREVIEW_LINE_LIMIT)
    .map((text, index) => ({
      lineNumber: prefixLength + index + 1,
      text,
    }));

  return {
    addedCount: addedChangedLines.length,
    deletedCount: deletedChangedLines.length,
    addedLines: addedPreview,
    deletedLines: deletedPreview,
    hiddenAddedCount: Math.max(0, addedChangedLines.length - addedPreview.length),
    hiddenDeletedCount: Math.max(0, deletedChangedLines.length - deletedPreview.length),
    isApproximate: true,
  };
}

function shouldRenderExternalChangeInlineDiff(
  previousContent: string | null,
  currentContent: string | null,
  summary: ExternalChangeLineSummary,
): boolean {
  const totalContentLength = (previousContent?.length ?? 0) + (currentContent?.length ?? 0);
  if (totalContentLength > CODE_PANE_EXTERNAL_CHANGE_INLINE_DIFF_MAX_CONTENT_LENGTH) {
    return false;
  }

  return summary.addedCount + summary.deletedCount <= CODE_PANE_EXTERNAL_CHANGE_INLINE_DIFF_MAX_RENDERED_LINES;
}

function ExternalChangeLinePreview({
  line,
  tone,
}: {
  line: ExternalChangeLineEntry;
  tone: 'added' | 'deleted';
}) {
  const toneClassName = tone === 'added'
    ? 'border-[rgb(var(--success))/0.28] bg-[rgb(var(--success))/0.08] text-[rgb(var(--foreground))]'
    : 'border-[rgb(var(--error))/0.28] bg-[rgb(var(--error))/0.08] text-[rgb(var(--foreground))]';
  const prefix = tone === 'added' ? '+' : '-';

  return (
    <div className={`grid grid-cols-[52px_minmax(0,1fr)] gap-2 border-b border-[rgb(var(--border))] px-2 py-1 last:border-b-0 ${toneClassName}`}>
      <span className="select-none text-right font-mono text-[10px] text-[rgb(var(--muted-foreground))]">
        {line.lineNumber}
      </span>
      <code className="min-w-0 whitespace-pre-wrap break-words font-mono text-[11px] leading-5">
        {prefix} {line.text || ' '}
      </code>
    </div>
  );
}

function ExternalChangeLineSummaryPanel({
  summary,
  t,
}: {
  summary: ExternalChangeLineSummary;
  t: ReturnType<typeof useI18n>['t'];
}) {
  if (summary.addedCount === 0 && summary.deletedCount === 0) {
    return (
      <div className="rounded border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--background))_76%,transparent)] px-3 py-2 text-xs text-[rgb(var(--muted-foreground))]">
        {t('codePane.externalChangeNoLineChanges')}
      </div>
    );
  }

  return (
    <div className="min-h-0 rounded border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--background))_76%,transparent)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[rgb(var(--border))] px-3 py-2">
        <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-[rgb(var(--muted-foreground))]">
          {t('codePane.externalChangeLineSummary')}
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <span className="rounded border border-[rgb(var(--success))/0.28] bg-[rgb(var(--success))/0.08] px-1.5 py-0.5 text-[rgb(var(--success))]">
            {t('codePane.externalChangeAddedLines', { count: summary.addedCount })}
          </span>
          <span className="rounded border border-[rgb(var(--error))/0.28] bg-[rgb(var(--error))/0.08] px-1.5 py-0.5 text-[rgb(var(--error))]">
            {t('codePane.externalChangeDeletedLines', { count: summary.deletedCount })}
          </span>
          {summary.isApproximate && (
            <span className="text-[rgb(var(--muted-foreground))]">{t('codePane.externalChangeLineSummaryApproximate')}</span>
          )}
        </div>
      </div>
      <div className="grid min-h-0 md:grid-cols-2">
        <div className="min-h-0 border-b border-[rgb(var(--border))] md:border-b-0 md:border-r">
          <div className="border-b border-[rgb(var(--border))] px-3 py-2 text-[11px] font-medium uppercase tracking-[0.12em] text-[rgb(var(--error))]">
            {t('codePane.externalChangeDeletedLines', { count: summary.deletedCount })}
          </div>
          <div className="max-h-52 overflow-auto">
            {summary.deletedLines.length > 0 ? (
              <>
                {summary.deletedLines.map((line) => (
                  <ExternalChangeLinePreview key={`deleted:${line.lineNumber}:${line.text}`} line={line} tone="deleted" />
                ))}
                {summary.hiddenDeletedCount > 0 && (
                  <div className="px-3 py-2 text-[11px] text-[rgb(var(--muted-foreground))]">
                    {t('codePane.externalChangeHiddenLines', { count: summary.hiddenDeletedCount })}
                  </div>
                )}
              </>
            ) : (
              <div className="px-3 py-3 text-xs text-[rgb(var(--muted-foreground))]">{t('codePane.externalChangeNoDeletedLines')}</div>
            )}
          </div>
        </div>
        <div className="min-h-0">
          <div className="border-b border-[rgb(var(--border))] px-3 py-2 text-[11px] font-medium uppercase tracking-[0.12em] text-[rgb(var(--success))]">
            {t('codePane.externalChangeAddedLines', { count: summary.addedCount })}
          </div>
          <div className="max-h-52 overflow-auto">
            {summary.addedLines.length > 0 ? (
              <>
                {summary.addedLines.map((line) => (
                  <ExternalChangeLinePreview key={`added:${line.lineNumber}:${line.text}`} line={line} tone="added" />
                ))}
                {summary.hiddenAddedCount > 0 && (
                  <div className="px-3 py-2 text-[11px] text-[rgb(var(--muted-foreground))]">
                    {t('codePane.externalChangeHiddenLines', { count: summary.hiddenAddedCount })}
                  </div>
                )}
              </>
            ) : (
              <div className="px-3 py-3 text-xs text-[rgb(var(--muted-foreground))]">{t('codePane.externalChangeNoAddedLines')}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const ExternalChangeEntryRow = React.memo(function ExternalChangeEntryRow({
  entry,
  isSelected,
  changeLabel,
  openedLabel,
  onSelectEntry,
  onOpenDiff,
}: {
  entry: ExternalChangeEntry;
  isSelected: boolean;
  changeLabel: string;
  openedLabel: string;
  onSelectEntry: (entry: ExternalChangeEntry) => void;
  onOpenDiff: (filePath: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        onSelectEntry(entry);
      }}
      onDoubleClick={() => {
        onOpenDiff(entry.filePath);
      }}
      className={`flex w-full items-start gap-2 rounded px-2 py-2 text-left text-xs transition-colors ${isSelected ? 'bg-[rgb(var(--primary))]/15 text-[rgb(var(--foreground))]' : 'text-[rgb(var(--foreground))] hover:bg-[rgb(var(--accent))] hover:text-[rgb(var(--foreground))]'}`}
    >
      <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${getExternalChangeDotClassName(entry.changeType)}`} />
      <div className="min-w-0 flex-1">
        <div className={`truncate font-medium ${getExternalChangeTextClassName(entry.changeType)}`}>
          {getPathLeafLabel(entry.filePath) || entry.filePath}
        </div>
        <div className="mt-1 truncate text-[10px] text-[rgb(var(--muted-foreground))]">{entry.relativePath}</div>
        <div className="mt-1 flex items-center gap-2 text-[10px] text-[rgb(var(--muted-foreground))]">
          <span>{changeLabel}</span>
          <span>{formatExternalChangeTime(entry.changedAt)}</span>
          {entry.openedAtChange && <span>{openedLabel}</span>}
        </div>
      </div>
    </button>
  );
});

const ExternalChangeDetailPanel = React.memo(function ExternalChangeDetailPanel({
  entry,
  t,
  onOpenDiff,
  onClearEntry,
}: {
  entry: ExternalChangeEntry;
  t: ReturnType<typeof useI18n>['t'];
  onOpenDiff: (filePath: string) => void;
  onClearEntry: (filePath: string) => void;
}) {
  const lineSummary = useMemo(
    () => createExternalChangeLineSummary(entry.previousContent, entry.currentContent),
    [entry.currentContent, entry.previousContent],
  );
  const canRenderInlineDiff = useMemo(
    () => shouldRenderExternalChangeInlineDiff(entry.previousContent, entry.currentContent, lineSummary),
    [entry.currentContent, entry.previousContent, lineSummary],
  );

  return (
    <>
      <div className="flex items-start justify-between gap-3 border-b border-[rgb(var(--border))] pb-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-[rgb(var(--foreground))]">
            {getPathLeafLabel(entry.filePath) || entry.filePath}
          </div>
          <div className="mt-1 truncate text-xs text-[rgb(var(--muted-foreground))]">
            {entry.relativePath}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            disabled={!entry.canDiff}
            onClick={() => {
              onOpenDiff(entry.filePath);
            }}
            className="rounded border border-[rgb(var(--primary))]/32 bg-[rgb(var(--primary))]/10 px-2 py-1 text-[11px] text-[rgb(var(--primary))] transition-colors hover:border-[rgb(var(--primary))]/52 hover:bg-[rgb(var(--primary))]/16 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t('codePane.externalChangeViewDiff')}
          </button>
          <button
            type="button"
            onClick={() => {
              onClearEntry(entry.filePath);
            }}
            className="rounded border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--secondary))_74%,transparent)] px-2 py-1 text-[11px] text-[rgb(var(--foreground))] transition-colors hover:border-[rgb(var(--ring))] hover:bg-[rgb(var(--accent))]"
          >
            {t('codePane.externalChangeClear')}
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-auto py-3">
        <ExternalChangeLineSummaryPanel
          summary={lineSummary}
          t={t}
        />
        <div className="min-h-0 rounded border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--background))_76%,transparent)]">
          <div className="border-b border-[rgb(var(--border))] px-3 py-2 text-[11px] font-medium uppercase tracking-[0.12em] text-[rgb(var(--muted-foreground))]">
            {t('codePane.inlineDiff')}
          </div>
          {canRenderInlineDiff ? (
            <div className="p-3">
              <InlineDiffViewer
                beforeContent={entry.previousContent}
                afterContent={entry.currentContent}
                maxHeightClassName="max-h-80"
                emptyLabel={t('codePane.externalChangeNoContent')}
              />
            </div>
          ) : (
            <div className="px-3 py-3 text-xs text-[rgb(var(--muted-foreground))]">
              {t('codePane.externalChangeInlineDiffSkipped')}
            </div>
          )}
        </div>
      </div>
    </>
  );
});

const ExternalChangesToolWindow = React.memo(function ExternalChangesToolWindow({
  entries,
  selectedEntry,
  onClose,
  onClearAll,
  onClearEntry,
  onSelectEntry,
  onOpenDiff,
}: {
  entries: ExternalChangeEntry[];
  selectedEntry: ExternalChangeEntry | null;
  onClose: () => void;
  onClearAll: () => void;
  onClearEntry: (filePath: string) => void;
  onSelectEntry: (entry: ExternalChangeEntry) => void;
  onOpenDiff: (filePath: string) => void;
}) {
  const { t } = useI18n();
  const listScrollRef = React.useRef<HTMLDivElement | null>(null);
  const [listScrollTop, setListScrollTop] = React.useState(0);
  const [listViewportHeight, setListViewportHeight] = React.useState(0);
  const pendingListScrollTopRef = React.useRef<number | null>(null);
  const listScrollAnimationFrameRef = React.useRef<number | null>(null);

  const scheduleListScrollTopUpdate = React.useCallback((nextScrollTop: number) => {
    pendingListScrollTopRef.current = nextScrollTop;
    if (listScrollAnimationFrameRef.current !== null) {
      return;
    }

    listScrollAnimationFrameRef.current = window.requestAnimationFrame(() => {
      listScrollAnimationFrameRef.current = null;
      const pendingScrollTop = pendingListScrollTopRef.current;
      pendingListScrollTopRef.current = null;
      if (pendingScrollTop !== null) {
        setListScrollTop((currentScrollTop) => (
          currentScrollTop === pendingScrollTop ? currentScrollTop : pendingScrollTop
        ));
      }
    });
  }, []);

  React.useEffect(() => {
    const container = listScrollRef.current;
    if (!container) {
      return;
    }

    const syncViewport = () => {
      setListViewportHeight(container.clientHeight);
      setListScrollTop(container.scrollTop);
    };

    syncViewport();

    const resizeObserver = new ResizeObserver(() => {
      syncViewport();
    });
    resizeObserver.observe(container);
    return () => {
      if (listScrollAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(listScrollAnimationFrameRef.current);
        listScrollAnimationFrameRef.current = null;
      }
      resizeObserver.disconnect();
    };
  }, []);

  const visibleEntries = React.useMemo(() => getWindowedListSlice({
    items: entries,
    scrollTop: listScrollTop,
    viewportHeight: listViewportHeight,
    rowHeight: CODE_PANE_EXTERNAL_CHANGE_ROW_HEIGHT,
    overscan: CODE_PANE_EXTERNAL_CHANGE_ROW_OVERSCAN,
    threshold: CODE_PANE_EXTERNAL_CHANGE_WINDOWING_THRESHOLD,
  }), [entries, listScrollTop, listViewportHeight]);

  return (
    <div className="flex h-full min-h-0 flex-col border-t border-[rgb(var(--border))]" style={CODE_PANE_ROOT_SURFACE_STYLE}>
      <div className="flex items-center justify-between gap-3 border-b border-[rgb(var(--border))] px-3 py-2">
        <div className="flex min-w-0 items-center gap-3">
          <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-[rgb(var(--muted-foreground))]">
            {t('codePane.externalChangesTab')}
          </div>
          <div className="truncate text-xs text-[rgb(var(--muted-foreground))]">
            {t('codePane.externalChangesSubtitle', { count: entries.length })}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={entries.length === 0}
            onClick={onClearAll}
            className="rounded border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--secondary))_74%,transparent)] px-2 py-1 text-[11px] text-[rgb(var(--foreground))] transition-colors hover:border-[rgb(var(--ring))] hover:bg-[rgb(var(--accent))] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t('codePane.externalChangeClearAll')}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--secondary))_74%,transparent)] p-1 text-[rgb(var(--muted-foreground))] transition-colors hover:border-[rgb(var(--ring))] hover:bg-[rgb(var(--accent))] hover:text-[rgb(var(--foreground))]"
            aria-label={t('codePane.bottomPanelClose')}
          >
            <X size={12} />
          </button>
        </div>
      </div>
      {entries.length > 0 ? (
        <div className="grid min-h-0 flex-1 md:grid-cols-[360px_minmax(0,1fr)]">
          <section
            ref={listScrollRef}
            className="min-h-0 overflow-auto border-r border-[rgb(var(--border))] px-2 py-2"
            onScroll={(event) => {
              scheduleListScrollTopUpdate(event.currentTarget.scrollTop);
            }}
          >
            {visibleEntries.isWindowed ? (
              <div style={{ height: `${visibleEntries.totalHeight}px`, position: 'relative' }}>
                <div style={{ transform: `translateY(${visibleEntries.offsetTop}px)` }}>
                  {visibleEntries.items.map((entry) => (
                    <ExternalChangeEntryRow
                      key={entry.id}
                      entry={entry}
                      isSelected={selectedEntry?.filePath === entry.filePath}
                      changeLabel={entry.changeType === 'added'
                        ? t('codePane.externalChangeAdded')
                        : entry.changeType === 'deleted'
                          ? t('codePane.externalChangeDeleted')
                          : t('codePane.externalChangeModified')}
                      openedLabel={t('codePane.externalChangeOpened')}
                      onSelectEntry={onSelectEntry}
                      onOpenDiff={onOpenDiff}
                    />
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-1">
                {entries.map((entry) => (
                  <ExternalChangeEntryRow
                    key={entry.id}
                    entry={entry}
                    isSelected={selectedEntry?.filePath === entry.filePath}
                    changeLabel={entry.changeType === 'added'
                      ? t('codePane.externalChangeAdded')
                      : entry.changeType === 'deleted'
                        ? t('codePane.externalChangeDeleted')
                        : t('codePane.externalChangeModified')}
                    openedLabel={t('codePane.externalChangeOpened')}
                    onSelectEntry={onSelectEntry}
                    onOpenDiff={onOpenDiff}
                  />
                ))}
              </div>
            )}
          </section>
          <section className="flex min-h-0 flex-col px-3 py-3">
            {selectedEntry ? (
              <ExternalChangeDetailPanel
                entry={selectedEntry}
                t={t}
                onOpenDiff={onOpenDiff}
                onClearEntry={onClearEntry}
              />
            ) : (
              <div className="text-xs text-[rgb(var(--muted-foreground))]">{t('codePane.externalChangesEmpty')}</div>
            )}
          </section>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-xs text-[rgb(var(--muted-foreground))]">
          {t('codePane.externalChangesEmpty')}
        </div>
      )}
    </div>
  );
});

function getProblemTone(severity: number, t: ReturnType<typeof useI18n>['t']): {
  label: string;
  className: string;
} {
  if (severity >= 8) {
    return { label: t('codePane.problemSeverityError'), className: 'border border-[rgb(var(--error))/0.30] bg-[rgb(var(--error))/0.08] text-[rgb(var(--error))]' };
  }
  if (severity >= 4) {
    return { label: t('codePane.problemSeverityWarning'), className: 'border border-[rgb(var(--warning))/0.30] bg-[rgb(var(--warning))/0.08] text-[rgb(var(--warning))]' };
  }
  if (severity >= 2) {
    return { label: t('codePane.problemSeverityInfo'), className: 'border border-[rgb(var(--info))/0.30] bg-[rgb(var(--info))/0.08] text-[rgb(var(--info))]' };
  }
  return { label: t('codePane.problemSeverityHint'), className: 'border border-[rgb(var(--success))/0.30] bg-[rgb(var(--success))/0.08] text-[rgb(var(--success))]' };
}

function normalizeDefinitionLookupPositionForModel(model: MonacoModel, lineNumber: number, column: number) {
  const candidateColumns = [
    column,
    column - 1,
    column + 1,
  ];
  const seenColumns = new Set<number>();

  for (const candidateColumn of candidateColumns) {
    const normalizedColumn = Math.max(1, candidateColumn);
    if (seenColumns.has(normalizedColumn)) {
      continue;
    }
    seenColumns.add(normalizedColumn);

    const word = model.getWordAtPosition?.({ lineNumber, column: normalizedColumn });
    if (!word) {
      continue;
    }

    const endInsideWordColumn = Math.max(word.startColumn, word.endColumn - 1);
    return {
      lineNumber,
      column: Math.min(Math.max(normalizedColumn, word.startColumn), endInsideWordColumn),
    };
  }

  return { lineNumber, column: Math.max(1, column) };
}

function compareTextEditsDescending(left: CodePaneTextEdit, right: CodePaneTextEdit): number {
  if (left.range.startLineNumber !== right.range.startLineNumber) {
    return right.range.startLineNumber - left.range.startLineNumber;
  }
  if (left.range.startColumn !== right.range.startColumn) {
    return right.range.startColumn - left.range.startColumn;
  }
  if (left.range.endLineNumber !== right.range.endLineNumber) {
    return right.range.endLineNumber - left.range.endLineNumber;
  }
  return right.range.endColumn - left.range.endColumn;
}

function getTextOffset(content: string, lineNumber: number, column: number): number {
  const normalizedLineNumber = Math.max(lineNumber, 1);
  const lines = content.split('\n');
  let offset = 0;

  for (let index = 0; index < normalizedLineNumber - 1; index += 1) {
    offset += (lines[index] ?? '').length + 1;
  }

  const lineContent = lines[normalizedLineNumber - 1] ?? '';
  return offset + Math.min(Math.max(column - 1, 0), lineContent.length);
}

function applyTextEditsToContent(content: string, edits: CodePaneTextEdit[]): string {
  return [...edits]
    .sort(compareTextEditsDescending)
    .reduce((currentContent, edit) => {
      const startOffset = getTextOffset(
        currentContent,
        edit.range.startLineNumber,
        edit.range.startColumn,
      );
      const endOffset = getTextOffset(
        currentContent,
        edit.range.endLineNumber,
        edit.range.endColumn,
      );
      return `${currentContent.slice(0, startOffset)}${edit.newText}${currentContent.slice(endOffset)}`;
    }, content);
}

function applyTextEditsToModel(model: MonacoModel, edits: CodePaneTextEdit[]): boolean {
  if (edits.length === 0) {
    return false;
  }

  const editModel = model as MonacoModel & {
    pushEditOperations?: (
      beforeCursorState: unknown[],
      editOperations: Array<{ range: CodePaneRange; text: string; forceMoveMarkers?: boolean }>,
      cursorStateComputer: () => null,
    ) => unknown;
    setValue: (value: string) => void;
    getValue: () => string;
  };
  if (typeof editModel.pushEditOperations === 'function') {
    editModel.pushEditOperations(
      [],
      edits.map((edit) => ({
        range: edit.range,
        text: edit.newText,
        forceMoveMarkers: true,
      })),
      () => null,
    );
    return true;
  }

  editModel.setValue(applyTextEditsToContent(editModel.getValue(), edits));
  return true;
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) {
    return;
  }

  const workerCount = Math.max(1, Math.min(limit, items.length));
  let nextIndex = 0;
  const workers: Array<Promise<void>> = [];

  for (let workerIndex = 0; workerIndex < workerCount; workerIndex += 1) {
    workers.push((async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        await task(items[currentIndex]!);
      }
    })());
  }

  await Promise.all(workers);
}

function isRefactorCodeAction(action: CodePaneCodeAction): boolean {
  const normalizedKind = action.kind?.toLowerCase() ?? '';
  const normalizedTitle = action.title.toLowerCase();
  return normalizedKind.startsWith('refactor')
    || normalizedTitle.includes('extract')
    || normalizedTitle.includes('inline')
    || normalizedTitle.includes('change signature')
    || normalizedTitle.includes('safe delete')
    || normalizedTitle.includes('move');
}

function getGitStatusEntryKey(entry: CodePaneGitStatusEntry): string {
  return `${entry.path}:${entry.status}:${entry.staged ? 1 : 0}:${entry.unstaged ? 1 : 0}:${entry.conflicted ? 1 : 0}:${entry.section}:${entry.originalPath ?? ''}`;
}

function getGitStatusDerivedSnapshot(entries: CodePaneGitStatusEntry[]): GitStatusDerivedSnapshot {
  const cachedSnapshot = gitStatusDerivedSnapshotCache.get(entries);
  if (cachedSnapshot) {
    return cachedSnapshot;
  }

  if (entries.length === 0) {
    gitStatusDerivedSnapshotCache.set(entries, emptyGitStatusDerivedSnapshot);
    return emptyGitStatusDerivedSnapshot;
  }

  const entriesByPath: Record<string, CodePaneGitStatusEntry> = {};
  const keyParts: string[] = [];
  for (const entry of entries) {
    entriesByPath[entry.path] = entry;
    keyParts.push(getGitStatusEntryKey(entry));
  }

  const snapshot: GitStatusDerivedSnapshot = {
    directoryStatusByPathByRoot: new Map(),
    entriesByPath,
    key: keyParts.join('\u0000'),
  };
  gitStatusDerivedSnapshotCache.set(entries, snapshot);
  return snapshot;
}

function mapGitStatusEntriesByPath(
  entries: CodePaneGitStatusEntry[],
): Record<string, CodePaneGitStatusEntry> {
  return getGitStatusDerivedSnapshot(entries).entriesByPath;
}

function getGitStatusEntriesKey(entries: CodePaneGitStatusEntry[]): string {
  return getGitStatusDerivedSnapshot(entries).key;
}

function areGitStatusEntriesEqual(
  previousEntries: CodePaneGitStatusEntry[],
  nextEntries: CodePaneGitStatusEntry[],
): boolean {
  if (previousEntries.length !== nextEntries.length) {
    return false;
  }

  for (let index = 0; index < previousEntries.length; index += 1) {
    const previousEntry = previousEntries[index];
    const nextEntry = nextEntries[index];
    if (
      previousEntry?.path !== nextEntry?.path
      || previousEntry?.status !== nextEntry?.status
      || previousEntry?.staged !== nextEntry?.staged
      || previousEntry?.unstaged !== nextEntry?.unstaged
      || previousEntry?.conflicted !== nextEntry?.conflicted
      || previousEntry?.section !== nextEntry?.section
      || previousEntry?.originalPath !== nextEntry?.originalPath
    ) {
      return false;
    }
  }

  return true;
}

function areGitRepositorySummariesEqual(
  previousSummary: CodePaneGitRepositorySummary | null,
  nextSummary: CodePaneGitRepositorySummary | null,
): boolean {
  if (previousSummary === nextSummary) {
    return true;
  }

  if (!previousSummary || !nextSummary) {
    return false;
  }

  return previousSummary.repoRootPath === nextSummary.repoRootPath
    && previousSummary.currentBranch === nextSummary.currentBranch
    && previousSummary.upstreamBranch === nextSummary.upstreamBranch
    && previousSummary.detachedHead === nextSummary.detachedHead
    && previousSummary.headSha === nextSummary.headSha
    && previousSummary.aheadCount === nextSummary.aheadCount
    && previousSummary.behindCount === nextSummary.behindCount
    && previousSummary.operation === nextSummary.operation
    && previousSummary.hasConflicts === nextSummary.hasConflicts;
}

function areGitGraphCommitsEqual(
  previousGraph: CodePaneGitGraphCommit[],
  nextGraph: CodePaneGitGraphCommit[],
): boolean {
  if (previousGraph.length !== nextGraph.length) {
    return false;
  }

  for (let index = 0; index < previousGraph.length; index += 1) {
    const previousCommit = previousGraph[index];
    const nextCommit = nextGraph[index];
    if (
      previousCommit?.sha !== nextCommit?.sha
      || previousCommit?.shortSha !== nextCommit?.shortSha
      || previousCommit?.subject !== nextCommit?.subject
      || previousCommit?.author !== nextCommit?.author
      || previousCommit?.timestamp !== nextCommit?.timestamp
      || previousCommit?.isHead !== nextCommit?.isHead
      || previousCommit?.isMergeCommit !== nextCommit?.isMergeCommit
      || previousCommit?.lane !== nextCommit?.lane
      || previousCommit?.laneCount !== nextCommit?.laneCount
      || previousCommit?.parents.length !== nextCommit?.parents.length
      || previousCommit?.refs.length !== nextCommit?.refs.length
    ) {
      return false;
    }

    for (let parentIndex = 0; parentIndex < previousCommit.parents.length; parentIndex += 1) {
      if (previousCommit.parents[parentIndex] !== nextCommit.parents[parentIndex]) {
        return false;
      }
    }

    for (let refIndex = 0; refIndex < previousCommit.refs.length; refIndex += 1) {
      if (previousCommit.refs[refIndex] !== nextCommit.refs[refIndex]) {
        return false;
      }
    }
  }

  return true;
}

function areGitDiffHunkLinesEqual(
  previousLines: CodePaneGitDiffHunk['lines'],
  nextLines: CodePaneGitDiffHunk['lines'],
): boolean {
  if (previousLines.length !== nextLines.length) {
    return false;
  }

  for (let index = 0; index < previousLines.length; index += 1) {
    const previousLine = previousLines[index];
    const nextLine = nextLines[index];
    if (
      previousLine?.type !== nextLine?.type
      || previousLine?.text !== nextLine?.text
      || previousLine?.oldLineNumber !== nextLine?.oldLineNumber
      || previousLine?.newLineNumber !== nextLine?.newLineNumber
    ) {
      return false;
    }
  }

  return true;
}

function areGitDiffHunksEqual(
  previousHunks: CodePaneGitDiffHunk[],
  nextHunks: CodePaneGitDiffHunk[],
): boolean {
  if (previousHunks.length !== nextHunks.length) {
    return false;
  }

  for (let index = 0; index < previousHunks.length; index += 1) {
    const previousHunk = previousHunks[index];
    const nextHunk = nextHunks[index];
    if (
      previousHunk?.id !== nextHunk?.id
      || previousHunk?.filePath !== nextHunk?.filePath
      || previousHunk?.staged !== nextHunk?.staged
      || previousHunk?.header !== nextHunk?.header
      || previousHunk?.patch !== nextHunk?.patch
      || !areGitDiffHunkLinesEqual(previousHunk?.lines ?? [], nextHunk?.lines ?? [])
    ) {
      return false;
    }
  }

  return true;
}

function areTreeEntriesEqual(
  previousEntries: CodePaneTreeEntry[],
  nextEntries: CodePaneTreeEntry[],
): boolean {
  if (previousEntries.length !== nextEntries.length) {
    return false;
  }

  for (let index = 0; index < previousEntries.length; index += 1) {
    const previousEntry = previousEntries[index];
    const nextEntry = nextEntries[index];
    if (
      previousEntry?.path !== nextEntry?.path
      || previousEntry?.name !== nextEntry?.name
      || previousEntry?.type !== nextEntry?.type
      || previousEntry?.size !== nextEntry?.size
      || previousEntry?.mtimeMs !== nextEntry?.mtimeMs
      || previousEntry?.hasChildren !== nextEntry?.hasChildren
    ) {
      return false;
    }
  }

  return true;
}

function areExternalLibrarySectionsEqual(
  previousSections: CodePaneExternalLibrarySection[],
  nextSections: CodePaneExternalLibrarySection[],
): boolean {
  if (previousSections.length !== nextSections.length) {
    return false;
  }

  for (let index = 0; index < previousSections.length; index += 1) {
    const previousSection = previousSections[index];
    const nextSection = nextSections[index];
    if (
      previousSection?.id !== nextSection?.id
      || previousSection?.label !== nextSection?.label
      || previousSection?.languageId !== nextSection?.languageId
      || previousSection?.roots.length !== nextSection?.roots.length
    ) {
      return false;
    }

    for (let rootIndex = 0; rootIndex < previousSection.roots.length; rootIndex += 1) {
      const previousRoot = previousSection.roots[rootIndex];
      const nextRoot = nextSection.roots[rootIndex];
      if (
        previousRoot?.id !== nextRoot?.id
        || previousRoot?.label !== nextRoot?.label
        || previousRoot?.path !== nextRoot?.path
        || previousRoot?.description !== nextRoot?.description
      ) {
        return false;
      }
    }
  }

  return true;
}

function areGitBranchesEqual(
  previousBranches: CodePaneGitBranchEntry[],
  nextBranches: CodePaneGitBranchEntry[],
): boolean {
  if (previousBranches.length !== nextBranches.length) {
    return false;
  }

  for (let index = 0; index < previousBranches.length; index += 1) {
    const previousBranch = previousBranches[index];
    const nextBranch = nextBranches[index];
    if (
      previousBranch?.name !== nextBranch?.name
      || previousBranch?.refName !== nextBranch?.refName
      || previousBranch?.shortName !== nextBranch?.shortName
      || previousBranch?.kind !== nextBranch?.kind
      || previousBranch?.current !== nextBranch?.current
      || previousBranch?.upstream !== nextBranch?.upstream
      || previousBranch?.aheadCount !== nextBranch?.aheadCount
      || previousBranch?.behindCount !== nextBranch?.behindCount
      || previousBranch?.commitSha !== nextBranch?.commitSha
      || previousBranch?.shortSha !== nextBranch?.shortSha
      || previousBranch?.subject !== nextBranch?.subject
      || previousBranch?.timestamp !== nextBranch?.timestamp
      || previousBranch?.mergedIntoCurrent !== nextBranch?.mergedIntoCurrent
    ) {
      return false;
    }
  }

  return true;
}

function collectExternalRootPaths(
  sections: CodePaneExternalLibrarySection[],
): string[] {
  const rootPaths: string[] = [];
  for (const section of sections) {
    for (const root of section.roots) {
      rootPaths.push(root.path);
    }
  }
  return rootPaths;
}

function areCodePaneLayoutSidebarsEqual(
  previousSidebar: NonNullable<NonNullable<CodePaneState['layout']>['sidebar']>,
  nextSidebar: NonNullable<NonNullable<CodePaneState['layout']>['sidebar']>,
): boolean {
  return previousSidebar.visible === nextSidebar.visible
    && previousSidebar.activeView === nextSidebar.activeView
    && previousSidebar.width === nextSidebar.width
    && (previousSidebar.lastExpandedWidth ?? previousSidebar.width) === (nextSidebar.lastExpandedWidth ?? nextSidebar.width);
}

function areCodePaneEditorSplitLayoutsEqual(
  previousLayout: NonNullable<NonNullable<NonNullable<CodePaneState['layout']>['editorSplit']>>,
  nextLayout: NonNullable<NonNullable<NonNullable<CodePaneState['layout']>['editorSplit']>>,
): boolean {
  return previousLayout.visible === nextLayout.visible
    && previousLayout.size === nextLayout.size
    && (previousLayout.secondaryFilePath ?? null) === (nextLayout.secondaryFilePath ?? null);
}

function areCodePaneBottomPanelLayoutsEqual(
  previousLayout: NonNullable<NonNullable<NonNullable<CodePaneState['layout']>['bottomPanel']>>,
  nextLayout: NonNullable<NonNullable<NonNullable<CodePaneState['layout']>['bottomPanel']>>,
): boolean {
  return previousLayout.height === nextLayout.height;
}

function areRunTargetCustomizationsEqual(
  previousCustomization: CodePaneRunTargetCustomization,
  nextCustomization: CodePaneRunTargetCustomization,
): boolean {
  return previousCustomization.profiles === nextCustomization.profiles
    && previousCustomization.programArgs === nextCustomization.programArgs
    && previousCustomization.vmArgs === nextCustomization.vmArgs;
}

function areCodePaneDebugStatesEqual(
  previousState: NonNullable<CodePaneState['debug']>,
  nextState: NonNullable<CodePaneState['debug']>,
): boolean {
  return areStringListsEqual(previousState.watchExpressions ?? [], nextState.watchExpressions ?? [])
    && areExceptionBreakpointsEqual(
      previousState.exceptionBreakpoints ?? [],
      nextState.exceptionBreakpoints ?? [],
    );
}

function getModelVersionId(model: MonacoModel): number {
  const versionGetter = (model as MonacoModel & {
    getAlternativeVersionId?: () => number;
    getVersionId?: () => number;
  }).getAlternativeVersionId ?? (model as MonacoModel & {
    getVersionId?: () => number;
  }).getVersionId;

  if (!versionGetter) {
    return model.getValue().length;
  }

  const versionId = versionGetter.call(model);
  return Number.isFinite(versionId) ? versionId : model.getValue().length;
}

function areEditorSurfaceBindingStatesEqual(
  previousState: EditorSurfaceBindingState | null,
  nextState: EditorSurfaceBindingState,
): boolean {
  if (!previousState) {
    return false;
  }

  return previousState.mode === nextState.mode
    && previousState.activeFilePath === nextState.activeFilePath
    && previousState.secondaryFilePath === nextState.secondaryFilePath
    && previousState.diffRequestKey === nextState.diffRequestKey
    && previousState.readonlyPrimary === nextState.readonlyPrimary
    && previousState.readonlySecondary === nextState.readonlySecondary;
}

function shouldFocusEditorSurface(editorElement: HTMLElement | null | undefined): boolean {
  if (!editorElement) {
    return false;
  }

  const activeElement = document.activeElement;
  return !(activeElement instanceof Node) || !editorElement.contains(activeElement);
}

function hasCodePaneStateUpdates(
  currentState: CodePaneState,
  updates: Partial<CodePaneState>,
): boolean {
  const updateKeys = Object.keys(updates) as Array<keyof CodePaneState>;
  for (const key of updateKeys) {
    switch (key) {
      case 'rootPath':
        if (currentState.rootPath !== updates.rootPath) {
          return true;
        }
        break;
      case 'openFiles':
        if (!areOpenFilesEqual(currentState.openFiles, updates.openFiles ?? [])) {
          return true;
        }
        break;
      case 'activeFilePath':
        if ((currentState.activeFilePath ?? null) !== (updates.activeFilePath ?? null)) {
          return true;
        }
        break;
      case 'selectedPath':
        if ((currentState.selectedPath ?? null) !== (updates.selectedPath ?? null)) {
          return true;
        }
        break;
      case 'expandedPaths':
        if (!areStringArraysEqual(currentState.expandedPaths ?? [currentState.rootPath], updates.expandedPaths ?? [currentState.rootPath])) {
          return true;
        }
        break;
      case 'viewMode':
        if ((currentState.viewMode ?? 'editor') !== (updates.viewMode ?? 'editor')) {
          return true;
        }
        break;
      case 'diffTargetPath':
        if ((currentState.diffTargetPath ?? null) !== (updates.diffTargetPath ?? null)) {
          return true;
        }
        break;
      case 'runConfigurations':
        if (!areRunTargetConfigurationsEqual(currentState.runConfigurations, updates.runConfigurations)) {
          return true;
        }
        break;
      case 'bookmarks':
        if (!areCodePaneBookmarksEqual(currentState.bookmarks, updates.bookmarks)) {
          return true;
        }
        break;
      case 'breakpoints':
        if (!arePersistedBreakpointsEqual(currentState.breakpoints, updates.breakpoints)) {
          return true;
        }
        break;
      case 'debug':
        if (!areCodePaneDebugStatesEqual(currentState.debug ?? {}, updates.debug ?? {})) {
          return true;
        }
        break;
      case 'layout':
        if (!updates.layout) {
          if (currentState.layout) {
            return true;
          }
          break;
        }
        if (
          !areCodePaneLayoutSidebarsEqual(
            currentState.layout?.sidebar ?? {
              visible: true,
              activeView: 'files',
              width: CODE_PANE_SIDEBAR_DEFAULT_WIDTH,
              lastExpandedWidth: CODE_PANE_SIDEBAR_DEFAULT_WIDTH,
            },
            updates.layout.sidebar ?? {
              visible: true,
              activeView: 'files',
              width: CODE_PANE_SIDEBAR_DEFAULT_WIDTH,
              lastExpandedWidth: CODE_PANE_SIDEBAR_DEFAULT_WIDTH,
            },
          )
          || !areCodePaneBottomPanelLayoutsEqual(
            currentState.layout?.bottomPanel ?? { height: CODE_PANE_BOTTOM_PANEL_DEFAULT_HEIGHT },
            updates.layout.bottomPanel ?? { height: CODE_PANE_BOTTOM_PANEL_DEFAULT_HEIGHT },
          )
          || !areCodePaneEditorSplitLayoutsEqual(
            currentState.layout?.editorSplit ?? {
              visible: false,
              size: CODE_PANE_EDITOR_SPLIT_DEFAULT_SIZE,
              secondaryFilePath: null,
            },
            updates.layout.editorSplit ?? {
              visible: false,
              size: CODE_PANE_EDITOR_SPLIT_DEFAULT_SIZE,
              secondaryFilePath: null,
            },
          )
        ) {
          return true;
        }
        break;
      case 'savePipeline':
        if (
          (currentState.savePipeline?.formatOnSave ?? false) !== (updates.savePipeline?.formatOnSave ?? false)
          || (currentState.savePipeline?.organizeImportsOnSave ?? false) !== (updates.savePipeline?.organizeImportsOnSave ?? false)
          || (currentState.savePipeline?.lintOnSave ?? false) !== (updates.savePipeline?.lintOnSave ?? false)
        ) {
          return true;
        }
        break;
      case 'qualityGate':
        if (currentState.qualityGate !== updates.qualityGate) {
          return true;
        }
        break;
      default:
        if (currentState[key] !== updates[key]) {
          return true;
        }
        break;
    }
  }

  return false;
}

function areStringListsEqual(previousList: string[], nextList: string[]): boolean {
  if (previousList.length !== nextList.length) {
    return false;
  }

  for (let index = 0; index < previousList.length; index += 1) {
    if (previousList[index] !== nextList[index]) {
      return false;
    }
  }

  return true;
}

function areContentMatchListsEqual(
  previousList: CodePaneContentMatch[],
  nextList: CodePaneContentMatch[],
): boolean {
  if (previousList.length !== nextList.length) {
    return false;
  }

  for (let index = 0; index < previousList.length; index += 1) {
    const previousMatch = previousList[index];
    const nextMatch = nextList[index];
    if (
      previousMatch?.filePath !== nextMatch?.filePath
      || previousMatch?.lineNumber !== nextMatch?.lineNumber
      || previousMatch?.column !== nextMatch?.column
      || previousMatch?.lineText !== nextMatch?.lineText
    ) {
      return false;
    }
  }

  return true;
}

function areTodoItemListsEqual(
  previousList: CodePaneTodoItem[],
  nextList: CodePaneTodoItem[],
): boolean {
  if (previousList.length !== nextList.length) {
    return false;
  }

  for (let index = 0; index < previousList.length; index += 1) {
    const previousItem = previousList[index];
    const nextItem = nextList[index];
    if (
      previousItem?.token !== nextItem?.token
      || previousItem?.filePath !== nextItem?.filePath
      || previousItem?.lineNumber !== nextItem?.lineNumber
      || previousItem?.column !== nextItem?.column
      || previousItem?.lineText !== nextItem?.lineText
    ) {
      return false;
    }
  }

  return true;
}

function areProblemListsEqual(
  previousList: Array<MonacoMarker & { filePath: string }>,
  nextList: Array<MonacoMarker & { filePath: string }>,
): boolean {
  if (previousList.length !== nextList.length) {
    return false;
  }

  for (let index = 0; index < previousList.length; index += 1) {
    const previousProblem = previousList[index];
    const nextProblem = nextList[index];
    if (
      previousProblem?.filePath !== nextProblem?.filePath
      || previousProblem?.severity !== nextProblem?.severity
      || previousProblem?.message !== nextProblem?.message
      || previousProblem?.startLineNumber !== nextProblem?.startLineNumber
      || previousProblem?.startColumn !== nextProblem?.startColumn
      || previousProblem?.endLineNumber !== nextProblem?.endLineNumber
      || previousProblem?.endColumn !== nextProblem?.endColumn
      || previousProblem?.source !== nextProblem?.source
      || previousProblem?.code !== nextProblem?.code
    ) {
      return false;
    }
  }

  return true;
}

function areWorkspaceSymbolListsEqual(
  previousList: CodePaneWorkspaceSymbol[],
  nextList: CodePaneWorkspaceSymbol[],
): boolean {
  if (previousList.length !== nextList.length) {
    return false;
  }

  for (let index = 0; index < previousList.length; index += 1) {
    const previousSymbol = previousList[index];
    const nextSymbol = nextList[index];
    if (
      previousSymbol?.name !== nextSymbol?.name
      || previousSymbol?.kind !== nextSymbol?.kind
      || previousSymbol?.filePath !== nextSymbol?.filePath
      || previousSymbol?.containerName !== nextSymbol?.containerName
      || previousSymbol?.detail !== nextSymbol?.detail
      || previousSymbol?.range.startLineNumber !== nextSymbol?.range.startLineNumber
      || previousSymbol?.range.startColumn !== nextSymbol?.range.startColumn
      || previousSymbol?.range.endLineNumber !== nextSymbol?.range.endLineNumber
      || previousSymbol?.range.endColumn !== nextSymbol?.range.endColumn
    ) {
      return false;
    }
  }

  return true;
}

function areRangesEqual(previousRange?: CodePaneRange | null, nextRange?: CodePaneRange | null): boolean {
  if (previousRange === nextRange) {
    return true;
  }

  if (!previousRange || !nextRange) {
    return false;
  }

  return previousRange.startLineNumber === nextRange.startLineNumber
    && previousRange.startColumn === nextRange.startColumn
    && previousRange.endLineNumber === nextRange.endLineNumber
    && previousRange.endColumn === nextRange.endColumn;
}

function areDocumentSymbolsEqual(
  previousSymbol?: CodePaneDocumentSymbol | null,
  nextSymbol?: CodePaneDocumentSymbol | null,
): boolean {
  if (previousSymbol === nextSymbol) {
    return true;
  }

  if (!previousSymbol || !nextSymbol) {
    return false;
  }

  return previousSymbol.name === nextSymbol.name
    && previousSymbol.detail === nextSymbol.detail
    && previousSymbol.kind === nextSymbol.kind
    && areRangesEqual(previousSymbol.range, nextSymbol.range)
    && areRangesEqual(previousSymbol.selectionRange, nextSymbol.selectionRange)
    && areDocumentSymbolListsEqual(previousSymbol.children ?? [], nextSymbol.children ?? []);
}

function areDocumentSymbolListsEqual(
  previousList: CodePaneDocumentSymbol[],
  nextList: CodePaneDocumentSymbol[],
): boolean {
  if (previousList.length !== nextList.length) {
    return false;
  }

  for (let index = 0; index < previousList.length; index += 1) {
    if (!areDocumentSymbolsEqual(previousList[index], nextList[index])) {
      return false;
    }
  }

  return true;
}

function areTestItemsEqual(previousItem?: CodePaneTestItem | null, nextItem?: CodePaneTestItem | null): boolean {
  if (previousItem === nextItem) {
    return true;
  }

  if (!previousItem || !nextItem) {
    return false;
  }

  return previousItem.id === nextItem.id
    && previousItem.label === nextItem.label
    && previousItem.kind === nextItem.kind
    && previousItem.filePath === nextItem.filePath
    && previousItem.runnableTargetId === nextItem.runnableTargetId
    && areTestItemListsEqual(previousItem.children ?? [], nextItem.children ?? []);
}

function areTestItemListsEqual(previousList: CodePaneTestItem[], nextList: CodePaneTestItem[]): boolean {
  if (previousList.length !== nextList.length) {
    return false;
  }

  for (let index = 0; index < previousList.length; index += 1) {
    if (!areTestItemsEqual(previousList[index], nextList[index])) {
      return false;
    }
  }

  return true;
}

function areProjectStatusItemListsEqual(
  previousItems: CodePaneProjectStatusItem[],
  nextItems: CodePaneProjectStatusItem[],
): boolean {
  if (previousItems.length !== nextItems.length) {
    return false;
  }

  for (let index = 0; index < previousItems.length; index += 1) {
    const previousItem = previousItems[index];
    const nextItem = nextItems[index];
    if (
      previousItem?.id !== nextItem?.id
      || previousItem?.label !== nextItem?.label
      || previousItem?.tone !== nextItem?.tone
    ) {
      return false;
    }
  }

  return true;
}

function areProjectDiagnosticListsEqual(
  previousDiagnostics: CodePaneProjectDiagnostic[],
  nextDiagnostics: CodePaneProjectDiagnostic[],
): boolean {
  if (previousDiagnostics.length !== nextDiagnostics.length) {
    return false;
  }

  for (let index = 0; index < previousDiagnostics.length; index += 1) {
    const previousDiagnostic = previousDiagnostics[index];
    const nextDiagnostic = nextDiagnostics[index];
    if (
      previousDiagnostic?.id !== nextDiagnostic?.id
      || previousDiagnostic?.severity !== nextDiagnostic?.severity
      || previousDiagnostic?.message !== nextDiagnostic?.message
      || previousDiagnostic?.detail !== nextDiagnostic?.detail
      || previousDiagnostic?.filePath !== nextDiagnostic?.filePath
      || previousDiagnostic?.lineNumber !== nextDiagnostic?.lineNumber
      || previousDiagnostic?.commandId !== nextDiagnostic?.commandId
      || previousDiagnostic?.commandLabel !== nextDiagnostic?.commandLabel
    ) {
      return false;
    }
  }

  return true;
}

function areProjectCommandListsEqual(
  previousCommands: CodePaneProjectCommand[],
  nextCommands: CodePaneProjectCommand[],
): boolean {
  if (previousCommands.length !== nextCommands.length) {
    return false;
  }

  for (let index = 0; index < previousCommands.length; index += 1) {
    const previousCommand = previousCommands[index];
    const nextCommand = nextCommands[index];
    if (
      previousCommand?.id !== nextCommand?.id
      || previousCommand?.title !== nextCommand?.title
      || previousCommand?.detail !== nextCommand?.detail
      || previousCommand?.kind !== nextCommand?.kind
    ) {
      return false;
    }
  }

  return true;
}

function areProjectCommandGroupListsEqual(
  previousGroups: CodePaneProjectCommandGroup[],
  nextGroups: CodePaneProjectCommandGroup[],
): boolean {
  if (previousGroups.length !== nextGroups.length) {
    return false;
  }

  for (let index = 0; index < previousGroups.length; index += 1) {
    const previousGroup = previousGroups[index];
    const nextGroup = nextGroups[index];
    if (
      previousGroup?.id !== nextGroup?.id
      || previousGroup?.title !== nextGroup?.title
      || !areProjectCommandListsEqual(previousGroup?.commands ?? [], nextGroup?.commands ?? [])
    ) {
      return false;
    }
  }

  return true;
}

function areProjectDetailCardListsEqual(
  previousCards: CodePaneProjectDetailCard[],
  nextCards: CodePaneProjectDetailCard[],
): boolean {
  if (previousCards.length !== nextCards.length) {
    return false;
  }

  for (let index = 0; index < previousCards.length; index += 1) {
    const previousCard = previousCards[index];
    const nextCard = nextCards[index];
    if (
      previousCard?.id !== nextCard?.id
      || previousCard?.title !== nextCard?.title
      || !areStringListsEqual(previousCard?.lines ?? [], nextCard?.lines ?? [])
    ) {
      return false;
    }
  }

  return true;
}

function areProjectTreeItemsEqual(
  previousItem?: CodePaneProjectTreeItem | null,
  nextItem?: CodePaneProjectTreeItem | null,
): boolean {
  if (previousItem === nextItem) {
    return true;
  }

  if (!previousItem || !nextItem) {
    return false;
  }

  return previousItem.id === nextItem.id
    && previousItem.label === nextItem.label
    && previousItem.kind === nextItem.kind
    && previousItem.description === nextItem.description
    && previousItem.filePath === nextItem.filePath
    && previousItem.lineNumber === nextItem.lineNumber
    && previousItem.column === nextItem.column
    && areProjectTreeItemListsEqual(previousItem.children ?? [], nextItem.children ?? []);
}

function areProjectTreeItemListsEqual(
  previousItems: CodePaneProjectTreeItem[],
  nextItems: CodePaneProjectTreeItem[],
): boolean {
  if (previousItems.length !== nextItems.length) {
    return false;
  }

  for (let index = 0; index < previousItems.length; index += 1) {
    if (!areProjectTreeItemsEqual(previousItems[index], nextItems[index])) {
      return false;
    }
  }

  return true;
}

function areProjectTreeSectionListsEqual(
  previousSections: CodePaneProjectTreeSection[],
  nextSections: CodePaneProjectTreeSection[],
): boolean {
  if (previousSections.length !== nextSections.length) {
    return false;
  }

  for (let index = 0; index < previousSections.length; index += 1) {
    const previousSection = previousSections[index];
    const nextSection = nextSections[index];
    if (
      previousSection?.id !== nextSection?.id
      || previousSection?.title !== nextSection?.title
      || !areProjectTreeItemListsEqual(previousSection?.items ?? [], nextSection?.items ?? [])
    ) {
      return false;
    }
  }

  return true;
}

function areProjectContributionListsEqual(
  previousContributions: CodePaneProjectContribution[],
  nextContributions: CodePaneProjectContribution[],
): boolean {
  if (previousContributions.length !== nextContributions.length) {
    return false;
  }

  for (let index = 0; index < previousContributions.length; index += 1) {
    const previousContribution = previousContributions[index];
    const nextContribution = nextContributions[index];
    if (
      previousContribution?.id !== nextContribution?.id
      || previousContribution?.title !== nextContribution?.title
      || previousContribution?.languageId !== nextContribution?.languageId
      || !areProjectStatusItemListsEqual(
        previousContribution?.statusItems ?? [],
        nextContribution?.statusItems ?? [],
      )
      || !areProjectDiagnosticListsEqual(
        previousContribution?.diagnostics ?? [],
        nextContribution?.diagnostics ?? [],
      )
      || !areProjectCommandGroupListsEqual(
        previousContribution?.commandGroups ?? [],
        nextContribution?.commandGroups ?? [],
      )
      || !areProjectDetailCardListsEqual(
        previousContribution?.detailCards ?? [],
        nextContribution?.detailCards ?? [],
      )
      || !areProjectTreeSectionListsEqual(
        previousContribution?.treeSections ?? [],
        nextContribution?.treeSections ?? [],
      )
    ) {
      return false;
    }
  }

  return true;
}

function areHoverResultsEqual(
  previousResult: CodePaneHoverResult | null,
  nextResult: CodePaneHoverResult | null,
): boolean {
  if (previousResult === nextResult) {
    return true;
  }

  if (!previousResult || !nextResult) {
    return false;
  }

  if (previousResult.contents.length !== nextResult.contents.length) {
    return false;
  }

  for (let index = 0; index < previousResult.contents.length; index += 1) {
    const previousContent = previousResult.contents[index];
    const nextContent = nextResult.contents[index];
    if (
      previousContent?.kind !== nextContent?.kind
      || previousContent?.value !== nextContent?.value
    ) {
      return false;
    }
  }

  return areRangesEqual(previousResult.range, nextResult.range);
}

function areGitCommitFileChangesEqual(
  previousFiles: CodePaneGitCommitFileChange[],
  nextFiles: CodePaneGitCommitFileChange[],
): boolean {
  if (previousFiles.length !== nextFiles.length) {
    return false;
  }

  for (let index = 0; index < previousFiles.length; index += 1) {
    const previousFile = previousFiles[index];
    const nextFile = nextFiles[index];
    if (
      previousFile?.path !== nextFile?.path
      || previousFile?.relativePath !== nextFile?.relativePath
      || previousFile?.status !== nextFile?.status
      || previousFile?.additions !== nextFile?.additions
      || previousFile?.deletions !== nextFile?.deletions
      || previousFile?.previousPath !== nextFile?.previousPath
    ) {
      return false;
    }
  }

  return true;
}

function areGitCommitDetailsEqual(
  previousDetails: CodePaneGitCommitDetails | null,
  nextDetails: CodePaneGitCommitDetails | null,
): boolean {
  if (previousDetails === nextDetails) {
    return true;
  }

  if (!previousDetails || !nextDetails) {
    return false;
  }

  return previousDetails.commitSha === nextDetails.commitSha
    && previousDetails.shortSha === nextDetails.shortSha
    && previousDetails.subject === nextDetails.subject
    && previousDetails.author === nextDetails.author
    && previousDetails.email === nextDetails.email
    && previousDetails.timestamp === nextDetails.timestamp
    && previousDetails.body === nextDetails.body
    && areStringListsEqual(previousDetails.refs, nextDetails.refs)
    && areGitCommitFileChangesEqual(previousDetails.files, nextDetails.files);
}

function areGitCompareCommitsEqual(
  previousComparison: CodePaneGitCompareCommitsResult | null,
  nextComparison: CodePaneGitCompareCommitsResult | null,
): boolean {
  if (previousComparison === nextComparison) {
    return true;
  }

  if (!previousComparison || !nextComparison) {
    return false;
  }

  return previousComparison.baseCommitSha === nextComparison.baseCommitSha
    && previousComparison.targetCommitSha === nextComparison.targetCommitSha
    && areGitCommitFileChangesEqual(previousComparison.files, nextComparison.files);
}

function areGitRebasePlanEntriesEqual(
  previousEntries: CodePaneGitRebasePlanEntry[],
  nextEntries: CodePaneGitRebasePlanEntry[],
): boolean {
  if (previousEntries.length !== nextEntries.length) {
    return false;
  }

  for (let index = 0; index < previousEntries.length; index += 1) {
    const previousEntry = previousEntries[index];
    const nextEntry = nextEntries[index];
    if (
      previousEntry?.commitSha !== nextEntry?.commitSha
      || previousEntry?.shortSha !== nextEntry?.shortSha
      || previousEntry?.subject !== nextEntry?.subject
      || previousEntry?.author !== nextEntry?.author
      || previousEntry?.timestamp !== nextEntry?.timestamp
      || previousEntry?.action !== nextEntry?.action
    ) {
      return false;
    }
  }

  return true;
}

function areGitRebasePlansEqual(
  previousPlan: CodePaneGitRebasePlanResult | null,
  nextPlan: CodePaneGitRebasePlanResult | null,
): boolean {
  if (previousPlan === nextPlan) {
    return true;
  }

  if (!previousPlan || !nextPlan) {
    return false;
  }

  return previousPlan.baseRef === nextPlan.baseRef
    && previousPlan.currentBranch === nextPlan.currentBranch
    && previousPlan.hasMergeCommits === nextPlan.hasMergeCommits
    && areGitRebasePlanEntriesEqual(previousPlan.commits, nextPlan.commits);
}

function areGitConflictDetailsEqual(
  previousDetails: CodePaneGitConflictDetails | null,
  nextDetails: CodePaneGitConflictDetails | null,
): boolean {
  if (previousDetails === nextDetails) {
    return true;
  }

  if (!previousDetails || !nextDetails) {
    return false;
  }

  return previousDetails.filePath === nextDetails.filePath
    && previousDetails.relativePath === nextDetails.relativePath
    && previousDetails.baseContent === nextDetails.baseContent
    && previousDetails.oursContent === nextDetails.oursContent
    && previousDetails.theirsContent === nextDetails.theirsContent
    && previousDetails.mergedContent === nextDetails.mergedContent
    && previousDetails.language === nextDetails.language;
}

function areReferenceListsEqual(previousReferences: CodePaneReference[], nextReferences: CodePaneReference[]): boolean {
  if (previousReferences.length !== nextReferences.length) {
    return false;
  }

  for (let index = 0; index < previousReferences.length; index += 1) {
    const previousReference = previousReferences[index];
    const nextReference = nextReferences[index];
    if (
      previousReference?.filePath !== nextReference?.filePath
      || !areRangesEqual(previousReference?.range, nextReference?.range)
      || previousReference?.previewText !== nextReference?.previewText
    ) {
      return false;
    }
  }

  return true;
}

function areGitHistoryEntriesEqual(
  previousEntries: CodePaneGitHistoryEntry[],
  nextEntries: CodePaneGitHistoryEntry[],
): boolean {
  if (previousEntries.length !== nextEntries.length) {
    return false;
  }

  for (let index = 0; index < previousEntries.length; index += 1) {
    const previousEntry = previousEntries[index];
    const nextEntry = nextEntries[index];
    if (
      previousEntry?.commitSha !== nextEntry?.commitSha
      || previousEntry?.shortSha !== nextEntry?.shortSha
      || previousEntry?.subject !== nextEntry?.subject
      || previousEntry?.author !== nextEntry?.author
      || previousEntry?.email !== nextEntry?.email
      || previousEntry?.timestamp !== nextEntry?.timestamp
      || previousEntry?.scope !== nextEntry?.scope
      || previousEntry?.filePath !== nextEntry?.filePath
      || previousEntry?.lineNumber !== nextEntry?.lineNumber
      || !areStringListsEqual(previousEntry?.refs ?? [], nextEntry?.refs ?? [])
    ) {
      return false;
    }
  }

  return true;
}

function areGitHistoryResultsEqual(
  previousResult: CodePaneGitHistoryResult | null,
  nextResult: CodePaneGitHistoryResult | null,
): boolean {
  if (previousResult === nextResult) {
    return true;
  }

  if (!previousResult || !nextResult) {
    return false;
  }

  return previousResult.scope === nextResult.scope
    && previousResult.targetFilePath === nextResult.targetFilePath
    && previousResult.targetLineNumber === nextResult.targetLineNumber
    && areGitHistoryEntriesEqual(previousResult.entries, nextResult.entries);
}

function areGitBlameLinesEqual(previousLines: CodePaneGitBlameLine[], nextLines: CodePaneGitBlameLine[]): boolean {
  if (previousLines.length !== nextLines.length) {
    return false;
  }

  for (let index = 0; index < previousLines.length; index += 1) {
    const previousLine = previousLines[index];
    const nextLine = nextLines[index];
    if (
      previousLine?.lineNumber !== nextLine?.lineNumber
      || previousLine?.commitSha !== nextLine?.commitSha
      || previousLine?.shortSha !== nextLine?.shortSha
      || previousLine?.author !== nextLine?.author
      || previousLine?.summary !== nextLine?.summary
      || previousLine?.timestamp !== nextLine?.timestamp
      || previousLine?.text !== nextLine?.text
    ) {
      return false;
    }
  }

  return true;
}

function areSemanticLegendsEqual(
  previousLegend: CodePaneSemanticTokensLegend | null,
  nextLegend: CodePaneSemanticTokensLegend | null,
): boolean {
  if (previousLegend === nextLegend) {
    return true;
  }

  if (!previousLegend || !nextLegend) {
    return false;
  }

  return areStringListsEqual(previousLegend.tokenTypes, nextLegend.tokenTypes)
    && areStringListsEqual(previousLegend.tokenModifiers, nextLegend.tokenModifiers);
}

function areSemanticSummaryEntriesEqual(
  previousEntries: SemanticTokenSummaryEntry[],
  nextEntries: SemanticTokenSummaryEntry[],
): boolean {
  if (previousEntries.length !== nextEntries.length) {
    return false;
  }

  for (let index = 0; index < previousEntries.length; index += 1) {
    const previousEntry = previousEntries[index];
    const nextEntry = nextEntries[index];
    if (
      previousEntry?.tokenType !== nextEntry?.tokenType
      || previousEntry?.count !== nextEntry?.count
    ) {
      return false;
    }
  }

  return true;
}

function arePreviewStatsEqual(
  previousStats?: CodePanePreviewStats | null,
  nextStats?: CodePanePreviewStats | null,
): boolean {
  if (previousStats === nextStats) {
    return true;
  }

  if (!previousStats || !nextStats) {
    return false;
  }

  return previousStats.fileCount === nextStats.fileCount
    && previousStats.editCount === nextStats.editCount
    && previousStats.renameCount === nextStats.renameCount
    && previousStats.moveCount === nextStats.moveCount
    && previousStats.deleteCount === nextStats.deleteCount
    && previousStats.modifyCount === nextStats.modifyCount;
}

function areTextEditsEqual(previousEdits: CodePaneTextEdit[], nextEdits: CodePaneTextEdit[]): boolean {
  if (previousEdits.length !== nextEdits.length) {
    return false;
  }

  for (let index = 0; index < previousEdits.length; index += 1) {
    const previousEdit = previousEdits[index];
    const nextEdit = nextEdits[index];
    if (
      previousEdit?.filePath !== nextEdit?.filePath
      || previousEdit?.newText !== nextEdit?.newText
      || !areRangesEqual(previousEdit?.range, nextEdit?.range)
    ) {
      return false;
    }
  }

  return true;
}

function arePreviewFileChangesEqual(
  previousFiles: CodePanePreviewFileChange[],
  nextFiles: CodePanePreviewFileChange[],
): boolean {
  if (previousFiles.length !== nextFiles.length) {
    return false;
  }

  for (let index = 0; index < previousFiles.length; index += 1) {
    const previousFile = previousFiles[index];
    const nextFile = nextFiles[index];
    if (
      previousFile?.id !== nextFile?.id
      || previousFile?.kind !== nextFile?.kind
      || previousFile?.filePath !== nextFile?.filePath
      || previousFile?.targetFilePath !== nextFile?.targetFilePath
      || previousFile?.language !== nextFile?.language
      || previousFile?.beforeContent !== nextFile?.beforeContent
      || previousFile?.afterContent !== nextFile?.afterContent
      || !areTextEditsEqual(previousFile?.edits ?? [], nextFile?.edits ?? [])
    ) {
      return false;
    }
  }

  return true;
}

function arePreviewChangeSetsEqual(
  previousPreview: CodePanePreviewChangeSet | null,
  nextPreview: CodePanePreviewChangeSet | null,
): boolean {
  if (previousPreview === nextPreview) {
    return true;
  }

  if (!previousPreview || !nextPreview) {
    return false;
  }

  return previousPreview.id === nextPreview.id
    && previousPreview.title === nextPreview.title
    && previousPreview.source === nextPreview.source
    && previousPreview.description === nextPreview.description
    && previousPreview.createdAt === nextPreview.createdAt
    && arePreviewFileChangesEqual(previousPreview.files, nextPreview.files)
    && areStringListsEqual(previousPreview.warnings ?? [], nextPreview.warnings ?? [])
    && arePreviewStatsEqual(previousPreview.stats, nextPreview.stats);
}

function areCodeActionDiagnosticListsEqual(
  previousDiagnostics: CodePaneCodeActionDiagnostic[],
  nextDiagnostics: CodePaneCodeActionDiagnostic[],
): boolean {
  if (previousDiagnostics.length !== nextDiagnostics.length) {
    return false;
  }

  for (let index = 0; index < previousDiagnostics.length; index += 1) {
    const previousDiagnostic = previousDiagnostics[index];
    const nextDiagnostic = nextDiagnostics[index];
    if (
      previousDiagnostic?.message !== nextDiagnostic?.message
      || !areRangesEqual(previousDiagnostic?.range, nextDiagnostic?.range)
      || previousDiagnostic?.severity !== nextDiagnostic?.severity
      || previousDiagnostic?.code !== nextDiagnostic?.code
    ) {
      return false;
    }
  }

  return true;
}

function areCodeActionListsEqual(previousActions: CodePaneCodeAction[], nextActions: CodePaneCodeAction[]): boolean {
  if (previousActions.length !== nextActions.length) {
    return false;
  }

  for (let index = 0; index < previousActions.length; index += 1) {
    const previousAction = previousActions[index];
    const nextAction = nextActions[index];
    if (
      previousAction?.id !== nextAction?.id
      || previousAction?.title !== nextAction?.title
      || previousAction?.kind !== nextAction?.kind
      || previousAction?.isPreferred !== nextAction?.isPreferred
      || previousAction?.disabledReason !== nextAction?.disabledReason
      || !areCodeActionDiagnosticListsEqual(previousAction?.diagnostics ?? [], nextAction?.diagnostics ?? [])
    ) {
      return false;
    }
  }

  return true;
}

function areLanguageWorkspaceStatesEqual(
  previousState: CodePaneLanguageWorkspaceState | null,
  nextState: CodePaneLanguageWorkspaceState | null,
): boolean {
  if (previousState === nextState) {
    return true;
  }

  if (!previousState || !nextState) {
    return false;
  }

  return previousState.pluginId === nextState.pluginId
    && previousState.workspaceRoot === nextState.workspaceRoot
    && previousState.projectRoot === nextState.projectRoot
    && previousState.languageId === nextState.languageId
    && previousState.runtimeState === nextState.runtimeState
    && previousState.phase === nextState.phase
    && previousState.message === nextState.message
    && previousState.progressText === nextState.progressText
    && areStringListsEqual(previousState.readyFeatures, nextState.readyFeatures)
    && previousState.timestamp === nextState.timestamp;
}

function areRunSessionsEqual(previousSessions: CodePaneRunSession[], nextSessions: CodePaneRunSession[]): boolean {
  if (previousSessions.length !== nextSessions.length) {
    return false;
  }

  for (let index = 0; index < previousSessions.length; index += 1) {
    const previousSession = previousSessions[index];
    const nextSession = nextSessions[index];
    if (
      previousSession?.id !== nextSession?.id
      || previousSession?.targetId !== nextSession?.targetId
      || previousSession?.label !== nextSession?.label
      || previousSession?.detail !== nextSession?.detail
      || previousSession?.kind !== nextSession?.kind
      || previousSession?.languageId !== nextSession?.languageId
      || previousSession?.state !== nextSession?.state
      || previousSession?.workingDirectory !== nextSession?.workingDirectory
      || previousSession?.startedAt !== nextSession?.startedAt
      || previousSession?.endedAt !== nextSession?.endedAt
      || previousSession?.exitCode !== nextSession?.exitCode
    ) {
      return false;
    }
  }

  return true;
}

function areDebugSessionsEqual(previousSessions: CodePaneDebugSession[], nextSessions: CodePaneDebugSession[]): boolean {
  if (previousSessions.length !== nextSessions.length) {
    return false;
  }

  for (let index = 0; index < previousSessions.length; index += 1) {
    const previousSession = previousSessions[index];
    const nextSession = nextSessions[index];
    if (
      previousSession?.id !== nextSession?.id
      || previousSession?.targetId !== nextSession?.targetId
      || previousSession?.label !== nextSession?.label
      || previousSession?.detail !== nextSession?.detail
      || previousSession?.languageId !== nextSession?.languageId
      || previousSession?.adapterType !== nextSession?.adapterType
      || previousSession?.request !== nextSession?.request
      || previousSession?.state !== nextSession?.state
      || previousSession?.workingDirectory !== nextSession?.workingDirectory
      || previousSession?.startedAt !== nextSession?.startedAt
      || previousSession?.endedAt !== nextSession?.endedAt
      || previousSession?.stopReason !== nextSession?.stopReason
      || previousSession?.error !== nextSession?.error
      || previousSession?.currentFrame?.id !== nextSession?.currentFrame?.id
      || previousSession?.currentFrame?.name !== nextSession?.currentFrame?.name
      || previousSession?.currentFrame?.filePath !== nextSession?.currentFrame?.filePath
      || previousSession?.currentFrame?.lineNumber !== nextSession?.currentFrame?.lineNumber
      || previousSession?.currentFrame?.column !== nextSession?.currentFrame?.column
    ) {
      return false;
    }
  }

  return true;
}

function prependRecentSession<T extends { id: string }>(
  currentSessions: T[],
  nextSession: T,
  areEqual: (previousSessions: T[], nextSessions: T[]) => boolean,
): T[] {
  const nextSessions = [nextSession];
  for (const session of currentSessions) {
    if (session.id !== nextSession.id) {
      nextSessions.push(session);
    }
  }

  const limitedSessions = nextSessions.slice(0, 20);
  return areEqual(currentSessions, limitedSessions) ? currentSessions : limitedSessions;
}

function areRunTargetsEqual(previousTargets: CodePaneRunTarget[], nextTargets: CodePaneRunTarget[]): boolean {
  if (previousTargets.length !== nextTargets.length) {
    return false;
  }

  for (let index = 0; index < previousTargets.length; index += 1) {
    const previousTarget = previousTargets[index];
    const nextTarget = nextTargets[index];
    const previousCustomization = previousTarget?.customization;
    const nextCustomization = nextTarget?.customization;
    if (
      previousTarget?.id !== nextTarget?.id
      || previousTarget?.label !== nextTarget?.label
      || previousTarget?.detail !== nextTarget?.detail
      || previousTarget?.kind !== nextTarget?.kind
      || previousTarget?.languageId !== nextTarget?.languageId
      || previousTarget?.workingDirectory !== nextTarget?.workingDirectory
      || previousTarget?.filePath !== nextTarget?.filePath
      || previousTarget?.canDebug !== nextTarget?.canDebug
      || previousTarget?.debugRequest !== nextTarget?.debugRequest
      || (
        previousCustomization
          ? (!nextCustomization || !areRunTargetCustomizationsEqual(previousCustomization, nextCustomization))
          : Boolean(nextCustomization)
      )
    ) {
      return false;
    }
  }

  return true;
}

function areDebugStackFramesEqual(
  previousFrames: CodePaneDebugStackFrame[],
  nextFrames: CodePaneDebugStackFrame[],
): boolean {
  if (previousFrames.length !== nextFrames.length) {
    return false;
  }

  for (let index = 0; index < previousFrames.length; index += 1) {
    const previousFrame = previousFrames[index];
    const nextFrame = nextFrames[index];
    if (
      previousFrame?.id !== nextFrame?.id
      || previousFrame?.name !== nextFrame?.name
      || previousFrame?.filePath !== nextFrame?.filePath
      || previousFrame?.lineNumber !== nextFrame?.lineNumber
      || previousFrame?.column !== nextFrame?.column
    ) {
      return false;
    }
  }

  return true;
}

function areDebugVariablesEqual(
  previousVariables: CodePaneDebugVariable[],
  nextVariables: CodePaneDebugVariable[],
): boolean {
  if (previousVariables.length !== nextVariables.length) {
    return false;
  }

  for (let index = 0; index < previousVariables.length; index += 1) {
    const previousVariable = previousVariables[index];
    const nextVariable = nextVariables[index];
    if (
      previousVariable?.id !== nextVariable?.id
      || previousVariable?.name !== nextVariable?.name
      || previousVariable?.value !== nextVariable?.value
      || previousVariable?.type !== nextVariable?.type
      || previousVariable?.evaluateName !== nextVariable?.evaluateName
    ) {
      return false;
    }
  }

  return true;
}

function areDebugScopesEqual(previousScopes: CodePaneDebugScope[], nextScopes: CodePaneDebugScope[]): boolean {
  if (previousScopes.length !== nextScopes.length) {
    return false;
  }

  for (let index = 0; index < previousScopes.length; index += 1) {
    const previousScope = previousScopes[index];
    const nextScope = nextScopes[index];
    if (
      previousScope?.id !== nextScope?.id
      || previousScope?.name !== nextScope?.name
      || !areDebugVariablesEqual(previousScope?.variables ?? [], nextScope?.variables ?? [])
    ) {
      return false;
    }
  }

  return true;
}

function areDebugSessionDetailsEqual(
  previousDetails: CodePaneDebugSessionDetails | null,
  nextDetails: CodePaneDebugSessionDetails | null,
): boolean {
  if (previousDetails === nextDetails) {
    return true;
  }

  if (!previousDetails || !nextDetails) {
    return false;
  }

  return previousDetails.sessionId === nextDetails.sessionId
    && areDebugStackFramesEqual(previousDetails.stackFrames, nextDetails.stackFrames)
    && areDebugScopesEqual(previousDetails.scopes, nextDetails.scopes);
}

function areDebugWatchEntriesEqual(previousEntries: DebugWatchEntry[], nextEntries: DebugWatchEntry[]): boolean {
  if (previousEntries.length !== nextEntries.length) {
    return false;
  }

  for (let index = 0; index < previousEntries.length; index += 1) {
    const previousEntry = previousEntries[index];
    const nextEntry = nextEntries[index];
    if (
      previousEntry?.id !== nextEntry?.id
      || previousEntry?.expression !== nextEntry?.expression
      || previousEntry?.value !== nextEntry?.value
      || previousEntry?.error !== nextEntry?.error
    ) {
      return false;
    }
  }

  return true;
}

function getLocalHistoryPreview(content: string): string {
  let lineStartIndex = 0;
  while (lineStartIndex < content.length) {
    const lineEndIndex = content.indexOf('\n', lineStartIndex);
    const line = lineEndIndex === -1
      ? content.slice(lineStartIndex)
      : content.slice(lineStartIndex, lineEndIndex);
    const preview = line.trim();
    if (preview) {
      return preview;
    }

    if (lineEndIndex === -1) {
      break;
    }
    lineStartIndex = lineEndIndex + 1;
  }

  return '';
}

export const CodePane: React.FC<CodePaneProps> = ({
  windowId,
  pane,
  isActive,
  onActivate,
  onClose,
}) => {
  const { language, t } = useI18n();
  const updatePane = useWindowStore((state) => state.updatePane);
  const supportsMonaco = typeof Worker !== 'undefined';
  const isMac = window.electronAPI.platform === 'darwin';
  const paneRef = useRef(pane);
  const rootContainerRef = useRef<HTMLDivElement | null>(null);
  const workspaceLayoutRef = useRef<HTMLDivElement | null>(null);
  const sidebarElementRef = useRef<HTMLElement | null>(null);
  const filesSidebarScrollRef = useRef<HTMLDivElement | null>(null);
  const pendingExplorerRevealPathRef = useRef<string | null>(null);
  const pendingExplorerRevealAnimationFrameRef = useRef<number | null>(null);
  const openFileTabsScrollRef = useRef<HTMLDivElement | null>(null);
  const primaryEditorPaneRef = useRef<HTMLDivElement | null>(null);
  const bottomPanelElementRef = useRef<HTMLDivElement | null>(null);
  const rootPath = pane.code?.rootPath ?? pane.cwd;
  const cachedExternalLibrarySections = useMemo(
    () => getExternalLibraryCache(rootPath) ?? [],
    [rootPath],
  );
  const cachedGitStatusEntries = useMemo(
    () => getGitStatusCache(rootPath) ?? [],
    [rootPath],
  );
  const cachedGitSummary = useMemo(
    () => getGitSummaryCache(rootPath),
    [rootPath],
  );
  const cachedGitGraph = useMemo(
    () => getGitGraphCache(rootPath) ?? [],
    [rootPath],
  );
  const openFiles = pane.code?.openFiles ?? [];
  const bookmarks = pane.code?.bookmarks ?? [];
  const activeFilePath = pane.code?.activeFilePath ?? null;
  const selectedPath = pane.code?.selectedPath ?? null;
  const viewMode = pane.code?.viewMode ?? 'editor';
  const diffTargetPath = pane.code?.diffTargetPath ?? null;
  const savePipelineState = getInitialSavePipelineState(pane);
  const initialSidebarLayout = useMemo(() => getInitialSidebarLayout(pane), [pane]);
  const initialEditorSplitLayout = useMemo(() => getInitialEditorSplitLayout(pane), [pane]);
  const initialBottomPanelLayout = useMemo(() => getInitialBottomPanelLayout(pane), [pane]);

  const monacoRef = useRef<MonacoModule | null>(null);
  const languageBridgeRef = useRef<MonacoLanguageBridge | null>(null);
  const editorHostRef = useRef<HTMLDivElement | null>(null);
  const secondaryEditorHostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<MonacoEditor | null>(null);
  const secondaryEditorRef = useRef<MonacoEditor | null>(null);
  const diffEditorRef = useRef<MonacoDiffEditor | null>(null);
  const fileModelsRef = useRef(new Map<string, MonacoModel>());
  const diffModelsRef = useRef(new Map<string, MonacoModel>());
  const revisionModifiedModelsRef = useRef(new Map<string, MonacoModel>());
  const revisionDiffFilePathRef = useRef<string | null>(null);
  const pendingGitRevisionDiffRef = useRef<GitRevisionDiffRequest | null>(null);
  const externalChangeEntriesRef = useRef<ExternalChangeEntry[]>([]);
  const externalChangeStateRef = useRef<ExternalChangeStateSnapshot>(
    createExternalChangeStateSnapshot([], null),
  );
  const selectedExternalChangePathRef = useRef<string | null>(null);
  const modelDisposersRef = useRef(new Map<string, MonacoDisposable>());
  const fileMetaRef = useRef(new Map<string, FileRuntimeMeta>());
  const modelFilePathRef = useRef(new Map<string, string>());
  const problemsByFileRef = useRef(new Map<string, Array<MonacoMarker & { filePath: string }>>());
  const preloadedReadResultsRef = useRef(new Map<string, CodePaneReadFileResult>());
  const viewStatesRef = useRef(new Map<string, MonacoViewState>());
  const secondaryViewStatesRef = useRef(new Map<string, MonacoViewState>());
  const autoSaveTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const documentSyncTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const documentSyncQueueRef = useRef(new Map<string, Promise<void>>());
  const localHistoryTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const localHistoryEntriesRef = useRef(new Map<string, LocalHistoryEntry[]>());
  const suppressedExternalChangePathsRef = useRef(new Map<string, number>());
  const suppressModelEventsRef = useRef(new Set<string>());
  const previewOpenFilePathsRef = useRef((() => {
    const previewPaths = new Set<string>();
    for (const tab of pane.code?.openFiles ?? []) {
      if (tab.preview) {
        previewPaths.add(tab.path);
      }
    }
    return previewPaths;
  })());
  const markerListenerRef = useRef<MonacoDisposable | null>(null);
  const pendingProblemsRefreshRef = useRef<{ refreshAll: boolean; paths: Set<string> } | null>(null);
  const problemsRefreshAnimationFrameRef = useRef<number | null>(null);
  const editorMouseDownListenerRef = useRef<MonacoDisposable | null>(null);
  const editorMouseMoveListenerRef = useRef<MonacoDisposable | null>(null);
  const editorMouseLeaveListenerRef = useRef<MonacoDisposable | null>(null);
  const secondaryEditorMouseDownListenerRef = useRef<MonacoDisposable | null>(null);
  const secondaryEditorMouseMoveListenerRef = useRef<MonacoDisposable | null>(null);
  const secondaryEditorMouseLeaveListenerRef = useRef<MonacoDisposable | null>(null);
  const diffEditorMouseDownListenerRef = useRef<MonacoDisposable | null>(null);
  const diffEditorMouseMoveListenerRef = useRef<MonacoDisposable | null>(null);
  const diffEditorMouseLeaveListenerRef = useRef<MonacoDisposable | null>(null);
  const editorCursorPositionListenerRef = useRef<MonacoDisposable | null>(null);
  const secondaryEditorCursorPositionListenerRef = useRef<MonacoDisposable | null>(null);
  const diffEditorCursorPositionListenerRef = useRef<MonacoDisposable | null>(null);
  const definitionLinkDecorationEditorRef = useRef<MonacoEditor | null>(null);
  const definitionLinkDecorationIdsRef = useRef<string[]>([]);
  const debugDecorationEditorRef = useRef<MonacoEditor | null>(null);
  const debugDecorationIdsRef = useRef<string[]>([]);
  const definitionHoverRequestKeyRef = useRef<string | null>(null);
  const definitionLookupCacheRef = useRef(new Map<string, Promise<DefinitionLookupResult>>());
  const sidebarResizeStartRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const sidebarResizeCleanupRef = useRef<(() => void) | null>(null);
  const pendingSidebarWidthRef = useRef<number | null>(null);
  const sidebarResizeAnimationFrameRef = useRef<number | null>(null);
  const editorSplitResizeStartRef = useRef<{ startX: number; startSize: number } | null>(null);
  const editorSplitResizeCleanupRef = useRef<(() => void) | null>(null);
  const pendingEditorSplitSizeRef = useRef<number | null>(null);
  const editorSplitResizeAnimationFrameRef = useRef<number | null>(null);
  const bottomPanelResizeStartRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const bottomPanelResizeCleanupRef = useRef<(() => void) | null>(null);
  const pendingBottomPanelResizeRef = useRef<{ height: number; availableHeight: number } | null>(null);
  const bottomPanelResizeAnimationFrameRef = useRef<number | null>(null);
  const pendingOpenFileTabsViewportRef = useRef<{ scrollLeft: number; viewportWidth: number } | null>(null);
  const openFileTabsScrollAnimationFrameRef = useRef<number | null>(null);
  const focusedEditorTargetRef = useRef<EditorTarget>('editor');
  const runtimeStoreRef = useRef(new CodePaneRuntimeStore());
  const cursorStoreRef = useRef(new CodePaneCursorStore());
  const navigationStoreRef = useRef(new CodePaneNavigationStore());
  const refreshEditorSurfaceCoreRef = useRef<(() => Promise<void>) | null>(null);
  const pendingEditorSurfaceRefreshRef = useRef<Promise<void> | null>(null);
  const queuedEditorSurfaceRefreshRef = useRef(false);
  const editorSurfaceRefreshSequenceRef = useRef(0);
  const editorSurfaceBindingStateRef = useRef<EditorSurfaceBindingState | null>(null);
  const compactDirectoryPresentationsCacheRef = useRef<Map<string, CompactDirectoryPresentationCacheEntry>>(new Map());
  const searchSidebarStateRootPathRef = useRef(rootPath);
  const searchSidebarStateRef = useRef<SearchSidebarPersistedState>({
    contentQuery: '',
    contentResults: [],
    contentError: null,
    workspaceSymbolQuery: '',
    workspaceSymbolResults: [],
    workspaceSymbolError: null,
  });
  if (searchSidebarStateRootPathRef.current !== rootPath) {
    searchSidebarStateRootPathRef.current = rootPath;
    searchSidebarStateRef.current = {
      contentQuery: '',
      contentResults: [],
      contentError: null,
      workspaceSymbolQuery: '',
      workspaceSymbolResults: [],
      workspaceSymbolError: null,
    };
  }

  const [treeEntriesByDirectory, setTreeEntriesByDirectory] = useState<Record<string, CodePaneTreeEntry[]>>({});
  const [externalEntriesByDirectory, setExternalEntriesByDirectory] = useState<Record<string, CodePaneTreeEntry[]>>({});
  const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(() => (
    createExpandedDirectorySet(rootPath, pane.code?.expandedPaths)
  ));
  const [loadedDirectories, setLoadedDirectories] = useState<Set<string>>(() => new Set());
  const [loadedExternalDirectories, setLoadedExternalDirectories] = useState<Set<string>>(() => new Set());
  const [loadingDirectories, setLoadingDirectories] = useState<Set<string>>(() => new Set([rootPath]));
  const [loadingExternalDirectories, setLoadingExternalDirectories] = useState<Set<string>>(() => new Set());
  const [externalLibrarySections, setExternalLibrarySections] = useState<CodePaneExternalLibrarySection[]>(cachedExternalLibrarySections);
  const [explorerRevealVersion, setExplorerRevealVersion] = useState(0);
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>(initialSidebarLayout.activeView);
  const [isSidebarVisible, setIsSidebarVisible] = useState(initialSidebarLayout.visible);
  const [sidebarWidth, setSidebarWidth] = useState(initialSidebarLayout.width);
  const [lastExpandedSidebarWidth, setLastExpandedSidebarWidth] = useState(initialSidebarLayout.lastExpandedWidth);
  const [isSidebarResizing, setIsSidebarResizing] = useState(false);
  const [isEditorSplitVisible, setIsEditorSplitVisible] = useState(initialEditorSplitLayout.visible);
  const [editorSplitSize, setEditorSplitSize] = useState(initialEditorSplitLayout.size);
  const [secondaryFilePath, setSecondaryFilePath] = useState<string | null>(initialEditorSplitLayout.secondaryFilePath);
  const [isEditorSplitResizing, setIsEditorSplitResizing] = useState(false);
  const [bottomPanelHeight, setBottomPanelHeight] = useState(initialBottomPanelLayout.height);
  const [bottomPanelAvailableHeight, setBottomPanelAvailableHeight] = useState(CODE_PANE_BOTTOM_PANEL_MAX_HEIGHT);
  const [isBottomPanelResizing, setIsBottomPanelResizing] = useState(false);
  const [searchPanelMode, setSearchPanelMode] = useState<SearchPanelMode>('contents');
  const [bottomPanelMode, setBottomPanelMode] = useState<BottomPanelMode | null>(null);
  const [activeGitWorkbenchTab, setActiveGitWorkbenchTab] = useState<GitToolWindowTab>('log');
  const [breakpoints, setBreakpoints] = useState<CodePaneBreakpoint[]>(() => normalizeBreakpoints(pane.code?.breakpoints));
  const [exceptionBreakpoints, setExceptionBreakpoints] = useState<CodePaneExceptionBreakpoint[]>(
    () => normalizeExceptionBreakpoints(pane.code?.debug?.exceptionBreakpoints),
  );
  const [runTargets, setRunTargets] = useState<CodePaneRunTarget[]>([]);
  const [isRunTargetsLoading, setIsRunTargetsLoading] = useState(false);
  const [runTargetsError, setRunTargetsError] = useState<string | null>(null);
  const [debugSessions, setDebugSessions] = useState<CodePaneDebugSession[]>([]);
  const debugSessionsRef = useRef<CodePaneDebugSession[]>([]);
  const debugSessionOutputsRef = useRef<Record<string, string>>({});
  const [selectedDebugSessionOutput, setSelectedDebugSessionOutput] = useState('');
  const [selectedDebugSessionId, setSelectedDebugSessionId] = useState<string | null>(null);
  const selectedDebugSessionIdRef = useRef<string | null>(null);
  const [debugSessionDetails, setDebugSessionDetails] = useState<CodePaneDebugSessionDetails | null>(null);
  const [watchExpressions, setWatchExpressions] = useState<string[]>(
    () => normalizeWatchExpressions(pane.code?.debug?.watchExpressions),
  );
  const [watchEntries, setWatchEntries] = useState<DebugWatchEntry[]>([]);
  const [isDebugDetailsLoading, setIsDebugDetailsLoading] = useState(false);
  const [debugEvaluations, setDebugEvaluations] = useState<DebugEvaluationEntry[]>([]);
  const [testItems, setTestItems] = useState<CodePaneTestItem[]>([]);
  const [isTestsLoading, setIsTestsLoading] = useState(false);
  const [testsError, setTestsError] = useState<string | null>(null);
  const [projectContributions, setProjectContributions] = useState<CodePaneProjectContribution[]>([]);
  const [isProjectLoading, setIsProjectLoading] = useState(false);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [runSessions, setRunSessions] = useState<CodePaneRunSession[]>([]);
  const runSessionOutputsRef = useRef<Record<string, string>>({});
  const [selectedRunSessionOutput, setSelectedRunSessionOutput] = useState('');
  const [selectedRunSessionId, setSelectedRunSessionId] = useState<string | null>(null);
  const selectedRunSessionIdRef = useRef<string | null>(null);
  const [usageResults, setUsageResults] = useState<CodePaneReference[]>([]);
  const [isFindingUsages, setIsFindingUsages] = useState(false);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [usagesTargetLabel, setUsagesTargetLabel] = useState<string | null>(null);
  const [documentSymbols, setDocumentSymbols] = useState<CodePaneDocumentSymbol[]>([]);
  const [documentSymbolsFilePath, setDocumentSymbolsFilePath] = useState<string | null>(null);
  const [isDocumentSymbolsLoading, setIsDocumentSymbolsLoading] = useState(false);
  const [documentSymbolsError, setDocumentSymbolsError] = useState<string | null>(null);
  const [inspectorPanelMode, setInspectorPanelMode] = useState<InspectorPanelMode | null>(null);
  const [inspectorPanelFilePath, setInspectorPanelFilePath] = useState<string | null>(null);
  const [problems, setProblems] = useState<Array<MonacoMarker & { filePath: string }>>([]);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [gitStatusEntries, setGitStatusEntries] = useState<CodePaneGitStatusEntry[]>(cachedGitStatusEntries);
  const [gitStatusByPath, setGitStatusByPath] = useState<Record<string, CodePaneGitStatusEntry>>(
    () => mapGitStatusEntriesByPath(cachedGitStatusEntries),
  );
  const [gitRepositorySummary, setGitRepositorySummary] = useState<CodePaneGitRepositorySummary | null>(cachedGitSummary);
  const [gitGraph, setGitGraph] = useState<CodePaneGitGraphCommit[]>(cachedGitGraph);
  const [gitBranches, setGitBranches] = useState<CodePaneGitBranchEntry[]>([]);
  const [selectedGitBranchName, setSelectedGitBranchName] = useState<string | null>(null);
  const [selectedGitLogCommitSha, setSelectedGitLogCommitSha] = useState<string | null>(null);
  const [selectedGitCommitOrder, setSelectedGitCommitOrder] = useState<string[]>([]);
  const [selectedGitCommitDetails, setSelectedGitCommitDetails] = useState<CodePaneGitCommitDetails | null>(null);
  const [comparedGitCommits, setComparedGitCommits] = useState<CodePaneGitCompareCommitsResult | null>(null);
  const [isGitCommitDetailsLoading, setIsGitCommitDetailsLoading] = useState(false);
  const [gitCommitDetailsError, setGitCommitDetailsError] = useState<string | null>(null);
  const [isGitBranchesLoading, setIsGitBranchesLoading] = useState(false);
  const [gitBranchesError, setGitBranchesError] = useState<string | null>(null);
  const [gitRebasePlan, setGitRebasePlan] = useState<CodePaneGitRebasePlanResult | null>(null);
  const [gitRebaseBaseRef, setGitRebaseBaseRef] = useState('');
  const [isGitRebaseLoading, setIsGitRebaseLoading] = useState(false);
  const [gitRebaseError, setGitRebaseError] = useState<string | null>(null);
  const [gitConflictDetails, setGitConflictDetails] = useState<CodePaneGitConflictDetails | null>(null);
  const [selectedGitConflictPath, setSelectedGitConflictPath] = useState<string | null>(null);
  const [isGitConflictLoading, setIsGitConflictLoading] = useState(false);
  const [isApplyingGitConflict, setIsApplyingGitConflict] = useState(false);
  const [gitConflictError, setGitConflictError] = useState<string | null>(null);
  const [selectedGitChangePath, setSelectedGitChangePath] = useState<string | null>(null);
  const [selectedGitHunksPath, setSelectedGitHunksPath] = useState<string | null>(null);
  const [gitStagedHunks, setGitStagedHunks] = useState<CodePaneGitDiffHunk[]>([]);
  const [gitUnstagedHunks, setGitUnstagedHunks] = useState<CodePaneGitDiffHunk[]>([]);
  const [isGitHunksLoading, setIsGitHunksLoading] = useState(false);
  const [gitHunksError, setGitHunksError] = useState<string | null>(null);
  const [refactorPreview, setRefactorPreview] = useState<CodePanePreviewChangeSet | null>(null);
  const [selectedPreviewChangeId, setSelectedPreviewChangeId] = useState<string | null>(null);
  const [isApplyingRefactorPreview, setIsApplyingRefactorPreview] = useState(false);
  const [refactorPreviewError, setRefactorPreviewError] = useState<string | null>(null);
  const [gitHistory, setGitHistory] = useState<CodePaneGitHistoryResult | null>(null);
  const [selectedHistoryCommitSha, setSelectedHistoryCommitSha] = useState<string | null>(null);
  const [isGitHistoryLoading, setIsGitHistoryLoading] = useState(false);
  const [gitHistoryError, setGitHistoryError] = useState<string | null>(null);
  const [pendingGitRevisionDiff, setPendingGitRevisionDiff] = useState<GitRevisionDiffRequest | null>(null);
  const [externalChangeEntries, setExternalChangeEntries] = useState<ExternalChangeEntry[]>([]);
  const [selectedExternalChangePath, setSelectedExternalChangePath] = useState<string | null>(null);
  const [selectedExternalChangeEntry, setSelectedExternalChangeEntry] = useState<ExternalChangeEntry | null>(null);
  const [todoItems, setTodoItems] = useState<CodePaneTodoItem[]>([]);
  const [isTodoLoading, setIsTodoLoading] = useState(false);
  const [todoError, setTodoError] = useState<string | null>(null);
  const [localHistoryVersion, setLocalHistoryVersion] = useState(0);
  const [isBlameVisible, setIsBlameVisible] = useState(false);
  const [isBlameLoading, setIsBlameLoading] = useState(false);
  const [blameLines, setBlameLines] = useState<CodePaneGitBlameLine[]>([]);
  const [quickDocumentation, setQuickDocumentation] = useState<CodePaneHoverResult | null>(null);
  const [quickDocumentationError, setQuickDocumentationError] = useState<string | null>(null);
  const [isQuickDocumentationOpen, setIsQuickDocumentationOpen] = useState(false);
  const [isQuickDocumentationLoading, setIsQuickDocumentationLoading] = useState(false);
  const [selectedHierarchyMode, setSelectedHierarchyMode] = useState<HierarchyMode>('call-outgoing');
  const [hierarchyRootNode, setHierarchyRootNode] = useState<HierarchyTreeNode | null>(null);
  const [isHierarchyLoading, setIsHierarchyLoading] = useState(false);
  const [hierarchyError, setHierarchyError] = useState<string | null>(null);
  const [areInlayHintsEnabled, setAreInlayHintsEnabled] = useState(true);
  const [areSemanticTokensEnabled, setAreSemanticTokensEnabled] = useState(true);
  const [semanticLegend, setSemanticLegend] = useState<CodePaneSemanticTokensLegend | null>(null);
  const [semanticSummary, setSemanticSummary] = useState<SemanticTokenSummaryEntry[]>([]);
  const [semanticTokenCount, setSemanticTokenCount] = useState(0);
  const [semanticSummaryFileLabel, setSemanticSummaryFileLabel] = useState<string | null>(null);
  const [isSemanticSummaryLoading, setIsSemanticSummaryLoading] = useState(false);
  const [semanticSummaryError, setSemanticSummaryError] = useState<string | null>(null);
  const [pathMutationDialog, setPathMutationDialog] = useState<PathMutationDialogState | null>(null);
  const [isSubmittingPathMutation, setIsSubmittingPathMutation] = useState(false);
  const [actionInputDialog, setActionInputDialog] = useState<ActionInputDialogState | null>(null);
  const [isSubmittingActionInput, setIsSubmittingActionInput] = useState(false);
  const [actionConfirmDialog, setActionConfirmDialog] = useState<ActionConfirmDialogState | null>(null);
  const [isSubmittingActionConfirm, setIsSubmittingActionConfirm] = useState(false);
  const [openFileTabsViewport, setOpenFileTabsViewport] = useState({ scrollLeft: 0, viewportWidth: 0 });
  const [commitWindowState, setCommitWindowState] = useState<CommitWindowState | null>(null);
  const commitWindowStateRef = useRef<CommitWindowState | null>(null);
  const [banner, setBanner] = useState<BannerState | null>(null);
  const [treeLoadError, setTreeLoadError] = useState<string | null>(null);
  const [externalLibrariesError, setExternalLibrariesError] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [indexStatus, setIndexStatus] = useState<CodePaneIndexStatus | null>(null);
  const [languageWorkspaceState, setLanguageWorkspaceState] = useState<CodePaneLanguageWorkspaceState | null>(null);
  const effectiveBottomPanelHeight = useMemo(
    () => clampBottomPanelHeight(bottomPanelHeight, bottomPanelAvailableHeight),
    [bottomPanelAvailableHeight, bottomPanelHeight],
  );
  const editorInlayHintOptions = useMemo(() => ({
    inlayHints: {
      enabled: (areInlayHintsEnabled ? 'on' : 'off') as 'on' | 'off',
    },
    semanticHighlighting: {
      enabled: areSemanticTokensEnabled,
    },
  }), [areInlayHintsEnabled, areSemanticTokensEnabled]);

  const expandedDirectoriesRef = useRef(expandedDirectories);
  const loadedDirectoriesRef = useRef(loadedDirectories);
  const loadedExternalDirectoriesRef = useRef(loadedExternalDirectories);
  const breakpointsRef = useRef(breakpoints);
  const exceptionBreakpointsRef = useRef(exceptionBreakpoints);
  const debugCurrentFrameRef = useRef<CodePaneDebugStackFrame | null>(null);
  const dirtyPathsRef = useRef(new Set<string>());
  const savingPathsRef = useRef(new Set<string>());
  const pendingSavePathsRef = useRef(new Set<string>());
  const activeFilePathRef = useRef(activeFilePath);
  const activeCursorLineNumberRef = useRef(1);
  const activeCursorColumnRef = useRef(1);
  const activeCursorAnimationFrameRef = useRef<number | null>(null);
  const pendingNavigationRef = useRef<FileNavigationLocation | null>(null);
  const openFileLocationRef = useRef<(location: FileNavigationLocation) => Promise<void>>(async () => {});
  const sidebarModeRef = useRef(sidebarMode);
  const sidebarVisibleRef = useRef(isSidebarVisible);
  const bottomPanelModeRef = useRef(bottomPanelMode);
  const sidebarWidthRef = useRef(sidebarWidth);
  const lastExpandedSidebarWidthRef = useRef(lastExpandedSidebarWidth);
  const editorSplitSizeRef = useRef(editorSplitSize);
  const secondaryFilePathRef = useRef(secondaryFilePath);
  const bottomPanelHeightRef = useRef(bottomPanelHeight);
  const bottomPanelAvailableHeightRef = useRef(bottomPanelAvailableHeight);
  const recentFilesRef = useRef<string[]>([]);
  const recentLocationsRef = useRef<NavigationHistoryEntry[]>([]);
  const navigationBackStackRef = useRef<NavigationHistoryEntry[]>([]);
  const navigationForwardStackRef = useRef<NavigationHistoryEntry[]>([]);
  const searchEverywhereControllerRef = useRef<SearchEverywhereControllerHandle | null>(null);
  const navigateBackRef = useRef<() => Promise<void>>(async () => {});
  const navigateForwardRef = useRef<() => Promise<void>>(async () => {});
  const goToImplementationAtCursorRef = useRef<() => Promise<void>>(async () => {});
  const renameSymbolAtCursorRef = useRef<() => Promise<void>>(async () => {});
  const findUsagesAtCursorRef = useRef<() => Promise<void>>(async () => {});
  const formatActiveDocumentRef = useRef<() => Promise<void>>(async () => {});
  const openFileStructurePanelRef = useRef<() => void>(() => {});
  const openHierarchyPanelRef = useRef<(mode: HierarchyMode) => void>(() => {});
  const saveFileRef = useRef<(filePath: string, options?: SaveFileOptions) => Promise<boolean>>(async () => true);
  const codeActionMenuControllerRef = useRef<CodeActionMenuControllerHandle | null>(null);
  const openCodeActionMenuRef = useRef<() => Promise<void>>(async () => {});
  const loadDebugSessionDetailsRef = useRef<(sessionId: string | null) => Promise<void>>(async () => {});
  const toggleBreakpointRef = useRef<(filePath: string, lineNumber: number) => Promise<void>>(async () => {});
  const hierarchyRequestIdRef = useRef(0);
  const documentSymbolsRequestIdRef = useRef(0);
  const semanticRequestIdRef = useRef(0);
  const gitCommitDetailsRequestIdRef = useRef(0);
  const gitCompareRequestIdRef = useRef(0);
  const editorSurfaceRequestIdRef = useRef(0);
  const debugWatchRefreshRequestIdRef = useRef(0);
  const pendingGitSnapshotRefreshRef = useRef<PendingGitSnapshotRefresh | null>(null);
  const gitSnapshotRefreshTimerRef = useRef<number | null>(null);
  const inFlightGitSnapshotRefreshRef = useRef<InFlightGitSnapshotRefresh | null>(null);
  const pendingLoadedDirectoriesRefreshRef = useRef<PendingLoadedDirectoriesRefresh | null>(null);
  const loadedDirectoriesRefreshTimerRef = useRef<number | null>(null);
  const inFlightLoadedDirectoriesRefreshRef = useRef<InFlightLoadedDirectoriesRefresh | null>(null);
  const pendingFsChangesRef = useRef<CodePaneFsChange[]>([]);
  const isFsChangeFlushQueuedRef = useRef(false);
  const fsChangeFlushTimerRef = useRef<number | null>(null);
  const lastAutoPresentedExternalChangeRef = useRef<PendingFsChangeDisplayState | null>(null);
  const blameCacheRef = useRef<Map<string, CodePaneGitBlameLine[]>>(new Map());
  const gitStatusByPathRef = useRef(gitStatusByPath);
  const gitStatusEntriesRef = useRef<CodePaneGitStatusEntry[]>(cachedGitStatusEntries);
  const gitRepositorySummaryRef = useRef<CodePaneGitRepositorySummary | null>(cachedGitSummary);
  const gitGraphRef = useRef<CodePaneGitGraphCommit[]>(cachedGitGraph);
  const externalLibrarySectionsRef = useRef<CodePaneExternalLibrarySection[]>(cachedExternalLibrarySections);
  const gitBranchesRef = useRef<CodePaneGitBranchEntry[]>([]);
  const selectedGitLogCommitShaRef = useRef<string | null>(null);
  const selectedGitChangePathRef = useRef<string | null>(null);
  const selectedGitHunksPathRef = useRef<string | null>(null);
  const gitStagedHunksRef = useRef<CodePaneGitDiffHunk[]>([]);
  const gitUnstagedHunksRef = useRef<CodePaneGitDiffHunk[]>([]);
  const gitHunksErrorRef = useRef<string | null>(null);
  const gitHunksRequestIdRef = useRef(0);
  const commitWindowEntriesCacheRef = useRef<Map<string, CodePaneGitStatusEntry & { relativePath: string }>>(new Map());
  const selectedGitCommitOrderRef = useRef<string[]>(selectedGitCommitOrder);
  const gitRebaseBaseRefRef = useRef(gitRebaseBaseRef);
  const activeGitWorkbenchTabRef = useRef<GitToolWindowTab>('log');
  const isPaneMountedRef = useRef(true);
  const pendingPersistedCodeStateRef = useRef<NonNullable<Pane['code']> | null>(null);
  const persistedCodeStateFlushQueuedRef = useRef(false);

  useEffect(() => {
    paneRef.current = pane;
  }, [pane]);

  useEffect(() => {
    isPaneMountedRef.current = true;
    return () => {
      isPaneMountedRef.current = false;
      persistedCodeStateFlushQueuedRef.current = false;
      pendingPersistedCodeStateRef.current = null;
    };
  }, []);

  useEffect(() => {
    localHistoryEntriesRef.current.clear();
    localHistoryTimersRef.current.forEach((timer) => clearTimeout(timer));
    localHistoryTimersRef.current.clear();
    compactDirectoryPresentationsCacheRef.current.clear();
    setTodoItems((currentItems) => (currentItems.length === 0 ? currentItems : []));
    setTodoError((currentError) => (currentError === null ? currentError : null));
    setLocalHistoryVersion((currentVersion) => currentVersion + 1);
  }, [pane.id, rootPath]);

  useEffect(() => {
    const nextSidebarLayout = getInitialSidebarLayout(pane);
    setSidebarMode((currentMode) => (
      currentMode === nextSidebarLayout.activeView ? currentMode : nextSidebarLayout.activeView
    ));
    setIsSidebarVisible((currentVisible) => (
      currentVisible === nextSidebarLayout.visible ? currentVisible : nextSidebarLayout.visible
    ));
    setSidebarWidth((currentWidth) => (
      currentWidth === nextSidebarLayout.width ? currentWidth : nextSidebarLayout.width
    ));
    setLastExpandedSidebarWidth((currentWidth) => (
      currentWidth === nextSidebarLayout.lastExpandedWidth ? currentWidth : nextSidebarLayout.lastExpandedWidth
    ));
    const nextEditorSplitLayout = getInitialEditorSplitLayout(pane);
    setIsEditorSplitVisible((currentVisible) => (
      currentVisible === nextEditorSplitLayout.visible ? currentVisible : nextEditorSplitLayout.visible
    ));
    setEditorSplitSize((currentSize) => (
      currentSize === nextEditorSplitLayout.size ? currentSize : nextEditorSplitLayout.size
    ));
    setSecondaryFilePath((currentPath) => (
      currentPath === nextEditorSplitLayout.secondaryFilePath ? currentPath : nextEditorSplitLayout.secondaryFilePath
    ));
    const nextBottomPanelLayout = getInitialBottomPanelLayout(pane);
    setBottomPanelHeight((currentHeight) => (
      currentHeight === nextBottomPanelLayout.height ? currentHeight : nextBottomPanelLayout.height
    ));
  }, [pane.id, pane.code?.layout, pane]);

  useEffect(() => {
    expandedDirectoriesRef.current = expandedDirectories;
  }, [expandedDirectories]);

  useEffect(() => {
    loadedDirectoriesRef.current = loadedDirectories;
  }, [loadedDirectories]);

  useEffect(() => {
    loadedExternalDirectoriesRef.current = loadedExternalDirectories;
  }, [loadedExternalDirectories]);

  useEffect(() => {
    const normalizedBreakpoints = normalizeBreakpoints(pane.code?.breakpoints);
    setBreakpoints((currentBreakpoints) => (
      areBreakpointsEqual(currentBreakpoints, normalizedBreakpoints)
        ? currentBreakpoints
        : normalizedBreakpoints
    ));
  }, [pane.id, pane.code?.breakpoints]);

  useEffect(() => {
    breakpointsRef.current = breakpoints;
  }, [breakpoints]);

  useEffect(() => {
    const normalizedExceptionBreakpoints = normalizeExceptionBreakpoints(pane.code?.debug?.exceptionBreakpoints);
    setExceptionBreakpoints((currentBreakpoints) => (
      areExceptionBreakpointsEqual(currentBreakpoints, normalizedExceptionBreakpoints)
        ? currentBreakpoints
        : normalizedExceptionBreakpoints
    ));
  }, [pane.id, pane.code?.debug?.exceptionBreakpoints]);

  useEffect(() => {
    exceptionBreakpointsRef.current = exceptionBreakpoints;
  }, [exceptionBreakpoints]);

  useEffect(() => {
    const normalizedWatchExpressions = normalizeWatchExpressions(pane.code?.debug?.watchExpressions);
    setWatchExpressions((currentWatchExpressions) => (
      areStringListsEqual(currentWatchExpressions, normalizedWatchExpressions)
        ? currentWatchExpressions
        : normalizedWatchExpressions
    ));
  }, [pane.id, pane.code?.debug?.watchExpressions]);

  useEffect(() => {
    activeFilePathRef.current = activeFilePath;
  }, [activeFilePath]);

  useEffect(() => {
    externalLibrarySectionsRef.current = externalLibrarySections;
  }, [externalLibrarySections]);

  useEffect(() => {
    gitStatusEntriesRef.current = gitStatusEntries;
    gitStatusByPathRef.current = gitStatusByPath;
  }, [gitStatusByPath, gitStatusEntries]);

  useEffect(() => {
    externalChangeEntriesRef.current = externalChangeEntries;
  }, [externalChangeEntries]);

  useEffect(() => {
    gitBranchesRef.current = gitBranches;
  }, [gitBranches]);

  useEffect(() => {
    gitRepositorySummaryRef.current = gitRepositorySummary;
  }, [gitRepositorySummary]);

  useEffect(() => {
    gitGraphRef.current = gitGraph;
  }, [gitGraph]);

  useEffect(() => {
    selectedGitLogCommitShaRef.current = selectedGitLogCommitSha;
  }, [selectedGitLogCommitSha]);

  useEffect(() => {
    selectedGitChangePathRef.current = selectedGitChangePath;
  }, [selectedGitChangePath]);

  useEffect(() => {
    selectedRunSessionIdRef.current = selectedRunSessionId;
  }, [selectedRunSessionId]);

  useEffect(() => {
    debugSessionsRef.current = debugSessions;
  }, [debugSessions]);

  useEffect(() => {
    selectedDebugSessionIdRef.current = selectedDebugSessionId;
  }, [selectedDebugSessionId]);

  useEffect(() => {
    selectedGitHunksPathRef.current = selectedGitHunksPath;
  }, [selectedGitHunksPath]);

  useEffect(() => {
    gitStagedHunksRef.current = gitStagedHunks;
  }, [gitStagedHunks]);

  useEffect(() => {
    gitUnstagedHunksRef.current = gitUnstagedHunks;
  }, [gitUnstagedHunks]);

  useEffect(() => {
    gitHunksErrorRef.current = gitHunksError;
  }, [gitHunksError]);

  useEffect(() => {
    selectedGitCommitOrderRef.current = selectedGitCommitOrder;
  }, [selectedGitCommitOrder]);

  useEffect(() => {
    gitRebaseBaseRefRef.current = gitRebaseBaseRef;
  }, [gitRebaseBaseRef]);

  useEffect(() => {
    sidebarModeRef.current = sidebarMode;
  }, [sidebarMode]);

  useEffect(() => {
    sidebarVisibleRef.current = isSidebarVisible;
  }, [isSidebarVisible]);

  useEffect(() => {
    bottomPanelModeRef.current = bottomPanelMode;
  }, [bottomPanelMode]);

  useEffect(() => {
    activeGitWorkbenchTabRef.current = activeGitWorkbenchTab;
  }, [activeGitWorkbenchTab]);

  const applySidebarWidthPreview = useCallback((nextWidth: number) => {
    if (sidebarElementRef.current) {
      sidebarElementRef.current.style.width = `${nextWidth}px`;
    }
  }, []);

  const applyEditorSplitSizePreview = useCallback((nextSize: number) => {
    if (primaryEditorPaneRef.current) {
      primaryEditorPaneRef.current.style.width = `${nextSize * 100}%`;
    }
  }, []);

  const applyBottomPanelHeightPreview = useCallback((nextHeight: number) => {
    if (bottomPanelElementRef.current) {
      bottomPanelElementRef.current.style.height = `${nextHeight}px`;
    }
  }, []);

  useEffect(() => {
    sidebarWidthRef.current = sidebarWidth;
    applySidebarWidthPreview(sidebarWidth);
  }, [applySidebarWidthPreview, sidebarWidth]);

  useEffect(() => {
    lastExpandedSidebarWidthRef.current = lastExpandedSidebarWidth;
  }, [lastExpandedSidebarWidth]);

  useEffect(() => {
    editorSplitSizeRef.current = editorSplitSize;
    applyEditorSplitSizePreview(editorSplitSize);
  }, [applyEditorSplitSizePreview, editorSplitSize]);

  useEffect(() => {
    secondaryFilePathRef.current = secondaryFilePath;
  }, [secondaryFilePath]);

  useEffect(() => {
    revisionDiffFilePathRef.current = pendingGitRevisionDiff?.filePath ?? null;
    pendingGitRevisionDiffRef.current = pendingGitRevisionDiff;
  }, [pendingGitRevisionDiff]);

  useEffect(() => {
    bottomPanelHeightRef.current = bottomPanelHeight;
    applyBottomPanelHeightPreview(bottomPanelHeight);
  }, [applyBottomPanelHeightPreview, bottomPanelHeight]);

  useEffect(() => {
    bottomPanelAvailableHeightRef.current = bottomPanelAvailableHeight;
  }, [bottomPanelAvailableHeight]);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      editorRef.current?.layout?.();
      secondaryEditorRef.current?.layout?.();
      diffEditorRef.current?.layout?.();
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [
    bottomPanelHeight,
    bottomPanelMode,
    editorSplitSize,
    isEditorSplitVisible,
    isSidebarVisible,
    sidebarWidth,
    viewMode,
  ]);

  const layoutEditorSurfaces = useCallback(() => {
    editorRef.current?.layout?.();
    secondaryEditorRef.current?.layout?.();
    diffEditorRef.current?.layout?.();
  }, []);

  const persistCodeState = useCallback((updates: Partial<NonNullable<Pane['code']>>) => {
    if (!isPaneMountedRef.current) {
      return;
    }

    const currentCodeState = {
      rootPath,
      openFiles: [],
      activeFilePath: null,
      selectedPath: null,
      expandedPaths: [rootPath],
      viewMode: 'editor' as const,
      diffTargetPath: null,
      layout: {
        sidebar: getInitialSidebarLayout(paneRef.current),
        bottomPanel: getInitialBottomPanelLayout(paneRef.current),
        editorSplit: getInitialEditorSplitLayout(paneRef.current),
      },
      ...(paneRef.current.code ?? {}),
    };

    if (!hasCodePaneStateUpdates(currentCodeState, updates)) {
      return;
    }

    const nextCodeState = {
      ...currentCodeState,
      ...updates,
    };

    paneRef.current = {
      ...paneRef.current,
      code: nextCodeState,
    };

    if (updates.activeFilePath !== undefined) {
      activeFilePathRef.current = updates.activeFilePath;
    }

    pendingPersistedCodeStateRef.current = nextCodeState;
    if (persistedCodeStateFlushQueuedRef.current) {
      return;
    }

    persistedCodeStateFlushQueuedRef.current = true;
    queueMicrotask(() => {
      persistedCodeStateFlushQueuedRef.current = false;
      const pendingCodeState = pendingPersistedCodeStateRef.current;
      pendingPersistedCodeStateRef.current = null;
      if (!pendingCodeState || !isPaneMountedRef.current) {
        return;
      }

      updatePane(windowId, pane.id, {
        code: pendingCodeState,
      });
    });
  }, [pane.id, rootPath, updatePane, windowId]);

  const getRunTargetCustomization = useCallback((targetId: string): CodePaneRunTargetCustomization => ({
    profiles: paneRef.current.code?.runConfigurations?.[targetId]?.profiles ?? '',
    programArgs: paneRef.current.code?.runConfigurations?.[targetId]?.programArgs ?? '',
    vmArgs: paneRef.current.code?.runConfigurations?.[targetId]?.vmArgs ?? '',
  }), []);

  const updateRunTargetCustomization = useCallback((
    targetId: string,
    updates: Partial<CodePaneRunTargetCustomization>,
  ) => {
    const currentConfigurations = paneRef.current.code?.runConfigurations ?? {};
    const currentCustomization = currentConfigurations[targetId] ?? {
      profiles: '',
      programArgs: '',
      vmArgs: '',
    };
    const nextCustomization = {
      ...currentCustomization,
      ...updates,
    };

    if (areRunTargetCustomizationsEqual(currentCustomization, nextCustomization)) {
      return;
    }

    persistCodeState({
      runConfigurations: {
        ...currentConfigurations,
        [targetId]: nextCustomization,
      },
    });
  }, [persistCodeState]);

  const persistSidebarLayout = useCallback((updates: Partial<NonNullable<NonNullable<Pane['code']>['layout']>['sidebar']>) => {
    const currentSidebarLayout = {
      ...getInitialSidebarLayout(paneRef.current),
      ...(paneRef.current.code?.layout?.sidebar ?? {}),
    };
    const nextSidebarLayout = {
      ...currentSidebarLayout,
      ...updates,
    };

    if (areCodePaneLayoutSidebarsEqual(currentSidebarLayout, nextSidebarLayout)) {
      return;
    }

    persistCodeState({
      layout: {
        ...(paneRef.current.code?.layout ?? {}),
        sidebar: nextSidebarLayout,
      },
    });
  }, [persistCodeState]);

  const persistEditorSplitLayout = useCallback((updates: Partial<NonNullable<NonNullable<NonNullable<Pane['code']>['layout']>['editorSplit']>>) => {
    const currentEditorSplitLayout = {
      ...getInitialEditorSplitLayout(paneRef.current),
      ...(paneRef.current.code?.layout?.editorSplit ?? {}),
    };
    const currentSidebarLayout = {
      ...getInitialSidebarLayout(paneRef.current),
      ...(paneRef.current.code?.layout?.sidebar ?? {}),
    };

    const nextEditorSplitLayout = {
      ...currentEditorSplitLayout,
      ...updates,
      size: clampEditorSplitSize(updates.size ?? currentEditorSplitLayout.size),
      secondaryFilePath: Object.prototype.hasOwnProperty.call(updates, 'secondaryFilePath')
        ? (updates.secondaryFilePath ?? null)
        : (currentEditorSplitLayout.secondaryFilePath ?? null),
    };

    setIsEditorSplitVisible(Boolean(nextEditorSplitLayout.visible));
    setEditorSplitSize(nextEditorSplitLayout.size);
    setSecondaryFilePath(nextEditorSplitLayout.secondaryFilePath);

    if (areCodePaneEditorSplitLayoutsEqual(currentEditorSplitLayout, nextEditorSplitLayout)) {
      return;
    }

    persistCodeState({
      layout: {
        ...(paneRef.current.code?.layout ?? {}),
        sidebar: currentSidebarLayout,
        editorSplit: nextEditorSplitLayout,
      },
    });
  }, [persistCodeState]);

  const persistBottomPanelLayout = useCallback((updates: Partial<NonNullable<NonNullable<NonNullable<Pane['code']>['layout']>['bottomPanel']>>) => {
    const currentBottomPanelLayout = {
      ...getInitialBottomPanelLayout(paneRef.current),
      ...(paneRef.current.code?.layout?.bottomPanel ?? {}),
    };
    const currentSidebarLayout = {
      ...getInitialSidebarLayout(paneRef.current),
      ...(paneRef.current.code?.layout?.sidebar ?? {}),
    };
    const currentEditorSplitLayout = {
      ...getInitialEditorSplitLayout(paneRef.current),
      ...(paneRef.current.code?.layout?.editorSplit ?? {}),
    };
    const availableHeight = getBottomPanelAvailableHeight(
      workspaceLayoutRef.current?.getBoundingClientRect().height,
    );

    const nextBottomPanelLayout = {
      ...currentBottomPanelLayout,
      ...updates,
      height: clampBottomPanelHeight(
        updates.height ?? currentBottomPanelLayout.height,
        availableHeight,
      ),
    };

    setBottomPanelAvailableHeight((currentHeight) => (
      currentHeight === availableHeight ? currentHeight : availableHeight
    ));
    bottomPanelHeightRef.current = nextBottomPanelLayout.height;
    setBottomPanelHeight(nextBottomPanelLayout.height);

    if (areCodePaneBottomPanelLayoutsEqual(currentBottomPanelLayout, nextBottomPanelLayout)) {
      return;
    }

    persistCodeState({
      layout: {
        ...(paneRef.current.code?.layout ?? {}),
        sidebar: currentSidebarLayout,
        bottomPanel: nextBottomPanelLayout,
        editorSplit: currentEditorSplitLayout,
      },
    });
  }, [persistCodeState]);

  useEffect(() => {
    const syncBottomPanelLayout = () => {
      const availableHeight = getBottomPanelAvailableHeight(
        workspaceLayoutRef.current?.getBoundingClientRect().height,
      );
      setBottomPanelAvailableHeight((currentHeight) => (
        currentHeight === availableHeight ? currentHeight : availableHeight
      ));

      const nextHeight = clampBottomPanelHeight(bottomPanelHeightRef.current, availableHeight);
      if (nextHeight !== bottomPanelHeightRef.current) {
        persistBottomPanelLayout({
          height: nextHeight,
        });
      }
    };

    syncBottomPanelLayout();

    const resizeObserver = new ResizeObserver(() => {
      syncBottomPanelLayout();
    });
    const workspaceLayout = workspaceLayoutRef.current;
    if (workspaceLayout) {
      resizeObserver.observe(workspaceLayout);
    }

    window.addEventListener('resize', syncBottomPanelLayout);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', syncBottomPanelLayout);
    };
  }, [bottomPanelMode, persistBottomPanelLayout]);

  const persistDebugState = useCallback((updates: Partial<NonNullable<NonNullable<Pane['code']>['debug']>>) => {
    const currentDebugState = paneRef.current.code?.debug ?? {};
    const nextDebugState = {
      ...currentDebugState,
      ...updates,
    };
    if (areCodePaneDebugStatesEqual(currentDebugState, nextDebugState)) {
      return;
    }
    persistCodeState({
      debug: nextDebugState,
    });
  }, [persistCodeState]);

  const persistSavePipelineState = useCallback((updates: Partial<Required<CodePaneSavePipelineState>>) => {
    const currentSavePipelineState = getInitialSavePipelineState(paneRef.current);
    const nextSavePipelineState = {
      ...currentSavePipelineState,
      ...updates,
    };
    if (
      currentSavePipelineState.formatOnSave === nextSavePipelineState.formatOnSave
      && currentSavePipelineState.organizeImportsOnSave === nextSavePipelineState.organizeImportsOnSave
      && currentSavePipelineState.lintOnSave === nextSavePipelineState.lintOnSave
    ) {
      return;
    }
    persistCodeState({
      savePipeline: nextSavePipelineState,
    });
  }, [persistCodeState]);

  const persistQualityGateState = useCallback((qualityGate: CodePaneSaveQualityState) => {
    void qualityGate;
  }, []);

  const getPersistedExpandedPaths = useCallback((paths: Set<string>) => {
    const persistedPaths: string[] = [];
    for (const directoryPath of paths) {
      if (isPathInside(rootPath, directoryPath)) {
        persistedPaths.push(directoryPath);
      }
    }
    return persistedPaths;
  }, [rootPath]);

  const persistDebugBreakpoints = useCallback((nextBreakpoints: CodePaneBreakpoint[]) => {
    const normalizedBreakpoints = normalizeBreakpoints(nextBreakpoints);
    setBreakpoints((currentBreakpoints) => (
      areBreakpointsEqual(currentBreakpoints, normalizedBreakpoints)
        ? currentBreakpoints
        : normalizedBreakpoints
    ));
    persistCodeState({
      breakpoints: normalizedBreakpoints.map((breakpoint) => ({
        filePath: breakpoint.filePath,
        lineNumber: breakpoint.lineNumber,
        ...(breakpoint.condition ? { condition: breakpoint.condition } : {}),
        ...(breakpoint.logMessage ? { logMessage: breakpoint.logMessage } : {}),
        ...(breakpoint.enabled === false ? { enabled: false } : {}),
      })),
    });
  }, [persistCodeState]);

  const persistExceptionBreakpoints = useCallback((nextBreakpoints: CodePaneExceptionBreakpoint[]) => {
    const normalizedExceptionBreakpoints = normalizeExceptionBreakpoints(nextBreakpoints);
    setExceptionBreakpoints((currentBreakpoints) => (
      areExceptionBreakpointsEqual(currentBreakpoints, normalizedExceptionBreakpoints)
        ? currentBreakpoints
        : normalizedExceptionBreakpoints
    ));
    persistDebugState({
      exceptionBreakpoints: normalizedExceptionBreakpoints.map((breakpoint) => ({
        id: breakpoint.id,
        enabled: breakpoint.enabled,
      })),
    });
  }, [persistDebugState]);

  const persistWatchExpressions = useCallback((nextWatchExpressions: string[]) => {
    const normalizedWatchExpressions = normalizeWatchExpressions(nextWatchExpressions);
    setWatchExpressions((currentWatchExpressions) => (
      areStringListsEqual(currentWatchExpressions, normalizedWatchExpressions)
        ? currentWatchExpressions
        : normalizedWatchExpressions
    ));
    persistDebugState({
      watchExpressions: normalizedWatchExpressions,
    });
  }, [persistDebugState]);

  const updateOpenFileTabs = useCallback((
    updater: (currentOpenFiles: CodePaneOpenFile[]) => CodePaneOpenFile[],
  ) => {
    const currentOpenFiles = paneRef.current.code?.openFiles ?? openFiles;
    const nextOpenFiles = sortOpenFilesByPinned(updater(currentOpenFiles));
    if (areOpenFilesEqual(currentOpenFiles, nextOpenFiles)) {
      return currentOpenFiles;
    }
    const nextPreviewOpenFilePaths = new Set<string>();
    for (const tab of nextOpenFiles) {
      if (tab.preview) {
        nextPreviewOpenFilePaths.add(tab.path);
      }
    }
    previewOpenFilePathsRef.current = nextPreviewOpenFilePaths;
    persistCodeState({
      openFiles: nextOpenFiles,
    });
    return nextOpenFiles;
  }, [openFiles, persistCodeState]);

  const promotePreviewTab = useCallback((filePath: string) => {
    if (!previewOpenFilePathsRef.current.has(filePath)) {
      return;
    }

    updateOpenFileTabs((currentOpenFiles) => currentOpenFiles.map((tab) => (
      tab.path === filePath && tab.preview
        ? { ...tab, preview: false }
        : tab
    )));
  }, [updateOpenFileTabs]);

  const addLocalHistoryEntry = useCallback((
    filePath: string,
    reason: LocalHistoryEntry['reason'],
    content: string,
  ) => {
    if (!filePath || content.length > CODE_PANE_MAX_LOCAL_HISTORY_CONTENT_SIZE) {
      return;
    }

    const normalizedContent = content.replace(/\r\n/g, '\n');
    const existingEntries = localHistoryEntriesRef.current.get(filePath) ?? [];
    const lastEntry = existingEntries[0];
    if (lastEntry?.content === normalizedContent) {
      return;
    }

    const nextEntry: LocalHistoryEntry = {
      id: `${filePath}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      filePath,
      reason,
      label: reason === 'save'
        ? t('codePane.localHistorySaved')
        : reason === 'draft'
          ? t('codePane.localHistoryDraft')
          : reason === 'restore'
            ? t('codePane.localHistoryRestorePoint')
            : t('codePane.localHistoryOpened'),
      timestamp: Date.now(),
      content: normalizedContent,
      preview: getLocalHistoryPreview(normalizedContent),
    };

    localHistoryEntriesRef.current.set(filePath, [
      nextEntry,
      ...existingEntries,
    ].slice(0, CODE_PANE_MAX_LOCAL_HISTORY_PER_FILE));
    if (bottomPanelModeRef.current === 'workspace') {
      setLocalHistoryVersion((currentVersion) => currentVersion + 1);
    }
  }, [t]);

  const scheduleLocalHistorySnapshot = useCallback((filePath: string) => {
    const existingTimer = localHistoryTimersRef.current.get(filePath);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    localHistoryTimersRef.current.set(filePath, setTimeout(() => {
      localHistoryTimersRef.current.delete(filePath);
      const model = fileModelsRef.current.get(filePath);
      if (!model) {
        return;
      }

      addLocalHistoryEntry(filePath, 'draft', model.getValue());
    }, CODE_PANE_LOCAL_HISTORY_CHANGE_DEBOUNCE_MS));
  }, [addLocalHistoryEntry]);


  const trackRequest = useCallback(async <T,>(
    key: string,
    label: string,
    meta: string | undefined,
    request: () => Promise<T>,
  ) => {
    const handle = runtimeStoreRef.current.beginRequest(key, label, meta);

    try {
      const result = await request();
      runtimeStoreRef.current.finishRequest(handle, 'completed');
      return result;
    } catch (error) {
      runtimeStoreRef.current.finishRequest(handle, 'error', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }, []);

  const loadSelectedGitCommitDetails = useCallback(async (commitSha: string) => {
    const requestKey = `git-commit-details:${rootPath}`;
    const requestVersion = ++gitCommitDetailsRequestIdRef.current;
    const cacheKey = `${requestKey}:${commitSha}`;
    const cachedDetails = runtimeStoreRef.current.getCache<CodePaneGitCommitDetails>(
      cacheKey,
      CODE_PANE_TOOL_WINDOW_CACHE_TTL_MS,
    );
    if (cachedDetails) {
      runtimeStoreRef.current.recordRequest(requestKey, t('codePane.requestGitCommitDetails'), {
        meta: commitSha.slice(0, 7),
        fromCache: true,
      });
      setSelectedGitCommitDetails((currentDetails) => (
        areGitCommitDetailsEqual(currentDetails, cachedDetails) ? currentDetails : cachedDetails
      ));
      setComparedGitCommits((currentComparison) => (currentComparison === null ? currentComparison : null));
      setGitCommitDetailsError((currentError) => (currentError === null ? currentError : null));
      setIsGitCommitDetailsLoading((currentLoading) => (currentLoading ? false : currentLoading));
      return;
    }

    setIsGitCommitDetailsLoading((currentLoading) => (currentLoading ? currentLoading : true));
    setGitCommitDetailsError((currentError) => (currentError === null ? currentError : null));
    try {
      const response = await trackRequest(
        requestKey,
        t('codePane.requestGitCommitDetails'),
        commitSha.slice(0, 7),
        async () => await window.electronAPI.codePaneGetGitCommitDetails({
          rootPath,
          commitSha,
        }),
      );
      if (gitCommitDetailsRequestIdRef.current !== requestVersion) {
        return;
      }
      if (!response.success || !response.data) {
        throw new Error(response.error || t('common.retry'));
      }
      const nextDetails = response.data;
      runtimeStoreRef.current.setCache(cacheKey, nextDetails);
      setSelectedGitCommitDetails((currentDetails) => (
        areGitCommitDetailsEqual(currentDetails, nextDetails) ? currentDetails : nextDetails
      ));
      setComparedGitCommits((currentComparison) => (currentComparison === null ? currentComparison : null));
    } catch (error) {
      if (gitCommitDetailsRequestIdRef.current !== requestVersion) {
        return;
      }
      const nextError = error instanceof Error ? error.message : t('common.retry');
      setGitCommitDetailsError((currentError) => (
        currentError === nextError ? currentError : nextError
      ));
      setSelectedGitCommitDetails((currentDetails) => (currentDetails === null ? currentDetails : null));
    } finally {
      if (gitCommitDetailsRequestIdRef.current === requestVersion) {
        setIsGitCommitDetailsLoading((currentLoading) => (currentLoading === false ? currentLoading : false));
      }
    }
  }, [rootPath, t, trackRequest]);

  const compareSelectedGitCommits = useCallback(async (baseCommitSha: string, targetCommitSha: string) => {
    const requestKey = `git-compare:${rootPath}`;
    const requestVersion = ++gitCompareRequestIdRef.current;
    const cacheKey = `${requestKey}:${baseCommitSha}:${targetCommitSha}`;
    const cachedComparison = runtimeStoreRef.current.getCache<CodePaneGitCompareCommitsResult>(
      cacheKey,
      CODE_PANE_TOOL_WINDOW_CACHE_TTL_MS,
    );
    if (cachedComparison) {
      runtimeStoreRef.current.recordRequest(requestKey, t('codePane.requestGitCompareCommits'), {
        meta: `${baseCommitSha.slice(0, 7)}..${targetCommitSha.slice(0, 7)}`,
        fromCache: true,
      });
      setComparedGitCommits((currentComparison) => (
        areGitCompareCommitsEqual(currentComparison, cachedComparison) ? currentComparison : cachedComparison
      ));
      setSelectedGitCommitDetails((currentDetails) => (currentDetails === null ? currentDetails : null));
      setGitCommitDetailsError((currentError) => (currentError === null ? currentError : null));
      setIsGitCommitDetailsLoading((currentLoading) => (currentLoading ? false : currentLoading));
      return;
    }

    setIsGitCommitDetailsLoading((currentLoading) => (currentLoading ? currentLoading : true));
    setGitCommitDetailsError((currentError) => (currentError === null ? currentError : null));
    try {
      const response = await trackRequest(
        requestKey,
        t('codePane.requestGitCompareCommits'),
        `${baseCommitSha.slice(0, 7)}..${targetCommitSha.slice(0, 7)}`,
        async () => await window.electronAPI.codePaneCompareGitCommits({
          rootPath,
          baseCommitSha,
          targetCommitSha,
        }),
      );
      if (gitCompareRequestIdRef.current !== requestVersion) {
        return;
      }
      if (!response.success || !response.data) {
        throw new Error(response.error || t('common.retry'));
      }
      const nextComparison = response.data;
      runtimeStoreRef.current.setCache(cacheKey, nextComparison);
      setComparedGitCommits((currentComparison) => (
        areGitCompareCommitsEqual(currentComparison, nextComparison) ? currentComparison : nextComparison
      ));
      setSelectedGitCommitDetails((currentDetails) => (currentDetails === null ? currentDetails : null));
    } catch (error) {
      if (gitCompareRequestIdRef.current !== requestVersion) {
        return;
      }
      const nextError = error instanceof Error ? error.message : t('common.retry');
      setGitCommitDetailsError((currentError) => (
        currentError === nextError ? currentError : nextError
      ));
      setComparedGitCommits((currentComparison) => (currentComparison === null ? currentComparison : null));
    } finally {
      if (gitCompareRequestIdRef.current === requestVersion) {
        setIsGitCommitDetailsLoading((currentLoading) => (currentLoading === false ? currentLoading : false));
      }
    }
  }, [rootPath, t, trackRequest]);

  const loadExceptionBreakpoints = useCallback(async () => {
    const persistedExceptionBreakpoints = paneRef.current.code?.debug?.exceptionBreakpoints;
    const requestKey = `exception-breakpoints:${rootPath}`;
    const requestVersion = runtimeStoreRef.current.markLatest(requestKey);
    if ((persistedExceptionBreakpoints?.length ?? 0) > 0) {
      const normalizedPersistedBreakpoints = normalizeExceptionBreakpoints(persistedExceptionBreakpoints);
      const syncResponse = await trackRequest(
        requestKey,
        t('codePane.requestExceptionBreakpoints'),
        rootPath,
        async () => await dedupeProjectRequest(
          rootPath,
          'exception-breakpoints:sync',
          async () => await window.electronAPI.codePaneSetExceptionBreakpoints({
            rootPath,
            breakpoints: normalizedPersistedBreakpoints,
          }),
        ),
      );
      if (!runtimeStoreRef.current.isLatest(requestKey, requestVersion)) {
        return;
      }
      if (syncResponse.success) {
        runtimeStoreRef.current.setCache(requestKey, normalizedPersistedBreakpoints);
        setExceptionBreakpoints((currentBreakpoints) => (
          areExceptionBreakpointsEqual(currentBreakpoints, normalizedPersistedBreakpoints)
            ? currentBreakpoints
            : normalizedPersistedBreakpoints
        ));
      }
      return;
    }

    const cachedBreakpoints = runtimeStoreRef.current.getCache<CodePaneExceptionBreakpoint[]>(
      requestKey,
      CODE_PANE_TOOL_WINDOW_CACHE_TTL_MS,
    );
    if (cachedBreakpoints) {
      runtimeStoreRef.current.recordRequest(requestKey, t('codePane.requestExceptionBreakpoints'), {
        meta: rootPath,
        fromCache: true,
      });
      persistExceptionBreakpoints(cachedBreakpoints);
      return;
    }

    const response = await trackRequest(
      requestKey,
      t('codePane.requestExceptionBreakpoints'),
      rootPath,
      async () => await dedupeProjectRequest(
        rootPath,
        'exception-breakpoints',
        async () => await window.electronAPI.codePaneGetExceptionBreakpoints({
          rootPath,
        }),
      ),
    );
    if (!runtimeStoreRef.current.isLatest(requestKey, requestVersion)) {
      return;
    }
    if (!response.success) {
      setBanner({
        tone: 'error',
        message: response.error || t('common.retry'),
      });
      return;
    }

    const nextBreakpoints = response.data ?? CODE_PANE_DEFAULT_EXCEPTION_BREAKPOINTS;
    runtimeStoreRef.current.setCache(requestKey, nextBreakpoints);
    persistExceptionBreakpoints(nextBreakpoints);
  }, [persistExceptionBreakpoints, rootPath, t, trackRequest]);

  const loadDebugSessions = useCallback(async () => {
    const requestKey = `debug-sessions:${rootPath}`;
    const requestVersion = runtimeStoreRef.current.markLatest(requestKey);
    const cachedSnapshots = runtimeStoreRef.current.getCache<CodePaneDebugSessionSnapshot[]>(
      requestKey,
      CODE_PANE_TOOL_WINDOW_CACHE_TTL_MS,
    );
    if (cachedSnapshots) {
      runtimeStoreRef.current.recordRequest(requestKey, t('codePane.requestDebugSessions'), {
        meta: rootPath,
        fromCache: true,
      });
      const cachedSessions = cachedSnapshots.map((snapshot) => snapshot.session);
      setDebugSessions((currentSessions) => (
        areDebugSessionsEqual(currentSessions, cachedSessions) ? currentSessions : cachedSessions
      ));
      debugSessionOutputsRef.current = cachedSnapshots.reduce<Record<string, string>>((accumulator, snapshot) => {
        accumulator[snapshot.session.id] = snapshot.output;
        return accumulator;
      }, {});
      setSelectedDebugSessionId((currentSelectedSessionId) => {
        if (currentSelectedSessionId && cachedSnapshots.some((snapshot) => snapshot.session.id === currentSelectedSessionId)) {
          return currentSelectedSessionId;
        }
        const nextSelectedSessionId = cachedSnapshots[0]?.session.id ?? null;
        return currentSelectedSessionId === nextSelectedSessionId ? currentSelectedSessionId : nextSelectedSessionId;
      });
      return;
    }

    const response = await trackRequest(
      requestKey,
      t('codePane.requestDebugSessions'),
      rootPath,
      async () => await dedupeProjectRequest(
        rootPath,
        'debug-sessions',
        async () => await window.electronAPI.codePaneListDebugSessions({
          rootPath,
        }),
      ),
    );
    if (!runtimeStoreRef.current.isLatest(requestKey, requestVersion)) {
      return;
    }
    if (!response.success) {
      setBanner({
        tone: 'error',
        message: response.error || t('common.retry'),
      });
      return;
    }

    const snapshots = response.data ?? [];
    runtimeStoreRef.current.setCache(requestKey, snapshots);
    const nextSessions = snapshots.map((snapshot) => snapshot.session);
    setDebugSessions((currentSessions) => (
      areDebugSessionsEqual(currentSessions, nextSessions) ? currentSessions : nextSessions
    ));
    debugSessionOutputsRef.current = snapshots.reduce<Record<string, string>>((accumulator, snapshot) => {
      accumulator[snapshot.session.id] = snapshot.output;
      return accumulator;
    }, {});
    setSelectedDebugSessionId((currentSelectedSessionId) => {
      if (currentSelectedSessionId && snapshots.some((snapshot) => snapshot.session.id === currentSelectedSessionId)) {
        return currentSelectedSessionId;
      }
      const nextSelectedSessionId = snapshots[0]?.session.id ?? null;
      return currentSelectedSessionId === nextSelectedSessionId ? currentSelectedSessionId : nextSelectedSessionId;
    });
  }, [rootPath, t, trackRequest]);

  useEffect(() => {
    for (const breakpoint of breakpointsRef.current) {
      void window.electronAPI.codePaneSetBreakpoint({
        rootPath,
        breakpoint,
      });
    }
  }, [rootPath]);

  const toggleSidebarVisibility = useCallback((nextVisible?: boolean) => {
    const shouldShowSidebar = nextVisible ?? !sidebarVisibleRef.current;
    const restoredWidth = clampSidebarWidth(lastExpandedSidebarWidthRef.current);
    const nextWidth = shouldShowSidebar ? restoredWidth : sidebarWidthRef.current;
    const nextLastExpandedWidth = shouldShowSidebar
      ? restoredWidth
      : clampSidebarWidth(sidebarWidthRef.current);

    setIsSidebarVisible(shouldShowSidebar);
    setSidebarWidth(nextWidth);
    setLastExpandedSidebarWidth(nextLastExpandedWidth);
    sidebarVisibleRef.current = shouldShowSidebar;
    sidebarWidthRef.current = nextWidth;
    lastExpandedSidebarWidthRef.current = nextLastExpandedWidth;
    persistSidebarLayout({
      visible: shouldShowSidebar,
      activeView: sidebarModeRef.current,
      width: nextWidth,
      lastExpandedWidth: nextLastExpandedWidth,
    });
  }, [persistSidebarLayout]);

  const showSidebarMode = useCallback((mode: SidebarMode) => {
    const nextWidth = clampSidebarWidth(lastExpandedSidebarWidthRef.current);
    setSidebarMode(mode);
    setIsSidebarVisible(true);
    setSidebarWidth(nextWidth);
    setLastExpandedSidebarWidth(nextWidth);
    sidebarModeRef.current = mode;
    sidebarVisibleRef.current = true;
    sidebarWidthRef.current = nextWidth;
    lastExpandedSidebarWidthRef.current = nextWidth;
    persistSidebarLayout({
      visible: true,
      activeView: mode,
      width: nextWidth,
      lastExpandedWidth: nextWidth,
    });
  }, [persistSidebarLayout]);

  const handleSidebarModeSelect = useCallback((mode: SidebarMode) => {
    const isSameMode = sidebarModeRef.current === mode;
    if (isSameMode) {
      toggleSidebarVisibility();
      return;
    }

    showSidebarMode(mode);
  }, [showSidebarMode, toggleSidebarVisibility]);

  useEffect(() => {
    if (!isActive) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.shiftKey) {
        return;
      }

      const isPrimaryModifier = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
      if (!isPrimaryModifier || event.key.toLowerCase() !== 'b') {
        return;
      }

      event.preventDefault();
      toggleSidebarVisibility();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isActive, isMac, toggleSidebarVisibility]);

  useEffect(() => (
    () => {
      sidebarResizeCleanupRef.current?.();
      sidebarResizeCleanupRef.current = null;
      editorSplitResizeCleanupRef.current?.();
      editorSplitResizeCleanupRef.current = null;
      bottomPanelResizeCleanupRef.current?.();
      bottomPanelResizeCleanupRef.current = null;
    }
  ), []);

  const clearBannerForFile = useCallback((filePath?: string | null) => {
    if (!filePath) {
      return;
    }

    setBanner((currentBanner) => (
      currentBanner && currentBanner.filePath === filePath ? null : currentBanner
    ));
  }, []);

  const scheduleActiveCursorUpdate = useCallback((lineNumber: number, column: number) => {
    activeCursorLineNumberRef.current = lineNumber;
    activeCursorColumnRef.current = column;

    if (activeCursorAnimationFrameRef.current !== null) {
      return;
    }

    activeCursorAnimationFrameRef.current = window.requestAnimationFrame(() => {
      activeCursorAnimationFrameRef.current = null;
      const nextLineNumber = activeCursorLineNumberRef.current;
      const nextColumn = activeCursorColumnRef.current;
      cursorStoreRef.current.setSnapshot({
        lineNumber: nextLineNumber,
        column: nextColumn,
      });
    });
  }, []);

  const markSaving = useCallback((filePath: string, saving: boolean) => {
    const currentSavingPaths = savingPathsRef.current;
    if (saving) {
      currentSavingPaths.add(filePath);
    } else {
      currentSavingPaths.delete(filePath);
    }
  }, []);

  const gitDirectoryStatusByPath = useMemo(
    () => collectGitDirectoryStatuses(rootPath, gitStatusEntries),
    [gitStatusEntries, rootPath],
  );

  const getEntryStatus = useCallback((entryPath: string, entryType: CodePaneTreeEntry['type']) => {
    if (gitStatusByPath[entryPath]) {
      return gitStatusByPath[entryPath].status;
    }

    if (entryType === 'directory') {
      return gitDirectoryStatusByPath[entryPath];
    }

    return undefined;
  }, [gitDirectoryStatusByPath, gitStatusByPath]);

  const refreshProblems = useCallback((filePaths?: Iterable<string> | null) => {
    const monaco = monacoRef.current;
    if (!monaco) {
      problemsByFileRef.current.clear();
      setProblems((currentProblems) => (
        currentProblems.length === 0 ? currentProblems : []
      ));
      return;
    }

    const nextProblemsByFile = filePaths
      ? new Map(problemsByFileRef.current)
      : new Map<string, Array<MonacoMarker & { filePath: string }>>();
    if (filePaths) {
      for (const filePath of filePaths) {
        if (!filePath) {
          continue;
        }

        const model = fileModelsRef.current.get(filePath);
        if (!model) {
          nextProblemsByFile.delete(filePath);
          continue;
        }

        const nextFileProblems = monaco.editor.getModelMarkers({ resource: model.uri }).map((marker) => ({
          ...marker,
          filePath,
        }));
        if (nextFileProblems.length === 0) {
          nextProblemsByFile.delete(filePath);
        } else {
          nextProblemsByFile.set(filePath, nextFileProblems);
        }
      }
    } else {
      for (const [filePath, model] of fileModelsRef.current.entries()) {
        const nextFileProblems = monaco.editor.getModelMarkers({ resource: model.uri }).map((marker) => ({
          ...marker,
          filePath,
        }));
        if (nextFileProblems.length > 0) {
          nextProblemsByFile.set(filePath, nextFileProblems);
        }
      }
    }

    const nextProblems: Array<MonacoMarker & { filePath: string }> = [];
    for (const fileProblems of nextProblemsByFile.values()) {
      for (const problem of fileProblems) {
        nextProblems.push(problem);
      }
    }
    nextProblems.sort((left, right) => {
      if (left.severity !== right.severity) {
        return right.severity - left.severity;
      }

      if (left.filePath !== right.filePath) {
        return left.filePath.localeCompare(right.filePath, undefined, { sensitivity: 'base' });
      }

      if (left.startLineNumber !== right.startLineNumber) {
        return left.startLineNumber - right.startLineNumber;
      }

      return left.startColumn - right.startColumn;
    });

    problemsByFileRef.current = nextProblemsByFile;
    startTransition(() => {
      setProblems((currentProblems) => (
        areProblemListsEqual(currentProblems, nextProblems) ? currentProblems : nextProblems
      ));
    });
  }, []);

  const scheduleProblemsRefresh = useCallback((filePaths?: Iterable<string> | null) => {
    let pendingRefresh = pendingProblemsRefreshRef.current;
    if (!pendingRefresh) {
      pendingRefresh = {
        refreshAll: false,
        paths: new Set<string>(),
      };
      pendingProblemsRefreshRef.current = pendingRefresh;
    }

    if (!filePaths) {
      pendingRefresh.refreshAll = true;
      pendingRefresh.paths.clear();
    } else if (!pendingRefresh.refreshAll) {
      for (const filePath of filePaths) {
        if (filePath) {
          pendingRefresh.paths.add(filePath);
        }
      }
    }

    if (problemsRefreshAnimationFrameRef.current !== null) {
      return;
    }

    problemsRefreshAnimationFrameRef.current = window.requestAnimationFrame(() => {
      problemsRefreshAnimationFrameRef.current = null;
      const currentPendingRefresh = pendingProblemsRefreshRef.current;
      pendingProblemsRefreshRef.current = null;
      if (!currentPendingRefresh) {
        return;
      }

      refreshProblems(
        currentPendingRefresh.refreshAll
          ? undefined
          : currentPendingRefresh.paths,
      );
    });
  }, [refreshProblems]);

  const ensureMarkerListener = useCallback((monaco: MonacoModule) => {
    if (markerListenerRef.current) {
      return;
    }

    markerListenerRef.current = monaco.editor.onDidChangeMarkers((resources?: unknown) => {
      if (!Array.isArray(resources) || resources.length === 0) {
        scheduleProblemsRefresh();
        return;
      }
      const changedFilePaths = new Set<string>();
      for (const resource of resources) {
        if (!resource || typeof resource !== 'object' || !('path' in resource)) {
          scheduleProblemsRefresh();
          return;
        }
        const filePath = modelFilePathRef.current.get(resource.path)
          ?? ('fsPath' in resource ? resource.fsPath : undefined)
          ?? resource.path;
        if (filePath) {
          changedFilePaths.add(filePath);
        }
      }
      scheduleProblemsRefresh(changedFilePaths);
    });
  }, [scheduleProblemsRefresh]);

  const ensureMonacoReady = useCallback(async (): Promise<MonacoModule | null> => {
    if (!supportsMonaco) {
      return null;
    }

    try {
      const monaco = monacoRef.current ?? await ensureMonacoEnvironment(language);
      monacoRef.current = monaco;
      languageBridgeRef.current = ensureMonacoLanguageBridge(monaco);
      ensureMarkerListener(monaco);
      return monaco;
    } catch (error) {
      setBanner((currentBanner) => (
        currentBanner ?? {
          tone: 'error',
          message: error instanceof Error ? error.message : t('common.retry'),
        }
      ));
      return null;
    }
  }, [ensureMarkerListener, language, supportsMonaco, t]);

  const buildLanguageDocumentContext = useCallback((filePath: string) => {
    const model = fileModelsRef.current.get(filePath);
    const fileMeta = fileMetaRef.current.get(filePath);
    if (!model) {
      return null;
    }

    if (fileMeta?.readOnly) {
      return null;
    }

    return {
      paneId: pane.id,
      rootPath,
      filePath,
      language: fileMeta?.language ?? model.getLanguageId(),
      model,
    };
  }, [pane.id, rootPath]);

  const syncLanguageDocument = useCallback(async (
    filePath: string,
    reason: 'open' | 'change' | 'save',
  ) => {
    const bridge = languageBridgeRef.current ?? (
      monacoRef.current ? ensureMonacoLanguageBridge(monacoRef.current) : null
    );
    languageBridgeRef.current = bridge;
    const context = buildLanguageDocumentContext(filePath);
    if (!bridge || !context) {
      return;
    }

    if (reason === 'open') {
      bridge.openDocument(context);
      return;
    }

    if (reason === 'change') {
      await bridge.changeDocument(context);
      return;
    }

    await bridge.saveDocument(context);
  }, [buildLanguageDocumentContext]);

  const queueLanguageDocumentSync = useCallback((
    filePath: string,
    reason: 'open' | 'change' | 'save' | 'close',
    task: () => Promise<void>,
  ) => {
    const currentQueue = documentSyncQueueRef.current.get(filePath) ?? Promise.resolve();
    const nextQueue = currentQueue
      .catch(() => {})
      .then(async () => {
        await task();
      })
      .catch((error) => {
        console.warn(`[CodePane] Failed to ${reason} language document for ${filePath}`, error);
      });

    documentSyncQueueRef.current.set(filePath, nextQueue);
    return nextQueue.finally(() => {
      if (documentSyncQueueRef.current.get(filePath) === nextQueue) {
        documentSyncQueueRef.current.delete(filePath);
      }
    });
  }, []);

  const scheduleLanguageDocumentChangeSync = useCallback((filePath: string) => {
    const existingDocumentSyncTimer = documentSyncTimersRef.current.get(filePath);
    if (existingDocumentSyncTimer) {
      clearTimeout(existingDocumentSyncTimer);
    }

    documentSyncTimersRef.current.set(filePath, setTimeout(() => {
      documentSyncTimersRef.current.delete(filePath);
      void queueLanguageDocumentSync(filePath, 'change', async () => {
        await syncLanguageDocument(filePath, 'change');
      });
    }, 150));
  }, [queueLanguageDocumentSync, syncLanguageDocument]);

  const scheduleAutoSave = useCallback((filePath: string) => {
    const existingTimer = autoSaveTimersRef.current.get(filePath);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    autoSaveTimersRef.current.set(filePath, setTimeout(() => {
      autoSaveTimersRef.current.delete(filePath);
      void saveFileRef.current(filePath);
    }, 800));
  }, []);

  const flushPendingLanguageSync = useCallback(async (filePath: string) => {
    const timer = documentSyncTimersRef.current.get(filePath);
    if (!timer) {
      return;
    }

    clearTimeout(timer);
    documentSyncTimersRef.current.delete(filePath);
    await queueLanguageDocumentSync(filePath, 'change', async () => {
      await syncLanguageDocument(filePath, 'change');
    });
  }, [queueLanguageDocumentSync, syncLanguageDocument]);

  const enqueuePendingLanguageSync = useCallback((filePath: string) => {
    const timer = documentSyncTimersRef.current.get(filePath);
    if (!timer) {
      return;
    }

    clearTimeout(timer);
    documentSyncTimersRef.current.delete(filePath);
    void queueLanguageDocumentSync(filePath, 'change', async () => {
      await syncLanguageDocument(filePath, 'change');
    });
  }, [queueLanguageDocumentSync, syncLanguageDocument]);

  const closeLanguageDocument = useCallback(async (filePath: string) => {
    const bridge = languageBridgeRef.current ?? (
      monacoRef.current ? ensureMonacoLanguageBridge(monacoRef.current) : null
    );
    languageBridgeRef.current = bridge;
    const context = buildLanguageDocumentContext(filePath);
    const timer = documentSyncTimersRef.current.get(filePath);
    if (timer) {
      clearTimeout(timer);
      documentSyncTimersRef.current.delete(filePath);
    }

    if (!bridge || !context) {
      return;
    }

    await queueLanguageDocumentSync(filePath, 'close', async () => {
      await bridge.closeDocument(context);
    });
  }, [buildLanguageDocumentContext, queueLanguageDocumentSync]);

  const closeAllLanguageDocuments = useCallback(async () => {
    for (const filePath of fileModelsRef.current.keys()) {
      await closeLanguageDocument(filePath);
    }
  }, [closeLanguageDocument]);

  const clearDefinitionLookupCache = useCallback(() => {
    definitionLookupCacheRef.current.clear();
  }, []);

  const getModelRequestPath = useCallback((filePath: string) => (
    fileMetaRef.current.get(filePath)?.documentUri ?? filePath
  ), []);

  const invalidateDefinitionLookupCacheForFile = useCallback((filePath: string) => {
    const requestPath = getModelRequestPath(filePath);
    for (const cacheKey of Array.from(definitionLookupCacheRef.current.keys())) {
      if (cacheKey.startsWith(`${requestPath}:`)) {
        definitionLookupCacheRef.current.delete(cacheKey);
      }
    }
  }, [getModelRequestPath]);

  const invalidateDocumentRuntimeCaches = useCallback((filePath: string) => {
    invalidateDefinitionLookupCacheForFile(filePath);
    const requestPath = getModelRequestPath(filePath);
    runtimeStoreRef.current.invalidateCachePrefix(`quick-documentation:${requestPath}:`);
    runtimeStoreRef.current.invalidateCachePrefix(`document-symbols:${requestPath}`);
    runtimeStoreRef.current.invalidateCachePrefix(`hierarchy:call-incoming:${requestPath}:`);
    runtimeStoreRef.current.invalidateCachePrefix(`hierarchy:call-outgoing:${requestPath}:`);
    runtimeStoreRef.current.invalidateCachePrefix(`hierarchy:type-parents:${requestPath}:`);
    runtimeStoreRef.current.invalidateCachePrefix(`hierarchy:type-children:${requestPath}:`);
    runtimeStoreRef.current.invalidateCachePrefix(`semantic:${requestPath}`);
  }, [getModelRequestPath, invalidateDefinitionLookupCacheForFile]);

  const invalidateWorkspaceRuntimeCaches = useCallback((filePath: string) => {
    invalidateDocumentRuntimeCaches(filePath);
    blameCacheRef.current.delete(filePath);
    runtimeStoreRef.current.invalidateCachePrefix(`git-history:${rootPath}:${filePath}:`);
    runtimeStoreRef.current.invalidateCachePrefix(`git-conflict:${rootPath}:${filePath}`);
    runtimeStoreRef.current.invalidateCachePrefix(`git-hunks:${rootPath}:${filePath}`);
    runtimeStoreRef.current.invalidateCachePrefix(`git-blame:${rootPath}:${filePath}`);
    runtimeStoreRef.current.invalidateCachePrefix(`search-everywhere:${rootPath}:`);
    runtimeStoreRef.current.invalidateCachePrefix(`search-files:${rootPath}:`);
    runtimeStoreRef.current.invalidateCachePrefix(`search-contents:${rootPath}:`);
    runtimeStoreRef.current.invalidateCachePrefix(`workspace-symbols:${rootPath}:`);
    runtimeStoreRef.current.invalidateCachePrefix(`todo-scan:${rootPath}`);
  }, [invalidateDocumentRuntimeCaches, rootPath]);

  const markDirty = useCallback((filePath: string, dirty: boolean) => {
    const currentDirtyPaths = dirtyPathsRef.current;
    if (currentDirtyPaths.has(filePath) === dirty) {
      return;
    }

    if (dirty) {
      currentDirtyPaths.add(filePath);
      invalidateDocumentRuntimeCaches(filePath);
    } else {
      currentDirtyPaths.delete(filePath);
    }
  }, [invalidateDocumentRuntimeCaches]);

  const getDefinitionLookupRange = useCallback((model: MonacoModel, lineNumber: number, column: number): MonacoRange => {
    const normalizedPosition = normalizeDefinitionLookupPositionForModel(model, lineNumber, column);
    const word = model.getWordAtPosition?.(normalizedPosition);
    if (!word) {
      return createFallbackRange(normalizedPosition.lineNumber, normalizedPosition.column);
    }

    return {
      startLineNumber: normalizedPosition.lineNumber,
      startColumn: word.startColumn,
      endLineNumber: normalizedPosition.lineNumber,
      endColumn: word.endColumn,
    };
  }, []);

  const normalizeDefinitionLookupPosition = useCallback((model: MonacoModel, lineNumber: number, column: number) => {
    return normalizeDefinitionLookupPositionForModel(model, lineNumber, column);
  }, []);

  const getDefinitionLookupKey = useCallback((model: MonacoModel, filePath: string, lineNumber: number, column: number) => {
    const normalizedPosition = normalizeDefinitionLookupPosition(model, lineNumber, column);
    const range = getDefinitionLookupRange(model, normalizedPosition.lineNumber, normalizedPosition.column);
    const requestPath = getModelRequestPath(filePath);
    return `${requestPath}:${model.getLanguageId()}:${range.startLineNumber}:${range.startColumn}:${range.endColumn}`;
  }, [getDefinitionLookupRange, getModelRequestPath, normalizeDefinitionLookupPosition]);

  const lookupDefinitionTarget = useCallback(async (
    model: MonacoModel,
    filePath: string,
    lineNumber: number,
    column: number,
    options?: {
      showErrors?: boolean;
    },
  ) => {
    const requestPath = getModelRequestPath(filePath);
    const normalizedPosition = normalizeDefinitionLookupPosition(model, lineNumber, column);
    const requestKey = getDefinitionLookupKey(
      model,
      filePath,
      normalizedPosition.lineNumber,
      normalizedPosition.column,
    );

    let pendingLookup = definitionLookupCacheRef.current.get(requestKey);
    if (!pendingLookup) {
      pendingLookup = window.electronAPI.codePaneGetDefinition({
        rootPath,
        filePath: requestPath,
        language: model.getLanguageId(),
        position: {
          lineNumber: normalizedPosition.lineNumber,
          column: normalizedPosition.column,
        },
      }).then((response): DefinitionLookupResult => {
        if (!response.success) {
          return {
            location: null,
            error: response.error || t('common.retry'),
          };
        }

        return {
          location: response.data?.[0] ?? null,
        };
      }).catch((error): DefinitionLookupResult => ({
        location: null,
        error: error instanceof Error ? error.message : t('common.retry'),
      }));
      definitionLookupCacheRef.current.set(requestKey, pendingLookup);
    }

    const result = await pendingLookup;
    if (result.error && options?.showErrors) {
      setBanner({
        tone: 'warning',
        message: result.error,
        filePath,
      });
    }

    return {
      requestKey,
      range: getDefinitionLookupRange(model, normalizedPosition.lineNumber, normalizedPosition.column),
      location: result.location,
    };
  }, [getDefinitionLookupKey, getDefinitionLookupRange, getModelRequestPath, normalizeDefinitionLookupPosition, rootPath, t]);

  const clearDefinitionLinkDecoration = useCallback((editorInstance?: MonacoEditor | null) => {
    const targetEditor = editorInstance ?? definitionLinkDecorationEditorRef.current;
    if (targetEditor && typeof targetEditor.deltaDecorations === 'function') {
      definitionLinkDecorationIdsRef.current = targetEditor.deltaDecorations(
        definitionLinkDecorationIdsRef.current,
        [],
      );
    } else {
      definitionLinkDecorationIdsRef.current = [];
    }

    if (!editorInstance || targetEditor === definitionLinkDecorationEditorRef.current) {
      definitionLinkDecorationEditorRef.current = null;
    }

    definitionHoverRequestKeyRef.current = null;
  }, []);

  const applyDefinitionLinkDecoration = useCallback((editorInstance: MonacoEditor, range: MonacoRange) => {
    if (definitionLinkDecorationEditorRef.current && definitionLinkDecorationEditorRef.current !== editorInstance) {
      clearDefinitionLinkDecoration(definitionLinkDecorationEditorRef.current);
    }

    definitionLinkDecorationEditorRef.current = editorInstance;
    definitionLinkDecorationIdsRef.current = editorInstance.deltaDecorations(
      definitionLinkDecorationIdsRef.current,
      [{
        range,
        options: {
          inlineClassName: 'code-pane-definition-link',
        },
      }],
    );
  }, [clearDefinitionLinkDecoration]);

  const clearDebugDecorations = useCallback((editorInstance?: MonacoEditor | null) => {
    const targetEditor = editorInstance ?? debugDecorationEditorRef.current;
    if (targetEditor && typeof targetEditor.deltaDecorations === 'function') {
      debugDecorationIdsRef.current = targetEditor.deltaDecorations(debugDecorationIdsRef.current, []);
    } else {
      debugDecorationIdsRef.current = [];
    }

    if (!editorInstance || targetEditor === debugDecorationEditorRef.current) {
      debugDecorationEditorRef.current = null;
    }
  }, []);

  const applyDebugDecorations = useCallback((editorInstance: MonacoEditor | null, filePath: string | null) => {
    if (!editorInstance || !filePath) {
      clearDebugDecorations(editorInstance);
      return;
    }

    if (debugDecorationEditorRef.current && debugDecorationEditorRef.current !== editorInstance) {
      clearDebugDecorations(debugDecorationEditorRef.current);
    }

    const normalizedFilePath = normalizePath(filePath);
    const breakpointDecorations = breakpointsRef.current
      .filter((breakpoint) => normalizePath(breakpoint.filePath) === normalizedFilePath)
      .map((breakpoint) => ({
        range: {
          startLineNumber: breakpoint.lineNumber,
          startColumn: 1,
          endLineNumber: breakpoint.lineNumber,
          endColumn: 1,
        },
        options: {
          isWholeLine: true,
          glyphMarginClassName: getBreakpointGlyphClassName(breakpoint),
          linesDecorationsClassName: getBreakpointGlyphClassName(breakpoint),
          glyphMarginHoverMessage: [{ value: formatBreakpointHoverMessage(breakpoint, t) }],
        },
      }));
    const currentFrame = debugCurrentFrameRef.current;
    const currentFrameDecorations = currentFrame?.filePath && normalizePath(currentFrame.filePath) === normalizedFilePath && currentFrame.lineNumber
      ? [{
        range: {
          startLineNumber: currentFrame.lineNumber,
          startColumn: 1,
          endLineNumber: currentFrame.lineNumber,
          endColumn: 1,
        },
        options: {
          isWholeLine: true,
          className: 'code-pane-debug-current-line',
          glyphMarginClassName: 'code-pane-debug-current-glyph',
          linesDecorationsClassName: 'code-pane-debug-current-glyph',
          glyphMarginHoverMessage: [{ value: t('codePane.debugPausedAtLine', { line: currentFrame.lineNumber }) }],
        },
      }]
      : [];

    debugDecorationEditorRef.current = editorInstance;
    debugDecorationIdsRef.current = editorInstance.deltaDecorations(
      debugDecorationIdsRef.current,
      [...breakpointDecorations, ...currentFrameDecorations],
    );
  }, [clearDebugDecorations, t]);

  const updateDefinitionLinkHover = useCallback(async (
    editorInstance: MonacoEditor | null,
    lineNumber: number,
    column: number,
  ) => {
    const model = editorInstance?.getModel();
    const filePath = activeFilePathRef.current ?? model?.uri.fsPath ?? model?.uri.path;
    if (!editorInstance || !model || !filePath) {
      clearDefinitionLinkDecoration(editorInstance);
      return;
    }

    const { requestKey, range, location } = await lookupDefinitionTarget(
      model,
      filePath,
      lineNumber,
      column,
      { showErrors: false },
    );

    if (definitionHoverRequestKeyRef.current !== requestKey) {
      return;
    }

    if (!location) {
      clearDefinitionLinkDecoration(editorInstance);
      return;
    }

    applyDefinitionLinkDecoration(editorInstance, range);
  }, [applyDefinitionLinkDecoration, clearDefinitionLinkDecoration, lookupDefinitionTarget]);

  const applyPendingNavigation = useCallback((editorInstance: MonacoEditor | null, filePath: string) => {
    const pendingNavigation = pendingNavigationRef.current;
    if (!editorInstance || !pendingNavigation || pendingNavigation.filePath !== filePath) {
      return;
    }

    editorInstance.setPosition?.({
      lineNumber: pendingNavigation.lineNumber,
      column: pendingNavigation.column,
    });
    editorInstance.setSelection?.({
      startLineNumber: pendingNavigation.lineNumber,
      startColumn: pendingNavigation.column,
      endLineNumber: pendingNavigation.lineNumber,
      endColumn: pendingNavigation.column + 1,
    });
    editorInstance.revealLineInCenter?.(pendingNavigation.lineNumber);
    pendingNavigationRef.current = null;
  }, []);

  const saveCurrentViewState = useCallback(() => {
    const currentFilePath = activeFilePathRef.current;
    if (!currentFilePath) {
      return;
    }

    const currentViewMode = paneRef.current.code?.viewMode ?? viewMode;
    if (currentViewMode === 'diff') {
      viewStatesRef.current.set(currentFilePath, diffEditorRef.current?.getModifiedEditor().saveViewState() ?? null);
      return;
    }

    viewStatesRef.current.set(currentFilePath, editorRef.current?.saveViewState() ?? null);
    const currentSecondaryFilePath = secondaryFilePathRef.current;
    if (currentSecondaryFilePath) {
      secondaryViewStatesRef.current.set(
        currentSecondaryFilePath,
        secondaryEditorRef.current?.saveViewState() ?? null,
      );
    }
  }, [viewMode]);

  const restoreEditorViewStateSafely = useCallback((
    editorInstance: MonacoEditor | null | undefined,
    nextModel: MonacoModel | null | undefined,
    savedViewState: MonacoViewState | null | undefined,
  ) => {
    if (!editorInstance || !nextModel || !savedViewState) {
      return;
    }

    if (editorInstance.getModel?.() !== nextModel) {
      return;
    }

    try {
      editorInstance.restoreViewState(savedViewState);
    } catch (error) {
      if (!isKnownMonacoCancellationError(error)) {
        console.warn('[CodePane] restoreViewState failed', error);
      }
    }
  }, []);

  const detachDiffEditorModel = useCallback(() => {
    try {
      diffEditorRef.current?.setModel(null);
    } catch {
      // Monaco can throw during rapid teardown; the editor is being disposed immediately afterwards.
    }
  }, []);

  const releaseDiffModelsForFile = useCallback((filePath: string) => {
    const activeDiffTargetPath = activeFilePathRef.current;
    const isVisibleInDiffEditor = activeDiffTargetPath === filePath
      && (paneRef.current.code?.viewMode ?? viewMode) === 'diff';

    if (isVisibleInDiffEditor) {
      detachDiffEditorModel();
    }

    diffModelsRef.current.get(filePath)?.dispose();
    diffModelsRef.current.delete(filePath);
    revisionModifiedModelsRef.current.get(filePath)?.dispose();
    revisionModifiedModelsRef.current.delete(filePath);

    if (revisionDiffFilePathRef.current === filePath) {
      revisionDiffFilePathRef.current = null;
    }
  }, [detachDiffEditorModel, viewMode]);

  const disposeEditors = useCallback(() => {
    saveCurrentViewState();
    editorMouseDownListenerRef.current?.dispose();
    editorMouseDownListenerRef.current = null;
    editorMouseMoveListenerRef.current?.dispose();
    editorMouseMoveListenerRef.current = null;
    editorMouseLeaveListenerRef.current?.dispose();
    editorMouseLeaveListenerRef.current = null;
    editorCursorPositionListenerRef.current?.dispose();
    editorCursorPositionListenerRef.current = null;
    secondaryEditorMouseDownListenerRef.current?.dispose();
    secondaryEditorMouseDownListenerRef.current = null;
    secondaryEditorMouseMoveListenerRef.current?.dispose();
    secondaryEditorMouseMoveListenerRef.current = null;
    secondaryEditorMouseLeaveListenerRef.current?.dispose();
    secondaryEditorMouseLeaveListenerRef.current = null;
    secondaryEditorCursorPositionListenerRef.current?.dispose();
    secondaryEditorCursorPositionListenerRef.current = null;
    diffEditorMouseDownListenerRef.current?.dispose();
    diffEditorMouseDownListenerRef.current = null;
    diffEditorMouseMoveListenerRef.current?.dispose();
    diffEditorMouseMoveListenerRef.current = null;
    diffEditorMouseLeaveListenerRef.current?.dispose();
    diffEditorMouseLeaveListenerRef.current = null;
    diffEditorCursorPositionListenerRef.current?.dispose();
    diffEditorCursorPositionListenerRef.current = null;
    detachDiffEditorModel();
    clearDefinitionLinkDecoration();
    clearDebugDecorations();
    editorRef.current?.dispose();
    secondaryEditorRef.current?.dispose();
    diffEditorRef.current?.dispose();
    editorRef.current = null;
    secondaryEditorRef.current = null;
    diffEditorRef.current = null;
    editorSurfaceBindingStateRef.current = null;
  }, [clearDebugDecorations, clearDefinitionLinkDecoration, detachDiffEditorModel, saveCurrentViewState]);

  const disposeAllModels = useCallback(() => {
    editorSurfaceRequestIdRef.current += 1;
    queuedEditorSurfaceRefreshRef.current = false;
    pendingEditorSurfaceRefreshRef.current = null;
    editorSurfaceBindingStateRef.current = null;
    for (const timer of autoSaveTimersRef.current.values()) {
      clearTimeout(timer);
    }
    autoSaveTimersRef.current.clear();
    pendingSavePathsRef.current.clear();

    for (const timer of documentSyncTimersRef.current.values()) {
      clearTimeout(timer);
    }
    documentSyncTimersRef.current.clear();

    for (const timer of localHistoryTimersRef.current.values()) {
      clearTimeout(timer);
    }
    localHistoryTimersRef.current.clear();

    if (problemsRefreshAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(problemsRefreshAnimationFrameRef.current);
      problemsRefreshAnimationFrameRef.current = null;
    }
    pendingProblemsRefreshRef.current = null;

    if (gitSnapshotRefreshTimerRef.current) {
      clearTimeout(gitSnapshotRefreshTimerRef.current);
      gitSnapshotRefreshTimerRef.current = null;
    }
    const pendingGitSnapshotRefresh = pendingGitSnapshotRefreshRef.current;
    pendingGitSnapshotRefreshRef.current = null;
    pendingGitSnapshotRefresh?.resolvers.forEach((resolve) => resolve());
    const inFlightGitSnapshotRefresh = inFlightGitSnapshotRefreshRef.current;
    inFlightGitSnapshotRefreshRef.current = null;
    inFlightGitSnapshotRefresh?.resolvers.forEach((resolve) => resolve());
    if (loadedDirectoriesRefreshTimerRef.current) {
      clearTimeout(loadedDirectoriesRefreshTimerRef.current);
      loadedDirectoriesRefreshTimerRef.current = null;
    }
    const pendingLoadedDirectoriesRefresh = pendingLoadedDirectoriesRefreshRef.current;
    pendingLoadedDirectoriesRefreshRef.current = null;
    pendingLoadedDirectoriesRefresh?.resolvers.forEach((resolve) => resolve());
    const inFlightLoadedDirectoriesRefresh = inFlightLoadedDirectoriesRefreshRef.current;
    inFlightLoadedDirectoriesRefreshRef.current = null;
    inFlightLoadedDirectoriesRefresh?.resolvers.forEach((resolve) => resolve());

    pendingFsChangesRef.current = [];
    isFsChangeFlushQueuedRef.current = false;
    if (fsChangeFlushTimerRef.current) {
      clearTimeout(fsChangeFlushTimerRef.current);
      fsChangeFlushTimerRef.current = null;
    }
    lastAutoPresentedExternalChangeRef.current = null;

    for (const disposable of modelDisposersRef.current.values()) {
      disposable.dispose();
    }
    modelDisposersRef.current.clear();

    for (const model of fileModelsRef.current.values()) {
      model.dispose();
    }
    fileModelsRef.current.clear();

    detachDiffEditorModel();
    for (const model of diffModelsRef.current.values()) {
      model.dispose();
    }
    diffModelsRef.current.clear();
    for (const model of revisionModifiedModelsRef.current.values()) {
      model.dispose();
    }
    revisionModifiedModelsRef.current.clear();
    revisionDiffFilePathRef.current = null;

    fileMetaRef.current.clear();
    preloadedReadResultsRef.current.clear();
    problemsByFileRef.current.clear();
    clearDefinitionLookupCache();
    viewStatesRef.current.clear();
    setProblems((currentProblems) => (currentProblems.length === 0 ? currentProblems : []));
  }, [clearDefinitionLookupCache, detachDiffEditorModel]);

  const applyExternalLibrarySections = useCallback((nextSections: CodePaneExternalLibrarySection[]) => {
    const nextExternalRootPaths = collectExternalRootPaths(nextSections);
    const isDirectoryInExternalRoots = (directoryPath: string) => (
      nextExternalRootPaths.some((rootDirectoryPath) => isPathInside(rootDirectoryPath, directoryPath))
    );

    setExternalLibrariesError((currentError) => (currentError === null ? currentError : null));
    setExternalLibrarySections((currentSections) => (
      areExternalLibrarySectionsEqual(currentSections, nextSections) ? currentSections : nextSections
    ));
    setExternalEntriesByDirectory((currentEntries) => {
      let didRemoveDirectory = false;
      const nextEntries: Record<string, CodePaneTreeEntry[]> = {};

      for (const [directoryPath, entries] of Object.entries(currentEntries)) {
        if (isDirectoryInExternalRoots(directoryPath)) {
          nextEntries[directoryPath] = entries;
        } else {
          didRemoveDirectory = true;
        }
      }

      return didRemoveDirectory ? nextEntries : currentEntries;
    });
    setLoadedExternalDirectories((currentLoadedDirectories) => {
      let nextLoadedDirectories: Set<string> | null = null;
      for (const directoryPath of currentLoadedDirectories) {
        if (!isDirectoryInExternalRoots(directoryPath)) {
          nextLoadedDirectories ??= new Set(currentLoadedDirectories);
          nextLoadedDirectories.delete(directoryPath);
        }
      }
      return nextLoadedDirectories ?? currentLoadedDirectories;
    });
    setLoadingExternalDirectories((currentLoadingDirectories) => {
      let nextLoadingDirectories: Set<string> | null = null;
      for (const directoryPath of currentLoadingDirectories) {
        if (!isDirectoryInExternalRoots(directoryPath)) {
          nextLoadingDirectories ??= new Set(currentLoadingDirectories);
          nextLoadingDirectories.delete(directoryPath);
        }
      }
      return nextLoadingDirectories ?? currentLoadingDirectories;
    });
    setExpandedDirectories((currentExpandedDirectories) => {
      let nextExpandedDirectories: Set<string> | null = null;
      for (const directoryPath of currentExpandedDirectories) {
        if (!isPathInside(rootPath, directoryPath) && !isDirectoryInExternalRoots(directoryPath)) {
          nextExpandedDirectories ??= new Set(currentExpandedDirectories);
          nextExpandedDirectories.delete(directoryPath);
        }
      }
      return nextExpandedDirectories ?? currentExpandedDirectories;
    });
  }, [rootPath]);

  const resetExternalLibrarySections = useCallback((nextSections: CodePaneExternalLibrarySection[]) => {
    applyExternalLibrarySections(nextSections);
  }, [applyExternalLibrarySections]);

  const applyGitSnapshot = useCallback((
    nextStatusEntries: CodePaneGitStatusEntry[],
    nextSummary: CodePaneGitRepositorySummary | null,
    nextGraph: CodePaneGitGraphCommit[] | null,
    options?: {
      includeGraph?: boolean;
    },
  ) => {
    const includeGraph = options?.includeGraph ?? false;
    const statusChanged = !areGitStatusEntriesEqual(gitStatusEntriesRef.current, nextStatusEntries);
    const nextStatusByPath = statusChanged ? mapGitStatusEntriesByPath(nextStatusEntries) : null;
    const summaryChanged = !areGitRepositorySummariesEqual(gitRepositorySummaryRef.current, nextSummary);
    const graphChanged = includeGraph && nextGraph
      ? !areGitGraphCommitsEqual(gitGraphRef.current, nextGraph)
      : false;
    const nextSelectedGitLogCommitSha = includeGraph && nextGraph
      ? (
        selectedGitLogCommitShaRef.current && nextGraph.some((commit) => commit.sha === selectedGitLogCommitShaRef.current)
          ? selectedGitLogCommitShaRef.current
          : nextGraph[0]?.sha ?? null
      )
      : selectedGitLogCommitShaRef.current;

    if (!statusChanged && !summaryChanged && !graphChanged && nextSelectedGitLogCommitSha === selectedGitLogCommitShaRef.current) {
      return;
    }

    if (statusChanged) {
      gitStatusEntriesRef.current = nextStatusEntries;
    }
    if (summaryChanged) {
      gitRepositorySummaryRef.current = nextSummary;
    }
    if (graphChanged && nextGraph) {
      gitGraphRef.current = nextGraph;
    }
    if (includeGraph) {
      selectedGitLogCommitShaRef.current = nextSelectedGitLogCommitSha;
    }

    startTransition(() => {
      setGitStatusEntries((currentEntries) => (
        statusChanged ? nextStatusEntries : currentEntries
      ));
      setGitStatusByPath((currentStatusByPath) => {
        if (!statusChanged || !nextStatusByPath) {
          return currentStatusByPath;
        }
        return nextStatusByPath;
      });
      setGitRepositorySummary((currentSummary) => (
        summaryChanged ? nextSummary : currentSummary
      ));
      if (includeGraph && nextGraph) {
        setGitGraph((currentGraph) => (graphChanged ? nextGraph : currentGraph));
        setSelectedGitLogCommitSha((currentCommitSha) => (
          nextSelectedGitLogCommitSha === currentCommitSha ? currentCommitSha : nextSelectedGitLogCommitSha
        ));
      }
    });
  }, []);

  const resetGitSnapshot = useCallback((options?: { includeGraph?: boolean }) => {
    applyGitSnapshot([], null, options?.includeGraph ? [] : null, options);
  }, [applyGitSnapshot]);

  const shouldLoadGitGraph = useCallback(() => (
    bottomPanelModeRef.current === 'git'
    && activeGitWorkbenchTabRef.current === 'log'
  ), []);

  const shouldLoadGitBranches = useCallback(() => (
    bottomPanelModeRef.current === 'git'
    && activeGitWorkbenchTabRef.current !== 'changes'
  ), []);

  const shouldLoadGitRebasePlan = useCallback(() => (
    bottomPanelModeRef.current === 'git'
    && activeGitWorkbenchTabRef.current === 'rebase'
  ), []);

  const invalidateGitGraphSnapshot = useCallback(() => {
    invalidateProjectCache(rootPath, 'git-graph');
  }, [rootPath]);

  const refreshGitSnapshotNow = useCallback(async (options?: GitSnapshotRefreshOptions) => {
    const includeGraph = options?.includeGraph ?? (
      shouldLoadGitGraph()
    );
    const forceGraph = options?.force === true && includeGraph;
    const statusOnly = options?.statusOnly === true;

    if (options?.force) {
      invalidateProjectCache(rootPath, forceGraph ? 'git' : 'git-status');
    }

    const cachedStatusEntries = getGitStatusCache(rootPath);
    const cachedSummary = getGitSummaryCache(rootPath);
    const cachedGraph = includeGraph ? getGitGraphCache(rootPath) : null;
    const shouldFetchStatus = options?.force === true || cachedStatusEntries === null;
    const shouldFetchSummary = !statusOnly && (options?.force === true || cachedSummary === null);
    const shouldFetchGraph = includeGraph && (forceGraph || cachedGraph === null);

    if (!shouldFetchStatus && !shouldFetchSummary && !shouldFetchGraph) {
      applyGitSnapshot(
        cachedStatusEntries ?? [],
        cachedSummary,
        includeGraph ? (cachedGraph ?? []) : null,
        { includeGraph },
      );
      return;
    }

    const gitSnapshot = await dedupeProjectRequest(
      rootPath,
      [
        'git-snapshot',
        shouldFetchStatus ? 'status' : null,
        shouldFetchSummary ? 'summary' : null,
        shouldFetchGraph ? 'graph' : null,
      ].filter(Boolean).join(':'),
      async () => {
        const statusPromise = shouldFetchStatus
          ? window.electronAPI.codePaneGetGitStatus({ rootPath })
          : Promise.resolve(null);
        const summaryPromise = shouldFetchSummary
          ? window.electronAPI.codePaneGetGitRepositorySummary({ rootPath })
          : Promise.resolve(null);
        const graphPromise = shouldFetchGraph
          ? window.electronAPI.codePaneGetGitGraph({ rootPath, limit: 60 })
          : Promise.resolve(null);

        const [statusResponse, summaryResponse, graphResponse] = await Promise.all([
          statusPromise,
          summaryPromise,
          graphPromise,
        ]);

        const nextStatusEntries = shouldFetchStatus
          ? (statusResponse?.success ? (statusResponse.data ?? []) : [])
          : (cachedStatusEntries ?? []);
        const nextSummary = shouldFetchSummary
          ? (summaryResponse?.success ? (summaryResponse.data ?? null) : null)
          : cachedSummary;
        const nextGraph = includeGraph
          ? (shouldFetchGraph ? (graphResponse?.success ? graphResponse.data ?? [] : []) : (cachedGraph ?? []))
          : null;

        if (shouldFetchStatus) {
          setGitStatusCache(rootPath, nextStatusEntries);
        }
        if (shouldFetchSummary) {
          setGitSummaryCache(rootPath, nextSummary);
        }
        if (includeGraph && shouldFetchGraph && nextGraph) {
          setGitGraphCache(rootPath, nextGraph);
        }

        return {
          statusEntries: nextStatusEntries,
          summary: nextSummary,
          graph: nextGraph,
        };
      },
    );

    applyGitSnapshot(gitSnapshot.statusEntries, gitSnapshot.summary, gitSnapshot.graph, {
      includeGraph,
    });
  }, [applyGitSnapshot, rootPath, shouldLoadGitGraph]);

  const refreshGitSnapshot = useCallback((options?: GitSnapshotRefreshOptions) => {
    const includeGraph = options?.includeGraph ?? shouldLoadGitGraph();
    const force = options?.force === true;
    const statusOnly = options?.statusOnly === true;

    return new Promise<void>((resolve, reject) => {
      const inFlightRefresh = inFlightGitSnapshotRefreshRef.current;
      if (inFlightRefresh && canGitRefreshRequestSatisfy(inFlightRefresh, {
        includeGraph,
        force,
        statusOnly,
      })) {
        inFlightRefresh.includeGraph = inFlightRefresh.includeGraph || includeGraph;
        inFlightRefresh.force = inFlightRefresh.force || force;
        inFlightRefresh.statusOnly = inFlightRefresh.statusOnly && statusOnly;
        inFlightRefresh.delayMs = Math.min(inFlightRefresh.delayMs ?? 0, options?.delayMs ?? 0);
        inFlightRefresh.resolvers.push(resolve);
        inFlightRefresh.rejecters.push(reject);
        return;
      }

      const pendingRefresh = pendingGitSnapshotRefreshRef.current;
      const hadPendingRefresh = Boolean(pendingRefresh);
      if (pendingRefresh) {
        pendingRefresh.includeGraph = pendingRefresh.includeGraph || includeGraph;
        pendingRefresh.force = pendingRefresh.force || force;
        pendingRefresh.statusOnly = pendingRefresh.statusOnly && statusOnly;
        pendingRefresh.delayMs = Math.min(pendingRefresh.delayMs ?? 0, options?.delayMs ?? 0);
        pendingRefresh.resolvers.push(resolve);
        pendingRefresh.rejecters.push(reject);
      } else {
        pendingGitSnapshotRefreshRef.current = {
          includeGraph,
          force,
          statusOnly,
          delayMs: options?.delayMs,
          resolvers: [resolve],
          rejecters: [reject],
        };
      }

      if (inFlightRefresh) {
        return;
      }

      if (gitSnapshotRefreshTimerRef.current) {
        window.clearTimeout(gitSnapshotRefreshTimerRef.current);
      }

      const queuedRefresh = pendingGitSnapshotRefreshRef.current;
      gitSnapshotRefreshTimerRef.current = window.setTimeout(() => {
        gitSnapshotRefreshTimerRef.current = null;
        const refresh = pendingGitSnapshotRefreshRef.current;
        pendingGitSnapshotRefreshRef.current = null;
        if (!refresh) {
          return;
        }

        const refreshPromise = refreshGitSnapshotNow({
          includeGraph: refresh.includeGraph,
          force: refresh.force,
          statusOnly: refresh.statusOnly,
        });
        inFlightGitSnapshotRefreshRef.current = {
          ...refresh,
          promise: refreshPromise,
        };
        void refreshPromise.then(() => {
          const completedRefresh = inFlightGitSnapshotRefreshRef.current ?? refresh;
          inFlightGitSnapshotRefreshRef.current = null;
          completedRefresh.resolvers.forEach((currentResolve) => currentResolve());
          const trailingRefresh = pendingGitSnapshotRefreshRef.current;
          pendingGitSnapshotRefreshRef.current = null;
          if (!trailingRefresh) {
            return;
          }
          void refreshGitSnapshot({
            includeGraph: trailingRefresh.includeGraph,
            force: trailingRefresh.force,
            statusOnly: trailingRefresh.statusOnly,
          }).then(() => {
            trailingRefresh.resolvers.forEach((currentResolve) => currentResolve());
          }).catch((error) => {
            trailingRefresh.rejecters.forEach((currentReject) => currentReject(error));
          });
        }).catch((error) => {
          const completedRefresh = inFlightGitSnapshotRefreshRef.current ?? refresh;
          inFlightGitSnapshotRefreshRef.current = null;
          completedRefresh.rejecters.forEach((currentReject) => currentReject(error));
          const trailingRefresh = pendingGitSnapshotRefreshRef.current;
          pendingGitSnapshotRefreshRef.current = null;
          trailingRefresh?.rejecters.forEach((currentReject) => currentReject(error));
        });
      }, queuedRefresh?.force ? 0 : queuedRefresh?.delayMs ?? (!hadPendingRefresh ? 0 : 150));
    });
  }, [refreshGitSnapshotNow, shouldLoadGitGraph]);

  const scheduleGitStatusRefresh = useCallback((options?: { force?: boolean; forceStatusOnly?: boolean }) => {
    invalidateProjectCache(rootPath, 'git-status');
    void refreshGitSnapshot({
      statusOnly: options?.forceStatusOnly !== false,
      includeGraph: false,
      delayMs: options?.force ? 0 : CODE_PANE_SAVE_GIT_STATUS_REFRESH_DELAY_MS,
      ...(options?.force || options?.forceStatusOnly ? { force: true } : {}),
    });
  }, [refreshGitSnapshot, rootPath]);

  const refreshVisibleGitWorkbenchData = useCallback((options?: { force?: boolean }) => {
    void refreshGitSnapshot({
      includeGraph: shouldLoadGitGraph(),
      ...(options?.force ? { force: true } : {}),
    });
  }, [refreshGitSnapshot, shouldLoadGitGraph]);

  const loadGitBranches = useCallback(async (options?: { preferredBaseRef?: string }) => {
    const commitBranches = (branches: CodePaneGitBranchEntry[]) => {
      startTransition(() => {
        setGitBranches((currentBranches) => (
          areGitBranchesEqual(currentBranches, branches) ? currentBranches : branches
        ));
        setSelectedGitBranchName((currentBranchName) => (
          currentBranchName && branches.some((branch) => branch.name === currentBranchName)
            ? currentBranchName
            : branches.find((branch) => branch.current)?.name ?? branches[0]?.name ?? null
        ));
        setGitRebaseBaseRef((currentBaseRef) => {
          const preferredBaseRef = options?.preferredBaseRef ?? currentBaseRef;
          if (preferredBaseRef && branches.some((branch) => branch.name === preferredBaseRef)) {
            return preferredBaseRef;
          }

          return branches.find((branch) => branch.current)?.upstream
            ?? branches.find((branch) => branch.kind === 'local' && !branch.current)?.name
            ?? branches[0]?.name
            ?? '';
        });
      });
    };

    const cachedBranches = getGitBranchesCache(rootPath);
    if (cachedBranches) {
      setGitBranchesError((currentError) => (currentError === null ? currentError : null));
      setIsGitBranchesLoading((currentLoading) => (currentLoading ? false : currentLoading));
      commitBranches(cachedBranches);
      return;
    }

    setIsGitBranchesLoading((currentLoading) => (currentLoading ? currentLoading : true));
    setGitBranchesError((currentError) => (currentError === null ? currentError : null));

    const response = await dedupeProjectRequest(
      rootPath,
      'git-branches',
      async () => await window.electronAPI.codePaneGetGitBranches({ rootPath }),
    );
    if (!response.success || !response.data) {
      setGitBranches((currentBranches) => (currentBranches.length === 0 ? currentBranches : []));
      setGitBranchesError((currentError) => {
        const nextError = response.error || t('common.retry');
        return currentError === nextError ? currentError : nextError;
      });
      setIsGitBranchesLoading((currentLoading) => (currentLoading ? false : currentLoading));
      return;
    }

    const branches = response.data;
    setGitBranchesCache(rootPath, branches);
    commitBranches(branches);
    setIsGitBranchesLoading((currentLoading) => (currentLoading ? false : currentLoading));
  }, [rootPath, t]);

  const selectGitLogCommit = useCallback((commitSha: string, event?: { metaKey?: boolean; ctrlKey?: boolean }) => {
    setSelectedGitLogCommitSha(commitSha);

    if (event?.metaKey || event?.ctrlKey) {
      setSelectedGitCommitOrder((currentOrder) => {
        if (currentOrder.includes(commitSha)) {
          return currentOrder.filter((candidateSha) => candidateSha !== commitSha);
        }

        return [...currentOrder, commitSha].slice(-2);
      });
      return;
    }

    setSelectedGitCommitOrder([commitSha]);
  }, []);

  const handleSelectGitBranch = useCallback((branchName: string) => {
    setSelectedGitBranchName(branchName);
    const selectedBranch = gitBranches.find((branch) => branch.name === branchName);
    if (selectedBranch?.commitSha) {
      setSelectedGitLogCommitSha(selectedBranch.commitSha);
    }
  }, [gitBranches]);

  const loadGitRebasePlan = useCallback(async (baseRef: string) => {
    if (!baseRef) {
      setGitRebasePlan((currentPlan) => (currentPlan === null ? currentPlan : null));
      setGitRebaseError((currentError) => (currentError === null ? currentError : null));
      setIsGitRebaseLoading((currentLoading) => (currentLoading === false ? currentLoading : false));
      return;
    }

    const cachedRebasePlan = getGitRebasePlanCache(rootPath, baseRef);
    if (cachedRebasePlan) {
      setGitRebaseError((currentError) => (currentError === null ? currentError : null));
      setIsGitRebaseLoading((currentLoading) => (currentLoading === false ? currentLoading : false));
      startTransition(() => {
        setGitRebasePlan((currentPlan) => (
          areGitRebasePlansEqual(currentPlan, cachedRebasePlan) ? currentPlan : cachedRebasePlan
        ));
        setGitRebaseBaseRef((currentBaseRef) => (
          currentBaseRef === cachedRebasePlan.baseRef ? currentBaseRef : cachedRebasePlan.baseRef
        ));
      });
      return;
    }

    setIsGitRebaseLoading((currentLoading) => (currentLoading ? currentLoading : true));
    setGitRebaseError((currentError) => (currentError === null ? currentError : null));
    const response = await dedupeProjectRequest(
      rootPath,
      `git-rebase-plan:${baseRef}`,
      async () => await window.electronAPI.codePaneGetGitRebasePlan({
        rootPath,
        baseRef,
      }),
    );

    if (!response.success || !response.data) {
      const nextError = response.error || t('common.retry');
      setGitRebasePlan((currentPlan) => (currentPlan === null ? currentPlan : null));
      setGitRebaseError((currentError) => (
        currentError === nextError ? currentError : nextError
      ));
      setIsGitRebaseLoading((currentLoading) => (currentLoading === false ? currentLoading : false));
      return;
    }

    const rebasePlan = response.data;
    setGitRebasePlanCache(rootPath, baseRef, rebasePlan);
    startTransition(() => {
      setGitRebasePlan((currentPlan) => (
        areGitRebasePlansEqual(currentPlan, rebasePlan) ? currentPlan : rebasePlan
      ));
      setGitRebaseBaseRef((currentBaseRef) => (
        currentBaseRef === rebasePlan.baseRef ? currentBaseRef : rebasePlan.baseRef
      ));
    });
    setIsGitRebaseLoading((currentLoading) => (currentLoading === false ? currentLoading : false));
  }, [rootPath, t]);

  const loadGitConflictDetails = useCallback(async (filePath: string | null) => {
    if (!filePath) {
      setGitConflictDetails((currentDetails) => (currentDetails === null ? currentDetails : null));
      setGitConflictError((currentError) => (currentError === null ? currentError : null));
      setIsGitConflictLoading((currentLoading) => (currentLoading === false ? currentLoading : false));
      return;
    }

    const requestKey = `git-conflict:${rootPath}`;
    const requestVersion = runtimeStoreRef.current.markLatest(requestKey);
    const cacheKey = `${requestKey}:${filePath}`;
    const cachedConflict = runtimeStoreRef.current.getCache<NonNullable<typeof gitConflictDetails>>(
      cacheKey,
      CODE_PANE_TOOL_WINDOW_CACHE_TTL_MS,
    );
    if (cachedConflict) {
      runtimeStoreRef.current.recordRequest(requestKey, t('codePane.requestGitConflictDetails'), {
        meta: getRelativePath(rootPath, filePath) || filePath,
        fromCache: true,
      });
      startTransition(() => {
        setSelectedGitConflictPath((currentPath) => (currentPath === filePath ? currentPath : filePath));
        setGitConflictDetails((currentDetails) => (
          areGitConflictDetailsEqual(currentDetails, cachedConflict) ? currentDetails : cachedConflict
        ));
      });
      setGitConflictError((currentError) => (currentError === null ? currentError : null));
      setIsGitConflictLoading((currentLoading) => (currentLoading === false ? currentLoading : false));
      return;
    }

    setIsGitConflictLoading((currentLoading) => (currentLoading ? currentLoading : true));
    setGitConflictError((currentError) => (currentError === null ? currentError : null));
    const response = await trackRequest(
      requestKey,
      t('codePane.requestGitConflictDetails'),
      getRelativePath(rootPath, filePath) || filePath,
      async () => await dedupeProjectRequest(
        rootPath,
        `git-conflict:${filePath}`,
        async () => await window.electronAPI.codePaneGetGitConflictDetails({
          rootPath,
          filePath,
        }),
      ),
    );
    if (!runtimeStoreRef.current.isLatest(requestKey, requestVersion)) {
      return;
    }

    if (!response.success || !response.data) {
      const nextError = response.error || t('common.retry');
      setGitConflictDetails((currentDetails) => (currentDetails === null ? currentDetails : null));
      setGitConflictError((currentError) => (
        currentError === nextError ? currentError : nextError
      ));
      setIsGitConflictLoading((currentLoading) => (currentLoading === false ? currentLoading : false));
      return;
    }

    const nextConflict = response.data;
    runtimeStoreRef.current.setCache(cacheKey, nextConflict);
    startTransition(() => {
      setSelectedGitConflictPath((currentPath) => (currentPath === filePath ? currentPath : filePath));
      setGitConflictDetails((currentDetails) => (
        areGitConflictDetailsEqual(currentDetails, nextConflict) ? currentDetails : nextConflict
      ));
    });
    setIsGitConflictLoading((currentLoading) => (currentLoading === false ? currentLoading : false));
  }, [rootPath, t, trackRequest]);

  const loadGitDiffHunks = useCallback(async (filePath: string | null) => {
    const requestId = ++gitHunksRequestIdRef.current;
    if (!filePath) {
      selectedGitHunksPathRef.current = null;
      gitStagedHunksRef.current = [];
      gitUnstagedHunksRef.current = [];
      gitHunksErrorRef.current = null;
      setSelectedGitHunksPath((currentPath) => (currentPath === null ? currentPath : null));
      setGitStagedHunks((currentHunks) => (currentHunks.length === 0 ? currentHunks : []));
      setGitUnstagedHunks((currentHunks) => (currentHunks.length === 0 ? currentHunks : []));
      setGitHunksError((currentError) => (currentError === null ? currentError : null));
      setIsGitHunksLoading((currentLoading) => (currentLoading ? false : currentLoading));
      return;
    }

    const isSameFile = selectedGitHunksPathRef.current === filePath;
    if (!isSameFile) {
      selectedGitHunksPathRef.current = filePath;
      setSelectedGitHunksPath((currentPath) => (currentPath === filePath ? currentPath : filePath));
    }
    const cacheKey = `git-hunks:${rootPath}:${filePath}`;
    const cachedDiffHunks = runtimeStoreRef.current.getCache<CodePaneGitDiffHunksResult>(
      cacheKey,
      CODE_PANE_TOOL_WINDOW_CACHE_TTL_MS,
    );
    if (cachedDiffHunks) {
      gitStagedHunksRef.current = cachedDiffHunks.stagedHunks ?? [];
      gitUnstagedHunksRef.current = cachedDiffHunks.unstagedHunks ?? [];
      gitHunksErrorRef.current = null;
      startTransition(() => {
        if (gitHunksRequestIdRef.current !== requestId || selectedGitHunksPathRef.current !== filePath) {
          return;
        }
        setGitStagedHunks((currentHunks) => (
          areGitDiffHunksEqual(currentHunks, gitStagedHunksRef.current) ? currentHunks : gitStagedHunksRef.current
        ));
        setGitUnstagedHunks((currentHunks) => (
          areGitDiffHunksEqual(currentHunks, gitUnstagedHunksRef.current) ? currentHunks : gitUnstagedHunksRef.current
        ));
        setGitHunksError((currentError) => (currentError === null ? currentError : null));
      });
      setIsGitHunksLoading((currentLoading) => (currentLoading ? false : currentLoading));
      return;
    }
    setIsGitHunksLoading((currentLoading) => (currentLoading ? currentLoading : true));
    if (gitHunksErrorRef.current !== null) {
      gitHunksErrorRef.current = null;
      setGitHunksError((currentError) => (currentError === null ? currentError : null));
    }
    const response = await dedupeProjectRequest(
      rootPath,
      cacheKey,
      async () => await window.electronAPI.codePaneGetGitDiffHunks({
        rootPath,
        filePath,
      }),
    );

    if (gitHunksRequestIdRef.current !== requestId || selectedGitHunksPathRef.current !== filePath) {
      return;
    }

    if (!response.success || !response.data) {
      gitStagedHunksRef.current = [];
      gitUnstagedHunksRef.current = [];
      gitHunksErrorRef.current = response.error || t('common.retry');
      setGitStagedHunks((currentHunks) => (currentHunks.length === 0 ? currentHunks : []));
      setGitUnstagedHunks((currentHunks) => (currentHunks.length === 0 ? currentHunks : []));
      setGitHunksError((currentError) => (
        currentError === gitHunksErrorRef.current ? currentError : gitHunksErrorRef.current
      ));
      setIsGitHunksLoading((currentLoading) => (currentLoading ? false : currentLoading));
      return;
    }

    const diffHunks = response.data;
    runtimeStoreRef.current.setCache(cacheKey, diffHunks);
    startTransition(() => {
      if (gitHunksRequestIdRef.current !== requestId || selectedGitHunksPathRef.current !== filePath) {
        return;
      }
      gitStagedHunksRef.current = diffHunks.stagedHunks ?? [];
      gitUnstagedHunksRef.current = diffHunks.unstagedHunks ?? [];
      gitHunksErrorRef.current = null;
      setGitStagedHunks((currentHunks) => (
        areGitDiffHunksEqual(currentHunks, gitStagedHunksRef.current) ? currentHunks : gitStagedHunksRef.current
      ));
      setGitUnstagedHunks((currentHunks) => (
        areGitDiffHunksEqual(currentHunks, gitUnstagedHunksRef.current) ? currentHunks : gitUnstagedHunksRef.current
      ));
      setGitHunksError((currentError) => (currentError === null ? currentError : null));
    });
    if (gitHunksRequestIdRef.current === requestId) {
      setIsGitHunksLoading((currentLoading) => (currentLoading ? false : currentLoading));
    }
  }, [rootPath, t]);

  const loadDirectory = useCallback(async (
    directoryPath: string,
    options?: { showLoadingIndicator?: boolean },
  ): Promise<CodePaneTreeEntry[]> => {
    const commitDirectoryEntries = (entries: CodePaneTreeEntry[]) => {
      const applyEntries = () => {
        setTreeEntriesByDirectory((currentTreeEntries) => {
          const currentEntries = currentTreeEntries[directoryPath];
          if (currentEntries && areTreeEntriesEqual(currentEntries, entries)) {
            return currentTreeEntries;
          }

          compactDirectoryPresentationsCacheRef.current.delete(directoryPath);

          return {
            ...currentTreeEntries,
            [directoryPath]: entries,
          };
        });
        setLoadedDirectories((currentLoadedDirectories) => {
          if (currentLoadedDirectories.has(directoryPath)) {
            return currentLoadedDirectories;
          }
          const nextLoadedDirectories = new Set(currentLoadedDirectories);
          nextLoadedDirectories.add(directoryPath);
          return nextLoadedDirectories;
        });
      };

      if (directoryPath === rootPath) {
        applyEntries();
        return;
      }

      startTransition(applyEntries);
    };

    const showLoadingIndicator = options?.showLoadingIndicator ?? true;
    const cachedEntries = getDirectoryCache(rootPath, directoryPath);
    const hasCachedEntries = cachedEntries !== null;

    if (hasCachedEntries) {
      commitDirectoryEntries(cachedEntries);

      if (directoryPath === rootPath) {
        setTreeLoadError((currentError) => (currentError === null ? currentError : null));
      }
    }

    if (showLoadingIndicator) {
      setLoadingDirectories((currentLoadingDirectories) => {
        if (currentLoadingDirectories.has(directoryPath)) {
          return currentLoadingDirectories;
        }

        const nextLoadingDirectories = new Set(currentLoadingDirectories);
        nextLoadingDirectories.add(directoryPath);
        return nextLoadingDirectories;
      });
    }

    let didRequestFail = false;
    const nextEntries = await dedupeProjectRequest(
      rootPath,
      `directory:${directoryPath}`,
      async () => {
        const response = await window.electronAPI.codePaneListDirectory({
          rootPath,
          targetPath: directoryPath,
        });

        if (!response.success) {
          throw new Error(response.error || t('common.retry'));
        }

        const resolvedEntries = response.data ?? [];
        setDirectoryCache(rootPath, directoryPath, resolvedEntries);
        return resolvedEntries;
      },
    ).catch((error) => {
      didRequestFail = true;
      if (directoryPath === rootPath) {
        setTreeLoadError(error instanceof Error ? error.message : t('common.retry'));
      } else {
        setBanner({
          tone: 'error',
          message: error instanceof Error ? error.message : t('common.retry'),
        });
      }

      return cachedEntries ?? [];
    });

    if (nextEntries.length > 0 || hasCachedEntries || directoryPath === rootPath) {
      if (directoryPath === rootPath && !didRequestFail) {
        setTreeLoadError((currentError) => (currentError === null ? currentError : null));
      }

      commitDirectoryEntries(nextEntries);
    }

    if (showLoadingIndicator) {
      setLoadingDirectories((currentLoadingDirectories) => {
        if (!currentLoadingDirectories.has(directoryPath)) {
          return currentLoadingDirectories;
        }

        const nextLoadingDirectories = new Set(currentLoadingDirectories);
        nextLoadingDirectories.delete(directoryPath);
        return nextLoadingDirectories;
      });
    }
    return nextEntries;
  }, [rootPath, t]);

  const loadExternalLibrarySections = useCallback(async (options?: { force?: boolean }) => {
    if (options?.force) {
      invalidateProjectCache(rootPath, 'external-libraries');
    }

    const cachedSections = getExternalLibraryCache(rootPath);
    if (!options?.force && cachedSections !== null) {
      applyExternalLibrarySections(cachedSections);
      return cachedSections;
    }

    const nextSections = await dedupeProjectRequest(
      rootPath,
      'external-libraries',
      async () => {
        const response = await window.electronAPI.codePaneGetExternalLibrarySections({
          rootPath,
        });

        if (!response.success) {
          throw new Error(response.error || t('common.retry'));
        }

        const resolvedSections = response.data ?? [];
        setExternalLibraryCache(rootPath, resolvedSections);
        return resolvedSections;
      },
    );

    applyExternalLibrarySections(nextSections);
    return nextSections;
  }, [applyExternalLibrarySections, rootPath, t]);

  const refreshProjectBootstrapCaches = useCallback(async () => {
    try {
      await Promise.all([
        loadExternalLibrarySections(),
        refreshGitSnapshot(),
      ]);
    } catch (error) {
      if (error instanceof Error) {
        setExternalLibrariesError((currentError) => currentError ?? error.message);
      }
    }
  }, [loadExternalLibrarySections, refreshGitSnapshot]);

  const attachLanguageWorkspace = useCallback(async (seedEntries?: CodePaneTreeEntry[]) => {
    const candidatePath = activeFilePathRef.current
      ?? seedEntries?.find((entry) => entry.type === 'file' && isPathInside(rootPath, entry.path))?.path
      ?? paneRef.current.code?.openFiles?.[0]?.path
      ?? resolvePathFromRoot(rootPath, '__workspace__.java');
    const response = await window.electronAPI.codePaneAttachLanguageWorkspace({
      paneId: pane.id,
      rootPath,
      filePath: candidatePath,
    });
    if (!response.success) {
      console.warn(`[CodePane] codePaneAttachLanguageWorkspace failed: ${response.error ?? 'unknown error'}`);
      return;
    }

    if (response.data && matchesLanguageWorkspaceRoot(rootPath, response.data)) {
      startTransition(() => {
        setLanguageWorkspaceState((currentState) => (
          areLanguageWorkspaceStatesEqual(currentState, response.data ?? null) ? currentState : (response.data ?? null)
        ));
      });
      return;
    }

    const snapshotResponse = await window.electronAPI.codePaneGetLanguageWorkspaceState({
      rootPath,
      filePath: candidatePath,
    });
    if (!snapshotResponse.success) {
      console.warn(`[CodePane] codePaneGetLanguageWorkspaceState failed: ${snapshotResponse.error ?? 'unknown error'}`);
      return;
    }

    if (snapshotResponse.data && matchesLanguageWorkspaceRoot(rootPath, snapshotResponse.data)) {
      startTransition(() => {
        setLanguageWorkspaceState((currentState) => (
          areLanguageWorkspaceStatesEqual(currentState, snapshotResponse.data ?? null)
            ? currentState
            : (snapshotResponse.data ?? null)
        ));
      });
    }
  }, [pane.id, rootPath]);

  const loadExternalDirectory = useCallback(async (
    directoryPath: string,
    options?: { showLoadingIndicator?: boolean },
  ): Promise<CodePaneTreeEntry[]> => {
    const showLoadingIndicator = options?.showLoadingIndicator ?? true;

    if (showLoadingIndicator) {
      setLoadingExternalDirectories((currentLoadingDirectories) => {
        if (currentLoadingDirectories.has(directoryPath)) {
          return currentLoadingDirectories;
        }
        const nextLoadingDirectories = new Set(currentLoadingDirectories);
        nextLoadingDirectories.add(directoryPath);
        return nextLoadingDirectories;
      });
    }

    const response = await window.electronAPI.codePaneListDirectory({
      rootPath,
      targetPath: directoryPath,
    });
    const nextEntries = response.success ? (response.data ?? []) : [];

    if (response.success) {
      setExternalLibrariesError((currentError) => (currentError === null ? currentError : null));
      startTransition(() => {
        setExternalEntriesByDirectory((currentTreeEntries) => {
          const currentEntries = currentTreeEntries[directoryPath];
          if (currentEntries && areTreeEntriesEqual(currentEntries, nextEntries)) {
            return currentTreeEntries;
          }

          compactDirectoryPresentationsCacheRef.current.delete(directoryPath);
          return {
            ...currentTreeEntries,
            [directoryPath]: nextEntries,
          };
        });
        setLoadedExternalDirectories((currentLoadedDirectories) => {
          if (currentLoadedDirectories.has(directoryPath)) {
            return currentLoadedDirectories;
          }
          const nextLoadedDirectories = new Set(currentLoadedDirectories);
          nextLoadedDirectories.add(directoryPath);
          return nextLoadedDirectories;
        });
      });
    } else {
      setBanner({
        tone: 'error',
        message: response.error || t('common.retry'),
      });
    }

    if (showLoadingIndicator) {
      setLoadingExternalDirectories((currentLoadingDirectories) => {
        if (!currentLoadingDirectories.has(directoryPath)) {
          return currentLoadingDirectories;
        }
        const nextLoadingDirectories = new Set(currentLoadingDirectories);
        nextLoadingDirectories.delete(directoryPath);
        return nextLoadingDirectories;
      });
    }
    return nextEntries;
  }, [rootPath, t]);

  const loadExplorerDirectory = useCallback(async (
    directoryPath: string,
    options?: { showLoadingIndicator?: boolean },
  ): Promise<CodePaneTreeEntry[]> => {
    if (isPathInside(rootPath, directoryPath)) {
      return await loadDirectory(directoryPath, options);
    }

    return await loadExternalDirectory(directoryPath, options);
  }, [loadDirectory, loadExternalDirectory, rootPath]);

  const isDirectoryLoaded = useCallback((directoryPath: string) => (
    isPathInside(rootPath, directoryPath)
      ? loadedDirectoriesRef.current.has(directoryPath)
      : loadedExternalDirectoriesRef.current.has(directoryPath)
  ), [rootPath]);

  const isDirectoryLoading = useCallback((directoryPath: string) => (
    isPathInside(rootPath, directoryPath)
      ? loadingDirectories.has(directoryPath)
      : loadingExternalDirectories.has(directoryPath)
  ), [loadingDirectories, loadingExternalDirectories, rootPath]);

  const getDirectoryEntries = useCallback((directoryPath: string) => (
    isPathInside(rootPath, directoryPath)
      ? (treeEntriesByDirectory[directoryPath] ?? [])
      : (externalEntriesByDirectory[directoryPath] ?? [])
  ), [externalEntriesByDirectory, rootPath, treeEntriesByDirectory]);

  const getCompactDirectoryPresentations = useCallback((directoryPath: string) => {
    const entries = getDirectoryEntries(directoryPath);
    const cachedPresentations = compactDirectoryPresentationsCacheRef.current.get(directoryPath);
    if (cachedPresentations && cachedPresentations.entries === entries) {
      return cachedPresentations.presentations;
    }

    const presentations = entries.map((entry) => (
      buildCompactDirectoryPresentation(rootPath, entry, getDirectoryEntries)
    ));
    compactDirectoryPresentationsCacheRef.current.set(directoryPath, {
      entries,
      presentations,
    });
    return presentations;
  }, [getDirectoryEntries, rootPath]);

  const ensureCompactDirectoryChainLoaded = useCallback(async (
    directoryPath: string,
    initialEntries?: CodePaneTreeEntry[],
  ) => {
    if (!isCompactPackageCandidate(rootPath, directoryPath)) {
      return {
        terminalPath: directoryPath,
        visibleDirectoryPaths: [directoryPath],
      };
    }

    const visibleDirectoryPaths = [directoryPath];
    let currentPath = directoryPath;
    let currentEntries = initialEntries;

    while (true) {
      const childEntries = currentEntries
        ?? (isDirectoryLoaded(currentPath)
          ? getDirectoryEntries(currentPath)
          : await loadExplorerDirectory(currentPath));
      if (childEntries.length !== 1) {
        break;
      }

      const [singleChild] = childEntries;
      if (singleChild.type !== 'directory' || !isCompactPackageCandidate(rootPath, singleChild.path)) {
        break;
      }

      visibleDirectoryPaths.push(singleChild.path);
      currentPath = singleChild.path;
      currentEntries = undefined;
    }

    return {
      terminalPath: currentPath,
      visibleDirectoryPaths,
    };
  }, [getDirectoryEntries, isDirectoryLoaded, loadExplorerDirectory, rootPath]);

  const preloadCompactDirectoryChildren = useCallback(async (
    directoryPath: string,
    directoryEntries?: CodePaneTreeEntry[],
  ) => {
    if (!shouldAutoLoadCompactDirectoryChildren(rootPath, directoryPath)) {
      return;
    }

    const rootEntries = directoryEntries
      ?? (isDirectoryLoaded(directoryPath)
        ? getDirectoryEntries(directoryPath)
        : await loadExplorerDirectory(directoryPath));
    const childDirectoryEntries = rootEntries.filter((entry) => entry.type === 'directory');
    await runWithConcurrency(
      childDirectoryEntries,
      CODE_PANE_COMPACT_PRELOAD_CONCURRENCY,
      async (entry) => {
        await ensureCompactDirectoryChainLoaded(entry.path);
      },
    );
  }, [ensureCompactDirectoryChainLoaded, getDirectoryEntries, isDirectoryLoaded, loadExplorerDirectory, rootPath]);

  const revealPathInExplorer = useCallback(async (
    targetPath: string,
    options?: RevealExplorerPathOptions,
  ) => {
    const externalLibraryRoot = externalLibrarySectionsRef.current
      .flatMap((section) => section.roots)
      .find((root) => isPathInside(root.path, targetPath));
    const rootDirectoryPath = externalLibraryRoot?.path ?? rootPath;
    const nextExpandedDirectories = new Set(expandedDirectoriesRef.current);
    if (options?.scrollIntoView) {
      pendingExplorerRevealPathRef.current = targetPath;
      setExplorerRevealVersion((currentVersion) => currentVersion + 1);
    }
    if (options?.showSidebar) {
      showSidebarMode('files');
    }

    nextExpandedDirectories.add(rootPath);
    nextExpandedDirectories.add(rootDirectoryPath);

    const directoryPathsToExpand: string[] = [];
    let currentPath = getParentDirectory(targetPath);
    while (isPathInside(rootDirectoryPath, currentPath) && currentPath !== rootDirectoryPath) {
      directoryPathsToExpand.unshift(currentPath);
      const parentPath = getParentDirectory(currentPath);
      if (parentPath === currentPath) {
        break;
      }
      currentPath = parentPath;
    }

    for (const directoryPath of directoryPathsToExpand) {
      const loadedEntries = isDirectoryLoaded(directoryPath)
        ? getDirectoryEntries(directoryPath)
        : await loadExplorerDirectory(directoryPath);
      await preloadCompactDirectoryChildren(directoryPath, loadedEntries);
      const isCompactCandidate = isCompactPackageCandidate(rootPath, directoryPath);
      const {
        terminalPath,
        visibleDirectoryPaths,
      } = isCompactCandidate
        ? await ensureCompactDirectoryChainLoaded(directoryPath, loadedEntries)
        : {
            terminalPath: directoryPath,
            visibleDirectoryPaths: [directoryPath],
          };
      for (const visiblePath of visibleDirectoryPaths) {
        nextExpandedDirectories.add(visiblePath);
      }
      nextExpandedDirectories.add(terminalPath);
    }

    setExpandedDirectories((currentExpandedDirectories) => (
      areStringSetsEqual(currentExpandedDirectories, nextExpandedDirectories)
        ? currentExpandedDirectories
        : nextExpandedDirectories
    ));
    persistCodeState({
      selectedPath: targetPath,
      expandedPaths: getPersistedExpandedPaths(nextExpandedDirectories),
    });
  }, [
    ensureCompactDirectoryChainLoaded,
    getDirectoryEntries,
    getPersistedExpandedPaths,
    isDirectoryLoaded,
    loadExplorerDirectory,
    persistCodeState,
    preloadCompactDirectoryChildren,
    rootPath,
    showSidebarMode,
  ]);

  const expandDirectorySubtree = useCallback(async (
    directoryPath: string,
    nextExpandedDirectories: Set<string>,
    visitedDirectories = new Set<string>(),
  ) => {
    if (visitedDirectories.has(directoryPath)) {
      return;
    }
    visitedDirectories.add(directoryPath);

    const loadedEntries = isDirectoryLoaded(directoryPath)
      ? getDirectoryEntries(directoryPath)
      : await loadExplorerDirectory(directoryPath);

    await preloadCompactDirectoryChildren(directoryPath, loadedEntries);
    const isCompactCandidate = isCompactPackageCandidate(rootPath, directoryPath);
    const {
      terminalPath,
      visibleDirectoryPaths,
    } = isCompactCandidate
      ? await ensureCompactDirectoryChainLoaded(directoryPath, loadedEntries)
      : {
          terminalPath: directoryPath,
          visibleDirectoryPaths: [directoryPath],
        };

    for (const visiblePath of visibleDirectoryPaths) {
      nextExpandedDirectories.add(visiblePath);
    }
    nextExpandedDirectories.add(terminalPath);

    const terminalEntries = terminalPath === directoryPath
      ? loadedEntries
      : (isDirectoryLoaded(terminalPath)
        ? getDirectoryEntries(terminalPath)
        : await loadExplorerDirectory(terminalPath));

    for (const entry of terminalEntries) {
      if (entry.type === 'directory') {
        await expandDirectorySubtree(entry.path, nextExpandedDirectories, visitedDirectories);
      }
    }
  }, [
    ensureCompactDirectoryChainLoaded,
    getDirectoryEntries,
    isDirectoryLoaded,
    loadExplorerDirectory,
    preloadCompactDirectoryChildren,
    rootPath,
  ]);

  const expandDirectoryPath = useCallback(async (directoryPath: string) => {
    const loadedEntries = isDirectoryLoaded(directoryPath)
      ? getDirectoryEntries(directoryPath)
      : await loadExplorerDirectory(directoryPath);

    await preloadCompactDirectoryChildren(directoryPath, loadedEntries);
    const isCompactCandidate = isCompactPackageCandidate(rootPath, directoryPath);
    const {
      terminalPath,
      visibleDirectoryPaths,
    } = isCompactCandidate
      ? await ensureCompactDirectoryChainLoaded(directoryPath, loadedEntries)
      : {
          terminalPath: directoryPath,
          visibleDirectoryPaths: [directoryPath],
        };
    const nextExpandedDirectories = new Set(expandedDirectoriesRef.current);
    for (const visiblePath of visibleDirectoryPaths) {
      nextExpandedDirectories.add(visiblePath);
    }
    nextExpandedDirectories.add(terminalPath);
    setExpandedDirectories((currentDirectories) => (
      areStringSetsEqual(currentDirectories, nextExpandedDirectories)
        ? currentDirectories
        : nextExpandedDirectories
    ));
    persistCodeState({
      selectedPath: terminalPath,
      expandedPaths: getPersistedExpandedPaths(nextExpandedDirectories),
    });
  }, [
    ensureCompactDirectoryChainLoaded,
    getDirectoryEntries,
    getPersistedExpandedPaths,
    isDirectoryLoaded,
    loadExplorerDirectory,
    persistCodeState,
    preloadCompactDirectoryChildren,
    rootPath,
  ]);

  const expandExplorerSelection = useCallback(async () => {
    const currentSelectedPath = paneRef.current.code?.selectedPath ?? selectedPath;
    if (!currentSelectedPath) {
      return;
    }

    const selectedEntryType = (() => {
      if (currentSelectedPath === rootPath) {
        return 'directory';
      }

      for (const section of externalLibrarySectionsRef.current) {
        for (const root of section.roots) {
          if (currentSelectedPath === root.path) {
            return 'directory';
          }
        }
      }

      const parentEntries = getDirectoryEntries(getParentDirectory(currentSelectedPath));
      return parentEntries.find((entry) => entry.path === currentSelectedPath)?.type ?? null;
    })();

    if (selectedEntryType === 'directory') {
      const nextExpandedDirectories = new Set(expandedDirectoriesRef.current);
      if (currentSelectedPath === rootPath) {
        nextExpandedDirectories.add(rootPath);
      }
      await expandDirectorySubtree(currentSelectedPath, nextExpandedDirectories);
      setExpandedDirectories((currentDirectories) => (
        areStringSetsEqual(currentDirectories, nextExpandedDirectories)
          ? currentDirectories
          : nextExpandedDirectories
      ));
      persistCodeState({
        selectedPath: currentSelectedPath,
        expandedPaths: getPersistedExpandedPaths(nextExpandedDirectories),
      });
      return;
    }

    await revealPathInExplorer(currentSelectedPath, { showSidebar: true });
  }, [
    expandDirectorySubtree,
    getDirectoryEntries,
    getPersistedExpandedPaths,
    persistCodeState,
    revealPathInExplorer,
    rootPath,
    selectedPath,
  ]);

  const collapseAllExplorerDirectories = useCallback(() => {
    const nextExpandedDirectories = new Set<string>();
    setExpandedDirectories((currentExpandedDirectories) => (
      areStringSetsEqual(currentExpandedDirectories, nextExpandedDirectories)
        ? currentExpandedDirectories
        : nextExpandedDirectories
    ));
    persistCodeState({
      expandedPaths: getPersistedExpandedPaths(nextExpandedDirectories),
    });
  }, [getPersistedExpandedPaths, persistCodeState]);

  const createOrUpdateModel = useCallback((filePath: string, readResult: CodePaneReadFileResult) => {
    const monaco = monacoRef.current;
    if (!monaco) {
      return null;
    }

    const modelUri = readResult.documentUri
      ? monaco.Uri.parse(readResult.documentUri)
      : monaco.Uri.file(filePath);
    let model = fileModelsRef.current.get(filePath);
    const previousMeta = fileMetaRef.current.get(filePath);
    const wasExistingModel = Boolean(model);
    let didChangeContent = false;
    let didChangeLanguage = false;
    if (!model) {
      model = monaco.editor.createModel(readResult.content, readResult.language, modelUri);
      const disposable = model.onDidChangeContent(() => {
        if (fileMetaRef.current.get(filePath)?.readOnly) {
          return;
        }

        if (suppressModelEventsRef.current.has(filePath)) {
          return;
        }

        invalidateDefinitionLookupCacheForFile(filePath);
        promotePreviewTab(filePath);
        markDirty(filePath, true);
        scheduleLocalHistorySnapshot(filePath);
        scheduleLanguageDocumentChangeSync(filePath);
        scheduleAutoSave(filePath);
      });

      modelDisposersRef.current.set(filePath, disposable);
      fileModelsRef.current.set(filePath, model);
    } else {
      if (model.getLanguageId() !== readResult.language) {
        monaco.editor.setModelLanguage(model, readResult.language);
        didChangeLanguage = true;
      }

      if (model.getValue() !== readResult.content) {
        suppressModelEventsRef.current.add(filePath);
        model.setValue(readResult.content);
        suppressModelEventsRef.current.delete(filePath);
        invalidateDefinitionLookupCacheForFile(filePath);
        didChangeContent = true;
      }
    }

    fileMetaRef.current.set(filePath, {
      language: readResult.language,
      mtimeMs: readResult.mtimeMs,
      size: readResult.size,
      lastSavedAt: fileMetaRef.current.get(filePath)?.lastSavedAt,
      lastSavedVersionId: getModelVersionId(model),
      readOnly: readResult.readOnly,
      displayPath: readResult.displayPath,
      documentUri: readResult.documentUri,
    });
    modelFilePathRef.current.set(modelUri.path, filePath);

    if (dirtyPathsRef.current.has(filePath)) {
      markDirty(filePath, false);
    }
    if (banner?.filePath === filePath) {
      clearBannerForFile(filePath);
    }
    if (!wasExistingModel) {
      refreshProblems([filePath]);
      addLocalHistoryEntry(filePath, 'open', readResult.content);
      if (!readResult.readOnly) {
        void queueLanguageDocumentSync(filePath, 'open', async () => {
          await syncLanguageDocument(filePath, 'open');
        });
      }
      return model;
    }

    if (didChangeContent || didChangeLanguage || previousMeta?.readOnly !== readResult.readOnly) {
      refreshProblems([filePath]);
    }
    if (!readResult.readOnly && (didChangeContent || didChangeLanguage || previousMeta?.readOnly !== readResult.readOnly)) {
      void queueLanguageDocumentSync(filePath, 'change', async () => {
        await syncLanguageDocument(filePath, 'change');
      });
    }
    return model;
  }, [
    addLocalHistoryEntry,
    banner?.filePath,
    clearBannerForFile,
    markDirty,
    invalidateDefinitionLookupCacheForFile,
    promotePreviewTab,
    queueLanguageDocumentSync,
    refreshProblems,
    scheduleAutoSave,
    scheduleLanguageDocumentChangeSync,
    scheduleLocalHistorySnapshot,
    syncLanguageDocument,
  ]);

  const loadFileIntoModel = useCallback(async (filePath: string) => {
    if (!monacoRef.current && supportsMonaco) {
      const monaco = await ensureMonacoReady();
      if (!monaco) {
        return null;
      }
    }

    const preloadedReadResult = preloadedReadResultsRef.current.get(filePath);
    if (preloadedReadResult) {
      preloadedReadResultsRef.current.delete(filePath);
      return createOrUpdateModel(filePath, preloadedReadResult);
    }

    const response = await window.electronAPI.codePaneReadFile({
      rootPath,
      filePath,
      ...(isVirtualDocumentPath(filePath) ? { documentUri: filePath } : {}),
    });

    if (!response.success || !response.data) {
      if (response.errorCode === CODE_PANE_BINARY_FILE_ERROR_CODE) {
        setBanner({
          tone: 'info',
          message: t('codePane.binaryFile'),
          filePath,
        });
      } else if (response.errorCode === CODE_PANE_FILE_TOO_LARGE_ERROR_CODE) {
        setBanner({
          tone: 'info',
          message: t('codePane.fileTooLarge'),
          filePath,
        });
      } else {
        setBanner({
          tone: 'error',
          message: response.error || t('common.retry'),
          filePath,
        });
      }
      return null;
    }

    return createOrUpdateModel(filePath, response.data);
  }, [createOrUpdateModel, ensureMonacoReady, rootPath, supportsMonaco, t]);

  const getModelFilePath = useCallback((model: MonacoModel | null | undefined) => {
    if (!model) {
      return null;
    }

    return modelFilePathRef.current.get(model.uri.path)
      ?? model.uri.fsPath
      ?? model.uri.path
      ?? null;
  }, []);

  const handleDefinitionClick = useCallback(async (editorInstance: MonacoEditor | null, lineNumber: number, column: number) => {
    const model = editorInstance?.getModel();
    const filePath = getModelFilePath(model);
    if (!model || !filePath) {
      return;
    }

    let nextLocation: CodePaneLocation | null = null;
    try {
      const result = await lookupDefinitionTarget(
        model,
        filePath,
        lineNumber,
        column,
        { showErrors: true },
      );
      nextLocation = result.location;
    } catch (error) {
      if (!isKnownMonacoCancellationError(error)) {
        setBanner({
          tone: 'warning',
          message: error instanceof Error ? error.message : t('common.retry'),
          filePath,
        });
      }
      return;
    }
    if (!nextLocation) {
      return;
    }

    await openFileLocationRef.current({
      filePath: nextLocation.filePath,
      lineNumber: nextLocation.range.startLineNumber,
      column: nextLocation.range.startColumn,
      content: nextLocation.content,
      language: nextLocation.language,
      readOnly: nextLocation.readOnly,
      displayPath: nextLocation.displayPath,
      documentUri: nextLocation.uri,
    });
  }, [getModelFilePath, lookupDefinitionTarget, t]);

  const attachDefinitionClickNavigation = useCallback((
    editorInstance: MonacoEditor | null,
    target: EditorTarget,
  ) => {
    const mouseDownListenerRef = target === 'editor'
      ? editorMouseDownListenerRef
      : target === 'secondary'
        ? secondaryEditorMouseDownListenerRef
        : diffEditorMouseDownListenerRef;
    const mouseMoveListenerRef = target === 'editor'
      ? editorMouseMoveListenerRef
      : target === 'secondary'
        ? secondaryEditorMouseMoveListenerRef
        : diffEditorMouseMoveListenerRef;
    const mouseLeaveListenerRef = target === 'editor'
      ? editorMouseLeaveListenerRef
      : target === 'secondary'
        ? secondaryEditorMouseLeaveListenerRef
        : diffEditorMouseLeaveListenerRef;
    const cursorPositionListenerRef = target === 'editor'
      ? editorCursorPositionListenerRef
      : target === 'secondary'
        ? secondaryEditorCursorPositionListenerRef
        : diffEditorCursorPositionListenerRef;

    mouseDownListenerRef.current?.dispose();
    mouseDownListenerRef.current = null;
    mouseMoveListenerRef.current?.dispose();
    mouseMoveListenerRef.current = null;
    mouseLeaveListenerRef.current?.dispose();
    mouseLeaveListenerRef.current = null;
    cursorPositionListenerRef.current?.dispose();
    cursorPositionListenerRef.current = null;

    if (!editorInstance || typeof editorInstance.onMouseDown !== 'function') {
      return;
    }

    mouseMoveListenerRef.current = editorInstance.onMouseMove?.((event: any) => {
      const pointerEvent = event.event?.browserEvent ?? event.event ?? {};
      const hasModifier = isMac
        ? pointerEvent.metaKey === true || pointerEvent.ctrlKey === true
        : pointerEvent.ctrlKey === true || pointerEvent.metaKey === true;

      if (!hasModifier || !event.target?.position) {
        clearDefinitionLinkDecoration(editorInstance);
        return;
      }

      const model = editorInstance.getModel?.();
      const filePath = getModelFilePath(model);
      if (!model || !filePath) {
        clearDefinitionLinkDecoration(editorInstance);
        return;
      }

      const requestKey = getDefinitionLookupKey(
        model,
        filePath,
        event.target.position.lineNumber,
        event.target.position.column,
      );
      if (definitionHoverRequestKeyRef.current === requestKey) {
        return;
      }

      definitionHoverRequestKeyRef.current = requestKey;
      void updateDefinitionLinkHover(
        editorInstance,
        event.target.position.lineNumber,
        event.target.position.column,
      );
    }) ?? null;

    mouseLeaveListenerRef.current = editorInstance.onMouseLeave?.(() => {
      clearDefinitionLinkDecoration(editorInstance);
    }) ?? null;

    cursorPositionListenerRef.current = editorInstance.onDidChangeCursorPosition?.((event: any) => {
      if (event?.position?.lineNumber) {
        scheduleActiveCursorUpdate(event.position.lineNumber, event.position.column ?? 1);
      }
    }) ?? null;

    mouseDownListenerRef.current = editorInstance.onMouseDown((event: any) => {
      focusedEditorTargetRef.current = target;
      cursorStoreRef.current.setSnapshot({ target });
      if (event?.target?.position?.lineNumber) {
        scheduleActiveCursorUpdate(event.target.position.lineNumber, event.target.position.column ?? 1);
      }
      const pointerEvent = event.event?.browserEvent ?? event.event ?? {};
      const monaco = monacoRef.current;
      const mouseTargetType = event.target?.type;
      const gutterGlyphMarginType = monaco?.editor?.MouseTargetType?.GUTTER_GLYPH_MARGIN;
      const gutterLineDecorationType = monaco?.editor?.MouseTargetType?.GUTTER_LINE_DECORATIONS;
      const isGutterBreakpointTarget = (gutterGlyphMarginType !== undefined && mouseTargetType === gutterGlyphMarginType)
        || (gutterLineDecorationType !== undefined && mouseTargetType === gutterLineDecorationType)
        || mouseTargetType === 'gutterGlyphMargin'
        || event.target?.detail?.isBreakpointMargin === true;
      if (isGutterBreakpointTarget && event.target?.position?.lineNumber) {
        const model = editorInstance.getModel?.();
        const filePath = getModelFilePath(model);
        const isReadOnlyFile = filePath
          ? fileMetaRef.current.get(filePath)?.readOnly === true
          : false;
        if (filePath && !isReadOnlyFile) {
          pointerEvent.preventDefault?.();
          pointerEvent.stopPropagation?.();
          event.event?.preventDefault?.();
          event.event?.stopPropagation?.();
          void toggleBreakpointRef.current(filePath, event.target.position.lineNumber);
        }
        return;
      }

      const hasModifier = isMac
        ? pointerEvent.metaKey === true || pointerEvent.ctrlKey === true
        : pointerEvent.ctrlKey === true || pointerEvent.metaKey === true;
      const isPrimaryButton = event.event?.leftButton === true
        || pointerEvent.button === 0
        || pointerEvent.buttons === 1;

      if (!hasModifier || !isPrimaryButton || !event.target?.position) {
        return;
      }

      pointerEvent.preventDefault?.();
      pointerEvent.stopPropagation?.();
      event.event?.preventDefault?.();
      event.event?.stopPropagation?.();

      void handleDefinitionClick(
        editorInstance,
        event.target.position.lineNumber,
        event.target.position.column,
      );
    });
  }, [
    clearDefinitionLinkDecoration,
    getDefinitionLookupKey,
    getModelFilePath,
    handleDefinitionClick,
    isMac,
    scheduleActiveCursorUpdate,
    updateDefinitionLinkHover,
  ]);

  const refreshEditorSurfaceCore = useCallback(async () => {
    const requestId = ++editorSurfaceRequestIdRef.current;
    const isCurrentRequest = () => requestId === editorSurfaceRequestIdRef.current;
    const hostElement = editorHostRef.current;
    const currentViewMode = paneRef.current.code?.viewMode ?? viewMode;
    const currentActiveFilePath = activeFilePathRef.current;
    const currentExternalEntry = currentActiveFilePath
      ? externalChangeStateRef.current.entriesByPath.get(currentActiveFilePath) ?? null
      : null;
    const shouldUseInlineDiffViewer = currentViewMode === 'editor'
      && currentExternalEntry?.canDiff
      && currentExternalEntry.previousContent !== null
      && currentExternalEntry.currentContent !== null;

    if (shouldUseInlineDiffViewer) {
      disposeEditors();
      return;
    }

    if (!hostElement) {
      return;
    }

    const monaco = await ensureMonacoReady();
    if (!isCurrentRequest()) {
      return;
    }
    if (!monaco) {
      disposeEditors();
      return;
    }

    const currentSecondaryFilePath = secondaryFilePathRef.current;
    const shouldShowSplit = currentViewMode === 'editor'
      && Boolean(paneRef.current.code?.layout?.editorSplit?.visible)
      && Boolean(currentSecondaryFilePath)
      && secondaryEditorHostRef.current;

    if (!currentActiveFilePath) {
      disposeEditors();
      return;
    }

    const revisionRequest = pendingGitRevisionDiffRef.current;
    const usesReadonlyDiffModel = currentViewMode === 'diff' && (
      revisionRequest?.filePath === currentActiveFilePath
    );
    const readonlyDiffModifiedModel = usesReadonlyDiffModel
      ? revisionModifiedModelsRef.current.get(currentActiveFilePath) ?? null
      : null;
    const model = fileModelsRef.current.get(currentActiveFilePath) ?? null;
    if ((!model && !readonlyDiffModifiedModel) || !isCurrentRequest()) {
      return;
    }
    const isReadOnlyFile = fileMetaRef.current.get(currentActiveFilePath)?.readOnly === true;
    const readonlySecondaryFile = currentSecondaryFilePath
      ? fileMetaRef.current.get(currentSecondaryFilePath)?.readOnly === true
      : false;
    const diffRequestKey = currentViewMode === 'diff'
      ? revisionRequest
        ? `revision:${revisionRequest.filePath}:${revisionRequest.leftCommitSha ?? ''}:${revisionRequest.rightCommitSha ?? ''}:${revisionRequest.leftLabel ?? ''}:${revisionRequest.rightLabel ?? ''}`
        : `base:${currentActiveFilePath}:${paneRef.current.code?.diffTargetPath ?? currentActiveFilePath}`
      : null;
    const nextBindingState: EditorSurfaceBindingState = {
      mode: currentViewMode,
      activeFilePath: currentActiveFilePath,
      secondaryFilePath: currentViewMode === 'editor' && shouldShowSplit ? currentSecondaryFilePath ?? null : null,
      diffRequestKey,
      readonlyPrimary: usesReadonlyDiffModel ? true : isReadOnlyFile,
      readonlySecondary: currentViewMode === 'editor' && shouldShowSplit ? readonlySecondaryFile : false,
    };
    const canSkipPrimaryRebind = currentViewMode === 'editor'
      && areEditorSurfaceBindingStatesEqual(editorSurfaceBindingStateRef.current, nextBindingState)
      && editorRef.current?.getModel?.() === model;

    if (!canSkipPrimaryRebind) {
      saveCurrentViewState();
    }

    if (currentViewMode === 'diff') {
      const diffModel = diffModelsRef.current.get(currentActiveFilePath);
      if (!diffModel) {
        disposeEditors();
        return;
      }
      const modifiedModel = usesReadonlyDiffModel ? readonlyDiffModifiedModel : model;
      if (!modifiedModel) {
        disposeEditors();
        return;
      }

      secondaryEditorMouseDownListenerRef.current?.dispose();
      secondaryEditorMouseDownListenerRef.current = null;
      secondaryEditorMouseMoveListenerRef.current?.dispose();
      secondaryEditorMouseMoveListenerRef.current = null;
      secondaryEditorMouseLeaveListenerRef.current?.dispose();
      secondaryEditorMouseLeaveListenerRef.current = null;
      secondaryEditorCursorPositionListenerRef.current?.dispose();
      secondaryEditorCursorPositionListenerRef.current = null;
      secondaryEditorRef.current?.dispose();
      secondaryEditorRef.current = null;
      editorRef.current?.dispose();
      editorRef.current = null;

      if (!diffEditorRef.current) {
        diffEditorRef.current = monaco.editor.createDiffEditor(hostElement, {
          automaticLayout: true,
          minimap: { enabled: false },
          links: false,
          definitionLinkOpensInPeek: false,
          renderSideBySide: false,
          useInlineViewWhenSpaceIsLimited: true,
          wordWrap: 'off',
          fontSize: 13,
          scrollBeyondLastLine: false,
          smoothScrolling: true,
          glyphMargin: false,
          lineDecorationsWidth: 4,
          lineNumbersMinChars: 3,
          folding: false,
          stickyScroll: { enabled: false },
          ...editorInlayHintOptions,
        });
        diffEditorRef.current.getModifiedEditor().addCommand(
          monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
          () => {
            const filePath = activeFilePathRef.current;
            if (filePath) {
              void saveFile(filePath);
            }
          },
        );
        attachDefinitionClickNavigation(diffEditorRef.current.getModifiedEditor(), 'diff');
      }
      if (!isCurrentRequest()) {
        return;
      }

      diffEditorRef.current.setModel({
        original: diffModel,
        modified: modifiedModel,
      });
      diffEditorRef.current.getModifiedEditor().updateOptions?.({
        readOnly: usesReadonlyDiffModel
          ? true
          : isReadOnlyFile,
        glyphMargin: false,
        lineDecorationsWidth: 4,
        lineNumbersMinChars: 3,
        folding: false,
        ...editorInlayHintOptions,
      });
      applyDebugDecorations(diffEditorRef.current.getModifiedEditor(), currentActiveFilePath);

      const savedViewState = viewStatesRef.current.get(currentActiveFilePath);
      if (savedViewState) {
        restoreEditorViewStateSafely(
          diffEditorRef.current.getModifiedEditor(),
          modifiedModel,
          savedViewState,
        );
      }

      applyPendingNavigation(diffEditorRef.current.getModifiedEditor(), currentActiveFilePath);

      if (isActive) {
        focusedEditorTargetRef.current = 'diff';
        cursorStoreRef.current.setSnapshot({ target: 'diff' });
        const modifiedEditor = diffEditorRef.current.getModifiedEditor();
        const modifiedEditorDomNode = modifiedEditor.getDomNode?.() ?? null;
        if (shouldFocusEditorSurface(modifiedEditorDomNode)) {
          modifiedEditor.focus();
        }
      }
      editorSurfaceBindingStateRef.current = nextBindingState;
      return;
    }

    diffEditorMouseDownListenerRef.current?.dispose();
    diffEditorMouseDownListenerRef.current = null;
    detachDiffEditorModel();
    diffEditorRef.current?.dispose();
    diffEditorRef.current = null;

    const ensureCodeEditor = (target: 'editor' | 'secondary', host: HTMLElement) => {
      const editorInstanceRef = target === 'editor' ? editorRef : secondaryEditorRef;
      if (editorInstanceRef.current) {
        return editorInstanceRef.current;
      }

      const nextEditor = monaco.editor.create(host, {
        automaticLayout: true,
        minimap: { enabled: false },
        links: false,
        definitionLinkOpensInPeek: false,
        wordWrap: 'off',
        fontSize: 13,
        tabSize: 2,
        scrollBeyondLastLine: false,
        smoothScrolling: true,
        glyphMargin: false,
        lineDecorationsWidth: 4,
        lineNumbersMinChars: 3,
        stickyScroll: { enabled: false },
        ...editorInlayHintOptions,
      });
      nextEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        const filePath = target === 'secondary'
          ? secondaryFilePathRef.current
          : activeFilePathRef.current;
        if (filePath) {
          void saveFileRef.current(filePath);
        }
      });
      nextEditor.addCommand(monaco.KeyCode.F2, () => {
        void renameSymbolAtCursorRef.current();
      });
      nextEditor.addCommand(monaco.KeyMod.Shift | monaco.KeyCode.F12, () => {
        void findUsagesAtCursorRef.current();
      });
      nextEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.F12, () => {
        openFileStructurePanelRef.current();
      });
      nextEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyH, () => {
        openHierarchyPanelRef.current('type-parents');
      });
      nextEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyH, () => {
        openHierarchyPanelRef.current('call-outgoing');
      });
      nextEditor.addCommand(monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF, () => {
        void formatActiveDocumentRef.current();
      });
      nextEditor.addAction({
        id: 'code-pane-file-structure',
        label: t('codePane.fileStructureAction'),
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.F12],
        contextMenuGroupId: 'navigation',
        contextMenuOrder: 1.4,
        run: () => {
          openFileStructurePanelRef.current();
        },
      });
      nextEditor.addAction({
        id: 'code-pane-type-hierarchy',
        label: t('codePane.typeHierarchyAction'),
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyH],
        contextMenuGroupId: 'navigation',
        contextMenuOrder: 1.5,
        run: () => {
          openHierarchyPanelRef.current('type-parents');
        },
      });
      nextEditor.addAction({
        id: 'code-pane-call-hierarchy',
        label: t('codePane.callHierarchyAction'),
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyH],
        contextMenuGroupId: 'navigation',
        contextMenuOrder: 1.6,
        run: () => {
          openHierarchyPanelRef.current('call-outgoing');
        },
      });
      attachDefinitionClickNavigation(nextEditor, target);
      editorInstanceRef.current = nextEditor;
      return nextEditor;
    };

    const primaryEditor = ensureCodeEditor('editor', hostElement);
    if (!canSkipPrimaryRebind) {
      primaryEditor.setModel(model);
      primaryEditor.updateOptions?.({
        readOnly: isReadOnlyFile,
        ...editorInlayHintOptions,
      });
    }
    applyDebugDecorations(primaryEditor, currentActiveFilePath);

    if (!canSkipPrimaryRebind) {
      const savedViewState = viewStatesRef.current.get(currentActiveFilePath);
      if (savedViewState) {
        restoreEditorViewStateSafely(primaryEditor, model, savedViewState);
      }
    }

    applyPendingNavigation(primaryEditor, currentActiveFilePath);

    if (shouldShowSplit && currentSecondaryFilePath) {
      const secondaryModel = fileModelsRef.current.get(currentSecondaryFilePath);
      if (secondaryModel && secondaryEditorHostRef.current) {
        const secondaryEditor = ensureCodeEditor('secondary', secondaryEditorHostRef.current);
        const shouldRebindSecondaryEditor = !canSkipPrimaryRebind
          || secondaryEditor.getModel?.() !== secondaryModel
          || editorSurfaceBindingStateRef.current?.secondaryFilePath !== currentSecondaryFilePath
          || editorSurfaceBindingStateRef.current?.readonlySecondary !== readonlySecondaryFile;
        if (shouldRebindSecondaryEditor) {
          secondaryEditor.setModel(secondaryModel);
          secondaryEditor.updateOptions?.({
            readOnly: readonlySecondaryFile,
            ...editorInlayHintOptions,
          });

          const savedSecondaryViewState = secondaryViewStatesRef.current.get(currentSecondaryFilePath);
          if (savedSecondaryViewState) {
            restoreEditorViewStateSafely(secondaryEditor, secondaryModel, savedSecondaryViewState);
          }
        }
      }
    } else {
      secondaryEditorMouseDownListenerRef.current?.dispose();
      secondaryEditorMouseDownListenerRef.current = null;
      secondaryEditorMouseMoveListenerRef.current?.dispose();
      secondaryEditorMouseMoveListenerRef.current = null;
      secondaryEditorMouseLeaveListenerRef.current?.dispose();
      secondaryEditorMouseLeaveListenerRef.current = null;
      secondaryEditorCursorPositionListenerRef.current?.dispose();
      secondaryEditorCursorPositionListenerRef.current = null;
      secondaryEditorRef.current?.dispose();
      secondaryEditorRef.current = null;
    }

    if (isActive) {
      focusedEditorTargetRef.current = 'editor';
      cursorStoreRef.current.setSnapshot({ target: 'editor' });
      const primaryEditorDomNode = primaryEditor.getDomNode?.() ?? null;
      if (shouldFocusEditorSurface(primaryEditorDomNode)) {
        primaryEditor.focus();
      }
    }
    editorSurfaceBindingStateRef.current = nextBindingState;
  }, [
    applyDebugDecorations,
    applyPendingNavigation,
    attachDefinitionClickNavigation,
    detachDiffEditorModel,
    disposeEditors,
    editorInlayHintOptions,
    ensureMonacoReady,
    isActive,
    saveCurrentViewState,
    viewMode,
  ]);

  useEffect(() => {
    refreshEditorSurfaceCoreRef.current = refreshEditorSurfaceCore;
  }, [refreshEditorSurfaceCore]);

  const refreshEditorSurface = useCallback(() => {
    const sequence = ++editorSurfaceRefreshSequenceRef.current;
    if (pendingEditorSurfaceRefreshRef.current) {
      queuedEditorSurfaceRefreshRef.current = true;
      return pendingEditorSurfaceRefreshRef.current;
    }

    const runRefresh = async (): Promise<void> => {
      try {
        await refreshEditorSurfaceCoreRef.current?.();
      } finally {
        pendingEditorSurfaceRefreshRef.current = null;
        if (queuedEditorSurfaceRefreshRef.current && sequence !== editorSurfaceRefreshSequenceRef.current) {
          queuedEditorSurfaceRefreshRef.current = false;
          pendingEditorSurfaceRefreshRef.current = runRefresh();
          return await pendingEditorSurfaceRefreshRef.current;
        }
        queuedEditorSurfaceRefreshRef.current = false;
      }
    };

    pendingEditorSurfaceRefreshRef.current = runRefresh();
    return pendingEditorSurfaceRefreshRef.current;
  }, []);

  const applyExternalChangeState = useCallback((
    nextEntries: ExternalChangeEntry[],
    nextSelectedPath: string | null,
  ) => {
    const currentActiveFilePath = activeFilePathRef.current;
    const previousActiveEntry = currentActiveFilePath
      ? externalChangeStateRef.current.entriesByPath.get(currentActiveFilePath) ?? null
      : null;
    const snapshot = createExternalChangeStateSnapshot(nextEntries, nextSelectedPath);
    const nextActiveEntry = currentActiveFilePath
      ? snapshot.entriesByPath.get(currentActiveFilePath) ?? null
      : null;
    const shouldRefreshActiveEditorSurface = Boolean(currentActiveFilePath)
      && (paneRef.current.code?.viewMode ?? viewMode) === 'editor'
      && previousActiveEntry !== nextActiveEntry;
    externalChangeEntriesRef.current = snapshot.entries;
    selectedExternalChangePathRef.current = snapshot.selectedPath;
    externalChangeStateRef.current = snapshot;
    setExternalChangeEntries((currentEntries) => (
      currentEntries === snapshot.entries ? currentEntries : snapshot.entries
    ));
    setSelectedExternalChangePath((currentPath) => (
      currentPath === snapshot.selectedPath ? currentPath : snapshot.selectedPath
    ));
    setSelectedExternalChangeEntry((currentEntry) => (
      currentEntry === snapshot.selectedEntry ? currentEntry : snapshot.selectedEntry
    ));
    if (shouldRefreshActiveEditorSurface) {
      window.requestAnimationFrame(() => {
        void refreshEditorSurface();
      });
    }
  }, [refreshEditorSurface, viewMode]);

  const reloadFileFromDisk = useCallback(async (filePath: string) => {
    const response = await window.electronAPI.codePaneReadFile({
      rootPath,
      filePath,
    });

    if (!response.success || !response.data) {
      setBanner({
        tone: 'warning',
        message: t('codePane.externalChange'),
        filePath,
      });
      return false;
    }

    createOrUpdateModel(filePath, response.data);
    return true;
  }, [createOrUpdateModel, rootPath, t]);

  const suppressExternalChangesForPaths = useCallback((paths: string[]) => {
    const normalizedPaths = paths.map((filePath) => normalizePath(filePath));
    const suppressionExpiresAt = Date.now() + CODE_PANE_SUPPRESSED_EXTERNAL_CHANGE_TTL_MS;
    for (const filePath of normalizedPaths) {
      suppressedExternalChangePathsRef.current.set(filePath, suppressionExpiresAt);
    }
    return normalizedPaths;
  }, []);

  const applySaveQualityDiagnostics = useCallback((filePath: string, diagnostics: CodePaneDiagnostic[]) => {
    const monaco = monacoRef.current;
    const model = fileModelsRef.current.get(filePath);
    if (!monaco || !model) {
      return;
    }

    monaco.editor.setModelMarkers(
      model,
      CODE_PANE_SAVE_QUALITY_LINT_MARKER_OWNER,
      diagnostics.map((diagnostic) => ({
        message: diagnostic.message,
        severity: diagnostic.severity === 'error'
          ? monaco.MarkerSeverity.Error
          : diagnostic.severity === 'warning'
            ? monaco.MarkerSeverity.Warning
            : diagnostic.severity === 'info'
              ? monaco.MarkerSeverity.Info
              : monaco.MarkerSeverity.Hint,
        startLineNumber: diagnostic.startLineNumber,
        startColumn: diagnostic.startColumn,
        endLineNumber: diagnostic.endLineNumber,
        endColumn: diagnostic.endColumn,
        ...(diagnostic.source ? { source: diagnostic.source } : {}),
        ...(diagnostic.code ? { code: diagnostic.code } : {}),
      })),
    );
  }, []);

  const clearSaveQualityDiagnostics = useCallback((filePath: string) => {
    const monaco = monacoRef.current;
    const model = fileModelsRef.current.get(filePath);
    if (!monaco || !model) {
      return;
    }

    monaco.editor.setModelMarkers(model, CODE_PANE_SAVE_QUALITY_LINT_MARKER_OWNER, []);
  }, []);

  const applyLanguageTextEditsWithoutSaving = useCallback(async (
    edits: CodePaneTextEdit[],
    options?: {
      skipGitRefresh?: boolean;
      deferLanguageSync?: boolean;
    },
  ) => {
    let wroteToDisk = false;
    if (edits.length === 0) {
      return {
        didApply: true,
        wroteToDisk: false,
      };
    }

    const editsByFilePath = new Map<string, CodePaneTextEdit[]>();
    for (const edit of edits) {
      const fileEdits = editsByFilePath.get(edit.filePath) ?? [];
      fileEdits.push(edit);
      editsByFilePath.set(edit.filePath, fileEdits);
    }

    for (const [filePath, fileEdits] of editsByFilePath.entries()) {
      const existingModel = fileModelsRef.current.get(filePath);
      if (existingModel) {
        suppressModelEventsRef.current.add(filePath);
        const didApplyToModel = applyTextEditsToModel(existingModel, fileEdits);
        suppressModelEventsRef.current.delete(filePath);
        if (!didApplyToModel) {
          continue;
        }
        invalidateDefinitionLookupCacheForFile(filePath);
        markDirty(filePath, true);
        if (options?.deferLanguageSync) {
          scheduleLanguageDocumentChangeSync(filePath);
        } else {
          await syncLanguageDocument(filePath, 'change');
        }
        continue;
      }

      const readResponse = await window.electronAPI.codePaneReadFile({
        rootPath,
        filePath,
      });
      if (!readResponse.success || !readResponse.data || readResponse.data.isBinary) {
        setBanner({
          tone: 'error',
          message: readResponse.error || t('common.retry'),
          filePath,
        });
        return {
          didApply: false,
          wroteToDisk,
        };
      }

      const nextContent = applyTextEditsToContent(readResponse.data.content, fileEdits);
      const writeResponse = await window.electronAPI.codePaneWriteFile({
        rootPath,
        filePath,
        content: nextContent,
        expectedMtimeMs: readResponse.data.mtimeMs,
      });
      if (!writeResponse.success) {
        setBanner({
          tone: writeResponse.errorCode === CODE_PANE_SAVE_CONFLICT_ERROR_CODE ? 'warning' : 'error',
          message: writeResponse.errorCode === CODE_PANE_SAVE_CONFLICT_ERROR_CODE
            ? t('codePane.saveConflict')
            : (writeResponse.error || t('common.retry')),
          filePath,
          showReload: writeResponse.errorCode === CODE_PANE_SAVE_CONFLICT_ERROR_CODE,
          showOverwrite: writeResponse.errorCode === CODE_PANE_SAVE_CONFLICT_ERROR_CODE,
        });
        return {
          didApply: false,
          wroteToDisk,
        };
      }

      wroteToDisk = true;
      invalidateWorkspaceRuntimeCaches(filePath);
    }

    if (wroteToDisk && !options?.skipGitRefresh) {
      scheduleGitStatusRefresh();
    }
    return {
      didApply: true,
      wroteToDisk,
    };
  }, [
    invalidateDefinitionLookupCacheForFile,
    invalidateWorkspaceRuntimeCaches,
    markDirty,
    rootPath,
    scheduleGitStatusRefresh,
    scheduleLanguageDocumentChangeSync,
    syncLanguageDocument,
    t,
  ]);

  const runSaveQualityPipeline = useCallback(async (filePath: string) => {
    const model = fileModelsRef.current.get(filePath);
    const fileMeta = fileMetaRef.current.get(filePath);
    if (!model || !fileMeta) {
      return {
        qualityState: createSaveQualityState({
          status: 'idle',
        }),
        wroteToDisk: false,
      };
    }

    const steps: CodePaneSaveQualityStep[] = [];
    let wroteToDisk = false;
    const language = fileMeta.language ?? model.getLanguageId();

    if (savePipelineState.formatOnSave) {
      try {
        const response = await window.electronAPI.codePaneFormatDocument({
          rootPath,
          filePath,
          language,
          content: model.getValue(),
          tabSize: 2,
          insertSpaces: true,
        });
        if (!response.success) {
          throw new Error(response.error || t('common.retry'));
        }

        const edits = response.data ?? [];
        if (edits.length > 0) {
          const applyResult = await applyLanguageTextEditsWithoutSaving(edits, {
            skipGitRefresh: true,
            deferLanguageSync: true,
          });
          if (!applyResult.didApply) {
            throw new Error(t('common.retry'));
          }
          wroteToDisk = wroteToDisk || applyResult.wroteToDisk;
        }
        steps.push({
          id: 'format',
          status: 'passed',
          message: edits.length > 0 ? t('codePane.saveQualityFormatted') : t('codePane.saveQualityNoChanges'),
        });
      } catch (error) {
        steps.push({
          id: 'format',
          status: 'error',
          message: error instanceof Error ? error.message : t('common.retry'),
        });
      }
    } else {
      steps.push({
        id: 'format',
        status: 'skipped',
        message: t('codePane.saveQualityDisabled'),
      });
    }

    if (savePipelineState.organizeImportsOnSave) {
      try {
        const response = await window.electronAPI.codePaneGetCodeActions({
          rootPath,
          filePath,
          language,
          range: createFullDocumentRange(model.getValue()),
        });
        if (!response.success) {
          throw new Error(response.error || t('common.retry'));
        }

        const organizeImportsAction = (response.data ?? []).find((action) => (
          action.kind === 'source.organizeImports'
          || action.kind?.startsWith('source.organizeImports')
        ));
        if (!organizeImportsAction) {
          steps.push({
            id: 'organize-imports',
            status: 'skipped',
            message: t('codePane.saveQualityUnavailable'),
          });
        } else {
          const runResponse = await window.electronAPI.codePaneRunCodeAction({
            rootPath,
            filePath,
            language,
            actionId: organizeImportsAction.id,
          });
          if (!runResponse.success) {
            throw new Error(runResponse.error || t('common.retry'));
          }

          const applyResult = await applyLanguageTextEditsWithoutSaving(runResponse.data ?? [], {
            skipGitRefresh: true,
            deferLanguageSync: true,
          });
          if (!applyResult.didApply) {
            throw new Error(t('common.retry'));
          }
          wroteToDisk = wroteToDisk || applyResult.wroteToDisk;
          steps.push({
            id: 'organize-imports',
            status: 'passed',
            message: t('codePane.saveQualityImportsOrganized'),
          });
        }
      } catch (error) {
        steps.push({
          id: 'organize-imports',
          status: 'error',
          message: error instanceof Error ? error.message : t('common.retry'),
        });
      }
    } else {
      steps.push({
        id: 'organize-imports',
        status: 'skipped',
        message: t('codePane.saveQualityDisabled'),
      });
    }

    if (savePipelineState.lintOnSave) {
      try {
        const lintResponse = await window.electronAPI.codePaneLintDocument({
          rootPath,
          filePath,
          language,
          content: model.getValue(),
        });
        if (!lintResponse.success) {
          throw new Error(lintResponse.error || t('common.retry'));
        }

        const diagnostics = lintResponse.data ?? [];
        applySaveQualityDiagnostics(filePath, diagnostics);
        let errorCount = 0;
        let warningCount = 0;
        for (const diagnostic of diagnostics) {
          if (diagnostic.severity === 'error') {
            errorCount += 1;
            continue;
          }
          if (diagnostic.severity === 'warning') {
            warningCount += 1;
          }
        }
        const issueCount = diagnostics.length;
        steps.push({
          id: 'lint',
          status: errorCount > 0 ? 'error' : warningCount > 0 ? 'warning' : 'passed',
          message: issueCount > 0
            ? t('codePane.saveQualityIssues', { count: issueCount })
            : t('codePane.saveQualityClean'),
          issueCount,
        });
      } catch (error) {
        clearSaveQualityDiagnostics(filePath);
        steps.push({
          id: 'lint',
          status: 'error',
          message: error instanceof Error ? error.message : t('common.retry'),
        });
      }
    } else {
      clearSaveQualityDiagnostics(filePath);
      steps.push({
        id: 'lint',
        status: 'skipped',
        message: t('codePane.saveQualityDisabled'),
      });
    }

    return {
      qualityState: createSaveQualityState({
        status: resolveSaveQualityStatus(steps),
        steps,
      }),
      wroteToDisk,
    };
  }, [
    applyLanguageTextEditsWithoutSaving,
    applySaveQualityDiagnostics,
    clearSaveQualityDiagnostics,
    rootPath,
    savePipelineState.formatOnSave,
    savePipelineState.lintOnSave,
    savePipelineState.organizeImportsOnSave,
    t,
  ]);
  const hasSaveQualityPipelineEnabled = savePipelineState.formatOnSave
    || savePipelineState.organizeImportsOnSave
    || savePipelineState.lintOnSave;

  const saveFile = useCallback(async (filePath: string, options?: SaveFileOptions) => {
    const model = fileModelsRef.current.get(filePath);
    const fileMeta = fileMetaRef.current.get(filePath);
    if (!model || !fileMeta) {
      return true;
    }

    if (fileMeta.readOnly) {
      return true;
    }

    if (!dirtyPathsRef.current.has(filePath) && !options?.overwrite) {
      return true;
    }

    if (savingPathsRef.current.has(filePath)) {
      pendingSavePathsRef.current.add(filePath);
      return true;
    }

    let qualityGateStateBeforeWrite: CodePaneSaveQualityState | null = null;
    let didWriteIntermediateFiles = false;
    const shouldRunQualityPipeline = !options?.skipQualityPipeline && hasSaveQualityPipelineEnabled;
    if (shouldRunQualityPipeline) {
      await flushPendingLanguageSync(filePath);
      persistQualityGateState(createSaveQualityState({
        status: 'running',
        message: t('codePane.saveQualityRunning'),
      }));
      const qualityPipelineResult = await runSaveQualityPipeline(filePath);
      qualityGateStateBeforeWrite = qualityPipelineResult.qualityState;
      didWriteIntermediateFiles = qualityPipelineResult.wroteToDisk;
    }
    if (shouldRunQualityPipeline || options?.waitForLanguageSync) {
      await flushPendingLanguageSync(filePath);
    } else {
      enqueuePendingLanguageSync(filePath);
    }

    markSaving(filePath, true);
    const saveVersionId = getModelVersionId(model);
    const saveContent = model.getValue();

    const response = await window.electronAPI.codePaneWriteFile({
      rootPath,
      filePath,
      content: saveContent,
      expectedMtimeMs: options?.overwrite ? undefined : fileMeta.mtimeMs,
    });

    markSaving(filePath, false);

    if (!response.success || !response.data) {
      pendingSavePathsRef.current.delete(filePath);
      if (qualityGateStateBeforeWrite) {
        const nextSteps = updateSaveQualityStep(qualityGateStateBeforeWrite.steps ?? [], {
          id: 'write',
          status: 'error',
          message: response.error || t('common.retry'),
        });
        persistQualityGateState(createSaveQualityState({
          status: resolveSaveQualityStatus(nextSteps),
          message: response.error || t('common.retry'),
          steps: nextSteps,
        }));
      }
      if (response.errorCode === CODE_PANE_SAVE_CONFLICT_ERROR_CODE) {
        setBanner({
          tone: 'warning',
          message: t('codePane.saveConflict'),
          filePath,
          showReload: true,
          showOverwrite: true,
        });
      } else {
        setBanner({
          tone: 'error',
          message: response.error || t('common.retry'),
          filePath,
        });
      }
      return false;
    }

    fileMetaRef.current.set(filePath, {
      ...fileMeta,
      mtimeMs: response.data.mtimeMs,
      lastSavedAt: Date.now(),
      lastSavedVersionId: saveVersionId,
    });
    invalidateWorkspaceRuntimeCaches(filePath);
    addLocalHistoryEntry(filePath, 'save', saveContent);
    if (getModelVersionId(model) === saveVersionId) {
      markDirty(filePath, false);
    }
    const shouldRunFollowUpSave = pendingSavePathsRef.current.delete(filePath) || dirtyPathsRef.current.has(filePath);
    clearBannerForFile(filePath);
    if (qualityGateStateBeforeWrite) {
      const nextSteps = updateSaveQualityStep(qualityGateStateBeforeWrite.steps ?? [], {
        id: 'write',
        status: 'passed',
        message: t('codePane.saveQualityWritten'),
      });
      const nextStatus = resolveSaveQualityStatus(nextSteps);
      persistQualityGateState(createSaveQualityState({
        status: nextStatus,
        message: nextStatus === 'error'
          ? nextSteps.find((step) => step.status === 'error')?.message
          : nextStatus === 'warning'
            ? nextSteps.find((step) => step.status === 'warning')?.message ?? t('codePane.saveQualitySavedWithIssues')
            : t('codePane.saveQualitySaved'),
        steps: nextSteps,
      }));
    }
    void queueLanguageDocumentSync(filePath, 'save', async () => {
      await syncLanguageDocument(filePath, 'save');
    });
    if (shouldRunFollowUpSave && !options?.overwrite) {
      scheduleAutoSave(filePath);
    }
    if (!options?.skipGitRefresh) {
      scheduleGitStatusRefresh({
        force: didWriteIntermediateFiles,
      });
    }
    return true;
  }, [
    addLocalHistoryEntry,
    clearBannerForFile,
    enqueuePendingLanguageSync,
    flushPendingLanguageSync,
    markDirty,
    markSaving,
    queueLanguageDocumentSync,
    rootPath,
    runSaveQualityPipeline,
    invalidateWorkspaceRuntimeCaches,
    scheduleAutoSave,
    scheduleGitStatusRefresh,
    syncLanguageDocument,
    t,
    hasSaveQualityPipelineEnabled,
    persistQualityGateState,
  ]);

  const flushDirtyFiles = useCallback(async (targetFilePaths?: string[]) => {
    let didSaveAnyFile = false;
    const pathsToFlush = targetFilePaths ?? dirtyPathsRef.current;
    for (const filePath of pathsToFlush) {
      const existingTimer = autoSaveTimersRef.current.get(filePath);
      if (existingTimer) {
        clearTimeout(existingTimer);
        autoSaveTimersRef.current.delete(filePath);
      }

      const wasDirtyBeforeSave = dirtyPathsRef.current.has(filePath);
      const didSave = await saveFile(filePath, { skipGitRefresh: true });
      if (!didSave) {
        return false;
      }
      didSaveAnyFile = didSaveAnyFile || wasDirtyBeforeSave;
    }

    if (didSaveAnyFile) {
      scheduleGitStatusRefresh();
    }

    return true;
  }, [saveFile, scheduleGitStatusRefresh]);

  const getCurrentViewFilePath = useCallback(() => {
    const currentViewMode = paneRef.current.code?.viewMode ?? viewMode;

    if (currentViewMode === 'diff') {
      return activeFilePathRef.current
        ?? getModelFilePath(diffEditorRef.current?.getModifiedEditor()?.getModel?.() ?? null);
    }

    if (focusedEditorTargetRef.current === 'secondary' && isEditorSplitVisible) {
      return secondaryFilePathRef.current
        ?? getModelFilePath(secondaryEditorRef.current?.getModel?.() ?? null)
        ?? activeFilePathRef.current
        ?? getModelFilePath(editorRef.current?.getModel?.() ?? null);
    }

    return activeFilePathRef.current
      ?? getModelFilePath(editorRef.current?.getModel?.() ?? null)
      ?? (isEditorSplitVisible
        ? secondaryFilePathRef.current ?? getModelFilePath(secondaryEditorRef.current?.getModel?.() ?? null)
        : null);
  }, [getModelFilePath, isEditorSplitVisible, viewMode]);

  const getActiveEditorContext = useCallback(() => {
    const currentViewMode = paneRef.current.code?.viewMode ?? viewMode;
    const currentFocusedEditorTarget = focusedEditorTargetRef.current;
    const editorInstance = currentViewMode === 'diff'
      ? diffEditorRef.current?.getModifiedEditor() ?? null
      : currentFocusedEditorTarget === 'secondary' && isEditorSplitVisible
        ? secondaryEditorRef.current ?? editorRef.current
        : editorRef.current;
    const model = editorInstance?.getModel();
    const filePath = currentViewMode === 'diff'
      ? activeFilePathRef.current
      : currentFocusedEditorTarget === 'secondary' && isEditorSplitVisible
        ? secondaryFilePathRef.current ?? getModelFilePath(model)
        : activeFilePathRef.current ?? getModelFilePath(model);
    const position = editorInstance?.getPosition?.();

    if (!editorInstance || !model || !filePath || !position) {
      return null;
    }

    return {
      editorInstance,
      model,
      filePath,
      position,
      selection: editorInstance.getSelection?.() ?? null,
      language: fileMetaRef.current.get(filePath)?.language ?? model.getLanguageId(),
      readOnly: Boolean(fileMetaRef.current.get(filePath)?.readOnly),
    };
  }, [getModelFilePath, isEditorSplitVisible, viewMode]);

  const handleLocateCurrentViewFile = useCallback(() => {
    const currentViewFilePath = getCurrentViewFilePath();
    if (!currentViewFilePath) {
      return;
    }

    void revealPathInExplorer(currentViewFilePath, {
      showSidebar: true,
      scrollIntoView: true,
    });
  }, [getCurrentViewFilePath, revealPathInExplorer]);

  const loadQuickDocumentation = useCallback(async () => {
    const context = getActiveEditorContext();
    if (!context) {
      setQuickDocumentation((currentResult) => (currentResult === null ? currentResult : null));
      setQuickDocumentationError((currentError) => (currentError === null ? currentError : null));
      setIsQuickDocumentationLoading((currentLoading) => (currentLoading === false ? currentLoading : false));
      return;
    }

    const requestPath = getModelRequestPath(context.filePath);
    const requestKey = `quick-documentation:${requestPath}`;
    const requestVersion = runtimeStoreRef.current.markLatest(requestKey);
    const cacheKey = `${requestKey}:${context.position.lineNumber}:${context.position.column}`;
    const cachedResult = runtimeStoreRef.current.getCache<CodePaneHoverResult | null>(
      cacheKey,
      CODE_PANE_TOOL_WINDOW_CACHE_TTL_MS,
    );
    if (cachedResult) {
      runtimeStoreRef.current.recordRequest(requestKey, t('codePane.requestQuickDocumentation'), {
        meta: `${getRelativePath(rootPath, context.filePath)}:${context.position.lineNumber}`,
        fromCache: true,
      });
      setQuickDocumentation((currentResult) => (
        areHoverResultsEqual(currentResult, cachedResult) ? currentResult : cachedResult
      ));
      setQuickDocumentationError((currentError) => (currentError === null ? currentError : null));
      setIsQuickDocumentationLoading((currentLoading) => (currentLoading ? false : currentLoading));
      return;
    }
    setIsQuickDocumentationLoading((currentLoading) => (currentLoading ? currentLoading : true));
    setQuickDocumentationError((currentError) => (currentError === null ? currentError : null));

    try {
      const response = await trackRequest(
        requestKey,
        t('codePane.requestQuickDocumentation'),
        `${getRelativePath(rootPath, context.filePath)}:${context.position.lineNumber}`,
        async () => await window.electronAPI.codePaneGetHover({
          rootPath,
          filePath: requestPath,
          language: context.language,
          position: {
            lineNumber: context.position.lineNumber,
            column: context.position.column,
          },
        }),
      );

      if (!runtimeStoreRef.current.isLatest(requestKey, requestVersion)) {
        return;
      }

      const nextResult = response.success ? (response.data ?? null) : null;
      if (response.success) {
        runtimeStoreRef.current.setCache(cacheKey, nextResult);
      }
      const nextError = response.success ? null : (response.error || t('common.retry'));
      setQuickDocumentation((currentResult) => (
        areHoverResultsEqual(currentResult, nextResult) ? currentResult : nextResult
      ));
      setQuickDocumentationError((currentError) => (
        currentError === nextError ? currentError : nextError
      ));
    } catch (error) {
      if (!runtimeStoreRef.current.isLatest(requestKey, requestVersion)) {
        return;
      }

      const nextError = error instanceof Error ? error.message : t('common.retry');
      setQuickDocumentation((currentResult) => (currentResult === null ? currentResult : null));
      setQuickDocumentationError((currentError) => (
        currentError === nextError ? currentError : nextError
      ));
    } finally {
      if (runtimeStoreRef.current.isLatest(requestKey, requestVersion)) {
        setIsQuickDocumentationLoading((currentLoading) => (currentLoading === false ? currentLoading : false));
      }
    }
  }, [getActiveEditorContext, getModelRequestPath, rootPath, t, trackRequest]);

  const toggleQuickDocumentation = useCallback(() => {
    if (isQuickDocumentationOpen) {
      setIsQuickDocumentationOpen((currentOpen) => (currentOpen ? false : currentOpen));
      return;
    }

    setIsQuickDocumentationOpen((currentOpen) => (currentOpen ? currentOpen : true));
    void loadQuickDocumentation();
  }, [isQuickDocumentationOpen, loadQuickDocumentation]);

  const resolveInspectorTargetContext = useCallback(async (
    filePath: string,
    options?: {
      preferredRange?: CodePaneDocumentSymbol['selectionRange'] | null;
    },
  ): Promise<InspectorTargetContext | null> => {
    const activeContext = getActiveEditorContext();
    if (activeContext && activeContext.filePath === filePath) {
      return {
        filePath,
        language: activeContext.language,
        position: {
          lineNumber: activeContext.position.lineNumber,
          column: activeContext.position.column,
        },
      };
    }

    const model = fileModelsRef.current.get(filePath) ?? await loadFileIntoModel(filePath);
    if (!model) {
      return null;
    }

    const preferredRange = options?.preferredRange;
    return {
      filePath,
      language: fileMetaRef.current.get(filePath)?.language ?? model.getLanguageId(),
      position: {
        lineNumber: preferredRange?.startLineNumber ?? 1,
        column: preferredRange?.startColumn ?? 1,
      },
    };
  }, [getActiveEditorContext, loadFileIntoModel]);

  const loadDocumentSymbols = useCallback(async (targetFilePath?: string) => {
    const context = targetFilePath
      ? await resolveInspectorTargetContext(targetFilePath)
      : getActiveEditorContext();
    if (!context) {
      documentSymbolsRequestIdRef.current += 1;
      setDocumentSymbols((currentSymbols) => (currentSymbols.length === 0 ? currentSymbols : []));
      setDocumentSymbolsFilePath((currentFilePath) => (currentFilePath === null ? currentFilePath : null));
      setDocumentSymbolsError((currentError) => (currentError === null ? currentError : null));
      setIsDocumentSymbolsLoading((currentLoading) => (currentLoading === false ? currentLoading : false));
      return;
    }

    const requestPath = getModelRequestPath(context.filePath);
    const requestKey = `document-symbols:${requestPath}`;
    const requestVersion = ++documentSymbolsRequestIdRef.current;
    const requestFilePath = context.filePath;
    const cachedSymbols = runtimeStoreRef.current.getCache<CodePaneDocumentSymbol[]>(
      requestKey,
      CODE_PANE_TOOL_WINDOW_CACHE_TTL_MS,
    );
    if (cachedSymbols) {
      runtimeStoreRef.current.recordRequest(requestKey, t('codePane.requestDocumentSymbols'), {
        meta: getRelativePath(rootPath, context.filePath),
        fromCache: true,
      });
      setDocumentSymbols((currentSymbols) => (
        areDocumentSymbolListsEqual(currentSymbols, cachedSymbols) ? currentSymbols : cachedSymbols
      ));
      setDocumentSymbolsFilePath((currentFilePath) => (
        currentFilePath === requestFilePath ? currentFilePath : requestFilePath
      ));
      setDocumentSymbolsError((currentError) => (currentError === null ? currentError : null));
      setIsDocumentSymbolsLoading((currentLoading) => (currentLoading ? false : currentLoading));
      return;
    }
    setIsDocumentSymbolsLoading((currentLoading) => (currentLoading ? currentLoading : true));
    setDocumentSymbolsError((currentError) => (currentError === null ? currentError : null));
    setDocumentSymbolsFilePath((currentFilePath) => (
      currentFilePath === requestFilePath ? currentFilePath : requestFilePath
    ));

    try {
      const response = await trackRequest(
        requestKey,
        t('codePane.requestDocumentSymbols'),
        getRelativePath(rootPath, context.filePath),
        async () => await window.electronAPI.codePaneGetDocumentSymbols({
          rootPath,
          filePath: requestPath,
          language: context.language,
        }),
      );

      if (documentSymbolsRequestIdRef.current !== requestVersion) {
        return;
      }

      const nextSymbols = response.success ? (response.data ?? []) : [];
      if (response.success) {
        runtimeStoreRef.current.setCache(requestKey, nextSymbols);
      }
      const nextError = response.success ? null : (response.error || t('common.retry'));
      setDocumentSymbols((currentSymbols) => (
        areDocumentSymbolListsEqual(currentSymbols, nextSymbols) ? currentSymbols : nextSymbols
      ));
      setDocumentSymbolsError((currentError) => (
        currentError === nextError ? currentError : nextError
      ));
    } catch (error) {
      if (documentSymbolsRequestIdRef.current !== requestVersion) {
        return;
      }

      const nextError = error instanceof Error ? error.message : t('common.retry');
      setDocumentSymbols((currentSymbols) => (currentSymbols.length === 0 ? currentSymbols : []));
      setDocumentSymbolsError((currentError) => (
        currentError === nextError ? currentError : nextError
      ));
    } finally {
      if (documentSymbolsRequestIdRef.current === requestVersion) {
        setIsDocumentSymbolsLoading((currentLoading) => (currentLoading === false ? currentLoading : false));
      }
    }
  }, [getActiveEditorContext, getModelRequestPath, resolveInspectorTargetContext, rootPath, t, trackRequest]);

  const closeInspectorPanel = useCallback(() => {
    setInspectorPanelMode((currentMode) => (currentMode === null ? currentMode : null));
    setInspectorPanelFilePath((currentFilePath) => (currentFilePath === null ? currentFilePath : null));
  }, []);

  const openInspectorOutlinePanel = useCallback(async (filePath: string) => {
    setInspectorPanelMode((currentMode) => (currentMode === 'outline' ? currentMode : 'outline'));
    setInspectorPanelFilePath((currentFilePath) => (currentFilePath === filePath ? currentFilePath : filePath));
    await loadDocumentSymbols(filePath);
  }, [loadDocumentSymbols]);

  const loadDocumentSymbolsForFile = useCallback(async (filePath: string) => {
    const context = await resolveInspectorTargetContext(filePath);
    if (!context) {
      return null;
    }

    const requestPath = getModelRequestPath(filePath);
    const requestKey = `document-symbols:${requestPath}`;
    const cachedSymbols = runtimeStoreRef.current.getCache<CodePaneDocumentSymbol[]>(
      requestKey,
      CODE_PANE_TOOL_WINDOW_CACHE_TTL_MS,
    );
    if (cachedSymbols) {
      runtimeStoreRef.current.recordRequest(requestKey, t('codePane.requestDocumentSymbols'), {
        meta: getRelativePath(rootPath, filePath),
        fromCache: true,
      });
      return cachedSymbols;
    }

    const response = await trackRequest(
      requestKey,
      t('codePane.requestDocumentSymbols'),
      getRelativePath(rootPath, filePath),
      async () => await window.electronAPI.codePaneGetDocumentSymbols({
        rootPath,
        filePath: requestPath,
        language: context.language,
      }),
    );

    if (response.success) {
      const nextSymbols = response.data ?? [];
      runtimeStoreRef.current.setCache(requestKey, nextSymbols);
      return nextSymbols;
    }

    return null;
  }, [getModelRequestPath, getRelativePath, resolveInspectorTargetContext, rootPath, t, trackRequest]);

  const loadHierarchyRoot = useCallback(async (
    mode: HierarchyMode,
    targetFilePath?: string,
    preferredRange?: CodePaneDocumentSymbol['selectionRange'] | null,
  ) => {
    const resolvedPreferredRange = preferredRange ?? (
      targetFilePath && documentSymbolsFilePath === targetFilePath
        ? documentSymbols[0]?.selectionRange ?? null
        : null
    );
    const context = targetFilePath
      ? await resolveInspectorTargetContext(targetFilePath, { preferredRange: resolvedPreferredRange })
      : getActiveEditorContext();
    if (!context) {
      setHierarchyRootNode((currentNode) => (currentNode === null ? currentNode : null));
      setHierarchyError((currentError) => (currentError === null ? currentError : null));
      setIsHierarchyLoading((currentLoading) => (currentLoading === false ? currentLoading : false));
      return;
    }

    const requestPath = getModelRequestPath(context.filePath);
    const requestKey = `hierarchy:${mode}:${requestPath}:${context.position.lineNumber}:${context.position.column}`;
    const requestVersion = ++hierarchyRequestIdRef.current;
    const requestLabel = mode.startsWith('call')
      ? t('codePane.requestCallHierarchy')
      : t('codePane.requestTypeHierarchy');
    const cachedRootNode = runtimeStoreRef.current.getCache<HierarchyTreeNode | null>(
      requestKey,
      CODE_PANE_TOOL_WINDOW_CACHE_TTL_MS,
    );
    if (cachedRootNode) {
      runtimeStoreRef.current.recordRequest(requestKey, requestLabel, {
        meta: `${getRelativePath(rootPath, context.filePath)}:${context.position.lineNumber}`,
        fromCache: true,
      });
      setHierarchyRootNode((currentNode) => (
        areHierarchyTreeNodesEqual(currentNode, cachedRootNode) ? currentNode : cachedRootNode
      ));
      setHierarchyError((currentError) => (currentError === null ? currentError : null));
      setIsHierarchyLoading((currentLoading) => (currentLoading ? false : currentLoading));
      return;
    }
    setIsHierarchyLoading((currentLoading) => (currentLoading ? currentLoading : true));
    setHierarchyError((currentError) => (currentError === null ? currentError : null));

    try {
      const response = mode.startsWith('call')
        ? await trackRequest(
          requestKey,
          requestLabel,
          `${getRelativePath(rootPath, context.filePath)}:${context.position.lineNumber}`,
          async () => await window.electronAPI.codePaneGetCallHierarchy({
            rootPath,
            filePath: requestPath,
            language: context.language,
            position: {
              lineNumber: context.position.lineNumber,
              column: context.position.column,
            },
            direction: (mode === 'call-incoming' ? 'incoming' : 'outgoing') satisfies CodePaneCallHierarchyDirection,
          }),
        )
        : await trackRequest(
          requestKey,
          requestLabel,
          `${getRelativePath(rootPath, context.filePath)}:${context.position.lineNumber}`,
          async () => await window.electronAPI.codePaneGetTypeHierarchy({
            rootPath,
            filePath: requestPath,
            language: context.language,
            position: {
              lineNumber: context.position.lineNumber,
              column: context.position.column,
            },
            direction: (mode === 'type-parents' ? 'parents' : 'children') satisfies CodePaneTypeHierarchyDirection,
          }),
        );

      if (hierarchyRequestIdRef.current !== requestVersion) {
        return;
      }

      const hierarchyResult: CodePaneHierarchyResult = response.success && response.data
        ? response.data
        : {
          root: null,
          items: [],
        };

      const nextRootNode = hierarchyResult.root
        ? createHierarchyTreeNode(hierarchyResult.root, hierarchyResult.items)
        : null;
      if (response.success) {
        runtimeStoreRef.current.setCache(requestKey, nextRootNode);
      }
      const nextError = response.success ? null : (response.error || t('common.retry'));

      setHierarchyRootNode((currentNode) => (
        areHierarchyTreeNodesEqual(currentNode, nextRootNode) ? currentNode : nextRootNode
      ));
      setHierarchyError((currentError) => (
        currentError === nextError ? currentError : nextError
      ));
    } catch (error) {
      if (hierarchyRequestIdRef.current !== requestVersion) {
        return;
      }

      const nextError = error instanceof Error ? error.message : t('common.retry');
      setHierarchyRootNode((currentNode) => (currentNode === null ? currentNode : null));
      setHierarchyError((currentError) => (
        currentError === nextError ? currentError : nextError
      ));
    } finally {
      if (hierarchyRequestIdRef.current === requestVersion) {
        setIsHierarchyLoading((currentLoading) => (currentLoading === false ? currentLoading : false));
      }
    }
  }, [
    documentSymbols,
    documentSymbolsFilePath,
    getActiveEditorContext,
    getModelRequestPath,
    resolveInspectorTargetContext,
    rootPath,
    t,
    trackRequest,
  ]);

  const openInspectorHierarchyPanel = useCallback(async (filePath: string, mode: HierarchyMode) => {
    setSelectedHierarchyMode(mode);
    setInspectorPanelMode((currentMode) => (currentMode === 'hierarchy' ? currentMode : 'hierarchy'));
    setInspectorPanelFilePath((currentFilePath) => (currentFilePath === filePath ? currentFilePath : filePath));
    const symbols = await loadDocumentSymbolsForFile(filePath).catch(() => null);
    const preferredRange = symbols?.[0]?.selectionRange ?? null;
    const context = await resolveInspectorTargetContext(filePath, { preferredRange });
    if (!context) {
      const nextError = t('common.retry');
      setHierarchyRootNode((currentNode) => (currentNode === null ? currentNode : null));
      setHierarchyError((currentError) => (
        currentError === nextError ? currentError : nextError
      ));
      setIsHierarchyLoading((currentLoading) => (currentLoading === false ? currentLoading : false));
      return;
    }

    const nextSymbols = symbols ?? [];
    setDocumentSymbols((currentSymbols) => (
      areDocumentSymbolListsEqual(currentSymbols, nextSymbols) ? currentSymbols : nextSymbols
    ));
    setDocumentSymbolsFilePath((currentFilePath) => (
      currentFilePath === filePath ? currentFilePath : filePath
    ));
    setDocumentSymbolsError((currentError) => (currentError === null ? currentError : null));
    await loadHierarchyRoot(mode, context.filePath, preferredRange);
  }, [loadDocumentSymbolsForFile, loadHierarchyRoot, resolveInspectorTargetContext, t]);

  const openFileStructurePanel = useCallback(() => {
    if (!activeFilePath) {
      return;
    }

    void openInspectorOutlinePanel(activeFilePath);
  }, [activeFilePath, openInspectorOutlinePanel]);

  const openHierarchyPanel = useCallback((mode: HierarchyMode) => {
    if (!activeFilePath) {
      return;
    }

    void openInspectorHierarchyPanel(activeFilePath, mode);
  }, [activeFilePath, openInspectorHierarchyPanel]);

  useEffect(() => {
    openFileStructurePanelRef.current = openFileStructurePanel;
  }, [openFileStructurePanel]);

  useEffect(() => {
    openHierarchyPanelRef.current = openHierarchyPanel;
  }, [openHierarchyPanel]);

  const toggleHierarchyNode = useCallback(async (nodeKey: string) => {
    const currentRootNode = hierarchyRootNode;
    const targetNode = findHierarchyTreeNode(currentRootNode, nodeKey);
    if (!currentRootNode || !targetNode) {
      return;
    }

    if (!targetNode.isExpandable && targetNode.children.length === 0) {
      return;
    }

    if (targetNode.children.length > 0) {
      setHierarchyRootNode((currentNode) => {
        if (!currentNode) {
          return currentNode;
        }

        const nextNode = updateHierarchyTreeNode(currentNode, nodeKey, (candidate) => {
          const nextCandidate = {
            ...candidate,
            isExpanded: !candidate.isExpanded,
          };
          return areHierarchyTreeNodesEqual(candidate, nextCandidate) ? candidate : nextCandidate;
        });

        return areHierarchyTreeNodesEqual(currentNode, nextNode) ? currentNode : nextNode;
      });
      return;
    }

    setHierarchyRootNode((currentNode) => {
      if (!currentNode) {
        return currentNode;
      }

      const nextNode = updateHierarchyTreeNode(currentNode, nodeKey, (candidate) => {
        const nextCandidate = {
          ...candidate,
          isExpanded: true,
          isLoading: true,
          error: null,
        };
        return areHierarchyTreeNodesEqual(candidate, nextCandidate) ? candidate : nextCandidate;
      });

      return areHierarchyTreeNodesEqual(currentNode, nextNode) ? currentNode : nextNode;
    });

    try {
      const requestLabel = selectedHierarchyMode.startsWith('call')
        ? t('codePane.requestCallHierarchyChildren')
        : t('codePane.requestTypeHierarchyChildren');
      const response = selectedHierarchyMode.startsWith('call')
        ? await trackRequest(
          `hierarchy-child:${selectedHierarchyMode}:${nodeKey}`,
          requestLabel,
          targetNode.item.name,
          async () => await window.electronAPI.codePaneResolveCallHierarchy({
            rootPath,
            language: targetNode.item.language,
            direction: (
              selectedHierarchyMode === 'call-incoming'
                ? 'incoming'
                : 'outgoing'
            ) satisfies CodePaneCallHierarchyDirection,
            item: targetNode.item,
          }),
        )
        : await trackRequest(
          `hierarchy-child:${selectedHierarchyMode}:${nodeKey}`,
          requestLabel,
          targetNode.item.name,
          async () => await window.electronAPI.codePaneResolveTypeHierarchy({
            rootPath,
            language: targetNode.item.language,
            direction: (
              selectedHierarchyMode === 'type-parents'
                ? 'parents'
                : 'children'
            ) satisfies CodePaneTypeHierarchyDirection,
            item: targetNode.item,
          }),
        );

      setHierarchyRootNode((currentNode) => (
        currentNode
          ? (() => {
            const nextNode = updateHierarchyTreeNode(currentNode, nodeKey, (candidate) => {
              const nextChildren = response.success
                ? (response.data ?? []).map((item) => createHierarchyTreeNode(item))
                : [];
              const nextCandidate = {
                ...candidate,
                children: nextChildren,
                isExpanded: true,
                isLoading: false,
                isExpandable: nextChildren.length > 0,
                error: response.success ? null : (response.error || t('common.retry')),
              };
              return areHierarchyTreeNodesEqual(candidate, nextCandidate) ? candidate : nextCandidate;
            });
            return areHierarchyTreeNodesEqual(currentNode, nextNode) ? currentNode : nextNode;
          })()
          : currentNode
      ));
    } catch (error) {
      setHierarchyRootNode((currentNode) => (
        currentNode
          ? (() => {
            const nextNode = updateHierarchyTreeNode(currentNode, nodeKey, (candidate) => {
              const nextCandidate = {
                ...candidate,
                isLoading: false,
                error: error instanceof Error ? error.message : t('common.retry'),
              };
              return areHierarchyTreeNodesEqual(candidate, nextCandidate) ? candidate : nextCandidate;
            });
            return areHierarchyTreeNodesEqual(currentNode, nextNode) ? currentNode : nextNode;
          })()
          : currentNode
      ));
    }
  }, [hierarchyRootNode, rootPath, selectedHierarchyMode, t, trackRequest]);

  const openHierarchyItem = useCallback(async (item: CodePaneHierarchyItem) => {
    await openFileLocationRef.current({
      filePath: item.filePath,
      lineNumber: item.selectionRange.startLineNumber,
      column: item.selectionRange.startColumn,
      content: item.content,
      language: item.language,
      readOnly: item.readOnly,
      displayPath: item.displayPath,
      documentUri: item.uri ?? (isVirtualDocumentPath(item.filePath) ? item.filePath : undefined),
    });
  }, []);

  const loadSemanticSummary = useCallback(async () => {
    const context = getActiveEditorContext();
    if (!context) {
      setSemanticLegend((currentLegend) => (currentLegend === null ? currentLegend : null));
      setSemanticSummary((currentSummary) => (currentSummary.length === 0 ? currentSummary : []));
      setSemanticTokenCount((currentCount) => (currentCount === 0 ? currentCount : 0));
      setSemanticSummaryFileLabel((currentLabel) => (currentLabel === null ? currentLabel : null));
      setSemanticSummaryError((currentError) => (currentError === null ? currentError : null));
      setIsSemanticSummaryLoading((currentLoading) => (currentLoading === false ? currentLoading : false));
      return;
    }

    const requestPath = getModelRequestPath(context.filePath);
    const requestKey = `semantic:${requestPath}`;
    const requestVersion = ++semanticRequestIdRef.current;
    const nextFileLabel = getRelativePath(rootPath, context.filePath);
    const cachedSemanticResult = runtimeStoreRef.current.getCache<CodePaneSemanticTokensResult | null>(
      requestKey,
      CODE_PANE_TOOL_WINDOW_CACHE_TTL_MS,
    );
    if (cachedSemanticResult) {
      runtimeStoreRef.current.recordRequest(requestKey, t('codePane.requestSemanticTokens'), {
        meta: getRelativePath(rootPath, context.filePath),
        fromCache: true,
      });
      const nextSummary = summarizeSemanticTokens(cachedSemanticResult);
      setSemanticLegend((currentLegend) => (
        areSemanticLegendsEqual(currentLegend, cachedSemanticResult.legend) ? currentLegend : cachedSemanticResult.legend
      ));
      setSemanticSummary((currentSummary) => (
        areSemanticSummaryEntriesEqual(currentSummary, nextSummary.summary) ? currentSummary : nextSummary.summary
      ));
      setSemanticTokenCount((currentCount) => (
        currentCount === nextSummary.totalTokens ? currentCount : nextSummary.totalTokens
      ));
      setSemanticSummaryFileLabel((currentLabel) => (
        currentLabel === nextFileLabel ? currentLabel : nextFileLabel
      ));
      setSemanticSummaryError((currentError) => (currentError === null ? currentError : null));
      setIsSemanticSummaryLoading((currentLoading) => (currentLoading ? false : currentLoading));
      return;
    }
    setIsSemanticSummaryLoading((currentLoading) => (currentLoading ? currentLoading : true));
    setSemanticSummaryError((currentError) => (currentError === null ? currentError : null));
    setSemanticSummaryFileLabel((currentLabel) => (
      currentLabel === nextFileLabel ? currentLabel : nextFileLabel
    ));

    try {
      const response = await trackRequest(
        requestKey,
        t('codePane.requestSemanticTokens'),
        getRelativePath(rootPath, context.filePath),
        async () => await window.electronAPI.codePaneGetSemanticTokens({
          rootPath,
          filePath: requestPath,
          language: context.language,
        }),
      );

      if (semanticRequestIdRef.current !== requestVersion) {
        return;
      }

      const semanticResult: CodePaneSemanticTokensResult | null = response.success
        ? (response.data ?? null)
        : null;
      if (response.success) {
        runtimeStoreRef.current.setCache(requestKey, semanticResult);
      }
      if (!semanticResult) {
        const nextError = response.success ? null : (response.error || t('common.retry'));
        setSemanticLegend((currentLegend) => (currentLegend === null ? currentLegend : null));
        setSemanticSummary((currentSummary) => (currentSummary.length === 0 ? currentSummary : []));
        setSemanticTokenCount((currentCount) => (currentCount === 0 ? currentCount : 0));
        setSemanticSummaryError((currentError) => (
          currentError === nextError ? currentError : nextError
        ));
        return;
      }

      const nextSummary = summarizeSemanticTokens(semanticResult);
      setSemanticLegend((currentLegend) => (
        areSemanticLegendsEqual(currentLegend, semanticResult.legend) ? currentLegend : semanticResult.legend
      ));
      setSemanticSummary((currentSummary) => (
        areSemanticSummaryEntriesEqual(currentSummary, nextSummary.summary) ? currentSummary : nextSummary.summary
      ));
      setSemanticTokenCount((currentCount) => (
        currentCount === nextSummary.totalTokens ? currentCount : nextSummary.totalTokens
      ));
      setSemanticSummaryError((currentError) => (currentError === null ? currentError : null));
    } catch (error) {
      if (semanticRequestIdRef.current !== requestVersion) {
        return;
      }

      const nextError = error instanceof Error ? error.message : t('common.retry');
      setSemanticLegend((currentLegend) => (currentLegend === null ? currentLegend : null));
      setSemanticSummary((currentSummary) => (currentSummary.length === 0 ? currentSummary : []));
      setSemanticTokenCount((currentCount) => (currentCount === 0 ? currentCount : 0));
      setSemanticSummaryError((currentError) => (
        currentError === nextError ? currentError : nextError
      ));
    } finally {
      if (semanticRequestIdRef.current === requestVersion) {
        setIsSemanticSummaryLoading((currentLoading) => (currentLoading === false ? currentLoading : false));
      }
    }
  }, [getActiveEditorContext, getModelRequestPath, rootPath, t, trackRequest]);

  const applyLanguageTextEdits = useCallback(async (
    edits: CodePaneTextEdit[],
    options?: {
      saveAfterApply?: boolean;
    },
  ) => {
    const applyResult = await applyLanguageTextEditsWithoutSaving(edits, {
      skipGitRefresh: options?.saveAfterApply !== false,
    });
    if (!applyResult.didApply) {
      return false;
    }

    if (options?.saveAfterApply === false || edits.length === 0) {
      return true;
    }

    const editedFilePathSet = new Set<string>();
    for (const edit of edits) {
      editedFilePathSet.add(edit.filePath);
    }

    const editedFilePaths = [...editedFilePathSet];
    let didSaveAnyFile = false;
    let didFailToSave = false;
    await runWithConcurrency(
      editedFilePaths,
      CODE_PANE_MULTI_FILE_SAVE_CONCURRENCY,
      async (editedFilePath) => {
        if (didFailToSave || !fileModelsRef.current.has(editedFilePath)) {
          return;
        }

        const didSave = await saveFile(editedFilePath, {
          skipQualityPipeline: true,
          skipGitRefresh: true,
          waitForLanguageSync: true,
        });
        if (!didSave) {
          didFailToSave = true;
          return;
        }
        didSaveAnyFile = true;
      },
    );
    if (didFailToSave) {
      return false;
    }

    if (didSaveAnyFile) {
      scheduleGitStatusRefresh({
        force: applyResult.wroteToDisk,
      });
    }

    return true;
  }, [applyLanguageTextEditsWithoutSaving, saveFile, scheduleGitStatusRefresh]);

  const prepareRefactorPreview = useCallback(async (config: Parameters<typeof window.electronAPI.codePanePrepareRefactor>[0]) => {
    setRefactorPreviewError((currentError) => (currentError === null ? currentError : null));

    const response = await window.electronAPI.codePanePrepareRefactor(config);
    if (!response.success || !response.data) {
      setBanner({
        tone: 'error',
        message: response.error || t('common.retry'),
        filePath: 'filePath' in config ? config.filePath : undefined,
      });
      return null;
    }

    const nextPreview = response.data;
    setRefactorPreview((currentPreview) => (
      arePreviewChangeSetsEqual(currentPreview, nextPreview) ? currentPreview : nextPreview
    ));
    setSelectedPreviewChangeId((currentChangeId) => {
      const nextChangeId = nextPreview.files[0]?.id ?? null;
      return currentChangeId === nextChangeId ? currentChangeId : nextChangeId;
    });
    setBottomPanelMode((currentMode) => (currentMode === 'preview' ? currentMode : 'preview'));
    return response.data;
  }, [t]);

  const openActionInputDialog = useCallback((state: ActionInputDialogState, options?: { deferred?: boolean }) => {
    const open = () => {
      setActionInputDialog(state);
    };
    if (options?.deferred) {
      window.setTimeout(open, 0);
      return;
    }
    open();
  }, []);

  const openActionConfirmDialog = useCallback((state: ActionConfirmDialogState, options?: { deferred?: boolean }) => {
    const open = () => {
      setActionConfirmDialog(state);
    };
    if (options?.deferred) {
      window.setTimeout(open, 0);
      return;
    }
    open();
  }, []);

  const findUsagesAtCursor = useCallback(async () => {
    const context = getActiveEditorContext();
    if (!context) {
      return;
    }

    const targetWord = context.model.getWordAtPosition(context.position)?.word ?? getPathLeafLabel(context.filePath);
    setSearchPanelMode('usages');
    setUsageResults((currentResults) => (currentResults.length === 0 ? currentResults : []));
    setUsagesTargetLabel((currentLabel) => (currentLabel === targetWord ? currentLabel : targetWord));
    setUsageError((currentError) => (currentError === null ? currentError : null));
    setIsFindingUsages((currentFinding) => (currentFinding ? currentFinding : true));
    showSidebarMode('search');

    const response = await window.electronAPI.codePaneGetReferences({
      rootPath,
      filePath: context.filePath,
      language: context.language,
      position: {
        lineNumber: context.position.lineNumber,
        column: context.position.column,
      },
    });

    startTransition(() => {
      const nextResults = response.success ? (response.data ?? []) : [];
      setUsageResults((currentResults) => (
        areReferenceListsEqual(currentResults, nextResults) ? currentResults : nextResults
      ));
    });
    const nextError = response.success ? null : (response.error || t('common.retry'));
    setUsageError((currentError) => (
      currentError === nextError ? currentError : nextError
    ));
    setIsFindingUsages((currentFinding) => (currentFinding === false ? currentFinding : false));
  }, [getActiveEditorContext, rootPath, showSidebarMode, t]);

  const renameSymbolAtCursor = useCallback(async () => {
    const context = getActiveEditorContext();
    if (!context || context.readOnly) {
      return;
    }

    const currentWord = context.model.getWordAtPosition(context.position)?.word ?? '';
    openActionInputDialog({
      kind: 'rename-symbol',
      initialValue: currentWord,
      filePath: context.filePath,
      language: context.language,
      position: {
        lineNumber: context.position.lineNumber,
        column: context.position.column,
      },
    });
  }, [getActiveEditorContext, openActionInputDialog]);

  const formatActiveDocument = useCallback(async () => {
    const context = getActiveEditorContext();
    if (!context || context.readOnly) {
      return;
    }

    const response = await window.electronAPI.codePaneFormatDocument({
      rootPath,
      filePath: context.filePath,
      language: context.language,
      content: context.model.getValue(),
      tabSize: 2,
      insertSpaces: true,
    });

    if (!response.success) {
      setBanner({
        tone: 'error',
        message: response.error || t('common.retry'),
        filePath: context.filePath,
      });
      return;
    }

    await applyLanguageTextEdits(response.data ?? []);
  }, [applyLanguageTextEdits, getActiveEditorContext, rootPath, t]);

  useEffect(() => {
    saveFileRef.current = saveFile;
  }, [saveFile]);

  useEffect(() => {
    findUsagesAtCursorRef.current = findUsagesAtCursor;
  }, [findUsagesAtCursor]);

  useEffect(() => {
    renameSymbolAtCursorRef.current = renameSymbolAtCursor;
  }, [renameSymbolAtCursor]);

  useEffect(() => {
    formatActiveDocumentRef.current = formatActiveDocument;
  }, [formatActiveDocument]);

  const activateFile = useCallback(async (
    filePath: string,
    options?: {
      recordRecent?: boolean;
      preview?: boolean;
      promotePreview?: boolean;
    },
  ) => {
    const loadedModel = fileModelsRef.current.get(filePath) ?? await loadFileIntoModel(filePath);
    if (!loadedModel) {
      persistCodeState({
        selectedPath: filePath,
      });
      return;
    }

    const currentOpenFiles = paneRef.current.code?.openFiles ?? openFiles;
    const currentActiveFilePath = paneRef.current.code?.activeFilePath ?? activeFilePathRef.current;
    const currentViewMode = paneRef.current.code?.viewMode ?? viewMode;
    const currentDiffTargetPath = paneRef.current.code?.diffTargetPath ?? diffTargetPath;
    const nextTabs = upsertOpenFileTab(currentOpenFiles, filePath, {
      preview: options?.preview,
      promote: options?.promotePreview,
    });
    const shouldRefreshCurrentEditorSurface = currentActiveFilePath === filePath
      && currentViewMode === 'editor'
      && (currentDiffTargetPath ?? null) === null;

    setPendingGitRevisionDiff((currentRequest) => (
      currentRequest === null ? currentRequest : null
    ));
    persistCodeState({
      openFiles: nextTabs,
      activeFilePath: filePath,
      selectedPath: filePath,
      viewMode: 'editor',
      diffTargetPath: null,
    });

    if (options?.recordRecent !== false) {
      const nextRecentFiles = [
        filePath,
        ...recentFilesRef.current.filter((currentFilePath) => currentFilePath !== filePath),
      ].slice(0, CODE_PANE_MAX_RECENT_FILES);
      recentFilesRef.current = nextRecentFiles;
      navigationStoreRef.current.setSnapshot({
        recentFiles: nextRecentFiles,
      });
    }
    if (shouldRefreshCurrentEditorSurface) {
      await refreshEditorSurface();
    }
  }, [diffTargetPath, loadFileIntoModel, openFiles, persistCodeState, refreshEditorSurface, viewMode]);

  const ensureDiffModel = useCallback(async (
    filePath: string,
    options?: {
      baseFilePath?: string;
      showBanner?: boolean;
    },
  ) => {
    if (!monacoRef.current && supportsMonaco) {
      const monaco = await ensureMonacoReady();
      if (!monaco) {
        if (options?.showBanner !== false) {
          setBanner({
            tone: 'info',
            message: t('codePane.gitUnavailable'),
            filePath,
          });
        }
        return false;
      }
    }

    const baseFilePath = options?.baseFilePath ?? filePath;
    if (!monacoRef.current) {
      if (options?.showBanner !== false) {
        setBanner({
          tone: 'info',
          message: t('codePane.gitUnavailable'),
          filePath,
        });
      }
      return false;
    }

    const response = await window.electronAPI.codePaneReadGitBaseFile({
      rootPath,
      filePath: baseFilePath,
    });

    if (!response.success) {
      if (options?.showBanner !== false) {
        setBanner({
          tone: 'info',
          message: response.error || t('codePane.gitUnavailable'),
          filePath,
        });
      }
      return false;
    }

    const statusEntry = gitStatusByPath[baseFilePath] ?? gitStatusByPath[filePath];
    if (!response.data?.existsInHead && !statusEntry) {
      if (options?.showBanner !== false) {
        setBanner({
          tone: 'info',
          message: t('codePane.gitUnavailable'),
          filePath,
        });
      }
      return false;
    }

    const meta = fileMetaRef.current.get(filePath) ?? fileMetaRef.current.get(baseFilePath);
    const language = meta?.language ?? fileModelsRef.current.get(filePath)?.getLanguageId() ?? 'plaintext';
    let diffModel = diffModelsRef.current.get(filePath);
    if (!diffModel) {
      diffModel = monacoRef.current.editor.createModel(
        response.data?.content ?? '',
        language,
        monacoRef.current.Uri.parse(`code-pane-head://${encodeURIComponent(filePath)}`),
      );
      diffModelsRef.current.set(filePath, diffModel);
    } else {
      if (diffModel.getLanguageId() !== language) {
        monacoRef.current.editor.setModelLanguage(diffModel, language);
      }
      if (diffModel.getValue() !== (response.data?.content ?? '')) {
        diffModel.setValue(response.data?.content ?? '');
      }
    }

    clearBannerForFile(filePath);
    return true;
  }, [clearBannerForFile, ensureMonacoReady, gitStatusByPath, rootPath, supportsMonaco, t]);

  const ensureRevisionDiffModel = useCallback(async (
    request: GitRevisionDiffRequest,
    options?: {
      showBanner?: boolean;
    },
  ) => {
    if (!monacoRef.current && supportsMonaco) {
      const monaco = await ensureMonacoReady();
      if (!monaco) {
        if (options?.showBanner !== false) {
          setBanner({
            tone: 'info',
            message: t('codePane.gitUnavailable'),
            filePath: request.filePath,
          });
        }
        return false;
      }
    }

    if (!monacoRef.current) {
      if (options?.showBanner !== false) {
        setBanner({
          tone: 'info',
          message: t('codePane.gitUnavailable'),
          filePath: request.filePath,
        });
      }
      return false;
    }

    const leftCommitSha = request.leftCommitSha?.trim();
    const rightCommitSha = request.rightCommitSha?.trim();
    if (!leftCommitSha && !rightCommitSha) {
      return ensureDiffModel(request.filePath, {
        showBanner: options?.showBanner,
      });
    }

    const activeFile = request.filePath;
    const workspaceModel = fileModelsRef.current.get(activeFile)
      ?? (!rightCommitSha ? await loadFileIntoModel(activeFile) : null);
    if (!rightCommitSha && !workspaceModel) {
      if (options?.showBanner !== false) {
        setBanner({
          tone: 'info',
          message: t('codePane.gitUnavailable'),
          filePath: activeFile,
        });
      }
      return false;
    }
    const language = fileMetaRef.current.get(activeFile)?.language
      ?? workspaceModel?.getLanguageId()
      ?? 'plaintext';

    const [leftRevisionResponse, rightRevisionResponse] = await Promise.all([
      leftCommitSha
        ? window.electronAPI.codePaneReadGitRevisionFile({
          rootPath,
          filePath: activeFile,
          commitSha: leftCommitSha,
        })
        : Promise.resolve({
          success: true,
          data: {
            content: '',
            exists: false,
          },
        }),
      rightCommitSha
        ? window.electronAPI.codePaneReadGitRevisionFile({
          rootPath,
          filePath: activeFile,
          commitSha: rightCommitSha,
        })
        : Promise.resolve(null),
    ]);

    if (!leftRevisionResponse.success || (rightRevisionResponse && !rightRevisionResponse.success)) {
      const leftError = 'error' in leftRevisionResponse ? leftRevisionResponse.error : undefined;
      const rightError = rightRevisionResponse && 'error' in rightRevisionResponse ? rightRevisionResponse.error : undefined;
      if (options?.showBanner !== false) {
        setBanner({
          tone: 'info',
          message: leftError || rightError || t('codePane.gitUnavailable'),
          filePath: activeFile,
        });
      }
      return false;
    }

    const leftContent = leftRevisionResponse.data?.content ?? '';
    const rightContent = rightCommitSha
      ? rightRevisionResponse?.data?.content ?? ''
      : workspaceModel?.getValue() ?? '';
    const modelKey = activeFile;
    const monaco = monacoRef.current;
    if (!monaco) {
      return false;
    }

    let diffModel = diffModelsRef.current.get(modelKey);
    let modifiedRevisionModel = revisionModifiedModelsRef.current.get(modelKey);
    const leftLabel = request.leftLabel ?? leftCommitSha?.slice(0, 7) ?? 'left';
    const rightLabel = request.rightLabel ?? rightCommitSha?.slice(0, 7) ?? 'right';
    const originalUri = monaco.Uri.parse(
      `code-pane-git://${encodeURIComponent(activeFile)}?left=${encodeURIComponent(leftLabel)}&right=${encodeURIComponent(rightLabel)}`,
    );
    const modifiedUri = monaco.Uri.parse(
      `code-pane-git-modified://${encodeURIComponent(activeFile)}?left=${encodeURIComponent(leftLabel)}&right=${encodeURIComponent(rightLabel)}`,
    );

    if (!diffModel) {
      diffModel = monaco.editor.createModel(leftContent, language, originalUri);
      diffModelsRef.current.set(modelKey, diffModel);
    } else {
      if (diffModel.getLanguageId() !== language) {
        monaco.editor.setModelLanguage(diffModel, language);
      }
      if (diffModel.uri.toString() !== originalUri.toString()) {
        if ((paneRef.current.code?.viewMode ?? viewMode) === 'diff' && activeFilePathRef.current === modelKey) {
          detachDiffEditorModel();
        }
        diffModel.dispose();
        diffModel = monaco.editor.createModel(leftContent, language, originalUri);
        diffModelsRef.current.set(modelKey, diffModel);
      } else if (diffModel.getValue() !== leftContent) {
        diffModel.setValue(leftContent);
      }
    }

    if (!modifiedRevisionModel) {
      modifiedRevisionModel = monaco.editor.createModel(rightContent, language, modifiedUri);
      revisionModifiedModelsRef.current.set(modelKey, modifiedRevisionModel);
    } else {
      if (modifiedRevisionModel.getLanguageId() !== language) {
        monaco.editor.setModelLanguage(modifiedRevisionModel, language);
      }
      if (modifiedRevisionModel.uri.toString() !== modifiedUri.toString()) {
        if ((paneRef.current.code?.viewMode ?? viewMode) === 'diff' && activeFilePathRef.current === modelKey) {
          detachDiffEditorModel();
        }
        modifiedRevisionModel.dispose();
        modifiedRevisionModel = monaco.editor.createModel(rightContent, language, modifiedUri);
        revisionModifiedModelsRef.current.set(modelKey, modifiedRevisionModel);
      } else if (modifiedRevisionModel.getValue() !== rightContent) {
        modifiedRevisionModel.setValue(rightContent);
      }
    }

    clearBannerForFile(activeFile);
    return true;
  }, [clearBannerForFile, detachDiffEditorModel, ensureDiffModel, ensureMonacoReady, loadFileIntoModel, rootPath, supportsMonaco, t, viewMode]);

  const openDiffForFile = useCallback(async (filePath: string, options?: { preserveTabs?: boolean }) => {
    if (!isPathInside(rootPath, filePath)) {
      setBanner({
        tone: 'info',
        message: t('codePane.gitUnavailable'),
        filePath,
      });
      return;
    }

    const loadedModel = fileModelsRef.current.get(filePath) ?? await loadFileIntoModel(filePath);
    if (!loadedModel) {
      persistCodeState({
        selectedPath: filePath,
      });
      return;
    }

    const didEnsureDiffModel = await ensureDiffModel(filePath);
    if (!didEnsureDiffModel) {
      setPendingGitRevisionDiff((currentRequest) => (
        currentRequest === null ? currentRequest : null
      ));
      return;
    }

    const currentOpenFiles = paneRef.current.code?.openFiles ?? openFiles;
    const nextTabs = upsertOpenFileTab(currentOpenFiles, filePath, {
      promote: !options?.preserveTabs,
    });

    setBanner((currentBanner) => (currentBanner === null ? currentBanner : null));
    persistCodeState({
      openFiles: nextTabs,
      activeFilePath: filePath,
      selectedPath: filePath,
      viewMode: 'diff',
      diffTargetPath: filePath,
    });
  }, [ensureDiffModel, loadFileIntoModel, openFiles, persistCodeState, rootPath, t]);

  const openGitRevisionDiff = useCallback(async (request: GitRevisionDiffRequest) => {
    if (!areGitRevisionDiffRequestsEqual(pendingGitRevisionDiffRef.current, request)) {
      pendingGitRevisionDiffRef.current = request;
      setPendingGitRevisionDiff(request);
    } else {
      pendingGitRevisionDiffRef.current = request;
    }
    const didEnsureRevisionDiffModel = await ensureRevisionDiffModel(request);
    if (!didEnsureRevisionDiffModel) {
      pendingGitRevisionDiffRef.current = null;
      setPendingGitRevisionDiff((currentRequest) => (
        currentRequest === null ? currentRequest : null
      ));
      return;
    }

    const currentOpenFiles = paneRef.current.code?.openFiles ?? openFiles;
    const nextTabs = upsertOpenFileTab(currentOpenFiles, request.filePath, {
      promote: true,
    });

    persistCodeState({
      openFiles: nextTabs,
      activeFilePath: request.filePath,
      selectedPath: request.filePath,
      viewMode: 'diff',
      diffTargetPath: request.filePath,
    });
    setBanner((currentBanner) => (currentBanner === null ? currentBanner : null));
  }, [ensureRevisionDiffModel, openFiles, persistCodeState]);

  const openExternalChangeDiff = useCallback(async (filePath: string) => {
    const entry = externalChangeStateRef.current.entriesByPath.get(filePath) ?? null;
    if (!entry) {
      return;
    }

    applyExternalChangeState(externalChangeStateRef.current.entries, filePath);
    if (entry.changeType !== 'deleted') {
      await activateFile(filePath, {
        preview: true,
        promotePreview: true,
      });
    }
  }, [activateFile, applyExternalChangeState]);

  const updateExternalChangeEntry = useCallback((entry: ExternalChangeEntry) => {
    const nextEntries: ExternalChangeEntry[] = [entry];
    for (const candidate of externalChangeEntriesRef.current) {
      if (candidate.filePath !== entry.filePath) {
        nextEntries.push(candidate);
        if (nextEntries.length >= CODE_PANE_MAX_EXTERNAL_CHANGE_ENTRIES) {
          break;
        }
      }
    }
    applyExternalChangeState(nextEntries, entry.filePath);
  }, [applyExternalChangeState]);

  const updateExternalChangeEntries = useCallback((entries: ExternalChangeEntry[]) => {
    if (entries.length === 0) {
      return;
    }

    const nextEntriesByPath = new Map<string, ExternalChangeEntry>();
    for (const entry of entries) {
      nextEntriesByPath.set(entry.filePath, entry);
    }
    for (const entry of externalChangeEntriesRef.current) {
      if (!nextEntriesByPath.has(entry.filePath)) {
        nextEntriesByPath.set(entry.filePath, entry);
      }
    }

    const nextEntries: ExternalChangeEntry[] = [];
    for (const entry of nextEntriesByPath.values()) {
      nextEntries.push(entry);
    }
    nextEntries.sort((leftEntry, rightEntry) => rightEntry.changedAt - leftEntry.changedAt);
    if (nextEntries.length > CODE_PANE_MAX_EXTERNAL_CHANGE_ENTRIES) {
      nextEntries.length = CODE_PANE_MAX_EXTERNAL_CHANGE_ENTRIES;
    }
    const preferredSelectedPath = entries[entries.length - 1]?.filePath ?? nextEntries[0]?.filePath ?? null;

    const currentEntries = externalChangeEntriesRef.current;
    const didEntriesChange = currentEntries.length !== nextEntries.length
      || currentEntries.some((entry, index) => entry !== nextEntries[index]);
    const currentSelectedPath = selectedExternalChangePathRef.current;
    let nextSelectedPath = preferredSelectedPath;
    if (currentSelectedPath) {
      for (const entry of nextEntries) {
        if (entry.filePath === currentSelectedPath) {
          nextSelectedPath = currentSelectedPath;
          break;
        }
      }
    }
    if (!didEntriesChange && nextSelectedPath === currentSelectedPath) {
      return;
    }
    applyExternalChangeState(nextEntries, nextSelectedPath);
  }, [applyExternalChangeState]);

  const revealExternalChangeEntry = useCallback((entry: ExternalChangeEntry) => {
    updateExternalChangeEntries([entry]);
  }, [updateExternalChangeEntries]);

  const clearExternalChangeEntry = useCallback((filePath: string) => {
    const nextEntries = externalChangeEntriesRef.current.filter((entry) => entry.filePath !== filePath);
    const currentSelectedPath = selectedExternalChangePathRef.current;
    applyExternalChangeState(
      nextEntries,
      currentSelectedPath === filePath
        ? nextEntries[0]?.filePath ?? null
        : currentSelectedPath,
    );
  }, [applyExternalChangeState]);

  const clearAllExternalChanges = useCallback(() => {
    applyExternalChangeState([], null);
  }, [applyExternalChangeState]);

  const readExternalChangeBaseContent = useCallback(async (
    filePath: string,
    fallbackLanguage: string,
  ): Promise<{ content: string | null; language: string; source: 'model' | 'local-history' | 'git-base' | 'none' }> => {
    const existingModel = fileModelsRef.current.get(filePath);
    if (existingModel) {
      return {
        content: existingModel.getValue(),
        language: existingModel.getLanguageId(),
        source: 'model',
      };
    }

    const localHistoryEntry = localHistoryEntriesRef.current.get(filePath)?.[0] ?? null;
    if (localHistoryEntry) {
      return {
        content: localHistoryEntry.content,
        language: fallbackLanguage,
        source: 'local-history',
      };
    }

    try {
      const gitBaseResponse = await window.electronAPI.codePaneReadGitBaseFile({
        rootPath,
        filePath,
      });
      if (gitBaseResponse.success && gitBaseResponse.data?.existsInHead) {
        return {
          content: gitBaseResponse.data.content,
          language: fallbackLanguage,
          source: 'git-base',
        };
      }
    } catch {
      // Best-effort fallback: external change tracking should still record the file.
    }

    return {
      content: null,
      language: fallbackLanguage,
      source: 'none',
    };
  }, [rootPath]);

  const recordExternalChange = useCallback(async (
    change: CodePaneFsChange,
    options?: {
      commit?: boolean;
    },
  ): Promise<ExternalChangeEntry | null> => {
    const shouldCommit = options?.commit ?? true;
    if (change.type !== 'add' && change.type !== 'change' && change.type !== 'unlink') {
      return null;
    }

    const trackedPaths = new Set<string>([
      ...fileModelsRef.current.keys(),
      ...fileMetaRef.current.keys(),
      ...externalChangeStateRef.current.entriesByPath.keys(),
      activeFilePathRef.current ?? '',
      secondaryFilePathRef.current ?? '',
    ].filter((value) => Boolean(value)));
    const filePath = resolveTrackedPath(change.path, trackedPaths);
    if (!isPathInside(rootPath, filePath) || isVirtualDocumentPath(filePath)) {
      return null;
    }

    let matchedSuppressedPath: string | null = null;
    let suppressedUntil = 0;
    for (const [suppressedPath, expiresAt] of suppressedExternalChangePathsRef.current.entries()) {
      if (isPathEqualOrDescendant(filePath, suppressedPath)) {
        matchedSuppressedPath = suppressedPath;
        suppressedUntil = expiresAt;
        break;
      }
    }
    if (suppressedUntil > 0) {
      if (Date.now() <= suppressedUntil) {
        return null;
      }
      if (matchedSuppressedPath) {
        suppressedExternalChangePathsRef.current.delete(matchedSuppressedPath);
      }
    }

    const existingModel = fileModelsRef.current.get(filePath);
    const openedAtChange = Boolean(existingModel);
    const changedAt = Date.now();
    const fallbackLanguage = fileMetaRef.current.get(filePath)?.language
      ?? existingModel?.getLanguageId()
      ?? detectLanguageFromPath(filePath);
    const existingExternalEntry = externalChangeStateRef.current.entriesByPath.get(filePath) ?? null;
    const previousSnapshot = await readExternalChangeBaseContent(filePath, fallbackLanguage);
    const previousContent = existingExternalEntry?.previousContent ?? previousSnapshot.content;
    const previousLanguage = previousSnapshot.language;

    if (change.type === 'unlink') {
      const currentContent = previousContent === null ? null : '';
      const nextEntry: ExternalChangeEntry = {
        id: `${filePath}:${changedAt}`,
        filePath,
        relativePath: getRelativePath(rootPath, filePath),
        previousContent,
        currentContent,
        language: previousLanguage,
        changeType: 'deleted',
        changedAt,
        openedAtChange,
        canDiff: previousContent !== null,
      };
      if (shouldCommit) {
        revealExternalChangeEntry(nextEntry);
      }
      return nextEntry;
    }

    let response = await window.electronAPI.codePaneReadFile({
      rootPath,
      filePath,
    });
    if (!response.success || !response.data) {
      return null;
    }

    let currentReadResult = response.data;
    if (
      change.type === 'change'
      && previousContent !== null
      && currentReadResult.content === previousContent
      && (previousSnapshot.source === 'model' || previousSnapshot.source === 'local-history')
    ) {
      for (let attempt = 0; attempt < CODE_PANE_EXTERNAL_CHANGE_READ_RETRY_COUNT; attempt += 1) {
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, CODE_PANE_EXTERNAL_CHANGE_READ_RETRY_DELAY_MS);
        });
        response = await window.electronAPI.codePaneReadFile({
          rootPath,
          filePath,
        });
        if (!response.success || !response.data) {
          break;
        }
        currentReadResult = response.data;
        if (currentReadResult.content !== previousContent) {
          break;
        }
      }
    }

    const currentContent = currentReadResult.content;
    const changeType: ExternalChangeKind = change.type === 'add' ? 'added' : 'modified';
    const diffPreviousContent = changeType === 'added' ? (previousContent ?? '') : previousContent;
    const canDiff = changeType === 'added' || previousContent !== null;
    const existingMeta = fileMetaRef.current.get(filePath) ?? null;
    const hasUnsavedEditorContent = Boolean(existingModel && (
      dirtyPathsRef.current.has(filePath)
      || (
        existingMeta?.lastSavedVersionId !== undefined
        && getModelVersionId(existingModel) !== existingMeta.lastSavedVersionId
      )
    ));

    if (
      !hasUnsavedEditorContent
      && previousContent !== null
      && currentContent === previousContent
      && (previousSnapshot.source === 'model' || previousSnapshot.source === 'local-history')
    ) {
      if (existingModel) {
        createOrUpdateModel(filePath, currentReadResult);
      }
      return null;
    }

    const nextEntry: ExternalChangeEntry = {
      id: `${filePath}:${changedAt}`,
      filePath,
      relativePath: getRelativePath(rootPath, filePath),
      previousContent: diffPreviousContent,
      currentContent,
      language: currentReadResult.language,
      changeType: existingExternalEntry?.changeType === 'added' && changeType === 'modified'
        ? existingExternalEntry.changeType
        : changeType,
      changedAt,
      openedAtChange,
      canDiff,
    };

    if (hasUnsavedEditorContent) {
      const revealedEntry = {
        ...nextEntry,
        previousContent,
        canDiff,
      };
      if (shouldCommit) {
        revealExternalChangeEntry(revealedEntry);
      }
      setBanner({
        tone: 'warning',
        message: t('codePane.externalChange'),
        filePath,
        showReload: true,
        showOverwrite: true,
      });
      return revealedEntry;
    }

    if (shouldCommit) {
      revealExternalChangeEntry(nextEntry);
    }

    if (existingModel) {
      createOrUpdateModel(filePath, currentReadResult);
    }
    return nextEntry;
  }, [createOrUpdateModel, readExternalChangeBaseContent, revealExternalChangeEntry, rootPath, t]);

  const closeFileTab = useCallback(async (filePath: string) => {
    const didFlush = await flushDirtyFiles([filePath]);
    if (!didFlush) {
      return;
    }

    const existingTimer = autoSaveTimersRef.current.get(filePath);
    if (existingTimer) {
      clearTimeout(existingTimer);
      autoSaveTimersRef.current.delete(filePath);
    }
    const localHistoryTimer = localHistoryTimersRef.current.get(filePath);
    if (localHistoryTimer) {
      clearTimeout(localHistoryTimer);
      localHistoryTimersRef.current.delete(filePath);
    }

    await closeLanguageDocument(filePath);
    modelDisposersRef.current.get(filePath)?.dispose();
    modelDisposersRef.current.delete(filePath);
    const existingModel = fileModelsRef.current.get(filePath);
    if (existingModel) {
      if ((paneRef.current.code?.viewMode ?? viewMode) === 'diff' && activeFilePathRef.current === filePath) {
        detachDiffEditorModel();
      }
      modelFilePathRef.current.delete(existingModel.uri.path);
      existingModel.dispose();
    }
    fileModelsRef.current.delete(filePath);
    releaseDiffModelsForFile(filePath);
    fileMetaRef.current.delete(filePath);
    problemsByFileRef.current.delete(filePath);
    preloadedReadResultsRef.current.delete(filePath);
    invalidateWorkspaceRuntimeCaches(filePath);
    viewStatesRef.current.delete(filePath);
    markDirty(filePath, false);
    clearBannerForFile(filePath);
    refreshProblems([filePath]);

    const currentOpenFiles = sortOpenFilesByPinned(paneRef.current.code?.openFiles ?? openFiles);
    const currentActiveFilePath = paneRef.current.code?.activeFilePath ?? activeFilePath;
    const currentSelectedPath = paneRef.current.code?.selectedPath ?? selectedPath;
    const nextOpenFiles = currentOpenFiles.filter((tab) => tab.path !== filePath);
    const nextActiveFilePath = currentActiveFilePath === filePath
      ? nextOpenFiles[nextOpenFiles.length - 1]?.path ?? null
      : currentActiveFilePath;
    const nextSecondaryFilePath = secondaryFilePathRef.current === filePath
      ? null
      : secondaryFilePathRef.current;

    persistCodeState({
      openFiles: nextOpenFiles,
      activeFilePath: nextActiveFilePath,
      selectedPath: nextActiveFilePath ?? currentSelectedPath,
      viewMode: 'editor',
      diffTargetPath: null,
    });
    if (secondaryFilePathRef.current === filePath) {
      persistEditorSplitLayout({
        visible: false,
        secondaryFilePath: nextSecondaryFilePath,
      });
    }
  }, [
    activeFilePath,
    clearBannerForFile,
    clearDefinitionLookupCache,
    closeLanguageDocument,
    detachDiffEditorModel,
    flushDirtyFiles,
    invalidateWorkspaceRuntimeCaches,
    markDirty,
    openFiles,
    persistCodeState,
    persistEditorSplitLayout,
    releaseDiffModelsForFile,
    selectedPath,
  ]);

  const applyRefactorPreview = useCallback(async () => {
    if (!refactorPreview) {
      return;
    }

    setIsApplyingRefactorPreview((currentApplying) => (currentApplying ? currentApplying : true));
    setRefactorPreviewError((currentError) => (currentError === null ? currentError : null));
    const pathsToSuppress: string[] = [];
    for (const change of refactorPreview.files) {
      pathsToSuppress.push(change.filePath);
      if (change.targetFilePath) {
        pathsToSuppress.push(change.targetFilePath);
      }
    }
    const suppressedPaths = suppressExternalChangesForPaths(pathsToSuppress);

    const response = await window.electronAPI.codePaneApplyRefactor({
      previewId: refactorPreview.id,
    });
    if (!response.success || !response.data) {
      for (const filePath of suppressedPaths) {
        suppressedExternalChangePathsRef.current.delete(filePath);
      }
      setRefactorPreviewError((currentError) => {
        const nextError = response.error || t('common.retry');
        return currentError === nextError ? currentError : nextError;
      });
      setIsApplyingRefactorPreview((currentApplying) => (currentApplying ? false : currentApplying));
      return;
    }

    const modifyChanges = response.data.files.filter((change) => change.kind === 'modify');
    await runWithConcurrency(
      modifyChanges,
      CODE_PANE_REFACTOR_APPLY_CONCURRENCY,
      async (change) => {
        const existingModel = fileModelsRef.current.get(change.filePath);
        invalidateWorkspaceRuntimeCaches(change.filePath);
        if (!existingModel) {
          return;
        }

        await flushPendingLanguageSync(change.filePath);
        suppressModelEventsRef.current.add(change.filePath);
        existingModel.setValue(change.afterContent);
        suppressModelEventsRef.current.delete(change.filePath);
        invalidateDefinitionLookupCacheForFile(change.filePath);
        markDirty(change.filePath, false);
        await queueLanguageDocumentSync(change.filePath, 'change', async () => {
          await syncLanguageDocument(change.filePath, 'change');
        });
        void queueLanguageDocumentSync(change.filePath, 'save', async () => {
          await syncLanguageDocument(change.filePath, 'save');
        });
      },
    );

    for (const change of response.data.files) {
      if (change.kind === 'modify') {
        continue;
      }

      const currentOpenFiles = paneRef.current.code?.openFiles ?? openFiles;
      let isOpen = false;
      for (const tab of currentOpenFiles) {
        if (tab.path === change.filePath) {
          isOpen = true;
          break;
        }
      }
      const wasActive = activeFilePathRef.current === change.filePath;
      if (isOpen) {
        await closeFileTab(change.filePath);
      }

      if ((change.kind === 'rename' || change.kind === 'move') && wasActive && change.targetFilePath) {
        invalidateWorkspaceRuntimeCaches(change.targetFilePath);
        await activateFile(change.targetFilePath);
      }
    }

    scheduleGitStatusRefresh();
    setRefactorPreview((currentPreview) => (currentPreview === null ? currentPreview : null));
    setSelectedPreviewChangeId((currentChangeId) => (currentChangeId === null ? currentChangeId : null));
    setRefactorPreviewError((currentError) => (currentError === null ? currentError : null));
    setBottomPanelMode((currentMode) => (currentMode === 'preview' ? null : currentMode));
    setBanner({
      tone: 'info',
      message: t('codePane.refactorApplied'),
    });
    setIsApplyingRefactorPreview((currentApplying) => (currentApplying ? false : currentApplying));
  }, [
    activateFile,
    closeFileTab,
    flushPendingLanguageSync,
    invalidateDefinitionLookupCacheForFile,
    invalidateWorkspaceRuntimeCaches,
    markDirty,
    openFiles,
    queueLanguageDocumentSync,
    refactorPreview,
    scheduleGitStatusRefresh,
    suppressExternalChangesForPaths,
    syncLanguageDocument,
    t,
  ]);

  const renamePathWithPreview = useCallback(async (filePath: string) => {
    openActionInputDialog({
      kind: 'rename-path-preview',
      filePath,
      initialValue: getPathLeafLabel(filePath),
    });
  }, [openActionInputDialog]);

  const movePathWithPreview = useCallback(async (filePath: string) => {
    openActionInputDialog({
      kind: 'move-path-preview',
      filePath,
      initialValue: getRelativePath(rootPath, filePath),
    });
  }, [openActionInputDialog, rootPath]);

  const safeDeletePathWithPreview = useCallback(async (filePath: string) => {
    openActionConfirmDialog({
      kind: 'safe-delete-path',
      filePath,
    });
  }, [openActionConfirmDialog]);

  const toggleDirectory = useCallback(async (directoryPath: string) => {
    const currentExpandedDirectories = expandedDirectoriesRef.current;
    const isCurrentlyExpanded = currentExpandedDirectories.has(directoryPath);

    if (isCurrentlyExpanded) {
      const nextExpandedDirectories = new Set(currentExpandedDirectories);
      nextExpandedDirectories.delete(directoryPath);
      setExpandedDirectories((currentDirectories) => (
        areStringSetsEqual(currentDirectories, nextExpandedDirectories)
          ? currentDirectories
          : nextExpandedDirectories
      ));
      persistCodeState({
        selectedPath: directoryPath,
        expandedPaths: getPersistedExpandedPaths(nextExpandedDirectories),
      });
      return;
    }
    await expandDirectoryPath(directoryPath);
  }, [expandDirectoryPath]);

  const selectExplorerPath = useCallback((targetPath: string) => {
    persistCodeState({
      selectedPath: targetPath,
    });
  }, [persistCodeState]);

  const openDiffForActiveFile = useCallback(async () => {
    const filePath = activeFilePathRef.current;
    if (!filePath) {
      return;
    }
    setPendingGitRevisionDiff((currentRequest) => (
      currentRequest === null ? currentRequest : null
    ));
    await openDiffForFile(filePath, { preserveTabs: true });
  }, [openDiffForFile]);

  const refreshDirectoryPaths = useCallback(async (
    directoryPaths: Iterable<string>,
    options?: {
      showLoadingIndicator?: boolean;
      refreshGitStatus?: boolean;
      forceGitStatusRefresh?: boolean;
    },
  ) => {
    const uniqueDirectoryPathSet = new Set<string>();
    for (const directoryPath of directoryPaths) {
      uniqueDirectoryPathSet.add(directoryPath);
    }

    const uniqueDirectoryPaths = [...uniqueDirectoryPathSet];
    if (uniqueDirectoryPaths.length > 0) {
      const missingDirectoryPaths = new Set<string>();
      await runWithConcurrency(
        uniqueDirectoryPaths,
        CODE_PANE_DIRECTORY_REFRESH_CONCURRENCY,
        async (directoryPath) => {
          invalidateDirectoryCache(rootPath, directoryPath);
          try {
            await loadExplorerDirectory(directoryPath, {
              showLoadingIndicator: options?.showLoadingIndicator,
            });
          } catch (error) {
            const isMissingDirectoryError = error instanceof Error
              && /ENOENT|outside the code pane root|outside the allowed code pane roots|Target path is not a directory/i.test(error.message);
            if (!isMissingDirectoryError) {
              throw error;
            }
            missingDirectoryPaths.add(directoryPath);
          }
        },
      );

      if (missingDirectoryPaths.size > 0) {
        const nextMissingDirectoryPaths = missingDirectoryPaths;
        startTransition(() => {
          setLoadedDirectories((currentLoadedDirectories) => {
            let nextLoadedDirectories: Set<string> | null = null;
            for (const directoryPath of nextMissingDirectoryPaths) {
              if (currentLoadedDirectories.has(directoryPath)) {
                nextLoadedDirectories ??= new Set(currentLoadedDirectories);
                nextLoadedDirectories.delete(directoryPath);
              }
            }
            return nextLoadedDirectories ?? currentLoadedDirectories;
          });
          setLoadedExternalDirectories((currentLoadedDirectories) => {
            let nextLoadedDirectories: Set<string> | null = null;
            for (const directoryPath of nextMissingDirectoryPaths) {
              if (currentLoadedDirectories.has(directoryPath)) {
                nextLoadedDirectories ??= new Set(currentLoadedDirectories);
                nextLoadedDirectories.delete(directoryPath);
              }
            }
            return nextLoadedDirectories ?? currentLoadedDirectories;
          });
          setLoadingDirectories((currentLoadingDirectories) => {
            let nextLoadingDirectories: Set<string> | null = null;
            for (const directoryPath of nextMissingDirectoryPaths) {
              if (currentLoadingDirectories.has(directoryPath)) {
                nextLoadingDirectories ??= new Set(currentLoadingDirectories);
                nextLoadingDirectories.delete(directoryPath);
              }
            }
            return nextLoadingDirectories ?? currentLoadingDirectories;
          });
          setLoadingExternalDirectories((currentLoadingDirectories) => {
            let nextLoadingDirectories: Set<string> | null = null;
            for (const directoryPath of nextMissingDirectoryPaths) {
              if (currentLoadingDirectories.has(directoryPath)) {
                nextLoadingDirectories ??= new Set(currentLoadingDirectories);
                nextLoadingDirectories.delete(directoryPath);
              }
            }
            return nextLoadingDirectories ?? currentLoadingDirectories;
          });
          setExpandedDirectories((currentExpandedDirectories) => {
            let nextExpandedDirectories: Set<string> | null = null;
            for (const directoryPath of nextMissingDirectoryPaths) {
              if (currentExpandedDirectories.has(directoryPath)) {
                nextExpandedDirectories ??= new Set(currentExpandedDirectories);
                nextExpandedDirectories.delete(directoryPath);
              }
            }
            if (!nextExpandedDirectories) {
              return currentExpandedDirectories;
            }
            persistCodeState({
              expandedPaths: getPersistedExpandedPaths(nextExpandedDirectories),
            });
            return nextExpandedDirectories;
          });
          setTreeEntriesByDirectory((currentTreeEntries) => {
            if (Object.keys(currentTreeEntries).length === 0) {
              return currentTreeEntries;
            }
            const nextTreeEntries = { ...currentTreeEntries };
            for (const directoryPath of nextMissingDirectoryPaths) {
              compactDirectoryPresentationsCacheRef.current.delete(directoryPath);
              delete nextTreeEntries[directoryPath];
            }
            return nextTreeEntries;
          });
          setExternalEntriesByDirectory((currentTreeEntries) => {
            if (Object.keys(currentTreeEntries).length === 0) {
              return currentTreeEntries;
            }
            const nextTreeEntries = { ...currentTreeEntries };
            for (const directoryPath of nextMissingDirectoryPaths) {
              compactDirectoryPresentationsCacheRef.current.delete(directoryPath);
              delete nextTreeEntries[directoryPath];
            }
            return nextTreeEntries;
          });
        });
      }
    }

    if (options?.refreshGitStatus !== false) {
      scheduleGitStatusRefresh({
        force: options?.forceGitStatusRefresh === true,
        forceStatusOnly: options?.forceGitStatusRefresh !== true,
      });
    }
  }, [getPersistedExpandedPaths, loadExplorerDirectory, persistCodeState, rootPath, scheduleGitStatusRefresh]);

  const refreshLoadedDirectoriesNow = useCallback(async (options?: LoadedDirectoriesRefreshOptions) => {
    invalidateProjectCache(rootPath, 'directories');
    const directoriesToRefresh = new Set<string>([rootPath]);
    for (const directoryPath of loadedDirectoriesRef.current) {
      directoriesToRefresh.add(directoryPath);
    }
    if (options?.refreshExternalLibraries !== false) {
      for (const directoryPath of loadedExternalDirectoriesRef.current) {
        directoriesToRefresh.add(directoryPath);
      }
    }

    const refreshTasks: Array<Promise<unknown>> = [
      refreshDirectoryPaths(directoriesToRefresh, {
        refreshGitStatus: options?.refreshGitStatus,
        forceGitStatusRefresh: options?.refreshGitStatus !== false,
      }),
    ];

    if (options?.refreshExternalLibraries !== false) {
      invalidateProjectCache(rootPath, 'external-libraries');
      refreshTasks.push(loadExternalLibrarySections({ force: true }));
    }

    await Promise.all(refreshTasks);
  }, [loadExternalLibrarySections, refreshDirectoryPaths, rootPath]);

  const refreshLoadedDirectories = useCallback((options?: LoadedDirectoriesRefreshOptions) => {
    const refreshGitStatus = options?.refreshGitStatus !== false;
    const refreshExternalLibraries = options?.refreshExternalLibraries !== false;

    return new Promise<void>((resolve, reject) => {
      const inFlightRefresh = inFlightLoadedDirectoriesRefreshRef.current;
      if (inFlightRefresh) {
        inFlightRefresh.refreshGitStatus = inFlightRefresh.refreshGitStatus || refreshGitStatus;
        inFlightRefresh.refreshExternalLibraries = inFlightRefresh.refreshExternalLibraries || refreshExternalLibraries;
        inFlightRefresh.resolvers.push(resolve);
        inFlightRefresh.rejecters.push(reject);
        return;
      }

      const pendingRefresh = pendingLoadedDirectoriesRefreshRef.current;
      const hadPendingRefresh = Boolean(pendingRefresh);
      if (pendingRefresh) {
        pendingRefresh.refreshGitStatus = pendingRefresh.refreshGitStatus || refreshGitStatus;
        pendingRefresh.refreshExternalLibraries = pendingRefresh.refreshExternalLibraries || refreshExternalLibraries;
        pendingRefresh.resolvers.push(resolve);
        pendingRefresh.rejecters.push(reject);
      } else {
        pendingLoadedDirectoriesRefreshRef.current = {
          refreshGitStatus,
          refreshExternalLibraries,
          resolvers: [resolve],
          rejecters: [reject],
        };
      }

      if (loadedDirectoriesRefreshTimerRef.current) {
        window.clearTimeout(loadedDirectoriesRefreshTimerRef.current);
      }

      const queuedRefresh = pendingLoadedDirectoriesRefreshRef.current;
      loadedDirectoriesRefreshTimerRef.current = window.setTimeout(() => {
        loadedDirectoriesRefreshTimerRef.current = null;
        const refresh = pendingLoadedDirectoriesRefreshRef.current;
        pendingLoadedDirectoriesRefreshRef.current = null;
        if (!refresh) {
          return;
        }

        const refreshPromise = refreshLoadedDirectoriesNow({
          refreshGitStatus: refresh.refreshGitStatus,
          refreshExternalLibraries: refresh.refreshExternalLibraries,
        });
        inFlightLoadedDirectoriesRefreshRef.current = {
          ...refresh,
          promise: refreshPromise,
        };
        void refreshPromise.then(() => {
          const completedRefresh = inFlightLoadedDirectoriesRefreshRef.current ?? refresh;
          inFlightLoadedDirectoriesRefreshRef.current = null;
          completedRefresh.resolvers.forEach((currentResolve) => currentResolve());
          const trailingRefresh = pendingLoadedDirectoriesRefreshRef.current;
          pendingLoadedDirectoriesRefreshRef.current = null;
          if (!trailingRefresh) {
            return;
          }
          void refreshLoadedDirectories({
            refreshGitStatus: trailingRefresh.refreshGitStatus,
            refreshExternalLibraries: trailingRefresh.refreshExternalLibraries,
          }).then(() => {
            trailingRefresh.resolvers.forEach((currentResolve) => currentResolve());
          }).catch((error) => {
            trailingRefresh.rejecters.forEach((currentReject) => currentReject(error));
          });
        }).catch((error) => {
          const completedRefresh = inFlightLoadedDirectoriesRefreshRef.current ?? refresh;
          inFlightLoadedDirectoriesRefreshRef.current = null;
          completedRefresh.rejecters.forEach((currentReject) => currentReject(error));
          const trailingRefresh = pendingLoadedDirectoriesRefreshRef.current;
          pendingLoadedDirectoriesRefreshRef.current = null;
          trailingRefresh?.rejecters.forEach((currentReject) => currentReject(error));
        });
      }, queuedRefresh?.refreshGitStatus || queuedRefresh?.refreshExternalLibraries || !hadPendingRefresh ? 0 : 150);
    });
  }, [refreshLoadedDirectoriesNow]);

  const refreshDirectoriesForPaths = useCallback(async (
    paths: string[],
    options?: {
      refreshGitStatus?: boolean;
    },
  ) => {
    const directoriesToRefresh = new Set<string>();
    for (const filePath of paths) {
      const normalizedPath = normalizePath(filePath);
      const candidateDirectoryPath = loadedDirectoriesRef.current.has(normalizedPath)
        ? normalizedPath
        : getParentDirectory(normalizedPath);
      if (
        candidateDirectoryPath
        && (
          candidateDirectoryPath === rootPath
          || loadedDirectoriesRef.current.has(candidateDirectoryPath)
        )
      ) {
        directoriesToRefresh.add(candidateDirectoryPath);
      }
    }

    if (directoriesToRefresh.size === 0) {
      return;
    }

    await refreshDirectoryPaths(directoriesToRefresh, {
      showLoadingIndicator: false,
      refreshGitStatus: options?.refreshGitStatus,
    });
  }, [refreshDirectoryPaths, rootPath]);

  const loadGitHistory = useCallback(async (
    config: {
      filePath?: string;
      lineNumber?: number;
    },
  ) => {
    const requestKey = `git-history:${rootPath}`;
    const requestVersion = runtimeStoreRef.current.markLatest(requestKey);
    const cacheKey = `${requestKey}:${config.filePath ?? ''}:${config.lineNumber ?? ''}`;
    const cachedHistory = runtimeStoreRef.current.getCache<CodePaneGitHistoryResult>(
      cacheKey,
      CODE_PANE_TOOL_WINDOW_CACHE_TTL_MS,
    );
    if (cachedHistory) {
      runtimeStoreRef.current.recordRequest(requestKey, t('codePane.requestGitHistory'), {
        meta: config.filePath ? getRelativePath(rootPath, config.filePath) : undefined,
        fromCache: true,
      });
      setGitHistory((currentHistory) => (
        areGitHistoryResultsEqual(currentHistory, cachedHistory) ? currentHistory : cachedHistory
      ));
      setSelectedHistoryCommitSha((currentCommitSha) => {
        const nextCommitSha = cachedHistory.entries[0]?.commitSha ?? null;
        return currentCommitSha === nextCommitSha ? currentCommitSha : nextCommitSha;
      });
      setGitHistoryError((currentError) => (currentError === null ? currentError : null));
      setBottomPanelMode((currentMode) => (currentMode === 'history' ? currentMode : 'history'));
      setIsGitHistoryLoading((currentLoading) => (currentLoading ? false : currentLoading));
      return;
    }

    setIsGitHistoryLoading((currentLoading) => (currentLoading ? currentLoading : true));
    setGitHistoryError((currentError) => (currentError === null ? currentError : null));

    const response = await trackRequest(
      requestKey,
      t('codePane.requestGitHistory'),
      config.filePath ? getRelativePath(rootPath, config.filePath) : undefined,
      async () => await dedupeProjectRequest(
        rootPath,
        cacheKey,
        async () => await window.electronAPI.codePaneGitHistory({
          rootPath,
          filePath: config.filePath,
          lineNumber: config.lineNumber,
          limit: 30,
        }),
      ),
    );
    if (!runtimeStoreRef.current.isLatest(requestKey, requestVersion)) {
      return;
    }
    if (!response.success || !response.data) {
      const nextError = response.error || t('common.retry');
      setGitHistoryError((currentError) => (
        currentError === nextError ? currentError : nextError
      ));
      setIsGitHistoryLoading((currentLoading) => (currentLoading === false ? currentLoading : false));
      return;
    }

    const nextHistory = response.data;
    runtimeStoreRef.current.setCache(cacheKey, nextHistory);
    setGitHistory((currentHistory) => (
      areGitHistoryResultsEqual(currentHistory, nextHistory) ? currentHistory : nextHistory
    ));
    setSelectedHistoryCommitSha((currentCommitSha) => {
      const nextCommitSha = nextHistory.entries[0]?.commitSha ?? null;
      return currentCommitSha === nextCommitSha ? currentCommitSha : nextCommitSha;
    });
    setBottomPanelMode((currentMode) => (currentMode === 'history' ? currentMode : 'history'));
    setIsGitHistoryLoading((currentLoading) => (currentLoading === false ? currentLoading : false));
  }, [rootPath, t, trackRequest]);

  const loadBlameForActiveFile = useCallback(async () => {
    const filePath = activeFilePathRef.current;
    if (!filePath) {
      setBlameLines((currentLines) => (currentLines.length === 0 ? currentLines : []));
      return;
    }

    const cacheKey = `git-blame:${rootPath}:${filePath}`;
    const cachedSessionBlame = blameCacheRef.current.get(filePath);
    if (cachedSessionBlame) {
      setBlameLines((currentLines) => (
        areGitBlameLinesEqual(currentLines, cachedSessionBlame) ? currentLines : cachedSessionBlame
      ));
      setIsBlameLoading((currentLoading) => (currentLoading ? false : currentLoading));
      return;
    }

    const cachedBlame = runtimeStoreRef.current.getCache<CodePaneGitBlameLine[]>(
      cacheKey,
      CODE_PANE_TOOL_WINDOW_CACHE_TTL_MS,
    );
    if (cachedBlame) {
      blameCacheRef.current.set(filePath, cachedBlame);
      setBlameLines((currentLines) => (
        areGitBlameLinesEqual(currentLines, cachedBlame) ? currentLines : cachedBlame
      ));
      setIsBlameLoading((currentLoading) => (currentLoading ? false : currentLoading));
      return;
    }

    setIsBlameLoading((currentLoading) => (currentLoading ? currentLoading : true));
    try {
      const nextLines = await dedupeProjectRequest(
        rootPath,
        cacheKey,
        async () => {
          const response = await window.electronAPI.codePaneGitBlame({
            rootPath,
            filePath,
          });
          if (!response.success) {
            throw new Error(response.error || t('common.retry'));
          }

          const resolvedLines = response.data ?? [];
          blameCacheRef.current.set(filePath, resolvedLines);
          runtimeStoreRef.current.setCache(cacheKey, resolvedLines);
          return resolvedLines;
        },
      );
      setBlameLines((currentLines) => (
        areGitBlameLinesEqual(currentLines, nextLines) ? currentLines : nextLines
      ));
      setIsBlameLoading((currentLoading) => (currentLoading === false ? currentLoading : false));
      return;
    } catch (error) {
      setBanner({
        tone: 'warning',
        message: error instanceof Error ? error.message : t('common.retry'),
        filePath,
      });
      setBlameLines((currentLines) => (currentLines.length === 0 ? currentLines : []));
      setIsBlameLoading((currentLoading) => (currentLoading === false ? currentLoading : false));
    }
  }, [rootPath, t]);

  const runGitOperation = useCallback(async (
    task: () => Promise<{ success: boolean; error?: string }>,
    options?: {
      successMessage?: string;
      refreshGraph?: boolean;
      refreshDirectories?: boolean;
    },
  ) => {
    const response = await task();
    if (!response.success) {
      setBanner({
        tone: 'error',
        message: response.error || t('common.retry'),
      });
      return false;
    }

    if (options?.refreshGraph) {
      invalidateGitGraphSnapshot();
    }

    const followUpTasks: Array<Promise<unknown>> = [];
    if (options?.refreshDirectories !== false) {
      followUpTasks.push(
        refreshLoadedDirectories({ refreshGitStatus: false, refreshExternalLibraries: false }),
      );
    }
    followUpTasks.push(refreshGitSnapshot({
      includeGraph: options?.refreshGraph === true && shouldLoadGitGraph(),
      force: true,
    }));
    await Promise.all(followUpTasks);
    if (options?.successMessage) {
      setBanner({
        tone: 'info',
        message: options.successMessage,
      });
    }

    if (isBlameVisible) {
      await loadBlameForActiveFile();
    }

    return true;
  }, [
    invalidateGitGraphSnapshot,
    isBlameVisible,
    loadBlameForActiveFile,
    refreshGitSnapshot,
    refreshLoadedDirectories,
    shouldLoadGitGraph,
    t,
  ]);

  const stageGitPaths = useCallback(async (paths: string[]) => {
    await runGitOperation(
      async () => await window.electronAPI.codePaneGitStage({ rootPath, paths }),
      {
        successMessage: t('codePane.gitStageSuccess'),
        refreshDirectories: false,
      },
    );
  }, [rootPath, runGitOperation, t]);

  const unstageGitPaths = useCallback(async (paths: string[]) => {
    await runGitOperation(
      async () => await window.electronAPI.codePaneGitUnstage({ rootPath, paths }),
      {
        successMessage: t('codePane.gitUnstageSuccess'),
        refreshDirectories: false,
      },
    );
  }, [rootPath, runGitOperation, t]);

  const removeGitPaths = useCallback(async (paths: string[], cached?: boolean) => {
    const normalizedPaths = cached ? [] : suppressExternalChangesForPaths(paths);
    const didRemove = await runGitOperation(
      async () => await window.electronAPI.codePaneGitRemove({ rootPath, paths, cached }),
      {
        successMessage: t('codePane.gitRemoveSuccess'),
        refreshDirectories: false,
      },
    );
    if (didRemove) {
      await refreshDirectoriesForPaths(paths, { refreshGitStatus: false });
      return;
    }

    if (normalizedPaths.length === 0) {
      return;
    }

    for (const filePath of normalizedPaths) {
      suppressedExternalChangePathsRef.current.delete(filePath);
    }
  }, [refreshDirectoriesForPaths, rootPath, runGitOperation, suppressExternalChangesForPaths, t]);

  const discardGitPaths = useCallback(async (paths: string[], restoreStaged?: boolean) => {
    const normalizedPaths = suppressExternalChangesForPaths(paths);

    const didDiscard = await runGitOperation(
      async () => await window.electronAPI.codePaneGitDiscard({ rootPath, paths, restoreStaged }),
      {
        successMessage: t('codePane.gitDiscardSuccess'),
        refreshDirectories: false,
      },
    );
    if (!didDiscard) {
      for (const filePath of normalizedPaths) {
        suppressedExternalChangePathsRef.current.delete(filePath);
      }
      return;
    }

    const reloadRequests: Promise<void>[] = [];
    for (const filePath of normalizedPaths) {
      if (fileModelsRef.current.has(filePath)) {
        reloadRequests.push((async () => {
          await reloadFileFromDisk(filePath);
        })());
      }
    }
    await Promise.all([
      refreshDirectoriesForPaths(paths, { refreshGitStatus: false }),
      Promise.all(reloadRequests),
    ]);
  }, [refreshDirectoriesForPaths, reloadFileFromDisk, rootPath, runGitOperation, suppressExternalChangesForPaths, t]);

  const updateExternalReviewEntry = useCallback((
    filePath: string,
    updater: (entry: ExternalChangeEntry) => ExternalChangeEntry | null,
  ) => {
    const currentEntry = externalChangeStateRef.current.entriesByPath.get(filePath) ?? null;
    if (!currentEntry) {
      return null;
    }
    const nextEntry = updater(currentEntry);
    if (!nextEntry) {
      clearExternalChangeEntry(filePath);
      return null;
    }
    updateExternalChangeEntry(nextEntry);
    return nextEntry;
  }, [clearExternalChangeEntry, updateExternalChangeEntry]);

  const persistExternalReviewFileContent = useCallback(async (
    filePath: string,
    nextContent: string | null,
    options?: {
      removeFile?: boolean;
    },
  ) => {
    const suppressedPaths = suppressExternalChangesForPaths([filePath]);
    const existingModel = fileModelsRef.current.get(filePath) ?? null;
    const existingMeta = fileMetaRef.current.get(filePath) ?? null;

    if (options?.removeFile) {
      const response = await window.electronAPI.codePaneDeleteFile({
        rootPath,
        filePath,
      });
      if (!response.success) {
        for (const suppressedPath of suppressedPaths) {
          suppressedExternalChangePathsRef.current.delete(suppressedPath);
        }
        setBanner({
          tone: 'error',
          message: response.error || t('common.retry'),
          filePath,
        });
        return false;
      }

      if (existingModel) {
        await closeFileTab(filePath);
      } else {
        await refreshDirectoriesForPaths([filePath], { refreshGitStatus: false });
      }
      scheduleGitStatusRefresh();
      return true;
    }

    const normalizedContent = nextContent ?? '';
    if (existingModel) {
      suppressModelEventsRef.current.add(filePath);
      existingModel.setValue(normalizedContent);
      suppressModelEventsRef.current.delete(filePath);
      invalidateDefinitionLookupCacheForFile(filePath);
      addLocalHistoryEntry(filePath, 'restore', normalizedContent);
      const didSave = await saveFile(filePath, {
        overwrite: true,
        waitForLanguageSync: true,
      });
      if (!didSave) {
        for (const suppressedPath of suppressedPaths) {
          suppressedExternalChangePathsRef.current.delete(suppressedPath);
        }
      }
      return didSave;
    }

    const response = await window.electronAPI.codePaneWriteFile({
      rootPath,
      filePath,
      content: normalizedContent,
      expectedMtimeMs: existingMeta?.mtimeMs,
    });
    if (!response.success || !response.data) {
      for (const suppressedPath of suppressedPaths) {
        suppressedExternalChangePathsRef.current.delete(suppressedPath);
      }
      setBanner({
        tone: response.errorCode === CODE_PANE_SAVE_CONFLICT_ERROR_CODE ? 'warning' : 'error',
        message: response.errorCode === CODE_PANE_SAVE_CONFLICT_ERROR_CODE
          ? t('codePane.saveConflict')
          : (response.error || t('common.retry')),
        filePath,
        showReload: response.errorCode === CODE_PANE_SAVE_CONFLICT_ERROR_CODE,
        showOverwrite: response.errorCode === CODE_PANE_SAVE_CONFLICT_ERROR_CODE,
      });
      return false;
    }

    invalidateWorkspaceRuntimeCaches(filePath);
    addLocalHistoryEntry(filePath, 'restore', normalizedContent);
    await refreshDirectoriesForPaths([filePath], { refreshGitStatus: false });
    scheduleGitStatusRefresh();
    return true;
  }, [
    addLocalHistoryEntry,
    closeFileTab,
    invalidateDefinitionLookupCacheForFile,
    invalidateWorkspaceRuntimeCaches,
    refreshDirectoriesForPaths,
    rootPath,
    saveFile,
    scheduleGitStatusRefresh,
    suppressExternalChangesForPaths,
    t,
  ]);

  const acceptExternalReviewAll = useCallback((filePath: string) => {
    clearExternalChangeEntry(filePath);
  }, [clearExternalChangeEntry]);

  const revertExternalReviewAll = useCallback(async (filePath: string) => {
    const entry = externalChangeStateRef.current.entriesByPath.get(filePath) ?? null;
    if (!entry) {
      return;
    }
    const didPersist = await persistExternalReviewFileContent(
      filePath,
      entry.changeType === 'added' ? null : entry.previousContent,
      {
        removeFile: entry.changeType === 'added',
      },
    );
    if (didPersist) {
      clearExternalChangeEntry(filePath);
    }
  }, [clearExternalChangeEntry, persistExternalReviewFileContent]);

  const acceptExternalReviewBlock = useCallback((filePath: string, block: ExternalChangeReviewBlock) => {
    updateExternalReviewEntry(filePath, (entry) => {
      if (entry.previousContent === null || entry.currentContent === null) {
        return null;
      }
      const nextPreviousContent = applyExternalChangeReviewBlock(
        entry.previousContent,
        block.beforeStartIndex,
        block.beforeDeleteCount,
        block.addedLines,
      );
      if (nextPreviousContent === entry.currentContent) {
        return null;
      }
      return {
        ...entry,
        previousContent: nextPreviousContent,
        changedAt: Date.now(),
      };
    });
  }, [updateExternalReviewEntry]);

  const revertExternalReviewBlock = useCallback(async (filePath: string, block: ExternalChangeReviewBlock) => {
    const entry = externalChangeStateRef.current.entriesByPath.get(filePath) ?? null;
    if (!entry || entry.previousContent === null || entry.currentContent === null) {
      return;
    }
    const nextCurrentContent = applyExternalChangeReviewBlock(
      entry.currentContent,
      block.afterStartIndex,
      block.afterDeleteCount,
      block.deletedLines,
    );
    const didPersist = await persistExternalReviewFileContent(filePath, nextCurrentContent);
    if (!didPersist) {
      return;
    }
    updateExternalReviewEntry(filePath, (currentEntry) => {
      if (currentEntry.previousContent === null || currentEntry.currentContent === null) {
        return null;
      }
      const nextCurrentEntryContent = applyExternalChangeReviewBlock(
        currentEntry.currentContent,
        block.afterStartIndex,
        block.afterDeleteCount,
        block.deletedLines,
      );
      if (currentEntry.previousContent === nextCurrentEntryContent) {
        return null;
      }
      return {
        ...currentEntry,
        currentContent: nextCurrentEntryContent,
        changedAt: Date.now(),
      };
    });
  }, [persistExternalReviewFileContent, updateExternalReviewEntry]);

  const stageGitHunk = useCallback(async (hunk: CodePaneGitDiffHunk) => {
    const didApply = await runGitOperation(
      async () => await window.electronAPI.codePaneGitStageHunk({
        rootPath,
        filePath: hunk.filePath,
        patch: hunk.patch,
      }),
      {
        successMessage: t('codePane.gitStageHunkSuccess'),
        refreshDirectories: false,
      },
    );
    if (didApply) {
      await loadGitDiffHunks(hunk.filePath);
    }
  }, [loadGitDiffHunks, rootPath, runGitOperation, t]);

  const unstageGitHunk = useCallback(async (hunk: CodePaneGitDiffHunk) => {
    const didApply = await runGitOperation(
      async () => await window.electronAPI.codePaneGitUnstageHunk({
        rootPath,
        filePath: hunk.filePath,
        patch: hunk.patch,
      }),
      {
        successMessage: t('codePane.gitUnstageHunkSuccess'),
        refreshDirectories: false,
      },
    );
    if (didApply) {
      await loadGitDiffHunks(hunk.filePath);
    }
  }, [loadGitDiffHunks, rootPath, runGitOperation, t]);

  const discardGitHunk = useCallback(async (hunk: CodePaneGitDiffHunk) => {
    const didApply = await runGitOperation(
      async () => await window.electronAPI.codePaneGitDiscardHunk({
        rootPath,
        filePath: hunk.filePath,
        patch: hunk.patch,
      }),
      {
        successMessage: t('codePane.gitDiscardHunkSuccess'),
        refreshDirectories: false,
      },
    );
    if (didApply) {
      await loadGitDiffHunks(hunk.filePath);
    }
  }, [loadGitDiffHunks, rootPath, runGitOperation, t]);

  const commitGitChanges = useCallback(async (config: {
    message: string;
    amend: boolean;
    includeAll: boolean;
    paths?: string[];
  }) => {
    const response = await window.electronAPI.codePaneGitCommit({
      rootPath,
      message: config.message,
      amend: config.amend,
      includeAll: config.includeAll,
      paths: config.paths,
    });
    if (!response.success) {
      setBanner({
        tone: 'error',
        message: response.error || t('common.retry'),
      });
      return false;
    }

    invalidateGitGraphSnapshot();
    invalidateProjectCache(rootPath, 'git-branches');
    invalidateProjectCache(rootPath, 'git-rebase');
    await refreshGitSnapshot({ includeGraph: shouldLoadGitGraph(), force: true });
    if (isBlameVisible) {
      await loadBlameForActiveFile();
    }
    setBanner({
      tone: 'info',
      message: response.data?.summary
        ? `${t('codePane.gitCommitSuccess')} ${response.data.summary}`
        : t('codePane.gitCommitSuccess'),
    });
    return true;
  }, [invalidateGitGraphSnapshot, isBlameVisible, loadBlameForActiveFile, refreshGitSnapshot, rootPath, shouldLoadGitGraph, t]);

  const openCommitWindow = useCallback((options?: { initialMessage?: string; preselectedPaths?: string[] }) => {
    const entrySnapshot: CodePaneGitStatusEntry[] = [];
    for (const entry of gitStatusEntriesRef.current) {
      entrySnapshot.push(entry);
    }
    let preselectedPaths: string[] | null = null;
    if (options?.preselectedPaths) {
      const seenPaths = new Set<string>();
      const nextPreselectedPaths: string[] = [];
      for (const candidatePath of options.preselectedPaths) {
        if (!candidatePath || seenPaths.has(candidatePath)) {
          continue;
        }
        seenPaths.add(candidatePath);
        nextPreselectedPaths.push(candidatePath);
      }
      preselectedPaths = nextPreselectedPaths;
    }
    const initialSelectedPaths = preselectedPaths && preselectedPaths.length > 0
      ? preselectedPaths
      : (() => {
        const nextInitialSelectedPaths: string[] = [];
        for (const entry of entrySnapshot) {
          nextInitialSelectedPaths.push(entry.path);
        }
        return nextInitialSelectedPaths;
      })();
    if (initialSelectedPaths[0]) {
      setSelectedGitChangePath((currentPath) => (
        currentPath === initialSelectedPaths[0] ? currentPath : initialSelectedPaths[0]
      ));
      void loadGitDiffHunks(initialSelectedPaths[0]);
    } else {
      setSelectedGitChangePath((currentPath) => (
        currentPath === null ? currentPath : null
      ));
      void loadGitDiffHunks(null);
    }
    const nextCommitWindowState = {
      initialMessage: options?.initialMessage ?? '',
      preselectedPaths,
      entriesSnapshot: entrySnapshot,
    };
    const resolvedCommitWindowState = areCommitWindowStatesEqual(
      commitWindowStateRef.current,
      nextCommitWindowState,
    )
      ? commitWindowStateRef.current
      : nextCommitWindowState;
    commitWindowStateRef.current = resolvedCommitWindowState;
    setCommitWindowState((currentState) => (
      areCommitWindowStatesEqual(currentState, resolvedCommitWindowState)
        ? currentState
        : resolvedCommitWindowState
    ));
  }, [loadGitDiffHunks]);

  const showHistoryForCurrentSelection = useCallback(async () => {
    const context = getActiveEditorContext();
    if (!context) {
      return;
    }

    const selectedLineNumber = context.selection && !context.selection.isEmpty()
      ? context.selection.startLineNumber
      : context.position.lineNumber;

    await loadGitHistory({
      filePath: context.filePath,
      lineNumber: selectedLineNumber,
    });
  }, [getActiveEditorContext, loadGitHistory]);

  const comparePathWithReference = useCallback(async (filePath: string, revisionRef: string) => {
    const trimmedRevisionRef = revisionRef.trim();
    if (!trimmedRevisionRef) {
      return;
    }

    await openGitRevisionDiff({
      filePath,
      leftCommitSha: trimmedRevisionRef,
      leftLabel: trimmedRevisionRef,
      rightLabel: t('codePane.modified'),
    });
  }, [openGitRevisionDiff, t]);

  const comparePathWithRevision = useCallback(async (filePath: string) => {
    openActionInputDialog({
      kind: 'compare-file-with-reference',
      filePath,
      mode: 'revision',
      initialValue: '',
    }, { deferred: true });
  }, [openActionInputDialog]);

  const getGitBranchesForAction = useCallback(async () => {
    if (gitBranches.length > 0) {
      return gitBranches;
    }

    const response = await window.electronAPI.codePaneGetGitBranches({ rootPath });
    if (!response.success || !response.data) {
      return gitBranches;
    }

    const nextBranches = response.data ?? [];
    const resolvedBranches = areGitBranchesEqual(gitBranchesRef.current, nextBranches)
      ? gitBranchesRef.current
      : nextBranches;

    startTransition(() => {
      setGitBranches((currentBranches) => (
        areGitBranchesEqual(currentBranches, resolvedBranches) ? currentBranches : resolvedBranches
      ));
    });
    return resolvedBranches;
  }, [gitBranches, rootPath]);

  const comparePathWithBranch = useCallback(async (filePath: string) => {
    const availableBranches = await getGitBranchesForAction();
    const currentBranchName = gitRepositorySummary?.currentBranch ?? '';
    let suggestedBranchName = '';
    for (const branch of availableBranches) {
      if (branch.name === currentBranchName && branch.upstream) {
        suggestedBranchName = branch.upstream;
        break;
      }
      if (!suggestedBranchName && branch.kind === 'remote') {
        suggestedBranchName = branch.name;
      }
      if (!suggestedBranchName && !branch.current) {
        suggestedBranchName = branch.name;
      }
    }
    openActionInputDialog({
      kind: 'compare-file-with-reference',
      filePath,
      mode: 'branch',
      initialValue: suggestedBranchName,
    }, { deferred: true });
  }, [getGitBranchesForAction, gitRepositorySummary?.currentBranch, openActionInputDialog]);

  const comparePathWithLatestRepositoryVersion = useCallback(async (filePath: string) => {
    await comparePathWithReference(filePath, 'HEAD');
  }, [comparePathWithReference]);

  const stashGitChanges = useCallback(async (config: { message: string; includeUntracked: boolean }) => {
    const response = await window.electronAPI.codePaneGitStash({
      rootPath,
      message: config.message,
      includeUntracked: config.includeUntracked,
    });
    if (!response.success) {
      setBanner({
        tone: 'error',
        message: response.error || t('common.retry'),
      });
      return false;
    }

    invalidateGitGraphSnapshot();
    await Promise.all([
      refreshLoadedDirectories({ refreshGitStatus: false, refreshExternalLibraries: false }),
      refreshGitSnapshot({ includeGraph: shouldLoadGitGraph(), force: true }),
    ]);
    setBanner({
      tone: 'info',
      message: response.data?.reference
        ? `${t('codePane.gitStashSuccess')} ${response.data.reference}`
        : t('codePane.gitStashSuccess'),
    });
    return true;
  }, [invalidateGitGraphSnapshot, refreshGitSnapshot, refreshLoadedDirectories, rootPath, shouldLoadGitGraph, t]);

  const checkoutGitBranch = useCallback(async (config: {
    branchName: string;
    createBranch: boolean;
    startPoint?: string;
    detached?: boolean;
    preferExisting?: boolean;
  }) => {
    const didCheckout = await runGitOperation(
      async () => await window.electronAPI.codePaneGitCheckout({
        rootPath,
        branchName: config.branchName,
        createBranch: config.createBranch,
        startPoint: config.startPoint,
        detached: config.detached,
        preferExisting: config.preferExisting,
      }),
      {
        refreshGraph: true,
      },
    );
    if (didCheckout) {
      invalidateProjectCache(rootPath, 'git-branches');
      invalidateProjectCache(rootPath, 'git-rebase');
      await loadGitBranches({ preferredBaseRef: gitRebaseBaseRef });
    }
  }, [gitRebaseBaseRef, loadGitBranches, rootPath, runGitOperation, t]);

  const updateGitProject = useCallback(async () => {
    const didUpdate = await runGitOperation(
      async () => await window.electronAPI.codePaneGitUpdateProject({
        rootPath,
      }),
      {
        successMessage: t('codePane.gitUpdateProjectSuccess'),
        refreshGraph: true,
      },
    );
    if (didUpdate) {
      invalidateProjectCache(rootPath, 'git-branches');
      invalidateProjectCache(rootPath, 'git-rebase');
      await loadGitBranches({ preferredBaseRef: gitRebaseBaseRef });
    }
  }, [gitRebaseBaseRef, loadGitBranches, rootPath, runGitOperation, t]);

  const checkoutGitRevisionFromPrompt = useCallback(async () => {
    openActionInputDialog({
      kind: 'checkout-revision',
      initialValue: '',
    }, { deferred: true });
  }, [openActionInputDialog]);

  const pushGitBranch = useCallback(async (config?: { remote?: string; branchName?: string; setUpstream?: boolean }) => {
    const response = await window.electronAPI.codePaneGitPush({
      rootPath,
      remote: config?.remote,
      branchName: config?.branchName,
      setUpstream: config?.setUpstream,
    });
    if (!response.success) {
      setBanner({
        tone: 'error',
        message: response.error || t('common.retry'),
      });
      return;
    }

    invalidateGitGraphSnapshot();
    invalidateProjectCache(rootPath, 'git-branches');
    await refreshGitSnapshot({ includeGraph: shouldLoadGitGraph(), force: true });
    await loadGitBranches({ preferredBaseRef: gitRebaseBaseRef });
    setBanner({
      tone: 'info',
      message: t('codePane.gitPushSuccess'),
    });
  }, [gitRebaseBaseRef, invalidateGitGraphSnapshot, loadGitBranches, refreshGitSnapshot, rootPath, shouldLoadGitGraph, t]);

  const controlGitRebase = useCallback(async (action: 'continue' | 'abort') => {
    const didControl = await runGitOperation(
      async () => await window.electronAPI.codePaneGitRebaseControl({
        rootPath,
        action,
      }),
      {
        successMessage: action === 'continue' ? t('codePane.gitRebaseContinueSuccess') : t('codePane.gitRebaseAbortSuccess'),
        refreshGraph: true,
      },
    );
    if (didControl) {
      invalidateProjectCache(rootPath, 'git-branches');
      invalidateProjectCache(rootPath, 'git-rebase');
      await Promise.all([
        loadGitBranches({ preferredBaseRef: gitRebaseBaseRef }),
        loadGitRebasePlan(gitRebaseBaseRef),
      ]);
    }
  }, [gitRebaseBaseRef, loadGitBranches, loadGitRebasePlan, rootPath, runGitOperation, t]);

  const renameGitBranch = useCallback(async (branchName: string, nextBranchName: string) => {
    const didRename = await runGitOperation(
      async () => await window.electronAPI.codePaneGitRenameBranch({
        rootPath,
        branchName,
        nextBranchName,
      }),
      {
        successMessage: t('codePane.gitRenameBranchSuccess'),
        refreshGraph: true,
        refreshDirectories: false,
      },
    );
    if (didRename) {
      invalidateProjectCache(rootPath, 'git-branches');
      invalidateProjectCache(rootPath, 'git-rebase');
      await loadGitBranches({
        preferredBaseRef: gitRebaseBaseRef === branchName ? nextBranchName : gitRebaseBaseRef,
      });
    }
  }, [gitRebaseBaseRef, loadGitBranches, rootPath, runGitOperation, t]);

  const deleteGitBranch = useCallback(async (branchName: string, force?: boolean) => {
    const didDelete = await runGitOperation(
      async () => await window.electronAPI.codePaneGitDeleteBranch({
        rootPath,
        branchName,
        force,
      }),
      {
        successMessage: t('codePane.gitDeleteBranchSuccess'),
        refreshGraph: true,
        refreshDirectories: false,
      },
    );
    if (didDelete) {
      invalidateProjectCache(rootPath, 'git-branches');
      invalidateProjectCache(rootPath, 'git-rebase');
      await loadGitBranches({
        preferredBaseRef: gitRebaseBaseRef === branchName ? '' : gitRebaseBaseRef,
      });
    }
  }, [gitRebaseBaseRef, loadGitBranches, rootPath, runGitOperation, t]);

  const handleActionInputConfirm = useCallback(async (value: string) => {
    if (!actionInputDialog) {
      return false;
    }

    switch (actionInputDialog.kind) {
      case 'rename-symbol': {
        if (!value || value === actionInputDialog.initialValue) {
          return false;
        }

        const response = await prepareRefactorPreview({
          kind: 'rename-symbol',
          rootPath,
          filePath: actionInputDialog.filePath,
          language: actionInputDialog.language,
          position: actionInputDialog.position,
          newName: value,
        });
        return Boolean(response);
      }
      case 'rename-path-preview': {
        if (!value || value === actionInputDialog.initialValue) {
          return false;
        }

        const response = await prepareRefactorPreview({
          kind: 'rename-path',
          rootPath,
          filePath: actionInputDialog.filePath,
          nextFilePath: replacePathLeaf(actionInputDialog.filePath, value),
        });
        return Boolean(response);
      }
      case 'move-path-preview': {
        if (!value || value === actionInputDialog.initialValue) {
          return false;
        }

        const response = await prepareRefactorPreview({
          kind: 'move-path',
          rootPath,
          filePath: actionInputDialog.filePath,
          nextFilePath: resolvePathFromRoot(rootPath, value),
        });
        return Boolean(response);
      }
      case 'compare-file-with-reference': {
        if (!value) {
          return false;
        }
        await comparePathWithReference(actionInputDialog.filePath, value);
        return true;
      }
      case 'checkout-revision': {
        if (!value) {
          return false;
        }
        await checkoutGitBranch({
          branchName: value,
          createBranch: false,
          detached: true,
        });
        return true;
      }
      case 'cherry-pick': {
        if (!value) {
          return false;
        }
        await runGitOperation(
          async () => await window.electronAPI.codePaneGitCherryPick({
            rootPath,
            commitSha: value,
          }),
          {
            successMessage: t('codePane.gitCherryPickSuccess'),
            refreshGraph: true,
          },
        );
        return true;
      }
      case 'checkout-branch': {
        if (!value) {
          return false;
        }
        await checkoutGitBranch({
          branchName: value,
          createBranch: actionInputDialog.createBranch,
          startPoint: actionInputDialog.startPoint,
          detached: actionInputDialog.detached,
          preferExisting: actionInputDialog.preferExisting,
        });
        return true;
      }
      case 'rename-branch': {
        if (!value || value === actionInputDialog.branchName) {
          return false;
        }
        await renameGitBranch(actionInputDialog.branchName, value);
        return true;
      }
      case 'stash': {
        return await stashGitChanges({
          message: value,
          includeUntracked: actionInputDialog.includeUntracked,
        });
      }
    }
  }, [
    actionInputDialog,
    checkoutGitBranch,
    comparePathWithReference,
    stashGitChanges,
    prepareRefactorPreview,
    renameGitBranch,
    rootPath,
    runGitOperation,
    t,
  ]);

  const submitActionInput = useCallback(async (value: string) => {
    setIsSubmittingActionInput((currentSubmitting) => (currentSubmitting ? currentSubmitting : true));
    try {
      const didSucceed = await handleActionInputConfirm(value);
      if (didSucceed) {
        setActionInputDialog((currentDialog) => (currentDialog === null ? currentDialog : null));
      }
      return didSucceed;
    } finally {
      setIsSubmittingActionInput((currentSubmitting) => (currentSubmitting ? false : currentSubmitting));
    }
  }, [handleActionInputConfirm]);

  const handleActionConfirmSubmit = useCallback(async () => {
    if (!actionConfirmDialog) {
      return false;
    }

    switch (actionConfirmDialog.kind) {
      case 'safe-delete-path': {
        const response = await prepareRefactorPreview({
          kind: 'safe-delete',
          rootPath,
          filePath: actionConfirmDialog.filePath,
        });
        return Boolean(response);
      }
      case 'delete-branch':
        await deleteGitBranch(actionConfirmDialog.branchName, actionConfirmDialog.force);
        return true;
    }
  }, [actionConfirmDialog, deleteGitBranch, prepareRefactorPreview, rootPath]);

  const submitActionConfirm = useCallback(async () => {
    setIsSubmittingActionConfirm((currentSubmitting) => (currentSubmitting ? currentSubmitting : true));
    try {
      const didSucceed = await handleActionConfirmSubmit();
      if (didSucceed) {
        setActionConfirmDialog((currentDialog) => (currentDialog === null ? currentDialog : null));
      }
      return didSucceed;
    } finally {
      setIsSubmittingActionConfirm((currentSubmitting) => (currentSubmitting ? false : currentSubmitting));
    }
  }, [handleActionConfirmSubmit]);

  const applyGitRebasePlan = useCallback(async (
    baseRef: string,
    entries: CodePaneGitRebasePlanEntry[],
  ) => {
    const response = await window.electronAPI.codePaneGitApplyRebasePlan({
      rootPath,
      baseRef,
      entries,
    });

    invalidateGitGraphSnapshot();
    invalidateProjectCache(rootPath, 'git-branches');
    invalidateProjectCache(rootPath, 'git-rebase');
    await Promise.all([
      refreshGitSnapshot({ includeGraph: shouldLoadGitGraph(), force: true }),
      loadGitBranches({ preferredBaseRef: baseRef }),
      loadGitRebasePlan(baseRef),
    ]);

    if (!response.success) {
      setBanner({
        tone: 'error',
        message: response.error || t('common.retry'),
      });
      return;
    }

    setBanner({
      tone: 'info',
      message: t('codePane.gitApplyRebasePlanSuccess'),
    });
  }, [
    invalidateGitGraphSnapshot,
    loadGitBranches,
    loadGitRebasePlan,
    refreshGitSnapshot,
    rootPath,
    shouldLoadGitGraph,
    t,
  ]);

  const cherryPickCommit = useCallback(async (commitSha: string) => {
    await runGitOperation(
      async () => await window.electronAPI.codePaneGitCherryPick({
        rootPath,
        commitSha,
      }),
      {
        successMessage: t('codePane.gitCherryPickSuccess'),
        refreshGraph: true,
      },
    );
  }, [rootPath, runGitOperation, t]);

  const cherryPickPathCommit = useCallback(async () => {
    openActionInputDialog({
      kind: 'cherry-pick',
      initialValue: '',
    }, { deferred: true });
  }, [openActionInputDialog]);

  const resolveGitConflict = useCallback(async (filePath: string, strategy: 'ours' | 'theirs' | 'mark-resolved') => {
    await runGitOperation(
      async () => await window.electronAPI.codePaneGitResolveConflict({
        rootPath,
        filePath,
        strategy,
      }),
      {
        successMessage: t('codePane.gitConflictResolved'),
        refreshDirectories: false,
      },
    );
  }, [rootPath, runGitOperation, t]);

  const openGitConflictResolver = useCallback(async (filePath: string) => {
    setBottomPanelMode((currentMode) => (currentMode === 'conflict' ? currentMode : 'conflict'));
    await loadGitConflictDetails(filePath);
  }, [loadGitConflictDetails]);

  const applyGitConflictResolution = useCallback(async (mergedContent: string) => {
    if (!selectedGitConflictPath) {
      return;
    }

    setIsApplyingGitConflict((currentApplying) => (currentApplying ? currentApplying : true));
    setGitConflictError((currentError) => (currentError === null ? currentError : null));
    const response = await window.electronAPI.codePaneGitApplyConflictResolution({
      rootPath,
      filePath: selectedGitConflictPath,
      mergedContent,
    });

    await refreshGitSnapshot({ includeGraph: shouldLoadGitGraph(), force: true });

    if (!response.success) {
      setGitConflictError((currentError) => {
        const nextError = response.error || t('common.retry');
        return currentError === nextError ? currentError : nextError;
      });
      setIsApplyingGitConflict((currentApplying) => (currentApplying ? false : currentApplying));
      return;
    }

    setIsApplyingGitConflict((currentApplying) => (currentApplying ? false : currentApplying));
    setGitConflictDetails((currentDetails) => (currentDetails === null ? currentDetails : null));
    setSelectedGitConflictPath((currentPath) => (currentPath === null ? currentPath : null));
    setBottomPanelMode((currentMode) => (currentMode === 'conflict' ? null : currentMode));
    setBanner({
      tone: 'info',
      message: t('codePane.gitConflictResolved'),
    });
  }, [refreshGitSnapshot, rootPath, selectedGitConflictPath, shouldLoadGitGraph, t]);

  const pruneRemovedDirectories = useCallback((changes: CodePaneFsChange[]) => {
    const removedFilePaths = new Set<string>();
    const removedDirectoryPaths: string[] = [];
    for (const change of changes) {
      if (!isPathInside(rootPath, change.path)) {
        continue;
      }

      if (change.type === 'unlink') {
        removedFilePaths.add(normalizePath(change.path));
        continue;
      }

      if (change.type === 'unlinkDir') {
        removedDirectoryPaths.push(normalizePath(change.path));
      }
    }

    if (removedFilePaths.size === 0 && removedDirectoryPaths.length === 0) {
      return;
    }

    for (const removedDirectoryPath of removedDirectoryPaths) {
      invalidateDirectoryCache(rootPath, removedDirectoryPath);
    }

    const nextLoadedDirectories = new Set<string>();
    for (const directoryPath of loadedDirectoriesRef.current) {
      if (!isPathAffectedByRemovedDirectory(removedDirectoryPaths, directoryPath)) {
        nextLoadedDirectories.add(directoryPath);
      }
    }
    loadedDirectoriesRef.current = nextLoadedDirectories;

    setLoadedDirectories((currentLoadedDirectories) => (
      areStringSetsEqual(currentLoadedDirectories, nextLoadedDirectories)
        ? currentLoadedDirectories
        : nextLoadedDirectories
    ));
    setExpandedDirectories((currentExpandedDirectories) => {
      if (removedDirectoryPaths.length === 0) {
        return currentExpandedDirectories;
      }

      const nextExpandedDirectories = new Set<string>();
      for (const directoryPath of currentExpandedDirectories) {
        if (!isPathAffectedByRemovedDirectory(removedDirectoryPaths, directoryPath)) {
          nextExpandedDirectories.add(directoryPath);
        }
      }

      if (nextExpandedDirectories.size === currentExpandedDirectories.size) {
        return currentExpandedDirectories;
      }

      persistCodeState({
        expandedPaths: getPersistedExpandedPaths(nextExpandedDirectories),
      });

      return nextExpandedDirectories;
    });
    setTreeEntriesByDirectory((currentTreeEntries) => {
      let didChange = false;
      const nextTreeEntries: Record<string, CodePaneTreeEntry[]> = {};

      for (const [directoryPath, entries] of Object.entries(currentTreeEntries)) {
        if (isPathAffectedByRemovedDirectory(removedDirectoryPaths, directoryPath)) {
          compactDirectoryPresentationsCacheRef.current.delete(directoryPath);
          didChange = true;
          continue;
        }

        let nextEntries = entries;
        for (const entry of entries) {
          const normalizedEntryPath = normalizePath(entry.path);
          if (
            removedFilePaths.has(normalizedEntryPath)
            || isPathAffectedByRemovedDirectory(removedDirectoryPaths, normalizedEntryPath)
          ) {
            const filteredEntries: CodePaneTreeEntry[] = [];
            for (const candidateEntry of entries) {
              const candidatePath = normalizePath(candidateEntry.path);
              if (
                !removedFilePaths.has(candidatePath)
                && !isPathAffectedByRemovedDirectory(removedDirectoryPaths, candidatePath)
              ) {
                filteredEntries.push(candidateEntry);
              }
            }
            nextEntries = filteredEntries;
            didChange = true;
            break;
          }
        }

        nextTreeEntries[directoryPath] = nextEntries;
        if (nextEntries !== entries) {
          compactDirectoryPresentationsCacheRef.current.delete(directoryPath);
        }
      }

      return didChange ? nextTreeEntries : currentTreeEntries;
    });
  }, [persistCodeState, rootPath]);

  const ensureMarkerListenerRef = useRef(ensureMarkerListener);
  const disposeEditorsRef = useRef(disposeEditors);
  const disposeAllModelsRef = useRef(disposeAllModels);
  const flushDirtyFilesRef = useRef(flushDirtyFiles);
  const closeAllLanguageDocumentsRef = useRef(closeAllLanguageDocuments);
  const refreshDirectoryPathsRef = useRef(refreshDirectoryPaths);
  const pruneRemovedDirectoriesRef = useRef(pruneRemovedDirectories);
  const recordExternalChangeRef = useRef(recordExternalChange);
  const attachLanguageWorkspaceRef = useRef(attachLanguageWorkspace);
  const loadDirectoryRef = useRef(loadDirectory);
  const refreshProjectBootstrapCachesRef = useRef(refreshProjectBootstrapCaches);
  const resetExternalLibrarySectionsRef = useRef(resetExternalLibrarySections);
  const applyGitSnapshotRef = useRef(applyGitSnapshot);
  const flushPendingFsChangesRef = useRef<() => void>(() => {});

  useEffect(() => {
    ensureMarkerListenerRef.current = ensureMarkerListener;
  }, [ensureMarkerListener]);

  useEffect(() => {
    disposeEditorsRef.current = disposeEditors;
  }, [disposeEditors]);

  useEffect(() => {
    disposeAllModelsRef.current = disposeAllModels;
  }, [disposeAllModels]);

  useEffect(() => {
    flushDirtyFilesRef.current = flushDirtyFiles;
  }, [flushDirtyFiles]);

  useEffect(() => {
    closeAllLanguageDocumentsRef.current = closeAllLanguageDocuments;
  }, [closeAllLanguageDocuments]);

  useEffect(() => {
    refreshDirectoryPathsRef.current = refreshDirectoryPaths;
  }, [refreshDirectoryPaths]);

  useEffect(() => {
    pruneRemovedDirectoriesRef.current = pruneRemovedDirectories;
  }, [pruneRemovedDirectories]);

  useEffect(() => {
    recordExternalChangeRef.current = recordExternalChange;
  }, [recordExternalChange]);

  useEffect(() => {
    attachLanguageWorkspaceRef.current = attachLanguageWorkspace;
  }, [attachLanguageWorkspace]);

  useEffect(() => {
    loadDirectoryRef.current = loadDirectory;
  }, [loadDirectory]);

  useEffect(() => {
    refreshProjectBootstrapCachesRef.current = refreshProjectBootstrapCaches;
  }, [refreshProjectBootstrapCaches]);

  useEffect(() => {
    resetExternalLibrarySectionsRef.current = resetExternalLibrarySections;
  }, [resetExternalLibrarySections]);

  useEffect(() => {
    applyGitSnapshotRef.current = applyGitSnapshot;
  }, [applyGitSnapshot]);

  const revealPath = useCallback(async (targetPath: string, entryType: CodePaneTreeEntry['type']) => {
    try {
      const response = await window.electronAPI.openFolder(
        entryType === 'directory' ? targetPath : getParentDirectory(targetPath),
      );
      if (response && response.success === false) {
        setBanner({
          tone: 'error',
          message: response.error || t('common.retry'),
        });
      }
    } catch (error) {
      setBanner({
        tone: 'error',
        message: error instanceof Error ? error.message : t('common.retry'),
      });
    }
  }, [t]);

  const copyPath = useCallback(async (targetPath: string) => {
    try {
      const response = await window.electronAPI.writeClipboardText(targetPath);
      if (response && response.success === false) {
        setBanner({
          tone: 'error',
          message: response.error || t('common.retry'),
        });
        return;
      }
    } catch (error) {
      setBanner({
        tone: 'error',
        message: error instanceof Error ? error.message : t('common.retry'),
      });
    }
  }, [t]);

  const copyTextValue = useCallback(async (value: string, filePath?: string) => {
    try {
      const response = await window.electronAPI.writeClipboardText(value);
      if (response && response.success === false) {
        setBanner({
          tone: 'error',
          message: response.error || t('common.retry'),
        });
        return;
      }
    } catch (error) {
      setBanner({
        tone: 'error',
        message: error instanceof Error ? error.message : t('common.retry'),
      });
    }
  }, [t]);

  const copyRelativePath = useCallback(async (targetPath: string) => {
    const relativePath = getRelativePath(rootPath, targetPath) || getPathLeafLabel(targetPath) || targetPath;
    await copyTextValue(relativePath, targetPath);
  }, [copyTextValue, rootPath]);

  const togglePinnedTab = useCallback((filePath: string) => {
    updateOpenFileTabs((currentOpenFiles) => {
      const nextOpenFiles: typeof currentOpenFiles = [];
      for (const tab of currentOpenFiles) {
        if (tab.path !== filePath) {
          nextOpenFiles.push(tab);
          continue;
        }

        const nextPinned = !tab.pinned;
        nextOpenFiles.push({
          ...tab,
          pinned: nextPinned || undefined,
          preview: nextPinned ? false : tab.preview,
        });
      }
      return nextOpenFiles;
    });
  }, [updateOpenFileTabs]);

  const getMutationParentDirectory = useCallback((
    targetPath: string,
    entryType: CodePaneTreeEntry['type'],
  ) => (
    entryType === 'directory' ? targetPath : getParentDirectory(targetPath)
  ), []);

  const buildChildPath = useCallback((
    targetPath: string,
    entryType: CodePaneTreeEntry['type'],
    relativeOrLeafPath: string,
  ) => {
    const parentDirectory = getMutationParentDirectory(targetPath, entryType);
    const normalizedRelativePath = normalizePath(relativeOrLeafPath).replace(/^\/+/, '');
    if (!normalizedRelativePath) {
      return parentDirectory;
    }
    return `${parentDirectory}/${normalizedRelativePath}`.replace(/\/{2,}/g, '/');
  }, [getMutationParentDirectory]);

  const updateReferencesForRenamedPath = useCallback((
    sourcePath: string,
    targetPath: string,
  ) => {
    const normalizeRenamedPath = (candidatePath: string | null | undefined) => {
      if (!candidatePath || !isPathEqualOrDescendant(candidatePath, sourcePath)) {
        return candidatePath ?? null;
      }

      return replacePathPrefix(candidatePath, sourcePath, targetPath);
    };

    const currentCodeState = paneRef.current.code;
    const nextOpenFiles: CodePaneOpenFile[] = [];
    for (const tab of currentCodeState?.openFiles ?? []) {
      nextOpenFiles.push(
        isPathEqualOrDescendant(tab.path, sourcePath)
          ? { ...tab, path: replacePathPrefix(tab.path, sourcePath, targetPath) }
          : tab,
      );
    }

    const nextBookmarks = [] as typeof bookmarks;
    for (const bookmark of currentCodeState?.bookmarks ?? []) {
      if (!isPathEqualOrDescendant(bookmark.filePath, sourcePath)) {
        nextBookmarks.push(bookmark);
        continue;
      }

      const nextFilePath = replacePathPrefix(bookmark.filePath, sourcePath, targetPath);
      nextBookmarks.push({
        ...bookmark,
        filePath: nextFilePath,
        id: `${nextFilePath}:${bookmark.lineNumber}`,
      });
    }

    const nextBreakpoints: CodePaneBreakpoint[] = [];
    for (const breakpoint of breakpointsRef.current) {
      nextBreakpoints.push(
        isPathEqualOrDescendant(breakpoint.filePath, sourcePath)
          ? {
              filePath: replacePathPrefix(breakpoint.filePath, sourcePath, targetPath),
              lineNumber: breakpoint.lineNumber,
              ...(breakpoint.condition ? { condition: breakpoint.condition } : {}),
              ...(breakpoint.logMessage ? { logMessage: breakpoint.logMessage } : {}),
              ...(breakpoint.enabled === false ? { enabled: false } : {}),
            }
          : {
              filePath: breakpoint.filePath,
              lineNumber: breakpoint.lineNumber,
              ...(breakpoint.condition ? { condition: breakpoint.condition } : {}),
              ...(breakpoint.logMessage ? { logMessage: breakpoint.logMessage } : {}),
              ...(breakpoint.enabled === false ? { enabled: false } : {}),
            },
      );
    }

    persistCodeState({
      openFiles: nextOpenFiles,
      activeFilePath: normalizeRenamedPath(currentCodeState?.activeFilePath),
      selectedPath: normalizeRenamedPath(currentCodeState?.selectedPath),
      bookmarks: nextBookmarks,
      breakpoints: nextBreakpoints,
    });

    const nextRecentFiles: string[] = [];
    for (const candidatePath of recentFilesRef.current) {
      nextRecentFiles.push(
        isPathEqualOrDescendant(candidatePath, sourcePath)
          ? replacePathPrefix(candidatePath, sourcePath, targetPath)
          : candidatePath,
      );
    }
    recentFilesRef.current = nextRecentFiles;
    navigationStoreRef.current.setSnapshot({
      recentFiles: nextRecentFiles,
    });

    persistEditorSplitLayout({
      secondaryFilePath: normalizeRenamedPath(secondaryFilePathRef.current),
    });

    const nextLocalHistoryEntries = new Map<string, LocalHistoryEntry[]>();
    for (const [candidatePath, entries] of localHistoryEntriesRef.current.entries()) {
      const nextPath = isPathEqualOrDescendant(candidatePath, sourcePath)
        ? replacePathPrefix(candidatePath, sourcePath, targetPath)
        : candidatePath;
      const nextEntries: LocalHistoryEntry[] = [];
      for (const entry of entries) {
        nextEntries.push({
          ...entry,
          filePath: nextPath,
          id: entry.id,
        });
      }
      nextLocalHistoryEntries.set(nextPath, nextEntries);
    }
    localHistoryEntriesRef.current = nextLocalHistoryEntries;

    const migrateTimerMap = (timerMap: Map<string, ReturnType<typeof setTimeout>>) => {
      const nextTimerMap = new Map<string, ReturnType<typeof setTimeout>>();
      for (const [candidatePath, timer] of timerMap.entries()) {
        const nextPath = isPathEqualOrDescendant(candidatePath, sourcePath)
          ? replacePathPrefix(candidatePath, sourcePath, targetPath)
          : candidatePath;
        nextTimerMap.set(nextPath, timer);
      }
      timerMap.clear();
      for (const [candidatePath, timer] of nextTimerMap.entries()) {
        timerMap.set(candidatePath, timer);
      }
    };

    migrateTimerMap(autoSaveTimersRef.current);
    migrateTimerMap(documentSyncTimersRef.current);
    migrateTimerMap(localHistoryTimersRef.current);

    const nextDirtyPaths = new Set<string>();
    for (const candidatePath of dirtyPathsRef.current) {
      nextDirtyPaths.add(
        isPathEqualOrDescendant(candidatePath, sourcePath)
          ? replacePathPrefix(candidatePath, sourcePath, targetPath)
          : candidatePath,
      );
    }
    dirtyPathsRef.current = nextDirtyPaths;

    const nextSavingPaths = new Set<string>();
    for (const candidatePath of savingPathsRef.current) {
      nextSavingPaths.add(
        isPathEqualOrDescendant(candidatePath, sourcePath)
          ? replacePathPrefix(candidatePath, sourcePath, targetPath)
          : candidatePath,
      );
    }
    savingPathsRef.current = nextSavingPaths;

    const nextFileMeta = new Map<string, FileRuntimeMeta>();
    for (const [candidatePath, meta] of fileMetaRef.current.entries()) {
      const nextPath = isPathEqualOrDescendant(candidatePath, sourcePath)
        ? replacePathPrefix(candidatePath, sourcePath, targetPath)
        : candidatePath;
      nextFileMeta.set(nextPath, meta);
    }
    fileMetaRef.current = nextFileMeta;

    const nextModels = new Map<string, MonacoModel>();
    for (const [candidatePath, model] of fileModelsRef.current.entries()) {
      const nextPath = isPathEqualOrDescendant(candidatePath, sourcePath)
        ? replacePathPrefix(candidatePath, sourcePath, targetPath)
        : candidatePath;
      nextModels.set(nextPath, model);
    }
    fileModelsRef.current = nextModels;

    const nextModelFilePaths = new Map<string, string>();
    for (const [modelPath, candidatePath] of modelFilePathRef.current.entries()) {
      nextModelFilePaths.set(
        modelPath,
        isPathEqualOrDescendant(candidatePath, sourcePath)
          ? replacePathPrefix(candidatePath, sourcePath, targetPath)
          : candidatePath,
      );
    }
    modelFilePathRef.current = nextModelFilePaths;

    const nextModelDisposers = new Map<string, MonacoDisposable>();
    for (const [candidatePath, disposable] of modelDisposersRef.current.entries()) {
      const nextPath = isPathEqualOrDescendant(candidatePath, sourcePath)
        ? replacePathPrefix(candidatePath, sourcePath, targetPath)
        : candidatePath;
      nextModelDisposers.set(nextPath, disposable);
    }
    modelDisposersRef.current = nextModelDisposers;

    const nextPreloadedResults = new Map<string, CodePaneReadFileResult>();
    for (const [candidatePath, result] of preloadedReadResultsRef.current.entries()) {
      const nextPath = isPathEqualOrDescendant(candidatePath, sourcePath)
        ? replacePathPrefix(candidatePath, sourcePath, targetPath)
        : candidatePath;
      nextPreloadedResults.set(nextPath, result);
    }
    preloadedReadResultsRef.current = nextPreloadedResults;

    const nextViewStates = new Map<string, MonacoViewState>();
    for (const [candidatePath, viewState] of viewStatesRef.current.entries()) {
      const nextPath = isPathEqualOrDescendant(candidatePath, sourcePath)
        ? replacePathPrefix(candidatePath, sourcePath, targetPath)
        : candidatePath;
      nextViewStates.set(nextPath, viewState);
    }
    viewStatesRef.current = nextViewStates;

    const nextSecondaryViewStates = new Map<string, MonacoViewState>();
    for (const [candidatePath, viewState] of secondaryViewStatesRef.current.entries()) {
      const nextPath = isPathEqualOrDescendant(candidatePath, sourcePath)
        ? replacePathPrefix(candidatePath, sourcePath, targetPath)
        : candidatePath;
      nextSecondaryViewStates.set(nextPath, viewState);
    }
    secondaryViewStatesRef.current = nextSecondaryViewStates;

    const nextSuppressedPaths = new Map<string, number>();
    for (const [candidatePath, expiresAt] of suppressedExternalChangePathsRef.current.entries()) {
      const nextPath = isPathEqualOrDescendant(candidatePath, sourcePath)
        ? replacePathPrefix(candidatePath, sourcePath, targetPath)
        : candidatePath;
      nextSuppressedPaths.set(nextPath, expiresAt);
    }
    suppressedExternalChangePathsRef.current = nextSuppressedPaths;

    const nextSuppressModelEvents = new Set<string>();
    for (const candidatePath of suppressModelEventsRef.current) {
      nextSuppressModelEvents.add(
        isPathEqualOrDescendant(candidatePath, sourcePath)
          ? replacePathPrefix(candidatePath, sourcePath, targetPath)
          : candidatePath,
      );
    }
    suppressModelEventsRef.current = nextSuppressModelEvents;

    const nextProblemsByFile = new Map<string, Array<MonacoMarker & { filePath: string }>>();
    for (const [candidatePath, entries] of problemsByFileRef.current.entries()) {
      const nextPath = isPathEqualOrDescendant(candidatePath, sourcePath)
        ? replacePathPrefix(candidatePath, sourcePath, targetPath)
        : candidatePath;
      nextProblemsByFile.set(
        nextPath,
        entries.map((entry) => (
          nextPath === candidatePath
            ? entry
            : {
                ...entry,
                filePath: nextPath,
              }
        )),
      );
    }
    problemsByFileRef.current = nextProblemsByFile;

    const nextExternalChangeEntries: ExternalChangeEntry[] = [];
    for (const entry of externalChangeEntriesRef.current) {
      if (!isPathEqualOrDescendant(entry.filePath, sourcePath)) {
        nextExternalChangeEntries.push(entry);
        continue;
      }

      const nextFilePath = replacePathPrefix(entry.filePath, sourcePath, targetPath);
      nextExternalChangeEntries.push({
        ...entry,
        id: replacePathPrefix(entry.id, sourcePath, targetPath),
        filePath: nextFilePath,
        relativePath: getRelativePath(rootPath, nextFilePath),
      });
    }
    const nextSelectedExternalChangePath = selectedExternalChangePathRef.current
      && isPathEqualOrDescendant(selectedExternalChangePathRef.current, sourcePath)
      ? replacePathPrefix(selectedExternalChangePathRef.current, sourcePath, targetPath)
      : selectedExternalChangePathRef.current;
    applyExternalChangeState(nextExternalChangeEntries, nextSelectedExternalChangePath);

    if (revisionDiffFilePathRef.current && isPathEqualOrDescendant(revisionDiffFilePathRef.current, sourcePath)) {
      revisionDiffFilePathRef.current = replacePathPrefix(revisionDiffFilePathRef.current, sourcePath, targetPath);
    }
    setPendingGitRevisionDiff((currentRequest) => (
      currentRequest && isPathEqualOrDescendant(currentRequest.filePath, sourcePath)
        ? {
            ...currentRequest,
            filePath: replacePathPrefix(currentRequest.filePath, sourcePath, targetPath),
          }
        : currentRequest
    ));
    pendingGitRevisionDiffRef.current = pendingGitRevisionDiffRef.current
      && isPathEqualOrDescendant(pendingGitRevisionDiffRef.current.filePath, sourcePath)
      ? {
          ...pendingGitRevisionDiffRef.current,
          filePath: replacePathPrefix(pendingGitRevisionDiffRef.current.filePath, sourcePath, targetPath),
        }
      : pendingGitRevisionDiffRef.current;

    clearDefinitionLookupCache();
    refreshProblems();
  }, [clearDefinitionLookupCache, persistCodeState, persistEditorSplitLayout, refreshProblems, rootPath]);

  const openPathMutationDialog = useCallback((
    targetPath: string,
    entryType: CodePaneTreeEntry['type'],
    mode: PathMutationDialogMode,
  ) => {
    setPathMutationDialog({
      mode,
      targetPath,
      entryType,
      initialValue: mode === 'rename'
        ? getPathLeafLabel(targetPath)
        : '',
    });
  }, []);

  const submitPathMutation = useCallback(async (nextInput: string) => {
    if (!pathMutationDialog) {
      return false;
    }

    if (pathMutationDialog.mode === 'create-file') {
      const nextFilePath = buildChildPath(pathMutationDialog.targetPath, pathMutationDialog.entryType, nextInput);
      const parentDirectoryPath = getParentDirectory(nextFilePath);
      const suppressedPaths = suppressExternalChangesForPaths([nextFilePath]);
      const response = await window.electronAPI.codePaneCreateFile({
        rootPath,
        filePath: nextFilePath,
      });

      if (!response.success || !response.data) {
        for (const filePath of suppressedPaths) {
          suppressedExternalChangePathsRef.current.delete(filePath);
        }
        setBanner({
          tone: 'error',
          message: response.error || t('common.retry'),
        });
        return false;
      }

      await revealPathInExplorer(response.data.path, { showSidebar: true });
      await refreshDirectoryPaths([parentDirectoryPath], {
        showLoadingIndicator: false,
      });
      await activateFile(response.data.path, {
        recordRecent: true,
        promotePreview: true,
      });
      setBanner({
        tone: 'info',
        message: t('codePane.fileCreated', {
          path: getRelativePath(rootPath, response.data.path) || getPathLeafLabel(response.data.path) || response.data.path,
        }),
        filePath: response.data.path,
      });
      return true;
    }

    if (pathMutationDialog.mode === 'create-folder') {
      const nextDirectoryPath = buildChildPath(pathMutationDialog.targetPath, pathMutationDialog.entryType, nextInput);
      const parentDirectoryPath = getParentDirectory(nextDirectoryPath);
      const suppressedPaths = suppressExternalChangesForPaths([nextDirectoryPath]);
      const response = await window.electronAPI.codePaneCreateDirectory({
        rootPath,
        directoryPath: nextDirectoryPath,
      });

      if (!response.success || !response.data) {
        for (const filePath of suppressedPaths) {
          suppressedExternalChangePathsRef.current.delete(filePath);
        }
        setBanner({
          tone: 'error',
          message: response.error || t('common.retry'),
        });
        return false;
      }

      await revealPathInExplorer(response.data.path, { showSidebar: true });
      await refreshDirectoryPaths([parentDirectoryPath, response.data.path], {
        showLoadingIndicator: false,
      });
      setBanner({
        tone: 'info',
        message: t('codePane.folderCreated', {
          path: getRelativePath(rootPath, response.data.path) || getPathLeafLabel(response.data.path) || response.data.path,
        }),
        filePath: response.data.path,
      });
      return true;
    }

    const targetPath = pathMutationDialog.targetPath;
    const nextPath = replacePathLeaf(targetPath, nextInput);
    const affectedOpenFilePaths: string[] = [];
    for (const filePath of fileModelsRef.current.keys()) {
      if (isPathEqualOrDescendant(filePath, targetPath)) {
        affectedOpenFilePaths.push(filePath);
      }
    }
    const affectedDirtyFiles: string[] = [];
    for (const filePath of dirtyPathsRef.current) {
      if (isPathEqualOrDescendant(filePath, targetPath)) {
        affectedDirtyFiles.push(filePath);
      }
    }
    if (affectedDirtyFiles.length > 0) {
      const didFlush = await flushDirtyFiles(affectedDirtyFiles);
      if (!didFlush) {
        setBanner({
          tone: 'warning',
          message: t('codePane.renamePathBlockedByUnsaved'),
          filePath: targetPath,
        });
        return false;
      }
    }

    const directoriesToRefresh = new Set<string>([
      getParentDirectory(targetPath),
      getParentDirectory(nextPath),
    ]);
    if (pathMutationDialog.entryType === 'directory') {
      directoriesToRefresh.add(nextPath);
    }
    const suppressedPaths = suppressExternalChangesForPaths([targetPath, nextPath]);
    const response = await window.electronAPI.codePaneRenamePath({
      rootPath,
      sourcePath: targetPath,
      targetPath: nextPath,
    });

    if (!response.success || !response.data) {
      for (const filePath of suppressedPaths) {
        suppressedExternalChangePathsRef.current.delete(filePath);
      }
      setBanner({
        tone: 'error',
        message: response.error || t('common.retry'),
        filePath: targetPath,
      });
      return false;
    }

    for (const filePath of affectedOpenFilePaths) {
      await closeLanguageDocument(filePath);
    }
    updateReferencesForRenamedPath(targetPath, response.data.path);
    for (const filePath of affectedOpenFilePaths) {
      const renamedFilePath = replacePathPrefix(filePath, targetPath, response.data.path);
      await queueLanguageDocumentSync(renamedFilePath, 'open', async () => {
        await syncLanguageDocument(renamedFilePath, 'open');
      });
    }
    await revealPathInExplorer(response.data.path, { showSidebar: true });
    await refreshDirectoryPaths(directoriesToRefresh, {
      showLoadingIndicator: false,
    });
    if (response.data.type === 'file') {
      await activateFile(response.data.path, {
        recordRecent: true,
        promotePreview: true,
      });
    }
    setBanner({
      tone: 'info',
      message: t('codePane.pathRenamed', {
        path: getRelativePath(rootPath, response.data.path) || getPathLeafLabel(response.data.path) || response.data.path,
      }),
      filePath: response.data.path,
    });
    return true;
  }, [
    activateFile,
    buildChildPath,
    closeLanguageDocument,
    flushDirtyFiles,
    pathMutationDialog,
    refreshDirectoryPaths,
    revealPathInExplorer,
    rootPath,
    suppressExternalChangesForPaths,
    syncLanguageDocument,
    t,
    updateReferencesForRenamedPath,
  ]);

  const handlePathMutationConfirm = useCallback(async (nextInput: string) => {
    setIsSubmittingPathMutation((currentSubmitting) => (currentSubmitting ? currentSubmitting : true));
    try {
      const didSucceed = await submitPathMutation(nextInput);
      if (didSucceed) {
        setPathMutationDialog((currentDialog) => (currentDialog === null ? currentDialog : null));
      }
      return didSucceed;
    } finally {
      setIsSubmittingPathMutation((currentSubmitting) => (currentSubmitting ? false : currentSubmitting));
    }
  }, [submitPathMutation]);

  const createExplorerFile = useCallback(async (
    targetPath: string,
    entryType: CodePaneTreeEntry['type'],
  ) => {
    openPathMutationDialog(targetPath, entryType, 'create-file');
  }, [openPathMutationDialog]);

  const createExplorerDirectory = useCallback(async (
    targetPath: string,
    entryType: CodePaneTreeEntry['type'],
  ) => {
    openPathMutationDialog(targetPath, entryType, 'create-folder');
  }, [openPathMutationDialog]);

  const renameExplorerPath = useCallback(async (
    targetPath: string,
    entryType: CodePaneTreeEntry['type'],
  ) => {
    openPathMutationDialog(targetPath, entryType, 'rename');
  }, [openPathMutationDialog]);

  const openFileInSplit = useCallback(async (filePath: string) => {
    const loadedModel = fileModelsRef.current.get(filePath) ?? await loadFileIntoModel(filePath);
    if (!loadedModel) {
      return;
    }

    updateOpenFileTabs((currentOpenFiles) => upsertOpenFileTab(currentOpenFiles, filePath, {
      promote: true,
    }));
    persistEditorSplitLayout({
      visible: true,
      secondaryFilePath: filePath,
    });
  }, [loadFileIntoModel, persistEditorSplitLayout, updateOpenFileTabs]);

  const toggleEditorSplit = useCallback(async () => {
    if (isEditorSplitVisible) {
      persistEditorSplitLayout({
        visible: false,
      });
      return;
    }

    const targetFilePath = secondaryFilePathRef.current ?? activeFilePathRef.current;
    if (!targetFilePath) {
      return;
    }

    await openFileInSplit(targetFilePath);
  }, [isEditorSplitVisible, openFileInSplit, persistEditorSplitLayout]);

  const loadTodoEntries = useCallback(async () => {
    const requestKey = `todo-scan:${rootPath}`;
    const requestVersion = runtimeStoreRef.current.markLatest(requestKey);
    const cachedTodoItems = runtimeStoreRef.current.getCache<CodePaneTodoItem[]>(
      requestKey,
      CODE_PANE_TOOL_WINDOW_CACHE_TTL_MS,
    );
    if (cachedTodoItems) {
      runtimeStoreRef.current.recordRequest(requestKey, t('codePane.requestTodoScan'), {
        meta: rootPath,
        fromCache: true,
      });
      setTodoItems((currentItems) => (
        areTodoItemListsEqual(currentItems, cachedTodoItems) ? currentItems : cachedTodoItems
      ));
      setTodoError((currentError) => (currentError === null ? currentError : null));
      setIsTodoLoading((currentLoading) => (currentLoading ? false : currentLoading));
      return;
    }

    setIsTodoLoading((currentLoading) => (currentLoading ? currentLoading : true));
    setTodoError((currentError) => (currentError === null ? currentError : null));

    const responses = await trackRequest(
      requestKey,
      t('codePane.requestTodoScan'),
      rootPath,
      async () => await dedupeProjectRequest(
        rootPath,
        'todo-scan:all',
        async () => await Promise.all(CODE_PANE_TODO_TOKENS.map(async (token) => ({
          token,
          response: await trackRequest(
            `todo-scan:${rootPath}:${token}`,
            t('codePane.requestTodoScan'),
            token,
            async () => await dedupeProjectRequest(
              rootPath,
              `todo-token:${token}`,
              async () => await window.electronAPI.codePaneSearchContents({
                rootPath,
                query: token,
                limit: 120,
                maxMatchesPerFile: 20,
              }),
            ),
          ),
        }))),
      ),
    );

    const todoItemsByKey = new Map<string, CodePaneTodoItem>();
    for (const { token, response } of responses) {
      if (!response.success) {
        continue;
      }

      for (const item of response.data ?? []) {
        if (!item.lineText.toUpperCase().includes(token)) {
          continue;
        }

        const itemKey = `${token}:${item.filePath}:${item.lineNumber}:${item.column}`;
        if (!todoItemsByKey.has(itemKey)) {
          todoItemsByKey.set(itemKey, {
            ...item,
            token,
          });
        }
      }
    }

    const nextTodoItems: CodePaneTodoItem[] = [];
    for (const item of todoItemsByKey.values()) {
      nextTodoItems.push(item);
    }
    nextTodoItems.sort((left, right) => {
      const pathOrder = left.filePath.localeCompare(right.filePath);
      if (pathOrder !== 0) {
        return pathOrder;
      }
      if (left.lineNumber !== right.lineNumber) {
        return left.lineNumber - right.lineNumber;
      }
      return left.column - right.column;
    });

    let firstError: string | null = null;
    for (const { response } of responses) {
      if (!response.success) {
        firstError = response.error ?? null;
        break;
      }
    }
    if (!runtimeStoreRef.current.isLatest(requestKey, requestVersion)) {
      return;
    }
    if (firstError === null) {
      runtimeStoreRef.current.setCache(requestKey, nextTodoItems);
    }
    setTodoItems((currentItems) => (
      areTodoItemListsEqual(currentItems, nextTodoItems) ? currentItems : nextTodoItems
    ));
    setTodoError((currentError) => (currentError === firstError ? currentError : firstError));
    setIsTodoLoading((currentLoading) => (currentLoading ? false : currentLoading));
  }, [rootPath, t, trackRequest]);

  const toggleBookmarkAtCursor = useCallback(() => {
    const context = getActiveEditorContext();
    if (!context) {
      return;
    }

    const bookmarkId = `${context.filePath}:${context.position.lineNumber}`;
    const currentBookmarks = paneRef.current.code?.bookmarks ?? bookmarks;
    let hasBookmark = false;
    const nextBookmarks: typeof currentBookmarks = [];
    for (const bookmark of currentBookmarks) {
      if (bookmark.id === bookmarkId) {
        hasBookmark = true;
        continue;
      }
      nextBookmarks.push(bookmark);
    }
    if (!hasBookmark) {
      nextBookmarks.unshift({
        id: bookmarkId,
        filePath: context.filePath,
        lineNumber: context.position.lineNumber,
        column: context.position.column,
        label: getPathLeafLabel(context.filePath) || context.filePath,
        createdAt: new Date().toISOString(),
      });
      nextBookmarks.sort((left, right) => {
        const pathOrder = left.filePath.localeCompare(right.filePath);
        return pathOrder !== 0 ? pathOrder : left.lineNumber - right.lineNumber;
      });
    }

    persistCodeState({
      bookmarks: nextBookmarks,
    });
  }, [bookmarks, getActiveEditorContext, persistCodeState]);

  const restoreLocalHistoryEntry = useCallback(async (entryId: string) => {
    let entry: LocalHistoryEntry | null = null;
    for (const entries of localHistoryEntriesRef.current.values()) {
      for (const candidate of entries) {
        if (candidate.id === entryId) {
          entry = candidate;
          break;
        }
      }
      if (entry) {
        break;
      }
    }
    if (!entry) {
      return;
    }

    const model = fileModelsRef.current.get(entry.filePath) ?? await loadFileIntoModel(entry.filePath);
    if (!model) {
      return;
    }

    addLocalHistoryEntry(entry.filePath, 'restore', model.getValue());
    suppressModelEventsRef.current.add(entry.filePath);
    model.setValue(entry.content);
    suppressModelEventsRef.current.delete(entry.filePath);
    clearDefinitionLookupCache();
    markDirty(entry.filePath, true);
    await queueLanguageDocumentSync(entry.filePath, 'change', async () => {
      await syncLanguageDocument(entry.filePath, 'change');
    });
    await activateFile(entry.filePath, {
      recordRecent: true,
      promotePreview: true,
    });
  }, [
    activateFile,
    addLocalHistoryEntry,
    clearDefinitionLookupCache,
    loadFileIntoModel,
    markDirty,
    queueLanguageDocumentSync,
    syncLanguageDocument,
  ]);

  const buildConsolidatedFsChanges = useCallback((changes: CodePaneFsChange[]) => {
    const nextChangesByPath = new Map<string, CodePaneFsChange>();

    for (const change of changes) {
      const normalizedPath = normalizePath(change.path);
      const normalizedChange = normalizedPath === change.path
        ? change
        : {
            ...change,
            path: normalizedPath,
          };
      const existingChange = nextChangesByPath.get(normalizedPath);
      if (!existingChange) {
        nextChangesByPath.set(normalizedPath, normalizedChange);
        continue;
      }

      if (normalizedChange.type === 'unlinkDir' || existingChange.type === 'unlinkDir') {
        nextChangesByPath.set(normalizedPath, {
          ...normalizedChange,
          type: 'unlinkDir',
        });
        continue;
      }

      if (normalizedChange.type === 'unlink' || existingChange.type === 'unlink') {
        const nextType = normalizedChange.type === 'add' || existingChange.type === 'add'
          ? 'change'
          : 'unlink';
        nextChangesByPath.set(normalizedPath, {
          ...normalizedChange,
          type: nextType,
        });
        continue;
      }

      if (normalizedChange.type === 'addDir' || existingChange.type === 'addDir') {
        nextChangesByPath.set(normalizedPath, {
          ...normalizedChange,
          type: 'addDir',
        });
        continue;
      }

      if (normalizedChange.type === 'add' || existingChange.type === 'add') {
        nextChangesByPath.set(normalizedPath, {
          ...normalizedChange,
          type: 'add',
        });
        continue;
      }

      nextChangesByPath.set(normalizedPath, normalizedChange);
    }

    return [...nextChangesByPath.values()];
  }, []);

  const shouldFlushFsChangesImmediately = useCallback((changes: CodePaneFsChange[]) => {
    for (const change of changes) {
      if (change.type === 'unlink' || change.type === 'unlinkDir') {
        return true;
      }
    }
    return false;
  }, []);

  const flushPendingFsChanges = useCallback(() => {
    isFsChangeFlushQueuedRef.current = false;
    if (fsChangeFlushTimerRef.current) {
      window.clearTimeout(fsChangeFlushTimerRef.current);
      fsChangeFlushTimerRef.current = null;
    }

    const pendingChanges = buildConsolidatedFsChanges(pendingFsChangesRef.current);
    pendingFsChangesRef.current = [];
    if (pendingChanges.length === 0) {
      return;
    }

    for (const change of pendingChanges) {
      invalidateWorkspaceRuntimeCaches(change.path);
    }

    pruneRemovedDirectoriesRef.current(pendingChanges);

    const pendingChangeRequests: Array<Promise<ExternalChangeEntry | null>> = [];
    for (const change of pendingChanges) {
      pendingChangeRequests.push(recordExternalChangeRef.current(change, { commit: false }));
    }

    void Promise.all(pendingChangeRequests).then((entries) => {
      const mergedEntries: ExternalChangeEntry[] = [];
      for (const entry of entries) {
        if (entry) {
          mergedEntries.push(entry);
        }
      }
      if (mergedEntries.length > 0) {
        updateExternalChangeEntries(mergedEntries);
      }
    });

    const directoriesToRefresh = collectDirectoryRefreshPaths(
      rootPath,
      pendingChanges,
      loadedDirectoriesRef.current,
    );

    void refreshDirectoryPathsRef.current(directoriesToRefresh, {
      showLoadingIndicator: false,
    });
  }, [buildConsolidatedFsChanges, invalidateWorkspaceRuntimeCaches, rootPath, updateExternalChangeEntries]);

  useEffect(() => {
    flushPendingFsChangesRef.current = flushPendingFsChanges;
  }, [flushPendingFsChanges]);

  useEffect(() => {
    let mounted = true;

    const handleFsChanged = (_event: unknown, payload: CodePaneFsChangedPayload) => {
      if (getPathComparisonKey(payload.rootPath) !== getPathComparisonKey(rootPath)) {
        return;
      }

      if (payload.changes.length > 0) {
        pendingFsChangesRef.current.push(...payload.changes);
      }

      if (shouldFlushFsChangesImmediately(payload.changes)) {
        flushPendingFsChanges();
        return;
      }

      if (isFsChangeFlushQueuedRef.current) {
        return;
      }

      isFsChangeFlushQueuedRef.current = true;
      fsChangeFlushTimerRef.current = window.setTimeout(() => {
        fsChangeFlushTimerRef.current = null;
        flushPendingFsChanges();
      }, CODE_PANE_FS_CHANGE_FLUSH_DELAY_MS);
    };

    const handleIndexProgress = (_event: unknown, payload: CodePaneIndexProgressPayload) => {
      if (payload.paneId !== pane.id) {
        return;
      }

      startTransition(() => {
        if (payload.state === 'ready') {
          setIndexStatus((currentStatus) => (currentStatus === null ? currentStatus : null));
          return;
        }

        setIndexStatus((currentStatus) => (
          areIndexStatusesEqual(currentStatus, payload) ? currentStatus : payload
        ));
      });
    };

    const handleLanguageWorkspaceChanged = (
      _event: unknown,
      payload: CodePaneLanguageWorkspaceChangedPayload,
    ) => {
      if (!matchesLanguageWorkspaceRoot(rootPath, payload.state)) {
        return;
      }

      startTransition(() => {
        setLanguageWorkspaceState((currentState) => (
          areLanguageWorkspaceStatesEqual(currentState, payload.state) ? currentState : payload.state
        ));
      });
    };

    window.electronAPI.onCodePaneFsChanged(handleFsChanged);
    window.electronAPI.onCodePaneIndexProgress(handleIndexProgress);
    window.electronAPI.onCodePaneLanguageWorkspaceChanged(handleLanguageWorkspaceChanged);

    const bootstrap = async () => {
      const initialExpandedDirectories = createExpandedDirectorySet(
        rootPath,
        paneRef.current.code?.expandedPaths,
      );

      setIsBootstrapping(true);
      setBanner((currentBanner) => (currentBanner === null ? currentBanner : null));
      setTreeLoadError((currentError) => (currentError === null ? currentError : null));
      setSearchError((currentError) => (currentError === null ? currentError : null));
      compactDirectoryPresentationsCacheRef.current.clear();
      setTreeEntriesByDirectory((currentEntries) => (
        Object.keys(currentEntries).length === 0 ? currentEntries : {}
      ));
      setExternalEntriesByDirectory((currentEntries) => (
        Object.keys(currentEntries).length === 0 ? currentEntries : {}
      ));
      setExternalLibrariesError((currentError) => (currentError === null ? currentError : null));
      resetExternalLibrarySectionsRef.current(getExternalLibraryCache(rootPath) ?? []);
      setIndexStatus((currentStatus) => (currentStatus === null ? currentStatus : null));
      setLanguageWorkspaceState((currentState) => (currentState === null ? currentState : null));
      setExpandedDirectories((currentDirectories) => (
        areStringSetsEqual(currentDirectories, initialExpandedDirectories)
          ? currentDirectories
          : initialExpandedDirectories
      ));
      setLoadedDirectories((currentDirectories) => (
        currentDirectories.size === 0 ? currentDirectories : new Set()
      ));
      setLoadedExternalDirectories((currentDirectories) => (
        currentDirectories.size === 0 ? currentDirectories : new Set()
      ));
      setLoadingDirectories((currentDirectories) => (
        currentDirectories.size === 1 && currentDirectories.has(rootPath)
          ? currentDirectories
          : new Set([rootPath])
      ));
      setLoadingExternalDirectories((currentDirectories) => (
        currentDirectories.size === 0 ? currentDirectories : new Set()
      ));
      searchEverywhereControllerRef.current?.close();
      codeActionMenuControllerRef.current?.close();
      setBottomPanelMode((currentMode) => (currentMode === null ? currentMode : null));
      setRunTargets((currentTargets) => (currentTargets.length === 0 ? currentTargets : []));
      setIsRunTargetsLoading((currentLoading) => (currentLoading ? false : currentLoading));
      setRunTargetsError((currentError) => (currentError === null ? currentError : null));
      setTestItems((currentItems) => (currentItems.length === 0 ? currentItems : []));
      setIsTestsLoading((currentLoading) => (currentLoading ? false : currentLoading));
      setTestsError((currentError) => (currentError === null ? currentError : null));
      setProjectContributions((currentContributions) => (
        currentContributions.length === 0 ? currentContributions : []
      ));
      setIsProjectLoading((currentLoading) => (currentLoading ? false : currentLoading));
      setProjectError((currentError) => (currentError === null ? currentError : null));
      setGitBranches((currentBranches) => (currentBranches.length === 0 ? currentBranches : []));
      setSelectedGitBranchName((currentBranchName) => (currentBranchName === null ? currentBranchName : null));
      setSelectedGitLogCommitSha((currentCommitSha) => (currentCommitSha === null ? currentCommitSha : null));
      setSelectedGitCommitOrder((currentOrder) => (currentOrder.length === 0 ? currentOrder : []));
      setSelectedGitCommitDetails((currentDetails) => (currentDetails === null ? currentDetails : null));
      setComparedGitCommits((currentComparison) => (currentComparison === null ? currentComparison : null));
      setIsGitCommitDetailsLoading((currentLoading) => (currentLoading ? false : currentLoading));
      setGitCommitDetailsError((currentError) => (currentError === null ? currentError : null));
      setIsGitBranchesLoading((currentLoading) => (currentLoading ? false : currentLoading));
      setGitBranchesError((currentError) => (currentError === null ? currentError : null));
      setGitRebasePlan((currentPlan) => (currentPlan === null ? currentPlan : null));
      setGitRebaseBaseRef((currentBaseRef) => (currentBaseRef === '' ? currentBaseRef : ''));
      setIsGitRebaseLoading((currentLoading) => (currentLoading ? false : currentLoading));
      setGitRebaseError((currentError) => (currentError === null ? currentError : null));
      setSelectedGitChangePath((currentPath) => (currentPath === null ? currentPath : null));
      setGitStagedHunks((currentHunks) => (currentHunks.length === 0 ? currentHunks : []));
      setGitUnstagedHunks((currentHunks) => (currentHunks.length === 0 ? currentHunks : []));
      setIsGitHunksLoading((currentLoading) => (currentLoading ? false : currentLoading));
      setGitHunksError((currentError) => (currentError === null ? currentError : null));
      setRunSessions((currentSessions) => (currentSessions.length === 0 ? currentSessions : []));
      runSessionOutputsRef.current = {};
      debugSessionOutputsRef.current = {};
      setSelectedRunSessionOutput((currentOutput) => (currentOutput === '' ? currentOutput : ''));
      setSelectedDebugSessionOutput((currentOutput) => (currentOutput === '' ? currentOutput : ''));
      setSelectedRunSessionId((currentSessionId) => (
        currentSessionId === null ? currentSessionId : null
      ));
      setPendingGitRevisionDiff((currentDiff) => (currentDiff === null ? currentDiff : null));
      applyExternalChangeState([], null);
      recentFilesRef.current = [];
      recentLocationsRef.current = [];
      navigationBackStackRef.current = [];
      navigationForwardStackRef.current = [];
      navigationStoreRef.current.setSnapshot({
        recentFiles: [],
        recentLocations: [],
        canNavigateBack: false,
        canNavigateForward: false,
      });
      const cachedRootEntries = getDirectoryCache(rootPath, rootPath);
      const cachedExpandedDirectoryEntries: Record<string, CodePaneTreeEntry[]> = {};
      const cachedDirectoryPaths = new Set<string>();
      if (cachedRootEntries) {
        cachedDirectoryPaths.add(rootPath);
      }
      for (const directoryPath of initialExpandedDirectories) {
        if (directoryPath === rootPath) {
          continue;
        }

        const cachedEntries = getDirectoryCache(rootPath, directoryPath);
        if (Array.isArray(cachedEntries)) {
          cachedExpandedDirectoryEntries[directoryPath] = cachedEntries;
          cachedDirectoryPaths.add(directoryPath);
        }
      }
      const cachedGitStatusEntries = getGitStatusCache(rootPath) ?? [];
      const cachedGitSummary = getGitSummaryCache(rootPath);
      const cachedGitGraph = getGitGraphCache(rootPath) ?? [];
      applyGitSnapshotRef.current(cachedGitStatusEntries, cachedGitSummary, cachedGitGraph, {
        includeGraph: true,
      });
      disposeEditorsRef.current();
      disposeAllModelsRef.current();

      if (cachedRootEntries) {
        startTransition(() => {
          const nextTreeEntriesByDirectory = {
            [rootPath]: cachedRootEntries,
            ...cachedExpandedDirectoryEntries,
          };
          compactDirectoryPresentationsCacheRef.current.clear();
          setTreeEntriesByDirectory((currentEntries) => (
            areTreeEntriesByDirectoryEqual(currentEntries, nextTreeEntriesByDirectory)
              ? currentEntries
              : nextTreeEntriesByDirectory
          ));
          setLoadedDirectories((currentDirectories) => (
            areStringSetsEqual(currentDirectories, cachedDirectoryPaths)
              ? currentDirectories
              : new Set(cachedDirectoryPaths)
          ));
          setLoadingDirectories((currentDirectories) => (
            currentDirectories.size === 0 ? currentDirectories : new Set()
          ));
        });
        setIsBootstrapping((currentBootstrapping) => (currentBootstrapping ? false : currentBootstrapping));
      }

      try {
        if (supportsMonaco) {
          void ensureMonacoEnvironment(language)
            .then((monaco) => {
              if (!mounted) {
                return;
              }

              monacoRef.current = monaco;
              languageBridgeRef.current = ensureMonacoLanguageBridge(monaco);
              ensureMarkerListenerRef.current(monaco);
            })
            .catch(() => {});
        }

        void window.electronAPI.codePaneWatchRoot({
          paneId: pane.id,
          rootPath,
        }).then((response) => {
          if (!mounted || response.success) {
            return;
          }

          const nextIndexStatus: CodePaneIndexStatus = {
            paneId: pane.id,
            rootPath,
            state: 'error',
            processedDirectoryCount: 0,
            totalDirectoryCount: 0,
            indexedFileCount: 0,
            reusedPersistedIndex: false,
            error: response.error || t('codePane.indexingFailed'),
          };
          setIndexStatus((currentStatus) => (
            areIndexStatusesEqual(currentStatus, nextIndexStatus) ? currentStatus : nextIndexStatus
          ));
        }).catch((error) => {
          if (!mounted) {
            return;
          }

          const nextIndexStatus: CodePaneIndexStatus = {
            paneId: pane.id,
            rootPath,
            state: 'error',
            processedDirectoryCount: 0,
            totalDirectoryCount: 0,
            indexedFileCount: 0,
            reusedPersistedIndex: false,
            error: error instanceof Error ? error.message : t('codePane.indexingFailed'),
          };
          setIndexStatus((currentStatus) => (
            areIndexStatusesEqual(currentStatus, nextIndexStatus) ? currentStatus : nextIndexStatus
          ));
        });

        const nestedExpandedDirectories: string[] = [];
        for (const directoryPath of initialExpandedDirectories) {
          if (directoryPath !== rootPath) {
            nestedExpandedDirectories.push(directoryPath);
          }
        }
        if (nestedExpandedDirectories.length > 0) {
          const loadRequests: Array<Promise<CodePaneTreeEntry[]>> = [];
          for (const directoryPath of nestedExpandedDirectories) {
            loadRequests.push(loadDirectoryRef.current(directoryPath, {
              showLoadingIndicator: getDirectoryCache(rootPath, directoryPath) === null,
            }));
          }
          void Promise.all(loadRequests)
            .catch(() => {});
        }

        const rootEntries = await loadDirectoryRef.current(rootPath, {
          showLoadingIndicator: cachedRootEntries === null,
        });

        if (!mounted) {
          return;
        }

        if (mounted && cachedRootEntries === null) {
          setIsBootstrapping((currentBootstrapping) => (currentBootstrapping ? false : currentBootstrapping));
        }

        void refreshProjectBootstrapCachesRef.current().catch((error) => {
          if (mounted) {
            setExternalLibrariesError(error instanceof Error ? error.message : t('common.retry'));
          }
        });
        void attachLanguageWorkspaceRef.current(rootEntries).catch(() => {});
      } catch (error) {
        if (mounted) {
          setBanner({
            tone: 'error',
            message: error instanceof Error ? error.message : t('common.retry'),
          });
        }
      }

      if (mounted && isBootstrapping) {
        setIsBootstrapping((currentBootstrapping) => (currentBootstrapping ? false : currentBootstrapping));
      }
    };

    void bootstrap();

    return () => {
      mounted = false;
      window.electronAPI.offCodePaneFsChanged(handleFsChanged);
      window.electronAPI.offCodePaneIndexProgress(handleIndexProgress);
      window.electronAPI.offCodePaneLanguageWorkspaceChanged(handleLanguageWorkspaceChanged);
      if (isFsChangeFlushQueuedRef.current) {
        isFsChangeFlushQueuedRef.current = false;
        flushPendingFsChangesRef.current();
      }
      void window.electronAPI.codePaneUnwatchRoot(pane.id);
      void window.electronAPI.codePaneDetachLanguageWorkspace(pane.id);
      markerListenerRef.current?.dispose();
      markerListenerRef.current = null;
      void flushDirtyFilesRef.current().finally(() => {
        void closeAllLanguageDocumentsRef.current().finally(() => {
          disposeEditorsRef.current();
          disposeAllModelsRef.current();
        });
      });
    };
  }, [
    applyExternalChangeState,
    pane.id,
    language,
    rootPath,
    supportsMonaco,
    t,
  ]);

  useEffect(() => {
    if (!isSidebarVisible || sidebarMode !== 'scm') {
      return undefined;
    }

    if (getGitStatusCache(rootPath) === null || getGitSummaryCache(rootPath) === null) {
      scheduleGitStatusRefresh();
    }

    const refreshInterval = window.setInterval(() => {
      if (!document.hidden) {
        scheduleGitStatusRefresh();
      }
    }, 5000);

    return () => {
      window.clearInterval(refreshInterval);
    };
  }, [isSidebarVisible, scheduleGitStatusRefresh, sidebarMode]);

  useEffect(() => {
    const availableCommitShas = new Set<string>();
    for (const commit of gitGraph) {
      availableCommitShas.add(commit.sha);
    }

    const normalizedSelectedOrder: string[] = [];
    for (const commitSha of selectedGitCommitOrder) {
      if (availableCommitShas.has(commitSha)) {
        normalizedSelectedOrder.push(commitSha);
      }
    }
    if (normalizedSelectedOrder.length !== selectedGitCommitOrder.length) {
      setSelectedGitCommitOrder(normalizedSelectedOrder);
      return;
    }

    if (normalizedSelectedOrder.length >= 2) {
      void compareSelectedGitCommits(normalizedSelectedOrder[0]!, normalizedSelectedOrder[1]!);
      return;
    }

    const commitShaToLoad = normalizedSelectedOrder[0] ?? selectedGitLogCommitSha;
    if (!commitShaToLoad) {
      setSelectedGitCommitDetails((currentDetails) => (currentDetails === null ? currentDetails : null));
      setComparedGitCommits((currentComparison) => (currentComparison === null ? currentComparison : null));
      setGitCommitDetailsError((currentError) => (currentError === null ? currentError : null));
      setIsGitCommitDetailsLoading((currentLoading) => (currentLoading ? false : currentLoading));
      return;
    }

    void loadSelectedGitCommitDetails(commitShaToLoad);
  }, [
    compareSelectedGitCommits,
    gitGraph,
    loadSelectedGitCommitDetails,
    selectedGitCommitOrder,
    selectedGitLogCommitSha,
  ]);

  useEffect(() => {
    if (!activeFilePath) {
      void refreshEditorSurface();
      return;
    }

    let cancelled = false;
    const requestId = ++editorSurfaceRequestIdRef.current;
    const isCurrentRequest = () => !cancelled && requestId === editorSurfaceRequestIdRef.current;

    const syncActiveSurface = async () => {
      if (!isCurrentRequest()) {
        return;
      }
      const currentViewMode = paneRef.current.code?.viewMode ?? viewMode;
      const currentDiffTargetPath = paneRef.current.code?.diffTargetPath ?? diffTargetPath ?? activeFilePath;
      const currentSecondaryFilePath = secondaryFilePathRef.current;
      const loadedModel = fileModelsRef.current.get(activeFilePath) ?? await loadFileIntoModel(activeFilePath);
      if (!loadedModel || !isCurrentRequest()) {
        return;
      }

      if (currentViewMode === 'diff') {
        const pendingRevisionRequest = pendingGitRevisionDiff;
        const didEnsureDiffModel = pendingRevisionRequest && pendingRevisionRequest.filePath === activeFilePath
          ? await ensureRevisionDiffModel(pendingRevisionRequest, {
              showBanner: false,
            })
          : await ensureDiffModel(activeFilePath, {
              baseFilePath: currentDiffTargetPath,
              showBanner: false,
            });
        if (!isCurrentRequest()) {
          return;
        }
        if (!didEnsureDiffModel) {
          persistCodeState({
            viewMode: 'editor',
            diffTargetPath: null,
          });
        }
      }

      if (currentViewMode === 'editor' && isEditorSplitVisible && currentSecondaryFilePath && currentSecondaryFilePath !== activeFilePath) {
        await loadFileIntoModel(currentSecondaryFilePath);
        if (!isCurrentRequest()) {
          return;
        }
      }

      await refreshEditorSurface();
    };

    void syncActiveSurface();

    return () => {
      cancelled = true;
      if (editorSurfaceRequestIdRef.current === requestId) {
        editorSurfaceRequestIdRef.current += 1;
      }
    };
  }, [
    activeFilePath,
    diffTargetPath,
    ensureDiffModel,
    ensureRevisionDiffModel,
    isEditorSplitVisible,
    loadFileIntoModel,
    pendingGitRevisionDiff,
    persistCodeState,
    refreshEditorSurface,
    secondaryFilePath,
    viewMode,
  ]);

  useEffect(() => {
    if (!isActive) {
      return;
    }

    editorRef.current?.focus();
    diffEditorRef.current?.getModifiedEditor().focus();
  }, [isActive]);

  const getCurrentNavigationLocation = useCallback((): NavigationHistoryEntry | null => {
    const context = getActiveEditorContext();
    if (context) {
      return {
        filePath: context.filePath,
        lineNumber: context.position.lineNumber,
        column: context.position.column,
        displayPath: fileMetaRef.current.get(context.filePath)?.displayPath,
      };
    }

    const filePath = activeFilePathRef.current;
    if (!filePath) {
      return null;
    }

    return {
      filePath,
      lineNumber: 1,
      column: 1,
      displayPath: fileMetaRef.current.get(filePath)?.displayPath,
    };
  }, [getActiveEditorContext]);

  const rememberRecentLocation = useCallback((location: NavigationHistoryEntry) => {
    const nextRecentLocations = [location];
    for (const entry of recentLocationsRef.current) {
      if (!isSameNavigationLocation(entry, location)) {
        nextRecentLocations.push(entry);
        if (nextRecentLocations.length >= CODE_PANE_MAX_RECENT_LOCATIONS) {
          break;
        }
      }
    }
    recentLocationsRef.current = nextRecentLocations;
    navigationStoreRef.current.setSnapshot({
      recentLocations: nextRecentLocations,
    });
  }, []);

  const updateNavigationAvailability = useCallback(() => {
    const nextAvailability = {
      canNavigateBack: navigationBackStackRef.current.length > 0,
      canNavigateForward: navigationForwardStackRef.current.length > 0,
    };
    navigationStoreRef.current.setSnapshot(nextAvailability);
  }, []);

  const clearNavigationForwardStack = useCallback(() => {
    if (navigationForwardStackRef.current.length === 0) {
      return;
    }

    navigationForwardStackRef.current = [];
    updateNavigationAvailability();
  }, [updateNavigationAvailability]);

  const pushNavigationBackStack = useCallback((location: NavigationHistoryEntry) => {
    const currentBackStack = navigationBackStackRef.current;
    const lastBackLocation = currentBackStack[currentBackStack.length - 1];
    if (isSameNavigationLocation(lastBackLocation, location)) {
      return;
    }

    navigationBackStackRef.current = [
      ...currentBackStack,
      location,
    ].slice(-CODE_PANE_MAX_NAVIGATION_HISTORY);
    updateNavigationAvailability();
  }, [updateNavigationAvailability]);

  const openEditorLocation = useCallback(async (
    location: FileNavigationLocation,
    options?: {
      preserveTabs?: boolean;
      recordHistory?: boolean;
      recordRecent?: boolean;
      clearForward?: boolean;
    },
  ) => {
    if (options?.recordHistory !== false) {
      const currentLocation = getCurrentNavigationLocation();
      if (currentLocation && !isSameNavigationLocation(currentLocation, location)) {
        pushNavigationBackStack(currentLocation);
      }
    }

    if (options?.clearForward !== false) {
      clearNavigationForwardStack();
    }

    if (options?.recordRecent !== false) {
      rememberRecentLocation({
        filePath: location.filePath,
        lineNumber: location.lineNumber,
        column: location.column,
        displayPath: location.displayPath,
      });
    }

    if (typeof location.content === 'string') {
      preloadedReadResultsRef.current.set(location.filePath, {
        content: location.content,
        mtimeMs: 0,
        size: location.content.length,
        language: location.language ?? 'plaintext',
        isBinary: false,
        readOnly: location.readOnly,
        displayPath: location.displayPath,
        documentUri: location.documentUri,
      });
    }

    pendingNavigationRef.current = location;
    await activateFile(location.filePath, {
      recordRecent: options?.recordRecent,
      promotePreview: true,
    });
  }, [
    activateFile,
    clearNavigationForwardStack,
    getCurrentNavigationLocation,
    pushNavigationBackStack,
    rememberRecentLocation,
  ]);

  const getDisplayPath = useCallback((filePath: string) => (
    fileMetaRef.current.get(filePath)?.displayPath ?? filePath
  ), []);

  const getFileLabel = useCallback((filePath: string) => {
    const fileMeta = fileMetaRef.current.get(filePath);
    return getDecodedPathLeafLabel(fileMeta?.displayPath ?? fileMeta?.documentUri ?? filePath);
  }, []);

  const visibleLocalHistoryEntries = useMemo(() => {
    if (bottomPanelMode !== 'workspace') {
      return [];
    }

    const sourceEntries: LocalHistoryEntry[] = [];
    if (activeFilePath) {
      sourceEntries.push(...(localHistoryEntriesRef.current.get(activeFilePath) ?? []));
    } else {
      for (const entries of localHistoryEntriesRef.current.values()) {
        sourceEntries.push(...entries);
      }
    }

    sourceEntries.sort((left, right) => right.timestamp - left.timestamp);
    if (sourceEntries.length > 24) {
      sourceEntries.length = 24;
    }
    return sourceEntries;
  }, [activeFilePath, bottomPanelMode, localHistoryVersion]);

  const hasActivePerformanceTasks = isRunTargetsLoading
    || isTestsLoading
    || isProjectLoading
    || isDebugDetailsLoading
    || isTodoLoading
    || isGitHistoryLoading;

  const activePerformanceTasks = useMemo(() => {
    if (bottomPanelMode !== 'performance') {
      return [];
    }

    const nextTasks = [];

    if (isRunTargetsLoading) {
      nextTasks.push({
        id: 'run-targets',
        label: t('codePane.performanceTaskRunTargets'),
        detail: activeFilePath ? getRelativePath(rootPath, activeFilePath) : rootPath,
        status: 'running' as const,
      });
    }
    if (isTestsLoading) {
      nextTasks.push({
        id: 'tests',
        label: t('codePane.performanceTaskTests'),
        detail: activeFilePath ? getRelativePath(rootPath, activeFilePath) : rootPath,
        status: 'running' as const,
      });
    }
    if (isProjectLoading) {
      nextTasks.push({
        id: 'project',
        label: t('codePane.performanceTaskProject'),
        detail: rootPath,
        status: 'running' as const,
      });
    }
    if (isDebugDetailsLoading) {
      nextTasks.push({
        id: 'debug-details',
        label: t('codePane.performanceTaskDebugDetails'),
        detail: selectedDebugSessionId ?? 'session',
        status: 'running' as const,
      });
    }
    if (isTodoLoading) {
      nextTasks.push({
        id: 'todo',
        label: t('codePane.performanceTaskTodo'),
        detail: rootPath,
        status: 'running' as const,
      });
    }
    if (isGitHistoryLoading) {
      nextTasks.push({
        id: 'git-history',
        label: t('codePane.performanceTaskGitHistory'),
        detail: gitHistory?.targetFilePath ? getRelativePath(rootPath, gitHistory.targetFilePath) : rootPath,
        status: 'running' as const,
      });
    }

    return nextTasks;
  }, [
    activeFilePath,
    bottomPanelMode,
    gitHistory?.targetFilePath,
    isDebugDetailsLoading,
    isGitHistoryLoading,
    isProjectLoading,
    isRunTargetsLoading,
    isTestsLoading,
    isTodoLoading,
    rootPath,
    selectedDebugSessionId,
    t,
  ]);
  const activeFileReadOnly = activeFilePath ? Boolean(fileMetaRef.current.get(activeFilePath)?.readOnly) : false;
  const activeFileDisplayPath = activeFilePath ? getDisplayPath(activeFilePath) : null;
  const currentGitBranch = useMemo(
    () => getCurrentGitBranch(gitBranches, gitRepositorySummary?.currentBranch),
    [gitBranches, gitRepositorySummary?.currentBranch],
  );
  const indexStatusText = indexStatus?.state === 'building'
    ? t('codePane.indexingProgress', {
      processed: indexStatus.processedDirectoryCount,
      total: indexStatus.totalDirectoryCount,
      files: indexStatus.indexedFileCount,
    })
    : (indexStatus?.error || t('codePane.indexingFailed'));
  const languageStatusText = useMemo(() => {
    if (!languageWorkspaceState) {
      return null;
    }

    const languageLabel = formatLanguageLabel(languageWorkspaceState.languageId, t('codePane.languageUnknown'));
    const progressText = languageWorkspaceState.progressText || languageWorkspaceState.message;
    const fallbackPhaseLabel = formatWorkspacePhaseLabel(languageWorkspaceState.phase, t);

    switch (languageWorkspaceState.phase) {
      case 'idle':
        return null;
      case 'ready':
        return `${languageLabel}: ${fallbackPhaseLabel}`;
      case 'error':
        return progressText ? `${languageLabel}: ${progressText}` : `${languageLabel}: ${fallbackPhaseLabel}`;
      case 'importing-project':
      case 'indexing-workspace':
      case 'detecting-project':
      case 'starting-runtime':
      case 'starting':
      case 'degraded':
      default:
        return progressText ? `${languageLabel}: ${progressText}` : `${languageLabel}: ${fallbackPhaseLabel}`;
    }
  }, [languageWorkspaceState, t]);
    const languageStatusTone = useMemo(() => {
    if (!languageWorkspaceState) {
      return null;
    }

    if (languageWorkspaceState.phase === 'error') {
      return {
        className: 'bg-red-500/15 text-red-300',
        showSpinner: false,
      };
    }

    if (languageWorkspaceState.phase === 'ready') {
      return {
        className: 'bg-emerald-500/15 text-emerald-300',
        showSpinner: false,
      };
    }

    return {
      className: 'bg-amber-500/15 text-amber-300',
      showSpinner: true,
    };
  }, [languageWorkspaceState]);
  const activeExternalReview = useMemo<ExternalChangeReviewState | null>(() => {
    if (!activeFilePath || viewMode !== 'editor') {
      return null;
    }
    const entry = externalChangeStateRef.current.entriesByPath.get(activeFilePath) ?? null;
    if (!entry?.canDiff || entry.previousContent === null || entry.currentContent === null) {
      return null;
    }
    return {
      filePath: entry.filePath,
      beforeContent: entry.previousContent,
      afterContent: entry.currentContent,
    };
  }, [activeFilePath, externalChangeEntries, viewMode]);
  const gitStatusEntriesKey = useMemo(() => getGitStatusEntriesKey(gitStatusEntries), [gitStatusEntries]);
  const externalChangeEntriesKey = useMemo(() => getExternalChangeEntriesKey(externalChangeEntries), [externalChangeEntries]);
  const externalChangesByPath = externalChangeStateRef.current.entriesByPath;
  const sidebarEntries = treeEntriesByDirectory[rootPath] ?? [];
  const hasExternalLibraries = useMemo(() => {
    for (const section of externalLibrarySections) {
      if (section.roots.length > 0) {
        return true;
      }
    }
    return false;
  }, [externalLibrarySections]);
  const rootLabel = useMemo(() => getPathLeafLabel(rootPath) || rootPath, [rootPath]);
  const pathMutationLocationPath = useMemo(() => {
    if (!pathMutationDialog) {
      return '';
    }

    if (pathMutationDialog.mode === 'rename') {
      return getRelativePath(rootPath, getParentDirectory(pathMutationDialog.targetPath)) || rootLabel;
    }

    return getRelativePath(
      rootPath,
      getMutationParentDirectory(pathMutationDialog.targetPath, pathMutationDialog.entryType),
    ) || rootLabel;
  }, [getMutationParentDirectory, pathMutationDialog, rootLabel, rootPath]);
  const isRootExpanded = expandedDirectories.has(rootPath);
  const isRootSelected = selectedPath === rootPath;
  const orderedOpenFiles = useMemo(() => sortOpenFilesByPinned(openFiles), [openFiles]);
  const activeOpenFileTabIndex = useMemo(
    () => orderedOpenFiles.findIndex((tab) => tab.path === activeFilePath),
    [activeFilePath, orderedOpenFiles],
  );
  const windowedOpenFileTabs = useMemo(() => getWindowedInlineListSlice({
    items: orderedOpenFiles,
    scrollLeft: openFileTabsViewport.scrollLeft,
    viewportWidth: openFileTabsViewport.viewportWidth,
    itemWidth: CODE_PANE_OPEN_FILE_TAB_WIDTH,
    overscan: CODE_PANE_OPEN_FILE_TAB_OVERSCAN,
    threshold: CODE_PANE_OPEN_FILE_TAB_WINDOWING_THRESHOLD,
  }), [openFileTabsViewport.scrollLeft, openFileTabsViewport.viewportWidth, orderedOpenFiles]);
  const contextMenuContentClassName = ideMenuContentClassName;
  const contextMenuItemClassName = ideMenuItemClassName;
  const contextMenuDangerItemClassName = ideMenuDangerItemClassName;
  const contextMenuSubTriggerClassName = ideMenuSubTriggerClassName;
  const sidebarTabs = useMemo<SidebarTabItem[]>(() => ([
    {
      mode: 'files' as const,
      icon: FileCode2,
      label: t('codePane.filesTab'),
    },
    {
      mode: 'search' as const,
      icon: Search,
      label: t('codePane.searchTab'),
    },
    {
      mode: 'scm' as const,
      icon: GitBranch,
      label: t('codePane.scmTab'),
    },
    {
      mode: 'problems' as const,
      icon: AlertTriangle,
      label: t('codePane.problemsTab'),
    },
  ]), [t]);
  const scheduleSidebarWidthUpdate = useCallback((nextWidth: number) => {
    pendingSidebarWidthRef.current = nextWidth;
    if (sidebarResizeAnimationFrameRef.current !== null) {
      return;
    }

    sidebarResizeAnimationFrameRef.current = window.requestAnimationFrame(() => {
      sidebarResizeAnimationFrameRef.current = null;
      const pendingWidth = pendingSidebarWidthRef.current;
      pendingSidebarWidthRef.current = null;
      if (pendingWidth !== null) {
        applySidebarWidthPreview(pendingWidth);
        layoutEditorSurfaces();
      }
    });
  }, [applySidebarWidthPreview, layoutEditorSurfaces]);

  const scheduleOpenFileTabsViewportUpdate = useCallback((nextViewport: { scrollLeft: number; viewportWidth: number }) => {
    pendingOpenFileTabsViewportRef.current = nextViewport;
    if (openFileTabsScrollAnimationFrameRef.current !== null) {
      return;
    }

    openFileTabsScrollAnimationFrameRef.current = window.requestAnimationFrame(() => {
      openFileTabsScrollAnimationFrameRef.current = null;
      const pendingViewport = pendingOpenFileTabsViewportRef.current;
      pendingOpenFileTabsViewportRef.current = null;
      if (!pendingViewport) {
        return;
      }

      setOpenFileTabsViewport((currentViewport) => (
        currentViewport.scrollLeft === pendingViewport.scrollLeft
          && currentViewport.viewportWidth === pendingViewport.viewportWidth
          ? currentViewport
          : pendingViewport
      ));
    });
  }, []);

  useEffect(() => {
    const container = openFileTabsScrollRef.current;
    if (!container) {
      return undefined;
    }

    const syncViewport = () => {
      scheduleOpenFileTabsViewportUpdate({
        scrollLeft: container.scrollLeft,
        viewportWidth: container.clientWidth,
      });
    };

    syncViewport();

    const resizeObserver = new ResizeObserver(() => {
      syncViewport();
    });
    resizeObserver.observe(container);
    return () => {
      if (openFileTabsScrollAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(openFileTabsScrollAnimationFrameRef.current);
        openFileTabsScrollAnimationFrameRef.current = null;
      }
      resizeObserver.disconnect();
    };
  }, [scheduleOpenFileTabsViewportUpdate]);

  useEffect(() => {
    const container = openFileTabsScrollRef.current;
    if (!container || activeOpenFileTabIndex < 0) {
      return;
    }

    const tabStart = activeOpenFileTabIndex * CODE_PANE_OPEN_FILE_TAB_WIDTH;
    const tabEnd = tabStart + CODE_PANE_OPEN_FILE_TAB_WIDTH;
    if (tabStart < container.scrollLeft) {
      container.scrollLeft = tabStart;
      scheduleOpenFileTabsViewportUpdate({
        scrollLeft: container.scrollLeft,
        viewportWidth: container.clientWidth,
      });
      return;
    }

    const viewportEnd = container.scrollLeft + container.clientWidth;
    if (tabEnd > viewportEnd) {
      container.scrollLeft = Math.max(0, tabEnd - container.clientWidth);
      scheduleOpenFileTabsViewportUpdate({
        scrollLeft: container.scrollLeft,
        viewportWidth: container.clientWidth,
      });
    }
  }, [activeOpenFileTabIndex, scheduleOpenFileTabsViewportUpdate]);

  const scheduleEditorSplitSizeUpdate = useCallback((nextSize: number) => {
    pendingEditorSplitSizeRef.current = nextSize;
    if (editorSplitResizeAnimationFrameRef.current !== null) {
      return;
    }

    editorSplitResizeAnimationFrameRef.current = window.requestAnimationFrame(() => {
      editorSplitResizeAnimationFrameRef.current = null;
      const pendingSize = pendingEditorSplitSizeRef.current;
      pendingEditorSplitSizeRef.current = null;
      if (pendingSize !== null) {
        applyEditorSplitSizePreview(pendingSize);
        layoutEditorSurfaces();
      }
    });
  }, [applyEditorSplitSizePreview, layoutEditorSurfaces]);

  const scheduleBottomPanelResizeUpdate = useCallback((nextHeight: number, availableHeight: number) => {
    pendingBottomPanelResizeRef.current = {
      height: nextHeight,
      availableHeight,
    };
    if (bottomPanelResizeAnimationFrameRef.current !== null) {
      return;
    }

    bottomPanelResizeAnimationFrameRef.current = window.requestAnimationFrame(() => {
      bottomPanelResizeAnimationFrameRef.current = null;
      const pendingResize = pendingBottomPanelResizeRef.current;
      pendingBottomPanelResizeRef.current = null;
      if (!pendingResize) {
        return;
      }

      bottomPanelAvailableHeightRef.current = pendingResize.availableHeight;
      applyBottomPanelHeightPreview(pendingResize.height);
      layoutEditorSurfaces();
    });
  }, [applyBottomPanelHeightPreview, layoutEditorSurfaces]);

  const startSidebarResize = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    sidebarResizeCleanupRef.current?.();
    sidebarResizeStartRef.current = {
      startX: event.clientX,
      startWidth: sidebarWidthRef.current,
    };
    setIsSidebarResizing((currentResizing) => (currentResizing ? currentResizing : true));
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handleMouseMove = (nextEvent: MouseEvent) => {
      const resizeStart = sidebarResizeStartRef.current;
      if (!resizeStart) {
        return;
      }

      const nextWidth = clampSidebarWidth(resizeStart.startWidth + (nextEvent.clientX - resizeStart.startX));
      sidebarWidthRef.current = nextWidth;
      scheduleSidebarWidthUpdate(nextWidth);
    };

    const cleanup = () => {
      if (sidebarResizeAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(sidebarResizeAnimationFrameRef.current);
        sidebarResizeAnimationFrameRef.current = null;
      }
      pendingSidebarWidthRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      sidebarResizeCleanupRef.current = null;
    };

    const handleMouseUp = () => {
      const resizeStart = sidebarResizeStartRef.current;
      sidebarResizeStartRef.current = null;
      setIsSidebarResizing((currentResizing) => (currentResizing ? false : currentResizing));

      if (resizeStart) {
        const nextWidth = clampSidebarWidth(sidebarWidthRef.current);
        sidebarWidthRef.current = nextWidth;
        lastExpandedSidebarWidthRef.current = nextWidth;
        pendingSidebarWidthRef.current = null;
        setSidebarWidth(nextWidth);
        setLastExpandedSidebarWidth(nextWidth);
        applySidebarWidthPreview(nextWidth);
        persistSidebarLayout({
          visible: true,
          activeView: sidebarModeRef.current,
          width: nextWidth,
          lastExpandedWidth: nextWidth,
        });
      }

      cleanup();
    };

    sidebarResizeCleanupRef.current = cleanup;
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [persistSidebarLayout, scheduleSidebarWidthUpdate]);

  const resetSidebarWidth = useCallback(() => {
    const nextWidth = CODE_PANE_SIDEBAR_DEFAULT_WIDTH;
    sidebarWidthRef.current = nextWidth;
    lastExpandedSidebarWidthRef.current = nextWidth;
    setSidebarWidth(nextWidth);
    setLastExpandedSidebarWidth(nextWidth);
    persistSidebarLayout({
      visible: true,
      activeView: sidebarModeRef.current,
      width: nextWidth,
      lastExpandedWidth: nextWidth,
    });
  }, [persistSidebarLayout]);

  const startEditorSplitResize = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    editorSplitResizeCleanupRef.current?.();
    editorSplitResizeStartRef.current = {
      startX: event.clientX,
      startSize: editorSplitSizeRef.current,
    };
    setIsEditorSplitResizing((currentResizing) => (currentResizing ? currentResizing : true));
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handleMouseMove = (nextEvent: MouseEvent) => {
      const resizeStart = editorSplitResizeStartRef.current;
      const containerWidth = editorHostRef.current?.parentElement?.parentElement?.getBoundingClientRect().width ?? 0;
      if (!resizeStart || containerWidth <= 0) {
        return;
      }

      const nextSize = clampEditorSplitSize(
        resizeStart.startSize + ((nextEvent.clientX - resizeStart.startX) / containerWidth),
      );
      editorSplitSizeRef.current = nextSize;
      scheduleEditorSplitSizeUpdate(nextSize);
    };

    const cleanup = () => {
      if (editorSplitResizeAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(editorSplitResizeAnimationFrameRef.current);
        editorSplitResizeAnimationFrameRef.current = null;
      }
      pendingEditorSplitSizeRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      editorSplitResizeCleanupRef.current = null;
    };

    const handleMouseUp = () => {
      const resizeStart = editorSplitResizeStartRef.current;
      editorSplitResizeStartRef.current = null;
      setIsEditorSplitResizing((currentResizing) => (currentResizing ? false : currentResizing));

      if (resizeStart) {
        const nextSize = clampEditorSplitSize(editorSplitSizeRef.current);
        editorSplitSizeRef.current = nextSize;
        pendingEditorSplitSizeRef.current = null;
        setEditorSplitSize(nextSize);
        applyEditorSplitSizePreview(nextSize);
        persistEditorSplitLayout({
          visible: true,
          size: nextSize,
          secondaryFilePath: secondaryFilePathRef.current,
        });
      }

      cleanup();
    };

    editorSplitResizeCleanupRef.current = cleanup;
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [persistEditorSplitLayout, scheduleEditorSplitSizeUpdate]);

  const getBottomPanelAvailableHeightForLayout = useCallback(() => {
    return getBottomPanelAvailableHeight(
      workspaceLayoutRef.current?.getBoundingClientRect().height,
    );
  }, []);

  const resetBottomPanelHeight = useCallback(() => {
    const nextHeight = clampBottomPanelHeight(
      CODE_PANE_BOTTOM_PANEL_DEFAULT_HEIGHT,
      getBottomPanelAvailableHeightForLayout(),
    );

    bottomPanelHeightRef.current = nextHeight;
    setBottomPanelHeight(nextHeight);
    persistBottomPanelLayout({
      height: nextHeight,
    });
  }, [getBottomPanelAvailableHeightForLayout, persistBottomPanelLayout]);

  const startBottomPanelResize = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    bottomPanelResizeCleanupRef.current?.();
    const availableHeight = getBottomPanelAvailableHeightForLayout();
    const currentHeight = clampBottomPanelHeight(bottomPanelHeightRef.current, availableHeight);
    setBottomPanelAvailableHeight((currentAvailableHeight) => (
      currentAvailableHeight === availableHeight ? currentAvailableHeight : availableHeight
    ));
    bottomPanelHeightRef.current = currentHeight;
    setBottomPanelHeight(currentHeight);
    bottomPanelResizeStartRef.current = {
      startY: event.clientY,
      startHeight: currentHeight,
    };
    setIsBottomPanelResizing((currentResizing) => (currentResizing ? currentResizing : true));
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';

    const handleMouseMove = (nextEvent: MouseEvent) => {
      const resizeStart = bottomPanelResizeStartRef.current;
      if (!resizeStart) {
        return;
      }

      const currentAvailableHeight = getBottomPanelAvailableHeightForLayout();
      const nextHeight = clampBottomPanelHeight(
        resizeStart.startHeight - (nextEvent.clientY - resizeStart.startY),
        currentAvailableHeight,
      );
      bottomPanelHeightRef.current = nextHeight;
      scheduleBottomPanelResizeUpdate(nextHeight, currentAvailableHeight);
    };

    const cleanup = () => {
      if (bottomPanelResizeAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(bottomPanelResizeAnimationFrameRef.current);
        bottomPanelResizeAnimationFrameRef.current = null;
      }
      pendingBottomPanelResizeRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      bottomPanelResizeCleanupRef.current = null;
    };

    const handleMouseUp = () => {
      const resizeStart = bottomPanelResizeStartRef.current;
      bottomPanelResizeStartRef.current = null;
      setIsBottomPanelResizing((currentResizing) => (currentResizing ? false : currentResizing));

      if (resizeStart) {
        const nextHeight = clampBottomPanelHeight(
          bottomPanelHeightRef.current,
          getBottomPanelAvailableHeightForLayout(),
        );
        bottomPanelHeightRef.current = nextHeight;
        pendingBottomPanelResizeRef.current = null;
        setBottomPanelAvailableHeight((currentAvailableHeight) => (
          currentAvailableHeight === bottomPanelAvailableHeightRef.current
            ? currentAvailableHeight
            : bottomPanelAvailableHeightRef.current
        ));
        setBottomPanelHeight(nextHeight);
        applyBottomPanelHeightPreview(nextHeight);
        persistBottomPanelLayout({
          height: nextHeight,
        });
      }

      cleanup();
    };

    bottomPanelResizeCleanupRef.current = cleanup;
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [getBottomPanelAvailableHeightForLayout, persistBottomPanelLayout, scheduleBottomPanelResizeUpdate]);

  const renderFileContextMenu = useCallback((
    filePath: string,
    entryType: CodePaneTreeEntry['type'],
    options?: {
      allowDiff?: boolean;
      allowMutations?: boolean;
      allowGitActions?: boolean;
      pinned?: boolean;
      qualifiedName?: string | null;
      showPinToggle?: boolean;
    },
  ) => {
    const statusEntry = options?.allowGitActions === false ? undefined : gitStatusByPathRef.current[filePath];
    const canGitStage = Boolean(
      statusEntry && (statusEntry.unstaged || statusEntry.status === 'untracked' || statusEntry.status === 'added'),
    );
    const canGitUnstage = Boolean(statusEntry?.staged);
    const canGitRemove = Boolean(statusEntry && (statusEntry.status === 'untracked' || statusEntry.status === 'added'));
    const canGitRevert = Boolean(
      statusEntry && (statusEntry.unstaged || statusEntry.status === 'deleted' || statusEntry.status === 'modified' || statusEntry.status === 'renamed'),
    );

    return (
      <ContextMenu.Portal>
        <ContextMenu.Content
          className={contextMenuContentClassName}
        >
          <ContextMenu.Item
            className={contextMenuItemClassName}
            onSelect={() => {
              void revealPath(filePath, entryType);
            }}
          >
            <IdeMenuItemContent
              icon={<FolderOpen size={14} />}
              label={t('codePane.revealInFolder')}
            />
          </ContextMenu.Item>
          <ContextMenu.Item
            className={contextMenuItemClassName}
            onClick={() => {
              void copyPath(filePath);
            }}
          >
            <IdeMenuItemContent
              icon={<FileIcon size={14} />}
              label={t('codePane.copyPath')}
            />
          </ContextMenu.Item>
          <ContextMenu.Item
            className={contextMenuItemClassName}
            onClick={() => {
              void copyRelativePath(filePath);
            }}
          >
            <IdeMenuItemContent
              icon={<FileIcon size={14} />}
              label={t('codePane.copyRelativePath')}
            />
          </ContextMenu.Item>
          <ContextMenu.Item
            className={contextMenuItemClassName}
            onClick={() => {
              void copyTextValue(filePath, filePath);
            }}
          >
            <IdeMenuItemContent
              icon={<FileIcon size={14} />}
              label={t('codePane.copyAbsolutePath')}
            />
          </ContextMenu.Item>
          <ContextMenu.Item
            className={contextMenuItemClassName}
            onClick={() => {
              void copyTextValue(getPathLeafLabel(filePath) || filePath, filePath);
            }}
          >
            <IdeMenuItemContent
              icon={<FileIcon size={14} />}
              label={t('codePane.copyFileName')}
            />
          </ContextMenu.Item>
          {options?.qualifiedName ? (
            <ContextMenu.Item
              className={contextMenuItemClassName}
              onClick={() => {
                void copyTextValue(options.qualifiedName ?? '', filePath);
              }}
            >
              <IdeMenuItemContent
                icon={<Binary size={14} />}
                label={t('codePane.copyQualifiedName')}
              />
            </ContextMenu.Item>
          ) : null}
          <ContextMenu.Item
            className={contextMenuItemClassName}
            onSelect={() => {
              void loadGitHistory({
                filePath,
              });
            }}
          >
            <IdeMenuItemContent
              icon={<History size={14} />}
              label={t('codePane.gitFileHistory')}
            />
          </ContextMenu.Item>
          {entryType === 'file' && (
            <>
              <ContextMenu.Item
                className={contextMenuItemClassName}
                onSelect={() => {
                  void openInspectorOutlinePanel(filePath);
                }}
              >
                <IdeMenuItemContent
                  icon={<FileCode2 size={14} />}
                  label={t('codePane.fileStructureTab')}
                />
              </ContextMenu.Item>
              <ContextMenu.Item
                className={contextMenuItemClassName}
                onSelect={() => {
                  void openInspectorHierarchyPanel(filePath, 'type-parents');
                }}
              >
                <IdeMenuItemContent
                  icon={<Workflow size={14} />}
                  label={t('codePane.typeHierarchyAction')}
                />
              </ContextMenu.Item>
              <ContextMenu.Item
                className={contextMenuItemClassName}
                onSelect={() => {
                  void openInspectorHierarchyPanel(filePath, 'call-outgoing');
                }}
              >
                <IdeMenuItemContent
                  icon={<Workflow size={14} />}
                  label={t('codePane.callHierarchyAction')}
                />
              </ContextMenu.Item>
            </>
          )}
          {options?.allowGitActions !== false && (
            <ContextMenu.Sub>
              <ContextMenu.SubTrigger className={contextMenuSubTriggerClassName}>
                <IdeMenuSubTriggerContent
                  icon={<GitBranch size={14} />}
                  label={t('codePane.gitMenu')}
                />
              </ContextMenu.SubTrigger>
              <ContextMenu.Portal>
                <ContextMenu.SubContent className={contextMenuContentClassName}>
                  <ContextMenu.Item
                    className={contextMenuItemClassName}
                    disabled={!canGitStage}
                    onSelect={() => {
                      void stageGitPaths([filePath]);
                    }}
                  >
                    <IdeMenuItemContent
                      icon={<Plus size={14} />}
                      label={statusEntry?.status === 'untracked' ? t('codePane.gitAdd') : t('codePane.gitStage')}
                    />
                  </ContextMenu.Item>
                  <ContextMenu.Item
                    className={contextMenuItemClassName}
                    disabled={!canGitUnstage}
                    onSelect={() => {
                      void unstageGitPaths([filePath]);
                    }}
                  >
                    <IdeMenuItemContent
                      icon={<X size={14} />}
                      label={t('codePane.gitUnstage')}
                    />
                  </ContextMenu.Item>
                  <ContextMenu.Item
                    className={contextMenuDangerItemClassName}
                    disabled={!canGitRevert}
                    onSelect={() => {
                      void discardGitPaths([filePath], Boolean(statusEntry?.staged));
                    }}
                  >
                    <IdeMenuItemContent
                      icon={<RefreshCw size={14} />}
                      label={t('codePane.gitRevert')}
                    />
                  </ContextMenu.Item>
                  <ContextMenu.Item
                    className={contextMenuDangerItemClassName}
                    disabled={!canGitRemove}
                    onSelect={() => {
                      void removeGitPaths([filePath], statusEntry?.status === 'untracked');
                    }}
                  >
                    <IdeMenuItemContent
                      icon={<X size={14} />}
                      label={t('codePane.gitRemove')}
                    />
                  </ContextMenu.Item>
                  <ContextMenu.Separator className={ideMenuSeparatorClassName} />
                  <ContextMenu.Item
                    className={contextMenuItemClassName}
                    onSelect={() => {
                      window.setTimeout(() => {
                        openCommitWindow({
                          initialMessage: getPathLeafLabel(filePath) || getRelativePath(rootPath, filePath) || filePath,
                          preselectedPaths: [filePath],
                        });
                      }, 0);
                    }}
                  >
                    <IdeMenuItemContent
                      icon={<GitCommitHorizontal size={14} />}
                      label={t('codePane.gitCommit')}
                    />
                  </ContextMenu.Item>
                  <ContextMenu.Item
                    className={contextMenuItemClassName}
                    onSelect={() => {
                      void loadGitHistory({
                        filePath,
                      });
                    }}
                  >
                    <IdeMenuItemContent
                      icon={<History size={14} />}
                      label={t('codePane.gitFileHistory')}
                    />
                  </ContextMenu.Item>
                  {entryType === 'file' && (
                    <ContextMenu.Item
                      className={contextMenuItemClassName}
                      onSelect={() => {
                        void comparePathWithRevision(filePath);
                      }}
                    >
                      <IdeMenuItemContent
                        icon={<GitCompareArrows size={14} />}
                        label={t('codePane.gitCompareWithRevision')}
                      />
                    </ContextMenu.Item>
                  )}
                  {entryType === 'file' && (
                    <ContextMenu.Item
                      className={contextMenuItemClassName}
                      onSelect={() => {
                        void comparePathWithBranch(filePath);
                      }}
                    >
                      <IdeMenuItemContent
                        icon={<GitCompareArrows size={14} />}
                        label={t('codePane.gitCompareWithBranch')}
                      />
                    </ContextMenu.Item>
                  )}
                  {entryType === 'file' && (
                    <ContextMenu.Item
                      className={contextMenuItemClassName}
                      onSelect={() => {
                        void comparePathWithLatestRepositoryVersion(filePath);
                      }}
                    >
                      <IdeMenuItemContent
                        icon={<GitCompareArrows size={14} />}
                        label={t('codePane.gitCompareWithLatest')}
                      />
                    </ContextMenu.Item>
                  )}
                  <ContextMenu.Item
                    className={contextMenuItemClassName}
                    onSelect={() => {
                      void cherryPickPathCommit();
                    }}
                  >
                    <IdeMenuItemContent
                      icon={<GitCommitHorizontal size={14} />}
                      label={t('codePane.gitCherryPick')}
                    />
                  </ContextMenu.Item>
                </ContextMenu.SubContent>
              </ContextMenu.Portal>
            </ContextMenu.Sub>
          )}
          {entryType === 'file' && (
            <ContextMenu.Item
              className={contextMenuItemClassName}
              onSelect={() => {
                void openFileInSplit(filePath);
              }}
            >
              <IdeMenuItemContent
                icon={<FolderTree size={14} />}
                label={t('codePane.openInSplit')}
              />
            </ContextMenu.Item>
          )}
          {entryType === 'file' && options?.allowDiff !== false && (
            <ContextMenu.Item
              className={contextMenuItemClassName}
              onSelect={() => {
                void openDiffForFile(filePath);
              }}
            >
              <IdeMenuItemContent
                icon={<GitCompareArrows size={14} />}
                label={t('codePane.openDiff')}
              />
            </ContextMenu.Item>
          )}
          {entryType === 'file' && externalChangeStateRef.current.entriesByPath.has(filePath) && (
            <ContextMenu.Item
              className={contextMenuItemClassName}
              onSelect={() => {
                void openExternalChangeDiff(filePath);
              }}
            >
              <IdeMenuItemContent
                icon={<GitCompareArrows size={14} />}
                label={t('codePane.externalChangeViewDiff')}
              />
            </ContextMenu.Item>
          )}
          {options?.allowMutations !== false && (
            <>
              <ContextMenu.Separator className={ideMenuSeparatorClassName} />
              <ContextMenu.Item
                className={contextMenuItemClassName}
                onSelect={() => {
                  void createExplorerFile(filePath, entryType);
                }}
              >
                <IdeMenuItemContent
                  icon={<Plus size={14} />}
                  label={t('codePane.newFile')}
                />
              </ContextMenu.Item>
              <ContextMenu.Item
                className={contextMenuItemClassName}
                onSelect={() => {
                  void createExplorerDirectory(filePath, entryType);
                }}
              >
                <IdeMenuItemContent
                  icon={<FolderPlus size={14} />}
                  label={t('codePane.newFolder')}
                />
              </ContextMenu.Item>
              <ContextMenu.Item
                className={contextMenuItemClassName}
                onSelect={() => {
                  void renameExplorerPath(filePath, entryType);
                }}
              >
                <IdeMenuItemContent
                  icon={<FileIcon size={14} />}
                  label={t('codePane.renamePath')}
                />
              </ContextMenu.Item>
              <ContextMenu.Sub>
                <ContextMenu.SubTrigger className={contextMenuSubTriggerClassName}>
                  <IdeMenuSubTriggerContent
                    icon={<Workflow size={14} />}
                    label={t('codePane.refactorMenu')}
                  />
                </ContextMenu.SubTrigger>
                <ContextMenu.Portal>
                  <ContextMenu.SubContent className={contextMenuContentClassName}>
                    <ContextMenu.Item
                      className={contextMenuItemClassName}
                      onSelect={() => {
                        void movePathWithPreview(filePath);
                      }}
                    >
                      <IdeMenuItemContent
                        icon={<FolderTree size={14} />}
                        label={t('codePane.movePath')}
                      />
                    </ContextMenu.Item>
                    <ContextMenu.Item
                      className={contextMenuDangerItemClassName}
                      onSelect={() => {
                        void safeDeletePathWithPreview(filePath);
                      }}
                    >
                      <IdeMenuItemContent
                        icon={<X size={14} />}
                        label={t('codePane.deletePath')}
                      />
                    </ContextMenu.Item>
                  </ContextMenu.SubContent>
                </ContextMenu.Portal>
              </ContextMenu.Sub>
            </>
          )}
          {entryType === 'file' && options?.showPinToggle && (
            <>
              <ContextMenu.Separator className={ideMenuSeparatorClassName} />
              <ContextMenu.Item
                className={contextMenuItemClassName}
                onSelect={() => {
                  togglePinnedTab(filePath);
                }}
              >
                <IdeMenuItemContent
                  icon={<Pin size={14} />}
                  label={options.pinned ? t('codePane.unpinTab') : t('codePane.pinTab')}
                />
              </ContextMenu.Item>
            </>
          )}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    );
  }, [
    cherryPickPathCommit,
    discardGitPaths,
    contextMenuContentClassName,
    contextMenuItemClassName,
    comparePathWithBranch,
    comparePathWithLatestRepositoryVersion,
    comparePathWithRevision,
    copyTextValue,
    copyPath,
    createExplorerDirectory,
    createExplorerFile,
    loadGitHistory,
    movePathWithPreview,
    openExternalChangeDiff,
    openFileInSplit,
    openDiffForFile,
    openCommitWindow,
    openInspectorHierarchyPanel,
    openInspectorOutlinePanel,
    removeGitPaths,
    renameExplorerPath,
    revealPath,
    safeDeletePathWithPreview,
    stageGitPaths,
    t,
    togglePinnedTab,
    unstageGitPaths,
  ]);

  const buildExplorerTreeRows = useMemo(() => {
    const collectRows = (directoryPath: string, depth: number): ExplorerTreeRow[] => {
      const compactEntries = getCompactDirectoryPresentations(directoryPath);
      const rows: ExplorerTreeRow[] = [];
      for (const compactPresentation of compactEntries) {
        const resolvedEntry = compactPresentation.entry;
        const sourcePath = compactPresentation.startPath;
        const isDirectory = resolvedEntry.type === 'directory';
        const isExpanded = expandedDirectories.has(resolvedEntry.path);
        const entryStatus = isDirectory ? undefined : getEntryStatus(resolvedEntry.path, resolvedEntry.type);
        const externalChangeEntry = isDirectory ? undefined : externalChangesByPath.get(resolvedEntry.path);
        const entryTextClassName = entryStatus
          ? getStatusTextClassName(entryStatus)
          : getExternalChangeTextClassName(externalChangeEntry?.changeType);
        let isLoading = false;
        for (const visiblePath of compactPresentation.visibleDirectoryPaths) {
          if (isDirectoryLoading(visiblePath)) {
            isLoading = true;
            break;
          }
        }
        const row: ExplorerTreeRow = {
          key: sourcePath,
          sourcePath,
          resolvedPath: resolvedEntry.path,
          entryType: resolvedEntry.type,
          depth,
          displayName: compactPresentation.displayName,
          title: compactPresentation.isCompacted ? compactPresentation.displayName : resolvedEntry.name,
          isExpanded,
          isLoading,
          textClassName: entryTextClassName,
          externalChangeType: externalChangeEntry?.changeType,
        };

        if (isDirectory && isExpanded) {
          rows.push(row);
          rows.push(...collectRows(resolvedEntry.path, depth + 1));
        } else {
          rows.push(row);
        }
      }
      return rows;
    };

    return collectRows;
  }, [expandedDirectories, externalChangeEntriesKey, externalChangesByPath, getCompactDirectoryPresentations, getEntryStatus, isDirectoryLoading]);

  const rootExplorerRows = useMemo(() => {
    if (!isSidebarVisible || sidebarMode !== 'files' || !isRootExpanded) {
      return [];
    }

    return buildExplorerTreeRows(rootPath, 1);
  }, [buildExplorerTreeRows, gitStatusEntriesKey, isRootExpanded, isSidebarVisible, rootPath, sidebarMode]);
  const externalLibraryExplorerRowsByRoot = useMemo(() => {
    const rowsByRoot = new Map<string, ExplorerTreeRow[]>();
    if (!isSidebarVisible || sidebarMode !== 'files' || !hasExternalLibraries) {
      return rowsByRoot;
    }

    for (const section of externalLibrarySections) {
      for (const root of section.roots) {
        if (!expandedDirectories.has(root.path)) {
          continue;
        }

        rowsByRoot.set(root.path, buildExplorerTreeRows(root.path, 1));
      }
    }

    return rowsByRoot;
  }, [buildExplorerTreeRows, expandedDirectories, externalLibrarySections, gitStatusEntriesKey, hasExternalLibraries, isSidebarVisible, sidebarMode]);

  useEffect(() => {
    return () => {
      if (pendingExplorerRevealAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(pendingExplorerRevealAnimationFrameRef.current);
        pendingExplorerRevealAnimationFrameRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const revealPath = pendingExplorerRevealPathRef.current;
    if (
      !revealPath
      || !isSidebarVisible
      || sidebarMode !== 'files'
      || selectedPath !== revealPath
    ) {
      return;
    }

    const container = filesSidebarScrollRef.current;
    if (!container) {
      return;
    }

    const escapedPath = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? CSS.escape(revealPath)
      : revealPath.replace(/["\\]/g, '\\$&');
    const selector = `[data-explorer-path="${escapedPath}"]`;
    const targetElement = container.querySelector<HTMLElement>(selector);
    if (targetElement) {
      targetElement.scrollIntoView({
        block: 'nearest',
      });
      pendingExplorerRevealPathRef.current = null;
      return;
    }

    let rowIndex: number | null = null;
    if (revealPath === rootPath) {
      rowIndex = 0;
    } else {
      const workspaceRowIndex = rootExplorerRows.findIndex((row) => row.resolvedPath === revealPath);
      if (workspaceRowIndex >= 0) {
        rowIndex = workspaceRowIndex + 1;
      }
    }

    if (rowIndex === null) {
      let nextRowIndex = sidebarEntries.length > 0 ? 1 + rootExplorerRows.length : 0;
      outer: for (const section of externalLibrarySections) {
        nextRowIndex += 1;
        for (const root of section.roots) {
          if (root.path === revealPath) {
            rowIndex = nextRowIndex;
            break outer;
          }

          nextRowIndex += 1;
          const childRows = expandedDirectories.has(root.path)
            ? (externalLibraryExplorerRowsByRoot.get(root.path) ?? [])
            : [];
          const childRowIndex = childRows.findIndex((row) => row.resolvedPath === revealPath);
          if (childRowIndex >= 0) {
            rowIndex = nextRowIndex + childRowIndex;
            break outer;
          }
          nextRowIndex += childRows.length;
        }
      }
    }

    if (rowIndex === null) {
      return;
    }

    const viewportHeight = container.clientHeight;
    const targetScrollTop = Math.max(
      0,
      rowIndex * CODE_PANE_EXPLORER_ROW_HEIGHT
        - Math.max(0, Math.floor(viewportHeight / 2) - Math.floor(CODE_PANE_EXPLORER_ROW_HEIGHT / 2)),
    );
    if (Math.abs(container.scrollTop - targetScrollTop) > 1) {
      container.scrollTop = targetScrollTop;
      container.dispatchEvent(new Event('scroll'));
    }

    if (pendingExplorerRevealAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(pendingExplorerRevealAnimationFrameRef.current);
    }
    pendingExplorerRevealAnimationFrameRef.current = window.requestAnimationFrame(() => {
      pendingExplorerRevealAnimationFrameRef.current = null;
      const nextTargetElement = container.querySelector<HTMLElement>(selector);
      if (!nextTargetElement) {
        return;
      }

      nextTargetElement.scrollIntoView({
        block: 'nearest',
      });
      pendingExplorerRevealPathRef.current = null;
    });
  }, [
    expandedDirectories,
    externalLibraryExplorerRowsByRoot,
    externalLibrarySections,
    isSidebarVisible,
    rootExplorerRows,
    rootPath,
    selectedPath,
    sidebarEntries.length,
    sidebarMode,
    explorerRevealVersion,
  ]);

  const handleExplorerRowActivate = useCallback((row: ExplorerTreeRow) => {
    if (row.entryType === 'directory') {
      selectExplorerPath(row.resolvedPath);
      return;
    }

    void activateFile(row.resolvedPath);
  }, [activateFile, selectExplorerPath]);

  const handleExplorerRowPromote = useCallback((row: ExplorerTreeRow) => {
    if (row.entryType === 'directory') {
      void toggleDirectory(row.sourcePath);
      return;
    }

    void activateFile(row.resolvedPath, { promotePreview: true });
  }, [activateFile, toggleDirectory]);

  const handleExplorerRowToggle = useCallback((row: ExplorerTreeRow) => {
    void toggleDirectory(row.sourcePath);
  }, [toggleDirectory]);

  const renderExplorerRowContextMenu = useCallback((row: ExplorerTreeRow) => (
    renderFileContextMenu(row.resolvedPath, row.entryType, {
      allowDiff: isPathInside(rootPath, row.sourcePath),
      allowMutations: !isExternalTreePath(rootPath, row.resolvedPath),
      allowGitActions: !isExternalTreePath(rootPath, row.resolvedPath),
      qualifiedName: getQualifiedNameForTreePath(rootPath, row.resolvedPath, row.entryType),
    })
  ), [renderFileContextMenu, rootPath]);

  const renderExplorerTreeRows = useCallback((rows: ExplorerTreeRow[]): React.ReactNode => {
    const renderedRows: React.ReactNode[] = [];
    for (const row of rows) {
      renderedRows.push(
        <ExplorerTreeRowButton
          key={row.key}
          row={row}
          isSelected={selectedPath === row.resolvedPath}
          onActivate={handleExplorerRowActivate}
          onPromote={handleExplorerRowPromote}
          onToggleDirectory={handleExplorerRowToggle}
          renderContextMenu={renderExplorerRowContextMenu}
          t={t}
        />,
      );
    }
    return renderedRows;
  }, [
    handleExplorerRowActivate,
    handleExplorerRowPromote,
    handleExplorerRowToggle,
    renderExplorerRowContextMenu,
    selectedPath,
    t,
  ]);

  const renderedExternalLibrarySections = useMemo(() => {
    if (!isSidebarVisible || sidebarMode !== 'files') {
      return null;
    }

    if (!hasExternalLibraries && !externalLibrariesError) {
      return null;
    }

    const renderedSections: React.ReactNode[] = [];
    for (const section of externalLibrarySections) {
      const renderedRoots: React.ReactNode[] = [];
      for (const root of section.roots) {
        const isExpanded = expandedDirectories.has(root.path);
        const isSelected = selectedPath === root.path;

        renderedRoots.push(
          <div key={root.id}>
            <LazyContextMenu
              children={() => renderFileContextMenu(root.path, 'directory', {
                allowDiff: false,
                allowMutations: false,
                allowGitActions: false,
              })}
              trigger={(
                <button
                  type="button"
                  title={root.path}
                  onClick={() => {
                    selectExplorerPath(root.path);
                  }}
                  onDoubleClick={() => {
                    void toggleDirectory(root.path);
                  }}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs transition-colors ${isSelected ? 'bg-[rgb(var(--primary))]/15 text-zinc-100' : 'text-zinc-300 hover:bg-zinc-800/70'}`}
                  data-explorer-path={root.path}
                >
                  <span
                    className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-zinc-500 hover:bg-zinc-700/60"
                    aria-label={isExpanded ? t('codePane.collapse') : t('codePane.expand')}
                    role="button"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      void toggleDirectory(root.path);
                    }}
                  >
                    {isExpanded ? (
                      <ChevronDown size={14} className="shrink-0" />
                    ) : (
                      <ChevronRight size={14} className="shrink-0" />
                    )}
                  </span>
                  {isExpanded ? (
                    <FolderOpen size={14} className="shrink-0 text-amber-300" />
                  ) : (
                    <Folder size={14} className="shrink-0 text-amber-300" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{root.label}</span>
                  {isDirectoryLoading(root.path) && (
                    <Loader2 size={12} className="shrink-0 animate-spin text-zinc-500" />
                  )}
                </button>
              )}
            />
            {isExpanded ? renderExplorerTreeRows(externalLibraryExplorerRowsByRoot.get(root.path) ?? []) : null}
          </div>,
        );
      }

      renderedSections.push(
        <div key={section.id} className="pb-3">
          <div className="px-2 pb-1 text-[10px] font-medium uppercase tracking-[0.12em] text-zinc-500">
            {`${t('codePane.externalLibraries')} · ${formatLanguageLabel(section.languageId, t('codePane.languageUnknown'))}`}
          </div>
          {renderedRoots}
        </div>,
      );
    }

    return (
      <div className="mt-3 border-t border-zinc-800/80 pt-3">
        {externalLibrariesError ? (
          <div className="px-2 pb-2 text-xs text-red-300">{externalLibrariesError}</div>
        ) : null}
        {renderedSections}
      </div>
    );
  }, [expandedDirectories, externalLibrariesError, externalLibraryExplorerRowsByRoot, externalLibrarySections, hasExternalLibraries, isDirectoryLoading, isSidebarVisible, renderExplorerTreeRows, renderFileContextMenu, selectExplorerPath, selectedPath, sidebarMode, t, toggleDirectory]);

  const renderSearchResultRow = useCallback((filePath: string) => {
    const entryStatus = getEntryStatus(filePath, 'file');
    return (
      <SearchResultRowButton
        key={filePath}
        filePath={filePath}
        isSelected={selectedPath === filePath}
        entryTextClassName={getStatusTextClassName(entryStatus)}
        relativePath={getRelativePath(rootPath, filePath)}
        onActivate={(nextFilePath) => {
          void activateFile(nextFilePath, { preview: true });
        }}
        onPromote={(nextFilePath) => {
          void activateFile(nextFilePath, { promotePreview: true });
        }}
        renderContextMenu={(nextFilePath) => renderFileContextMenu(nextFilePath, 'file', {
          qualifiedName: getQualifiedNameForTreePath(rootPath, nextFilePath, 'file'),
        })}
      />
    );
  }, [activateFile, getEntryStatus, getRelativePath, renderFileContextMenu, rootPath, selectedPath]);

  const renderedFilesSidebarBody = useCallback((viewport: FileTreeViewport, searchState: FilesSidebarSearchState) => {
    if (!isSidebarVisible || sidebarMode !== 'files') {
      return null;
    }

    const { scrollTop: filesSidebarScrollTop, viewportHeight: filesSidebarViewportHeight } = viewport;
    const { trimmedQuery, results: searchResults, error: searchError } = searchState;
    const visibleRootExplorerRows = getWindowedListSlice({
      items: rootExplorerRows,
      scrollTop: Math.max(0, filesSidebarScrollTop - CODE_PANE_EXPLORER_ROW_HEIGHT),
      viewportHeight: filesSidebarViewportHeight,
      rowHeight: CODE_PANE_EXPLORER_ROW_HEIGHT,
      overscan: CODE_PANE_EXPLORER_ROW_OVERSCAN,
      threshold: CODE_PANE_EXPLORER_WINDOWING_THRESHOLD,
    });
    const visibleSearchResults = getWindowedListSlice({
      items: searchResults,
      scrollTop: filesSidebarScrollTop,
      viewportHeight: filesSidebarViewportHeight,
      rowHeight: CODE_PANE_EXPLORER_ROW_HEIGHT,
      overscan: CODE_PANE_EXPLORER_ROW_OVERSCAN,
      threshold: CODE_PANE_EXPLORER_WINDOWING_THRESHOLD,
    });
    const renderedSearchResults = visibleSearchResults.items.map(renderSearchResultRow);

    const renderedWindowedSearchResults = !visibleSearchResults.isWindowed
      ? renderedSearchResults
      : (
        <div style={{ height: `${visibleSearchResults.totalHeight}px`, position: 'relative' }}>
          <div
            style={{
              transform: `translateY(${visibleSearchResults.offsetTop}px)`,
            }}
          >
            {renderedSearchResults}
          </div>
        </div>
      );

    if (isBootstrapping) {
      return (
        <div className="flex items-center gap-2 px-2 text-xs text-zinc-500">
          <Loader2 size={12} className="animate-spin" />
          {t('codePane.loading')}
        </div>
      );
    }

    if (trimmedQuery && searchError) {
      return <div className="px-2 text-xs text-red-300">{searchError}</div>;
    }

    if (trimmedQuery) {
      return searchResults.length > 0 ? renderedWindowedSearchResults : (
        <div className="px-2 text-xs text-zinc-500">{t('common.noMatchingWindows')}</div>
      );
    }

    if (treeLoadError) {
      return <div className="px-2 text-xs text-red-300">{treeLoadError}</div>;
    }

    if (sidebarEntries.length <= 0 && !hasExternalLibraries && !externalLibrariesError) {
      return <div className="px-2 text-xs text-zinc-500">{t('codePane.emptyFolder')}</div>;
    }

    return (
      <>
        {sidebarEntries.length > 0 ? (
          <>
            <LazyContextMenu
              children={() => renderFileContextMenu(rootPath, 'directory')}
              trigger={(
                <button
                  type="button"
                  title={rootPath}
                  onClick={() => {
                    selectExplorerPath(rootPath);
                  }}
                  onDoubleClick={() => {
                    void toggleDirectory(rootPath);
                  }}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs transition-colors ${isRootSelected ? 'bg-[rgb(var(--primary))]/15 text-zinc-100' : 'text-zinc-300 hover:bg-zinc-800/70'}`}
                  data-explorer-path={rootPath}
                >
                  <span
                    className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-zinc-500 hover:bg-zinc-700/60"
                    aria-label={isRootExpanded ? t('codePane.collapse') : t('codePane.expand')}
                    role="button"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      void toggleDirectory(rootPath);
                    }}
                  >
                    {isRootExpanded ? (
                      <ChevronDown size={14} className="shrink-0" />
                    ) : (
                      <ChevronRight size={14} className="shrink-0" />
                    )}
                  </span>
                  {isRootExpanded ? (
                    <FolderOpen size={14} className="shrink-0 text-amber-300" />
                  ) : (
                    <Folder size={14} className="shrink-0 text-amber-300" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{rootLabel}</span>
                  {isDirectoryLoading(rootPath) && (
                    <Loader2 size={12} className="shrink-0 animate-spin text-zinc-500" />
                  )}
                </button>
              )}
            />
            {isRootExpanded ? (
              visibleRootExplorerRows.isWindowed ? (
                <div style={{ height: `${visibleRootExplorerRows.totalHeight}px`, position: 'relative' }}>
                  <div
                    style={{
                      transform: `translateY(${visibleRootExplorerRows.offsetTop}px)`,
                    }}
                  >
                    {renderExplorerTreeRows(visibleRootExplorerRows.items)}
                  </div>
                </div>
              ) : renderExplorerTreeRows(rootExplorerRows)
            ) : null}
          </>
        ) : null}
        {renderedExternalLibrarySections}
      </>
    );
  }, [
    hasExternalLibraries,
    externalLibrariesError,
    isBootstrapping,
    isDirectoryLoading,
    isRootExpanded,
    isRootSelected,
    isSidebarVisible,
    renderFileContextMenu,
    renderedExternalLibrarySections,
    renderExplorerTreeRows,
    rootExplorerRows,
    rootLabel,
    rootPath,
    renderSearchResultRow,
    selectExplorerPath,
    sidebarEntries,
    sidebarMode,
    t,
    toggleDirectory,
    treeLoadError,
  ]);

  const usageGroups = useMemo(() => {
    if (!isSidebarVisible || sidebarMode !== 'search' || searchPanelMode !== 'usages') {
      return [];
    }

    const groups = new Map<string, CodePaneReference[]>();
    for (const reference of usageResults) {
      const references = groups.get(reference.filePath) ?? [];
      references.push(reference);
      groups.set(reference.filePath, references);
    }

    const nextGroups: Array<{ filePath: string; references: CodePaneReference[] }> = [];
    for (const [filePath, references] of groups.entries()) {
      nextGroups.push({
        filePath,
        references,
      });
    }
    return nextGroups;
  }, [isSidebarVisible, searchPanelMode, sidebarMode, usageResults]);

  const scmEntryValues = gitStatusEntries;
  const shouldSortScmEntries = bottomPanelMode === 'git' || Boolean(commitWindowState) || (
    isSidebarVisible && sidebarMode === 'scm'
  );
  const scmEntries = useMemo(() => {
    if (!shouldSortScmEntries || scmEntryValues.length <= 1) {
      return scmEntryValues;
    }

    const relativePaths = new Map<string, string>();
    for (const entry of scmEntryValues) {
      relativePaths.set(entry.path, getRelativePath(rootPath, entry.path));
    }

    return [...scmEntryValues].sort((left, right) => (
      (relativePaths.get(left.path) ?? left.path).localeCompare(
        relativePaths.get(right.path) ?? right.path,
        undefined,
        { sensitivity: 'base' },
      )
    ));
  }, [getRelativePath, rootPath, scmEntryValues, shouldSortScmEntries]);

  const handleCommitWindowSelectPath = useCallback(async (filePath: string) => {
    const shouldReloadHunks = selectedGitHunksPathRef.current !== filePath;
    selectedGitChangePathRef.current = filePath;
    setSelectedGitChangePath((currentPath) => (
      currentPath === filePath ? currentPath : filePath
    ));
    if (!shouldReloadHunks) {
      return;
    }
    await loadGitDiffHunks(filePath);
  }, [loadGitDiffHunks]);

  const handleCommitWindowCommit = useCallback(async (config: { message: string; selectedPaths: string[] }) => {
    const selectedPaths: string[] = [];
    for (const filePath of config.selectedPaths) {
      if (filePath) {
        selectedPaths.push(filePath);
      }
    }
    if (selectedPaths.length === 0) {
      return;
    }

    const previousCommitWindowState = commitWindowStateRef.current;
    setCommitWindowState((currentState) => (currentState === null ? currentState : null));
    commitWindowStateRef.current = null;
    const didCommit = await commitGitChanges({
      message: config.message,
      amend: false,
      includeAll: true,
      paths: selectedPaths,
    });
    if (!didCommit && previousCommitWindowState) {
      commitWindowStateRef.current = previousCommitWindowState;
      setCommitWindowState(previousCommitWindowState);
    }
  }, [commitGitChanges]);

  const commitGitChangesFromPrompt = useCallback(async () => {
    window.setTimeout(() => {
      openCommitWindow();
    }, 0);
  }, [openCommitWindow]);

  const selectedGitHunksRelativePath = useMemo(
    () => selectedGitHunksPath ? getRelativePath(rootPath, selectedGitHunksPath) : null,
    [rootPath, selectedGitHunksPath],
  );
  const selectedGitChangeRelativePath = useMemo(
    () => selectedGitChangePath ? getRelativePath(rootPath, selectedGitChangePath) : selectedGitHunksRelativePath,
    [rootPath, selectedGitChangePath, selectedGitHunksRelativePath],
  );

  const selectedScmEntry = useMemo(() => (
    selectedGitChangePath
      ? gitStatusByPath[selectedGitChangePath] ?? null
      : null
  ), [gitStatusByPath, selectedGitChangePath]);

  const getProjectRelativePath = useCallback((filePath: string) => (
    getRelativePath(rootPath, filePath)
  ), [rootPath]);

  const selectGitChangeEntry = useCallback((entry: CodePaneGitStatusEntry, options?: { activate?: boolean }) => {
    const shouldReloadHunks = selectedGitHunksPathRef.current !== entry.path;
    selectedGitChangePathRef.current = entry.path;
    setSelectedGitChangePath((currentPath) => (currentPath === entry.path ? currentPath : entry.path));
    if (shouldReloadHunks) {
      void loadGitDiffHunks(entry.path);
    }

    if ((options?.activate ?? true) && entry.status !== 'deleted') {
      void activateFile(entry.path, { preview: true });
    }
  }, [activateFile, loadGitDiffHunks]);

  useEffect(() => {
    if (scmEntries.length === 0) {
      return;
    }

    let preferredEntry: CodePaneGitStatusEntry | null = scmEntries[0] ?? null;
    for (const entry of scmEntries) {
      if (selectedGitChangePath && entry.path === selectedGitChangePath) {
        return;
      }
      if (activeFilePath && entry.path === activeFilePath) {
        preferredEntry = entry;
      }
    }

    if (!preferredEntry) {
      return;
    }

    selectedGitChangePathRef.current = preferredEntry.path;
    setSelectedGitChangePath((currentPath) => (
      currentPath === preferredEntry.path ? currentPath : preferredEntry.path
    ));
  }, [activeFilePath, scmEntries, selectedGitChangePath]);

  const commitWindowEntries = useMemo(() => {
    if (!commitWindowState) {
      return [];
    }

    const sourceEntries: Array<CodePaneGitStatusEntry & { relativePath?: string }> = scmEntries.length > 0
      ? scmEntries
      : (commitWindowState.entriesSnapshot ?? []);
    const nextCache = new Map<string, CodePaneGitStatusEntry & { relativePath: string }>();
    const nextEntries: Array<CodePaneGitStatusEntry & { relativePath: string }> = [];
    for (const entry of sourceEntries) {
      const relativePath = getProjectRelativePath(entry.path) || getPathLeafLabel(entry.path) || entry.path;
      const cachedEntry = commitWindowEntriesCacheRef.current.get(entry.path);
      if (
        cachedEntry
        && cachedEntry.relativePath === relativePath
        && cachedEntry.status === entry.status
        && cachedEntry.staged === entry.staged
        && cachedEntry.unstaged === entry.unstaged
        && cachedEntry.conflicted === entry.conflicted
        && cachedEntry.section === entry.section
        && cachedEntry.originalPath === entry.originalPath
      ) {
        nextCache.set(entry.path, cachedEntry);
        nextEntries.push(cachedEntry);
        continue;
      }

      const nextEntry = {
        ...entry,
        relativePath,
      };
      nextCache.set(entry.path, nextEntry);
      nextEntries.push(nextEntry);
    }
    commitWindowEntriesCacheRef.current = nextCache;
    return nextEntries;
  }, [commitWindowState, getProjectRelativePath, scmEntries]);
  const commitWindowInitialSelectedPaths = useMemo(() => {
    if (!commitWindowState) {
      return [];
    }

    const availablePaths = new Set<string>();
    for (const entry of commitWindowEntries) {
      availablePaths.add(entry.path);
    }
    const nextSelectedPaths: string[] = [];
    for (const candidatePath of commitWindowState.preselectedPaths ?? []) {
      if (availablePaths.has(candidatePath)) {
        nextSelectedPaths.push(candidatePath);
      }
    }
    return nextSelectedPaths;
  }, [commitWindowEntries, commitWindowState]);

  const actionInputDialogKey = useMemo(() => (
    actionInputDialog ? getActionInputDialogId(actionInputDialog) : ''
  ), [actionInputDialog]);
  const actionInputDialogConfig = useMemo(() => {
    if (!actionInputDialog) {
      return null;
    }

    switch (actionInputDialog.kind) {
      case 'rename-symbol':
        return {
          metaLabel: t('codePane.refactorMenu'),
          title: t('codePane.renameSymbol'),
          description: t('codePane.renamePrompt'),
          inputLabel: t('codePane.renameSymbol'),
          placeholder: t('codePane.renamePrompt'),
          initialValue: actionInputDialog.initialValue,
          confirmLabel: t('codePane.renameSymbol'),
          previewLabel: t('codePane.pathMutationPreview'),
          getPreviewValue: (value: string) => value,
          previewPlaceholder: t('codePane.pathMutationPreviewEmpty'),
          canConfirm: (value: string) => Boolean(value) && value !== actionInputDialog.initialValue,
          icon: <FileIcon size={12} className="shrink-0 text-sky-300" />,
          auxiliaryContent: (
            <div className="space-y-2">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
                {getRelativePath(rootPath, actionInputDialog.filePath)}
              </div>
              <div className="text-xs text-zinc-400">
                {actionInputDialog.position.lineNumber}:{actionInputDialog.position.column}
              </div>
            </div>
          ),
        };
      case 'rename-path-preview':
        return {
          metaLabel: t('codePane.refactorMenu'),
          title: t('codePane.renamePath'),
          description: t('codePane.pathMutationRenameDescription'),
          inputLabel: t('codePane.pathMutationInputLabel'),
          placeholder: t('codePane.renamePathPrompt'),
          initialValue: actionInputDialog.initialValue,
          confirmLabel: t('codePane.renamePath'),
          previewLabel: t('codePane.pathMutationPreview'),
          getPreviewValue: (value: string) => (
            value
              ? getRelativePath(rootPath, replacePathLeaf(actionInputDialog.filePath, value)) || rootLabel
              : ''
          ),
          previewPlaceholder: t('codePane.pathMutationPreviewEmpty'),
          canConfirm: (value: string) => Boolean(value) && value !== actionInputDialog.initialValue,
          icon: <FileIcon size={12} className="shrink-0 text-sky-300" />,
        };
      case 'move-path-preview':
        return {
          metaLabel: t('codePane.refactorMenu'),
          title: t('codePane.movePath'),
          description: t('codePane.movePathPrompt'),
          inputLabel: t('codePane.movePath'),
          placeholder: t('codePane.movePathPrompt'),
          initialValue: actionInputDialog.initialValue,
          confirmLabel: t('codePane.movePath'),
          previewLabel: t('codePane.pathMutationPreview'),
          getPreviewValue: (value: string) => (
            value
              ? getRelativePath(rootPath, resolvePathFromRoot(rootPath, value)) || rootLabel
              : ''
          ),
          previewPlaceholder: t('codePane.pathMutationPreviewEmpty'),
          canConfirm: (value: string) => Boolean(value) && value !== actionInputDialog.initialValue,
          icon: <FolderTree size={12} className="shrink-0 text-sky-300" />,
        };
      case 'compare-file-with-reference':
        return {
          metaLabel: t('codePane.gitWorkbenchTab'),
          title: actionInputDialog.mode === 'branch'
            ? t('codePane.gitCompareWithBranch')
            : t('codePane.gitCompareWithRevision'),
          description: actionInputDialog.mode === 'branch'
            ? t('codePane.gitCompareWithBranchPrompt')
            : t('codePane.gitCompareWithRevisionPrompt'),
          inputLabel: actionInputDialog.mode === 'branch'
            ? t('codePane.gitCompareWithBranch')
            : t('codePane.gitCompareWithRevision'),
          placeholder: actionInputDialog.mode === 'branch'
            ? t('codePane.gitCompareWithBranchPrompt')
            : t('codePane.gitCompareWithRevisionPrompt'),
          initialValue: actionInputDialog.initialValue,
          confirmLabel: t('codePane.openDiff'),
          canConfirm: (value: string) => Boolean(value),
          icon: <GitCompareArrows size={12} className="shrink-0 text-sky-300" />,
          auxiliaryContent: (
            <div className="text-[11px] text-zinc-400">
              {getRelativePath(rootPath, actionInputDialog.filePath)}
            </div>
          ),
        };
      case 'checkout-revision':
        return {
          metaLabel: t('codePane.gitWorkbenchTab'),
          title: t('codePane.gitCheckoutTagOrRevision'),
          description: t('codePane.gitCheckoutRevisionPrompt'),
          inputLabel: t('codePane.gitCheckout'),
          placeholder: t('codePane.gitCheckoutRevisionPrompt'),
          initialValue: actionInputDialog.initialValue,
          confirmLabel: t('codePane.gitCheckout'),
          canConfirm: (value: string) => Boolean(value),
          icon: <GitBranch size={12} className="shrink-0 text-sky-300" />,
        };
      case 'cherry-pick':
        return {
          metaLabel: t('codePane.gitWorkbenchTab'),
          title: t('codePane.gitCherryPick'),
          description: t('codePane.gitCherryPickPrompt'),
          inputLabel: t('codePane.gitCherryPick'),
          placeholder: t('codePane.gitCherryPickPrompt'),
          initialValue: actionInputDialog.initialValue,
          confirmLabel: t('codePane.gitCherryPick'),
          canConfirm: (value: string) => Boolean(value),
          icon: <GitCommitHorizontal size={12} className="shrink-0 text-emerald-300" />,
        };
      case 'checkout-branch':
        return {
          metaLabel: t('codePane.gitBranchManager'),
          title: actionInputDialog.createBranch ? t('codePane.gitNewBranchDots') : t('codePane.gitCheckout'),
          description: actionInputDialog.createBranch ? t('codePane.gitCheckoutPlaceholder') : t('codePane.gitCheckoutPlaceholder'),
          inputLabel: actionInputDialog.createBranch ? t('codePane.gitCreateBranch') : t('codePane.gitCheckout'),
          placeholder: t('codePane.gitCheckoutPlaceholder'),
          initialValue: actionInputDialog.initialValue,
          confirmLabel: actionInputDialog.createBranch ? t('codePane.gitCreateBranch') : t('codePane.gitCheckout'),
          canConfirm: (value: string) => Boolean(value),
          icon: <GitBranch size={12} className="shrink-0 text-sky-300" />,
          auxiliaryContent: (
            <div className="space-y-2 text-[11px] text-zinc-400">
              {actionInputDialog.startPoint ? (
                <div>{actionInputDialog.startPoint}</div>
              ) : null}
              {actionInputDialog.createBranch ? (
                <label className="flex items-center gap-2 text-zinc-300">
                  <input checked readOnly type="checkbox" />
                  {t('codePane.gitCreateBranch')}
                </label>
              ) : null}
            </div>
          ),
        };
      case 'rename-branch':
        return {
          metaLabel: t('codePane.gitBranchManager'),
          title: t('codePane.gitRenameBranch'),
          description: t('codePane.gitRenameBranchPrompt'),
          inputLabel: t('codePane.gitRenameBranch'),
          placeholder: t('codePane.gitRenameBranchPrompt'),
          initialValue: actionInputDialog.initialValue,
          confirmLabel: t('codePane.gitRenameBranch'),
          canConfirm: (value: string) => Boolean(value) && value !== actionInputDialog.branchName,
          icon: <FileIcon size={12} className="shrink-0 text-sky-300" />,
        };
      case 'stash':
        return {
          metaLabel: t('codePane.gitWorkbenchTab'),
          title: t('codePane.gitStash'),
          description: t('codePane.gitStashPlaceholder'),
          inputLabel: t('codePane.gitStash'),
          placeholder: t('codePane.gitStashPlaceholder'),
          initialValue: actionInputDialog.initialValue,
          confirmLabel: t('codePane.gitStash'),
          canConfirm: () => true,
          icon: <Folder size={12} className="shrink-0 text-amber-300" />,
          auxiliaryContent: (
            <label className="flex items-center gap-2 text-[11px] text-zinc-300">
              <input checked={actionInputDialog.includeUntracked} readOnly type="checkbox" />
              {t('codePane.gitIncludeUntracked')}
            </label>
          ),
        };
    }
  }, [actionInputDialog, rootLabel, rootPath, t]);
  const actionConfirmDialogConfig = useMemo(() => {
    if (!actionConfirmDialog) {
      return null;
    }

    switch (actionConfirmDialog.kind) {
      case 'safe-delete-path':
        return {
          metaLabel: t('codePane.refactorMenu'),
          title: t('codePane.deletePath'),
          description: t('codePane.safeDeleteConfirm', { path: getPathLeafLabel(actionConfirmDialog.filePath) }),
          confirmLabel: t('codePane.deletePath'),
          confirmTone: 'danger' as const,
        };
      case 'delete-branch':
        return {
          metaLabel: t('codePane.gitBranchManager'),
          title: t('codePane.gitDeleteBranch'),
          description: t(
            actionConfirmDialog.force
              ? 'codePane.gitDeleteBranchForcePrompt'
              : 'codePane.gitDeleteBranchPrompt',
            { branch: actionConfirmDialog.branchName },
          ),
          confirmLabel: t('codePane.gitDeleteBranch'),
          confirmTone: 'danger' as const,
        };
    }
  }, [actionConfirmDialog, t]);

  useEffect(() => {
    if (!selectedGitChangePath) {
      return;
    }

    if (gitStatusByPath[selectedGitChangePath]) {
      return;
    }

    setSelectedGitChangePath((currentPath) => (
      currentPath === null ? currentPath : null
    ));
    void loadGitDiffHunks(null);
  }, [gitStatusByPath, loadGitDiffHunks, selectedGitChangePath]);

  const gitOperationLabel = useMemo(() => {
    switch (gitRepositorySummary?.operation) {
      case 'merge':
        return t('codePane.gitOperationMerge');
      case 'rebase':
        return t('codePane.gitOperationRebase');
      case 'cherry-pick':
        return t('codePane.gitOperationCherryPick');
      case 'revert':
        return t('codePane.gitOperationRevert');
      case 'bisect':
        return t('codePane.gitOperationBisect');
      default:
        return t('codePane.gitOperationIdle');
    }
  }, [gitRepositorySummary?.operation, t]);

  const gitSummaryBranchLabel = useMemo(() => {
    if (!gitRepositorySummary) {
      return null;
    }

    if (gitRepositorySummary.currentBranch) {
      return gitRepositorySummary.currentBranch;
    }

    if (gitRepositorySummary.detachedHead && gitRepositorySummary.headSha) {
      return `${t('codePane.gitDetachedHead')} ${gitRepositorySummary.headSha.slice(0, 7)}`;
    }

    return t('codePane.gitDetachedHead');
  }, [gitRepositorySummary, t]);

  const problemGroups = useMemo(() => {
    if (!isSidebarVisible || sidebarMode !== 'problems') {
      return [];
    }

    const groups = new Map<string, Array<MonacoMarker & { filePath: string }>>();
    for (const problem of problems) {
      const entries = groups.get(problem.filePath) ?? [];
      entries.push(problem);
      groups.set(problem.filePath, entries);
    }

    const nextGroups: Array<{ filePath: string; entries: Array<MonacoMarker & { filePath: string }> }> = [];
    for (const [filePath, entries] of groups.entries()) {
      nextGroups.push({
        filePath,
        entries,
      });
    }
    return nextGroups;
  }, [isSidebarVisible, problems, sidebarMode]);

  const problemSummary = useMemo(() => {
    if (!isSidebarVisible || sidebarMode !== 'problems') {
      return {
        errorCount: 0,
        warningCount: 0,
        infoCount: 0,
      };
    }

    let errorCount = 0;
    let warningCount = 0;
    let infoCount = 0;

    for (const problem of problems) {
      if (problem.severity >= 8) {
        errorCount += 1;
      } else if (problem.severity >= 4) {
        warningCount += 1;
      } else {
        infoCount += 1;
      }
    }

    return {
      errorCount,
      warningCount,
      infoCount,
    };
  }, [isSidebarVisible, problems, sidebarMode]);

  const navigateProblem = useCallback(async (direction: 1 | -1) => {
    if (problems.length === 0) {
      return;
    }

    const currentLocation = getCurrentNavigationLocation();
    let nextProblem = problems[0];

    if (currentLocation) {
      if (direction > 0) {
        for (const problem of problems) {
          if (
            problem.filePath > currentLocation.filePath
            || (
              problem.filePath === currentLocation.filePath
              && (
                problem.startLineNumber > currentLocation.lineNumber
                || (
                  problem.startLineNumber === currentLocation.lineNumber
                  && problem.startColumn > currentLocation.column
                )
              )
            )
          ) {
            nextProblem = problem;
            break;
          }
        }
      } else {
        nextProblem = problems[problems.length - 1]!;
        for (let index = problems.length - 1; index >= 0; index -= 1) {
          const problem = problems[index]!;
          if (
            problem.filePath < currentLocation.filePath
            || (
              problem.filePath === currentLocation.filePath
              && (
                problem.startLineNumber < currentLocation.lineNumber
                || (
                  problem.startLineNumber === currentLocation.lineNumber
                  && problem.startColumn < currentLocation.column
                )
              )
            )
          ) {
            nextProblem = problem;
            break;
          }
        }
      }
    }

    showSidebarMode('problems');
    await openEditorLocation({
      filePath: nextProblem.filePath,
      lineNumber: nextProblem.startLineNumber,
      column: nextProblem.startColumn,
    }, {
      preserveTabs: true,
      recordHistory: true,
      recordRecent: true,
      clearForward: true,
    });
  }, [getCurrentNavigationLocation, openEditorLocation, problems, showSidebarMode]);

  const openSearchEverywhere = useCallback((mode: SearchEverywhereMode) => {
    searchEverywhereControllerRef.current?.open(mode);
  }, []);

  const closeSearchEverywhere = useCallback(() => (
    searchEverywhereControllerRef.current?.close() ?? false
  ), []);

  const getSearchEverywhereCommandItems = useCallback((): SearchEverywhereItem[] => ([
    {
      id: 'command-search-everywhere',
      section: t('codePane.searchEverywhereCommandsSection'),
      title: t('codePane.searchEverywhereOpen'),
      meta: 'Ctrl/Cmd+P',
      execute: () => {
        openSearchEverywhere('all');
      },
    },
    {
      id: 'command-open-actions',
      section: t('codePane.searchEverywhereCommandsSection'),
      title: t('codePane.codeActions'),
      meta: 'Alt+Enter',
      execute: async () => {
        await openCodeActionMenuRef.current();
      },
    },
    {
      id: 'command-go-to-implementation',
      section: t('codePane.searchEverywhereCommandsSection'),
      title: t('codePane.goToImplementation'),
      meta: 'Ctrl/Cmd+Alt+B',
      execute: async () => {
        await goToImplementationAtCursorRef.current();
      },
    },
    {
      id: 'command-quick-documentation',
      section: t('codePane.searchEverywhereCommandsSection'),
      title: t('codePane.quickDocumentation'),
      meta: 'F1',
      execute: async () => {
        setIsQuickDocumentationOpen((currentOpen) => (currentOpen ? currentOpen : true));
        await loadQuickDocumentation();
      },
    },
    {
      id: 'command-find-usages',
      section: t('codePane.searchEverywhereCommandsSection'),
      title: t('codePane.findUsages'),
      meta: 'Shift+F12',
      execute: async () => {
        await findUsagesAtCursor();
      },
    },
    {
      id: 'command-rename-symbol',
      section: t('codePane.searchEverywhereCommandsSection'),
      title: t('codePane.renameSymbol'),
      meta: 'F2',
      execute: async () => {
        await renameSymbolAtCursor();
      },
    },
    {
      id: 'command-format-document',
      section: t('codePane.searchEverywhereCommandsSection'),
      title: t('codePane.formatDocument'),
      meta: 'Shift+Alt+F',
      execute: async () => {
        await formatActiveDocument();
      },
    },
    {
      id: 'command-back',
      section: t('codePane.searchEverywhereCommandsSection'),
      title: t('codePane.navigateBack'),
      meta: 'Alt+Left',
      execute: async () => {
        await navigateBackRef.current();
      },
    },
    {
      id: 'command-forward',
      section: t('codePane.searchEverywhereCommandsSection'),
      title: t('codePane.navigateForward'),
      meta: 'Alt+Right',
      execute: async () => {
        await navigateForwardRef.current();
      },
    },
    {
      id: 'command-next-problem',
      section: t('codePane.searchEverywhereCommandsSection'),
      title: t('codePane.nextProblem'),
      meta: 'F8',
      execute: async () => {
        await navigateProblem(1);
      },
    },
    {
      id: 'command-previous-problem',
      section: t('codePane.searchEverywhereCommandsSection'),
      title: t('codePane.previousProblem'),
      meta: 'Shift+F8',
      execute: async () => {
        await navigateProblem(-1);
      },
    },
    {
      id: 'command-toggle-sidebar',
      section: t('codePane.searchEverywhereCommandsSection'),
      title: t('codePane.toggleSidebar'),
      meta: 'Ctrl/Cmd+B',
      execute: () => {
        toggleSidebarVisibility();
      },
    },
    {
      id: 'command-refresh-project',
      section: t('codePane.searchEverywhereCommandsSection'),
      title: t('codePane.refresh'),
      execute: async () => {
        setIsRefreshing((currentRefreshing) => (currentRefreshing ? currentRefreshing : true));
        try {
          await refreshLoadedDirectories();
        } finally {
          setIsRefreshing((currentRefreshing) => (currentRefreshing ? false : currentRefreshing));
        }
      },
    },
  ]), [
    findUsagesAtCursor,
    formatActiveDocument,
    loadQuickDocumentation,
    navigateProblem,
    openSearchEverywhere,
    refreshLoadedDirectories,
    renameSymbolAtCursor,
    t,
    toggleSidebarVisibility,
  ]);

  const loadSearchEverywhereResults = useCallback(async (
    mode: SearchEverywhereMode,
    trimmedQuery: string,
  ): Promise<SearchEverywhereLoadResult> => {
    const requestKey = `search-everywhere:${rootPath}`;
    const requestVersion = runtimeStoreRef.current.markLatest(requestKey);
    const cacheKey = `${requestKey}:${mode}:${trimmedQuery}`;
    const cachedResults = runtimeStoreRef.current.getCache<{
      files: string[];
      symbols: CodePaneWorkspaceSymbol[];
    }>(cacheKey, CODE_PANE_SEARCH_CACHE_TTL_MS);
    if (cachedResults) {
      runtimeStoreRef.current.recordRequest(requestKey, t('codePane.requestSearchEverywhere'), {
        meta: `${mode}:${trimmedQuery}`,
        fromCache: true,
      });
      return {
        files: cachedResults.files,
        symbols: cachedResults.symbols,
        error: null,
      };
    }

    const [fileResponse, symbolResponse] = await Promise.all([
      trackRequest(
        `${requestKey}:files`,
        t('codePane.requestSearchEverywhereFiles'),
        trimmedQuery,
        async () => await window.electronAPI.codePaneSearchFiles({
          rootPath,
          query: trimmedQuery,
          limit: 40,
        }),
      ),
      trackRequest(
        `${requestKey}:symbols`,
        t('codePane.requestSearchEverywhereSymbols'),
        trimmedQuery,
        async () => await window.electronAPI.codePaneGetWorkspaceSymbols({
          rootPath,
          query: trimmedQuery,
          limit: 40,
        }),
      ),
    ]);

    if (!runtimeStoreRef.current.isLatest(requestKey, requestVersion)) {
      return {
        files: [],
        symbols: [],
        error: null,
      };
    }

    const files = fileResponse.success ? (fileResponse.data ?? []) : [];
    const symbols = symbolResponse.success ? (symbolResponse.data ?? []) : [];
    const error = fileResponse.success && symbolResponse.success
      ? null
      : fileResponse.error || symbolResponse.error || t('common.retry');
    if (fileResponse.success && symbolResponse.success) {
      runtimeStoreRef.current.setCache(cacheKey, {
        files,
        symbols,
      });
    }

    return {
      files,
      symbols,
      error,
    };
  }, [rootPath, t, trackRequest]);

  const visibleDebugSessions = debugSessions;
  const debugTargets = useMemo(() => {
    if (bottomPanelMode !== 'debug') {
      return [];
    }

    const nextTargets: CodePaneRunTarget[] = [];
    for (const target of runTargets) {
      if (target.canDebug) {
        nextTargets.push(target);
      }
    }
    return nextTargets;
  }, [bottomPanelMode, runTargets]);
  const runSessionState = useMemo(() => {
    if (bottomPanelMode !== 'run' && bottomPanelMode !== 'tests' && bottomPanelMode !== 'project') {
      return {
        hasFailedTests: false,
        selectedSession: null,
        visibleSessions: [] as CodePaneRunSession[],
      };
    }

    const visibleSessions: CodePaneRunSession[] = [];
    let selectedSession: CodePaneRunSession | null = null;
    let firstVisibleSession: CodePaneRunSession | null = null;
    let hasFailedTests = false;

    for (const session of runSessions) {
      if (session.kind === 'test' && session.state === 'failed') {
        hasFailedTests = true;
      }

      const isVisible = bottomPanelMode === 'tests'
        ? session.kind === 'test'
        : bottomPanelMode === 'project'
          ? session.kind === 'task'
          : bottomPanelMode === 'run'
            ? session.kind !== 'task'
            : true;
      if (!isVisible) {
        continue;
      }

      visibleSessions.push(session);
      if (!firstVisibleSession) {
        firstVisibleSession = session;
      }
      if (session.id === selectedRunSessionId) {
        selectedSession = session;
      }
    }

    selectedSession ??= firstVisibleSession;
    return {
      hasFailedTests,
      selectedSession,
      visibleSessions,
    };
  }, [bottomPanelMode, runSessions, selectedRunSessionId]);
  const selectedDebugSession = useMemo(() => {
    for (const session of visibleDebugSessions) {
      if (session.id === selectedDebugSessionId) {
        return session;
      }
    }
    return visibleDebugSessions[0] ?? null;
  }, [selectedDebugSessionId, visibleDebugSessions]);
  const visibleRunSessions = runSessionState.visibleSessions;
  const selectedRunSession = runSessionState.selectedSession;
  const hasFailedTestSessions = runSessionState.hasFailedTests;

  useEffect(() => {
    debugCurrentFrameRef.current = selectedDebugSession?.currentFrame ?? null;
  }, [selectedDebugSession?.currentFrame]);

  useEffect(() => {
    activeCursorLineNumberRef.current = 1;
    activeCursorColumnRef.current = 1;
    cursorStoreRef.current.setSnapshot({
      lineNumber: 1,
      column: 1,
    });
  }, [activeFilePath]);

  useEffect(() => () => {
    if (activeCursorAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(activeCursorAnimationFrameRef.current);
      activeCursorAnimationFrameRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!isBlameVisible) {
      setBlameLines((currentLines) => (currentLines.length === 0 ? currentLines : []));
      return;
    }

    void loadBlameForActiveFile();
  }, [activeFilePath, isBlameVisible, loadBlameForActiveFile]);

  useEffect(() => {
    editorRef.current?.updateOptions?.(editorInlayHintOptions);
    secondaryEditorRef.current?.updateOptions?.(editorInlayHintOptions);
    diffEditorRef.current?.getModifiedEditor().updateOptions?.(editorInlayHintOptions);
  }, [editorInlayHintOptions]);

  useEffect(() => {
    const activeEditor = viewMode === 'diff'
      ? diffEditorRef.current?.getModifiedEditor() ?? null
      : editorRef.current;
    const currentFilePath = activeFilePathRef.current;
    if (!activeEditor || !currentFilePath) {
      clearDebugDecorations(activeEditor ?? undefined);
      return;
    }

    applyDebugDecorations(activeEditor, currentFilePath);
  }, [activeFilePath, applyDebugDecorations, breakpoints, clearDebugDecorations, selectedDebugSession?.currentFrame, viewMode]);

  useEffect(() => {
    if (!isActive) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isEditableTarget = target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || target?.isContentEditable === true;
      const hasPrimaryModifier = isMac
        ? event.metaKey && !event.ctrlKey
        : event.ctrlKey && !event.metaKey;

      if (event.key === 'Escape') {
        if (closeSearchEverywhere()) {
          event.preventDefault();
          return;
        }

        if (codeActionMenuControllerRef.current?.close()) {
          event.preventDefault();
          return;
        }
      }

      if (hasPrimaryModifier && !event.shiftKey && event.key.toLowerCase() === 'p') {
        event.preventDefault();
        openSearchEverywhere('all');
        return;
      }

      if (hasPrimaryModifier && !event.shiftKey && event.key.toLowerCase() === 'e') {
        event.preventDefault();
        openSearchEverywhere('recent');
        return;
      }

      if (hasPrimaryModifier && event.shiftKey && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        openSearchEverywhere('commands');
        return;
      }

      if (isEditableTarget) {
        return;
      }

      if (event.altKey && event.key === 'Enter') {
        event.preventDefault();
        void openCodeActionMenuRef.current();
        return;
      }

      if (event.altKey && event.key === 'ArrowLeft') {
        event.preventDefault();
        void navigateBackRef.current();
        return;
      }

      if (event.altKey && event.key === 'ArrowRight') {
        event.preventDefault();
        void navigateForwardRef.current();
        return;
      }

      if (hasPrimaryModifier && event.altKey && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        void goToImplementationAtCursorRef.current();
        return;
      }

      if (event.key === 'F1') {
        event.preventDefault();
        toggleQuickDocumentation();
        return;
      }

      if (event.key === 'F8') {
        event.preventDefault();
        void navigateProblem(event.shiftKey ? -1 : 1);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    closeSearchEverywhere,
    isActive,
    isMac,
    navigateProblem,
    openSearchEverywhere,
    toggleQuickDocumentation,
  ]);

  useEffect(() => {
    const handleRunSessionChanged = (_event: unknown, payload: CodePaneRunSessionChangedPayload) => {
      if (getPathComparisonKey(payload.rootPath) !== getPathComparisonKey(rootPath)) {
        return;
      }

      setRunSessions((currentSessions) => {
        return prependRecentSession(currentSessions, payload.session, areRunSessionsEqual);
      });
      setSelectedRunSessionId((currentSelectedSessionId) => (
        currentSelectedSessionId ?? (
          currentSelectedSessionId === payload.session.id ? currentSelectedSessionId : payload.session.id
        )
      ));
    };

    const handleRunSessionOutput = (_event: unknown, payload: CodePaneRunSessionOutputPayload) => {
      if (getPathComparisonKey(payload.rootPath) !== getPathComparisonKey(rootPath)) {
        return;
      }

      const nextOutput = `${runSessionOutputsRef.current[payload.sessionId] ?? ''}${payload.chunk}`;
      runSessionOutputsRef.current[payload.sessionId] = nextOutput;
      setSelectedRunSessionOutput((currentOutput) => (
        selectedRunSessionIdRef.current === payload.sessionId && currentOutput !== nextOutput
          ? nextOutput
          : currentOutput
      ));
    };

    window.electronAPI.onCodePaneRunSessionChanged(handleRunSessionChanged);
    window.electronAPI.onCodePaneRunSessionOutput(handleRunSessionOutput);

    return () => {
      window.electronAPI.offCodePaneRunSessionChanged(handleRunSessionChanged);
      window.electronAPI.offCodePaneRunSessionOutput(handleRunSessionOutput);
    };
  }, [rootPath]);

  useEffect(() => {
    const handleDebugSessionChanged = (_event: unknown, payload: CodePaneDebugSessionChangedPayload) => {
      if (getPathComparisonKey(payload.rootPath) !== getPathComparisonKey(rootPath)) {
        return;
      }

      setDebugSessions((currentSessions) => {
        const nextSessions = prependRecentSession(currentSessions, payload.session, areDebugSessionsEqual);
        const nextSnapshots = nextSessions.map((session) => ({
          session,
          output: debugSessionOutputsRef.current[session.id] ?? '',
        }));
        runtimeStoreRef.current.setCache(`debug-sessions:${rootPath}`, nextSnapshots);
        return nextSessions;
      });
      setSelectedDebugSessionId((currentSelectedSessionId) => (
        currentSelectedSessionId ?? (
          currentSelectedSessionId === payload.session.id ? currentSelectedSessionId : payload.session.id
        )
      ));
      const shouldLoadSelectedSessionDetails = selectedDebugSessionIdRef.current === null
        || selectedDebugSessionIdRef.current === payload.session.id;
      if (
        bottomPanelModeRef.current === 'debug'
        && shouldLoadSelectedSessionDetails
        && (payload.session.state === 'paused' || payload.session.state === 'stopped' || payload.session.state === 'error')
      ) {
        void loadDebugSessionDetailsRef.current(payload.session.id);
      }
    };

    const handleDebugSessionOutput = (_event: unknown, payload: CodePaneDebugSessionOutputPayload) => {
      if (getPathComparisonKey(payload.rootPath) !== getPathComparisonKey(rootPath)) {
        return;
      }

      const nextOutput = `${debugSessionOutputsRef.current[payload.sessionId] ?? ''}${payload.chunk}`;
      debugSessionOutputsRef.current[payload.sessionId] = nextOutput;
      runtimeStoreRef.current.setCache(`debug-sessions:${rootPath}`, debugSessionsRef.current.map((session) => ({
        session,
        output: debugSessionOutputsRef.current[session.id] ?? '',
      })));
      setSelectedDebugSessionOutput((currentOutput) => (
        selectedDebugSessionIdRef.current === payload.sessionId && currentOutput !== nextOutput
          ? nextOutput
          : currentOutput
      ));
    };

    window.electronAPI.onCodePaneDebugSessionChanged(handleDebugSessionChanged);
    window.electronAPI.onCodePaneDebugSessionOutput(handleDebugSessionOutput);

    return () => {
      window.electronAPI.offCodePaneDebugSessionChanged(handleDebugSessionChanged);
      window.electronAPI.offCodePaneDebugSessionOutput(handleDebugSessionOutput);
    };
  }, [rootPath]);

  const openFileLocation = useCallback(async (location: FileNavigationLocation) => {
    await openEditorLocation(location, {
      recordHistory: true,
      recordRecent: true,
      clearForward: true,
    });
  }, [openEditorLocation]);

  useEffect(() => {
    openFileLocationRef.current = openFileLocation;
  }, [openFileLocation]);

  const openContentSearchMatch = useCallback(async (match: CodePaneContentMatch) => {
    await openFileLocation({
      filePath: match.filePath,
      lineNumber: match.lineNumber,
      column: match.column,
    });
  }, [openFileLocation]);

  const navigateHistory = useCallback(async (direction: 'back' | 'forward') => {
    const sourceStackRef = direction === 'back'
      ? navigationBackStackRef
      : navigationForwardStackRef;
    const targetStackRef = direction === 'back'
      ? navigationForwardStackRef
      : navigationBackStackRef;
    const nextLocation = sourceStackRef.current[sourceStackRef.current.length - 1];

    if (!nextLocation) {
      return;
    }

    sourceStackRef.current = sourceStackRef.current.slice(0, -1);

    const currentLocation = getCurrentNavigationLocation();
    if (currentLocation && !isSameNavigationLocation(currentLocation, nextLocation)) {
      targetStackRef.current = [
        ...targetStackRef.current,
        currentLocation,
      ].slice(-CODE_PANE_MAX_NAVIGATION_HISTORY);
    }

    updateNavigationAvailability();
    await openEditorLocation({
      filePath: nextLocation.filePath,
      lineNumber: nextLocation.lineNumber,
      column: nextLocation.column,
      displayPath: nextLocation.displayPath,
    }, {
      preserveTabs: true,
      recordHistory: false,
      recordRecent: true,
      clearForward: false,
    });
  }, [getCurrentNavigationLocation, openEditorLocation, updateNavigationAvailability]);

  const navigateBack = useCallback(async () => {
    await navigateHistory('back');
  }, [navigateHistory]);

  const navigateForward = useCallback(async () => {
    await navigateHistory('forward');
  }, [navigateHistory]);

  useEffect(() => {
    navigateBackRef.current = navigateBack;
  }, [navigateBack]);

  useEffect(() => {
    navigateForwardRef.current = navigateForward;
  }, [navigateForward]);

  const goToImplementationAtCursor = useCallback(async () => {
    const context = getActiveEditorContext();
    if (!context) {
      return;
    }

    const response = await window.electronAPI.codePaneGetImplementations({
      rootPath,
      filePath: context.filePath,
      language: context.language,
      position: {
        lineNumber: context.position.lineNumber,
        column: context.position.column,
      },
    });

    if (!response.success) {
      setBanner({
        tone: 'warning',
        message: response.error || t('common.retry'),
        filePath: context.filePath,
      });
      return;
    }

    const implementation = response.data?.[0];
    if (!implementation) {
      setBanner({
        tone: 'info',
        message: t('codePane.goToImplementationEmpty'),
        filePath: context.filePath,
      });
      return;
    }

    await openEditorLocation({
      filePath: implementation.filePath,
      lineNumber: implementation.range.startLineNumber,
      column: implementation.range.startColumn,
      content: implementation.content,
      language: implementation.language,
      readOnly: implementation.readOnly,
      displayPath: implementation.displayPath,
      documentUri: implementation.uri,
    }, {
      preserveTabs: true,
      recordHistory: true,
      recordRecent: true,
      clearForward: true,
    });
  }, [getActiveEditorContext, openEditorLocation, rootPath, t]);

  useEffect(() => {
    goToImplementationAtCursorRef.current = goToImplementationAtCursor;
  }, [goToImplementationAtCursor]);

  const loadCodeActionMenuItems = useCallback(async (): Promise<CodeActionMenuLoadResult | null> => {
    const context = getActiveEditorContext();
    if (!context) {
      return null;
    }

    const wordRange = context.model.getWordAtPosition(context.position);
    const requestRange = wordRange
      ? {
          startLineNumber: context.position.lineNumber,
          startColumn: wordRange.startColumn,
          endLineNumber: context.position.lineNumber,
          endColumn: wordRange.endColumn,
        }
      : {
          startLineNumber: context.position.lineNumber,
          startColumn: context.position.column,
          endLineNumber: context.position.lineNumber,
          endColumn: context.position.column + 1,
        };

    const response = await window.electronAPI.codePaneGetCodeActions({
      rootPath,
      filePath: context.filePath,
      language: context.language,
      range: requestRange,
    });

    return {
      items: response.success ? (response.data ?? []) : [],
      error: response.success ? null : (response.error || t('common.retry')),
    };
  }, [getActiveEditorContext, rootPath, t]);

  const openCodeActionMenu = useCallback(async () => {
    await codeActionMenuControllerRef.current?.open();
  }, []);

  useEffect(() => {
    openCodeActionMenuRef.current = openCodeActionMenu;
  }, [openCodeActionMenu]);

  const runCodeActionFromMenu = useCallback(async (action: CodePaneCodeAction) => {
    const context = getActiveEditorContext();
    if (!context || action.disabledReason) {
      return {
        close: true,
      };
    }

    if (isRefactorCodeAction(action)) {
      await prepareRefactorPreview({
        kind: 'code-action',
        rootPath,
        filePath: context.filePath,
        language: context.language,
        actionId: action.id,
        title: action.title,
      });
      return {
        close: true,
      };
    }

    const response = await window.electronAPI.codePaneRunCodeAction({
      rootPath,
      filePath: context.filePath,
      language: context.language,
      actionId: action.id,
    });

    if (!response.success) {
      return {
        close: false,
        error: response.error || t('common.retry'),
      };
    }

    const didApply = await applyLanguageTextEdits(response.data ?? []);
    return {
      close: didApply,
      error: didApply ? null : t('common.retry'),
    };
  }, [applyLanguageTextEdits, getActiveEditorContext, prepareRefactorPreview, rootPath, t]);

  const loadRunTargets = useCallback(async () => {
    const requestKey = `run-targets:${rootPath}`;
    const requestVersion = runtimeStoreRef.current.markLatest(requestKey);
    const activeFilePath = activeFilePathRef.current;
    const cacheKey = `${requestKey}:${activeFilePath ?? ''}`;
    const cachedTargets = runtimeStoreRef.current.getCache<CodePaneRunTarget[]>(
      cacheKey,
      CODE_PANE_TOOL_WINDOW_CACHE_TTL_MS,
    );
    if (cachedTargets) {
      runtimeStoreRef.current.recordRequest(requestKey, t('codePane.requestRunTargets'), {
        meta: activeFilePath ? getRelativePath(rootPath, activeFilePath) : undefined,
        fromCache: true,
      });
      setRunTargets((currentTargets) => (
        areRunTargetsEqual(currentTargets, cachedTargets) ? currentTargets : cachedTargets
      ));
      setRunTargetsError((currentError) => (
        currentError === null ? currentError : null
      ));
      setIsRunTargetsLoading((currentLoading) => (currentLoading ? false : currentLoading));
      return;
    }

    setIsRunTargetsLoading((currentLoading) => (currentLoading ? currentLoading : true));
    setRunTargetsError((currentError) => (currentError === null ? currentError : null));

    const response = await trackRequest(
      requestKey,
      t('codePane.requestRunTargets'),
      activeFilePath ? getRelativePath(rootPath, activeFilePath) : undefined,
      async () => await dedupeProjectRequest(
        rootPath,
        cacheKey,
        async () => await window.electronAPI.codePaneListRunTargets({
          rootPath,
          activeFilePath,
        }),
      ),
    );
    if (!runtimeStoreRef.current.isLatest(requestKey, requestVersion)) {
      return;
    }

    const nextTargets = response.success ? (response.data ?? []) : [];
    if (response.success) {
      runtimeStoreRef.current.setCache(cacheKey, nextTargets);
    }
    const nextError = response.success ? null : (response.error || t('common.retry'));
    setRunTargets((currentTargets) => (
      areRunTargetsEqual(currentTargets, nextTargets) ? currentTargets : nextTargets
    ));
    setRunTargetsError((currentError) => (
      currentError === nextError ? currentError : nextError
    ));
    setIsRunTargetsLoading((currentLoading) => (currentLoading === false ? currentLoading : false));
  }, [rootPath, t, trackRequest]);

  const loadDebugSessionDetails = useCallback(async (sessionId: string | null) => {
    if (!sessionId) {
      setDebugSessionDetails((currentDetails) => (currentDetails === null ? currentDetails : null));
      setIsDebugDetailsLoading((currentLoading) => (currentLoading ? false : currentLoading));
      return;
    }

    const targetSession = debugSessionsRef.current.find((session) => session.id === sessionId) ?? null;
    if (targetSession?.state === 'running') {
      setDebugSessionDetails((currentDetails) => (currentDetails === null ? currentDetails : null));
      setIsDebugDetailsLoading((currentLoading) => (currentLoading ? false : currentLoading));
      return;
    }

    const requestKey = `debug-details:${sessionId}`;
    const requestVersion = runtimeStoreRef.current.markLatest(requestKey);
    const cacheKey = `${requestKey}:${targetSession?.state ?? 'unknown'}`;
    const cachedDetails = runtimeStoreRef.current.getCache<CodePaneDebugSessionDetails | null>(
      cacheKey,
      CODE_PANE_TOOL_WINDOW_CACHE_TTL_MS,
    );
    if (cachedDetails) {
      runtimeStoreRef.current.recordRequest(requestKey, t('codePane.requestDebugSessionDetails'), {
        meta: sessionId,
        fromCache: true,
      });
      setDebugSessionDetails((currentDetails) => (
        areDebugSessionDetailsEqual(currentDetails, cachedDetails) ? currentDetails : cachedDetails
      ));
      setIsDebugDetailsLoading((currentLoading) => (currentLoading ? false : currentLoading));
      return;
    }

    setIsDebugDetailsLoading((currentLoading) => (currentLoading ? currentLoading : true));
    const response = await trackRequest(
      requestKey,
      t('codePane.requestDebugSessionDetails'),
      sessionId,
      async () => await dedupeProjectRequest(
        rootPath,
        cacheKey,
        async () => await window.electronAPI.codePaneGetDebugSessionDetails({
          sessionId,
        }),
      ),
    );
    if (!runtimeStoreRef.current.isLatest(requestKey, requestVersion)) {
      return;
    }
    const nextDetails = response.success ? (response.data ?? null) : null;
    if (response.success) {
      runtimeStoreRef.current.setCache(cacheKey, nextDetails);
    }
    setDebugSessionDetails((currentDetails) => (
      areDebugSessionDetailsEqual(currentDetails, nextDetails) ? currentDetails : nextDetails
    ));
    setIsDebugDetailsLoading((currentLoading) => (currentLoading === false ? currentLoading : false));
  }, [t, trackRequest]);

  useEffect(() => {
    loadDebugSessionDetailsRef.current = loadDebugSessionDetails;
  }, [loadDebugSessionDetails]);

  const loadTests = useCallback(async () => {
    const requestKey = `tests:${rootPath}`;
    const requestVersion = runtimeStoreRef.current.markLatest(requestKey);
    const activeFilePath = activeFilePathRef.current;
    const cacheKey = `${requestKey}:${activeFilePath ?? ''}`;
    const cachedTests = runtimeStoreRef.current.getCache<CodePaneTestItem[]>(
      cacheKey,
      CODE_PANE_TOOL_WINDOW_CACHE_TTL_MS,
    );
    if (cachedTests) {
      runtimeStoreRef.current.recordRequest(requestKey, t('codePane.requestTestDiscovery'), {
        meta: activeFilePath ? getRelativePath(rootPath, activeFilePath) : undefined,
        fromCache: true,
      });
      setTestItems((currentItems) => (
        areTestItemListsEqual(currentItems, cachedTests) ? currentItems : cachedTests
      ));
      setTestsError((currentError) => (
        currentError === null ? currentError : null
      ));
      setIsTestsLoading((currentLoading) => (currentLoading ? false : currentLoading));
      return;
    }

    setIsTestsLoading((currentLoading) => (currentLoading ? currentLoading : true));
    setTestsError((currentError) => (currentError === null ? currentError : null));

    const response = await trackRequest(
      requestKey,
      t('codePane.requestTestDiscovery'),
      activeFilePath ? getRelativePath(rootPath, activeFilePath) : undefined,
      async () => await dedupeProjectRequest(
        rootPath,
        cacheKey,
        async () => await window.electronAPI.codePaneListTests({
          rootPath,
          activeFilePath,
        }),
      ),
    );
    if (!runtimeStoreRef.current.isLatest(requestKey, requestVersion)) {
      return;
    }

    const nextTestItems = response.success ? (response.data ?? []) : [];
    if (response.success) {
      runtimeStoreRef.current.setCache(cacheKey, nextTestItems);
    }
    const nextError = response.success ? null : (response.error || t('common.retry'));
    setTestItems((currentItems) => (
      areTestItemListsEqual(currentItems, nextTestItems) ? currentItems : nextTestItems
    ));
    setTestsError((currentError) => (
      currentError === nextError ? currentError : nextError
    ));
    setIsTestsLoading((currentLoading) => (currentLoading === false ? currentLoading : false));
  }, [rootPath, t, trackRequest]);

  const loadProjectContributions = useCallback(async (refresh = false) => {
    const requestKey = `project-model:${rootPath}`;
    const requestVersion = runtimeStoreRef.current.markLatest(requestKey);
    const cacheKey = `${requestKey}:${refresh ? 'refresh' : 'read'}`;
    if (!refresh) {
      const cachedContributions = runtimeStoreRef.current.getCache<CodePaneProjectContribution[]>(
        cacheKey,
        CODE_PANE_TOOL_WINDOW_CACHE_TTL_MS,
      );
      if (cachedContributions) {
        runtimeStoreRef.current.recordRequest(requestKey, t('codePane.requestProjectContribution'), {
          meta: rootPath,
          fromCache: true,
        });
        setProjectContributions((currentContributions) => (
          areProjectContributionListsEqual(currentContributions, cachedContributions)
            ? currentContributions
            : cachedContributions
        ));
        setProjectError((currentError) => (
          currentError === null ? currentError : null
        ));
        setIsProjectLoading((currentLoading) => (currentLoading ? false : currentLoading));
        return;
      }
    }

    setIsProjectLoading((currentLoading) => (currentLoading ? currentLoading : true));
    setProjectError((currentError) => (currentError === null ? currentError : null));

    if (refresh) {
      invalidateProjectCache(rootPath, 'external-libraries');
    }

    const response = await trackRequest(
      requestKey,
      refresh ? t('codePane.requestRefreshProjectModel') : t('codePane.requestProjectContribution'),
      rootPath,
      async () => await dedupeProjectRequest(
        rootPath,
        cacheKey,
        async () => refresh
          ? await window.electronAPI.codePaneRefreshProjectModel({ rootPath })
          : await window.electronAPI.codePaneGetProjectContribution({ rootPath }),
      ),
    );
    if (!runtimeStoreRef.current.isLatest(requestKey, requestVersion)) {
      return;
    }

    const nextContributions = response.success ? (response.data ?? []) : [];
    if (response.success) {
      runtimeStoreRef.current.setCache(cacheKey, nextContributions);
    }
    const nextError = response.success ? null : (response.error || t('common.retry'));
    setProjectContributions((currentContributions) => (
      areProjectContributionListsEqual(currentContributions, nextContributions)
        ? currentContributions
        : nextContributions
    ));
    setProjectError((currentError) => (
      currentError === nextError ? currentError : nextError
    ));
    setIsProjectLoading((currentLoading) => (currentLoading === false ? currentLoading : false));

    if (refresh && response.success) {
      void loadExternalLibrarySections({ force: true });
      scheduleGitStatusRefresh({ force: true });
    }
  }, [loadExternalLibrarySections, rootPath, scheduleGitStatusRefresh, t, trackRequest]);

  const runTargetById = useCallback(async (targetId: string) => {
    const response = await window.electronAPI.codePaneRunTarget({
      rootPath,
      targetId,
      customization: getRunTargetCustomization(targetId),
    });

    if (!response.success || !response.data) {
      setBanner({
        tone: 'error',
        message: response.error || t('common.retry'),
      });
      return;
    }

    setBottomPanelMode((currentMode) => (currentMode === 'run' ? currentMode : 'run'));
    setSelectedRunSessionId((currentSessionId) => (
      currentSessionId === response.data!.id ? currentSessionId : response.data!.id
    ));
  }, [getRunTargetCustomization, rootPath, t]);

  const debugTargetById = useCallback(async (targetId: string) => {
    await loadExceptionBreakpoints();
    const response = await window.electronAPI.codePaneDebugStart({
      rootPath,
      targetId,
      customization: getRunTargetCustomization(targetId),
    });

    if (!response.success || !response.data) {
      setBanner({
        tone: 'error',
        message: response.error || t('common.retry'),
      });
      return;
    }

    setBottomPanelMode((currentMode) => (currentMode === 'debug' ? currentMode : 'debug'));
    setSelectedDebugSessionId((currentSessionId) => (
      currentSessionId === response.data!.id ? currentSessionId : response.data!.id
    ));
  }, [getRunTargetCustomization, loadExceptionBreakpoints, rootPath, t]);

  const runTestTarget = useCallback(async (targetId: string) => {
    const response = await window.electronAPI.codePaneRunTests({
      rootPath,
      targetId,
      customization: getRunTargetCustomization(targetId),
    });

    if (!response.success || !response.data) {
      setBanner({
        tone: 'error',
        message: response.error || t('common.retry'),
      });
      return;
    }

    setBottomPanelMode((currentMode) => (currentMode === 'tests' ? currentMode : 'tests'));
    setSelectedRunSessionId((currentSessionId) => (
      currentSessionId === response.data!.id ? currentSessionId : response.data!.id
    ));
  }, [getRunTargetCustomization, rootPath, t]);

  const rerunFailedTests = useCallback(async () => {
    const response = await window.electronAPI.codePaneRerunFailedTests({
      rootPath,
    });

    if (!response.success) {
      setBanner({
        tone: 'error',
        message: response.error || t('common.retry'),
      });
      return;
    }

    const latestSession = response.data?.at(-1) ?? null;
    if (latestSession) {
      setBottomPanelMode((currentMode) => (currentMode === 'tests' ? currentMode : 'tests'));
      setSelectedRunSessionId((currentSessionId) => (
        currentSessionId === latestSession.id ? currentSessionId : latestSession.id
      ));
    }
  }, [rootPath, t]);

  const stopRunSession = useCallback(async (sessionId: string) => {
    const response = await window.electronAPI.codePaneStopRunTarget({
      sessionId,
    });

    if (!response.success) {
      setBanner({
        tone: 'error',
        message: response.error || t('common.retry'),
      });
    }
  }, [t]);

  const runProjectCommandById = useCallback(async (commandId: string) => {
    const response = await window.electronAPI.codePaneRunProjectCommand({
      rootPath,
      commandId,
    });

    if (!response.success) {
      setBanner({
        tone: 'error',
        message: response.error || t('common.retry'),
      });
      return;
    }

    setBottomPanelMode((currentMode) => (currentMode === 'project' ? currentMode : 'project'));
    if (response.data) {
      setSelectedRunSessionId((currentSessionId) => (
        currentSessionId === response.data!.id ? currentSessionId : response.data!.id
      ));
      return;
    }

    void loadProjectContributions(true);
  }, [loadProjectContributions, rootPath, t]);

  const stopDebugSession = useCallback(async (sessionId: string) => {
    const response = await window.electronAPI.codePaneDebugStop({
      sessionId,
    });

    if (!response.success) {
      setBanner({
        tone: 'error',
        message: response.error || t('common.retry'),
      });
    }
  }, [t]);

  const pauseDebugSession = useCallback(async (sessionId: string) => {
    const response = await window.electronAPI.codePaneDebugPause({
      sessionId,
    });

    if (!response.success) {
      setBanner({
        tone: 'error',
        message: response.error || t('common.retry'),
      });
    }
  }, [t]);

  const continueDebugSession = useCallback(async (sessionId: string) => {
    const response = await window.electronAPI.codePaneDebugContinue({
      sessionId,
    });

    if (!response.success) {
      setBanner({
        tone: 'error',
        message: response.error || t('common.retry'),
      });
    }
  }, [t]);

  const stepDebugSession = useCallback(async (
    sessionId: string,
    step: 'over' | 'into' | 'out',
  ) => {
    const action = step === 'over'
      ? window.electronAPI.codePaneDebugStepOver
      : step === 'into'
        ? window.electronAPI.codePaneDebugStepInto
        : window.electronAPI.codePaneDebugStepOut;
    const response = await action({
      sessionId,
    });

    if (!response.success) {
      setBanner({
        tone: 'error',
        message: response.error || t('common.retry'),
      });
    }
  }, [t]);

  const evaluateDebugExpression = useCallback(async (expression: string) => {
    if (!selectedDebugSession) {
      return;
    }

    const response = await window.electronAPI.codePaneDebugEvaluate({
      sessionId: selectedDebugSession.id,
      expression,
    });

    if (!response.success || !response.data) {
      setBanner({
        tone: 'error',
        message: response.error || t('common.retry'),
      });
      return;
    }

    setDebugEvaluations((currentEvaluations) => [
      {
        id: `${selectedDebugSession.id}:${Date.now()}`,
        expression,
        value: response.data?.value ?? '',
      },
      ...currentEvaluations,
    ].slice(0, 20));
  }, [selectedDebugSession, t]);

  const refreshDebugWatches = useCallback(async (
    sessionOverride?: CodePaneDebugSession | null,
    expressionsOverride?: string[],
  ) => {
    const targetSession = sessionOverride ?? selectedDebugSession;
    const expressions = expressionsOverride ?? watchExpressions;
    const requestId = debugWatchRefreshRequestIdRef.current + 1;
    debugWatchRefreshRequestIdRef.current = requestId;
    if (expressions.length === 0) {
      setWatchEntries((currentEntries) => (currentEntries.length === 0 ? currentEntries : []));
      return;
    }

    if (!targetSession || targetSession.state !== 'paused') {
      setWatchEntries((currentEntries) => {
        const currentEntriesByExpression = new Map<string, DebugWatchEntry>();
        for (const entry of currentEntries) {
          currentEntriesByExpression.set(entry.expression, entry);
        }

        const nextEntries: DebugWatchEntry[] = [];
        for (const expression of expressions) {
          nextEntries.push(currentEntriesByExpression.get(expression) ?? {
            id: expression,
            expression,
          });
        }
        return areDebugWatchEntriesEqual(currentEntries, nextEntries) ? currentEntries : nextEntries;
      });
      return;
    }

    const evaluationRequests: Array<Promise<DebugWatchEntry>> = [];
    for (const expression of expressions) {
      evaluationRequests.push((async () => {
        const response = await window.electronAPI.codePaneDebugEvaluate({
          sessionId: targetSession.id,
          expression,
        });
        if (!response.success) {
          return {
            id: expression,
            expression,
            error: response.error || t('common.retry'),
          };
        }

        return {
          id: expression,
          expression,
          value: response.data?.value ?? '',
        };
      })());
    }
    const nextEntries = await Promise.all(evaluationRequests);
    if (debugWatchRefreshRequestIdRef.current !== requestId) {
      return;
    }
    setWatchEntries((currentEntries) => (
      areDebugWatchEntriesEqual(currentEntries, nextEntries) ? currentEntries : nextEntries
    ));
  }, [selectedDebugSession, t, watchExpressions]);

  const addDebugWatchExpression = useCallback(async (expression: string) => {
    const normalizedExpression = expression.trim();
    if (!normalizedExpression) {
      return;
    }

    const nextExpressions = normalizeWatchExpressions([...watchExpressions, normalizedExpression]);
    persistWatchExpressions(nextExpressions);
    await refreshDebugWatches(selectedDebugSession, nextExpressions);
  }, [persistWatchExpressions, refreshDebugWatches, selectedDebugSession, watchExpressions]);

  const removeDebugWatchExpression = useCallback((expression: string) => {
    const nextExpressions: string[] = [];
    for (const watchExpression of watchExpressions) {
      if (watchExpression !== expression) {
        nextExpressions.push(watchExpression);
      }
    }
    persistWatchExpressions(nextExpressions);
    setWatchEntries((currentEntries) => {
      const nextEntries: DebugWatchEntry[] = [];
      for (const entry of currentEntries) {
        if (entry.expression !== expression) {
          nextEntries.push(entry);
        }
      }
      return areDebugWatchEntriesEqual(currentEntries, nextEntries) ? currentEntries : nextEntries;
    });
  }, [persistWatchExpressions, watchExpressions]);

  const openTestItem = useCallback(async (item: CodePaneTestItem) => {
    if (!item.filePath) {
      return;
    }

    await openEditorLocation({
      filePath: item.filePath,
      lineNumber: 1,
      column: 1,
    }, {
      preserveTabs: true,
      recordHistory: true,
      recordRecent: true,
      clearForward: true,
    });
  }, [openEditorLocation]);

  const openDebugFrame = useCallback(async (frameId: string) => {
    let frame: CodePaneDebugSessionDetails['stackFrames'][number] | null = null;
    for (const candidate of debugSessionDetails?.stackFrames ?? []) {
      if (candidate.id === frameId) {
        frame = candidate;
        break;
      }
    }
    if (!frame?.filePath || !frame.lineNumber) {
      return;
    }

    await openEditorLocation({
      filePath: frame.filePath,
      lineNumber: frame.lineNumber,
      column: frame.column ?? 1,
    }, {
      preserveTabs: true,
      recordHistory: true,
      recordRecent: true,
      clearForward: true,
    });
  }, [debugSessionDetails?.stackFrames, openEditorLocation]);

  const updateBreakpoint = useCallback(async (breakpoint: CodePaneBreakpoint) => {
    const normalizedBreakpoint = normalizeBreakpoint(breakpoint);
    const response = await window.electronAPI.codePaneSetBreakpoint({
      rootPath,
      breakpoint: normalizedBreakpoint,
    });

    if (!response.success) {
      setBanner({
        tone: 'error',
        message: response.error || t('common.retry'),
        filePath: normalizedBreakpoint.filePath,
      });
      return;
    }

    const breakpointKey = getBreakpointKey(normalizedBreakpoint);
    const nextBreakpoints: CodePaneBreakpoint[] = [];
    let didReplace = false;
    for (const candidate of breakpointsRef.current) {
      if (getBreakpointKey(candidate) === breakpointKey) {
        nextBreakpoints.push(normalizedBreakpoint);
        didReplace = true;
      } else {
        nextBreakpoints.push(candidate);
      }
    }
    if (!didReplace) {
      nextBreakpoints.push(normalizedBreakpoint);
    }
    persistDebugBreakpoints(nextBreakpoints);
  }, [persistDebugBreakpoints, rootPath, t]);

  const removeBreakpoint = useCallback(async (breakpoint: CodePaneBreakpoint) => {
    const normalizedBreakpoint = normalizeBreakpoint(breakpoint);
    const response = await window.electronAPI.codePaneRemoveBreakpoint({
      rootPath,
      breakpoint: normalizedBreakpoint,
    });

    if (!response.success) {
      setBanner({
        tone: 'error',
        message: response.error || t('common.retry'),
        filePath: normalizedBreakpoint.filePath,
      });
      return;
    }

    const breakpointKey = getBreakpointKey(normalizedBreakpoint);
    const nextBreakpoints: CodePaneBreakpoint[] = [];
    for (const candidate of breakpointsRef.current) {
      if (getBreakpointKey(candidate) !== breakpointKey) {
        nextBreakpoints.push(candidate);
      }
    }
    persistDebugBreakpoints(nextBreakpoints);
  }, [persistDebugBreakpoints, rootPath, t]);

  const setExceptionBreakpoint = useCallback(async (
    breakpointId: CodePaneExceptionBreakpoint['id'],
    enabled: boolean,
  ) => {
    const nextRawBreakpoints: typeof exceptionBreakpointsRef.current = [];
    for (const breakpoint of exceptionBreakpointsRef.current) {
      nextRawBreakpoints.push(
        breakpoint.id === breakpointId
          ? { ...breakpoint, enabled }
          : breakpoint,
      );
    }
    const nextBreakpoints = normalizeExceptionBreakpoints(nextRawBreakpoints);
    const response = await window.electronAPI.codePaneSetExceptionBreakpoints({
      rootPath,
      breakpoints: nextBreakpoints,
    });
    if (!response.success) {
      setBanner({
        tone: 'error',
        message: response.error || t('common.retry'),
      });
      return;
    }

    runtimeStoreRef.current.setCache(`exception-breakpoints:${rootPath}`, nextBreakpoints);
    persistExceptionBreakpoints(nextBreakpoints);
  }, [persistExceptionBreakpoints, rootPath, t]);

  const toggleBreakpoint = useCallback(async (filePath: string, lineNumber: number) => {
    const normalizedBreakpoint = normalizeBreakpoint({
      filePath,
      lineNumber,
    });
    const breakpointKey = getBreakpointKey(normalizedBreakpoint);
    let existingBreakpoint: CodePaneBreakpoint | null = null;
    for (const candidate of breakpointsRef.current) {
      if (getBreakpointKey(candidate) === breakpointKey) {
        existingBreakpoint = candidate;
        break;
      }
    }
    if (existingBreakpoint) {
      await removeBreakpoint(existingBreakpoint);
      return;
    }

    await updateBreakpoint(normalizedBreakpoint);
  }, [removeBreakpoint, updateBreakpoint]);

  useEffect(() => {
    toggleBreakpointRef.current = toggleBreakpoint;
  }, [toggleBreakpoint]);

  const toggleBottomPanelMode = useCallback((mode: BottomPanelMode) => {
    setBottomPanelMode((currentMode) => (currentMode === mode ? null : mode));
  }, []);

  const openGitWorkbench = useCallback((initialTab: GitToolWindowTab = 'log') => {
    setActiveGitWorkbenchTab((currentTab) => (currentTab === initialTab ? currentTab : initialTab));
    setBottomPanelMode((currentMode) => (currentMode === 'git' ? currentMode : 'git'));
  }, []);

  const toggleHierarchyToolWindow = useCallback(() => {
    if (!activeFilePath) {
      return;
    }

    if (bottomPanelMode === 'hierarchy') {
      setBottomPanelMode((currentMode) => (currentMode === null ? currentMode : null));
      return;
    }

    void openHierarchyPanel(selectedHierarchyMode);
  }, [activeFilePath, bottomPanelMode, openHierarchyPanel, selectedHierarchyMode]);

  const refreshVisibleBottomPanelData = useCallback((options?: { forceProjectRefresh?: boolean }) => {
    const currentBottomPanelMode = bottomPanelModeRef.current;

    if (currentBottomPanelMode === 'run') {
      void loadRunTargets();
      return;
    }

    if (currentBottomPanelMode === 'debug') {
      void loadRunTargets();
      void loadDebugSessions();
      void loadExceptionBreakpoints();
      void loadDebugSessionDetails(selectedDebugSessionIdRef.current);
      return;
    }

    if (currentBottomPanelMode === 'tests') {
      void loadTests();
      return;
    }

    if (currentBottomPanelMode === 'project') {
      void loadProjectContributions(options?.forceProjectRefresh === true);
      return;
    }

    if (currentBottomPanelMode === 'outline') {
      void loadDocumentSymbols();
      return;
    }

    if (currentBottomPanelMode === 'git') {
      const shouldLoadBranches = shouldLoadGitBranches();
      const shouldLoadRebasePlan = shouldLoadGitRebasePlan();
      refreshVisibleGitWorkbenchData();
      if (shouldLoadBranches) {
        void loadGitBranches({ preferredBaseRef: gitRebaseBaseRefRef.current });
      }
      if (shouldLoadRebasePlan && gitRebaseBaseRefRef.current) {
        void loadGitRebasePlan(gitRebaseBaseRefRef.current);
      }
      return;
    }

    if (currentBottomPanelMode === 'conflict') {
      void loadGitConflictDetails(selectedGitConflictPath);
      return;
    }

    if (currentBottomPanelMode === 'history') {
      void loadGitHistory({
        filePath: gitHistory?.targetFilePath,
        lineNumber: gitHistory?.targetLineNumber,
      });
      return;
    }

    if (currentBottomPanelMode === 'workspace') {
      void loadTodoEntries();
      return;
    }

    if (currentBottomPanelMode === 'hierarchy') {
      void loadHierarchyRoot(selectedHierarchyMode);
      return;
    }

    if (currentBottomPanelMode === 'semantic') {
      void loadSemanticSummary();
    }
  }, [
    gitHistory?.targetFilePath,
    gitHistory?.targetLineNumber,
    loadDebugSessionDetails,
    loadDebugSessions,
    loadDocumentSymbols,
    loadExceptionBreakpoints,
    loadGitBranches,
    loadGitConflictDetails,
    loadGitHistory,
    loadGitRebasePlan,
    loadHierarchyRoot,
    loadProjectContributions,
    loadRunTargets,
    loadSemanticSummary,
    loadTests,
    loadTodoEntries,
    refreshVisibleGitWorkbenchData,
    selectedGitConflictPath,
    selectedHierarchyMode,
    shouldLoadGitBranches,
    shouldLoadGitRebasePlan,
  ]);

  const refreshBottomPanel = useCallback(() => {
    if (bottomPanelModeRef.current === 'performance') {
      return;
    }

    refreshVisibleBottomPanelData({ forceProjectRefresh: true });
  }, [refreshVisibleBottomPanelData]);

  useEffect(() => {
    if (bottomPanelMode === 'run') {
      refreshVisibleBottomPanelData();
    }
  }, [bottomPanelMode, refreshVisibleBottomPanelData]);

  useEffect(() => {
    if (bottomPanelMode !== 'debug') {
      return;
    }

    refreshVisibleBottomPanelData();
  }, [bottomPanelMode, refreshVisibleBottomPanelData]);

  useEffect(() => {
    if (bottomPanelMode === 'tests') {
      refreshVisibleBottomPanelData();
    }
  }, [bottomPanelMode, refreshVisibleBottomPanelData]);

  useEffect(() => {
    if (bottomPanelMode === 'project') {
      refreshVisibleBottomPanelData();
    }
  }, [bottomPanelMode, refreshVisibleBottomPanelData]);

  useEffect(() => {
    if (bottomPanelMode === 'outline') {
      refreshVisibleBottomPanelData();
    }
  }, [bottomPanelMode, refreshVisibleBottomPanelData]);

  useEffect(() => {
    if (bottomPanelMode !== 'git') {
      return;
    }

    refreshVisibleBottomPanelData();
  }, [activeGitWorkbenchTab, bottomPanelMode, refreshVisibleBottomPanelData]);

  useEffect(() => {
    if (bottomPanelMode === 'conflict' && selectedGitConflictPath) {
      refreshVisibleBottomPanelData();
    }
  }, [bottomPanelMode, refreshVisibleBottomPanelData, selectedGitConflictPath]);

  useEffect(() => {
    if (bottomPanelMode === 'history' && gitHistory?.targetFilePath) {
      refreshVisibleBottomPanelData();
    }
  }, [bottomPanelMode, gitHistory?.targetFilePath, gitHistory?.targetLineNumber, refreshVisibleBottomPanelData]);

  useEffect(() => {
    if (bottomPanelMode === 'workspace') {
      refreshVisibleBottomPanelData();
    }
  }, [bottomPanelMode, refreshVisibleBottomPanelData]);

  useEffect(() => {
    if (bottomPanelMode === 'hierarchy') {
      refreshVisibleBottomPanelData();
    }
  }, [bottomPanelMode, refreshVisibleBottomPanelData, selectedHierarchyMode]);

  useEffect(() => {
    if (bottomPanelMode === 'semantic') {
      refreshVisibleBottomPanelData();
    }
  }, [bottomPanelMode, refreshVisibleBottomPanelData]);

  useEffect(() => {
    if (bottomPanelMode !== 'debug') {
      return;
    }

    void loadDebugSessionDetails(selectedDebugSessionId);
  }, [bottomPanelMode, loadDebugSessionDetails, selectedDebugSessionId]);

  useEffect(() => {
    const nextOutput = selectedRunSession ? (runSessionOutputsRef.current[selectedRunSession.id] ?? '') : '';
    setSelectedRunSessionOutput((currentOutput) => (
      currentOutput === nextOutput ? currentOutput : nextOutput
    ));
  }, [selectedRunSession]);

  useEffect(() => {
    const nextOutput = selectedDebugSession ? (debugSessionOutputsRef.current[selectedDebugSession.id] ?? '') : '';
    setSelectedDebugSessionOutput((currentOutput) => (
      currentOutput === nextOutput ? currentOutput : nextOutput
    ));
  }, [selectedDebugSession]);

  useEffect(() => {
    setDebugEvaluations((currentEvaluations) => (
      currentEvaluations.length === 0 ? currentEvaluations : []
    ));
  }, [selectedDebugSessionId]);

  useEffect(() => {
    if (bottomPanelMode !== 'debug') {
      return;
    }

    void refreshDebugWatches(selectedDebugSession);
  }, [bottomPanelMode, refreshDebugWatches, selectedDebugSession, watchExpressions]);

  const handlePaneClose = useCallback(async () => {
    if (!onClose) {
      return;
    }

    const didFlush = await flushDirtyFiles();
    if (!didFlush) {
      return;
    }

    onClose();
  }, [flushDirtyFiles, onClose]);

  const closeBottomPanel = useCallback(() => {
    setBottomPanelMode((currentMode) => (currentMode === null ? currentMode : null));
  }, []);

  const handleGitWorkbenchTabChange = useCallback((tab: GitToolWindowTab) => {
    setActiveGitWorkbenchTab((currentTab) => (currentTab === tab ? currentTab : tab));
  }, []);

  const handleGitWorkbenchRefreshRebase = useCallback(() => {
    const baseRef = gitRebaseBaseRefRef.current;
    if (!baseRef) {
      return;
    }

    void loadGitRebasePlan(baseRef);
  }, [loadGitRebasePlan]);

  const handleGitStagePath = useCallback((filePath: string) => {
    void stageGitPaths([filePath]);
  }, [stageGitPaths]);

  const handleGitUnstagePath = useCallback((filePath: string) => {
    void unstageGitPaths([filePath]);
  }, [unstageGitPaths]);

  const handleGitWorkbenchDiscardPath = useCallback((filePath: string, restoreStaged: boolean) => {
    void discardGitPaths([filePath], restoreStaged);
  }, [discardGitPaths]);

  const handleCommitWindowDiscardPath = useCallback((filePath: string) => {
    void discardGitPaths([filePath], Boolean(gitStatusByPathRef.current[filePath]?.staged));
  }, [discardGitPaths]);

  const handleGitOpenFileDiff = useCallback((filePath: string) => {
    void openDiffForFile(filePath);
  }, [openDiffForFile]);

  const handleGitOpenConflictResolver = useCallback((filePath: string) => {
    void openGitConflictResolver(filePath);
  }, [openGitConflictResolver]);

  const handleGitResolveConflict = useCallback((filePath: string, resolution: 'ours' | 'theirs') => {
    void resolveGitConflict(filePath, resolution);
  }, [resolveGitConflict]);

  const handleGitShowFileHistory = useCallback((filePath: string) => {
    void loadGitHistory({ filePath });
  }, [loadGitHistory]);

  const handleGitRevealInExplorer = useCallback((filePath: string) => {
    void revealPathInExplorer(filePath);
  }, [revealPathInExplorer]);

  const handleGitWorkbenchRequestRenameBranch = useCallback((branchName: string) => {
    openActionInputDialog({
      kind: 'rename-branch',
      branchName,
      initialValue: branchName,
    }, { deferred: true });
  }, [openActionInputDialog]);

  const handleGitWorkbenchDeleteBranch = useCallback((branchName: string, force?: boolean) => {
    openActionConfirmDialog({
      kind: 'delete-branch',
      branchName,
      force: Boolean(force),
    }, { deferred: true });
  }, [openActionConfirmDialog]);

  const handleGitWorkbenchCompareSelectedCommits = useCallback(() => {
    const [baseCommitSha, targetCommitSha] = selectedGitCommitOrderRef.current;
    if (!baseCommitSha || !targetCommitSha) {
      return;
    }

    void compareSelectedGitCommits(baseCommitSha, targetCommitSha);
  }, [compareSelectedGitCommits]);

  const handleGitWorkbenchOpenCommitFileDiff = useCallback((config: {
    filePath: string;
    leftCommitSha?: string;
    rightCommitSha?: string;
    rightLabel?: string;
    leftLabel?: string;
  }) => {
    void openGitRevisionDiff({
      filePath: config.filePath,
      leftCommitSha: config.leftCommitSha,
      rightCommitSha: config.rightCommitSha,
      leftLabel: config.leftLabel,
      rightLabel: config.rightLabel,
    });
  }, [openGitRevisionDiff]);

  const handleCommitWindowOpenChange = useCallback((nextOpen: boolean) => {
    if (!nextOpen) {
      commitWindowStateRef.current = null;
      setCommitWindowState((currentState) => (currentState === null ? currentState : null));
    }
  }, []);

  const handleCommitWindowRefresh = useCallback(() => {
    scheduleGitStatusRefresh({ force: true });
  }, [scheduleGitStatusRefresh]);

  const handleScmRefreshStatus = useCallback(() => {
    scheduleGitStatusRefresh({ force: true });
  }, [scheduleGitStatusRefresh]);

  const handleScmOpenRepository = useCallback(() => {
    void window.electronAPI.openFolder(gitRepositorySummaryRef.current?.repoRootPath ?? rootPath);
  }, [rootPath]);

  const handleScmCopyBranchName = useCallback(() => {
    const currentBranch = getCurrentGitBranch(
      gitBranchesRef.current,
      gitRepositorySummaryRef.current?.currentBranch,
    );
    const copyValue = currentBranch?.name ?? gitRepositorySummaryRef.current?.headSha ?? '';
    if (copyValue) {
      void window.electronAPI.writeClipboardText(copyValue);
    }
  }, []);

  const handleScmStageAll = useCallback(() => {
    const paths: string[] = [];
    for (const entry of gitStatusEntriesRef.current) {
      paths.push(entry.path);
    }
    if (paths.length > 0) {
      void stageGitPaths(paths);
    }
  }, [stageGitPaths]);

  const handleScmStash = useCallback(() => {
    openActionInputDialog({
      kind: 'stash',
      initialValue: '',
      includeUntracked: true,
    }, { deferred: true });
  }, [openActionInputDialog]);

  const handleScmNewBranch = useCallback(() => {
    const currentBranch = getCurrentGitBranch(
      gitBranchesRef.current,
      gitRepositorySummaryRef.current?.currentBranch,
    );
    openActionInputDialog({
      kind: 'checkout-branch',
      initialValue: '',
      createBranch: true,
      startPoint: currentBranch?.name ?? gitRepositorySummaryRef.current?.currentBranch ?? undefined,
    }, { deferred: true });
  }, [openActionInputDialog]);

  const handleScmCheckoutRevision = useCallback(() => {
    openActionInputDialog({
      kind: 'checkout-revision',
      initialValue: '',
    }, { deferred: true });
  }, [openActionInputDialog]);

  const handleScmRebaseContinue = useCallback(() => {
    void controlGitRebase('continue');
  }, [controlGitRebase]);

  const handleScmRebaseAbort = useCallback(() => {
    void controlGitRebase('abort');
  }, [controlGitRebase]);

  const handleScmOpenCommit = useCallback(() => {
    window.setTimeout(() => {
      openCommitWindow();
    }, 0);
  }, [openCommitWindow]);

  const handleScmOpenChangesWorkbench = useCallback(() => {
    openGitWorkbench('changes');
  }, [openGitWorkbench]);

  const handleScmOpenGitLog = useCallback(() => {
    openGitWorkbench('log');
  }, [openGitWorkbench]);

  const handleScmSelectEntry = useCallback((entry: CodePaneGitStatusEntry) => {
    selectGitChangeEntry(entry);
  }, [selectGitChangeEntry]);

  const handleDebugStepOver = useCallback((sessionId: string) => (
    stepDebugSession(sessionId, 'over')
  ), [stepDebugSession]);

  const handleDebugStepInto = useCallback((sessionId: string) => (
    stepDebugSession(sessionId, 'into')
  ), [stepDebugSession]);

  const handleDebugStepOut = useCallback((sessionId: string) => (
    stepDebugSession(sessionId, 'out')
  ), [stepDebugSession]);

  const handleDebugRefreshWatches = useCallback(() => (
    refreshDebugWatches()
  ), [refreshDebugWatches]);

  const handleHierarchyToolWindowRefresh = useCallback(() => {
    void loadHierarchyRoot(selectedHierarchyMode);
  }, [loadHierarchyRoot, selectedHierarchyMode]);

  const handleHierarchyToolWindowSelectMode = useCallback((mode: HierarchyMode) => {
    setSelectedHierarchyMode(mode);
  }, []);

  const handleHierarchyToolWindowToggleNode = useCallback((nodeKey: string) => {
    void toggleHierarchyNode(nodeKey);
  }, [toggleHierarchyNode]);

  const handleHierarchyToolWindowOpenItem = useCallback((item: CodePaneHierarchyItem) => {
    void openHierarchyItem(item);
  }, [openHierarchyItem]);

  const handleProjectToolWindowOpenTreeItem = useCallback((item: CodePaneProjectTreeItem) => {
    if (!item.filePath) {
      return;
    }

    void openFileLocation({
      filePath: item.filePath,
      lineNumber: item.lineNumber ?? 1,
      column: item.column ?? 1,
    });
  }, [openFileLocation]);

  const handleOutlineToolWindowOpenSymbol = useCallback((range: CodePaneRange) => {
    if (!documentSymbolsFilePath) {
      return;
    }

    void openFileLocation({
      filePath: documentSymbolsFilePath,
      lineNumber: range.startLineNumber,
      column: range.startColumn,
    });
  }, [documentSymbolsFilePath, openFileLocation]);

  const handleExternalChangeSelectEntry = useCallback((entry: ExternalChangeEntry) => {
    applyExternalChangeState(externalChangeEntriesRef.current, entry.filePath);
    if (entry.changeType !== 'deleted') {
      void activateFile(entry.filePath, { preview: true });
    }
  }, [activateFile, applyExternalChangeState]);

  const handleExternalChangeOpenDiff = useCallback((filePath: string) => {
    void openExternalChangeDiff(filePath);
  }, [openExternalChangeDiff]);

  const handleWorkspaceOpenBookmark = useCallback((bookmark: { filePath: string; lineNumber: number; column: number }) => {
    void openFileLocation({
      filePath: bookmark.filePath,
      lineNumber: bookmark.lineNumber,
      column: bookmark.column,
    });
  }, [openFileLocation]);

  const handleWorkspaceOpenTodo = useCallback((item: { filePath: string; lineNumber: number; column: number }) => {
    void openFileLocation({
      filePath: item.filePath,
      lineNumber: item.lineNumber,
      column: item.column,
    });
  }, [openFileLocation]);

  const handleWorkspaceOpenHistoryEntry = useCallback((entry: { filePath: string }) => {
    void openFileLocation({
      filePath: entry.filePath,
      lineNumber: 1,
      column: 1,
    });
  }, [openFileLocation]);

  const handleWorkspaceRestoreHistoryEntry = useCallback((entry: { id: string }) => {
    void restoreLocalHistoryEntry(entry.id);
  }, [restoreLocalHistoryEntry]);

  const handleQuickDocumentationRefresh = useCallback(() => {
    void loadQuickDocumentation();
  }, [loadQuickDocumentation]);

  const handleQuickDocumentationClose = useCallback(() => {
    setIsQuickDocumentationOpen((currentOpen) => (currentOpen ? false : currentOpen));
  }, []);

  const handleInspectorOutlineRefresh = useCallback(() => {
    if (!inspectorPanelFilePath) {
      return;
    }

    void loadDocumentSymbols(inspectorPanelFilePath);
  }, [inspectorPanelFilePath, loadDocumentSymbols]);

  const handleInspectorOutlineOpenSymbol = useCallback((range: CodePaneRange) => {
    if (!inspectorPanelFilePath) {
      return;
    }

    void openFileLocation({
      filePath: inspectorPanelFilePath,
      lineNumber: range.startLineNumber,
      column: range.startColumn,
    });
  }, [inspectorPanelFilePath, openFileLocation]);

  const handleBranchManagerRefresh = useCallback(() => {
    void loadGitBranches({ preferredBaseRef: gitRebaseBaseRef });
  }, [gitRebaseBaseRef, loadGitBranches]);

  const handleBranchManagerOpenWorkbench = useCallback(() => {
    openGitWorkbench('log');
  }, [openGitWorkbench]);

  const handleNavigateBackClick = useCallback(() => {
    void navigateBack();
  }, [navigateBack]);

  const handleNavigateForwardClick = useCallback(() => {
    void navigateForward();
  }, [navigateForward]);

  const handleOpenSearchEverywhereAll = useCallback(() => {
    openSearchEverywhere('all');
  }, [openSearchEverywhere]);

  const handleWorkspaceRefreshClick = useCallback(() => {
    setIsRefreshing((currentRefreshing) => (currentRefreshing ? currentRefreshing : true));
    void refreshLoadedDirectories().finally(() => {
      setIsRefreshing((currentRefreshing) => (currentRefreshing ? false : currentRefreshing));
    });
  }, [refreshLoadedDirectories]);

  const searchContents = useCallback(async (trimmedQuery: string) => {
    searchSidebarStateRef.current.contentQuery = trimmedQuery;
    const requestKey = `search-contents:${rootPath}`;
    const requestVersion = runtimeStoreRef.current.markLatest(requestKey);
    const cacheKey = `${requestKey}:${trimmedQuery}`;
    const cachedResults = runtimeStoreRef.current.getCache<CodePaneContentMatch[]>(cacheKey, CODE_PANE_SEARCH_CACHE_TTL_MS);
    if (cachedResults) {
      runtimeStoreRef.current.recordRequest(requestKey, t('codePane.requestContentSearch'), {
        meta: trimmedQuery,
        fromCache: true,
      });
      searchSidebarStateRef.current.contentResults = cachedResults;
      searchSidebarStateRef.current.contentError = null;
      return {
        results: cachedResults,
        error: null,
      };
    }

    const response = await trackRequest(
      requestKey,
      t('codePane.requestContentSearch'),
      trimmedQuery,
      async () => await window.electronAPI.codePaneSearchContents({
        rootPath,
        query: trimmedQuery,
        limit: 120,
        maxMatchesPerFile: 6,
      }),
    );

    if (!runtimeStoreRef.current.isLatest(requestKey, requestVersion)) {
      return {
        results: [],
        error: null,
      };
    }

    if (response.success) {
      runtimeStoreRef.current.setCache(cacheKey, response.data ?? []);
    }

    const results = response.success ? (response.data ?? []) : [];
    const error = response.success ? null : (response.error || t('common.retry'));
    searchSidebarStateRef.current.contentResults = results;
    searchSidebarStateRef.current.contentError = error;
    return { results, error };
  }, [rootPath, t, trackRequest]);

  const searchWorkspaceSymbols = useCallback(async (trimmedQuery: string) => {
    searchSidebarStateRef.current.workspaceSymbolQuery = trimmedQuery;
    const requestKey = `workspace-symbols:${rootPath}`;
    const requestVersion = runtimeStoreRef.current.markLatest(requestKey);
    const cacheKey = `${requestKey}:${trimmedQuery}`;
    const cachedResults = runtimeStoreRef.current.getCache<CodePaneWorkspaceSymbol[]>(cacheKey, CODE_PANE_SEARCH_CACHE_TTL_MS);
    if (cachedResults) {
      runtimeStoreRef.current.recordRequest(requestKey, t('codePane.requestWorkspaceSymbols'), {
        meta: trimmedQuery,
        fromCache: true,
      });
      searchSidebarStateRef.current.workspaceSymbolResults = cachedResults;
      searchSidebarStateRef.current.workspaceSymbolError = null;
      return {
        results: cachedResults,
        error: null,
      };
    }

    const response = await trackRequest(
      requestKey,
      t('codePane.requestWorkspaceSymbols'),
      trimmedQuery,
      async () => await window.electronAPI.codePaneGetWorkspaceSymbols({
        rootPath,
        query: trimmedQuery,
        limit: 120,
      }),
    );

    if (!runtimeStoreRef.current.isLatest(requestKey, requestVersion)) {
      return {
        results: [],
        error: null,
      };
    }

    if (response.success) {
      runtimeStoreRef.current.setCache(cacheKey, response.data ?? []);
    }

    const results = response.success ? (response.data ?? []) : [];
    const error = response.success ? null : (response.error || t('common.retry'));
    searchSidebarStateRef.current.workspaceSymbolResults = results;
    searchSidebarStateRef.current.workspaceSymbolError = error;
    return { results, error };
  }, [rootPath, t, trackRequest]);

  const persistSearchSidebarState = useCallback((state: SearchSidebarPersistedState) => {
    searchSidebarStateRef.current = state;
  }, []);

  const handleSearchPanelModeChange = useCallback((nextMode: SearchPanelMode) => {
    setSearchPanelMode(nextMode);
  }, []);

  const handleToggleFormatOnSave = useCallback(() => {
    persistSavePipelineState({
      formatOnSave: !savePipelineState.formatOnSave,
    });
  }, [persistSavePipelineState, savePipelineState.formatOnSave]);

  const handleToggleImportsOnSave = useCallback(() => {
    persistSavePipelineState({
      organizeImportsOnSave: !savePipelineState.organizeImportsOnSave,
    });
  }, [persistSavePipelineState, savePipelineState.organizeImportsOnSave]);

  const handleToggleLintOnSave = useCallback(() => {
    persistSavePipelineState({
      lintOnSave: !savePipelineState.lintOnSave,
    });
  }, [persistSavePipelineState, savePipelineState.lintOnSave]);

  const handleToggleActiveDiffView = useCallback(() => {
    if (viewMode === 'diff') {
      setPendingGitRevisionDiff((currentRequest) => (
        currentRequest === null ? currentRequest : null
      ));
      persistCodeState({
        viewMode: 'editor',
        diffTargetPath: null,
      });
      return;
    }

    void openDiffForActiveFile();
  }, [openDiffForActiveFile, persistCodeState, viewMode]);

  const handleSaveActiveFile = useCallback(() => {
    if (activeFilePath) {
      void saveFile(activeFilePath);
    }
  }, [activeFilePath, saveFile]);

  const handleEditorActionFindUsages = useCallback(() => {
    void findUsagesAtCursor();
  }, [findUsagesAtCursor]);

  const handleEditorActionRenameSymbol = useCallback(() => {
    void renameSymbolAtCursor();
  }, [renameSymbolAtCursor]);

  const handleEditorActionGoToImplementation = useCallback(() => {
    void goToImplementationAtCursor();
  }, [goToImplementationAtCursor]);

  const handleEditorActionOpenFileStructure = useCallback(() => {
    openFileStructurePanel();
  }, [openFileStructurePanel]);

  const handleEditorActionOpenTypeHierarchy = useCallback(() => {
    openHierarchyPanel('type-parents');
  }, [openHierarchyPanel]);

  const handleEditorActionOpenCallHierarchy = useCallback(() => {
    openHierarchyPanel('call-outgoing');
  }, [openHierarchyPanel]);

  const handleEditorActionOpenCodeActions = useCallback(() => {
    void openCodeActionMenu();
  }, [openCodeActionMenu]);

  const handleEditorActionFormatDocument = useCallback(() => {
    void formatActiveDocument();
  }, [formatActiveDocument]);

  const handleEditorActionToggleInlayHints = useCallback(() => {
    setAreInlayHintsEnabled((currentValue) => !currentValue);
  }, []);

  const handleEditorActionToggleBlame = useCallback(() => {
    setIsBlameVisible((currentValue) => !currentValue);
  }, []);

  const handleEditorActionShowSelectionHistory = useCallback(() => {
    void showHistoryForCurrentSelection();
  }, [showHistoryForCurrentSelection]);

  const handleToggleRunToolWindow = useCallback(() => {
    toggleBottomPanelMode('run');
  }, [toggleBottomPanelMode]);

  const handleToggleDebugToolWindow = useCallback(() => {
    toggleBottomPanelMode('debug');
  }, [toggleBottomPanelMode]);

  const handleToggleTestsToolWindow = useCallback(() => {
    toggleBottomPanelMode('tests');
  }, [toggleBottomPanelMode]);

  const handleToggleProjectToolWindow = useCallback(() => {
    toggleBottomPanelMode('project');
  }, [toggleBottomPanelMode]);

  const handleToggleOutlineToolWindow = useCallback(() => {
    if (bottomPanelMode === 'outline') {
      setBottomPanelMode((currentMode) => (currentMode === null ? currentMode : null));
    } else {
      openFileStructurePanel();
    }
  }, [bottomPanelMode, openFileStructurePanel]);

  const handleToggleGitToolWindow = useCallback(() => {
    if (bottomPanelMode === 'git') {
      setBottomPanelMode((currentMode) => (currentMode === null ? currentMode : null));
    } else {
      openGitWorkbench('log');
    }
  }, [bottomPanelMode, openGitWorkbench]);

  const handleToggleWorkspaceToolWindow = useCallback(() => {
    toggleBottomPanelMode('workspace');
  }, [toggleBottomPanelMode]);

  const handleToggleSemanticToolWindow = useCallback(() => {
    toggleBottomPanelMode('semantic');
  }, [toggleBottomPanelMode]);

  const handleTogglePerformanceToolWindow = useCallback(() => {
    toggleBottomPanelMode('performance');
  }, [toggleBottomPanelMode]);

  const handleToggleHistoryToolWindow = useCallback(() => {
    toggleBottomPanelMode('history');
  }, [toggleBottomPanelMode]);

  const handleToggleExternalChangesToolWindow = useCallback(() => {
    toggleBottomPanelMode('external-changes');
  }, [toggleBottomPanelMode]);

  const handleTogglePreviewToolWindow = useCallback(() => {
    toggleBottomPanelMode('preview');
  }, [toggleBottomPanelMode]);

  const toolWindowLaunchers = useMemo<ToolWindowLauncher[]>(() => {
    const items: ToolWindowLauncher[] = [
      {
        id: 'run',
        label: t('codePane.runTab'),
        icon: Play,
        active: bottomPanelMode === 'run',
        onClick: handleToggleRunToolWindow,
      },
      {
        id: 'debug',
        label: t('codePane.debugTab'),
        icon: Bug,
        active: bottomPanelMode === 'debug',
        onClick: handleToggleDebugToolWindow,
      },
      {
        id: 'tests',
        label: t('codePane.testsTab'),
        icon: FlaskConical,
        active: bottomPanelMode === 'tests',
        onClick: handleToggleTestsToolWindow,
      },
      {
        id: 'project',
        label: t('codePane.projectTab'),
        icon: FolderTree,
        active: bottomPanelMode === 'project',
        onClick: handleToggleProjectToolWindow,
      },
      {
        id: 'outline',
        label: t('codePane.fileStructureTab'),
        icon: FileCode2,
        active: bottomPanelMode === 'outline',
        disabled: !activeFilePath,
        onClick: handleToggleOutlineToolWindow,
      },
      {
        id: 'git',
        label: t('codePane.gitWorkbenchTab'),
        icon: GitBranch,
        active: bottomPanelMode === 'git',
        onClick: handleToggleGitToolWindow,
      },
      {
        id: 'workspace',
        label: t('codePane.workspaceTab'),
        icon: FileCode2,
        active: bottomPanelMode === 'workspace',
        onClick: handleToggleWorkspaceToolWindow,
      },
      {
        id: 'hierarchy',
        label: t('codePane.hierarchyTab'),
        icon: Workflow,
        active: bottomPanelMode === 'hierarchy',
        disabled: !activeFilePath,
        onClick: toggleHierarchyToolWindow,
      },
      {
        id: 'semantic',
        label: t('codePane.semanticTab'),
        icon: Binary,
        active: bottomPanelMode === 'semantic',
        disabled: !activeFilePath,
        onClick: handleToggleSemanticToolWindow,
      },
      {
        id: 'performance',
        label: t('codePane.performanceTab'),
        icon: Activity,
        active: bottomPanelMode === 'performance',
        onClick: handleTogglePerformanceToolWindow,
      },
    ];

    if (gitHistory || bottomPanelMode === 'history') {
      items.splice(5, 0, {
        id: 'history',
        label: t('codePane.gitHistoryTab'),
        icon: History,
        active: bottomPanelMode === 'history',
        onClick: handleToggleHistoryToolWindow,
      });
    }

    if (externalChangeEntries.length > 0 || bottomPanelMode === 'external-changes') {
      items.splice(5, 0, {
        id: 'external-changes',
        label: t('codePane.externalChangesTab'),
        icon: GitCompareArrows,
        active: bottomPanelMode === 'external-changes',
        onClick: handleToggleExternalChangesToolWindow,
      });
    }

    if (refactorPreview || bottomPanelMode === 'preview') {
      items.splice(items.length - 1, 0, {
        id: 'preview',
        label: t('codePane.refactorPreviewTab'),
        icon: GitCompareArrows,
        active: bottomPanelMode === 'preview',
        onClick: handleTogglePreviewToolWindow,
      });
    }

    return items;
  }, [
    activeFilePath,
    bottomPanelMode,
    externalChangeEntries.length,
    gitHistory,
    handleToggleDebugToolWindow,
    handleToggleExternalChangesToolWindow,
    handleToggleGitToolWindow,
    handleToggleHistoryToolWindow,
    handleToggleOutlineToolWindow,
    handleTogglePerformanceToolWindow,
    handleTogglePreviewToolWindow,
    handleToggleProjectToolWindow,
    handleToggleRunToolWindow,
    handleToggleSemanticToolWindow,
    handleToggleTestsToolWindow,
    handleToggleWorkspaceToolWindow,
    refactorPreview,
    t,
    toggleHierarchyToolWindow,
  ]);

  const renderedActivityRail = useMemo(() => (
    <ActivityRail
      sidebarTabs={sidebarTabs}
      toolWindowLaunchers={toolWindowLaunchers}
      sidebarMode={sidebarMode}
      isSidebarVisible={isSidebarVisible}
      onSidebarModeSelect={handleSidebarModeSelect}
    />
  ), [handleSidebarModeSelect, isSidebarVisible, sidebarMode, sidebarTabs, toolWindowLaunchers]);

  const renderedPerformancePanel = useMemo(() => (
    <PerformanceToolWindow
      runtimeStore={runtimeStoreRef.current}
      activeTasks={activePerformanceTasks}
      indexStatus={indexStatus}
      languageWorkspaceState={languageWorkspaceState}
      onClose={closeBottomPanel}
      onRefresh={refreshBottomPanel}
    />
  ), [
    activePerformanceTasks,
    closeBottomPanel,
    indexStatus,
    languageWorkspaceState,
    refreshBottomPanel,
  ]);

  const renderedRunPanel = useMemo(() => (
    <RunToolWindow
      targets={runTargets}
      sessions={visibleRunSessions}
      selectedSession={selectedRunSession}
      selectedOutput={selectedRunSessionOutput}
      isLoading={isRunTargetsLoading}
      error={runTargetsError}
      onClose={closeBottomPanel}
      onRefresh={refreshBottomPanel}
      onRunTarget={runTargetById}
      onDebugTarget={debugTargetById}
      onSelectSession={setSelectedRunSessionId}
      onStopSession={stopRunSession}
      getCustomization={getRunTargetCustomization}
      onCustomizationChange={updateRunTargetCustomization}
    />
  ), [
    closeBottomPanel,
    debugTargetById,
    getRunTargetCustomization,
    isRunTargetsLoading,
    refreshBottomPanel,
    runTargetById,
    runTargets,
    runTargetsError,
    selectedRunSession,
    selectedRunSessionOutput,
    stopRunSession,
    updateRunTargetCustomization,
    visibleRunSessions,
  ]);

  const renderedDebugPanel = useMemo(() => (
    <DebugToolWindow
      targets={debugTargets}
      breakpoints={breakpoints}
      exceptionBreakpoints={exceptionBreakpoints}
      sessions={visibleDebugSessions}
      selectedSession={selectedDebugSession}
      selectedDetails={debugSessionDetails}
      selectedOutput={selectedDebugSessionOutput}
      watchEntries={watchEntries}
      evaluations={debugEvaluations}
      isLoading={isRunTargetsLoading}
      isDetailsLoading={isDebugDetailsLoading}
      error={runTargetsError}
      onClose={closeBottomPanel}
      onRefresh={refreshBottomPanel}
      onStartDebug={debugTargetById}
      onSelectSession={setSelectedDebugSessionId}
      onStopSession={stopDebugSession}
      onPauseSession={pauseDebugSession}
      onContinueSession={continueDebugSession}
      onStepOver={handleDebugStepOver}
      onStepInto={handleDebugStepInto}
      onStepOut={handleDebugStepOut}
      onOpenFrame={openDebugFrame}
      onEvaluate={evaluateDebugExpression}
      onAddWatch={addDebugWatchExpression}
      onRemoveWatch={removeDebugWatchExpression}
      onRefreshWatches={handleDebugRefreshWatches}
      onUpdateBreakpoint={updateBreakpoint}
      onRemoveBreakpoint={removeBreakpoint}
      onSetExceptionBreakpoint={setExceptionBreakpoint}
    />
  ), [
    addDebugWatchExpression,
    breakpoints,
    closeBottomPanel,
    continueDebugSession,
    debugEvaluations,
    debugSessionDetails,
    debugTargetById,
    debugTargets,
    evaluateDebugExpression,
    exceptionBreakpoints,
    handleDebugRefreshWatches,
    handleDebugStepInto,
    handleDebugStepOut,
    handleDebugStepOver,
    isDebugDetailsLoading,
    isRunTargetsLoading,
    openDebugFrame,
    pauseDebugSession,
    refreshBottomPanel,
    removeBreakpoint,
    removeDebugWatchExpression,
    runTargetsError,
    selectedDebugSession,
    selectedDebugSessionOutput,
    setExceptionBreakpoint,
    stopDebugSession,
    updateBreakpoint,
    visibleDebugSessions,
    watchEntries,
  ]);

  const renderedHierarchyPanel = useMemo(() => (
    <HierarchyToolWindow
      mode={selectedHierarchyMode}
      root={hierarchyRootNode}
      isLoading={isHierarchyLoading}
      error={hierarchyError}
      onClose={closeBottomPanel}
      onRefresh={handleHierarchyToolWindowRefresh}
      onSelectMode={handleHierarchyToolWindowSelectMode}
      onToggleNode={handleHierarchyToolWindowToggleNode}
      onOpenItem={handleHierarchyToolWindowOpenItem}
    />
  ), [
    closeBottomPanel,
    handleHierarchyToolWindowOpenItem,
    handleHierarchyToolWindowRefresh,
    handleHierarchyToolWindowSelectMode,
    handleHierarchyToolWindowToggleNode,
    hierarchyError,
    hierarchyRootNode,
    isHierarchyLoading,
    selectedHierarchyMode,
  ]);

  const renderedSemanticPanel = useMemo(() => (
    <SemanticToolWindow
      fileLabel={semanticSummaryFileLabel}
      legend={semanticLegend}
      summary={semanticSummary}
      totalTokens={semanticTokenCount}
      isEnabled={areSemanticTokensEnabled}
      isLoading={isSemanticSummaryLoading}
      error={semanticSummaryError}
      onClose={closeBottomPanel}
      onRefresh={() => {
        void loadSemanticSummary();
      }}
      onToggleEnabled={() => {
        setAreSemanticTokensEnabled((currentValue) => !currentValue);
      }}
    />
  ), [
    areSemanticTokensEnabled,
    closeBottomPanel,
    isSemanticSummaryLoading,
    loadSemanticSummary,
    semanticLegend,
    semanticSummary,
    semanticSummaryError,
    semanticSummaryFileLabel,
    semanticTokenCount,
  ]);

  const renderedProjectPanel = useMemo(() => (
    <ProjectToolWindow
      contributions={projectContributions}
      sessions={visibleRunSessions}
      selectedSession={selectedRunSession}
      selectedOutput={selectedRunSessionOutput}
      languageWorkspaceState={languageWorkspaceState}
      isLoading={isProjectLoading}
      error={projectError}
      onClose={closeBottomPanel}
      onRefresh={refreshBottomPanel}
      onRunCommand={runProjectCommandById}
      onSelectSession={setSelectedRunSessionId}
      onStopSession={stopRunSession}
      onOpenTreeItem={handleProjectToolWindowOpenTreeItem}
    />
  ), [
    closeBottomPanel,
    handleProjectToolWindowOpenTreeItem,
    isProjectLoading,
    languageWorkspaceState,
    projectContributions,
    projectError,
    refreshBottomPanel,
    runProjectCommandById,
    selectedRunSession,
    selectedRunSessionOutput,
    stopRunSession,
    visibleRunSessions,
  ]);

  const renderedOutlinePanel = useMemo(() => (
    <OutlineToolWindow
      fileLabel={documentSymbolsFilePath ? getFileLabel(documentSymbolsFilePath) : null}
      symbols={documentSymbols}
      isLoading={isDocumentSymbolsLoading}
      error={documentSymbolsError}
      onClose={closeBottomPanel}
      onRefresh={loadDocumentSymbols}
      onOpenSymbol={handleOutlineToolWindowOpenSymbol}
    />
  ), [
    closeBottomPanel,
    documentSymbols,
    documentSymbolsError,
    documentSymbolsFilePath,
    getFileLabel,
    handleOutlineToolWindowOpenSymbol,
    isDocumentSymbolsLoading,
    loadDocumentSymbols,
  ]);

  const renderedTestsPanel = useMemo(() => (
    <TestsToolWindow
      testItems={testItems}
      sessions={visibleRunSessions}
      selectedSession={selectedRunSession}
      selectedOutput={selectedRunSessionOutput}
      isLoading={isTestsLoading}
      error={testsError}
      hasFailedSessions={hasFailedTestSessions}
      onClose={closeBottomPanel}
      onRefresh={refreshBottomPanel}
      onRunTest={runTestTarget}
      onSelectSession={setSelectedRunSessionId}
      onStopSession={stopRunSession}
      onOpenTestItem={openTestItem}
      onRerunFailed={rerunFailedTests}
    />
  ), [
    closeBottomPanel,
    hasFailedTestSessions,
    isTestsLoading,
    openTestItem,
    refreshBottomPanel,
    rerunFailedTests,
    runTestTarget,
    selectedRunSession,
    selectedRunSessionOutput,
    stopRunSession,
    testItems,
    testsError,
    visibleRunSessions,
  ]);

  const renderedPreviewPanel = useMemo(() => (
    <RefactorPreviewToolWindow
      changeSet={refactorPreview}
      selectedChangeId={selectedPreviewChangeId}
      isApplying={isApplyingRefactorPreview}
      error={refactorPreviewError}
      onSelectChange={setSelectedPreviewChangeId}
      onApply={applyRefactorPreview}
      onClose={closeBottomPanel}
    />
  ), [
    applyRefactorPreview,
    closeBottomPanel,
    isApplyingRefactorPreview,
    refactorPreview,
    refactorPreviewError,
    selectedPreviewChangeId,
  ]);

  const renderedGitPanel = useMemo(() => (
    <GitToolWindow
      activeTab={activeGitWorkbenchTab}
      onTabChange={handleGitWorkbenchTabChange}
      branches={gitBranches}
      selectedBranchName={selectedGitBranchName}
      commits={gitGraph}
      selectedCommitSha={selectedGitLogCommitSha}
      changes={scmEntries}
      selectedChangePath={selectedGitChangePath}
      selectedHunkPath={selectedGitHunksPath}
      selectedHunkRelativePath={selectedGitHunksRelativePath}
      stagedHunks={gitStagedHunks}
      unstagedHunks={gitUnstagedHunks}
      hunksLoading={isGitHunksLoading}
      hunksError={gitHunksError}
      rebasePlan={gitRebasePlan}
      rebaseBaseRef={gitRebaseBaseRef}
      isBranchesLoading={isGitBranchesLoading}
      branchesError={gitBranchesError}
      isRebaseLoading={isGitRebaseLoading}
      rebaseError={gitRebaseError}
      selectedCommitDetails={selectedGitCommitDetails}
      comparedCommits={comparedGitCommits}
      selectedCommitOrder={selectedGitCommitOrder}
      isCommitDetailsLoading={isGitCommitDetailsLoading}
      commitDetailsError={gitCommitDetailsError}
      onSelectBranch={handleSelectGitBranch}
      onSelectCommit={selectGitLogCommit}
      onSelectChange={selectGitChangeEntry}
      onChangeRebaseBaseRef={setGitRebaseBaseRef}
      onRefresh={refreshBottomPanel}
      onRefreshRebase={handleGitWorkbenchRefreshRebase}
      onStagePath={handleGitStagePath}
      onUnstagePath={handleGitUnstagePath}
      onDiscardPath={handleGitWorkbenchDiscardPath}
      onOpenFileDiff={handleGitOpenFileDiff}
      onOpenConflictResolver={handleGitOpenConflictResolver}
      onResolveConflict={handleGitResolveConflict}
      onStageHunk={stageGitHunk}
      onUnstageHunk={unstageGitHunk}
      onDiscardHunk={discardGitHunk}
      onShowFileHistory={handleGitShowFileHistory}
      onRevealInExplorer={handleGitRevealInExplorer}
      onCheckoutBranch={checkoutGitBranch}
      onRequestRenameBranch={handleGitWorkbenchRequestRenameBranch}
      onDeleteBranch={handleGitWorkbenchDeleteBranch}
      onCherryPick={cherryPickCommit}
      onCompareSelectedCommits={handleGitWorkbenchCompareSelectedCommits}
      onOpenCommitFileDiff={handleGitWorkbenchOpenCommitFileDiff}
      onApplyRebasePlan={applyGitRebasePlan}
      getRelativePath={getProjectRelativePath}
      onClose={closeBottomPanel}
    />
  ), [
    activeGitWorkbenchTab,
    applyGitRebasePlan,
    cherryPickCommit,
    checkoutGitBranch,
    closeBottomPanel,
    comparedGitCommits,
    getProjectRelativePath,
    gitBranches,
    gitBranchesError,
    gitCommitDetailsError,
    gitGraph,
    gitHunksError,
    gitRebaseBaseRef,
    gitRebaseError,
    gitRebasePlan,
    gitStagedHunks,
    gitUnstagedHunks,
    handleGitOpenConflictResolver,
    handleGitOpenFileDiff,
    handleGitResolveConflict,
    handleGitRevealInExplorer,
    handleGitShowFileHistory,
    handleGitStagePath,
    handleGitUnstagePath,
    handleGitWorkbenchCompareSelectedCommits,
    handleGitWorkbenchDeleteBranch,
    handleGitWorkbenchDiscardPath,
    handleGitWorkbenchOpenCommitFileDiff,
    handleGitWorkbenchRefreshRebase,
    handleGitWorkbenchRequestRenameBranch,
    handleGitWorkbenchTabChange,
    handleSelectGitBranch,
    isGitBranchesLoading,
    isGitCommitDetailsLoading,
    isGitHunksLoading,
    isGitRebaseLoading,
    refreshBottomPanel,
    scmEntries,
    selectGitChangeEntry,
    selectGitLogCommit,
    selectedGitChangePath,
    selectedGitCommitDetails,
    selectedGitCommitOrder,
    selectedGitHunksPath,
    selectedGitHunksRelativePath,
    selectedGitLogCommitSha,
    selectedGitBranchName,
  ]);

  const renderedConflictPanel = useMemo(() => (
    <ConflictResolutionToolWindow
      conflict={gitConflictDetails}
      isLoading={isGitConflictLoading}
      isApplying={isApplyingGitConflict}
      error={gitConflictError}
      onRefresh={refreshBottomPanel}
      onApply={applyGitConflictResolution}
      onClose={closeBottomPanel}
    />
  ), [
    applyGitConflictResolution,
    closeBottomPanel,
    gitConflictDetails,
    gitConflictError,
    isApplyingGitConflict,
    isGitConflictLoading,
    refreshBottomPanel,
  ]);

  const renderedHistoryPanel = useMemo(() => (
    <GitHistoryToolWindow
      history={gitHistory}
      selectedCommitSha={selectedHistoryCommitSha}
      isLoading={isGitHistoryLoading}
      error={gitHistoryError}
      onSelectCommit={setSelectedHistoryCommitSha}
      onRefresh={refreshBottomPanel}
      onCherryPick={cherryPickCommit}
      onClose={closeBottomPanel}
    />
  ), [
    cherryPickCommit,
    closeBottomPanel,
    gitHistory,
    gitHistoryError,
    isGitHistoryLoading,
    refreshBottomPanel,
    selectedHistoryCommitSha,
  ]);

  const renderedExternalChangesPanel = useMemo(() => (
    <ExternalChangesToolWindow
      entries={externalChangeEntries}
      selectedEntry={selectedExternalChangeEntry}
      onClose={closeBottomPanel}
      onClearAll={clearAllExternalChanges}
      onClearEntry={clearExternalChangeEntry}
      onSelectEntry={handleExternalChangeSelectEntry}
      onOpenDiff={handleExternalChangeOpenDiff}
    />
  ), [
    clearAllExternalChanges,
    clearExternalChangeEntry,
    closeBottomPanel,
    externalChangeEntries,
    handleExternalChangeOpenDiff,
    handleExternalChangeSelectEntry,
    selectedExternalChangeEntry,
  ]);

  const renderedWorkspacePanel = useMemo(() => (
    <WorkspaceToolWindow
      bookmarks={bookmarks}
      todoItems={todoItems}
      localHistoryEntries={visibleLocalHistoryEntries}
      activeFilePath={activeFilePath}
      isTodoLoading={isTodoLoading}
      todoError={todoError}
      onClose={closeBottomPanel}
      onRefresh={loadTodoEntries}
      onOpenBookmark={handleWorkspaceOpenBookmark}
      onOpenTodo={handleWorkspaceOpenTodo}
      onOpenHistoryEntry={handleWorkspaceOpenHistoryEntry}
      onRestoreHistoryEntry={handleWorkspaceRestoreHistoryEntry}
      getFileLabel={getFileLabel}
      getRelativePath={getProjectRelativePath}
    />
  ), [
    activeFilePath,
    bookmarks,
    closeBottomPanel,
    getFileLabel,
    getProjectRelativePath,
    handleWorkspaceOpenBookmark,
    handleWorkspaceOpenHistoryEntry,
    handleWorkspaceOpenTodo,
    handleWorkspaceRestoreHistoryEntry,
    isTodoLoading,
    loadTodoEntries,
    todoError,
    todoItems,
    visibleLocalHistoryEntries,
  ]);

  const renderedBottomPanel = useMemo(() => {
    switch (bottomPanelMode) {
      case 'run':
        return renderedRunPanel;
      case 'debug':
        return renderedDebugPanel;
      case 'hierarchy':
        return renderedHierarchyPanel;
      case 'semantic':
        return renderedSemanticPanel;
      case 'project':
        return renderedProjectPanel;
      case 'outline':
        return renderedOutlinePanel;
      case 'tests':
        return renderedTestsPanel;
      case 'preview':
        return renderedPreviewPanel;
      case 'git':
        return renderedGitPanel;
      case 'conflict':
        return renderedConflictPanel;
      case 'history':
        return renderedHistoryPanel;
      case 'external-changes':
        return renderedExternalChangesPanel;
      case 'workspace':
        return renderedWorkspacePanel;
      case 'performance':
        return renderedPerformancePanel;
      default:
        return null;
    }
  }, [
    bottomPanelMode,
    renderedConflictPanel,
    renderedDebugPanel,
    renderedExternalChangesPanel,
    renderedGitPanel,
    renderedHierarchyPanel,
    renderedHistoryPanel,
    renderedOutlinePanel,
    renderedPerformancePanel,
    renderedPreviewPanel,
    renderedProjectPanel,
    renderedRunPanel,
    renderedSemanticPanel,
    renderedTestsPanel,
    renderedWorkspacePanel,
  ]);

  const editorActionMenuSections = useMemo<EditorActionMenuItem[][]>(() => ([
    [
      {
        id: 'find-usages',
        label: t('codePane.findUsages'),
        icon: <Search size={14} />,
        disabled: !activeFilePath,
        onSelect: handleEditorActionFindUsages,
      },
      {
        id: 'rename-symbol',
        label: t('codePane.renameSymbol'),
        icon: <FileIcon size={14} />,
        disabled: !activeFilePath || activeFileReadOnly,
        onSelect: handleEditorActionRenameSymbol,
      },
      {
        id: 'go-to-implementation',
        label: t('codePane.goToImplementation'),
        icon: <Binary size={14} />,
        disabled: !activeFilePath,
        onSelect: handleEditorActionGoToImplementation,
      },
      {
        id: 'file-structure',
        label: t('codePane.fileStructureAction'),
        icon: <FileCode2 size={14} />,
        disabled: !activeFilePath,
        onSelect: handleEditorActionOpenFileStructure,
      },
      {
        id: 'type-hierarchy',
        label: t('codePane.typeHierarchyAction'),
        icon: <Workflow size={14} />,
        disabled: !activeFilePath,
        onSelect: handleEditorActionOpenTypeHierarchy,
      },
      {
        id: 'call-hierarchy',
        label: t('codePane.callHierarchyAction'),
        icon: <Workflow size={14} />,
        disabled: !activeFilePath,
        onSelect: handleEditorActionOpenCallHierarchy,
      },
      {
        id: 'code-actions',
        label: t('codePane.codeActions'),
        icon: <Settings size={14} />,
        disabled: !activeFilePath,
        onSelect: handleEditorActionOpenCodeActions,
      },
      {
        id: 'format-document',
        label: t('codePane.formatDocument'),
        icon: <Check size={14} />,
        disabled: !activeFilePath || activeFileReadOnly,
        onSelect: handleEditorActionFormatDocument,
      },
    ],
    [
      {
        id: 'quick-documentation',
        label: t('codePane.quickDocumentation'),
        icon: <History size={14} />,
        disabled: !activeFilePath,
        active: isQuickDocumentationOpen,
        onSelect: () => {
          toggleQuickDocumentation();
        },
      },
      {
        id: 'toggle-inlay-hints',
        label: t('codePane.inlayHints'),
        icon: <Binary size={14} />,
        disabled: !activeFilePath,
        active: areInlayHintsEnabled,
        onSelect: handleEditorActionToggleInlayHints,
      },
      {
        id: 'toggle-split-editor',
        label: t('codePane.editorSplitToggle'),
        icon: <FolderTree size={14} />,
        disabled: !activeFilePath,
        active: isEditorSplitVisible,
        onSelect: () => {
          void toggleEditorSplit();
        },
      },
    ],
    [
      {
        id: 'toggle-bookmark',
        label: t('codePane.bookmarkToggle'),
        icon: <Star size={14} />,
        disabled: !activeFilePath,
        active: () => {
          const activePath = activeFilePathRef.current;
          if (!activePath) {
            return false;
          }

          const lineNumber = cursorStoreRef.current.getSnapshot().lineNumber;
          const bookmarkId = `${activePath}:${lineNumber}`;
          for (const bookmark of bookmarks) {
            if (bookmark.id === bookmarkId) {
              return true;
            }
          }
          return false;
        },
        onSelect: () => {
          toggleBookmarkAtCursor();
        },
      },
      {
        id: 'toggle-git-blame',
        label: t('codePane.gitBlame'),
        icon: <GitBranch size={14} />,
        disabled: !activeFilePath,
        active: isBlameVisible,
        onSelect: handleEditorActionToggleBlame,
      },
      {
        id: 'git-history-selection',
        label: t('codePane.gitShowHistoryForSelection'),
        icon: <History size={14} />,
        disabled: !activeFilePath,
        onSelect: handleEditorActionShowSelectionHistory,
      },
    ],
  ]), [
    activeFilePath,
    activeFileReadOnly,
    areInlayHintsEnabled,
    handleEditorActionFindUsages,
    handleEditorActionFormatDocument,
    handleEditorActionGoToImplementation,
    handleEditorActionOpenCallHierarchy,
    handleEditorActionOpenCodeActions,
    handleEditorActionOpenFileStructure,
    handleEditorActionOpenTypeHierarchy,
    handleEditorActionRenameSymbol,
    handleEditorActionShowSelectionHistory,
    handleEditorActionToggleBlame,
    handleEditorActionToggleInlayHints,
    isBlameVisible,
    isEditorSplitVisible,
    isQuickDocumentationOpen,
    t,
    toggleEditorSplit,
    toggleQuickDocumentation,
    toggleBookmarkAtCursor,
  ]);

  const checkoutBranchFromManager = useCallback((branch: CodePaneGitBranchEntry) => {
    if (branch.kind === 'remote') {
      void checkoutGitBranch({
        branchName: getTrackingLocalBranchName(branch.name),
        createBranch: true,
        startPoint: branch.name,
        preferExisting: true,
      });
      return;
    }

    if (!branch.current) {
      void checkoutGitBranch({
        branchName: branch.name,
        createBranch: false,
      });
    }
  }, [checkoutGitBranch]);

  const renameBranchFromManager = useCallback((branch: CodePaneGitBranchEntry) => {
    if (branch.kind !== 'local') {
      return;
    }

    openActionInputDialog({
      kind: 'rename-branch',
      branchName: branch.name,
      initialValue: branch.name,
    }, { deferred: true });
  }, [openActionInputDialog]);

  const deleteBranchFromManager = useCallback((branch: CodePaneGitBranchEntry) => {
    if (branch.kind !== 'local' || branch.current) {
      return;
    }

    openActionConfirmDialog({
      kind: 'delete-branch',
      branchName: branch.name,
      force: !branch.mergedIntoCurrent,
    }, { deferred: true });
  }, [openActionConfirmDialog]);

  const activeFileStatusLabel = useMemo(() => {
    if (!activeFilePath) {
      return t('codePane.autoSave');
    }

    if (activeFileDisplayPath && isPathInside(rootPath, activeFileDisplayPath)) {
      return getRelativePath(rootPath, activeFileDisplayPath);
    }

    return activeFileDisplayPath;
  }, [activeFileDisplayPath, activeFilePath, rootPath, t]);

  const handleBranchManagerUpdateProject = useCallback(() => {
    void updateGitProject();
  }, [updateGitProject]);

  const handleBranchManagerOpenCommit = useCallback(() => {
    window.setTimeout(() => {
      void commitGitChangesFromPrompt();
    }, 0);
  }, [commitGitChangesFromPrompt]);

  const handleBranchManagerPush = useCallback(() => {
    const currentBranchName = currentGitBranch?.name ?? gitRepositorySummary?.currentBranch ?? '';
    if (!currentBranchName) {
      return;
    }

    void pushGitBranch({
      branchName: currentBranchName,
      setUpstream: !currentGitBranch?.upstream,
    });
  }, [currentGitBranch?.name, currentGitBranch?.upstream, gitRepositorySummary?.currentBranch, pushGitBranch]);

  const handleBranchManagerCreateBranch = useCallback(() => {
    const currentBranchName = currentGitBranch?.name ?? gitRepositorySummary?.currentBranch ?? '';
    openActionInputDialog({
      kind: 'checkout-branch',
      initialValue: '',
      createBranch: true,
      startPoint: currentBranchName || undefined,
    }, { deferred: true });
  }, [currentGitBranch?.name, gitRepositorySummary?.currentBranch, openActionInputDialog]);

  const branchManagerControl = useMemo(() => (
    <BranchManagerControl
      gitBranches={gitBranches}
      gitBranchesError={gitBranchesError}
      gitSummaryBranchLabel={gitSummaryBranchLabel}
      isGitBranchesLoading={isGitBranchesLoading}
      isMac={isMac}
      canPushBranch={Boolean(currentGitBranch?.name || gitRepositorySummary?.currentBranch)}
      contextMenuContentClassName={contextMenuContentClassName}
      contextMenuDangerItemClassName={contextMenuDangerItemClassName}
      contextMenuItemClassName={contextMenuItemClassName}
      onRefresh={handleBranchManagerRefresh}
      onOpenWorkbench={handleBranchManagerOpenWorkbench}
      onUpdateProject={handleBranchManagerUpdateProject}
      onOpenCommit={handleBranchManagerOpenCommit}
      onPushCurrentBranch={handleBranchManagerPush}
      onCreateBranch={handleBranchManagerCreateBranch}
      onCheckoutRevision={checkoutGitRevisionFromPrompt}
      onCheckoutBranch={checkoutBranchFromManager}
      onRenameBranch={renameBranchFromManager}
      onDeleteBranch={deleteBranchFromManager}
      preventFocus={preventMouseButtonFocus}
      t={t}
    />
  ), [
    checkoutBranchFromManager,
    checkoutGitRevisionFromPrompt,
    contextMenuContentClassName,
    contextMenuDangerItemClassName,
    contextMenuItemClassName,
    currentGitBranch?.name,
    deleteBranchFromManager,
    gitBranches,
    gitBranchesError,
    gitRepositorySummary?.currentBranch,
    gitSummaryBranchLabel,
    handleBranchManagerCreateBranch,
    handleBranchManagerOpenCommit,
    handleBranchManagerOpenWorkbench,
    handleBranchManagerPush,
    handleBranchManagerRefresh,
    handleBranchManagerUpdateProject,
    isGitBranchesLoading,
    isMac,
    renameBranchFromManager,
    t,
  ]);

  const renderedWorkspaceHeader = useMemo(() => (
    <CodePaneWorkspaceHeader
      branchManagerControl={branchManagerControl}
      navigationStore={navigationStoreRef.current}
      contextMenuContentClassName={contextMenuContentClassName}
      contextMenuDangerItemClassName={contextMenuDangerItemClassName}
      contextMenuItemClassName={contextMenuItemClassName}
      editorActionMenuSections={editorActionMenuSections}
      gitOperationLabel={gitOperationLabel}
      gitRepositorySummary={gitRepositorySummary}
      isRefreshing={isRefreshing}
      activeFilePath={activeFilePath}
      onClose={onClose}
      onNavigateBack={handleNavigateBackClick}
      onNavigateForward={handleNavigateForwardClick}
      onOpenSearchEverywhere={handleOpenSearchEverywhereAll}
      onWorkspaceRefresh={handleWorkspaceRefreshClick}
      onToggleActiveDiffView={handleToggleActiveDiffView}
      onSaveActiveFile={handleSaveActiveFile}
      onPaneClose={handlePaneClose}
      preventFocus={preventMouseButtonFocus}
      t={t}
      viewMode={viewMode}
    />
  ), [
    activeFilePath,
    branchManagerControl,
    contextMenuContentClassName,
    contextMenuDangerItemClassName,
    contextMenuItemClassName,
    editorActionMenuSections,
    handleNavigateBackClick,
    handleNavigateForwardClick,
    handleOpenSearchEverywhereAll,
    gitOperationLabel,
    gitRepositorySummary,
    handlePaneClose,
    handleSaveActiveFile,
    handleToggleActiveDiffView,
    handleWorkspaceRefreshClick,
    isRefreshing,
    onClose,
    preventMouseButtonFocus,
    t,
    viewMode,
  ]);

  const renderedStatusBar = useMemo(() => (
    <div
      className="flex h-[30px] items-center justify-between gap-3 border-t border-[rgb(var(--border))] px-3 text-[11px] text-zinc-500"
      style={CODE_PANE_CHROME_SURFACE_STYLE}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden">
        <span className="truncate">{activeFileStatusLabel}</span>
      </div>
      <div className="flex items-center gap-3">
        {indexStatus && (
          <span className={`flex items-center gap-1.5 rounded px-1.5 py-0.5 ${indexStatus.state === 'error' ? 'bg-red-500/15 text-red-300' : 'bg-sky-500/15 text-sky-300'}`}>
            {indexStatus.state === 'building' && (
              <Loader2 size={11} className="shrink-0 animate-spin" />
            )}
            <span>{indexStatusText}</span>
          </span>
        )}
        {languageStatusText && languageStatusTone && (
          <span className={`flex items-center gap-1.5 rounded px-1.5 py-0.5 ${languageStatusTone.className}`}>
            {languageStatusTone.showSpinner && (
              <Loader2 size={11} className="shrink-0 animate-spin" />
            )}
            <span>{languageStatusText}</span>
          </span>
        )}
        <RuntimeActivityIndicator
          runtimeStore={runtimeStoreRef.current}
          hasActiveTasks={hasActivePerformanceTasks}
          label={t('codePane.performanceBusy')}
        />
        <span>{viewMode === 'diff' ? t('codePane.diffView') : t('codePane.editorView')}</span>
        <SavePipelineToggles
          state={savePipelineState}
          onToggleFormat={handleToggleFormatOnSave}
          onToggleImports={handleToggleImportsOnSave}
          onToggleLint={handleToggleLintOnSave}
          t={t}
        />
      </div>
    </div>
  ), [
    activeFileStatusLabel,
    hasActivePerformanceTasks,
    handleToggleFormatOnSave,
    handleToggleImportsOnSave,
    handleToggleLintOnSave,
    indexStatus,
    indexStatusText,
    languageStatusText,
    languageStatusTone,
    savePipelineState,
    t,
    viewMode,
  ]);

  const openFileTabDecorationsKey = useMemo(() => {
    if (orderedOpenFiles.length === 0) {
      return '';
    }

    const openFileDecorations: string[] = [];
    for (const tab of orderedOpenFiles) {
      const status = gitStatusByPath[tab.path]?.status ?? '';
      const externalChangeType = externalChangeStateRef.current.entriesByPath.get(tab.path)?.changeType ?? '';
      const isReadOnly = fileMetaRef.current.get(tab.path)?.readOnly === true ? '1' : '0';
      openFileDecorations.push(`${tab.path}:${status}:${externalChangeType}:${isReadOnly}`);
    }
    return openFileDecorations.join('\u0000');
  }, [externalChangeEntriesKey, gitStatusEntriesKey, orderedOpenFiles]);

  const renderedOpenFileTabs = useMemo(() => {
    if (orderedOpenFiles.length === 0) {
      return (
        <div className="flex items-center px-3 text-xs text-zinc-500">
          {t('codePane.openEditors')}
        </div>
      );
    }

    const renderedTabs: React.ReactNode[] = [];
    for (const tab of windowedOpenFileTabs.items) {
      const isTabActive = tab.path === activeFilePath;
      const tabStatus = gitStatusByPathRef.current[tab.path]?.status;
      const externalChangeEntry = externalChangeStateRef.current.entriesByPath.get(tab.path);
      const tabMeta = fileMetaRef.current.get(tab.path);
      const isReadOnlyTab = tabMeta?.readOnly === true;
      const entryTextClassName = tabStatus
        ? getStatusTextClassName(tabStatus)
        : getExternalChangeTextClassName(externalChangeEntry?.changeType);

      renderedTabs.push(
        <OpenFileTab
          key={tab.path}
          path={tab.path}
          pinned={tab.pinned}
          preview={tab.preview}
          isActive={isTabActive}
          isReadOnly={isReadOnlyTab}
          entryTextClassName={entryTextClassName}
          externalChangeType={externalChangeEntry?.changeType}
          label={getFileLabel(tab.path)}
          rootPath={rootPath}
          renderContextMenu={renderFileContextMenu}
          onActivate={activateFile}
          onClose={closeFileTab}
          t={t}
        />,
      );
    }

    if (!windowedOpenFileTabs.isWindowed) {
      return renderedTabs;
    }

    return (
      <div
        className="relative flex min-h-[34px] shrink-0 items-stretch"
        style={{ width: `${windowedOpenFileTabs.totalWidth}px` }}
      >
        <div
          className="absolute top-0 flex h-full items-stretch"
          style={{
            left: `${windowedOpenFileTabs.offsetLeft}px`,
          }}
        >
          {renderedTabs}
        </div>
      </div>
    );
  }, [
    activeFilePath,
    activateFile,
    closeFileTab,
    getFileLabel,
    openFileTabDecorationsKey,
    renderFileContextMenu,
    rootPath,
    t,
    windowedOpenFileTabs,
  ]);

  const renderedFilesSidebarContent = useMemo(() => (
    <FilesSidebarContent
      scrollRef={filesSidebarScrollRef}
      body={renderedFilesSidebarBody}
      onLocateActiveFile={handleLocateCurrentViewFile}
      onExpandSelection={() => {
        void expandExplorerSelection();
      }}
      onCollapseAll={collapseAllExplorerDirectories}
      canLocateActiveFile={Boolean(activeFilePath || secondaryFilePath)}
      canExpandSelection={Boolean(selectedPath)}
      canCollapseAll={expandedDirectories.size > 0}
      t={t}
    />
  ), [
    activeFilePath,
    collapseAllExplorerDirectories,
    expandExplorerSelection,
    expandedDirectories.size,
    handleLocateCurrentViewFile,
    renderedFilesSidebarBody,
    secondaryFilePath,
    selectedPath,
    t,
  ]);

  const renderedSearchSidebarContent = useMemo(() => (
    <SearchSidebarContent
      mode={searchPanelMode}
      initialState={searchSidebarStateRef.current}
      usageGroups={usageGroups}
      usageError={usageError}
      usagesTargetLabel={usagesTargetLabel}
      isFindingUsages={isFindingUsages}
      rootPath={rootPath}
      onModeChange={handleSearchPanelModeChange}
      onFindUsages={handleEditorActionFindUsages}
      onSearchContents={searchContents}
      onSearchWorkspaceSymbols={searchWorkspaceSymbols}
      onPersistState={persistSearchSidebarState}
      onActivateFile={activateFile}
      onOpenContentMatch={openContentSearchMatch}
      onOpenFileLocation={openFileLocation}
      t={t}
    />
  ), [
    activateFile,
    handleEditorActionFindUsages,
    handleSearchPanelModeChange,
    isFindingUsages,
    openContentSearchMatch,
    openFileLocation,
    persistSearchSidebarState,
    rootPath,
    searchPanelMode,
    searchContents,
    searchWorkspaceSymbols,
    t,
    usageError,
    usageGroups,
    usagesTargetLabel,
  ]);

  const renderedScmSidebarContent = useMemo(() => (
    <ScmSidebarContent
      repositorySummary={gitRepositorySummary}
      branchLabel={gitSummaryBranchLabel}
      operationLabel={gitOperationLabel}
      entries={scmEntries}
      selectedPath={selectedGitChangePath}
      selectedEntry={selectedScmEntry}
      selectedRelativePath={selectedGitChangeRelativePath}
      rootPath={rootPath}
      gitGraphCount={gitGraph.length}
      showInlineChanges={!(bottomPanelMode === 'git' && activeGitWorkbenchTab === 'changes')}
      canCopyBranchName={Boolean(currentGitBranch?.name || gitRepositorySummary?.headSha)}
      onRefreshStatus={handleScmRefreshStatus}
      onOpenRepository={handleScmOpenRepository}
      onCopyBranchName={handleScmCopyBranchName}
      onStageAll={handleScmStageAll}
      onStash={handleScmStash}
      onNewBranch={handleScmNewBranch}
      onCheckoutRevision={handleScmCheckoutRevision}
      onRebaseContinue={handleScmRebaseContinue}
      onRebaseAbort={handleScmRebaseAbort}
      onOpenCommit={handleScmOpenCommit}
      onOpenChangesWorkbench={handleScmOpenChangesWorkbench}
      onOpenGitLog={handleScmOpenGitLog}
      onSelectEntry={handleScmSelectEntry}
      onOpenDiff={handleGitOpenFileDiff}
      onStagePath={handleGitStagePath}
      onUnstagePath={handleGitUnstagePath}
      onDiscardPath={handleGitWorkbenchDiscardPath}
      t={t}
    />
  ), [
    activeGitWorkbenchTab,
    bottomPanelMode,
    currentGitBranch?.name,
    gitGraph.length,
    gitOperationLabel,
    gitRepositorySummary,
    gitSummaryBranchLabel,
    handleGitOpenFileDiff,
    handleGitStagePath,
    handleGitUnstagePath,
    handleGitWorkbenchDiscardPath,
    handleScmCheckoutRevision,
    handleScmCopyBranchName,
    handleScmNewBranch,
    handleScmOpenChangesWorkbench,
    handleScmOpenCommit,
    handleScmOpenGitLog,
    handleScmOpenRepository,
    handleScmRebaseAbort,
    handleScmRebaseContinue,
    handleScmRefreshStatus,
    handleScmSelectEntry,
    handleScmStageAll,
    handleScmStash,
    rootPath,
    scmEntries,
    selectedGitChangePath,
    selectedGitChangeRelativePath,
    selectedScmEntry,
    t,
  ]);

  const renderedProblemsSidebarContent = useMemo(() => (
    <ProblemsSidebarContent
      groups={problemGroups}
      summary={problemSummary}
      rootPath={rootPath}
      onOpenFileLocation={openFileLocation}
      t={t}
    />
  ), [
    openFileLocation,
    problemGroups,
    problemSummary,
    rootPath,
    t,
  ]);

  const renderedSidebarContent = useMemo(() => {
    if (!isSidebarVisible) {
      return null;
    }

    if (sidebarMode === 'files') {
      return renderedFilesSidebarContent;
    }

    if (sidebarMode === 'search') {
      return renderedSearchSidebarContent;
    }

    if (sidebarMode === 'scm') {
      return renderedScmSidebarContent;
    }

    return renderedProblemsSidebarContent;
  }, [
    isSidebarVisible,
    renderedFilesSidebarContent,
    renderedProblemsSidebarContent,
    renderedScmSidebarContent,
    renderedSearchSidebarContent,
    sidebarMode,
  ]);

  const renderedSidebar = useMemo(() => {
    if (!isSidebarVisible) {
      return null;
    }

    return (
      <>
        <aside
          ref={sidebarElementRef}
          className="flex h-full shrink-0 flex-col border-r border-[rgb(var(--border))]"
          style={{
            ...CODE_PANE_CHROME_SURFACE_STYLE,
            width: `${sidebarWidth}px`,
          }}
        >
          {renderedSidebarContent}
        </aside>
        <div
          role="separator"
          aria-orientation="vertical"
          data-testid="code-pane-sidebar-resize-handle"
          onMouseDown={startSidebarResize}
          onDoubleClick={resetSidebarWidth}
          className={`flex h-full w-3 shrink-0 cursor-col-resize items-center justify-center transition-colors ${isSidebarResizing ? 'text-zinc-100' : 'text-zinc-600 hover:text-zinc-300'}`}
          style={CODE_PANE_CHROME_SURFACE_STYLE}
        >
          <GripVertical size={12} />
        </div>
      </>
    );
  }, [
    isSidebarResizing,
    isSidebarVisible,
    renderedSidebarContent,
    resetSidebarWidth,
    sidebarWidth,
    startSidebarResize,
  ]);

  return (
    <>
      <style>
        {`
          .code-pane-definition-link {
            cursor: pointer;
            text-decoration: underline;
            text-decoration-thickness: 1px;
            text-underline-offset: 2px;
          }

          .code-pane-breakpoint-glyph,
          .code-pane-debug-current-glyph {
            border-radius: 9999px;
            box-sizing: border-box;
            display: block;
            height: 10px;
            margin: 4px auto 0;
            width: 10px;
          }

          .code-pane-breakpoint-glyph {
            background: #ef4444;
            box-shadow: 0 0 0 1px rgba(248, 113, 113, 0.45);
          }

          .code-pane-breakpoint-glyph-disabled {
            background: #71717a;
            box-shadow: 0 0 0 1px rgba(161, 161, 170, 0.4);
          }

          .code-pane-breakpoint-glyph-conditional {
            background: #f97316;
            box-shadow: 0 0 0 1px rgba(251, 146, 60, 0.45);
          }

          .code-pane-breakpoint-glyph-log {
            background: #06b6d4;
            box-shadow: 0 0 0 1px rgba(34, 211, 238, 0.45);
          }

          .code-pane-debug-current-glyph {
            background: #f59e0b;
            box-shadow: 0 0 0 1px rgba(251, 191, 36, 0.45);
          }

          .code-pane-debug-current-line {
            background: rgba(245, 158, 11, 0.14);
          }
        `}
      </style>
      <div
        ref={rootContainerRef}
        data-testid="code-pane-root"
        className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
        style={CODE_PANE_ROOT_SURFACE_STYLE}
        onMouseDown={(event) => {
          if (event.button !== 0) {
            return;
          }
          onActivate();
        }}
      >
        <CursorSideEffects
          cursorStore={cursorStoreRef.current}
          isQuickDocumentationOpen={isQuickDocumentationOpen}
          isEditorSplitVisible={isEditorSplitVisible}
          secondaryFilePath={secondaryFilePath}
          viewMode={viewMode}
          onLoadQuickDocumentation={() => {
            void loadQuickDocumentation();
          }}
          onNormalizeEditorTarget={(target) => {
            focusedEditorTargetRef.current = target;
            cursorStoreRef.current.setSnapshot({ target });
          }}
        />

      {renderedWorkspaceHeader}

      {banner && banner.tone !== 'info' && (
        <div className="pointer-events-none absolute right-3 top-9 z-[120] max-w-[min(420px,calc(100%-24px))]">
          <div className={`pointer-events-auto flex items-center justify-between gap-3 rounded border px-3 py-2 text-xs shadow-2xl ${
            banner.tone === 'error'
              ? 'border-red-500/30 bg-zinc-950/96 text-red-200'
              : 'border-amber-500/30 bg-zinc-950/96 text-amber-100'
          }`}>
            <span className="min-w-0 flex-1 break-words">{banner.message}</span>
            <div className="flex items-center gap-2">
              {banner.showReload && banner.filePath && (
                <button
                  type="button"
                  onClick={() => {
                    void reloadFileFromDisk(banner.filePath!);
                    setBanner((currentBanner) => (currentBanner === null ? currentBanner : null));
                  }}
                  className="rounded bg-zinc-900 px-2 py-1 text-[11px] font-medium text-zinc-100 hover:bg-zinc-800"
                >
                  {t('codePane.reload')}
                </button>
              )}
              {banner.showOverwrite && banner.filePath && (
                <button
                  type="button"
                  onClick={() => {
                    void saveFile(banner.filePath!, { overwrite: true }).then((didSave) => {
                      if (didSave) {
                        setBanner((currentBanner) => (currentBanner === null ? currentBanner : null));
                      }
                    });
                  }}
                  className="rounded bg-zinc-900 px-2 py-1 text-[11px] font-medium text-zinc-100 hover:bg-zinc-800"
                >
                  {t('codePane.overwrite')}
                </button>
              )}
              <button
                type="button"
                onClick={() => setBanner((currentBanner) => (currentBanner === null ? currentBanner : null))}
                className="rounded bg-zinc-900/80 p-1 text-zinc-100 hover:bg-zinc-800"
              >
                <X size={12} />
              </button>
            </div>
          </div>
        </div>
      )}

      {pathMutationDialog && (
        <PathMutationDialog
          open
          metaLabel={t('codePane.explorer')}
          title={t(
            pathMutationDialog.mode === 'create-file'
              ? 'codePane.newFile'
              : pathMutationDialog.mode === 'create-folder'
                ? 'codePane.newFolder'
                : 'codePane.renamePath',
          )}
          description={t(
            pathMutationDialog.mode === 'create-file'
              ? 'codePane.pathMutationNewFileDescription'
              : pathMutationDialog.mode === 'create-folder'
                ? 'codePane.pathMutationNewFolderDescription'
                : 'codePane.pathMutationRenameDescription',
          )}
          inputLabel={t('codePane.pathMutationInputLabel')}
          placeholder={t(
            pathMutationDialog.mode === 'create-file'
              ? 'codePane.newFilePrompt'
              : pathMutationDialog.mode === 'create-folder'
                ? 'codePane.newFolderPrompt'
                : 'codePane.renamePathPrompt',
          )}
          initialValue={pathMutationDialog.initialValue}
          locationLabel={t('codePane.pathMutationLocation')}
          locationPath={pathMutationLocationPath}
          previewLabel={t('codePane.pathMutationPreview')}
          getPreviewPath={(value) => {
            if (!value.trim()) {
              return '';
            }

            if (pathMutationDialog.mode === 'rename') {
              return getRelativePath(rootPath, replacePathLeaf(pathMutationDialog.targetPath, value.trim())) || rootLabel;
            }

            return getRelativePath(
              rootPath,
              buildChildPath(pathMutationDialog.targetPath, pathMutationDialog.entryType, value.trim()),
            ) || rootLabel;
          }}
          previewPlaceholder={t('codePane.pathMutationPreviewEmpty')}
          confirmLabel={t(
            pathMutationDialog.mode === 'rename'
              ? 'codePane.renamePath'
              : 'common.create',
          )}
          icon={pathMutationDialog.mode === 'create-folder'
            ? <FolderPlus size={12} className="shrink-0 text-amber-300" />
            : pathMutationDialog.mode === 'rename'
              ? <FileIcon size={12} className="shrink-0 text-sky-300" />
              : <Plus size={12} className="shrink-0 text-sky-300" />}
          isSubmitting={isSubmittingPathMutation}
          canConfirm={(value) => (
            pathMutationDialog.mode === 'rename'
              ? Boolean(value) && value !== getPathLeafLabel(pathMutationDialog.targetPath)
              : Boolean(value)
          )}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) {
              setPathMutationDialog((currentDialog) => (currentDialog === null ? currentDialog : null));
            }
          }}
          onConfirm={handlePathMutationConfirm}
        />
      )}

      {actionInputDialog && actionInputDialogConfig && (
        <ActionInputDialog
          key={actionInputDialogKey}
          open
          metaLabel={actionInputDialogConfig.metaLabel}
          title={actionInputDialogConfig.title}
          description={actionInputDialogConfig.description}
          inputLabel={actionInputDialogConfig.inputLabel}
          placeholder={actionInputDialogConfig.placeholder}
          initialValue={actionInputDialogConfig.initialValue}
          confirmLabel={actionInputDialogConfig.confirmLabel}
          icon={actionInputDialogConfig.icon}
          auxiliaryContent={actionInputDialogConfig.auxiliaryContent}
          previewLabel={actionInputDialogConfig.previewLabel}
          getPreviewValue={actionInputDialogConfig.getPreviewValue}
          previewPlaceholder={actionInputDialogConfig.previewPlaceholder}
          isSubmitting={isSubmittingActionInput}
          canConfirm={actionInputDialogConfig.canConfirm}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) {
              setActionInputDialog((currentDialog) => (currentDialog === null ? currentDialog : null));
            }
          }}
          onConfirm={submitActionInput}
        />
      )}

      {actionConfirmDialog && actionConfirmDialogConfig && (
        <ActionConfirmDialog
          open
          metaLabel={actionConfirmDialogConfig.metaLabel}
          title={actionConfirmDialogConfig.title}
          description={actionConfirmDialogConfig.description}
          confirmLabel={actionConfirmDialogConfig.confirmLabel}
          confirmTone={actionConfirmDialogConfig.confirmTone}
          isSubmitting={isSubmittingActionConfirm}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) {
              setActionConfirmDialog((currentDialog) => (currentDialog === null ? currentDialog : null));
            }
          }}
          onConfirm={submitActionConfirm}
        />
      )}

      {commitWindowState && (
        <CommitWindow
          open
          summary={gitRepositorySummary}
          entries={commitWindowEntries}
          initialSelectedPaths={commitWindowInitialSelectedPaths}
          selectedPath={selectedGitChangePath}
          selectedRelativePath={selectedGitChangeRelativePath}
          stagedHunks={gitStagedHunks}
          unstagedHunks={gitUnstagedHunks}
          hunksLoading={isGitHunksLoading}
          hunksError={gitHunksError}
          initialMessage={commitWindowState.initialMessage}
          onOpenChange={handleCommitWindowOpenChange}
          onRefresh={handleCommitWindowRefresh}
          onSelectPath={handleCommitWindowSelectPath}
          onStagePath={handleGitStagePath}
          onUnstagePath={handleGitUnstagePath}
          onDiscardPath={handleCommitWindowDiscardPath}
          onOpenFileDiff={handleGitOpenFileDiff}
          onOpenConflictResolver={handleGitOpenConflictResolver}
          onResolveConflict={handleGitResolveConflict}
          onStageHunk={stageGitHunk}
          onUnstageHunk={unstageGitHunk}
          onDiscardHunk={discardGitHunk}
          onCommit={handleCommitWindowCommit}
        />
      )}

      <div
        ref={workspaceLayoutRef}
        data-testid="code-pane-workspace-layout"
        className="flex min-h-0 flex-1 overflow-hidden"
      >
        {renderedActivityRail}

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div
            data-testid="code-pane-workspace-top"
            className="flex min-h-[180px] flex-1 overflow-hidden"
          >
            {renderedSidebar}

            <div data-testid="code-pane-editor-region" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              <div
                ref={openFileTabsScrollRef}
                className="flex min-h-[34px] items-stretch overflow-x-auto overflow-y-hidden border-b border-[rgb(var(--border))]"
                style={CODE_PANE_CHROME_SURFACE_STYLE}
                onScroll={(event) => {
                  scheduleOpenFileTabsViewportUpdate({
                    scrollLeft: event.currentTarget.scrollLeft,
                    viewportWidth: event.currentTarget.clientWidth,
                  });
                }}
              >
                {renderedOpenFileTabs}
              </div>

              <div className="relative min-h-0 flex-1 overflow-hidden" style={CODE_PANE_EDITOR_SURFACE_STYLE}>
                {isQuickDocumentationOpen && (
                  <QuickDocumentationPanel
                    title={t('codePane.quickDocumentation')}
                    loadingLabel={t('codePane.quickDocumentationLoading')}
                    emptyLabel={t('codePane.quickDocumentationEmpty')}
                    error={quickDocumentationError}
                    loading={isQuickDocumentationLoading}
                    result={quickDocumentation}
                    onRefresh={handleQuickDocumentationRefresh}
                    onClose={handleQuickDocumentationClose}
                  />
                )}
                {inspectorPanelMode === 'outline' && inspectorPanelFilePath && (
                  <div className="absolute right-3 top-3 z-20 w-[460px] max-w-[calc(100%-24px)]">
                    <OutlineToolWindow
                      fileLabel={getFileLabel(inspectorPanelFilePath)}
                      symbols={documentSymbolsFilePath === inspectorPanelFilePath ? documentSymbols : []}
                      isLoading={isDocumentSymbolsLoading && documentSymbolsFilePath === inspectorPanelFilePath}
                      error={documentSymbolsFilePath === inspectorPanelFilePath ? documentSymbolsError : null}
                      onClose={closeInspectorPanel}
                      onRefresh={handleInspectorOutlineRefresh}
                      onOpenSymbol={handleInspectorOutlineOpenSymbol}
                      panelClassName="flex max-h-[72vh] min-h-0 flex-col"
                      closeOnDoubleClick
                    />
                  </div>
                )}
                {inspectorPanelMode === 'hierarchy' && inspectorPanelFilePath && (
                  <div className="absolute right-3 top-3 z-20 w-[480px] max-w-[calc(100%-24px)]">
                    <HierarchyToolWindow
                      mode={selectedHierarchyMode}
                      root={hierarchyRootNode}
                      isLoading={isHierarchyLoading}
                      error={hierarchyError}
                      onClose={closeInspectorPanel}
                      onRefresh={() => {
                        void loadHierarchyRoot(selectedHierarchyMode, inspectorPanelFilePath);
                      }}
                      onSelectMode={(mode) => {
                        setSelectedHierarchyMode(mode);
                        void loadHierarchyRoot(mode, inspectorPanelFilePath);
                      }}
                      onToggleNode={(nodeKey) => {
                        void toggleHierarchyNode(nodeKey);
                      }}
                      onOpenItem={(item) => {
                        void openFileLocation({
                          filePath: item.filePath,
                          lineNumber: item.selectionRange.startLineNumber,
                          column: item.selectionRange.startColumn,
                        });
                      }}
                      panelClassName="flex max-h-[72vh] min-h-0 flex-col"
                      closeOnDoubleClick
                    />
                  </div>
                )}
                {activeFilePath ? (
                  <div className="flex h-full min-h-0 flex-col">
                    {isBlameVisible && (
                      <CursorBlameGutter
                        cursorStore={cursorStoreRef.current}
                        enabled={isBlameVisible}
                        loading={isBlameLoading}
                        blameLines={blameLines}
                        onToggle={() => {
                          setIsBlameVisible((currentValue) => !currentValue);
                        }}
                        onOpenHistory={(lineNumber) => {
                          void loadGitHistory({
                            filePath: activeFilePath,
                            lineNumber,
                          });
                        }}
                      />
                    )}
                    {activeExternalReview?.filePath === activeFilePath ? (
                      <div className="min-h-0 flex-1 overflow-hidden p-2">
                        <ExternalChangeReview
                          beforeContent={activeExternalReview.beforeContent}
                          afterContent={activeExternalReview.afterContent}
                          onAcceptAll={() => {
                            acceptExternalReviewAll(activeExternalReview.filePath);
                          }}
                          onRevertAll={() => {
                            void revertExternalReviewAll(activeExternalReview.filePath);
                          }}
                          onAcceptBlock={(block) => {
                            acceptExternalReviewBlock(activeExternalReview.filePath, block);
                          }}
                          onRevertBlock={(block) => {
                            void revertExternalReviewBlock(activeExternalReview.filePath, block);
                          }}
                        />
                      </div>
                    ) : isEditorSplitVisible && secondaryFilePath && viewMode === 'editor' ? (
                      <div className="flex min-h-0 flex-1 overflow-hidden">
                        <div
                          ref={primaryEditorPaneRef}
                          className="min-w-0 shrink-0"
                          style={{ width: `${editorSplitSize * 100}%` }}
                        >
                          <div
                            ref={editorHostRef}
                            className="h-full min-h-0"
                          />
                        </div>
                        <div
                          role="separator"
                          aria-orientation="vertical"
                          data-testid="code-pane-editor-split-resize-handle"
                          onMouseDown={startEditorSplitResize}
                          className={`flex h-full w-3 shrink-0 cursor-col-resize items-center justify-center border-l border-r border-[rgb(var(--border))] transition-colors ${isEditorSplitResizing ? 'text-zinc-100' : 'text-zinc-600 hover:text-zinc-300'}`}
                          style={CODE_PANE_CHROME_SURFACE_STYLE}
                        >
                          <GripVertical size={12} />
                        </div>
                        <div className="flex min-w-0 flex-1 flex-col border-l border-[rgb(var(--border))]/70">
                          <div
                            className="flex items-center justify-between gap-2 border-b border-[rgb(var(--border))] px-2 py-1 text-[11px] text-zinc-400"
                            style={CODE_PANE_CHROME_SURFACE_STYLE}
                          >
                            <span className="truncate">
                              {secondaryFilePath ? getRelativePath(rootPath, getDisplayPath(secondaryFilePath)) : t('codePane.editorSplitEmpty')}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                persistEditorSplitLayout({
                                  visible: false,
                                });
                              }}
                              className="rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-100"
                            >
                              <X size={11} />
                            </button>
                          </div>
                          <div
                            ref={secondaryEditorHostRef}
                            className="min-h-0 flex-1"
                          />
                        </div>
                      </div>
                    ) : (
                      <div
                        ref={editorHostRef}
                        className="min-h-0 flex-1"
                      />
                    )}
                    {isBootstrapping && (
                      <div
                        className="absolute inset-0 flex items-center justify-center text-xs text-zinc-500"
                        style={CODE_PANE_ROOT_SURFACE_STYLE}
                      >
                        {t('codePane.loading')}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
                    <FileCode2 size={24} className="text-zinc-700" />
                    <div className="text-sm font-medium text-zinc-300">{t('codePane.noOpenFile')}</div>
                    <div className="max-w-md text-xs text-zinc-500">{t('codePane.noOpenFileHint')}</div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {bottomPanelMode && (
            <>
              <div
                role="separator"
                aria-orientation="horizontal"
                data-testid="code-pane-bottom-panel-resize-handle"
                onMouseDown={startBottomPanelResize}
                onDoubleClick={resetBottomPanelHeight}
                className={`flex h-3 shrink-0 cursor-row-resize items-center justify-center border-t border-[rgb(var(--border))] transition-colors ${isBottomPanelResizing ? 'text-zinc-100' : 'text-zinc-600 hover:text-zinc-300'}`}
                style={CODE_PANE_CHROME_SURFACE_STYLE}
              >
                <GripHorizontal size={12} />
              </div>
              <div
                ref={bottomPanelElementRef}
                data-testid="code-pane-bottom-panel"
                className="min-h-0 shrink-0 overflow-hidden"
                style={{
                  height: `${effectiveBottomPanelHeight}px`,
                }}
              >
                {renderedBottomPanel}
              </div>
            </>
          )}

          {renderedStatusBar}
        </div>
      </div>

      <SearchEverywhereController
        ref={searchEverywhereControllerRef}
        navigationStore={navigationStoreRef.current}
        rootPath={rootPath}
        onGetCommandItems={getSearchEverywhereCommandItems}
        onLoadResults={loadSearchEverywhereResults}
        onOpenEditorLocation={openEditorLocation}
        onGetDisplayPath={getDisplayPath}
        onGetFileLabel={getFileLabel}
        t={t}
      />

      <CodeActionMenuController
        ref={codeActionMenuControllerRef}
        onLoadActions={loadCodeActionMenuItems}
        onExecuteAction={runCodeActionFromMenu}
        t={t}
      />
      </div>
    </>
  );
};

CodePane.displayName = 'CodePane';
