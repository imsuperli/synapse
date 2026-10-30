import { execFile, execFileSync } from 'child_process';
import { accessSync, constants } from 'fs';
import { homedir, platform as getPlatform } from 'os';
import * as path from 'path';
import { promisify } from 'util';

export interface ResolveNodePathOptions {
  currentPath: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  preferredShell?: string | null;
  homeDir?: string;
  isExecutable?: (filePath: string) => boolean;
  probeShell?: (shellPath: string, env: NodeJS.ProcessEnv) => string | null;
}

function isExecutableFile(filePath: string): boolean {
  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function which(cmd: string, pathEnv: string, isExecutable: (filePath: string) => boolean): string | null {
  const dirs = pathEnv.split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const fullPath = path.join(dir, cmd);
    if (isExecutable(fullPath)) {
      return fullPath;
    }
  }
  return null;
}

function uniqNonEmpty(items: Array<string | null | undefined>): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const normalized = item?.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function getKnownNodeCandidates(targetPlatform: NodeJS.Platform, homeDir: string, env: NodeJS.ProcessEnv): string[] {
  const candidates: Array<string | undefined> = [
    env.AUSOME_NODE_PATH,
    env.NVM_BIN ? path.join(env.NVM_BIN, 'node') : undefined,
    path.join(homeDir, '.volta', 'bin', 'node'),
    path.join(homeDir, '.fnm', 'current', 'bin', 'node'),
    path.join(homeDir, '.asdf', 'shims', 'node'),
  ];

  if (targetPlatform === 'darwin') {
    candidates.push('/opt/homebrew/bin/node');
    candidates.push('/usr/local/bin/node');
  }

  return uniqNonEmpty(candidates);
}

function getShellCandidates(targetPlatform: NodeJS.Platform, env: NodeJS.ProcessEnv, preferredShell?: string | null): string[] {
  const candidates: Array<string | null | undefined> = [
    preferredShell,
    env.SHELL,
  ];

  if (targetPlatform === 'darwin') {
    candidates.push('/bin/zsh', '/bin/bash', '/bin/sh', '/opt/homebrew/bin/fish', '/usr/local/bin/fish', '/usr/bin/fish');
  } else if (targetPlatform === 'linux') {
    candidates.push('/bin/bash', '/usr/bin/zsh', '/bin/sh', '/usr/bin/fish', '/usr/local/bin/fish');
  } else {
    candidates.push('/bin/sh');
  }

  return uniqNonEmpty(candidates);
}

function parseShellProbeOutput(output: string, isExecutable: (filePath: string) => boolean): string | null {
  const candidates = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const candidate of candidates) {
    if ((candidate.startsWith('/') || candidate.includes(path.sep)) && isExecutable(candidate)) {
      return candidate;
    }
  }

  return null;
}

function getNodeShellProbeArgs(shellPath: string): string[][] {
  const shellName = path.basename(shellPath).toLowerCase();
  return shellName === 'fish'
      ? [
          ['-i', '-l', '-c', 'command -v node'],
          ['-l', '-c', 'command -v node'],
          ['-c', 'command -v node'],
        ]
      : shellName === 'zsh' || shellName === 'bash'
        ? [
            ['-i', '-l', '-c', 'command -v node'],
            ['-l', '-c', 'command -v node'],
            ['-c', 'command -v node'],
          ]
        : [
            ['-l', '-c', 'command -v node'],
            ['-c', 'command -v node'],
          ];
}

function probeNodeFromShell(shellPath: string, env: NodeJS.ProcessEnv): string | null {
  const argVariants = getNodeShellProbeArgs(shellPath);

  for (const args of argVariants) {
    try {
      const output = execFileSync(shellPath, args, {
        encoding: 'utf8',
        timeout: 3000,
        env,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();

      if (output) {
        return output;
      }
    } catch {
      // Ignore and continue probing other shell variants.
    }
  }

  return null;
}

async function probeNodeFromShellAsync(shellPath: string, env: NodeJS.ProcessEnv): Promise<string | null> {
  for (const args of getNodeShellProbeArgs(shellPath)) {
    try {
      const probe = promisify(execFile)(shellPath, args, {
        encoding: 'utf8',
        timeout: 3000,
        killSignal: 'SIGKILL',
        env,
      });
      probe.child.stdin?.end();
      const { stdout } = await probe;
      if (stdout.trim()) {
        return stdout.trim();
      }
    } catch {
      // Try the next invocation mode without blocking the main process.
    }
  }
  return null;
}

export function resolveNodePath(options: ResolveNodePathOptions): string {
  const env = options.env ?? process.env;
  const targetPlatform = options.platform ?? getPlatform();
  const homeDir = options.homeDir ?? homedir();
  const isExecutable = options.isExecutable ?? isExecutableFile;
  const probeShell = options.probeShell ?? probeNodeFromShell;

  const fromPath = which('node', options.currentPath, isExecutable);
  if (fromPath) {
    return fromPath;
  }

  for (const candidate of getKnownNodeCandidates(targetPlatform, homeDir, env)) {
    if (isExecutable(candidate)) {
      return candidate;
    }
  }

  for (const shellPath of getShellCandidates(targetPlatform, env, options.preferredShell)) {
    if (!isExecutable(shellPath)) {
      continue;
    }

    const probed = probeShell(shellPath, env);
    if (!probed) {
      continue;
    }

    const resolved = parseShellProbeOutput(probed, isExecutable);
    if (resolved) {
      return resolved;
    }
  }

  return 'node';
}

export async function resolveNodePathAsync(
  options: Omit<ResolveNodePathOptions, 'probeShell'> & {
    probeShell?: (shellPath: string, env: NodeJS.ProcessEnv) => Promise<string | null>;
  },
): Promise<string> {
  const env = options.env ?? process.env;
  const targetPlatform = options.platform ?? getPlatform();
  const homeDir = options.homeDir ?? homedir();
  const isExecutable = options.isExecutable ?? isExecutableFile;
  const probeShell = options.probeShell ?? probeNodeFromShellAsync;

  const fromPath = which('node', options.currentPath, isExecutable);
  if (fromPath) {
    return fromPath;
  }

  for (const candidate of getKnownNodeCandidates(targetPlatform, homeDir, env)) {
    if (isExecutable(candidate)) {
      return candidate;
    }
  }

  for (const shellPath of getShellCandidates(targetPlatform, env, options.preferredShell)) {
    if (!isExecutable(shellPath)) {
      continue;
    }

    const probed = await probeShell(shellPath, env);
    if (!probed) {
      continue;
    }

    const resolved = parseShellProbeOutput(probed, isExecutable);
    if (resolved) {
      return resolved;
    }
  }

  return 'node';
}
