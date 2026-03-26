'use client';

/**
 * ProjectHeader — minimalist top bar with project info, file actions,
 * and inline Theme / Language quick toggles.
 * Liquid Glass design: frosted glass bar, refined typography, subtle borders.
 */

import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useRef, useState, useCallback } from 'react';
import { useTheme } from 'next-themes';
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
import { exportProjectJson, duplicateProject, importProjectJson, exportCanvasToPng } from '../model/export-actions';
import { generateAuditSnapshot, exportStructureBook, downloadMarkdown } from '@shared/lib/engine';
import { Sun, Moon, Globe, ShieldCheck, LayoutDashboard, FileText } from 'lucide-react';
import { activeTabAtom } from '@features/canvas/model/project-atom';
import { syncStatusAtom } from '@shared/hooks/sync-status-atom';
import { ProjectDashboard } from './ProjectDashboard';

// ─── SyncBadge — autosave indicator next to title ────────────────────────────

function SyncBadge() {
  const { isSyncing, lastSavedAt } = useAtomValue(syncStatusAtom);

  if (isSyncing) {
    return (
      <span
        title="Saving..."
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          fontSize: '11px',
          color: '#86868b',
          fontWeight: 500,
        }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ animation: 'spin 1s linear infinite' }}
        >
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
        Saving...
      </span>
    );
  }

  if (lastSavedAt) {
    return (
      <span
        title={`Saved at ${lastSavedAt.toLocaleTimeString()}`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          fontSize: '11px',
          color: '#34c759',
          fontWeight: 500,
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10" />
          <path d="M7.5 12l3 3 6-6" />
        </svg>
        Saved
      </span>
    );
  }

  return null;
}

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
  const [activeTab, setActiveTab] = useAtom(activeTabAtom);
  const setPastStates = useSetAtom(pastStatesAtom);
  const setFutureStates = useSetAtom(futureStatesAtom);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [settings, setSettings] = useAtom(settingsAtom);
  const { resolvedTheme, setTheme } = useTheme();
  const titleInputRef = useRef<HTMLInputElement>(null);

  const handleCurrencyChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      setProject((prev) =>
        prev ? { ...prev, baseCurrency: e.target.value as typeof baseCurrency } : prev,
      );
    },
    [setProject],
  );

  const handleSaveAs = useCallback(() => {
    if (!project) return;
    const clone = duplicateProject(project);
    ensureMasterData(clone);
    ensureCountriesAndRegimes(clone);
    ensureZoneTaxDefaults(clone);
    bootstrapNormalizeZones(clone);
    recomputeFrozen(clone);
    recomputeRisks(clone);
    hydrate(clone);
    setSelection(null);
    setPastStates([]);
    setFutureStates([]);
  }, [project, hydrate, setSelection, setPastStates, setFutureStates]);

  const handleExportJson = useCallback(async () => {
    if (!project) return;
    await exportProjectJson(project);
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
    const newTheme = resolvedTheme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    setSettings((prev) => ({ ...prev, theme: newTheme }));
  }, [resolvedTheme, setTheme, setSettings]);

  const handleTitleBlur = useCallback(() => {
    const input = titleInputRef.current;
    if (!input) return;
    const name = input.value.trim() || 'New Project';
    input.value = name;
    setProject((prev) => prev ? { ...prev, title: name } : prev);
  }, [setProject]);

  const handleTitleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur();
    }
    if (e.key === 'Escape') {
      e.currentTarget.value = project?.title ?? 'New Project';
      e.currentTarget.blur();
    }
  }, [project?.title]);

  const toggleLanguage = useCallback(() => {
    setSettings((prev) => ({
      ...prev,
      language: prev.language === 'en' ? 'ru' : 'en',
    }));
  }, [setSettings]);

  if (!project) return null;

  const isDark = resolvedTheme === 'dark';
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
        <input
          ref={titleInputRef}
          defaultValue={project.title}
          key={project.projectId}
          onBlur={handleTitleBlur}
          onKeyDown={handleTitleKeyDown}
          onFocus={(e) => e.currentTarget.select()}
          title="Click to rename project"
          spellCheck={false}
          style={{
            fontSize: '14px',
            fontWeight: 500,
            color: '#1d1d1f',
            background: 'transparent',
            border: '1px solid transparent',
            borderRadius: '6px',
            padding: '2px 8px',
            outline: 'none',
            width: '200px',
            cursor: 'text',
            transition: 'border-color 0.15s, background 0.15s',
          }}
          onMouseEnter={(e) => {
            if (document.activeElement !== e.currentTarget) {
              e.currentTarget.style.background = 'rgba(0,0,0,0.03)';
              e.currentTarget.style.borderColor = 'rgba(0,0,0,0.08)';
            }
          }}
          onMouseLeave={(e) => {
            if (document.activeElement !== e.currentTarget) {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.borderColor = 'transparent';
            }
          }}
        />
        <SyncBadge />

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

        {/* Tab toggle: Canvas ↔ Reports */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '2px', marginLeft: '12px', paddingLeft: '12px', borderLeft: '1px solid rgba(0,0,0,0.06)', background: 'rgba(0,0,0,0.03)', borderRadius: '8px', padding: '2px' }}>
          <button
            onClick={() => setActiveTab('canvas')}
            style={{
              padding: '4px 12px',
              fontSize: '12px',
              fontWeight: activeTab === 'canvas' ? 600 : 400,
              background: activeTab === 'canvas' ? '#fff' : 'transparent',
              color: activeTab === 'canvas' ? '#1d1d1f' : '#86868b',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              boxShadow: activeTab === 'canvas' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              transition: 'all 0.15s',
            }}
          >
            Canvas
          </button>
          <button
            onClick={() => setActiveTab('reports')}
            style={{
              padding: '4px 12px',
              fontSize: '12px',
              fontWeight: activeTab === 'reports' ? 600 : 400,
              background: activeTab === 'reports' ? '#fff' : 'transparent',
              color: activeTab === 'reports' ? '#1d1d1f' : '#86868b',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              boxShadow: activeTab === 'reports' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              transition: 'all 0.15s',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <FileText size={12} />
            Reports
          </button>
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
        <button onClick={() => fileInputRef.current?.click()} style={btnSecondary} title="Load project from JSON file">
          Load
        </button>
        <button onClick={handleSaveAs} style={btnSecondary} title="Duplicate as a new project">
          Save As
        </button>

        <div style={{ width: '1px', height: '20px', background: 'rgba(0,0,0,0.06)', margin: '0 4px' }} />

        <button onClick={handleExportJson} style={btnPrimary} title="Export project as JSON file">
          Export JSON
        </button>
        <button onClick={handleExportPng} style={btnPrimary} title="Export canvas as PNG image">
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
