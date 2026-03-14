/**
 * Write-only action atoms for graph mutations (add node, add flow).
 *
 * These atoms update BOTH projectAtom and the individual entity atoms
 * (nodesAtom, flowsAtom) in a single Jotai batch — one React re-render.
 */

import { atom } from 'jotai';
import { projectAtom } from './project-atom';
import { nodesAtom } from '@entities/node';
import { flowsAtom } from '@entities/flow';
import { uid } from '@shared/lib/engine/utils';
import type { NodeDTO, FlowDTO, NodeType } from '@shared/types';

// ─── Add Node ───────────────────────────────────────────────────────────────

export interface AddNodePayload {
  type: NodeType;
  name: string;
  x: number;
  y: number;
  zoneId?: string;
}

export const addNodeAtom = atom(
  null,
  (_get, set, payload: AddNodePayload) => {
    const newNode: NodeDTO = {
      id: 'n_' + uid(),
      name: payload.name,
      type: payload.type,
      x: payload.x,
      y: payload.y,
      w: 180,
      h: 80,
      zoneId: payload.zoneId ?? null,
      frozen: false,
      riskFlags: [],
      annualIncome: 0,
      etr: 0,
      balances: {},
    };

    set(nodesAtom, (prev) => [...prev, newNode]);
    set(projectAtom, (prev) => {
      if (!prev) return prev;
      return { ...prev, nodes: [...prev.nodes, newNode] };
    });
  },
);

// ─── Add Flow ───────────────────────────────────────────────────────────────

export interface AddFlowPayload {
  fromId: string;
  toId: string;
}

export const addFlowAtom = atom(
  null,
  (get, set, payload: AddFlowPayload) => {
    const project = get(projectAtom);
    const fxDate = project?.fx?.fxDate || new Date().toISOString().slice(0, 10);

    const newFlow: FlowDTO = {
      id: 'f_' + uid(),
      fromId: payload.fromId,
      toId: payload.toId,
      flowType: 'Services',
      currency: 'KZT',
      grossAmount: 0,
      paymentMethod: 'bank',
      cashComponentAmount: 0,
      cashComponentCurrency: 'KZT',
      whtRate: 0,
      status: 'pending',
      flowDate: new Date(fxDate + 'T12:00:00Z').toISOString(),
      ack: { ackStatus: 'not_required', acknowledgedBy: null, acknowledgedAt: null, comment: '' },
      taxAdjustments: [],
      fxEvidence: null,
    };

    set(flowsAtom, (prev) => [...prev, newFlow]);
    set(projectAtom, (prev) => {
      if (!prev) return prev;
      return { ...prev, flows: [...prev.flows, newFlow] };
    });
  },
);
