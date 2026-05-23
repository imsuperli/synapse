import React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useI18n } from '../i18n';
import { resolveRendererAssetUrl } from '../utils/assetUrl';
import {
  idePopupIconButtonClassName,
  idePopupOverlayClassName,
  idePopupTitleClassName,
  IdePopupShell,
} from './ui/ide-popup';

interface AboutPanelProps {
  open: boolean;
  onClose: () => void;
  appName: string;
  version: string;
}

export const AboutPanel: React.FC<AboutPanelProps> = ({
  open,
  onClose,
  appName,
  version,
}) => {
  const { t } = useI18n();
  const appLogoSrc = resolveRendererAssetUrl('resources/icon.png');

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={`${idePopupOverlayClassName} z-[60] animate-fade-in`} />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-[70] w-[min(92vw,420px)] -translate-x-1/2 -translate-y-1/2 animate-scale-in focus:outline-none">
          <IdePopupShell className="relative">
            <Dialog.Close asChild>
              <button
                className={`${idePopupIconButtonClassName} absolute right-3 top-3`}
                aria-label={t('about.close')}
                title={t('about.close')}
              >
                <X size={14} />
              </button>
            </Dialog.Close>

            <div className="px-6 pb-6 pt-6">
              <Dialog.Description className="sr-only">
                {t('about.title')}
              </Dialog.Description>

              <div className="space-y-6">
                <div className="flex items-center gap-4 pr-10">
                  <img
                    src={appLogoSrc}
                    alt={t('about.logoAlt', { appName })}
                    className="h-20 w-20 shrink-0 rounded-2xl shadow-lg"
                  />

                  <Dialog.Title className={`min-w-0 ${idePopupTitleClassName}`}>
                    {t('about.title')}
                  </Dialog.Title>
                </div>

                <div className="w-full space-y-3 rounded-xl border border-[rgb(var(--border))] bg-[color-mix(in_srgb,rgb(var(--card))_74%,transparent)] p-4 text-left">
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-sm text-[rgb(var(--muted-foreground))]">{t('about.version')}</span>
                    <span className="text-sm font-medium text-[rgb(var(--foreground))]">{version}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-sm text-[rgb(var(--muted-foreground))]">{t('about.author')}</span>
                    <span className="text-sm font-medium text-[rgb(var(--foreground))]">licheng2</span>
                  </div>
                </div>
              </div>
            </div>
          </IdePopupShell>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
