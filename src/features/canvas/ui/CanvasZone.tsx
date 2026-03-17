'use client';

/**
 * CanvasZone — Konva-based jurisdiction zone rendered on a canvas Layer.
 *
 * Supports:
 * - Click on header to select the zone (opens EditorSidebar)
 * - Draggable <Group> for 60 FPS repositioning via Konva's built-in drag
 * - Konva <Transformer> for manual resizing when selected (rotation disabled)
 * - Scale-to-Width pattern: onTransformEnd extracts scaleX/Y, multiplies by
 *   current width/height, dispatches new dimensions, resets scale to 1
 * - Visual highlight when selected (blue border + header)
 * - Child zones and nodes are rendered inside parent <Group>
 *
 * Uses useRef for transient drag state (no React re-renders during drag).
 * Coordinates committed to Jotai only in onDragEnd (Commit phase).
 */

import { memo, useRef, useCallback, useMemo, useEffect, useState } from 'react';
import { Group, Rect, Text, Line, Transformer } from 'react-konva';
import { useSpring, animated } from '@react-spring/konva';
import { useAtom, useSetAtom, useAtomValue } from 'jotai';
import { selectionAtom } from '@features/entity-editor/model/atoms';
import { moveZoneAtom, deleteZoneAtom, resizeZoneAtom, flagZoneErrorAtom } from '../model/graph-actions-atom';
import { showNotificationAtom } from '../model/notification-atom';
import { zonesAtom } from '@entities/zone';
import { calculateZoneHeaderLayout } from '../utils/canvas-layout';
import type { Zone } from '@shared/types';
import type Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';

interface CanvasZoneProps {
  zone: Zone;
  children?: React.ReactNode;
}

const ZONE_COLORS: Record<string, string> = {
  KZ: '#fef3c7', UAE: '#dbeafe', HK: '#fce7f3', CY: '#d1fae5',
  SG: '#ede9fe', UK: '#fee2e2', US: '#e0e7ff', BVI: '#ccfbf1',
  CAY: '#fef9c3', SEY: '#f0fdfa',
};

const ZONE_BORDER_COLORS: Record<string, string> = {
  KZ: '#f59e0b', UAE: '#3b82f6', HK: '#ec4899', CY: '#10b981',
  SG: '#8b5cf6', UK: '#ef4444', US: '#6366f1', BVI: '#14b8a6',
  CAY: '#eab308', SEY: '#2dd4bf',
};

const HEADER_HEIGHT = 36;

export const CanvasZone = memo(function CanvasZone({ zone, children }: CanvasZoneProps) {
  const [selection, setSelection] = useAtom(selectionAtom);
  const moveZone = useSetAtom(moveZoneAtom);
  const deleteZone = useSetAtom(deleteZoneAtom);
  const resizeZone = useSetAtom(resizeZoneAtom);
  const flagZoneError = useSetAtom(flagZoneErrorAtom);
  const showNotification = useSetAtom(showNotificationAtom);
  const allZones = useAtomValue(zonesAtom);
  const isSelected = selection?.type === 'zone' && selection.id === zone.id;

  const bgColor = ZONE_COLORS[zone.jurisdiction] || '#f1f5f9';
  const borderColor = ZONE_BORDER_COLORS[zone.jurisdiction] || '#94a3b8';

  const headerLayout = useMemo(
    () => calculateZoneHeaderLayout({ width: zone.w, padding: 16 }),
    [zone.w],
  );

  // Refs
  const groupRef = useRef<Konva.Group>(null);
  const bgRectRef = useRef<Konva.Rect>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const hasDragged = useRef(false);

  // ─── Entrance animation — subtle scale-in
  const [hasAnimated] = useState(() => ({ value: false }));
  const entranceSpring = useSpring({
    from: hasAnimated.value ? { scaleX: 1, scaleY: 1, opacity: 1 } : { scaleX: 0.9, scaleY: 0.9, opacity: 0 },
    to: { scaleX: 1, scaleY: 1, opacity: 1 },
    config: { tension: 250, friction: 22 },
    onRest: () => { hasAnimated.value = true; },
  });

  // ─── Attach Transformer to the background rect when selected ──────────
  useEffect(() => {
    if (isSelected && transformerRef.current && bgRectRef.current) {
      transformerRef.current.nodes([bgRectRef.current]);
      transformerRef.current.getLayer()?.batchDraw();
    }
  }, [isSelected]);

  // ─── Spatial validation: check if regime is inside its parent country ──
  const validateSpatialBounds = useCallback(
    (childX: number, childY: number, childW: number, childH: number) => {
      if (!zone.parentId) return; // Only regimes (with parentId) need validation
      const parentZone = allZones.find((z) => z.id === zone.parentId);
      if (!parentZone) return;

      const outOfBounds =
        childX < 0 ||
        childY < 0 ||
        (childX + childW) > parentZone.w ||
        (childY + childH) > parentZone.h;

      flagZoneError({ id: zone.id, hasError: outOfBounds });
      if (outOfBounds) {
        showNotification({
          message: 'Invalid placement: Object must reside within its designated parent zone',
          type: 'error',
        });
      }
    },
    [zone.parentId, zone.id, allZones, flagZoneError, showNotification],
  );

  // ─── Drag handlers ──────────────────────────────────────────────────────
  const handleDragStart = useCallback((e: KonvaEventObject<DragEvent>) => {
    e.cancelBubble = true;
    hasDragged.current = false;
  }, []);

  const handleDragMove = useCallback((e: KonvaEventObject<DragEvent>) => {
    e.cancelBubble = true;
    hasDragged.current = true;
  }, []);

  const handleDragEnd = useCallback(
    (e: KonvaEventObject<DragEvent>) => {
      e.cancelBubble = true;
      if (!hasDragged.current) return;
      const node = e.target;
      const newX = Math.round(node.x());
      const newY = Math.round(node.y());
      moveZone({ id: zone.id, x: newX, y: newY });
      // Spatial validation temporarily disabled to isolate coordinate fixes
      // validateSpatialBounds(newX, newY, zone.w, zone.h);
    },
    [zone.id, moveZone],
  );

  // ─── Click / pointer-down to select ─────────────────────────────────────────
  const handleHeaderClick = useCallback(
    (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
      e.cancelBubble = true;
      if (!hasDragged.current) {
        setSelection({ type: 'zone', id: zone.id });
      }
    },
    [zone.id, setSelection],
  );

  // Select zone on pointer-down anywhere on its body (not just the header).
  // cancelBubble prevents the Stage from catching this event and clearing
  // the selection in handleStageClick.
  const handleZonePointerDown = useCallback(
    (e: KonvaEventObject<PointerEvent>) => {
      e.cancelBubble = true;
      setSelection({ type: 'zone', id: zone.id });
    },
    [zone.id, setSelection],
  );

  // ─── Delete zone ──────────────────────────────────────────────────────────
  const handleDeleteClick = useCallback(
    (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
      e.cancelBubble = true;
      deleteZone(zone.id);
      setSelection(null);
    },
    [zone.id, deleteZone, setSelection],
  );

  // ─── Transform end: Scale-to-Width pattern ─────────────────────────────
  // Extract scaleX/Y, multiply by current width/height, dispatch new dimensions,
  // immediately reset Konva node scale to 1 to prevent UI/text distortion.
  const handleTransformEnd = useCallback(() => {
    const node = bgRectRef.current;
    if (!node) return;

    const scaleX = node.scaleX();
    const scaleY = node.scaleY();

    // Calculate absolute dimensions from scale, enforce minimums
    const newW = Math.max(5, Math.round(node.width() * scaleX));
    const newH = Math.max(5, Math.round(node.height() * scaleY));

    // CRITICAL: Reset scale to 1 immediately to prevent text/UI distortion
    node.scaleX(1);
    node.scaleY(1);
    node.width(newW);
    node.height(newH);

    // Dispatch explicit width/height to Jotai (never scaleX/scaleY)
    resizeZone({ id: zone.id, w: newW, h: newH });
  }, [zone.id, resizeZone]);

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
      scaleX={entranceSpring.scaleX.get()}
      scaleY={entranceSpring.scaleY.get()}
      opacity={entranceSpring.opacity.get()}
    >
      {/* Zone background fill — onPointerDown selects zone + stops bubble to Stage */}
      <Rect
        ref={bgRectRef}
        name="zone-bg"
        width={zone.w}
        height={zone.h}
        fill={bgColor}
        opacity={isSelected ? 0.4 : 0.25}
        cornerRadius={12}
        onPointerDown={handleZonePointerDown}
      />

      {/* Zone border (dashed) — red if hasError */}
      <Rect
        name="zone-border"
        width={zone.w}
        height={zone.h}
        stroke={zone.hasError ? '#dc2626' : isSelected ? '#3b82f6' : borderColor}
        strokeWidth={zone.hasError ? 3 : 2}
        dash={zone.hasError ? undefined : [8, 4]}
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

      {/* Zone name text */}
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

      {/* Delete button */}
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

      {/* Jurisdiction badge */}
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

      {/* Konva Transformer — only when selected, rotation disabled */}
      {isSelected && (
        <Transformer
          ref={transformerRef}
          rotateEnabled={false}
          enabledAnchors={[
            'top-left', 'top-right', 'bottom-left', 'bottom-right',
            'middle-left', 'middle-right', 'top-center', 'bottom-center',
          ]}
          boundBoxFunc={(oldBox, newBox) => {
            // Enforce minimum dimensions
            if (newBox.width < 200 || newBox.height < 150) {
              return oldBox;
            }
            return newBox;
          }}
          onTransformEnd={handleTransformEnd}
          borderStroke="#3b82f6"
          borderStrokeWidth={2}
          anchorFill="#ffffff"
          anchorStroke="#3b82f6"
          anchorSize={8}
          anchorCornerRadius={2}
        />
      )}

      {/* Children (sub-zones and nodes) */}
      {children}
    </Group>
  );
});
