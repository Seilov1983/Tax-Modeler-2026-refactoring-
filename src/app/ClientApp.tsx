'use client';

/**
 * Client-side application shell.
 *
 * Hydrates the Jotai store with project data and renders the canvas.
 * Wraps everything in a Jotai Provider for atom isolation.
 *
 * Persistence strategy (offline-first):
 *   1. On mount: try API fetch → fall back to localStorage → fall back to demo project
 *   2. On change: update localStorage immediately, debounce PUT to API (skipped in offline mode)
 *
 * Offline mode is activated when:
 *   - API returns 503 (database not configured / unreachable)
 *   - fetch throws (no server — Electron static bundle, file:// etc.)
 */

import { Provider, useSetAtom, useAtomValue } from 'jotai';
import { useEffect, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { projectAtom, hydrateProjectAtom } from '@features/canvas';
import { defaultProject } from '@entities/project';

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
const API_DEBOUNCE_MS = 2000;

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
  const project = useAtomValue(projectAtom);

  // Track the remote project ID (set after successful API load or creation)
  const remoteProjectIdRef = useRef<string | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isHydratedRef = useRef(false);

  /** Offline mode — set when API is unreachable (503, network error, Electron static) */
  const isOfflineModeRef = useRef(false);

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
          // Database not configured / unreachable — enter offline mode
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
                if (graph.schemaVersion === SCHEMA_VERSION) {
                  graph.readOnly = false;
                  p = graph;
                  remoteProjectIdRef.current = record.id;
                }
              }
            }
          }
        }
      } catch {
        // fetch threw — no server (Electron static bundle, file://, offline)
        isOfflineModeRef.current = true;
        console.info('[Tax-Modeler] API unreachable — offline mode activated. Data persists to localStorage.');
      }

      // 2. Fall back to localStorage (offline fallback)
      if (!p) {
        try {
          const raw = localStorage.getItem(STORAGE_KEY);
          if (raw) {
            const obj = JSON.parse(raw);
            if (obj.schemaVersion === SCHEMA_VERSION) {
              obj.readOnly = false;
              p = obj as Project;
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
      isHydratedRef.current = true;
      hydrate(p);
    }

    loadProject();
    return () => { cancelled = true; };
  }, [hydrate]);

  // ─── Debounced API flush (skipped in offline mode) ─────────────────────
  const flushToAPI = useCallback(async (proj: Project) => {
    // In offline mode, localStorage is the sole persistence — skip API calls
    if (isOfflineModeRef.current) return;

    try {
      if (remoteProjectIdRef.current) {
        // Update existing project
        const res = await fetch(`/api/projects/${remoteProjectIdRef.current}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: proj.title,
            schemaVersion: proj.schemaVersion,
            graphJSON: proj,
          }),
        });
        if (res.status === 503) {
          isOfflineModeRef.current = true;
          console.info('[Tax-Modeler] API returned 503 during save — switching to offline mode.');
        }
      } else {
        // Create new project
        const res = await fetch('/api/projects', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': 'local-user',
          },
          body: JSON.stringify({
            name: proj.title,
            schemaVersion: proj.schemaVersion,
            graphJSON: proj,
          }),
        });
        if (res.ok) {
          const created = await res.json();
          remoteProjectIdRef.current = created.id;
        } else if (res.status === 503) {
          isOfflineModeRef.current = true;
          console.info('[Tax-Modeler] API returned 503 during create — switching to offline mode.');
        }
      }
    } catch {
      // Network error — switch to offline mode silently
      isOfflineModeRef.current = true;
    }
  }, []);

  // ─── Persist on project change ──────────────────────────────────────────
  useEffect(() => {
    if (!project || !isHydratedRef.current) return;

    // 1. Immediate: localStorage (offline-first, zero latency)
    project.updatedAt = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project));

    // 2. Debounced: API flush (skipped in offline mode)
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      flushToAPI(project);
    }, API_DEBOUNCE_MS);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [project, flushToAPI]);

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
