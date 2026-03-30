'use client';

/**
 * CanvasFilterPanel — floating Liquid Glass overlay for canvas visibility filters.
 *
 * Allows toggling ghosting by management tags, zone IDs, and flow types.
 * Positioned bottom-left of the viewport, above the canvas but below modals.
 */

import { useAtom, useAtomValue } from 'jotai';
import { useCallback, useMemo, useState } from 'react';
import { canvasFilterAtom } from '@features/canvas/model/canvas-filter-atom';
import { zonesAtom } from '@entities/zone';
import { nodesAtom } from '@entities/node';
import type { FlowType } from '@shared/types';

const ALL_FLOW_TYPES: FlowType[] = [
  'Services', 'Dividends', 'Royalties', 'Interest', 'Salary', 'Goods', 'Equipment',
];

// ─── Chip Component ──────────────────────────────────────────────────────────

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center px-3 py-1 text-[11px] font-bold rounded-lg transition-all whitespace-nowrap border cursor-pointer active:scale-95 ${
        active 
          ? 'border-indigo-500 bg-indigo-500/10 text-indigo-600 dark:border-indigo-400 dark:bg-indigo-500/20 dark:text-indigo-400' 
          : 'border-black/5 dark:border-white/5 bg-black/5 dark:bg-white/5 text-slate-500 hover:bg-black/10 dark:hover:bg-white/10'
      }`}
    >
      {label}
    </button>
  );
}

// ─── Main Panel ──────────────────────────────────────────────────────────────

export function CanvasFilterPanel() {
  const [filter, setFilter] = useAtom(canvasFilterAtom);
  const zones = useAtomValue(zonesAtom);
  const nodes = useAtomValue(nodesAtom);
  const [expanded, setExpanded] = useState(false);

  // Collect unique management tags from all nodes
  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    for (const node of nodes) {
      if (node.managementTags) {
        for (const tag of node.managementTags) tagSet.add(tag);
      }
    }
    return Array.from(tagSet).sort();
  }, [nodes]);

  // Collect unique regime zones (zones with parentId)
  const regimeZones = useMemo(
    () => zones.filter((z) => z.parentId).sort((a, b) => a.name.localeCompare(b.name)),
    [zones],
  );

  const toggleActive = useCallback(() => {
    setFilter((prev) => ({ ...prev, isActive: !prev.isActive }));
  }, [setFilter]);

  const toggleTag = useCallback(
    (tag: string) => {
      setFilter((prev) => {
        const has = prev.managementTags.includes(tag);
        return {
          ...prev,
          managementTags: has
            ? prev.managementTags.filter((t) => t !== tag)
            : [...prev.managementTags, tag],
        };
      });
    },
    [setFilter],
  );

  const toggleZone = useCallback(
    (zoneId: string) => {
      setFilter((prev) => {
        const has = prev.zoneIds.includes(zoneId);
        return {
          ...prev,
          zoneIds: has
            ? prev.zoneIds.filter((id) => id !== zoneId)
            : [...prev.zoneIds, zoneId],
        };
      });
    },
    [setFilter],
  );

  const toggleFlowType = useCallback(
    (ft: FlowType) => {
      setFilter((prev) => {
        const has = prev.flowTypes.includes(ft);
        return {
          ...prev,
          flowTypes: has
            ? prev.flowTypes.filter((t) => t !== ft)
            : [...prev.flowTypes, ft],
        };
      });
    },
    [setFilter],
  );

  const clearAll = useCallback(() => {
    setFilter({ managementTags: [], zoneIds: [], flowTypes: [], isActive: false });
  }, [setFilter]);

  const hasFilters = filter.managementTags.length > 0 || filter.zoneIds.length > 0 || filter.flowTypes.length > 0;

  return (
    <div
      className={`absolute bottom-12 left-36 z-40 transition-all ${
        expanded ? 'w-[280px] p-4 bg-white/70 dark:bg-slate-950/70 backdrop-blur-2xl border border-black/5 dark:border-white/5 shadow-xl rounded-2xl' : 'w-auto'
      }`}
    >
      {/* Collapsed: just a toggle button */}
      {!expanded && (
        <button
          onClick={() => setExpanded(true)}
          className={`flex items-center gap-2 px-4 py-2 bg-white/70 dark:bg-slate-950/70 backdrop-blur-2xl border border-black/5 dark:border-white/5 shadow-lg rounded-2xl cursor-pointer text-[12px] font-bold transition-all hover:bg-white dark:hover:bg-slate-900 active:scale-95 ${
            filter.isActive ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500'
          }`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
          </svg>
          Filters{filter.isActive && hasFilters ? ' (ON)' : ''}
        </button>
      )}

      {/* Expanded panel */}
      {expanded && (
        <div className="flex flex-col gap-4">
          {/* Header */}
          <div className="flex justify-between items-center">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">
              Visibility Filters
            </span>
            <button
              onClick={() => setExpanded(false)}
              className="bg-transparent border-none cursor-pointer text-[14px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
            >
              ✕
            </button>
          </div>

          {/* Active toggle */}
          <div className="flex justify-between items-center py-1">
            <span className="text-[12px] font-bold text-slate-700 dark:text-slate-200">Enable Ghosting</span>
            <button
              onClick={toggleActive}
              className={`relative w-9 h-5 rounded-full border-none cursor-pointer transition-colors ${
                filter.isActive ? 'bg-indigo-500' : 'bg-slate-300 dark:bg-slate-600'
              }`}
            >
              <div
                className={`absolute top-[2px] w-4 h-4 rounded-full bg-white shadow-sm transition-all duration-200 ${
                  filter.isActive ? 'left-[18px]' : 'left-[2px]'
                }`}
              />
            </button>
          </div>

          {/* Management Tags */}
          {allTags.length > 0 && (
            <div>
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
                Tags
              </div>
              <div className="flex flex-wrap gap-1.5">
                {allTags.map((tag) => (
                  <FilterChip
                    key={tag}
                    label={tag}
                    active={filter.managementTags.includes(tag)}
                    onClick={() => toggleTag(tag)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Zones */}
          {regimeZones.length > 0 && (
            <div>
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
                Zones
              </div>
              <div className="flex flex-wrap gap-1.5 max-h-[80px] overflow-y-auto pr-1">
                {regimeZones.map((z) => (
                  <FilterChip
                    key={z.id}
                    label={`${z.jurisdiction} / ${z.name}`}
                    active={filter.zoneIds.includes(z.id)}
                    onClick={() => toggleZone(z.id)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Flow Types */}
          <div>
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
              Flow Types
            </div>
            <div className="flex flex-wrap gap-1.5">
              {ALL_FLOW_TYPES.map((ft) => (
                <FilterChip
                  key={ft}
                  label={ft}
                  active={filter.flowTypes.includes(ft)}
                  onClick={() => toggleFlowType(ft)}
                />
              ))}
            </div>
          </div>

          {/* Clear button */}
          {hasFilters && (
            <button
              onClick={clearAll}
              className="p-1 mt-1 text-[11px] font-bold text-red-500 hover:text-red-600 bg-transparent border-none cursor-pointer text-center active:scale-95 transition-all"
            >
              Clear All Filters
            </button>
          )}
        </div>
      )}
    </div>
  );
}
