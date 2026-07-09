import { hostname, platform } from 'os';
import { z, ZodError, type ZodType } from 'zod';
import type { ProcessManager } from '../services/ProcessManager';
import type { RemoteDeviceEntry, RemoteDeviceRegistry } from './RemoteDeviceRegistry';
import type { RemoteStateProvider } from './RemoteStateProvider';
import { RemoteTerminalController } from './RemoteTerminalController';
import { REMOTE_ERROR_CODES } from '../../shared/remote/errors';
import { isRemoteMethodAllowed, REMOTE_METHODS, REMOTE_PROTOCOL_VERSION } from '../../shared/remote/methods';
import {
  remoteError,
  RemoteRpcRequestSchema,
  type RemoteRpcResponse,
  type RemoteStreamEvent,
} from '../../shared/remote/rpc';
import {
  TerminalClearParamsSchema,
  TerminalHistoryParamsSchema,
  TerminalResizeParamsSchema,
  TerminalSendParamsSchema,
  TerminalSubscribeParamsSchema,
} from '../../shared/remote/terminal-protocol';
import {
  PaneListParamsSchema,
  WindowListParamsSchema,
} from '../../shared/remote/window-protocol';

type DispatchContext = {
  device: RemoteDeviceEntry;
  connectionId: string;
};

type DispatchOptions = {
  processManager: ProcessManager;
  deviceRegistry: RemoteDeviceRegistry;
  appVersion?: string;
  hostName?: string;
  stateProvider?: RemoteStateProvider;
  onDeviceRevoked?: (device: RemoteDeviceEntry) => void;
};

type RemoteMethodHandler = (
  params: unknown,
  context: DispatchContext,
  emit: (event: RemoteStreamEvent) => void,
) => Promise<unknown> | unknown;

type RemoteMethodSpec = {
  params: ZodType | null;
  handler: RemoteMethodHandler;
};

const TerminalUnsubscribeParamsSchema = z.object({
  subscriptionId: z.string().min(1),
});

const DeviceRevokeParamsSchema = z.object({
  deviceId: z.string().min(1),
});

export class RemoteDispatcher {
  private readonly terminalController: RemoteTerminalController;
  private readonly deviceRegistry: RemoteDeviceRegistry;
  private readonly appVersion: string;
  private readonly hostName: string;
  private readonly stateProvider: RemoteStateProvider | undefined;
  private readonly onDeviceRevoked: ((device: RemoteDeviceEntry) => void) | undefined;
  private readonly methods = new Map<string, RemoteMethodSpec>();
  private readonly subscriptionsByConnection = new Map<string, Set<string>>();

  constructor(options: DispatchOptions) {
    this.terminalController = new RemoteTerminalController(options.processManager);
    this.deviceRegistry = options.deviceRegistry;
    this.appVersion = options.appVersion ?? 'unknown';
    this.hostName = options.hostName ?? hostname();
    this.stateProvider = options.stateProvider;
    this.onDeviceRevoked = options.onDeviceRevoked;
    this.registerMethods();
  }

  async dispatchRaw(
    raw: string,
    context: DispatchContext,
    emit: (event: RemoteStreamEvent) => void,
  ): Promise<RemoteRpcResponse> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return remoteError('unknown', REMOTE_ERROR_CODES.BAD_REQUEST, 'Invalid JSON RPC request');
    }

    const requestResult = RemoteRpcRequestSchema.safeParse(parsed);
    if (!requestResult.success) {
      return remoteError(
        'unknown',
        REMOTE_ERROR_CODES.BAD_REQUEST,
        formatZodError(requestResult.error),
      );
    }

    const request = requestResult.data;
    if (context.device.lastSeenAt === 0 && request.method !== REMOTE_METHODS.STATUS_GET) {
      return remoteError(
        request.id,
        REMOTE_ERROR_CODES.UNAUTHORIZED,
        'Pairing has not been confirmed',
      );
    }

    if (!isRemoteMethodAllowed(context.device.scope, request.method)) {
      return remoteError(request.id, REMOTE_ERROR_CODES.FORBIDDEN, 'Method is not allowed');
    }

    const method = this.methods.get(request.method);
    if (!method) {
      return remoteError(request.id, REMOTE_ERROR_CODES.METHOD_NOT_FOUND, 'Method not found');
    }

    if (request.method !== REMOTE_METHODS.STATUS_GET && context.device.lastSeenAt > 0) {
      this.deviceRegistry.updateLastSeen(context.device.deviceId);
    }

    let params: unknown = undefined;
    if (method.params) {
      const paramsResult = method.params.safeParse(request.params ?? {});
      if (!paramsResult.success) {
        return remoteError(
          request.id,
          REMOTE_ERROR_CODES.INVALID_PARAMS,
          formatZodError(paramsResult.error),
        );
      }
      params = paramsResult.data;
    }

    try {
      const result = await method.handler(params, context, emit);
      return { id: request.id, ok: true, result };
    } catch (error) {
      const mapped = mapRemoteError(error);
      return remoteError(request.id, mapped.code, mapped.message);
    }
  }

  cleanupConnection(connectionId: string): void {
    const subscriptionIds = this.subscriptionsByConnection.get(connectionId);
    if (!subscriptionIds) {
      return;
    }
    this.subscriptionsByConnection.delete(connectionId);
    for (const subscriptionId of subscriptionIds) {
      this.terminalController.unsubscribe(subscriptionId);
    }
  }

  private registerMethods(): void {
    this.methods.set(REMOTE_METHODS.STATUS_GET, {
      params: null,
      handler: (_params, context) => {
        this.deviceRegistry.markPairingProbeSucceeded(context.device.deviceId);
        return {
          ok: true,
          protocolVersion: REMOTE_PROTOCOL_VERSION,
          deviceScope: context.device.scope,
        };
      },
    });

    this.methods.set(REMOTE_METHODS.HOST_INFO, {
      params: null,
      handler: () => ({
        hostName: this.hostName,
        platform: platform(),
        appVersion: this.appVersion,
      }),
    });

    this.methods.set(REMOTE_METHODS.REMOTE_CAPABILITIES, {
      params: null,
      handler: (_params, context) => ({
        protocolVersion: REMOTE_PROTOCOL_VERSION,
        methods: Array.from(this.methods.keys())
          .filter((method) => isRemoteMethodAllowed(context.device.scope, method))
          .sort(),
      }),
    });

    this.methods.set(REMOTE_METHODS.TERMINAL_LIST, {
      params: null,
      handler: () => ({ terminals: this.terminalController.listRunningTerminals() }),
    });

    this.methods.set(REMOTE_METHODS.TERMINAL_HISTORY, {
      params: TerminalHistoryParamsSchema,
      handler: (params) => {
        const typed = TerminalHistoryParamsSchema.parse(params);
        return this.terminalController.getHistory(typed.windowId, typed.paneId);
      },
    });

    this.methods.set(REMOTE_METHODS.TERMINAL_SUBSCRIBE, {
      params: TerminalSubscribeParamsSchema,
      handler: (params, context, emit) => {
        const typed = TerminalSubscribeParamsSchema.parse(params);
        if (typed.viewport) {
          this.terminalController.resize(
            typed.windowId,
            typed.paneId,
            typed.viewport.cols,
            typed.viewport.rows,
          );
        }
        let subscriptionId = '';
        const subscription = this.terminalController.subscribe(
          typed.windowId,
          typed.paneId,
          typed.sinceSeq,
          (payload) => {
            emit({
              type: 'event',
              subscriptionId,
              payload,
            });
          },
        );
        subscriptionId = subscription.subscriptionId;
        this.trackSubscription(context.connectionId, subscription.subscriptionId);
        setImmediate(() => subscription.activate());
        return {
          subscriptionId: subscription.subscriptionId,
          firstSeq: subscription.firstSeq,
          lastSeq: subscription.lastSeq,
          gap: subscription.gap,
        };
      },
    });

    this.methods.set(REMOTE_METHODS.TERMINAL_UNSUBSCRIBE, {
      params: TerminalUnsubscribeParamsSchema,
      handler: (params, context) => {
        const typed = TerminalUnsubscribeParamsSchema.parse(params);
        const removed = this.terminalController.unsubscribe(typed.subscriptionId);
        const connectionSubscriptions = this.subscriptionsByConnection.get(context.connectionId);
        connectionSubscriptions?.delete(typed.subscriptionId);
        return { unsubscribed: removed };
      },
    });

    this.methods.set(REMOTE_METHODS.TERMINAL_SEND, {
      params: TerminalSendParamsSchema,
      handler: (params) => {
        const typed = TerminalSendParamsSchema.parse(params);
        this.terminalController.send(typed.windowId, typed.paneId, typed.data);
        return { sent: true };
      },
    });

    this.methods.set(REMOTE_METHODS.TERMINAL_RESIZE, {
      params: TerminalResizeParamsSchema,
      handler: (params) => {
        const typed = TerminalResizeParamsSchema.parse(params);
        this.terminalController.resize(typed.windowId, typed.paneId, typed.cols, typed.rows);
        return { resized: true };
      },
    });

    this.methods.set(REMOTE_METHODS.TERMINAL_CLEAR, {
      params: TerminalClearParamsSchema,
      handler: (params) => {
        const typed = TerminalClearParamsSchema.parse(params);
        return this.terminalController.clear(typed.windowId, typed.paneId);
      },
    });

    const stateProvider = this.stateProvider;
    if (stateProvider) {
      this.methods.set(REMOTE_METHODS.WINDOW_LIST, {
        params: WindowListParamsSchema,
        handler: (params) => {
          const typed = WindowListParamsSchema.parse(params);
          return stateProvider.listWindows(typed);
        },
      });

      this.methods.set(REMOTE_METHODS.PANE_LIST, {
        params: PaneListParamsSchema,
        handler: (params) => {
          const typed = PaneListParamsSchema.parse(params);
          return stateProvider.listPanes(typed);
        },
      });
    }

    this.methods.set(REMOTE_METHODS.DEVICE_LIST, {
      params: null,
      handler: () => ({
        devices: this.deviceRegistry.listDevices().map(sanitizeDevice),
      }),
    });

    this.methods.set(REMOTE_METHODS.DEVICE_REVOKE, {
      params: DeviceRevokeParamsSchema,
      handler: (params) => {
        const typed = DeviceRevokeParamsSchema.parse(params);
        const removed = this.deviceRegistry.removeDevice(typed.deviceId);
        if (removed) {
          this.onDeviceRevoked?.(removed);
        }
        return { revoked: Boolean(removed) };
      },
    });
  }

  private trackSubscription(connectionId: string, subscriptionId: string): void {
    const subscriptionIds = this.subscriptionsByConnection.get(connectionId) ?? new Set<string>();
    subscriptionIds.add(subscriptionId);
    this.subscriptionsByConnection.set(connectionId, subscriptionIds);
  }
}

function sanitizeDevice(device: RemoteDeviceEntry) {
  return {
    deviceId: device.deviceId,
    name: device.name,
    scope: device.scope,
    pairedAt: device.pairedAt,
    lastSeenAt: device.lastSeenAt,
  };
}

function formatZodError(error: ZodError): string {
  return error.issues[0]?.message ?? 'Invalid request';
}

function mapRemoteError(error: unknown): { code: string; message: string } {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'terminal_not_found') {
    return { code: REMOTE_ERROR_CODES.TERMINAL_NOT_FOUND, message: 'Terminal not found' };
  }
  return { code: REMOTE_ERROR_CODES.INTERNAL_ERROR, message };
}
