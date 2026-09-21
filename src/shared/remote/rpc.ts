import { z } from 'zod';

export const RemoteRpcRequestSchema = z.object({
  id: z.string().min(1),
  method: z.string().min(1),
  params: z.unknown().optional(),
});

export type RemoteRpcRequest = z.infer<typeof RemoteRpcRequestSchema>;

export type RemoteRpcSuccess = {
  id: string;
  ok: true;
  result: unknown;
  streaming?: true;
};

export type RemoteRpcError = {
  id: string;
  ok: false;
  error: {
    code: string;
    message: string;
    data?: unknown;
  };
};

export type RemoteRpcResponse = RemoteRpcSuccess | RemoteRpcError;

export type RemoteStreamEvent = {
  type: 'event';
  subscriptionId: string;
  payload: unknown;
};

export function remoteSuccess(id: string, result: unknown): RemoteRpcSuccess {
  return { id, ok: true, result };
}

export function remoteError(
  id: string,
  code: string,
  message: string,
  data?: unknown,
): RemoteRpcError {
  return {
    id,
    ok: false,
    error: data === undefined ? { code, message } : { code, message, data },
  };
}
