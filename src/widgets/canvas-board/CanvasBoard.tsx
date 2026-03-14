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
import { CanvasToolbar } from '@features/canvas/ui/CanvasToolbar';

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

  // ─── Draft connection line ref (transient DOM mutation for 60 FPS) ────────
  const draftLineRef = useRef<SVGLineElement>(null);

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

  // Track pointer movement and update the draft line via direct DOM mutation
  useEffect(() => {
    if (!draft) return;

    const onPointerMove = (e: PointerEvent) => {
      if (!draftLineRef.current) return;
      const canvas = clientToCanvas(e.clientX, e.clientY);
      draftLineRef.current.setAttribute('x2', String(canvas.x));
      draftLineRef.current.setAttribute('y2', String(canvas.y));
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
  }, [draft, clientToCanvas, setDraft]);

  // Compute source node center for the draft line start point
  const sourceNode = draft ? nodes.find((n) => n.id === draft.sourceNodeId) : null;
  const srcX = sourceNode ? sourceNode.x + sourceNode.w / 2 : 0;
  const srcY = sourceNode ? sourceNode.y + sourceNode.h / 2 : 0;

  return (
    <div
      ref={viewportRef}
      id="viewport"
      onClick={handleBackgroundClick}
      style={{ position: 'relative', overflow: 'hidden', width: '100%', height: '100%' }}
    >
      <div
        ref={boardRef}
        id="canvas-board"
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

          {/* Draft connection line — transient, mutated via ref */}
          {draft && sourceNode && (
            <line
              ref={draftLineRef}
              x1={srcX}
              y1={srcY}
              x2={srcX}
              y2={srcY}
              stroke="#3b82f6"
              strokeWidth={2}
              strokeDasharray="6 3"
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
  );
}
