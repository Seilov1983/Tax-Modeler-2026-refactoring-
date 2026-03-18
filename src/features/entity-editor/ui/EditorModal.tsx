'use client';

/**
 * EditorModal — floating dialog for editing Node/Flow/Ownership/Zone properties.
 * Replaces EditorSidebar with a centered modal (Universal Modals paradigm).
 *
 * Single-clicking a Flow, Node, Ownership, or Zone opens this modal.
 * Uses local draft state to avoid Jotai re-renders during editing.
 *
 * Liquid Glass design: frosted glass, spring mount animation.
 */

import { useAtom, useSetAtom, useAtomValue } from 'jotai';
import { useRef, useCallback, useState, useEffect } from 'react';
import { useSpring, animated, config } from '@react-spring/web';
import { selectionAtom, nodeEditingAtom } from '../model/atoms';
import { projectAtom } from '@features/canvas/model/project-atom';
import { nodesAtom } from '@entities/node';
import { deleteNodesAtom, deleteFlowAtom, deleteOwnershipAtom, deleteZoneAtom } from '@features/canvas/model/graph-actions-atom';
import { commitHistoryAtom } from '@features/project-management/model/history-atoms';
import { useTranslation, localizedName, t } from '@shared/lib/i18n';
import type { NodeDTO, FlowDTO, OwnershipEdge, FlowType, Zone } from '@shared/types';

const FLOW_TYPE_OPTIONS: FlowType[] = [
  'Dividends', 'Royalties', 'Interest', 'Services', 'Salary', 'Goods', 'Equipment',
];

const CURRENCY_OPTIONS = ['KZT', 'USD', 'EUR', 'AED', 'HKD', 'SGD', 'GBP', 'SCR', 'CNY'] as const;

// ─── Shared styles (Liquid Glass) ────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '11px', color: '#86868b',
  fontWeight: 500, letterSpacing: '0.02em', marginBottom: '6px',
};

const inputStyle: React.CSSProperties = {
  width: '100%', border: '1px solid rgba(0,0,0,0.08)', borderRadius: '12px',
  padding: '8px 12px', fontSize: '13px', outline: 'none',
  background: 'rgba(255,255,255,0.8)', transition: 'border-color 0.2s, box-shadow 0.2s',
};

const selectStyle: React.CSSProperties = { ...inputStyle, background: 'rgba(255,255,255,0.8)' };

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
  node, onChange, projectZones, lang: nodeLang,
}: {
  node: NodeDTO; onChange: (field: string, value: unknown) => void;
  projectZones: Zone[]; lang: import('@shared/lib/i18n').Language;
}) {
  const zone = projectZones.find((z) => z.id === node.zoneId);
  return (
    <>
      <Field label={t('name', nodeLang)}>
        <input style={inputStyle} type="text" value={node.name} onChange={(e) => onChange('name', e.target.value)} />
      </Field>
      {/* Spatial location — read-only badge (zone assignment is automatic via drag) */}
      <Field label={t('locatedIn', nodeLang)}>
        <div style={{
          padding: '8px 12px', borderRadius: '12px', fontSize: '13px',
          background: zone ? 'rgba(0,122,255,0.06)' : 'rgba(255,59,48,0.06)',
          color: zone ? '#007aff' : '#ff3b30', fontWeight: 500,
          border: `1px solid ${zone ? 'rgba(0,122,255,0.12)' : 'rgba(255,59,48,0.12)'}`,
        }}>
          {zone
            ? `${localizedName(zone.name, nodeLang)} (${zone.jurisdiction} \u00b7 ${zone.currency})`
            : t('noZone', nodeLang)}
        </div>
      </Field>
      <Field label={t('annualIncome', nodeLang)}>
        <NumericInput style={inputStyle} value={node.annualIncome} onChange={(v) => onChange('annualIncome', v)} />
      </Field>
      {node.type === 'company' && (
        <Field label={t('etrManual', nodeLang)}>
          <NumericInput style={inputStyle} value={node.etr} onChange={(v) => onChange('etr', v)} step="0.01" min={0} max={1} />
        </Field>
      )}
      {node.type === 'person' && node.citizenship && (
        <Field label={t('citizenship', nodeLang)}>
          <input style={inputStyle} type="text" value={node.citizenship.join(', ')} onChange={(e) => onChange('citizenship', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))} />
        </Field>
      )}
      <div style={{ marginTop: '16px', padding: '10px 12px', background: 'rgba(0,0,0,0.03)', borderRadius: '12px', fontSize: '11px', color: '#86868b' }}>
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
      <div style={{ marginTop: '16px', padding: '10px 12px', background: 'rgba(0,0,0,0.03)', borderRadius: '12px', fontSize: '11px', color: '#86868b' }}>
        ID: {flow.id}<br />From: {flow.fromId} → To: {flow.toId}<br />Status: {flow.status}
        {flow.compliance?.exceeded && <><br /><span style={{ color: '#ff3b30', fontWeight: 500 }}>Violation: {flow.compliance.violationType}</span></>}
      </div>
    </>
  );
}

function OwnershipEditor({ edge, onChange }: { edge: OwnershipEdge; onChange: (field: string, value: unknown) => void }) {
  return (
    <>
      <Field label="Ownership (%)"><NumericInput style={inputStyle} value={edge.percent} onChange={(v) => onChange('percent', v)} min={0} max={100} step="0.01" /></Field>
      <Field label="Manual Adjustment"><NumericInput style={inputStyle} value={edge.manualAdjustment} onChange={(v) => onChange('manualAdjustment', v)} step="0.01" /></Field>
      <div style={{ marginTop: '16px', padding: '10px 12px', background: 'rgba(0,0,0,0.03)', borderRadius: '12px', fontSize: '11px', color: '#86868b' }}>
        ID: {edge.id}<br />Parent: {edge.fromId}<br />Subsidiary: {edge.toId}
      </div>
    </>
  );
}

function ZoneEditor({ zone, onChange }: { zone: Zone; onChange: (field: string, value: unknown) => void }) {
  return (
    <>
      <Field label="Name"><input style={inputStyle} type="text" value={zone.name || ''} onChange={(e) => onChange('name', e.target.value)} /></Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
        <Field label="Width"><NumericInput style={inputStyle} value={zone.w || 0} onChange={(v) => onChange('w', v || 200)} /></Field>
        <Field label="Height"><NumericInput style={inputStyle} value={zone.h || 0} onChange={(v) => onChange('h', v || 400)} /></Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
        <Field label="X"><NumericInput style={inputStyle} value={zone.x || 0} onChange={(v) => onChange('x', v)} /></Field>
        <Field label="Y"><NumericInput style={inputStyle} value={zone.y || 0} onChange={(v) => onChange('y', v)} /></Field>
      </div>
      <div style={{ marginTop: '16px', padding: '10px 12px', background: 'rgba(0,0,0,0.03)', borderRadius: '12px', fontSize: '11px', color: '#86868b' }}>
        ID: {zone.id}<br />Jurisdiction: {zone.jurisdiction}<br />Currency: {zone.currency}
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '14px' }}>
      <label style={labelStyle}>{label}</label>
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

  const handleCancel = () => {
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
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '20px 24px 16px',
        }}>
          <span style={{ fontWeight: 600, fontSize: '18px', letterSpacing: '-0.02em', color: '#1d1d1f' }}>{label}</span>
          <button onClick={handleCancel} style={{
            background: 'rgba(0,0,0,0.05)', border: 'none', fontSize: '14px', cursor: 'pointer',
            color: '#86868b', width: '28px', height: '28px', borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.15s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(0,0,0,0.1)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(0,0,0,0.05)')}
          >
            {'\u00d7'}
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 24px 16px' }}>
          {isMultiNode ? (
            <div style={{ padding: '14px 16px', background: 'rgba(0,122,255,0.06)', borderRadius: '16px', fontSize: '13px', color: '#007aff' }}>
              <strong>{selection.ids.length} nodes</strong> selected.
              <br /><br />
              Drag any selected node to move all. Press <kbd style={{ padding: '2px 6px', background: 'rgba(0,122,255,0.1)', borderRadius: '6px', fontSize: '11px', fontFamily: 'inherit' }}>Delete</kbd> to remove all.
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
        <div style={{ padding: '16px 24px', borderTop: '1px solid rgba(0,0,0,0.05)', display: 'flex', gap: '8px' }}>
          <button onClick={handleDelete} data-testid="btn-delete-entity" style={{
            flex: '0 0 auto', padding: '10px 16px', background: 'rgba(255,59,48,0.08)', color: '#ff3b30',
            fontWeight: 600, fontSize: '13px', border: 'none', borderRadius: '12px', cursor: 'pointer',
            transition: 'background 0.15s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,59,48,0.15)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255,59,48,0.08)')}
          >{tr('delete')}</button>
          <div style={{ flex: 1 }} />
          <button onClick={handleCancel} style={{
            padding: '10px 16px', background: 'rgba(0,0,0,0.05)', color: '#1d1d1f', fontWeight: 500,
            fontSize: '13px', border: 'none', borderRadius: '12px', cursor: 'pointer',
            transition: 'background 0.15s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(0,0,0,0.1)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(0,0,0,0.05)')}
          >{tr('cancel')}</button>
          <button onClick={handleSave} data-testid="btn-save-entity" style={{
            padding: '10px 16px', background: '#007aff', color: '#fff', fontWeight: 600,
            fontSize: '13px', border: 'none', borderRadius: '12px', cursor: 'pointer',
            transition: 'background 0.15s, transform 0.1s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = '#0071e3')}
          onMouseLeave={(e) => (e.currentTarget.style.background = '#007aff')}
          >{tr('save')}</button>
        </div>
      </animated.div>
    </animated.div>
  );
}
