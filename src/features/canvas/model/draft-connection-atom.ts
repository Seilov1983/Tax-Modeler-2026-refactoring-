import { atom } from 'jotai';

/**
 * Transient state for the "rubber band" line while the user
 * drags from a connection port to another node.
 *
 * mouseX/mouseY are canvas-space coordinates (accounting for pan & zoom).
 * They are updated via direct DOM mutation (not atom writes) for 60 FPS —
 * only sourceNodeId lives in the atom to signal "a drag is in progress".
 */
export const draftConnectionAtom = atom<{
  sourceNodeId: string;
} | null>(null);
