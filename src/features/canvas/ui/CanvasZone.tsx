'use client';

/**
 * CanvasZone — Konva-based jurisdiction zone rendered on a canvas Layer.
 *
 * Supports:
 * - Click on header to select the zone (opens EditorSidebar)
 * - Draggable <Group> for 60 FPS repositioning via Konva's built-in drag
 * - Resize handle (bottom-right corner)
 * - Visual highlight when selected (blue border + header)
 * - Child zones and nodes are rendered inside parent <Group> — Konva handles
 *   hierarchical movement automatically with no additional cascade calculations.
 *
 * Uses useRef for transient drag state (no React re-renders during drag).
 * Coordinates committed to Jotai only in onDragEnd (Commit phase).
 *
 * Layout: Uses calculateZoneHeaderLayout for explicit coordinate math
 * (replaces CSS flexbox / padding that Canvas does not support).
 */

import { memo, useRef, useCallback, useMemo } from 'react';
import { Group, Rect, Text, Line } from 'react-konva';
import { useAtom, useSetAtom } from 'jotai';
import { selectionAtom } from '@features/entity-editor/model/atoms';
import { moveZoneAtom, deleteZoneAtom, resizeZoneAtom } from '../model/graph-actions-atom';
import { calculateZoneHeaderLayout } from '../utils/canvas-layout';
import type { Zone } from '@shared/types';
import type Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';

interface CanvasZoneProps {
  zone: Zone;
  /** Child elements (sub-zones + nodes) rendered inside this Group */
  children?: React.ReactNode;
}

/** Map jurisdiction codes to subtle background colors */
const ZONE_COLORS: Record<string, string> = {
  KZ: '#fef3c7',
  UAE: '#dbeafe',
  HK: '#fce7f3',
  CY: '#d1fae5',
  SG: '#ede9fe',
  UK: '#fee2e2',
  US: '#e0e7ff',
  BVI: '#ccfbf1',
  CAY: '#fef9c3',
  SEY: '#f0fdfa',
};

const ZONE_BORDER_COLORS: Record<string, string> = {
  KZ: '#f59e0b',
  UAE: '#3b82f6',
  HK: '#ec4899',
  CY: '#10b981',
  SG: '#8b5cf6',
  UK: '#ef4444',
  US: '#6366f1',
  BVI: '#14b8a6',
  CAY: '#eab308',
  SEY: '#2dd4bf',
};

const HEADER_HEIGHT = 36;
const RESIZE_HANDLE_SIZE = 18;

export const CanvasZone = memo(function CanvasZone({ zone, children }: CanvasZoneProps) {
  const [selection, setSelection] = useAtom(selectionAtom);
  const moveZone = useSetAtom(moveZoneAtom);
  const deleteZone = useSetAtom(deleteZoneAtom);
  const resizeZone = useSetAtom(resizeZoneAtom);
  const isSelected = selection?.type === 'zone' && selection.id === zone.id;

  const bgColor = ZONE_COLORS[zone.jurisdiction] || '#f1f5f9';
  const borderColor = ZONE_BORDER_COLORS[zone.jurisdiction] || '#94a3b8';

  // ─── Layout math (replaces CSS flexbox) ─────────────────────────────────
  const headerLayout = useMemo(
    () => calculateZoneHeaderLayout({ width: zone.w, padding: 16 }),
    [zone.w],
  );

  // Ref for transient drag — avoid re-renders during drag
  const groupRef = useRef<Konva.Group>(null);
  const hasDragged = useRef(false);

  // Resize refs
  const resizeStartRef = useRef<{ w: number; h: number; startX: number; startY: number } | null>(null);
  const liveSizeRef = useRef({ w: zone.w, h: zone.h });

  // ─── Drag handlers ──────────────────────────────────────────────────────
  // No dragBoundFunc — free dragging to avoid conflicts with canvas pan/zoom.
  const handleDragStart = useCallback(() => {
    hasDragged.current = false;
  }, []);

  const handleDragMove = useCallback(() => {
    hasDragged.current = true;
  }, []);

  const handleDragEnd = useCallback(
    (e: KonvaEventObject<DragEvent>) => {
      if (!hasDragged.current) return;
      const node = e.target;
      moveZone({
        id: zone.id,
        x: Math.round(node.x()),
        y: Math.round(node.y()),
      });
    },
    [zone.id, moveZone],
  );

  // ─── Click to select ─────────────────────────────────────────────────────
  const handleHeaderClick = useCallback(
    (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
      e.cancelBubble = true;
      if (!hasDragged.current) {
        setSelection({ type: 'zone', id: zone.id });
      }
    },
    [zone.id, setSelection],
  );

  // ─── Delete zone ─────────────────────────────────────────────────────────
  const handleDeleteClick = useCallback(
    (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
      e.cancelBubble = true;
      deleteZone(zone.id);
      setSelection(null);
    },
    [zone.id, deleteZone, setSelection],
  );

  // ─── Resize handle ───────────────────────────────────────────────────────
  const handleResizeDragStart = useCallback(
    (e: KonvaEventObject<DragEvent>) => {
      e.cancelBubble = true;
      const node = e.target;
      resizeStartRef.current = {
        w: zone.w,
        h: zone.h,
        startX: node.x(),
        startY: node.y(),
      };
      liveSizeRef.current = { w: zone.w, h: zone.h };
    },
    [zone.w, zone.h],
  );

  const handleResizeDragMove = useCallback(
    (e: KonvaEventObject<DragEvent>) => {
      e.cancelBubble = true;
      if (!resizeStartRef.current) return;

      const node = e.target;
      const dx = node.x() - resizeStartRef.current.startX;
      const dy = node.y() - resizeStartRef.current.startY;

      liveSizeRef.current.w = Math.max(200, resizeStartRef.current.w + dx);
      liveSizeRef.current.h = Math.max(150, resizeStartRef.current.h + dy);

      // Update the zone rect visually during drag
      const parent = node.getParent();
      if (parent) {
        const zoneRect = parent.findOne('.zone-bg') as Konva.Rect | undefined;
        if (zoneRect) {
          zoneRect.width(liveSizeRef.current.w);
          zoneRect.height(liveSizeRef.current.h);
        }
        const borderRect = parent.findOne('.zone-border') as Konva.Rect | undefined;
        if (borderRect) {
          borderRect.width(liveSizeRef.current.w);
          borderRect.height(liveSizeRef.current.h);
        }
        parent.getLayer()?.batchDraw();
      }
    },
    [],
  );

  const handleResizeDragEnd = useCallback(
    (e: KonvaEventObject<DragEvent>) => {
      e.cancelBubble = true;
      // Reset handle position to bottom-right
      const node = e.target;
      node.position({
        x: liveSizeRef.current.w - RESIZE_HANDLE_SIZE,
        y: liveSizeRef.current.h - RESIZE_HANDLE_SIZE,
      });

      resizeZone({
        id: zone.id,
        w: Math.round(liveSizeRef.current.w),
        h: Math.round(liveSizeRef.current.h),
      });
      resizeStartRef.current = null;
    },
    [zone.id, resizeZone],
  );

  // Badge text
  const badgeText = `${zone.jurisdiction} \u00b7 ${zone.currency}`;

  return (
    <Group
      ref={groupRef}
      x={zone.x}
      y={zone.y}
      draggable
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
    >
      {/* Zone background fill */}
      <Rect
        name="zone-bg"
        width={zone.w}
        height={zone.h}
        fill={bgColor}
        opacity={isSelected ? 0.4 : 0.25}
        cornerRadius={12}
      />

      {/* Zone border (dashed) */}
      <Rect
        name="zone-border"
        width={zone.w}
        height={zone.h}
        stroke={isSelected ? '#3b82f6' : borderColor}
        strokeWidth={2}
        dash={[8, 4]}
        cornerRadius={12}
        listening={false}
      />

      {/* Header background — draggable area + click to select */}
      <Rect
        x={0}
        y={0}
        width={zone.w}
        height={HEADER_HEIGHT}
        fill={isSelected ? '#3b82f6' : 'transparent'}
        opacity={isSelected ? 1 : 0.5}
        cornerRadius={[10, 0, 12, 0]}
        onClick={handleHeaderClick}
        onTap={handleHeaderClick}
      />

      {/* Zone name text — positioned via layout math, truncated with ellipsis */}
      <Text
        x={headerLayout.title.x}
        y={headerLayout.title.y - 6}
        width={headerLayout.title.width}
        text={zone.name.toUpperCase()}
        fontSize={16}
        fontStyle="bold"
        fill={isSelected ? '#ffffff' : borderColor}
        letterSpacing={1.5}
        wrap="none"
        ellipsis={true}
        listening={false}
      />

      {/* Delete button — real Unicode "✕" instead of HTML entity */}
      <Group
        x={headerLayout.closeIcon.x}
        y={headerLayout.closeIcon.y - 6}
        onClick={handleDeleteClick}
        onTap={handleDeleteClick}
      >
        <Rect
          width={headerLayout.closeIcon.width}
          height={headerLayout.closeIcon.width}
          fill="transparent"
        />
        <Text
          text={'\u2715'}
          fontSize={14}
          fill={isSelected ? 'rgba(255,255,255,0.7)' : '#dc2626'}
          align="center"
          verticalAlign="middle"
          width={headerLayout.closeIcon.width}
          height={headerLayout.closeIcon.width}
        />
      </Group>

      {/* Jurisdiction badge (positioned via layout math) */}
      <Group x={headerLayout.badge.x} y={headerLayout.badge.y - 4} listening={false}>
        <Rect
          width={headerLayout.badge.width}
          height={18}
          fill={borderColor}
          opacity={0.15}
          cornerRadius={4}
        />
        <Text
          x={8}
          y={3}
          width={headerLayout.badge.width - 16}
          text={badgeText}
          fontSize={11}
          fontStyle="bold"
          fill={borderColor}
          opacity={0.6}
          wrap="none"
          ellipsis={true}
        />
      </Group>

      {/* Resize handle (bottom-right) */}
      <Group
        x={zone.w - RESIZE_HANDLE_SIZE}
        y={zone.h - RESIZE_HANDLE_SIZE}
        draggable
        onDragStart={handleResizeDragStart}
        onDragMove={handleResizeDragMove}
        onDragEnd={handleResizeDragEnd}
      >
        <Rect width={RESIZE_HANDLE_SIZE} height={RESIZE_HANDLE_SIZE} fill="transparent" />
        <Line
          points={[RESIZE_HANDLE_SIZE - 1, 1, 1, RESIZE_HANDLE_SIZE - 1]}
          stroke={borderColor}
          strokeWidth={1.5}
          opacity={0.4}
        />
        <Line
          points={[RESIZE_HANDLE_SIZE - 1, 5, 5, RESIZE_HANDLE_SIZE - 1]}
          stroke={borderColor}
          strokeWidth={1.5}
          opacity={0.4}
        />
      </Group>

      {/* Children (sub-zones and nodes) rendered inside this Group —
          Konva handles hierarchical movement automatically */}
      {children}
    </Group>
  );
});
