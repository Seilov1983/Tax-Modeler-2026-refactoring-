# Architectural Briefing: Canvas Physics & Drag System

**Prepared for:** External Canvas/Physics Architect
**Date:** 2026-03-16
**Project:** Tax Modeler 2026
**Branch:** `claude/refactor-canvas-physics-drag-4n442`

---

## 1. What We Are Building

**Tax Modeler** is a desktop financial tool (Electron + Next.js) that visualizes international tax structures on an infinite 2D canvas. Users create a visual graph of:

- **Zones** (nested rectangles): represent jurisdictions. Two levels of hierarchy:
  - **Country** — a large zone (e.g. "Kazakhstan", 600×500px)
  - **Regime** — a smaller sub-zone inside a country (e.g. "AIFC", 320×250px)
- **Nodes** (cards): represent entities — companies, persons, tax agents. Placed inside zones.
- **Flows** (Bezier arrows): represent cash flows between nodes (dividends, royalties, services).
- **Ownership** (dashed lines): represent parent→subsidiary ownership chains.

The canvas is interactive: users drag zones, resize them, drag nodes, create flows/ownership via port dragging, zoom/pan the viewport, multi-select with lasso.

When the user places nodes inside zones and connects them with flows, the engine automatically computes WHT (withholding tax), CIT (corporate income tax), risk flags (CFC, substance breach, Pillar 2), and payroll taxes — all driven by a "Law-as-Code" master data configuration per jurisdiction.

### Scale

A typical project has 3–6 countries, 2–4 regimes per country, 10–30 nodes, 10–50 flows. The canvas itself is infinite (pan/zoom).

---

## 2. Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 15 (App Router, Turbopack) |
| UI | React 19, no UI library — everything hand-drawn via CSS |
| State | **Jotai** (atoms, splitAtom for per-entity isolation, atomFamily) |
| Rendering | Standard DOM elements with `position: absolute` + CSS `transform` |
| Physics | Custom (no library) — bounding box auto-resize + AABB collision |
| Layout | Dagre (for auto-layout only, not physics) |
| Desktop | Electron 41 |
| Testing | Vitest + Playwright |
| Language | TypeScript 5.9 |

**No Canvas 2D/WebGL** — all rendering is standard HTML/CSS DOM. Zones are `<div>` with `position: absolute; left/top`. Nodes use `transform: translate(x, y)`. Flows are SVG `<path>` elements.

---

## 3. Architecture Overview

```
src/
├── app/                    # Next.js App Router entry
├── entities/               # Base data atoms (splitAtom per entity)
│   ├── node/model/atoms    # nodesAtom, nodeAtomsAtom (splitAtom), nodeFamily
│   ├── zone/model/atoms    # zonesAtom, zoneAtomsAtom (splitAtom)
│   ├── flow/model/atoms    # flowsAtom, flowAtomsAtom (splitAtom)
│   └── ownership/model/    # ownershipAtom, ownershipAtomsAtom
├── features/
│   ├── canvas/
│   │   ├── ui/
│   │   │   ├── CanvasZone.tsx       # Zone rendering + drag + resize
│   │   │   ├── CanvasNode.tsx       # Node rendering + drag + port drag
│   │   │   └── useCanvasViewport.ts # Pan/zoom (imperative, ref-based)
│   │   └── model/
│   │       ├── graph-actions-atom.ts # All mutations + physics engine
│   │       ├── viewport-atom.ts     # Throttled viewport mirror for UI
│   │       └── draft-connection-atom.ts
│   ├── tax-calculator/     # WHT/CIT computation (async, yields main thread)
│   ├── risk-analyzer/      # Risk flag detection
│   └── entity-editor/      # Sidebar editor for selected entity
├── widgets/
│   └── canvas-board/
│       └── CanvasBoard.tsx  # Main canvas — layers, lasso, context menu, DnD
└── shared/
    ├── types/index.ts       # All domain interfaces
    └── lib/engine/
        ├── engine-core.ts   # Geometry: pointInZone, detectZoneId, nodeCenter
        └── utils.ts         # uid(), fmtMoney(), currencySymbol()
```

### Key Rendering Layers (z-index order in CanvasBoard)

1. **z=10** — Country zones (large, `w >= 400`)
2. **z=20** — Regime zones (small, `w < 400`)
3. **z=30** — Nodes
4. **z=40** — SVG arrows layer (flows, ownership, draft connections)

### State Architecture

- **projectAtom** — single source of truth for the entire project (JSON blob)
- **Entity atoms** — `nodesAtom`, `zonesAtom`, `flowsAtom`, `ownershipAtom` — derived from project, with `splitAtom` for per-entity re-render isolation
- **selectionAtom** — currently selected entity
- **viewportAtom** — throttled mirror of imperative viewport ref (for non-critical UI)

All mutations go through write-only action atoms (`addNodeAtom`, `moveNodesAtom`, `moveZoneAtom`, etc.) that batch-update entity atoms + projectAtom in a single Jotai transaction → one React re-render.

---

## 4. Current Drag Implementation (Transient/Committed Pattern)

The drag system uses a two-phase approach for 60 FPS performance:

### Phase 1: Transient Drag (onPointerMove)
- **No React re-renders** — DOM is mutated directly via `style.transform` (nodes) or `style.left/top` (zones)
- `isDraggingRef` flag shields the component from overwriting inline styles during any background re-render
- Viewport `scale` is read from a ref (not state)
- For zone drag: child zones and nodes are collected at drag start (`collectChildElements()`) and moved via DOM cascade

### Phase 2: Commit (onPointerUp)
1. Clear all inline style overrides
2. Commit final position to Jotai atoms (`moveZoneAtom` / `moveNodesAtom`)
3. Physics engine runs (auto-resize + collision resolution)
4. React re-renders once with correct state

### Coordinate System

```
Browser (clientX/Y)
  → Viewport space: subtract viewport rect offset
    → Canvas space: (x - panX) / scale, (y - panY) / scale
```

All drag deltas are computed as **absolute displacement from locked origin**: `totalDx = (clientX - startClientX) / scale`. This avoids floating-point drift from accumulating `movementX/Y`.

---

## 5. Current Physics Engine

Located in `graph-actions-atom.ts`. Runs ONLY on drop phase. Three steps:

### Step 1: `recalculateCountryBounds(zones)`
- For each zone, find smaller zones whose center is inside it → these are "children"
- Compute bounding box of all children
- **Grow** the parent to encompass children (with 40px padding)
- **Current behavior:** Never shrinks below current size (preserves manual resize)

### Step 2: `resolveCountryCollisions(zones)`
- Identify top-level zones (not children of any larger zone)
- Sort left-to-right by x
- For each adjacent pair: if AABB overlap → push right zone to `prev.x + prev.w + 40`
- Cascade child sub-zones by same shift amount
- Max 10 iterations

### Step 3: Node cascade (in `physicsAtom`)
- For each zone that moved, compute delta
- Shift all nodes inside that zone by the same delta

---

## 6. THE PROBLEMS (Why We Need You)

Despite multiple fix attempts, the following issues persist. The user reports:

### Problem A: Regimes overlap when added to a country

When the user adds multiple regimes to a country (via drag-and-drop from a master data panel), they stack on top of each other.

**Current mitigation:** We added staggering logic that places new regimes next to existing ones. But this only works for drag-and-drop; context menu creation uses click position. And the staggering doesn't account for the parent auto-growing.

### Problem B: Country collapses after manual resize

User flow:
1. Add a country (600×400)
2. Add 2 regimes inside (320×250 each)
3. Regimes overlap → user manually resizes country to 900×600 to spread them
4. User drags a regime to a new position inside the enlarged country
5. **On drop: `physicsAtom` runs → `recalculateCountryBounds` → country shrinks back** to tightly fit children

**Current mitigation:** We changed `recalculateCountryBounds` to only GROW, never shrink. But the fundamental issue remains: the physics auto-sizing fights the user's intent. If the user made the country 900×600, they want that size to stay.

### Problem C: Zones/regimes move on their own

When the user moves a country:
1. `moveZoneAtom` applies delta to the country + its child zones + child nodes
2. `physicsAtom` runs
3. `resolveCountryCollisions` detects overlap with another country
4. Pushes the other country right → cascades its child zones
5. User sees regimes "teleporting" or "sliding" without touching them

The collision resolution is too aggressive and unpredictable. Users don't understand why zones move.

### Problem D: The fundamental architecture question

We're not sure the current physics model is correct at all. The zone hierarchy is implicit (detected at runtime by spatial containment: "is zone B's center inside zone A?"). This means:
- Moving a regime outside its parent → it's no longer a child → parent might resize
- Overlapping two countries → ambiguous parent/child relationships
- The physics engine iterates over ALL zones O(n²) on every drop

**Should we have an explicit parent/child relationship instead?** E.g., `zone.parentId`? This would make the hierarchy stable regardless of spatial position.

---

## 7. Key Source Files to Review

| File | Lines | What It Contains |
|------|-------|-----------------|
| `src/features/canvas/ui/CanvasZone.tsx` | ~450 | Zone drag + resize + cascade + delete |
| `src/features/canvas/ui/CanvasNode.tsx` | ~360 | Node drag + multi-select + port drag |
| `src/features/canvas/ui/useCanvasViewport.ts` | ~270 | Pan/zoom (imperative ref, 0 re-renders) |
| `src/features/canvas/model/graph-actions-atom.ts` | ~695 | All mutations + physics (recalculate, collisions) |
| `src/widgets/canvas-board/CanvasBoard.tsx` | ~680 | Canvas layers, lasso, DnD, context menu |
| `src/shared/lib/engine/engine-core.ts` | ~300 | Geometry utils (pointInZone, detectZoneId) |
| `src/shared/types/index.ts` | ~410 | All domain interfaces (Zone, NodeDTO, etc.) |

---

## 8. Core Domain Types (Relevant)

```typescript
interface Zone {
  id: string;
  name: string;
  x: number; y: number; w: number; h: number;
  jurisdiction: JurisdictionCode;  // 'KZ' | 'UAE' | 'HK' | ...
  code: string;
  currency: CurrencyCode;
  zIndex: number;
  tax?: Partial<ZoneTaxOverride>;
  // NOTE: No parentId — hierarchy is spatial (implicit)
}

interface NodeDTO {
  id: string;
  name: string;
  type: 'company' | 'person' | 'txa';
  x: number; y: number; w: number; h: number;
  zoneId: string | null;  // auto-detected via spatial containment
  frozen: boolean;
  riskFlags: RiskFlag[];
  annualIncome: number;
  etr: number;
  // ... many tax-specific fields
}
```

---

## 9. What We Need From You

1. **Architectural review** of the drag lifecycle and physics pipeline — is the current transient/committed pattern sound, or should we switch to something else?

2. **Explicit vs implicit zone hierarchy** — should zones have a `parentId` field? What are the tradeoffs?

3. **Physics engine redesign** — the current auto-resize + collision resolution causes more problems than it solves. Should we:
   - Remove auto-resize entirely and let users control zone size?
   - Make physics opt-in (button) rather than automatic on every drop?
   - Use a constraint-based system instead of iterative collision resolution?

4. **Regime placement strategy** — how should new regimes be positioned inside a country? Grid snapping? Auto-layout? Flow-based?

5. **Coordinate system stability** — how to ensure drags never cause feedback loops, regardless of how many handlers/effects are chained?

---

## 10. How to Run the Project

```bash
npm install
npm run dev        # http://localhost:3000
npm run test       # Vitest unit tests
npm run typecheck  # TypeScript checking
```

The canvas is the main (and only) view. Double-click to create nodes, right-click for context menu, drag from Master Data panel to create zones.
