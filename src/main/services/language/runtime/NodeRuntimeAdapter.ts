import type { PluginRuntime } from '../../../../shared/types/plugin';
import type { LanguageRuntimeAdapter, RuntimeSpawnContext, SpawnedRuntimeProcess } from './shared';
import {
  buildRuntimeEnvironment,
  resolveNodeExecutable,
  resolvePluginPath,
  resolveRuntimeArgs,
  resolveRuntimeCwd,
  spawnRuntimeProcess,
} from './shared';

export class NodeRuntimeAdapter implements LanguageRuntimeAdapter {
  supports(runtime: PluginRuntime): boolean {
    return runtime.type === 'node';
  }

  async spawn(runtime: PluginRuntime, context: RuntimeSpawnContext): Promise<SpawnedRuntimeProcess> {
    const env = await buildRuntimeEnvironment(runtime, context, {
      ELECTRON_RUN_AS_NODE: '1',
    });
    const command = await resolveNodeExecutable(env);
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
