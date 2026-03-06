import { atom } from 'jotai';
import type { OwnershipEdge } from '@shared/types';

export const ownershipAtom = atom<OwnershipEdge[]>([]);
