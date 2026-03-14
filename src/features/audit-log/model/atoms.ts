import { atom } from 'jotai';
import { projectAtom } from '@features/canvas/model/project-atom';
import { runPipeline } from '@shared/lib/engine/engine-accounting';
import { ensureMasterData, convert } from '@shared/lib/engine/engine-core';
import type { Project, TaxEntry } from '@shared/types';

const yieldTask = () => new Promise((resolve) => setTimeout(resolve, 0));

export interface LedgerRow {
  id: string;
  taxType: string;
  payerId: string;
  zoneId: string;
  flowId: string;
  amountFunctional: number;
  functionalCurrency: string;
  amountOriginal: number;
  originalCurrency: string;
  /** Amount converted to project baseCurrency for unified display. */
  amountBase: number;
  baseCurrency: string;
  fxDate: string;
  status: string;
}

export interface PipelineStepRow {
  name: string;
  status: string;
  details: string;
}

export interface AccountingLedger {
  entries: LedgerRow[];
  pipelineSteps: PipelineStepRow[];
  baseCurrency: string;
}

/**
 * Async derived atom: runs the accounting pipeline on a cloned project,
 * then exposes p.taxes as ledger rows + pipeline step summaries.
 *
 * All monetary amounts are converted to project.baseCurrency for unified display.
 */
export const accountingLedgerAtom = atom(async (get): Promise<AccountingLedger> => {
  const project = get(projectAtom);

  if (!project || !project.nodes || !project.flows) {
    return { entries: [], pipelineSteps: [], baseCurrency: 'USD' };
  }

  await yieldTask();

  const baseCurrency = project.baseCurrency || 'USD';

  // Deep clone — runPipeline mutates in place
  const p = JSON.parse(JSON.stringify(project)) as Project;
  ensureMasterData(p);
  const run = runPipeline(p, 'audit-ledger');

  // Map TaxEntry[] → LedgerRow[] with baseCurrency conversion
  const entries: LedgerRow[] = (p.taxes || []).map((t: TaxEntry) => ({
    id: t.id,
    taxType: t.taxType,
    payerId: t.payerId,
    zoneId: t.zoneId,
    flowId: t.dueFromFlowId,
    amountFunctional: t.amountFunctional,
    functionalCurrency: t.functionalCurrency,
    amountOriginal: t.amountOriginal,
    originalCurrency: t.originalCurrency,
    amountBase: convert(p, t.amountFunctional, t.functionalCurrency, baseCurrency),
    baseCurrency,
    fxDate: t.fxDate,
    status: t.status,
  }));

  // Pipeline step summaries
  const pipelineSteps: PipelineStepRow[] = ((run.steps || []) as Array<Record<string, unknown>>).map((s) => ({
    name: String(s.name || ''),
    status: String(s.status || ''),
    details: String(s.details || ''),
  }));

  return { entries, pipelineSteps, baseCurrency };
});
