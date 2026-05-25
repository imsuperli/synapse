import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Sidebar } from '../layout/Sidebar';
import { useWindowStore } from '../../stores/windowStore';
import { createGroup } from '../../utils/groupLayoutHelpers';
import { createSinglePaneWindow } from '../../utils/layoutHelpers';
import { WindowStatus, type Window } from '../../types/window';

const mockCreateWindowDialog = vi.fn(() => null);

vi.mock('../StatusBar', () => ({
  StatusBar: () => <div data-testid="status-bar" />,
}));

vi.mock('../CreateWindowDialog', () => ({
  CreateWindowDialog: mockCreateWindowDialog,
}));

vi.mock('../BatchCreateWindowDialog', () => ({
  BatchCreateWindowDialog: () => null,
}));

vi.mock('../SettingsPanel', () => ({
  SettingsPanel: () => null,
}));

vi.mock('../QuickNavPanel', () => ({
  QuickNavPanel: () => null,
}));

vi.mock('../AboutPanel', () => ({
  AboutPanel: () => null,
}));

vi.mock('../dnd/CategoryDropZone', () => ({
  CategoryDropZone: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

function createWindowWithStatus(name: string, status: WindowStatus): Window {
  const window = createSinglePaneWindow(name, `/workspace/${name}`, 'bash');
  if (window.layout.type === 'pane') {
    window.layout.pane.status = status;
    window.layout.pane.pid = status === WindowStatus.Completed ? null : 1000;
  }
  return window;
}

describe('Layout Sidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWindowStore.setState({
      windows: [],
      groups: [],
      customCategories: [],
      activeWindowId: null,
      activeGroupId: null,
      mruList: [],
      groupMruList: [],
    });
  });

  it('does not mount the create window dialog from the home sidebar', () => {
    render(
      <Sidebar
        currentTab="active"
        searchQuery=""
        onSearchChange={vi.fn()}
        onTabChange={vi.fn()}
      />,
    );

    expect(mockCreateWindowDialog).not.toHaveBeenCalled();
  });

  it('uses a consistent icon slot for built-in sidebar tabs', () => {
    render(
      <Sidebar
        currentTab="active"
        searchQuery=""
        onSearchChange={vi.fn()}
        onTabChange={vi.fn()}
        sshEnabled
      />,
    );

    for (const name of ['最近终端', '本地终端', '远程终端', '画布', '归档终端', '全部终端']) {
      const button = screen.getByRole('button', { name });
      expect(button.querySelector('.h-6.w-6.shrink-0.items-center.justify-center')).not.toBeNull();
    }
  });

  it('deletes recent active window records when clearing the recent terminals tab', async () => {
    const user = userEvent.setup();
    const activeWindow = createWindowWithStatus('active-a', WindowStatus.Running);
    const otherWindow = {
      ...createWindowWithStatus('archived-a', WindowStatus.Completed),
      archived: true,
    };

    useWindowStore.setState({
      windows: [activeWindow, otherWindow],
    });

    render(
      <Sidebar
        currentTab="active"
        searchQuery=""
        onSearchChange={vi.fn()}
        onTabChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: '清空最近终端' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: '删除' }));

    await waitFor(() => {
      expect(window.electronAPI.closeWindow).toHaveBeenCalledWith(activeWindow.id);
      expect(window.electronAPI.deleteWindow).toHaveBeenCalledWith(activeWindow.id);
    });

    const storedWindows = useWindowStore.getState().windows;
    expect(storedWindows.map((window) => window.id)).toEqual([otherWindow.id]);
  });

  it('counts window groups in the recent terminals tab', () => {
    const groupWindowA = createWindowWithStatus('group-a', WindowStatus.Running);
    const groupWindowB = createWindowWithStatus('group-b', WindowStatus.Running);
    const standaloneWindow = createWindowWithStatus('standalone-a', WindowStatus.Running);
    const group = createGroup('Recent Group', groupWindowA.id, groupWindowB.id);

    useWindowStore.setState({
      windows: [groupWindowA, groupWindowB, standaloneWindow],
      groups: [group],
      mruList: [],
      groupMruList: [],
    });

    render(
      <Sidebar
        currentTab="active"
        searchQuery=""
        onSearchChange={vi.fn()}
        onTabChange={vi.fn()}
      />,
    );

    const recentTab = screen.getByRole('button', { name: '最近终端2' });
    expect(within(recentTab).getByText('2')).toBeInTheDocument();
  });

  it('clears ssh window records together with owned ephemeral clone tabs from the ssh tab', async () => {
    const user = userEvent.setup();
    const ownerWindow = {
      ...createWindowWithStatus('ssh-owner', WindowStatus.Running),
      kind: 'ssh' as const,
      layout: {
        type: 'pane' as const,
        id: 'pane-ssh-owner',
        pane: {
          id: 'pane-ssh-owner',
          cwd: '/srv/app',
          command: '',
          status: WindowStatus.Running,
          pid: 2001,
          backend: 'ssh' as const,
          ssh: {
            profileId: 'profile-1',
          },
        },
      },
    };
    const cloneWindow = {
      ...createWindowWithStatus('ssh-clone', WindowStatus.Running),
      kind: 'ssh' as const,
      ephemeral: true,
      sshTabOwnerWindowId: ownerWindow.id,
      layout: {
        type: 'pane' as const,
        id: 'pane-ssh-clone',
        pane: {
          id: 'pane-ssh-clone',
          cwd: '/srv/clone',
          command: '',
          status: WindowStatus.Running,
          pid: 2002,
          backend: 'ssh' as const,
          ssh: {
            profileId: 'profile-1',
          },
        },
      },
    };

    useWindowStore.setState({
      windows: [ownerWindow, cloneWindow],
    });

    render(
      <Sidebar
        currentTab="ssh"
        searchQuery=""
        onSearchChange={vi.fn()}
        onTabChange={vi.fn()}
        sshEnabled
      />,
    );

    await user.click(screen.getByRole('button', { name: '清空远程终端' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: '删除' }));

    await waitFor(() => {
      expect(window.electronAPI.closeWindow).toHaveBeenCalledWith(ownerWindow.id);
      expect(window.electronAPI.deleteWindow).toHaveBeenCalledWith(ownerWindow.id);
      expect(window.electronAPI.closeWindow).toHaveBeenCalledWith(cloneWindow.id);
      expect(window.electronAPI.deleteWindow).toHaveBeenCalledWith(cloneWindow.id);
    });

    expect(useWindowStore.getState().windows).toHaveLength(0);
  });
});
