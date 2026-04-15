'use client';

/**
 * EditorModal — floating Liquid Glass dialog for editing Node and Ownership properties.
 * Uses react-hook-form for form state; dispatches updates via Jotai action atoms.
 * Flow editing is handled by FlowModal; zone editing is via the canvas Transformer.
 *
 * Cap Table: NodeEditor includes a "Shareholders" section showing all incoming
 * ownership edges with inline percent editing, proportional redistribution, and validation.
 */

import { useAtom, useSetAtom, useAtomValue } from 'jotai';
import { useEffect, useState, useCallback } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { selectionAtom, nodeEditingAtom } from '../model/atoms';
import { projectAtom } from '@features/canvas/model/project-atom';
import { deleteNodesAtom, deleteOwnershipAtom, updateNodeAtom, updateOwnershipAtom } from '@features/canvas/model/graph-actions-atom';
import { useTranslation, localizedName, t } from '@shared/lib/i18n';
import type { NodeDTO, OwnershipEdge, NodeType, Zone, Project } from '@shared/types';
import { computeNexusFractionFromFlows } from '@shared/lib/engine/engine-tax';
import { fmtMoney, fmtPercent, fmtInputDisplay, parseInputDisplay, currencySymbol } from '@shared/lib/engine/utils';
import { activeNodeRisksAtom } from '@features/risk-analyzer/model/atoms';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// ─── Liquid Glass utility classes (aesthetic hooks layered on shadcn primitives) ──

// Input/Select base styles now live in the shadcn primitives. Empty overrides
// let consumers pass size/width tweaks without duplicating depth/chrome.
const GLASS_INPUT = '';
const GLASS_SELECT = '';
const GLASS_LABEL = 'text-[12px] font-semibold text-slate-500 dark:text-slate-400 tracking-wider uppercase mb-1.5 block ml-1';
const GLASS_PANEL = 'rounded-2xl bg-white/40 dark:bg-black/30 border border-white/50 dark:border-white/10 backdrop-blur-md shadow-sm';

// ─── Risk type → i18n key mapping ────────────────────────────────────────────
const RISK_TYPE_I18N: Record<string, string> = {
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
  CAPITAL_ANOMALY: 'riskCapitalAnomaly',
  SUBSTANCE_EXPENSE_MISMATCH: 'riskSubstanceExpenseMismatch',
  FSIE_SUBSTANCE: 'riskFsieSubstance',
  ADVANCE_RULING: 'riskAdvanceRuling',
  SEPARATE_ACCOUNTING: 'riskSeparateAccounting',
  NON_DEDUCTIBLE_EXPENSE: 'riskNonDeductibleExpense',
};

// ─── Masked Money Input ─────────────────────────────────────────────────────
function MaskedMoneyInput({
  value,
  onChange,
  onBlur,
  suffix,
}: {
  value: number;
  onChange: (n: number) => void;
  onBlur?: () => void;
  suffix?: string;
}) {
  const [raw, setRaw] = useState('');
  const [focused, setFocused] = useState(false);

  return (
    <div className="relative">
      <Input
        type="text"
        inputMode="decimal"
        value={focused ? raw : fmtInputDisplay(value)}
        onChange={(e) => {
          const v = e.target.value.replace(/[^\d.\s]/g, '');
          setRaw(v);
          const n = parseInputDisplay(v);
          onChange(n);
        }}
        onFocus={() => { setFocused(true); setRaw(value ? String(value) : ''); }}
        onBlur={() => { setFocused(false); onBlur?.(); }}
        className={suffix ? 'pr-10' : ''}
      />
      {suffix && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400 pointer-events-none">{suffix}</span>
      )}
    </div>
  );
}

// ─── Form types ──────────────────────────────────────────────────────────────

interface NodeFormValues {
  name: string;
  type: NodeType;
  annualIncome: number;
  etr: number;
  citizenship: string;
  passiveIncomeShare: number;
  hasSubstance: boolean;
  headcount: number;
  operationalExpenses: number;
  payrollCosts: number;
  isIPIncome: boolean;
  hasSeparateAccounting: boolean;
  cigaInZone: boolean;
  isQFZP: boolean;
  legalForm: string;
}

/** Zone codes that require substance metrics when hasSubstance is toggled on. */
const SUBSTANCE_ZONE_CODES = new Set(['KZ_HUB', 'KZ_AIFC']);

interface OwnershipFormValues {
  percent: number;
  manualAdjustment: number;
}

// ─── Cap Table: round to 2 decimals (avoids JS floating-point drift) ─────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─── Shareholders Section (Cap Table inside NodeEditor) ──────────────────────

interface ShareholderEntry {
  edgeId: string;
  parentName: string;
  percent: number;
}

function ShareholdersSection({
  nodeId,
  ownership,
  nodes,
  updateOwnership,
}: {
  nodeId: string;
  ownership: OwnershipEdge[];
  nodes: NodeDTO[];
  updateOwnership: (payload: { id: string; data: Partial<OwnershipEdge> }) => void;
}) {
  const { t } = useTranslation();
  const incomingEdges = ownership.filter((o) => o.toId === nodeId);
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  const [shares, setShares] = useState<ShareholderEntry[]>([]);
  const [showRedistribute, setShowRedistribute] = useState<string | null>(null);

  // Sync local state from incoming edges
  useEffect(() => {
    setShares(
      incomingEdges.map((e) => ({
        edgeId: e.id,
        parentName: nodeMap.get(e.fromId)?.name ?? e.fromId,
        percent: e.percent,
      })),
    );
  }, [nodeId, ownership.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = round2(shares.reduce((s, sh) => s + sh.percent, 0));
  const isOver100 = total > 100.005;
  const isUnder100 = total < 99.995 && shares.length > 0;

  const handlePercentChange = useCallback(
    (edgeId: string, newPercent: number) => {
      setShares((prev) =>
        prev.map((sh) => (sh.edgeId === edgeId ? { ...sh, percent: round2(newPercent) } : sh)),
      );
      setShowRedistribute(shares.length > 1 ? edgeId : null);
    },
    [shares.length],
  );

  const handleRedistributeProportionally = useCallback(
    (editedEdgeId: string) => {
      setShares((prev) => {
        const edited = prev.find((s) => s.edgeId === editedEdgeId);
        if (!edited) return prev;

        const remaining = round2(100 - edited.percent);
        const others = prev.filter((s) => s.edgeId !== editedEdgeId);
        const othersSum = others.reduce((s, sh) => s + sh.percent, 0);

        if (othersSum <= 0 || others.length === 0) return prev;

        // Scale proportionally
        let distributed = 0;
        const updated = others.map((sh, idx) => {
          const isLast = idx === others.length - 1;
          const scaled = isLast
            ? round2(remaining - distributed)
            : round2((sh.percent / othersSum) * remaining);
          distributed += scaled;
          return { ...sh, percent: Math.max(0, scaled) };
        });

        return prev.map(
          (sh) => updated.find((u) => u.edgeId === sh.edgeId) ?? sh,
        );
      });
      setShowRedistribute(null);
    },
    [],
  );

  const handleSaveShares = useCallback(() => {
    for (const sh of shares) {
      const edge = incomingEdges.find((e) => e.id === sh.edgeId);
      if (edge && edge.percent !== sh.percent) {
        updateOwnership({ id: sh.edgeId, data: { percent: sh.percent } });
      }
    }
  }, [shares, incomingEdges, updateOwnership]);

  if (incomingEdges.length === 0) return null;

  return (
    <div className="mt-4">
      <Label className={GLASS_LABEL}>{t('shareholders')}</Label>
      <div className="mt-1.5 space-y-2">
        {shares.map((sh) => (
          <div key={sh.edgeId}>
            <div className="flex items-center gap-2">
              <span className="flex-1 truncate text-[13px] text-slate-700">
                {sh.parentName}
              </span>
              <Input
                type="number"
                step="0.01"
                min={0}
                max={100}
                value={sh.percent}
                onChange={(e) => handlePercentChange(sh.edgeId, Number(e.target.value) || 0)}
                className={`${GLASS_INPUT} w-24 text-right`}
              />
              <span className="text-[12px] text-slate-500">%</span>
            </div>
            {showRedistribute === sh.edgeId && shares.length > 1 && (
              <div className="mt-1 flex gap-2">
                <button
                  type="button"
                  onClick={() => handleRedistributeProportionally(sh.edgeId)}
                  className="rounded-lg bg-blue-500/10 px-2.5 py-1 text-[11px] font-medium text-blue-600 hover:bg-blue-500/20 transition-colors"
                >
                  {t('redistributeProportionally')}
                </button>
                <button
                  type="button"
                  onClick={() => setShowRedistribute(null)}
                  className="rounded-lg bg-slate-500/10 px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-500/20 transition-colors"
                >
                  {t('manual')}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Total bar */}
      <div className={`mt-2 flex items-center justify-between rounded-lg px-3 py-1.5 text-[12px] font-medium ${
        isOver100
          ? 'bg-red-500/10 text-red-600'
          : isUnder100
            ? 'bg-amber-500/10 text-amber-600'
            : 'bg-emerald-500/10 text-emerald-600'
      }`}>
        <span>{t('total')}</span>
        <span>{fmtPercent(total / 100)}</span>
      </div>

      {isOver100 && (
        <p className="mt-1 text-[11px] text-red-500 font-medium">
          {t('totalExceeds100')}
        </p>
      )}
      {isUnder100 && (
        <p className="mt-1 text-[11px] text-amber-500 font-medium">
          {t('warningUnder100')}
        </p>
      )}

      {/* Save shares button */}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={isOver100}
        onClick={handleSaveShares}
        className="mt-2 w-full text-[12px]"
      >
        {t('saveShares')}
      </Button>
    </div>
  );
}

// ─── Sub-editors ─────────────────────────────────────────────────────────────

function NodeEditor({
  node,
  control,
  register,
  watch,
  errors,
  projectZones,
  ownership,
  allNodes,
  project,
  updateOwnership,
}: {
  node: NodeDTO;
  control: ReturnType<typeof useForm<NodeFormValues>>['control'];
  register: ReturnType<typeof useForm<NodeFormValues>>['register'];
  watch: ReturnType<typeof useForm<NodeFormValues>>['watch'];
  errors: ReturnType<typeof useForm<NodeFormValues>>['formState']['errors'];
  projectZones: Zone[];
  ownership: OwnershipEdge[];
  allNodes: NodeDTO[];
  project: Project;
  updateOwnership: (payload: { id: string; data: Partial<OwnershipEdge> }) => void;
}) {
  const { t, lang } = useTranslation();
  const zone = projectZones.find((z) => z.id === node.zoneId);
  const watchType = watch('type');
  const watchSubstance = watch('hasSubstance');
  const watchIPIncome = watch('isIPIncome');
  // Support both internal project codes and localized display names for robustness
  const zCode = zone?.code || '';
  const isSubstanceZone = zCode === 'KZ_HUB' || zCode === 'KZ_AIFC' || zCode.includes('Hub');

  // Real-time Nexus calculation for indicator
  const nexusFraction = watchIPIncome ? computeNexusFractionFromFlows(project, node) : null;

  // Global risk state — Single Source of Truth from risk engine (not stale node.riskFlags)
  const allNodeRisks = useAtomValue(activeNodeRisksAtom);
  const riskFlags = allNodeRisks[node.id] ?? [];

  return (
    <>
      <Field label={t('name')}>
        <Input type="text" className={GLASS_INPUT} {...register('name')} />
      </Field>

      <Field label={t('type')}>
        <Controller
          name="type"
          control={control}
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger className={GLASS_SELECT}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="company">{t('company')}</SelectItem>
                <SelectItem value="person">{t('person')}</SelectItem>
                <SelectItem value="txa">TXA</SelectItem>
              </SelectContent>
            </Select>
          )}
        />
      </Field>

      {/* Spatial location — read-only badge (zone assignment is automatic via drag) */}
      <Field label={t('locatedIn')}>
        <Badge variant={zone ? 'default' : 'destructive'} className="w-full justify-start px-3 py-2 text-[13px] font-medium">
          {zone
            ? `${localizedName(zone.name, lang)} (${zone.jurisdiction} \u00b7 ${zone.currency})`
            : t('noZone')}
        </Badge>
      </Field>

      <Field label={t('annualIncome')}>
        <Controller
          name="annualIncome"
          control={control}
          render={({ field }) => (
            <MaskedMoneyInput
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              suffix={zone ? currencySymbol(zone.currency) : undefined}
            />
          )}
        />
      </Field>

      {watchType === 'company' && (
        <Field label={t('etrManual')}>
          <div className="relative">
            <Input
              type="text"
              inputMode="decimal"
              className="pr-14 tabular-nums"
              {...register('etr', { valueAsNumber: true })}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 pointer-events-none">0–1</span>
          </div>
        </Field>
      )}

      {watchType === 'person' && node.citizenship && (
        <Field label={t('citizenship')}>
          <Input type="text" className={GLASS_INPUT} {...register('citizenship')} />
        </Field>
      )}

      {watchType === 'company' && (
        <>
          <Field label={t('passiveIncomeShare')}>
            <div className="relative">
              <Input
                type="text"
                inputMode="numeric"
                className="pr-8 tabular-nums"
                {...register('passiveIncomeShare', { valueAsNumber: true })}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400 pointer-events-none">%</span>
            </div>
          </Field>
 
          {/* Compliance toggles — unconditional for ALL company nodes */}
          <div className="ml-1 mb-4 space-y-3 rounded-xl border border-amber-400/30 bg-amber-50/50 dark:bg-amber-900/10 p-3">
            <Field label={t('isIPIncome')}>
              <div className="flex items-center justify-between">
                <div className="flex flex-col">
                  <span className="text-[12px] font-medium text-slate-700 dark:text-slate-300">
                    {t('isIPIncome')}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <Controller
                      name="isIPIncome"
                      control={control}
                      render={({ field }) => (
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      )}
                    />
                  </div>
                </div>
                {nexusFraction !== null && (
                  <div className="flex flex-col items-end">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">{t('nexusFraction')}</span>
                    <Badge variant="outline" className="bg-blue-500/10 border-blue-500/20 text-blue-600 font-mono">
                      {fmtPercent(nexusFraction, 1)}
                    </Badge>
                  </div>
                )}
              </div>
            </Field>

            <Field label={t('hasSubstance')}>
              <Controller
                name="hasSubstance"
                control={control}
                render={({ field }) => (
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] text-slate-600 dark:text-slate-400">{t('hasSubstance')}</span>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </div>
                )}
              />
            </Field>

            <Field label={t('hasSeparateAccounting')}>
              <Controller
                name="hasSeparateAccounting"
                control={control}
                render={({ field }) => (
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] text-slate-600 dark:text-slate-400">{t('hasSeparateAccounting')}</span>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </div>
                )}
              />
            </Field>

            {/* UAE QFZP toggle — only visible for UAE Free Zone entities */}
            {zone?.jurisdiction === 'UAE' && (
              <Field label={t('isQFZP')}>
                <Controller
                  name="isQFZP"
                  control={control}
                  render={({ field }) => (
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] text-slate-600 dark:text-slate-400">{t('isQFZP')}</span>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </div>
                  )}
                />
              </Field>
            )}

            {watchSubstance && (
              <>
                <Field label={t('headcount')}>
                  <Input
                    type="text"
                    inputMode="numeric"
                    {...register('headcount', { valueAsNumber: true })}
                    className={GLASS_INPUT}
                  />
                </Field>
                <Field label={t('operationalExpenses')}>
                  <Controller
                    name="operationalExpenses"
                    control={control}
                    render={({ field }) => (
                      <MaskedMoneyInput
                        value={field.value}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        suffix={zone ? currencySymbol(zone.currency) : undefined}
                      />
                    )}
                  />
                </Field>
                <Field label={t('payrollCosts')}>
                  <Controller
                    name="payrollCosts"
                    control={control}
                    render={({ field }) => (
                      <MaskedMoneyInput
                        value={field.value}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        suffix={zone ? currencySymbol(zone.currency) : undefined}
                      />
                    )}
                  />
                </Field>
              </>
            )}
          </div>

          <Field label={t('legalForm')}>
            <Controller
              name="legalForm"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className={GLASS_SELECT}>
                    <SelectValue placeholder={t('selectLegalForm')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="LLC">{t('llc')}</SelectItem>
                    <SelectItem value="JSC">{t('jsc')}</SelectItem>
                    <SelectItem value="Branch">{t('branch')}</SelectItem>
                    <SelectItem value="Representative">{t('representative')}</SelectItem>
                    <SelectItem value="Partnership">{t('partnership')}</SelectItem>
                    <SelectItem value="Trust">{t('trust')}</SelectItem>
                    <SelectItem value="Foundation">{t('foundation')}</SelectItem>
                    <SelectItem value="Other">{t('other')}</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
 
          <div className="mt-8 space-y-4 border-t border-slate-200 pt-6 dark:border-slate-800">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">{t('taxRiskSummary')}</h3>
            
            <div className="grid grid-cols-2 gap-4">
              <div className={GLASS_PANEL + ' p-3'}>
                <span className="text-[10px] text-slate-500 block mb-1">{t('effectiveETR')}</span>
                <div className="flex items-baseline gap-1">
                  <span className="text-xl font-mono font-bold">{fmtPercent(node.etr, 1)}</span>
                  {node.etr < 0.15 && (
                    <Badge variant="outline" className="text-[9px] bg-red-500/10 text-red-600 border-red-500/20">
                      {t('pillar2Risk')}
                    </Badge>
                  )}
                </div>
              </div>
              
              <div className={GLASS_PANEL + ' p-3'}>
                <span className="text-[10px] text-slate-500 block mb-1">{t('jurisdiction')}</span>
                <span className="text-sm font-semibold">{zone ? localizedName(zone.name, lang) : t('noZone')}</span>
              </div>
            </div>

            {riskFlags.length > 0 && (
              <div className="space-y-2">
                {riskFlags.map((flag, idx) => {
                  const labelKey = RISK_TYPE_I18N[flag.type];
                  const label = labelKey ? t(labelKey as any) : String(flag.type).replace(/_/g, ' ');
                  return (
                    <div key={idx} className="flex items-start gap-2 rounded-lg bg-orange-500/5 dark:bg-orange-500/10 p-2 border border-orange-500/10">
                      <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-orange-500" />
                      <div className="min-w-0">
                        <p className="text-[11px] font-bold text-orange-700 dark:text-orange-400 leading-tight text-wrap break-words">
                          {label}
                        </p>
                        {!!flag.message && <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 text-wrap break-words">{t(String(flag.message) as any)}</p>}
                        {flag.lawRef && <p className="text-[10px] text-slate-400 mt-0.5">{String(flag.lawRef)}</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      <ShareholdersSection
        nodeId={node.id}
        ownership={ownership}
        nodes={allNodes}
        updateOwnership={updateOwnership}
      />

      <div className="mt-6 rounded-xl bg-slate-50/80 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/50 p-4 shadow-sm backdrop-blur-md">
        <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-2">{t('technicalData')}</h4>
        <div className="text-[12px] text-slate-800 dark:text-slate-200 space-y-1 font-mono">
          <p><span className="text-slate-500 dark:text-slate-400">ID:</span> {node.id}</p>
          <p><span className="text-slate-500 dark:text-slate-400">{t('type')}:</span> {t(node.type as any)}</p>
          <p><span className="text-slate-500 dark:text-slate-400">{t('frozen')}:</span> {node.frozen ? t('yes') : t('no')}</p>
          {node.computedEtr != null && <p><span className="text-slate-500 dark:text-slate-400">{t('computedEtr')}:</span> {fmtPercent(node.computedEtr)}</p>}
          {node.computedCitKZT != null && <p><span className="text-slate-500 dark:text-slate-400">{t('computedCitKzt')}:</span> {fmtMoney(node.computedCitKZT)}</p>}
        </div>
      </div>
    </>
  );
}

function OwnershipEditor({
  edge,
  register,
}: {
  edge: OwnershipEdge;
  register: ReturnType<typeof useForm<OwnershipFormValues>>['register'];
}) {
  const { t } = useTranslation();
  return (
    <>
      <Field label={t('ownershipPercent')}>
        <div className="relative">
          <Input
            type="number"
            step="0.01"
            min={0}
            max={100}
            className="pr-8"
            {...register('percent', { valueAsNumber: true })}
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400 pointer-events-none">%</span>
        </div>
      </Field>
      <Field label={t('manualAdjustment')}>
        <div className="relative">
          <Input
            type="number"
            step="0.01"
            className="pr-8"
            {...register('manualAdjustment', { valueAsNumber: true })}
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400 pointer-events-none">%</span>
        </div>
      </Field>
      <div className="mt-4 rounded-xl bg-black/[0.03] p-3 text-[11px] text-gray-500">
        ID: {edge.id}<br />{t('parent')}: {edge.fromId}<br />{t('subsidiary')}: {edge.toId}
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <Label className={GLASS_LABEL}>{label}</Label>
      {children}
    </div>
  );
}

const ENTITY_LABEL_KEYS: Record<string, string> = {
  node: 'editNode', flow: 'editFlow', ownership: 'editOwnership', zone: 'editZone',
};

// ─── Main modal ──────────────────────────────────────────────────────────────

export function EditorModal() {
  const [selection, setSelection] = useAtom(selectionAtom);
  const project = useAtomValue(projectAtom);
  const deleteNodes = useSetAtom(deleteNodesAtom);
  const deleteOwnership = useSetAtom(deleteOwnershipAtom);
  const updateNode = useSetAtom(updateNodeAtom);
  const updateOwnership = useSetAtom(updateOwnershipAtom);
  const [nodeEditing, setNodeEditing] = useAtom(nodeEditingAtom);
  const { t, lang } = useTranslation();

  let entity: NodeDTO | OwnershipEdge | undefined;
  let entityKey: string | null = null;
  let isMultiNode = false;

  if (selection?.type === 'node') {
    isMultiNode = selection.ids.length > 1;
    if (selection.ids.length === 1) {
      entity = project?.nodes.find((n) => n.id === selection.ids[0]);
      entityKey = selection.ids[0];
    }
  } else if (selection?.type === 'ownership') {
    entity = project?.ownership.find((o) => o.id === selection.id);
    entityKey = selection.id;
  }

  const isNode = selection?.type === 'node';
  const isOwnership = selection?.type === 'ownership';

  const nodeForm = useForm<NodeFormValues>({
    defaultValues: { name: '', type: 'company', annualIncome: 0, etr: 0, citizenship: '', passiveIncomeShare: 0, hasSubstance: false, headcount: 0, operationalExpenses: 0, payrollCosts: 0, isIPIncome: false, hasSeparateAccounting: false, cigaInZone: false, isQFZP: false, legalForm: 'LLC' },
  });

  const ownershipForm = useForm<OwnershipFormValues>({
    defaultValues: { percent: 100, manualAdjustment: 0 },
  });

  useEffect(() => {
    if (entity && isNode && 'name' in entity) {
      const n = entity as NodeDTO;
      nodeForm.reset({
        name: n.name,
        type: n.type,
        annualIncome: n.annualIncome,
        etr: n.etr,
        citizenship: n.citizenship?.join(', ') ?? '',
        passiveIncomeShare: n.passiveIncomeShare ?? 0,
        hasSubstance: n.hasSubstance ?? false,
        headcount: n.substanceMetrics?.headcount ?? 0,
        operationalExpenses: n.substanceMetrics?.operationalExpenses ?? 0,
        payrollCosts: n.substanceMetrics?.payrollCosts ?? 0,
        isIPIncome: n.isIPIncome ?? false,
        hasSeparateAccounting: n.hasSeparateAccounting ?? false,
        cigaInZone: n.complianceData?.aifc?.cigaInZone ?? false,
        isQFZP: n.isQFZP ?? false,
        legalForm: n.legalForm ?? 'LLC',
      });
    }
  }, [entityKey, isNode]);

  useEffect(() => {
    if (entity && isOwnership && 'percent' in entity) {
      const o = entity as OwnershipEdge;
      ownershipForm.reset({
        percent: o.percent,
        manualAdjustment: o.manualAdjustment,
      });
    }
  }, [entityKey, isOwnership]);

  const isOpen =
    !!selection &&
    !!project &&
    selection.type !== 'flow' &&
    selection.type !== 'zone' &&
    (selection.type !== 'node' || nodeEditing) &&
    (!!entity || isMultiNode);

  const handleClose = () => {
    setSelection(null);
    setNodeEditing(false);
  };

  const handleSaveNode = nodeForm.handleSubmit((values) => {
    if (!entityKey) return;
    const patch: Partial<NodeDTO> = {
      name: values.name,
      type: values.type,
      annualIncome: values.annualIncome,
      etr: values.etr,
      passiveIncomeShare: values.passiveIncomeShare,
      hasSubstance: values.hasSubstance,
      isIPIncome: values.isIPIncome,
      hasSeparateAccounting: values.hasSeparateAccounting,
      isQFZP: values.isQFZP,
      legalForm: values.legalForm as any,
    };
    if (values.hasSubstance && (values.headcount > 0 || values.operationalExpenses > 0 || values.payrollCosts > 0)) {
      patch.substanceMetrics = {
        headcount: values.headcount,
        operationalExpenses: values.operationalExpenses,
        payrollCosts: values.payrollCosts,
      };
    } else if (!values.hasSubstance) {
      patch.substanceMetrics = undefined;
    }
    if (values.cigaInZone) {
      const prev = (entity as NodeDTO)?.complianceData;
      patch.complianceData = {
        substance: prev?.substance ?? { employeesCount: 0, hasPhysicalOffice: false, cigaInZone: false },
        aifc: { ...(prev?.aifc ?? { usesCITBenefit: true, cigaInZone: false }), cigaInZone: values.cigaInZone },
        bvi: prev?.bvi ?? { relevantActivity: false, employees: 0, office: false },
      };
    }
    if (values.type === 'person' && values.citizenship) {
      patch.citizenship = values.citizenship.split(',').map((s) => s.trim()).filter(Boolean);
    }
    updateNode({ id: entityKey, data: patch });
    setSelection(null);
    setNodeEditing(false);
  });

  const handleSaveOwnership = ownershipForm.handleSubmit((values) => {
    if (!entityKey) return;
    updateOwnership({ id: entityKey, data: values });
    setSelection(null);
    setNodeEditing(false);
  });

  const handleSave = () => {
    if (isNode) handleSaveNode();
    else if (isOwnership) handleSaveOwnership();
  };

  const handleDelete = () => {
    if (!selection) return;
    if (selection.type === 'node') deleteNodes(selection.ids);
    else if (selection.type === 'ownership') deleteOwnership(selection.id);
    setNodeEditing(false);
  };

  const label =
    isMultiNode && selection?.type === 'node'
      ? `${selection.ids.length} ${t('nodesSelected')}`
      : selection
        ? (t(ENTITY_LABEL_KEYS[selection.type] as any) ?? selection.type)
        : '';

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) handleClose(); }}>
      <DialogContent
        className="no-canvas-events sm:max-w-[425px]"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <DialogHeader className="px-0 pt-0 pb-4">
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription className="sr-only">
            {t('editProperties')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col gap-0">
          {isMultiNode ? (
            <div className="rounded-2xl bg-blue-500/6 p-3.5 text-[13px] text-blue-600">
              <strong>{selection?.type === 'node' ? selection.ids.length : 0} {t('nodes')}</strong> {t('selected')}.
              <br /><br />
              {t('multiNodeHint')} <kbd className="rounded-md bg-blue-500/10 px-1.5 py-0.5 text-[11px]">Delete</kbd> {t('toRemoveAll')}
            </div>
          ) : entity ? (
            <>
              {isNode && (
                <NodeEditor
                  node={entity as NodeDTO}
                  control={nodeForm.control}
                  register={nodeForm.register}
                  watch={nodeForm.watch}
                  errors={nodeForm.formState.errors}
                  projectZones={project?.zones ?? []}
                  ownership={project?.ownership ?? []}
                  allNodes={project?.nodes ?? []}
                  project={project!}
                  updateOwnership={updateOwnership}
                />
              )}
              {isOwnership && (
                <OwnershipEditor
                  edge={entity as OwnershipEdge}
                  register={ownershipForm.register}
                />
              )}
            </>
          ) : null}
        </div>

        {/* Footer */}
        <DialogFooter className="px-0 pt-6 mt-6 border-t border-slate-100 dark:border-slate-800">
          <Button variant="outline" onClick={handleDelete} data-testid="btn-delete-entity" className="bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20 border-red-500/20 shadow-none hover:text-red-700 dark:hover:text-red-300 transition-colors">
            {t('delete')}
          </Button>
          <div className="flex-1" />
          <Button variant="outline" onClick={handleClose} className="bg-white/50 hover:bg-white/80 dark:bg-black/20 dark:hover:bg-white/10 border-black/5 dark:border-white/10">
            {t('cancel')}
          </Button>
          <Button onClick={handleSave} data-testid="btn-save-entity" className="px-8 bg-slate-900 hover:bg-slate-800 text-white dark:bg-indigo-500 dark:text-white dark:hover:bg-indigo-600 shadow-md transition-all">
            {t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
