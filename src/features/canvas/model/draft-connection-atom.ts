import { atom } from 'jotai';

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
