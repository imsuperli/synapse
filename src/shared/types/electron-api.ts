import { ViewChangedPayload } from './ipc';
import { ProjectConfig } from './project-config';
import { QuickNavConfig } from './quick-nav';
import type {
  AgentCancelRequest,
  AgentGetTaskRequest,
  AgentResetRequest,
  AgentRespondApprovalRequest,
  AgentRestoreTaskRequest,
  AgentSendRequest,
  AgentSendResponse,
  AgentSubmitInteractionRequest,
  AgentTaskErrorPayload,
  AgentTaskEventPayload,
  AgentTaskStatePayload,
} from './agent';
import type {
  ChatCompleteTextRequest,
  ChatCompleteTextResult,
  RestoreAggregatedSessionRequest,
  RestoreAggregatedSessionResult,
  ChatSettings,
  ChatProviderValidationRequest,
  ChatProviderValidationResult,
} from './chat';
import {
  ActiveSSHPortForward,
  ForwardedPortConfig,
  KnownHostEntry,
  SSHAlgorithmCatalog,
  SSHCredentialState,
  SSHImportResult,
  SSHProfile,
  SSHProfileInput,
  SSHProfilePatch,
  SSHSftpDirectoryListing,
  SSHSessionMetrics,
} from './ssh';
import { CanvasActivityEvent, CanvasWorkspace, CanvasWorkspaceTemplate } from './canvas';
import { Window, WindowStatus } from './window';
import { WindowGroup } from './window-group';
import { CustomCategory } from './custom-category';
import {
  FeatureSettings,
  IDEConfig,
  Settings,
  StatusLineConfig,
  TerminalSettings,
  TmuxSettings,
  Workspace,
} from './workspace';
import type {
  PluginBindingScope,
  PluginCatalogEntry,
  PluginListItem,
  PluginRegistry,
  PluginRuntimeState,
  WorkspacePluginSettings,
} from './plugin';
import type {
  AggregatedSessionDetail,
  AggregatedSessionEntry,
  BrowserSyncProfile,
  BrowserSyncState,
  McpServerConfigSnapshot,
  TaskArtifactRecord,
} from './task';
import type { TerminalScreenSnapshot } from '../remote/terminal-protocol';

export interface IpcResponse<T = void> {
  success: boolean;
  data?: T;
  error?: string;
  errorCode?: string;
}

export const SSH_AUTH_FAILED_ERROR_CODE = 'SSH_AUTH_FAILED';
export const CODE_PANE_SAVE_CONFLICT_ERROR_CODE = 'CODE_PANE_SAVE_CONFLICT';
export const CODE_PANE_BINARY_FILE_ERROR_CODE = 'CODE_PANE_BINARY_FILE';
export const CODE_PANE_FILE_TOO_LARGE_ERROR_CODE = 'CODE_PANE_FILE_TOO_LARGE';

export interface CreateWindowConfig {
  name?: string;
  workingDirectory: string;
  command?: string;
}

export interface StartWindowConfig {
  windowId: string;
  paneId?: string;
  name: string;
  workingDirectory: string;
  command?: string;
  initialCols?: number;
  initialRows?: number;
}

export interface SplitPaneConfig {
  workingDirectory: string;
  command?: string;
  env?: Record<string, string>;
  name?: string;
  windowId?: string;
  paneId?: string;
  initialCols?: number;
  initialRows?: number;
}

export interface CreateSSHWindowConfig {
  name?: string;
  profileId: string;
  remoteCwd?: string;
  command?: string;
  initialCols?: number;
  initialRows?: number;
}

export interface StartSSHPaneConfig {
  windowId: string;
  paneId: string;
  profileId: string;
  remoteCwd?: string;
  command?: string;
  initialCols?: number;
  initialRows?: number;
}

export interface CloneSSHPaneSourceConfig {
  profileId: string;
  remoteCwd?: string;
  command?: string;
}

export interface CloneSSHPaneConfig {
  sourceWindowId: string;
  sourcePaneId: string;
  targetWindowId: string;
  targetPaneId: string;
  remoteCwd?: string;
  sourceSsh?: CloneSSHPaneSourceConfig;
}

export interface SSHSessionPortForwardTarget {
  windowId: string;
  paneId: string;
}

export interface AddSSHSessionPortForwardConfig extends SSHSessionPortForwardTarget {
  forward: ForwardedPortConfig;
}

export interface RemoveSSHSessionPortForwardConfig extends SSHSessionPortForwardTarget {
  forwardId: string;
}

export interface ListSSHSftpDirectoryConfig extends SSHSessionPortForwardTarget {
  path?: string;
}

export interface DownloadSSHSftpFileConfig extends SSHSessionPortForwardTarget {
  remotePath: string;
  suggestedName?: string;
}

export interface UploadSSHSftpFilesConfig extends SSHSessionPortForwardTarget {
  remotePath: string;
}

export interface UploadSSHSftpDirectoryConfig extends SSHSessionPortForwardTarget {
  remotePath: string;
}

export interface DownloadSSHSftpDirectoryConfig extends SSHSessionPortForwardTarget {
  remotePath: string;
  suggestedName?: string;
}

export interface CreateSSHSftpDirectoryConfig extends SSHSessionPortForwardTarget {
  parentPath: string;
  name: string;
}

export interface DeleteSSHSftpEntryConfig extends SSHSessionPortForwardTarget {
  remotePath: string;
}

export interface GetSSHSessionMetricsConfig extends SSHSessionPortForwardTarget {
  path?: string;
}

export interface TryPasteSSHClipboardImageConfig extends SSHSessionPortForwardTarget {
  runtimeCwd?: string;
}

export interface TryPasteSSHClipboardImageResult {
  handled: boolean;
  remotePath?: string;
  width?: number;
  height?: number;
}

export const SSH_HOST_KEY_PROMPT_CHANNEL = 'ssh-host-key-prompt';
export const SSH_HOST_KEY_PROMPT_RESPONSE_CHANNEL = 'ssh-host-key-prompt-response';

export type SSHHostKeyPromptReason = 'unknown' | 'mismatch';

export interface SSHHostKeyPromptPayload {
  requestId: string;
  host: string;
  port: number;
  algorithm: string;
  fingerprint: string;
  reason: SSHHostKeyPromptReason;
  storedFingerprint?: string;
}

export interface SSHHostKeyPromptResponse {
  requestId: string;
  trusted: boolean;
  persist: boolean;
}

export interface StartWindowResult {
  pid: number;
  sessionId: string;
  status: WindowStatus;
}

export interface StartSSHPaneResult {
  pid: number | null;
  sessionId: string;
  status: WindowStatus;
}

export interface CheckPtyOutputResult {
  hasOutput: boolean;
}

export interface PtyWriteMetadata {
  source?: string;
}

export interface ShellProgramOption {
  command: string;
  path: string;
  isDefault: boolean;
}

export interface SelectAndScanFolderResult {
  folders: Array<{ name: string; path: string }>;
  parentPath: string | null;
}

export interface WindowStatusChangedPayload {
  windowId: string;
  status: WindowStatus;
  timestamp: string;
}

export interface PaneStatusChangedPayload {
  windowId: string;
  paneId: string;
  status: WindowStatus;
  timestamp: string;
}

export interface ListAggregatedSessionsQuery {
  cwd?: string;
  limit?: number;
}

export interface SaveTaskArtifactRequest {
  kind: TaskArtifactRecord['kind'];
  title: string;
  workspaceId?: string;
  windowId?: string;
  paneId?: string;
  conversationId?: string;
  markdown?: string;
  json?: unknown;
  preview?: string;
}

export interface ListTaskArtifactsQuery {
  workspaceId?: string;
  windowId?: string;
  paneId?: string;
  conversationId?: string;
}

export interface WindowGitBranchChangedPayload {
  windowId: string;
  gitBranch: string | undefined;
  timestamp: string;
}

export interface CodePaneTreeEntry {
  path: string;
  name: string;
  type: 'file' | 'directory';
  size?: number;
  mtimeMs?: number;
  hasChildren?: boolean;
}

export interface CodePaneListDirectoryConfig {
  rootPath: string;
  targetPath?: string;
  includeHidden?: boolean;
}

export interface CodePaneReadFileConfig {
  rootPath: string;
  filePath: string;
  documentUri?: string;
}

export interface CodePaneReadFileResult {
  content: string;
  mtimeMs: number;
  size: number;
  language: string;
  isBinary: boolean;
  readOnly?: boolean;
  documentUri?: string;
  displayPath?: string;
}

export interface CodePaneExternalLibraryRoot {
  id: string;
  label: string;
  path: string;
  description?: string;
}

export interface CodePaneExternalLibrarySection {
  id: string;
  label: string;
  languageId: string;
  roots: CodePaneExternalLibraryRoot[];
}

export interface CodePaneGetExternalLibrarySectionsConfig {
  rootPath: string;
}

export interface CodePaneWriteFileConfig {
  rootPath: string;
  filePath: string;
  content: string;
  expectedMtimeMs?: number;
}

export interface CodePaneWriteFileResult {
  mtimeMs: number;
}

export interface CodePaneDeleteFileConfig {
  rootPath: string;
  filePath: string;
}

export interface CodePaneCreateFileConfig {
  rootPath: string;
  filePath: string;
  content?: string;
}

export interface CodePaneCreateDirectoryConfig {
  rootPath: string;
  directoryPath: string;
}

export interface CodePaneRenamePathConfig {
  rootPath: string;
  sourcePath: string;
  targetPath: string;
}

export interface CodePaneGitStatusConfig {
  rootPath: string;
}

export type CodePaneGitOperationState = 'idle' | 'merge' | 'rebase' | 'cherry-pick' | 'revert' | 'bisect';

export interface CodePaneGitStatusEntry {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked';
  staged?: boolean;
  unstaged?: boolean;
  conflicted?: boolean;
  section?: 'staged' | 'unstaged' | 'untracked' | 'conflicted';
  originalPath?: string;
}

export interface CodePaneGitRepositorySummary {
  repoRootPath: string;
  currentBranch?: string;
  upstreamBranch?: string;
  detachedHead?: boolean;
  headSha?: string;
  aheadCount: number;
  behindCount: number;
  operation: CodePaneGitOperationState;
  hasConflicts: boolean;
}

export interface CodePaneGitGraphConfig {
  rootPath: string;
  limit?: number;
}

export interface CodePaneGitGraphCommit {
  sha: string;
  shortSha: string;
  parents: string[];
  subject: string;
  author: string;
  timestamp: number;
  refs: string[];
  isHead: boolean;
  isMergeCommit: boolean;
  lane: number;
  laneCount: number;
}

export interface CodePaneGitCommitFileChange {
  path: string;
  relativePath: string;
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'type-changed';
  additions: number;
  deletions: number;
  previousPath?: string;
}

export interface CodePaneGitCommitDetailsConfig {
  rootPath: string;
  commitSha: string;
}

export interface CodePaneGitCommitDetails {
  commitSha: string;
  shortSha: string;
  subject: string;
  author: string;
  email?: string;
  timestamp: number;
  body?: string;
  refs: string[];
  files: CodePaneGitCommitFileChange[];
}

export interface CodePaneGitCompareCommitsConfig {
  rootPath: string;
  baseCommitSha: string;
  targetCommitSha: string;
}

export interface CodePaneGitCompareCommitsResult {
  baseCommitSha: string;
  targetCommitSha: string;
  files: CodePaneGitCommitFileChange[];
}

export interface CodePaneGitDiffHunkLine {
  type: 'context' | 'add' | 'delete';
  text: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export interface CodePaneGitDiffHunk {
  id: string;
  filePath: string;
  staged: boolean;
  header: string;
  patch: string;
  lines: CodePaneGitDiffHunkLine[];
}

export interface CodePaneGitDiffHunksConfig {
  rootPath: string;
  filePath: string;
}

export interface CodePaneGitDiffHunksResult {
  filePath: string;
  stagedHunks: CodePaneGitDiffHunk[];
  unstagedHunks: CodePaneGitDiffHunk[];
}

export interface CodePaneGitStageConfig {
  rootPath: string;
  paths: string[];
}

export interface CodePaneGitRemoveConfig {
  rootPath: string;
  paths: string[];
  cached?: boolean;
}

export interface CodePaneGitHunkActionConfig {
  rootPath: string;
  filePath: string;
  patch: string;
}

export interface CodePaneGitDiscardConfig {
  rootPath: string;
  paths: string[];
  restoreStaged?: boolean;
}

export interface CodePaneGitCommitConfig {
  rootPath: string;
  message: string;
  amend?: boolean;
  includeAll?: boolean;
  paths?: string[];
}

export interface CodePaneGitCommitResult {
  commitSha: string;
  shortSha: string;
  summary: string;
}

export interface CodePaneGitStashConfig {
  rootPath: string;
  message?: string;
  includeUntracked?: boolean;
}

export interface CodePaneGitStashResult {
  reference: string;
  message: string;
}

export interface CodePaneGitPushConfig {
  rootPath: string;
  remote?: string;
  branchName?: string;
  setUpstream?: boolean;
}

export interface CodePaneGitPushResult {
  remote: string;
  branchName: string;
}

export interface CodePaneGitCheckoutConfig {
  rootPath: string;
  branchName: string;
  createBranch?: boolean;
  startPoint?: string;
  detached?: boolean;
  preferExisting?: boolean;
}

export interface CodePaneGitUpdateProjectConfig {
  rootPath: string;
}

export interface CodePaneGitUpdateProjectResult {
  mode: 'pull' | 'fetch';
}

export interface CodePaneGitBranchListConfig {
  rootPath: string;
}

export interface CodePaneGitBranchEntry {
  name: string;
  refName: string;
  shortName: string;
  kind: 'local' | 'remote';
  current: boolean;
  upstream?: string;
  aheadCount: number;
  behindCount: number;
  commitSha: string;
  shortSha: string;
  subject: string;
  timestamp: number;
  mergedIntoCurrent: boolean;
}

export interface CodePaneGitRenameBranchConfig {
  rootPath: string;
  branchName: string;
  nextBranchName: string;
}

export interface CodePaneGitDeleteBranchConfig {
  rootPath: string;
  branchName: string;
  force?: boolean;
}

export type CodePaneGitRebasePlanAction = 'pick' | 'squash' | 'fixup' | 'drop';

export interface CodePaneGitRebasePlanEntry {
  commitSha: string;
  shortSha: string;
  subject: string;
  author: string;
  timestamp: number;
  action: CodePaneGitRebasePlanAction;
}

export interface CodePaneGitRebasePlanConfig {
  rootPath: string;
  baseRef?: string;
  limit?: number;
}

export interface CodePaneGitRebasePlanResult {
  baseRef: string;
  currentBranch?: string;
  hasMergeCommits: boolean;
  commits: CodePaneGitRebasePlanEntry[];
}

export interface CodePaneGitApplyRebasePlanConfig {
  rootPath: string;
  baseRef: string;
  entries: CodePaneGitRebasePlanEntry[];
}

export interface CodePaneGitCherryPickConfig {
  rootPath: string;
  commitSha: string;
}

export interface CodePaneGitRebaseControlConfig {
  rootPath: string;
  action: 'continue' | 'abort';
}

export type CodePaneGitResolveConflictStrategy = 'ours' | 'theirs' | 'mark-resolved';

export interface CodePaneGitResolveConflictConfig {
  rootPath: string;
  filePath: string;
  strategy: CodePaneGitResolveConflictStrategy;
}

export interface CodePaneGitConflictDetailsConfig {
  rootPath: string;
  filePath: string;
}

export interface CodePaneGitConflictDetails {
  filePath: string;
  relativePath: string;
  baseContent: string;
  oursContent: string;
  theirsContent: string;
  mergedContent: string;
  language: string;
}

export interface CodePaneGitApplyConflictResolutionConfig {
  rootPath: string;
  filePath: string;
  mergedContent: string;
}

export interface CodePaneGitHistoryConfig {
  rootPath: string;
  filePath?: string;
  lineNumber?: number;
  limit?: number;
}

export interface CodePaneGitHistoryEntry {
  commitSha: string;
  shortSha: string;
  subject: string;
  author: string;
  email?: string;
  timestamp: number;
  refs: string[];
  scope: 'file' | 'line';
  filePath?: string;
  lineNumber?: number;
}

export interface CodePaneGitHistoryResult {
  scope: 'repository' | 'file' | 'line';
  targetFilePath?: string;
  targetLineNumber?: number;
  entries: CodePaneGitHistoryEntry[];
}

export interface CodePaneGitBlameConfig {
  rootPath: string;
  filePath: string;
  startLineNumber?: number;
  endLineNumber?: number;
}

export interface CodePaneGitBlameLine {
  lineNumber: number;
  commitSha: string;
  shortSha: string;
  author: string;
  summary: string;
  timestamp: number;
  text: string;
}

export type CodePanePreviewSource = 'refactor' | 'git';
export type CodePanePreviewFileChangeKind = 'modify' | 'rename' | 'move' | 'delete';

export interface CodePanePreviewStats {
  fileCount: number;
  editCount: number;
  renameCount: number;
  moveCount: number;
  deleteCount: number;
  modifyCount: number;
}

export interface CodePanePreviewFileChange {
  id: string;
  kind: CodePanePreviewFileChangeKind;
  filePath: string;
  targetFilePath?: string;
  language: string;
  beforeContent: string;
  afterContent: string;
  edits: CodePaneTextEdit[];
}

export interface CodePanePreviewChangeSet {
  id: string;
  title: string;
  source: CodePanePreviewSource;
  description?: string;
  createdAt: string;
  files: CodePanePreviewFileChange[];
  warnings?: string[];
  stats?: CodePanePreviewStats;
}

export interface CodePaneReadGitBaseFileConfig {
  rootPath: string;
  filePath: string;
}

export interface CodePaneReadGitBaseFileResult {
  content: string;
  existsInHead: boolean;
}

export interface CodePaneReadGitRevisionFileConfig {
  rootPath: string;
  filePath: string;
  commitSha: string;
}

export interface CodePaneReadGitRevisionFileResult {
  content: string;
  exists: boolean;
}

export interface CodePaneWatchRootConfig {
  paneId: string;
  rootPath: string;
}

export interface CodePaneSearchFilesConfig {
  rootPath: string;
  query: string;
  limit?: number;
}

export interface CodePaneSearchContentsConfig {
  rootPath: string;
  query: string;
  limit?: number;
  maxMatchesPerFile?: number;
}

export interface CodePaneContentMatch {
  filePath: string;
  lineNumber: number;
  column: number;
  lineText: string;
}

export interface CodePaneDocumentSyncConfig {
  paneId: string;
  rootPath: string;
  filePath: string;
  language?: string;
  content: string;
}

export interface CodePaneDocumentCloseConfig {
  paneId: string;
  rootPath: string;
  filePath: string;
}

export interface CodePaneLanguagePrewarmConfig {
  rootPath: string;
  filePath: string;
  language?: string;
}

export interface AttachCodePaneLanguageWorkspaceConfig extends CodePaneLanguagePrewarmConfig {
  paneId: string;
}

export interface CodePaneFsChangedPayload {
  rootPath: string;
  changes: Array<{
    type: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir';
    path: string;
  }>;
}

export interface CodePanePosition {
  lineNumber: number;
  column: number;
}

export interface CodePaneRange {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

export interface CodePaneLocation {
  filePath: string;
  range: CodePaneRange;
  originSelectionRange?: CodePaneRange;
  uri?: string;
  displayPath?: string;
  readOnly?: boolean;
  language?: string;
  content?: string;
}

export interface CodePaneGetDefinitionConfig {
  rootPath: string;
  filePath: string;
  language?: string;
  position: CodePanePosition;
}

export interface CodePaneHoverContent {
  kind: 'markdown' | 'plaintext';
  value: string;
}

export interface CodePaneHoverResult {
  contents: CodePaneHoverContent[];
  range?: CodePaneRange;
}

export interface CodePaneGetHoverConfig {
  rootPath: string;
  filePath: string;
  language?: string;
  position: CodePanePosition;
}

export interface CodePaneReference {
  filePath: string;
  range: CodePaneRange;
  previewText?: string;
}

export interface CodePaneGetReferencesConfig {
  rootPath: string;
  filePath: string;
  language?: string;
  position: CodePanePosition;
}

export interface CodePaneDocumentHighlight {
  range: CodePaneRange;
  kind?: 'text' | 'read' | 'write';
}

export interface CodePaneGetDocumentHighlightsConfig {
  rootPath: string;
  filePath: string;
  language?: string;
  position: CodePanePosition;
}

export interface CodePaneDocumentSymbol {
  name: string;
  detail?: string;
  kind: number;
  range: CodePaneRange;
  selectionRange: CodePaneRange;
  children?: CodePaneDocumentSymbol[];
}

export interface CodePaneGetDocumentSymbolsConfig {
  rootPath: string;
  filePath: string;
  language?: string;
}

export type CodePaneInlayHintKind = 'type' | 'parameter';

export interface CodePaneInlayHint {
  position: CodePanePosition;
  label: string;
  kind?: CodePaneInlayHintKind;
  paddingLeft?: boolean;
  paddingRight?: boolean;
}

export interface CodePaneGetInlayHintsConfig {
  rootPath: string;
  filePath: string;
  language?: string;
  range: CodePaneRange;
}

export interface CodePaneHierarchyItem extends CodePaneLocation {
  name: string;
  detail?: string;
  kind?: number;
  selectionRange: CodePaneRange;
  relationRanges?: CodePaneRange[];
}

export interface CodePaneHierarchyResult {
  root: CodePaneHierarchyItem | null;
  items: CodePaneHierarchyItem[];
}

export type CodePaneCallHierarchyDirection = 'incoming' | 'outgoing';
export type CodePaneTypeHierarchyDirection = 'parents' | 'children';

export interface CodePaneGetCallHierarchyConfig {
  rootPath: string;
  filePath: string;
  language?: string;
  position: CodePanePosition;
  direction: CodePaneCallHierarchyDirection;
}

export interface CodePaneResolveCallHierarchyConfig {
  rootPath: string;
  language?: string;
  direction: CodePaneCallHierarchyDirection;
  item: CodePaneHierarchyItem;
}

export interface CodePaneGetTypeHierarchyConfig {
  rootPath: string;
  filePath: string;
  language?: string;
  position: CodePanePosition;
  direction: CodePaneTypeHierarchyDirection;
}

export interface CodePaneResolveTypeHierarchyConfig {
  rootPath: string;
  language?: string;
  direction: CodePaneTypeHierarchyDirection;
  item: CodePaneHierarchyItem;
}

export interface CodePaneSemanticTokensLegend {
  tokenTypes: string[];
  tokenModifiers: string[];
}

export interface CodePaneSemanticTokensResult {
  resultId?: string;
  legend: CodePaneSemanticTokensLegend;
  data: number[];
}

export interface CodePaneGetSemanticTokensConfig {
  rootPath: string;
  filePath: string;
  language?: string;
}

export interface CodePaneGetSemanticTokenLegendConfig {
  rootPath: string;
  filePath: string;
  language?: string;
}

export interface CodePaneGetImplementationsConfig {
  rootPath: string;
  filePath: string;
  language?: string;
  position: CodePanePosition;
}

export interface CodePaneCompletionItem {
  label: string;
  detail?: string;
  documentation?: string;
  kind?: number;
  insertText?: string;
  filterText?: string;
  sortText?: string;
  range?: CodePaneRange;
}

export interface CodePaneGetCompletionItemsConfig {
  rootPath: string;
  filePath: string;
  language?: string;
  position: CodePanePosition;
  triggerCharacter?: string;
  triggerKind?: number;
}

export interface CodePaneSignatureHelpParameter {
  label: string;
  documentation?: string;
}

export interface CodePaneSignatureHelpSignature {
  label: string;
  documentation?: string;
  parameters?: CodePaneSignatureHelpParameter[];
}

export interface CodePaneSignatureHelpResult {
  signatures: CodePaneSignatureHelpSignature[];
  activeSignature?: number;
  activeParameter?: number;
}

export interface CodePaneGetSignatureHelpConfig {
  rootPath: string;
  filePath: string;
  language?: string;
  position: CodePanePosition;
  triggerCharacter?: string;
}

export interface CodePaneTextEdit {
  filePath: string;
  range: CodePaneRange;
  newText: string;
}

export interface CodePaneRenameSymbolConfig {
  rootPath: string;
  filePath: string;
  language?: string;
  position: CodePanePosition;
  newName: string;
}

export interface CodePanePrepareRenameSymbolRefactorConfig {
  kind: 'rename-symbol';
  rootPath: string;
  filePath: string;
  language?: string;
  position: CodePanePosition;
  newName: string;
}

export interface CodePanePrepareCodeActionRefactorConfig {
  kind: 'code-action';
  rootPath: string;
  filePath: string;
  language?: string;
  actionId: string;
  title?: string;
}

export interface CodePanePrepareRenamePathRefactorConfig {
  kind: 'rename-path' | 'move-path';
  rootPath: string;
  filePath: string;
  nextFilePath: string;
}

export interface CodePanePrepareSafeDeleteRefactorConfig {
  kind: 'safe-delete';
  rootPath: string;
  filePath: string;
}

export type CodePanePrepareRefactorConfig =
  | CodePanePrepareRenameSymbolRefactorConfig
  | CodePanePrepareCodeActionRefactorConfig
  | CodePanePrepareRenamePathRefactorConfig
  | CodePanePrepareSafeDeleteRefactorConfig;

export interface CodePaneApplyRefactorConfig {
  previewId: string;
}

export interface CodePaneFormatDocumentConfig {
  rootPath: string;
  filePath: string;
  language?: string;
  content?: string;
  tabSize?: number;
  insertSpaces?: boolean;
}

export interface CodePaneLintDocumentConfig {
  rootPath: string;
  filePath: string;
  language?: string;
  content?: string;
}

export interface CodePaneWorkspaceSymbol {
  name: string;
  kind: number;
  filePath: string;
  range: CodePaneRange;
  containerName?: string;
  detail?: string;
}

export interface CodePaneGetWorkspaceSymbolsConfig {
  rootPath: string;
  query: string;
  limit?: number;
}

export interface CodePaneCodeActionDiagnostic {
  message: string;
  range: CodePaneRange;
  severity?: 'error' | 'warning' | 'info' | 'hint';
  code?: string;
}

export interface CodePaneCodeAction {
  id: string;
  title: string;
  kind?: string;
  isPreferred?: boolean;
  disabledReason?: string;
  diagnostics?: CodePaneCodeActionDiagnostic[];
}

export interface CodePaneGetCodeActionsConfig {
  rootPath: string;
  filePath: string;
  language?: string;
  range: CodePaneRange;
}

export interface CodePaneRunCodeActionConfig {
  rootPath: string;
  filePath: string;
  language?: string;
  actionId: string;
}

export type CodePaneRunTargetKind = 'application' | 'test' | 'task';
export type CodePaneRunSessionState = 'starting' | 'running' | 'passed' | 'failed' | 'stopped';

export interface CodePaneRunTargetCustomization {
  profiles?: string;
  programArgs?: string;
  vmArgs?: string;
}

export interface CodePaneRunTarget {
  id: string;
  label: string;
  detail: string;
  kind: CodePaneRunTargetKind;
  languageId: string;
  workingDirectory: string;
  filePath?: string;
  canDebug?: boolean;
  debugRequest?: CodePaneDebugRequest;
  customization?: CodePaneRunTargetCustomization;
}

export interface CodePaneListRunTargetsConfig {
  rootPath: string;
  activeFilePath?: string | null;
}

export interface CodePaneRunTargetConfig {
  rootPath: string;
  targetId: string;
  customization?: CodePaneRunTargetCustomization;
}

export interface CodePaneStopRunTargetConfig {
  sessionId: string;
}

export interface CodePaneRunSession {
  id: string;
  targetId: string;
  label: string;
  detail: string;
  kind: CodePaneRunTargetKind;
  languageId: string;
  state: CodePaneRunSessionState;
  workingDirectory: string;
  startedAt: string;
  endedAt?: string;
  exitCode?: number | null;
}

export interface CodePaneRunSessionChangedPayload {
  rootPath: string;
  session: CodePaneRunSession;
}

export interface CodePaneRunSessionOutputPayload {
  rootPath: string;
  sessionId: string;
  chunk: string;
  stream: 'stdout' | 'stderr' | 'system';
}

export interface CodePaneBreakpoint {
  id?: string;
  filePath: string;
  lineNumber: number;
  condition?: string;
  logMessage?: string;
  enabled?: boolean;
}

export type CodePaneDebugSessionState = 'starting' | 'paused' | 'running' | 'stopped' | 'error';
export type CodePaneDebugRequest = 'launch' | 'attach';

export interface CodePaneExceptionBreakpoint {
  id: 'all';
  label: string;
  enabled: boolean;
}

export interface CodePaneDebugStackFrame {
  id: string;
  name: string;
  filePath?: string;
  lineNumber?: number;
  column?: number;
}

export interface CodePaneDebugVariable {
  id: string;
  name: string;
  value: string;
  type?: string;
  evaluateName?: string;
}

export interface CodePaneDebugScope {
  id: string;
  name: string;
  variables: CodePaneDebugVariable[];
}

export interface CodePaneDebugSessionDetails {
  sessionId: string;
  stackFrames: CodePaneDebugStackFrame[];
  scopes: CodePaneDebugScope[];
}

export interface CodePaneDebugEvaluationResult {
  value: string;
  type?: string;
}

export interface CodePaneDebugSession {
  id: string;
  targetId: string;
  label: string;
  detail: string;
  languageId: string;
  adapterType: string;
  request: CodePaneDebugRequest;
  state: CodePaneDebugSessionState;
  workingDirectory: string;
  startedAt: string;
  endedAt?: string;
  stopReason?: string;
  error?: string;
  currentFrame?: CodePaneDebugStackFrame | null;
}

export interface CodePaneDebugSessionChangedPayload {
  rootPath: string;
  session: CodePaneDebugSession;
}

export interface CodePaneDebugSessionOutputPayload {
  rootPath: string;
  sessionId: string;
  chunk: string;
  stream: 'stdout' | 'stderr' | 'system';
}

export interface CodePaneDebugSessionSnapshot {
  session: CodePaneDebugSession;
  output: string;
}

export interface CodePaneDebugStartConfig {
  rootPath: string;
  targetId: string;
  customization?: CodePaneRunTargetCustomization;
}

export interface CodePaneDebugControlConfig {
  sessionId: string;
}

export interface CodePaneGetDebugSessionDetailsConfig {
  sessionId: string;
}

export interface CodePaneListDebugSessionsConfig {
  rootPath: string;
}

export interface CodePaneDebugEvaluateConfig {
  sessionId: string;
  expression: string;
}

export interface CodePaneSetBreakpointConfig {
  rootPath: string;
  breakpoint: CodePaneBreakpoint;
}

export interface CodePaneRemoveBreakpointConfig {
  rootPath: string;
  breakpoint: CodePaneBreakpoint;
}

export interface CodePaneGetExceptionBreakpointsConfig {
  rootPath: string;
}

export interface CodePaneSetExceptionBreakpointsConfig {
  rootPath: string;
  breakpoints: CodePaneExceptionBreakpoint[];
}

export interface CodePaneTestItem {
  id: string;
  label: string;
  kind: 'file' | 'suite' | 'case';
  filePath?: string;
  runnableTargetId?: string;
  children?: CodePaneTestItem[];
}

export interface CodePaneListTestsConfig {
  rootPath: string;
  activeFilePath?: string | null;
}

export interface CodePaneRunTestsConfig {
  rootPath: string;
  targetId: string;
  customization?: CodePaneRunTargetCustomization;
}

export interface CodePaneRerunFailedTestsConfig {
  rootPath: string;
}

export interface CodePaneProjectStatusItem {
  id: string;
  label: string;
  tone?: 'info' | 'warning' | 'error';
}

export interface CodePaneProjectDiagnostic {
  id: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  detail?: string;
  filePath?: string;
  lineNumber?: number;
  commandId?: string;
  commandLabel?: string;
}

export interface CodePaneProjectCommand {
  id: string;
  title: string;
  detail?: string;
  kind?: 'run' | 'refresh' | 'configure' | 'repair';
}

export interface CodePaneProjectCommandGroup {
  id: string;
  title: string;
  commands: CodePaneProjectCommand[];
}

export interface CodePaneProjectDetailCard {
  id: string;
  title: string;
  lines: string[];
}

export interface CodePaneProjectTreeItem {
  id: string;
  label: string;
  kind: 'group' | 'entry';
  description?: string;
  filePath?: string;
  lineNumber?: number;
  column?: number;
  children?: CodePaneProjectTreeItem[];
}

export interface CodePaneProjectTreeSection {
  id: string;
  title: string;
  items: CodePaneProjectTreeItem[];
}

export interface CodePaneProjectContribution {
  id: string;
  title: string;
  languageId: string;
  statusItems?: CodePaneProjectStatusItem[];
  diagnostics?: CodePaneProjectDiagnostic[];
  commandGroups?: CodePaneProjectCommandGroup[];
  detailCards?: CodePaneProjectDetailCard[];
  treeSections?: CodePaneProjectTreeSection[];
}

export interface CodePaneGetProjectContributionConfig {
  rootPath: string;
}

export interface CodePaneRunProjectCommandConfig {
  rootPath: string;
  commandId: string;
}

export interface CodePaneDiagnostic {
  filePath: string;
  owner: string;
  severity: 'hint' | 'info' | 'warning' | 'error';
  message: string;
  source?: string;
  code?: string;
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

export interface CodePaneDiagnosticsChangedPayload {
  rootPath: string;
  filePath: string;
  diagnostics: CodePaneDiagnostic[];
}

export type CodePaneLanguageWorkspacePhase =
  | 'idle'
  | 'starting'
  | 'starting-runtime'
  | 'detecting-project'
  | 'importing-project'
  | 'indexing-workspace'
  | 'ready'
  | 'degraded'
  | 'error';

export interface CodePaneLanguageWorkspaceState {
  pluginId: string;
  workspaceRoot: string;
  projectRoot: string;
  languageId: string;
  runtimeState: PluginRuntimeState;
  phase: CodePaneLanguageWorkspacePhase;
  message?: string;
  progressText?: string;
  readyFeatures: string[];
  timestamp: string;
}

export interface CodePaneLanguageWorkspaceChangedPayload {
  state: CodePaneLanguageWorkspaceState;
}

export interface CodePaneIndexProgressPayload {
  paneId: string;
  rootPath: string;
  state: 'building' | 'ready' | 'error';
  processedDirectoryCount: number;
  totalDirectoryCount: number;
  indexedFileCount: number;
  reusedPersistedIndex: boolean;
  error?: string;
}

export interface PluginCatalogQuery {
  refresh?: boolean;
}

export interface ListPluginsConfig {
  includeCatalog?: boolean;
  refreshCatalog?: boolean;
}

export interface InstallMarketplacePluginConfig {
  pluginId: string;
  version?: string;
  enableByDefault?: boolean;
}

export interface InstallLocalPluginConfig {
  filePath: string;
  enableByDefault?: boolean;
}

export interface UpdatePluginConfig {
  pluginId: string;
  version?: string;
}

export interface UninstallPluginConfig {
  pluginId: string;
}

export interface SetPluginEnabledConfig {
  pluginId: string;
  enabled: boolean | null;
  scope?: PluginBindingScope;
}

export interface SetPluginSettingsConfig {
  pluginId: string;
  values: Record<string, unknown>;
  scope?: PluginBindingScope;
}

export interface PluginRuntimeStateChangedPayload {
  pluginId: string;
  projectRoot: string;
  state: PluginRuntimeState;
  message?: string;
  timestamp: string;
}

export interface TmuxPaneTitleChangedPayload {
  tmuxPaneId: string;
  windowId: string;
  paneId: string;
  title: string;
}

export interface TmuxPaneStyleMetadata {
  borderColor?: string;
  activeBorderColor?: string;
  teamName?: string;
  agentName?: string;
  agentColor?: string;
}

export interface TmuxPaneStyleChangedPayload {
  tmuxPaneId: string;
  windowId: string;
  paneId: string;
  metadata: TmuxPaneStyleMetadata;
}

export interface TmuxWindowSyncedPayload {
  window: Window;
}

export interface TmuxWindowRemovedPayload {
  windowId: string;
}

export interface ProjectConfigUpdatedPayload {
  windowId: string;
  projectConfig: ProjectConfig | null;
}

export interface ClaudeModelUpdatedPayload {
  windowId: string;
  model?: string;
  modelId?: string;
  contextPercentage?: number;
  cost?: number;
}

export interface PtyDataPayload {
  windowId: string;
  paneId?: string;
  data: string;
  seq?: number;
}

export type PtyMouseTrackingProtocol = 'NONE' | 'X10' | 'VT200' | 'DRAG' | 'ANY';
export type PtyMouseTrackingEncoding = 'DEFAULT' | 'SGR' | 'SGR_PIXELS';

export interface PtyKeyboardProtocolState {
  applicationCursorKeysMode: boolean;
  applicationKeypadMode: boolean;
  bracketedPasteMode: boolean;
  sendFocusMode: boolean;
  win32InputMode: boolean;
  mouseTracking: {
    protocol: PtyMouseTrackingProtocol;
    encoding: PtyMouseTrackingEncoding;
  };
  kittyKeyboard: {
    flags: number;
    mainFlags: number;
    altFlags: number;
    mainStack: number[];
    altStack: number[];
  };
}

export interface PtyHistorySnapshot {
  chunks: string[];
  replayChunks?: string[];
  firstSeq: number;
  lastSeq: number;
  evictedBeforeSeq: number;
  keyboardState?: PtyKeyboardProtocolState;
  screenSnapshot?: TerminalScreenSnapshot;
}

export interface RestoreResultPayload {
  windowId: string;
  pid: number | null;
  status: 'restoring' | 'error';
  error?: string;
}

export interface WorkspaceRestoreErrorPayload {
  error: string;
}

export interface CleanupProgressPayload {
  current: number;
  total: number;
}

export interface AppVersionInfo {
  version: string;
  name: string;
}

export interface RemoteNetworkInterface {
  name: string;
  address: string;
}

export interface RemoteStatus {
  ready: boolean;
  endpoint: string | null;
  settings: RemoteSettings;
}

export interface RemotePairingQR {
  available: boolean;
  qrDataUrl?: string;
  pairingUrl?: string;
  endpoint?: string;
  relayEndpoint?: string;
  deviceId?: string;
  expiresAt?: number | null;
}

export interface RemoteDevice {
  deviceId: string;
  name: string;
  scope: string;
  pairedAt: number;
  lastSeenAt: number;
}

export interface RemoteSettings {
  enabled: boolean;
  bindHost: string;
  preferredPort: number;
  selectedAddress: string | null;
  manualEndpoint: string | null;
  acceptedPlainWsNonLocal: boolean;
  startOnLaunch: boolean;
  relayEnabled: boolean;
  relayEndpoint: string | null;
}

export interface RemoteSettingsUpdate {
  enabled?: boolean;
  bindHost?: string;
  preferredPort?: number;
  selectedAddress?: string | null;
  manualEndpoint?: string | null;
  acceptedPlainWsNonLocal?: boolean;
  acceptPlainWsNonLocal?: boolean;
  startOnLaunch?: boolean;
  relayEnabled?: boolean;
  relayEndpoint?: string | null;
}

export type ElectronEventHandler<T> = (event: unknown, payload: T) => void;
export type ElectronSignalHandler = (event: unknown) => void;

export type SettingsPatch =
  & Partial<Omit<Settings, 'ides' | 'quickNav' | 'statusLine' | 'terminal' | 'appearance' | 'tmux' | 'features' | 'sshClipboardImage' | 'customCategories' | 'chat' | 'plugins' | 'keyboardShortcuts'>>
  & {
    ides?: IDEConfig[];
    quickNav?: QuickNavConfig;
    statusLine?: Partial<StatusLineConfig>;
    terminal?: Partial<TerminalSettings>;
    appearance?: Partial<Settings['appearance']>;
    tmux?: Partial<TmuxSettings>;
    features?: Partial<FeatureSettings>;
    sshClipboardImage?: Partial<NonNullable<Settings['sshClipboardImage']>>;
    customCategories?: CustomCategory[];
    chat?: Partial<ChatSettings>;
    plugins?: Partial<WorkspacePluginSettings>;
    keyboardShortcuts?: Partial<NonNullable<Settings['keyboardShortcuts']>>;
  };

export interface ElectronAPI {
  platform: string;
  ping: () => Promise<IpcResponse<string>>;
  getAppVersion: () => Promise<IpcResponse<AppVersionInfo>>;

  createWindow: (config: CreateWindowConfig) => Promise<IpcResponse<Window>>;
  createSSHWindow: (config: CreateSSHWindowConfig) => Promise<IpcResponse<Window>>;
  killTerminal: (pid: number) => Promise<IpcResponse<void>>;
  getTerminalStatus: (pid: number) => Promise<IpcResponse<unknown>>;
  listTerminals: () => Promise<IpcResponse<unknown[]>>;

  closeWindow: (windowId: string) => Promise<IpcResponse<void>>;
  deleteWindow: (windowId: string) => Promise<IpcResponse<void>>;
  startWindow: (config: StartWindowConfig) => Promise<IpcResponse<StartWindowResult>>;
  startSSHPane: (config: StartSSHPaneConfig) => Promise<IpcResponse<StartSSHPaneResult>>;
  cloneSSHPane: (config: CloneSSHPaneConfig) => Promise<IpcResponse<{ pid: number | null; sessionId: string }>>;
  listSSHSessionPortForwards: (config: SSHSessionPortForwardTarget) => Promise<IpcResponse<ActiveSSHPortForward[]>>;
  addSSHSessionPortForward: (config: AddSSHSessionPortForwardConfig) => Promise<IpcResponse<ActiveSSHPortForward>>;
  removeSSHSessionPortForward: (config: RemoveSSHSessionPortForwardConfig) => Promise<IpcResponse<void>>;
  listSSHSftpDirectory: (config: ListSSHSftpDirectoryConfig) => Promise<IpcResponse<SSHSftpDirectoryListing>>;
  getSSHSessionMetrics: (config: GetSSHSessionMetricsConfig) => Promise<IpcResponse<SSHSessionMetrics | null>>;
  downloadSSHSftpFile: (config: DownloadSSHSftpFileConfig) => Promise<IpcResponse<string | null>>;
  uploadSSHSftpFiles: (config: UploadSSHSftpFilesConfig) => Promise<IpcResponse<{ uploadedCount: number }>>;
  uploadSSHSftpDirectory: (config: UploadSSHSftpDirectoryConfig) => Promise<IpcResponse<{ uploadedCount: number }>>;
  downloadSSHSftpDirectory: (config: DownloadSSHSftpDirectoryConfig) => Promise<IpcResponse<string | null>>;
  createSSHSftpDirectory: (config: CreateSSHSftpDirectoryConfig) => Promise<IpcResponse<string>>;
  deleteSSHSftpEntry: (config: DeleteSSHSftpEntryConfig) => Promise<IpcResponse<void>>;
  checkPtyOutput: (windowId: string, paneId: string) => Promise<IpcResponse<CheckPtyOutputResult>>;
  startGitWatch: (windowId: string, cwd: string) => Promise<IpcResponse<void>>;
  stopGitWatch: (windowId: string) => Promise<IpcResponse<void>>;

  validatePath: (path: string) => Promise<IpcResponse<boolean>>;
  createDirectory: (path: string) => Promise<IpcResponse<string>>;
  selectDirectory: () => Promise<IpcResponse<string | null>>;
  selectExecutableFile: () => Promise<IpcResponse<string | null>>;
  selectImageFile: (defaultPath?: string) => Promise<IpcResponse<string | null>>;
  selectPluginPackage: () => Promise<IpcResponse<string | null>>;
  selectAndScanFolder: () => Promise<IpcResponse<SelectAndScanFolderResult>>;
  openFolder: (path: string) => Promise<IpcResponse<void>>;
  openInIDE: (ide: string, path: string) => Promise<IpcResponse<void>>;
  openExternalUrl: (url: string) => Promise<IpcResponse<void>>;

  getSettings: () => Promise<IpcResponse<Settings>>;
  updateSettings: (settings: SettingsPatch) => Promise<IpcResponse<Settings>>;
  remoteListNetworkInterfaces: () => Promise<IpcResponse<{ interfaces: RemoteNetworkInterface[] }>>;
  remoteUpdateSettings: (settings: RemoteSettingsUpdate) => Promise<IpcResponse<{ settings: RemoteSettings; endpoint: string | null }>>;
  remoteGetStatus: () => Promise<IpcResponse<RemoteStatus>>;
  remoteGetPairingQR: (config?: { address?: string; rotate?: boolean }) => Promise<IpcResponse<RemotePairingQR>>;
  remoteRotatePairingQR: (config?: { address?: string }) => Promise<IpcResponse<RemotePairingQR>>;
  remoteListDevices: () => Promise<IpcResponse<{ devices: RemoteDevice[] }>>;
  remoteRevokeDevice: (deviceId: string) => Promise<IpcResponse<{ revoked: boolean }>>;
  validateChatProvider: (config: ChatProviderValidationRequest) => Promise<IpcResponse<ChatProviderValidationResult>>;
  getAvailableShells: () => Promise<IpcResponse<ShellProgramOption[]>>;
  scanIDEs: () => Promise<IpcResponse<IDEConfig[]>>;
  scanSpecificIDE: (ideName: string) => Promise<IpcResponse<string | null>>;
  getSupportedIDENames: () => Promise<IpcResponse<string[]>>;
  updateIDEConfig: (ideConfig: IDEConfig) => Promise<IpcResponse<IDEConfig[]>>;
  deleteIDEConfig: (ideId: string) => Promise<IpcResponse<IDEConfig[]>>;
  getIDEIcon: (iconPath: string) => Promise<IpcResponse<string>>;
  listPlugins: (config?: ListPluginsConfig) => Promise<IpcResponse<PluginListItem[]>>;
  getPluginRegistry: () => Promise<IpcResponse<PluginRegistry>>;
  listPluginCatalog: (query?: PluginCatalogQuery) => Promise<IpcResponse<PluginCatalogEntry[]>>;
  installMarketplacePlugin: (config: InstallMarketplacePluginConfig) => Promise<IpcResponse<PluginListItem>>;
  installLocalPlugin: (config: InstallLocalPluginConfig) => Promise<IpcResponse<PluginListItem>>;
  updatePlugin: (config: UpdatePluginConfig) => Promise<IpcResponse<PluginListItem>>;
  uninstallPlugin: (config: UninstallPluginConfig) => Promise<IpcResponse<void>>;
  setPluginEnabled: (config: SetPluginEnabledConfig) => Promise<IpcResponse<Settings>>;
  setPluginSettings: (config: SetPluginSettingsConfig) => Promise<IpcResponse<Settings>>;
  listSSHProfiles: () => Promise<IpcResponse<SSHProfile[]>>;
  getSSHAlgorithmCatalog: () => Promise<IpcResponse<SSHAlgorithmCatalog>>;
  getSSHProfile: (profileId: string) => Promise<IpcResponse<SSHProfile>>;
  createSSHProfile: (config: SSHProfileInput) => Promise<IpcResponse<SSHProfile>>;
  updateSSHProfile: (profileId: string, patch: SSHProfilePatch) => Promise<IpcResponse<SSHProfile>>;
  deleteSSHProfile: (profileId: string) => Promise<IpcResponse<void>>;
  importOpenSSHProfiles: () => Promise<IpcResponse<SSHImportResult>>;
  detectLocalSSHPrivateKeys: () => Promise<IpcResponse<string[]>>;
  getSSHCredentialState: (profileId: string) => Promise<IpcResponse<SSHCredentialState>>;
  setSSHPassword: (profileId: string, password: string) => Promise<IpcResponse<void>>;
  clearSSHPassword: (profileId: string) => Promise<IpcResponse<void>>;
  setSSHPrivateKeyPassphrase: (profileId: string, keyPath: string, passphrase: string) => Promise<IpcResponse<void>>;
  clearSSHPrivateKeyPassphrase: (profileId: string, keyPath: string) => Promise<IpcResponse<void>>;
  clearSSHProfileCredentials: (profileId: string) => Promise<IpcResponse<void>>;
  listKnownHosts: () => Promise<IpcResponse<KnownHostEntry[]>>;
  removeKnownHost: (entryId: string) => Promise<IpcResponse<void>>;
  onSSHHostKeyPrompt: (callback: ElectronEventHandler<SSHHostKeyPromptPayload>) => void;
  offSSHHostKeyPrompt: (callback: ElectronEventHandler<SSHHostKeyPromptPayload>) => void;
  respondSSHHostKeyPrompt: (response: SSHHostKeyPromptResponse) => void;

  statusLineCheckClaudeInstalled: () => Promise<IpcResponse<boolean>>;
  statusLineCheckConfigured: () => Promise<IpcResponse<boolean>>;
  statusLineConfigure: () => Promise<IpcResponse<boolean>>;
  statusLineRemove: () => Promise<IpcResponse<boolean>>;
  statusLineRestore: () => Promise<IpcResponse<boolean>>;

  onWindowStatusChanged: (callback: ElectronEventHandler<WindowStatusChangedPayload>) => void;
  offWindowStatusChanged: (callback: ElectronEventHandler<WindowStatusChangedPayload>) => void;
  onPaneStatusChanged: (callback: ElectronEventHandler<PaneStatusChangedPayload>) => void;
  offPaneStatusChanged: (callback: ElectronEventHandler<PaneStatusChangedPayload>) => void;
  onWindowGitBranchChanged: (callback: ElectronEventHandler<WindowGitBranchChangedPayload>) => void;
  offWindowGitBranchChanged: (callback: ElectronEventHandler<WindowGitBranchChangedPayload>) => void;
  codePaneListDirectory: (config: CodePaneListDirectoryConfig) => Promise<IpcResponse<CodePaneTreeEntry[]>>;
  codePaneReadFile: (config: CodePaneReadFileConfig) => Promise<IpcResponse<CodePaneReadFileResult>>;
  codePaneWriteFile: (config: CodePaneWriteFileConfig) => Promise<IpcResponse<CodePaneWriteFileResult>>;
  codePaneDeleteFile: (config: CodePaneDeleteFileConfig) => Promise<IpcResponse<void>>;
  codePaneCreateFile: (config: CodePaneCreateFileConfig) => Promise<IpcResponse<CodePaneTreeEntry>>;
  codePaneCreateDirectory: (config: CodePaneCreateDirectoryConfig) => Promise<IpcResponse<CodePaneTreeEntry>>;
  codePaneRenamePath: (config: CodePaneRenamePathConfig) => Promise<IpcResponse<CodePaneTreeEntry>>;
  codePaneGetExternalLibrarySections: (config: CodePaneGetExternalLibrarySectionsConfig) => Promise<IpcResponse<CodePaneExternalLibrarySection[]>>;
  codePaneGetGitStatus: (config: CodePaneGitStatusConfig) => Promise<IpcResponse<CodePaneGitStatusEntry[]>>;
  codePaneGetGitRepositorySummary: (config: CodePaneGitStatusConfig) => Promise<IpcResponse<CodePaneGitRepositorySummary | null>>;
  codePaneGetGitGraph: (config: CodePaneGitGraphConfig) => Promise<IpcResponse<CodePaneGitGraphCommit[]>>;
  codePaneGetGitCommitDetails: (config: CodePaneGitCommitDetailsConfig) => Promise<IpcResponse<CodePaneGitCommitDetails>>;
  codePaneCompareGitCommits: (config: CodePaneGitCompareCommitsConfig) => Promise<IpcResponse<CodePaneGitCompareCommitsResult>>;
  codePaneGetGitDiffHunks: (config: CodePaneGitDiffHunksConfig) => Promise<IpcResponse<CodePaneGitDiffHunksResult>>;
  codePaneGitStage: (config: CodePaneGitStageConfig) => Promise<IpcResponse<void>>;
  codePaneGitUnstage: (config: CodePaneGitStageConfig) => Promise<IpcResponse<void>>;
  codePaneGitRemove: (config: CodePaneGitRemoveConfig) => Promise<IpcResponse<void>>;
  codePaneGitDiscard: (config: CodePaneGitDiscardConfig) => Promise<IpcResponse<void>>;
  codePaneGitStageHunk: (config: CodePaneGitHunkActionConfig) => Promise<IpcResponse<void>>;
  codePaneGitUnstageHunk: (config: CodePaneGitHunkActionConfig) => Promise<IpcResponse<void>>;
  codePaneGitDiscardHunk: (config: CodePaneGitHunkActionConfig) => Promise<IpcResponse<void>>;
  codePaneGitCommit: (config: CodePaneGitCommitConfig) => Promise<IpcResponse<CodePaneGitCommitResult>>;
  codePaneGitStash: (config: CodePaneGitStashConfig) => Promise<IpcResponse<CodePaneGitStashResult>>;
  codePaneGitPush: (config: CodePaneGitPushConfig) => Promise<IpcResponse<CodePaneGitPushResult>>;
  codePaneGitUpdateProject: (config: CodePaneGitUpdateProjectConfig) => Promise<IpcResponse<CodePaneGitUpdateProjectResult>>;
  codePaneGitCheckout: (config: CodePaneGitCheckoutConfig) => Promise<IpcResponse<void>>;
  codePaneGetGitBranches: (config: CodePaneGitBranchListConfig) => Promise<IpcResponse<CodePaneGitBranchEntry[]>>;
  codePaneGitRenameBranch: (config: CodePaneGitRenameBranchConfig) => Promise<IpcResponse<void>>;
  codePaneGitDeleteBranch: (config: CodePaneGitDeleteBranchConfig) => Promise<IpcResponse<void>>;
  codePaneGetGitRebasePlan: (config: CodePaneGitRebasePlanConfig) => Promise<IpcResponse<CodePaneGitRebasePlanResult>>;
  codePaneGitApplyRebasePlan: (config: CodePaneGitApplyRebasePlanConfig) => Promise<IpcResponse<void>>;
  codePaneGitCherryPick: (config: CodePaneGitCherryPickConfig) => Promise<IpcResponse<void>>;
  codePaneGitRebaseControl: (config: CodePaneGitRebaseControlConfig) => Promise<IpcResponse<void>>;
  codePaneGitResolveConflict: (config: CodePaneGitResolveConflictConfig) => Promise<IpcResponse<void>>;
  codePaneGetGitConflictDetails: (config: CodePaneGitConflictDetailsConfig) => Promise<IpcResponse<CodePaneGitConflictDetails>>;
  codePaneGitApplyConflictResolution: (config: CodePaneGitApplyConflictResolutionConfig) => Promise<IpcResponse<void>>;
  codePaneGitHistory: (config: CodePaneGitHistoryConfig) => Promise<IpcResponse<CodePaneGitHistoryResult>>;
  codePaneGitBlame: (config: CodePaneGitBlameConfig) => Promise<IpcResponse<CodePaneGitBlameLine[]>>;
  codePaneReadGitBaseFile: (config: CodePaneReadGitBaseFileConfig) => Promise<IpcResponse<CodePaneReadGitBaseFileResult>>;
  codePaneReadGitRevisionFile: (config: CodePaneReadGitRevisionFileConfig) => Promise<IpcResponse<CodePaneReadGitRevisionFileResult>>;
  codePaneWatchRoot: (config: CodePaneWatchRootConfig) => Promise<IpcResponse<void>>;
  codePaneUnwatchRoot: (paneId: string) => Promise<IpcResponse<void>>;
  codePaneSearchFiles: (config: CodePaneSearchFilesConfig) => Promise<IpcResponse<string[]>>;
  codePaneSearchContents: (config: CodePaneSearchContentsConfig) => Promise<IpcResponse<CodePaneContentMatch[]>>;
  codePaneDidOpenDocument: (config: CodePaneDocumentSyncConfig) => Promise<IpcResponse<void>>;
  codePaneDidChangeDocument: (config: CodePaneDocumentSyncConfig) => Promise<IpcResponse<void>>;
  codePaneDidSaveDocument: (config: CodePaneDocumentSyncConfig) => Promise<IpcResponse<void>>;
  codePaneDidCloseDocument: (config: CodePaneDocumentCloseConfig) => Promise<IpcResponse<void>>;
  codePanePrewarmLanguageWorkspace: (config: CodePaneLanguagePrewarmConfig) => Promise<IpcResponse<void>>;
  codePaneAttachLanguageWorkspace: (config: AttachCodePaneLanguageWorkspaceConfig) => Promise<IpcResponse<CodePaneLanguageWorkspaceState | null>>;
  codePaneGetLanguageWorkspaceState: (config: CodePaneLanguagePrewarmConfig) => Promise<IpcResponse<CodePaneLanguageWorkspaceState | null>>;
  codePaneDetachLanguageWorkspace: (paneId: string) => Promise<IpcResponse<void>>;
  codePaneGetDefinition: (config: CodePaneGetDefinitionConfig) => Promise<IpcResponse<CodePaneLocation[]>>;
  codePaneGetHover: (config: CodePaneGetHoverConfig) => Promise<IpcResponse<CodePaneHoverResult | null>>;
  codePaneGetReferences: (config: CodePaneGetReferencesConfig) => Promise<IpcResponse<CodePaneReference[]>>;
  codePaneGetDocumentHighlights: (config: CodePaneGetDocumentHighlightsConfig) => Promise<IpcResponse<CodePaneDocumentHighlight[]>>;
  codePaneGetDocumentSymbols: (config: CodePaneGetDocumentSymbolsConfig) => Promise<IpcResponse<CodePaneDocumentSymbol[]>>;
  codePaneGetInlayHints: (config: CodePaneGetInlayHintsConfig) => Promise<IpcResponse<CodePaneInlayHint[]>>;
  codePaneGetCallHierarchy: (config: CodePaneGetCallHierarchyConfig) => Promise<IpcResponse<CodePaneHierarchyResult>>;
  codePaneResolveCallHierarchy: (config: CodePaneResolveCallHierarchyConfig) => Promise<IpcResponse<CodePaneHierarchyItem[]>>;
  codePaneGetTypeHierarchy: (config: CodePaneGetTypeHierarchyConfig) => Promise<IpcResponse<CodePaneHierarchyResult>>;
  codePaneResolveTypeHierarchy: (config: CodePaneResolveTypeHierarchyConfig) => Promise<IpcResponse<CodePaneHierarchyItem[]>>;
  codePaneGetSemanticTokens: (config: CodePaneGetSemanticTokensConfig) => Promise<IpcResponse<CodePaneSemanticTokensResult | null>>;
  codePaneGetSemanticTokenLegend: (config: CodePaneGetSemanticTokenLegendConfig) => Promise<IpcResponse<CodePaneSemanticTokensLegend | null>>;
  codePaneGetImplementations: (config: CodePaneGetImplementationsConfig) => Promise<IpcResponse<CodePaneLocation[]>>;
  codePaneGetCompletionItems: (config: CodePaneGetCompletionItemsConfig) => Promise<IpcResponse<CodePaneCompletionItem[]>>;
  codePaneGetSignatureHelp: (config: CodePaneGetSignatureHelpConfig) => Promise<IpcResponse<CodePaneSignatureHelpResult | null>>;
  codePaneRenameSymbol: (config: CodePaneRenameSymbolConfig) => Promise<IpcResponse<CodePaneTextEdit[]>>;
  codePaneFormatDocument: (config: CodePaneFormatDocumentConfig) => Promise<IpcResponse<CodePaneTextEdit[]>>;
  codePaneLintDocument: (config: CodePaneLintDocumentConfig) => Promise<IpcResponse<CodePaneDiagnostic[]>>;
  codePaneGetWorkspaceSymbols: (config: CodePaneGetWorkspaceSymbolsConfig) => Promise<IpcResponse<CodePaneWorkspaceSymbol[]>>;
  codePaneGetCodeActions: (config: CodePaneGetCodeActionsConfig) => Promise<IpcResponse<CodePaneCodeAction[]>>;
  codePaneRunCodeAction: (config: CodePaneRunCodeActionConfig) => Promise<IpcResponse<CodePaneTextEdit[]>>;
  codePanePrepareRefactor: (config: CodePanePrepareRefactorConfig) => Promise<IpcResponse<CodePanePreviewChangeSet>>;
  codePaneApplyRefactor: (config: CodePaneApplyRefactorConfig) => Promise<IpcResponse<CodePanePreviewChangeSet>>;
  codePaneListRunTargets: (config: CodePaneListRunTargetsConfig) => Promise<IpcResponse<CodePaneRunTarget[]>>;
  codePaneRunTarget: (config: CodePaneRunTargetConfig) => Promise<IpcResponse<CodePaneRunSession>>;
  codePaneStopRunTarget: (config: CodePaneStopRunTargetConfig) => Promise<IpcResponse<void>>;
  codePaneDebugStart: (config: CodePaneDebugStartConfig) => Promise<IpcResponse<CodePaneDebugSession>>;
  codePaneDebugStop: (config: CodePaneDebugControlConfig) => Promise<IpcResponse<void>>;
  codePaneDebugPause: (config: CodePaneDebugControlConfig) => Promise<IpcResponse<void>>;
  codePaneDebugContinue: (config: CodePaneDebugControlConfig) => Promise<IpcResponse<void>>;
  codePaneDebugStepOver: (config: CodePaneDebugControlConfig) => Promise<IpcResponse<void>>;
  codePaneDebugStepInto: (config: CodePaneDebugControlConfig) => Promise<IpcResponse<void>>;
  codePaneDebugStepOut: (config: CodePaneDebugControlConfig) => Promise<IpcResponse<void>>;
  codePaneListDebugSessions: (config: CodePaneListDebugSessionsConfig) => Promise<IpcResponse<CodePaneDebugSessionSnapshot[]>>;
  codePaneGetDebugSessionDetails: (config: CodePaneGetDebugSessionDetailsConfig) => Promise<IpcResponse<CodePaneDebugSessionDetails>>;
  codePaneDebugEvaluate: (config: CodePaneDebugEvaluateConfig) => Promise<IpcResponse<CodePaneDebugEvaluationResult>>;
  codePaneSetBreakpoint: (config: CodePaneSetBreakpointConfig) => Promise<IpcResponse<void>>;
  codePaneRemoveBreakpoint: (config: CodePaneRemoveBreakpointConfig) => Promise<IpcResponse<void>>;
  codePaneGetExceptionBreakpoints: (config: CodePaneGetExceptionBreakpointsConfig) => Promise<IpcResponse<CodePaneExceptionBreakpoint[]>>;
  codePaneSetExceptionBreakpoints: (config: CodePaneSetExceptionBreakpointsConfig) => Promise<IpcResponse<void>>;
  codePaneListTests: (config: CodePaneListTestsConfig) => Promise<IpcResponse<CodePaneTestItem[]>>;
  codePaneRunTests: (config: CodePaneRunTestsConfig) => Promise<IpcResponse<CodePaneRunSession>>;
  codePaneRerunFailedTests: (config: CodePaneRerunFailedTestsConfig) => Promise<IpcResponse<CodePaneRunSession[]>>;
  codePaneGetProjectContribution: (config: CodePaneGetProjectContributionConfig) => Promise<IpcResponse<CodePaneProjectContribution[]>>;
  codePaneRefreshProjectModel: (config: CodePaneGetProjectContributionConfig) => Promise<IpcResponse<CodePaneProjectContribution[]>>;
  codePaneRunProjectCommand: (config: CodePaneRunProjectCommandConfig) => Promise<IpcResponse<CodePaneRunSession | null>>;
  onCodePaneFsChanged: (callback: ElectronEventHandler<CodePaneFsChangedPayload>) => void;
  offCodePaneFsChanged: (callback: ElectronEventHandler<CodePaneFsChangedPayload>) => void;
  onCodePaneIndexProgress: (callback: ElectronEventHandler<CodePaneIndexProgressPayload>) => void;
  offCodePaneIndexProgress: (callback: ElectronEventHandler<CodePaneIndexProgressPayload>) => void;
  onCodePaneRunSessionChanged: (callback: ElectronEventHandler<CodePaneRunSessionChangedPayload>) => void;
  offCodePaneRunSessionChanged: (callback: ElectronEventHandler<CodePaneRunSessionChangedPayload>) => void;
  onCodePaneRunSessionOutput: (callback: ElectronEventHandler<CodePaneRunSessionOutputPayload>) => void;
  offCodePaneRunSessionOutput: (callback: ElectronEventHandler<CodePaneRunSessionOutputPayload>) => void;
  onCodePaneDebugSessionChanged: (callback: ElectronEventHandler<CodePaneDebugSessionChangedPayload>) => void;
  offCodePaneDebugSessionChanged: (callback: ElectronEventHandler<CodePaneDebugSessionChangedPayload>) => void;
  onCodePaneDebugSessionOutput: (callback: ElectronEventHandler<CodePaneDebugSessionOutputPayload>) => void;
  offCodePaneDebugSessionOutput: (callback: ElectronEventHandler<CodePaneDebugSessionOutputPayload>) => void;
  onCodePaneDiagnosticsChanged: (callback: ElectronEventHandler<CodePaneDiagnosticsChangedPayload>) => void;
  offCodePaneDiagnosticsChanged: (callback: ElectronEventHandler<CodePaneDiagnosticsChangedPayload>) => void;
  onCodePaneLanguageWorkspaceChanged: (callback: ElectronEventHandler<CodePaneLanguageWorkspaceChangedPayload>) => void;
  offCodePaneLanguageWorkspaceChanged: (callback: ElectronEventHandler<CodePaneLanguageWorkspaceChangedPayload>) => void;
  onPluginRuntimeStateChanged: (callback: ElectronEventHandler<PluginRuntimeStateChangedPayload>) => void;
  offPluginRuntimeStateChanged: (callback: ElectronEventHandler<PluginRuntimeStateChangedPayload>) => void;
  onTmuxPaneTitleChanged: (callback: ElectronEventHandler<TmuxPaneTitleChangedPayload>) => void;
  offTmuxPaneTitleChanged: (callback: ElectronEventHandler<TmuxPaneTitleChangedPayload>) => void;
  onTmuxPaneStyleChanged: (callback: ElectronEventHandler<TmuxPaneStyleChangedPayload>) => void;
  offTmuxPaneStyleChanged: (callback: ElectronEventHandler<TmuxPaneStyleChangedPayload>) => void;
  onTmuxWindowSynced: (callback: ElectronEventHandler<TmuxWindowSyncedPayload>) => void;
  offTmuxWindowSynced: (callback: ElectronEventHandler<TmuxWindowSyncedPayload>) => void;
  onTmuxWindowRemoved: (callback: ElectronEventHandler<TmuxWindowRemovedPayload>) => void;
  offTmuxWindowRemoved: (callback: ElectronEventHandler<TmuxWindowRemovedPayload>) => void;
  onProjectConfigUpdated: (callback: ElectronEventHandler<ProjectConfigUpdatedPayload>) => void;
  offProjectConfigUpdated: (callback: ElectronEventHandler<ProjectConfigUpdatedPayload>) => void;
  onClaudeModelUpdated: (callback: ElectronEventHandler<ClaudeModelUpdatedPayload>) => void;
  offClaudeModelUpdated: (callback: ElectronEventHandler<ClaudeModelUpdatedPayload>) => void;

  ptyWrite: (
    windowId: string,
    paneId: string | undefined,
    data: string,
    metadata?: PtyWriteMetadata,
  ) => Promise<IpcResponse<void>>;
  ptyResize: (windowId: string, paneId: string | undefined, cols: number, rows: number) => Promise<IpcResponse<void>>;
  getPtyHistory: (paneId: string) => Promise<IpcResponse<PtyHistorySnapshot>>;
  updateTerminalScreenSnapshot: (snapshot: TerminalScreenSnapshot) => void;
  onPtyData: (callback: ElectronEventHandler<PtyDataPayload>) => void;
  offPtyData: (callback: ElectronEventHandler<PtyDataPayload>) => void;

  splitPane: (config: SplitPaneConfig) => Promise<IpcResponse<{ pid: number; sessionId: string }>>;
  closePane: (windowId: string, paneId: string) => Promise<IpcResponse<void>>;

  switchToTerminalView: (windowId: string) => Promise<IpcResponse<void>>;
  switchToCanvasView: (canvasWorkspaceId: string) => Promise<IpcResponse<void>>;
  switchToUnifiedView: () => Promise<IpcResponse<void>>;
  setActivePane: (windowId: string, paneId: string | null) => Promise<IpcResponse<void>>;
  onViewChanged: (callback: ElectronEventHandler<ViewChangedPayload>) => void;
  offViewChanged: (callback: ElectronEventHandler<ViewChangedPayload>) => void;

  saveWorkspace: (payload: {
    windows: Window[];
    groups?: WindowGroup[];
    canvasWorkspaces?: CanvasWorkspace[];
    canvasWorkspaceTemplates?: CanvasWorkspaceTemplate[];
    canvasActivity?: CanvasActivityEvent[];
  }) => Promise<IpcResponse<void>>;
  loadWorkspace: () => Promise<IpcResponse<Workspace>>;
  onWorkspaceLoaded: (callback: ElectronEventHandler<Workspace>) => void;
  offWorkspaceLoaded: (callback: ElectronEventHandler<Workspace>) => void;
  triggerAutoSave: (
    windows?: Window[],
    groups?: WindowGroup[],
    canvasWorkspaces?: CanvasWorkspace[],
    canvasWorkspaceTemplates?: CanvasWorkspaceTemplate[],
    canvasActivity?: CanvasActivityEvent[],
  ) => void;

  writeClipboardText: (text: string) => Promise<IpcResponse<void>>;
  readClipboardText: () => Promise<IpcResponse<string>>;
  tryPasteSshClipboardImage: (
    windowId: string,
    paneId: string,
    runtimeCwd?: string,
  ) => Promise<IpcResponse<TryPasteSSHClipboardImageResult>>;

  notifyRendererReady: () => void;

  onWindowRestored: (callback: ElectronEventHandler<RestoreResultPayload>) => void;
  offWindowRestored: (callback: ElectronEventHandler<RestoreResultPayload>) => void;
  onWorkspaceRestoreError: (callback: ElectronEventHandler<WorkspaceRestoreErrorPayload>) => void;
  offWorkspaceRestoreError: (callback: ElectronEventHandler<WorkspaceRestoreErrorPayload>) => void;
  recoverFromBackup: () => Promise<IpcResponse<Workspace>>;

  onCleanupStarted: (callback: ElectronSignalHandler) => void;
  offCleanupStarted: (callback: ElectronSignalHandler) => void;
  onCleanupProgress: (callback: ElectronEventHandler<CleanupProgressPayload>) => void;
  offCleanupProgress: (callback: ElectronEventHandler<CleanupProgressPayload>) => void;

  // Task/session enhancements
  listAggregatedSessions: (query?: ListAggregatedSessionsQuery) => Promise<IpcResponse<AggregatedSessionEntry[]>>;
  getAggregatedSessionDetail: (entryId: string) => Promise<IpcResponse<AggregatedSessionDetail>>;
  restoreAggregatedSession: (request: RestoreAggregatedSessionRequest) => Promise<IpcResponse<RestoreAggregatedSessionResult>>;
  saveTaskArtifact: (request: SaveTaskArtifactRequest) => Promise<IpcResponse<TaskArtifactRecord>>;
  listTaskArtifacts: (query?: ListTaskArtifactsQuery) => Promise<IpcResponse<TaskArtifactRecord[]>>;
  deleteTaskArtifact: (artifactId: string) => Promise<IpcResponse<void>>;
  listBrowserSyncProfiles: () => Promise<IpcResponse<BrowserSyncProfile[]>>;
  getBrowserSyncState: () => Promise<IpcResponse<BrowserSyncState>>;
  syncBrowserProfile: (profileId: string) => Promise<IpcResponse<BrowserSyncState>>;
  getMcpServerSnapshots: () => Promise<IpcResponse<McpServerConfigSnapshot[]>>;

  // Group management
  createGroup: (name: string, windowIds: string[]) => Promise<IpcResponse<WindowGroup>>;
  deleteGroup: (groupId: string) => Promise<IpcResponse<void>>;
  archiveGroup: (groupId: string) => Promise<IpcResponse<void>>;
  unarchiveGroup: (groupId: string) => Promise<IpcResponse<void>>;
  renameGroup: (groupId: string, name: string) => Promise<IpcResponse<void>>;
  addWindowToGroup: (groupId: string, windowId: string, direction: 'horizontal' | 'vertical', targetWindowId: string | null) => Promise<IpcResponse<void>>;
  removeWindowFromGroup: (groupId: string, windowId: string) => Promise<IpcResponse<{ dissolved: boolean }>>;
  updateGroupSplitSizes: (groupId: string, splitPath: number[], sizes: number[]) => Promise<IpcResponse<void>>;

  // Window controls
  windowMinimize: () => Promise<IpcResponse<void>>;
  windowMaximize: () => Promise<IpcResponse<void>>;
  windowToggleFullScreen: () => Promise<IpcResponse<void>>;
  windowClose: () => Promise<IpcResponse<void>>;
  windowIsMaximized: () => Promise<IpcResponse<boolean>>;
  windowIsFullScreen: () => Promise<IpcResponse<boolean>>;
  onWindowMaximized: (callback: (isMaximized: boolean) => void) => () => void;
  onWindowFullScreen: (callback: (isFullScreen: boolean) => void) => () => void;
  onStartupReveal?: (callback: () => void) => () => void;

  // Chat pane
  agentSend: (request: AgentSendRequest) => Promise<IpcResponse<AgentSendResponse>>;
  agentCancel: (request: AgentCancelRequest) => Promise<IpcResponse<void>>;
  agentResetTask: (request: AgentResetRequest) => Promise<IpcResponse<void>>;
  agentRespondApproval: (request: AgentRespondApprovalRequest) => Promise<IpcResponse<void>>;
  agentSubmitInteraction: (request: AgentSubmitInteractionRequest) => Promise<IpcResponse<void>>;
  agentGetTask: (request: AgentGetTaskRequest) => Promise<IpcResponse<AgentTaskStatePayload['task'] | null>>;
  agentRestoreTask: (request: AgentRestoreTaskRequest) => Promise<IpcResponse<AgentTaskStatePayload['task']>>;
  onAgentTimelineEvent: (callback: ElectronEventHandler<AgentTaskEventPayload>) => void;
  offAgentTimelineEvent: (callback: ElectronEventHandler<AgentTaskEventPayload>) => void;
  onAgentTaskState: (callback: ElectronEventHandler<AgentTaskStatePayload>) => void;
  offAgentTaskState: (callback: ElectronEventHandler<AgentTaskStatePayload>) => void;
  onAgentTaskError: (callback: ElectronEventHandler<AgentTaskErrorPayload>) => void;
  offAgentTaskError: (callback: ElectronEventHandler<AgentTaskErrorPayload>) => void;
  chatCompleteText: (request: ChatCompleteTextRequest) => Promise<IpcResponse<ChatCompleteTextResult>>;
}
