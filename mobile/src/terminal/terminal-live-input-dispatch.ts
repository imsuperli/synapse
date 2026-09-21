export function dispatchTerminalLiveInput(
  send: () => Promise<void>,
  onRejected: (error: unknown) => void
): Promise<boolean> {
  try {
    // send() synchronously hands the request to RpcClient/WebSocket. Input order
    // is therefore fixed before this barrier resolves; the RPC response is only
    // an acknowledgement and must not serialize later keystrokes on network RTT.
    void send().catch(onRejected)
    return Promise.resolve(true)
  } catch (error) {
    onRejected(error)
    return Promise.resolve(false)
  }
}
