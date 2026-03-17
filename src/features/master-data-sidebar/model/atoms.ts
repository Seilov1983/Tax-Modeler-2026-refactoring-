/**
 * Sidebar state atoms — controls contextual open/close of MasterDataSidebar.
 *
 * - isSidebarOpenAtom: boolean toggle for slide in/out
 * - sidebarContextAtom: optional country ID to pre-expand when opening from a zone click
 * - masterDataAtom: persisted master data (countries + regimes) via atomWithStorage
 * - editModeAtom: toggle for edit mode in the sidebar
 */

import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import { defaultCountries, defaultRegimes } from '@shared/lib/engine/engine-core';
import type { Country, TaxRegime } from '@shared/types';

/** Whether the Master Data sidebar is visible */
export const isSidebarOpenAtom = atom<boolean>(false);

/** Optional country ID to pre-expand when sidebar opens from a zone click */
export const sidebarContextAtom = atom<string | null>(null);

/** Whether the sidebar is in edit mode */
export const editModeAtom = atom<boolean>(false);

/** Persisted master data — Law-as-Code architecture */
export interface MasterDataState {
  countries: Country[];
  regimes: TaxRegime[];
}

const initialMasterData: MasterDataState = {
  countries: defaultCountries(),
  regimes: defaultRegimes(),
};

export const masterDataAtom = atomWithStorage<MasterDataState>(
  'tax-master-data',
  initialMasterData,
);
