'use client';

/**
 * MasterDataSidebar — fixed left panel with Apple Liquid Glass design.
 *
 * Features:
 * - Hierarchical accordion: Countries (Level 1) → Regimes (Level 2)
 * - Spotlight-style fuzzy search bar
 * - HTML5 drag-and-drop with custom ghost image (glass card clone)
 * - iOS-style micro-badges (CIT, WHT, Substance)
 * - Strategy Copilot tooltip on long hover (~800ms)
 * - @react-spring/web soft disclosure animations
 * - Null values rendered as infinity symbol, never "No data"
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useSpring, animated, config } from '@react-spring/web';
import { projectAtom } from '@features/canvas/model/project-atom';
import { settingsAtom } from '@features/settings';
import { zonesAtom } from '@entities/zone';
import { isSidebarOpenAtom, sidebarContextAtom } from '../model/atoms';
import { masterDataAtom } from '../model/atoms';
import { t, localizedName, localizedTooltip } from '@shared/lib/i18n';
import { currencySymbol } from '@shared/lib/currency';
import { EditRegimeModal } from './EditRegimeModal';
import type { Country, TaxRegime, MasterDataEntry, JurisdictionCode } from '@shared/types';

// ─── Constants ────────────────────────────────────────────────────────────────

const COUNTRY_FLAGS: Record<string, string> = {
  KZ: '\u{1F1F0}\u{1F1FF}', UAE: '\u{1F1E6}\u{1F1EA}', HK: '\u{1F1ED}\u{1F1F0}',
  CY: '\u{1F1E8}\u{1F1FE}', SG: '\u{1F1F8}\u{1F1EC}', UK: '\u{1F1EC}\u{1F1E7}',
  US: '\u{1F1FA}\u{1F1F8}', BVI: '\u{1F1FB}\u{1F1EC}', CAY: '\u{1F1F0}\u{1F1FE}',
  SEY: '\u{1F1F8}\u{1F1E8}',
};

const SUBSTANCE_REGIMES = new Set([
  'KZ_AIFC', 'KZ_HUB', 'UAE_FZ_Q', 'UAE_FZ_NQ', 'HK_OFF', 'BVI_STD',
]);

const REGIME_TOOLTIPS: Record<string, string> = {
  KZ_AIFC: 'AIFC regime: Requires CIGA substance, registered office in Astana, and qualified employees on the ground.',
  KZ_HUB: 'Astana Hub: IT park benefits require Advance Ruling from the Ministry. Substance and revenue tests apply.',
  UAE_FZ_Q: 'Qualifying Free Zone: Must meet QFZP conditions including adequate substance, no mainland revenue, and TP compliance.',
  UAE_FZ_NQ: 'Non-Qualifying Free Zone: Standard 9% CIT applies. Consider restructuring to meet QFZP criteria.',
  HK_OFF: 'Offshore profits claim: Requires robust TP documentation, no HK-sourced income, and no HK CIGA.',
  BVI_STD: 'BVI entity: Economic Substance Act requires relevant activity, qualified employees, and physical premises.',
  CY_STD: 'Cyprus holding: IP Box and NID benefits available. Watch for EU defensive measures on dividends from low-tax jurisdictions.',
  SG_STD: 'Singapore: Consider Section 13R/13X fund incentives. WHT on services requires careful structuring.',
};

// ─── Fuzzy search helper ─────────────────────────────────────────────────────

function fuzzyMatch(query: string, text: string): boolean {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t.includes(q)) return true;
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

// ─── Custom drag ghost ──────────────────────────────────────────────────────

function createGhostElement(label: string, subtitle: string): HTMLElement {
  const el = document.createElement('div');
  const isDark = document.documentElement.classList.contains('dark');
  el.style.cssText = `
    position: fixed; top: -1000px; left: -1000px; z-index: 99999;
    padding: 10px 16px; border-radius: 16px;
    background: ${isDark ? 'rgba(30,30,30,0.90)' : 'rgba(255,255,255,0.80)'}; backdrop-filter: blur(20px);
    border: 1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.3)'};
    box-shadow: 0 12px 40px rgba(0,0,0,0.12), 0 4px 12px rgba(0,0,0,0.06);
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Inter', sans-serif;
    pointer-events: none; white-space: nowrap;
  `;
  el.innerHTML = `
    <div style="font-size:13px;font-weight:600;color:${isDark ? '#f5f5f7' : '#1d1d1f'};">${label}</div>
    <div style="font-size:11px;color:${isDark ? '#a1a1a6' : '#86868b'};margin-top:2px;">${subtitle}</div>
  `;
  document.body.appendChild(el);
  return el;
}

// ─── Rate badge color helper ────────────────────────────────────────────────

function rateBadgeColor(rate: number | null | undefined): { bg: string; text: string } {
  if (rate === null || rate === undefined) return { bg: 'rgba(0,0,0,0.04)', text: '#86868b' };
  if (rate === 0) return { bg: 'rgba(52,199,89,0.10)', text: '#248a3d' };
  if (rate <= 10) return { bg: 'rgba(0,122,255,0.08)', text: '#0071e3' };
  if (rate <= 20) return { bg: 'rgba(255,159,10,0.10)', text: '#c77c00' };
  return { bg: 'rgba(255,59,48,0.08)', text: '#d70015' };
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function MasterDataSidebar() {
  const project = useAtomValue(projectAtom);
  const settings = useAtomValue(settingsAtom);
  const lang = settings.language || 'en';
  const [isOpen, setIsOpen] = useAtom(isSidebarOpenAtom);
  const [sidebarContext, setSidebarContext] = useAtom(sidebarContextAtom);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedCountries, setExpandedCountries] = useState<Set<string>>(new Set());
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingRegime, setEditingRegime] = useState<TaxRegime | null>(null);
  const ghostRef = useRef<HTMLElement | null>(null);

  // Read canvas zones for duplicate detection
  const canvasZones = useAtomValue(zonesAtom);
  const onCanvasJurisdictions = useMemo(
    () => new Set(canvasZones.map((z) => z.jurisdiction)),
    [canvasZones],
  );
  // More specific: track regime codes already on canvas
  const onCanvasRegimeCodes = useMemo(
    () => new Set(canvasZones.filter((z) => z.parentId).map((z) => z.code)),
    [canvasZones],
  );

  // Read from masterDataAtom (persisted) with fallback to project
  const storedMasterData = useAtomValue(masterDataAtom);
  const countries: Country[] = useMemo(
    () => storedMasterData?.countries ?? project?.masterData?.countries ?? [],
    [storedMasterData?.countries, project?.masterData?.countries],
  );
  const regimes: TaxRegime[] = useMemo(
    () => storedMasterData?.regimes ?? project?.masterData?.regimes ?? [],
    [storedMasterData?.regimes, project?.masterData?.regimes],
  );
  const masterData = project?.masterData as Record<string, MasterDataEntry> | undefined;

  // ─── Filtered data ──────────────────────────────────────────────────────
  const filteredData = useMemo(() => {
    if (!searchQuery.trim()) {
      return countries.map((c) => ({
        country: c,
        regimes: regimes.filter((r) => r.countryId === c.id),
      }));
    }

    const q = searchQuery.trim();
    return countries
      .map((c) => {
        const countryRegimes = regimes.filter((r) => r.countryId === c.id);
        const countryMatches = fuzzyMatch(q, c.name) || fuzzyMatch(q, c.id) || fuzzyMatch(q, c.baseCurrency);
        const matchedRegimes = countryRegimes.filter(
          (r) =>
            fuzzyMatch(q, r.name) ||
            fuzzyMatch(q, `${r.cit}%`) ||
            fuzzyMatch(q, `CIT ${r.cit}`) ||
            (q.includes('0') && r.cit === 0) ||
            (q.toLowerCase().includes('substance') && SUBSTANCE_REGIMES.has(r.id)),
        );

        if (countryMatches) return { country: c, regimes: countryRegimes };
        if (matchedRegimes.length > 0) return { country: c, regimes: matchedRegimes };
        return null;
      })
      .filter(Boolean) as { country: Country; regimes: TaxRegime[] }[];
  }, [countries, regimes, searchQuery]);

  // Auto-expand when searching
  useEffect(() => {
    if (searchQuery.trim()) {
      setExpandedCountries(new Set(filteredData.map((d) => d.country.id)));
    }
  }, [searchQuery, filteredData]);

  const toggleCountry = useCallback((id: string) => {
    setExpandedCountries((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // ─── Drag cleanup ──────────────────────────────────────────────────────
  const cleanupGhost = useCallback(() => {
    if (ghostRef.current) {
      document.body.removeChild(ghostRef.current);
      ghostRef.current = null;
    }
  }, []);

  // ─── Country drag handlers ─────────────────────────────────────────────
  const handleCountryDragStart = useCallback(
    (e: React.DragEvent, country: Country) => {
      e.dataTransfer.setData('application/tax-country-id', country.id);
      e.dataTransfer.setData('application/tax-country-name', country.name);
      e.dataTransfer.effectAllowed = 'copy';
      (e.target as HTMLElement).style.cursor = 'grabbing';

      cleanupGhost();
      const ghost = createGhostElement(
        `${COUNTRY_FLAGS[country.id] || ''} ${country.name}`,
        `${t('country', lang)} \u00b7 ${country.baseCurrency}`,
      );
      ghostRef.current = ghost;
      e.dataTransfer.setDragImage(ghost, 60, 24);
    },
    [cleanupGhost],
  );

  const handleCountryDragEnd = useCallback(
    (e: React.DragEvent) => {
      (e.target as HTMLElement).style.cursor = '';
      cleanupGhost();
    },
    [cleanupGhost],
  );

  // ─── Regime drag handlers ──────────────────────────────────────────────
  const handleRegimeDragStart = useCallback(
    (e: React.DragEvent, regime: TaxRegime, countryName: string) => {
      e.dataTransfer.setData('application/tax-regime-id', regime.id);
      e.dataTransfer.setData('application/tax-regime-name', regime.name);
      e.dataTransfer.setData('application/tax-regime-country-id', regime.countryId);
      e.dataTransfer.effectAllowed = 'copy';
      e.stopPropagation();
      (e.target as HTMLElement).style.cursor = 'grabbing';

      cleanupGhost();
      const ghost = createGhostElement(
        regime.name,
        `${countryName} \u00b7 CIT ${regime.cit}%`,
      );
      ghostRef.current = ghost;
      e.dataTransfer.setDragImage(ghost, 60, 24);
    },
    [cleanupGhost],
  );

  const handleRegimeDragEnd = useCallback(
    (e: React.DragEvent) => {
      (e.target as HTMLElement).style.cursor = '';
      cleanupGhost();
    },
    [cleanupGhost],
  );

  // ─── Entity drag handlers ──────────────────────────────────────────
  const handleEntityDragStart = useCallback(
    (e: React.DragEvent, type: 'company' | 'person') => {
      e.dataTransfer.setData(`application/tax-node-${type}`, type);
      e.dataTransfer.effectAllowed = 'copy';
      (e.target as HTMLElement).style.cursor = 'grabbing';

      cleanupGhost();
      const label = type === 'company' ? `\u{1F3E2} ${t('company', lang)}` : `\u{1F464} ${t('person', lang)}`;
      const ghost = createGhostElement(label, t('dragToCanvas', lang));
      ghostRef.current = ghost;
      e.dataTransfer.setDragImage(ghost, 60, 24);
    },
    [cleanupGhost],
  );

  const handleEntityDragEnd = useCallback(
    (e: React.DragEvent) => {
      (e.target as HTMLElement).style.cursor = '';
      cleanupGhost();
    },
    [cleanupGhost],
  );

  // ─── Pre-expand country from context (zone click) ──────────────────────
  useEffect(() => {
    if (isOpen && sidebarContext) {
      setExpandedCountries((prev) => {
        const next = new Set(prev);
        next.add(sidebarContext);
        return next;
      });
      setSidebarContext(null);
    }
  }, [isOpen, sidebarContext, setSidebarContext]);

  // ─── Close on Escape ──────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, setIsOpen]);

  // ─── Slide animation ─────────────────────────────────────────────────
  const sidebarSpring = useSpring({
    transform: isOpen ? 'translateX(0px)' : 'translateX(-420px)',
    opacity: isOpen ? 1 : 0,
    config: config.stiff,
  });

  if (!project) return null;

  return (
    <animated.aside
      style={{
        ...sidebarSpring,
        position: 'fixed',
        left: 0,
        top: 0,
        height: '100%',
        width: '420px',
        zIndex: 40,
        background: 'var(--glass-bg)',
        backdropFilter: 'blur(12px) saturate(180%)',
        WebkitBackdropFilter: 'blur(12px) saturate(180%)',
        borderRight: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Inter', sans-serif",
        pointerEvents: isOpen ? 'auto' : 'none',
      }}
    >
      {/* ─── Header ─────────────────────────────────────────────── */}
      <div style={{ padding: '16px 20px 0', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
            {t('masterData', lang)}
          </h2>
          <button
            onClick={() => setIsOpen(false)}
            style={{
              background: 'var(--surface-secondary)',
              border: 'none',
              borderRadius: '8px',
              width: '28px',
              height: '28px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              fontSize: '14px',
              color: 'var(--text-label)',
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-hover)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-secondary)'; }}
            title={t('closeSidebar', lang)}
          >
            {'\u2715'}
          </button>
        </div>
        <p style={{ margin: '2px 0 0', fontSize: '11px', color: 'var(--text-label)' }}>
          {t('dragHint', lang)}
        </p>
      </div>

      {/* ─── Spotlight Search ───────────────────────────────────── */}
      <div style={{ padding: '12px 20px 8px', flexShrink: 0 }}>
        <div style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
        }}>
          <span style={{
            position: 'absolute',
            left: '12px',
            fontSize: '13px',
            color: 'var(--text-label)',
            pointerEvents: 'none',
            lineHeight: 1,
          }}>
            {'\u{1F50D}'}
          </span>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('search', lang)}
            style={{
              width: '100%',
              padding: '9px 12px 9px 34px',
              fontSize: '13px',
              border: '1px solid var(--border-subtle)',
              borderRadius: '12px',
              background: 'var(--surface-secondary)',
              outline: 'none',
              color: 'var(--text-primary)',
              transition: 'border-color 0.2s, box-shadow 0.2s',
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = 'var(--color-accent)';
              e.currentTarget.style.boxShadow = '0 0 0 3px rgba(0,122,255,0.15)';
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = 'var(--border-subtle)';
              e.currentTarget.style.boxShadow = 'none';
            }}
          />
        </div>
      </div>

      {/* ─── Entities Section (sticky) ─────────────────────────── */}
      <div style={{
        padding: '8px 12px',
        borderBottom: '1px solid var(--border-subtle)',
        flexShrink: 0,
      }}>
        <div style={{
          fontSize: '11px',
          fontWeight: 600,
          color: 'var(--text-label)',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          padding: '4px 12px 8px',
        }}>
          {t('entities', lang)}
        </div>
        {(['company', 'person'] as const).map((type) => {
          const icon = type === 'company' ? '\u{1F3E2}' : '\u{1F464}';
          const label = type === 'company' ? t('company', lang) : t('person', lang);
          return (
            <div
              key={type}
              draggable
              onDragStart={(e) => handleEntityDragStart(e, type)}
              onDragEnd={handleEntityDragEnd}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 12px',
                borderRadius: '10px',
                cursor: 'grab',
                userSelect: 'none',
                transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-hover)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
            >
              <span style={{ fontSize: '16px', lineHeight: 1, flexShrink: 0 }}>{icon}</span>
              <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)', flex: 1 }}>{label}</span>
              <span style={{
                fontSize: '10px',
                color: 'var(--text-tertiary)',
                letterSpacing: '1px',
                width: '12px',
                flexShrink: 0,
              }}>
                {'\u22ee\u22ee'}
              </span>
            </div>
          );
        })}
      </div>

      {/* ─── Scrollable list ───────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 12px 16px' }}>
        {filteredData.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-label)', fontSize: '13px' }}>
            {t('noMatching', lang)}
          </div>
        )}

        {filteredData.map(({ country, regimes: countryRegimes }) => (
          <CountryRow
            key={country.id}
            country={country}
            regimes={countryRegimes}
            masterEntry={masterData?.[country.id as JurisdictionCode]}
            isExpanded={expandedCountries.has(country.id)}
            onToggle={toggleCountry}
            onCountryDragStart={handleCountryDragStart}
            onCountryDragEnd={handleCountryDragEnd}
            onRegimeDragStart={handleRegimeDragStart}
            onRegimeDragEnd={handleRegimeDragEnd}
            isEditMode={isEditMode}
            onEditRegime={setEditingRegime}
            isOnCanvas={onCanvasJurisdictions.has(country.id as JurisdictionCode)}
            onCanvasRegimeCodes={onCanvasRegimeCodes}
            lang={lang}
          />
        ))}
      </div>

      {/* Edit Master Data toggle */}
      <div style={{
        padding: '12px 20px',
        borderTop: '1px solid var(--border-subtle)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)' }}>
          {t('editMasterData', lang)}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={isEditMode}
          onClick={() => setIsEditMode(!isEditMode)}
          style={{
            position: 'relative',
            width: '44px',
            height: '24px',
            borderRadius: '12px',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
            flexShrink: 0,
            background: isEditMode ? 'var(--color-accent)' : 'var(--border-primary)',
            transition: 'background 0.2s',
            boxShadow: 'inset 0 1px 3px rgba(0, 0, 0, 0.06)',
          }}
        >
          <div style={{
            position: 'absolute',
            top: '2px',
            left: isEditMode ? '22px' : '2px',
            width: '20px',
            height: '20px',
            borderRadius: '10px',
            background: '#ffffff',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.15)',
            transition: 'left 0.2s',
          }} />
        </button>
      </div>

      {/* Edit Regime Modal */}
      {editingRegime && (
        <EditRegimeModal
          regime={editingRegime}
          onClose={() => setEditingRegime(null)}
        />
      )}
    </animated.aside>
  );
}

// ─── Country Row (Level 1) ──────────────────────────────────────────────────

interface CountryRowProps {
  country: Country;
  regimes: TaxRegime[];
  masterEntry: MasterDataEntry | undefined;
  isExpanded: boolean;
  onToggle: (id: string) => void;
  onCountryDragStart: (e: React.DragEvent, country: Country) => void;
  onCountryDragEnd: (e: React.DragEvent) => void;
  onRegimeDragStart: (e: React.DragEvent, regime: TaxRegime, countryName: string) => void;
  onRegimeDragEnd: (e: React.DragEvent) => void;
  isEditMode: boolean;
  onEditRegime: (regime: TaxRegime) => void;
  isOnCanvas: boolean;
  onCanvasRegimeCodes: Set<string>;
  lang: 'en' | 'ru';
}

function CountryRow({
  country,
  regimes,
  masterEntry,
  isExpanded,
  onToggle,
  onCountryDragStart,
  onCountryDragEnd,
  onRegimeDragStart,
  onRegimeDragEnd,
  isEditMode,
  onEditRegime,
  isOnCanvas,
  onCanvasRegimeCodes,
  lang,
}: CountryRowProps) {
  const [isHovered, setIsHovered] = useState(false);

  // ─── Accordion spring ──────────────────────────────────────────────────
  const disclosureSpring = useSpring({
    height: isExpanded ? regimes.length * 44 + 8 : 0,
    opacity: isExpanded ? 1 : 0,
    config: { tension: 280, friction: 24 },
  });

  const chevronSpring = useSpring({
    transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
    config: config.stiff,
  });

  const vatRate = masterEntry?.vatRateStandard;

  return (
    <div style={{ marginBottom: '2px' }}>
      {/* Country header */}
      <div
        draggable={!isEditMode && !isOnCanvas}
        onDragStart={(e) => !isEditMode && !isOnCanvas && onCountryDragStart(e, country)}
        onDragEnd={onCountryDragEnd}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onClick={() => onToggle(country.id)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '10px 12px',
          borderRadius: '14px',
          background: isHovered ? 'var(--surface-hover)' : 'transparent',
          cursor: isOnCanvas ? 'default' : isEditMode ? 'pointer' : 'grab',
          userSelect: 'none',
          transition: 'background 0.15s',
          opacity: isOnCanvas ? 0.5 : 1,
        }}
      >
        {/* Gripper or checkmark */}
        {!isEditMode && (
          isOnCanvas ? (
            <span style={{
              fontSize: '12px',
              width: '12px',
              flexShrink: 0,
              textAlign: 'center',
              lineHeight: 1,
            }}>
              {'\u2705'}
            </span>
          ) : (
            <span style={{
              fontSize: '10px',
              color: 'var(--text-tertiary)',
              letterSpacing: '1px',
              width: '12px',
              flexShrink: 0,
              opacity: isHovered ? 1 : 0,
              transition: 'opacity 0.15s',
            }}>
              {'\u22ee\u22ee'}
            </span>
          )
        )}

        {/* Chevron */}
        <animated.span style={{
          ...chevronSpring,
          fontSize: '9px',
          color: 'var(--text-label)',
          flexShrink: 0,
          display: 'inline-block',
          width: '10px',
          textAlign: 'center',
        }}>
          {'\u25B6'}
        </animated.span>

        {/* Flag */}
        <span style={{ fontSize: '18px', lineHeight: 1, flexShrink: 0 }}>
          {COUNTRY_FLAGS[country.id] || '\u{1F3F3}'}
        </span>

        {/* Name */}
        <span style={{
          flex: 1,
          fontSize: '14px',
          fontWeight: 600,
          color: 'var(--text-primary)',
          letterSpacing: '-0.01em',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {localizedName(country.name, lang)}
        </span>

        {/* VAT badge (if available) */}
        {vatRate !== undefined && vatRate > 0 && (
          <span style={{
            ...badgeBase,
            ...rateBadgeColor(vatRate * 100),
            background: rateBadgeColor(vatRate * 100).bg,
            color: rateBadgeColor(vatRate * 100).text,
          }}>
            VAT {Math.round(vatRate * 100)}%
          </span>
        )}

        {/* Currency badge */}
        <span style={{
          ...badgeBase,
          background: 'var(--surface-secondary)',
          color: 'var(--text-label)',
        }}>
          {country.baseCurrency}
        </span>
      </div>

      {/* Regimes accordion body */}
      <animated.div style={{
        ...disclosureSpring,
        overflow: 'hidden',
        paddingLeft: '20px',
      }}>
        <div style={{ paddingTop: '4px', paddingBottom: '4px' }}>
          {regimes.map((regime) => {
            // Check if this specific regime is already on canvas
            const regimeOnCanvas = onCanvasRegimeCodes.has(regime.id) ||
              onCanvasRegimeCodes.has(`${regime.countryId}_${regime.id}`);
            return (
              <RegimeRow
                key={regime.id}
                regime={regime}
                countryName={country.name}
                onDragStart={onRegimeDragStart}
                onDragEnd={onRegimeDragEnd}
                isEditMode={isEditMode}
                onEditRegime={onEditRegime}
                isOnCanvas={regimeOnCanvas}
                lang={lang}
              />
            );
          })}
        </div>
      </animated.div>
    </div>
  );
}

// ─── Regime Row (Level 2) ───────────────────────────────────────────────────

interface RegimeRowProps {
  regime: TaxRegime;
  countryName: string;
  onDragStart: (e: React.DragEvent, regime: TaxRegime, countryName: string) => void;
  onDragEnd: (e: React.DragEvent) => void;
  isEditMode: boolean;
  onEditRegime: (regime: TaxRegime) => void;
  isOnCanvas: boolean;
  lang: 'en' | 'ru';
}

function RegimeRow({ regime, countryName, onDragStart, onDragEnd, isEditMode, onEditRegime, isOnCanvas, lang }: RegimeRowProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [tooltip, setTooltip] = useState<{ x: number; y: number } | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);

  const hasSubstance = SUBSTANCE_REGIMES.has(regime.id);
  const tooltipText = localizedTooltip(regime.id, lang) ?? REGIME_TOOLTIPS[regime.id];

  // ─── Long-hover tooltip (800ms) ────────────────────────────────────────
  const handleMouseEnter = useCallback(
    (e: React.MouseEvent) => {
      setIsHovered(true);
      if (tooltipText) {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        hoverTimerRef.current = setTimeout(() => {
          setTooltip({ x: rect.right + 8, y: rect.top });
        }, 800);
      }
    },
    [tooltipText],
  );

  const handleMouseLeave = useCallback(() => {
    setIsHovered(false);
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    setTooltip(null);
  }, []);

  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    };
  }, []);

  const citColor = rateBadgeColor(regime.cit);
  const whtColor = rateBadgeColor(regime.wht);

  return (
    <>
      <div
        ref={rowRef}
        draggable={!isEditMode && !isOnCanvas}
        onDragStart={(e) => !isEditMode && !isOnCanvas && onDragStart(e, regime, countryName)}
        onDragEnd={onDragEnd}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '7px 12px',
          marginBottom: '2px',
          borderRadius: '10px',
          borderLeft: '2px solid var(--border-subtle)',
          background: isHovered ? 'var(--surface-hover)' : 'transparent',
          cursor: isOnCanvas ? 'default' : isEditMode ? 'pointer' : 'grab',
          userSelect: 'none',
          transition: 'background 0.15s',
          opacity: isOnCanvas ? 0.5 : 1,
        }}
      >
        {/* Gripper, checkmark, or edit icon */}
        {!isEditMode && (
          isOnCanvas ? (
            <span style={{
              fontSize: '11px',
              width: '10px',
              flexShrink: 0,
              textAlign: 'center',
              lineHeight: 1,
            }}>
              {'\u2705'}
            </span>
          ) : (
            <span style={{
              fontSize: '9px',
              color: 'var(--text-tertiary)',
              letterSpacing: '1px',
              width: '10px',
              flexShrink: 0,
              opacity: isHovered ? 1 : 0,
              transition: 'opacity 0.15s',
            }}>
              {'\u22ee\u22ee'}
            </span>
          )
        )}

        {/* Edit icon — visible in edit mode */}
        {isEditMode && (
          <button
            onClick={(e) => { e.stopPropagation(); onEditRegime(regime); }}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: '13px',
              padding: '0 2px',
              flexShrink: 0,
              lineHeight: 1,
              opacity: 0.7,
              transition: 'opacity 0.15s',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.opacity = '1'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.opacity = '0.7'; }}
            title={t('editRegimeHint', lang)}
          >
            {'\u270f\ufe0f'}
          </button>
        )}

        {/* Name */}
        <span style={{
          flex: 1,
          fontSize: '13px',
          fontWeight: 400,
          color: 'var(--text-secondary)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {localizedName(regime.name, lang)}
        </span>

        {/* CIT badge */}
        <span style={{ ...badgeBase, background: citColor.bg, color: citColor.text }}>
          CIT {regime.cit ?? '\u221e'}%
        </span>

        {/* WHT badge */}
        {(regime.wht !== null && regime.wht !== undefined) ? (
          <span style={{ ...badgeBase, background: whtColor.bg, color: whtColor.text }}>
            WHT {regime.wht}%
          </span>
        ) : (
          <span style={{ ...badgeBase, background: 'var(--surface-secondary)', color: 'var(--text-label)' }}>
            WHT {'\u221e'}
          </span>
        )}

        {/* Substance shield */}
        {hasSubstance && (
          <span style={{
            ...badgeBase,
            background: 'rgba(255, 159, 10, 0.10)',
            color: '#c77c00',
            fontSize: '10px',
          }}
          title={t('substanceReq', lang)}
          >
            {'\u{1F6E1}'} {t('substance', lang)}
          </span>
        )}
      </div>

      {/* Strategy Copilot Tooltip */}
      {tooltip && tooltipText && (
        <CopilotTooltip x={tooltip.x} y={tooltip.y} text={tooltipText} lang={lang} />
      )}
    </>
  );
}

// ─── Strategy Copilot Tooltip ───────────────────────────────────────────────

function CopilotTooltip({ x, y, text, lang }: { x: number; y: number; text: string; lang: 'en' | 'ru' }) {
  const spring = useSpring({
    from: { opacity: 0, transform: 'scale(0.96) translateX(-4px)' },
    to: { opacity: 1, transform: 'scale(1) translateX(0px)' },
    config: { tension: 340, friction: 26 },
  });

  // Clamp so tooltip doesn't overflow viewport
  const clampedY = Math.min(y, typeof window !== 'undefined' ? window.innerHeight - 120 : y);

  return createPortal(
    <animated.div
      style={{
        ...spring,
        position: 'fixed',
        left: `${x}px`,
        top: `${clampedY}px`,
        zIndex: 9999,
        width: '260px',
        padding: '14px 16px',
        borderRadius: '16px',
        background: 'var(--glass-bg-heavy)',
        backdropFilter: 'blur(20px) saturate(180%)',
        WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        border: '1px solid var(--glass-border)',
        boxShadow: '0 12px 40px rgba(0, 0, 0, 0.12), 0 4px 12px rgba(0, 0, 0, 0.06)',
        pointerEvents: 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
        <span style={{ fontSize: '12px' }}>{'\u2728'}</span>
        <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-label)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
          {t('strategyCopilot', lang)}
        </span>
      </div>
      <p style={{
        margin: 0,
        fontSize: '12px',
        lineHeight: 1.5,
        color: 'var(--text-secondary)',
        fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Inter', sans-serif",
      }}>
        {text}
      </p>
    </animated.div>,
    document.body,
  );
}

// ─── Shared badge style ─────────────────────────────────────────────────────

const badgeBase: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '2px',
  padding: '2px 7px',
  borderRadius: '6px',
  fontSize: '10px',
  fontWeight: 600,
  letterSpacing: '0.01em',
  whiteSpace: 'nowrap',
  lineHeight: '16px',
  flexShrink: 0,
};
