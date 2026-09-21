import type { CSSProperties } from 'react';
import type { Settings } from '../../shared/types/workspace';
import type { AppearanceSettings, AppearanceSkinPresetId } from '../../shared/types/appearance';
import { normalizeImagePath, toAppImageUrl } from '../../shared/utils/appImage';
import { DEFAULT_APPEARANCE_SETTINGS, normalizeAppearanceSettings } from '../../shared/utils/appearance';

interface AppearanceBackdropLayer {
  className: string;
  style?: CSSProperties;
}

interface AppearanceBackdropDescriptor {
  baseStyle: CSSProperties;
  layers: AppearanceBackdropLayer[];
  dimStyle: CSSProperties;
}

interface AppearancePresetDefinition {
  app: Record<string, string>;
  terminal: Record<string, string>;
}

export const appearanceTitlebarSurfaceStyle: CSSProperties = {
  background: 'var(--appearance-titlebar-background)',
  backdropFilter: 'var(--appearance-titlebar-backdrop-filter)',
};

// 皮肤预设定义 - 每个预设包含UI颜色方案和终端颜色
const APPEARANCE_PRESET_DEFINITIONS: Record<AppearanceSkinPresetId, AppearancePresetDefinition> = {
  obsidian: {
    app: {
      background: '7 8 10',
      foreground: '242 242 242',
      card: '18 19 23',
      secondary: '24 25 30',
      muted: '34 35 42',
      mutedForeground: '161 161 170',
      accent: '42 44 52',
      border: '54 56 66',
      primary: '168 170 88',
      primaryForeground: '7 8 10',
      sidebar: '12 13 16',
      titlebar: '46 46 46',
      titlebarForeground: '236 236 236',
    },
    terminal: {
      background: '#08090c',
      foreground: '#d7d7d7',
      cursor: '#f2f2f2',
      cursorAccent: '#08090c',
      selection: 'rgba(215, 215, 215, 0.28)',
      black: '#08090c',
      red: '#ff5f6d',
      green: '#4fd66e',
      yellow: '#e4c85f',
      blue: '#6aa7ff',
      magenta: '#d981ff',
      cyan: '#65d6e8',
      white: '#d7d7d7',
      brightBlack: '#7a7f8c',
      brightRed: '#ff7c87',
      brightGreen: '#72f093',
      brightYellow: '#f4e08b',
      brightBlue: '#8fbeff',
      brightMagenta: '#e7a2ff',
      brightCyan: '#8ceaf4',
      brightWhite: '#ffffff',
    },
  },
  paper: {
    app: {
      background: '252 253 255',
      foreground: '38 44 54',
      card: '255 255 255',
      secondary: '248 250 253',
      muted: '241 245 250',
      mutedForeground: '102 111 125',
      accent: '231 238 247',
      border: '214 221 230',
      primary: '53 116 240',
      primaryForeground: '255 255 255',
      sidebar: '249 251 253',
      titlebar: '250 251 253',
      titlebarForeground: '34 41 52',
    },
    terminal: {
      background: '#ffffff',
      foreground: '#1f2329',
      cursor: '#3574f0',
      cursorAccent: '#ffffff',
      selection: 'rgba(53, 116, 240, 0.18)',
      black: '#1f2329',
      red: '#c75450',
      green: '#4e8f4d',
      yellow: '#aa7a21',
      blue: '#3574f0',
      magenta: '#8b5cf6',
      cyan: '#1f8f9d',
      white: '#d5dbe3',
      brightBlack: '#7b8695',
      brightRed: '#df6b67',
      brightGreen: '#6aa76a',
      brightYellow: '#c3912f',
      brightBlue: '#5a93ff',
      brightMagenta: '#a57cff',
      brightCyan: '#3aa7b7',
      brightWhite: '#f5f7fb',
    },
  },
  custom: {
    // custom 使用 obsidian 作为默认颜色方案
    app: {
      background: '7 8 10',
      foreground: '242 242 242',
      card: '18 19 23',
      secondary: '24 25 30',
      muted: '34 35 42',
      mutedForeground: '161 161 170',
      accent: '42 44 52',
      border: '54 56 66',
      primary: '168 170 88',
      primaryForeground: '7 8 10',
      sidebar: '12 13 16',
      titlebar: '28 30 36',
      titlebarForeground: '236 236 236',
    },
    terminal: {
      background: '#08090c',
      foreground: '#d7d7d7',
      cursor: '#f2f2f2',
      cursorAccent: '#08090c',
      selection: 'rgba(215, 215, 215, 0.28)',
      black: '#08090c',
      red: '#ff5f6d',
      green: '#4fd66e',
      yellow: '#e4c85f',
      blue: '#6aa7ff',
      magenta: '#d981ff',
      cyan: '#65d6e8',
      white: '#d7d7d7',
      brightBlack: '#7a7f8c',
      brightRed: '#ff7c87',
      brightGreen: '#72f093',
      brightYellow: '#f4e08b',
      brightBlue: '#8fbeff',
      brightMagenta: '#e7a2ff',
      brightCyan: '#8ceaf4',
      brightWhite: '#ffffff',
    },
  },
};

const TERMINAL_TOKEN_MAP: Record<string, string> = {
  background: '--terminal-background',
  foreground: '--terminal-foreground',
  cursor: '--terminal-cursor',
  cursorAccent: '--terminal-cursor-accent',
  selection: '--terminal-selection',
  black: '--terminal-black',
  red: '--terminal-red',
  green: '--terminal-green',
  yellow: '--terminal-yellow',
  blue: '--terminal-blue',
  magenta: '--terminal-magenta',
  cyan: '--terminal-cyan',
  white: '--terminal-white',
  brightBlack: '--terminal-bright-black',
  brightRed: '--terminal-bright-red',
  brightGreen: '--terminal-bright-green',
  brightYellow: '--terminal-bright-yellow',
  brightBlue: '--terminal-bright-blue',
  brightMagenta: '--terminal-bright-magenta',
  brightCyan: '--terminal-bright-cyan',
  brightWhite: '--terminal-bright-white',
};

export function getAppearanceFromSettings(settings?: Pick<Settings, 'appearance'> | null): AppearanceSettings {
  return normalizeAppearanceSettings(settings?.appearance ?? DEFAULT_APPEARANCE_SETTINGS);
}

export function applyAppearanceToDocument(appearance: AppearanceSettings): void {
  if (typeof document === 'undefined') {
    return;
  }

  const rootStyle = document.documentElement.style;
  const preset = APPEARANCE_PRESET_DEFINITIONS[appearance.skin.presetId] ?? APPEARANCE_PRESET_DEFINITIONS.obsidian;

  rootStyle.setProperty('--background', preset.app.background);
  rootStyle.setProperty('--foreground', preset.app.foreground);
  rootStyle.setProperty('--card', preset.app.card);
  rootStyle.setProperty('--card-foreground', preset.app.foreground);
  rootStyle.setProperty('--secondary', preset.app.secondary);
  rootStyle.setProperty('--secondary-foreground', preset.app.foreground);
  rootStyle.setProperty('--muted', preset.app.muted);
  rootStyle.setProperty('--muted-foreground', preset.app.mutedForeground);
  rootStyle.setProperty('--accent', preset.app.accent);
  rootStyle.setProperty('--accent-foreground', preset.app.foreground);
  rootStyle.setProperty('--border', preset.app.border);
  rootStyle.setProperty('--input', preset.app.border);
  rootStyle.setProperty('--ring', preset.app.primary);
  rootStyle.setProperty('--primary', preset.app.primary);
  rootStyle.setProperty('--primary-foreground', preset.app.primaryForeground);
  rootStyle.setProperty('--sidebar', preset.app.sidebar);
  rootStyle.setProperty('--sidebar-foreground', preset.app.foreground);
  rootStyle.setProperty('--titlebar', preset.app.titlebar);
  rootStyle.setProperty('--titlebar-foreground', preset.app.titlebarForeground);
  rootStyle.setProperty('--titlebar-border', preset.app.border);
  rootStyle.setProperty('--titlebar-hover', preset.app.accent);

  Object.entries(TERMINAL_TOKEN_MAP).forEach(([key, token]) => {
    rootStyle.setProperty(token, preset.terminal[key]);
  });

  // 将终端背景颜色转换为 RGB 值（用于 rgba）
  const terminalBgColor = preset.terminal.background;
  const terminalBgRgb = hexToRgb(terminalBgColor);
  if (terminalBgRgb) {
    rootStyle.setProperty('--terminal-background-rgb', `${terminalBgRgb.r}, ${terminalBgRgb.g}, ${terminalBgRgb.b}`);
  }

  rootStyle.setProperty('--appearance-terminal-opacity', String(appearance.terminalOpacity));
  rootStyle.setProperty('--appearance-terminal-opacity-percent', `${Math.round(appearance.terminalOpacity * 100)}%`);
  rootStyle.setProperty(
    '--terminal-background-effective',
    `rgba(var(--terminal-background-rgb, 12, 12, 12), var(--appearance-terminal-opacity, 0.62))`,
  );
  rootStyle.setProperty('--appearance-running-accent-rgb', resolveRunningAccentRgb(appearance));
  const skinDim = resolveSkinDim(appearance);
  const titlebarOpacity = resolveTitlebarOpacity(appearance, skinDim);
  const paneOpacity = resolvePaneOpacity(appearance);
  const paneStrongOpacity = resolvePaneStrongOpacity(appearance, paneOpacity);
  const paneChromeOpacity = resolvePaneChromeOpacity(appearance);
  const cardTopOpacity = resolveCardOpacity(appearance);
  const isPaperPreset = appearance.skin.presetId === 'paper' && !hasImageBackdrop(appearance);
  const cardBottomOpacity = isPaperPreset
    ? clampOpacity(cardTopOpacity + 0.06, 0.88, 0.98)
    : clampOpacity(cardTopOpacity + 0.12, 0.32, 0.78);
  const cardHoverTopOpacity = isPaperPreset
    ? clampOpacity(cardTopOpacity + 0.04, 0.88, 0.98)
    : clampOpacity(cardTopOpacity + 0.08, 0.28, 0.82);
  const cardHoverBottomOpacity = isPaperPreset
    ? clampOpacity(cardTopOpacity + 0.08, 0.90, 1)
    : clampOpacity(cardTopOpacity + 0.18, 0.36, 0.88);
  rootStyle.setProperty('--appearance-titlebar-background', resolveTitlebarBackground(appearance, titlebarOpacity));
  rootStyle.setProperty('--appearance-titlebar-backdrop-filter', resolveTitlebarBackdropFilter(appearance));
  rootStyle.setProperty('--appearance-remote-tab-active-background', resolveRemoteTabActiveBackground(appearance));
  rootStyle.setProperty('--appearance-remote-tab-hover-background', resolveRemoteTabHoverBackground(appearance));
  rootStyle.setProperty('--appearance-remote-tab-separator-color', resolveRemoteTabSeparatorColor(appearance));
  rootStyle.setProperty('--appearance-pane-background', rgbaWithTerminalBackground(paneOpacity));
  rootStyle.setProperty('--appearance-pane-background-strong', rgbaWithTerminalBackground(paneStrongOpacity));
  rootStyle.setProperty('--appearance-pane-chrome-background', rgbaWithTerminalBackground(paneChromeOpacity));
  rootStyle.setProperty('--appearance-pane-hover-scrim-opacity', resolvePaneHoverScrimOpacity(appearance).toFixed(3));
  rootStyle.setProperty(
    '--appearance-pane-window-inactive-scrim-opacity',
    resolvePaneWindowInactiveScrimOpacity(appearance).toFixed(3),
  );
  rootStyle.setProperty('--appearance-pane-inactive-scrim-opacity', resolvePaneInactiveScrimOpacity(appearance).toFixed(3));
  rootStyle.setProperty('--appearance-split-divider-track-opacity', resolveSplitDividerTrackOpacity(appearance).toFixed(3));
  rootStyle.setProperty('--appearance-split-divider-line-opacity', resolveSplitDividerLineOpacity(appearance).toFixed(3));
  rootStyle.setProperty('--appearance-split-divider-glow-opacity', resolveSplitDividerGlowOpacity(appearance).toFixed(3));
  rootStyle.setProperty('--appearance-card-surface-top', rgbaWithTerminalBackground(cardTopOpacity));
  rootStyle.setProperty('--appearance-card-surface-bottom', rgbaWithTerminalBackground(cardBottomOpacity));
  rootStyle.setProperty('--appearance-card-hover-surface-top', rgbaWithTerminalBackground(cardHoverTopOpacity));
  rootStyle.setProperty('--appearance-card-hover-surface-bottom', rgbaWithTerminalBackground(cardHoverBottomOpacity));
  rootStyle.setProperty('--appearance-native-control-color-scheme', resolveNativeControlColorScheme(appearance));
  rootStyle.setProperty('--appearance-native-option-background', resolveNativeOptionBackground(appearance));
  rootStyle.setProperty('--appearance-native-option-foreground', 'rgb(var(--foreground))');
  rootStyle.setProperty('--appearance-native-option-active-background', 'rgb(var(--primary))');
  rootStyle.setProperty('--appearance-native-option-active-foreground', 'rgb(var(--primary-foreground))');
  rootStyle.setProperty(
    '--appearance-main-surface-background',
    resolveMainSurfaceBackground(appearance, paneStrongOpacity),
  );
  rootStyle.setProperty(
    '--appearance-sidebar-surface-background',
    resolveSidebarSurfaceBackground(appearance, paneStrongOpacity),
  );
  rootStyle.setProperty('--appearance-skin-dim', String(skinDim));
  rootStyle.setProperty('--appearance-skin-blur', `${appearance.skin.blur}px`);
  rootStyle.setProperty('--appearance-skin-motion-duration', appearance.reduceMotion ? '0s' : '18s');
  rootStyle.setProperty('--appearance-skin-motion-opacity', appearance.reduceMotion || appearance.skin.motion === 'none' ? '0' : '1');
}

export function getAppearanceSkinStyle(appearance: AppearanceSettings): CSSProperties {
  return getAppearanceBackdropDescriptor(appearance).baseStyle;
}

export function getAppearanceBackdropDescriptor(appearance: AppearanceSettings): AppearanceBackdropDescriptor {
  const layers = buildAppearanceBackdropLayers(appearance);
  return {
    baseStyle: getBackdropBaseStyle(appearance),
    layers,
    dimStyle: {
      opacity: `var(--appearance-skin-dim, ${appearance.skin.dim})`,
    },
  };
}

/**
 * 将本地文件路径转换为可在 CSS url() 中使用的稳定 URL。
 * 会把旧版本遗留的 app-image:// / file:// 路径先解码回本地路径，再重新编码。
 */
function toImageUrl(filePath: string): string {
  const normalizedPath = normalizeImagePath(filePath);
  return normalizedPath ? toAppImageUrl(normalizedPath) : filePath;
}

function getBackdropBaseStyle(appearance: AppearanceSettings): CSSProperties {
  if (appearance.skin.kind === 'none') {
    return {
      background: `rgb(var(--background))`,
    };
  }

  if (appearance.skin.kind === 'image' && appearance.skin.imagePath) {
    return {
      backgroundImage: `url("${escapeCssUrl(toImageUrl(appearance.skin.imagePath))}")`,
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat',
      backgroundSize: 'cover',
      filter: appearance.skin.blur > 0 ? `blur(${appearance.skin.blur}px) scale(1.02)` : undefined,
    };
  }

  return {
    background: appearance.skin.gradient,
    filter: appearance.skin.blur > 0 ? `blur(${appearance.skin.blur}px) scale(1.02)` : undefined,
  };
}

function buildAppearanceBackdropLayers(appearance: AppearanceSettings): AppearanceBackdropLayer[] {
  if (appearance.skin.kind === 'none') {
    return [];
  }

  const motionEnabled = !appearance.reduceMotion && appearance.skin.motion !== 'none';

  if (appearance.skin.kind === 'image' && appearance.skin.imagePath) {
    if (!motionEnabled) {
      return [];
    }

    return [
      {
        className: 'absolute inset-[-8%] will-change-transform',
        style: {
          backgroundImage: 'radial-gradient(circle at 20% 16%, rgba(255,255,255,0.10), transparent 22%), radial-gradient(circle at 78% 18%, rgba(255,255,255,0.08), transparent 24%)',
          opacity: 'var(--appearance-skin-motion-opacity, 0)',
          animation: 'appearance-skin-drift var(--appearance-skin-motion-duration, 18s) ease-in-out infinite alternate',
          mixBlendMode: 'screen' as const,
        },
      },
    ];
  }

  const presetId = appearance.skin.presetId;
  if (presetId === 'paper') {
    return [
      {
        className: 'absolute inset-0',
        style: {
          background: 'linear-gradient(180deg, rgba(255,255,255,0.92) 0%, rgba(247,250,255,0.96) 100%)',
        },
      },
      ...(motionEnabled
        ? [{
            className: 'absolute inset-[-6%] will-change-transform',
            style: {
              background: 'radial-gradient(circle at 14% 18%, rgba(255, 255, 255, 0.60), transparent 22%), radial-gradient(circle at 84% 14%, rgba(83, 149, 255, 0.10), transparent 28%)',
              opacity: 'var(--appearance-skin-motion-opacity, 0)',
              animation: 'appearance-skin-float calc(var(--appearance-skin-motion-duration, 18s) * 0.82) ease-in-out infinite alternate',
              mixBlendMode: 'screen' as const,
            },
          }]
        : []),
    ];
  }

  return [
    ...(motionEnabled
      ? [{
          className: 'absolute inset-[-8%] will-change-transform',
          style: {
            background: 'radial-gradient(circle at 18% 18%, rgba(86, 130, 255, 0.18), transparent 28%), radial-gradient(circle at 82% 18%, rgba(244, 158, 73, 0.12), transparent 26%)',
            opacity: 'var(--appearance-skin-motion-opacity, 0)',
            animation: 'appearance-skin-drift var(--appearance-skin-motion-duration, 18s) ease-in-out infinite alternate',
            mixBlendMode: 'screen' as const,
          },
        }]
      : []),
    {
      className: 'absolute inset-0',
      style: {
        background: 'linear-gradient(180deg, rgba(0,0,0,0.08) 0%, rgba(0,0,0,0.36) 100%)',
      },
    },
  ];
}

function resolveSkinDim(appearance: AppearanceSettings): number {
  const isImageSkin = hasImageBackdrop(appearance);
  const isPaperPreset = appearance.skin.presetId === 'paper' && !isImageSkin;
  const baseDim = isImageSkin
    ? clampOpacity(appearance.skin.dim - 0.24, 0.08, 0.68)
    : appearance.skin.dim;

  if (isPaperPreset) {
    if (appearance.readabilityMode === 'readability') {
      return clampOpacity(baseDim + 0.02, 0.04, 0.12);
    }

    if (appearance.readabilityMode === 'immersive') {
      return clampOpacity(baseDim - 0.02, 0.01, 0.08);
    }

    return clampOpacity(baseDim, 0.02, 0.10);
  }

  if (appearance.readabilityMode === 'readability') {
    return clampOpacity(baseDim + (isImageSkin ? 0.08 : 0.18), 0.08, 0.92);
  }

  if (appearance.readabilityMode === 'immersive') {
    return clampOpacity(baseDim - (isImageSkin ? 0.08 : 0.18), 0.04, 0.72);
  }

  return clampOpacity(baseDim, isImageSkin ? 0.08 : 0.18, 0.82);
}

function resolveTitlebarOpacity(appearance: AppearanceSettings, skinDim: number): number {
  if (!hasImageBackdrop(appearance)) {
    return 1;
  }

  let opacity = 0.56 + ((0.68 - skinDim) * 0.18);

  if (appearance.readabilityMode === 'readability') {
    opacity += 0.12;
  } else if (appearance.readabilityMode === 'immersive') {
    opacity -= 0.08;
  }

  return clampOpacity(opacity, 0.46, 0.82);
}

function resolveTitlebarBackground(appearance: AppearanceSettings, opacity: number): string {
  if (!hasImageBackdrop(appearance)) {
    return 'rgb(var(--titlebar))';
  }

  return `rgb(var(--titlebar) / ${opacity.toFixed(3)})`;
}

function resolveTitlebarBackdropFilter(appearance: AppearanceSettings): string {
  return hasImageBackdrop(appearance)
    ? 'saturate(140%) blur(12px)'
    : 'none';
}

function resolveRunningAccentRgb(appearance: AppearanceSettings): string {
  switch (appearance.skin.presetId) {
    case 'paper':
      return '53 116 240';
    case 'obsidian':
    case 'custom':
    default:
      return '22 198 12';
  }
}

function resolveRemoteTabActiveBackground(appearance: AppearanceSettings): string {
  if (hasImageBackdrop(appearance)) {
    const opacity = appearance.readabilityMode === 'readability' ? 0.88 : appearance.readabilityMode === 'immersive' ? 0.66 : 0.76;
    return `rgb(var(--titlebar) / ${opacity.toFixed(3)})`;
  }

  return 'rgb(var(--card))';
}

function resolveRemoteTabHoverBackground(appearance: AppearanceSettings): string {
  if (hasImageBackdrop(appearance)) {
    const opacity = appearance.readabilityMode === 'readability' ? 0.74 : appearance.readabilityMode === 'immersive' ? 0.52 : 0.62;
    return `rgb(var(--titlebar) / ${opacity.toFixed(3)})`;
  }

  return 'rgb(var(--accent))';
}

function resolveRemoteTabSeparatorColor(appearance: AppearanceSettings): string {
  if (hasImageBackdrop(appearance)) {
    return 'rgb(var(--titlebar-foreground) / 0.18)';
  }

  return appearance.skin.presetId === 'paper'
    ? 'rgb(var(--border) / 0.92)'
    : 'rgb(var(--border) / 0.72)';
}

function resolvePaneOpacity(appearance: AppearanceSettings): number {
  if (appearance.skin.presetId === 'paper' && !hasImageBackdrop(appearance)) {
    if (appearance.readabilityMode === 'readability') {
      return 0.92;
    }

    if (appearance.readabilityMode === 'immersive') {
      return 0.78;
    }

    return 0.86;
  }

  if (hasImageBackdrop(appearance)) {
    if (appearance.readabilityMode === 'readability') {
      return 0.08;
    }

    return 0;
  }

  const baseOpacity = 0.04 + (appearance.terminalOpacity * 0.10);
  if (appearance.readabilityMode === 'readability') {
    return clampOpacity(baseOpacity + 0.08, 0.08, 0.28);
  }

  if (appearance.readabilityMode === 'immersive') {
    return clampOpacity(baseOpacity - 0.04, 0, 0.18);
  }

  return clampOpacity(baseOpacity, 0.02, 0.22);
}

function resolvePaneStrongOpacity(appearance: AppearanceSettings, paneOpacity: number): number {
  if (appearance.skin.presetId === 'paper' && !hasImageBackdrop(appearance)) {
    return clampOpacity(paneOpacity + 0.06, 0.86, 0.96);
  }

  if (hasImageBackdrop(appearance)) {
    if (appearance.readabilityMode === 'readability') {
      return 0.08;
    }

    return 0;
  }

  return clampOpacity(paneOpacity + 0.05, 0.08, 0.3);
}

function resolvePaneChromeOpacity(appearance: AppearanceSettings): number {
  if (appearance.skin.presetId === 'paper' && !hasImageBackdrop(appearance)) {
    if (appearance.readabilityMode === 'readability') {
      return 0.96;
    }

    if (appearance.readabilityMode === 'immersive') {
      return 0.82;
    }

    return 0.90;
  }

  const isImageSkin = hasImageBackdrop(appearance);
  const baseOpacity = isImageSkin ? 0.10 : 0.14;
  const scaledOpacity = baseOpacity + ((appearance.terminalOpacity - 0.62) * (isImageSkin ? 0.08 : 0.12));

  if (appearance.readabilityMode === 'readability') {
    return clampOpacity(scaledOpacity + 0.08, isImageSkin ? 0.14 : 0.18, 0.38);
  }

  if (appearance.readabilityMode === 'immersive') {
    return clampOpacity(scaledOpacity - 0.04, isImageSkin ? 0.06 : 0.08, 0.28);
  }

  return clampOpacity(scaledOpacity, isImageSkin ? 0.08 : 0.12, 0.32);
}

function resolvePaneHoverScrimOpacity(appearance: AppearanceSettings): number {
  if (appearance.skin.presetId === 'paper' && !hasImageBackdrop(appearance)) {
    if (appearance.readabilityMode === 'readability') {
      return 0.025;
    }

    if (appearance.readabilityMode === 'immersive') {
      return 0.012;
    }

    return 0.018;
  }

  if (hasImageBackdrop(appearance)) {
    if (appearance.readabilityMode === 'readability') {
      return 0.055;
    }

    if (appearance.readabilityMode === 'immersive') {
      return 0.032;
    }

    return 0.04;
  }

  if (appearance.readabilityMode === 'readability') {
    return 0.05;
  }

  if (appearance.readabilityMode === 'immersive') {
    return 0.025;
  }

  return 0.035;
}

function resolvePaneWindowInactiveScrimOpacity(appearance: AppearanceSettings): number {
  if (appearance.skin.presetId === 'paper' && !hasImageBackdrop(appearance)) {
    if (appearance.readabilityMode === 'readability') {
      return 0.075;
    }

    if (appearance.readabilityMode === 'immersive') {
      return 0.042;
    }

    return 0.058;
  }

  if (hasImageBackdrop(appearance)) {
    if (appearance.readabilityMode === 'readability') {
      return 0.17;
    }

    if (appearance.readabilityMode === 'immersive') {
      return 0.11;
    }

    return 0.14;
  }

  if (appearance.readabilityMode === 'readability') {
    return 0.14;
  }

  if (appearance.readabilityMode === 'immersive') {
    return 0.085;
  }

  return 0.11;
}

function resolvePaneInactiveScrimOpacity(appearance: AppearanceSettings): number {
  if (appearance.skin.presetId === 'paper' && !hasImageBackdrop(appearance)) {
    if (appearance.readabilityMode === 'readability') {
      return 0.12;
    }

    if (appearance.readabilityMode === 'immersive') {
      return 0.07;
    }

    return 0.095;
  }

  if (hasImageBackdrop(appearance)) {
    if (appearance.readabilityMode === 'readability') {
      return 0.26;
    }

    if (appearance.readabilityMode === 'immersive') {
      return 0.16;
    }

    return 0.2;
  }

  if (appearance.readabilityMode === 'readability') {
    return 0.22;
  }

  if (appearance.readabilityMode === 'immersive') {
    return 0.13;
  }

  return 0.18;
}

function resolveSplitDividerTrackOpacity(appearance: AppearanceSettings): number {
  if (appearance.skin.presetId === 'paper' && !hasImageBackdrop(appearance)) {
    return appearance.readabilityMode === 'immersive' ? 0.12 : 0.16;
  }

  if (hasImageBackdrop(appearance)) {
    return appearance.readabilityMode === 'readability' ? 0.28 : 0.22;
  }

  return appearance.readabilityMode === 'readability' ? 0.26 : 0.2;
}

function resolveSplitDividerLineOpacity(appearance: AppearanceSettings): number {
  if (appearance.skin.presetId === 'paper' && !hasImageBackdrop(appearance)) {
    return appearance.readabilityMode === 'immersive' ? 0.72 : 0.82;
  }

  if (hasImageBackdrop(appearance)) {
    return appearance.readabilityMode === 'readability' ? 0.96 : 0.9;
  }

  return appearance.readabilityMode === 'readability' ? 0.94 : 0.88;
}

function resolveSplitDividerGlowOpacity(appearance: AppearanceSettings): number {
  if (appearance.skin.presetId === 'paper' && !hasImageBackdrop(appearance)) {
    return 0.1;
  }

  if (hasImageBackdrop(appearance)) {
    return appearance.readabilityMode === 'immersive' ? 0.14 : 0.2;
  }

  return appearance.readabilityMode === 'readability' ? 0.22 : 0.18;
}

function resolveCardOpacity(appearance: AppearanceSettings): number {
  if (appearance.skin.presetId === 'paper' && !hasImageBackdrop(appearance)) {
    if (appearance.readabilityMode === 'readability') {
      return 0.90;
    }

    if (appearance.readabilityMode === 'immersive') {
      return 0.76;
    }

    return 0.84;
  }

  const baseOpacity = 0.1 + (appearance.terminalOpacity * 0.24);
  if (appearance.readabilityMode === 'readability') {
    return clampOpacity(baseOpacity + 0.08, 0.18, 0.72);
  }

  if (appearance.readabilityMode === 'immersive') {
    return clampOpacity(baseOpacity - 0.06, 0.06, 0.52);
  }

  return clampOpacity(baseOpacity, 0.08, 0.64);
}

function resolveNativeControlColorScheme(appearance: AppearanceSettings): string {
  return appearance.skin.presetId === 'paper' && !hasImageBackdrop(appearance)
    ? 'light'
    : 'dark';
}

function resolveNativeOptionBackground(appearance: AppearanceSettings): string {
  if (appearance.skin.presetId === 'paper' && !hasImageBackdrop(appearance)) {
    return 'rgb(var(--card))';
  }

  if (hasImageBackdrop(appearance)) {
    return 'rgb(var(--background))';
  }

  return 'rgb(var(--card))';
}

function resolveMainSurfaceBackground(appearance: AppearanceSettings, paneStrongOpacity: number): string {
  if (appearance.skin.presetId === 'paper' && !hasImageBackdrop(appearance)) {
    return 'rgba(255, 255, 255, 0.92)';
  }

  return rgbaWithTerminalBackground(paneStrongOpacity);
}

function resolveSidebarSurfaceBackground(appearance: AppearanceSettings, paneStrongOpacity: number): string {
  if (appearance.skin.presetId === 'paper' && !hasImageBackdrop(appearance)) {
    return resolveMainSurfaceBackground(appearance, paneStrongOpacity);
  }

  if (hasImageBackdrop(appearance)) {
    return 'rgb(var(--sidebar) / 0.85)';
  }

  return 'rgb(var(--sidebar) / 0.85)';
}

function clampOpacity(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function rgbaWithTerminalBackground(alpha: number): string {
  return `rgba(var(--terminal-background-rgb, 12, 12, 12), ${alpha.toFixed(3)})`;
}

function hasImageBackdrop(appearance: AppearanceSettings): boolean {
  return appearance.skin.kind === 'image' && Boolean(appearance.skin.imagePath);
}

function escapeCssUrl(value: string): string {
  return value.replace(/\\/g, '/').replace(/"/g, '\\"');
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : null;
}
