import { uid, bankersRound2, numOrNull, isoDate, formatMoney, nowIso } from './utils.js';
import { getZone, getNode, listPersons, listCompanies, convert } from './engine-core.js';
import { effectiveZoneTax, whtDefaultPercentForFlow, effectiveEtrForCompany } from './engine-tax.js';
import { auditAppend, save } from './state.js';
import { yearOf, isYearClosed } from './engine-accounting.js';

export function frozenThresholdFunctional(p, node) {
  const z = getZone(p, node.zoneId);
  if (!z || z.jurisdiction !== "KZ") return null;
  const m = p.masterData.KZ;
  if (!m) return null;
  const mci = numOrNull(m.macroConstants?.mciValue || m.mciValue), mult = numOrNull(m.thresholds?.frozenDebtMci || m.frozenDebtMci);
  if (mci == null || mult == null) return null;
  return mult * mci;
}

export function nodeDebtToTXA(p, node) {
  if (!node.zoneId) return 0;
  return p.taxes.filter(t => t.status === "pending" && t.payerId === node.id && t.zoneId === node.zoneId).reduce((s,t)=> s + Number(t.amountFunctional || 0), 0);
}

export function recomputeFrozen(p) {
  p.nodes.forEach(n => {
    if (n.type !== "company") { n.frozen = false; return; }
    const thr = frozenThresholdFunctional(p, n);
    if (thr == null) { n.frozen = false; return; }
    const debt = nodeDebtToTXA(p, n);
    n.frozen = debt >= thr;
  });
}

export function canCreateOutgoing(p, payerId) {
  const payer = getNode(p, payerId);
  if (!payer) return false;
  if (payer.type !== "company") return true;
  return !payer.frozen;
}

export function computeControlFromPerson(p, personId) {
  const edges = p.ownership || [];
  const isCompany = (id) => getNode(p,id)?.type==="company";
  const direct = new Map();
  edges.forEach(e => {
    if (e.fromId === personId && isCompany(e.toId)) {
      const frac = Math.max(0, Math.min(1, (Number(e.percent||0)+Number(e.manualAdjustment||0))/100));
      direct.set(e.toId, Math.max(direct.get(e.toId)||0, frac));
    }
  });
  const control = new Map(direct);
  let changed = true, guard = 0;
  while (changed && guard < 50) {
    changed = false; guard++;
    edges.forEach(e => {
      if (!isCompany(e.fromId) || !isCompany(e.toId)) return;
      const parentControl = control.get(e.fromId) || 0;
      const ownedFrac = Math.max(0, Math.min(1, (Number(e.percent||0)+Number(e.manualAdjustment||0))/100));
      let via = (parentControl > 0.5) ? (1.0 * ownedFrac) : (parentControl * ownedFrac);
      if (via > (control.get(e.toId) || 0) + 1e-9) { control.set(e.toId, via); changed = true; }
    });
  }
  return control;
}

export function anyPersonControlsBoth(p, aCompanyId, bCompanyId, threshold) {
  const thr = Number(threshold || 0.25);
  for (const per of listPersons(p)) {
    const control = computeControlFromPerson(p, per.id);
    const a = control.get(aCompanyId) || 0, b = control.get(bCompanyId) || 0;
    if (a >= thr && b >= thr) return { personId: per.id, a, b };
  }
  return null;
}

export function isRelatedParty(p, aId, bId) {
  if (!aId || !bId || aId === bId) return false;
  const thr = 0.25;
  for (const e of (p.ownership || [])) {
    const frac = Math.max(0, Math.min(1, (Number(e.percent||0)+Number(e.manualAdjustment||0))/100));
    if (frac < thr) continue;
    if ((e.fromId === aId && e.toId === bId) || (e.fromId === bId && e.toId === aId)) return true;
  }
  return !!anyPersonControlsBoth(p, aId, bId, thr);
}

export function recomputeRisks(p) {
  p.projectRiskFlags = [];
  p.nodes.forEach(n => {
    n.riskFlags = [];
    if (n.investments) n.investments.isInvestmentResident = false;
    if (n.statuses) n.statuses.isInvestmentResident = false;
  });

  const kz = p.masterData.KZ || {};
  const mci = numOrNull(kz.macroConstants?.mciValue || kz.mciValue);
  const incomeMult = numOrNull(kz.thresholds?.cfcIncomeMci || kz.cfcIncomeMci);
  const etrThr = numOrNull(kz.thresholds?.cfcEtrThreshold || kz.cfcEtrThreshold);
  const ownThr = numOrNull(kz.thresholds?.cfcOwnershipThreshold || kz.cfcOwnershipThreshold);
  const cfcEnabled = (mci != null && incomeMult != null && etrThr != null && ownThr != null);

  if (cfcEnabled) {
    const incomeThrKZT = incomeMult * mci;
    const persons = listPersons(p).filter(per => (per.citizenship||[]).includes('KZ'));
    persons.forEach(per => {
      const control = computeControlFromPerson(p, per.id);
      listCompanies(p).forEach(co => {
        const z = getZone(p, co.zoneId);
        if (!z || z.jurisdiction === 'KZ') return;
        const cf = control.get(co.id) || 0;
        if (cf < ownThr) return;
        const incomeKZT = Number(co.annualIncome || 0);
        if (incomeKZT <= incomeThrKZT) return;
        const etr = effectiveEtrForCompany(p, co);
        if (etr >= etrThr) return;
        co.riskFlags.push({ type:'CFC_RISK', byPersonId: per.id, control: cf, incomeKZT, etr, lawRef:'KZ_CFC_MVP' });
      });
    });
  }

  listCompanies(p).forEach(co => {
    const z = getZone(p, co.zoneId);
    if (!z) return;
    const comp = co.complianceData || co.compliance;
    if (z.jurisdiction === 'BVI' && comp?.bvi) {
      if (comp.bvi.relevantActivity && (Number(comp.bvi.employees || 0) <= 0 || !comp.bvi.office)) {
        co.riskFlags.push({ type:'SUBSTANCE_BREACH', lawRef:'APP_G_G1_BVI_SUBSTANCE', penaltyUsd: 20000 });
      }
    }
    if (z.code === 'KZ_AIFC' && comp?.aifc) {
      if (comp.aifc.usesCITBenefit && !comp.aifc.cigaInZone) {
        co.riskFlags.push({ type:'AIFC_PRESENCE_BREACH', lawRef:'APP_G_G4_AIFC_PRESENCE', effectiveCitRate: 0.20 });
      }
    }
  });

  const rev = numOrNull(p.group?.consolidatedRevenueEur);
  if (rev != null && rev > 750_000_000) {
    const low = [];
    listCompanies(p).forEach(co => {
      const etr = effectiveEtrForCompany(p, co);
      if (etr < 0.15) { low.push({ companyId: co.id, etr }); co.riskFlags.push({ type:'PILLAR2_LOW_ETR', lawRef:'APP_G_G5_PILLAR2', etr, minEtr:0.15 }); }
    });
    if (low.length) p.projectRiskFlags.push({ type:'PILLAR2_TOPUP_RISK', lawRef:'APP_G_G5_PILLAR2', consolidatedRevenueEur: rev, minEtr:0.15, affectedCount: low.length });
  }

  (p.flows || []).forEach(f => {
    if (["Goods", "Equipment", "Services"].includes(f.flowType) && isRelatedParty(p, f.fromId, f.toId)) {
      const pZ = getZone(p, getNode(p, f.fromId)?.zoneId), payeeZ = getZone(p, getNode(p, f.toId)?.zoneId);
      if (pZ && payeeZ && pZ.jurisdiction !== payeeZ.jurisdiction) {
        getNode(p, f.fromId)?.riskFlags.push({ type: 'TRANSFER_PRICING_RISK', lawRef: 'KZ_LAW_ON_TP', flowId: f.id });
      }
    }
  });
}

export function cashLimitApplicable(p, flow) {
  const payer = getNode(p, flow.fromId), payee = getNode(p, flow.toId);
  if (!payer || !payee || payer.type !== "company" || payee.type !== "company") return false;
  if (flow.paymentMethod !== "cash" && Number(flow.cashComponentAmount || 0) <= 0) return false;
  return getZone(p, payer.zoneId)?.jurisdiction === "KZ";
}

export function checkCashLimit(p, flow) {
  const payer = getNode(p, flow.fromId);
  if (!payer || !cashLimitApplicable(p, flow)) return { applicable:false };
  const z = getZone(p, payer.zoneId);
  const m = p.masterData.KZ || {};
  const mci = numOrNull(m.macroConstants?.mciValue || m.mciValue), mult = numOrNull(m.thresholds?.cashLimitMci || m.cashLimitMci);
  if (mci == null || mult == null) return { applicable:false };
  const threshold = mult * mci, cashAmt = Number(flow.cashComponentAmount || 0), cashCcy = flow.cashComponentCurrency || flow.currency;
  const cashFunctional = convert(p, cashAmt, cashCcy, z.currency);
  return { applicable:true, exceeded: cashFunctional > threshold, thresholdFunctional: threshold, cashAmountFunctional: bankersRound2(cashFunctional), fxDate: isoDate(flow.flowDate || p.fx.fxDate), fxRateUsed: bankersRound2(convert(p, 1, cashCcy, z.currency)), functionalCurrency: z.currency };
}

export function makeFlowDraft(p) {
  const f = {
    id: "f_" + uid(), fromId: p.nodes.find(n=>n.type==="company")?.id || "", toId: p.nodes.find(n=>n.type==="company" && n.name!=="KZ Company")?.id || "",
    flowType: "Services", currency: "KZT", grossAmount: 1200000, paymentMethod: "bank", cashComponentAmount: 0, cashComponentCurrency: "KZT",
    whtRate: 0.0, status: "pending", flowDate: new Date(p.fx.fxDate + "T12:00:00Z").toISOString(),
    ack: { ackStatus: "not_required", acknowledgedBy: null, acknowledgedAt: null, comment: "" }, taxAdjustments: [], fxEvidence: null
  };
  const payer = getNode(p, f.fromId), z = payer ? getZone(p, payer.zoneId) : null;
  if (z && z.currency) { f.currency = z.currency; f.cashComponentCurrency = z.currency; f.whtRate = bankersRound2(whtDefaultPercentForFlow(effectiveZoneTax(p, z), f.flowType)); }
  return f;
}

export function updateFlowCompliance(p, flow) {
  const r = checkCashLimit(p, flow);
  let requiresAck = false, violationTypes = [];
  flow.taxAdjustments = [];

  if (r.applicable && r.exceeded) {
    requiresAck = true; violationTypes.push("CASH_LIMIT_EXCEEDED");
    flow.fxEvidence = { fxDate: r.fxDate, fxRateUsed: r.fxRateUsed, cashAmountFunctional: r.cashAmountFunctional, functionalCurrency: r.functionalCurrency, thresholdFunctional: r.thresholdFunctional };
    const baseOriginal = Number(flow.cashComponentAmount || 0), origCcy = flow.cashComponentCurrency || flow.currency;
    flow.taxAdjustments.push(
      { tax: "CIT_DEDUCTION", effect: "DISALLOW", baseAmountOriginal: baseOriginal, originalCurrency: origCcy, baseAmountFunctional: r.cashAmountFunctional, functionalCurrency: r.functionalCurrency, fxDate: r.fxDate, fxRateUsed: r.fxRateUsed, lawRefId: "KZ_NK_2026_ART_286" },
      { tax: "VAT_CREDIT", effect: "DISALLOW", baseAmountOriginal: baseOriginal, originalCurrency: origCcy, baseAmountFunctional: r.cashAmountFunctional, functionalCurrency: r.functionalCurrency, fxDate: r.fxDate, fxRateUsed: r.fxRateUsed, lawRefId: "KZ_NK_2026_ART_482" }
    );
  }

  if (["Goods", "Equipment", "Services"].includes(flow.flowType) && isRelatedParty(p, flow.fromId, flow.toId)) {
    const pZ = getZone(p, getNode(p, flow.fromId)?.zoneId), payeeZ = getZone(p, getNode(p, flow.toId)?.zoneId);
    if (pZ && payeeZ && pZ.jurisdiction !== payeeZ.jurisdiction) { requiresAck = true; violationTypes.push("TRANSFER_PRICING_RISK"); }
  }

  if (flow.flowType === 'Dividends') {
    const month = new Date(flow.flowDate || p.fx.fxDate).getMonth();
    if (![2, 3, 11].includes(month)) { requiresAck = true; violationTypes.push("INTERIM_DIVIDENDS_RISK"); }
    const payer = getNode(p, flow.fromId);
    if (payer) {
      const flowAmtKzt = convert(p, flow.grossAmount, flow.currency, 'KZT'), incKzt = Number(payer.annualIncome || 0);
      if (flowAmtKzt > incKzt && incKzt > 0) { requiresAck = true; violationTypes.push("CONSTRUCTIVE_DIVIDEND"); }
    }
  }

  if (!requiresAck) {
    flow.ack.ackStatus = "not_required";
    if (!r.exceeded) flow.fxEvidence = null;
    flow.compliance = { applicable: r.applicable || flow.flowType === 'Dividends', exceeded: false };
  } else {
    flow.compliance = { applicable: true, exceeded: true, violationType: violationTypes.join(" & ") };
    flow.ack.ackStatus = (flow.ack.ackStatus === "acknowledged") ? "acknowledged" : "required";
  }

  // ── D-MACE: FSIE / Внетерриториальный доход (Гонконг, Сингапур и др.) ──
  const toNode = getNode(p, flow.toId);
  const fromNode = getNode(p, flow.fromId);

  if (flow.isOffshoreSource && toNode) {
    toNode.riskFlags = toNode.riskFlags || [];
    const r1 = "🚩 FSIE_SUBSTANCE: Требуется подтверждение substance для офшорного дохода.";
    const r2 = "🚩 ADVANCE_RULING: Рекомендуется получение Advance Ruling от налоговой.";
    const r3 = "🚩 SEPARATE_ACCOUNTING: Обязателен строгий раздельный учет доходов и прямых расходов.";
    if (!toNode.riskFlags.includes(r1)) toNode.riskFlags.push(r1);
    if (!toNode.riskFlags.includes(r2)) toNode.riskFlags.push(r2);
    if (!toNode.riskFlags.includes(r3)) toNode.riskFlags.push(r3);
  }

  // ── D-MACE: Невычетаемые расходы (Direct Exempt Expense) ──
  if (flow.isDirectExemptExpense && fromNode) {
    fromNode.riskFlags = fromNode.riskFlags || [];
    const rx = "⚠️ НЕДЕДУКТИВНЫЙ РАСХОД: Данный исходящий поток привязан к льготной деятельности и исключен из налоговых вычетов (КПН).";
    if (!fromNode.riskFlags.includes(rx)) fromNode.riskFlags.push(rx);
  }
}

export async function applyTaxAdjustment(project, nodeId, flowId, adjustmentData) {
  if (project.readOnly) throw new Error("System is in Read-Only mode.");
  const payer = getNode(project, nodeId), flow = project.flows.find(f => f.id === flowId);
  if (!payer || !flow) throw new Error("Node or Flow not found.");
  if (["DOMESTIC_EXEMPTION", "INVESTMENT_PREFERENCE_APPLIED"].includes(adjustmentData.reason) && payer.effectiveFrom && new Date(flow.flowDate) < new Date(payer.effectiveFrom)) {
    throw new Error("GUARD-RAIL VIOLATION: Retrospective application of exemptions prohibited.");
  }
  if (adjustmentData.reason === "RECHARACTERIZATION") {
    const beforeFlow = JSON.parse(JSON.stringify(flow));
    project.taxes.filter(t => t.dueFromFlowId === flowId && t.status === "pending").forEach(t => { t.status = "written_off"; t.amountFunctional = 0; });
    const oldType = flow.flowType; flow.flowType = adjustmentData.newFlowType || oldType;
    await auditAppend(project, "FLOW_UPDATE", { entityType: "FLOW", entityId: flow.id }, beforeFlow, flow, { note: `RECHARACTERIZATION: ${oldType} to ${flow.flowType}.`, lawRefId: adjustmentData.lawRefId });
    save(); return;
  }
  const tax = project.taxes.find(t => t.dueFromFlowId === flowId && t.taxType.includes(adjustmentData.taxType) && t.status === "pending");
  if (!tax) throw new Error(`Pending ${adjustmentData.taxType} tax not found.`);
  const beforeTax = JSON.parse(JSON.stringify(tax));
  let amountToAdjust = Math.min(Number(adjustmentData.amountFunctional || tax.amountFunctional), tax.amountFunctional);

  if (["EXEMPT", "WRITE_OFF"].includes(adjustmentData.effect)) { tax.amountFunctional = 0; tax.status = adjustmentData.effect === "WRITE_OFF" ? "written_off" : "exempted"; }
  else if (adjustmentData.effect === "OFFSET") { tax.amountFunctional = bankersRound2(tax.amountFunctional - amountToAdjust); tax.status = tax.amountFunctional <= 0 ? "offset_cleared" : "partially_offset"; }
  else if (["REDUCE", "DISALLOW"].includes(adjustmentData.effect)) { tax.amountFunctional = bankersRound2(tax.amountFunctional - amountToAdjust); if (tax.amountFunctional <= 0) tax.status = "cleared"; }

  tax.adjustments = tax.adjustments || [];
  tax.adjustments.push({ ...adjustmentData, adjustedAmount: amountToAdjust, appliedAt: nowIso(), appliedBy: project.userId });
  await auditAppend(project, "TAX_ADJUSTMENT", { entityType: "TAX", entityId: tax.id }, beforeTax, tax, { note: `Tax Adjustment: ${adjustmentData.effect}`, adjustmentDetail: adjustmentData });
  recomputeFrozen(project); save();
}
