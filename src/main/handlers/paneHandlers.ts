import { ipcMain } from 'electron';
import { HandlerContext } from './HandlerContext';
import { TerminalConfig } from '../types/process';
import { successResponse, errorResponse } from './HandlerResponse';
import { createPtyDataForwarder } from '../utils/ptyDataForwarder';
import { disposeAgentTaskForPane } from './agentHandlers';

/**
 * 注册窗格管理相关的 IPC handlers
 */
export function registerPaneHandlers(ctx: HandlerContext) {
  const {
    mainWindow,
    processManager,
    statusPoller,
    ptySubscriptionManager,
  } = ctx;
  const forwardPtyData = createPtyDataForwarder(() => mainWindow);

  // 拆分窗格（创建新的 PTY 进程）
  ipcMain.handle('split-pane', async (_event, config: TerminalConfig) => {
    try {
      if (!processManager) {
        throw new Error('ProcessManager not initialized');
      }
      const handle = await processManager.spawnTerminal(config);

      // 订阅 PTY 数据
      const unsubscribe = processManager.subscribePtyData(handle.pid, (data: string, seq?: number) => {
        if (!config.windowId) {
          return;
        }

        forwardPtyData({
          windowId: config.windowId,
          paneId: config.paneId,
          data,
          seq,
        });
      });

      // 使用 PtySubscriptionManager 管理订阅
      if (ptySubscriptionManager && config.paneId) {
        ptySubscriptionManager.add(config.paneId, unsubscribe);
      }

      // 注册到状态轮询，确保进程退出时能通知渲染进程
      if (config.windowId && config.paneId) {
        statusPoller?.addPane(config.windowId, config.paneId, handle.pid);
      }

      return successResponse({ pid: handle.pid, sessionId: handle.sessionId });
    } catch (error) {
      return errorResponse(error);
    }
  });

  // 关闭窗格（终止 PTY 进程）
  ipcMain.handle('close-pane', async (_event, { windowId, paneId }: { windowId: string; paneId: string }) => {
    try {
      if (!processManager) {
        throw new Error('ProcessManager not initialized');
      }

      const processes = processManager.listProcesses();
      const found = processes.find(p => p.windowId === windowId && p.paneId === paneId);
      if (!found) {
        return successResponse();
      }

      if (found.status !== 'exited') {
        await processManager.killProcess(found.pid);
      }

      // Only clear pane-scoped state after the requested window/pane resolves to a process.
      ptySubscriptionManager?.remove(paneId);
      statusPoller?.removePane(paneId);
      disposeAgentTaskForPane(paneId);

      return successResponse();
    } catch (error) {
      return errorResponse(error);
    }
  });
}
