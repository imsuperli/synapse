import { mkdtemp, writeFile, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('os', async (importOriginal) => ({
  ...await importOriginal<typeof import('os')>(),
  platform: () => 'darwin',
}));

import { getLatestEnvironmentVariablesAsync } from '../environment';
import { resolveNodePathAsync } from '../node-path';

const temporaryDirectories: string[] = [];

async function createShell(script: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'synapse-async-shell-'));
  temporaryDirectories.push(directory);
  const shellPath = path.join(directory, 'shell');
  await writeFile(shellPath, `#!/bin/sh\n${script}\n`, { mode: 0o755 });
  return shellPath;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe.skipIf(process.platform === 'win32')('asynchronous macOS shell environment probing', () => {
  it('keeps the event loop responsive while shell startup is waiting', async () => {
    const shellPath = await createShell(`sleep 0.2
printf 'PATH=/shell-managed/bin:/usr/bin:/bin\\000NVM_BIN=/shell-managed/bin\\000PWD=/tmp\\000SHLVL=2\\000'`);
    let finished = false;
    const pendingEnvironment = getLatestEnvironmentVariablesAsync({ preferredShellProgram: shellPath })
      .then((env) => { finished = true; return env; });

    await new Promise((resolve) => setTimeout(resolve, 20));
    const finishedBeforeHeartbeat = finished;
    const env = await pendingEnvironment;
    expect(finishedBeforeHeartbeat).toBe(false);
    expect(env.PATH).toBe('/shell-managed/bin:/usr/bin:/bin');
    expect(env.NVM_BIN).toBe('/shell-managed/bin');
    expect(env.PWD).toBeUndefined();
    expect(env.SHLVL).toBeUndefined();
  });

  it('keeps the event loop responsive during a real Node shell probe', async () => {
    const shellPath = await createShell("sleep 0.2\nprintf '/shell-managed/node\\n'");
    let finished = false;
    const pendingNode = resolveNodePathAsync({
      currentPath: '',
      platform: 'darwin',
      env: {},
      preferredShell: shellPath,
      isExecutable: (candidate) => candidate === shellPath || candidate === '/shell-managed/node',
    }).then((node) => { finished = true; return node; });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const finishedBeforeHeartbeat = finished;
    expect(await pendingNode).toBe('/shell-managed/node');
    expect(finishedBeforeHeartbeat).toBe(false);
  });

  it('falls back from an interactive shell failure to the login invocation', async () => {
    const shellPath = await createShell(`if [ "$1" = '-i' ]; then exit 1; fi
printf 'PATH=/login/bin\\000'`);
    const env = await getLatestEnvironmentVariablesAsync({ preferredShellProgram: shellPath });
    expect(env.PATH).toBe('/login/bin');
  });
});
