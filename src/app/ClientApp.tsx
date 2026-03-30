'use client';

/**
 * Client-side application shell.
 *
 * Hydrates the Jotai store with project data and renders the canvas.
 * Wraps everything in a Jotai Provider for atom isolation.
 *
 * Persistence strategy (offline-first):
 *   1. On mount: try API fetch → fall back to localStorage → fall back to demo project
 *   2. On change: useDebouncedCloudSync handles localStorage + /api/projects/sync (1500ms debounce)
 *
 * Offline mode is activated when:
 *   - API returns 503 (database not configured / unreachable)
 *   - fetch throws (no server — Electron static bundle, file:// etc.)
 */

import { Provider, useSetAtom } from 'jotai';
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { hydrateProjectAtom } from '@features/canvas';
import { defaultProject } from '@entities/project';
import { useDebouncedCloudSync } from '@shared/hooks/useDebouncedCloudSync';

const CanvasBoard = dynamic(
  () => import('@widgets/canvas-board').then((mod) => ({ default: mod.CanvasBoard })),
  { ssr: false },
);
const MasterDataSidebar = dynamic(
  () => import('@features/master-data-sidebar').then((mod) => ({ default: mod.MasterDataSidebar })),
  { ssr: false },
);
import {
  ensureMasterData, ensureZoneTaxDefaults,
  bootstrapNormalizeZones, recomputeRisks, recomputeFrozen,
  ensureCountriesAndRegimes,
} from '@shared/lib/engine';
import { SCHEMA_VERSION } from '@shared/lib/engine/engine-core';
import type { Project } from '@shared/types';

const STORAGE_KEY = 'tsm26_onefile_project_v2';
const REMOTE_ID_KEY = 'tsm26_remote_project_id';

/** Major version compatibility: accept any schema from the same major (2.x). */
function isCompatibleSchema(version: string | undefined): boolean {
  if (!version) return false;
  const major = version.split('.')[0];
  const currentMajor = SCHEMA_VERSION.split('.')[0];
  return major === currentMajor;
}

/** Prepare a raw project object for use: ensure masterData, zones, risks, etc. */
function prepareProject(p: Project): Project {
  ensureMasterData(p);
  ensureCountriesAndRegimes(p);
  ensureZoneTaxDefaults(p);
  bootstrapNormalizeZones(p);
  recomputeFrozen(p);
  recomputeRisks(p);
  return p;
}

function AppContent() {
  const hydrate = useSetAtom(hydrateProjectAtom);
  const [isHydrated, setIsHydrated] = useState(false);

  // ─── Cloud Sync: debounced at 1500ms via /api/projects/sync ──────────
  const { remoteProjectIdRef, isOfflineModeRef } = useDebouncedCloudSync(isHydrated);

  // ─── Hydration: API → localStorage → demo ──────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function loadProject() {
      let p: Project | null = null;

      // 1. Try to fetch the most recent project from the API
      try {
        const listRes = await fetch('/api/projects', {
          headers: { 'x-user-id': 'local-user' },
        });

        if (listRes.status === 503) {
          isOfflineModeRef.current = true;
          console.info('[Tax-Modeler] API returned 503 — offline mode activated. Data persists to localStorage.');
        } else if (listRes.ok) {
          const projects = await listRes.json();
          if (Array.isArray(projects) && projects.length > 0) {
            const latest = projects[0];
            const detailRes = await fetch(`/api/projects/${latest.id}`);
            if (detailRes.ok) {
              const record = await detailRes.json();
              if (record.graphJSON && typeof record.graphJSON === 'object') {
                const graph = record.graphJSON as Project;
                if (isCompatibleSchema(graph.schemaVersion)) {
                  graph.schemaVersion = SCHEMA_VERSION;
                  graph.readOnly = false;
                  p = graph;
                  remoteProjectIdRef.current = record.id;
                  try { localStorage.setItem(REMOTE_ID_KEY, record.id); } catch {}
                }
              }
            }
          }
        }
      } catch {
        isOfflineModeRef.current = true;
        console.info('[Tax-Modeler] API unreachable — offline mode activated. Data persists to localStorage.');
      }

      // 2. Fall back to localStorage (offline fallback)
      if (!p) {
        try {
          const raw = localStorage.getItem(STORAGE_KEY);
          if (raw) {
            const obj = JSON.parse(raw);
            if (isCompatibleSchema(obj.schemaVersion)) {
              obj.schemaVersion = SCHEMA_VERSION;
              obj.readOnly = false;
              p = obj as Project;
              // Restore remote project ID so cloud sync upserts correctly after reload
              const storedRemoteId = localStorage.getItem(REMOTE_ID_KEY);
              if (storedRemoteId) {
                remoteProjectIdRef.current = storedRemoteId;
              }
            }
          }
        } catch { /* use demo */ }
      }

      // 3. Fall back to demo project
      if (!p) {
        p = defaultProject() as Project;
      }

      if (cancelled) return;

      prepareProject(p);
      hydrate(p);
      setIsHydrated(true);
    }

    loadProject();
    return () => { cancelled = true; };
  }, [hydrate, remoteProjectIdRef, isOfflineModeRef]);

  return (
    <>
      <MasterDataSidebar />
      <CanvasBoard />
    </>
  );
}

export function ClientApp() {
  return (
    <Provider>
      <AppContent />
    </Provider>
  );
}
