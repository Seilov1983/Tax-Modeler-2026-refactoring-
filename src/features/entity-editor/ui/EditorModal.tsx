'use client';

/**
 * EditorModal — floating dialog for editing Node/Flow/Ownership/Zone properties.
 * Replaces EditorSidebar with a centered modal (Universal Modals paradigm).
 *
 * Single-clicking a Flow, Node, Ownership, or Zone opens this modal.
 * Uses local draft state to avoid Jotai re-renders during editing.
 */

import { useAtom, useSetAtom, useAtomValue } from 'jotai';
import { useRef, useCallback, useState, useEffect } from 'react';
import { selectionAtom } from '../model/atoms';
import { projectAtom } from '@features/canvas/model/project-atom';
import { deleteNodesAtom, deleteFlowAtom, deleteOwnershipAtom, deleteZoneAtom } from '@features/canvas/model/graph-actions-atom';
import { commitHistoryAtom } from '@features/project-management/model/history-atoms';
import type { NodeDTO, FlowDTO, OwnershipEdge, FlowType, Zone, TaxRegime } from '@shared/types';

const FLOW_TYPE_OPTIONS: FlowType[] = [
  'Dividends', 'Royalties', 'Interest', 'Services', 'Salary', 'Goods', 'Equipment',
];

const CURRENCY_OPTIONS = ['KZT', 'USD', 'EUR', 'AED', 'HKD', 'SGD', 'GBP', 'SCR', 'CNY'] as const;

// ─── Shared styles ──────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '11px', color: '#6b7280',
  textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px',
};

const inputStyle: React.CSSProperties = {
  width: '100%', border: '1px solid #d1d5db', borderRadius: '4px',
  padding: '6px 8px', fontSize: '13px', outline: 'none',
};

const selectStyle: React.CSSProperties = { ...inputStyle, background: '#fff' };

// ─── Formatted numeric input ────────────────────────────────────────────────

const numFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 10 });

function NumericInput({
  value,
  onChange,
  style,
  step,
  min,
  max,
}: {
  value: number;
  onChange: (v: number) => void;
  style?: React.CSSProperties;
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
    <input
      style={style ?? inputStyle}
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
  node, onChange, availableRegimes, projectZones,
}: {
  node: NodeDTO; onChange: (field: string, value: unknown) => void;
  availableRegimes: TaxRegime[]; projectZones: Zone[];
}) {
  return (
    <>
      <Field label="Name">
        <input style={inputStyle} type="text" value={node.name} onChange={(e) => onChange('name', e.target.value)} />
      </Field>
      <Field label="Zone">
        <select style={selectStyle} value={node.zoneId || ''} onChange={(e) => onChange('zoneId', e.target.value || null)}>
          <option value="">— none —</option>
          {projectZones.map((z) => <option key={z.id} value={z.id}>{z.name} ({z.jurisdiction} · {z.currency})</option>)}
        </select>
      </Field>
      {node.type === 'company' && (
        <Field label="Tax Regime">
          <select style={selectStyle} value={node.regimeId || ''} onChange={(e) => onChange('regimeId', e.target.value || null)}>
            <option value="">— none —</option>
            {availableRegimes.map((r) => <option key={r.id} value={r.id}>{r.name} (CIT {r.cit}%, WHT {r.wht}%)</option>)}
          </select>
        </Field>
      )}
      <Field label="Annual Income">
        <NumericInput style={inputStyle} value={node.annualIncome} onChange={(v) => onChange('annualIncome', v)} />
      </Field>
      {node.type === 'company' && (
        <Field label="ETR (manual)">
          <NumericInput style={inputStyle} value={node.etr} onChange={(v) => onChange('etr', v)} step="0.01" min={0} max={1} />
        </Field>
      )}
      {node.type === 'person' && node.citizenship && (
        <Field label="Citizenship">
          <input style={inputStyle} type="text" value={node.citizenship.join(', ')} onChange={(e) => onChange('citizenship', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))} />
        </Field>
      )}
      <div style={{ marginTop: '12px', padding: '8px', background: '#f9fafb', borderRadius: '4px', fontSize: '11px', color: '#9ca3af' }}>
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
        <select style={selectStyle} value={flow.flowType} onChange={(e) => onChange('flowType', e.target.value)}>
          {FLOW_TYPE_OPTIONS.map((ft) => <option key={ft} value={ft}>{ft}</option>)}
        </select>
      </Field>
      <Field label="Gross Amount"><NumericInput style={inputStyle} value={flow.grossAmount} onChange={(v) => onChange('grossAmount', v)} /></Field>
      <Field label="Currency">
        <select style={selectStyle} value={flow.currency} onChange={(e) => onChange('currency', e.target.value)}>
          {CURRENCY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </Field>
      <Field label="WHT Rate"><NumericInput style={inputStyle} value={flow.whtRate} onChange={(v) => onChange('whtRate', v)} step="0.01" min={0} max={1} /></Field>
      <Field label="Payment Method">
        <select style={selectStyle} value={flow.paymentMethod} onChange={(e) => onChange('paymentMethod', e.target.value)}>
          <option value="bank">Bank</option><option value="cash">Cash</option><option value="crypto">Crypto</option>
        </select>
      </Field>
      <div style={{ marginTop: '12px', padding: '8px', background: '#f9fafb', borderRadius: '4px', fontSize: '11px', color: '#9ca3af' }}>
        ID: {flow.id}<br />From: {flow.fromId} → To: {flow.toId}<br />Status: {flow.status}
        {flow.compliance?.exceeded && <><br /><span style={{ color: '#dc2626' }}>Violation: {flow.compliance.violationType}</span></>}
      </div>
    </>
  );
}

function OwnershipEditor({ edge, onChange }: { edge: OwnershipEdge; onChange: (field: string, value: unknown) => void }) {
  return (
    <>
      <Field label="Ownership (%)"><NumericInput style={inputStyle} value={edge.percent} onChange={(v) => onChange('percent', v)} min={0} max={100} step="0.01" /></Field>
      <Field label="Manual Adjustment"><NumericInput style={inputStyle} value={edge.manualAdjustment} onChange={(v) => onChange('manualAdjustment', v)} step="0.01" /></Field>
      <div style={{ marginTop: '12px', padding: '8px', background: '#f9fafb', borderRadius: '4px', fontSize: '11px', color: '#9ca3af' }}>
        ID: {edge.id}<br />Parent: {edge.fromId}<br />Subsidiary: {edge.toId}
      </div>
    </>
  );
}

function ZoneEditor({ zone, onChange }: { zone: Zone; onChange: (field: string, value: unknown) => void }) {
  return (
    <>
      <Field label="Name"><input style={inputStyle} type="text" value={zone.name || ''} onChange={(e) => onChange('name', e.target.value)} /></Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
        <Field label="Width"><NumericInput style={inputStyle} value={zone.w || 0} onChange={(v) => onChange('w', v || 200)} /></Field>
        <Field label="Height"><NumericInput style={inputStyle} value={zone.h || 0} onChange={(v) => onChange('h', v || 400)} /></Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
        <Field label="X"><NumericInput style={inputStyle} value={zone.x || 0} onChange={(v) => onChange('x', v)} /></Field>
        <Field label="Y"><NumericInput style={inputStyle} value={zone.y || 0} onChange={(v) => onChange('y', v)} /></Field>
      </div>
      <div style={{ marginTop: '12px', padding: '8px', background: '#f9fafb', borderRadius: '4px', fontSize: '11px', color: '#9ca3af' }}>
        ID: {zone.id}<br />Jurisdiction: {zone.jurisdiction}<br />Currency: {zone.currency}
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '12px' }}>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  );
}

const ENTITY_LABELS: Record<string, string> = {
  node: 'Node', flow: 'Flow', ownership: 'Ownership', zone: 'Zone',
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

  const [draft, setDraft] = useState<Record<string, unknown> | null>(null);
  const draftInitRef = useRef<string | null>(null);

  if (!selection || !project) return null;

  // Flow editing is handled by FlowModal
  if (selection.type === 'flow') return null;

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
    setSelection(null);
    setDraft(null);
    draftInitRef.current = null;
  };

  const handleCancel = () => {
    setSelection(null);
    setDraft(null);
    draftInitRef.current = null;
  };

  const handleDelete = () => {
    if (selection.type === 'node') deleteNodes(selection.ids);
    else if (selection.type === 'zone') deleteZone(selection.id);
    else deleteOwnership(selection.id);
    setDraft(null);
    draftInitRef.current = null;
  };

  const availableRegimes: TaxRegime[] = (() => {
    if (selection.type !== 'node' || !currentDraft || (currentDraft as unknown as NodeDTO).type !== 'company') return [];
    const node = currentDraft as unknown as NodeDTO;
    const allRegimes = project.masterData?.regimes ?? [];
    const zone = project.zones?.find((z) => z.id === node.zoneId);
    if (zone) return allRegimes.filter((r) => r.countryId === zone.jurisdiction);
    return allRegimes;
  })();

  const label = isMultiNode
    ? `${selection.ids.length} Nodes`
    : ENTITY_LABELS[selection.type] ?? selection.type;

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
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '16px 20px', borderBottom: '1px solid #e5e7eb',
        }}>
          <span style={{ fontWeight: 700, fontSize: '15px' }}>Edit {label}</span>
          <button onClick={handleCancel} style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: '#6b7280', lineHeight: 1 }}>
            {'\u00d7'}
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
          {isMultiNode ? (
            <div style={{ padding: '12px', background: '#eff6ff', borderRadius: '6px', fontSize: '13px', color: '#1e40af' }}>
              <strong>{selection.ids.length} nodes</strong> selected.
              <br /><br />
              Drag any selected node to move all. Press <kbd style={{ padding: '1px 4px', background: '#dbeafe', borderRadius: '3px', fontSize: '11px' }}>Delete</kbd> to remove all.
            </div>
          ) : currentDraft ? (
            <>
              {selection.type === 'node' && <NodeEditor node={currentDraft as unknown as NodeDTO} onChange={updateDraftField} availableRegimes={availableRegimes} projectZones={project.zones ?? []} />}
              {selection.type === 'ownership' && <OwnershipEditor edge={currentDraft as unknown as OwnershipEdge} onChange={updateDraftField} />}
              {selection.type === 'zone' && <ZoneEditor zone={currentDraft as unknown as Zone} onChange={updateDraftField} />}
            </>
          ) : null}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 20px', borderTop: '1px solid #e5e7eb', display: 'flex', gap: '8px' }}>
          <button onClick={handleDelete} data-testid="btn-delete-entity" style={{
            flex: '0 0 auto', padding: '8px 14px', background: '#fef2f2', color: '#dc2626',
            fontWeight: 600, fontSize: '13px', border: '1px solid #fecaca', borderRadius: '4px', cursor: 'pointer',
          }}>Delete</button>
          <div style={{ flex: 1 }} />
          <button onClick={handleCancel} style={{
            padding: '8px 14px', background: '#f3f4f6', color: '#374151', fontWeight: 500,
            fontSize: '13px', border: '1px solid #d1d5db', borderRadius: '4px', cursor: 'pointer',
          }}>Cancel</button>
          <button onClick={handleSave} data-testid="btn-save-entity" style={{
            padding: '8px 14px', background: '#2563eb', color: '#fff', fontWeight: 600,
            fontSize: '13px', border: 'none', borderRadius: '4px', cursor: 'pointer',
          }}>Save</button>
        </div>
      </div>
    </div>
  );
}
