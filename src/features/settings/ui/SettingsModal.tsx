'use client';

/**
 * SettingsModal — Apple Liquid Glass settings panel.
 *
 * Frosted glass backdrop, spring-animated mount, iOS-style toggle switches.
 * Reads/writes to settingsAtom (atomWithStorage → localStorage).
 *
 * Rendered via React portal to escape parent stacking context (ProjectHeader).
 */

import { useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useAtom, useSetAtom } from 'jotai';
import { useSpring, animated, config } from '@react-spring/web';
import { settingsAtom, settingsOpenAtom } from '../model/settings-atom';
import type { ThemeMode, Language } from '../model/settings-atom';
import { t } from '@shared/lib/i18n';

export function SettingsModal() {
  const [settings, setSettings] = useAtom(settingsAtom);
  const setOpen = useSetAtom(settingsOpenAtom);

  const handleClose = useCallback(() => setOpen(false), [setOpen]);

  const handleThemeChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      setSettings((prev) => ({ ...prev, theme: e.target.value as ThemeMode }));
    },
    [setSettings],
  );

  const handleSnapToggle = useCallback(() => {
    setSettings((prev) => ({ ...prev, canvasSnapToGrid: !prev.canvasSnapToGrid }));
  }, [setSettings]);

  const handleLanguageChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      setSettings((prev) => ({ ...prev, language: e.target.value as Language }));
    },
    [setSettings],
  );

  const lang = settings.language || 'en';

  // ─── Spring animations ──────────────────────────────────────────────────
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
      style={{
        ...backdropSpring,
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.20)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
      }}
      onClick={handleClose}
    >
      <animated.div
        style={{
          ...modalSpring,
          width: '400px',
          maxWidth: 'calc(100vw - 32px)',
          maxHeight: '90vh',
          borderRadius: '24px',
          background: 'rgba(255, 255, 255, 0.72)',
          backdropFilter: 'blur(20px) saturate(180%)',
          WebkitBackdropFilter: 'blur(20px) saturate(180%)',
          border: '1px solid rgba(255, 255, 255, 0.25)',
          boxShadow: '0 24px 80px rgba(0, 0, 0, 0.12), 0 8px 32px rgba(0, 0, 0, 0.06)',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column' as const,
        }}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      >
        {/* ─── Header ──────────────────────────────────────────────── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '20px 24px 16px',
            borderBottom: '1px solid rgba(0, 0, 0, 0.06)',
            flexShrink: 0,
          }}
        >
          <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 600, color: '#1d1d1f', letterSpacing: '-0.02em' }}>
            {t('settings', lang)}
          </h2>
          <button
            onClick={handleClose}
            style={{
              width: '28px',
              height: '28px',
              borderRadius: '50%',
              border: 'none',
              background: 'rgba(0, 0, 0, 0.06)',
              color: '#86868b',
              fontSize: '14px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background 0.15s',
            }}
            aria-label="Close settings"
          >
            {'\u2715'}
          </button>
        </div>

        {/* ─── Body ────────────────────────────────────────────────── */}
        <div style={{ padding: '20px 24px 24px', display: 'flex', flexDirection: 'column', gap: '24px', overflowY: 'auto' }}>

          {/* Theme */}
          <div>
            <label style={labelStyle}>{t('appearance', lang)}</label>
            <select
              value={settings.theme}
              onChange={handleThemeChange}
              style={selectStyle}
            >
              <option value="light">{t('light', lang)}</option>
              <option value="dark">{t('dark', lang)}</option>
              <option value="system">{t('system', lang)}</option>
            </select>
          </div>

          {/* Language */}
          <div>
            <label style={labelStyle}>{t('language', lang)}</label>
            <select
              value={lang}
              onChange={handleLanguageChange}
              style={selectStyle}
            >
              <option value="en">English</option>
              <option value="ru">{'\u0420\u0443\u0441\u0441\u043a\u0438\u0439'}</option>
            </select>
          </div>

          {/* Snap to Grid — iOS toggle */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div>
              <label style={{ ...labelStyle, marginBottom: '2px' }}>{t('snapToGrid', lang)}</label>
              <p style={{ margin: 0, fontSize: '12px', color: '#86868b' }}>
                {t('snapToGridDesc', lang)}
              </p>
            </div>
            <ToggleSwitch
              checked={settings.canvasSnapToGrid}
              onChange={handleSnapToggle}
            />
          </div>
        </div>
      </animated.div>
    </animated.div>,
    document.body,
  );
}

// ─── iOS-style Toggle Switch ──────────────────────────────────────────────────

function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  const trackSpring = useSpring({
    background: checked ? '#34c759' : 'rgba(0, 0, 0, 0.12)',
    config: config.stiff,
  });

  const thumbSpring = useSpring({
    transform: checked ? 'translateX(20px)' : 'translateX(0px)',
    config: config.stiff,
  });

  return (
    <animated.button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      style={{
        ...trackSpring,
        position: 'relative',
        width: '44px',
        height: '24px',
        borderRadius: '12px',
        border: 'none',
        cursor: 'pointer',
        padding: 0,
        flexShrink: 0,
        transition: 'box-shadow 0.15s',
        boxShadow: 'inset 0 1px 3px rgba(0, 0, 0, 0.06)',
      }}
    >
      <animated.div
        style={{
          ...thumbSpring,
          position: 'absolute',
          top: '2px',
          left: '2px',
          width: '20px',
          height: '20px',
          borderRadius: '10px',
          background: '#ffffff',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.15), 0 1px 1px rgba(0, 0, 0, 0.06)',
        }}
      />
    </animated.button>
  );
}

// ─── Shared styles (Liquid Glass) ──────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '13px',
  color: '#1d1d1f',
  fontWeight: 500,
  marginBottom: '8px',
};

const selectStyle: React.CSSProperties = {
  width: '100%',
  border: '1px solid rgba(0, 0, 0, 0.08)',
  borderRadius: '12px',
  padding: '10px 14px',
  fontSize: '14px',
  outline: 'none',
  background: 'rgba(255, 255, 255, 0.6)',
  color: '#1d1d1f',
  cursor: 'pointer',
  transition: 'border-color 0.2s, box-shadow 0.2s',
  appearance: 'none',
  backgroundImage: `url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L5 5L9 1' stroke='%2386868b' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 12px center',
  paddingRight: '36px',
};
