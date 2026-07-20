import React, { useEffect, useState } from 'react';
import { Minus, Square, X, Maximize2, Minimize2, Home } from 'lucide-react';
import { resolveRendererAssetUrl } from '../utils/assetUrl';
import { preventMouseButtonFocus } from '../utils/buttonFocus';
import { appearanceTitlebarSurfaceStyle } from '../utils/appearance';

export const CUSTOM_TITLEBAR_ACTIONS_SLOT_ID = 'custom-titlebar-actions-slot';

interface CustomTitleBarProps {
  title?: string;
  gitBranch?: string;
  showAppName?: boolean;
  appName?: string;
  onReturn?: () => void;
  onClose?: () => void;
}

export const CustomTitleBar: React.FC<CustomTitleBarProps> = ({
  title = '',
  gitBranch,
  showAppName = false,
  appName = 'Synapse',
  onReturn,
  onClose,
}) => {
  const [isMaximized, setIsMaximized] = useState(false);
  const isMac = window.electronAPI?.platform === 'darwin';
  const appLogoSrc = resolveRendererAssetUrl('resources/icon.png');

  useEffect(() => {
    if (isMac) {
      window.electronAPI?.windowIsFullScreen().then((result) => {
        if (result.success && typeof result.data === 'boolean') {
          setIsMaximized(result.data);
        }
      });

      const unsubscribe = window.electronAPI?.onWindowFullScreen((isFullScreen) => {
        setIsMaximized(isFullScreen);
      });

      return () => { unsubscribe?.(); };
    }

    window.electronAPI?.windowIsMaximized().then((result) => {
      if (result.success && typeof result.data === 'boolean') {
        setIsMaximized(result.data);
      }
    });

    const unsubscribe = window.electronAPI?.onWindowMaximized((maximized) => {
      setIsMaximized(maximized);
    });

    return () => { unsubscribe?.(); };
  }, [isMac]);

  const handleMinimize = () => window.electronAPI?.windowMinimize();
  const handleMaximize = () => (
    isMac
      ? window.electronAPI?.windowToggleFullScreen()
      : window.electronAPI?.windowMaximize()
  );
  const handleClose = () => {
    if (onClose) {
      onClose();
      return;
    }

    window.electronAPI?.windowClose();
  };
  const handleDoubleClick = () => { if (!isMac) handleMaximize(); };

  // macOS: 左侧红黄绿圆点 + logo，中间标题，右侧留空
  if (isMac) {
    return (
      <div
        className="h-9 flex items-center border-b px-3 select-none relative flex-shrink-0 border-[rgb(var(--titlebar-border))]"
        style={{
          WebkitAppRegion: 'drag',
          ...appearanceTitlebarSurfaceStyle,
        } as React.CSSProperties}
      >
        {/* 左侧：窗口控制 + logo + 应用名 */}
        <div className="flex items-center gap-3" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <div className="group flex items-center gap-2" data-testid="mac-window-controls">
            <button type="button" tabIndex={-1} onMouseDown={preventMouseButtonFocus} onClick={handleClose} className="flex h-3 w-3 items-center justify-center rounded-full border border-[#e0443e] bg-[#ff5f57]" aria-label="Close">
              <X size={8} strokeWidth={2.5} className="pointer-events-none text-[#4d0000] opacity-0 transition-opacity duration-100 group-hover:opacity-100" />
            </button>
            <button type="button" tabIndex={-1} onMouseDown={preventMouseButtonFocus} onClick={handleMinimize} className="flex h-3 w-3 items-center justify-center rounded-full border border-[#dea123] bg-[#febc2e]" aria-label="Minimize">
              <Minus size={8} strokeWidth={3} className="pointer-events-none text-[#704800] opacity-0 transition-opacity duration-100 group-hover:opacity-100" />
            </button>
            <button type="button" tabIndex={-1} onMouseDown={preventMouseButtonFocus} onClick={handleMaximize} className="flex h-3 w-3 items-center justify-center rounded-full border border-[#1aab29] bg-[#28c840]" aria-label="Maximize">
              {isMaximized ? (
                <Minimize2 size={7} strokeWidth={2.5} className="pointer-events-none text-[#006500] opacity-0 transition-opacity duration-100 group-hover:opacity-100" />
              ) : (
                <Maximize2 size={7} strokeWidth={2.5} className="pointer-events-none text-[#006500] opacity-0 transition-opacity duration-100 group-hover:opacity-100" />
              )}
            </button>
          </div>
          <div className="flex items-center gap-2 ml-1">
            <img src={appLogoSrc} alt="Logo" className="w-5 h-5" />
            {showAppName && <span className="text-sm font-medium text-[rgb(var(--titlebar-foreground))]">{appName}</span>}
          </div>
        </div>

        {/* 居中：Home + 窗口/组标题 */}
        {title && (
          <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1.5" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            {onReturn && (
              <button type="button" tabIndex={-1} onMouseDown={preventMouseButtonFocus} onClick={onReturn} className="flex items-center justify-center w-6 h-6 rounded text-[rgb(var(--titlebar-muted))] hover:bg-[rgb(var(--titlebar-hover))] hover:text-[rgb(var(--titlebar-foreground))] transition-colors flex-shrink-0" aria-label="Home">
                <Home size={15} />
              </button>
            )}
            <span className="text-sm font-medium truncate max-w-[300px] text-[rgb(var(--titlebar-foreground))]">{title}</span>
            {gitBranch && (
              <span className="text-xs flex items-center gap-1 text-[rgb(var(--titlebar-muted))]">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M11.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122V6A2.5 2.5 0 0110 8.5H6a1 1 0 00-1 1v1.128a2.251 2.251 0 11-1.5 0V5.372a2.25 2.25 0 111.5 0v1.836A2.492 2.492 0 016 7h4a1 1 0 001-1v-.628A2.25 2.25 0 019.5 3.25zM4.25 12a.75.75 0 100 1.5.75.75 0 000-1.5zM3.5 3.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0z"/>
                </svg>
                {gitBranch}
              </span>
            )}
          </div>
        )}

        <div className="ml-auto flex items-center justify-end" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <div
            id={CUSTOM_TITLEBAR_ACTIONS_SLOT_ID}
            data-testid="custom-titlebar-actions-slot"
            className="flex max-w-[min(48vw,720px)] items-center justify-end overflow-hidden"
          />
        </div>
      </div>
    );
  }

  // Windows/Linux: 左侧 logo，中间标题，右侧最小化/最大化/关闭
  return (
    <div
      className="h-8 flex items-center justify-between border-b select-none relative flex-shrink-0 border-[rgb(var(--titlebar-border))]"
      style={{
        WebkitAppRegion: 'drag',
        ...appearanceTitlebarSurfaceStyle,
      } as React.CSSProperties}
      onDoubleClick={handleDoubleClick}
    >
      {/* 左侧：logo + 应用名 */}
      <div className="flex items-center gap-2 pl-3">
        <img src={appLogoSrc} alt="Logo" className="w-5 h-5" />
        {showAppName && <span className="text-sm font-medium text-[rgb(var(--titlebar-foreground))]">{appName}</span>}
      </div>

      {/* 居中：Home + 窗口/组标题 */}
      {title && (
        <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1.5" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          {onReturn && (
            <button type="button" tabIndex={-1} onMouseDown={preventMouseButtonFocus} onClick={onReturn} className="flex items-center justify-center w-6 h-6 rounded text-[rgb(var(--titlebar-muted))] hover:bg-[rgb(var(--titlebar-hover))] hover:text-[rgb(var(--titlebar-foreground))] transition-colors flex-shrink-0" aria-label="Home">
              <Home size={15} />
            </button>
          )}
          <span className="text-sm font-medium truncate max-w-[300px] text-[rgb(var(--titlebar-foreground))]">{title}</span>
          {gitBranch && (
            <span className="text-xs flex items-center gap-1 text-[rgb(var(--titlebar-muted))]">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                <path d="M11.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122V6A2.5 2.5 0 0110 8.5H6a1 1 0 00-1 1v1.128a2.251 2.251 0 11-1.5 0V5.372a2.25 2.25 0 111.5 0v1.836A2.492 2.492 0 016 7h4a1 1 0 001-1v-.628A2.25 2.25 0 019.5 3.25zM4.25 12a.75.75 0 100 1.5.75.75 0 000-1.5zM3.5 3.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0z"/>
              </svg>
              {gitBranch}
            </span>
          )}
        </div>
      )}

      {/* 右侧：窗口控制按钮 */}
      <div className="flex items-center h-full" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <div
          id={CUSTOM_TITLEBAR_ACTIONS_SLOT_ID}
          data-testid="custom-titlebar-actions-slot"
          className="mr-1 flex max-w-[min(52vw,720px)] items-center justify-end overflow-hidden"
        />
        <button type="button" tabIndex={-1} onMouseDown={preventMouseButtonFocus} onClick={handleMinimize} className="h-full px-4 hover:bg-[rgb(var(--titlebar-hover))] transition-colors flex items-center justify-center" aria-label="Minimize">
          <Minus size={14} className="text-[rgb(var(--titlebar-muted))]" />
        </button>
        <button type="button" tabIndex={-1} onMouseDown={preventMouseButtonFocus} onClick={handleMaximize} className="h-full px-4 hover:bg-[rgb(var(--titlebar-hover))] transition-colors flex items-center justify-center" aria-label="Maximize">
          {isMaximized ? <Square size={12} className="text-[rgb(var(--titlebar-muted))]" /> : <Maximize2 size={12} className="text-[rgb(var(--titlebar-muted))]" />}
        </button>
        <button type="button" tabIndex={-1} onMouseDown={preventMouseButtonFocus} onClick={handleClose} className="h-full px-4 hover:bg-red-600 transition-colors flex items-center justify-center group" aria-label="Close">
          <X size={14} className="text-[rgb(var(--titlebar-muted))] group-hover:text-white" />
        </button>
      </div>
    </div>
  );
};
