import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const routeSource = readFileSync(
  new URL('../../app/h/[hostId]/index.tsx', import.meta.url),
  'utf8'
)

describe('Synapse Mobile host overview route wiring', () => {
  it('keeps grouped windows out of the standalone window card list', () => {
    expect(routeSource).toContain('const groupedWindowIds = useMemo(() => {')
    expect(routeSource).toContain('windows.filter((window) => !groupedWindowIds.has(window.windowId))')
    expect(routeSource).toContain('...visibleGroups.map((group) => ({ type: \'group\' as const, group }))')
    expect(routeSource).toContain('...visibleWindows.map((window) => ({ type: \'window\' as const, window }))')
  })

  it('shows all group members when the search query matches the group name', () => {
    expect(routeSource).toContain('const matchesGroupName = group.name.toLowerCase().includes(normalizedSearchQuery)')
    expect(routeSource).toContain('windows: matchesGroupName ? group.windows : filteredWindows')
  })

  it('disables mobile window creation when the paired host scope cannot create windows', () => {
    expect(routeSource).toContain('disabled={!canCreateWindow || creatingWindow}')
  })

  it('drops stale group selections when windows disappear or become grouped elsewhere', () => {
    expect(routeSource).toContain('function filterSelectableWindowIds(')
    expect(routeSource).toContain('!groupedWindowIds.has(windowId)')
    expect(routeSource).toContain('filterSelectableWindowIds(current, overview.windows, overview.groups)')
  })

  it('clears stale sync errors after a successful background overview refresh', () => {
    const syncIndex = routeSource.indexOf('const syncOverviewState = useCallback(async () => {')
    const clearIndex = routeSource.indexOf('setError(null)', syncIndex)
    const catchIndex = routeSource.indexOf('} catch (err) {', syncIndex)

    expect(syncIndex).toBeGreaterThanOrEqual(0)
    expect(clearIndex).toBeGreaterThan(syncIndex)
    expect(clearIndex).toBeLessThan(catchIndex)
  })
})
