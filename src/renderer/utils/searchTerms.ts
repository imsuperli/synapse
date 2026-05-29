import type { CanvasWorkspace } from '../../shared/types/canvas';
import type { SSHProfile } from '../../shared/types/ssh';
import type { Window } from '../types/window';
import { getAllPanes } from './layoutHelpers';

export type SearchTermValue = string | number | null | undefined;

export function normalizeSearchTerms(values: SearchTermValue[]): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];

  for (const value of values) {
    const term = String(value ?? '').trim();
    if (!term || seen.has(term)) {
      continue;
    }

    seen.add(term);
    terms.push(term);
  }

  return terms;
}

export function getSSHTargetLabel(profile: SSHProfile): string {
  return `${profile.user}@${profile.host}:${profile.port}`;
}

export function getWindowSearchTerms(
  window: Window,
  options: {
    workingDirectory?: string | null;
  } = {},
): SearchTermValue[] {
  const panes = getAllPanes(window.layout);

  return [
    window.name,
    options.workingDirectory,
    window.gitBranch,
    window.claudeModel,
    window.claudeModelId,
    ...(window.tags ?? []),
    ...(window.projectConfig?.links.flatMap((link) => [link.name, link.url]) ?? []),
    ...panes.flatMap((pane) => [
      pane.cwd,
      pane.command,
      pane.title,
      pane.teamName,
      pane.agentId,
      pane.agentName,
      pane.ssh?.profileId,
      pane.ssh?.host,
      pane.ssh?.port,
      pane.ssh?.user,
      pane.ssh?.remoteCwd,
      pane.ssh?.routingMode ?? (pane.ssh ? 'direct' : undefined),
      pane.ssh?.jumpHostProfileId,
      pane.ssh?.proxyCommand,
      pane.browser?.url,
      pane.code?.rootPath,
      pane.code?.activeFilePath,
      pane.code?.selectedPath,
      ...(pane.code?.openFiles?.map((file) => file.path) ?? []),
      ...(pane.code?.expandedPaths ?? []),
      ...(pane.code?.bookmarks?.flatMap((bookmark) => [bookmark.filePath, bookmark.label]) ?? []),
      ...(pane.code?.breakpoints?.map((breakpoint) => breakpoint.filePath) ?? []),
    ]),
  ];
}

export function getSSHProfileSearchTerms(
  profile: SSHProfile,
  targetLabel = getSSHTargetLabel(profile),
): SearchTermValue[] {
  return [
    profile.name,
    targetLabel,
    `${profile.user}@${profile.host}`,
    profile.host,
    profile.port,
    profile.user,
    profile.defaultRemoteCwd,
    profile.remoteCommand,
    profile.notes,
    profile.routingMode ?? 'direct',
    profile.jumpHostProfileId,
    profile.proxyCommand,
    profile.socksProxyHost,
    profile.socksProxyPort,
    profile.httpProxyHost,
    profile.httpProxyPort,
    ...(profile.tags ?? []),
    ...(profile.forwardedPorts ?? []).flatMap((forwardedPort) => [
      forwardedPort.host,
      forwardedPort.port,
      forwardedPort.targetAddress,
      forwardedPort.targetPort,
      forwardedPort.description,
    ]),
  ];
}

export function getCanvasWorkspaceSearchTerms(canvasWorkspace: CanvasWorkspace): SearchTermValue[] {
  return [
    canvasWorkspace.name,
    canvasWorkspace.workingDirectory,
    ...canvasWorkspace.blocks.map((block) => block.label ?? ''),
    ...canvasWorkspace.blocks.flatMap((block) => block.type === 'note' ? [block.content] : []),
    ...(canvasWorkspace.chatDefaults?.contextFilePaths ?? []),
    canvasWorkspace.chatDefaults?.workspaceInstructions,
    canvasWorkspace.exportSettings?.title,
  ];
}
