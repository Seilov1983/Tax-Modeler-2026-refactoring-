'use client';

import { useAtom, useSetAtom } from 'jotai';
import { selectionAtom } from '../model/atoms';
import { projectAtom } from '@features/canvas/model/project-atom';
import { deleteNodeAtom, deleteFlowAtom, deleteOwnershipAtom } from '@features/canvas/model/graph-actions-atom';
import type { NodeDTO, FlowDTO, OwnershipEdge, FlowType } from '@shared/types';

const ZONE_OPTIONS = [
  { value: 'KZ_HUB', label: 'Kazakhstan Astana Hub' },
  { value: 'KZ_AIFC', label: 'Kazakhstan AIFC' },
  { value: 'UAE_FREEZONE_QFZP', label: 'UAE Free Zone (QFZP)' },
  { value: 'UAE_FREEZONE_NONQFZP', label: 'UAE Free Zone (Non-QFZP)' },
  { value: 'HK_OFFSHORE', label: 'Hong Kong Offshore' },
] as const;

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

// ─── Node editor ────────────────────────────────────────────────────────────

function NodeEditor({
  node,
  onChange,
}: {
  node: NodeDTO;
  onChange: (field: string, value: unknown) => void;
}) {
  return (
    <>
      <Field label="Name">
        <input
          style={inputStyle}
          type="text"
          value={node.name}
          onChange={(e) => onChange('name', e.target.value)}
        />
      </Field>

      <Field label="Zone">
        <select
          style={selectStyle}
          value={node.zoneId || ''}
          onChange={(e) => onChange('zoneId', e.target.value || null)}
        >
          <option value="">— none —</option>
          {ZONE_OPTIONS.map((z) => (
            <option key={z.value} value={z.value}>{z.label}</option>
          ))}
        </select>
      </Field>

      <Field label="Annual Income">
        <input
          style={inputStyle}
          type="number"
          value={node.annualIncome}
          onChange={(e) => onChange('annualIncome', parseFloat(e.target.value) || 0)}
        />
      </Field>

      {node.type === 'company' && (
        <Field label="ETR (manual)">
          <input
            style={inputStyle}
            type="number"
            step="0.01"
            min="0"
            max="1"
            value={node.etr}
            onChange={(e) => onChange('etr', parseFloat(e.target.value) || 0)}
          />
        </Field>
      )}

      {node.type === 'person' && node.citizenship && (
        <Field label="Citizenship">
          <input
            style={inputStyle}
            type="text"
            value={node.citizenship.join(', ')}
            onChange={(e) =>
              onChange(
                'citizenship',
                e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
              )
            }
          />
        </Field>
      )}

      <div style={{ marginTop: '12px', padding: '8px', background: '#f9fafb', borderRadius: '4px', fontSize: '11px', color: '#9ca3af' }}>
        ID: {node.id}<br />
        Type: {node.type}<br />
        Frozen: {node.frozen ? 'Yes' : 'No'}<br />
        {node.computedEtr != null && <>Computed ETR: {(node.computedEtr * 100).toFixed(2)}%<br /></>}
        {node.computedCitKZT != null && <>Computed CIT (KZT): {node.computedCitKZT.toLocaleString('ru-RU')}</>}
      </div>
    </>
  );
}

// ─── Flow editor ────────────────────────────────────────────────────────────

function FlowEditor({
  flow,
  onChange,
}: {
  flow: FlowDTO;
  onChange: (field: string, value: unknown) => void;
}) {
  return (
    <>
      <Field label="Flow Type">
        <select
          style={selectStyle}
          value={flow.flowType}
          onChange={(e) => onChange('flowType', e.target.value)}
        >
          {FLOW_TYPE_OPTIONS.map((ft) => (
            <option key={ft} value={ft}>{ft}</option>
          ))}
        </select>
      </Field>

      <Field label="Gross Amount">
        <input
          style={inputStyle}
          type="number"
          value={flow.grossAmount}
          onChange={(e) => onChange('grossAmount', parseFloat(e.target.value) || 0)}
        />
      </Field>

      <Field label="Currency">
        <select
          style={selectStyle}
          value={flow.currency}
          onChange={(e) => onChange('currency', e.target.value)}
        >
          {CURRENCY_OPTIONS.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </Field>

      <Field label="WHT Rate">
        <input
          style={inputStyle}
          type="number"
          step="0.01"
          min="0"
          max="1"
          value={flow.whtRate}
          onChange={(e) => onChange('whtRate', parseFloat(e.target.value) || 0)}
        />
      </Field>

      <Field label="Payment Method">
        <select
          style={selectStyle}
          value={flow.paymentMethod}
          onChange={(e) => onChange('paymentMethod', e.target.value)}
        >
          <option value="bank">Bank</option>
          <option value="cash">Cash</option>
          <option value="crypto">Crypto</option>
        </select>
      </Field>

      <div style={{ marginTop: '12px', padding: '8px', background: '#f9fafb', borderRadius: '4px', fontSize: '11px', color: '#9ca3af' }}>
        ID: {flow.id}<br />
        From: {flow.fromId} → To: {flow.toId}<br />
        Status: {flow.status}
        {flow.compliance?.exceeded && (
          <><br /><span style={{ color: '#dc2626' }}>Violation: {flow.compliance.violationType}</span></>
        )}
      </div>
    </>
  );
}

// ─── Ownership editor ───────────────────────────────────────────────────────

function OwnershipEditor({
  edge,
  onChange,
}: {
  edge: OwnershipEdge;
  onChange: (field: string, value: unknown) => void;
}) {
  return (
    <>
      <Field label="Ownership (%)">
        <input
          style={inputStyle}
          type="number"
          min={0}
          max={100}
          step={0.01}
          value={edge.percent}
          onChange={(e) => onChange('percent', parseFloat(e.target.value) || 0)}
        />
      </Field>

      <Field label="Manual Adjustment">
        <input
          style={inputStyle}
          type="number"
          step={0.01}
          value={edge.manualAdjustment}
          onChange={(e) => onChange('manualAdjustment', parseFloat(e.target.value) || 0)}
        />
      </Field>

      <div style={{ marginTop: '12px', padding: '8px', background: '#f9fafb', borderRadius: '4px', fontSize: '11px', color: '#9ca3af' }}>
        ID: {edge.id}<br />
        Parent: {edge.fromId}<br />
        Subsidiary: {edge.toId}
      </div>
    </>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '12px' }}>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  );
}

const ENTITY_LABELS: Record<string, string> = {
  node: 'Node',
  flow: 'Flow',
  ownership: 'Ownership',
};

// ─── Main sidebar ───────────────────────────────────────────────────────────

export function EditorSidebar() {
  const [selection, setSelection] = useAtom(selectionAtom);
  const [project, setProject] = useAtom(projectAtom);
  const deleteNode = useSetAtom(deleteNodeAtom);
  const deleteFlow = useSetAtom(deleteFlowAtom);
  const deleteOwnership = useSetAtom(deleteOwnershipAtom);

  if (!selection || !project) return null;

  // Look up the selected entity from the correct collection
  let entity: NodeDTO | FlowDTO | OwnershipEdge | undefined;
  if (selection.type === 'node') {
    entity = project.nodes.find((n) => n.id === selection.id);
  } else if (selection.type === 'flow') {
    entity = project.flows.find((f) => f.id === selection.id);
  } else {
    entity = project.ownership.find((o) => o.id === selection.id);
  }

  if (!entity) return null;

  const updateField = (field: string, value: unknown) => {
    setProject((prev) => {
      if (!prev) return prev;
      if (selection.type === 'node') {
        return {
          ...prev,
          nodes: prev.nodes.map((n) =>
            n.id === selection.id ? { ...n, [field]: value } : n,
          ),
        };
      }
      if (selection.type === 'flow') {
        return {
          ...prev,
          flows: prev.flows.map((f) =>
            f.id === selection.id ? { ...f, [field]: value } : f,
          ),
        };
      }
      return {
        ...prev,
        ownership: prev.ownership.map((o) =>
          o.id === selection.id ? { ...o, [field]: value } : o,
        ),
      };
    });
  };

  const handleDelete = () => {
    if (selection.type === 'node') deleteNode(selection.id);
    else if (selection.type === 'flow') deleteFlow(selection.id);
    else deleteOwnership(selection.id);
  };

  const label = ENTITY_LABELS[selection.type] ?? selection.type;

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        width: '320px',
        height: '100%',
        background: '#fff',
        borderLeft: '1px solid #e5e7eb',
        boxShadow: '-4px 0 12px rgba(0,0,0,0.06)',
        zIndex: 40,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '12px 16px',
          borderBottom: '1px solid #e5e7eb',
        }}
      >
        <span style={{ fontWeight: 700, fontSize: '15px' }}>
          Edit {label}
        </span>
        <button
          onClick={() => setSelection(null)}
          style={{
            background: 'none',
            border: 'none',
            fontSize: '18px',
            cursor: 'pointer',
            color: '#6b7280',
            lineHeight: 1,
          }}
        >
          {'\u00d7'}
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
        {selection.type === 'node' && (
          <NodeEditor node={entity as NodeDTO} onChange={updateField} />
        )}
        {selection.type === 'flow' && (
          <FlowEditor flow={entity as FlowDTO} onChange={updateField} />
        )}
        {selection.type === 'ownership' && (
          <OwnershipEditor edge={entity as OwnershipEdge} onChange={updateField} />
        )}
      </div>

      {/* Footer — delete action */}
      <div style={{ padding: '12px 16px', borderTop: '1px solid #e5e7eb' }}>
        <button
          onClick={handleDelete}
          data-testid="btn-delete-entity"
          style={{
            width: '100%',
            padding: '8px 0',
            background: '#fef2f2',
            color: '#dc2626',
            fontWeight: 600,
            fontSize: '13px',
            border: '1px solid #fecaca',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          Delete {label}
        </button>
      </div>
    </div>
  );
}
