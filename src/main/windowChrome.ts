import type { BrowserWindowConstructorOptions } from 'electron';
import type { ViewSwitcher } from './services/ViewSwitcher';

type WindowChromeOptions = Pick<BrowserWindowConstructorOptions, 'frame' | 'titleBarStyle'>;

export type MainWindowCloseAction = 'return-home' | 'hide' | 'shutdown' | 'allow-close';

export function getMainWindowChromeOptions(platform: NodeJS.Platform): WindowChromeOptions {
  if (platform === 'darwin') {
    return {
      frame: true,
      titleBarStyle: 'hidden',
    };
  }

  return { frame: false };
}

export function resolveMainWindowCloseAction(
  platform: NodeJS.Platform,
  currentView: ReturnType<ViewSwitcher['getCurrentView']>,
  isQuitting: boolean,
): MainWindowCloseAction {
  if (isQuitting) {
    return 'allow-close';
  }

  if (currentView === 'terminal' || currentView === 'canvas') {
    return 'return-home';
  }

  return platform === 'darwin' ? 'hide' : 'shutdown';
}
