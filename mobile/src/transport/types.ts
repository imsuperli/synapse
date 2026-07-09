import { z } from 'zod'
export type { PairingOffer } from '../../../src/shared/remote/pairing'

export type RpcRequest = {
  id: string
  method: string
  params?: unknown
}

export type RpcSuccess = {
  id: string
  ok: true
  result: unknown
  streaming?: true
  _meta?: { runtimeId: string }
}

export type RpcFailure = {
  id: string
  ok: false
  error: { code: string; message: string; data?: unknown }
  _meta?: { runtimeId: string }
}

export type RpcResponse = RpcSuccess | RpcFailure

export type ConnectionLogLevel = 'info' | 'success' | 'warn' | 'error'

export type ConnectionLogEntry = {
  id: string
  ts: number
  level: ConnectionLogLevel
  // Short human-readable phase label, e.g. 'Opening WebSocket'.
  message: string
  // Optional second line for endpoint/error/elapsed detail.
  detail?: string
}

export type ConnectionLogSink = (entry: ConnectionLogEntry) => void

export type ConnectionState =
  | 'connecting'
  | 'handshaking'
  | 'connected'
  | 'disconnected'
  | 'reconnecting'
  | 'auth-failed'

export type HostProfile = {
  id: string
  name: string
  endpoint: string
  deviceToken: string
  publicKeyB64: string
  relayEndpoint?: string
  relaySessionId?: string
  relayClientToken?: string
  lastConnected: number
}

const HostProfileBaseSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  endpoint: z.string().min(1),
  deviceToken: z.string().min(1),
  publicKeyB64: z.string().min(1),
  relayEndpoint: z.string().min(1).optional(),
  relaySessionId: z.string().min(1).optional(),
  relayClientToken: z.string().min(1).optional(),
  lastConnected: z.number().finite()
})

export const HostProfileSchema = HostProfileBaseSchema.superRefine((host, ctx) => {
  const relayFields = [host.relayEndpoint, host.relaySessionId, host.relayClientToken]
  const hasAny = relayFields.some((value) => value !== undefined)
  const hasAll = relayFields.every((value) => value !== undefined)
  if (hasAny && !hasAll) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Relay host fields must be provided together',
      path: ['relayEndpoint']
    })
  }
})

// Why: persisted host record after the v0.0.3 keychain split. The
// deviceToken is held in iOS Keychain via expo-secure-store and joined
// in at load time; it must NOT appear in AsyncStorage anymore.
const StoredHostProfileBaseSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  endpoint: z.string().min(1),
  publicKeyB64: z.string().min(1),
  relayEndpoint: z.string().min(1).optional(),
  relaySessionId: z.string().min(1).optional(),
  lastConnected: z.number().finite()
})

export const StoredHostProfileSchema = StoredHostProfileBaseSchema.superRefine((host, ctx) => {
  const relayFields = [host.relayEndpoint, host.relaySessionId]
  const hasAny = relayFields.some((value) => value !== undefined)
  const hasAll = relayFields.every((value) => value !== undefined)
  if (hasAny && !hasAll) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Stored relay host fields must be provided together',
      path: ['relayEndpoint']
    })
  }
})

export type StoredHostProfile = z.infer<typeof StoredHostProfileSchema>
