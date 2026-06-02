import { useEffect, useRef } from 'react';
import type { KeyboardShortcutDefinition } from '../../shared/types/keyboard-shortcuts';
import { isKeyboardShortcutReservedInTerminal, matchesKeyboardShortcut } from '../../shared/utils/keyboardShortcuts';

interface KeyboardShortcutsOptions {
  quickSwitcherShortcut: KeyboardShortcutDefinition;
  onCtrlTab?: () => void;
  onCtrlB?: () => void;
  onCtrlNumber?: (num: number) => void;
  onEscape?: () => boolean | void; // 返回 true 表示已处理，阻止传播；返回 false 表示未处理，继续传播
  enabled?: boolean;
}

/**
 * 全局快捷键 Hook
 * 处理终端视图中的快捷键
 * 使用 ref 模式避免 stale closure 问题，listener 只注册一次
 */
export function useKeyboardShortcuts(options: KeyboardShortcutsOptions) {
  // 同步更新 ref，始终持有最新的 options（包含最新的 enabled 和所有回调）
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const opts = optionsRef.current;
      const enabled = opts.enabled !== false; // 默认 true

      if (!enabled || e.defaultPrevented) return;

      const target = e.target as HTMLElement;
      if (target?.closest?.('[data-mini-ask-overlay="true"]')) {
        return;
      }

      const isXtermTextarea = target?.classList?.contains('xterm-helper-textarea');

      if (isXtermTextarea) {
        // 终端输入焦点下默认透传给 CLI，但保留明确的应用级导航。
        const isAppLevelShortcut =
          isKeyboardShortcutReservedInTerminal(opts.quickSwitcherShortcut)
          && matchesKeyboardShortcut(e, opts.quickSwitcherShortcut)
          || e.key === 'Escape';
        if (!isAppLevelShortcut) {
          return;
        }
      }

      if (matchesKeyboardShortcut(e, opts.quickSwitcherShortcut)) {
        e.preventDefault();
        e.stopPropagation();
        opts.onCtrlTab?.();
        return;
      }

      // Ctrl+B: 切换侧边栏
      if (e.ctrlKey && e.key === 'b') {
        e.preventDefault();
        e.stopPropagation();
        opts.onCtrlB?.();
        return;
      }

      // Ctrl+1~9: 切换到第 N 个窗口
      if (e.ctrlKey && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        e.stopPropagation();
        opts.onCtrlNumber?.(parseInt(e.key, 10));
        return;
      }

      // Escape: 关闭打开的面板（QuickSwitcher）
      if (e.key === 'Escape') {
        // 调用回调，如果返回 true 表示已处理，阻止事件传播
        if (opts.onEscape) {
          const handled = opts.onEscape();
          if (handled) {
            e.preventDefault();
            e.stopPropagation();
          }
        }
      }
    };

    // 捕获阶段保留明确的应用级快捷键，避免 xterm 在目标阶段先消费 Ctrl+Tab。
    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, []); // 空依赖数组：listener 只注册一次，通过 ref 读取最新值
}
