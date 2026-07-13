export const REMOTE_PROTOCOL_VERSION = 1;

export const REMOTE_METHODS = {
  STATUS_GET: 'status.get',
  HOST_INFO: 'host.info',
  REMOTE_CAPABILITIES: 'remote.capabilities',
  TERMINAL_LIST: 'terminal.list',
  TERMINAL_HISTORY: 'terminal.history',
  TERMINAL_SUBSCRIBE: 'terminal.subscribe',
  TERMINAL_UNSUBSCRIBE: 'terminal.unsubscribe',
  TERMINAL_SEND: 'terminal.send',
  TERMINAL_CLEAR: 'terminal.clear',
  DEVICE_LIST: 'device.list',
  DEVICE_REVOKE: 'device.revoke',
  WINDOW_LIST: 'window.list',
  WINDOW_CREATE: 'window.create',
  WINDOW_ACTIVATE: 'window.activate',
  WINDOW_START: 'window.start',
  WINDOW_CLOSE: 'window.close',
  WINDOW_DELETE: 'window.delete',
  SSH_PROFILE_LIST: 'ssh.profile.list',
  GROUP_CREATE: 'group.create',
  GROUP_DELETE: 'group.delete',
  GROUP_WINDOW_REMOVE: 'group.window.remove',
  PANE_LIST: 'pane.list',
  PANE_FOCUS: 'pane.focus',
  PANE_CLOSE: 'pane.close',
  PANE_DELETE: 'pane.delete',
} as const;

export type RemoteMethodName = (typeof REMOTE_METHODS)[keyof typeof REMOTE_METHODS];

export type RemoteDeviceScope =
  | 'mobile.read'
  | 'mobile.control'
  | 'mobile.window-control'
  | 'mobile.admin';

const MOBILE_READ_METHODS = new Set<string>([
  REMOTE_METHODS.STATUS_GET,
  REMOTE_METHODS.HOST_INFO,
  REMOTE_METHODS.REMOTE_CAPABILITIES,
  REMOTE_METHODS.TERMINAL_LIST,
  REMOTE_METHODS.TERMINAL_HISTORY,
  REMOTE_METHODS.TERMINAL_SUBSCRIBE,
  REMOTE_METHODS.TERMINAL_UNSUBSCRIBE,
]);

const MOBILE_CONTROL_METHODS = new Set<string>([
  ...MOBILE_READ_METHODS,
  REMOTE_METHODS.TERMINAL_SEND,
  REMOTE_METHODS.TERMINAL_CLEAR,
]);

const MOBILE_WINDOW_CONTROL_METHODS = new Set<string>([
  ...MOBILE_CONTROL_METHODS,
  REMOTE_METHODS.WINDOW_LIST,
  REMOTE_METHODS.WINDOW_CREATE,
  REMOTE_METHODS.WINDOW_START,
  REMOTE_METHODS.WINDOW_ACTIVATE,
  REMOTE_METHODS.WINDOW_CLOSE,
  REMOTE_METHODS.WINDOW_DELETE,
  REMOTE_METHODS.SSH_PROFILE_LIST,
  REMOTE_METHODS.GROUP_CREATE,
  REMOTE_METHODS.GROUP_DELETE,
  REMOTE_METHODS.GROUP_WINDOW_REMOVE,
  REMOTE_METHODS.PANE_LIST,
  REMOTE_METHODS.PANE_FOCUS,
  REMOTE_METHODS.PANE_CLOSE,
  REMOTE_METHODS.PANE_DELETE,
]);

const MOBILE_ADMIN_METHODS = new Set<string>([
  ...MOBILE_WINDOW_CONTROL_METHODS,
  REMOTE_METHODS.DEVICE_LIST,
  REMOTE_METHODS.DEVICE_REVOKE,
]);

export function isRemoteMethodAllowed(scope: RemoteDeviceScope, method: string): boolean {
  if (scope === 'mobile.admin') {
    return MOBILE_ADMIN_METHODS.has(method);
  }
  if (scope === 'mobile.window-control') {
    return MOBILE_WINDOW_CONTROL_METHODS.has(method);
  }
  if (scope === 'mobile.control') {
    return MOBILE_CONTROL_METHODS.has(method);
  }
  return MOBILE_READ_METHODS.has(method);
}
