'use client';

/**
 * CanvasZone — visual jurisdiction zone rendered on the lowest canvas layer.
 *
 * Supports:
 * - Click on header label to select the zone (opens EditorSidebar)
 * - Transient drag on header for 60 FPS repositioning (same pattern as CanvasNode)
 * - Visual highlight when selected (blue border + header)
 *
 * Zone body is pointer-events:none so nodes/flows/lasso can be clicked through.
 * Header is pointer-events:auto for interaction.
 */

import { memo, useRef, useCallback, type RefObject } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { selectionAtom } from '@features/entity-editor/model/atoms';
import { moveZoneAtom, deleteZoneAtom, resizeZoneAtom } from '../model/graph-actions-atom';
import { zonesAtom } from '@entities/zone';
import { nodesAtom } from '@entities/node';
import type { Zone } from '@shared/types';
import type { ViewportState } from './useCanvasViewport';

interface ChildSnapshot {
  el: HTMLElement;
  origX: number;
  origY: number;
  /** Nodes use CSS transform; zones use left/top */
  usesTransform: boolean;
}

/** Collect DOM elements of child sub-zones and nodes that are spatially inside the given zone. */
function collectChildElements(zone: Zone, allZones: Zone[], allNodes: { id: string; x: number; y: number; w: number; h: number }[]): ChildSnapshot[] {
  const area = zone.w * zone.h;
  const children: ChildSnapshot[] = [];

  // Child sub-zones: smaller zones whose center is inside the moved zone
  for (const z of allZones) {
    if (z.id === zone.id) continue;
    if (z.w * z.h >= area) continue;
    const cx = z.x + z.w / 2;
    const cy = z.y + z.h / 2;
    if (cx >= zone.x && cx <= zone.x + zone.w && cy >= zone.y && cy <= zone.y + zone.h) {
      const el = document.querySelector(`[data-zone-id="${z.id}"]`) as HTMLElement | null;
      if (el) children.push({ el, origX: z.x, origY: z.y, usesTransform: false });
    }
  }

  // Child nodes: nodes whose center is inside the moved zone (nodes use transform)
  for (const n of allNodes) {
    const cx = n.x + (n.w || 0) / 2;
    const cy = n.y + (n.h || 0) / 2;
    if (cx >= zone.x && cx <= zone.x + zone.w && cy >= zone.y && cy <= zone.y + zone.h) {
      const el = document.querySelector(`[data-node-id="${n.id}"]`) as HTMLElement | null;
      if (el) children.push({ el, origX: n.x, origY: n.y, usesTransform: true });
    }
  }

  return children;
}

interface CanvasZoneProps {
  zone: Zone;
  viewportStateRef: RefObject<ViewportState>;
}

/** Map jurisdiction codes to subtle background colors */
const ZONE_COLORS: Record<string, string> = {
  KZ: '#fef3c7',   // amber-100
  UAE: '#dbeafe',   // blue-100
  HK: '#fce7f3',   // pink-100
  CY: '#d1fae5',   // green-100
  SG: '#ede9fe',    // violet-100
  UK: '#fee2e2',    // red-100
  US: '#e0e7ff',    // indigo-100
  BVI: '#ccfbf1',   // teal-100
  CAY: '#fef9c3',   // yellow-100
  SEY: '#f0fdfa',   // teal-50
};

const ZONE_BORDER_COLORS: Record<string, string> = {
  KZ: '#f59e0b',   // amber-500
  UAE: '#3b82f6',   // blue-500
  HK: '#ec4899',   // pink-500
  CY: '#10b981',   // green-500
  SG: '#8b5cf6',   // violet-500
  UK: '#ef4444',   // red-500
  US: '#6366f1',   // indigo-500
  BVI: '#14b8a6',   // teal-500
  CAY: '#eab308',   // yellow-500
  SEY: '#2dd4bf',   // teal-400
};

export const CanvasZone = memo(function CanvasZone({ zone, viewportStateRef }: CanvasZoneProps) {
  const [selection, setSelection] = useAtom(selectionAtom);
  const moveZone = useSetAtom(moveZoneAtom);
  const deleteZone = useSetAtom(deleteZoneAtom);
  const resizeZone = useSetAtom(resizeZoneAtom);
  const allZones = useAtomValue(zonesAtom);
  const allNodes = useAtomValue(nodesAtom);
  const isSelected = selection?.type === 'zone' && selection.id === zone.id;

  const bgColor = ZONE_COLORS[zone.jurisdiction] || '#f1f5f9';
  const borderColor = ZONE_BORDER_COLORS[zone.jurisdiction] || '#94a3b8';

  // Refs for transient drag (direct DOM mutation, no React re-renders during drag)
  const containerRef = useRef<HTMLDivElement>(null);
  const livePos = useRef({ x: zone.x, y: zone.y });
  const hasDragged = useRef(false);
  const childElsRef = useRef<ChildSnapshot[]>([]);

  const handleHeaderPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      const target = e.currentTarget;
      target.setPointerCapture(e.pointerId);
      hasDragged.current = false;
      livePos.current = { x: zone.x, y: zone.y };

      // Snapshot child elements once at drag start for 60fps DOM-level cascading
      childElsRef.current = collectChildElements(zone, allZones, allNodes);

      const onPointerMove = (moveEvent: PointerEvent) => {
        hasDragged.current = true;
        const scale = viewportStateRef.current?.scale ?? 1;
        const dx = moveEvent.movementX / scale;
        const dy = moveEvent.movementY / scale;

        livePos.current.x += dx;
        livePos.current.y += dy;

        // Direct DOM mutation for 60 FPS drag — zone itself
        if (containerRef.current) {
          containerRef.current.style.left = `${livePos.current.x}px`;
          containerRef.current.style.top = `${livePos.current.y}px`;
        }

        // Cascade: move child sub-zones and nodes by the same delta
        const totalDx = livePos.current.x - zone.x;
        const totalDy = livePos.current.y - zone.y;
        for (const child of childElsRef.current) {
          const newX = child.origX + totalDx;
          const newY = child.origY + totalDy;
          if (child.usesTransform) {
            // Nodes use CSS transform for positioning
            child.el.style.transform = `translate(${newX}px, ${newY}px) translateZ(0)`;
          } else {
            // Sub-zones use left/top for positioning
            child.el.style.left = `${newX}px`;
            child.el.style.top = `${newY}px`;
          }
        }
      };

      const onPointerUp = (upEvent: PointerEvent) => {
        target.removeEventListener('pointermove', onPointerMove);
        target.removeEventListener('pointerup', onPointerUp);
        target.releasePointerCapture(upEvent.pointerId);

        if (hasDragged.current) {
          // CRITICAL: Clear ALL transient inline styles BEFORE committing to state.
          // Without this, React re-renders with new coordinates from Jotai,
          // but the stale inline overrides remain → double-delta "jump".

          // Clear zone container's own inline position
          if (containerRef.current) {
            containerRef.current.style.left = '';
            containerRef.current.style.top = '';
          }

          // Clear child elements' inline overrides
          for (const child of childElsRef.current) {
            if (child.usesTransform) {
              child.el.style.transform = '';
            } else {
              child.el.style.left = '';
              child.el.style.top = '';
            }
          }

          // Now commit new positions — React will re-render with correct values
          moveZone({
            id: zone.id,
            x: Math.round(livePos.current.x),
            y: Math.round(livePos.current.y),
          });
        }

        childElsRef.current = [];
      };

      target.addEventListener('pointermove', onPointerMove);
      target.addEventListener('pointerup', onPointerUp);
    },
    [zone.x, zone.y, zone.id, zone.w, zone.h, moveZone, viewportStateRef, allZones, allNodes],
  );

  const handleHeaderClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!hasDragged.current) {
        setSelection({ type: 'zone', id: zone.id });
      }
    },
    [zone.id, setSelection],
  );

  // ─── Resize handle (bottom-right corner) ──────────────────────────────
  const liveSize = useRef({ w: zone.w, h: zone.h });

  const handleResizePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      const target = e.currentTarget;
      target.setPointerCapture(e.pointerId);
      liveSize.current = { w: zone.w, h: zone.h };

      const onPointerMove = (moveEvent: PointerEvent) => {
        const scale = viewportStateRef.current?.scale ?? 1;
        const dw = moveEvent.movementX / scale;
        const dh = moveEvent.movementY / scale;

        liveSize.current.w = Math.max(200, liveSize.current.w + dw);
        liveSize.current.h = Math.max(150, liveSize.current.h + dh);

        if (containerRef.current) {
          containerRef.current.style.width = `${liveSize.current.w}px`;
          containerRef.current.style.height = `${liveSize.current.h}px`;
        }
      };

      const onPointerUp = (upEvent: PointerEvent) => {
        target.removeEventListener('pointermove', onPointerMove);
        target.removeEventListener('pointerup', onPointerUp);
        target.releasePointerCapture(upEvent.pointerId);

        resizeZone({
          id: zone.id,
          w: Math.round(liveSize.current.w),
          h: Math.round(liveSize.current.h),
        });
      };

      target.addEventListener('pointermove', onPointerMove);
      target.addEventListener('pointerup', onPointerUp);
    },
    [zone.w, zone.h, zone.id, resizeZone, viewportStateRef],
  );

  const handleDeleteZone = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      deleteZone(zone.id);
      setSelection(null);
    },
    [zone.id, deleteZone, setSelection],
  );

  return (
    <div
      ref={containerRef}
      data-zone-id={zone.id}
      data-testid="canvas-zone"
      style={{
        position: 'absolute',
        left: zone.x,
        top: zone.y,
        width: zone.w,
        height: zone.h,
        zIndex: zone.zIndex,
        border: `2px dashed ${isSelected ? '#3b82f6' : borderColor}`,
        borderRadius: '12px',
        background: isSelected ? `${bgColor}60` : `${bgColor}40`,
        pointerEvents: 'none',
        transform: 'translateZ(0)',
        transition: 'border-color 0.15s, background 0.15s',
      }}
    >
      {/* Draggable + clickable zone header label */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          padding: '8px 16px',
          fontSize: '18px',
          fontWeight: 800,
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          color: isSelected ? '#fff' : borderColor,
          background: isSelected ? '#3b82f6' : 'transparent',
          opacity: isSelected ? 1 : 0.5,
          userSelect: 'none',
          pointerEvents: 'auto',
          cursor: 'grab',
          borderBottomRightRadius: '12px',
          touchAction: 'none',
          transition: 'color 0.15s, background 0.15s, opacity 0.15s',
        }}
        onPointerDown={handleHeaderPointerDown}
        onClick={handleHeaderClick}
        onMouseEnter={(e) => {
          if (!isSelected) {
            (e.currentTarget as HTMLElement).style.opacity = '0.8';
            (e.currentTarget as HTMLElement).style.background = '#f3f4f6';
          }
        }}
        onMouseLeave={(e) => {
          if (!isSelected) {
            (e.currentTarget as HTMLElement).style.opacity = '0.5';
            (e.currentTarget as HTMLElement).style.background = 'transparent';
          }
        }}
      >
        {zone.name}

        {/* Delete zone button */}
        <button
          onClick={handleDeleteZone}
          data-testid="btn-delete-zone"
          title="Delete zone"
          style={{
            marginLeft: '8px',
            background: 'none',
            border: 'none',
            fontSize: '14px',
            cursor: 'pointer',
            color: isSelected ? 'rgba(255,255,255,0.7)' : '#dc2626',
            lineHeight: 1,
            padding: '0 4px',
            borderRadius: '3px',
            opacity: 0.6,
            pointerEvents: 'auto',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.6'; }}
        >
          {'\u2715'}
        </button>
      </div>

      {/* Jurisdiction badge */}
      <div
        style={{
          position: 'absolute',
          top: '12px',
          right: '16px',
          fontSize: '11px',
          fontWeight: 700,
          padding: '2px 8px',
          borderRadius: '4px',
          background: `${borderColor}20`,
          color: borderColor,
          opacity: 0.6,
          userSelect: 'none',
          pointerEvents: 'none',
        }}
      >
        {zone.jurisdiction} · {zone.currency}
      </div>

      {/* Resize handle — bottom-right corner */}
      <div
        onPointerDown={handleResizePointerDown}
        style={{
          position: 'absolute',
          right: 0,
          bottom: 0,
          width: 18,
          height: 18,
          cursor: 'nwse-resize',
          pointerEvents: 'auto',
          touchAction: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" style={{ opacity: 0.4 }}>
          <line x1="9" y1="1" x2="1" y2="9" stroke={borderColor} strokeWidth="1.5" />
          <line x1="9" y1="5" x2="5" y2="9" stroke={borderColor} strokeWidth="1.5" />
        </svg>
      </div>
    </div>
  );
});
