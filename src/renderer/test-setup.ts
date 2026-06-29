import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

function createStorageMock(): Storage {
  const storage = new Map<string, string>();

  return {
    get length() {
      return storage.size;
    },
    clear() {
      storage.clear();
    },
    getItem(key: string) {
      return storage.has(key) ? storage.get(key)! : null;
    },
    key(index: number) {
      return Array.from(storage.keys())[index] ?? null;
    },
    removeItem(key: string) {
      storage.delete(key);
    },
    setItem(key: string, value: string) {
      storage.set(String(key), String(value));
    },
  };
}

function ensureStorageMock(name: 'localStorage' | 'sessionStorage') {
  const existingStorage = window[name];
  const hasStorageApi =
    existingStorage != null &&
    typeof existingStorage.clear === 'function' &&
    typeof existingStorage.getItem === 'function' &&
    typeof existingStorage.removeItem === 'function' &&
    typeof existingStorage.setItem === 'function';

  if (!hasStorageApi) {
    Object.defineProperty(window, name, {
      value: createStorageMock(),
      configurable: true,
      writable: true,
    });
  }
}

ensureStorageMock('localStorage');
ensureStorageMock('sessionStorage');

// Radix UI ScrollArea uses ResizeObserver which is not available in jsdom
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}

if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {};
}

if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {};
}

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

const canvasContextMock = {
  setTransform: vi.fn(),
  scale: vi.fn(),
  clearRect: vi.fn(),
  beginPath: vi.fn(),
  roundRect: vi.fn(),
  fill: vi.fn(),
  stroke: vi.fn(),
  strokeRect: vi.fn(),
  fillRect: vi.fn(),
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 1,
};

if (!HTMLCanvasElement.prototype.getContext) {
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    value: vi.fn(() => canvasContextMock),
    configurable: true,
    writable: true,
  });
} else {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => canvasContextMock as never);
}

// Mock window.electronAPI for all renderer tests
Object.defineProperty(window, 'electronAPI', {
  value: {
    platform: 'win32',
    ping: vi.fn().mockResolvedValue('pong'),
    getAppVersion: vi.fn().mockResolvedValue({ success: true, data: { name: 'Synapse', version: '3.1.1' } }),
    createWindow: vi.fn().mockResolvedValue({}),
    createSSHWindow: vi.fn().mockResolvedValue({ success: true, data: {} }),
    killTerminal: vi.fn().mockResolvedValue(undefined),
    getTerminalStatus: vi.fn().mockResolvedValue('alive'),
    listTerminals: vi.fn().mockResolvedValue([]),
    closeWindow: vi.fn().mockResolvedValue(undefined),
    deleteWindow: vi.fn().mockResolvedValue(undefined),
    startWindow: vi.fn().mockResolvedValue({ success: true }),
    startSSHPane: vi.fn().mockResolvedValue({ success: true, data: { pid: 1001, sessionId: 'ssh-session-1', status: 'waiting' } }),
    cloneSSHPane: vi.fn().mockResolvedValue({ success: true, data: { pid: 1002, sessionId: 'ssh-session-2' } }),
    listSSHSessionPortForwards: vi.fn().mockResolvedValue({ success: true, data: [] }),
    addSSHSessionPortForward: vi.fn().mockResolvedValue({ success: true, data: null }),
    removeSSHSessionPortForward: vi.fn().mockResolvedValue({ success: true }),
    listSSHSftpDirectory: vi.fn().mockResolvedValue({ success: true, data: { path: '/', entries: [] } }),
    getSSHSessionMetrics: vi.fn().mockResolvedValue({
      success: true,
      data: {
        hostname: 'ssh-host',
        platform: 'Linux',
        loadAverage: [0.12, 0.18, 0.25],
        memory: null,
        disk: null,
        sampledAt: '2026-03-23T00:00:00.000Z',
      },
    }),
    downloadSSHSftpFile: vi.fn().mockResolvedValue({ success: true, data: null }),
    uploadSSHSftpFiles: vi.fn().mockResolvedValue({ success: true, data: { uploadedCount: 0 } }),
    uploadSSHSftpDirectory: vi.fn().mockResolvedValue({ success: true, data: { uploadedCount: 0 } }),
    downloadSSHSftpDirectory: vi.fn().mockResolvedValue({ success: true, data: null }),
    createSSHSftpDirectory: vi.fn().mockResolvedValue({ success: true, data: '/new-folder' }),
    deleteSSHSftpEntry: vi.fn().mockResolvedValue({ success: true }),
    validatePath: vi.fn().mockResolvedValue({ success: true, data: true }),
    createDirectory: vi.fn().mockResolvedValue({ success: true }),
    selectDirectory: vi.fn().mockResolvedValue({ success: true, data: null }),
    selectExecutableFile: vi.fn().mockResolvedValue({ success: true, data: null }),
    selectImageFile: vi.fn().mockResolvedValue({ success: true, data: null }),
    selectPluginPackage: vi.fn().mockResolvedValue({ success: true, data: null }),
    openFolder: vi.fn().mockResolvedValue(undefined),
    onWindowStatusChanged: vi.fn(),
    offWindowStatusChanged: vi.fn(),
    onPaneStatusChanged: vi.fn(),
    offPaneStatusChanged: vi.fn(),
    onWindowGitBranchChanged: vi.fn(),
    offWindowGitBranchChanged: vi.fn(),
    codePaneListDirectory: vi.fn().mockResolvedValue({ success: true, data: [] }),
    codePaneReadFile: vi.fn().mockResolvedValue({ success: true, data: { content: '', mtimeMs: Date.now(), size: 0, language: 'plaintext', isBinary: false } }),
    codePaneWriteFile: vi.fn().mockResolvedValue({ success: true, data: { mtimeMs: Date.now() } }),
    codePaneDeleteFile: vi.fn().mockResolvedValue({ success: true }),
    codePaneCreateFile: vi.fn().mockResolvedValue({ success: true, data: { path: '/tmp/new-file', name: 'new-file', type: 'file', size: 0, mtimeMs: Date.now() } }),
    codePaneCreateDirectory: vi.fn().mockResolvedValue({ success: true, data: { path: '/tmp/new-folder', name: 'new-folder', type: 'directory', mtimeMs: Date.now(), hasChildren: true } }),
    codePaneRenamePath: vi.fn().mockResolvedValue({ success: true, data: { path: '/tmp/renamed', name: 'renamed', type: 'file', size: 0, mtimeMs: Date.now() } }),
    codePaneGetExternalLibrarySections: vi.fn().mockResolvedValue({ success: true, data: [] }),
    codePaneGetGitStatus: vi.fn().mockResolvedValue({ success: true, data: [] }),
    codePaneGetGitRepositorySummary: vi.fn().mockResolvedValue({ success: true, data: null }),
    codePaneGetGitGraph: vi.fn().mockResolvedValue({ success: true, data: [] }),
    codePaneGetGitCommitDetails: vi.fn().mockResolvedValue({
      success: true,
      data: {
        commitSha: 'abcdef1234567890',
        shortSha: 'abcdef1',
        subject: 'Commit summary',
        author: 'Test User',
        email: 'test@example.com',
        timestamp: 1710000000,
        refs: [],
        files: [],
      },
    }),
    codePaneCompareGitCommits: vi.fn().mockResolvedValue({
      success: true,
      data: {
        baseCommitSha: 'abcdef1234567890',
        targetCommitSha: '1234567890abcdef',
        files: [],
      },
    }),
    codePaneGetGitDiffHunks: vi.fn().mockResolvedValue({ success: true, data: { filePath: '', stagedHunks: [], unstagedHunks: [] } }),
    codePaneGitStage: vi.fn().mockResolvedValue({ success: true }),
    codePaneGitUnstage: vi.fn().mockResolvedValue({ success: true }),
    codePaneGitRemove: vi.fn().mockResolvedValue({ success: true }),
    codePaneGitDiscard: vi.fn().mockResolvedValue({ success: true }),
    codePaneGitStageHunk: vi.fn().mockResolvedValue({ success: true }),
    codePaneGitUnstageHunk: vi.fn().mockResolvedValue({ success: true }),
    codePaneGitDiscardHunk: vi.fn().mockResolvedValue({ success: true }),
    codePaneGitCommit: vi.fn().mockResolvedValue({ success: true, data: { commitSha: 'abcdef1234567890', shortSha: 'abcdef1', summary: 'Commit summary' } }),
    codePaneGitStash: vi.fn().mockResolvedValue({ success: true, data: { reference: 'stash@{0}', message: 'WIP' } }),
    codePaneGitPush: vi.fn().mockResolvedValue({ success: true, data: { remote: 'origin', branchName: 'main' } }),
    codePaneGitUpdateProject: vi.fn().mockResolvedValue({ success: true, data: { mode: 'fetch' } }),
    codePaneGitCheckout: vi.fn().mockResolvedValue({ success: true }),
    codePaneGetGitBranches: vi.fn().mockResolvedValue({ success: true, data: [] }),
    codePaneGitRenameBranch: vi.fn().mockResolvedValue({ success: true }),
    codePaneGitDeleteBranch: vi.fn().mockResolvedValue({ success: true }),
    codePaneGetGitRebasePlan: vi.fn().mockResolvedValue({
      success: true,
      data: { baseRef: 'origin/main', currentBranch: 'main', hasMergeCommits: false, commits: [] },
    }),
    codePaneGitApplyRebasePlan: vi.fn().mockResolvedValue({ success: true }),
    codePaneGitCherryPick: vi.fn().mockResolvedValue({ success: true }),
    codePaneGitRebaseControl: vi.fn().mockResolvedValue({ success: true }),
    codePaneGitResolveConflict: vi.fn().mockResolvedValue({ success: true }),
    codePaneGetGitConflictDetails: vi.fn().mockResolvedValue({ success: true, data: null }),
    codePaneGitApplyConflictResolution: vi.fn().mockResolvedValue({ success: true }),
    codePaneGitHistory: vi.fn().mockResolvedValue({ success: true, data: { scope: 'file', targetFilePath: '', entries: [] } }),
    codePaneGitBlame: vi.fn().mockResolvedValue({ success: true, data: [] }),
    codePaneReadGitBaseFile: vi.fn().mockResolvedValue({ success: true, data: { content: '', existsInHead: false } }),
    codePaneReadGitRevisionFile: vi.fn().mockResolvedValue({ success: true, data: { content: '', exists: true } }),
    codePaneWatchRoot: vi.fn().mockResolvedValue({ success: true }),
    codePaneUnwatchRoot: vi.fn().mockResolvedValue({ success: true }),
    codePaneSearchFiles: vi.fn().mockResolvedValue({ success: true, data: [] }),
    codePaneSearchContents: vi.fn().mockResolvedValue({ success: true, data: [] }),
    codePaneDidOpenDocument: vi.fn().mockResolvedValue({ success: true }),
    codePaneDidChangeDocument: vi.fn().mockResolvedValue({ success: true }),
    codePaneDidSaveDocument: vi.fn().mockResolvedValue({ success: true }),
    codePaneDidCloseDocument: vi.fn().mockResolvedValue({ success: true }),
    codePanePrewarmLanguageWorkspace: vi.fn().mockResolvedValue({ success: true }),
    codePaneAttachLanguageWorkspace: vi.fn().mockResolvedValue({ success: true, data: null }),
    codePaneGetLanguageWorkspaceState: vi.fn().mockResolvedValue({ success: true, data: null }),
    codePaneDetachLanguageWorkspace: vi.fn().mockResolvedValue({ success: true }),
    codePaneGetDefinition: vi.fn().mockResolvedValue({ success: true, data: [] }),
    codePaneGetHover: vi.fn().mockResolvedValue({ success: true, data: null }),
    codePaneGetReferences: vi.fn().mockResolvedValue({ success: true, data: [] }),
    codePaneGetDocumentHighlights: vi.fn().mockResolvedValue({ success: true, data: [] }),
    codePaneGetDocumentSymbols: vi.fn().mockResolvedValue({ success: true, data: [] }),
    codePaneGetInlayHints: vi.fn().mockResolvedValue({ success: true, data: [] }),
    codePaneGetCallHierarchy: vi.fn().mockResolvedValue({ success: true, data: { root: null, items: [] } }),
    codePaneResolveCallHierarchy: vi.fn().mockResolvedValue({ success: true, data: [] }),
    codePaneGetTypeHierarchy: vi.fn().mockResolvedValue({ success: true, data: { root: null, items: [] } }),
    codePaneResolveTypeHierarchy: vi.fn().mockResolvedValue({ success: true, data: [] }),
    codePaneGetSemanticTokens: vi.fn().mockResolvedValue({ success: true, data: null }),
    codePaneGetSemanticTokenLegend: vi.fn().mockResolvedValue({ success: true, data: null }),
    codePaneGetImplementations: vi.fn().mockResolvedValue({ success: true, data: [] }),
    codePaneGetCompletionItems: vi.fn().mockResolvedValue({ success: true, data: [] }),
    codePaneGetSignatureHelp: vi.fn().mockResolvedValue({ success: true, data: null }),
    codePaneRenameSymbol: vi.fn().mockResolvedValue({ success: true, data: [] }),
    codePaneFormatDocument: vi.fn().mockResolvedValue({ success: true, data: [] }),
    codePaneLintDocument: vi.fn().mockResolvedValue({ success: true, data: [] }),
    codePaneGetWorkspaceSymbols: vi.fn().mockResolvedValue({ success: true, data: [] }),
    codePaneGetCodeActions: vi.fn().mockResolvedValue({ success: true, data: [] }),
    codePaneRunCodeAction: vi.fn().mockResolvedValue({ success: true, data: [] }),
    codePanePrepareRefactor: vi.fn().mockResolvedValue({ success: true, data: null }),
    codePaneApplyRefactor: vi.fn().mockResolvedValue({ success: true, data: null }),
    codePaneListRunTargets: vi.fn().mockResolvedValue({ success: true, data: [] }),
    codePaneRunTarget: vi.fn().mockResolvedValue({ success: true, data: null }),
    codePaneStopRunTarget: vi.fn().mockResolvedValue({ success: true }),
    codePaneDebugStart: vi.fn().mockResolvedValue({ success: true, data: null }),
    codePaneDebugStop: vi.fn().mockResolvedValue({ success: true }),
    codePaneDebugPause: vi.fn().mockResolvedValue({ success: true }),
    codePaneDebugContinue: vi.fn().mockResolvedValue({ success: true }),
    codePaneDebugStepOver: vi.fn().mockResolvedValue({ success: true }),
    codePaneDebugStepInto: vi.fn().mockResolvedValue({ success: true }),
    codePaneDebugStepOut: vi.fn().mockResolvedValue({ success: true }),
    codePaneListDebugSessions: vi.fn().mockResolvedValue({ success: true, data: [] }),
    codePaneGetDebugSessionDetails: vi.fn().mockResolvedValue({ success: true, data: { sessionId: 'debug-session-1', stackFrames: [], scopes: [] } }),
    codePaneDebugEvaluate: vi.fn().mockResolvedValue({ success: true, data: { value: '' } }),
    codePaneSetBreakpoint: vi.fn().mockResolvedValue({ success: true }),
    codePaneRemoveBreakpoint: vi.fn().mockResolvedValue({ success: true }),
    codePaneGetExceptionBreakpoints: vi.fn().mockResolvedValue({
      success: true,
      data: [{ id: 'all', label: 'All Exceptions', enabled: false }],
    }),
    codePaneSetExceptionBreakpoints: vi.fn().mockResolvedValue({ success: true }),
    codePaneListTests: vi.fn().mockResolvedValue({ success: true, data: [] }),
    codePaneRunTests: vi.fn().mockResolvedValue({ success: true, data: null }),
    codePaneRerunFailedTests: vi.fn().mockResolvedValue({ success: true, data: [] }),
    codePaneGetProjectContribution: vi.fn().mockResolvedValue({ success: true, data: [] }),
    codePaneRefreshProjectModel: vi.fn().mockResolvedValue({ success: true, data: [] }),
    codePaneRunProjectCommand: vi.fn().mockResolvedValue({ success: true, data: null }),
    onCodePaneFsChanged: vi.fn(),
    offCodePaneFsChanged: vi.fn(),
    onCodePaneIndexProgress: vi.fn(),
    offCodePaneIndexProgress: vi.fn(),
    onCodePaneRunSessionChanged: vi.fn(),
    offCodePaneRunSessionChanged: vi.fn(),
    onCodePaneRunSessionOutput: vi.fn(),
    offCodePaneRunSessionOutput: vi.fn(),
    onCodePaneDebugSessionChanged: vi.fn(),
    offCodePaneDebugSessionChanged: vi.fn(),
    onCodePaneDebugSessionOutput: vi.fn(),
    offCodePaneDebugSessionOutput: vi.fn(),
    onCodePaneDiagnosticsChanged: vi.fn(),
    offCodePaneDiagnosticsChanged: vi.fn(),
    onCodePaneLanguageWorkspaceChanged: vi.fn(),
    offCodePaneLanguageWorkspaceChanged: vi.fn(),
    onPluginRuntimeStateChanged: vi.fn(),
    offPluginRuntimeStateChanged: vi.fn(),
    onTmuxPaneTitleChanged: vi.fn(),
    offTmuxPaneTitleChanged: vi.fn(),
    onTmuxPaneStyleChanged: vi.fn(),
    offTmuxPaneStyleChanged: vi.fn(),
    onTmuxWindowSynced: vi.fn(),
    offTmuxWindowSynced: vi.fn(),
    onTmuxWindowRemoved: vi.fn(),
    offTmuxWindowRemoved: vi.fn(),
    ptyWrite: vi.fn().mockResolvedValue(undefined),
    ptyResize: vi.fn().mockResolvedValue(undefined),
    getPtyHistory: vi.fn().mockResolvedValue({ success: true, data: { chunks: [], lastSeq: 0 } }),
    onPtyData: vi.fn(),
    offPtyData: vi.fn(),
    splitPane: vi.fn().mockResolvedValue({ success: true }),
    closePane: vi.fn().mockResolvedValue({ success: true }),
    switchToTerminalView: vi.fn().mockResolvedValue(undefined),
    switchToCanvasView: vi.fn().mockResolvedValue(undefined),
    switchToUnifiedView: vi.fn().mockResolvedValue(undefined),
    setActivePane: vi.fn().mockResolvedValue(undefined),
    onViewChanged: vi.fn(),
    offViewChanged: vi.fn(),
    getSettings: vi.fn().mockResolvedValue({ success: true, data: { language: 'zh-CN', ides: [], quickNav: { items: [] }, terminal: { useBundledConptyDll: false, defaultShellProgram: '' }, features: { sshEnabled: true }, sshClipboardImage: { enabled: true, uploadLocation: 'current-working-directory', shortcut: 'alt-v', customUploadDirectory: '', copyRemotePathAfterUpload: true, maxUploadBytes: 20 * 1024 * 1024 }, chat: { providers: [], enableCommandSecurity: true }, keyboardShortcuts: { quickSwitcher: { key: 'Tab', modifiers: ['ctrl'] }, quickNav: { key: 'Control', doubleTap: true } } } }),
    updateSettings: vi.fn().mockResolvedValue({ success: true, data: {} }),
    validateChatProvider: vi.fn().mockResolvedValue({
      success: true,
      data: {
        resolvedType: 'anthropic',
        model: 'claude-sonnet-4-5',
        detectedModels: ['claude-sonnet-4-5'],
        modelListSupported: true,
      },
    }),
    getAvailableShells: vi.fn().mockResolvedValue({ success: true, data: [
      { command: 'pwsh.exe', path: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe', isDefault: true },
      { command: 'powershell.exe', path: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', isDefault: false },
      { command: 'cmd.exe', path: 'C:\\Windows\\System32\\cmd.exe', isDefault: false },
    ] }),
    getSupportedIDENames: vi.fn().mockResolvedValue({ success: true, data: [] }),
    scanIDEs: vi.fn().mockResolvedValue({ success: true, data: [] }),
    getIDEIcon: vi.fn().mockResolvedValue({ success: true, data: '' }),
    deleteIDEConfig: vi.fn().mockResolvedValue({ success: true, data: [] }),
    updateIDEConfig: vi.fn().mockResolvedValue({ success: true, data: [] }),
    scanSpecificIDE: vi.fn().mockResolvedValue({ success: true, data: '' }),
    listPlugins: vi.fn().mockResolvedValue({ success: true, data: [] }),
    getPluginRegistry: vi.fn().mockResolvedValue({
      success: true,
      data: {
        schemaVersion: 1,
        plugins: {},
        globalPluginSettings: {},
      },
    }),
    listPluginCatalog: vi.fn().mockResolvedValue({ success: true, data: [] }),
    installMarketplacePlugin: vi.fn().mockResolvedValue({ success: false, error: 'not implemented' }),
    installLocalPlugin: vi.fn().mockResolvedValue({ success: false, error: 'not implemented' }),
    updatePlugin: vi.fn().mockResolvedValue({ success: false, error: 'not implemented' }),
    uninstallPlugin: vi.fn().mockResolvedValue({ success: true }),
    setPluginEnabled: vi.fn().mockResolvedValue({ success: true, data: {} }),
    setPluginSettings: vi.fn().mockResolvedValue({ success: true, data: {} }),
    listSSHProfiles: vi.fn().mockResolvedValue({ success: true, data: [] }),
    getSSHAlgorithmCatalog: vi.fn().mockResolvedValue({
      success: true,
      data: {
        defaults: {
          kex: ['curve25519-sha256'],
          hostKey: ['ssh-ed25519'],
          cipher: ['aes128-gcm@openssh.com'],
          hmac: ['hmac-sha2-256'],
          compression: ['none'],
        },
        supported: {
          kex: ['curve25519-sha256', 'diffie-hellman-group14-sha256'],
          hostKey: ['ssh-ed25519', 'rsa-sha2-256'],
          cipher: ['aes128-gcm@openssh.com', 'aes256-gcm@openssh.com'],
          hmac: ['hmac-sha2-256', 'hmac-sha2-512'],
          compression: ['none', 'zlib@openssh.com'],
        },
      },
    }),
    getSSHProfile: vi.fn().mockResolvedValue({ success: false, error: 'not found' }),
    createSSHProfile: vi.fn().mockResolvedValue({ success: true, data: {} }),
    updateSSHProfile: vi.fn().mockResolvedValue({ success: true, data: {} }),
    deleteSSHProfile: vi.fn().mockResolvedValue({ success: true }),
    importOpenSSHProfiles: vi.fn().mockResolvedValue({ success: true, data: { profiles: [], createdCount: 0, updatedCount: 0, skippedCount: 0 } }),
    detectLocalSSHPrivateKeys: vi.fn().mockResolvedValue({ success: true, data: [] }),
    getSSHCredentialState: vi.fn().mockResolvedValue({ success: true, data: { hasPassword: false, hasPassphrase: false } }),
    setSSHPassword: vi.fn().mockResolvedValue({ success: true }),
    clearSSHPassword: vi.fn().mockResolvedValue({ success: true }),
    setSSHPrivateKeyPassphrase: vi.fn().mockResolvedValue({ success: true }),
    clearSSHPrivateKeyPassphrase: vi.fn().mockResolvedValue({ success: true }),
    clearSSHProfileCredentials: vi.fn().mockResolvedValue({ success: true }),
    listKnownHosts: vi.fn().mockResolvedValue({ success: true, data: [] }),
    removeKnownHost: vi.fn().mockResolvedValue({ success: true }),
    onSSHHostKeyPrompt: vi.fn(),
    offSSHHostKeyPrompt: vi.fn(),
    respondSSHHostKeyPrompt: vi.fn(),
    statusLineConfigure: vi.fn().mockResolvedValue({ success: true }),
    statusLineRemove: vi.fn().mockResolvedValue({ success: true }),
    saveWorkspace: vi.fn().mockResolvedValue({ success: true }),
    loadWorkspace: vi.fn().mockResolvedValue({
      success: true,
      data: {
        version: '1.0',
        windows: [],
        groups: [],
        canvasWorkspaces: [],
        settings: {
          notificationsEnabled: true,
          theme: 'dark',
          autoSave: true,
          autoSaveInterval: 5,
          ides: [],
          terminal: {
            useBundledConptyDll: false,
            defaultShellProgram: '',
          },
          features: {
            sshEnabled: true,
          },
          chat: {
            providers: [],
            enableCommandSecurity: true,
          },
        },
        lastSavedAt: '2026-04-11T00:00:00.000Z',
      },
    }),
    onWorkspaceLoaded: vi.fn(),
    offWorkspaceLoaded: vi.fn(),
    triggerAutoSave: vi.fn(),
    agentSend: vi.fn().mockResolvedValue({ success: true, data: { taskId: 'agent-task-1', status: 'running' } }),
    agentCancel: vi.fn().mockResolvedValue({ success: true }),
    agentResetTask: vi.fn().mockResolvedValue({ success: true }),
    agentRespondApproval: vi.fn().mockResolvedValue({ success: true }),
    agentSubmitInteraction: vi.fn().mockResolvedValue({ success: true }),
    agentGetTask: vi.fn().mockResolvedValue({ success: true, data: null }),
    agentRestoreTask: vi.fn().mockResolvedValue({ success: true, data: null }),
    onAgentTimelineEvent: vi.fn(),
    offAgentTimelineEvent: vi.fn(),
    onAgentTaskState: vi.fn(),
    offAgentTaskState: vi.fn(),
    onAgentTaskError: vi.fn(),
    offAgentTaskError: vi.fn(),
    chatSend: vi.fn().mockResolvedValue({ success: true, data: { messageId: 'chat-message-1' } }),
    chatCancel: vi.fn().mockResolvedValue({ success: true }),
    chatCompleteText: vi.fn().mockResolvedValue({ success: true, data: { content: 'ok', providerId: 'provider-1', model: 'model-1' } }),
    chatExecuteTool: vi.fn().mockResolvedValue({ success: true, data: { toolCallId: 'tool-1', content: '' } }),
    chatRespondToolApproval: vi.fn().mockResolvedValue({ success: true }),
    onChatStreamChunk: vi.fn(),
    offChatStreamChunk: vi.fn(),
    onChatStreamDone: vi.fn(),
    offChatStreamDone: vi.fn(),
    onChatStreamError: vi.fn(),
    offChatStreamError: vi.fn(),
    onChatToolApprovalRequest: vi.fn(),
    offChatToolApprovalRequest: vi.fn(),
    onChatToolResult: vi.fn(),
    offChatToolResult: vi.fn(),
    windowMinimize: vi.fn().mockResolvedValue({ success: true }),
    windowMaximize: vi.fn().mockResolvedValue({ success: true }),
    windowToggleFullScreen: vi.fn().mockResolvedValue({ success: true }),
    windowClose: vi.fn().mockResolvedValue({ success: true }),
    windowIsMaximized: vi.fn().mockResolvedValue({ success: true, data: false }),
    windowIsFullScreen: vi.fn().mockResolvedValue({ success: true, data: false }),
    onWindowMaximized: vi.fn().mockReturnValue(() => {}),
    onWindowFullScreen: vi.fn().mockReturnValue(() => {}),
    writeClipboardText: vi.fn().mockResolvedValue(undefined),
    readClipboardText: vi.fn().mockResolvedValue({ success: true, data: '' }),
    tryPasteSshClipboardImage: vi.fn().mockResolvedValue({ success: true, data: { handled: false } }),
    notifyRendererReady: vi.fn(),
    onWindowRestored: vi.fn(),
    offWindowRestored: vi.fn(),
    onWorkspaceRestoreError: vi.fn(),
    offWorkspaceRestoreError: vi.fn(),
    recoverFromBackup: vi.fn().mockResolvedValue({
      success: true,
      data: {
        version: '1.0',
        windows: [],
        groups: [],
        canvasWorkspaces: [],
        settings: {
          notificationsEnabled: true,
          theme: 'dark',
          autoSave: true,
          autoSaveInterval: 5,
          ides: [],
          terminal: {
            useBundledConptyDll: false,
            defaultShellProgram: '',
          },
          features: {
            sshEnabled: true,
          },
          chat: {
            providers: [],
            enableCommandSecurity: true,
          },
        },
        lastSavedAt: '2026-04-11T00:00:00.000Z',
      },
    }),
    onCleanupStarted: vi.fn(),
    offCleanupStarted: vi.fn(),
    onCleanupProgress: vi.fn(),
    offCleanupProgress: vi.fn(),
    listAggregatedSessions: vi.fn().mockResolvedValue({ success: true, data: [] }),
    getAggregatedSessionDetail: vi.fn().mockResolvedValue({ success: false, error: 'not found' }),
    restoreAggregatedSession: vi.fn().mockResolvedValue({ success: false, error: 'not found' }),
    saveTaskArtifact: vi.fn().mockResolvedValue({
      success: true,
      data: {
        id: 'artifact-1',
        kind: 'conversation',
        title: 'Artifact',
        createdAt: '2026-05-04T00:00:00.000Z',
        updatedAt: '2026-05-04T00:00:00.000Z',
        filePath: '/tmp/artifact.md',
        contentType: 'text/markdown',
        sizeBytes: 128,
      },
    }),
    listTaskArtifacts: vi.fn().mockResolvedValue({ success: true, data: [] }),
    deleteTaskArtifact: vi.fn().mockResolvedValue({ success: true }),
    listBrowserSyncProfiles: vi.fn().mockResolvedValue({ success: true, data: [] }),
    getBrowserSyncState: vi.fn().mockResolvedValue({
      success: true,
      data: {
        enabled: false,
        platformSupported: false,
      },
    }),
    syncBrowserProfile: vi.fn().mockResolvedValue({
      success: true,
      data: {
        enabled: false,
        platformSupported: false,
      },
    }),
    getMcpServerSnapshots: vi.fn().mockResolvedValue({ success: true, data: [] }),
    openInIDE: vi.fn().mockResolvedValue({ success: true }),
    startGitWatch: vi.fn().mockResolvedValue({ success: true }),
    stopGitWatch: vi.fn().mockResolvedValue({ success: true }),
    openExternalUrl: vi.fn().mockResolvedValue({ success: true }),
    onProjectConfigUpdated: vi.fn(),
    offProjectConfigUpdated: vi.fn(),
    onClaudeModelUpdated: vi.fn(),
    offClaudeModelUpdated: vi.fn(),
  },
  writable: true,
});
