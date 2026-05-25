import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerSSHSessionHandlers } from '../sshSessionHandlers';
import type { HandlerContext } from '../HandlerContext';
import { SSH_AUTH_FAILED_ERROR_CODE } from '../../../shared/types/electron-api';
import { WindowStatus } from '../../../shared/types/window';

const { mockIpcHandle, mockShowOpenDialog, mockShowSaveDialog } = vi.hoisted(() => ({
  mockIpcHandle: vi.fn(),
  mockShowOpenDialog: vi.fn(),
  mockShowSaveDialog: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: mockIpcHandle,
  },
  dialog: {
    showOpenDialog: mockShowOpenDialog,
    showSaveDialog: mockShowSaveDialog,
  },
}));

function getRegisteredHandler(channel: string) {
  const call = mockIpcHandle.mock.calls.find(([name]) => name === channel);
  expect(call, `IPC handler ${channel} should be registered`).toBeTruthy();
  return call?.[1] as (event: unknown, payload: unknown) => Promise<unknown>;
}

function createProfile() {
  return {
    id: 'profile-1',
    name: 'prod-web-01',
    host: '10.0.0.21',
    port: 22,
    user: 'root',
    auth: 'password' as const,
    privateKeys: [],
    keepaliveInterval: 30,
    keepaliveCountMax: 3,
    readyTimeout: null,
    verifyHostKeys: true,
    x11: false,
    skipBanner: false,
    agentForward: false,
    warnOnClose: true,
    reuseSession: true,
    forwardedPorts: [],
    tags: ['prod'],
    createdAt: '2026-03-22T10:00:00.000Z',
    updatedAt: '2026-03-22T10:00:00.000Z',
  };
}

describe('registerSSHSessionHandlers', () => {
  beforeEach(() => {
    mockIpcHandle.mockReset();
    mockShowOpenDialog.mockReset();
    mockShowSaveDialog.mockReset();
  });

  it('creates SSH windows and wires pane output subscriptions', async () => {
    const unsubscribe = vi.fn();
    const processManager = {
      spawnTerminal: vi.fn().mockResolvedValue({ pid: 2201, sessionId: 'ssh-session-1' }),
      subscribePtyData: vi.fn().mockReturnValue(unsubscribe),
      getLatestPaneOutputSeq: vi.fn().mockReturnValue(0),
    };
    const sshProfileStore = {
      get: vi.fn().mockResolvedValue(createProfile()),
    };
    const sshVaultService = {
      get: vi.fn().mockResolvedValue({ profileId: 'profile-1', password: 'secret', updatedAt: '2026-03-22T10:00:00.000Z' }),
    };
    const statusPoller = {
      addPane: vi.fn(),
    };
    const ptySubscriptionManager = {
      add: vi.fn(),
    };
    const mainWindow = {
      isDestroyed: vi.fn().mockReturnValue(false),
      webContents: {
        send: vi.fn(),
      },
    };

    registerSSHSessionHandlers({
      mainWindow: mainWindow as any,
      processManager: processManager as any,
      statusPoller: statusPoller as any,
      viewSwitcher: null,
      workspaceManager: null,
      autoSaveManager: null,
      ptySubscriptionManager: ptySubscriptionManager as any,
      gitBranchWatcher: null,
      currentWorkspace: null,
      getCurrentWorkspace: () => null,
      setCurrentWorkspace: () => undefined,
      sshProfileStore: sshProfileStore as any,
      sshVaultService: sshVaultService as any,
      sshKnownHostsStore: null,
    } as HandlerContext);

    const handler = getRegisteredHandler('create-ssh-window');
    const response = await handler({}, {
      profileId: 'profile-1',
      remoteCwd: '/srv/app',
      command: 'bash',
    });

    expect(processManager.spawnTerminal).toHaveBeenCalledWith(expect.objectContaining({
      backend: 'ssh',
      workingDirectory: '/srv/app',
      command: 'bash',
      ssh: expect.objectContaining({
        profileId: 'profile-1',
        password: 'secret',
        reuseSession: true,
        routingMode: 'direct',
        remoteCwd: '/srv/app',
        command: 'bash',
      }),
    }));
    expect(processManager.subscribePtyData).toHaveBeenCalledWith(2201, expect.any(Function));
    expect(ptySubscriptionManager.add).toHaveBeenCalled();
    expect(statusPoller.addPane).toHaveBeenCalled();
    expect(response).toMatchObject({
      success: true,
      data: {
        kind: 'ssh',
        layout: {
          type: 'pane',
          pane: {
            backend: 'ssh',
            status: WindowStatus.WaitingForInput,
            pid: 2201,
            sessionId: 'ssh-session-1',
          },
        },
      },
    });

    const outputSubscriber = processManager.subscribePtyData.mock.calls[0]?.[1];
    expect(outputSubscriber).toBeTypeOf('function');

    outputSubscriber?.('pwd\r\n/root\r\n', 11);
    await new Promise((resolve) => setImmediate(resolve));

    expect(mainWindow.webContents.send).toHaveBeenCalledWith('pty-data', {
      windowId: expect.any(String),
      paneId: expect.any(String),
      data: 'pwd\r\n/root\r\n',
      seq: 11,
    });
  });

  it('treats a quoted home directory as the SSH default instead of sending a literal cd target', async () => {
    const processManager = {
      spawnTerminal: vi.fn().mockResolvedValue({ pid: 2201, sessionId: 'ssh-session-1' }),
      subscribePtyData: vi.fn().mockReturnValue(vi.fn()),
      getLatestPaneOutputSeq: vi.fn().mockReturnValue(0),
    };
    const sshProfileStore = {
      get: vi.fn().mockResolvedValue(createProfile()),
    };

    registerSSHSessionHandlers({
      mainWindow: null,
      processManager: processManager as any,
      statusPoller: { addPane: vi.fn() } as any,
      viewSwitcher: null,
      workspaceManager: null,
      autoSaveManager: null,
      ptySubscriptionManager: { add: vi.fn() } as any,
      gitBranchWatcher: null,
      currentWorkspace: null,
      getCurrentWorkspace: () => null,
      setCurrentWorkspace: () => undefined,
      sshProfileStore: sshProfileStore as any,
      sshVaultService: { get: vi.fn().mockResolvedValue(null) } as any,
      sshKnownHostsStore: null,
    } as HandlerContext);

    const handler = getRegisteredHandler('create-ssh-window');
    await handler({}, {
      profileId: 'profile-1',
      remoteCwd: "'~'",
    });

    expect(processManager.spawnTerminal).toHaveBeenCalledWith(expect.objectContaining({
      backend: 'ssh',
      workingDirectory: '~',
      ssh: expect.not.objectContaining({
        remoteCwd: expect.anything(),
      }),
    }));
  });

  it('starts paused SSH panes from profile data', async () => {
    const processManager = {
      spawnTerminal: vi.fn().mockResolvedValue({ pid: 2202, sessionId: 'ssh-session-2' }),
      subscribePtyData: vi.fn().mockReturnValue(vi.fn()),
      getLatestPaneOutputSeq: vi.fn().mockReturnValue(0),
    };
    const sshProfileStore = {
      get: vi.fn().mockResolvedValue(createProfile()),
    };

    registerSSHSessionHandlers({
      mainWindow: null,
      processManager: processManager as any,
      statusPoller: { addPane: vi.fn() } as any,
      viewSwitcher: null,
      workspaceManager: null,
      autoSaveManager: null,
      ptySubscriptionManager: { add: vi.fn() } as any,
      gitBranchWatcher: null,
      currentWorkspace: null,
      getCurrentWorkspace: () => null,
      setCurrentWorkspace: () => undefined,
      sshProfileStore: sshProfileStore as any,
      sshVaultService: { get: vi.fn().mockResolvedValue(null) } as any,
      sshKnownHostsStore: null,
    } as HandlerContext);

    const handler = getRegisteredHandler('start-ssh-pane');
    const response = await handler({}, {
      windowId: 'win-1',
      paneId: 'pane-1',
      profileId: 'profile-1',
      remoteCwd: '/srv/app',
      command: 'bash',
    });

    expect(response).toEqual({
      success: true,
      data: {
        pid: 2202,
        sessionId: 'ssh-session-2',
        status: WindowStatus.WaitingForInput,
      },
    });
  });

  it('always treats SSH pane remote cwd as fixed configured state', async () => {
    const processManager = {
      spawnTerminal: vi.fn().mockResolvedValue({ pid: 2207, sessionId: 'ssh-session-7' }),
      subscribePtyData: vi.fn().mockReturnValue(vi.fn()),
      getLatestPaneOutputSeq: vi.fn().mockReturnValue(0),
    };
    const sshProfileStore = {
      get: vi.fn().mockResolvedValue({
        ...createProfile(),
        defaultRemoteCwd: '/srv/app',
      }),
    };

    registerSSHSessionHandlers({
      mainWindow: null,
      processManager: processManager as any,
      statusPoller: { addPane: vi.fn() } as any,
      viewSwitcher: null,
      workspaceManager: null,
      autoSaveManager: null,
      ptySubscriptionManager: { add: vi.fn() } as any,
      gitBranchWatcher: null,
      currentWorkspace: null,
      getCurrentWorkspace: () => null,
      setCurrentWorkspace: () => undefined,
      sshProfileStore: sshProfileStore as any,
      sshVaultService: { get: vi.fn().mockResolvedValue(null) } as any,
      sshKnownHostsStore: null,
    } as HandlerContext);

    const handler = getRegisteredHandler('start-ssh-pane');
    await handler({}, {
      windowId: 'win-1',
      paneId: 'pane-1',
      profileId: 'profile-1',
      remoteCwd: '~/de/de/win/de/co/de/co',
    });

    expect(processManager.spawnTerminal).toHaveBeenCalledWith(expect.objectContaining({
      workingDirectory: '~/de/de/win/de/co/de/co',
      ssh: expect.objectContaining({
        remoteCwd: '~/de/de/win/de/co/de/co',
      }),
    }));
  });

  it('returns a coded error response when SSH authentication fails during window creation', async () => {
    const processManager = {
      spawnTerminal: vi.fn().mockRejectedValue(Object.assign(
        new Error('SSH authentication failed. The password or interactive secret was rejected by the server.'),
        { ipcErrorCode: SSH_AUTH_FAILED_ERROR_CODE },
      )),
    };
    const sshProfileStore = {
      get: vi.fn().mockResolvedValue(createProfile()),
    };

    registerSSHSessionHandlers({
      mainWindow: null,
      processManager: processManager as any,
      statusPoller: { addPane: vi.fn() } as any,
      viewSwitcher: null,
      workspaceManager: null,
      autoSaveManager: null,
      ptySubscriptionManager: { add: vi.fn() } as any,
      gitBranchWatcher: null,
      currentWorkspace: null,
      getCurrentWorkspace: () => null,
      setCurrentWorkspace: () => undefined,
      sshProfileStore: sshProfileStore as any,
      sshVaultService: {
        get: vi.fn().mockResolvedValue({
          profileId: 'profile-1',
          password: 'secret',
          updatedAt: '2026-03-22T10:00:00.000Z',
        }),
      } as any,
      sshKnownHostsStore: null,
    } as HandlerContext);

    const handler = getRegisteredHandler('create-ssh-window');
    const response = await handler({}, {
      profileId: 'profile-1',
    });

    expect(response).toMatchObject({
      success: false,
      errorCode: SSH_AUTH_FAILED_ERROR_CODE,
      error: 'SSH authentication failed. The password or interactive secret was rejected by the server.',
    });
  });

  it('does not synthesize a fake shell command when a profile has no remote command', async () => {
    const processManager = {
      spawnTerminal: vi.fn().mockResolvedValue({ pid: 2206, sessionId: 'ssh-session-6' }),
      subscribePtyData: vi.fn().mockReturnValue(vi.fn()),
      getLatestPaneOutputSeq: vi.fn().mockReturnValue(0),
    };
    const sshProfileStore = {
      get: vi.fn().mockResolvedValue(createProfile()),
    };

    registerSSHSessionHandlers({
      mainWindow: null,
      processManager: processManager as any,
      statusPoller: { addPane: vi.fn() } as any,
      viewSwitcher: null,
      workspaceManager: null,
      autoSaveManager: null,
      ptySubscriptionManager: { add: vi.fn() } as any,
      gitBranchWatcher: null,
      currentWorkspace: null,
      getCurrentWorkspace: () => null,
      setCurrentWorkspace: () => undefined,
      sshProfileStore: sshProfileStore as any,
      sshVaultService: { get: vi.fn().mockResolvedValue(null) } as any,
      sshKnownHostsStore: null,
    } as HandlerContext);

    const handler = getRegisteredHandler('create-ssh-window');
    const response = await handler({}, {
      profileId: 'profile-1',
    });

    expect(processManager.spawnTerminal).toHaveBeenCalledWith(expect.not.objectContaining({
      command: 'shell',
    }));
    expect(response).toMatchObject({
      success: true,
      data: {
        layout: {
          type: 'pane',
          pane: {
            command: '',
          },
        },
      },
    });
  });

  it('passes x11 forwarding preferences into the spawned SSH session config', async () => {
    const processManager = {
      spawnTerminal: vi.fn().mockResolvedValue({ pid: 2205, sessionId: 'ssh-session-5' }),
      subscribePtyData: vi.fn().mockReturnValue(vi.fn()),
      getLatestPaneOutputSeq: vi.fn().mockReturnValue(0),
    };
    const sshProfileStore = {
      get: vi.fn().mockResolvedValue({
        ...createProfile(),
        x11: true,
      }),
    };

    registerSSHSessionHandlers({
      mainWindow: null,
      processManager: processManager as any,
      statusPoller: { addPane: vi.fn() } as any,
      viewSwitcher: null,
      workspaceManager: null,
      autoSaveManager: null,
      ptySubscriptionManager: { add: vi.fn() } as any,
      gitBranchWatcher: null,
      currentWorkspace: null,
      getCurrentWorkspace: () => null,
      setCurrentWorkspace: () => undefined,
      sshProfileStore: sshProfileStore as any,
      sshVaultService: { get: vi.fn().mockResolvedValue(null) } as any,
      sshKnownHostsStore: null,
    } as HandlerContext);

    const handler = getRegisteredHandler('start-ssh-pane');
    await handler({}, {
      windowId: 'win-1',
      paneId: 'pane-1',
      profileId: 'profile-1',
    });

    expect(processManager.spawnTerminal).toHaveBeenCalledWith(expect.objectContaining({
      ssh: expect.objectContaining({
        x11: true,
      }),
    }));
  });

  it('resolves jump host profiles into nested SSH session config', async () => {
    const processManager = {
      spawnTerminal: vi.fn().mockResolvedValue({ pid: 2204, sessionId: 'ssh-session-4' }),
      subscribePtyData: vi.fn().mockReturnValue(vi.fn()),
      getLatestPaneOutputSeq: vi.fn().mockReturnValue(0),
    };
    const sshProfileStore = {
      get: vi.fn().mockImplementation(async (profileId: string) => {
        if (profileId === 'jump-1') {
          return {
            ...createProfile(),
            id: 'jump-1',
            name: 'bastion',
            host: '10.0.0.10',
          };
        }

        return {
          ...createProfile(),
          routingMode: 'jumpHost',
          jumpHostProfileId: 'jump-1',
        };
      }),
    };
    const sshVaultService = {
      get: vi.fn().mockImplementation(async (profileId: string) => {
        if (profileId === 'jump-1') {
          return { profileId, password: 'jump-secret', updatedAt: '2026-03-22T10:00:00.000Z' };
        }

        return { profileId, password: 'target-secret', updatedAt: '2026-03-22T10:00:00.000Z' };
      }),
    };

    registerSSHSessionHandlers({
      mainWindow: null,
      processManager: processManager as any,
      statusPoller: { addPane: vi.fn() } as any,
      viewSwitcher: null,
      workspaceManager: null,
      autoSaveManager: null,
      ptySubscriptionManager: { add: vi.fn() } as any,
      gitBranchWatcher: null,
      currentWorkspace: null,
      getCurrentWorkspace: () => null,
      setCurrentWorkspace: () => undefined,
      sshProfileStore: sshProfileStore as any,
      sshVaultService: sshVaultService as any,
      sshKnownHostsStore: null,
    } as HandlerContext);

    const handler = getRegisteredHandler('create-ssh-window');
    await handler({}, {
      profileId: 'profile-1',
    });

    expect(processManager.spawnTerminal).toHaveBeenCalledWith(expect.objectContaining({
      ssh: expect.objectContaining({
        profileId: 'profile-1',
        routingMode: 'jumpHost',
        jumpHostProfileId: 'jump-1',
        jumpHost: expect.objectContaining({
          profileId: 'jump-1',
          host: '10.0.0.10',
          password: 'jump-secret',
        }),
      }),
    }));
  });

  it('treats profiles without routingMode as direct even when old route fields remain', async () => {
    const processManager = {
      spawnTerminal: vi.fn().mockResolvedValue({ pid: 2205, sessionId: 'ssh-session-5' }),
      subscribePtyData: vi.fn().mockReturnValue(vi.fn()),
      getLatestPaneOutputSeq: vi.fn().mockReturnValue(0),
    };
    const sshProfileStore = {
      get: vi.fn().mockResolvedValue({
        ...createProfile(),
        jumpHostProfileId: 'jump-1',
        proxyCommand: 'ssh -W %h:%p bastion',
      }),
    };

    registerSSHSessionHandlers({
      mainWindow: null,
      processManager: processManager as any,
      statusPoller: { addPane: vi.fn() } as any,
      viewSwitcher: null,
      workspaceManager: null,
      autoSaveManager: null,
      ptySubscriptionManager: { add: vi.fn() } as any,
      gitBranchWatcher: null,
      currentWorkspace: null,
      getCurrentWorkspace: () => null,
      setCurrentWorkspace: () => undefined,
      sshProfileStore: sshProfileStore as any,
      sshVaultService: { get: vi.fn().mockResolvedValue(null) } as any,
      sshKnownHostsStore: null,
    } as HandlerContext);

    const handler = getRegisteredHandler('create-ssh-window');
    await handler({}, {
      profileId: 'profile-1',
    });

    expect(sshProfileStore.get).toHaveBeenCalledTimes(1);
    expect(processManager.spawnTerminal).toHaveBeenCalledWith(expect.objectContaining({
      ssh: expect.objectContaining({
        profileId: 'profile-1',
        routingMode: 'direct',
      }),
    }));
    expect(processManager.spawnTerminal).toHaveBeenCalledWith(expect.objectContaining({
      ssh: expect.not.objectContaining({
        jumpHostProfileId: expect.anything(),
        jumpHost: expect.anything(),
        proxyCommand: expect.anything(),
      }),
    }));
  });

  it('returns an error instead of falling back to direct when the active route is incomplete', async () => {
    const processManager = {
      spawnTerminal: vi.fn().mockResolvedValue({ pid: 2206, sessionId: 'ssh-session-6' }),
      subscribePtyData: vi.fn().mockReturnValue(vi.fn()),
      getLatestPaneOutputSeq: vi.fn().mockReturnValue(0),
    };
    const sshProfileStore = {
      get: vi.fn().mockResolvedValue({
        ...createProfile(),
        routingMode: 'proxyCommand',
      }),
    };

    registerSSHSessionHandlers({
      mainWindow: null,
      processManager: processManager as any,
      statusPoller: { addPane: vi.fn() } as any,
      viewSwitcher: null,
      workspaceManager: null,
      autoSaveManager: null,
      ptySubscriptionManager: { add: vi.fn() } as any,
      gitBranchWatcher: null,
      currentWorkspace: null,
      getCurrentWorkspace: () => null,
      setCurrentWorkspace: () => undefined,
      sshProfileStore: sshProfileStore as any,
      sshVaultService: { get: vi.fn().mockResolvedValue(null) } as any,
      sshKnownHostsStore: null,
    } as HandlerContext);

    const handler = getRegisteredHandler('create-ssh-window');
    const response = await handler({}, {
      profileId: 'profile-1',
    });

    expect(response).toMatchObject({
      success: false,
      error: 'SSH ProxyCommand routing requires a proxy command for profile-1',
    });
    expect(processManager.spawnTerminal).not.toHaveBeenCalled();
  });

  it('clones SSH panes from the current workspace layout', async () => {
    const processManager = {
      spawnTerminal: vi.fn().mockResolvedValue({ pid: 2203, sessionId: 'ssh-session-3' }),
      subscribePtyData: vi.fn().mockReturnValue(vi.fn()),
      getLatestPaneOutputSeq: vi.fn().mockReturnValue(0),
    };
    const sshProfileStore = {
      get: vi.fn().mockResolvedValue(createProfile()),
    };
    const workspace = {
      windows: [
        {
          id: 'win-source',
          name: 'prod-web-01',
          activePaneId: 'pane-source',
          createdAt: '2026-03-22T10:00:00.000Z',
          lastActiveAt: '2026-03-22T10:00:00.000Z',
          layout: {
            type: 'pane',
            id: 'pane-source',
            pane: {
              id: 'pane-source',
              cwd: '/srv/app',
              command: 'bash',
              status: WindowStatus.WaitingForInput,
              pid: 2201,
              backend: 'ssh',
              ssh: {
                profileId: 'profile-1',
                host: '10.0.0.21',
                port: 22,
                user: 'root',
                authType: 'password',
                remoteCwd: '/srv/app',
                reuseSession: true,
              },
            },
          },
        },
      ],
    };

    registerSSHSessionHandlers({
      mainWindow: null,
      processManager: processManager as any,
      statusPoller: { addPane: vi.fn() } as any,
      viewSwitcher: null,
      workspaceManager: null,
      autoSaveManager: null,
      ptySubscriptionManager: { add: vi.fn() } as any,
      gitBranchWatcher: null,
      currentWorkspace: workspace as any,
      getCurrentWorkspace: () => workspace as any,
      setCurrentWorkspace: () => undefined,
      sshProfileStore: sshProfileStore as any,
      sshVaultService: { get: vi.fn().mockResolvedValue(null) } as any,
      sshKnownHostsStore: null,
    } as HandlerContext);

    const handler = getRegisteredHandler('clone-ssh-pane');
    const response = await handler({}, {
      sourceWindowId: 'win-source',
      sourcePaneId: 'pane-source',
      targetWindowId: 'win-target',
      targetPaneId: 'pane-target',
      remoteCwd: '/srv/app/releases',
    });

    expect(processManager.spawnTerminal).toHaveBeenCalledWith(expect.objectContaining({
      backend: 'ssh',
      windowId: 'win-target',
      paneId: 'pane-target',
      workingDirectory: '/srv/app/releases',
    }));
    expect(response).toEqual({
      success: true,
      data: {
        pid: 2203,
        sessionId: 'ssh-session-3',
      },
    });
  });

  it('clones SSH panes from request-carried source state when the source tab is ephemeral', async () => {
    const processManager = {
      spawnTerminal: vi.fn().mockResolvedValue({ pid: 2208, sessionId: 'ssh-session-8' }),
      subscribePtyData: vi.fn().mockReturnValue(vi.fn()),
      getLatestPaneOutputSeq: vi.fn().mockReturnValue(0),
    };
    const sshProfileStore = {
      get: vi.fn().mockResolvedValue(createProfile()),
    };

    registerSSHSessionHandlers({
      mainWindow: null,
      processManager: processManager as any,
      statusPoller: { addPane: vi.fn() } as any,
      viewSwitcher: null,
      workspaceManager: null,
      autoSaveManager: null,
      ptySubscriptionManager: { add: vi.fn() } as any,
      gitBranchWatcher: null,
      currentWorkspace: null,
      getCurrentWorkspace: () => null,
      setCurrentWorkspace: () => undefined,
      sshProfileStore: sshProfileStore as any,
      sshVaultService: { get: vi.fn().mockResolvedValue(null) } as any,
      sshKnownHostsStore: null,
    } as HandlerContext);

    const handler = getRegisteredHandler('clone-ssh-pane');
    const response = await handler({}, {
      sourceWindowId: 'win-ephemeral',
      sourcePaneId: 'pane-ephemeral',
      targetWindowId: 'win-target',
      targetPaneId: 'pane-target',
      remoteCwd: '/srv/app/releases',
      sourceSsh: {
        profileId: 'profile-1',
        remoteCwd: '/srv/app/current',
        command: 'bash',
      },
    });

    expect(processManager.spawnTerminal).toHaveBeenCalledWith(expect.objectContaining({
      backend: 'ssh',
      windowId: 'win-target',
      paneId: 'pane-target',
      workingDirectory: '/srv/app/releases',
      command: 'bash',
      ssh: expect.objectContaining({
        profileId: 'profile-1',
        remoteCwd: '/srv/app/releases',
      }),
    }));
    expect(response).toEqual({
      success: true,
      data: {
        pid: 2208,
        sessionId: 'ssh-session-8',
      },
    });
  });

  it('manages active SSH session port forwards through the process manager', async () => {
    const processManager = {
      listSSHPortForwards: vi.fn().mockReturnValue([
        {
          id: 'forward-1',
          type: 'local',
          host: '127.0.0.1',
          port: 15432,
          targetAddress: '10.0.0.21',
          targetPort: 5432,
          source: 'profile',
        },
      ]),
      addSSHPortForward: vi.fn().mockResolvedValue({
        id: 'forward-2',
        type: 'remote',
        host: '0.0.0.0',
        port: 18080,
        targetAddress: '127.0.0.1',
        targetPort: 8080,
        source: 'session',
      }),
      removeSSHPortForward: vi.fn().mockResolvedValue(undefined),
    };

    registerSSHSessionHandlers({
      mainWindow: null,
      processManager: processManager as any,
      statusPoller: null,
      viewSwitcher: null,
      workspaceManager: null,
      autoSaveManager: null,
      ptySubscriptionManager: null,
      gitBranchWatcher: null,
      currentWorkspace: null,
      getCurrentWorkspace: () => null,
      setCurrentWorkspace: () => undefined,
      sshProfileStore: null,
      sshVaultService: null,
      sshKnownHostsStore: null,
    } as HandlerContext);

    const listHandler = getRegisteredHandler('list-ssh-session-port-forwards');
    await expect(listHandler({}, {
      windowId: 'win-1',
      paneId: 'pane-1',
    })).resolves.toEqual({
      success: true,
      data: [
        {
          id: 'forward-1',
          type: 'local',
          host: '127.0.0.1',
          port: 15432,
          targetAddress: '10.0.0.21',
          targetPort: 5432,
          source: 'profile',
        },
      ],
    });
    expect(processManager.listSSHPortForwards).toHaveBeenCalledWith('win-1', 'pane-1');

    const addHandler = getRegisteredHandler('add-ssh-session-port-forward');
    await expect(addHandler({}, {
      windowId: 'win-1',
      paneId: 'pane-1',
      forward: {
        id: 'forward-2',
        type: 'remote',
        host: '0.0.0.0',
        port: 18080,
        targetAddress: '127.0.0.1',
        targetPort: 8080,
      },
    })).resolves.toEqual({
      success: true,
      data: {
        id: 'forward-2',
        type: 'remote',
        host: '0.0.0.0',
        port: 18080,
        targetAddress: '127.0.0.1',
        targetPort: 8080,
        source: 'session',
      },
    });
    expect(processManager.addSSHPortForward).toHaveBeenCalledWith('win-1', 'pane-1', {
      id: 'forward-2',
      type: 'remote',
      host: '0.0.0.0',
      port: 18080,
      targetAddress: '127.0.0.1',
      targetPort: 8080,
    });

    const removeHandler = getRegisteredHandler('remove-ssh-session-port-forward');
    await expect(removeHandler({}, {
      windowId: 'win-1',
      paneId: 'pane-1',
      forwardId: 'forward-2',
    })).resolves.toEqual({
      success: true,
    });
    expect(processManager.removeSSHPortForward).toHaveBeenCalledWith('win-1', 'pane-1', 'forward-2');
  });

  it('lists and transfers files through the active SSH SFTP session', async () => {
    const processManager = {
      listSSHSftpDirectory: vi.fn().mockResolvedValue({
        path: '/srv/app',
        entries: [
          {
            name: 'release.tar.gz',
            path: '/srv/app/release.tar.gz',
            isDirectory: false,
            isSymbolicLink: false,
            size: 4096,
            modifiedAt: '2026-03-22T10:00:00.000Z',
          },
        ],
      }),
      downloadSSHSftpFile: vi.fn().mockResolvedValue(undefined),
      uploadSSHSftpFiles: vi.fn().mockResolvedValue(2),
      uploadSSHSftpDirectory: vi.fn().mockResolvedValue(5),
      downloadSSHSftpDirectory: vi.fn().mockResolvedValue(undefined),
      createSSHSftpDirectory: vi.fn().mockResolvedValue('/srv/app/releases'),
      deleteSSHSftpEntry: vi.fn().mockResolvedValue(undefined),
    };

    mockShowSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: '/tmp/release.tar.gz',
    });
    mockShowOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['/tmp/a.txt', '/tmp/b.txt'],
    });

    registerSSHSessionHandlers({
      mainWindow: {} as any,
      processManager: processManager as any,
      statusPoller: null,
      viewSwitcher: null,
      workspaceManager: null,
      autoSaveManager: null,
      ptySubscriptionManager: null,
      gitBranchWatcher: null,
      currentWorkspace: null,
      getCurrentWorkspace: () => null,
      setCurrentWorkspace: () => undefined,
      sshProfileStore: null,
      sshVaultService: null,
      sshKnownHostsStore: null,
    } as HandlerContext);

    const listHandler = getRegisteredHandler('list-ssh-sftp-directory');
    await expect(listHandler({}, {
      windowId: 'win-1',
      paneId: 'pane-1',
      path: '/srv/app',
    })).resolves.toEqual({
      success: true,
      data: {
        path: '/srv/app',
        entries: [
          {
            name: 'release.tar.gz',
            path: '/srv/app/release.tar.gz',
            isDirectory: false,
            isSymbolicLink: false,
            size: 4096,
            modifiedAt: '2026-03-22T10:00:00.000Z',
          },
        ],
      },
    });
    expect(processManager.listSSHSftpDirectory).toHaveBeenCalledWith('win-1', 'pane-1', '/srv/app');

    const downloadHandler = getRegisteredHandler('download-ssh-sftp-file');
    await expect(downloadHandler({}, {
      windowId: 'win-1',
      paneId: 'pane-1',
      remotePath: '/srv/app/release.tar.gz',
      suggestedName: 'release.tar.gz',
    })).resolves.toEqual({
      success: true,
      data: '/tmp/release.tar.gz',
    });
    expect(processManager.downloadSSHSftpFile).toHaveBeenCalledWith(
      'win-1',
      'pane-1',
      '/srv/app/release.tar.gz',
      '/tmp/release.tar.gz',
    );

    const uploadHandler = getRegisteredHandler('upload-ssh-sftp-files');
    await expect(uploadHandler({}, {
      windowId: 'win-1',
      paneId: 'pane-1',
      remotePath: '/srv/app',
    })).resolves.toEqual({
      success: true,
      data: {
        uploadedCount: 2,
      },
    });
    expect(processManager.uploadSSHSftpFiles).toHaveBeenCalledWith(
      'win-1',
      'pane-1',
      '/srv/app',
      ['/tmp/a.txt', '/tmp/b.txt'],
    );

    mockShowOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: ['/tmp/upload-dir'],
    });
    const uploadDirectoryHandler = getRegisteredHandler('upload-ssh-sftp-directory');
    await expect(uploadDirectoryHandler({}, {
      windowId: 'win-1',
      paneId: 'pane-1',
      remotePath: '/srv/app',
    })).resolves.toEqual({
      success: true,
      data: {
        uploadedCount: 5,
      },
    });
    expect(processManager.uploadSSHSftpDirectory).toHaveBeenCalledWith(
      'win-1',
      'pane-1',
      '/srv/app',
      '/tmp/upload-dir',
    );

    mockShowOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: ['/tmp/download-root'],
    });
    const downloadDirectoryHandler = getRegisteredHandler('download-ssh-sftp-directory');
    await expect(downloadDirectoryHandler({}, {
      windowId: 'win-1',
      paneId: 'pane-1',
      remotePath: '/srv/app/releases',
      suggestedName: 'releases',
    })).resolves.toEqual({
      success: true,
      data: '/tmp/download-root/releases',
    });
    expect(processManager.downloadSSHSftpDirectory).toHaveBeenCalledWith(
      'win-1',
      'pane-1',
      '/srv/app/releases',
      '/tmp/download-root/releases',
    );

    const createDirectoryHandler = getRegisteredHandler('create-ssh-sftp-directory');
    await expect(createDirectoryHandler({}, {
      windowId: 'win-1',
      paneId: 'pane-1',
      parentPath: '/srv/app',
      name: 'releases',
    })).resolves.toEqual({
      success: true,
      data: '/srv/app/releases',
    });
    expect(processManager.createSSHSftpDirectory).toHaveBeenCalledWith(
      'win-1',
      'pane-1',
      '/srv/app',
      'releases',
    );

    const deleteEntryHandler = getRegisteredHandler('delete-ssh-sftp-entry');
    await expect(deleteEntryHandler({}, {
      windowId: 'win-1',
      paneId: 'pane-1',
      remotePath: '/srv/app/releases',
    })).resolves.toEqual({
      success: true,
    });
    expect(processManager.deleteSSHSftpEntry).toHaveBeenCalledWith(
      'win-1',
      'pane-1',
      '/srv/app/releases',
    );
  });

  it('returns a quiet empty metrics response when the ssh pane is no longer active', async () => {
    const processManager = {
      getSSHSessionMetrics: vi.fn().mockRejectedValue(new Error('Pane not found: win-1/pane-1')),
    };
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    registerSSHSessionHandlers({
      mainWindow: null,
      processManager: processManager as any,
      statusPoller: null,
      viewSwitcher: null,
      workspaceManager: null,
      autoSaveManager: null,
      ptySubscriptionManager: null,
      gitBranchWatcher: null,
      currentWorkspace: null,
      getCurrentWorkspace: () => null,
      setCurrentWorkspace: () => undefined,
      sshProfileStore: null,
      sshVaultService: null,
      sshKnownHostsStore: null,
    } as HandlerContext);

    const handler = getRegisteredHandler('get-ssh-session-metrics');
    await expect(handler({}, {
      windowId: 'win-1',
      paneId: 'pane-1',
      path: '/srv/app',
    })).resolves.toEqual({
      success: true,
      data: null,
    });
    expect(processManager.getSSHSessionMetrics).toHaveBeenCalledWith('win-1', 'pane-1', '/srv/app');
    expect(consoleErrorSpy).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });
});
