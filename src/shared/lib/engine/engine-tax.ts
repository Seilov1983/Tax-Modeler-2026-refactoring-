/**
 * Tax Calculation Engine — fully "blind" to jurisdictions.
 *
 * All zone-specific logic is read from the declarative zone-rules.json
 * (Law-as-Code). The AI Legal Parser can update the JSON when legislation
 * changes — no JS/TS code changes required.
 */

import { deepMerge, bankersRound2, numOrNull, isoDate } from './utils';
import { convert, getZone, getNode, buildComputationGraph, defaultMasterData } from './engine-core';
import zoneRulesData from '@shared/config/zone-rules.json';
import kzRatesRaw from './masterData/rates_kz.json';
import cyRatesRaw from './masterData/rates_cy.json';
import uaeRatesRaw from './masterData/rates_ae.json';
import {
  parseKZRates, parseCYRates, parseUAERates,
  type KZRates, type CYRates, type UAERates,
} from './schema-master-data';
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

// ─── Zod-Validated Temporal Rate Data ───────────────────────────────────────

const kzRates: KZRates = parseKZRates(kzRatesRaw);
const cyRates: CYRates = parseCYRates(cyRatesRaw);
const uaeRates: UAERates = parseUAERates(uaeRatesRaw);

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
  const v = resolveTemporalRate((kzRates.macroConstants.mrpValue ?? []) as TemporalRate[], date);
  return v ?? 4325; // fallback to 2026 default
}

/**
 * Resolve temporal KZ VAT rate for a given flow date.
 * Returns 0.16 for dates >= 2026-01-01, 0.12 for prior years.
 */
export function resolveKZVatRate(date: string): number {
  const v = resolveTemporalRate(kzRates.vatRates as TemporalRate[], date);
  return v ?? 0.16; // fallback to 2026 rate
}

// ─── getEffectiveRate (Temporal Lookup Utility) ─────────────────────────────

/**
 * Temporal lookup utility: given a jurisdiction code and rate category,
 * resolves the effective rate for the specified flow date from the
 * Zod-validated JSON dictionaries.
 *
 * @param jurisdiction - The jurisdiction code (e.g., 'KZ', 'CY', 'UAE')
 * @param category - Rate category (e.g., 'cit', 'vat', 'whtDividends', 'whtInterest', 'whtRoyalties', 'whtServices')
 * @param flowDate - ISO date string for temporal resolution
 * @returns The resolved rate value, or null if no matching window found
 */
export function getEffectiveRate(
  jurisdiction: string,
  category: string,
  flowDate: string,
): number | null {
  const rateArrayFor = (j: string, cat: string): TemporalRate[] | null => {
    if (j === 'KZ') {
      if (cat === 'cit') return kzRates.citRates as TemporalRate[];
      if (cat === 'vat') return kzRates.vatRates as TemporalRate[];
      if (cat === 'whtInterest') return kzRates.whtInterest as TemporalRate[];
      if (cat === 'whtRoyalties') return kzRates.whtRoyalties as TemporalRate[];
      if (cat === 'whtServices') return kzRates.whtServices as TemporalRate[];
      if (cat === 'whtDividends') return kzRates.whtDividends.flat as TemporalRate[];
    }
    if (j === 'CY') {
      if (cat === 'cit') return cyRates.citRates as TemporalRate[];
      if (cat === 'vat') return (cyRates.vatRates ?? []) as TemporalRate[];
      if (cat === 'whtDividends') return (cyRates.whtDividends ?? []) as TemporalRate[];
      if (cat === 'whtInterest') return (cyRates.whtInterest ?? []) as TemporalRate[];
      if (cat === 'whtRoyalties') return (cyRates.whtRoyalties ?? []) as TemporalRate[];
      if (cat === 'whtServices') return (cyRates.whtServices ?? []) as TemporalRate[];
    }
    if (j === 'UAE') {
      if (cat === 'cit') return uaeRates.citRates as TemporalRate[];
      if (cat === 'vat') return (uaeRates.vatRates ?? []) as TemporalRate[];
    }
    return null;
  };

  // Try temporal resolution first (KZ/CY/UAE have rate files)
  const rates = rateArrayFor(jurisdiction, category);
  if (rates) {
    const resolved = resolveTemporalRate(rates, flowDate);
    if (resolved !== null) return resolved;
  }

  // Fallback: static master data for all jurisdictions (HK, SG, UK, US, BVI, CAY, SEY,
  // or when temporal window doesn't cover the requested date)
  return _staticMasterDataRate(jurisdiction, category);
}

/** Resolve a rate from the static defaultMasterData dictionary. */
function _staticMasterDataRate(jurisdiction: string, category: string): number | null {
  const md = defaultMasterData();
  const jData = md[jurisdiction as JurisdictionCode] as Record<string, unknown> | undefined;
  if (!jData) return null;

  if (category === 'cit') {
    if (jData.cit && typeof jData.cit === 'object') {
      const cit = jData.cit as CITConfig;
      if (cit.mode === 'flat') return cit.rate ?? null;
      if (cit.mode === 'qfzp') return cit.qualifyingRate ?? null;
      if (cit.mode === 'brackets') {
        const last = cit.brackets?.[cit.brackets.length - 1];
        return last?.rate ?? null;
      }
      return cit.mainRate ?? null;
    }
    return (jData.citRateStandard as number) ?? null;
  }
  if (category === 'vat') return (jData.vatRateStandard as number) ?? null;

  const wht = jData.wht as Record<string, number> | undefined;
  if (!wht) return null;
  if (category === 'whtDividends') return wht.dividends ?? null;
  if (category === 'whtInterest') return wht.interest ?? null;
  if (category === 'whtRoyalties') return wht.royalties ?? null;
  if (category === 'whtServices') return wht.services ?? null;

  return null;
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
  const brackets = resolveTemporalWHTBrackets(
    kzRates.whtDividends.progressive as TemporalWHTBrackets[], date,
  );

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
 * Compute Nexus fraction from a node's substance OPEX and outgoing flow tags
 * (R_OUT_UNRELATED, R_OUT_RELATED_FOR, R_IP_ACQUISITION). All amounts are
 * converted to KZT for proportional aggregation.
 */
export function computeNexusFractionFromFlows(project: Project, node: NodeDTO): number {
  const rUp = node.substanceMetrics?.operationalExpenses ?? 0;
  let rOut1 = 0, rOut2 = 0, rAcq = 0;
  for (const f of project.flows) {
    if (f.fromId !== node.id || !f.nexusCategory) continue;
    const amt = convert(project, Number(f.grossAmount || 0), f.currency, 'KZT');
    if (f.nexusCategory === 'R_OUT_UNRELATED') rOut1 += amt;
    else if (f.nexusCategory === 'R_OUT_RELATED_FOR') rOut2 += amt;
    else if (f.nexusCategory === 'R_IP_ACQUISITION') rAcq += amt;
  }
  return computeNexusFraction({ rUp, rOut1, rOut2, rAcq });
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
  project?: Project,
): number {
  if (income <= 0) return 0;

  // IP income: CIT reduction scaled by Nexus fraction
  if (node.isIPIncome) {
    const K = node.nexusParams
      ? computeNexusFraction(node.nexusParams)
      : (project ? computeNexusFractionFromFlows(project, node) : 0);
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
  const measures = (cyRates.defensiveMeasures ?? []) as CYDefensiveMeasure[];
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
    // Validate temporal applicability: skip override if project date precedes effectiveFrom
    const fxDate = (p.fx?.fxDate || '2026-01-01').slice(0, 10);
    const from = override.effectiveFrom?.slice(0, 10);
    const isActive = !from || fxDate >= from;

    if (isActive) {
      const ov = override.taxOverride;
      if (ov.vatRate !== undefined) base.vatRate = ov.vatRate as number;
      if (ov.cit) base.cit = ov.cit as CITConfig;
      if (ov.wht) base.wht = deepMerge(base.wht, ov.wht as Record<string, number>);
      if (ov.payroll) base.payroll = deepMerge(base.payroll, ov.payroll as Record<string, unknown>);
    }
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

  // Rate resolution: override → flow-stored → master-data lookup for cross-border
  let rate: number;
  if (overrideRatePercent !== undefined && overrideRatePercent !== null) {
    rate = Number(overrideRatePercent || 0);
  } else if (Number(flow.whtRate || 0) > 0) {
    rate = Number(flow.whtRate);
  } else if (zPayer && zPayee && zPayer.jurisdiction !== zPayee.jurisdiction) {
    // Cross-border flow with no explicit rate: resolve from payer zone master data
    const zoneTax = effectiveZoneTax(p, zPayer);
    rate = whtDefaultPercentForFlow(zoneTax, flow.flowType);
  } else {
    rate = Number(flow.whtRate || 0);
  }
  let appliedLawRef: string | null = null;

  // Apply WHT exemption rules from declarative JSON (replaces hardcoded if-chains)
  // Match conditions are AND-ed: a rule with both flowTypes and sameJurisdiction
  // matches only when BOTH conditions are true.
  for (const rule of zoneRules.whtExemptionRules) {
    const match = rule.match;
    // Skip rules with no conditions at all
    if (!match.flowTypes && !match.sameJurisdiction) continue;

    let matched = true;
    if (match.flowTypes && !match.flowTypes.includes(flow.flowType as FlowType)) {
      matched = false;
    }
    if (match.sameJurisdiction && !(zPayer && zPayee && zPayer.jurisdiction === zPayee.jurisdiction)) {
      matched = false;
    }

    if (matched) {
      rate = rule.effect.rate;
      appliedLawRef = rule.effect.lawRef;
      break;
    }
  }

  // If no exemption matched and rate > 0, provide the payer jurisdiction's WHT lawRef
  if (!appliedLawRef && rate > 0 && zPayer) {
    appliedLawRef = _domesticWhtLawRef(zPayer.jurisdiction);
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

// ─── Effective ETR (data-driven AIFC rule + Astana Hub) ──────────────────────

export function effectiveEtrForCompany(p: Project, co: NodeDTO): number {
  // Resolve ETR from master data / zone tax first (the "computed" rate).
  const z = getZone(p, co?.zoneId);
  let zoneCitRate = 0;
  if (z) {
    // ── Astana Hub: 100% CIT reduction for non-IP income (Chapter 82 NK RK 2026) ──
    // IP income uses Nexus fraction K to scale the exemption.
    if (z.code === 'KZ_HUB') {
      if (co?.isIPIncome) {
        const K = co.nexusParams
          ? computeNexusFraction(co.nexusParams)
          : computeNexusFractionFromFlows(p, co);
        // Effective rate: baseCIT * (1 - K)
        const kzBaseCit = getEffectiveRate('KZ', 'cit', p.fx?.fxDate || '2026-01-01') ?? 0.20;
        return kzBaseCit * (1 - K);
      }
      // Non-IP income at Astana Hub → 0% CIT
      return 0;
    }

    // ── HK FSIE: Foreign Sourced Income Exemption (IRO s.15H-15T, effective 2023-01-01) ──
    // Passive income (dividends, interest, royalties, IP) from offshore sources
    // is exempt from profits tax IF the entity has adequate substance in HK.
    // Without substance, the income is taxable at the standard HK rate.
    if (z.jurisdiction === 'HK' && co?.hasSubstance) {
      // Check if income is predominantly foreign-sourced (via isOffshoreSource flows)
      const offshoreFlows = p.flows.filter(
        (f) => f.toId === co.id && f.isOffshoreSource &&
          ['Dividends', 'Interest', 'Royalties'].includes(f.flowType),
      );
      const totalOffshoreIncome = offshoreFlows.reduce(
        (sum, f) => sum + convert(p, Number(f.grossAmount || 0), f.currency, z.currency), 0,
      );
      const totalIncome = Number(co.annualIncome || 0);
      if (totalIncome > 0 && totalOffshoreIncome > 0) {
        // Blended rate: exempt portion at 0%, remainder at standard HK rate
        const exemptFraction = Math.min(1, totalOffshoreIncome / totalIncome);
        const hkCitRate = getEffectiveRate('HK', 'cit', p.fx?.fxDate || '2026-01-01') ?? 0.165;
        return bankersRound2(hkCitRate * (1 - exemptFraction) * 10000) / 10000;
      }
    }

    const tx = effectiveZoneTax(p, z);
    const cit = tx?.cit as CITConfig | undefined;
    if (cit?.mode) {
      // Extract scalar CIT rate from any of the 6 supported CIT modes
      if (cit.mode === 'flat')          zoneCitRate = Number(cit.rate || 0);
      else if (cit.mode === 'qfzp')     zoneCitRate = Number(cit.qualifyingRate || 0);
      else if (cit.mode === 'brackets') {
        const last = cit.brackets?.[cit.brackets.length - 1];
        zoneCitRate = last ? Number(last.rate || 0) : 0;
      } else {
        // threshold, twoTier, smallProfits → use mainRate
        zoneCitRate = Number(cit.mainRate || 0);
      }
    } else {
      // No CIT config resolved — fall back to flat citRateStandard
      const md = (p.masterData?.[z.jurisdiction] ?? {}) as Record<string, unknown>;
      zoneCitRate = numOrNull(md.citRateStandard) ?? 0;
    }
  }

  // If the node has an explicit non-zero manual ETR override, use it.
  // etr === 0 is treated as "not set" (the default), falling through to zone/master data.
  const v = Number(co?.etr);
  const hasManualOverride = isFinite(v) && v > 0;
  const baseRate = hasManualOverride ? v : zoneCitRate;

  // AIFC: 0% CIT valid until 2066-01-01, strictly conditional on hasSubstance + CIGA + separate accounting
  const aifc = co?.complianceData?.aifc;
  const aifcRule = zoneRules.aifcPresenceRule;
  if (z && z.code === aifcRule.zoneCode && aifc && aifc.usesCITBenefit) {
    if (!aifc.cigaInZone) {
      return Math.max(baseRate, aifcRule.fallbackCitRate);
    }
    if (!co.hasSubstance || !co.hasSeparateAccounting) {
      return Math.max(baseRate, aifcRule.fallbackCitRate);
    }
  }

  return baseRate;
}

// ─── KZ Cash Discipline (1000 MRP CIT deduction exclusion) ──────────────────

/**
 * Compute total non-deductible cash amounts for a KZ company.
 * If a transaction between VAT payers uses paymentMethod === 'cash' and the
 * cash amount exceeds 1000 MRP, the entire cash amount is excluded from
 * CIT deductions (added back to taxable income).
 *
 * @returns Total non-deductible amount in the company's functional currency.
 */
export function computeCashDisciplineExclusion(
  project: Project,
  nodeId: string,
  flowDate: string,
): number {
  const node = getNode(project, nodeId);
  if (!node) return 0;
  const zone = getZone(project, node.zoneId);
  if (!zone || zone.jurisdiction !== 'KZ') return 0;

  const mrp = resolveMRP(flowDate);
  const threshold = 1000 * mrp;
  let totalExcluded = 0;

  for (const flow of project.flows) {
    if (flow.fromId !== nodeId) continue;
    if (flow.paymentMethod !== 'cash') continue;

    // Both payer and payee must be VAT payers (company nodes in a zone)
    const payee = getNode(project, flow.toId);
    if (!payee || payee.type !== 'company') continue;
    const payeeZone = getZone(project, payee.zoneId);
    if (!payeeZone) continue;

    const cashAmt = Number(flow.cashComponentAmount || flow.grossAmount || 0);
    const cashFunctional = convert(project, cashAmt, flow.cashComponentCurrency || flow.currency, zone.currency);

    if (cashFunctional > threshold) {
      totalExcluded += cashFunctional;
    }
  }

  return bankersRound2(totalExcluded);
}

// ─── CY Deduction Denial (Interest/Royalties to LTJ) ────────────────────────

/**
 * Compute total non-deductible amounts for a CY company due to defensive measures.
 * Interest and royalty payments to entities in Low Tax Jurisdictions (LTJ) are
 * excluded from CIT deductions.
 *
 * @returns Total non-deductible amount in the company's functional currency.
 */
export function computeCYDeductionDenial(
  project: Project,
  nodeId: string,
  flowDate: string,
): number {
  const node = getNode(project, nodeId);
  if (!node) return 0;
  const zone = getZone(project, node.zoneId);
  if (!zone || zone.jurisdiction !== 'CY') return 0;

  const measures = resolveCYDefensiveMeasures(flowDate);
  if (!measures) return 0;

  const deniedFlowTypes = measures.deductionDenial.flowTypes;
  let totalDenied = 0;

  for (const flow of project.flows) {
    if (flow.fromId !== nodeId) continue;
    if (!deniedFlowTypes.includes(flow.flowType)) continue;

    const payee = getNode(project, flow.toId);
    if (!payee) continue;
    const payeeZone = getZone(project, payee.zoneId);
    if (!payeeZone) continue;

    if (measures.lowTaxJurisdictions.includes(payeeZone.jurisdiction)) {
      const gross = Number(flow.grossAmount || 0);
      const grossFunctional = convert(project, gross, flow.currency, zone.currency);
      totalDenied += grossFunctional;
    }
  }

  return bankersRound2(totalDenied);
}

/** Map jurisdiction code → domestic WHT law reference. */
function _domesticWhtLawRef(jurisdiction: string | null): string | null {
  if (!jurisdiction) return null;
  const refs: Record<string, string> = {
    KZ: 'НК РК 2025 ст. 645-655 (ИПН у источника)',
    CY: 'CY Income Tax Law s.37(1)',
    HK: 'HK IRO s.20A-20AC',
    SG: 'SG ITA s.45',
    UK: 'UK ITA 2007 Part 15',
    US: 'US IRC §1441-1446',
    UAE: 'UAE CT Law Art. 45',
    BVI: 'BVI Business Companies Act 2004 (no WHT)',
    CAY: 'Cayman Islands — no WHT regime',
    SEY: 'Seychelles Business Tax Act 2009 s.35',
  };
  return refs[jurisdiction] ?? `${jurisdiction} domestic WHT`;
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

  /** Format money for Evidence Trail (full precision, thousands separators). */
  const fmtB = (n: number, ccy?: string): string => {
    const formatted = n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return ccy ? `${formatted} ${ccy}` : formatted;
  };
  /** Format rate as percentage for Evidence Trail. */
  const fmtR = (rate: number): string => `${bankersRound2(rate * 100)}%`;

  // ── 1. CIT liabilities (company nodes only) ────────────────────────────────
  const citLiabilities: EntityCITLiability[] = [];

  for (const cn of graph.nodes) {
    const node = cn.node;
    if (node.type !== 'company') continue;

    const income = Number(node.annualIncome || 0);
    const zone = node.zoneId ? project.zones.find((z) => z.id === node.zoneId) ?? null : null;
    const jurisdiction = zone?.jurisdiction ?? null;
    const currency: CurrencyCode = zone?.currency ?? baseCurrency;
    const fxDate = project.fx.fxDate || '2026-01-01';

    // ── CIT deduction adjustments (cash discipline + CY deduction denial) ──
    const cashExclusion = computeCashDisciplineExclusion(project, node.id, fxDate);
    const cyDenial = computeCYDeductionDenial(project, node.id, fxDate);
    const adjustedIncome = income + cashExclusion + cyDenial;

    let citAmount: number;
    let citBreakdown: string;

    // ── Astana Hub: 100% CIT reduction (non-IP) or Nexus fraction (IP) ──
    if (zone && zone.code === 'KZ_HUB') {
      const kzBaseCit = getEffectiveRate('KZ', 'cit', fxDate) ?? 0.20;
      citAmount = computeAstanaHubCIT(adjustedIncome, node, kzBaseCit, project);
      if (node.isIPIncome) {
        const K = node.nexusParams
          ? computeNexusFraction(node.nexusParams)
          : computeNexusFractionFromFlows(project, node);
        citBreakdown = `Astana Hub IP: ${fmtB(adjustedIncome, currency)} × (1 − ${fmtR(K)} Nexus) × ${fmtR(kzBaseCit)} = ${fmtB(citAmount, currency)}`;
      } else {
        citBreakdown = `Astana Hub non-IP: 100% CIT reduction → ${fmtB(adjustedIncome, currency)} × 0% = 0`;
      }
    } else {
      // Use the full CIT computation engine (handles all 6 CIT modes)
      citAmount = computeCITAmount(adjustedIncome, cn.effectiveTax.cit);
      const cit = cn.effectiveTax.cit as CITConfig;
      const mode = cit?.mode || 'flat';
      const rateStr = mode === 'flat' ? fmtR(cit.rate || 0)
        : mode === 'qfzp' ? `${fmtR(cit.qualifyingRate || 0)} (QFZP)`
        : mode === 'threshold' ? `${fmtR(cit.mainRate || 0)} (threshold)`
        : fmtR(cit.mainRate || 0);
      citBreakdown = `${fmtB(adjustedIncome, currency)} × ${rateStr} [${mode}] = ${fmtB(citAmount, currency)}`;
    }

    // Append deduction adjustments to breakdown if any
    if (cashExclusion > 0) citBreakdown += ` (+${fmtB(cashExclusion, currency)} cash discipline add-back)`;
    if (cyDenial > 0) citBreakdown += ` (+${fmtB(cyDenial, currency)} CY deduction denial)`;

    // Resolve lawRef for the applicable zone override
    const zoneOverride = zone ? zoneRules.zoneOverrides[zone.code] : null;
    const citLawRef = zoneOverride?.lawRef ?? null;

    citLiabilities.push({
      nodeId: node.id,
      nodeName: node.name,
      jurisdiction: jurisdiction as JurisdictionCode | null,
      zoneId: node.zoneId,
      taxableIncome: adjustedIncome,
      citRate: zone?.code === 'KZ_HUB' ? 0 : cn.effectiveTax.citRateEffective,
      citAmount,
      currency,
      lawRef: citLawRef,
      calculationBreakdown: citBreakdown,
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
          lawRef: measures.lawRef,
          calculationBreakdown: `CY Defensive: ${fmtB(gross, flow.currency)} × ${fmtR(penaltyRate)} penalty WHT to LTJ (${payeeZone.jurisdiction}) = ${fmtB(whtOriginal, flow.currency)}`,
        });
        continue;
      }
    }

    // ── KZ Progressive WHT on Dividends (5% up to 230k MRP, 15% excess) ─────
    if (payerZone?.jurisdiction === 'KZ' && ft === 'Dividends') {
      const brackets = resolveTemporalWHTBrackets(
        kzRates.whtDividends.progressive as TemporalWHTBrackets[], flowDate,
      );
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
            lawRef: 'KZ_NK_2026_PROGRESSIVE_WHT',
            calculationBreakdown: `KZ Progressive WHT: ${fmtB(gross, flow.currency)} → eff. rate ${fmtR(effectiveRate)} = ${fmtB(whtAmount, flow.currency)}`,
          });
        }
        continue;
      }
    }

    // ── Standard WHT computation (all other cases) ───────────────────────────
    const whtRes = computeWht(project, flow);
    const whtAmtOrig = whtRes.amountOriginal ?? 0;
    if (whtAmtOrig <= 0) continue;

    const whtBase = bankersRound2(convert(project, whtAmtOrig, flow.currency, baseCurrency));

    whtLiabilities.push({
      flowId: flow.id,
      flowType: flow.flowType,
      fromNodeId: flow.fromId,
      toNodeId: flow.toId,
      grossAmount: gross,
      originalCurrency: flow.currency,
      whtRatePercent: bankersRound2((whtAmtOrig / gross) * 100),
      whtAmountOriginal: whtAmtOrig,
      whtAmountBase: whtBase,
      lawRef: whtRes.appliedLawRef ?? _domesticWhtLawRef(payerZone?.jurisdiction ?? null),
      calculationBreakdown: `${fmtB(gross, flow.currency)} × ${bankersRound2((whtAmtOrig / gross) * 100)}% = ${fmtB(whtAmtOrig, flow.currency)}`,
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
    totalTopUpTaxBase: 0,
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
