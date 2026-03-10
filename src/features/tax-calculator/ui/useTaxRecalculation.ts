'use client';

/**
 * Hook: Async Task Yielding pattern for tax recalculation.
 *
 * Replaces useTransition with a yield-to-main-thread approach:
 * 1. Yields the main thread so React can flush pending renders (e.g. node
 *    repositioning after a drop) at 60 FPS.
 * 2. Runs heavy math (recomputeRisks, recomputeFrozen, runPipeline) after
 *    the browser has had a chance to paint.
 * 3. Commits the result via hydrateProjectAtom in a single batched Jotai
 *    write — no startTransition, no React 19 "large number of updates" warning.
 */

import { useState, useCallback } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { projectAtom, hydrateProjectAtom } from '@features/canvas/model';
import { isRecalculatingAtom } from '../model/atoms';
import { recomputeRisks, recomputeFrozen, runPipeline } from '@shared/lib/engine';
import type { Project } from '@shared/types';

export function useTaxRecalculation() {
  const [isPending, setIsPending] = useState(false);
  const project = useAtomValue(projectAtom);
  const hydrate = useSetAtom(hydrateProjectAtom);
  const setIsRecalculating = useSetAtom(isRecalculatingAtom);

  const recalculate = useCallback(
    async (context?: string) => {
      if (!project) return;

      setIsPending(true);
      setIsRecalculating(true);

      // 1. YIELD TO MAIN THREAD
      // This micro-pause lets React flush any pending renders (e.g. moving a
      // card after a drop) BEFORE we start heavy computation.
      await new Promise(resolve => setTimeout(resolve, 0));

      try {
        // 2. Deep clone to avoid mutation
        const p = JSON.parse(JSON.stringify(project)) as Project;

        // 3. Run the full computation pipeline IN MEMORY (no React updates)
        recomputeFrozen(p);
        recomputeRisks(p);
        runPipeline(p, context || 'user_action');

        // 4. Single batched commit — Jotai batches all set() calls inside
        //    the action atom into ONE React re-render cycle.
        //    No startTransition needed: splitAtom subscriptions update cleanly.
        hydrate(p);
      } finally {
        setIsRecalculating(false);
        setIsPending(false);
      }
    },
    [project, hydrate, setIsRecalculating],
  );

  return { recalculate, isPending };
}
