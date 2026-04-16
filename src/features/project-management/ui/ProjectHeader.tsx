'use client';

/**
 * ProjectHeader — minimalist top bar with project info, file actions,
 * and inline Theme / Language quick toggles.
 * Liquid Glass design: frosted glass bar, refined typography, subtle borders.
 */

import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useRef, useState, useCallback, useMemo } from 'react';
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
import { exportReportPdf } from '../model/export-pdf';
import { generateAuditSnapshot, exportStructureBook, downloadMarkdown } from '@shared/lib/engine';
import { Sun, Moon, Globe, ShieldCheck, LayoutDashboard, FileText, Download, FileJson, FileImage, Undo2, Redo2, Plus, FileUp, Files, Settings, Sparkles } from 'lucide-react';
import { activeTabAtom } from '@features/canvas/model/project-atom';
import { copilotOpenAtom } from '@features/ai-copilot/model/atoms';
import { syncStatusAtom } from '@shared/hooks/sync-status-atom';
import { showNotificationAtom } from '@features/canvas/model/notification-atom';
import { ProjectDashboard } from './ProjectDashboard';
import { SettingsModal } from '../../settings/ui/SettingsModal';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@shared/lib/i18n';

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
          color: 'var(--text-label)',
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
          color: 'var(--color-success-light)',
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
  const { t } = useTranslation();
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
  const showNotification = useSetAtom(showNotificationAtom);

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
        showNotification({ type: 'error', message: 'Не удалось загрузить файл проекта.' });
      }

      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    [hydrate],
  );

  const handleExportPng = useCallback(async () => {
    if (!project) return;
    const sanitizedName = project.title.replace(/[<>:"/\\|?*]/g, '').trim() || 'structure';
    try {
      await exportCanvasToPng('canvas-render-area', `${sanitizedName}-${Date.now()}.png`);
    } catch (err) {
      console.error('[PNG Export]', err);
      showNotification({ type: 'error', message: 'Ошибка экспорта PNG: ' + ((err as Error).message || 'Граф слишком велик или недоступен') });
    }
  }, [project, showNotification]);

  const [dashboardOpen, setDashboardOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [copilotOpen, setCopilotOpen] = useAtom(copilotOpenAtom);
  const [auditLoading, setAuditLoading] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);

  const handleExportPdf = useCallback(async () => {
    if (!project || pdfLoading) return;
    setPdfLoading(true);
    try {
      await exportReportPdf(project);
    } catch (err) {
      console.error('[PDF Export]', err);
      showNotification({ type: 'error', message: 'Ошибка экспорта PDF: ' + ((err as Error).message || 'Граф слишком велик или недоступен') });
    } finally {
      setPdfLoading(false);
    }
  }, [project, pdfLoading, showNotification]);

  const handleAuditExport = useCallback(async () => {
    if (!project || auditLoading) return;
    setAuditLoading(true);
    try {
      const snapshot = await generateAuditSnapshot(project);
      const markdown = exportStructureBook(project, snapshot);
      const ts = new Date().toISOString().slice(0, 10);
      const sanitizedName = project.title.replace(/[<>:"/\\|?*]/g, '').trim() || 'structure-book';
      await downloadMarkdown(markdown, `${sanitizedName}-${ts}.md`);
    } catch (err) {
      console.error('[Audit Export]', err);
      showNotification({ type: 'error', message: 'Ошибка экспорта аудита: ' + ((err as Error).message || 'Граф слишком велик или недоступен') });
    } finally {
      setAuditLoading(false);
    }
  }, [project, auditLoading, showNotification]);

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
    // Clear stale remote project ID so cloud sync creates a new record
    try { localStorage.removeItem('tsm26_remote_project_id'); } catch {}
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
      className="exclude-from-export flex-none w-full h-[54px] bg-white/70 dark:bg-slate-950/70 backdrop-blur-2xl border-b border-black/5 dark:border-white/5 flex items-center justify-between px-5 z-[100] text-slate-800 dark:text-slate-200"
    >
      {/* Left: branding + title + base currency */}
      <div className="flex items-center gap-3">
        <span className="font-bold text-[15px] tracking-tight">
          Tax-Modeler 2026
        </span>
        <input
          ref={titleInputRef}
          defaultValue={project.title}
          key={project.projectId}
          onBlur={handleTitleBlur}
          onKeyDown={handleTitleKeyDown}
          onFocus={(e) => e.currentTarget.select()}
          title={t('clickToRename')}
          spellCheck={false}
          className="text-[14px] font-semibold bg-transparent border border-transparent rounded-lg px-2 h-8 w-[200px] outline-none hover:bg-black/5 dark:hover:bg-white/5 focus:bg-white dark:focus:bg-slate-900 focus:border-indigo-500/50 focus:ring-4 focus:ring-indigo-500/10 transition-all"
        />
        <SyncBadge />

        <div className="flex items-center gap-2 ml-3 pl-3 border-l border-black/10 dark:border-white/10">
          <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
            {t('currencyLabel')}
          </label>
          <select
            value={baseCurrency}
            onChange={handleCurrencyChange}
            data-testid="select-base-currency"
            className="text-[13px] font-semibold border-none bg-black/5 dark:bg-white/10 rounded-lg px-2 py-1 outline-none cursor-pointer hover:bg-black/10 dark:hover:bg-white/20 transition-all"
          >
            {CURRENCY_OPTIONS.map((c) => (
              <option key={c.code} value={c.code}>{c.label}</option>
            ))}
          </select>
        </div>

        {/* Tab toggle: Canvas ↔ Reports */}
        <div className="flex items-center gap-1 ml-3 pl-3 border-l border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 rounded-[10px] p-1">
          <button
            onClick={() => setActiveTab('canvas')}
            className={`px-3 py-1.5 text-[12px] font-semibold rounded-lg transition-all ${
              activeTab === 'canvas' ? 'bg-white dark:bg-slate-800 text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            Canvas
          </button>
          <button
            onClick={() => setActiveTab('reports')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold rounded-lg transition-all ${
              activeTab === 'reports' ? 'bg-white dark:bg-slate-800 text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            <FileText size={12} />
            Reports
          </button>
        </div>
      </div>

      {/* Right: actions & toggles */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => undo()} disabled={!canUndo} title={t('undo')} aria-label={t('undo')}>
          <Undo2 size={16} />
        </Button>
        <Button variant="ghost" size="icon" onClick={() => redo()} disabled={!canRedo} title={t('redo')} aria-label={t('redo')}>
          <Redo2 size={16} />
        </Button>

        <div className="w-[1px] h-5 bg-black/10 dark:bg-white/10 mx-1" />

        <Button variant="secondary" size="sm" onClick={() => setDashboardOpen(true)} className="gap-2 text-[12px]">
          <LayoutDashboard size={14} /> Projects
        </Button>

        <Button variant="secondary" size="sm" onClick={handleNewProject} className="gap-2 text-[12px] bg-indigo-50 text-indigo-600 hover:bg-indigo-100 dark:bg-indigo-950/40 dark:text-indigo-400">
          <Plus size={14} /> New
        </Button>

        <input type="file" accept=".json" ref={fileInputRef} style={{ display: 'none' }} onChange={handleImport} />
        
        <Button variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()} className="text-[12px] gap-2">
          <FileUp size={14} /> Load
        </Button>
        
        <Button variant="secondary" size="sm" onClick={handleSaveAs} className="text-[12px] gap-2" aria-label={t('saveAs')}>
          <Files size={14} /> {t('saveAs')}
        </Button>

        <div className="w-[1px] h-5 bg-black/10 dark:bg-white/10 mx-1" />

        <Button variant="ghost" size="sm" onClick={handleExportJson} className="text-[12px] gap-2 text-slate-700 dark:text-slate-300" aria-label={t('exportToJson')}>
          <FileJson size={14} /> JSON
        </Button>
        <Button variant="ghost" size="sm" onClick={handleExportPdf} disabled={pdfLoading} className="text-[12px] gap-2 text-slate-700 dark:text-slate-300" aria-label={t('exportToPdf')}>
          <FileText size={14} /> {pdfLoading ? '...' : 'PDF'}
        </Button>
        <Button variant="ghost" size="sm" onClick={handleExportPng} className="text-[12px] gap-2 text-slate-700 dark:text-slate-300" aria-label={t('exportToPng')}>
          <FileImage size={14} /> PNG
        </Button>

        <Button variant="outline" size="sm" onClick={handleAuditExport} disabled={auditLoading} className="text-[12px] gap-2 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 hover:bg-emerald-100 dark:hover:bg-emerald-900/50">
          <ShieldCheck size={14} />
          {auditLoading ? 'Wait...' : 'Audit'}
        </Button>

        <div className="w-[1px] h-5 bg-black/10 dark:bg-white/10 mx-1" />

        {/* Theme toggle */}
        <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label={t('toggleTheme')} title={t('toggleTheme')} className="text-slate-700 dark:text-slate-200 rounded-full hover:bg-black/10 dark:hover:bg-white/15">
          {isDark ? <Moon size={16} /> : <Sun size={16} />}
        </Button>

        {/* Language toggle */}
        <Button variant="ghost" size="icon" onClick={toggleLanguage} aria-label={t('toggleLanguage')} title={t('toggleLanguage')} className="text-[11px] font-bold text-slate-700 dark:text-slate-200 rounded-full hover:bg-black/10 dark:hover:bg-white/15">
          {lang === 'en' ? 'RU' : 'EN'}
        </Button>

        {/* Settings toggle */}
        <Button variant="ghost" size="icon" onClick={() => setSettingsOpen(true)} aria-label={t('settings')} title={t('settings')} className="text-slate-700 dark:text-slate-200 rounded-full hover:bg-black/10 dark:hover:bg-white/15">
          <Settings size={16} />
        </Button>

        {/* AI Copilot toggle */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setCopilotOpen((o) => !o)}
          aria-label={t('aiCopilot')}
          title={t('aiCopilot')}
          aria-pressed={copilotOpen}
          className={`rounded-full hover:bg-black/10 dark:hover:bg-white/15 ${copilotOpen ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-700 dark:text-slate-200'}`}
        >
          <Sparkles size={16} />
        </Button>
      </div>

      <ProjectDashboard
        open={dashboardOpen}
        onOpenChange={setDashboardOpen}
      />

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}

