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
import { addFlowAtom, addOwnershipAtom, moveNodesAtom } from '../model/graph-actions-atom';
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
  const node = useAtomValue(nodeAtom);
  const selection = useAtomValue(selectionAtom);
  const setSelection = useSetAtom(selectionAtom);
  const [draft, setDraft] = useAtom(draftConnectionAtom);
  const addFlow = useSetAtom(addFlowAtom);
  const addOwnership = useSetAtom(addOwnershipAtom);
  const domRef = useRef<HTMLDivElement>(null);
  // Track the live position during drag without triggering re-renders
  const livePos = useRef({ x: node.x, y: node.y });
  // Distinguish click from drag
  const hasDragged = useRef(false);
  /** Re-render shield: while true, React must not overwrite transform from state */
  const isDraggingRef = useRef(false);
  // Ref to read selection without stale closures in event handlers
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  // Whether this node is part of a multi-selection
  const isSelected = selection?.type === 'node' && selection.ids.includes(node.id);

  const moveNodes = useSetAtom(moveNodesAtom);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Re-entrancy guard: prevent duplicate drag sessions from multi-touch
      // or rapid pointer events. Without this, multiple pointermove handlers
      // with different origins fight each other → oscillation/jitter.
      if (isDraggingRef.current) return;

      e.stopPropagation(); // Prevent zone header from intercepting node drag
      const target = e.currentTarget;
      target.setPointerCapture(e.pointerId);
      hasDragged.current = false;
      isDraggingRef.current = true;

      // Snapshot starting position — this is the locked origin for absolute deltas
      livePos.current = { x: node.x, y: node.y };

      // Lock the initial client pointer position — all displacement is computed
      // as an absolute delta from this point (never accumulate movementX/Y which
      // suffers from floating-point drift when divided by scale).
      const startClientX = e.clientX;
      const startClientY = e.clientY;

      // Check if this node is part of a multi-selection for bulk drag
      const sel = selectionRef.current;
      const isBulk = sel?.type === 'node' && sel.ids.length > 1 && sel.ids.includes(node.id);
      // Snapshot sibling DOM elements and their starting positions for bulk drag
      const siblings: { el: HTMLElement; startX: number; startY: number }[] = [];
      if (isBulk) {
        for (const id of sel.ids) {
          if (id === node.id) continue; // skip self — handled by livePos
          const el = document.querySelector(`[data-node-id="${id}"]`) as HTMLElement | null;
          if (el) {
            // Parse current position from the transform style
            const match = el.style.transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
            if (match) {
              siblings.push({ el, startX: parseFloat(match[1]), startY: parseFloat(match[2]) });
            }
          }
        }
      }

      const onPointerMove = (moveEvent: PointerEvent) => {
        hasDragged.current = true;
        // Compensate for zoom: divide pixel movement by current scale
        const scale = viewportStateRef.current?.scale ?? 1;

        // Absolute delta from locked origin — stable, no accumulation drift
        const totalDx = (moveEvent.clientX - startClientX) / scale;
        const totalDy = (moveEvent.clientY - startClientY) / scale;

        livePos.current.x = node.x + totalDx;
        livePos.current.y = node.y + totalDy;

        // DIRECT DOM MUTATION — bypasses React render cycle
        if (domRef.current) {
          domRef.current.style.transform = `translate(${livePos.current.x}px, ${livePos.current.y}px) translateZ(0)`;
        }

        // Bulk: move sibling nodes via direct DOM mutation
        for (const s of siblings) {
          s.el.style.transform = `translate(${s.startX + totalDx}px, ${s.startY + totalDy}px) translateZ(0)`;
        }
      };

      const onPointerUp = (upEvent: PointerEvent) => {
        target.removeEventListener('pointermove', onPointerMove);
        target.removeEventListener('pointerup', onPointerUp);
        target.releasePointerCapture(upEvent.pointerId);

        isDraggingRef.current = false;

        if (hasDragged.current) {
          // CRITICAL: Clear ALL transient inline transforms BEFORE committing
          // to state. Without this, React re-renders with new coordinates from
          // Jotai, but the stale inline overrides remain → double-delta "jump".
          if (domRef.current) {
            domRef.current.style.transform = '';
          }
          for (const s of siblings) {
            s.el.style.transform = '';
          }

          // Total displacement for final commit
          const scale = viewportStateRef.current?.scale ?? 1;
          const totalDx = (upEvent.clientX - startClientX) / scale;
          const totalDy = (upEvent.clientY - startClientY) / scale;

          // COMMIT via moveNodesAtom — handles position + spatial zone inheritance
          const entries = [
            { id: node.id, x: Math.round(node.x + totalDx), y: Math.round(node.y + totalDy) },
            ...siblings.map((s) => ({
              id: s.el.getAttribute('data-node-id')!,
              x: Math.round(s.startX + totalDx),
              y: Math.round(s.startY + totalDy),
            })),
          ];
          moveNodes(entries);
        }
      };

      target.addEventListener('pointermove', onPointerMove);
      target.addEventListener('pointerup', onPointerUp);
    },
    [node.x, node.y, node.id, moveNodes, viewportStateRef],
  );

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (hasDragged.current) return; // was a drag, not a click
      e.stopPropagation();
      // Shift+click: toggle this node in/out of existing multi-select
      const sel = selectionRef.current;
      if (e.shiftKey) {
        if (sel?.type === 'node') {
          const exists = sel.ids.includes(node.id);
          const newIds = exists
            ? sel.ids.filter((id) => id !== node.id)
            : [...sel.ids, node.id];
          setSelection(newIds.length > 0 ? { type: 'node', ids: newIds } : null);
        } else {
          setSelection({ type: 'node', ids: [node.id] });
        }
      } else {
        setSelection({ type: 'node', ids: [node.id] });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Skip React-driven transform when this node is being dragged directly
  // OR when a parent zone is cascade-dragging it (data-cascade-dragging attribute)
  const isCascadeDragged = domRef.current?.getAttribute('data-cascade-dragging') === '1';
  const skipTransform = isDraggingRef.current || isCascadeDragged;

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
        ...(skipTransform ? {} : { transform: `translate(${node.x}px, ${node.y}px) translateZ(0)` }),
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
        isSelected ? 'node-selected' : '',
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
          className="no-canvas-events"
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
          className="no-canvas-events"
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
