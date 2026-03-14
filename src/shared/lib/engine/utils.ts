/**
 * Framework-agnostic utility functions.
 * No DOM, no React, no Node.js dependencies — pure math & formatting.
 */

// ─── Date ────────────────────────────────────────────────────────────────────

export const nowIso = (): string => new Date().toISOString();

export const isoDate = (d: string | Date): string =>
  new Date(d).toISOString().slice(0, 10);

// ─── Financial Math ──────────────────────────────────────────────────────────

/** Banker's rounding (round-half-to-even) to 2 decimal places */
export function bankersRound2(num: number): number {
  if (num === 0) return 0;
  const sign = Math.sign(num);
  const absNum = Math.abs(num);

  const d = absNum * 100;
  const floor = Math.floor(d);
  const diff = d - floor;

  let roundedAbs: number;
  if (diff < 0.5) {
    roundedAbs = floor;
  } else if (diff > 0.5) {
    roundedAbs = floor + 1;
  } else {
    roundedAbs = floor % 2 === 0 ? floor : floor + 1;
  }

  return (sign * roundedAbs) / 100;
}

export const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// ─── Formatting ──────────────────────────────────────────────────────────────

export const fmtMoney = (n: number): string => {
  const v = bankersRound2(n);
  try {
    return new Intl.NumberFormat('ru-RU', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(v);
  } catch {
    return (Math.round(v * 100) / 100).toFixed(2);
  }
};

export const formatMoney = (n: number | undefined | null): string => {
  const x = Number(n || 0);
  if (!isFinite(x)) return '0';
  return x.toLocaleString('ru-RU', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  });
};

// ─── IDs ─────────────────────────────────────────────────────────────────────

export const uid = (): string =>
  Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);

// ─── Canonical JSON & Crypto ─────────────────────────────────────────────────

export function stableStringify(obj: unknown): string {
  const seen = new WeakSet();
  const sorter = (a: string, b: string) => a.localeCompare(b);
  const rec = (v: unknown): unknown => {
    if (v === null || typeof v !== 'object') return v;
    if (seen.has(v as object)) return '[Circular]';
    seen.add(v as object);
    if (Array.isArray(v)) return v.map(rec);
    const out: Record<string, unknown> = {};
    Object.keys(v as Record<string, unknown>)
      .sort(sorter)
      .forEach((k) => (out[k] = rec((v as Record<string, unknown>)[k])));
    return out;
  };
  return JSON.stringify(rec(obj));
}

export async function sha256(str: string): Promise<string> {
  const enc = new TextEncoder();
  const data = enc.encode(str);
  const buf = await crypto.subtle.digest('SHA-256', data);
  const arr = Array.from(new Uint8Array(buf));
  return arr.map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ─── Object Utils ────────────────────────────────────────────────────────────

export function deepMerge<T>(base: T, override: Partial<T> | undefined): T {
  if (override === undefined)
    return JSON.parse(JSON.stringify(base));
  if (base === null || typeof base !== 'object')
    return JSON.parse(JSON.stringify(override)) as T;
  if (override === null || typeof override !== 'object')
    return JSON.parse(JSON.stringify(override)) as T;
  if (Array.isArray(base) || Array.isArray(override))
    return JSON.parse(JSON.stringify(override)) as T;
  const out = { ...base } as Record<string, unknown>;
  for (const k of Object.keys(override as Record<string, unknown>)) {
    out[k] = deepMerge(
      (base as Record<string, unknown>)[k],
      (override as Record<string, unknown>)[k] as Partial<unknown>,
    );
  }
  return out as T;
}

export function diffPatch(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Array<{ op: string; path: string; value: unknown }> {
  const ops: Array<{ op: string; path: string; value: unknown }> = [];
  for (const k of Object.keys(after)) {
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) {
      ops.push({ op: 'replace', path: '/' + k, value: after[k] });
    }
  }
  return ops;
}

// ─── HTML Safety ─────────────────────────────────────────────────────────────

const htmlEscapeMap: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => htmlEscapeMap[c]);
}
