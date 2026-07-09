import { BrowserWindow } from 'electron';
import { ProcessManager } from './ProcessManager';
import { StatusPoller } from './StatusPoller';
import { AutoSaveManagerImpl } from './AutoSaveManager';
import { PtySubscriptionManager } from './PtySubscriptionManager';
import { projectConfigWatcher } from './ProjectConfigWatcher';
import { FileWatcherService } from './FileWatcherService';
import { GitBranchWatcher } from './GitBranchWatcher';
import { TmuxCompatService } from './TmuxCompatService';
import { CodeProjectIndexService } from './code/CodeProjectIndexService';
import { LanguageFeatureService } from './language/LanguageFeatureService';
import { Workspace } from '../types/workspace';
import { RemoteGateway } from '../remote/RemoteGateway';

/**
 * 关闭上下文
 * 包含关闭时需要清理的所有资源
 */
export interface ShutdownContext {
  mainWindow: BrowserWindow | null;
  processManager: ProcessManager | null;
  statusPoller: StatusPoller | null;
  autoSaveManager: AutoSaveManagerImpl | null;
  ptySubscriptionManager: PtySubscriptionManager | null;
  fileWatcherService: FileWatcherService | null;
  gitBranchWatcher: GitBranchWatcher | null;
  tmuxCompatService: TmuxCompatService | null;
  codeProjectIndexService?: CodeProjectIndexService | null;
  languageFeatureService?: LanguageFeatureService | null;
  remoteGateway?: RemoteGateway | null;
  currentWorkspace: Workspace | null;
}

/**
 * 关闭步骤
 */
interface ShutdownStep {
  name: string;
  fn: () => Promise<void>;
  timeout: number;
}

/**
 * 关闭管理器
 *
 * 负责应用退出时的资源清理和优雅关闭
 *
 * 设计原则：
 * - 简化退出流程，减少复杂度
 * - 确保资源正确清理
 * - 优雅退出，避免强制杀死进程
 * - 清晰的日志和错误处理
 */
export class ShutdownManager {
  private isShuttingDown = false;
  private readonly shutdownTimeout = 5000; // 5秒安全超时（从3秒增加到5秒）

  /**
   * 执行关闭流程
   */
  async shutdown(context: ShutdownContext): Promise<void> {
    if (this.isShuttingDown) {
      console.log('[ShutdownManager] Already shutting down, skipping');
      return;
    }

    this.isShuttingDown = true;
    console.log('[ShutdownManager] Starting shutdown sequence');

    // 通知渲染进程开始清理
    if (context.mainWindow && !context.mainWindow.isDestroyed()) {
      context.mainWindow.webContents.send('cleanup-started');
    }

    // 设置安全超时 - 如果 5 秒内未完成，强制退出
    const safetyTimer = setTimeout(() => {
      console.error('[ShutdownManager] Safety timeout reached, forcing exit');
      process.exit(1);
    }, this.shutdownTimeout);
    safetyTimer.unref(); // 不阻止进程退出

    try {
      await this.executeShutdownSteps(context);
      console.log('[ShutdownManager] Shutdown completed successfully');

      // 清理安全定时器
      clearTimeout(safetyTimer);

      // 优雅退出
      process.exit(0);
    } catch (error) {
      console.error('[ShutdownManager] Shutdown failed:', error);

      // 清理安全定时器
      clearTimeout(safetyTimer);

      // 异常退出
      process.exit(1);
    }
  }

  /**
   * 执行所有关闭步骤
   */
  private async executeShutdownSteps(context: ShutdownContext): Promise<void> {
    const steps: ShutdownStep[] = [
      {
        name: 'Save workspace',
        fn: () => this.saveWorkspace(context),
        timeout: 1000,
      },
      {
        name: 'Stop services',
        fn: () => this.stopServices(context),
        timeout: 500,
      },
      {
        name: 'Cleanup subscriptions',
        fn: () => this.cleanupSubscriptions(context),
        timeout: 500,
      },
      {
        name: 'Destroy processes',
        fn: () => this.destroyProcesses(context),
        timeout: 3000, // 增加到 3 秒（原来是 2 秒）
      },
    ];

    for (const step of steps) {
      try {
        console.log(`[ShutdownManager] Executing: ${step.name}`);
        await this.executeWithTimeout(step.fn, step.timeout, step.name);
        console.log(`[ShutdownManager] Completed: ${step.name}`);
      } catch (error) {
        console.error(`[ShutdownManager] Failed: ${step.name}`, error);
        // 继续执行其他步骤，不要因为一个步骤失败就停止
      }
    }
  }

  /**
   * 执行带超时的操作
   */
  private async executeWithTimeout(
    fn: () => Promise<void>,
    timeout: number,
    name: string
  ): Promise<void> {
    return Promise.race([
      fn(),
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error(`${name} timeout after ${timeout}ms`)), timeout)
      ),
    ]);
  }

  /**
   * 保存工作区
   */
  private async saveWorkspace(context: ShutdownContext): Promise<void> {
    if (context.autoSaveManager && context.currentWorkspace) {
      await context.autoSaveManager.saveImmediately();
    }
  }

  /**
   * 停止服务
   */
  private async stopServices(context: ShutdownContext): Promise<void> {
    context.autoSaveManager?.stopAutoSave();
    context.statusPoller?.stopPolling();
    projectConfigWatcher.stopAll(); // 停止所有项目配置文件监听
    context.gitBranchWatcher?.unwatchAll(); // 停止所有 git 分支监听
    context.fileWatcherService?.destroy(); // 销毁文件监听服务
    context.tmuxCompatService?.destroy(); // 销毁 tmux 兼容服务（内部会关闭 RPC 服务器）
    await context.remoteGateway?.stop();
    await context.codeProjectIndexService?.destroy();
    await context.languageFeatureService?.resetSessions();
  }

  /**
   * 清理订阅
   */
  private async cleanupSubscriptions(context: ShutdownContext): Promise<void> {
    context.ptySubscriptionManager?.clear();
  }

  /**
   * 销毁进程
   */
  private async destroyProcesses(context: ShutdownContext): Promise<void> {
    if (context.processManager) {
      // 发送进度更新到渲染进程
      const progressCallback = (current: number, total: number) => {
        if (context.mainWindow && !context.mainWindow.isDestroyed()) {
          context.mainWindow.webContents.send('cleanup-progress', { current, total });
        }
      };
      await context.processManager.destroy(progressCallback);
    }
  }
}
