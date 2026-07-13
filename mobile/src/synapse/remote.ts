import { loadHosts, updateLastConnected } from '../transport/host-store'
import { connect, type RpcClient } from '../transport/rpc-client'
import type { ConnectionLogEntry, ConnectionState, HostProfile, RpcResponse } from '../transport/types'
import type { RemoteDeviceScope } from '../../../src/shared/remote/methods'
import type {
  RemotePaneSummary,
  RemoteWindowSummary,
  PaneCloseResult,
  PaneDeleteResult,
  GroupCreateResult,
  GroupDeleteResult,
  GroupWindowRemoveResult,
  WindowCreateResult,
  WindowCloseResult,
  WindowDeleteResult,
  RemoteWindowGroupSummary,
  WindowCreateParams,
  WindowStartResult
} from '../../../src/shared/remote/window-protocol'
import type {
  RemoteSSHProfileSummary,
  SSHProfileListResult
} from '../../../src/shared/remote/ssh-protocol'
import { WindowStatus, type PaneBackend, type PaneKind, type WindowKind } from '../../../src/shared/types/window'

export type {
  RemoteDeviceScope,
  RemotePaneSummary,
  RemoteWindowSummary,
  PaneCloseResult,
  PaneDeleteResult,
  GroupCreateResult,
  GroupDeleteResult,
  GroupWindowRemoveResult,
  WindowCreateResult,
  WindowCloseResult,
  WindowDeleteResult,
  RemoteWindowGroupSummary,
  RemoteSSHProfileSummary,
  SSHProfileListResult,
  WindowCreateParams,
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
  hasMoreBefore: boolean
  evictedBeforeSeq: number
  cols?: number
  rows?: number
  keyboardState?: unknown
  screenSnapshot?: TerminalScreenSnapshot
}

export type TerminalScreenSnapshot = {
  windowId: string
  paneId: string
  cols: number
  rows: number
  cursorX: number
  cursorY: number
  alternate: boolean
  data: string
  capturedAt: string
  outputSeq: number
}

export type TerminalHistoryRequestOptions = {
  sinceSeq?: number
  beforeSeq?: number
  limitBytes?: number
  limitChunks?: number
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

export type WindowListResponse = {
  windows: RemoteWindowSummary[]
  groups: RemoteWindowGroupSummary[]
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
  let lastConnectedPersisted = false
  const client = connect(host.endpoint, host.deviceToken, host.publicKeyB64, {
    ...options,
    onStateChange: (state) => {
      options.onStateChange?.(state)
      if (state === 'connected' && !lastConnectedPersisted) {
        lastConnectedPersisted = true
        void updateLastConnected(host.id).catch(() => undefined)
      }
    },
    relay
  })
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

export async function requestWindowList(client: RpcClient): Promise<WindowListResponse> {
  const response = await client.sendRequest('window.list', { terminalOnly: true })
  if (!response.ok) {
    throw new Error(response.error.message)
  }
  return parseWindowList(response.result)
}

export async function requestSSHProfileList(
  client: RpcClient
): Promise<RemoteSSHProfileSummary[]> {
  const response = await client.sendRequest('ssh.profile.list')
  if (!response.ok) {
    throw new Error(response.error.message)
  }
  return parseSSHProfileList(response.result).profiles
}

export async function startRemoteWindow(
  client: RpcClient,
  windowId: string,
  paneId?: string,
  initialViewport?: { cols: number; rows: number }
): Promise<WindowStartResult> {
  const response = await client.sendRequest('window.start', {
    windowId,
    ...(paneId ? { paneId } : {}),
    ...(initialViewport ? {
      initialCols: initialViewport.cols,
      initialRows: initialViewport.rows
    } : {})
  })
  if (!response.ok) {
    throw new Error(response.error.message)
  }
  return parseWindowStartResult(response.result)
}

export async function createRemoteWindow(
  client: RpcClient,
  params: WindowCreateParams
): Promise<WindowCreateResult> {
  const response = await client.sendRequest('window.create', params)
  if (!response.ok) {
    throw new Error(response.error.message)
  }
  return parseWindowCreateResult(response.result)
}

export async function stopRemoteWindow(
  client: RpcClient,
  windowId: string
): Promise<WindowCloseResult> {
  const response = await client.sendRequest('window.close', { windowId })
  if (!response.ok) {
    throw new Error(response.error.message)
  }
  return parseWindowCloseResult(response.result)
}

export async function stopRemotePane(
  client: RpcClient,
  windowId: string,
  paneId: string
): Promise<PaneCloseResult> {
  const response = await client.sendRequest('pane.close', { windowId, paneId })
  if (!response.ok) {
    throw new Error(response.error.message)
  }
  return parsePaneCloseResult(response.result)
}

export async function deleteRemotePane(
  client: RpcClient,
  windowId: string,
  paneId: string
): Promise<PaneDeleteResult> {
  const response = await client.sendRequest('pane.delete', { windowId, paneId })
  if (!response.ok) {
    throw new Error(response.error.message)
  }
  return parsePaneDeleteResult(response.result)
}

export async function deleteRemoteWindow(
  client: RpcClient,
  windowId: string
): Promise<WindowDeleteResult> {
  const response = await client.sendRequest('window.delete', { windowId })
  if (!response.ok) {
    throw new Error(response.error.message)
  }
  return parseWindowDeleteResult(response.result)
}

export async function createRemoteGroup(
  client: RpcClient,
  windowIds: string[],
  name?: string
): Promise<GroupCreateResult> {
  const response = await client.sendRequest('group.create', {
    windowIds,
    ...(name?.trim() ? { name: name.trim() } : {})
  })
  if (!response.ok) {
    throw new Error(response.error.message)
  }
  return parseGroupCreateResult(response.result)
}

export async function deleteRemoteGroup(
  client: RpcClient,
  groupId: string
): Promise<GroupDeleteResult> {
  const response = await client.sendRequest('group.delete', { groupId })
  if (!response.ok) {
    throw new Error(response.error.message)
  }
  return parseGroupDeleteResult(response.result)
}

export async function removeRemoteWindowFromGroup(
  client: RpcClient,
  groupId: string,
  windowId: string
): Promise<GroupWindowRemoveResult> {
  const response = await client.sendRequest('group.window.remove', { groupId, windowId })
  if (!response.ok) {
    throw new Error(response.error.message)
  }
  return parseGroupWindowRemoveResult(response.result)
}

export async function requestTerminalHistory(
  client: RpcClient,
  windowId: string,
  paneId: string,
  options: TerminalHistoryRequestOptions = {}
): Promise<TerminalHistoryResult> {
  const response = await client.sendRequest('terminal.history', {
    windowId,
    paneId,
    ...(typeof options.sinceSeq === 'number' ? { sinceSeq: options.sinceSeq } : {}),
    ...(typeof options.beforeSeq === 'number' ? { beforeSeq: options.beforeSeq } : {}),
    ...(typeof options.limitBytes === 'number' ? { limitBytes: options.limitBytes } : {}),
    ...(typeof options.limitChunks === 'number' ? { limitChunks: options.limitChunks } : {})
  })
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

export function parseWindowList(value: unknown): WindowListResponse {
  if (!value || typeof value !== 'object') {
    return { windows: [], groups: [] }
  }
  const result = value as Record<string, unknown>
  const windows = Array.isArray(result.windows) ? result.windows.flatMap((window) => {
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
  }) : []
  const groups = Array.isArray(result.groups)
    ? result.groups.flatMap((group) => parseRemoteWindowGroupSummary(group, windows))
    : []
  return { windows, groups }
}

export function parseSSHProfileList(value: unknown): SSHProfileListResult {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid SSH profile list response')
  }
  const result = value as Record<string, unknown>
  if (!Array.isArray(result.profiles)) {
    throw new Error('Invalid SSH profile list response')
  }

  return {
    profiles: result.profiles.flatMap((profile) => {
      if (!profile || typeof profile !== 'object') {
        return []
      }
      const item = profile as Record<string, unknown>
      if (
        typeof item.profileId !== 'string' ||
        typeof item.name !== 'string' ||
        typeof item.host !== 'string' ||
        typeof item.port !== 'number' ||
        typeof item.user !== 'string'
      ) {
        return []
      }
      return [{
        profileId: item.profileId,
        name: item.name,
        host: item.host,
        port: item.port,
        user: item.user,
        defaultRemoteCwd:
          typeof item.defaultRemoteCwd === 'string' ? item.defaultRemoteCwd : null,
        remoteCommand: typeof item.remoteCommand === 'string' ? item.remoteCommand : null
      }]
    })
  }
}

export function parseWindowStartResult(value: unknown): WindowStartResult {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid window start response')
  }
  const result = value as Record<string, unknown>
  const { windows } = parseWindowList({ windows: [result.window] })
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
  const { windows } = parseWindowList({ windows: [result.window] })
  const pane = parseRemotePaneSummary(result.pane)[0] ?? null
  const window = windows[0]
  if (
    !window ||
    !pane ||
    pane.windowId !== window.windowId ||
    !window.panes.some((windowPane) => windowPane.paneId === pane.paneId)
  ) {
    throw new Error('Invalid window create response')
  }
  return {
    window,
    pane
  }
}

export function parseWindowCloseResult(value: unknown): WindowCloseResult {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid window close response')
  }
  const result = value as Record<string, unknown>
  const { windows } = parseWindowList({ windows: [result.window] })
  if (windows.length === 0) {
    throw new Error('Invalid window close response')
  }
  const stoppedPanes = Array.isArray(result.stoppedPanes)
    ? result.stoppedPanes.flatMap((item) => parseRemotePaneSummary(item))
    : []
  return {
    window: windows[0]!,
    stoppedPanes
  }
}

export function parsePaneCloseResult(value: unknown): PaneCloseResult {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid pane close response')
  }
  const result = value as Record<string, unknown>
  const { windows } = parseWindowList({ windows: [result.window] })
  const pane = parseRemotePaneSummary(result.pane)[0] ?? null
  if (windows.length === 0 || !pane) {
    throw new Error('Invalid pane close response')
  }
  return {
    window: windows[0]!,
    pane
  }
}

export function parsePaneDeleteResult(value: unknown): PaneDeleteResult {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid pane delete response')
  }
  const result = value as Record<string, unknown>
  const { windows } = parseWindowList({ windows: [result.window] })
  const replacementPane = parseRemotePaneSummary(result.replacementPane)[0] ?? null
  const window = windows[0]
  if (
    result.deleted !== true ||
    typeof result.deletedPaneId !== 'string' ||
    !window ||
    !replacementPane ||
    replacementPane.windowId !== window.windowId ||
    !window.panes.some((pane) => pane.paneId === replacementPane.paneId)
  ) {
    throw new Error('Invalid pane delete response')
  }
  return {
    deleted: true,
    deletedPaneId: result.deletedPaneId,
    window,
    replacementPane
  }
}

export function parseWindowDeleteResult(value: unknown): WindowDeleteResult {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid window delete response')
  }
  const result = value as Record<string, unknown>
  if (result.deleted !== true || typeof result.windowId !== 'string') {
    throw new Error('Invalid window delete response')
  }
  const groups = Array.isArray(result.groups)
    ? result.groups.flatMap((group) => parseRemoteWindowGroupSummary(group, []))
    : []
  return {
    deleted: true,
    windowId: result.windowId,
    groups
  }
}

export function parseGroupCreateResult(value: unknown): GroupCreateResult {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid group create response')
  }
  const group = parseRemoteWindowGroupSummary((value as Record<string, unknown>).group, [])[0] ?? null
  if (!group) {
    throw new Error('Invalid group create response')
  }
  return { group }
}

export function parseGroupDeleteResult(value: unknown): GroupDeleteResult {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid group delete response')
  }
  const result = value as Record<string, unknown>
  if (result.deleted !== true || typeof result.groupId !== 'string') {
    throw new Error('Invalid group delete response')
  }
  return {
    deleted: true,
    groupId: result.groupId
  }
}

export function parseGroupWindowRemoveResult(value: unknown): GroupWindowRemoveResult {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid group window remove response')
  }
  const result = value as Record<string, unknown>
  if (
    result.removed !== true ||
    typeof result.groupId !== 'string' ||
    typeof result.windowId !== 'string' ||
    typeof result.dissolved !== 'boolean'
  ) {
    throw new Error('Invalid group window remove response')
  }

  const group = result.group === null
    ? null
    : parseRemoteWindowGroupSummary(result.group, [])[0] ?? null
  const replacementWindow = result.replacementWindow === null
    ? null
    : parseWindowList({ windows: [result.replacementWindow] }).windows[0] ?? null
  const replacementPane = result.replacementPane === null
    ? null
    : parseRemotePaneSummary(result.replacementPane)[0] ?? null
  if (
    (result.group !== null && !group) ||
    (result.replacementWindow !== null && !replacementWindow) ||
    (result.replacementPane !== null && !replacementPane) ||
    (replacementPane && (
      !replacementWindow ||
      replacementPane.windowId !== replacementWindow.windowId ||
      !replacementWindow.panes.some((pane) => pane.paneId === replacementPane.paneId)
    ))
  ) {
    throw new Error('Invalid group window remove response')
  }

  return {
    removed: true,
    groupId: result.groupId,
    windowId: result.windowId,
    dissolved: result.dissolved,
    group,
    replacementWindow,
    replacementPane
  }
}

function parseRemoteWindowGroupSummary(
  value: unknown,
  fallbackWindows: RemoteWindowSummary[]
): RemoteWindowGroupSummary[] {
  if (!value || typeof value !== 'object') {
    return []
  }
  const item = value as Record<string, unknown>
  if (typeof item.groupId !== 'string' || typeof item.name !== 'string') {
    return []
  }
  const windows = Array.isArray(item.windows)
    ? parseWindowList({ windows: item.windows }).windows
    : fallbackWindows.filter((window) => groupLayoutContainsWindow(item.layout, window.windowId))
  return [
    {
      groupId: item.groupId,
      name: item.name,
      archived: item.archived === true,
      activeWindowId: typeof item.activeWindowId === 'string' ? item.activeWindowId : '',
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : '',
      lastActiveAt: typeof item.lastActiveAt === 'string' ? item.lastActiveAt : '',
      windowCount: typeof item.windowCount === 'number' ? item.windowCount : windows.length,
      layout: isGroupLayoutNode(item.layout) ? item.layout : { type: 'window', id: windows[0]?.windowId ?? '' },
      windows
    }
  ]
}

function groupLayoutContainsWindow(layout: unknown, windowId: string): boolean {
  if (!layout || typeof layout !== 'object') {
    return false
  }
  const node = layout as Record<string, unknown>
  if (node.type === 'window') {
    return node.id === windowId
  }
  if (node.type === 'split' && Array.isArray(node.children)) {
    return node.children.some((child) => groupLayoutContainsWindow(child, windowId))
  }
  return false
}

function isGroupLayoutNode(value: unknown): value is RemoteWindowGroupSummary['layout'] {
  if (!value || typeof value !== 'object') {
    return false
  }
  const node = value as Record<string, unknown>
  if (node.type === 'window') {
    return typeof node.id === 'string'
  }
  return (
    node.type === 'split' &&
    (node.direction === 'horizontal' || node.direction === 'vertical') &&
    Array.isArray(node.sizes) &&
    node.sizes.every((size) => typeof size === 'number') &&
    Array.isArray(node.children) &&
    node.children.every((child) => isGroupLayoutNode(child))
  )
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
    hasMoreBefore: result.hasMoreBefore === true,
    evictedBeforeSeq: typeof result.evictedBeforeSeq === 'number' ? result.evictedBeforeSeq : 0,
    ...(typeof result.cols === 'number' && result.cols > 0 ? { cols: result.cols } : {}),
    ...(typeof result.rows === 'number' && result.rows > 0 ? { rows: result.rows } : {}),
    keyboardState: result.keyboardState,
    ...(parseTerminalScreenSnapshot(result.screenSnapshot) ?? {})
  }
}

function parseTerminalScreenSnapshot(value: unknown): { screenSnapshot: TerminalScreenSnapshot } | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const snapshot = value as Record<string, unknown>
  if (
    typeof snapshot.windowId !== 'string' ||
    typeof snapshot.paneId !== 'string' ||
    typeof snapshot.cols !== 'number' ||
    typeof snapshot.rows !== 'number' ||
    typeof snapshot.cursorX !== 'number' ||
    typeof snapshot.cursorY !== 'number' ||
    typeof snapshot.alternate !== 'boolean' ||
    typeof snapshot.data !== 'string' ||
    typeof snapshot.capturedAt !== 'string' ||
    typeof snapshot.outputSeq !== 'number'
  ) {
    return null
  }
  return {
    screenSnapshot: {
      windowId: snapshot.windowId,
      paneId: snapshot.paneId,
      cols: snapshot.cols,
      rows: snapshot.rows,
      cursorX: snapshot.cursorX,
      cursorY: snapshot.cursorY,
      alternate: snapshot.alternate,
      data: snapshot.data,
      capturedAt: snapshot.capturedAt,
      outputSeq: snapshot.outputSeq
    }
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
