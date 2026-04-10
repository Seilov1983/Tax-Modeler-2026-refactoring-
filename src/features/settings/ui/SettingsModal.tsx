import React from 'react';
import { useSpring, animated } from '@react-spring/web';
import { useAtom } from 'jotai';
import { settingsAtom, ThemeMode, Language } from '../model/settings-atom';
import { useTheme } from 'next-themes';
import { X, Check } from 'lucide-react';
import { useTranslation } from '@shared/lib/i18n';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

const CURRENCIES = ['USD', 'EUR', 'KZT', 'AED', 'GBP', 'HKD', 'SGD'];

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [settings, setSettings] = useAtom(settingsAtom);
  const { setTheme } = useTheme();
  const { t } = useTranslation();

  const styles = useSpring({
    opacity: open ? 1 : 0,
    transform: open ? 'scale(1)' : 'scale(0.95)',
    config: { tension: 300, friction: 20 },
  });

  const handleThemeChange = (theme: ThemeMode) => {
    setSettings((prev) => ({ ...prev, theme }));
    setTheme(theme);
  };

  const handleLanguageChange = (language: Language) => {
    setSettings((prev) => ({ ...prev, language }));
  };

  const handleCurrencyChange = (baseCurrency: string) => {
    setSettings((prev) => ({ ...prev, baseCurrency }));
  };

  const toggleSnap = () => {
    setSettings((prev) => ({ ...prev, canvasSnapToGrid: !prev.canvasSnapToGrid }));
  };

  if (!open && styles.opacity.get() === 0) return null;

  return (
    <animated.div
      style={{ opacity: styles.opacity }}
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <animated.div
        style={styles}
        className="w-[420px] bg-white/70 dark:bg-slate-900/70 backdrop-blur-2xl border border-black/10 dark:border-white/10 rounded-2xl shadow-2xl p-6 text-slate-800 dark:text-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-semibold tracking-tight">{t('settings')}</h2>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-black/5 dark:hover:bg-white/10 transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-6">
          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t('theme')}</label>
            <div className="grid grid-cols-3 gap-2">
              {['light', 'dark', 'system'].map((themeKey) => (
                <button
                  key={themeKey}
                  onClick={() => handleThemeChange(themeKey as ThemeMode)}
                  className={`py-2 px-3 rounded-xl border text-sm font-medium transition-all ${settings.theme === themeKey ? 'bg-indigo-50 border-indigo-200 text-indigo-600 dark:bg-indigo-900/30 dark:border-indigo-500/30 dark:text-indigo-300' : 'bg-white/50 border-black/5 hover:border-black/10 dark:bg-black/20 dark:border-white/5 dark:hover:border-white/10'}`}
                >
                  {t(themeKey as any)}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t('language')}</label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { code: 'en', label: 'English' },
                { code: 'ru', label: 'Русский' },
              ].map((l) => (
                <button
                  key={l.code}
                  onClick={() => handleLanguageChange(l.code as Language)}
                  className={`py-2 px-3 rounded-xl border text-sm font-medium transition-all flex items-center justify-center gap-2 ${settings.language === l.code ? 'bg-indigo-50 border-indigo-200 text-indigo-600 dark:bg-indigo-900/30 dark:border-indigo-500/30 dark:text-indigo-300' : 'bg-white/50 border-black/5 hover:border-black/10 dark:bg-black/20 dark:border-white/5 dark:hover:border-white/10'}`}
                >
                  {settings.language === l.code && <Check size={16} />}
                  {l.label}
                </button>
              ))}
            </div>
          </div>

          {/* Base Currency */}
          <div className="space-y-2">
            <label className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{t('baseCurrency')}</label>
            <div className="flex flex-wrap gap-2">
              {CURRENCIES.map((c) => (
                <button
                  key={c}
                  onClick={() => handleCurrencyChange(c)}
                  className={`py-1.5 px-3 rounded-lg border text-sm font-medium transition-all ${settings.baseCurrency === c ? 'bg-indigo-50 border-indigo-200 text-indigo-600 dark:bg-indigo-900/30 dark:border-indigo-500/30 dark:text-indigo-300' : 'bg-white/50 border-black/5 hover:border-black/10 dark:bg-black/20 dark:border-white/5 dark:hover:border-white/10'}`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            <div className="space-y-0.5">
              <label className="text-sm font-semibold text-slate-800 dark:text-slate-200">{t('snapToGrid')}</label>
              <p className="text-xs text-slate-500 dark:text-slate-400">{t('snapToGridHint')}</p>
            </div>
            <button
              onClick={toggleSnap}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 ${settings.canvasSnapToGrid ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-700'}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${settings.canvasSnapToGrid ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>
        </div>
      </animated.div>
    </animated.div>
  );
}
