/**
 * Jotai atom-level tests for reparentNodeAtom — cross-zone node transfers.
 *
 * Verifies that:
 * 1. A node can be re-parented to a different Tax Regime (change of tax residency)
 * 2. Both zoneId and regimeId are updated on the node
 * 3. hasError is cleared when a node is successfully re-parented
 * 4. The projectAtom is kept in sync with nodesAtom
 */

import { describe, it, expect } from 'vitest';
import { createStore } from 'jotai';
import { nodesAtom } from '@entities/node';
import { zonesAtom } from '@entities/zone';
import { projectAtom } from '../project-atom';
import { reparentNodeAtom, flagNodeErrorAtom, NODE_WIDTH, NODE_HEIGHT } from '../graph-actions-atom';
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

function makeTestNode(id: string, zoneId: string | null, overrides?: Partial<NodeDTO>): NodeDTO {
  return {
    id,
    name: 'TestNode',
    type: 'company',
    x: 50,
    y: 50,
    w: NODE_WIDTH,
    h: NODE_HEIGHT,
    zoneId,
    frozen: false,
    riskFlags: [],
    annualIncome: 0,
    etr: 0,
    balances: {},
    ...overrides,
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
    baseCurrency: 'KZT',
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

function setupStore(zones: Zone[], nodes: NodeDTO[]) {
  const store = createStore();
  const project = makeTestProject(zones, nodes);
  store.set(zonesAtom, zones);
  store.set(nodesAtom, nodes);
  store.set(projectAtom, project);
  return store;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('reparentNodeAtom — cross-zone node transfers', () => {
  it('updates zoneId and regimeId when node is re-parented to a new regime', () => {
    const country = makeTestZone({ id: 'z_kz', x: 0, y: 0, w: 800, h: 600 });
    const regimeA = makeTestZone({ id: 'z_std', parentId: 'z_kz', x: 10, y: 50, w: 350, h: 500 });
    const regimeB = makeTestZone({ id: 'z_aifc', parentId: 'z_kz', x: 400, y: 50, w: 350, h: 500 });
    const node = makeTestNode('n_co1', 'z_std');

    const store = setupStore([country, regimeA, regimeB], [node]);

    // Re-parent from regime A (z_std) to regime B (z_aifc)
    store.set(reparentNodeAtom, { id: 'n_co1', newParentId: 'z_aifc' });

    const updatedNodes = store.get(nodesAtom);
    const updatedNode = updatedNodes.find((n) => n.id === 'n_co1')!;

    expect(updatedNode.zoneId).toBe('z_aifc');
    expect(updatedNode.regimeId).toBe('z_aifc');
  });

  it('clears hasError when node is successfully re-parented', () => {
    const regimeA = makeTestZone({ id: 'z_std', parentId: 'z_kz', x: 10, y: 50, w: 350, h: 500 });
    const regimeB = makeTestZone({ id: 'z_aifc', parentId: 'z_kz', x: 400, y: 50, w: 350, h: 500 });
    const node = makeTestNode('n_co1', 'z_std', { hasError: true });

    const store = setupStore([regimeA, regimeB], [node]);

    store.set(reparentNodeAtom, { id: 'n_co1', newParentId: 'z_aifc' });

    const updatedNode = store.get(nodesAtom).find((n) => n.id === 'n_co1')!;
    expect(updatedNode.hasError).toBe(false);
  });

  it('syncs projectAtom when node is re-parented', () => {
    const regimeA = makeTestZone({ id: 'z_std', parentId: 'z_kz' });
    const regimeB = makeTestZone({ id: 'z_aifc', parentId: 'z_kz' });
    const node = makeTestNode('n_co1', 'z_std');

    const store = setupStore([regimeA, regimeB], [node]);

    store.set(reparentNodeAtom, { id: 'n_co1', newParentId: 'z_aifc' });

    const project = store.get(projectAtom)!;
    const projectNode = project.nodes.find((n) => n.id === 'n_co1')!;
    expect(projectNode.zoneId).toBe('z_aifc');
    expect(projectNode.regimeId).toBe('z_aifc');
  });

  it('can re-parent a node across countries (different jurisdictions)', () => {
    const countryKZ = makeTestZone({ id: 'z_kz', jurisdiction: 'KZ', x: 0, y: 0, w: 800, h: 600 });
    const regimeKZ = makeTestZone({ id: 'z_kz_std', parentId: 'z_kz', jurisdiction: 'KZ', x: 10, y: 50, w: 350, h: 500 });
    const countryUAE = makeTestZone({ id: 'z_uae', jurisdiction: 'UAE', x: 900, y: 0, w: 800, h: 600 });
    const regimeUAE = makeTestZone({ id: 'z_uae_fz', parentId: 'z_uae', jurisdiction: 'UAE', x: 10, y: 50, w: 350, h: 500 });

    const node = makeTestNode('n_co1', 'z_kz_std');

    const store = setupStore([countryKZ, regimeKZ, countryUAE, regimeUAE], [node]);

    // Cross-country transfer: KZ Standard → UAE Free Zone
    store.set(reparentNodeAtom, { id: 'n_co1', newParentId: 'z_uae_fz' });

    const updatedNode = store.get(nodesAtom).find((n) => n.id === 'n_co1')!;
    expect(updatedNode.zoneId).toBe('z_uae_fz');
  });

  it('does not affect other nodes when one is re-parented', () => {
    const regimeA = makeTestZone({ id: 'z_std', parentId: 'z_kz' });
    const regimeB = makeTestZone({ id: 'z_aifc', parentId: 'z_kz' });
    const node1 = makeTestNode('n_co1', 'z_std');
    const node2 = makeTestNode('n_co2', 'z_std');

    const store = setupStore([regimeA, regimeB], [node1, node2]);

    store.set(reparentNodeAtom, { id: 'n_co1', newParentId: 'z_aifc' });

    const updatedNodes = store.get(nodesAtom);
    const co1 = updatedNodes.find((n) => n.id === 'n_co1')!;
    const co2 = updatedNodes.find((n) => n.id === 'n_co2')!;

    expect(co1.zoneId).toBe('z_aifc');
    expect(co2.zoneId).toBe('z_std'); // unchanged
  });
});

describe('flagNodeErrorAtom — spatial validation error state', () => {
  it('sets hasError to true when node is outside all regimes', () => {
    const node = makeTestNode('n_co1', null);
    const store = setupStore([], [node]);

    store.set(flagNodeErrorAtom, { id: 'n_co1', hasError: true });

    const updatedNode = store.get(nodesAtom).find((n) => n.id === 'n_co1')!;
    expect(updatedNode.hasError).toBe(true);
  });

  it('clears hasError when node is inside a valid regime', () => {
    const node = makeTestNode('n_co1', 'z_std', { hasError: true });
    const store = setupStore([], [node]);

    store.set(flagNodeErrorAtom, { id: 'n_co1', hasError: false });

    const updatedNode = store.get(nodesAtom).find((n) => n.id === 'n_co1')!;
    expect(updatedNode.hasError).toBe(false);
  });
});
