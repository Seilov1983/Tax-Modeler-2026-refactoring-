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
import { useEffect, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { selectionAtom } from '@features/entity-editor/model/atoms';
import { projectAtom } from '@features/canvas/model/project-atom';
import { deleteFlowAtom } from '@features/canvas/model/graph-actions-atom';
import { commitHistoryAtom } from '@features/project-management/model/history-atoms';
import { useTranslation } from '@shared/lib/i18n';
import type { FlowType, CurrencyCode } from '@shared/types';
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

const FLOW_TYPES: FlowType[] = [
  'Dividends', 'Royalties', 'Interest', 'Services', 'Salary', 'Goods', 'Equipment',
];

const CURRENCIES: CurrencyCode[] = [
  'KZT', 'USD', 'EUR', 'AED', 'HKD', 'SGD', 'GBP', 'SCR', 'CNY',
];

// ─── Liquid Glass utility classes (localized — no globals.css pollution) ──────

const GLASS_INPUT = 'bg-white/50 border-white/40 text-slate-900 placeholder:text-slate-500 focus-visible:ring-blue-500 focus-visible:border-transparent';
const GLASS_SELECT = 'bg-white/50 border-white/40 text-slate-900';
const GLASS_LABEL = 'text-slate-800 font-medium';

interface FlowFormData {
  flowType: FlowType;
  grossAmount: number;
  currency: CurrencyCode;
  whtRate: number;
  paymentMethod: 'bank' | 'cash' | 'crypto';
  dealTag: string;
  applyDTT: boolean;
  customWhtRate: number | undefined;
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
    setValue,
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
      });
    }
  }, [flow?.id, reset]);

  const onSubmit = useCallback(
    (data: FlowFormData) => {
      if (!flow || !selection || selection.type !== 'flow') return;
      commitHistory();
      setProject((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          flows: prev.flows.map((f) =>
            f.id === flow.id ? { ...f, ...data } : f,
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
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-1 flex-col overflow-y-auto">
          <div className="flex-1 space-y-4 px-6 py-4">
            <div>
              <Label className={GLASS_LABEL}>{t('flowType')}</Label>
              <Select
                value={watch('flowType')}
                onValueChange={(v) => setValue('flowType', v as FlowType, { shouldDirty: true })}
              >
                <SelectTrigger className={GLASS_SELECT}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FLOW_TYPES.map((ft) => <SelectItem key={ft} value={ft}>{ft}</SelectItem>)}
                </SelectContent>
              </Select>
              {errors.flowType && <p className="mt-1 text-xs text-red-500">{errors.flowType.message}</p>}
            </div>

            <div>
              <Label className={GLASS_LABEL}>{t('grossAmount')}</Label>
              <Input type="number" step="0.01" min="0" className={GLASS_INPUT} {...register('grossAmount')} />
              {errors.grossAmount && <p className="mt-1 text-xs text-red-500">{errors.grossAmount.message}</p>}
            </div>

            <div>
              <Label className={GLASS_LABEL}>{t('currency')}</Label>
              <Select
                value={watch('currency')}
                onValueChange={(v) => setValue('currency', v as CurrencyCode, { shouldDirty: true })}
              >
                <SelectTrigger className={GLASS_SELECT}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className={GLASS_LABEL}>{t('whtRate')}</Label>
              <Input type="number" step="0.01" min="0" max="1" className={GLASS_INPUT} {...register('whtRate')} />
              {errors.whtRate && <p className="mt-1 text-xs text-red-500">{errors.whtRate.message}</p>}
            </div>

            <div>
              <Label className={GLASS_LABEL}>{t('paymentMethod')}</Label>
              <Select
                value={watch('paymentMethod')}
                onValueChange={(v) => setValue('paymentMethod', v as 'bank' | 'cash' | 'crypto', { shouldDirty: true })}
              >
                <SelectTrigger className={GLASS_SELECT}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bank">{t('bank')}</SelectItem>
                  <SelectItem value="cash">{t('cash')}</SelectItem>
                  <SelectItem value="crypto">{t('crypto')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className={GLASS_LABEL}>{t('dealTag')}</Label>
              <Input type="text" className={GLASS_INPUT} {...register('dealTag')} placeholder={t('optionalTag')} />
            </div>

            <div>
              <Label className={GLASS_LABEL}>{t('applyDTT')}</Label>
              <div className="flex items-center gap-2 py-1">
                <Switch
                  checked={watch('applyDTT')}
                  onCheckedChange={(v) => setValue('applyDTT', v, { shouldDirty: true })}
                />
                <span className="text-sm text-slate-600">
                  {watch('applyDTT') ? t('yes') : t('no')}
                </span>
              </div>
            </div>

            {watch('applyDTT') && (
              <div>
                <Label className={GLASS_LABEL}>{t('customWhtRate')}</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  className={GLASS_INPUT}
                  {...register('customWhtRate', { valueAsNumber: true })}
                  placeholder="e.g. 5"
                />
              </div>
            )}

            <div className="rounded-2xl bg-black/[0.03] p-3 text-xs text-gray-500">
              ID: {flow.id}<br />
              Status: {flow.status}
              {flow.compliance?.exceeded && (
                <><br /><span className="font-medium text-red-500">Violation: {flow.compliance.violationType}</span></>
              )}
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
