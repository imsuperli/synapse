import { ipcMain } from 'electron';
import { HandlerContext } from './HandlerContext';
import { errorResponse, successResponse } from './HandlerResponse';
import { SSHImportResult, SSHProfile, SSHProfileInput, SSHProfilePatch } from '../../shared/types/ssh';
import { getSSHAlgorithmCatalog } from '../services/ssh/SSHAlgorithmCatalog';
import { OpenSSHProfileImporter } from '../services/ssh/OpenSSHProfileImporter';
import { ProcessStatus } from '../types/process';

export function registerSSHProfileHandlers(ctx: HandlerContext) {
  const {
    sshProfileStore,
    sshVaultService,
    sshKnownHostsStore,
  } = ctx;
  const openSSHImporter = new OpenSSHProfileImporter();

  ipcMain.handle('list-ssh-profiles', async () => {
    try {
      if (!sshProfileStore) {
        throw new Error('SSH profile store not initialized');
      }

      return successResponse(await sshProfileStore.list());
    } catch (error) {
      return errorResponse(error);
    }
  });

  ipcMain.handle('get-ssh-profile', async (_event, profileId: string) => {
    try {
      if (!sshProfileStore) {
        throw new Error('SSH profile store not initialized');
      }

      const profile = await sshProfileStore.get(profileId);
      if (!profile) {
        throw new Error(`SSH profile not found: ${profileId}`);
      }

      return successResponse(profile);
    } catch (error) {
      return errorResponse(error);
    }
  });

  ipcMain.handle('get-ssh-algorithm-catalog', async () => {
    try {
      return successResponse(getSSHAlgorithmCatalog());
    } catch (error) {
      return errorResponse(error);
    }
  });

  ipcMain.handle('create-ssh-profile', async (_event, input: SSHProfileInput) => {
    try {
      if (!sshProfileStore) {
        throw new Error('SSH profile store not initialized');
      }

      return successResponse(await sshProfileStore.create(input));
    } catch (error) {
      return errorResponse(error);
    }
  });

  ipcMain.handle('update-ssh-profile', async (_event, profileId: string, patch: SSHProfilePatch) => {
    try {
      if (!sshProfileStore) {
        throw new Error('SSH profile store not initialized');
      }

      return successResponse(await sshProfileStore.update(profileId, patch));
    } catch (error) {
      return errorResponse(error);
    }
  });

  ipcMain.handle('delete-ssh-profile', async (_event, profileId: string) => {
    try {
      if (!sshProfileStore) {
        throw new Error('SSH profile store not initialized');
      }

      const activeSSHProcesses = ctx.processManager?.listProcesses().filter((process) => (
        process.backend === 'ssh'
          && process.profileId === profileId
          && process.status === ProcessStatus.Alive
      )) ?? [];

      if (activeSSHProcesses.length > 0) {
        throw new Error(`SSH profile is still used by active windows: ${profileId}`);
      }

      await sshProfileStore.remove(profileId);
      await sshVaultService?.remove(profileId);

      return successResponse();
    } catch (error) {
      return errorResponse(error);
    }
  });

  ipcMain.handle('import-openssh-profiles', async () => {
    try {
      if (!sshProfileStore) {
        throw new Error('SSH profile store not initialized');
      }

      const importedProfiles = await openSSHImporter.importProfiles();
      const existingProfiles = new Map((await sshProfileStore.list()).map((profile) => [profile.id, profile]));
      const savedProfiles: SSHProfile[] = [];
      let createdCount = 0;
      let updatedCount = 0;

      for (const importedProfile of importedProfiles) {
        const existingProfile = existingProfiles.get(importedProfile.id);
        const mergedProfile = mergeImportedProfile(existingProfile, importedProfile.id, importedProfile.input);
        const savedProfile = await sshProfileStore.upsert(mergedProfile);

        savedProfiles.push(savedProfile);
        if (existingProfile) {
          updatedCount += 1;
        } else {
          createdCount += 1;
        }
      }

      return successResponse<SSHImportResult>({
        profiles: savedProfiles,
        createdCount,
        updatedCount,
        skippedCount: 0,
      });
    } catch (error) {
      return errorResponse(error);
    }
  });

  ipcMain.handle('detect-local-ssh-private-keys', async () => {
    try {
      return successResponse(await openSSHImporter.detectPrivateKeys());
    } catch (error) {
      return errorResponse(error);
    }
  });

  ipcMain.handle('get-ssh-credential-state', async (_event, profileId: string) => {
    try {
      if (!sshVaultService) {
        throw new Error('SSH vault service not initialized');
      }

      return successResponse(await sshVaultService.getCredentialState(profileId));
    } catch (error) {
      return errorResponse(error);
    }
  });

  ipcMain.handle('set-ssh-password', async (_event, profileId: string, password: string) => {
    try {
      if (!sshVaultService) {
        throw new Error('SSH vault service not initialized');
      }

      await sshVaultService.setPassword(profileId, password);
      return successResponse();
    } catch (error) {
      return errorResponse(error);
    }
  });

  ipcMain.handle('clear-ssh-password', async (_event, profileId: string) => {
    try {
      if (!sshVaultService) {
        throw new Error('SSH vault service not initialized');
      }

      await sshVaultService.clearPassword(profileId);
      return successResponse();
    } catch (error) {
      return errorResponse(error);
    }
  });

  ipcMain.handle('set-ssh-private-key-passphrase', async (_event, profileId: string, keyPath: string, passphrase: string) => {
    try {
      if (!sshVaultService) {
        throw new Error('SSH vault service not initialized');
      }

      await sshVaultService.setPrivateKeyPassphrase(profileId, keyPath, passphrase);
      return successResponse();
    } catch (error) {
      return errorResponse(error);
    }
  });

  ipcMain.handle('clear-ssh-private-key-passphrase', async (_event, profileId: string, keyPath: string) => {
    try {
      if (!sshVaultService) {
        throw new Error('SSH vault service not initialized');
      }

      await sshVaultService.clearPrivateKeyPassphrase(profileId, keyPath);
      return successResponse();
    } catch (error) {
      return errorResponse(error);
    }
  });

  ipcMain.handle('clear-ssh-profile-credentials', async (_event, profileId: string) => {
    try {
      if (!sshVaultService) {
        throw new Error('SSH vault service not initialized');
      }

      await sshVaultService.remove(profileId);
      return successResponse();
    } catch (error) {
      return errorResponse(error);
    }
  });

  ipcMain.handle('list-known-hosts', async () => {
    try {
      if (!sshKnownHostsStore) {
        throw new Error('SSH known hosts store not initialized');
      }

      return successResponse(await sshKnownHostsStore.list());
    } catch (error) {
      return errorResponse(error);
    }
  });

  ipcMain.handle('remove-known-host', async (_event, entryId: string) => {
    try {
      if (!sshKnownHostsStore) {
        throw new Error('SSH known hosts store not initialized');
      }

      await sshKnownHostsStore.remove(entryId);
      return successResponse();
    } catch (error) {
      return errorResponse(error);
    }
  });
}

function mergeImportedProfile(
  existingProfile: SSHProfile | undefined,
  importedProfileId: string,
  importedInput: SSHProfileInput,
): SSHProfile {
  const timestamp = new Date().toISOString();

  return {
    id: importedProfileId,
    name: importedInput.name,
    host: importedInput.host,
    port: importedInput.port,
    user: importedInput.user,
    auth: importedInput.auth,
    privateKeys: importedInput.privateKeys,
    keepaliveInterval: importedInput.keepaliveInterval,
    keepaliveCountMax: importedInput.keepaliveCountMax,
    readyTimeout: importedInput.readyTimeout,
    verifyHostKeys: existingProfile?.verifyHostKeys ?? importedInput.verifyHostKeys,
    x11: importedInput.x11,
    skipBanner: existingProfile?.skipBanner ?? importedInput.skipBanner,
    ...(importedInput.routingMode && importedInput.routingMode !== 'direct' ? { routingMode: importedInput.routingMode } : {}),
    ...(importedInput.jumpHostProfileId ? { jumpHostProfileId: importedInput.jumpHostProfileId } : {}),
    agentForward: importedInput.agentForward,
    warnOnClose: existingProfile?.warnOnClose ?? importedInput.warnOnClose,
    ...(importedInput.proxyCommand ? { proxyCommand: importedInput.proxyCommand } : {}),
    ...(importedInput.socksProxyHost ? { socksProxyHost: importedInput.socksProxyHost } : {}),
    ...(importedInput.socksProxyPort !== undefined ? { socksProxyPort: importedInput.socksProxyPort } : {}),
    ...(importedInput.httpProxyHost ? { httpProxyHost: importedInput.httpProxyHost } : {}),
    ...(importedInput.httpProxyPort !== undefined ? { httpProxyPort: importedInput.httpProxyPort } : {}),
    reuseSession: existingProfile?.reuseSession ?? importedInput.reuseSession,
    ...(existingProfile?.algorithms
      ? { algorithms: existingProfile.algorithms }
      : importedInput.algorithms
        ? { algorithms: importedInput.algorithms }
        : {}),
    forwardedPorts: importedInput.forwardedPorts,
    ...(importedInput.remoteCommand ? { remoteCommand: importedInput.remoteCommand } : {}),
    ...(importedInput.defaultRemoteCwd ? { defaultRemoteCwd: importedInput.defaultRemoteCwd } : {}),
    tags: existingProfile?.tags ?? importedInput.tags,
    ...(existingProfile?.notes ? { notes: existingProfile.notes } : importedInput.notes ? { notes: importedInput.notes } : {}),
    ...(existingProfile?.icon ? { icon: existingProfile.icon } : importedInput.icon ? { icon: importedInput.icon } : {}),
    ...(existingProfile?.color ? { color: existingProfile.color } : importedInput.color ? { color: importedInput.color } : {}),
    createdAt: existingProfile?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
}
