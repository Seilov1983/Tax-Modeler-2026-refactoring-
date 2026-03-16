'use client';

/**
 * MasterDataModal — hierarchical accordion (Matryoshka) for managing
 * Countries and Tax Regimes.
 *
 * Level 1: Country rows (expandable) with name + base currency selector.
 * Level 2: Regime rows nested under each country with name, CIT%, WHT%, delete.
 * Data stored flat in projectAtom.masterData.{countries,regimes}.
 */

import { useAtom, useSetAtom } from 'jotai';
import { useState, useCallback } from 'react';
import { projectAtom } from '@features/canvas/model/project-atom';
import { addZoneAtom } from '@features/canvas/model/graph-actions-atom';
import { uid } from '@shared/lib/engine/utils';
import type { Country, TaxRegime, CurrencyCode, JurisdictionCode } from '@shared/types';

const COUNTRY_CURRENCY: Record<string, CurrencyCode> = {
  KZ: 'KZT', UAE: 'AED', HK: 'HKD', CY: 'EUR', SG: 'SGD',
  UK: 'GBP', US: 'USD', BVI: 'USD', CAY: 'USD', SEY: 'SCR',
};

const CURRENCY_OPTIONS: CurrencyCode[] = [
  'KZT', 'USD', 'EUR', 'AED', 'HKD', 'SGD', 'GBP', 'SCR', 'CNY',
];

// ─── Styles ─────────────────────────────────────────────────────────────────

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
};

const modalStyle: React.CSSProperties = {
  background: '#fff', borderRadius: '10px', boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
  width: '680px', maxHeight: '80vh', display: 'flex', flexDirection: 'column',
  overflow: 'hidden',
};

const headerStyle: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '16px 20px', borderBottom: '1px solid #e5e7eb',
};

const bodyStyle: React.CSSProperties = {
  flex: 1, overflowY: 'auto', padding: '12px 20px',
};

const countryRowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '10px',
  padding: '10px 12px', background: '#f9fafb', borderRadius: '6px',
  cursor: 'grab', userSelect: 'none', marginBottom: '2px',
};

const regimeRowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '8px',
  padding: '8px 12px', marginLeft: '2rem',
  borderLeft: '2px solid #d1d5db', background: '#fff',
};

const inputSmall: React.CSSProperties = {
  border: '1px solid #d1d5db', borderRadius: '4px',
  padding: '4px 8px', fontSize: '13px', outline: 'none',
};

const selectSmall: React.CSSProperties = {
  ...inputSmall, background: '#fff', cursor: 'pointer',
};

const btnDanger: React.CSSProperties = {
  background: 'none', border: 'none', color: '#dc2626',
  cursor: 'pointer', fontSize: '16px', padding: '2px 6px',
  borderRadius: '4px', lineHeight: 1,
};

const btnAddRegime: React.CSSProperties = {
  marginLeft: '2rem', padding: '6px 12px', fontSize: '12px',
  color: '#2563eb', background: '#eff6ff', border: '1px solid #bfdbfe',
  borderRadius: '4px', cursor: 'pointer', fontWeight: 500,
  marginTop: '4px', marginBottom: '8px',
};

// ─── Component ──────────────────────────────────────────────────────────────

export function MasterDataModal({ onClose }: { onClose: () => void }) {
  const [project, setProject] = useAtom(projectAtom);
  const addZone = useSetAtom(addZoneAtom);
  const [expandedCountries, setExpandedCountries] = useState<Set<string>>(new Set());

  const countries: Country[] = project?.masterData?.countries ?? [];
  const regimes: TaxRegime[] = project?.masterData?.regimes ?? [];

  const toggleCountry = useCallback((id: string) => {
    setExpandedCountries((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // ─── Country mutations ──────────────────────────────────────────────────

  const updateCountry = useCallback(
    (countryId: string, field: keyof Country, value: string) => {
      setProject((prev) => {
        if (!prev) return prev;
        const updatedCountries = (prev.masterData.countries ?? []).map((c) =>
          c.id === countryId ? { ...c, [field]: value } : c,
        );
        return { ...prev, masterData: { ...prev.masterData, countries: updatedCountries } };
      });
    },
    [setProject],
  );

  const addCountry = useCallback(() => {
    const id = 'c_' + uid();
    const newCountry: Country = { id, name: 'New Country', baseCurrency: 'USD' };
    setProject((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        masterData: {
          ...prev.masterData,
          countries: [...(prev.masterData.countries ?? []), newCountry],
        },
      };
    });
    setExpandedCountries((prev) => new Set(prev).add(id));
  }, [setProject]);

  const deleteCountry = useCallback(
    (countryId: string) => {
      if (!project) return;

      // Check if any zone on the canvas uses this country as jurisdiction
      const hasZone = project.zones.some(
        (z) => z.jurisdiction === countryId || z.code?.startsWith(countryId + '_'),
      );
      if (hasZone) {
        alert('Cannot delete: This jurisdiction is currently in use on the canvas.');
        return;
      }

      // Check if any regime of this country is used by nodes
      const countryRegimeIds = new Set(
        (project.masterData.regimes ?? [])
          .filter((r) => r.countryId === countryId)
          .map((r) => r.id),
      );
      const regimeInUse = project.nodes.some(
        (n) => n.regimeId && countryRegimeIds.has(n.regimeId),
      );
      if (regimeInUse) {
        alert('Cannot delete: This jurisdiction has regimes currently in use on the canvas.');
        return;
      }

      setProject((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          masterData: {
            ...prev.masterData,
            countries: (prev.masterData.countries ?? []).filter((c) => c.id !== countryId),
            regimes: (prev.masterData.regimes ?? []).filter((r) => r.countryId !== countryId),
          },
        };
      });
    },
    [setProject, project],
  );

  // ─── Regime mutations ───────────────────────────────────────────────────

  const updateRegime = useCallback(
    (regimeId: string, field: keyof TaxRegime, value: string | number) => {
      setProject((prev) => {
        if (!prev) return prev;
        const updatedRegimes = (prev.masterData.regimes ?? []).map((r) =>
          r.id === regimeId ? { ...r, [field]: value } : r,
        );
        return { ...prev, masterData: { ...prev.masterData, regimes: updatedRegimes } };
      });
    },
    [setProject],
  );

  const addRegime = useCallback(
    (countryId: string) => {
      const newRegime: TaxRegime = {
        id: 'reg_' + uid(),
        countryId,
        name: 'New Regime',
        cit: 0,
        wht: 0,
      };
      setProject((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          masterData: {
            ...prev.masterData,
            regimes: [...(prev.masterData.regimes ?? []), newRegime],
          },
        };
      });
    },
    [setProject],
  );

  const deleteRegime = useCallback(
    (regimeId: string) => {
      if (!project) return;

      // Check if any node on the canvas uses this regime
      const inUse = project.nodes.some((n) => n.regimeId === regimeId);
      if (inUse) {
        alert('Cannot delete: This regime is currently in use on the canvas.');
        return;
      }

      setProject((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          masterData: {
            ...prev.masterData,
            regimes: (prev.masterData.regimes ?? []).filter((r) => r.id !== regimeId),
          },
        };
      });
    },
    [setProject, project],
  );

  // ─── One-click add country as zone to canvas ─────────────────────────

  const handleAddToCanvas = useCallback(
    (country: Country) => {
      addZone({
        jurisdiction: country.id as JurisdictionCode,
        code: `${country.id}_${Date.now().toString(36).toUpperCase()}`,
        name: country.name,
        currency: COUNTRY_CURRENCY[country.id] || country.baseCurrency || 'USD',
        x: 100,
        y: 100,
        w: 600,
        h: 400,
      });
      // Modal stays open for continuous addition
    },
    [addZone],
  );

  // ─── One-click add regime as sub-zone to canvas ───────────────────────

  const handleAddRegimeToCanvas = useCallback(
    (regime: TaxRegime) => {
      // Find parent country zone on canvas to position inside it
      const parentZone = project?.zones?.find((z) => z.jurisdiction === regime.countryId);
      const x = parentZone ? parentZone.x + 30 : 120;
      const y = parentZone ? parentZone.y + 60 : 120;

      addZone({
        jurisdiction: regime.countryId as JurisdictionCode,
        code: `${regime.countryId}_${regime.id}`,
        name: regime.name,
        currency: COUNTRY_CURRENCY[regime.countryId] || 'USD',
        x,
        y,
        w: 320,
        h: 250,
      });
      // Modal stays open for continuous addition
    },
    [addZone, project?.zones],
  );

  if (!project) return null;

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div
        style={modalStyle}
        onClick={(e) => e.stopPropagation()}
        className="no-canvas-events"
      >
        {/* Header */}
        <div style={headerStyle}>
          <div>
            <span style={{ fontWeight: 700, fontSize: '16px', color: '#1f2937' }}>
              Master Data — Countries & Tax Regimes
            </span>
            <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '2px' }}>
              Drag a country row onto the canvas to create a zone
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: '#6b7280', lineHeight: 1 }}
          >
            {'\u00d7'}
          </button>
        </div>

        {/* Body — accordion */}
        <div style={bodyStyle}>
          {countries.map((country) => {
            const isExpanded = expandedCountries.has(country.id);
            const countryRegimes = regimes.filter((r) => r.countryId === country.id);

            return (
              <div key={country.id} style={{ marginBottom: '4px' }}>
                {/* Country Row (Level 1) — draggable to canvas */}
                <div
                  style={countryRowStyle}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/tax-country-id', country.id);
                    e.dataTransfer.setData('application/tax-country-name', country.name);
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                >
                  {/* Chevron */}
                  <span
                    onClick={() => toggleCountry(country.id)}
                    style={{ fontSize: '12px', width: '16px', textAlign: 'center', color: '#6b7280', flexShrink: 0 }}
                  >
                    {isExpanded ? '\u25BC' : '\u25B6'}
                  </span>

                  {/* Country name */}
                  <span
                    onClick={() => toggleCountry(country.id)}
                    style={{ flex: 1, fontWeight: 600, fontSize: '14px', color: '#1f2937' }}
                  >
                    {country.name}
                  </span>

                  {/* Regime count badge */}
                  <span style={{ fontSize: '11px', color: '#9ca3af', marginRight: '4px' }}>
                    {countryRegimes.length} regime{countryRegimes.length !== 1 ? 's' : ''}
                  </span>

                  {/* Base currency selector */}
                  <select
                    value={country.baseCurrency}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => updateCountry(country.id, 'baseCurrency', e.target.value)}
                    style={{ ...selectSmall, width: '80px' }}
                  >
                    {CURRENCY_OPTIONS.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>

                  {/* One-click add to canvas */}
                  <button
                    onClick={(e) => { e.stopPropagation(); handleAddToCanvas(country); }}
                    title="Add zone to canvas"
                    style={{
                      background: '#eff6ff', border: '1px solid #bfdbfe', color: '#2563eb',
                      fontSize: '11px', fontWeight: 600, padding: '3px 8px',
                      borderRadius: '4px', cursor: 'pointer', whiteSpace: 'nowrap',
                    }}
                  >
                    + Canvas
                  </button>

                  {/* Delete country */}
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteCountry(country.id); }}
                    style={btnDanger}
                    title="Delete country and all its regimes"
                  >
                    {'\u2715'}
                  </button>
                </div>

                {/* Regime Rows (Level 2) — only when expanded */}
                {isExpanded && (
                  <>
                    {countryRegimes.map((regime) => (
                      <div
                        key={regime.id}
                        style={{ ...regimeRowStyle, cursor: 'grab' }}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData('application/tax-regime-id', regime.id);
                          e.dataTransfer.setData('application/tax-regime-name', regime.name);
                          e.dataTransfer.setData('application/tax-regime-country-id', regime.countryId);
                          e.dataTransfer.effectAllowed = 'copy';
                        }}
                      >
                        {/* Regime name */}
                        <input
                          type="text"
                          value={regime.name}
                          onChange={(e) => updateRegime(regime.id, 'name', e.target.value)}
                          style={{ ...inputSmall, flex: 1 }}
                          placeholder="Regime name"
                        />

                        {/* CIT % */}
                        <label style={{ fontSize: '11px', color: '#6b7280' }}>CIT%</label>
                        <input
                          type="number"
                          value={regime.cit}
                          onChange={(e) => updateRegime(regime.id, 'cit', parseFloat(e.target.value) || 0)}
                          style={{ ...inputSmall, width: '60px', textAlign: 'right' }}
                          step="0.1"
                          min="0"
                          max="100"
                        />

                        {/* WHT % */}
                        <label style={{ fontSize: '11px', color: '#6b7280' }}>WHT%</label>
                        <input
                          type="number"
                          value={regime.wht}
                          onChange={(e) => updateRegime(regime.id, 'wht', parseFloat(e.target.value) || 0)}
                          style={{ ...inputSmall, width: '60px', textAlign: 'right' }}
                          step="0.1"
                          min="0"
                          max="100"
                        />

                        {/* One-click add regime as sub-zone to canvas */}
                        <button
                          onClick={() => handleAddRegimeToCanvas(regime)}
                          title="Add regime as sub-zone to canvas"
                          style={{
                            background: '#eff6ff', border: '1px solid #bfdbfe', color: '#2563eb',
                            fontSize: '11px', fontWeight: 600, padding: '3px 8px',
                            borderRadius: '4px', cursor: 'pointer', whiteSpace: 'nowrap',
                          }}
                        >
                          + Canvas
                        </button>

                        {/* Delete regime */}
                        <button
                          onClick={() => deleteRegime(regime.id)}
                          style={btnDanger}
                          title="Delete regime"
                        >
                          {'\u2715'}
                        </button>
                      </div>
                    ))}

                    {/* Add regime button */}
                    <button
                      onClick={() => addRegime(country.id)}
                      style={btnAddRegime}
                    >
                      + Add Tax Regime
                    </button>
                  </>
                )}
              </div>
            );
          })}

          {/* Add country button */}
          <button
            onClick={addCountry}
            style={{
              marginTop: '12px', width: '100%', padding: '10px',
              fontSize: '13px', fontWeight: 600, color: '#16a34a',
              background: '#f0fdf4', border: '1px solid #bbf7d0',
              borderRadius: '6px', cursor: 'pointer',
            }}
          >
            + Add Country
          </button>
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 20px', borderTop: '1px solid #e5e7eb', textAlign: 'right' }}>
          <button
            onClick={onClose}
            style={{
              padding: '8px 20px', fontSize: '13px', fontWeight: 600,
              background: '#2563eb', color: '#fff', border: 'none',
              borderRadius: '6px', cursor: 'pointer',
            }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
