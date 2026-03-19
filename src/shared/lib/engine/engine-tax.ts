/**
 * Tax Calculation Engine — fully "blind" to jurisdictions.
 *
 * All zone-specific logic is read from the declarative zone-rules.json
 * (Law-as-Code). The AI Legal Parser can update the JSON when legislation
 * changes — no JS/TS code changes required.
 */

import { deepMerge, bankersRound2, numOrNull, isoDate } from './utils';
import { convert, getZone, getNode, buildComputationGraph } from './engine-core';
import zoneRulesData from '@shared/config/zone-rules.json';
import type {
  Project, Zone, FlowDTO, NodeDTO, CITConfig, FlowType,
  PayrollResult, PayrollBreakdownItem, WHTResult, WHTExemptionRule,
  GroupTaxSummary, EntityCITLiability, FlowWHTLiability,
  CurrencyCode, JurisdictionCode,
} from '@shared/types';

// ─── Zone Rules Registry ────────────────────────────────────────────────────

interface ZoneOverrideEntry {
  jurisdiction: string;
  taxOverride: Record<string, unknown>;
  lawRef: string;
  effectiveFrom: string;
}

interface ZoneRules {
  zoneOverrides: Record<string, ZoneOverrideEntry>;
  whtExemptionRules: WHTExemptionRule[];
  aifcPresenceRule: {
    zoneCode: string;
    condition: string;
    fallbackCitRate: number;
    lawRef: string;
  };
}

const zoneRules: ZoneRules = zoneRulesData as unknown as ZoneRules;

// ─── defaultZoneTax (now data-driven) ────────────────────────────────────────

export function defaultZoneTax(p: Project, zone: Zone) {
  const md = p.masterData?.[zone.jurisdiction] ?? {};
  const mdAny = md as Record<string, unknown>;

  const base = {
    vatRate: Number((mdAny.vatRateStandard as number) || 0),
    cit: mdAny.cit
      ? deepMerge(mdAny.cit as CITConfig, {} as Partial<CITConfig>)
      : ({ mode: 'flat', rate: Number((mdAny.citRateStandard as number) || 0) } as CITConfig),
    wht: deepMerge(
      (mdAny.wht as Record<string, number>) || { dividends: 0, interest: 0, royalties: 0, services: 0 },
      {},
    ),
    payroll: deepMerge((mdAny.payroll as Record<string, unknown>) || {}, {}),
    notes: '',
  };

  // Apply zone-specific overrides from declarative JSON (replaces all hardcoded if-statements)
  const override = zoneRules.zoneOverrides[zone.code];
  if (override) {
    const ov = override.taxOverride;
    if (ov.vatRate !== undefined) base.vatRate = ov.vatRate as number;
    if (ov.cit) base.cit = ov.cit as CITConfig;
    if (ov.wht) base.wht = deepMerge(base.wht, ov.wht as Record<string, number>);
    if (ov.payroll) base.payroll = deepMerge(base.payroll, ov.payroll as Record<string, unknown>);
  }

  return base;
}

// ─── ensureZoneTaxDefaults ───────────────────────────────────────────────────

export function ensureZoneTaxDefaults(p: Project): void {
  if (!p || !Array.isArray(p.zones)) return;
  p.zones.forEach((z) => {
    z.tax = z.tax || {};
  });
}

// ─── effectiveZoneTax ────────────────────────────────────────────────────────

export function effectiveZoneTax(p: Project, zone: Zone) {
  return deepMerge(defaultZoneTax(p, zone), (zone?.tax ?? {}) as Partial<ReturnType<typeof defaultZoneTax>>);
}

// ─── WHT Percentage Lookup ───────────────────────────────────────────────────

export function whtDefaultPercentForFlow(
  zoneTax: ReturnType<typeof effectiveZoneTax>,
  flowType: FlowType | string,
): number {
  if (!zoneTax || !flowType) return 0;
  const t = String(flowType);
  const wht = zoneTax.wht as Record<string, number>;
  if (t === 'Dividends') return Number(wht?.dividends || 0) * 100;
  if (t === 'Interest') return Number(wht?.interest || 0) * 100;
  if (t === 'Royalties') return Number(wht?.royalties || 0) * 100;
  if (t === 'Services') return Number(wht?.services || 0) * 100;
  return 0;
}

// ─── Payroll Computation ─────────────────────────────────────────────────────

export function computePayroll(p: Project, flow: FlowDTO, payerZone: Zone | null): PayrollResult {
  const gross = Number(flow.grossAmount || 0);
  if (!payerZone) return { total: 0, breakdown: [] };
  const tx = effectiveZoneTax(p, payerZone);
  const pr = (tx.payroll || {}) as Record<string, number>;
  const j = payerZone.jurisdiction;
  const md = (p.masterData?.[j] ?? {}) as Record<string, unknown>;
  const mw = numOrNull(md.minWage);

  const capBase = (mult: number | undefined) => {
    const m = numOrNull(mult);
    if (mw == null || m == null || m <= 0) return gross;
    return Math.min(gross, mw * m);
  };

  const baseMedicalEmployer = capBase(pr.medicalEmployerMaxBaseMW || 40);
  const baseMedicalEmployee = capBase(pr.medicalEmployeeMaxBaseMW || 20);
  const baseSocialContrib = capBase(pr.socialContribMaxBaseMW || 7);

  const parts: PayrollBreakdownItem[] = [];
  const add = (code: string, rate: number | undefined, base: number) => {
    const r = Number(rate || 0);
    if (r <= 0) return;
    const amt = bankersRound2(Number(base || gross) * r);
    if (amt > 0) parts.push({ code, rate: r, base: Number(base || gross), amount: amt });
  };

  add('PIT', pr.pitRate, gross);
  add('PENSION_EMPLOYEE', pr.pensionEmployeeRate, gross);
  add('MEDICAL_EMPLOYEE', pr.medicalEmployeeRate, baseMedicalEmployee);
  add('SOCIAL_CONTRIB', pr.socialContribRate, baseSocialContrib);
  add('SOCIAL_TAX_EMPLOYER', pr.socialTaxEmployerRate, gross);
  add('MEDICAL_EMPLOYER', pr.medicalEmployerRate, baseMedicalEmployer);
  add('PENSION_EMPLOYER', pr.pensionEmployerRate, gross);

  const total = bankersRound2(parts.reduce((s, item) => s + item.amount, 0));
  return { total, breakdown: parts };
}

// ─── CIT Computation ─────────────────────────────────────────────────────────

export function computeCITAmount(income: number, cit: CITConfig): number {
  if (!cit || !income || income <= 0) return 0;
  const mode = cit.mode || 'flat';
  let tax = 0;

  if (mode === 'flat') {
    tax = income * (cit.rate || 0);
  } else if (mode === 'threshold') {
    const zeroUpTo = Number(cit.zeroUpTo || 0);
    if (income > zeroUpTo) tax = (income - zeroUpTo) * (cit.mainRate || 0);
  } else if (mode === 'twoTier') {
    const smallLimit = Number(cit.smallLimit || 0);
    if (income <= smallLimit) tax = income * (cit.smallRate || 0);
    else tax = smallLimit * (cit.smallRate || 0) + (income - smallLimit) * (cit.mainRate || 0);
  } else if (mode === 'qfzp') {
    tax = income * (cit.qualifyingRate || 0);
  } else if (mode === 'brackets') {
    const b1 = cit.brackets?.[0] || { upTo: 0, rate: 0 };
    const b2 = cit.brackets?.[1] || { rate: 0 };
    if (income <= (b1.upTo || 0)) tax = income * (b1.rate || 0);
    else tax = (b1.upTo || 0) * (b1.rate || 0) + (income - (b1.upTo || 0)) * (b2.rate || 0);
  } else if (mode === 'smallProfits') {
    const sl = Number(cit.smallLimit || 0);
    const ml = Number(cit.mainLimit || 0);
    if (income <= sl) tax = income * (cit.smallRate || 0);
    else if (income >= ml) tax = income * (cit.mainRate || 0);
    else {
      const smallTax = sl * (cit.smallRate || 0);
      const remainingIncome = income - sl;
      const marginalRate = (ml * (cit.mainRate || 0) - smallTax) / (ml - sl);
      tax = smallTax + remainingIncome * marginalRate;
    }
  }

  return bankersRound2(tax);
}

// ─── WHT Computation (data-driven exemptions) ───────────────────────────────

export function computeWht(p: Project, flow: FlowDTO, overrideRatePercent?: number | null): WHTResult {
  const payer = getNode(p, flow.fromId);
  const payee = getNode(p, flow.toId);
  if (!payer) return { amount: 0, currency: flow.currency };

  const zPayer = getZone(p, payer.zoneId);
  const zPayee = payee ? getZone(p, payee.zoneId) : null;
  let rate =
    overrideRatePercent === undefined || overrideRatePercent === null
      ? Number(flow.whtRate || 0)
      : Number(overrideRatePercent || 0);
  let appliedLawRef: string | null = null;

  // Apply WHT exemption rules from declarative JSON (replaces hardcoded if-chains)
  for (const rule of zoneRules.whtExemptionRules) {
    const match = rule.match;
    let matched = false;

    if (match.flowTypes && match.flowTypes.includes(flow.flowType as FlowType)) {
      matched = true;
    }
    if (match.sameJurisdiction && zPayer && zPayee && zPayer.jurisdiction === zPayee.jurisdiction) {
      matched = true;
    }

    if (matched) {
      rate = rule.effect.rate;
      appliedLawRef = rule.effect.lawRef;
      break;
    }
  }

  const gross = Number(flow.grossAmount || 0);
  const whtOrig = bankersRound2(gross * (rate / 100));
  const whtFunctional = bankersRound2(
    convert(p, whtOrig, flow.currency, zPayer ? zPayer.currency : flow.currency),
  );

  return {
    amountOriginal: whtOrig,
    originalCurrency: flow.currency,
    amountFunctional: whtFunctional,
    functionalCurrency: zPayer ? zPayer.currency : flow.currency,
    fxDate: isoDate(flow.flowDate || p.fx.fxDate),
    fxRateUsed: bankersRound2(convert(p, 1, flow.currency, zPayer ? zPayer.currency : flow.currency)),
    appliedLawRef,
  };
}

// ─── Effective ETR (data-driven AIFC rule) ───────────────────────────────────

export function effectiveEtrForCompany(p: Project, co: NodeDTO): number {
  const v = Number(co?.etr);
  if (isFinite(v) && v >= 0) {
    const z0 = getZone(p, co?.zoneId);
    const aifc = co?.complianceData?.aifc;

    // Apply AIFC presence rule from declarative JSON
    const aifcRule = zoneRules.aifcPresenceRule;
    if (z0 && z0.code === aifcRule.zoneCode && aifc && aifc.usesCITBenefit && !aifc.cigaInZone) {
      return Math.max(v, aifcRule.fallbackCitRate);
    }

    return v;
  }

  const z = getZone(p, co?.zoneId);
  if (!z) return 0;
  const tx = effectiveZoneTax(p, z);
  if (tx?.cit?.mode === 'flat') return Number((tx.cit as CITConfig).rate || 0);
  const md = (p.masterData?.[z.jurisdiction] ?? {}) as Record<string, unknown>;
  const cit = numOrNull(md.citRateStandard);
  return cit == null ? 0 : cit;
}

// ─── Consolidated Group Tax Computation ───────────────────────────────────────

/**
 * computeGroupTax — pure function that produces a consolidated tax summary
 * for the entire project graph.
 *
 * Strategy:
 * 1. Build the ComputationGraph to get pre-resolved effective tax rates
 *    for every node (Country → Regime → ZoneOverride inheritance chain).
 * 2. For each Company node: compute CIT = annualIncome × effective CIT rate,
 *    using the full CITConfig (flat/threshold/twoTier/qfzp/brackets/smallProfits).
 * 3. For each Flow: compute WHT using domestic rates from the payer's zone.
 *    (Bilateral treaty matrix is deferred — uses domestic fallback for now.)
 * 4. Convert all amounts to the project's base currency and aggregate.
 * 5. Derive the group-level ETR = totalTax / totalIncome.
 */
export function computeGroupTax(project: Project): GroupTaxSummary {
  const baseCurrency = project.baseCurrency;
  const graph = buildComputationGraph(project);

  // ── 1. CIT liabilities (company nodes only) ────────────────────────────────
  const citLiabilities: EntityCITLiability[] = [];

  for (const cn of graph.nodes) {
    const node = cn.node;
    if (node.type !== 'company') continue;

    const income = Number(node.annualIncome || 0);
    const zone = node.zoneId ? project.zones.find((z) => z.id === node.zoneId) ?? null : null;
    const jurisdiction = zone?.jurisdiction ?? null;
    const currency: CurrencyCode = zone?.currency ?? baseCurrency;

    // Use the full CIT computation engine (handles all 6 CIT modes)
    const citAmount = computeCITAmount(income, cn.effectiveTax.cit);

    citLiabilities.push({
      nodeId: node.id,
      nodeName: node.name,
      jurisdiction: jurisdiction as JurisdictionCode | null,
      zoneId: node.zoneId,
      taxableIncome: income,
      citRate: cn.effectiveTax.citRateEffective,
      citAmount,
      currency,
    });
  }

  // ── 2. WHT liabilities (all flows between nodes) ──────────────────────────
  const whtLiabilities: FlowWHTLiability[] = [];

  for (const flow of project.flows) {
    const gross = Number(flow.grossAmount || 0);
    if (gross <= 0) continue;

    // Resolve payer's zone to get domestic WHT rates
    const payer = graph.nodeMap.get(flow.fromId);
    if (!payer) continue;

    // Look up the WHT rate for this flow type from the payer's effective tax config
    const whtRates = payer.effectiveTax.wht;
    const ft = flow.flowType as string;
    let domesticRate = 0;
    if (ft === 'Dividends') domesticRate = Number(whtRates.dividends || 0);
    else if (ft === 'Interest') domesticRate = Number(whtRates.interest || 0);
    else if (ft === 'Royalties') domesticRate = Number(whtRates.royalties || 0);
    else if (ft === 'Services') domesticRate = Number(whtRates.services || 0);
    // Salary and Goods/Equipment: no WHT (handled by payroll or customs)

    // Use the flow's explicit whtRate if set, otherwise use the domestic rate
    // whtRates from master data are fractional (0.15 = 15%), flow.whtRate is percentage (15)
    const ratePercent = Number(flow.whtRate || 0) > 0
      ? Number(flow.whtRate)
      : domesticRate * 100;

    if (ratePercent <= 0) continue;

    const whtOriginal = bankersRound2(gross * (ratePercent / 100));
    const whtBase = bankersRound2(
      convert(project, whtOriginal, flow.currency, baseCurrency),
    );

    whtLiabilities.push({
      flowId: flow.id,
      flowType: flow.flowType,
      fromNodeId: flow.fromId,
      toNodeId: flow.toId,
      grossAmount: gross,
      originalCurrency: flow.currency,
      whtRatePercent: ratePercent,
      whtAmountOriginal: whtOriginal,
      whtAmountBase: whtBase,
    });
  }

  // ── 3. Aggregate totals in base currency ──────────────────────────────────
  let totalCITBase = 0;
  for (const cit of citLiabilities) {
    totalCITBase += bankersRound2(convert(project, cit.citAmount, cit.currency, baseCurrency));
  }
  totalCITBase = bankersRound2(totalCITBase);

  let totalWHTBase = 0;
  for (const wht of whtLiabilities) {
    totalWHTBase += wht.whtAmountBase;
  }
  totalWHTBase = bankersRound2(totalWHTBase);

  const totalTaxBase = bankersRound2(totalCITBase + totalWHTBase);

  // Total pre-tax income: sum of all company annualIncome, converted to base currency
  let totalIncomeBase = 0;
  for (const cit of citLiabilities) {
    totalIncomeBase += bankersRound2(
      convert(project, cit.taxableIncome, cit.currency, baseCurrency),
    );
  }
  totalIncomeBase = bankersRound2(totalIncomeBase);

  // Group ETR: avoid division by zero
  const totalEffectiveTaxRate = totalIncomeBase > 0
    ? bankersRound2(totalTaxBase / totalIncomeBase * 10000) / 10000 // 4 decimal places
    : 0;

  return {
    citLiabilities,
    whtLiabilities,
    totalCITBase,
    totalWHTBase,
    totalTaxBase,
    totalIncomeBase,
    totalEffectiveTaxRate,
    baseCurrency,
  };
}
