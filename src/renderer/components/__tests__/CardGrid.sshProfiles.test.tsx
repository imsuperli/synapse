import type { ComponentProps } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CardGrid } from '../CardGrid';
import { useWindowStore } from '../../stores/windowStore';
import { SSHProfile } from '../../../shared/types/ssh';
import { Window, WindowStatus } from '../../types/window';
import { CanvasWorkspace } from '../../../shared/types/canvas';

function createSSHProfile(overrides: Partial<SSHProfile> = {}): SSHProfile {
  return {
    id: 'ssh-profile-1',
    name: 'Prod Bastion',
    host: '10.0.0.21',
    port: 22,
    user: 'root',
    auth: 'password',
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
    remoteCommand: '',
    defaultRemoteCwd: '/srv/app',
    tags: ['prod'],
    createdAt: '2026-03-22T10:00:00.000Z',
    updatedAt: '2026-03-22T10:00:00.000Z',
    ...overrides,
  };
}

function createStandaloneSSHWindow(profile: SSHProfile, overrides: Partial<Window> = {}): Window {
  return {
    id: 'ssh-window-1',
    name: 'Hidden runtime window',
    kind: 'ssh',
    activePaneId: 'ssh-pane-1',
    createdAt: '2026-03-22T10:05:00.000Z',
    lastActiveAt: '2026-03-22T10:05:00.000Z',
    layout: {
      type: 'pane',
      id: 'layout-ssh-pane-1',
      pane: {
        id: 'ssh-pane-1',
        cwd: '/srv/app',
        command: '/bin/zsh',
        status: WindowStatus.Running,
        pid: 1234,
        backend: 'ssh',
        ssh: {
          profileId: profile.id,
          host: profile.host,
          port: profile.port,
          user: profile.user,
          authType: profile.auth,
          remoteCwd: '/srv/app',
          reuseSession: true,
        },
      },
    },
    ...overrides,
  };
}

function createEphemeralSSHCloneWindow(profile: SSHProfile, overrides: Partial<Window> = {}): Window {
  return createStandaloneSSHWindow(profile, {
    id: 'ssh-window-clone-1',
    name: 'Ephemeral SSH clone',
    ephemeral: true,
    sshTabOwnerWindowId: 'ssh-window-1',
    activePaneId: 'ssh-pane-clone-1',
    lastActiveAt: '2026-03-22T10:06:00.000Z',
    layout: {
      type: 'pane',
      id: 'layout-ssh-pane-clone-1',
      pane: {
        id: 'ssh-pane-clone-1',
        cwd: '/srv/app/clone',
        command: '/bin/zsh',
        status: WindowStatus.Running,
        pid: 2234,
        backend: 'ssh',
        ssh: {
          profileId: profile.id,
          host: profile.host,
          port: profile.port,
          user: profile.user,
          authType: profile.auth,
          remoteCwd: '/srv/app/clone',
          reuseSession: true,
        },
      },
    },
    ...overrides,
  });
}

function renderCardGrid(props: ComponentProps<typeof CardGrid>) {
  return render(
    <DndProvider backend={HTML5Backend}>
      <CardGrid {...props} />
    </DndProvider>,
  );
}

async function openSSHProfileCardMenu(
  user: ReturnType<typeof userEvent.setup>,
  cardName = 'Prod Bastion root@10.0.0.21:22',
) {
  const card = screen.getByRole('button', { name: cardName });
  await user.click(within(card).getByRole('button', { name: '更多' }));
}

function createCanvasWorkspace(overrides: Partial<CanvasWorkspace> = {}): CanvasWorkspace {
  return {
    id: 'canvas-1',
    name: 'Incident Map',
    createdAt: '2026-05-03T00:00:00.000Z',
    updatedAt: '2026-05-03T00:00:00.000Z',
    workingDirectory: '/srv/incidents',
    blocks: [
      {
        id: 'note-1',
        type: 'note',
        x: 20,
        y: 20,
        width: 320,
        height: 180,
        zIndex: 1,
        label: 'Checklist',
        content: 'Investigate disk usage',
      },
    ],
    viewport: { tx: 0, ty: 0, zoom: 1 },
    nextZIndex: 2,
    ...overrides,
  };
}

describe('CardGrid SSH profile cards', () => {
  beforeEach(() => {
    useWindowStore.setState({
      windows: [],
      groups: [],
      canvasWorkspaces: [],
      activeWindowId: null,
      activeGroupId: null,
      mruList: [],
      groupMruList: [],
      sidebarExpanded: false,
      sidebarWidth: 200,
      customCategories: [],
      terminalSidebarFilter: 'all',
    });
    vi.clearAllMocks();
  });

  it('renders SSH profile cards and forwards connect actions', async () => {
    const user = userEvent.setup();
    const onConnectSSHProfile = vi.fn();
    const onDuplicateSSHProfile = vi.fn();
    const profile = createSSHProfile();

    renderCardGrid({
      sshEnabled: true,
      sshProfiles: [profile],
      sshCredentialStates: {
        [profile.id]: {
          hasPassword: true,
          hasPassphrase: false,
        },
      },
      onConnectSSHProfile,
      onDuplicateSSHProfile,
    });

    expect(screen.getByText('Prod Bastion')).toBeInTheDocument();
    expect(screen.getByText(/root@10.0.0.21:22/)).toBeInTheDocument();
    expect(screen.getByLabelText('已保存密码')).toBeInTheDocument();
    expect(screen.queryByText('已保存密码')).not.toBeInTheDocument();
    expect(screen.queryByText('密码')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '启动' }));

    expect(onConnectSSHProfile).toHaveBeenCalledWith(profile);

    await openSSHProfileCardMenu(user);
    await user.click(await screen.findByRole('menuitem', { name: '复制 SSH 配置' }));

    expect(onDuplicateSSHProfile).toHaveBeenCalledWith(profile);
  });

  it('manages canvas workspaces directly from the unified card grid', async () => {
    const user = userEvent.setup();
    useWindowStore.setState({
      canvasWorkspaces: [createCanvasWorkspace()],
    });

    renderCardGrid({ currentTab: 'all' });

    await user.click(screen.getByRole('button', { name: '更多' }));
    await user.click(await screen.findByRole('menuitem', { name: '重命名画布' }));

    const renameInput = screen.getByLabelText('工作区名称');
    await user.clear(renameInput);
    await user.type(renameInput, 'Ops Board');
    await user.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(useWindowStore.getState().canvasWorkspaces[0]?.name).toBe('Ops Board');
    });

    await user.click(screen.getByRole('button', { name: '更多' }));
    await user.click(await screen.findByText('归档画布'));

    await waitFor(() => {
      expect(useWindowStore.getState().canvasWorkspaces[0]?.archived).toBe(true);
    });

    await user.click(screen.getByRole('button', { name: '更多' }));
    await user.click(await screen.findByText('删除画布'));
    await user.click(screen.getByRole('button', { name: '删除' }));

    await waitFor(() => {
      expect(useWindowStore.getState().canvasWorkspaces).toHaveLength(0);
    });
  });

  it('surfaces ssh routing metadata on profile cards', () => {
    const profile = createSSHProfile({
      jumpHostProfileId: 'jump-1',
      socksProxyHost: '127.0.0.1',
      forwardedPorts: [
        {
          id: 'forward-1',
          type: 'local',
          localHost: '127.0.0.1',
          localPort: 15432,
          remoteHost: '10.0.0.22',
          remotePort: 5432,
        },
        {
          id: 'forward-2',
          type: 'remote',
          remoteHost: '0.0.0.0',
          remotePort: 18080,
          localHost: '127.0.0.1',
          localPort: 8080,
        },
      ],
    });

    renderCardGrid({
      sshEnabled: true,
      sshProfiles: [profile],
    });

    expect(screen.getByText('跳板机')).toBeInTheDocument();
    expect(screen.getByText('SOCKS 代理')).toBeInTheDocument();
    expect(screen.getByText('2 个转发')).toBeInTheDocument();
  });

  it('does not render the in-use badge and keeps profile deletion available', async () => {
    const user = userEvent.setup();
    const profile = createSSHProfile();

    renderCardGrid({
      sshEnabled: true,
      sshProfiles: [profile],
    });

    await openSSHProfileCardMenu(user);

    expect(await screen.findByRole('menuitem', { name: '删除 SSH 卡片' })).toBeEnabled();
    expect(screen.queryByText(/已被 .* 个窗口使用/)).not.toBeInTheDocument();
  });

  it('uses the default border color for unbound SSH profile cards', () => {
    const profile = createSSHProfile();

    renderCardGrid({
      sshEnabled: true,
      sshProfiles: [profile],
    });

    expect(screen.getByRole('button', { name: 'Prod Bastion root@10.0.0.21:22' }).getAttribute('style'))
      .toContain('border-top: 1px solid rgb(var(--border))');
  });

  it('binds a standalone SSH runtime window back onto the SSH profile card', async () => {
    const user = userEvent.setup();
    const profile = createSSHProfile();
    const runtimeWindow = createStandaloneSSHWindow(profile);
    const onConnectSSHProfile = vi.fn();
    const onEnterTerminal = vi.fn();

    useWindowStore.setState({
      windows: [runtimeWindow],
    });

    renderCardGrid({
      sshEnabled: true,
      sshProfiles: [profile],
      onConnectSSHProfile,
      onEnterTerminal,
    });

    expect(screen.queryByText('Hidden runtime window')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '停止' })).toBeInTheDocument();
    expect(screen.queryByText('运行中')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Prod Bastion root@10.0.0.21:22' }));

    expect(onConnectSSHProfile).toHaveBeenCalledWith(profile);
    expect(onEnterTerminal).not.toHaveBeenCalled();
  });

  it('renders bound SSH profile cards inside a custom category tab', async () => {
    const user = userEvent.setup();
    const profile = createSSHProfile();
    const runtimeWindow = createStandaloneSSHWindow(profile);
    const onConnectSSHProfile = vi.fn();
    const onEnterTerminal = vi.fn();
    const categoryId = 'category-ssh';

    useWindowStore.setState({
      windows: [runtimeWindow],
      customCategories: [
        {
          id: categoryId,
          name: 'SSH 分类',
          icon: '📁',
          windowIds: [runtimeWindow.id],
          groupIds: [],
          order: 0,
          createdAt: '2026-03-22T10:00:00.000Z',
          updatedAt: '2026-03-22T10:00:00.000Z',
        },
      ],
    });

    renderCardGrid({
      sshEnabled: true,
      sshProfiles: [profile],
      currentTab: categoryId,
      onConnectSSHProfile,
      onEnterTerminal,
    });

    expect(screen.getByText('Prod Bastion')).toBeInTheDocument();
    expect(screen.queryByText('Hidden runtime window')).not.toBeInTheDocument();
    expect(screen.queryByText('此分类暂无终端')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Prod Bastion root@10.0.0.21:22' }));

    expect(onConnectSSHProfile).toHaveBeenCalledWith(profile);
    expect(onEnterTerminal).not.toHaveBeenCalled();
  });

  it('routes the start action of a paused bound SSH card through the SSH profile connect handler', async () => {
    const user = userEvent.setup();
    const profile = createSSHProfile();
    const runtimeWindow = createStandaloneSSHWindow(profile, {
      layout: {
        type: 'pane',
        id: 'layout-ssh-pane-1',
        pane: {
          id: 'ssh-pane-1',
          cwd: '/data/data/com.termux/files/home',
          command: '',
          status: WindowStatus.Paused,
          pid: null,
          backend: 'ssh',
          ssh: {
            profileId: profile.id,
          },
        },
      },
    });
    const onConnectSSHProfile = vi.fn();

    useWindowStore.setState({
      windows: [runtimeWindow],
    });

    renderCardGrid({
      sshEnabled: true,
      sshProfiles: [profile],
      onConnectSSHProfile,
    });

    await user.click(screen.getByRole('button', { name: '启动' }));

    expect(onConnectSSHProfile).toHaveBeenCalledWith(profile);
  });

  it('archives a bound SSH runtime window from the profile card without cascading to ephemeral clones', async () => {
    const user = userEvent.setup();
    const profile = createSSHProfile();
    const runtimeWindow = createStandaloneSSHWindow(profile);
    const ephemeralClone = createEphemeralSSHCloneWindow(profile);
    const closeWindowMock = vi.mocked(window.electronAPI.closeWindow);
    const deleteWindowMock = vi.mocked(window.electronAPI.deleteWindow);

    useWindowStore.setState({
      windows: [runtimeWindow, ephemeralClone],
    });

    const { rerender } = render(
      <DndProvider backend={HTML5Backend}>
        <CardGrid
          sshEnabled
          sshProfiles={[profile]}
          currentTab="active"
        />
      </DndProvider>,
    );

    await openSSHProfileCardMenu(user);
    await user.click(await screen.findByRole('menuitem', { name: '归档窗口' }));

    await waitFor(() => {
      expect(closeWindowMock).toHaveBeenCalledWith(runtimeWindow.id);
      expect(deleteWindowMock).toHaveBeenCalledWith(runtimeWindow.id);
      expect(useWindowStore.getState().windows[0]?.archived).toBe(true);
      expect(useWindowStore.getState().windows.some((window) => window.id === ephemeralClone.id)).toBe(true);
    });

    expect(closeWindowMock).not.toHaveBeenCalledWith(ephemeralClone.id);
    expect(deleteWindowMock).not.toHaveBeenCalledWith(ephemeralClone.id);

    rerender(
      <DndProvider backend={HTML5Backend}>
        <CardGrid
          sshEnabled
          sshProfiles={[profile]}
          currentTab="archived"
        />
      </DndProvider>,
    );

    expect(await screen.findByText('Hidden runtime window')).toBeInTheDocument();
    const archivedCard = screen.getByRole('button', { name: /Hidden runtime window/ });
    await user.click(within(archivedCard).getByRole('button', { name: '更多' }));
    expect(await screen.findByRole('menuitem', { name: '取消归档' })).toBeInTheDocument();
  });

  it('destroys a bound SSH runtime window together with its owned ephemeral clones', async () => {
    const user = userEvent.setup();
    const profile = createSSHProfile();
    const runtimeWindow = createStandaloneSSHWindow(profile);
    const ephemeralClone = createEphemeralSSHCloneWindow(profile);
    const closeWindowMock = vi.mocked(window.electronAPI.closeWindow);
    const deleteWindowMock = vi.mocked(window.electronAPI.deleteWindow);

    useWindowStore.setState({
      windows: [runtimeWindow, ephemeralClone],
    });

    renderCardGrid({
      sshEnabled: true,
      sshProfiles: [profile],
    });

    await user.click(screen.getByRole('button', { name: '停止' }));

    await waitFor(() => {
      expect(closeWindowMock).toHaveBeenCalledWith(runtimeWindow.id);
      expect(deleteWindowMock).toHaveBeenCalledWith(runtimeWindow.id);
      expect(closeWindowMock).toHaveBeenCalledWith(ephemeralClone.id);
      expect(deleteWindowMock).toHaveBeenCalledWith(ephemeralClone.id);
      expect(useWindowStore.getState().windows.some((window) => window.id === ephemeralClone.id)).toBe(false);
      expect(useWindowStore.getState().windows.some((window) => window.id === runtimeWindow.id)).toBe(false);
    });
  });

  it('destroys a lone bound SSH runtime window instead of leaving a restartable placeholder', async () => {
    const user = userEvent.setup();
    const profile = createSSHProfile();
    const runtimeWindow = createStandaloneSSHWindow(profile);
    const closeWindowMock = vi.mocked(window.electronAPI.closeWindow);
    const deleteWindowMock = vi.mocked(window.electronAPI.deleteWindow);

    useWindowStore.setState({
      windows: [runtimeWindow],
    });

    renderCardGrid({
      sshEnabled: true,
      sshProfiles: [profile],
    });

    await user.click(screen.getByRole('button', { name: '停止' }));

    await waitFor(() => {
      expect(closeWindowMock).toHaveBeenCalledWith(runtimeWindow.id);
      expect(deleteWindowMock).toHaveBeenCalledWith(runtimeWindow.id);
      expect(useWindowStore.getState().windows.some((window) => window.id === runtimeWindow.id)).toBe(false);
    });

    expect(screen.getByRole('button', { name: '启动' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '停止' })).not.toBeInTheDocument();
  });

  it('switches back to the unified view when destroying the currently active bound SSH runtime window from the card', async () => {
    const user = userEvent.setup();
    const profile = createSSHProfile();
    const runtimeWindow = createStandaloneSSHWindow(profile);

    useWindowStore.setState({
      windows: [runtimeWindow],
      activeWindowId: runtimeWindow.id,
    });

    renderCardGrid({
      sshEnabled: true,
      sshProfiles: [profile],
    });

    await user.click(screen.getByRole('button', { name: '停止' }));

    await waitFor(() => {
      expect(window.electronAPI.switchToUnifiedView).toHaveBeenCalledTimes(1);
      expect(useWindowStore.getState().activeWindowId).toBeNull();
    });
  });

  it('deletes a bound SSH card by removing both the runtime window and the SSH profile', async () => {
    const user = userEvent.setup();
    const profile = createSSHProfile();
    const runtimeWindow = createStandaloneSSHWindow(profile);
    const deleteWindowMock = vi.mocked(window.electronAPI.deleteWindow);
    const onDeleteSSHProfile = vi.fn().mockResolvedValue(undefined);

    useWindowStore.setState({
      windows: [runtimeWindow],
    });

    renderCardGrid({
      sshEnabled: true,
      sshProfiles: [profile],
      onDeleteSSHProfile,
    });

    await openSSHProfileCardMenu(user);
    await user.click(await screen.findByRole('menuitem', { name: '删除 SSH 卡片' }));

    expect(screen.getByText('确定要删除 SSH 卡片 “Prod Bastion” 吗？此操作会同时删除关联的 1 个终端窗口、SSH 配置和已保存的凭据。')).toBeInTheDocument();

    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: '删除 SSH 卡片' }));

    await waitFor(() => {
      expect(deleteWindowMock).toHaveBeenCalledWith(runtimeWindow.id);
      expect(onDeleteSSHProfile).toHaveBeenCalledWith(profile);
      expect(useWindowStore.getState().windows).toHaveLength(0);
    });
  });

  it('blocks deleting an SSH card when another window still references the same SSH profile', async () => {
    const user = userEvent.setup();
    const profile = createSSHProfile();
    const runtimeWindow = createStandaloneSSHWindow(profile);
    const siblingWindow = createStandaloneSSHWindow(profile, {
      id: 'ssh-window-2',
      name: 'Sibling runtime window',
      activePaneId: 'ssh-pane-2',
      lastActiveAt: '2026-03-22T10:04:00.000Z',
      layout: {
        type: 'pane',
        id: 'layout-ssh-pane-2',
        pane: {
          id: 'ssh-pane-2',
          cwd: '/srv/app-2',
          command: '/bin/zsh',
          status: WindowStatus.Paused,
          pid: null,
          backend: 'ssh',
          ssh: {
            profileId: profile.id,
            host: profile.host,
            port: profile.port,
            user: profile.user,
            authType: profile.auth,
            remoteCwd: '/srv/app-2',
            reuseSession: true,
          },
        },
      },
    });

    useWindowStore.setState({
      windows: [runtimeWindow, siblingWindow],
    });

    renderCardGrid({
      sshEnabled: true,
      sshProfiles: [profile],
    });

    await openSSHProfileCardMenu(user);
    await user.click(await screen.findByRole('menuitem', { name: '删除 SSH 卡片' }));

    expect(screen.getByText('当前还有 1 个其他窗口在使用这条 SSH 配置，暂时不能删除该卡片。请先处理这些窗口。')).toBeInTheDocument();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: '删除 SSH 卡片' })).toBeDisabled();
  });

  it('does not block deleting an SSH card when the only sibling reference is archived', async () => {
    const user = userEvent.setup();
    const profile = createSSHProfile();
    const runtimeWindow = createStandaloneSSHWindow(profile);
    const archivedSiblingWindow = {
      ...createStandaloneSSHWindow(profile, {
        id: 'ssh-window-2',
        name: 'Archived sibling window',
        activePaneId: 'ssh-pane-2',
        lastActiveAt: '2026-03-22T10:04:00.000Z',
        layout: {
          type: 'pane',
          id: 'layout-ssh-pane-2',
          pane: {
            id: 'ssh-pane-2',
            cwd: '/srv/app-2',
            command: '/bin/zsh',
            status: WindowStatus.Completed,
            pid: null,
            backend: 'ssh',
            ssh: {
              profileId: profile.id,
              host: profile.host,
              port: profile.port,
              user: profile.user,
              authType: profile.auth,
              remoteCwd: '/srv/app-2',
              reuseSession: true,
            },
          },
        },
      }),
      archived: true,
    };

    useWindowStore.setState({
      windows: [runtimeWindow, archivedSiblingWindow],
    });

    renderCardGrid({
      sshEnabled: true,
      sshProfiles: [profile],
    });

    await openSSHProfileCardMenu(user);
    await user.click(await screen.findByRole('menuitem', { name: '删除 SSH 卡片' }));

    expect(screen.queryByText('当前还有 1 个其他窗口在使用这条 SSH 配置，暂时不能删除该卡片。请先处理这些窗口。')).not.toBeInTheDocument();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: '删除 SSH 卡片' })).toBeEnabled();
  });

  it('uses the default border color for paused SSH cards', () => {
    const profile = createSSHProfile();
    const runtimeWindow = createStandaloneSSHWindow(profile, {
      layout: {
        type: 'pane',
        id: 'layout-ssh-pane-1',
        pane: {
          id: 'ssh-pane-1',
          cwd: '/srv/app',
          command: '/bin/zsh',
          status: WindowStatus.Paused,
          pid: null,
          backend: 'ssh',
          ssh: {
            profileId: profile.id,
            host: profile.host,
            port: profile.port,
            user: profile.user,
            authType: profile.auth,
            remoteCwd: '/srv/app',
            reuseSession: true,
          },
        },
      },
    });

    useWindowStore.setState({
      windows: [runtimeWindow],
    });

    renderCardGrid({
      sshEnabled: true,
      sshProfiles: [profile],
    });

    expect(screen.getByRole('button', { name: 'Prod Bastion root@10.0.0.21:22' }).getAttribute('style'))
      .toContain('border-top: 1px solid rgb(var(--border))');
  });
});
