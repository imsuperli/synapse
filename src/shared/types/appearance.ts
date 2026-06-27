// 皮肤预设ID - 合并了原来的主题和皮肤概念
export type AppearanceSkinPresetId = 'obsidian' | 'paper' | 'custom';

export type AppearanceSkinKind = 'none' | 'gradient' | 'image';
export type AppearanceSkinMotionMode = 'none' | 'ambient';

export type AppearanceReadabilityMode = 'balanced' | 'readability' | 'immersive';

export interface AppearanceSkinSettings {
  presetId: AppearanceSkinPresetId;
  kind: AppearanceSkinKind;
  gradient: string;
  imagePath?: string;
  dim: number;
  blur: number;
  motion: AppearanceSkinMotionMode;
}

export interface AppearanceSettings {
  skin: AppearanceSkinSettings;
  terminalOpacity: number;
  readabilityMode: AppearanceReadabilityMode;
  reduceMotion: boolean;
}

// 向后兼容：保留旧的 themeId 类型（已废弃）
/** @deprecated 使用 AppearanceSkinPresetId 代替 */
export type AppearanceThemeId = 'obsidian' | 'paper';
