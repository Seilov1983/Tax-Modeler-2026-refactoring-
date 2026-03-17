'use client';

/**
 * EditRegimeModal — Apple Liquid Glass modal for editing tax regime properties.
 *
 * Editable fields: name, citRate, vatRate (wht), substanceRequired.
 * Saves directly to masterDataAtom (atomWithStorage → localStorage).
 */

import { useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useSetAtom, useAtomValue } from 'jotai';
import { useSpring, animated, config } from '@react-spring/web';
import { masterDataAtom } from '../model/atoms';
import { settingsAtom } from '@features/settings';
import { t } from '@shared/lib/i18n';
import type { TaxRegime } from '@shared/types';

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
      style={{
        ...backdropSpring,
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.20)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
      }}
      onClick={onClose}
    >
      <animated.div
        style={{
          ...modalSpring,
          width: '380px',
          maxWidth: 'calc(100vw - 32px)',
          borderRadius: '24px',
          background: 'rgba(255, 255, 255, 0.72)',
          backdropFilter: 'blur(20px) saturate(180%)',
          WebkitBackdropFilter: 'blur(20px) saturate(180%)',
          border: '1px solid rgba(255, 255, 255, 0.25)',
          boxShadow: '0 24px 80px rgba(0, 0, 0, 0.12), 0 8px 32px rgba(0, 0, 0, 0.06)',
          display: 'flex',
          flexDirection: 'column' as const,
          fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Inter', sans-serif",
        }}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '20px 24px 16px',
            borderBottom: '1px solid rgba(0, 0, 0, 0.06)',
          }}
        >
          <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 600, color: '#1d1d1f', letterSpacing: '-0.02em' }}>
            {t('editRegime', lang)}
          </h2>
          <button
            onClick={onClose}
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
            }}
          >
            {'\u2715'}
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '20px 24px 24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Name */}
          <div>
            <label style={labelStyle}>{t('name', lang)}</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={inputStyle}
            />
          </div>

          {/* CIT Rate */}
          <div>
            <label style={labelStyle}>{t('citRate', lang)}</label>
            <input
              type="number"
              value={cit}
              onChange={(e) => setCit(e.target.value)}
              min="0"
              max="100"
              step="0.5"
              style={inputStyle}
            />
          </div>

          {/* VAT / WHT Rate */}
          <div>
            <label style={labelStyle}>{t('vatRate', lang)}</label>
            <input
              type="number"
              value={wht}
              onChange={(e) => setWht(e.target.value)}
              min="0"
              max="100"
              step="0.5"
              style={inputStyle}
            />
          </div>

          {/* Substance Required — iOS toggle */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <label style={{ ...labelStyle, marginBottom: 0 }}>{t('substanceRequired', lang)}</label>
            <button
              type="button"
              role="switch"
              aria-checked={substance}
              onClick={() => setSubstance(!substance)}
              style={{
                position: 'relative',
                width: '44px',
                height: '24px',
                borderRadius: '12px',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
                flexShrink: 0,
                background: substance ? '#34c759' : 'rgba(0, 0, 0, 0.12)',
                transition: 'background 0.2s',
                boxShadow: 'inset 0 1px 3px rgba(0, 0, 0, 0.06)',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: '2px',
                  left: substance ? '22px' : '2px',
                  width: '20px',
                  height: '20px',
                  borderRadius: '10px',
                  background: '#ffffff',
                  boxShadow: '0 1px 3px rgba(0, 0, 0, 0.15)',
                  transition: 'left 0.2s',
                }}
              />
            </button>
          </div>
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex',
          gap: '10px',
          padding: '0 24px 24px',
          justifyContent: 'flex-end',
        }}>
          <button
            onClick={onClose}
            style={{
              padding: '10px 20px',
              borderRadius: '12px',
              border: '1px solid rgba(0, 0, 0, 0.08)',
              background: 'rgba(255, 255, 255, 0.6)',
              color: '#1d1d1f',
              fontSize: '14px',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            {t('cancel', lang)}
          </button>
          <button
            onClick={handleSave}
            style={{
              padding: '10px 24px',
              borderRadius: '12px',
              border: 'none',
              background: '#007aff',
              color: '#ffffff',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {t('save', lang)}
          </button>
        </div>
      </animated.div>
    </animated.div>,
    document.body,
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '13px',
  color: '#1d1d1f',
  fontWeight: 500,
  marginBottom: '8px',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  border: '1px solid rgba(0, 0, 0, 0.08)',
  borderRadius: '12px',
  padding: '10px 14px',
  fontSize: '14px',
  outline: 'none',
  background: 'rgba(255, 255, 255, 0.6)',
  color: '#1d1d1f',
  boxSizing: 'border-box',
};
