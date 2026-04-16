/**
 * E2E Tax Audit v3 — Intercept API to force localStorage project.
 * 
 * Root cause of v2 failure: app loads project from API /api/projects first.
 * Fix: intercept API calls to return empty array, forcing localStorage fallback.
 */
import { chromium } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = 'http://localhost:3000';
const STORAGE_KEY = 'tsm26_onefile_project_v2';
const SHOTS = join(__dirname, 'test-screenshots');
const REPORTS = join(__dirname, 'test-reports');
mkdirSync(SHOTS, { recursive: true });
mkdirSync(REPORTS, { recursive: true });

const uid = () => Math.random().toString(16).slice(2, 14);
const nowIso = () => new Date().toISOString();

function makeProject(title, zones, nodes, flows, ownership = [], extras = {}) {
  return {
    schemaVersion: '2.1.0', engineVersion: '2.1.0-alpha',
    projectId: 'e2e_' + uid(), title, userId: 'qa',
    createdAt: nowIso(), updatedAt: nowIso(), readOnly: false, baseCurrency: 'USD',
    masterData: {},
    fx: { fxDate: '2026-01-15', rateToUSD: { USD: 1, KZT: 500, HKD: 7.8, AED: 3.67, EUR: 0.92, GBP: 0.79, SGD: 1.34, CNY: 7.2 }, source: 'manual' },
    zones, nodes, ownership,
    catalogs: { jurisdictions: [], flowTypes: [], riskTypes: [] },
    activeJurisdictions: ['KZ', 'HK', 'UAE', 'CY', 'BVI'],
    ui: { canvasW: 1600, canvasH: 1000, editMode: 'nodes', gridSize: 10, snapToGrid: true, flowLegend: { show: true, mode: 'ALL', selectedTypes: [], showTaxes: true } },
    flows, taxes: [],
    audit: { entries: [], lastHash: 'GENESIS' },
    periods: { closedYears: [] },
    group: { consolidatedRevenueEur: null },
    accounting: { years: {} }, lawReferences: {}, snapshots: [],
    pipeline: { lastRunAt: null, lastRun: null, runs: [] },
    projectRiskFlags: [],
    ...extras,
  };
}
function z(id, name, x, y, w, h, jurisdiction, code, currency, zIndex = 1, parentId = null) {
  return { id, name, x, y, w, h, jurisdiction, code, currency, zIndex, parentId };
}
function nd(id, name, type, x, y, zoneId, ex = {}) {
  return { id, name, type, x, y, w: 190, h: 90, zoneId, frozen: false, riskFlags: [], annualIncome: 0, etr: 0,
    balances: {}, effectiveFrom: '2026-01-01', effectiveTo: null, industryTags: [],
    ledger: { balances: {}, digitalAssets: {}, retainedEarnings: 0, accumulatedLosses: 0, debtToTXA: 0 },
    complianceData: { substance: { employeesCount: 0, hasPhysicalOffice: false, cigaInZone: true }, aifc: { usesCITBenefit: false, cigaInZone: true }, bvi: { relevantActivity: false, employees: 0, office: false } },
    managementTags: [], ...ex };
}
function fl(id, fromId, toId, flowType, grossAmount, currency, ex = {}) {
  return { id, fromId, toId, flowType, grossAmount, currency, paymentMethod: 'bank',
    cashComponentAmount: 0, cashComponentCurrency: currency, whtRate: 0, status: 'completed',
    flowDate: '2026-01-15T12:00:00.000Z',
    ack: { ackStatus: 'not_required', acknowledgedBy: null, acknowledgedAt: null, comment: '' },
    taxAdjustments: [], fxEvidence: null, ...ex };
}
function own(id, from, to, pct) { return { id, fromId: from, toId: to, percent: pct, manualAdjustment: 0 }; }

// ═══ ALL 5 CASES ═══
const CASES = [
  // Case 1: HK FSIE
  { name: 'Case 1: HK FSIE', slug: 'case-1-hk-fsie',
    project: makeProject('HK FSIE Transit Trade',
      [ z('z_hk','Hong Kong',50,50,450,300,'HK','HK_ONSHORE','HKD'), z('z_uae','UAE',550,50,400,300,'UAE','UAE_MAINLAND','AED') ],
      [ nd('n_hk','HK Trade','company',100,120,'z_hk',{hasSubstance:false,annualIncome:200000}),
        nd('n_uae','UAE Client','company',600,120,'z_uae'),
        nd('n_kz','KZ Shareholder','person',300,400,null,{type:'person',citizenship:['KZ'],taxResidency:['KZ']}) ],
      [ fl('f1','n_uae','n_hk','Services',1000000,'USD',{isOffshoreSource:true}), fl('f2','n_hk','n_uae','Goods',800000,'USD') ],
      [ own('o1','n_kz','n_hk',100) ]),
    expected: { risks:['SUBSTANCE_BREACH'], cit:'HK standard (no substance → no FSIE)' } },

  // Case 2: Astana Hub Nexus
  { name: 'Case 2: Astana Hub Nexus', slug: 'case-2-astana-hub',
    project: makeProject('Astana Hub Nexus',
      [ z('z_kz','Kazakhstan',30,30,550,450,'KZ','KZ_STANDARD','KZT',1), z('z_hub','Astana Hub',50,60,300,200,'KZ','KZ_HUB','KZT',3,'z_kz'), z('z_cy','Cyprus',620,50,350,300,'CY','CY_STANDARD','EUR') ],
      [ nd('n_it','IT-Dev','company',80,90,'z_hub',{isIPIncome:true,hasSubstance:true,hasSeparateAccounting:true,
          nexusParams:{rUp:50000000,rOut1:0,rOut2:200000000,rAcq:0}, substanceMetrics:{headcount:25,operationalExpenses:30000000,payrollCosts:15000000}}),
        nd('n_cy','CY HoldCo','company',650,130,'z_cy'), nd('n_kzcl','KZ Client','company',300,320,'z_kz') ],
      [ fl('f1','n_kzcl','n_it','Services',100000000,'KZT'), fl('f2','n_kzcl','n_it','Royalties',500000000,'KZT'),
        fl('f3','n_it','n_cy','Services',200000000,'KZT') ],
      [ own('o2','n_cy','n_it',100) ]),
    expected: { risks:['TRANSFER_PRICING_RISK'], cit:'Nexus K=0.26, partial CIT on IP income' } },

  // Case 3: CY→BVI
  { name: 'Case 3: CY→BVI Anti-Offshore', slug: 'case-3-cy-bvi',
    project: makeProject('CY-BVI Dividends CFC',
      [ z('z_cy','Cyprus',50,50,400,300,'CY','CY_STANDARD','EUR'), z('z_bvi','BVI',500,50,400,300,'BVI','BVI_STANDARD','USD') ],
      [ nd('n_cy','CY HoldCo','company',100,140,'z_cy',{annualIncome:5000000}),
        nd('n_bvi','BVI Trust','company',550,140,'z_bvi',{hasSubstance:false,
          complianceData:{substance:{},aifc:{},bvi:{relevantActivity:true,employees:0,office:false}}}),
        nd('n_ubo','KZ UBO','person',300,400,null,{type:'person',citizenship:['KZ'],taxResidency:['KZ']}) ],
      [ fl('f1','n_cy','n_bvi','Dividends',3000000,'EUR') ],
      [ own('o3a','n_ubo','n_cy',100), own('o3b','n_ubo','n_bvi',100) ]),
    expected: { risks:['SUBSTANCE_BREACH','CFC_RISK'], cit:'BVI 0%' } },

  // Case 4: Pillar Two
  { name: 'Case 4: Pillar Two (UAE FZ)', slug: 'case-4-pillar2',
    project: makeProject('Pillar Two UAE FZ',
      [ z('z_uml','UAE Mainland',50,50,400,300,'UAE','UAE_MAINLAND','AED'), z('z_fz','UAE Free Zone (QFZP)',500,50,400,300,'UAE','UAE_FREEZONE_QFZP','AED') ],
      [ nd('n_par','UAE Parent','company',100,140,'z_uml',{annualIncome:100000000}),
        nd('n_fz','FZ TechSub','company',550,140,'z_fz',{annualIncome:50000000}) ],
      [ fl('f1','n_par','n_fz','Services',50000000,'AED') ],
      [ own('o4','n_par','n_fz',100) ],
      { group:{consolidatedRevenueEur:800000000}, isPillarTwoScope:true }),
    expected: { risks:['PILLAR2_LOW_ETR','PILLAR2_TRIGGER'], cit:'FZ 0%, Mainland 9%' } },

  // Case 5: AIFC Capital Anomaly
  { name: 'Case 5: AIFC Capital Anomaly', slug: 'case-5-aifc',
    project: makeProject('AIFC Capital Anomaly',
      [ z('z_kz5','Kazakhstan',30,30,550,450,'KZ','KZ_STANDARD','KZT',1), z('z_aifc','AIFC',50,60,300,200,'KZ','KZ_AIFC','KZT',2,'z_kz5') ],
      [ nd('n_aifc','AIFC FinCo','company',80,90,'z_aifc',{hasSubstance:true,
          complianceData:{substance:{employeesCount:5,hasPhysicalOffice:true,cigaInZone:true},aifc:{usesCITBenefit:true,cigaInZone:true},bvi:{}},
          substanceMetrics:{headcount:5,operationalExpenses:10000000,payrollCosts:5000000}}),
        nd('n_ext','External','company',400,250,'z_kz5'), nd('n_sh','Shareholder','company',300,400,null) ],
      [ fl('f1','n_ext','n_aifc','Services',1000000000,'KZT'), fl('f2','n_aifc','n_sh','Dividends',1500000000,'KZT') ]),
    expected: { risks:['CAPITAL_ANOMALY'], cit:'AIFC 0%, Capital Anomaly triggered' } },
];

// ═══ EXECUTION ═══
const results = [];
(async () => {
  const browser = await chromium.launch({ headless: true });

  for (const tc of CASES) {
    console.log(`\n${'═'.repeat(60)}\n▶ ${tc.name}\n${'═'.repeat(60)}`);

    const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    const page = await ctx.newPage();

    // ★ KEY FIX: Intercept API calls to prevent server project from overriding localStorage
    await page.route('**/api/projects**', route => {
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });

    // 1. Load app → will try API (intercepted → empty) → fall through to localStorage
    // First load to set up localStorage
    await page.goto(BASE, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(1000);

    // 2. Inject test project into localStorage
    await page.evaluate(({ key, proj }) => {
      localStorage.clear();
      localStorage.removeItem('tsm26_remote_project_id');
      localStorage.setItem(key, JSON.stringify(proj));
    }, { key: STORAGE_KEY, proj: tc.project });

    // 3. Reload — API intercepted returns [], so localStorage project is used
    await page.reload({ waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(5000); // Extra wait for Jotai risk atoms to compute

    // 4. Canvas screenshot
    await page.screenshot({ path: join(SHOTS, `${tc.slug}.png`), fullPage: false });
    console.log(`  📸 Canvas screenshot`);

    // 5. Read Global Summary Widget for risk count
    const summaryText = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="global-summary"]');
      return el?.textContent || 'NO WIDGET';
    });
    console.log(`  📊 Summary: ${summaryText.replace(/\s+/g, ' ').slice(0, 150)}`);

    // 6. Reports tab
    let citTable = [], flowTable = [];
    try {
      await page.getByText('Reports').first().click({ timeout: 3000 });
      await page.waitForTimeout(3000);

      citTable = await page.evaluate(() => {
        const rows = [];
        const tables = document.querySelectorAll('table');
        if (tables.length >= 1) tables[0].querySelectorAll('tbody tr').forEach(tr => {
          const cells = Array.from(tr.querySelectorAll('td')).map(td => td.textContent?.trim() ?? '');
          if (cells.length >= 6) rows.push(cells);
        });
        return rows;
      });
      console.log(`  📊 CIT rows: ${citTable.length}`);
      citTable.forEach(r => console.log(`    ${r[0]} | ${r[1]} | Rate: ${r[5]} | Amt: ${r[6]} | ${(r[7]||'').slice(0,70)}`));

      flowTable = await page.evaluate(() => {
        const rows = [];
        const tables = document.querySelectorAll('table');
        if (tables.length >= 2) tables[1].querySelectorAll('tbody tr').forEach(tr => {
          const cells = Array.from(tr.querySelectorAll('td')).map(td => td.textContent?.trim() ?? '');
          if (cells.length >= 5) rows.push(cells);
        });
        return rows;
      });

      await page.screenshot({ path: join(SHOTS, `${tc.slug}-reports.png`), fullPage: false });
    } catch (e) { console.log(`  ⚠️ Reports: ${e.message}`); }

    // 7. Read risks from persisted project (after Jotai atoms have recomputed → auto-save)
    // Force a save by triggering a minor interaction then reading
    const risks = await page.evaluate(() => {
      const raw = localStorage.getItem('tsm26_onefile_project_v2');
      if (!raw) return { nodeRisks: {}, projectRisks: [], allRiskTypes: [] };
      const p = JSON.parse(raw);
      const nodeRisks = {};
      const all = new Set();
      for (const nd of p.nodes) {
        if (nd.riskFlags?.length) {
          nodeRisks[nd.name] = nd.riskFlags.map(r => ({ type: r.type, lawRef: r.lawRef || '-' }));
          nd.riskFlags.forEach(r => all.add(r.type));
        }
      }
      const pr = (p.projectRiskFlags || []).map(r => ({ type: r.type, lawRef: r.lawRef || '-' }));
      pr.forEach(r => all.add(r.type));
      return { nodeRisks, projectRisks: pr, allRiskTypes: Array.from(all), title: p.title, nodeNames: p.nodes.map(n=>n.name) };
    });
    console.log(`  🏷️ Project title: ${risks.title}`);
    console.log(`  📋 Nodes: ${risks.nodeNames?.join(', ')}`);
    console.log(`  🚨 Risks: ${risks.allRiskTypes.join(', ') || 'NONE'}`);

    // 8. Export PDF
    let pdfOk = false;
    try {
      const pdfBtn = page.getByText('Export to PDF').or(page.getByText('Экспорт в PDF')).first();
      const [dl] = await Promise.all([
        page.waitForEvent('download', { timeout: 8000 }).catch(() => null),
        pdfBtn.click({ timeout: 3000 }),
      ]);
      if (dl) { await dl.saveAs(join(REPORTS, `${tc.slug}.pdf`)); pdfOk = true; console.log(`  📄 PDF exported`); }
    } catch (e) { console.log(`  ⚠️ PDF: ${e.message}`); }

    results.push({ tc, citTable, flowTable, risks, pdfOk, summaryText });
    await ctx.close();
  }
  await browser.close();

  // ═══ REPORT ═══
  let md = `# E2E Tax Audit — Test Results (v3)\n\n`;
  md += `**Date:** ${new Date().toISOString().slice(0, 10)}\n**Auditor:** Antigravity (Playwright — API-intercepted, clean context)\n**Engine:** Tax Modeler 2026 Alpha\n\n---\n\n`;

  let passCount = 0;
  for (const r of results) {
    const { tc, risks, citTable, pdfOk, summaryText } = r;
    const got = risks.allRiskTypes;
    const exp = tc.expected.risks;
    const ok = exp.every(e => got.some(g => g.includes(e)));
    if (ok) passCount++;

    md += `## ${tc.name}\n\n**Status:** ${ok ? '🟢 PASS' : '🔴 FAIL'}\n\n`;
    md += `**Project Title:** ${risks.title || 'N/A'}\n**Nodes:** ${risks.nodeNames?.join(', ') || 'N/A'}\n\n`;
    md += `**Expected Risks:** ${exp.join(', ')}\n**Actual Risks:** ${got.length ? got.join(', ') : '❌ NONE'}\n**Expected CIT:** ${tc.expected.cit}\n**PDF:** ${pdfOk ? '✅' : '❌'}\n\n`;

    if (Object.keys(risks.nodeRisks).length) {
      md += `### Node-Level Risks\n| Node | Risk Type | Law Ref |\n|------|-----------|--------|\n`;
      for (const [nm, flags] of Object.entries(risks.nodeRisks))
        for (const f of flags) md += `| ${nm} | ${f.type} | ${f.lawRef} |\n`;
      md += '\n';
    }
    if (risks.projectRisks.length) {
      md += `### Project-Level Risks\n| Risk | Law Ref |\n|------|--------|\n`;
      for (const f of risks.projectRisks) md += `| ${f.type} | ${f.lawRef} |\n`;
      md += '\n';
    }
    if (citTable.length) {
      md += `### CIT Schedule\n| Entity | Zone | Pre-Tax | CIT Rate | CIT Amount | Breakdown |\n|--------|------|---------|----------|------------|----------|\n`;
      for (const row of citTable) md += `| ${row[0]} | ${row[1]} | ${row[4]} | ${row[5]} | ${row[6]||'-'} | ${(row[7]||'-').slice(0,80)} |\n`;
      md += '\n';
    }
    md += `### Evidence\n- Canvas: \`test-screenshots/${tc.slug}.png\`\n- Reports: \`test-screenshots/${tc.slug}-reports.png\`\n\n---\n\n`;
  }

  md += `## Summary\n| Metric | Value |\n|--------|-------|\n| Cases | ${CASES.length} |\n| Pass | ${passCount} |\n| Fail | ${CASES.length - passCount} |\n| Rate | ${Math.round(passCount/CASES.length*100)}% |\n`;

  writeFileSync(join(__dirname, 'E2E-Test-Results.md'), md);
  console.log(`\n✅ E2E-Test-Results.md generated\n══ FINAL: ${passCount}/${CASES.length} PASSED ══`);
})();
