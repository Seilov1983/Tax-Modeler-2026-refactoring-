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
      style={{
        position: 'absolute',
        top: '16px',
        left: '16px',
        background: 'rgba(255, 255, 255, 0.72)',
        backdropFilter: 'blur(40px) saturate(180%)',
        WebkitBackdropFilter: 'blur(40px) saturate(180%)',
        border: '1px solid rgba(255, 255, 255, 0.25)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.08), 0 2px 8px rgba(0,0,0,0.04)',
        borderRadius: '20px',
        padding: '10px',
        zIndex: 40,
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
      }}
    >
      <div style={{ fontSize: '10px', color: '#86868b', fontWeight: 600, textAlign: 'center', marginBottom: '2px', letterSpacing: '0.05em' }}>
        TOOLS
      </div>
      <button onClick={handleAddCompany} data-testid="btn-add-company" style={btnStyle}>
        + Company
      </button>
      <button onClick={handleAddPerson} style={{ ...btnStyle, background: 'rgba(48, 209, 88, 0.08)', color: '#30d158' }}>
        + Person
      </button>
      <div style={{ position: 'relative' }}>
        <button
          onClick={() => setShowZoneMenu((v) => !v)}
          data-testid="btn-add-zone"
          style={{ ...btnStyle, background: 'rgba(255, 159, 10, 0.08)', color: '#ff9f0a', width: '100%' }}
        >
          + Zone
        </button>
        {showZoneMenu && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: '100%',
              marginLeft: '6px',
              background: 'rgba(255, 255, 255, 0.85)',
              backdropFilter: 'blur(40px) saturate(180%)',
              WebkitBackdropFilter: 'blur(40px) saturate(180%)',
              border: '1px solid rgba(255, 255, 255, 0.25)',
              borderRadius: '16px',
              boxShadow: '0 12px 40px rgba(0,0,0,0.1), 0 4px 12px rgba(0,0,0,0.06)',
              padding: '6px',
              minWidth: '170px',
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
                  padding: '8px 12px',
                  fontSize: '13px',
                  fontWeight: 500,
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  textAlign: 'left',
                  borderRadius: '10px',
                  color: '#1d1d1f',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(0,0,0,0.04)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                {preset.name}
              </button>
            ))}
          </div>
        )}
      </div>
      <hr style={{ border: 'none', borderTop: '1px solid rgba(0,0,0,0.05)', margin: '4px 0' }} />
      <button
        onClick={() => autoLayout()}
        data-testid="btn-auto-layout"
        title="Arrange nodes into a hierarchy (Dagre)"
        style={{ ...btnStyle, background: 'rgba(99, 102, 241, 0.08)', color: '#6366f1', width: '100%' }}
      >
        Auto-Arrange
      </button>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  padding: '8px 14px',
  background: 'rgba(0, 122, 255, 0.08)',
  color: '#007aff',
  fontSize: '13px',
  fontWeight: 500,
  border: 'none',
  borderRadius: '10px',
  cursor: 'pointer',
  transition: 'background 0.15s, transform 0.1s',
};
