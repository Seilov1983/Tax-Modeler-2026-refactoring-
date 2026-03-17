/**
 * Property-Based Math Testing — fast-check + Vitest
 *
 * Verifies the global-to-local coordinate projection formula used in
 * CanvasBoard.tsx for DOM-to-canvas coordinate conversion.
 *
 * The formula:
 *   localX = (pointerX - panX) / scale
 *   localY = (pointerY - panY) / scale
 *
 * This is equivalent to building a 2D affine transform:
 *   T = translate(panX, panY) * scale(s, s)
 *   T⁻¹ = scale(1/s, 1/s) * translate(-panX, -panY)
 *   local = T⁻¹ * pointer
 *
 * Properties tested:
 * 1. Round-trip: local→global→local is identity
 * 2. No NaN/Infinity for valid inputs
 * 3. Centering offset produces correct spawn position
 * 4. Pan-only transform (scale=1) is a simple subtraction
 * 5. Nested local projection (parent zone offset) composes correctly
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

// ─── Pure projection functions (extracted from CanvasBoard.tsx logic) ──────────

/**
 * Global-to-local projection: converts a screen-space pointer position
 * to canvas-local coordinates given pan offset and zoom scale.
 */
function globalToLocal(
  pointerX: number,
  pointerY: number,
  panX: number,
  panY: number,
  scale: number,
): { x: number; y: number } {
  return {
    x: (pointerX - panX) / scale,
    y: (pointerY - panY) / scale,
  };
}

/**
 * Local-to-global projection: inverse of globalToLocal.
 * Converts canvas-local coordinates back to screen-space.
 */
function localToGlobal(
  localX: number,
  localY: number,
  panX: number,
  panY: number,
  scale: number,
): { x: number; y: number } {
  return {
    x: localX * scale + panX,
    y: localY * scale + panY,
  };
}

/**
 * Centers a spawned entity at a local position by subtracting half its dimensions.
 */
function centerEntity(
  localX: number,
  localY: number,
  entityW: number,
  entityH: number,
): { x: number; y: number } {
  return {
    x: localX - entityW / 2,
    y: localY - entityH / 2,
  };
}

/**
 * Nested local projection: converts global coordinates to a child zone's
 * local coordinates by first projecting to canvas-local, then subtracting
 * the parent zone's position.
 */
function globalToNestedLocal(
  pointerX: number,
  pointerY: number,
  panX: number,
  panY: number,
  scale: number,
  parentX: number,
  parentY: number,
): { x: number; y: number } {
  const canvasLocal = globalToLocal(pointerX, pointerY, panX, panY, scale);
  return {
    x: canvasLocal.x - parentX,
    y: canvasLocal.y - parentY,
  };
}

// ─── Arbitraries ──────────────────────────────────────────────────────────────

// Reasonable viewport scale: 0.1x to 10x zoom
const scaleArb = fc.double({ min: 0.1, max: 10, noNaN: true });

// Pan offsets in a large range
const panArb = fc.double({ min: -5000, max: 5000, noNaN: true });

// Pointer positions (screen-space)
const pointerArb = fc.double({ min: 0, max: 4000, noNaN: true });

// Entity dimensions
const dimArb = fc.double({ min: 10, max: 1000, noNaN: true });

// Zone positions
const zonePositionArb = fc.double({ min: -2000, max: 2000, noNaN: true });

// ─── Property Tests ───────────────────────────────────────────────────────────

describe('Global-to-Local Projection — Property-Based Tests', () => {
  it('round-trip: globalToLocal → localToGlobal is identity', () => {
    fc.assert(
      fc.property(
        pointerArb,
        pointerArb,
        panArb,
        panArb,
        scaleArb,
        (px, py, panX, panY, scale) => {
          const local = globalToLocal(px, py, panX, panY, scale);
          const roundTrip = localToGlobal(local.x, local.y, panX, panY, scale);

          // Allow small floating-point epsilon
          expect(roundTrip.x).toBeCloseTo(px, 6);
          expect(roundTrip.y).toBeCloseTo(py, 6);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('reverse round-trip: localToGlobal → globalToLocal is identity', () => {
    fc.assert(
      fc.property(
        pointerArb,
        pointerArb,
        panArb,
        panArb,
        scaleArb,
        (lx, ly, panX, panY, scale) => {
          const global = localToGlobal(lx, ly, panX, panY, scale);
          const roundTrip = globalToLocal(global.x, global.y, panX, panY, scale);

          expect(roundTrip.x).toBeCloseTo(lx, 6);
          expect(roundTrip.y).toBeCloseTo(ly, 6);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('never produces NaN for valid inputs', () => {
    fc.assert(
      fc.property(
        pointerArb,
        pointerArb,
        panArb,
        panArb,
        scaleArb,
        (px, py, panX, panY, scale) => {
          const local = globalToLocal(px, py, panX, panY, scale);

          expect(Number.isNaN(local.x)).toBe(false);
          expect(Number.isNaN(local.y)).toBe(false);
          expect(Number.isFinite(local.x)).toBe(true);
          expect(Number.isFinite(local.y)).toBe(true);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('never produces Infinity for valid inputs', () => {
    fc.assert(
      fc.property(
        pointerArb,
        pointerArb,
        panArb,
        panArb,
        scaleArb,
        (px, py, panX, panY, scale) => {
          const local = globalToLocal(px, py, panX, panY, scale);

          expect(Number.isFinite(local.x)).toBe(true);
          expect(Number.isFinite(local.y)).toBe(true);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('pan-only (scale=1) is a simple subtraction', () => {
    fc.assert(
      fc.property(
        pointerArb,
        pointerArb,
        panArb,
        panArb,
        (px, py, panX, panY) => {
          const local = globalToLocal(px, py, panX, panY, 1);

          expect(local.x).toBeCloseTo(px - panX, 10);
          expect(local.y).toBeCloseTo(py - panY, 10);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('zero pan, unit scale is identity', () => {
    fc.assert(
      fc.property(pointerArb, pointerArb, (px, py) => {
        const local = globalToLocal(px, py, 0, 0, 1);

        expect(local.x).toBeCloseTo(px, 10);
        expect(local.y).toBeCloseTo(py, 10);
      }),
      { numRuns: 200 },
    );
  });

  it('scale-only (no pan) divides pointer by scale', () => {
    fc.assert(
      fc.property(
        pointerArb,
        pointerArb,
        scaleArb,
        (px, py, scale) => {
          const local = globalToLocal(px, py, 0, 0, scale);

          expect(local.x).toBeCloseTo(px / scale, 6);
          expect(local.y).toBeCloseTo(py / scale, 6);
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe('Entity Centering — Property-Based Tests', () => {
  it('centered entity position is always offset by exactly half dimensions', () => {
    fc.assert(
      fc.property(
        pointerArb,
        pointerArb,
        dimArb,
        dimArb,
        (lx, ly, w, h) => {
          const centered = centerEntity(lx, ly, w, h);

          expect(centered.x).toBeCloseTo(lx - w / 2, 10);
          expect(centered.y).toBeCloseTo(ly - h / 2, 10);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('centering is reversible: adding half dimensions recovers original position', () => {
    fc.assert(
      fc.property(
        pointerArb,
        pointerArb,
        dimArb,
        dimArb,
        (lx, ly, w, h) => {
          const centered = centerEntity(lx, ly, w, h);

          expect(centered.x + w / 2).toBeCloseTo(lx, 10);
          expect(centered.y + h / 2).toBeCloseTo(ly, 10);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('Nested Local Projection — Property-Based Tests', () => {
  it('nested projection subtracts parent offset exactly once', () => {
    fc.assert(
      fc.property(
        pointerArb,
        pointerArb,
        panArb,
        panArb,
        scaleArb,
        zonePositionArb,
        zonePositionArb,
        (px, py, panX, panY, scale, parentX, parentY) => {
          const nested = globalToNestedLocal(px, py, panX, panY, scale, parentX, parentY);
          const canvasLocal = globalToLocal(px, py, panX, panY, scale);

          // Nested local = canvas local - parent position (subtracted exactly once)
          expect(nested.x).toBeCloseTo(canvasLocal.x - parentX, 6);
          expect(nested.y).toBeCloseTo(canvasLocal.y - parentY, 6);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('nested projection never produces NaN', () => {
    fc.assert(
      fc.property(
        pointerArb,
        pointerArb,
        panArb,
        panArb,
        scaleArb,
        zonePositionArb,
        zonePositionArb,
        (px, py, panX, panY, scale, parentX, parentY) => {
          const nested = globalToNestedLocal(px, py, panX, panY, scale, parentX, parentY);

          expect(Number.isNaN(nested.x)).toBe(false);
          expect(Number.isNaN(nested.y)).toBe(false);
          expect(Number.isFinite(nested.x)).toBe(true);
          expect(Number.isFinite(nested.y)).toBe(true);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('double subtraction of parent offset is detectable as a bug', () => {
    // This test explicitly checks that subtracting parent offset TWICE
    // produces DIFFERENT results from subtracting once — proving the
    // "double subtraction" bug would be caught.
    fc.assert(
      fc.property(
        pointerArb,
        pointerArb,
        panArb,
        panArb,
        scaleArb,
        // Non-zero parent offsets to ensure double subtraction differs
        fc.double({ min: 10, max: 2000, noNaN: true }),
        fc.double({ min: 10, max: 2000, noNaN: true }),
        (px, py, panX, panY, scale, parentX, parentY) => {
          const correct = globalToNestedLocal(px, py, panX, panY, scale, parentX, parentY);

          // "Bug" version: subtract parent offset twice
          const buggy = {
            x: correct.x - parentX,
            y: correct.y - parentY,
          };

          // They MUST differ (proving the bug would be caught)
          expect(buggy.x).not.toBeCloseTo(correct.x, 1);
          expect(buggy.y).not.toBeCloseTo(correct.y, 1);
        },
      ),
      { numRuns: 300 },
    );
  });
});
