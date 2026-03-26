/**
 * Canvas Visibility Filter Atom — controls ghosting of canvas elements.
 *
 * When isActive === true, elements that do NOT match the selected filters
 * are rendered with opacity=0.15 and listening=false (ghosted).
 *
 * Filter logic is purely declarative — computed via derived atoms,
 * no useEffect involved.
 */

import { atom } from 'jotai';
import type { FlowType } from '@shared/types';

// ─── State Shape ─────────────────────────────────────────────────────────────

export interface CanvasFilter {
  /** Management tags to show (empty = show all). */
  managementTags: string[];
  /** Zone IDs to show (empty = show all). */
  zoneIds: string[];
  /** Flow types to show (empty = show all). */
  flowTypes: FlowType[];
  /** Master toggle: when false, all elements render normally. */
  isActive: boolean;
}

const DEFAULT_FILTER: CanvasFilter = {
  managementTags: [],
  zoneIds: [],
  flowTypes: [],
  isActive: false,
};

// ─── Atom ────────────────────────────────────────────────────────────────────

export const canvasFilterAtom = atom<CanvasFilter>(DEFAULT_FILTER);
