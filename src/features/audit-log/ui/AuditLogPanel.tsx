'use client';

import { useAtomValue } from 'jotai';
import { Suspense, useState } from 'react';
import { accountingLedgerAtom } from '../model/atoms';
import type { LedgerRow } from '../model/atoms';

function formatAmount(amount: number, currency: string): string {
  return `${amount.toFixed(2)} ${currency}`;
}

function AuditLogTable() {
  const { entries, pipelineSteps, baseCurrency } = useAtomValue(accountingLedgerAtom);

  if (!entries || entries.length === 0) {
    return (
      <div style={{ padding: '16px', fontSize: '13px', color: '#6b7280' }}>
        No tax entries recorded yet.
        {pipelineSteps.length > 0 && (
          <div style={{ marginTop: '8px', fontSize: '11px', color: '#9ca3af' }}>
            Pipeline ran {pipelineSteps.length} step(s): {pipelineSteps.map((s) => s.name).join(' → ')}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ overflow: 'auto', maxHeight: '220px' }}>
      <table style={{ width: '100%', fontSize: '12px', textAlign: 'left', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: '#f3f4f6', position: 'sticky', top: 0 }}>
            <th style={thStyle}>Tax Type</th>
            <th style={thStyle}>Payer</th>
            <th style={thStyle}>Zone</th>
            <th style={thStyle}>Amount ({baseCurrency})</th>
            <th style={thStyle}>Amount (Func.)</th>
            <th style={thStyle}>Amount (Orig.)</th>
            <th style={thStyle}>FX Date</th>
            <th style={thStyle}>Status</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((tx: LedgerRow, idx: number) => (
            <tr key={tx.id || idx} style={{ borderBottom: '1px solid #e5e7eb' }}>
              <td style={tdStyle}><code>{tx.taxType}</code></td>
              <td style={tdStyle}>{tx.payerId}</td>
              <td style={tdStyle}>{tx.zoneId}</td>
              <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>
                {formatAmount(tx.amountBase, baseCurrency)}
              </td>
              <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace' }}>
                {formatAmount(tx.amountFunctional, tx.functionalCurrency)}
              </td>
              <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace' }}>
                {formatAmount(tx.amountOriginal, tx.originalCurrency)}
              </td>
              <td style={tdStyle}>{tx.fxDate}</td>
              <td style={tdStyle}>
                <span style={{
                  padding: '1px 6px',
                  borderRadius: '4px',
                  fontSize: '10px',
                  fontWeight: 600,
                  background: tx.status === 'pending' ? '#fef3c7' : tx.status === 'paid' ? '#d1fae5' : '#f3f4f6',
                  color: tx.status === 'pending' ? '#92400e' : tx.status === 'paid' ? '#065f46' : '#374151',
                }}>
                  {tx.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: '6px 8px',
  borderBottom: '2px solid #d1d5db',
  fontWeight: 600,
  whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
  padding: '4px 8px',
  whiteSpace: 'nowrap',
};

export function AuditLogPanel() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div style={{
      position: 'absolute',
      bottom: 0,
      left: 0,
      width: '100%',
      background: '#fff',
      borderTop: '1px solid #d1d5db',
      boxShadow: '0 -2px 8px rgba(0,0,0,0.08)',
      transition: 'height 0.3s ease',
      zIndex: 50,
      height: isOpen ? '288px' : '40px',
      overflow: 'hidden',
    }}>
      <div
        onClick={() => setIsOpen(!isOpen)}
        style={{
          width: '100%',
          height: '40px',
          background: '#f9fafb',
          borderBottom: '1px solid #e5e7eb',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px',
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <span style={{ fontWeight: 600, fontSize: '13px', color: '#374151' }}>
          Audit Log & Accounting
        </span>
        <span style={{ fontSize: '11px', color: '#6b7280' }}>
          {isOpen ? '\u25BC Close' : '\u25B2 Open'}
        </span>
      </div>

      {isOpen && (
        <Suspense fallback={
          <div style={{ padding: '16px', fontSize: '13px', color: '#6b7280' }}>
            Generating ledger...
          </div>
        }>
          <AuditLogTable />
        </Suspense>
      )}
    </div>
  );
}
