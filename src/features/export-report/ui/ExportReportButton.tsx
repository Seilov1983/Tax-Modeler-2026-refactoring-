'use client';

/**
 * ExportReportButton — Triggers Markdown Corporate Structure Book export.
 *
 * SECURITY GUARD-RAIL: If project.readOnly === true (audit hash chain
 * integrity compromised), the button is disabled and a warning toast is shown.
 *
 * No useEffect. Uses useState for loading state, useCallback for handlers.
 */

import { useState, useCallback } from 'react';
import { useAtomValue } from 'jotai';
import { projectAtom } from '@features/canvas/model/project-atom';
import {
  generateAuditSnapshot,
  exportStructureBook,
  downloadMarkdown,
} from '@shared/lib/engine';

// ─── Styles ──────────────────────────────────────────────────────────────────

const btnStyle: React.CSSProperties = {
  padding: '8px 16px',
  fontSize: '13px',
  fontWeight: 600,
  background: '#34c759',
  color: '#fff',
  border: 'none',
  borderRadius: '10px',
  cursor: 'pointer',
  transition: 'background 0.15s, opacity 0.15s',
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  whiteSpace: 'nowrap',
};

const btnDisabledStyle: React.CSSProperties = {
  ...btnStyle,
  background: '#86868b',
  cursor: 'not-allowed',
  opacity: 0.6,
};

const toastStyle: React.CSSProperties = {
  position: 'fixed',
  bottom: '24px',
  right: '24px',
  padding: '12px 20px',
  background: '#fef2f2',
  border: '1px solid #fecaca',
  borderRadius: '10px',
  color: '#dc2626',
  fontSize: '13px',
  fontWeight: 500,
  zIndex: 10000,
  boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
  fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Inter', sans-serif",
  maxWidth: '360px',
};

// ─── Component ───────────────────────────────────────────────────────────────

export function ExportReportButton() {
  const project = useAtomValue(projectAtom);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const isReadOnly = project?.readOnly === true;

  const showToast = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 4000);
  }, []);

  const handleExport = useCallback(async () => {
    if (!project) return;

    // SECURITY BLOCKER: readOnly === true means hash chain is broken
    if (project.readOnly) {
      showToast('Export disabled: Audit Log integrity compromised.');
      return;
    }

    if (loading) return;
    setLoading(true);

    try {
      const snapshot = await generateAuditSnapshot(project);
      const markdown = exportStructureBook(project, snapshot);
      const ts = new Date().toISOString().slice(0, 10);
      downloadMarkdown(markdown, `structure-book-${ts}.md`);
    } catch (err) {
      console.error('[Export Report]', err);
      showToast('Failed to generate Corporate Structure Book.');
    } finally {
      setLoading(false);
    }
  }, [project, loading, showToast]);

  const currentStyle = isReadOnly || loading ? btnDisabledStyle : btnStyle;

  return (
    <>
      <button
        onClick={handleExport}
        disabled={isReadOnly || loading}
        title={
          isReadOnly
            ? 'Export disabled: Audit Log integrity compromised'
            : 'Generate SHA-256 sealed Corporate Structure Book (Markdown)'
        }
        style={currentStyle}
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
        >
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
        {loading ? 'Generating...' : 'Export to Markdown'}
      </button>

      {isReadOnly && !toast && (
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            fontSize: '11px',
            color: '#dc2626',
            fontWeight: 500,
            marginLeft: '8px',
          }}
        >
          Audit Log integrity compromised
        </div>
      )}

      {toast && <div style={toastStyle}>{toast}</div>}
    </>
  );
}
