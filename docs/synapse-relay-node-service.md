# Synapse Relay Node Service

Synapse Relay lets Synapse Desktop and Synapse Mobile communicate when they are
in different private networks. Both sides open outbound WebSocket connections to
the relay. The relay only authenticates session membership and forwards bytes; it
does not decrypt Synapse E2EE payloads.

## Run Locally

```bash
npm run relay:dev
```

Build and run the compiled service:

```bash
npm run build:relay
npm run relay:start
```

Default listen address:

```text
0.0.0.0:8787
```

Health check:

```bash
curl http://127.0.0.1:8787/healthz
```

## Configure Synapse

Use the same public relay URL on the desktop and phone, for example:

```text
wss://relay.example.com/v1/relay
```

Desktop:

1. Open Settings > Mobile Remote Control.
2. Turn on mobile connections.
3. Turn on Public Relay.
4. Enter the relay URL and generate the pairing QR code.

Mobile:

1. Scan the QR code.
2. Confirm the Relay endpoint shown on the pairing screen. Edit it if the phone
   must use a different externally reachable hostname for the same relay service.
3. After pairing, the relay endpoint can be changed from the saved host settings.

The desktop stores the relay host token and the hash of the mobile relay token
with the paired device record. The mobile app stores the relay client token in
SecureStore with the existing device token. Changing the relay URL after pairing
requires both desktop and mobile to point at the same relay service; the session
id and token do not change.

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `SYNAPSE_RELAY_HOST` | `0.0.0.0` | Bind host. |
| `SYNAPSE_RELAY_PORT` | `8787` | Bind port. |
| `SYNAPSE_RELAY_PATH` | `/v1/relay` | WebSocket relay path. |
| `SYNAPSE_RELAY_MAX_SESSIONS` | `10000` | In-memory session cap. |
| `SYNAPSE_RELAY_MAX_CONNECTIONS` | `20000` | Connected socket cap. |
| `SYNAPSE_RELAY_MAX_PAYLOAD_BYTES` | `1048576` | Max WebSocket frame size. |
| `SYNAPSE_RELAY_MAX_QUEUED_MESSAGES` | `64` | Buffered messages while peer is offline. |
| `SYNAPSE_RELAY_MAX_QUEUED_BYTES` | `1048576` | Buffered bytes while peer is offline. |
| `SYNAPSE_RELAY_MAX_MESSAGES_PER_MINUTE` | `3600` | Per-socket message rate limit. |
| `SYNAPSE_RELAY_MAX_BYTES_PER_MINUTE` | `67108864` | Per-socket byte rate limit. |
| `SYNAPSE_RELAY_SESSION_TTL_MS` | `43200000` | Session lifetime cap. |
| `SYNAPSE_RELAY_IDLE_TTL_MS` | `60000` | Remove disconnected sessions after this idle time. |
| `SYNAPSE_RELAY_HEARTBEAT_INTERVAL_MS` | `15000` | WebSocket ping interval. |
| `SYNAPSE_RELAY_CLEANUP_INTERVAL_MS` | `30000` | Session cleanup interval. |

## WebSocket Protocol

Host creates or rejoins a relay session:

```text
wss://relay.example.com/v1/relay
  ?role=host
  &sessionId=<random-session-id>
  &hostToken=<desktop-only-secret>
  &clientTokenHash=<sha256(client-token)>
  &ttlSeconds=3600
```

Mobile joins the session from the QR code:

```text
wss://relay.example.com/v1/relay
  ?role=client
  &sessionId=<random-session-id>
  &clientToken=<mobile-pairing-secret>
```

After both sides are authenticated, every text or binary WebSocket message is
forwarded to the opposite side. Messages sent before the peer joins are buffered
within the configured queue limits.

The relay stores only token hashes in memory and should not log query strings.
Synapse business RPC remains end-to-end encrypted above this transport.

## Caddy

```caddyfile
relay.example.com {
  reverse_proxy 127.0.0.1:8787
}
```

## Nginx

```nginx
server {
  listen 443 ssl http2;
  server_name relay.example.com;

  ssl_certificate /etc/letsencrypt/live/relay.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/relay.example.com/privkey.pem;

  location /v1/relay {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 3600s;
  }

  location /healthz {
    proxy_pass http://127.0.0.1:8787;
  }
}
```

## systemd

```ini
[Unit]
Description=Synapse Relay
After=network-online.target

[Service]
WorkingDirectory=/opt/synapse
ExecStart=/usr/bin/npm run relay:start
Restart=always
RestartSec=3
Environment=SYNAPSE_RELAY_HOST=127.0.0.1
Environment=SYNAPSE_RELAY_PORT=8787

[Install]
WantedBy=multi-user.target
```

## Current Scope

This service is single-node and keeps relay sessions in memory. For horizontal
scaling, add a shared session registry and route both peers for a session to the
same instance, or use Redis pub/sub for cross-instance forwarding.
