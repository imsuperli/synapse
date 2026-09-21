import React from 'react';
import { HelpCircle } from 'lucide-react';
import { AppTooltip } from '../ui/AppTooltip';
import { idePopupTooltipClassName } from '../ui/ide-popup';

function joinClassNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

interface CompactHelpProps {
  content: React.ReactNode;
  ariaLabel?: string;
}

export function CompactHelp({ content, ariaLabel = 'Help' }: CompactHelpProps) {
  return (
    <AppTooltip
      content={<div className="max-w-[320px] whitespace-normal leading-5">{content}</div>}
      className={`!z-[10020] ${idePopupTooltipClassName} max-w-[340px]`}
      delayDuration={120}
    >
      <button
        type="button"
        aria-label={ariaLabel}
        className="inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--secondary))_64%,transparent)] text-[rgb(var(--muted-foreground))] transition-colors hover:border-[rgb(var(--ring))] hover:bg-[rgb(var(--accent))] hover:text-[rgb(var(--foreground))] focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--ring))]/45"
      >
        <HelpCircle size={12} />
      </button>
    </AppTooltip>
  );
}

interface CompactSettingsSectionProps {
  title: React.ReactNode;
  help?: React.ReactNode;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  contentClassName?: string;
  divided?: boolean;
}

export function CompactSettingsSection({
  title,
  help,
  icon,
  actions,
  children,
  className,
  contentClassName,
  divided = true,
}: CompactSettingsSectionProps) {
  const hasContent = children !== null && children !== undefined && children !== false;

  return (
    <section
      className={joinClassNames(
        'overflow-hidden rounded-[14px] border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--card))_76%,transparent)] shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]',
        className,
      )}
    >
      <div className="flex min-h-[46px] items-center justify-between gap-3 border-b border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--secondary))_38%,transparent)] px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          {icon && (
            <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_srgb,rgb(var(--accent))_78%,transparent)] text-[rgb(var(--primary))]">
              {icon}
            </span>
          )}
          <h3 className="truncate text-sm font-semibold text-[rgb(var(--foreground))]">{title}</h3>
          {help && <CompactHelp content={help} />}
        </div>

        {actions && (
          <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-2">
            {actions}
          </div>
        )}
      </div>

      {hasContent && (
        <div className={joinClassNames(divided && 'divide-y divide-[rgb(var(--border))]', contentClassName)}>
          {children}
        </div>
      )}
    </section>
  );
}

interface CompactSettingRowProps {
  label: React.ReactNode;
  children: React.ReactNode;
  help?: React.ReactNode;
  htmlFor?: string;
  disabled?: boolean;
  className?: string;
  labelClassName?: string;
  controlClassName?: string;
}

export function CompactSettingRow({
  label,
  children,
  help,
  htmlFor,
  disabled = false,
  className,
  labelClassName,
  controlClassName,
}: CompactSettingRowProps) {
  const labelNode = htmlFor ? (
    <div className={joinClassNames('flex min-w-0 items-center gap-2', labelClassName)}>
      <label
        htmlFor={htmlFor}
        className="min-w-0 truncate text-sm font-medium text-[rgb(var(--foreground))]"
      >
        {label}
      </label>
      {help && <CompactHelp content={help} />}
    </div>
  ) : (
    <div
      className={joinClassNames(
        'flex min-w-0 items-center gap-2 text-sm font-medium text-[rgb(var(--foreground))]',
        labelClassName,
      )}
    >
      <span className="truncate">{label}</span>
      {help && <CompactHelp content={help} />}
    </div>
  );

  return (
    <div
      className={joinClassNames(
        'grid min-h-[44px] grid-cols-1 items-center gap-2 px-4 py-2.5 md:grid-cols-[minmax(156px,240px)_minmax(0,1fr)] md:gap-5',
        disabled && 'opacity-55',
        className,
      )}
    >
      {labelNode}
      <div className={joinClassNames('flex min-w-0 items-center justify-end gap-2', controlClassName)}>
        {children}
      </div>
    </div>
  );
}
