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

const FLOW_TYPES: FlowType[] = [
  'Dividends', 'Royalties', 'Interest', 'Services', 'Salary', 'Goods', 'Equipment',
];

const CURRENCIES: CurrencyCode[] = [
  'KZT', 'USD', 'EUR', 'AED', 'HKD', 'SGD', 'GBP', 'SCR', 'CNY',
];

interface FlowFormData {
  flowType: FlowType;
  grossAmount: number;
  currency: CurrencyCode;
  whtRate: number;
  paymentMethod: 'bank' | 'cash' | 'crypto';
  dealTag: string;
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
    formState: { errors, isDirty },
  } = useForm<FlowFormData>({
    defaultValues: flow ? {
      flowType: flow.flowType,
      grossAmount: flow.grossAmount,
      currency: flow.currency,
      whtRate: flow.whtRate,
      paymentMethod: flow.paymentMethod as 'bank' | 'cash' | 'crypto',
      dealTag: flow.dealTag ?? '',
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
  const inputClasses =
    'w-full rounded-xl border border-black/8 dark:border-white/10 bg-white/80 dark:bg-white/5 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 transition-all';

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
              <Label>{t('flowType')}</Label>
              <select {...register('flowType')} className={inputClasses}>
                {FLOW_TYPES.map((ft) => <option key={ft} value={ft}>{ft}</option>)}
              </select>
              {errors.flowType && <p className="mt-1 text-xs text-red-500">{errors.flowType.message}</p>}
            </div>

            <div>
              <Label>{t('grossAmount')}</Label>
              <Input type="number" step="0.01" min="0" {...register('grossAmount')} />
              {errors.grossAmount && <p className="mt-1 text-xs text-red-500">{errors.grossAmount.message}</p>}
            </div>

            <div>
              <Label>{t('currency')}</Label>
              <select {...register('currency')} className={inputClasses}>
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            <div>
              <Label>{t('whtRate')}</Label>
              <Input type="number" step="0.01" min="0" max="1" {...register('whtRate')} />
              {errors.whtRate && <p className="mt-1 text-xs text-red-500">{errors.whtRate.message}</p>}
            </div>

            <div>
              <Label>{t('paymentMethod')}</Label>
              <select {...register('paymentMethod')} className={inputClasses}>
                <option value="bank">{t('bank')}</option>
                <option value="cash">{t('cash')}</option>
                <option value="crypto">{t('crypto')}</option>
              </select>
            </div>

            <div>
              <Label>{t('dealTag')}</Label>
              <Input type="text" {...register('dealTag')} placeholder={t('optionalTag')} />
            </div>

            <div className="rounded-2xl bg-black/[0.03] dark:bg-white/5 p-3 text-xs text-gray-400 dark:text-gray-500">
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
