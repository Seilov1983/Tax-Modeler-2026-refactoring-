import { atom } from 'jotai';

/**
 * Reactive viewport state — throttled mirror of the imperative ref in useCanvasViewport.
 *
 * The ref drives 60 FPS DOM mutations; this atom drives low-frequency React UI
 * (zoom percentage display, minimap viewport indicator). Updated at most once
 * per animation frame via the sync callback exposed by useCanvasViewport.
 */
export interface ViewportSnapshot {
  panX: number;
  panY: number;
  scale: number;
}

export const viewportAtom = atom<ViewportSnapshot>({ panX: 0, panY: 0, scale: 1 });
