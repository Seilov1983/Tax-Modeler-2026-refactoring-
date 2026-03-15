import { atom } from 'jotai';

export type SelectionState =
  | { type: 'node'; ids: string[] }
  | { type: 'flow'; id: string }
  | { type: 'ownership'; id: string }
  | { type: 'zone'; id: string }
  | null;

/** Currently selected entity on Canvas (node, flow, or ownership edge). */
export const selectionAtom = atom<SelectionState>(null);
