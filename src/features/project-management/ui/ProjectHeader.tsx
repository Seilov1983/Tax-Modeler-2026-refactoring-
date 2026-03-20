'use client';

/**
 * ProjectHeader — minimalist top bar with project info, file actions,
 * and inline Theme / Language quick toggles.
 * Liquid Glass design: frosted glass bar, refined typography, subtle borders.
 */

import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useRef, useState, useCallback } from 'react';
import { settingsAtom } from '@features/settings/model/settings-atom';
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
import { generateAuditSnapshot, exportStructureBook, downloadMarkdown } from '@shared/lib/engine';
import { Sun, Moon, Globe, ShieldCheck, LayoutDashboard } from 'lucide-react';
import { ProjectDashboard } from './ProjectDashboard';

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
  const [settings, setSettings] = useAtom(settingsAtom);

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

        ensureMasterData(p);
        ensureCountriesAndRegimes(p);
        ensureZoneTaxDefaults(p);
        bootstrapNormalizeZones(p);
        recomputeFrozen(p);
        recomputeRisks(p);

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

  const [dashboardOpen, setDashboardOpen] = useState(false);
  const [auditLoading, setAuditLoading] = useState(false);

  const handleAuditExport = useCallback(async () => {
    if (!project || auditLoading) return;
    setAuditLoading(true);
    try {
      const snapshot = await generateAuditSnapshot(project);
      const markdown = exportStructureBook(project, snapshot);
      const ts = new Date().toISOString().slice(0, 10);
      downloadMarkdown(markdown, `structure-book-${ts}.md`);
    } catch (err) {
      console.error('[Audit Export]', err);
      alert('Failed to generate audit report.');
    } finally {
      setAuditLoading(false);
    }
  }, [project, auditLoading]);

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

  const toggleTheme = useCallback(() => {
    setSettings((prev) => ({
      ...prev,
      theme: prev.theme === 'dark' ? 'light' : 'dark',
    }));
  }, [setSettings]);

  const toggleLanguage = useCallback(() => {
    setSettings((prev) => ({
      ...prev,
      language: prev.language === 'en' ? 'ru' : 'en',
    }));
  }, [setSettings]);

  if (!project) return null;

  const isDark = settings.theme === 'dark';
  const lang = settings.language || 'en';

  return (
    <div
      className="exclude-from-export"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '52px',
        background: 'rgba(255, 255, 255, 0.72)',
        backdropFilter: 'blur(40px) saturate(180%)',
        WebkitBackdropFilter: 'blur(40px) saturate(180%)',
        borderBottom: '1px solid rgba(0, 0, 0, 0.06)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 20px',
        zIndex: 100,
      }}
    >
      {/* Left: branding + title + base currency */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <span style={{ fontWeight: 700, fontSize: '15px', color: '#1d1d1f', letterSpacing: '-0.02em' }}>
          Tax-Modeler 2026
        </span>
        <span style={{ fontSize: '12px', color: '#86868b' }}>
          {project.title}
        </span>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: '12px', paddingLeft: '12px', borderLeft: '1px solid rgba(0,0,0,0.06)' }}>
          <label style={{ fontSize: '11px', color: '#86868b', fontWeight: 500, letterSpacing: '0.02em' }}>
            Currency:
          </label>
          <select
            value={baseCurrency}
            onChange={handleCurrencyChange}
            data-testid="select-base-currency"
            style={{
              fontSize: '13px',
              border: '1px solid rgba(0,0,0,0.08)',
              borderRadius: '8px',
              background: 'rgba(255,255,255,0.6)',
              padding: '3px 8px',
              cursor: 'pointer',
              outline: 'none',
              fontWeight: 500,
            }}
          >
            {CURRENCY_OPTIONS.map((c) => (
              <option key={c.code} value={c.code}>{c.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Right: undo/redo + file actions + theme/lang toggles */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
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

        <div style={{ width: '1px', height: '20px', background: 'rgba(0,0,0,0.06)', margin: '0 4px' }} />

        <button
          onClick={() => setDashboardOpen(true)}
          data-testid="btn-projects-dashboard"
          title="Open Project Dashboard"
          style={{ ...btnSecondary, display: 'flex', alignItems: 'center', gap: '5px' }}
        >
          <LayoutDashboard size={14} />
          Projects
        </button>

        <button
          onClick={handleNewProject}
          data-testid="btn-new-project"
          title="Create a new blank project"
          style={{ ...btnSecondary, background: 'rgba(255,59,48,0.06)', color: '#ff3b30', borderColor: 'transparent' }}
        >
          New
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
          Save
        </button>

        <button onClick={handleExportPng} style={btnPrimary}>
          Export PNG
        </button>

        <button
          onClick={handleAuditExport}
          disabled={auditLoading}
          title="Generate SHA-256 audit snapshot and download Corporate Structure Book"
          style={{
            ...btnPrimary,
            background: auditLoading ? '#86868b' : '#34c759',
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            opacity: auditLoading ? 0.7 : 1,
          }}
        >
          <ShieldCheck size={14} />
          {auditLoading ? 'Hashing...' : 'Audit Export'}
        </button>

        <div style={{ width: '1px', height: '20px', background: 'rgba(0,0,0,0.06)', margin: '0 4px' }} />

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          style={{
            ...btnIcon,
            color: isDark ? '#f5a623' : '#86868b',
          }}
          aria-label="Toggle theme"
        >
          {isDark ? <Moon size={16} /> : <Sun size={16} />}
        </button>

        {/* Language toggle */}
        <button
          onClick={toggleLanguage}
          title={lang === 'en' ? 'Переключить на русский' : 'Switch to English'}
          style={{
            ...btnIcon,
            fontSize: '12px',
            fontWeight: 600,
            color: '#86868b',
          }}
          aria-label="Toggle language"
        >
          {lang === 'en' ? 'RU' : 'EN'}
        </button>
      </div>

      <ProjectDashboard
        open={dashboardOpen}
        onOpenChange={setDashboardOpen}
      />
    </div>
  );
}

const btnSecondary: React.CSSProperties = {
  padding: '6px 14px',
  fontSize: '13px',
  fontWeight: 500,
  background: 'rgba(0, 0, 0, 0.04)',
  color: '#1d1d1f',
  border: 'none',
  borderRadius: '10px',
  cursor: 'pointer',
  transition: 'background 0.15s, transform 0.1s',
};

const btnPrimary: React.CSSProperties = {
  padding: '6px 14px',
  fontSize: '13px',
  fontWeight: 600,
  background: '#007aff',
  color: '#fff',
  border: 'none',
  borderRadius: '10px',
  cursor: 'pointer',
  transition: 'background 0.15s, transform 0.1s',
};

const btnIcon: React.CSSProperties = {
  width: '34px',
  height: '34px',
  padding: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(0, 0, 0, 0.04)',
  border: 'none',
  borderRadius: '10px',
  cursor: 'pointer',
  transition: 'background 0.15s',
};
