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

import { Provider, useSetAtom, useAtomValue } from 'jotai';
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { hydrateProjectAtom, activeTabAtom } from '@features/canvas';
import { defaultProject } from '@entities/project';
import { useDebouncedCloudSync } from '@shared/hooks/useDebouncedCloudSync';
import { isSidebarOpenAtom } from '@features/master-data-sidebar';
import { copilotOpenAtom } from '@features/ai-copilot';
import { selectionAtom } from '@features/entity-editor';

const CanvasBoard = dynamic(
  () => import('@widgets/canvas-board').then((mod) => ({ default: mod.CanvasBoard })),
  { ssr: false },
);
const MasterDataSidebar = dynamic(
  () => import('@features/master-data-sidebar').then((mod) => ({ default: mod.MasterDataSidebar })),
  { ssr: false },
);
const ReportsBuilder = dynamic(
  () => import('@widgets/reports-builder').then((mod) => ({ default: mod.ReportsBuilder })),
  { ssr: false },
);
const AICopilotChat = dynamic(
  () => import('@features/ai-copilot').then((mod) => ({ default: mod.AICopilotChat })),
  { ssr: false },
);
const NodePropertiesDrawer = dynamic(
  () => import('@features/entity-editor').then((mod) => ({ default: mod.NodePropertiesDrawer })),
  { ssr: false },
);
const ProjectHeader = dynamic(
  () => import('@features/project-management').then((mod) => ({ default: mod.ProjectHeader })),
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

/**
 * Migrate legacy zone codes created by the old CanvasBoard drop handler.
 * Previously regimes dropped from the sidebar got `code: \`${countryId}_${regimeId}\``
 * producing double-prefixes like 'KZ_KZ_HUB'. Now regimeId IS the canonical code.
 */
function migrateZoneCodes(p: Project): void {
  const doublePrefix = /^([A-Z]+)_\1_/;
  for (const z of p.zones) {
    if (doublePrefix.test(z.code)) {
      // e.g. 'KZ_KZ_HUB' → 'KZ_HUB'
      z.code = z.code.replace(doublePrefix, '$1_');
    }
  }
}

/** Prepare a raw project object for use: ensure masterData, zones, risks, etc. */
function prepareProject(p: Project): Project {
  migrateZoneCodes(p);
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

  const activeTab = useAtomValue(activeTabAtom);
  const isSidebarOpen = useAtomValue(isSidebarOpenAtom);
  const isCopilotOpen = useAtomValue(copilotOpenAtom);
  const selection = useAtomValue(selectionAtom);
  const showPropertiesDrawer = activeTab !== 'reports' && selection?.type === 'node' && selection.ids.length === 1;

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-white dark:bg-slate-950">
      {/* ─── Top Bar (flex-none) ──────────────────────────────────────── */}
      <ProjectHeader />

      {/* ─── Middle working area (flex-1) ─────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar — docked flex sibling */}
        {isSidebarOpen && <MasterDataSidebar />}

        {/* Central content — fills remaining space */}
        <main className="flex-1 h-full relative overflow-hidden">
          {activeTab === 'reports' ? <ReportsBuilder /> : <CanvasBoard />}
        </main>

        {/* Right panels — docked flex siblings */}
        {showPropertiesDrawer && <NodePropertiesDrawer />}
        {isCopilotOpen && <AICopilotChat />}
      </div>
    </div>
  );
}

export function ClientApp() {
  return (
    <Provider>
      <AppContent />
    </Provider>
  );
}
