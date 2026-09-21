import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Switch from '@radix-ui/react-switch';
import {
  ChevronDown,
  Check,
  Download,
  FolderUp,
  LoaderCircle,
  Plug,
  RefreshCw,
  Settings2,
  Trash2,
  Wrench,
} from 'lucide-react';
import type { Settings, StatusLineConfig } from '../../../shared/types/workspace';
import type { McpServerConfigSnapshot } from '../../../shared/types/task';
import type {
  PluginCatalogEntry,
  PluginListItem,
  PluginRequirement,
  PluginRegistry,
  PluginSettingOption,
  PluginSettingSchemaEntry,
  WorkspacePluginSettings,
} from '../../../shared/types/plugin';
import type { TranslationKey, TranslationParams } from '../../i18n';
import { useI18n } from '../../i18n';
import { notifyWorkspaceSettingsUpdated } from '../../utils/settingsEvents';
import {
  idePopupActionButtonClassName,
  idePopupBarePanelClassName,
  idePopupCardClassName,
  idePopupEmptyStateClassName,
  idePopupInputClassName,
  idePopupPanelClassName,
  idePopupSecondaryButtonClassName,
  idePopupSubtlePanelClassName,
} from '../ui/ide-popup';
import { CompactHelp, CompactSettingRow, CompactSettingsSection } from './CompactSettings';

type WorkspaceEnableMode = 'inherit' | 'enabled' | 'disabled';
type PluginSettingScope = 'global' | 'workspace';
type TranslateFn = (key: TranslationKey, params?: TranslationParams) => string;
type PluginSettingDrafts = Record<string, {
  global: Record<string, unknown>;
  workspace: Record<string, unknown>;
}>;

interface PluginCenterProps {
  statusLineConfig: StatusLineConfig;
  onToggleStatusLine: (enabled: boolean) => Promise<void>;
  onStatusLineConfigChange: (updates: Partial<StatusLineConfig>) => Promise<void>;
}

export const PluginCenter: React.FC<PluginCenterProps> = ({
  statusLineConfig,
  onToggleStatusLine,
  onStatusLineConfigChange,
}) => {
  const { t } = useI18n();
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [hasLoadedCatalog, setHasLoadedCatalog] = useState(false);
  const [isHydrating, setIsHydrating] = useState(false);
  const [catalogRefreshing, setCatalogRefreshing] = useState(false);
  const [installedPlugins, setInstalledPlugins] = useState<PluginListItem[]>([]);
  const [catalogEntries, setCatalogEntries] = useState<PluginCatalogEntry[]>([]);
  const [pluginRegistry, setPluginRegistry] = useState<PluginRegistry>({
    schemaVersion: 1,
    plugins: {},
    globalPluginSettings: {},
  });
  const [workspacePluginSettings, setWorkspacePluginSettings] = useState<WorkspacePluginSettings>({});
  const [pluginSettingDrafts, setPluginSettingDrafts] = useState<PluginSettingDrafts>({});
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeActionKeys, setActiveActionKeys] = useState<string[]>([]);
  const [mcpSnapshots, setMcpSnapshots] = useState<McpServerConfigSnapshot[]>([]);
  const [isStatusLineExpanded, setIsStatusLineExpanded] = useState(false);
  const [expandedInstalledPluginIds, setExpandedInstalledPluginIds] = useState<string[]>([]);
  const hasLoadedCatalogRef = useRef(hasLoadedCatalog);

  useEffect(() => {
    hasLoadedCatalogRef.current = hasLoadedCatalog;
  }, [hasLoadedCatalog]);

  const loadPluginState = useCallback(async (options: { refreshCatalog?: boolean } = {}) => {
    const refreshCatalog = options.refreshCatalog === true;
    const includeCatalog = refreshCatalog || hasLoadedCatalogRef.current;

    if (refreshCatalog) {
      setCatalogRefreshing(true);
    } else {
      setIsHydrating(true);
    }

    setErrorMessage(null);

    try {
      const [settingsResponse, installedResponse, registryResponse, mcpResponse, catalogResponse] = await Promise.all([
        window.electronAPI.getSettings(),
        window.electronAPI.listPlugins({
          includeCatalog,
          refreshCatalog,
        }),
        window.electronAPI.getPluginRegistry(),
        window.electronAPI.getMcpServerSnapshots(),
        refreshCatalog
          ? window.electronAPI.listPluginCatalog({ refresh: true })
          : Promise.resolve(null),
      ]);

      if (!settingsResponse.success || !settingsResponse.data) {
        throw new Error(settingsResponse.error || t('settings.plugins.errors.loadSettings'));
      }

      if (!installedResponse.success || !installedResponse.data) {
        throw new Error(installedResponse.error || t('settings.plugins.errors.loadInstalled'));
      }

      if (!registryResponse.success || !registryResponse.data) {
        throw new Error(registryResponse.error || t('settings.plugins.errors.loadRegistry'));
      }

      setWorkspacePluginSettings(settingsResponse.data.plugins ?? {});
      setInstalledPlugins(installedResponse.data);
      setPluginRegistry(registryResponse.data);
      if (mcpResponse.success && mcpResponse.data) {
        setMcpSnapshots(mcpResponse.data);
      }
      setPluginSettingDrafts(buildPluginSettingDrafts(
        installedResponse.data,
        registryResponse.data,
        settingsResponse.data.plugins ?? {},
      ));

      if (catalogResponse) {
        if (catalogResponse.success && catalogResponse.data) {
          setCatalogEntries(catalogResponse.data);
          setHasLoadedCatalog(true);
        } else if (!catalogResponse.success) {
          setErrorMessage(catalogResponse.error || t('settings.plugins.errors.loadCatalog'));
        }
      }
    } catch (error) {
      console.error('Failed to load plugin center state:', error);
      setErrorMessage(error instanceof Error ? error.message : t('settings.plugins.errors.loadInstalled'));
    } finally {
      setHasLoadedOnce(true);
      setIsHydrating(false);
      setCatalogRefreshing(false);
    }
  }, [t]);

  useEffect(() => {
    void loadPluginState();
  }, [loadPluginState]);

  useEffect(() => {
    const handleRuntimeStateChanged = (_event: unknown, payload: {
      pluginId: string;
      state: PluginListItem['runtimeState'];
    }) => {
      setInstalledPlugins((currentPlugins) => currentPlugins.map((plugin) => (
        plugin.id === payload.pluginId
          ? {
              ...plugin,
              runtimeState: payload.state,
              health: payload.state === 'error'
                ? 'error'
                : payload.state === 'running' && plugin.health === 'error'
                  ? 'ok'
                  : plugin.health,
            }
          : plugin
      )));
    };

    window.electronAPI.onPluginRuntimeStateChanged(handleRuntimeStateChanged);

    return () => {
      window.electronAPI.offPluginRuntimeStateChanged(handleRuntimeStateChanged);
    };
  }, []);

  const availableCatalogEntries = useMemo(() => {
    const installedPluginIds = new Set(installedPlugins.map((plugin) => plugin.id));
    return catalogEntries.filter((entry) => !installedPluginIds.has(entry.id));
  }, [catalogEntries, installedPlugins]);
  const pluginCapabilitySummary = useMemo(() => {
    const counts = new Map<string, number>();
    for (const plugin of installedPlugins) {
      for (const capability of plugin.manifest?.capabilities ?? []) {
        counts.set(capability.type, (counts.get(capability.type) ?? 0) + 1);
      }
    }

    return Array.from(counts.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((left, right) => left.type.localeCompare(right.type));
  }, [installedPlugins]);

  const isInitialLoad = isHydrating && !hasLoadedOnce;
  const hasPluginMutationInFlight = activeActionKeys.some((actionKey) => (
    actionKey.startsWith('install:')
    || actionKey.startsWith('install-local:')
    || actionKey.startsWith('update:')
    || actionKey.startsWith('uninstall:')
  ));
  const isLocalInstallInFlight = activeActionKeys.some((actionKey) => actionKey.startsWith('install-local:'));
  const sectionClassName = idePopupPanelClassName;
  const subtlePanelClassName = idePopupSubtlePanelClassName;
  const barePanelClassName = idePopupBarePanelClassName;
  const inputClassName = `${idePopupInputClassName} !rounded-lg !px-3 !py-2`;
  const secondaryButtonClassName = `${idePopupSecondaryButtonClassName} rounded-lg px-3 py-2`;
  const primaryButtonClassName = `${idePopupActionButtonClassName('primary')} min-w-0 rounded-lg px-3 py-2`;
  const emptyStateClassName = `${idePopupEmptyStateClassName} px-6 py-16 text-center`;
  const badgeClassName = 'rounded-full border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--secondary))_72%,transparent)] px-2 py-0.5 text-[11px] font-medium text-[rgb(var(--muted-foreground))]';
  const chipClassName = 'rounded-full border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--background))_86%,transparent)] px-3 py-1 text-xs text-[rgb(var(--foreground))]';
  const mutedChipClassName = 'rounded-full border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--background))_86%,transparent)] px-3 py-1 text-xs text-[rgb(var(--muted-foreground))]';
  const compactSwitchRootClassName = 'relative h-6 w-10 flex-shrink-0 rounded-full bg-[rgb(var(--muted))] transition-colors data-[state=checked]:bg-[rgb(var(--primary))] disabled:cursor-not-allowed disabled:opacity-70';
  const compactSwitchThumbClassName = 'block h-5 w-5 translate-x-0.5 rounded-full bg-[color-mix(in_srgb,rgb(var(--background))_92%,transparent)] shadow-sm transition-transform data-[state=checked]:translate-x-[18px]';

  const isActionActive = useCallback((actionKey: string) => activeActionKeys.includes(actionKey), [activeActionKeys]);

  const toggleInstalledPluginExpanded = useCallback((pluginId: string) => {
    setExpandedInstalledPluginIds((currentIds) => (
      currentIds.includes(pluginId)
        ? currentIds.filter((currentId) => currentId !== pluginId)
        : [...currentIds, pluginId]
    ));
  }, []);

  const beginAction = useCallback((actionKey: string) => {
    setActiveActionKeys((currentKeys) => (
      currentKeys.includes(actionKey) ? currentKeys : [...currentKeys, actionKey]
    ));
  }, []);

  const finishAction = useCallback((actionKey: string) => {
    setActiveActionKeys((currentKeys) => currentKeys.filter((currentKey) => currentKey !== actionKey));
  }, []);

  const applyWorkspaceSettings = useCallback((settings?: Settings) => {
    if (!settings) {
      return;
    }

    setWorkspacePluginSettings(settings.plugins ?? {});
    notifyWorkspaceSettingsUpdated({
      plugins: settings.plugins ?? {},
    });
  }, []);

  const upsertInstalledPlugin = useCallback((item?: PluginListItem) => {
    if (!item) {
      return;
    }

    setInstalledPlugins((currentPlugins) => sortPluginListItems([
      ...currentPlugins.filter((plugin) => plugin.id !== item.id),
      item,
    ]));
  }, []);

  const updateInstalledPluginEnabledByDefault = useCallback((pluginId: string, enabled: boolean) => {
    setInstalledPlugins((currentPlugins) => currentPlugins.map((plugin) => (
      plugin.id === pluginId
        ? {
            ...plugin,
            enabledByDefault: enabled,
          }
        : plugin
    )));
  }, []);

  const removeInstalledPlugin = useCallback((pluginId: string) => {
    setInstalledPlugins((currentPlugins) => currentPlugins.filter((plugin) => plugin.id !== pluginId));
  }, []);

  const applyGlobalPluginSettings = useCallback((pluginId: string, values: Record<string, unknown>) => {
    setPluginRegistry((currentRegistry) => {
      const nextSettings = {
        ...(currentRegistry.globalPluginSettings ?? {}),
      };

      if (Object.keys(values).length > 0) {
        nextSettings[pluginId] = values;
      } else {
        delete nextSettings[pluginId];
      }

      return {
        ...currentRegistry,
        globalPluginSettings: nextSettings,
      };
    });
  }, []);

  const statusText = useMemo(() => {
    if (catalogRefreshing) {
      return t('settings.plugins.status.refreshingCatalog');
    }

    if (hasPluginMutationInFlight) {
      return t('settings.plugins.status.applyingChanges');
    }

    if (isHydrating) {
      return t(hasLoadedOnce ? 'settings.plugins.status.syncing' : 'settings.plugins.loading');
    }

    return null;
  }, [catalogRefreshing, hasLoadedOnce, hasPluginMutationInFlight, isHydrating, t]);

  const handleLoadCatalog = useCallback(() => {
    void loadPluginState({ refreshCatalog: true });
  }, [loadPluginState]);

  const performAction = useCallback(async <TData,>(
    actionKey: string,
    action: () => Promise<{ success: boolean; data?: TData; error?: string }>,
    options: {
      successMessage?: string;
      onSuccess?: (data?: TData) => void;
    } = {},
  ) => {
    beginAction(actionKey);
    setFeedbackMessage(null);
    setErrorMessage(null);

    try {
      const response = await action();
      if (!response.success) {
        throw new Error(response.error || t('settings.plugins.errors.actionFailed'));
      }

      options.onSuccess?.(response.data);

      if (options.successMessage) {
        setFeedbackMessage(options.successMessage);
      }

      void loadPluginState();
    } catch (error) {
      console.error('Plugin action failed:', error);
      setErrorMessage(error instanceof Error ? error.message : t('settings.plugins.errors.actionFailed'));
    } finally {
      finishAction(actionKey);
    }
  }, [beginAction, finishAction, loadPluginState, t]);

  const handleInstallMarketplacePlugin = useCallback(async (pluginId: string) => {
    await performAction(
      `install:${pluginId}`,
      () => window.electronAPI.installMarketplacePlugin({ pluginId, enableByDefault: true }),
      {
        successMessage: t('settings.plugins.messages.installSuccess'),
        onSuccess: (item?: PluginListItem) => {
          upsertInstalledPlugin(item);
        },
      },
    );
  }, [performAction, t, upsertInstalledPlugin]);

  const handleInstallLocalPlugin = useCallback(async () => {
    const fileSelection = await window.electronAPI.selectPluginPackage();
    const selectedPath = fileSelection.success ? fileSelection.data : null;
    if (!selectedPath) {
      return;
    }

    await performAction(
      `install-local:${selectedPath}`,
      () => window.electronAPI.installLocalPlugin({ filePath: selectedPath, enableByDefault: true }),
      {
        successMessage: t('settings.plugins.messages.installSuccess'),
        onSuccess: (item?: PluginListItem) => {
          upsertInstalledPlugin(item);
        },
      },
    );
  }, [performAction, t, upsertInstalledPlugin]);

  const handleUpdatePlugin = useCallback(async (pluginId: string) => {
    await performAction(
      `update:${pluginId}`,
      () => window.electronAPI.updatePlugin({ pluginId }),
      {
        successMessage: t('settings.plugins.messages.updateSuccess'),
        onSuccess: (item?: PluginListItem) => {
          upsertInstalledPlugin(item);
        },
      },
    );
  }, [performAction, t, upsertInstalledPlugin]);

  const handleUninstallPlugin = useCallback(async (pluginId: string) => {
    await performAction(
      `uninstall:${pluginId}`,
      () => window.electronAPI.uninstallPlugin({ pluginId }),
      {
        successMessage: t('settings.plugins.messages.uninstallSuccess'),
        onSuccess: () => {
          removeInstalledPlugin(pluginId);
        },
      },
    );
  }, [performAction, removeInstalledPlugin, t]);

  const handleSetGlobalEnabled = useCallback(async (pluginId: string, enabled: boolean) => {
    await performAction(
      `global-enabled:${pluginId}`,
      () => window.electronAPI.setPluginEnabled({ pluginId, enabled, scope: 'global' }),
      {
        successMessage: t('settings.plugins.messages.globalDefaultSaved'),
        onSuccess: () => {
          updateInstalledPluginEnabledByDefault(pluginId, enabled);
        },
      },
    );
  }, [performAction, t, updateInstalledPluginEnabledByDefault]);

  const handleSetWorkspaceMode = useCallback(async (pluginId: string, mode: WorkspaceEnableMode) => {
    const enabled = mode === 'inherit' ? null : mode === 'enabled';
    await performAction(
      `workspace-enabled:${pluginId}`,
      () => window.electronAPI.setPluginEnabled({ pluginId, enabled, scope: 'workspace' }),
      {
        successMessage: t('settings.plugins.messages.workspaceOverrideSaved'),
        onSuccess: (settings?: Settings) => {
          applyWorkspaceSettings(settings);
        },
      },
    );
  }, [applyWorkspaceSettings, performAction, t]);

  const handlePluginSettingDraftChange = useCallback((
    pluginId: string,
    scope: PluginSettingScope,
    key: string,
    value: unknown,
  ) => {
    setPluginSettingDrafts((currentDrafts) => {
      const currentPluginDrafts = currentDrafts[pluginId] ?? { global: {}, workspace: {} };
      const nextScopeValues = {
        ...currentPluginDrafts[scope],
      };

      if (value === '' || value === undefined) {
        delete nextScopeValues[key];
      } else {
        nextScopeValues[key] = value;
      }

      return {
        ...currentDrafts,
        [pluginId]: {
          ...currentPluginDrafts,
          [scope]: nextScopeValues,
        },
      };
    });
  }, []);

  const handleSavePluginSettings = useCallback(async (
    pluginId: string,
    scope: PluginSettingScope,
  ) => {
    const values = pluginSettingDrafts[pluginId]?.[scope] ?? {};
    const shouldEnableByDefault = scope === 'global'
      && Object.keys(values).length > 0
      && installedPlugins.find((plugin) => plugin.id === pluginId)?.enabledByDefault !== true;

    if (scope === 'global') {
      await performAction(
        `settings:${scope}:${pluginId}`,
        async () => {
          const response = await window.electronAPI.setPluginSettings({ pluginId, scope, values });
          if (!response.success) {
            return response;
          }

          if (shouldEnableByDefault) {
            const enableResponse = await window.electronAPI.setPluginEnabled({
              pluginId,
              enabled: true,
              scope: 'global',
            });
            if (!enableResponse.success) {
              return {
                success: false,
                error: enableResponse.error,
              };
            }
          }

          return response;
        },
        {
          successMessage: t('settings.plugins.messages.pluginSettingsSaved'),
          onSuccess: () => {
            applyGlobalPluginSettings(pluginId, values);
            if (shouldEnableByDefault) {
              updateInstalledPluginEnabledByDefault(pluginId, true);
            }
          },
        },
      );
      return;
    }

    await performAction(
      `settings:${scope}:${pluginId}`,
      () => window.electronAPI.setPluginSettings({ pluginId, scope, values }),
      {
        successMessage: t('settings.plugins.messages.pluginSettingsSaved'),
        onSuccess: (settings?: Settings) => {
          applyWorkspaceSettings(settings);
        },
      },
    );
  }, [
    applyGlobalPluginSettings,
    applyWorkspaceSettings,
    installedPlugins,
    performAction,
    pluginSettingDrafts,
    t,
    updateInstalledPluginEnabledByDefault,
  ]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <CompactSettingsSection
        title={t('settings.plugins.title')}
        help={t('settings.plugins.pageDescription')}
        icon={<Plug size={15} />}
        actions={(
          <>
            {statusText && (
              <span className="inline-flex items-center gap-2 text-xs text-[rgb(var(--muted-foreground))]">
                <LoaderCircle size={14} className="animate-spin" />
                <span>{statusText}</span>
              </span>
            )}
            <button
              type="button"
              onClick={handleLoadCatalog}
              disabled={catalogRefreshing || hasPluginMutationInFlight}
              className={`${secondaryButtonClassName} inline-flex items-center gap-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-70`}
            >
              {catalogRefreshing ? <LoaderCircle size={16} className="animate-spin" /> : <RefreshCw size={16} />}
              {t(hasLoadedCatalog ? 'settings.plugins.actions.refreshCatalog' : 'settings.plugins.actions.loadCatalog')}
            </button>
            <button
              type="button"
              onClick={() => void handleInstallLocalPlugin()}
              disabled={hasPluginMutationInFlight}
              className={`${primaryButtonClassName} inline-flex items-center gap-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-70`}
            >
              {isLocalInstallInFlight ? <LoaderCircle size={16} className="animate-spin" /> : <FolderUp size={16} />}
              {t('settings.plugins.actions.installLocal')}
            </button>
          </>
        )}
        contentClassName="p-4"
        divided={false}
      >
        {(feedbackMessage || errorMessage) ? (
          <div className={`rounded-xl border px-4 py-3 text-sm ${
            errorMessage
              ? 'border-[rgb(var(--error)/0.24)] bg-[rgb(var(--error)/0.10)] text-[rgb(var(--foreground))]'
              : 'border-[rgba(168,170,88,0.24)] bg-[rgba(168,170,88,0.10)] text-[rgb(var(--primary))]'
          }`}>
            {errorMessage ?? feedbackMessage}
          </div>
        ) : null}
      </CompactSettingsSection>

      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <Plug size={18} className="text-[rgb(var(--primary))]" />
          <h3 className="text-base font-semibold text-[rgb(var(--foreground))]">{t('settings.plugins.sections.capabilities')}</h3>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <CompactSettingsSection
            title={t('settings.plugins.mcp.title')}
            help={t('settings.plugins.mcp.description')}
            icon={<Wrench size={15} />}
            contentClassName="p-4"
            divided={false}
          >
            {mcpSnapshots.length === 0 ? (
              <div className={barePanelClassName}>
                <div className="text-sm text-[rgb(var(--muted-foreground))]">{t('settings.plugins.mcp.empty')}</div>
              </div>
            ) : (
              <div className="space-y-3">
                {mcpSnapshots.map((snapshot) => (
                  <div key={snapshot.serverName} className={idePopupCardClassName}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-semibold text-[rgb(var(--foreground))]">{snapshot.serverName}</div>
                      <div className={badgeClassName}>{t('settings.plugins.mcp.toolCount', { count: snapshot.toolCount })}</div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {snapshot.tools.map((tool) => (
                        <span key={`${snapshot.serverName}:${tool.toolName}`} className={chipClassName}>
                          {tool.toolName}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CompactSettingsSection>

          <CompactSettingsSection
            title={t('settings.plugins.capabilitySummary.title')}
            help={t('settings.plugins.capabilitySummary.description')}
            icon={<Settings2 size={15} />}
            contentClassName="p-4"
            divided={false}
          >
            {pluginCapabilitySummary.length === 0 ? (
              <div className={barePanelClassName}>
                <div className="text-sm text-[rgb(var(--muted-foreground))]">{t('settings.plugins.capabilitySummary.empty')}</div>
              </div>
            ) : (
              <div className="space-y-3">
                {pluginCapabilitySummary.map((item) => (
                  <div key={item.type} className="flex items-center justify-between gap-3 rounded-xl border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--secondary))_58%,transparent)] px-3 py-2.5">
                    <div className="text-sm font-medium text-[rgb(var(--foreground))]">{item.type}</div>
                    <div className={badgeClassName}>{item.count}</div>
                  </div>
                ))}
              </div>
            )}
          </CompactSettingsSection>
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <Wrench size={18} className="text-[rgb(var(--primary))]" />
          <h3 className="text-base font-semibold text-[rgb(var(--foreground))]">{t('settings.plugins.sections.builtin')}</h3>
        </div>
        <CompactSettingsSection
          title={(
            <span className="inline-flex items-center gap-2">
              {t('settings.statusLine.pluginName')}
              <span className="rounded-full border border-[rgba(168,170,88,0.20)] bg-[rgba(168,170,88,0.10)] px-2 py-0.5 text-[11px] font-medium text-[rgb(var(--primary))]">
                {t('settings.statusLine.builtInBadge')}
              </span>
            </span>
          )}
          help={t('settings.statusLine.pageDescription')}
          icon={<Plug size={15} />}
          actions={(
            <div className="flex items-center gap-2">
              <Switch.Root
                checked={statusLineConfig.enabled}
                onCheckedChange={(checked) => void onToggleStatusLine(checked)}
                aria-label={t('settings.statusLine.enableTitle')}
                className={compactSwitchRootClassName}
              >
                <Switch.Thumb className={compactSwitchThumbClassName} />
              </Switch.Root>
              <button
                type="button"
                onClick={() => setIsStatusLineExpanded((currentValue) => !currentValue)}
                aria-expanded={isStatusLineExpanded}
                aria-label={t('settings.plugins.configure')}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--secondary))_50%,transparent)] text-[rgb(var(--muted-foreground))] transition-colors hover:border-[rgb(var(--ring))] hover:bg-[rgb(var(--accent))] hover:text-[rgb(var(--foreground))]"
              >
                <ChevronDown
                  size={16}
                  className={`transition-transform ${isStatusLineExpanded ? 'rotate-180' : ''}`}
                />
              </button>
            </div>
          )}
        >
          {isStatusLineExpanded && statusLineConfig.enabled ? (
            <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_320px]">
              <div className="rounded-xl border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--secondary))_58%,transparent)] p-4">
                <div className="text-sm font-semibold text-[rgb(var(--foreground))]">{t('settings.statusLine.displayFormat')}</div>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  {(['full', 'compact'] as const).map((format) => (
                    <label
                      key={format}
                      className="flex cursor-pointer items-start gap-3 rounded-xl border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--background))_86%,transparent)] p-3 transition-colors hover:bg-[rgb(var(--accent))]"
                    >
                      <input
                        type="radio"
                        name="statusline-format"
                        value={format}
                        checked={statusLineConfig.cliFormat === format && statusLineConfig.cardFormat === format}
                        onChange={() => void onStatusLineConfigChange({
                          cliFormat: format,
                          cardFormat: format,
                        })}
                        className="mt-1 h-4 w-4 text-[rgb(var(--primary))]"
                      />
                      <div>
                        <div className="text-sm font-medium text-[rgb(var(--foreground))]">
                          {format === 'full' ? t('settings.statusLine.full') : t('settings.statusLine.compact')}
                        </div>
                        <div className={`mt-2 ${idePopupCardClassName} font-mono text-xs text-[rgb(var(--muted-foreground))]`}>
                          {format === 'full'
                            ? 'Model: Sonnet 4.6 | Context: 45% | Cost: $0.25'
                            : 'Sonnet 4.6 • 45% • $0.25'}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--secondary))_58%,transparent)] p-4">
                <div className="text-sm font-semibold text-[rgb(var(--foreground))]">{t('settings.statusLine.displayContent')}</div>
                <div className="mt-3 space-y-2">
                  {[
                    { key: 'showContext', title: t('settings.statusLine.contextPercentage'), description: t('settings.statusLine.contextExample') },
                    { key: 'showCost', title: t('settings.statusLine.cost'), description: t('settings.statusLine.costExample') },
                    { key: 'showTime', title: t('settings.plugins.statusline.showTime'), description: t('settings.plugins.statusline.showTimeDescription') },
                    { key: 'showTokens', title: t('settings.plugins.statusline.showTokens'), description: t('settings.plugins.statusline.showTokensDescription') },
                  ].map((item) => (
                    <label
                      key={item.key}
                      className="flex cursor-pointer items-center gap-3 rounded-xl border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--background))_86%,transparent)] px-3 py-2 transition-colors hover:bg-[rgb(var(--accent))]"
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(statusLineConfig[item.key as keyof StatusLineConfig])}
                        onChange={(event) => void onStatusLineConfigChange({ [item.key]: event.target.checked })}
                        className="h-4 w-4 text-[rgb(var(--primary))]"
                      />
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="truncate text-sm font-medium text-[rgb(var(--foreground))]">{item.title}</div>
                        <CompactHelp content={item.description} />
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </CompactSettingsSection>
      </section>

      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <Settings2 size={18} className="text-[rgb(var(--primary))]" />
          <h3 className="text-base font-semibold text-[rgb(var(--foreground))]">{t('settings.plugins.sections.installed')}</h3>
        </div>

        {isInitialLoad ? (
          <SectionLoadingState label={t('settings.plugins.loadingSection')} />
        ) : installedPlugins.length === 0 ? (
          <div className={emptyStateClassName}>
            <Plug size={40} className="mx-auto text-[rgb(var(--muted-foreground))] opacity-50" />
            <p className="mt-5 text-lg font-medium text-[rgb(var(--foreground))]">{t('settings.plugins.emptyInstalledTitle')}</p>
            <p className="mt-2 text-sm text-[rgb(var(--muted-foreground))]">{t('settings.plugins.emptyInstalledDescription')}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {installedPlugins.map((plugin) => {
              const workspaceMode = getWorkspaceEnableMode(plugin.id, workspacePluginSettings);
              const globalSettingsSchema = getScopedSettingsSchemaEntries(plugin, 'global');
              const workspaceSettingsSchema = getScopedSettingsSchemaEntries(plugin, 'workspace');
              const isExpanded = expandedInstalledPluginIds.includes(plugin.id);
              const hasExpandableDetails = plugin.manifest?.capabilities.some((capability) => (capability.requirements?.length ?? 0) > 0)
                || globalSettingsSchema.length > 0
                || workspaceSettingsSchema.length > 0
                || (plugin.languages?.length ?? 0) > 0;

              return (
                <div
                  key={plugin.id}
                  className={`${sectionClassName} !p-0 transition-colors hover:border-[rgb(var(--primary))]`}
                >
                  <div className="flex min-h-[52px] items-center justify-between gap-3 px-4 py-2.5">
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                      <h3 className="truncate text-base font-semibold text-[rgb(var(--foreground))]">{plugin.name}</h3>
                      <span className={badgeClassName}>
                        {plugin.publisher}
                      </span>
                      <span className="rounded-full border border-[rgba(168,170,88,0.20)] bg-[rgba(168,170,88,0.10)] px-2 py-0.5 text-[11px] font-medium text-[rgb(var(--primary))]">
                        {formatInstallStatus(plugin, t)}
                      </span>
                      <span className={badgeClassName}>
                        {formatPluginSource(plugin.source, t)}
                      </span>
                      <span className={mutedChipClassName}>
                        {formatRuntimeState(plugin, t)}
                      </span>
                      {plugin.updateAvailable && (
                        <span className="rounded-full border border-[rgb(var(--warning)/0.24)] bg-[rgb(var(--warning)/0.12)] px-2 py-0.5 text-[rgb(var(--foreground))]">
                          {t('settings.plugins.badges.updateAvailable')}
                        </span>
                      )}
                    </div>

                    <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-2">
                      <Switch.Root
                        checked={plugin.enabledByDefault === true}
                        disabled={isActionActive(`global-enabled:${plugin.id}`)}
                        onCheckedChange={(checked) => void handleSetGlobalEnabled(plugin.id, checked)}
                        aria-label={t('settings.plugins.globalDefaultTitle')}
                        className={compactSwitchRootClassName}
                      >
                        <Switch.Thumb className={compactSwitchThumbClassName} />
                      </Switch.Root>
                      {plugin.updateAvailable && (
                        <button
                          type="button"
                          onClick={() => void handleUpdatePlugin(plugin.id)}
                          disabled={hasPluginMutationInFlight}
                          className={`${secondaryButtonClassName} inline-flex h-9 items-center gap-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-70`}
                        >
                          {isActionActive(`update:${plugin.id}`) ? <LoaderCircle size={16} className="animate-spin" /> : <Download size={16} />}
                          {t('settings.plugins.actions.update')}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void handleUninstallPlugin(plugin.id)}
                        disabled={hasPluginMutationInFlight}
                        className="inline-flex h-9 items-center gap-2 rounded-lg border border-[rgb(var(--error)/0.14)] bg-[rgb(var(--error)/0.08)] px-3 text-sm font-medium text-[rgb(var(--muted-foreground))] transition-colors hover:border-[rgb(var(--error)/0.34)] hover:bg-[rgb(var(--error)/0.14)] hover:text-[rgb(var(--foreground))] disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        {isActionActive(`uninstall:${plugin.id}`) ? <LoaderCircle size={16} className="animate-spin" /> : <Trash2 size={16} />}
                        {t('settings.plugins.actions.uninstall')}
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleInstalledPluginExpanded(plugin.id)}
                        aria-expanded={isExpanded}
                        aria-label={t('settings.plugins.configure')}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--secondary))_50%,transparent)] text-[rgb(var(--muted-foreground))] transition-colors hover:border-[rgb(var(--ring))] hover:bg-[rgb(var(--accent))] hover:text-[rgb(var(--foreground))]"
                      >
                        <ChevronDown
                          size={16}
                          className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                        />
                      </button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-[rgb(var(--border))] px-5 py-5">
                      <div className="mb-5 overflow-hidden rounded-xl border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--secondary))_58%,transparent)]">
                        <CompactSettingRow
                          label={t('settings.plugins.workspaceOverrideTitle')}
                          help={t('settings.plugins.workspaceOverrideDescription')}
                        >
                          <select
                            aria-label={t('settings.plugins.aria.workspaceMode', { plugin: plugin.name })}
                            value={workspaceMode}
                            disabled={isActionActive(`workspace-enabled:${plugin.id}`)}
                            onChange={(event) => void handleSetWorkspaceMode(
                              plugin.id,
                              event.target.value as WorkspaceEnableMode,
                            )}
                            className={`max-w-[280px] ${inputClassName}`}
                          >
                            <option value="inherit">{t('settings.plugins.workspaceMode.inherit')}</option>
                            <option value="enabled">{t('settings.plugins.workspaceMode.enabled')}</option>
                            <option value="disabled">{t('settings.plugins.workspaceMode.disabled')}</option>
                          </select>
                        </CompactSettingRow>
                      </div>

                      {(plugin.languages?.length ?? 0) > 0 && (
                        <div className="mb-5 flex flex-wrap gap-2">
                          {(plugin.languages ?? []).map((language) => (
                            <span
                              key={`${plugin.id}:${language}`}
                              className={chipClassName}
                            >
                              {language}
                            </span>
                          ))}
                        </div>
                      )}

                      {hasExpandableDetails && (
                        <div className={`overflow-hidden ${subtlePanelClassName}`}>
                          <div className="px-5 py-4 text-sm font-medium text-[rgb(var(--foreground))]">
                            {t('settings.plugins.configure')}
                          </div>
                          <div className="border-t border-[rgb(var(--border))] px-5 py-5">
                        {plugin.manifest?.capabilities.some((capability) => (capability.requirements?.length ?? 0) > 0) && (
                          <div className={`mb-5 ${barePanelClassName}`}>
                            <div className="text-sm font-semibold text-[rgb(var(--foreground))]">{t('settings.plugins.requirements')}</div>
                            <div className="mt-3 space-y-2 text-sm text-[rgb(var(--muted-foreground))]">
                              {plugin.manifest.capabilities.flatMap((capability) => capability.requirements ?? []).map((requirement, index) => (
                                <div key={`${plugin.id}:requirement:${index}`} className={idePopupCardClassName}>
                                  {formatRequirement(requirement, t)}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        <div className="grid gap-5 xl:grid-cols-2">
                          {renderSettingsScopeCard({
                            t,
                            plugin,
                            scope: 'global',
                            entries: globalSettingsSchema,
                            drafts: pluginSettingDrafts[plugin.id]?.global ?? {},
                            isActionActive,
                            onChange: handlePluginSettingDraftChange,
                            onSave: handleSavePluginSettings,
                          })}
                          {renderSettingsScopeCard({
                            t,
                            plugin,
                            scope: 'workspace',
                            entries: workspaceSettingsSchema,
                            drafts: pluginSettingDrafts[plugin.id]?.workspace ?? {},
                            isActionActive,
                            onChange: handlePluginSettingDraftChange,
                            onSave: handleSavePluginSettings,
                          })}
                        </div>
                      </div>
                    </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <Download size={18} className="text-[rgb(var(--primary))]" />
          <h3 className="text-base font-semibold text-[rgb(var(--foreground))]">{t('settings.plugins.sections.available')}</h3>
        </div>

        {isInitialLoad ? (
          <SectionLoadingState label={t('settings.plugins.loadingSection')} />
        ) : !hasLoadedCatalog ? (
          <div className={emptyStateClassName}>
            <Plug size={40} className="mx-auto text-[rgb(var(--muted-foreground))] opacity-50" />
            <p className="mt-5 text-lg font-medium text-[rgb(var(--foreground))]">{t('settings.plugins.availableNotLoadedTitle')}</p>
            <p className="mt-2 text-sm text-[rgb(var(--muted-foreground))]">{t('settings.plugins.availableNotLoadedDescription')}</p>
            <button
              type="button"
              onClick={handleLoadCatalog}
              disabled={catalogRefreshing || hasPluginMutationInFlight}
              className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-[rgb(var(--primary))] px-4 py-3 text-sm font-medium text-[rgb(var(--primary-foreground))] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {catalogRefreshing ? <LoaderCircle size={16} className="animate-spin" /> : <RefreshCw size={16} />}
              {t('settings.plugins.actions.loadCatalog')}
            </button>
          </div>
        ) : availableCatalogEntries.length === 0 ? (
          <div className={emptyStateClassName}>
            <Plug size={40} className="mx-auto text-[rgb(var(--muted-foreground))] opacity-50" />
            <p className="mt-5 text-lg font-medium text-[rgb(var(--foreground))]">{t('settings.plugins.emptyAvailableTitle')}</p>
            <p className="mt-2 text-sm text-[rgb(var(--muted-foreground))]">{t('settings.plugins.emptyAvailableDescription')}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {availableCatalogEntries.map((entry) => (
              <div
                key={entry.id}
                className={`${sectionClassName} !p-4 transition-colors hover:border-[rgb(var(--primary))]`}
              >
                <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-semibold text-[rgb(var(--foreground))]">{entry.name}</h3>
                      <span className={badgeClassName}>
                        {entry.publisher}
                      </span>
                      <span className={badgeClassName}>
                        {t('settings.plugins.labels.latestVersion')}: {entry.latestVersion}
                      </span>
                      <span className="rounded-full border border-[rgba(168,170,88,0.20)] bg-[rgba(168,170,88,0.10)] px-2 py-0.5 text-[11px] font-medium text-[rgb(var(--primary))]">
                        {t('settings.plugins.badges.marketplace')}
                      </span>
                    </div>
                    {(entry.description || entry.summary) && (
                      <p className="mt-2 line-clamp-2 max-w-3xl text-sm leading-5 text-[rgb(var(--muted-foreground))]">
                        {entry.description ?? entry.summary}
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(entry.languages ?? []).map((language) => (
                        <span
                          key={`${entry.id}:${language}`}
                          className={chipClassName}
                        >
                          {language}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => void handleInstallMarketplacePlugin(entry.id)}
                      disabled={hasPluginMutationInFlight}
                        className={`${primaryButtonClassName} inline-flex h-11 items-center gap-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-70`}
                      >
                      {isActionActive(`install:${entry.id}`) ? <LoaderCircle size={16} className="animate-spin" /> : <Download size={16} />}
                      {t('settings.plugins.actions.install')}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

function SectionLoadingState({ label }: { label: string }) {
  return (
    <div className={`${idePopupEmptyStateClassName} px-6 py-12`}>
      <div className="inline-flex items-center gap-2 text-sm text-[rgb(var(--muted-foreground))]">
        <LoaderCircle size={16} className="animate-spin" />
        <span>{label}</span>
      </div>
    </div>
  );
}

function renderSettingsScopeCard({
  t,
  plugin,
  scope,
  entries,
  drafts,
  isActionActive,
  onChange,
  onSave,
}: {
  t: TranslateFn;
  plugin: PluginListItem;
  scope: PluginSettingScope;
  entries: Array<[string, PluginSettingSchemaEntry]>;
  drafts: Record<string, unknown>;
  isActionActive: (actionKey: string) => boolean;
  onChange: (pluginId: string, scope: PluginSettingScope, key: string, value: unknown) => void;
  onSave: (pluginId: string, scope: PluginSettingScope) => Promise<void>;
}) {
  if (entries.length === 0) {
    return (
      <div className={idePopupBarePanelClassName}>
        <div className="text-sm font-semibold text-[rgb(var(--foreground))]">
          {scope === 'global' ? t('settings.plugins.scope.global') : t('settings.plugins.scope.workspace')}
        </div>
        <div className="mt-2 text-sm text-[rgb(var(--muted-foreground))]">{t('settings.plugins.noSettings')}</div>
      </div>
    );
  }

  return (
    <div className={`${idePopupBarePanelClassName} !p-0`}>
      <div className="flex items-center justify-between gap-3 border-b border-[rgb(var(--border))] px-4 py-2.5">
        <div>
          <div className="text-sm font-semibold text-[rgb(var(--foreground))]">
            {scope === 'global' ? t('settings.plugins.scope.global') : t('settings.plugins.scope.workspace')}
          </div>
        </div>
        <CompactHelp content={scope === 'global' ? t('settings.plugins.scope.globalDescription') : t('settings.plugins.scope.workspaceDescription')} />
        <button
          type="button"
          onClick={() => void onSave(plugin.id, scope)}
          disabled={isActionActive(`settings:${scope}:${plugin.id}`)}
          className={`${idePopupSecondaryButtonClassName} inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-70`}
        >
          {isActionActive(`settings:${scope}:${plugin.id}`) ? <LoaderCircle size={16} className="animate-spin" /> : <Check size={16} />}
          {t('common.save')}
        </button>
      </div>

      <div className="divide-y divide-[rgb(var(--border))]">
        {entries.map(([key, entry]) => (
          <CompactSettingRow
            key={`${plugin.id}:${scope}:${key}`}
            label={entry.title}
            help={entry.description}
            controlClassName={entry.type === 'boolean' ? undefined : 'items-stretch'}
          >
            {renderSettingControl({
              t,
              entry,
              value: drafts[key],
              onChange: (value) => onChange(plugin.id, scope, key, value),
            })}
          </CompactSettingRow>
        ))}
      </div>
    </div>
  );
}

function renderSettingControl({
  t,
  entry,
  value,
  onChange,
}: {
  t: TranslateFn;
  entry: PluginSettingSchemaEntry;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  if (entry.type === 'boolean') {
    return (
      <Switch.Root
        aria-label={entry.title}
        checked={Boolean(value ?? entry.defaultValue ?? false)}
        onCheckedChange={(checked) => onChange(checked)}
        className="relative h-6 w-10 rounded-full bg-[rgb(var(--muted))] transition-colors data-[state=checked]:bg-[rgb(var(--primary))]"
      >
        <Switch.Thumb className="block h-5 w-5 translate-x-0.5 rounded-full bg-[color-mix(in_srgb,rgb(var(--background))_92%,transparent)] shadow-sm transition-transform data-[state=checked]:translate-x-[18px]" />
      </Switch.Root>
    );
  }

  if (entry.type === 'enum') {
    const resolvedValue = normalizeSettingPrimitive(value ?? entry.defaultValue ?? entry.options?.[0]?.value);

    return (
      <select
        aria-label={entry.title}
        value={stringifySettingValue(resolvedValue)}
        onChange={(event) => onChange(parseSettingOptionValue(event.target.value, entry.options ?? []))}
        className={`${idePopupInputClassName} max-w-[360px] !rounded-lg !px-3 !py-2`}
      >
        {(entry.options ?? []).map((option) => (
          <option key={`${option.label}:${stringifySettingValue(option.value)}`} value={stringifySettingValue(option.value)}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }

  if (entry.type === 'number') {
    const numericValue = typeof value === 'number'
      ? value
      : typeof entry.defaultValue === 'number'
        ? entry.defaultValue
        : '';

    return (
      <input
        aria-label={entry.title}
        type="number"
        value={numericValue}
        onChange={(event) => onChange(event.target.value === '' ? undefined : Number(event.target.value))}
        placeholder={entry.placeholder}
        className={`${idePopupInputClassName} max-w-[220px] !rounded-lg !px-3 !py-2`}
      />
    );
  }

  if (entry.inputKind === 'directory') {
    const stringValue = resolveStringSettingValue(value, entry.defaultValue);

    return (
      <div className="flex w-full max-w-[560px] gap-2">
        <input
          aria-label={entry.title}
          type="text"
          value={stringValue}
          onChange={(event) => onChange(event.target.value === '' ? undefined : event.target.value)}
          placeholder={entry.placeholder}
          className={`min-w-0 flex-1 ${idePopupInputClassName} !rounded-lg !px-3 !py-2`}
        />
        <button
          type="button"
          aria-label={`${t('common.browse')} ${entry.title}`}
          onClick={() => void handleBrowseDirectorySetting(onChange)}
          className={`${idePopupSecondaryButtonClassName} inline-flex h-9 shrink-0 items-center justify-center rounded-lg px-3 text-sm font-medium`}
        >
          {t('common.browse')}
        </button>
      </div>
    );
  }

  return (
    <input
      aria-label={entry.title}
      type="text"
      value={resolveStringSettingValue(value, entry.defaultValue)}
      onChange={(event) => onChange(event.target.value === '' ? undefined : event.target.value)}
      placeholder={entry.placeholder}
      className={`${idePopupInputClassName} max-w-[560px] !rounded-lg !px-3 !py-2`}
    />
  );
}

async function handleBrowseDirectorySetting(onChange: (value: unknown) => void): Promise<void> {
  const selection = await window.electronAPI.selectDirectory();
  if (selection.success && selection.data) {
    onChange(selection.data);
  }
}

function resolveStringSettingValue(value: unknown, defaultValue: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof defaultValue === 'string') {
    return defaultValue;
  }

  return '';
}

function stringifySettingValue(value: string | number | boolean | undefined): string {
  if (value === undefined) {
    return '';
  }

  return typeof value === 'string' ? value : JSON.stringify(value);
}

function parseSettingOptionValue(rawValue: string, options: PluginSettingOption[]): string | number | boolean {
  const matchedOption = options.find((option) => stringifySettingValue(option.value) === rawValue);
  return matchedOption?.value ?? rawValue;
}

function normalizeSettingPrimitive(value: unknown): string | number | boolean | undefined {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  return undefined;
}

function buildPluginSettingDrafts(
  installedPlugins: PluginListItem[],
  pluginRegistry: PluginRegistry,
  workspacePluginSettings: WorkspacePluginSettings,
): PluginSettingDrafts {
  return Object.fromEntries(
    installedPlugins.map((plugin) => {
      const schema = plugin.manifest?.settingsSchema ?? {};
      const globalDefaults = buildDefaultScopeValues(schema, 'global');
      const workspaceDefaults = buildDefaultScopeValues(schema, 'workspace');

      return [
        plugin.id,
        {
          global: {
            ...globalDefaults,
            ...(pluginRegistry.globalPluginSettings?.[plugin.id] ?? {}),
          },
          workspace: {
            ...workspaceDefaults,
            ...(workspacePluginSettings.pluginSettings?.[plugin.id] ?? {}),
          },
        },
      ];
    }),
  );
}

function buildDefaultScopeValues(
  schema: Record<string, PluginSettingSchemaEntry>,
  scope: PluginSettingScope,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(schema)
      .filter(([, entry]) => entry.scope === scope && entry.defaultValue !== undefined)
      .map(([key, entry]) => [key, entry.defaultValue]),
  );
}

function getWorkspaceEnableMode(
  pluginId: string,
  workspacePluginSettings: WorkspacePluginSettings,
): WorkspaceEnableMode {
  if ((workspacePluginSettings.disabledPluginIds ?? []).includes(pluginId)) {
    return 'disabled';
  }

  if ((workspacePluginSettings.enabledPluginIds ?? []).includes(pluginId)) {
    return 'enabled';
  }

  return 'inherit';
}

function getScopedSettingsSchemaEntries(
  plugin: PluginListItem,
  scope: PluginSettingScope,
): Array<[string, PluginSettingSchemaEntry]> {
  return Object.entries(plugin.manifest?.settingsSchema ?? {})
    .filter(([, entry]) => entry.scope === scope);
}

function formatPluginSource(
  source: PluginListItem['source'],
  t: TranslateFn,
): string {
  if (source === 'builtin') {
    return t('settings.plugins.source.builtin');
  }

  if (source === 'marketplace') {
    return t('settings.plugins.source.marketplace');
  }

  return t('settings.plugins.source.sideload');
}

function formatInstallStatus(
  plugin: PluginListItem,
  t: TranslateFn,
): string {
  if (plugin.installStatus === 'error' || plugin.health === 'error') {
    return t('settings.plugins.status.error');
  }

  if (plugin.updateAvailable) {
    return t('settings.plugins.status.updateAvailable');
  }

  if (plugin.installStatus === 'installed') {
    return t('settings.plugins.status.installed');
  }

  if (plugin.installStatus === 'installing') {
    return t('settings.plugins.status.installing');
  }

  if (plugin.installStatus === 'updating') {
    return t('settings.plugins.status.updating');
  }

  return t('settings.plugins.status.unknown');
}

function formatRuntimeState(
  plugin: PluginListItem,
  t: TranslateFn,
): string {
  switch (plugin.runtimeState) {
    case 'starting':
      return t('settings.plugins.runtime.starting');
    case 'running':
      return t('settings.plugins.runtime.running');
    case 'stopped':
      return t('settings.plugins.runtime.stopped');
    case 'error':
      return t('settings.plugins.runtime.error');
    case 'idle':
    default:
      return t('settings.plugins.runtime.idle');
  }
}

function sortPluginListItems(items: PluginListItem[]): PluginListItem[] {
  return [...items].sort((left, right) => left.name.localeCompare(right.name) || left.publisher.localeCompare(right.publisher));
}

function formatRequirement(
  requirement: PluginRequirement,
  t: TranslateFn,
): string {
  const parts: string[] = [requirement.type];

  if (requirement.version) {
    parts.push(requirement.version);
  }

  if (requirement.command) {
    parts.push(`command=${requirement.command}`);
  }

  if (requirement.envVar) {
    parts.push(`env=${requirement.envVar}`);
  }

  if (requirement.optional) {
    parts.push(t('settings.plugins.requirementOptional'));
  }

  return parts.join(' • ');
}
