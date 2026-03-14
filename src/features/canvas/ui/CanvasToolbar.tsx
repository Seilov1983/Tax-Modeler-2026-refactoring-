'use client';

import { useSetAtom } from 'jotai';
import { useCallback, type RefObject } from 'react';
import { addNodeAtom } from '../model/graph-actions-atom';
import type { ViewportState } from './useCanvasViewport';

interface CanvasToolbarProps {
  viewportRef: RefObject<HTMLDivElement | null>;
  viewportStateRef: RefObject<ViewportState>;
}

/**
 * Floating toolbar for spawning new nodes on the canvas.
 * Computes spawn position at the center of the visible viewport area,
 * accounting for current pan & zoom.
 */
export function CanvasToolbar({ viewportRef, viewportStateRef }: CanvasToolbarProps) {
  const addNode = useSetAtom(addNodeAtom);

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
    addNode({ type: 'company', name: 'New Company', x: pos.x, y: pos.y, zoneId: 'KZ_HUB' });
  }, [addNode, spawnCenter]);

  const handleAddPerson = useCallback(() => {
    const pos = spawnCenter();
    addNode({ type: 'person', name: 'New Person', x: pos.x + 20, y: pos.y + 20 });
  }, [addNode, spawnCenter]);

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
