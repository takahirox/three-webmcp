import { expect, test } from '@playwright/test';

test('native WebMCP: inspect, identify, update, inspect renderer, dispose', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const supported = await page.evaluate(() => typeof document.modelContext?.getTools === 'function');
  expect(supported, 'Chromium must support the current WebMCP API with its feature flag enabled').toBe(true);
  await expect(page.locator('#status')).toContainText('Ready:');
  const result = await page.evaluate(async () => {
    const context = document.modelContext;
    const tools = await context.getTools();
    async function call(name, input = {}) {
      // Chromium 153 still takes JSON text, unlike the draft's newer any input.
      return JSON.parse(await context.executeTool(tools.find(tool => tool.name === name), JSON.stringify(input)));
    }
    const before = await call('three.scene.inspect');
    const cube = before.children.find(object => object.name === 'demo-cube');
    const updated = await call('three.object.update', { uuid: cube.uuid, position: { x: 1, y: 0, z: 0 } });
    const after = await call('three.scene.inspect');
    const renderer = await call('three.renderer.inspect');
    dispatchEvent(new Event('pagehide'));
    return { before: cube, updated, after: after.children.find(object => object.uuid === cube.uuid), renderer, remaining: (await context.getTools()).length };
  });
  expect(result.before.position.x).toBe(0);
  expect(result.updated.position.x).toBe(1);
  expect(result.after).toEqual(result.updated);
  expect(result.renderer.size.width).toBeGreaterThan(0);
  expect(result.renderer.calls).toBeGreaterThan(0);
  expect(result.renderer.triangles).toBe(12);
  expect(result.remaining).toBe(0);
  expect(errors).toEqual([]);
});

test('unsupported browsers still render the example', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(document, 'modelContext', { value: undefined }));
  await page.goto('/');
  await expect(page.locator('#status')).toContainText('WebMCP is unavailable');
  await expect(page.locator('canvas')).toBeVisible();
});
