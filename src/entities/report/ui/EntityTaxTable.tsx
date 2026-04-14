'use client';

/**
 * EntityTaxTable — Per-entity tax summary for the Reports tab.
 *
 * Columns: Entity Name, Zone, Total Inflows, Total Outflows,
 *          Pre-Tax Income, CIT Rate, CIT Amount.
 *
 * Reacts to the same Query Builder filters as LedgerTable:
 * Inflows/Outflows are calculated only from flows that pass filters.
 *
 * No useEffect. All derived state via useMemo.
 */

import { useMemo } from 'react';
import type { Project } from '@shared/types';
import { computeGroupTax, effectiveEtrForCompany } from '@shared/lib/engine/engine-tax';
import { useTranslation, localizedName } from '@shared/lib/i18n';
import { fmtMoney, fmtPercent, bankersRound2 } from '@shared/lib/engine/utils';

// ─── Types ──────────────────────────────────────────────────────────────────

export type EntityTaxRow = {
  nodeId: string;
  entityName: string;
  zoneName: string;
  jurisdiction: string;
  totalInflows: number;
  totalOutflows: number;
  preTaxIncome: number;
  citRate: number;
  citAmount: number;
  currency: string;
  calculationBreakdown: string;
};

// ─── Tailwind Classes ────────────────────────────────────────────────────────
const twContainer = "overflow-auto border-b border-black/10 dark:border-white/10 font-sans";
const twTable = "w-full border-collapse text-[13px]";
const twTh = "px-4 py-3 text-left text-[11px] font-bold text-slate-500 uppercase tracking-widest border-b border-black/10 dark:border-white/10 sticky top-0 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md whitespace-nowrap z-10";
const twThRight = `${twTh} text-right`;
const twTd = "px-4 py-2 border-b border-black/5 dark:border-white/5 text-slate-800 dark:text-slate-200 whitespace-nowrap group-hover:bg-transparent";
const twTdRight = `${twTd} text-right tabular-nums`;
const twSectionTitle = "px-6 pt-5 pb-2 text-[13px] font-bold text-slate-900 dark:text-slate-100 uppercase tracking-wide flex flex-col";

// ─── Component ───────────────────────────────────────────────────────────────

interface EntityTaxTableProps {
  project: Project;
  selectedTags: ReadonlyArray<string>;
  selectedZoneIds: ReadonlyArray<string>;
  dateFrom: string;
  dateTo: string;
}

export function EntityTaxTable({
  project,
  selectedTags,
  selectedZoneIds,
  dateFrom,
  dateTo,
}: EntityTaxTableProps) {
  const { t, lang } = useTranslation();

  const rows: EntityTaxRow[] = useMemo(() => {
    // Build node ID sets for tag/zone filters
    const taggedNodeIds =
      selectedTags.length > 0
        ? new Set(
            project.nodes
              .filter((n) => (n.managementTags ?? []).some((t) => selectedTags.includes(t)))
              .map((n) => n.id),
          )
        : null;

    const zonedNodeIds =
      selectedZoneIds.length > 0
        ? new Set(
            project.nodes
              .filter((n) => n.zoneId && selectedZoneIds.includes(n.zoneId))
              .map((n) => n.id),
          )
        : null;

    // Filter flows using same logic as LedgerTable
    const filteredFlows = project.flows.filter((f) => {
      if (taggedNodeIds && !taggedNodeIds.has(f.fromId) && !taggedNodeIds.has(f.toId)) return false;
      if (zonedNodeIds && !zonedNodeIds.has(f.fromId) && !zonedNodeIds.has(f.toId)) return false;
      const flowDate = (f.flowDate ?? '').slice(0, 10);
      if (dateFrom && flowDate < dateFrom) return false;
      if (dateTo && flowDate > dateTo) return false;
      return true;
    });

    // Accumulate inflows/outflows per node
    const inflowMap = new Map<string, number>();
    const outflowMap = new Map<string, number>();

    for (const f of filteredFlows) {
      const gross = Number(f.grossAmount || 0);
      if (gross <= 0) continue;
      inflowMap.set(f.toId, (inflowMap.get(f.toId) ?? 0) + gross);
      outflowMap.set(f.fromId, (outflowMap.get(f.fromId) ?? 0) + gross);
    }

    // Zone lookup
    const zoneMap = new Map(project.zones.map((z) => [z.id, z]));

    // Compute group tax to get engine CIT liabilities with breakdowns
    const groupTax = computeGroupTax(project);
    const citByNodeId = new Map(groupTax.citLiabilities.map((c) => [c.nodeId, c]));

    // Build rows for company nodes only (persons/txa don't pay CIT)
    return project.nodes
      .filter((n) => n.type === 'company')
      .map((n): EntityTaxRow => {
        const zone = n.zoneId ? zoneMap.get(n.zoneId) : undefined;
        const totalInflows = inflowMap.get(n.id) ?? 0;
        const totalOutflows = outflowMap.get(n.id) ?? 0;
        const preTaxIncome = n.annualIncome > 0 ? n.annualIncome : totalInflows - totalOutflows;
        const engineCit = citByNodeId.get(n.id);
        const citRate = engineCit?.citRate ?? effectiveEtrForCompany(project, n);
        const citAmount = engineCit?.citAmount ?? bankersRound2(Math.max(0, preTaxIncome) * citRate);

        return {
          nodeId: n.id,
          entityName: n.name,
          zoneName: zone ? `${localizedName(zone.name, lang)} (${zone.jurisdiction})` : '-',
          jurisdiction: zone?.jurisdiction ?? '-',
          totalInflows: bankersRound2(totalInflows),
          totalOutflows: bankersRound2(totalOutflows),
          preTaxIncome: bankersRound2(preTaxIncome),
          citRate,
          citAmount,
          currency: zone?.currency ?? project.baseCurrency,
          calculationBreakdown: engineCit?.calculationBreakdown ?? '-',
        };
      })
      .sort((a, b) => a.entityName.localeCompare(b.entityName));
  }, [project, selectedTags, selectedZoneIds, dateFrom, dateTo]);

  return (
    <div>
      <div className={twSectionTitle}>
        <span className="text-slate-500">{t('overview')}</span>
        {t('entityTaxSummary')}
      </div>
      <div className={twContainer}>
        {rows.length === 0 ? (
          <div className="p-10 text-center text-slate-500 text-[13px]">{t('noCompanyEntities')}</div>
        ) : (
          <table className={twTable}>
            <thead>
              <tr>
                <th className={twTh}>{t('entityName')}</th>
                <th className={twTh}>{t('zone')}</th>
                <th className={twThRight}>{t('totalInflows')}</th>
                <th className={twThRight}>{t('totalOutflows')}</th>
                <th className={twThRight}>{t('preTaxIncome')}</th>
                <th className={twThRight}>{t('citRateCol')}</th>
                <th className={twThRight}>{t('citAmountCol')}</th>
                <th className={twTh}>{t('breakdown')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.nodeId}
                  className="group odd:bg-black/[0.02] dark:odd:bg-white/[0.02] hover:bg-black-[0.04] dark:hover:bg-white-[0.04] transition-colors"
                >
                  <td className={`${twTd} font-semibold`}>{r.entityName}</td>
                  <td className={twTd}>{r.zoneName}</td>
                  <td className={twTdRight}>{fmtMoney(r.totalInflows)}</td>
                  <td className={twTdRight}>{fmtMoney(r.totalOutflows)}</td>
                  <td className={`${twTdRight} font-bold ${r.preTaxIncome < 0 ? 'text-red-500' : 'text-slate-900 dark:text-slate-100'}`}>
                    {fmtMoney(r.preTaxIncome)}
                  </td>
                  <td className={twTdRight}>{fmtPercent(r.citRate)}</td>
                  <td className={`${twTdRight} font-bold text-red-600 dark:text-red-400`}>
                    {fmtMoney(r.citAmount)}
                  </td>
                  <td className={`${twTd} text-[10px] text-slate-500 italic max-w-[200px] truncate`} title={r.calculationBreakdown}>
                    {r.calculationBreakdown}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
