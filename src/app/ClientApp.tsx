'use client';

/**
 * Client-side application shell.
 *
 * Hydrates the Jotai store with project data and renders the canvas.
 * Wraps everything in a Jotai Provider for atom isolation.
 */

import { Provider, useSetAtom, useAtomValue } from 'jotai';
import { useEffect } from 'react';
import dynamic from 'next/dynamic';
import { projectAtom, hydrateProjectAtom } from '@features/canvas';
import { defaultProject } from '@entities/project';

/**
 * Konva requires browser APIs (canvas, window) that are unavailable during SSR.
 * next/dynamic with ssr:false ensures CanvasBoard is only loaded client-side,
 * preventing "ReferenceError: window is not defined" crashes in Next.js App Router.
 */
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

function AppContent() {
  const hydrate = useSetAtom(hydrateProjectAtom);
  const project = useAtomValue(projectAtom);

  useEffect(() => {
    // Hydrate from localStorage or create demo project
    let p: Project | null = null;
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

    if (!p) {
      p = defaultProject() as Project;
    }

    ensureMasterData(p);
    ensureCountriesAndRegimes(p);
    ensureZoneTaxDefaults(p);
    bootstrapNormalizeZones(p);
    recomputeFrozen(p);
    recomputeRisks(p);

    // Single batched commit to all entity atoms
    hydrate(p);
  }, [hydrate]);

  // Persist to localStorage on project change
  useEffect(() => {
    if (project) {
      project.updatedAt = new Date().toISOString();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
    }
  }, [project]);

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
