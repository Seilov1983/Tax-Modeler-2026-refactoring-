/**
 * UAT Script: Patch localStorage + verify Nexus Breakdown column in Reports tab.
 * Run: node uat-nexus-verify.mjs
 */
import { chromium } from '@playwright/test';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = 'http://localhost:3000';
const STORAGE_KEY = 'tsm26_onefile_project_v2';
const OUT = (name) => join(__dirname, name);

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  // ── Step 1: Load app so localStorage is accessible ──────────────────────
  console.log('[1] Loading app…');
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(2000);

  // ── Step 2: Patch localStorage ───────────────────────────────────────────
  console.log('[2] Patching localStorage…');
  const patchResult = await page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    if (!raw) return { error: 'No project in localStorage' };

    const p = JSON.parse(raw);

    // Fix double-prefix zone codes (KZ_KZ_HUB → KZ_HUB)
    let fixedZones = 0;
    const zoneCodes = [];
    for (const z of p.zones) {
      const fixed = z.code.replace(/^([A-Z]+)_\1_/, '$1_');
      if (fixed !== z.code) {
        fixedZones++;
        z.code = fixed;
      }
      zoneCodes.push(z.code);
    }

    // Find IT node and enable isIPIncome + nexusParams
    const it = p.nodes.find((n) => n.name === 'IT');
    let itPatched = false;
    if (it) {
      it.isIPIncome = true;
      it.hasSubstance = true;
      it.nexusParams = { rUp: 4500000, rOut1: 300000, rOut2: 0, rAcq: 0 };
      it.substanceMetrics = { headcount: 15, operationalExpenses: 8000000, payrollCosts: 3500000 };
      itPatched = true;
    }

    localStorage.setItem(key, JSON.stringify(p));

    return {
      fixedZones,
      zoneCodes,
      itPatched,
      itIsIPIncome: it?.isIPIncome,
      itZoneId: it?.zoneId,
      allNodes: p.nodes.map((n) => n.name),
      allZones: p.zones.map((z) => ({ id: z.id, code: z.code, name: z.name })),
    };
  }, STORAGE_KEY);

  console.log('[2] Patch result:', JSON.stringify(patchResult, null, 2));

  // ── Step 3: Reload to apply patched data ────────────────────────────────
  console.log('[3] Reloading app…');
  await page.reload({ waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(3000);

  // ── Step 4: Screenshot of Canvas ────────────────────────────────────────
  await page.screenshot({ path: OUT('uat_01_canvas.png'), fullPage: false });
  console.log('[4] Canvas screenshot saved');

  // ── Step 5: Click Reports tab ────────────────────────────────────────────
  console.log('[5] Clicking Reports tab…');
  const reportsBtn = page.getByText('Reports').first();
  await reportsBtn.click();
  await page.waitForTimeout(2500);

  // ── Step 6: Screenshot & extract table ──────────────────────────────────
  await page.screenshot({ path: OUT('uat_02_reports.png'), fullPage: false });
  console.log('[6] Reports screenshot saved');

  // Extract all rows from НАЛОГОВАЯ СВОДКА table
  const tableData = await page.evaluate(() => {
    // Find all rows in the entity tax table
    const rows = [];
    const trs = document.querySelectorAll('tbody tr');
    trs.forEach((tr) => {
      const cells = Array.from(tr.querySelectorAll('td')).map((td) => td.textContent?.trim() ?? '');
      if (cells.length > 0) rows.push(cells);
    });
    return rows;
  });

  console.log('\n[6] ══ НАЛОГОВАЯ СВОДКА — RAW TABLE DATA ══');
  tableData.forEach((row, i) => {
    console.log(`  Row ${i}: [${row.map((c) => JSON.stringify(c)).join(' | ')}]`);
  });

  // Find flow ledger rows too
  const flowRows = await page.evaluate(() => {
    const rows = [];
    // Look for tables after the entity tax table
    const allTrs = document.querySelectorAll('tr');
    let inFlowSection = false;
    allTrs.forEach((tr) => {
      const cells = Array.from(tr.querySelectorAll('td,th')).map((td) => td.textContent?.trim() ?? '');
      rows.push(cells);
    });
    return rows;
  });

  console.log('\n[6] ══ ALL TABLE ROWS (including flow ledger) ══');
  flowRows.slice(0, 30).forEach((row, i) => {
    if (row.some((c) => c.length > 0)) {
      console.log(`  ${i}: ${row.join(' | ')}`);
    }
  });

  // ── Step 7: Click Export PDF ─────────────────────────────────────────────
  console.log('\n[7] Looking for PDF export button…');
  try {
    // Try various selectors
    const pdfBtn = page.getByText('Экспорт в PDF').or(page.getByText('Export PDF')).first();
    await pdfBtn.click({ timeout: 5000 });
    await page.waitForTimeout(3000);
    console.log('[7] PDF button clicked');
  } catch (e) {
    console.log('[7] PDF button not found:', e.message);
  }

  await page.screenshot({ path: OUT('uat_03_after_pdf.png'), fullPage: false });
  console.log('[8] Final screenshot saved');

  await browser.close();
  console.log('\n══ UAT COMPLETE ══');
})();
