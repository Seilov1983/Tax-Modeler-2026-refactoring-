/**
 * Engine Core — Graph utilities, FX conversion, node/zone factories.
 * Framework-agnostic: no React, no DOM, no Node.js.
 */

import { uid, deepMerge } from './utils';
import type {
  Project, Zone, NodeDTO, NodeType, JurisdictionCode, CurrencyCode,
  MasterData, OwnershipEdge, Country, TaxRegime,
  FlowDTO, CITConfig, WHTRates,
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

// ─── Default Countries & Regimes (hierarchical справочник) ───────────────────

export function defaultCountries(): Country[] {
  return [
    { id: 'KZ', name: 'Kazakhstan', baseCurrency: 'KZT' },
    { id: 'UAE', name: 'UAE', baseCurrency: 'AED' },
    { id: 'HK', name: 'Hong Kong', baseCurrency: 'HKD' },
    { id: 'CY', name: 'Cyprus', baseCurrency: 'EUR' },
    { id: 'SG', name: 'Singapore', baseCurrency: 'SGD' },
    { id: 'UK', name: 'United Kingdom', baseCurrency: 'GBP' },
    { id: 'US', name: 'US (Delaware)', baseCurrency: 'USD' },
    { id: 'BVI', name: 'BVI', baseCurrency: 'USD' },
    { id: 'CAY', name: 'Cayman', baseCurrency: 'USD' },
    { id: 'SEY', name: 'Seychelles', baseCurrency: 'SCR' },
  ];
}

export function defaultRegimes(): TaxRegime[] {
  return [
    { id: 'KZ_STD', countryId: 'KZ', name: 'Standard', cit: 20, wht: 15 },
    { id: 'KZ_AIFC', countryId: 'KZ', name: 'AIFC', cit: 0, wht: 0 },
    { id: 'KZ_HUB', countryId: 'KZ', name: 'Astana Hub', cit: 0, wht: 5 },
    { id: 'UAE_ML', countryId: 'UAE', name: 'Mainland', cit: 9, wht: 0 },
    { id: 'UAE_FZ_Q', countryId: 'UAE', name: 'Free Zone (QFZP)', cit: 0, wht: 0 },
    { id: 'UAE_FZ_NQ', countryId: 'UAE', name: 'Free Zone (Non-QFZP)', cit: 9, wht: 0 },
    { id: 'HK_ON', countryId: 'HK', name: 'Onshore', cit: 16.5, wht: 0 },
    { id: 'HK_OFF', countryId: 'HK', name: 'Offshore', cit: 0, wht: 0 },
    { id: 'CY_STD', countryId: 'CY', name: 'Standard', cit: 15, wht: 0 },
    { id: 'SG_STD', countryId: 'SG', name: 'Standard', cit: 17, wht: 15 },
    { id: 'UK_STD', countryId: 'UK', name: 'Standard', cit: 25, wht: 20 },
    { id: 'US_STD', countryId: 'US', name: 'Standard', cit: 21, wht: 30 },
    { id: 'BVI_STD', countryId: 'BVI', name: 'Standard', cit: 0, wht: 0 },
    { id: 'CAY_STD', countryId: 'CAY', name: 'Standard', cit: 0, wht: 0 },
    { id: 'SEY_STD', countryId: 'SEY', name: 'Standard', cit: 15, wht: 0 },
  ];
}

export function ensureCountriesAndRegimes(p: Project): void {
  if (!p.masterData) p.masterData = {} as Project['masterData'];
  if (!p.masterData.countries || p.masterData.countries.length === 0) {
    p.masterData.countries = defaultCountries();
  }
  if (!p.masterData.regimes || p.masterData.regimes.length === 0) {
    p.masterData.regimes = defaultRegimes();
  }
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

// ─── Computation Graph ───────────────────────────────────────────────────────

/**
 * The fully-resolved effective tax rates for a single node, after applying
 * the full Country → Regime → ZoneOverride inheritance chain.
 */
export interface EffectiveTaxRates {
  /** Fully resolved CIT configuration (mode + all rate fields). */
  cit: CITConfig;
  /**
   * A single scalar CIT rate for quick numeric comparisons.
   * Derived from the CIT mode:
   *   flat/qfzp → rate/qualifyingRate
   *   threshold/twoTier/smallProfits → mainRate
   *   brackets → top bracket rate
   */
  citRateEffective: number;
  wht: WHTRates;
  vatRate: number;
}

/** A node paired with its fully-inherited effective tax rates. */
export interface ComputationNode {
  node: NodeDTO;
  effectiveTax: EffectiveTaxRates;
}

/** A zone and its position in the logical hierarchy, with resolved children and nodes. */
export interface ComputationZone {
  zone: Zone;
  /** Resolved child ComputationZones (regime zones whose parentId = this zone's id). */
  children: ComputationZone[];
  /** Computation nodes whose zoneId = this zone's id. */
  nodes: ComputationNode[];
}

/** Directed adjacency lists for financial flows. All lookups are O(1). */
export interface FlowAdjacency {
  /** nodeId → outgoing FlowDTOs originating at that node. */
  outFlows: Map<string, FlowDTO[]>;
  /** nodeId → incoming FlowDTOs terminating at that node. */
  inFlows: Map<string, FlowDTO[]>;
}

/** Directed adjacency lists for ownership edges. All lookups are O(1). */
export interface OwnershipAdjacency {
  /** nodeId → OwnershipEdges going out from that node (owner → owned). */
  outEdges: Map<string, OwnershipEdge[]>;
  /** nodeId → OwnershipEdges coming in to that node (owned ← owner). */
  inEdges: Map<string, OwnershipEdge[]>;
}

/**
 * The pre-processed computation graph returned by buildComputationGraph.
 * Feeds directly into the tax calculator without any further O(n) scans.
 */
export interface ComputationGraph {
  /** Root zones — zones that have no parentId (typically Country-level zones). */
  rootZones: ComputationZone[];
  /** All ComputationNodes indexed by node.id for O(1) lookup. */
  nodeMap: Map<string, ComputationNode>;
  /** Flat ordered list of all ComputationNodes (same order as project.nodes). */
  nodes: ComputationNode[];
  /** Directed adjacency lists for financial flows. */
  flows: FlowAdjacency;
  /** Directed adjacency lists for ownership edges. */
  ownership: OwnershipAdjacency;
}

// ─── Internal helper ─────────────────────────────────────────────────────────

/**
 * Collapses a CITConfig into a single representative scalar rate.
 * Used to give the tax calculator a quick numeric handle without re-implementing
 * all CIT modes in every downstream consumer.
 */
function citScalar(cit: CITConfig): number {
  switch (cit.mode) {
    case 'flat':        return Number(cit.rate ?? 0);
    case 'qfzp':        return Number(cit.qualifyingRate ?? 0);
    case 'threshold':   return Number(cit.mainRate ?? 0);
    case 'twoTier':     return Number(cit.mainRate ?? 0);
    case 'smallProfits':return Number(cit.mainRate ?? 0);
    case 'brackets': {
      const last = cit.brackets?.[cit.brackets.length - 1];
      return last ? Number(last.rate ?? 0) : 0;
    }
    default:            return 0;
  }
}

// ─── buildComputationGraph ────────────────────────────────────────────────────

/**
 * Transforms a flat Project snapshot into a pre-processed ComputationGraph
 * ready for the tax calculator.
 *
 * Three things happen here:
 *
 * 1. **Zone tree construction** — flat `project.zones` (linked via `parentId`)
 *    is converted into a proper hierarchy of ComputationZone objects.
 *
 * 2. **Tax inheritance resolution** — for every node, the effective CIT/WHT/VAT
 *    rates are resolved by walking the zone ancestry chain (Country → Regime)
 *    and layering overrides on top of master-data defaults:
 *      masterData[jurisdiction] → countryZone.tax → regimeZone.tax
 *
 * 3. **Directed adjacency lists** — project.flows and project.ownership are
 *    converted into Map-based adjacency lists, making it O(1) for any
 *    downstream calculator to enumerate a node's incoming/outgoing edges.
 *
 * This function is pure and side-effect free. It does not mutate the Project.
 */
export function buildComputationGraph(project: Project): ComputationGraph {
  // ── 1. Index all zones by id ──────────────────────────────────────────────
  const zoneById = new Map<string, Zone>();
  for (const z of project.zones) {
    zoneById.set(z.id, z);
  }

  // ── 2. Tax-rate resolver (walks parentId chain, Country→Regime→…) ─────────
  function resolveEffectiveTax(zoneId: string | null | undefined): EffectiveTaxRates {
    // Collect ancestor chain from root (country) down to the node's zone.
    // We prepend so index 0 = outermost ancestor (country), last = immediate zone.
    const chain: Zone[] = [];
    let cursor: Zone | undefined = zoneId ? zoneById.get(zoneId) : undefined;
    while (cursor) {
      chain.unshift(cursor);
      cursor = cursor.parentId ? zoneById.get(cursor.parentId) : undefined;
    }

    // The jurisdiction is on every zone in the chain (they must share it).
    // Use the deepest zone's jurisdiction; fall back to the first in chain.
    const jurisdiction = chain.length > 0
      ? (chain[chain.length - 1].jurisdiction ?? chain[0].jurisdiction)
      : null;

    // Layer 0: master-data defaults for the jurisdiction.
    const md = jurisdiction
      ? ((project.masterData?.[jurisdiction] ?? {}) as Record<string, unknown>)
      : ({} as Record<string, unknown>);

    let cit: CITConfig = md.cit
      ? deepMerge(md.cit as CITConfig, {} as Partial<CITConfig>)
      : ({ mode: 'flat', rate: Number((md.citRateStandard as number) ?? 0) } as CITConfig);

    let wht: WHTRates = deepMerge(
      (md.wht as WHTRates) ?? { dividends: 0, interest: 0, royalties: 0, services: 0 },
      {} as Partial<WHTRates>,
    );

    let vatRate = Number((md.vatRateStandard as number) ?? 0);

    // Layers 1…N: progressively apply zone.tax overrides from country → regime.
    for (const zone of chain) {
      const tax = zone.tax;
      if (!tax) continue;
      if (tax.cit)                  cit     = deepMerge(cit, tax.cit as Partial<CITConfig>);
      if (tax.wht)                  wht     = deepMerge(wht, tax.wht as Partial<WHTRates>);
      if (tax.vatRate !== undefined) vatRate = tax.vatRate;
    }

    return { cit, citRateEffective: citScalar(cit), wht, vatRate };
  }

  // ── 3. Build zone hierarchy ───────────────────────────────────────────────
  const compZoneMap = new Map<string, ComputationZone>();
  for (const zone of project.zones) {
    compZoneMap.set(zone.id, { zone, children: [], nodes: [] });
  }

  const rootZones: ComputationZone[] = [];
  for (const zone of project.zones) {
    const cz = compZoneMap.get(zone.id)!;
    if (zone.parentId && compZoneMap.has(zone.parentId)) {
      compZoneMap.get(zone.parentId)!.children.push(cz);
    } else {
      rootZones.push(cz);
    }
  }

  // ── 4. Build ComputationNodes and attach them to their zones ──────────────
  const nodeMap = new Map<string, ComputationNode>();
  const nodes: ComputationNode[] = [];

  for (const node of project.nodes) {
    const effectiveTax = resolveEffectiveTax(node.zoneId);
    const cn: ComputationNode = { node, effectiveTax };
    nodeMap.set(node.id, cn);
    nodes.push(cn);
    if (node.zoneId) {
      compZoneMap.get(node.zoneId)?.nodes.push(cn);
    }
  }

  // ── 5. Build flow adjacency lists ─────────────────────────────────────────
  const outFlows = new Map<string, FlowDTO[]>();
  const inFlows  = new Map<string, FlowDTO[]>();

  for (const flow of project.flows) {
    if (!outFlows.has(flow.fromId)) outFlows.set(flow.fromId, []);
    outFlows.get(flow.fromId)!.push(flow);

    if (!inFlows.has(flow.toId)) inFlows.set(flow.toId, []);
    inFlows.get(flow.toId)!.push(flow);
  }

  // ── 6. Build ownership adjacency lists ───────────────────────────────────
  const outEdges = new Map<string, OwnershipEdge[]>();
  const inEdges  = new Map<string, OwnershipEdge[]>();

  for (const edge of project.ownership) {
    if (!outEdges.has(edge.fromId)) outEdges.set(edge.fromId, []);
    outEdges.get(edge.fromId)!.push(edge);

    if (!inEdges.has(edge.toId)) inEdges.set(edge.toId, []);
    inEdges.get(edge.toId)!.push(edge);
  }

  return {
    rootZones,
    nodeMap,
    nodes,
    flows:     { outFlows, inFlows },
    ownership: { outEdges, inEdges },
  };
}
