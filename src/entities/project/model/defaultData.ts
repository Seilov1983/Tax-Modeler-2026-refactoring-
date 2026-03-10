/**
 * Default (demo) project factory.
 *
 * Creates a fully initialised Project graph with demo zones, nodes,
 * ownership edges and all master-data applied.
 */

import { uid, nowIso } from '@shared/lib/engine/utils';
import {
  SCHEMA_VERSION, ENGINE_VERSION,
  defaultMasterData, defaultCatalogs, defaultLawReferences,
  ensureMasterData, bootstrapNormalizeZones,
  makeNode, makeTXA,
} from '@shared/lib/engine/engine-core';
import { ensureZoneTaxDefaults } from '@shared/lib/engine/engine-tax';
import { recomputeRisks } from '@shared/lib/engine/engine-risks';
import type { Project, Zone, CurrencyCode, JurisdictionCode } from '@shared/types';

// ─── Zone Presets ─────────────────────────────────────────────────────────────

function makeZone(
  id: string, name: string,
  x: number, y: number, w: number, h: number,
  jurisdiction: string, code: string, currency: string,
  zIndex = 1,
): Zone {
  return { id, name, x, y, w, h, jurisdiction, code, currency, zIndex } as Zone;
}

export function makeZones(): Zone[] {
  return [
    makeZone('KZ_STD', 'Kazakhstan — Standard (KZT)', 70, 70, 520, 380, 'KZ', 'KZ_STANDARD', 'KZT', 1),
    makeZone('KZ_AIFC', 'KZ — AIFC (qualifying services) (KZT)', 120, 110, 260, 190, 'KZ', 'KZ_AIFC', 'KZT', 2),
    makeZone('KZ_HUB', 'KZ — Astana Hub (ICT priority) (KZT)', 320, 210, 230, 170, 'KZ', 'KZ_HUB', 'KZT', 3),
    makeZone('UAE_ML', 'UAE — Mainland (AED)', 640, 70, 220, 220, 'UAE', 'UAE_MAINLAND', 'AED', 1),
    makeZone('UAE_FZ_Q', 'UAE — Free Zone (QFZP, qualifying) (AED)', 870, 70, 210, 105, 'UAE', 'UAE_FREEZONE_QFZP', 'AED', 2),
    makeZone('UAE_FZ_NQ', 'UAE — Free Zone (non-QFZP / non-qualifying) (AED)', 870, 185, 210, 105, 'UAE', 'UAE_FREEZONE_NONQFZP', 'AED', 1),
    makeZone('HK_ON', 'Hong Kong — Onshore (HKD)', 640, 310, 220, 210, 'HK', 'HK_ONSHORE', 'HKD', 1),
    makeZone('HK_OFF', 'Hong Kong — Offshore deal (claim) (HKD)', 870, 310, 210, 210, 'HK', 'HK_OFFSHORE', 'HKD', 2),
    makeZone('CY_STD', 'Cyprus (EUR)', 70, 470, 260, 200, 'CY', 'CY_STANDARD', 'EUR', 1),
    makeZone('SG_STD', 'Singapore (SGD)', 350, 470, 260, 200, 'SG', 'SG_STANDARD', 'SGD', 1),
    makeZone('UK_STD', 'United Kingdom (GBP)', 640, 540, 220, 130, 'UK', 'UK_STANDARD', 'GBP', 1),
    makeZone('US_DE', 'US — Delaware (USD)', 880, 540, 200, 130, 'US', 'US_DE', 'USD', 1),
    makeZone('BVI', 'BVI (USD)', 70, 690, 260, 170, 'BVI', 'BVI_STANDARD', 'USD', 1),
  ];
}

// ─── Default Project ──────────────────────────────────────────────────────────

export function defaultProject(): Project {
  const zones = makeZones();
  const nodes = [
    makeNode('KZ Company', 'company', 240, 150),
    makeNode('HK Company', 'company', 700, 360),
    makeNode('UAE Company', 'company', 760, 160),
    makeNode('Person KZ', 'person', 120, 360),
  ];

  nodes.forEach((n) => {
    n.annualIncome = 1_000_000;
    n.etr = 0.2;
    if (n.type === 'company' && n.ledger) {
      n.ledger.balances = { KZT: 10_000_000, HKD: 200_000, AED: 200_000, USD: 20_000, EUR: 10_000, GBP: 0, SGD: 0 };
      n.balances = n.ledger.balances;
    }
  });

  zones.forEach((z) => nodes.push(makeTXA(z)));

  // Shift demo project to canvas center (2000, 2000)
  zones.forEach((z) => { z.x += 2000; z.y += 2000; });
  nodes.forEach((n) => { n.x += 2000; n.y += 2000; });

  const ownership = [
    { id: 'o_' + uid(), fromId: nodes.find((n) => n.name === 'Person KZ')!.id, toId: nodes.find((n) => n.name === 'KZ Company')!.id, percent: 100, manualAdjustment: 0 },
    { id: 'o_' + uid(), fromId: nodes.find((n) => n.name === 'KZ Company')!.id, toId: nodes.find((n) => n.name === 'HK Company')!.id, percent: 100, manualAdjustment: 0 },
  ];

  const catalogs = defaultCatalogs();

  const p = {
    schemaVersion: SCHEMA_VERSION,
    engineVersion: ENGINE_VERSION,
    projectId: 'demo_' + uid(),
    title: 'Demo Project',
    userId: 'user_demo',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    readOnly: false,
    masterData: defaultMasterData(),
    fx: {
      fxDate: '2026-01-15',
      rateToUSD: { USD: 1, KZT: 500, HKD: 7.8, AED: 3.67, EUR: 0.92, GBP: 0.79, SGD: 1.34 } as Record<string, number>,
      source: 'manual',
    },
    zones,
    nodes,
    ownership,
    catalogs,
    activeJurisdictions: catalogs.jurisdictions.filter((j) => j.enabled).map((j) => j.id),
    ui: {
      canvasW: 1400, canvasH: 1000, editMode: 'nodes',
      gridSize: 10, snapToGrid: true,
      flowLegend: { show: true, mode: 'ALL', selectedTypes: [] as string[], showTaxes: true },
    },
    flows: [],
    taxes: [],
    audit: { entries: [], lastHash: 'GENESIS' },
    periods: { closedYears: [] as number[] },
    group: { consolidatedRevenueEur: null },
    accounting: { years: {} },
    lawReferences: defaultLawReferences(),
    snapshots: [],
    pipeline: { lastRunAt: null, lastRun: null, runs: [] },
    projectRiskFlags: [],
  } as unknown as Project;

  ensureMasterData(p);
  ensureZoneTaxDefaults(p);
  bootstrapNormalizeZones(p);
  recomputeRisks(p);

  return p;
}
