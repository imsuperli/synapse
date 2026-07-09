import { loadHosts, updateLastConnected } from '../transport/host-store'
import { connect, type RpcClient } from '../transport/rpc-client'
import type { ConnectionLogEntry, ConnectionState, HostProfile, RpcResponse } from '../transport/types'
import type { RemoteDeviceScope } from '../../../src/shared/remote/methods'
import type {
  RemotePaneSummary,
  RemoteWindowSummary,
  WindowCreateResult,
  WindowStartResult
} from '../../../src/shared/remote/window-protocol'
import { WindowStatus, type PaneBackend, type PaneKind, type WindowKind } from '../../../src/shared/types/window'

export type {
  RemoteDeviceScope,
  RemotePaneSummary,
  RemoteWindowSummary,
  WindowCreateResult,
  WindowStartResult
}

export type RemoteTerminalSummary = {
  windowId: string
  paneId: string
  sessionId: string
  pid: number
  backend: string
  status: 'alive' | 'exited'
  workingDirectory: string
  command?: string
  profileId?: string
}

export type RemoteCapabilities = {
  protocolVersion: number
  methods: string[]
}

export type RemoteStatus = {
  ok: boolean
  protocolVersion: number
  deviceScope: RemoteDeviceScope
}

export type TerminalHistoryResult = {
  windowId: string
  paneId: string
  chunks: string[]
  firstSeq: number
  lastSeq: number
  gap: boolean
  keyboardState?: unknown
}

export type TerminalOutputEvent = {
  windowId: string
  paneId: string
  seq: number
  data: string
}

export type TerminalSubscribeResult = {
  subscriptionId: string
  firstSeq: number
  lastSeq: number
  gap: boolean
}

export type TerminalClearResult = {
  windowId: string
  paneId: string
  cleared: true
  lastSeq: number
}

export async function loadHostById(hostId: string): Promise<HostProfile | null> {
  const hosts = await loadHosts()
  return hosts.find((host) => host.id === hostId) ?? null
}

export function connectToHost(
  host: HostProfile,
  options: {
    onStateChange?: (state: ConnectionState) => void
    onLog?: (entry: ConnectionLogEntry) => void
  } = {}
): RpcClient {
  const relay = host.relayEndpoint && host.relaySessionId && host.relayClientToken
    ? {
        endpoint: host.relayEndpoint,
        sessionId: host.relaySessionId,
        clientToken: host.relayClientToken
      }
    : undefined
  const client = connect(host.endpoint, host.deviceToken, host.publicKeyB64, {
    ...options,
    relay
  })
  void updateLastConnected(host.id).catch(() => undefined)
  return client
}

export async function requestRemoteStatus(client: RpcClient): Promise<RemoteStatus> {
  const response = await client.sendRequest('status.get')
  if (!response.ok) {
    throw new Error(response.error.message)
  }
  return parseRemoteStatus(response.result)
}

export async function requestRemoteCapabilities(client: RpcClient): Promise<RemoteCapabilities> {
  const response = await client.sendRequest('remote.capabilities')
  if (!response.ok) {
    throw new Error(response.error.message)
  }
  return parseRemoteCapabilities(response.result)
}

export async function requestTerminalList(client: RpcClient): Promise<RemoteTerminalSummary[]> {
  const response = await client.sendRequest('terminal.list')
  if (!response.ok) {
    throw new Error(response.error.message)
  }
  return parseTerminalList(response)
}

export async function requestWindowList(client: RpcClient): Promise<RemoteWindowSummary[]> {
  const response = await client.sendRequest('window.list', { terminalOnly: true })
  if (!response.ok) {
    throw new Error(response.error.message)
  }
  return parseWindowList(response.result)
}

export async function startRemoteWindow(
  client: RpcClient,
  windowId: string,
  paneId?: string
): Promise<WindowStartResult> {
  const response = await client.sendRequest('window.start', {
    windowId,
    ...(paneId ? { paneId } : {})
  })
  if (!response.ok) {
    throw new Error(response.error.message)
  }
  return parseWindowStartResult(response.result)
}

export async function createRemoteWindow(client: RpcClient): Promise<WindowCreateResult> {
  const response = await client.sendRequest('window.create', {})
  if (!response.ok) {
    throw new Error(response.error.message)
  }
  return parseWindowCreateResult(response.result)
}

export async function requestTerminalHistory(
  client: RpcClient,
  windowId: string,
  paneId: string
): Promise<TerminalHistoryResult> {
  const response = await client.sendRequest('terminal.history', { windowId, paneId })
  if (!response.ok) {
    throw new Error(response.error.message)
  }
  return parseTerminalHistory(response.result)
}

export async function sendTerminalInput(
  client: RpcClient,
  windowId: string,
  paneId: string,
  data: string
): Promise<void> {
  const response = await client.sendRequest('terminal.send', { windowId, paneId, data })
  if (!response.ok) {
    throw new Error(response.error.message)
  }
}

export async function clearTerminal(
  client: RpcClient,
  windowId: string,
  paneId: string
): Promise<TerminalClearResult> {
  const response = await client.sendRequest('terminal.clear', { windowId, paneId })
  if (!response.ok) {
    throw new Error(response.error.message)
  }
  return parseTerminalClearResult(response.result)
}

export function parseRemoteStatus(value: unknown): RemoteStatus {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid remote status response')
  }
  const result = value as Record<string, unknown>
  const deviceScope = result.deviceScope
  if (
    result.ok !== true ||
    typeof result.protocolVersion !== 'number' ||
    !isRemoteDeviceScope(deviceScope)
  ) {
    throw new Error('Invalid remote status response')
  }
  return {
    ok: true,
    protocolVersion: result.protocolVersion,
    deviceScope
  }
}

export function parseRemoteCapabilities(value: unknown): RemoteCapabilities {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid remote capabilities response')
  }
  const result = value as Record<string, unknown>
  return {
    protocolVersion: typeof result.protocolVersion === 'number' ? result.protocolVersion : 0,
    methods: Array.isArray(result.methods)
      ? result.methods.filter((method): method is string => typeof method === 'string')
      : []
  }
}

export function parseTerminalList(response: RpcResponse): RemoteTerminalSummary[] {
  if (!response.ok) {
    return []
  }
  const result = response.result as { terminals?: unknown }
  if (!Array.isArray(result.terminals)) {
    return []
  }
  return result.terminals.flatMap((terminal) => {
    if (!terminal || typeof terminal !== 'object') {
      return []
    }
    const item = terminal as Record<string, unknown>
    if (typeof item.windowId !== 'string' || typeof item.paneId !== 'string') {
      return []
    }
    return [
      {
        windowId: item.windowId,
        paneId: item.paneId,
        sessionId: typeof item.sessionId === 'string' ? item.sessionId : `${item.windowId}:${item.paneId}`,
        pid: typeof item.pid === 'number' ? item.pid : 0,
        backend: typeof item.backend === 'string' ? item.backend : 'local',
        status: item.status === 'exited' ? 'exited' : 'alive',
        workingDirectory:
          typeof item.workingDirectory === 'string' ? item.workingDirectory : '',
        command: typeof item.command === 'string' ? item.command : undefined,
        profileId: typeof item.profileId === 'string' ? item.profileId : undefined
      }
    ]
  })
}

export function parseWindowList(value: unknown): RemoteWindowSummary[] {
  if (!value || typeof value !== 'object') {
    return []
  }
  const result = value as Record<string, unknown>
  if (!Array.isArray(result.windows)) {
    return []
  }
  return result.windows.flatMap((window) => {
    if (!window || typeof window !== 'object') {
      return []
    }
    const item = window as Record<string, unknown>
    if (typeof item.windowId !== 'string' || typeof item.name !== 'string') {
      return []
    }
    const panes = Array.isArray(item.panes)
      ? item.panes.flatMap((pane) => parseRemotePaneSummary(pane))
      : []
    return [
      {
        windowId: item.windowId,
        name: item.name,
        kind: isWindowKind(item.kind) ? item.kind : null,
        archived: item.archived === true,
        activePaneId: typeof item.activePaneId === 'string' ? item.activePaneId : '',
        createdAt: typeof item.createdAt === 'string' ? item.createdAt : '',
        lastActiveAt: typeof item.lastActiveAt === 'string' ? item.lastActiveAt : '',
        paneCount: typeof item.paneCount === 'number' ? item.paneCount : panes.length,
        terminalPaneCount:
          typeof item.terminalPaneCount === 'number'
            ? item.terminalPaneCount
            : panes.filter((pane) => pane.kind === 'terminal').length,
        panes
      }
    ]
  })
}

export function parseWindowStartResult(value: unknown): WindowStartResult {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid window start response')
  }
  const result = value as Record<string, unknown>
  const windows = parseWindowList({ windows: [result.window] })
  if (windows.length === 0) {
    throw new Error('Invalid window start response')
  }
  const pane = parseRemotePaneSummary(result.pane)[0] ?? null
  const startedPanes = Array.isArray(result.startedPanes)
    ? result.startedPanes.flatMap((item) => parseRemotePaneSummary(item))
    : []
  return {
    window: windows[0]!,
    pane,
    startedPanes
  }
}

export function parseWindowCreateResult(value: unknown): WindowCreateResult {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid window create response')
  }
  const result = value as Record<string, unknown>
  const windows = parseWindowList({ windows: [result.window] })
  const pane = parseRemotePaneSummary(result.pane)[0] ?? null
  if (windows.length === 0 || !pane) {
    throw new Error('Invalid window create response')
  }
  return {
    window: windows[0]!,
    pane
  }
}

function parseRemotePaneSummary(value: unknown): RemotePaneSummary[] {
  if (!value || typeof value !== 'object') {
    return []
  }
  const item = value as Record<string, unknown>
  if (typeof item.windowId !== 'string' || typeof item.paneId !== 'string') {
    return []
  }
  return [
    {
      windowId: item.windowId,
      paneId: item.paneId,
      active: item.active === true,
      kind: isPaneKind(item.kind) ? item.kind : 'terminal',
      backend: isPaneBackend(item.backend) ? item.backend : null,
      status: isWindowStatus(item.status) ? item.status : WindowStatus.Completed,
      running: item.running === true,
      pid: typeof item.pid === 'number' ? item.pid : null,
      sessionId: typeof item.sessionId === 'string' ? item.sessionId : null,
      cwd: typeof item.cwd === 'string' ? item.cwd : null,
      command: typeof item.command === 'string' ? item.command : null,
      title: typeof item.title === 'string' ? item.title : undefined
    }
  ]
}

function isRemoteDeviceScope(value: unknown): value is RemoteDeviceScope {
  return (
    value === 'mobile.read' ||
    value === 'mobile.control' ||
    value === 'mobile.window-control' ||
    value === 'mobile.admin'
  )
}

function isWindowKind(value: unknown): value is WindowKind {
  return value === 'local' || value === 'ssh' || value === 'mixed'
}

function isPaneKind(value: unknown): value is PaneKind {
  return value === 'terminal' || value === 'browser' || value === 'code' || value === 'chat'
}

function isPaneBackend(value: unknown): value is PaneBackend {
  return value === 'local' || value === 'ssh'
}

function isWindowStatus(value: unknown): value is WindowStatus {
  return (
    value === WindowStatus.Running ||
    value === WindowStatus.WaitingForInput ||
    value === WindowStatus.Completed ||
    value === WindowStatus.Error ||
    value === WindowStatus.Restoring ||
    value === WindowStatus.Paused
  )
}

export function parseTerminalHistory(value: unknown): TerminalHistoryResult {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid terminal history response')
  }
  const result = value as Record<string, unknown>
  return {
    windowId: typeof result.windowId === 'string' ? result.windowId : '',
    paneId: typeof result.paneId === 'string' ? result.paneId : '',
    chunks: Array.isArray(result.chunks)
      ? result.chunks.filter((chunk): chunk is string => typeof chunk === 'string')
      : [],
    firstSeq: typeof result.firstSeq === 'number' ? result.firstSeq : 0,
    lastSeq: typeof result.lastSeq === 'number' ? result.lastSeq : 0,
    gap: result.gap === true,
    keyboardState: result.keyboardState
  }
}

export function parseTerminalSubscribeResult(value: unknown): TerminalSubscribeResult | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const result = value as Record<string, unknown>
  if (typeof result.subscriptionId !== 'string') {
    return null
  }
  return {
    subscriptionId: result.subscriptionId,
    firstSeq: typeof result.firstSeq === 'number' ? result.firstSeq : 0,
    lastSeq: typeof result.lastSeq === 'number' ? result.lastSeq : 0,
    gap: result.gap === true
  }
}

export function parseTerminalClearResult(value: unknown): TerminalClearResult {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid terminal clear response')
  }
  const result = value as Record<string, unknown>
  if (
    typeof result.windowId !== 'string' ||
    typeof result.paneId !== 'string' ||
    result.cleared !== true ||
    typeof result.lastSeq !== 'number'
  ) {
    throw new Error('Invalid terminal clear response')
  }
  return {
    windowId: result.windowId,
    paneId: result.paneId,
    cleared: true,
    lastSeq: result.lastSeq
  }
}

export function parseTerminalOutputEvent(value: unknown): TerminalOutputEvent | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const event = value as Record<string, unknown>
  if (
    typeof event.windowId !== 'string' ||
    typeof event.paneId !== 'string' ||
    typeof event.data !== 'string'
  ) {
    return null
  }
  return {
    windowId: event.windowId,
    paneId: event.paneId,
    seq: typeof event.seq === 'number' ? event.seq : 0,
    data: event.data
  }
}
