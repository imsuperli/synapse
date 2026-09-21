import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, screen, protocol, net, powerMonitor } from 'electron';
import fs from 'fs-extra';
import { hostname } from 'os';
import path from 'path';
import { ProcessManager } from './services/ProcessManager';
import { StatusPoller } from './services/StatusPoller';
import { ViewSwitcherImpl } from './services/ViewSwitcher';
import { WorkspaceManagerImpl } from './services/WorkspaceManager';
import { AutoSaveManagerImpl } from './services/AutoSaveManager';
import { PtySubscriptionManager } from './services/PtySubscriptionManager';
import { ShutdownManager, ShutdownContext } from './services/ShutdownManager';
import { FileWatcherService } from './services/FileWatcherService';
import { GitBranchWatcher } from './services/GitBranchWatcher';
import { initProjectConfigWatcher, projectConfigWatcher } from './services/ProjectConfigWatcher';
import { Workspace } from './types/workspace';
import { registerAllHandlers } from './handlers';
import { HandlerContext } from './handlers/HandlerContext';
import { TmuxCompatService } from './services/TmuxCompatService';
import { SSHProfileStore } from './services/ssh/SSHProfileStore';
import { SSHVaultService } from './services/ssh/SSHVaultService';
import { SSHKnownHostsStore } from './services/ssh/SSHKnownHostsStore';
import { ElectronSSHHostKeyPromptService } from './services/ssh/SSHHostKeyPromptService';
import { ChatProviderVaultService } from './services/chat/ChatProviderVaultService';
import { CodeFileService } from './services/code/CodeFileService';
import { CodeGitBlameService } from './services/code/CodeGitBlameService';
import { CodeGitHistoryService } from './services/code/CodeGitHistoryService';
import { CodeGitOperationService } from './services/code/CodeGitOperationService';
import { CodeGitService } from './services/code/CodeGitService';
import { CodeProjectIndexService } from './services/code/CodeProjectIndexService';
import { CodePaneWatcherService } from './services/code/CodePaneWatcherService';
import { CodeRefactorService } from './services/code/CodeRefactorService';
import { CodeRunProfileService } from './services/code/CodeRunProfileService';
import { CodeTestService } from './services/code/CodeTestService';
import { DebugAdapterSupervisor } from './services/debug/DebugAdapterSupervisor';
import { LanguageFeatureService } from './services/language/LanguageFeatureService';
import { LanguagePluginResolver } from './services/language/LanguagePluginResolver';
import { LanguageProjectContributionService } from './services/language/LanguageProjectContributionService';
import { LanguageServerSupervisor } from './services/language/LanguageServerSupervisor';
import { LanguageWorkspaceHostService } from './services/language/LanguageWorkspaceHostService';
import { LanguageWorkspaceService } from './services/language/LanguageWorkspaceService';
import { PluginCatalogService } from './services/plugins/PluginCatalogService';
import { PluginInstallerService } from './services/plugins/PluginInstallerService';
import { PluginManager } from './services/plugins/PluginManager';
import { PluginCapabilityRuntimeService } from './services/plugins/PluginCapabilityRuntimeService';
import { PluginRegistryStore } from './services/plugins/PluginRegistryStore';
import { SessionAggregationService } from './services/SessionAggregationService';
import { TaskArtifactService } from './services/TaskArtifactService';
import { BrowserSyncService } from './services/BrowserSyncService';
import { McpCapabilityService } from './services/McpCapabilityService';
import { LayoutNode, Pane } from '../shared/types/window';
import { createPtyDataForwarder } from './utils/ptyDataForwarder';
import { isTerminalPane } from '../shared/utils/terminalCapabilities';
import { isAllowedBrowserUrl } from '../shared/utils/browserUrls';
import { normalizeImagePath, toFileUrl } from '../shared/utils/appImage';
import { disposeAgentTaskForPane, getAgentController } from './handlers/agentHandlers';
import { createSSHWindowSession, startSSHPaneSession } from './handlers/sshSessionHandlers';
import { RemoteGateway } from './remote/RemoteGateway';
import { getMainWindowChromeOptions, resolveMainWindowCloseAction } from './windowChrome';

const APP_DISPLAY_NAME = 'Synapse';
const USER_DATA_DIR_NAME = 'synapse';
const LEGACY_USER_DATA_DIR_NAME = 'copilot-terminal';
const APP_ICON_PATH = process.platform === 'win32'
  ? path.join(__dirname, '../../resources/icon.ico')
  : path.join(__dirname, '../../resources/icon.png');

function migrateLegacyUserDataDirectory(): void {
  const appDataPath = app.getPath('appData');
  const nextUserDataPath = path.join(appDataPath, USER_DATA_DIR_NAME);
  const legacyUserDataPath = path.join(appDataPath, LEGACY_USER_DATA_DIR_NAME);

  if (!fs.existsSync(legacyUserDataPath) || fs.existsSync(nextUserDataPath)) {
    return;
  }

  try {
    fs.moveSync(legacyUserDataPath, nextUserDataPath, { overwrite: false });
    console.log(`[main] Migrated userData directory from ${legacyUserDataPath} to ${nextUserDataPath}`);
  } catch (error) {
    console.error('[main] Failed to migrate legacy userData directory:', error);
  }
}

app.setName(APP_DISPLAY_NAME);
migrateLegacyUserDataDirectory();
app.setPath('userData', path.join(app.getPath('appData'), USER_DATA_DIR_NAME));

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let processManager: ProcessManager | null = null;
let statusPoller: StatusPoller | null = null;
let viewSwitcher: ViewSwitcherImpl | null = null;
let workspaceManager: WorkspaceManagerImpl | null = null;
let autoSaveManager: AutoSaveManagerImpl | null = null;
let ptySubscriptionManager: PtySubscriptionManager | null = null;
let shutdownManager: ShutdownManager | null = null;
let fileWatcherService: FileWatcherService | null = null;
let gitBranchWatcher: GitBranchWatcher | null = null;
let tmuxCompatService: TmuxCompatService | null = null;
let sshProfileStore: SSHProfileStore | null = null;
let sshVaultService: SSHVaultService | null = null;
let sshKnownHostsStore: SSHKnownHostsStore | null = null;
let chatProviderVaultService: ChatProviderVaultService | null = null;
let sshHostKeyPromptService: ElectronSSHHostKeyPromptService | null = null;
let codeFileService: CodeFileService | null = null;
let codeGitService: CodeGitService | null = null;
let codeGitBlameService: CodeGitBlameService | null = null;
let codeGitHistoryService: CodeGitHistoryService | null = null;
let codeGitOperationService: CodeGitOperationService | null = null;
let codeProjectIndexService: CodeProjectIndexService | null = null;
let codePaneWatcherService: CodePaneWatcherService | null = null;
let codeRefactorService: CodeRefactorService | null = null;
let codeRunProfileService: CodeRunProfileService | null = null;
let codeTestService: CodeTestService | null = null;
let debugAdapterSupervisor: DebugAdapterSupervisor | null = null;
let languageFeatureService: LanguageFeatureService | null = null;
let languageProjectContributionService: LanguageProjectContributionService | null = null;
let languageWorkspaceHostService: LanguageWorkspaceHostService | null = null;
let pluginManager: PluginManager | null = null;
let sessionAggregationService: SessionAggregationService | null = null;
let taskArtifactService: TaskArtifactService | null = null;
let browserSyncService: BrowserSyncService | null = null;
let mcpCapabilityService: McpCapabilityService | null = null;
let remoteGateway: RemoteGateway | null = null;
let currentWorkspace: Workspace | null = null; // 缓存当前工作区状态
const forwardPtyData = createPtyDataForwarder(() => mainWindow);

// 退出标志，防止重复执行退出逻辑
let isQuitting = false;

function bringMainWindowToFront(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }

  mainWindow.focus();
}

app.on('second-instance', () => {
  bringMainWindowToFront();
});

function registerBrowserWebviewGuards(): void {
  app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() !== 'webview') {
      return;
    }

    const blockDisallowedNavigation = (event: Electron.Event, url: string) => {
      if (!isAllowedBrowserUrl(url)) {
        event.preventDefault();
      }
    };

    contents.on('will-navigate', blockDisallowedNavigation);
    contents.on('will-redirect', blockDisallowedNavigation);
  });
}

function getAllPanesFromLayout(layout: LayoutNode): Pane[] {
  if (layout.type === 'pane') {
    return [layout.pane];
  }

  return layout.children.flatMap((child) => getAllPanesFromLayout(child));
}

function getWindowWorkingDirectory(window: Workspace['windows'][number]): string | null {
  const panes = getAllPanesFromLayout(window.layout);
  const localPane = panes.find((pane) => isTerminalPane(pane) && pane.backend !== 'ssh' && pane.cwd);
  return localPane?.cwd || null;
}

function createWindow() {
  const preloadPath = path.join(__dirname, '../preload/index.js');
  const shouldMaximizeOnShow = process.platform !== 'darwin';
  const supportsOpacityReveal = process.platform === 'win32' || process.platform === 'darwin';
  const startupDisplay = shouldMaximizeOnShow
    ? screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    : null;
  const startupWorkArea = startupDisplay?.workArea;

  mainWindow = new BrowserWindow({
    width: startupWorkArea?.width ?? 1024,
    height: startupWorkArea?.height ?? 768,
    x: startupWorkArea?.x,
    y: startupWorkArea?.y,
    minWidth: 480,
    minHeight: 360,
    backgroundColor: '#0a0a0a',
    title: '',
    icon: APP_ICON_PATH,
    show: false, // 创建时不显示，等待渲染进程通知
    ...getMainWindowChromeOptions(process.platform),
    fullscreenable: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });

  mainWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;

    const src = typeof params.src === 'string' ? params.src.trim() : '';
    if (!isAllowedBrowserUrl(src)) {
      event.preventDefault();
    }
  });

  // macOS: 创建标准菜单栏（恢复 ⌘Q/⌘H/⌘M 等系统快捷键）
  // Windows/Linux: 移除菜单栏
  if (process.platform === 'darwin') {
    const template: Electron.MenuItemConstructorOptions[] = [
      {
        label: app.name,
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' },
        ],
      },
      {
        label: 'View',
        submenu: [
          { role: 'togglefullscreen' },
        ],
      },
      {
        label: 'Window',
        submenu: [
          { role: 'minimize' },
          { role: 'zoom' },
          { role: 'close' },
        ],
      },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  } else {
    Menu.setApplicationMenu(null);
  }

  // 等待渲染进程明确通知“首屏已可见”后再显示窗口，
  // 避免依赖额外的固定延迟去掩盖首帧抖动。
  let rendererReady = false;
  let startupRevealTimer: ReturnType<typeof setInterval> | null = null;
  let startupRevealFallbackTimer: ReturnType<typeof setTimeout> | null = null;

  const clearStartupRevealTimers = () => {
    if (startupRevealTimer) {
      clearInterval(startupRevealTimer);
      startupRevealTimer = null;
    }

    if (startupRevealFallbackTimer) {
      clearTimeout(startupRevealFallbackTimer);
      startupRevealFallbackTimer = null;
    }
  };

  const revealWindow = () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    clearStartupRevealTimers();

    if (!supportsOpacityReveal) {
      mainWindow.show();
      mainWindow.webContents.send('window-startup-reveal');
      return;
    }

    let opacity = 0;
    mainWindow.setOpacity(0);

    if (!mainWindow.isVisible()) {
      mainWindow.show();
    }

    mainWindow.webContents.send('window-startup-reveal');

    startupRevealTimer = setInterval(() => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        clearStartupRevealTimers();
        return;
      }

      opacity = Math.min(1, opacity + 0.2);
      mainWindow.setOpacity(opacity);

      if (opacity >= 1) {
        clearStartupRevealTimers();
      }
    }, 16);
  };

  const showWindowWhenReady = () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    clearStartupRevealTimers();

    if (!shouldMaximizeOnShow) {
      revealWindow();
      return;
    }

    if (supportsOpacityReveal) {
      mainWindow.setOpacity(0);
    }

    let revealed = false;
    const revealAfterMaximize = () => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        return;
      }

      if (revealed) {
        return;
      }

      revealed = true;
      const wasMaximized = mainWindow.isMaximized();
      revealWindow();

      if (wasMaximized) {
        mainWindow.webContents.send('window-maximized', true);
        return;
      }

      setTimeout(() => {
        if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMaximized()) {
          return;
        }

        mainWindow.maximize();
      }, 0);
    };

    mainWindow.once('maximize', revealAfterMaximize);
    mainWindow.maximize();

    if (mainWindow.isMaximized()) {
      revealAfterMaximize();
      return;
    }

    startupRevealFallbackTimer = setTimeout(() => {
      revealAfterMaximize();
    }, 250);
  };

  ipcMain.once('renderer-ready', () => {
    rendererReady = true;
    if (mainWindow && !mainWindow.isDestroyed()) {
      console.log('[ELECTRON] Renderer ready, revealing window');
      showWindowWhenReady();
    }
  });

  // 超时保护：如果 5 秒后还没收到 renderer-ready，强制显示窗口
  setTimeout(() => {
    if (!rendererReady && mainWindow && !mainWindow.isDestroyed()) {
      console.log('[ELECTRON] Renderer ready timeout, forcing window reveal');
      showWindowWhenReady();
    }
  }, 5000);

  // 监听窗口最大化/取消最大化事件，通知渲染进程
  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('window-maximized', true);
  });

  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('window-maximized', false);
  });

  mainWindow.on('enter-full-screen', () => {
    mainWindow?.webContents.send('window-fullscreen', true);
  });

  mainWindow.on('leave-full-screen', () => {
    mainWindow?.webContents.send('window-fullscreen', false);
  });

  // 开发环境加载 dev server，优先读取环境变量，避免 localhost 在不同系统下解析差异
  if (process.env.NODE_ENV === 'development') {
    const devServerUrl = process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173';
    mainWindow.loadURL(devServerUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // F12 切换开发者工具
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' && input.type === 'keyDown') {
      if (mainWindow) {
        if (mainWindow.webContents.isDevToolsOpened()) {
          mainWindow.webContents.closeDevTools();
        } else {
          mainWindow.webContents.openDevTools();
        }
      }
    }
  });

  mainWindow.on('closed', () => {
    clearStartupRevealTimers();
    mainWindow = null;
  });

  // 窗口关闭前处理
  mainWindow.on('close', async (event) => {
    const currentViewState = viewSwitcher?.getCurrentView() || 'unified';
    const closeAction = resolveMainWindowCloseAction(
      process.platform,
      currentViewState,
      isQuitting,
    );

    // 终端和画布视图统一先返回主页，避免 macOS 的隐藏逻辑抢先执行。
    if (closeAction === 'return-home') {
      event.preventDefault();
      viewSwitcher?.switchToUnifiedView();
      return;
    }

    // macOS: 主页上的关闭只隐藏窗口，不退出应用。
    if (closeAction === 'hide') {
      event.preventDefault();
      mainWindow?.hide();
      return;
    }

    if (closeAction === 'shutdown') {
      event.preventDefault();
      isQuitting = true;

      // 使用 ShutdownManager 处理退出
      if (shutdownManager) {
        const shutdownContext: ShutdownContext = {
          mainWindow,
          processManager,
          statusPoller,
          autoSaveManager,
          ptySubscriptionManager,
          fileWatcherService,
          gitBranchWatcher,
          tmuxCompatService,
          remoteGateway,
          languageFeatureService,
          currentWorkspace,
        };

        await shutdownManager.shutdown(shutdownContext);
      } else {
        // 如果 ShutdownManager 未初始化，直接退出
        console.error('[ELECTRON] ShutdownManager not initialized, forcing exit');
        process.exit(1);
      }
    }
  });
}

// 注册自定义协议用于加载本地图片
// 必须在 app.ready 之前调用
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app-image',
    privileges: {
      secure: true,
      supportFetchAPI: true,
      bypassCSP: false,
      corsEnabled: false,
    },
  },
]);

if (hasSingleInstanceLock) {
  app.whenReady().then(async () => {
    // 注册 app-image:// 协议处理器
    protocol.handle('app-image', (request) => {
      const filePath = normalizeImagePath(request.url);
      if (!filePath) {
        return new Response('Image path is missing', { status: 404 });
      }

      const fileUrl = toFileUrl(filePath);
      return net.fetch(fileUrl);
    });

    registerBrowserWebviewGuards();

    // 强制使用暗色主题（包括标题栏）
    nativeTheme.themeSource = 'dark';

    // 初始化 WorkspaceManager
    workspaceManager = new WorkspaceManagerImpl();

    // 崩溃恢复
    await workspaceManager.recoverFromCrash();

    // 初始化 AutoSaveManager
    autoSaveManager = new AutoSaveManagerImpl();

    // 初始化 SSH 基础设施
    sshProfileStore = new SSHProfileStore();
    sshVaultService = new SSHVaultService();
    sshKnownHostsStore = new SSHKnownHostsStore();
    chatProviderVaultService = new ChatProviderVaultService();
    sshHostKeyPromptService = new ElectronSSHHostKeyPromptService({
      getMainWindow: () => mainWindow,
    });

    // 初始化 ProcessManager
    processManager = new ProcessManager(() => currentWorkspace?.settings ?? null);
    processManager.setSSHKnownHostsStore(sshKnownHostsStore);
    processManager.setSSHHostKeyPromptService(sshHostKeyPromptService);
    processManager.setZmodemDialogHandlers({
      selectSendFiles: async () => {
        if (!mainWindow || mainWindow.isDestroyed()) {
          return null;
        }

        const result = await dialog.showOpenDialog(mainWindow, {
          properties: ['openFile', 'multiSelections'],
        });

        if (result.canceled || result.filePaths.length === 0) {
          return null;
        }

        return result.filePaths;
      },
      chooseSavePath: async (suggestedName: string) => {
        if (!mainWindow || mainWindow.isDestroyed()) {
          return null;
        }

        const result = await dialog.showSaveDialog(mainWindow, {
          defaultPath: suggestedName,
        });

        if (result.canceled || !result.filePath) {
          return null;
        }

        return result.filePath;
      },
    });

    processManager.warmupConPtyDll().catch((error) => {
      console.error('[Main] ConPTY DLL warmup failed:', error);
    });

    const publishRemoteWorkspaceUpdate = (workspace: Workspace) => {
      currentWorkspace = workspace;
      autoSaveManager?.triggerSave();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('workspace-loaded', workspace);
      }
    };

    remoteGateway = new RemoteGateway({
      processManager,
      userDataPath: app.getPath('userData'),
      hostName: hostname(),
      appVersion: app.getVersion(),
      getCurrentWorkspace: () => currentWorkspace,
      onPaneProcessStarted: ({ windowId, paneId, pid }) => {
        statusPoller?.addPane(windowId, paneId, pid);
      },
      onPaneProcessStopped: ({ paneId }) => {
        statusPoller?.removePane(paneId);
      },
      onPaneData: ({ windowId, paneId, data, seq }) => {
        forwardPtyData({ windowId, paneId, data, seq });
      },
      onPanePtySubscription: (paneId, unsubscribe) => {
        ptySubscriptionManager?.add(paneId, unsubscribe);
      },
      onPanePtyUnsubscribe: (paneId) => {
        ptySubscriptionManager?.remove(paneId);
      },
      onLocalPaneStarted: async ({ windowId, workingDirectory }) => {
        await projectConfigWatcher.startWatching(windowId, workingDirectory, (updatedConfig) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('project-config-updated', {
              windowId,
              projectConfig: updatedConfig,
            });
          }
        });
      },
      listSSHProfiles: async () => {
        if (!sshProfileStore) {
          throw new Error('SSH profile store is not initialized');
        }
        return sshProfileStore.list();
      },
      createSSHWindow: (params) => createSSHWindowSession({
        mainWindow,
        processManager,
        statusPoller,
        ptySubscriptionManager,
        sshProfileStore,
        sshVaultService,
      }, {
        profileId: params.profileId,
        name: params.name,
        remoteCwd: params.workingDirectory,
        command: params.command,
        initialCols: params.initialCols,
        initialRows: params.initialRows,
      }),
      startSSHTerminalPane: (params) => startSSHPaneSession({
        mainWindow,
        processManager,
        statusPoller,
        ptySubscriptionManager,
        sshProfileStore,
        sshVaultService,
      }, {
        windowId: params.windowId,
        paneId: params.paneId,
        profileId: params.profileId,
        remoteCwd: params.workingDirectory,
        command: params.command,
        initialCols: params.initialCols,
        initialRows: params.initialRows,
      }),
      onRemoteWindowCreated: ({ workspace }) => {
        publishRemoteWorkspaceUpdate(workspace);
      },
      onRemotePaneDeleted: ({ paneId }) => {
        ptySubscriptionManager?.remove(paneId);
        statusPoller?.removePane(paneId);
        disposeAgentTaskForPane(paneId);
      },
      onRemoteWindowDeleted: ({ windowId, paneIds, workspace }) => {
        for (const paneId of paneIds) {
          ptySubscriptionManager?.remove(paneId);
        }
        statusPoller?.removeWindow(windowId);
        gitBranchWatcher?.unwatch(windowId);
        projectConfigWatcher?.stopWatching(windowId);
      },
      onRemoteWindowRuntimeUpdated: ({ workspace }) => {
        publishRemoteWorkspaceUpdate(workspace);
      },
      onRemoteWorkspaceLayoutUpdated: ({ workspace }) => {
        publishRemoteWorkspaceUpdate(workspace);
      },
    });
    await remoteGateway.startFromSavedSettings().catch((error) => {
      console.error('[Main] Failed to restore remote gateway:', error);
    });
    powerMonitor.on('resume', () => {
      void remoteGateway?.recoverFromSystemResume().catch((error) => {
        console.error('[Main] Failed to recover remote gateway after system resume:', error);
      });
    });

    // 初始化 TmuxCompatService（内部会创建 TmuxRpcServer）
    tmuxCompatService = new TmuxCompatService({
      processManager: processManager as any,
      getWindowStore: () => currentWorkspace ?? { windows: [] },
      updateWindowStore: (updater: (state: any) => void) => {
        if (currentWorkspace) {
          updater(currentWorkspace);
        }
      },
      onPaneProcessStarted: ({ windowId, paneId, pid }) => {
        statusPoller?.addPane(windowId, paneId, pid);
      },
      onPaneProcessStopped: ({ paneId }) => {
        statusPoller?.removePane(paneId);
      },
      onPaneData: ({ windowId, paneId, data, seq }) => {
        forwardPtyData({ windowId, paneId, data, seq });
      },
      debug: process.env.AUSOME_TMUX_DEBUG === '1',
    });

    // 将 tmuxCompatService 注入 ProcessManager（解决循环依赖）
    processManager.setTmuxCompatService(tmuxCompatService);

    // 监听 TmuxCompatService 事件并转发到渲染进程
    tmuxCompatService.on('pane-title-changed', (data: any) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('tmux:pane-title-changed', data);
      }
    });

    tmuxCompatService.on('pane-style-changed', (data: any) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('tmux:pane-style-changed', data);
      }
    });

    tmuxCompatService.on('window-synced', (data: any) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('tmux:window-synced', data);
      }
    });

    tmuxCompatService.on('window-removed', (data: any) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('tmux:window-removed', data);
      }
    });

    // 初始化 PtySubscriptionManager
    ptySubscriptionManager = new PtySubscriptionManager();

    // 初始化 ShutdownManager
    shutdownManager = new ShutdownManager();

    // 初始化 FileWatcherService（通用文件监听服务）
    fileWatcherService = new FileWatcherService();
    codeProjectIndexService = new CodeProjectIndexService(
      path.join(app.getPath('userData'), 'code-index'),
      (payload) => {
        if (!mainWindow || mainWindow.isDestroyed()) {
          return;
        }

        mainWindow.webContents.send('code-pane-index-progress', payload);
      },
      {
        enableWatcher: false,
      },
    );
    codeFileService = new CodeFileService(codeProjectIndexService);
    codeGitService = new CodeGitService();
    codeGitOperationService = new CodeGitOperationService();
    codeGitHistoryService = new CodeGitHistoryService();
    codeGitBlameService = new CodeGitBlameService();
    codePaneWatcherService = new CodePaneWatcherService(
      () => mainWindow,
      (rootPath, changes) => {
        if (!codeProjectIndexService) {
          return;
        }

        void codeProjectIndexService.notifyChanges(rootPath, changes).catch((error) => {
          console.error('[CodePaneWatcherService] Failed to forward index changes:', error);
        });
      },
    );
    const pluginDataPath = path.join(app.getPath('userData'), 'plugins');
    const pluginRegistryStore = new PluginRegistryStore({
      filePath: path.join(pluginDataPath, 'registry.json'),
    });
    const pluginCatalogService = new PluginCatalogService({});
    const pluginInstallerService = new PluginInstallerService({
      baseDir: pluginDataPath,
      registryStore: pluginRegistryStore,
    });
    pluginManager = new PluginManager({
      registryStore: pluginRegistryStore,
      catalogService: pluginCatalogService,
      installerService: pluginInstallerService,
    });
    sessionAggregationService = new SessionAggregationService();
    taskArtifactService = new TaskArtifactService();
    browserSyncService = new BrowserSyncService();
    mcpCapabilityService = new McpCapabilityService(() => getAgentController()?.getMcpHub() ?? null);
    const languagePluginResolver = new LanguagePluginResolver({
      registryStore: pluginRegistryStore,
    });
    const languageWorkspaceService = new LanguageWorkspaceService({
      emitState: (payload) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('code-pane-language-workspace-changed', payload);
        }
      },
    });
    const languageServerSupervisor = new LanguageServerSupervisor({
      runtimeRootPath: path.join(pluginDataPath, 'runtime'),
      emitDiagnostics: (payload) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('code-pane-diagnostics-changed', payload);
        }
      },
      emitRuntimeState: (payload) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('plugin-runtime-state-changed', payload);
        }
      },
      workspaceService: languageWorkspaceService,
    });
    const pluginCapabilityRuntimeService = new PluginCapabilityRuntimeService({
      registryStore: pluginRegistryStore,
      codeFileService,
      runtimeRootPath: path.join(pluginDataPath, 'runtime'),
      emitRuntimeState: (payload) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('plugin-runtime-state-changed', payload);
        }
      },
    });
    languageFeatureService = new LanguageFeatureService({
      codeFileService,
      resolver: languagePluginResolver,
      supervisor: languageServerSupervisor,
      pluginRuntimeService: pluginCapabilityRuntimeService,
      workspaceService: languageWorkspaceService,
    });
    languageWorkspaceHostService = new LanguageWorkspaceHostService({
      languageFeatureService,
      languagePluginResolver,
      getCurrentWorkspace: () => currentWorkspace,
    });
    codeRefactorService = new CodeRefactorService({
      codeFileService,
      languageFeatureService,
    });
    codeRunProfileService = new CodeRunProfileService({
      emitSessionChanged: (payload) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('code-pane-run-session-changed', payload);
        }
      },
      emitSessionOutput: (payload) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('code-pane-run-session-output', payload);
        }
      },
    });
    languageProjectContributionService = new LanguageProjectContributionService({
      codeFileService,
      runProfileService: codeRunProfileService,
    });
    codeTestService = new CodeTestService({
      runProfileService: codeRunProfileService,
      pluginRuntimeService: pluginCapabilityRuntimeService,
    });
    debugAdapterSupervisor = new DebugAdapterSupervisor({
      runProfileService: codeRunProfileService,
      emitSessionChanged: (payload) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('code-pane-debug-session-changed', payload);
        }
      },
      emitSessionOutput: (payload) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('code-pane-debug-session-output', payload);
        }
      },
      pluginRuntimeService: pluginCapabilityRuntimeService,
    });

    // 初始化 ProjectConfigWatcher（基于 FileWatcherService）
    initProjectConfigWatcher(fileWatcherService);

    const syncProjectConfigWatchers = async () => {
      if (!currentWorkspace) {
        return;
      }

      const activeWindowIds = new Set(currentWorkspace.windows.map((window) => window.id));
      const windowsToWatch = currentWorkspace.windows.map((window) => ({
        id: window.id,
        cwd: getWindowWorkingDirectory(window),
      }));

      for (const watchedWindowId of projectConfigWatcher.getWatchedWindowIds()) {
        if (!activeWindowIds.has(watchedWindowId)) {
          projectConfigWatcher.stopWatching(watchedWindowId);
        }
      }

      for (const { id, cwd } of windowsToWatch) {
        if (!activeWindowIds.has(id) || !cwd) {
          projectConfigWatcher.stopWatching(id);
          continue;
        }

        await projectConfigWatcher.startWatching(id, cwd, (updatedConfig) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('project-config-updated', {
              windowId: id,
              projectConfig: updatedConfig,
            });
          }
        });
      }
    };

    createWindow();

    // 初始化 StatusPoller、ViewSwitcher 和 GitBranchWatcher（需要 mainWindow 已创建）
    if (mainWindow) {
      statusPoller = new StatusPoller(processManager.getStatusDetector(), mainWindow);
      statusPoller.startPolling();
      viewSwitcher = new ViewSwitcherImpl(mainWindow);

      // 初始化 GitBranchWatcher（基于 FileWatcherService）
      gitBranchWatcher = new GitBranchWatcher(fileWatcherService);

      // 初始化 WorkspaceRestorer
      // workspaceRestorer = new WorkspaceRestorerImpl(processManager, mainWindow);
    }

    // 创建 handler 上下文并注册所有 IPC handlers（必须在所有服务初始化后）
    const handlerContext: HandlerContext = {
      mainWindow,
      processManager,
      statusPoller,
      viewSwitcher,
      workspaceManager,
      autoSaveManager,
      ptySubscriptionManager,
      gitBranchWatcher,
      tmuxCompatService,
      sshProfileStore,
      sshVaultService,
      sshKnownHostsStore,
      chatProviderVaultService,
      codeFileService,
      codeGitService,
      codeGitBlameService,
      codeGitHistoryService,
      codeGitOperationService,
      codeProjectIndexService,
      codePaneWatcherService,
      codeRefactorService,
      codeRunProfileService,
      codeTestService,
      debugAdapterSupervisor,
      languageFeatureService,
      languageProjectContributionService,
      languageWorkspaceHostService,
      pluginManager,
      sessionAggregationService,
      taskArtifactService,
      browserSyncService,
      mcpCapabilityService,
      remoteGateway,
      currentWorkspace,
      getMainWindow: () => mainWindow,
      getCurrentWorkspace: () => currentWorkspace,
      setCurrentWorkspace: (workspace) => { currentWorkspace = workspace; },
      syncProjectConfigWatchers,
    };
    registerAllHandlers(handlerContext);

    // 加载工作区并恢复窗口
    try {
      const workspace = await workspaceManager.loadWorkspace();
      currentWorkspace = workspace;
      await syncProjectConfigWatchers();
      // 启动自动保存
      if (autoSaveManager && workspaceManager) {
        autoSaveManager.startAutoSave(workspaceManager, () => {
          // 返回当前工作区状态（必须同步返回，所以依赖缓存的 currentWorkspace）
          if (!currentWorkspace) {
            throw new Error('Current workspace not available');
          }
          return currentWorkspace;
        });
      }

      // 恢复工作区窗口（不自动启动 PTY 进程）
      if (mainWindow && workspace.windows.length > 0) {
        mainWindow.webContents.once('did-finish-load', async () => {
          // 通知渲染进程工作区已加载（显示为未启动状态，不启动进程）
          mainWindow?.webContents.send('workspace-loaded', workspace);
          console.log('[Main] Workspace loaded, windows restored without auto-starting sessions');
          // 注意：不再为所有窗口启动 git 监听，只在窗口激活时才监听
        });
      }
    } catch (error) {
      console.error('Failed to load workspace:', error);
      // 通知渲染进程加载失败
      if (mainWindow) {
        mainWindow.webContents.once('did-finish-load', () => {
          mainWindow?.webContents.send('workspace-restore-error', {
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }
    }

    // macOS 特定: 点击 Dock 图标时重新显示或创建窗口
    app.on('activate', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        bringMainWindowToFront();
      } else if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });
}

// macOS: ⌘Q 触发 before-quit，标记退出状态以便 close 事件不再隐藏窗口
app.on('before-quit', () => {
  isQuitting = true;
});

// 所有窗口关闭时退出应用 (macOS 除外)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // 使用 ShutdownManager 进行完整的资源清理
    if (shutdownManager && !isQuitting) {
      isQuitting = true;
      console.log('[Main] Window closed, starting shutdown...');

      shutdownManager.shutdown({
        mainWindow,
        processManager,
        statusPoller,
        autoSaveManager,
        ptySubscriptionManager,
        fileWatcherService,
        gitBranchWatcher,
        tmuxCompatService,
        remoteGateway,
        codeProjectIndexService,
        languageFeatureService,
        currentWorkspace,
      }).catch(error => {
        console.error('[Main] Shutdown failed:', error);
        process.exit(1);
      });
    } else {
      // 如果 ShutdownManager 未初始化，直接退出
      app.exit(0);
    }
  }
});
