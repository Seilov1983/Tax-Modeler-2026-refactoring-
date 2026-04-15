/**
 * DEV-ONLY: inject a JS snippet to patch the localStorage project on page load.
 * Returns a small HTML page that patches localStorage and redirects to /.
 * This is a development tool — remove before production.
 */

import { NextResponse } from 'next/server';

export async function GET() {
  const patchScript = `
<!DOCTYPE html>
<html>
<head><title>Patching...</title></head>
<body>
<pre id="log">Running patch...</pre>
<script>
const log = (msg) => { document.getElementById('log').textContent += '\\n' + msg; console.log(msg); };
try {
  const raw = localStorage.getItem('tsm26_onefile_project_v2');
  if (!raw) { log('No project in localStorage'); } else {
    const p = JSON.parse(raw);
    // 1. Fix double-prefix zone codes (KZ_KZ_HUB → KZ_HUB)
    let fixedZones = 0;
    p.zones.forEach(z => {
      const fixed = z.code.replace(/^([A-Z]+)_\\1_/, '$1_');
      if (fixed !== z.code) { log('Zone fix: ' + z.code + ' -> ' + fixed); z.code = fixed; fixedZones++; }
    });
    log('Zone codes fixed: ' + fixedZones);
    log('All zone codes: ' + p.zones.map(z => z.code).join(', '));
    
    // 2. Enable isIPIncome + hasSubstance on IT node
    const it = p.nodes.find(n => n.name === 'IT');
    if (it) {
      it.isIPIncome = true;
      it.hasSubstance = true;
      it.nexusParams = { rUp: 4500000, rOut1: 300000, rOut2: 0, rAcq: 0 };
      it.substanceMetrics = { headcount: 15, operationalExpenses: 8000000, payrollCosts: 3500000 };
      log('IT node patched: isIPIncome=' + it.isIPIncome + ', nexusParams=' + JSON.stringify(it.nexusParams));
    } else {
      log('WARNING: IT node not found. Nodes: ' + p.nodes.map(n => n.name).join(', '));
    }
    localStorage.setItem('tsm26_onefile_project_v2', JSON.stringify(p));
    log('SAVED. Redirecting to app in 2 seconds...');
    setTimeout(() => { window.location.href = '/'; }, 2000);
  }
} catch(e) { log('ERROR: ' + e.message); }
<\/script>
</body>
</html>
`;

  return new NextResponse(patchScript, {
    headers: { 'Content-Type': 'text/html' },
  });
}
