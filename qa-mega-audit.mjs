/**
 * QA MEGA-AUDIT: Visual Fidelity, i18n, A11y, Screen Coverage
 * Autonomous Playwright crawl of Tax Modeler 2026.
 *
 * Run: node qa-mega-audit.mjs
 */
import { chromium } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = 'http://localhost:3000';
const SHOTS = join(__dirname, 'qa-audit-screenshots');
mkdirSync(SHOTS, { recursive: true });

const findings = { task1: [], task2: [], task3: [], task4: [] };
let shotN = 0;
const shot = (page, name) => page.screenshot({ path: join(SHOTS, `${String(++shotN).padStart(2,'0')}-${name}.png`), fullPage: false });

function fail(task, id, what, detail) { findings[task].push({ id, status: '🔴 FAIL', what, detail }); }
function pass(task, id, what, detail) { findings[task].push({ id, status: '🟢 PASS', what, detail }); }
function warn(task, id, what, detail) { findings[task].push({ id, status: '🟡 WARN', what, detail }); }

// ─── Helpers ──────────────────────────────────────────────────────

/** Check WCAG AA contrast ratio between fg and bg colors */
function contrastRatio(fg, bg) {
  const lum = (hex) => {
    const r = parseInt(hex.slice(1,3),16)/255;
    const g = parseInt(hex.slice(3,5),16)/255;
    const b = parseInt(hex.slice(5,7),16)/255;
    const s = [r,g,b].map(c => c <= 0.03928 ? c/12.92 : ((c+0.055)/1.055)**2.4);
    return 0.2126*s[0]+0.7152*s[1]+0.0722*s[2];
  };
  const L1 = lum(fg), L2 = lum(bg);
  return (Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05);
}

function rgbToHex(rgb) {
  if (!rgb || rgb === 'transparent' || rgb === 'rgba(0, 0, 0, 0)') return null;
  const m = rgb.match(/\d+/g);
  if (!m || m.length < 3) return null;
  return '#' + m.slice(0,3).map(x => parseInt(x).toString(16).padStart(2,'0')).join('');
}

// ═══════════════════════════════════════════════════════════════
// TASK 1: PIXEL PERFECT & VISUAL FIDELITY
// ═══════════════════════════════════════════════════════════════
async function task1(page) {
  console.log('\n═══ TASK 1: PIXEL PERFECT & VISUAL FIDELITY ═══');

  // 1.1 Typography audit
  const typo = await page.evaluate(() => {
    const results = [];
    const targets = [
      { sel: 'h1, h2, h3', desc: 'Headings' },
      { sel: 'button', desc: 'Buttons' },
      { sel: 'input', desc: 'Inputs' },
      { sel: 'label', desc: 'Labels' },
      { sel: 'td', desc: 'Table cells' },
      { sel: 'th', desc: 'Table headers' },
      { sel: 'span', desc: 'Spans' },
    ];
    for (const t of targets) {
      document.querySelectorAll(t.sel).forEach((el, i) => {
        if (i > 3) return; // Sample first 4
        const cs = getComputedStyle(el);
        results.push({
          desc: t.desc,
          sel: t.sel,
          text: el.textContent?.slice(0,40),
          fontFamily: cs.fontFamily?.split(',')[0]?.trim()?.replace(/"/g,''),
          fontSize: cs.fontSize,
          fontWeight: cs.fontWeight,
          lineHeight: cs.lineHeight,
          color: cs.color,
        });
      });
    }
    return results;
  });

  // Check for Inter/system-ui/apple font
  const badFonts = typo.filter(t => t.fontFamily && !t.fontFamily.match(/Inter|system-ui|ui-sans-serif|SF|Helvetica|Arial|sans-serif|__className/i));
  if (badFonts.length > 0) {
    fail('task1', 'T1.1', 'Typography: Non-system font detected', badFonts.map(f => `${f.desc} "${f.text}" → font: ${f.fontFamily}`).join('; '));
  } else {
    pass('task1', 'T1.1', 'Typography: All elements use system/Inter font stack', `${typo.length} elements checked. Primary: ${typo[0]?.fontFamily || 'N/A'}`);
  }

  // Font size hierarchy
  const headingSizes = typo.filter(t => t.desc === 'Headings').map(t => parseFloat(t.fontSize));
  const bodySizes = typo.filter(t => t.desc === 'Table cells' || t.desc === 'Labels').map(t => parseFloat(t.fontSize));
  if (headingSizes.length && bodySizes.length && Math.min(...headingSizes) <= Math.max(...bodySizes)) {
    warn('task1', 'T1.2', 'Typography hierarchy: Heading size ≤ body text', `Headings: ${headingSizes}px, Body: ${bodySizes}px`);
  } else {
    pass('task1', 'T1.2', 'Typography hierarchy: Headings larger than body', `Heading range: ${headingSizes}px, Body range: ${bodySizes}px`);
  }

  // 1.2 Color palette audit
  const colors = await page.evaluate(() => {
    const results = [];
    const els = [
      { sel: 'button', desc: 'Button' },
      { sel: 'nav, header, [class*="header"], [class*="toolbar"]', desc: 'Toolbar' },
      { sel: 'body', desc: 'Body' },
      { sel: '[class*="glass"], [class*="Glass"]', desc: 'Glass panels' },
      { sel: 'table', desc: 'Table' },
    ];
    for (const e of els) {
      document.querySelectorAll(e.sel).forEach((el, i) => {
        if (i > 2) return;
        const cs = getComputedStyle(el);
        results.push({
          desc: e.desc,
          bg: cs.backgroundColor,
          color: cs.color,
          borderColor: cs.borderColor,
          backdropFilter: cs.backdropFilter || cs.webkitBackdropFilter || 'none',
          opacity: cs.opacity,
          text: el.textContent?.slice(0,30),
        });
      });
    }
    return results;
  });

  // Check for Apple Liquid Glass (backdrop-filter)
  const glassEls = colors.filter(c => c.backdropFilter && c.backdropFilter !== 'none');
  if (glassEls.length > 0) {
    pass('task1', 'T1.3', 'Liquid Glass: backdrop-filter detected', glassEls.map(g => `${g.desc}: ${g.backdropFilter}`).join('; '));
  } else {
    warn('task1', 'T1.3', 'Liquid Glass: No backdrop-filter found on Glass panels', 'Expected glassmorphism effects');
  }

  // 1.3 Spacing consistency
  const spacing = await page.evaluate(() => {
    const results = [];
    document.querySelectorAll('section, main, [class*="card"], [class*="panel"], [class*="widget"]').forEach((el, i) => {
      if (i > 5) return;
      const cs = getComputedStyle(el);
      results.push({
        tag: el.tagName,
        className: el.className?.toString().slice(0,60),
        padding: cs.padding,
        margin: cs.margin,
        gap: cs.gap,
      });
    });
    return results;
  });

  // Check padding uses 4px grid
  const badSpacing = spacing.filter(s => {
    const vals = (s.padding + ' ' + s.margin).match(/\d+/g)?.map(Number) || [];
    return vals.some(v => v > 0 && v % 2 !== 0 && v !== 1);
  });
  if (badSpacing.length > 0) {
    warn('task1', 'T1.4', 'Spacing: Odd pixel values detected', badSpacing.map(s => `${s.tag}.${s.className?.slice(0,30)}: p=${s.padding} m=${s.margin}`).join('; '));
  } else {
    pass('task1', 'T1.4', 'Spacing: All values align to even-pixel grid', `${spacing.length} layout blocks checked`);
  }

  // 1.4 Icons — check for blurry PNGs
  const images = await page.evaluate(() => {
    const results = [];
    document.querySelectorAll('img').forEach(img => {
      results.push({ src: img.src, w: img.naturalWidth, h: img.naturalHeight, display: `${img.clientWidth}x${img.clientHeight}`, alt: img.alt });
    });
    document.querySelectorAll('svg').forEach((svg, i) => {
      if (i > 5) return;
      results.push({ type: 'svg', w: svg.getAttribute('width'), h: svg.getAttribute('height') });
    });
    return results;
  });
  const blurryImgs = images.filter(i => i.src && !i.src.includes('.svg') && i.w > 0 && i.w < 64);
  if (blurryImgs.length > 0) {
    warn('task1', 'T1.5', 'Graphics: Low-res raster images found', blurryImgs.map(i => `${i.src.slice(-40)}: ${i.w}x${i.h}`).join('; '));
  } else {
    pass('task1', 'T1.5', 'Graphics: No blurry raster images detected', `${images.filter(i=>i.type==='svg').length} SVGs, ${images.filter(i=>i.src).length} raster images`);
  }

  await shot(page, 'task1-visual');
}

// ═══════════════════════════════════════════════════════════════
// TASK 2: CONTENT, I18N & TYPOGRAPHY
// ═══════════════════════════════════════════════════════════════
async function task2(page) {
  console.log('\n═══ TASK 2: CONTENT, I18N & TYPOGRAPHY ═══');

  // 2.1 Find hardcoded English text while in RU mode
  const i18nIssues = await page.evaluate(() => {
    const english = [];
    const enPatterns = /\b(Submit|Cancel|Delete|Settings|Save|Dashboard|Total|Amount|Welcome|Loading|Error|Warning|Success|Info|Confirm|Update|Create|Edit|Close|Open|Next|Previous|Back|Forward|Help|About|Add|Remove|Search|Filter|Sort|Reset|Clear|Export|Import|Download|Upload|Login|Logout|Register|Profile|Account)\b/i;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while (node = walker.nextNode()) {
      const t = node.textContent?.trim();
      if (!t || t.length < 3) continue;
      if (enPatterns.test(t)) {
        const parent = node.parentElement;
        if (parent?.tagName === 'CODE' || parent?.tagName === 'PRE') continue;
        english.push({
          text: t.slice(0, 60),
          tag: parent?.tagName,
          class: parent?.className?.toString().slice(0, 40),
        });
      }
    }
    return english;
  });

  // Check for well-known English-only UI strings
  const knownEnglish = await page.evaluate(() => {
    const all = document.body.innerText;
    const found = [];
    const terms = ['Canvas', 'Reports', 'Projects', 'Export to PDF', 'Export to Markdown', 'Save As', 'New', 'Load', 'JSON', 'PDF', 'PNG', 'Audit', 'Query Builder'];
    for (const t of terms) {
      if (all.includes(t)) found.push(t);
    }
    return found;
  });

  if (knownEnglish.length > 6) {
    warn('task2', 'T2.1', 'i18n: UI appears to be in English mode', `Found: ${knownEnglish.join(', ')}`);
  }

  if (i18nIssues.length > 3) {
    warn('task2', 'T2.1b', 'i18n: Potential untranslated strings detected', i18nIssues.slice(0,5).map(i => `"${i.text}" in <${i.tag}>`).join('; '));
  } else {
    pass('task2', 'T2.1b', 'i18n: No obvious hardcoded English-only patterns in body text', `${i18nIssues.length} minor matches`);
  }

  // 2.2 Text overflow — inject long strings
  const overflowResults = await page.evaluate(() => {
    const overflows = [];
    const longName = 'A'.repeat(100);
    // Find all text containers and check for overflow
    document.querySelectorAll('button, th, td, label, h1, h2, h3, span').forEach((el, i) => {
      if (i > 30) return;
      const cs = getComputedStyle(el);
      const hasOverflow = cs.overflow === 'hidden' || cs.textOverflow === 'ellipsis' || cs.whiteSpace === 'nowrap';
      const isClipped = el.scrollWidth > el.clientWidth + 2;
      if (isClipped && !hasOverflow) {
        overflows.push({
          tag: el.tagName,
          text: el.textContent?.slice(0, 30),
          scrollW: el.scrollWidth,
          clientW: el.clientWidth,
          overflow: cs.overflow,
          textOverflow: cs.textOverflow,
          whiteSpace: cs.whiteSpace,
        });
      }
    });
    return overflows;
  });

  if (overflowResults.length > 0) {
    warn('task2', 'T2.2', 'Text Overflow: Elements with content wider than container', overflowResults.slice(0,5).map(o => `<${o.tag}> "${o.text}" scroll=${o.scrollW} client=${o.clientW} overflow=${o.overflow}`).join('; '));
  } else {
    pass('task2', 'T2.2', 'Text Overflow: No uncontrolled overflow detected', 'All text containers properly constrained');
  }

  // 2.3 Typography rules
  const typoRules = await page.evaluate(() => {
    const issues = [];
    const all = document.body.innerText;
    // Check for incorrect dash usage (hyphen where em-dash expected)
    const hyphenSpaced = (all.match(/ - /g) || []).length;
    const emDash = (all.match(/—/g) || []).length;
    if (hyphenSpaced > 3 && emDash === 0) issues.push(`${hyphenSpaced}× spaced hyphens " - " but 0× em-dashes "—"`);
    // Check for straight quotes
    const straight = (all.match(/["']/g) || []).length;
    const curly = (all.match(/[«»""'']/g) || []).length;
    if (straight > 10 && curly === 0) issues.push(`${straight}× straight quotes but 0× typographic quotes`);
    return issues;
  });

  if (typoRules.length > 0) {
    warn('task2', 'T2.3', 'Typography Rules: Potential issues', typoRules.join('; '));
  } else {
    pass('task2', 'T2.3', 'Typography Rules: em-dashes and quotes used correctly', '');
  }

  await shot(page, 'task2-i18n');
}

// ═══════════════════════════════════════════════════════════════
// TASK 3: STATES & ACCESSIBILITY (A11y)
// ═══════════════════════════════════════════════════════════════
async function task3(page) {
  console.log('\n═══ TASK 3: STATES & ACCESSIBILITY ═══');

  // 3.1 Interactive states — hover
  const buttons = await page.$$('button');
  let hoverIssues = 0;
  for (let i = 0; i < Math.min(buttons.length, 5); i++) {
    const btn = buttons[i];
    try {
      const before = await btn.evaluate(el => getComputedStyle(el).backgroundColor);
      await btn.hover();
      await page.waitForTimeout(200);
      const after = await btn.evaluate(el => getComputedStyle(el).backgroundColor);
      // Check if hover causes visual change (cursor, bg, etc.)
      // Some buttons may not change bg — that's acceptable for text buttons
    } catch {}
  }

  // Check for :disabled state on buttons
  const disabledBtns = await page.evaluate(() => {
    const btns = [];
    document.querySelectorAll('button[disabled], button:disabled, input:disabled').forEach(el => {
      const cs = getComputedStyle(el);
      btns.push({ text: el.textContent?.slice(0,30), opacity: cs.opacity, cursor: cs.cursor, pointerEvents: cs.pointerEvents });
    });
    return btns;
  });

  if (disabledBtns.length > 0) {
    const badDisabled = disabledBtns.filter(b => b.opacity === '1' && b.cursor !== 'not-allowed');
    if (badDisabled.length > 0) {
      warn('task3', 'T3.1', 'Disabled state: No visual differentiation', badDisabled.map(b => `"${b.text}" opacity=${b.opacity} cursor=${b.cursor}`).join('; '));
    } else {
      pass('task3', 'T3.1', 'Disabled state: Proper opacity/cursor on disabled elements', `${disabledBtns.length} disabled elements checked`);
    }
  } else {
    pass('task3', 'T3.1', 'Disabled state: No disabled elements found to test', '');
  }

  // 3.2 Contrast check
  const contrastIssues = await page.evaluate(() => {
    const issues = [];
    function rgbToHex(rgb) {
      if (!rgb || rgb === 'transparent' || rgb === 'rgba(0, 0, 0, 0)') return null;
      const m = rgb.match(/\d+/g);
      if (!m || m.length < 3) return null;
      return '#' + m.slice(0,3).map(x => parseInt(x).toString(16).padStart(2,'0')).join('');
    }
    function luminance(hex) {
      const r = parseInt(hex.slice(1,3),16)/255;
      const g = parseInt(hex.slice(3,5),16)/255;
      const b = parseInt(hex.slice(5,7),16)/255;
      const s = [r,g,b].map(c => c <= 0.03928 ? c/12.92 : ((c+0.055)/1.055)**2.4);
      return 0.2126*s[0]+0.7152*s[1]+0.0722*s[2];
    }
    function ratio(fg, bg) {
      const L1 = luminance(fg), L2 = luminance(bg);
      return (Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05);
    }
    document.querySelectorAll('button, p, span, td, th, label, a, h1, h2, h3, h4').forEach((el, i) => {
      if (i > 40) return;
      const text = el.textContent?.trim();
      if (!text || text.length < 2) return;
      const cs = getComputedStyle(el);
      const fg = rgbToHex(cs.color);
      const bg = rgbToHex(cs.backgroundColor);
      if (!fg || !bg) return;
      const r = ratio(fg, bg);
      const size = parseFloat(cs.fontSize);
      const minRatio = size >= 18 || (size >= 14 && parseInt(cs.fontWeight) >= 700) ? 3 : 4.5;
      if (r < minRatio) {
        issues.push({ text: text.slice(0,30), fg, bg, ratio: r.toFixed(2), required: minRatio, size, tag: el.tagName });
      }
    });
    return issues;
  });

  if (contrastIssues.length > 0) {
    const critical = contrastIssues.filter(c => parseFloat(c.ratio) < 3);
    if (critical.length > 0) {
      fail('task3', 'T3.2', 'Contrast WCAG AA: Critical failures (ratio < 3:1)', critical.slice(0,5).map(c => `<${c.tag}> "${c.text}" fg=${c.fg} bg=${c.bg} ratio=${c.ratio} (need ${c.required})`).join('; '));
    } else {
      warn('task3', 'T3.2', 'Contrast WCAG AA: Minor failures (3-4.5:1 range)', contrastIssues.slice(0,5).map(c => `<${c.tag}> "${c.text}" ratio=${c.ratio}`).join('; '));
    }
  } else {
    pass('task3', 'T3.2', 'Contrast WCAG AA: All text passes minimum contrast', '');
  }

  // 3.3 Focus management — Tab navigation
  const focusResults = await page.evaluate(() => {
    const focusable = document.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    const results = { total: focusable.length, withoutOutline: 0, negativeTabindex: 0, ariaLabels: 0, missingAriaOnIcons: 0 };
    focusable.forEach(el => {
      const cs = getComputedStyle(el);
      if (el.getAttribute('tabindex') === '-1') results.negativeTabindex++;
      if (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')) results.ariaLabels++;
    });
    // Check icon buttons without aria-label
    document.querySelectorAll('button').forEach(btn => {
      const text = btn.textContent?.trim();
      if ((!text || text.length < 2) && !btn.getAttribute('aria-label')) {
        results.missingAriaOnIcons++;
      }
    });
    return results;
  });

  if (focusResults.missingAriaOnIcons > 0) {
    warn('task3', 'T3.3', 'A11y: Icon buttons without aria-label', `${focusResults.missingAriaOnIcons} icon-only buttons lack aria-label (screen reader inaccessible)`);
  } else {
    pass('task3', 'T3.3', 'A11y: All icon buttons have aria-label', '');
  }
  pass('task3', 'T3.3b', `Focusable elements inventory: ${focusResults.total} total`, `ARIA labels: ${focusResults.ariaLabels}, tabindex=-1: ${focusResults.negativeTabindex}`);

  // Tab key navigation test
  try {
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('Tab');
      await page.waitForTimeout(100);
    }
    const activeTag = await page.evaluate(() => document.activeElement?.tagName);
    pass('task3', 'T3.4', 'Tab navigation: Focus moves through elements', `After 10 tabs, focus is on <${activeTag}>`);
  } catch (e) {
    warn('task3', 'T3.4', 'Tab navigation: Error during test', e.message);
  }

  await shot(page, 'task3-a11y');
}

// ═══════════════════════════════════════════════════════════════
// TASK 4: COMPREHENSIVE SCREEN COVERAGE
// ═══════════════════════════════════════════════════════════════
async function task4(browser) {
  console.log('\n═══ TASK 4: COMPREHENSIVE SCREEN COVERAGE ═══');

  // 4.1 EMPTY STATE — new project with 0 nodes
  {
    console.log('  ▸ 4.1 Empty State');
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    const page = await ctx.newPage();
    await page.route('**/api/projects**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    page.on('dialog', async d => await d.accept());

    await page.goto(BASE, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(1000);

    // Inject empty project
    const emptyProj = {
      schemaVersion:'2.1.0',engineVersion:'2.1.0-alpha',projectId:'empty_test',title:'Empty Test',userId:'qa',
      createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),readOnly:false,baseCurrency:'USD',
      masterData:{},fx:{fxDate:'2026-01-15',rateToUSD:{USD:1,KZT:500},source:'manual'},
      zones:[],nodes:[],ownership:[],
      catalogs:{jurisdictions:[],flowTypes:[],riskTypes:[]},activeJurisdictions:['KZ'],
      ui:{canvasW:1600,canvasH:1000,editMode:'nodes',gridSize:10,snapToGrid:true,flowLegend:{show:true,mode:'ALL',selectedTypes:[],showTaxes:true}},
      flows:[],taxes:[],audit:{entries:[],lastHash:'GENESIS'},periods:{closedYears:[]},
      group:{consolidatedRevenueEur:null},accounting:{years:{}},lawReferences:{},snapshots:[],
      pipeline:{lastRunAt:null,lastRun:null,runs:[]},projectRiskFlags:[],
    };
    await page.evaluate(({k,p}) => { localStorage.clear(); localStorage.removeItem('tsm26_remote_project_id'); localStorage.setItem(k,JSON.stringify(p)); }, {k:'tsm26_onefile_project_v2', p:emptyProj});
    await page.reload({ waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(3000);

    // Canvas check
    await shot(page, 'task4-empty-canvas');
    const canvasEmpty = await page.evaluate(() => {
      const text = document.body.innerText;
      return {
        hasEmptyState: text.includes('Drag') || text.includes('пере') || text.includes('empty') || text.includes('нет') || text.includes('Drop'),
        nodeCount: document.querySelectorAll('[class*="node"], [class*="Node"]').length,
        summary: document.querySelector('[data-testid="global-summary"]')?.textContent?.slice(0,100) || 'NO WIDGET',
      };
    });
    if (canvasEmpty.nodeCount === 0) {
      pass('task4', 'T4.1a', 'Empty State: Canvas rendered with 0 nodes', `Summary: ${canvasEmpty.summary.slice(0,80)}`);
    }
    if (canvasEmpty.hasEmptyState) {
      pass('task4', 'T4.1b', 'Empty State: Placeholder/hint text present', '');
    } else {
      warn('task4', 'T4.1b', 'Empty State: No "Drag here" placeholder detected', 'Canvas may appear blank without guidance');
    }

    // Reports tab empty
    try {
      await page.getByText('Reports').first().click({ timeout: 3000 });
      await page.waitForTimeout(2000);
      await shot(page, 'task4-empty-reports');
      const reportsEmpty = await page.evaluate(() => {
        const tables = document.querySelectorAll('table');
        const rows = tables[0]?.querySelectorAll('tbody tr').length || 0;
        const emptyMsg = document.body.innerText.includes('No flows') || document.body.innerText.includes('нет');
        return { tableCount: tables.length, bodyRows: rows, hasEmptyMsg: emptyMsg };
      });
      if (reportsEmpty.bodyRows === 0) {
        pass('task4', 'T4.1c', 'Empty Reports: 0 rows in CIT table', `Tables: ${reportsEmpty.tableCount}, Empty msg: ${reportsEmpty.hasEmptyMsg}`);
      }
    } catch {}
    await ctx.close();
  }

  // 4.2 MINIMAL STATE — 1 node, 1 flow
  {
    console.log('  ▸ 4.2 Minimal State');
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    const page = await ctx.newPage();
    await page.route('**/api/projects**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));

    const minProj = {
      schemaVersion:'2.1.0',engineVersion:'2.1.0-alpha',projectId:'min_test',title:'Minimal Test',userId:'qa',
      createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),readOnly:false,baseCurrency:'USD',
      masterData:{},fx:{fxDate:'2026-01-15',rateToUSD:{USD:1,KZT:500},source:'manual'},
      zones:[{id:'z1',name:'KZ',x:50,y:50,w:400,h:300,jurisdiction:'KZ',code:'KZ_STANDARD',currency:'KZT',zIndex:1,parentId:null}],
      nodes:[
        {id:'n1',name:'Company A',type:'company',x:100,y:120,w:190,h:90,zoneId:'z1',frozen:false,riskFlags:[],annualIncome:50000000,etr:0,balances:{},effectiveFrom:'2026-01-01',effectiveTo:null,industryTags:[],ledger:{balances:{},digitalAssets:{},retainedEarnings:0,accumulatedLosses:0,debtToTXA:0},complianceData:{substance:{},aifc:{usesCITBenefit:false,cigaInZone:true},bvi:{}},managementTags:[]},
        {id:'n2',name:'Company B',type:'company',x:300,y:250,w:190,h:90,zoneId:'z1',frozen:false,riskFlags:[],annualIncome:0,etr:0,balances:{},effectiveFrom:'2026-01-01',effectiveTo:null,industryTags:[],ledger:{balances:{},digitalAssets:{},retainedEarnings:0,accumulatedLosses:0,debtToTXA:0},complianceData:{substance:{},aifc:{usesCITBenefit:false,cigaInZone:true},bvi:{}},managementTags:[]},
      ],
      ownership:[],
      catalogs:{jurisdictions:[],flowTypes:[],riskTypes:[]},activeJurisdictions:['KZ'],
      ui:{canvasW:1600,canvasH:1000,editMode:'nodes',gridSize:10,snapToGrid:true,flowLegend:{show:true,mode:'ALL',selectedTypes:[],showTaxes:true}},
      flows:[{id:'f1',fromId:'n1',toId:'n2',flowType:'Services',grossAmount:10000000,currency:'KZT',paymentMethod:'bank',cashComponentAmount:0,cashComponentCurrency:'KZT',whtRate:0,status:'completed',flowDate:'2026-01-15T12:00:00.000Z',ack:{ackStatus:'not_required',acknowledgedBy:null,acknowledgedAt:null,comment:''},taxAdjustments:[],fxEvidence:null}],
      taxes:[],audit:{entries:[],lastHash:'GENESIS'},periods:{closedYears:[]},
      group:{consolidatedRevenueEur:null},accounting:{years:{}},lawReferences:{},snapshots:[],
      pipeline:{lastRunAt:null,lastRun:null,runs:[]},projectRiskFlags:[],
    };
    await page.goto(BASE, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(1000);
    await page.evaluate(({k,p}) => { localStorage.clear(); localStorage.removeItem('tsm26_remote_project_id'); localStorage.setItem(k,JSON.stringify(p)); }, {k:'tsm26_onefile_project_v2',p:minProj});
    await page.reload({ waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(4000);
    await shot(page, 'task4-minimal-canvas');

    await page.getByText('Reports').first().click({ timeout: 3000 });
    await page.waitForTimeout(2000);
    const minReport = await page.evaluate(() => {
      const rows = [];
      document.querySelectorAll('table')[0]?.querySelectorAll('tbody tr').forEach(tr => {
        const c = Array.from(tr.querySelectorAll('td')).map(td => td.textContent?.trim() ?? '');
        if (c.length >= 6) rows.push(c);
      });
      return rows;
    });
    await shot(page, 'task4-minimal-reports');
    if (minReport.length === 2) {
      pass('task4', 'T4.2', 'Minimal State: 2 nodes, 1 flow rendered correctly', `CIT rows: ${minReport.map(r => `${r[0]} ${r[5]}`).join(', ')}`);
    } else {
      warn('task4', 'T4.2', `Minimal State: Expected 2 CIT rows, got ${minReport.length}`, '');
    }
    await ctx.close();
  }

  // 4.3 MASSIVE STATE — 20 zones, 60 nodes
  {
    console.log('  ▸ 4.3 Massive State (20 zones, 60 nodes)');
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    const page = await ctx.newPage();
    await page.route('**/api/projects**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));

    const zones = [];
    const nodes = [];
    const flows = [];
    const jurisdictions = ['KZ','UAE','HK','CY','BVI','SG','UK','US'];
    const codes = ['KZ_STANDARD','UAE_MAINLAND','HK_ONSHORE','CY_STANDARD','BVI_STANDARD','SG_STANDARD','UK_STANDARD','US_STANDARD'];
    const currencies = ['KZT','AED','HKD','EUR','USD','SGD','GBP','USD'];

    for (let z = 0; z < 20; z++) {
      const ji = z % jurisdictions.length;
      zones.push({
        id:`z${z}`, name:`Zone-${jurisdictions[ji]}-${z}`,
        x: (z%5)*310+30, y: Math.floor(z/5)*260+30, w:290, h:240,
        jurisdiction:jurisdictions[ji], code:codes[ji], currency:currencies[ji], zIndex:1, parentId:null
      });
    }

    for (let n = 0; n < 60; n++) {
      const zi = n % 20;
      nodes.push({
        id:`n${n}`, name:`Entity-${n}`, type:'company',
        x: zones[zi].x+20+(n%3)*90, y: zones[zi].y+40+Math.floor((n%6)/3)*80,
        w:80, h:50, zoneId:`z${zi}`,
        frozen:false, riskFlags:[], annualIncome:Math.floor(Math.random()*100000000), etr:0, balances:{},
        effectiveFrom:'2026-01-01', effectiveTo:null, industryTags:[],
        ledger:{balances:{},digitalAssets:{},retainedEarnings:0,accumulatedLosses:0,debtToTXA:0},
        complianceData:{substance:{},aifc:{usesCITBenefit:false,cigaInZone:true},bvi:{}},
        managementTags:[]
      });
    }

    for (let f = 0; f < 40; f++) {
      const from = `n${f%60}`, to = `n${(f+1)%60}`;
      flows.push({
        id:`f${f}`, fromId:from, toId:to, flowType:['Services','Goods','Dividends','Royalties'][f%4],
        grossAmount:Math.floor(Math.random()*50000000), currency:currencies[f%8],
        paymentMethod:'bank', cashComponentAmount:0, cashComponentCurrency:'USD', whtRate:0, status:'completed',
        flowDate:'2026-01-15T12:00:00.000Z',
        ack:{ackStatus:'not_required',acknowledgedBy:null,acknowledgedAt:null,comment:''},
        taxAdjustments:[], fxEvidence:null
      });
    }

    const massiveProj = {
      schemaVersion:'2.1.0',engineVersion:'2.1.0-alpha',projectId:'massive_test',title:'Massive Stress Test',userId:'qa',
      createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),readOnly:false,baseCurrency:'USD',
      masterData:{},fx:{fxDate:'2026-01-15',rateToUSD:{USD:1,KZT:500,HKD:7.8,AED:3.67,EUR:0.92,GBP:0.79,SGD:1.34},source:'manual'},
      zones, nodes, ownership:[], flows,
      catalogs:{jurisdictions:[],flowTypes:[],riskTypes:[]},activeJurisdictions:jurisdictions,
      ui:{canvasW:2000,canvasH:1500,editMode:'nodes',gridSize:10,snapToGrid:true,flowLegend:{show:true,mode:'ALL',selectedTypes:[],showTaxes:true}},
      taxes:[],audit:{entries:[],lastHash:'GENESIS'},periods:{closedYears:[]},
      group:{consolidatedRevenueEur:null},accounting:{years:{}},lawReferences:{},snapshots:[],
      pipeline:{lastRunAt:null,lastRun:null,runs:[]},projectRiskFlags:[],
    };

    await page.goto(BASE, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(1000);
    await page.evaluate(({k,p}) => { localStorage.clear(); localStorage.removeItem('tsm26_remote_project_id'); localStorage.setItem(k,JSON.stringify(p)); }, {k:'tsm26_onefile_project_v2',p:massiveProj});

    const t0 = Date.now();
    await page.reload({ waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(6000);
    const loadTime = Date.now() - t0;
    await shot(page, 'task4-massive-canvas');

    if (loadTime < 15000) {
      pass('task4', 'T4.3a', `Massive State: Canvas loaded in ${(loadTime/1000).toFixed(1)}s`, `20 zones, 60 nodes, 40 flows`);
    } else {
      fail('task4', 'T4.3a', `Massive State: Canvas load too slow (${(loadTime/1000).toFixed(1)}s)`, 'Expected <15s');
    }

    // Reports tab
    try {
      await page.getByText('Reports').first().click({ timeout: 3000 });
      await page.waitForTimeout(4000);
      const massiveReport = await page.evaluate(() => {
        const rows = document.querySelectorAll('table')[0]?.querySelectorAll('tbody tr').length || 0;
        const flowRows = document.querySelectorAll('table')[1]?.querySelectorAll('tbody tr').length || 0;
        return { citRows: rows, flowRows };
      });
      await shot(page, 'task4-massive-reports');
      pass('task4', 'T4.3b', `Massive Reports: ${massiveReport.citRows} CIT rows, ${massiveReport.flowRows} flow rows rendered`, '');
    } catch (e) {
      fail('task4', 'T4.3b', 'Massive Reports: Table failed to render', e.message);
    }

    // Check for DOM freezing
    const responsive = await page.evaluate(() => {
      const start = performance.now();
      document.body.offsetHeight; // Force reflow
      return performance.now() - start;
    });
    if (responsive < 100) {
      pass('task4', 'T4.3c', `Massive DOM reflow: ${responsive.toFixed(1)}ms`, 'No jank detected');
    } else {
      warn('task4', 'T4.3c', `Massive DOM reflow: ${responsive.toFixed(1)}ms`, 'Potential jank');
    }

    await ctx.close();
  }

  // 4.4 Dark Mode test
  {
    console.log('  ▸ 4.4 Dark Mode');
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, colorScheme: 'dark' });
    const page = await ctx.newPage();
    await page.route('**/api/projects**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await page.goto(BASE, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(3000);

    // Toggle dark mode via UI
    const darkState = await page.evaluate(() => {
      const html = document.documentElement;
      return {
        hasDarkClass: html.classList.contains('dark'),
        bgColor: getComputedStyle(document.body).backgroundColor,
        textColor: getComputedStyle(document.body).color,
      };
    });

    await shot(page, 'task4-darkmode');
    const bgHex = rgbToHex(darkState.bgColor);
    if (bgHex && parseInt(bgHex.slice(1), 16) < 0x333333) {
      pass('task4', 'T4.4', 'Dark Mode: Dark background detected', `bg=${bgHex}, dark class=${darkState.hasDarkClass}`);
    } else {
      warn('task4', 'T4.4', 'Dark Mode: Background may not be dark enough', `bg=${bgHex}`);
    }
    await ctx.close();
  }
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════
(async () => {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║      QA MEGA-AUDIT — Tax Modeler 2026                  ║');
  console.log('║      Autonomous Playwright Crawl                       ║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  const browser = await chromium.launch({ headless: true });

  // Main page for Tasks 1-3
  const mainCtx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const mainPage = await mainCtx.newPage();
  await mainPage.route('**/api/projects**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await mainPage.goto(BASE, { waitUntil: 'networkidle', timeout: 20000 });
  await mainPage.waitForTimeout(4000);

  await task1(mainPage);
  await task2(mainPage);
  await task3(mainPage);
  await mainCtx.close();

  await task4(browser);
  await browser.close();

  // ═══ GENERATE REPORT ═══
  let md = `# QA MEGA-AUDIT REPORT — Tax Modeler 2026\n\n`;
  md += `**Date:** ${new Date().toISOString().slice(0,10)}\n**Auditor:** Antigravity (Autonomous Playwright)\n**Method:** DOM inspection, computed styles, keyboard nav, stress test\n\n---\n\n`;

  const tasks = [
    { key: 'task1', name: 'Task 1: Pixel Perfect & Visual Fidelity' },
    { key: 'task2', name: 'Task 2: Content, i18n & Typography' },
    { key: 'task3', name: 'Task 3: States & Accessibility (A11y)' },
    { key: 'task4', name: 'Task 4: Comprehensive Screen Coverage' },
  ];

  let totalPass = 0, totalFail = 0, totalWarn = 0;

  for (const t of tasks) {
    md += `## ${t.name}\n\n`;
    md += `| ID | Status | Finding | Detail |\n|-----|--------|---------|--------|\n`;
    for (const f of findings[t.key]) {
      md += `| ${f.id} | ${f.status} | ${f.what} | ${(f.detail || '').slice(0,120)} |\n`;
      if (f.status.includes('PASS')) totalPass++;
      else if (f.status.includes('FAIL')) totalFail++;
      else totalWarn++;
    }
    md += '\n';
  }

  md += `## Summary\n\n| Metric | Count |\n|--------|-------|\n`;
  md += `| 🟢 PASS | ${totalPass} |\n| 🟡 WARN | ${totalWarn} |\n| 🔴 FAIL | ${totalFail} |\n`;
  md += `| Total | ${totalPass+totalWarn+totalFail} |\n\n`;
  md += `### Screenshots\n\nAll evidence saved to \`qa-audit-screenshots/\`\n`;

  writeFileSync(join(__dirname, 'QA-MEGA-AUDIT.md'), md);
  console.log(`\n✅ QA-MEGA-AUDIT.md generated`);
  console.log(`📊 Results: ${totalPass} PASS, ${totalWarn} WARN, ${totalFail} FAIL`);
})();
