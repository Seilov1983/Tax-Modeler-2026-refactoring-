'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { projectAtom } from '@features/canvas';
import { syncStatusAtom } from './sync-status-atom';
import type { Project } from '@shared/types';

const SYNC_DEBOUNCE_MS = 1500;
const SYNC_ENDPOINT = '/api/projects/sync';
const STORAGE_KEY = 'tsm26_onefile_project_v2';

/**
 * useDebouncedCloudSync — watches Jotai projectAtom and syncs to the database.
 *
 * Strategy:
 * 1. localStorage write is immediate (offline-first, zero latency).
 * 2. POST to /api/projects/sync is debounced at 1500ms.
 * 3. On 503 / network error, activates offline mode (localStorage-only).
 *
 * Exposes sync state via syncStatusAtom for the autosave indicator.
 */
export function useDebouncedCloudSync(isHydrated: boolean) {
  const project = useAtomValue(projectAtom);
  const setSyncStatus = useSetAtom(syncStatusAtom);

  const remoteProjectIdRef = useRef<string | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isOfflineModeRef = useRef(false);

  const syncToCloud = useCallback(async (proj: Project) => {
    if (isOfflineModeRef.current) {
      // In offline mode, localStorage write already happened — mark as saved
      setSyncStatus({ isSyncing: false, lastSavedAt: new Date() });
      return;
    }

    try {
      const res = await fetch(SYNC_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': 'local-user',
        },
        body: JSON.stringify({
          projectId: remoteProjectIdRef.current ?? undefined,
          name: proj.title,
          schemaVersion: proj.schemaVersion,
          graphJSON: proj,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.id) remoteProjectIdRef.current = data.id;
      } else if (res.status === 503) {
        isOfflineModeRef.current = true;
        console.info('[CloudSync] API 503 — offline mode activated.');
      }
    } catch {
      isOfflineModeRef.current = true;
      console.info('[CloudSync] Network error — offline mode activated.');
    }

    setSyncStatus({ isSyncing: false, lastSavedAt: new Date() });
  }, [setSyncStatus]);

  useEffect(() => {
    if (!project || !isHydrated) return;

    // 1. Immediate: localStorage
    project.updatedAt = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project));

    // 2. Mark as syncing while debounce timer is pending
    setSyncStatus((prev) => ({ ...prev, isSyncing: true }));

    // 3. Debounced: cloud sync (1500ms)
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      syncToCloud(project);
    }, SYNC_DEBOUNCE_MS);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [project, isHydrated, syncToCloud, setSyncStatus]);

  return { remoteProjectIdRef, isOfflineModeRef };
}
