/**
 * Jotai v2 Atoms for Canvas Nodes.
 *
 * Key architectural decisions:
 * 1. splitAtom ensures only the changed node re-renders, not the entire list.
 * 2. Drag coordinates are NOT stored here — they are transient DOM state.
 *    Only committed (post-drop) positions go through setNode → atom update.
 * 3. This enables 60 FPS drag while React renders stay minimal.
 */

import { atom } from 'jotai';
import { splitAtom } from 'jotai/utils';
import type { NodeDTO } from '@shared/types';

// ─── Base atoms ──────────────────────────────────────────────────────────────

/** The authoritative list of all canvas nodes */
export const nodesAtom = atom<NodeDTO[]>([]);

/**
 * splitAtom creates individual atoms for each array element.
 * When one node moves, only its atom changes — other nodes don't re-render.
 */
export const nodeAtomsAtom = splitAtom(nodesAtom);

/** Lookup: node by ID (derived) */
export const nodeByIdAtom = atom((get) => {
  const nodes = get(nodesAtom);
  const map = new Map<string, NodeDTO>();
  nodes.forEach((n) => map.set(n.id, n));
  return map;
});

// ─── Selection state ─────────────────────────────────────────────────────────

export const selectedNodeIdAtom = atom<string | null>(null);

export const selectedNodeAtom = atom((get) => {
  const id = get(selectedNodeIdAtom);
  if (!id) return null;
  return get(nodeByIdAtom).get(id) ?? null;
});
