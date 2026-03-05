import { uid, nowIso } from './utils.js';
import { SCHEMA_VERSION, ENGINE_VERSION } from './state.js';

// Re-export all domain modules (Facade pattern — no import changes needed in UI)
export * from './engine-core.js';
export * from './engine-tax.js';
export * from './engine-risks.js';
export * from './engine-accounting.js';

// Import what we need for project generators
import { defaultMasterData, defaultCatalogs, makeNode, makeTXA, ensureMasterData, bootstrapNormalizeZones, defaultLawReferences } from './engine-core.js';
import { ensureZoneTaxDefaults } from './engine-tax.js';
import { recomputeRisks, recomputeFrozen, updateFlowCompliance } from './engine-risks.js';

export function makeZones() {
  const zones = [];
  let z = (id, name, x, y, w, h, jurisdiction, code, currency, zIndex=1) => ({ id, name, x, y, w, h, jurisdiction, code, currency, zIndex });
  zones.push(z("KZ_STD", "Kazakhstan — Standard (KZT)", 70, 70, 520, 380, "KZ", "KZ_STANDARD", "KZT", 1));
  zones.push(z("KZ_AIFC", "KZ — AIFC (qualifying services) (KZT)", 120, 110, 260, 190, "KZ", "KZ_AIFC", "KZT", 2));
  zones.push(z("KZ_HUB", "KZ — Astana Hub (ICT priority) (KZT)", 320, 210, 230, 170, "KZ", "KZ_HUB", "KZT", 3));
  zones.push(z("UAE_ML", "UAE — Mainland (AED)", 640, 70, 220, 220, "UAE", "UAE_MAINLAND", "AED", 1));
  zones.push(z("UAE_FZ_Q", "UAE — Free Zone (QFZP, qualifying) (AED)", 870, 70, 210, 105, "UAE", "UAE_FREEZONE_QFZP", "AED", 2));
  zones.push(z("UAE_FZ_NQ", "UAE — Free Zone (non-QFZP / non-qualifying) (AED)", 870, 185, 210, 105, "UAE", "UAE_FREEZONE_NONQFZP", "AED", 1));
  zones.push(z("HK_ON", "Hong Kong — Onshore (HKD)", 640, 310, 220, 210, "HK", "HK_ONSHORE", "HKD", 1));
  zones.push(z("HK_OFF", "Hong Kong — Offshore deal (claim) (HKD)", 870, 310, 210, 210, "HK", "HK_OFFSHORE", "HKD", 2));
  zones.push(z("CY_STD", "Cyprus (EUR)", 70, 470, 260, 200, "CY", "CY_STANDARD", "EUR", 1));
  zones.push(z("SG_STD", "Singapore (SGD)", 350, 470, 260, 200, "SG", "SG_STANDARD", "SGD", 1));
  zones.push(z("UK_STD", "United Kingdom (GBP)", 640, 540, 220, 130, "UK", "UK_STANDARD", "GBP", 1));
  zones.push(z("US_DE", "US — Delaware (USD)", 880, 540, 200, 130, "US", "US_DE", "USD", 1));
  zones.push(z("BVI", "BVI (USD)", 70, 690, 260, 170, "BVI", "BVI_STANDARD", "USD", 1));
  return zones;
}

export function defaultProject() {
  const zones = makeZones();
  const nodes = [
    makeNode("KZ Company", "company", 240, 150),
    makeNode("HK Company", "company", 700, 360),
    makeNode("UAE Company", "company", 760, 160),
    makeNode("Person KZ", "person", 120, 360),
  ];

  nodes.forEach(n => {
    n.annualIncome = 1_000_000;
    n.etr = 0.2;
    if (n.type === "company" && n.ledger) {
      n.ledger.balances = { KZT: 10_000_000, HKD: 200_000, AED: 200_000, USD: 20_000, EUR: 10_000, GBP: 0, SGD: 0 };
      n.balances = n.ledger.balances;
    }
  });

  zones.forEach(z => nodes.push(makeTXA(z)));

  // Shift demo project to canvas center (2000, 2000)
  zones.forEach(z => { z.x += 2000; z.y += 2000; });
  nodes.forEach(n => { n.x += 2000; n.y += 2000; });

  const ownership = [
    { id:"o_"+uid(), fromId: nodes.find(n=>n.name==="Person KZ").id, toId: nodes.find(n=>n.name==="KZ Company").id, percent: 100, manualAdjustment: 0 },
    { id:"o_"+uid(), fromId: nodes.find(n=>n.name==="KZ Company").id, toId: nodes.find(n=>n.name==="HK Company").id, percent: 100, manualAdjustment: 0 },
  ];

  const p = {
    schemaVersion: SCHEMA_VERSION, engineVersion: ENGINE_VERSION, projectId: "demo_" + uid(), title: "Demo Project", userId: "user_demo", createdAt: nowIso(), updatedAt: nowIso(), readOnly: false,
    masterData: defaultMasterData(), fx: { fxDate: "2026-01-15", rateToUSD: { USD: 1, KZT: 500, HKD: 7.8, AED: 3.67, EUR: 0.92, GBP: 0.79, SGD: 1.34 }, source: "manual" },
    zones, nodes, ownership, catalogs: defaultCatalogs(), activeJurisdictions: defaultCatalogs().jurisdictions.filter(j=>j.enabled).map(j=>j.id),
    ui: { canvasW: 1400, canvasH: 1000, editMode: "nodes", gridSize: 10, snapToGrid: true, flowLegend: { show: true, mode: "ALL", selectedTypes: [], showTaxes: true } },
    flows: [], taxes: [], audit: { entries: [], lastHash: "GENESIS" }, periods: { closedYears: [] }, group: { consolidatedRevenueEur: null }, accounting: { years: {} },
    lawReferences: defaultLawReferences(), snapshots: [], pipeline: { lastRunAt: null, lastRun: null, runs: [] }, projectRiskFlags: []
  };

  ensureMasterData(p); ensureZoneTaxDefaults(p); bootstrapNormalizeZones(p); recomputeRisks(p);
  return p;
}

export function emptyProject() {
  const cat = defaultCatalogs();
  cat.jurisdictions = [];
  const p = {
    schemaVersion: SCHEMA_VERSION, engineVersion: ENGINE_VERSION, projectId: "proj_" + uid(), title: "New Project", userId: "user_" + uid(), createdAt: nowIso(), updatedAt: nowIso(), readOnly: false,
    masterData: {}, fx: { fxDate: nowIso().slice(0,10), rateToUSD: { USD: 1, KZT: 500, EUR: 0.92 }, source: "manual" },
    zones: [], nodes: [], ownership: [], catalogs: cat, activeJurisdictions: [],
    ui: { canvasW: 1400, canvasH: 1000, editMode: "zones", gridSize: 10, snapToGrid: true, flowLegend: { show: true, mode: "ALL", selectedTypes: [], showTaxes: true } },
    flows: [], taxes: [], audit: { entries: [], lastHash: "GENESIS" }, periods: { closedYears: [] }, group: { consolidatedRevenueEur: null }, accounting: { years: {} },
    lawReferences: defaultLawReferences(), snapshots: [], pipeline: { lastRunAt: null, lastRun: null, runs: [] }, projectRiskFlags: []
  };
  ensureMasterData(p); ensureZoneTaxDefaults(p);
  return p;
}
