export const DEFAULT_REMOTE_TERMINAL_RESIDENT_LIMIT = 3

export function selectRemoteTerminalResidentSessions(options: {
  residentHandles: string[]
  targetHandle: string
  activeHandle: string | null
  lastUsedAt: ReadonlyMap<string, number>
  limit?: number
}): { handles: string[]; evictedHandle: string | null } {
  const limit = Math.max(1, Math.floor(options.limit ?? DEFAULT_REMOTE_TERMINAL_RESIDENT_LIMIT))
  const handles = options.residentHandles.includes(options.targetHandle)
    ? [...options.residentHandles]
    : [...options.residentHandles, options.targetHandle]
  if (handles.length <= limit) {
    return { handles, evictedHandle: null }
  }
  const evictedHandle = handles
    .filter(
      (handle) => handle !== options.targetHandle && handle !== options.activeHandle
    )
    .sort((a, b) => (options.lastUsedAt.get(a) ?? 0) - (options.lastUsedAt.get(b) ?? 0))[0] ?? null
  return {
    handles: evictedHandle ? handles.filter((handle) => handle !== evictedHandle) : handles,
    evictedHandle
  }
}
