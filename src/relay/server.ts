import { SynapseRelayServer } from './SynapseRelayServer';

function readNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const relay = new SynapseRelayServer({
  host: process.env.SYNAPSE_RELAY_HOST ?? '0.0.0.0',
  port: readNumberEnv('SYNAPSE_RELAY_PORT', 8787),
  path: process.env.SYNAPSE_RELAY_PATH ?? '/v1/relay',
  maxSessions: readNumberEnv('SYNAPSE_RELAY_MAX_SESSIONS', 10_000),
  maxConnections: readNumberEnv('SYNAPSE_RELAY_MAX_CONNECTIONS', 20_000),
  maxPayloadBytes: readNumberEnv('SYNAPSE_RELAY_MAX_PAYLOAD_BYTES', 1024 * 1024),
  maxQueuedMessages: readNumberEnv('SYNAPSE_RELAY_MAX_QUEUED_MESSAGES', 64),
  maxQueuedBytes: readNumberEnv('SYNAPSE_RELAY_MAX_QUEUED_BYTES', 1024 * 1024),
  maxMessagesPerMinute: readNumberEnv('SYNAPSE_RELAY_MAX_MESSAGES_PER_MINUTE', 3_600),
  maxBytesPerMinute: readNumberEnv('SYNAPSE_RELAY_MAX_BYTES_PER_MINUTE', 64 * 1024 * 1024),
  sessionTtlMs: readNumberEnv('SYNAPSE_RELAY_SESSION_TTL_MS', 12 * 60 * 60 * 1000),
  idleTtlMs: readNumberEnv('SYNAPSE_RELAY_IDLE_TTL_MS', 60_000),
  heartbeatIntervalMs: readNumberEnv('SYNAPSE_RELAY_HEARTBEAT_INTERVAL_MS', 15_000),
  cleanupIntervalMs: readNumberEnv('SYNAPSE_RELAY_CLEANUP_INTERVAL_MS', 30_000),
});

async function main(): Promise<void> {
  await relay.start();
  // Do not print secrets; endpoint/path are safe operational metadata.
  console.log(
    JSON.stringify({
      event: 'synapse_relay_started',
      endpoint: relay.endpoint,
      path: relay.relayPath,
    }),
  );
}

function shutdown(signal: string): void {
  void relay.stop().finally(() => {
    console.log(JSON.stringify({ event: 'synapse_relay_stopped', signal }));
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

main().catch((error) => {
  console.error(
    JSON.stringify({
      event: 'synapse_relay_start_failed',
      message: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exit(1);
});
