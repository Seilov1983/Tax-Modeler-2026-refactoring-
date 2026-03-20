/**
 * Settings atom — persisted to localStorage via Jotai's atomWithStorage.
 *
 * Stores user preferences: theme, canvas snap-to-grid, language.
 * Hydrates automatically on mount — no manual hydration needed.
 */

import { atomWithStorage } from 'jotai/utils';

export type ThemeMode = 'light' | 'dark' | 'system';
export type Language = 'en' | 'ru';

export interface AppSettings {
  theme: ThemeMode;
  canvasSnapToGrid: boolean;
  language: Language;
}

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  canvasSnapToGrid: true,
  language: 'en',
};

export const settingsAtom = atomWithStorage<AppSettings>(
  'tax-modeler-settings',
  DEFAULT_SETTINGS,
);

