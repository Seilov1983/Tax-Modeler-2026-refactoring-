'use client';

/**
 * CanvasFlow — Konva-based flow arrow between two nodes.
 *
 * Uses Konva <Shape> for custom cubic Bezier curves.
 * Flow exits horizontally from right edge of source → left edge of target.
 * Includes flow label and WHT badge via Konva <Text> and <Rect>.
 *
 * Hit area: 12px invisible stroke for easy clicking.
 *
 * Parallel edges: nudge is applied along the true perpendicular normal
 * to ALL four Bezier control points (P0, P1, P2, P3), ensuring curves
 * stay separated even for short/tight flows.
 */

import { useAtom, useAtomValue } from 'jotai';
import { memo, useCallback, useMemo } from 'react';
import { Group, Shape, Text, Rect, Line } from 'react-konva';
import type { FlowDTO, NodeDTO } from '@shared/types';
import type { KonvaEventObject } from 'konva/lib/Node';
import { selectionAtom } from '@features/entity-editor/model/atoms';
import { canvasFilterAtom } from '../model/canvas-filter-atom';
import { fmtMoney, fmtPercent } from '@shared/lib/engine/utils';

// ─── Bezier math helpers ────────────────────────────────────────────────────

/** Evaluate cubic Bezier at parameter t ∈ [0, 1]. */
function cubicBez(t: number, p0: number, p1: number, p2: number, p3: number): number {
  const mt = 1 - t;
  return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
}

// ─── Bezier path builder (reused for draft connections) ─────────────────────

export function buildBezierPath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.abs(x2 - x1);
  const cpOffset = Math.max(dx * 0.45, 50);
  return `M ${x1} ${y1} C ${x1 + cpOffset} ${y1}, ${x2 - cpOffset} ${y2}, ${x2} ${y2}`;
}

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

  // ── Base anchor points (before parallel nudge) ────────────────────────
  const x1Base = fromNode.x + fromNode.w;
  const y1Base = fromNode.y + fromNode.h / 2;
  const x2Base = toNode.x;
  const y2Base = toNode.y + toNode.h / 2;

  // ── Perpendicular unit normal to the chord (P0 → P3) ─────────────────
  const chordDx = x2Base - x1Base;
  const chordDy = y2Base - y1Base;
  const chordLen = Math.sqrt(chordDx * chordDx + chordDy * chordDy) || 1;
  const nx = -chordDy / chordLen; // normal X (perpendicular to chord)
  const ny = chordDx / chordLen;  // normal Y (perpendicular to chord)

  // ── Nudge: apply perpendicular offset to ALL four Bezier points ───────
  const nudge = parallelCount > 1
    ? (parallelIndex - (parallelCount - 1) / 2) * NUDGE_PX
    : 0;

  const x1 = x1Base + nudge * nx;
  const y1 = y1Base + nudge * ny;
  const x2 = x2Base + nudge * nx;
  const y2 = y2Base + nudge * ny;

  // Control-point horizontal offset (derived from base chord, not nudged distance)
  const baseDx = Math.abs(chordDx);
  const cpOffset = Math.max(baseDx * 0.45, 50);

  // Explicit control points — shifted by the same perpendicular nudge
  const cp1x = x1 + cpOffset;
  const cp1y = y1;
  const cp2x = x2 - cpOffset;
  const cp2y = y2;

  // ── True Bezier midpoint at t = 0.5 ──────────────────────────────────
  const midX = cubicBez(0.5, x1, cp1x, cp2x, x2);
  const midY = cubicBez(0.5, y1, cp1y, cp2y, y2);

  const label = `${flow.flowType}${flow.grossAmount > 0 ? ' ' + fmtMoney(flow.grossAmount) : ''}`;

  return (
    <Group onClick={handleClick} onTap={handleClick} opacity={isGhosted ? 0.15 : 1} listening={!isGhosted}>
      {/* Invisible wider hit area (12px) */}
      <Shape
        sceneFunc={(ctx, shape) => {
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x2, y2);
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
          ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x2, y2);
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

      {/* Flow label — placed at true Bezier midpoint (t=0.5), not chord midpoint */}
      <Text
        x={midX - 40}
        y={midY - 14}
        text={label}
        fontSize={10}
        fill="#64748b"
        align="center"
        width={80}
        listening={false}
      />

      {/* WHT badge (if applicable) — also placed at true Bezier midpoint */}
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
