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

import { useAtom } from 'jotai';
import { memo, useCallback } from 'react';
import { Group, Shape, Text, Rect, Line } from 'react-konva';
import type { FlowDTO, NodeDTO } from '@shared/types';
import type { KonvaEventObject } from 'konva/lib/Node';
import { selectionAtom } from '@features/entity-editor/model/atoms';

// ─── Bezier path builder (reused for draft connections) ─────────────────────

export function buildBezierPath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.abs(x2 - x1);
  const cpOffset = Math.max(dx * 0.45, 50);
  return `M ${x1} ${y1} C ${x1 + cpOffset} ${y1}, ${x2 - cpOffset} ${y2}, ${x2} ${y2}`;
}

// ─── Component ──────────────────────────────────────────────────────────────

interface CanvasFlowProps {
  flow: FlowDTO;
  nodes: NodeDTO[];
}

export const CanvasFlow = memo(function CanvasFlow({ flow, nodes }: CanvasFlowProps) {
  const fromNode = nodes.find((n) => n.id === flow.fromId);
  const toNode = nodes.find((n) => n.id === flow.toId);
  const [selection, setSelection] = useAtom(selectionAtom);
  const isSelected = selection?.type === 'flow' && selection.id === flow.id;

  const handleClick = useCallback(
    (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
      e.cancelBubble = true;
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

  const dx = Math.abs(x2 - x1);
  const cpOffset = Math.max(dx * 0.45, 50);

  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;

  const label = `${flow.flowType}${flow.grossAmount > 0 ? ' ' + flow.grossAmount.toLocaleString('ru-RU') : ''}`;

  return (
    <Group onClick={handleClick} onTap={handleClick}>
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

      {/* Flow label */}
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
            text={`WHT: ${flow.whtRate}%`}
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
