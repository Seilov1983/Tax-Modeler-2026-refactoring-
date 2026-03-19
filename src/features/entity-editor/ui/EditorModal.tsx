'use client';

/**
 * EditorModal — floating Liquid Glass dialog for editing Node and Ownership properties.
 * Uses react-hook-form for form state; dispatches updates via Jotai action atoms.
 * Flow editing is handled by FlowModal; zone editing is via the canvas Transformer.
 */

import { useAtom, useSetAtom, useAtomValue } from 'jotai';
import { useEffect } from 'react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// ─── Form types ──────────────────────────────────────────────────────────────

interface NodeFormValues {
  name: string;
  type: NodeType;
  annualIncome: number;
  etr: number;
  citizenship: string;
}

interface OwnershipFormValues {
  percent: number;
  manualAdjustment: number;
}

// ─── Sub-editors ─────────────────────────────────────────────────────────────

function NodeEditor({
  node,
  control,
  register,
  projectZones,
  lang: nodeLang,
}: {
  node: NodeDTO;
  control: ReturnType<typeof useForm<NodeFormValues>>['control'];
  register: ReturnType<typeof useForm<NodeFormValues>>['register'];
  projectZones: Zone[];
  lang: import('@shared/lib/i18n').Language;
}) {
  const zone = projectZones.find((z) => z.id === node.zoneId);
  const watchType = node.type;

  return (
    <>
      <Field label={t('name', nodeLang)}>
        <Input type="text" {...register('name')} />
      </Field>

      <Field label="Type">
        <Controller
          name="type"
          control={control}
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger>
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
            {...register('etr', { valueAsNumber: true })}
          />
        </Field>
      )}

      {watchType === 'person' && node.citizenship && (
        <Field label={t('citizenship', nodeLang)}>
          <Input type="text" {...register('citizenship')} />
        </Field>
      )}

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
          {...register('percent', { valueAsNumber: true })}
        />
      </Field>
      <Field label="Manual Adjustment">
        <Input
          type="number"
          step="0.01"
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
      <Label className="text-slate-900">{label}</Label>
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
    defaultValues: { name: '', type: 'company', annualIncome: 0, etr: 0, citizenship: '' },
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
        className="no-canvas-events sm:max-w-[425px] p-6 bg-white/60 backdrop-blur-xl border border-white/50 shadow-2xl rounded-3xl z-50 text-slate-900"
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
