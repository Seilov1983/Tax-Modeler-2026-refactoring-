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
 * - Visual highlight when selected (neutral gray border + tinted header)
 * - Apple Liquid Glass Transformer: round squircle anchors, soft gray border
 * - Guard-rails: soft glow on valid parent Country, red stroke on invalid target
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
import { dragOverFeedbackAtom } from '../model/drag-over-feedback-atom';
import { contextMenuAtom } from '../model/context-menu-atom';
import { zonesAtom } from '@entities/zone';
import { settingsAtom } from '@features/settings';
import { pointInZone, zoneArea } from '@shared/lib/engine/engine-core';
import { localizedName } from '@shared/lib/i18n';
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
  const [dragOverFeedback, setDragOverFeedback] = useAtom(dragOverFeedbackAtom);
  const setContextMenu = useSetAtom(contextMenuAtom);
  const allZones = useAtomValue(zonesAtom);
  const settings = useAtomValue(settingsAtom);
  const lang = settings.language || 'en';
  const isSelected = selection?.type === 'zone' && selection.id === zone.id;

  const bgColor = ZONE_COLORS[zone.jurisdiction] || '#f1f5f9';
  const borderColor = ZONE_BORDER_COLORS[zone.jurisdiction] || '#94a3b8';

  const headerLayout = useMemo(
    () => calculateZoneHeaderLayout({ width: zone.w, padding: 16 }),
    [zone.w],
  );

  // ─── Guard-rail visual state for THIS zone ─────────────────────────────────
  const isValidDropTarget = dragOverFeedback.validParentId === zone.id;
  const isInvalidDropTarget = dragOverFeedback.invalidZoneId === zone.id;

  // Refs
  const groupRef = useRef<Konva.Group>(null);
  const bgRectRef = useRef<Konva.Rect>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const hasDragged = useRef(false);
  const isDblClickGuard = useRef(false);

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
      const parentZone = allZones.find((z: Zone) => z.id === zone.parentId);
      if (!parentZone) return;

      // All coordinates are absolute — check child rect is inside parent rect
      const outOfBounds =
        childX < parentZone.x ||
        childY < parentZone.y ||
        (childX + childW) > (parentZone.x + parentZone.w) ||
        (childY + childH) > (parentZone.y + parentZone.h);

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

  // ─── Double-click handler — cancel drag + open Add Node menu ────────────
  const handleDblClick = useCallback(
    (e: KonvaEventObject<MouseEvent>) => {
      e.cancelBubble = true;
      e.evt.stopPropagation();

      // Programmatically stop any in-flight drag that the first click triggered
      isDblClickGuard.current = true;
      const group = groupRef.current;
      if (group) {
        group.stopDrag();
        // Reset position to committed zone coords (undo any partial drag offset)
        group.position({ x: zone.x, y: zone.y });
        group.getLayer()?.batchDraw();
      }

      // Determine zone kind: country if it has children, else regime
      const isCountry = allZones.some((z) => z.parentId === zone.id);
      const kind = isCountry ? 'country' : 'regime';

      // Get screen coordinates for the DOM overlay menu
      const stage = group?.getStage();
      const screenX = e.evt.clientX;
      const screenY = e.evt.clientY;

      // Get canvas coordinates via matrix inversion
      let canvasX = zone.x + zone.w / 2;
      let canvasY = zone.y + zone.h / 2;
      if (stage) {
        const pos = stage.getPointerPosition();
        if (pos) {
          const transform = stage.getAbsoluteTransform().copy().invert();
          const cp = transform.point(pos);
          canvasX = Math.round(cp.x);
          canvasY = Math.round(cp.y);
        }
      }

      // Open the Liquid Glass Add Node menu at pointer coordinates
      setContextMenu({
        kind: kind as 'country' | 'regime',
        screenX,
        screenY,
        canvasX,
        canvasY,
        zone,
      });

      // Release the guard after the event cycle completes
      setTimeout(() => { isDblClickGuard.current = false; }, 0);
    },
    [zone, allZones, setContextMenu],
  );

  // ─── Drag handlers ──────────────────────────────────────────────────────
  const handleDragStart = useCallback((e: KonvaEventObject<DragEvent>) => {
    // If a double-click was just detected, cancel the drag immediately
    if (isDblClickGuard.current) {
      e.target.stopDrag();
      return;
    }
    e.cancelBubble = true;
    hasDragged.current = false;
  }, []);

  const handleDragMove = useCallback(
    (e: KonvaEventObject<DragEvent>) => {
      e.cancelBubble = true;
      hasDragged.current = true;

      // ─── Guard-rail feedback: only for regime zones (zones with a parentId) ──
      if (!zone.parentId) return;

      const node = e.target;
      const currentX = Math.round(node.x());
      const currentY = Math.round(node.y());
      const centerX = currentX + zone.w / 2;
      const centerY = currentY + zone.h / 2;

      // Find which country zone (no parentId) the regime center is over
      const countryZones = allZones.filter((z: Zone) => !z.parentId && z.id !== zone.id);
      const hoveredCountry = countryZones.find((cz: Zone) => pointInZone(centerX, centerY, cz));

      if (hoveredCountry) {
        if (hoveredCountry.id === zone.parentId) {
          // Hovering over the correct parent — soft glow
          setDragOverFeedback({ validParentId: hoveredCountry.id, invalidZoneId: null });
        } else {
          // Hovering over the wrong country — red indicator
          setDragOverFeedback({ validParentId: zone.parentId, invalidZoneId: hoveredCountry.id });
        }
      } else {
        // Not over any country — highlight correct parent as guidance
        setDragOverFeedback({ validParentId: zone.parentId, invalidZoneId: null });
      }
    },
    [zone.parentId, zone.id, zone.w, zone.h, allZones, setDragOverFeedback],
  );

  const handleDragEnd = useCallback(
    (e: KonvaEventObject<DragEvent>) => {
      e.cancelBubble = true;

      // Clear guard-rail feedback
      setDragOverFeedback({ validParentId: null, invalidZoneId: null });

      if (!hasDragged.current) return;
      const node = e.target;
      const newX = Math.round(node.x());
      const newY = Math.round(node.y());
      moveZone({ id: zone.id, x: newX, y: newY });

      // Spatial validation for regime zones
      if (zone.parentId) {
        validateSpatialBounds(newX, newY, zone.w, zone.h);
      }
    },
    [zone.id, zone.parentId, zone.w, zone.h, moveZone, validateSpatialBounds, setDragOverFeedback],
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
  // Single-click selects only — does NOT open the sidebar (per Click Matrix).
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
    const newW = Math.max(100, Math.round(node.width() * scaleX));
    const newH = Math.max(100, Math.round(node.height() * scaleY));

    // CRITICAL: Reset scale to 1 immediately to prevent text/UI distortion
    node.scaleX(1);
    node.scaleY(1);
    node.width(newW);
    node.height(newH);

    // Dispatch explicit width/height to Jotai (never scaleX/scaleY)
    resizeZone({ id: zone.id, w: newW, h: newH });
  }, [zone.id, resizeZone]);

  // ─── Compute border visual state ───────────────────────────────────────────
  // Priority: error > invalid drop target > valid drop target > selected > default
  const computedBorderStroke = useMemo(() => {
    if (zone.hasError) return '#ff3b30';
    if (isInvalidDropTarget) return '#ff3b30';
    if (isValidDropTarget) return '#34c759';
    if (isSelected) return '#969696';
    return borderColor;
  }, [zone.hasError, isInvalidDropTarget, isValidDropTarget, isSelected, borderColor]);

  const computedBorderWidth = useMemo(() => {
    if (zone.hasError || isInvalidDropTarget) return 2.5;
    if (isValidDropTarget) return 2;
    return 1.5;
  }, [zone.hasError, isInvalidDropTarget, isValidDropTarget]);

  const computedShadowColor = useMemo(() => {
    if (zone.hasError) return '#ff3b30';
    if (isInvalidDropTarget) return '#ff3b30';
    if (isValidDropTarget) return '#34c759';
    return 'transparent';
  }, [zone.hasError, isInvalidDropTarget, isValidDropTarget]);

  const computedShadowBlur = useMemo(() => {
    if (zone.hasError) return 16;
    if (isInvalidDropTarget) return 20;
    if (isValidDropTarget) return 24;
    return 0;
  }, [zone.hasError, isInvalidDropTarget, isValidDropTarget]);

  const computedShadowOpacity = useMemo(() => {
    if (zone.hasError) return 0.25;
    if (isInvalidDropTarget) return 0.35;
    if (isValidDropTarget) return 0.3;
    return 0;
  }, [zone.hasError, isInvalidDropTarget, isValidDropTarget]);

  const badgeText = `${zone.jurisdiction} \u00b7 ${zone.currency}`;

  return (
    <Group
      ref={groupRef}
      x={zone.x}
      y={zone.y}
      draggable
      onDblClick={handleDblClick}
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
        opacity={isSelected ? 0.35 : isValidDropTarget ? 0.3 : 0.2}
        cornerRadius={16}
        onPointerDown={handleZonePointerDown}
      />

      {/* Zone border — guard-rail visual feedback + refined red glow if hasError */}
      <Rect
        name="zone-border"
        width={zone.w}
        height={zone.h}
        stroke={computedBorderStroke}
        strokeWidth={computedBorderWidth}
        dash={zone.hasError || isInvalidDropTarget ? undefined : isValidDropTarget ? [12, 4] : [8, 4]}
        cornerRadius={16}
        shadowColor={computedShadowColor}
        shadowBlur={computedShadowBlur}
        shadowOpacity={computedShadowOpacity}
        listening={false}
      />

      {/* Header background — draggable area + click to select */}
      <Rect
        x={0}
        y={0}
        width={zone.w}
        height={HEADER_HEIGHT}
        fill={isSelected ? borderColor : 'transparent'}
        opacity={isSelected ? 0.18 : 0.5}
        cornerRadius={[14, 14, 0, 0]}
        onClick={handleHeaderClick}
        onTap={handleHeaderClick}
      />

      {/* Zone name text */}
      <Text
        x={headerLayout.title.x}
        y={headerLayout.title.y - 6}
        width={headerLayout.title.width}
        text={localizedName(zone.name, lang).toUpperCase()}
        fontSize={16}
        fontStyle="bold"
        fill={isSelected ? '#1d1d1f' : borderColor}
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
          fill={isSelected ? '#86868b' : '#ff3b30'}
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

      {/* Konva Transformer — Apple Liquid Glass style: round squircle anchors,
          soft gray borders, no rotation. */}
      {isSelected && (
        <Transformer
          ref={transformerRef}
          rotateEnabled={false}
          enabledAnchors={[
            'top-left', 'top-right', 'bottom-left', 'bottom-right',
            'middle-left', 'middle-right', 'top-center', 'bottom-center',
          ]}
          boundBoxFunc={(oldBox, newBox) => {
            // Enforce minimum 100px to prevent resize inversion / unusable zones
            if (newBox.width < 100 || newBox.height < 100) {
              return oldBox;
            }
            return newBox;
          }}
          onTransformEnd={handleTransformEnd}
          borderStroke="#969696"
          borderStrokeWidth={1.5}
          borderDash={[6, 3]}
          anchorFill="#ffffff"
          anchorStroke="#969696"
          anchorStrokeWidth={1.5}
          anchorSize={12}
          anchorCornerRadius={6}
        />
      )}

      {/* Children (sub-zones and nodes) */}
      {children}
    </Group>
  );
});
