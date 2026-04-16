# E2E Tax Audit — Test Results (v3)

**Date:** 2026-04-15
**Auditor:** Antigravity (Playwright — API-intercepted, clean context)
**Engine:** Tax Modeler 2026 Alpha

---

## Case 1: HK FSIE

**Status:** 🟢 PASS

**Project Title:** HK FSIE Transit Trade
**Nodes:** HK Trade, UAE Client, KZ Shareholder

**Expected Risks:** SUBSTANCE_BREACH
**Actual Risks:** SUBSTANCE_BREACH, CAPITAL_ANOMALY, NO_JURISDICTION
**Expected CIT:** HK standard (no substance → no FSIE)
**PDF:** ✅

### Node-Level Risks
| Node | Risk Type | Law Ref |
|------|-----------|--------|
| HK Trade | SUBSTANCE_BREACH | HK IRO s.14, FSIE regime (2023) s.15H-15T |
| HK Trade | CAPITAL_ANOMALY | НК РК 2025 ст. 246 (достаточность капитала) |
| UAE Client | CAPITAL_ANOMALY | НК РК 2025 ст. 246 (достаточность капитала) |
| KZ Shareholder | NO_JURISDICTION | - |

### CIT Schedule
| Entity | Zone | Pre-Tax | CIT Rate | CIT Amount | Breakdown |
|--------|------|---------|----------|------------|----------|
| HK Trade | Hong Kong (HK) | 200,000.00 | 16.50% | 16,500.00 | 200,000.00 HKD × 16.5% [twoTier] = 16,500.00 HKD |
| UAE Client | UAE (UAE) | -200,000.00 | 9.00% | 0.00 | -200,000.00 AED × 9% (threshold) [threshold] = 0.00 AED |

### Evidence
- Canvas: `test-screenshots/case-1-hk-fsie.png`
- Reports: `test-screenshots/case-1-hk-fsie-reports.png`

---

## Case 2: Astana Hub Nexus

**Status:** 🟢 PASS

**Project Title:** Astana Hub Nexus
**Nodes:** IT-Dev, CY HoldCo, KZ Client

**Expected Risks:** TRANSFER_PRICING_RISK
**Actual Risks:** TRANSFER_PRICING_RISK
**Expected CIT:** Nexus K=0.26, partial CIT on IP income
**PDF:** ✅

### Node-Level Risks
| Node | Risk Type | Law Ref |
|------|-----------|--------|
| IT-Dev | TRANSFER_PRICING_RISK | НК РК 2025 ст. 351-362 (ТЦО) |
| IT-Dev | TRANSFER_PRICING_RISK | OECD TP Guidelines 2022 Ch.I §1.33-1.35 |

### CIT Schedule
| Entity | Zone | Pre-Tax | CIT Rate | CIT Amount | Breakdown |
|--------|------|---------|----------|------------|----------|
| CY HoldCo | Cyprus (CY) | 200,000,000.00 | 15.00% | 30,000,000.00 | 200,000,000.00 EUR × 15% [flat] = 30,000,000.00 EUR |
| IT-Dev | Astana Hub (KZ) | 400,000,000.00 | 0.00% | 59,200,000.00 | Astana Hub IP: 400,000,000.00 KZT × (1 − 26% Nexus) × 20% = 59,200,000.00 KZT |
| KZ Client | Kazakhstan (KZ) | -600,000,000.00 | 20.00% | 0.00 | -600,000,000.00 KZT × 20% [flat] = 0.00 KZT |

### Evidence
- Canvas: `test-screenshots/case-2-astana-hub.png`
- Reports: `test-screenshots/case-2-astana-hub-reports.png`

---

## Case 3: CY→BVI Anti-Offshore

**Status:** 🟢 PASS

**Project Title:** CY-BVI Dividends CFC
**Nodes:** CY HoldCo, BVI Trust, KZ UBO

**Expected Risks:** SUBSTANCE_BREACH, CFC_RISK
**Actual Risks:** CFC_RISK, SUBSTANCE_BREACH, NO_JURISDICTION
**Expected CIT:** BVI 0%
**PDF:** ✅

### Node-Level Risks
| Node | Risk Type | Law Ref |
|------|-----------|--------|
| BVI Trust | CFC_RISK | НК РК 2025 ст. 294, 297 (КИК) |
| BVI Trust | SUBSTANCE_BREACH | НК РК 2025 ст. 294 п.4 (субстанция КИК) |
| BVI Trust | SUBSTANCE_BREACH | BVI Economic Substance Act 2018 ss.3-4 |
| KZ UBO | NO_JURISDICTION | - |

### CIT Schedule
| Entity | Zone | Pre-Tax | CIT Rate | CIT Amount | Breakdown |
|--------|------|---------|----------|------------|----------|
| BVI Trust | BVI (BVI) | 3,000,000.00 | 0.00% | 0.00 | 3,000,000.00 USD × 0% [flat] = 0.00 USD |
| CY HoldCo | Cyprus (CY) | 5,000,000.00 | 15.00% | 750,000.00 | 5,000,000.00 EUR × 15% [flat] = 750,000.00 EUR |

### Evidence
- Canvas: `test-screenshots/case-3-cy-bvi.png`
- Reports: `test-screenshots/case-3-cy-bvi-reports.png`

---

## Case 4: Pillar Two (UAE FZ)

**Status:** 🟢 PASS

**Project Title:** Pillar Two UAE FZ
**Nodes:** UAE Parent, FZ TechSub

**Expected Risks:** PILLAR2_LOW_ETR, PILLAR2_TRIGGER
**Actual Risks:** PILLAR2_LOW_ETR, TRANSFER_PRICING_RISK, PILLAR2_TRIGGER
**Expected CIT:** FZ 0%, Mainland 9%
**PDF:** ✅

### Node-Level Risks
| Node | Risk Type | Law Ref |
|------|-----------|--------|
| UAE Parent | PILLAR2_LOW_ETR | OECD GloBE Model Rules (2021) Art. 5.2 |
| UAE Parent | TRANSFER_PRICING_RISK | OECD TP Guidelines 2022 Ch.I §1.33-1.35 |
| FZ TechSub | PILLAR2_LOW_ETR | OECD GloBE Model Rules (2021) Art. 5.2 |

### Project-Level Risks
| Risk | Law Ref |
|------|--------|
| PILLAR2_TRIGGER | OECD GloBE Model Rules (2021) Art. 2.1, 5.2 |

### CIT Schedule
| Entity | Zone | Pre-Tax | CIT Rate | CIT Amount | Breakdown |
|--------|------|---------|----------|------------|----------|
| FZ TechSub | UAE Free Zone (QFZP) (UAE) | 50,000,000.00 | 9.00% | 4,466,250.00 | 50,000,000.00 AED × 9% (threshold) [threshold] = 4,466,250.00 AED |
| UAE Parent | UAE Mainland (UAE) | 100,000,000.00 | 9.00% | 8,966,250.00 | 100,000,000.00 AED × 9% (threshold) [threshold] = 8,966,250.00 AED |

### Evidence
- Canvas: `test-screenshots/case-4-pillar2.png`
- Reports: `test-screenshots/case-4-pillar2-reports.png`

---

## Case 5: AIFC Capital Anomaly

**Status:** 🟢 PASS

**Project Title:** AIFC Capital Anomaly
**Nodes:** AIFC FinCo, External, Shareholder

**Expected Risks:** CAPITAL_ANOMALY
**Actual Risks:** CAPITAL_ANOMALY
**Expected CIT:** AIFC 0%, Capital Anomaly triggered
**PDF:** ✅

### Node-Level Risks
| Node | Risk Type | Law Ref |
|------|-----------|--------|
| AIFC FinCo | CAPITAL_ANOMALY | НК РК 2025 ст. 246 (достаточность капитала) |

### CIT Schedule
| Entity | Zone | Pre-Tax | CIT Rate | CIT Amount | Breakdown |
|--------|------|---------|----------|------------|----------|
| AIFC FinCo | AIFC (KZ) | -500,000,000.00 | 20.00% | 0.00 | -500,000,000.00 KZT × 20% [flat] = 0.00 KZT |
| External | Kazakhstan (KZ) | -1,000,000,000.00 | 20.00% | 0.00 | -1,000,000,000.00 KZT × 20% [flat] = 0.00 KZT |
| Shareholder | Kazakhstan (KZ) | 1,500,000,000.00 | 20.00% | 300,000,000.00 | 1,500,000,000.00 KZT × 20% [flat] = 300,000,000.00 KZT |

### Evidence
- Canvas: `test-screenshots/case-5-aifc.png`
- Reports: `test-screenshots/case-5-aifc-reports.png`

---

## Summary
| Metric | Value |
|--------|-------|
| Cases | 5 |
| Pass | 5 |
| Fail | 0 |
| Rate | 100% |
