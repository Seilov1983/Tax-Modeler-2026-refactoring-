/**
 * Property-based tests for buildComputationGraph().
 *
 * We use fast-check to generate random valid Project graphs with varied nesting
 * depths and edge counts, then assert structural and mathematical invariants that
 * must hold universally — not just for hand-picked examples.
 *
 * Invariants tested:
 *   P1  Adjacency lists are lossless — total edge count across all nodes equals
 *       the length of project.flows / project.ownership.
 *   P2  Every ComputationNode has a fully-resolved, finite effective CIT rate.
 *   P3  nodeMap.size === project.nodes.length  (no nodes lost or duplicated).
 *   P4  rootZones count equals the number of zones with no parentId.
 *   P5  All node IDs in the adjacency lists came from project.flows / ownership.
 *   P6  Effective CIT rate is always in [0, 1]  (a rate, not a percentage).
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  buildComputationGraph,
  SCHEMA_VERSION,
  ENGINE_VERSION,
  defaultMasterData,
  defaultCatalogs,
  defaultLawReferences,
} from '../engine-core';
import type {
  Project,
  Zone,
  NodeDTO,
  FlowDTO,
  OwnershipEdge,
  JurisdictionCode,
  CurrencyCode,
} from '@shared/types';

// ─── Static fixtures ─────────────────────────────────────────────────────────

const JURISDICTIONS: JurisdictionCode[] = [
  'KZ', 'UAE', 'HK', 'CY', 'SG', 'UK', 'US', 'BVI', 'CAY', 'SEY',
];

const CURRENCIES: CurrencyCode[] = [
  'KZT', 'AED', 'HKD', 'EUR', 'SGD', 'GBP', 'USD', 'SCR',
];

function makeBaseProject(overrides: Partial<Project> = {}): Project {
  return {
    schemaVersion: SCHEMA_VERSION,
    engineVersion: ENGINE_VERSION,
    projectId: 'prop-test',
    title: 'Property Test',
    userId: 'u1',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    readOnly: false,
    masterData: defaultMasterData(),
    fx: {
      fxDate: '2026-03-01',
      rateToUSD: { USD: 1, KZT: 500, EUR: 0.92, AED: 3.67, HKD: 7.8, GBP: 0.79, SGD: 1.35, SCR: 13.5 },
      source: 'test',
    },
    zones: [],
    nodes: [],
    ownership: [],
    catalogs: defaultCatalogs(),
    activeJurisdictions: [...JURISDICTIONS],
    ui: {
      canvasW: 4000, canvasH: 3000, editMode: 'select',
      gridSize: 10, snapToGrid: false,
      flowLegend: { show: true, mode: 'all', selectedTypes: [], showTaxes: true },
    },
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

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const jurisdictionArb = fc.constantFrom(...JURISDICTIONS);
const currencyArb     = fc.constantFrom(...CURRENCIES);

/** Build a list of country zones then a list of regime zones parented to them. */
const zoneListArb: fc.Arbitrary<Zone[]> = fc
  .integer({ min: 0, max: 6 })   // number of country zones
  .chain((nCountries) =>
    fc.integer({ min: 0, max: Math.max(0, nCountries * 3) }) // regime zones per country
      .chain((nRegimes) =>
        fc.tuple(
          // Country zones — no parentId, zIndex=10
          fc.array(
            fc.record({
              jurisdiction: jurisdictionArb,
              currency: currencyArb,
            }),
            { minLength: nCountries, maxLength: nCountries },
          ),
          // Regime count is just a scalar
          fc.constant(nRegimes),
        ).map(([countryDefs, regimeCount]) => {
          const zones: Zone[] = [];

          // Create country zones with deterministic ids
          countryDefs.forEach((def, i) => {
            zones.push({
              id: `cz_${i}`,
              name: `Country ${i}`,
              x: i * 900, y: 0, w: 800, h: 700,
              jurisdiction: def.jurisdiction,
              code: `${def.jurisdiction}_COUNTRY_${i}`,
              currency: def.currency,
              zIndex: 10,
              parentId: null,
            });
          });

          // Create regime zones parented to country zones
          for (let r = 0; r < regimeCount; r++) {
            const parentIdx = r % Math.max(1, countryDefs.length);
            const parent = zones[parentIdx];
            if (!parent) continue;
            zones.push({
              id: `rz_${r}`,
              name: `Regime ${r}`,
              x: parent.x + 50, y: parent.y + 100, w: 300, h: 250,
              jurisdiction: parent.jurisdiction,
              code: `${parent.jurisdiction}_REGIME_${r}`,
              currency: parent.currency,
              zIndex: 20,
              parentId: parent.id,
            });
          }

          return zones;
        }),
      ),
  );

/** Build a list of nodes, each optionally placed in one of the zones. */
function nodeListArb(zones: Zone[]): fc.Arbitrary<NodeDTO[]> {
  const zoneIdOrNull: fc.Arbitrary<string | null> =
    zones.length > 0
      ? fc.option(fc.constantFrom(...zones.map((z) => z.id)), { nil: null })
      : fc.constant(null);

  return fc.array(
    fc.record({
      zoneIdChoice: zoneIdOrNull,
      nodeIndex: fc.nat(999),
    }),
    { minLength: 0, maxLength: 15 },
  ).map((entries) =>
    entries.map(({ zoneIdChoice, nodeIndex }) => ({
      id: `n_${nodeIndex}_${Math.random().toString(16).slice(2)}`,
      name: `Node ${nodeIndex}`,
      type: 'company' as const,
      x: 0, y: 0, w: 190, h: 90,
      zoneId: zoneIdChoice,
      frozen: false,
      riskFlags: [],
      annualIncome: 0,
      etr: 0.2,
      balances: {},
    })),
  );
}

/** Build flow edges referencing node ids. */
function flowListArb(nodeIds: string[]): fc.Arbitrary<FlowDTO[]> {
  if (nodeIds.length === 0) return fc.constant([]);
  const nodeIdArb = fc.constantFrom(...nodeIds);
  return fc.array(
    fc.record({
      id:                   fc.nat(9999).map((n) => `f_${n}`),
      fromId:               nodeIdArb,
      toId:                 nodeIdArb,
      flowType:             fc.constantFrom('Dividends', 'Interest', 'Royalties', 'Services', 'Salary') as fc.Arbitrary<FlowDTO['flowType']>,
      currency:             currencyArb,
      grossAmount:          fc.float({ min: 0, max: 1_000_000, noNaN: true }),
      paymentMethod:        fc.constant('bank'),
      cashComponentAmount:  fc.constant(0),
      cashComponentCurrency: fc.constant('USD' as CurrencyCode),
      whtRate:              fc.float({ min: 0, max: 35, noNaN: true }),
      status:               fc.constant('pending'),
      flowDate:             fc.constant('2026-06-01T00:00:00Z'),
      ack:                  fc.constant({ ackStatus: 'not_required' as const, acknowledgedBy: null, acknowledgedAt: null, comment: '' }),
      taxAdjustments:       fc.constant([]),
      fxEvidence:           fc.constant(null),
    }),
    { minLength: 0, maxLength: 25 },
  );
}

/** Build ownership edges referencing node ids. */
function ownershipListArb(nodeIds: string[]): fc.Arbitrary<OwnershipEdge[]> {
  if (nodeIds.length === 0) return fc.constant([]);
  const nodeIdArb = fc.constantFrom(...nodeIds);
  return fc.array(
    fc.record({
      id:               fc.nat(9999).map((n) => `ow_${n}`),
      fromId:           nodeIdArb,
      toId:             nodeIdArb,
      percent:          fc.float({ min: 0, max: 100, noNaN: true }),
      manualAdjustment: fc.constant(0),
    }),
    { minLength: 0, maxLength: 20 },
  );
}

/** Master arbitrary: generates a complete Project with coherent internal references. */
const projectArb: fc.Arbitrary<Project> = zoneListArb.chain((zones) =>
  nodeListArb(zones).chain((nodes) => {
    const nodeIds = nodes.map((n) => n.id);
    return fc.tuple(flowListArb(nodeIds), ownershipListArb(nodeIds)).map(
      ([flows, ownership]) =>
        makeBaseProject({ zones, nodes, flows, ownership }),
    );
  }),
);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sumMapLengths<K, V>(m: Map<K, V[]>): number {
  let total = 0;
  for (const arr of m.values()) total += arr.length;
  return total;
}

// ─── Properties ──────────────────────────────────────────────────────────────

describe('buildComputationGraph — property-based tests', () => {

  // P1: Adjacency lists are lossless (no edges dropped or duplicated)
  it('P1 — flow adjacency lists contain exactly project.flows.length edges each direction', () => {
    fc.assert(
      fc.property(projectArb, (project) => {
        const graph = buildComputationGraph(project);
        const totalOut = sumMapLengths(graph.flows.outFlows);
        const totalIn  = sumMapLengths(graph.flows.inFlows);
        expect(totalOut).toBe(project.flows.length);
        expect(totalIn).toBe(project.flows.length);
      }),
      { numRuns: 200 },
    );
  });

  it('P1 — ownership adjacency lists contain exactly project.ownership.length edges each direction', () => {
    fc.assert(
      fc.property(projectArb, (project) => {
        const graph = buildComputationGraph(project);
        const totalOut = sumMapLengths(graph.ownership.outEdges);
        const totalIn  = sumMapLengths(graph.ownership.inEdges);
        expect(totalOut).toBe(project.ownership.length);
        expect(totalIn).toBe(project.ownership.length);
      }),
      { numRuns: 200 },
    );
  });

  // P2: Every node resolves a finite effective CIT rate
  it('P2 — every ComputationNode has a finite effective CIT rate (no undefined / NaN)', () => {
    fc.assert(
      fc.property(projectArb, (project) => {
        const graph = buildComputationGraph(project);
        for (const cn of graph.nodes) {
          const rate = cn.effectiveTax.citRateEffective;
          expect(rate).not.toBeUndefined();
          expect(Number.isFinite(rate)).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });

  // P6: Effective CIT rate is a fraction in [0, 1], not a percentage
  it('P6 — effective CIT rate is always in the range [0, 1]', () => {
    fc.assert(
      fc.property(projectArb, (project) => {
        const graph = buildComputationGraph(project);
        for (const cn of graph.nodes) {
          const rate = cn.effectiveTax.citRateEffective;
          expect(rate).toBeGreaterThanOrEqual(0);
          expect(rate).toBeLessThanOrEqual(1);
        }
      }),
      { numRuns: 200 },
    );
  });

  // P3: No nodes lost or duplicated
  it('P3 — nodeMap.size equals project.nodes.length', () => {
    fc.assert(
      fc.property(projectArb, (project) => {
        const graph = buildComputationGraph(project);
        // If node ids are unique the map size equals the array length.
        // If ids collide, the last write wins — but our generator produces unique ids.
        expect(graph.nodeMap.size).toBe(project.nodes.length);
        expect(graph.nodes.length).toBe(project.nodes.length);
      }),
      { numRuns: 200 },
    );
  });

  // P4: rootZones count equals zones with no parentId
  it('P4 — rootZones contains exactly the zones that have no parentId', () => {
    fc.assert(
      fc.property(projectArb, (project) => {
        const graph = buildComputationGraph(project);
        const expectedRootCount = project.zones.filter((z) => !z.parentId).length;
        expect(graph.rootZones.length).toBe(expectedRootCount);
      }),
      { numRuns: 200 },
    );
  });

  // P5: Every key in flow/ownership adjacency lists is a real node id
  //     (i.e. came from the input flows/ownership, not fabricated)
  it('P5 — adjacency list keys are drawn only from flow fromId/toId fields', () => {
    fc.assert(
      fc.property(projectArb, (project) => {
        const graph = buildComputationGraph(project);
        const flowFromIds = new Set(project.flows.map((f) => f.fromId));
        const flowToIds   = new Set(project.flows.map((f) => f.toId));
        for (const k of graph.flows.outFlows.keys()) {
          expect(flowFromIds.has(k)).toBe(true);
        }
        for (const k of graph.flows.inFlows.keys()) {
          expect(flowToIds.has(k)).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });

});

// ─── Deterministic unit tests for tax inheritance ────────────────────────────

describe('buildComputationGraph — deterministic inheritance tests', () => {

  it('node with no zone resolves CIT rate to 0', () => {
    const n: NodeDTO = {
      id: 'n1', name: 'Orphan', type: 'company',
      x: 0, y: 0, w: 190, h: 90,
      zoneId: null, frozen: false, riskFlags: [], annualIncome: 0, etr: 0, balances: {},
    };
    const project = makeBaseProject({ nodes: [n] });
    const graph = buildComputationGraph(project);
    const cn = graph.nodeMap.get('n1')!;
    expect(cn.effectiveTax.citRateEffective).toBe(0);
    expect(Number.isFinite(cn.effectiveTax.citRateEffective)).toBe(true);
  });

  it('node in a standalone KZ country zone inherits 20% CIT from masterData', () => {
    const zone: Zone = {
      id: 'z_kz', name: 'Kazakhstan', x: 0, y: 0, w: 800, h: 600,
      jurisdiction: 'KZ', code: 'KZ_MAIN', currency: 'KZT', zIndex: 10,
      parentId: null,
    };
    const node: NodeDTO = {
      id: 'n1', name: 'KZ Co', type: 'company',
      x: 100, y: 100, w: 190, h: 90,
      zoneId: 'z_kz', frozen: false, riskFlags: [], annualIncome: 0, etr: 0.2, balances: {},
    };
    const project = makeBaseProject({ zones: [zone], nodes: [node] });
    const graph = buildComputationGraph(project);
    const cn = graph.nodeMap.get('n1')!;
    // KZ masterData: citRateStandard = 0.20
    expect(cn.effectiveTax.citRateEffective).toBe(0.20);
    expect(cn.effectiveTax.wht.dividends).toBe(0.15);
  });

  it('regime zone.tax CIT override is inherited by nodes in that regime', () => {
    const countryZone: Zone = {
      id: 'z_country', name: 'KZ Country', x: 0, y: 0, w: 800, h: 600,
      jurisdiction: 'KZ', code: 'KZ_COUNTRY', currency: 'KZT', zIndex: 10,
      parentId: null,
    };
    // Regime with 0% CIT override (like AIFC)
    const regimeZone: Zone = {
      id: 'z_regime', name: 'AIFC Regime', x: 50, y: 100, w: 300, h: 250,
      jurisdiction: 'KZ', code: 'KZ_AIFC', currency: 'KZT', zIndex: 20,
      parentId: 'z_country',
      tax: { cit: { mode: 'flat', rate: 0 }, vatRate: 0, wht: { dividends: 0, interest: 0, royalties: 0, services: 0 }, payroll: {} },
    };
    const node: NodeDTO = {
      id: 'n1', name: 'AIFC Co', type: 'company',
      x: 60, y: 110, w: 190, h: 90,
      zoneId: 'z_regime', frozen: false, riskFlags: [], annualIncome: 0, etr: 0, balances: {},
    };
    const project = makeBaseProject({ zones: [countryZone, regimeZone], nodes: [node] });
    const graph = buildComputationGraph(project);
    const cn = graph.nodeMap.get('n1')!;
    // Regime override: 0% CIT
    expect(cn.effectiveTax.citRateEffective).toBe(0);
    expect(cn.effectiveTax.vatRate).toBe(0);
  });

  it('country zone.tax CIT override is inherited by regime and node', () => {
    // Country zone overrides CIT to 5%; no further regime override
    const countryZone: Zone = {
      id: 'z_country', name: 'Custom Country', x: 0, y: 0, w: 800, h: 600,
      jurisdiction: 'CY', code: 'CY_CUSTOM', currency: 'EUR', zIndex: 10,
      parentId: null,
      tax: { cit: { mode: 'flat', rate: 0.05 }, vatRate: 0.19, wht: { dividends: 0, interest: 0, royalties: 0.10, services: 0 }, payroll: {} },
    };
    const regimeZone: Zone = {
      id: 'z_regime', name: 'CY Regime', x: 50, y: 100, w: 300, h: 250,
      jurisdiction: 'CY', code: 'CY_STD', currency: 'EUR', zIndex: 20,
      parentId: 'z_country',
      // No tax override on regime itself
    };
    const node: NodeDTO = {
      id: 'n1', name: 'CY Co', type: 'company',
      x: 60, y: 110, w: 190, h: 90,
      zoneId: 'z_regime', frozen: false, riskFlags: [], annualIncome: 0, etr: 0, balances: {},
    };
    const project = makeBaseProject({ zones: [countryZone, regimeZone], nodes: [node] });
    const graph = buildComputationGraph(project);
    const cn = graph.nodeMap.get('n1')!;
    // Country override: 5% CIT propagates to node
    expect(cn.effectiveTax.citRateEffective).toBe(0.05);
  });

  it('regime zone.tax override takes precedence over country zone.tax override', () => {
    const countryZone: Zone = {
      id: 'z_country', name: 'KZ', x: 0, y: 0, w: 800, h: 600,
      jurisdiction: 'KZ', code: 'KZ_COUNTRY', currency: 'KZT', zIndex: 10,
      parentId: null,
      tax: { cit: { mode: 'flat', rate: 0.10 }, vatRate: 0.16, wht: { dividends: 0.15, interest: 0.10, royalties: 0.15, services: 0.20 }, payroll: {} },
    };
    const regimeZone: Zone = {
      id: 'z_regime', name: 'Special Zone', x: 50, y: 100, w: 300, h: 250,
      jurisdiction: 'KZ', code: 'KZ_SPECIAL', currency: 'KZT', zIndex: 20,
      parentId: 'z_country',
      tax: { cit: { mode: 'flat', rate: 0.02 }, vatRate: 0, wht: { dividends: 0, interest: 0, royalties: 0, services: 0 }, payroll: {} },
    };
    const node: NodeDTO = {
      id: 'n1', name: 'Special Co', type: 'company',
      x: 60, y: 110, w: 190, h: 90,
      zoneId: 'z_regime', frozen: false, riskFlags: [], annualIncome: 0, etr: 0, balances: {},
    };
    const project = makeBaseProject({ zones: [countryZone, regimeZone], nodes: [node] });
    const graph = buildComputationGraph(project);
    const cn = graph.nodeMap.get('n1')!;
    // Regime override (2%) wins over country override (10%)
    expect(cn.effectiveTax.citRateEffective).toBe(0.02);
    expect(cn.effectiveTax.vatRate).toBe(0);
    expect(cn.effectiveTax.wht.dividends).toBe(0);
  });

  it('adjacency list — outFlows entries equal inFlows entries for same flow', () => {
    const zone: Zone = {
      id: 'z1', name: 'Z1', x: 0, y: 0, w: 800, h: 600,
      jurisdiction: 'UAE', code: 'UAE_ML', currency: 'AED', zIndex: 10, parentId: null,
    };
    const nA: NodeDTO = { id: 'nA', name: 'A', type: 'company', x: 0, y: 0, w: 190, h: 90, zoneId: 'z1', frozen: false, riskFlags: [], annualIncome: 0, etr: 0, balances: {} };
    const nB: NodeDTO = { id: 'nB', name: 'B', type: 'company', x: 200, y: 0, w: 190, h: 90, zoneId: 'z1', frozen: false, riskFlags: [], annualIncome: 0, etr: 0, balances: {} };
    const flow: FlowDTO = {
      id: 'f1', fromId: 'nA', toId: 'nB', flowType: 'Dividends', currency: 'AED',
      grossAmount: 100_000, paymentMethod: 'bank', cashComponentAmount: 0,
      cashComponentCurrency: 'AED', whtRate: 0, status: 'pending',
      flowDate: '2026-06-01T00:00:00Z',
      ack: { ackStatus: 'not_required', acknowledgedBy: null, acknowledgedAt: null, comment: '' },
      taxAdjustments: [], fxEvidence: null,
    };
    const project = makeBaseProject({ zones: [zone], nodes: [nA, nB], flows: [flow] });
    const graph = buildComputationGraph(project);

    expect(graph.flows.outFlows.get('nA')).toHaveLength(1);
    expect(graph.flows.outFlows.get('nA')![0]).toBe(flow);
    expect(graph.flows.inFlows.get('nB')).toHaveLength(1);
    expect(graph.flows.inFlows.get('nB')![0]).toBe(flow);
    // nB has no outgoing flows
    expect(graph.flows.outFlows.get('nB')).toBeUndefined();
    // nA has no incoming flows
    expect(graph.flows.inFlows.get('nA')).toBeUndefined();
  });

  it('zone tree — regime is a child of its country zone', () => {
    const country: Zone = {
      id: 'z_c', name: 'Country', x: 0, y: 0, w: 800, h: 600,
      jurisdiction: 'SG', code: 'SG_COUNTRY', currency: 'SGD', zIndex: 10, parentId: null,
    };
    const regime: Zone = {
      id: 'z_r', name: 'Regime', x: 50, y: 100, w: 300, h: 250,
      jurisdiction: 'SG', code: 'SG_STD', currency: 'SGD', zIndex: 20, parentId: 'z_c',
    };
    const project = makeBaseProject({ zones: [country, regime] });
    const graph = buildComputationGraph(project);

    expect(graph.rootZones).toHaveLength(1);
    expect(graph.rootZones[0].zone.id).toBe('z_c');
    expect(graph.rootZones[0].children).toHaveLength(1);
    expect(graph.rootZones[0].children[0].zone.id).toBe('z_r');
  });

  it('empty project produces an empty but valid graph', () => {
    const project = makeBaseProject();
    const graph = buildComputationGraph(project);

    expect(graph.rootZones).toHaveLength(0);
    expect(graph.nodes).toHaveLength(0);
    expect(graph.nodeMap.size).toBe(0);
    expect(graph.flows.outFlows.size).toBe(0);
    expect(graph.flows.inFlows.size).toBe(0);
    expect(graph.ownership.outEdges.size).toBe(0);
    expect(graph.ownership.inEdges.size).toBe(0);
  });

});
