import { uid, nowIso, isoDate, bankersRound2, numOrNull, formatMoney, deepMerge } from './utils.js';
import { auditAppend, save, SCHEMA_VERSION, ENGINE_VERSION } from './state.js';

export function defaultLawReferences(){
  return {
    APP_G_G1_BVI_SUBSTANCE: { title: "Appendix G · G1 (BVI Substance)", version: "2026-01", effectiveFrom: "2026-01-01" },
    APP_G_G3_CY_DEFENSIVE: { title: "Appendix G · G3 (Cyprus Defensive Measures)", version: "2026-01", effectiveFrom: "2026-01-01" },
    APP_G_G4_AIFC_PRESENCE: { title: "Appendix G · G4 (AIFC Presence / CIGA)", version: "2026-01", effectiveFrom: "2026-01-01" },
    APP_G_G5_PILLAR2: { title: "Appendix G · G5 (Pillar Two / Top-up Tax)", version: "2026-01", effectiveFrom: "2026-01-01" },
    APP_G_G6_INVEST_RES: { title: "Appendix G · G6 (Investment Resident)", version: "2026-01", effectiveFrom: "2026-01-01" },
    AFSA_CLOSED_PERIOD_2026: { title: "AFSA 2026 · Closed Period Rules", version: "2026-01-01", effectiveFrom: "2026-01-01" }
  };
}

export function defaultProject(){
  const zones = makeZones();
  const nodes = [
    makeNode("KZ Company", "company", 240, 150),
    makeNode("HK Company", "company", 700, 360),
    makeNode("UAE Company", "company", 760, 160),
    makeNode("Person KZ", "person", 120, 360),
  ];
  nodes.forEach(n => {
    n.balances = { KZT: 10_000_000, HKD: 200_000, AED: 200_000, USD: 20_000, EUR: 10_000, GBP: 10_000, SGD: 10_000 };
    n.annualIncome = 1_000_000;
    n.etr = 0.2;
    if (n.type === "person") {
      n.citizenship = ["KZ"];
    }
  });
  zones.forEach(z => nodes.push(makeTXA(z)));
  const ownership = [
    { id:"o_"+uid(), fromId: nodes.find(n=>n.name==="Person KZ").id, toId: nodes.find(n=>n.name==="KZ Company").id, percent: 100, manualAdjustment: 0 },
    { id:"o_"+uid(), fromId: nodes.find(n=>n.name==="KZ Company").id, toId: nodes.find(n=>n.name==="HK Company").id, percent: 100, manualAdjustment: 0 },
  ];
  const p = {
    schemaVersion: SCHEMA_VERSION,
    engineVersion: ENGINE_VERSION,
    projectId: "demo_" + uid(),
    title: "Demo Project",
    userId: "user_demo",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    readOnly: false,
    masterData: defaultMasterData(),
    fx: {
      fxDate: "2026-01-15",
      rateToKZT: { KZT: 1, USD: 500, HKD: 64, AED: 136, EUR: 540, GBP: 620, SGD: 370 },
      source: "manual (NBRK reference)"
    },
    zones,
    nodes,
    ownership,
    catalogs: defaultCatalogs(),
    activeJurisdictions: defaultCatalogs().jurisdictions.filter(j=>j.enabled).map(j=>j.id),
    ui: { canvasW: 1400, canvasH: 1000, editMode: "nodes", gridSize: 10, snapToGrid: true, flowLegend: { show: true, mode: "ALL", selectedTypes: [], showTaxes: true } },
    flows: [],
    taxes: [],
    audit: {
      entries: [],
      lastHash: "GENESIS"
    },
    periods: { closedYears: [] },
    group: { consolidatedRevenueEur: null },
    accounting: { years: {} },
    lawReferences: defaultLawReferences(),
    snapshots: [],
    pipeline: { lastRunAt: null, lastRun: null, runs: [] },
    projectRiskFlags: []
  };
  ensureMasterData(p);
  ensureZoneTaxDefaults(p);
  bootstrapNormalizeZones(p);
  recomputeRisks(p);
  // Сдвигаем весь демо-проект в центр холста (2000, 2000)
  p.zones.forEach(z => { z.x += 2000; z.y += 2000; });
  p.nodes.forEach(n => { n.x += 2000; n.y += 2000; });
  return p;
}

export function makeZones(){
  const zones = [];
  let z = (id, name, x,y,w,h, jurisdiction, code, currency, zIndex=1) => ({
    id, name, x,y,w,h, jurisdiction, code, currency, zIndex
  });
  zones.push(z("KZ_STD", "Kazakhstan — Standard (KZT)", 70, 70, 520, 380, "KZ", "KZ_STANDARD", "KZT", 1));
  zones.push(z("KZ_AIFC", "KZ — AIFC (qualifying services) (KZT)", 120, 110, 260, 190, "KZ", "KZ_AIFC", "KZT", 2));
  zones.push(z("KZ_HUB", "KZ — Astana Hub (ICT priority) (KZT)", 320, 210, 230, 170, "KZ", "KZ_HUB", "KZT", 3));
  zones.push(z("UAE_ML", "UAE — Mainland (AED)", 640, 70, 220, 220, "UAE", "UAE_MAINLAND", "AED", 1));
  zones.push(z("UAE_FZ_Q", "UAE — Free Zone (QFZP, qualifying) (AED)", 870, 70, 210, 105, "UAE", "UAE_FREEZONE_QFZP", "AED", 2));
  zones.push(z("UAE_FZ_NQ", "UAE — Free Zone (non-QFZP / non-qualifying) (AED)", 870, 185, 210, 105, "UAE", "UAE_FREEZONE_NONQFZP", "AED", 1));
  zones.push(z("HK_ON", "Hong Kong — Onshore (HKD)", 640, 310, 220, 210, "HK", "HK_ONSHORE", "HKD", 1));
  zones.push(z("HK_OFF", "Hong Kong — Offshore deal (claim) (HKD)", 870, 310, 210, 210, "HK", "HK_OFFSHORE", "HKD", 2));
  zones.push(z("CY_STD", "Cyprus (EUR)", 70, 470, 260, 200, "CY", "CY_STANDARD", "EUR", 1));
  zones.push(z("SG_STD", "Singapore (SGD)", 350, 470, 260, 200, "SG", "SG_STANDARD", "SGD", 1));
  zones.push(z("UK_STD", "United Kingdom (GBP)", 640, 540, 220, 130, "UK", "UK_STANDARD", "GBP", 1));
  zones.push(z("US_DE", "US — Delaware (USD)", 880, 540, 200, 130, "US", "US_DE", "USD", 1));
  zones.push(z("BVI", "BVI (USD)", 70, 690, 260, 170, "BVI", "BVI_STANDARD", "USD", 1));
  zones.push(z("CAY", "Cayman (USD)", 350, 690, 260, 170, "CAY", "CAY_STANDARD", "USD", 1));
  zones.push(z("SEY", "Seychelles (USD)", 640, 690, 440, 170, "SEY", "SEY_STANDARD", "USD", 1));
  return zones;
}

export function emptyProject(){
  const cat = defaultCatalogs();
  cat.jurisdictions = []; 
  const p = {
    schemaVersion: SCHEMA_VERSION,
    engineVersion: ENGINE_VERSION,
    projectId: "proj_" + uid(),
    title: "New Project",
    userId: "user_" + uid(),
    createdAt: nowIso(),
    updatedAt: nowIso(),
    readOnly: false,
    masterData: {},
    fx: {
      fxDate: isoDate(nowIso()),
      rateToKZT: { KZT: 1, USD: 500, EUR: 540, RUB: 5 },
      source: "manual"
    },
    zones: [], nodes: [], ownership: [], catalogs: cat, activeJurisdictions: [], 
    ui: { canvasW: 1400, canvasH: 1000, editMode: "zones", gridSize: 10, snapToGrid: true, hiddenZoneIds: [], flowLegend: { show: true, mode: "ALL", selectedTypes: [], showTaxes: true } },
    flows: [], taxes: [], audit: { entries: [], lastHash: "GENESIS" },
    periods: { closedYears: [] }, group: { consolidatedRevenueEur: null }, accounting: { years: {} },
    lawReferences: defaultLawReferences(), snapshots: [], pipeline: { lastRunAt: null, lastRun: null, runs: [] }, projectRiskFlags: []
  };
  ensureMasterData(p);
  ensureZoneTaxDefaults(p);
  return p;
}

export function defaultCatalogs(){
  return {
    jurisdictions: [
      { id:"KZ", name:"Kazakhstan", enabled:true },
      { id:"UAE", name:"UAE", enabled:true },
      { id:"HK", name:"Hong Kong", enabled:true },
      { id:"CY", name:"Cyprus", enabled:true },
      { id:"SG", name:"Singapore", enabled:true },
      { id:"UK", name:"United Kingdom", enabled:true },
      { id:"US", name:"US (Delaware)", enabled:true },
      { id:"BVI", name:"BVI", enabled:true },
      { id:"CAY", name:"Cayman", enabled:true },
      { id:"SEY", name:"Seychelles", enabled:true }
    ],
    flowTypes: [
      { id:"Services", name:"Services", enabled:true },
      { id:"Dividends", name:"Dividends", enabled:true },
      { id:"Royalties", name:"Royalties", enabled:true },
      { id:"Interest", name:"Interest", enabled:true },
      { id:"Salary", name:"Salary", enabled:true }
    ],
    nodeTemplates: [
      { id:"company", name:"Company (LegalEntity)", kind:"company" },
      { id:"person", name:"Person (Individual)", kind:"person" }
    ]
  };
}

export function defaultMasterData(){
  return {
    KZ: {
      mciValue: 4325, minWage: 85000, vatRateStandard: 0.16, citRateStandard: 0.20,
      vatRegistrationThresholdMci: 10000, cashLimitMci: 1000, frozenDebtMci: 20,
      cfcIncomeMci:195, cfcEtrThreshold:0.10, cfcOwnershipThreshold:0.25,
      wht: { dividends: 0.15, interest: 0.10, royalties: 0.15, services: 0.20 },
      payroll: {
        pitRate: 0.10, pensionEmployeeRate: 0.10, medicalEmployeeRate: 0.02,
        socialContribRate: 0.05, socialTaxEmployerRate: 0.06, medicalEmployerRate: 0.03,
        pensionEmployerRate: 0.035, socialContribMaxBaseMW: 7, medicalEmployerMaxBaseMW: 40,
        medicalEmployeeMaxBaseMW: 20
      },
      statuteOfLimitationsYears: 3
    },
    UAE: {
      vatRateStandard: 0.05,
      cit: { mode:"threshold", zeroUpTo: 375000, zeroRate: 0.00, mainRate: 0.09, currency:"AED" },
      wht: { dividends: 0.00, interest: 0.00, royalties: 0.00, services: 0.00 },
      payroll: { pitRate: 0.00, employerRate: 0.00, employeeRate: 0.00 },
      statuteOfLimitationsYears: 5
    },
    HK: {
      vatRateStandard: 0.00,
      cit: { mode:"twoTier", smallRate: 0.0825, smallLimit: 2000000, mainRate: 0.165, currency:"HKD" },
      wht: { dividends: 0.00, interest: 0.00, royalties: 0.0495, services: 0.00 },
      payroll: { pitRate: 0.15 },
      statuteOfLimitationsYears: 6
    },
    CY: {
      vatRateStandard: 0.19, citRateStandard: 0.15,
      wht: { dividends: 0.00, interest: 0.00, royalties: 0.10, services: 0.00 },
      special: { defensiveMeasures: { enabled:false, dividendWhtLowTax: 0.17 } },
      statuteOfLimitationsYears: 6
    },
    SG: {
      vatRateStandard: 0.09, citRateStandard: 0.17,
      wht: { dividends: 0.00, interest: 0.15, royalties: 0.10, services: 0.17 },
      payroll: { pitRate: 0.00 },
      statuteOfLimitationsYears: 4
    },
    UK: {
      vatRateStandard: 0.20,
      cit: { mode:"smallProfits", smallRate: 0.19, smallLimit: 50000, mainRate: 0.25, mainLimit: 250000, currency:"GBP" },
      wht: { dividends: 0.00, interest: 0.20, royalties: 0.20, services: 0.00 },
      payroll: { pitRate: 0.00 },
      statuteOfLimitationsYears: 4
    },
    US: {
      vatRateStandard: 0.00, citRateStandard: 0.21,
      wht: { dividends: 0.30, interest: 0.30, royalties: 0.30, services: 0.30 },
      payroll: { pitRate: 0.00 },
      statuteOfLimitationsYears: 3
    },
    BVI: {
      vatRateStandard: 0.00, citRateStandard: 0.00,
      wht: { dividends: 0.00, interest: 0.00, royalties: 0.00, services: 0.00 },
      payroll: { pitRate: 0.00 },
      statuteOfLimitationsYears: 5
    },
    CAY: {
      vatRateStandard: 0.00, citRateStandard: 0.00,
      wht: { dividends: 0.00, interest: 0.00, royalties: 0.00, services: 0.00 },
      payroll: { pitRate: 0.00 },
      statuteOfLimitationsYears: 5
    },
    SEY: {
      vatRateStandard: 0.15,
      cit: { mode:"brackets", currency:"SCR", brackets:[ { upTo: 1000000, rate: 0.15 }, { upTo: null, rate: 0.25 } ] },
      wht: { dividends: 0.00, interest: 0.00, royalties: 0.00, services: 0.00 },
      payroll: { pitRate: 0.00 },
      statuteOfLimitationsYears: 5
    }
  };
}

export function ensureMasterData(p){
  p.masterData = p.masterData || {};
  const md = p.masterData;
  const def = defaultMasterData();
  for (const j of Object.keys(def)){
    md[j] = md[j] || {};
    md[j] = deepMerge(def[j], md[j]);
  }
  md.KZ = md.KZ || {};
  return md;
}

export function defaultZoneTax(p, zone){
  const md = (p.masterData && p.masterData[zone.jurisdiction]) ? p.masterData[zone.jurisdiction] : {};
  const base = {
    vatRate: Number(md.vatRateStandard || 0),
    cit: (md.cit ? deepMerge(md.cit, {}) : { mode:"flat", rate: Number(md.citRateStandard || 0) }),
    wht: deepMerge(md.wht || {dividends:0, interest:0, royalties:0, services:0}, {}),
    payroll: deepMerge(md.payroll || {}, {}),
    notes: ""
  };
  if (zone.code === "KZ_HUB"){
    base.vatRate = 0.00;
    base.cit = { mode:"flat", rate: 0.00 };
    base.wht = { dividends: 0.05, interest: 0.00, royalties: 0.00, services: 0.00 };
    base.payroll = deepMerge(base.payroll, { pitRate: 0.00, socialTaxEmployerRate: 0.00 });
    base.notes = "Astana Hub: льготы применимы при доходе от приоритетных ICT-видов деятельности.";
  }
  if (zone.code === "KZ_AIFC"){
    base.vatRate = 0.00;
    base.cit = { mode:"flat", rate: 0.00 };
    base.notes = "AIFC: освобождение CIT/VAT для доходов от определенных финансовых услуг при выполнении условий (в т.ч. substantial presence).";
  }
  if (zone.code === "UAE_FREEZONE_QFZP"){
    base.cit = { mode:"qfzp", qualifyingRate: 0.00, nonQualifyingRate: 0.09, currency:"AED" };
    base.notes = "UAE Free Zone QFZP: 0% на qualifying income, 9% на non-qualifying income.";
  }
  if (zone.code === "UAE_FREEZONE_NONQFZP"){
    base.cit = deepMerge(md.cit || { mode:"threshold", zeroUpTo: 375000, zeroRate: 0.00, mainRate: 0.09, currency:"AED" }, {});
    base.notes = "UAE Free Zone (non-QFZP): применяется стандартная ставка корпоративного налога.";
  }
  if (zone.code === "HK_OFFSHORE"){
    base.cit = { mode:"flat", rate: 0.00 };
    base.notes = "Hong Kong offshore deal: 0% при подтверждении offshore claim (территориальный принцип).";
  }
  return base;
}

export function ensureZoneTaxDefaults(p){
  if (!p || !Array.isArray(p.zones)) return;
  ensureMasterData(p);
  p.zones.forEach(z=>{ z.tax = z.tax || {}; });
}

export function effectiveZoneTax(p, zone){
  return deepMerge(defaultZoneTax(p, zone), (zone && zone.tax) ? zone.tax : {});
}

export function whtDefaultPercentForFlow(zoneTax, flowType){
  if (!zoneTax || !flowType) return 0;
  const t = String(flowType);
  if (t === "Dividends") return Number(zoneTax.wht?.dividends || 0) * 100;
  if (t === "Interest") return Number(zoneTax.wht?.interest || 0) * 100;
  if (t === "Royalties") return Number(zoneTax.wht?.royalties || 0) * 100;
  if (t === "Services") return Number(zoneTax.wht?.services || 0) * 100;
  return 0;
}

export function computePayroll(p, flow, payerZone){
  const gross = Number(flow.grossAmount || 0);
  if (!payerZone) return { total:0, breakdown:[] };
  const tx = effectiveZoneTax(p, payerZone);
  const pr = tx.payroll || {};
  const j = payerZone.jurisdiction;
  const md = p.masterData && p.masterData[j] ? p.masterData[j] : {};
  const mw = numOrNull(md.minWage);
  const capBase = (mult)=>{
    const m = numOrNull(mult);
    if (mw == null || m == null || m <= 0) return gross;
    return Math.min(gross, mw * m);
  };

  const baseMedicalEmployer = capBase(pr.medicalEmployerMaxBaseMW || 40);
  const baseMedicalEmployee = capBase(pr.medicalEmployeeMaxBaseMW || 20);
  const baseSocialContrib   = capBase(pr.socialContribMaxBaseMW || 7);

  const parts = [];
  const add = (code, rate, base)=>{ 
    const r = Number(rate||0);
    if (r<=0) return;
    const amt = bankersRound2(Number(base||gross) * r);
    if (amt>0) parts.push({ code, rate: r, base: Number(base||gross), amount: amt });
  };

  add("PIT", pr.pitRate, gross);
  add("PENSION_EMPLOYEE", pr.pensionEmployeeRate, gross);
  add("MEDICAL_EMPLOYEE", pr.medicalEmployeeRate, baseMedicalEmployee);
  add("SOCIAL_CONTRIB", pr.socialContribRate, baseSocialContrib);
  add("SOCIAL_TAX_EMPLOYER", pr.socialTaxEmployerRate, gross);
  add("MEDICAL_EMPLOYER", pr.medicalEmployerRate, baseMedicalEmployer);
  add("PENSION_EMPLOYER", pr.pensionEmployerRate, gross);

  const total = bankersRound2(parts.reduce((s,p)=>s+p.amount,0));
  return { total, breakdown: parts };
}

export function makeNode(name, type, x, y){
  return {
    id: "n_" + uid(),
    name, type, x, y,
    w: 190, h: 90,
    zoneId: null, frozen: false, riskFlags: [], balances: {},
    annualIncome: 0, etr: 0.2, citizenship: [],
    compliance: { bvi: { relevantActivity: false, employees: 0, office: false }, aifc: { usesCITBenefit: false, cigaInZone: true } },
    investments: { aifcInvestmentUsd: 0, aifcFeePaidMci: 0, isInvestmentResident: false }
  };
}

export function makeTXA(zone){
  return {
    id: "txa_" + zone.id,
    name: "TXA — " + zone.code,
    type: "txa",
    x: zone.x + zone.w - 210, y: zone.y + zone.h - 110,
    w: 190, h: 90,
    zoneId: zone.id, frozen: false, riskFlags: [],
    balances: (() => { const b = {}; b[zone.currency] = 0; return b; })(),
    annualIncome: 0, etr: 0, citizenship: []
  };
}

export function nodeCenter(node){
  const cx = Number(node?.x||0) + Number(node?.w||0)/2;
  const cy = Number(node?.y||0) + Number(node?.h||0)/2;
  return { cx, cy, x: cx, y: cy };
}

export function pointInZone(cx, cy, z){
  return cx >= z.x && cx <= (z.x + z.w) && cy >= z.y && cy <= (z.y + z.h);
}

export function zoneArea(z){ return z.w * z.h; }

export function clampToZoneRect(z, node, x, y, pad){
  const p = pad ?? 10;
  const nx = Math.max(z.x + p, Math.min(z.x + z.w - node.w - p, x));
  const ny = Math.max(z.y + p, Math.min(z.y + z.h - node.h - p, y));
  return { x: nx, y: ny };
}

export function clampToZoneExclusive(project, node, homeZone, x, y, pad){
  const p = (typeof pad === "number" ? pad : 10);
  const ri = (a,b) => !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
  let out = clampToZoneRect(homeZone, node, x, y, p);
  let nx = out.x, ny = out.y;
  const nested = project.zones
    .filter(z => z.id !== homeZone.id && isZoneEnabled(project, z))
    .filter(z => zoneArea(z) < zoneArea(homeZone))
    .filter(z => ri(z, homeZone));

  const maxIter = 10;
  for (let iter = 0; iter < maxIter; iter++){
    const nr = { x:nx, y:ny, w:node.w, h:node.h };
    const hits = nested.filter(z => ri(nr, z));
    if (!hits.length) break;
    hits.sort((a,b)=> (zoneArea(a)-zoneArea(b)) || ((b.zIndex||0)-(a.zIndex||0)));
    const z = hits[0];
    const left  = (nr.x + nr.w) - (z.x - p);
    const right = (z.x + z.w + p) - nr.x;
    const up    = (nr.y + nr.h) - (z.y - p);
    const down  = (z.y + z.h + p) - nr.y;
    const cands = [
      { dx: -left, dy: 0, mag: Math.abs(left) },
      { dx: right, dy: 0, mag: Math.abs(right) },
      { dx: 0, dy: -up, mag: Math.abs(up) },
      { dx: 0, dy: down, mag: Math.abs(down) },
    ].filter(c => isFinite(c.mag) && c.mag >= 0);
    cands.sort((a,b)=>a.mag-b.mag);
    const best = cands[0] || {dx:0,dy:0};
    nx += best.dx; ny += best.dy;
    const cc = clampToZoneRect(homeZone, node, nx, ny, p);
    nx = cc.x; ny = cc.y;
  }
  return { x:nx, y:ny };
}

export function isJurisdictionEnabled(p, j){
  if (!p || !Array.isArray(p.activeJurisdictions)) return true;
  return p.activeJurisdictions.includes(j);
}

export function isZoneEnabled(p, z){ 
  const hidden = (p.ui && p.ui.hiddenZoneIds) ? p.ui.hiddenZoneIds : []; 
  return isJurisdictionEnabled(p, z.jurisdiction) && !hidden.includes(z.id); 
}

export function detectZoneId(p, node){
  if (node && node.type === 'txa') return node.zoneId || (String(node.id||'').startsWith('txa_') ? String(node.id).slice(4) : null);
  const {cx, cy} = nodeCenter(node);
  const hits = p.zones.filter(z => isZoneEnabled(p, z) && pointInZone(cx, cy, z));
  if (hits.length === 0) return null;
  hits.sort((a,b)=>{
    const da = zoneArea(a), db = zoneArea(b);
    if (da !== db) return da - db;
    if (a.zIndex !== b.zIndex) return b.zIndex - a.zIndex;
    return a.id.localeCompare(b.id);
  });
  return hits[0].id;
}

export function bootstrapNormalizeZones(p){
  p.nodes.forEach(n => {
    if (n.type === "txa") return;
    n.zoneId = detectZoneId(p, n);
  });
  recomputeFrozen(p);
}

export function getZone(p, zoneId){ return p.zones.find(z => z.id === zoneId) || null; }
export function getNode(p, nodeId){ return p.nodes.find(n => n.id === nodeId) || null; }

export function rateToKZT(p, ccy){
  const r = p.fx.rateToKZT[ccy];
  return (typeof r === "number" && isFinite(r) && r > 0) ? r : null;
}

export function convert(p, amount, fromCcy, toCcy){
  const a = Number(amount || 0);
  if (!isFinite(a)) return 0;
  if (fromCcy === toCcy) return a;
  if (fromCcy === "KZT") {
    const r = rateToKZT(p, toCcy);
    if (!r) return NaN;
    return a / r;
  }
  if (toCcy === "KZT") {
    const r = rateToKZT(p, fromCcy);
    if (!r) return NaN;
    return a * r;
  }
  const rFrom = rateToKZT(p, fromCcy);
  const rTo = rateToKZT(p, toCcy);
  if (!rFrom || !rTo) return NaN;
  const kzt = a * rFrom;
  return kzt / rTo;
}

export function frozenThresholdFunctional(p, node){
  const z = getZone(p, node.zoneId);
  if (!z || z.jurisdiction !== "KZ") return null;
  const m = p.masterData.KZ;
  if (!m) return null;
  const mci = numOrNull(m.mciValue);
  const mult = numOrNull(m.frozenDebtMci);
  if (mci == null || mult == null) return null;
  return mult * mci;
}

export function nodeDebtToTXA(p, node){
  if (!node.zoneId) return 0;
  return p.taxes
    .filter(t => t.status === "pending" && t.payerId === node.id && t.zoneId === node.zoneId)
    .reduce((s,t)=> s + Number(t.amountFunctional || 0), 0);
}

export function recomputeFrozen(p){
  p.nodes.forEach(n => {
    if (n.type !== "company") { n.frozen = false; return; }
    const thr = frozenThresholdFunctional(p, n);
    if (thr == null) { n.frozen = false; return; }
    const debt = nodeDebtToTXA(p, n);
    n.frozen = debt >= thr;
  });
}

export function listPersons(p){ return p.nodes.filter(n=>n.type==="person"); }
export function listCompanies(p){ return p.nodes.filter(n=>n.type==="company"); }

export function computeControlFromPerson(p, personId){
  const edges = p.ownership || [];
  const isCompany = (id)=>{ const n=getNode(p,id); return n && n.type==="company"; };
  const direct = new Map();
  edges.forEach(e=>{
    if (e.fromId === personId && isCompany(e.toId)){
      const frac = Math.max(0, Math.min(1, (Number(e.percent||0)+Number(e.manualAdjustment||0))/100));
      direct.set(e.toId, Math.max(direct.get(e.toId)||0, frac));
    }
  });
  const control = new Map(direct);
  let changed = true;
  let guard = 0;
  while (changed && guard < 50){
    changed = false;
    guard++;
    edges.forEach(e=>{
      if (!isCompany(e.fromId) || !isCompany(e.toId)) return;
      const parentControl = control.get(e.fromId) || 0;
      const ownedFrac = Math.max(0, Math.min(1, (Number(e.percent||0)+Number(e.manualAdjustment||0))/100));
      let via;
      if (parentControl > 0.5) via = 1.0 * ownedFrac;
      else via = parentControl * ownedFrac;
      const prev = control.get(e.toId) || 0;
      if (via > prev + 1e-9){
        control.set(e.toId, via);
        changed = true;
      }
    });
  }
  return control;
}

export function anyPersonControlsBoth(p, aCompanyId, bCompanyId, threshold){
  const thr = Number(threshold || 0.25);
  for (const per of listPersons(p)){
    const control = computeControlFromPerson(p, per.id);
    const a = control.get(aCompanyId) || 0;
    const b = control.get(bCompanyId) || 0;
    if (a >= thr && b >= thr) return { personId: per.id, a, b };
  }
  return null;
}

export function isRelatedParty(p, aId, bId){
  if (!aId || !bId || aId === bId) return false;
  const thr = 0.25;
  for (const e of (p.ownership || [])){
    const frac = Math.max(0, Math.min(1, (Number(e.percent||0)+Number(e.manualAdjustment||0))/100));
    if (frac < thr) continue;
    if ((e.fromId === aId && e.toId === bId) || (e.fromId === bId && e.toId === aId)) return true;
  }
  return !!anyPersonControlsBoth(p, aId, bId, thr);
}

export function effectiveEtrForCompany(p, co){
  const v = Number(co?.etr);
  if (isFinite(v) && v >= 0){
    const z0 = getZone(p, co?.zoneId);
    const aifc = co?.compliance?.aifc;
    if (z0 && z0.code === 'KZ_AIFC' && aifc && aifc.usesCITBenefit && !aifc.cigaInZone){
      return Math.max(v, 0.20);
    }
    return v;
  }
  const z = getZone(p, co?.zoneId);
  if (!z) return 0;
  const tx = effectiveZoneTax(p, z);
  if (tx?.cit?.mode === 'flat') return Number(tx.cit.rate || 0);
  const md = p.masterData && p.masterData[z.jurisdiction] ? p.masterData[z.jurisdiction] : {};
  const cit = numOrNull(md.citRateStandard);
  return cit == null ? 0 : cit;
}

export function recomputeRisks(p){
  p.projectRiskFlags = [];
  p.nodes.forEach(n=>{
    n.riskFlags = [];
    if (n.investments) n.investments.isInvestmentResident = false;
  });

  const kz = p.masterData.KZ || {};
  const mci = numOrNull(kz.mciValue);
  const incomeMult = numOrNull(kz.cfcIncomeMci);
  const etrThr = numOrNull(kz.cfcEtrThreshold);
  const ownThr = numOrNull(kz.cfcOwnershipThreshold);
  const cfcEnabled = (mci != null && incomeMult != null && etrThr != null && ownThr != null);
  if (cfcEnabled){
    const incomeThrKZT = incomeMult * mci;
    const persons = listPersons(p).filter(per => (per.citizenship||[]).includes('KZ'));
    const companies = listCompanies(p);
    persons.forEach(per=>{
      const control = computeControlFromPerson(p, per.id);
      companies.forEach(co=>{
        const z = getZone(p, co.zoneId);
        const isForeign = z ? (z.jurisdiction !== 'KZ') : true;
        if (!isForeign) return;
        const cf = control.get(co.id) || 0;
        if (cf < ownThr) return;
        const incomeKZT = Number(co.annualIncome || 0);
        if (incomeKZT <= incomeThrKZT) return;
        const etr = effectiveEtrForCompany(p, co);
        if (etr >= etrThr) return;
        co.riskFlags.push({ type:'CFC_RISK', byPersonId: per.id, control: cf, incomeKZT, etr, lawRef:'KZ_CFC_MVP' });
      });
    });
  }

  for (const co of listCompanies(p)){
    const z = getZone(p, co.zoneId);
    if (!z) continue;
    if (z.jurisdiction !== 'BVI') continue;
    const bvi = co.compliance?.bvi || { relevantActivity:false, employees:0, office:false };
    const employees = Number(bvi.employees || 0);
    const office = !!bvi.office;
    if (!!bvi.relevantActivity && (employees <= 0 || !office)){
      co.riskFlags.push({ type:'SUBSTANCE_BREACH', lawRef:'APP_G_G1_BVI_SUBSTANCE', employees, office, penaltyUsd: 20000 });
    }
  }

  for (const co of listCompanies(p)){
    const z = getZone(p, co.zoneId);
    if (!z) continue;
    if (z.code !== 'KZ_AIFC') continue;
    const aifc = co.compliance?.aifc || { usesCITBenefit:false, cigaInZone:true };
    if (!!aifc.usesCITBenefit && !aifc.cigaInZone){
      co.riskFlags.push({ type:'AIFC_PRESENCE_BREACH', lawRef:'APP_G_G4_AIFC_PRESENCE', effectiveCitRate: 0.20 });
    }
  }

  for (const per of listPersons(p)){
    const inv = per.investments || (per.investments = { aifcInvestmentUsd:0, aifcFeePaidMci:0, isInvestmentResident:false });
    const invUsd = Number(inv.aifcInvestmentUsd || 0);
    const feeMci = Number(inv.aifcFeePaidMci || 0);
    const ok = (invUsd >= 60000) && (feeMci >= 7000);
    inv.isInvestmentResident = ok;
    if (ok){
      per.riskFlags.push({ type:'INVESTMENT_RESIDENT', lawRef:'APP_G_G6_INVEST_RES', investmentUsd: invUsd, feeMci });
    }
  }

  const rev = numOrNull(p.group?.consolidatedRevenueEur);
  if (rev != null && rev > 750_000_000){
    const low = [];
    for (const co of listCompanies(p)){
      const etr = effectiveEtrForCompany(p, co);
      if (etr < 0.15){
        low.push({ companyId: co.id, etr });
        co.riskFlags.push({ type:'PILLAR2_LOW_ETR', lawRef:'APP_G_G5_PILLAR2', etr, minEtr:0.15 });
      }
    }
    if (low.length){
      p.projectRiskFlags.push({ type:'PILLAR2_TOPUP_RISK', lawRef:'APP_G_G5_PILLAR2', consolidatedRevenueEur: rev, minEtr:0.15, affectedCount: low.length });
    }
  }

  for (const f of (p.flows || [])){
    if (f.flowType === 'Goods' || f.flowType === 'Equipment' || f.flowType === 'Services'){
      if (isRelatedParty(p, f.fromId, f.toId)){
        const payer = getNode(p, f.fromId);
        const payee = getNode(p, f.toId);
        const zPayer = getZone(p, payer?.zoneId);
        const zPayee = getZone(p, payee?.zoneId);
        
        if (payer && zPayer && zPayee && zPayer.jurisdiction !== zPayee.jurisdiction) {
          payer.riskFlags.push({
            type: 'TRANSFER_PRICING_RISK',
            lawRef: 'KZ_LAW_ON_TP',
            flowId: f.id,
            description: `Сделка "${f.flowType}" между взаимосвязанными сторонами. Риск корректировки налоговой базы (исключение из вычетов) и доначисления КПН 20% у покупателя в случае отклонения цены от рыночной.`
          });
        }
      }
    }
  }
}

export function cashLimitApplicable(p, flow){
  const payer = getNode(p, flow.fromId);
  const payee = getNode(p, flow.toId);
  if (!payer || !payee) return false;
  if (payer.type !== "company" || payee.type !== "company") return false;
  const hasCash = (flow.paymentMethod === "cash") || (Number(flow.cashComponentAmount || 0) > 0);
  if (!hasCash) return false;
  const z = getZone(p, payer.zoneId);
  if (!z) return false;
  if (z.jurisdiction !== "KZ") return false;
  return true;
}

export function checkCashLimit(p, flow){
  const payer = getNode(p, flow.fromId);
  if (!payer) return { applicable:false };
  const z = getZone(p, payer.zoneId);
  if (!z) return { applicable:false };
  if (!cashLimitApplicable(p, flow)) return { applicable:false };
  const m = p.masterData.KZ || {};
  const mci = numOrNull(m.mciValue);
  const mult = numOrNull(m.cashLimitMci);
  if (mci == null || mult == null) return { applicable:false };
  const threshold = mult * mci;
  const cashAmt = Number(flow.cashComponentAmount || 0);
  const cashCcy = flow.cashComponentCurrency || flow.currency;
  const fxDate = isoDate(flow.flowDate || p.fx.fxDate);
  const cashFunctional = convert(p, cashAmt, cashCcy, z.currency);
  const exceeded = cashFunctional > threshold;
  return {
    applicable:true, exceeded, thresholdFunctional: threshold, cashAmountFunctional: bankersRound2(cashFunctional),
    fxDate, fxRateUsed: bankersRound2(convert(p, 1, cashCcy, z.currency)), functionalCurrency: z.currency
  };
}

export function makeFlowDraft(p){
  const f = {
    id: "f_" + uid(),
    fromId: p.nodes.find(n=>n.type==="company")?.id || "",
    toId: p.nodes.find(n=>n.type==="company" && n.name!=="KZ Company")?.id || "",
    flowType: "Services", currency: "KZT", grossAmount: 1200000,
    paymentMethod: "bank", cashComponentAmount: 0, cashComponentCurrency: "KZT",
    whtRate: 0.0, status: "pending",
    flowDate: new Date(p.fx.fxDate + "T12:00:00Z").toISOString(),
    ack: { ackStatus: "not_required", acknowledgedBy: null, acknowledgedAt: null, comment: "" },
    taxAdjustments: [], fxEvidence: null
  };
  try{ ensureZoneTaxDefaults(p); }catch(e){}
  const payer = getNode(p, f.fromId);
  const z = payer ? getZone(p, payer.zoneId) : null;
  if (z && z.currency){
    f.currency = z.currency;
    f.cashComponentCurrency = z.currency;
  }
  if (z){
    const tx = effectiveZoneTax(p, z);
    f.whtRate = bankersRound2(whtDefaultPercentForFlow(tx, f.flowType));
  }
  return f;
}

export function updateFlowCompliance(p, flow){
  const r = checkCashLimit(p, flow);
  let requiresAck = false;
  let violationTypes = [];
  flow.taxAdjustments = [];

  if (r.applicable && r.exceeded){
    requiresAck = true;
    violationTypes.push("CASH_LIMIT_EXCEEDED");
    flow.fxEvidence = {
      fxDate: r.fxDate, fxRateUsed: r.fxRateUsed, cashAmountFunctional: r.cashAmountFunctional,
      functionalCurrency: r.functionalCurrency, thresholdFunctional: r.thresholdFunctional
    };
    const baseOriginal = Number(flow.cashComponentAmount || 0);
    const origCcy = flow.cashComponentCurrency || flow.currency;
    flow.taxAdjustments.push(
      { tax: "CIT_DEDUCTION", effect: "DISALLOW", baseAmountOriginal: baseOriginal, originalCurrency: origCcy, baseAmountFunctional: r.cashAmountFunctional, functionalCurrency: r.functionalCurrency, fxDate: r.fxDate, fxRateUsed: r.fxRateUsed, lawRefId: "KZ_NK_2026_ART_286" },
      { tax: "VAT_CREDIT", effect: "DISALLOW", baseAmountOriginal: baseOriginal, originalCurrency: origCcy, baseAmountFunctional: r.cashAmountFunctional, functionalCurrency: r.functionalCurrency, fxDate: r.fxDate, fxRateUsed: r.fxRateUsed, lawRefId: "KZ_NK_2026_ART_482" }
    );
  }

  if ((flow.flowType === 'Goods' || flow.flowType === 'Equipment' || flow.flowType === 'Services') && isRelatedParty(p, flow.fromId, flow.toId)) {
    const payerZ = getZone(p, getNode(p, flow.fromId)?.zoneId);
    const payeeZ = getZone(p, getNode(p, flow.toId)?.zoneId);
    if (payerZ && payeeZ && payerZ.jurisdiction !== payeeZ.jurisdiction) {
      requiresAck = true;
      violationTypes.push("TRANSFER_PRICING_RISK");
    }
  }

  if (flow.flowType === 'Dividends') {
    const payer = getNode(p, flow.fromId);
    const fDate = new Date(flow.flowDate || p.fx.fxDate);
    
    const month = fDate.getMonth(); 
    if (month !== 2 && month !== 3 && month !== 11) { 
        requiresAck = true;
        violationTypes.push("INTERIM_DIVIDENDS_RISK");
    }

    if (payer) {
        const flowAmtKzt = convert(p, flow.grossAmount, flow.currency, 'KZT');
        const incKzt = Number(payer.annualIncome || 0);
        if (flowAmtKzt > incKzt && incKzt > 0) {
            requiresAck = true;
            violationTypes.push("CONSTRUCTIVE_DIVIDEND");
        }
    }
  }

  if (!requiresAck) {
    flow.ack.ackStatus = "not_required";
    if (!r.exceeded) flow.fxEvidence = null;
    flow.compliance = { applicable: r.applicable || flow.flowType === 'Dividends', exceeded: false };
  } else {
    flow.compliance = { applicable: true, exceeded: true, violationType: violationTypes.join(" & ") };
    flow.ack.ackStatus = (flow.ack.ackStatus === "acknowledged") ? "acknowledged" : "required";
  }
}

export function computeWht(p, flow, overrideRatePercent){
  const payer = getNode(p, flow.fromId);
  const payee = getNode(p, flow.toId); 
  if (!payer) return { amount:0, currency: flow.currency };
  
  const zPayer = getZone(p, payer.zoneId);
  const zPayee = payee ? getZone(p, payee.zoneId) : null; 
  
  let rate = (overrideRatePercent === undefined || overrideRatePercent === null) ? Number(flow.whtRate || 0) : Number(overrideRatePercent || 0);
  let appliedLawRef = null;
  
  if (flow.flowType === "Goods" || flow.flowType === "Equipment" || flow.flowType === "Services") {
      rate = 0;
      appliedLawRef = "KZ_NK_2026_ART_680_P1_S4";
  } else if (zPayer && zPayee && zPayer.jurisdiction === zPayee.jurisdiction) {
      rate = 0;
      appliedLawRef = "DOMESTIC_WHT_EXEMPTION";
  }

  const gross = Number(flow.grossAmount || 0);
  const whtOrig = bankersRound2(gross * (rate/100));
  const whtFunctional = bankersRound2(convert(p, whtOrig, flow.currency, (zPayer ? zPayer.currency : flow.currency)));
  
  return {
    amountOriginal: whtOrig,
    originalCurrency: flow.currency,
    amountFunctional: whtFunctional,
    functionalCurrency: (zPayer ? zPayer.currency : flow.currency),
    fxDate: isoDate(flow.flowDate || p.fx.fxDate),
    fxRateUsed: bankersRound2(convert(p, 1, flow.currency, (zPayer ? zPayer.currency : flow.currency))),
    appliedLawRef: appliedLawRef
  };
}

export function ensureBalance(node, ccy){
  if (!node.balances) node.balances = {};
  if (typeof node.balances[ccy] !== "number") node.balances[ccy] = 0;
}

export function canCreateOutgoing(p, payerId){
  const payer = getNode(p, payerId);
  if (!payer) return false;
  if (payer.type !== "company") return true;
  return !payer.frozen;
}

export function yearOf(iso){
  try{ return new Date(iso).getUTCFullYear(); }catch(e){ return 2026; }
}

export function ensurePeriods(p){
  p.periods = p.periods || { closedYears: [] };
  p.periods.closedYears = Array.isArray(p.periods.closedYears) ? p.periods.closedYears : [];
}

export function isYearClosed(p, year){
  ensurePeriods(p);
  return p.periods.closedYears.includes(Number(year));
}

export function ensureAccounting(p){
  p.accounting = p.accounting || { years: {} };
  p.accounting.years = p.accounting.years || {};
}

export function ensureAccountingYear(p, year){
  ensureAccounting(p);
  const y = String(year);
  if (!p.accounting.years[y]){
    p.accounting.years[y] = { indirectExpensePoolKZT: 0, allocations: {}, lastComputedAt: null, lawReference: 'AFSA_CLOSED_PERIOD_2026' };
  }
  return p.accounting.years[y];
}

export function pipelineStart(p, context){
  p.pipeline = p.pipeline || { lastRunAt: null, lastRun: null, runs: [] };
  const run = { id: 'pl_' + uid(), startedAt: nowIso(), context: context || 'manual', steps: [] };
  p.pipeline.lastRunAt = run.startedAt;
  p.pipeline.lastRun = run;
  p.pipeline.runs = Array.isArray(p.pipeline.runs) ? p.pipeline.runs : [];
  p.pipeline.runs.unshift(run);
  p.pipeline.runs = p.pipeline.runs.slice(0, 50);
  return run;
}

export function pipelineStep(run, name, fn){
  const step = { name, startedAt: nowIso(), finishedAt: null, status: 'ok', details: '' };
  try{
    const out = fn ? fn() : null;
    if (out && typeof out.details === 'string') step.details = out.details;
  }catch(e){
    step.status = 'error';
    step.details = String((e && e.message) ? e.message : e);
  }
  step.finishedAt = nowIso();
  run.steps.push(step);
  return step;
}

export function detectJurisdictionAll(p){
  for (const n of p.nodes){
    if (n.type === 'txa') continue;
    n.zoneId = detectZoneId(p, n);
  }
  return { details: 'nodes=' + p.nodes.filter(n=>n.type!=='txa').length };
}

export function separateAccountingAIFC(p, year){
  const y = String(year);
  const ay = ensureAccountingYear(p, y);
  let pool = Number(ay.indirectExpensePoolKZT || 0);
  if (!isFinite(pool) || pool < 0) pool = 0;

  const companies = listCompanies(p);
  let groupIncome = 0;
  let aifcPref = 0;
  const aifcCos = [];

  for (const co of companies){
    co.accountingYears = co.accountingYears || {};
    const ci = co.accountingYears[y] || (co.accountingYears[y] = { totalIncomeKZT: 0, preferentialIncomeKZT: 0, allocatedIndirectKZT: 0 });
    const totalIncome = Number(ci.totalIncomeKZT || 0);
    groupIncome += (isFinite(totalIncome) ? totalIncome : 0);
    const z = getZone(p, co.zoneId);
    if (z && z.code === 'KZ_AIFC'){
      const pref = Number(ci.preferentialIncomeKZT || 0);
      aifcPref += (isFinite(pref) ? pref : 0);
      aifcCos.push(co);
    }
  }

  const allocations = {};
  const allocToAifc = (groupIncome > 0 && aifcPref > 0) ? bankersRound2(pool * (aifcPref / groupIncome)) : 0;

  for (const co of aifcCos){
    const ci = co.accountingYears[y];
    const pref = Number(ci.preferentialIncomeKZT || 0);
    const share = (aifcPref > 0) ? (pref / aifcPref) : 0;
    const amt = bankersRound2(allocToAifc * share);
    ci.allocatedIndirectKZT = amt;
    allocations[co.id] = { allocatedIndirectKZT: amt, share: share };
  }

  ay.allocations = allocations;
  ay.lastComputedAt = nowIso();
  return { details: `pool=${fmtMoney(pool)}; groupIncome=${fmtMoney(groupIncome)}; aifcPref=${fmtMoney(aifcPref)}; allocatedToAIFC=${fmtMoney(allocToAifc)}` };
}

export function computeCITAmount(income, cit) {
  if (!cit || !income || income <= 0) return 0;
  const mode = cit.mode || "flat";
  let tax = 0;
  
  if (mode === "flat") {
    tax = income * (cit.rate || 0);
  } else if (mode === "threshold") {
    const zeroUpTo = Number(cit.zeroUpTo || 0);
    if (income > zeroUpTo) {
      tax = (income - zeroUpTo) * (cit.mainRate || 0);
    }
  } else if (mode === "twoTier") {
    const smallLimit = Number(cit.smallLimit || 0);
    if (income <= smallLimit) {
      tax = income * (cit.smallRate || 0);
    } else {
      tax = (smallLimit * (cit.smallRate || 0)) + ((income - smallLimit) * (cit.mainRate || 0));
    }
  } else if (mode === "qfzp") {
    tax = income * (cit.qualifyingRate || 0);
  } else if (mode === "brackets") {
    const b1 = cit.brackets[0] || {upTo: 0, rate: 0};
    const b2 = cit.brackets[1] || {rate: 0};
    if (income <= b1.upTo) {
      tax = income * (b1.rate || 0);
    } else {
      tax = (b1.upTo * (b1.rate || 0)) + ((income - b1.upTo) * (b2.rate || 0));
    }
  } else if (mode === "smallProfits") {
    const sl = Number(cit.smallLimit || 0);
    const ml = Number(cit.mainLimit || 0);
    if (income <= sl) {
      tax = income * (cit.smallRate || 0);
    } else if (income >= ml) {
      tax = income * (cit.mainRate || 0);
    } else {
      const smallTax = sl * (cit.smallRate || 0);
      const remainingIncome = income - sl;
      const marginalRate = ((ml * (cit.mainRate || 0)) - smallTax) / (ml - sl);
      tax = smallTax + (remainingIncome * marginalRate);
    }
  }
  return bankersRound2(tax);
}

export function recalculateEtrMvp(p, year){
  const companies = listCompanies(p);
  let updated = 0;
  
  for (const co of companies){
    const incomeKZT = Number(co.annualIncome || 0);
    if (!isFinite(incomeKZT) || incomeKZT <= 0){
      co.computedEtr = null;
      co.computedCitKZT = 0;
      continue;
    }

    let citAmountKZT = 0;
    const z = getZone(p, co.zoneId);
    
    if (z) {
      const tx = effectiveZoneTax(p, z);
      const incomeFunctional = convert(p, incomeKZT, 'KZT', z.currency);
      let citFunctional = computeCITAmount(incomeFunctional, tx.cit);

      const hasAifcBreach = (z.code === 'KZ_AIFC' && co.compliance?.aifc?.usesCITBenefit && !co.compliance?.aifc?.cigaInZone);
      const hasSgBreach = (z.jurisdiction === 'SG' && co.compliance?.sg?.claimsFSIE && !co.compliance?.sg?.cigaInSg);
      const hasSeyBreach = (z.jurisdiction === 'SEY' && co.compliance?.sey?.hasPassiveIncome && !co.compliance?.sey?.meetsSubstance);

      if (hasAifcBreach) citFunctional = incomeFunctional * 0.20;
      if (hasSgBreach) citFunctional = incomeFunctional * 0.17;
      if (hasSeyBreach) citFunctional = Math.max(citFunctional, incomeFunctional * 0.15); 

      citAmountKZT = convert(p, citFunctional, z.currency, 'KZT');
    }

    const taxes = (p.taxes || []).filter(t=>t.payerId === co.id);
    let otherTaxesKZT = 0;
    for (const t of taxes){
      const amt = Number(t.amountOriginal || 0);
      const fromC = t.originalCurrency || t.functionalCurrency || 'KZT';
      const kzt = convert(p, amt, fromC, 'KZT');
      if (isFinite(kzt)) otherTaxesKZT += kzt;
    }

    const totalTaxKZT = citAmountKZT + otherTaxesKZT;
    const etr = totalTaxKZT / incomeKZT;
    
    co.computedEtr = isFinite(etr) ? Math.max(0, etr) : null;
    co.computedCitKZT = bankersRound2(citAmountKZT);
    updated++;
  }
  return { details: 'companies CIT calculated=' + updated };
}

export function runPipeline(p, context){
  const year = yearOf(p.fx?.fxDate || nowIso());
  const run = pipelineStart(p, context || 'manual');
  pipelineStep(run, 'detectJurisdiction', ()=>detectJurisdictionAll(p));
  pipelineStep(run, 'loadMetadata', ()=>{ ensureMasterData(p); ensureZoneTaxDefaults(p); return { details: 'ok' }; });
  pipelineStep(run, 'Separate Accounting', ()=>separateAccountingAIFC(p, year));
  pipelineStep(run, 'Recalculate ETR', ()=>recalculateEtrMvp(p, year));
  return run;
}

export function createSnapshot(p, year){
  p.snapshots = Array.isArray(p.snapshots) ? p.snapshots : [];
  const y = Number(year);
  const lr = (p.lawReferences || defaultLawReferences());
  const lawSet = Object.keys(lr).sort().map(k=>k+':' + (lr[k] && lr[k].version ? lr[k].version : '')).join('|');
  const snap = {
    id: 's_' + uid(),
    createdAt: nowIso(),
    periodYear: y,
    schemaVersion: p.schemaVersion,
    engineVersion: p.engineVersion,
    lawReferenceSet: lawSet,
    lawReferences: JSON.parse(JSON.stringify(p.lawReferences || defaultLawReferences())),
    balances: p.nodes.map(n=>({ id:n.id, name:n.name, type:n.type, zoneId:n.zoneId, balances: n.balances || {}, annualIncome:n.annualIncome||0, etr:n.etr||0, computedEtr:n.computedEtr||null, compliance:n.compliance||null, investments:n.investments||null })),
    taxes: (p.taxes||[]).map(t=>({ id:t.id, dueFromFlowId:t.dueFromFlowId, payerId:t.payerId, zoneId:t.zoneId, taxType:t.taxType, amountFunctional:t.amountFunctional, functionalCurrency:t.functionalCurrency, amountOriginal:t.amountOriginal, originalCurrency:t.originalCurrency, fxDate:t.fxDate, status:t.status, meta:t.meta||{} })),
    projectRiskFlags: p.projectRiskFlags || []
  };
  p.snapshots.unshift(snap);
  p.snapshots = p.snapshots.slice(0, 50);
  return snap;
}

export async function applyTaxAdjustment(project, nodeId, flowId, adjustmentData) {
  if (project.readOnly) throw new Error("System is in Read-Only mode. Adjustments blocked.");

  const payer = getNode(project, nodeId);
  if (!payer) throw new Error(`Node (Payer) ${nodeId} not found.`);

  const flow = project.flows.find(f => f.id === flowId);
  if (!flow) throw new Error(`Flow ${flowId} not found.`);

  if (adjustmentData.reason === "DOMESTIC_EXEMPTION" || adjustmentData.reason === "INVESTMENT_PREFERENCE_APPLIED") {
      if (payer.statusEffectiveDate) {
          const fDate = new Date(flow.flowDate);
          const eDate = new Date(payer.statusEffectiveDate);
          if (fDate < eDate) {
              throw new Error("GUARD-RAIL VIOLATION: Retrospective application of domestic exemptions is strictly prohibited by Law-as-Code engine.");
          }
      }
  }

  if (adjustmentData.reason === "RECHARACTERIZATION") {
      const beforeFlow = JSON.parse(JSON.stringify(flow));
      
      const relatedTaxes = project.taxes.filter(t => t.dueFromFlowId === flowId && t.status === "pending");
      relatedTaxes.forEach(t => {
          t.status = "written_off";
          t.amountFunctional = 0;
          t.meta = t.meta || {};
          t.meta.recharacterizationNote = "Cancelled due to flow recharacterization.";
      });

      const oldType = flow.flowType;
      flow.flowType = adjustmentData.newFlowType || oldType; 
      
      await auditAppend(project, "FLOW_UPDATE", { entityType: "FLOW", entityId: flow.id }, beforeFlow, flow, {
          note: `RECHARACTERIZATION: Changed from ${oldType} to ${flow.flowType}. Old taxes cancelled.`,
          lawRefId: adjustmentData.lawRefId
      });
      
      save();
      return;
  }

  const tax = project.taxes.find(t => t.dueFromFlowId === flowId && t.taxType.includes(adjustmentData.taxType) && t.status === "pending");
  if (!tax) throw new Error(`Pending ${adjustmentData.taxType} tax for Flow ${flowId} not found.`);

  const beforeTax = JSON.parse(JSON.stringify(tax));
  let amountToAdjust = Number(adjustmentData.amountFunctional || tax.amountFunctional);
  if (amountToAdjust > tax.amountFunctional) amountToAdjust = tax.amountFunctional; 

  switch (adjustmentData.effect) {
      case "EXEMPT":
      case "WRITE_OFF":
          tax.amountFunctional = 0;
          tax.status = adjustmentData.effect === "WRITE_OFF" ? "written_off" : "exempted";
          break;
      case "OFFSET":
          tax.amountFunctional = bankersRound2(tax.amountFunctional - amountToAdjust);
          tax.status = tax.amountFunctional <= 0 ? "offset_cleared" : "partially_offset";
          break;
      case "REDUCE":
      case "DISALLOW":
          tax.amountFunctional = bankersRound2(tax.amountFunctional - amountToAdjust);
          if (tax.amountFunctional <= 0) tax.status = "cleared";
          break;
      default:
          throw new Error(`Unknown TaxAdjustmentEffect: ${adjustmentData.effect}`);
  }

  tax.adjustments = tax.adjustments || [];
  tax.adjustments.push({
      ...adjustmentData,
      adjustedAmount: amountToAdjust,
      appliedAt: nowIso(),
      appliedBy: project.userId
  });

  const logNote = `Tax Adjustment: ${adjustmentData.effect} applied due to ${adjustmentData.reason}. Adjusted: ${formatMoney(amountToAdjust)} ${tax.functionalCurrency}. LawRef: ${adjustmentData.lawRefId || 'N/A'}`;
  
  await auditAppend(project, "TAX_ADJUSTMENT", { entityType: "TAX", entityId: tax.id }, beforeTax, tax, {
      note: logNote,
      adjustmentDetail: adjustmentData
  });

  recomputeFrozen(project);
  save();
}
