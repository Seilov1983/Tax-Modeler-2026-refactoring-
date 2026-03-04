import { uid, nowIso, bankersRound2, fmtMoney } from './utils.js';
import { getZone, listCompanies, convert, detectZoneId, defaultLawReferences } from './engine-core.js';
import { effectiveZoneTax, computeCITAmount } from './engine-tax.js';

export function yearOf(iso) { try { return new Date(iso).getUTCFullYear(); } catch(e) { return 2026; } }
export function ensurePeriods(p) { p.periods = p.periods || { closedYears: [] }; p.periods.closedYears = Array.isArray(p.periods.closedYears) ? p.periods.closedYears : []; }
export function isYearClosed(p, year) { ensurePeriods(p); return p.periods.closedYears.includes(Number(year)); }

export function ensureAccounting(p) { p.accounting = p.accounting || { years: {} }; p.accounting.years = p.accounting.years || {}; }
export function ensureAccountingYear(p, year) {
  ensureAccounting(p); const y = String(year);
  if (!p.accounting.years[y]) p.accounting.years[y] = { indirectExpensePoolKZT: 0, allocations: {}, lastComputedAt: null, lawReference: 'AFSA_CLOSED_PERIOD_2026' };
  return p.accounting.years[y];
}

export function pipelineStart(p, context) {
  p.pipeline = p.pipeline || { lastRunAt: null, lastRun: null, runs: [] };
  const run = { id: 'pl_' + uid(), startedAt: nowIso(), context: context || 'manual', steps: [] };
  p.pipeline.lastRunAt = run.startedAt; p.pipeline.lastRun = run;
  p.pipeline.runs = Array.isArray(p.pipeline.runs) ? p.pipeline.runs : [];
  p.pipeline.runs.unshift(run); p.pipeline.runs = p.pipeline.runs.slice(0, 50);
  return run;
}

export function pipelineStep(run, name, fn) {
  const step = { name, startedAt: nowIso(), finishedAt: null, status: 'ok', details: '' };
  try { const out = fn ? fn() : null; if (out && typeof out.details === 'string') step.details = out.details; }
  catch(e) { step.status = 'error'; step.details = String(e.message || e); }
  step.finishedAt = nowIso(); run.steps.push(step); return step;
}

export function detectJurisdictionAll(p) {
  p.nodes.forEach(n => { if (n.type !== 'txa') n.zoneId = detectZoneId(p, n); });
  return { details: 'nodes=' + p.nodes.filter(n=>n.type!=='txa').length };
}

export function separateAccountingAIFC(p, year) {
  const y = String(year), ay = ensureAccountingYear(p, y);
  let pool = Math.max(0, Number(ay.indirectExpensePoolKZT || 0)), groupIncome = 0, aifcPref = 0;
  const aifcCos = [];
  listCompanies(p).forEach(co => {
    co.accountingYears = co.accountingYears || {};
    const ci = co.accountingYears[y] || (co.accountingYears[y] = { totalIncomeKZT: 0, preferentialIncomeKZT: 0, allocatedIndirectKZT: 0 });
    const ti = Number(ci.totalIncomeKZT || 0); groupIncome += isFinite(ti) ? ti : 0;
    const z = getZone(p, co.zoneId);
    if (z && z.code === 'KZ_AIFC') { const pref = Number(ci.preferentialIncomeKZT || 0); aifcPref += isFinite(pref) ? pref : 0; aifcCos.push(co); }
  });
  const allocations = {}, allocToAifc = (groupIncome > 0 && aifcPref > 0) ? bankersRound2(pool * (aifcPref / groupIncome)) : 0;
  aifcCos.forEach(co => {
    const ci = co.accountingYears[y], pref = Number(ci.preferentialIncomeKZT || 0), share = aifcPref > 0 ? pref / aifcPref : 0;
    const amt = bankersRound2(allocToAifc * share);
    ci.allocatedIndirectKZT = amt; allocations[co.id] = { allocatedIndirectKZT: amt, share };
  });
  ay.allocations = allocations; ay.lastComputedAt = nowIso();
  return { details: `pool=${fmtMoney(pool)}; groupIncome=${fmtMoney(groupIncome)}; aifcPref=${fmtMoney(aifcPref)}; allocatedToAIFC=${fmtMoney(allocToAifc)}` };
}

export function recalculateEtrMvp(p, year) {
  let updated = 0;
  listCompanies(p).forEach(co => {
    const incomeKZT = Number(co.annualIncome || 0);
    if (!isFinite(incomeKZT) || incomeKZT <= 0) { co.computedEtr = null; co.computedCitKZT = 0; return; }
    let citAmountKZT = 0; const z = getZone(p, co.zoneId);
    if (z) {
      const tx = effectiveZoneTax(p, z), incomeFunctional = convert(p, incomeKZT, 'KZT', z.currency);
      let citFunctional = computeCITAmount(incomeFunctional, tx.cit);
      const aifc = co.complianceData?.aifc || co.compliance?.aifc;
      if (z.code === 'KZ_AIFC' && aifc?.usesCITBenefit && !aifc?.cigaInZone) citFunctional = incomeFunctional * 0.20;
      citAmountKZT = convert(p, citFunctional, z.currency, 'KZT');
    }
    const otherTaxesKZT = (p.taxes || []).filter(t=>t.payerId === co.id).reduce((s,t) => s + (convert(p, Number(t.amountOriginal||0), t.originalCurrency||t.functionalCurrency||'KZT', 'KZT')||0), 0);
    const etr = (citAmountKZT + otherTaxesKZT) / incomeKZT;
    co.computedEtr = isFinite(etr) ? Math.max(0, etr) : null; co.computedCitKZT = bankersRound2(citAmountKZT); updated++;
  });
  return { details: 'companies CIT calculated=' + updated };
}

export function runPipeline(p, context) {
  const year = yearOf(p.fx?.fxDate || nowIso()), run = pipelineStart(p, context || 'manual');
  pipelineStep(run, 'detectJurisdiction', () => detectJurisdictionAll(p));
  pipelineStep(run, 'Separate Accounting', () => separateAccountingAIFC(p, year));
  pipelineStep(run, 'Recalculate ETR', () => recalculateEtrMvp(p, year));
  return run;
}

export function createSnapshot(p, year) {
  p.snapshots = Array.isArray(p.snapshots) ? p.snapshots : [];
  const lr = (p.lawReferences || defaultLawReferences()), lawSet = Object.keys(lr).sort().map(k=>k+':' + (lr[k]?.version||'')).join('|');
  const snap = {
    id: 's_' + uid(), createdAt: nowIso(), periodYear: Number(year), schemaVersion: p.schemaVersion, engineVersion: p.engineVersion,
    lawReferenceSet: lawSet, lawReferences: JSON.parse(JSON.stringify(lr)),
    balances: p.nodes.map(n=>({ id:n.id, name:n.name, type:n.type, zoneId:n.zoneId, balances: n.balances || {}, ledger: n.ledger || null, annualIncome:n.annualIncome||0, etr:n.etr||0, computedEtr:n.computedEtr||null, complianceData:n.complianceData||n.compliance||null, investments:n.investments||null })),
    taxes: (p.taxes||[]).map(t=>({ id:t.id, dueFromFlowId:t.dueFromFlowId, payerId:t.payerId, zoneId:t.zoneId, taxType:t.taxType, amountFunctional:t.amountFunctional, functionalCurrency:t.functionalCurrency, amountOriginal:t.amountOriginal, originalCurrency:t.originalCurrency, fxDate:t.fxDate, status:t.status, meta:t.meta||{} })),
    projectRiskFlags: p.projectRiskFlags || []
  };
  p.snapshots.unshift(snap); p.snapshots = p.snapshots.slice(0, 50);
  return snap;
}
