'use client';

/**
 * CanvasBoard Widget — renders all zones, nodes, flow arrows, and ownership lines.
 *
 * Integrates:
 * - Jotai splitAtom for per-node rendering isolation
 * - Transient drag state pattern (via CanvasNode)
 * - Local Suspense per node/flow for async tax badge rendering
 * - useCanvasViewport for 60 FPS pan & zoom via direct DOM manipulation
 * - Draft connection line for interactive flow/ownership creation
 */

import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useRef, useCallback, useEffect } from 'react';
import { nodeAtomsAtom, nodesAtom } from '@entities/node';
import { flowsAtom } from '@entities/flow';
import { zonesAtom } from '@entities/zone';
import { ownershipAtom } from '@entities/ownership';
import { CanvasNode, CanvasFlow, useCanvasViewport } from '@features/canvas';
import { CanvasOwnership } from '@features/canvas/ui/CanvasOwnership';
import { AuditLogPanel } from '@features/audit-log/ui/AuditLogPanel';
import { selectionAtom } from '@features/entity-editor/model/atoms';
import { EditorSidebar } from '@features/entity-editor/ui/EditorSidebar';
import { draftConnectionAtom } from '@features/canvas/model/draft-connection-atom';
import { buildBezierPath } from '@features/canvas/ui/CanvasFlow';
import { buildVerticalBezierPath } from '@features/canvas/ui/CanvasOwnership';
import { CanvasToolbar } from '@features/canvas/ui/CanvasToolbar';
import { ProjectHeader } from '@features/project-management';

export function CanvasBoard() {
  const zones = useAtomValue(zonesAtom);
  const nodeAtoms = useAtomValue(nodeAtomsAtom);
  const nodes = useAtomValue(nodesAtom);
  const flows = useAtomValue(flowsAtom);
  const ownership = useAtomValue(ownershipAtom);

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
