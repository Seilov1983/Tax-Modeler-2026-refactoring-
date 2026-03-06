import { atom } from 'jotai';
import type { TaxEntry, RiskFlag } from '@shared/types';

export const taxEntriesAtom = atom<TaxEntry[]>([]);
export const isRecalculatingAtom = atom(false);

export const taxSummaryAtom = atom((get) => {
  const taxes = get(taxEntriesAtom);
  const pending = taxes.filter((t) => t.status === 'pending');
  const totalPending = pending.reduce((s, t) => s + t.amountFunctional, 0);
  return { totalEntries: taxes.length, pendingCount: pending.length, totalPending };
});
