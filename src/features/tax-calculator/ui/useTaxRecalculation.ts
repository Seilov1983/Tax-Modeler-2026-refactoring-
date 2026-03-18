'use client';

import { useAtomValue } from 'jotai';
import { taxCalculationAtom } from '../model/atoms';
export function useTaxRecalculation() {
  return useAtomValue(taxCalculationAtom);
}
