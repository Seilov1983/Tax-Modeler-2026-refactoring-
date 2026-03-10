'use client';

/**
 * Client-side application shell.
 *
 * Hydrates the Jotai store with project data and renders the canvas.
 * Wraps everything in a Jotai Provider for atom isolation.
 */

import { Provider, useSetAtom, useAtomValue } from 'jotai';
import { useEffect } from 'react';
import { projectAtom } from '@features/canvas';
import { nodesAtom } from '@entities/node';
import { zonesAtom } from '@entities/zone';
import { flowsAtom } from '@entities/flow';
import { ownershipAtom } from '@entities/ownership';
import { taxEntriesAtom } from '@features/tax-calculator';
import { CanvasBoard } from '@widgets/canvas-board';
import { defaultProject } from '@entities/project/model/defaultData';
import {
  ensureMasterData, ensureZoneTaxDefaults,
  bootstrapNormalizeZones, recomputeRisks, recomputeFrozen,
} from '@shared/lib/engine';
import { SCHEMA_VERSION } from '@shared/lib/engine/engine-core';
import type { Project } from '@shared/types';

const STORAGE_KEY = 'tsm26_onefile_project_v2';

function AppContent() {
  const setProject = useSetAtom(projectAtom);
  const setNodes = useSetAtom(nodesAtom);
  const setZones = useSetAtom(zonesAtom);
  const setFlows = useSetAtom(flowsAtom);
  const setOwnership = useSetAtom(ownershipAtom);
  const setTaxEntries = useSetAtom(taxEntriesAtom);
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
    ensureZoneTaxDefaults(p);
    bootstrapNormalizeZones(p);
    recomputeFrozen(p);
    recomputeRisks(p);

    // Hydrate all atoms
    setProject(p);
    setNodes(p.nodes);
    setZones(p.zones);
    setFlows(p.flows);
    setOwnership(p.ownership);
    setTaxEntries(p.taxes);
  }, [setProject, setNodes, setZones, setFlows, setOwnership, setTaxEntries]);

  // Persist to localStorage on project change
  useEffect(() => {
    if (project) {
      project.updatedAt = new Date().toISOString();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
    }
  }, [project]);

  return <CanvasBoard />;
}

export function ClientApp() {
  return (
    <Provider>
      <AppContent />
    </Provider>
  );
}
