export const DEFAULT_RECENT_TERMINAL_LIMIT = 10;
export const MIN_RECENT_TERMINAL_LIMIT = 1;
export const MAX_RECENT_TERMINAL_LIMIT = 50;

export function normalizeRecentTerminalLimit(value: unknown): number {
  const numericValue = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number(value)
      : Number.NaN;

  if (!Number.isFinite(numericValue)) {
    return DEFAULT_RECENT_TERMINAL_LIMIT;
  }

  return Math.min(
    MAX_RECENT_TERMINAL_LIMIT,
    Math.max(MIN_RECENT_TERMINAL_LIMIT, Math.floor(numericValue)),
  );
}
