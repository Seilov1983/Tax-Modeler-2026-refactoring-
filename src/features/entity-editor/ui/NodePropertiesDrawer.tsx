'use client';

/**
 * NodePropertiesDrawer — Right-hand panel for quick-editing tax compliance
 * properties on the selected node. Opens on single-click (no double-click needed).
 *
 * Controls:
 * - hasSubstance toggle ("Economic Substance")
 * - isIPIncome toggle ("IP Income")
 * - hasSeparateAccounting toggle (AIFC)
 * - headcount, operationalExpenses, payrollCosts (conditional on hasSubstance + Hub/AIFC zone)
 * - Nexus fraction K live preview (when IP income + Hub zone)
 *
 * All changes dispatch immediately via updateNodeAtom (committed to undo stack).
 * Number inputs use MaskedMoneyInput with Intl.NumberFormat thousands separators.
 */

import { useAtomValue, useSetAtom } from 'jotai';
import { useState, useCallback } from 'react';
import { selectionAtom } from '../model/atoms';
import { projectAtom } from '@features/canvas/model/project-atom';
import { updateNodeAtom } from '@features/canvas/model/graph-actions-atom';
import { computeNexusFractionFromFlows } from '@shared/lib/engine/engine-tax';
import { fmtMoney, fmtPercent, fmtInputDisplay, parseInputDisplay, currencySymbol } from '@shared/lib/engine/utils';
import { useTranslation } from '@shared/lib/i18n';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { X, Building2, Cpu, ShieldCheck, FlaskConical } from 'lucide-react';
import type { NodeDTO, Zone, Project } from '@shared/types';

// ─── Styling ────────────────────────────────────────────────────────────────

const LABEL = 'text-[11px] font-semibold text-slate-500 dark:text-slate-400 tracking-wider uppercase mb-1 block';
const SECTION = 'space-y-3 p-4 border-b border-black/5 dark:border-white/5';

// ─── Masked Money Input (same pattern as FlowModal / EditorModal) ───────────

function MaskedMoneyInput({
  value,
  onChange,
  suffix,
  placeholder,
}: {
  value: number;
  onChange: (n: number) => void;
  suffix?: string;
  placeholder?: string;
}) {
  const [raw, setRaw] = useState('');
  const [focused, setFocused] = useState(false);

  return (
    <div className="relative">
      <Input
        type="text"
        inputMode="decimal"
        value={focused ? raw : fmtInputDisplay(value)}
        placeholder={placeholder}
        onChange={(e) => {
          const v = e.target.value.replace(/[^\d.\s]/g, '');
          setRaw(v);
          onChange(parseInputDisplay(v));
        }}
        onFocus={() => { setFocused(true); setRaw(value ? String(value) : ''); }}
        onBlur={() => { setFocused(false); }}
        className={suffix ? 'pr-10 tabular-nums' : 'tabular-nums'}
      />
      {suffix && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400 pointer-events-none">{suffix}</span>
      )}
    </div>
  );
}

// ─── Hub/AIFC zone detection ────────────────────────────────────────────────

const SUBSTANCE_ZONE_CODES = new Set(['KZ_HUB', 'KZ_AIFC']);

function getNodeZone(project: Project, node: NodeDTO): Zone | null {
  if (!node.zoneId) return null;
  return project.zones.find((z) => z.id === node.zoneId) ?? null;
}

function isSubstanceZone(zone: Zone | null): boolean {
  return !!zone && SUBSTANCE_ZONE_CODES.has(zone.code);
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function NodePropertiesDrawer() {
  const selection = useAtomValue(selectionAtom);
  const project = useAtomValue(projectAtom);
  const updateNode = useSetAtom(updateNodeAtom);
  const { t } = useTranslation();

  // Only show for single-node selection
  const nodeId =
    selection?.type === 'node' && selection.ids.length === 1
      ? selection.ids[0]
      : null;

  const node = nodeId && project ? project.nodes.find((n) => n.id === nodeId) : null;

  // Dismiss handler (clear selection)
  const setSelection = useSetAtom(selectionAtom);
  const handleClose = useCallback(() => setSelection(null), [setSelection]);

  if (!node || !project || node.type !== 'company') return null;

  const zone = getNodeZone(project, node);
  const isHubOrAifc = isSubstanceZone(zone);
  const ccy = zone ? currencySymbol(zone.currency) : '₸';
  const sm = node.substanceMetrics ?? { headcount: 0, operationalExpenses: 0, payrollCosts: 0 };

  // Nexus fraction K (live preview)
  const showNexus = isHubOrAifc && zone?.code === 'KZ_HUB' && !!node.isIPIncome;
  const nexusK = showNexus ? computeNexusFractionFromFlows(project, node) : null;

  // ── Updaters ──────────────────────────────────────────────────────────────
  const patch = (data: Partial<NodeDTO>) => updateNode({ id: node.id, data });

  const toggleSubstance = (checked: boolean) => {
    patch({
      hasSubstance: checked,
      substanceMetrics: checked
        ? (node.substanceMetrics ?? { headcount: 0, operationalExpenses: 0, payrollCosts: 0 })
        : undefined,
    });
  };

  const toggleIPIncome = (checked: boolean) => {
    patch({ isIPIncome: checked });
  };

  const toggleSeparateAccounting = (checked: boolean) => {
    patch({ hasSeparateAccounting: checked });
  };

  const updateSubstanceMetric = (field: 'headcount' | 'operationalExpenses' | 'payrollCosts', value: number) => {
    patch({
      substanceMetrics: { ...sm, [field]: value },
    });
  };

  return (
    <aside
      className="flex-none w-[300px] h-full flex flex-col bg-white/70 dark:bg-slate-950/70 backdrop-blur-2xl border-l border-black/5 dark:border-white/5 shadow-2xl overflow-hidden"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-black/5 dark:border-white/5 bg-white/40 dark:bg-black/40">
        <div className="flex items-center gap-2 min-w-0">
          <Building2 size={16} className="text-indigo-500 shrink-0" />
          <span className="text-[14px] font-bold text-slate-800 dark:text-slate-200 truncate">
            {node.name}
          </span>
        </div>
        <button
          onClick={handleClose}
          className="bg-transparent border-none cursor-pointer text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-md transition-colors shrink-0"
        >
          <X size={16} />
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {/* Zone info */}
        {zone && (
          <div className="px-4 py-2 bg-black/[0.02] dark:bg-white/[0.02] border-b border-black/5 dark:border-white/5">
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              {zone.name} ({zone.jurisdiction}) &mdash; {zone.code}
            </span>
          </div>
        )}

        {/* ── Income summary ─────────────────────────────────────────── */}
        <div className={SECTION}>
          <div className="flex justify-between items-baseline">
            <span className={LABEL}>{t('annualIncome')}</span>
            <span className="text-[14px] font-bold text-slate-800 dark:text-slate-200 tabular-nums">
              {ccy} {fmtMoney(node.annualIncome)}
            </span>
          </div>
          <div className="flex justify-between items-baseline">
            <span className={LABEL}>{t('effectiveEtr')}</span>
            <span className="text-[14px] font-bold text-slate-800 dark:text-slate-200">
              {fmtPercent(node.computedEtr ?? node.etr)}
            </span>
          </div>
        </div>

        {/* ── Tax Compliance Controls ────────────────────────────────── */}
        <div className={SECTION}>
          <div className="flex items-center gap-2 mb-1">
            <ShieldCheck size={14} className="text-indigo-500" />
            <span className="text-[12px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
              {t('taxCompliance')}
            </span>
          </div>

          {/* hasSubstance toggle */}
          <div className="flex items-center justify-between py-1.5">
            <Label className="text-[12px] font-medium text-slate-600 dark:text-slate-400 cursor-pointer">
              {t('hasSubstance')}
            </Label>
            <Switch
              checked={!!node.hasSubstance}
              onCheckedChange={toggleSubstance}
            />
          </div>

          {/* isIPIncome toggle */}
          <div className="flex items-center justify-between py-1.5">
            <Label className="text-[12px] font-medium text-slate-600 dark:text-slate-400 cursor-pointer">
              {t('isIPIncome')}
            </Label>
            <Switch
              checked={!!node.isIPIncome}
              onCheckedChange={toggleIPIncome}
            />
          </div>

          {/* hasSeparateAccounting (for AIFC) */}
          {zone?.code === 'KZ_AIFC' && (
            <div className="flex items-center justify-between py-1.5">
              <Label className="text-[12px] font-medium text-slate-600 dark:text-slate-400 cursor-pointer">
                {t('separateAccounting')}
              </Label>
              <Switch
                checked={!!node.hasSeparateAccounting}
                onCheckedChange={toggleSeparateAccounting}
              />
            </div>
          )}
        </div>

        {/* ── Substance Metrics (conditional) ────────────────────────── */}
        {node.hasSubstance && isHubOrAifc && (
          <div className={SECTION}>
            <div className="flex items-center gap-2 mb-1">
              <FlaskConical size={14} className="text-emerald-500" />
              <span className="text-[12px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                {t('substanceMetrics')}
              </span>
            </div>

            {/* Headcount */}
            <div>
              <Label className={LABEL}>{t('headcount')}</Label>
              <Input
                type="number"
                min={0}
                step={1}
                value={sm.headcount || ''}
                onChange={(e) => updateSubstanceMetric('headcount', parseInt(e.target.value) || 0)}
                placeholder="0"
                className="tabular-nums"
              />
            </div>

            {/* Operational Expenses (OPEX) */}
            <div>
              <Label className={LABEL}>{t('operationalExpenses')}</Label>
              <MaskedMoneyInput
                value={sm.operationalExpenses}
                onChange={(n) => updateSubstanceMetric('operationalExpenses', n)}
                suffix={ccy}
                placeholder="0"
              />
            </div>

            {/* Payroll Costs */}
            <div>
              <Label className={LABEL}>{t('payrollCosts')}</Label>
              <MaskedMoneyInput
                value={sm.payrollCosts}
                onChange={(n) => updateSubstanceMetric('payrollCosts', n)}
                suffix={ccy}
                placeholder="0"
              />
            </div>
          </div>
        )}

        {/* ── Nexus Fraction K (live preview for Hub IP income) ───────── */}
        {showNexus && nexusK !== null && (
          <div className={SECTION}>
            <div className="flex items-center gap-2 mb-2">
              <Cpu size={14} className="text-amber-500" />
              <span className="text-[12px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                Nexus Fraction (BEPS Action 5)
              </span>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-black/[0.03] dark:bg-white/[0.03] p-3">
              <span className="text-[12px] text-slate-500 dark:text-slate-400 font-medium">K =</span>
              <span className="text-[20px] font-black text-slate-800 dark:text-slate-200 tabular-nums">
                {(nexusK * 100).toFixed(1)}%
              </span>
            </div>
            <p className="text-[11px] text-slate-400 dark:text-slate-500 leading-relaxed mt-1">
              {nexusK >= 1
                ? t('nexusFull')
                : t('nexusPartial')}
            </p>
          </div>
        )}

        {/* Risk flags summary */}
        {node.riskFlags.length > 0 && (
          <div className={SECTION}>
            <span className={LABEL}>{t('activeRisks')}</span>
            <div className="flex flex-col gap-1.5">
              {node.riskFlags.map((flag, i) => (
                <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-red-500/5 dark:bg-red-900/10 border border-red-500/10">
                  <span className="text-[11px] font-bold text-red-600 dark:text-red-400">
                    {String(flag.type).replace(/_/g, ' ')}
                  </span>
                  {flag.lawRef && (
                    <span className="text-[10px] text-slate-400 ml-auto shrink-0">{String(flag.lawRef)}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
