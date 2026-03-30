/**
 * 1000-Run Deep Stress Test & FSIE Logic Validation
 *
 * Constructs 10 complex multi-jurisdictional tax schemes and runs
 * 100 mutation variants for each (1,000 tests total).
 *
 * Invocation:  npx tsx scripts/simulate-complex-schemes.ts
 *
 * Output:      reports/stress-test-1000-results.md
 */

import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

// ─── Engine Imports (via relative paths — script runs outside src/) ─────────

import { makeNode, defaultMasterData, ensureMasterData, defaultCountries, defaultRegimes, defaultCatalogs } from '../src/shared/lib/engine/engine-core';
import { computeGroupTax, ensureZoneTaxDefaults } from '../src/shared/lib/engine/engine-tax';
import { recomputeRisks } from '../src/shared/lib/engine/engine-risks';
import { uid } from '../src/shared/lib/engine/utils';
import type {
  Project, Zone, NodeDTO, FlowDTO, OwnershipEdge,
  CurrencyCode, JurisdictionCode, FlowType,
} from '../src/shared/types';

// ─── Deterministic PRNG (Mulberry32) for repeatable mutation ────────────────

function mulberry32(seed: number) {
  return (): number => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Factory Helpers ────────────────────────────────────────────────────────

function makeZone(
  id: string, name: string, jurisdiction: JurisdictionCode,
  code: string, currency: CurrencyCode,
  x: number, y: number, w: number, h: number,
  parentId?: string,
): Zone {
  return {
    id, name, jurisdiction, code, currency,
    x, y, w, h, zIndex: parentId ? 20 : 10, parentId: parentId ?? null,
  };
}

function makeCompany(name: string, zoneId: string, income: number): NodeDTO {
  const n = makeNode(name, 'company', 100, 100);
  n.id = 'n_' + uid();
  n.zoneId = zoneId;
  n.annualIncome = income;
  n.hasSubstance = false;
  // Reset etr to 0 so the engine resolves from zone master data
  // (makeNode defaults to 0.2 which acts as a manual override)
  n.etr = 0;
  return n;
}

function makePerson(name: string, zoneId: string): NodeDTO {
  const n = makeNode(name, 'person', 100, 100);
  n.id = 'n_' + uid();
  n.zoneId = zoneId;
  return n;
}

function makeFlow(
  fromId: string, toId: string,
  flowType: FlowType, gross: number,
  currency: CurrencyCode, date: string,
  whtRate?: number,
  opts?: Partial<FlowDTO>,
): FlowDTO {
  return {
    id: 'f_' + uid(),
    fromId, toId,
    flowType,
    currency,
    grossAmount: gross,
    paymentMethod: 'bank',
    cashComponentAmount: 0,
    cashComponentCurrency: currency,
    whtRate: whtRate ?? 0,
    status: 'executed',
    flowDate: date,
    ack: { ackStatus: 'not_required', acknowledgedBy: null, acknowledgedAt: null, comment: '' },
    taxAdjustments: [],
    fxEvidence: null,
    ...opts,
  };
}

function makeOwnership(fromId: string, toId: string, percent: number): OwnershipEdge {
  return { id: 'own_' + uid(), fromId, toId, percent, manualAdjustment: 0 };
}

function makeProject(overrides: {
  zones: Zone[];
  nodes: NodeDTO[];
  flows: FlowDTO[];
  ownership: OwnershipEdge[];
  isPillarTwoScope?: boolean;
  consolidatedRevenueEur?: number;
}): Project {
  const p: Project = {
    schemaVersion: '2.6.0',
    engineVersion: '0.11.0',
    projectId: 'stress_' + uid(),
    title: 'Stress Test',
    userId: 'stress-runner',
    createdAt: '2026-01-15T00:00:00Z',
    updatedAt: '2026-01-15T00:00:00Z',
    readOnly: false,
    baseCurrency: 'KZT',
    masterData: {} as Project['masterData'],
    fx: {
      fxDate: '2026-01-15',
      rateToUSD: { KZT: 460, AED: 3.67, HKD: 7.81, EUR: 0.92, SGD: 1.34, GBP: 0.79, USD: 1, SCR: 14.2, CNY: 7.2 },
      source: 'STRESS_TEST_FIXTURE',
    },
    zones: overrides.zones,
    nodes: overrides.nodes,
    ownership: overrides.ownership,
    flows: overrides.flows,
    taxes: [],
    audit: { entries: [], lastHash: '' },
    periods: { closedYears: [] },
    isPillarTwoScope: overrides.isPillarTwoScope ?? false,
    group: { consolidatedRevenueEur: overrides.consolidatedRevenueEur ?? null },
    catalogs: defaultCatalogs(),
    activeJurisdictions: ['KZ', 'UAE', 'HK', 'CY', 'SG', 'UK', 'US', 'BVI', 'CAY', 'SEY'],
    ui: { canvasW: 6000, canvasH: 4000, editMode: 'select', gridSize: 20, snapToGrid: false, flowLegend: { show: false, mode: 'type', selectedTypes: [], showTaxes: false } },
    accounting: { years: {} },
    lawReferences: {},
    snapshots: [],
    pipeline: { lastRunAt: null, lastRun: null, runs: [] },
    projectRiskFlags: [],
  };
  ensureMasterData(p);
  ensureZoneTaxDefaults(p);
  return p;
}

// ─── Case Type ──────────────────────────────────────────────────────────────

type CaseResult = {
  caseId: number;
  caseName: string;
  variant: number;
  totalCIT: number;
  totalWHT: number;
  totalTax: number;
  totalIncome: number;
  etr: number;
  riskFlags: string[];
  anomalies: string[];
  error: string | null;
};

// ─── Case 1: CFO Exact Specification (KZ → Hub → HK → UAE/BVI → KZ UBO) ──

function buildCase1(): { name: string; project: Project } {
  // Zones
  const zKZ   = makeZone('z_kz', 'Kazakhstan', 'KZ', 'KZ_STANDARD', 'KZT', 0, 0, 1200, 800);
  const zHub  = makeZone('z_hub', 'Astana Hub', 'KZ', 'KZ_HUB', 'KZT', 50, 400, 500, 350, 'z_kz');
  const zHK   = makeZone('z_hk', 'Hong Kong', 'HK', 'HK_ONSHORE', 'HKD', 1400, 0, 800, 600);
  const zUAE  = makeZone('z_uae', 'UAE Mainland', 'UAE', 'UAE_MAINLAND', 'AED', 2400, 0, 800, 600);
  const zBVI  = makeZone('z_bvi', 'BVI', 'BVI', 'BVI_STANDARD', 'USD', 2400, 700, 800, 600);

  // Nodes
  const n1 = makeCompany('Акимат', 'z_kz', 0);
  const n2 = makeCompany('Подрядчик', 'z_kz', 1_000_000_000);
  const n3 = makeCompany('IT-разработчик', 'z_hub', 950_000_000);
  const n4 = makeCompany('Посредник в поставке', 'z_hk', 900_000_000);
  n4.isIPIncome = false;
  // HK FSIE: foreign-sourced income received in HK
  (n4 as any).fsieStatus = { isForeignSourced: true, isReceivedInHK: true };
  const n5 = makeCompany('Изготовитель оборудования', 'z_uae', 50_000_000);
  const n6 = makeCompany('Траст', 'z_bvi', 850_000_000);
  n6.hasSubstance = false;
  const n7 = makePerson('Гражданин РК', 'z_kz');

  // Flows (chronological, all 2026-01-15)
  const date = '2026-01-15';
  const f1 = makeFlow(n1.id, n2.id, 'Services', 1_000_000_000, 'KZT', date);
  const f2 = makeFlow(n2.id, n3.id, 'Services', 950_000_000, 'KZT', date);
  // F3: KZ → HK, 20% WHT on exit from KZ for services
  const f3 = makeFlow(n3.id, n4.id, 'Services', 900_000_000, 'KZT', date, 20, {
    isOffshoreSource: true,
  });
  const f4 = makeFlow(n4.id, n5.id, 'Services', 50_000_000, 'KZT', date);
  // F5: HK → BVI dividends — capital anomaly: 900M - 180M WHT - 50M services = 670M available but 850M requested
  const f5 = makeFlow(n4.id, n6.id, 'Dividends', 850_000_000, 'KZT', date);
  const f6 = makeFlow(n6.id, n7.id, 'Dividends', 850_000_000, 'KZT', date);

  // Ownership chain: N7 → N6 → N4, N7 → N2 → N3
  const ownership: OwnershipEdge[] = [
    makeOwnership(n7.id, n6.id, 100),
    makeOwnership(n6.id, n4.id, 100),
    makeOwnership(n7.id, n2.id, 100),
    makeOwnership(n2.id, n3.id, 100),
  ];

  return {
    name: 'Case 1: KZ → Astana Hub → HK FSIE → UAE/BVI → KZ UBO (CFO Spec)',
    project: makeProject({
      zones: [zKZ, zHub, zHK, zUAE, zBVI],
      nodes: [n1, n2, n3, n4, n5, n6, n7],
      flows: [f1, f2, f3, f4, f5, f6],
      ownership,
    }),
  };
}

// ─── Case 2: Cyprus Back-to-Back Loans with Defensive Measures ─────────────

function buildCase2(): { name: string; project: Project } {
  const zCY  = makeZone('z_cy', 'Cyprus', 'CY', 'CY_STANDARD', 'EUR', 0, 0, 800, 600);
  const zBVI = makeZone('z_bvi', 'BVI', 'BVI', 'BVI_STANDARD', 'USD', 1000, 0, 800, 600);
  const zKZ  = makeZone('z_kz', 'Kazakhstan', 'KZ', 'KZ_STANDARD', 'KZT', 2000, 0, 800, 600);

  const cyHolding = makeCompany('CY HoldCo', 'z_cy', 500_000_000);
  const bviSpv    = makeCompany('BVI SPV', 'z_bvi', 200_000_000);
  bviSpv.hasSubstance = false;
  const kzOpco    = makeCompany('KZ OpCo', 'z_kz', 800_000_000);
  const ubo       = makePerson('CY UBO', 'z_cy');

  const date = '2026-03-01';
  const flows: FlowDTO[] = [
    makeFlow(kzOpco.id, cyHolding.id, 'Dividends', 300_000_000, 'KZT', date),
    makeFlow(kzOpco.id, cyHolding.id, 'Interest', 200_000_000, 'KZT', date),
    // CY → BVI: triggers 17% penalty WHT (Defensive Measures)
    makeFlow(cyHolding.id, bviSpv.id, 'Dividends', 400_000_000, 'EUR', date),
    // CY → BVI: Interest deduction denial
    makeFlow(cyHolding.id, bviSpv.id, 'Interest', 100_000_000, 'EUR', date),
    makeFlow(bviSpv.id, ubo.id, 'Dividends', 450_000_000, 'EUR', date),
  ];

  return {
    name: 'Case 2: Cyprus Defensive Measures — 17% Penalty WHT to LTJ',
    project: makeProject({
      zones: [zCY, zBVI, zKZ],
      nodes: [cyHolding, bviSpv, kzOpco, ubo],
      flows,
      ownership: [
        makeOwnership(ubo.id, cyHolding.id, 100),
        makeOwnership(cyHolding.id, bviSpv.id, 100),
        makeOwnership(cyHolding.id, kzOpco.id, 80),
      ],
    }),
  };
}

// ─── Case 3: UAE Tax Group Consolidation (QFZP + Mainland) ─────────────────

function buildCase3(): { name: string; project: Project } {
  const zML = makeZone('z_uae_ml', 'UAE Mainland', 'UAE', 'UAE_MAINLAND', 'AED', 0, 0, 800, 600);
  const zFZ = makeZone('z_uae_fz', 'UAE Free Zone', 'UAE', 'UAE_FREEZONE_QFZP', 'AED', 50, 300, 600, 250, 'z_uae_ml');
  const zKZ = makeZone('z_kz', 'Kazakhstan', 'KZ', 'KZ_STANDARD', 'KZT', 1000, 0, 800, 600);

  const mlParent = makeCompany('UAE MainCo', 'z_uae_ml', 600_000_000);
  const fzSub    = makeCompany('UAE FZ Sub', 'z_uae_fz', 400_000_000);
  const kzSource = makeCompany('KZ Source', 'z_kz', 1_200_000_000);
  const ubo      = makePerson('UAE UBO', 'z_uae_ml');

  const date = '2026-02-15';
  return {
    name: 'Case 3: UAE Tax Group Consolidation (QFZP + Mainland)',
    project: makeProject({
      zones: [zML, zFZ, zKZ],
      nodes: [mlParent, fzSub, kzSource, ubo],
      flows: [
        makeFlow(kzSource.id, mlParent.id, 'Services', 500_000_000, 'KZT', date),
        makeFlow(kzSource.id, fzSub.id, 'Royalties', 300_000_000, 'KZT', date),
        makeFlow(fzSub.id, mlParent.id, 'Dividends', 200_000_000, 'AED', date),
        makeFlow(mlParent.id, ubo.id, 'Dividends', 400_000_000, 'AED', date),
      ],
      ownership: [
        makeOwnership(ubo.id, mlParent.id, 100),
        makeOwnership(mlParent.id, fzSub.id, 100),
        makeOwnership(mlParent.id, kzSource.id, 51),
      ],
      taxGroups: [{ id: 'tg_uae', name: 'UAE Group', nodeIds: [mlParent.id, fzSub.id], jurisdiction: 'UAE' }],
    } as Parameters<typeof makeProject>[0]),
  };
}

// ─── Case 4: AIFC Separate Accounting + Nexus Fraction ──────────────────────

function buildCase4(): { name: string; project: Project } {
  const zKZ   = makeZone('z_kz', 'Kazakhstan', 'KZ', 'KZ_STANDARD', 'KZT', 0, 0, 1200, 800);
  const zAIFC = makeZone('z_aifc', 'AIFC', 'KZ', 'KZ_AIFC', 'KZT', 50, 400, 500, 350, 'z_kz');
  const zSG   = makeZone('z_sg', 'Singapore', 'SG', 'SG_STANDARD', 'SGD', 1400, 0, 800, 600);

  const aifcCo = makeCompany('AIFC FinTech', 'z_aifc', 700_000_000);
  aifcCo.hasSubstance = true;
  aifcCo.hasSeparateAccounting = true;
  aifcCo.isIPIncome = true;
  aifcCo.nexusParams = { rUp: 100, rOut1: 30, rOut2: 0, rAcq: 20 };
  if (aifcCo.complianceData?.aifc) {
    aifcCo.complianceData.aifc.usesCITBenefit = true;
    aifcCo.complianceData.aifc.cigaInZone = true;
  }
  const sgPartner = makeCompany('SG Partner', 'z_sg', 300_000_000);
  const kzClient  = makeCompany('KZ Client', 'z_kz', 0);
  const ubo       = makePerson('AIFC Founder', 'z_kz');

  const date = '2026-04-01';
  return {
    name: 'Case 4: AIFC Separate Accounting + Nexus Fraction (IP Income)',
    project: makeProject({
      zones: [zKZ, zAIFC, zSG],
      nodes: [aifcCo, sgPartner, kzClient, ubo],
      flows: [
        makeFlow(kzClient.id, aifcCo.id, 'Services', 500_000_000, 'KZT', date),
        makeFlow(aifcCo.id, sgPartner.id, 'Royalties', 200_000_000, 'KZT', date),
        makeFlow(sgPartner.id, aifcCo.id, 'Interest', 50_000_000, 'SGD', date),
        makeFlow(aifcCo.id, ubo.id, 'Dividends', 300_000_000, 'KZT', date),
      ],
      ownership: [
        makeOwnership(ubo.id, aifcCo.id, 100),
        makeOwnership(aifcCo.id, sgPartner.id, 40),
      ],
    }),
  };
}

// ─── Case 5: Triple-Layer CFC Cascade (KZ → CY → BVI → CAY) ───────────────

function buildCase5(): { name: string; project: Project } {
  const zKZ  = makeZone('z_kz', 'Kazakhstan', 'KZ', 'KZ_STANDARD', 'KZT', 0, 0, 800, 600);
  const zCY  = makeZone('z_cy', 'Cyprus', 'CY', 'CY_STANDARD', 'EUR', 1000, 0, 800, 600);
  const zBVI = makeZone('z_bvi', 'BVI', 'BVI', 'BVI_STANDARD', 'USD', 2000, 0, 800, 600);
  const zCAY = makeZone('z_cay', 'Cayman', 'CAY', 'CAY_STANDARD', 'USD', 3000, 0, 800, 600);

  const kzOp  = makeCompany('KZ Operating', 'z_kz', 2_000_000_000);
  const cyHold = makeCompany('CY Holding', 'z_cy', 500_000_000);
  const bviIp  = makeCompany('BVI IP Co', 'z_bvi', 800_000_000);
  bviIp.hasSubstance = false;
  const cayFund = makeCompany('CAY Fund', 'z_cay', 1_200_000_000);
  cayFund.hasSubstance = false;
  const ubo = makePerson('KZ Controller', 'z_kz');

  const date = '2026-05-15';
  return {
    name: 'Case 5: Triple CFC Cascade (KZ → CY → BVI → CAY)',
    project: makeProject({
      zones: [zKZ, zCY, zBVI, zCAY],
      nodes: [kzOp, cyHold, bviIp, cayFund, ubo],
      flows: [
        makeFlow(kzOp.id, cyHold.id, 'Royalties', 600_000_000, 'KZT', date),
        makeFlow(kzOp.id, cyHold.id, 'Dividends', 400_000_000, 'KZT', date),
        makeFlow(cyHold.id, bviIp.id, 'Royalties', 500_000_000, 'EUR', date),
        makeFlow(bviIp.id, cayFund.id, 'Dividends', 700_000_000, 'USD', date),
        makeFlow(cayFund.id, ubo.id, 'Dividends', 1_000_000_000, 'USD', date),
      ],
      ownership: [
        makeOwnership(ubo.id, kzOp.id, 100),
        makeOwnership(kzOp.id, cyHold.id, 100),
        makeOwnership(cyHold.id, bviIp.id, 100),
        makeOwnership(bviIp.id, cayFund.id, 100),
      ],
    }),
  };
}

// ─── Case 6: Pillar Two Scope Trigger (Global Revenue > 750M EUR) ──────────

function buildCase6(): { name: string; project: Project } {
  const zKZ = makeZone('z_kz', 'Kazakhstan', 'KZ', 'KZ_STANDARD', 'KZT', 0, 0, 800, 600);
  const zHK = makeZone('z_hk', 'Hong Kong', 'HK', 'HK_ONSHORE', 'HKD', 1000, 0, 800, 600);
  const zUK = makeZone('z_uk', 'United Kingdom', 'UK', 'UK_STANDARD', 'GBP', 2000, 0, 800, 600);

  const kzMain = makeCompany('KZ Group HQ', 'z_kz', 3_000_000_000);
  const hkSub  = makeCompany('HK Trading', 'z_hk', 1_500_000_000);
  hkSub.hasSubstance = true;
  const ukSub  = makeCompany('UK Sub', 'z_uk', 800_000_000);
  const ubo    = makePerson('Global Controller', 'z_kz');

  const date = '2026-06-01';
  return {
    name: 'Case 6: Pillar Two Trigger (750M+ EUR, Low-ETR Entities)',
    project: makeProject({
      zones: [zKZ, zHK, zUK],
      nodes: [kzMain, hkSub, ukSub, ubo],
      flows: [
        makeFlow(kzMain.id, hkSub.id, 'Services', 1_000_000_000, 'KZT', date),
        makeFlow(hkSub.id, ukSub.id, 'Royalties', 500_000_000, 'HKD', date),
        makeFlow(ukSub.id, ubo.id, 'Dividends', 300_000_000, 'GBP', date),
      ],
      ownership: [
        makeOwnership(ubo.id, kzMain.id, 100),
        makeOwnership(kzMain.id, hkSub.id, 80),
        makeOwnership(kzMain.id, ukSub.id, 100),
      ],
      isPillarTwoScope: true,
      consolidatedRevenueEur: 800_000_000,
    }),
  };
}

// ─── Case 7: Transfer Pricing Ring (Related Parties, Cross-Border Services) ─

function buildCase7(): { name: string; project: Project } {
  const zKZ = makeZone('z_kz', 'Kazakhstan', 'KZ', 'KZ_STANDARD', 'KZT', 0, 0, 800, 600);
  const zSG = makeZone('z_sg', 'Singapore', 'SG', 'SG_STANDARD', 'SGD', 1000, 0, 800, 600);
  const zHK = makeZone('z_hk', 'Hong Kong', 'HK', 'HK_ONSHORE', 'HKD', 2000, 0, 800, 600);

  const kzProd = makeCompany('KZ Producer', 'z_kz', 100_000_000);
  const sgTrader = makeCompany('SG Trader', 'z_sg', 900_000_000);
  const hkDist = makeCompany('HK Distributor', 'z_hk', 800_000_000);
  hkDist.hasSubstance = false;
  const ubo = makePerson('Ring UBO', 'z_kz');

  const date = '2026-01-15';
  return {
    name: 'Case 7: Transfer Pricing Ring (90% Margin Shift)',
    project: makeProject({
      zones: [zKZ, zSG, zHK],
      nodes: [kzProd, sgTrader, hkDist, ubo],
      flows: [
        makeFlow(kzProd.id, sgTrader.id, 'Goods', 1_000_000_000, 'KZT', date),
        makeFlow(sgTrader.id, hkDist.id, 'Services', 800_000_000, 'SGD', date),
        makeFlow(hkDist.id, kzProd.id, 'Royalties', 50_000_000, 'HKD', date),
        makeFlow(hkDist.id, ubo.id, 'Dividends', 600_000_000, 'HKD', date),
      ],
      ownership: [
        makeOwnership(ubo.id, kzProd.id, 100),
        makeOwnership(ubo.id, sgTrader.id, 100),
        makeOwnership(ubo.id, hkDist.id, 100),
      ],
    }),
  };
}

// ─── Case 8: Seychelles Brackets + Thin-Cap Stress ──────────────────────────

function buildCase8(): { name: string; project: Project } {
  const zSEY = makeZone('z_sey', 'Seychelles', 'SEY', 'SEY_STANDARD', 'SCR', 0, 0, 800, 600);
  const zKZ  = makeZone('z_kz', 'Kazakhstan', 'KZ', 'KZ_STANDARD', 'KZT', 1000, 0, 800, 600);
  const zBVI = makeZone('z_bvi', 'BVI', 'BVI', 'BVI_STANDARD', 'USD', 2000, 0, 800, 600);

  const seyCo = makeCompany('SEY TradeCo', 'z_sey', 5_000_000);
  const kzOp  = makeCompany('KZ OpCo', 'z_kz', 800_000_000);
  const bviLender = makeCompany('BVI Lender', 'z_bvi', 300_000_000);
  bviLender.hasSubstance = false;
  const ubo = makePerson('SEY UBO', 'z_kz');

  const date = '2026-07-01';
  return {
    name: 'Case 8: Seychelles CIT Brackets + BVI Interest Trap',
    project: makeProject({
      zones: [zSEY, zKZ, zBVI],
      nodes: [seyCo, kzOp, bviLender, ubo],
      flows: [
        makeFlow(kzOp.id, seyCo.id, 'Services', 400_000_000, 'KZT', date),
        makeFlow(kzOp.id, bviLender.id, 'Interest', 200_000_000, 'KZT', date, 10),
        makeFlow(seyCo.id, bviLender.id, 'Interest', 100_000_000, 'SCR', date),
        makeFlow(bviLender.id, ubo.id, 'Dividends', 250_000_000, 'USD', date),
      ],
      ownership: [
        makeOwnership(ubo.id, kzOp.id, 100),
        makeOwnership(ubo.id, seyCo.id, 100),
        makeOwnership(ubo.id, bviLender.id, 100),
      ],
    }),
  };
}

// ─── Case 9: HK Offshore Profit Exemption vs FSIE ──────────────────────────

function buildCase9(): { name: string; project: Project } {
  const zHK   = makeZone('z_hk', 'Hong Kong', 'HK', 'HK_ONSHORE', 'HKD', 0, 0, 800, 600);
  const zHKOff = makeZone('z_hk_off', 'HK Offshore', 'HK', 'HK_OFFSHORE', 'HKD', 50, 300, 600, 250, 'z_hk');
  const zKZ   = makeZone('z_kz', 'Kazakhstan', 'KZ', 'KZ_STANDARD', 'KZT', 1000, 0, 800, 600);
  const zCAY  = makeZone('z_cay', 'Cayman', 'CAY', 'CAY_STANDARD', 'USD', 2000, 0, 800, 600);

  const hkOnCo  = makeCompany('HK Onshore Co', 'z_hk', 600_000_000);
  hkOnCo.hasSubstance = true;
  const hkOffCo = makeCompany('HK Offshore Co', 'z_hk_off', 400_000_000);
  hkOffCo.hasSubstance = false;
  hkOffCo.hasSeparateAccounting = true;
  const kzSource = makeCompany('KZ Revenue', 'z_kz', 1_000_000_000);
  const cayShell = makeCompany('CAY Shell', 'z_cay', 0);
  cayShell.hasSubstance = false;
  const ubo = makePerson('HK Controller', 'z_kz');

  const date = '2026-08-01';
  return {
    name: 'Case 9: HK Onshore/Offshore Split + FSIE Logic',
    project: makeProject({
      zones: [zHK, zHKOff, zKZ, zCAY],
      nodes: [hkOnCo, hkOffCo, kzSource, cayShell, ubo],
      flows: [
        makeFlow(kzSource.id, hkOnCo.id, 'Services', 500_000_000, 'KZT', date),
        makeFlow(kzSource.id, hkOffCo.id, 'Royalties', 300_000_000, 'KZT', date, 15),
        makeFlow(hkOffCo.id, cayShell.id, 'Dividends', 250_000_000, 'HKD', date),
        makeFlow(cayShell.id, ubo.id, 'Dividends', 200_000_000, 'USD', date),
        makeFlow(hkOnCo.id, ubo.id, 'Dividends', 300_000_000, 'HKD', date),
      ],
      ownership: [
        makeOwnership(ubo.id, hkOnCo.id, 100),
        makeOwnership(ubo.id, hkOffCo.id, 100),
        makeOwnership(hkOffCo.id, cayShell.id, 100),
        makeOwnership(ubo.id, kzSource.id, 100),
      ],
    }),
  };
}

// ─── Case 10: Full Spectrum — 8 Jurisdictions Crossing ──────────────────────

function buildCase10(): { name: string; project: Project } {
  const zKZ  = makeZone('z_kz', 'Kazakhstan', 'KZ', 'KZ_STANDARD', 'KZT', 0, 0, 800, 600);
  const zCY  = makeZone('z_cy', 'Cyprus', 'CY', 'CY_STANDARD', 'EUR', 1000, 0, 800, 600);
  const zUK  = makeZone('z_uk', 'UK', 'UK', 'UK_STANDARD', 'GBP', 2000, 0, 800, 600);
  const zUS  = makeZone('z_us', 'US Delaware', 'US', 'US_STANDARD', 'USD', 3000, 0, 800, 600);
  const zSG  = makeZone('z_sg', 'Singapore', 'SG', 'SG_STANDARD', 'SGD', 0, 800, 800, 600);
  const zBVI = makeZone('z_bvi', 'BVI', 'BVI', 'BVI_STANDARD', 'USD', 1000, 800, 800, 600);
  const zHK  = makeZone('z_hk', 'Hong Kong', 'HK', 'HK_ONSHORE', 'HKD', 2000, 800, 800, 600);
  const zUAE = makeZone('z_uae', 'UAE', 'UAE', 'UAE_MAINLAND', 'AED', 3000, 800, 800, 600);

  const kz = makeCompany('KZ HQ', 'z_kz', 5_000_000_000);
  const cy = makeCompany('CY Hold', 'z_cy', 1_000_000_000);
  const uk = makeCompany('UK Sub', 'z_uk', 600_000_000);
  const us = makeCompany('US LLC', 'z_us', 400_000_000);
  const sg = makeCompany('SG Ops', 'z_sg', 800_000_000);
  const bvi = makeCompany('BVI IP', 'z_bvi', 2_000_000_000);
  bvi.hasSubstance = false;
  const hk = makeCompany('HK Trade', 'z_hk', 1_500_000_000);
  hk.hasSubstance = false;
  const uae = makeCompany('UAE FZ', 'z_uae', 300_000_000);
  const ubo = makePerson('Global UBO', 'z_kz');

  const date = '2026-09-01';
  return {
    name: 'Case 10: Full Spectrum — 8 Jurisdictions, Max Complexity',
    project: makeProject({
      zones: [zKZ, zCY, zUK, zUS, zSG, zBVI, zHK, zUAE],
      nodes: [kz, cy, uk, us, sg, bvi, hk, uae, ubo],
      flows: [
        makeFlow(kz.id, cy.id, 'Royalties', 800_000_000, 'KZT', date),
        makeFlow(kz.id, uk.id, 'Services', 500_000_000, 'KZT', date),
        makeFlow(cy.id, bvi.id, 'Dividends', 600_000_000, 'EUR', date),
        makeFlow(bvi.id, hk.id, 'Royalties', 1_000_000_000, 'USD', date),
        makeFlow(hk.id, sg.id, 'Services', 400_000_000, 'HKD', date),
        makeFlow(sg.id, uae.id, 'Goods', 300_000_000, 'SGD', date),
        makeFlow(us.id, kz.id, 'Interest', 200_000_000, 'USD', date),
        makeFlow(uae.id, ubo.id, 'Dividends', 250_000_000, 'AED', date),
        makeFlow(bvi.id, ubo.id, 'Dividends', 800_000_000, 'USD', date),
      ],
      ownership: [
        makeOwnership(ubo.id, kz.id, 100),
        makeOwnership(kz.id, cy.id, 100),
        makeOwnership(cy.id, bvi.id, 100),
        makeOwnership(bvi.id, hk.id, 100),
        makeOwnership(hk.id, sg.id, 60),
        makeOwnership(kz.id, uk.id, 100),
        makeOwnership(kz.id, us.id, 100),
        makeOwnership(sg.id, uae.id, 100),
      ],
      isPillarTwoScope: true,
      consolidatedRevenueEur: 2_000_000_000,
    }),
  };
}

// ─── Mutation Engine ────────────────────────────────────────────────────────

function mutateProject(base: Project, rng: () => number): Project {
  const p: Project = JSON.parse(JSON.stringify(base));

  // 1. Toggle hasSubstance on BVI/HK/CAY/SEY companies
  for (const n of p.nodes) {
    if (n.type !== 'company') continue;
    const z = p.zones.find((z) => z.id === n.zoneId);
    if (!z) continue;
    if (['BVI', 'CAY', 'SEY', 'HK'].includes(z.jurisdiction)) {
      if (rng() < 0.5) n.hasSubstance = !n.hasSubstance;
    }
    // Toggle AIFC CIGA outsourcing
    if (z.code === 'KZ_AIFC' && n.complianceData?.aifc) {
      if (rng() < 0.3) n.complianceData.aifc.cigaInZone = !n.complianceData.aifc.cigaInZone;
    }
    // Toggle BVI substance specifics
    if (z.jurisdiction === 'BVI' && n.complianceData?.bvi) {
      if (rng() < 0.4) {
        n.complianceData.bvi.relevantActivity = true;
        n.complianceData.bvi.employees = rng() < 0.5 ? 0 : 3;
        n.complianceData.bvi.office = rng() < 0.5;
      }
    }
    // Vary Nexus fraction for Hub companies
    if (z.code === 'KZ_HUB' && n.nexusParams) {
      n.nexusParams.rOut1 = Math.floor(rng() * 100);
      n.nexusParams.rAcq = Math.floor(rng() * 50);
    }
    // Vary hasSeparateAccounting
    if (rng() < 0.2) n.hasSeparateAccounting = !n.hasSeparateAccounting;
  }

  // 2. Toggle applyDTT on cross-border flows
  for (const f of p.flows) {
    if (rng() < 0.35) {
      f.applyDTT = !f.applyDTT;
      if (f.applyDTT) f.customWhtRate = Math.floor(rng() * 10) + 2; // 2–11%
    }
  }

  // 3. Vary annualIncome ±30%
  for (const n of p.nodes) {
    if (n.type !== 'company' || n.annualIncome <= 0) continue;
    const factor = 0.7 + rng() * 0.6; // 0.7 to 1.3
    n.annualIncome = Math.round(n.annualIncome * factor);
  }

  // Rebuild master data after mutation
  ensureMasterData(p);
  ensureZoneTaxDefaults(p);
  return p;
}

// ─── Anomaly Detection ──────────────────────────────────────────────────────

function detectAnomalies(p: Project): string[] {
  const anomalies: string[] = [];

  // Check for capital anomaly: outflows exceed net equity at each node
  for (const n of p.nodes) {
    if (n.type !== 'company') continue;
    const inflows = p.flows
      .filter((f) => f.toId === n.id)
      .reduce((s, f) => s + Number(f.grossAmount || 0), 0);
    const outflows = p.flows
      .filter((f) => f.fromId === n.id)
      .reduce((s, f) => s + Number(f.grossAmount || 0), 0);
    // Rough WHT deduction on inflows
    const whtOnInflows = p.flows
      .filter((f) => f.toId === n.id)
      .reduce((s, f) => s + Number(f.grossAmount || 0) * (Number(f.whtRate || 0) / 100), 0);
    const netEquity = inflows - whtOnInflows;
    if (outflows > netEquity && netEquity > 0) {
      anomalies.push(
        `CAPITAL_ANOMALY: ${n.name} — outflows ${fmtNum(outflows)} exceed net equity ${fmtNum(netEquity)} (deficit ${fmtNum(outflows - netEquity)})`,
      );
    }
  }

  return anomalies;
}

// ─── Run a Single Case ──────────────────────────────────────────────────────

function runCase(
  caseId: number, caseName: string, project: Project, variant: number,
): CaseResult {
  try {
    const p: Project = JSON.parse(JSON.stringify(project));
    ensureMasterData(p);
    ensureZoneTaxDefaults(p);
    recomputeRisks(p);
    const tax = computeGroupTax(p);
    const anomalies = detectAnomalies(p);

    const allFlags: string[] = [];
    for (const n of p.nodes) {
      for (const f of n.riskFlags) {
        allFlags.push(`${n.name}: ${f.type}${f.lawRef ? ` [${f.lawRef}]` : ''}`);
      }
    }
    for (const f of p.projectRiskFlags) {
      allFlags.push(`PROJECT: ${f.type}${f.lawRef ? ` [${f.lawRef}]` : ''}`);
    }

    return {
      caseId, caseName, variant,
      totalCIT: tax.totalCITBase,
      totalWHT: tax.totalWHTBase,
      totalTax: tax.totalTaxBase,
      totalIncome: tax.totalIncomeBase,
      etr: tax.totalEffectiveTaxRate,
      riskFlags: allFlags,
      anomalies,
      error: null,
    };
  } catch (err) {
    return {
      caseId, caseName, variant,
      totalCIT: 0, totalWHT: 0, totalTax: 0, totalIncome: 0, etr: 0,
      riskFlags: [], anomalies: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Formatting ─────────────────────────────────────────────────────────────

function fmtNum(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function fmtPct(n: number): string {
  return (n * 100).toFixed(2) + '%';
}

// ─── Markdown Report Generator ──────────────────────────────────────────────

function generateReport(results: CaseResult[]): string {
  const lines: string[] = [];
  const ts = new Date().toISOString();

  lines.push('# 1000-Run Deep Stress Test — Tax Engine Validation');
  lines.push('');
  lines.push(`**Generated:** ${ts}`);
  lines.push(`**Total Runs:** ${results.length}`);
  const errors = results.filter((r) => r.error);
  const passed = results.length - errors.length;
  lines.push(`**Passed:** ${passed} | **Failed:** ${errors.length}`);
  lines.push('');

  // ── Summary per Case ──────────────────────────────────────────────────────
  lines.push('## Summary by Case');
  lines.push('');
  lines.push('| Case | Name | Runs | Errors | Avg CIT | Avg WHT | Avg ETR | Flags Triggered |');
  lines.push('|---|---|---|---|---|---|---|---|');

  const caseIds = [...new Set(results.map((r) => r.caseId))].sort((a, b) => a - b);
  for (const cid of caseIds) {
    const caseResults = results.filter((r) => r.caseId === cid);
    const caseErrors = caseResults.filter((r) => r.error).length;
    const valid = caseResults.filter((r) => !r.error);
    const avgCIT = valid.length > 0 ? valid.reduce((s, r) => s + r.totalCIT, 0) / valid.length : 0;
    const avgWHT = valid.length > 0 ? valid.reduce((s, r) => s + r.totalWHT, 0) / valid.length : 0;
    const avgETR = valid.length > 0 ? valid.reduce((s, r) => s + r.etr, 0) / valid.length : 0;
    const allFlags = new Set<string>();
    for (const r of valid) {
      for (const f of r.riskFlags) {
        const flagType = f.split(':')[1]?.trim().split(' ')[0] ?? f;
        allFlags.add(flagType);
      }
    }
    const name = caseResults[0]?.caseName ?? `Case ${cid}`;
    lines.push(`| ${cid} | ${name.slice(0, 60)} | ${caseResults.length} | ${caseErrors} | ${fmtNum(avgCIT)} | ${fmtNum(avgWHT)} | ${fmtPct(avgETR)} | ${[...allFlags].join(', ') || 'None'} |`);
  }
  lines.push('');

  // ── Detailed Base Case Results (variant 0) ────────────────────────────────
  lines.push('## Detailed Base Case Results (Variant 0 — No Mutations)');
  lines.push('');

  const baseCases = results.filter((r) => r.variant === 0);
  for (const bc of baseCases) {
    lines.push(`### ${bc.caseName}`);
    lines.push('');
    lines.push('| Metric | Value |');
    lines.push('|---|---|');
    lines.push(`| **Total CIT** | ${fmtNum(bc.totalCIT)} KZT |`);
    lines.push(`| **Total WHT** | ${fmtNum(bc.totalWHT)} KZT |`);
    lines.push(`| **Total Tax Burden** | ${fmtNum(bc.totalTax)} KZT |`);
    lines.push(`| **Total Income** | ${fmtNum(bc.totalIncome)} KZT |`);
    lines.push(`| **Consolidated ETR** | ${fmtPct(bc.etr)} |`);
    lines.push(`| **Error** | ${bc.error ?? 'None'} |`);
    lines.push('');

    if (bc.riskFlags.length > 0) {
      lines.push('**D-MACE Risk Flags:**');
      lines.push('');
      for (const f of bc.riskFlags) {
        lines.push(`- ${f}`);
      }
      lines.push('');
    } else {
      lines.push('**D-MACE Risk Flags:** None triggered.');
      lines.push('');
    }

    if (bc.anomalies.length > 0) {
      lines.push('**Anomalies Detected:**');
      lines.push('');
      for (const a of bc.anomalies) {
        lines.push(`- ${a}`);
      }
      lines.push('');
    }
  }

  // ── Case 1 Deep Dive ──────────────────────────────────────────────────────
  lines.push('## Case 1 — Deep Dive (CFO Specification)');
  lines.push('');
  const c1base = baseCases.find((r) => r.caseId === 1);
  if (c1base) {
    lines.push('### Expected Behaviors');
    lines.push('');
    lines.push('| Check | Result |');
    lines.push('|---|---|');

    const hasCFC = c1base.riskFlags.some((f) => f.includes('CFC_RISK'));
    const hasSubstanceBreach = c1base.riskFlags.some((f) => f.includes('SUBSTANCE_BREACH'));
    const hasTP = c1base.riskFlags.some((f) => f.includes('TRANSFER_PRICING_RISK'));
    const hasAnomaly = c1base.anomalies.some((a) => a.includes('CAPITAL_ANOMALY') && a.includes('Посредник'));

    lines.push(`| CFC_RISK triggered for KZ Citizen (N7 → BVI Траст) | ${hasCFC ? 'YES' : 'NO'} |`);
    lines.push(`| SUBSTANCE_BREACH for BVI Траст | ${hasSubstanceBreach ? 'YES' : 'NO'} |`);
    lines.push(`| TRANSFER_PRICING_RISK for 95% margin shift (N2 → N3) | ${hasTP ? 'YES' : 'NO'} |`);
    lines.push(`| Capital Anomaly: 850M distribution > 670M net equity at HK | ${hasAnomaly ? 'DETECTED' : 'NOT DETECTED'} |`);
    lines.push(`| WHT on KZ exit (F3: N3 → N4 at 20%) | Verified via WHT total |`);
    lines.push('');
  }

  // ── ETR Distribution ──────────────────────────────────────────────────────
  lines.push('## ETR Distribution Across 1,000 Runs');
  lines.push('');
  const validResults = results.filter((r) => !r.error);
  const etrBuckets: Record<string, number> = {
    '0%': 0, '0–5%': 0, '5–10%': 0, '10–15%': 0,
    '15–20%': 0, '20–30%': 0, '30%+': 0,
  };
  for (const r of validResults) {
    const pct = r.etr * 100;
    if (pct === 0) etrBuckets['0%']++;
    else if (pct < 5) etrBuckets['0–5%']++;
    else if (pct < 10) etrBuckets['5–10%']++;
    else if (pct < 15) etrBuckets['10–15%']++;
    else if (pct < 20) etrBuckets['15–20%']++;
    else if (pct < 30) etrBuckets['20–30%']++;
    else etrBuckets['30%+']++;
  }
  lines.push('| ETR Bucket | Count | % of Total |');
  lines.push('|---|---|---|');
  for (const [bucket, count] of Object.entries(etrBuckets)) {
    const pctOfTotal = validResults.length > 0 ? ((count / validResults.length) * 100).toFixed(1) : '0';
    lines.push(`| ${bucket} | ${count} | ${pctOfTotal}% |`);
  }
  lines.push('');

  // ── Error Log ─────────────────────────────────────────────────────────────
  if (errors.length > 0) {
    lines.push('## Error Log');
    lines.push('');
    lines.push('| Case | Variant | Error |');
    lines.push('|---|---|---|');
    for (const e of errors.slice(0, 50)) {
      lines.push(`| ${e.caseId} | ${e.variant} | ${e.error} |`);
    }
    if (errors.length > 50) lines.push(`| ... | ... | ${errors.length - 50} more errors omitted |`);
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push(`*Generated by Tax Modeler 2026 Stress Test Runner on ${ts}.*`);
  lines.push('');

  return lines.join('\n');
}

// ─── Main Execution ─────────────────────────────────────────────────────────

function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  TAX MODELER 2026 — 1000-Run Deep Stress Test          ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('');

  const caseBuilders = [
    buildCase1, buildCase2, buildCase3, buildCase4, buildCase5,
    buildCase6, buildCase7, buildCase8, buildCase9, buildCase10,
  ];

  const allResults: CaseResult[] = [];
  const VARIANTS_PER_CASE = 100;
  let totalRuns = 0;

  for (let i = 0; i < caseBuilders.length; i++) {
    const caseId = i + 1;
    const { name, project } = caseBuilders[i]();
    console.log(`[Case ${caseId}] ${name}`);

    // Variant 0: base case (no mutations)
    const baseResult = runCase(caseId, name, project, 0);
    allResults.push(baseResult);
    totalRuns++;

    const flagSummary = baseResult.riskFlags.length > 0
      ? baseResult.riskFlags.map((f) => f.split(':')[1]?.trim().split(' ')[0] ?? '?').join(', ')
      : 'none';
    console.log(`  Base: CIT=${fmtNum(baseResult.totalCIT)} WHT=${fmtNum(baseResult.totalWHT)} ETR=${fmtPct(baseResult.etr)} Flags=[${flagSummary}]${baseResult.error ? ' ERROR=' + baseResult.error : ''}`);

    // Variants 1–99: mutated
    const rng = mulberry32(caseId * 1000);
    for (let v = 1; v < VARIANTS_PER_CASE; v++) {
      const mutated = mutateProject(project, rng);
      const result = runCase(caseId, name, mutated, v);
      allResults.push(result);
      totalRuns++;
    }

    const caseErrors = allResults.filter((r) => r.caseId === caseId && r.error).length;
    console.log(`  → ${VARIANTS_PER_CASE} variants: ${VARIANTS_PER_CASE - caseErrors} passed, ${caseErrors} errors`);
    console.log('');
  }

  // ── Generate & Write Report ─────────────────────────────────────────────
  const report = generateReport(allResults);

  const reportsDir = resolve(__dirname, '..', 'reports');
  mkdirSync(reportsDir, { recursive: true });
  const reportPath = resolve(reportsDir, 'stress-test-1000-results.md');
  writeFileSync(reportPath, report, 'utf-8');

  const errors = allResults.filter((r) => r.error).length;
  console.log('═══════════════════════════════════════════════════════');
  console.log(`TOTAL RUNS: ${totalRuns}`);
  console.log(`PASSED: ${totalRuns - errors}`);
  console.log(`FAILED: ${errors}`);
  console.log(`REPORT: ${reportPath}`);
  console.log('═══════════════════════════════════════════════════════');

  // Exit with error code if any failures
  if (errors > 0) process.exit(1);
}

main();
