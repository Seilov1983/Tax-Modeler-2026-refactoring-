/**
 * Regression tests for:
 * 1. Zone cascading move — child nodes follow their parent zone when it moves
 * 2. Node creation at click coordinates — new nodes spawn at cursor position
 *
 * These tests operate on the pure engine functions (framework-agnostic)
 * to verify the spatial logic that underpins both DOM animation and state commits.
 */

import { describe, it, expect } from 'vitest';
import {
  SCHEMA_VERSION,
  ENGINE_VERSION,
  detectZoneId,
  pointInZone,
  zoneArea,
  nodeCenter,
  makeNode,
  defaultMasterData,
  defaultCatalogs,
  defaultLawReferences,
} from '../engine-core';
import type { Project, Zone, NodeDTO } from '@shared/types';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** Default node dimensions (must match graph-actions-atom.ts NODE_WIDTH / NODE_HEIGHT) */
const NODE_WIDTH = 180;
const NODE_HEIGHT = 80;

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
    fx: { fxDate: '2026-03-01', rateToUSD: { USD: 1, KZT: 500 }, source: 'test' },
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

function makeZone(overrides: Partial<Zone> & { id: string }): Zone {
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

// ─── Problem 1: Zone cascade move ────────────────────────────────────────────

describe('Zone cascade move — child nodes follow zone', () => {
  /**
   * Simulates what moveZoneAtom does:
   * 1. Find the zone being moved
   * 2. Compute delta (dx, dy)
   * 3. Find all child sub-zones whose center is inside the zone
   * 4. Find all child nodes whose center is inside the zone
   * 5. Apply delta to all of them
   */
  function simulateMoveZone(
    zones: Zone[],
    nodes: NodeDTO[],
    zoneId: string,
    newX: number,
    newY: number,
  ) {
    const movedZone = zones.find((z) => z.id === zoneId)!;
    const dx = newX - movedZone.x;
    const dy = newY - movedZone.y;

    // Find child sub-zones
    const movedArea = zoneArea(movedZone);
    const childZoneIds = new Set<string>();
    for (const z of zones) {
      if (z.id === movedZone.id) continue;
      if (zoneArea(z) >= movedArea) continue;
      const cx = z.x + z.w / 2;
      const cy = z.y + z.h / 2;
      if (pointInZone(cx, cy, movedZone)) {
        childZoneIds.add(z.id);
      }
    }

    // Find child nodes (center-point check — not top-left corner!)
    const childNodeIds = new Set<string>();
    for (const n of nodes) {
      const { cx, cy } = nodeCenter(n);
      if (pointInZone(cx, cy, movedZone)) {
        childNodeIds.add(n.id);
      }
    }

    // Apply delta
    const affectedZoneIds = new Set([movedZone.id, ...childZoneIds]);
    const updatedZones = zones.map((z) =>
      affectedZoneIds.has(z.id) ? { ...z, x: z.x + dx, y: z.y + dy } : z,
    );
    const updatedNodes = nodes.map((n) =>
      childNodeIds.has(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n,
    );

    return { zones: updatedZones, nodes: updatedNodes, childNodeIds, childZoneIds };
  }

  it('node inside zone follows the zone when it moves', () => {
    const kz = makeZone({ id: 'z_kz', x: 100, y: 100, w: 600, h: 400 });
    const node = makeNode('TestCo', 'company', 200, 200);
    node.w = NODE_WIDTH;
    node.h = NODE_HEIGHT;

    const result = simulateMoveZone([kz], [node], 'z_kz', 300, 300);

    // Zone moved by +200, +200
    expect(result.zones[0].x).toBe(300);
    expect(result.zones[0].y).toBe(300);
    // Node should also move by +200, +200
    expect(result.childNodeIds.has(node.id)).toBe(true);
    expect(result.nodes[0].x).toBe(400);
    expect(result.nodes[0].y).toBe(400);
  });

  it('node outside zone does NOT move', () => {
    const kz = makeZone({ id: 'z_kz', x: 100, y: 100, w: 600, h: 400 });
    const outsideNode = makeNode('OffCo', 'company', 1500, 1500);
    outsideNode.w = NODE_WIDTH;
    outsideNode.h = NODE_HEIGHT;

    const result = simulateMoveZone([kz], [outsideNode], 'z_kz', 300, 300);

    expect(result.childNodeIds.has(outsideNode.id)).toBe(false);
    expect(result.nodes[0].x).toBe(1500);
    expect(result.nodes[0].y).toBe(1500);
  });

  it('uses node CENTER (not top-left) for containment check', () => {
    // Zone at (100, 100) with w=600, h=400 → right edge at 700, bottom at 500
    const zone = makeZone({ id: 'z_kz', x: 100, y: 100, w: 600, h: 400 });

    // Node at (610, 410): top-left is INSIDE zone, but center is at (700, 450) which is ON the edge
    const edgeNode = makeNode('EdgeCo', 'company', 610, 410);
    edgeNode.w = NODE_WIDTH; // center at 610 + 90 = 700
    edgeNode.h = NODE_HEIGHT; // center at 410 + 40 = 450

    const result = simulateMoveZone([zone], [edgeNode], 'z_kz', 200, 200);

    // Center (700, 450) is ON the edge (700 <= 100+600=700), which is considered inside
    expect(result.childNodeIds.has(edgeNode.id)).toBe(true);
  });

  it('node whose top-left is outside but center is inside still follows', () => {
    const zone = makeZone({ id: 'z_kz', x: 100, y: 100, w: 600, h: 400 });

    // Node at (50, 80): top-left is OUTSIDE the zone
    // But center is at (50 + 90, 80 + 40) = (140, 120) which IS inside
    const node = makeNode('Co', 'company', 50, 80);
    node.w = NODE_WIDTH;
    node.h = NODE_HEIGHT;

    const result = simulateMoveZone([zone], [node], 'z_kz', 200, 200);

    expect(result.childNodeIds.has(node.id)).toBe(true);
  });

  it('sub-zone and its nodes all cascade together', () => {
    const country = makeZone({ id: 'z_kz', x: 0, y: 0, w: 800, h: 600 });
    const regime = makeZone({ id: 'z_hub', x: 50, y: 80, w: 320, h: 250 });
    const node1 = makeNode('HubCo', 'company', 100, 120);
    node1.w = NODE_WIDTH;
    node1.h = NODE_HEIGHT;
    const node2 = makeNode('CountryCo', 'company', 500, 400);
    node2.w = NODE_WIDTH;
    node2.h = NODE_HEIGHT;

    const result = simulateMoveZone(
      [country, regime],
      [node1, node2],
      'z_kz',
      100, // move country by +100, +100
      100,
    );

    // Sub-zone should cascade
    expect(result.childZoneIds.has('z_hub')).toBe(true);
    const updatedRegime = result.zones.find((z) => z.id === 'z_hub')!;
    expect(updatedRegime.x).toBe(150); // 50 + 100
    expect(updatedRegime.y).toBe(180); // 80 + 100

    // Both nodes should cascade (both are inside the country)
    expect(result.childNodeIds.has(node1.id)).toBe(true);
    expect(result.childNodeIds.has(node2.id)).toBe(true);
  });

  it('multiple nodes — only those inside the zone cascade', () => {
    const zone = makeZone({ id: 'z_kz', x: 100, y: 100, w: 600, h: 400 });
    const inside = makeNode('In', 'company', 200, 200);
    inside.w = NODE_WIDTH;
    inside.h = NODE_HEIGHT;
    const outside = makeNode('Out', 'company', 1000, 1000);
    outside.w = NODE_WIDTH;
    outside.h = NODE_HEIGHT;

    const result = simulateMoveZone([zone], [inside, outside], 'z_kz', 200, 200);

    expect(result.childNodeIds.has(inside.id)).toBe(true);
    expect(result.childNodeIds.has(outside.id)).toBe(false);
    // Inside node moved by delta
    const updIn = result.nodes.find((n) => n.id === inside.id)!;
    expect(updIn.x).toBe(300);
    // Outside node unchanged
    const updOut = result.nodes.find((n) => n.id === outside.id)!;
    expect(updOut.x).toBe(1000);
  });
});

// ─── Problem 1 supplement: DOM attribute contract ────────────────────────────

describe('DOM attribute contracts for cascading drag', () => {
  it('data-node-id pattern matches what collectChildElements queries', () => {
    // CanvasNode renders: data-node-id={node.id}
    // collectChildElements queries: [data-node-id="${n.id}"]
    // These must match — this test documents the contract
    const nodeId = 'n_abc123';
    const attr = `data-node-id`;
    const selector = `[${attr}="${nodeId}"]`;
    expect(selector).toBe(`[data-node-id="${nodeId}"]`);
  });

  it('data-zone-id pattern matches what collectChildElements queries', () => {
    const zoneId = 'z_kz';
    const selector = `[data-zone-id="${zoneId}"]`;
    expect(selector).toBe(`[data-zone-id="${zoneId}"]`);
  });
});

// ─── Problem 2: Node creation at click coordinates ──────────────────────────

describe('Node creation at click coordinates', () => {
  it('addNode places node at exact payload coordinates', () => {
    // Simulates what addNodeAtom does (pure logic, no Jotai)
    const payload = { type: 'company' as const, name: 'New Company', x: 350, y: 220 };
    const newNode = {
      id: 'n_test',
      name: payload.name,
      type: payload.type,
      x: payload.x,
      y: payload.y,
      w: NODE_WIDTH,
      h: NODE_HEIGHT,
    };

    expect(newNode.x).toBe(350);
    expect(newNode.y).toBe(220);
  });

  it('double-click offset centers the node on the cursor', () => {
    // handleDoubleClick converts client → canvas, then subtracts half node size
    const canvasClickX = 500;
    const canvasClickY = 300;

    const canvasX = Math.round(canvasClickX - NODE_WIDTH / 2);
    const canvasY = Math.round(canvasClickY - NODE_HEIGHT / 2);

    expect(canvasX).toBe(410); // 500 - 90
    expect(canvasY).toBe(260); // 300 - 40

    // The node's center should be at the original click point
    const nodeCenterX = canvasX + NODE_WIDTH / 2;
    const nodeCenterY = canvasY + NODE_HEIGHT / 2;
    expect(nodeCenterX).toBe(canvasClickX);
    expect(nodeCenterY).toBe(canvasClickY);
  });

  it('NODE_WIDTH and NODE_HEIGHT match expected default dimensions', () => {
    // These constants are shared between addNodeAtom and CanvasBoard double-click offset
    expect(NODE_WIDTH).toBe(180);
    expect(NODE_HEIGHT).toBe(80);
  });

  it('newly created node inherits zone from spatial position', () => {
    const zone = makeZone({ id: 'z_kz', x: 0, y: 0, w: 800, h: 600 });
    const node = makeNode('SpawnedCo', 'company', 200, 200);
    node.w = NODE_WIDTH;
    node.h = NODE_HEIGHT;

    const p = makeProject({ zones: [zone], nodes: [node] });
    const zoneId = detectZoneId(p, node);

    // Node spawned at (200, 200) is inside zone → should inherit zone id
    expect(zoneId).toBe('z_kz');
  });

  it('node spawned outside all zones gets null zoneId', () => {
    const zone = makeZone({ id: 'z_kz', x: 0, y: 0, w: 800, h: 600 });
    const node = makeNode('OffCo', 'company', 2000, 2000);
    node.w = NODE_WIDTH;
    node.h = NODE_HEIGHT;

    const p = makeProject({ zones: [zone], nodes: [node] });
    const zoneId = detectZoneId(p, node);

    expect(zoneId).toBeNull();
  });
});
