'use client';

/**
 * useCanvasViewport — Pan & Zoom for Konva Stage.
 *
 * Architecture:
 * - Viewport state (panX, panY, scale) lives in useRef — NOT in React state.
 * - Konva Stage position/scale is set imperatively via stage.position() / stage.scale().
 * - Zero React re-renders during scroll or zoom — pure 60 FPS Konva updates.
 * - An optional onViewportChange callback is throttled via rAF to sync a
 *   Jotai atom for low-frequency UI (zoom controls, minimap).
 *
 * Controls:
 * - Mouse wheel: zoom in/out (centered on cursor)
 * - Middle-click drag OR Space+drag: pan the canvas
 * - Pinch gesture (trackpad): zoom
 */

import { useRef, useCallback, useEffect } from 'react';
import type Konva from 'konva';

export interface ViewportState {
  panX: number;
  panY: number;
  scale: number;
}

const MIN_SCALE = 0.1;
const MAX_SCALE = 3;
const ZOOM_SENSITIVITY = 0.001;
const DEFAULT_STATE: ViewportState = { panX: 0, panY: 0, scale: 1 };

export function useCanvasViewport(
  stageRef: React.RefObject<Konva.Stage | null>,
  onViewportChange?: (state: ViewportState) => void,
  enabled: boolean = true,
) {
  const stateRef = useRef<ViewportState>({ ...DEFAULT_STATE });
  const isPanningRef = useRef(false);
  const spaceDownRef = useRef(false);
  const indicatorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafIdRef = useRef(0);

  // ─── Throttled sync to Jotai atom via rAF ─────────────────────────────────
  const notifyChange = useCallback(() => {
    if (!onViewportChange) return;
    if (rafIdRef.current) return;
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = 0;
      onViewportChange({ ...stateRef.current });
    });
  }, [onViewportChange]);

  // ─── Apply transform directly to Konva Stage ──────────────────────────────
  const applyTransform = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const { panX, panY, scale } = stateRef.current;
    stage.position({ x: panX, y: panY });
    stage.scale({ x: scale, y: scale });
    stage.batchDraw();
    notifyChange();
  }, [stageRef, notifyChange]);

  // ─── Zoom centered on a point ─────────────────────────────────────────────
  const zoomAt = useCallback(
    (clientX: number, clientY: number, delta: number) => {
      const stage = stageRef.current;
      if (!stage) return;

      const container = stage.container();
      const rect = container.getBoundingClientRect();
      const s = stateRef.current;

      const cursorX = clientX - rect.left;
      const cursorY = clientY - rect.top;

      const prevScale = s.scale;
      const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prevScale * (1 - delta * ZOOM_SENSITIVITY)));

      s.panX = cursorX - (cursorX - s.panX) * (newScale / prevScale);
      s.panY = cursorY - (cursorY - s.panY) * (newScale / prevScale);
      s.scale = newScale;

      applyTransform();
    },
    [stageRef, applyTransform],
  );

  // ─── Programmatic zoom (for buttons) ──────────────────────────────────────
  const zoomBy = useCallback(
    (factor: number) => {
      const stage = stageRef.current;
      if (!stage) return;

      const container = stage.container();
      const rect = container.getBoundingClientRect();
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      const s = stateRef.current;

      const prevScale = s.scale;
      const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prevScale * factor));

      s.panX = cx - (cx - s.panX) * (newScale / prevScale);
      s.panY = cy - (cy - s.panY) * (newScale / prevScale);
      s.scale = newScale;

      applyTransform();
    },
    [stageRef, applyTransform],
  );

  // ─── Reset viewport ───────────────────────────────────────────────────────
  const resetViewport = useCallback(() => {
    stateRef.current = { ...DEFAULT_STATE };
    applyTransform();
  }, [applyTransform]);

  // ─── Pan to specific position (for minimap click-to-navigate) ─────────────
  const panTo = useCallback(
    (panX: number, panY: number) => {
      stateRef.current.panX = panX;
      stateRef.current.panY = panY;
      applyTransform();
    },
    [applyTransform],
  );

  // ─── Event handlers (attached to Konva Stage container) ───────────────────
  useEffect(() => {
    if (!enabled) return;

    const stage = stageRef.current;
    if (!stage) return;

    const container = stage.container();

    // Wheel → zoom or pan
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();

      if (e.ctrlKey || e.metaKey) {
        zoomAt(e.clientX, e.clientY, e.deltaY);
      } else {
        const s = stateRef.current;
        s.panX -= e.deltaX;
        s.panY -= e.deltaY;
        applyTransform();
      }
    };

    // Middle-click or Space+click → start pan
    const onPointerDown = (e: PointerEvent) => {
      if (e.button === 1 || spaceDownRef.current) {
        e.preventDefault();
        isPanningRef.current = true;
        container.setPointerCapture(e.pointerId);
        container.style.cursor = 'grabbing';
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!isPanningRef.current) return;
      const s = stateRef.current;
      s.panX += e.movementX;
      s.panY += e.movementY;
      applyTransform();
    };

    const onPointerUp = (e: PointerEvent) => {
      if (isPanningRef.current) {
        isPanningRef.current = false;
        container.releasePointerCapture(e.pointerId);
        container.style.cursor = spaceDownRef.current ? 'grab' : '';
      }
    };

    // Space key for pan mode
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        spaceDownRef.current = true;
        container.style.cursor = 'grab';
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceDownRef.current = false;
        if (!isPanningRef.current) {
          container.style.cursor = '';
        }
      }
    };

    container.addEventListener('wheel', onWheel, { passive: false });
    container.addEventListener('pointerdown', onPointerDown);
    container.addEventListener('pointermove', onPointerMove);
    container.addEventListener('pointerup', onPointerUp);
    container.addEventListener('pointercancel', onPointerUp);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);

    return () => {
      container.removeEventListener('wheel', onWheel);
      container.removeEventListener('pointerdown', onPointerDown);
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointerup', onPointerUp);
      container.removeEventListener('pointercancel', onPointerUp);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      // Reset transient state to avoid stale flags on re-mount
      isPanningRef.current = false;
      spaceDownRef.current = false;
    };
  }, [stageRef, applyTransform, zoomAt, enabled]);

  return { stateRef, resetViewport, zoomBy, panTo };
}
