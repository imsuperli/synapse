# Synapse Mobile Remote Control Design

Date: 2026-07-08

Status: reviewed implementation plan with implementation-status corrections

Scope: Synapse desktop, Synapse mobile app, optional public relay service

Reference source: `../tmp/orca`

## Background

Orca already has a usable mobile remote-control architecture: the desktop runtime starts a WebSocket RPC server, exposes a QR pairing flow, stores per-device revocable tokens, and encrypts mobile traffic at the application layer with Curve25519/tweetnacl. Its current product path mainly targets LAN or private overlay networks, but the protocol can advertise any reachable endpoint, including Tailscale, tunnel, or `wss://` public addresses.

Synapse already has the most important backend primitive for this feature: a unified `ProcessManager` that can create local and SSH terminals, write input to PTY sessions, resize terminals, return bounded history, and publish live PTY output. The right design is therefore not to port Orca's whole runtime. Synapse should build a narrow remote gateway around its existing process and window model, while reusing Orca's pairing, transport, encryption, and mobile network-state design where it fits.

## Goals

1. Let a phone pair with Synapse desktop by scanning a QR code or pasting a pairing code.
2. Let the phone view and control Synapse terminal panes, including local and SSH-backed panes.
3. Support LAN, Tailscale, ZeroTier, manually configured public tunnel endpoints, and eventually an official Synapse relay.
4. Keep remote control deny-by-default, scoped, revocable, encrypted, and auditable.
5. Reuse Orca mobile app code where practical, especially pairing, host storage, WebSocket RPC, reconnect handling, and terminal WebView.
6. Avoid exposing Electron IPC directly to the network.
7. Leave room for future file, workspace, task, plugin, and runtime control without weakening the initial security model.

## Non-Goals

1. Full OS-level remote desktop, screen sharing, mouse injection, or global keyboard injection.
2. Exposing arbitrary Synapse renderer or Electron IPC methods to mobile clients.
3. Building an official relay as the first deliverable.
4. Sharing one global token across all mobile devices.
5. Sending unencrypted terminal traffic over a public network.

## Implementation Boundary

This is a complete staged implementation plan, not an MVP-only plan. The phases are ordered to reduce risk, but the user-facing remote-control feature is not considered complete until the relevant completion boundary is reached:

1. Terminal-first direct mobile remote control is complete only after Phase 1 through Phase 6 pass their definitions of done. This release lets a phone pair, list running terminal panes, open a terminal, type, resize, clear, reconnect, and use LAN/Tailscale/manual `wss://` tunnel endpoints.
2. Full desktop-layout remote control is complete only after Phase 2B also passes. This is the boundary for showing the same window/pane model as Synapse desktop, including paused or non-running terminal panes.
3. Public remote control without a hosted Synapse relay is complete when manual `wss://` tunnel endpoint pairing and terminal control work end to end, including revocation through the tunnel.
4. Hosted Synapse Relay is a separate production boundary that requires Phase 8 and Phase 9.
5. Internal milestones may expose `terminal.list` before full `window.list`, but the final plan still includes the main-owned window/pane API.
6. Mobile app source must be copied into this repository at the root `mobile/` directory. Do not use `apps/mobile/`, a git submodule, or a symlink to `../tmp/orca/mobile`.

## Current Implementation Status

This document is both a design and an implementation checklist. As of the current repository state on 2026-07-08:

| Area | Status | Notes |
| --- | --- | --- |
| Mobile source location | Implemented | Synapse Mobile lives in the repository root `mobile/` directory as a normal directory, not a symlink, submodule, or `apps/mobile/` package. |
| Desktop remote foundation | Implemented | Shared protocol, device registry, keypair storage, E2EE channel, WebSocket transport, gateway lifecycle, settings persistence, desktop settings IPC, and settings UI are present. |
| Terminal remote API | Implemented | `terminal.list`, `terminal.history`, `terminal.subscribe`, `terminal.unsubscribe`, `terminal.send`, `terminal.resize`, and `terminal.clear` are implemented through the remote dispatcher. |
| Terminal recovery | Implemented | Terminal history uses monotonic sequence numbers, `sinceSeq`, gap detection, duplicate suppression, and clear-without-sequence-reset behavior. |
| Main-owned read-only state | Implemented for privileged mobile scopes | `RemoteStateProvider` backs `window.list` and `pane.list`. Synapse Mobile uses it only when the paired device scope allows `window.list`; default `mobile.control` pairing still uses `terminal.list`. |
| Window lifecycle mutation | Pending | `RemoteWindowLifecycleService` is still required before enabling `window.start`, `window.activate`, `window.close`, `pane.focus`, or `pane.close`. These must not call Electron IPC handlers directly. |
| Mobile app | Implemented for terminal control and privileged read-only layout | The Expo app is copied/adapted under `mobile/`, uses `synapse://pair`, stores tokens securely, connects over E2EE RPC, lists running terminals, opens terminal panes, and can show grouped window/pane summaries when the paired scope includes `window.list`. |
| Mobile identity | Implemented with release checks | App name, package id, bundle id, scheme, storage prefixes, and visible Synapse strings are changed. Release verification must continue to fail on stale Orca identity. |
| Copied Orca reference code | Release-scoped, cleanup pending | Synapse Mobile routes, typecheck scope, and identity verification cover the Synapse import graph. Some copied Orca reference modules remain outside that graph and should be deleted or moved to an excluded reference area before a store/release build. |
| Mobile GitHub automation | Implemented for validation, pending for signed artifacts | `.github/workflows/mobile.yml` installs dependencies and runs mobile typecheck, tests, and identity verification. It does not yet build or sign Android APK/AAB or iOS IPA artifacts. |
| Public direct tunnel | Partially implemented | Settings accept manual endpoints and pairing can advertise `wss://`; tunnel setup docs and provider smoke tests remain pending. |
| Hosted relay | Pending | Official Synapse Relay remains a separate Phase 8/9 production boundary. |

## 2026-07-14 Terminal Session Performance Correction

### Problems Recorded

The implemented mobile terminal route exposed two related performance defects that were not
covered by the original single-terminal design.

#### Window-group tab switches are cold starts

The terminal tabs currently call `router.replace()` with another
`/h/[hostId]/t/[windowId]/[paneId]` route. Losing focus runs the route cleanup, which:

1. unsubscribes the terminal stream;
2. closes the host WebSocket;
3. clears terminal history and prefetch state;
4. destroys the xterm WebView;
5. reconnects, reloads the window list, subscribes, replays history, and measures the viewport.

The visible tabs therefore behave like navigation links, not resident terminal tabs. Repeatedly
switching between two running terminals costs several seconds each time and loses the local xterm
viewport state.

#### Foreground recovery replays accumulated animation

When Android suspends the app, terminal output can accumulate in either the native WebSocket event
queue or desktop PTY history. On foreground:

1. a live socket may deliver every queued output frame;
2. a reconnected subscription may send a 512 KiB incremental snapshot;
3. `terminal.history` then catches up in 192 KiB pages;
4. every intermediate chunk is appended to the xterm asynchronous write queue.

For Codex and other TUIs this replays transient working indicators and screen repaints that are no
longer useful. Network transfer can finish quickly while xterm still spends many seconds parsing
old frames, producing the visible rapid-refresh catch-up effect.

### Corrected User Experience

1. Entering a window group loads the selected terminal first.
2. A terminal loads at most once while resident. The initial implementation warms a terminal on its
   first activation; idle-time prewarming of untouched tabs may be added after memory/relay traffic
   measurements prove it does not compete with the active terminal.
3. Switching between resident tabs changes the visible terminal without route navigation, socket
   reconnect, history replay, or viewport remeasurement.
4. Hidden resident terminals continue tracking output without affecting desktop layout.
5. At least the two most recently used terminals remain resident; a bounded LRU policy prevents an
   unbounded number of Android WebViews.
6. Returning from background never animates through a large backlog. No output means no redraw;
   small deltas are coalesced into one write; large deltas replace the active mobile snapshot once.
7. Desktop PTY dimensions, desktop focus, and desktop terminal rendering remain untouched.

### Mobile Session Container

Replace route-owned singleton terminal state with a host-scoped session container. The route params
identify the initial terminal only; subsequent tab changes update `activeHandle` in the container.

Each `windowId:paneId` session owns:

```text
identity: windowId, paneId, runtimeKey
stream: unsubscribe, subscription generation, last received sequence
render: TerminalWebView ref, initialized flag, last rendered sequence
history: scrollback state, older-history prefetch state
viewport: desktop dimensions, mobile fitted rows, scroll/zoom-preserving WebView state
recovery: foreground dirty flag, recovery generation, loading/error state
lifecycle: last-used timestamp, resident/prewarmed/disposed state
```

The host container owns one `RpcClient`, the window/group list, app-state handling, and the resident
session LRU. `TerminalPaneView` is reused directly: inactive terminal WebViews stay mounted at
`opacity: 0` with pointer events disabled, preserving xterm buffers and scroll positions.

### Subscription Policy

1. One host connection multiplexes all resident `terminal.subscribe` streams.
2. The active terminal subscribes immediately.
3. Newly activated group terminals warm one at a time. Do not eagerly subscribe every untouched
   tab until Android WebView memory and relay traffic budgets are measured.
4. Resident hidden terminals update their history state continuously.
5. Hidden WebViews do not have to repaint every frame. Output may be coalesced until activation.
6. When the resident limit is exceeded, dispose the least recently used inactive WebView and its
   subscription, retaining a bounded recent snapshot and sequence cursor for incremental restore.
7. Removing a pane/window from a group disposes exactly that session. Leaving the terminal screen
   disposes the entire host container.

Initial resident limit: three terminals. This covers the common two-terminal workflow while keeping
Android WebView memory bounded. The limit must be a named constant and covered by LRU tests.

### Foreground Recovery Protocol

`terminal.history` responses for `sinceSeq` need to expose the desktop high-water mark separately
from the final entry included in the current page:

```ts
type TerminalHistoryResult = {
  // existing fields
  latestSeq: number
  hasMoreAfter: boolean
}
```

Recovery uses `lastRenderedSeq`, not merely `lastReceivedSeq`:

1. On background, mark every resident session render-paused and record its rendered cursor.
2. Incoming events may advance received history, but they must not enqueue unbounded xterm writes.
3. On foreground, recover the active session first and query from `lastRenderedSeq` with a bounded
   probe.
4. If `latestSeq === lastRenderedSeq`, resume without reinitializing.
5. If the complete delta fits the small-delta budget, merge and issue one coalesced WebView write.
6. If `hasMoreAfter` is true, pending data overflowed, the stream has a gap, or the delta exceeds the
   budget, resubscribe with `sinceSeq: 0` and apply the compact latest snapshot once.
7. After the latest screen is visible, resume live rendering and prefetch older history separately.
8. Recover inactive resident sessions lazily or at lower priority so they cannot delay the active
   terminal.

Initial small-delta budget: 256 KiB. The existing 128 KiB compact subscription snapshot remains the
large-backlog recovery source. Increasing page size alone is explicitly rejected because it still
forces xterm to parse every obsolete intermediate TUI frame.

### Concurrency Rules

1. Every session operation checks host run id, session generation, runtime key, and client identity.
2. A terminal restarted on desktop invalidates its old history, prefetch, and foreground recovery.
3. Live output arriving during snapshot construction is buffered by the desktop subscription and
   appended after the snapshot without duplication.
4. A foreground recovery and a tab activation for the same session share one in-flight promise.
5. Deleting or stopping a terminal cancels delayed prewarm/recovery work before routing to a
   replacement tab.
6. The command dock always reads `activeHandle` at send time; closures must not retain a previous
   tab's window or pane ids.

### Verification Matrix

Required tests include:

1. Repeated A/B/A/B group-tab switching does not call `router.replace`, reconnect the host, or
   request another initial snapshot for resident sessions.
2. Output produced in hidden terminal B is visible immediately when B becomes active.
3. Input, clear, stop, history loading, and pane deletion target the active session only.
4. Three resident terminals remain mounted; activating a fourth evicts only the least recently used
   inactive terminal.
5. Foreground with no output performs no xterm init/write.
6. Foreground with a small delta performs one coalesced write.
7. Foreground with a large delta performs one compact snapshot replacement and does not replay the
   intermediate pages into xterm.
8. Live output racing with recovery is neither lost nor duplicated.
9. Desktop restart, pane deletion, socket reconnect, app background, and tab switch combinations
   reject stale responses by generation.
10. Android layout keeps inactive WebViews mounted without overlap, touch interception, or keyboard
    movement.

## Orca Design Findings

The relevant Orca implementation is split across these areas:

| Area | Orca source | What to reuse |
| --- | --- | --- |
| Desktop pairing IPC | `../tmp/orca/src/main/ipc/mobile.ts` | Network-interface enumeration, QR generation shape, device revoke UI contract |
| Pairing payload | `../tmp/orca/src/shared/pairing.ts` | Versioned base64url pairing payload with endpoint, token, public key, scope |
| Device registry | `../tmp/orca/src/main/runtime/device-registry.ts` | Per-device token model, pending-device coalescing, explicit rotate/revoke |
| WebSocket transport | `../tmp/orca/src/main/runtime/rpc/ws-transport.ts` | `0.0.0.0` binding, port fallback, connection caps, pre-auth timeout, heartbeat |
| E2EE channel | `../tmp/orca/src/main/runtime/rpc/e2ee-channel.ts` | Handshake state machine and transparent encrypted RPC frames |
| E2EE keypair | `../tmp/orca/src/main/runtime/e2ee-keypair.ts` | Persistent desktop keypair with hardened file permissions |
| Mobile RPC client | `../tmp/orca/mobile/src/transport/rpc-client.ts` | Reconnect backoff, foreground recovery, half-open socket probes, request/stream multiplexing |
| Mobile host storage | `../tmp/orca/mobile/src/transport/host-store.ts` | AsyncStorage metadata plus SecureStore token storage |
| Mobile pairing UI | `../tmp/orca/mobile/app/pair-scan.tsx` | Camera QR flow, paste code flow, pairing status probe, connection log |

Orca's LAN limitation is not fundamental. The pairing offer carries an endpoint, and Orca already documents `--pairing-address` for LAN, Tailscale, tunnel, or public hostname scenarios in `../tmp/orca/docs/reference/headless-linux-server.md`.

## Other Orca Designs Worth Referencing

Beyond the mobile remote-control path, Orca has several engineering patterns worth adopting selectively:

| Area | Orca reference | Synapse use |
| --- | --- | --- |
| Reliability gates | `../tmp/orca/config/reliability-gates.jsonc`, `../tmp/orca/config/scripts/check-reliability-gates.mjs` | Keep long-lived terminal and remote-control regressions behind explicit local/CI gates instead of relying only on unit tests |
| Terminal performance budgets | `../tmp/orca/config/scripts/run-terminal-scale-perf-report-gate.mjs`, `../tmp/orca/config/scripts/check-terminal-perf-report-budgets.mjs` | Add measurable limits for large output streams, terminal startup, and remote replay memory growth |
| Mobile emulator workflows | `../tmp/orca/docs/android-emulation.md`, `../tmp/orca/docs/android-emulation-streaming.md`, `../tmp/orca/mobile/scripts/start-emulator.mjs` | Provide a repeatable Android pairing/control smoke path for developers without manual emulator setup |
| Release asset verification | `../tmp/orca/config/scripts/verify-release-required-assets.mjs` | Add a Synapse release check that fails if mobile/desktop packaging misses required branded assets |
| Secure local file writes | `../tmp/orca/docs/windows-secure-file-acl-hardening.md` and secure-file helpers | Reuse the hardened write/permissions pattern for remote keypairs, device registry, and settings |
| Main-owned terminal state | `../tmp/orca/docs/terminal-main-owned-state.md` | Use main-owned state as the model for `RemoteStateProvider`, instead of deriving full UI state from renderer-only stores |
| Connection diagnostics | `../tmp/orca/mobile/src/components/ConnectionLog.tsx`, mobile transport logs | Keep user-visible pairing/reconnect diagnostics so public endpoint failures can be debugged without developer logs |

These should be treated as patterns, not bulk ports. Synapse should copy only the modules that match its architecture and rewrite product-specific Orca concepts such as worktrees, browser panes, agent sessions, and source-control workflows.

## Synapse Fit

Synapse already has these backend capabilities:

| Capability | Synapse source | Remote use |
| --- | --- | --- |
| Create terminal | `src/main/services/ProcessManager.ts` | Start a pane or restore a paused pane |
| List process info | `src/main/services/ProcessManager.ts` | Build the first-release list of running terminal sessions |
| Resolve `windowId:paneId` to PID | `src/main/services/ProcessManager.ts` | Route remote terminal actions |
| Write PTY input | `src/main/services/ProcessManager.ts` | `terminal.send` |
| Resize PTY | `src/main/services/ProcessManager.ts` | `terminal.resize` |
| Subscribe PTY data | `src/main/services/ProcessManager.ts` | `terminal.subscribe` |
| Read PTY history | `src/main/services/ProcessManager.ts` | `terminal.history` |
| Start/close windows | `src/main/handlers/windowHandlers.ts` | Source logic to extract into a remote-safe lifecycle service |

The remote subsystem must provide these pieces, whether implemented in the first terminal release or deferred to later phases:

1. External WebSocket RPC server.
2. Pairing service and QR UI.
3. Device registry and revocation.
4. E2EE key storage and handshake.
5. Remote method dispatcher with allowlist.
6. Mobile app adaptation.
7. Public endpoint and relay support.
8. Terminal stream reliability beyond simple chunk replay.
9. Main-owned remote state provider for full window/pane listing.
10. Remote-safe window lifecycle service extracted from IPC handler logic.

## Design Corrections Applied

This section records issues found during the first implementation-readiness review and the corrections now applied to this design.

### Main-Owned Window State Is Required

The earlier plan said `window.list` and `pane.list` could be built from `ProcessManager`. That is only partially true.

`ProcessManager` can reliably list live terminal processes and map `windowId:paneId` to a running PID. It cannot, by itself, reconstruct the full Synapse window layout, paused panes, code/browser/chat panes, archived windows, or the renderer's persisted window store. If mobile is expected to show the same window/pane list as desktop, the remote subsystem needs a main-owned state source.

Add one of these before implementing `window.list`:

1. Preferred: `RemoteStateProvider`, backed by the same persisted workspace/window data that desktop restore uses.
2. Acceptable early path: expose only running terminal panes from `ProcessManager`, and name the method `terminal.list` instead of pretending it is a full `window.list`.
3. Later path: mirror renderer window-store changes into main process through a narrow, typed state sync channel.

Applied adjustment:

1. Phase 2 should expose `terminal.list` first.
2. `window.list` should wait until `RemoteStateProvider` exists.
3. `window.start` must be implemented through a safe main-process service, not by replaying renderer IPC payloads.

### Remote Window Lifecycle Needs a Service Boundary

`windowHandlers.ts` currently contains logic for creating, starting, and closing windows through Electron IPC. The remote subsystem should not call IPC handlers directly. Extract or create a main-process service facade for the subset of window lifecycle operations that remote control needs.

Add:

```text
src/main/remote/RemoteStateProvider.ts
src/main/remote/RemoteWindowLifecycleService.ts
```

The lifecycle service should validate:

1. The window exists in current workspace state.
2. The pane is a terminal pane.
3. The pane has a safe cwd/command source.
4. The requested operation is allowed by the device scope.

### Package Dependencies Are Explicit

Synapse desktop currently does not list all dependencies used by the Orca remote stack. Step 0 of the desktop implementation plan now requires these dependencies before copied modules are introduced:

Runtime dependencies:

```text
ws
tweetnacl
qrcode
zod
```

Development dependencies:

```text
@types/ws
@types/qrcode
```

If Synapse chooses Web Crypto instead of tweetnacl, document that explicitly and do not copy Orca's E2EE crypto helpers verbatim.

### Pairing Token Lifetime Policy Is Required

Orca's pending-token coalescing avoids accumulating orphaned tokens, but the Synapse public-internet design also requires a token lifetime policy.

Recommended policy:

1. Pending pairing offers expire after a short TTL, for example 10 minutes.
2. Regenerating QR invalidates any pending token immediately.
3. A scanned token becomes a paired device only after successful E2EE auth and `status.get`.
4. Public relay pairing should optionally require desktop-side confirmation for the first official release.

### Terminal History Must Not Depend On The Initial PTY Output Buffer

Synapse's `subscribePtyData` drains the early `ptyOutputBuffers` cache when the first subscriber attaches. Desktop renderer subscription may already have consumed it before mobile subscribes. Mobile must therefore use `terminal.history` as the source of initial terminal state, then use `terminal.subscribe` only for incremental output.

Implementation rule:

1. Mobile terminal screen always calls `terminal.history` first.
2. `terminal.subscribe` starts from `lastSeq`.
3. The remote terminal controller must not rely on `ptyOutputBuffers`.
4. If history was evicted, return `gap: true` and force a full terminal reload or snapshot fetch.

### Terminal Sequence Numbers Must Be Monotonic

Sequence numbers are the contract that lets mobile deduplicate replayed output and recover after reconnects. They must be monotonic for a pane during a running PTY session.

Required behavior:

1. `terminal.history` returns `firstSeq`, `lastSeq`, and `gap`.
2. `terminal.subscribe` returns an initial `TerminalSubscribeResult` with `subscriptionId`, `firstSeq`, `lastSeq`, and `gap`.
3. Live `TerminalOutputEvent.seq` must be greater than the last emitted or replayed sequence, except legacy or diagnostic events with `seq: 0`.
4. Mobile must ignore sequenced output events where `seq <= lastSeq`.
5. `terminal.clear` must clear replayable chunks but must not reset the pane's next output sequence.
6. Process exit or replacement may discard the pane history state; a new session for the same pane starts from a clean history buffer.

Without rule 5, an active mobile subscription can miss all output after a remote clear because the server would restart at `seq: 1` while mobile is still filtering `seq <= previousLastSeq`.

### Mobile App Identity Must Be Changed, Not Only UI Text

Copying Orca mobile is acceptable, but shipping it as Synapse requires a full app identity rewrite:

1. App display name.
2. Android package name.
3. iOS bundle identifier.
4. Deep-link scheme.
5. App icon.
6. Splash screen.
7. Notification icon/channel names, if notifications are kept.
8. SecureStore key prefixes.
9. AsyncStorage key prefixes.
10. File names and internal package metadata that still say Orca.
11. App store metadata and privacy strings.
12. Camera permission copy.

The implementation should fail review if a released build still uses Orca package identifiers, scheme, icons, token storage keys, or visible branding.

### Copied Mobile Code Must Be Release-Scoped

Copying `../tmp/orca/mobile` is useful as a starting point, but leaving every copied module inside the release build/typecheck scope creates a false implementation burden. Orca mobile includes worktree, git, browser, file preview, dictation, notifications, and agent/session screens that are not part of Synapse Mobile terminal remote control.

Applied rule:

1. The mobile project lives at repository root `mobile/`.
2. Synapse release code may keep only the app routes and source modules that are imported by Synapse Mobile.
3. Unmigrated Orca modules must be deleted before release or moved under an explicitly excluded reference directory such as `mobile/orca-reference/`.
4. `mobile/tsconfig.json`, Metro, and tests must cover the Synapse Mobile import graph, not the entire unfiltered Orca copy.
5. No runtime source may import from `../tmp/orca`.
6. Release verification must fail if app metadata, storage keys, visible strings, package identifiers, schemes, icons, or splash assets still carry Orca identity.

This rule prevents the first mobile release from accidentally promising unsupported Orca features while still allowing targeted source reuse.

### Public Connectivity Should Be Staged

The design's final relay plan is valid, but it should not be mixed into the first implementation milestone. Direct LAN/Tailscale/manual tunnel support should ship first. Official relay requires account, abuse prevention, rate limits, metrics, support policy, and cost controls.

Recommended staging:

1. Direct LAN/Tailscale.
2. Manual `wss://` tunnel endpoint.
3. Optional local tunnel provider integrations.
4. Official Synapse relay.

### Pairing Scope Must Match The Permission Model

The pairing payload must not use vague scopes such as `mobile` or `runtime`. It should use the same `RemoteDeviceScope` values that the dispatcher enforces:

```text
mobile.read
mobile.control
mobile.window-control
mobile.admin
```

Default Synapse Mobile pairing grants `mobile.control`. `mobile.admin` is reserved for explicitly trusted admin clients and should not be granted by the default QR flow. Runtime-level or desktop automation clients must use a separate future scope model; the Synapse Mobile pairing payload must reject any `runtime.*` scope.

### Shared Protocol Must Be Mobile-Safe

The shared remote protocol code is used by both Electron main/preload tests and the Expo mobile app. Shared files must not depend on Electron, Node-only APIs, filesystem APIs, or desktop-only types at runtime.

Implementation requirements:

1. Keep `src/shared/remote` as the protocol source of truth, or extract it into a local package such as `packages/remote-protocol`.
2. Configure `mobile/metro.config.js` and `mobile/tsconfig.json` so Synapse Mobile imports that same source through an alias such as `@synapse/remote-protocol`.
3. If Expo cannot consume the source directly, generate the mobile copy from the same source during build; do not hand-maintain a divergent protocol copy.
4. Replace Node-only `Buffer` base64url helpers with cross-runtime helpers, or add an explicit mobile-safe polyfill and tests.
5. Add tests that encode/decode the same pairing offer in desktop and mobile runtimes.

### Settings Persistence Is Part Of The Feature

Remote settings must persist across desktop restarts. The first install remains deny-by-default, but after a user explicitly enables remote control, Synapse should restore the saved remote settings on launch unless the user disables the feature.

Persist at least:

1. `enabled`
2. bind host, defaulting to `0.0.0.0`
3. preferred port, defaulting to `6868`
4. selected network interface or address
5. manual endpoint, if configured
6. whether the user explicitly accepted a plain `ws://` warning for a non-local endpoint
7. whether remote control should start automatically when Synapse launches

## User Experience

After the feature is implemented, the user-facing experience should look like this.

### Desktop Setup

1. User opens Synapse desktop.
2. User opens Settings -> Remote / Mobile.
3. User enables remote control.
4. Synapse starts the remote gateway and shows connection status.
5. Synapse shows available addresses, such as LAN IP and Tailscale IP.
6. User picks an address or types a custom endpoint.
7. Synapse shows a QR code and a copyable pairing code.
8. User can regenerate the QR if it may have been exposed.
9. User can see paired devices and revoke any device.

For public access without Synapse Relay, the user configures a tunnel separately, then pastes the `wss://...` endpoint into the desktop settings panel before generating the QR.

### Mobile App

Yes, this plan includes a mobile app. The mobile app should be copied and adapted from Orca's Expo app, then rebranded and rewired as Synapse Mobile.

Expected first-release mobile app:

1. Native Android app.
2. Native iOS app if signing/build capacity is available.
3. QR scan pairing.
4. Paste pairing code fallback.
5. Saved host list.
6. Secure token storage.
7. Running terminal list for the first release.
8. Full read-only window/pane list when the paired device has `mobile.window-control` or `mobile.admin` scope and the desktop advertises `window.list`.
9. Remote terminal screen using xterm in WebView.
10. Reconnect status and diagnostics.
11. Host settings with remove/re-pair actions.

From the user's perspective, the first production release is a Synapse Mobile app, not an embedded web page. The phone app starts at a saved-host list, pairs by scanning `synapse://pair` QR codes from desktop settings, then opens a host overview. Default mobile pairing lists running terminal panes. If a desktop build and device scope advertise `window.list`, the same overview groups terminal panes by Synapse window and shows non-running terminal panes as disabled until a safe lifecycle service is available.

### First Pairing Flow

1. User installs Synapse Mobile.
2. User taps "Pair with desktop".
3. User scans the QR code from Synapse desktop.
4. Mobile connects to the endpoint in the QR.
5. Mobile completes E2EE handshake.
6. Mobile validates the pairing by calling `status.get`.
7. Mobile saves the host.
8. User lands on the host overview screen.

If camera access is denied, the user can paste the pairing code instead.

### Daily Use Flow

1. User opens Synapse Mobile.
2. User selects a saved desktop host.
3. Mobile reconnects automatically.
4. User sees available running terminal sessions.
5. User opens a pane.
6. Mobile loads terminal history.
7. Mobile subscribes to live output.
8. User types commands from the phone.
9. Terminal output streams back in near real time.
10. If the app backgrounds or the network changes, mobile reconnects and resubscribes.

### Public Remote Flow

For self-managed public access:

1. User starts a tunnel that forwards to the Synapse desktop remote port.
2. User enters the public `wss://...` endpoint in desktop settings.
3. User pairs the phone with a QR generated from that endpoint.
4. Mobile can connect when away from home or office.

For future Synapse Relay:

1. User signs in on desktop.
2. Desktop connects outbound to Synapse Relay.
3. User signs in on mobile.
4. Mobile selects the desktop from the account device list or scans a relay QR.
5. Relay routes encrypted frames between mobile and desktop.
6. The relay does not decrypt terminal/control payloads.

## Target Architecture

```text
Synapse Mobile App
  - QR / paste pairing
  - Host list
  - Terminal list
  - xterm WebView terminal
  - SecureStore token storage
  - reconnect / foreground recovery

        encrypted RPC over ws/wss
        or encrypted frames through relay

Synapse Desktop
  - RemoteGateway
  - RemoteWebSocketTransport
  - RemoteE2EEChannel
  - RemoteDeviceRegistry
  - RemoteDispatcher
  - RemoteStateProvider
  - RemoteWindowLifecycleService
  - Terminal subscription manager
  - Pairing QR/settings UI

        narrow method facade

Existing Synapse Services
  - ProcessManager
  - workspace/window state
  - status poller
  - SSH terminal backend
```

For official public remote control:

```text
Mobile App  <--- wss relay session --->  Synapse Relay  <--- wss relay session --->  Desktop

Business RPC remains E2EE from mobile to desktop.
Relay routes frames but cannot decrypt terminal/control payloads.
```

## Protocol

### Pairing URL

Use a Synapse-specific scheme:

```text
synapse://pair?code=<base64url-json>
```

The payload should be versioned:

```ts
type PairingOffer = {
  v: 1
  endpoint: string
  deviceToken: string
  publicKeyB64: string
  scope: RemoteDeviceScope
  hostName?: string
  relaySessionId?: string
}

type RemoteDeviceScope =
  | 'mobile.read'
  | 'mobile.control'
  | 'mobile.window-control'
  | 'mobile.admin'
```

Rules:

1. `endpoint` may be `ws://`, `wss://`, or a relay endpoint.
2. `deviceToken` is a bearer credential and must only be shown inside the QR/code.
3. `publicKeyB64` is the desktop static E2EE public key.
4. `scope` controls the exact dispatcher method allowlist.
5. `relaySessionId` is present only for official relay pairing.

### E2EE Handshake

Reuse Orca's model:

1. Mobile opens WebSocket.
2. Mobile generates ephemeral keypair.
3. Mobile sends plaintext:

```json
{ "type": "e2ee_hello", "publicKeyB64": "..." }
```

4. Desktop derives shared key and sends plaintext:

```json
{ "type": "e2ee_ready" }
```

5. Mobile sends encrypted auth:

```json
{ "type": "e2ee_auth", "deviceToken": "..." }
```

6. Desktop validates token, marks the device as seen, and sends encrypted:

```json
{ "type": "e2ee_authenticated" }
```

7. All RPC requests, RPC responses, stream events, and terminal binary frames are encrypted after this point.

### RPC Envelope

Use a small JSON-RPC-like envelope:

```ts
type RemoteRpcRequest = {
  id: string
  method: string
  params?: unknown
}

type RemoteRpcSuccess = {
  id: string
  ok: true
  result: unknown
}

type RemoteRpcError = {
  id: string
  ok: false
  error: {
    code: string
    message: string
  }
}
```

Streaming methods return an initial success response with `subscriptionId`, followed by encrypted event frames:

```ts
type RemoteStreamEvent = {
  type: 'event'
  subscriptionId: string
  payload: unknown
}
```

## Initial Remote Method Surface

Do not expose existing IPC names directly. Define remote methods as a separate API.

### Host and Capability Methods

| Method | Purpose |
| --- | --- |
| `status.get` | Validate pairing and return basic host status |
| `host.info` | Return host name, platform, app version |
| `remote.capabilities` | Return supported protocol version and method capabilities |

### First-Release Terminal Listing Method

| Method | Purpose |
| --- | --- |
| `terminal.list` | List running terminal sessions known to `ProcessManager` |

`terminal.list` should return only controllable entries by default:

```ts
type RemoteTerminalSummary = {
  windowId: string
  paneId: string
  sessionId: string
  pid: number
  backend: 'local' | 'ssh'
  status: 'alive' | 'exited'
  workingDirectory: string
  command?: string
  profileId?: string
}
```

If a future source returns a session that has no stable `windowId` and `paneId`, mobile may show it as diagnostic information but must not open it for `terminal.history`, `terminal.send`, or `terminal.resize`.

### Terminal Methods

| Method | Purpose |
| --- | --- |
| `terminal.history` | Return terminal history chunks and `lastSeq` |
| `terminal.subscribe` | Subscribe to live terminal output |
| `terminal.unsubscribe` | Stop a terminal output subscription |
| `terminal.send` | Write user input to a terminal |
| `terminal.resize` | Resize a terminal to mobile viewport dimensions |
| `terminal.clear` | Clear remote replay history for a pane and tell mobile to reset its local terminal display; it must not inject shell input |

### Deferred Window and Pane Methods

Read-only `window.list` and `pane.list` require `RemoteStateProvider`. Mutating lifecycle methods require `RemoteWindowLifecycleService`. None of these methods may be implemented by calling Electron IPC handlers directly.

| Method | Purpose |
| --- | --- |
| `window.list` | List visible Synapse windows and their panes from main-owned workspace/window state |
| `window.activate` | Mark a window as active on desktop, if supported |
| `window.start` | Start or restore a window/pane session through `RemoteWindowLifecycleService` |
| `window.close` | Close a window through the safe lifecycle service |
| `pane.list` | List panes with IDs, status, cwd, backend, and kind |
| `pane.focus` | Focus a pane, if desktop state supports it |
| `pane.close` | Close a pane through the safe lifecycle service |

### Device Methods

| Method | Purpose |
| --- | --- |
| `device.list` | List paired mobile devices for settings/admin clients |
| `device.revoke` | Revoke a paired device |

### Later Methods

Add only after the terminal feature is stable:

| Method | Purpose |
| --- | --- |
| `workspace.list` | List workspaces/projects |
| `workspace.open` | Open/switch workspace |
| `ssh.profile.list` | List saved SSH profiles |
| `ssh.connect` | Start SSH terminal |
| `file.preview` | Return small safe file previews |
| `file.read` | Read file content behind explicit permission |
| `file.download` | Download selected files |
| `task.list` | Show Synapse tasks/agents |
| `task.action` | Approve/cancel/retry task actions |
| `plugin.command` | Invoke allowlisted plugin commands |

## Permissions

The first implementation should support scopes even if only one mobile scope is used.

```text
mobile.read
  status.get
  host.info
  remote.capabilities
  terminal.list
  terminal.history
  terminal.subscribe
  terminal.unsubscribe

mobile.control
  everything in mobile.read
  terminal.send
  terminal.resize
  terminal.clear

mobile.window-control
  everything in mobile.control
  window.list
  window.start
  window.activate
  pane.list
  pane.focus
  pane.close

mobile.admin
  everything in mobile.window-control
  device.list
  device.revoke
```

Default mobile pairing should grant `mobile.control`, not `mobile.admin`. The current mobile remote-control protocol intentionally has no `runtime.full` escape hatch; any future desktop automation or runtime client should get a separate explicitly reviewed protocol and pairing flow.

## Desktop Implementation Plan

### Step 0: Dependencies And Defaults

Add the desktop dependencies required by the copied/adapted Orca remote stack:

Runtime dependencies:

```text
ws
tweetnacl
qrcode
zod
```

Development dependencies:

```text
@types/ws
@types/qrcode
```

Defaults:

1. The desktop WebSocket server uses port `6868` by default.
2. Port `6868` avoids colliding with Orca's default `6768` if both apps are installed.
3. If `6868` is occupied, the transport falls back to an OS-assigned port and advertises the resolved port in the QR pairing payload.
4. The mobile app source lives in this repository at `mobile/`.
5. Do not place the mobile app under `apps/mobile/` for this project.

### Step 1: Shared Remote Types

Add:

```text
src/shared/remote/pairing.ts
src/shared/remote/rpc.ts
src/shared/remote/methods.ts
src/shared/remote/errors.ts
src/shared/remote/terminal-protocol.ts
```

Implementation notes:

1. Port Orca's pairing encode/decode logic and change the scheme to `synapse://pair`.
2. Validate payloads with `zod` or existing Synapse validation patterns.
3. Define protocol version constants.
4. Keep remote method names independent from Electron IPC names.

### Step 2: Remote Security Modules

Add:

```text
src/main/remote/RemoteDeviceRegistry.ts
src/main/remote/RemoteKeypairStore.ts
src/main/remote/RemoteE2EEChannel.ts
src/main/remote/RemoteSecureFile.ts
```

Implementation notes:

1. Reuse Orca's per-device registry design.
2. Store registry and E2EE keypair under Electron `userData`.
3. Harden file permissions where the platform supports it.
4. Coalesce repeated QR requests into one pending token.
5. Support explicit QR rotation.
6. Terminate active sockets immediately when a device is revoked.
7. Expire pending pairing offers after 10 minutes by default.
8. Promote a pending token to a paired device only after successful E2EE auth and `status.get`.

### Step 3: WebSocket Transport

Add:

```text
src/main/remote/RemoteWebSocketTransport.ts
```

Defaults:

```text
host: 0.0.0.0
preferred port: 6868
max message bytes: 1 MB
max connections: 128
pre-auth timeout: 10 s
heartbeat interval: 15 s
```

Requirements:

1. Fall back to an OS-assigned port if the preferred port is occupied.
2. Expose the resolved endpoint to the pairing service.
3. Track authenticated device token per WebSocket.
4. Clear subscriptions and E2EE channel state on close/error.
5. Never dispatch any RPC before E2EE authentication succeeds.

### Step 4: Remote Dispatcher

Add:

```text
src/main/remote/RemoteDispatcher.ts
src/main/remote/RemoteMethodAllowlist.ts
src/main/remote/RemoteTerminalController.ts
src/main/remote/RemoteStateProvider.ts
src/main/remote/RemoteWindowLifecycleService.ts
```

Responsibilities:

1. Parse and validate RPC requests.
2. Check the authenticated device scope.
3. Reject unknown methods.
4. Reject methods outside the device's allowlist.
5. Route first-release terminal methods to `ProcessManager`.
6. Route `terminal.list` from live `ProcessManager` process info.
7. Route deferred window/pane methods only after `RemoteStateProvider` and `RemoteWindowLifecycleService` are implemented.
8. Reject deferred window/pane methods with `method_not_found` or `forbidden` until their service boundary exists.
9. Own subscription IDs and unsubscribe cleanup.
10. Return stable error codes.

Suggested error codes:

```text
bad_request
unauthorized
forbidden
not_found
method_not_found
invalid_params
terminal_not_found
subscription_not_found
payload_too_large
internal_error
runtime_busy
```

### Step 5: Remote Gateway Lifecycle

Add:

```text
src/main/remote/RemoteGateway.ts
src/main/remote/RemoteSettingsStore.ts
```

Responsibilities:

1. Start/stop the WebSocket transport based on settings.
2. Own device registry and E2EE keypair.
3. Create pairing offers.
4. Revoke devices.
5. Publish status to the settings UI.
6. Shut down cleanly when Synapse exits.
7. Persist remote settings under Electron `userData`.
8. Restore saved settings on app launch only after explicit user enablement.

Integrate it from `src/main/index.ts` near other service construction, not from renderer code.

### Step 6: Main Process IPC for Settings UI

Add a small local IPC surface for the desktop settings page:

```text
remote:listNetworkInterfaces
remote:getPairingQR
remote:rotatePairingQR
remote:getStatus
remote:listDevices
remote:revokeDevice
remote:updateSettings
```

These IPC handlers are local desktop UI only. They are not the network API.

`remote:updateSettings` must validate and persist the settings before applying them. It should reject invalid endpoint schemes and require explicit user acknowledgement before accepting a public-looking `ws://` endpoint.

### Step 7: Desktop Settings UI

Add a Remote/Mobile settings panel:

1. Enable/disable remote control.
2. Show WebSocket status and resolved local endpoint.
3. Show network address selector.
4. Prioritize Tailscale/overlay addresses when detected.
5. Allow manual address or full endpoint:

```text
192.168.1.20
100.64.1.20
desktop-name.tailnet.ts.net
ws://192.168.1.20:6868
wss://synapse-user.example.com
```

6. Generate QR.
7. Copy pairing code.
8. Regenerate QR.
9. List paired devices with last seen time.
10. Revoke device.
11. Show public access guidance:

```text
Trusted network: ws:// LAN/Tailscale/ZeroTier
Public internet: wss:// tunnel or Synapse Relay
Encryption: application-layer E2EE always enabled
```

Validation and persistence requirements:

1. Save changes through `RemoteSettingsStore`, not renderer local state.
2. Start or stop `RemoteGateway` only after settings validation succeeds.
3. Accept `ws://` only for LAN, localhost, or explicit user-acknowledged non-public use.
4. Require or strongly warn for `wss://` on public internet endpoints.
5. Regenerate the QR after endpoint, interface, port, or scope changes.

## Mobile Implementation Plan

### Step 1: Create Synapse Mobile App Package

Required location:

```text
mobile/
```

For this project, do not use `apps/mobile/`. The mobile source must live at the repository root `mobile/` directory so desktop, mobile, and shared protocol files are easy to navigate together.

Start by copying `../tmp/orca/mobile` into `./mobile`, then remove Orca-specific features. The copied directory should become normal Synapse source controlled by this repository, not a submodule and not a symlink back to Orca.

Keep:

1. Expo Router setup.
2. QR scanner flow.
3. Paste pairing code flow.
4. SecureStore host token storage.
5. RPC client connection state machine.
6. Reconnect/backoff/foreground recovery.
7. xterm WebView terminal engine.
8. Connection log UI.

Replace:

1. `orca://` with `synapse://`.
2. Orca host/profile names with Synapse naming.
3. Orca worktree/session/git/browser screens with Synapse window/pane/terminal screens.
4. Orca RPC method names with Synapse remote methods.
5. Branding, colors, icons, and app metadata.

Required app identity changes:

| Item | Required change |
| --- | --- |
| App name | Change visible display name from Orca to Synapse Mobile or the chosen Synapse product name |
| Android package | Replace Orca package/application id with a Synapse id, for example `com.lchpersonal.synapse.mobile` |
| iOS bundle id | Replace Orca bundle identifier with a Synapse identifier, for example `com.lchpersonal.synapse.mobile` |
| URL scheme | Replace `orca://` with `synapse://` |
| App icon | Replace all Orca launcher icons with Synapse icons |
| Splash screen | Replace Orca splash assets and text |
| SecureStore keys | Replace `orca.*` prefixes with `synapse.*` prefixes |
| AsyncStorage keys | Replace `orca:*` prefixes with `synapse:*` prefixes |
| Permission text | Replace camera/network copy with Synapse wording |
| Package metadata | Update `package.json`, Expo config, native project names, and app store metadata |

Permission cleanup rule:

1. Terminal-first Synapse Mobile should request camera access for QR pairing and local-network access where the platform requires it.
2. Microphone, photo-library, notification, file-picker, or document permissions copied from Orca must be removed unless the corresponding Synapse feature is intentionally shipped.
3. If a later Synapse feature reintroduces those permissions, its user-facing copy must describe the Synapse feature, not Orca's original workflow.

Required asset work:

1. Create Synapse mobile launcher icon in Android adaptive icon sizes.
2. Create iOS app icon set.
3. Create splash screen assets.
4. Replace any Orca in-app logo or wordmark.
5. Verify no visible Orca branding remains in screenshots.

Required repository integration:

1. Add mobile scripts from the root package where useful, for example `mobile:start`, `mobile:android`, `mobile:ios`, and `mobile:test`.
2. Keep `mobile/package.json` as the Expo app package.
3. Keep mobile-specific native assets, Fastlane metadata, plugins, and build scripts under `mobile/`.
4. Wire mobile imports to the shared remote protocol source through Metro/TypeScript config or a generated protocol package.
5. Add a CI or local verification command that scans release metadata for stale Orca identifiers.
6. Keep `mobile/` as a normal tracked directory in this repository; do not keep it as a symlink, git submodule, or path alias to `../tmp/orca/mobile`.

### Step 1A: Shared Protocol Consumption

The mobile app must not fork the remote protocol definitions.

Preferred implementation:

1. Keep shared protocol source in `src/shared/remote`.
2. Add a small barrel module for mobile-safe exports.
3. Configure `mobile/metro.config.js` with the repository root in `watchFolders`.
4. Configure `mobile/tsconfig.json` paths so `@synapse/remote-protocol` resolves to the shared remote source.
5. Keep the shared code free of Node-only runtime dependencies.

Alternative implementation:

1. Extract `src/shared/remote` into a local package, for example `packages/remote-protocol`.
2. Make desktop and `mobile/` both depend on that package.
3. Keep tests in the package and run them from both desktop and mobile commands.

Rejected implementation:

1. Copy protocol files once into `mobile/` and edit them independently.
2. Keep separate desktop and mobile definitions for pairing, scopes, RPC envelopes, or terminal events.

### Step 2: Mobile Routes

Suggested screens:

```text
/
  Host list

/pair
  Scan QR
  Paste pairing code
  Pairing connection log

/h/:hostId
  Host overview
  Running terminal list
  Full window/pane list after RemoteStateProvider is implemented
  Connection status

/h/:hostId/t/:windowId/:paneId
  xterm terminal
  toolbar for keyboard helpers and reconnect state

/h/:hostId/settings
  Rename host
  Remove host
  Show endpoint
  Show connection diagnostics
```

### Step 3: Mobile Host Model

Store non-secret metadata in AsyncStorage:

```ts
type StoredHostProfile = {
  id: string
  name: string
  endpoint: string
  publicKeyB64: string
  lastConnected: number | null
  relaySessionId?: string
}
```

Store `deviceToken` in SecureStore/Keychain only.

### Step 4: Mobile Pairing Flow

1. Scan QR or paste pairing code.
2. Decode `PairingOffer`.
3. Open WebSocket.
4. Complete E2EE handshake.
5. Send encrypted auth.
6. Call `status.get`.
7. If successful, save host metadata and token.
8. Navigate to host overview.

Pairing timeout should be explicit, around 25 seconds, with connection logs visible on failure.

### Step 5: Mobile Terminal Flow

1. Host overview calls `terminal.list` for the first release.
2. User opens a running terminal pane.
3. Terminal screen calls `terminal.history`.
4. Terminal screen opens `terminal.subscribe` with `sinceSeq`.
5. xterm receives history chunks and live output.
6. User input sends `terminal.send`.
7. xterm viewport changes send `terminal.resize`.
8. App background/foreground triggers reconnect and resubscribe.

After `RemoteStateProvider` ships, host overview may switch from `terminal.list` to `window.list` plus `pane.list` only when both the device scope and server capabilities allow it. Default `mobile.control` devices remain on `terminal.list`.

## Terminal Streaming Design

Synapse can start with existing history chunks, but the complete design should use sequence-aware recovery.

### History Response

```ts
type TerminalHistoryResult = {
  windowId: string
  paneId: string
  chunks: string[]
  firstSeq: number
  lastSeq: number
  gap: boolean
  keyboardState?: unknown
}
```

### Subscribe Params

```ts
type TerminalSubscribeParams = {
  windowId: string
  paneId: string
  sinceSeq?: number
  viewport?: {
    cols: number
    rows: number
  }
}
```

### Subscribe Result

```ts
type TerminalSubscribeResult = {
  subscriptionId: string
  firstSeq: number
  lastSeq: number
  gap: boolean
}
```

The subscribe result is delivered before stream events. Mobile must inspect it before treating subsequent payloads as terminal output. If `gap` is true, mobile should cancel the current subscription, reload `terminal.history`, then subscribe again from the new `lastSeq`.

### Stream Event

```ts
type TerminalOutputEvent = {
  windowId: string
  paneId: string
  seq: number
  data: string
}
```

### Clear Params And Result

```ts
type TerminalClearParams = {
  windowId: string
  paneId: string
}

type TerminalClearResult = {
  windowId: string
  paneId: string
  cleared: true
  lastSeq: number
}
```

`terminal.clear` clears remote replay history for the pane and lets mobile clear its xterm display locally. It must not send `clear`, Ctrl+L, or any other input into the shell.

Implementation rule:

1. Preserve the pane's `lastSeq` and `nextSeq` when clearing replay history.
2. Return the preserved `lastSeq` in `TerminalClearResult`.
3. Mobile updates its local `lastSeq` from the clear result before clearing the WebView display.
4. Future PTY output for the same running session continues at a higher `seq`.

### Recovery Rules

1. Mobile tracks `lastSeq`.
2. On reconnect, mobile resubscribes with `sinceSeq`.
3. Desktop replays missing chunks if still in buffer.
4. If missing chunks were evicted, desktop returns `gap: true` in the subscribe result.
5. Mobile cancels that subscription, reloads `terminal.history`, and subscribes from the new `lastSeq`.
6. Mobile ignores sequenced live events where `seq <= lastSeq`.
7. Desktop drops or coalesces output if socket backpressure is too high.

### Future Terminal Snapshot

For high-fidelity TUI restoration, add a headless xterm state per pane:

1. Main process feeds PTY chunks into headless xterm.
2. `terminal.snapshot` returns serialized buffer and cursor state.
3. Mobile applies snapshot before live subscription.

This should be a later reliability phase, not a blocker for first remote control release.

## Public Connectivity Plan

### Phase A: LAN and Overlay Network

Deliver:

1. Bind desktop WebSocket to `0.0.0.0`.
2. Let user select LAN/Tailscale/ZeroTier address.
3. Generate QR with reachable endpoint.
4. Mobile connects directly.

This covers the fastest useful path.

### Phase B: Manual Public Endpoint

Deliver:

1. Settings UI accepts full endpoint.
2. QR can advertise `wss://public.example.com`.
3. Document Cloudflare Tunnel, frp, ngrok, SSH reverse tunnel, and router port forwarding.
4. Keep E2EE enabled regardless of TLS.

Policy:

1. `ws://` is allowed only with explicit warning.
2. `wss://` is recommended for public internet.
3. Public tunnel provider must not terminate application-layer encryption.

### Phase C: Optional Built-In Tunnel Providers

Add a provider abstraction:

```text
src/main/remote/tunnel/TunnelProvider.ts
src/main/remote/tunnel/CloudflareTunnelProvider.ts
src/main/remote/tunnel/FrpProvider.ts
```

Provider interface:

```ts
type TunnelProvider = {
  start(): Promise<{ publicEndpoint: string }>
  stop(): Promise<void>
  getStatus(): Promise<TunnelStatus>
}
```

This improves UX without operating an official Synapse relay.

### Phase D: Official Synapse Relay

Final public remote architecture:

```text
Desktop Synapse --outbound wss--> Synapse Relay <--wss outbound-- Mobile App
```

Relay requirements:

1. Account authentication.
2. Desktop device registration.
3. Mobile session authorization.
4. Session routing.
5. Rate limiting.
6. Abuse protection.
7. Connection and bandwidth metrics.
8. Regional routing if needed.
9. Service health dashboards.
10. No access to decrypted business RPC payloads.

Relay pairing payload:

```ts
type RelayPairingOffer = {
  v: 1
  endpoint: 'wss://relay.synapse.app'
  relaySessionId: string
  deviceToken: string
  publicKeyB64: string
  scope: 'mobile.control'
}
```

Relay frame:

```ts
type RelayFrame = {
  sessionId: string
  direction: 'mobile-to-desktop' | 'desktop-to-mobile'
  payload: string | Uint8Array
}
```

The relay authenticates envelope metadata but does not decrypt `payload`.

## Security Requirements

1. Network remote control must be disabled by default unless product decides otherwise.
2. All network RPC dispatch must require successful E2EE auth.
3. Each paired device gets a unique token.
4. Tokens are revocable from desktop settings.
5. QR pairing tokens are bearer credentials.
6. Regenerating a QR invalidates never-scanned pending tokens.
7. Revoking a device terminates active sockets immediately.
8. Method dispatch is deny-by-default.
9. Mobile scope must not gain runtime/admin methods accidentally.
10. Logs must redact device tokens and full pairing URLs.
11. `ws://` public endpoint use must show a warning.
12. `wss://` plus app-layer E2EE is required for productized public use.
13. The relay must not receive plaintext terminal/control payloads.
14. Backpressure limits must prevent a slow mobile client from unbounded memory growth.
15. Pre-auth timeout must prevent unauthenticated sockets from occupying slots forever.
16. Payload size limits must reject oversized messages.
17. Terminal input should be auditable at the method boundary, without logging raw secrets by default.

## Reuse and Licensing

Orca and Synapse are MIT licensed. Orca's license is copyright Lovecast Inc.

If Synapse copies substantial Orca source files or large code blocks:

1. Keep Orca's MIT license notice in copied files or an attribution notice.
2. Rename packages, schemes, and product identifiers.
3. Remove Orca-specific worktree/session/git/browser assumptions.
4. Prefer small, traceable module copies over bulk repository imports.

Recommended direct-copy candidates:

1. Pairing encode/decode logic.
2. E2EE channel and crypto helpers.
3. E2EE keypair storage pattern.
4. Device registry pattern.
5. WebSocket transport heartbeat/pre-auth/connection cap pattern.
6. Mobile RPC client state machine.
7. Mobile SecureStore host token pattern.
8. Mobile QR/paste pairing flow.
9. Mobile xterm WebView terminal engine.

Recommended rewrite candidates:

1. Runtime dispatcher.
2. Method allowlist.
3. Window/pane models.
4. Terminal subscription controller.
5. Desktop settings UI.
6. Relay integration.

## Implementation Phases

### Phase 1: Foundation

Deliverables:

1. Shared remote protocol files.
2. Pairing encode/decode tests.
3. Device registry.
4. E2EE keypair storage.
5. E2EE channel.
6. WebSocket transport.
7. RemoteGateway lifecycle.
8. Remote settings store with deny-by-default initial settings.

Definition of done:

1. Desktop can start a remote WebSocket server.
2. Desktop can create a pairing offer.
3. A test client can complete E2EE auth.
4. Unauthorized clients cannot dispatch methods.

### Phase 2: Desktop Terminal Remote API

Deliverables:

1. `RemoteDispatcher`.
2. `status.get`, `host.info`, `remote.capabilities`.
3. `terminal.list` for running terminal sessions.
4. `terminal.history`, `terminal.subscribe`, `terminal.unsubscribe`.
5. `terminal.send`, `terminal.resize`, `terminal.clear`.
6. Subscription cleanup on disconnect.

Definition of done:

1. A local test client can list running terminal sessions.
2. A local test client can read history.
3. A local test client can subscribe to live output.
4. A local test client can type into a terminal.
5. A local test client can resize a terminal.
6. A local test client can clear remote replay history without injecting shell input.

### Phase 2B: Main-Owned Window State And Window API

Deliverables:

1. `RemoteStateProvider`.
2. `window.list`.
3. `pane.list`.
4. Synapse Mobile capability-gated consumption of `window.list`.
5. `RemoteWindowLifecycleService`.
6. `window.start`, if paused terminal panes need mobile restore.
7. `window.activate`, if desktop focus sync is needed.
8. `pane.focus`, if desktop focus sync is needed.
9. `window.close` and `pane.close`, only through the safe lifecycle service.

Definition of done:

1. Remote `window.list` matches the desktop workspace/window state for terminal panes.
2. Remote list includes enough metadata for mobile to distinguish running and non-running panes.
3. Mobile uses `window.list` only when both scope and capabilities allow it, and falls back to `terminal.list` otherwise.
4. Window lifecycle methods do not call Electron IPC handlers directly.
5. Mutating lifecycle methods update main-owned workspace state and notify the renderer before being enabled.
6. Deferred mutating methods are protected by explicit scope checks.

### Phase 3: Desktop Settings UI

Deliverables:

1. Remote settings panel.
2. Enable/disable remote server.
3. Network interface selection.
4. Manual endpoint entry.
5. QR generation.
6. Pairing code copy.
7. QR rotation.
8. Paired device list.
9. Device revoke.
10. Persistent settings and startup restore.
11. Public endpoint validation and warnings.

Definition of done:

1. User can pair from a visible QR/code.
2. User can choose LAN/Tailscale/manual endpoint.
3. User can revoke a device and active connection closes.
4. Remote settings survive desktop restart after explicit enablement.
5. Public-looking `ws://` endpoints require an explicit warning acknowledgement.

### Phase 4: Synapse Mobile App

Deliverables:

1. Mobile project copied/adapted from Orca into repository root `mobile/`.
2. `synapse://pair` support.
3. Host list.
4. Pair scan/paste.
5. Host storage with SecureStore token.
6. RPC client adapted to Synapse methods.
7. Running terminal list screen.
8. Terminal screen using xterm WebView.
9. Android package name changed to Synapse identity.
10. iOS bundle id changed to Synapse identity.
11. App name, icon, splash, scheme, storage keys, and visible branding changed to Synapse.
12. Shared remote protocol imported from the Synapse source of truth, not independently forked.

Definition of done:

1. Android build can scan QR and pair.
2. Mobile can connect to Synapse over LAN.
3. Mobile can open a terminal pane.
4. Mobile can type and receive output.
5. Mobile reconnects after app background/foreground.
6. Build artifacts and installed app do not contain Orca package id, URL scheme, app name, launcher icon, or storage-key prefix.
7. Full window/pane list is enabled only after Phase 2B is complete.
8. `mobile/` can run its own typecheck/test/build commands from the current repository.

GitHub automation boundary:

1. The repository should run mobile typecheck, tests, and identity verification in CI.
2. Automatic APK/AAB and IPA artifact builds require a separate release workflow with Android keystore, Apple signing credentials, provisioning profiles, and store/release-channel decisions.
3. Until that release workflow exists, CI passing means the mobile source is validated, not that GitHub has produced installable mobile artifacts.

### Phase 5: Terminal Reliability

Deliverables:

1. Sequence-aware history.
2. `sinceSeq` subscription recovery.
3. Gap detection.
4. Reconnect resubscription.
5. Mobile-side gap resync from `terminal.history`.
6. Monotonic pane sequence numbers across `terminal.clear`.
7. Backpressure handling.
8. Connection diagnostics UI.

Definition of done:

1. Mobile can recover after Wi-Fi toggle.
2. Mobile can recover after app background.
3. Missing terminal output is replayed when still buffered.
4. Mobile reloads history when a gap is detected.
5. Mobile ignores duplicate sequenced output after reconnect/replay.
6. `terminal.clear` does not reset server-side sequence numbers for a running pane.
7. Slow clients do not cause unbounded desktop memory growth.

### Phase 6: Manual Public Endpoint and Tunnel Docs

Deliverables:

1. Full endpoint entry in settings.
2. `wss://` endpoint QR.
3. Public tunnel setup docs.
4. UI warnings for public `ws://`.
5. Smoke tests through at least one tunnel provider.

Definition of done:

1. Mobile can control Synapse through a public `wss://` tunnel.
2. E2EE remains active through the tunnel.
3. Token revocation works through the tunnel.

### Phase 7: Extended Remote Features

Deliverables:

1. SSH profile listing and SSH terminal creation, if product wants it.
2. File preview/read behind explicit permission.
3. Workspace open/switch.
4. Safe task/agent actions.
5. Plugin command allowlist.

Definition of done:

1. Each new method has explicit permission scope.
2. Each new method has tests for allowed and forbidden scopes.
3. No new method bypasses `RemoteDispatcher`.

### Phase 8: Official Relay Prototype

Deliverables:

1. Relay service skeleton.
2. Desktop relay client.
3. Mobile relay client support.
4. Relay session routing.
5. Relay auth.
6. Relay rate limits.
7. Basic metrics.
8. E2EE payload passthrough.

Definition of done:

1. Desktop and mobile can connect through relay without inbound desktop port.
2. Relay cannot decrypt RPC payload.
3. Revoked token cannot reconnect through relay.
4. Relay disconnects idle/dead sessions.

### Phase 9: Relay Production Hardening

Deliverables:

1. Account/device model.
2. Abuse controls.
3. Regional capacity plan.
4. Observability dashboards.
5. Alerting.
6. Load tests.
7. Cost controls.
8. Privacy/security review.

Definition of done:

1. Relay survives load-test targets.
2. Relay has documented operational runbooks.
3. Public remote feature can be enabled for beta users.

## Test Plan

### Unit Tests

1. Pairing payload encode/decode.
2. Invalid scheme rejection.
3. Missing token rejection.
4. Device registry add/list/revoke.
5. Pending token coalescing.
6. QR rotation invalidates pending token.
7. E2EE handshake success.
8. E2EE bad public key.
9. E2EE bad auth.
10. Method allowlist.
11. RPC envelope validation.
12. Terminal method param validation.
13. Shared remote protocol avoids Node-only runtime dependencies or has explicit mobile-safe polyfills.
14. `terminal.clear` clears replay history without writing to the PTY.
15. `terminal.clear` preserves `lastSeq` and the next output sequence for an active pane.

### Integration Tests

1. WebSocket pre-auth timeout closes silent client.
2. Max payload rejects oversized message.
3. Max connection cap rejects overflow.
4. Heartbeat removes half-open sockets.
5. Revocation terminates active sockets.
6. `terminal.subscribe` cleans up on disconnect.
7. `terminal.send` routes to correct `windowId:paneId`.
8. `terminal.resize` routes to correct `windowId:paneId`.
9. `terminal.history` returns expected chunks and sequence.
10. `terminal.subscribe` returns `firstSeq`, `lastSeq`, and `gap` before stream events.
11. `terminal.subscribe` replays chunks after `sinceSeq` and reports `gap: true` when history was evicted.
12. Delayed subscription activation does not emit after connection cleanup.
13. Unauthorized device cannot call any method.
14. Read-only scope cannot send terminal input.
15. Remote settings persist and restore after desktop restart.
16. `remote:updateSettings` rejects invalid endpoint schemes.
17. Public-looking `ws://` endpoints require explicit acknowledgement.

### Mobile Tests

1. Scan valid QR.
2. Paste valid pairing code.
3. Reject invalid pairing code.
4. Pairing timeout shows diagnostic log.
5. Token stored in SecureStore.
6. Host metadata stored without token in AsyncStorage.
7. Reconnect backoff state transitions.
8. Foreground recovery triggers reconnect.
9. Terminal resubscribes after reconnect.
10. Terminal reloads history and resubscribes when subscribe result has `gap: true`.
11. Terminal ignores duplicate sequenced output after replay.
12. Clear result updates mobile `lastSeq` before clearing the WebView display.
13. Revoked token shows re-pair state.
14. Release metadata contains Synapse package id, app name, scheme, icons, splash, and storage prefixes.
15. Desktop and mobile decode the same pairing payload fixtures.

### End-to-End Tests

1. LAN pair and terminal control.
2. Tailscale/manual endpoint pair and terminal control.
3. `wss://` tunnel pair and terminal control.
4. Device revocation while terminal is open.
5. Desktop sleep/wake.
6. Phone background/foreground.
7. Network drop/recovery.
8. Large terminal output stream.
9. Multiple mobile devices connected.
10. Multiple terminal panes subscribed.

### Relay Tests

1. Desktop connects to relay.
2. Mobile connects to relay.
3. Relay routes frames by session.
4. Relay rejects unauthorized session.
5. Relay rate limits abusive clients.
6. Relay cannot parse decrypted RPC payload.
7. Relay survives desktop reconnect.
8. Relay session expires correctly.

## Operational Considerations

For LAN/manual endpoint modes:

1. No hosted infrastructure is required.
2. Support burden is mostly network reachability.
3. UI diagnostics should show endpoint, connection state, and last error.

For official relay:

1. The relay has recurring bandwidth and connection costs.
2. Public abuse protection is mandatory.
3. Account recovery and device revocation become product requirements.
4. Logs must avoid payloads and secrets.
5. Metrics should track connection counts, bytes relayed, session duration, auth failures, and region health.

## Rollout Plan

1. Internal development behind feature flag.
2. Desktop-only test client validates protocol.
3. Internal mobile LAN build.
4. Internal Tailscale build.
5. Manual `wss://` tunnel beta.
6. Harden terminal recovery.
7. Public documentation for self-managed tunnel.
8. Relay prototype for internal users.
9. Relay private beta.
10. Public release with relay optional, not required.

The direct public remote-control release gate is step 5 plus the Phase 6 tunnel definition of done. The official hosted relay release gate is step 10 plus Phase 9.

## Open Questions

1. Should Synapse support biometric unlock before opening a saved host on mobile?
2. How much desktop window state should mobile be allowed to mutate after `RemoteStateProvider` ships?
3. Should file access be part of the first public release or a separate feature gate?
4. Should official relay require a Synapse account from day one?
5. What is the expected relay bandwidth ceiling per user?

## Recommendation

Implement this as a new Synapse Remote subsystem, not as a full Orca runtime port.

The recommended order is:

1. Build shared protocol and security modules by adapting Orca.
2. Build a narrow desktop `RemoteGateway` around `ProcessManager`.
3. Build `terminal.list` plus terminal remote control over LAN/Tailscale.
4. Copy Orca mobile into this repository's root `mobile/` directory and rebrand it as Synapse Mobile.
5. Add `RemoteStateProvider` and remote-safe window lifecycle service before enabling full `window.list`/`pane.list`.
6. Harden terminal streaming and reconnect behavior.
7. Add manual public `wss://` endpoint support and verify terminal control through a tunnel.
8. Add optional tunnel provider integrations.
9. Build official relay only after the direct/tunnel path is reliable.

This path reuses Orca's strongest engineering work while keeping Synapse's remote API small, auditable, and aligned with its existing terminal architecture.
