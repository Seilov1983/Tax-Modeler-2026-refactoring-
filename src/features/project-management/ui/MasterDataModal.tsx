'use client';

/**
 * MasterDataModal — hierarchical accordion (Matryoshka) for managing
 * Countries and Tax Regimes.
 *
 * Level 1: Country rows (expandable) with name + base currency selector.
 * Level 2: Regime rows nested under each country with name, CIT%, WHT%, delete.
 * Data stored flat in projectAtom.masterData.{countries,regimes}.
 *
 * Integrates with Server Actions for persistent storage when available,
 * falls back to Jotai-only for Electron/offline mode.
 * Uses Tailwind CSS for styling.
 */

import { useAtom, useSetAtom } from 'jotai';
import { useState, useCallback, useEffect, useTransition } from 'react';
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
        w: 600,
        h: 400,
      });
      setSpawnCoords(null);
      onClose();
    },
    [addZone, spawnCoords, setSpawnCoords, onClose],
  );

  // ─── One-click add regime as sub-zone to canvas ───────────────────────

  const handleAddRegimeToCanvas = useCallback(
    (regime: TaxRegime) => {
      const parentZone = spawnCoords?.parentZone
        ?? project?.zones?.find((z) => z.jurisdiction === regime.countryId && !z.parentId);
      const x = spawnCoords?.x ?? (parentZone ? parentZone.x + 30 : 120);
      const y = spawnCoords?.y ?? (parentZone ? parentZone.y + 60 : 120);

      addZone({
        jurisdiction: regime.countryId as JurisdictionCode,
        code: `${regime.countryId}_${regime.id}`,
        name: regime.name,
        currency: COUNTRY_CURRENCY[regime.countryId] || 'USD',
        x,
        y,
        w: 320,
        h: 250,
        parentId: parentZone?.id ?? null,
      });
      setSpawnCoords(null);
      onClose();
    },
    [addZone, project?.zones, spawnCoords, setSpawnCoords, onClose],
  );

  if (!project) return null;

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="no-canvas-events flex max-h-[80vh] w-[680px] flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <div>
            <span className="text-base font-bold text-gray-800">
              Master Data — Countries & Tax Regimes
            </span>
            <div className="mt-0.5 text-xs text-gray-400">
              Drag a country row onto the canvas to create a zone
            </div>
          </div>
          <button
            onClick={onClose}
            className="border-none bg-none text-xl leading-none text-gray-500 hover:text-gray-800 cursor-pointer"
          >
            {'\u00d7'}
          </button>
        </div>

        {/* Body — accordion */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {countries.map((country) => {
            const isExpanded = expandedCountries.has(country.id);
            const countryRegimes = regimes.filter((r) => r.countryId === country.id);

            return (
              <div key={country.id} className="mb-1">
                {/* Country Row (Level 1) — draggable to canvas */}
                <div
                  className="flex cursor-grab select-none items-center gap-2.5 rounded-md bg-gray-50 px-3 py-2.5 hover:bg-gray-100 transition-colors"
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
                    className="w-4 shrink-0 text-center text-xs text-gray-500 cursor-pointer"
                  >
                    {isExpanded ? '\u25BC' : '\u25B6'}
                  </span>

                  {/* Country name */}
                  <span
                    onClick={() => toggleCountry(country.id)}
                    className="flex-1 text-sm font-semibold text-gray-800 cursor-pointer"
                  >
                    {country.name}
                  </span>

                  {/* Regime count badge */}
                  <span className="mr-1 text-xs text-gray-400">
                    {countryRegimes.length} regime{countryRegimes.length !== 1 ? 's' : ''}
                  </span>

                  {/* Base currency selector */}
                  <select
                    value={country.baseCurrency}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => updateCountry(country.id, 'baseCurrency', e.target.value)}
                    className="w-20 rounded border border-gray-300 bg-white px-2 py-1 text-xs outline-none cursor-pointer"
                  >
                    {CURRENCY_OPTIONS.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>

                  {/* One-click add to canvas */}
                  <button
                    onClick={(e) => { e.stopPropagation(); handleAddToCanvas(country); }}
                    title="Add zone to canvas"
                    className="whitespace-nowrap rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-600 hover:bg-blue-100 cursor-pointer transition-colors"
                  >
                    + Canvas
                  </button>

                  {/* Delete country */}
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteCountry(country.id); }}
                    className="border-none bg-none px-1.5 py-0.5 text-base text-red-600 hover:text-red-800 cursor-pointer rounded"
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
                        className="ml-8 flex cursor-grab items-center gap-2 border-l-2 border-gray-300 bg-white px-3 py-2"
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
                          className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-200"
                          placeholder="Regime name"
                        />

                        {/* CIT % */}
                        <label className="text-xs text-gray-500">CIT%</label>
                        <input
                          type="number"
                          value={regime.cit}
                          onChange={(e) => updateRegime(regime.id, 'cit', parseFloat(e.target.value) || 0)}
                          className="w-16 rounded border border-gray-300 px-2 py-1 text-right text-sm outline-none focus:border-blue-400"
                          step="0.1"
                          min="0"
                          max="100"
                        />

                        {/* WHT % */}
                        <label className="text-xs text-gray-500">WHT%</label>
                        <input
                          type="number"
                          value={regime.wht}
                          onChange={(e) => updateRegime(regime.id, 'wht', parseFloat(e.target.value) || 0)}
                          className="w-16 rounded border border-gray-300 px-2 py-1 text-right text-sm outline-none focus:border-blue-400"
                          step="0.1"
                          min="0"
                          max="100"
                        />

                        {/* One-click add regime as sub-zone */}
                        <button
                          onClick={() => handleAddRegimeToCanvas(regime)}
                          title="Add regime as sub-zone to canvas"
                          className="whitespace-nowrap rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-600 hover:bg-blue-100 cursor-pointer transition-colors"
                        >
                          + Canvas
                        </button>

                        {/* Delete regime */}
                        <button
                          onClick={() => deleteRegime(regime.id)}
                          className="border-none bg-none px-1.5 py-0.5 text-base text-red-600 hover:text-red-800 cursor-pointer rounded"
                          title="Delete regime"
                        >
                          {'\u2715'}
                        </button>
                      </div>
                    ))}

                    {/* Add regime button */}
                    <button
                      onClick={() => addRegime(country.id)}
                      className="ml-8 mt-1 mb-2 rounded border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-600 hover:bg-blue-100 cursor-pointer transition-colors"
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
            className="mt-3 w-full rounded-md border border-green-200 bg-green-50 px-4 py-2.5 text-sm font-semibold text-green-600 hover:bg-green-100 cursor-pointer transition-colors"
          >
            + Add Country
          </button>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 px-5 py-3 text-right">
          <button
            onClick={onClose}
            className="rounded-md bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 cursor-pointer transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
