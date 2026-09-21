import type { WindowCreateParams } from '../../../src/shared/remote/window-protocol'

export type TerminalCreateDraft = {
  backend: 'local' | 'ssh'
  workingDirectory: string
  name: string
  command: string
  profileId?: string
}

function optionalTrimmed(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed || undefined
}

export function buildTerminalCreateParams(
  draft: TerminalCreateDraft
): WindowCreateParams | null {
  const workingDirectory = draft.workingDirectory.trim()
  if (!workingDirectory) {
    return null
  }

  const name = optionalTrimmed(draft.name)
  const command = optionalTrimmed(draft.command)
  const common = {
    ...(name ? { name } : {}),
    ...(command ? { command } : {})
  }

  if (draft.backend === 'local') {
    return {
      ...common,
      backend: 'local',
      workingDirectory
    }
  }

  const profileId = draft.profileId?.trim()
  if (!profileId) {
    return null
  }

  return {
    ...common,
    backend: 'ssh',
    profileId,
    workingDirectory
  }
}
