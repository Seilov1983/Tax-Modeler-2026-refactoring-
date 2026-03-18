'use client';

/**
 * EditRegimeModal — Apple Liquid Glass modal for editing tax regime properties.
 *
 * Editable fields: name, citRate, vatRate (wht), substanceRequired.
 * Saves directly to masterDataAtom (atomWithStorage → localStorage).
 *
 * Presentation layer only — Jotai state mutations are untouched.
 * Spring animations preserved. Inline styles replaced with Tailwind + shadcn/ui.
 */

import { useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useSetAtom, useAtomValue } from 'jotai';
import { useSpring, animated, config } from '@react-spring/web';
import { masterDataAtom } from '../model/atoms';
import { settingsAtom } from '@features/settings';
import { t } from '@shared/lib/i18n';
import type { TaxRegime } from '@shared/types';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';

interface EditRegimeModalProps {
  regime: TaxRegime;
  onClose: () => void;
}

export function EditRegimeModal({ regime, onClose }: EditRegimeModalProps) {
  const setMasterData = useSetAtom(masterDataAtom);
  const settings = useAtomValue(settingsAtom);
  const lang = settings.language || 'en';

  const [name, setName] = useState(regime.name);
  const [cit, setCit] = useState(String(regime.cit));
  const [wht, setWht] = useState(String(regime.wht));
  const [substance, setSubstance] = useState(false);

  const handleSave = useCallback(() => {
    setMasterData((prev) => ({
      ...prev,
      regimes: prev.regimes.map((r) =>
        r.id === regime.id
          ? { ...r, name, cit: parseFloat(cit) || 0, wht: parseFloat(wht) || 0 }
          : r,
      ),
    }));
    onClose();
  }, [regime.id, name, cit, wht, setMasterData, onClose]);

  const backdropSpring = useSpring({
    from: { opacity: 0 },
    to: { opacity: 1 },
    config: { tension: 300, friction: 30 },
  });

  const modalSpring = useSpring({
    from: { opacity: 0, transform: 'scale(0.95) translateY(8px)' },
    to: { opacity: 1, transform: 'scale(1) translateY(0px)' },
    config: config.stiff,
  });

  return createPortal(
    <animated.div
      style={backdropSpring}
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/30 backdrop-blur-sm"
      onClick={onClose}
    >
      <animated.div
        style={modalSpring}
        className="flex w-[380px] max-w-[calc(100vw-32px)] flex-col rounded-3xl border border-white/25 bg-white/72 shadow-lg backdrop-blur-[40px] backdrop-saturate-[180%] dark:border-white/10 dark:bg-black/60"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-black/5 px-6 py-5 dark:border-white/5">
          <h2 className="text-lg font-semibold tracking-tight text-gray-900 dark:text-gray-100">
            {t('editRegime', lang)}
          </h2>
          <button
            onClick={onClose}
            className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-black/5 text-sm text-gray-500 transition-colors hover:bg-black/10 hover:text-gray-700 dark:bg-white/10 dark:text-gray-400 dark:hover:bg-white/20"
            aria-label="Close"
          >
            &#215;
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-col gap-5 px-6 py-5">
          {/* Name */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="regime-name">{t('name', lang)}</Label>
            <Input
              id="regime-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {/* CIT Rate */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="regime-cit">{t('citRate', lang)}</Label>
            <Input
              id="regime-cit"
              type="number"
              value={cit}
              onChange={(e) => setCit(e.target.value)}
              min="0"
              max="100"
              step="0.5"
            />
          </div>

          {/* VAT / WHT Rate */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="regime-wht">{t('vatRate', lang)}</Label>
            <Input
              id="regime-wht"
              type="number"
              value={wht}
              onChange={(e) => setWht(e.target.value)}
              min="0"
              max="100"
              step="0.5"
            />
          </div>

          {/* Substance Required */}
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="regime-substance" className="mb-0 cursor-pointer">
              {t('substanceRequired', lang)}
            </Label>
            <Switch
              id="regime-substance"
              checked={substance}
              onCheckedChange={setSubstance}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2.5 px-6 pb-6">
          <Button variant="outline" onClick={onClose}>
            {t('cancel', lang)}
          </Button>
          <Button onClick={handleSave}>
            {t('save', lang)}
          </Button>
        </div>
      </animated.div>
    </animated.div>,
    document.body,
  );
}
