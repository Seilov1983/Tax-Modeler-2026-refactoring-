'use client';

/**
 * FlowSidebar — dedicated edge property editor for Flows.
 *
 * Uses React Hook Form + Zod 4 for local draft state, preventing
 * Jotai re-renders on every keystroke. Only commits to Jotai on Save.
 */

import { useAtom, useSetAtom, useAtomValue } from 'jotai';
import { useEffect, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { selectionAtom } from '@features/entity-editor/model/atoms';
import { projectAtom } from '@features/canvas/model/project-atom';
import { deleteFlowAtom } from '@features/canvas/model/graph-actions-atom';
import { commitHistoryAtom } from '@features/project-management/model/history-atoms';
import type { FlowType, CurrencyCode } from '@shared/types';
import { useTranslation } from '@shared/lib/i18n';

// ─── Zod 4 Schema ────────────────────────────────────────────────────────────

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

// ─── Component ──────────────────────────────────────────────────────────────

export function FlowSidebar() {
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

  // Reset form when selection changes
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

  const handleCancel = useCallback(() => {
    setSelection(null);
  }, [setSelection]);

  if (!flow || selection?.type !== 'flow') return null;

  // Look up node names for display
  const fromNode = project?.nodes.find((n) => n.id === flow.fromId);
  const toNode = project?.nodes.find((n) => n.id === flow.toId);

  return (
    <div
      className="no-canvas-events absolute top-0 right-0 z-40 flex h-full w-80 flex-col overflow-hidden border-l border-gray-200 bg-white shadow-lg"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <span className="text-sm font-bold text-gray-800">{t('editFlow')}</span>
        <button
          onClick={handleCancel}
          className="border-none bg-none text-lg leading-none text-gray-500 hover:text-gray-800 cursor-pointer"
        >
          {'\u00d7'}
        </button>
      </div>

      {/* Route info */}
      <div className="border-b border-gray-100 bg-gray-50 px-4 py-2 text-xs text-gray-500">
        {fromNode?.name ?? flow.fromId} &rarr; {toNode?.name ?? flow.toId}
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-1 flex-col overflow-y-auto">
        <div className="flex-1 space-y-3 p-4">
          {/* Flow Type */}
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">
              {t('flowType')}
            </label>
            <select
              {...register('flowType')}
              className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-200"
            >
              {FLOW_TYPES.map((ft) => (
                <option key={ft} value={ft}>{t(ft.toLowerCase() as any)}</option>
              ))}
            </select>
            {errors.flowType && <p className="mt-0.5 text-xs text-red-500">{errors.flowType.message}</p>}
          </div>

          {/* Gross Amount */}
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">
              {t('grossAmount')}
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              {...register('grossAmount')}
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-200"
            />
            {errors.grossAmount && <p className="mt-0.5 text-xs text-red-500">{errors.grossAmount.message}</p>}
          </div>

          {/* Currency */}
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">
              {t('currency')}
            </label>
            <select
              {...register('currency')}
              className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-200"
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          {/* WHT Rate */}
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">
              {t('whtRate')}
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              max="1"
              {...register('whtRate')}
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-200"
            />
            {errors.whtRate && <p className="mt-0.5 text-xs text-red-500">{errors.whtRate.message}</p>}
          </div>

          {/* Payment Method */}
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">
              {t('paymentMethod')}
            </label>
            <select
              {...register('paymentMethod')}
              className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-200"
            >
              <option value="bank">{t('bank')}</option>
              <option value="cash">{t('cash')}</option>
              <option value="crypto">{t('crypto')}</option>
            </select>
          </div>

          {/* Deal Tag */}
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">
              {t('dealTag')}
            </label>
            <input
              type="text"
              {...register('dealTag')}
              placeholder={t('optionalTag')}
              className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-200"
            />
          </div>

          {/* Metadata */}
          <div className="mt-3 rounded bg-gray-50 p-2 text-xs text-gray-400">
            ID: {flow.id}<br />
            Status: {flow.status}
            {flow.compliance?.exceeded && (
              <><br /><span className="text-red-500">Violation: {flow.compliance.violationType}</span></>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-2 border-t border-gray-200 p-4">
          <button
            type="button"
            onClick={handleDelete}
            className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-100 cursor-pointer transition-colors"
          >
            {t('delete')}
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={handleCancel}
            className="rounded border border-gray-300 bg-gray-100 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-200 cursor-pointer transition-colors"
          >
            {t('cancel')}
          </button>
          <button
            type="submit"
            disabled={!isDirty}
            className="rounded bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50 cursor-pointer transition-colors"
          >
            {t('save')}
          </button>
        </div>
      </form>
    </div>
  );
}
