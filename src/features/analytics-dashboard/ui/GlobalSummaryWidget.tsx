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

// ─── Risk Type → Friendly Description ──────────────────────────────────────

const RISK_LABELS: Record<string, string> = {
  CFC_RISK: 'CFC Risk',
  SUBSTANCE_BREACH: 'Substance Breach',
  AIFC_PRESENCE_BREACH: 'AIFC Presence Breach',
  PILLAR2_LOW_ETR: 'Pillar Two Low ETR',
  PILLAR2_TOPUP_RISK: 'Pillar Two Top-Up Risk',
  PILLAR2_TRIGGER: 'Pillar Two Exposure Risk',
  TRANSFER_PRICING_RISK: 'Transfer Pricing Risk',
  CASH_LIMIT_EXCEEDED: 'Cash Limit Exceeded',
  INTERIM_DIVIDENDS_RISK: 'Interim Dividends Risk',
  CONSTRUCTIVE_DIVIDEND: 'Constructive Dividend',
  NO_JURISDICTION: 'No Jurisdiction Assigned',
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

function friendlyRiskLine(flag: RiskFlag, nodeName: string, jurisdiction: string): string {
  const label = RISK_LABELS[flag.type] || flag.type;
  const ref = flag.lawRef ? ` (${flag.lawRef})` : '';
  switch (flag.type) {
    case 'CFC_RISK':
      return `${nodeName} (${jurisdiction}) — controlled foreign corporation rules may apply${ref}`;
    case 'SUBSTANCE_BREACH':
      return `${nodeName} (${jurisdiction}) — lacks required economic substance${ref}`;
    case 'PILLAR2_LOW_ETR':
      return `${nodeName} (${jurisdiction}) — ETR below 15% GloBE minimum${ref}`;
    case 'PILLAR2_TOPUP_RISK':
    case 'PILLAR2_TRIGGER':
      return `${nodeName} (${jurisdiction}) — Pillar Two exposure: ETR below 15% GloBE minimum${ref}`;
    case 'TRANSFER_PRICING_RISK':
      return `${nodeName} — arm's-length compliance risk detected${ref}`;
    case 'NO_JURISDICTION':
      return `${nodeName} — not assigned to any tax jurisdiction`;
    default:
      return `${nodeName} (${jurisdiction}) — ${label}${ref}`;
  }
}

function riskSeverity(type: string): 'HIGH' | 'MEDIUM' | 'LOW' {
  if (type === 'CFC_RISK' || type === 'PILLAR2_LOW_ETR' || type === 'PILLAR2_TOPUP_RISK' || type === 'PILLAR2_TRIGGER') return 'HIGH';
  if (type === 'SUBSTANCE_BREACH' || type === 'TRANSFER_PRICING_RISK') return 'MEDIUM';
  return 'LOW';
}

const SEVERITY_COLORS = {
  HIGH: { bg: '#fef2f2', border: '#fecaca', text: '#dc2626' },
  MEDIUM: { bg: '#fffbeb', border: '#fde68a', text: '#d97706' },
  LOW: { bg: '#f0fdf4', border: '#bbf7d0', text: '#16a34a' },
};

function SummaryContent() {
  const s = useAtomValue(globalSummaryAtom);
  const risks = useAtomValue(riskCalculationAtom);
  const project = useAtomValue(projectAtom);
  const ccy = currencySymbol(s.baseCurrency);
  const [riskPopoverOpen, setRiskPopoverOpen] = useState(false);

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
          text: friendlyRiskLine(flag, node.name, zone?.jurisdiction || 'N/A'),
        });
      }
    }
  }

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

      {/* Risk indicator — clickable to open popover */}
      {s.totalRisks > 0 && (
        <div style={{ position: 'relative' }}>
          <div
            onClick={togglePopover}
            style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              borderTop: '1px solid #fef3c7', paddingTop: '8px', fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            <span style={{ color: '#b45309', fontWeight: 600 }}>Active Risks</span>
            <span style={{
              background: '#fef3c7', color: '#92400e', padding: '2px 10px',
              borderRadius: '12px', fontWeight: 700, fontSize: '12px',
            }}>
              {s.totalRisks}
            </span>
          </div>

          {/* Risk Popover — Liquid Glass */}
          {riskPopoverOpen && riskEntries.length > 0 && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                right: 0,
                marginTop: '8px',
                width: '320px',
                maxHeight: '300px',
                overflowY: 'auto',
                background: 'rgba(255, 255, 255, 0.85)',
                backdropFilter: 'blur(40px) saturate(180%)',
                WebkitBackdropFilter: 'blur(40px) saturate(180%)',
                borderRadius: '14px',
                border: '1px solid rgba(0, 0, 0, 0.08)',
                boxShadow: '0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06)',
                padding: '12px',
                zIndex: 50,
              }}
            >
              <div style={{ fontSize: '11px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
                Risk Details
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {riskEntries.map((entry, i) => {
                  const sc = SEVERITY_COLORS[entry.severity];
                  return (
                    <div
                      key={i}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '8px',
                        padding: '8px 10px',
                        borderRadius: '10px',
                        background: sc.bg,
                        border: `1px solid ${sc.border}`,
                      }}
                    >
                      <span style={{ fontSize: '14px', flexShrink: 0, lineHeight: 1.2 }}>{entry.icon}</span>
                      <div style={{ flex: 1 }}>
                        <span style={{ fontSize: '10px', fontWeight: 700, color: sc.text, textTransform: 'uppercase' }}>
                          {entry.severity}
                        </span>
                        <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#374151', lineHeight: 1.4 }}>
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
