'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useAtomValue } from 'jotai';
import { projectAtom } from '@features/canvas';
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
 * Returns the remote project ID ref for external consumers.
 */
export function useDebouncedCloudSync(isHydrated: boolean) {
  const project = useAtomValue(projectAtom);

  const remoteProjectIdRef = useRef<string | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isOfflineModeRef = useRef(false);

  const syncToCloud = useCallback(async (proj: Project) => {
    if (isOfflineModeRef.current) return;

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
  }, []);

  useEffect(() => {
    if (!project || !isHydrated) return;

    // 1. Immediate: localStorage
    project.updatedAt = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project));

    // 2. Debounced: cloud sync (1500ms)
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
  }, [project, isHydrated, syncToCloud]);

  return { remoteProjectIdRef, isOfflineModeRef };
}
