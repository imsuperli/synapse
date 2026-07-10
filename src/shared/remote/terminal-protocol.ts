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
  cols?: number;
  rows?: number;
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
}).strict();

export const TerminalHistoryParamsSchema = TerminalPaneRefSchema.extend({
  sinceSeq: z.number().int().nonnegative().optional(),
}).strict();

export const TerminalSubscribeParamsSchema = TerminalPaneRefSchema.extend({
  sinceSeq: z.number().int().nonnegative().optional(),
}).strict();

export const TerminalSendParamsSchema = TerminalPaneRefSchema.extend({
  data: z.string(),
});

export const TerminalClearParamsSchema = TerminalPaneRefSchema;
