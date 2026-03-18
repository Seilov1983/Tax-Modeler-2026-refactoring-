import { atom } from 'jotai';
import { splitAtom } from 'jotai/utils';
import type { FlowDTO } from '@shared/types';

export const flowsAtom = atom<FlowDTO[]>([]);
export const flowAtomsAtom = splitAtom(flowsAtom);
