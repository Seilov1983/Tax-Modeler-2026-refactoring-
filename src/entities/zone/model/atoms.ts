import { atom } from 'jotai';
import { splitAtom } from 'jotai/utils';
import type { Zone } from '@shared/types';

export const zonesAtom = atom<Zone[]>([]);
export const zoneAtomsAtom = splitAtom(zonesAtom);

export const zoneByIdAtom = atom((get) => {
  const zones = get(zonesAtom);
  const map = new Map<string, Zone>();
  zones.forEach((z) => map.set(z.id, z));
  return map;
});
