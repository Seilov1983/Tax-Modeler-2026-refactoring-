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
import dagre from 'dagre';
import { projectAtom } from './project-atom';
import { nodesAtom } from '@entities/node';
import { flowsAtom } from '@entities/flow';
import { ownershipAtom } from '@entities/ownership';
import { selectionAtom } from '@features/entity-editor/model/atoms';
import { commitHistoryAtom } from '@features/project-management/model/history-atoms';
import { zonesAtom } from '@entities/zone';
import { uid } from '@shared/lib/engine/utils';
import { detectZoneId, pointInZone, zoneArea, nodeCenter } from '@shared/lib/engine/engine-core';
import type { NodeDTO, FlowDTO, OwnershipEdge, NodeType, Zone, JurisdictionCode, CurrencyCode } from '@shared/types';

// ─── Add Node ───────────────────────────────────────────────────────────────

/** Default dimensions for newly created nodes (used in addNodeAtom + CanvasBoard double-click offset) */
export const NODE_WIDTH = 180;
export const NODE_HEIGHT = 80;

export interface AddNodePayload {
  type: NodeType;
  name: string;
  x: number;
  y: number;
  zoneId?: string;
}

export const addNodeAtom = atom(
  null,
  (get, set, payload: AddNodePayload) => {
    set(commitHistoryAtom);

    const project = get(projectAtom);
    const newNode: NodeDTO = {
      id: 'n_' + uid(),
      name: payload.name,
      type: payload.type,
      x: payload.x,
      y: payload.y,
      w: NODE_WIDTH,
      h: NODE_HEIGHT,
      zoneId: payload.zoneId ?? null,
      frozen: false,
      riskFlags: [],
      annualIncome: 0,
      etr: 0,
      balances: {},
    };

    // Spatial inheritance: auto-detect zone from spawn position if no explicit zoneId
    if (!newNode.zoneId && project) {
      newNode.zoneId = detectZoneId(project, newNode);
    }

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

    const project = get(projectAtom);
    const idMap = new Map(entries.map((e) => [e.id, e]));

    // Update position + auto-detect zone (spatial inheritance)
    const updateNode = (n: NodeDTO) => {
      const entry = idMap.get(n.id);
      if (!entry) return n;
      const moved = { ...n, x: entry.x, y: entry.y };
      if (project && n.type !== 'txa') {
        moved.zoneId = detectZoneId(project, moved);
      }
      return moved;
    };

    set(nodesAtom, (prev) => prev.map(updateNode));
    set(projectAtom, (prev) => {
      if (!prev) return prev;
      return { ...prev, nodes: prev.nodes.map(updateNode) };
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

// ─── Add Zone ────────────────────────────────────────────────────────────────

export interface AddZonePayload {
  jurisdiction: JurisdictionCode;
  name: string;
  code: string;
  currency: CurrencyCode;
  x: number;
  y: number;
  w?: number;
  h?: number;
  /** Explicit parent zone id for strict hierarchy (Country → Regime). */
  parentId?: string | null;
}

const ZONE_DEFAULTS: Record<string, { w: number; h: number }> = {
  KZ: { w: 600, h: 500 },
  UAE: { w: 600, h: 500 },
  HK: { w: 500, h: 400 },
  CY: { w: 500, h: 400 },
  SG: { w: 500, h: 400 },
  UK: { w: 500, h: 400 },
  US: { w: 500, h: 400 },
  BVI: { w: 400, h: 350 },
};

export const addZoneAtom = atom(
  null,
  (get, set, payload: AddZonePayload) => {
    set(commitHistoryAtom);

    const defaults = ZONE_DEFAULTS[payload.jurisdiction] || { w: 500, h: 400 };
    const existingZones = get(zonesAtom);

    const newZone: Zone = {
      id: 'z_' + uid(),
      name: payload.name,
      jurisdiction: payload.jurisdiction,
      code: payload.code,
      currency: payload.currency,
      x: payload.x,
      y: payload.y,
      w: payload.w ?? defaults.w,
      h: payload.h ?? defaults.h,
      zIndex: existingZones.length,
      parentId: payload.parentId ?? null,
    };

    set(zonesAtom, (prev) => [...prev, newZone]);
    set(projectAtom, (prev) => {
      if (!prev) return prev;
      return { ...prev, zones: [...prev.zones, newZone] };
    });

  },
);

// ─── Move Zone ───────────────────────────────────────────────────────────────

export const moveZoneAtom = atom(
  null,
  (get, set, payload: { id: string; x: number; y: number }) => {
    set(commitHistoryAtom);

    const zones = get(zonesAtom);
    const movedZone = zones.find((z) => z.id === payload.id);
    if (!movedZone) return;

    if (payload.x === movedZone.x && payload.y === movedZone.y) return;

    // Konva nested <Group> coordinates are already relative to the parent.
    // Directly assign payload.x / payload.y — no delta or parent subtraction needed.
    // Child zones and nodes move automatically via Konva's group hierarchy.
    const updateZone = (z: Zone) => {
      if (z.id !== payload.id) return z;
      return { ...z, x: payload.x, y: payload.y };
    };

    set(zonesAtom, (prev) => prev.map(updateZone));
    set(projectAtom, (prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        zones: prev.zones.map(updateZone),
      };
    });
  },
);

// ─── Resize Zone ──────────────────────────────────────────────────────────────

export const resizeZoneAtom = atom(
  null,
  (_get, set, payload: { id: string; w: number; h: number }) => {
    set(commitHistoryAtom);

    set(zonesAtom, (prev) =>
      prev.map((z) => (z.id === payload.id ? { ...z, w: payload.w, h: payload.h } : z)),
    );
    set(projectAtom, (prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        zones: prev.zones.map((z) =>
          z.id === payload.id ? { ...z, w: payload.w, h: payload.h } : z,
        ),
      };
    });
  },
);

// ─── Delete Zone ─────────────────────────────────────────────────────────────

export const deleteZoneAtom = atom(
  null,
  (get, set, zoneId: string) => {
    set(commitHistoryAtom);

    // Soft delete: remove zone but keep all nodes at their coordinates.
    // Clear zoneId on orphaned nodes so they are spatially re-detected
    // and flagged as NO_JURISDICTION if outside all remaining zones.
    const clearZoneRef = (n: NodeDTO) =>
      n.zoneId === zoneId ? { ...n, zoneId: null } : n;

    set(zonesAtom, (prev) => prev.filter((z) => z.id !== zoneId));
    set(nodesAtom, (prev) => prev.map(clearZoneRef));
    set(projectAtom, (prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        zones: prev.zones?.filter((z) => z.id !== zoneId) || [],
        nodes: prev.nodes.map(clearZoneRef),
      };
    });

    const sel = get(selectionAtom);
    if (sel?.type === 'zone' && sel.id === zoneId) {
      set(selectionAtom, null);
    }
  },
);

// ─── Auto-Layout (Dagre) — arrange nodes into a clean hierarchy ──────────

export const autoLayoutAtom = atom(
  null,
  (get, set) => {
    const project = get(projectAtom);
    if (!project || project.nodes.length === 0) return;

    set(commitHistoryAtom);

    const g = new dagre.graphlib.Graph();
    g.setGraph({
      rankdir: 'TB',
      align: 'UL',
      nodesep: 80,
      ranksep: 120,
      edgesep: 40,
    });
    g.setDefaultEdgeLabel(() => ({}));

    // Add nodes
    for (const node of project.nodes) {
      g.setNode(node.id, { width: node.w || NODE_WIDTH, height: node.h || NODE_HEIGHT });
    }

    // Ownership edges form the primary hierarchy (higher weight)
    for (const own of project.ownership) {
      g.setEdge(own.fromId, own.toId, { weight: 2 });
    }

    // Flow edges are secondary (lower weight)
    for (const flow of project.flows) {
      g.setEdge(flow.fromId, flow.toId, { weight: 1 });
    }

    dagre.layout(g);

    // Extract new positions (dagre returns center coordinates)
    const updatedNodes = project.nodes.map((node) => {
      const pos = g.node(node.id);
      if (!pos) return node;
      const w = node.w || NODE_WIDTH;
      const h = node.h || NODE_HEIGHT;
      return { ...node, x: Math.round(pos.x - w / 2), y: Math.round(pos.y - h / 2) };
    });

    // Batch-update both entity atoms and projectAtom
    set(nodesAtom, updatedNodes);
    set(projectAtom, (prev) => {
      if (!prev) return prev;
      return { ...prev, nodes: updatedNodes };
    });
  },
);
