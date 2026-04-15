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
// Single source of truth for financial number display across the entire app.
// All money amounts: thousands-separated, exactly 2 decimal places.
// All percentages: 1–2 decimal places, trailing "%" suffix.

/**
 * Format a monetary amount with thousands separators and exactly 2 decimals.
 * Uses banker's rounding before display. Locale defaults to `en-US` (comma
 * thousands, period decimal); pass `'ru-RU'` for space thousands/comma decimal.
 */
export const fmtMoney = (n: number, locale: string = 'en-US'): string => {
  const v = bankersRound2(n);
  try {
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(v);
  } catch {
    return (Math.round(v * 100) / 100).toFixed(2);
  }
};

/**
 * Compact money formatter for dashboard cards. Prevents layout breakage with
 * large numbers (e.g. "409.11M" instead of "409,110,000.00").
 * Returns a compact string; callers should show the full fmtMoney value in a tooltip.
 */
export const fmtMoneyCompact = (n: number, locale: string = 'en-US'): string => {
  const v = bankersRound2(n);
  try {
    return new Intl.NumberFormat(locale, {
      notation: 'compact',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(v);
  } catch {
    return fmtMoney(n, locale);
  }
};

/**
 * Loose money formatter — handles null/undefined, 0–2 fraction digits.
 * Useful for optional fields in master data and sidebar summaries.
 */
export const formatMoney = (n: number | undefined | null, locale: string = 'en-US'): string => {
  const x = Number(n || 0);
  if (!isFinite(x)) return '0';
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(x);
};

/**
 * Format a rate (0–1 decimal fraction) as a human-readable percentage string.
 * E.g. `fmtPercent(0.2045)` → `"20.45%"`, `fmtPercent(0.2, 1)` → `"20.0%"`.
 */
export const fmtPercent = (rate: number, decimals: number = 2): string => {
  const pct = rate * 100;
  return `${pct.toFixed(decimals)}%`;
};

/**
 * Format a number with space-grouping for masked input display (no currency symbol).
 * Shows "1 234 567.89" when the input is not focused. Returns '' for 0/NaN.
 */
export const fmtInputDisplay = (n: number): string => {
  if (!isFinite(n) || n === 0) return '';
  try {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
      useGrouping: true,
    }).format(n).replace(/,/g, ' ');
  } catch {
    return String(n);
  }
};

/** Parse a space-formatted input string back to a raw number. */
export const parseInputDisplay = (s: string): number => {
  const cleaned = s.replace(/[\s\u00A0]/g, '');
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
};

/** Map currency code → compact symbol for badge display. */
const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$', EUR: '\u20ac', KZT: '\u20b8', AED: 'AED', GBP: '\u00a3',
  HKD: 'HK$', SGD: 'S$', SCR: 'SCR', CNY: '\u00a5',
};

export const currencySymbol = (code: string): string =>
  CURRENCY_SYMBOLS[code] || code;

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

type DeepPartial<T> = T extends object ? { [P in keyof T]?: DeepPartial<T[P]> } : T;

export function deepMerge<T>(base: T, override: DeepPartial<T> | undefined): T {
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
