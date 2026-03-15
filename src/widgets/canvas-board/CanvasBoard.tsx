'use client';

/**
 * CanvasBoard Widget — renders all zones, nodes, flow arrows, ownership lines,
 * minimap, and zoom controls.
 *
 * Integrates:
 * - Jotai splitAtom for per-node rendering isolation
 * - Transient drag state pattern (via CanvasNode)
 * - Local Suspense per node/flow for async tax badge rendering
 * - useCanvasViewport for 60 FPS pan & zoom via direct DOM manipulation
 * - Draft connection line for interactive flow/ownership creation
 * - viewportAtom sync (rAF-throttled) for minimap + zoom controls
 */

import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useRef, useState, useCallback, useEffect } from 'react';
import { nodeAtomsAtom, nodesAtom } from '@entities/node';
import { flowsAtom } from '@entities/flow';
import { zonesAtom } from '@entities/zone';
import { ownershipAtom } from '@entities/ownership';
import { CanvasNode, CanvasFlow, useCanvasViewport } from '@features/canvas';
import { CanvasOwnership } from '@features/canvas/ui/CanvasOwnership';
import { CanvasZone } from '@features/canvas/ui/CanvasZone';
import { useKeyboardShortcuts } from '@features/canvas/ui/useKeyboardShortcuts';
import { CanvasControls } from '@features/canvas/ui/CanvasControls';
import { Minimap } from '@features/canvas/ui/Minimap';
import { AuditLogPanel } from '@features/audit-log/ui/AuditLogPanel';
import { selectionAtom } from '@features/entity-editor/model/atoms';
import { EditorSidebar } from '@features/entity-editor/ui/EditorSidebar';
import { draftConnectionAtom } from '@features/canvas/model/draft-connection-atom';
import { viewportAtom } from '@features/canvas/model/viewport-atom';
import { buildBezierPath } from '@features/canvas/ui/CanvasFlow';
import { buildVerticalBezierPath } from '@features/canvas/ui/CanvasOwnership';
import { CanvasToolbar } from '@features/canvas/ui/CanvasToolbar';
import { GlobalSummaryWidget } from '@features/analytics-dashboard/ui/GlobalSummaryWidget';
import { ProjectHeader } from '@features/project-management';

export function CanvasBoard() {
  const zones = useAtomValue(zonesAtom);
  const nodeAtoms = useAtomValue(nodeAtomsAtom);
  const nodes = useAtomValue(nodesAtom);
  const flows = useAtomValue(flowsAtom);
  const ownership = useAtomValue(ownershipAtom);

  const [currentSelection, setSelection] = useAtom(selectionAtom);
  const selectionRef = useRef(currentSelection);
  selectionRef.current = currentSelection;

  // Global keyboard shortcuts (Undo, Redo, Delete, Escape)
  useKeyboardShortcuts();
  const [draft, setDraft] = useAtom(draftConnectionAtom);
  const setViewport = useSetAtom(viewportAtom);

  // ─── Viewport refs (pan & zoom via direct DOM mutation, zero re-renders) ──
  const viewportRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  // Sync imperative ref → Jotai atom (rAF-throttled inside the hook)
  const { stateRef: viewportStateRef, zoomBy, panTo, resetViewport } = useCanvasViewport(
    viewportRef,
    boardRef,
    setViewport,
  );

  // ─── Zoom callbacks for CanvasControls ────────────────────────────────────
  const handleZoomIn = useCallback(() => zoomBy(1.25), [zoomBy]);
  const handleZoomOut = useCallback(() => zoomBy(0.8), [zoomBy]);

  // ─── Draft connection path ref (transient DOM mutation for 60 FPS) ────────
  const draftPathRef = useRef<SVGPathElement>(null);

  // ─── Lasso (rubber-band) multi-select ────────────────────────────────────
  const lassoStartRef = useRef<{ x: number; y: number } | null>(null);
  const [lassoRect, setLassoRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  // Deselect when clicking empty canvas area (only if no lasso drag happened)
  const lassoDraggedRef = useRef(false);
  const handleBackgroundClick = useCallback(() => {
    if (lassoDraggedRef.current) return; // lasso drag, don't deselect
    setSelection(null);
  }, [setSelection]);

  // Convert client coordinates to canvas-space coordinates
  const clientToCanvas = useCallback(
    (clientX: number, clientY: number) => {
      const vp = viewportRef.current;
      const state = viewportStateRef.current;
      if (!vp || !state) return { x: clientX, y: clientY };
      const rect = vp.getBoundingClientRect();
      return {
        x: (clientX - rect.left - state.panX) / state.scale,
        y: (clientY - rect.top - state.panY) / state.scale,
      };
    },
    [viewportRef, viewportStateRef],
  );

  // ─── Lasso pointer handlers ────────────────────────────────────────────
  const handleBoardPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Only start lasso on left button on the background (not on nodes/ports)
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      // Don't start lasso if clicking on a node, port, flow, or control
      if (target.closest('.canvas-node') || target.closest('[data-testid]') || target.closest('button')) return;

      const coords = clientToCanvas(e.clientX, e.clientY);
      lassoStartRef.current = coords;
      lassoDraggedRef.current = false;
      setLassoRect({ x: coords.x, y: coords.y, w: 0, h: 0 });

      if (!e.shiftKey) {
        setSelection(null);
      }
    },
    [clientToCanvas, setSelection],
  );

  const handleBoardPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!lassoStartRef.current) return;

      const current = clientToCanvas(e.clientX, e.clientY);
      const start = lassoStartRef.current;

      const x = Math.min(start.x, current.x);
      const y = Math.min(start.y, current.y);
      const w = Math.abs(current.x - start.x);
      const h = Math.abs(current.y - start.y);

      // Only mark as dragged if the rect is big enough (avoids accidental lasso on click)
      if (w > 5 || h > 5) {
        lassoDraggedRef.current = true;
      }

      setLassoRect({ x, y, w, h });
    },
    [clientToCanvas],
  );

  const handleBoardPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!lassoStartRef.current) return;

      const rect = lassoRect;
      lassoStartRef.current = null;
      setLassoRect(null);

      if (!rect || (rect.w < 5 && rect.h < 5)) return;

      // AABB collision: find all nodes intersecting the lasso rect
      const hitIds = nodes
        .filter((n) => {
          return (
            n.x < rect.x + rect.w &&
            n.x + n.w > rect.x &&
            n.y < rect.y + rect.h &&
            n.y + n.h > rect.y
          );
        })
        .map((n) => n.id);

      if (hitIds.length === 0) return;

      if (e.shiftKey) {
        // Merge with existing node selection
        const sel = selectionRef.current;
        const existing = sel?.type === 'node' ? sel.ids : [];
        const merged = [...new Set([...existing, ...hitIds])];
        setSelection({ type: 'node', ids: merged });
      } else {
        setSelection({ type: 'node', ids: hitIds });
      }
    },
    [lassoRect, nodes, setSelection],
  );

  // Compute source node port for the draft path start (depends on connection type)
  const sourceNode = draft ? nodes.find((n) => n.id === draft.sourceNodeId) : null;
  const isFlowDraft = draft?.connectionType === 'flow';
  // Flow: right-edge center; Ownership: bottom-center
  const srcX = sourceNode
    ? isFlowDraft
      ? sourceNode.x + sourceNode.w
      : sourceNode.x + sourceNode.w / 2
    : 0;
  const srcY = sourceNode
    ? isFlowDraft
      ? sourceNode.y + sourceNode.h / 2
      : sourceNode.y + sourceNode.h
    : 0;

  // Track pointer movement and update the draft Bezier path via direct DOM mutation
  useEffect(() => {
    if (!draft || !sourceNode) return;

    const isFlow = draft.connectionType === 'flow';
    const sx = isFlow ? sourceNode.x + sourceNode.w : sourceNode.x + sourceNode.w / 2;
    const sy = isFlow ? sourceNode.y + sourceNode.h / 2 : sourceNode.y + sourceNode.h;
    const pathBuilder = isFlow ? buildBezierPath : buildVerticalBezierPath;

    const onPointerMove = (e: PointerEvent) => {
      if (!draftPathRef.current) return;
      const canvas = clientToCanvas(e.clientX, e.clientY);
      draftPathRef.current.setAttribute('d', pathBuilder(sx, sy, canvas.x, canvas.y));
    };

    const onPointerUp = () => {
      setDraft(null);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [draft, sourceNode, clientToCanvas, setDraft]);

  // Choose the correct path builder for the initial d attribute
  const initialPath = isFlowDraft
    ? buildBezierPath(srcX, srcY, srcX, srcY)
    : buildVerticalBezierPath(srcX, srcY, srcX, srcY);

  // Draft stroke color: blue for flow, purple for ownership
  const draftStroke = isFlowDraft ? '#3b82f6' : '#a855f7';

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {/* Project header — outside viewport, excluded from export */}
      <ProjectHeader />

      <div
        ref={viewportRef}
        id="viewport"
        onClick={handleBackgroundClick}
        onPointerDown={handleBoardPointerDown}
        onPointerMove={handleBoardPointerMove}
        onPointerUp={handleBoardPointerUp}
        style={{ position: 'absolute', top: '48px', left: 0, right: 0, bottom: 0, overflow: 'hidden' }}
      >
        <div
          ref={boardRef}
          id="canvas-render-area"
          style={{ position: 'absolute', transformOrigin: '0 0' }}
        >
          {/* Zones Layer (lowest z-index — behind nodes and edges) */}
          <div id="zones-layer">
            {zones.map((zone) => (
              <CanvasZone key={zone.id} zone={zone} viewportStateRef={viewportStateRef} />
            ))}
          </div>

          {/* Nodes Layer — each node has its own atom for isolated re-renders */}
          <div id="nodes-layer">
            {nodeAtoms.map((nodeAtom) => (
              <CanvasNode
                key={`${nodeAtom}`}
                nodeAtom={nodeAtom}
                viewportStateRef={viewportStateRef}
              />
            ))}
          </div>

          {/* Arrows Layer (SVG) — flows, ownership lines, draft connection */}
          <svg
            id="arrows-layer"
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
          >
            <defs>
              <marker
                id="arrowhead"
                markerWidth="8"
                markerHeight="6"
                refX="8"
                refY="3"
                orient="auto"
              >
                <polygon points="0 0, 8 3, 0 6" fill="var(--stroke, #94a3b8)" />
              </marker>
            </defs>

            {/* Flow arrows (horizontal Bezier, solid) */}
            {flows.map((flow) => (
              <CanvasFlow key={flow.id} flow={flow} nodes={nodes} />
            ))}

            {/* Ownership lines (vertical Bezier, dashed purple) */}
            {ownership.map((edge) => (
              <CanvasOwnership key={edge.id} edge={edge} nodes={nodes} />
            ))}

            {/* Draft connection path — transient Bezier, mutated via ref */}
            {draft && sourceNode && (
              <path
                ref={draftPathRef}
                d={initialPath}
                stroke={draftStroke}
                strokeWidth={2}
                strokeDasharray="6 3"
                fill="none"
                pointerEvents="none"
              />
            )}
          </svg>

          {/* Lasso selection rectangle — rendered in canvas-space */}
          {lassoRect && lassoRect.w > 2 && lassoRect.h > 2 && (
            <div
              style={{
                position: 'absolute',
                left: lassoRect.x,
                top: lassoRect.y,
                width: lassoRect.w,
                height: lassoRect.h,
                border: '1px solid #3b82f6',
                background: 'rgba(59, 130, 246, 0.1)',
                pointerEvents: 'none',
                zIndex: 50,
              }}
            />
          )}
        </div>

        {/* Toolbar — outside zoom/pan area, fixed to top-left */}
        <CanvasToolbar viewportRef={viewportRef} viewportStateRef={viewportStateRef} />

        {/* Executive Summary — top-right */}
        <GlobalSummaryWidget />

        {/* Zoom Controls — bottom-left */}
        <CanvasControls onZoomIn={handleZoomIn} onZoomOut={handleZoomOut} onReset={resetViewport} />

        {/* Minimap — bottom-right */}
        <Minimap onNavigate={panTo} viewportRef={viewportRef} />

        {/* Audit Log Panel — outside zoom/pan area, fixed to bottom of viewport */}
        <AuditLogPanel />

        {/* Property Panel — right sidebar for editing selected entity */}
        <EditorSidebar />
      </div>
    </div>
  );
}
