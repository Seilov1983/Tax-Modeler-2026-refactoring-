'use client';

/**
 * useCanvasViewport — Pan & Zoom via direct DOM manipulation.
 *
 * Architecture:
 * - All viewport state (panX, panY, scale) lives in useRef — NOT in React state.
 * - Wheel/pinch/drag events mutate the #canvas-board transform directly.
 * - Zero React re-renders during scroll or zoom — pure 60 FPS DOM updates.
 * - The ref-based state is exposed for CanvasNode to read the current scale
 *   (needed to compensate drag movementX/Y by 1/scale).
 * - An optional onViewportChange callback is throttled via rAF to sync a
 *   Jotai atom for low-frequency UI (zoom controls, minimap).
 *
 * Controls:
 * - Mouse wheel: zoom in/out (centered on cursor)
 * - Middle-click drag OR Space+drag: pan the canvas
 * - Pinch gesture (trackpad): zoom
 * - Double-click: reset to default view
 */

import { useRef, useCallback, useEffect, type RefObject } from 'react';

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
  viewportRef: RefObject<HTMLDivElement | null>,
  boardRef: RefObject<HTMLDivElement | null>,
  onViewportChange?: (state: ViewportState) => void,
) {
  // All viewport state in a ref — mutations here never trigger React re-renders
  const stateRef = useRef<ViewportState>({ ...DEFAULT_STATE });
  const isPanningRef = useRef(false);
  const spaceDownRef = useRef(false);
  const indicatorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafIdRef = useRef(0);

  // ─── Throttled sync to Jotai atom via rAF ─────────────────────────────────
  const notifyChange = useCallback(() => {
    if (!onViewportChange) return;
    if (rafIdRef.current) return; // already scheduled
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = 0;
      onViewportChange({ ...stateRef.current });
    });
  }, [onViewportChange]);

  // ─── Apply transform directly to DOM ──────────────────────────────────────
  const applyTransform = useCallback(() => {
    const board = boardRef.current;
    if (!board) return;
    const { panX, panY, scale } = stateRef.current;
    board.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
    notifyChange();
  }, [boardRef, notifyChange]);

  // ─── Show zoom indicator (transient DOM element) ──────────────────────────
  const showZoomIndicator = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    let indicator = viewport.querySelector('.zoom-indicator') as HTMLDivElement | null;
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.className = 'zoom-indicator';
      viewport.appendChild(indicator);
    }

    const percent = Math.round(stateRef.current.scale * 100);
    indicator.textContent = `${percent}%`;
    indicator.style.opacity = '1';

    if (indicatorTimerRef.current) clearTimeout(indicatorTimerRef.current);
    indicatorTimerRef.current = setTimeout(() => {
      if (indicator) indicator.style.opacity = '0';
    }, 1200);
  }, [viewportRef]);

  // ─── Zoom centered on a point ─────────────────────────────────────────────
  const zoomAt = useCallback(
    (clientX: number, clientY: number, delta: number) => {
      const viewport = viewportRef.current;
      if (!viewport) return;

      const rect = viewport.getBoundingClientRect();
      const s = stateRef.current;

      // Cursor position relative to the viewport
      const cursorX = clientX - rect.left;
      const cursorY = clientY - rect.top;

      // Old scale → new scale
      const prevScale = s.scale;
      const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prevScale * (1 - delta * ZOOM_SENSITIVITY)));

      // Adjust pan so the point under the cursor stays fixed
      s.panX = cursorX - (cursorX - s.panX) * (newScale / prevScale);
      s.panY = cursorY - (cursorY - s.panY) * (newScale / prevScale);
      s.scale = newScale;

      applyTransform();
      showZoomIndicator();
    },
    [viewportRef, applyTransform, showZoomIndicator],
  );

  // ─── Programmatic zoom (for buttons) ──────────────────────────────────────
  const zoomBy = useCallback(
    (factor: number) => {
      const viewport = viewportRef.current;
      if (!viewport) return;

      const rect = viewport.getBoundingClientRect();
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      const s = stateRef.current;

      const prevScale = s.scale;
      const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prevScale * factor));

      s.panX = cx - (cx - s.panX) * (newScale / prevScale);
      s.panY = cy - (cy - s.panY) * (newScale / prevScale);
      s.scale = newScale;

      applyTransform();
      showZoomIndicator();
    },
    [viewportRef, applyTransform, showZoomIndicator],
  );

  // ─── Reset viewport ───────────────────────────────────────────────────────
  const resetViewport = useCallback(() => {
    stateRef.current = { ...DEFAULT_STATE };
    applyTransform();
    showZoomIndicator();
  }, [applyTransform, showZoomIndicator]);

  // ─── Pan to specific position (for minimap click-to-navigate) ─────────────
  const panTo = useCallback(
    (panX: number, panY: number) => {
      stateRef.current.panX = panX;
      stateRef.current.panY = panY;
      applyTransform();
    },
    [applyTransform],
  );

  // ─── Event handlers (attached to DOM, not React) ──────────────────────────
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    // Wheel → zoom
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest('.no-canvas-events')) return;
      e.preventDefault();

      // Pinch gesture on trackpad sends ctrlKey with wheel
      if (e.ctrlKey || e.metaKey) {
        zoomAt(e.clientX, e.clientY, e.deltaY);
      } else {
        // Regular scroll → pan
        const s = stateRef.current;
        s.panX -= e.deltaX;
        s.panY -= e.deltaY;
        applyTransform();
      }
    };

    // Middle-click or Space+click → start pan
    const onPointerDown = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest('.no-canvas-events')) return;
      // Middle button (1) or space held down
      if (e.button === 1 || spaceDownRef.current) {
        e.preventDefault();
        isPanningRef.current = true;
        viewport.setPointerCapture(e.pointerId);
        viewport.style.cursor = 'grabbing';
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
        viewport.releasePointerCapture(e.pointerId);
        viewport.style.cursor = spaceDownRef.current ? 'grab' : '';
      }
    };

    // Native dblclick guard — exits early to skip any viewport reset logic
    // when the user double-clicks on an interactive element or the canvas
    // background. Does NOT call stopPropagation/preventDefault so the event
    // still bubbles up to React's synthetic onDoubleClick (context menu).
    const onDblClick = (e: MouseEvent) => {
      console.log('[DEBUG] Native DblClick Fired. Target:', e.target);
      if (
        (e.target as HTMLElement).closest('[data-zone-id]') ||
        (e.target as HTMLElement).closest('.canvas-node') ||
        (e.target as HTMLElement).closest('button') ||
        e.target === viewport
      ) {
        // Early return — skip any viewport reset but let the event bubble
        // naturally to React's synthetic tree (CanvasBoard onDoubleClick).
        return;
      }
    };

    // Space key for pan mode
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        spaceDownRef.current = true;
        viewport.style.cursor = 'grab';
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceDownRef.current = false;
        if (!isPanningRef.current) {
          viewport.style.cursor = '';
        }
      }
    };

    // Attach with { passive: false } for wheel to allow preventDefault
    viewport.addEventListener('wheel', onWheel, { passive: false });
    viewport.addEventListener('dblclick', onDblClick);
    viewport.addEventListener('pointerdown', onPointerDown);
    viewport.addEventListener('pointermove', onPointerMove);
    viewport.addEventListener('pointerup', onPointerUp);
    viewport.addEventListener('pointercancel', onPointerUp);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);

    return () => {
      viewport.removeEventListener('wheel', onWheel);
      viewport.removeEventListener('dblclick', onDblClick);
      viewport.removeEventListener('pointerdown', onPointerDown);
      viewport.removeEventListener('pointermove', onPointerMove);
      viewport.removeEventListener('pointerup', onPointerUp);
      viewport.removeEventListener('pointercancel', onPointerUp);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
    };
  }, [viewportRef, applyTransform, zoomAt, resetViewport]);

  return { stateRef, resetViewport, zoomBy, panTo };
}
