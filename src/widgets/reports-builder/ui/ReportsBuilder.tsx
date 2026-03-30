'use client';

/**
 * ReportsBuilder Widget — Composes FilterPanel + LedgerTable + ExportButton.
 *
 * Reads project state from Jotai atoms. All filter state is local (useState).
 * All derived/filtered data is via useMemo — zero useEffect hooks.
 *
 * FSD: widgets/reports-builder depends on entities/report + features/export-report.
 */

import { useState, useMemo, useCallback } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { projectAtom } from '@features/canvas/model/project-atom';
import { showNotificationAtom } from '@features/canvas/model/notification-atom';
import { FilterPanel } from '@entities/report/ui/FilterPanel';
import { LedgerTable } from '@entities/report/ui/LedgerTable';
import { EntityTaxTable } from '@entities/report/ui/EntityTaxTable';
import { ExportReportButton } from '@features/export-report/ui/ExportReportButton';
import { exportReportPdf } from '@features/project-management/model/export-pdf';
import type { LedgerRow } from '@entities/report/ui/LedgerTable';

// ─── Tailwind Classes ────────────────────────────────────────────────────────
const twRoot = "fixed top-[54px] left-0 right-0 bottom-0 flex flex-col bg-slate-50 dark:bg-slate-900 font-sans overflow-hidden";
const twHeaderBar = "flex items-center justify-between px-5 py-3 border-b border-black/10 dark:border-white/10 shrink-0 bg-white/50 dark:bg-slate-950/50 backdrop-blur-md";
const twTitle = "text-base font-bold text-slate-900 dark:text-slate-100";
const twStatRow = "flex flex-wrap gap-8 px-5 py-3 border-b border-black/5 dark:border-white/5 shrink-0 bg-white/30 dark:bg-slate-950/30 backdrop-blur-sm";
const twStat = "flex flex-col gap-1";
const twStatLabel = "text-[10px] font-bold text-slate-500 uppercase tracking-widest";
const twStatValue = "text-[14px] font-bold text-slate-800 dark:text-slate-200 tabular-nums";

// ─── Component ───────────────────────────────────────────────────────────────

export function ReportsBuilder() {
  const project = useAtomValue(projectAtom);
  const showNotification = useSetAtom(showNotificationAtom);
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

  // ── Local filter state (no useEffect) ──────────────────────────────────
  const [selectedTags, setSelectedTags] = useState<ReadonlyArray<string>>([]);
  const [selectedZoneIds, setSelectedZoneIds] = useState<ReadonlyArray<string>>([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [visibleOptionalColumns, setVisibleOptionalColumns] = useState<ReadonlyArray<string>>([]);

  // ── Derived: available filter options ──────────────────────────────────
  const availableTags = useMemo(() => {
    if (!project) return [];
    const tagSet = new Set<string>();
    for (const node of project.nodes) {
      for (const tag of node.managementTags ?? []) tagSet.add(tag);
    }
    return Array.from(tagSet).sort();
  }, [project]);

  const availableZones = useMemo(() => {
    if (!project) return [];
    return project.zones.map((z) => ({
      id: z.id,
      name: z.name,
      jurisdiction: z.jurisdiction,
    }));
  }, [project]);

  // ── Node lookup maps (stable, recalculated only when project changes) ─
  const nodeNameMap = useMemo(() => {
    if (!project) return new Map<string, string>();
    const m = new Map<string, string>();
    for (const n of project.nodes) m.set(n.id, n.name);
    return m;
  }, [project]);

  const nodeZoneMap = useMemo(() => {
    if (!project) return new Map<string, string>();
    const m = new Map<string, string>();
    for (const n of project.nodes) {
      if (n.zoneId) m.set(n.id, n.zoneId);
    }
    return m;
  }, [project]);

  const nodeTagMap = useMemo(() => {
    if (!project) return new Map<string, ReadonlyArray<string>>();
    const m = new Map<string, ReadonlyArray<string>>();
    for (const n of project.nodes) {
      m.set(n.id, n.managementTags ?? []);
    }
    return m;
  }, [project]);

  const zoneNameMap = useMemo(() => {
    if (!project) return new Map<string, string>();
    const m = new Map<string, string>();
    for (const z of project.zones) m.set(z.id, `${z.name} (${z.jurisdiction})`);
    return m;
  }, [project]);

  // ── Filtered & mapped rows ─────────────────────────────────────────────
  const filteredRows: ReadonlyArray<LedgerRow> = useMemo(() => {
    if (!project) return [];

    // Build a set of node IDs that match the tag filter
    const taggedNodeIds =
      selectedTags.length > 0
        ? new Set(
            project.nodes
              .filter((n) =>
                (n.managementTags ?? []).some((t) => selectedTags.includes(t)),
              )
              .map((n) => n.id),
          )
        : null;

    // Build a set of node IDs that match the zone filter
    const zonedNodeIds =
      selectedZoneIds.length > 0
        ? new Set(
            project.nodes
              .filter((n) => n.zoneId && selectedZoneIds.includes(n.zoneId))
              .map((n) => n.id),
          )
        : null;

    return project.flows
      .filter((f) => {
        // Tag filter: at least one endpoint must be tagged
        if (taggedNodeIds && !taggedNodeIds.has(f.fromId) && !taggedNodeIds.has(f.toId)) {
          return false;
        }
        // Zone filter: at least one endpoint must be in selected zone
        if (zonedNodeIds && !zonedNodeIds.has(f.fromId) && !zonedNodeIds.has(f.toId)) {
          return false;
        }
        // Date range filter
        const flowDate = (f.flowDate ?? '').slice(0, 10);
        if (dateFrom && flowDate < dateFrom) return false;
        if (dateTo && flowDate > dateTo) return false;
        return true;
      })
      .map((f): LedgerRow => {
        const gross = Number(f.grossAmount || 0);
        const whtRate = Number(f.whtRate || 0);
        const wht = Math.round(gross * (whtRate / 100) * 100) / 100;
        const net = Math.round((gross - wht) * 100) / 100;

        const complianceStatus: 'OK' | 'Violation acknowledged' =
          f.compliance?.exceeded ? 'Violation acknowledged' : 'OK';

        // Collect tags from both endpoints
        const fromTags = nodeTagMap.get(f.fromId) ?? [];
        const toTags = nodeTagMap.get(f.toId) ?? [];
        const allTags = Array.from(new Set([...fromTags, ...toTags]));

        // Zone name from payer
        const payerZoneId = nodeZoneMap.get(f.fromId) ?? '';
        const zoneName = zoneNameMap.get(payerZoneId) ?? '-';

        return {
          flowId: f.id,
          date: f.flowDate ?? '',
          flowType: f.flowType,
          fromName: nodeNameMap.get(f.fromId) ?? f.fromId,
          toName: nodeNameMap.get(f.toId) ?? f.toId,
          gross,
          net,
          wht,
          complianceStatus,
          currency: f.currency,
          dttApplied: f.applyDTT === true,
          zoneName,
          tags: allTags,
        };
      });
  }, [
    project,
    selectedTags,
    selectedZoneIds,
    dateFrom,
    dateTo,
    nodeNameMap,
    nodeZoneMap,
    nodeTagMap,
    zoneNameMap,
  ]);

  // ── Summary stats ──────────────────────────────────────────────────────
  const stats = useMemo(() => {
    let totalGross = 0;
    let totalWht = 0;
    let violations = 0;
    for (const r of filteredRows) {
      totalGross += r.gross;
      totalWht += r.wht;
      if (r.complianceStatus !== 'OK') violations++;
    }
    return {
      flowCount: filteredRows.length,
      totalGross: Math.round(totalGross * 100) / 100,
      totalWht: Math.round(totalWht * 100) / 100,
      violations,
    };
  }, [filteredRows]);

  const handleTagsChange = useCallback(
    (tags: ReadonlyArray<string>) => setSelectedTags(tags),
    [],
  );
  const handleZoneIdsChange = useCallback(
    (ids: ReadonlyArray<string>) => setSelectedZoneIds(ids),
    [],
  );
  const handleDateFromChange = useCallback((v: string) => setDateFrom(v), []);
  const handleDateToChange = useCallback((v: string) => setDateTo(v), []);
  const handleOptionalColumnsChange = useCallback(
    (cols: ReadonlyArray<string>) => setVisibleOptionalColumns(cols),
    [],
  );

  if (!project) {
    return (
      <div className={`${twRoot} items-center justify-center`}>
        <span className="text-slate-500 text-sm">No project loaded.</span>
      </div>
    );
  }

  return (
    <div className={twRoot}>
      {/* Header bar with title + export button */}
      <div className={twHeaderBar}>
        <span className={twTitle}>Reports</span>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExportPdf}
            disabled={pdfLoading}
            style={{
              padding: '8px 16px',
              fontSize: '13px',
              fontWeight: 600,
              background: '#3b82f6',
              color: '#fff',
              border: 'none',
              borderRadius: '10px',
              cursor: pdfLoading ? 'not-allowed' : 'pointer',
              opacity: pdfLoading ? 0.6 : 1,
              transition: 'background 0.15s, opacity 0.15s',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              whiteSpace: 'nowrap',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
            {pdfLoading ? 'Generating...' : 'Export to PDF'}
          </button>
          <ExportReportButton />
        </div>
      </div>

      {/* Query Builder filters */}
      <FilterPanel
        availableTags={availableTags}
        availableZones={availableZones}
        selectedTags={selectedTags}
        selectedZoneIds={selectedZoneIds}
        dateFrom={dateFrom}
        dateTo={dateTo}
        visibleOptionalColumns={visibleOptionalColumns}
        onTagsChange={handleTagsChange}
        onZoneIdsChange={handleZoneIdsChange}
        onDateFromChange={handleDateFromChange}
        onDateToChange={handleDateToChange}
        onOptionalColumnsChange={handleOptionalColumnsChange}
      />

      {/* Summary statistics bar */}
      <div className={twStatRow}>
        <div className={twStat}>
          <span className={twStatLabel}>Flows</span>
          <span className={twStatValue}>{stats.flowCount}</span>
        </div>
        <div className={twStat}>
          <span className={twStatLabel}>Total Gross</span>
          <span className={twStatValue}>
            {stats.totalGross.toLocaleString('en-US', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </span>
        </div>
        <div className={twStat}>
          <span className={twStatLabel}>Total WHT</span>
          <span className={twStatValue}>
            {stats.totalWht.toLocaleString('en-US', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </span>
        </div>
        <div className={twStat}>
          <span className={twStatLabel}>Violations</span>
          <span
            className={`${twStatValue} ${stats.violations > 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}
          >
            {stats.violations}
          </span>
        </div>
      </div>

      {/* Entity Tax Summary */}
      <EntityTaxTable
        project={project}
        selectedTags={selectedTags}
        selectedZoneIds={selectedZoneIds}
        dateFrom={dateFrom}
        dateTo={dateTo}
      />

      {/* Ledger table — fills remaining space */}
      <LedgerTable
        rows={filteredRows}
        visibleOptionalColumns={visibleOptionalColumns}
      />
    </div>
  );
}
