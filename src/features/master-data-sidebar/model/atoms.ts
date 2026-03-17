/**
 * Sidebar state atoms — controls contextual open/close of MasterDataSidebar.
 *
 * - isSidebarOpenAtom: boolean toggle for slide in/out
 * - sidebarContextAtom: optional country ID to pre-expand when opening from a zone click
 */

import { atom } from 'jotai';

/** Whether the Master Data sidebar is visible */
export const isSidebarOpenAtom = atom<boolean>(false);

/** Optional country ID to pre-expand when sidebar opens from a zone click */
export const sidebarContextAtom = atom<string | null>(null);
