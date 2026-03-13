'use client';

import { useAtomValue } from 'jotai';
import { taxCalculationAtom } from '../model/atoms';
import { useEffect } from 'react';

export function useTaxRecalculation() {
  // Subscribe to the async recalculation.
  // Since the atom is async, Jotai requires <Suspense> at the UI level,
  // or use loadable(taxCalculationAtom) for 'loading' state tracking.
  const taxResults = useAtomValue(taxCalculationAtom);

  useEffect(() => {
    if (taxResults) {
      console.log('[Tax Engine] Recalculation complete:', taxResults);
    }
  }, [taxResults]);

  return taxResults;
}
