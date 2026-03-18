'use client';

/**
 * SettingsModal — Apple Liquid Glass settings panel.
 *
 * Now uses shadcn/ui Dialog, Select, Switch, Label primitives
 * while preserving Jotai state management and i18n.
 *
 * NOTE: The spring-animated ToggleSwitch has been replaced with
 * the Radix Switch (CSS transitions). Modal animation is handled
 * by Radix Dialog + Tailwind animate utilities.
 */

import { useCallback } from 'react';
import { useAtom, useSetAtom } from 'jotai';
import { settingsAtom, settingsOpenAtom } from '../model/settings-atom';
import type { ThemeMode, Language } from '../model/settings-atom';
import { t } from '@shared/lib/i18n';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

export function SettingsModal() {
  const [settings, setSettings] = useAtom(settingsAtom);
  const [open, setOpen] = useAtom(settingsOpenAtom);

  const handleThemeChange = useCallback(
    (value: string) => {
      setSettings((prev) => ({ ...prev, theme: value as ThemeMode }));
    },
    [setSettings],
  );

  const handleSnapToggle = useCallback(
    (checked: boolean) => {
      setSettings((prev) => ({ ...prev, canvasSnapToGrid: checked }));
    },
    [setSettings],
  );

  const handleLanguageChange = useCallback(
    (value: string) => {
      setSettings((prev) => ({ ...prev, language: value as Language }));
    },
    [setSettings],
  );

  const lang = settings.language || 'en';

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-[425px] p-6 bg-white/70 dark:bg-zinc-900/70 backdrop-blur-xl border border-white/20 shadow-2xl rounded-3xl z-50">
        <DialogHeader className="px-0 pt-0 pb-5">
          <DialogTitle>{t('settings', lang)}</DialogTitle>
          <DialogDescription className="sr-only">
            Manage application settings including theme, language, and canvas behaviour.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* Theme */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-[13px] font-medium text-gray-900 dark:text-gray-100">
              {t('appearance', lang)}
            </Label>
            <Select value={settings.theme} onValueChange={handleThemeChange}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="light">{t('light', lang)}</SelectItem>
                <SelectItem value="dark">{t('dark', lang)}</SelectItem>
                <SelectItem value="system">{t('system', lang)}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Language */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-[13px] font-medium text-gray-900 dark:text-gray-100">
              {t('language', lang)}
            </Label>
            <Select value={lang} onValueChange={handleLanguageChange}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="ru">{'\u0420\u0443\u0441\u0441\u043a\u0438\u0439'}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Snap to Grid */}
          <div className="flex items-center justify-between rounded-xl bg-black/[0.03] dark:bg-white/5 p-3">
            <div>
              <Label className="text-[13px] font-medium text-gray-900 dark:text-gray-100">
                {t('snapToGrid', lang)}
              </Label>
              <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">
                {t('snapToGridDesc', lang)}
              </p>
            </div>
            <Switch
              checked={settings.canvasSnapToGrid}
              onCheckedChange={handleSnapToggle}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
