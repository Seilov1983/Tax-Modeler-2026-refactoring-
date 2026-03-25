import { describe, it, expect } from 'vitest';
import {
  computeCITAmount,
  computeWht,
  computePayroll,
  computeGroupTax,
  computeGroupTaxByTag,
  defaultZoneTax,
  effectiveZoneTax,
  whtDefaultPercentForFlow,
  effectiveEtrForCompany,
  ensureZoneTaxDefaults,
} from '../engine-tax';
import {
  SCHEMA_VERSION,
  ENGINE_VERSION,
  defaultMasterData,
  defaultCatalogs,
  defaultLawReferences,
  makeNode,
} from '../engine-core';
import type { Project, Zone, CITConfig, FlowDTO } from '@shared/types';

// ─── Fixtures ───────────────────────────────────────────────────────────────

function makeProject(overrides?: Partial<Project>): Project {
  return {
    schemaVersion: SCHEMA_VERSION,
    engineVersion: ENGINE_VERSION,
    projectId: 'test',
    title: 'Test',
    userId: 'u1',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    readOnly: false,
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
    activeJurisdictions: ['KZ', 'UAE', 'HK', 'CY', 'SG', 'UK', 'US', 'BVI', 'CAY', 'SEY'],
    ui: { canvasW: 4000, canvasH: 3000, editMode: 'select', gridSize: 10, snapToGrid: false, flowLegend: { show: true, mode: 'all', selectedTypes: [], showTaxes: true } },
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

function makeZone(overrides?: Partial<Zone>): Zone {
  return {
    id: 'z_kz', name: 'Kazakhstan', x: 0, y: 0, w: 800, h: 600,
    jurisdiction: 'KZ', code: 'KZ_MAIN', currency: 'KZT', zIndex: 0,
    ...overrides,
  };
}

function makeFlow(overrides?: Partial<FlowDTO>): FlowDTO {
  return {
    id: 'f_1', fromId: 'n_1', toId: 'n_2',
    flowType: 'Dividends', currency: 'KZT', grossAmount: 1_000_000,
    paymentMethod: 'bank', cashComponentAmount: 0, cashComponentCurrency: 'KZT',
    whtRate: 15, status: 'pending', flowDate: '2026-06-15T12:00:00Z',
    ack: { ackStatus: 'not_required', acknowledgedBy: null, acknowledgedAt: null, comment: '' },
    taxAdjustments: [], fxEvidence: null,
    ...overrides,
  } as FlowDTO;
}

// ─── CIT Computation ────────────────────────────────────────────────────────

describe('computeCITAmount', () => {
  describe('flat mode (KZ standard 20%)', () => {
    const cit: CITConfig = { mode: 'flat', rate: 0.20 };

    it('calculates 20% on income', () => {
      expect(computeCITAmount(1_000_000, cit)).toBe(200_000);
    });

    it('returns 0 for zero/negative income', () => {
      expect(computeCITAmount(0, cit)).toBe(0);
      expect(computeCITAmount(-100, cit)).toBe(0);
    });
  });

  describe('threshold mode (UAE mainland)', () => {
    const cit: CITConfig = { mode: 'threshold', zeroUpTo: 375_000, mainRate: 0.09 };

    it('returns 0 when income <= threshold', () => {
      expect(computeCITAmount(375_000, cit)).toBe(0);
      expect(computeCITAmount(100_000, cit)).toBe(0);
    });

    it('taxes only excess above threshold at 9%', () => {
      // (1,000,000 - 375,000) * 0.09 = 56,250
      expect(computeCITAmount(1_000_000, cit)).toBe(56_250);
    });
  });

  describe('twoTier mode (Hong Kong)', () => {
    const cit: CITConfig = { mode: 'twoTier', smallRate: 0.0825, smallLimit: 2_000_000, mainRate: 0.165 };

    it('applies small rate for income <= smallLimit', () => {
      // 1,000,000 * 0.0825 = 82,500
      expect(computeCITAmount(1_000_000, cit)).toBe(82_500);
    });

    it('applies two tiers for income > smallLimit', () => {
      // 2,000,000 * 0.0825 + 3,000,000 * 0.165 = 165,000 + 495,000 = 660,000
      expect(computeCITAmount(5_000_000, cit)).toBe(660_000);
    });

    it('boundary: exactly at smallLimit uses small rate only', () => {
      // 2,000,000 * 0.0825 = 165,000
      expect(computeCITAmount(2_000_000, cit)).toBe(165_000);
    });
  });

  describe('qfzp mode (UAE Free Zone Qualifying)', () => {
    const cit: CITConfig = { mode: 'qfzp', qualifyingRate: 0.00 };

    it('qualifying income at 0% → no tax', () => {
      expect(computeCITAmount(10_000_000, cit)).toBe(0);
    });

    it('non-qualifying at 9%', () => {
      const citNQ: CITConfig = { mode: 'qfzp', qualifyingRate: 0.09 };
      expect(computeCITAmount(1_000_000, citNQ)).toBe(90_000);
    });
  });

  describe('brackets mode (Seychelles)', () => {
    const cit: CITConfig = {
      mode: 'brackets',
      brackets: [
        { upTo: 1_000_000, rate: 0.15 },
        { upTo: null, rate: 0.25 },
      ],
    };

    it('income within first bracket', () => {
      // 500,000 * 0.15 = 75,000
      expect(computeCITAmount(500_000, cit)).toBe(75_000);
    });

    it('income spanning both brackets', () => {
      // 1,000,000 * 0.15 + 500,000 * 0.25 = 150,000 + 125,000 = 275,000
      expect(computeCITAmount(1_500_000, cit)).toBe(275_000);
    });

    it('boundary: exactly at bracket limit', () => {
      // 1,000,000 * 0.15 = 150,000
      expect(computeCITAmount(1_000_000, cit)).toBe(150_000);
    });
  });

  describe('smallProfits mode (UK)', () => {
    const cit: CITConfig = { mode: 'smallProfits', smallRate: 0.19, smallLimit: 50_000, mainRate: 0.25, mainLimit: 250_000 };

    it('income <= smallLimit → small rate', () => {
      // 30,000 * 0.19 = 5,700
      expect(computeCITAmount(30_000, cit)).toBe(5_700);
    });

    it('income >= mainLimit → main rate', () => {
      // 300,000 * 0.25 = 75,000
      expect(computeCITAmount(300_000, cit)).toBe(75_000);
    });

    it('income in marginal zone → progressive interpolation', () => {
      // smallTax = 50,000 * 0.19 = 9,500
      // mainTax at mainLimit = 250,000 * 0.25 = 62,500
      // marginalRate = (62,500 - 9,500) / (250,000 - 50,000) = 53,000 / 200,000 = 0.265
      // For income=150,000: 9,500 + (150,000 - 50,000) * 0.265 = 9,500 + 26,500 = 36,000
      expect(computeCITAmount(150_000, cit)).toBe(36_000);
    });

    it('boundary: exactly at smallLimit', () => {
      // 50,000 * 0.19 = 9,500
      expect(computeCITAmount(50_000, cit)).toBe(9_500);
    });
  });
});

// ─── Zone Tax & Law-as-Code Integration ─────────────────────────────────────

describe('Zone Rules Integration (zone-rules.json)', () => {
  it('defaultZoneTax for KZ uses masterData rates', () => {
    const p = makeProject();
    const z = makeZone({ jurisdiction: 'KZ', code: 'KZ_MAIN' });
    const tax = defaultZoneTax(p, z);
    expect(tax.vatRate).toBe(0.16);
    expect(tax.cit).toBeDefined();
    expect(tax.wht).toBeDefined();
  });

  it('KZ_AIFC zone override: 0% CIT, 0% VAT', () => {
    const p = makeProject();
    const z = makeZone({ jurisdiction: 'KZ', code: 'KZ_AIFC' });
    const tax = defaultZoneTax(p, z);
    expect(tax.vatRate).toBe(0);
    expect(tax.cit.rate).toBe(0);
    expect(tax.cit.mode).toBe('flat');
  });

  it('KZ_HUB zone override: 0% CIT, 5% dividend WHT', () => {
    const p = makeProject();
    const z = makeZone({ jurisdiction: 'KZ', code: 'KZ_HUB' });
    const tax = defaultZoneTax(p, z);
    expect(tax.vatRate).toBe(0);
    expect(tax.cit.rate).toBe(0);
    expect(tax.wht.dividends).toBe(0.05);
  });

  it('UAE_FREEZONE_QFZP zone override: qfzp mode', () => {
    const p = makeProject();
    const z = makeZone({ jurisdiction: 'UAE', code: 'UAE_FREEZONE_QFZP' });
    const tax = defaultZoneTax(p, z);
    expect(tax.cit.mode).toBe('qfzp');
    expect(tax.cit.qualifyingRate).toBe(0);
  });

  it('HK_OFFSHORE zone override: 0% CIT', () => {
    const p = makeProject();
    const z = makeZone({ jurisdiction: 'HK', code: 'HK_OFFSHORE' });
    const tax = defaultZoneTax(p, z);
    expect(tax.cit.mode).toBe('flat');
    expect(tax.cit.rate).toBe(0);
  });

  it('effectiveZoneTax merges zone.tax overrides on top of defaults', () => {
    const p = makeProject();
    const z = makeZone({
      jurisdiction: 'KZ', code: 'KZ_MAIN',
      tax: { vatRate: 0.12 },
    });
    const tax = effectiveZoneTax(p, z);
    expect(tax.vatRate).toBe(0.12); // overridden
    expect(tax.cit).toBeDefined(); // from defaults
  });
});

describe('ensureZoneTaxDefaults', () => {
  it('initializes empty tax objects on zones', () => {
    const z = makeZone();
    (z as any).tax = undefined;
    const p = makeProject({ zones: [z] });
    ensureZoneTaxDefaults(p);
    expect(z.tax).toEqual({});
  });
});

// ─── WHT ────────────────────────────────────────────────────────────────────

describe('whtDefaultPercentForFlow', () => {
  it('returns correct WHT % for KZ dividends (15%)', () => {
    const p = makeProject();
    const z = makeZone({ jurisdiction: 'KZ', code: 'KZ_MAIN' });
    const tax = effectiveZoneTax(p, z);
    expect(whtDefaultPercentForFlow(tax, 'Dividends')).toBe(15);
  });

  it('returns 0 for Salary (no WHT)', () => {
    const p = makeProject();
    const z = makeZone({ jurisdiction: 'KZ', code: 'KZ_MAIN' });
    const tax = effectiveZoneTax(p, z);
    expect(whtDefaultPercentForFlow(tax, 'Salary')).toBe(0);
  });

  it('returns 0 for BVI (no WHT jurisdiction)', () => {
    const p = makeProject();
    const z = makeZone({ jurisdiction: 'BVI', code: 'BVI_MAIN' });
    const tax = effectiveZoneTax(p, z);
    expect(whtDefaultPercentForFlow(tax, 'Dividends')).toBe(0);
  });
});

describe('computeWht', () => {
  it('computes WHT on dividends from KZ payer', () => {
    const payer = makeNode('KZ Co', 'company', 100, 100);
    payer.zoneId = 'z_kz';
    const payee = makeNode('UAE Co', 'company', 200, 200);
    payee.zoneId = 'z_uae';
    const zKz = makeZone({ id: 'z_kz', jurisdiction: 'KZ', code: 'KZ_MAIN', currency: 'KZT' });
    const zUae = makeZone({ id: 'z_uae', jurisdiction: 'UAE', code: 'UAE_MAIN', currency: 'AED' });
    const flow = makeFlow({ fromId: payer.id, toId: payee.id, whtRate: 15 });
    const p = makeProject({ zones: [zKz, zUae], nodes: [payer, payee], flows: [flow] });

    const result = computeWht(p, flow);
    // 1,000,000 KZT * 15% = 150,000 KZT WHT
    expect(result.amountOriginal).toBe(150_000);
    expect(result.originalCurrency).toBe('KZT');
    // Functional = same currency as payer zone (KZT)
    expect(result.amountFunctional).toBe(150_000);
    expect(result.functionalCurrency).toBe('KZT');
  });

  it('exempts Services flow from WHT (zone-rules.json exemption)', () => {
    const payer = makeNode('KZ Co', 'company', 100, 100);
    payer.zoneId = 'z_kz';
    const payee = makeNode('UAE Co', 'company', 200, 200);
    payee.zoneId = 'z_uae';
    const zKz = makeZone({ id: 'z_kz', jurisdiction: 'KZ', code: 'KZ_MAIN', currency: 'KZT' });
    const zUae = makeZone({ id: 'z_uae', jurisdiction: 'UAE', code: 'UAE_MAIN', currency: 'AED' });
    const flow = makeFlow({
      fromId: payer.id, toId: payee.id,
      flowType: 'Services', whtRate: 20,
    });
    const p = makeProject({ zones: [zKz, zUae], nodes: [payer, payee], flows: [flow] });

    const result = computeWht(p, flow);
    // Services exempt by zone-rules.json whtExemptionRules
    expect(result.amountOriginal).toBe(0);
    expect(result.appliedLawRef).toBe('KZ_NK_2026_ART_680_P1_S4');
  });

  it('exempts same-jurisdiction flows from WHT', () => {
    const co1 = makeNode('KZ Co 1', 'company', 100, 100);
    co1.zoneId = 'z_kz1';
    const co2 = makeNode('KZ Co 2', 'company', 200, 200);
    co2.zoneId = 'z_kz2';
    const z1 = makeZone({ id: 'z_kz1', jurisdiction: 'KZ', code: 'KZ_MAIN', currency: 'KZT' });
    const z2 = makeZone({ id: 'z_kz2', jurisdiction: 'KZ', code: 'KZ_AIFC', currency: 'KZT' });
    const flow = makeFlow({
      fromId: co1.id, toId: co2.id,
      flowType: 'Dividends', whtRate: 15,
    });
    const p = makeProject({ zones: [z1, z2], nodes: [co1, co2], flows: [flow] });

    const result = computeWht(p, flow);
    expect(result.amountOriginal).toBe(0);
    expect(result.appliedLawRef).toBe('DOMESTIC_WHT_EXEMPTION');
  });

  it('returns 0 when payer node not found', () => {
    const flow = makeFlow({ fromId: 'nonexistent' });
    const p = makeProject();
    const result = computeWht(p, flow);
    expect(result.amount).toBe(0);
  });
});

// ─── Payroll ────────────────────────────────────────────────────────────────

describe('computePayroll', () => {
  it('computes KZ payroll breakdown for salary 500,000 KZT', () => {
    const p = makeProject();
    const z = makeZone({ jurisdiction: 'KZ', code: 'KZ_MAIN', currency: 'KZT' });
    const flow = makeFlow({ flowType: 'Salary', grossAmount: 500_000 });
    const result = computePayroll(p, flow, z);

    expect(result.total).toBeGreaterThan(0);
    expect(result.breakdown.length).toBeGreaterThan(0);

    // Check expected components exist
    const codes = result.breakdown.map((b) => b.code);
    expect(codes).toContain('PIT');
    expect(codes).toContain('PENSION_EMPLOYEE');
    expect(codes).toContain('SOCIAL_TAX_EMPLOYER');
    expect(codes).toContain('MEDICAL_EMPLOYER');
  });

  it('PIT is 10% of gross for KZ', () => {
    const p = makeProject();
    const z = makeZone({ jurisdiction: 'KZ', code: 'KZ_MAIN', currency: 'KZT' });
    const flow = makeFlow({ flowType: 'Salary', grossAmount: 500_000 });
    const result = computePayroll(p, flow, z);
    const pit = result.breakdown.find((b) => b.code === 'PIT');
    expect(pit).toBeDefined();
    expect(pit!.amount).toBe(50_000);
    expect(pit!.rate).toBe(0.10);
  });

  it('medical employer is capped at 40*MW base', () => {
    const p = makeProject();
    const z = makeZone({ jurisdiction: 'KZ', code: 'KZ_MAIN', currency: 'KZT' });
    // gross = 5,000,000 > 40 * 85,000 = 3,400,000
    const flow = makeFlow({ flowType: 'Salary', grossAmount: 5_000_000 });
    const result = computePayroll(p, flow, z);
    const med = result.breakdown.find((b) => b.code === 'MEDICAL_EMPLOYER');
    expect(med).toBeDefined();
    // Base capped at 3,400,000 * 0.03 = 102,000
    expect(med!.base).toBe(3_400_000);
    expect(med!.amount).toBe(102_000);
  });

  it('returns zero total when payerZone is null', () => {
    const p = makeProject();
    const flow = makeFlow({ flowType: 'Salary', grossAmount: 500_000 });
    const result = computePayroll(p, flow, null);
    expect(result.total).toBe(0);
    expect(result.breakdown).toEqual([]);
  });

  it('returns zero total for UAE (no payroll taxes)', () => {
    const p = makeProject();
    const z = makeZone({ jurisdiction: 'UAE', code: 'UAE_MAIN', currency: 'AED' });
    const flow = makeFlow({ flowType: 'Salary', grossAmount: 100_000 });
    const result = computePayroll(p, flow, z);
    // UAE has pitRate: 0, employerRate: 0, employeeRate: 0
    expect(result.total).toBe(0);
  });
});

// ─── Effective ETR ──────────────────────────────────────────────────────────

describe('effectiveEtrForCompany', () => {
  it('returns node etr when set and finite', () => {
    const co = makeNode('Co', 'company', 0, 0);
    co.etr = 0.15;
    co.zoneId = 'z_kz';
    const z = makeZone({ id: 'z_kz', jurisdiction: 'KZ', code: 'KZ_MAIN' });
    const p = makeProject({ zones: [z], nodes: [co] });
    expect(effectiveEtrForCompany(p, co)).toBe(0.15);
  });

  it('AIFC presence breach floors ETR at 20%', () => {
    const co = makeNode('AIFC Co', 'company', 0, 0);
    co.etr = 0.05; // actual ETR
    co.zoneId = 'z_aifc';
    co.complianceData = {
      substance: { employeesCount: 1, hasPhysicalOffice: true, cigaInZone: true },
      aifc: { usesCITBenefit: true, cigaInZone: false }, // breach!
      bvi: { relevantActivity: false, employees: 0, office: false },
    };
    const z = makeZone({ id: 'z_aifc', jurisdiction: 'KZ', code: 'KZ_AIFC', currency: 'KZT' });
    const p = makeProject({ zones: [z], nodes: [co] });
    expect(effectiveEtrForCompany(p, co)).toBe(0.20);
  });

  it('AIFC with CIGA → uses actual ETR', () => {
    const co = makeNode('AIFC Co', 'company', 0, 0);
    co.etr = 0.05;
    co.zoneId = 'z_aifc';
    co.complianceData = {
      substance: { employeesCount: 1, hasPhysicalOffice: true, cigaInZone: true },
      aifc: { usesCITBenefit: true, cigaInZone: true }, // has CIGA
      bvi: { relevantActivity: false, employees: 0, office: false },
    };
    const z = makeZone({ id: 'z_aifc', jurisdiction: 'KZ', code: 'KZ_AIFC', currency: 'KZT' });
    const p = makeProject({ zones: [z], nodes: [co] });
    expect(effectiveEtrForCompany(p, co)).toBe(0.05);
  });

  it('falls back to zone CIT rate when etr not set', () => {
    const co = makeNode('Co', 'company', 0, 0);
    (co as any).etr = NaN;
    co.zoneId = 'z_kz';
    const z = makeZone({ id: 'z_kz', jurisdiction: 'KZ', code: 'KZ_MAIN' });
    const p = makeProject({ zones: [z], nodes: [co] });
    // Falls back to citRateStandard = 0.20
    expect(effectiveEtrForCompany(p, co)).toBe(0.20);
  });
});

// ─── Dual-Track Analysis: Management Layer ──────────────────────────────────

describe('computeGroupTaxByTag (Management Layer)', () => {
  /**
   * Helper: build a two-node project with a cross-border dividend flow.
   * Both nodes share the given management tag.
   * Ownership edge is optional — omit it to test Capital Leakage.
   */
  function makeDualTrackProject(opts: { withOwnership: boolean }) {
    const kzCo = makeNode('KZ HoldCo', 'company', 100, 100);
    kzCo.zoneId = 'z_kz';
    kzCo.annualIncome = 1_000_000;
    kzCo.managementTags = ['group-alpha'];

    const uaeCo = makeNode('UAE OpCo', 'company', 400, 100);
    uaeCo.zoneId = 'z_uae';
    uaeCo.annualIncome = 2_000_000;
    uaeCo.managementTags = ['group-alpha'];

    const zKz = makeZone({ id: 'z_kz', jurisdiction: 'KZ', code: 'KZ_MAIN', currency: 'KZT' });
    const zUae = makeZone({ id: 'z_uae', jurisdiction: 'UAE', code: 'UAE_MAIN', currency: 'AED' });

    const flow = makeFlow({
      id: 'f_div',
      fromId: kzCo.id,
      toId: uaeCo.id,
      flowType: 'Dividends',
      currency: 'KZT',
      grossAmount: 500_000,
      whtRate: 15,
    });

    const ownership = opts.withOwnership
      ? [{ id: 'o_1', fromId: kzCo.id, toId: uaeCo.id, percent: 100, manualAdjustment: 0 }]
      : [];

    const p = makeProject({
      zones: [zKz, zUae],
      nodes: [kzCo, uaeCo],
      flows: [flow],
      ownership,
      baseCurrency: 'KZT',
    } as Partial<Project>);

    return { p, kzCo, uaeCo, flow };
  }

  it('detects Capital Leakage when tagged nodes have no ownership edge', () => {
    const { p } = makeDualTrackProject({ withOwnership: false });
    const summary = computeGroupTaxByTag(p, 'group-alpha');

    expect(summary.tag).toBe('group-alpha');
    expect(summary.nodeIds.length).toBe(2);

    // WHT on the dividend flow: 500,000 * 15% = 75,000 KZT
    // Both nodes share tag but no ownership → classified as capital leakage
    expect(summary.capitalLeakageBase).toBe(75_000);
    expect(summary.totalWHTBase).toBeGreaterThan(0);
  });

  it('reports zero Capital Leakage when tagged nodes HAVE an ownership edge', () => {
    const { p } = makeDualTrackProject({ withOwnership: true });
    const summary = computeGroupTaxByTag(p, 'group-alpha');

    expect(summary.tag).toBe('group-alpha');
    // Same WHT exists, but ownership edge means it is NOT capital leakage
    expect(summary.capitalLeakageBase).toBe(0);
    expect(summary.totalWHTBase).toBeGreaterThan(0);
  });

  it('returns empty summary for a tag with no matching nodes', () => {
    const { p } = makeDualTrackProject({ withOwnership: false });
    const summary = computeGroupTaxByTag(p, 'nonexistent-tag');

    expect(summary.nodeIds).toEqual([]);
    expect(summary.totalIncomeBase).toBe(0);
    expect(summary.totalCITBase).toBe(0);
    expect(summary.totalWHTBase).toBe(0);
    expect(summary.capitalLeakageBase).toBe(0);
    expect(summary.managementETR).toBe(0);
  });

  it('calculates managementETR = totalTax / totalIncome', () => {
    const { p } = makeDualTrackProject({ withOwnership: true });
    const summary = computeGroupTaxByTag(p, 'group-alpha');

    // totalTax = totalCIT + totalWHT; managementETR = totalTax / totalIncome
    expect(summary.managementETR).toBeGreaterThan(0);
    expect(summary.managementETR).toBeLessThanOrEqual(1);
    const expected = summary.totalTaxBase / summary.totalIncomeBase;
    expect(summary.managementETR).toBeCloseTo(expected, 4);
  });

  it('consolidatedCashFlow = income - tax - leakage', () => {
    const { p } = makeDualTrackProject({ withOwnership: false });
    const summary = computeGroupTaxByTag(p, 'group-alpha');

    const expectedCash = summary.totalIncomeBase - summary.totalTaxBase - summary.capitalLeakageBase;
    expect(summary.consolidatedCashFlow).toBeCloseTo(expectedCash, 0);
  });
});

// ─── Legal Layer Blindness: managementTags must not affect computeGroupTax ──

describe('computeGroupTax ignores managementTags (Legal Layer invariant)', () => {
  it('produces identical results with and without managementTags', () => {
    const kzCo = makeNode('KZ HoldCo', 'company', 100, 100);
    kzCo.zoneId = 'z_kz';
    kzCo.annualIncome = 1_000_000;

    const uaeCo = makeNode('UAE OpCo', 'company', 400, 100);
    uaeCo.zoneId = 'z_uae';
    uaeCo.annualIncome = 2_000_000;

    const zKz = makeZone({ id: 'z_kz', jurisdiction: 'KZ', code: 'KZ_MAIN', currency: 'KZT' });
    const zUae = makeZone({ id: 'z_uae', jurisdiction: 'UAE', code: 'UAE_MAIN', currency: 'AED' });

    const flow = makeFlow({
      fromId: kzCo.id,
      toId: uaeCo.id,
      flowType: 'Dividends',
      currency: 'KZT',
      grossAmount: 500_000,
      whtRate: 15,
    });

    const ownership = [
      { id: 'o_1', fromId: kzCo.id, toId: uaeCo.id, percent: 100, manualAdjustment: 0 },
    ];

    // Project WITHOUT managementTags
    const pWithout = makeProject({
      zones: [zKz, zUae],
      nodes: [kzCo, uaeCo],
      flows: [flow],
      ownership,
      baseCurrency: 'KZT',
    } as Partial<Project>);

    const resultWithout = computeGroupTax(pWithout);

    // Now add managementTags to both nodes
    kzCo.managementTags = ['group-alpha'];
    uaeCo.managementTags = ['group-alpha', 'group-beta'];

    const pWith = makeProject({
      zones: [zKz, zUae],
      nodes: [kzCo, uaeCo],
      flows: [flow],
      ownership,
      baseCurrency: 'KZT',
      shadowLinks: [{ id: 'sl_1', fromId: kzCo.id, toId: uaeCo.id, tag: 'group-alpha' }],
    } as Partial<Project>);

    const resultWith = computeGroupTax(pWith);

    // Legal layer must produce identical output regardless of managementTags
    expect(resultWith.totalCITBase).toBe(resultWithout.totalCITBase);
    expect(resultWith.totalWHTBase).toBe(resultWithout.totalWHTBase);
    expect(resultWith.totalTaxBase).toBe(resultWithout.totalTaxBase);
    expect(resultWith.totalIncomeBase).toBe(resultWithout.totalIncomeBase);
    expect(resultWith.totalEffectiveTaxRate).toBe(resultWithout.totalEffectiveTaxRate);
    expect(resultWith.citLiabilities.length).toBe(resultWithout.citLiabilities.length);
    expect(resultWith.whtLiabilities.length).toBe(resultWithout.whtLiabilities.length);
  });
});
