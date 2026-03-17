'use client';

/**
 * FlowModal — floating dialog for editing Flow properties.
 * Replaces FlowSidebar with a centered modal (Universal Modals paradigm).
 *
 * Uses React Hook Form for local draft state, preventing
 * Jotai re-renders on every keystroke. Only commits to Jotai on Save.
 */

import { useAtom, useSetAtom } from 'jotai';
import { useEffect, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { selectionAtom } from '@features/entity-editor/model/atoms';
import { projectAtom } from '@features/canvas/model/project-atom';
import { deleteFlowAtom } from '@features/canvas/model/graph-actions-atom';
import { commitHistoryAtom } from '@features/project-management/model/history-atoms';
import type { FlowType, CurrencyCode } from '@shared/types';

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

  const handleCancel = useCallback(() => {
    setSelection(null);
  }, [setSelection]);

  if (!flow || selection?.type !== 'flow') return null;

  const fromNode = project?.nodes.find((n) => n.id === flow.fromId);
  const toNode = project?.nodes.find((n) => n.id === flow.toId);

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40"
      onClick={handleCancel}
    >
      <div
        className="no-canvas-events flex max-h-[80vh] w-[420px] flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <div>
            <span className="text-base font-bold text-gray-800">Edit Flow</span>
            <div className="mt-0.5 text-xs text-gray-400">
              {fromNode?.name ?? flow.fromId} &rarr; {toNode?.name ?? flow.toId}
            </div>
          </div>
          <button
            onClick={handleCancel}
            className="border-none bg-none text-xl leading-none text-gray-500 hover:text-gray-800 cursor-pointer"
          >
            {'\u00d7'}
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-1 flex-col overflow-y-auto">
          <div className="flex-1 space-y-3 p-5">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">Flow Type</label>
              <select {...register('flowType')} className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-200">
                {FLOW_TYPES.map((ft) => <option key={ft} value={ft}>{ft}</option>)}
              </select>
              {errors.flowType && <p className="mt-0.5 text-xs text-red-500">{errors.flowType.message}</p>}
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">Gross Amount</label>
              <input type="number" step="0.01" min="0" {...register('grossAmount')} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-200" />
              {errors.grossAmount && <p className="mt-0.5 text-xs text-red-500">{errors.grossAmount.message}</p>}
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">Currency</label>
              <select {...register('currency')} className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-200">
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">WHT Rate (0-1)</label>
              <input type="number" step="0.01" min="0" max="1" {...register('whtRate')} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-200" />
              {errors.whtRate && <p className="mt-0.5 text-xs text-red-500">{errors.whtRate.message}</p>}
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">Payment Method</label>
              <select {...register('paymentMethod')} className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-200">
                <option value="bank">Bank</option>
                <option value="cash">Cash</option>
                <option value="crypto">Crypto</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">Deal Tag</label>
              <input type="text" {...register('dealTag')} placeholder="Optional tag" className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-200" />
            </div>

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
            <button type="button" onClick={handleDelete} className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-100 cursor-pointer transition-colors">
              Delete
            </button>
            <div className="flex-1" />
            <button type="button" onClick={handleCancel} className="rounded border border-gray-300 bg-gray-100 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-200 cursor-pointer transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={!isDirty} className="rounded bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50 cursor-pointer transition-colors">
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
