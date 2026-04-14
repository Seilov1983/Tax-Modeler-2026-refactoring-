# PROJECT PASSPORT — Tax Modeler 2026 (TSM26)

> **Версия документа:** 1.0.0
> **Дата:** 14 апреля 2026 г.
> **Schema Version:** 2.6.0 | **Engine Version:** 0.11.0
> **Статус:** Production Alpha
> **Классификация:** Конфиденциально — для внутреннего использования и инвесторов

---

## Содержание

1. [Executive Summary и ценностное предложение](#1-executive-summary-и-ценностное-предложение)
2. [Основная функциональность](#2-основная-функциональность)
3. [Базовый пользовательский путь (Happy Path)](#3-базовый-пользовательский-путь-happy-path)
4. [Системная архитектура и технологический стек](#4-системная-архитектура-и-технологический-стек)

---

## 1. Executive Summary и ценностное предложение

### 1.1 Что такое Tax Modeler 2026?

**Tax Modeler 2026** (TSM26) — это enterprise-grade SaaS-платформа класса What-If Simulator для визуального моделирования международных налоговых структур. Платформа позволяет пользователю на бесконечном интерактивном холсте (Canvas) выстраивать цепочки юридических лиц, связывать их потоками платежей (Dividends, Royalties, Interest, Services) и в реальном времени наблюдать расчёт CIT, WHT, Effective Tax Rate и риск-флагов — без единой строчки в Excel и без обращения к внешнему консультанту.

Архитектурно продукт реализует подход **Law-as-Code**: все налоговые ставки, льготы, пороги и условия хранятся в декларативном JSON-конфиге (`zone-rules.json`), который может обновляться AI Legal Parser при изменении законодательства — без переписывания кода движка.

### 1.2 Целевая аудитория

| Сегмент | Потребность | Как TSM26 её закрывает |
|---------|------------|----------------------|
| **CFO / Финансовый директор** | Быстрая оценка налоговой нагрузки по группе компаний при смене юрисдикции или маршрута потоков | What-If сценарии на Canvas с мгновенным пересчётом Group ETR |
| **UBO / Бенефициарный владелец** | Прозрачность фискальных рисков: CFC, Pillar Two, Economic Substance | D-MACE Risk Engine с визуальными risk flags и ссылками на статьи закона |
| **Big4 Tax Consultant** | Генерация аудитируемого отчёта для клиента с Evidence Trail | Corporate Structure Book (PDF/Markdown) с SHA-256 Audit Seal |

### 1.3 Ожидания пользователя (Quality Attributes)

**Финансовый детерминизм.** Все денежные вычисления используют `bankersRound2` (round-half-to-even). Функция `Math.round` запрещена на уровне кодовой конституции проекта. Это гарантирует, что два запуска одних и тех же входных данных всегда дадут бит-в-бит идентичный результат — критическое требование для финансового ПО.

**Evidence Trail / Law-as-Code.** Каждая вычисленная ставка сопровождается полем `lawRef` с указанием конкретной статьи закона (например, `НК РК 2025 ст. 738-740 (Astana Hub, КИТ-парк)` или `OECD GloBE Model Rules (2021) Art. 2.1, 5.2`). Пользователь и аудитор всегда видят юридическое обоснование каждой цифры.

**UI-прозрачность.** Все денежные суммы отображаются через `fmtMoney()` (разделители тысяч, 2 десятичных знака), все ставки — через `fmtPercent()`. Прямой вывод необработанных чисел в интерфейс запрещён.

**Zero Data Retention.** Offline-first архитектура: данные хранятся в `localStorage` браузера. Облачная синхронизация (`/api/projects/sync`) опциональна и активируется только при наличии подключённой базы данных. При 503 от API система автоматически переходит в offline-режим без потери функциональности.

**Аудиторская неизменяемость.** Каждая запись Audit Log содержит SHA-256 хеш (`prevHash` + `canonicalJson`), формируя иммутабельную цепочку (Hash Chain) через Web Crypto API. Нарушение цепочки блокирует экспорт отчёта.

---

## 2. Основная функциональность

### 2.1 Visual Canvas — бесконечное визуальное моделирование

Canvas реализован на базе **Konva 2D Engine** (`react-konva`) и представляет собой бесконечное пространство с drag-and-drop для построения холдинговых структур.

**Ключевые возможности:**
- Перетаскивание зон (стран и режимов) из Master Data Sidebar на Canvas
- Размещение entity-узлов (Company, Person, TXA) внутри зон
- Визуальное соединение узлов потоками платежей и линиями владения (Ownership Edges)
- Zoom / Pan с инерцией; Minimap для навигации по крупным структурам
- Ghosting-режим: полупрозрачное наложение узлов при перетаскивании

**Слои рендеринга (Z-Index):**

| Слой | Z-Index | Содержимое |
|------|---------|-----------|
| Countries | 10 | Юрисдикции (KZ, UAE, HK, ...) |
| Regimes | 20 | Специальные режимы (Astana Hub, AIFC, UAE Free Zone, ...) |
| Nodes | 30 | Юридические лица и физические лица |

Пространственное содержание определяется через `getClientRect` bounding-box: узел принадлежит наименьшей по площади зоне, полностью его содержащей.

### 2.2 Financial Ledger и Flows — маршрутизация платежей

Каждый поток (Flow) между двумя узлами описывает реальный денежный перевод:

| Поле | Описание |
|------|---------|
| `flowType` | Dividends, Royalties, Interest, Services, Salary, Goods, Equipment |
| `grossAmount` | Валовая сумма платежа |
| `currency` | Валюта операции (KZT, USD, EUR, AED, HKD, SGD, GBP, SCR, CNY) |
| `whtRate` | Ставка WHT (%) — вычисляется движком или задаётся вручную |
| `applyDTT` | Применение Double Tax Treaty для снижения WHT |
| `nexusCategory` | Категория для Nexus Fraction (R&D outsourcing classification) |

Движок автоматически вычисляет:
- **Gross-up**: пересчёт суммы при изменении ставки WHT
- **Net Amount**: `Gross - WHT`
- **FX-конвертацию**: все суммы приводятся к `baseCurrency` проекта через таблицу курсов (`project.fx`)

### 2.3 Tax Engine (Law-as-Code) — вычислительное ядро

Налоговый движок (`src/shared/lib/engine/`) — это **framework-agnostic** pure TypeScript модуль, не имеющий зависимостей от React, DOM или любого UI-фреймворка. Данные поступают однонаправленно: React → Jotai Atoms → Engine.

**Поддерживаемые режимы CIT:**

| Режим | Юрисдикции | Описание |
|-------|-----------|---------|
| `flat` | KZ, BVI, CAY | Единая ставка |
| `threshold` | UAE | 0% до порога, ставка выше |
| `twoTier` | HK | Пониженная ставка на первые N, стандартная выше |
| `qfzp` | UAE Free Zone | Qualifying vs Non-Qualifying доход |
| `brackets` | SEY | Прогрессивная шкала |
| `smallProfits` | UK | Маргинальная ставка между порогами |

**Ключевые вычислительные функции:**

```
computeGroupTax(project)          → GroupTaxSummary (CIT + WHT по всей группе)
effectiveEtrForCompany(p, node)   → ETR компании (0–1) с учётом всех льгот
computeWht(p, flow)               → WHT по конкретному потоку с lawRef
computeAstanaHubCIT(income, node) → CIT для Astana Hub с Nexus Fraction
computeNexusFraction(params)      → K = min(1, (QE × 1.3) / OE) по OECD BEPS Action 5
computeProgressiveWHTDividends()  → Прогрессивный WHT по дивидендам (КЗ)
```

**Региональные специализации:**
- **Astana Hub**: Nexus Fraction K определяет долю дохода, облагаемого по 0%; оставшийся — по базовой ставке CIT. Формула: `K = min(1, (rUp + rOut1) × 1.3 / (rUp + rOut1 + rOut2 + rAcq))`
- **HK FSIE** (Foreign Sourced Income Exemption): пассивный доход из зарубежных источников (Dividends, Interest, Royalties) освобождён от CIT при наличии Economic Substance
- **AIFC**: 0% CIT при выполнении условий CIGA (Core Income Generating Activities), Substance и Separate Accounting. При нарушении — fallback на стандартную ставку (20%)
- **UAE QFZP**: бифуркация дохода на Qualifying (0%) и Non-Qualifying (9%)
- **Cyprus**: Defensive Measures против low-tax юрисдикций с temporal resolution

**Temporal Resolution.** Все ставки поддерживают временну́ю привязку (`validFrom` / `validTo`), что позволяет моделировать структуры на историческую и будущую дату.

### 2.4 D-MACE Risk Engine — автоматическое обнаружение рисков

D-MACE Risk Engine (`engine-risks.ts`) — система автоматической детекции налоговых рисков, работающая в реальном времени при каждом изменении структуры на Canvas.

**Детектируемые риски:**

| Тип риска | Описание | Пример Law Ref |
|-----------|---------|---------------|
| `CFC_RISK` | Контролируемая иностранная компания (КИК) | НК РК 2025 ст. 294, 297 |
| `SUBSTANCE_BREACH` | Нарушение Economic Substance | BVI Economic Substance Act 2018 ss.3-4 |
| `PILLAR2_LOW_ETR` | ETR ниже 15% (порог GloBE) | OECD GloBE Model Rules (2021) Art. 2.1, 5.2 |
| `PILLAR2_TOPUP_RISK` | Потенциальный Top-Up Tax | OECD GloBE Art. 5.2 |
| `AIFC_PRESENCE_BREACH` | Нарушение CIGA presence для AIFC | AIFC Tax Rules 2018, Rule 4.3 |
| `TRANSFER_PRICING_RISK` | Индикаторы трансфертного ценообразования | OECD TP Guidelines 2022 Ch.I §1.33-1.35 |
| `CASH_LIMIT_EXCEEDED` | Превышение лимита наличных расчётов | НК РК 2025 ст. 246 |
| `FSIE_SUBSTANCE` | Недостаточность Substance для HK FSIE | HK IRO DIPN No. 46, s.16(1) |
| `NON_DEDUCTIBLE_EXPENSE` | Невычитаемые расходы | НК РК 2025 ст. 264 |

Каждый Risk Flag содержит:
- `type` — категория риска
- `severity` — HIGH / MEDIUM / LOW
- `lawRef` — ссылка на конкретную статью закона
- `message` — человекочитаемое описание

Движок также вычисляет **транзитивное владение** (transitive ownership) от физического лица через цепочку компаний для определения контроля в рамках CFC-анализа, используя итерацию с фиксированной точкой (fixed-point iteration, 50 итераций).

### 2.5 AI Copilot — генеративный ассистент

AI Copilot («TaxBrain2026») — встроенный ассистент на базе LLM, специализированный исключительно на международном налоговом консалтинге.

**Архитектура:**
- **Backend**: Vercel AI SDK v6, Ollama (локальный LLM) или OpenAI-совместимый endpoint
- **Tool Calling**: строго типизированные Zod-схемы для трёх инструментов:
  - `get_canvas_structure` — извлечение текущей структуры с Canvas
  - `calculate_tax_flow` — расчёт WHT/CIT для заданного потока
  - `propose_structural_change` — генерация рекомендации (Generative UI)
- **Generative UI**: рекомендации AI отображаются как интерактивные ActionCard с кнопкой «Apply», позволяющей применить изменение к структуре одним кликом
- **Языковое правило**: Copilot отвечает строго на языке пользователя
- **Guard Rail**: отклоняет вопросы, не связанные с налоговым консалтингом

**10 типов структурных рекомендаций:**
`increase_opex`, `decrease_opex`, `reroute_flow`, `change_zone`, `add_entity`, `remove_entity`, `adjust_wht`, `apply_dtt`, `increase_substance`, `restructure`

---

## 3. Базовый пользовательский путь (Happy Path)

### Step 1: Onboarding и создание проекта

Пользователь открывает приложение. Система выполняет трёхуровневую гидратацию:
1. Попытка загрузки проекта с сервера (`/api/projects`)
2. Fallback на `localStorage` (offline-режим)
3. Fallback на демо-проект (`defaultProject()`)

При первом запуске загружается демо-структура с предзаполненными юрисдикциями, компаниями и потоками. Базовая валюта проекта (`baseCurrency`) задаётся при создании и используется для консолидации всех сумм.

### Step 2: Визуальное черчение структуры

Пользователь открывает **Master Data Sidebar** (левая панель) и перетаскивает на Canvas:
1. **Зоны-юрисдикции** (Countries): Kazakhstan, UAE, Hong Kong, Cyprus, Singapore, UK, US, BVI, Cayman, Seychelles
2. **Специальные режимы** (Regimes): Astana Hub, AIFC, UAE Free Zone, HK Offshore — вложенные в юрисдикцию-родителя
3. **Entity-узлы**: Company (голубая шапка), Person (зелёная шапка), TXA (серая шапка) — размещаются внутри зон

При перетаскивании узла в зону система автоматически определяет `zoneId` через spatial containment (bounding-box). Налоговые параметры зоны наследуются узлом через цепочку `Country → Regime → Zone Override`.

### Step 3: Настройка потоков и Substance

**Потоки.** Пользователь соединяет два узла, создавая Flow. В появившемся FlowModal задаёт:
- Тип платежа (Dividends, Royalties, Interest, Services, Goods, Equipment)
- Валовую сумму (`grossAmount`) и валюту
- Применение DTT (Double Tax Treaty)
- Nexus Category для IP-доходов (R&D outsourcing classification)

**Ownership.** Линии владения определяют долю контроля (%) для CFC-анализа. Cap Table в EditorModal поддерживает пропорциональное перераспределение долей.

**Compliance Controls.** В правой панели (NodePropertiesDrawer) пользователь настраивает:
- **Economic Substance** — переключатель `hasSubstance`
- **IP Income** — переключатель `isIPIncome` (активирует расчёт Nexus Fraction)
- **Separate Accounting** — переключатель `hasSeparateAccounting`
- **Substance Metrics** (при включённом `hasSubstance`): headcount, OPEX, payroll

Все изменения мгновенно фиксируются в Jotai-атомах с поддержкой Undo/Redo. Движок пересчитывает ETR, WHT и risk flags в реальном времени.

**Live Preview.** При включённых `isIPIncome` и `hasSubstance` для узлов в Astana Hub, в панели отображается живой расчёт Nexus Fraction K с процентом и пояснением.

### Step 4: AI-анализ и Tool Calling

Пользователь открывает **AI Copilot** (правая панель) и задаёт вопрос, например:

> «Проанализируй структуру и предложи оптимизацию ETR для группы»

AI Copilot выполняет цепочку:
1. Вызывает `get_canvas_structure` — получает текущее состояние Canvas
2. Анализирует ETR каждого узла, потоки, risk flags
3. Вызывает `propose_structural_change` — генерирует ActionCard с рекомендацией

Пользователь видит в чате интерактивную карточку:
- **Заголовок** рекомендации
- **Severity** (HIGH / MEDIUM / LOW) с цветовой индикацией
- **Описание** с обоснованием
- **Кнопка «Apply»** — одним кликом применяет изменение к структуре (увеличение OPEX, перемаршрутизация потока, смена зоны и т.д.)

### Step 5: Экспорт и отчётность

Пользователь переходит на вкладку **Reports** и генерирует **Corporate Structure Book** — консолидированный документ, содержащий:

- Полную схему холдинговой структуры
- CIT и WHT по каждому узлу и потоку с Evidence Trail
- Risk Flags с lawRef-ссылками на конкретные статьи законов
- Group ETR и консолидированную налоговую нагрузку
- **SHA-256 Audit Seal** — криптографическая подпись, подтверждающая целостность данных

Экспорт блокируется если `project.readOnly === true` (нарушение Hash Chain в Audit Log).

Дополнительно доступен визуальный дашборд **Global Summary Widget** с ключевыми метриками: Total CIT, Total WHT, Group ETR, количество активных рисков.

---

## 4. Системная архитектура и технологический стек

### 4.1 Методология: Feature-Sliced Design (FSD)

Проект организован по методологии **Feature-Sliced Design** внутри Next.js 15 App Router:

```
src/
├── app/              # Next.js App Router: page.tsx, layout.tsx, api/
├── widgets/          # Композиционный слой: CanvasBoard, ReportsBuilder
├── features/         # Бизнес-фичи: canvas, entity-editor, ai-copilot, export-report, ...
├── entities/         # Доменные сущности: project, report
├── shared/           # Утилиты, типы, движок, конфиги, hooks
│   ├── lib/engine/   # Tax Engine (pure TypeScript, ZERO React imports)
│   ├── config/       # zone-rules.json (Law-as-Code)
│   ├── types/        # TypeScript-типы доменной модели
│   └── hooks/        # Shared React hooks
└── components/ui/    # shadcn/ui примитивы (Dialog, Button, Input, Switch, ...)
```

**Правило:** никакой бизнес-логики в `page.tsx`. Страницы — это тонкие оболочки, делегирующие widgets и features.

### 4.2 UI и Layout

**Технологии:** React 19, Tailwind CSS 4, shadcn/ui

**Дизайн-система: Apple Liquid Glass**
```
backdrop-blur-xl bg-white/70 dark:bg-black/50 rounded-3xl
shadow-2xl border border-white/20
```

Все модальные окна, боковые панели и оверлеи используют эффект стекла с размытием фона. Полная поддержка Dark Mode через Tailwind `dark:` классы.

**Holy Grail Layout (строго докованные панели):**

```
┌──────────────────────────────────────────────────────────┐
│                     ProjectHeader                         │ ← flex-none
├──────────┬─────────────────────────┬──────────┬──────────┤
│ Master   │                         │ Node     │ AI       │
│ Data     │      Canvas / Reports   │ Props    │ Copilot  │
│ Sidebar  │      (flex-1)           │ Drawer   │ Chat     │
│ (left)   │                         │ (right)  │ (right)  │
├──────────┴─────────────────────────┴──────────┴──────────┤
```

Каждая панель имеет изолированный скроллинг:
- Фиксированный header
- Scrollable body (`flex-1 overflow-y-auto custom-scrollbar`)
- Фиксированный footer (для модалов)

Модалы ограничены `max-h-[85vh]` для предотвращения выхода контента за пределы viewport.

### 4.3 State Management: Jotai

**Критическое разделение: Transient vs Committed State**

| Тип состояния | Хранилище | Когда обновляется | Re-renders |
|--------------|-----------|-------------------|-----------|
| **Transient** | `useRef` | Каждый кадр (60 FPS) при drag/pan/zoom | 0 |
| **Committed** | Jotai Atom | При завершении жеста (pointerUp) | 1 |

Это ключевой паттерн для производительности Canvas. Во время жеста перетаскивания (drag gesture) запись в Jotai-атомы **запрещена**. Позиция узла обновляется через `useRef` + `batchDraw()`. Только при `pointerUp` позиция фиксируется в атом.

**Изоляция узлов:** `splitAtom` обеспечивает независимый атом для каждого узла. При изменении одного узла из 200 — один re-render, не 200.

**Action Atoms:** Все мутации проходят через write-only action atoms (`updateNodeAtom`, `deleteFlowAtom`, `commitHistoryAtom`), обеспечивая единую точку входа для Undo/Redo.

**Persistence:** `localStorage` с ключом `tsm26_onefile_project_v2`. Schema Version (`2.6.0`) проверяется при гидратации — minor-версии совместимы, major — нет.

### 4.4 Canvas Physics: Konva 2D Engine

**Плоский рендеринг.** Все координаты — абсолютные, Stage-relative. Konva-ноды **никогда** не вкладываются друг в друга для наследования координат. Зоны вложены логически (через `parentId`), но рендерятся на одном уровне.

**Matrix Inversion для Drag-and-Drop.** При перетаскивании элемента из DOM (sidebar) на Canvas, DOM-координаты мыши преобразуются в Canvas-координаты через инверсию матрицы трансформации Stage:

```
canvasPoint = stageTransform.invert(domPoint)
```

Это обеспечивает корректное позиционирование при любом уровне zoom и pan.

**4-слойная архитектура рендеринга:**

| Слой | Обновление | Содержимое |
|------|-----------|-----------|
| Layer 1 | Статический кеш | Grid / Background |
| Layer 2 | По изменению данных | Zones и Nodes |
| Layer 3 | По изменению данных | Flows и Ownership Edges |
| Layer 4 | 60 FPS | Transient UI (lasso, drag ghost, selection handles) |

### 4.5 Математическое ядро

**Изоляция от UI.** Весь код в `src/shared/lib/engine/` — pure TypeScript. Импорт React, DOM API или любой UI-библиотеки запрещён на архитектурном уровне.

**Банковское округление.** `bankersRound2` (round-half-to-even) — единственный допустимый метод округления. `Math.round` запрещён во всём проекте (engine + UI).

**Zod Validation.** Все входные данные от API и tool calls валидируются через строго типизированные Zod-схемы.

**Форматирование (Single Source of Truth):**

| Функция | Назначение | Пример |
|---------|-----------|--------|
| `fmtMoney(n)` | Денежные суммы | `1,234,567.89` |
| `fmtPercent(rate)` | Ставки (0–1 → %) | `20.45%` |
| `fmtInputDisplay(n)` | Ввод с группировкой | `1 234 567` |
| `bankersRound2(n)` | Округление | `2.5 → 2.00`, `3.5 → 4.00` |

**Property-Based Testing.** Налоговая математика верифицируется через `fast-check` — генерация случайных входных данных для проверки инвариантов (например, `ETR ∈ [0, 1]`, `WHT ≤ Gross`, `CIT ≥ 0`). На данный момент: **297 тестов, 14 test files, 100% pass rate**.

### 4.6 Agentic AI

**SDK:** Vercel AI SDK v6 с `streamText` и `convertToModelMessages`.

**LLM Backend:** Ollama (локальный on-premise LLM) через OpenAI-совместимый API (`127.0.0.1:11434/v1`). Модель: `tsm26-strategy-copilot`.

**Strict Tool Calling.** Три инструмента с Zod-валидацией параметров:

| Tool | Описание | Параметры |
|------|---------|----------|
| `get_canvas_structure` | Текущая структура Canvas | `projectId` |
| `calculate_tax_flow` | Расчёт WHT/CIT между зонами | `fromZoneId`, `toZoneId`, `flowType`, `amount`, `applyDtt` |
| `propose_structural_change` | Генерация ActionCard-рекомендации | `title`, `description`, `actionType`, `severity`, `targetNodeId?`, `params?` |

**Conversational Memory.** Контекст чата сохраняется между сообщениями через Vercel AI SDK state management. Canvas state передаётся как structured context в каждом запросе.

**Generative UI.** Tool results типа `propose_structural_change` рендерятся клиентом как интерактивные ActionCard-компоненты (не plain text), позволяя пользователю применить рекомендацию одним кликом.

---

## Приложение A: Технологический стек

| Категория | Технология | Версия |
|-----------|-----------|--------|
| Framework | Next.js (App Router) | 15.2.0 |
| UI | React | 19.0.0 |
| Language | TypeScript | 5.9.3 |
| Styling | Tailwind CSS | 4.2.1 |
| UI Kit | shadcn/ui | latest |
| State | Jotai | 2.12.0 |
| Canvas | React Konva / Konva | 19.2.3 / 10.2.1 |
| Forms | react-hook-form | latest |
| Validation | Zod | 4.3.6 |
| Animation | @react-spring/{web, konva} | latest |
| ORM | Prisma | 7.5.0 |
| AI SDK | Vercel AI SDK | 6.x |
| LLM | Ollama (local) | latest |
| Testing | Vitest + fast-check | 4.1.0 |
| E2E | Playwright | 1.58.2 |

**Отклонённые технологии:** tldraw, Recoil, Formik — запрещены кодовой конституцией (`CLAUDE.md`).

## Приложение B: Поддерживаемые юрисдикции

| Код | Страна | Валюта | Специальные режимы |
|-----|--------|--------|--------------------|
| KZ | Казахстан | KZT | Astana Hub, AIFC |
| UAE | ОАЭ | AED | Free Zone (QFZP) |
| HK | Гонконг | HKD | Offshore, FSIE |
| CY | Кипр | EUR | Defensive Measures |
| SG | Сингапур | SGD | — |
| UK | Великобритания | GBP | Small Profits |
| US | США (Delaware) | USD | — |
| BVI | Британские Виргинские о-ва | USD | Economic Substance Act |
| CAY | Кайманы | USD | Economic Substance Act |
| SEY | Сейшелы | SCR | — |

## Приложение C: Доменная модель (ключевые типы)

```
Project
├── zones: Zone[]              # Юрисдикции и режимы на Canvas
├── nodes: NodeDTO[]           # Компании, физлица, TXA
├── flows: FlowDTO[]           # Межузловые денежные потоки
├── ownership: OwnershipEdge[] # Линии владения (% контроля)
├── taxes: TaxEntry[]          # История налоговых расчётов
├── audit: AuditLog            # SHA-256 Hash Chain
├── masterData: MasterData     # Налоговые ставки по юрисдикциям
├── fx: FXConfig               # Курсы валют
└── shadowLinks: ShadowLink[]  # Management Layer (dual-track)
```

---

*Документ сгенерирован автоматически на основе анализа кодовой базы TSM26.*
*Schema Version: 2.6.0 | Engine Version: 0.11.0 | Дата: 2026-04-14*
