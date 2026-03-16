/**
 * context-menu-atom.ts — Jotai atom for canvas context menu state.
 *
 * The context menu is rendered as a React DOM overlay (HTML/CSS) on top of
 * the Konva <Stage>, NOT inside the canvas. This prevents clipping by canvas
 * bounds and avoids scaling with zoom.
 *
 * Coordinates are screen-space (clientX/clientY) obtained via
 * `stage.getPointerPosition()` — independent of canvas pan/zoom.
 */

import { atom } from 'jotai';
import type { Zone } from '@shared/types';

export type ContextMenuTarget =
  | { kind: 'empty'; screenX: number; screenY: number; canvasX: number; canvasY: number }
  | { kind: 'country'; screenX: number; screenY: number; canvasX: number; canvasY: number; zone: Zone }
  | { kind: 'regime'; screenX: number; screenY: number; canvasX: number; canvasY: number; zone: Zone };

/** Global context menu state — null means closed */
export const contextMenuAtom = atom<ContextMenuTarget | null>(null);
