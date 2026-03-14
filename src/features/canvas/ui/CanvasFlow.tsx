'use client';

/**
 * CanvasFlow — renders a flow arrow between two nodes with optional WHT badge.
 *
 * Uses cubic Bezier curves (SVG <path> C command) for smooth S-shaped routing:
 * - Exits horizontally from the right edge of the source node
 * - Enters horizontally into the left edge of the target node
 * - Dynamic control-point offset scales with horizontal distance
 *
 * Each flow gets its own local <Suspense> boundary so WHT calculation
 * doesn't block arrow rendering or other flows.
 *
 * FROZEN: SVG Hit-Areas — visible stroke 2px, invisible hit-area 12px.
 */

import { useAtomValue, useSetAtom } from 'jotai';
import { memo, Suspense, useCallback } from 'react';
import type { FlowDTO, NodeDTO } from '@shared/types';
import { flowTaxAtomFamily } from '@features/tax-calculator/model/atoms';
import { selectionAtom } from '@features/entity-editor/model/atoms';

// ─── Bezier path builder ────────────────────────────────────────────────────

/**
 * Builds an SVG cubic Bezier path string from (x1,y1) to (x2,y2).
 * Control points extend horizontally so the curve exits/enters the ports
 * smoothly regardless of node arrangement.
 */
export function buildBezierPath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.abs(x2 - x1);
  const cpOffset = Math.max(dx * 0.45, 50);

  return `M ${x1} ${y1} C ${x1 + cpOffset} ${y1}, ${x2 - cpOffset} ${y2}, ${x2} ${y2}`;
}

// ─── Sub-components ─────────────────────────────────────────────────────────

interface CanvasFlowProps {
  flow: FlowDTO;
  nodes: NodeDTO[];
}

function FlowTaxDisplay({ flowId, midX, midY }: { flowId: string; midX: number; midY: number }) {
  const whtAmount = useAtomValue(flowTaxAtomFamily(flowId));

  if (whtAmount === null || whtAmount === 0) return null;

  return (
    <foreignObject x={midX - 35} y={midY + 8} width="70" height="20">
      <div
        style={{
          background: 'rgba(255, 237, 213, 0.95)',
          color: '#9a3412',
          fontSize: '10px',
          textAlign: 'center',
          borderRadius: '3px',
          border: '1px solid #fdba74',
          padding: '1px 3px',
          whiteSpace: 'nowrap',
        }}
      >
        WHT: {whtAmount.toFixed(2)}
      </div>
    </foreignObject>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

export const CanvasFlow = memo(function CanvasFlow({ flow, nodes }: CanvasFlowProps) {
  const fromNode = nodes.find((n) => n.id === flow.fromId);
  const toNode = nodes.find((n) => n.id === flow.toId);
  const setSelection = useSetAtom(selectionAtom);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setSelection({ type: 'flow', id: flow.id });
    },
    [flow.id, setSelection],
  );

  if (!fromNode || !toNode) return null;

  // Anchor: right-edge center of source → left-edge center of target
  const x1 = fromNode.x + fromNode.w;
  const y1 = fromNode.y + fromNode.h / 2;
  const x2 = toNode.x;
  const y2 = toNode.y + toNode.h / 2;

  const pathData = buildBezierPath(x1, y1, x2, y2);

  // Label position at parametric midpoint of Bezier (t=0.5)
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;

  return (
    <g onClick={handleClick} style={{ cursor: 'pointer', pointerEvents: 'auto' }}>
      {/* Invisible wider hit area for easier clicking (FROZEN: 12px) */}
      <path d={pathData} stroke="transparent" strokeWidth={12} fill="none" />

      {/* Visible Bezier curve */}
      <path
        d={pathData}
        stroke="var(--stroke, #94a3b8)"
        strokeWidth={1.5}
        fill="none"
        markerEnd="url(#arrowhead)"
      />

      {/* Flow label */}
      <text
        x={midX}
        y={midY - 4}
        textAnchor="middle"
        fontSize="10"
        fill="var(--muted, #64748b)"
      >
        {flow.flowType} {flow.grossAmount > 0 ? flow.grossAmount.toLocaleString('ru-RU') : ''}
      </text>

      {/* WHT badge — local Suspense boundary */}
      <Suspense
        fallback={
          <text x={midX} y={midY + 16} textAnchor="middle" fontSize="9" fill="#94a3b8">
            calc...
          </text>
        }
      >
        <FlowTaxDisplay flowId={flow.id} midX={midX} midY={midY} />
      </Suspense>
    </g>
  );
});
