import { atom } from 'jotai';
import type { TaxEntry } from '@shared/types';
import { projectAtom } from '@features/canvas/model/project-atom';
import { computeWht, computeCITAmount } from '@shared/lib/engine/engine-tax';
import { effectiveZoneTax } from '@shared/lib/engine/engine-tax';
import { ensureMasterData, getZone } from '@shared/lib/engine/engine-core';
import type { Project } from '@shared/types';

// ─── Existing atoms (backward compat) ────────────────────────────────────────

export const taxEntriesAtom = atom<TaxEntry[]>([]);
export const isRecalculatingAtom = atom(false);

export const taxSummaryAtom = atom((get) => {
  const taxes = get(taxEntriesAtom);
  const pending = taxes.filter((t) => t.status === 'pending');
  const totalPending = pending.reduce((s, t) => s + t.amountFunctional, 0);
  return { totalEntries: taxes.length, pendingCount: pending.length, totalPending };
});

// ─── Task Yielding helper ────────────────────────────────────────────────────

const yieldTask = () => new Promise((resolve) => setTimeout(resolve, 0));

// ─── Async derived atom for reactive tax recalculation ───────────────────────

export const taxCalculationAtom = atom(async (get) => {
  const project = get(projectAtom);

  if (!project || !project.nodes || !project.flows) {
    return { wht: [], cit: [], totals: {} };
  }

  // Yield to main thread before heavy computation
  await yieldTask();

  // Deep clone to avoid mutation
  const p = JSON.parse(JSON.stringify(project)) as Project;
  ensureMasterData(p);

  const whtResults: Array<{ flowId: string; whtAmount: number; currency: string }> = [];
  const citResults: Array<{ nodeId: string; citAmount: number }> = [];

  // WHT pass — compute for applicable flow types
  for (const flow of p.flows) {
    if (['Dividends', 'Royalties', 'Interest', 'Services'].includes(flow.flowType)) {
      const wht = computeWht(p, flow);
      whtResults.push({
        flowId: flow.id,
        whtAmount: wht.amountOriginal ?? wht.amount ?? 0,
        currency: wht.currency ?? wht.originalCurrency ?? flow.currency,
      });
    }
  }

  // Yield before next heavy block
  await yieldTask();

  // CIT pass — compute for company nodes
  for (const node of p.nodes) {
    if (node.type === 'company') {
      const zone = getZone(p, node.zoneId);
      if (zone) {
        const zoneTax = effectiveZoneTax(p, zone);
        const income = Number(node.annualIncome || 0);
        const cit = computeCITAmount(income, zoneTax.cit);
        citResults.push({ nodeId: node.id, citAmount: cit });
      }
    }
  }

  return {
    wht: whtResults,
    cit: citResults,
    timestamp: Date.now(),
  };
});
