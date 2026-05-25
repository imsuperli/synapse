import { render, screen, waitFor } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QuickSwitcher } from '../QuickSwitcher';
import { useWindowStore } from '../../stores/windowStore';
import type { CanvasWorkspace } from '../../../shared/types/canvas';
import type { SSHProfile } from '../../../shared/types/ssh';
import { Window, WindowStatus } from '../../types/window';

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

function createCanvasWorkspace(overrides: Partial<CanvasWorkspace> = {}): CanvasWorkspace {
  return {
    id: 'canvas-1',
    name: 'Incident Map',
    createdAt: '2026-05-03T00:00:00.000Z',
    updatedAt: '2026-05-03T00:00:00.000Z',
    workingDirectory: '/srv/incidents',
    blocks: [],
    viewport: { tx: 0, ty: 0, zoom: 1 },
    nextZIndex: 1,
    ...overrides,
  };
}

describe('QuickSwitcher SSH profile bindings', () => {
  beforeEach(() => {
    useWindowStore.setState({
      windows: [],
      groups: [],
      activeWindowId: null,
      activeGroupId: null,
      mruList: [],
      groupMruList: [],
      sidebarExpanded: false,
      sidebarWidth: 220,
      customCategories: [],
      canvasWorkspaces: [],
      terminalSidebarFilter: 'all',
    });
    vi.clearAllMocks();
  });

  it('shows the SSH profile card name and summary for a standalone SSH runtime window', async () => {
    const profile = createSSHProfile();
    const runtimeWindow = createStandaloneSSHWindow(profile);

    useWindowStore.setState({
      windows: [runtimeWindow],
      groups: [],
    });

    render(
      <QuickSwitcher
        isOpen
        currentWindowId={runtimeWindow.id}
        onClose={() => {}}
        onSelect={() => {}}
        sshProfiles={[profile]}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Prod Bastion')).toBeInTheDocument();
    });

    expect(screen.queryByText('Hidden runtime window')).not.toBeInTheDocument();
    expect(screen.getByText('root@10.0.0.21:22 | /srv/app')).toBeInTheDocument();
  });

  it('matches standalone SSH runtime windows by SSH profile name when filtering', async () => {
    const user = userEvent.setup();
    const profile = createSSHProfile({ name: 'Release Bastion' });
    const runtimeWindow = createStandaloneSSHWindow(profile);

    useWindowStore.setState({
      windows: [runtimeWindow],
      groups: [],
    });

    render(
      <QuickSwitcher
        isOpen
        currentWindowId={runtimeWindow.id}
        onClose={() => {}}
        onSelect={() => {}}
        sshProfiles={[profile]}
      />,
    );

    await user.type(screen.getByRole('textbox'), 'release');

    await waitFor(() => {
      expect(
        screen.getAllByText((_, element) => element?.textContent === 'Release Bastion').length
      ).toBeGreaterThan(0);
    });
  });

  it('does not return fuzzy-only matches that the home search would not return', async () => {
    const user = userEvent.setup();
    const profile = createSSHProfile({ name: 'Release Bastion' });
    const runtimeWindow = createStandaloneSSHWindow(profile);

    useWindowStore.setState({
      windows: [runtimeWindow],
      groups: [],
    });

    render(
      <QuickSwitcher
        isOpen
        currentWindowId={runtimeWindow.id}
        onClose={() => {}}
        onSelect={() => {}}
        sshProfiles={[profile]}
      />,
    );

    await user.type(screen.getByRole('textbox'), 'rls');

    expect(screen.queryByText((_, element) => element?.textContent === 'Release Bastion')).not.toBeInTheDocument();
    expect(
      screen.getByText(/No matching windows, groups, canvases, or SSH connections found|没有找到匹配的窗口、窗口组、画布或 SSH 连接/),
    ).toBeInTheDocument();
  });

  it('matches standalone SSH runtime windows by contiguous IP fragments only', async () => {
    const user = userEvent.setup();
    const matchingProfile = createSSHProfile({
      id: 'ssh-profile-198',
      name: 'Target Host',
      host: '172.30.9.198',
    });
    const unrelatedProfile = createSSHProfile({
      id: 'ssh-profile-unrelated',
      name: 'Unrelated Host',
      host: '192.168.3.25',
    });
    const matchingWindow = createStandaloneSSHWindow(matchingProfile, {
      id: 'ssh-window-198',
      activePaneId: 'ssh-pane-198',
      layout: {
        type: 'pane',
        id: 'layout-ssh-pane-198',
        pane: {
          id: 'ssh-pane-198',
          cwd: '/srv/app',
          command: '/bin/zsh',
          status: WindowStatus.Running,
          pid: 1234,
          backend: 'ssh',
          ssh: {
            profileId: matchingProfile.id,
            host: matchingProfile.host,
            port: matchingProfile.port,
            user: matchingProfile.user,
            authType: matchingProfile.auth,
            remoteCwd: '/srv/app',
            reuseSession: true,
          },
        },
      },
    });
    const unrelatedWindow = createStandaloneSSHWindow(unrelatedProfile, {
      id: 'ssh-window-unrelated',
      activePaneId: 'ssh-pane-unrelated',
      layout: {
        type: 'pane',
        id: 'layout-ssh-pane-unrelated',
        pane: {
          id: 'ssh-pane-unrelated',
          cwd: '/srv/app',
          command: '/bin/zsh',
          status: WindowStatus.Running,
          pid: 5678,
          backend: 'ssh',
          ssh: {
            profileId: unrelatedProfile.id,
            host: unrelatedProfile.host,
            port: unrelatedProfile.port,
            user: unrelatedProfile.user,
            authType: unrelatedProfile.auth,
            remoteCwd: '/srv/app',
            reuseSession: true,
          },
        },
      },
    });

    useWindowStore.setState({
      windows: [matchingWindow, unrelatedWindow],
      groups: [],
    });

    render(
      <QuickSwitcher
        isOpen
        currentWindowId={null}
        onClose={() => {}}
        onSelect={() => {}}
        sshProfiles={[matchingProfile, unrelatedProfile]}
      />,
    );

    await user.type(screen.getByRole('textbox'), '198');

    await waitFor(() => {
      expect(
        screen.getAllByText((_, element) => element?.textContent === 'Target Host').length,
      ).toBeGreaterThan(0);
    });
    expect(screen.queryByText((_, element) => element?.textContent === 'Unrelated Host')).not.toBeInTheDocument();
    expect(screen.getByText((_, element) => element?.textContent === 'root@172.30.9.198:22 | /srv/app')).toBeInTheDocument();
    expect(screen.queryByText((_, element) => element?.textContent === 'root@192.168.3.25:22 | /srv/app')).not.toBeInTheDocument();
  });

  it('matches SSH profile cards by IP fragments before a runtime window exists', async () => {
    const user = userEvent.setup();
    const profile = createSSHProfile({
      id: 'ssh-profile-198',
      name: 'LLM Gateway',
      host: '172.30.9.198',
      defaultRemoteCwd: '/srv/llm',
      tags: ['llm'],
    });
    const onSelectSSHProfile = vi.fn();

    render(
      <QuickSwitcher
        isOpen
        currentWindowId={null}
        onClose={() => {}}
        onSelect={() => {}}
        onSelectSSHProfile={onSelectSSHProfile}
        sshProfiles={[profile]}
      />,
    );

    await user.type(screen.getByRole('textbox'), '198');

    await waitFor(() => {
      expect(
        screen.getAllByText((_, element) => element?.textContent === 'LLM Gateway').length,
      ).toBeGreaterThan(0);
    });
    expect(screen.getByText((_, element) => element?.textContent === 'root@172.30.9.198:22 | /srv/llm')).toBeInTheDocument();

    await user.keyboard('{Enter}');
    expect(onSelectSSHProfile).toHaveBeenCalledWith(profile);
  });

  it('matches SSH profile tags and remote paths when filtering', async () => {
    const user = userEvent.setup();
    const profile = createSSHProfile({
      name: 'Reports Host',
      host: '172.30.9.205',
      defaultRemoteCwd: '/opt/reports/current',
      tags: ['analytics'],
    });
    const runtimeWindow = createStandaloneSSHWindow(profile, {
      layout: {
        type: 'pane',
        id: 'layout-ssh-pane-1',
        pane: {
          id: 'ssh-pane-1',
          cwd: '/opt/reports/current',
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
            remoteCwd: '/opt/reports/current',
            reuseSession: true,
          },
        },
      },
    });

    useWindowStore.setState({
      windows: [runtimeWindow],
      groups: [],
    });

    const { rerender } = render(
      <QuickSwitcher
        isOpen
        currentWindowId={runtimeWindow.id}
        onClose={() => {}}
        onSelect={() => {}}
        sshProfiles={[profile]}
      />,
    );

    await user.type(screen.getByRole('textbox'), 'analytics');
    await waitFor(() => {
      expect(
        screen.getAllByText((_, element) => element?.textContent === 'Reports Host').length,
      ).toBeGreaterThan(0);
    });

    rerender(
      <QuickSwitcher
        isOpen
        currentWindowId={runtimeWindow.id}
        onClose={() => {}}
        onSelect={() => {}}
        sshProfiles={[profile]}
      />,
    );

    await user.clear(screen.getByRole('textbox'));
    await user.type(screen.getByRole('textbox'), 'reports/current');
    await waitFor(() => {
      expect(
        screen.getByText((_, element) => element?.textContent === 'root@172.30.9.205:22 | /opt/reports/current'),
      ).toBeInTheDocument();
    });
  });

  it('shows an ssh clone tab in quick switcher because clone tabs are peer runtime tabs', async () => {
    const profile = createSSHProfile();
    const ownerWindow = createStandaloneSSHWindow(profile, {
      id: 'ssh-window-owner',
      name: 'Owner runtime window',
    });
    const cloneWindow = createStandaloneSSHWindow(profile, {
      id: 'ssh-window-clone',
      name: 'Clone runtime window',
      ephemeral: true,
      sshTabOwnerWindowId: ownerWindow.id,
    });

    useWindowStore.setState({
      windows: [ownerWindow, cloneWindow],
      groups: [],
    });

    render(
      <QuickSwitcher
        isOpen
        currentWindowId={cloneWindow.id}
        onClose={() => {}}
        onSelect={() => {}}
        sshProfiles={[profile]}
      />,
    );

    await waitFor(() => {
      expect(screen.getAllByText('Prod Bastion').length).toBeGreaterThanOrEqual(2);
    });

    expect(screen.getAllByText('root@10.0.0.21:22 | /srv/app')).toHaveLength(2);
  });

  it('does not select or close when there are no filtered results', async () => {
    const user = userEvent.setup();
    const profile = createSSHProfile();
    const runtimeWindow = createStandaloneSSHWindow(profile);
    const onSelect = vi.fn();
    const onClose = vi.fn();

    useWindowStore.setState({
      windows: [runtimeWindow],
      groups: [],
    });

    render(
      <QuickSwitcher
        isOpen
        currentWindowId={runtimeWindow.id}
        onClose={onClose}
        onSelect={onSelect}
        sshProfiles={[profile]}
      />,
    );

    await user.type(screen.getByRole('textbox'), 'missing-target');
    await user.keyboard('{ArrowDown}{Enter}');

    expect(
      screen.getByText(/No matching windows, groups, canvases, or SSH connections found|没有找到匹配的窗口、窗口组、画布或 SSH 连接/),
    ).toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('includes canvas workspaces and selects them', async () => {
    const user = userEvent.setup();
    const onSelectCanvas = vi.fn();

    useWindowStore.setState({
      canvasWorkspaces: [createCanvasWorkspace()],
    });

    render(
      <QuickSwitcher
        isOpen
        currentWindowId={null}
        currentCanvasWorkspaceId={null}
        onClose={() => {}}
        onSelect={() => {}}
        onSelectCanvas={onSelectCanvas}
      />,
    );

    await user.type(screen.getByRole('textbox'), 'incident');
    const canvasLabel = screen.getAllByText((_, element) => element?.textContent === 'Incident Map').at(-1);
    expect(canvasLabel).toBeDefined();
    fireEvent.click(canvasLabel!.closest('.cursor-pointer') ?? canvasLabel!);

    expect(onSelectCanvas).toHaveBeenCalledWith('canvas-1');
  });
});
