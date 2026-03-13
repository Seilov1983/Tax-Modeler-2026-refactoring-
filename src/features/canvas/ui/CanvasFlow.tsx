'use client';

/**
 * CanvasFlow — renders a flow arrow between two nodes with optional WHT badge.
 *
 * Each flow gets its own local <Suspense> boundary so WHT calculation
 * doesn't block arrow rendering or other flows.
 */

import { useAtomValue, useSetAtom } from 'jotai';
import { memo, Suspense, useCallback } from 'react';
import type { FlowDTO, NodeDTO } from '@shared/types';
import { flowTaxAtomFamily } from '@features/tax-calculator/model/atoms';
import { selectionAtom } from '@features/entity-editor/model/atoms';

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

  const x1 = fromNode.x + fromNode.w / 2;
  const y1 = fromNode.y + fromNode.h / 2;
  const x2 = toNode.x + toNode.w / 2;
  const y2 = toNode.y + toNode.h / 2;
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;

  return (
    <g onClick={handleClick} style={{ cursor: 'pointer', pointerEvents: 'auto' }}>
      {/* Invisible wider hit area for easier clicking */}
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke="transparent"
        strokeWidth={12}
      />

      {/* Arrow line */}
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke="var(--stroke, #94a3b8)"
        strokeWidth={1.5}
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
