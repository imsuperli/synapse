import type { RpcClient } from '../transport/rpc-client'
import {
  requestRemoteCapabilities,
  requestRemoteStatus,
  requestTerminalList,
  requestWindowList,
  type RemoteDeviceScope,
  type RemoteTerminalSummary,
  type RemoteWindowSummary
} from './remote'

export type HostOverviewData =
  | {
      mode: 'windows'
      deviceScope: RemoteDeviceScope
      windows: RemoteWindowSummary[]
      terminals: RemoteTerminalSummary[]
    }
  | {
      mode: 'terminals'
      deviceScope: RemoteDeviceScope
      windows: RemoteWindowSummary[]
      terminals: RemoteTerminalSummary[]
    }

const WINDOW_LIST_SCOPES = new Set<RemoteDeviceScope>(['mobile.window-control', 'mobile.admin'])

export async function loadHostOverviewData(client: RpcClient): Promise<HostOverviewData> {
  const [status, capabilities] = await Promise.all([
    requestRemoteStatus(client),
    requestRemoteCapabilities(client)
  ])
  if (canUseWindowList(status.deviceScope, capabilities.methods)) {
    const windows = await requestWindowList(client)
    return {
      mode: 'windows',
      deviceScope: status.deviceScope,
      windows,
      terminals: flattenTerminalPanes(windows)
    }
  }

  const terminals = await requestTerminalList(client)
  return {
    mode: 'terminals',
    deviceScope: status.deviceScope,
    windows: [],
    terminals
  }
}

export function canUseWindowList(scope: RemoteDeviceScope, methods: string[]): boolean {
  return WINDOW_LIST_SCOPES.has(scope) && methods.includes('window.list')
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
