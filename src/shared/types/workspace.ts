import { AppLanguage } from '../i18n';
import { QuickNavConfig } from './quick-nav';
import { Window } from './window';
import { WindowGroup } from './window-group';
import { CustomCategory } from './custom-category';
import { CanvasWorkspace } from './canvas';
import type { CanvasActivityEvent, CanvasWorkspaceTemplate } from './canvas';
import type { ChatSettings } from './chat';
import type { WorkspacePluginSettings } from './plugin';
import type { AppearanceSettings } from './appearance';
import type { BrowserSyncSettings } from './browser-sync';
import type { KeyboardShortcutSettings } from './keyboard-shortcuts';

export interface IDEConfig {
  id: string;
  name: string;
  command: string;
  path?: string;
  enabled: boolean;
  icon?: string;
  iconSourceType?: 'image-file' | 'custom-image' | 'shortcut-icon' | 'shortcut-file' | 'shortcut-target' | 'uninstall-display-icon' | 'install-dir-icon' | 'executable';
  iconSourcePath?: string;
  iconConfidence?: number;
  installPath?: string;
  detected?: boolean;
  source?: string;
  version?: string;
  catalogId?: string;
  isCustom?: boolean;
}

export interface StatusLineConfig {
  enabled: boolean;
  displayLocation: 'cli' | 'card' | 'both';
  cliFormat: 'full' | 'compact';
  cardFormat: 'full' | 'compact' | 'badge';
  showModel: boolean;
  showContext: boolean;
  showCost: boolean;
  showTime: boolean;
  showTokens: boolean;
}

export interface TerminalSettings {
  useBundledConptyDll: boolean;
  defaultShellProgram: string;
  fontFamily?: string;
  fontSize?: number;
}

export interface TmuxSettings {
  enabled: boolean;
  autoInjectPath: boolean;
  enableForAllPanes: boolean;
}

export interface FeatureSettings {
  sshEnabled: boolean;
}

export type SSHClipboardImageUploadLocation =
  | 'current-working-directory'
  | 'temporary-directory'
  | 'custom-directory';

export type SSHClipboardImageShortcut =
  | 'alt-v'
  | 'ctrl-v'
  | 'ctrl-alt-v'
  | 'cmd-shift-v';

export interface SSHClipboardImageSettings {
  enabled: boolean;
  uploadLocation: SSHClipboardImageUploadLocation;
  shortcut: SSHClipboardImageShortcut;
  customUploadDirectory?: string;
  copyRemotePathAfterUpload: boolean;
  maxUploadBytes?: number;
}

export interface Settings {
  notificationsEnabled: boolean;
  theme: 'dark' | 'light';
  autoSave: boolean;
  autoSaveInterval: number;
  language?: AppLanguage;
  ides: IDEConfig[];
  quickNav?: QuickNavConfig;
  statusLine?: StatusLineConfig;
  terminal?: TerminalSettings;
  appearance?: AppearanceSettings;
  tmux?: TmuxSettings;
  features?: FeatureSettings;
  sshClipboardImage?: SSHClipboardImageSettings;
  customCategories?: CustomCategory[];
  defaultSidebarTab?: 'all' | 'active' | 'local' | 'ssh' | 'archived' | string; // string 也可能是自定义分类或状态筛选 ID
  recentTerminalLimit?: number;
  chat?: ChatSettings;
  plugins?: WorkspacePluginSettings;
  browserSync?: BrowserSyncSettings;
  keyboardShortcuts?: KeyboardShortcutSettings;
}

export interface Workspace {
  version: string;
  windows: Window[];
  groups: WindowGroup[];
  canvasWorkspaces: CanvasWorkspace[];
  canvasWorkspaceTemplates?: CanvasWorkspaceTemplate[];
  canvasActivity?: CanvasActivityEvent[];
  settings: Settings;
  lastSavedAt: string;
}
