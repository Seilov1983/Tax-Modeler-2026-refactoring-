# Tax Modeler 2026 — Project Constitution

You are the Senior Principal Engineer for "Tax Modeler 2026" (TSM26), an Enterprise-grade SaaS platform for international tax modeling, visual corporate structuring, and compliance analysis (Pillar 2, CFC, Substance).

## Architecture

- **Feature-Sliced Design (FSD) + Next.js App Router.** Layers: `app`, `pages`, `widgets`, `features`, `entities`, `shared`. No business logic in `page.tsx`.
- **Framework-Agnostic Tax Engine** (`src/shared/lib/engine/`): 100% pure TypeScript. ZERO React, DOM, or UI imports. Data flows from React → Jotai atoms → Engine. Tax laws via "Law-as-Code" declarative JSON Master Data.
- **Agentic AI & Security:** Hybrid AI (OpenAI/Claude server-side + Ollama local PII). All LLM calls route through `src/app/api/`. Strict JSON Structured Outputs for tool calls.

## CRITICAL INVARIANTS (DO NOT VIOLATE)

1. **State Architecture:** Transient state (`useRef` for 60 FPS drag/pan/zoom) vs Committed state (Jotai atoms on gesture end). NEVER write to Jotai during a drag gesture.
2. **Canvas Physics:** Flat rendering with absolute Stage-relative coordinates. Never nest Konva nodes to inherit coordinates.
3. **Z-Index Constants:** Countries = 10, Regimes = 20, Nodes = 30.
4. **Tax Engine Purity:** All code inside `src/shared/lib/engine/` must be pure TypeScript. ZERO React/DOM/UI imports.
5. **Financial Determinism:** `Math.round` is BANNED in engine and UI code. Use `bankersRound2` (round-half-to-even) from `src/shared/lib/engine/utils.ts` for all rounding.
6. **Number Formatting:** NEVER render raw financial numbers in the UI. ALL monetary amounts (gross, net, CIT, WHT, OPEX, income, etc.) MUST use `fmtMoney()` (thousands separators, 2dp). All rate/ETR display MUST use `fmtPercent()`. Both live in `src/shared/lib/engine/utils.ts`.
7. **Testing:** Engine logic verified via property-based testing (`fast-check`). Schema version is `2.4.1`.
8. **Audit Trail:** Immutable audit log uses SHA-256 hash chain (`prevHash` + `canonicalJson`) via Web Crypto API.

## UI/UX

- **Apple Liquid Glass** design system: `bg-white/40 backdrop-blur-md border border-white/50 shadow-xl` for modals/sidebars.
- **Dark Mode:** Tailwind `dark:` classes universally. No hardcoded hex in HTML elements.
- **i18n:** NO hardcoded strings. All text via `src/shared/lib/i18n.ts` dictionary.
- **Docking over Overlapping:** Floating panels must not obscure tabular data.

## Work Style

- Run `npx tsc --noEmit` and tests before committing.
- Always check schema version (`2.4.1`) when changing `Project`, `Node`, or `Flow` shapes.
- Approved stack: React 19, Next.js 15, Jotai, react-konva, react-hook-form, shadcn/ui, @react-spring/{web,konva}, Tailwind CSS 4. Rejected: tldraw, Recoil, Formik.
