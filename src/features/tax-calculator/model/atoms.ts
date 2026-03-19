import { atom } from 'jotai';
import { atomFamily } from 'jotai-family';
import type { TaxEntry, GroupTaxSummary, EntityCITLiability } from '@shared/types';
import { projectAtom } from '@features/canvas/model/project-atom';
import { computeWht, computeCITAmount, computeGroupTax } from '@shared/lib/engine/engine-tax';
import { effectiveZoneTax } from '@shared/lib/engine/engine-tax';
import { ensureMasterData, getZone, convert } from '@shared/lib/engine/engine-core';
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
    return { wht: [], cit: [], baseCurrency: 'USD' as const };
  }

  // Yield to main thread before heavy computation
  await yieldTask();

  // Deep clone to avoid mutation
  const p = JSON.parse(JSON.stringify(project)) as Project;
  ensureMasterData(p);

  const baseCurrency = project.baseCurrency || 'USD';

  const whtResults: Array<{ flowId: string; whtAmount: number; currency: string }> = [];
  const citResults: Array<{ nodeId: string; citAmount: number }> = [];

  // WHT pass — compute for applicable flow types, convert to baseCurrency
  for (const flow of p.flows) {
    if (['Dividends', 'Royalties', 'Interest', 'Services'].includes(flow.flowType)) {
      const wht = computeWht(p, flow);
      const rawAmount = wht.amountOriginal ?? wht.amount ?? 0;
      const rawCurrency = wht.currency ?? wht.originalCurrency ?? flow.currency;
      const convertedAmount = convert(p, rawAmount, rawCurrency, baseCurrency);
      whtResults.push({
        flowId: flow.id,
        whtAmount: convertedAmount,
        currency: baseCurrency,
      });
    }
  }

  // Yield before next heavy block
  await yieldTask();

  // CIT pass — compute for company nodes, convert to baseCurrency
  for (const node of p.nodes) {
    if (node.type === 'company') {
      const zone = getZone(p, node.zoneId);
      if (zone) {
        const zoneTax = effectiveZoneTax(p, zone);
        const income = Number(node.annualIncome || 0);
        const rawCit = computeCITAmount(income, zoneTax.cit);
        // CIT is computed in the zone's functional currency; derive it from masterData
        const jurisdictionCode = zone.jurisdiction || 'KZ';
        const mdEntry = p.masterData?.[jurisdictionCode];
        const localCurrency = mdEntry?.baseCurrency || 'KZT';
        const convertedCit = convert(p, rawCit, localCurrency, baseCurrency);
        citResults.push({ nodeId: node.id, citAmount: convertedCit });
      } else {
        // Node outside any zone — default tax rate is 0
        citResults.push({ nodeId: node.id, citAmount: 0 });
      }
    }
  }

  return {
    wht: whtResults,
    cit: citResults,
    baseCurrency,
    timestamp: Date.now(),
  };
});

// ─── Per-node CIT selector (O(1) subscription per node) ─────────────────────

export const nodeTaxAtomFamily = atomFamily((nodeId: string) =>
  atom(async (get) => {
    const taxResults = await get(taxCalculationAtom);
    const nodeTax = taxResults.cit.find((c) => c.nodeId === nodeId);
    return nodeTax ? nodeTax.citAmount : null;
  }),
);

// ─── Per-flow WHT selector (O(1) subscription per flow) ─────────────────────

export const flowTaxAtomFamily = atomFamily((flowId: string) =>
  atom(async (get) => {
    const taxResults = await get(taxCalculationAtom);
    const flowTax = taxResults.wht.find((f) => f.flowId === flowId);
    return flowTax ? flowTax.whtAmount : null;
  }),
);

// ─── Live Tax Summary (uses computeGroupTax — reactive bridge) ──────────────

const EMPTY_SUMMARY: GroupTaxSummary = {
  citLiabilities: [],
  whtLiabilities: [],
  totalCITBase: 0,
  totalWHTBase: 0,
  totalTaxBase: 0,
  totalIncomeBase: 0,
  totalEffectiveTaxRate: 0,
  baseCurrency: 'USD',
};

/**
 * Derived atom that reactively computes the consolidated GroupTaxSummary.
 * Re-evaluates whenever projectAtom changes (node edits, zone moves, flow updates).
 * Uses computeGroupTax — the pure engine function with full CIT mode support.
 */
export const liveTaxSummaryAtom = atom((get): GroupTaxSummary => {
  const project = get(projectAtom);
  if (!project || !project.nodes || !project.flows) return EMPTY_SUMMARY;
  return computeGroupTax(project);
});

/**
 * Per-node CIT selector — O(1) subscription per CanvasNode.
 * Returns the EntityCITLiability for a given nodeId, or null if not a company.
 * Only triggers re-render when THIS node's tax data changes.
 */
export const nodeLiveCITAtomFamily = atomFamily((nodeId: string) =>
  atom((get): EntityCITLiability | null => {
    const summary = get(liveTaxSummaryAtom);
    return summary.citLiabilities.find((c) => c.nodeId === nodeId) ?? null;
  }),
);
