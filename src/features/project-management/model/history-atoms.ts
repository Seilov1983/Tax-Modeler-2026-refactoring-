/**
 * Undo / Redo history stack (Memento pattern).
 *
 * Stores up to MAX_HISTORY snapshots of the full Project state.
 * Each graph mutation calls commitHistoryAtom BEFORE mutating,
 * pushing the current state onto the past stack.
 *
 * Undo/Redo use hydrateProjectAtom to re-sync all entity atoms
 * (nodes, flows, zones, ownership, taxes) in a single batch.
 */

import { atom } from 'jotai';
import { projectAtom } from '@features/canvas/model/project-atom';
import { nodesAtom } from '@entities/node';
import { zonesAtom } from '@entities/zone';
import { flowsAtom } from '@entities/flow';
import { ownershipAtom } from '@entities/ownership';
import { taxEntriesAtom } from '@features/tax-calculator';
import type { Project } from '@shared/types';

const MAX_HISTORY = 50;

export const pastStatesAtom = atom<Project[]>([]);
export const futureStatesAtom = atom<Project[]>([]);

/** Derived: true when undo is available. */
export const canUndoAtom = atom((get) => get(pastStatesAtom).length > 0);
/** Derived: true when redo is available. */
export const canRedoAtom = atom((get) => get(futureStatesAtom).length > 0);

// ─── Internal: batch-sync all entity atoms from a Project snapshot ──────────

function hydrateFromSnapshot(
  set: <V>(atom: { write: unknown } & { init: V }, value: V) => void,
  project: Project,
) {
  set(projectAtom as never, project as never);
  set(nodesAtom as never, project.nodes as never);
  set(zonesAtom as never, project.zones as never);
  set(flowsAtom as never, project.flows as never);
  set(ownershipAtom as never, project.ownership as never);
  set(taxEntriesAtom as never, project.taxes as never);
}

// ─── Commit: save current state before mutation ─────────────────────────────

export const commitHistoryAtom = atom(null, (get, set) => {
  const current = get(projectAtom);
  if (!current) return;

  set(pastStatesAtom, (past) => {
    const newPast = [...past, current];
    return newPast.length > MAX_HISTORY
      ? newPast.slice(newPast.length - MAX_HISTORY)
      : newPast;
  });
  // New action invalidates the redo stack
  set(futureStatesAtom, []);
});

// ─── Undo ───────────────────────────────────────────────────────────────────

export const undoAtom = atom(null, (get, set) => {
  const past = get(pastStatesAtom);
  if (past.length === 0) return;

  const current = get(projectAtom);
  const previous = past[past.length - 1];

  if (current) {
    set(futureStatesAtom, (future) => [current, ...future]);
  }

  set(pastStatesAtom, past.slice(0, -1));

  // Batch-sync all entity atoms
  set(projectAtom, previous);
  set(nodesAtom, previous.nodes);
  set(zonesAtom, previous.zones);
  set(flowsAtom, previous.flows);
  set(ownershipAtom, previous.ownership);
  set(taxEntriesAtom, previous.taxes);
});

// ─── Redo ───────────────────────────────────────────────────────────────────

export const redoAtom = atom(null, (get, set) => {
  const future = get(futureStatesAtom);
  if (future.length === 0) return;

  const current = get(projectAtom);
  const next = future[0];

  if (current) {
    set(pastStatesAtom, (past) => [...past, current]);
  }

  set(futureStatesAtom, future.slice(1));

  // Batch-sync all entity atoms
  set(projectAtom, next);
  set(nodesAtom, next.nodes);
  set(zonesAtom, next.zones);
  set(flowsAtom, next.flows);
  set(ownershipAtom, next.ownership);
  set(taxEntriesAtom, next.taxes);
});
