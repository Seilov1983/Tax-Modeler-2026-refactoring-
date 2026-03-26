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
import kzRatesData from '@shared/config/rates/kz.json';
import cyDefensiveData from '@shared/config/rates/cy_defensive_measures.json';
import uaeRatesData from '@shared/config/rates/uae.json';
import type {
  Project, Zone, FlowDTO, NodeDTO, CITConfig, FlowType,
  PayrollResult, PayrollBreakdownItem, WHTResult, WHTExemptionRule,
  GroupTaxSummary, EntityCITLiability, FlowWHTLiability,
  ManagementGroupSummary, CurrencyCode, JurisdictionCode,
  TemporalRate, TemporalWHTBrackets, NexusFractionParams,
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

// ─── Temporal Rate Data (Modular JSON) ──────────────────────────────────────

const kzRates = kzRatesData as Record<string, unknown>;
const cyDefensive = cyDefensiveData as Record<string, unknown>;
const uaeRates = uaeRatesData as Record<string, unknown>;

// ─── Temporal Resolution Engine ─────────────────────────────────────────────

/**
 * Resolve a temporal rate for a given date. Returns the value from the first
 * entry whose [validFrom, validTo) window contains the date, or null.
 */
export function resolveTemporalRate(rates: TemporalRate[], date: string): number | null {
  if (!rates || !Array.isArray(rates) || !date) return null;
  const d = date.slice(0, 10);
  for (const r of rates) {
    if (d >= r.validFrom.slice(0, 10) && (!r.validTo || d < r.validTo.slice(0, 10))) {
      return r.value;
    }
  }
  return null;
}

/**
 * Resolve progressive WHT brackets for a given date.
 * Returns the bracket array from the first matching temporal window, or null.
 */
export function resolveTemporalWHTBrackets(
  entries: TemporalWHTBrackets[],
  date: string,
): Array<{ upToMRP: number | null; rate: number }> | null {
  if (!entries || !Array.isArray(entries) || !date) return null;
  const d = date.slice(0, 10);
  for (const entry of entries) {
    if (d >= entry.validFrom.slice(0, 10) && (!entry.validTo || d < entry.validTo.slice(0, 10))) {
      return entry.brackets;
    }
  }
  return null;
}

/**
 * Resolve the MRP (Monthly Calculation Index) value for a given date.
 */
export function resolveMRP(date: string): number {
  const mc = kzRates.macroConstants as Record<string, TemporalRate[]>;
  const v = resolveTemporalRate(mc?.mrpValue ?? [], date);
  return v ?? 4325; // fallback to 2026 default
}

/**
 * Resolve temporal KZ VAT rate for a given flow date.
 * Returns 0.16 for dates >= 2026-01-01, 0.12 for prior years.
 */
export function resolveKZVatRate(date: string): number {
  const v = resolveTemporalRate(kzRates.vatRates as TemporalRate[], date);
  return v ?? 0.16;
}

// ─── Progressive WHT (KZ Dividends) ─────────────────────────────────────────

/**
 * Compute progressive WHT on dividends (KZ 2026 rule).
 * 5% for amounts up to 230,000 MRP, 15% on the excess.
 */
export function computeProgressiveWHTDividends(
  grossAmount: number,
  date: string,
): { whtAmount: number; effectiveRate: number } {
  const whtDiv = (kzRates.whtDividends as Record<string, unknown>)?.progressive;
  const brackets = resolveTemporalWHTBrackets(whtDiv as TemporalWHTBrackets[], date);

  if (!brackets || brackets.length === 0) {
    // Fallback to flat 15%
    const wht = bankersRound2(grossAmount * 0.15);
    return { whtAmount: wht, effectiveRate: 0.15 };
  }

  const mrp = resolveMRP(date);
  let remaining = grossAmount;
  let totalWht = 0;

  for (const bracket of brackets) {
    const limit = bracket.upToMRP != null ? bracket.upToMRP * mrp : Infinity;
    const taxable = Math.min(remaining, limit);
    totalWht += taxable * bracket.rate;
    remaining -= taxable;
    if (remaining <= 0) break;
  }

  totalWht = bankersRound2(totalWht);
  const effectiveRate = grossAmount > 0 ? totalWht / grossAmount : 0;
  return { whtAmount: totalWht, effectiveRate };
}

// ─── Astana Hub Nexus Fraction ──────────────────────────────────────────────

/**
 * Calculate Astana Hub Nexus fraction: K = (rUp + rOut1) * 1.3 / (rUp + rOut1 + rOut2 + rAcq).
 * The result is capped at 1.0. Returns 0 if denominator is 0.
 */
export function computeNexusFraction(params: NexusFractionParams): number {
  const { rUp, rOut1, rOut2, rAcq } = params;
  const numerator = (rUp + rOut1) * 1.3;
  const denominator = rUp + rOut1 + rOut2 + rAcq;
  if (denominator <= 0) return 0;
  return Math.min(1.0, numerator / denominator);
}

/**
 * Compute Astana Hub CIT for a company with IP income.
 * If isIPIncome === true, the CIT exemption is scaled by the Nexus fraction K.
 * Non-IP income at the Hub gets a full 100% CIT reduction (0% CIT).
 */
export function computeAstanaHubCIT(
  income: number,
  node: NodeDTO,
  baseCitRate: number,
): number {
  if (income <= 0) return 0;

  // IP income: CIT reduction scaled by Nexus fraction
  if (node.isIPIncome && node.nexusParams) {
    const K = computeNexusFraction(node.nexusParams);
    // K determines the portion of income that gets the 0% CIT benefit
    // Taxable income = income * (1 - K)
    const taxableIncome = bankersRound2(income * (1 - K));
    return bankersRound2(taxableIncome * baseCitRate);
  }

  // Non-IP income at Astana Hub: 100% CIT reduction → 0% CIT
  return 0;
}

// ─── Cyprus Defensive Measures ──────────────────────────────────────────────

interface CYDefensiveMeasure {
  validFrom: string;
  validTo: string | null;
  enabled: boolean;
  penaltyWhtDividendsToLTJ: number;
  deductionDenial: { flowTypes: string[]; effect: string; lawRef: string };
  lowTaxJurisdictions: string[];
  lawRef: string;
}

/**
 * Resolve active Cyprus defensive measures for a given date.
 */
function resolveCYDefensiveMeasures(date: string): CYDefensiveMeasure | null {
  const measures = cyDefensive.defensiveMeasures as CYDefensiveMeasure[];
  if (!measures || !Array.isArray(measures)) return null;
  const d = date.slice(0, 10);
  for (const m of measures) {
    if (m.enabled && d >= m.validFrom.slice(0, 10) && (!m.validTo || d < m.validTo.slice(0, 10))) {
      return m;
    }
  }
  return null;
}

/**
 * Check if a jurisdiction is classified as a Low Tax Jurisdiction (LTJ)
 * under Cyprus defensive measures.
 */
export function isLowTaxJurisdiction(
  jurisdiction: string,
  date: string,
): boolean {
  const measures = resolveCYDefensiveMeasures(date);
  if (!measures) return false;
  return measures.lowTaxJurisdictions.includes(jurisdiction);
}

// ─── UAE Tax Group Helpers ──────────────────────────────────────────────────

/**
 * Check if two nodes are in the same UAE tax group (for intra-group flow elimination).
 */
export function areInSameTaxGroup(
  project: Project,
  nodeIdA: string,
  nodeIdB: string,
): boolean {
  if (!project.taxGroups || project.taxGroups.length === 0) return false;
  for (const group of project.taxGroups) {
    if (group.nodeIds.includes(nodeIdA) && group.nodeIds.includes(nodeIdB)) {
      return true;
    }
  }
  return false;
}

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

    // AIFC: 0% CIT valid until 2066-01-01, strictly conditional on hasSubstance + CIGA + separate accounting
    const aifcRule = zoneRules.aifcPresenceRule;
    if (z0 && z0.code === aifcRule.zoneCode && aifc && aifc.usesCITBenefit) {
      // CIGA validation: entity must have CIGA in zone
      if (!aifc.cigaInZone) {
        return Math.max(v, aifcRule.fallbackCitRate);
      }
      // Substance + separate accounting gate for 0% benefit
      if (!co.hasSubstance || !co.hasSeparateAccounting) {
        return Math.max(v, aifcRule.fallbackCitRate);
      }
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

// ─── Consolidated Group Tax Computation (LEGAL LAYER) ────────────────────────
// INVARIANT: computeGroupTax is the Legal Layer calculator. It is strictly
// "blind" to managementTags, ShadowLinks, and any management-layer data.
// Traversal follows only OwnershipEdge.percent for legal control.
// Management-layer analysis is handled by computeGroupTaxByTag (below).

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

    let citAmount: number;

    // ── Astana Hub: 100% CIT reduction (non-IP) or Nexus fraction (IP) ──
    if (zone && zone.code === 'KZ_HUB') {
      citAmount = computeAstanaHubCIT(income, node, 0.20); // KZ base CIT rate as fallback
    } else {
      // Use the full CIT computation engine (handles all 6 CIT modes)
      citAmount = computeCITAmount(income, cn.effectiveTax.cit);
    }

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

    const payerZone = project.zones.find((z) => z.id === payer.node.zoneId);
    const payee = graph.nodeMap.get(flow.toId);
    const payeeZone = payee ? project.zones.find((z) => z.id === payee.node.zoneId) : null;

    // Same-jurisdiction exemption: domestic flows have 0 WHT
    if (payer && payee && payerZone && payeeZone && payerZone.jurisdiction === payeeZone.jurisdiction) continue;

    // UAE Tax Group: eliminate intra-group flows
    if (areInSameTaxGroup(project, flow.fromId, flow.toId)) continue;

    const ft = flow.flowType as string;
    const flowDate = flow.flowDate || project.fx.fxDate;

    // ── Cyprus Defensive Measures: force 17% penalty WHT on dividends to LTJ ─
    if (
      payerZone?.jurisdiction === 'CY' &&
      ft === 'Dividends' &&
      payeeZone &&
      isLowTaxJurisdiction(payeeZone.jurisdiction, flowDate)
    ) {
      const measures = resolveCYDefensiveMeasures(flowDate);
      if (measures) {
        const penaltyRate = measures.penaltyWhtDividendsToLTJ;
        const whtOriginal = bankersRound2(gross * penaltyRate);
        const whtBase = bankersRound2(convert(project, whtOriginal, flow.currency, baseCurrency));
        whtLiabilities.push({
          flowId: flow.id,
          flowType: flow.flowType,
          fromNodeId: flow.fromId,
          toNodeId: flow.toId,
          grossAmount: gross,
          originalCurrency: flow.currency,
          whtRatePercent: bankersRound2(penaltyRate * 100),
          whtAmountOriginal: whtOriginal,
          whtAmountBase: whtBase,
        });
        continue;
      }
    }

    // ── KZ Progressive WHT on Dividends (5% up to 230k MRP, 15% excess) ─────
    if (payerZone?.jurisdiction === 'KZ' && ft === 'Dividends') {
      const whtDiv = (kzRates.whtDividends as Record<string, unknown>)?.progressive;
      const brackets = resolveTemporalWHTBrackets(whtDiv as TemporalWHTBrackets[], flowDate);
      if (brackets && brackets.length > 0) {
        const { whtAmount, effectiveRate } = computeProgressiveWHTDividends(gross, flowDate);
        if (whtAmount > 0) {
          const whtBase = bankersRound2(convert(project, whtAmount, flow.currency, baseCurrency));
          whtLiabilities.push({
            flowId: flow.id,
            flowType: flow.flowType,
            fromNodeId: flow.fromId,
            toNodeId: flow.toId,
            grossAmount: gross,
            originalCurrency: flow.currency,
            whtRatePercent: bankersRound2(effectiveRate * 100),
            whtAmountOriginal: whtAmount,
            whtAmountBase: whtBase,
          });
        }
        continue;
      }
    }

    // ── Standard WHT computation (all other cases) ───────────────────────────
    // Look up the WHT rate for this flow type from the payer's effective tax config
    const whtRates = payer.effectiveTax.wht;
    let domesticRate = 0;
    if (ft === 'Dividends') domesticRate = Number(whtRates.dividends || 0);
    else if (ft === 'Interest') domesticRate = Number(whtRates.interest || 0);
    else if (ft === 'Royalties') domesticRate = Number(whtRates.royalties || 0);
    else if (ft === 'Services') domesticRate = Number(whtRates.services || 0);
    // Salary and Goods/Equipment: no WHT (handled by payroll or customs)

    // DTT override: if a treaty applies and a custom rate is set, use it
    // Otherwise use the flow's explicit whtRate, or fall back to domestic rate
    // whtRates from master data are fractional (0.15 = 15%), flow.whtRate is percentage (15)
    const ratePercent = flow.applyDTT && flow.customWhtRate != null
      ? Number(flow.customWhtRate)
      : Number(flow.whtRate || 0) > 0
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

  // Group ETR: avoid division by zero; clamp to [0, 1] for display sanity
  const rawEtr = totalIncomeBase > 0
    ? bankersRound2(totalTaxBase / totalIncomeBase * 10000) / 10000 // 4 decimal places
    : 0;
  const totalEffectiveTaxRate = Math.min(1, Math.max(0, rawEtr));

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

// ─── Management Layer: Tag-Based Group Analysis ──────────────────────────────
// Dual-track: this function operates on managementTags (economic grouping)
// while the Legal Layer (computeGroupTax above) uses OwnershipEdge.

/**
 * computeGroupTaxByTag — Management Layer consolidated analysis.
 *
 * Aggregates income, CIT, WHT, and Capital Leakage for all nodes sharing
 * the specified management tag.
 *
 * Capital Leakage: when a flow crosses between two nodes that BOTH have
 * the same management tag but are de-jure independent (no direct ownership),
 * the WHT on that flow is classified as "capital leakage" — tax lost to
 * the group due to legal structure misalignment.
 *
 * Management ETR: totalTax / totalIncome (0–1).
 */
export function computeGroupTaxByTag(
  project: Project,
  tag: string,
): ManagementGroupSummary {
  const baseCurrency = project.baseCurrency;

  // 1. Identify all nodes with this management tag
  const taggedNodeIds = new Set<string>();
  for (const node of project.nodes) {
    if (node.managementTags?.includes(tag)) {
      taggedNodeIds.add(node.id);
    }
  }

  // 2. Compute the full legal-layer tax summary (reuses existing engine)
  const legalSummary = computeGroupTax(project);

  // 3. Filter CIT liabilities to tagged nodes only
  let totalCITBase = 0;
  let totalIncomeBase = 0;
  const nodeIds: string[] = [];

  for (const cit of legalSummary.citLiabilities) {
    if (!taggedNodeIds.has(cit.nodeId)) continue;
    nodeIds.push(cit.nodeId);
    totalCITBase += bankersRound2(convert(project, cit.citAmount, cit.currency, baseCurrency));
    totalIncomeBase += bankersRound2(convert(project, cit.taxableIncome, cit.currency, baseCurrency));
  }
  totalCITBase = bankersRound2(totalCITBase);
  totalIncomeBase = bankersRound2(totalIncomeBase);

  // 4. Filter WHT liabilities — split into external WHT and capital leakage
  let totalWHTBase = 0;
  let capitalLeakageBase = 0;

  // Build ownership lookup for "de-jure independent" check
  const ownershipPairs = new Set<string>();
  for (const edge of project.ownership) {
    ownershipPairs.add(`${edge.fromId}→${edge.toId}`);
    ownershipPairs.add(`${edge.toId}→${edge.fromId}`);
  }

  for (const wht of legalSummary.whtLiabilities) {
    const fromTagged = taggedNodeIds.has(wht.fromNodeId);
    const toTagged = taggedNodeIds.has(wht.toNodeId);

    if (!fromTagged && !toTagged) continue; // neither party is in this group

    totalWHTBase += wht.whtAmountBase;

    // Capital Leakage: both nodes share the tag, but no direct ownership edge
    if (fromTagged && toTagged) {
      const hasOwnership =
        ownershipPairs.has(`${wht.fromNodeId}→${wht.toNodeId}`) ||
        ownershipPairs.has(`${wht.toNodeId}→${wht.fromNodeId}`);
      if (!hasOwnership) {
        capitalLeakageBase += wht.whtAmountBase;
      }
    }
  }
  totalWHTBase = bankersRound2(totalWHTBase);
  capitalLeakageBase = bankersRound2(capitalLeakageBase);

  const totalTaxBase = bankersRound2(totalCITBase + totalWHTBase);

  // Management ETR: Total Taxes / Total Income
  const managementETR = totalIncomeBase > 0
    ? Math.min(1, Math.max(0, bankersRound2(totalTaxBase / totalIncomeBase * 10000) / 10000))
    : 0;

  const consolidatedCashFlow = bankersRound2(totalIncomeBase - totalTaxBase - capitalLeakageBase);

  return {
    tag,
    nodeIds,
    totalIncomeBase,
    totalCITBase,
    totalWHTBase,
    totalTaxBase,
    capitalLeakageBase,
    managementETR,
    consolidatedCashFlow,
    baseCurrency,
  };
}
