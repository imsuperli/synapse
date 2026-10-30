import { execFile, execFileSync } from 'child_process';
import { basename } from 'path';
import { platform } from 'os';
import { promisify } from 'util';

const WINDOWS_REQUIRED_RUNTIME_ENV_KEYS = [
  'SystemRoot',
  'SystemDrive',
  'ComSpec',
  'ProgramData',
  'ALLUSERSPROFILE',
  'PUBLIC',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'ProgramW6432',
  'CommonProgramFiles',
  'CommonProgramFiles(x86)',
  'CommonProgramW6432',
  'COMPUTERNAME',
  'SESSIONNAME',
] as const;

const UNIX_RUNTIME_ENV_KEYS_TO_DROP = [
  'OLDPWD',
  'PWD',
  'SHLVL',
  '_',
] as const;

const UNIX_SHELL_FALLBACKS: Record<'darwin' | 'linux', string[]> = {
  darwin: ['/bin/zsh', '/bin/bash', '/bin/sh', '/opt/homebrew/bin/fish', '/usr/local/bin/fish', '/usr/bin/fish'],
  linux: ['/bin/bash', '/usr/bin/zsh', '/bin/sh', '/usr/bin/fish', '/usr/local/bin/fish'],
};

interface GetLatestEnvironmentVariablesOptions {
  preferredShellProgram?: string | null;
}

const DEFAULT_LESS_FLAGS = 'FRX';

/**
 * 获取最新的系统环境变量
 *
 * Windows: 从注册表读取最新的用户和系统环境变量
 * macOS/Linux: 读取 login shell 环境，并与 process.env 合并
 *
 * @returns 合并后的环境变量对象
 */
export function getLatestEnvironmentVariables(options: GetLatestEnvironmentVariablesOptions = {}): NodeJS.ProcessEnv {
  const currentPlatform = platform();
  if (currentPlatform === 'win32') {
    return applyTerminalEnvironmentDefaults(getWindowsEnvironmentVariables());
  }

  return applyTerminalEnvironmentDefaults(getUnixEnvironmentVariables(currentPlatform, options.preferredShellProgram));
}

// Language-service startup runs in Electron's main process. Shell startup files
// may wait for network access or user input, so never probe them synchronously.
export async function getLatestEnvironmentVariablesAsync(
  options: GetLatestEnvironmentVariablesOptions = {},
): Promise<NodeJS.ProcessEnv> {
  const currentPlatform = platform();
  if (currentPlatform === 'win32') {
    return getLatestEnvironmentVariables(options);
  }

  for (const shellPath of getUnixShellCandidates(currentPlatform, options.preferredShellProgram)) {
    for (const args of getUnixShellProbeArgs(shellPath)) {
      try {
        const probe = promisify(execFile)(shellPath, args, {
          env: process.env,
          timeout: 5000,
          killSignal: 'SIGKILL',
          encoding: 'buffer',
        });
        probe.child.stdin?.end();
        const { stdout } = await probe;
        const shellEnv = parseNullDelimitedEnvironment(stdout);
        if (Object.keys(shellEnv).length === 0) {
          continue;
        }
        const env = { ...process.env, ...shellEnv };
        for (const key of UNIX_RUNTIME_ENV_KEYS_TO_DROP) {
          delete env[key];
        }
        return applyTerminalEnvironmentDefaults(env);
      } catch {
        // Preserve the existing shell/mode fallback order without blocking IPC.
      }
    }
  }

  return applyTerminalEnvironmentDefaults(process.env);
}

export function applyTerminalEnvironmentDefaults(input: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...input };
  const shouldNormalizeLess = env.GIT_PAGER
    ? isLessLikePager(env.GIT_PAGER)
    : isLessLikePager(env.PAGER);

  if (shouldNormalizeLess && !env.LESS) {
    env.LESS = DEFAULT_LESS_FLAGS;
  } else if (env.LESS && shouldNormalizeLess) {
    env.LESS = appendLessFlags(env.LESS, DEFAULT_LESS_FLAGS);
  }

  return env;
}

function isLessLikePager(pager?: string | null): boolean {
  const normalizedPager = pager?.trim().toLowerCase();
  if (!normalizedPager) {
    return false;
  }

  return normalizedPager === 'less'
    || normalizedPager.startsWith('less ')
    || normalizedPager.endsWith('/less')
    || normalizedPager.endsWith('\\less.exe');
}

function appendLessFlags(value: string, flags: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return flags;
  }

  const existingFlags = new Set(trimmed.replace(/^[+-]/, '').replace(/[^A-Za-z]/g, '').split(''));
  const missingFlags = flags.split('').filter((flag) => !existingFlags.has(flag));
  if (missingFlags.length === 0) {
    return trimmed;
  }

  return `${trimmed}${missingFlags.join('')}`;
}

/**
 * Windows: 纯粹从注册表构建环境变量，不以 process.env 为基础
 *
 * 策略：
 * 1. 从注册表读取系统变量、用户变量、易失性变量（Volatile Environment）
 * 2. 按优先级合并：系统变量 < 用户变量 < 易失性变量
 * 3. 从 process.env 白名单回补 Windows 运行时关键变量
 * 4. 特殊处理 PATH：合并系统 PATH 和用户 PATH
 *
 * 不依赖 process.env，确保每个新终端的初始环境变量完全一致，
 * 不受宿主进程运行时注入变量（如 Claude Code 代理设置）的污染。
 * 仅对白名单中的系统运行时变量做回补，避免 PowerShell 等程序在缺少
 * SystemRoot / ProgramFiles / SESSIONNAME 等关键变量时启动失败。
 */
function getWindowsEnvironmentVariables(): NodeJS.ProcessEnv {
  try {
    // 从注册表读取三类变量，不以 process.env 为基础
    // 这样可以确保每个新终端的环境变量完全一致，不受运行时注入变量（如代理）的污染
    const registryEnv = readWindowsRegistryEnvironment();

    // 按优先级逐层展开：系统变量 → 用户变量 → 易失性变量
    // 每层展开时，可以引用之前层级已展开的变量
    // expandEnvironmentVariables 内部会回退到 process.env 处理 %COMPUTERNAME% 等
    // 不在注册表环境变量中的系统内置变量，但这些变量不会被加入最终环境
    const systemEnv = materializeRegistryEnvironment(registryEnv.system ?? {}, {});
    const userEnv = materializeRegistryEnvironment(registryEnv.user ?? {}, systemEnv);
    const volatileEnv = materializeRegistryEnvironment(registryEnv.volatile ?? {}, {
      ...systemEnv,
      ...userEnv,
    });

    // 合并：系统变量 < 用户变量 < 易失性变量（后者优先级更高）
    const env: NodeJS.ProcessEnv = {
      ...systemEnv,
      ...userEnv,
      ...volatileEnv,
    };

    mergeRequiredWindowsRuntimeVariables(env, process.env);

    // 特殊处理 PATH：合并系统 PATH + 用户 PATH（易失性变量通常不含 PATH）
    const systemPath = systemEnv.Path || systemEnv.PATH || '';
    const userPath = userEnv.Path || userEnv.PATH || '';

    if (systemPath || userPath) {
      const registryPath = [systemPath, userPath].filter(Boolean).join(';');
      env.PATH = registryPath;
      env.Path = registryPath;
    }

    return env;
  } catch (error) {
    console.error('[Environment] Failed to read registry environment variables:', error);
    // 出错时回退到 process.env
    return process.env;
  }
}

function getUnixEnvironmentVariables(
  currentPlatform: string,
  preferredShellProgram?: string | null,
): NodeJS.ProcessEnv {
  const shellCandidates = getUnixShellCandidates(currentPlatform, preferredShellProgram);
  for (const shellPath of shellCandidates) {
    try {
      const shellEnv = readUnixShellEnvironment(shellPath);
      if (Object.keys(shellEnv).length === 0) {
        continue;
      }

      const env: NodeJS.ProcessEnv = {
        ...process.env,
        ...shellEnv,
      };

      for (const key of UNIX_RUNTIME_ENV_KEYS_TO_DROP) {
        delete env[key];
      }

      return env;
    } catch (error) {
      console.error(`[Environment] Failed to read login shell environment from ${shellPath}:`, error);
    }
  }

  return process.env;
}

function getUnixShellCandidates(
  currentPlatform: string,
  preferredShellProgram?: string | null,
): string[] {
  const baseCandidates = currentPlatform === 'darwin'
    ? UNIX_SHELL_FALLBACKS.darwin
    : currentPlatform === 'linux'
      ? UNIX_SHELL_FALLBACKS.linux
      : ['/bin/sh'];

  return Array.from(new Set([
    preferredShellProgram?.trim(),
    process.env.SHELL?.trim(),
    ...baseCandidates,
  ].filter((candidate): candidate is string => Boolean(candidate))));
}

function readUnixShellEnvironment(shellPath: string): NodeJS.ProcessEnv {
  for (const args of getUnixShellProbeArgs(shellPath)) {
    try {
      const output = execFileSync(
        shellPath,
        args,
        {
          env: process.env,
          timeout: 5000,
          stdio: ['ignore', 'pipe', 'ignore'],
        },
      );

      const parsed = parseNullDelimitedEnvironment(output);
      if (Object.keys(parsed).length > 0) {
        return parsed;
      }
    } catch {
      // Ignore probe failures and continue to the next shell invocation mode.
    }
  }

  throw new Error('Unable to probe shell environment');
}

function getUnixShellProbeArgs(shellPath: string): string[][] {
  const shellName = basename(shellPath).toLowerCase();
  const probeCommand = 'env -0';

  if (shellName === 'fish') {
    return [
      ['-i', '-l', '-c', probeCommand],
      ['-l', '-c', probeCommand],
      ['-c', probeCommand],
    ];
  }

  if (shellName === 'zsh' || shellName === 'bash') {
    return [
      ['-i', '-l', '-c', probeCommand],
      ['-l', '-c', probeCommand],
      ['-c', probeCommand],
    ];
  }

  return [
    ['-l', '-c', probeCommand],
    ['-c', probeCommand],
  ];
}

function parseNullDelimitedEnvironment(output: Buffer | string): NodeJS.ProcessEnv {
  const text = Buffer.isBuffer(output) ? output.toString('utf8') : output;
  const env: NodeJS.ProcessEnv = {};

  for (const entry of text.split('\0')) {
    if (!entry) {
      continue;
    }

    const separatorIndex = entry.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = entry.slice(0, separatorIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue;
    }

    env[key] = entry.slice(separatorIndex + 1);
  }

  return env;
}

interface RegistryValueRecord {
  type?: string;
  value?: string;
}

interface RegistryEnvironmentPayload {
  system?: Record<string, RegistryValueRecord>;
  user?: Record<string, RegistryValueRecord>;
  volatile?: Record<string, RegistryValueRecord>;
}

/**
 * 从 Windows 注册表读取环境变量
 *
 * 通过 powershell.exe + .NET Registry API 读取，避免 reg.exe 输出依赖当前代码页。
 */
function readWindowsRegistryEnvironment(): RegistryEnvironmentPayload {
  const command = [
    '$utf8NoBom = New-Object System.Text.UTF8Encoding($false)',
    '$OutputEncoding = [Console]::OutputEncoding = $utf8NoBom',
    'function Get-RegistryEnv([Microsoft.Win32.RegistryHive]$Hive, [string]$SubKey) {',
    '  $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey($Hive, [Microsoft.Win32.RegistryView]::Default)',
    '  $key = $base.OpenSubKey($SubKey)',
    '  $result = @{}',
    '  if ($null -eq $key) {',
    '    $base.Close()',
    '    return $result',
    '  }',
    '  foreach ($name in $key.GetValueNames()) {',
    '    $value = $key.GetValue($name, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)',
    '    if ($null -eq $value) { continue }',
    '    $result[$name] = @{ type = $key.GetValueKind($name).ToString(); value = [string]$value }',
    '  }',
    '  $key.Close()',
    '  $base.Close()',
    '  return $result',
    '}',
    "$payload = @{ system = Get-RegistryEnv ([Microsoft.Win32.RegistryHive]::LocalMachine) 'SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'; user = Get-RegistryEnv ([Microsoft.Win32.RegistryHive]::CurrentUser) 'Environment'; volatile = Get-RegistryEnv ([Microsoft.Win32.RegistryHive]::CurrentUser) 'Volatile Environment' }",
    '$payload | ConvertTo-Json -Compress -Depth 4',
  ].join('; ');

  const output = execFileSync(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    },
  );

  return JSON.parse(output) as RegistryEnvironmentPayload;
}

function mergeRequiredWindowsRuntimeVariables(
  targetEnv: NodeJS.ProcessEnv,
  sourceEnv: NodeJS.ProcessEnv,
): void {
  for (const key of WINDOWS_REQUIRED_RUNTIME_ENV_KEYS) {
    const value = sourceEnv[key];
    if (!targetEnv[key] && value) {
      targetEnv[key] = value;
    }
  }
}

function materializeRegistryEnvironment(
  registryEnv: Record<string, RegistryValueRecord>,
  baseEnv: NodeJS.ProcessEnv,
): Record<string, string> {
  const env: Record<string, string> = {};

  for (const [name, record] of Object.entries(registryEnv)) {
    if (!record || typeof record.value !== 'string') {
      continue;
    }

    if (record.type === 'ExpandString') {
      env[name] = expandEnvironmentVariables(record.value, { ...baseEnv, ...env });
    } else {
      env[name] = record.value;
    }
  }

  return env;
}

/**
 * 展开环境变量引用（如 %USERPROFILE%\AppData）
 *
 * @param value 包含 %变量% 的字符串
 * @param env 当前环境变量上下文
 * @returns 展开后的字符串
 */
function expandEnvironmentVariables(value: string, env: Record<string, string | undefined>): string {
  return value.replace(/%([^%]+)%/g, (match, varName) => {
    // 优先使用当前上下文中的变量
    if (env[varName]) {
      return env[varName];
    }
    // 回退到 process.env
    if (process.env[varName]) {
      return process.env[varName];
    }
    // 无法展开，保留原样
    return match;
  });
}
