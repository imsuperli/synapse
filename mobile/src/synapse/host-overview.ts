import type { RpcClient } from '../transport/rpc-client'
import { updateHostDirectEndpoint } from '../transport/host-store'
import {
  requestRemoteCapabilities,
  requestRemoteStatus,
  requestTerminalList,
  requestWindowList,
  type RemoteDeviceScope,
  type RemoteTerminalSummary,
  type RemoteWindowGroupSummary,
  type RemoteWindowSummary
} from './remote'

export type HostOverviewData =
  | {
      mode: 'windows'
      deviceScope: RemoteDeviceScope
      canCreateWindow: boolean
      canCreateSSHWindow: boolean
      windows: RemoteWindowSummary[]
      groups: RemoteWindowGroupSummary[]
      terminals: RemoteTerminalSummary[]
    }
  | {
      mode: 'terminals'
      deviceScope: RemoteDeviceScope
      canCreateWindow: boolean
      canCreateSSHWindow: boolean
      windows: RemoteWindowSummary[]
      groups: RemoteWindowGroupSummary[]
      terminals: RemoteTerminalSummary[]
    }

const WINDOW_LIST_SCOPES = new Set<RemoteDeviceScope>(['mobile.window-control', 'mobile.admin'])

export async function loadHostOverviewData(
  client: RpcClient,
  hostId?: string
): Promise<HostOverviewData> {
  const [status, capabilities] = await Promise.all([
    requestRemoteStatus(client),
    requestRemoteCapabilities(client)
  ])
  if (hostId && status.directEndpoint) {
    await updateHostDirectEndpoint(hostId, status.directEndpoint).catch(() => undefined)
  }
  if (canUseWindowList(status.deviceScope, capabilities.methods)) {
    const { windows, groups } = await requestWindowList(client)
    return {
      mode: 'windows',
      deviceScope: status.deviceScope,
      canCreateWindow: canCreateWindow(status.deviceScope, capabilities.methods),
      canCreateSSHWindow: canCreateSSHWindow(status.deviceScope, capabilities.methods),
      windows,
      groups,
      terminals: flattenTerminalPanes(windows)
    }
  }

  const terminals = await requestTerminalList(client)
  return {
    mode: 'terminals',
    deviceScope: status.deviceScope,
    canCreateWindow: canCreateWindow(status.deviceScope, capabilities.methods),
    canCreateSSHWindow: canCreateSSHWindow(status.deviceScope, capabilities.methods),
    windows: [],
    groups: [],
    terminals
  }
}

export function canUseWindowList(scope: RemoteDeviceScope, methods: string[]): boolean {
  return WINDOW_LIST_SCOPES.has(scope) && methods.includes('window.list')
}

export function canCreateWindow(scope: RemoteDeviceScope, methods: string[]): boolean {
  return WINDOW_LIST_SCOPES.has(scope) && methods.includes('window.create')
}

export function canCreateSSHWindow(scope: RemoteDeviceScope, methods: string[]): boolean {
  return canCreateWindow(scope, methods) && methods.includes('ssh.profile.list')
}

export function flattenTerminalPanes(windows: RemoteWindowSummary[]): RemoteTerminalSummary[] {
  return windows.flatMap((window) =>
    window.panes.flatMap((pane) => {
      if (pane.kind !== 'terminal') {
        return []
      }
      return [
        {
          windowId: pane.windowId,
          paneId: pane.paneId,
          sessionId: pane.sessionId ?? `${pane.windowId}:${pane.paneId}`,
          pid: pane.pid ?? 0,
          backend: pane.backend ?? 'local',
          status: pane.running ? 'alive' : 'exited',
          workingDirectory: pane.cwd ?? '',
          command: pane.command ?? undefined
        } satisfies RemoteTerminalSummary
      ]
    })
  )
}
