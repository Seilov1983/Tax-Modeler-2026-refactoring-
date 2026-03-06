'use client';

/**
 * Hook: useTransition-based async tax recalculation.
 *
 * When the user drops a node (position committed to Jotai) or modifies a flow,
 * this hook runs recomputeRisks + runPipeline inside React 19's useTransition.
 *
 * This means the heavy math runs in the background without blocking:
 * - Drag & drop interactions
 * - Right Drawer opening/closing
 * - Tab switching
 */

import { useTransition, useCallback } from 'react';
import { useAtom, useSetAtom } from 'jotai';
import { projectAtom } from '@features/canvas/model';
import { nodesAtom } from '@entities/node';
import { flowsAtom } from '@entities/flow';
import { taxEntriesAtom, isRecalculatingAtom } from '../model/atoms';
import { recomputeRisks, recomputeFrozen, runPipeline } from '@shared/lib/engine';
import type { Project } from '@shared/types';

export function useTaxRecalculation() {
  const [isPending, startTransition] = useTransition();
  const [project, setProject] = useAtom(projectAtom);
  const setNodes = useSetAtom(nodesAtom);
  const setFlows = useSetAtom(flowsAtom);
  const setTaxEntries = useSetAtom(taxEntriesAtom);
  const setIsRecalculating = useSetAtom(isRecalculatingAtom);

  const recalculate = useCallback(
    (context?: string) => {
      if (!project) return;

      startTransition(() => {
        // Deep clone to avoid mutation during concurrent render
        const p = JSON.parse(JSON.stringify(project)) as Project;

        // Run the full computation pipeline
        recomputeFrozen(p);
        recomputeRisks(p);
        runPipeline(p, context || 'user_action');

        // Commit results back to atoms
        setProject(p);
        setNodes(p.nodes);
        setFlows(p.flows);
        setTaxEntries(p.taxes);
        setIsRecalculating(false);
      });

      setIsRecalculating(true);
    },
    [project, setProject, setNodes, setFlows, setTaxEntries, setIsRecalculating],
  );

  return { recalculate, isPending };
}
