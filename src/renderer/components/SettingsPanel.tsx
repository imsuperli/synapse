import React, { useState, useEffect, useCallback } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Select from '@radix-ui/react-select';
import * as Switch from '@radix-ui/react-switch';
import * as Tabs from '@radix-ui/react-tabs';
import { X, Plus, Trash2, Search, Check, ChevronDown, Globe, Folder, Edit2, FolderOpen, Languages, Compass, Plug, Wrench, Monitor, Command, Palette, Wallpaper, SunMoon, Smartphone } from 'lucide-react';
import { IDEIcon } from './icons/IDEIcons';
import { notifyIDESettingsUpdated } from '../hooks/useIDESettings';
import { notifyWorkspaceSettingsUpdated } from '../utils/settingsEvents';
import { notifyTerminalSettingsUpdated } from '../utils/terminalSettingsEvents';
import { QuickNavItem } from '../../shared/types/quick-nav';
import { FeatureSettings, IDEConfig, SSHClipboardImageSettings, StatusLineConfig } from '../../shared/types/workspace';
import { KnownHostEntry } from '../../shared/types/ssh';
import type { AppearanceReadabilityMode, AppearanceSettings, AppearanceSkinMotionMode } from '../../shared/types/appearance';
import type {
  KeyboardShortcutAction,
  KeyboardShortcutDefinition,
  KeyboardShortcutSettings,
} from '../../shared/types/keyboard-shortcuts';
import { DEFAULT_APPEARANCE_SETTINGS, normalizeAppearanceSettings } from '../../shared/utils/appearance';
import type { BrowserSyncProfile, BrowserSyncState } from '../../shared/types/task';
import { useI18n } from '../i18n';
import type { TranslationKey } from '../i18n';
import { AppLanguage } from '../../shared/i18n';
import { ChatSettingsTab } from './ChatSettingsTab';
import { PluginCenter } from './settings/PluginCenter';
import { CompactSettingRow, CompactSettingsSection } from './settings/CompactSettings';
import { RemoteSettingsTab } from './settings/RemoteSettingsTab';
import { applyAppearanceToDocument, getAppearanceBackdropDescriptor, getAppearanceSkinStyle } from '../utils/appearance';
import {
  formatKeyboardShortcut,
  getDefaultKeyboardShortcuts,
  getKeyboardShortcutInputValue,
  KEYBOARD_SHORTCUT_ACTIONS,
  normalizeKeyboardShortcutKey,
  normalizeKeyboardShortcuts,
} from '../../shared/utils/keyboardShortcuts';
import {
  DEFAULT_RECENT_TERMINAL_LIMIT,
  MAX_RECENT_TERMINAL_LIMIT,
  MIN_RECENT_TERMINAL_LIMIT,
  normalizeRecentTerminalLimit,
} from '../../shared/utils/recentTerminals';
import {
  idePopupActionButtonClassName,
  idePopupEmptyStateClassName,
  idePopupIconButtonClassName,
  idePopupInputClassName,
  idePopupSecondaryButtonClassName,
  idePopupSelectContentClassName,
  idePopupSelectItemClassName,
  idePopupSelectTriggerClassName,
  idePopupSurfaceClassName,
} from './ui/ide-popup';

interface ShellProgramOption {
  command: string;
  path: string;
  isDefault: boolean;
}

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

type SettingsTab = 'general' | 'appearance' | 'shortcuts' | 'quicknav' | 'chat' | 'plugins' | 'remote' | 'advanced';
type QuickNavSubTab = 'ide' | 'custom';
const AUTO_SHELL_OPTION_VALUE = '__auto__';
const DEFAULT_STATUSLINE_CONFIG: StatusLineConfig = {
  enabled: false,
  displayLocation: 'both',
  cliFormat: 'full',
  cardFormat: 'compact',
  showModel: true,
  showContext: true,
  showCost: true,
  showTime: false,
  showTokens: false,
};
const DEFAULT_FEATURE_SETTINGS: FeatureSettings = {
  sshEnabled: true,
};
function getDefaultSSHClipboardImageShortcut(platform: string | undefined): SSHClipboardImageSettings['shortcut'] {
  return platform === 'darwin' ? 'ctrl-v' : 'alt-v';
}

const DEFAULT_SSH_CLIPBOARD_IMAGE_SETTINGS: SSHClipboardImageSettings = {
  enabled: true,
  uploadLocation: 'current-working-directory',
  shortcut: getDefaultSSHClipboardImageShortcut(window.electronAPI?.platform),
  customUploadDirectory: '',
  copyRemotePathAfterUpload: true,
  maxUploadBytes: 20 * 1024 * 1024,
};

const APPEARANCE_OPACITY_OPTIONS = [0.28, 0.42, 0.62, 0.82];
const APPEARANCE_SKIN_DIM_OPTIONS = [0.08, 0.16, 0.28, 0.42, 0.56];
const APPEARANCE_SKIN_BLUR_OPTIONS = [0, 6, 12, 18];
const APPEARANCE_SKIN_MOTION_MODES: AppearanceSkinMotionMode[] = ['none', 'ambient'];

// 皮肤预设 - 每个预设包含UI颜色方案和默认背景
const APPEARANCE_SKIN_PRESETS: Array<{
  id: string;
  labelKey: TranslationKey;
  descriptionKey: TranslationKey;
  preview: string;
  skin: AppearanceSettings['skin'];
}> = [
  {
    id: 'obsidian',
    labelKey: 'settings.appearance.skin.obsidian',
    descriptionKey: 'settings.appearance.skin.obsidianDescription',
    preview: 'linear-gradient(135deg, #0b0d11 0%, #1b1f27 58%, #090b0e 100%)',
    skin: {
      presetId: 'obsidian',
      kind: 'gradient',
      gradient: 'linear-gradient(135deg, #0b0d11 0%, #1b1f27 58%, #090b0e 100%)',
      dim: 0.42,
      blur: 0,
      motion: 'none',
    },
  },
  {
    id: 'paper',
    labelKey: 'settings.appearance.skin.paper',
    descriptionKey: 'settings.appearance.skin.paperDescription',
    preview: 'radial-gradient(circle at 14% 16%, rgba(255, 255, 255, 0.98), transparent 24%), radial-gradient(circle at 82% 18%, rgba(83, 149, 255, 0.12), transparent 30%), linear-gradient(135deg, #ffffff 0%, #f7faff 48%, #ffffff 100%)',
    skin: {
      presetId: 'paper',
      kind: 'gradient',
      gradient: 'radial-gradient(circle at 14% 16%, rgba(255, 255, 255, 0.96), transparent 24%), radial-gradient(circle at 82% 18%, rgba(83, 149, 255, 0.10), transparent 30%), linear-gradient(135deg, #ffffff 0%, #f7faff 48%, #ffffff 100%)',
      dim: 0.04,
      blur: 0,
      motion: 'ambient',
    },
  },
];

const APPEARANCE_READABILITY_MODES: AppearanceReadabilityMode[] = ['balanced', 'readability', 'immersive'];

function isSameSkinPreset(currentSkin: AppearanceSettings['skin'], presetSkin: AppearanceSettings['skin']): boolean {
  if (currentSkin.kind !== presetSkin.kind) {
    return false;
  }

  if (presetSkin.kind === 'none') {
    return true;
  }

  if (presetSkin.kind === 'image') {
    return currentSkin.presetId === presetSkin.presetId && currentSkin.imagePath === presetSkin.imagePath;
  }

  return currentSkin.presetId === presetSkin.presetId && currentSkin.gradient === presetSkin.gradient;
}

function getDefaultSkinPreset() {
  return APPEARANCE_SKIN_PRESETS.find((preset) => preset.id === DEFAULT_APPEARANCE_SETTINGS.skin.presetId)
    ?? APPEARANCE_SKIN_PRESETS[0];
}

function getActiveSkinPreset(currentSkin: AppearanceSettings['skin']) {
  const presetById = APPEARANCE_SKIN_PRESETS.find((preset) => preset.id === currentSkin.presetId);
  if (presetById) {
    return presetById;
  }

  const presetByGradient = APPEARANCE_SKIN_PRESETS.find((preset) => isSameSkinPreset({
    ...currentSkin,
    kind: 'gradient',
  }, preset.skin));
  if (presetByGradient) {
    return presetByGradient;
  }

  return getDefaultSkinPreset();
}

function getNumericOptionsWithCurrent(options: number[], currentValue: number): number[] {
  if (options.includes(currentValue)) {
    return options;
  }

  return [...options, currentValue].sort((left, right) => left - right);
}

function joinClassNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

function formatSettingsTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }

  return date.toLocaleString(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function keyboardShortcutToInputValue(definition: KeyboardShortcutDefinition): string {
  return getKeyboardShortcutInputValue(definition);
}

function parseKeyboardShortcutInput(value: string): KeyboardShortcutDefinition | null {
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return null;
  }

  const doubleTapMatch = trimmedValue.match(/^double(?:\s+|\+)(.+)$/i);
  if (doubleTapMatch) {
    const key = normalizeKeyboardShortcutKey(doubleTapMatch[1], '');
    return key ? { key, doubleTap: true } : null;
  }

  const normalizedParts = trimmedValue
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.toLowerCase());

  const keyPart = normalizedParts[normalizedParts.length - 1];
  if (!keyPart) {
    return null;
  }
  const key = normalizeKeyboardShortcutKey(keyPart, '');

  const modifiers = normalizedParts.slice(0, -1)
    .map((modifier) => {
      if (modifier === 'cmd' || modifier === 'command' || modifier === 'meta') return 'meta';
      if (modifier === 'ctrl' || modifier === 'control') return 'ctrl';
      if (modifier === 'alt' || modifier === 'option') return 'alt';
      if (modifier === 'shift') return 'shift';
      return null;
    })
    .filter((modifier): modifier is NonNullable<KeyboardShortcutDefinition['modifiers']>[number] => Boolean(modifier));

  if (normalizedParts.length > 1 && modifiers.length !== normalizedParts.length - 1) {
    return null;
  }

  return {
    key,
    modifiers: modifiers.length > 0 ? modifiers : undefined,
  };
}

function AppearanceSkinPreview({ appearance }: { appearance: AppearanceSettings }) {
  const descriptor = getAppearanceBackdropDescriptor(appearance);

  return (
    <>
      <div className="absolute inset-0" style={descriptor.baseStyle} />
      {descriptor.layers.map((layer, index) => (
        <div
          key={`${appearance.skin.presetId}:${appearance.skin.kind}:${index}`}
          className={layer.className}
          style={layer.style}
        />
      ))}
      <div className="absolute inset-0 bg-black" style={descriptor.dimStyle} />
    </>
  );
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({ open, onClose }) => {
  const { language, setLanguage, t } = useI18n();
  const isWindows = window.electronAPI.platform === 'win32';
  const [ides, setIDEs] = useState<IDEConfig[]>([]);
  const [supportedIDENames, setSupportedIDENames] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState<string>('');
  const [editingIDE, setEditingIDE] = useState<IDEConfig | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [availableShells, setAvailableShells] = useState<ShellProgramOption[]>([]);

  // 快捷导航状态
  const [quickNavItems, setQuickNavItems] = useState<QuickNavItem[]>([]);
  const [editingNavItem, setEditingNavItem] = useState<QuickNavItem | null>(null);
  const [showNavDialog, setShowNavDialog] = useState(false);
  const [currentTab, setCurrentTab] = useState<SettingsTab>('general');
  const [hasVisitedPluginTab, setHasVisitedPluginTab] = useState(false);
  const [quickNavTab, setQuickNavTab] = useState<QuickNavSubTab>('ide');
  const [recentTerminalLimit, setRecentTerminalLimit] = useState(DEFAULT_RECENT_TERMINAL_LIMIT);
  const [recentTerminalLimitDraft, setRecentTerminalLimitDraft] = useState(String(DEFAULT_RECENT_TERMINAL_LIMIT));

  // StatusLine 配置状态
  const [statusLineConfig, setStatusLineConfig] = useState<StatusLineConfig>(DEFAULT_STATUSLINE_CONFIG);
  const [terminalSettings, setTerminalSettings] = useState({
    useBundledConptyDll: true,
    defaultShellProgram: '',
    fontFamily: '',
    fontSize: 14,
  });
  const [appearanceSettings, setAppearanceSettings] = useState<AppearanceSettings>(DEFAULT_APPEARANCE_SETTINGS);
  const [featureSettings, setFeatureSettings] = useState<FeatureSettings>(DEFAULT_FEATURE_SETTINGS);
  const [sshClipboardImageSettings, setSshClipboardImageSettings] = useState<SSHClipboardImageSettings>(DEFAULT_SSH_CLIPBOARD_IMAGE_SETTINGS);
  const [knownHosts, setKnownHosts] = useState<KnownHostEntry[]>([]);
  const [knownHostsLoading, setKnownHostsLoading] = useState(false);
  const [knownHostsError, setKnownHostsError] = useState<string | null>(null);
  const [removingKnownHostId, setRemovingKnownHostId] = useState<string | null>(null);
  const [browserSyncProfiles, setBrowserSyncProfiles] = useState<BrowserSyncProfile[]>([]);
  const [browserSyncState, setBrowserSyncState] = useState<BrowserSyncState>({
    enabled: false,
    platformSupported: false,
  });
  const [browserSyncLoading, setBrowserSyncLoading] = useState(false);
  const [browserSyncSyncing, setBrowserSyncSyncing] = useState(false);
  const [keyboardShortcutSettings, setKeyboardShortcutSettings] = useState<KeyboardShortcutSettings>(getDefaultKeyboardShortcuts());
  const [keyboardShortcutDrafts, setKeyboardShortcutDrafts] = useState<Record<KeyboardShortcutAction, string>>({
    quickSwitcher: keyboardShortcutToInputValue(getDefaultKeyboardShortcuts().quickSwitcher),
    quickNav: keyboardShortcutToInputValue(getDefaultKeyboardShortcuts().quickNav),
  });

  // tmux 兼容模式配置状态
  const [tmuxSettings, setTmuxSettings] = useState({
    enabled: true,
    autoInjectPath: true,
    enableForAllPanes: false,
  });

  // 加载设置
  useEffect(() => {
    if (!open) {
      setShowAddDialog(false);
      setShowNavDialog(false);
      setEditingIDE(null);
      setEditingNavItem(null);
      setKnownHostsError(null);
      setRemovingKnownHostId(null);
      return;
    }

    void loadSettings();
    void loadAvailableShells();
    void loadSupportedIDENames();
  }, [open]);

  useEffect(() => {
    if (currentTab === 'plugins') {
      setHasVisitedPluginTab(true);
    }
  }, [currentTab]);

  useEffect(() => {
    if (!open || currentTab !== 'advanced') {
      return;
    }

    void loadKnownHosts();
    void loadBrowserSyncState();
  }, [currentTab, open]);

  const loadSettings = async () => {
    try {
      const response = await window.electronAPI.getSettings();
      if (response.success && response.data) {
        const settings = response.data;

        setIDEs(settings.ides || []);
        setQuickNavItems([...(settings.quickNav?.items || [])].sort((a: QuickNavItem, b: QuickNavItem) => a.order - b.order));
        const normalizedRecentTerminalLimit = normalizeRecentTerminalLimit(settings.recentTerminalLimit);
        setRecentTerminalLimit(normalizedRecentTerminalLimit);
        setRecentTerminalLimitDraft(String(normalizedRecentTerminalLimit));
        setStatusLineConfig({
          ...DEFAULT_STATUSLINE_CONFIG,
          ...settings.statusLine,
        });
        setTerminalSettings({
          useBundledConptyDll: settings.terminal?.useBundledConptyDll ?? true,
          defaultShellProgram: settings.terminal?.defaultShellProgram ?? '',
          fontFamily: settings.terminal?.fontFamily ?? '',
          fontSize: settings.terminal?.fontSize ?? 14,
        });
        setAppearanceSettings(normalizeAppearanceSettings(settings.appearance));
        setFeatureSettings({
          ...DEFAULT_FEATURE_SETTINGS,
          ...settings.features,
        });
        setSshClipboardImageSettings({
          ...DEFAULT_SSH_CLIPBOARD_IMAGE_SETTINGS,
          shortcut: getDefaultSSHClipboardImageShortcut(window.electronAPI?.platform),
          ...settings.sshClipboardImage,
        });
        const normalizedKeyboardShortcuts = normalizeKeyboardShortcuts(settings.keyboardShortcuts);
        setKeyboardShortcutSettings(normalizedKeyboardShortcuts);
        setKeyboardShortcutDrafts({
          quickSwitcher: keyboardShortcutToInputValue(normalizedKeyboardShortcuts.quickSwitcher),
          quickNav: keyboardShortcutToInputValue(normalizedKeyboardShortcuts.quickNav),
        });
        setTmuxSettings({
          enabled: settings.tmux?.enabled ?? true,
          autoInjectPath: settings.tmux?.autoInjectPath ?? true,
          enableForAllPanes: settings.tmux?.enableForAllPanes ?? false,
        });
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  };

  const loadBrowserSyncState = async () => {
    setBrowserSyncLoading(true);
    try {
      const [profilesResponse, stateResponse] = await Promise.all([
        window.electronAPI.listBrowserSyncProfiles(),
        window.electronAPI.getBrowserSyncState(),
      ]);

      if (profilesResponse.success && profilesResponse.data) {
        setBrowserSyncProfiles(profilesResponse.data);
      }

      if (stateResponse.success && stateResponse.data) {
        setBrowserSyncState(stateResponse.data);
      }
    } catch (error) {
      console.error('Failed to load browser sync state:', error);
    } finally {
      setBrowserSyncLoading(false);
    }
  };

  const loadKnownHosts = async () => {
    setKnownHostsLoading(true);
    setKnownHostsError(null);

    try {
      const response = await window.electronAPI.listKnownHosts();
      if (response.success && response.data) {
        setKnownHosts(response.data);
        return;
      }

      setKnownHostsError(response.error || t('settings.ssh.knownHostsLoadFailed'));
    } catch (error) {
      console.error('Failed to load SSH known hosts:', error);
      setKnownHostsError(error instanceof Error ? error.message : t('settings.ssh.knownHostsLoadFailed'));
    } finally {
      setKnownHostsLoading(false);
    }
  };

  const loadSupportedIDENames = async () => {
    try {
      const response = await window.electronAPI.getSupportedIDENames();
      if (response.success && response.data) {
        setSupportedIDENames(response.data);
      }
    } catch (error) {
      console.error('Failed to load supported IDE names:', error);
    }
  };

  const loadAvailableShells = async () => {
    try {
      const response = await window.electronAPI.getAvailableShells();
      if (response.success && response.data) {
        setAvailableShells(response.data);
      }
    } catch (error) {
      console.error('Failed to load available shells:', error);
    }
  };

  const handleScanAll = async () => {
    setScanning(true);
    setScanMessage('');
    try {
      const response = await window.electronAPI.scanIDEs();
      if (response.success && response.data) {
        const scannedIDEs = response.data as IDEConfig[];
        const existingById = new Map(ides.map(ide => [ide.id, ide]));
        const mergedDetected = scannedIDEs.map(scanned => {
          const existing = existingById.get(scanned.id);
          if (!existing) {
            return scanned;
          }

          const shouldKeepCustomIcon = existing.iconSourceType === 'custom-image' && Boolean(existing.icon);

          return {
            ...scanned,
            enabled: existing.enabled,
            isCustom: existing.isCustom ?? false,
            ...(shouldKeepCustomIcon
              ? {
                  icon: existing.icon,
                  iconSourceType: existing.iconSourceType,
                  iconSourcePath: existing.iconSourcePath || existing.icon,
                  iconConfidence: existing.iconConfidence ?? 1000,
                }
              : {}),
          };
        });

        const customEntries = ides.filter(ide => ide.isCustom || !ide.detected);
        const mergedIDEs = [...mergedDetected];

        for (const customEntry of customEntries) {
          if (!mergedIDEs.some(ide => ide.id === customEntry.id)) {
            mergedIDEs.push(customEntry);
          }
        }

        setIDEs(mergedIDEs);
        setScanMessage(
          scannedIDEs.length > 0
            ? t('settings.ide.scanResultFound', { count: scannedIDEs.length })
            : t('settings.ide.scanResultEmpty')
        );

        await window.electronAPI.updateSettings({ ides: mergedIDEs });
        notifyIDESettingsUpdated();
      } else {
        setScanMessage(response.error || t('settings.ide.scanResultEmpty'));
      }
    } catch (error) {
      console.error('Failed to scan IDEs:', error);
      setScanMessage(error instanceof Error ? error.message : t('settings.ide.scanResultError'));
    } finally {
      setScanning(false);
    }
  };

  const handleToggleIDE = async (ideId: string, enabled: boolean) => {
    const updatedIDEs = ides.map(ide =>
      ide.id === ideId ? { ...ide, enabled } : ide
    );
    setIDEs(updatedIDEs);

    try {
      await window.electronAPI.updateSettings({ ides: updatedIDEs });
      // 通知其他组件刷新
      notifyIDESettingsUpdated();
    } catch (error) {
      console.error('Failed to update IDE:', error);
    }
  };

  const handleSelectIDEIcon = async (ideId: string) => {
    try {
      const currentIDE = ides.find(ide => ide.id === ideId);
      const response = await window.electronAPI.selectImageFile(currentIDE?.icon);
      if (!response?.success || !response.data) {
        return;
      }
      const selectedIcon = response.data;

      const updatedIDEs = ides.map(ide => (
        ide.id === ideId
          ? {
              ...ide,
              icon: selectedIcon,
              iconSourceType: 'custom-image' as const,
              iconSourcePath: selectedIcon,
              iconConfidence: 1000,
            }
          : ide
      ));

      setIDEs(updatedIDEs);
      await window.electronAPI.updateSettings({ ides: updatedIDEs });
      notifyIDESettingsUpdated();
    } catch (error) {
      console.error('Failed to select IDE icon:', error);
    }
  };

  const handleDeleteIDE = async (ideId: string) => {
    try {
      const response = await window.electronAPI.deleteIDEConfig(ideId);
      if (response.success && response.data) {
        setIDEs(response.data);
        // 通知其他组件刷新
        notifyIDESettingsUpdated();
      }
    } catch (error) {
      console.error('Failed to delete IDE:', error);
    }
  };

  const handleAddIDE = () => {
    setEditingIDE({
      id: '',
      name: '',
      command: '',
      path: '',
      enabled: true,
      icon: '',
      isCustom: true,
      detected: false,
    });
    setShowAddDialog(true);
  };

  const handleSaveIDE = async () => {
    if (!editingIDE || !editingIDE.name || !editingIDE.command) {
      return;
    }

    try {
      const ideToSave = {
        ...editingIDE,
        id: editingIDE.id || editingIDE.command.toLowerCase().replace(/\s+/g, '-'),
        isCustom: editingIDE.isCustom ?? true,
        detected: editingIDE.detected ?? false,
      };

      const response = await window.electronAPI.updateIDEConfig(ideToSave);
      if (response.success && response.data) {
        setIDEs(response.data);
        setShowAddDialog(false);
        setEditingIDE(null);
        // 通知其他组件刷新
        notifyIDESettingsUpdated();
      }
    } catch (error) {
      console.error('Failed to save IDE:', error);
    }
  };

  const handleScanSpecific = async (ideName: string) => {
    try {
      const response = await window.electronAPI.scanSpecificIDE(ideName);
      if (response.success && response.data) {
        setEditingIDE(prev => prev ? { ...prev, path: response.data ?? undefined } : null);
      }
    } catch (error) {
      console.error('Failed to scan specific IDE:', error);
    }
  };

  // 快捷导航处理函数
  const handleAddNavItem = () => {
    setEditingNavItem({
      id: Date.now().toString(),
      name: '',
      type: 'url',
      path: '',
      order: quickNavItems.length,
    });
    setShowNavDialog(true);
  };

  const handleEditNavItem = (item: QuickNavItem) => {
    setEditingNavItem({ ...item });
    setShowNavDialog(true);
  };

  const handleSaveNavItem = async () => {
    if (!editingNavItem || !editingNavItem.name || !editingNavItem.path) {
      return;
    }

    try {
      let updatedItems: QuickNavItem[];
      const existingIndex = quickNavItems.findIndex(item => item.id === editingNavItem.id);

      if (existingIndex >= 0) {
        // 更新现有项
        updatedItems = [...quickNavItems];
        updatedItems[existingIndex] = editingNavItem;
      } else {
        // 添加新项
        updatedItems = [...quickNavItems, editingNavItem];
      }

      // 保存到设置
      await window.electronAPI.updateSettings({
        quickNav: { items: updatedItems }
      });

      setQuickNavItems(updatedItems);
      setShowNavDialog(false);
      setEditingNavItem(null);
    } catch (error) {
      console.error('Failed to save quick nav item:', error);
    }
  };

  const handleDeleteNavItem = async (itemId: string) => {
    try {
      const updatedItems = quickNavItems.filter(item => item.id !== itemId);
      // 重新排序
      const reorderedItems = updatedItems.map((item, index) => ({
        ...item,
        order: index,
      }));

      await window.electronAPI.updateSettings({
        quickNav: { items: reorderedItems }
      });

      setQuickNavItems(reorderedItems);
    } catch (error) {
      console.error('Failed to delete quick nav item:', error);
    }
  };

  // 自动检测路径类型
  const detectPathType = (path: string): 'url' | 'folder' => {
    if (path.startsWith('http://') || path.startsWith('https://')) {
      return 'url';
    }
    return 'folder';
  };

  // 自动获取网站标题（简化版，实际需要主进程支持）
  const handlePathChange = (path: string) => {
    if (!editingNavItem) return;

    const type = detectPathType(path);
    setEditingNavItem(prev => prev ? { ...prev, path, type } : null);

    // 如果是 URL 且名称为空，尝试从 URL 提取名称
    if (type === 'url' && !editingNavItem.name) {
      try {
        const url = new URL(path);
        const hostname = url.hostname.replace('www.', '');
        setEditingNavItem(prev => prev ? { ...prev, name: hostname } : null);
      } catch (e) {
        // 忽略无效 URL
      }
    } else if (type === 'folder' && !editingNavItem.name) {
      // 从路径提取文件夹名称
      const folderName = path.split(/[/\\]/).filter(Boolean).pop() || '';
      setEditingNavItem(prev => prev ? { ...prev, name: folderName } : null);
    }
  };

  // 浏览文件夹
  const handleBrowseFolder = async () => {
    try {
      const result = await window.electronAPI.selectDirectory();
      if (result?.success && result.data) {
        handlePathChange(result.data);
      }
    } catch (error) {
      console.error('Failed to select directory:', error);
    }
  };

  // StatusLine 配置处理
  const handleStatusLineConfigChange = async (updates: Partial<StatusLineConfig>) => {
    const newConfig = { ...statusLineConfig, ...updates };
    setStatusLineConfig(newConfig);

    try {
      await window.electronAPI.updateSettings({ statusLine: newConfig });
    } catch (error) {
      console.error('Failed to update StatusLine config:', error);
    }
  };

  const handleTerminalSettingsChange = async (updates: Partial<typeof terminalSettings>) => {
    const newConfig = { ...terminalSettings, ...updates };
    setTerminalSettings(newConfig);

    try {
      await window.electronAPI.updateSettings({ terminal: newConfig });

      // 如果更新了字体或字号，通知所有终端实例
      if ('fontFamily' in updates || 'fontSize' in updates) {
        notifyTerminalSettingsUpdated({
          fontFamily: newConfig.fontFamily,
          fontSize: newConfig.fontSize,
        });
      }
    } catch (error) {
      console.error('Failed to update terminal settings:', error);
    }
  };

  const commitRecentTerminalLimit = useCallback(async (rawValue: string) => {
    const previousLimit = recentTerminalLimit;
    const nextLimit = normalizeRecentTerminalLimit(rawValue);
    setRecentTerminalLimit(nextLimit);
    setRecentTerminalLimitDraft(String(nextLimit));

    try {
      await window.electronAPI.updateSettings({ recentTerminalLimit: nextLimit });
      notifyWorkspaceSettingsUpdated({ recentTerminalLimit: nextLimit });
    } catch (error) {
      console.error('Failed to update recent terminal limit:', error);
      setRecentTerminalLimit(previousLimit);
      setRecentTerminalLimitDraft(String(previousLimit));
    }
  }, [recentTerminalLimit]);

  const handleAppearanceSettingsChange = async (updates: Partial<AppearanceSettings>) => {
    const previousConfig = appearanceSettings;
    const nextConfig = normalizeAppearanceSettings({
      ...previousConfig,
      ...updates,
      skin: updates.skin
        ? {
            ...previousConfig.skin,
            ...updates.skin,
          }
        : previousConfig.skin,
    });

    setAppearanceSettings(nextConfig);
    applyAppearanceToDocument(nextConfig);

    try {
      await window.electronAPI.updateSettings({ appearance: nextConfig });
      notifyWorkspaceSettingsUpdated({ appearance: nextConfig });
    } catch (error) {
      console.error('Failed to update appearance settings:', error);
      setAppearanceSettings(previousConfig);
      applyAppearanceToDocument(previousConfig);
    }
  };

  const handleSelectAppearanceImage = async () => {
    try {
      const response = await window.electronAPI.selectImageFile(appearanceSettings.skin.imagePath);
      if (!response?.success || !response.data) {
        console.log('Image selection cancelled or failed:', response);
        return;
      }

      const newSkin = {
        presetId: appearanceSettings.skin.presetId,
        kind: 'image' as const,
        imagePath: response.data,
        gradient: appearanceSettings.skin.gradient,
        dim: Math.min(appearanceSettings.skin.dim, 0.16),
        blur: 0,
        motion: 'none' as const,
      };
      await handleAppearanceSettingsChange({
        skin: newSkin,
      });
    } catch (error) {
      console.error('Failed to select appearance image:', error);
    }
  };

  const handleAppearancePresetChange = async (preset: typeof APPEARANCE_SKIN_PRESETS[number]) => {
    await handleAppearanceSettingsChange({
      skin: {
        ...appearanceSettings.skin,
        presetId: preset.skin.presetId,
        gradient: preset.skin.gradient,
      },
    });
  };

  const handleResetAppearanceImage = async () => {
    const activePreset = getActiveSkinPreset(appearanceSettings.skin);

    await handleAppearanceSettingsChange({
      skin: {
        ...appearanceSettings.skin,
        kind: activePreset.skin.kind,
        gradient: activePreset.skin.gradient,
        dim: activePreset.skin.dim,
        blur: activePreset.skin.blur,
        motion: activePreset.skin.motion,
      },
    });
  };

  const handleSelectCustomShell = async () => {
    try {
      const response = await window.electronAPI.selectExecutableFile();
      if (response?.success && response.data) {
        await handleTerminalSettingsChange({ defaultShellProgram: response.data });
      }
    } catch (error) {
      console.error('Failed to select custom shell:', error);
    }
  };

  const handleTmuxSettingsChange = async (updates: Partial<typeof tmuxSettings>) => {
    const newConfig = { ...tmuxSettings, ...updates };
    setTmuxSettings(newConfig);

    try {
      await window.electronAPI.updateSettings({ tmux: newConfig });
    } catch (error) {
      console.error('Failed to update tmux settings:', error);
    }
  };

  const handleFeatureSettingsChange = async (updates: Partial<FeatureSettings>) => {
    const previousConfig = featureSettings;
    const newConfig = { ...previousConfig, ...updates };
    setFeatureSettings(newConfig);

    try {
      await window.electronAPI.updateSettings({ features: newConfig });
      notifyWorkspaceSettingsUpdated({ features: newConfig });
    } catch (error) {
      console.error('Failed to update feature settings:', error);
      setFeatureSettings(previousConfig);
    }
  };

  const handleSshClipboardImageSettingsChange = async (updates: Partial<SSHClipboardImageSettings>) => {
    const previousConfig = sshClipboardImageSettings;
    const newConfig = { ...previousConfig, ...updates };
    setSshClipboardImageSettings(newConfig);

    try {
      await window.electronAPI.updateSettings({ sshClipboardImage: newConfig });
      notifyWorkspaceSettingsUpdated({ sshClipboardImage: newConfig });
    } catch (error) {
      console.error('Failed to update SSH clipboard image settings:', error);
      setSshClipboardImageSettings(previousConfig);
    }
  };

  const handleKeyboardShortcutChange = async (action: KeyboardShortcutAction, definition: KeyboardShortcutDefinition) => {
    const previousConfig = keyboardShortcutSettings;
    const nextConfig = normalizeKeyboardShortcuts({
      ...previousConfig,
      [action]: definition,
    });
    setKeyboardShortcutSettings(nextConfig);
    setKeyboardShortcutDrafts((currentDrafts) => ({
      ...currentDrafts,
      [action]: keyboardShortcutToInputValue(nextConfig[action]),
    }));

    try {
      await window.electronAPI.updateSettings({ keyboardShortcuts: nextConfig });
      notifyWorkspaceSettingsUpdated({ keyboardShortcuts: nextConfig });
    } catch (error) {
      console.error('Failed to update keyboard shortcuts:', error);
      setKeyboardShortcutSettings(previousConfig);
      setKeyboardShortcutDrafts((currentDrafts) => ({
        ...currentDrafts,
        [action]: keyboardShortcutToInputValue(previousConfig[action]),
      }));
    }
  };

  const handleResetKeyboardShortcut = async (action: KeyboardShortcutAction) => {
    const defaults = getDefaultKeyboardShortcuts();
    await handleKeyboardShortcutChange(action, defaults[action]);
  };

  const handleShortcutDraftChange = (action: KeyboardShortcutAction, value: string) => {
    setKeyboardShortcutDrafts((currentDrafts) => ({
      ...currentDrafts,
      [action]: value,
    }));
  };

  const handleShortcutDraftCommit = async (action: KeyboardShortcutAction) => {
    const parsedShortcut = parseKeyboardShortcutInput(keyboardShortcutDrafts[action]);
    if (!parsedShortcut) {
      setKeyboardShortcutDrafts((currentDrafts) => ({
        ...currentDrafts,
        [action]: keyboardShortcutToInputValue(keyboardShortcutSettings[action]),
      }));
      return;
    }

    await handleKeyboardShortcutChange(action, parsedShortcut);
  };

  const handleRemoveKnownHost = async (entryId: string) => {
    setRemovingKnownHostId(entryId);
    setKnownHostsError(null);

    try {
      const response = await window.electronAPI.removeKnownHost(entryId);
      if (!response.success) {
        throw new Error(response.error || t('settings.ssh.removeKnownHostFailed'));
      }

      setKnownHosts((previousEntries) => previousEntries.filter((entry) => entry.id !== entryId));
    } catch (error) {
      console.error('Failed to remove SSH known host:', error);
      setKnownHostsError(error instanceof Error ? error.message : t('settings.ssh.removeKnownHostFailed'));
    } finally {
      setRemovingKnownHostId(null);
    }
  };

  const handleSyncBrowserProfile = async (profileId: string) => {
    setBrowserSyncSyncing(true);
    try {
      const response = await window.electronAPI.syncBrowserProfile(profileId);
      if (response.success && response.data) {
        setBrowserSyncState(response.data);
        await window.electronAPI.updateSettings({
          browserSync: {
            enabled: response.data.enabled,
            source: 'chrome',
            profileId: response.data.profileId,
          },
        });
        notifyWorkspaceSettingsUpdated({
          browserSync: {
            enabled: response.data.enabled,
            source: 'chrome',
            profileId: response.data.profileId,
          },
        });
      }
    } catch (error) {
      console.error('Failed to sync browser profile:', error);
    } finally {
      setBrowserSyncSyncing(false);
    }
  };

  const handleToggleStatusLine = async (enabled: boolean) => {
    await handleStatusLineConfigChange({ enabled });

    if (enabled) {
      // 自动配置 Claude Code
      try {
        const response = await window.electronAPI.statusLineConfigure();
        if (!response.success) {
          console.error('Failed to configure Claude Code:', response.error);
        }
      } catch (error) {
        console.error('Failed to configure Claude Code:', error);
      }
    } else {
      // 移除 Claude Code 配置
      try {
        const response = await window.electronAPI.statusLineRemove();
        if (!response.success) {
          console.error('Failed to remove Claude Code configuration:', response.error);
        }
      } catch (error) {
        console.error('Failed to remove Claude Code configuration:', error);
      }
    }
  };

  const handleLanguageChange = useCallback(async (nextLanguage: string) => {
    await setLanguage(nextLanguage as AppLanguage);
  }, [setLanguage]);

  const formatKnownHostTimestamp = useCallback((timestamp: string) => {
    const locale = language === 'zh-CN' ? 'zh-CN' : 'en-US';
    return new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(timestamp));
  }, [language]);

  const handleSettingsOpenChange = useCallback((nextOpen: boolean) => {
    if (!nextOpen) {
      onClose();
    }
  }, [onClose]);

  const handleAddDialogChange = useCallback((nextOpen: boolean) => {
    setShowAddDialog(nextOpen);
    if (!nextOpen) {
      setEditingIDE(null);
    }
  }, []);

  const handleNavDialogChange = useCallback((nextOpen: boolean) => {
    setShowNavDialog(nextOpen);
    if (!nextOpen) {
      setEditingNavItem(null);
    }
  }, []);

  const navigationTabs = [
    {
      value: 'general' as SettingsTab,
      label: t('settings.tab.general'),
      icon: Languages,
    },
    {
      value: 'appearance' as SettingsTab,
      label: t('settings.tab.appearance'),
      icon: Palette,
    },
    {
      value: 'shortcuts' as SettingsTab,
      label: t('settings.tab.shortcuts'),
      icon: Command,
    },
    {
      value: 'quicknav' as SettingsTab,
      label: t('settings.tab.quickNav'),
      icon: Compass,
    },
    {
      value: 'plugins' as SettingsTab,
      label: t('settings.tab.statusLine'),
      icon: Plug,
    },
    {
      value: 'chat' as SettingsTab,
      label: t('settings.tab.chat'),
      icon: Monitor,
    },
    {
      value: 'remote' as SettingsTab,
      label: t('settings.tab.remote'),
      icon: Smartphone,
    },
    {
      value: 'advanced' as SettingsTab,
      label: t('settings.tab.advanced'),
      icon: Wrench,
    },
  ];
  const recommendedShell = availableShells.find((shell) => shell.isDefault);
  const autoShellTarget = recommendedShell?.path ?? '';
  const detectedShellOptions = availableShells.slice();
  const currentShellValue = terminalSettings.defaultShellProgram.trim();
  const matchedShell = detectedShellOptions.find((shell) => (
    shell.path === currentShellValue || shell.command === currentShellValue
  ));
  const selectedShellOptions = currentShellValue && !matchedShell
    ? [
        {
          command: currentShellValue,
          path: currentShellValue,
          isDefault: false,
        },
        ...detectedShellOptions,
      ]
    : detectedShellOptions;
  const filteredShellOptions = autoShellTarget
    ? selectedShellOptions.filter((shell) => shell.path !== autoShellTarget)
    : selectedShellOptions;
  const effectiveSelectedShell = matchedShell?.path ?? currentShellValue;
  const selectedShellValue = !effectiveSelectedShell || effectiveSelectedShell === autoShellTarget
    ? AUTO_SHELL_OPTION_VALUE
    : effectiveSelectedShell;
  const activeSkinPreset = getActiveSkinPreset(appearanceSettings.skin);
  const skinDimOptions = getNumericOptionsWithCurrent(APPEARANCE_SKIN_DIM_OPTIONS, appearanceSettings.skin.dim);
  const skinBlurOptions = getNumericOptionsWithCurrent(APPEARANCE_SKIN_BLUR_OPTIONS, appearanceSettings.skin.blur);
  const appearanceOpacityOptions = getNumericOptionsWithCurrent(APPEARANCE_OPACITY_OPTIONS, appearanceSettings.terminalOpacity);
  const settingsPanelSelectContentClassName = `z-[10000] ${idePopupSelectContentClassName}`;
  const settingsPanelSelectTriggerClassName = idePopupSelectTriggerClassName;
  const settingsPanelSelectItemClassName = idePopupSelectItemClassName;
  const settingsPanelInputClassName = idePopupInputClassName;
  const settingsPanelCompactSelectTriggerClassName = `${idePopupSelectTriggerClassName} !h-9 !rounded-lg !px-3 !py-0`;
  const settingsPanelEmptyStateClassName = `${idePopupEmptyStateClassName} px-6 py-16 text-center`;
  const settingsPanelSecondaryButtonClassName = `${idePopupSecondaryButtonClassName} h-11 rounded-2xl px-4`;
  const settingsPanelPrimaryButtonClassName = `${idePopupActionButtonClassName('primary')} h-11 rounded-2xl px-4`;
  const settingsPanelCompactSecondaryButtonClassName = `${idePopupSecondaryButtonClassName} h-9 rounded-lg px-3 text-sm`;
  const settingsPanelCompactPrimaryButtonClassName = `${idePopupActionButtonClassName('primary')} h-9 min-w-0 rounded-lg px-3 text-sm`;
  const settingsPanelCompactSwitchRootClassName = 'relative h-6 w-10 flex-shrink-0 rounded-full bg-[rgb(var(--muted))] transition-colors data-[state=checked]:bg-[rgb(var(--primary))] disabled:cursor-not-allowed disabled:opacity-70';
  const settingsPanelCompactSwitchThumbClassName = 'block h-5 w-5 translate-x-0.5 rounded-full bg-[color-mix(in_srgb,rgb(var(--background))_92%,transparent)] shadow-sm transition-transform data-[state=checked]:translate-x-[18px]';
  const settingsPanelSmallIconButtonClassName = `${idePopupIconButtonClassName} h-10 w-10 rounded-2xl`;
  const settingsPanelBadgeClassName = 'rounded-full border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--secondary))_72%,transparent)] px-2 py-0.5 text-[11px] font-medium text-[rgb(var(--muted-foreground))]';
  const settingsPanelInfoCardClassName = 'rounded-[14px] border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--card))_78%,transparent)] p-3 transition-colors hover:border-[rgb(var(--primary))]';
  const settingsPanelSegmentedListClassName = 'inline-flex rounded-lg border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--card))_78%,transparent)] p-0.5';
  const settingsPanelSegmentedTriggerClassName = 'rounded-md px-3 py-1.5 text-sm font-medium text-[rgb(var(--muted-foreground))] transition-colors hover:text-[rgb(var(--foreground))] data-[state=active]:bg-[rgb(var(--accent))] data-[state=active]:text-[rgb(var(--primary))]';
  const settingsPanelPresetCardClassName = (selected: boolean) => joinClassNames(
    'rounded-[14px] border p-3 text-left transition-all',
    selected
      ? 'border-[rgb(var(--primary))] bg-[rgb(var(--accent))]'
      : 'border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--secondary))_72%,transparent)] hover:border-[rgb(var(--ring))] hover:bg-[rgb(var(--accent))]',
  );
  const settingsPanelPreviewSurfaceClassName = 'relative h-20 overflow-hidden rounded-xl border border-black/10 bg-[color-mix(in_srgb,rgb(var(--background))_88%,transparent)]';
  const settingsPanelSidebarIconClassName = joinClassNames(
    'flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-xl text-[rgb(var(--muted-foreground))] transition-colors',
    'bg-[color-mix(in_srgb,rgb(var(--secondary))_72%,transparent)] group-data-[state=active]:bg-[color-mix(in_srgb,rgb(var(--card))_82%,transparent)] group-data-[state=active]:text-[rgb(var(--primary))]',
  );
  return (
    <Dialog.Root open={open} onOpenChange={handleSettingsOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[9999] bg-black/75 backdrop-blur-sm animate-fade-in" />
        <Dialog.Content className={`fixed left-1/2 top-1/2 z-[9999] flex h-[72vh] w-[94vw] max-h-[720px] max-w-6xl -translate-x-1/2 -translate-y-1/2 flex-col animate-scale-in ${idePopupSurfaceClassName}`} >
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(var(--primary),0.16),_transparent_34%),radial-gradient(circle_at_bottom_right,_rgba(var(--accent),0.18),_transparent_32%)]" />

          <div className="relative flex items-center justify-between border-b border-[rgb(var(--border))] px-6 py-3">
            <div>
              <Dialog.Title className="text-lg font-semibold text-[rgb(var(--foreground))]">
                {t('settings.title')}
              </Dialog.Title>
              <Dialog.Description className="sr-only">
                {t('settings.panelDescription')}
              </Dialog.Description>
            </div>

            <Dialog.Close asChild>
              <button className={`${idePopupIconButtonClassName} h-10 w-10 rounded-2xl`} >
                <X size={18} />
              </button>
            </Dialog.Close>
          </div>

          <Tabs.Root value={currentTab} onValueChange={(value) => setCurrentTab(value as SettingsTab)} className="relative flex min-h-0 flex-1 overflow-hidden">
            <aside className="flex w-[168px] flex-col border-r border-[rgb(var(--border))] bg-[rgb(var(--sidebar))]">
              <Tabs.List className="flex flex-1 flex-col gap-1.5 p-2.5">
                {navigationTabs.map(({ value, label, icon: Icon }) => (
                  <Tabs.Trigger
                    key={value}
                    value={value}
                    className="group rounded-xl border border-transparent bg-transparent px-3 py-2 text-left transition-colors hover:bg-[rgb(var(--accent))] data-[state=active]:border-[rgb(var(--border))] data-[state=active]:bg-[rgb(var(--accent))]"
                  >
                    <div className="flex items-center gap-3">
                      <div className={settingsPanelSidebarIconClassName}>
                        <Icon size={16} />
                      </div>
                      <div className="min-w-0 text-sm font-semibold text-[rgb(var(--foreground))] group-data-[state=active]:text-[rgb(var(--primary))]">{label}</div>
                    </div>
                  </Tabs.Trigger>
                ))}
              </Tabs.List>
            </aside>

            <div className="flex-1 overflow-hidden bg-[linear-gradient(180deg,color-mix(in_srgb,rgb(var(--background))_88%,transparent)_0%,color-mix(in_srgb,rgb(var(--background))_96%,transparent)_100%)]">
              <Tabs.Content value="general" className="h-full overflow-y-auto px-6 py-6 data-[state=inactive]:hidden">
                <div className="mx-auto max-w-4xl space-y-4">
                  <CompactSettingsSection
                    title={t('settings.tab.general')}
                    help={t('settings.general.pageDescription')}
                    icon={<Languages size={15} />}
                  >
                    <CompactSettingRow
                      label={t('settings.general.languageTitle')}
                      help={t('settings.general.languageDescription')}
                    >
                      <Select.Root value={language} onValueChange={handleLanguageChange}>
                        <Select.Trigger
                          aria-label={t('settings.general.languageTitle')}
                          className={`max-w-[360px] ${settingsPanelCompactSelectTriggerClassName}`}
                        >
                          <Select.Value />
                          <Select.Icon>
                            <ChevronDown size={15} className="text-[rgb(var(--muted-foreground))]" />
                          </Select.Icon>
                        </Select.Trigger>

                        <Select.Portal>
                          <Select.Content
                            position="popper"
                            side="bottom"
                            align="start"
                            sideOffset={6}
                            className={`w-[var(--radix-select-trigger-width)] ${settingsPanelSelectContentClassName}`}
                          >
                            <Select.Viewport className="p-1">
                              <Select.Item value="zh-CN" className={settingsPanelSelectItemClassName}>
                                <Select.ItemText>{t('settings.language.zhCN')}</Select.ItemText>
                              </Select.Item>
                              <Select.Item value="en-US" className={settingsPanelSelectItemClassName}>
                                <Select.ItemText>{t('settings.language.enUS')}</Select.ItemText>
                              </Select.Item>
                            </Select.Viewport>
                          </Select.Content>
                        </Select.Portal>
                      </Select.Root>
                    </CompactSettingRow>

                    <CompactSettingRow
                      label={t('settings.general.recentTerminalLimitLabel')}
                      htmlFor="recent-terminal-limit"
                      help={t('settings.general.recentTerminalLimitDescription')}
                    >
                      <input
                        id="recent-terminal-limit"
                        type="number"
                        min={MIN_RECENT_TERMINAL_LIMIT}
                        max={MAX_RECENT_TERMINAL_LIMIT}
                        step={1}
                        value={recentTerminalLimitDraft}
                        onChange={(event) => setRecentTerminalLimitDraft(event.target.value)}
                        onBlur={(event) => {
                          void commitRecentTerminalLimit(event.currentTarget.value);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            (event.currentTarget as HTMLInputElement).blur();
                          }

                          if (event.key === 'Escape') {
                            event.preventDefault();
                            setRecentTerminalLimitDraft(String(recentTerminalLimit));
                            (event.currentTarget as HTMLInputElement).blur();
                          }
                        }}
                        className={`w-full max-w-[160px] ${settingsPanelInputClassName}`}
                        aria-label={t('settings.general.recentTerminalLimitLabel')}
                      />
                    </CompactSettingRow>

                    <CompactSettingRow
                      label={t('settings.general.defaultShellLabel')}
                      htmlFor="default-shell-program"
                      help={(
                        <>
                          <div>{t('settings.general.defaultShellDescription')}</div>
                          <div className="mt-2">{t('settings.general.defaultShellHint')}</div>
                        </>
                      )}
                    >
                      <div className="flex w-full max-w-[560px] flex-col gap-2 sm:flex-row">
                        <Select.Root
                          value={selectedShellValue}
                          onValueChange={(value) => handleTerminalSettingsChange({
                            defaultShellProgram: value === AUTO_SHELL_OPTION_VALUE ? '' : value,
                          })}
                        >
                          <Select.Trigger
                            id="default-shell-program"
                            aria-label={t('settings.general.defaultShellLabel')}
                            className={settingsPanelCompactSelectTriggerClassName}
                          >
                            <Select.Value placeholder={t('settings.general.defaultShellPlaceholder')} />
                            <Select.Icon>
                              <ChevronDown size={15} className="text-[rgb(var(--muted-foreground))]" />
                            </Select.Icon>
                          </Select.Trigger>

                          <Select.Portal>
                            <Select.Content
                              position="popper"
                              side="bottom"
                              align="start"
                              sideOffset={6}
                              className={`w-[var(--radix-select-trigger-width)] ${settingsPanelSelectContentClassName}`}
                            >
                              <Select.Viewport className="p-1">
                                <Select.Item value={AUTO_SHELL_OPTION_VALUE} className={settingsPanelSelectItemClassName}>
                                  <Select.ItemText>
                                    {autoShellTarget
                                      ? t('settings.general.defaultShellAutoOption', { shell: autoShellTarget })
                                      : t('settings.general.defaultShellAutoFallback')}
                                  </Select.ItemText>
                                  <Select.ItemIndicator>
                                    <Check size={14} />
                                  </Select.ItemIndicator>
                                </Select.Item>
                                {filteredShellOptions.map((shell) => (
                                  <Select.Item
                                    key={shell.path}
                                    value={shell.path}
                                    className={settingsPanelSelectItemClassName}
                                  >
                                    <Select.ItemText>
                                      {shell.path}
                                    </Select.ItemText>
                                    <Select.ItemIndicator>
                                      <Check size={14} />
                                    </Select.ItemIndicator>
                                  </Select.Item>
                                ))}
                              </Select.Viewport>
                            </Select.Content>
                          </Select.Portal>
                        </Select.Root>

                        <button
                          type="button"
                          onClick={handleSelectCustomShell}
                          className={settingsPanelCompactSecondaryButtonClassName}
                        >
                          {t('settings.general.defaultShellCustomButton')}
                        </button>
                      </div>
                    </CompactSettingRow>

                    <CompactSettingRow
                      label={t('settings.general.fontFamilyLabel')}
                      htmlFor="terminal-font-family"
                      help={t('settings.general.terminalFontDescription')}
                    >
                      <Select.Root
                        value={terminalSettings.fontFamily || 'default'}
                        onValueChange={(value) => handleTerminalSettingsChange({
                          fontFamily: value === 'default' ? '' : value,
                        })}
                      >
                        <Select.Trigger
                          id="terminal-font-family"
                          aria-label={t('settings.general.fontFamilyLabel')}
                          className={`max-w-[360px] ${settingsPanelCompactSelectTriggerClassName}`}
                        >
                          <Select.Value />
                          <Select.Icon>
                            <ChevronDown size={15} className="text-[rgb(var(--muted-foreground))]" />
                          </Select.Icon>
                        </Select.Trigger>

                        <Select.Portal>
                          <Select.Content
                            position="popper"
                            side="bottom"
                            align="start"
                            sideOffset={6}
                            className={`w-[var(--radix-select-trigger-width)] ${settingsPanelSelectContentClassName}`}
                          >
                            <Select.Viewport className="p-1">
                              <Select.Item value="default" className={settingsPanelSelectItemClassName}>
                                <Select.ItemText>默认</Select.ItemText>
                              </Select.Item>
                              <Select.Item value="JetBrains Mono" className={settingsPanelSelectItemClassName}>
                                <Select.ItemText>JetBrains Mono</Select.ItemText>
                              </Select.Item>
                              <Select.Item value="Fira Code" className={settingsPanelSelectItemClassName}>
                                <Select.ItemText>Fira Code</Select.ItemText>
                              </Select.Item>
                              <Select.Item value="Cascadia Code" className={settingsPanelSelectItemClassName}>
                                <Select.ItemText>Cascadia Code</Select.ItemText>
                              </Select.Item>
                              <Select.Item value="Consolas" className={settingsPanelSelectItemClassName}>
                                <Select.ItemText>Consolas</Select.ItemText>
                              </Select.Item>
                            </Select.Viewport>
                          </Select.Content>
                        </Select.Portal>
                      </Select.Root>
                    </CompactSettingRow>

                    <CompactSettingRow
                      label={t('settings.general.fontSizeLabel')}
                      htmlFor="terminal-font-size"
                      help={t('settings.general.terminalFontDescription')}
                    >
                      <Select.Root
                        value={String(terminalSettings.fontSize)}
                        onValueChange={(value) => handleTerminalSettingsChange({
                          fontSize: Number(value),
                        })}
                      >
                        <Select.Trigger
                          id="terminal-font-size"
                          aria-label={t('settings.general.fontSizeLabel')}
                          className={`max-w-[180px] ${settingsPanelCompactSelectTriggerClassName}`}
                        >
                          <Select.Value />
                          <Select.Icon>
                            <ChevronDown size={15} className="text-[rgb(var(--muted-foreground))]" />
                          </Select.Icon>
                        </Select.Trigger>

                        <Select.Portal>
                          <Select.Content
                            position="popper"
                            side="bottom"
                            align="start"
                            sideOffset={6}
                            className={`w-[var(--radix-select-trigger-width)] ${settingsPanelSelectContentClassName}`}
                          >
                            <Select.Viewport className="p-1">
                              {[12, 13, 14, 15, 16, 18, 20].map((size) => (
                                <Select.Item
                                  key={size}
                                  value={String(size)}
                                  className={settingsPanelSelectItemClassName}
                                >
                                  <Select.ItemText>{size}</Select.ItemText>
                                </Select.Item>
                              ))}
                            </Select.Viewport>
                          </Select.Content>
                        </Select.Portal>
                      </Select.Root>
                    </CompactSettingRow>
                  </CompactSettingsSection>
                </div>
              </Tabs.Content>

              <Tabs.Content value="appearance" className="h-full overflow-y-auto px-6 py-6 data-[state=inactive]:hidden">
                <div className="mx-auto max-w-5xl space-y-4">
                  <CompactSettingsSection
                    title={t('settings.appearance.skinTitle')}
                    help={t('settings.appearance.skinDescription')}
                    icon={<Wallpaper size={15} />}
                    contentClassName="p-4"
                    divided={false}
                  >

                    <div className="grid gap-4 md:grid-cols-2">
                      {APPEARANCE_SKIN_PRESETS.map((preset) => {
                        const selected = activeSkinPreset.id === preset.id;

                        return (
                          <button
                            key={preset.id}
                            type="button"
                            aria-pressed={selected}
                            onClick={() => {
                              void handleAppearancePresetChange(preset);
                            }}
                            className={settingsPanelPresetCardClassName(selected)}
                          >
                            <div className={settingsPanelPreviewSurfaceClassName}>
                              <AppearanceSkinPreview
                                appearance={{
                                  ...appearanceSettings,
                                  reduceMotion: true,
                                  skin: preset.skin,
                                }}
                              />
                              <div
                                className="absolute inset-x-3 bottom-3 rounded-xl border border-white/10 px-3 py-2 text-xs shadow-[0_12px_28px_rgba(0,0,0,0.18)]"
                                style={{
                                  ...getAppearanceSkinStyle({
                                    ...appearanceSettings,
                                    skin: preset.skin,
                                  }),
                                  background: 'color-mix(in srgb, rgb(var(--card)) 78%, transparent)',
                                  backdropFilter: 'blur(10px)',
                                  filter: undefined,
                                }}
                              >
                                <div className="font-semibold text-[rgb(var(--foreground))]">{t('settings.appearance.previewTitle')}</div>
                              </div>
                            </div>
                            <div className="mt-3 flex items-center justify-between gap-3">
                              <div className="min-w-0 text-sm font-semibold text-[rgb(var(--foreground))]">
                                {t(preset.labelKey)}
                              </div>
                              {selected && (
                                <span className="inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-[rgb(var(--primary))] text-[rgb(var(--primary-foreground))]">
                                  <Check size={14} />
                                </span>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    <div className="mt-4 overflow-hidden rounded-xl border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--secondary))_54%,transparent)]">
                      <CompactSettingRow
                        label={t('settings.appearance.customImageTitle')}
                        help={(
                          <>
                            <div>{t('settings.appearance.customImageDescription')}</div>
                            {appearanceSettings.skin.imagePath && (
                              <div className="mt-2 break-all font-mono">{appearanceSettings.skin.imagePath}</div>
                            )}
                          </>
                        )}
                      >
                        <div className="flex flex-wrap justify-end gap-2">
                          <button
                            type="button"
                            onClick={handleSelectAppearanceImage}
                            className={settingsPanelCompactSecondaryButtonClassName}
                          >
                            {t('settings.appearance.customImageButton')}
                          </button>
                          {appearanceSettings.skin.kind === 'image' && (
                            <button
                              type="button"
                              onClick={() => {
                                void handleResetAppearanceImage();
                              }}
                              className={settingsPanelCompactSecondaryButtonClassName}
                            >
                              {t('settings.appearance.customImageReset')}
                            </button>
                          )}
                        </div>
                      </CompactSettingRow>
                    </div>
                  </CompactSettingsSection>

                  <CompactSettingsSection
                    title={t('settings.appearance.readabilityTitle')}
                    help={t('settings.appearance.readabilityDescription')}
                    icon={<SunMoon size={15} />}
                  >
                    <CompactSettingRow
                      label={t('settings.appearance.readabilityLabel')}
                      htmlFor="appearance-readability"
                      help={t(`settings.appearance.readability.${appearanceSettings.readabilityMode}Description`)}
                    >
                      <Select.Root
                        value={appearanceSettings.readabilityMode}
                        onValueChange={(value) => handleAppearanceSettingsChange({ readabilityMode: value as AppearanceReadabilityMode })}
                      >
                        <Select.Trigger
                          id="appearance-readability"
                          aria-label={t('settings.appearance.readabilityLabel')}
                          className={`max-w-[320px] ${settingsPanelCompactSelectTriggerClassName}`}
                        >
                          <Select.Value />
                          <Select.Icon>
                            <ChevronDown size={15} className="text-[rgb(var(--muted-foreground))]" />
                          </Select.Icon>
                        </Select.Trigger>

                        <Select.Portal>
                          <Select.Content
                            position="popper"
                            side="bottom"
                            align="start"
                            sideOffset={6}
                            className={`w-[var(--radix-select-trigger-width)] ${settingsPanelSelectContentClassName}`}
                          >
                            <Select.Viewport className="p-1">
                              {APPEARANCE_READABILITY_MODES.map((mode) => (
                                <Select.Item
                                  key={mode}
                                  value={mode}
                                  className={settingsPanelSelectItemClassName}
                                >
                                  <Select.ItemText>{t(`settings.appearance.readability.${mode}`)}</Select.ItemText>
                                  <Select.ItemIndicator>
                                    <Check size={14} />
                                  </Select.ItemIndicator>
                                </Select.Item>
                              ))}
                            </Select.Viewport>
                          </Select.Content>
                        </Select.Portal>
                      </Select.Root>
                    </CompactSettingRow>

                    <CompactSettingRow
                      label={t('settings.appearance.opacityLabel')}
                      htmlFor="appearance-terminal-opacity"
                      help={t('settings.appearance.opacityDescription')}
                    >
                      <Select.Root
                        value={String(appearanceSettings.terminalOpacity)}
                        onValueChange={(value) => handleAppearanceSettingsChange({ terminalOpacity: Number(value) })}
                      >
                        <Select.Trigger
                          id="appearance-terminal-opacity"
                          aria-label={t('settings.appearance.opacityLabel')}
                          className={`max-w-[180px] ${settingsPanelCompactSelectTriggerClassName}`}
                        >
                          <Select.Value />
                          <Select.Icon>
                            <ChevronDown size={15} className="text-[rgb(var(--muted-foreground))]" />
                          </Select.Icon>
                        </Select.Trigger>

                        <Select.Portal>
                          <Select.Content
                            position="popper"
                            side="bottom"
                            align="start"
                            sideOffset={6}
                            className={`w-[var(--radix-select-trigger-width)] ${settingsPanelSelectContentClassName}`}
                          >
                            <Select.Viewport className="p-1">
                              {appearanceOpacityOptions.map((value) => (
                                <Select.Item
                                  key={value}
                                  value={String(value)}
                                  className={settingsPanelSelectItemClassName}
                                >
                                  <Select.ItemText>{t('settings.appearance.opacityValue', { value: Math.round(value * 100) })}</Select.ItemText>
                                  <Select.ItemIndicator>
                                    <Check size={14} />
                                  </Select.ItemIndicator>
                                </Select.Item>
                              ))}
                            </Select.Viewport>
                          </Select.Content>
                        </Select.Portal>
                      </Select.Root>
                    </CompactSettingRow>

                    <CompactSettingRow
                      label={t('settings.appearance.skinDimLabel')}
                      htmlFor="appearance-skin-dim"
                      help={t('settings.appearance.skinDimDescription')}
                    >
                      <Select.Root
                        value={String(appearanceSettings.skin.dim)}
                        onValueChange={(value) => handleAppearanceSettingsChange({
                          skin: {
                            ...appearanceSettings.skin,
                            dim: Number(value),
                          },
                        })}
                      >
                        <Select.Trigger
                          id="appearance-skin-dim"
                          aria-label={t('settings.appearance.skinDimLabel')}
                          className={`max-w-[180px] ${settingsPanelCompactSelectTriggerClassName}`}
                        >
                          <Select.Value />
                          <Select.Icon>
                            <ChevronDown size={15} className="text-[rgb(var(--muted-foreground))]" />
                          </Select.Icon>
                        </Select.Trigger>

                        <Select.Portal>
                          <Select.Content
                            position="popper"
                            side="bottom"
                            align="start"
                            sideOffset={6}
                            className={`w-[var(--radix-select-trigger-width)] ${settingsPanelSelectContentClassName}`}
                          >
                            <Select.Viewport className="p-1">
                              {skinDimOptions.map((value) => (
                                <Select.Item
                                  key={value}
                                  value={String(value)}
                                  className={settingsPanelSelectItemClassName}
                                >
                                  <Select.ItemText>{t('settings.appearance.skinDimValue', { value: Math.round(value * 100) })}</Select.ItemText>
                                  <Select.ItemIndicator>
                                    <Check size={14} />
                                  </Select.ItemIndicator>
                                </Select.Item>
                              ))}
                            </Select.Viewport>
                          </Select.Content>
                        </Select.Portal>
                      </Select.Root>
                    </CompactSettingRow>

                    <CompactSettingRow
                      label={t('settings.appearance.skinBlurLabel')}
                      htmlFor="appearance-skin-blur"
                      help={t('settings.appearance.skinBlurDescription')}
                    >
                      <Select.Root
                        value={String(appearanceSettings.skin.blur)}
                        onValueChange={(value) => handleAppearanceSettingsChange({
                          skin: {
                            ...appearanceSettings.skin,
                            blur: Number(value),
                          },
                        })}
                      >
                        <Select.Trigger
                          id="appearance-skin-blur"
                          aria-label={t('settings.appearance.skinBlurLabel')}
                          className={`max-w-[180px] ${settingsPanelCompactSelectTriggerClassName}`}
                        >
                          <Select.Value />
                          <Select.Icon>
                            <ChevronDown size={15} className="text-[rgb(var(--muted-foreground))]" />
                          </Select.Icon>
                        </Select.Trigger>

                        <Select.Portal>
                          <Select.Content
                            position="popper"
                            side="bottom"
                            align="start"
                            sideOffset={6}
                            className={`w-[var(--radix-select-trigger-width)] ${settingsPanelSelectContentClassName}`}
                          >
                            <Select.Viewport className="p-1">
                              {skinBlurOptions.map((value) => (
                                <Select.Item
                                  key={value}
                                  value={String(value)}
                                  className={settingsPanelSelectItemClassName}
                                >
                                  <Select.ItemText>{t('settings.appearance.skinBlurValue', { value })}</Select.ItemText>
                                  <Select.ItemIndicator>
                                    <Check size={14} />
                                  </Select.ItemIndicator>
                                </Select.Item>
                              ))}
                            </Select.Viewport>
                          </Select.Content>
                        </Select.Portal>
                      </Select.Root>
                    </CompactSettingRow>

                    <CompactSettingRow
                      label={t('settings.appearance.skinMotionLabel')}
                      htmlFor="appearance-skin-motion"
                      help={t('settings.appearance.skinMotionDescription')}
                    >
                      <Select.Root
                        value={appearanceSettings.skin.motion}
                        onValueChange={(value) => handleAppearanceSettingsChange({
                          skin: {
                            ...appearanceSettings.skin,
                            motion: value as AppearanceSkinMotionMode,
                          },
                        })}
                      >
                        <Select.Trigger
                          id="appearance-skin-motion"
                          aria-label={t('settings.appearance.skinMotionLabel')}
                          className={`max-w-[220px] ${settingsPanelCompactSelectTriggerClassName}`}
                        >
                          <Select.Value />
                          <Select.Icon>
                            <ChevronDown size={15} className="text-[rgb(var(--muted-foreground))]" />
                          </Select.Icon>
                        </Select.Trigger>

                        <Select.Portal>
                          <Select.Content
                            position="popper"
                            side="bottom"
                            align="start"
                            sideOffset={6}
                            className={`w-[var(--radix-select-trigger-width)] ${settingsPanelSelectContentClassName}`}
                          >
                            <Select.Viewport className="p-1">
                              {APPEARANCE_SKIN_MOTION_MODES.map((mode) => (
                                <Select.Item
                                  key={mode}
                                  value={mode}
                                  className={settingsPanelSelectItemClassName}
                                >
                                  <Select.ItemText>{t(`settings.appearance.skinMotion.${mode}`)}</Select.ItemText>
                                  <Select.ItemIndicator>
                                    <Check size={14} />
                                  </Select.ItemIndicator>
                                </Select.Item>
                              ))}
                            </Select.Viewport>
                          </Select.Content>
                        </Select.Portal>
                      </Select.Root>
                    </CompactSettingRow>

                    <CompactSettingRow
                      label={t('settings.appearance.reduceMotionTitle')}
                      help={t('settings.appearance.reduceMotionDescription')}
                    >
                      <Switch.Root
                        checked={appearanceSettings.reduceMotion}
                        onCheckedChange={(checked) => handleAppearanceSettingsChange({ reduceMotion: checked })}
                        aria-label={t('settings.appearance.reduceMotionTitle')}
                        className={settingsPanelCompactSwitchRootClassName}
                      >
                        <Switch.Thumb className={settingsPanelCompactSwitchThumbClassName} />
                      </Switch.Root>
                    </CompactSettingRow>
                  </CompactSettingsSection>
                </div>
              </Tabs.Content>

              <Tabs.Content value="shortcuts" className="h-full overflow-y-auto px-6 py-6 data-[state=inactive]:hidden">
                <div className="mx-auto max-w-4xl space-y-4">
                  <CompactSettingsSection
                    title={t('settings.shortcuts.title')}
                    help={t('settings.shortcuts.pageDescription')}
                    icon={<Command size={15} />}
                  >
                    {KEYBOARD_SHORTCUT_ACTIONS.map((action) => {
                      const shortcut = keyboardShortcutSettings[action];
                      const inputId = `keyboard-shortcut-${action}`;
                      const titleKey = action === 'quickSwitcher'
                        ? 'settings.shortcuts.quickSwitcherTitle'
                        : 'settings.shortcuts.quickNavTitle';
                      const descriptionKey = action === 'quickSwitcher'
                        ? 'settings.shortcuts.quickSwitcherDescription'
                        : 'settings.shortcuts.quickNavDescription';

                      return (
                        <CompactSettingRow
                          key={action}
                          label={t(titleKey as TranslationKey)}
                          htmlFor={inputId}
                          help={t(descriptionKey as TranslationKey)}
                          controlClassName="flex-wrap justify-end"
                        >
                          <div className="flex min-w-[220px] items-center justify-end">
                            <span className={settingsPanelBadgeClassName}>
                              {formatKeyboardShortcut(shortcut, window.electronAPI.platform)}
                            </span>
                          </div>
                          <input
                            id={inputId}
                            value={keyboardShortcutDrafts[action]}
                            onBlur={() => {
                              void handleShortcutDraftCommit(action);
                            }}
                            onChange={(event) => handleShortcutDraftChange(action, event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                (event.currentTarget as HTMLInputElement).blur();
                              }

                              if (event.key === 'Escape') {
                                event.preventDefault();
                                handleShortcutDraftChange(action, keyboardShortcutToInputValue(keyboardShortcutSettings[action]));
                                (event.currentTarget as HTMLInputElement).blur();
                              }
                            }}
                            className={`w-full max-w-[260px] ${settingsPanelInputClassName}`}
                            placeholder={t('settings.shortcuts.inputPlaceholder')}
                            aria-label={t(titleKey as TranslationKey)}
                          />
                          <button
                            type="button"
                            onClick={() => {
                              void handleResetKeyboardShortcut(action);
                            }}
                            className={settingsPanelCompactSecondaryButtonClassName}
                          >
                            {t('settings.shortcuts.reset')}
                          </button>
                        </CompactSettingRow>
                      );
                    })}
                  </CompactSettingsSection>
                </div>
              </Tabs.Content>

              <Tabs.Content value="quicknav" className="h-full overflow-y-auto px-6 py-6 data-[state=inactive]:hidden">
                <div className="mx-auto max-w-5xl space-y-4">
                  <Tabs.Root value={quickNavTab} onValueChange={(value) => setQuickNavTab(value as QuickNavSubTab)} className="space-y-4">
                    <div className="flex items-center justify-between gap-3">
                      <Tabs.List className={settingsPanelSegmentedListClassName}>
                        <Tabs.Trigger
                          value="ide"
                          className={settingsPanelSegmentedTriggerClassName}
                        >
                          {t('settings.quickNav.ideTab')}
                        </Tabs.Trigger>
                        <Tabs.Trigger
                          value="custom"
                          className={settingsPanelSegmentedTriggerClassName}
                        >
                          {t('settings.quickNav.customTab')}
                        </Tabs.Trigger>
                      </Tabs.List>
                    </div>

                    <Tabs.Content value="ide" className="space-y-4 data-[state=inactive]:hidden">
                      <CompactSettingsSection
                        title={t('settings.quickNav.ideTab')}
                        help={t('settings.quickNav.ideDescription')}
                        icon={<Monitor size={15} />}
                        actions={(
                          <>
                            {scanMessage && (
                              <span className="max-w-[320px] truncate text-xs text-[rgb(var(--muted-foreground))]" title={scanMessage}>
                                {scanMessage}
                              </span>
                            )}
                            <button
                              onClick={handleScanAll}
                              disabled={scanning}
                              className={settingsPanelCompactPrimaryButtonClassName}
                            >
                              <Search size={15} />
                              {scanning ? t('common.loading') : t('settings.ide.scan')}
                            </button>
                            <button
                              onClick={handleAddIDE}
                              className={settingsPanelCompactSecondaryButtonClassName}
                            >
                              <Plus size={15} />
                              {t('settings.ide.addCustom')}
                            </button>
                          </>
                        )}
                        contentClassName="p-4"
                        divided={false}
                      >

                      {ides.length === 0 ? (
                        <div className={settingsPanelEmptyStateClassName}>
                          <Monitor size={40} className="mx-auto text-[rgb(var(--muted-foreground))] opacity-50" />
                          <p className="mt-5 text-lg font-medium text-[rgb(var(--foreground))]">{t('settings.ide.emptyTitle')}</p>
                          <p className="mt-2 text-sm text-[rgb(var(--muted-foreground))]">{t('settings.ide.emptyDescription')}</p>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {ides.map((ide) => (
                            <div
                              key={ide.id}
                              className={settingsPanelInfoCardClassName}
                            >
                              <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                                <div className="flex min-w-0 flex-1 items-center gap-3">
                                  <button
                                    type="button"
                                    onClick={() => handleSelectIDEIcon(ide.id)}
                                    className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--secondary))_72%,transparent)] transition-colors hover:border-[rgb(var(--primary))] hover:bg-[rgb(var(--accent))]"
                                    title="点击自定义 IDE Logo"
                                  >
                                    <IDEIcon icon={ide.icon || ''} size={24} className="text-[rgb(var(--foreground))]" />
                                  </button>
                                  <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <h3 className="text-sm font-semibold text-[rgb(var(--foreground))]">{ide.name}</h3>
                                      {ide.detected && ide.path && (
                                        <span className="rounded-full border border-[rgba(168,170,88,0.20)] bg-[rgba(168,170,88,0.10)] px-2 py-0.5 text-[11px] font-medium text-[rgb(var(--primary))]">
                                          {t('settings.ide.found')}
                                        </span>
                                      )}
                                      {ide.source && (
                                        <span className={settingsPanelBadgeClassName}>
                                          {t('settings.ide.source', { source: ide.source })}
                                        </span>
                                      )}
                                      {ide.version && (
                                        <span className={settingsPanelBadgeClassName}>
                                          {t('settings.ide.version', { version: ide.version })}
                                        </span>
                                      )}
                                    </div>
                                    <p className="mt-1 text-xs text-[rgb(var(--muted-foreground))]">{t('settings.ide.commandPrefix', { command: ide.command })}</p>
                                    {(ide.installPath || ide.path) && (
                                      <p className="mt-1 truncate text-xs text-[rgb(var(--muted-foreground))]" title={ide.installPath || ide.path}>
                                        {ide.installPath || ide.path}
                                      </p>
                                    )}
                                  </div>
                                </div>

                                <div className="flex items-center justify-end gap-3">
                                  <Switch.Root
                                    checked={ide.enabled}
                                    onCheckedChange={(checked) => handleToggleIDE(ide.id, checked)}
                                    className={settingsPanelCompactSwitchRootClassName}
                                  >
                                    <Switch.Thumb className={settingsPanelCompactSwitchThumbClassName} />
                                  </Switch.Root>
                                  <button
                                    onClick={() => {
                                      setEditingIDE(ide);
                                      setShowAddDialog(true);
                                    }}
                                    className={settingsPanelSmallIconButtonClassName}
                                    title={t('common.edit')}
                                  >
                                    <Edit2 size={16} />
                                  </button>
                                  <button
                                    onClick={() => handleDeleteIDE(ide.id)}
                                    className="flex h-10 w-10 items-center justify-center rounded-2xl border border-[rgba(255,92,92,0.14)] bg-[rgba(255,92,92,0.08)] text-[rgb(var(--muted-foreground))] transition-colors hover:border-[rgba(255,92,92,0.34)] hover:bg-[rgba(255,92,92,0.14)] hover:text-[rgb(var(--foreground))]"
                                    title={t('common.delete')}
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      </CompactSettingsSection>
                    </Tabs.Content>

                    <Tabs.Content value="custom" className="space-y-4 data-[state=inactive]:hidden">
                      <CompactSettingsSection
                        title={t('settings.quickNav.customTab')}
                        help={t('settings.quickNav.customDescription')}
                        icon={<Compass size={15} />}
                        actions={(
                          <button
                            onClick={handleAddNavItem}
                            className={settingsPanelCompactPrimaryButtonClassName}
                          >
                            <Plus size={15} />
                            {t('settings.quickNav.add')}
                          </button>
                        )}
                        contentClassName="p-4"
                        divided={false}
                      >

                      {quickNavItems.length === 0 ? (
                        <div className={settingsPanelEmptyStateClassName}>
                          <Globe size={40} className="mx-auto text-[rgb(var(--muted-foreground))] opacity-50" />
                          <p className="mt-5 text-lg font-medium text-[rgb(var(--foreground))]">{t('settings.quickNav.emptyTitle')}</p>
                          <p className="mt-2 text-sm text-[rgb(var(--muted-foreground))]">{t('settings.quickNav.emptyDescription')}</p>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {quickNavItems.map((item) => (
                            <div
                              key={item.id}
                              className={settingsPanelInfoCardClassName}
                            >
                              <div className="flex flex-col gap-3 md:flex-row md:items-center">
                                <div className="flex min-w-0 flex-1 items-center gap-3">
                                  <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border ${
                                    item.type === 'url'
                                      ? 'border-[rgb(var(--border))] bg-[rgb(var(--accent))] text-[rgb(var(--primary))]'
                                      : 'border-[rgb(var(--border))] bg-[rgb(var(--accent))] text-[rgb(var(--primary))]'
                                  }`}>
                                    {item.type === 'url' ? <Globe size={18} /> : <Folder size={18} />}
                                  </div>
                                  <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <h3 className="text-sm font-semibold text-[rgb(var(--foreground))]">{item.name}</h3>
                                      <span className={settingsPanelBadgeClassName}>
                                        {item.type === 'url' ? t('common.url') : t('common.folder')}
                                      </span>
                                    </div>
                                    <p className="mt-1 truncate text-xs text-[rgb(var(--muted-foreground))]" title={item.path}>
                                      {item.path}
                                    </p>
                                  </div>
                                </div>

                                <div className="flex items-center justify-end gap-3">
                                  <button
                                    onClick={() => handleEditNavItem(item)}
                                    className={settingsPanelSmallIconButtonClassName}
                                    title={t('common.edit')}
                                  >
                                    <Edit2 size={16} />
                                  </button>
                                  <button
                                    onClick={() => handleDeleteNavItem(item.id)}
                                    className="flex h-10 w-10 items-center justify-center rounded-2xl border border-[rgba(255,92,92,0.14)] bg-[rgba(255,92,92,0.08)] text-[rgb(var(--muted-foreground))] transition-colors hover:border-[rgba(255,92,92,0.34)] hover:bg-[rgba(255,92,92,0.14)] hover:text-[rgb(var(--foreground))]"
                                    title={t('common.delete')}
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      </CompactSettingsSection>
                    </Tabs.Content>
                  </Tabs.Root>
                </div>
              </Tabs.Content>

              <Tabs.Content value="plugins" forceMount className="h-full overflow-y-auto px-8 py-8 data-[state=inactive]:hidden">
                {hasVisitedPluginTab ? (
                  <PluginCenter
                    statusLineConfig={statusLineConfig}
                    onToggleStatusLine={handleToggleStatusLine}
                    onStatusLineConfigChange={handleStatusLineConfigChange}
                  />
                ) : null}
              </Tabs.Content>

              <Tabs.Content value="chat" className="h-full overflow-y-auto px-8 py-8 data-[state=inactive]:hidden">
                <ChatSettingsTab />
              </Tabs.Content>

              <Tabs.Content value="remote" className="h-full overflow-y-auto px-6 py-6 data-[state=inactive]:hidden">
                <RemoteSettingsTab />
              </Tabs.Content>

              <Tabs.Content value="advanced" className="h-full overflow-y-auto px-6 py-6 data-[state=inactive]:hidden">
                <div className="mx-auto max-w-5xl space-y-4">
                  <CompactSettingsSection
                    title={t('settings.advanced.sshSection')}
                    help={t('settings.advanced.sshDescription')}
                    icon={<Globe size={15} />}
                  >
                    <CompactSettingRow
                      label={t('settings.ssh.enableTitle')}
                      help={t('settings.ssh.enableDescription')}
                    >
                      <Switch.Root
                        checked={featureSettings.sshEnabled}
                        onCheckedChange={(checked) => handleFeatureSettingsChange({ sshEnabled: checked })}
                        aria-label={t('settings.ssh.enableTitle')}
                        className={settingsPanelCompactSwitchRootClassName}
                      >
                        <Switch.Thumb className={settingsPanelCompactSwitchThumbClassName} />
                      </Switch.Root>
                    </CompactSettingRow>

                    <CompactSettingRow
                      label={t('settings.ssh.clipboardImageEnableTitle')}
                      help={t('settings.ssh.clipboardImageEnableDescription')}
                    >
                      <Switch.Root
                        checked={sshClipboardImageSettings.enabled}
                        onCheckedChange={(checked) => handleSshClipboardImageSettingsChange({ enabled: checked })}
                        aria-label={t('settings.ssh.clipboardImageEnableTitle')}
                        className={settingsPanelCompactSwitchRootClassName}
                      >
                        <Switch.Thumb className={settingsPanelCompactSwitchThumbClassName} />
                      </Switch.Root>
                    </CompactSettingRow>

                    <CompactSettingRow
                      label={t('settings.ssh.clipboardImageShortcutTitle')}
                      help={t('settings.ssh.clipboardImageShortcutDescription')}
                      disabled={!sshClipboardImageSettings.enabled}
                    >
                      <Select.Root
                        value={sshClipboardImageSettings.shortcut}
                        onValueChange={(value) => handleSshClipboardImageSettingsChange({
                          shortcut: value as SSHClipboardImageSettings['shortcut'],
                        })}
                        disabled={!sshClipboardImageSettings.enabled}
                      >
                        <Select.Trigger
                          aria-label={t('settings.ssh.clipboardImageShortcutTitle')}
                          className={`max-w-[300px] ${settingsPanelCompactSelectTriggerClassName}`}
                        >
                          <Select.Value />
                          <Select.Icon>
                            <ChevronDown size={15} className="text-[rgb(var(--muted-foreground))]" />
                          </Select.Icon>
                        </Select.Trigger>

                        <Select.Portal>
                          <Select.Content
                            position="popper"
                            side="bottom"
                            align="start"
                            sideOffset={6}
                            className={`w-[var(--radix-select-trigger-width)] ${settingsPanelSelectContentClassName}`}
                          >
                            <Select.Viewport className="p-1">
                              <Select.Item value="alt-v" className={settingsPanelSelectItemClassName}>
                                <Select.ItemText>{t('settings.ssh.clipboardImageShortcutAltV')}</Select.ItemText>
                              </Select.Item>
                              <Select.Item value="ctrl-v" className={settingsPanelSelectItemClassName}>
                                <Select.ItemText>{t('settings.ssh.clipboardImageShortcutCtrlV')}</Select.ItemText>
                              </Select.Item>
                              <Select.Item value="ctrl-alt-v" className={settingsPanelSelectItemClassName}>
                                <Select.ItemText>{t('settings.ssh.clipboardImageShortcutCtrlAltV')}</Select.ItemText>
                              </Select.Item>
                              <Select.Item value="cmd-shift-v" className={settingsPanelSelectItemClassName}>
                                <Select.ItemText>{t('settings.ssh.clipboardImageShortcutCmdShiftV')}</Select.ItemText>
                              </Select.Item>
                            </Select.Viewport>
                          </Select.Content>
                        </Select.Portal>
                      </Select.Root>
                    </CompactSettingRow>

                    <CompactSettingRow
                      label={t('settings.ssh.clipboardImageUploadLocationTitle')}
                      help={t('settings.ssh.clipboardImageUploadLocationDescription')}
                      disabled={!sshClipboardImageSettings.enabled}
                    >
                      <Select.Root
                        value={sshClipboardImageSettings.uploadLocation}
                        onValueChange={(value) => handleSshClipboardImageSettingsChange({
                          uploadLocation: value as SSHClipboardImageSettings['uploadLocation'],
                        })}
                        disabled={!sshClipboardImageSettings.enabled}
                      >
                        <Select.Trigger
                          aria-label={t('settings.ssh.clipboardImageUploadLocationTitle')}
                          className={`max-w-[300px] ${settingsPanelCompactSelectTriggerClassName}`}
                        >
                          <Select.Value />
                          <Select.Icon>
                            <ChevronDown size={15} className="text-[rgb(var(--muted-foreground))]" />
                          </Select.Icon>
                        </Select.Trigger>

                        <Select.Portal>
                          <Select.Content
                            position="popper"
                            side="bottom"
                            align="start"
                            sideOffset={6}
                            className={`w-[var(--radix-select-trigger-width)] ${settingsPanelSelectContentClassName}`}
                          >
                            <Select.Viewport className="p-1">
                              <Select.Item value="current-working-directory" className={settingsPanelSelectItemClassName}>
                                <Select.ItemText>{t('settings.ssh.clipboardImageUploadLocationCurrent')}</Select.ItemText>
                              </Select.Item>
                              <Select.Item value="temporary-directory" className={settingsPanelSelectItemClassName}>
                                <Select.ItemText>{t('settings.ssh.clipboardImageUploadLocationTemp')}</Select.ItemText>
                              </Select.Item>
                              <Select.Item value="custom-directory" className={settingsPanelSelectItemClassName}>
                                <Select.ItemText>{t('settings.ssh.clipboardImageUploadLocationCustom')}</Select.ItemText>
                              </Select.Item>
                            </Select.Viewport>
                          </Select.Content>
                        </Select.Portal>
                      </Select.Root>
                    </CompactSettingRow>

                    {sshClipboardImageSettings.uploadLocation === 'custom-directory' && (
                      <CompactSettingRow
                        label={t('settings.ssh.clipboardImageCustomDirectoryTitle')}
                        htmlFor="ssh-clipboard-custom-directory"
                        help={t('settings.ssh.clipboardImageCustomDirectoryDescription')}
                        disabled={!sshClipboardImageSettings.enabled}
                      >
                        <input
                          id="ssh-clipboard-custom-directory"
                          type="text"
                          value={sshClipboardImageSettings.customUploadDirectory ?? ''}
                          disabled={!sshClipboardImageSettings.enabled}
                          onChange={(event) => {
                            void handleSshClipboardImageSettingsChange({ customUploadDirectory: event.target.value });
                          }}
                          className={`max-w-[360px] ${settingsPanelInputClassName}`}
                        />
                      </CompactSettingRow>
                    )}

                    <CompactSettingRow
                      label={t('settings.ssh.clipboardImageCopyPathTitle')}
                      help={t('settings.ssh.clipboardImageCopyPathDescription')}
                      disabled={!sshClipboardImageSettings.enabled}
                    >
                      <Switch.Root
                        checked={sshClipboardImageSettings.copyRemotePathAfterUpload}
                        disabled={!sshClipboardImageSettings.enabled}
                        onCheckedChange={(checked) => handleSshClipboardImageSettingsChange({ copyRemotePathAfterUpload: checked })}
                        aria-label={t('settings.ssh.clipboardImageCopyPathTitle')}
                        className={settingsPanelCompactSwitchRootClassName}
                      >
                        <Switch.Thumb className={settingsPanelCompactSwitchThumbClassName} />
                      </Switch.Root>
                    </CompactSettingRow>

                    <CompactSettingRow
                      label={t('settings.ssh.clipboardImageMaxSizeTitle')}
                      htmlFor="ssh-clipboard-max-upload-mb"
                      help={t('settings.ssh.clipboardImageMaxSizeDescription')}
                      disabled={!sshClipboardImageSettings.enabled}
                    >
                      <input
                        id="ssh-clipboard-max-upload-mb"
                        type="number"
                        min={1}
                        max={200}
                        step={1}
                        value={Math.max(1, Math.round((sshClipboardImageSettings.maxUploadBytes ?? DEFAULT_SSH_CLIPBOARD_IMAGE_SETTINGS.maxUploadBytes ?? 0) / 1024 / 1024))}
                        disabled={!sshClipboardImageSettings.enabled}
                        onChange={(event) => {
                          const mb = Math.max(1, Number(event.target.value || 1));
                          void handleSshClipboardImageSettingsChange({ maxUploadBytes: mb * 1024 * 1024 });
                        }}
                        className={`max-w-[120px] ${settingsPanelInputClassName}`}
                      />
                    </CompactSettingRow>

                    <div className="px-4 py-3">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2">
                          <h4 className="truncate text-sm font-semibold text-[rgb(var(--foreground))]">{t('settings.ssh.knownHostsTitle')}</h4>
                          <span className="rounded-full border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--secondary))_64%,transparent)] px-2 py-0.5 text-[11px] text-[rgb(var(--muted-foreground))]">
                            {knownHosts.length}
                          </span>
                        </div>

                        {knownHostsLoading && (
                          <div className="rounded-full border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--card))_78%,transparent)] px-3 py-1 text-xs font-medium text-[rgb(var(--muted-foreground))]">
                            {t('common.loading')}
                          </div>
                        )}
                      </div>

                      {knownHostsError && (
                        <p className="mb-3 text-sm text-[rgb(var(--foreground))]">{knownHostsError}</p>
                      )}

                      {knownHosts.length === 0 ? (
                        <div className={`${idePopupEmptyStateClassName} px-5 py-8 text-center`} >
                          <Globe size={28} className="mx-auto text-[rgb(var(--muted-foreground))] opacity-50" />
                          <p className="mt-3 text-sm font-medium text-[rgb(var(--foreground))]">{t('settings.ssh.emptyTitle')}</p>
                          <p className="mt-1 text-xs text-[rgb(var(--muted-foreground))]">{t('settings.ssh.emptyDescription')}</p>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {knownHosts.map((entry) => {
                            const entryTarget = `${entry.host}:${entry.port}`;
                            const isRemoving = removingKnownHostId === entry.id;

                            return (
                              <div
                                key={entry.id}
                                className="rounded-xl border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--background))_86%,transparent)] px-3 py-2.5"
                              >
                                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                                  <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <h5 className="text-sm font-semibold text-[rgb(var(--foreground))]">{entryTarget}</h5>
                                      <span className="rounded-full border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--card))_78%,transparent)] px-2 py-0.5 text-[11px] font-medium text-[rgb(var(--muted-foreground))]">
                                        {entry.algorithm}
                                      </span>
                                    </div>
                                    <p className="mt-2 break-all font-mono text-xs text-[rgb(var(--foreground))]">
                                      {t('settings.ssh.fingerprint')}: {entry.digest}
                                    </p>
                                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[rgb(var(--muted-foreground))]">
                                      <span>{t('settings.ssh.addedAt')}: {formatKnownHostTimestamp(entry.createdAt)}</span>
                                      <span>{t('settings.ssh.updatedAt')}: {formatKnownHostTimestamp(entry.updatedAt)}</span>
                                    </div>
                                  </div>

                                  <button
                                    type="button"
                                    onClick={() => handleRemoveKnownHost(entry.id)}
                                    disabled={isRemoving}
                                    aria-label={t('settings.ssh.removeKnownHostAria', { host: entry.host, port: entry.port })}
                                    className="inline-flex h-9 items-center justify-center rounded-lg border border-[rgba(255,92,92,0.14)] bg-[rgba(255,92,92,0.08)] px-3 text-sm font-medium text-[rgb(var(--muted-foreground))] transition-colors hover:border-[rgba(255,92,92,0.34)] hover:bg-[rgba(255,92,92,0.14)] hover:text-[rgb(var(--foreground))] disabled:cursor-not-allowed disabled:opacity-70"
                                  >
                                    {isRemoving ? t('common.loading') : t('settings.ssh.removeKnownHost')}
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </CompactSettingsSection>

                  <CompactSettingsSection
                    title={t('settings.browserSync.title')}
                    help={t('settings.browserSync.description')}
                    icon={<Globe size={15} />}
                  >
                    <CompactSettingRow
                      label={t('settings.browserSync.platform')}
                      help={t('settings.browserSync.platformDescription')}
                    >
                      <span className="text-sm text-[rgb(var(--muted-foreground))]">
                        {browserSyncState.platformSupported ? t('settings.browserSync.supported') : t('settings.browserSync.unsupported')}
                      </span>
                    </CompactSettingRow>

                    <CompactSettingRow
                      label={t('settings.browserSync.currentProfile')}
                      help={t('settings.browserSync.currentProfileDescription')}
                    >
                      <span className="max-w-[360px] truncate text-sm text-[rgb(var(--foreground))]">
                        {browserSyncState.profileName ?? browserSyncState.profileId ?? t('common.unknown')}
                      </span>
                    </CompactSettingRow>

                    <CompactSettingRow
                      label={t('settings.browserSync.lastSync')}
                      help={t('settings.browserSync.lastSyncDescription')}
                    >
                      <span className="text-sm text-[rgb(var(--muted-foreground))]">
                        {browserSyncState.lastSyncedAt ? formatSettingsTimestamp(browserSyncState.lastSyncedAt) : t('settings.browserSync.neverSynced')}
                      </span>
                    </CompactSettingRow>

                    <div className="px-4 py-3">
                      {!browserSyncState.platformSupported ? (
                        <div className={`${idePopupEmptyStateClassName} px-5 py-6 text-center`}>
                          <p className="text-sm text-[rgb(var(--muted-foreground))]">{t('settings.browserSync.unsupportedDescription')}</p>
                        </div>
                      ) : browserSyncLoading ? (
                        <div className="text-sm text-[rgb(var(--muted-foreground))]">{t('common.loading')}</div>
                      ) : browserSyncProfiles.length === 0 ? (
                        <div className={`${idePopupEmptyStateClassName} px-5 py-6 text-center`}>
                          <p className="text-sm text-[rgb(var(--muted-foreground))]">{t('settings.browserSync.emptyProfiles')}</p>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {browserSyncProfiles.map((profile) => (
                            <div
                              key={profile.id}
                              className="flex items-center justify-between gap-3 rounded-xl border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--background))_86%,transparent)] px-3 py-2.5"
                            >
                              <div className="min-w-0">
                                <div className="truncate text-sm font-medium text-[rgb(var(--foreground))]">{profile.name}</div>
                                <div className="mt-1 truncate text-xs text-[rgb(var(--muted-foreground))]">
                                  {profile.email ?? profile.id}
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  void handleSyncBrowserProfile(profile.id);
                                }}
                                disabled={browserSyncSyncing}
                                className={settingsPanelCompactSecondaryButtonClassName}
                              >
                                {browserSyncSyncing && browserSyncState.profileId === profile.id ? t('common.loading') : t('settings.browserSync.syncAction')}
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      {browserSyncState.lastSyncError ? (
                        <p className="mt-3 text-sm text-[rgb(var(--foreground))]">{browserSyncState.lastSyncError}</p>
                      ) : null}
                    </div>
                  </CompactSettingsSection>

                  <CompactSettingsSection
                    title={t('settings.advanced.generalSection')}
                    help={t('settings.advanced.generalDescription')}
                    icon={<Wrench size={15} />}
                  >
                    {isWindows ? (
                      <CompactSettingRow
                        label={t('settings.general.bundledConptyTitle')}
                        help={t('settings.general.bundledConptyDescription')}
                      >
                        <Switch.Root
                          checked={terminalSettings.useBundledConptyDll}
                          onCheckedChange={(checked) => handleTerminalSettingsChange({ useBundledConptyDll: checked })}
                          aria-label={t('settings.general.bundledConptyTitle')}
                          className={settingsPanelCompactSwitchRootClassName}
                        >
                          <Switch.Thumb className={settingsPanelCompactSwitchThumbClassName} />
                        </Switch.Root>
                      </CompactSettingRow>
                    ) : (
                      <div className={`${idePopupEmptyStateClassName} m-4 p-4`}>
                        <div className="text-sm font-semibold text-[rgb(var(--foreground))]">{t('settings.advanced.windowsOnlyTitle')}</div>
                        <p className="mt-1 text-xs leading-5 text-[rgb(var(--muted-foreground))]">{t('settings.advanced.windowsOnlyDescription')}</p>
                      </div>
                    )}
                  </CompactSettingsSection>

                  <CompactSettingsSection
                    title={t('settings.advanced.tmuxSection')}
                    help={t('settings.advanced.tmuxDescription')}
                    icon={<Command size={15} />}
                  >
                    <CompactSettingRow
                      label={t('settings.tmux.enableTitle')}
                      help={t('settings.tmux.enableDescription')}
                    >
                      <Switch.Root
                        checked={tmuxSettings.enabled}
                        onCheckedChange={(checked) => handleTmuxSettingsChange({ enabled: checked })}
                        aria-label={t('settings.tmux.enableTitle')}
                        className={settingsPanelCompactSwitchRootClassName}
                      >
                        <Switch.Thumb className={settingsPanelCompactSwitchThumbClassName} />
                      </Switch.Root>
                    </CompactSettingRow>

                    <div className={`px-4 py-3 ${!tmuxSettings.enabled ? 'opacity-50' : ''}`}>
                      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[rgba(168,170,88,0.24)] bg-[rgba(168,170,88,0.10)] px-3 py-2">
                        <div className="text-sm font-medium text-[rgb(var(--primary))]">{t('settings.tmux.agentTeamsEnvTitle')}</div>
                        <code className="rounded-lg border border-[rgba(var(--primary),0.24)] bg-[color-mix(in_srgb,rgb(var(--card))_78%,transparent)] px-2 py-1 text-xs text-[rgb(var(--foreground))]">
                          CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1
                        </code>
                      </div>
                    </div>

                    <CompactSettingRow
                      label={t('settings.tmux.autoInjectPathTitle')}
                      help={t('settings.tmux.autoInjectPathDescription')}
                      disabled={!tmuxSettings.enabled}
                    >
                      <Switch.Root
                        checked={tmuxSettings.autoInjectPath}
                        disabled={!tmuxSettings.enabled}
                        onCheckedChange={(checked) => handleTmuxSettingsChange({ autoInjectPath: checked })}
                        aria-label={t('settings.tmux.autoInjectPathTitle')}
                        className={settingsPanelCompactSwitchRootClassName}
                      >
                        <Switch.Thumb className={settingsPanelCompactSwitchThumbClassName} />
                      </Switch.Root>
                    </CompactSettingRow>

                    <CompactSettingRow
                      label={t('settings.tmux.enableForAllPanesTitle')}
                      help={t('settings.tmux.enableForAllPanesDescription')}
                      disabled={!tmuxSettings.enabled}
                    >
                      <Switch.Root
                        checked={tmuxSettings.enableForAllPanes}
                        disabled={!tmuxSettings.enabled}
                        onCheckedChange={(checked) => handleTmuxSettingsChange({ enableForAllPanes: checked })}
                        aria-label={t('settings.tmux.enableForAllPanesTitle')}
                        className={settingsPanelCompactSwitchRootClassName}
                      >
                        <Switch.Thumb className={settingsPanelCompactSwitchThumbClassName} />
                      </Switch.Root>
                    </CompactSettingRow>
                  </CompactSettingsSection>
                </div>
              </Tabs.Content>
            </div>
          </Tabs.Root>
        </Dialog.Content>
      </Dialog.Portal>

      <Dialog.Root open={showAddDialog} onOpenChange={handleAddDialogChange}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[10000] bg-black/60 backdrop-blur-sm" />
          <Dialog.Content className={`fixed left-1/2 top-1/2 z-[10001] w-[92vw] max-w-[520px] -translate-x-1/2 -translate-y-1/2 p-6 ${idePopupSurfaceClassName}`} >
            <Dialog.Title className="text-xl font-semibold text-[rgb(var(--foreground))]">
              {editingIDE?.id ? t('settings.ideDialog.editTitle') : t('settings.ideDialog.addTitle')}
            </Dialog.Title>

            <div className="mt-6 space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-[rgb(var(--foreground))]">{t('settings.ideDialog.nameLabel')}</label>
                <Select.Root
                  value={editingIDE?.name || ''}
                  onValueChange={(value) => {
                    setEditingIDE((prev) => (prev ? { ...prev, name: value } : null));
                    handleScanSpecific(value);
                  }}
                >
                  <Select.Trigger className={settingsPanelSelectTriggerClassName}>
                    <Select.Value placeholder={t('settings.ideDialog.namePlaceholder')} />
                    <Select.Icon>
                      <ChevronDown size={16} />
                    </Select.Icon>
                  </Select.Trigger>
                  <Select.Portal>
                    <Select.Content className={settingsPanelSelectContentClassName}>
                      <Select.Viewport className="p-1">
                        {supportedIDENames.map((name) => (
                          <Select.Item
                            key={name}
                            value={name}
                            className={settingsPanelSelectItemClassName}
                          >
                            <Select.ItemText>{name}</Select.ItemText>
                            <Select.ItemIndicator>
                              <Check size={14} />
                            </Select.ItemIndicator>
                          </Select.Item>
                        ))}
                      </Select.Viewport>
                    </Select.Content>
                  </Select.Portal>
                </Select.Root>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-[rgb(var(--foreground))]">{t('settings.ideDialog.commandLabel')}</label>
                <input
                  type="text"
                  value={editingIDE?.command || ''}
                  onChange={(event) => setEditingIDE((prev) => (prev ? { ...prev, command: event.target.value } : null))}
                  placeholder={t('settings.ideDialog.commandPlaceholder')}
                  className={settingsPanelInputClassName}
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-[rgb(var(--foreground))]">{t('settings.ideDialog.pathLabel')}</label>
                <input
                  type="text"
                  value={editingIDE?.path || ''}
                  onChange={(event) => setEditingIDE((prev) => (prev ? { ...prev, path: event.target.value } : null))}
                  placeholder={t('settings.ideDialog.pathPlaceholder')}
                  className={settingsPanelInputClassName}
                />
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                onClick={() => handleAddDialogChange(false)}
                className={settingsPanelSecondaryButtonClassName}
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleSaveIDE}
                disabled={!editingIDE?.name || !editingIDE?.command}
                className={settingsPanelPrimaryButtonClassName}
              >
                {t('common.save')}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={showNavDialog} onOpenChange={handleNavDialogChange}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[10000] bg-black/60 backdrop-blur-sm" />
          <Dialog.Content className={`fixed left-1/2 top-1/2 z-[10001] w-[92vw] max-w-[520px] -translate-x-1/2 -translate-y-1/2 p-6 ${idePopupSurfaceClassName}`} >
            <Dialog.Title className="text-xl font-semibold text-[rgb(var(--foreground))]">
              {editingNavItem?.id && quickNavItems.find((item) => item.id === editingNavItem.id)
                ? t('settings.quickNavDialog.editTitle')
                : t('settings.quickNavDialog.addTitle')}
            </Dialog.Title>

            <div className="mt-6 space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-[rgb(var(--foreground))]">{t('settings.quickNavDialog.pathLabel')}</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={editingNavItem?.path || ''}
                    onChange={(event) => handlePathChange(event.target.value)}
                    placeholder={t('settings.quickNavDialog.pathPlaceholder')}
                    className={`flex-1 ${settingsPanelInputClassName}`} 
                  />
                  <button
                    type="button"
                    onClick={handleBrowseFolder}
                    className={`${idePopupIconButtonClassName} h-[50px] w-[50px] rounded-2xl`} 
                    title={t('settings.quickNavDialog.browseFolder')}
                  >
                    <FolderOpen size={18} />
                  </button>
                </div>
                {editingNavItem?.path && (
                  <p className="mt-2 text-xs text-[rgb(var(--muted-foreground))]">
                    {t('settings.quickNavDialog.detectedAs', {
                      type: editingNavItem.type === 'url' ? t('common.url') : t('common.folder'),
                    })}
                  </p>
                )}
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-[rgb(var(--foreground))]">{t('settings.quickNavDialog.nameLabel')}</label>
                <input
                  type="text"
                  value={editingNavItem?.name || ''}
                  onChange={(event) => setEditingNavItem((prev) => (prev ? { ...prev, name: event.target.value } : null))}
                  placeholder={t('settings.quickNavDialog.namePlaceholder')}
                  className={settingsPanelInputClassName}
                />
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                onClick={() => handleNavDialogChange(false)}
                className={settingsPanelSecondaryButtonClassName}
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleSaveNavItem}
                disabled={!editingNavItem?.name || !editingNavItem?.path}
                className={settingsPanelPrimaryButtonClassName}
              >
                {t('common.save')}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </Dialog.Root>
  );
};
