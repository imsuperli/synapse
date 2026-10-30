# macOS 代码面板启动阻塞排查（2026-10-30）

## 结论与证据边界

已定位并复现代码面板语言服务初始化中的主进程同步阻塞缺陷，以及同步调用超时后仍可能永久等待的问题。它可以解释打开即失去响应、重启恢复同一面板后再次触发、Windows 未触发同一路径的现象。

本次执行环境是 Linux，未取得故障 Mac 的进程采样、shell 配置或运行日志。因此，以下是已验证的代码缺陷和针对性修复，不代表已经实机确认该 Mac 的唯一根因。尤其是语言服务插件未启用、未匹配项目时，这条语言服务启动链不会执行。

## 触发链

1. `CodePane.tsx` 初始化时调用 `codePaneWatchRoot`。从持久化状态恢复代码面板也执行这条链。
2. `codePaneHandlers.ts` 的 `code-pane-watch-root` 处理器调用 `LanguageWorkspaceHostService.prewarmProject`。
3. 项目匹配已启用语言插件后，运行时适配器调用 `buildRuntimeEnvironment`。
4. 原实现调用同步的 `getLatestEnvironmentVariables`。macOS 会执行 `execFileSync(shell, ['-i', '-l', '-c', 'env -0'])`，从而运行用户交互式 login shell 的初始化配置。
5. Node 语言服务找不到 PATH、Homebrew 等候选位置中的 Node 时，`resolveNodePath` 还会同步执行 login shell 的 `command -v node`。

这些操作发生在 Electron 主进程。外层函数标记 `async` 或使用 `void promise` 都不会把同步子进程调用移出主线程。

Windows 读取环境变量使用注册表逻辑，不运行上述 Unix login shell 初始化链。因此 Windows 正常不能排除这处缺陷。同步环境读取函数原有注释称 Unix 只使用 `process.env`，与实际实现不符，本次一并更正注释。

## 为什么 5 秒 timeout 仍可能卡住

原 `execFileSync` 使用默认 `SIGTERM`。同步子进程 API 在发出超时信号后仍须等待子进程真正退出；子进程忽略该信号时，调用可以一直不返回。主线程无法执行计时器、IPC，也无法处理正常关闭交互。

即使没有忽略信号，多个 shell 与多个调用模式串行重试也会累积阻塞时间。

## 受控复现

使用临时可执行 shell 替身，通过现有 `preferredShellProgram` 参数进入真实环境探测函数，不依赖用户配置。

| 情况 | 旧实现 | 新实现 |
| --- | --- | --- |
| shell 启动等待约 1 秒 | 20ms 心跳实际在 1057ms 执行 | 心跳在 22ms 执行，环境探测约 1069ms 完成 |
| shell 忽略 SIGTERM 并持续等待 | 5000ms 超时后仍阻塞；7000ms 时无心跳，由外部 watchdog 终止独立进程组 | 心跳在 33ms 执行；使用 SIGKILL 结束超时探测，约 11 秒后经回退完成 |

这些测试验证主进程事件循环阻塞机制，并非 Mac GUI 实机复现。

## 修复范围

- 新增异步环境变量读取入口，仅语言服务运行时改用该入口。
- 新增异步 Node 查找入口，语言服务使用该入口；保留原候选路径和 shell 探测顺序。
- 四种语言运行时适配器等待异步环境结果，随后启动语言服务。
- 新增探测沿用原有单次超时，超时信号改为 SIGKILL，并关闭探测进程的 stdin，避免等待输入。
- 终端创建仍使用原来的同步入口；未修改代码面板状态恢复、文件监听、索引、Monaco 或终端布局。

## 验证

- `npm run build:main` 通过。
- 8 个相关测试文件、26 项测试通过，覆盖 Unix/Windows 原环境行为、真实慢 shell 下的事件循环响应、环境探测回退、真实 Node shell 探测、Homebrew 路径、语言运行时环境、工作区预热与代码面板处理器。
- 仍需故障 Mac 实机验证原终端恢复、打开代码面板和语言服务启动。如果仍卡死，应在卡死期间采集主进程与 renderer 的 sample，以确定是否还有独立触发路径。
