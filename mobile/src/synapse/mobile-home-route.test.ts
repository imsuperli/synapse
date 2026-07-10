import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const routeSource = readFileSync(new URL('../../app/index.tsx', import.meta.url), 'utf8')

describe('Synapse Mobile home route wiring', () => {
  it('lets users remove saved paired desktops only after confirmation', () => {
    expect(routeSource).toContain("import { loadHosts, removeHost } from '../src/transport/host-store'")
    expect(routeSource).toContain("Alert.alert(t('home.removeHostTitle'), t('home.removeHostMessage')")
    expect(routeSource).toContain('await removeHost(hostId)')
    expect(routeSource).toContain('event.stopPropagation()')
  })
})
