import { atom } from 'jotai';

export type SelectionState =
  | { type: 'node'; id: string }
  | { type: 'flow'; id: string }
  | null;

/** Currently selected entity on Canvas (node or flow). */
export const selectionAtom = atom<SelectionState>(null);
