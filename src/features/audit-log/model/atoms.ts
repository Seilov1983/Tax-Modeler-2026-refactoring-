import { atom } from 'jotai';
import { projectAtom } from '@features/canvas/model/project-atom';
import { runPipeline } from '@shared/lib/engine/engine-accounting';
import { ensureMasterData } from '@shared/lib/engine/engine-core';
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
}

/**
 * Async derived atom: runs the accounting pipeline on a cloned project,
 * then exposes p.taxes as ledger rows + pipeline step summaries.
 */
export const accountingLedgerAtom = atom(async (get): Promise<AccountingLedger> => {
  const project = get(projectAtom);

  if (!project || !project.nodes || !project.flows) {
    return { entries: [], pipelineSteps: [] };
  }

  await yieldTask();

  // Deep clone — runPipeline mutates in place
  const p = JSON.parse(JSON.stringify(project)) as Project;
  ensureMasterData(p);
  const run = runPipeline(p, 'audit-ledger');

  // Map TaxEntry[] → LedgerRow[]
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
    fxDate: t.fxDate,
    status: t.status,
  }));

  // Pipeline step summaries
  const pipelineSteps: PipelineStepRow[] = ((run.steps || []) as Array<Record<string, unknown>>).map((s) => ({
    name: String(s.name || ''),
    status: String(s.status || ''),
    details: String(s.details || ''),
  }));

  return { entries, pipelineSteps };
});
