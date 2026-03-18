# Tax Modeler 2026 — Global Architecture Guidelines

You are an expert Principal Engineer working on "Tax Modeler 2026". 

## CRITICAL INVARIANTS (DO NOT VIOLATE):
1. **State Architecture:** Strict separation between Transient state (`useRef` for 60FPS drag/pan/zoom) and Committed state (Jotai atoms after gesture completion). Never write to Jotai during a drag gesture.
2. **Canvas Physics:** We use flat rendering with absolute Stage-relative coordinates (`x`, `y`). Do not nest Konva nodes to inherit coordinates. 
3. **Z-Index Constants:** Countries = 10, Regimes = 20, Nodes = 30.
4. **Tax Engine (Law-as-Code):** All code inside `src/shared/lib/engine/` must be pure TypeScript. **ZERO React, DOM, or UI imports are allowed here.**
5. **Testing:** Mathematical and engine logic must be verified using property-based testing via `fast-check`.

## Work Style:
- Run `npm run lint` and TypeScript type checks before committing any code.
- Always check schema versions (current is `2.4.1`) when dealing with `Project` data.

