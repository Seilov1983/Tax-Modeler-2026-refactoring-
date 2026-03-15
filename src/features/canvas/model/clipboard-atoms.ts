/**
 * Internal clipboard for copy/paste/duplicate of canvas subgraphs.
 *
 * - Copy (Ctrl+C): deep-clones selected nodes + internal edges (both ends inside selection)
 * - Paste (Ctrl+V): generates new IDs, offsets +40px, remaps edges, commits history
 * - Duplicate (Ctrl+D): copy + paste in one action
 */

import { atom } from 'jotai';
import { projectAtom } from './project-atom';
import { nodesAtom } from '@entities/node';
import { flowsAtom } from '@entities/flow';
import { ownershipAtom } from '@entities/ownership';
import { selectionAtom } from '@features/entity-editor/model/atoms';
import { commitHistoryAtom } from '@features/project-management/model/history-atoms';
import { uid } from '@shared/lib/engine/utils';
import type { NodeDTO, FlowDTO, OwnershipEdge } from '@shared/types';

interface ClipboardData {
  nodes: NodeDTO[];
  flows: FlowDTO[];
  ownership: OwnershipEdge[];
}

export const clipboardAtom = atom<ClipboardData | null>(null);

// ─── Copy ────────────────────────────────────────────────────────────────────

export const copyAtom = atom(null, (get, set) => {
  const project = get(projectAtom);
  const selection = get(selectionAtom);

  if (!project || !selection || selection.type !== 'node' || selection.ids.length === 0) return;

  const selectedIds = new Set(selection.ids);

  const nodesToCopy = project.nodes.filter((n) => selectedIds.has(n.id));

  // Only copy edges where BOTH endpoints are inside the selection
  const flowsToCopy = project.flows.filter(
    (f) => selectedIds.has(f.fromId) && selectedIds.has(f.toId),
  );
  const ownershipToCopy = project.ownership.filter(
    (o) => selectedIds.has(o.fromId) && selectedIds.has(o.toId),
  );

  set(clipboardAtom, {
    nodes: JSON.parse(JSON.stringify(nodesToCopy)),
    flows: JSON.parse(JSON.stringify(flowsToCopy)),
    ownership: JSON.parse(JSON.stringify(ownershipToCopy)),
  });
});

// ─── Paste ───────────────────────────────────────────────────────────────────

export const pasteAtom = atom(null, (get, set) => {
  const clipboard = get(clipboardAtom);
  const project = get(projectAtom);

  if (!clipboard || !project || clipboard.nodes.length === 0) return;

  set(commitHistoryAtom);

  // Build old-ID → new-ID mapping
  const idMap = new Map<string, string>();
  for (const node of clipboard.nodes) {
    idMap.set(node.id, 'n_' + uid());
  }

  // Clone nodes with new IDs and offset
  const newNodes: NodeDTO[] = clipboard.nodes.map((n) => ({
    ...n,
    id: idMap.get(n.id)!,
    x: n.x + 40,
    y: n.y + 40,
    name: `${n.name} (Copy)`,
  }));

  // Remap flow edges
  const newFlows: FlowDTO[] = clipboard.flows.map((f) => ({
    ...f,
    id: 'f_' + uid(),
    fromId: idMap.get(f.fromId)!,
    toId: idMap.get(f.toId)!,
  }));

  // Remap ownership edges
  const newOwnership: OwnershipEdge[] = clipboard.ownership.map((o) => ({
    ...o,
    id: 'own_' + uid(),
    fromId: idMap.get(o.fromId)!,
    toId: idMap.get(o.toId)!,
  }));

  // Update entity atoms
  set(nodesAtom, (prev) => [...prev, ...newNodes]);
  set(flowsAtom, (prev) => [...prev, ...newFlows]);
  set(ownershipAtom, (prev) => [...prev, ...newOwnership]);

  // Update project atom
  set(projectAtom, (prev) => {
    if (!prev) return prev;
    return {
      ...prev,
      nodes: [...prev.nodes, ...newNodes],
      flows: [...prev.flows, ...newFlows],
      ownership: [...prev.ownership, ...newOwnership],
    };
  });

  // Select newly pasted nodes
  set(selectionAtom, { type: 'node', ids: newNodes.map((n) => n.id) });
});

// ─── Duplicate (Copy + Paste) ────────────────────────────────────────────────

export const duplicateAtom = atom(null, (_get, set) => {
  set(copyAtom);
  set(pasteAtom);
});
