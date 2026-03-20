# Tax Modeler 2026 — Project State & Architecture Handover

> **Document Classification:** Senior Principal Engineer → Incoming Tech Lead
> **Date:** 2026-03-18
> **Codebase Revision:** `main` branch, post-PR #111 (commit `db8d2e1`)
> **Schema Version:** `2.4.1`

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Tech Stack & Repository Structure](#2-tech-stack--repository-structure)
3. [Canvas Physics & Math (CRITICAL — READ FIRST)](#3-canvas-physics--math-critical--read-first)
4. [UI/UX Design System — Apple Liquid Glass](#4-uiux-design-system--apple-liquid-glass)
5. [State Management Architecture](#5-state-management-architecture)
6. [Testing Strategy](#6-testing-strategy)
7. [Tax Engine — Law-as-Code](#7-tax-engine--law-as-code)
8. [Internationalisation (i18n)](#8-internationalisation-i18n)
9. [Database & Authentication](#9-database--authentication)
10. [Feature Directory Reference](#10-feature-directory-reference)
11. [Immediate Next Steps](#11-immediate-next-steps)
12. [Invariants — Do Not Violate](#12-invariants--do-not-violate)

---

## 1. Executive Summary

Tax Modeler 2026 is a **full-stack, browser + desktop (Electron) application** for modelling international tax structures on a visual canvas. It allows users to compose jurisdictions (Zones), legal entities (Nodes), and financial flows (Flows / Ownership edges) into a directed graph, then compute live tax obligations, withholding tax (WHT), CIT, payroll, and risk flags (CFC, Pillar 2, transfer pricing) from first principles, using declarative Master Data that encodes tax law directly as TypeScript.

**Current state of the project (March 2026):**

| Layer | Status |
|---|---|
| Canvas UI & interactions | **100% stable — feature-complete** |
| Apple Liquid Glass design system | **100% stable** |
| Jotai state architecture | **100% stable** |
| i18n (EN/RU) | Stable |
| Tax Engine (engine-core, engine-tax, engine-risks) | Alpha — functional, under expansion |
| Graph Serialisation (persistence) | Alpha — single-file localStorage, schema-versioned |
| Database / cloud sync | Scaffolded (Prisma schema), not wired to canvas |
| Graph export & reporting | Export actions scaffolded, full reporting pending |

The canvas is the primary interaction surface and its physics/coordinate model is the most complex, load-bearing part of the system. **Do not touch canvas math without re-reading Section 3 in full.**

---

## 2. Tech Stack & Repository Structure

### 2.1 Runtime & Framework Versions

| Dependency | Version | Role |
|---|---|---|
| **Next.js** | 15.2.0 | App Router, SSR/SSG, API routes |
| **React** | 19.0.0 | UI framework |
| **TypeScript** | 5.9.3 | Type safety across all layers |
| **Tailwind CSS** | 4.2.1 | Utility-first styling (`darkMode: 'class'`) |
| **Jotai** | 2.12.0 | Global state (atoms, `splitAtom`, `atomWithStorage`) |
| **jotai-effect** | 1.1.0 | Side-effect atoms |
| **jotai-family** | 1.0.1 | Dynamic keyed atom families |
| **React Konva** | 19.2.3 | Declarative React wrapper for Konva |
| **Konva** | 10.2.1 | HTML5 Canvas 2D engine |
| **@react-spring/web** | 10.0.3 | CSS/DOM spring animations |
| **@react-spring/konva** | 10.0.3 | Spring animations for canvas nodes |
| **Prisma** | 7.5.0 | ORM (TypeScript-only, Rust-free) |
| **@prisma/client** | 7.5.0 | Generated Prisma client |
| **Zod** | 4.3.6 | Runtime schema validation |
| **dagre** | 0.8.5 | Directed-graph auto-layout |
| **react-hook-form** | 7.71.2 | Form state |
| **next-auth** | 5.0.0-beta.30 | Authentication |
| **@auth/prisma-adapter** | 2.11.1 | NextAuth ↔ Prisma bridge |
| **Electron** | 41.0.2 | Desktop build target |
| **electron-builder** | 26.8.1 | Desktop packaging |
| **Vitest** | 4.1.0 | Unit test runner |
| **Playwright** | 1.58.2 | End-to-end browser testing |
| **fast-check** | 4.6.0 | Property-based generative testing |

### 2.2 Repository Structure

> **Important note for the incoming Tech Lead:** This is a **single unified Next.js 15 application** — not a Turborepo monorepo. There are no `apps/` or `packages/` workspace directories. All application code lives under `/src`. This was an intentional simplification: one build artifact, one deployment unit, zero cross-package versioning overhead. The architecture is instead modularised by Feature-Sliced Design conventions within `/src`.

```
/
├── src/
│   ├── app/                    # Next.js App Router (layout, page, API routes)
│   ├── widgets/                # Full-page composite widgets (CanvasBoard)
│   ├── features/               # Self-contained feature slices
│   │   ├── canvas/             # Canvas rendering, state, drag/drop
│   │   ├── master-data-sidebar/# Left sidebar: regime/country picker
│   │   ├── project-management/ # Header, undo/redo, export
│   │   ├── entity-editor/      # Node/Flow/Ownership edit modal
│   │   ├── audit-log/          # Audit event panel
│   │   ├── analytics-dashboard/# Global summary widget
│   │   ├── tax-calculator/     # Tax computation UI
│   │   ├── risk-analyzer/      # Risk flag computation
│   │   └── settings/           # Settings modal, preferences
│   ├── entities/               # Domain entity atoms (nodes, flows, zones, ownership)
│   └── shared/                 # Framework-agnostic utilities
│       ├── types/index.ts      # ALL domain types (Project, Zone, Node, Flow…)
│       └── lib/
│           ├── engine/         # Tax engine (pure TypeScript, no React)
│           └── i18n.ts         # Custom EN/RU dictionary
├── prisma/schema.prisma        # Database schema
├── tests/                      # Playwright E2E tests
├── vitest.config.ts
├── playwright.config.ts
├── package.json                # Single root package.json
└── CLAUDE.md                   # AI assistant constraints
```

**Total source files:** 93 TypeScript/TSX files across 9 feature modules + shared utilities.

### 2.3 Build Targets

| Target | Command | Notes |
|---|---|---|
| Web dev | `npm run dev` | Next.js HMR on port 3000 |
| Web prod | `npm run build` | Standard Next.js build |
| Desktop | `npm run electron` | Electron wraps the web build |
| Tests | `npm run test` / `npm run test:e2e` | Vitest / Playwright |

---

## 3. Canvas Physics & Math (CRITICAL — READ FIRST)

> This section must be read in full before touching any file in `src/widgets/canvas-board/`, `src/features/canvas/ui/`, or any canvas-related atom.

### 3.1 The Core Principle: Flat Rendering with Absolute Coordinates

Every element on the canvas — Zones (jurisdictions), Nodes (entities), Flows (Bezier curves), and Ownership lines — is positioned using **absolute coordinates relative to the Konva Stage origin**. There are no nested Konva `<Group>` elements that accumulate parent offsets.

**Why flat rendering?**

The naive approach of nesting child Zones inside parent Zones as Konva Groups creates a double-offset problem: the child's `x/y` coordinates are interpreted relative to the parent group's position, but the logical data model stores absolute coordinates. This creates a permanent divergence between visual position and stored position that compounds on every drag. Flat rendering eliminates this class of bugs entirely and keeps coordinate lookups O(1).

**The invariant:**
```
node.x, node.y    → absolute canvas coordinates (Stage space)
zone.x, zone.y    → absolute canvas coordinates (Stage space)
zone.parentId     → logical hierarchy only; zero effect on coordinates
```

### 3.2 Coordinate System

```
Stage (0,0) ──────────────────────────────► X
│
│   Zone A (x=100, y=150)
│   ┌─────────────────────┐
│   │                     │
│   │  Zone B (x=200, y=250)   ← stored as absolute, not relative to Zone A
│   │  ┌──────────┐       │
│   │  │          │       │
│   │  │  Node N  │       │
│   │  │(x=250,   │       │
│   │  │ y=300)   │       │
│   │  └──────────┘       │
│   └─────────────────────┘
▼
Y
```

`Zone B.parentId = "Zone A"` creates the tree, but `Zone B.x = 200, Zone B.y = 250` are Stage-absolute.

### 3.3 Spatial Validation via `getClientRect`

When a Node is dragged and dropped, the system must determine which Zone it now belongs to. This is done via **bounding-box containment** using Konva's `getClientRect`:

```typescript
// In CanvasNode.tsx — validateAndReparentNode()
const nodeRect = nodeGroup.getClientRect();  // { x, y, width, height } in Stage coords

for (const zone of allRegimes) {
  const zoneRect = zoneShape.getClientRect();
  const fullyContained =
    nodeRect.x >= zoneRect.x &&
    nodeRect.y >= zoneRect.y &&
    nodeRect.x + nodeRect.width  <= zoneRect.x + zoneRect.width &&
    nodeRect.y + nodeRect.height <= zoneRect.y + zoneRect.height;

  if (fullyContained) candidates.push(zone);
}

// Select the smallest (most-specific) containing regime
const newParent = candidates.sort((a, b) =>
  (a.w * a.h) - (b.w * b.h)
)[0];
```

`getClientRect` accounts for any current Stage pan/zoom transform, returning coordinates that are always directly comparable between any two canvas objects. This is the **only** correct method for spatial overlap testing in a Konva scene with viewport transforms.

### 3.4 Matrix Inversion for HTML5 Drag-and-Drop Spawning

When a user drags an entity from the **Master Data Left Sidebar** (a DOM element, outside the canvas) and drops it onto the Konva canvas, the browser provides coordinates in **screen/viewport space**. These must be converted to **Stage canvas space** before creating a new Zone or Node.

The conversion uses matrix inversion of the Stage's current composite transform:

```typescript
// In CanvasBoard.tsx — handleDrop()
const stage = stageRef.current;
const pointerScreenPosition = { x: event.clientX, y: event.clientY };

// The stage has an absolute transform encoding pan (x,y) and zoom (scaleX, scaleY).
// Inverting it maps any screen point back to Stage space.
const inverseTransform = stage
  .getAbsoluteTransform()
  .copy()
  .invert();

const canvasPosition = inverseTransform.point(pointerScreenPosition);
// canvasPosition.x, canvasPosition.y are now correct Stage coordinates
// safe to write directly into zone.x / node.x
```

**Why copy().invert() and not manual arithmetic?**

The Konva transform is a 2D affine matrix `[a, b, c, d, e, f]` encoding scale, rotation, and translation simultaneously. When the canvas has been both panned and zoomed, naive `(screenX - panX) / zoom` arithmetic only holds for the zero-rotation case. The matrix inverse is exact for all transform combinations and is O(1).

**This pattern is also used in:**
- `CanvasZone.tsx` — converting double-click screen position to canvas coords for spawning a child zone at the correct position.
- `CanvasBoard.tsx` — lasso selection rectangle: pointer `mousemove` events deliver screen coords; the inverse transform converts them to stage coords for hit-testing against node bounding boxes.

### 3.5 Four-Layer Rendering Architecture

The Konva Stage is split into four discrete `<Layer>` elements, each with a distinct update frequency:

| Layer | Contents | Update Frequency | Mechanism |
|---|---|---|---|
| **Layer 1** (static) | Grid background (0.8px dots, 24px spacing) | Once on mount | Konva cache, never repainted |
| **Layer 2** (committed) | Zones + Nodes | On data change (Jotai) | React reconciliation, `splitAtom` isolation |
| **Layer 3** (committed) | Flows + Ownership lines | On data change (Jotai) | React reconciliation |
| **Layer 4** (transient) | Draft connection line, lasso rect, Transformer | 60 FPS | `useRef` + `batchDraw()` — **zero React re-renders** |

Layer 4 is the key to the application's perceived performance. All user interactions (drag, pan, zoom, port hover, lasso) mutate `useRef` values and call `layer4Ref.current.batchDraw()` directly. React never sees these state changes. Only on `pointerup` / `dragend` is the final committed state written to Jotai atoms, triggering a single React reconciliation.

### 3.6 Z-Index Enforcement

Z-index is an explicit, enforced data property — not a CSS value:

| Entity Type | `zIndex` value |
|---|---|
| Country zones | `10` |
| Regime zones | `20` |
| Nodes | `30` |

Konva renders elements in array order; the zones array is sorted by `zIndex` before rendering to guarantee Countries are always beneath Regimes, which are always beneath Nodes.

**Spatial collision priority (detectZoneId):** While Z-indexes control visual rendering order, the `detectZoneId` collision algorithm MUST prioritize the zone with the **smallest physical area** when zones overlap. For example, dropping a node inside a Special Economic Zone (Regime, small area) that sits inside a Country (large area) must assign the node to the Regime, regardless of rendering order. The sort key is `zone.w * zone.h` ascending — smallest area wins.

### 3.7 60 FPS Performance Patterns

Three patterns work together to ensure the canvas never drops below 60 FPS even with 50+ zones and 200+ nodes:

1. **Transient state in `useRef`:** Drag position, pan offset, zoom level, pointer coordinates, and lasso start point are all stored in `useRef` during the interaction. No `useState` or Jotai write happens until the gesture completes.

2. **`splitAtom` node isolation:** `nodeAtomsAtom` (from `jotai/utils`) gives each node its own independent Jotai atom. Updating Node A's position does not cause Node B, C, or D to re-render.

3. **`requestAnimationFrame` viewport sync:** The viewport atom (`viewportAtom`) is updated at most once per animation frame during pan/zoom, preventing the React tree from reconciling faster than the display refresh rate.

### 3.8 Bulk Multi-Node Drag

When multiple nodes are selected and the user begins dragging one of them, all selected nodes move together:

```typescript
// CanvasNode.tsx — onDragStart
const selectedIds = get(selectionAtom).ids;
if (selectedIds.includes(node.id) && selectedIds.length > 1) {
  // Snapshot original positions of all selected siblings
  selectionRef.current.originalPositions = selectedIds.reduce((acc, id) => {
    acc[id] = { x: getNodeById(id).x, y: getNodeById(id).y };
    return acc;
  }, {});
}

// onDragMove — called for the dragged node; propagate delta to all siblings
const delta = { x: node.x - selectionRef.current.originalPositions[node.id].x,
                y: node.y - selectionRef.current.originalPositions[node.id].y };
selectedIds.forEach(id => {
  if (id !== node.id) {
    const orig = selectionRef.current.originalPositions[id];
    setNodePosition(id, { x: orig.x + delta.x, y: orig.y + delta.y });
  }
});
```

This is a `useRef`-only operation during the drag. The full position batch is committed to Jotai on `onDragEnd`.

### 3.9 Zone Resize: Scale-to-Width Pattern

Konva `<Transformer>` applies scale transforms, but the data model stores explicit `width` / `height` values, not scale factors. On transform end, scale is immediately collapsed back to 1:

```typescript
// CanvasZone.tsx — onTransformEnd
const node = zoneGroupRef.current;
const newWidth  = Math.round(zone.w * node.scaleX());
const newHeight = Math.round(zone.h * node.scaleY());

// Reset Konva scale to 1 — the logical size is now stored in zone.w/zone.h
node.scaleX(1);
node.scaleY(1);

set(moveZoneAtom, { id: zone.id, x: node.x(), y: node.y(), w: newWidth, h: newHeight });
```

**Why this matters:** If you ever read `zone.w` or `zone.h` after a resize and get the old value, it means the transform end handler did not fire. The scale is sitting on the Konva node and has not been collapsed. Always verify `node.scaleX() === 1` after a resize if something looks geometrically wrong.

---

## 4. UI/UX Design System — Apple Liquid Glass

### 4.1 Core Visual Language

The design language is "Apple Liquid Glass": translucent, blurred panels that appear to float above the canvas. Every modal, sidebar, context menu, and overlay panel uses this treatment.

**The canonical Tailwind class composition for any panel or modal:**
```
backdrop-blur-xl bg-white/70 dark:bg-black/50 rounded-3xl shadow-2xl border border-white/20
```

**Extended variant used in FlowModal:**
```
bg-white/72 dark:bg-black/50 shadow-2xl backdrop-blur-[40px] backdrop-saturate-[180%]
```

**Do not use:** plain `bg-white`, `bg-gray-100`, or any opaque background on floating UI elements. The visual illusion of depth depends on consistent translucency across the entire UI.

### 4.2 Colour System

**Jurisdiction Zone header colours:**

| Country | Background | Border |
|---|---|---|
| Kazakhstan (KZ) | `#fef3c7` (amber-100) | `#f59e0b` (amber-400) |
| UAE | `#dbeafe` (blue-100) | `#3b82f6` (blue-400) |
| Hong Kong (HK) | `#fce7f3` (pink-100) | `#ec4899` (pink-400) |
| Cyprus (CY) | `#d1fae5` (green-100) | `#10b981` (green-400) |
| Singapore (SG) | `#ede9fe` (violet-100) | `#8b5cf6` (violet-400) |
| UK | `#fee2e2` (red-100) | `#ef4444` (red-400) |
| US | `#e0e7ff` (indigo-100) | `#6366f1` (indigo-400) |
| BVI | `#ccfbf1` (teal-100) | `#14b8a6` (teal-400) |
| Cayman (CAY) | `#fef9c3` (yellow-100) | `#eab308` (yellow-400) |
| Seychelles (SEY) | `#f0fdfa` (cyan-50) | `#2dd4bf` (teal-400) |

**Node type border colours:**

| Type | Border | Header background |
|---|---|---|
| Company | `#007aff` (Apple blue) | `#f0f5ff` |
| Person | `#30d158` (Apple green) | `#f0fdf4` |
| TXA (tax advisor) | `#98989d` (Apple gray) | `#f5f5f7` |

**Interactive / semantic colours:**

| State | Colour | Usage |
|---|---|---|
| Selected | `#007aff` | Node border, Flow stroke |
| Valid drop target | `#34c759` (Apple green) | Zone glow + dashed border `[12, 4]` |
| Invalid drop / out-of-bounds | `#ff3b30` (Apple red) | Zone glow, 16–20px shadow blur |
| Flow line (default) | `#94a3b8` (slate-400) | Bezier curve stroke |
| Flow line (selected) | `#2563eb` (blue-600) | Bezier curve stroke |
| WHT badge | `#9a3412` text, `#fff7ed` bg | Withholding tax indicator |

### 4.3 Universal Modals Paradigm

All data entry in the application happens through **modal overlays** — there are no in-canvas editable form fields. The modal paradigm enforces a clean separation between the "map" (canvas) and "territory" (data entry):

| Modal | Trigger | Contents |
|---|---|---|
| `EditorModal` | Double-click any Node, Flow, or Ownership line | Full entity edit form |
| `FlowModal` | Double-click a Flow arrow or select + press E | Flow type, amounts, WHT rate, notes |
| `MasterDataModal` | Project header → "Master Data" button | Edit default CIT/WHT rates per jurisdiction |
| `EditRegimeModal` | Double-click a Zone / right-click → Edit | Regime name, tax overrides, notes |
| `SettingsModal` | Gear icon (bottom-right) | Theme, language, snap-to-grid |

**Modal animation** (`@react-spring/web`):
```typescript
const springProps = useSpring({
  from: { opacity: 0, transform: 'scale(0.95)' },
  to:   { opacity: 1, transform: 'scale(1.0)' },
  config: config.stiff,
});
// Applied to animated.div wrapping the modal panel
```

**Modal backdrop:** `fixed inset-0 bg-black/30 backdrop-blur-sm` — dims the canvas without fully obscuring it, maintaining spatial context.

### 4.4 Master Data Left Sidebar

The `MasterDataSidebar` is the primary zone/entity spawning surface. It contains:

- A searchable list of **Countries** and **Regimes** sourced from `defaultMasterData()` in `engine-core.ts`.
- A list of **Node templates** (Company, Person, TXA).
- Each item is **draggable** (HTML5 `draggable` attribute) for dropping onto the canvas.
- On drag-over the canvas, `dragOverFeedbackAtom` tracks the candidate drop zone and triggers the green/red visual feedback on `CanvasZone`.

**Sidebar open/close animation** (`@react-spring/web`):
```typescript
const slideIn = useSpring({
  transform: isOpen ? 'translateX(0%)' : 'translateX(-100%)',
  config: config.stiff,
});
```

The sidebar sits at `z-index: 50` in DOM layer — above the Konva canvas (`z-index: 0`) but below modals (`z-index: 100`).

### 4.5 Dark Mode

Dark mode is implemented via Tailwind's `darkMode: 'class'` strategy. The root `<html>` element receives the `dark` class when `settings.theme === 'dark'` (or when `theme === 'system'` and `prefers-color-scheme: dark` is active).

Key dark mode mappings:
```
bg-white/70  →  dark:bg-black/50
border-white/20  →  dark:border-white/10
text-gray-900  →  dark:text-gray-100
bg-gray-50  →  dark:bg-white/5
```

All Konva canvas elements use hardcoded hex colours (not Tailwind) and have separate dark-mode variants determined by reading `settings.theme` from Jotai and passed as props.

---

## 5. State Management Architecture

### 5.1 Jotai Atom Inventory

```
src/features/canvas/model/
├── project-atom.ts          projectAtom (root), fxConfigAtom, baseCurrencyAtom
├── viewport-atom.ts         viewportAtom  { x, y, scale }
├── settings-atom.ts         settingsAtom (atomWithStorage), settingsOpenAtom
├── draft-connection-atom.ts draftConnectionAtom, commitDraftConnectionAtom
├── context-menu-atom.ts     contextMenuAtom
├── graph-actions-atom.ts    addNodeAtom, addFlowAtom, addOwnershipAtom,
│                            deleteFlowAtom, moveNodesAtom, reparentNodeAtom,
│                            moveZoneAtom, addZoneAtom, deleteZoneAtom…
├── drag-over-feedback-atom.ts  dragOverFeedbackAtom
├── spawn-coordinates-atom.ts   spawnCoordinatesAtom
├── notification-atom.ts     notificationAtom, showNotificationAtom
├── hydrate-atom.ts          hydrateProjectAtom (write-only action)
└── clipboard-atoms.ts       clipboard copy/paste state

src/entities/
├── node/model/atoms.ts      nodesAtom, nodeAtomsAtom (splitAtom)
├── flow/model/atoms.ts      flowsAtom
├── ownership/model/atoms.ts ownershipAtom
└── zone/model/atoms.ts      zonesAtom

src/features/project-management/model/
└── history-atoms.ts         commitHistoryAtom, undoAtom, redoAtom

src/features/entity-editor/model/
└── atoms.ts                 selectionAtom, nodeEditingAtom
```

### 5.2 The Fundamental Pattern: Transient vs Committed State

This distinction is the most important architectural pattern in the application. Conflating the two will destroy canvas performance.

| Dimension | Transient (during gesture) | Committed (after gesture) |
|---|---|---|
| **Storage** | `useRef` on the component | Jotai atom |
| **React renders** | Zero | One (after gesture ends) |
| **Canvas repaint** | `batchDraw()` on Layer 4 | React reconciliation of Layers 2/3 |
| **Persistence** | Never — discarded on unmount | Yes (via localStorage or DB) |
| **Examples** | Drag position, pointer XY, lasso rect | Node position, zone size, flow data |

**The rule:** If a value changes more than once per second due to user input, it belongs in `useRef` during that interaction. It moves to Jotai only when the interaction completes (`pointerup`, `dragend`, `keyup`).

### 5.3 splitAtom — Node Isolation

```typescript
// entities/node/model/atoms.ts
import { splitAtom } from 'jotai/utils';

export const nodesAtom = atom<Node[]>([]);
export const nodeAtomsAtom = splitAtom(nodesAtom);
```

`splitAtom` creates a derived atom that exposes each array element as its own independent atom. In `CanvasNode.tsx`, each node subscribes only to its own atom:

```typescript
// CanvasNode.tsx
const [node, setNode] = useAtom(nodeAtom);  // nodeAtom is one element from nodeAtomsAtom
```

Updating Node A's position triggers only `CanvasNode` for Node A to re-render. With 200 nodes on the canvas, this is the difference between 1 re-render and 200 re-renders per drag event.

### 5.4 Action Atoms Pattern

Mutations are never performed directly via `setNodesAtom`. Every mutation goes through a **write-only action atom** in `graph-actions-atom.ts`. This enforces:

1. **History snapshot** before every mutation (enables undo/redo).
2. **Cross-entity consistency** — adding a Zone might also update the project's zone count; doing this in one action atom prevents partial updates.
3. **No component logic leakage** — canvas components only dispatch actions, they don't implement business rules.

```typescript
// graph-actions-atom.ts (simplified)
export const addNodeAtom = atom(null, (get, set, payload: AddNodePayload) => {
  // 1. Snapshot current state for undo
  set(commitHistoryAtom);
  // 2. Mutate (always returns new objects/arrays — never mutate in place)
  const current = get(nodesAtom);
  set(nodesAtom, [...current, createNode(payload)]);
  // 3. Update derived project state
  set(projectAtom, prev => ({ ...prev, updatedAt: Date.now() }));
});
```

### 5.5 History / Undo-Redo

The undo stack stores **full project state snapshots**. This is simple and correct; the project graph is small enough that snapshot cost is negligible.

```typescript
// history-atoms.ts (simplified)
const historyStack = atom<Project[]>([]);
const redoStack    = atom<Project[]>([]);

export const commitHistoryAtom = atom(null, (get, set) => {
  set(historyStack, prev => [...prev, get(projectAtom)]);
  set(redoStack, []);  // New action clears redo branch
});

export const undoAtom = atom(null, (get, set) => {
  const stack = get(historyStack);
  if (!stack.length) return;
  set(redoStack, prev => [get(projectAtom), ...prev]);
  set(projectAtom, stack[stack.length - 1]);
  set(historyStack, stack.slice(0, -1));
});
```

### 5.6 Persistence — Schema Versioning

The entire `Project` object is serialised to `localStorage` as JSON:

```typescript
const STORAGE_KEY = 'tsm26_onefile_project_v2';
const SCHEMA_VERSION = '2.4.1';  // defined in engine-core.ts

// On load (hydrateProjectAtom)
const raw = localStorage.getItem(STORAGE_KEY);
const parsed = JSON.parse(raw);
if (parsed.schemaVersion !== SCHEMA_VERSION) {
  // Schema changed — discard and load demo project to prevent broken state
  return createDemoProject();
}
```

**When bumping SCHEMA_VERSION:** Always update it when changing the shape of `Project`, `Zone`, `Node`, `Flow`, or `Ownership`. Old saves will be gracefully discarded rather than causing runtime errors.

---

## 6. Testing Strategy

### 6.1 Three-Layer Stack

```
Unit (Vitest)          Property-based (fast-check)       E2E (Playwright)
─────────────          ──────────────────────────         ──────────────────
Pure functions,        Tax math invariants,               Full browser flows,
atom mutations,        numeric edge cases,                canvas drag/drop,
graph algorithms       generative input fuzzing           node creation/editing
```

### 6.2 Vitest Unit Tests

**Config:** `vitest.config.ts` — `environment: 'node'`, `coverage: v8`

| Test file | What it covers |
|---|---|
| `canvas/model/__tests__/move-zone-atom.test.ts` | Zone movement cascading to child zones |
| `canvas/model/__tests__/reparent-node-atom.test.ts` | Node zone reparenting on drag-end |
| `canvas/model/__tests__/add-zone-atom.test.ts` | Zone creation, parentId assignment |
| `canvas/model/__tests__/canvas-events.test.ts` | Canvas pointer event interactions |
| `engine/__tests__/engine-core.test.ts` | Graph utilities, node/zone factories |
| `engine/__tests__/engine-tax.test.ts` | CIT, WHT, payroll calculations |
| `engine/__tests__/cascade-move.test.ts` | Cascading positional updates |
| `engine/__tests__/z-index-layering.test.ts` | Z-index enforcement rules |
| `engine/__tests__/utils.test.ts` | UID generation, deepMerge correctness |
| `shared/lib/__tests__/i18n.test.ts` | Translation completeness (EN/RU key parity) |

### 6.3 Property-Based Testing with fast-check

`fast-check` v4.6.0 is used for tax engine math. The core principle: for any valid `Project` graph, certain mathematical invariants must hold regardless of specific values.

```typescript
// Example property test (engine-tax.test.ts)
import fc from 'fast-check';

it('WHT is always between 0 and gross amount', () => {
  fc.assert(
    fc.property(
      fc.float({ min: 0, max: 1_000_000 }),  // gross amount
      fc.float({ min: 0, max: 0.35 }),         // WHT rate
      (gross, whtRate) => {
        const wht = computeWHT(gross, whtRate);
        return wht >= 0 && wht <= gross;
      }
    )
  );
});
```

Property tests are the appropriate mechanism for validating tax engine correctness because tax calculations have well-defined mathematical bounds that must hold universally, not just for hand-picked test cases.

### 6.4 Playwright E2E Tests

**Config:** `playwright.config.ts` — `baseURL: http://localhost:3000`, `projects: [chromium]`

```
tests/
├── e2e/
│   ├── canvas-interactions.spec.ts   # Pan, zoom, lasso select
│   └── node-editing.spec.ts          # Create node, open modal, edit, close
└── canvas-smoke.spec.ts              # Page loads, canvas renders
```

**Run E2E tests:** `npm run test:e2e` (auto-starts dev server via `webServer` config).

---

## 7. Tax Engine — Law-as-Code

### 7.1 Architecture

The tax engine is a **pure TypeScript module** with zero React dependencies, located in `src/shared/lib/engine/`. It can be run in Node.js, the browser, or a worker thread without modification.

```
engine/
├── engine-core.ts      Graph utilities + Master Data (law as data)
├── engine-tax.ts       CIT, WHT, payroll computation
├── engine-risks.ts     Risk flag detection
├── engine-accounting.ts  Ledger reconciliation
├── utils.ts            uid(), deepMerge()
└── index.ts            Public API
```

### 7.2 Master Data — The Declarative Tax Model

`engine-core.ts:defaultMasterData()` encodes the tax law of each supported jurisdiction as a TypeScript data structure. This is the "Law-as-Code" concept: tax rules are not buried in procedural logic, they are expressed as declarative configuration that can be audited, versioned, and diffed.

```typescript
// engine-core.ts (excerpt)
type MasterDataEntry = {
  countryCode: string;
  baseCurrency: string;
  macroConstants: {
    mciValue: number;       // Monthly Calculation Index (Kazakhstan)
    minWage: number;
    baseOfficialSalary: number;
  };
  thresholds: {
    vatRegistrationMci: number;
    cashLimitMci: number;
    frozenDebtMci: number;
    // ...
  };
  vatRateStandard: number;
  citRateStandard: number;
  cit: {
    mode: 'flat' | 'threshold' | 'twoTier' | 'brackets' | 'exemption';
    rate?: number;
    brackets?: Array<{ upTo: number; rate: number }>;
  };
  wht: {
    dividends: number;
    interest: number;
    royalties: number;
    services: number;
  };
  payroll: {
    pitRate: number;
    pensionRate: number;
    // ...
  };
  zoneRules: Record<string, ZoneRule>;  // Special Economic Zone overrides
};
```

**Zone-level tax overrides (`ZoneTaxOverride`):** Individual Zones can override the country defaults. A Regime inside a country can have its own CIT rate, WHT rates, or payroll rules:

```typescript
interface ZoneTaxOverride {
  vatRate?: number;
  cit?: CITConfig;
  wht?: WHTRates;
  payroll?: Partial<PayrollConfig>;
  notes?: string;
}

// Applied during calculation as: effectiveRate = zone.tax?.cit ?? country.cit
```

### 7.3 Risk Engine

`engine-risks.ts` evaluates the graph for structural tax risks:

| Risk flag | Trigger condition |
|---|---|
| `CFC_RISK` | Foreign entity > 25% owned by resident entity, without substance |
| `SUBSTANCE_BREACH` | Regime requires substance; entity has no employees |
| `AIFC_PRESENCE` | Entity in AIFC zone but not qualifying under AIFC rules |
| `PILLAR2_RISK` | Group revenue > EUR 750M threshold (Pillar Two GloBE) |
| `TRANSFER_PRICING` | Intra-group flow without documented arm's-length pricing |

Risks are surfaced as badges on `CanvasNode` and aggregated in `GlobalSummaryWidget`.

### 7.4 Schema Version

`SCHEMA_VERSION = '2.4.1'` — bump this whenever `Project`, `Zone`, `Node`, `Flow`, `Ownership`, or `MasterDataEntry` interfaces change shape.

---

## 8. Internationalisation (i18n)

**Implementation:** Custom minimal dictionary in `src/shared/lib/i18n.ts`. No external library (not `next-intl`, not `react-i18next`).

**Supported languages:** English (`en`) and Russian (`ru`).

```typescript
type Language = 'en' | 'ru';

// Global hook — available anywhere in the React tree
const { t, lang } = useTranslation();
t('company')  // → 'Company' | 'Компания'

// Localised master data names
localizedName('Kazakhstan', lang)  // → 'Kazakhstan' | 'Казахстан'

// Regime tooltips
localizedTooltip('KZ_AIFC', lang)  // → full description string
```

**Language persistence:** Stored in `settingsAtom` (`atomWithStorage` → localStorage key `'tax-modeler-settings'`).

**Adding new keys:** Add to both `en` and `ru` branches of the `dictionary` object in `i18n.ts`. The i18n unit test (`__tests__/i18n.test.ts`) verifies key parity between languages.

---

## 9. Database & Authentication

### 9.1 Prisma 7 — TypeScript-only ORM

**Provider:** PostgreSQL
**Schema:** `prisma/schema.prisma`
**Client output:** `/generated/prisma`
**Notable:** Prisma 7 uses a pure TypeScript query engine (no Rust binary). This simplifies Electron packaging significantly.

**Models:**

| Model | Purpose |
|---|---|
| `User` | Auth.js user record |
| `Account` | OAuth provider linkage |
| `Session` | Session token storage |
| `VerificationToken` | Email verification flow |
| `DictionaryCountry` | Jurisdiction master data (cloud-managed) |
| `DictionaryRegime` | Regime master data |
| `TaxFlowRule` | Per-regime WHT and CIT deductibility rules |

**Current status:** The Prisma schema and NextAuth routes are scaffolded and functional for authentication. **The database is not yet connected to the canvas graph.** Projects are currently persisted only to localStorage. The next major infrastructure task is wiring `projectAtom` to a cloud persistence layer using the Prisma models.

### 9.2 Authentication

`next-auth` v5 (beta) with `@auth/prisma-adapter`. Route handler at `app/api/auth/[...nextauth]/route.ts`. Environment variable: `AUTH_SECRET`, `DATABASE_URL`.

---

## 10. Feature Directory Reference

Quick-reference map for the incoming Tech Lead:

| "I need to change..." | "Look in..." |
|---|---|
| How nodes are rendered on canvas | `src/features/canvas/ui/CanvasNode.tsx` |
| How zones are rendered/resized | `src/features/canvas/ui/CanvasZone.tsx` |
| How flow arrows are drawn | `src/features/canvas/ui/CanvasFlow.tsx` |
| Pan/zoom, stage setup, drag-from-sidebar | `src/widgets/canvas-board/CanvasBoard.tsx` |
| Adding/deleting nodes, zones, flows | `src/features/canvas/model/graph-actions-atom.ts` |
| Tax calculations (CIT, WHT, payroll) | `src/shared/lib/engine/engine-tax.ts` |
| Risk flag logic | `src/shared/lib/engine/engine-risks.ts` |
| Jurisdiction master data (rates, thresholds) | `src/shared/lib/engine/engine-core.ts` |
| Node/Flow edit modal | `src/features/entity-editor/ui/EditorModal.tsx` |
| Flow detail modal | `src/features/canvas/ui/FlowModal.tsx` |
| Left sidebar (drag-to-spawn) | `src/features/master-data-sidebar/ui/MasterDataSidebar.tsx` |
| Settings (theme, language, snap) | `src/features/settings/ui/SettingsModal.tsx` |
| Undo/redo | `src/features/project-management/model/history-atoms.ts` |
| All domain TypeScript types | `src/shared/types/index.ts` |
| i18n translations | `src/shared/lib/i18n.ts` |
| Database schema | `prisma/schema.prisma` |

---

## 11. Immediate Next Steps

The canvas UI and all interaction patterns are **100% feature-complete and stable**. The design system is **fully implemented and stable**. The state architecture is **mature and well-tested**.

The two remaining major engineering tracks are:

### Track 1 — Graph Serialisation (Infrastructure)

**Goal:** Replace localStorage single-file persistence with a proper cloud persistence layer.

**Scope of work:**
1. Define a `projects` table in `prisma/schema.prisma` (userId, name, schemaVersion, graphJSON: JSON).
2. Create Next.js API routes: `POST /api/projects`, `GET /api/projects/:id`, `PUT /api/projects/:id`.
3. Update `hydrateProjectAtom` to fetch from API on mount (with localStorage as offline fallback).
4. Update all action atoms to debounce-flush to API on mutation.
5. Add project list view (create, open, delete projects).
6. Zod 4 schema validation at the API boundary (`z.object({ graph: ProjectSchema })`) — `ProjectSchema` to be derived from the existing TypeScript types in `shared/types/index.ts`.

**Key constraints:**
- The localStorage schema (`tsm26_onefile_project_v2`) must remain functional as the offline fallback. Do not remove it.
- **Append-Only (Event Sourcing) model:** The Postgres `projects` table MUST use an append-only storage pattern for committed graph states. `UPDATE` and `DELETE` on committed snapshots are strictly forbidden. Each save produces a new immutable row (version). This guarantees the cryptographic SHA-256 Audit Log chain is never compromised — any retrospective mutation would break the hash chain and invalidate the entire audit trail.

### Track 2 — Tax Engine Expansion (Law-as-Code)

**Goal:** Make the tax engine comprehensive enough to produce audit-grade tax computations for the modelled structures.

**Scope of work:**
1. **Manual DTT Toggle:** Do NOT hardcode treaty matrices. Add a `[✓] Apply DTT` checkbox in the Editor Drawer where the CFO manually overrides the default WHT rate. The system is a visual simulator, not a treaty database.
2. **Pillar Two Monitoring:** The system ONLY scans the group ETR. If ETR < 15%, trigger a `PILLAR2_RISK` flag via D-MACE. Zero carve-out or top-up tax math is allowed — this is a What-If simulator, not a GloBE compliance engine.
3. **CFC attribution calculation:** Compute the attributed income from CFCs back to the controlling entity using the applicable jurisdiction's CFC rules.
4. **Transfer pricing risk flags (READ-ONLY):** The Risk Engine may flag a flow with a yellow `TP_WARNING` badge when the stated rate deviates from arm's-length benchmarks, but it MUST NEVER automatically recalculate the tax base. The CFO's manually entered values are sovereign. The engine observes and warns — it does not mutate.
5. **Consolidated tax summary:** Add `computeGroupTax(project: Project): GroupTaxSummary` to `engine-tax.ts` — produces a per-entity and consolidated effective tax rate across the entire modelled structure.
6. **Property-based test expansion:** For each new calculation added, write corresponding `fast-check` property tests verifying mathematical invariants (non-negativity, rate bounds, conservation).

**Key constraint:** All new engine code must be in `src/shared/lib/engine/` with zero React imports. The engine must remain runnable in Node.js for server-side computation.

---

## 12. Invariants — Do Not Violate

These are hard constraints that have been established through careful design decisions. Violating them will cause bugs that are difficult to diagnose.

| # | Invariant | Why it exists |
|---|---|---|
| 1 | **Zone and Node coordinates are always absolute (Stage-relative), never parent-relative** | Flat rendering architecture; nesting breaks coordinate math |
| 2 | **Never mutate Jotai state directly; always return new objects/arrays** | Jotai uses reference equality for change detection |
| 3 | **Never write to Jotai during a drag gesture** | Performance — use `useRef` during gesture, commit on `dragend` |
| 4 | **Never use `getClientRect` for anything other than spatial validation** | It triggers a Konva layout pass; calling it in a render loop kills FPS |
| 5 | **`CanvasBoard.tsx`, `CanvasZone.tsx`, `CanvasNode.tsx` core math — do not modify without explicit instruction** | Physics logic is stable and well-tested; casual changes break spatial validation |
| 6 | **Z-index values: Countries = 10, Regimes = 20, Nodes = 30 — do not change** | Canvas layer ordering depends on these being fixed constants |
| 7 | **Always bump `SCHEMA_VERSION` when changing Project/Zone/Node/Flow/Ownership shape** | Prevents corrupt state from old localStorage saves crashing the app |
| 8 | **Tax engine code (`src/shared/lib/engine/`) must have zero React imports** | Engine runs server-side and in workers; React would break both |
| 9 | **Add i18n keys to both `en` and `ru` simultaneously** | The i18n unit test will fail if key parity is broken |
| 10 | **All canvas-side mutations go through action atoms in `graph-actions-atom.ts`** | Ensures history snapshot is always taken before mutation |

---

*Document authored by Senior Principal Engineer, Tax Modeler 2026.*
*For questions about canvas math, re-read Section 3 before reaching out.*
*For questions about the tax engine, read `engine-core.ts` in full — the data structures are the documentation.*
