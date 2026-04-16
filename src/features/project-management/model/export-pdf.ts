/**
 * Client-side PDF export using jspdf + jspdf-autotable.
 *
 * Generates an A4 corporate report containing:
 * 1. Document Header (Project Name, Date, SHA-256 Hash)
 * 2. Entity Tax Summary table
 * 3. Flow Ledger table
 * 4. Active Compliance Violations / Risk Flags
 *
 * Cyrillic support: loads Roboto-Regular.ttf / Roboto-Bold.ttf from /fonts/
 * and registers them in jsPDF's Virtual File System at runtime.
 */

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { generateAuditSnapshot } from '@shared/lib/engine';
import { fmtMoney, fmtPercent, bankersRound2 } from '@shared/lib/engine/utils';
import { saveFile } from '@shared/lib/download';
import type { Project } from '@shared/types';

// Aliases: keep short names in PDF table generation code for readability.
const fmt = fmtMoney;
const pct = fmtPercent;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Draw the TSM26 "Infinity What-If" brand mark as a native jsPDF vector.
 *
 * Mirrors the geometry of `src/shared/ui/Logo.tsx` — pure orthogonal lines,
 * zero bezier curves — so the PDF brand mark matches the UI exactly and
 * stays crisp at any zoom level (no raster resampling).
 *
 * The logo's SVG viewBox is 32×32; `size` below is the side length in mm.
 */
function drawTsm26Logo(doc: jsPDF, x: number, y: number, size: number): void {
  const unit = size / 32; // 1 SVG user-unit → mm
  const prevDraw = doc.getDrawColor();
  const prevLW = doc.getLineWidth();

  // Primary orthogonal infinity — Apple Blue (#007aff → 0,122,255)
  doc.setDrawColor(0, 122, 255);
  doc.setLineWidth(2.5 * unit);
  doc.setLineCap('butt');
  doc.setLineJoin('miter');
  const pts: Array<[number, number]> = [
    [2, 4], [12, 4], [12, 12], [20, 12], [20, 4],
    [30, 4], [30, 28], [20, 28], [20, 20], [12, 20],
    [12, 28], [2, 28], [2, 4],
  ];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    doc.line(x + x1 * unit, y + y1 * unit, x + x2 * unit, y + y2 * unit);
  }

  // Secondary crosshair — dark slate (#334155 → 51,65,85) marking the A* intersection
  doc.setDrawColor(51, 65, 85);
  doc.setLineWidth(2 * unit);
  doc.line(x + 14 * unit, y + 16 * unit, x + 18 * unit, y + 16 * unit);
  doc.line(x + 16 * unit, y + 14 * unit, x + 16 * unit, y + 18 * unit);

  // Restore previous draw state
  doc.setDrawColor(prevDraw);
  doc.setLineWidth(prevLW);
}

/** Convert ArrayBuffer to base64 string (browser-safe). */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** Load a font from /fonts/ and register it in jsPDF VFS. */
async function registerFont(
  doc: jsPDF,
  url: string,
  vfsName: string,
  fontFamily: string,
  style: string,
): Promise<boolean> {
  try {
    const res = await fetch(url);
    if (!res.ok) return false;
    const buf = await res.arrayBuffer();
    if (buf.byteLength < 1000) return false; // too small — not a real font
    const b64 = arrayBufferToBase64(buf);
    doc.addFileToVFS(vfsName, b64);
    doc.addFont(vfsName, fontFamily, style);
    return true;
  } catch {
    return false;
  }
}

// ─── PDF Generator ──────────────────────────────────────────────────────────

export async function exportReportPdf(project: Project): Promise<void> {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();

  // ── Register Roboto for Cyrillic support ────────────────────────────────
  const [hasRegular, hasBold] = await Promise.all([
    registerFont(doc, '/fonts/Roboto-Regular.ttf', 'Roboto-Regular.ttf', 'Roboto', 'normal'),
    registerFont(doc, '/fonts/Roboto-Bold.ttf', 'Roboto-Bold.ttf', 'Roboto', 'bold'),
  ]);

  // Font family to use throughout the document
  const fontFamily = hasRegular ? 'Roboto' : 'helvetica';

  // Generate audit snapshot for hash & risk flags
  const snapshot = await generateAuditSnapshot(project);
  const { hash, timestamp, taxSummary, riskFlags } = snapshot;

  // ── 1. Document Header ──────────────────────────────────────────────────

  // Brand mark — pure-orthogonal "Infinity What-If" logo, top-left corner
  drawTsm26Logo(doc, 14, 10, 12);

  doc.setFont(fontFamily, hasBold ? 'bold' : 'normal');
  doc.setFontSize(18);
  doc.setTextColor(29, 29, 31);
  doc.text('Corporate Structure Book — ' + project.title, 30, 18);

  doc.setFont(fontFamily, 'normal');
  doc.setFontSize(9);
  doc.setTextColor(107, 114, 128);
  doc.text(`Generated: ${timestamp}`, 30, 25);
  doc.text(`SHA-256 Audit Seal: ${hash}`, 30, 30);
  doc.text(`Schema: ${project.schemaVersion}  |  Currency: ${project.baseCurrency}`, 30, 35);

  // Thin separator
  doc.setDrawColor(229, 231, 235);
  doc.setLineWidth(0.3);
  doc.line(14, 38, pageWidth - 14, 38);

  let cursorY = 43;

  // ── 2. Entity Tax Summary ───────────────────────────────────────────────

  doc.setFont(fontFamily, hasBold ? 'bold' : 'normal');
  doc.setFontSize(11);
  doc.setTextColor(29, 29, 31);
  doc.text('Entity Tax Summary', 14, cursorY);
  cursorY += 2;

  // Use pre-computed CIT liabilities from the real engine
  const entityRows = taxSummary.citLiabilities.map((cit) => {
    const zone = project.zones.find((z) => z.id === cit.zoneId);
    return [
      cit.nodeName,
      zone ? `${zone.name} (${cit.jurisdiction ?? '-'})` : (cit.jurisdiction ?? '-'),
      fmt(cit.taxableIncome),
      pct(cit.citRate),
      fmt(cit.citAmount),
      cit.lawRef ?? '-',
      cit.calculationBreakdown ?? '-',
    ];
  });

  const tableFont = fontFamily;

  if (entityRows.length > 0) {
    autoTable(doc, {
      startY: cursorY,
      head: [['Entity', 'Zone', 'Taxable Income', 'CIT Rate', 'CIT Amount', 'Law Ref', 'Breakdown']],
      body: entityRows,
      theme: 'grid',
      styles: { fontSize: 7.5, cellPadding: 2, textColor: [55, 65, 81], font: tableFont },
      headStyles: {
        fillColor: [249, 250, 251],
        textColor: [107, 114, 128],
        fontStyle: 'bold',
        fontSize: 7,
      },
      columnStyles: {
        2: { halign: 'right' },
        3: { halign: 'right' },
        4: { halign: 'right' },
        6: { cellWidth: 60 },
      },
      margin: { left: 14, right: 14 },
    });
    cursorY = (doc as any).lastAutoTable.finalY + 8;
  } else {
    doc.setFont(fontFamily, 'normal');
    doc.setFontSize(9);
    doc.setTextColor(156, 163, 175);
    doc.text('No company entities in the structure.', 14, cursorY + 5);
    cursorY += 12;
  }

  // ── 3. Flow Ledger ──────────────────────────────────────────────────────

  if (cursorY > doc.internal.pageSize.getHeight() - 40) {
    doc.addPage();
    cursorY = 15;
  }

  doc.setFont(fontFamily, hasBold ? 'bold' : 'normal');
  doc.setFontSize(11);
  doc.setTextColor(29, 29, 31);
  doc.text('Flow Ledger', 14, cursorY);
  cursorY += 2;

  const nodeNameMap = new Map(project.nodes.map((n) => [n.id, n.name]));

  // Use WHT from the audit snapshot's computed whtLiabilities for accurate rates
  const whtByFlowId = new Map<string, { ratePercent: number; amount: number }>();
  for (const wht of taxSummary.whtLiabilities) {
    whtByFlowId.set(wht.flowId, { ratePercent: wht.whtRatePercent, amount: wht.whtAmountOriginal });
  }

  const flowRows = project.flows
    .filter((f) => Number(f.grossAmount || 0) > 0)
    .sort((a, b) => (a.flowDate ?? '').localeCompare(b.flowDate ?? ''))
    .map((f) => {
      const gross = Number(f.grossAmount || 0);
      // Use engine-computed WHT from audit snapshot; fall back to flow's stored rate
      const whtEntry = whtByFlowId.get(f.id);
      const whtAmount = whtEntry?.amount ?? bankersRound2(gross * (Number(f.whtRate || 0) / 100));
      const net = bankersRound2(gross - whtAmount);
      const status = f.compliance?.exceeded ? 'Violation' : 'OK';
      
      // Look up LawRef from the whtLiabilities in the snapshot
      const liabilityEntry = taxSummary.whtLiabilities.find(w => w.flowId === f.id);

      return [
        (f.flowDate ?? '').slice(0, 10),
        f.flowType,
        nodeNameMap.get(f.fromId) ?? f.fromId,
        nodeNameMap.get(f.toId) ?? f.toId,
        fmt(gross),
        fmt(net),
        fmt(whtAmount),
        liabilityEntry?.lawRef ?? '-',
        liabilityEntry?.calculationBreakdown ?? '-',
        status,
      ];
    });

  if (flowRows.length > 0) {
    autoTable(doc, {
      startY: cursorY,
      head: [['Date', 'Type', 'From', 'To', 'Gross', 'Net', 'WHT', 'Law Ref', 'Breakdown', 'Status']],
      body: flowRows,
      theme: 'grid',
      styles: { fontSize: 7, cellPadding: 2, textColor: [55, 65, 81], font: tableFont },
      headStyles: {
        fillColor: [249, 250, 251],
        textColor: [107, 114, 128],
        fontStyle: 'bold',
        fontSize: 6.5,
      },
      columnStyles: {
        4: { halign: 'right' },
        5: { halign: 'right' },
        6: { halign: 'right' },
        8: { cellWidth: 50 },
      },
      margin: { left: 14, right: 14 },
      didParseCell: (data: any) => {
        if (data.section === 'body' && data.column.index === 9) {
          if (data.cell.raw === 'Violation') {
            data.cell.styles.textColor = [220, 38, 38];
            data.cell.styles.fontStyle = 'bold';
          } else {
            data.cell.styles.textColor = [22, 163, 74];
          }
        }
      },
    });
    cursorY = (doc as any).lastAutoTable.finalY + 8;
  } else {
    doc.setFont(fontFamily, 'normal');
    doc.setFontSize(9);
    doc.setTextColor(156, 163, 175);
    doc.text('No flows in the structure.', 14, cursorY + 5);
    cursorY += 12;
  }

  // ── 4. Risk Flags / Compliance Violations ──────────────────────────────

  if (cursorY > doc.internal.pageSize.getHeight() - 40) {
    doc.addPage();
    cursorY = 15;
  }

  doc.setFont(fontFamily, hasBold ? 'bold' : 'normal');
  doc.setFontSize(11);
  doc.setTextColor(29, 29, 31);
  doc.text('Active Risk Flags & Compliance Violations', 14, cursorY);
  cursorY += 2;

  const riskRows: string[][] = [];
  for (const entry of riskFlags) {
    for (const flag of entry.flags) {
      const severity = (['CFC_RISK', 'PILLAR2_LOW_ETR', 'PILLAR2_TOPUP_RISK', 'PILLAR2_TRIGGER'].includes(flag.type))
        ? 'HIGH'
        : (['SUBSTANCE_BREACH', 'TRANSFER_PRICING_RISK'].includes(flag.type))
          ? 'MEDIUM'
          : 'LOW';
      const friendlyType = flag.type.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
      riskRows.push([
        entry.entityName,
        entry.jurisdiction,
        friendlyType,
        severity,
        flag.lawRef ?? '-',
      ]);
    }
  }

  if (riskRows.length > 0) {
    autoTable(doc, {
      startY: cursorY,
      head: [['Entity', 'Jurisdiction', 'Risk Type', 'Severity', 'Law Reference']],
      body: riskRows,
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 2, textColor: [55, 65, 81], font: tableFont },
      headStyles: {
        fillColor: [249, 250, 251],
        textColor: [107, 114, 128],
        fontStyle: 'bold',
        fontSize: 7,
      },
      margin: { left: 14, right: 14 },
      didParseCell: (data: any) => {
        if (data.section === 'body' && data.column.index === 3) {
          const val = data.cell.raw;
          if (val === 'HIGH') {
            data.cell.styles.textColor = [220, 38, 38];
            data.cell.styles.fontStyle = 'bold';
          } else if (val === 'MEDIUM') {
            data.cell.styles.textColor = [217, 119, 6];
            data.cell.styles.fontStyle = 'bold';
          }
        }
      },
    });
  } else {
    doc.setFont(fontFamily, 'normal');
    doc.setFontSize(9);
    doc.setTextColor(22, 163, 74);
    doc.text('No active risk flags. Structure appears compliant.', 14, cursorY + 5);
  }

  // ── Footer on every page ───────────────────────────────────────────────

  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    const pageH = doc.internal.pageSize.getHeight();
    doc.setFont(fontFamily, 'normal');
    doc.setFontSize(7);
    doc.setTextColor(156, 163, 175);
    doc.text(
      `Tax Modeler 2026  |  ${project.title}  |  SHA-256: ${hash.slice(0, 16)}...  |  Page ${i}/${totalPages}`,
      14,
      pageH - 8,
    );
  }

  // ── Save ───────────────────────────────────────────────────────────────

  const sanitizedName = project.title.replace(/[<>:"/\\|?*]/g, '').trim() || 'report';
  const filename = `${sanitizedName}-tax-report.pdf`;

  const pdfBlob = doc.output('blob');
  await saveFile(pdfBlob, filename);
}
