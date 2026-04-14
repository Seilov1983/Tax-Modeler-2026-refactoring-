'use client';

/**
 * FlowModal — Apple Liquid Glass dialog for editing Flow properties.
 *
 * Now uses shadcn/ui Dialog, Input, Select, Label, Button, Badge primitives.
 * Spring animations replaced with Radix Dialog + Tailwind animate utilities.
 *
 * React Hook Form for local draft state remains intact.
 * All Jotai state mutations and useTranslation hook preserved.
 * Full dark mode support via Tailwind `dark:` variants.
 */

import { useAtom, useSetAtom } from 'jotai';
import { useEffect, useCallback, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { selectionAtom } from '@features/entity-editor/model/atoms';
import { projectAtom } from '@features/canvas/model/project-atom';
import { deleteFlowAtom } from '@features/canvas/model/graph-actions-atom';
import { commitHistoryAtom } from '@features/project-management/model/history-atoms';
import { useTranslation } from '@shared/lib/i18n';
import type { FlowType, CurrencyCode, NexusCategory } from '@shared/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { fmtInputDisplay, parseInputDisplay, currencySymbol } from '@shared/lib/engine/utils';

// ─── Masked Money Input ─────────────────────────────────────────────────────
// Displays space-grouped number when blurred (1 234 567), raw number while focused.
// Saves raw number to form state. Optional suffix adornment.

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

const FLOW_TYPES: FlowType[] = [
  'Dividends', 'Royalties', 'Interest', 'Services', 'Salary', 'Goods', 'Equipment',
];

const CURRENCIES: CurrencyCode[] = [
  'KZT', 'USD', 'EUR', 'AED', 'HKD', 'SGD', 'GBP', 'SCR', 'CNY',
];

const NEXUS_CATEGORIES: { value: NexusCategory; label: string }[] = [
  { value: 'R_OUT_UNRELATED', label: 'R&D Outsourced — Unrelated Parties' },
  { value: 'R_OUT_RELATED_FOR', label: 'R&D Outsourced — Related (Foreign)' },
  { value: 'R_IP_ACQUISITION', label: 'IP Acquisition Cost' },
];

/** Zone codes whose IP-income nodes qualify for Nexus fraction tagging. */
const NEXUS_ZONE_CODES = new Set(['KZ_HUB', 'KZ_AIFC']);

// ─── Liquid Glass utility classes (aesthetic hooks layered on shadcn primitives) ──

const GLASS_INPUT = '';
const GLASS_SELECT = '';
const GLASS_LABEL = 'text-[12px] font-semibold text-slate-500 dark:text-slate-400 tracking-wider uppercase mb-1.5 block ml-1';

interface FlowFormData {
  flowType: FlowType;
  grossAmount: number;
  currency: CurrencyCode;
  whtRate: number;
  paymentMethod: 'bank' | 'cash' | 'crypto';
  dealTag: string;
  applyDTT: boolean;
  customWhtRate: number | undefined;
  nexusCategory: NexusCategory | '';
  isBeneficialOwner: boolean;
}

export function FlowModal() {
  const [selection, setSelection] = useAtom(selectionAtom);
  const [project, setProject] = useAtom(projectAtom);
  const deleteFlow = useSetAtom(deleteFlowAtom);
  const commitHistory = useSetAtom(commitHistoryAtom);
  const { t } = useTranslation();

  const flow = selection?.type === 'flow'
    ? project?.flows.find((f) => f.id === selection.id)
    : null;

  const {
    register,
    handleSubmit,
    reset,
    watch,
    control,
    formState: { errors, isDirty },
  } = useForm<FlowFormData>({
    defaultValues: flow ? {
      flowType: flow.flowType,
      grossAmount: flow.grossAmount,
      currency: flow.currency,
      whtRate: flow.whtRate,
      paymentMethod: flow.paymentMethod as 'bank' | 'cash' | 'crypto',
      dealTag: flow.dealTag ?? '',
      applyDTT: flow.applyDTT ?? false,
      customWhtRate: flow.customWhtRate,
      nexusCategory: flow.nexusCategory ?? '',
      isBeneficialOwner: flow.isBeneficialOwner ?? true,
    } : undefined,
  });

  useEffect(() => {
    if (flow) {
      reset({
        flowType: flow.flowType,
        grossAmount: flow.grossAmount,
        currency: flow.currency,
        whtRate: flow.whtRate,
        paymentMethod: flow.paymentMethod as 'bank' | 'cash' | 'crypto',
        dealTag: flow.dealTag ?? '',
        applyDTT: flow.applyDTT ?? false,
        customWhtRate: flow.customWhtRate,
        nexusCategory: flow.nexusCategory ?? '',
        isBeneficialOwner: flow.isBeneficialOwner ?? true,
      });
    }
  }, [flow?.id, reset]);

  const onSubmit = useCallback(
    (data: FlowFormData) => {
      if (!flow || !selection || selection.type !== 'flow') return;
      commitHistory();
      const { nexusCategory, ...rest } = data;
      const patch = { ...rest, nexusCategory: nexusCategory || undefined } as Record<string, unknown>;
      setProject((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          flows: prev.flows.map((f) =>
            f.id === flow.id ? { ...f, ...patch } : f,
          ),
        };
      });
      setSelection(null);
    },
    [flow, selection, commitHistory, setProject, setSelection],
  );

  const handleDelete = useCallback(() => {
    if (!flow) return;
    deleteFlow(flow.id);
  }, [flow, deleteFlow]);

  const handleClose = useCallback(() => {
    setSelection(null);
  }, [setSelection]);

  if (!flow || selection?.type !== 'flow') return null;

  const fromNode = project?.nodes.find((n) => n.id === flow.fromId);
  const toNode = project?.nodes.find((n) => n.id === flow.toId);
  const fromZone = fromNode?.zoneId ? project?.zones.find((z) => z.id === fromNode.zoneId) : null;
  const showNexus = !!fromNode?.isIPIncome && !!fromZone && (fromZone.code === 'KZ_HUB' || fromZone.code === 'KZ_AIFC');

  const isOpen = true;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) handleClose(); }}>
      <DialogContent
        className="no-canvas-events"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <DialogHeader>
          <DialogTitle>{t('editFlow')}</DialogTitle>
          <DialogDescription>
            {fromNode?.name ?? flow.fromId} &rarr; {toNode?.name ?? flow.toId}
          </DialogDescription>
        </DialogHeader>

        {/* Form */}
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-1 flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto space-y-4 px-6 py-4">
            <div>
              <Label className={GLASS_LABEL}>{t('flowType')}</Label>
              <Controller
                name="flowType"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className={GLASS_SELECT}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FLOW_TYPES.map((ft) => (
                        <SelectItem key={ft} value={ft}>{t(ft.toLowerCase() as any)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {errors.flowType && (
                <p className="mt-1 text-xs text-red-500">{errors.flowType.message}</p>
              )}
            </div>

            <div>
              <Label className={GLASS_LABEL}>{t('grossAmount')}</Label>
              <Controller
                name="grossAmount"
                control={control}
                render={({ field }) => (
                  <MaskedMoneyInput
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    suffix={currencySymbol(watch('currency'))}
                  />
                )}
              />
              {errors.grossAmount && <p className="mt-1 text-xs text-red-500">{errors.grossAmount.message}</p>}
            </div>

            <div>
              <Label className={GLASS_LABEL}>{t('currency')}</Label>
              <Controller
                name="currency"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className={GLASS_SELECT}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CURRENCIES.map((c) => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div>
              <Label className={GLASS_LABEL}>{t('whtRate')}</Label>
              <div className="relative">
                <Input type="number" step="0.01" min="0" max="100" className="pr-8" {...register('whtRate', { valueAsNumber: true })} />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400 pointer-events-none">%</span>
              </div>
              {errors.whtRate && <p className="mt-1 text-xs text-red-500">{errors.whtRate.message}</p>}
            </div>

            <div>
              <Label className={GLASS_LABEL}>{t('paymentMethod')}</Label>
              <Controller
                name="paymentMethod"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className={GLASS_SELECT}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bank">{t('bank')}</SelectItem>
                      <SelectItem value="cash">{t('cash')}</SelectItem>
                      <SelectItem value="crypto">{t('crypto')}</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div>
              <Label className={GLASS_LABEL}>{t('dealTag')}</Label>
              <Input type="text" className={GLASS_INPUT} {...register('dealTag')} placeholder={t('optionalTag')} />
            </div>

            <div>
              <Label className={GLASS_LABEL}>{t('applyDTT')}</Label>
              <Controller
                name="applyDTT"
                control={control}
                render={({ field }) => (
                  <div className="flex items-center gap-2 py-1">
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                    <span className="text-sm text-slate-600">
                      {field.value ? t('yes') : t('no')}
                    </span>
                  </div>
                )}
              />
            </div>

            <div>
              <Label className={GLASS_LABEL}>{t('isBeneficialOwner')}</Label>
              <Controller
                name="isBeneficialOwner"
                control={control}
                render={({ field }) => (
                  <div className="flex items-center gap-2 py-1">
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                    <span className="text-sm text-slate-600">
                      {field.value ? t('yes') : t('no')}
                    </span>
                  </div>
                )}
              />
            </div>

            {watch('applyDTT') && (
              <div>
                <Label className={GLASS_LABEL}>{t('customWhtRate')}</Label>
                <div className="relative">
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    className="pr-8"
                    {...register('customWhtRate', { valueAsNumber: true })}
                    placeholder="e.g. 5"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400 pointer-events-none">%</span>
                </div>
              </div>
            )}

            {/* Nexus Category — shown only for outflows from IP-income nodes in Nexus zones */}
            {showNexus && (
              <div>
                <Label className={GLASS_LABEL}>{t('nexusCategory')}</Label>
                <Controller
                  name="nexusCategory"
                  control={control}
                  render={({ field }) => (
                    <Select value={field.value || ''} onValueChange={field.onChange}>
                      <SelectTrigger className={GLASS_SELECT}>
                        <SelectValue placeholder="None (own R&D)" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">{t('nexusRndNone')}</SelectItem>
                        <SelectItem value="R_OUT_UNRELATED">{t('nexusRndUnrelated')}</SelectItem>
                        <SelectItem value="R_OUT_RELATED_FOR">{t('nexusRndRelatedFor')}</SelectItem>
                        <SelectItem value="R_IP_ACQUISITION">{t('nexusRndAcquisition')}</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
            )}

            <div className="rounded-2xl bg-black/[0.03] p-3 text-xs text-gray-500">
              ID: {flow.id}<br />
              {t('status')}: {flow.status}
            </div>
          </div>

          {/* Footer */}
          <DialogFooter>
            <Button type="button" variant="destructive" onClick={handleDelete}>
              {t('delete')}
            </Button>
            <div className="flex-1" />
            <Button type="button" variant="secondary" onClick={handleClose}>
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={!isDirty}>
              {t('save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
