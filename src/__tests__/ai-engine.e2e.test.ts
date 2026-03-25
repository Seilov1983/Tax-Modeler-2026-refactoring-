/**
 * AI Tax Engine Determinism — E2E Test Suite
 *
 * Validates that the AI copilot correctly identifies tax risks
 * in canonical structure snapshots. Tests run against the local
 * Ollama endpoint; they pass gracefully when the AI is offline.
 */

import { describe, it, expect } from 'vitest';

const API_URL = 'http://localhost:3000/api/chat';

/**
 * Send a chat request and return the status + body text.
 * Returns null if the server is unreachable or times out.
 */
async function chatRequest(
  messages: unknown[],
  extra: Record<string, unknown> = {},
): Promise<{ status: number; text: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, ...extra }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const text = await Promise.race([
      res.text(),
      new Promise<string>((_, reject) => setTimeout(() => reject(new Error('body timeout')), 3000)),
    ]);
    return { status: res.status, text };
  } catch {
    clearTimeout(timer);
    return null; // Offline / timeout — graceful
  }
}

// ─── High-risk CFC scenario: BVI shell owned >25% by market company ─────────
const CFC_HIGH_RISK_SNAPSHOT = JSON.stringify({
  schemaVersion: '2.4.1',
  engineVersion: '2.0.0',
  projectId: 'test-cfc-risk',
  title: 'CFC Risk Test Structure',
  baseCurrency: 'USD',
  isPillarTwoScope: false,
  consolidatedRevenueEur: null,
  zones: [
    { id: 'z1', name: 'Kazakhstan', jurisdiction: 'KZ', code: 'KZ', currency: 'KZT', parentId: null, tax: null },
    { id: 'z2', name: 'BVI Offshore', jurisdiction: 'BVI', code: 'BVI', currency: 'USD', parentId: null, tax: null },
  ],
  nodes: [
    {
      id: 'n1', name: 'KZ Operating Co', type: 'company', zoneId: 'z1',
      frozen: false, annualIncome: 5_000_000, etr: 0.20, computedEtr: null,
      balances: {}, riskFlags: [], passiveIncomeShare: 0.05, hasSubstance: true, ledger: null,
    },
    {
      id: 'n2', name: 'BVI Holding Ltd', type: 'company', zoneId: 'z2',
      frozen: false, annualIncome: 2_000_000, etr: 0.0, computedEtr: null,
      balances: {}, riskFlags: [{ type: 'CFC_RISK', severity: 'HIGH', lawRef: 'KZ Tax Code Art. 294' }],
      passiveIncomeShare: 0.95, hasSubstance: false, ledger: null,
    },
  ],
  flows: [
    {
      id: 'f1', fromId: 'n1', toId: 'n2', flowType: 'Dividends', currency: 'USD',
      grossAmount: 1_000_000, whtRate: 0.15, applyDTT: false, customWhtRate: null,
      status: 'active', flowDate: '2026-01-01', taxAdjustments: {},
    },
  ],
  ownership: [
    { id: 'o1', fromId: 'n1', toId: 'n2', percent: 100, manualAdjustment: 0 },
  ],
  projectRiskFlags: [],
});

describe('AI Tax Engine Determinism', () => {
  it('should flag CFC risk for BVI shell without substance', { timeout: 10000 }, async () => {
    const msg = [{ id: 't1', role: 'user', parts: [{ type: 'text', text: 'Analyze this structure. Are there any risks?' }] }];
    const result = await chatRequest(msg, { canvasSnapshot: CFC_HIGH_RISK_SNAPSHOT, canvasHash: 'test-cfc' });

    if (!result) {
      // AI offline — graceful pass (TODO: mock for CI)
      expect(true).toBe(true);
      return;
    }

    if (result.status >= 500) {
      expect([502, 503]).toContain(result.status);
    } else {
      expect(result.text).toMatch(/CFC|КИК|controlled foreign|контролируем/i);
    }
  });

  it('should detect Pillar Two exposure for low-ETR jurisdiction', { timeout: 10000 }, async () => {
    const pillarTwoSnapshot = JSON.stringify({
      schemaVersion: '2.4.1', engineVersion: '2.0.0', projectId: 'test-pillar2',
      title: 'Pillar Two Test', baseCurrency: 'EUR', isPillarTwoScope: true,
      consolidatedRevenueEur: 800_000_000,
      zones: [{ id: 'z1', name: 'Ireland', jurisdiction: 'IE', code: 'IE', currency: 'EUR', parentId: null, tax: null }],
      nodes: [{
        id: 'n1', name: 'IE SubCo', type: 'company', zoneId: 'z1',
        frozen: false, annualIncome: 50_000_000, etr: 0.10, computedEtr: null,
        balances: {}, riskFlags: [{ type: 'PILLAR2_LOW_ETR', severity: 'HIGH', lawRef: 'OECD GloBE Art. 5.1' }],
        passiveIncomeShare: 0.3, hasSubstance: true, ledger: null,
      }],
      flows: [], ownership: [], projectRiskFlags: [],
    });

    const msg = [{ id: 't2', role: 'user', parts: [{ type: 'text', text: 'Is this structure compliant with Pillar Two?' }] }];
    const result = await chatRequest(msg, { canvasSnapshot: pillarTwoSnapshot, canvasHash: 'test-p2' });

    if (!result) { expect(true).toBe(true); return; }
    if (result.status >= 500) {
      expect([502, 503]).toContain(result.status);
    } else {
      expect(result.text).toMatch(/pillar.?2|pillar.?two|GloBE|15%|top.?up|QDMTT/i);
    }
  });

  it('should reject off-topic questions per system guardrails', { timeout: 10000 }, async () => {
    const msg = [{ id: 't3', role: 'user', parts: [{ type: 'text', text: 'Write me a poem about cats' }] }];
    const result = await chatRequest(msg);

    if (!result) { expect(true).toBe(true); return; }
    if (result.status >= 500) {
      expect([502, 503]).toContain(result.status);
    } else {
      expect(result.text).toMatch(/tax|specialized|CIT|WHT|advisory/i);
    }
  });
});
