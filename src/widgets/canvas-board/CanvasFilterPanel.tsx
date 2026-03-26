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
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '3px 10px',
        fontSize: '11px',
        fontWeight: 600,
        borderRadius: '8px',
        border: active ? '1px solid #007aff' : '1px solid rgba(0,0,0,0.1)',
        background: active ? 'rgba(0, 122, 255, 0.12)' : 'rgba(0,0,0,0.03)',
        color: active ? '#007aff' : '#6b7280',
        cursor: 'pointer',
        transition: 'all 0.15s',
        whiteSpace: 'nowrap',
      }}
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
      style={{
        position: 'absolute',
        bottom: '16px',
        left: '16px',
        width: expanded ? '280px' : 'auto',
        background: 'rgba(255, 255, 255, 0.70)',
        backdropFilter: 'blur(40px) saturate(180%)',
        WebkitBackdropFilter: 'blur(40px) saturate(180%)',
        borderRadius: '14px',
        border: '1px solid rgba(255, 255, 255, 0.50)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06)',
        padding: expanded ? '12px' : '0',
        zIndex: 40,
        fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Inter', sans-serif",
      }}
    >
      {/* Collapsed: just a toggle button */}
      {!expanded && (
        <button
          onClick={() => setExpanded(true)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '8px 14px',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: '12px',
            fontWeight: 600,
            color: filter.isActive ? '#007aff' : '#6b7280',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
          </svg>
          Filters{filter.isActive && hasFilters ? ' (ON)' : ''}
        </button>
      )}

      {/* Expanded panel */}
      {expanded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Visibility Filters
            </span>
            <button
              onClick={() => setExpanded(false)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', color: '#9ca3af', lineHeight: 1 }}
            >
              {'\u2715'}
            </button>
          </div>

          {/* Active toggle */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: '#374151' }}>Enable Ghosting</span>
            <button
              onClick={toggleActive}
              style={{
                width: '36px',
                height: '20px',
                borderRadius: '10px',
                border: 'none',
                cursor: 'pointer',
                background: filter.isActive ? '#007aff' : '#d1d5db',
                position: 'relative',
                transition: 'background 0.2s',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: '2px',
                  left: filter.isActive ? '18px' : '2px',
                  width: '16px',
                  height: '16px',
                  borderRadius: '50%',
                  background: '#fff',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                  transition: 'left 0.2s',
                }}
              />
            </button>
          </div>

          {/* Management Tags */}
          {allTags.length > 0 && (
            <div>
              <div style={{ fontSize: '10px', fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', marginBottom: '4px' }}>
                Tags
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
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
              <div style={{ fontSize: '10px', fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', marginBottom: '4px' }}>
                Zones
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', maxHeight: '80px', overflowY: 'auto' }}>
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
            <div style={{ fontSize: '10px', fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', marginBottom: '4px' }}>
              Flow Types
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
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
              style={{
                padding: '6px',
                fontSize: '11px',
                fontWeight: 600,
                color: '#dc2626',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                textAlign: 'center',
              }}
            >
              Clear All Filters
            </button>
          )}
        </div>
      )}
    </div>
  );
}
