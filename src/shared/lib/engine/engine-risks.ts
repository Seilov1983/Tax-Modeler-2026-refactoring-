/**
 * Risk Detection Engine — CFC, Substance, Pillar Two, Transfer Pricing.
 * Framework-agnostic: no React, no DOM.
 */

import { uid, bankersRound2, numOrNull, isoDate, nowIso } from './utils';
import { getZone, getNode, listPersons, listCompanies, convert } from './engine-core';
import {
  effectiveZoneTax,
  whtDefaultPercentForFlow,
  effectiveEtrForCompany,
  resolveMRP,
} from './engine-tax';
import type { Project, NodeDTO, FlowDTO, Zone, FlowType } from '@shared/types';

// ─── Frozen Threshold ────────────────────────────────────────────────────────

export function frozenThresholdFunctional(p: Project, node: NodeDTO): number | null {
  const z = getZone(p, node.zoneId);
  if (!z || z.jurisdiction !== 'KZ') return null;
  const m = (p.masterData as Record<string, Record<string, unknown>>).KZ;
  if (!m) return null;
  const mc = m.macroConstants as Record<string, number> | undefined;
  const thr = m.thresholds as Record<string, number> | undefined;
  const mci = numOrNull(mc?.mciValue || m.mciValue);
  const mult = numOrNull(thr?.frozenDebtMci || m.frozenDebtMci);
  if (mci == null || mult == null) return null;
  return mult * mci;
}

export function nodeDebtToTXA(p: Project, node: NodeDTO): number {
  if (!node.zoneId) return 0;
  return p.taxes
    .filter((t) => t.status === 'pending' && t.payerId === node.id && t.zoneId === node.zoneId)
    .reduce((s, t) => s + Number(t.amountFunctional || 0), 0);
}

export function recomputeFrozen(p: Project): void {
  p.nodes.forEach((n) => {
    if (n.type !== 'company') { n.frozen = false; return; }
    const thr = frozenThresholdFunctional(p, n);
    if (thr == null) { n.frozen = false; return; }
    const debt = nodeDebtToTXA(p, n);
    n.frozen = debt >= thr;
  });
}

export function canCreateOutgoing(p: Project, payerId: string): boolean {
  const payer = getNode(p, payerId);
  if (!payer) return false;
  if (payer.type !== 'company') return true;
  return !payer.frozen;
}

// ─── Control/Ownership ───────────────────────────────────────────────────────

export function computeControlFromPerson(p: Project, personId: string): Map<string, number> {
  const edges = p.ownership || [];
  const isCompany = (id: string) => getNode(p, id)?.type === 'company';

  const direct = new Map<string, number>();
  edges.forEach((e) => {
    if (e.fromId === personId && isCompany(e.toId)) {
      const frac = Math.max(0, Math.min(1, (Number(e.percent || 0) + Number(e.manualAdjustment || 0)) / 100));
      direct.set(e.toId, Math.max(direct.get(e.toId) || 0, frac));
    }
  });

  const control = new Map(direct);
  let changed = true, guard = 0;
  while (changed && guard < 50) {
    changed = false; guard++;
    edges.forEach((e) => {
      if (!isCompany(e.fromId) || !isCompany(e.toId)) return;
      const parentControl = control.get(e.fromId) || 0;
      const ownedFrac = Math.max(0, Math.min(1, (Number(e.percent || 0) + Number(e.manualAdjustment || 0)) / 100));
      // Pure proportional multiplication across edges (no majority control inflation)
      const via = parentControl * ownedFrac;
      if (via > (control.get(e.toId) || 0) + 1e-9) {
        control.set(e.toId, via);
        changed = true;
      }
    });
  }
  return control;
}

export function anyPersonControlsBoth(
  p: Project, aCompanyId: string, bCompanyId: string, threshold?: number,
): { personId: string; a: number; b: number } | null {
  const thr = Number(threshold || 0.25);
  for (const per of listPersons(p)) {
    const control = computeControlFromPerson(p, per.id);
    const a = control.get(aCompanyId) || 0;
    const b = control.get(bCompanyId) || 0;
    if (a >= thr && b >= thr) return { personId: per.id, a, b };
  }
  return null;
}

export function isRelatedParty(p: Project, aId: string, bId: string): boolean {
  if (!aId || !bId || aId === bId) return false;
  const thr = 0.25;
  for (const e of p.ownership || []) {
    const frac = Math.max(0, Math.min(1, (Number(e.percent || 0) + Number(e.manualAdjustment || 0)) / 100));
    if (frac < thr) continue;
    if ((e.fromId === aId && e.toId === bId) || (e.fromId === bId && e.toId === aId)) return true;
  }
  return !!anyPersonControlsBoth(p, aId, bId, thr);
}

// ─── Main Risk Computation ───────────────────────────────────────────────────

export function recomputeRisks(p: Project): void {
  p.projectRiskFlags = [];
  p.nodes.forEach((n) => {
    n.riskFlags = [];
    if (n.investments) n.investments.isInvestmentResident = false;
    if (n.statuses) n.statuses.isInvestmentResident = false;
  });

  // ── NO_JURISDICTION: flag nodes that are outside every zone ─────────────
  for (const n of p.nodes) {
    if (n.type === 'txa') continue;
    const z = getZone(p, n.zoneId);
    if (!z) {
      n.riskFlags.push({
        type: 'NO_JURISDICTION',
        severity: 'CRITICAL',
        message: 'ERROR_NO_JURISDICTION',
      });
    }
  }

  // ── CFC_RISK: indirect control ≥25% in foreign entity where ETR <10% ────
  // Income exemption: CFC income < 195 MRP (from Zod-validated kzRates)
  const kz = (p.masterData as Record<string, Record<string, unknown>>).KZ || {};
  const thr = kz.thresholds as Record<string, number> | undefined;
  const etrThr = numOrNull(thr?.cfcEtrThreshold || kz.cfcEtrThreshold) ?? 0.10;
  const ownThr = numOrNull(thr?.cfcOwnershipThreshold || kz.cfcOwnershipThreshold) ?? 0.25;
  const cfcIncomeExemptionMRP = 195;
  const fxDate = p.fx?.fxDate || '2026-01-01';
  const mrpValue = resolveMRP(fxDate);
  const cfcIncomeThrKZT = cfcIncomeExemptionMRP * mrpValue;

  {
    // Pre-compute net inflow per node from flows (for entities with no annualIncome set)
    const netInflowMap = new Map<string, number>();
    for (const f of p.flows) {
      const gross = Number(f.grossAmount || 0);
      if (gross <= 0) continue;
      const grossKZT = convert(p, gross, f.currency, 'KZT');
      netInflowMap.set(f.toId, (netInflowMap.get(f.toId) ?? 0) + grossKZT);
      netInflowMap.set(f.fromId, (netInflowMap.get(f.fromId) ?? 0) - grossKZT);
    }

    const persons = listPersons(p).filter((per) => (per.citizenship || []).includes('KZ'));
    persons.forEach((per) => {
      const control = computeControlFromPerson(p, per.id);
      listCompanies(p).forEach((co) => {
        const z = getZone(p, co.zoneId);
        if (!z || z.jurisdiction === 'KZ') return;
        const cf = control.get(co.id) || 0;
        if (cf < ownThr) return;
        // Use annualIncome if set; otherwise derive from flow net inflows (converted to KZT)
        let incomeKZT = Number(co.annualIncome || 0);
        if (incomeKZT <= 0) {
          incomeKZT = Math.max(0, netInflowMap.get(co.id) ?? 0);
        }
        // 195 MRP income exemption — entity under threshold is exempt from CFC rules
        if (incomeKZT <= cfcIncomeThrKZT) return;
        const etr = effectiveEtrForCompany(p, co);
        if (etr >= etrThr) return;
        // Safe Harbor: real economic substance exempts from CFC rules
        if (co.hasSubstance) return;
        co.riskFlags.push({ type: 'CFC_RISK', byPersonId: per.id, control: cf, incomeKZT, etr, incomeThrMRP: cfcIncomeExemptionMRP, mrpValue, lawRef: 'НК РК 2025 ст. 294, 297 (КИК)' });
        // hasSubstance === false → flag substance breach on the CFC entity
        co.riskFlags.push({ type: 'SUBSTANCE_BREACH', byPersonId: per.id, lawRef: 'НК РК 2025 ст. 294 п.4 (субстанция КИК)', message: 'ERROR_CFC_SUBSTANCE' });
      });
    });
  }

  // ── SUBSTANCE_BREACH: BVI and other offshore jurisdictions requiring substance ──
  const offshoreSubstanceJurisdictions = ['BVI', 'CAY', 'SEY', 'HK'];
  listCompanies(p).forEach((co) => {
    const z = getZone(p, co.zoneId);
    if (!z) return;
    const comp = co.complianceData;

    // BVI-specific substance check (detailed: relevant activity + employees + office)
    // BVI Economic Substance Act 2018 (amended 2023), sections 3-4
    if (z.jurisdiction === 'BVI' && comp?.bvi) {
      if (comp.bvi.relevantActivity && (Number(comp.bvi.employees || 0) <= 0 || !comp.bvi.office)) {
        co.riskFlags.push({ type: 'SUBSTANCE_BREACH', lawRef: 'BVI Economic Substance Act 2018 ss.3-4', penaltyUsd: 20000 });
      }
    }

    // Generic offshore substance check: any node in offshore jurisdiction without proven substance
    const offshoreSubstanceLawRefs: Record<string, string> = {
      BVI: 'BVI Economic Substance Act 2018 ss.3-4',
      CAY: 'Cayman International Tax Co-operation (ES) Act 2018 s.4',
      SEY: 'Seychelles Companies Act 2021 s.308A',
      HK: 'HK IRO s.14, FSIE regime (2023) s.15H-15T',
    };
    if (offshoreSubstanceJurisdictions.includes(z.jurisdiction) && !co.hasSubstance) {
      const alreadyFlagged = co.riskFlags.some(
        (r) => r.type === 'SUBSTANCE_BREACH' && (
          r.lawRef === 'BVI Economic Substance Act 2018 ss.3-4' ||
          r.lawRef?.startsWith('НК РК')
        ),
      );
      if (!alreadyFlagged) {
        co.riskFlags.push({
          type: 'SUBSTANCE_BREACH',
          lawRef: offshoreSubstanceLawRefs[z.jurisdiction] ?? `Substance requirement — ${z.jurisdiction}`,
          message: 'ERROR_OFFSHORE_SUBSTANCE',
        });
      }
    }

    // AIFC presence breach
    if (z.code === 'KZ_AIFC' && comp?.aifc) {
      if (comp.aifc.usesCITBenefit && !comp.aifc.cigaInZone) {
        co.riskFlags.push({ type: 'AIFC_PRESENCE_BREACH', lawRef: 'AIFC Tax Rules 2018, Rule 4.3 (CIGA presence)', effectiveCitRate: 0.20 });
      }
    }
  });

  // ── Pillar Two Exposure Risk (PILLAR2_TRIGGER) ────────────────────────────
  const rev = numOrNull(p.group?.consolidatedRevenueEur);
  const pillarTwoInScope = p.isPillarTwoScope || (rev != null && rev > 750_000_000);
  if (pillarTwoInScope) {
    const low: Array<{ companyId: string; etr: number }> = [];
    listCompanies(p).forEach((co) => {
      const etr = effectiveEtrForCompany(p, co);
      if (etr < 0.15) {
        low.push({ companyId: co.id, etr });
        co.riskFlags.push({ type: 'PILLAR2_LOW_ETR', lawRef: 'OECD GloBE Model Rules (2021) Art. 5.2', etr, minEtr: 0.15 });
      }
    });
    if (low.length) {
      p.projectRiskFlags.push({
        type: 'PILLAR2_TRIGGER', lawRef: 'OECD GloBE Model Rules (2021) Art. 2.1, 5.2',
        consolidatedRevenueEur: rev, isPillarTwoScope: !!p.isPillarTwoScope,
        minEtr: 0.15, affectedCount: low.length,
      });
    }
  }

  // ── CAPITAL_ANOMALY: outgoing flows exceed available capital after CIT ──
  {
    const companies = listCompanies(p);
    for (const co of companies) {
      const z = getZone(p, co.zoneId);
      if (!z) continue;
      let netIncoming = 0;
      let totalOutgoing = 0;
      for (const f of p.flows) {
        const gross = Number(f.grossAmount || 0);
        if (gross <= 0) continue;
        if (f.toId === co.id) {
          const payer = getNode(p, f.fromId);
          const payerZone = payer ? getZone(p, payer.zoneId) : null;
          let whtRate = 0;
          if (payerZone && payerZone.jurisdiction !== z.jurisdiction) {
            const payerZoneTax = effectiveZoneTax(p, payerZone);
            whtRate = whtDefaultPercentForFlow(payerZoneTax, f.flowType) / 100;
          }
          const wht = gross * whtRate;
          netIncoming += convert(p, gross - wht, f.currency, z.currency);
        }
        if (f.fromId === co.id) {
          totalOutgoing += convert(p, gross, f.currency, z.currency);
        }
      }
      if (netIncoming <= 0) continue;
      const explicitIncome = Number(co.annualIncome || 0);
      const income = explicitIncome > 0 ? explicitIncome : netIncoming;
      const etr = effectiveEtrForCompany(p, co);
      const estimatedCIT = Math.max(0, income) * etr;
      const available = income - estimatedCIT;
      if (totalOutgoing > available && totalOutgoing > 0) {
        co.riskFlags.push({
          type: 'CAPITAL_ANOMALY',
          available: bankersRound2(available),
          outgoing: bankersRound2(totalOutgoing),
          deficit: bankersRound2(totalOutgoing - available),
          lawRef: 'НК РК 2025 ст. 246 (достаточность капитала)',
          message: 'ERROR_CAPITAL_ANOMALY',
        });
      }
    }
  }

  // ── SUBSTANCE_EXPENSE_MISMATCH: income > 100x OPEX when substance claimed ──
  {
    for (const co of listCompanies(p)) {
      if (!co.hasSubstance) continue;
      const opex = co.substanceMetrics?.operationalExpenses ?? 0;
      if (opex <= 0) continue;
      let totalIncome = Number(co.annualIncome || 0);
      if (totalIncome <= 0) {
        for (const f of p.flows) {
          const gross = Number(f.grossAmount || 0);
          if (gross <= 0) continue;
          if (f.toId === co.id) totalIncome += convert(p, gross, f.currency, 'KZT');
          if (f.fromId === co.id) totalIncome -= convert(p, gross, f.currency, 'KZT');
        }
        totalIncome = Math.max(0, totalIncome);
      }
      if (totalIncome > opex * 100) {
        const ratio = bankersRound2(totalIncome / opex);
        co.riskFlags.push({
          type: 'SUBSTANCE_EXPENSE_MISMATCH',
          ratio,
          message: 'ERROR_SUBSTANCE_EXPENSE_MISMATCH',
        });
      }
    }
  }

  // ── TP_SCANNER: Related Party and HK Transit Checks ─────────────────────
  p.flows.forEach((f) => {
    if (['Goods', 'Equipment', 'Services', 'Royalties'].includes(f.flowType) && isRelatedParty(p, f.fromId, f.toId)) {
      const pZ = getZone(p, getNode(p, f.fromId)?.zoneId);
      const payeeZ = getZone(p, getNode(p, f.toId)?.zoneId);
      if (pZ && payeeZ && pZ.jurisdiction !== payeeZ.jurisdiction) {
        getNode(p, f.fromId)?.riskFlags.push({ type: 'TRANSFER_PRICING_RISK', lawRef: 'НК РК 2025 ст. 351-362 (ТЦО)', flowId: f.id });
      }
    }
  });

  listCompanies(p).forEach((co) => {
    const z = getZone(p, co.zoneId);
    if (!z || z.jurisdiction !== 'HK') return;
    let totalServiceOut = 0;
    p.flows.forEach((f) => {
      if (f.fromId === co.id && f.flowType === 'Services') {
        totalServiceOut += convert(p, Number(f.grossAmount || 0), f.currency, z.currency);
      }
    });
    const income = Number(co.annualIncome || 0);
    if (income > 0 && totalServiceOut > income * 0.3) {
      const ratio = bankersRound2((totalServiceOut / income) * 100);
      co.riskFlags.push({
        type: 'TRANSFER_PRICING_RISK', lawRef: 'HK IRO DIPN No. 46, s.16(1)',
        ratio,
        message: 'ERROR_HK_SERVICE_RATIO',
      });
    }
  });

  // ── TP_SCANNER: Arm's-Length Price Monitoring (OECD Guidelines) ────────
  p.flows.forEach((f) => {
    if (!isRelatedParty(p, f.fromId, f.toId)) return;
    
    // Check for "Aggressive Scaling" (e.g. Services priced low/high to shift profits)
    // Benchmarks: Services 10-15% margin, Goods variable.
    // For now, flagging if 'Services' flow is missing a proper dealTag or has abnormal taxAdjustments.
    if (f.flowType === 'Services') {
      const payer = getNode(p, f.fromId);
      const payee = getNode(p, f.toId);
      if (payer && payee && payer.zoneId !== payee.zoneId) {
        // Multi-jurisdictional service flow between related parties
        const hasRisk = (f.grossAmount > 1_000_000 && !f.dealTag);
        if (hasRisk) {
          f.compliance = f.compliance || { applicable: true, exceeded: false };
          f.compliance.exceeded = true;
          f.compliance.violationType = (f.compliance.violationType ? f.compliance.violationType + ' & ' : '') + 'TP_ARM_LENGTH_POTENTIAL_BREACH';
          payer.riskFlags.push({
            type: 'TRANSFER_PRICING_RISK',
            lawRef: 'OECD TP Guidelines 2022 Ch.I §1.33-1.35',
            message: 'ERROR_TP_ARM_LENGTH',
            flowId: f.id
          });
        }
      }
    }
  });
}

// ─── Cash Limit ──────────────────────────────────────────────────────────────

export function cashLimitApplicable(p: Project, flow: FlowDTO): boolean {
  const payer = getNode(p, flow.fromId);
  const payee = getNode(p, flow.toId);
  if (!payer || !payee || payer.type !== 'company' || payee.type !== 'company') return false;
  if (flow.paymentMethod !== 'cash' && Number(flow.cashComponentAmount || 0) <= 0) return false;
  return getZone(p, payer.zoneId)?.jurisdiction === 'KZ';
}

export function checkCashLimit(p: Project, flow: FlowDTO) {
  const payer = getNode(p, flow.fromId);
  if (!payer || !cashLimitApplicable(p, flow)) return { applicable: false };
  const z = getZone(p, payer.zoneId)!;
  const flowDate = flow.flowDate || p.fx?.fxDate || '2026-01-01';
  const mrp = resolveMRP(flowDate);
  const threshold = 1000 * mrp;
  const cashAmt = Number(flow.cashComponentAmount || 0);
  const cashCcy = flow.cashComponentCurrency || flow.currency;
  const cashFunctional = convert(p, cashAmt, cashCcy, z.currency);
  return {
    applicable: true, exceeded: cashFunctional > threshold,
    thresholdFunctional: threshold, cashAmountFunctional: bankersRound2(cashFunctional),
    fxDate: isoDate(flow.flowDate || p.fx.fxDate),
    fxRateUsed: bankersRound2(convert(p, 1, cashCcy, z.currency)),
    functionalCurrency: z.currency,
  };
}

// ─── Flow Draft & Compliance ─────────────────────────────────────────────────

export function makeFlowDraft(p: Project): FlowDTO {
  const f: FlowDTO = {
    id: 'f_' + uid(),
    fromId: p.nodes.find((n) => n.type === 'company')?.id || '',
    toId: p.nodes.find((n) => n.type === 'company' && n.name !== 'KZ Company')?.id || '',
    flowType: 'Services', currency: 'KZT', grossAmount: 1200000,
    paymentMethod: 'bank', cashComponentAmount: 0, cashComponentCurrency: 'KZT',
    whtRate: 0.0, status: 'pending',
    flowDate: new Date(p.fx.fxDate + 'T12:00:00Z').toISOString(),
    ack: { ackStatus: 'not_required', acknowledgedBy: null, acknowledgedAt: null, comment: '' },
    taxAdjustments: [], fxEvidence: null,
  };
  const payer = getNode(p, f.fromId);
  const z = payer ? getZone(p, payer.zoneId) : null;
  if (z && z.currency) {
    f.currency = z.currency;
    f.cashComponentCurrency = z.currency;
    f.whtRate = bankersRound2(whtDefaultPercentForFlow(effectiveZoneTax(p, z), f.flowType));
  }
  return f;
}

export function updateFlowCompliance(p: Project, flow: FlowDTO): void {
  const r = checkCashLimit(p, flow);
  let requiresAck = false;
  const violationTypes: string[] = [];
  flow.taxAdjustments = [];

  if (r.applicable && r.exceeded) {
    requiresAck = true;
    violationTypes.push('CASH_LIMIT_EXCEEDED');
    flow.fxEvidence = {
      fxDate: r.fxDate!, fxRateUsed: r.fxRateUsed!,
      cashAmountFunctional: r.cashAmountFunctional!,
      functionalCurrency: r.functionalCurrency!,
      thresholdFunctional: r.thresholdFunctional!,
    };
    const baseOriginal = Number(flow.cashComponentAmount || 0);
    const origCcy = flow.cashComponentCurrency || flow.currency;
    flow.taxAdjustments.push(
      { tax: 'CIT_DEDUCTION', effect: 'DISALLOW', baseAmountOriginal: baseOriginal, originalCurrency: origCcy, baseAmountFunctional: r.cashAmountFunctional!, functionalCurrency: r.functionalCurrency!, fxDate: r.fxDate!, fxRateUsed: r.fxRateUsed!, lawRefId: 'KZ_NK_2026_ART_286' },
      { tax: 'VAT_CREDIT', effect: 'DISALLOW', baseAmountOriginal: baseOriginal, originalCurrency: origCcy, baseAmountFunctional: r.cashAmountFunctional!, functionalCurrency: r.functionalCurrency!, fxDate: r.fxDate!, fxRateUsed: r.fxRateUsed!, lawRefId: 'KZ_NK_2026_ART_482' },
    );
  }

  if (['Goods', 'Equipment', 'Services'].includes(flow.flowType) && isRelatedParty(p, flow.fromId, flow.toId)) {
    const pZ = getZone(p, getNode(p, flow.fromId)?.zoneId);
    const payeeZ = getZone(p, getNode(p, flow.toId)?.zoneId);
    if (pZ && payeeZ && pZ.jurisdiction !== payeeZ.jurisdiction) {
      requiresAck = true;
      violationTypes.push('TRANSFER_PRICING_RISK');
    }
  }

  if (flow.flowType === 'Dividends') {
    const month = new Date(flow.flowDate || p.fx.fxDate).getMonth();
    if (![2, 3, 11].includes(month)) { requiresAck = true; violationTypes.push('INTERIM_DIVIDENDS_RISK'); }
    const payer = getNode(p, flow.fromId);
    if (payer) {
      const flowAmtKzt = convert(p, flow.grossAmount, flow.currency, 'KZT');
      const incKzt = Number(payer.annualIncome || 0);
      if (flowAmtKzt > incKzt && incKzt > 0) { requiresAck = true; violationTypes.push('CONSTRUCTIVE_DIVIDEND'); }
    }
  }

  if (!requiresAck) {
    flow.ack.ackStatus = 'not_required';
    if (!r.exceeded) flow.fxEvidence = null;
    flow.compliance = { applicable: r.applicable || flow.flowType === 'Dividends', exceeded: false };
  } else {
    flow.compliance = { applicable: true, exceeded: true, violationType: violationTypes.join(' & ') };
    flow.ack.ackStatus = flow.ack.ackStatus === 'acknowledged' ? 'acknowledged' : 'required';
  }

  const toNode = getNode(p, flow.toId);
  if (flow.isOffshoreSource && toNode) {
    toNode.riskFlags = toNode.riskFlags || [];
    const flags = [
      { type: 'FSIE_SUBSTANCE', lawRef: 'HK IRO s.15H-15T (FSIE substance test)' },
      { type: 'ADVANCE_RULING', lawRef: 'HK IRO s.88A (advance ruling)' },
      { type: 'SEPARATE_ACCOUNTING', lawRef: 'HK IRO s.15F (separate accounting requirement)' },
    ];
    flags.forEach((flag) => {
      if (!toNode.riskFlags.some((r) => r.type === flag.type)) {
        toNode.riskFlags.push(flag);
      }
    });
  }

  const fromNode = getNode(p, flow.fromId);
  if (flow.isDirectExemptExpense && fromNode) {
    fromNode.riskFlags = fromNode.riskFlags || [];
    if (!fromNode.riskFlags.some((r) => r.type === 'NON_DEDUCTIBLE_EXPENSE')) {
      fromNode.riskFlags.push({ type: 'NON_DEDUCTIBLE_EXPENSE', lawRef: 'НК РК 2025 ст. 264 (невычитаемые расходы)' });
    }
  }
}
