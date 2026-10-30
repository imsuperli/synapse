import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from 'child_process';
import { createHash } from 'crypto';
import { accessSync, constants } from 'fs';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import type { PluginRuntime } from '../../../../shared/types/plugin';
import { getLatestEnvironmentVariablesAsync } from '../../../utils/environment';
import { resolveNodePathAsync } from '../../../utils/node-path';
import { prepareSpawnCommand } from '../../../utils/spawnCommand';

export interface RuntimeSpawnContext {
  pluginId: string;
  pluginInstallPath: string;
  projectRoot: string;
  workspaceStoragePath: string;
  settings: Record<string, unknown>;
  runtimeRootPath: string;
}

export interface SpawnedRuntimeProcess {
  child: ChildProcessWithoutNullStreams;
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export interface LanguageRuntimeAdapter {
  supports(runtime: PluginRuntime): boolean;
  spawn(runtime: PluginRuntime, context: RuntimeSpawnContext): Promise<SpawnedRuntimeProcess>;
}

export function createRuntimeHash(value: unknown): string {
  return createHash('sha1').update(JSON.stringify(value)).digest('hex');
}

export async function ensureWorkspaceStoragePath(
  runtimeRootPath: string,
  pluginId: string,
  projectRoot: string,
): Promise<string> {
  const workspaceStoragePath = path.join(
    runtimeRootPath,
    'workspace',
    pluginId,
    createRuntimeHash(projectRoot),
  );
  await fs.ensureDir(workspaceStoragePath);
  return workspaceStoragePath;
}

export async function buildRuntimeEnvironment(
  runtime: PluginRuntime,
  context: RuntimeSpawnContext,
  extraEnv: NodeJS.ProcessEnv = {},
): Promise<NodeJS.ProcessEnv> {
  const baseEnv = await getLatestEnvironmentVariablesAsync();
  const runtimeEnv = Object.fromEntries(
    Object.entries(runtime.env ?? {}).map(([key, value]) => [key, substituteRuntimeVariables(value, context)]),
  );

  return {
    ...baseEnv,
    ...runtimeEnv,
    ...extraEnv,
    COPILOT_TERMINAL_PLUGIN_ID: context.pluginId,
    COPILOT_TERMINAL_PROJECT_ROOT: context.projectRoot,
    COPILOT_TERMINAL_PLUGIN_SETTINGS: JSON.stringify(context.settings ?? {}),
    COPILOT_TERMINAL_WORKSPACE_STORAGE: context.workspaceStoragePath,
  };
}

export function resolveRuntimeCwd(runtime: PluginRuntime, context: RuntimeSpawnContext): string {
  return runtime.cwd
    ? resolvePluginPath(substituteRuntimeVariables(runtime.cwd, context), context.pluginInstallPath)
    : context.projectRoot;
}

export function resolveRuntimeArgs(runtime: PluginRuntime, context: RuntimeSpawnContext): string[] {
  return (runtime.args ?? []).map((arg) => substituteRuntimeVariables(arg, context));
}

export function resolvePluginPath(targetPath: string, pluginInstallPath: string): string {
  return path.isAbsolute(targetPath)
    ? targetPath
    : path.join(pluginInstallPath, targetPath);
}

export function substituteRuntimeVariables(value: string, context: RuntimeSpawnContext): string {
  return value
    .replace(/\$\{workspaceStorage\}/g, context.workspaceStoragePath)
    .replace(/\$\{projectRoot\}/g, context.projectRoot)
    .replace(/\$\{pluginPath\}/g, context.pluginInstallPath);
}

export function getPathEnvironment(env: NodeJS.ProcessEnv): string {
  return env.PATH || env.Path || process.env.PATH || process.env.Path || '';
}

export async function resolveNodeExecutable(env: NodeJS.ProcessEnv): Promise<string> {
  return resolveNodePathAsync({
    currentPath: getPathEnvironment(env),
    env,
  });
}

export function isExecutableFile(filePath: string): boolean {
  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function findExecutableOnPath(command: string, env: NodeJS.ProcessEnv): string | null {
  if (path.isAbsolute(command) || command.includes(path.sep)) {
    return isExecutableFile(command) ? command : null;
  }

  const extensions = process.platform === 'win32'
    ? ['.exe', '.cmd', '.bat', '']
    : [''];

  for (const entry of getPathEnvironment(env).split(path.delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidatePath = path.join(entry, `${command}${extension}`);
      if (isExecutableFile(candidatePath)) {
        return candidatePath;
      }
    }
  }

  return null;
}

export function spawnRuntimeProcess(
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio,
): SpawnedRuntimeProcess {
  const prepared = prepareRuntimeSpawn(command, args, options);
  const child = spawn(prepared.command, prepared.args, {
    ...prepared.options,
    stdio: 'pipe',
  });

  if (!child.stdout || !child.stdin || !child.stderr) {
    throw new Error('Failed to create stdio pipes for language runtime');
  }

  return {
    child: child as ChildProcessWithoutNullStreams,
    command: prepared.command,
    args: prepared.args,
    cwd: prepared.cwd,
    env: prepared.env,
  };
}

export function prepareRuntimeSpawn(
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio,
): {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  options: SpawnOptionsWithoutStdio;
} {
  const cwd = typeof options.cwd === 'string'
    ? options.cwd
    : options.cwd
      ? fileURLToPath(options.cwd)
      : process.cwd();
  const env = options.env ?? process.env;
  const preparedCommand = prepareSpawnCommand(command, args, cwd, env);

  return {
    command: preparedCommand.command,
    args: preparedCommand.args,
    cwd,
    env,
    options: {
      ...options,
      ...preparedCommand.options,
    },
  };
}
