'use client';

/**
 * MasterDataModal — hierarchical accordion (Matryoshka) for managing
 * Countries and Tax Regimes.
 *
 * Liquid Glass design: frosted glass backdrop, spring mount animation,
 * generous border radiuses, breathable padding.
 */

import { useAtom, useSetAtom } from 'jotai';
import { useState, useCallback, useTransition } from 'react';
import { useSpring, animated, config } from '@react-spring/web';
import { projectAtom } from '@features/canvas/model/project-atom';
import { addZoneAtom } from '@features/canvas/model/graph-actions-atom';
import { spawnCoordinatesAtom } from '@features/canvas/model/spawn-coordinates-atom';
import { uid } from '@shared/lib/engine/utils';
import type { Country, TaxRegime, CurrencyCode, JurisdictionCode } from '@shared/types';

const COUNTRY_CURRENCY: Record<string, CurrencyCode> = {
  KZ: 'KZT', UAE: 'AED', HK: 'HKD', CY: 'EUR', SG: 'SGD',
  UK: 'GBP', US: 'USD', BVI: 'USD', CAY: 'USD', SEY: 'SCR',
};

const CURRENCY_OPTIONS: CurrencyCode[] = [
  'KZT', 'USD', 'EUR', 'AED', 'HKD', 'SGD', 'GBP', 'SCR', 'CNY',
];

// ─── Component ──────────────────────────────────────────────────────────────

export function MasterDataModal({
  onClose,
  initialTab,
}: {
  onClose: () => void;
  initialTab?: 'countries' | 'regimes';
}) {
  const [project, setProject] = useAtom(projectAtom);
  const addZone = useSetAtom(addZoneAtom);
  const [spawnCoords, setSpawnCoords] = useAtom(spawnCoordinatesAtom);
  const [isPending, startTransition] = useTransition();
  const [expandedCountries, setExpandedCountries] = useState<Set<string>>(() => {
    if (initialTab === 'regimes' && spawnCoords?.parentZone) {
      return new Set([spawnCoords.parentZone.id]);
    }
    return new Set<string>();
  });

  const countries: Country[] = project?.masterData?.countries ?? [];
  const regimes: TaxRegime[] = project?.masterData?.regimes ?? [];

  // Spring animation
  const springStyles = useSpring({
    from: { opacity: 0, transform: 'scale(0.95) translateY(8px)' },
    to: { opacity: 1, transform: 'scale(1) translateY(0px)' },
    config: config.stiff,
  });

  const backdropSpring = useSpring({
    from: { opacity: 0 },
    to: { opacity: 1 },
    config: { tension: 300, friction: 30 },
  });

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
    startTransition(() => {
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
    });
    setExpandedCountries((prev) => new Set(prev).add(id));
  }, [setProject]);

  const deleteCountry = useCallback(
    (countryId: string) => {
      if (!project) return;

      const hasZone = project.zones.some(
        (z) => z.jurisdiction === countryId || z.code?.startsWith(countryId + '_'),
      );
      if (hasZone) {
        alert('Cannot delete: This jurisdiction is currently in use on the canvas.');
        return;
      }

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

  // ─── Default sizes for spawning ──────────────────────────────────────
  const COUNTRY_DEFAULT_W = 200;
  const COUNTRY_DEFAULT_H = 400;
  const REGIME_DEFAULT_W = 100;
  const REGIME_DEFAULT_H = 200;

  // ─── One-click add country as zone to canvas ─────────────────────────

  const handleAddToCanvas = useCallback(
    (country: Country) => {
      const x = spawnCoords?.x ?? 100;
      const y = spawnCoords?.y ?? 100;
      addZone({
        jurisdiction: country.id as JurisdictionCode,
        code: `${country.id}_${Date.now().toString(36).toUpperCase()}`,
        name: country.name,
        currency: COUNTRY_CURRENCY[country.id] || country.baseCurrency || 'USD',
        x,
        y,
        w: COUNTRY_DEFAULT_W,
        h: COUNTRY_DEFAULT_H,
      });
    },
    [addZone, spawnCoords],
  );

  // ─── One-click add regime as sub-zone to canvas ───────────────────────

  const handleAddRegimeToCanvas = useCallback(
    (regime: TaxRegime) => {
      const parentZone = spawnCoords?.parentZone
        ?? project?.zones?.find((z) => z.jurisdiction === regime.countryId && !z.parentId);
      const x = spawnCoords?.x ?? (parentZone ? 30 : 120);
      const y = spawnCoords?.y ?? (parentZone ? 60 : 120);

      addZone({
        jurisdiction: regime.countryId as JurisdictionCode,
        code: `${regime.countryId}_${regime.id}`,
        name: regime.name,
        currency: COUNTRY_CURRENCY[regime.countryId] || 'USD',
        x,
        y,
        w: REGIME_DEFAULT_W,
        h: REGIME_DEFAULT_H,
        parentId: parentZone?.id ?? null,
      });
    },
    [addZone, project?.zones, spawnCoords],
  );

  if (!project) return null;

  return (
    <animated.div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/20 backdrop-blur-sm"
      style={backdropSpring}
      onClick={onClose}
    >
      <animated.div
        className="no-canvas-events flex max-h-[80vh] w-[700px] flex-col overflow-hidden rounded-3xl bg-white/72 shadow-2xl backdrop-blur-[40px] backdrop-saturate-[180%] border border-white/25"
        style={springStyles}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-7 py-5">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-gray-900">
              Master Data
            </h2>
            <p className="mt-0.5 text-xs text-gray-400">
              Countries & Tax Regimes — drag a row onto the canvas to create a zone
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-black/5 text-sm text-gray-500 hover:bg-black/10 hover:text-gray-800 cursor-pointer transition-colors"
          >
            {'\u00d7'}
          </button>
        </div>

        {/* Body — accordion */}
        <div className="flex-1 overflow-y-auto px-7 pb-4">
          {countries.map((country) => {
            const isExpanded = expandedCountries.has(country.id);
            const countryRegimes = regimes.filter((r) => r.countryId === country.id);

            return (
              <div key={country.id} className="mb-1.5">
                {/* Country Row (Level 1) — draggable to canvas */}
                <div
                  className="flex cursor-grab select-none items-center gap-3 rounded-2xl bg-black/3 px-4 py-3 hover:bg-black/5 transition-colors"
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
                    className="w-4 shrink-0 text-center text-xs text-gray-400 cursor-pointer hover:text-gray-600 transition-colors"
                  >
                    {isExpanded ? '\u25BC' : '\u25B6'}
                  </span>

                  {/* Country name */}
                  <span
                    onClick={() => toggleCountry(country.id)}
                    className="flex-1 text-sm font-semibold text-gray-900 cursor-pointer tracking-tight"
                  >
                    {country.name}
                  </span>

                  {/* Regime count badge */}
                  <span className="mr-1 rounded-full bg-black/5 px-2.5 py-0.5 text-xs text-gray-400 font-medium">
                    {countryRegimes.length} regime{countryRegimes.length !== 1 ? 's' : ''}
                  </span>

                  {/* Base currency selector */}
                  <select
                    value={country.baseCurrency}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => updateCountry(country.id, 'baseCurrency', e.target.value)}
                    className="w-20 rounded-lg border border-black/8 bg-white/80 px-2 py-1 text-xs outline-none cursor-pointer focus:border-blue-500"
                  >
                    {CURRENCY_OPTIONS.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>

                  {/* One-click add to canvas */}
                  <button
                    onClick={(e) => { e.stopPropagation(); handleAddToCanvas(country); }}
                    title="Add zone to canvas"
                    className="whitespace-nowrap rounded-lg bg-blue-500/8 px-2.5 py-1 text-xs font-semibold text-blue-600 hover:bg-blue-500/15 cursor-pointer transition-colors"
                  >
                    + Canvas
                  </button>

                  {/* Delete country */}
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteCountry(country.id); }}
                    className="flex h-6 w-6 items-center justify-center rounded-full bg-transparent text-sm text-red-400 hover:bg-red-500/10 hover:text-red-600 cursor-pointer transition-colors"
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
                        className="ml-8 mt-1 flex cursor-grab items-center gap-2.5 rounded-xl border-l-2 border-gray-200 bg-white/60 px-4 py-2.5 transition-colors hover:bg-white/80"
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
                          className="flex-1 rounded-lg border border-black/8 bg-white/80 px-3 py-1.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 transition-all"
                          placeholder="Regime name"
                        />

                        {/* CIT % */}
                        <label className="text-xs text-gray-400 font-medium">CIT%</label>
                        <input
                          type="number"
                          value={regime.cit}
                          onChange={(e) => updateRegime(regime.id, 'cit', parseFloat(e.target.value) || 0)}
                          className="w-16 rounded-lg border border-black/8 bg-white/80 px-2 py-1.5 text-right text-sm outline-none focus:border-blue-500 transition-all"
                          step="0.1"
                          min="0"
                          max="100"
                        />

                        {/* WHT % */}
                        <label className="text-xs text-gray-400 font-medium">WHT%</label>
                        <input
                          type="number"
                          value={regime.wht}
                          onChange={(e) => updateRegime(regime.id, 'wht', parseFloat(e.target.value) || 0)}
                          className="w-16 rounded-lg border border-black/8 bg-white/80 px-2 py-1.5 text-right text-sm outline-none focus:border-blue-500 transition-all"
                          step="0.1"
                          min="0"
                          max="100"
                        />

                        {/* One-click add regime as sub-zone */}
                        <button
                          onClick={() => handleAddRegimeToCanvas(regime)}
                          title="Add regime as sub-zone to canvas"
                          className="whitespace-nowrap rounded-lg bg-blue-500/8 px-2.5 py-1 text-xs font-semibold text-blue-600 hover:bg-blue-500/15 cursor-pointer transition-colors"
                        >
                          + Canvas
                        </button>

                        {/* Delete regime */}
                        <button
                          onClick={() => deleteRegime(regime.id)}
                          className="flex h-6 w-6 items-center justify-center rounded-full bg-transparent text-sm text-red-400 hover:bg-red-500/10 hover:text-red-600 cursor-pointer transition-colors"
                          title="Delete regime"
                        >
                          {'\u2715'}
                        </button>
                      </div>
                    ))}

                    {/* Add regime button */}
                    <button
                      onClick={() => addRegime(country.id)}
                      className="ml-8 mt-1.5 mb-2 rounded-xl bg-blue-500/6 px-4 py-2 text-xs font-medium text-blue-500 hover:bg-blue-500/12 cursor-pointer transition-colors"
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
            className="mt-3 w-full rounded-2xl bg-green-500/6 px-5 py-3 text-sm font-semibold text-green-600 hover:bg-green-500/12 cursor-pointer transition-colors"
          >
            + Add Country
          </button>
        </div>

        {/* Footer */}
        <div className="border-t border-black/5 px-7 py-4 text-right">
          <button
            onClick={onClose}
            className="rounded-xl bg-blue-500 px-6 py-2.5 text-sm font-semibold text-white hover:bg-blue-600 cursor-pointer transition-all active:scale-[0.97]"
          >
            Done
          </button>
        </div>
      </animated.div>
    </animated.div>
  );
}
