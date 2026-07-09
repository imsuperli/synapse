import { z } from 'zod';
import type { PaneBackend, PaneKind, WindowKind, WindowStatus } from '../types/window';

export type RemotePaneSummary = {
  windowId: string;
  paneId: string;
  active: boolean;
  kind: PaneKind;
  backend: PaneBackend | null;
  status: WindowStatus;
  running: boolean;
  pid: number | null;
  sessionId: string | null;
  cwd: string | null;
  command: string | null;
  title?: string;
};

export type RemoteWindowSummary = {
  windowId: string;
  name: string;
  kind: WindowKind | null;
  archived: boolean;
  activePaneId: string;
  createdAt: string;
  lastActiveAt: string;
  paneCount: number;
  terminalPaneCount: number;
  panes: RemotePaneSummary[];
};

export type WindowListResult = {
  windows: RemoteWindowSummary[];
};

export type PaneListResult = {
  panes: RemotePaneSummary[];
};

export const WindowListParamsSchema = z.object({
  includeArchived: z.boolean().optional(),
  terminalOnly: z.boolean().optional(),
});

export const PaneListParamsSchema = z.object({
  windowId: z.string().min(1).optional(),
  includeArchived: z.boolean().optional(),
  terminalOnly: z.boolean().optional(),
});
