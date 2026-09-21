export type TerminalDiagnosticPrimitive = string | number | boolean | null

export type TerminalDiagnosticSource = 'mobile' | 'network' | 'webview'

export type TerminalDiagnosticEntry = {
  ts: number
  source: TerminalDiagnosticSource
  event: string
  metrics: Record<string, TerminalDiagnosticPrimitive>
}

export type TerminalDiagnosticBuffer = {
  limit: number
  entries: TerminalDiagnosticEntry[]
}

const DEFAULT_TERMINAL_DIAGNOSTIC_LIMIT = 100
const MAX_DIAGNOSTIC_STRING_LENGTH = 1000

const SECRET_KEY_FRAGMENTS = [
  'authorization',
  'apikey',
  'clienttoken',
  'devicekey',
  'devicetoken',
  'encryptionkey',
  'keyb64',
  'pairingcode',
  'password',
  'privatekey',
  'publickey',
  'relayclienttoken',
  'secret',
  'sharedkey',
  'sessiontoken'
]

const CONTENT_KEY_FRAGMENTS = [
  'clipboard',
  'initialdata',
  'inputbytes',
  'outputtext',
  'serialized',
  'terminalcontent',
  'terminaldata'
]

export function createTerminalDiagnosticBuffer(
  limit = DEFAULT_TERMINAL_DIAGNOSTIC_LIMIT
): TerminalDiagnosticBuffer {
  return {
    limit: Math.max(1, Math.floor(limit)),
    entries: []
  }
}

export function appendTerminalDiagnostic(
  buffer: TerminalDiagnosticBuffer,
  entry: Omit<TerminalDiagnosticEntry, 'ts' | 'metrics'> & {
    ts?: number
    metrics?: Record<string, unknown>
  }
): TerminalDiagnosticEntry {
  const normalized: TerminalDiagnosticEntry = {
    ts: typeof entry.ts === 'number' && Number.isFinite(entry.ts) ? entry.ts : Date.now(),
    source: entry.source,
    event: sanitizeDiagnosticString(entry.event),
    metrics: sanitizeTerminalDiagnosticMetrics(entry.metrics)
  }
  buffer.entries.push(normalized)
  if (buffer.entries.length > buffer.limit) {
    buffer.entries.splice(0, buffer.entries.length - buffer.limit)
  }
  return normalized
}

export function formatTerminalDiagnostics(
  buffer: TerminalDiagnosticBuffer,
  context: Record<string, unknown> = {}
): string {
  const header = {
    format: 'synapse-terminal-diagnostics-v1',
    generatedAt: new Date().toISOString(),
    context: sanitizeTerminalDiagnosticMetrics(context)
  }
  return [
    JSON.stringify(header),
    ...buffer.entries.map((entry) =>
      JSON.stringify({
        ...entry,
        at: new Date(entry.ts).toISOString()
      })
    )
  ].join('\n')
}

export function serializeTerminalDiagnosticBuffer(buffer: TerminalDiagnosticBuffer): string {
  return JSON.stringify({
    version: 1,
    entries: buffer.entries
  })
}

export function restoreTerminalDiagnosticBuffer(
  serialized: string | null | undefined,
  limit = DEFAULT_TERMINAL_DIAGNOSTIC_LIMIT
): TerminalDiagnosticBuffer {
  const buffer = createTerminalDiagnosticBuffer(limit)
  if (!serialized) {
    return buffer
  }
  try {
    const parsed = JSON.parse(serialized) as { entries?: unknown }
    if (!Array.isArray(parsed.entries)) {
      return buffer
    }
    for (const candidate of parsed.entries) {
      if (!candidate || typeof candidate !== 'object') {
        continue
      }
      const entry = candidate as Record<string, unknown>
      if (
        !isTerminalDiagnosticSource(entry.source) ||
        typeof entry.event !== 'string' ||
        typeof entry.ts !== 'number' ||
        !Number.isFinite(entry.ts)
      ) {
        continue
      }
      appendTerminalDiagnostic(buffer, {
        source: entry.source,
        event: entry.event,
        ts: entry.ts,
        metrics:
          entry.metrics && typeof entry.metrics === 'object' && !Array.isArray(entry.metrics)
            ? (entry.metrics as Record<string, unknown>)
            : {}
      })
    }
  } catch {
    return buffer
  }
  return buffer
}

export function sanitizeTerminalDiagnosticMetrics(
  metrics: Record<string, unknown> | undefined
): Record<string, TerminalDiagnosticPrimitive> {
  if (!metrics) {
    return {}
  }
  const sanitized: Record<string, TerminalDiagnosticPrimitive> = {}
  for (const [key, value] of Object.entries(metrics)) {
    if (value === null || typeof value === 'number' || typeof value === 'boolean') {
      sanitized[key] = value
      continue
    }
    if (typeof value !== 'string') {
      continue
    }
    sanitized[key] = shouldRedactDiagnosticKey(key)
      ? '[redacted]'
      : sanitizeDiagnosticString(value)
  }
  return sanitized
}

function shouldRedactDiagnosticKey(key: string): boolean {
  const normalized = key.replaceAll(/[^a-z0-9]/gi, '').toLowerCase()
  return [...SECRET_KEY_FRAGMENTS, ...CONTENT_KEY_FRAGMENTS].some((fragment) =>
    normalized.includes(fragment)
  )
}

function isTerminalDiagnosticSource(value: unknown): value is TerminalDiagnosticSource {
  return value === 'mobile' || value === 'network' || value === 'webview'
}

function sanitizeDiagnosticString(value: string): string {
  const redactedUrls = value.replace(
    /\b(?:https?|wss?):\/\/[^\s"'<>]+/gi,
    (url) => redactDiagnosticUrl(url)
  )
  const redactedSecrets = redactedUrls.replace(
    /\b(deviceToken|clientToken|relayClientToken|sessionToken|authorization|password|secret|privateKey|publicKey|pairingCode)\s*[:=]\s*[^\s,;}]+/gi,
    '$1=[redacted]'
  )
  return redactedSecrets.slice(0, MAX_DIAGNOSTIC_STRING_LENGTH)
}

function redactDiagnosticUrl(value: string): string {
  const match = value.match(/^(https?|wss?):\/\/([^/?#]+)/i)
  return match ? `${match[1]}://${match[2]}/[redacted]` : '[redacted-url]'
}
