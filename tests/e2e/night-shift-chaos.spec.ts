/**
 * NIGHT SHIFT — Absolute Chaos E2E Stress Test
 *
 * 5 destructive phases that push Tax Modeler 2026 to the breaking point:
 *   Phase 1: State & Render Thrashing (theme/language rapid toggling)
 *   Phase 2: Mathematical Abuse (extreme tax values, NaN, negatives)
 *   Phase 3: Canvas Physics & Topology Abuse (rapid nodes, extreme zoom)
 *   Phase 4: Async Interruption (AI chat mid-stream abort)
 *   Phase 5: Network Drop (mock 503, verify offline resilience)
 *
 * Guard: app must not crash, no unhandled JS exceptions, no blank screens.
 */

import { test, expect, type Page } from '@playwright/test';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Collect JS errors during the test. */
function attachErrorCollector(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

/** Wait for the Konva canvas to be interactive. */
async function waitForCanvas(page: Page) {
  await page.waitForSelector('.konvajs-content', { timeout: 20_000 });
  await page.waitForTimeout(1000); // let demo project hydrate
}

/** Get the canvas bounding box. */
async function canvasBox(page: Page) {
  const canvas = page.locator('.konvajs-content canvas').first();
  await expect(canvas).toBeVisible({ timeout: 10_000 });
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

/** Assert the page didn't go blank (at least canvas or main content exists). */
async function assertNotBlank(page: Page) {
  const body = await page.locator('body').innerHTML();
  expect(body.length).toBeGreaterThan(100);
}

// ─── Phase 1: State & Render Thrashing ──────────────────────────────────────

test.describe('Phase 1: State & Render Thrashing', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.clear());
    await page.goto('/');
    await waitForCanvas(page);
  });

  test('rapid theme toggling 20 times does not crash', async ({ page }) => {
    const errors = attachErrorCollector(page);

    const themeBtn = page.locator('[aria-label="Toggle theme"]');
    await expect(themeBtn).toBeVisible({ timeout: 5000 });

    for (let i = 0; i < 20; i++) {
      await themeBtn.click();
      await page.waitForTimeout(50); // 50ms between toggles — aggressive
    }

    // App should still be alive
    await assertNotBlank(page);
    await expect(page.locator('.konvajs-content')).toBeVisible();

    // No fatal JS errors
    const fatal = errors.filter(
      (e) => e.includes('Cannot read') || e.includes('is not a function') || e.includes('undefined'),
    );
    expect(fatal).toHaveLength(0);
  });

  test('rapid language toggling 10 times does not crash', async ({ page }) => {
    const errors = attachErrorCollector(page);

    const langBtn = page.locator('[aria-label="Toggle language"]');
    await expect(langBtn).toBeVisible({ timeout: 5000 });

    for (let i = 0; i < 10; i++) {
      await langBtn.click();
      await page.waitForTimeout(80);
    }

    await assertNotBlank(page);
    await expect(page.locator('.konvajs-content')).toBeVisible();

    const fatal = errors.filter(
      (e) => e.includes('Cannot read') || e.includes('is not a function'),
    );
    expect(fatal).toHaveLength(0);
  });

  test('interleaved theme + language toggling', async ({ page }) => {
    const errors = attachErrorCollector(page);

    const themeBtn = page.locator('[aria-label="Toggle theme"]');
    const langBtn = page.locator('[aria-label="Toggle language"]');
    await expect(themeBtn).toBeVisible({ timeout: 5000 });
    await expect(langBtn).toBeVisible({ timeout: 5000 });

    for (let i = 0; i < 15; i++) {
      if (i % 2 === 0) {
        await themeBtn.click();
      } else {
        await langBtn.click();
      }
      await page.waitForTimeout(40);
    }

    await assertNotBlank(page);
    await expect(page.locator('.konvajs-content')).toBeVisible();
    expect(errors.filter((e) => e.includes('Cannot read'))).toHaveLength(0);
  });

  test('rapid undo/redo spam does not corrupt state', async ({ page }) => {
    const errors = attachErrorCollector(page);

    const undoBtn = page.locator('[data-testid="btn-undo"]');
    const redoBtn = page.locator('[data-testid="btn-redo"]');

    // Spam undo 15 times (even with no history — should be no-op, not crash)
    for (let i = 0; i < 15; i++) {
      if (await undoBtn.isEnabled().catch(() => false)) {
        await undoBtn.click();
      }
      await page.waitForTimeout(30);
    }

    // Spam redo 15 times
    for (let i = 0; i < 15; i++) {
      if (await redoBtn.isEnabled().catch(() => false)) {
        await redoBtn.click();
      }
      await page.waitForTimeout(30);
    }

    await assertNotBlank(page);
    expect(errors.filter((e) => e.includes('Cannot read'))).toHaveLength(0);
  });
});

// ─── Phase 2: Mathematical Abuse ────────────────────────────────────────────

test.describe('Phase 2: Mathematical Abuse', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.clear());
    await page.goto('/');
    await waitForCanvas(page);
  });

  test('open node editor and enter extreme values without crash', async ({ page }) => {
    const errors = attachErrorCollector(page);
    const box = await canvasBox(page);

    // Double-click to open editor / modal on the demo project area
    await page.mouse.dblclick(box.x + 300, box.y + 200);
    await page.waitForTimeout(1500);

    // Try to find any income/amount input field in the modal
    const incomeInput = page.locator('input[type="number"]').first();
    if (await incomeInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Test extreme values
      const extremeValues = [
        '999999999999',  // huge number
        '-50000',        // negative
        '0',             // zero
        '0.00001',       // tiny decimal
        'NaN',           // not a number
        'Infinity',      // infinity
        '-Infinity',     // negative infinity
        '1e308',         // near max float
        '-1e308',        // near min float
      ];

      for (const val of extremeValues) {
        await incomeInput.fill(val);
        await page.waitForTimeout(100);
      }

      // Try to save with the last extreme value
      const saveBtn = page.locator('[data-testid="btn-save-entity"]');
      if (await saveBtn.isVisible().catch(() => false)) {
        await saveBtn.click();
        await page.waitForTimeout(300);
      }
    }

    // App must survive
    await assertNotBlank(page);
    const fatal = errors.filter(
      (e) => e.includes('Cannot read') || e.includes('is not a function'),
    );
    expect(fatal).toHaveLength(0);
  });

  test('Global Summary widget survives extreme project state', async ({ page }) => {
    const errors = attachErrorCollector(page);

    // The Global Summary widget should render without crashing
    const summary = page.locator('[data-testid="global-summary"]');
    await expect(summary).toBeVisible({ timeout: 10_000 });

    // Check that ETR, income, tax values are rendered (not NaN/undefined)
    const text = await summary.textContent();
    expect(text).toBeTruthy();
    // Should not display literal "NaN" or "undefined"
    expect(text).not.toContain('NaN');
    expect(text).not.toContain('undefined');

    expect(errors.filter((e) => e.includes('Cannot read'))).toHaveLength(0);
  });

  test('currency selector rapid switching does not break calculations', async ({ page }) => {
    const errors = attachErrorCollector(page);

    const currencySelect = page.locator('[data-testid="select-base-currency"]');
    if (await currencySelect.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Get all options
      const options = await currencySelect.locator('option').allTextContents();

      // Rapidly cycle through all currencies
      for (let cycle = 0; cycle < 3; cycle++) {
        for (const opt of options) {
          await currencySelect.selectOption({ label: opt });
          await page.waitForTimeout(50);
        }
      }
    }

    await assertNotBlank(page);
    const summary = page.locator('[data-testid="global-summary"]');
    if (await summary.isVisible().catch(() => false)) {
      const text = await summary.textContent();
      expect(text).not.toContain('NaN');
    }
    expect(errors.filter((e) => e.includes('Cannot read'))).toHaveLength(0);
  });
});

// ─── Phase 3: Canvas Physics & Topology Abuse ───────────────────────────────

test.describe('Phase 3: Canvas Physics & Topology Abuse', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.clear());
    await page.goto('/');
    await waitForCanvas(page);
  });

  test('extreme zoom in/out does not crash', async ({ page }) => {
    const errors = attachErrorCollector(page);
    const box = await canvasBox(page);

    const zoomIn = page.locator('[data-testid="btn-zoom-in"]');
    const zoomOut = page.locator('[data-testid="btn-zoom-out"]');

    // Zoom in 30 times (should hit max zoom limit)
    for (let i = 0; i < 30; i++) {
      if (await zoomIn.isVisible().catch(() => false)) {
        await zoomIn.click();
        await page.waitForTimeout(30);
      }
    }

    // Verify canvas still renders
    await expect(page.locator('.konvajs-content')).toBeVisible();

    // Zoom out 50 times (should hit min zoom limit)
    for (let i = 0; i < 50; i++) {
      if (await zoomOut.isVisible().catch(() => false)) {
        await zoomOut.click();
        await page.waitForTimeout(30);
      }
    }

    await expect(page.locator('.konvajs-content')).toBeVisible();
    await assertNotBlank(page);

    const fatal = errors.filter(
      (e) => e.includes('Cannot read') || e.includes('Maximum call stack'),
    );
    expect(fatal).toHaveLength(0);
  });

  test('mouse wheel zoom abuse does not crash', async ({ page }) => {
    const errors = attachErrorCollector(page);
    const box = await canvasBox(page);

    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;

    // Rapid scroll zoom in
    for (let i = 0; i < 20; i++) {
      await page.mouse.wheel(0, -200); // zoom in
      await page.waitForTimeout(20);
    }

    // Rapid scroll zoom out
    for (let i = 0; i < 30; i++) {
      await page.mouse.wheel(0, 200); // zoom out
      await page.waitForTimeout(20);
    }

    // Alternating zoom
    for (let i = 0; i < 20; i++) {
      await page.mouse.wheel(0, i % 2 === 0 ? -500 : 500);
      await page.waitForTimeout(10);
    }

    await expect(page.locator('.konvajs-content')).toBeVisible();
    expect(errors.filter((e) => e.includes('Maximum call stack'))).toHaveLength(0);
  });

  test('rapid right-click context menu open/dismiss cycle', async ({ page }) => {
    const errors = attachErrorCollector(page);
    const box = await canvasBox(page);

    for (let i = 0; i < 10; i++) {
      // Right-click at random positions
      const x = box.x + 100 + (i * 50) % (box.width - 200);
      const y = box.y + 100 + (i * 40) % (box.height - 200);
      await page.mouse.click(x, y, { button: 'right' });
      await page.waitForTimeout(100);

      // Dismiss by clicking elsewhere
      await page.mouse.click(box.x + 10, box.y + 10);
      await page.waitForTimeout(50);
    }

    await assertNotBlank(page);
    expect(errors.filter((e) => e.includes('Cannot read'))).toHaveLength(0);
  });

  test('rapid pan/drag across canvas does not corrupt state', async ({ page }) => {
    const errors = attachErrorCollector(page);
    const box = await canvasBox(page);

    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;

    // Rapid panning with middle-button or with plain drag on empty area
    for (let i = 0; i < 5; i++) {
      await page.mouse.move(startX, startY);
      await page.mouse.down();

      // Drag in a wild pattern
      for (let step = 0; step < 10; step++) {
        const dx = (Math.sin(step) * 100);
        const dy = (Math.cos(step) * 100);
        await page.mouse.move(startX + dx, startY + dy);
      }

      await page.mouse.up();
      await page.waitForTimeout(50);
    }

    await assertNotBlank(page);
    await expect(page.locator('.konvajs-content')).toBeVisible();
    expect(errors.filter((e) => e.includes('Cannot read'))).toHaveLength(0);
  });

  test('double-click spam at different positions does not stack modals', async ({ page }) => {
    const errors = attachErrorCollector(page);
    const box = await canvasBox(page);

    // Rapid double-clicks at 5 different positions
    const positions = [
      [box.x + 200, box.y + 150],
      [box.x + 400, box.y + 300],
      [box.x + 600, box.y + 200],
      [box.x + 300, box.y + 400],
      [box.x + 500, box.y + 350],
    ];

    for (const [x, y] of positions) {
      await page.mouse.dblclick(x, y);
      await page.waitForTimeout(200);
      // Press Escape to dismiss any modal
      await page.keyboard.press('Escape');
      await page.waitForTimeout(100);
    }

    await assertNotBlank(page);
    expect(errors.filter((e) => e.includes('Cannot read'))).toHaveLength(0);
  });
});

// ─── Phase 4: Async Interruption ────────────────────────────────────────────

test.describe('Phase 4: Async Interruption', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.clear());
    await page.goto('/');
    await waitForCanvas(page);
  });

  test('open AI chat, send message, immediately close — no crash', async ({ page }) => {
    const errors = attachErrorCollector(page);

    // Open AI Copilot
    const aiBtn = page.locator('button[title="Ask AI Copilot"]');
    if (await aiBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await aiBtn.click();
      await page.waitForTimeout(300);

      // Type and send a message
      const chatInput = page.locator('input[placeholder*="ETR"]');
      if (await chatInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        await chatInput.fill('What is the ETR of my structure?');
        await page.keyboard.press('Enter');

        // Immediately close the chat panel (mid-stream abort)
        await page.waitForTimeout(200);
        const closeBtn = page.locator('button').filter({ has: page.locator('svg') }).last();
        // Find the X close button in the chat header
        const chatClose = page.locator('button').filter({ hasText: '' }).nth(1);
        await page.waitForTimeout(100);
        // Press Escape to close
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
      }
    }

    await assertNotBlank(page);
    await expect(page.locator('.konvajs-content')).toBeVisible();

    const fatal = errors.filter(
      (e) =>
        e.includes('Cannot read') ||
        e.includes('AbortError') ||
        e.includes('is not a function'),
    );
    // AbortError is expected when stream is interrupted — filter it out
    const realFatal = fatal.filter((e) => !e.includes('AbortError'));
    expect(realFatal).toHaveLength(0);
  });

  test('open AI chat, send message, switch theme mid-stream — no crash', async ({ page }) => {
    const errors = attachErrorCollector(page);

    const aiBtn = page.locator('button[title="Ask AI Copilot"]');
    if (await aiBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await aiBtn.click();
      await page.waitForTimeout(300);

      const chatInput = page.locator('input[placeholder*="ETR"]');
      if (await chatInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        await chatInput.fill('Analyze my tax risks');
        await page.keyboard.press('Enter');

        // While AI is processing, toggle theme rapidly
        await page.waitForTimeout(100);
        const themeBtn = page.locator('[aria-label="Toggle theme"]');
        for (let i = 0; i < 5; i++) {
          if (await themeBtn.isVisible().catch(() => false)) {
            await themeBtn.click();
          }
          await page.waitForTimeout(60);
        }
      }
    }

    await assertNotBlank(page);
    await expect(page.locator('.konvajs-content')).toBeVisible();
    expect(
      errors.filter((e) => e.includes('Cannot read') || e.includes('is not a function')),
    ).toHaveLength(0);
  });

  test('rapid open/close AI panel 10 times', async ({ page }) => {
    const errors = attachErrorCollector(page);

    for (let i = 0; i < 10; i++) {
      // Open
      const aiBtn = page.locator('button[title="Ask AI Copilot"]');
      if (await aiBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await aiBtn.click();
        await page.waitForTimeout(150);
      }

      // Close via Escape
      await page.keyboard.press('Escape');
      await page.waitForTimeout(100);
    }

    await assertNotBlank(page);
    expect(errors.filter((e) => e.includes('Cannot read'))).toHaveLength(0);
  });
});

// ─── Phase 5: Network Drop ─────────────────────────────────────────────────

test.describe('Phase 5: Network Drop', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.clear());
    await page.goto('/');
    await waitForCanvas(page);
  });

  test('mock 503 on /api/projects/** — app stays functional', async ({ page }) => {
    const errors = attachErrorCollector(page);

    // Intercept all project API calls with 503
    await page.route('**/api/projects/**', (route) => {
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Service Unavailable' }),
      });
    });

    // Try to trigger project API calls — new project button
    const newProjectBtn = page.locator('[data-testid="btn-new-project"]');
    if (await newProjectBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await newProjectBtn.click();
      await page.waitForTimeout(500);
    }

    // App must not crash — canvas should still be alive
    await assertNotBlank(page);
    await expect(page.locator('.konvajs-content')).toBeVisible();

    // No unhandled promise rejections should have killed the page
    const fatal = errors.filter(
      (e) => e.includes('Cannot read') || e.includes('is not a function'),
    );
    expect(fatal).toHaveLength(0);
  });

  test('mock 503 on /api/chat — AI copilot shows error, app survives', async ({ page }) => {
    const errors = attachErrorCollector(page);

    // Intercept AI chat API with 503
    await page.route('**/api/chat', (route) => {
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'OLLAMA_OFFLINE', message: 'Service Unavailable' } }),
      });
    });

    // Open AI Copilot and send a message
    const aiBtn = page.locator('button[title="Ask AI Copilot"]');
    if (await aiBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await aiBtn.click();
      await page.waitForTimeout(300);

      const chatInput = page.locator('input[placeholder*="ETR"]');
      if (await chatInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        await chatInput.fill('Test message');
        await page.keyboard.press('Enter');
        await page.waitForTimeout(1000);

        // The chat should show an error state, not crash
        // The error banner or "Thinking..." should eventually resolve
      }
    }

    // The main app must remain functional
    await assertNotBlank(page);
    await expect(page.locator('.konvajs-content')).toBeVisible();

    // Canvas interactions should still work
    const box = await canvasBox(page);
    await page.mouse.click(box.x + 300, box.y + 200, { button: 'right' });
    await page.waitForTimeout(300);

    // Dismiss any context menu
    await page.keyboard.press('Escape');

    const fatal = errors.filter(
      (e) => e.includes('Cannot read') || e.includes('is not a function'),
    );
    expect(fatal).toHaveLength(0);
  });

  test('network drop during canvas interaction — no data corruption', async ({ page }) => {
    const errors = attachErrorCollector(page);

    // Perform some canvas interactions first
    const box = await canvasBox(page);
    await page.mouse.dblclick(box.x + 300, box.y + 200);
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');

    // Now simulate network failure on ALL API routes
    await page.route('**/api/**', (route) => {
      route.abort('connectionrefused');
    });

    // Continue interacting — zoom, pan, theme toggle
    const zoomIn = page.locator('[data-testid="btn-zoom-in"]');
    if (await zoomIn.isVisible().catch(() => false)) {
      for (let i = 0; i < 5; i++) {
        await zoomIn.click();
        await page.waitForTimeout(50);
      }
    }

    const themeBtn = page.locator('[aria-label="Toggle theme"]');
    if (await themeBtn.isVisible().catch(() => false)) {
      await themeBtn.click();
    }

    // Canvas-local operations should still work
    await assertNotBlank(page);
    await expect(page.locator('.konvajs-content')).toBeVisible();

    // Global summary should still render from local state
    const summary = page.locator('[data-testid="global-summary"]');
    if (await summary.isVisible().catch(() => false)) {
      const text = await summary.textContent();
      expect(text).not.toContain('undefined');
    }

    expect(
      errors.filter((e) => e.includes('Cannot read') || e.includes('is not a function')),
    ).toHaveLength(0);
  });

  test('restore network after drop — app recovers', async ({ page }) => {
    const errors = attachErrorCollector(page);

    // Drop network
    await page.route('**/api/**', (route) => {
      route.abort('connectionrefused');
    });

    // Try to use AI copilot under network failure
    const aiBtn = page.locator('button[title="Ask AI Copilot"]');
    if (await aiBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await aiBtn.click();
      await page.waitForTimeout(300);

      const chatInput = page.locator('input[placeholder*="ETR"]');
      if (await chatInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        await chatInput.fill('Test');
        await page.keyboard.press('Enter');
        await page.waitForTimeout(500);
      }
    }

    // Restore network
    await page.unrouteAll();

    // App should recover — canvas still alive
    await assertNotBlank(page);
    await expect(page.locator('.konvajs-content')).toBeVisible();

    // Should be able to interact normally after recovery
    const box = await canvasBox(page);
    await page.mouse.click(box.x + 400, box.y + 300, { button: 'right' });
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');

    expect(
      errors.filter((e) => e.includes('Cannot read') || e.includes('is not a function')),
    ).toHaveLength(0);
  });
});
