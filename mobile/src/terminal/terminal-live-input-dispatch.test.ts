import { describe, expect, it, vi } from 'vitest'
import { dispatchTerminalLiveInput } from './terminal-live-input-dispatch'
import {
  queueTerminalLiveMirrorSend,
  type TerminalLivePendingFlushState
} from './terminal-live-pending-flush-state'

describe('terminal live input dispatch', () => {
  it('releases the ordered input queue after transport handoff without waiting for RPC responses', async () => {
    const state: TerminalLivePendingFlushState = { current: null }
    const handedOff: string[] = []
    let resolveFirst: () => void = () => {}
    const firstResponse = new Promise<void>((resolve) => {
      resolveFirst = resolve
    })
    const onRejected = vi.fn()

    const first = queueTerminalLiveMirrorSend(state, () =>
      dispatchTerminalLiveInput(() => {
        handedOff.push('first')
        return firstResponse
      }, onRejected)
    )
    const second = queueTerminalLiveMirrorSend(state, () =>
      dispatchTerminalLiveInput(async () => {
        handedOff.push('second')
      }, onRejected)
    )

    await expect(first).resolves.toBe(true)
    await expect(second).resolves.toBe(true)
    expect(handedOff).toEqual(['first', 'second'])
    expect(onRejected).not.toHaveBeenCalled()
    resolveFirst()
  })

  it('reports an asynchronous RPC rejection without reopening the ordering barrier', async () => {
    const onRejected = vi.fn()
    const error = new Error('connection closed')

    await expect(
      dispatchTerminalLiveInput(() => Promise.reject(error), onRejected)
    ).resolves.toBe(true)
    await vi.waitFor(() => expect(onRejected).toHaveBeenCalledWith(error))
  })
})
