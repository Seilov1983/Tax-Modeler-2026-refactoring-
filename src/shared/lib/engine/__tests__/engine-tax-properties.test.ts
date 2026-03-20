/**
 * Property-based stress tests for computeGroupTax().
 *
 * Uses fast-check to generate random valid Project structures with varied
 * node incomes, flow amounts, WHT overrides, and DTT settings, then asserts
 * universal mathematical invariants that must hold across ALL inputs.
 *
 * Invariants:
 *   I1  ETR Bounds: totalEffectiveTaxRate ∈ [0, 1], never NaN or Infinity.
 *   I2  Conservation of Wealth: totalTaxBase ≤ totalIncomeBase.
 *   I3  WHT Limits: per-flow whtAmountOriginal ∈ [0, grossAmount].
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { computeGroupTax } from '../engine-tax';
import {
  SCHEMA_VERSION,
  ENGINE_VERSION,
  defaultMasterData,
  defaultCatalogs,
  defaultLawReferences,
} from '../engine-core';
import type {
  Project,
  Zone,
  NodeDTO,
  FlowDTO,
  JurisdictionCode,
  CurrencyCode,
  FlowType,
} from '@shared/types';

// ─── Constants ──────────────────────────────────────────────────────────────

const JURISDICTIONS: JurisdictionCode[] = [
  'KZ', 'UAE', 'HK', 'CY', 'SG', 'UK', 'US', 'BVI', 'CAY', 'SEY',
];

// Only currencies present in the FX table to avoid NaN from missing rates
const CURRENCIES: CurrencyCode[] = [
  'KZT', 'AED', 'HKD', 'EUR', 'SGD', 'GBP', 'USD', 'SCR',
];

const FLOW_TYPES: FlowType[] = [
  'Dividends', 'Royalties', 'Interest', 'Services', 'Salary', 'Goods', 'Equipment',
];

const NUM_RUNS = 10_000;

// ─── Fixtures ───────────────────────────────────────────────────────────────

function makeBaseProject(overrides: Partial<Project> = {}): Project {
  return {
    schemaVersion: SCHEMA_VERSION,
    engineVersion: ENGINE_VERSION,
    projectId: 'stress-test',
    title: 'Stress Test',
    userId: 'u1',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    readOnly: false,
    baseCurrency: 'USD',
    masterData: defaultMasterData(),
    fx: {
      fxDate: '2026-03-01',
      rateToUSD: { USD: 1, KZT: 500, EUR: 0.92, AED: 3.67, HKD: 7.8, GBP: 0.79, SGD: 1.35, SCR: 13.5 },
      source: 'test',
    },
    zones: [],
    nodes: [],
    ownership: [],
    catalogs: defaultCatalogs(),
    activeJurisdictions: [...JURISDICTIONS],
    ui: {
      canvasW: 4000, canvasH: 3000, editMode: 'select',
      gridSize: 10, snapToGrid: false,
      flowLegend: { show: true, mode: 'all', selectedTypes: [], showTaxes: true },
    },
    flows: [],
    taxes: [],
    audit: { entries: [], lastHash: '' },
    periods: { closedYears: [] },
    group: { consolidatedRevenueEur: null },
    accounting: { years: {} },
    lawReferences: defaultLawReferences(),
    snapshots: [],
    pipeline: { lastRunAt: null, lastRun: null, runs: [] },
    projectRiskFlags: [],
    ...overrides,
  } as Project;
}

// ─── Arbitraries ────────────────────────────────────────────────────────────

const jurisdictionArb = fc.constantFrom(...JURISDICTIONS);
const currencyArb = fc.constantFrom(...CURRENCIES);
const flowTypeArb = fc.constantFrom(...FLOW_TYPES) as fc.Arbitrary<FlowType>;

/** Generate a list of zones (country + regime). Always ≥ 1 zone so nodes can be placed. */
const zoneListArb: fc.Arbitrary<Zone[]> = fc
  .integer({ min: 1, max: 5 })
  .chain((nCountries) =>
    fc.integer({ min: 0, max: nCountries * 2 })
      .chain((nRegimes) =>
        fc.tuple(
          fc.array(
            fc.record({ jurisdiction: jurisdictionArb, currency: currencyArb }),
            { minLength: nCountries, maxLength: nCountries },
          ),
          fc.constant(nRegimes),
        ).map(([countryDefs, regimeCount]) => {
          const zones: Zone[] = [];
          countryDefs.forEach((def, i) => {
            zones.push({
              id: `cz_${i}`, name: `Country ${i}`,
              x: i * 900, y: 0, w: 800, h: 700,
              jurisdiction: def.jurisdiction,
              code: `${def.jurisdiction}_COUNTRY_${i}`,
              currency: def.currency, zIndex: 10, parentId: null,
            });
          });
          for (let r = 0; r < regimeCount; r++) {
            const parent = zones[r % Math.max(1, countryDefs.length)];
            if (!parent) continue;
            zones.push({
              id: `rz_${r}`, name: `Regime ${r}`,
              x: parent.x + 50, y: parent.y + 100, w: 300, h: 250,
              jurisdiction: parent.jurisdiction,
              code: `${parent.jurisdiction}_REGIME_${r}`,
              currency: parent.currency, zIndex: 20, parentId: parent.id,
            });
          }
          return zones;
        }),
      ),
  );

/** Generate company nodes with random incomes (0 – 10 billion) and Phase 2 fields. */
function nodeListArb(zones: Zone[]): fc.Arbitrary<NodeDTO[]> {
  const zoneIdArb = fc.constantFrom(...zones.map((z) => z.id));

  return fc.array(
    fc.record({
      idx: fc.nat(9999),
      zoneId: zoneIdArb,
      annualIncome: fc.oneof(
        fc.constant(0),
        fc.double({ min: 1, max: 10_000_000_000, noNaN: true, noDefaultInfinity: true }),
      ),
      passiveIncomeShare: fc.integer({ min: 0, max: 100 }),
      hasSubstance: fc.boolean(),
    }),
    { minLength: 0, maxLength: 10 },
  ).map((entries) =>
    entries.map((e, i) => ({
      id: `n_${e.idx}_${i}`,
      name: `Company ${i}`,
      type: 'company' as const,
      x: 0, y: 0, w: 190, h: 90,
      zoneId: e.zoneId,
      frozen: false,
      riskFlags: [],
      annualIncome: e.annualIncome,
      etr: 0.2,
      balances: {},
      passiveIncomeShare: e.passiveIncomeShare,
      hasSubstance: e.hasSubstance,
    })),
  );
}

/**
 * Generate flows with grossAmount bounded by payer income.
 * Each flow's grossAmount is a fraction (0–0.3) of the payer's annualIncome,
 * denominated in the payer's zone currency to avoid cross-currency scaling issues.
 * This ensures total WHT stays proportional to company income.
 */
function flowListArb(nodes: NodeDTO[], zones: Zone[]): fc.Arbitrary<FlowDTO[]> {
  if (nodes.length < 2) return fc.constant([]);
  const nodeIdArb = fc.constantFrom(...nodes.map((n) => n.id));
  const incomeMap = new Map(nodes.map((n) => [n.id, n.annualIncome]));
  const zoneMap = new Map(zones.map((z) => [z.id, z]));
  const nodeCurrencyMap = new Map(
    nodes.map((n) => [n.id, zoneMap.get(n.zoneId ?? '')?.currency ?? ('USD' as CurrencyCode)]),
  );

  return fc.array(
    fc.tuple(
      fc.nat(9999),                                            // flow id suffix
      nodeIdArb,                                               // fromId
      nodeIdArb,                                               // toId
      flowTypeArb,                                             // flowType
      fc.double({ min: 0, max: 0.3, noNaN: true, noDefaultInfinity: true }),  // fraction of payer income
      fc.double({ min: 0, max: 35, noNaN: true, noDefaultInfinity: true }),   // whtRate (realistic %)
      fc.boolean(),                                            // applyDTT
      fc.option(
        fc.double({ min: 0, max: 35, noNaN: true, noDefaultInfinity: true }),
        { nil: undefined },
      ),                                                        // customWhtRate
    ),
    { minLength: 0, maxLength: 5 },
  ).map((tuples) =>
    tuples.map(([idx, fromId, toId, flowType, fraction, whtRate, applyDTT, customWhtRate]) => {
      const payerIncome = incomeMap.get(fromId) ?? 0;
      const grossAmount = Math.round(fraction * payerIncome * 100) / 100;
      // Use payer's zone currency so FX conversion preserves income proportionality
      const currency = nodeCurrencyMap.get(fromId) ?? ('USD' as CurrencyCode);
      return {
        id: `f_${idx}`,
        fromId,
        toId,
        flowType,
        currency,
        grossAmount,
        paymentMethod: 'bank',
        cashComponentAmount: 0,
        cashComponentCurrency: 'USD' as CurrencyCode,
        whtRate,
        status: 'pending',
        flowDate: '2026-06-01T00:00:00Z',
        ack: { ackStatus: 'not_required' as const, acknowledgedBy: null, acknowledgedAt: null, comment: '' },
        taxAdjustments: [],
        fxEvidence: null,
        applyDTT,
        customWhtRate,
      } as FlowDTO;
    }),
  );
}

/** Master arbitrary: generates a complete valid Project. */
const projectArb: fc.Arbitrary<Project> = zoneListArb.chain((zones) =>
  nodeListArb(zones).chain((nodes) =>
    flowListArb(nodes, zones).map((flows) =>
      makeBaseProject({ zones, nodes, flows }),
    ),
  ),
);

// ─── Property Tests ─────────────────────────────────────────────────────────

describe('computeGroupTax — property-based stress tests (10,000 runs)', () => {

  it('I1 — totalEffectiveTaxRate is always ≥ 0 and ≤ 1, never NaN or Infinity', () => {
    fc.assert(
      fc.property(projectArb, (project) => {
        const result = computeGroupTax(project);
        expect(Number.isNaN(result.totalEffectiveTaxRate)).toBe(false);
        expect(Number.isFinite(result.totalEffectiveTaxRate)).toBe(true);
        expect(result.totalEffectiveTaxRate).toBeGreaterThanOrEqual(0);
        expect(result.totalEffectiveTaxRate).toBeLessThanOrEqual(1);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('I2 — totalTaxBase never exceeds totalIncomeBase (conservation of wealth)', () => {
    fc.assert(
      fc.property(projectArb, (project) => {
        const result = computeGroupTax(project);
        // Rounding tolerance: banker's rounding on FX conversion can introduce ±0.01 per item,
        // plus IEEE 754 floating-point representation noise
        const items = result.citLiabilities.length + result.whtLiabilities.length;
        const tolerance = items * 0.02 + 0.01;
        expect(result.totalTaxBase).toBeLessThanOrEqual(result.totalIncomeBase + tolerance);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('I3 — WHT for any single flow is ≥ 0 and ≤ the flow gross amount', () => {
    fc.assert(
      fc.property(projectArb, (project) => {
        const result = computeGroupTax(project);
        for (const wht of result.whtLiabilities) {
          expect(wht.whtAmountOriginal).toBeGreaterThanOrEqual(0);
          // ratePercent ∈ [0, 100] ⇒ whtAmountOriginal ≤ grossAmount
          // Allow tiny rounding tolerance from banker's rounding
          expect(wht.whtAmountOriginal).toBeLessThanOrEqual(wht.grossAmount + 0.01);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  // Bonus: all output amounts are finite and non-negative
  it('I4 — all output amounts are finite and non-negative', () => {
    fc.assert(
      fc.property(projectArb, (project) => {
        const result = computeGroupTax(project);

        expect(Number.isFinite(result.totalCITBase)).toBe(true);
        expect(Number.isFinite(result.totalWHTBase)).toBe(true);
        expect(Number.isFinite(result.totalTaxBase)).toBe(true);
        expect(Number.isFinite(result.totalIncomeBase)).toBe(true);
        expect(result.totalCITBase).toBeGreaterThanOrEqual(0);
        expect(result.totalWHTBase).toBeGreaterThanOrEqual(0);
        expect(result.totalTaxBase).toBeGreaterThanOrEqual(0);
        expect(result.totalIncomeBase).toBeGreaterThanOrEqual(0);

        for (const cit of result.citLiabilities) {
          expect(Number.isFinite(cit.citAmount)).toBe(true);
          expect(Number.isFinite(cit.taxableIncome)).toBe(true);
          expect(Number.isFinite(cit.citRate)).toBe(true);
          expect(cit.citAmount).toBeGreaterThanOrEqual(0);
          expect(cit.citRate).toBeGreaterThanOrEqual(0);
          expect(cit.citRate).toBeLessThanOrEqual(1);
        }

        for (const wht of result.whtLiabilities) {
          expect(Number.isFinite(wht.whtAmountOriginal)).toBe(true);
          expect(Number.isFinite(wht.whtAmountBase)).toBe(true);
          expect(Number.isFinite(wht.whtRatePercent)).toBe(true);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
