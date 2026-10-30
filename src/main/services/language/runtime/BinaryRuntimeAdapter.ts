import type { PluginRuntime } from '../../../../shared/types/plugin';
import type { LanguageRuntimeAdapter, RuntimeSpawnContext, SpawnedRuntimeProcess } from './shared';
import {
  buildRuntimeEnvironment,
  resolvePluginPath,
  resolveRuntimeArgs,
  resolveRuntimeCwd,
  spawnRuntimeProcess,
} from './shared';

export class BinaryRuntimeAdapter implements LanguageRuntimeAdapter {
  supports(runtime: PluginRuntime): boolean {
    return runtime.type === 'binary';
  }

  async spawn(runtime: PluginRuntime, context: RuntimeSpawnContext): Promise<SpawnedRuntimeProcess> {
    const env = await buildRuntimeEnvironment(runtime, context);
    const command = resolvePluginPath(runtime.entry, context.pluginInstallPath);
    const args = resolveRuntimeArgs(runtime, context);

    return spawnRuntimeProcess(command, args, {
      cwd: resolveRuntimeCwd(runtime, context),
      env,
    });
  }
}
