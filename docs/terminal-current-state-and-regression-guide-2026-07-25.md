# 终端当前状态、问题台账与回归基线

本文记录 `c1402b3`（2026-07-25）之后 PC 端与手机端终端的真实数据链路、场景推演、已修复逻辑缺口和后续修改必须保持的不变量。本轮修复范围是 `9d94276` 至 `46ee2fe`。

它是当前实现的参考基线。以下文档仍有历史价值，但其中的数字和策略不能再直接当作当前事实：

- `mobile-codex-terminal-history-root-cause-2026-07-16.md`
- `mobile-terminal-adaptive-reflow-2026-07-17.md`
- `synapse-mobile-remote-control-design-2026-07-08.md`

例如，当前手机首次进入会分阶段自动激活历史，交替屏投影会拼接 normal history 和当前 alternate screen，移动端源 xterm 与可见投影的 scrollback 都是 30,000 行。这些都已不同于旧文档的阶段性描述。

## 1. 用户语义必须先区分

后续排查时不要混用以下状态：

1. **运行且正在输出**：PTY 存活，Codex/TUI 持续产生数据。
2. **运行但空闲**：PTY 存活，Codex 停止输出并等待用户输入。这不是 paused，也不是 stopped。
3. **历史阅读模式**：用户关闭实时跟随，视口停在旧内容处；PTY 可能仍在输出。
4. **暂停或已停止 pane**：`pane.running === false`，再次进入会先启动新 PTY。旧 PTY 退出后，主进程原始历史已被删除。
5. **App 进入后台**：连接和 RN 历史可能继续收数据，但 WebView 渲染被主动暂停。
6. **网络断开**：RPC stream 保留订阅描述，重连认证完成后用最新 `sinceSeq` 重新订阅。

“Codex 空闲”与“pane 已暂停”走的是完全不同的代码路径，不能用同一修复处理。

## 2. 当前数据源与容量边界

### 2.1 PC 主进程

`ProcessManager` 是可恢复原始 PTY 数据的唯一来源：

- 每个 pane 的输出序号单调递增。
- 最多保留 250,000 个输出块或 20,000,000 个字符，任一达到上限就淘汰最旧块。
- 淘汰位置通过 `evictedBeforeSeq` 传播。
- 清屏保留序号单调性，只删除可回放内容。
- PTY 退出时立即删除该 pane 的原始历史和 renderer screen snapshot。
- PC 应用退出后不持久化这些历史。

PC 可见 xterm 的常规 scrollback 是 10,000 行。用户正在上翻时，Codex `CSI S` 保留逻辑可以临时扩到 100,000 行，回到底部后恢复 10,000 行。这个可见行数边界和主进程 20,000,000 字符边界不是同一个概念。

### 2.2 远程传输

- 首次 `terminal.subscribe` 返回最近约 128 KiB 的紧凑快照。
- 普通历史分页每页最多 192 KiB。
- 增量订阅快照最多 512 KiB。
- 前台恢复的小增量探测最多 256 KiB。
- renderer 的 alternate screen snapshot 按其 `outputSeq` 插入原始历史，而不是无条件追加到末尾。

### 2.3 手机 RN 与 WebView

每个 `windowId:paneId` runtime 独立保存订阅 generation、历史 generation、原始历史、预取页、WebView ref、跟随状态、渲染暂停状态和 rendered sequence。

- 最多同时挂载 3 个 WebView。
- 旧历史预取缓存目标上限为 768 KiB。
- 首屏延迟 350 ms 后，最多自动激活 3 个 192 KiB 阶段，目标是至少两屏 scrollback。
- mobile source xterm 和可见 projection xterm 的默认 scrollback 都是 30,000 行；历史阅读且即将 trim 时可临时扩到最高 100,000 行。
- RN 连续 history 与 PC 事实源采用相同硬边界：250,000 个 chunk 或 20,000,000 字符；超限走 compact snapshot，不直接裁断 ANSI 状态。
- LRU 淘汰会同时销毁 WebView、订阅、预取、runtime 和 raw history。

## 3. 当前渲染模型

手机不能按手机列数直接回放 PC 原始 PTY 字节，也不能改变共享 PTY 的尺寸。当前采用双 xterm：

1. source xterm 始终按 PC 的 `cols x rows` 解析 ANSI、光标、滚动区、鼠标模式和 alternate screen。
2. 普通稳定 normal output 序列化后，投影到手机宽度。
3. 复杂控制序列或 Codex 动态屏幕使用 snapshot projection。
4. snapshot projection 当前把已加载 normal history 与当前 alternate content 组成同一个行模型。
5. 序列化、OSC link 几何和独立 cursor overlay 共用该行模型。
6. 正在触摸、缩放或惯性滚动时延迟替换投影；隐藏的新 surface 完成解析和 fit 后才原子显示。

这个模型解决的是“同一份 PTY 语义在手机重新排版”，不是把终端降级成纯文本日志。

## 4. 按用户场景推演

| 场景 | 当前链路 | 走查结论 |
| --- | --- | --- |
| 首次进入运行中终端 | 128 KiB 快照先显示，随后最多 3 阶段补历史 | init 不再依赖 load-start 事件顺序；仍需真机时序矩阵 |
| 进入运行但空闲的 Codex | 保留当前 source/snapshot，隐藏 TextInput 发送输入 | 输入、光标和投影共模逻辑成立 |
| Codex 持续输出且跟随开启 | source 解析，安全输出增量写 projection，复杂输出延迟原子重建并回到底部 | 主链路成立 |
| 持续输出时关闭跟随并上翻 | 历史阅读模式拥有本地 projection 手势；重建按可见内容锚定 | normal/alternate 均成立；实时模式仍把手势交给 TUI |
| 到达已加载历史顶部 | 有效下拉累计 24 px，正常抬手后激活 1 个预取页，再后台补下一批 | `touchcancel` 只撤销手势；后台不消费或重放分页 |
| 加载历史时又收到 live output | RN 先 prepend，再以完整历史 init；init 期间 WebView 自己排队 live write | generation 和原子 surface 逻辑成立 |
| A/B/A 常用终端切换 | 各自 WebView、history、scroll state 保持驻留 | 主链路成立 |
| 第 4 个终端触发 LRU | 销毁最久未使用的 inactive runtime 全部资源 | Map、history、prefetch、subscription 和 WebView 一起回收 |
| App 进入后台又回来 | 所有 runtime 标记 render paused；前台按 rendered seq 恢复 active runtime | 普通 RPC 失败会有界退避重试，不再永久暂停 |
| 网络中断后重连 | RPC client 复用 mutable `sinceSeq` 重新订阅，新 stream id 替换旧路由 | stream 重连与旧 frame 隔离有测试 |
| 从 tab 启动暂停 pane | 固定 `80x30` 执行 `window.start`，再切换到新 runtime | 不再继承当前另一个终端的 viewport |
| 双指缩放、旋转、键盘升降 | 缩放吸附预设；投影按目标字体重建；仅高度变化时原地调整 rows | 实际 xterm 测试覆盖较完整 |
| 长按选择并 Copy | 可见 xterm 选择，RN 只复制 active handle 的非空文本 | selection/OSC offset 跟随 xterm 真实 trim |
| Ctrl/Alt 一次性组合键 | modifier 先置红，下一键组合后清除；外部发送前先 flush 输入 | 主链路和韩文/中文输入差分有测试 |

### 4.1 PC 端场景补充

| 场景 | 当前链路 | 走查结论 |
| --- | --- | --- |
| 首次挂载或同一 PTY 重建 renderer | 先订阅 live output，再请求 `getPtyHistory()`；回放期间缓存 live 数据，最后按 seq 去重衔接 | 顺序和去重成立；主进程有原始数据不代表 10,000 行 xterm 能全部显示 |
| 位于底部且持续输出 | 短输出可直写，其余输出按 animation frame 合并后写入 xterm | 主链路成立，输出缓冲有 100,000 字符强制 flush 边界 |
| 上翻阅读时 Codex 继续输出 | `onScroll` 保存 viewport；normal buffer 满时临时把 scrollback 从 10,000 扩到最高 100,000；`CSI S` 走可保留历史的 scroll path | 已覆盖此前“运行中突然跳第一行”的主要路径；回到底部后恢复 10,000 行 |
| 窗口失焦、隐藏后恢复 | 失焦前记录 viewport；恢复时 fit、render surface recovery 和 viewport restore 在同一个保护块中执行 | 已有行为测试覆盖顶部/底部异常跳转和 hidden terminal 门禁 |
| 拆分 pane 或从 paused 恢复 | `forceResizeToContainer()` 在显式 viewport 保护内执行 fit 和 PTY resize | 主链路成立 |
| 普通 ResizeObserver / window resize | fit 前捕获可见内容，fit/reflow 后恢复同一内容锚点，再同步 PTY | 有真实重排行为测试覆盖 |
| PTY 退出 | 立即删除主进程 raw history 和 alternate screen snapshot；renderer 随 pane 状态 reset | 停止后的旧历史不可恢复，这是当前产品语义，不是分页失败 |

## 5. 已修复的高优先级问题

这里的“确认”表示源码存在完整可达路径，不是依据现象猜测。尚未在真机复现的条件会单独注明。

### H1. 前台恢复遇到普通请求失败后可以永久停止渲染

**状态**：已由 `9d94276` 修复。普通失败保持 paused/requested 并按 500 ms 至 5 s 退避重试；后台、销毁和 generation 变化会取消 timer。

**证据**：`recoverTerminalAfterForeground()` 在开始时要求 `foregroundRecoveryRequested`，并在后台状态把 `terminalRenderPaused` 设为 true。成功分支会恢复渲染；`catch` 只处理 `terminal_not_found`。超时、瞬时 RPC 错误或服务错误不会清除 `terminalRenderPaused`，也不会安排重试。连接状态如果一直是 `connected`，监听 connection state 的 effect 不会再次执行。

**用户表现**：切回 App 后界面停住，缩放和新输出看起来都没有反应；切换到其他 terminal 再切回来时，`openTerminal()` 再次触发恢复，所以突然恢复。

### H2. 手机连续历史和被 LRU 淘汰的 runtime 都没有内存上限

**状态**：已由 `f1a6c68` 修复。连续 history 对齐 PC 容量边界，超限 compact；LRU runtime 全量销毁。

**证据**：`appendHistoryChunks()` 只执行 `state.chunks.push(...)`。4 MiB 上限只约束乱序 `pendingDataBySeq`，不约束已连续接收的数据。LRU 淘汰时取消订阅、清 WebView flags，但不从 `sessionRuntimesRef` 删除 runtime，也不清其 history。再次进入被淘汰 runtime 时，`openTerminal()` 又会先 reset history，因此保留的数据不会被复用。

**用户表现**：长时间高输出、多 terminal 切换后，RN 内存持续增长；历史重建需要 join/replay 越来越大的字符串；可能表现为卡顿、后台切回慢、WebView 被系统回收。

### H3. alternate screen 的手势路由与“手机本地历史投影”互相冲突

**状态**：已由 `bc37e94` 修复。显式历史阅读模式优先本地 scrollback；实时模式保留 mouse-aware/alternate TUI 输入。

**证据**：当前 snapshot model 已把 normal history 放在 alternate content 前面；但 `shouldRouteScrollToTerminalInput()` 只要 source xterm 仍是 alternate 就返回 true。此时单指滑动全部转成鼠标滚轮或方向键发给远端 TUI，既不会滚动可见 projection，也不会触发 `history-top`。`autoScrollDisabled` 不参与这个判断，现有测试还明确固化了“alternate scrolling only to the TUI”。

**用户表现**：默认使用 alternate screen 的 Codex 中，即使按下“锁定历史/停止跟随”按钮，也可能无法查看手机已经加载的本地历史；手势反而改变 Codex 自己的滚动状态。

## 6. 已修复的中等优先级问题

### M1. WebView 未 ready 队列会静默丢输出，reload 后又可能重复输出

**状态**：已由 `29c2ccf` 修复。`init` 成为 replay generation 边界；overflow 显式通知 route compact；web-ready 顺序不再造成首载丢 init 或 reload 后重复 write。

`TerminalWebView` 在 `onLoadStart` 清空旧队列；未 ready 时只保留最多 1,000,000 字符或 4096 个 write，超限直接删除最早 write，没有把 overflow 通知 session recovery。

首次加载较慢且输出超过预算时，RN 已把 rendered seq 前移，WebView 却缺少被删除的 write。WebView reload 时还有相反问题：`web-ready` 处理先调用 route 的 `onWebReady()`，route 会用包含期间 live data 的完整 history 发送 init，然后才 flush load 期间排队的 write，导致这些 write 再回放一次。

这属于消息 generation/ack 缺失，不应通过继续扩大队列掩盖。当前实现已经让 overflow 触发 compact init，并保证某一代 init 已包含的数据不会再 flush。

### M2. 在终端页启动暂停 pane 时继承了另一个终端的网格

**状态**：已由 `5878a2a` 修复，所有终端页 paused/replacement 启动统一使用 `80x30`。

主机列表启动 pane 使用固定 `80x30`。终端页内的 pane tab、group window tab 和删除后的 replacement pane，却把当前 runtime 的 `viewportRef.current` 传给 `startRemoteWindow()`。

因此目标 pane 会继承正在查看的另一个终端的行列数。当前 pane 很宽或很高时，新启动的本地/SSH shell、Codex 或 TUI 从第一帧就可能按无关网格排版。

### M3. inactive runtime 的增量同步可以改写 active terminal 的页面级状态

**状态**：已由 `5878a2a` 修复，跨 await 的 running/error/loading 更新均校验 active handle，键盘 metrics 也归属 runtime。

每个 runtime 保存自己的 `syncTerminalIncrementRef`，inactive subscription 仍可能因序号缺口调起它。同步函数操作历史时使用 runtime refs，但部分 `setTerminalRunning(true/false)` 和 `setError(...)` 没有检查 `activeHandleRef.current === terminalHandle`。

结果是后台 resident terminal 的停止、gap reload 或错误可能改变当前另一个 terminal 的按钮可用性和错误提示。所有跨 await 的 UI 更新都必须同时校验 host run、runtime generation、client identity 和 active handle。

### M4. selection/OSC link 的淘汰判断仍按 5,000 行，实际 scrollback 是 30,000 行

**状态**：已由 `cc1ad9f` 修复，改为监听 xterm circular buffer 的真实 `onTrim(amount)`；无法观测 trim 时取消坐标敏感状态，不再猜测。

`isBufferFull()` 使用 `linesEverWritten >= 5000 + rows`，但 direct、source 和 projection xterm 当前都配置 30,000 行 scrollback。超过约 5,000 个 line feed 后，代码会在每次新行时提前递减 selection 的绝对行，并提前增加 `initialOscLinkRowOffset`，实际 xterm 此时通常尚未淘汰任何行。

长会话中会表现为选择句柄/复制范围漂移，或初始 OSC 8 链接点击位置逐步失配。淘汰跟踪必须读取当前 terminal 的真实 scrollback/buffer 状态，不能再保留硬编码常数。

### M5. `touchcancel` 会提交 history-top，且手动历史激活没有后台渲染门禁

**状态**：已由 `9d94276` 修复。只有正常 `touchend` 提交，activation 在请求前后都检查 render pause。

`touchcancel` 和正常 `touchend` 都调用 `flushPendingHistoryTopReached()`。Android 系统手势或 App 切后台可能取消触摸，于是一次未正常结束的下拉仍会启动 history activation。activation 在网络请求完成后没有检查 `terminalRenderPaused`，可以在后台对 WebView 执行完整 init/replay。

这违反“后台只收数据、不重放 WebView”和“只有明确完成的手势才加载”两条约束。是否保留部分 Android cancel 兼容行为，需要用真机事件日志决定，但后台渲染门禁必须独立成立。

### M6. 手机可见 xterm 的 30,000 行边界没有 PC 端的阅读保护

**状态**：已由 `a163d68` 修复。历史阅读且 buffer 即将 trim 时临时扩到最高 100,000 行，回到实时输出后恢复默认值。

手机 source/projection 都固定为 30,000 行。PC 端在用户阅读且 buffer 满时会临时扩大 scrollback，手机端的 `CSI S` installer 只保存 Codex 顶部滚动区域，没有同等的 reading headroom。

当用户已加载接近 30,000 行并停在旧内容处，持续 live output 会开始淘汰顶部行，视口可能逐渐移动或旧内容消失。RN 即使还保留原始数据，重新完整回放仍会再次受 30,000 行上限约束。这是明确容量边界，不能把它误诊为 PC 没返回历史。

## 7. 已修复的低优先级问题

### L1. snapshot live replacement 用绝对 viewport row，不是内容锚点

**状态**：已由 `cc6a63e` 修复。优先匹配首个可见非空文本及其视口偏移，找不到时回退距底部，再回退绝对位置。

锁定历史时，复杂 snapshot 替换会把旧 `viewportY` 原样应用到新 projection。normal history 前缀未变时这是正确的；如果 alternate blank compaction 或前置投影行数改变，同一个绝对行可能已经对应其他内容。

原有测试只证明“仍是同一个数字”，没有证明“仍是同一段文字”。当前行为测试使用可识别内容行验证锚点，算法找不到内容时才依次回退到距底部和绝对位置。

### L2. 键盘避让 metrics 是页面级状态，切 tab 时不会立即清空

**状态**：已由 `5878a2a` 修复，metrics 存入对应 runtime，激活 tab 时同步读取目标值。

`terminalKeyboardMetrics` 不属于 runtime，只有冷 `openTerminal()` 会清空。切换到已经 resident 的 terminal 时，键盘若仍打开，新 WebView 在发出下一次 metrics 前会短暂使用上一个 terminal 的 cursor/alt-screen 数据计算 lift。

### L3. 首次 WebView load 与初始 init 的事件顺序没有集成覆盖

**状态**：代码竞态已由 `29c2ccf` 修复；不同 Android WebView 版本的完整 native 事件排列仍需真机回归。

`onLoadStart` 会清空 pending messages，而 active route 在首次 `web-ready` 且 `terminalInitialized=true` 时只 reset zoom，不重新 init。正常设备通常先收到 load-start 再拿到远端 snapshot，但代码没有 generation handshake 证明这个顺序。若顺序反转，初始 init 可被清掉并留下空 surface。

这条是静态可达竞态，尚未有真机日志证明发生频率，必须先补可控事件顺序测试再修改。

### L4. PC 普通 ResizeObserver 路径没有显式保存 viewport

**状态**：已由 `1a631f9` 修复。普通 resize 使用可见文本、行内偏移和距底部三级锚点，并有重排行为测试。

pane count 变化、paused 恢复和 focus recovery 都通过 `preserveTerminalViewportY()` 包裹 fit；常规容器 `ResizeObserver` 和 `window.resize` 最终进入的 `runResize()` 却直接调用 `fitAddon.fit()`。这条路径依赖 xterm 自身 resize/reflow 保持阅读位置。

这是确定的保护不一致，但仅凭静态代码不能断言每次 resize 都会跳行或丢可见历史。本轮先用真实 xterm 重现宽度 reflow 后绝对行号失效，再加入内容锚点保护；测试覆盖用户停在中间历史后改变宽度仍定位到同一段内容。

### L5. Mobile lint 命令当前不可执行

**状态**：已由 `46ee2fe` 修复。mobile 配置不再引用不存在的父文件，`npm --prefix mobile run lint` 可完整执行；`max-lines` 基线锁定在当前有效行数。

## 8. 已验证正常、不要随意重写的链路

1. Subscription callback 由每个 runtime 的 subscription generation 隔离。
2. History/prefetch async work 由 history generation 隔离。
3. PC raw history、screen snapshot 和 snapshot 后续输出按 output sequence 组合。
4. RN 对重复 seq、乱序 seq 和增量重叠有去重与补洞逻辑。
5. 历史 prepend 后的全量 init 保留距底部行数，旧 surface 在新 surface ready 前保持可见。
6. live snapshot replacement 在触摸、pinch 和 momentum 期间延迟。
7. 光标、序列化内容和 OSC link 几何共享 snapshot row model。
8. 普通 stable output 走增量 projection；复杂 output 才请求重建。
9. 输入 RPC 只发送实际文本/控制字节，不把手机尺寸写回共享 PTY。
10. 中文直接输入、韩文组合、控制键前 flush 和一次性 Ctrl/Alt 均有独立测试。
11. Copy 只接受 active handle 的非空 selection，并调用系统 Clipboard API。
12. 重连会清理旧 terminal stream id，并用 mutable `sinceSeq` 继续订阅。
13. PC 端 Codex `CSI S` 会写入 normal scrollback；用户阅读时 xterm 有临时 headroom。
14. PC 前后台/窗口 focus recovery 会保存 viewport 并恢复 stale render surface。

## 9. 不可破坏的不变量

任何终端修改提交前都必须逐条检查：

1. **单一原始事实源**：ANSI 语义来自 PC 尺寸的 source xterm，不在手机列数上直接重放 raw PTY。
2. **不 resize 共享 PTY**：手机的字体、旋转和键盘变化不得改变 PC PTY 行列数。
3. **序号单调**：clear 不重置 seq；重复或旧 seq 不得再次渲染。
4. **received 与 rendered 分离**：收到数据不等于 WebView 已可靠呈现；overflow 必须显式触发 recovery。
5. **历史内容不缩减**：prepend 或 snapshot replacement 不能让已加载的 normal history 变少，除非明确到达容量淘汰边界并提示。
6. **阅读视口稳定**：live output、历史 prepend、前后台、resize 和 projection replacement 都不能无提示跳到顶部或底部。
7. **交互期间不换 surface**：touch、selection drag、pinch、momentum 中不替换当前可见 surface。
8. **旧 surface 原子替换**：新 surface 必须完成 parse、尺寸计算、scroll restore 和 transform 后才显示。
9. **光标共模**：cursor row/col 必须来自生成当前可见文本的同一个 projection model。
10. **每 runtime 隔离**：history、render pause、viewport、metrics、loading/error 和 async generation 不得污染其他 tab。
11. **后台不做大重放**：后台可以收序号和有界数据，不能启动完整 WebView replay。
12. **恢复最终收口**：每次 foreground/reconnect recovery 必须到达 resumed、retry scheduled、terminal gone 或 cancelled 之一。
13. **输入顺序稳定**：IME 待提交文本必须先于 Enter、Tab、Paste、Ctrl/Alt 组合键到达 PTY。
14. **容量有来源**：每个 raw history、prefetch、pending write、resident runtime 和 xterm scrollback 都必须有命名预算及边界行为。

## 10. 仍需补齐的集成与真机回归

本轮已为各修复补充定向测试，但 route 层仍有部分源码约束测试，无法代替 Android WebView、React Native 生命周期和真实网络时序。以下项目不阻塞当前修复，后续发布回归仍需覆盖：

1. Foreground history request 连续多次超时，验证 500 ms 至 5 s 退避、恢复成功和 timer 清理。
2. Background -> foreground -> tab switch 与 recovery response 交错，验证旧 runtime 不修改 active UI。
3. Android 真机上的 alternate-screen Codex 在实时与历史阅读两种模式下，验证手势分别归 TUI 和本地 projection。
4. History activation 与持续 live output 并发，验证最终内容无丢失、无重复且阅读锚点不变。
5. History fetch 中途进入后台或发生 `touchcancel`，验证后台不 init WebView，回前台后能继续收口。
6. 连续切换第 4、5、N 个高输出 terminal，采集 Android heap 曲线并验证 runtime、WebView、subscription 和 raw history 总量有界。
7. 在不同 Android System WebView 版本上排列首次 `load-start/web-ready/snapshot/init` native 事件，验证首屏不空白。
8. WebView reload 期间产生超过 1 MiB live output，验证只触发一次 compact recovery，不静默缺行或重复。
9. 历史阅读接近 100,000 行最终上限时持续输出，验证当前视口稳定，并明确记录达到最终淘汰边界后的产品表现。
10. Electron 真窗口中连续改变 pane 宽度、高度和数量，验证 PC 内容锚点与定向 xterm 测试一致。

## 11. 本轮修复记录

1. `9d94276`：前台恢复加入有界退避重试，后台历史激活增加渲染门禁，`touchcancel` 不再提交加载。
2. `f1a6c68`：RN 历史对齐 PC 容量边界，超限 compact，并完整回收 LRU runtime。
3. `bc37e94`：历史阅读模式使用本地 projection 手势，实时模式保留 alternate/mouse-aware TUI 输入。
4. `29c2ccf`：建立 WebView replay generation 边界，overflow 显式 compact recovery，消除 init 丢失和 reload 重复 write。
5. `5878a2a`：暂停 pane 固定以 `80x30` 启动，隔离 inactive runtime UI 状态与各 runtime 键盘 metrics。
6. `cc1ad9f`：selection 和 OSC link 坐标改为跟随 xterm 实际 `onTrim(amount)`。
7. `a163d68`：手机历史阅读临近 trim 时把 scrollback 临时扩到 100,000 行，返回实时后恢复默认预算。
8. `cc6a63e`：snapshot replacement 按可见内容锚定，找不到时再按距底部和绝对位置回退。
9. `1a631f9`：PC 普通 resize/reflow 按可见文本锚定历史视口。
10. `46ee2fe`：修复 mobile oxlint 配置，使 lint 重新成为可执行的发布检查。

每次后续修改都应保留必要诊断事件，但诊断不得记录终端正文、输入、剪贴板、token 或完整敏感 URL。

## 12. 关键代码索引

- PC 原始历史、seq、容量和退出清理：`src/main/services/ProcessManager.ts`
- PC terminal 回放、live 合并、resize、focus 和 viewport：`src/renderer/components/TerminalPane.tsx`
- PC Codex `CSI S` 与阅读 headroom：`src/renderer/utils/terminalScrollbackPreservation.ts`
- 远程历史分页与订阅快照：`src/main/remote/RemoteTerminalController.ts`
- 手机 route/runtime 状态机：`mobile/app/h/[hostId]/t/[windowId]/[paneId].tsx`
- 手机 RN 原始历史拼装和 seq 去重：`mobile/src/synapse/remote-terminal-history-state.ts`
- RN -> WebView 消息队列：`mobile/src/terminal/TerminalWebView.tsx`、`mobile/src/terminal/terminal-webview-pending-messages.ts`
- WebView 手势、选择、copy 和 viewport：`mobile/src/terminal/terminal-webview-html.ts`
- 手机 source/projection、reflow、snapshot 和 cursor：`mobile/src/terminal/terminal-webview-mobile-reflow-injected.ts`
- 手机 Codex `CSI S` 保存：`mobile/src/terminal/terminal-webview-scrollback-preservation-injected.ts`
