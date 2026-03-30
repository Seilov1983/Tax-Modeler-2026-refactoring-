/**
 * Audit Snapshot & Corporate Structure Book — Zero-Dependency Export.
 *
 * Pure TypeScript: no React, no DOM, no external libraries.
 * Uses native crypto.subtle (SHA-256) and Blob for browser export.
 *
 * Architectural invariant: this module lives in engine/ and MUST remain
 * framework-agnostic. The only browser API used is crypto.subtle (also
 * available in Node.js ≥ 15 via globalThis.crypto).
 */

import { computeGroupTax } from './engine-tax';
import { recomputeRisks } from './engine-risks';
import { saveFile } from '../download';
import type {
  Project, Zone, NodeDTO, FlowDTO, OwnershipEdge, RiskFlag,
  GroupTaxSummary,
} from '@shared/types';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AuditSnapshot {
  /** SHA-256 hex digest of the canonical JSON payload. */
  hash: string;
  /** ISO-8601 timestamp when the snapshot was generated. */
  timestamp: string;
  /** Canonical JSON string (deterministic, no visual data). */
  canonicalJson: string;
  /** Pre-computed group tax summary for the report. */
  taxSummary: GroupTaxSummary;
  /** All active risk flags across the project. */
  riskFlags: AuditRiskEntry[];
}

export interface AuditRiskEntry {
  entityName: string;
  entityId: string;
  jurisdiction: string;
  flags: RiskFlag[];
}

// ─── Strip Visual Data ──────────────────────────────────────────────────────

/** Strip visual/transient fields from a Zone, keeping only tax-relevant data. */
function stripZone(z: Zone) {
  return {
    id: z.id,
    name: z.name,
    jurisdiction: z.jurisdiction,
    code: z.code,
    currency: z.currency,
    parentId: z.parentId ?? null,
    tax: z.tax ?? null,
  };
}

/** Strip visual/transient fields from a Node, keeping only financial data. */
function stripNode(n: NodeDTO) {
  return {
    id: n.id,
    name: n.name,
    type: n.type,
    zoneId: n.zoneId,
    frozen: n.frozen,
    annualIncome: n.annualIncome,
    etr: n.etr,
    computedEtr: n.computedEtr ?? null,
    balances: n.balances,
    riskFlags: n.riskFlags,
    passiveIncomeShare: n.passiveIncomeShare ?? null,
    hasSubstance: n.hasSubstance ?? null,
    ledger: n.ledger ?? null,
  };
}

/** Strip visual/transient fields from a Flow. */
function stripFlow(f: FlowDTO) {
  return {
    id: f.id,
    fromId: f.fromId,
    toId: f.toId,
    flowType: f.flowType,
    currency: f.currency,
    grossAmount: f.grossAmount,
    whtRate: f.whtRate,
    applyDTT: f.applyDTT ?? false,
    customWhtRate: f.customWhtRate ?? null,
    status: f.status,
    flowDate: f.flowDate,
    taxAdjustments: f.taxAdjustments,
  };
}

/** Strip ownership to essential fields. */
function stripOwnership(o: OwnershipEdge) {
  return {
    id: o.id,
    fromId: o.fromId,
    toId: o.toId,
    percent: o.percent,
    manualAdjustment: o.manualAdjustment,
  };
}

/**
 * Build a deterministic canonical payload from a Project.
 * Strips all visual data (x, y, w, h, colors, zIndex, UI config).
 * Keys are sorted for deterministic JSON.stringify output.
 */
function buildCanonicalPayload(project: Project) {
  return {
    schemaVersion: project.schemaVersion,
    engineVersion: project.engineVersion,
    projectId: project.projectId,
    title: project.title,
    baseCurrency: project.baseCurrency,
    isPillarTwoScope: project.isPillarTwoScope ?? false,
    consolidatedRevenueEur: project.group?.consolidatedRevenueEur ?? null,
    zones: project.zones.map(stripZone),
    nodes: project.nodes.map(stripNode),
    flows: project.flows.map(stripFlow),
    ownership: project.ownership.map(stripOwnership),
    projectRiskFlags: project.projectRiskFlags,
  };
}

/** JSON.stringify replacer that sorts object keys at every nesting level. */
function sortKeysReplacer(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[k] = (value as Record<string, unknown>)[k];
    }
    return sorted;
  }
  return value;
}

// ─── SHA-256 Hashing ────────────────────────────────────────────────────────

async function sha256(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const buffer = await crypto.subtle.digest('SHA-256', encoder.encode(data));
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ─── Public API: Generate Audit Snapshot ────────────────────────────────────

/**
 * Generate a cryptographic audit snapshot of the project's financial state.
 *
 * 1. Recomputes risk flags to ensure they reflect current graph state.
 * 2. Strips all visual/transient data (coordinates, colors, UI config).
 * 3. Serializes to deterministic JSON (sorted keys).
 * 4. Computes SHA-256 hash via crypto.subtle.
 * 5. Computes consolidated tax summary via computeGroupTax().
 */
export async function generateAuditSnapshot(project: Project): Promise<AuditSnapshot> {
  // Work on a deep clone to avoid mutating the live Jotai state
  const clone: Project = JSON.parse(JSON.stringify(project));
  recomputeRisks(clone);

  const timestamp = new Date().toISOString();
  const payload = buildCanonicalPayload(clone);
  const canonicalJson = JSON.stringify(payload, sortKeysReplacer, 2);
  const hash = await sha256(canonicalJson);
  const taxSummary = computeGroupTax(clone);

  // Collect risk flags per entity
  const riskFlags: AuditRiskEntry[] = [];
  for (const node of clone.nodes) {
    if (node.riskFlags.length > 0) {
      const zone = clone.zones.find((z) => z.id === node.zoneId);
      riskFlags.push({
        entityName: node.name,
        entityId: node.id,
        jurisdiction: zone?.jurisdiction ?? 'N/A',
        flags: node.riskFlags,
      });
    }
  }

  return { hash, timestamp, canonicalJson, taxSummary, riskFlags };
}

// ─── Corporate Structure Book — Markdown Generator ──────────────────────────

function formatCurrency(amount: number, currency: string): string {
  return `${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function formatPercent(rate: number): string {
  return `${(rate * 100).toFixed(2)}%`;
}

function riskSeverity(flag: RiskFlag): string {
  const type = flag.type;
  if (type === 'CFC_RISK' || type === 'PILLAR2_LOW_ETR' || type === 'PILLAR2_TOPUP_RISK' || type === 'PILLAR2_TRIGGER') return 'HIGH';
  if (type === 'SUBSTANCE_BREACH' || type === 'TRANSFER_PRICING_RISK') return 'MEDIUM';
  return 'LOW';
}

/**
 * Generate a Markdown-formatted Corporate Structure Book.
 */
export function exportStructureBook(
  project: Project,
  snapshot: AuditSnapshot,
): string {
  const { hash, timestamp, taxSummary, riskFlags } = snapshot;
  const lines: string[] = [];

  // ── Header ──────────────────────────────────────────────────────────────
  lines.push('# Corporate Structure Book - Tax Modeler 2026');
  lines.push('');
  lines.push(`**Project:** ${project.title}`);
  lines.push(`**Generated:** ${timestamp}`);
  lines.push(`**Schema Version:** ${project.schemaVersion}`);
  lines.push(`**Engine Version:** ${project.engineVersion}`);
  lines.push(`**Base Currency:** ${project.baseCurrency}`);
  lines.push('');

  // ── Cryptographic Seal ──────────────────────────────────────────────────
  lines.push('## Cryptographic Audit Seal');
  lines.push('');
  lines.push('| Property | Value |');
  lines.push('|---|---|');
  lines.push(`| **SHA-256 Hash** | \`${hash}\` |`);
  lines.push(`| **Timestamp** | ${timestamp} |`);
  lines.push(`| **Algorithm** | SHA-256 (Web Crypto API) |`);
  lines.push('');
  lines.push('> This hash covers the canonical financial payload (all coordinates, colors, and UI state excluded). Any modification to the underlying tax data will produce a different hash.');
  lines.push('');

  // ── Consolidated Metrics ────────────────────────────────────────────────
  lines.push('## Consolidated Tax Metrics');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|---|---|');
  lines.push(`| **Total Pre-Tax Income** | ${formatCurrency(taxSummary.totalIncomeBase, taxSummary.baseCurrency)} |`);
  lines.push(`| **Total CIT** | ${formatCurrency(taxSummary.totalCITBase, taxSummary.baseCurrency)} |`);
  lines.push(`| **Total WHT** | ${formatCurrency(taxSummary.totalWHTBase, taxSummary.baseCurrency)} |`);
  lines.push(`| **Total Tax Burden** | ${formatCurrency(taxSummary.totalTaxBase, taxSummary.baseCurrency)} |`);
  lines.push(`| **Group Effective Tax Rate** | ${formatPercent(taxSummary.totalEffectiveTaxRate)} |`);
  lines.push(`| **Pillar Two Scope** | ${project.isPillarTwoScope ? 'Yes' : 'No'} |`);
  lines.push('');

  // ── Jurisdictions & Zones ───────────────────────────────────────────────
  lines.push('## Jurisdictions & Tax Zones');
  lines.push('');
  lines.push('| Zone | Jurisdiction | Currency | Entities |');
  lines.push('|---|---|---|---|');
  for (const zone of project.zones) {
    const entityCount = project.nodes.filter((n) => n.zoneId === zone.id).length;
    lines.push(`| ${zone.name} | ${zone.jurisdiction} | ${zone.currency} | ${entityCount} |`);
  }
  lines.push('');

  // ── Entity CIT Schedule ─────────────────────────────────────────────────
  lines.push('## Entity CIT Schedule');
  lines.push('');
  if (taxSummary.citLiabilities.length > 0) {
    lines.push('| Entity | Jurisdiction | Taxable Income | CIT Rate | CIT Amount | Law Reference | Currency |');
    lines.push('|---|---|---|---|---|---|---|');
    for (const cit of taxSummary.citLiabilities) {
      lines.push(`| ${cit.nodeName} | ${cit.jurisdiction ?? 'N/A'} | ${formatCurrency(cit.taxableIncome, cit.currency)} | ${formatPercent(cit.citRate)} | ${formatCurrency(cit.citAmount, cit.currency)} | ${cit.lawRef ?? '-'} | ${cit.currency} |`);
    }
  } else {
    lines.push('*No company entities in the structure.*');
  }
  lines.push('');

  // ── Flow WHT Schedule ───────────────────────────────────────────────────
  // Appendix D: ALL flows appear in the ledger, including domestic (0% WHT).
  lines.push('## Flow WHT Schedule');
  lines.push('');
  if (project.flows.length > 0) {
    // Build a lookup for WHT liabilities from the tax summary
    const whtByFlowId = new Map<string, { ratePercent: number; amount: number }>();
    lines.push('| Flow Type | From | To | Gross Amount | WHT Rate | WHT Amount | Law Reference |');
    lines.push('|---|---|---|---|---|---|---|');
    for (const flow of project.flows) {
      const gross = Number(flow.grossAmount || 0);
      if (gross <= 0) continue;
      const fromName = project.nodes.find((n) => n.id === flow.fromId)?.name ?? flow.fromId;
      const toName = project.nodes.find((n) => n.id === flow.toId)?.name ?? flow.toId;
      const whtEntry = whtByFlowId.get(flow.id);
      const ratePercent = whtEntry?.ratePercent ?? 0;
      const whtAmount = whtEntry?.amount ?? 0;
      
      // Look up LawRef from the whtLiabilities in the snapshot
      const liabilityEntry = taxSummary.whtLiabilities.find(w => w.flowId === flow.id);
      
      lines.push(`| ${flow.flowType} | ${fromName} | ${toName} | ${formatCurrency(gross, flow.currency)} | ${ratePercent.toFixed(2)}% | ${formatCurrency(whtAmount, flow.currency)} | ${liabilityEntry?.lawRef ?? '-'} |`);
    }
  } else {
    lines.push('*No flows in the structure.*');
  }
  lines.push('');

  // ── Ownership Structure ─────────────────────────────────────────────────
  lines.push('## Ownership Structure');
  lines.push('');
  if (project.ownership.length > 0) {
    lines.push('| Owner | Subsidiary | Ownership % |');
    lines.push('|---|---|---|');
    for (const edge of project.ownership) {
      const fromName = project.nodes.find((n) => n.id === edge.fromId)?.name ?? edge.fromId;
      const toName = project.nodes.find((n) => n.id === edge.toId)?.name ?? edge.toId;
      const pct = edge.percent + edge.manualAdjustment;
      lines.push(`| ${fromName} | ${toName} | ${pct.toFixed(1)}% |`);
    }
  } else {
    lines.push('*No ownership edges defined.*');
  }
  lines.push('');

  // ── Risk Flags ──────────────────────────────────────────────────────────
  lines.push('## Active Risk Flags');
  lines.push('');
  if (riskFlags.length > 0) {
    lines.push('| Entity | Jurisdiction | Risk Type | Severity | Law Reference |');
    lines.push('|---|---|---|---|---|');
    for (const entry of riskFlags) {
      for (const flag of entry.flags) {
        lines.push(`| ${entry.entityName} | ${entry.jurisdiction} | ${flag.type} | ${riskSeverity(flag)} | ${flag.lawRef ?? '-'} |`);
      }
    }
  } else {
    lines.push('*No active risk flags. Structure appears compliant.*');
  }
  lines.push('');

  // ── Data Manifest (Служебный подвал) ─────────────────────────────────
  lines.push('## Data Manifest');
  lines.push('');
  lines.push('| Field | Value |');
  lines.push('|---|---|');
  lines.push(`| **schemaVersion** | \`${project.schemaVersion}\` |`);
  lines.push(`| **engineVersion** | \`${project.engineVersion}\` |`);
  lines.push(`| **masterDataVersion** | \`${(project.masterData as Record<string, unknown>).version ?? project.schemaVersion}\` |`);
  lines.push(`| **fxTableSnapshotDate** | ${project.fx.fxDate} |`);
  lines.push(`| **fxSource** | ${project.fx.source} |`);
  lines.push(`| **auditLogLastHash** | \`${project.audit.lastHash || 'EMPTY_CHAIN'}\` |`);
  lines.push(`| **snapshotId** | \`${hash.slice(0, 16)}\` |`);
  lines.push(`| **generatedAt** | ${timestamp} |`);
  lines.push('');

  // ── Footer ──────────────────────────────────────────────────────────────
  lines.push('---');
  lines.push('');
  lines.push(`*Generated by Tax Modeler 2026 v${project.schemaVersion} on ${timestamp}.*`);
  lines.push(`*Cryptographic seal: SHA-256 \`${hash.slice(0, 16)}...\`*`);
  lines.push('');

  return lines.join('\n');
}

// ─── Browser Download Trigger ───────────────────────────────────────────────

/**
 * Save Markdown content as a file.
 * Uses the cross-platform download utility (Electron native dialog / browser <a>).
 */
export async function downloadMarkdown(content: string, filename: string): Promise<void> {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  await saveFile(blob, filename);
}
