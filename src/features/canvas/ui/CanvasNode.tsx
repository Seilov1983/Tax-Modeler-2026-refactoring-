'use client';

/**
 * CanvasNode — Transient/Committed State Pattern for 60 FPS drag.
 *
 * Architecture:
 * - During drag: DOM is mutated directly via style.transform (no React re-render)
 * - On drop: final position is committed to Jotai atom → triggers tax recalculation
 *
 * This bypasses React's reconciliation during pointermove, ensuring smooth drag
 * even when the tax engine is computing in the background via useTransition.
 */

import { useAtom } from 'jotai';
import { useRef, useCallback, memo } from 'react';
import type { PrimitiveAtom } from 'jotai';
import type { NodeDTO } from '@shared/types';

interface CanvasNodeProps {
  nodeAtom: PrimitiveAtom<NodeDTO>;
}

export const CanvasNode = memo(function CanvasNode({ nodeAtom }: CanvasNodeProps) {
  const [node, setNode] = useAtom(nodeAtom);
  const domRef = useRef<HTMLDivElement>(null);
  // Track the live position during drag without triggering re-renders
  const livePos = useRef({ x: node.x, y: node.y });

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const target = e.currentTarget;
      target.setPointerCapture(e.pointerId);

      // Snapshot starting position
      livePos.current = { x: node.x, y: node.y };

      const onPointerMove = (moveEvent: PointerEvent) => {
        // DIRECT DOM MUTATION — bypasses React render cycle
        livePos.current.x += moveEvent.movementX;
        livePos.current.y += moveEvent.movementY;
        if (domRef.current) {
          domRef.current.style.transform = `translate(${livePos.current.x}px, ${livePos.current.y}px) translateZ(0)`;
        }
      };

      const onPointerUp = (upEvent: PointerEvent) => {
        target.removeEventListener('pointermove', onPointerMove);
        target.removeEventListener('pointerup', onPointerUp);
        target.releasePointerCapture(upEvent.pointerId);

        // COMMIT to Jotai — triggers React re-render + background tax recalculation
        const finalX = livePos.current.x;
        const finalY = livePos.current.y;
        setNode((prev) => ({ ...prev, x: finalX, y: finalY }));
      };

      target.addEventListener('pointermove', onPointerMove);
      target.addEventListener('pointerup', onPointerUp);
    },
    [node.x, node.y, setNode],
  );

  const riskCount = node.riskFlags?.length || 0;
  const isCompany = node.type === 'company';
  const isPerson = node.type === 'person';
  const isTxa = node.type === 'txa';

  return (
    <div
      ref={domRef}
      onPointerDown={isTxa ? undefined : handlePointerDown}
      data-node-id={node.id}
      style={{
        position: 'absolute',
        transform: `translate(${node.x}px, ${node.y}px) translateZ(0)`,
        width: node.w,
        height: node.h,
        willChange: 'transform',
        cursor: isTxa ? 'default' : 'grab',
        touchAction: 'none',
        userSelect: 'none',
      }}
      className={[
        'canvas-node',
        isCompany ? 'node-company' : '',
        isPerson ? 'node-person' : '',
        isTxa ? 'node-txa' : '',
        node.frozen ? 'node-frozen' : '',
        riskCount > 0 ? 'node-has-risks' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="node-header">
        <span className="node-type-badge">
          {isCompany ? 'CO' : isPerson ? 'P' : 'TXA'}
        </span>
        <span className="node-name" title={node.name}>
          {node.name}
        </span>
      </div>

      <div className="node-badges">
        {node.frozen && <span className="badge badge-frozen">FROZEN</span>}
        {riskCount > 0 && (
          <span className="badge badge-risk">{riskCount} risk{riskCount > 1 ? 's' : ''}</span>
        )}
        {node.riskFlags?.some((r) => r.type === 'CFC_RISK') && (
          <span className="badge badge-cfc">CFC</span>
        )}
      </div>
    </div>
  );
});
