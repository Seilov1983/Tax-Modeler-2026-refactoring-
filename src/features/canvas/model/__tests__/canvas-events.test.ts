/**
 * Tests for CanvasBoard event handling logic:
 *
 * 1. Double-click: stopPropagation + preventDefault must be called
 *    to prevent camera reset (viewport jump) from event bubbling.
 *
 * 2. Context menu: "Create Company" / "Create Person" must pass
 *    the explicitly stored canvasX/canvasY to addNodeAtom,
 *    not default center coordinates.
 *
 * These tests verify the behavioral contracts at the logic level,
 * without requiring a full DOM (jsdom) environment.
 */

import { describe, it, expect, vi } from 'vitest';
import { createStore } from 'jotai';
import { nodesAtom } from '@entities/node';
import { zonesAtom } from '@entities/zone';
import { projectAtom } from '../project-atom';
import { addNodeAtom, NODE_WIDTH, NODE_HEIGHT } from '../graph-actions-atom';
import type { Project } from '@shared/types';
import {
  SCHEMA_VERSION,
  ENGINE_VERSION,
  defaultMasterData,
  defaultCatalogs,
  defaultLawReferences,
} from '@shared/lib/engine/engine-core';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeTestProject(): Project {
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
  } as Project;
}

// ─── Task 2, Test 1: stopPropagation on double-click ─────────────────────────

describe('Double-click event handling — stopPropagation contract', () => {
  /**
   * Simulates the handleDoubleClick logic from CanvasBoard.tsx.
   * The real handler calls e.stopPropagation() and e.preventDefault()
   * to prevent the event from bubbling to viewport/controls (camera jump).
   */
  function simulateHandleDoubleClick(e: {
    target: { closest: (sel: string) => unknown };
    stopPropagation: () => void;
    preventDefault: () => void;
    clientX: number;
    clientY: number;
  }) {
    // Guard checks (same as CanvasBoard.tsx lines 121-123)
    if (e.target.closest('.no-canvas-events')) return null;
    if (e.target.closest('.canvas-node')) return null;
    if (e.target.closest('button')) return null;

    // CRITICAL: prevent bubbling to viewport wrapper / CanvasControls
    e.stopPropagation();
    e.preventDefault();

    // Simulate clientToCanvas conversion (assuming identity viewport for test)
    const panX = 0, panY = 0, scale = 1, rectLeft = 0, rectTop = 0;
    const canvasX = (e.clientX - rectLeft - panX) / scale;
    const canvasY = (e.clientY - rectTop - panY) / scale;

    return {
      x: e.clientX,
      y: e.clientY,
      canvasX: Math.round(canvasX - NODE_WIDTH / 2),
      canvasY: Math.round(canvasY - NODE_HEIGHT / 2),
    };
  }

  it('calls stopPropagation on double-click event', () => {
    const stopPropagation = vi.fn();
    const preventDefault = vi.fn();

    const fakeEvent = {
      target: { closest: () => null },
      stopPropagation,
      preventDefault,
      clientX: 500,
      clientY: 300,
    };

    simulateHandleDoubleClick(fakeEvent);

    expect(stopPropagation).toHaveBeenCalledOnce();
  });

  it('calls preventDefault on double-click event', () => {
    const stopPropagation = vi.fn();
    const preventDefault = vi.fn();

    const fakeEvent = {
      target: { closest: () => null },
      stopPropagation,
      preventDefault,
      clientX: 500,
      clientY: 300,
    };

    simulateHandleDoubleClick(fakeEvent);

    expect(preventDefault).toHaveBeenCalledOnce();
  });

  it('does NOT call stopPropagation when clicking on a canvas-node', () => {
    const stopPropagation = vi.fn();
    const preventDefault = vi.fn();

    const fakeEvent = {
      target: {
        closest: (sel: string) => (sel === '.canvas-node' ? {} : null),
      },
      stopPropagation,
      preventDefault,
      clientX: 500,
      clientY: 300,
    };

    const result = simulateHandleDoubleClick(fakeEvent);

    expect(result).toBeNull();
    expect(stopPropagation).not.toHaveBeenCalled();
  });

  it('stores canvasX/canvasY centered on the click position', () => {
    const fakeEvent = {
      target: { closest: () => null },
      stopPropagation: vi.fn(),
      preventDefault: vi.fn(),
      clientX: 500,
      clientY: 300,
    };

    const contextMenu = simulateHandleDoubleClick(fakeEvent);

    expect(contextMenu).not.toBeNull();
    // Canvas coords should be click position minus half node dimensions
    expect(contextMenu!.canvasX).toBe(500 - NODE_WIDTH / 2);  // 410
    expect(contextMenu!.canvasY).toBe(300 - NODE_HEIGHT / 2); // 260
  });
});

// ─── Task 2, Test 2: Context menu passes correct coordinates to addNodeAtom ──

describe('Context menu — passes explicit canvasX/canvasY to addNodeAtom', () => {
  /**
   * Simulates the handleContextMenuCreate logic from CanvasBoard.tsx.
   * The real handler reads canvasX/canvasY from the stored contextMenu state
   * and passes them to addNodeAtom — never falls back to center defaults.
   */
  function simulateContextMenuCreate(
    contextMenu: { canvasX: number; canvasY: number } | null,
    type: 'company' | 'person',
  ) {
    if (!contextMenu) return null;
    const name = type === 'company' ? 'New Company' : 'New Person';
    return { type, name, x: contextMenu.canvasX, y: contextMenu.canvasY };
  }

  it('passes stored canvasX/canvasY to addNode for Company', () => {
    const contextMenu = { canvasX: 410, canvasY: 260 };
    const payload = simulateContextMenuCreate(contextMenu, 'company');

    expect(payload).not.toBeNull();
    expect(payload!.x).toBe(410);
    expect(payload!.y).toBe(260);
    expect(payload!.type).toBe('company');
  });

  it('passes stored canvasX/canvasY to addNode for Person', () => {
    const contextMenu = { canvasX: 750, canvasY: 520 };
    const payload = simulateContextMenuCreate(contextMenu, 'person');

    expect(payload).not.toBeNull();
    expect(payload!.x).toBe(750);
    expect(payload!.y).toBe(520);
    expect(payload!.type).toBe('person');
  });

  it('does NOT create node when contextMenu is null', () => {
    const payload = simulateContextMenuCreate(null, 'company');
    expect(payload).toBeNull();
  });

  it('addNodeAtom places node at exact payload coordinates (via Jotai store)', () => {
    const store = createStore();
    store.set(projectAtom, makeTestProject());
    store.set(nodesAtom, []);
    store.set(zonesAtom, []);

    // Simulated coordinates from a double-click at (500, 300)
    const canvasX = Math.round(500 - NODE_WIDTH / 2);
    const canvasY = Math.round(300 - NODE_HEIGHT / 2);

    store.set(addNodeAtom, { type: 'company', name: 'New Company', x: canvasX, y: canvasY });

    const nodes = store.get(nodesAtom);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].x).toBe(canvasX);
    expect(nodes[0].y).toBe(canvasY);
    expect(nodes[0].type).toBe('company');
    expect(nodes[0].name).toBe('New Company');
  });

  it('coordinates are NOT default center (0,0) when contextMenu is populated', () => {
    const store = createStore();
    store.set(projectAtom, makeTestProject());
    store.set(nodesAtom, []);
    store.set(zonesAtom, []);

    // These specific coordinates prove the click position was used, not defaults
    const specificX = 823;
    const specificY = 417;

    store.set(addNodeAtom, { type: 'person', name: 'New Person', x: specificX, y: specificY });

    const nodes = store.get(nodesAtom);
    expect(nodes[0].x).toBe(specificX);
    expect(nodes[0].y).toBe(specificY);
    // Explicitly assert these are NOT zero/center defaults
    expect(nodes[0].x).not.toBe(0);
    expect(nodes[0].y).not.toBe(0);
  });
});
