'use client';

import { useAtomValue } from 'jotai';
import { Suspense, useState } from 'react';
import { accountingLedgerAtom } from '../model/atoms';
import type { LedgerRow } from '../model/atoms';
import { useTranslation, localizedName } from '@shared/lib/i18n';

function formatAmount(amount: number, currency: string): string {
  return `${amount.toFixed(2)} ${currency}`;
}

function AuditLogTable() {
  const { entries, pipelineSteps, baseCurrency } = useAtomValue(accountingLedgerAtom);
  const { t, lang } = useTranslation();

  if (!entries || entries.length === 0) {
    return (
      <div className="p-6 text-[13px] font-medium text-slate-500 dark:text-slate-400">
        {t('noEntries')}
        {pipelineSteps.length > 0 && (
          <div className="mt-2 text-[11px] font-mono text-slate-400 dark:text-slate-500">
            Pipeline ran {pipelineSteps.length} step(s): {pipelineSteps.map((s) => s.name).join(' → ')}
          </div>
        )}
      </div>
    );
  }

  return (
    <table className="w-full text-left border-collapse">
      <thead className="bg-black/5 dark:bg-white/5 sticky top-0 backdrop-blur-md z-10">
        <tr>
          <th className="px-4 py-2 text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest border-b border-black/5 dark:border-white/5 whitespace-nowrap">{t('taxType')}</th>
          <th className="px-4 py-2 text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest border-b border-black/5 dark:border-white/5 whitespace-nowrap">{t('payer')}</th>
          <th className="px-4 py-2 text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest border-b border-black/5 dark:border-white/5 whitespace-nowrap">{t('zone')}</th>
          <th className="px-4 py-2 text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest border-b border-black/5 dark:border-white/5 whitespace-nowrap text-right">{t('amount')} ({baseCurrency})</th>
          <th className="px-4 py-2 text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest border-b border-black/5 dark:border-white/5 whitespace-nowrap text-right">{t('amount')} (Func.)</th>
          <th className="px-4 py-2 text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest border-b border-black/5 dark:border-white/5 whitespace-nowrap text-right">{t('amount')} (Orig.)</th>
          <th className="px-4 py-2 text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest border-b border-black/5 dark:border-white/5 whitespace-nowrap text-center">{t('fxDate')}</th>
          <th className="px-4 py-2 text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest border-b border-black/5 dark:border-white/5 whitespace-nowrap text-center">{t('status')}</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((tx: LedgerRow, idx: number) => (
          <tr key={tx.id || idx} className="border-b border-black/5 dark:border-white/5 hover:bg-black/5 dark:hover:bg-white/5 transition-colors">
            <td className="px-4 py-2 text-[12px] whitespace-nowrap font-mono text-indigo-600 dark:text-indigo-400 bg-indigo-50/50 dark:bg-indigo-950/20">{tx.taxType}</td>
            <td className="px-4 py-2 text-[12px] font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap">{tx.payerId}</td>
            <td className="px-4 py-2 text-[12px] text-slate-500 dark:text-slate-400 whitespace-nowrap">{tx.zoneId}</td>
            <td className="px-4 py-2 text-[13px] font-bold text-slate-800 dark:text-slate-100 whitespace-nowrap text-right font-mono">
              {formatAmount(tx.amountBase, baseCurrency)}
            </td>
            <td className="px-4 py-2 text-[12px] text-slate-600 dark:text-slate-400 whitespace-nowrap text-right font-mono">
              {formatAmount(tx.amountFunctional, tx.functionalCurrency)}
            </td>
            <td className="px-4 py-2 text-[12px] text-slate-400 dark:text-slate-500 whitespace-nowrap text-right font-mono">
              {formatAmount(tx.amountOriginal, tx.originalCurrency)}
            </td>
            <td className="px-4 py-2 text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap text-center">{tx.fxDate}</td>
            <td className="px-4 py-2 whitespace-nowrap text-center">
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest ${
                tx.status === 'pending' ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400' :
                tx.status === 'paid' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' :
                'bg-slate-500/10 text-slate-600 dark:text-slate-400'
              }`}>
                {tx.status}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function AuditLogPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const { t } = useTranslation();

  return (
    <div 
      className={`absolute bottom-0 left-0 w-full transition-all duration-300 ease-in-out z-50 overflow-hidden flex flex-col ${isOpen ? 'h-[288px]' : 'h-[40px]'}`}
    >
      <div className="w-full absolute inset-0 bg-white/70 dark:bg-slate-950/80 backdrop-blur-2xl border-t border-black/5 dark:border-white/5 shadow-[0_-4px_24px_rgba(0,0,0,0.04)] pointer-events-none -z-10" />

      <div
        onClick={() => setIsOpen(!isOpen)}
        className="w-full h-[40px] shrink-0 flex items-center justify-between px-6 cursor-pointer border-b border-black/5 dark:border-white/5 bg-transparent hover:bg-black/5 dark:hover:bg-white/5 transition-colors select-none"
      >
        <div className="flex items-center gap-2">
          <span className="font-bold text-[12px] uppercase tracking-widest text-slate-600 dark:text-slate-300">
            {t('auditLogTitle')}
          </span>
          <span className="bg-indigo-500/10 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400 px-2 py-0.5 rounded-full text-[10px] font-bold">LIVE</span>
        </div>
        <span className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
          {isOpen ? `▼ ${t('close')}` : `▲ ${t('open')}`}
        </span>
      </div>

      {isOpen && (
        <Suspense fallback={
          <div className="p-4 text-[13px] font-semibold text-slate-400 dark:text-slate-500 animate-pulse">
            {t('generatingLedger')}
          </div>
        }>
          <div className="flex-1 overflow-auto w-full relative">
            <AuditLogTable />
          </div>
        </Suspense>
      )}
    </div>
  );
}
