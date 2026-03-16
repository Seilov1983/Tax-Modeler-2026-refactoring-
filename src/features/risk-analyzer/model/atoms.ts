import { atom } from 'jotai';
import { atomFamily } from 'jotai-family';
import { projectAtom } from '@features/canvas/model/project-atom';
import { recomputeRisks } from '@shared/lib/engine/engine-risks';
import { ensureMasterData } from '@shared/lib/engine/engine-core';
import type { Project, RiskFlag } from '@shared/types';

const yieldTask = () => new Promise((resolve) => setTimeout(resolve, 0));

// ─── Async derived atom: reactive risk evaluation ────────────────────────────

export const riskCalculationAtom = atom(async (get) => {
  const project = get(projectAtom);

  if (!project || !project.nodes || !project.flows) {
    return { nodeRisks: {} as Record<string, RiskFlag[]>, flowRisks: {} as Record<string, RiskFlag[]> };
  }

  await yieldTask();

  // Deep clone — recomputeRisks mutates in place
  const p = JSON.parse(JSON.stringify(project)) as Project;
  ensureMasterData(p);
  recomputeRisks(p);

  // Group node.riskFlags by nodeId
  const nodeRisks: Record<string, RiskFlag[]> = {};
  for (const node of p.nodes) {
    if (node.riskFlags && node.riskFlags.length > 0) {
      nodeRisks[node.id] = node.riskFlags;
    }
  }

  // Extract flow-related risks (TRANSFER_PRICING_RISK has flowId)
  const flowRisks: Record<string, RiskFlag[]> = {};
  for (const node of p.nodes) {
    for (const flag of node.riskFlags || []) {
      const flowId = flag.flowId as string | undefined;
      if (flowId) {
        if (!flowRisks[flowId]) flowRisks[flowId] = [];
        flowRisks[flowId].push(flag);
      }
    }
  }

  return { nodeRisks, flowRisks };
});

// ─── Per-node risk selector ─────────────────────────────────────────────────

export const nodeRiskAtomFamily = atomFamily((nodeId: string) =>
  atom(async (get) => {
    const risks = await get(riskCalculationAtom);
    return risks.nodeRisks[nodeId] || [];
  }),
);

// ─── Per-flow risk selector ─────────────────────────────────────────────────

export const flowRiskAtomFamily = atomFamily((flowId: string) =>
  atom(async (get) => {
    const risks = await get(riskCalculationAtom);
    return risks.flowRisks[flowId] || [];
  }),
);
