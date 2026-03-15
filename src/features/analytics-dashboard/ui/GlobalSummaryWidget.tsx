'use client';

/**
 * GlobalSummaryWidget — executive dashboard showing Global ETR,
 * total tax burden, income, and risk count.
 *
 * Positioned in top-right of the viewport, outside the zoom/pan area.
 * Wrapped in Suspense because globalSummaryAtom is async.
 */

import { useAtomValue } from 'jotai';
import { Suspense } from 'react';
import { globalSummaryAtom } from '../model/atoms';
import { fmtMoney, currencySymbol } from '@shared/lib/engine/utils';

function SummaryContent() {
  const s = useAtomValue(globalSummaryAtom);
  const ccy = currencySymbol(s.baseCurrency);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {/* Global ETR */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderBottom: '1px solid #e5e7eb', paddingBottom: '8px' }}>
        <span style={{ fontSize: '12px', color: '#6b7280', fontWeight: 500 }}>Global ETR</span>
        <span style={{ fontSize: '24px', fontWeight: 700, color: s.globalEtr > 25 ? '#dc2626' : s.globalEtr > 15 ? '#d97706' : '#16a34a' }}>
          {s.globalEtr.toFixed(2)}%
        </span>
      </div>

      {/* Metrics grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
        <div>
          <span style={{ display: 'block', fontSize: '11px', color: '#9ca3af', fontWeight: 500 }}>Total Income</span>
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#111827' }}>
            {ccy} {fmtMoney(s.totalIncome)}
          </span>
        </div>
        <div>
          <span style={{ display: 'block', fontSize: '11px', color: '#9ca3af', fontWeight: 500 }}>Tax Burden</span>
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#dc2626' }}>
            {ccy} {fmtMoney(s.totalTax)}
          </span>
        </div>
        <div>
          <span style={{ display: 'block', fontSize: '11px', color: '#9ca3af', fontWeight: 500 }}>CIT</span>
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#374151' }}>
            {ccy} {fmtMoney(s.totalCit)}
          </span>
        </div>
        <div>
          <span style={{ display: 'block', fontSize: '11px', color: '#9ca3af', fontWeight: 500 }}>WHT</span>
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#374151' }}>
            {ccy} {fmtMoney(s.totalWht)}
          </span>
        </div>
      </div>

      {/* Structure summary */}
      <div style={{ fontSize: '11px', color: '#9ca3af', display: 'flex', gap: '12px', borderTop: '1px solid #f3f4f6', paddingTop: '6px' }}>
        <span>{s.nodeCount} companies</span>
        <span>{s.flowCount} flows</span>
      </div>

      {/* Risk indicator */}
      {s.totalRisks > 0 && (
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          borderTop: '1px solid #fef3c7', paddingTop: '8px', fontSize: '13px',
        }}>
          <span style={{ color: '#b45309', fontWeight: 600 }}>Active Risks</span>
          <span style={{
            background: '#fef3c7', color: '#92400e', padding: '2px 10px',
            borderRadius: '12px', fontWeight: 700, fontSize: '12px',
          }}>
            {s.totalRisks}
          </span>
        </div>
      )}
    </div>
  );
}

export function GlobalSummaryWidget() {
  return (
    <div
      data-testid="global-summary"
      style={{
        position: 'absolute',
        top: '16px',
        right: '16px',
        width: '260px',
        background: '#fff',
        border: '1px solid #e5e7eb',
        boxShadow: '0 4px 16px rgba(0,0,0,0.06)',
        borderRadius: '10px',
        padding: '14px',
        zIndex: 40,
      }}
    >
      <h3 style={{
        fontSize: '10px', fontWeight: 700, color: '#9ca3af',
        textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '10px',
      }}>
        Executive Summary
      </h3>
      <Suspense fallback={<div style={{ fontSize: '12px', color: '#9ca3af' }}>Calculating...</div>}>
        <SummaryContent />
      </Suspense>
    </div>
  );
}
