import React, { useMemo } from 'react';
import { highlightMatches } from '../utils/fuzzySearch';
import { formatRelativeTime, useI18n } from '../i18n';
import type { SSHProfile } from '../../shared/types/ssh';
import { TerminalTypeLogo } from './icons/TerminalTypeLogo';

interface QuickSwitcherSSHProfileItemProps {
  profile: SSHProfile;
  targetLabel: string;
  secondaryText: string;
  isSelected: boolean;
  query: string;
}

const quickSwitcherMatchHighlightClassName =
  'rounded-[4px] bg-[rgb(var(--primary))]/14 px-0.5 text-[rgb(var(--foreground))]';

export const QuickSwitcherSSHProfileItem: React.FC<QuickSwitcherSSHProfileItemProps> = React.memo(({
  profile,
  targetLabel,
  secondaryText,
  isSelected,
  query,
}) => {
  const { language, t } = useI18n();
  const nameHighlights = useMemo(() => highlightMatches(profile.name, query), [profile.name, query]);
  const secondaryHighlights = useMemo(() => highlightMatches(secondaryText, query), [secondaryText, query]);
  const visibleTags = useMemo(() => profile.tags.slice(0, 3), [profile.tags]);
  const updatedAt = useMemo(() => {
    try {
      return formatRelativeTime(profile.updatedAt, language);
    } catch {
      return '';
    }
  }, [language, profile.updatedAt]);

  return (
    <div
      className={`
        px-4 py-3 mx-3 my-2 rounded-lg cursor-pointer
        transition-all duration-150 ease-out
        border-2
        ${isSelected
          ? 'border-[rgb(var(--primary))]/72 bg-[rgb(var(--accent))] shadow-lg'
          : 'border-transparent bg-[color-mix(in_srgb,rgb(var(--card))_72%,transparent)] hover:bg-[rgb(var(--accent))]'
        }
      `}
    >
      <div className="flex gap-6">
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2 min-w-0">
            <TerminalTypeLogo variant="ssh" size="md" data-testid="quick-switcher-logo-ssh-profile" />
            <div className="min-w-0 truncate text-base font-semibold text-[rgb(var(--foreground))]">
              {nameHighlights.map((part, index) => (
                <span
                  key={index}
                  className={part.highlight ? quickSwitcherMatchHighlightClassName : ''}
                >
                  {part.text}
                </span>
              ))}
            </div>
          </div>

          <div className="truncate text-sm text-[rgb(var(--muted-foreground))]">
            {secondaryHighlights.map((part, index) => (
              <span
                key={index}
                className={part.highlight ? quickSwitcherMatchHighlightClassName : ''}
              >
                {part.text}
              </span>
            ))}
          </div>
        </div>

        <div className="flex-shrink-0 space-y-1 text-xs">
          <div className="flex items-center justify-end gap-2">
            <span className="text-[rgb(var(--muted-foreground))]">{t('sshProfileCard.target')}:</span>
            <span className="text-[rgb(var(--foreground))]">{targetLabel}</span>
          </div>

          {updatedAt ? (
            <div className="flex items-center justify-end gap-2">
              <span className="text-[rgb(var(--muted-foreground))]">{t('quickSwitcher.canvasUpdatedAt')}</span>
              <span className="text-[rgb(var(--foreground))]">{updatedAt}</span>
            </div>
          ) : null}

          {visibleTags.length > 0 ? (
            <div className="flex max-w-[260px] flex-wrap justify-end gap-1">
              {visibleTags.map((tag) => (
                <span
                  key={tag}
                  className="rounded border border-[rgb(var(--primary))]/35 bg-[rgb(var(--primary))]/10 px-1.5 py-0.5 text-[rgb(var(--primary))]"
                >
                  {tag}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
});

QuickSwitcherSSHProfileItem.displayName = 'QuickSwitcherSSHProfileItem';
