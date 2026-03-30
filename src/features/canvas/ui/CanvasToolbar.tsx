'use client';

import { useSetAtom } from 'jotai';
import { useCallback, useState, type RefObject } from 'react';
import { addNodeAtom, addZoneAtom, autoLayoutAtom } from '../model/graph-actions-atom';
import type { ViewportState } from './useCanvasViewport';
import type { JurisdictionCode, CurrencyCode } from '@shared/types';

interface CanvasToolbarProps {
  viewportRef: RefObject<HTMLDivElement | null>;
  viewportStateRef: RefObject<ViewportState>;
}

const ZONE_PRESETS: { jurisdiction: JurisdictionCode; code: string; name: string; currency: CurrencyCode }[] = [
  { jurisdiction: 'KZ', code: 'KZ_STD', name: 'Kazakhstan', currency: 'KZT' },
  { jurisdiction: 'UAE', code: 'UAE_ML', name: 'UAE Mainland', currency: 'AED' },
  { jurisdiction: 'HK', code: 'HK_ON', name: 'Hong Kong', currency: 'HKD' },
  { jurisdiction: 'CY', code: 'CY_STD', name: 'Cyprus', currency: 'EUR' },
  { jurisdiction: 'SG', code: 'SG_STD', name: 'Singapore', currency: 'SGD' },
  { jurisdiction: 'UK', code: 'UK_STD', name: 'United Kingdom', currency: 'GBP' },
  { jurisdiction: 'US', code: 'US_DE', name: 'US Delaware', currency: 'USD' },
  { jurisdiction: 'BVI', code: 'BVI', name: 'BVI', currency: 'USD' },
];

/**
 * Floating toolbar for spawning new nodes and zones on the canvas.
 * Liquid Glass design: frosted glass panel, generous radius, subtle shadow.
 */
export function CanvasToolbar({ viewportRef, viewportStateRef }: CanvasToolbarProps) {
  const addNode = useSetAtom(addNodeAtom);
  const addZone = useSetAtom(addZoneAtom);
  const autoLayout = useSetAtom(autoLayoutAtom);
  const [showZoneMenu, setShowZoneMenu] = useState(false);

  const spawnCenter = useCallback((): { x: number; y: number } => {
    const vp = viewportRef.current;
    const state = viewportStateRef.current;
    if (!vp || !state) return { x: 200, y: 200 };

    const rect = vp.getBoundingClientRect();
    const cx = (rect.width / 2 - state.panX) / state.scale;
    const cy = (rect.height / 2 - state.panY) / state.scale;
    return { x: Math.round(cx - 90), y: Math.round(cy - 40) };
  }, [viewportRef, viewportStateRef]);

  const handleAddCompany = useCallback(() => {
    const pos = spawnCenter();
    addNode({ type: 'company', name: 'New Company', x: pos.x, y: pos.y });
  }, [addNode, spawnCenter]);

  const handleAddPerson = useCallback(() => {
    const pos = spawnCenter();
    addNode({ type: 'person', name: 'New Person', x: pos.x + 20, y: pos.y + 20 });
  }, [addNode, spawnCenter]);

  const handleAddZone = useCallback(
    (preset: (typeof ZONE_PRESETS)[number]) => {
      const pos = spawnCenter();
      addZone({
        jurisdiction: preset.jurisdiction,
        code: preset.code,
        name: preset.name,
        currency: preset.currency,
        x: pos.x - 200,
        y: pos.y - 150,
      });
      setShowZoneMenu(false);
    },
    [addZone, spawnCenter],
  );

  return (
    <div
      className="absolute top-3 left-4 bg-white/70 dark:bg-slate-950/70 backdrop-blur-2xl border border-black/5 dark:border-white/5 shadow-xl shadow-black/5 dark:shadow-white/5 rounded-[20px] p-2.5 z-40 flex flex-col gap-1 w-[120px]"
    >
      <div className="text-[10px] text-slate-400 dark:text-slate-500 font-bold text-center mb-1 uppercase tracking-widest">
        TOOLS
      </div>
      <button 
        onClick={handleAddCompany} 
        data-testid="btn-add-company" 
        className="w-full text-left px-3 py-2 text-[13px] font-semibold rounded-xl transition-all active:scale-95 bg-blue-500/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400 hover:bg-blue-500/20 dark:hover:bg-blue-500/30"
      >
        + Company
      </button>
      <button 
        onClick={handleAddPerson} 
        className="w-full text-left px-3 py-2 text-[13px] font-semibold rounded-xl transition-all active:scale-95 bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400 hover:bg-emerald-500/20 dark:hover:bg-emerald-500/30"
      >
        + Person
      </button>
      <div className="relative w-full">
        <button
          onClick={() => setShowZoneMenu((v) => !v)}
          data-testid="btn-add-zone"
          className="w-full text-left px-3 py-2 text-[13px] font-semibold rounded-xl transition-all active:scale-95 bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400 hover:bg-amber-500/20 dark:hover:bg-amber-500/30"
        >
          + Zone
        </button>
        {showZoneMenu && (
          <div
            className="absolute top-0 left-full ml-3 bg-white/80 dark:bg-slate-900/80 backdrop-blur-2xl border border-black/10 dark:border-white/10 rounded-2xl shadow-2xl p-2 min-w-[180px] z-50 flex flex-col gap-0.5"
          >
            {ZONE_PRESETS.map((preset) => (
              <button
                key={preset.code}
                onClick={() => handleAddZone(preset)}
                className="block w-full text-left px-3 py-2 text-[13px] font-medium border-none bg-transparent cursor-pointer rounded-xl text-slate-800 dark:text-slate-200 transition-colors hover:bg-black/5 dark:hover:bg-white/10"
              >
                {preset.name}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="w-full h-[1px] bg-black/5 dark:bg-white/5 my-1" />
      <button
        onClick={() => autoLayout()}
        data-testid="btn-auto-layout"
        title="Arrange nodes into a hierarchy (Dagre)"
        className="w-full text-left px-3 py-2 text-[13px] font-semibold rounded-xl transition-all active:scale-95 bg-indigo-500/10 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400 hover:bg-indigo-500/20 dark:hover:bg-indigo-500/30"
      >
        Auto-Arrange
      </button>
    </div>
  );
}
