import { z } from 'zod';
import type { PaneBackend } from '../types/window';

export type RemoteTerminalSummary = {
  windowId: string | null;
  paneId: string | null;
  sessionId: string;
  pid: number;
  backend: PaneBackend;
  status: 'alive' | 'exited';
  workingDirectory: string;
  command?: string;
  profileId?: string;
};

export type TerminalHistoryResult = {
  windowId: string;
  paneId: string;
  chunks: string[];
  firstSeq: number;
  lastSeq: number;
  gap: boolean;
  keyboardState?: unknown;
};

export type TerminalSubscribeResult = {
  subscriptionId: string;
  firstSeq: number;
  lastSeq: number;
  gap: boolean;
};

export const TerminalPaneRefSchema = z.object({
  windowId: z.string().min(1),
  paneId: z.string().min(1),
});

export const TerminalHistoryParamsSchema = TerminalPaneRefSchema;

export const TerminalSubscribeParamsSchema = TerminalPaneRefSchema.extend({
  sinceSeq: z.number().int().nonnegative().optional(),
  viewport: z
    .object({
      cols: z.number().int().min(1).max(1000),
      rows: z.number().int().min(1).max(1000),
    })
    .optional(),
});

export const TerminalSendParamsSchema = TerminalPaneRefSchema.extend({
  data: z.string(),
});

export const TerminalResizeParamsSchema = TerminalPaneRefSchema.extend({
  cols: z.number().int().min(1).max(1000),
  rows: z.number().int().min(1).max(1000),
});

export const TerminalClearParamsSchema = TerminalPaneRefSchema;
