/**
 * Settings atom — persisted to localStorage via Jotai's atomWithStorage.
 *
 * Stores user preferences: theme, canvas snap-to-grid, base currency.
 * Hydrates automatically on mount — no manual hydration needed.
 */

import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';

export type ThemeMode = 'light' | 'dark' | 'system';

export interface AppSettings {
  theme: ThemeMode;
  canvasSnapToGrid: boolean;
  baseCurrency: string;
}

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  canvasSnapToGrid: true,
  baseCurrency: 'USD',
};

export const settingsAtom = atomWithStorage<AppSettings>(
  'tax-modeler-settings',
  DEFAULT_SETTINGS,
);

export const settingsOpenAtom = atom<boolean>(false);
