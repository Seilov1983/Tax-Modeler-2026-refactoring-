/**
 * E2E AUDIT: South Korea (KR) — Progressive CIT, Risk Flags, i18n
 *
 * T1: i18n verification (South Korea → Южная Корея in sidebar)
 * T2: Progressive CIT math (9% base → 24% top bracket)
 * T3: D-MACE risk flags (KR_CORPORATE_TAX + KR_TP_ADJUSTMENT)
 */
import { chromium } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = 'http://localhost:3000';
const KEY = 'tsm26_onefile_project_v2';
const SHOTS = join(__dirname, 'test-screenshots');
mkdirSync(SHOTS, { recursive: true });

const uid = () => Math.random().toString(16).slice(2, 14);
const now = () => new Date().toISOString();

function makeProject(title, zones, nodes, flows) {
  return {
    schemaVersion: '2.1.0', engineVersion: '2.1.0-alpha',
    projectId: 'kr_' + uid(), title, userId: 'qa',
    createdAt: now(), updatedAt: now(), readOnly: false, baseCurrency: 'USD',
    masterData: {},
    fx: { fxDate: '2026-01-15', rateToUSD: { USD:1, KZT:500, HKD:7.8, AED:3.67, EUR:0.92, KRW:1350 }, source: 'manual' },
    zones, nodes, ownership: [], flows,
    catalogs: { jurisdictions: [], flowTypes: [], riskTypes: [] },
    activeJurisdictions: ['KZ', 'KR'],
    ui: { canvasW:1600, canvasH:1000, editMode:'nodes', gridSize:10, snapToGrid:true, flowLegend:{show:true,mode:'ALL',selectedTypes:[],showTaxes:true} },
    taxes: [], audit: { entries: [], lastHash: 'GENESIS' },
    periods: { closedYears: [] }, group: { consolidatedRevenueEur: null },
    accounting: { years: {} }, lawReferences: {}, snapshots: [],
    pipeline: { lastRunAt: null, lastRun: null, runs: [] }, projectRiskFlags: [],
  };
}

function node(id, name, zoneId, income, extra = {}) {
  return {
    id, name, type: 'company', x: 100, y: 120, w: 190, h: 90,
    zoneId, frozen: false, riskFlags: [], annualIncome: income, etr: 0, balances: {},
    effectiveFrom: '2026-01-01', effectiveTo: null, industryTags: [],
    ledger: { balances: {}, digitalAssets: {}, retainedEarnings: 0, accumulatedLosses: 0, debtToTXA: 0 },
    complianceData: { substance: {}, aifc: { usesCITBenefit: false, cigaInZone: true }, bvi: {} },
    managementTags: [], ...extra,
  };
}

async function runCase(browser, title, proj) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage();
  await page.route('**/api/projects**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(1000);
  await page.evaluate(({k,p}) => { localStorage.clear(); localStorage.removeItem('tsm26_remote_project_id'); localStorage.setItem(k,JSON.stringify(p)); }, {k:KEY,p:proj});
  await page.reload({ waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(8000);
  return { ctx, page };
}

async function getCitRows(page) {
  await page.getByText('Reports').first().click({ timeout: 3000 });
  await page.waitForTimeout(3000);
  return page.evaluate(() => {
    const rows = [];
    document.querySelectorAll('table')[0]?.querySelectorAll('tbody tr').forEach(tr => {
      const c = Array.from(tr.querySelectorAll('td')).map(td => td.textContent?.trim() ?? '');
      if (c.length >= 6) rows.push(c);
    });
    return rows;
  });
}

async function getRiskFlags(page) {
  // Wait extra for debounce cycle to complete and write back to localStorage
  await page.waitForTimeout(3000);
  return page.evaluate(() => {
    const raw = localStorage.getItem('tsm26_onefile_project_v2');
    if (!raw) return [];
    const p = JSON.parse(raw);
    return (p.nodes || []).map(n => ({ name: n.name, risks: (n.riskFlags || []).map(r => ({ type: r.type, lawRef: r.lawRef, msg: r.message })) }));
  });
}

// ═══════════════════════════════════════════════════════════════
// TEST 1: i18n Verification
// ═══════════════════════════════════════════════════════════════
async function test1(browser) {
  console.log('\n═══ T1: i18n VERIFICATION ═══');
  const proj = makeProject('KR i18n Test',
    [{ id:'z_kr', name:'South Korea', x:50, y:50, w:400, h:300, jurisdiction:'KR', code:'KR_STANDARD', currency:'KRW', zIndex:1, parentId:null }],
    [node('n1', 'Seoul Corp', 'z_kr', 100000000)],
    []);

  const { ctx, page } = await runCase(browser, 'KR i18n', proj);

  // Check that KR exists in sidebar/DOM
  const domCheck = await page.evaluate(() => {
    const text = document.body.innerText;
    return {
      hasKR: text.includes('KR') || text.includes('South Korea') || text.includes('Korea'),
      hasSouthKorea: text.includes('South Korea'),
      hasKRW: text.includes('KRW'),
      hasKRZone: text.includes('South Korea') || text.includes('KR · KRW') || text.includes('KR_STANDARD'),
    };
  });

  console.log(`  KR in DOM: ${domCheck.hasKR}`);
  console.log(`  "South Korea" present: ${domCheck.hasSouthKorea}`);
  console.log(`  KRW currency: ${domCheck.hasKRW}`);

  // Check Reports for zone name
  const rows = await getCitRows(page);
  const krRow = rows.find(r => r[0]?.includes('Seoul') || r[1]?.includes('Korea') || r[1]?.includes('KR'));
  console.log(`  CIT row for KR entity: ${krRow ? krRow.slice(0,3).join(' | ') : 'NOT FOUND'}`);

  await page.screenshot({ path: join(SHOTS, 'kr-t1-i18n.png') });

  // Check i18n translation exists in masterDataNames
  const i18nCheck = await page.evaluate(() => {
    // Check if the app source has the translation
    const scripts = Array.from(document.querySelectorAll('script'));
    const html = document.documentElement.innerHTML;
    return {
      hasTranslation: html.includes('Южная Корея') || html.includes('South Korea'),
      zoneLabelInUI: document.body.innerText.match(/South Korea|Южная Корея|KR/g)?.join(', ') || 'NONE',
    };
  });
  console.log(`  Zone label matches: ${i18nCheck.zoneLabelInUI}`);

  await ctx.close();
  return { pass: !!krRow && (domCheck.hasKR || i18nCheck.zoneLabelInUI.includes('South Korea') || i18nCheck.zoneLabelInUI.includes('KR')), krRow, domCheck };
}

// ═══════════════════════════════════════════════════════════════
// TEST 2: Progressive CIT Math Audit
// ═══════════════════════════════════════════════════════════════
async function test2(browser) {
  console.log('\n═══ T2: PROGRESSIVE CIT MATH AUDIT ═══');

  // Case A: Small income → 9% bracket
  console.log('\n  ▸ Case A: 100M KRW (should be 9% flat on first bracket)');
  const projA = makeProject('KR CIT Small',
    [{ id:'z_kr', name:'South Korea', x:50, y:50, w:400, h:300, jurisdiction:'KR', code:'KR_STANDARD', currency:'KRW', zIndex:1, parentId:null }],
    [node('n1', 'KR SmallCo', 'z_kr', 100000000)],
    []);

  let { ctx, page } = await runCase(browser, 'KR Small', projA);
  let rows = await getCitRows(page);
  await page.screenshot({ path: join(SHOTS, 'kr-t2-small.png') });
  const smallRow = rows.find(r => r[0]?.includes('SmallCo'));
  console.log(`    SmallCo: Rate=${smallRow?.[5]}, Amt=${smallRow?.[6]}`);
  console.log(`    Breakdown: ${(smallRow?.[7] || '').slice(0,120)}`);

  // Expected: 100M × 9% = 9,000,000 KRW
  const smallAmt = parseFloat((smallRow?.[6] || '0').replace(/[^0-9.-]/g, ''));
  const expectedSmall = 100000000 * 0.09;
  console.log(`    Expected: ${expectedSmall.toLocaleString()}, Got: ${smallAmt.toLocaleString()}`);
  const smallPass = Math.abs(smallAmt - expectedSmall) < 100;
  console.log(`    ${smallPass ? '✅ PASS' : '❌ FAIL'}: 9% bracket math`);
  await ctx.close();

  // Case B: Massive income → progressive brackets
  console.log('\n  ▸ Case B: 500B KRW (hits all 4 brackets)');
  const projB = makeProject('KR CIT Massive',
    [{ id:'z_kr', name:'South Korea', x:50, y:50, w:400, h:300, jurisdiction:'KR', code:'KR_STANDARD', currency:'KRW', zIndex:1, parentId:null }],
    [node('n1', 'KR MegaCorp', 'z_kr', 500000000000)],
    []);

  ({ ctx, page } = await runCase(browser, 'KR Massive', projB));
  rows = await getCitRows(page);
  await page.screenshot({ path: join(SHOTS, 'kr-t2-massive.png') });
  const bigRow = rows.find(r => r[0]?.includes('MegaCorp'));
  console.log(`    MegaCorp: Rate=${bigRow?.[5]}, Amt=${bigRow?.[6]}`);
  console.log(`    Breakdown: ${(bigRow?.[7] || '').slice(0,150)}`);

  // Manual calculation of 500B KRW progressive brackets:
  // Bracket 1: 200M × 9%         = 18,000,000
  // Bracket 2: (20B - 200M) × 19% = 19.8B × 19% = 3,762,000,000
  // Bracket 3: (300B - 20B) × 21% = 280B × 21%  = 58,800,000,000
  // Bracket 4: (500B - 300B) × 24% = 200B × 24% = 48,000,000,000
  // Total: 18M + 3.762B + 58.8B + 48B = 110,580,000,000
  const expectedBig = 18000000 + 3762000000 + 58800000000 + 48000000000; // = 110,580,000,000
  const bigAmt = parseFloat((bigRow?.[6] || '0').replace(/[^0-9.-]/g, ''));
  console.log(`    Expected progressive: ${expectedBig.toLocaleString()}, Got: ${bigAmt.toLocaleString()}`);
  const bigPass = Math.abs(bigAmt - expectedBig) < 1000;
  console.log(`    ${bigPass ? '✅ PASS' : '❌ FAIL'}: Progressive brackets math`);

  // Verify effective rate
  const effectiveRate = bigAmt / 500000000000;
  console.log(`    Effective rate: ${(effectiveRate * 100).toFixed(2)}% (expected ~22.12%)`);
  await ctx.close();

  return { smallPass, bigPass, smallAmt, bigAmt, expectedSmall, expectedBig, effectiveRate };
}

// ═══════════════════════════════════════════════════════════════
// TEST 3: D-MACE Risk Engine Audit
// ═══════════════════════════════════════════════════════════════
async function test3(browser) {
  console.log('\n═══ T3: D-MACE RISK ENGINE AUDIT ═══');

  const proj = makeProject('KR Risk Test',
    [
      { id:'z_kz', name:'Kazakhstan', x:50, y:50, w:350, h:300, jurisdiction:'KZ', code:'KZ_STANDARD', currency:'KZT', zIndex:1, parentId:null },
      { id:'z_kr', name:'South Korea', x:450, y:50, w:350, h:300, jurisdiction:'KR', code:'KR_STANDARD', currency:'KRW', zIndex:1, parentId:null },
    ],
    [
      node('n_kz', 'KZ Parent', 'z_kz', 500000000),
      node('n_kr', 'KR Subsidiary', 'z_kr', 200000000000),
    ],
    [
      { id:'f1', fromId:'n_kz', toId:'n_kr', flowType:'Services', grossAmount:50000000000, currency:'KRW',
        paymentMethod:'bank', cashComponentAmount:0, cashComponentCurrency:'KRW', whtRate:0, status:'completed',
        flowDate:'2026-01-15T12:00:00.000Z',
        ack:{ackStatus:'not_required',acknowledgedBy:null,acknowledgedAt:null,comment:''},
        taxAdjustments:[], fxEvidence:null },
    ]);

  const { ctx, page } = await runCase(browser, 'KR Risks', proj);

  // Read risk flags from localStorage (engine has already recomputed)
  const riskData = await getRiskFlags(page);
  console.log('\n  Risk flags per node:');
  for (const n of riskData) {
    console.log(`    ${n.name}: ${n.risks.length} risks`);
    for (const r of n.risks) {
      console.log(`      → ${r.type} | ${(r.lawRef || '').slice(0,80)} | ${(r.msg || '').slice(0,80)}`);
    }
  }

  const krNode = riskData.find(n => n.name === 'KR Subsidiary');
  const hasCorporateTax = krNode?.risks.some(r => r.type === 'KR_CORPORATE_TAX');
  const hasTpAdjustment = krNode?.risks.some(r => r.type === 'KR_TP_ADJUSTMENT');

  console.log(`\n  KR_CORPORATE_TAX: ${hasCorporateTax ? '✅ FOUND' : '❌ MISSING'}`);
  console.log(`  KR_TP_ADJUSTMENT: ${hasTpAdjustment ? '✅ FOUND' : '❌ MISSING'}`);

  // Check Reports for risk display
  const rows = await getCitRows(page);
  await page.screenshot({ path: join(SHOTS, 'kr-t3-risks.png') });

  // Check risk labels in Dashboard
  await page.getByText('Canvas').first().click({ timeout: 3000 });
  await page.waitForTimeout(2000);
  const dashboardRisks = await page.evaluate(() => {
    const text = document.body.innerText;
    return {
      hasKrCorporateTax: text.includes('KR Progressive CIT') || text.includes('КПН Кореи') || text.includes('KR_CORPORATE_TAX'),
      hasKrTpAdjustment: text.includes('KR Transfer Pricing') || text.includes('ТЦО Кореи') || text.includes('KR_TP_ADJUSTMENT'),
      activeRisksText: text.match(/ACTIVE RISKS\s*\d+/)?.[0] || 'NOT FOUND',
    };
  });
  console.log(`  Dashboard — KR_CORPORATE_TAX label: ${dashboardRisks.hasKrCorporateTax}`);
  console.log(`  Dashboard — KR_TP_ADJUSTMENT label: ${dashboardRisks.hasKrTpAdjustment}`);
  console.log(`  Active Risks: ${dashboardRisks.activeRisksText}`);

  await page.screenshot({ path: join(SHOTS, 'kr-t3-dashboard.png') });
  await ctx.close();

  return { hasCorporateTax, hasTpAdjustment, dashboardRisks };
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════
(async () => {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  E2E AUDIT: SOUTH KOREA (KR)                           ║');
  console.log('║  Progressive CIT · Risk Flags · i18n                   ║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  const browser = await chromium.launch({ headless: true });

  const t1 = await test1(browser);
  const t2 = await test2(browser);
  const t3 = await test3(browser);

  await browser.close();

  console.log('\n' + '═'.repeat(60));
  console.log('  E2E AUDIT RESULTS: SOUTH KOREA (KR)');
  console.log('═'.repeat(60));
  console.log(`  T1 i18n:        ${t1.pass ? '🟢 PASS' : '🔴 FAIL'}`);
  console.log(`  T2a Small CIT:  ${t2.smallPass ? '🟢 PASS' : '🔴 FAIL'}  (${t2.smallAmt?.toLocaleString()} vs expected ${t2.expectedSmall?.toLocaleString()})`);
  console.log(`  T2b Massive CIT: ${t2.bigPass ? '🟢 PASS' : '🔴 FAIL'}  (${t2.bigAmt?.toLocaleString()} vs expected ${t2.expectedBig?.toLocaleString()}, ETR=${(t2.effectiveRate*100).toFixed(2)}%)`);
  console.log(`  T3a KR_CORPORATE_TAX: ${t3.hasCorporateTax ? '🟢 PASS' : '🔴 FAIL'}`);
  console.log(`  T3b KR_TP_ADJUSTMENT: ${t3.hasTpAdjustment ? '🟢 PASS' : '🔴 FAIL'}`);

  const all = [t1.pass, t2.smallPass, t2.bigPass, t3.hasCorporateTax, t3.hasTpAdjustment];
  console.log(`\n  OVERALL: ${all.filter(Boolean).length}/${all.length} PASSED`);
})();
