/**
 * Transient drag-over feedback state for guard-rail visuals.
 *
 * When a Regime zone is being dragged over the canvas, this atom tracks
 * which Country zone should glow (valid parent) or flash red (invalid target).
 * Cleared on drag end.
 */

import { atom } from 'jotai';

export interface DragOverFeedback {
  /** The correct parent Country zone id — receives a soft green/blue glow */
  validParentId: string | null;
  /** The Country zone the regime is currently hovering over (if wrong parent) — receives a red stroke */
  invalidZoneId: string | null;
}

export const dragOverFeedbackAtom = atom<DragOverFeedback>({
  validParentId: null,
  invalidZoneId: null,
});
