'use client';

/**
 * CanvasOwnership — renders a vertical dashed ownership line between parent and subsidiary.
 *
 * Uses vertical cubic Bezier: exits from bottom-center of parent,
 * enters top-center of subsidiary. Purple dashed stroke with percent badge.
 *
 * FROZEN: SVG Hit-Areas — visible stroke 2px, invisible hit-area 12px.
 */

import { useAtom } from 'jotai';
import { memo, useCallback } from 'react';
import type { OwnershipEdge, NodeDTO } from '@shared/types';
import { selectionAtom } from '@features/entity-editor/model/atoms';

// ─── Vertical Bezier path builder ───────────────────────────────────────────

/**
 * Builds a vertical SVG cubic Bezier from (x1,y1) to (x2,y2).
 * Control points extend vertically so the curve exits/enters the ports
 * smoothly from bottom → top.
 */
export function buildVerticalBezierPath(x1: number, y1: number, x2: number, y2: number): string {
  const dy = Math.abs(y2 - y1);
  const cpOffset = Math.max(dy * 0.45, 50);

  return `M ${x1} ${y1} C ${x1} ${y1 + cpOffset}, ${x2} ${y2 - cpOffset}, ${x2} ${y2}`;
}

// ─── Component ──────────────────────────────────────────────────────────────

interface CanvasOwnershipProps {
  edge: OwnershipEdge;
  nodes: NodeDTO[];
}

export const CanvasOwnership = memo(function CanvasOwnership({ edge, nodes }: CanvasOwnershipProps) {
  const parentNode = nodes.find((n) => n.id === edge.fromId);
  const childNode = nodes.find((n) => n.id === edge.toId);
  const [selection, setSelection] = useAtom(selectionAtom);
  const isSelected = selection?.type === 'ownership' && selection.id === edge.id;

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setSelection({ type: 'ownership', id: edge.id });
    },
    [edge.id, setSelection],
  );

  if (!parentNode || !childNode) return null;

  // Anchor: bottom-center of parent → top-center of subsidiary
  const x1 = parentNode.x + parentNode.w / 2;
  const y1 = parentNode.y + parentNode.h;
  const x2 = childNode.x + childNode.w / 2;
  const y2 = childNode.y;

  const pathData = buildVerticalBezierPath(x1, y1, x2, y2);

  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;

  return (
    <g onClick={handleClick} style={{ cursor: 'pointer', pointerEvents: 'auto' }}>
      {/* Invisible wider hit area (FROZEN: 12px) */}
      <path d={pathData} stroke="transparent" strokeWidth={12} fill="none" />

      {/* Visible dashed purple line — highlighted when selected */}
      <path
        d={pathData}
        stroke={isSelected ? '#7c3aed' : '#a855f7'}
        strokeWidth={isSelected ? 4 : 2}
        strokeDasharray="5 5"
        fill="none"
      />

      {/* Percent badge */}
      <foreignObject x={midX - 22} y={midY - 10} width="44" height="20">
        <div
          style={{
            background: 'rgba(243, 232, 255, 0.95)',
            color: '#7c3aed',
            fontSize: '10px',
            textAlign: 'center',
            borderRadius: '3px',
            border: '1px solid #c4b5fd',
            padding: '1px 3px',
            fontWeight: 700,
            whiteSpace: 'nowrap',
          }}
        >
          {edge.percent}%
        </div>
      </foreignObject>
    </g>
  );
});
