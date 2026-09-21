import { describe, expect, it } from 'vitest';
import { DEFAULT_APPEARANCE_SETTINGS, normalizeAppearanceSettings } from '../appearance';

describe('appearance settings', () => {
  it('returns defaults when no appearance settings are provided', () => {
    expect(normalizeAppearanceSettings(undefined)).toEqual(DEFAULT_APPEARANCE_SETTINGS);
  });

  it('clamps numeric values and falls back from unknown enum values', () => {
    const normalized = normalizeAppearanceSettings({
      terminalOpacity: 0.1,
      readabilityMode: 'invalid' as never,
      skin: {
        kind: 'unknown' as never,
        gradient: '',
        dim: 9,
        blur: -1,
        presetId: 'unknown' as never,
        motion: 'unknown' as never,
      },
    });

    expect(normalized.readabilityMode).toBe(DEFAULT_APPEARANCE_SETTINGS.readabilityMode);
    expect(normalized.terminalOpacity).toBe(0.28);
    expect(normalized.skin.kind).toBe(DEFAULT_APPEARANCE_SETTINGS.skin.kind);
    expect(normalized.skin.presetId).toBe(DEFAULT_APPEARANCE_SETTINGS.skin.presetId);
    expect(normalized.skin.gradient).toBe(DEFAULT_APPEARANCE_SETTINGS.skin.gradient);
    expect(normalized.skin.dim).toBe(0.92);
    expect(normalized.skin.blur).toBe(0);
    expect(normalized.skin.motion).toBe(DEFAULT_APPEARANCE_SETTINGS.skin.motion);
  });

  it('falls back removed legacy themeId values to the default skin', () => {
    const normalized = normalizeAppearanceSettings({
      themeId: 'aurora',
    } as any);

    expect(normalized.skin.presetId).toBe(DEFAULT_APPEARANCE_SETTINGS.skin.presetId);
  });

  it('preserves existing skin.presetId when legacy themeId is present', () => {
    const normalized = normalizeAppearanceSettings({
      themeId: 'aurora',
      skin: {
        presetId: 'paper',
      },
    } as any);

    expect(normalized.skin.presetId).toBe('paper');
  });
});
