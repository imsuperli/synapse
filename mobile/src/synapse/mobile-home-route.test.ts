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

  it('groups paired desktops by relay while showing each desktop name and IP address', () => {
    expect(routeSource).toContain("from '../src/transport/host-display'")
    expect(routeSource).toContain('const hostListItems = useMemo<HostListItem[]>(')
    expect(routeSource).toContain('groupHostsByRelay(hosts).flatMap')
    expect(routeSource).toContain("item.relayEndpoint ?? t('common.localNetwork')")
    expect(routeSource).toContain('hostNetworkAddress(host.endpoint)')
    expect(routeSource).toContain("t('common.desktopIp', { address })")
    expect(routeSource).toContain("router.push(`/h/${host.id}/settings`)")
  })
})
