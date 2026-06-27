import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsPanel } from '../SettingsPanel';
import { I18nProvider } from '../../i18n';

describe('SettingsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.electronAPI.platform = 'win32';
  });

  it('shows and saves the global default shell setting in the general tab', async () => {
    const user = userEvent.setup();
    const settingsResponse = {
      success: true,
      data: {
        language: 'zh-CN',
        ides: [],
        quickNav: { items: [] },
        terminal: {
          useBundledConptyDll: false,
          defaultShellProgram: 'pwsh.exe',
        },
      } as any,
    };
    vi.mocked(window.electronAPI.getSettings)
      .mockResolvedValueOnce(settingsResponse)
      .mockResolvedValueOnce(settingsResponse);
    vi.mocked(window.electronAPI.getAvailableShells).mockResolvedValueOnce({
      success: true,
      data: [
        { command: 'pwsh.exe', path: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe', isDefault: true },
        { command: 'powershell.exe', path: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', isDefault: false },
        { command: 'cmd.exe', path: 'C:\\Windows\\System32\\cmd.exe', isDefault: false },
      ],
    });
    vi.mocked(window.electronAPI.selectExecutableFile).mockResolvedValueOnce({
      success: true,
      data: 'C:\\Shells\\custom-shell.exe',
    });

    render(
      <I18nProvider>
        <SettingsPanel open={true} onClose={() => {}} />
      </I18nProvider>,
    );

    expect(await screen.findByText('(默认)C:\\Program Files\\PowerShell\\7\\pwsh.exe')).toBeInTheDocument();

    await user.click(screen.getByRole('combobox', { name: '全局默认 Shell 程序' }));
    expect(screen.queryByText('C:\\Program Files\\PowerShell\\7\\pwsh.exe')).not.toBeInTheDocument();
    await user.click(await screen.findByText('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'));

    expect(window.electronAPI.updateSettings).toHaveBeenCalledWith({
      terminal: {
        useBundledConptyDll: false,
        defaultShellProgram: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
        fontFamily: '',
        fontSize: 14,
      },
    });

    await user.click(screen.getByRole('button', { name: '自定义' }));

    expect(window.electronAPI.selectExecutableFile).toHaveBeenCalledOnce();
    expect(window.electronAPI.updateSettings).toHaveBeenLastCalledWith({
      terminal: {
        useBundledConptyDll: false,
        defaultShellProgram: 'C:\\Shells\\custom-shell.exe',
        fontFamily: '',
        fontSize: 14,
      },
    });
  });

  it('shows the bundled ConPTY setting on Windows', async () => {
    const user = userEvent.setup();

    render(
      <I18nProvider>
        <SettingsPanel open={true} onClose={() => {}} />
      </I18nProvider>,
    );

    await user.click(screen.getByRole('tab', { name: /高级设置/ }));
    expect(screen.getByText('使用随应用附带的 ConPTY 组件')).toBeInTheDocument();
  });

  it('shows and updates app keyboard shortcuts from the shortcuts tab', async () => {
    const user = userEvent.setup();
    vi.mocked(window.electronAPI.getSettings).mockResolvedValue({
      success: true,
      data: {
        language: 'zh-CN',
        ides: [],
        quickNav: { items: [] },
        terminal: {
          useBundledConptyDll: false,
          defaultShellProgram: '',
        },
        keyboardShortcuts: {
          quickSwitcher: { key: 'Tab', modifiers: ['ctrl'] },
          quickNav: { key: 'Control', doubleTap: true },
        },
      } as any,
    });

    render(
      <I18nProvider>
        <SettingsPanel open={true} onClose={() => {}} />
      </I18nProvider>,
    );

    await user.click(screen.getByRole('tab', { name: '快捷键' }));

    expect(await screen.findByText('应用快捷键')).toBeInTheDocument();
    const quickSwitcherInput = screen.getByLabelText('快速切换面板');
    expect(quickSwitcherInput).toHaveValue('Ctrl+Tab');

    await user.clear(quickSwitcherInput);
    await user.type(quickSwitcherInput, 'Ctrl+P');
    fireEvent.blur(quickSwitcherInput);

    await waitFor(() => {
      expect(window.electronAPI.updateSettings).toHaveBeenCalledWith({
        keyboardShortcuts: {
          quickSwitcher: { key: 'P', modifiers: ['ctrl'] },
          quickNav: { key: 'Control', doubleTap: true },
        },
      });
    });
  });

  it('normalizes double-tap shortcut casing and aliases when saving', async () => {
    const user = userEvent.setup();
    vi.mocked(window.electronAPI.getSettings).mockResolvedValue({
      success: true,
      data: {
        language: 'zh-CN',
        ides: [],
        quickNav: { items: [] },
        terminal: {
          useBundledConptyDll: false,
          defaultShellProgram: '',
        },
        keyboardShortcuts: {
          quickSwitcher: { key: 'Tab', modifiers: ['ctrl'] },
          quickNav: { key: 'Shift', doubleTap: true },
        },
      } as any,
    });

    render(
      <I18nProvider>
        <SettingsPanel open={true} onClose={() => {}} />
      </I18nProvider>,
    );

    await user.click(screen.getByRole('tab', { name: '快捷键' }));
    const quickNavInput = await screen.findByLabelText('快捷导航面板');

    await user.clear(quickNavInput);
    await user.type(quickNavInput, 'Double Ctrl');
    fireEvent.blur(quickNavInput);

    await waitFor(() => {
      expect(window.electronAPI.updateSettings).toHaveBeenCalledWith({
        keyboardShortcuts: {
          quickSwitcher: { key: 'Tab', modifiers: ['ctrl'] },
          quickNav: { key: 'Control', doubleTap: true },
        },
      });
    });
    expect(quickNavInput).toHaveValue('Double Ctrl');
  });

  it('loads and updates appearance settings from the appearance tab', async () => {
    const user = userEvent.setup();
    vi.mocked(window.electronAPI.getSettings).mockResolvedValue({
      success: true,
      data: {
        language: 'zh-CN',
        ides: [],
        quickNav: { items: [] },
        terminal: {
          useBundledConptyDll: false,
          defaultShellProgram: '',
          fontFamily: '',
          fontSize: 14,
        },
        appearance: {
          themeId: 'paper',
          skin: {
            presetId: 'none',
            kind: 'none',
            gradient: 'linear-gradient(135deg, #eee 0%, #ddd 100%)',
            dim: 0.62,
            blur: 0,
            motion: 'none',
          },
          terminalOpacity: 0.94,
          readabilityMode: 'readability',
          reduceMotion: false,
        },
      } as any,
    });

    render(
      <I18nProvider>
        <SettingsPanel open={true} onClose={() => {}} />
      </I18nProvider>,
    );

    await user.click(screen.getByRole('tab', { name: '外观' }));

    expect(await screen.findByText('白昼')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '可读性模式' })).toHaveTextContent('高可读');
    expect(screen.getByRole('combobox', { name: '终端透明度' })).toHaveTextContent('94%');
    expect(screen.getByRole('combobox', { name: '背景遮罩' })).toHaveTextContent('62%');
    expect(screen.getByRole('combobox', { name: '背景模糊' })).toHaveTextContent('0px');
    expect(screen.getByRole('combobox', { name: '皮肤动效' })).toHaveTextContent('静态');
    expect(screen.getByRole('switch', { name: '减少动态效果' })).toHaveAttribute('data-state', 'unchecked');

    await user.click(screen.getByRole('button', { name: /曜黑/ }));

    expect(window.electronAPI.updateSettings).toHaveBeenCalledWith({
      appearance: expect.objectContaining({
        readabilityMode: 'readability',
        terminalOpacity: 0.94,
        reduceMotion: false,
        skin: expect.objectContaining({
          presetId: 'obsidian',
          kind: 'none',
        }),
      }),
    });

    await user.click(screen.getByRole('button', { name: /白昼/ }));

    expect(window.electronAPI.updateSettings).toHaveBeenLastCalledWith({
      appearance: expect.objectContaining({
        skin: expect.objectContaining({
          presetId: 'paper',
          kind: 'none',
          gradient: expect.stringContaining('#ffffff'),
        }),
      }),
    });

    await user.click(screen.getByRole('switch', { name: '减少动态效果' }));

    expect(window.electronAPI.updateSettings).toHaveBeenLastCalledWith({
      appearance: expect.objectContaining({
        reduceMotion: true,
      }),
    });

    await user.click(screen.getByRole('combobox', { name: '背景遮罩' }));
    await user.click(await screen.findByText('42%'));

    expect(window.electronAPI.updateSettings).toHaveBeenLastCalledWith({
      appearance: expect.objectContaining({
        skin: expect.objectContaining({
          dim: 0.42,
        }),
      }),
    });

    await user.click(screen.getByRole('combobox', { name: '背景模糊' }));
    await user.click(await screen.findByText('12px'));

    expect(window.electronAPI.updateSettings).toHaveBeenLastCalledWith({
      appearance: expect.objectContaining({
        skin: expect.objectContaining({
          blur: 12,
        }),
      }),
    });

    await user.click(screen.getByRole('combobox', { name: '皮肤动效' }));
    await user.click(await screen.findByRole('option', { name: '缓慢流动' }));

    expect(window.electronAPI.updateSettings).toHaveBeenLastCalledWith({
      appearance: expect.objectContaining({
        skin: expect.objectContaining({
          motion: 'ambient',
        }),
      }),
    });
  });

  it('supports selecting a custom image skin', async () => {
    const user = userEvent.setup();
    vi.mocked(window.electronAPI.getSettings).mockResolvedValue({
      success: true,
      data: {
        language: 'zh-CN',
        ides: [],
        quickNav: { items: [] },
        appearance: {
          skin: {
            presetId: 'paper',
            kind: 'gradient',
            gradient: 'radial-gradient(circle at 14% 16%, rgba(255, 255, 255, 0.96), transparent 24%), radial-gradient(circle at 82% 18%, rgba(83, 149, 255, 0.10), transparent 30%), linear-gradient(135deg, #ffffff 0%, #f7faff 48%, #ffffff 100%)',
            dim: 0.04,
            blur: 0,
            motion: 'ambient',
          },
        },
      } as any,
    });
    vi.mocked(window.electronAPI.selectImageFile).mockResolvedValue({
      success: true,
      data: 'C:\\Wallpapers\\nebula.png',
    });

    render(
      <I18nProvider>
        <SettingsPanel open={true} onClose={() => {}} />
      </I18nProvider>,
    );

    await user.click(screen.getByRole('tab', { name: '外观' }));
    await user.click(await screen.findByRole('button', { name: '选择图片' }));

    expect(window.electronAPI.selectImageFile).toHaveBeenCalledOnce();
    expect(window.electronAPI.updateSettings).toHaveBeenLastCalledWith({
      appearance: expect.objectContaining({
        skin: expect.objectContaining({
          presetId: 'paper',
          kind: 'image',
          imagePath: 'C:\\Wallpapers\\nebula.png',
        }),
      }),
    });
  });

  it('keeps the selected image path when switching skin presets', async () => {
    const user = userEvent.setup();
    vi.mocked(window.electronAPI.getSettings).mockResolvedValue({
      success: true,
      data: {
        language: 'zh-CN',
        ides: [],
        quickNav: { items: [] },
        appearance: {
          skin: {
            presetId: 'obsidian',
            kind: 'image',
            imagePath: 'C:\\Wallpapers\\nebula.png',
            gradient: 'linear-gradient(135deg, #0b0d11 0%, #1b1f27 58%, #090b0e 100%)',
            dim: 0.16,
            blur: 0,
            motion: 'none',
          },
        },
      } as any,
    });

    render(
      <I18nProvider>
        <SettingsPanel open={true} onClose={() => {}} />
      </I18nProvider>,
    );

    await user.click(screen.getByRole('tab', { name: '外观' }));
    await user.click(await screen.findByRole('button', { name: /白昼/ }));

    expect(window.electronAPI.updateSettings).toHaveBeenLastCalledWith({
      appearance: expect.objectContaining({
        skin: expect.objectContaining({
          presetId: 'paper',
          kind: 'image',
          imagePath: 'C:\\Wallpapers\\nebula.png',
          gradient: expect.stringContaining('#ffffff'),
        }),
      }),
    });
  });

  it('restores the active preset without clearing the preset selection metadata unexpectedly', async () => {
    const user = userEvent.setup();
    vi.mocked(window.electronAPI.getSettings).mockResolvedValue({
      success: true,
      data: {
        language: 'zh-CN',
        ides: [],
        quickNav: { items: [] },
        appearance: {
          skin: {
            presetId: 'paper',
            kind: 'image',
            imagePath: 'C:\\Wallpapers\\paper.png',
            gradient: 'radial-gradient(circle at 14% 16%, rgba(255, 255, 255, 0.96), transparent 24%), radial-gradient(circle at 82% 18%, rgba(83, 149, 255, 0.10), transparent 30%), linear-gradient(135deg, #ffffff 0%, #f7faff 48%, #ffffff 100%)',
            dim: 0.16,
            blur: 0,
            motion: 'none',
          },
        },
      } as any,
    });

    render(
      <I18nProvider>
        <SettingsPanel open={true} onClose={() => {}} />
      </I18nProvider>,
    );

    await user.click(screen.getByRole('tab', { name: '外观' }));
    await user.click(await screen.findByRole('button', { name: '恢复预设' }));

    expect(window.electronAPI.updateSettings).toHaveBeenLastCalledWith({
      appearance: expect.objectContaining({
        skin: expect.objectContaining({
          presetId: 'paper',
          kind: 'gradient',
          imagePath: 'C:\\Wallpapers\\paper.png',
          gradient: expect.stringContaining('#ffffff 0%'),
        }),
      }),
    });
  });

  it('hides the bundled ConPTY setting on macOS', async () => {
    const user = userEvent.setup();
    window.electronAPI.platform = 'darwin';

    render(
      <I18nProvider>
        <SettingsPanel open={true} onClose={() => {}} />
      </I18nProvider>,
    );

    await user.click(screen.getByRole('tab', { name: /高级设置/ }));
    expect(screen.queryByText('使用随应用附带的 ConPTY 组件')).not.toBeInTheDocument();
  });

  it('shows the Claude Agent Teams environment requirement in tmux settings', async () => {
    const user = userEvent.setup();

    render(
      <I18nProvider>
        <SettingsPanel open={true} onClose={() => {}} />
      </I18nProvider>,
    );

    await user.click(screen.getByRole('tab', { name: /高级设置/ }));
    expect(screen.getByText('Claude Agent Teams 环境变量')).toBeInTheDocument();
    expect(screen.getByText('CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1')).toBeInTheDocument();
  });

  it('manages SSH feature settings and trusted hosts in the advanced tab', async () => {
    const user = userEvent.setup();
    vi.mocked(window.electronAPI.getSettings).mockResolvedValue({
      success: true,
      data: {
        language: 'zh-CN',
        ides: [],
        quickNav: { items: [] },
        terminal: {
          useBundledConptyDll: false,
          defaultShellProgram: '',
        },
        features: {
          sshEnabled: true,
        },
      } as any,
    });
    vi.mocked(window.electronAPI.listKnownHosts).mockResolvedValue({
      success: true,
      data: [
        {
          id: 'known-host-1',
          host: 'ssh.example.com',
          port: 22,
          algorithm: 'ssh-ed25519',
          digest: 'SHA256:abc123',
          createdAt: '2026-03-20T12:00:00.000Z',
          updatedAt: '2026-03-21T13:00:00.000Z',
        },
      ],
    });

    render(
      <I18nProvider>
        <SettingsPanel open={true} onClose={() => {}} />
      </I18nProvider>,
    );

    await user.click(screen.getByRole('tab', { name: /高级设置/ }));

    expect(await screen.findByText('SSH 终端')).toBeInTheDocument();
    expect(screen.getByText('ssh.example.com:22')).toBeInTheDocument();
    expect(screen.getByText(/SHA256:abc123/)).toBeInTheDocument();

    await user.click(screen.getByRole('switch', { name: '启用 SSH 终端功能' }));

    expect(window.electronAPI.updateSettings).toHaveBeenCalledWith({
      features: {
        sshEnabled: false,
      },
    });

    await user.click(screen.getByRole('button', { name: '删除 ssh.example.com:22 的主机指纹' }));

    expect(window.electronAPI.removeKnownHost).toHaveBeenCalledWith('known-host-1');
    await waitFor(() => {
      expect(screen.queryByText('ssh.example.com:22')).not.toBeInTheDocument();
    });
  });

  it('renders the chat settings tab inside the settings panel', async () => {
    const user = userEvent.setup();

    render(
      <I18nProvider>
        <SettingsPanel open={true} onClose={() => {}} />
      </I18nProvider>,
    );

    await user.click(screen.getByRole('tab', { name: 'Chat' }));

    expect(await screen.findByText('LLM Providers')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '添加 Provider' })).toBeInTheDocument();
  });

  it('renders the plugin center and supports workspace overrides plus local installs', async () => {
    const user = userEvent.setup();
    const workspaceSettings = {
      language: 'zh-CN',
      ides: [],
      quickNav: { items: [] },
      terminal: {
        useBundledConptyDll: false,
        defaultShellProgram: '',
      },
      statusLine: {
        enabled: true,
        displayLocation: 'both',
        cliFormat: 'full',
        cardFormat: 'full',
        showModel: true,
        showContext: true,
        showCost: true,
        showTime: false,
        showTokens: false,
      },
      plugins: {
        enabledPluginIds: ['acme.java-language'],
        pluginSettings: {
          'acme.java-language': {
            'trace.server': 'verbose',
          },
        },
      },
    } as any;

    vi.mocked(window.electronAPI.getSettings).mockResolvedValue({
      success: true,
      data: workspaceSettings,
    });
    vi.mocked(window.electronAPI.listPlugins).mockResolvedValue({
      success: true,
      data: [
        {
          id: 'acme.java-language',
          name: 'Java Language Support',
          publisher: 'Acme',
          version: '1.0.0',
          source: 'marketplace',
          languages: ['java'],
          installStatus: 'installed',
          runtimeState: 'idle',
          health: 'unknown',
          enabledByDefault: false,
          installPath: '/plugins/acme.java-language/1.0.0',
          manifest: {
            schemaVersion: 1,
            id: 'acme.java-language',
            name: 'Java Language Support',
            publisher: 'Acme',
            version: '1.0.0',
            engines: {
              app: '>=3.0.0',
            },
            capabilities: [
              {
                type: 'language-server',
                languages: ['java'],
                runtime: {
                  type: 'java',
                  entry: 'server/jdtls.jar',
                },
                requirements: [
                  {
                    type: 'java',
                    version: '>=17',
                  },
                ],
              },
            ],
            settingsSchema: {
              'java.home': {
                type: 'string',
                title: 'Java 21+ Runtime Home',
                scope: 'global',
                inputKind: 'directory',
              },
              'trace.server': {
                type: 'enum',
                title: 'Trace Level',
                scope: 'workspace',
                defaultValue: 'off',
                options: [
                  { label: 'Off', value: 'off' },
                  { label: 'Verbose', value: 'verbose' },
                ],
              },
            },
          },
        },
      ],
    });
    vi.mocked(window.electronAPI.getPluginRegistry).mockResolvedValue({
      success: true,
      data: {
        schemaVersion: 1,
        plugins: {
          'acme.java-language': {
            source: 'marketplace',
            installedVersion: '1.0.0',
            installPath: '/plugins/acme.java-language/1.0.0',
            enabledByDefault: false,
            status: 'installed',
          },
        },
        globalPluginSettings: {
          'acme.java-language': {
            'java.home': '/Library/Java/JavaVirtualMachines/jdk-21',
          },
        },
      },
    });
    vi.mocked(window.electronAPI.listPluginCatalog).mockResolvedValue({
      success: true,
      data: [
        {
          id: 'acme.java-language',
          name: 'Java Language Support',
          publisher: 'Acme',
          latestVersion: '1.2.0',
          summary: 'Java language tooling',
          languages: ['java'],
          platforms: [
            {
              os: 'win32',
              arch: 'x64',
              downloadUrl: 'https://example.com/java.zip',
              sha256: 'abc',
            },
          ],
        },
        {
          id: 'acme.python-language',
          name: 'Python Language Support',
          publisher: 'Acme',
          latestVersion: '1.0.0',
          summary: 'Python language tooling',
          languages: ['python'],
          platforms: [
            {
              os: 'win32',
              arch: 'x64',
              downloadUrl: 'https://example.com/python.zip',
              sha256: 'def',
            },
          ],
        },
      ],
    });
    vi.mocked(window.electronAPI.setPluginEnabled).mockResolvedValue({
      success: true,
      data: {
        ...workspaceSettings,
        plugins: {
          ...workspaceSettings.plugins,
          enabledPluginIds: [],
          disabledPluginIds: ['acme.java-language'],
        },
      },
    });
    vi.mocked(window.electronAPI.selectPluginPackage).mockResolvedValue({
      success: true,
      data: '/tmp/acme-python-language.zip',
    });
    vi.mocked(window.electronAPI.selectDirectory).mockResolvedValueOnce({
      success: true,
      data: 'C:\\Program Files\\Java\\jdk-21',
    });
    vi.mocked(window.electronAPI.installLocalPlugin).mockResolvedValue({
      success: true,
      data: {
        id: 'acme.python-language',
        name: 'Python Language Support',
        publisher: 'Acme',
        source: 'sideload',
        installStatus: 'installed',
      } as any,
    });

    render(
      <I18nProvider>
        <SettingsPanel open={true} onClose={() => {}} />
      </I18nProvider>,
    );

    expect(window.electronAPI.listPluginCatalog).not.toHaveBeenCalled();

    await user.click(screen.getByRole('tab', { name: '插件' }));

    expect(await screen.findByRole('heading', { name: 'Java Language Support' })).toBeInTheDocument();
    expect(screen.getByText('Claude StatusLine')).toBeInTheDocument();
    expect(window.electronAPI.listPluginCatalog).not.toHaveBeenCalled();
    expect(window.electronAPI.listPlugins).toHaveBeenCalledWith({
      includeCatalog: false,
      refreshCatalog: false,
    });

    await user.click(screen.getAllByRole('button', { name: '加载目录' })[0]);

    expect(await screen.findByRole('heading', { name: 'Python Language Support' })).toBeInTheDocument();
    expect(window.electronAPI.listPluginCatalog).toHaveBeenCalledTimes(1);
    expect(window.electronAPI.listPlugins).toHaveBeenLastCalledWith({
      includeCatalog: true,
      refreshCatalog: true,
    });

    await user.selectOptions(
      screen.getByLabelText('Java Language Support 工作区启用模式'),
      'disabled',
    );
    expect(window.electronAPI.setPluginEnabled).toHaveBeenCalledWith({
      pluginId: 'acme.java-language',
      enabled: false,
      scope: 'workspace',
    });

    await user.click(screen.getByRole('button', { name: '本地安装插件' }));
    expect(window.electronAPI.selectPluginPackage).toHaveBeenCalledOnce();
    expect(window.electronAPI.installLocalPlugin).toHaveBeenCalledWith({
      filePath: '/tmp/acme-python-language.zip',
      enableByDefault: true,
    });

    await user.click(screen.getByText('展开配置和运行时要求'));
    await user.click(screen.getByRole('button', { name: '浏览 Java 21+ Runtime Home' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Java 21+ Runtime Home')).toHaveValue('C:\\Program Files\\Java\\jdk-21');
    });

    await user.click(screen.getAllByRole('button', { name: '保存' })[0]);

    expect(window.electronAPI.setPluginSettings).toHaveBeenCalledWith({
      pluginId: 'acme.java-language',
      scope: 'global',
      values: {
        'java.home': 'C:\\Program Files\\Java\\jdk-21',
      },
    });
    expect(window.electronAPI.setPluginEnabled).toHaveBeenLastCalledWith({
      pluginId: 'acme.java-language',
      enabled: true,
      scope: 'global',
    });

    await user.click(screen.getByRole('button', { name: '卸载' }));
    expect(window.electronAPI.uninstallPlugin).toHaveBeenCalledWith({
      pluginId: 'acme.java-language',
    });
  });

  it('keeps the plugin center mounted across tab switches', async () => {
    const user = userEvent.setup();

    vi.mocked(window.electronAPI.getSettings).mockResolvedValue({
      success: true,
      data: {
        ides: [],
        plugins: {},
      } as any,
    });
    vi.mocked(window.electronAPI.listPlugins).mockResolvedValue({
      success: true,
      data: [
        {
          id: 'acme.java-language',
          name: 'Java Language Support',
          publisher: 'Acme',
          source: 'marketplace',
          installStatus: 'installed',
          runtimeState: 'idle',
          health: 'unknown',
          enabledByDefault: true,
          manifest: {
            schemaVersion: 1,
            id: 'acme.java-language',
            name: 'Java Language Support',
            publisher: 'Acme',
            version: '1.0.0',
            engines: {
              app: '>=3.0.0',
            },
            capabilities: [],
          },
        },
      ] as any,
    });
    vi.mocked(window.electronAPI.getPluginRegistry).mockResolvedValue({
      success: true,
      data: {
        schemaVersion: 1,
        plugins: {},
        globalPluginSettings: {},
      },
    });

    render(
      <I18nProvider>
        <SettingsPanel open={true} onClose={() => {}} />
      </I18nProvider>,
    );

    await user.click(screen.getByRole('tab', { name: '插件' }));

    await waitFor(() => {
      expect(window.electronAPI.listPlugins).toHaveBeenCalledTimes(1);
    });

    await user.click(screen.getByRole('tab', { name: 'Chat' }));
    await user.click(screen.getByRole('tab', { name: '插件' }));

    expect(window.electronAPI.listPlugins).toHaveBeenCalledTimes(1);
  });

  it('shows MCP visibility and plugin capability summaries in the plugin center', async () => {
    const user = userEvent.setup();

    vi.mocked(window.electronAPI.getSettings).mockResolvedValue({
      success: true,
      data: {
        ides: [],
        plugins: {},
      } as any,
    });
    vi.mocked(window.electronAPI.listPlugins).mockResolvedValue({
      success: true,
      data: [
        {
          id: 'acme.java-language',
          name: 'Java Language Support',
          publisher: 'Acme',
          source: 'marketplace',
          installStatus: 'installed',
          runtimeState: 'idle',
          health: 'unknown',
          enabledByDefault: true,
          manifest: {
            schemaVersion: 1,
            id: 'acme.java-language',
            name: 'Java Language Support',
            publisher: 'Acme',
            version: '1.0.0',
            engines: {
              app: '>=3.0.0',
            },
            capabilities: [
              {
                type: 'language-server',
                languages: ['java'],
                runtime: {
                  type: 'java',
                  entry: 'server/jdtls.jar',
                },
              },
              {
                type: 'command',
                command: 'java.test.run',
                title: 'Run Java Test',
              },
            ],
          },
        },
      ] as any,
    });
    vi.mocked(window.electronAPI.getPluginRegistry).mockResolvedValue({
      success: true,
      data: {
        schemaVersion: 1,
        plugins: {},
        globalPluginSettings: {},
      },
    });
    vi.mocked(window.electronAPI.getMcpServerSnapshots).mockResolvedValue({
      success: true,
      data: [
        {
          serverName: 'filesystem',
          toolCount: 2,
          tools: [
            { serverName: 'filesystem', toolName: 'read_file' },
            { serverName: 'filesystem', toolName: 'write_file' },
          ],
        },
      ],
    });

    render(
      <I18nProvider>
        <SettingsPanel open={true} onClose={() => {}} />
      </I18nProvider>,
    );

    await user.click(screen.getByRole('tab', { name: '插件' }));

    expect(await screen.findByRole('heading', { name: '能力概览' })).toBeInTheDocument();
    expect(screen.getByText('MCP 能力')).toBeInTheDocument();
    expect(screen.getByText('filesystem')).toBeInTheDocument();
    expect(screen.getByText('2 个工具')).toBeInTheDocument();
    expect(screen.getByText('read_file')).toBeInTheDocument();
    expect(screen.getByText('write_file')).toBeInTheDocument();
    expect(screen.getByText('插件能力摘要')).toBeInTheDocument();
    expect(screen.getByText('language-server')).toBeInTheDocument();
    expect(screen.getByText('command')).toBeInTheDocument();
  });

  it('loads and updates SSH clipboard image settings in the advanced tab', async () => {
    const user = userEvent.setup();
    vi.mocked(window.electronAPI.getSettings).mockResolvedValue({
      success: true,
      data: {
        language: 'zh-CN',
        ides: [],
        quickNav: { items: [] },
        terminal: {
          useBundledConptyDll: false,
          defaultShellProgram: '',
        },
        features: {
          sshEnabled: true,
        },
        sshClipboardImage: {
          enabled: true,
          uploadLocation: 'temporary-directory',
          shortcut: 'alt-v',
          customUploadDirectory: '',
          copyRemotePathAfterUpload: true,
          maxUploadBytes: 8 * 1024 * 1024,
        },
      } as any,
    });
    vi.mocked(window.electronAPI.listKnownHosts).mockResolvedValue({
      success: true,
      data: [],
    });

    render(
      <I18nProvider>
        <SettingsPanel open={true} onClose={() => {}} />
      </I18nProvider>,
    );

    await user.click(screen.getByRole('tab', { name: /高级设置/ }));

    expect(await screen.findByText('启用 SSH 图片粘贴上传')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '图片粘贴快捷键' })).toHaveTextContent('Alt+V');
    expect(screen.getByRole('combobox', { name: '上传位置' })).toHaveTextContent('临时缓存目录');
    expect(screen.getByDisplayValue('8')).toBeInTheDocument();

    await user.click(screen.getByRole('combobox', { name: '图片粘贴快捷键' }));
    await user.click(await screen.findByRole('option', { name: 'Ctrl+Alt+V' }));
    expect(window.electronAPI.updateSettings).toHaveBeenLastCalledWith({
      sshClipboardImage: expect.objectContaining({
        shortcut: 'ctrl-alt-v',
      }),
    });

    await user.click(screen.getByRole('switch', { name: '上传成功后自动复制远端路径' }));
    expect(window.electronAPI.updateSettings).toHaveBeenCalledWith({
      sshClipboardImage: expect.objectContaining({
        enabled: true,
        uploadLocation: 'temporary-directory',
        shortcut: 'ctrl-alt-v',
        copyRemotePathAfterUpload: false,
        maxUploadBytes: 8 * 1024 * 1024,
      }),
    });

    await user.click(screen.getByRole('combobox', { name: '上传位置' }));
    await user.click(await screen.findByRole('option', { name: '自定义目录' }));
    expect(window.electronAPI.updateSettings).toHaveBeenLastCalledWith({
      sshClipboardImage: expect.objectContaining({
        uploadLocation: 'custom-directory',
      }),
    });

    const customDirectoryInput = await screen.findByLabelText('自定义目录');
    await user.clear(customDirectoryInput);
    await user.type(customDirectoryInput, '~/uploads/images');
    await waitFor(() => {
      expect(window.electronAPI.updateSettings).toHaveBeenLastCalledWith({
        sshClipboardImage: expect.objectContaining({
          uploadLocation: 'custom-directory',
          customUploadDirectory: '~/uploads/images',
        }),
      });
    });

    const maxSizeInput = screen.getByLabelText('最大图片大小（MB）');
    fireEvent.change(maxSizeInput, { target: { value: '12' } });
    await waitFor(() => {
      expect(window.electronAPI.updateSettings).toHaveBeenLastCalledWith({
        sshClipboardImage: expect.objectContaining({
          maxUploadBytes: 12 * 1024 * 1024,
        }),
      });
    });
  });

  it('defaults the SSH image shortcut to Ctrl+V on macOS when settings are missing', async () => {
    const user = userEvent.setup();
    window.electronAPI.platform = 'darwin';
    vi.mocked(window.electronAPI.getSettings).mockResolvedValue({
      success: true,
      data: {
        language: 'zh-CN',
        ides: [],
        quickNav: { items: [] },
        terminal: {
          useBundledConptyDll: false,
          defaultShellProgram: '',
        },
        features: {
          sshEnabled: true,
        },
      } as any,
    });
    vi.mocked(window.electronAPI.listKnownHosts).mockResolvedValue({
      success: true,
      data: [],
    });

    render(
      <I18nProvider>
        <SettingsPanel open={true} onClose={() => {}} />
      </I18nProvider>,
    );

    await user.click(screen.getByRole('tab', { name: /高级设置/ }));

    expect(await screen.findByRole('combobox', { name: '图片粘贴快捷键' })).toHaveTextContent('Ctrl+V');
  });

  it('shows browser sync profiles and syncs an explicit browser profile from advanced settings', async () => {
    const user = userEvent.setup();
    window.electronAPI.platform = 'darwin';
    vi.mocked(window.electronAPI.getSettings).mockResolvedValue({
      success: true,
      data: {
        language: 'zh-CN',
        ides: [],
        quickNav: { items: [] },
        terminal: {
          useBundledConptyDll: false,
          defaultShellProgram: '',
        },
        features: {
          sshEnabled: true,
        },
      } as any,
    });
    vi.mocked(window.electronAPI.listKnownHosts).mockResolvedValue({
      success: true,
      data: [],
    });
    vi.mocked(window.electronAPI.listBrowserSyncProfiles).mockResolvedValue({
      success: true,
      data: [
        {
          id: 'Profile 1',
          name: 'Work',
          email: 'work@example.com',
          source: 'chrome',
          supported: true,
        },
      ],
    });
    vi.mocked(window.electronAPI.getBrowserSyncState).mockResolvedValue({
      success: true,
      data: {
        enabled: false,
        platformSupported: true,
      },
    });
    vi.mocked(window.electronAPI.syncBrowserProfile).mockResolvedValue({
      success: true,
      data: {
        enabled: true,
        platformSupported: true,
        profileId: 'Profile 1',
        profileName: 'Work',
        lastSyncedAt: '2026-05-04T10:30:00.000Z',
        lastSyncCount: 24,
      },
    });

    render(
      <I18nProvider>
        <SettingsPanel open={true} onClose={() => {}} />
      </I18nProvider>,
    );

    await user.click(screen.getByRole('tab', { name: /高级设置/ }));

    expect(await screen.findByText('浏览器登录态同步')).toBeInTheDocument();
    expect(screen.getByText('Work')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '同步' }));

    await waitFor(() => {
      expect(window.electronAPI.syncBrowserProfile).toHaveBeenCalledWith('Profile 1');
      expect(window.electronAPI.updateSettings).toHaveBeenCalledWith({
        browserSync: {
          enabled: true,
          source: 'chrome',
          profileId: 'Profile 1',
        },
      });
    });
  });
});
