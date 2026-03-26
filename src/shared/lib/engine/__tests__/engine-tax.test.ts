import { describe, it, expect } from 'vitest';
import { bankersRound2 } from '../utils';
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
  recomputeRisks,
  computeControlFromPerson,
  isRelatedParty,
  checkCashLimit,
} from '../engine-risks';
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

  it('AIFC with CIGA + substance + separate accounting → uses actual ETR', () => {
    const co = makeNode('AIFC Co', 'company', 0, 0);
    co.etr = 0.05;
    co.zoneId = 'z_aifc';
    co.hasSubstance = true;
    co.hasSeparateAccounting = true;
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

    // WHT on the dividend flow: 500,000 * 5% = 25,000 KZT (progressive WHT, 5% tier)
    // Both nodes share tag but no ownership → classified as capital leakage
    expect(summary.capitalLeakageBase).toBe(25_000);
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

// ─── WHT Domestic Exemption in computeGroupTax ─────────────────────────────

describe('computeGroupTax WHT same-jurisdiction exemption', () => {
  it('domestic flows (KZ → KZ) yield exactly 0 WHT', () => {
    const kzCo1 = makeNode('KZ Payer', 'company', 100, 100);
    kzCo1.zoneId = 'z_kz';
    kzCo1.annualIncome = 2_000_000;

    const kzCo2 = makeNode('KZ Payee', 'company', 400, 100);
    kzCo2.zoneId = 'z_kz';
    kzCo2.annualIncome = 1_000_000;

    const zKz = makeZone({ id: 'z_kz', jurisdiction: 'KZ', code: 'KZ_MAIN', currency: 'KZT' });

    const domesticDividend = makeFlow({
      id: 'f_dom',
      fromId: kzCo1.id,
      toId: kzCo2.id,
      flowType: 'Dividends',
      currency: 'KZT',
      grossAmount: 500_000,
      whtRate: 15,
    });

    const p = makeProject({
      zones: [zKz],
      nodes: [kzCo1, kzCo2],
      flows: [domesticDividend],
      ownership: [{ id: 'o_1', fromId: kzCo1.id, toId: kzCo2.id, percent: 100, manualAdjustment: 0 }],
      baseCurrency: 'KZT',
    } as Partial<Project>);

    const result = computeGroupTax(p);
    // Same-jurisdiction → WHT must be 0
    expect(result.totalWHTBase).toBe(0);
    expect(result.whtLiabilities).toHaveLength(0);
  });

  it('cross-border flows (KZ → UAE) still incur WHT', () => {
    const kzCo = makeNode('KZ Payer', 'company', 100, 100);
    kzCo.zoneId = 'z_kz';
    kzCo.annualIncome = 2_000_000;

    const uaeCo = makeNode('UAE Payee', 'company', 400, 100);
    uaeCo.zoneId = 'z_uae';
    uaeCo.annualIncome = 1_000_000;

    const zKz = makeZone({ id: 'z_kz', jurisdiction: 'KZ', code: 'KZ_MAIN', currency: 'KZT' });
    const zUae = makeZone({ id: 'z_uae', jurisdiction: 'UAE', code: 'UAE_MAIN', currency: 'AED' });

    const crossBorderDividend = makeFlow({
      id: 'f_cross',
      fromId: kzCo.id,
      toId: uaeCo.id,
      flowType: 'Dividends',
      currency: 'KZT',
      grossAmount: 1_000_000,
      whtRate: 15,
    });

    const p = makeProject({
      zones: [zKz, zUae],
      nodes: [kzCo, uaeCo],
      flows: [crossBorderDividend],
      ownership: [],
      baseCurrency: 'KZT',
    } as Partial<Project>);

    const result = computeGroupTax(p);
    // Cross-border → progressive WHT: 1,000,000 * 5% = 50,000 (under 230k MRP threshold)
    expect(result.totalWHTBase).toBe(50_000);
    expect(result.whtLiabilities).toHaveLength(1);
  });
});

// ─── Risk Engine: CFC, SUBSTANCE_BREACH, Transfer Pricing ─────────────────

describe('recomputeRisks — CFC & Substance & TP', () => {
  /**
   * 3-level graph: Person(KZ) → 80% → Company(BVI) → 100% → Company(HK)
   * Both companies: ETR < 10%, income > CFC threshold, hasSubstance = false
   */
  function make3LevelProject(opts?: { bviSubstance?: boolean; hkSubstance?: boolean }) {
    const person = makeNode('UBO', 'person', 0, 0);
    person.zoneId = 'z_kz';
    (person as any).citizenship = ['KZ'];

    const bviCo = makeNode('BVI Shell', 'company', 200, 100);
    bviCo.zoneId = 'z_bvi';
    bviCo.annualIncome = 50_000_000; // > CFC threshold
    bviCo.etr = 0.0;
    bviCo.hasSubstance = opts?.bviSubstance ?? false;

    const hkCo = makeNode('HK OpCo', 'company', 400, 100);
    hkCo.zoneId = 'z_hk';
    hkCo.annualIncome = 80_000_000;
    hkCo.etr = 0.05; // < 10%
    hkCo.hasSubstance = opts?.hkSubstance ?? false;

    const zKz = makeZone({ id: 'z_kz', jurisdiction: 'KZ', code: 'KZ_MAIN', currency: 'KZT' });
    const zBvi = makeZone({ id: 'z_bvi', jurisdiction: 'BVI', code: 'BVI_MAIN', currency: 'USD' });
    const zHk = makeZone({ id: 'z_hk', jurisdiction: 'HK', code: 'HK_MAIN', currency: 'HKD' });

    const ownership = [
      { id: 'o_1', fromId: person.id, toId: bviCo.id, percent: 80, manualAdjustment: 0 },
      { id: 'o_2', fromId: bviCo.id, toId: hkCo.id, percent: 100, manualAdjustment: 0 },
    ];

    const p = makeProject({
      zones: [zKz, zBvi, zHk],
      nodes: [person, bviCo, hkCo],
      ownership,
      flows: [],
      baseCurrency: 'KZT',
    } as Partial<Project>);

    return { p, person, bviCo, hkCo };
  }

  it('triggers CFC_RISK + SUBSTANCE_BREACH on both BVI and HK (3-level UBO)', () => {
    const { p, bviCo, hkCo } = make3LevelProject();
    recomputeRisks(p);

    // CFC_RISK on both entities (hasSubstance = false)
    const bviCfc = bviCo.riskFlags.filter((r: any) => r.type === 'CFC_RISK');
    const hkCfc = hkCo.riskFlags.filter((r: any) => r.type === 'CFC_RISK');
    expect(bviCfc.length).toBeGreaterThanOrEqual(1);
    expect(hkCfc.length).toBeGreaterThanOrEqual(1);

    // SUBSTANCE_BREACH accompanies CFC_RISK when hasSubstance === false
    const bviSub = bviCo.riskFlags.filter((r: any) => r.type === 'SUBSTANCE_BREACH');
    const hkSub = hkCo.riskFlags.filter((r: any) => r.type === 'SUBSTANCE_BREACH');
    expect(bviSub.length).toBeGreaterThanOrEqual(1);
    expect(hkSub.length).toBeGreaterThanOrEqual(1);
  });

  it('indirect ownership multiplies across edges (80% * 100% = 80%)', () => {
    const { p, person, hkCo } = make3LevelProject();
    // Person → 80% → BVI → 100% → HK: indirect = 0.80 * 1.0 = 0.80
    const control = computeControlFromPerson(p, person.id);
    expect(control.get(hkCo.id)).toBeCloseTo(0.80, 4);
  });

  it('Safe Harbor: no CFC_RISK and no SUBSTANCE_BREACH when hasSubstance is true', () => {
    const { p, bviCo, hkCo } = make3LevelProject({ bviSubstance: true, hkSubstance: true });
    recomputeRisks(p);

    // Substance exemption protects from CFC_RISK entirely
    const bviCfc = bviCo.riskFlags.filter((r: any) => r.type === 'CFC_RISK');
    const hkCfc = hkCo.riskFlags.filter((r: any) => r.type === 'CFC_RISK');
    expect(bviCfc).toHaveLength(0);
    expect(hkCfc).toHaveLength(0);

    // No SUBSTANCE_BREACH from CFC check either
    const bviSub = bviCo.riskFlags.filter((r: any) => r.type === 'SUBSTANCE_BREACH' && r.lawRef === 'KZ_CFC_SUBSTANCE');
    const hkSub = hkCo.riskFlags.filter((r: any) => r.type === 'SUBSTANCE_BREACH' && r.lawRef === 'KZ_CFC_SUBSTANCE');
    expect(bviSub).toHaveLength(0);
    expect(hkSub).toHaveLength(0);
  });

  it('flags TRANSFER_PRICING_RISK on cross-border Royalties between related parties', () => {
    const { p, bviCo, hkCo } = make3LevelProject();

    // Add a cross-border Royalties flow between related companies
    const royaltyFlow = makeFlow({
      id: 'f_royalty',
      fromId: bviCo.id,
      toId: hkCo.id,
      flowType: 'Royalties',
      currency: 'USD',
      grossAmount: 500_000,
    });
    p.flows.push(royaltyFlow);

    recomputeRisks(p);

    const bviTp = bviCo.riskFlags.filter((r: any) => r.type === 'TRANSFER_PRICING_RISK');
    expect(bviTp.length).toBeGreaterThanOrEqual(1);
  });

  it('flags TRANSFER_PRICING_RISK on cross-border Services between related parties', () => {
    const { p, bviCo, hkCo } = make3LevelProject();

    const serviceFlow = makeFlow({
      id: 'f_svc',
      fromId: bviCo.id,
      toId: hkCo.id,
      flowType: 'Services',
      currency: 'USD',
      grossAmount: 300_000,
    });
    p.flows.push(serviceFlow);

    recomputeRisks(p);

    const bviTp = bviCo.riskFlags.filter((r: any) => r.type === 'TRANSFER_PRICING_RISK');
    expect(bviTp.length).toBeGreaterThanOrEqual(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 2 — Temporal Resolution, Progressive WHT, Cyprus Defensive, AIFC/Hub
// ═══════════════════════════════════════════════════════════════════════════════

import {
  resolveTemporalRate,
  resolveTemporalWHTBrackets,
  resolveMRP,
  resolveKZVatRate,
  computeProgressiveWHTDividends,
  computeNexusFraction,
  computeAstanaHubCIT,
  isLowTaxJurisdiction,
  areInSameTaxGroup,
} from '../engine-tax';
import type { TemporalRate, TemporalWHTBrackets, NexusFractionParams } from '@shared/types';

// ─── Temporal Resolution ────────────────────────────────────────────────────

describe('Temporal Resolution Engine', () => {
  const rates: TemporalRate[] = [
    { validFrom: '2024-01-01', validTo: '2025-12-31', value: 0.12 },
    { validFrom: '2026-01-01', validTo: null, value: 0.16 },
  ];

  it('resolves rate for a date within the first window', () => {
    expect(resolveTemporalRate(rates, '2025-06-15')).toBe(0.12);
  });

  it('resolves rate for a date in the second (open-ended) window', () => {
    expect(resolveTemporalRate(rates, '2026-03-01')).toBe(0.16);
  });

  it('returns null for a date before all windows', () => {
    expect(resolveTemporalRate(rates, '2023-06-01')).toBeNull();
  });

  it('returns null for empty array', () => {
    expect(resolveTemporalRate([], '2026-01-01')).toBeNull();
  });

  it('handles ISO datetime strings (strips time component)', () => {
    expect(resolveTemporalRate(rates, '2026-06-15T12:00:00Z')).toBe(0.16);
  });
});

describe('resolveTemporalWHTBrackets', () => {
  const entries: TemporalWHTBrackets[] = [
    {
      validFrom: '2026-01-01',
      validTo: null,
      brackets: [
        { upToMRP: 230000, rate: 0.05 },
        { upToMRP: null, rate: 0.15 },
      ],
    },
  ];

  it('returns brackets for a matching date', () => {
    const result = resolveTemporalWHTBrackets(entries, '2026-06-15');
    expect(result).toHaveLength(2);
    expect(result![0].rate).toBe(0.05);
    expect(result![1].rate).toBe(0.15);
  });

  it('returns null for a date before the window', () => {
    expect(resolveTemporalWHTBrackets(entries, '2025-12-31')).toBeNull();
  });
});

describe('resolveMRP', () => {
  it('resolves MRP value for 2026', () => {
    expect(resolveMRP('2026-03-01')).toBe(4325);
  });

  it('resolves MRP value for 2025', () => {
    expect(resolveMRP('2025-06-15')).toBe(3932);
  });
});

describe('resolveKZVatRate', () => {
  it('returns 0.16 for dates >= 2026-01-01', () => {
    expect(resolveKZVatRate('2026-03-01')).toBe(0.16);
  });

  it('returns 0.12 for dates in 2025', () => {
    expect(resolveKZVatRate('2025-06-15')).toBe(0.12);
  });
});

// ─── KZ Progressive WHT (Dividends) ────────────────────────────────────────

describe('computeProgressiveWHTDividends', () => {
  it('applies 5% rate for amounts under 230,000 MRP threshold', () => {
    // 500,000 KZT << 230,000 * 4325 = 994,750,000 KZT → entirely in 5% bracket
    const result = computeProgressiveWHTDividends(500_000, '2026-06-15');
    expect(result.whtAmount).toBe(25_000);
    expect(result.effectiveRate).toBeCloseTo(0.05, 4);
  });

  it('applies 5% + 15% for amounts exceeding 230,000 MRP', () => {
    // 230,000 MRP * 4,325 = 994,750,000 KZT
    const threshold = 230_000 * 4325;
    const amount = threshold + 100_000_000; // 100M over threshold
    const result = computeProgressiveWHTDividends(amount, '2026-06-15');
    // First bracket: 994,750,000 * 5% = 49,737,500
    // Second bracket: 100,000,000 * 15% = 15,000,000
    // Total: 64,737,500
    const expected = bankersRound2(threshold * 0.05 + 100_000_000 * 0.15);
    expect(result.whtAmount).toBe(expected);
    // Effective rate is between 5% and 15%
    expect(result.effectiveRate).toBeGreaterThan(0.05);
    expect(result.effectiveRate).toBeLessThan(0.15);
  });

  it('applies flat 15% fallback for pre-2026 dates', () => {
    const result = computeProgressiveWHTDividends(1_000_000, '2025-06-15');
    expect(result.whtAmount).toBe(150_000);
    expect(result.effectiveRate).toBe(0.15);
  });

  it('returns 0 for zero amount', () => {
    const result = computeProgressiveWHTDividends(0, '2026-06-15');
    expect(result.whtAmount).toBe(0);
  });
});

// ─── Astana Hub Nexus Fraction ──────────────────────────────────────────────

describe('computeNexusFraction', () => {
  it('calculates K = (rUp + rOut1) * 1.3 / (rUp + rOut1 + rOut2 + rAcq)', () => {
    const params: NexusFractionParams = { rUp: 100, rOut1: 50, rOut2: 30, rAcq: 20 };
    // (100 + 50) * 1.3 / (100 + 50 + 30 + 20) = 195 / 200 = 0.975
    expect(computeNexusFraction(params)).toBeCloseTo(0.975, 4);
  });

  it('caps at 1.0 when numerator exceeds denominator', () => {
    const params: NexusFractionParams = { rUp: 100, rOut1: 0, rOut2: 0, rAcq: 0 };
    // (100 + 0) * 1.3 / (100 + 0 + 0 + 0) = 130 / 100 = 1.3 → capped at 1.0
    expect(computeNexusFraction(params)).toBe(1.0);
  });

  it('returns 0 when denominator is 0', () => {
    const params: NexusFractionParams = { rUp: 0, rOut1: 0, rOut2: 0, rAcq: 0 };
    expect(computeNexusFraction(params)).toBe(0);
  });

  it('handles mixed R&D costs correctly', () => {
    const params: NexusFractionParams = { rUp: 200, rOut1: 100, rOut2: 200, rAcq: 500 };
    // (200 + 100) * 1.3 / (200 + 100 + 200 + 500) = 390 / 1000 = 0.39
    expect(computeNexusFraction(params)).toBeCloseTo(0.39, 4);
  });
});

describe('computeAstanaHubCIT', () => {
  it('returns 0 CIT for non-IP income at Astana Hub (100% reduction)', () => {
    const node = makeNode('Hub Co', 'company', 0, 0);
    expect(computeAstanaHubCIT(1_000_000, node, 0.20)).toBe(0);
  });

  it('scales CIT reduction by Nexus fraction for IP income', () => {
    const node = makeNode('Hub IP Co', 'company', 0, 0);
    node.isIPIncome = true;
    node.nexusParams = { rUp: 100, rOut1: 50, rOut2: 30, rAcq: 20 };
    // K = 0.975 → taxable = 1,000,000 * (1 - 0.975) = 25,000
    // CIT = 25,000 * 0.20 = 5,000
    const cit = computeAstanaHubCIT(1_000_000, node, 0.20);
    expect(cit).toBe(5_000);
  });

  it('returns 0 for zero income', () => {
    const node = makeNode('Hub Co', 'company', 0, 0);
    expect(computeAstanaHubCIT(0, node, 0.20)).toBe(0);
  });
});

// ─── Cyprus Defensive Measures ──────────────────────────────────────────────

describe('Cyprus Defensive Measures', () => {
  it('isLowTaxJurisdiction returns true for BVI in 2026', () => {
    expect(isLowTaxJurisdiction('BVI', '2026-06-15')).toBe(true);
  });

  it('isLowTaxJurisdiction returns true for CAY in 2026', () => {
    expect(isLowTaxJurisdiction('CAY', '2026-06-15')).toBe(true);
  });

  it('isLowTaxJurisdiction returns false for KZ', () => {
    expect(isLowTaxJurisdiction('KZ', '2026-06-15')).toBe(false);
  });

  it('isLowTaxJurisdiction returns false before 2026 (measures not active)', () => {
    expect(isLowTaxJurisdiction('BVI', '2025-06-15')).toBe(false);
  });

  it('forces 17% penalty WHT on CY → BVI dividend flows in computeGroupTax', () => {
    const cyCo = makeNode('CY HoldCo', 'company', 100, 100);
    cyCo.zoneId = 'z_cy';
    cyCo.annualIncome = 5_000_000;

    const bviCo = makeNode('BVI Shell', 'company', 400, 100);
    bviCo.zoneId = 'z_bvi';
    bviCo.annualIncome = 1_000_000;

    const zCy = makeZone({ id: 'z_cy', jurisdiction: 'CY', code: 'CY_STD', currency: 'EUR' });
    const zBvi = makeZone({ id: 'z_bvi', jurisdiction: 'BVI', code: 'BVI_STD', currency: 'USD' });

    const divFlow = makeFlow({
      id: 'f_cy_bvi_div',
      fromId: cyCo.id,
      toId: bviCo.id,
      flowType: 'Dividends',
      currency: 'EUR',
      grossAmount: 1_000_000,
      whtRate: 0,
      flowDate: '2026-06-15T12:00:00Z',
    });

    const p = makeProject({
      zones: [zCy, zBvi],
      nodes: [cyCo, bviCo],
      flows: [divFlow],
      ownership: [],
      baseCurrency: 'EUR',
    } as Partial<Project>);

    const result = computeGroupTax(p);
    // CY defensive: 17% penalty WHT on dividends to LTJ
    expect(result.whtLiabilities).toHaveLength(1);
    expect(result.whtLiabilities[0].whtRatePercent).toBe(17);
    expect(result.whtLiabilities[0].whtAmountOriginal).toBe(170_000);
  });

  it('does NOT apply penalty WHT on CY → KZ dividend flows (KZ is not LTJ)', () => {
    const cyCo = makeNode('CY HoldCo', 'company', 100, 100);
    cyCo.zoneId = 'z_cy';
    cyCo.annualIncome = 5_000_000;

    const kzCo = makeNode('KZ OpCo', 'company', 400, 100);
    kzCo.zoneId = 'z_kz';
    kzCo.annualIncome = 1_000_000;

    const zCy = makeZone({ id: 'z_cy', jurisdiction: 'CY', code: 'CY_STD', currency: 'EUR' });
    const zKz = makeZone({ id: 'z_kz', jurisdiction: 'KZ', code: 'KZ_MAIN', currency: 'KZT' });

    const divFlow = makeFlow({
      id: 'f_cy_kz_div',
      fromId: cyCo.id,
      toId: kzCo.id,
      flowType: 'Dividends',
      currency: 'EUR',
      grossAmount: 1_000_000,
      whtRate: 0,
      flowDate: '2026-06-15T12:00:00Z',
    });

    const p = makeProject({
      zones: [zCy, zKz],
      nodes: [cyCo, kzCo],
      flows: [divFlow],
      ownership: [],
      baseCurrency: 'EUR',
    } as Partial<Project>);

    const result = computeGroupTax(p);
    // CY has 0% WHT on dividends normally, and KZ is not LTJ → 0 WHT
    expect(result.totalWHTBase).toBe(0);
  });
});

// ─── UAE Tax Groups ─────────────────────────────────────────────────────────

describe('UAE Tax Groups', () => {
  it('areInSameTaxGroup returns true when both nodes in same group', () => {
    const p = makeProject({
      taxGroups: [{ id: 'tg1', name: 'UAE Group', nodeIds: ['n_1', 'n_2'], jurisdiction: 'UAE' }],
    } as Partial<Project>);
    expect(areInSameTaxGroup(p, 'n_1', 'n_2')).toBe(true);
  });

  it('areInSameTaxGroup returns false when nodes in different groups', () => {
    const p = makeProject({
      taxGroups: [
        { id: 'tg1', name: 'Group A', nodeIds: ['n_1'], jurisdiction: 'UAE' },
        { id: 'tg2', name: 'Group B', nodeIds: ['n_2'], jurisdiction: 'UAE' },
      ],
    } as Partial<Project>);
    expect(areInSameTaxGroup(p, 'n_1', 'n_2')).toBe(false);
  });

  it('areInSameTaxGroup returns false when no tax groups defined', () => {
    const p = makeProject();
    expect(areInSameTaxGroup(p, 'n_1', 'n_2')).toBe(false);
  });

  it('eliminates intra-group WHT in computeGroupTax', () => {
    const uaeCo1 = makeNode('UAE Co1', 'company', 100, 100);
    uaeCo1.zoneId = 'z_uae1';
    uaeCo1.annualIncome = 2_000_000;

    const uaeCo2 = makeNode('UAE Co2', 'company', 400, 100);
    uaeCo2.zoneId = 'z_uae2';
    uaeCo2.annualIncome = 1_000_000;

    // Two UAE zones with different codes but different jurisdictions to avoid same-jurisdiction skip
    // Actually for UAE tax groups, let's use different jurisdictions to see the elimination
    const zUae1 = makeZone({ id: 'z_uae1', jurisdiction: 'UAE', code: 'UAE_MAIN', currency: 'AED' });
    const zUae2 = makeZone({ id: 'z_uae2', jurisdiction: 'SG', code: 'SG_STD', currency: 'SGD' });

    const flow = makeFlow({
      id: 'f_intragroup',
      fromId: uaeCo1.id,
      toId: uaeCo2.id,
      flowType: 'Interest',
      currency: 'AED',
      grossAmount: 500_000,
      whtRate: 10,
      flowDate: '2026-06-15T12:00:00Z',
    });

    const p = makeProject({
      zones: [zUae1, zUae2],
      nodes: [uaeCo1, uaeCo2],
      flows: [flow],
      taxGroups: [{ id: 'tg1', name: 'Consolidated', nodeIds: [uaeCo1.id, uaeCo2.id], jurisdiction: 'UAE' }],
      baseCurrency: 'AED',
    } as Partial<Project>);

    const result = computeGroupTax(p);
    // Intra-group flows are eliminated → 0 WHT
    expect(result.totalWHTBase).toBe(0);
    expect(result.whtLiabilities).toHaveLength(0);
  });
});

// ─── AIFC Substance + Separate Accounting Gate ──────────────────────────────

describe('AIFC 0% CIT conditions (substance + CIGA + separate accounting)', () => {
  it('denies 0% benefit when hasSubstance is false (floors ETR at 20%)', () => {
    const co = makeNode('AIFC Co', 'company', 0, 0);
    co.etr = 0.05;
    co.zoneId = 'z_aifc';
    co.hasSubstance = false;
    co.hasSeparateAccounting = true;
    co.complianceData = {
      substance: { employeesCount: 0, hasPhysicalOffice: false, cigaInZone: true },
      aifc: { usesCITBenefit: true, cigaInZone: true },
      bvi: { relevantActivity: false, employees: 0, office: false },
    };
    const z = makeZone({ id: 'z_aifc', jurisdiction: 'KZ', code: 'KZ_AIFC', currency: 'KZT' });
    const p = makeProject({ zones: [z], nodes: [co] });
    expect(effectiveEtrForCompany(p, co)).toBe(0.20);
  });

  it('denies 0% benefit when hasSeparateAccounting is false', () => {
    const co = makeNode('AIFC Co', 'company', 0, 0);
    co.etr = 0.05;
    co.zoneId = 'z_aifc';
    co.hasSubstance = true;
    co.hasSeparateAccounting = false;
    co.complianceData = {
      substance: { employeesCount: 2, hasPhysicalOffice: true, cigaInZone: true },
      aifc: { usesCITBenefit: true, cigaInZone: true },
      bvi: { relevantActivity: false, employees: 0, office: false },
    };
    const z = makeZone({ id: 'z_aifc', jurisdiction: 'KZ', code: 'KZ_AIFC', currency: 'KZT' });
    const p = makeProject({ zones: [z], nodes: [co] });
    expect(effectiveEtrForCompany(p, co)).toBe(0.20);
  });

  it('grants 0% when all conditions met (substance + CIGA + separate accounting)', () => {
    const co = makeNode('AIFC Co', 'company', 0, 0);
    co.etr = 0.00;
    co.zoneId = 'z_aifc';
    co.hasSubstance = true;
    co.hasSeparateAccounting = true;
    co.complianceData = {
      substance: { employeesCount: 5, hasPhysicalOffice: true, cigaInZone: true },
      aifc: { usesCITBenefit: true, cigaInZone: true },
      bvi: { relevantActivity: false, employees: 0, office: false },
    };
    const z = makeZone({ id: 'z_aifc', jurisdiction: 'KZ', code: 'KZ_AIFC', currency: 'KZT' });
    const p = makeProject({ zones: [z], nodes: [co] });
    expect(effectiveEtrForCompany(p, co)).toBe(0.00);
  });
});

// ─── Risk Engine: PILLAR2_TRIGGER + Extended SUBSTANCE_BREACH ───────────────

describe('recomputeRisks — Pillar Two PILLAR2_TRIGGER', () => {
  it('emits PILLAR2_TRIGGER (not PILLAR2_TOPUP_RISK) when revenue > 750M EUR', () => {
    const co = makeNode('Low ETR Co', 'company', 100, 100);
    co.zoneId = 'z_bvi';
    co.annualIncome = 10_000_000;
    co.etr = 0.02;

    const zBvi = makeZone({ id: 'z_bvi', jurisdiction: 'BVI', code: 'BVI_STD', currency: 'USD' });

    const p = makeProject({
      zones: [zBvi],
      nodes: [co],
      group: { consolidatedRevenueEur: 1_000_000_000 },
      baseCurrency: 'USD',
    } as Partial<Project>);

    recomputeRisks(p);

    // Project-level flag should be PILLAR2_TRIGGER
    const trigger = p.projectRiskFlags.find((r) => r.type === 'PILLAR2_TRIGGER');
    expect(trigger).toBeDefined();
    expect(trigger!.lawRef).toBe('APP_G_G5_PILLAR2');

    // Entity-level flag remains PILLAR2_LOW_ETR
    const lowEtr = co.riskFlags.find((r) => r.type === 'PILLAR2_LOW_ETR');
    expect(lowEtr).toBeDefined();

    // Old name should NOT appear
    const oldTrigger = p.projectRiskFlags.find((r) => r.type === 'PILLAR2_TOPUP_RISK');
    expect(oldTrigger).toBeUndefined();
  });
});

describe('recomputeRisks — SUBSTANCE_BREACH on CAY/SEY (not just BVI)', () => {
  it('flags SUBSTANCE_BREACH on CAY entity with hasSubstance === false', () => {
    const co = makeNode('CAY Shell', 'company', 100, 100);
    co.zoneId = 'z_cay';
    co.hasSubstance = false;
    co.annualIncome = 1_000_000;

    const zCay = makeZone({ id: 'z_cay', jurisdiction: 'CAY', code: 'CAY_STD', currency: 'USD' });
    const p = makeProject({
      zones: [zCay],
      nodes: [co],
      baseCurrency: 'USD',
    } as Partial<Project>);

    recomputeRisks(p);

    const substance = co.riskFlags.filter((r) => r.type === 'SUBSTANCE_BREACH');
    expect(substance.length).toBeGreaterThanOrEqual(1);
    expect(substance[0].lawRef).toBe('OFFSHORE_SUBSTANCE_CAY');
  });

  it('flags SUBSTANCE_BREACH on SEY entity with hasSubstance === false', () => {
    const co = makeNode('SEY Entity', 'company', 100, 100);
    co.zoneId = 'z_sey';
    co.hasSubstance = false;
    co.annualIncome = 500_000;

    const zSey = makeZone({ id: 'z_sey', jurisdiction: 'SEY', code: 'SEY_STD', currency: 'SCR' });
    const p = makeProject({
      zones: [zSey],
      nodes: [co],
      baseCurrency: 'USD',
    } as Partial<Project>);

    recomputeRisks(p);

    const substance = co.riskFlags.filter((r) => r.type === 'SUBSTANCE_BREACH');
    expect(substance.length).toBeGreaterThanOrEqual(1);
    expect(substance[0].lawRef).toBe('OFFSHORE_SUBSTANCE_SEY');
  });

  it('does NOT flag SUBSTANCE_BREACH on CAY entity with hasSubstance === true', () => {
    const co = makeNode('CAY Real Co', 'company', 100, 100);
    co.zoneId = 'z_cay';
    co.hasSubstance = true;
    co.annualIncome = 1_000_000;

    const zCay = makeZone({ id: 'z_cay', jurisdiction: 'CAY', code: 'CAY_STD', currency: 'USD' });
    const p = makeProject({
      zones: [zCay],
      nodes: [co],
      baseCurrency: 'USD',
    } as Partial<Project>);

    recomputeRisks(p);

    const substance = co.riskFlags.filter(
      (r) => r.type === 'SUBSTANCE_BREACH' && r.lawRef === 'OFFSHORE_SUBSTANCE_CAY',
    );
    expect(substance).toHaveLength(0);
  });
});

// ─── Astana Hub CIT in computeGroupTax ──────────────────────────────────────

describe('computeGroupTax — Astana Hub Nexus integration', () => {
  it('applies Nexus fraction to Hub entity with IP income', () => {
    const hubCo = makeNode('Hub IP Co', 'company', 100, 100);
    hubCo.zoneId = 'z_hub';
    hubCo.annualIncome = 10_000_000;
    hubCo.isIPIncome = true;
    hubCo.nexusParams = { rUp: 100, rOut1: 50, rOut2: 30, rAcq: 20 };
    // K = (100+50)*1.3 / (100+50+30+20) = 195/200 = 0.975
    // Taxable = 10,000,000 * (1 - 0.975) = 250,000
    // CIT = 250,000 * 0.20 = 50,000

    const zKz = makeZone({ id: 'z_kz_parent', jurisdiction: 'KZ', code: 'KZ_MAIN', currency: 'KZT', zIndex: 10 });
    const zHub = makeZone({ id: 'z_hub', jurisdiction: 'KZ', code: 'KZ_HUB', currency: 'KZT', parentId: 'z_kz_parent', zIndex: 20 });

    const p = makeProject({
      zones: [zKz, zHub],
      nodes: [hubCo],
      baseCurrency: 'KZT',
    } as Partial<Project>);

    const result = computeGroupTax(p);
    const hubCIT = result.citLiabilities.find((c) => c.nodeId === hubCo.id);
    expect(hubCIT).toBeDefined();
    expect(hubCIT!.citAmount).toBe(50_000);
  });

  it('returns 0 CIT for Hub entity without IP income', () => {
    const hubCo = makeNode('Hub SaaS Co', 'company', 100, 100);
    hubCo.zoneId = 'z_hub';
    hubCo.annualIncome = 10_000_000;
    // isIPIncome not set → non-IP → full 100% CIT reduction → 0

    const zKz = makeZone({ id: 'z_kz_parent', jurisdiction: 'KZ', code: 'KZ_MAIN', currency: 'KZT', zIndex: 10 });
    const zHub = makeZone({ id: 'z_hub', jurisdiction: 'KZ', code: 'KZ_HUB', currency: 'KZT', parentId: 'z_kz_parent', zIndex: 20 });

    const p = makeProject({
      zones: [zKz, zHub],
      nodes: [hubCo],
      baseCurrency: 'KZT',
    } as Partial<Project>);

    const result = computeGroupTax(p);
    const hubCIT = result.citLiabilities.find((c) => c.nodeId === hubCo.id);
    expect(hubCIT).toBeDefined();
    expect(hubCIT!.citAmount).toBe(0);
  });
});

// ─── Cash Discipline (CASH_LIMIT_EXCEEDED) — integration ────────────────────

describe('Cash Discipline — 1000 MRP threshold', () => {
  it('checkCashLimit triggers when cash exceeds 1000 MRP', () => {
    const payer = makeNode('KZ Payer', 'company', 100, 100);
    payer.zoneId = 'z_kz';
    const payee = makeNode('KZ Payee', 'company', 400, 100);
    payee.zoneId = 'z_kz';
    const zKz = makeZone({ id: 'z_kz', jurisdiction: 'KZ', code: 'KZ_MAIN', currency: 'KZT' });

    // 1000 MCI * 4325 = 4,325,000 KZT threshold
    const flow = makeFlow({
      fromId: payer.id,
      toId: payee.id,
      flowType: 'Services',
      paymentMethod: 'cash',
      cashComponentAmount: 5_000_000,
      cashComponentCurrency: 'KZT',
      currency: 'KZT',
      grossAmount: 5_000_000,
    });

    const p = makeProject({
      zones: [zKz],
      nodes: [payer, payee],
      flows: [flow],
    } as Partial<Project>);

    const result = checkCashLimit(p, flow);
    expect(result.applicable).toBe(true);
    expect(result.exceeded).toBe(true);
  });
});
