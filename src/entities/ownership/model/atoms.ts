import { atom } from 'jotai';
import { splitAtom } from 'jotai/utils';
import type { OwnershipEdge } from '@shared/types';

export const ownershipAtom = atom<OwnershipEdge[]>([]);

/**
 * splitAtom for ownership edges — updating one edge (e.g. changing percent)
 * does not trigger re-render of all other ownership lines on the canvas.
 */
export const ownershipAtomsAtom = splitAtom(ownershipAtom);
