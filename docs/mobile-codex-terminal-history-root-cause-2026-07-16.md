# 手机端 Codex 终端历史只剩几行：根因与修复记录

## 问题现象

- PC 端终端中的 Codex 已运行较长时间，PC 端可以看到较多历史内容。
- 手机端连接该终端后只显示几行，向历史方向滑动没有可见反应。
- 关闭并重启手机端后仍然只有几行，但可能变成另外几行。
- 再次重连时可能只看到 Codex 当前的 `Working ...` 状态行。

## 排查结论

历史数据并没有在手机重启时被删除。PC 主进程仍按 PTY 输出块和序号保留原始输出，默认上限为 250,000 个块或 20,000,000 个字符；手机订阅先获取最近 128 KiB，并通过 `terminal.history` 分页获取更早内容。

真正丢失的是“手机 xterm 回放原始 PTY 字节后生成的 scrollback”。Codex 的内联界面会使用以下控制序列扩大或滚动上方历史区域：

1. `DECSTBM` 设置从第 1 行开始的滚动区域。
2. `CSI S`（SU）向上滚动该区域。
3. `DECSTBM` reset 恢复完整滚动区域。

xterm 默认的 `CSI S` handler 会删除滚出局部区域顶部的行，不会把这些行加入 normal buffer 的 scrollback。因此，即使 PC 向手机传输了完整的原始 PTY 历史，手机重新回放时仍会不断覆盖并删除旧行，最终只留下 Codex 当前屏幕附近的几行。此时 xterm 的 `baseY` 接近 0，手机滚动手势也确实没有历史可滚。

PC 端之所以表现正常，是因为 `src/renderer/utils/terminalScrollbackPreservation.ts` 已安装自定义 `CSI S` parser handler：当 normal buffer 的滚动区域从第 1 行开始时，改用 xterm 的 normal-buffer scroll 路径，将离开顶部的行保留进 scrollback。此前这个修复只安装在 PC 端 `TerminalPane`，没有安装到手机 WebView 内的独立 xterm 实例。

## 为什么此前的分页和快照修改没有彻底解决

此前修改主要解决以下传输和恢复问题：

- 首次订阅只发送最近数据，旧数据按页加载。
- 大历史使用二进制帧分块传输。
- 订阅、实时输出和历史页使用序号去重及补洞。
- alternate screen 快照按正确位置插入原始输出。
- 手机端 session 常驻及前后台恢复。

这些修改保证了“原始 PTY 字节能够到达手机”，但没有改变手机 xterm 对 Codex `CSI S` 的处理。传输更多字节只会让同一批控制序列再次删除更多已经回放的行，所以现象仍会复现。

## 修复方式

1. 新增 `mobile/src/terminal/terminal-webview-scrollback-preservation-injected.ts`。
2. 在手机 WebView 每次创建 xterm 后安装与 PC 端等价的 `CSI S` parser handler。
3. 仅在 normal buffer 且滚动区域从第 1 行开始时接管处理；alternate screen 或非顶部滚动区域继续交给 xterm 默认逻辑，避免改变 TUI 自己的屏幕语义。
4. 新增移动端行为回归测试，使用手机实际依赖的 xterm 版本回放 Codex 风格控制序列，并断言被滚走的行仍存在于 normal scrollback。

## 验证标准

- 回放 `DECSTBM + CSI S + DECSTBM reset` 后，被滚出区域的历史行仍存在。
- normal buffer 的 `baseY` 随保留行增长，手机端可以向上滚动。
- alternate screen 中的区域滚动不会污染 normal scrollback。
- 现有手机端终端 WebView、滚动路由、历史状态和类型检查测试通过。

## 数据保留边界

本修复解决的是“数据已传到手机，但回放时被终端控制序列删除”的问题。PC 主进程的 PTY 原始历史仍是内存缓存，并受 250,000 个块或 20,000,000 个字符上限约束；超出上限的最旧数据会被淘汰，PC 应用完全退出后也不会跨进程持久化。这与本次手机重启后只剩几行的复现原因不同。
