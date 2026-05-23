import React, { useCallback, useMemo } from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Archive, ArchiveRestore, Copy, Edit2, KeyRound, Link2, LockKeyhole, MoreHorizontal, Play, ShieldCheck, Square, Trash2 } from 'lucide-react';
import { SSHCredentialState, SSHProfile } from '../../shared/types/ssh';
import { Window, WindowStatus } from '../types/window';
import { getAggregatedStatus } from '../utils/layoutHelpers';
import { getStatusColorValue, getStatusLabelKey } from '../utils/statusHelpers';
import { useI18n } from '../i18n';
import { StatusDot } from './StatusDot';
import { TerminalTypeLogo } from './icons/TerminalTypeLogo';
import {
  ideMenuContentClassName,
  ideMenuDangerItemClassName,
  ideMenuItemClassName,
  IdeMenuItemContent,
} from './ui/ide-menu';
import {
  idePopupInteractiveListCardClassName,
  idePopupListCardFooterClassName,
  idePopupPillClassName,
  idePopupTonalButtonClassName,
  idePopupTooltipClassName,
} from './ui/ide-popup';

interface SSHProfileCardProps {
  profile: SSHProfile;
  window?: Window | null;
  credentialState?: SSHCredentialState | null;
  isConnecting?: boolean;
  onConnect?: (profile: SSHProfile) => void;
  onOpenWindow?: (window: Window) => void;
  onDestroyWindowSession?: (window: Window) => void;
  onStartWindow?: (window: Window) => void;
  onArchiveWindow?: (window: Window) => void;
  onUnarchiveWindow?: (window: Window) => void;
  onEdit?: (profile: SSHProfile) => void;
  onDuplicate?: (profile: SSHProfile) => void;
  onDelete?: (profile: SSHProfile) => void;
}

function getCardTopBorderColor(status: WindowStatus | null): string {
  if (!status || status === WindowStatus.Completed || status === WindowStatus.Paused) {
    return 'rgb(var(--border))';
  }

  return getStatusColorValue(status);
}

export const SSHProfileCard = React.memo<SSHProfileCardProps>(({
  profile,
  window,
  credentialState,
  isConnecting = false,
  onConnect,
  onOpenWindow,
  onDestroyWindowSession,
  onStartWindow,
  onArchiveWindow,
  onUnarchiveWindow,
  onEdit,
  onDuplicate,
  onDelete,
}) => {
  const { t } = useI18n();
  const badgeClassName = `${idePopupPillClassName} text-[rgb(var(--foreground))]`;
  const tagBadgeClassName = `${idePopupPillClassName} border-[rgb(var(--primary))]/45 bg-[rgb(var(--primary))]/10 text-[rgb(var(--primary))]`;
  const remoteMetaIconClassName = 'inline-flex h-6 w-6 items-center justify-center rounded-md border border-[rgb(var(--border))] bg-[var(--appearance-pane-chrome-background)]';
  const tooltipClassName = idePopupTooltipClassName;
  const cardButtonClassName = `${idePopupTonalButtonClassName} shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]`;
  const runtimeStatus = useMemo(
    () => (window ? getAggregatedStatus(window.layout) : null),
    [window],
  );
  const isWindowRunning = runtimeStatus === WindowStatus.Running || runtimeStatus === WindowStatus.WaitingForInput;
  const topBorderColor = getCardTopBorderColor(runtimeStatus);
  const statusTooltip = useMemo(() => {
    if (!runtimeStatus) {
      return null;
    }

    return t(getStatusLabelKey(runtimeStatus));
  }, [runtimeStatus, t]);

  const targetLabel = useMemo(
    () => `${profile.user}@${profile.host}:${profile.port}`,
    [profile.host, profile.port, profile.user],
  );
  const visibleTags = useMemo(
    () => profile.tags.slice(0, 3),
    [profile.tags],
  );
  const routingBadges = useMemo(() => {
    const badges: string[] = [];

    if (profile.jumpHostProfileId) {
      badges.push(t('sshProfileCard.jumpHost'));
    }

    if (profile.proxyCommand) {
      badges.push(t('sshProfileCard.proxyCommand'));
    } else if (profile.socksProxyHost) {
      badges.push(t('sshProfileCard.socksProxy'));
    } else if (profile.httpProxyHost) {
      badges.push(t('sshProfileCard.httpProxy'));
    }

    if (profile.forwardedPorts.length > 0) {
      badges.push(t('sshProfileCard.forwardedPorts', { count: profile.forwardedPorts.length }));
    }

    return badges;
  }, [
    profile.forwardedPorts.length,
    profile.httpProxyHost,
    profile.jumpHostProfileId,
    profile.proxyCommand,
    profile.socksProxyHost,
    t,
  ]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (window) {
        onOpenWindow?.(window);
      } else {
        onConnect?.(profile);
      }
    }
  }, [onConnect, onOpenWindow, profile, window]);

  const handleButtonClick = useCallback((event: React.MouseEvent, action: () => void) => {
    event.stopPropagation();
    action();
    (event.currentTarget as HTMLElement).blur();
  }, []);

  const handleCardClick = useCallback(() => {
    if (window) {
      onOpenWindow?.(window);
      return;
    }

    onConnect?.(profile);
  }, [onConnect, onOpenWindow, profile, window]);

  const handlePrimaryAction = useCallback(() => {
    if (window) {
      if (isWindowRunning) {
        onDestroyWindowSession?.(window);
      } else {
        onStartWindow?.(window);
      }
      return;
    }

    onConnect?.(profile);
  }, [isWindowRunning, onConnect, onDestroyWindowSession, onStartWindow, profile, window]);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleCardClick}
      onKeyDown={handleKeyDown}
      aria-label={`${profile.name} ${targetLabel}`}
      className={`${idePopupInteractiveListCardClassName} flex h-56 min-w-[280px] flex-col`}
      style={{ borderTop: `1px solid ${topBorderColor}` }}
    >
      {isConnecting && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-[color-mix(in_srgb,rgb(var(--background))_88%,black)] text-sm font-medium text-[rgb(var(--foreground))]">
          {t('sshProfileCard.connecting')}
        </div>
      )}

      <div className="flex-1 p-4 space-y-3 flex flex-col min-h-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <TerminalTypeLogo variant="ssh" size="md" data-testid="ssh-profile-card-logo" />
              <h3 className="text-base font-semibold text-[rgb(var(--foreground))] truncate">
                {profile.name}
              </h3>
            </div>
            <p className="text-xs text-[rgb(var(--muted-foreground))] mt-1 truncate">
              {t('sshProfileCard.target')}: {targetLabel}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {runtimeStatus && (
              <StatusDot
                status={runtimeStatus}
                size="md"
                title={statusTooltip ?? undefined}
              />
            )}
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button
                  type="button"
                  aria-label={t('common.more')}
                  onClick={(event) => event.stopPropagation()}
                  className={`flex h-8 w-8 items-center justify-center ${cardButtonClassName}`}
                >
                  <MoreHorizontal size={15} />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  className={ideMenuContentClassName}
                  side="bottom"
                  align="end"
                  sideOffset={6}
                  style={{ width: 150, minWidth: 0 }}
                  onClick={(event) => event.stopPropagation()}
                >
                  {window && (
                    !window.archived ? (
                      <DropdownMenu.Item
                        className={ideMenuItemClassName}
                        onSelect={() => onArchiveWindow?.(window)}
                        aria-label={t('terminalView.archive')}
                      >
                        <IdeMenuItemContent icon={<Archive size={14} />} label={t('terminalView.archive')} />
                      </DropdownMenu.Item>
                    ) : (
                      <DropdownMenu.Item
                        className={ideMenuItemClassName}
                        onSelect={() => onUnarchiveWindow?.(window)}
                        aria-label={t('windowCard.unarchive')}
                      >
                        <IdeMenuItemContent icon={<ArchiveRestore size={14} />} label={t('windowCard.unarchive')} />
                      </DropdownMenu.Item>
                    )
                  )}

                  <DropdownMenu.Item
                    className={ideMenuItemClassName}
                    onSelect={() => onDuplicate?.(profile)}
                    aria-label={t('sshProfileCard.duplicate')}
                  >
                    <IdeMenuItemContent icon={<Copy size={14} />} label={t('sshProfileCard.duplicate')} />
                  </DropdownMenu.Item>

                  <DropdownMenu.Item
                    className={ideMenuItemClassName}
                    onSelect={() => onEdit?.(profile)}
                    aria-label={t('sshProfileCard.edit')}
                  >
                    <IdeMenuItemContent icon={<Edit2 size={14} />} label={t('sshProfileCard.edit')} />
                  </DropdownMenu.Item>

                  <DropdownMenu.Item
                    className={ideMenuDangerItemClassName}
                    onSelect={() => onDelete?.(profile)}
                    aria-label={t('sshProfileCard.deleteCard')}
                  >
                    <IdeMenuItemContent icon={<Trash2 size={14} />} label={t('sshProfileCard.deleteCard')} />
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
        </div>

        <div className="border-t border-[rgb(var(--border))]" />

        <div className="space-y-2 flex-1 min-h-0">
          <div className="flex items-center justify-between gap-3 text-xs text-[rgb(var(--muted-foreground))]">
            <div className="flex min-w-0 items-center gap-2">
              <Link2 size={13} className="shrink-0 text-[rgb(var(--muted-foreground))]" />
              <span className="truncate">
                {t('sshProfileCard.remoteCwd')}: {profile.defaultRemoteCwd || '~'}
              </span>
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-1.5">
              <Tooltip.Provider>
                <Tooltip.Root delayDuration={300}>
                  <Tooltip.Trigger asChild>
                    <span
                      className={remoteMetaIconClassName}
                      aria-label={profile.verifyHostKeys ? t('sshProfileCard.hostKeyVerifyOn') : t('sshProfileCard.hostKeyVerifyOff')}
                    >
                      <ShieldCheck size={13} className={profile.verifyHostKeys ? 'text-emerald-400' : 'text-amber-400'} />
                    </span>
                  </Tooltip.Trigger>
                  <Tooltip.Portal>
                    <Tooltip.Content
                      className={tooltipClassName}
                      side="top"
                      sideOffset={5}
                    >
                      {profile.verifyHostKeys ? t('sshProfileCard.hostKeyVerifyOn') : t('sshProfileCard.hostKeyVerifyOff')}
                    </Tooltip.Content>
                  </Tooltip.Portal>
                </Tooltip.Root>
              </Tooltip.Provider>

              {credentialState?.hasPassword && (
                <Tooltip.Provider>
                  <Tooltip.Root delayDuration={300}>
                    <Tooltip.Trigger asChild>
                      <span
                        className={remoteMetaIconClassName}
                        aria-label={t('sshProfileCard.passwordSaved')}
                      >
                        <LockKeyhole size={13} className="text-[rgb(var(--primary))]" />
                      </span>
                    </Tooltip.Trigger>
                    <Tooltip.Portal>
                      <Tooltip.Content
                        className={tooltipClassName}
                        side="top"
                        sideOffset={5}
                      >
                        {t('sshProfileCard.passwordSaved')}
                      </Tooltip.Content>
                    </Tooltip.Portal>
                  </Tooltip.Root>
                </Tooltip.Provider>
              )}
            </div>
          </div>

          {profile.notes && (
            <Tooltip.Provider>
              <Tooltip.Root delayDuration={300}>
                <Tooltip.Trigger asChild>
                  <p className="text-xs text-[rgb(var(--muted-foreground))] line-clamp-2">
                    {profile.notes}
                  </p>
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Content
                    className={`${tooltipClassName} max-w-md break-all px-3 py-2 text-sm`}
                    side="top"
                    sideOffset={5}
                  >
                    {profile.notes}
                  </Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip.Root>
            </Tooltip.Provider>
          )}

          <div className="flex flex-wrap gap-2">
            {credentialState?.hasPassphrase && (
              <span className={badgeClassName}>
                <KeyRound size={12} className="text-violet-400" />
                {t('sshProfileCard.passphraseSaved')}
              </span>
            )}

            {routingBadges.map((badge) => (
              <span
                key={badge}
                className={badgeClassName}
              >
                {badge}
              </span>
            ))}

            {visibleTags.map((tag) => (
              <span
                key={tag}
                className={tagBadgeClassName}
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className={`${idePopupListCardFooterClassName} relative flex flex-shrink-0 items-center justify-between gap-2 !border-t-transparent px-4 py-2 before:absolute before:left-4 before:right-4 before:top-0 before:border-t before:border-[rgb(var(--border))] before:content-['']`}>
        <button
          onClick={(event) => handleButtonClick(event, handlePrimaryAction)}
          disabled={isConnecting}
          className={`flex items-center gap-1.5 pl-2 pr-3 py-1.5 text-xs ${cardButtonClassName} focus:outline-none whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-60 ${
            isWindowRunning
              ? '!text-red-500 focus:ring-2 focus:!ring-red-500/45'
              : 'text-[rgb(var(--primary))] focus:ring-2 focus:ring-[rgb(var(--ring))] font-semibold'
          }`}
          aria-label={isWindowRunning ? t('windowCard.stop') : t('windowCard.start')}
        >
          {isWindowRunning ? <Square size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
          <span>
            {isConnecting
              ? t('sshProfileCard.connecting')
              : isWindowRunning
                ? t('windowCard.stop')
                : t('windowCard.start')}
          </span>
        </button>
      </div>
    </div>
  );
});

SSHProfileCard.displayName = 'SSHProfileCard';
