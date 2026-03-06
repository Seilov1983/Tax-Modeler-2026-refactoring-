/**
 * Accounting Pipeline — multi-year ETR, AIFC separate accounting, snapshots.
 * Framework-agnostic: no React, no DOM.
 */

import { uid, nowIso, bankersRound2, fmtMoney } from './utils';
import { getZone, listCompanies, convert, detectZoneId, defaultLawReferences } from './engine-core';
import { effectiveZoneTax, computeCITAmount } from './engine-tax';
import type { Project, CITConfig } from '@shared/types';

// ─── Year Utilities ──────────────────────────────────────────────────────────

export function yearOf(iso: string): number {
  try { return new Date(iso).getUTCFullYear(); } catch { return 2026; }
}

export function ensurePeriods(p: Project): void {
  p.periods = p.periods || { closedYears: [] };
  p.periods.closedYears = Array.isArray(p.periods.closedYears) ? p.periods.closedYears : [];
}

export function isYearClosed(p: Project, year: number): boolean {
  ensurePeriods(p);
  return p.periods.closedYears.includes(Number(year));
}

// ─── Accounting Structures ───────────────────────────────────────────────────

export function ensureAccounting(p: Project): void {
  p.accounting = p.accounting || { years: {} };
  p.accounting.years = p.accounting.years || {};
}

export function ensureAccountingYear(p: Project, year: number | string) {
  ensureAccounting(p);
  const y = String(year);
  if (!p.accounting.years[y]) {
    p.accounting.years[y] = {
      indirectExpensePoolKZT: 0, allocations: {},
      lastComputedAt: null, lawReference: 'AFSA_CLOSED_PERIOD_2026',
    };
  }
  return p.accounting.years[y] as Record<string, unknown>;
}

// ─── Pipeline ────────────────────────────────────────────────────────────────

export function pipelineStart(p: Project, context?: string) {
  p.pipeline = p.pipeline || { lastRunAt: null, lastRun: null, runs: [] };
  const run = { id: 'pl_' + uid(), startedAt: nowIso(), context: context || 'manual', steps: [] as unknown[] };
  p.pipeline.lastRunAt = run.startedAt;
  p.pipeline.lastRun = run;
  p.pipeline.runs = Array.isArray(p.pipeline.runs) ? p.pipeline.runs : [];
  (p.pipeline.runs as unknown[]).unshift(run);
  p.pipeline.runs = (p.pipeline.runs as unknown[]).slice(0, 50);
  return run;
}

export function pipelineStep(
  run: { steps: unknown[] },
  name: string,
  fn?: () => { details?: string } | void,
) {
  const step: Record<string, unknown> = { name, startedAt: nowIso(), finishedAt: null, status: 'ok', details: '' };
  try {
    const out = fn?.();
    if (out && typeof out.details === 'string') step.details = out.details;
  } catch (e: unknown) {
    step.status = 'error';
    step.details = String((e as Error).message || e);
  }
  step.finishedAt = nowIso();
  run.steps.push(step);
  return step;
}

// ─── Jurisdiction Detection ──────────────────────────────────────────────────

export function detectJurisdictionAll(p: Project) {
  p.nodes.forEach((n) => { if (n.type !== 'txa') n.zoneId = detectZoneId(p, n); });
  return { details: 'nodes=' + p.nodes.filter((n) => n.type !== 'txa').length };
}

// ─── AIFC Separate Accounting ────────────────────────────────────────────────

export function separateAccountingAIFC(p: Project, year: number) {
  const y = String(year);
  const ay = ensureAccountingYear(p, y);
  let pool = Math.max(0, Number((ay as Record<string, unknown>).indirectExpensePoolKZT || 0));
  let groupIncome = 0, aifcPref = 0;
  const aifcCos: Array<{ node: typeof p.nodes[0]; ci: Record<string, unknown> }> = [];

  listCompanies(p).forEach((co) => {
    (co as Record<string, unknown>).accountingYears = (co as Record<string, unknown>).accountingYears || {};
    const accYears = (co as Record<string, unknown>).accountingYears as Record<string, Record<string, unknown>>;
    const ci = accYears[y] || (accYears[y] = { totalIncomeKZT: 0, preferentialIncomeKZT: 0, allocatedIndirectKZT: 0 });
    const ti = Number(ci.totalIncomeKZT || 0);
    groupIncome += isFinite(ti) ? ti : 0;
    const z = getZone(p, co.zoneId);
    if (z && z.code === 'KZ_AIFC') {
      const pref = Number(ci.preferentialIncomeKZT || 0);
      aifcPref += isFinite(pref) ? pref : 0;
      aifcCos.push({ node: co, ci });
    }
  });

  const allocations: Record<string, unknown> = {};
  const allocToAifc = groupIncome > 0 && aifcPref > 0 ? bankersRound2(pool * (aifcPref / groupIncome)) : 0;
  aifcCos.forEach(({ ci }) => {
    const pref = Number(ci.preferentialIncomeKZT || 0);
    const share = aifcPref > 0 ? pref / aifcPref : 0;
    const amt = bankersRound2(allocToAifc * share);
    ci.allocatedIndirectKZT = amt;
  });

  (ay as Record<string, unknown>).allocations = allocations;
  (ay as Record<string, unknown>).lastComputedAt = nowIso();
  return { details: `pool=${fmtMoney(pool)}; groupIncome=${fmtMoney(groupIncome)}; aifcPref=${fmtMoney(aifcPref)}; allocatedToAIFC=${fmtMoney(allocToAifc)}` };
}

// ─── ETR Recalculation ───────────────────────────────────────────────────────

export function recalculateEtrMvp(p: Project, year: number) {
  let updated = 0;
  listCompanies(p).forEach((co) => {
    const incomeKZT = Number(co.annualIncome || 0);
    if (!isFinite(incomeKZT) || incomeKZT <= 0) {
      co.computedEtr = null; co.computedCitKZT = 0; return;
    }
    let citAmountKZT = 0;
    const z = getZone(p, co.zoneId);
    if (z) {
      const tx = effectiveZoneTax(p, z);
      const incomeFunctional = convert(p, incomeKZT, 'KZT', z.currency);
      let citFunctional = computeCITAmount(incomeFunctional, tx.cit as CITConfig);
      const aifc = co.complianceData?.aifc;
      if (z.code === 'KZ_AIFC' && aifc?.usesCITBenefit && !aifc?.cigaInZone) {
        citFunctional = incomeFunctional * 0.20;
      }
      citAmountKZT = convert(p, citFunctional, z.currency, 'KZT');
    }
    const otherTaxesKZT = (p.taxes || [])
      .filter((t) => t.payerId === co.id)
      .reduce((s, t) => s + (convert(p, Number(t.amountOriginal || 0), t.originalCurrency || t.functionalCurrency || 'KZT', 'KZT') || 0), 0);
    const etr = (citAmountKZT + otherTaxesKZT) / incomeKZT;
    co.computedEtr = isFinite(etr) ? Math.max(0, etr) : null;
    co.computedCitKZT = bankersRound2(citAmountKZT);
    updated++;
  });
  return { details: 'companies CIT calculated=' + updated };
}

// ─── Run Pipeline ────────────────────────────────────────────────────────────

export function runPipeline(p: Project, context?: string) {
  const year = yearOf(p.fx?.fxDate || nowIso());
  const run = pipelineStart(p, context || 'manual');
  pipelineStep(run, 'detectJurisdiction', () => detectJurisdictionAll(p));
  pipelineStep(run, 'Separate Accounting', () => separateAccountingAIFC(p, year));
  pipelineStep(run, 'Recalculate ETR', () => recalculateEtrMvp(p, year));
  return run;
}

// ─── Snapshots ───────────────────────────────────────────────────────────────

export function createSnapshot(p: Project, year: number) {
  p.snapshots = Array.isArray(p.snapshots) ? p.snapshots : [];
  const lr = p.lawReferences || defaultLawReferences();
  const lawSet = Object.keys(lr).sort().map((k) => k + ':' + ((lr as Record<string, Record<string, string>>)[k]?.version || '')).join('|');
  const snap = {
    id: 's_' + uid(), createdAt: nowIso(), periodYear: Number(year),
    schemaVersion: p.schemaVersion, engineVersion: p.engineVersion,
    lawReferenceSet: lawSet, lawReferences: JSON.parse(JSON.stringify(lr)),
    balances: p.nodes.map((n) => ({
      id: n.id, name: n.name, type: n.type, zoneId: n.zoneId,
      balances: n.balances || {}, ledger: n.ledger || null,
      annualIncome: n.annualIncome || 0, etr: n.etr || 0,
      computedEtr: n.computedEtr || null,
      complianceData: n.complianceData || null,
      investments: n.investments || null,
    })),
    taxes: (p.taxes || []).map((t) => ({
      id: t.id, dueFromFlowId: t.dueFromFlowId, payerId: t.payerId,
      zoneId: t.zoneId, taxType: t.taxType,
      amountFunctional: t.amountFunctional, functionalCurrency: t.functionalCurrency,
      amountOriginal: t.amountOriginal, originalCurrency: t.originalCurrency,
      fxDate: t.fxDate, status: t.status, meta: t.meta || {},
    })),
    projectRiskFlags: p.projectRiskFlags || [],
  };
  (p.snapshots as unknown[]).unshift(snap);
  p.snapshots = (p.snapshots as unknown[]).slice(0, 50);
  return snap;
}
