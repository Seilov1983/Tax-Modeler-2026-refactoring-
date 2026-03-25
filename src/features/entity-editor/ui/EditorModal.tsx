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
import type { NodeDTO, OwnershipEdge, NodeType, Zone } from '@shared/types';
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

// ─── Liquid Glass utility classes (localized — no globals.css pollution) ──────

const GLASS_INPUT = 'bg-white/50 border-white/40 text-slate-900 placeholder:text-slate-500 focus-visible:ring-blue-500 focus-visible:border-transparent';
const GLASS_SELECT = 'bg-white/50 border-white/40 text-slate-900';
const GLASS_LABEL = 'text-slate-800 font-medium';

// ─── Form types ──────────────────────────────────────────────────────────────

interface NodeFormValues {
  name: string;
  type: NodeType;
  annualIncome: number;
  etr: number;
  citizenship: string;
  passiveIncomeShare: number;
  hasSubstance: boolean;
}

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
      <Label className={GLASS_LABEL}>Shareholders</Label>
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
                  Redistribute proportionally
                </button>
                <button
                  type="button"
                  onClick={() => setShowRedistribute(null)}
                  className="rounded-lg bg-slate-500/10 px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-500/20 transition-colors"
                >
                  Manual
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
        <span>Total</span>
        <span>{total.toFixed(2)}%</span>
      </div>

      {isOver100 && (
        <p className="mt-1 text-[11px] text-red-500 font-medium">
          Total exceeds 100%. Adjust shares before saving.
        </p>
      )}
      {isUnder100 && (
        <p className="mt-1 text-[11px] text-amber-500 font-medium">
          Warning: less than 100% allocated.
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
        Save shares
      </Button>
    </div>
  );
}

// ─── Sub-editors ─────────────────────────────────────────────────────────────

function NodeEditor({
  node,
  control,
  register,
  projectZones,
  lang: nodeLang,
  ownership,
  allNodes,
  updateOwnership,
}: {
  node: NodeDTO;
  control: ReturnType<typeof useForm<NodeFormValues>>['control'];
  register: ReturnType<typeof useForm<NodeFormValues>>['register'];
  projectZones: Zone[];
  lang: import('@shared/lib/i18n').Language;
  ownership: OwnershipEdge[];
  allNodes: NodeDTO[];
  updateOwnership: (payload: { id: string; data: Partial<OwnershipEdge> }) => void;
}) {
  const zone = projectZones.find((z) => z.id === node.zoneId);
  const watchType = node.type;

  return (
    <>
      <Field label={t('name', nodeLang)}>
        <Input type="text" className={GLASS_INPUT} {...register('name')} />
      </Field>

      <Field label="Type">
        <Controller
          name="type"
          control={control}
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger className={GLASS_SELECT}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="company">Company</SelectItem>
                <SelectItem value="person">Person</SelectItem>
                <SelectItem value="txa">TXA</SelectItem>
              </SelectContent>
            </Select>
          )}
        />
      </Field>

      {/* Spatial location — read-only badge (zone assignment is automatic via drag) */}
      <Field label={t('locatedIn', nodeLang)}>
        <Badge variant={zone ? 'default' : 'destructive'} className="w-full justify-start px-3 py-2 text-[13px] font-medium">
          {zone
            ? `${localizedName(zone.name, nodeLang)} (${zone.jurisdiction} \u00b7 ${zone.currency})`
            : t('noZone', nodeLang)}
        </Badge>
      </Field>

      <Field label={t('annualIncome', nodeLang)}>
        <Input
          type="number"
          step="any"
          className={GLASS_INPUT}
          {...register('annualIncome', { valueAsNumber: true })}
        />
      </Field>

      {watchType === 'company' && (
        <Field label={t('etrManual', nodeLang)}>
          <Input
            type="number"
            step="0.01"
            min={0}
            max={1}
            className={GLASS_INPUT}
            {...register('etr', { valueAsNumber: true })}
          />
        </Field>
      )}

      {watchType === 'person' && node.citizenship && (
        <Field label={t('citizenship', nodeLang)}>
          <Input type="text" className={GLASS_INPUT} {...register('citizenship')} />
        </Field>
      )}

      {watchType === 'company' && (
        <>
          <Field label={t('passiveIncomeShare', nodeLang)}>
            <Input
              type="number"
              step="1"
              min={0}
              max={100}
              className={GLASS_INPUT}
              {...register('passiveIncomeShare', { valueAsNumber: true })}
            />
          </Field>
          <Field label={t('hasSubstance', nodeLang)}>
            <Controller
              name="hasSubstance"
              control={control}
              render={({ field }) => (
                <div className="flex items-center gap-2 py-1">
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                  <span className="text-sm text-slate-600">
                    {field.value ? t('yes', nodeLang) : t('no', nodeLang)}
                  </span>
                </div>
              )}
            />
          </Field>
        </>
      )}

      {/* Cap Table: Shareholders section */}
      <ShareholdersSection
        nodeId={node.id}
        ownership={ownership}
        nodes={allNodes}
        updateOwnership={updateOwnership}
      />

      <div className="mt-4 rounded-xl bg-black/[0.03] p-3 text-[11px] text-gray-500">
        ID: {node.id}<br />Type: {node.type}<br />Frozen: {node.frozen ? 'Yes' : 'No'}
        {node.computedEtr != null && <><br />Computed ETR: {(node.computedEtr * 100).toFixed(2)}%</>}
        {node.computedCitKZT != null && <><br />Computed CIT (KZT): {node.computedCitKZT.toLocaleString('ru-RU')}</>}
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
  return (
    <>
      <Field label="Ownership (%)">
        <Input
          type="number"
          step="0.01"
          min={0}
          max={100}
          className={GLASS_INPUT}
          {...register('percent', { valueAsNumber: true })}
        />
      </Field>
      <Field label="Manual Adjustment">
        <Input
          type="number"
          step="0.01"
          className={GLASS_INPUT}
          {...register('manualAdjustment', { valueAsNumber: true })}
        />
      </Field>
      <div className="mt-4 rounded-xl bg-black/[0.03] p-3 text-[11px] text-gray-500">
        ID: {edge.id}<br />Parent: {edge.fromId}<br />Subsidiary: {edge.toId}
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3.5">
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
  const { t: tr, lang } = useTranslation();

  // ─── Resolve entity from selection ──────────────────────────────────
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

  // ─── react-hook-form for node editing ──────────────────────────────
  const nodeForm = useForm<NodeFormValues>({
    defaultValues: { name: '', type: 'company', annualIncome: 0, etr: 0, citizenship: '', passiveIncomeShare: 0, hasSubstance: false },
  });

  const ownershipForm = useForm<OwnershipFormValues>({
    defaultValues: { percent: 100, manualAdjustment: 0 },
  });

  // Reset form when selected entity changes
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
      });
    }
  }, [entityKey, isNode]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (entity && isOwnership && 'percent' in entity) {
      const o = entity as OwnershipEdge;
      ownershipForm.reset({
        percent: o.percent,
        manualAdjustment: o.manualAdjustment,
      });
    }
  }, [entityKey, isOwnership]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Gate: determine if modal should be open ───────────────────────
  const isOpen =
    !!selection &&
    !!project &&
    selection.type !== 'flow' &&
    selection.type !== 'zone' &&
    (selection.type !== 'node' || nodeEditing) &&
    (!!entity || isMultiNode);

  // ─── Handlers ──────────────────────────────────────────────────────
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
    };
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

  // ─── Label ─────────────────────────────────────────────────────────
  const label =
    isMultiNode && selection?.type === 'node'
      ? `${selection.ids.length} ${tr('nodesSelected')}`
      : selection
        ? (tr(ENTITY_LABEL_KEYS[selection.type] as Parameters<typeof tr>[0]) ?? selection.type)
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
            Edit properties for the selected canvas entity.
          </DialogDescription>
        </DialogHeader>

        {/* Body */}
        <div className="flex-1 overflow-y-auto flex flex-col gap-0">
          {isMultiNode ? (
            <div className="rounded-2xl bg-blue-500/6 p-3.5 text-[13px] text-blue-600">
              <strong>{selection?.type === 'node' ? selection.ids.length : 0} nodes</strong> selected.
              <br /><br />
              Drag any selected node to move all. Press <kbd className="rounded-md bg-blue-500/10 px-1.5 py-0.5 text-[11px]">Delete</kbd> to remove all.
            </div>
          ) : entity ? (
            <>
              {isNode && (
                <NodeEditor
                  node={entity as NodeDTO}
                  control={nodeForm.control}
                  register={nodeForm.register}
                  projectZones={project?.zones ?? []}
                  lang={lang}
                  ownership={project?.ownership ?? []}
                  allNodes={project?.nodes ?? []}
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
        <DialogFooter className="px-0 pt-4">
          <Button variant="destructive" onClick={handleDelete} data-testid="btn-delete-entity">
            {tr('delete')}
          </Button>
          <div className="flex-1" />
          <Button variant="secondary" onClick={handleClose}>
            {tr('cancel')}
          </Button>
          <Button onClick={handleSave} data-testid="btn-save-entity">
            {tr('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
