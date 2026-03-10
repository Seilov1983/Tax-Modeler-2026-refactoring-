'use client';

/**
 * Hook: useTransition-based async tax recalculation.
 *
 * When the user drops a node (position committed to Jotai) or modifies a flow,
 * this hook runs recomputeRisks + runPipeline inside React 19's useTransition.
 *
 * All heavy math runs in memory first, then commits to Jotai in a single
 * batched write via hydrateProjectAtom — avoiding the React 19 warning
 * "Detected a large number of updates inside startTransition".
 */

import { useTransition, useCallback } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { projectAtom, hydrateProjectAtom } from '@features/canvas/model';
import { isRecalculatingAtom } from '../model/atoms';
import { recomputeRisks, recomputeFrozen, runPipeline } from '@shared/lib/engine';
import type { Project } from '@shared/types';

export function useTaxRecalculation() {
  const [isPending, startTransition] = useTransition();
  const project = useAtomValue(projectAtom);
  const hydrate = useSetAtom(hydrateProjectAtom);
  const setIsRecalculating = useSetAtom(isRecalculatingAtom);

  const recalculate = useCallback(
    (context?: string) => {
      if (!project) return;

      setIsRecalculating(true);

      startTransition(() => {
        // 1. Deep clone to avoid mutation during concurrent render
        const p = JSON.parse(JSON.stringify(project)) as Project;

        // 2. Run the full computation pipeline IN MEMORY (no React updates)
        recomputeFrozen(p);
        recomputeRisks(p);
        runPipeline(p, context || 'user_action');

        // 3. Single batched commit — Jotai batches all set() calls inside
        //    the action atom into ONE React re-render cycle
        hydrate(p);
        setIsRecalculating(false);
      });
    },
    [project, hydrate, setIsRecalculating],
  );

  return { recalculate, isPending };
}
