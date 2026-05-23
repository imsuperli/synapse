export const DEFAULT_SSH_READY_TIMEOUT_MS = 7500;

export function resolveSSHReadyTimeoutMs(value: number | null | undefined): number {
  return value && value > 0 ? value : DEFAULT_SSH_READY_TIMEOUT_MS;
}
