'use client';

/**
 * EditorModal — floating dialog for editing Node/Flow/Ownership/Zone properties.
 * Replaces EditorSidebar with a centered modal (Universal Modals paradigm).
 *
 * Now uses shadcn/ui Dialog, Input, Badge, Label, Select primitives.
 * Spring animations replaced with Radix Dialog + Tailwind animate utilities.
 *
 * Jotai state management and i18n remain intact.
 */

import { useAtom, useSetAtom, useAtomValue } from 'jotai';
import { useRef, useCallback, useState, useEffect } from 'react';
import { selectionAtom, nodeEditingAtom } from '../model/atoms';
import { projectAtom } from '@features/canvas/model/project-atom';
import { nodesAtom } from '@entities/node';
import { deleteNodesAtom, deleteFlowAtom, deleteOwnershipAtom, deleteZoneAtom } from '@features/canvas/model/graph-actions-atom';
import { commitHistoryAtom } from '@features/project-management/model/history-atoms';
import { useTranslation, localizedName, t } from '@shared/lib/i18n';
import type { NodeDTO, FlowDTO, OwnershipEdge, FlowType, Zone } from '@shared/types';
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

const FLOW_TYPE_OPTIONS: FlowType[] = [
  'Dividends', 'Royalties', 'Interest', 'Services', 'Salary', 'Goods', 'Equipment',
];

const CURRENCY_OPTIONS = ['KZT', 'USD', 'EUR', 'AED', 'HKD', 'SGD', 'GBP', 'SCR', 'CNY'] as const;

// ─── Formatted numeric input (preserves existing behaviour) ─────────────────

const numFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 10 });

function NumericInput({
  value,
  onChange,
  className,
  step,
  min,
  max,
}: {
  value: number;
  onChange: (v: number) => void;
  className?: string;
  step?: string;
  min?: number;
  max?: number;
}) {
  const [display, setDisplay] = useState(() => formatNum(value));
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) {
      setDisplay(formatNum(value));
    }
  }, [value]);

  function formatNum(n: number): string {
    if (n === 0) return '0';
    return numFormatter.format(n);
  }

  function parseNum(s: string): number {
    const cleaned = s.replace(/[^0-9.\-]/g, '');
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? 0 : parsed;
  }

  return (
    <Input
      className={className}
      type="text"
      inputMode="decimal"
      value={display}
      onFocus={() => {
        focusedRef.current = true;
        setDisplay(String(value));
      }}
      onBlur={() => {
        focusedRef.current = false;
        const parsed = parseNum(display);
        const clamped = min != null && parsed < min ? min : max != null && parsed > max ? max : parsed;
        onChange(clamped);
        setDisplay(formatNum(clamped));
      }}
      onChange={(e) => {
        setDisplay(e.target.value);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

// ─── Sub-editors ─────────────────────────────────────────────────────────────

function NodeEditor({
  node, onChange, projectZones, lang: nodeLang,
}: {
  node: NodeDTO; onChange: (field: string, value: unknown) => void;
  projectZones: Zone[]; lang: import('@shared/lib/i18n').Language;
}) {
  const zone = projectZones.find((z) => z.id === node.zoneId);
  return (
    <>
      <Field label={t('name', nodeLang)}>
        <Input type="text" value={node.name} onChange={(e) => onChange('name', e.target.value)} />
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
        <NumericInput value={node.annualIncome} onChange={(v) => onChange('annualIncome', v)} />
      </Field>
      {node.type === 'company' && (
        <Field label={t('etrManual', nodeLang)}>
          <NumericInput value={node.etr} onChange={(v) => onChange('etr', v)} step="0.01" min={0} max={1} />
        </Field>
      )}
      {node.type === 'person' && node.citizenship && (
        <Field label={t('citizenship', nodeLang)}>
          <Input type="text" value={node.citizenship.join(', ')} onChange={(e) => onChange('citizenship', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))} />
        </Field>
      )}
      <div className="mt-4 rounded-xl bg-black/[0.03] dark:bg-white/5 p-3 text-[11px] text-gray-400 dark:text-gray-500">
        ID: {node.id}<br />Type: {node.type}<br />Frozen: {node.frozen ? 'Yes' : 'No'}
        {node.computedEtr != null && <><br />Computed ETR: {(node.computedEtr * 100).toFixed(2)}%</>}
        {node.computedCitKZT != null && <><br />Computed CIT (KZT): {node.computedCitKZT.toLocaleString('ru-RU')}</>}
      </div>
    </>
  );
}

function FlowEditor({ flow, onChange }: { flow: FlowDTO; onChange: (field: string, value: unknown) => void }) {
  return (
    <>
      <Field label="Flow Type">
        <Select value={flow.flowType} onValueChange={(v) => onChange('flowType', v)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {FLOW_TYPE_OPTIONS.map((ft) => <SelectItem key={ft} value={ft}>{ft}</SelectItem>)}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Gross Amount"><NumericInput value={flow.grossAmount} onChange={(v) => onChange('grossAmount', v)} /></Field>
      <Field label="Currency">
        <Select value={flow.currency} onValueChange={(v) => onChange('currency', v)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {CURRENCY_OPTIONS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </Field>
      <Field label="WHT Rate"><NumericInput value={flow.whtRate} onChange={(v) => onChange('whtRate', v)} step="0.01" min={0} max={1} /></Field>
      <Field label="Payment Method">
        <Select value={flow.paymentMethod} onValueChange={(v) => onChange('paymentMethod', v)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="bank">Bank</SelectItem>
            <SelectItem value="cash">Cash</SelectItem>
            <SelectItem value="crypto">Crypto</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <div className="mt-4 rounded-xl bg-black/[0.03] dark:bg-white/5 p-3 text-[11px] text-gray-400 dark:text-gray-500">
        ID: {flow.id}<br />From: {flow.fromId} → To: {flow.toId}<br />Status: {flow.status}
        {flow.compliance?.exceeded && <><br /><span className="font-medium text-red-500">Violation: {flow.compliance.violationType}</span></>}
      </div>
    </>
  );
}

function OwnershipEditor({ edge, onChange }: { edge: OwnershipEdge; onChange: (field: string, value: unknown) => void }) {
  return (
    <>
      <Field label="Ownership (%)"><NumericInput value={edge.percent} onChange={(v) => onChange('percent', v)} min={0} max={100} step="0.01" /></Field>
      <Field label="Manual Adjustment"><NumericInput value={edge.manualAdjustment} onChange={(v) => onChange('manualAdjustment', v)} step="0.01" /></Field>
      <div className="mt-4 rounded-xl bg-black/[0.03] dark:bg-white/5 p-3 text-[11px] text-gray-400 dark:text-gray-500">
        ID: {edge.id}<br />Parent: {edge.fromId}<br />Subsidiary: {edge.toId}
      </div>
    </>
  );
}

function ZoneEditor({ zone, onChange }: { zone: Zone; onChange: (field: string, value: unknown) => void }) {
  return (
    <>
      <Field label="Name"><Input type="text" value={zone.name || ''} onChange={(e) => onChange('name', e.target.value)} /></Field>
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Width"><NumericInput value={zone.w || 0} onChange={(v) => onChange('w', v || 200)} /></Field>
        <Field label="Height"><NumericInput value={zone.h || 0} onChange={(v) => onChange('h', v || 400)} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="X"><NumericInput value={zone.x || 0} onChange={(v) => onChange('x', v)} /></Field>
        <Field label="Y"><NumericInput value={zone.y || 0} onChange={(v) => onChange('y', v)} /></Field>
      </div>
      <div className="mt-4 rounded-xl bg-black/[0.03] dark:bg-white/5 p-3 text-[11px] text-gray-400 dark:text-gray-500">
        ID: {zone.id}<br />Jurisdiction: {zone.jurisdiction}<br />Currency: {zone.currency}
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3.5">
      <Label>{label}</Label>
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
  const [project, setProject] = useAtom(projectAtom);
  const deleteNodes = useSetAtom(deleteNodesAtom);
  const deleteFlow = useSetAtom(deleteFlowAtom);
  const deleteOwnership = useSetAtom(deleteOwnershipAtom);
  const deleteZone = useSetAtom(deleteZoneAtom);
  const commitHistory = useSetAtom(commitHistoryAtom);
  const setNodes = useSetAtom(nodesAtom);
  const [nodeEditing, setNodeEditing] = useAtom(nodeEditingAtom);
  const { t: tr, lang } = useTranslation();

  const [draft, setDraft] = useState<Record<string, unknown> | null>(null);
  const draftInitRef = useRef<string | null>(null);

  if (!selection || !project) return null;

  // Flow editing is handled by FlowModal
  if (selection.type === 'flow') return null;

  // Zone selection only shows the Transformer for visual resizing — no modal
  if (selection.type === 'zone') return null;

  // Node editing requires double-click (nodeEditingAtom must be true)
  if (selection.type === 'node' && !nodeEditing) return null;

  const isMultiNode = selection.type === 'node' && selection.ids.length > 1;

  let entity: NodeDTO | FlowDTO | OwnershipEdge | Zone | undefined;
  let entityKey: string | null = null;
  if (selection.type === 'node') {
    if (selection.ids.length === 1) {
      entity = project.nodes.find((n) => n.id === selection.ids[0]);
      entityKey = selection.ids[0];
    }
  } else if (selection.type === 'zone') {
    entity = project.zones?.find((z) => z.id === selection.id);
    entityKey = selection.id;
  } else {
    entity = project.ownership.find((o) => o.id === selection.id);
    entityKey = selection.id;
  }

  if (!entity && !isMultiNode) return null;

  if (entity && entityKey && draftInitRef.current !== entityKey) {
    draftInitRef.current = entityKey;
    if (draft === null || draftInitRef.current !== entityKey) {
      queueMicrotask(() => setDraft({ ...entity as unknown as Record<string, unknown> }));
    }
  }

  const currentDraft = (draft && draftInitRef.current === entityKey) ? draft : (entity ? { ...entity as unknown as Record<string, unknown> } : null);
  const singleNodeId = selection.type === 'node' && selection.ids.length === 1 ? selection.ids[0] : null;
  const entityId = (selection.type === 'ownership' || selection.type === 'zone') ? selection.id : null;

  const updateDraftField = (field: string, value: unknown) => {
    setDraft((prev) => prev ? { ...prev, [field]: value } : prev);
  };

  const handleSave = () => {
    if (!currentDraft) return;
    commitHistory();
    setProject((prev) => {
      if (!prev) return prev;
      if (singleNodeId) {
        return { ...prev, nodes: prev.nodes.map((n) => n.id === singleNodeId ? { ...n, ...currentDraft } as NodeDTO : n) };
      }
      if (selection.type === 'zone' && entityId) {
        return { ...prev, zones: (prev.zones || []).map((z) => z.id === entityId ? { ...z, ...currentDraft } as Zone : z) };
      }
      if (entityId) {
        return { ...prev, ownership: prev.ownership.map((o) => o.id === entityId ? { ...o, ...currentDraft } as OwnershipEdge : o) };
      }
      return prev;
    });
    // Also update nodesAtom so splitAtom-derived nodeAtom triggers CanvasNode re-render
    if (singleNodeId) {
      setNodes((prev) =>
        prev.map((n) => n.id === singleNodeId ? { ...n, ...currentDraft } as NodeDTO : n),
      );
    }
    setSelection(null);
    setNodeEditing(false);
    setDraft(null);
    draftInitRef.current = null;
  };

  const handleClose = () => {
    setSelection(null);
    setNodeEditing(false);
    setDraft(null);
    draftInitRef.current = null;
  };

  const handleDelete = () => {
    if (selection.type === 'node') deleteNodes(selection.ids);
    else if (selection.type === 'zone') deleteZone(selection.id);
    else deleteOwnership(selection.id);
    setNodeEditing(false);
    setDraft(null);
    draftInitRef.current = null;
  };

  const label = isMultiNode
    ? `${selection.ids.length} ${tr('nodesSelected')}`
    : tr(ENTITY_LABEL_KEYS[selection.type] as Parameters<typeof tr>[0]) ?? selection.type;

  const isOpen = true;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) handleClose(); }}>
      <DialogContent
        className="no-canvas-events sm:max-w-[425px] p-6 bg-white/70 dark:bg-zinc-900/70 backdrop-blur-xl border border-white/20 shadow-2xl rounded-3xl z-50"
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
            <div className="rounded-2xl bg-blue-500/6 p-3.5 text-[13px] text-blue-600 dark:text-blue-400">
              <strong>{selection.ids.length} nodes</strong> selected.
              <br /><br />
              Drag any selected node to move all. Press <kbd className="rounded-md bg-blue-500/10 px-1.5 py-0.5 text-[11px]">Delete</kbd> to remove all.
            </div>
          ) : currentDraft ? (
            <>
              {selection.type === 'node' && <NodeEditor node={currentDraft as unknown as NodeDTO} onChange={updateDraftField} projectZones={project.zones ?? []} lang={lang} />}
              {selection.type === 'ownership' && <OwnershipEditor edge={currentDraft as unknown as OwnershipEdge} onChange={updateDraftField} />}
              {selection.type === 'zone' && <ZoneEditor zone={currentDraft as unknown as Zone} onChange={updateDraftField} />}
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
