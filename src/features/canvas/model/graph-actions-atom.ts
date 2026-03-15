/**
 * Write-only action atoms for graph mutations (add/delete node, flow, ownership).
 *
 * These atoms update BOTH projectAtom and the individual entity atoms
 * (nodesAtom, flowsAtom, ownershipAtom) in a single Jotai batch — one React re-render.
 *
 * Every mutation calls commitHistoryAtom first, pushing the current state
 * onto the undo stack before applying the change.
 */

import { atom } from 'jotai';
import { projectAtom } from './project-atom';
import { nodesAtom } from '@entities/node';
import { flowsAtom } from '@entities/flow';
import { ownershipAtom } from '@entities/ownership';
import { selectionAtom } from '@features/entity-editor/model/atoms';
import { commitHistoryAtom } from '@features/project-management/model/history-atoms';
import { uid } from '@shared/lib/engine/utils';
import type { NodeDTO, FlowDTO, OwnershipEdge, NodeType } from '@shared/types';

// ─── Add Node ───────────────────────────────────────────────────────────────

export interface AddNodePayload {
  type: NodeType;
  name: string;
  x: number;
  y: number;
  zoneId?: string;
}

export const addNodeAtom = atom(
  null,
  (_get, set, payload: AddNodePayload) => {
    set(commitHistoryAtom);

    const newNode: NodeDTO = {
      id: 'n_' + uid(),
      name: payload.name,
      type: payload.type,
      x: payload.x,
      y: payload.y,
      w: 180,
      h: 80,
      zoneId: payload.zoneId ?? null,
      frozen: false,
      riskFlags: [],
      annualIncome: 0,
      etr: 0,
      balances: {},
    };

    set(nodesAtom, (prev) => [...prev, newNode]);
    set(projectAtom, (prev) => {
      if (!prev) return prev;
      return { ...prev, nodes: [...prev.nodes, newNode] };
    });
  },
);

// ─── Add Flow ───────────────────────────────────────────────────────────────

export interface AddFlowPayload {
  fromId: string;
  toId: string;
}

export const addFlowAtom = atom(
  null,
  (get, set, payload: AddFlowPayload) => {
    set(commitHistoryAtom);

    const project = get(projectAtom);
    const fxDate = project?.fx?.fxDate || new Date().toISOString().slice(0, 10);

    const newFlow: FlowDTO = {
      id: 'f_' + uid(),
      fromId: payload.fromId,
      toId: payload.toId,
      flowType: 'Services',
      currency: 'KZT',
      grossAmount: 0,
      paymentMethod: 'bank',
      cashComponentAmount: 0,
      cashComponentCurrency: 'KZT',
      whtRate: 0,
      status: 'pending',
      flowDate: new Date(fxDate + 'T12:00:00Z').toISOString(),
      ack: { ackStatus: 'not_required', acknowledgedBy: null, acknowledgedAt: null, comment: '' },
      taxAdjustments: [],
      fxEvidence: null,
    };

    set(flowsAtom, (prev) => [...prev, newFlow]);
    set(projectAtom, (prev) => {
      if (!prev) return prev;
      return { ...prev, flows: [...prev.flows, newFlow] };
    });
  },
);

// ─── Add Ownership ──────────────────────────────────────────────────────────

export interface AddOwnershipPayload {
  parentId: string;
  subsidiaryId: string;
}

export const addOwnershipAtom = atom(
  null,
  (_get, set, payload: AddOwnershipPayload) => {
    set(commitHistoryAtom);

    const edge: OwnershipEdge = {
      id: 'own_' + uid(),
      fromId: payload.parentId,
      toId: payload.subsidiaryId,
      percent: 100,
      manualAdjustment: 0,
    };

    set(ownershipAtom, (prev) => [...prev, edge]);
    set(projectAtom, (prev) => {
      if (!prev) return prev;
      return { ...prev, ownership: [...prev.ownership, edge] };
    });
  },
);

// ─── Delete Flow (simple) ───────────────────────────────────────────────────

export const deleteFlowAtom = atom(
  null,
  (get, set, flowId: string) => {
    set(commitHistoryAtom);

    set(flowsAtom, (prev) => prev.filter((f) => f.id !== flowId));
    set(projectAtom, (prev) => {
      if (!prev) return prev;
      return { ...prev, flows: prev.flows.filter((f) => f.id !== flowId) };
    });

    const sel = get(selectionAtom);
    if (sel?.type === 'flow' && sel.id === flowId) {
      set(selectionAtom, null);
    }
  },
);

// ─── Delete Ownership ───────────────────────────────────────────────────────

export const deleteOwnershipAtom = atom(
  null,
  (get, set, ownershipId: string) => {
    set(commitHistoryAtom);

    set(ownershipAtom, (prev) => prev.filter((o) => o.id !== ownershipId));
    set(projectAtom, (prev) => {
      if (!prev) return prev;
      return { ...prev, ownership: prev.ownership.filter((o) => o.id !== ownershipId) };
    });

    const sel = get(selectionAtom);
    if (sel?.type === 'ownership' && sel.id === ownershipId) {
      set(selectionAtom, null);
    }
  },
);

// ─── Delete Node (cascading — removes all connected flows + ownership) ──────

export const deleteNodeAtom = atom(
  null,
  (get, set, nodeId: string) => {
    set(commitHistoryAtom);

    set(nodesAtom, (prev) => prev.filter((n) => n.id !== nodeId));
    set(flowsAtom, (prev) => prev.filter((f) => f.fromId !== nodeId && f.toId !== nodeId));
    set(ownershipAtom, (prev) => prev.filter((o) => o.fromId !== nodeId && o.toId !== nodeId));
    set(projectAtom, (prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        nodes: prev.nodes.filter((n) => n.id !== nodeId),
        flows: prev.flows.filter((f) => f.fromId !== nodeId && f.toId !== nodeId),
        ownership: prev.ownership.filter((o) => o.fromId !== nodeId && o.toId !== nodeId),
      };
    });

    const sel = get(selectionAtom);
    if (sel?.type === 'node') {
      const remaining = sel.ids.filter((id) => id !== nodeId);
      set(selectionAtom, remaining.length > 0 ? { type: 'node', ids: remaining } : null);
    }
  },
);

// ─── Move Nodes (batch) — commits positions for a group of nodes ────────

export interface MoveNodeEntry {
  id: string;
  x: number;
  y: number;
}

export const moveNodesAtom = atom(
  null,
  (get, set, entries: MoveNodeEntry[]) => {
    set(commitHistoryAtom);

    const idMap = new Map(entries.map((e) => [e.id, e]));
    set(nodesAtom, (prev) =>
      prev.map((n) => {
        const entry = idMap.get(n.id);
        return entry ? { ...n, x: entry.x, y: entry.y } : n;
      }),
    );
    set(projectAtom, (prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        nodes: prev.nodes.map((n) => {
          const entry = idMap.get(n.id);
          return entry ? { ...n, x: entry.x, y: entry.y } : n;
        }),
      };
    });
  },
);

// ─── Delete Nodes (batch) — cascading delete for multiple nodes ─────────

export const deleteNodesAtom = atom(
  null,
  (get, set, nodeIds: string[]) => {
    set(commitHistoryAtom);

    const idSet = new Set(nodeIds);
    set(nodesAtom, (prev) => prev.filter((n) => !idSet.has(n.id)));
    set(flowsAtom, (prev) => prev.filter((f) => !idSet.has(f.fromId) && !idSet.has(f.toId)));
    set(ownershipAtom, (prev) => prev.filter((o) => !idSet.has(o.fromId) && !idSet.has(o.toId)));
    set(projectAtom, (prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        nodes: prev.nodes.filter((n) => !idSet.has(n.id)),
        flows: prev.flows.filter((f) => !idSet.has(f.fromId) && !idSet.has(f.toId)),
        ownership: prev.ownership.filter((o) => !idSet.has(o.fromId) && !idSet.has(o.toId)),
      };
    });
    set(selectionAtom, null);
  },
);
