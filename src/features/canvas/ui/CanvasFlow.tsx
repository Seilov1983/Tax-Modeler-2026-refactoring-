'use client';

/**
 * CanvasFlow — Konva-based flow arrow between two nodes.
 *
 * Uses Konva <Shape> for custom cubic Bezier curves.
 * Flow exits horizontally from right edge of source → left edge of target.
 * Includes flow label and WHT badge via Konva <Text> and <Rect>.
 *
 * Hit area: 12px invisible stroke for easy clicking.
 */

import { useAtom, useAtomValue } from 'jotai';
import { memo, useCallback, useMemo } from 'react';
import { Group, Shape, Text, TextPath, Rect, Line } from 'react-konva';
import type { FlowDTO, NodeDTO } from '@shared/types';
import type { KonvaEventObject } from 'konva/lib/Node';
import { selectionAtom } from '@features/entity-editor/model/atoms';
import { canvasFilterAtom } from '../model/canvas-filter-atom';
import { fmtMoney, fmtPercent } from '@shared/lib/engine/utils';

// ─── Bezier path builder (reused for draft connections) ─────────────────────

export function buildBezierPath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.abs(x2 - x1);
  const cpOffset = Math.max(dx * 0.45, 50);
  return `M ${x1} ${y1} C ${x1 + cpOffset} ${y1}, ${x2 - cpOffset} ${y2}, ${x2} ${y2}`;
}

// ─── Component ──────────────────────────────────────────────────────────────

// ─── Parallel Edge Nudging ───────────────────────────────────────────────────
const NUDGE_PX = 20;

interface CanvasFlowProps {
  flow: FlowDTO;
  nodes: NodeDTO[];
  /** Index of this flow within its parallel bundle (0-based). */
  parallelIndex?: number;
  /** Total flows in this parallel bundle. */
  parallelCount?: number;
}

export const CanvasFlow = memo(function CanvasFlow({ flow, nodes, parallelIndex = 0, parallelCount = 1 }: CanvasFlowProps) {
  const fromNode = nodes.find((n) => n.id === flow.fromId);
  const toNode = nodes.find((n) => n.id === flow.toId);
  const [selection, setSelection] = useAtom(selectionAtom);
  const canvasFilter = useAtomValue(canvasFilterAtom);
  const isSelected = selection?.type === 'flow' && selection.id === flow.id;

  // ─── Ghosting: declarative match against active flow type filters ──
  const isGhosted = useMemo(() => {
    if (!canvasFilter.isActive) return false;
    const { flowTypes } = canvasFilter;
    if (flowTypes.length === 0) return false;
    return !flowTypes.includes(flow.flowType);
  }, [canvasFilter, flow.flowType]);

  const handleClick = useCallback(
    (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
      e.cancelBubble = true;
      setSelection({ type: 'flow', id: flow.id });
    },
    [flow.id, setSelection],
  );

  if (!fromNode || !toNode) return null;

  // Parallel edge nudge: offset perpendicular to flow direction
  const nudge = parallelCount > 1
    ? (parallelIndex - (parallelCount - 1) / 2) * NUDGE_PX
    : 0;

  // Anchor: right-edge center of source → left-edge center of target (+ nudge)
  const x1 = fromNode.x + fromNode.w;
  const y1 = fromNode.y + fromNode.h / 2 + nudge;
  const x2 = toNode.x;
  const y2 = toNode.y + toNode.h / 2 + nudge;

  const dx = Math.abs(x2 - x1);
  const cpOffset = Math.max(dx * 0.45, 50);

  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;

  const label = `${flow.flowType}${flow.grossAmount > 0 ? ' ' + fmtMoney(flow.grossAmount) : ''}`;

  // SVG path data for TextPath — follows the Bezier curve exactly
  const pathData = `M ${x1} ${y1} C ${x1 + cpOffset} ${y1} ${x2 - cpOffset} ${y2} ${x2} ${y2}`;
  // Dynamic startOffset: shift label position along path for parallel flows to prevent overlap
  const pathLength = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
  const baseOffset = Math.max(pathLength * 0.25, 40);
  const parallelShift = parallelCount > 1 ? (parallelIndex - (parallelCount - 1) / 2) * 30 : 0;
  const labelOffset = baseOffset + parallelShift;

  return (
    <Group onClick={handleClick} onTap={handleClick} opacity={isGhosted ? 0.15 : 1} listening={!isGhosted}>
      {/* Invisible wider hit area (12px) */}
      <Shape
        sceneFunc={(ctx, shape) => {
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.bezierCurveTo(x1 + cpOffset, y1, x2 - cpOffset, y2, x2, y2);
          ctx.strokeShape(shape);
        }}
        stroke="transparent"
        strokeWidth={20}
        hitStrokeWidth={20}
        listening={true}
      />

      {/* Visible Bezier curve */}
      <Shape
        sceneFunc={(ctx, shape) => {
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.bezierCurveTo(x1 + cpOffset, y1, x2 - cpOffset, y2, x2, y2);
          ctx.strokeShape(shape);
        }}
        stroke={isSelected ? '#2563eb' : '#94a3b8'}
        strokeWidth={isSelected ? 4 : 1.5}
        listening={false}
      />

      {/* Arrowhead at target */}
      <Line
        points={[
          x2 - 8, y2 - 4,
          x2, y2,
          x2 - 8, y2 + 4,
        ]}
        stroke={isSelected ? '#2563eb' : '#94a3b8'}
        strokeWidth={1.5}
        listening={false}
      />

      {/* Flow label — follows the Bezier curve via TextPath to avoid collision on parallel edges */}
      <TextPath
        data={pathData}
        text={label}
        fontSize={10}
        fill="#64748b"
        listening={false}
        textBaseline="bottom"
        letterSpacing={0.3}
      />

      {/* WHT badge (if applicable) */}
      {flow.whtRate > 0 && (
        <Group x={midX - 30} y={midY + 6} listening={false}>
          <Rect
            width={60}
            height={16}
            fill="#fff7ed"
            stroke="#fdba74"
            strokeWidth={0.5}
            cornerRadius={3}
          />
          <Text
            x={3}
            y={3}
            text={`WHT: ${fmtPercent(flow.whtRate / 100)}`}
            fontSize={9}
            fill="#9a3412"
            width={54}
            align="center"
          />
        </Group>
      )}
    </Group>
  );
});
