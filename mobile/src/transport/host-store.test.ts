import { beforeEach, describe, expect, it, vi } from 'vitest'

const storage = vi.hoisted(() => ({
  asyncStorage: new Map<string, string>(),
  secureStorage: new Map<string, string>()
}))

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn((key: string) => Promise.resolve(storage.asyncStorage.get(key) ?? null)),
    setItem: vi.fn((key: string, value: string) => {
      storage.asyncStorage.set(key, value)
      return Promise.resolve()
    }),
    removeItem: vi.fn((key: string) => {
      storage.asyncStorage.delete(key)
      return Promise.resolve()
    })
  }
}))

vi.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
  getItemAsync: vi.fn((key: string) => Promise.resolve(storage.secureStorage.get(key) ?? null)),
  setItemAsync: vi.fn((key: string, value: string) => {
    storage.secureStorage.set(key, value)
    return Promise.resolve()
  }),
  deleteItemAsync: vi.fn((key: string) => {
    storage.secureStorage.delete(key)
    return Promise.resolve()
  })
}))

import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SecureStore from 'expo-secure-store'
import { loadHosts, removeHost, saveHost, updateHostRelayEndpoint } from './host-store'

const HOSTS_KEY = 'synapse:hosts'

describe('host-store token storage boundary', () => {
  beforeEach(() => {
    storage.asyncStorage.clear()
    storage.secureStorage.clear()
    vi.clearAllMocks()
  })

  it('stores host metadata in AsyncStorage and the device token in SecureStore', async () => {
    await saveHost({
      id: 'host-secure-1',
      name: 'Laptop',
      endpoint: 'ws://192.168.1.10:6868',
      deviceToken: 'token-secret',
      publicKeyB64: 'desktop-public-key',
      relayEndpoint: 'wss://relay.example.com/v1/relay',
      relaySessionId: 'relay-1',
      relayClientToken: 'relay-client-secret',
      lastConnected: 100
    })

    const rawMetadata = storage.asyncStorage.get(HOSTS_KEY)
    expect(rawMetadata).toBeTruthy()
    expect(JSON.parse(rawMetadata ?? '[]')).toEqual([
      {
        id: 'host-secure-1',
        name: 'Laptop',
        endpoint: 'ws://192.168.1.10:6868',
        publicKeyB64: 'desktop-public-key',
        relayEndpoint: 'wss://relay.example.com/v1/relay',
        relaySessionId: 'relay-1',
        lastConnected: 100
      }
    ])
    expect(rawMetadata).not.toContain('token-secret')
    expect(rawMetadata).not.toContain('relay-client-secret')
    expect(storage.secureStorage.get('synapse.host-token.host-secure-1')).toBe('token-secret')
    expect(storage.secureStorage.get('synapse.relay-client-token.host-secure-1')).toBe(
      'relay-client-secret'
    )
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      'synapse.host-token.host-secure-1',
      'token-secret',
      { keychainAccessible: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY' }
    )
  })

  it('joins SecureStore tokens onto valid host metadata during load', async () => {
    storage.asyncStorage.set(
      HOSTS_KEY,
      JSON.stringify([
        {
          id: 'host-load-1',
          name: 'Workstation',
          endpoint: 'wss://desktop.example.com',
          publicKeyB64: 'desktop-public-key',
          relayEndpoint: 'wss://relay.example.com/v1/relay',
          relaySessionId: 'relay-load-1',
          lastConnected: 200
        }
      ])
    )
    storage.secureStorage.set('synapse.host-token.host-load-1', 'loaded-token')
    storage.secureStorage.set(
      'synapse.relay-client-token.host-load-1',
      'loaded-relay-client-token'
    )

    await expect(loadHosts()).resolves.toEqual([
      {
        id: 'host-load-1',
        name: 'Workstation',
        endpoint: 'wss://desktop.example.com',
        deviceToken: 'loaded-token',
        publicKeyB64: 'desktop-public-key',
        relayEndpoint: 'wss://relay.example.com/v1/relay',
        relaySessionId: 'relay-load-1',
        relayClientToken: 'loaded-relay-client-token',
        lastConnected: 200
      }
    ])
    expect(SecureStore.getItemAsync).toHaveBeenCalledWith('synapse.host-token.host-load-1', {
      keychainAccessible: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY'
    })
  })

  it('drops legacy metadata records that still contain a deviceToken', async () => {
    storage.asyncStorage.set(
      HOSTS_KEY,
      JSON.stringify([
        {
          id: 'legacy-host',
          name: 'Legacy',
          endpoint: 'ws://192.168.1.10:6868',
          deviceToken: 'must-not-load',
          publicKeyB64: 'desktop-public-key',
          lastConnected: 0
        }
      ])
    )

    await expect(loadHosts()).resolves.toEqual([])
    expect(SecureStore.getItemAsync).not.toHaveBeenCalled()
  })

  it('removes metadata and secure token together', async () => {
    await saveHost({
      id: 'host-remove-1',
      name: 'Remove Me',
      endpoint: 'ws://192.168.1.10:6868',
      deviceToken: 'remove-token',
      publicKeyB64: 'desktop-public-key',
      lastConnected: 0
    })

    await removeHost('host-remove-1')

    expect(JSON.parse(storage.asyncStorage.get(HOSTS_KEY) ?? '[]')).toEqual([])
    expect(storage.secureStorage.has('synapse.host-token.host-remove-1')).toBe(false)
    expect(storage.secureStorage.has('synapse.relay-client-token.host-remove-1')).toBe(false)
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(HOSTS_KEY, '[]')
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('synapse.host-token.host-remove-1', {
      keychainAccessible: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY'
    })
  })

  it('updates the saved relay endpoint without touching the relay token', async () => {
    await saveHost({
      id: 'host-relay-update',
      name: 'Relay Host',
      endpoint: 'ws://127.0.0.1:6868',
      deviceToken: 'device-token',
      publicKeyB64: 'desktop-public-key',
      relayEndpoint: 'wss://old-relay.example.com/v1/relay',
      relaySessionId: 'relay-session',
      relayClientToken: 'relay-client-token',
      lastConnected: 0
    })

    await updateHostRelayEndpoint('host-relay-update', 'wss://new-relay.example.com')

    expect(JSON.parse(storage.asyncStorage.get(HOSTS_KEY) ?? '[]')[0]).toMatchObject({
      relayEndpoint: 'wss://new-relay.example.com/v1/relay',
      relaySessionId: 'relay-session'
    })
    expect(storage.secureStorage.get('synapse.relay-client-token.host-relay-update')).toBe(
      'relay-client-token'
    )
  })
})
