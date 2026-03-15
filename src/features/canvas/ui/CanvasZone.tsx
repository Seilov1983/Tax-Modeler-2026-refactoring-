'use client';

/**
 * CanvasZone — visual jurisdiction zone rendered on the lowest canvas layer.
 *
 * Uses existing CSS classes from styles.css (.zone, .zone-header, .zone-resize-handle).
 * Zones are pointer-events:none in the body so nodes/flows can be clicked through,
 * but the header is pointer-events:auto for click-to-select support.
 */

import { memo } from 'react';
import { useAtom } from 'jotai';
import { selectionAtom } from '@features/entity-editor/model/atoms';
import type { Zone } from '@shared/types';

interface CanvasZoneProps {
  zone: Zone;
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

export const CanvasZone = memo(function CanvasZone({ zone }: CanvasZoneProps) {
  const [selection, setSelection] = useAtom(selectionAtom);
  const isSelected = selection?.type === 'zone' && selection.id === zone.id;

  const bgColor = ZONE_COLORS[zone.jurisdiction] || '#f1f5f9';
  const borderColor = ZONE_BORDER_COLORS[zone.jurisdiction] || '#94a3b8';

  return (
    <div
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
      {/* Clickable zone header label */}
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
          cursor: 'pointer',
          borderBottomRightRadius: '12px',
          transition: 'all 0.15s',
        }}
        onClick={(e) => {
          e.stopPropagation();
          setSelection({ type: 'zone', id: zone.id });
        }}
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
    </div>
  );
});
