import { describe, expect, it } from 'vitest';
import { DEFAULT_APPEARANCE_SETTINGS } from '../../../shared/utils/appearance';
import { applyAppearanceToDocument, getAppearanceBackdropDescriptor, getAppearanceSkinStyle } from '../appearance';

describe('renderer appearance utilities', () => {
  it('applies app and terminal theme tokens to the document root', () => {
    applyAppearanceToDocument({
      ...DEFAULT_APPEARANCE_SETTINGS,
      skin: {
        ...DEFAULT_APPEARANCE_SETTINGS.skin,
        presetId: 'obsidian',
      },
      terminalOpacity: 0.75,
    });

    const style = document.documentElement.style;
    expect(style.getPropertyValue('--background')).toBe('7 8 10');
    expect(style.getPropertyValue('--terminal-background')).toBe('#08090c');
    expect(style.getPropertyValue('--appearance-terminal-opacity-percent')).toBe('75%');
    expect(style.getPropertyValue('--terminal-background-effective')).toContain('rgba(var(--terminal-background-rgb');
    expect(style.getPropertyValue('--appearance-skin-motion-duration')).toBe('0s');
    expect(style.getPropertyValue('--appearance-skin-motion-opacity')).toBe('0');
    expect(style.getPropertyValue('--appearance-remote-tab-active-background')).toBe('rgb(var(--card))');
    expect(style.getPropertyValue('--appearance-remote-tab-hover-background')).toBe('rgb(var(--accent))');
    expect(style.getPropertyValue('--appearance-remote-tab-separator-color')).toBe('rgb(var(--border) / 0.72)');
    expect(style.getPropertyValue('--appearance-pane-hover-scrim-opacity')).toBe('0.035');
    expect(style.getPropertyValue('--appearance-pane-window-inactive-scrim-opacity')).toBe('0.110');
    expect(style.getPropertyValue('--appearance-pane-inactive-scrim-opacity')).toBe('0.180');
    expect(style.getPropertyValue('--appearance-split-divider-track-opacity')).toBe('0.200');
    expect(style.getPropertyValue('--appearance-split-divider-line-opacity')).toBe('0.880');
    expect(style.getPropertyValue('--appearance-split-divider-glow-opacity')).toBe('0.180');
  });

  it('applies the obsidian palette tokens', () => {
    applyAppearanceToDocument({
      ...DEFAULT_APPEARANCE_SETTINGS,
      skin: {
        ...DEFAULT_APPEARANCE_SETTINGS.skin,
        presetId: 'obsidian',
      },
    });

    const style = document.documentElement.style;
    expect(style.getPropertyValue('--background')).toBe('7 8 10');
    expect(style.getPropertyValue('--primary')).toBe('168 170 88');
    expect(style.getPropertyValue('--titlebar')).toBe('46 46 46');
    expect(style.getPropertyValue('--terminal-background')).toBe('#08090c');
    expect(style.getPropertyValue('--terminal-cursor')).toBe('#f2f2f2');
  });

  it('applies a crisp white palette for the paper preset', () => {
    applyAppearanceToDocument({
      ...DEFAULT_APPEARANCE_SETTINGS,
      skin: {
        ...DEFAULT_APPEARANCE_SETTINGS.skin,
        presetId: 'paper',
        dim: 0.04,
      },
    });

    const style = document.documentElement.style;
    expect(style.getPropertyValue('--background')).toBe('252 253 255');
    expect(style.getPropertyValue('--card')).toBe('255 255 255');
    expect(style.getPropertyValue('--titlebar')).toBe('250 251 253');
    expect(style.getPropertyValue('--terminal-background')).toBe('#ffffff');
    expect(style.getPropertyValue('--appearance-skin-dim')).toBe('0.04');
    expect(style.getPropertyValue('--appearance-pane-background')).toBe('rgba(var(--terminal-background-rgb, 12, 12, 12), 0.860)');
    expect(style.getPropertyValue('--appearance-pane-chrome-background')).toBe('rgba(var(--terminal-background-rgb, 12, 12, 12), 0.900)');
    expect(style.getPropertyValue('--appearance-main-surface-background')).toBe('rgba(255, 255, 255, 0.92)');
    expect(style.getPropertyValue('--appearance-sidebar-surface-background')).toBe('rgba(255, 255, 255, 0.92)');
    expect(style.getPropertyValue('--appearance-pane-hover-scrim-opacity')).toBe('0.018');
    expect(style.getPropertyValue('--appearance-pane-window-inactive-scrim-opacity')).toBe('0.058');
    expect(style.getPropertyValue('--appearance-pane-inactive-scrim-opacity')).toBe('0.095');
    expect(style.getPropertyValue('--appearance-split-divider-track-opacity')).toBe('0.160');
    expect(style.getPropertyValue('--appearance-split-divider-line-opacity')).toBe('0.820');
    expect(style.getPropertyValue('--appearance-split-divider-glow-opacity')).toBe('0.100');
  });

  it('builds one global skin background style', () => {
    const style = getAppearanceSkinStyle({
      ...DEFAULT_APPEARANCE_SETTINGS,
      skin: {
        ...DEFAULT_APPEARANCE_SETTINGS.skin,
        presetId: 'custom',
        kind: 'image',
        imagePath: 'C:\\Wallpapers\\skin.png',
      },
    });

    expect(style.backgroundImage).toBe('url("app-image:///C%3A/Wallpapers/skin.png")');
    expect(style.backgroundSize).toBe('cover');
  });

  it('builds layered backdrop descriptors for animated presets', () => {
    const descriptor = getAppearanceBackdropDescriptor({
      ...DEFAULT_APPEARANCE_SETTINGS,
      reduceMotion: false,
      skin: {
        ...DEFAULT_APPEARANCE_SETTINGS.skin,
        presetId: 'paper',
        motion: 'ambient',
      },
    });

    expect(descriptor.layers.length).toBeGreaterThan(0);
    expect(descriptor.layers.some((layer) => String(layer.style?.animation ?? '').includes('appearance-skin-float'))).toBe(true);
  });

  it('skips motion-only layers when skin motion is disabled', () => {
    const descriptor = getAppearanceBackdropDescriptor({
      ...DEFAULT_APPEARANCE_SETTINGS,
      reduceMotion: true,
      skin: {
        ...DEFAULT_APPEARANCE_SETTINGS.skin,
        presetId: 'paper',
        motion: 'none',
      },
    });

    expect(descriptor.layers).toHaveLength(1);
    expect(descriptor.layers[0]?.style?.animation).toBeUndefined();
  });
});
