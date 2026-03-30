# 1000-Run Deep Stress Test — Tax Engine Validation

**Generated:** 2026-03-28T13:58:53.313Z
**Total Runs:** 1000
**Passed:** 1000 | **Failed:** 0

## Summary by Case

| Case | Name | Runs | Errors | Avg CIT | Avg WHT | Avg ETR | Flags Triggered |
|---|---|---|---|---|---|---|---|
| 1 | Case 1: KZ → Astana Hub → HK FSIE → UAE/BVI → KZ UBO (CFO Sp | 100 | 0 | 9,570,844,089.92 | 179,730,000 | 2.16% | TRANSFER_PRICING_RISK, CFC_RISK, SUBSTANCE_BREACH |
| 2 | Case 2: Cyprus Defensive Measures — 17% Penalty WHT to LTJ | 100 | 0 | 45,715,462,571.64 | 39,982,540,000 | 21.79% | CFC_RISK, SUBSTANCE_BREACH |
| 3 | Case 3: UAE Tax Group Consolidation (QFZP + Mainland) | 100 | 0 | 11,317,021,628.33 | 112,590,000 | 9.19% | CFC_RISK, SUBSTANCE_BREACH, TRANSFER_PRICING_RISK |
| 4 | Case 4: AIFC Separate Accounting + Nexus Fraction (IP Income | 100 | 0 | 17,342,406,653.79 | 2,114,677,014.92 | 19.17% | TRANSFER_PRICING_RISK, AIFC_PRESENCE_BREACH |
| 5 | Case 5: Triple CFC Cascade (KZ → CY → BVI → CAY) | 100 | 0 | 75,439,720,575.84 | 38,527,860,000 | 8.07% | TRANSFER_PRICING_RISK, CFC_RISK, SUBSTANCE_BREACH |
| 6 | Case 6: Pillar Two Trigger (750M+ EUR, Low-ETR Entities) | 100 | 0 | 132,374,382,084.65 | 5,554,115,300.08 | 24.68% | TRANSFER_PRICING_RISK, PILLAR2_LOW_ETR, CFC_RISK, SUBSTANCE_BREACH, PILLAR2_TRIGGER |
| 7 | Case 7: Transfer Pricing Ring (90% Margin Shift) | 100 | 0 | 60,735,727,590.86 | 39,005,103,588.97 | 28.02% | TRANSFER_PRICING_RISK, CFC_RISK, SUBSTANCE_BREACH |
| 8 | Case 8: Seychelles CIT Brackets + BVI Interest Trap | 100 | 0 | 198,022,716.39 | 3,121,262,535.21 | 2.51% | CFC_RISK, SUBSTANCE_BREACH, TRANSFER_PRICING_RISK |
| 9 | Case 9: HK Onshore/Offshore Split + FSIE Logic | 100 | 0 | 9,958,926,467.57 | 3,137,019,295.77 | 21.77% | CFC_RISK, SUBSTANCE_BREACH, TRANSFER_PRICING_RISK |
| 10 | Case 10: Full Spectrum — 8 Jurisdictions, Max Complexity | 100 | 0 | 268,883,951,404.48 | 94,481,893,673.41 | 15.49% | TRANSFER_PRICING_RISK, CFC_RISK, SUBSTANCE_BREACH, PILLAR2_LOW_ETR, PILLAR2_TRIGGER |

## Detailed Base Case Results (Variant 0 — No Mutations)

### Case 1: KZ → Astana Hub → HK FSIE → UAE/BVI → KZ UBO (CFO Spec)

| Metric | Value |
|---|---|
| **Total CIT** | 9,496,563,015.7 KZT |
| **Total WHT** | 180,000,000 KZT |
| **Total Tax Burden** | 9,676,563,015.7 KZT |
| **Total Income** | 452,225,992,840.87 KZT |
| **Consolidated ETR** | 2.14% |
| **Error** | None |

**D-MACE Risk Flags:**

- IT-разработчик: TRANSFER_PRICING_RISK [KZ_LAW_ON_TP]
- Посредник в поставке: CFC_RISK [KZ_CFC_MVP]
- Посредник в поставке: SUBSTANCE_BREACH [KZ_CFC_SUBSTANCE]
- Траст: CFC_RISK [KZ_CFC_MVP]
- Траст: SUBSTANCE_BREACH [KZ_CFC_SUBSTANCE]

**Anomalies Detected:**

- CAPITAL_ANOMALY: Посредник в поставке — outflows 900,000,000 exceed net equity 720,000,000 (deficit 180,000,000)

### Case 2: Cyprus Defensive Measures — 17% Penalty WHT to LTJ

| Metric | Value |
|---|---|
| **Total CIT** | 45,160,000,000 KZT |
| **Total WHT** | 34,035,000,000 KZT |
| **Total Tax Burden** | 79,195,000,000 KZT |
| **Total Income** | 392,800,000,000 KZT |
| **Consolidated ETR** | 20.16% |
| **Error** | None |

**D-MACE Risk Flags:**

- BVI SPV: CFC_RISK [KZ_CFC_MVP]
- BVI SPV: SUBSTANCE_BREACH [KZ_CFC_SUBSTANCE]

### Case 3: UAE Tax Group Consolidation (QFZP + Mainland)

| Metric | Value |
|---|---|
| **Total CIT** | 11,512,193,460.49 KZT |
| **Total WHT** | 145,000,000 KZT |
| **Total Tax Burden** | 11,657,193,460.49 KZT |
| **Total Income** | 126,540,599,455.04 KZT |
| **Consolidated ETR** | 9.21% |
| **Error** | None |

**D-MACE Risk Flags:**

- UAE MainCo: CFC_RISK [KZ_CFC_MVP]
- UAE MainCo: SUBSTANCE_BREACH [KZ_CFC_SUBSTANCE]
- UAE FZ Sub: CFC_RISK [KZ_CFC_MVP]
- UAE FZ Sub: SUBSTANCE_BREACH [KZ_CFC_SUBSTANCE]
- KZ Source: TRANSFER_PRICING_RISK [KZ_LAW_ON_TP]
- KZ Source: TRANSFER_PRICING_RISK [KZ_LAW_ON_TP]

### Case 4: AIFC Separate Accounting + Nexus Fraction (IP Income)

| Metric | Value |
|---|---|
| **Total CIT** | 17,647,462,686.57 KZT |
| **Total WHT** | 2,604,626,865.67 KZT |
| **Total Tax Burden** | 20,252,089,552.24 KZT |
| **Total Income** | 103,685,074,626.87 KZT |
| **Consolidated ETR** | 19.53% |
| **Error** | None |

**D-MACE Risk Flags:**

- AIFC FinTech: TRANSFER_PRICING_RISK [KZ_LAW_ON_TP]

### Case 5: Triple CFC Cascade (KZ → CY → BVI → CAY)

| Metric | Value |
|---|---|
| **Total CIT** | 75,400,000,000 KZT |
| **Total WHT** | 25,110,000,000 KZT |
| **Total Tax Burden** | 100,510,000,000 KZT |
| **Total Income** | 1,422,000,000,000 KZT |
| **Consolidated ETR** | 7.07% |
| **Error** | None |

**D-MACE Risk Flags:**

- KZ Operating: TRANSFER_PRICING_RISK [KZ_LAW_ON_TP]
- CY Holding: TRANSFER_PRICING_RISK [KZ_LAW_ON_TP]
- BVI IP Co: CFC_RISK [KZ_CFC_MVP]
- BVI IP Co: SUBSTANCE_BREACH [KZ_CFC_SUBSTANCE]
- CAY Fund: CFC_RISK [KZ_CFC_MVP]
- CAY Fund: SUBSTANCE_BREACH [KZ_CFC_SUBSTANCE]

**Anomalies Detected:**

- CAPITAL_ANOMALY: BVI IP Co — outflows 700,000,000 exceed net equity 500,000,000 (deficit 200,000,000)
- CAPITAL_ANOMALY: CAY Fund — outflows 1,000,000,000 exceed net equity 700,000,000 (deficit 300,000,000)

### Case 6: Pillar Two Trigger (750M+ EUR, Low-ETR Entities)

| Metric | Value |
|---|---|
| **Total CIT** | 131,623,442,681.4 KZT |
| **Total WHT** | 1,657,746,478.87 KZT |
| **Total Tax Burden** | 133,281,189,160.27 KZT |
| **Total Income** | 557,171,056,256.99 KZT |
| **Consolidated ETR** | 23.92% |
| **Error** | None |

**D-MACE Risk Flags:**

- KZ Group HQ: TRANSFER_PRICING_RISK [KZ_LAW_ON_TP]
- HK Trading: PILLAR2_LOW_ETR [APP_G_G5_PILLAR2]
- HK Trading: TRANSFER_PRICING_RISK [KZ_LAW_ON_TP]
- UK Sub: CFC_RISK [KZ_CFC_MVP]
- UK Sub: SUBSTANCE_BREACH [KZ_CFC_SUBSTANCE]
- UK Sub: PILLAR2_LOW_ETR [APP_G_G5_PILLAR2]
- PROJECT: PILLAR2_TRIGGER [APP_G_G5_PILLAR2]

### Case 7: Transfer Pricing Ring (90% Margin Shift)

| Metric | Value |
|---|---|
| **Total CIT** | 60,307,317,637.16 KZT |
| **Total WHT** | 46,832,341,812.07 KZT |
| **Total Tax Burden** | 107,139,659,449.23 KZT |
| **Total Income** | 356,174,301,985.59 KZT |
| **Consolidated ETR** | 30.08% |
| **Error** | None |

**D-MACE Risk Flags:**

- KZ Producer: TRANSFER_PRICING_RISK [KZ_LAW_ON_TP]
- SG Trader: TRANSFER_PRICING_RISK [KZ_LAW_ON_TP]
- HK Distributor: CFC_RISK [KZ_CFC_MVP]
- HK Distributor: SUBSTANCE_BREACH [KZ_CFC_SUBSTANCE]
- HK Distributor: TRANSFER_PRICING_RISK [KZ_LAW_ON_TP]

**Anomalies Detected:**

- CAPITAL_ANOMALY: KZ Producer — outflows 1,000,000,000 exceed net equity 50,000,000 (deficit 950,000,000)

### Case 8: Seychelles CIT Brackets + BVI Interest Trap

| Metric | Value |
|---|---|
| **Total CIT** | 197,253,521.13 KZT |
| **Total WHT** | 100,000,000 KZT |
| **Total Tax Burden** | 297,253,521.13 KZT |
| **Total Income** | 138,961,971,830.99 KZT |
| **Consolidated ETR** | 0.21% |
| **Error** | None |

**D-MACE Risk Flags:**

- SEY TradeCo: CFC_RISK [KZ_CFC_MVP]
- SEY TradeCo: SUBSTANCE_BREACH [KZ_CFC_SUBSTANCE]
- KZ OpCo: TRANSFER_PRICING_RISK [KZ_LAW_ON_TP]
- BVI Lender: CFC_RISK [KZ_CFC_MVP]
- BVI Lender: SUBSTANCE_BREACH [KZ_CFC_SUBSTANCE]

### Case 9: HK Onshore/Offshore Split + FSIE Logic

| Metric | Value |
|---|---|
| **Total CIT** | 9,898,873,239.43 KZT |
| **Total WHT** | 145,000,000 KZT |
| **Total Tax Burden** | 10,043,873,239.43 KZT |
| **Total Income** | 59,898,847,631.25 KZT |
| **Consolidated ETR** | 16.77% |
| **Error** | None |

**D-MACE Risk Flags:**

- HK Offshore Co: CFC_RISK [KZ_CFC_MVP]
- HK Offshore Co: SUBSTANCE_BREACH [KZ_CFC_SUBSTANCE]
- KZ Revenue: TRANSFER_PRICING_RISK [KZ_LAW_ON_TP]
- KZ Revenue: TRANSFER_PRICING_RISK [KZ_LAW_ON_TP]
- CAY Shell: SUBSTANCE_BREACH [OFFSHORE_SUBSTANCE_CAY]

### Case 10: Full Spectrum — 8 Jurisdictions, Max Complexity

| Metric | Value |
|---|---|
| **Total CIT** | 266,616,051,735 KZT |
| **Total WHT** | 78,820,000,000 KZT |
| **Total Tax Burden** | 345,436,051,735 KZT |
| **Total Income** | 2,358,944,405,562.6 KZT |
| **Consolidated ETR** | 14.64% |
| **Error** | None |

**D-MACE Risk Flags:**

- KZ HQ: TRANSFER_PRICING_RISK [KZ_LAW_ON_TP]
- KZ HQ: TRANSFER_PRICING_RISK [KZ_LAW_ON_TP]
- UK Sub: CFC_RISK [KZ_CFC_MVP]
- UK Sub: SUBSTANCE_BREACH [KZ_CFC_SUBSTANCE]
- UK Sub: PILLAR2_LOW_ETR [APP_G_G5_PILLAR2]
- SG Ops: TRANSFER_PRICING_RISK [KZ_LAW_ON_TP]
- BVI IP: CFC_RISK [KZ_CFC_MVP]
- BVI IP: SUBSTANCE_BREACH [KZ_CFC_SUBSTANCE]
- BVI IP: PILLAR2_LOW_ETR [APP_G_G5_PILLAR2]
- BVI IP: TRANSFER_PRICING_RISK [KZ_LAW_ON_TP]
- HK Trade: CFC_RISK [KZ_CFC_MVP]
- HK Trade: SUBSTANCE_BREACH [KZ_CFC_SUBSTANCE]
- HK Trade: PILLAR2_LOW_ETR [APP_G_G5_PILLAR2]
- HK Trade: TRANSFER_PRICING_RISK [KZ_LAW_ON_TP]
- UAE FZ: CFC_RISK [KZ_CFC_MVP]
- UAE FZ: SUBSTANCE_BREACH [KZ_CFC_SUBSTANCE]
- UAE FZ: PILLAR2_LOW_ETR [APP_G_G5_PILLAR2]
- PROJECT: PILLAR2_TRIGGER [APP_G_G5_PILLAR2]

**Anomalies Detected:**

- CAPITAL_ANOMALY: KZ HQ — outflows 1,300,000,000 exceed net equity 200,000,000 (deficit 1,100,000,000)
- CAPITAL_ANOMALY: BVI IP — outflows 1,800,000,000 exceed net equity 600,000,000 (deficit 1,200,000,000)

## Case 1 — Deep Dive (CFO Specification)

### Expected Behaviors

| Check | Result |
|---|---|
| CFC_RISK triggered for KZ Citizen (N7 → BVI Траст) | YES |
| SUBSTANCE_BREACH for BVI Траст | YES |
| TRANSFER_PRICING_RISK for 95% margin shift (N2 → N3) | YES |
| Capital Anomaly: 850M distribution > 670M net equity at HK | DETECTED |
| WHT on KZ exit (F3: N3 → N4 at 20%) | Verified via WHT total |

## ETR Distribution Across 1,000 Runs

| ETR Bucket | Count | % of Total |
|---|---|---|
| 0% | 0 | 0.0% |
| 0–5% | 176 | 17.6% |
| 5–10% | 206 | 20.6% |
| 10–15% | 55 | 5.5% |
| 15–20% | 235 | 23.5% |
| 20–30% | 275 | 27.5% |
| 30%+ | 53 | 5.3% |

---

*Generated by Tax Modeler 2026 Stress Test Runner on 2026-03-28T13:58:53.313Z.*
