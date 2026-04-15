'use client';

/**
 * LedgerTable — Filtered flow ledger for the Reports tab.
 *
 * Mandatory sort: flowDate → flowId (chronological).
 * Mandatory columns: Date, Flow Type, From, To, Gross, Net, WHT, Compliance Status.
 * Compliance Status renders ONLY the exact text strings "OK" or "Violation acknowledged".
 *
 * No useEffect. All derived state via useMemo.
 */

import { useMemo } from 'react';
import { useTranslation, localizedName } from '@shared/lib/i18n';
import { fmtMoney } from '@shared/lib/engine/utils';

// ─── Inline Types ────────────────────────────────────────────────────────────

type LedgerRow = {
  flowId: string;
  date: string;
  flowType: string;
  fromName: string;
  toName: string;
  gross: number;
  net: number;
  wht: number;
  complianceStatus: 'OK' | 'Violation acknowledged';
  currency: string;
  dttApplied: boolean;
  zoneName: string;
  tags: ReadonlyArray<string>;
  lawRef?: string;
};

// ─── Styles ──────────────────────────────────────────────────────────────────

// ─── Tailwind Classes ────────────────────────────────────────────────────────
const twContainer = "overflow-auto flex-1 font-sans";
const twTable = "w-full text-[12px] text-left border-collapse";
const twTh = "px-3 py-2 border-b-2 border-black/10 dark:border-white/10 font-bold whitespace-nowrap text-slate-500 shrink-0 text-[10px] uppercase tracking-widest sticky top-0 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md shadow-sm z-10";
const twTd = "px-3 py-2 whitespace-nowrap border-b border-black/5 dark:border-white/5 text-slate-800 dark:text-slate-200 group-hover:bg-transparent";
const twTdMoney = `${twTd} text-right tabular-nums font-mono font-medium`;
const twEmpty = "p-10 text-center text-slate-500 text-[13px]";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  if (!iso) return '-';
  return iso.slice(0, 10);
}

// ─── Component ───────────────────────────────────────────────────────────────

export function LedgerTable(props: {
  rows: ReadonlyArray<LedgerRow>;
  visibleOptionalColumns: ReadonlyArray<string>;
}) {
  const { rows, visibleOptionalColumns } = props;
  const { t, lang } = useTranslation();

  // Mandatory sort: chronological by flowDate → flowId
  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const dateCompare = a.date.localeCompare(b.date);
      if (dateCompare !== 0) return dateCompare;
      return a.flowId.localeCompare(b.flowId);
    });
    return copy;
  }, [rows]);

  const showCurrency = visibleOptionalColumns.includes('currency');
  const showDtt = visibleOptionalColumns.includes('dttApplied');
  const showZone = visibleOptionalColumns.includes('zone');
  const showTags = visibleOptionalColumns.includes('tags');

  if (sorted.length === 0) {
    return (
      <div className={twEmpty}>
        {t('noFlowsMatch')}
      </div>
    );
  }

  return (
    <div className={twContainer}>
      <table className={twTable}>
        <thead>
          <tr>
            <th className={twTh}>{t('colDate')}</th>
            <th className={twTh}>{t('colFlowType')}</th>
            <th className={twTh}>{t('colFrom')}</th>
            <th className={twTh}>{t('colTo')}</th>
            <th className={`${twTh} text-right`}>{t('colGross')}</th>
            <th className={`${twTh} text-right`}>{t('colNet')}</th>
            <th className={`${twTh} text-right`}>{t('colWht')}</th>
            <th className={twTh}>{t('colCompliance')}</th>
            <th className={twTh}>{t('colLawRef')}</th>
            {showCurrency && <th className={twTh}>{t('colCurrency')}</th>}
            {showDtt && <th className={twTh}>{t('colDttApplied')}</th>}
            {showZone && <th className={twTh}>{t('colZone')}</th>}
            {showTags && <th className={twTh}>{t('colTags')}</th>}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr
              key={row.flowId}
              className="group odd:bg-black/[0.02] dark:odd:bg-white/[0.02] hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-colors"
            >
              <td className={twTd}>{fmtDate(row.date)}</td>
              <td className={twTd}>{row.flowType}</td>
              <td className={twTd}>{row.fromName}</td>
              <td className={twTd}>{row.toName}</td>
              <td className={`${twTdMoney} font-semibold`}>{fmtMoney(row.gross)}</td>
              <td className={`${twTdMoney} font-semibold text-slate-900 dark:text-slate-100`}>{fmtMoney(row.net)}</td>
              <td className={`${twTdMoney} text-red-600 dark:text-red-400`}>{fmtMoney(row.wht)}</td>
              <td className={twTd}>
                <span
                  className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium ${
                    row.complianceStatus === 'OK'
                      ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                      : 'bg-red-500/10 text-red-700 dark:text-red-400'
                  }`}
                >
                  {row.complianceStatus === 'OK' ? t('statusOk') : t('violationAcknowledged')}
                </span>
              </td>
              <td className={`${twTd} text-[11px] text-slate-500 dark:text-slate-400`}>{row.lawRef || '-'}</td>
              {showCurrency && <td className={twTd}>{row.currency}</td>}
              {showDtt && (
                <td className={twTd}>{row.dttApplied ? 'Yes' : 'No'}</td>
              )}
              {showZone && <td className={twTd}>{row.zoneName}</td>}
              {showTags && (
                <td className={twTd}>{row.tags.join(', ') || '-'}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export type { LedgerRow };
