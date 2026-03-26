import { atom } from 'jotai';

export interface SyncStatus {
  isSyncing: boolean;
  lastSavedAt: Date | null;
}

export const syncStatusAtom = atom<SyncStatus>({
  isSyncing: false,
  lastSavedAt: null,
});
