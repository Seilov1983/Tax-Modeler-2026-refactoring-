import { describe, it, expect } from 'vitest';
import {
  SCHEMA_VERSION,
  ENGINE_VERSION,
  convert,
  getZone,
  getNode,
  listPersons,
  listCompanies,
  nodeCenter,
  pointInZone,
  zoneArea,
  detectZoneId,
  makeNode,
  makeTXA,
  ensureBalance,
  defaultMasterData,
  ensureMasterData,
  defaultCatalogs,
  defaultLawReferences,
  isJurisdictionEnabled,
  isZoneEnabled,
  clampToZoneRect,
} from '../engine-core';
import type { Project, Zone, NodeDTO } from '@shared/types';

// ─── Test Fixtures ──────────────────────────────────────────────────────────

function makeMinimalProject(overrides?: Partial<Project>): Project {
  return {
    schemaVersion: SCHEMA_VERSION,
    engineVersion: ENGINE_VERSION,
    projectId: 'test',
    title: 'Test Project',
    userId: 'user1',
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

// ─── Constants ──────────────────────────────────────────────────────────────

describe('Engine Constants', () => {
  it('SCHEMA_VERSION is 2.6.0', () => {
    expect(SCHEMA_VERSION).toBe('2.6.0');
  });

  it('ENGINE_VERSION is 0.11.0', () => {
    expect(ENGINE_VERSION).toBe('0.11.0');
  });
});

// ─── FX Conversion ──────────────────────────────────────────────────────────

describe('convert (FX via USD pivot)', () => {
  const p = makeMinimalProject();

  it('same currency returns same amount', () => {
    expect(convert(p, 1000, 'KZT', 'KZT')).toBe(1000);
  });

  it('USD → KZT uses rateToUSD directly', () => {
    // 1000 USD → 1000 / 1 * 500 = 500,000 KZT
    expect(convert(p, 1000, 'USD', 'KZT')).toBe(500_000);
  });

  it('KZT → USD is inverse', () => {
    // 500,000 KZT → 500,000 / 500 * 1 = 1000 USD
    expect(convert(p, 500_000, 'KZT', 'USD')).toBe(1000);
  });

  it('EUR → KZT goes through USD pivot', () => {
    // 1000 EUR → 1000 / 0.92 * 500 ≈ 543,478.26
    const result = convert(p, 1000, 'EUR', 'KZT');
    expect(result).toBeCloseTo(543_478.26, 0);
  });

  it('AED → KZT cross-conversion', () => {
    // 10,000 AED → 10,000 / 3.67 * 500 ≈ 1,362,397
    const result = convert(p, 10_000, 'AED', 'KZT');
    expect(result).toBeCloseTo(1_362_397, -2);
  });

  it('handles missing currency rate (falls back to 1)', () => {
    // Unknown currency rate defaults to 1 (treated as USD)
    const result = convert(p, 100, 'XYZ', 'USD');
    expect(result).toBe(100);
  });
});

// ─── Graph Utils ────────────────────────────────────────────────────────────

describe('getZone / getNode', () => {
  const zone = makeZone();
  const node = makeNode('TestCo', 'company', 100, 100);
  const p = makeMinimalProject({ zones: [zone], nodes: [node] });

  it('getZone finds zone by id', () => {
    expect(getZone(p, 'z_kz')).toBe(zone);
  });

  it('getZone returns null for unknown id', () => {
    expect(getZone(p, 'nonexistent')).toBeNull();
    expect(getZone(p, null)).toBeNull();
  });

  it('getNode finds node by id', () => {
    expect(getNode(p, node.id)).toBe(node);
  });

  it('getNode returns null for unknown id', () => {
    expect(getNode(p, 'nonexistent')).toBeNull();
  });
});

describe('listPersons / listCompanies', () => {
  const co = makeNode('Co', 'company', 0, 0);
  const per = makeNode('Person', 'person', 0, 0);
  const txa: NodeDTO = { id: 'txa_1', name: 'TXA', type: 'txa', x: 0, y: 0, w: 190, h: 90, zoneId: null, frozen: false, riskFlags: [], annualIncome: 0, etr: 0, balances: {} };
  const p = makeMinimalProject({ nodes: [co, per, txa] });

  it('listPersons returns only persons', () => {
    expect(listPersons(p)).toEqual([per]);
  });

  it('listCompanies returns only companies', () => {
    expect(listCompanies(p)).toEqual([co]);
  });
});

// ─── Geometry ───────────────────────────────────────────────────────────────

describe('Geometry utilities', () => {
  it('nodeCenter calculates center correctly', () => {
    const node = { x: 100, y: 200, w: 190, h: 90 } as NodeDTO;
    const center = nodeCenter(node);
    expect(center.cx).toBe(195);
    expect(center.cy).toBe(245);
  });

  it('pointInZone detects point inside zone', () => {
    const z = makeZone({ x: 0, y: 0, w: 800, h: 600 });
    expect(pointInZone(100, 100, z)).toBe(true);
    expect(pointInZone(0, 0, z)).toBe(true);
    expect(pointInZone(800, 600, z)).toBe(true);
  });

  it('pointInZone detects point outside zone', () => {
    const z = makeZone({ x: 100, y: 100, w: 400, h: 300 });
    expect(pointInZone(50, 50, z)).toBe(false);
    expect(pointInZone(600, 600, z)).toBe(false);
  });

  it('zoneArea returns correct area', () => {
    const z = makeZone({ w: 800, h: 600 });
    expect(zoneArea(z)).toBe(480_000);
  });
});

describe('detectZoneId', () => {
  it('assigns node to smallest enclosing zone', () => {
    const outerZone = makeZone({ id: 'z_outer', x: 0, y: 0, w: 1000, h: 1000 });
    const innerZone = makeZone({ id: 'z_inner', x: 100, y: 100, w: 300, h: 300 });
    const node = makeNode('Co', 'company', 150, 150);
    node.w = 50; node.h = 50;
    const p = makeMinimalProject({ zones: [outerZone, innerZone], nodes: [node] });

    expect(detectZoneId(p, node)).toBe('z_inner');
  });

  it('returns null when node is outside all zones', () => {
    const zone = makeZone({ x: 0, y: 0, w: 100, h: 100 });
    const node = makeNode('Co', 'company', 500, 500);
    const p = makeMinimalProject({ zones: [zone], nodes: [node] });

    expect(detectZoneId(p, node)).toBeNull();
  });
});

// ─── clampToZoneRect ────────────────────────────────────────────────────────

describe('clampToZoneRect', () => {
  const zone = makeZone({ x: 0, y: 0, w: 800, h: 600 });
  const node = { w: 190, h: 90 } as NodeDTO;

  it('clamps node within zone bounds with padding', () => {
    const result = clampToZoneRect(zone, node, -50, -50);
    expect(result.x).toBe(10);
    expect(result.y).toBe(10);
  });

  it('clamps node at right/bottom edge', () => {
    const result = clampToZoneRect(zone, node, 900, 900);
    expect(result.x).toBe(800 - 190 - 10);
    expect(result.y).toBe(600 - 90 - 10);
  });

  it('allows custom padding', () => {
    const result = clampToZoneRect(zone, node, -50, -50, 20);
    expect(result.x).toBe(20);
    expect(result.y).toBe(20);
  });
});

// ─── Node & TXA Factories ───────────────────────────────────────────────────

describe('makeNode', () => {
  it('creates company node with correct defaults', () => {
    const node = makeNode('TestCo', 'company', 100, 200);
    expect(node.name).toBe('TestCo');
    expect(node.type).toBe('company');
    expect(node.x).toBe(100);
    expect(node.y).toBe(200);
    expect(node.id).toMatch(/^n_/);
    expect(node.frozen).toBe(false);
    expect(node.complianceData).toBeDefined();
    expect(node.ledger).toBeDefined();
  });

  it('creates person node with correct defaults', () => {
    const node = makeNode('John', 'person', 50, 50);
    expect(node.type).toBe('person');
    expect(node.citizenship).toEqual(['KZ']);
    expect(node.taxResidency).toEqual(['KZ']);
    expect(node.investments).toBeDefined();
  });

  it('generates unique IDs', () => {
    const a = makeNode('A', 'company', 0, 0);
    const b = makeNode('B', 'company', 0, 0);
    expect(a.id).not.toBe(b.id);
  });
});

describe('makeTXA', () => {
  it('creates TXA node positioned in zone corner', () => {
    const zone = makeZone({ id: 'z1', w: 800, h: 600, currency: 'KZT' });
    const txa = makeTXA(zone);
    expect(txa.type).toBe('txa');
    expect(txa.id).toBe('txa_z1');
    expect(txa.zoneId).toBe('z1');
    expect(txa.balances).toHaveProperty('KZT', 0);
  });
});

describe('ensureBalance', () => {
  it('initializes missing currency balance to 0', () => {
    const node = makeNode('Co', 'company', 0, 0);
    ensureBalance(node, 'BTC');
    expect(node.balances.BTC).toBe(0);
  });

  it('does not overwrite existing balance', () => {
    const node = makeNode('Co', 'company', 0, 0);
    node.balances.USD = 1000;
    ensureBalance(node, 'USD');
    expect(node.balances.USD).toBe(1000);
  });
});

// ─── Master Data ────────────────────────────────────────────────────────────

describe('defaultMasterData', () => {
  const md = defaultMasterData();

  it('contains all 10 jurisdictions', () => {
    const jurisdictions = Object.keys(md);
    expect(jurisdictions).toHaveLength(10);
    expect(jurisdictions).toContain('KZ');
    expect(jurisdictions).toContain('UAE');
    expect(jurisdictions).toContain('HK');
    expect(jurisdictions).toContain('BVI');
    expect(jurisdictions).toContain('SEY');
  });

  it('KZ has correct MCI and min wage', () => {
    const kz = md.KZ!;
    expect(kz.mciValue).toBe(4325);
    expect(kz.minWage).toBe(85_000);
    expect(kz.vatRateStandard).toBe(0.16);
    expect(kz.citRateStandard).toBe(0.20);
  });

  it('UAE has threshold CIT mode', () => {
    const uae = md.UAE!;
    expect(uae.cit?.mode).toBe('threshold');
    expect(uae.cit?.zeroUpTo).toBe(375_000);
    expect(uae.cit?.mainRate).toBe(0.09);
  });

  it('HK has two-tier CIT mode', () => {
    const hk = md.HK!;
    expect(hk.cit?.mode).toBe('twoTier');
    expect(hk.cit?.smallLimit).toBe(2_000_000);
  });

  it('SEY has brackets CIT mode', () => {
    const sey = md.SEY!;
    expect(sey.cit?.mode).toBe('brackets');
    expect(sey.cit?.brackets).toHaveLength(2);
  });

  it('UK has smallProfits CIT mode', () => {
    const uk = md.UK!;
    expect(uk.cit?.mode).toBe('smallProfits');
    expect(uk.cit?.smallLimit).toBe(50_000);
    expect(uk.cit?.mainLimit).toBe(250_000);
  });

  it('BVI has zero tax', () => {
    const bvi = md.BVI!;
    expect(bvi.citRateStandard).toBe(0);
    expect(bvi.wht.dividends).toBe(0);
  });
});

describe('ensureMasterData', () => {
  it('fills missing jurisdictions with defaults', () => {
    const p = makeMinimalProject({ masterData: {} });
    ensureMasterData(p);
    expect(p.masterData.KZ).toBeDefined();
    expect(p.masterData.UAE).toBeDefined();
  });

  it('preserves user overrides via deepMerge', () => {
    const p = makeMinimalProject({ masterData: { KZ: { mciValue: 5000 } } as any });
    ensureMasterData(p);
    expect((p.masterData.KZ as any).mciValue).toBe(5000);
    expect(p.masterData.KZ!.vatRateStandard).toBe(0.16);
  });
});

// ─── Jurisdiction / Zone Enabled ────────────────────────────────────────────

describe('isJurisdictionEnabled', () => {
  it('returns true when jurisdiction is in activeJurisdictions', () => {
    const p = makeMinimalProject();
    expect(isJurisdictionEnabled(p, 'KZ')).toBe(true);
  });

  it('returns false when jurisdiction is not active', () => {
    const p = makeMinimalProject({ activeJurisdictions: ['KZ'] });
    expect(isJurisdictionEnabled(p, 'UAE')).toBe(false);
  });
});

describe('isZoneEnabled', () => {
  it('returns true for visible zone in active jurisdiction', () => {
    const z = makeZone({ jurisdiction: 'KZ' });
    const p = makeMinimalProject({ zones: [z] });
    expect(isZoneEnabled(p, z)).toBe(true);
  });

  it('returns false for hidden zone', () => {
    const z = makeZone({ id: 'z_hidden', jurisdiction: 'KZ' });
    const p = makeMinimalProject({
      zones: [z],
      ui: { canvasW: 4000, canvasH: 3000, editMode: 'select', gridSize: 10, snapToGrid: false, flowLegend: { show: true, mode: 'all', selectedTypes: [], showTaxes: true }, hiddenZoneIds: ['z_hidden'] },
    });
    expect(isZoneEnabled(p, z)).toBe(false);
  });
});

// ─── Catalogs & Law References ──────────────────────────────────────────────

describe('defaultCatalogs', () => {
  it('contains 10 jurisdictions and 5 flow types', () => {
    const c = defaultCatalogs();
    expect(c.jurisdictions).toHaveLength(10);
    expect(c.flowTypes).toHaveLength(5);
    expect(c.nodeTemplates).toHaveLength(2);
  });
});

describe('defaultLawReferences', () => {
  it('contains expected law reference keys', () => {
    const lr = defaultLawReferences();
    expect(lr).toHaveProperty('APP_G_G1_BVI_SUBSTANCE');
    expect(lr).toHaveProperty('APP_G_G5_PILLAR2');
    expect(lr).toHaveProperty('AFSA_CLOSED_PERIOD_2026');
  });
});
