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
 * Computes spawn position at the center of the visible viewport area,
 * accounting for current pan & zoom.
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
    // Convert viewport center to canvas coordinates
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
      style={{
        position: 'absolute',
        top: '16px',
        left: '16px',
        background: '#fff',
        border: '1px solid #d1d5db',
        boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
        borderRadius: '6px',
        padding: '8px',
        zIndex: 40,
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
      }}
    >
      <div style={{ fontSize: '11px', color: '#6b7280', fontWeight: 700, textAlign: 'center', marginBottom: '2px' }}>
        TOOLS
      </div>
      <button onClick={handleAddCompany} data-testid="btn-add-company" style={btnStyle}>
        + Company
      </button>
      <button onClick={handleAddPerson} style={{ ...btnStyle, background: '#f0fdf4', color: '#16a34a' }}>
        + Person
      </button>
      <div style={{ position: 'relative' }}>
        <button
          onClick={() => setShowZoneMenu((v) => !v)}
          data-testid="btn-add-zone"
          style={{ ...btnStyle, background: '#fef3c7', color: '#b45309', width: '100%' }}
        >
          + Zone
        </button>
        {showZoneMenu && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: '100%',
              marginLeft: '4px',
              background: '#fff',
              border: '1px solid #d1d5db',
              borderRadius: '6px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
              padding: '4px',
              minWidth: '160px',
              zIndex: 50,
            }}
          >
            {ZONE_PRESETS.map((preset) => (
              <button
                key={preset.code}
                onClick={() => handleAddZone(preset)}
                style={{
                  display: 'block',
                  width: '100%',
                  padding: '6px 10px',
                  fontSize: '12px',
                  fontWeight: 500,
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  textAlign: 'left',
                  borderRadius: '3px',
                  color: '#374151',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#f3f4f6')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                {preset.name}
              </button>
            ))}
          </div>
        )}
      </div>
      <hr style={{ border: 'none', borderTop: '1px solid #e5e7eb', margin: '2px 0' }} />
      <button
        onClick={() => autoLayout()}
        data-testid="btn-auto-layout"
        title="Arrange nodes into a hierarchy (Dagre)"
        style={{ ...btnStyle, background: '#eef2ff', color: '#4f46e5', width: '100%' }}
      >
        Auto-Arrange
      </button>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  padding: '6px 12px',
  background: '#eff6ff',
  color: '#2563eb',
  fontSize: '13px',
  fontWeight: 500,
  border: 'none',
  borderRadius: '4px',
  cursor: 'pointer',
};
