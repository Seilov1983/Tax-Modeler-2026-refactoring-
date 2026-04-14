# PROJECT PASSPORT: Tax Modeler 2026 (TSM26)

**Статус документа:** Основной архитектурный и продуктовый паспорт (Single Source of Truth)  
**Редакция:** April 2026  
**Целевая аудитория документа:** Стейкхолдеры, Инвесторы, Chief Architect, Lead Developers

---

## 1. Executive Summary & Value Proposition

**Tax Modeler 2026 (TSM26)** — это enterprise-grade SaaS "What-If" симулятор для визуального моделирования и оптимизации международных налоговых холдинговых структур. Продукт позволяет в реальном времени конструировать цепочки владения и финансовых потоков, автоматически рассчитывая налоговую нагрузку (CIT, WHT, Payroll) и оценивая комплаенс-риски на уровне юрисдикций и специальных экономических зон (СЭЗ).

### Target Audience
* **CFO / Финансовые директора:** Контроль глобальной эффективной налоговой ставки (Group ETR), планирование репатриации дивидендов и оптимизация капитальных потоков.
* **UBO (Ultimate Beneficial Owners):** Визуализация структуры владения активами и понимание влияния международных налоговых инициатив на личный доход.
* **Big4 Tax Consultants:** Использование TSM26 как профессионального инструмента для создания «корпоративных книг структур» (Corporate Structure Books) и автоматизации Law-as-Code экспертизы.

### User Expectations
* **Enterprise-grade reliability:** Высокая отказоустойчивость, предсказуемость поведения UI при высокой нагрузке (до 50+ зон и 200+ узлов на холсте без падения FPS).
* **Absolute math precision:** Финансовый детерминизм. Отсутствие проблем с плавающей запятой (использование `bankersRound2`), строгая транзакционная целостность при конвертации валют.
* **UI transparency (Evidence Trail):** Прозрачный аудит каждого расчета (Evidence Trail) с ссылками на законы (Law Refs). Пользователь всегда видит формулу, по которой рассчитан налог.
* **Data security (Zero Data Retention):** Возможность архитектуры работать без сохранения чувствительных данных в облаке. Graph Serialisation позволяет работать в Zero-Knowledge среде (State in localStorage / экспорт в локальные файлы).

---

## 2. Core Functionality

### Visual Canvas
Бесконечный drag-and-drop холст для проектирования структур. Поддерживает вложенность сущностей: Страна (Country) → СЭЗ (Regime, например, Astana Hub, AIFC) → Юридическое/Физическое Лицо (Company/Person Node). Координаты рассчитываются глобально (Stage space) для исключения багов с относительным позиционированием.

### Financial Ledger & Flows
Моделирование транзакций: Дивиденды, Роялти, Услуги, Проценты и Зарплаты (`Dividends`, `Royalties`, `Services`, `Interest`, `Salary`). Каждое движение средств автоматически провоцирует расчет Gross-up или Net Amount, а также удержание налогов у источника (WHT).

### Tax Engine (Law-as-Code)
Расчет налогов в реальном времени, отделенный от UI. Кодификация налогового права юрисдикций и СЭЗ в TypeScript:
* **CIT (Corporate Income Tax):** Поддержка сложных логик — плоская шкала (`flat`), многоуровневая (`twoTier`), пороговая (`threshold`), прогрессивная (`brackets`).
* **Regional Incentives:** Глубокая поддержка специфики. Например, Astana Hub (Nexus fraction для IP-доходов, 100% освобождение для non-IP), HK FSIE (Foreign Sourced Income Exemption).
* **WHT (Withholding Tax):** Расчет налогов у источника, включая Cyprus Defensive Measures (штрафные 17% для Low Tax Jurisdictions) и прогрессивную шкалу Казахстана для дивидендов.

### D-MACE Risk Engine
Автоматический детектор комплаенс-рисков, который сканирует граф в реальном времени:
* **CFC (Controlled Foreign Company):** Риск правил КИК.
* **Pillar Two (GloBE):** Контроль достижения выручки холдинга в 750M EUR и применения минимального налога в 15% (Top-up Tax).
* **Economic Substance Breach:** Проверка наличия штата сотрудников (`headcount`) и операционных расходов (`OPEX`) для сохранения льгот в СЭЗ.
* **Transfer Pricing:** Риск трансфертного ценообразования.

### AI Copilot
Генеративный AI ассистент, глубоко интегрированный в интерфейс. Он имеет доступ к полному состоянию (графу) проекта и может предлагать оптимизации, анализировать потоки, проверять DTT (Договоры об избежании двойного налогообложения), генерируя UI-компоненты (Generative UI) для ответа.

---

## 3. Basic User Journey (The Happy Path)

1. **Step 1: Onboarding & Setup**
   Пользователь создает новый проект, выбирает базовую валюту (Base Currency, например, EUR) для консолидации отчетности и задает макро-показатели холдинга (чтобы включить Pillar Two триггеры, если применимо).

2. **Step 2: Visual Drafting**
   Используя левую панель **Master Data Sidebar**, пользователь перетаскивает на холст зоны (Jurisdictions: Казахстан, Кипр, UAE) и помещает в них узлы компаний/лиц. Происходит мгновенный bind узлов к налоговым законам (Law-as-Code) конкретной зоны.

3. **Step 3: Configuring Flows & Substance**
   Пользователь соединяет компании стрелками, образуя связи владения (Ownership Edge) или транзакционные контракты (Flow Edge: выплата дивидендов, оплата услуг). На правой панели узла заполняются метрики Economic Substance (зарплаты, штат, R&D расходы для Nexus fraction).

4. **Step 4: AI Analysis & Tool Calling**
   Пользователь открывает AI Copilot и вызывает команду: *"Проанализируй структуру на предмет неэффективной репатриации капитала из Казахстана в UAE"*. AI (через Vercel AI SDK Tool Calling) читает стейт, анализирует WHT и предлагает добавить промежуточный холдинг, генерируя интерфейс для применения совета одним кликом.

5. **Step 5: Export & Reporting**
   Генерация "Corporate Structure Book". Платформа создает криптографически подписанный (через `crypto.subtle` SHA-256) PDF/Markdown документ со снимком Audit Snapshot, где в виде таблиц приведены все Entity Tax Schedules, Flow Ledgers и **Evidence Trails** (детальный расчет `calculationBreakdown` с формулами и Law Refs).

---

## 4. System Architecture & Tech Stack

### Methodology
Архитектура приложения модульная и строго следует методологии **Feature-Sliced Design (FSD)**, интегрированной внутрь `src/` папки **Next.js 15 App Router**. Нет монорепо-зависимостей, только один build artifact.

### UI & Layout
* **React 19** + **Tailwind CSS 4**.
* **Дизайн-система:** "Apple Liquid Glass" — эффекты размытия (`backdrop-blur-xl bg-white/70 shadow-2xl`), консистентная Z-индексация, левитирующие панели.
* **Layout:** Концепция *Holy Grail Layout* со строго закрепленными панелями (docked panels) и изолированным скроллингом, предотвращающим системный bounce-эффект (overscroll-none).
* **Модальная парадигма:** Отсутствие in-line редактирования на холсте; все данные изменяются через модальные окна (EditorModal, FlowModal с вылетом через `@react-spring/web`).

### State Management
* **Jotai** как ядро управления состояниями. Используется паттерн write-only action atoms для мутаций (что обеспечивает надежный Undo/Redo) и `splitAtom` для оптимизации рендеринга больших массивов (изоляция).
* **Архитектурный инвариант:** Критическое разделение состояний на **Transient** (`useRef` — для 60FPS drag-and-drop) и **Committed** (Jotai atom State — только после окончания gesture/отжатия кнопки мыши).

### Canvas Physics
* **Движок:** HTML5 Canvas 2D через **Konva** (и `react-konva`).
* Разделение на **4 flat layers**. Логическая иерархия (`parentId`) никогда не используется для Конвы (Group). Координаты узлов и зон абсолютно глобальны (Stage space coords).
* **Matrix Inversion:** Матричная инверсия трансформаций Стейджа (pan/zoom) через `stage.getAbsoluteTransform().copy().invert()` для предельно точного расчета Drop-координат из браузерной в Canvas-систему координат при drag-and-drop.

### Mathematical Core
* Полностью Framework-Agnostic Vanilla JS `engine/` папка. Никакого React.
* **Precision:** `bankersRound2` для округления сумм к ближайшему четному, избегая JS float-math багов.
* **Validation:** Строгая парсинг-валидация через **Zod**.

### Agentic AI
* **Vercel AI SDK** интегрирован для потоковой передачи текста и интерфейсов (Streaming UI).
* Строгий strict tool-calling для прямого взаимодействия "агент-граф", чтобы AI не просто болтал, а читал и модифицировал State `Project` с помощью детерминированных функций.
* Conversational memory persistence для сохранения контекста диалога инвестора и системы.

---
*Документ автоматически сгенерирован и поддерживается Antigravity AI Agent. DO NOT EDIT MANUALLY WITHOUT CONSULTING ARCHITECTURE GUIDELINES.*
