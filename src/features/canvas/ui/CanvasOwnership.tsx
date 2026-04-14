'use client';

/**
 * CanvasOwnership — Konva-based vertical dashed ownership line.
 *
 * Uses vertical cubic Bezier: exits bottom-center of parent,
 * enters top-center of subsidiary. Purple dashed stroke with percent badge.
 *
 * Hit area: 12px invisible stroke for easy clicking.
 */

import { useAtom } from 'jotai';
import { memo, useCallback } from 'react';
import { Group, Shape, Text, Rect } from 'react-konva';
import type { OwnershipEdge, NodeDTO } from '@shared/types';
import type { KonvaEventObject } from 'konva/lib/Node';
import { selectionAtom } from '@features/entity-editor/model/atoms';
import { bankersRound2 } from '@shared/lib/engine/utils';

// ─── Vertical Bezier path builder ───────────────────────────────────────────

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
    (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
      e.cancelBubble = true;
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

  const dy = Math.abs(y2 - y1);
  const cpOffset = Math.max(dy * 0.45, 50);

  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;

  return (
    <Group onClick={handleClick} onTap={handleClick}>
      {/* Invisible wider hit area (20px) */}
      <Shape
        sceneFunc={(ctx, shape) => {
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.bezierCurveTo(x1, y1 + cpOffset, x2, y2 - cpOffset, x2, y2);
          ctx.strokeShape(shape);
        }}
        stroke="transparent"
        strokeWidth={20}
        hitStrokeWidth={20}
        listening={true}
      />

      {/* Visible dashed purple line */}
      <Shape
        sceneFunc={(ctx, shape) => {
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.bezierCurveTo(x1, y1 + cpOffset, x2, y2 - cpOffset, x2, y2);
          ctx.strokeShape(shape);
        }}
        stroke={isSelected ? '#7c3aed' : '#a855f7'}
        strokeWidth={isSelected ? 4 : 2}
        dash={[5, 5]}
        listening={false}
      />

      {/* Percent badge */}
      <Group x={midX - 18} y={midY - 9} listening={false}>
        <Rect
          width={36}
          height={18}
          fill="#f3e8ff"
          stroke="#c4b5fd"
          strokeWidth={0.5}
          cornerRadius={3}
          opacity={0.95}
        />
        <Text
          x={2}
          y={3}
          text={`${bankersRound2(edge.percent)}%`}
          fontSize={10}
          fontStyle="bold"
          fill="#7c3aed"
          width={32}
          align="center"
        />
      </Group>
    </Group>
  );
});
