'use client';

/**
 * GlobalSummaryWidget — executive dashboard showing Global ETR,
 * total tax burden, income, and risk count.
 *
 * Positioned in top-right of the viewport, outside the zoom/pan area.
 * Wrapped in Suspense because globalSummaryAtom is async.
 *
 * Risk Popover: clicking the risk badge opens a Liquid Glass popover
 * with human-readable risk descriptions per entity.
 */

import { useAtomValue } from 'jotai';
import { Suspense, useState, useCallback } from 'react';
import { globalSummaryAtom } from '../model/atoms';
import { riskCalculationAtom } from '@features/risk-analyzer/model/atoms';
import { projectAtom } from '@features/canvas/model/project-atom';
import { fmtMoney, currencySymbol } from '@shared/lib/engine/utils';
import type { RiskFlag } from '@shared/types';
import { useTranslation } from '@shared/lib/i18n';
import type { Language } from '@shared/lib/i18n';
import { t as tFn } from '@shared/lib/i18n';

// ─── Risk Type → i18n Key Mapping ──────────────────────────────────────

const RISK_LABEL_KEYS: Record<string, string> = {
  CFC_RISK: 'riskCfc',
  SUBSTANCE_BREACH: 'riskSubstanceBreach',
  AIFC_PRESENCE_BREACH: 'riskAifcPresence',
  PILLAR2_LOW_ETR: 'riskPillar2LowEtr',
  PILLAR2_TOPUP_RISK: 'riskPillar2Topup',
  PILLAR2_TRIGGER: 'riskPillar2Trigger',
  TRANSFER_PRICING_RISK: 'riskTransferPricing',
  CASH_LIMIT_EXCEEDED: 'riskCashLimit',
  INTERIM_DIVIDENDS_RISK: 'riskInterimDividends',
  CONSTRUCTIVE_DIVIDEND: 'riskConstructiveDividend',
  NO_JURISDICTION: 'riskNoJurisdiction',
};

const RISK_ICONS: Record<string, string> = {
  CFC_RISK: '\u26a0\ufe0f',
  SUBSTANCE_BREACH: '\ud83c\udfe2',
  PILLAR2_LOW_ETR: '\ud83c\udf10',
  PILLAR2_TOPUP_RISK: '\ud83c\udf10',
  PILLAR2_TRIGGER: '\ud83c\udf10',
  TRANSFER_PRICING_RISK: '\ud83d\udcb1',
  NO_JURISDICTION: '\ud83d\udea9',
};

function friendlyRiskLine(flag: RiskFlag, nodeName: string, jurisdiction: string, lang: Language): string {
  const labelKey = RISK_LABEL_KEYS[flag.type];
  const label = labelKey ? tFn(labelKey as any, lang) : flag.type;
  const ref = flag.lawRef ? ` (${flag.lawRef})` : '';
  switch (flag.type) {
    case 'CFC_RISK':
      return `${nodeName} (${jurisdiction}) \u2014 ${tFn('riskDescCfc' as any, lang)}${ref}`;
    case 'SUBSTANCE_BREACH':
      return `${nodeName} (${jurisdiction}) \u2014 ${tFn('riskDescSubstance' as any, lang)}${ref}`;
    case 'PILLAR2_LOW_ETR':
      return `${nodeName} (${jurisdiction}) \u2014 ${tFn('riskDescPillar2Low' as any, lang)}${ref}`;
    case 'PILLAR2_TOPUP_RISK':
    case 'PILLAR2_TRIGGER':
      return `${nodeName} (${jurisdiction}) \u2014 ${tFn('riskDescPillar2Exposure' as any, lang)}${ref}`;
    case 'TRANSFER_PRICING_RISK':
      return `${nodeName} \u2014 ${tFn('riskDescTp' as any, lang)}${ref}`;
    case 'NO_JURISDICTION':
      return `${nodeName} \u2014 ${tFn('riskDescNoJurisdiction' as any, lang)}${ref}`;
    default:
      return `${nodeName} (${jurisdiction}) \u2014 ${label}${ref}`;
  }
}

function riskSeverity(type: string): 'HIGH' | 'MEDIUM' | 'LOW' {
  if (type === 'CFC_RISK' || type === 'PILLAR2_LOW_ETR' || type === 'PILLAR2_TOPUP_RISK' || type === 'PILLAR2_TRIGGER') return 'HIGH';
  if (type === 'SUBSTANCE_BREACH' || type === 'TRANSFER_PRICING_RISK') return 'MEDIUM';
  return 'LOW';
}

const SEVERITY_COLORS = {
  HIGH: { bg: 'bg-red-50 dark:bg-red-950/30', border: 'border-red-200 dark:border-red-900/50', text: 'text-red-700 dark:text-red-400' },
  MEDIUM: { bg: 'bg-amber-50 dark:bg-amber-950/30', border: 'border-amber-200 dark:border-amber-900/50', text: 'text-amber-700 dark:text-amber-400' },
  LOW: { bg: 'bg-emerald-50 dark:bg-emerald-950/30', border: 'border-emerald-200 dark:border-emerald-900/50', text: 'text-emerald-700 dark:text-emerald-400' },
};

function SummaryContent() {
  const s = useAtomValue(globalSummaryAtom);
  const risks = useAtomValue(riskCalculationAtom);
  const project = useAtomValue(projectAtom);
  const ccy = currencySymbol(s.baseCurrency);
  const [riskPopoverOpen, setRiskPopoverOpen] = useState(false);
  const { t, lang } = useTranslation();

  const togglePopover = useCallback(() => {
    setRiskPopoverOpen((prev) => !prev);
  }, []);

  // Build friendly risk entries
  const riskEntries: Array<{ icon: string; severity: 'HIGH' | 'MEDIUM' | 'LOW'; text: string }> = [];
  if (project && risks.nodeRisks) {
    for (const [nodeId, flags] of Object.entries(risks.nodeRisks)) {
      const node = project.nodes.find((n) => n.id === nodeId);
      if (!node) continue;
      const zone = project.zones.find((z) => z.id === node.zoneId);
      for (const flag of flags as RiskFlag[]) {
        riskEntries.push({
          icon: RISK_ICONS[flag.type] || '\u26a0\ufe0f',
          severity: riskSeverity(flag.type),
          text: friendlyRiskLine(flag, node.name, zone?.jurisdiction || 'N/A', lang),
        });
      }
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Global ETR */}
      <div className="flex justify-between items-end pb-4 border-b border-black/5 dark:border-white/5">
        <span className="text-[12px] text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider">{t('globalEtr')}</span>
        <span className={`text-[32px] leading-none font-black tracking-tight ${s.globalEtr > 25 ? 'text-red-500' : s.globalEtr > 15 ? 'text-amber-500' : 'text-emerald-500'}`}>
          {s.globalEtr.toFixed(2)}<span className="text-xl ml-0.5">%</span>
        </span>
      </div>

      {/* Metrics grid */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-black/5 dark:bg-white/5 rounded-xl p-3 shadow-inner">
          <span className="block text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">{t('totalIncome')}</span>
          <span className="text-[14px] font-bold text-slate-700 dark:text-slate-200">
            {ccy} {fmtMoney(s.totalIncome)}
          </span>
        </div>
        <div className="bg-red-500/10 dark:bg-red-900/20 rounded-xl p-3 shadow-inner">
          <span className="block text-[10px] font-bold text-red-500/80 dark:text-red-400/80 uppercase tracking-widest mb-1">{t('taxBurden')}</span>
          <span className="text-[14px] font-bold text-red-600 dark:text-red-400">
            {ccy} {fmtMoney(s.totalTax)}
          </span>
        </div>
        <div className="bg-black/5 dark:bg-white/5 rounded-xl p-3 shadow-inner">
          <span className="block text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">{t('cit')}</span>
          <span className="text-[14px] font-bold text-slate-700 dark:text-slate-200">
            {ccy} {fmtMoney(s.totalCit)}
          </span>
        </div>
        <div className="bg-black/5 dark:bg-white/5 rounded-xl p-3 shadow-inner">
          <span className="block text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1">{t('wht')}</span>
          <span className="text-[14px] font-bold text-slate-700 dark:text-slate-200">
            {ccy} {fmtMoney(s.totalWht)}
          </span>
        </div>
      </div>

      {/* Structure summary */}
      <div className="flex gap-4 pt-1 pb-1 text-[11px] font-semibold text-slate-400 dark:text-slate-500">
        <div className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-indigo-400/50"></span> {s.nodeCount} {t('companies')}</div>
        <div className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-slate-400/50"></span> {s.flowCount} {t('flowsCount')}</div>
      </div>

      {/* Risk indicator — clickable to open popover */}
      {s.totalRisks > 0 && (
        <div className="relative">
          <div
            onClick={togglePopover}
            className="flex justify-between items-center bg-amber-500/10 dark:bg-amber-900/20 hover:bg-amber-500/20 dark:hover:bg-amber-900/30 transition-colors p-3 rounded-xl cursor-pointer mt-1 border border-amber-200/50 dark:border-amber-900/50"
          >
            <span className="text-amber-700 dark:text-amber-400 font-bold text-[12px] uppercase tracking-wider">{t('activeRisks')}</span>
            <span className="bg-amber-500 text-white dark:bg-amber-600 px-2.5 py-0.5 rounded-full font-bold text-[12px] shadow-sm">
              {s.totalRisks}
            </span>
          </div>

          {/* Risk Popover — Liquid Glass */}
          {riskPopoverOpen && riskEntries.length > 0 && (
            <div className="absolute top-full right-0 mt-2 w-[340px] max-h-[300px] overflow-y-auto bg-white/80 dark:bg-slate-900/80 backdrop-blur-2xl border border-black/10 dark:border-white/10 rounded-2xl shadow-2xl p-4 z-50">
              <div className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-3">
                {t('riskDetails')}
              </div>
              <div className="flex flex-col gap-2">
                {riskEntries.map((entry, i) => {
                  const sc = SEVERITY_COLORS[entry.severity];
                  return (
                    <div
                      key={i}
                      className={`flex items-start gap-3 p-3 rounded-xl border ${sc.bg} ${sc.border}`}
                    >
                      <span className="text-[16px] shrink-0 mt-0.5">{entry.icon}</span>
                      <div className="flex-1">
                        <span className={`text-[9px] font-black uppercase tracking-widest ${sc.text}`}>
                          {t(entry.severity.toLowerCase() as any)}
                        </span>
                        <p className="mt-0.5 text-[12px] text-slate-700 dark:text-slate-300 font-medium leading-snug">
                          {entry.text}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function GlobalSummaryWidget() {
  const { t } = useTranslation();
  return (
    <div
      data-testid="global-summary"
      className="absolute top-3 right-5 w-[280px] bg-white/70 dark:bg-slate-950/70 backdrop-blur-2xl border border-black/5 dark:border-white/5 shadow-xl shadow-black/5 dark:shadow-white/5 rounded-2xl p-5 z-40 transition-all hover:shadow-2xl hover:-translate-y-0.5 duration-300"
    >
      <h3 className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-4">
        {t('executiveSummary')}
      </h3>
      <Suspense fallback={<div className="text-[12px] font-semibold text-slate-400 dark:text-slate-500 animate-pulse">{t('calculatingSummary')}</div>}>
        <SummaryContent />
      </Suspense>
    </div>
  );
}
