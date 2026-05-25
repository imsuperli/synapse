import { v4 as uuidv4 } from 'uuid';
import type {
  CanvasTemplateBlockDefinition,
  CanvasWindowDraftKind,
} from '../../shared/types/canvas';
import type { SSHProfile } from '../../shared/types/ssh';
import type { Pane, Window } from '../types/window';
import { WindowStatus } from '../types/window';
import { createBrowserPaneDraft, DEFAULT_BROWSER_URL } from './browserPane';
import { createChatPaneDraft } from './chatPane';
import { createCodePaneDraft } from './codePane';

function createWindowWithSinglePane(name: string, pane: Pane, kind: Window['kind'] = 'local'): Window {
  const windowId = uuidv4();
  const now = new Date().toISOString();

  return {
    id: windowId,
    name,
    layout: {
      type: 'pane',
      id: pane.id,
      pane,
    },
    activePaneId: pane.id,
    createdAt: now,
    lastActiveAt: now,
    kind,
  };
}

export function createCanvasLocalWindowDraft(options?: {
  name?: string;
  workingDirectory?: string;
  command?: string;
}): Window {
  const paneId = uuidv4();
  const cwd = options?.workingDirectory?.trim() || '';
  const command = options?.command?.trim() || '';

  return createWindowWithSinglePane(
    options?.name?.trim() || 'Local terminal',
    {
      id: paneId,
      cwd,
      command,
      status: WindowStatus.Completed,
      pid: null,
      backend: 'local',
    },
    'local',
  );
}

export function createCanvasSSHWindowDraft(profile: SSHProfile, options?: {
  name?: string;
  remoteCwd?: string;
  command?: string;
}): Window {
  const paneId = uuidv4();
  const cwd = options?.remoteCwd?.trim() || profile.defaultRemoteCwd?.trim() || '~';

  return createWindowWithSinglePane(
    options?.name?.trim() || profile.name,
    {
      id: paneId,
      cwd,
      command: options?.command?.trim() || profile.remoteCommand?.trim() || '',
      status: WindowStatus.Completed,
      pid: null,
      backend: 'ssh',
      ssh: {
        profileId: profile.id,
        host: profile.host,
        port: profile.port,
        user: profile.user,
        authType: profile.auth,
        remoteCwd: cwd,
        ...(profile.routingMode && profile.routingMode !== 'direct' ? { routingMode: profile.routingMode } : {}),
        jumpHostProfileId: profile.jumpHostProfileId,
        proxyCommand: profile.proxyCommand,
        reuseSession: profile.reuseSession,
      },
    },
    'ssh',
  );
}

export function createCanvasCodeWindowDraft(options?: {
  name?: string;
  rootPath?: string;
}): Window {
  const paneId = uuidv4();
  const rootPath = options?.rootPath?.trim() || '';

  return createWindowWithSinglePane(
    options?.name?.trim() || 'Code workspace',
    createCodePaneDraft(paneId, rootPath || '/'),
    'local',
  );
}

export function createCanvasBrowserWindowDraft(options?: {
  name?: string;
  url?: string;
}): Window {
  const paneId = uuidv4();
  const url = options?.url?.trim() || DEFAULT_BROWSER_URL;

  return createWindowWithSinglePane(
    options?.name?.trim() || 'Browser',
    createBrowserPaneDraft(paneId, url),
    'local',
  );
}

export function createCanvasChatWindowDraft(options?: {
  name?: string;
  linkedPaneId?: string;
}): Window {
  const paneId = uuidv4();

  return createWindowWithSinglePane(
    options?.name?.trim() || 'AI Chat',
    createChatPaneDraft(paneId, {
      linkedPaneId: options?.linkedPaneId,
    }),
    'local',
  );
}

export function createCanvasWindowDraft(
  kind: CanvasWindowDraftKind,
  options?: {
    name?: string;
    workingDirectory?: string;
    command?: string;
    url?: string;
    linkedPaneId?: string;
    sshProfile?: SSHProfile;
    ownerCanvasWorkspaceId?: string;
  },
): Window {
  let windowDraft: Window;

  switch (kind) {
    case 'local':
      windowDraft = createCanvasLocalWindowDraft({
        name: options?.name,
        workingDirectory: options?.workingDirectory,
        command: options?.command,
      });
      break;
    case 'ssh':
      if (!options?.sshProfile) {
        throw new Error('SSH profile is required to create an SSH canvas window.');
      }
      windowDraft = createCanvasSSHWindowDraft(options.sshProfile, {
        name: options.name,
        remoteCwd: options.workingDirectory,
        command: options.command,
      });
      break;
    case 'code':
      windowDraft = createCanvasCodeWindowDraft({
        name: options?.name,
        rootPath: options?.workingDirectory,
      });
      break;
    case 'browser':
      windowDraft = createCanvasBrowserWindowDraft({
        name: options?.name,
        url: options?.url,
      });
      break;
    case 'chat':
      windowDraft = createCanvasChatWindowDraft({
        name: options?.name,
        linkedPaneId: options?.linkedPaneId,
      });
      break;
    default:
      windowDraft = createCanvasLocalWindowDraft({
        name: options?.name,
        workingDirectory: options?.workingDirectory,
        command: options?.command,
      });
      break;
  }

  if (options?.ownerCanvasWorkspaceId?.trim()) {
    windowDraft.ownerType = 'canvas-owned';
    windowDraft.ownerCanvasWorkspaceId = options.ownerCanvasWorkspaceId.trim();
  }

  return windowDraft;
}

export function inferCanvasWindowDraftKind(windowItem: Window): CanvasWindowDraftKind {
  if (windowItem.layout.type !== 'pane') {
    return 'local';
  }

  const pane = windowItem.layout.pane;
  if (pane.kind === 'code') {
    return 'code';
  }
  if (pane.kind === 'browser') {
    return 'browser';
  }
  if (pane.kind === 'chat') {
    return 'chat';
  }
  if (pane.backend === 'ssh') {
    return 'ssh';
  }
  return 'local';
}

export function createCanvasTemplateWindowFromDefinition(
  definition: CanvasTemplateBlockDefinition,
  options?: {
    sshProfiles?: SSHProfile[];
  },
): Window | null {
  switch (definition.kind) {
    case 'local':
      return createCanvasLocalWindowDraft({
        name: definition.label,
        workingDirectory: definition.workingDirectory,
        command: definition.command,
      });
    case 'code':
      return createCanvasCodeWindowDraft({
        name: definition.label,
        rootPath: definition.workingDirectory,
      });
    case 'browser':
      return createCanvasBrowserWindowDraft({
        name: definition.label,
        url: definition.url,
      });
    case 'chat':
      return createCanvasChatWindowDraft({
        name: definition.label,
        linkedPaneId: definition.linkedPaneId,
      });
    case 'ssh': {
      const profile = options?.sshProfiles?.find((item) => (
        item.defaultRemoteCwd === definition.workingDirectory || item.name === definition.label
      )) ?? options?.sshProfiles?.[0];

      if (!profile) {
        return null;
      }

      return createCanvasSSHWindowDraft(profile, {
        name: definition.label,
        remoteCwd: definition.workingDirectory,
        command: definition.command,
      });
    }
    default:
      return null;
  }
}
