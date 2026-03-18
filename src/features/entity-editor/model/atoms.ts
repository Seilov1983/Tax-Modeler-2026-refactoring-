import { atom } from 'jotai';

export type SelectionState =
  | { type: 'node'; ids: string[] }
  | { type: 'flow'; id: string }
  | { type: 'ownership'; id: string }
  | { type: 'zone'; id: string }
  | null;

/** Currently selected entity on Canvas (node, flow, or ownership edge). */
export const selectionAtom = atom<SelectionState>(null);

/**
 * Gates the EditorModal for nodes.
 * Single-click selects (visual highlight). Double-click sets this flag to open the editor.
 * For flows/ownership, the modal opens on selection (single-click) as before.
 */
export const nodeEditingAtom = atom<boolean>(false);
