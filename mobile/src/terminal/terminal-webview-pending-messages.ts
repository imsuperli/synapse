import type { TerminalWebViewCommand } from './terminal-webview-messages'

const MAX_PENDING_WEB_WRITE_BYTES = 1_000_000
const MAX_PENDING_WEB_WRITE_MESSAGES = 4096

export function createTerminalWebViewPendingMessages(
  limits: { maxWriteBytes?: number; maxWriteMessages?: number } = {}
) {
  const maxWriteBytes = limits.maxWriteBytes ?? MAX_PENDING_WEB_WRITE_BYTES
  const maxWriteMessages = limits.maxWriteMessages ?? MAX_PENDING_WEB_WRITE_MESSAGES
  let pending: TerminalWebViewCommand[] = []
  let pendingWriteBytes = 0
  let pendingWriteCount = 0
  let writeOverflowed = false

  const resetCounters = () => {
    pendingWriteBytes = 0
    pendingWriteCount = 0
  }

  const clear = () => {
    pending = []
    resetCounters()
    writeOverflowed = false
  }

  const queue = (msg: TerminalWebViewCommand) => {
    if (msg.type === 'init') {
      // A full init is a replay boundary. It contains every write received
      // before this call, so older writes and init commands must not follow it.
      pending = pending.filter((candidate) => candidate.type !== 'write' && candidate.type !== 'init')
      resetCounters()
      writeOverflowed = false
      pending.push(msg)
      return { writeOverflowed: false }
    }
    if (msg.type === 'set-live-input-text') {
      const stateIndex = pending.findIndex((candidate) => candidate.type === msg.type)
      if (stateIndex === -1) {
        pending.push(msg)
      } else {
        pending.splice(stateIndex, 1)
        pending.push(msg)
      }
      return { writeOverflowed: false }
    }
    if (msg.type === 'write' && writeOverflowed) {
      return { writeOverflowed: false }
    }
    pending.push(msg)
    if (msg.type !== 'write') {
      return { writeOverflowed: false }
    }

    pendingWriteBytes += msg.data.length
    pendingWriteCount += 1
    while (
      pendingWriteBytes > maxWriteBytes ||
      pendingWriteCount > maxWriteMessages
    ) {
      pending = pending.filter((candidate) => candidate.type !== 'write')
      resetCounters()
      writeOverflowed = true
      return { writeOverflowed: true }
    }
    return { writeOverflowed: false }
  }

  const flush = (send: (msg: TerminalWebViewCommand) => void) => {
    const messages = pending
    pending = []
    resetCounters()
    for (const msg of messages) {
      send(msg)
    }
  }

  return { clear, flush, queue }
}
