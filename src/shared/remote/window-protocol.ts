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

export type WindowStartResult = {
  window: RemoteWindowSummary;
  pane: RemotePaneSummary | null;
  startedPanes: RemotePaneSummary[];
};

export type WindowCreateResult = {
  window: RemoteWindowSummary;
  pane: RemotePaneSummary;
};

export const WindowListParamsSchema = z.object({
  includeArchived: z.boolean().optional(),
  terminalOnly: z.boolean().optional(),
}).strict();

export const PaneListParamsSchema = z.object({
  windowId: z.string().min(1).optional(),
  includeArchived: z.boolean().optional(),
  terminalOnly: z.boolean().optional(),
}).strict();

export const WindowStartParamsSchema = z.object({
  windowId: z.string().min(1),
  paneId: z.string().min(1).optional(),
  initialCols: z.number().int().min(1).max(1000).optional(),
  initialRows: z.number().int().min(1).max(1000).optional(),
}).strict();

export const WindowCreateParamsSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  workingDirectory: z.string().trim().min(1).optional(),
  command: z.string().trim().min(1).max(500).optional(),
  initialCols: z.number().int().min(1).max(1000).optional(),
  initialRows: z.number().int().min(1).max(1000).optional(),
}).strict();
