/**
 * Global summary atom — aggregates tax and risk data into executive metrics.
 *
 * ETR = (totalCIT + totalWHT) / totalIncome × 100
 *
 * All amounts are already in baseCurrency (converted inside taxCalculationAtom).
 */

import { atom } from 'jotai';
import { projectAtom } from '@features/canvas/model/project-atom';
import { taxCalculationAtom } from '@features/tax-calculator/model/atoms';
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
  const taxes = await get(taxCalculationAtom);
  const risks = await get(riskCalculationAtom);

  const empty: GlobalSummary = {
    totalIncome: 0, totalCit: 0, totalWht: 0, totalTax: 0,
    globalEtr: 0, totalRisks: 0, nodeCount: 0, flowCount: 0,
    baseCurrency: 'USD',
  };

  if (!project || !project.nodes) return empty;

  const baseCurrency = project.baseCurrency || 'USD';

  // Total pre-tax income from all company nodes
  const totalIncome = project.nodes.reduce(
    (sum, n) => sum + (n.type === 'company' ? Number(n.annualIncome || 0) : 0),
    0,
  );

  // Aggregate CIT and WHT (already converted to baseCurrency by taxCalculationAtom)
  const totalCit = taxes.cit.reduce((sum, t) => sum + (t.citAmount || 0), 0);
  const totalWht = taxes.wht.reduce((sum, t) => sum + (t.whtAmount || 0), 0);
  const totalTax = totalCit + totalWht;

  // Global ETR
  const globalEtr = totalIncome > 0 ? (totalTax / totalIncome) * 100 : 0;

  // Count risks
  const nodeRisksCount = Object.values(risks.nodeRisks).reduce(
    (sum, flags: RiskFlag[]) => sum + flags.length, 0,
  );
  const flowRisksCount = Object.values(risks.flowRisks).reduce(
    (sum, flags: RiskFlag[]) => sum + flags.length, 0,
  );

  return {
    totalIncome,
    totalCit,
    totalWht,
    totalTax,
    globalEtr,
    totalRisks: nodeRisksCount + flowRisksCount,
    nodeCount: project.nodes.filter((n) => n.type === 'company').length,
    flowCount: project.flows.length,
    baseCurrency,
  };
});
