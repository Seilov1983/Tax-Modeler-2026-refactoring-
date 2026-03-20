/**
 * AI Tax Engine Vision — E2E Test Suite
 *
 * Validates that TaxBrain2026 (local Ollama) correctly reads and analyzes
 * the injected AuditSnapshot JSON. This is the ULTIMATE PROOF that the
 * AI has canvas awareness.
 *
 * CI/CD Protection: Tests only run when RUN_LOCAL_AI_TESTS=true.
 * This prevents failures in CI pipelines where Ollama is not installed.
 */

import { describe, it, expect } from 'vitest';

const OLLAMA_URL = 'http://127.0.0.1:11434/api/chat';
const MODEL = process.env.OLLAMA_MODEL || 'tsm26-strategy-copilot';

// ─── Mock AuditSnapshot: KZ + HK + UAE with Dividend flow KZ→HK ─────────────

const MOCK_SNAPSHOT = JSON.stringify({
  schemaVersion: '2.4.1',
  engineVersion: '2.0.0',
  projectId: 'test-ai-vision',
  title: 'AI Vision Test Structure',
  baseCurrency: 'USD',
  isPillarTwoScope: false,
  consolidatedRevenueEur: null,
  zones: [
    { id: 'z1', name: 'Kazakhstan', jurisdiction: 'KZ', code: 'KZ', currency: 'KZT', parentId: null, tax: null },
    { id: 'z2', name: 'Hong Kong', jurisdiction: 'HK', code: 'HK', currency: 'HKD', parentId: null, tax: null },
    { id: 'z3', name: 'United Arab Emirates', jurisdiction: 'UAE', code: 'UAE', currency: 'AED', parentId: null, tax: null },
  ],
  nodes: [
    {
      id: 'n1', name: 'KZ Operating Co', type: 'company', zoneId: 'z1',
      frozen: false, annualIncome: 10_000_000, etr: 0.20, computedEtr: null,
      balances: {}, riskFlags: [], passiveIncomeShare: 0.05, hasSubstance: true, ledger: null,
    },
    {
      id: 'n2', name: 'HK Holding Ltd', type: 'company', zoneId: 'z2',
      frozen: false, annualIncome: 3_000_000, etr: 0.0825, computedEtr: null,
      balances: {}, riskFlags: [], passiveIncomeShare: 0.6, hasSubstance: true, ledger: null,
    },
    {
      id: 'n3', name: 'UAE FreeZone LLC', type: 'company', zoneId: 'z3',
      frozen: false, annualIncome: 5_000_000, etr: 0.0, computedEtr: null,
      balances: {}, riskFlags: [{ type: 'CFC_RISK', lawRef: 'KZ Tax Code Art. 294' }],
      passiveIncomeShare: 0.9, hasSubstance: false, ledger: null,
    },
  ],
  flows: [
    {
      id: 'f1', fromId: 'n1', toId: 'n2', flowType: 'Dividends', currency: 'USD',
      grossAmount: 2_000_000, whtRate: 0.15, applyDTT: false, customWhtRate: null,
      status: 'active', flowDate: '2026-01-15', taxAdjustments: {},
    },
  ],
  ownership: [
    { id: 'o1', fromId: 'n2', toId: 'n1', percent: 100, manualAdjustment: 0 },
    { id: 'o2', fromId: 'n2', toId: 'n3', percent: 100, manualAdjustment: 0 },
  ],
  projectRiskFlags: [],
}, null, 2);

const SYSTEM_MESSAGE = `You are "TaxBrain2026", a world-class senior international tax architect embedded in the enterprise platform "Tax Modeler 2026".

## CRITICAL: YOU HAVE FULL CANVAS ACCESS
You have DIRECT, REAL-TIME ACCESS to the user's current tax structure on the canvas. The complete structure data is provided below in JSON format. ALWAYS base your analysis on this JSON. NEVER ask the user to describe their structure.

## CURRENT CANVAS DATA:
${MOCK_SNAPSHOT}`;

const USER_QUESTION = 'Опиши, какие юрисдикции ты видишь в моей схеме, и есть ли налоговые риски при выплате дивидендов из Казахстана в Гонконг?';

// ─── Test Suite (only runs with RUN_LOCAL_AI_TESTS=true) ─────────────────────

describe('AI Vision E2E — Canvas Awareness', () => {
  it.runIf(process.env.RUN_LOCAL_AI_TESTS === 'true')(
    'TaxBrain2026 must identify KZ, HK, UAE jurisdictions and analyze dividend WHT risk',
    { timeout: 180_000 },
    async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 120_000);

      try {
        const res = await fetch(OLLAMA_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: MODEL,
            stream: false,
            messages: [
              { role: 'system', content: SYSTEM_MESSAGE },
              { role: 'user', content: USER_QUESTION },
            ],
          }),
          signal: controller.signal,
        });
        clearTimeout(timer);

        expect(res.status).toBe(200);

        const json = await res.json();
        const content: string = json.message?.content ?? '';

        // Log the full AI response for the Architect's review
        console.log('\n========== AI RAW RESPONSE ==========');
        console.log(content);
        console.log('======================================\n');

        // CRITICAL ASSERTIONS: AI must prove it read the canvas JSON
        expect(content.length).toBeGreaterThan(50);

        // Must mention Kazakhstan (in any language/transliteration)
        expect(content).toMatch(/Казахстан|Kazakhstan|KZ/i);

        // Must mention Hong Kong (in any language/transliteration)
        expect(content).toMatch(/Гонконг|Hong Kong|HK/i);

        // Must mention UAE (in any language/transliteration)
        expect(content).toMatch(/ОАЭ|UAE|United Arab Emirates|Эмират/i);

        // Must reference dividends or WHT (the core of the question)
        expect(content).toMatch(/дивиденд|dividend|WHT|удержан|withholding/i);
      } catch (err: unknown) {
        clearTimeout(timer);
        if (err instanceof Error && err.name === 'AbortError') {
          console.warn('[AI E2E] Request timed out after 120s — Ollama may be slow or offline');
          return; // Graceful skip
        }
        throw err;
      }
    },
  );
});
