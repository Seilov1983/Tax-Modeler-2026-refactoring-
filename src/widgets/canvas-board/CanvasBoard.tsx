'use client';

/**
 * CanvasBoard Widget — renders all zones, nodes, and flow arrows.
 *
 * Integrates:
 * - Jotai splitAtom for per-node rendering isolation
 * - Transient drag state pattern (via CanvasNode)
 * - useTransition tax recalculation on node drop
 */

import { useAtomValue } from 'jotai';
import { useEffect } from 'react';
import { nodeAtomsAtom, nodesAtom } from '@entities/node';
import { zonesAtom } from '@entities/zone';
import { CanvasNode } from '@features/canvas';
import { useTaxRecalculation } from '@features/tax-calculator';

export function CanvasBoard() {
  const zones = useAtomValue(zonesAtom);
  const nodeAtoms = useAtomValue(nodeAtomsAtom);
  const nodes = useAtomValue(nodesAtom);
  const { recalculate, isPending } = useTaxRecalculation();

  // Recalculate when nodes change (e.g. after drop)
  useEffect(() => {
    if (nodes.length > 0) {
      recalculate('canvas_update');
    }
  }, [nodes, recalculate]);

  return (
    <div id="viewport" style={{ position: 'relative', overflow: 'hidden', width: '100%', height: '100%' }}>
      {isPending && (
        <div className="recalculating-indicator">
          Recalculating taxes...
        </div>
      )}

      <div id="canvas-board" style={{ position: 'absolute', transformOrigin: '0 0' }}>
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
            <CanvasNode key={`${nodeAtom}`} nodeAtom={nodeAtom} />
          ))}
        </div>

        {/* Arrows Layer (SVG) */}
        <svg id="arrows-layer" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />
      </div>
    </div>
  );
}
