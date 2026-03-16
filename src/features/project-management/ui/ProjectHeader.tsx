'use client';

/**
 * ProjectHeader — top bar with project title, Save/Load JSON, and Export PNG.
 *
 * On Load: runs the same engine pipeline as ClientApp hydration
 * (ensureMasterData → recomputeRisks) then commits via hydrateProjectAtom
 * to keep all entity atoms in sync.
 */

import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useRef, useCallback, useState } from 'react';
import { MasterDataModal } from './MasterDataModal';
import { projectAtom, hydrateProjectAtom } from '@features/canvas';
import { baseCurrencyAtom } from '@features/canvas/model/project-atom';
import {
  undoAtom, redoAtom, canUndoAtom, canRedoAtom,
  pastStatesAtom, futureStatesAtom,
} from '../model/history-atoms';
import { selectionAtom } from '@features/entity-editor/model/atoms';
import { defaultProject } from '@entities/project';
import {
  ensureMasterData, ensureZoneTaxDefaults,
  bootstrapNormalizeZones, recomputeRisks, recomputeFrozen,
  ensureCountriesAndRegimes,
} from '@shared/lib/engine';
import type { Project } from '@shared/types';
import { downloadProjectJson, importProjectJson, exportCanvasToPng } from '../model/export-actions';

const CURRENCY_OPTIONS = [
  { code: 'USD', label: 'USD ($)' },
  { code: 'EUR', label: 'EUR (\u20ac)' },
  { code: 'KZT', label: 'KZT (\u20b8)' },
  { code: 'AED', label: 'AED (\u062f.\u0625)' },
  { code: 'GBP', label: 'GBP (\u00a3)' },
  { code: 'HKD', label: 'HKD ($)' },
  { code: 'SGD', label: 'SGD ($)' },
] as const;

export function ProjectHeader() {
  const [project, setProject] = useAtom(projectAtom);
  const baseCurrency = useAtomValue(baseCurrencyAtom);
  const hydrate = useSetAtom(hydrateProjectAtom);
  const undo = useSetAtom(undoAtom);
  const redo = useSetAtom(redoAtom);
  const canUndo = useAtomValue(canUndoAtom);
  const canRedo = useAtomValue(canRedoAtom);
  const setSelection = useSetAtom(selectionAtom);
  const setPastStates = useSetAtom(pastStatesAtom);
  const setFutureStates = useSetAtom(futureStatesAtom);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showMasterData, setShowMasterData] = useState(false);

  const handleCurrencyChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      setProject((prev) =>
        prev ? { ...prev, baseCurrency: e.target.value as typeof baseCurrency } : prev,
      );
    },
    [setProject],
  );

  const handleSave = useCallback(() => {
    if (!project) return;
    const ts = new Date().toISOString().slice(0, 10);
    downloadProjectJson(project, `tax-model-${ts}.json`);
  }, [project]);

  const handleImport = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      try {
        const p = await importProjectJson(file) as Project;

        // Run the same engine pipeline as initial hydration
        ensureMasterData(p);
        ensureCountriesAndRegimes(p);
        ensureZoneTaxDefaults(p);
        bootstrapNormalizeZones(p);
        recomputeFrozen(p);
        recomputeRisks(p);

        // Batched commit to all entity atoms
        hydrate(p);
      } catch {
        alert('Failed to load project file.');
      }

      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    [hydrate],
  );

  const handleExportPng = useCallback(() => {
    exportCanvasToPng('canvas-render-area', `structure-${Date.now()}.png`);
  }, []);

  const handleNewProject = useCallback(() => {
    if (!confirm('Create a new blank project? All unsaved changes will be lost.')) return;
    const p = defaultProject() as Project;
    ensureMasterData(p);
    ensureCountriesAndRegimes(p);
    ensureZoneTaxDefaults(p);
    bootstrapNormalizeZones(p);
    recomputeFrozen(p);
    recomputeRisks(p);
    hydrate(p);
    setSelection(null);
    setPastStates([]);
    setFutureStates([]);
  }, [hydrate, setSelection, setPastStates, setFutureStates]);

  if (!project) return null;

  return (
    <div
      className="exclude-from-export"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '48px',
        background: '#fff',
        borderBottom: '1px solid #e5e7eb',
        boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 16px',
        zIndex: 50,
      }}
    >
      {/* Left: branding + title + base currency */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <span style={{ fontWeight: 700, fontSize: '15px', color: '#1f2937', letterSpacing: '-0.02em' }}>
          Tax-Modeler 2026
        </span>
        <span style={{ fontSize: '12px', color: '#9ca3af' }}>
          {project.title}
        </span>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: '12px', paddingLeft: '12px', borderLeft: '1px solid #d1d5db' }}>
          <label style={{ fontSize: '11px', color: '#6b7280', fontWeight: 700, textTransform: 'uppercase' as const }}>
            Base Currency:
          </label>
          <select
            value={baseCurrency}
            onChange={handleCurrencyChange}
            data-testid="select-base-currency"
            style={{
              fontSize: '13px',
              border: '1px solid #d1d5db',
              borderRadius: '4px',
              background: '#f9fafb',
              padding: '2px 6px',
              cursor: 'pointer',
              outline: 'none',
            }}
          >
            {CURRENCY_OPTIONS.map((c) => (
              <option key={c.code} value={c.code}>{c.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Right: undo/redo + actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <button
          onClick={() => undo()}
          disabled={!canUndo}
          data-testid="btn-undo"
          title="Undo (Ctrl+Z)"
          style={{ ...btnSecondary, opacity: canUndo ? 1 : 0.35, cursor: canUndo ? 'pointer' : 'default' }}
        >
          &#x21A9;
        </button>
        <button
          onClick={() => redo()}
          disabled={!canRedo}
          data-testid="btn-redo"
          title="Redo (Ctrl+Y)"
          style={{ ...btnSecondary, opacity: canRedo ? 1 : 0.35, cursor: canRedo ? 'pointer' : 'default' }}
        >
          &#x21AA;
        </button>

        <div style={{ width: '1px', height: '20px', background: '#d1d5db' }} />

        <button
          onClick={() => setShowMasterData(true)}
          data-testid="btn-master-data"
          style={{ ...btnSecondary, background: '#fef3c7', color: '#b45309', borderColor: '#fde68a' }}
        >
          Master Data
        </button>

        <div style={{ width: '1px', height: '20px', background: '#d1d5db' }} />

        <button
          onClick={handleNewProject}
          data-testid="btn-new-project"
          title="Create a new blank project"
          style={{ ...btnSecondary, background: '#fef2f2', color: '#dc2626', borderColor: '#fecaca' }}
        >
          New / Clear
        </button>

        <input
          type="file"
          accept=".json"
          ref={fileInputRef}
          style={{ display: 'none' }}
          onChange={handleImport}
        />
        <button onClick={() => fileInputRef.current?.click()} style={btnSecondary}>
          Load
        </button>
        <button onClick={handleSave} style={btnSecondary}>
          Save JSON
        </button>
        <button onClick={handleExportPng} style={btnPrimary}>
          Export PNG
        </button>
      </div>

      {showMasterData && <MasterDataModal onClose={() => setShowMasterData(false)} />}
    </div>
  );
}

const btnSecondary: React.CSSProperties = {
  padding: '5px 12px',
  fontSize: '13px',
  background: '#f3f4f6',
  color: '#374151',
  border: '1px solid #d1d5db',
  borderRadius: '4px',
  cursor: 'pointer',
};

const btnPrimary: React.CSSProperties = {
  padding: '5px 12px',
  fontSize: '13px',
  background: '#2563eb',
  color: '#fff',
  border: 'none',
  borderRadius: '4px',
  cursor: 'pointer',
};
