import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const routeSource = readFileSync(new URL('../../app/index.tsx', import.meta.url), 'utf8')

describe('Synapse Mobile home route wiring', () => {
  it('lets users remove saved paired desktops only after confirmation', () => {
    expect(routeSource).toContain('removeHost,')
    expect(routeSource).toContain("Alert.alert(t('home.removeHostTitle'), t('home.removeHostMessage')")
    expect(routeSource).toContain('await removeHost(hostId)')
    expect(routeSource).toContain('confirmRemoveHost(host)')
  })

  it('shows one desktop group with independently selectable direct and relay rows', () => {
    expect(routeSource).toContain("from '../src/transport/host-display'")
    expect(routeSource).toContain('hostConnectionOptions(host)')
    expect(routeSource).toContain("connection.route === 'direct'")
    expect(routeSource).toContain('await setHostConnectionRoute(host.id, route)')
    expect(routeSource).toContain('onPress={() => void openHostRoute(host, connection.route)}')
    expect(routeSource).toContain('hostNetworkAddress(connection.endpoint)')
    expect(routeSource).toContain("router.push(`/h/${host.id}/settings`)")
  })
})
