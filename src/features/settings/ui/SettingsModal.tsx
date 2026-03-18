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
      <DialogContent className="w-[400px]">
        <DialogHeader>
          <DialogTitle>{t('settings', lang)}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-6 px-6 pb-6 pt-2">
          {/* Theme */}
          <div>
            <Label className="mb-2 text-[13px] font-medium text-gray-900 dark:text-gray-100">
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
          <div>
            <Label className="mb-2 text-[13px] font-medium text-gray-900 dark:text-gray-100">
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
          <div className="flex items-center justify-between">
            <div>
              <Label className="mb-0.5 text-[13px] font-medium text-gray-900 dark:text-gray-100">
                {t('snapToGrid', lang)}
              </Label>
              <p className="text-xs text-gray-400 dark:text-gray-500">
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
