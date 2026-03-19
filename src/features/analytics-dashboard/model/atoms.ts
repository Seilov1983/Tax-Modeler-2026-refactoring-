/**
 * Global summary atom — aggregates tax and risk data into executive metrics.
 *
 * ETR = (totalCIT + totalWHT) / totalIncome × 100
 *
 * All amounts are already in baseCurrency (converted inside taxCalculationAtom).
 */

import { atom } from 'jotai';
import { projectAtom } from '@features/canvas/model/project-atom';
import { liveTaxSummaryAtom } from '@features/tax-calculator/model/atoms';
import { riskCalculationAtom } from '@features/risk-analyzer/model/atoms';
import type { RiskFlag } from '@shared/types';

export interface GlobalSummary {
  totalIncome: number;
  totalCit: number;
  totalWht: number;
  totalTax: number;
  globalEtr: number;
  totalRisks: number;
  nodeCount: number;
  flowCount: number;
  baseCurrency: string;
}

export const globalSummaryAtom = atom(async (get) => {
  const project = get(projectAtom);
  const summary = get(liveTaxSummaryAtom);
  const risks = await get(riskCalculationAtom);

  const empty: GlobalSummary = {
    totalIncome: 0, totalCit: 0, totalWht: 0, totalTax: 0,
    globalEtr: 0, totalRisks: 0, nodeCount: 0, flowCount: 0,
    baseCurrency: 'USD',
  };

  if (!project || !project.nodes) return empty;

  // Count risks
  const nodeRisksCount = Object.values(risks.nodeRisks).reduce(
    (sum, flags: RiskFlag[]) => sum + flags.length, 0,
  );
  const flowRisksCount = Object.values(risks.flowRisks).reduce(
    (sum, flags: RiskFlag[]) => sum + flags.length, 0,
  );

  return {
    totalIncome: summary.totalIncomeBase,
    totalCit: summary.totalCITBase,
    totalWht: summary.totalWHTBase,
    totalTax: summary.totalTaxBase,
    globalEtr: summary.totalEffectiveTaxRate * 100,
    totalRisks: nodeRisksCount + flowRisksCount,
    nodeCount: project.nodes.filter((n) => n.type === 'company').length,
    flowCount: project.flows.length,
    baseCurrency: summary.baseCurrency,
  };
});
