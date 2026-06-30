import { HandlerContext } from './HandlerContext';
import { registerWindowHandlers } from './windowHandlers';
import { registerPaneHandlers } from './paneHandlers';
import { registerPtyHandlers } from './ptyHandlers';
import { registerWorkspaceHandlers } from './workspaceHandlers';
import { registerViewHandlers } from './viewHandlers';
import { registerFileHandlers } from './fileHandlers';
import { registerProcessHandlers } from './processHandlers';
import { registerMiscHandlers } from './miscHandlers';
import { registerSettingsHandlers } from './settingsHandlers';
import { registerStatusLineHandlers } from './statusLineHandlers';
import { registerGroupHandlers } from './groupHandlers';
import { registerSSHProfileHandlers } from './sshProfileHandlers';
import { registerSSHSessionHandlers } from './sshSessionHandlers';
import { registerSSHClipboardImageHandlers } from './sshClipboardImageHandlers';
import { registerCodePaneHandlers } from './codePaneHandlers';
import { registerChatHandlers } from './chatHandlers';
import { registerAgentHandlers } from './agentHandlers';
import { registerLanguageHandlers } from './languageHandlers';
import { registerPluginHandlers } from './pluginHandlers';
import { registerTaskEnhancementHandlers } from './taskEnhancementHandlers';

/**
 * 注册所有 IPC handlers
 *
 * 将 IPC handlers 按功能分类到不同的模块中，提高代码可维护性
 */
export function registerAllHandlers(ctx: HandlerContext) {
  // 窗口管理 (create-window, start-window, close-window, delete-window)
  registerWindowHandlers(ctx);

  // 窗格管理 (split-pane, close-pane)
  registerPaneHandlers(ctx);

  // PTY 通信 (pty-write, pty-resize, get-pty-history)
  registerPtyHandlers(ctx);

  // 工作区管理 (save-workspace, load-workspace, recover-from-backup)
  registerWorkspaceHandlers(ctx);

  // 视图切换 (switch-to-terminal-view, switch-to-unified-view)
  registerViewHandlers(ctx);

  // 文件系统 (validate-path, select-directory, open-folder)
  registerFileHandlers(ctx);

  // Code pane 文件与 Git 能力
  registerCodePaneHandlers(ctx);

  // Code pane 语言服务
  registerLanguageHandlers(ctx);

  // 进程管理 (create-terminal, kill-terminal, get-terminal-status, list-terminals)
  registerProcessHandlers(ctx);

  // 设置管理 (get-settings, update-settings, scan-ides, etc.)
  registerSettingsHandlers(ctx);

  // 插件管理
  registerPluginHandlers(ctx);

  // SSH 资产与凭据管理
  registerSSHProfileHandlers(ctx);

  // SSH 会话管理
  registerSSHSessionHandlers(ctx);

  // SSH 剪贴板图片上传
  registerSSHClipboardImageHandlers(ctx);

  // StatusLine 管理 (statusline-configure, statusline-remove, etc.)
  registerStatusLineHandlers(ctx);

  // 窗口组管理 (create-group, delete-group, archive-group, etc.)
  registerGroupHandlers(ctx);

  // Lightweight Chat completion helpers
  registerChatHandlers(ctx);

  // Structured agent runtime
  registerAgentHandlers(ctx);

  // Session aggregation / artifacts / browser sync / MCP summary
  registerTaskEnhancementHandlers(ctx);

  // 其他 (ping)
  registerMiscHandlers(ctx);
}
