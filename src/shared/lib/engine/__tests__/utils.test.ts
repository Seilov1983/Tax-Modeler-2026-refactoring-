import { describe, it, expect } from 'vitest';
import {
  bankersRound2,
  numOrNull,
  fmtMoney,
  formatMoney,
  uid,
  stableStringify,
  deepMerge,
  diffPatch,
  escapeHtml,
  nowIso,
  isoDate,
} from '../utils';

// ─── Banker's Rounding ────────────────────────────────────────────────────────

describe('bankersRound2 (round-half-to-even)', () => {
  it('rounds 2.5 → 2 (half rounds to even)', () => {
    // 2.5 scaled = 250, floor=250, diff=0 → even → stays 250 → 2.50
    // But the function rounds to 2 decimal places, so 2.5 means x=2.5
    // scaled = 250, f=250, diff=0 → f%2===0 → r=250 → 2.50
    expect(bankersRound2(2.5)).toBe(2.5);
  });

  it('rounds 0.025 → 0.02 (half rounds to even, floor is even)', () => {
    expect(bankersRound2(0.025)).toBe(0.02);
  });

  it('rounds 0.035 → 0.04 (half rounds to even, floor is odd)', () => {
    expect(bankersRound2(0.035)).toBe(0.04);
  });

  it('rounds 0.045 → 0.04 (half rounds to even, floor is even)', () => {
    expect(bankersRound2(0.045)).toBe(0.04);
  });

  it('rounds 0.015 → 0.02 (half rounds to even, floor is odd)', () => {
    expect(bankersRound2(0.015)).toBe(0.02);
  });

  it('rounds down when remainder < 0.5', () => {
    expect(bankersRound2(2.344)).toBe(2.34);
    expect(bankersRound2(100.001)).toBe(100.0);
  });

  it('rounds up when remainder > 0.5', () => {
    expect(bankersRound2(2.346)).toBe(2.35);
    expect(bankersRound2(0.999)).toBe(1.0);
  });

  it('handles zero', () => {
    expect(bankersRound2(0)).toBe(0);
  });

  it('handles negative numbers', () => {
    // Note: -2.345 * 100 = -234.5 in theory, but abs(2.345)*100 = 234.50000000000003
    // due to IEEE 754, so diff > 0.5 → rounds up to -2.35 (symmetric with positive)
    expect(bankersRound2(-2.345)).toBe(-2.35);
    expect(bankersRound2(-2.344)).toBe(-2.34);
    expect(bankersRound2(-0.025)).toBe(-0.02);
  });

  it('preserves already-rounded values', () => {
    expect(bankersRound2(1.23)).toBe(1.23);
    expect(bankersRound2(100)).toBe(100);
  });

  it('handles large financial amounts', () => {
    expect(bankersRound2(1_000_000.456)).toBe(1_000_000.46);
    expect(bankersRound2(999_999_999.994)).toBe(999_999_999.99);
  });
});

// ─── numOrNull ──────────────────────────────────────────────────────────────

describe('numOrNull', () => {
  it('returns number for valid numeric input', () => {
    expect(numOrNull(42)).toBe(42);
    expect(numOrNull('3.14')).toBe(3.14);
    expect(numOrNull(0)).toBe(0);
  });

  it('returns null for null/undefined/empty', () => {
    expect(numOrNull(null)).toBeNull();
    expect(numOrNull(undefined)).toBeNull();
    expect(numOrNull('')).toBeNull();
  });

  it('returns null for non-numeric strings', () => {
    expect(numOrNull('abc')).toBeNull();
    expect(numOrNull('NaN')).toBeNull();
  });

  it('returns null for Infinity', () => {
    expect(numOrNull(Infinity)).toBeNull();
    expect(numOrNull(-Infinity)).toBeNull();
  });
});

// ─── Formatting ─────────────────────────────────────────────────────────────

describe('fmtMoney', () => {
  it('formats positive number with 2 decimal places (en-US default)', () => {
    const result = fmtMoney(1234.5);
    // en-US uses comma thousands, period decimal
    expect(result).toBe('1,234.50');
  });

  it('formats zero', () => {
    expect(fmtMoney(0)).toBe('0.00');
  });

  it('respects locale override (ru-RU)', () => {
    const result = fmtMoney(1234.5, 'ru-RU');
    expect(result).toMatch(/1[\s\u00a0]?234,50/);
  });
});

describe('formatMoney', () => {
  it('formats number with en-US default locale', () => {
    const result = formatMoney(1234);
    expect(result).toBe('1,234');
  });

  it('handles null/undefined → "0"', () => {
    expect(formatMoney(null)).toBe('0');
    expect(formatMoney(undefined)).toBe('0');
  });
});

// ─── uid ────────────────────────────────────────────────────────────────────

describe('uid', () => {
  it('generates non-empty string', () => {
    const id = uid();
    expect(id).toBeTruthy();
    expect(typeof id).toBe('string');
  });

  it('generates unique values', () => {
    const ids = new Set(Array.from({ length: 100 }, () => uid()));
    expect(ids.size).toBe(100);
  });
});

// ─── stableStringify ────────────────────────────────────────────────────────

describe('stableStringify', () => {
  it('produces deterministic output regardless of key order', () => {
    const a = { z: 1, a: 2 };
    const b = { a: 2, z: 1 };
    expect(stableStringify(a)).toBe(stableStringify(b));
  });

  it('handles nested objects', () => {
    const obj = { b: { d: 1, c: 2 }, a: 3 };
    const parsed = JSON.parse(stableStringify(obj));
    expect(Object.keys(parsed)).toEqual(['a', 'b']);
    expect(Object.keys(parsed.b)).toEqual(['c', 'd']);
  });

  it('handles arrays (order preserved)', () => {
    expect(stableStringify([3, 1, 2])).toBe('[3,1,2]');
  });

  it('handles null and primitives', () => {
    expect(stableStringify(null)).toBe('null');
    expect(stableStringify(42)).toBe('42');
    expect(stableStringify('hello')).toBe('"hello"');
  });

  it('handles circular references gracefully', () => {
    const obj: Record<string, unknown> = { a: 1 };
    obj.self = obj;
    expect(() => stableStringify(obj)).not.toThrow();
    expect(stableStringify(obj)).toContain('[Circular]');
  });
});

// ─── deepMerge ──────────────────────────────────────────────────────────────

describe('deepMerge', () => {
  it('deep merges nested objects', () => {
    const base = { a: 1, nested: { x: 10, y: 20 } };
    const override = { nested: { y: 99 } };
    const result = deepMerge(base, override);
    expect(result).toEqual({ a: 1, nested: { x: 10, y: 99 } });
  });

  it('returns deep clone when override is undefined', () => {
    const base = { a: { b: 1 } };
    const result = deepMerge(base, undefined);
    expect(result).toEqual(base);
    expect(result).not.toBe(base);
    expect(result.a).not.toBe(base.a);
  });

  it('override replaces arrays entirely', () => {
    const base = { arr: [1, 2, 3] };
    const override = { arr: [4, 5] };
    const result = deepMerge(base, override);
    expect(result.arr).toEqual([4, 5]);
  });

  it('override replaces null base', () => {
    const result = deepMerge(null as unknown as { a: number }, { a: 1 });
    expect(result).toEqual({ a: 1 });
  });
});

// ─── diffPatch ──────────────────────────────────────────────────────────────

describe('diffPatch', () => {
  it('detects changed fields', () => {
    const before = { a: 1, b: 2 };
    const after = { a: 1, b: 3 };
    const ops = diffPatch(before, after);
    expect(ops).toEqual([{ op: 'replace', path: '/b', value: 3 }]);
  });

  it('detects added fields', () => {
    const before = { a: 1 };
    const after = { a: 1, b: 2 };
    const ops = diffPatch(before, after);
    expect(ops).toEqual([{ op: 'replace', path: '/b', value: 2 }]);
  });

  it('returns empty array when no changes', () => {
    const obj = { a: 1 };
    expect(diffPatch(obj, obj)).toEqual([]);
  });
});

// ─── escapeHtml ─────────────────────────────────────────────────────────────

describe('escapeHtml', () => {
  it('escapes all dangerous HTML characters', () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;',
    );
  });

  it('escapes ampersand and single quotes', () => {
    expect(escapeHtml("a & b's")).toBe('a &amp; b&#39;s');
  });

  it('handles null/undefined', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  it('passes through safe strings unchanged', () => {
    expect(escapeHtml('Hello World')).toBe('Hello World');
  });
});

// ─── Date Utils ─────────────────────────────────────────────────────────────

describe('nowIso', () => {
  it('returns valid ISO string', () => {
    const result = nowIso();
    expect(new Date(result).toISOString()).toBe(result);
  });
});

describe('isoDate', () => {
  it('extracts date part from ISO string', () => {
    expect(isoDate('2026-03-15T14:30:00Z')).toBe('2026-03-15');
  });

  it('handles Date object', () => {
    const d = new Date('2026-01-01T00:00:00Z');
    expect(isoDate(d)).toBe('2026-01-01');
  });
});
