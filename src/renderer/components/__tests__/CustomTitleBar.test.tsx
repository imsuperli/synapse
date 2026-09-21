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

  it('reserves space for native macOS traffic lights instead of drawing imitations', () => {
    window.electronAPI.platform = 'darwin';

    render(<CustomTitleBar title="Workspace" />);

    expect(screen.getByTestId('mac-native-window-controls-spacer')).toHaveClass('w-[68px]');
    expect(screen.queryByLabelText('Close')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Minimize')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Maximize')).not.toBeInTheDocument();
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
