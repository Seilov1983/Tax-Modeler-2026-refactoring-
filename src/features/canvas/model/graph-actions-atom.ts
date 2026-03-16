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

    // Trigger physics after node movement
    set(physicsAtom);
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
    };

    set(zonesAtom, (prev) => [...prev, newZone]);
    set(projectAtom, (prev) => {
      if (!prev) return prev;
      return { ...prev, zones: [...prev.zones, newZone] };
    });

    // Trigger physics: auto-resize parent country + resolve collisions
    set(physicsAtom);
  },
);

// ─── Move Zone ───────────────────────────────────────────────────────────────

export const moveZoneAtom = atom(
  null,
  (get, set, payload: { id: string; x: number; y: number }) => {
    set(commitHistoryAtom);

    const zones = get(zonesAtom);
    const nodes = get(nodesAtom);
    const movedZone = zones.find((z) => z.id === payload.id);
    if (!movedZone) return;

    // Delta vector
    const dx = payload.x - movedZone.x;
    const dy = payload.y - movedZone.y;

    if (dx === 0 && dy === 0) return;

    // Find child sub-zones: smaller zones whose center lies inside the moved zone
    const childZoneIds = new Set<string>();
    const movedArea = zoneArea(movedZone);
    for (const z of zones) {
      if (z.id === movedZone.id) continue;
      if (zoneArea(z) >= movedArea) continue;
      const cx = z.x + z.w / 2;
      const cy = z.y + z.h / 2;
      if (pointInZone(cx, cy, movedZone)) {
        childZoneIds.add(z.id);
      }
    }

    // Find child nodes: nodes whose center lies inside the moved zone or any of its child sub-zones
    const childNodeIds = new Set<string>();
    for (const n of nodes) {
      const { cx, cy } = nodeCenter(n);
      if (pointInZone(cx, cy, movedZone)) {
        childNodeIds.add(n.id);
      }
    }

    // Apply delta to all zones (moved zone + child sub-zones)
    const affectedZoneIds = new Set([movedZone.id, ...childZoneIds]);
    const updateZone = (z: Zone) => {
      if (!affectedZoneIds.has(z.id)) return z;
      return { ...z, x: z.x + dx, y: z.y + dy };
    };

    // Apply delta to child nodes
    const updateNode = (n: NodeDTO) => {
      if (!childNodeIds.has(n.id)) return n;
      return { ...n, x: n.x + dx, y: n.y + dy };
    };

    // Batch update: zones, nodes, and project in one pass
    set(zonesAtom, (prev) => prev.map(updateZone));
    set(nodesAtom, (prev) => prev.map(updateNode));
    set(projectAtom, (prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        zones: prev.zones.map(updateZone),
        nodes: prev.nodes.map(updateNode),
      };
    });

    // Trigger physics: auto-resize parent country + resolve collisions
    set(physicsAtom);
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

    // Trigger physics after resize
    set(physicsAtom);
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

// ─── Physics: Auto-Resize Country Bounds ──────────────────────────────────

const PHYSICS_PADDING = 40;
const DEFAULT_COUNTRY_WIDTH = 200;
const DEFAULT_COUNTRY_HEIGHT = 150;

/**
 * Recalculate a country zone's bounds to encompass all child regime sub-zones.
 * Returns updated zones array. Does NOT mutate input.
 *
 * IMPORTANT: Bounds are computed absolutely from children's coordinates.
 * We never reference country.w / country.h to avoid additive runaway.
 */
function recalculateCountryBounds(zones: Zone[]): Zone[] {
  // Identify countries (large zones) and regimes (sub-zones inside them)
  // A zone is a "country" if any smaller zone's center is inside it
  const updated = zones.map((z) => ({ ...z }));
  const areaMap = new Map(updated.map((z) => [z.id, z.w * z.h]));

  for (const country of updated) {
    const countryArea = areaMap.get(country.id) || 0;
    // Find child sub-zones: smaller zones whose center is inside this country
    const children = updated.filter((z) => {
      if (z.id === country.id) return false;
      const childArea = areaMap.get(z.id) || 0;
      if (childArea >= countryArea) return false;
      const cx = z.x + z.w / 2;
      const cy = z.y + z.h / 2;
      return cx >= country.x && cx <= country.x + country.w &&
             cy >= country.y && cy <= country.y + country.h;
    });

    if (children.length === 0) continue;

    // Absolute bounds from children — never reference country.w / country.h
    const maxChildRightEdge = Math.max(...children.map((c) => c.x + c.w));
    const maxChildBottomEdge = Math.max(...children.map((c) => c.y + c.h));
    const minChildX = Math.min(...children.map((c) => c.x));
    const minChildY = Math.min(...children.map((c) => c.y));

    // Expand origin if children sit outside the current top-left
    const newX = Math.min(country.x, minChildX - PHYSICS_PADDING);
    const newY = Math.min(country.y, minChildY - PHYSICS_PADDING - 30); // extra for header

    // Width/height are absolute: based on child edges relative to origin
    const newW = Math.max(DEFAULT_COUNTRY_WIDTH, maxChildRightEdge - newX + PHYSICS_PADDING);
    const newH = Math.max(DEFAULT_COUNTRY_HEIGHT, maxChildBottomEdge - newY + PHYSICS_PADDING);

    country.x = newX;
    country.y = newY;
    country.w = newW;
    country.h = newH;
  }

  return updated;
}

/**
 * Resolve collisions between country-level zones by pushing overlapping
 * countries to the right. Sorts by x, iterates left-to-right.
 * Max 10 iterations to prevent infinite loops.
 */
function resolveCountryCollisions(zones: Zone[]): Zone[] {
  const updated = zones.map((z) => ({ ...z }));

  // Identify country-level zones (zones that have children or are large)
  // For simplicity: any zone with area >= threshold is a "country"
  // We detect countries as zones that contain other zones
  const countryIds = new Set<string>();
  for (const a of updated) {
    for (const b of updated) {
      if (a.id === b.id) continue;
      const bArea = b.w * b.h;
      const aArea = a.w * a.h;
      if (bArea < aArea) {
        const cx = b.x + b.w / 2;
        const cy = b.y + b.h / 2;
        if (cx >= a.x && cx <= a.x + a.w && cy >= a.y && cy <= a.y + a.h) {
          countryIds.add(a.id);
        }
      }
    }
  }

  // If no nested structure, treat all zones as potential countries for collision
  const countries = countryIds.size > 0
    ? updated.filter((z) => countryIds.has(z.id))
    : updated;

  // Sort countries by x position (left to right)
  countries.sort((a, b) => a.x - b.x);

  // Resolve collisions: push overlapping countries right
  for (let iter = 0; iter < 10; iter++) {
    let anyCollision = false;
    for (let i = 1; i < countries.length; i++) {
      const prev = countries[i - 1];
      const curr = countries[i];
      // Check AABB overlap
      const overlapX = prev.x + prev.w + PHYSICS_PADDING > curr.x;
      const overlapY = !(prev.y + prev.h < curr.y || curr.y + curr.h < prev.y);
      if (overlapX && overlapY) {
        const shift = (prev.x + prev.w + PHYSICS_PADDING) - curr.x;
        // Push curr and all its children right
        const oldX = curr.x;
        curr.x = prev.x + prev.w + PHYSICS_PADDING;
        // Also shift child sub-zones inside this country
        for (const z of updated) {
          if (z.id === curr.id) continue;
          const cx = z.x + z.w / 2;
          const cy = z.y + z.h / 2;
          if (cx >= oldX && cx <= oldX + curr.w && cy >= curr.y && cy <= curr.y + curr.h) {
            z.x += shift;
          }
        }
        anyCollision = true;
      }
    }
    if (!anyCollision) break;
    // Re-sort after shifts
    countries.sort((a, b) => a.x - b.x);
  }

  return updated;
}

/**
 * Run the full physics pipeline: auto-resize countries, then resolve collisions.
 * Also shifts nodes that belong to shifted zones.
 */
export const physicsAtom = atom(
  null,
  (get, set) => {
    let zones = get(zonesAtom);
    if (zones.length < 2) return; // nothing to resolve

    // Step 1: Auto-resize countries to fit their child regimes
    zones = recalculateCountryBounds(zones);

    // Step 2: Resolve country-country collisions
    zones = resolveCountryCollisions(zones);

    // Compute zone position deltas to shift child nodes
    const oldZones = get(zonesAtom);
    const deltaMap = new Map<string, { dx: number; dy: number }>();
    for (const newZ of zones) {
      const oldZ = oldZones.find((z) => z.id === newZ.id);
      if (oldZ && (oldZ.x !== newZ.x || oldZ.y !== newZ.y)) {
        deltaMap.set(newZ.id, { dx: newZ.x - oldZ.x, dy: newZ.y - oldZ.y });
      }
    }

    // Shift nodes whose zone moved
    const nodes = get(nodesAtom);
    const updatedNodes = nodes.map((n) => {
      if (!n.zoneId) return n;
      // Find which zone contains this node (check all zones that moved)
      for (const [zoneId, delta] of deltaMap) {
        const oldZ = oldZones.find((z) => z.id === zoneId);
        if (!oldZ) continue;
        const cx = n.x + n.w / 2;
        const cy = n.y + n.h / 2;
        if (cx >= oldZ.x && cx <= oldZ.x + oldZ.w && cy >= oldZ.y && cy <= oldZ.y + oldZ.h) {
          return { ...n, x: n.x + delta.dx, y: n.y + delta.dy };
        }
      }
      return n;
    });

    // Only apply if something changed
    const zonesChanged = zones.some((z, i) => {
      const old = oldZones[i];
      return !old || z.x !== old.x || z.y !== old.y || z.w !== old.w || z.h !== old.h;
    });

    if (zonesChanged) {
      set(zonesAtom, zones);
      set(nodesAtom, updatedNodes);
      set(projectAtom, (prev) => {
        if (!prev) return prev;
        return { ...prev, zones, nodes: updatedNodes };
      });
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
