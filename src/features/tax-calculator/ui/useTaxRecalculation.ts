'use client';

/**
 * Hook: State-Batching Tax Recalculation.
 *
 * Architectural pattern:
 * 1. All heavy math (Vanilla JS) executes IN MEMORY via recomputeAll()
 *    — no React/Jotai state is touched during computation.
 * 2. The engine returns the fully recomputed data as a plain object.
 * 3. We commit the results in a SINGLE batch update inside useTransition,
 *    so splitAtom only re-renders the cards that actually changed.
 *
 * This keeps the UI responsive: drag & drop, drawer, tabs — all stay at 60 FPS
 * while the pipeline runs in a non-blocking transition.
 */

import { useTransition, useCallback } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { projectAtom } from '@features/canvas/model';
import { nodesAtom } from '@entities/node';
import { flowsAtom } from '@entities/flow';
import { taxEntriesAtom, isRecalculatingAtom } from '../model/atoms';
import { recomputeAll } from '@shared/lib/engine';
import type { Project } from '@shared/types';

export function useTaxRecalculation() {
  const [isPending, startTransition] = useTransition();
  const project = useAtomValue(projectAtom);
  const setProject = useSetAtom(projectAtom);
  const setNodes = useSetAtom(nodesAtom);
  const setFlows = useSetAtom(flowsAtom);
  const setTaxEntries = useSetAtom(taxEntriesAtom);
  const setIsRecalculating = useSetAtom(isRecalculatingAtom);

  const recalculate = useCallback(
    (trigger?: string) => {
      if (!project) return;

      startTransition(() => {
        // 1. All heavy math runs IN MEMORY — no state mutations
        const result = recomputeAll(project, trigger);

        // 2. SINGLE BATCH COMMIT to state.
        //    Thanks to splitAtom, Jotai will only re-render the cards
        //    whose data actually changed — O(changed) not O(all).
        setProject(result.project);
        setNodes(result.nodes);
        setFlows(result.flows);
        setTaxEntries(result.taxes);
        setIsRecalculating(false);
      });

      setIsRecalculating(true);
    },
    [project, setProject, setNodes, setFlows, setTaxEntries, setIsRecalculating],
  );

  return { recalculate, isPending };
}
