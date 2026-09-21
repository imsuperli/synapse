export const REMOTE_ERROR_CODES = {
  BAD_REQUEST: 'bad_request',
  UNAUTHORIZED: 'unauthorized',
  FORBIDDEN: 'forbidden',
  NOT_FOUND: 'not_found',
  METHOD_NOT_FOUND: 'method_not_found',
  INVALID_PARAMS: 'invalid_params',
  TERMINAL_NOT_FOUND: 'terminal_not_found',
  SUBSCRIPTION_NOT_FOUND: 'subscription_not_found',
  PAYLOAD_TOO_LARGE: 'payload_too_large',
  INTERNAL_ERROR: 'internal_error',
  RUNTIME_BUSY: 'runtime_busy',
} as const;

export type RemoteErrorCode = (typeof REMOTE_ERROR_CODES)[keyof typeof REMOTE_ERROR_CODES];
