/**
 * Jotai atom-level tests for moveZoneAtom.
 *
 * Verifies that moving a parent zone correctly cascades dx/dy to
 * all child nodes (Companies/Persons) in the nodesAtom state,
 * not just sub-zones in zonesAtom.
 */

import { describe, it, expect } from 'vitest';
import { createStore } from 'jotai';
import { nodesAtom } from '@entities/node';
import { zonesAtom } from '@entities/zone';
import { projectAtom } from '../project-atom';
import { moveZoneAtom, NODE_WIDTH, NODE_HEIGHT } from '../graph-actions-atom';
import type { NodeDTO, Zone, Project } from '@shared/types';
import {
  SCHEMA_VERSION,
  ENGINE_VERSION,
  defaultMasterData,
  defaultCatalogs,
  defaultLawReferences,
} from '@shared/lib/engine/engine-core';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeTestZone(overrides: Partial<Zone> & { id: string }): Zone {
  return {
    name: 'Zone',
    x: 0,
    y: 0,
    w: 600,
    h: 400,
    jurisdiction: 'KZ',
    code: 'KZ_MAIN',
    currency: 'KZT',
    zIndex: 0,
    ...overrides,
  };
}

function makeTestNode(id: string, name: string, type: 'company' | 'person', x: number, y: number): NodeDTO {
  return {
    id,
    name,
    type,
    x,
    y,
    w: NODE_WIDTH,
    h: NODE_HEIGHT,
    zoneId: null,
    frozen: false,
    riskFlags: [],
    annualIncome: 0,
    etr: 0,
    balances: {},
  };
}

function makeTestProject(zones: Zone[], nodes: NodeDTO[]): Project {
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
    fx: { fxDate: '2026-03-01', rateToUSD: { USD: 1, KZT: 500 }, source: 'test' },
    zones,
    nodes,
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
  } as Project;
}

/** Set up a Jotai store pre-loaded with zones, nodes, and a project. */
function setupStore(zones: Zone[], nodes: NodeDTO[]) {
  const store = createStore();
  const project = makeTestProject(zones, nodes);
  store.set(zonesAtom, zones);
  store.set(nodesAtom, nodes);
  store.set(projectAtom, project);
  return store;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('moveZoneAtom — node cascade via Jotai store', () => {
  it('moves a nested Company node by the exact dx/dy delta', () => {
    const zone = makeTestZone({ id: 'z_kz', x: 100, y: 100, w: 600, h: 400 });
    const company = makeTestNode('n_co1', 'TestCo', 'company', 200, 200);
    const store = setupStore([zone], [company]);

    // Move zone from (100,100) to (250,350) → dx=150, dy=250
    store.set(moveZoneAtom, { id: 'z_kz', x: 250, y: 350 });

    const updatedNodes = store.get(nodesAtom);
    const updatedNode = updatedNodes.find((n) => n.id === 'n_co1')!;

    expect(updatedNode.x).toBe(200 + 150); // 350
    expect(updatedNode.y).toBe(200 + 250); // 450
  });

  it('moves a nested Person node by the exact dx/dy delta', () => {
    const zone = makeTestZone({ id: 'z_kz', x: 0, y: 0, w: 800, h: 600 });
    const person = makeTestNode('n_p1', 'TestPerson', 'person', 100, 100);
    const store = setupStore([zone], [person]);

    // Move zone from (0,0) to (50,75) → dx=50, dy=75
    store.set(moveZoneAtom, { id: 'z_kz', x: 50, y: 75 });

    const updatedNodes = store.get(nodesAtom);
    const updatedNode = updatedNodes.find((n) => n.id === 'n_p1')!;

    expect(updatedNode.x).toBe(150); // 100 + 50
    expect(updatedNode.y).toBe(175); // 100 + 75
  });

  it('moves multiple nested nodes (Company + Person) together', () => {
    const zone = makeTestZone({ id: 'z_kz', x: 0, y: 0, w: 800, h: 600 });
    const company = makeTestNode('n_co1', 'Corp', 'company', 100, 100);
    const person = makeTestNode('n_p1', 'Person', 'person', 300, 200);
    const store = setupStore([zone], [company, person]);

    store.set(moveZoneAtom, { id: 'z_kz', x: 40, y: 60 });

    const updatedNodes = store.get(nodesAtom);
    const co = updatedNodes.find((n) => n.id === 'n_co1')!;
    const pe = updatedNodes.find((n) => n.id === 'n_p1')!;

    expect(co.x).toBe(140);
    expect(co.y).toBe(160);
    expect(pe.x).toBe(340);
    expect(pe.y).toBe(260);
  });

  it('does NOT move nodes that are outside the zone', () => {
    const zone = makeTestZone({ id: 'z_kz', x: 100, y: 100, w: 600, h: 400 });
    const inside = makeTestNode('n_in', 'InsideCo', 'company', 200, 200);
    const outside = makeTestNode('n_out', 'OutsideCo', 'company', 1500, 1500);
    const store = setupStore([zone], [inside, outside]);

    store.set(moveZoneAtom, { id: 'z_kz', x: 200, y: 200 });

    const updatedNodes = store.get(nodesAtom);
    const outNode = updatedNodes.find((n) => n.id === 'n_out')!;

    expect(outNode.x).toBe(1500); // unchanged
    expect(outNode.y).toBe(1500); // unchanged
  });

  it('uses center coordinates for containment check, not top-left', () => {
    // Zone at (100, 100) → right=700, bottom=500
    const zone = makeTestZone({ id: 'z_kz', x: 100, y: 100, w: 600, h: 400 });

    // Node at (50, 60): top-left OUTSIDE zone, but center at
    // (50 + 90, 60 + 40) = (140, 100) which IS inside the zone
    const node = makeTestNode('n_edge', 'EdgeCo', 'company', 50, 60);
    const store = setupStore([zone], [node]);

    store.set(moveZoneAtom, { id: 'z_kz', x: 200, y: 200 });

    const updatedNodes = store.get(nodesAtom);
    const updatedNode = updatedNodes.find((n) => n.id === 'n_edge')!;

    // dx=100, dy=100 → node should move from (50,60) to (150,160)
    expect(updatedNode.x).toBe(150);
    expect(updatedNode.y).toBe(160);
  });

  it('cascades sub-zones AND their contained nodes together', () => {
    const country = makeTestZone({ id: 'z_kz', x: 0, y: 0, w: 800, h: 600 });
    const regime = makeTestZone({ id: 'z_hub', x: 50, y: 80, w: 320, h: 250 });
    const nodeInRegime = makeTestNode('n_hub', 'HubCo', 'company', 100, 120);
    const nodeInCountry = makeTestNode('n_co', 'CountryCo', 'company', 500, 400);
    const store = setupStore([country, regime], [nodeInRegime, nodeInCountry]);

    // Move country by +100, +100
    store.set(moveZoneAtom, { id: 'z_kz', x: 100, y: 100 });

    const updatedZones = store.get(zonesAtom);
    const updatedNodes = store.get(nodesAtom);

    // Sub-zone cascaded
    const updRegime = updatedZones.find((z) => z.id === 'z_hub')!;
    expect(updRegime.x).toBe(150);
    expect(updRegime.y).toBe(180);

    // Both nodes cascaded
    const hub = updatedNodes.find((n) => n.id === 'n_hub')!;
    expect(hub.x).toBe(200);
    expect(hub.y).toBe(220);

    const co = updatedNodes.find((n) => n.id === 'n_co')!;
    expect(co.x).toBe(600);
    expect(co.y).toBe(500);
  });

  it('no-op when dx=0 and dy=0', () => {
    const zone = makeTestZone({ id: 'z_kz', x: 100, y: 100, w: 600, h: 400 });
    const node = makeTestNode('n_co', 'Co', 'company', 200, 200);
    const store = setupStore([zone], [node]);

    store.set(moveZoneAtom, { id: 'z_kz', x: 100, y: 100 });

    const updatedNodes = store.get(nodesAtom);
    expect(updatedNodes[0].x).toBe(200);
    expect(updatedNodes[0].y).toBe(200);
  });
});
