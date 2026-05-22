import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import type { WindowCardDragItem, DropResult } from '../dnd';
import { CardGrid } from '../CardGrid';
import { useWindowStore } from '../../stores/windowStore';
import { Window, WindowStatus } from '../../types/window';
import { createGroup } from '../../utils/groupLayoutHelpers';
import { CanvasWorkspace } from '../../../shared/types/canvas';

vi.mock('../../hooks/useIDESettings', () => ({
  useIDESettings: () => ({
    enabledIDEs: [],
  }),
}));

const dropZoneProps: Array<{
  onDrop: (item: WindowCardDragItem, result: DropResult) => void;
  targetWindowId?: string;
  targetGroupId?: string;
  targetCanvasWorkspaceId?: string;
}> = [];

vi.mock('../dnd', async () => {
  const actual = await vi.importActual<typeof import('../dnd')>('../dnd');
  return {
    ...actual,
    DropZone: ({
      onDrop,
      children,
      targetWindowId,
      targetGroupId,
      targetCanvasWorkspaceId,
    }: {
      onDrop: (item: WindowCardDragItem, result: DropResult) => void;
      children: React.ReactNode;
      targetWindowId?: string;
      targetGroupId?: string;
      targetCanvasWorkspaceId?: string;
    }) => {
      dropZoneProps.push({ onDrop, targetWindowId, targetGroupId, targetCanvasWorkspaceId });
      return <div>{children}</div>;
    },
  };
});

type MakeWindowOptions = Partial<Window> & {
  id: string;
  status?: WindowStatus;
  cwd?: string;
  command?: string;
  pid?: number | null;
};

const makeWindow = (overrides: MakeWindowOptions): Window => {
  const {
    id,
    status = WindowStatus.Running,
    cwd = `/path/${overrides.id}`,
    command = 'claude',
    pid = status === WindowStatus.Paused ? null : 1000,
    ...windowOverrides
  } = overrides;
  const paneId = windowOverrides.activePaneId ?? `pane-${id}`;

  return {
    id,
    name: `Window ${id}`,
    activePaneId: paneId,
    createdAt: '2024-01-01T10:00:00Z',
    lastActiveAt: '2024-01-01T10:00:00Z',
    layout: {
      type: 'pane',
      id: paneId,
      pane: {
        id: paneId,
        cwd,
        command,
        status,
        pid,
        backend: 'local',
      },
    },
    ...windowOverrides,
  };
};

const makeCanvasWorkspace = (overrides: Partial<CanvasWorkspace> = {}): CanvasWorkspace => ({
  id: 'canvas-1',
  name: 'Ops Board',
  createdAt: '2026-05-03T00:00:00.000Z',
  updatedAt: '2026-05-03T00:00:00.000Z',
  workingDirectory: '/workspace/ops',
  blocks: [],
  viewport: { tx: 0, ty: 0, zoom: 1 },
  nextZIndex: 1,
  ...overrides,
});

function renderCardGrid(props: React.ComponentProps<typeof CardGrid> = {}) {
  return render(
    <DndProvider backend={HTML5Backend}>
      <CardGrid {...props} />
    </DndProvider>,
  );
}

describe('CardGrid', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    dropZoneProps.length = 0;
    useWindowStore.setState({
      windows: [],
      groups: [],
      canvasWorkspaces: [],
      customCategories: [],
      activeWindowId: null,
      activeGroupId: null,
    });
  });

  // AC1, AC2: CSS Grid layout and gap
  it('renders grid container with correct CSS Grid classes', () => {
    useWindowStore.getState().addWindow(makeWindow({ id: '1' }));
    renderCardGrid();
    const grid = screen.getByTestId('card-grid');
    expect(grid.className).toContain('grid');
    expect(grid.className).toContain('gap-4');
    expect(grid.className).toContain('p-8');
    expect(grid.className).toContain('minmax(350px,1fr)');
  });

  // AC7: scroll support
  it('renders ScrollArea root for scroll support', () => {
    useWindowStore.getState().addWindow(makeWindow({ id: '1' }));
    renderCardGrid();
    expect(screen.getByTestId('card-grid-scroll-root')).toBeInTheDocument();
  });

  it('renders recent active window cards sorted by lastActiveAt descending', () => {
    useWindowStore.setState({
      windows: [
        makeWindow({ id: 'old', name: 'Old Window', lastActiveAt: '2024-01-01T08:00:00Z' }),
        makeWindow({ id: 'new', name: 'New Window', lastActiveAt: '2024-01-01T12:00:00Z' }),
        makeWindow({ id: 'mid', name: 'Mid Window', lastActiveAt: '2024-01-01T10:00:00Z' }),
      ],
      mruList: [],
    });

    renderCardGrid({ currentTab: 'active' });

    const cardLabels = screen.getAllByRole('button')
      .map((button) => button.getAttribute('aria-label') ?? '')
      .filter((label) => ['New Window', 'Mid Window', 'Old Window'].some((name) => label.includes(name)));

    expect(cardLabels[0]).toContain('New Window');
    expect(cardLabels[1]).toContain('Mid Window');
    expect(cardLabels[2]).toContain('Old Window');
  });

  it('limits the recent active window cards using the configured count', () => {
    useWindowStore.setState({
      windows: [
        makeWindow({ id: 'old', name: 'Old Window', lastActiveAt: '2024-01-01T08:00:00Z' }),
        makeWindow({ id: 'new', name: 'New Window', lastActiveAt: '2024-01-01T12:00:00Z' }),
        makeWindow({ id: 'mid', name: 'Mid Window', lastActiveAt: '2024-01-01T10:00:00Z' }),
      ],
      mruList: [],
    });

    renderCardGrid({ currentTab: 'active', recentTerminalLimit: 2 });

    expect(screen.getByText('New Window')).toBeInTheDocument();
    expect(screen.getByText('Mid Window')).toBeInTheDocument();
    expect(screen.queryByText('Old Window')).not.toBeInTheDocument();
  });

  // Empty state
  it('renders nothing when windows array is empty', () => {
    const { container } = renderCardGrid();
    expect(container.firstChild).toBeNull();
  });

  // Renders all windows
  it('renders a WindowCard for each window', () => {
    const { addWindow } = useWindowStore.getState();
    addWindow(makeWindow({ id: '1', name: 'Window 1' }));
    addWindow(makeWindow({ id: '2', name: 'Window 2' }));
    addWindow(makeWindow({ id: '3', name: 'Window 3' }));

    renderCardGrid({ currentTab: 'all' });

    expect(screen.getByText('Window 1')).toBeInTheDocument();
    expect(screen.getByText('Window 2')).toBeInTheDocument();
    expect(screen.getByText('Window 3')).toBeInTheDocument();
  });

  it('does not render canvas-owned windows in standalone terminal cards', () => {
    const standaloneWindow = makeWindow({ id: 'standalone-1', name: 'Standalone Window' });
    const canvasOwnedWindow = makeWindow({
      id: 'canvas-owned-1',
      name: 'Canvas Owned Window',
      ownerType: 'canvas-owned',
      ownerCanvasWorkspaceId: 'canvas-1',
    });

    useWindowStore.setState({
      windows: [standaloneWindow, canvasOwnedWindow],
      canvasWorkspaces: [makeCanvasWorkspace()],
    });

    renderCardGrid({ currentTab: 'active' });

    expect(screen.getByText('Standalone Window')).toBeInTheDocument();
    expect(screen.queryByText('Canvas Owned Window')).not.toBeInTheDocument();
  });

  // 15+ windows scroll
  it('renders 15+ windows without error (scroll state)', () => {
    const { addWindow } = useWindowStore.getState();
    for (let i = 1; i <= 16; i++) {
      addWindow(makeWindow({ id: `${i}`, name: `Window ${i}` }));
    }

    renderCardGrid({ currentTab: 'all' });

    const windowCards = screen.getAllByRole('button')
      .filter((button) => (button.getAttribute('aria-label') ?? '').includes('Window '));
    expect(windowCards).toHaveLength(16);
    expect(screen.getByTestId('new-window-card')).toBeInTheDocument();
    expect(screen.getByTestId('card-grid-scroll-root')).toBeInTheDocument();
  });

  it('calls onEnterTerminal when a window card is clicked', async () => {
    const user = userEvent.setup();
    const handleEnterTerminal = vi.fn();
    const clickableWindow = makeWindow({ id: 'win-1', name: 'Clickable Window' });
    useWindowStore.getState().addWindow(clickableWindow);

    renderCardGrid({ onEnterTerminal: handleEnterTerminal });

    const windowCard = screen.getByRole('button', { name: /Clickable Window/ });
    await user.click(windowCard);

    expect(handleEnterTerminal).toHaveBeenCalledWith(clickableWindow);
  });

  // NewWindowCard is rendered at the end of the grid
  it('renders NewWindowCard at the end of the grid when windows exist', () => {
    useWindowStore.getState().addWindow(makeWindow({ id: '1', name: 'Window 1' }));
    renderCardGrid({ currentTab: 'all' });
    expect(screen.getByTestId('new-window-card')).toBeInTheDocument();
  });

  // NewWindowCard calls onCreateWindow
  it('calls onCreateWindow when NewWindowCard is clicked', async () => {
    const user = userEvent.setup();
    const handleCreate = vi.fn();
    useWindowStore.getState().addWindow(makeWindow({ id: '1' }));

    renderCardGrid({ onCreateWindow: handleCreate });

    await user.click(screen.getByRole('button', { name: '新建窗口' }));
    expect(handleCreate).toHaveBeenCalledTimes(1);
  });

  // NewWindowCard not shown when empty
  it('does not render NewWindowCard when windows array is empty', () => {
    renderCardGrid({ currentTab: 'all' });
    expect(screen.queryByTestId('new-window-card')).not.toBeInTheDocument();
  });

  // Different statuses render correctly
  it('renders cards with different statuses', () => {
    const { addWindow } = useWindowStore.getState();
    const statuses = [
      WindowStatus.Running,
      WindowStatus.WaitingForInput,
      WindowStatus.Completed,
      WindowStatus.Error,
      WindowStatus.Restoring,
    ];
    statuses.forEach((status, i) => {
      addWindow(makeWindow({ id: `${i}`, name: `Window ${i}`, status }));
    });

    renderCardGrid({ currentTab: 'all' });

    expect(screen.getByRole('button', { name: /运行中/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /等待输入/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /未启动/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /出错/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /恢复中/ })).toBeInTheDocument();
  });

  it('shows custom category empty state instead of active windows when the category has not synced yet', () => {
    useWindowStore.getState().addWindow(makeWindow({ id: '1', name: 'Window 1' }));

    renderCardGrid({ currentTab: 'category-persisted' });

    expect(screen.getByText('此分类暂无终端')).toBeInTheDocument();
    expect(screen.queryByText('Window 1')).not.toBeInTheDocument();
  });

  it('does not treat built-in status tabs as custom categories when empty', () => {
    const { container } = renderCardGrid({ currentTab: 'status:running' });

    expect(screen.queryByText('此分类暂无终端')).not.toBeInTheDocument();
    expect(container.firstChild).toBeNull();
  });

  it('adds a dragged window into an existing group from the card grid', () => {
    const sourceWindow = makeWindow({ id: 'source', name: 'Source Window' });
    const groupedWindowA = makeWindow({ id: 'group-a', name: 'Group A' });
    const groupedWindowB = makeWindow({ id: 'group-b', name: 'Group B' });

    useWindowStore.setState({
      windows: [sourceWindow, groupedWindowA, groupedWindowB],
      groups: [
        createGroup('Existing Group', groupedWindowA.id, groupedWindowB.id, 'horizontal'),
      ],
    });

    renderCardGrid({ currentTab: 'all' });

    const targetDropZone = dropZoneProps.at(-1);
    expect(targetDropZone).toBeDefined();

    targetDropZone?.onDrop(
      {
        type: 'WINDOW_CARD',
        windowId: sourceWindow.id,
        windowName: sourceWindow.name,
        source: 'cardGrid',
      },
      {
        position: 'right',
        targetGroupId: useWindowStore.getState().groups[0]?.id,
      },
    );

    const updatedGroup = useWindowStore.getState().groups[0];
    expect(updatedGroup).toBeDefined();
    expect(updatedGroup && screen.getByText('Existing Group')).toBeInTheDocument();
    expect(updatedGroup && updatedGroup.layout.type).toBe('split');
    expect(updatedGroup && JSON.stringify(updatedGroup.layout)).toContain(sourceWindow.id);
  });

  it('adds a dragged window into an existing canvas workspace from the card grid', () => {
    const sourceWindow = makeWindow({ id: 'source', name: 'Source Window' });
    useWindowStore.setState({
      windows: [sourceWindow],
      canvasWorkspaces: [makeCanvasWorkspace()],
    });

    renderCardGrid({ currentTab: 'canvas' });

    const targetDropZone = dropZoneProps.find((props) => props.targetCanvasWorkspaceId === 'canvas-1');

    expect(targetDropZone).toBeDefined();
    targetDropZone?.onDrop(
      {
        type: 'WINDOW_CARD',
        windowId: sourceWindow.id,
        windowName: sourceWindow.name,
        source: 'cardGrid',
      },
      {
        position: 'center',
        targetCanvasWorkspaceId: 'canvas-1',
      },
    );

    const updatedCanvasWorkspace = useWindowStore.getState().canvasWorkspaces[0];
    expect(updatedCanvasWorkspace?.blocks).toHaveLength(1);
    expect(updatedCanvasWorkspace?.blocks[0]).toMatchObject({
      type: 'window',
      windowId: sourceWindow.id,
      label: sourceWindow.name,
      displayMode: 'summary',
    });
  });

  it('renders only canvas workspaces in the dedicated canvas tab', () => {
    const sourceWindow = makeWindow({ id: 'source', name: 'Source Window' });
    useWindowStore.setState({
      windows: [sourceWindow],
      canvasWorkspaces: [makeCanvasWorkspace()],
    });

    renderCardGrid({ currentTab: 'canvas' });

    expect(screen.getByText('Ops Board')).toBeInTheDocument();
    expect(screen.queryByText('Source Window')).not.toBeInTheDocument();
  });

  it('renders a styled action button for opening canvas workspaces', () => {
    useWindowStore.setState({
      canvasWorkspaces: [makeCanvasWorkspace()],
    });

    renderCardGrid({ currentTab: 'canvas' });

    const canvasCard = screen.getByRole('button', { name: /Ops Board/ });
    const openButton = within(canvasCard).getByRole('button', { name: '打开画布' });

    expect(openButton.className).toContain('flex');
    expect(openButton.className).toContain('text-[rgb(var(--primary))]');
    expect(openButton.className).toContain('font-semibold');
    expect(openButton.querySelector('svg')).toBeInTheDocument();
  });

  it('renders a red stop button for started canvas workspaces', async () => {
    const user = userEvent.setup();
    const handleStopCanvasWorkspace = vi.fn().mockResolvedValue(undefined);
    useWindowStore.setState({
      canvasWorkspaces: [makeCanvasWorkspace()],
      startedCanvasWorkspaceIds: ['canvas-1'],
    });

    renderCardGrid({
      currentTab: 'canvas',
      onStopCanvasWorkspace: handleStopCanvasWorkspace,
    });

    const canvasCard = screen.getByRole('button', { name: /Ops Board/ });
    const stopButton = within(canvasCard).getByRole('button', { name: '停止画布' });

    expect(stopButton.className).toContain('!text-red-500');
    expect(stopButton.className).toContain('focus:!ring-red-500/45');

    await user.click(stopButton);

    expect(handleStopCanvasWorkspace).toHaveBeenCalledWith('canvas-1');
  });

  it('renders the canvas updated timestamp only once per card', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-08T13:00:00.000Z'));

    useWindowStore.setState({
      canvasWorkspaces: [
        makeCanvasWorkspace({
          updatedAt: '2026-05-08T00:00:00.000Z',
        }),
      ],
    });

    renderCardGrid({ currentTab: 'canvas' });

    const canvasCard = screen.getByRole('button', { name: /Ops Board/ });
    expect(within(canvasCard).getAllByText('最近更新：13 小时前')).toHaveLength(1);
  });
});
