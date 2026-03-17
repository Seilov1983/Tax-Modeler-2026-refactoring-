/**
 * spawn-coordinates-atom.ts — Stores the canvas (x, y) coordinates where a zone
 * should be spawned when the user selects an item from the MasterDataModal.
 *
 * Set when the user double-clicks/right-clicks on the canvas and selects
 * "Add Country" or "Add Regime" from the context menu.
 * Read by the MasterDataModal to place zones at the correct cursor position.
 */

import { atom } from 'jotai';
import type { Zone } from '@shared/types';

export interface SpawnCoordinates {
  x: number;
  y: number;
  /** If spawning a regime, the parent country zone */
  parentZone?: Zone;
}

/** Temporary spawn coordinates — null means no context-menu-driven spawn */
export const spawnCoordinatesAtom = atom<SpawnCoordinates | null>(null);
