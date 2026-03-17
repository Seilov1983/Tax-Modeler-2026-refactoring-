'use client';

/**
 * CanvasNode — Konva-based node rendering.
 *
 * Architecture:
 * - Uses Konva <Group> with draggable for built-in drag-and-drop
 * - Transient drag: useRef for intermediate state, no React re-renders during drag
 * - On drop (onDragEnd): final position committed to Jotai atom
 * - Connection ports (flow + ownership) rendered as Konva <Circle>
 * - No dragBoundFunc — free dragging to avoid conflicts with canvas pan/zoom
 *
 * For node types: Konva <Rect>, <Text>, <Circle> replace the DOM elements.
 * Events use KonvaEventObject for proper typing.
 *
 * Layout: Uses calculateNodeCardLayout for explicit padding math
 * (Canvas has no CSS padding — offsets are computed manually).
 */

import { useAtomValue, useSetAtom } from 'jotai';
import { useRef, useCallback, memo, useMemo } from 'react';
import { Group, Rect, Text, Circle } from 'react-konva';
import type { PrimitiveAtom } from 'jotai';
import type Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import type { NodeDTO } from '@shared/types';
import { selectionAtom } from '@features/entity-editor/model/atoms';
import { draftConnectionAtom, commitDraftConnectionAtom } from '../model/draft-connection-atom';
import { moveNodesAtom } from '../model/graph-actions-atom';
import { calculateNodeCardLayout } from '../utils/canvas-layout';

// ─── Constants ──────────────────────────────────────────────────────────────

const NODE_COLORS: Record<string, { bg: string; border: string; header: string }> = {
  company: { bg: '#ffffff', border: '#3b82f6', header: '#eff6ff' },
  person: { bg: '#ffffff', border: '#22c55e', header: '#f0fdf4' },
  txa: { bg: '#f8fafc', border: '#94a3b8', header: '#f1f5f9' },
};

const TYPE_BADGES: Record<string, string> = {
  company: 'CO',
  person: 'P',
  txa: 'TXA',
};

const HEADER_HEIGHT = 28;
const PORT_RADIUS = 6;
const NODE_PADDING = 10;

// ─── Component ──────────────────────────────────────────────────────────────

interface CanvasNodeProps {
  nodeAtom: PrimitiveAtom<NodeDTO>;
}

export const CanvasNode = memo(function CanvasNode({ nodeAtom }: CanvasNodeProps) {
  const node = useAtomValue(nodeAtom);
  const selection = useAtomValue(selectionAtom);
  const setSelection = useSetAtom(selectionAtom);
  const setDraft = useSetAtom(draftConnectionAtom);
  const commitDraft = useSetAtom(commitDraftConnectionAtom);
  const moveNodes = useSetAtom(moveNodesAtom);

  const groupRef = useRef<Konva.Group>(null);
  const hasDragged = useRef(false);
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  const isSelected = selection?.type === 'node' && selection.ids.includes(node.id);
  const isTxa = node.type === 'txa';
  const colors = NODE_COLORS[node.type] || NODE_COLORS.company;
  const riskCount = node.riskFlags?.length || 0;

  // ─── Layout math (replaces CSS padding) ──────────────────────────────
  const cardLayout = useMemo(
    () => calculateNodeCardLayout(node.w, node.h, NODE_PADDING),
    [node.w, node.h],
  );

  // ─── Drag handlers ────────────────────────────────────────────────────
  const handleDragStart = useCallback(
    (e: KonvaEventObject<DragEvent>) => {
      if (isTxa) {
        e.target.stopDrag();
        return;
      }
      hasDragged.current = false;

      // Store original positions on all selected siblings for accurate bulk drag
      const sel = selectionRef.current;
      if (sel?.type === 'node' && sel.ids.length > 1 && sel.ids.includes(node.id)) {
        const stage = e.target.getStage();
        if (stage) {
          for (const id of sel.ids) {
            if (id === node.id) continue;
            const sibling = stage.findOne(`#node-${id}`) as Konva.Group | undefined;
            if (sibling) {
              sibling.setAttr('data-orig-x', sibling.x());
              sibling.setAttr('data-orig-y', sibling.y());
            }
          }
        }
      }
    },
    [isTxa, node.id],
  );

  const handleDragMove = useCallback(
    (e: KonvaEventObject<DragEvent>) => {
      hasDragged.current = true;

      // Bulk drag: move selected siblings via direct Konva position updates
      const sel = selectionRef.current;
      if (sel?.type === 'node' && sel.ids.length > 1 && sel.ids.includes(node.id)) {
        const stage = e.target.getStage();
        if (!stage) return;
        const dx = e.target.x() - node.x;
        const dy = e.target.y() - node.y;
        for (const id of sel.ids) {
          if (id === node.id) continue;
          const sibling = stage.findOne(`#node-${id}`) as Konva.Group | undefined;
          if (sibling) {
            // Read the original position from stored data
            const origX = sibling.getAttr('data-orig-x') ?? sibling.x();
            const origY = sibling.getAttr('data-orig-y') ?? sibling.y();
            sibling.position({ x: origX + dx, y: origY + dy });
          }
        }
      }
    },
    [node.id, node.x, node.y],
  );

  const handleDragEnd = useCallback(
    (e: KonvaEventObject<DragEvent>) => {
      if (!hasDragged.current) return;

      const target = e.target;
      const x = Math.round(target.x());
      const y = Math.round(target.y());

      const sel = selectionRef.current;
      const isBulk = sel?.type === 'node' && sel.ids.length > 1 && sel.ids.includes(node.id);

      if (isBulk) {
        const stage = target.getStage();
        const dx = x - node.x;
        const dy = y - node.y;
        const entries = sel.ids.map((id) => {
          if (id === node.id) return { id, x, y };
          const sibling = stage?.findOne(`#node-${id}`) as Konva.Group | undefined;
          if (sibling) {
            const pos = { id, x: Math.round(sibling.x()), y: Math.round(sibling.y()) };
            // Clean up transient attrs
            sibling.setAttr('data-orig-x', undefined);
            sibling.setAttr('data-orig-y', undefined);
            return pos;
          }
          return { id, x: node.x + dx, y: node.y + dy };
        });
        moveNodes(entries);
      } else {
        moveNodes([{ id: node.id, x, y }]);
      }
    },
    [node.id, node.x, node.y, moveNodes],
  );

  // ─── Click to select ──────────────────────────────────────────────────
  const handleClick = useCallback(
    (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
      if (hasDragged.current) return;
      e.cancelBubble = true;

      const evt = e.evt;
      const sel = selectionRef.current;
      if (evt.shiftKey) {
        if (sel?.type === 'node') {
          const exists = sel.ids.includes(node.id);
          const newIds = exists
            ? sel.ids.filter((id) => id !== node.id)
            : [...sel.ids, node.id];
          setSelection(newIds.length > 0 ? { type: 'node', ids: newIds } : null);
        } else {
          setSelection({ type: 'node', ids: [node.id] });
        }
      } else {
        setSelection({ type: 'node', ids: [node.id] });
      }
    },
    [node.id, setSelection],
  );

  // ─── Flow port (right edge, blue) ─────────────────────────────────────
  const handleFlowPortDown = useCallback(
    (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
      e.cancelBubble = true;
      setDraft({ sourceNodeId: node.id, connectionType: 'flow' });
    },
    [node.id, setDraft],
  );

  // ─── Ownership port (bottom edge, purple) ─────────────────────────────
  const handleOwnershipPortDown = useCallback(
    (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
      e.cancelBubble = true;
      setDraft({ sourceNodeId: node.id, connectionType: 'ownership' });
    },
    [node.id, setDraft],
  );

  // ─── Drop target: complete connection ──────────────────────────────────
  // Uses commitDraftConnectionAtom (action atom) which reads draft state
  // internally — CanvasNode does NOT subscribe to draftConnectionAtom,
  // avoiding re-renders when a port drag starts/ends on any node.
  const handleNodePointerUp = useCallback(
    (e: KonvaEventObject<PointerEvent>) => {
      e.cancelBubble = true;
      commitDraft(node.id);
    },
    [node.id, commitDraft],
  );

  // Build badge text
  const badges: string[] = [];
  if (node.frozen) badges.push('FROZEN');
  if (riskCount > 0) badges.push(`${riskCount} risk${riskCount > 1 ? 's' : ''}`);

  return (
    <Group
      ref={groupRef}
      id={`node-${node.id}`}
      x={node.x}
      y={node.y}
      draggable={!isTxa}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onClick={handleClick}
      onTap={handleClick}
      onPointerUp={handleNodePointerUp}
    >
      {/* Node body — uses layout background dimensions */}
      <Rect
        width={cardLayout.background.width}
        height={cardLayout.background.height}
        fill={colors.bg}
        stroke={isSelected ? '#2563eb' : node.frozen ? '#ef4444' : colors.border}
        strokeWidth={isSelected ? 2.5 : node.frozen ? 2 : 1.5}
        cornerRadius={8}
        shadowColor={node.frozen ? '#ef4444' : 'rgba(0,0,0,0.1)'}
        shadowBlur={node.frozen ? 8 : 4}
        shadowOffsetY={2}
        shadowOpacity={node.frozen ? 0.3 : 0.15}
      />

      {/* Header background */}
      <Rect
        width={cardLayout.background.width}
        height={HEADER_HEIGHT}
        fill={colors.header}
        cornerRadius={[8, 8, 0, 0]}
        listening={false}
      />

      {/* Type badge — offset by padding */}
      <Text
        x={cardLayout.title.x}
        y={cardLayout.title.y - 3}
        text={TYPE_BADGES[node.type] || 'N'}
        fontSize={10}
        fontStyle="bold"
        fill={colors.border}
        listening={false}
      />

      {/* Node name — offset by padding, width constrained to prevent overflow */}
      <Text
        x={cardLayout.title.x + 25}
        y={cardLayout.title.y - 3}
        text={node.name}
        fontSize={12}
        fontStyle="600"
        fill="#1f2937"
        width={cardLayout.title.width - 25}
        ellipsis={true}
        wrap="none"
        listening={false}
      />

      {/* Badges row below header — offset by padding */}
      {badges.length > 0 && (
        <Text
          x={cardLayout.title.x}
          y={HEADER_HEIGHT + 6}
          text={badges.join('  \u00b7  ')}
          fontSize={10}
          fill={node.frozen ? '#ef4444' : '#eab308'}
          fontStyle="bold"
          width={cardLayout.title.width}
          wrap="none"
          ellipsis={true}
          listening={false}
        />
      )}

      {/* CFC badge */}
      {node.riskFlags?.some((r) => r.type === 'CFC_RISK') && (
        <Group x={node.w - NODE_PADDING - 28} y={HEADER_HEIGHT + 4} listening={false}>
          <Rect width={28} height={14} fill="#fef3c7" cornerRadius={3} stroke="#ca8a04" strokeWidth={0.5} />
          <Text x={4} y={2} text="CFC" fontSize={9} fontStyle="bold" fill="#ca8a04" />
        </Group>
      )}

      {/* Flow port (right edge, blue) */}
      {!isTxa && (
        <Circle
          x={node.w}
          y={node.h / 2}
          radius={PORT_RADIUS}
          fill="#3b82f6"
          stroke="#ffffff"
          strokeWidth={2}
          onMouseDown={handleFlowPortDown}
          onTouchStart={handleFlowPortDown}
        />
      )}

      {/* Ownership port (bottom edge, purple) */}
      {!isTxa && (
        <Circle
          x={node.w / 2}
          y={node.h}
          radius={PORT_RADIUS}
          fill="#a855f7"
          stroke="#ffffff"
          strokeWidth={2}
          onMouseDown={handleOwnershipPortDown}
          onTouchStart={handleOwnershipPortDown}
        />
      )}
    </Group>
  );
});
