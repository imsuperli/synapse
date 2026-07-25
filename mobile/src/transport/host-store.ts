import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'
import {
  HostProfileSchema,
  StoredHostProfileSchema,
  type HostConnectionRoute,
  type HostProfile,
  type StoredHostProfile
} from './types'
import { getNextHostNameFromHosts } from './host-names'
import { normalizeRelayEndpoint } from '../../../src/shared/remote/relay'

const STORAGE_KEY = 'synapse:hosts'
// Why: SecureStore keys must match [A-Za-z0-9._-]; colons are rejected.
// Use dots as the separator so the key shape stays readable while
// satisfying the validator.
const TOKEN_KEY_PREFIX = 'synapse.host-token.'
const WEB_TOKEN_KEY_PREFIX = 'synapse:web-host-token:'
const RELAY_TOKEN_KEY_PREFIX = 'synapse.relay-client-token.'
const WEB_RELAY_TOKEN_KEY_PREFIX = 'synapse:web-relay-client-token:'

// Why: WHEN_UNLOCKED_THIS_DEVICE_ONLY keeps the pairing token off
// iCloud Keychain and out of iCloud/iTunes backup restores onto a
// different physical device. Reads/writes are silent (no biometric
// prompt) since we don't request access control flags.
const KEYCHAIN_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY
}

function tokenKey(hostId: string): string {
  return `${TOKEN_KEY_PREFIX}${hostId}`
}

function webTokenKey(hostId: string): string {
  return `${WEB_TOKEN_KEY_PREFIX}${hostId}`
}

function relayTokenKey(hostId: string): string {
  return `${RELAY_TOKEN_KEY_PREFIX}${hostId}`
}

function webRelayTokenKey(hostId: string): string {
  return `${WEB_RELAY_TOKEN_KEY_PREFIX}${hostId}`
}

async function readDeviceToken(hostId: string): Promise<string | null> {
  // Why: Expo SecureStore has no working web backend; keep this fallback
  // web-only so native builds still keep pairing tokens in the keychain.
  if (Platform.OS === 'web') {
    return AsyncStorage.getItem(webTokenKey(hostId))
  }
  return SecureStore.getItemAsync(tokenKey(hostId), KEYCHAIN_OPTIONS)
}

async function writeDeviceToken(hostId: string, token: string): Promise<void> {
  if (Platform.OS === 'web') {
    await AsyncStorage.setItem(webTokenKey(hostId), token)
    return
  }
  await SecureStore.setItemAsync(tokenKey(hostId), token, KEYCHAIN_OPTIONS)
}

async function readRelayClientToken(hostId: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    return AsyncStorage.getItem(webRelayTokenKey(hostId))
  }
  return SecureStore.getItemAsync(relayTokenKey(hostId), KEYCHAIN_OPTIONS)
}

async function writeRelayClientToken(hostId: string, token: string): Promise<void> {
  if (Platform.OS === 'web') {
    await AsyncStorage.setItem(webRelayTokenKey(hostId), token)
    return
  }
  await SecureStore.setItemAsync(relayTokenKey(hostId), token, KEYCHAIN_OPTIONS)
}

async function deleteRelayClientToken(hostId: string): Promise<void> {
  if (Platform.OS === 'web') {
    await AsyncStorage.removeItem(webRelayTokenKey(hostId))
    return
  }
  await SecureStore.deleteItemAsync(relayTokenKey(hostId), KEYCHAIN_OPTIONS)
}

async function deleteDeviceToken(hostId: string): Promise<void> {
  if (Platform.OS === 'web') {
    await AsyncStorage.removeItem(webTokenKey(hostId))
    return
  }
  await SecureStore.deleteItemAsync(tokenKey(hostId), KEYCHAIN_OPTIONS)
}

// Why: SecureStore reads on Android Keystore can take 50-200ms each, and
// loadHosts() is called from every screen mount + every useFocusEffect.
// Stack with N hosts and you get N*200ms blocking every navigation, which
// triggers connection-churn cycles in the home-screen useEffect. Cache
// per-hostId in memory; invalidate only on save/remove. The cache lives
// for the JS-runtime lifetime, which matches AsyncStorage semantics
// (cleared on app uninstall, persisted across foreground/background).
const tokenCache = new Map<string, string>()
const relayTokenCache = new Map<string, string>()
let inflightLoad: Promise<HostProfile[]> | null = null

export async function loadHosts(): Promise<HostProfile[]> {
  // Why: deduplicate concurrent loadHosts() calls so multiple screens
  // mounting simultaneously share one Keychain read pass.
  if (inflightLoad) {
    return inflightLoad
  }
  inflightLoad = doLoadHosts().finally(() => {
    inflightLoad = null
  })
  return inflightLoad
}

async function doLoadHosts(): Promise<HostProfile[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY)
  if (!raw) {
    return []
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) {
    return []
  }

  const out: HostProfile[] = []
  for (const item of parsed) {
    // Why: pre-v0.0.3 records carry the deviceToken in AsyncStorage.
    // Drop them silently — the three pre-launch users will re-pair on
    // first run rather than carry a migration shim through the auth
    // path.
    if (item && typeof item === 'object' && 'deviceToken' in item) {
      continue
    }
    const stored = StoredHostProfileSchema.safeParse(item)
    if (!stored.success) {
      continue
    }

    let token = tokenCache.get(stored.data.id)
    if (!token) {
      let fetched: string | null
      try {
        fetched = await readDeviceToken(stored.data.id)
      } catch {
        // Why: a transient Keychain failure for one entry (e.g.
        // errSecInteractionNotAllowed while the device is briefly locked,
        // or a single corrupt record) must not blank the entire host list.
        // Skip just this host — it'll reappear on the next load.
        continue
      }
      if (!fetched) {
        // Why: orphaned metadata with no matching keychain entry — most
        // likely a stale record from a development install. Skip it
        // rather than surface a half-broken host.
        continue
      }
      token = fetched
      tokenCache.set(stored.data.id, token)
    }

    let relayClientToken: string | undefined
    if (stored.data.relayEndpoint && stored.data.relaySessionId) {
      relayClientToken = relayTokenCache.get(stored.data.id)
      if (!relayClientToken) {
        let fetchedRelayToken: string | null
        try {
          fetchedRelayToken = await readRelayClientToken(stored.data.id)
        } catch {
          fetchedRelayToken = null
        }
        if (fetchedRelayToken) {
          relayClientToken = fetchedRelayToken
          relayTokenCache.set(stored.data.id, relayClientToken)
        }
      }
    }

    const hasRelay = Boolean(
      relayClientToken && stored.data.relayEndpoint && stored.data.relaySessionId
    )
    out.push({
      id: stored.data.id,
      name: stored.data.name,
      endpoint: stored.data.endpoint,
      connectionRoute:
        stored.data.connectionRoute === 'relay' && hasRelay
          ? 'relay'
          : stored.data.connectionRoute === 'direct'
            ? 'direct'
            : hasRelay
              ? 'relay'
              : 'direct',
      publicKeyB64: stored.data.publicKeyB64,
      lastConnected: stored.data.lastConnected,
      ...(hasRelay && relayClientToken && stored.data.relayEndpoint && stored.data.relaySessionId
        ? {
            relayEndpoint: stored.data.relayEndpoint,
            relaySessionId: stored.data.relaySessionId,
            relayClientToken
          }
        : {}),
      deviceToken: token
    })
  }
  return consolidateDuplicateHosts(out)
}

async function consolidateDuplicateHosts(hosts: HostProfile[]): Promise<HostProfile[]> {
  const byPublicKey = new Map<string, HostProfile[]>()
  for (const host of hosts) {
    const matches = byPublicKey.get(host.publicKeyB64) ?? []
    matches.push(host)
    byPublicKey.set(host.publicKeyB64, matches)
  }

  const consolidated: HostProfile[] = []
  const duplicateIds: string[] = []
  for (const matches of byPublicKey.values()) {
    if (matches.length === 1) {
      consolidated.push(matches[0])
      continue
    }

    const newestFirst = [...matches].sort((a, b) => b.lastConnected - a.lastConnected)
    const newest = newestFirst[0]
    const relaySource = newestFirst.find(hasCompleteRelayConfig)
    consolidated.push({
      ...newest,
      ...(relaySource
        ? {
            relayEndpoint: relaySource.relayEndpoint,
            relaySessionId: relaySource.relaySessionId,
            relayClientToken: relaySource.relayClientToken
          }
        : {})
    })
    duplicateIds.push(
      ...matches.filter((host) => host.id !== newest.id).map((host) => host.id)
    )
  }

  if (duplicateIds.length === 0) {
    return consolidated
  }

  try {
    for (const host of consolidated) {
      await writeDeviceToken(host.id, host.deviceToken)
      if (host.relayClientToken) {
        await writeRelayClientToken(host.id, host.relayClientToken)
      }
    }
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(consolidated.map(toStored)))
    await Promise.all(
      duplicateIds.flatMap((hostId) => [deleteDeviceToken(hostId), deleteRelayClientToken(hostId)])
    )
    for (const hostId of duplicateIds) {
      tokenCache.delete(hostId)
      relayTokenCache.delete(hostId)
    }
    for (const host of consolidated) {
      tokenCache.set(host.id, host.deviceToken)
      if (host.relayClientToken) {
        relayTokenCache.set(host.id, host.relayClientToken)
      }
    }
  } catch {
    // A cleanup failure must not hide otherwise usable paired computers.
  }
  return consolidated
}

async function loadStoredHosts(): Promise<StoredHostProfile[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY)
  if (!raw) {
    return []
  }
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed.flatMap((item) => {
      // Why: same drop-old-records rule as loadHosts; keeps internal
      // mutators from re-persisting pre-v0.0.3 entries.
      if (item && typeof item === 'object' && 'deviceToken' in item) {
        return []
      }
      const result = StoredHostProfileSchema.safeParse(item)
      return result.success ? [result.data] : []
    })
  } catch {
    return []
  }
}

function toStored(host: HostProfile): StoredHostProfile {
  return {
    id: host.id,
    name: host.name,
    endpoint: host.endpoint,
    connectionRoute: host.connectionRoute,
    publicKeyB64: host.publicKeyB64,
    relayEndpoint: host.relayEndpoint,
    relaySessionId: host.relaySessionId,
    lastConnected: host.lastConnected
  }
}

export async function saveHost(host: HostProfile): Promise<void> {
  const validated = HostProfileSchema.parse(host)
  const hosts = await loadStoredHosts()
  const stored = toStored(validated)
  const index = hosts.findIndex((h) => h.id === stored.id)
  if (index >= 0) {
    hosts[index] = stored
  } else {
    hosts.push(stored)
  }
  // Why: write metadata BEFORE the keychain token so a crash between the two
  // leaves orphaned metadata (which loadHosts skips and removeHost can clean
  // up) rather than an orphaned keychain token with no metadata pointer —
  // the latter would persist forever since removeHost only deletes by hostId
  // from current metadata.
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(hosts))
  await writeDeviceToken(stored.id, validated.deviceToken)
  if (validated.relayClientToken) {
    await writeRelayClientToken(stored.id, validated.relayClientToken)
    relayTokenCache.set(stored.id, validated.relayClientToken)
  } else {
    await deleteRelayClientToken(stored.id)
    relayTokenCache.delete(stored.id)
  }
  tokenCache.set(stored.id, validated.deviceToken)
}

export async function savePairedHost(
  host: Omit<HostProfile, 'id' | 'name' | 'connectionRoute' | 'lastConnected'> & {
    name?: string
  }
): Promise<HostProfile> {
  const existingHosts = await loadHosts()
  const existing = existingHosts.find((saved) => saved.publicKeyB64 === host.publicKeyB64)
  const hasRelay = hasCompleteRelayConfig(host)
  const offeredName = host.name?.trim()
  const savedHost: HostProfile = {
    ...host,
    id: existing?.id ?? `host-${Date.now()}`,
    name: existing?.name ?? (offeredName || getNextHostNameFromHosts(existingHosts)),
    connectionRoute: hasRelay ? 'relay' : 'direct',
    lastConnected: Date.now()
  }
  await saveHost(savedHost)
  return savedHost
}

export async function removeHost(hostId: string): Promise<void> {
  const hosts = await loadStoredHosts()
  const filtered = hosts.filter((h) => h.id !== hostId)
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(filtered))
  await deleteDeviceToken(hostId)
  await deleteRelayClientToken(hostId)
  tokenCache.delete(hostId)
  relayTokenCache.delete(hostId)
}

export async function renameHost(hostId: string, newName: string): Promise<void> {
  const hosts = await loadStoredHosts()
  const host = hosts.find((h) => h.id === hostId)
  if (host) {
    host.name = newName
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(hosts))
  }
}

export async function updateHostRelayEndpoint(hostId: string, endpoint: string): Promise<void> {
  const normalizedEndpoint = normalizeRelayEndpoint(endpoint)
  const hosts = await loadStoredHosts()
  const host = hosts.find((h) => h.id === hostId)
  if (!host) {
    throw new Error('Host not found')
  }
  if (!host.relaySessionId) {
    throw new Error('This host was not paired with relay support')
  }
  host.relayEndpoint = normalizedEndpoint
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(hosts))
}

export async function setHostConnectionRoute(
  hostId: string,
  connectionRoute: HostConnectionRoute
): Promise<void> {
  const hosts = await loadStoredHosts()
  const host = hosts.find((saved) => saved.id === hostId)
  if (!host) {
    throw new Error('Host not found')
  }
  if (connectionRoute === 'relay') {
    const relayToken = relayTokenCache.get(hostId) ?? (await readRelayClientToken(hostId))
    if (!host.relayEndpoint || !host.relaySessionId || !relayToken) {
      throw new Error('This host was not paired with relay support')
    }
    relayTokenCache.set(hostId, relayToken)
  }
  host.connectionRoute = connectionRoute
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(hosts))
}

export async function updateHostDirectEndpoint(hostId: string, endpoint: string): Promise<void> {
  const normalizedEndpoint = validateDirectEndpoint(endpoint)
  const hosts = await loadStoredHosts()
  const host = hosts.find((saved) => saved.id === hostId)
  if (!host) {
    throw new Error('Host not found')
  }
  if (host.endpoint === normalizedEndpoint) {
    return
  }
  host.endpoint = normalizedEndpoint
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(hosts))
}

export async function getNextHostName(): Promise<string> {
  const hosts = await loadStoredHosts()
  return getNextHostNameFromHosts(hosts)
}

export async function updateLastConnected(hostId: string): Promise<void> {
  const hosts = await loadStoredHosts()
  const host = hosts.find((h) => h.id === hostId)
  if (host) {
    host.lastConnected = Date.now()
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(hosts))
  }
}

function hasCompleteRelayConfig(
  host: Pick<HostProfile, 'relayEndpoint' | 'relaySessionId' | 'relayClientToken'>
): boolean {
  return Boolean(host.relayEndpoint && host.relaySessionId && host.relayClientToken)
}

function validateDirectEndpoint(endpoint: string): string {
  const normalized = endpoint.trim()
  let parsed: URL
  try {
    parsed = new URL(normalized)
  } catch {
    throw new Error('Invalid direct endpoint')
  }
  if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
    throw new Error('Direct endpoint must use ws:// or wss://')
  }
  return normalized
}
