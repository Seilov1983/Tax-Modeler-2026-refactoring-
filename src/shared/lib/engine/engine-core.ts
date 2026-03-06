/**
 * Engine Core — Graph utilities, FX conversion, node/zone factories.
 * Framework-agnostic: no React, no DOM, no Node.js.
 */

import { uid, deepMerge } from './utils';
import type {
  Project, Zone, NodeDTO, NodeType, JurisdictionCode, CurrencyCode,
  MasterData, OwnershipEdge,
} from '@shared/types';

// ─── Constants ───────────────────────────────────────────────────────────────

export const SCHEMA_VERSION = '2.4.1';
export const ENGINE_VERSION = '0.10.0';

// ─── Law References ──────────────────────────────────────────────────────────

export function defaultLawReferences() {
  return {
    APP_G_G1_BVI_SUBSTANCE: { title: 'Appendix G · G1 (BVI Substance)', version: '2026-01', effectiveFrom: '2026-01-01' },
    APP_G_G3_CY_DEFENSIVE: { title: 'Appendix G · G3 (Cyprus Defensive Measures)', version: '2026-01', effectiveFrom: '2026-01-01' },
    APP_G_G4_AIFC_PRESENCE: { title: 'Appendix G · G4 (AIFC Presence / CIGA)', version: '2026-01', effectiveFrom: '2026-01-01' },
    APP_G_G5_PILLAR2: { title: 'Appendix G · G5 (Pillar Two / Top-up Tax)', version: '2026-01', effectiveFrom: '2026-01-01' },
    APP_G_G6_INVEST_RES: { title: 'Appendix G · G6 (Investment Resident)', version: '2026-01', effectiveFrom: '2026-01-01' },
    AFSA_CLOSED_PERIOD_2026: { title: 'AFSA 2026 · Closed Period Rules', version: '2026-01-01', effectiveFrom: '2026-01-01' },
  };
}

// ─── Catalogs ────────────────────────────────────────────────────────────────

export function defaultCatalogs() {
  return {
    jurisdictions: [
      { id: 'KZ' as JurisdictionCode, name: 'Kazakhstan', enabled: true },
      { id: 'UAE' as JurisdictionCode, name: 'UAE', enabled: true },
      { id: 'HK' as JurisdictionCode, name: 'Hong Kong', enabled: true },
      { id: 'CY' as JurisdictionCode, name: 'Cyprus', enabled: true },
      { id: 'SG' as JurisdictionCode, name: 'Singapore', enabled: true },
      { id: 'UK' as JurisdictionCode, name: 'United Kingdom', enabled: true },
      { id: 'US' as JurisdictionCode, name: 'US (Delaware)', enabled: true },
      { id: 'BVI' as JurisdictionCode, name: 'BVI', enabled: true },
      { id: 'CAY' as JurisdictionCode, name: 'Cayman', enabled: true },
      { id: 'SEY' as JurisdictionCode, name: 'Seychelles', enabled: true },
    ],
    flowTypes: [
      { id: 'Services' as const, name: 'Services', enabled: true },
      { id: 'Dividends' as const, name: 'Dividends', enabled: true },
      { id: 'Royalties' as const, name: 'Royalties', enabled: true },
      { id: 'Interest' as const, name: 'Interest', enabled: true },
      { id: 'Salary' as const, name: 'Salary', enabled: true },
    ],
    nodeTemplates: [
      { id: 'company', name: 'Company (LegalEntity)', kind: 'company' as NodeType },
      { id: 'person', name: 'Person (Individual)', kind: 'person' as NodeType },
    ],
  };
}

// ─── Master Data ─────────────────────────────────────────────────────────────

export function defaultMasterData(): MasterData {
  return {
    KZ: {
      countryCode: 'KZ', baseCurrency: 'KZT',
      macroConstants: { mciValue: 4325, minWage: 85000, baseOfficialSalary: 17697 },
      thresholds: { vatRegistrationMci: 10000, cashLimitMci: 1000, frozenDebtMci: 20, cfcIncomeMci: 195, cfcEtrThreshold: 0.10, cfcOwnershipThreshold: 0.25, statuteOfLimitations: 3 },
      mciValue: 4325, minWage: 85000, vatRateStandard: 0.16, citRateStandard: 0.20,
      wht: { dividends: 0.15, interest: 0.10, royalties: 0.15, services: 0.20 },
      payroll: { pitRate: 0.10, pensionEmployeeRate: 0.10, medicalEmployeeRate: 0.02, socialContribRate: 0.05, socialTaxEmployerRate: 0.06, medicalEmployerRate: 0.03, pensionEmployerRate: 0.035, socialContribMaxBaseMW: 7, medicalEmployerMaxBaseMW: 40, medicalEmployeeMaxBaseMW: 20 },
      statuteOfLimitationsYears: 3,
    },
    UAE: { countryCode: 'UAE', baseCurrency: 'AED', vatRateStandard: 0.05, cit: { mode: 'threshold', zeroUpTo: 375000, zeroRate: 0.00, mainRate: 0.09, currency: 'AED' }, wht: { dividends: 0.00, interest: 0.00, royalties: 0.00, services: 0.00 }, payroll: { pitRate: 0.00, employerRate: 0.00, employeeRate: 0.00 }, statuteOfLimitationsYears: 5 },
    HK: { countryCode: 'HK', baseCurrency: 'HKD', vatRateStandard: 0.00, cit: { mode: 'twoTier', smallRate: 0.0825, smallLimit: 2000000, mainRate: 0.165, currency: 'HKD' }, wht: { dividends: 0.00, interest: 0.00, royalties: 0.0495, services: 0.00 }, payroll: { pitRate: 0.15 }, statuteOfLimitationsYears: 6 },
    CY: { countryCode: 'CY', baseCurrency: 'EUR', vatRateStandard: 0.19, citRateStandard: 0.15, wht: { dividends: 0.00, interest: 0.00, royalties: 0.10, services: 0.00 }, payroll: { pitRate: 0.00 }, special: { defensiveMeasures: { enabled: false, dividendWhtLowTax: 0.17 } }, statuteOfLimitationsYears: 6 },
    SG: { countryCode: 'SG', baseCurrency: 'SGD', vatRateStandard: 0.09, citRateStandard: 0.17, wht: { dividends: 0.00, interest: 0.15, royalties: 0.10, services: 0.17 }, payroll: { pitRate: 0.00 }, statuteOfLimitationsYears: 4 },
    UK: { countryCode: 'UK', baseCurrency: 'GBP', vatRateStandard: 0.20, cit: { mode: 'smallProfits', smallRate: 0.19, smallLimit: 50000, mainRate: 0.25, mainLimit: 250000, currency: 'GBP' }, wht: { dividends: 0.00, interest: 0.20, royalties: 0.20, services: 0.00 }, payroll: { pitRate: 0.00 }, statuteOfLimitationsYears: 4 },
    US: { countryCode: 'US', baseCurrency: 'USD', vatRateStandard: 0.00, citRateStandard: 0.21, wht: { dividends: 0.30, interest: 0.30, royalties: 0.30, services: 0.30 }, payroll: { pitRate: 0.00 }, statuteOfLimitationsYears: 3 },
    BVI: { countryCode: 'BVI', baseCurrency: 'USD', vatRateStandard: 0.00, citRateStandard: 0.00, wht: { dividends: 0.00, interest: 0.00, royalties: 0.00, services: 0.00 }, payroll: { pitRate: 0.00 }, statuteOfLimitationsYears: 5 },
    CAY: { countryCode: 'CAY', baseCurrency: 'USD', vatRateStandard: 0.00, citRateStandard: 0.00, wht: { dividends: 0.00, interest: 0.00, royalties: 0.00, services: 0.00 }, payroll: { pitRate: 0.00 }, statuteOfLimitationsYears: 5 },
    SEY: { countryCode: 'SEY', baseCurrency: 'SCR', vatRateStandard: 0.15, cit: { mode: 'brackets', currency: 'SCR', brackets: [{ upTo: 1000000, rate: 0.15 }, { upTo: null, rate: 0.25 }] }, wht: { dividends: 0.00, interest: 0.00, royalties: 0.00, services: 0.00 }, payroll: { pitRate: 0.00 }, statuteOfLimitationsYears: 5 },
  } as MasterData;
}

export function ensureMasterData(p: Project): MasterData {
  p.masterData = p.masterData || {};
  const def = defaultMasterData();
  for (const j of Object.keys(def) as JurisdictionCode[]) {
    (p.masterData as Record<string, unknown>)[j] = (p.masterData as Record<string, unknown>)[j] || {};
    (p.masterData as Record<string, unknown>)[j] = deepMerge(
      (def as Record<string, unknown>)[j],
      (p.masterData as Record<string, unknown>)[j] as Record<string, unknown>,
    );
  }
  return p.masterData;
}

// ─── Node Factories ──────────────────────────────────────────────────────────

export function makeNode(name: string, type: NodeType, x: number, y: number): NodeDTO {
  const baseNode: NodeDTO = {
    id: 'n_' + uid(), name, type, x, y, w: 190, h: 90, zoneId: null,
    frozen: false, riskFlags: [], annualIncome: 0, etr: 0.2,
    balances: {},
  };

  if (type === 'company') {
    return {
      ...baseNode,
      effectiveFrom: '2026-01-01', effectiveTo: null, industryTags: [],
      ledger: { balances: { KZT: 0, USD: 0, EUR: 0 }, digitalAssets: { CRYPTO_USD_EQUIV: 0 }, retainedEarnings: 0, accumulatedLosses: 0, debtToTXA: 0 },
      complianceData: { substance: { employeesCount: 0, hasPhysicalOffice: false, cigaInZone: true }, aifc: { usesCITBenefit: false, cigaInZone: true }, bvi: { relevantActivity: false, employees: 0, office: false } },
      balances: { KZT: 0, USD: 0, EUR: 0, AED: 0, HKD: 0, GBP: 0, SGD: 0 },
    };
  }

  if (type === 'person') {
    return {
      ...baseNode,
      citizenship: ['KZ'], taxResidency: ['KZ'],
      statuses: { isInvestmentResident: false },
      declaredAssets: { foreignBankAccountsUsd: 0, cryptoAssetsUsd: 0, foreignRealEstateCount: 0, foreignSharesEquivUsd: 0 },
      ownershipFlags: [],
      balances: { KZT: 0, USD: 0, EUR: 0, AED: 0, HKD: 0, GBP: 0, SGD: 0 },
      investments: { aifcInvestmentUsd: 0, aifcFeePaidMci: 0, isInvestmentResident: false },
    };
  }

  return baseNode;
}

export function makeTXA(zone: Zone): NodeDTO {
  return {
    id: 'txa_' + zone.id, name: 'TXA — ' + zone.code, type: 'txa',
    x: zone.x + zone.w - 210, y: zone.y + zone.h - 110, w: 190, h: 90,
    zoneId: zone.id, frozen: false, riskFlags: [], balances: { [zone.currency]: 0 }, annualIncome: 0, etr: 0,
  };
}

export function ensureBalance(node: NodeDTO, ccy: string): void {
  if (!node.balances) node.balances = {};
  if (typeof node.balances[ccy] !== 'number') node.balances[ccy] = 0;
}

// ─── Graph Utils ─────────────────────────────────────────────────────────────

export function getZone(p: Project, zoneId: string | null | undefined): Zone | null {
  return p.zones.find((z) => z.id === zoneId) || null;
}

export function getNode(p: Project, nodeId: string | null | undefined): NodeDTO | null {
  return p.nodes.find((n) => n.id === nodeId) || null;
}

export function listPersons(p: Project): NodeDTO[] {
  return p.nodes.filter((n) => n.type === 'person');
}

export function listCompanies(p: Project): NodeDTO[] {
  return p.nodes.filter((n) => n.type === 'company');
}

// ─── FX Conversion ───────────────────────────────────────────────────────────

export function convert(p: Project, amount: number, fromCcy: string, toCcy: string): number {
  if (fromCcy === toCcy) return amount;
  const rates = p.fx?.rateToUSD || { USD: 1 };
  const rateFrom = rates[fromCcy] || 1;
  const rateTo = rates[toCcy] || 1;
  const amountInUsd = amount / rateFrom;
  return amountInUsd * rateTo;
}

// ─── Geometry ────────────────────────────────────────────────────────────────

export function nodeCenter(node: NodeDTO): { cx: number; cy: number; x: number; y: number } {
  const cx = Number(node?.x || 0) + Number(node?.w || 0) / 2;
  const cy = Number(node?.y || 0) + Number(node?.h || 0) / 2;
  return { cx, cy, x: cx, y: cy };
}

export function pointInZone(cx: number, cy: number, z: Zone): boolean {
  return cx >= z.x && cx <= z.x + z.w && cy >= z.y && cy <= z.y + z.h;
}

export function zoneArea(z: Zone): number {
  return z.w * z.h;
}

export function isJurisdictionEnabled(p: Project, j: string): boolean {
  return !p || !Array.isArray(p.activeJurisdictions) || p.activeJurisdictions.includes(j as JurisdictionCode);
}

export function isZoneEnabled(p: Project, z: Zone): boolean {
  return isJurisdictionEnabled(p, z.jurisdiction) && !(p.ui?.hiddenZoneIds || []).includes(z.id);
}

export function detectZoneId(p: Project, node: NodeDTO): string | null {
  if (node && node.type === 'txa')
    return node.zoneId || (String(node.id || '').startsWith('txa_') ? String(node.id).slice(4) : null);
  const { cx, cy } = nodeCenter(node);
  const hits = p.zones.filter((z) => isZoneEnabled(p, z) && pointInZone(cx, cy, z));
  if (hits.length === 0) return null;
  hits.sort((a, b) => zoneArea(a) - zoneArea(b) || (b.zIndex || 0) - (a.zIndex || 0) || a.id.localeCompare(b.id));
  return hits[0].id;
}

export function clampToZoneRect(z: Zone, node: NodeDTO, x: number, y: number, pad?: number) {
  const p = pad ?? 10;
  const nx = Math.max(z.x + p, Math.min(z.x + z.w - node.w - p, x));
  const ny = Math.max(z.y + p, Math.min(z.y + z.h - node.h - p, y));
  return { x: nx, y: ny };
}

export function clampToZoneExclusive(project: Project, node: NodeDTO, homeZone: Zone, x: number, y: number, pad?: number) {
  const p = typeof pad === 'number' ? pad : 10;
  const ri = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
    !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
  const out = clampToZoneRect(homeZone, node, x, y, p);
  let nx = out.x, ny = out.y;
  const nested = project.zones
    .filter((z) => z.id !== homeZone.id && isZoneEnabled(project, z))
    .filter((z) => zoneArea(z) < zoneArea(homeZone))
    .filter((z) => ri(z, homeZone));
  for (let iter = 0; iter < 10; iter++) {
    const nr = { x: nx, y: ny, w: node.w, h: node.h };
    const hits = nested.filter((z) => ri(nr, z));
    if (!hits.length) break;
    hits.sort((a, b) => zoneArea(a) - zoneArea(b) || (b.zIndex || 0) - (a.zIndex || 0));
    const z = hits[0];
    const left = nr.x + nr.w - (z.x - p), right = z.x + z.w + p - nr.x;
    const up = nr.y + nr.h - (z.y - p), down = z.y + z.h + p - nr.y;
    const cands = [
      { dx: -left, dy: 0, mag: Math.abs(left) },
      { dx: right, dy: 0, mag: Math.abs(right) },
      { dx: 0, dy: -up, mag: Math.abs(up) },
      { dx: 0, dy: down, mag: Math.abs(down) },
    ].filter((c) => isFinite(c.mag) && c.mag >= 0);
    cands.sort((a, b) => a.mag - b.mag);
    const best = cands[0] || { dx: 0, dy: 0 };
    nx += best.dx;
    ny += best.dy;
    const cc = clampToZoneRect(homeZone, node, nx, ny, p);
    nx = cc.x;
    ny = cc.y;
  }
  return { x: nx, y: ny };
}

export function bootstrapNormalizeZones(p: Project): void {
  p.nodes.forEach((n) => {
    if (n.type !== 'txa') n.zoneId = detectZoneId(p, n);
  });
}
