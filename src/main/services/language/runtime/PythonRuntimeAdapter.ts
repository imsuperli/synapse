import type { PluginRuntime } from '../../../../shared/types/plugin';
import type { LanguageRuntimeAdapter, RuntimeSpawnContext, SpawnedRuntimeProcess } from './shared';
import {
  buildRuntimeEnvironment,
  findExecutableOnPath,
  resolvePluginPath,
  resolveRuntimeArgs,
  resolveRuntimeCwd,
  spawnRuntimeProcess,
} from './shared';

export class PythonRuntimeAdapter implements LanguageRuntimeAdapter {
  supports(runtime: PluginRuntime): boolean {
    return runtime.type === 'python';
  }

  async spawn(runtime: PluginRuntime, context: RuntimeSpawnContext): Promise<SpawnedRuntimeProcess> {
    const env = await buildRuntimeEnvironment(runtime, context);
    const command = resolvePythonExecutable(context.settings, env);
    const args = [
      resolvePluginPath(runtime.entry, context.pluginInstallPath),
      ...resolveRuntimeArgs(runtime, context),
    ];

    return spawnRuntimeProcess(command, args, {
      cwd: resolveRuntimeCwd(runtime, context),
      env,
    });
  }
}

function resolvePythonExecutable(settings: Record<string, unknown>, env: NodeJS.ProcessEnv): string {
  const configuredInterpreter = typeof settings['python.path'] === 'string'
    ? settings['python.path']
    : typeof settings.pythonPath === 'string'
      ? settings.pythonPath
      : null;

  if (configuredInterpreter) {
    return configuredInterpreter;
  }

  return findExecutableOnPath(process.platform === 'win32' ? 'python' : 'python3', env)
    ?? findExecutableOnPath('python', env)
    ?? (process.platform === 'win32' ? 'python' : 'python3');
}
