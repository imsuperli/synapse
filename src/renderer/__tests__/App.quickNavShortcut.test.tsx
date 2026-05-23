import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWindowStore } from '../stores/windowStore';

const {
  mockQuickNavPanel,
  mockQuickSwitcher,
  mockUseViewSwitcher,
  mockUseWindowSwitcher,
  mockUseWorkspaceRestore,
} = vi.hoisted(() => ({
  mockQuickNavPanel: vi.fn(({ open }: { open: boolean }) => (
    open ? <div data-testid="quick-nav-state">open</div> : null
  )),
  mockQuickSwitcher: vi.fn(({ isOpen }: { isOpen: boolean }) => (
    isOpen ? <div data-testid="quick-switcher-state">open</div> : null
  )),
  mockUseViewSwitcher: vi.fn(),
  mockUseWindowSwitcher: vi.fn(),
  mockUseWorkspaceRestore: vi.fn(),
}));

vi.mock('../components/layout/MainLayout', () => ({
  MainLayout: ({ children }: { children: unknown }) => <div>{children as any}</div>,
}));

vi.mock('../components/layout/Sidebar', () => ({
  Sidebar: () => null,
}));

vi.mock('../components/EmptyState', () => ({
  EmptyState: () => null,
}));

vi.mock('../components/CardGrid', () => ({
  CardGrid: () => null,
}));

vi.mock('../components/CreateGroupDialog', () => ({
  CreateGroupDialog: () => null,
}));

vi.mock('../components/CreateWindowDialog', () => ({
  CreateWindowDialog: () => null,
}));

vi.mock('../components/TerminalView', () => ({
  TerminalView: () => null,
}));

vi.mock('../components/GroupView', () => ({
  GroupView: () => null,
}));

vi.mock('../components/AppNotice', () => ({
  AppNotice: () => null,
}));

vi.mock('../components/CleanupOverlay', () => ({
  CleanupOverlay: () => null,
}));

vi.mock('../components/QuickNavPanel', () => ({
  QuickNavPanel: mockQuickNavPanel,
}));

vi.mock('../components/QuickSwitcher', () => ({
  QuickSwitcher: mockQuickSwitcher,
}));

vi.mock('../components/SSHHostKeyPromptDialog', () => ({
  SSHHostKeyPromptDialog: () => null,
}));

vi.mock('../components/SSHPasswordPromptDialog', () => ({
  SSHPasswordPromptDialog: () => null,
}));

vi.mock('../hooks/useViewSwitcher', () => ({
  useViewSwitcher: mockUseViewSwitcher,
}));

vi.mock('../hooks/useWindowSwitcher', () => ({
  useWindowSwitcher: mockUseWindowSwitcher,
}));

vi.mock('../hooks/useWorkspaceRestore', () => ({
  useWorkspaceRestore: mockUseWorkspaceRestore,
}));

import App from '../App';

function pressKey(key: string) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key }));
  window.dispatchEvent(new KeyboardEvent('keyup', { key }));
}

function pressCtrlTab() {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', ctrlKey: true }));
}

async function renderApp() {
  await act(async () => {
    render(<App />);
    await Promise.resolve();
  });
}

describe('App quick navigation shortcut', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-26T00:00:00.000Z'));
    vi.mocked(window.electronAPI.getSettings).mockResolvedValue({
      success: true,
      data: {
        language: 'zh-CN',
        ides: [],
        quickNav: { items: [] },
        terminal: { useBundledConptyDll: false, defaultShellProgram: '' },
        features: { sshEnabled: true },
        keyboardShortcuts: {
          quickSwitcher: { key: 'Tab', modifiers: ['ctrl'] },
          quickNav: { key: 'Control', doubleTap: true },
        },
      } as any,
    });

    useWindowStore.setState({
      windows: [],
      groups: [],
      activeWindowId: null,
      activeGroupId: null,
      customCategories: [],
      mruList: [],
      sidebarExpanded: false,
      sidebarWidth: 280,
    });

    mockUseViewSwitcher.mockReturnValue({
      currentView: 'unified',
      switchToTerminalView: vi.fn(),
      switchToUnifiedView: vi.fn(),
      error: null,
    });
    mockUseWindowSwitcher.mockReturnValue({
      switchToWindow: vi.fn(),
    });
    mockUseWorkspaceRestore.mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens quick navigation when Control is double-tapped within 399ms', async () => {
    await renderApp();

    expect(screen.queryByTestId('quick-nav-state')).not.toBeInTheDocument();

    await act(async () => {
      pressKey('Control');
      vi.advanceTimersByTime(399);
      pressKey('Control');
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId('quick-nav-state')).toHaveTextContent('open');
  });

  it('does not open quick navigation when Control taps are 400ms apart', async () => {
    await renderApp();

    act(() => {
      pressKey('Control');
      vi.advanceTimersByTime(400);
      pressKey('Control');
    });

    expect(screen.queryByTestId('quick-nav-state')).not.toBeInTheDocument();
  });

  it('opens quick navigation with a legacy customized Shift double tap', async () => {
    vi.mocked(window.electronAPI.getSettings).mockResolvedValue({
      success: true,
      data: {
        language: 'zh-CN',
        ides: [],
        quickNav: { items: [] },
        terminal: { useBundledConptyDll: false, defaultShellProgram: '' },
        features: { sshEnabled: true },
        keyboardShortcuts: {
          quickSwitcher: { key: 'Tab', modifiers: ['ctrl'] },
          quickNav: { key: 'Shift', doubleTap: true },
        },
      } as any,
    });

    await renderApp();

    await act(async () => {
      pressKey('Shift');
      vi.advanceTimersByTime(399);
      pressKey('Shift');
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId('quick-nav-state')).toHaveTextContent('open');
  });

  it('opens the quick switcher from the unified view with Ctrl+Tab', async () => {
    await renderApp();

    expect(screen.queryByTestId('quick-switcher-state')).not.toBeInTheDocument();

    await act(async () => {
      pressCtrlTab();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId('quick-switcher-state')).toHaveTextContent('open');
  });
});
