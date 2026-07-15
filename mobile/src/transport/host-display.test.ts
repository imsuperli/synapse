import { describe, expect, it } from 'vitest'
import {
  groupHostsByRelay,
  hostDisplayName,
  hostNetworkAddress
} from './host-display'
import type { HostProfile } from './types'

function host(overrides: Partial<HostProfile> & Pick<HostProfile, 'id'>): HostProfile {
  return {
    id: overrides.id,
    name: overrides.name ?? `Desktop ${overrides.id}`,
    endpoint: overrides.endpoint ?? 'ws://192.168.1.10:6868',
    deviceToken: overrides.deviceToken ?? 'device-token',
    publicKeyB64: overrides.publicKeyB64 ?? 'public-key',
    relayEndpoint: overrides.relayEndpoint,
    relaySessionId: overrides.relaySessionId,
    relayClientToken: overrides.relayClientToken,
    lastConnected: overrides.lastConnected ?? 0
  }
}

describe('host display helpers', () => {
  it('groups paired computers by relay and keeps local computers separate', () => {
    const groups = groupHostsByRelay([
      host({ id: 'one', relayEndpoint: 'wss://relay.example.com/v1/relay' }),
      host({ id: 'two', relayEndpoint: 'wss://relay.example.com/v1/relay' }),
      host({ id: 'three', relayEndpoint: 'wss://other.example.com/v1/relay' }),
      host({ id: 'four' })
    ])

    expect(groups).toEqual([
      {
        id: 'relay:wss://relay.example.com/v1/relay',
        relayEndpoint: 'wss://relay.example.com/v1/relay',
        hosts: [expect.objectContaining({ id: 'one' }), expect.objectContaining({ id: 'two' })]
      },
      {
        id: 'relay:wss://other.example.com/v1/relay',
        relayEndpoint: 'wss://other.example.com/v1/relay',
        hosts: [expect.objectContaining({ id: 'three' })]
      },
      {
        id: 'local',
        relayEndpoint: null,
        hosts: [expect.objectContaining({ id: 'four' })]
      }
    ])
  })

  it('shows the paired computer address instead of the relay endpoint', () => {
    expect(hostNetworkAddress('ws://192.168.1.24:6868')).toBe('192.168.1.24')
    expect(hostNetworkAddress('wss://desktop.example.com/v1/remote')).toBe('desktop.example.com')
  })

  it('does not show the generic Synapse pairing name as a computer name', () => {
    expect(hostDisplayName({ name: 'Synapse' })).toBeNull()
    expect(hostDisplayName({ name: '  Synapse Desktop  ' })).toBeNull()
    expect(hostDisplayName({ name: 'Work Laptop' })).toBe('Work Laptop')
  })
})
