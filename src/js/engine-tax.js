import { deepMerge, bankersRound2, numOrNull, isoDate } from './utils.js';
import { convert, getZone, getNode } from './engine-core.js';

export function defaultZoneTax(p, zone) {
  const md = (p.masterData && p.masterData[zone.jurisdiction]) ? p.masterData[zone.jurisdiction] : {};
  const base = {
    vatRate: Number(md.vatRateStandard || 0),
    cit: (md.cit ? deepMerge(md.cit, {}) : { mode:"flat", rate: Number(md.citRateStandard || 0) }),
    wht: deepMerge(md.wht || {dividends:0, interest:0, royalties:0, services:0}, {}),
    payroll: deepMerge(md.payroll || {}, {}),
    notes: ""
  };
  if (zone.code === "KZ_HUB") {
    base.vatRate = 0.00; base.cit = { mode:"flat", rate: 0.00 }; base.wht = { dividends: 0.05, interest: 0.00, royalties: 0.00, services: 0.00 }; base.payroll = deepMerge(base.payroll, { pitRate: 0.00, socialTaxEmployerRate: 0.00 });
  }
  if (zone.code === "KZ_AIFC") {
    base.vatRate = 0.00; base.cit = { mode:"flat", rate: 0.00 };
  }
  if (zone.code === "UAE_FREEZONE_QFZP") {
    base.cit = { mode:"qfzp", qualifyingRate: 0.00, nonQualifyingRate: 0.09, currency:"AED" };
  }
  if (zone.code === "UAE_FREEZONE_NONQFZP") {
    base.cit = deepMerge(md.cit || { mode:"threshold", zeroUpTo: 375000, zeroRate: 0.00, mainRate: 0.09, currency:"AED" }, {});
  }
  if (zone.code === "HK_OFFSHORE") {
    base.cit = { mode:"flat", rate: 0.00 };
  }
  return base;
}

export function ensureZoneTaxDefaults(p) {
  if (!p || !Array.isArray(p.zones)) return;
  p.zones.forEach(z => { z.tax = z.tax || {}; });
}

export function effectiveZoneTax(p, zone) {
  return deepMerge(defaultZoneTax(p, zone), (zone && zone.tax) ? zone.tax : {});
}

export function whtDefaultPercentForFlow(zoneTax, flowType) {
  if (!zoneTax || !flowType) return 0;
  const t = String(flowType);
  if (t === "Dividends") return Number(zoneTax.wht?.dividends || 0) * 100;
  if (t === "Interest") return Number(zoneTax.wht?.interest || 0) * 100;
  if (t === "Royalties") return Number(zoneTax.wht?.royalties || 0) * 100;
  if (t === "Services") return Number(zoneTax.wht?.services || 0) * 100;
  return 0;
}

export function computePayroll(p, flow, payerZone) {
  const gross = Number(flow.grossAmount || 0);
  if (!payerZone) return { total:0, breakdown:[] };
  const tx = effectiveZoneTax(p, payerZone);
  const pr = tx.payroll || {};
  const j = payerZone.jurisdiction;
  const md = p.masterData && p.masterData[j] ? p.masterData[j] : {};
  const mw = numOrNull(md.minWage);
  const capBase = (mult) => {
    const m = numOrNull(mult);
    if (mw == null || m == null || m <= 0) return gross;
    return Math.min(gross, mw * m);
  };
  const baseMedicalEmployer = capBase(pr.medicalEmployerMaxBaseMW || 40);
  const baseMedicalEmployee = capBase(pr.medicalEmployeeMaxBaseMW || 20);
  const baseSocialContrib   = capBase(pr.socialContribMaxBaseMW || 7);

  const parts = [];
  const add = (code, rate, base) => {
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

export function computeCITAmount(income, cit) {
  if (!cit || !income || income <= 0) return 0;
  const mode = cit.mode || "flat";
  let tax = 0;
  if (mode === "flat") { tax = income * (cit.rate || 0); }
  else if (mode === "threshold") {
    const zeroUpTo = Number(cit.zeroUpTo || 0);
    if (income > zeroUpTo) tax = (income - zeroUpTo) * (cit.mainRate || 0);
  } else if (mode === "twoTier") {
    const smallLimit = Number(cit.smallLimit || 0);
    if (income <= smallLimit) tax = income * (cit.smallRate || 0);
    else tax = (smallLimit * (cit.smallRate || 0)) + ((income - smallLimit) * (cit.mainRate || 0));
  } else if (mode === "qfzp") {
    tax = income * (cit.qualifyingRate || 0);
  } else if (mode === "brackets") {
    const b1 = cit.brackets?.[0] || {upTo: 0, rate: 0}, b2 = cit.brackets?.[1] || {rate: 0};
    if (income <= b1.upTo) tax = income * (b1.rate || 0);
    else tax = (b1.upTo * (b1.rate || 0)) + ((income - b1.upTo) * (b2.rate || 0));
  } else if (mode === "smallProfits") {
    const sl = Number(cit.smallLimit || 0), ml = Number(cit.mainLimit || 0);
    if (income <= sl) tax = income * (cit.smallRate || 0);
    else if (income >= ml) tax = income * (cit.mainRate || 0);
    else {
      const smallTax = sl * (cit.smallRate || 0), remainingIncome = income - sl;
      const marginalRate = ((ml * (cit.mainRate || 0)) - smallTax) / (ml - sl);
      tax = smallTax + (remainingIncome * marginalRate);
    }
  }
  return bankersRound2(tax);
}

export function computeWht(p, flow, overrideRatePercent) {
  const payer = getNode(p, flow.fromId), payee = getNode(p, flow.toId);
  if (!payer) return { amount:0, currency: flow.currency };
  const zPayer = getZone(p, payer.zoneId), zPayee = payee ? getZone(p, payee.zoneId) : null;
  let rate = (overrideRatePercent === undefined || overrideRatePercent === null) ? Number(flow.whtRate || 0) : Number(overrideRatePercent || 0);
  let appliedLawRef = null;

  if (["Goods", "Equipment", "Services"].includes(flow.flowType)) { rate = 0; appliedLawRef = "KZ_NK_2026_ART_680_P1_S4"; }
  else if (zPayer && zPayee && zPayer.jurisdiction === zPayee.jurisdiction) { rate = 0; appliedLawRef = "DOMESTIC_WHT_EXEMPTION"; }

  const gross = Number(flow.grossAmount || 0);
  const whtOrig = bankersRound2(gross * (rate/100));
  const whtFunctional = bankersRound2(convert(p, whtOrig, flow.currency, (zPayer ? zPayer.currency : flow.currency)));

  return {
    amountOriginal: whtOrig, originalCurrency: flow.currency, amountFunctional: whtFunctional, functionalCurrency: (zPayer ? zPayer.currency : flow.currency),
    fxDate: isoDate(flow.flowDate || p.fx.fxDate), fxRateUsed: bankersRound2(convert(p, 1, flow.currency, (zPayer ? zPayer.currency : flow.currency))), appliedLawRef
  };
}

export function effectiveEtrForCompany(p, co) {
  const v = Number(co?.etr);
  if (isFinite(v) && v >= 0) {
    const z0 = getZone(p, co?.zoneId), aifc = co?.complianceData?.aifc || co?.compliance?.aifc;
    if (z0 && z0.code === 'KZ_AIFC' && aifc && aifc.usesCITBenefit && !aifc.cigaInZone) return Math.max(v, 0.20);
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
