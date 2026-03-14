'use client';

/**
 * CanvasNode — Transient/Committed State Pattern for 60 FPS drag.
 *
 * Architecture:
 * - During drag: DOM is mutated directly via style.transform (no React re-render)
 * - On drop: final position is committed to Jotai atom → triggers tax recalculation
 * - Drag movement is divided by viewport scale so nodes follow the cursor
 *   accurately at any zoom level.
 *
 * This bypasses React's reconciliation during pointermove, ensuring smooth drag
 * even when the tax engine is computing in the background via useTransition.
 */

import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useRef, useCallback, memo, Suspense, type RefObject } from 'react';
import type { PrimitiveAtom } from 'jotai';
import type { NodeDTO } from '@shared/types';
import type { ViewportState } from './useCanvasViewport';
import { nodeTaxAtomFamily, taxCalculationAtom } from '@features/tax-calculator/model/atoms';
import { nodeRiskAtomFamily } from '@features/risk-analyzer/model/atoms';
import { selectionAtom } from '@features/entity-editor/model/atoms';
import { draftConnectionAtom } from '../model/draft-connection-atom';
import { addFlowAtom, addOwnershipAtom } from '../model/graph-actions-atom';
import { fmtMoney, currencySymbol } from '@shared/lib/engine/utils';

// ─── Micro-component: isolates Suspense per node for CIT display ────────────

function NodeTaxDisplay({ nodeId }: { nodeId: string }) {
  const citAmount = useAtomValue(nodeTaxAtomFamily(nodeId));
  const taxResults = useAtomValue(taxCalculationAtom);
  const ccy = taxResults?.baseCurrency || 'USD';

  if (citAmount === null || citAmount === 0) return null;

  return (
    <div className="badge badge-tax">
      CIT: {currencySymbol(ccy)} {fmtMoney(citAmount)}
    </div>
  );
}

// ─── Micro-component: isolates Suspense per node for risk display ───────────

function NodeRiskDisplay({ nodeId }: { nodeId: string }) {
  const risks = useAtomValue(nodeRiskAtomFamily(nodeId));

  if (!risks || risks.length === 0) return null;

  const tooltip = risks.map((r) => `${r.type}${r.lawRef ? ` (${r.lawRef})` : ''}`).join('\n');

  return (
    <span
      className="badge badge-risk-engine"
      title={tooltip}
      style={{
        background: '#eab308',
        color: '#fff',
        fontSize: '10px',
        fontWeight: 'bold',
        padding: '1px 5px',
        borderRadius: '9px',
        border: '1px solid #ca8a04',
        cursor: 'help',
      }}
    >
      ! {risks.length}
    </span>
  );
}

interface CanvasNodeProps {
  nodeAtom: PrimitiveAtom<NodeDTO>;
  /** Ref to the current viewport state (scale, panX, panY) — read-only, never causes re-render */
  viewportStateRef: RefObject<ViewportState>;
}

export const CanvasNode = memo(function CanvasNode({ nodeAtom, viewportStateRef }: CanvasNodeProps) {
  const [node, setNode] = useAtom(nodeAtom);
  const setSelection = useSetAtom(selectionAtom);
  const [draft, setDraft] = useAtom(draftConnectionAtom);
  const addFlow = useSetAtom(addFlowAtom);
  const addOwnership = useSetAtom(addOwnershipAtom);
  const domRef = useRef<HTMLDivElement>(null);
  // Track the live position during drag without triggering re-renders
  const livePos = useRef({ x: node.x, y: node.y });
  // Distinguish click from drag
  const hasDragged = useRef(false);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const target = e.currentTarget;
      target.setPointerCapture(e.pointerId);
      hasDragged.current = false;

      // Snapshot starting position
      livePos.current = { x: node.x, y: node.y };

      const onPointerMove = (moveEvent: PointerEvent) => {
        hasDragged.current = true;
        // Compensate for zoom: divide pixel movement by current scale
        const scale = viewportStateRef.current?.scale ?? 1;
        // DIRECT DOM MUTATION — bypasses React render cycle
        livePos.current.x += moveEvent.movementX / scale;
        livePos.current.y += moveEvent.movementY / scale;
        if (domRef.current) {
          domRef.current.style.transform = `translate(${livePos.current.x}px, ${livePos.current.y}px) translateZ(0)`;
        }
      };

      const onPointerUp = (upEvent: PointerEvent) => {
        target.removeEventListener('pointermove', onPointerMove);
        target.removeEventListener('pointerup', onPointerUp);
        target.releasePointerCapture(upEvent.pointerId);

        if (hasDragged.current) {
          // COMMIT to Jotai — triggers React re-render + background tax recalculation
          const finalX = Math.round(livePos.current.x);
          const finalY = Math.round(livePos.current.y);
          setNode((prev) => ({ ...prev, x: finalX, y: finalY }));
        }
      };

      target.addEventListener('pointermove', onPointerMove);
      target.addEventListener('pointerup', onPointerUp);
    },
    [node.x, node.y, setNode, viewportStateRef],
  );

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (hasDragged.current) return; // was a drag, not a click
      e.stopPropagation();
      setSelection({ type: 'node', id: node.id });
    },
    [node.id, setSelection],
  );

  // ─── Flow port (right edge, blue): start drawing a flow ─────────────────
  const handleFlowPortDown = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      setDraft({ sourceNodeId: node.id, connectionType: 'flow' });
    },
    [node.id, setDraft],
  );

  // ─── Ownership port (bottom edge, purple): start drawing ownership ─────
  const handleOwnershipPortDown = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      setDraft({ sourceNodeId: node.id, connectionType: 'ownership' });
    },
    [node.id, setDraft],
  );

  // ─── Drop target: complete the connection based on type ────────────────
  const handleNodePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (draft && draft.sourceNodeId !== node.id) {
        e.stopPropagation();
        if (draft.connectionType === 'flow') {
          addFlow({ fromId: draft.sourceNodeId, toId: node.id });
        } else {
          addOwnership({ parentId: draft.sourceNodeId, subsidiaryId: node.id });
        }
        setDraft(null);
      }
    },
    [draft, node.id, addFlow, addOwnership, setDraft],
  );

  const riskCount = node.riskFlags?.length || 0;
  const isCompany = node.type === 'company';
  const isPerson = node.type === 'person';
  const isTxa = node.type === 'txa';

  return (
    <div
      ref={domRef}
      onPointerDown={isTxa ? undefined : handlePointerDown}
      onPointerUp={handleNodePointerUp}
      onClick={handleClick}
      data-node-id={node.id}
      data-testid="canvas-node"
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
        {isCompany && (
          <Suspense fallback={<span className="badge badge-tax-loading">calc...</span>}>
            <NodeTaxDisplay nodeId={node.id} />
          </Suspense>
        )}
        <Suspense fallback={null}>
          <NodeRiskDisplay nodeId={node.id} />
        </Suspense>
      </div>

      {/* Flow port (right edge, blue) — drag to create cash flow */}
      {!isTxa && (
        <div
          onPointerDown={handleFlowPortDown}
          data-testid="port-flow"
          title="Drag to create flow"
          style={{
            position: 'absolute',
            right: -6,
            top: '50%',
            transform: 'translateY(-50%)',
            width: 12,
            height: 12,
            background: '#3b82f6',
            borderRadius: '50%',
            border: '2px solid #fff',
            cursor: 'crosshair',
            zIndex: 5,
            transition: 'transform 0.15s',
          }}
        />
      )}

      {/* Ownership port (bottom edge, purple) — drag to create ownership link */}
      {!isTxa && (
        <div
          onPointerDown={handleOwnershipPortDown}
          data-testid="port-ownership"
          title="Drag down to create ownership"
          style={{
            position: 'absolute',
            bottom: -6,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 12,
            height: 12,
            background: '#a855f7',
            borderRadius: '50%',
            border: '2px solid #fff',
            cursor: 'crosshair',
            zIndex: 5,
            transition: 'transform 0.15s',
          }}
        />
      )}
    </div>
  );
});
