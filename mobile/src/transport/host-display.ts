import type { HostProfile } from './types'

export type HostConnectionGroup = {
  id: string
  relayEndpoint: string | null
  hosts: HostProfile[]
}

const GENERIC_HOST_NAMES = new Set(['synapse', 'synapse desktop'])

export function groupHostsByRelay(hosts: readonly HostProfile[]): HostConnectionGroup[] {
  const relayGroups = new Map<string, HostConnectionGroup>()
  const localHosts: HostProfile[] = []

  for (const host of hosts) {
    const relayEndpoint = host.relayEndpoint?.trim()
    if (!relayEndpoint) {
      localHosts.push(host)
      continue
    }

    const existing = relayGroups.get(relayEndpoint)
    if (existing) {
      existing.hosts.push(host)
      continue
    }

    relayGroups.set(relayEndpoint, {
      id: `relay:${relayEndpoint}`,
      relayEndpoint,
      hosts: [host]
    })
  }

  const groups = Array.from(relayGroups.values())
  if (localHosts.length > 0) {
    groups.push({ id: 'local', relayEndpoint: null, hosts: localHosts })
  }
  return groups
}

export function hostNetworkAddress(endpoint: string): string {
  try {
    return new URL(endpoint).hostname
  } catch {
    return endpoint.trim()
  }
}

export function hostDisplayName(host: Pick<HostProfile, 'name'>): string | null {
  const name = host.name.trim()
  return name && !GENERIC_HOST_NAMES.has(name.toLowerCase()) ? name : null
}
