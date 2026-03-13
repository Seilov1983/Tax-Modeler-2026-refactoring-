'use client';

/**
 * CanvasBoard Widget — renders all zones, nodes, and flow arrows.
 *
 * Integrates:
 * - Jotai splitAtom for per-node rendering isolation
 * - Transient drag state pattern (via CanvasNode)
 * - Async taxCalculationAtom for reactive tax recalculation via Suspense
 * - useCanvasViewport for 60 FPS pan & zoom via direct DOM manipulation
 */

import { useAtomValue } from 'jotai';
import { Suspense, useRef } from 'react';
import { nodeAtomsAtom } from '@entities/node';
import { zonesAtom } from '@entities/zone';
import { CanvasNode, useCanvasViewport } from '@features/canvas';
import { useTaxRecalculation } from '@features/tax-calculator';

function CanvasBoardInner() {
  const zones = useAtomValue(zonesAtom);
  const nodeAtoms = useAtomValue(nodeAtomsAtom);
  const taxResults = useTaxRecalculation();

  // ─── Viewport refs (pan & zoom via direct DOM mutation, zero re-renders) ──
  const viewportRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const { stateRef: viewportStateRef } = useCanvasViewport(viewportRef, boardRef);

  return (
    <div
      ref={viewportRef}
      id="viewport"
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

        {/* Arrows Layer (SVG) */}
        <svg id="arrows-layer" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />
      </div>
    </div>
  );
}

export function CanvasBoard() {
  return (
    <Suspense fallback={<div className="recalculating-indicator">Recalculating taxes...</div>}>
      <CanvasBoardInner />
    </Suspense>
  );
}
