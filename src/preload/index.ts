import { contextBridge, ipcRenderer } from 'electron';
import type { ElectronAPI, PtyWriteMetadata } from '../shared/types/electron-api';

const SSH_HOST_KEY_PROMPT_CHANNEL = 'ssh-host-key-prompt';
const SSH_HOST_KEY_PROMPT_RESPONSE_CHANNEL = 'ssh-host-key-prompt-response';

// 暴露受控的 IPC API 到渲染进程
const electronAPI: ElectronAPI = {
  platform: process.platform,
  ping: () => ipcRenderer.invoke('ping'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),

  // Terminal management
  createWindow: (config: { name?: string; workingDirectory: string; command?: string }) =>
    ipcRenderer.invoke('create-window', config),
  createSSHWindow: (config: unknown) =>
    ipcRenderer.invoke('create-ssh-window', config),
  killTerminal: (pid: number) => ipcRenderer.invoke('kill-terminal', pid),
  getTerminalStatus: (pid: number) => ipcRenderer.invoke('get-terminal-status', pid),
  listTerminals: () => ipcRenderer.invoke('list-terminals'),

  // Window management
  closeWindow: (windowId: string) => ipcRenderer.invoke('close-window', { windowId }),
  deleteWindow: (windowId: string) => ipcRenderer.invoke('delete-window', { windowId }),
  startWindow: (config: { windowId: string; paneId?: string; name: string; workingDirectory: string; command?: string }) =>
    ipcRenderer.invoke('start-window', config),
  startSSHPane: (config: unknown) =>
    ipcRenderer.invoke('start-ssh-pane', config),
  cloneSSHPane: (config: unknown) =>
    ipcRenderer.invoke('clone-ssh-pane', config),
  listSSHSessionPortForwards: (config: unknown) =>
    ipcRenderer.invoke('list-ssh-session-port-forwards', config),
  addSSHSessionPortForward: (config: unknown) =>
    ipcRenderer.invoke('add-ssh-session-port-forward', config),
  removeSSHSessionPortForward: (config: unknown) =>
    ipcRenderer.invoke('remove-ssh-session-port-forward', config),
  listSSHSftpDirectory: (config: unknown) =>
    ipcRenderer.invoke('list-ssh-sftp-directory', config),
  getSSHSessionMetrics: (config: unknown) =>
    ipcRenderer.invoke('get-ssh-session-metrics', config),
  downloadSSHSftpFile: (config: unknown) =>
    ipcRenderer.invoke('download-ssh-sftp-file', config),
  uploadSSHSftpFiles: (config: unknown) =>
    ipcRenderer.invoke('upload-ssh-sftp-files', config),
  uploadSSHSftpDirectory: (config: unknown) =>
    ipcRenderer.invoke('upload-ssh-sftp-directory', config),
  downloadSSHSftpDirectory: (config: unknown) =>
    ipcRenderer.invoke('download-ssh-sftp-directory', config),
  createSSHSftpDirectory: (config: unknown) =>
    ipcRenderer.invoke('create-ssh-sftp-directory', config),
  deleteSSHSftpEntry: (config: unknown) =>
    ipcRenderer.invoke('delete-ssh-sftp-entry', config),
  checkPtyOutput: (windowId: string, paneId: string) => ipcRenderer.invoke('check-pty-output', { windowId, paneId }),
  startGitWatch: (windowId: string, cwd: string) => ipcRenderer.invoke('start-git-watch', { windowId, cwd }),
  stopGitWatch: (windowId: string) => ipcRenderer.invoke('stop-git-watch', { windowId }),

  // File system
  validatePath: (path: string) => ipcRenderer.invoke('validate-path', path),
  createDirectory: (path: string) => ipcRenderer.invoke('create-directory', path),
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  selectExecutableFile: () => ipcRenderer.invoke('select-executable-file'),
  selectImageFile: (defaultPath?: string) => ipcRenderer.invoke('select-image-file', defaultPath),
  selectPluginPackage: () => ipcRenderer.invoke('select-plugin-package'),
  selectAndScanFolder: () => ipcRenderer.invoke('select-and-scan-folder'),
  openFolder: (path: string) => ipcRenderer.invoke('open-folder', { path }),
  openInIDE: (ide: string, path: string) => ipcRenderer.invoke('open-in-ide', { ide, path }),
  openExternalUrl: (url: string) => ipcRenderer.invoke('open-external-url', { url }),

  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  updateSettings: (settings: unknown) => ipcRenderer.invoke('update-settings', settings),
  validateChatProvider: (config: unknown) => ipcRenderer.invoke('validate-chat-provider', config),
  getAvailableShells: () => ipcRenderer.invoke('get-available-shells'),
  scanIDEs: () => ipcRenderer.invoke('scan-ides'),
  scanSpecificIDE: (ideName: string) => ipcRenderer.invoke('scan-specific-ide', ideName),
  getSupportedIDENames: () => ipcRenderer.invoke('get-supported-ide-names'),
  updateIDEConfig: (ideConfig: unknown) => ipcRenderer.invoke('update-ide-config', ideConfig),
  deleteIDEConfig: (ideId: string) => ipcRenderer.invoke('delete-ide-config', ideId),
  getIDEIcon: (iconPath: string) => ipcRenderer.invoke('get-ide-icon', iconPath),
  listPlugins: (config) => ipcRenderer.invoke('list-plugins', config),
  getPluginRegistry: () => ipcRenderer.invoke('get-plugin-registry'),
  listPluginCatalog: (query) => ipcRenderer.invoke('list-plugin-catalog', query),
  installMarketplacePlugin: (config) => ipcRenderer.invoke('install-marketplace-plugin', config),
  installLocalPlugin: (config) => ipcRenderer.invoke('install-local-plugin', config),
  updatePlugin: (config) => ipcRenderer.invoke('update-plugin', config),
  uninstallPlugin: (config) => ipcRenderer.invoke('uninstall-plugin', config),
  setPluginEnabled: (config) => ipcRenderer.invoke('set-plugin-enabled', config),
  setPluginSettings: (config) => ipcRenderer.invoke('set-plugin-settings', config),
  listSSHProfiles: () => ipcRenderer.invoke('list-ssh-profiles'),
  getSSHAlgorithmCatalog: () => ipcRenderer.invoke('get-ssh-algorithm-catalog'),
  getSSHProfile: (profileId: string) => ipcRenderer.invoke('get-ssh-profile', profileId),
  createSSHProfile: (config: unknown) => ipcRenderer.invoke('create-ssh-profile', config),
  updateSSHProfile: (profileId: string, patch: unknown) => ipcRenderer.invoke('update-ssh-profile', profileId, patch),
  deleteSSHProfile: (profileId: string) => ipcRenderer.invoke('delete-ssh-profile', profileId),
  importOpenSSHProfiles: () => ipcRenderer.invoke('import-openssh-profiles'),
  detectLocalSSHPrivateKeys: () => ipcRenderer.invoke('detect-local-ssh-private-keys'),
  getSSHCredentialState: (profileId: string) => ipcRenderer.invoke('get-ssh-credential-state', profileId),
  setSSHPassword: (profileId: string, password: string) => ipcRenderer.invoke('set-ssh-password', profileId, password),
  clearSSHPassword: (profileId: string) => ipcRenderer.invoke('clear-ssh-password', profileId),
  setSSHPrivateKeyPassphrase: (profileId: string, keyPath: string, passphrase: string) =>
    ipcRenderer.invoke('set-ssh-private-key-passphrase', profileId, keyPath, passphrase),
  clearSSHPrivateKeyPassphrase: (profileId: string, keyPath: string) =>
    ipcRenderer.invoke('clear-ssh-private-key-passphrase', profileId, keyPath),
  clearSSHProfileCredentials: (profileId: string) =>
    ipcRenderer.invoke('clear-ssh-profile-credentials', profileId),
  listKnownHosts: () => ipcRenderer.invoke('list-known-hosts'),
  removeKnownHost: (entryId: string) => ipcRenderer.invoke('remove-known-host', entryId),
  onSSHHostKeyPrompt: (callback) => {
    ipcRenderer.on(SSH_HOST_KEY_PROMPT_CHANNEL, callback);
  },
  offSSHHostKeyPrompt: (callback) => {
    ipcRenderer.removeListener(SSH_HOST_KEY_PROMPT_CHANNEL, callback);
  },
  respondSSHHostKeyPrompt: (response) => {
    ipcRenderer.send(SSH_HOST_KEY_PROMPT_RESPONSE_CHANNEL, response);
  },

  // StatusLine
  statusLineCheckClaudeInstalled: () => ipcRenderer.invoke('statusline-check-claude-installed'),
  statusLineCheckConfigured: () => ipcRenderer.invoke('statusline-check-configured'),
  statusLineConfigure: () => ipcRenderer.invoke('statusline-configure'),
  statusLineRemove: () => ipcRenderer.invoke('statusline-remove'),
  statusLineRestore: () => ipcRenderer.invoke('statusline-restore'),

  // Status events
  onWindowStatusChanged: (callback) => {
    ipcRenderer.on('window-status-changed', callback);
  },
  offWindowStatusChanged: (callback) =>
    ipcRenderer.removeListener('window-status-changed', callback),
  onPaneStatusChanged: (callback) => {
    ipcRenderer.on('pane-status-changed', callback);
  },
  offPaneStatusChanged: (callback) =>
    ipcRenderer.removeListener('pane-status-changed', callback),
  onWindowGitBranchChanged: (callback) => {
    ipcRenderer.on('window-git-branch-changed', callback);
  },
  offWindowGitBranchChanged: (callback) =>
    ipcRenderer.removeListener('window-git-branch-changed', callback),
  codePaneListDirectory: (config) =>
    ipcRenderer.invoke('code-pane-list-directory', config),
  codePaneReadFile: (config) =>
    ipcRenderer.invoke('code-pane-read-file', config),
  codePaneWriteFile: (config) =>
    ipcRenderer.invoke('code-pane-write-file', config),
  codePaneDeleteFile: (config) =>
    ipcRenderer.invoke('code-pane-delete-file', config),
  codePaneCreateFile: (config) =>
    ipcRenderer.invoke('code-pane-create-file', config),
  codePaneCreateDirectory: (config) =>
    ipcRenderer.invoke('code-pane-create-directory', config),
  codePaneRenamePath: (config) =>
    ipcRenderer.invoke('code-pane-rename-path', config),
  codePaneGetExternalLibrarySections: (config) =>
    ipcRenderer.invoke('code-pane-get-external-library-sections', config),
  codePaneGetGitStatus: (config) =>
    ipcRenderer.invoke('code-pane-git-status', config),
  codePaneGetGitRepositorySummary: (config) =>
    ipcRenderer.invoke('code-pane-git-repository-summary', config),
  codePaneGetGitGraph: (config) =>
    ipcRenderer.invoke('code-pane-git-graph', config),
  codePaneGetGitCommitDetails: (config) =>
    ipcRenderer.invoke('code-pane-git-commit-details', config),
  codePaneCompareGitCommits: (config) =>
    ipcRenderer.invoke('code-pane-compare-git-commits', config),
  codePaneGetGitDiffHunks: (config) =>
    ipcRenderer.invoke('code-pane-git-diff-hunks', config),
  codePaneGitStage: (config) =>
    ipcRenderer.invoke('code-pane-git-stage', config),
  codePaneGitUnstage: (config) =>
    ipcRenderer.invoke('code-pane-git-unstage', config),
  codePaneGitRemove: (config) =>
    ipcRenderer.invoke('code-pane-git-remove', config),
  codePaneGitDiscard: (config) =>
    ipcRenderer.invoke('code-pane-git-discard', config),
  codePaneGitStageHunk: (config) =>
    ipcRenderer.invoke('code-pane-git-stage-hunk', config),
  codePaneGitUnstageHunk: (config) =>
    ipcRenderer.invoke('code-pane-git-unstage-hunk', config),
  codePaneGitDiscardHunk: (config) =>
    ipcRenderer.invoke('code-pane-git-discard-hunk', config),
  codePaneGitCommit: (config) =>
    ipcRenderer.invoke('code-pane-git-commit', config),
  codePaneGitStash: (config) =>
    ipcRenderer.invoke('code-pane-git-stash', config),
  codePaneGitPush: (config) =>
    ipcRenderer.invoke('code-pane-git-push', config),
  codePaneGitUpdateProject: (config) =>
    ipcRenderer.invoke('code-pane-git-update-project', config),
  codePaneGitCheckout: (config) =>
    ipcRenderer.invoke('code-pane-git-checkout', config),
  codePaneGetGitBranches: (config) =>
    ipcRenderer.invoke('code-pane-git-branches', config),
  codePaneGitRenameBranch: (config) =>
    ipcRenderer.invoke('code-pane-git-rename-branch', config),
  codePaneGitDeleteBranch: (config) =>
    ipcRenderer.invoke('code-pane-git-delete-branch', config),
  codePaneGetGitRebasePlan: (config) =>
    ipcRenderer.invoke('code-pane-git-rebase-plan', config),
  codePaneGitApplyRebasePlan: (config) =>
    ipcRenderer.invoke('code-pane-git-apply-rebase-plan', config),
  codePaneGitCherryPick: (config) =>
    ipcRenderer.invoke('code-pane-git-cherry-pick', config),
  codePaneGitRebaseControl: (config) =>
    ipcRenderer.invoke('code-pane-git-rebase-control', config),
  codePaneGitResolveConflict: (config) =>
    ipcRenderer.invoke('code-pane-git-resolve-conflict', config),
  codePaneGetGitConflictDetails: (config) =>
    ipcRenderer.invoke('code-pane-git-conflict-details', config),
  codePaneGitApplyConflictResolution: (config) =>
    ipcRenderer.invoke('code-pane-git-apply-conflict-resolution', config),
  codePaneGitHistory: (config) =>
    ipcRenderer.invoke('code-pane-git-history', config),
  codePaneGitBlame: (config) =>
    ipcRenderer.invoke('code-pane-git-blame', config),
  codePaneReadGitBaseFile: (config) =>
    ipcRenderer.invoke('code-pane-read-git-base-file', config),
  codePaneReadGitRevisionFile: (config) =>
    ipcRenderer.invoke('code-pane-read-git-revision-file', config),
  codePaneWatchRoot: (config) =>
    ipcRenderer.invoke('code-pane-watch-root', config),
  codePaneUnwatchRoot: (paneId: string) =>
    ipcRenderer.invoke('code-pane-unwatch-root', { paneId }),
  codePaneSearchFiles: (config) =>
    ipcRenderer.invoke('code-pane-search-files', config),
  codePaneSearchContents: (config) =>
    ipcRenderer.invoke('code-pane-search-contents', config),
  codePaneDidOpenDocument: (config) =>
    ipcRenderer.invoke('code-pane-did-open-document', config),
  codePaneDidChangeDocument: (config) =>
    ipcRenderer.invoke('code-pane-did-change-document', config),
  codePaneDidSaveDocument: (config) =>
    ipcRenderer.invoke('code-pane-did-save-document', config),
  codePaneDidCloseDocument: (config) =>
    ipcRenderer.invoke('code-pane-did-close-document', config),
  codePanePrewarmLanguageWorkspace: (config) =>
    ipcRenderer.invoke('code-pane-prewarm-language-workspace', config),
  codePaneAttachLanguageWorkspace: (config) =>
    ipcRenderer.invoke('code-pane-attach-language-workspace', config),
  codePaneGetLanguageWorkspaceState: (config) =>
    ipcRenderer.invoke('code-pane-get-language-workspace-state', config),
  codePaneDetachLanguageWorkspace: (paneId) =>
    ipcRenderer.invoke('code-pane-detach-language-workspace', { paneId }),
  codePaneGetDefinition: (config) =>
    ipcRenderer.invoke('code-pane-get-definition', config),
  codePaneGetHover: (config) =>
    ipcRenderer.invoke('code-pane-get-hover', config),
  codePaneGetReferences: (config) =>
    ipcRenderer.invoke('code-pane-get-references', config),
  codePaneGetDocumentHighlights: (config) =>
    ipcRenderer.invoke('code-pane-get-document-highlights', config),
  codePaneGetDocumentSymbols: (config) =>
    ipcRenderer.invoke('code-pane-get-document-symbols', config),
  codePaneGetInlayHints: (config) =>
    ipcRenderer.invoke('code-pane-get-inlay-hints', config),
  codePaneGetCallHierarchy: (config) =>
    ipcRenderer.invoke('code-pane-get-call-hierarchy', config),
  codePaneResolveCallHierarchy: (config) =>
    ipcRenderer.invoke('code-pane-resolve-call-hierarchy', config),
  codePaneGetTypeHierarchy: (config) =>
    ipcRenderer.invoke('code-pane-get-type-hierarchy', config),
  codePaneResolveTypeHierarchy: (config) =>
    ipcRenderer.invoke('code-pane-resolve-type-hierarchy', config),
  codePaneGetSemanticTokens: (config) =>
    ipcRenderer.invoke('code-pane-get-semantic-tokens', config),
  codePaneGetSemanticTokenLegend: (config) =>
    ipcRenderer.invoke('code-pane-get-semantic-token-legend', config),
  codePaneGetImplementations: (config) =>
    ipcRenderer.invoke('code-pane-get-implementations', config),
  codePaneGetCompletionItems: (config) =>
    ipcRenderer.invoke('code-pane-get-completion-items', config),
  codePaneGetSignatureHelp: (config) =>
    ipcRenderer.invoke('code-pane-get-signature-help', config),
  codePaneRenameSymbol: (config) =>
    ipcRenderer.invoke('code-pane-rename-symbol', config),
  codePaneFormatDocument: (config) =>
    ipcRenderer.invoke('code-pane-format-document', config),
  codePaneLintDocument: (config) =>
    ipcRenderer.invoke('code-pane-lint-document', config),
  codePaneGetWorkspaceSymbols: (config) =>
    ipcRenderer.invoke('code-pane-get-workspace-symbols', config),
  codePaneGetCodeActions: (config) =>
    ipcRenderer.invoke('code-pane-get-code-actions', config),
  codePaneRunCodeAction: (config) =>
    ipcRenderer.invoke('code-pane-run-code-action', config),
  codePanePrepareRefactor: (config) =>
    ipcRenderer.invoke('code-pane-prepare-refactor', config),
  codePaneApplyRefactor: (config) =>
    ipcRenderer.invoke('code-pane-apply-refactor', config),
  codePaneListRunTargets: (config) =>
    ipcRenderer.invoke('code-pane-list-run-targets', config),
  codePaneRunTarget: (config) =>
    ipcRenderer.invoke('code-pane-run-target', config),
  codePaneStopRunTarget: (config) =>
    ipcRenderer.invoke('code-pane-stop-run-target', config),
  codePaneDebugStart: (config) =>
    ipcRenderer.invoke('code-pane-debug-start', config),
  codePaneDebugStop: (config) =>
    ipcRenderer.invoke('code-pane-debug-stop', config),
  codePaneDebugPause: (config) =>
    ipcRenderer.invoke('code-pane-debug-pause', config),
  codePaneDebugContinue: (config) =>
    ipcRenderer.invoke('code-pane-debug-continue', config),
  codePaneDebugStepOver: (config) =>
    ipcRenderer.invoke('code-pane-debug-step-over', config),
  codePaneDebugStepInto: (config) =>
    ipcRenderer.invoke('code-pane-debug-step-into', config),
  codePaneDebugStepOut: (config) =>
    ipcRenderer.invoke('code-pane-debug-step-out', config),
  codePaneListDebugSessions: (config) =>
    ipcRenderer.invoke('code-pane-list-debug-sessions', config),
  codePaneGetDebugSessionDetails: (config) =>
    ipcRenderer.invoke('code-pane-get-debug-session-details', config),
  codePaneDebugEvaluate: (config) =>
    ipcRenderer.invoke('code-pane-debug-evaluate', config),
  codePaneSetBreakpoint: (config) =>
    ipcRenderer.invoke('code-pane-set-breakpoint', config),
  codePaneRemoveBreakpoint: (config) =>
    ipcRenderer.invoke('code-pane-remove-breakpoint', config),
  codePaneGetExceptionBreakpoints: (config) =>
    ipcRenderer.invoke('code-pane-get-exception-breakpoints', config),
  codePaneSetExceptionBreakpoints: (config) =>
    ipcRenderer.invoke('code-pane-set-exception-breakpoints', config),
  codePaneListTests: (config) =>
    ipcRenderer.invoke('code-pane-list-tests', config),
  codePaneRunTests: (config) =>
    ipcRenderer.invoke('code-pane-run-tests', config),
  codePaneRerunFailedTests: (config) =>
    ipcRenderer.invoke('code-pane-rerun-failed-tests', config),
  codePaneGetProjectContribution: (config) =>
    ipcRenderer.invoke('code-pane-get-project-contribution', config),
  codePaneRefreshProjectModel: (config) =>
    ipcRenderer.invoke('code-pane-refresh-project-model', config),
  codePaneRunProjectCommand: (config) =>
    ipcRenderer.invoke('code-pane-run-project-command', config),
  onCodePaneFsChanged: (callback) => {
    ipcRenderer.on('code-pane-fs-changed', callback);
  },
  offCodePaneFsChanged: (callback) =>
    ipcRenderer.removeListener('code-pane-fs-changed', callback),
  onCodePaneIndexProgress: (callback) => {
    ipcRenderer.on('code-pane-index-progress', callback);
  },
  offCodePaneIndexProgress: (callback) =>
    ipcRenderer.removeListener('code-pane-index-progress', callback),
  onCodePaneRunSessionChanged: (callback) => {
    ipcRenderer.on('code-pane-run-session-changed', callback);
  },
  offCodePaneRunSessionChanged: (callback) =>
    ipcRenderer.removeListener('code-pane-run-session-changed', callback),
  onCodePaneRunSessionOutput: (callback) => {
    ipcRenderer.on('code-pane-run-session-output', callback);
  },
  offCodePaneRunSessionOutput: (callback) =>
    ipcRenderer.removeListener('code-pane-run-session-output', callback),
  onCodePaneDebugSessionChanged: (callback) => {
    ipcRenderer.on('code-pane-debug-session-changed', callback);
  },
  offCodePaneDebugSessionChanged: (callback) =>
    ipcRenderer.removeListener('code-pane-debug-session-changed', callback),
  onCodePaneDebugSessionOutput: (callback) => {
    ipcRenderer.on('code-pane-debug-session-output', callback);
  },
  offCodePaneDebugSessionOutput: (callback) =>
    ipcRenderer.removeListener('code-pane-debug-session-output', callback),
  onCodePaneDiagnosticsChanged: (callback) => {
    ipcRenderer.on('code-pane-diagnostics-changed', callback);
  },
  offCodePaneDiagnosticsChanged: (callback) =>
    ipcRenderer.removeListener('code-pane-diagnostics-changed', callback),
  onCodePaneLanguageWorkspaceChanged: (callback) => {
    ipcRenderer.on('code-pane-language-workspace-changed', callback);
  },
  offCodePaneLanguageWorkspaceChanged: (callback) =>
    ipcRenderer.removeListener('code-pane-language-workspace-changed', callback),
  onPluginRuntimeStateChanged: (callback) => {
    ipcRenderer.on('plugin-runtime-state-changed', callback);
  },
  offPluginRuntimeStateChanged: (callback) =>
    ipcRenderer.removeListener('plugin-runtime-state-changed', callback),

  // Tmux pane metadata events
  onTmuxPaneTitleChanged: (callback) => {
    ipcRenderer.on('tmux:pane-title-changed', callback);
  },
  offTmuxPaneTitleChanged: (callback) => {
    ipcRenderer.removeListener('tmux:pane-title-changed', callback);
  },
  onTmuxPaneStyleChanged: (callback) => {
    ipcRenderer.on('tmux:pane-style-changed', callback);
  },
  offTmuxPaneStyleChanged: (callback) => {
    ipcRenderer.removeListener('tmux:pane-style-changed', callback);
  },
  onTmuxWindowSynced: (callback) => {
    ipcRenderer.on('tmux:window-synced', callback);
  },
  offTmuxWindowSynced: (callback) => {
    ipcRenderer.removeListener('tmux:window-synced', callback);
  },
  onTmuxWindowRemoved: (callback) => {
    ipcRenderer.on('tmux:window-removed', callback);
  },
  offTmuxWindowRemoved: (callback) => {
    ipcRenderer.removeListener('tmux:window-removed', callback);
  },

  // Project config updates
  onProjectConfigUpdated: (callback) => {
    ipcRenderer.on('project-config-updated', callback);
  },
  offProjectConfigUpdated: (callback) => {
    ipcRenderer.removeListener('project-config-updated', callback);
  },

  // Claude model updates
  onClaudeModelUpdated: (callback) => {
    ipcRenderer.on('claude-model-updated', callback);
  },
  offClaudeModelUpdated: (callback) => {
    ipcRenderer.removeListener('claude-model-updated', callback);
  },

  // PTY I/O
  ptyWrite: (windowId: string, paneId: string | undefined, data: string, metadata?: PtyWriteMetadata) => {
    // PTY input is on the keystroke hot path. Use fire-and-forget IPC to avoid
    // paying a request/response round trip for every character.
    ipcRenderer.send('pty-write', { windowId, paneId, data, metadata });
    return Promise.resolve({ success: true as const });
  },
  ptyResize: (windowId: string, paneId: string | undefined, cols: number, rows: number) =>
    ipcRenderer.invoke('pty-resize', { windowId, paneId, cols, rows }),
  getPtyHistory: (paneId: string) =>
    ipcRenderer.invoke('get-pty-history', { paneId }),
  onPtyData: (callback) => {
    ipcRenderer.on('pty-data', callback);
  },
  offPtyData: (callback) => {
    ipcRenderer.removeListener('pty-data', callback);
  },

  // Pane management
  splitPane: (config: unknown) =>
    ipcRenderer.invoke('split-pane', config),
  closePane: (windowId: string, paneId: string) =>
    ipcRenderer.invoke('close-pane', { windowId, paneId }),

  // View switching
  switchToTerminalView: (windowId: string) =>
    ipcRenderer.invoke('switch-to-terminal-view', { windowId }),
  switchToCanvasView: (canvasWorkspaceId: string) =>
    ipcRenderer.invoke('switch-to-canvas-view', { canvasWorkspaceId }),
  switchToUnifiedView: () =>
    ipcRenderer.invoke('switch-to-unified-view'),
  setActivePane: (windowId: string, paneId: string | null) =>
    ipcRenderer.invoke('set-active-pane', { windowId, paneId }),
  onViewChanged: (callback) => {
    ipcRenderer.on('view-changed', callback);
  },
  offViewChanged: (callback) => {
    ipcRenderer.removeListener('view-changed', callback);
  },

  // Workspace management
  saveWorkspace: (payload: unknown) =>
    ipcRenderer.invoke('save-workspace', payload),
  loadWorkspace: () =>
    ipcRenderer.invoke('load-workspace'),
  onWorkspaceLoaded: (callback) => {
    ipcRenderer.on('workspace-loaded', callback);
  },
  offWorkspaceLoaded: (callback) => {
    ipcRenderer.removeListener('workspace-loaded', callback);
  },

  // Auto-save
  triggerAutoSave: (
    windows?: unknown[],
    groups?: unknown[],
    canvasWorkspaces?: unknown[],
    canvasWorkspaceTemplates?: unknown[],
    canvasActivity?: unknown[],
  ) =>
    ipcRenderer.send(
      'trigger-auto-save',
      windows,
      groups,
      canvasWorkspaces,
      canvasWorkspaceTemplates,
      canvasActivity,
    ),

  // Clipboard
  writeClipboardText: (text: string) =>
    ipcRenderer.invoke('clipboard-write-text', text),
  readClipboardText: () =>
    ipcRenderer.invoke('clipboard-read-text'),
  tryPasteSshClipboardImage: (windowId: string, paneId: string, runtimeCwd?: string) =>
    ipcRenderer.invoke('try-paste-ssh-clipboard-image', { windowId, paneId, runtimeCwd }),

  // 通知主进程渲染完成
  notifyRendererReady: () => ipcRenderer.send('renderer-ready'),

  // Workspace restore
  onWindowRestored: (callback) => {
    ipcRenderer.on('window-restored', callback);
  },
  offWindowRestored: (callback) => {
    ipcRenderer.removeListener('window-restored', callback);
  },
  onWorkspaceRestoreError: (callback) => {
    ipcRenderer.on('workspace-restore-error', callback);
  },
  offWorkspaceRestoreError: (callback) => {
    ipcRenderer.removeListener('workspace-restore-error', callback);
  },
  recoverFromBackup: () =>
    ipcRenderer.invoke('recover-from-backup'),

  // Cleanup progress
  onCleanupStarted: (callback) => {
    ipcRenderer.on('cleanup-started', callback);
  },
  offCleanupStarted: (callback) => {
    ipcRenderer.removeListener('cleanup-started', callback);
  },
  onCleanupProgress: (callback) => {
    ipcRenderer.on('cleanup-progress', callback);
  },
  offCleanupProgress: (callback) => {
    ipcRenderer.removeListener('cleanup-progress', callback);
  },
  listAggregatedSessions: (query) =>
    ipcRenderer.invoke('list-aggregated-sessions', query),
  getAggregatedSessionDetail: (entryId) =>
    ipcRenderer.invoke('get-aggregated-session-detail', { entryId }),
  restoreAggregatedSession: (request) =>
    ipcRenderer.invoke('restore-aggregated-session', request),
  saveTaskArtifact: (request) =>
    ipcRenderer.invoke('save-task-artifact', request),
  listTaskArtifacts: (query) =>
    ipcRenderer.invoke('list-task-artifacts', query),
  deleteTaskArtifact: (artifactId) =>
    ipcRenderer.invoke('delete-task-artifact', { artifactId }),
  listBrowserSyncProfiles: () =>
    ipcRenderer.invoke('list-browser-sync-profiles'),
  getBrowserSyncState: () =>
    ipcRenderer.invoke('get-browser-sync-state'),
  syncBrowserProfile: (profileId) =>
    ipcRenderer.invoke('sync-browser-profile', { profileId }),
  getMcpServerSnapshots: () =>
    ipcRenderer.invoke('get-mcp-server-snapshots'),

  // Group management
  createGroup: (name: string, windowIds: string[]) =>
    ipcRenderer.invoke('create-group', name, windowIds),
  deleteGroup: (groupId: string) =>
    ipcRenderer.invoke('delete-group', groupId),
  archiveGroup: (groupId: string) =>
    ipcRenderer.invoke('archive-group', groupId),
  unarchiveGroup: (groupId: string) =>
    ipcRenderer.invoke('unarchive-group', groupId),
  renameGroup: (groupId: string, name: string) =>
    ipcRenderer.invoke('rename-group', groupId, name),
  addWindowToGroup: (groupId: string, windowId: string, direction: 'horizontal' | 'vertical', targetWindowId: string | null) =>
    ipcRenderer.invoke('add-window-to-group', groupId, windowId, direction, targetWindowId),
  removeWindowFromGroup: (groupId: string, windowId: string) =>
    ipcRenderer.invoke('remove-window-from-group', groupId, windowId),
  updateGroupSplitSizes: (groupId: string, splitPath: number[], sizes: number[]) =>
    ipcRenderer.invoke('update-group-split-sizes', groupId, splitPath, sizes),

  // Window controls
  windowMinimize: () =>
    ipcRenderer.invoke('window-minimize'),
  windowMaximize: () =>
    ipcRenderer.invoke('window-maximize'),
  windowToggleFullScreen: () =>
    ipcRenderer.invoke('window-toggle-fullscreen'),
  windowClose: () =>
    ipcRenderer.invoke('window-close'),
  windowIsMaximized: () =>
    ipcRenderer.invoke('window-is-maximized'),
  windowIsFullScreen: () =>
    ipcRenderer.invoke('window-is-fullscreen'),
  onWindowMaximized: (callback: (isMaximized: boolean) => void) => {
    const listener = (_event: unknown, isMaximized: boolean) => callback(isMaximized);
    ipcRenderer.on('window-maximized', listener);
    return () => ipcRenderer.removeListener('window-maximized', listener);
  },
  onWindowFullScreen: (callback: (isFullScreen: boolean) => void) => {
    const listener = (_event: unknown, isFullScreen: boolean) => callback(isFullScreen);
    ipcRenderer.on('window-fullscreen', listener);
    return () => ipcRenderer.removeListener('window-fullscreen', listener);
  },
  onStartupReveal: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('window-startup-reveal', listener);
    return () => ipcRenderer.removeListener('window-startup-reveal', listener);
  },

  // Agent runtime
  agentSend: (request) =>
    ipcRenderer.invoke('agent-send', request),
  agentCancel: (request) =>
    ipcRenderer.invoke('agent-cancel', request),
  agentResetTask: (request) =>
    ipcRenderer.invoke('agent-reset-task', request),
  agentRespondApproval: (request) =>
    ipcRenderer.invoke('agent-respond-approval', request),
  agentSubmitInteraction: (request) =>
    ipcRenderer.invoke('agent-submit-interaction', request),
  agentGetTask: (request) =>
    ipcRenderer.invoke('agent-get-task', request),
  agentRestoreTask: (request) =>
    ipcRenderer.invoke('agent-restore-task', request),
  onAgentTimelineEvent: (callback) => {
    ipcRenderer.on('agent-timeline-event', callback);
  },
  offAgentTimelineEvent: (callback) => {
    ipcRenderer.removeListener('agent-timeline-event', callback);
  },
  onAgentTaskState: (callback) => {
    ipcRenderer.on('agent-task-state', callback);
  },
  offAgentTaskState: (callback) => {
    ipcRenderer.removeListener('agent-task-state', callback);
  },
  onAgentTaskError: (callback) => {
    ipcRenderer.on('agent-task-error', callback);
  },
  offAgentTaskError: (callback) => {
    ipcRenderer.removeListener('agent-task-error', callback);
  },

  // Chat AI
  chatSend: (request: unknown) =>
    ipcRenderer.invoke('chat-send', request),
  chatCancel: (config: { paneId: string }) =>
    ipcRenderer.invoke('chat-cancel', config),
  chatCompleteText: (request: unknown) =>
    ipcRenderer.invoke('chat-complete-text', request),
  chatExecuteTool: (request: unknown) =>
    ipcRenderer.invoke('chat-execute-tool', request),
  chatRespondToolApproval: (response: unknown) =>
    ipcRenderer.send('chat-respond-tool-approval', response),
  onChatStreamChunk: (callback) => {
    ipcRenderer.on('chat-stream-chunk', callback);
  },
  offChatStreamChunk: (callback) => {
    ipcRenderer.removeListener('chat-stream-chunk', callback);
  },
  onChatStreamDone: (callback) => {
    ipcRenderer.on('chat-stream-done', callback);
  },
  offChatStreamDone: (callback) => {
    ipcRenderer.removeListener('chat-stream-done', callback);
  },
  onChatStreamError: (callback) => {
    ipcRenderer.on('chat-stream-error', callback);
  },
  offChatStreamError: (callback) => {
    ipcRenderer.removeListener('chat-stream-error', callback);
  },
  onChatToolApprovalRequest: (callback) => {
    ipcRenderer.on('chat-tool-approval-request', callback);
  },
  offChatToolApprovalRequest: (callback) => {
    ipcRenderer.removeListener('chat-tool-approval-request', callback);
  },
  onChatToolResult: (callback) => {
    ipcRenderer.on('chat-tool-result', callback);
  },
  offChatToolResult: (callback) => {
    ipcRenderer.removeListener('chat-tool-result', callback);
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
