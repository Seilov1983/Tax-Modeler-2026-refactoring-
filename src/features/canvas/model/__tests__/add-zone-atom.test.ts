/**
 * Jotai atom-level tests for addZoneAtom and moveZoneAtom.
 *
 * Verifies:
 * 1. addZoneAtom saves payload coordinates 1:1 (no double subtraction)
 * 2. moveZoneAtom saves payload coordinates 1:1 (no parent offset re-applied)
 * 3. No "double subtraction" regression where parent offsets are applied twice
 */

import { describe, it, expect } from 'vitest';
import { createStore } from 'jotai';
import { nodesAtom } from '@entities/node';
import { zonesAtom } from '@entities/zone';
import { projectAtom } from '../project-atom';
import {
  addZoneAtom,
  moveZoneAtom,
  addNodeAtom,
  NODE_WIDTH,
  NODE_HEIGHT,
  COUNTRY_DEFAULT_SIZE,
  REGIME_DEFAULT_SIZE,
} from '../graph-actions-atom';
import type { NodeDTO, Zone, Project } from '@shared/types';
import {
  SCHEMA_VERSION,
  ENGINE_VERSION,
  defaultMasterData,
  defaultCatalogs,
  defaultLawReferences,
} from '@shared/lib/engine/engine-core';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeTestProject(zones: Zone[] = [], nodes: NodeDTO[] = []): Project {
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

function setupStore(zones: Zone[] = [], nodes: NodeDTO[] = []) {
  const store = createStore();
  const project = makeTestProject(zones, nodes);
  store.set(zonesAtom, zones);
  store.set(nodesAtom, nodes);
  store.set(projectAtom, project);
  return store;
}

// ─── addZoneAtom Tests ────────────────────────────────────────────────────────

describe('addZoneAtom — coordinate fidelity', () => {
  it('saves payload x/y exactly as provided (no transformation)', () => {
    const store = setupStore();

    store.set(addZoneAtom, {
      jurisdiction: 'KZ',
      code: 'KZ_MAIN',
      name: 'Kazakhstan',
      currency: 'KZT',
      x: 350,
      y: 270,
    });

    const zones = store.get(zonesAtom);
    expect(zones).toHaveLength(1);
    expect(zones[0].x).toBe(350);
    expect(zones[0].y).toBe(270);
  });

  it('saves regime coordinates relative to parent without double subtraction', () => {
    const country: Zone = {
      id: 'z_country',
      name: 'Kazakhstan',
      jurisdiction: 'KZ',
      code: 'KZ_MAIN',
      currency: 'KZT',
      x: 100,
      y: 100,
      w: 600,
      h: 400,
      zIndex: 0,
      parentId: null,
    };
    const store = setupStore([country]);

    // Simulate what handleDrop does: subtract parent offset ONCE
    const pointerCanvasX = 300;
    const pointerCanvasY = 250;
    const localX = pointerCanvasX - country.x - REGIME_DEFAULT_SIZE.w / 2;
    const localY = pointerCanvasY - country.y - REGIME_DEFAULT_SIZE.h / 2;

    store.set(addZoneAtom, {
      jurisdiction: 'KZ',
      code: 'KZ_HUB',
      name: 'KZ Hub',
      currency: 'KZT',
      x: localX,
      y: localY,
      w: REGIME_DEFAULT_SIZE.w,
      h: REGIME_DEFAULT_SIZE.h,
      parentId: 'z_country',
    });

    const zones = store.get(zonesAtom);
    const regime = zones.find((z) => z.parentId === 'z_country');
    expect(regime).toBeDefined();
    // Coordinates must be exactly what was passed — no further parent subtraction
    expect(regime!.x).toBe(localX);
    expect(regime!.y).toBe(localY);
  });

  it('uses default country dimensions when w/h not provided', () => {
    const store = setupStore();

    store.set(addZoneAtom, {
      jurisdiction: 'KZ',
      code: 'KZ_1',
      name: 'KZ',
      currency: 'KZT',
      x: 0,
      y: 0,
    });

    const zones = store.get(zonesAtom);
    expect(zones[0].w).toBe(COUNTRY_DEFAULT_SIZE.w);
    expect(zones[0].h).toBe(COUNTRY_DEFAULT_SIZE.h);
  });

  it('respects explicit w/h when provided', () => {
    const store = setupStore();

    store.set(addZoneAtom, {
      jurisdiction: 'UAE',
      code: 'UAE_1',
      name: 'UAE',
      currency: 'AED',
      x: 50,
      y: 50,
      w: 300,
      h: 500,
    });

    const zones = store.get(zonesAtom);
    expect(zones[0].w).toBe(300);
    expect(zones[0].h).toBe(500);
  });

  it('negative coordinates are preserved (no clamping in atom)', () => {
    const store = setupStore();

    store.set(addZoneAtom, {
      jurisdiction: 'HK',
      code: 'HK_1',
      name: 'HK',
      currency: 'HKD',
      x: -50,
      y: -100,
    });

    const zones = store.get(zonesAtom);
    expect(zones[0].x).toBe(-50);
    expect(zones[0].y).toBe(-100);
  });
});

// ─── moveZoneAtom — coordinate fidelity ───────────────────────────────────────

describe('moveZoneAtom — coordinate fidelity (no double subtraction)', () => {
  it('saves payload coordinates 1:1 without parent offset', () => {
    const zone: Zone = {
      id: 'z_kz',
      name: 'KZ',
      jurisdiction: 'KZ',
      code: 'KZ_MAIN',
      currency: 'KZT',
      x: 100,
      y: 100,
      w: 600,
      h: 400,
      zIndex: 0,
      parentId: null,
    };
    const store = setupStore([zone]);

    // Konva onDragEnd reports node position directly
    store.set(moveZoneAtom, { id: 'z_kz', x: 250, y: 350 });

    const zones = store.get(zonesAtom);
    expect(zones[0].x).toBe(250);
    expect(zones[0].y).toBe(350);
  });

  it('does not re-subtract parent offsets for child regime moves', () => {
    const country: Zone = {
      id: 'z_country',
      name: 'Country',
      jurisdiction: 'KZ',
      code: 'KZ_MAIN',
      currency: 'KZT',
      x: 100,
      y: 100,
      w: 600,
      h: 400,
      zIndex: 0,
      parentId: null,
    };
    const regime: Zone = {
      id: 'z_regime',
      name: 'Regime',
      jurisdiction: 'KZ',
      code: 'KZ_HUB',
      currency: 'KZT',
      x: 50,
      y: 80,
      w: 200,
      h: 150,
      zIndex: 1,
      parentId: 'z_country',
    };
    const store = setupStore([country, regime]);

    // Konva nested Group reports local coordinates — move to (60, 90)
    store.set(moveZoneAtom, { id: 'z_regime', x: 60, y: 90 });

    const zones = store.get(zonesAtom);
    const movedRegime = zones.find((z) => z.id === 'z_regime')!;
    // Must be exactly 60, 90 — not (60 - 100, 90 - 100) which would be double subtraction
    expect(movedRegime.x).toBe(60);
    expect(movedRegime.y).toBe(90);
  });

  it('addNodeAtom saves coordinates 1:1', () => {
    const store = setupStore();

    const specificX = 823;
    const specificY = 417;
    store.set(addNodeAtom, { type: 'company', name: 'TestCo', x: specificX, y: specificY });

    const nodes = store.get(nodesAtom);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].x).toBe(specificX);
    expect(nodes[0].y).toBe(specificY);
  });
});
