import { test, expect } from '@playwright/test';

test.describe('Tax-Modeler Canvas E2E Smoke Test', () => {

  test.beforeEach(async ({ page }) => {
    // Clear localStorage so every test starts from a clean slate
    await page.addInitScript(() => window.localStorage.clear());
    await page.goto('/');
  });

  test('should create nodes, connect them with ownership + flow, and cascade-delete', async ({ page }) => {
    // ── 1. Create two company nodes ─────────────────────────────────────────
    const addBtn = page.getByTestId('btn-add-company');
    await addBtn.click();
    await addBtn.click();

    const nodes = page.getByTestId('canvas-node');
    await expect(nodes).toHaveCount(2);

    const holdingNode = nodes.nth(0);
    const opcoNode = nodes.nth(1);

    // ── 2. Edit the first node name ─────────────────────────────────────────
    await holdingNode.click();
    // The sidebar should appear with "Edit Node" header
    await expect(page.locator('text=Edit Node')).toBeVisible();
    await page.getByLabel(/Name/i).fill('Holding UAE');

    // Close sidebar by clicking canvas background
    await page.locator('#viewport').click({ position: { x: 10, y: 10 } });

    // ── 3. Spread nodes apart via drag-and-drop ─────────────────────────────
    // Drag holdingNode to upper area
    const holdingBox = await holdingNode.boundingBox();
    if (holdingBox) {
      await page.mouse.move(holdingBox.x + holdingBox.width / 2, holdingBox.y + holdingBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(300, 200, { steps: 5 });
      await page.mouse.up();
    }

    // Drag opcoNode to lower area
    // Re-query after possible re-render
    const opcoBox = await opcoNode.boundingBox();
    if (opcoBox) {
      await page.mouse.move(opcoBox.x + opcoBox.width / 2, opcoBox.y + opcoBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(300, 450, { steps: 5 });
      await page.mouse.up();
    }

    // ── 4. Create ownership link (purple port on Holding → OpCo) ────────────
    const holdingOwnershipPort = holdingNode.getByTestId('port-ownership');
    const holdingPortBox = await holdingOwnershipPort.boundingBox();

    if (holdingPortBox) {
      await page.mouse.move(
        holdingPortBox.x + holdingPortBox.width / 2,
        holdingPortBox.y + holdingPortBox.height / 2,
      );
      await page.mouse.down();

      // Move toward opcoNode center and release
      const targetBox = await opcoNode.boundingBox();
      if (targetBox) {
        await page.mouse.move(
          targetBox.x + targetBox.width / 2,
          targetBox.y + targetBox.height / 2,
          { steps: 5 },
        );
      }
      await page.mouse.up();
    }

    // Verify the dashed purple ownership line appeared
    const ownershipEdge = page.locator('path[stroke-dasharray="5 5"]');
    await expect(ownershipEdge).toBeVisible();

    // ── 5. Create a financial flow (blue port on OpCo → Holding) ────────────
    const opcoFlowPort = opcoNode.getByTestId('port-flow');
    const flowPortBox = await opcoFlowPort.boundingBox();

    if (flowPortBox) {
      await page.mouse.move(
        flowPortBox.x + flowPortBox.width / 2,
        flowPortBox.y + flowPortBox.height / 2,
      );
      await page.mouse.down();

      const holdingTarget = await holdingNode.boundingBox();
      if (holdingTarget) {
        await page.mouse.move(
          holdingTarget.x + holdingTarget.width / 2,
          holdingTarget.y + holdingTarget.height / 2,
          { steps: 5 },
        );
      }
      await page.mouse.up();
    }

    // Verify flow edge appeared (uses CSS variable --stroke fallback #94a3b8)
    // We look for any <path> inside the arrows-layer that is NOT dashed (flow lines are solid)
    const flowEdge = page.locator('#arrows-layer g path:not([stroke-dasharray])').first();
    await expect(flowEdge).toBeVisible();

    // ── 6. Edit ownership percent via sidebar ───────────────────────────────
    // Click on the ownership dashed line (using the transparent hit-area)
    await ownershipEdge.click({ force: true });
    await expect(page.locator('text=Edit Ownership')).toBeVisible();

    // The percent input should default to 100
    const percentInput = page.getByLabel(/Ownership/i);
    await expect(percentInput).toHaveValue('100');

    // Change to 50%
    await percentInput.fill('50');

    // The badge on canvas should update to "50%"
    await expect(page.locator('text=50%')).toBeVisible();

    // ── 7. Edit node income and check CIT badge ─────────────────────────────
    await opcoNode.click();
    await expect(page.locator('text=Edit Node')).toBeVisible();

    const incomeInput = page.getByLabel(/Annual Income/i);
    await incomeInput.fill('100000');

    // CIT badge should appear (text matching "CIT:")
    const citBadge = opcoNode.locator('text=/CIT:/');
    await expect(citBadge).toBeVisible({ timeout: 5000 });

    // ── 8. Cascade delete — remove OpCo, expect edges to disappear ──────────
    // OpCo should still be selected from step 7
    await page.getByTestId('btn-delete-entity').click();

    // Only one node should remain
    await expect(nodes).toHaveCount(1);

    // Both edges should be gone (cascade)
    await expect(ownershipEdge).not.toBeVisible();
    await expect(flowEdge).not.toBeVisible();
  });
});
