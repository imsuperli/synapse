import { describe, expect, it } from 'vitest'
import { buildTerminalCreateParams } from './terminal-create'

describe('mobile terminal creation form', () => {
  it('builds a trimmed local creation request and omits blank optional fields', () => {
    expect(buildTerminalCreateParams({
      backend: 'local',
      workingDirectory: '  C:\\work\\synapse  ',
      name: '  Mobile shell  ',
      command: '   '
    })).toEqual({
      backend: 'local',
      workingDirectory: 'C:\\work\\synapse',
      name: 'Mobile shell'
    })
  })

  it('builds an SSH request using only the selected desktop profile id', () => {
    expect(buildTerminalCreateParams({
      backend: 'ssh',
      profileId: '  profile-1  ',
      workingDirectory: '  /srv/app  ',
      name: '',
      command: '  tmux attach  '
    })).toEqual({
      backend: 'ssh',
      profileId: 'profile-1',
      workingDirectory: '/srv/app',
      command: 'tmux attach'
    })
  })

  it('rejects missing paths and missing SSH profile selection', () => {
    expect(buildTerminalCreateParams({
      backend: 'local',
      workingDirectory: '   ',
      name: '',
      command: ''
    })).toBeNull()
    expect(buildTerminalCreateParams({
      backend: 'ssh',
      profileId: '',
      workingDirectory: '~',
      name: '',
      command: ''
    })).toBeNull()
  })
})
