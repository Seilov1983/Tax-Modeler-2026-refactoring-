'use client';

/**
 * CanvasBoard Widget — renders all zones, nodes, and flow arrows.
 *
 * Integrates:
 * - Jotai splitAtom for per-node rendering isolation
 * - Transient drag state pattern (via CanvasNode)
 * - Local Suspense per node/flow for async tax badge rendering
 * - useCanvasViewport for 60 FPS pan & zoom via direct DOM manipulation
 */

import { useAtomValue, useSetAtom } from 'jotai';
import { useRef, useCallback } from 'react';
import { nodeAtomsAtom, nodesAtom } from '@entities/node';
import { flowsAtom } from '@entities/flow';
import { zonesAtom } from '@entities/zone';
import { CanvasNode, CanvasFlow, useCanvasViewport } from '@features/canvas';
import { AuditLogPanel } from '@features/audit-log/ui/AuditLogPanel';
import { selectionAtom } from '@features/entity-editor/model/atoms';
import { EditorSidebar } from '@features/entity-editor/ui/EditorSidebar';

export function CanvasBoard() {
  const zones = useAtomValue(zonesAtom);
  const nodeAtoms = useAtomValue(nodeAtomsAtom);
  const nodes = useAtomValue(nodesAtom);
  const flows = useAtomValue(flowsAtom);

  const setSelection = useSetAtom(selectionAtom);

  // ─── Viewport refs (pan & zoom via direct DOM mutation, zero re-renders) ──
  const viewportRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const { stateRef: viewportStateRef } = useCanvasViewport(viewportRef, boardRef);

  // Deselect when clicking empty canvas area
  const handleBackgroundClick = useCallback(() => {
    setSelection(null);
  }, [setSelection]);

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
        </svg>
      </div>

      {/* Audit Log Panel — outside zoom/pan area, fixed to bottom of viewport */}
      <AuditLogPanel />

      {/* Property Panel — right sidebar for editing selected entity */}
      <EditorSidebar />
    </div>
  );
}
