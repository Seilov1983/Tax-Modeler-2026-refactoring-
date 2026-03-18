import { atom } from 'jotai';
import { addFlowAtom, addOwnershipAtom } from './graph-actions-atom';
import type { AddFlowPayload, AddOwnershipPayload } from './graph-actions-atom';

/**
 * Transient state for the "rubber band" line while the user
 * drags from a connection port to another node.
 *
 * connectionType distinguishes flow ports (right edge, horizontal Bezier)
 * from ownership ports (bottom edge, vertical Bezier).
 */
export const draftConnectionAtom = atom<{
  sourceNodeId: string;
  connectionType: 'flow' | 'ownership';
} | null>(null);

/**
 * Write-only action atom that commits a draft connection to a target node.
 *
 * Reads draftConnectionAtom internally via `get()` so that CanvasNode components
 * do NOT need to subscribe to the draft state — avoids re-rendering every node
 * whenever a port drag starts or ends.
 *
 * UNLIMITED CONNECTIONS: No cap on how many flows/ownership edges a node can have.
 * The only guard is a self-loop check (source === target).
 */
export const commitDraftConnectionAtom = atom(
  null,
  (get, set, targetNodeId: string) => {
    const draft = get(draftConnectionAtom);
    // Only prevent self-loops — no limit on connection count per node
    if (!draft || draft.sourceNodeId === targetNodeId) return;

    if (draft.connectionType === 'flow') {
      set(addFlowAtom, { fromId: draft.sourceNodeId, toId: targetNodeId });
    } else {
      set(addOwnershipAtom, { parentId: draft.sourceNodeId, subsidiaryId: targetNodeId });
    }

    set(draftConnectionAtom, null);
  },
);
