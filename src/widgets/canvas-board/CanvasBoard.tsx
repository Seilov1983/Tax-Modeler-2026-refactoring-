'use client';

/**
 * CanvasBoard Widget — renders all zones, nodes, and flow arrows.
 *
 * Integrates:
 * - Jotai splitAtom for per-node rendering isolation
 * - Transient drag state pattern (via CanvasNode)
 * - Local Suspense per node/flow for async tax badge rendering
 * - useCanvasViewport for 60 FPS pan & zoom via direct DOM manipulation
 * - Draft connection line for interactive flow creation
 */

import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useRef, useCallback, useEffect } from 'react';
import { nodeAtomsAtom, nodesAtom } from '@entities/node';
import { flowsAtom } from '@entities/flow';
import { zonesAtom } from '@entities/zone';
import { CanvasNode, CanvasFlow, useCanvasViewport } from '@features/canvas';
import { AuditLogPanel } from '@features/audit-log/ui/AuditLogPanel';
import { selectionAtom } from '@features/entity-editor/model/atoms';
import { EditorSidebar } from '@features/entity-editor/ui/EditorSidebar';
import { draftConnectionAtom } from '@features/canvas/model/draft-connection-atom';
import { buildBezierPath } from '@features/canvas/ui/CanvasFlow';
import { CanvasToolbar } from '@features/canvas/ui/CanvasToolbar';
import { ProjectHeader } from '@features/project-management';

export function CanvasBoard() {
  const zones = useAtomValue(zonesAtom);
  const nodeAtoms = useAtomValue(nodeAtomsAtom);
  const nodes = useAtomValue(nodesAtom);
  const flows = useAtomValue(flowsAtom);

  const setSelection = useSetAtom(selectionAtom);
  const [draft, setDraft] = useAtom(draftConnectionAtom);

  // ─── Viewport refs (pan & zoom via direct DOM mutation, zero re-renders) ──
  const viewportRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const { stateRef: viewportStateRef } = useCanvasViewport(viewportRef, boardRef);

  // ─── Draft connection path ref (transient DOM mutation for 60 FPS) ────────
  const draftPathRef = useRef<SVGPathElement>(null);

  // Deselect when clicking empty canvas area
  const handleBackgroundClick = useCallback(() => {
    setSelection(null);
  }, [setSelection]);

  // ─── Pointer handlers for rubber-band connection line ─────────────────────

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

  // Compute source node port (right-edge center) for the draft path start
  const sourceNode = draft ? nodes.find((n) => n.id === draft.sourceNodeId) : null;
  const srcX = sourceNode ? sourceNode.x + sourceNode.w : 0;
  const srcY = sourceNode ? sourceNode.y + sourceNode.h / 2 : 0;

  // Track pointer movement and update the draft Bezier path via direct DOM mutation
  useEffect(() => {
    if (!draft || !sourceNode) return;

    const sx = sourceNode.x + sourceNode.w;
    const sy = sourceNode.y + sourceNode.h / 2;

    const onPointerMove = (e: PointerEvent) => {
      if (!draftPathRef.current) return;
      const canvas = clientToCanvas(e.clientX, e.clientY);
      draftPathRef.current.setAttribute('d', buildBezierPath(sx, sy, canvas.x, canvas.y));
    };

    const onPointerUp = () => {
      // If released in empty space (not on a node), cancel
      setDraft(null);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [draft, sourceNode, clientToCanvas, setDraft]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {/* Project header — outside viewport, excluded from export */}
      <ProjectHeader />

      <div
        ref={viewportRef}
        id="viewport"
        onClick={handleBackgroundClick}
        style={{ position: 'absolute', top: '48px', left: 0, right: 0, bottom: 0, overflow: 'hidden' }}
      >
        <div
          ref={boardRef}
          id="canvas-render-area"
          style={{ position: 'absolute', transformOrigin: '0 0' }}
        >
        {/* Zones Layer */}
        <div id="zones-layer">
          {zones.map((zone) => (
            <div
              key={zone.id}
              className="zone"
              data-zone-id={zone.id}
              style={{
                position: 'absolute',
                left: zone.x,
                top: zone.y,
                width: zone.w,
                height: zone.h,
                zIndex: zone.zIndex,
              }}
            >
              <div className="zone-label">{zone.name}</div>
            </div>
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

        {/* Arrows Layer (SVG) — each flow has local Suspense for WHT badge */}
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
          {flows.map((flow) => (
            <CanvasFlow key={flow.id} flow={flow} nodes={nodes} />
          ))}

          {/* Draft connection path — transient Bezier, mutated via ref */}
          {draft && sourceNode && (
            <path
              ref={draftPathRef}
              d={buildBezierPath(srcX, srcY, srcX, srcY)}
              stroke="#3b82f6"
              strokeWidth={2}
              strokeDasharray="6 3"
              fill="none"
              pointerEvents="none"
            />
          )}
        </svg>
      </div>

        {/* Toolbar — outside zoom/pan area, fixed to top-left */}
        <CanvasToolbar viewportRef={viewportRef} viewportStateRef={viewportStateRef} />

        {/* Audit Log Panel — outside zoom/pan area, fixed to bottom of viewport */}
        <AuditLogPanel />

        {/* Property Panel — right sidebar for editing selected entity */}
        <EditorSidebar />
      </div>
    </div>
  );
}
