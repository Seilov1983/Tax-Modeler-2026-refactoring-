# ADR 001: Core Architecture & State Management (Tax-Modeler 2026)

## 1. Context and Goals
Продукт представляет собой визуальный редактор для мульти-юрисдикционного налогового моделирования. Требуется рендеринг сложных графов (60 FPS), реактивный пересчет тяжелой финансовой математики и интеграция Law-as-Code без блокировки UI.

## 2. Core Stack & Methodology
* **Framework:** Next.js 15 + React 19 + TypeScript.
* **Architecture:** Feature-Sliced Design (FSD). Строгая изоляция `entities`, `features`, `widgets`, `shared`.
* **State Management:** Jotai v2.

## 3. State Management & Canvas Rendering
* **Transient / Committed Pattern:** Для обеспечения 60 FPS при drag-and-drop, мутации координат узлов и отрисовка SVG-связей происходят в обход React-цикла (прямые DOM-мутации через `useRef`). Синхронизация с Jotai (`projectAtom`) происходит только в конце жеста (onPointerUp) единым батчем.
* **Dual-Atom Update:** Мутации графа (добавление, удаление) используют Action-атомы, которые синхронно обновляют базовый `projectAtom` (для расчетного ядра) и entity-атомы (для UI) в рамках одной транзакции.
* **Two-Tier Viewport:** Состояние камеры (Pan/Zoom) живет в `useRef` для навигации без задержек. Синхронизация с UI (Minimap) происходит через `requestAnimationFrame` и Jotai-атом.

## 4. Engine & Mathematics
* **Framework-Agnostic Core:** Расчетное ядро (`engine-tax`, `engine-risks`, `engine-accounting`) изолировано в `shared/lib/engine` и не зависит от React.
* **Banker's Rounding:** Все финансовые округления используют round-half-to-even.
* **Law-as-Code:** Налоговые ставки и правила извлечены в декларативный `zone-rules.json`.
* **Presentation Currency Pattern:** Ядро считает налоги в локальных/оригинальных валютах. Конвертация в базовую валюту проекта (Global FX) происходит на слое Derived Atoms перед рендером в UI.

## 5. Async Derived Pipelines
* **Task Yielding:** Для предотвращения блокировки главного потока тяжелыми циклами пересчета налогов и рисков используется паттерн асинхронного освобождения Event Loop (`await setTimeout(0)`).
* **Local Suspense:** Тяжелые UI-компоненты (бейджи налогов, дашборды) оборачиваются в изолированные `Suspense` границы для предотвращения каскадных ре-рендеров холста.

## 6. Graph Semantics & UX
* **Spatial Source of Truth:** Координаты узла на холсте (AABB коллизии с визуальными Зонами) автоматически определяют его юрисдикцию (`zoneId`).
* **Semantic Edges:** Разделение связей на Ownership (вертикальная иерархия, фиолетовый) и Cash Flows (горизонтальный граф, синий).
* **Cascading Deletes:** Удаление узла строго влечет за собой удаление всех связанных потоков и структур владения для защиты ядра от `NullReferenceException`.
* **Memento Pattern:** История изменений (Undo/Redo) инкапсулирована в Action-атомах и фиксирует снимки `ProjectState` только при подтвержденных мутациях (onDrop, onBlur).
* **Multi-Select & Bulk Ops:** Lasso-выделение (AABB) + Shift-click. Групповое перемещение через transient DOM-мутации с батч-коммитом через `moveNodesAtom`.
* **Internal Clipboard:** Copy/Paste/Duplicate клонирует подграфы с ремаппингом ID и сохранением только внутренних связей (оба конца внутри выделения).
* **Smart Auto-Layout:** Dagre.js (TB direction) для автоматического выравнивания иерархии владения. Ownership edges weight=2, flow edges weight=1.

## 7. Analytics & Observability
* **Global ETR Dashboard:** Async derived atom агрегирует `taxCalculationAtom` + `riskCalculationAtom` в executive metrics (ETR, Total Tax Burden, Risk Count).
* **Audit Log:** Все налоговые операции логируются с суммами в оригинальной и базовой валютах.

## 8. Quality Assurance
* **E2E Automation First:** Критические пути Canvas (создание, связи, удаление) защищены Playwright E2E тестами через `data-testid`.
* **Unit Tests:** 123 unit-теста покрывают расчетное ядро (engine-tax, engine-risks, engine-core, utils).
