import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CreateWindowDialog } from '../CreateWindowDialog'
import { useWindowStore } from '../../stores/windowStore'

const mockElectronAPI = {
  getSettings: vi.fn(),
  getAvailableShells: vi.fn(),
  validatePath: vi.fn(),
  selectDirectory: vi.fn(),
  selectExecutableFile: vi.fn(),
  createWindow: vi.fn(),
  detectLocalSSHPrivateKeys: vi.fn(),
  createSSHProfile: vi.fn(),
  updateSSHProfile: vi.fn(),
  getSSHCredentialState: vi.fn(),
  setSSHPassword: vi.fn(),
  clearSSHPassword: vi.fn(),
  setSSHPrivateKeyPassphrase: vi.fn(),
  clearSSHPrivateKeyPassphrase: vi.fn(),
  triggerAutoSave: vi.fn(),
}

Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true,
})

function createWindowResponse() {
  const paneId = 'pane-1'

  return {
    success: true,
    data: {
      id: 'window-1',
      name: 'Test Window',
      layout: {
        type: 'pane',
        id: paneId,
        pane: {
          id: paneId,
          cwd: '/test/path',
          command: 'pwsh.exe',
          status: 'paused',
          pid: null,
        },
      },
      activePaneId: paneId,
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    },
  }
}

function createSSHProfileResponse() {
  return {
    success: true,
    data: {
      id: 'ssh-profile-1',
      name: 'Prod Ubuntu',
      host: 'example.com',
      port: 22,
      user: 'root',
      auth: 'password',
      privateKeys: [],
      keepaliveInterval: 30,
      keepaliveCountMax: 3,
      readyTimeout: null,
      verifyHostKeys: true,
      x11: false,
      skipBanner: false,
      agentForward: false,
      warnOnClose: true,
      reuseSession: true,
      forwardedPorts: [],
      tags: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  }
}

describe('CreateWindowDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useWindowStore.setState({ windows: [], activeWindowId: null })
    mockElectronAPI.getSettings.mockResolvedValue({
      success: true,
      data: {
        terminal: {
          defaultShellProgram: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
        },
      },
    })
    mockElectronAPI.getAvailableShells.mockResolvedValue({
      success: true,
      data: [
        { command: 'pwsh.exe', path: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe', isDefault: true },
        { command: 'powershell.exe', path: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', isDefault: false },
        { command: 'cmd.exe', path: 'C:\\Windows\\System32\\cmd.exe', isDefault: false },
      ],
    })
    mockElectronAPI.validatePath.mockResolvedValue({ success: true, data: true })
    mockElectronAPI.selectDirectory.mockResolvedValue({ success: true, data: '/selected/path' })
    mockElectronAPI.selectExecutableFile.mockResolvedValue({ success: true, data: 'C:\\Shells\\custom-shell.exe' })
    mockElectronAPI.createWindow.mockResolvedValue(createWindowResponse())
    mockElectronAPI.detectLocalSSHPrivateKeys.mockResolvedValue({ success: true, data: [] })
    mockElectronAPI.createSSHProfile.mockResolvedValue(createSSHProfileResponse())
    mockElectronAPI.updateSSHProfile.mockResolvedValue(createSSHProfileResponse())
    mockElectronAPI.getSSHCredentialState.mockResolvedValue({ success: true, data: { hasPassword: true, hasPassphrase: false } })
    mockElectronAPI.setSSHPassword.mockResolvedValue({ success: true })
    mockElectronAPI.clearSSHPassword.mockResolvedValue({ success: true })
    mockElectronAPI.setSSHPrivateKeyPassphrase.mockResolvedValue({ success: true })
    mockElectronAPI.clearSSHPrivateKeyPassphrase.mockResolvedValue({ success: true })
  })

  it('renders the unified create dialog and shows the global default shell path', async () => {
    render(<CreateWindowDialog open={true} onOpenChange={() => {}} sshEnabled={true} />)

    expect(screen.getByText('新建终端或 SSH 连接')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /本地终端/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /SSH 连接/ })).toBeInTheDocument()
    expect(screen.getByLabelText(/窗口名称/)).toBeInTheDocument()
    expect(screen.getByLabelText(/工作目录/)).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: /Shell 程序/ })).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getAllByText('(默认)C:\\Program Files\\PowerShell\\7\\pwsh.exe').length).toBeGreaterThan(0)
    })

    const dialog = screen.getByRole('dialog')
    expect(dialog.className).toContain('!w-[min(760px,94vw)]')
    expect(dialog.className).toContain('!max-w-none')

    const user = userEvent.setup()
    await user.click(screen.getByRole('combobox', { name: /Shell 程序/ }))
    expect(screen.queryByText('C:\\Program Files\\PowerShell\\7\\pwsh.exe')).not.toBeInTheDocument()
  })

  it('shows an error when the working directory is invalid', async () => {
    mockElectronAPI.validatePath.mockResolvedValue({ success: true, data: false })

    render(<CreateWindowDialog open={true} onOpenChange={() => {}} />)

    fireEvent.change(screen.getByLabelText(/工作目录/), { target: { value: '/invalid/path' } })

    await waitFor(() => {
      expect(screen.getByText('路径不存在')).toBeInTheDocument()
    })
  })

  it('fills the working directory from the folder picker', async () => {
    render(<CreateWindowDialog open={true} onOpenChange={() => {}} />)

    fireEvent.click(screen.getByText('浏览'))

    await waitFor(() => {
      expect(mockElectronAPI.selectDirectory).toHaveBeenCalledOnce()
    })

    expect(screen.getByLabelText(/工作目录/)).toHaveValue('/selected/path')
  })

  it('submits the selected scanned shell path when creating a window', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(<CreateWindowDialog open={true} onOpenChange={onOpenChange} />)

    await act(async () => {
      fireEvent.change(screen.getByLabelText(/窗口名称/), { target: { value: 'Test Window' } })
      fireEvent.change(screen.getByLabelText(/工作目录/), { target: { value: '/test/path' } })
    })

    await user.click(screen.getByRole('combobox', { name: /Shell 程序/ }))
    await user.click(await screen.findByRole('option', { name: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe' }))

    await waitFor(() => {
      expect(mockElectronAPI.validatePath).toHaveBeenCalledWith('/test/path')
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /创建/ }))
    })

    await waitFor(() => {
      expect(mockElectronAPI.createWindow).toHaveBeenCalledWith({
        name: 'Test Window',
        workingDirectory: '/test/path',
        command: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      })
    })

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('falls back to the global default shell when the field is left on auto', async () => {
    const onOpenChange = vi.fn()
    render(<CreateWindowDialog open={true} onOpenChange={onOpenChange} />)

    await act(async () => {
      fireEvent.change(screen.getByLabelText(/工作目录/), { target: { value: '/test/path' } })
    })

    await waitFor(() => {
      expect(mockElectronAPI.validatePath).toHaveBeenCalledWith('/test/path')
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /创建/ }))
    })

    await waitFor(() => {
      expect(mockElectronAPI.createWindow).toHaveBeenCalledWith({
        name: undefined,
        workingDirectory: '/test/path',
        command: undefined,
      })
    })

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('calls onLocalWindowCreated after creating a local window', async () => {
    const onOpenChange = vi.fn()
    const onLocalWindowCreated = vi.fn()

    render(
      <CreateWindowDialog
        open={true}
        onOpenChange={onOpenChange}
        onLocalWindowCreated={onLocalWindowCreated}
      />,
    )

    await act(async () => {
      fireEvent.change(screen.getByLabelText(/工作目录/), { target: { value: '/test/path' } })
    })

    await waitFor(() => {
      expect(mockElectronAPI.validatePath).toHaveBeenCalledWith('/test/path')
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /创建/ }))
    })

    await waitFor(() => {
      expect(onLocalWindowCreated).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'window-1', name: 'Test Window' }),
      )
    })

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('opens the custom shell picker and still allows creating a window', async () => {
    render(<CreateWindowDialog open={true} onOpenChange={() => {}} />)

    await act(async () => {
      fireEvent.change(screen.getByLabelText(/工作目录/), { target: { value: '/test/path' } })
    })

    await waitFor(() => {
      expect(mockElectronAPI.validatePath).toHaveBeenCalledWith('/test/path')
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '自定义' }))
      await mockElectronAPI.selectExecutableFile.mock.results[0]?.value
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(mockElectronAPI.selectExecutableFile).toHaveBeenCalledOnce()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /创建/ }))
    })

    await waitFor(() => {
      expect(mockElectronAPI.createWindow).toHaveBeenCalledWith(expect.objectContaining({
        name: undefined,
        workingDirectory: '/test/path',
      }))
    })
  })

  it('supports a local-only canvas entry flow with initial working directory and creation callback', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const onLocalWindowCreated = vi.fn()

    render(
      <CreateWindowDialog
        open={true}
        onOpenChange={onOpenChange}
        availableTabs={['local']}
        initialTab="local"
        initialWorkingDirectory="/canvas/project"
        onLocalWindowCreated={onLocalWindowCreated}
      />,
    )

    expect(screen.queryByRole('tab', { name: /SSH 连接/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /画布工作区/ })).not.toBeInTheDocument()
    expect(screen.getByLabelText(/工作目录/)).toHaveValue('/canvas/project')

    await waitFor(() => {
      expect(mockElectronAPI.validatePath).toHaveBeenCalledWith('/canvas/project')
    })

    await user.click(screen.getByRole('button', { name: /创建/ }))

    await waitFor(() => {
      expect(onLocalWindowCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 'window-1' }))
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('marks local windows created for a canvas as canvas-owned before adding them to the store', async () => {
    const user = userEvent.setup()
    const onLocalWindowCreated = vi.fn()

    render(
      <CreateWindowDialog
        open={true}
        onOpenChange={() => {}}
        availableTabs={['local']}
        initialTab="local"
        initialWorkingDirectory="/canvas/project"
        localWindowOwnerCanvasWorkspaceId="canvas-1"
        onLocalWindowCreated={onLocalWindowCreated}
      />,
    )

    await waitFor(() => {
      expect(mockElectronAPI.validatePath).toHaveBeenCalledWith('/canvas/project')
    })

    await user.click(screen.getByRole('button', { name: /创建/ }))

    await waitFor(() => {
      expect(onLocalWindowCreated).toHaveBeenCalledWith(expect.objectContaining({
        id: 'window-1',
        ownerType: 'canvas-owned',
        ownerCanvasWorkspaceId: 'canvas-1',
      }))
    })
    expect(useWindowStore.getState().getWindowById('window-1')).toMatchObject({
      ownerType: 'canvas-owned',
      ownerCanvasWorkspaceId: 'canvas-1',
    })
  })

  it('filters out ssh tab from constrained canvas flow when ssh is disabled', async () => {
    render(
      <CreateWindowDialog
        open={true}
        onOpenChange={() => {}}
        availableTabs={['local', 'ssh']}
        initialTab="local"
        sshEnabled={false}
      />,
    )

    await waitFor(() => {
      expect(mockElectronAPI.getAvailableShells).toHaveBeenCalled()
    })

    expect(screen.getByLabelText(/工作目录/)).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /SSH 连接/ })).not.toBeInTheDocument()
  })

  it('keeps mode tabs and footer actions on a single row structure for constrained widths', async () => {
    render(
      <CreateWindowDialog
        open={true}
        onOpenChange={() => {}}
        sshEnabled={true}
      />,
    )

    await waitFor(() => {
      expect(mockElectronAPI.getAvailableShells).toHaveBeenCalled()
    })

    const tabList = screen.getByRole('tablist', { name: /创建类型/ })
    expect(tabList.className).toContain('overflow-x-auto')

    const localTab = screen.getByRole('tab', { name: /本地终端/ })
    expect(localTab.className).toContain('shrink-0')

    const createButton = screen.getByRole('button', { name: /^创建$/ })
    const cancelButton = screen.getByRole('button', { name: '取消' })
    expect(createButton.className).toContain('whitespace-nowrap')
    expect(cancelButton.className).toContain('whitespace-nowrap')
    expect(createButton.className).toContain('w-full')
    expect(cancelButton.className).toContain('w-full')
  })

  it('creates an ssh profile from the grouped ssh tabs', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const onSSHProfileSaved = vi.fn()

    render(
      <CreateWindowDialog
        open={true}
        onOpenChange={onOpenChange}
        sshEnabled={true}
        sshProfiles={[]}
        onSSHProfileSaved={onSSHProfileSaved}
      />,
    )

    await user.click(screen.getByRole('tab', { name: /SSH 连接/ }))

    expect(screen.getByLabelText(/连接名称/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/连接名称/), { target: { value: 'Prod Ubuntu' } })
    fireEvent.change(screen.getByLabelText(/主机地址/), { target: { value: 'example.com' } })
    fireEvent.change(screen.getByLabelText(/^用户名/), { target: { value: 'root' } })
    await user.click(screen.getByRole('tab', { name: '认证' }))
    fireEvent.change(screen.getByLabelText(/密码 \/ 交互认证密钥/), { target: { value: 'secret' } })

    await user.click(screen.getByRole('button', { name: /保存 SSH 连接/ }))

    await waitFor(() => {
      expect(mockElectronAPI.createSSHProfile).toHaveBeenCalledWith(expect.objectContaining({
        name: 'Prod Ubuntu',
        host: 'example.com',
        port: 22,
        user: 'root',
        auth: 'password',
        verifyHostKeys: true,
        reuseSession: true,
        warnOnClose: true,
        x11: false,
        forwardedPorts: [],
      }))
    })

    expect(mockElectronAPI.setSSHPassword).toHaveBeenCalledWith('ssh-profile-1', 'secret')
    expect(onSSHProfileSaved).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'ssh-profile-1', name: 'Prod Ubuntu' }),
      { hasPassword: true, hasPassphrase: false },
    )
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('can save and immediately connect an ssh profile when requested by canvas flow', async () => {
    const user = userEvent.setup()
    const onSSHProfileSaved = vi.fn()
    const onSSHProfileConnect = vi.fn().mockResolvedValue(undefined)

    render(
      <CreateWindowDialog
        open={true}
        onOpenChange={() => {}}
        sshEnabled={true}
        sshProfiles={[]}
        onSSHProfileSaved={onSSHProfileSaved}
        onSSHProfileConnect={onSSHProfileConnect}
        sshSubmitMode="saveAndConnect"
      />,
    )

    await user.click(screen.getByRole('tab', { name: /SSH 连接/ }))
    const connectionNameInput = await screen.findByLabelText(/连接名称/)
    fireEvent.change(connectionNameInput, { target: { value: 'Prod Ubuntu' } })
    fireEvent.change(screen.getByLabelText(/主机地址/), { target: { value: 'example.com' } })
    fireEvent.change(screen.getByLabelText(/^用户名/), { target: { value: 'root' } })
    fireEvent.click(screen.getByRole('button', { name: /保存并连接 SSH/ }))

    await waitFor(() => {
      expect(onSSHProfileSaved).toHaveBeenCalled()
      expect(onSSHProfileConnect).toHaveBeenCalledWith(expect.objectContaining({
        id: 'ssh-profile-1',
        name: 'Prod Ubuntu',
      }))
    })
  })

  it('creates a canvas workspace and reports it back to the caller', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const onCanvasWorkspaceCreated = vi.fn()

    render(
      <CreateWindowDialog
        open={true}
        onOpenChange={onOpenChange}
        onCanvasWorkspaceCreated={onCanvasWorkspaceCreated}
      />,
    )

    await user.click(screen.getByRole('tab', { name: /画布工作区/ }))
    await user.type(screen.getByLabelText(/工作区名称/), 'Ops Board')
    await user.type(screen.getByLabelText(/默认目录/), '/workspace/ops')
    await user.click(screen.getByRole('button', { name: /^创建$/ }))

    await waitFor(() => {
      expect(onCanvasWorkspaceCreated).toHaveBeenCalledWith(expect.objectContaining({
        name: 'Ops Board',
        workingDirectory: '/workspace/ops',
        blocks: [],
      }))
    })

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(useWindowStore.getState().canvasWorkspaces.some((workspace) => workspace.name === 'Ops Board')).toBe(true)
  })

  it('falls back to the host value when saving an ssh profile without a name', async () => {
    const user = userEvent.setup()

    render(
      <CreateWindowDialog
        open={true}
        onOpenChange={() => {}}
        sshEnabled={true}
        sshProfiles={[]}
      />,
    )

    await user.click(screen.getByRole('tab', { name: /SSH 连接/ }))
    await user.type(screen.getByLabelText(/主机地址/), 'prod.example.com')
    await user.clear(screen.getByLabelText(/^用户名/))
    await user.type(screen.getByLabelText(/^用户名/), 'root')
    await user.click(screen.getByRole('tab', { name: '认证' }))
    await user.type(screen.getByLabelText(/密码 \/ 交互认证密钥/), 'secret')

    await user.click(screen.getByRole('button', { name: /保存 SSH 连接/ }))

    await waitFor(() => {
      expect(mockElectronAPI.createSSHProfile).toHaveBeenCalledWith(expect.objectContaining({
        name: 'prod.example.com',
        host: 'prod.example.com',
        user: 'root',
      }))
    })
  })

  it('allows saving a password-based ssh profile without opening the auth tab', async () => {
    const user = userEvent.setup()

    mockElectronAPI.getSSHCredentialState.mockResolvedValueOnce({
      success: true,
      data: { hasPassword: false, hasPassphrase: false },
    })

    render(
      <CreateWindowDialog
        open={true}
        onOpenChange={() => {}}
        sshEnabled={true}
        sshProfiles={[]}
      />,
    )

    await user.click(screen.getByRole('tab', { name: /SSH 连接/ }))
    await user.type(screen.getByLabelText(/连接名称/), 'Prod Ubuntu')
    await user.type(screen.getByLabelText(/主机地址/), 'example.com')
    await user.clear(screen.getByLabelText(/^用户名/))
    await user.type(screen.getByLabelText(/^用户名/), 'root')

    await user.click(screen.getByRole('button', { name: /保存 SSH 连接/ }))

    await waitFor(() => {
      expect(mockElectronAPI.createSSHProfile).toHaveBeenCalledWith(expect.objectContaining({
        name: 'Prod Ubuntu',
        host: 'example.com',
        user: 'root',
        auth: 'password',
      }))
    })

    expect(mockElectronAPI.setSSHPassword).not.toHaveBeenCalled()
  })

  it('removes the misleading ssh user placeholder and highlights the missing required field', async () => {
    const user = userEvent.setup()

    render(
      <CreateWindowDialog
        open={true}
        onOpenChange={() => {}}
        sshEnabled={true}
        sshProfiles={[]}
      />,
    )

    await user.click(screen.getByRole('tab', { name: /SSH 连接/ }))
    const hostInput = screen.getByLabelText(/主机地址/)
    const userInput = screen.getByLabelText(/^用户名/)

    expect(userInput).not.toHaveAttribute('placeholder')

    await user.type(hostInput, 'example.com')
    await user.click(screen.getByRole('tab', { name: '认证' }))
    await user.click(screen.getByRole('button', { name: /保存 SSH 连接/ }))

    await waitFor(() => {
      const activeHostInput = screen.getByLabelText(/主机地址/)
      const activeUserInput = screen.getByLabelText(/^用户名/)

      expect(screen.getByRole('tab', { name: '基础' })).toHaveAttribute('data-state', 'active')
      expect(mockElectronAPI.createSSHProfile).not.toHaveBeenCalled()
      expect(screen.getByText('请完整填写主机地址和用户名。')).toBeInTheDocument()
      expect(activeHostInput).not.toHaveAttribute('aria-invalid', 'true')
      expect(activeUserInput).toHaveAttribute('aria-invalid', 'true')
      expect(activeHostInput.className).not.toContain('border-status-error')
      expect(activeUserInput.className).toContain('border-status-error')
    })
  })

  it('prefills duplicated ssh profiles with a copy-prefixed name', async () => {
    const user = userEvent.setup()
    const sourceProfile = {
      id: 'ssh-profile-source',
      name: 'Prod Ubuntu',
      host: 'old.example.com',
      port: 22,
      user: 'root',
      auth: 'password',
      privateKeys: [],
      keepaliveInterval: 30,
      keepaliveCountMax: 3,
      readyTimeout: null,
      verifyHostKeys: true,
      x11: false,
      skipBanner: false,
      agentForward: false,
      warnOnClose: true,
      reuseSession: true,
      forwardedPorts: [],
      tags: ['prod'],
      notes: 'existing notes',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as const

    mockElectronAPI.getSSHCredentialState.mockResolvedValueOnce({
      success: true,
      data: { hasPassword: false, hasPassphrase: false },
    })

    render(
      <CreateWindowDialog
        open={true}
        onOpenChange={() => {}}
        sshEnabled={true}
        sshProfiles={[sourceProfile as any]}
        initialSSHProfile={sourceProfile as any}
      />,
    )

    expect(screen.getByLabelText(/连接名称/)).toHaveValue('copy-Prod Ubuntu')
    expect(screen.getByLabelText(/主机地址/)).toHaveValue('old.example.com')
    expect(screen.getByLabelText(/^用户名/)).toHaveValue('root')

    await user.click(screen.getByRole('button', { name: /保存 SSH 连接/ }))

    await waitFor(() => {
      expect(mockElectronAPI.createSSHProfile).toHaveBeenCalledWith(expect.objectContaining({
        name: 'copy-Prod Ubuntu',
        host: 'old.example.com',
        user: 'root',
        tags: ['prod'],
        notes: 'existing notes',
      }))
    })

    expect(mockElectronAPI.updateSSHProfile).not.toHaveBeenCalled()
  })

  it('updates an existing ssh profile in the same dialog instead of creating a new one', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const onSSHProfileSaved = vi.fn()
    const existingProfile = {
      id: 'ssh-profile-1',
      name: 'Prod Ubuntu',
      host: 'old.example.com',
      port: 22,
      user: 'root',
      auth: 'password',
      privateKeys: [],
      keepaliveInterval: 30,
      keepaliveCountMax: 3,
      readyTimeout: null,
      verifyHostKeys: true,
      x11: false,
      skipBanner: false,
      agentForward: false,
      warnOnClose: true,
      reuseSession: true,
      forwardedPorts: [],
      tags: ['prod'],
      notes: 'existing notes',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as const

    render(
      <CreateWindowDialog
        open={true}
        onOpenChange={onOpenChange}
        sshEnabled={true}
        sshProfiles={[existingProfile as any]}
        editingSSHProfile={existingProfile as any}
        sshCredentialState={{ hasPassword: true, hasPassphrase: false }}
        onSSHProfileSaved={onSSHProfileSaved}
      />,
    )

    expect(screen.getByText('编辑 SSH 连接')).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /本地终端/ })).toBeNull()

    await user.clear(screen.getByLabelText(/主机地址/))
    await user.type(screen.getByLabelText(/主机地址/), 'new.example.com')
    await user.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => {
      expect(mockElectronAPI.updateSSHProfile).toHaveBeenCalledWith('ssh-profile-1', expect.objectContaining({
        name: 'Prod Ubuntu',
        host: 'new.example.com',
        routingMode: 'direct',
        tags: ['prod'],
        notes: 'existing notes',
      }))
    })

    expect(mockElectronAPI.createSSHProfile).not.toHaveBeenCalled()
    expect(onSSHProfileSaved).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'ssh-profile-1', host: 'example.com' }),
      { hasPassword: true, hasPassphrase: false },
    )
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('preserves inactive ssh route details when editing the active route to direct', async () => {
    const user = userEvent.setup()
    const existingProfile = {
      id: 'ssh-profile-1',
      name: 'Prod Ubuntu',
      host: 'old.example.com',
      port: 22,
      user: 'root',
      auth: 'password',
      privateKeys: [],
      keepaliveInterval: 30,
      keepaliveCountMax: 3,
      readyTimeout: null,
      verifyHostKeys: true,
      x11: false,
      skipBanner: false,
      routingMode: 'jumpHost',
      jumpHostProfileId: 'jump-1',
      proxyCommand: 'ssh -W %h:%p bastion',
      agentForward: false,
      warnOnClose: true,
      reuseSession: true,
      forwardedPorts: [],
      tags: ['prod'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as const
    const jumpProfile = {
      ...existingProfile,
      id: 'jump-1',
      name: 'Bastion',
      host: 'bastion.example.com',
      routingMode: 'direct',
      jumpHostProfileId: undefined,
      proxyCommand: undefined,
    } as const

    render(
      <CreateWindowDialog
        open={true}
        onOpenChange={() => {}}
        sshEnabled={true}
        sshProfiles={[existingProfile as any, jumpProfile as any]}
        editingSSHProfile={existingProfile as any}
        sshCredentialState={{ hasPassword: true, hasPassphrase: false }}
      />,
    )

    await user.click(screen.getByRole('tab', { name: '路由' }))

    expect(screen.getByText('当前启用：跳板机')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: '直接连接，可切换' }))
    await user.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => {
      expect(mockElectronAPI.updateSSHProfile).toHaveBeenCalledWith('ssh-profile-1', expect.objectContaining({
        routingMode: 'direct',
        jumpHostProfileId: 'jump-1',
        proxyCommand: 'ssh -W %h:%p bastion',
      }))
    })
  })

  it('does not block direct saves when inactive proxy port input is temporarily empty', async () => {
    const user = userEvent.setup()
    const existingProfile = {
      id: 'ssh-profile-1',
      name: 'Prod Ubuntu',
      host: 'old.example.com',
      port: 22,
      user: 'root',
      auth: 'password',
      privateKeys: [],
      keepaliveInterval: 30,
      keepaliveCountMax: 3,
      readyTimeout: null,
      verifyHostKeys: true,
      x11: false,
      skipBanner: false,
      routingMode: 'socks',
      socksProxyHost: '127.0.0.1',
      socksProxyPort: 1080,
      agentForward: false,
      warnOnClose: true,
      reuseSession: true,
      forwardedPorts: [],
      tags: ['prod'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as const

    render(
      <CreateWindowDialog
        open={true}
        onOpenChange={() => {}}
        sshEnabled={true}
        sshProfiles={[existingProfile as any]}
        editingSSHProfile={existingProfile as any}
        sshCredentialState={{ hasPassword: true, hasPassphrase: false }}
      />,
    )

    await user.click(screen.getByRole('tab', { name: '路由' }))
    await user.clear(screen.getByLabelText('代理端口'))
    await user.click(screen.getByRole('tab', { name: '直接连接，可切换' }))
    await user.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => {
      expect(mockElectronAPI.updateSSHProfile).toHaveBeenCalledWith('ssh-profile-1', expect.objectContaining({
        routingMode: 'direct',
        socksProxyHost: '127.0.0.1',
        socksProxyPort: undefined,
      }))
    })
  })
})
