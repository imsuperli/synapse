import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEvent, fireEvent, render, screen, cleanup } from '@testing-library/react';
import { CustomTitleBar } from '../CustomTitleBar';

describe('CustomTitleBar', () => {
  beforeEach(() => {
    Object.assign(window.electronAPI, {
      platform: 'linux',
      windowMinimize: vi.fn().mockResolvedValue({ success: true }),
      windowMaximize: vi.fn().mockResolvedValue({ success: true }),
      windowToggleFullScreen: vi.fn().mockResolvedValue({ success: true }),
      windowClose: vi.fn().mockResolvedValue({ success: true }),
      windowIsMaximized: vi.fn().mockResolvedValue({ success: true, data: false }),
      windowIsFullScreen: vi.fn().mockResolvedValue({ success: true, data: false }),
      onWindowMaximized: vi.fn(() => () => {}),
      onWindowFullScreen: vi.fn(() => () => {}),
    });
  });

  afterEach(() => {
    cleanup();
    window.history.replaceState({}, '', '/');
  });

  it('resolves the title bar logo relative to the current renderer page', () => {
    window.history.replaceState({}, '', '/dist/renderer/index.html');

    render(
      <CustomTitleBar
        title="Workspace"
        showAppName={true}
        appName="Synapse"
      />,
    );

    const logo = screen.getByAltText('Logo');
    expect(logo).toHaveAttribute('src', 'http://localhost:3000/dist/renderer/resources/icon.png');
  });

  it('uses native full screen semantics for the macOS green button', () => {
    window.electronAPI.platform = 'darwin';

    render(<CustomTitleBar title="Workspace" />);

    fireEvent.click(screen.getByLabelText('Maximize'));

    expect(window.electronAPI.windowToggleFullScreen).toHaveBeenCalledTimes(1);
    expect(window.electronAPI.windowMaximize).not.toHaveBeenCalled();
  });

  it('renders standard glyphs inside the macOS traffic light controls', () => {
    window.electronAPI.platform = 'darwin';

    render(<CustomTitleBar title="Workspace" />);

    const controls = screen.getByTestId('mac-window-controls');
    const closeButton = screen.getByLabelText('Close');
    const minimizeButton = screen.getByLabelText('Minimize');
    const maximizeButton = screen.getByLabelText('Maximize');

    expect(controls).toHaveClass('group');
    expect(closeButton).toHaveClass('bg-[#ff5f57]', 'border-[#e0443e]');
    expect(minimizeButton).toHaveClass('bg-[#febc2e]', 'border-[#dea123]');
    expect(maximizeButton).toHaveClass('bg-[#28c840]', 'border-[#1aab29]');

    for (const button of [closeButton, minimizeButton, maximizeButton]) {
      const icon = button.querySelector('svg');
      expect(icon).toBeInTheDocument();
      expect(icon).toHaveClass('opacity-0', 'group-hover:opacity-100');
    }
  });

  it('renders the title bar actions slot before window controls', () => {
    const { container } = render(<CustomTitleBar title="Workspace" />);

    const slot = screen.getByTestId('custom-titlebar-actions-slot');
    expect(slot).toBeInTheDocument();
    expect(slot.nextElementSibling).toHaveAttribute('aria-label', 'Minimize');
    expect(container.querySelector('#custom-titlebar-actions-slot')).toBe(slot);
  });

  it('uses the shared appearance-driven title bar surface styles', () => {
    const { container } = render(<CustomTitleBar title="Workspace" />);

    const titleBar = container.firstElementChild;
    expect(titleBar).toHaveStyle({
      background: 'var(--appearance-titlebar-background)',
      backdropFilter: 'var(--appearance-titlebar-backdrop-filter)',
    });
  });

  it('prevents mouse focus on title bar buttons', () => {
    const { container } = render(
      <CustomTitleBar
        title="Workspace"
        onReturn={vi.fn()}
      />,
    );

    const homeButton = container.querySelector('button');
    expect(homeButton).not.toBeNull();
    expect(homeButton).toHaveAttribute('tabIndex', '-1');

    const mouseDownEvent = createEvent.mouseDown(homeButton!);
    fireEvent(homeButton!, mouseDownEvent);

    expect(mouseDownEvent.defaultPrevented).toBe(true);
  });

  it('uses the custom close handler when provided', () => {
    const onClose = vi.fn();

    render(
      <CustomTitleBar
        title="Workspace"
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByLabelText('Close'));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(window.electronAPI.windowClose).not.toHaveBeenCalled();
  });
});
