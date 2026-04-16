/**
 * UAT Hotfix Verification — 3 targeted tests:
 *  T1: AIFC 0% CIT with substance ON → 0%, substance OFF → 20%
 *  T2: UAE QFZP toggle → isQFZP=true → 0%, isQFZP=false → 9%
 *  T3: Project Isolation — "New Project" clears remote ID
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

function shell(title, zones, nodes, flows, own = [], ext = {}) {
  return {
    schemaVersion: '2.1.0', engineVersion: '2.1.0-alpha',
    projectId: 'uat_' + uid(), title, userId: 'qa',
    createdAt: now(), updatedAt: now(), readOnly: false, baseCurrency: 'USD',
    masterData: {},
    fx: { fxDate: '2026-01-15', rateToUSD: { USD:1, KZT:500, HKD:7.8, AED:3.67, EUR:0.92 }, source: 'manual' },
    zones, nodes, ownership: own,
    catalogs: { jurisdictions: [], flowTypes: [], riskTypes: [] },
    activeJurisdictions: ['KZ','UAE','HK','CY','BVI'],
    ui: { canvasW:1600, canvasH:1000, editMode:'nodes', gridSize:10, snapToGrid:true, flowLegend:{show:true,mode:'ALL',selectedTypes:[],showTaxes:true} },
    flows, taxes: [],
    audit: { entries: [], lastHash: 'GENESIS' },
    periods: { closedYears: [] },
    group: { consolidatedRevenueEur: null },
    accounting: { years: {} }, lawReferences: {}, snapshots: [],
    pipeline: { lastRunAt: null, lastRun: null, runs: [] },
    projectRiskFlags: [],
    ...ext,
  };
}

// ═══════════════════════════════════════════════════════════════════
// TEST 1: AIFC 0% CIT — substance ON vs OFF
// ═══════════════════════════════════════════════════════════════════
async function testAIFC(browser) {
  console.log('\n' + '═'.repeat(60));
  console.log('▶ TEST 1A: AIFC with substance ON');
  console.log('═'.repeat(60));

  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage();
  await page.route('**/api/projects**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));

  // Case A: substance ON
  const projA = shell('UAT AIFC Substance ON',
    [{ id:'z_kz',name:'Kazakhstan',x:30,y:30,w:550,h:450,jurisdiction:'KZ',code:'KZ_STANDARD',currency:'KZT',zIndex:1,parentId:null },
     { id:'z_aifc',name:'AIFC',x:50,y:60,w:300,h:200,jurisdiction:'KZ',code:'KZ_AIFC',currency:'KZT',zIndex:2,parentId:'z_kz' }],
    [{ id:'n1',name:'AIFC FinCo',type:'company',x:80,y:90,w:190,h:90,zoneId:'z_aifc',
       frozen:false,riskFlags:[],annualIncome:1000000000,etr:0,balances:{},
       effectiveFrom:'2026-01-01',effectiveTo:null,industryTags:[],
       hasSubstance:true, hasSeparateAccounting:true,
       ledger:{balances:{},digitalAssets:{},retainedEarnings:0,accumulatedLosses:0,debtToTXA:0},
       complianceData:{substance:{employeesCount:10,hasPhysicalOffice:true,cigaInZone:true},
         aifc:{usesCITBenefit:true,cigaInZone:true},bvi:{}},
       substanceMetrics:{headcount:10,operationalExpenses:50000000,payrollCosts:20000000},
       managementTags:[] },
     { id:'n2',name:'Client',type:'company',x:400,y:200,w:190,h:90,zoneId:'z_kz',
       frozen:false,riskFlags:[],annualIncome:0,etr:0,balances:{},
       effectiveFrom:'2026-01-01',effectiveTo:null,industryTags:[],
       ledger:{balances:{},digitalAssets:{},retainedEarnings:0,accumulatedLosses:0,debtToTXA:0},
       complianceData:{substance:{},aifc:{usesCITBenefit:false,cigaInZone:true},bvi:{}},
       managementTags:[] }],
    [{ id:'f1',fromId:'n2',toId:'n1',flowType:'Services',grossAmount:1000000000,currency:'KZT',
       paymentMethod:'bank',cashComponentAmount:0,cashComponentCurrency:'KZT',whtRate:0,status:'completed',
       flowDate:'2026-01-15T12:00:00.000Z',
       ack:{ackStatus:'not_required',acknowledgedBy:null,acknowledgedAt:null,comment:''},
       taxAdjustments:[],fxEvidence:null }]);

  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(1000);
  await page.evaluate(({k,p}) => { localStorage.clear(); localStorage.removeItem('tsm26_remote_project_id'); localStorage.setItem(k,JSON.stringify(p)); }, {k:KEY,p:projA});
  await page.reload({ waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(5000);

  // Go to Reports
  await page.getByText('Reports').first().click({ timeout: 3000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: join(SHOTS, 'uat-aifc-substance-ON.png') });

  const citA = await page.evaluate(() => {
    const rows = [];
    document.querySelectorAll('table')[0]?.querySelectorAll('tbody tr').forEach(tr => {
      const c = Array.from(tr.querySelectorAll('td')).map(td => td.textContent?.trim() ?? '');
      if (c.length >= 6) rows.push(c);
    });
    return rows;
  });
  console.log('  CIT rows:');
  citA.forEach(r => console.log(`    ${r[0]} | ${r[1]} | Rate: ${r[5]} | Amt: ${r[6]} | ${(r[7]||'').slice(0,80)}`));
  const aifcRowA = citA.find(r => r[0]?.includes('AIFC'));
  console.log(`  ✅ AIFC citRate with substance ON: ${aifcRowA?.[5] || 'NOT FOUND'}`);
  console.log(`  ✅ AIFC citAmount: ${aifcRowA?.[6] || 'NOT FOUND'}`);
  console.log(`  ✅ Breakdown: ${(aifcRowA?.[7] || 'NOT FOUND').slice(0,120)}`);
  await ctx.close();

  // Case B: substance OFF
  console.log('\n' + '═'.repeat(60));
  console.log('▶ TEST 1B: AIFC with substance OFF');
  console.log('═'.repeat(60));

  const ctx2 = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page2 = await ctx2.newPage();
  await page2.route('**/api/projects**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));

  const projB = JSON.parse(JSON.stringify(projA));
  projB.projectId = 'uat_' + uid();
  projB.title = 'UAT AIFC Substance OFF';
  projB.nodes[0].hasSubstance = false;
  projB.nodes[0].hasSeparateAccounting = false;
  projB.nodes[0].complianceData.aifc.cigaInZone = false;

  await page2.goto(BASE, { waitUntil: 'networkidle', timeout: 20000 });
  await page2.waitForTimeout(1000);
  await page2.evaluate(({k,p}) => { localStorage.clear(); localStorage.removeItem('tsm26_remote_project_id'); localStorage.setItem(k,JSON.stringify(p)); }, {k:KEY,p:projB});
  await page2.reload({ waitUntil: 'networkidle', timeout: 20000 });
  await page2.waitForTimeout(5000);

  await page2.getByText('Reports').first().click({ timeout: 3000 });
  await page2.waitForTimeout(3000);
  await page2.screenshot({ path: join(SHOTS, 'uat-aifc-substance-OFF.png') });

  const citB = await page2.evaluate(() => {
    const rows = [];
    document.querySelectorAll('table')[0]?.querySelectorAll('tbody tr').forEach(tr => {
      const c = Array.from(tr.querySelectorAll('td')).map(td => td.textContent?.trim() ?? '');
      if (c.length >= 6) rows.push(c);
    });
    return rows;
  });
  citB.forEach(r => console.log(`    ${r[0]} | ${r[1]} | Rate: ${r[5]} | Amt: ${r[6]} | ${(r[7]||'').slice(0,80)}`));
  const aifcRowB = citB.find(r => r[0]?.includes('AIFC'));
  console.log(`  ✅ AIFC citRate with substance OFF: ${aifcRowB?.[5] || 'NOT FOUND'}`);
  console.log(`  ✅ AIFC citAmount: ${aifcRowB?.[6] || 'NOT FOUND'}`);
  console.log(`  ✅ Breakdown: ${(aifcRowB?.[7] || 'NOT FOUND').slice(0,120)}`);
  await ctx2.close();

  return { rateOn: aifcRowA?.[5], rateOff: aifcRowB?.[5], amtOn: aifcRowA?.[6], amtOff: aifcRowB?.[6], brkOn: aifcRowA?.[7], brkOff: aifcRowB?.[7] };
}

// ═══════════════════════════════════════════════════════════════════
// TEST 2: UAE QFZP toggle — isQFZP ON vs OFF
// ═══════════════════════════════════════════════════════════════════
async function testQFZP(browser) {
  console.log('\n' + '═'.repeat(60));
  console.log('▶ TEST 2A: UAE FZ with isQFZP=true');
  console.log('═'.repeat(60));

  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage();
  await page.route('**/api/projects**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));

  const proj = shell('UAT QFZP ON',
    [{ id:'z_uae',name:'UAE Free Zone',x:50,y:50,w:400,h:300,jurisdiction:'UAE',code:'UAE_FREEZONE_QFZP',currency:'AED',zIndex:1,parentId:null }],
    [{ id:'n1',name:'FZ TechCo',type:'company',x:100,y:120,w:190,h:90,zoneId:'z_uae',
       frozen:false,riskFlags:[],annualIncome:50000000,etr:0,balances:{},isQFZP:true,
       effectiveFrom:'2026-01-01',effectiveTo:null,industryTags:[],
       ledger:{balances:{},digitalAssets:{},retainedEarnings:0,accumulatedLosses:0,debtToTXA:0},
       complianceData:{substance:{},aifc:{usesCITBenefit:false,cigaInZone:true},bvi:{}},
       managementTags:[] }],
    []);

  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(1000);
  await page.evaluate(({k,p}) => { localStorage.clear(); localStorage.removeItem('tsm26_remote_project_id'); localStorage.setItem(k,JSON.stringify(p)); }, {k:KEY,p:proj});
  await page.reload({ waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(5000);

  await page.getByText('Reports').first().click({ timeout: 3000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: join(SHOTS, 'uat-qfzp-ON.png') });

  const citA = await page.evaluate(() => {
    const rows = [];
    document.querySelectorAll('table')[0]?.querySelectorAll('tbody tr').forEach(tr => {
      const c = Array.from(tr.querySelectorAll('td')).map(td => td.textContent?.trim() ?? '');
      if (c.length >= 6) rows.push(c);
    });
    return rows;
  });
  citA.forEach(r => console.log(`    ${r[0]} | ${r[1]} | Rate: ${r[5]} | Amt: ${r[6]} | ${(r[7]||'').slice(0,80)}`));
  const fzRowA = citA.find(r => r[0]?.includes('FZ'));
  console.log(`  ✅ FZ citRate with QFZP ON: ${fzRowA?.[5]}`);
  await ctx.close();

  // Case B: QFZP OFF
  console.log('\n' + '═'.repeat(60));
  console.log('▶ TEST 2B: UAE FZ with isQFZP=false');
  console.log('═'.repeat(60));

  const ctx2 = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page2 = await ctx2.newPage();
  await page2.route('**/api/projects**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));

  const projOff = JSON.parse(JSON.stringify(proj));
  projOff.projectId = 'uat_' + uid();
  projOff.title = 'UAT QFZP OFF';
  projOff.nodes[0].isQFZP = false;

  await page2.goto(BASE, { waitUntil: 'networkidle', timeout: 20000 });
  await page2.waitForTimeout(1000);
  await page2.evaluate(({k,p}) => { localStorage.clear(); localStorage.removeItem('tsm26_remote_project_id'); localStorage.setItem(k,JSON.stringify(p)); }, {k:KEY,p:projOff});
  await page2.reload({ waitUntil: 'networkidle', timeout: 20000 });
  await page2.waitForTimeout(5000);

  await page2.getByText('Reports').first().click({ timeout: 3000 });
  await page2.waitForTimeout(3000);
  await page2.screenshot({ path: join(SHOTS, 'uat-qfzp-OFF.png') });

  const citB = await page2.evaluate(() => {
    const rows = [];
    document.querySelectorAll('table')[0]?.querySelectorAll('tbody tr').forEach(tr => {
      const c = Array.from(tr.querySelectorAll('td')).map(td => td.textContent?.trim() ?? '');
      if (c.length >= 6) rows.push(c);
    });
    return rows;
  });
  citB.forEach(r => console.log(`    ${r[0]} | ${r[1]} | Rate: ${r[5]} | Amt: ${r[6]} | ${(r[7]||'').slice(0,80)}`));
  const fzRowB = citB.find(r => r[0]?.includes('FZ'));
  console.log(`  ✅ FZ citRate with QFZP OFF: ${fzRowB?.[5]}`);

  // Also check for QFZP toggle in EditorModal
  await page2.getByText('Canvas').first().click({ timeout: 3000 });
  await page2.waitForTimeout(2000);
  // Try to find and screenshot the EditorModal by evaluating DOM for QFZP
  const hasQfzpToggle = await page2.evaluate(() => {
    const html = document.body.innerHTML;
    return html.includes('isQFZP') || html.includes('QFZP') || html.includes('Qualifying Free Zone');
  });
  console.log(`  ✅ QFZP toggle exists in DOM: ${hasQfzpToggle}`);
  await ctx2.close();

  return { rateQfzpOn: fzRowA?.[5], rateQfzpOff: fzRowB?.[5], toggleExists: hasQfzpToggle };
}

// ═══════════════════════════════════════════════════════════════════
// TEST 3: Project Isolation
// ═══════════════════════════════════════════════════════════════════
async function testIsolation(browser) {
  console.log('\n' + '═'.repeat(60));
  console.log('▶ TEST 3: Project Isolation');
  console.log('═'.repeat(60));

  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage();
  // DON'T intercept API — let the real app flow work
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(3000);

  // Set a fake remote project ID
  await page.evaluate(() => {
    localStorage.setItem('tsm26_remote_project_id', 'fake_old_project_id_12345');
  });

  // Click "+ New" button
  try {
    const newBtn = page.getByText('New').first();
    await newBtn.click({ timeout: 3000 });
    await page.waitForTimeout(2000);
  } catch (e) {
    console.log(`  ⚠️ Could not click New: ${e.message}`);
  }

  // Check if remote ID was cleared
  const remoteId = await page.evaluate(() => localStorage.getItem('tsm26_remote_project_id'));
  console.log(`  Remote project ID after "New": ${remoteId === null ? '✅ CLEARED (null)' : `❌ STILL SET: ${remoteId}`}`);

  // Also check useDebouncedCloudSync code
  const syncCode = await page.evaluate(() => {
    // Read the current project from localStorage
    const raw = localStorage.getItem('tsm26_onefile_project_v2');
    if (!raw) return { projectTitle: 'NO PROJECT', projectId: null };
    const p = JSON.parse(raw);
    return { projectTitle: p.title, projectId: p.projectId };
  });
  console.log(`  Current project after New: "${syncCode.projectTitle}" (${syncCode.projectId})`);
  await page.screenshot({ path: join(SHOTS, 'uat-isolation.png') });
  await ctx.close();

  return { remoteIdCleared: remoteId === null, projectTitle: syncCode.projectTitle };
}

// ═══════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════
(async () => {
  const browser = await chromium.launch({ headless: true });

  const t1 = await testAIFC(browser);
  const t2 = await testQFZP(browser);
  const t3 = await testIsolation(browser);

  await browser.close();

  console.log('\n' + '═'.repeat(60));
  console.log('  UAT HOTFIX VERIFICATION — RESULTS');
  console.log('═'.repeat(60));

  const t1pass = t1.rateOn?.includes('0.00%') && (t1.rateOff?.includes('20.00%'));
  const t2pass = (t2.rateQfzpOn?.includes('0.00%') || t2.rateQfzpOn?.includes('0%')) && t2.rateQfzpOff?.includes('9');
  const t3pass = t3.remoteIdCleared;

  console.log(`  T1 AIFC: Substance ON → ${t1.rateOn}, OFF → ${t1.rateOff}  ${t1pass ? '🟢 PASS' : '🔴 FAIL'}`);
  console.log(`  T2 QFZP: ON → ${t2.rateQfzpOn}, OFF → ${t2.rateQfzpOff}, Toggle: ${t2.toggleExists}  ${t2pass ? '🟢 PASS' : '🔴 FAIL'}`);
  console.log(`  T3 Isolation: remoteId cleared = ${t3.remoteIdCleared}  ${t3pass ? '🟢 PASS' : '🔴 FAIL'}`);
  console.log(`\n  OVERALL: ${[t1pass,t2pass,t3pass].filter(Boolean).length}/3 PASSED`);

  writeFileSync(join(__dirname, 'uat-hotfix-results.json'), JSON.stringify({ t1, t2, t3, t1pass, t2pass, t3pass }, null, 2));
  console.log('  Results saved to uat-hotfix-results.json');
})();
