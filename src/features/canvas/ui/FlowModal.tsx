'use client';

/**
 * FlowModal — floating dialog for editing Flow properties.
 * Replaces FlowSidebar with a centered modal (Universal Modals paradigm).
 *
 * Uses React Hook Form for local draft state, preventing
 * Jotai re-renders on every keystroke. Only commits to Jotai on Save.
 *
 * Liquid Glass design: frosted glass backdrop, spring mount animation.
 */

import { useAtom, useSetAtom } from 'jotai';
import { useEffect, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { useSpring, animated, config } from '@react-spring/web';
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

  // Spring animation for modal entrance
  const springStyles = useSpring({
    from: { opacity: 0, transform: 'scale(0.95) translateY(8px)' },
    to: { opacity: 1, transform: 'scale(1) translateY(0px)' },
    config: config.stiff,
  });

  const backdropSpring = useSpring({
    from: { opacity: 0 },
    to: { opacity: 1 },
    config: { tension: 300, friction: 30 },
  });

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
    <animated.div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/20 backdrop-blur-sm"
      style={backdropSpring}
      onClick={handleCancel}
    >
      <animated.div
        className="no-canvas-events flex max-h-[80vh] w-[440px] flex-col overflow-hidden rounded-3xl bg-white/72 shadow-2xl backdrop-blur-[40px] backdrop-saturate-[180%] border border-white/25"
        style={springStyles}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-gray-900">Edit Flow</h2>
            <p className="mt-0.5 text-xs text-gray-400">
              {fromNode?.name ?? flow.fromId} &rarr; {toNode?.name ?? flow.toId}
            </p>
          </div>
          <button
            onClick={handleCancel}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-black/5 text-sm text-gray-500 hover:bg-black/10 hover:text-gray-800 cursor-pointer transition-colors"
          >
            {'\u00d7'}
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-1 flex-col overflow-y-auto">
          <div className="flex-1 space-y-4 px-6 pb-6">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-500 tracking-wide">Flow Type</label>
              <select {...register('flowType')} className="w-full rounded-xl border border-black/8 bg-white/80 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 transition-all">
                {FLOW_TYPES.map((ft) => <option key={ft} value={ft}>{ft}</option>)}
              </select>
              {errors.flowType && <p className="mt-1 text-xs text-red-500">{errors.flowType.message}</p>}
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-500 tracking-wide">Gross Amount</label>
              <input type="number" step="0.01" min="0" {...register('grossAmount')} className="w-full rounded-xl border border-black/8 bg-white/80 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 transition-all" />
              {errors.grossAmount && <p className="mt-1 text-xs text-red-500">{errors.grossAmount.message}</p>}
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-500 tracking-wide">Currency</label>
              <select {...register('currency')} className="w-full rounded-xl border border-black/8 bg-white/80 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 transition-all">
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-500 tracking-wide">WHT Rate (0-1)</label>
              <input type="number" step="0.01" min="0" max="1" {...register('whtRate')} className="w-full rounded-xl border border-black/8 bg-white/80 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 transition-all" />
              {errors.whtRate && <p className="mt-1 text-xs text-red-500">{errors.whtRate.message}</p>}
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-500 tracking-wide">Payment Method</label>
              <select {...register('paymentMethod')} className="w-full rounded-xl border border-black/8 bg-white/80 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 transition-all">
                <option value="bank">Bank</option>
                <option value="cash">Cash</option>
                <option value="crypto">Crypto</option>
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-500 tracking-wide">Deal Tag</label>
              <input type="text" {...register('dealTag')} placeholder="Optional tag" className="w-full rounded-xl border border-black/8 bg-white/80 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 transition-all" />
            </div>

            <div className="rounded-2xl bg-black/3 p-3 text-xs text-gray-400">
              ID: {flow.id}<br />
              Status: {flow.status}
              {flow.compliance?.exceeded && (
                <><br /><span className="font-medium text-red-500">Violation: {flow.compliance.violationType}</span></>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="flex gap-2 border-t border-black/5 px-6 py-4">
            <button type="button" onClick={handleDelete} className="rounded-xl bg-red-500/8 px-4 py-2.5 text-xs font-semibold text-red-600 hover:bg-red-500/15 cursor-pointer transition-colors">
              Delete
            </button>
            <div className="flex-1" />
            <button type="button" onClick={handleCancel} className="rounded-xl bg-black/5 px-4 py-2.5 text-xs font-medium text-gray-600 hover:bg-black/10 cursor-pointer transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={!isDirty} className="rounded-xl bg-blue-500 px-4 py-2.5 text-xs font-semibold text-white hover:bg-blue-600 disabled:opacity-40 cursor-pointer transition-all active:scale-[0.97]">
              Save
            </button>
          </div>
        </form>
      </animated.div>
    </animated.div>
  );
}
