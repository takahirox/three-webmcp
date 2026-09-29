import { expect, test } from '@playwright/test';

test('native WebMCP library tools: inspect, identify, update, inspect renderer, dispose', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const supported = await page.evaluate(() => typeof document.modelContext?.getTools === 'function');
  expect(supported, 'Chromium must support the current WebMCP API with its feature flag enabled').toBe(true);
  await expect(page.locator('#connection-status')).toHaveText('WebMCP tools ready');
  // Registration readiness does not imply that the first frame has rendered.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const result = await page.evaluate(async () => {
    const context = document.modelContext;
    const tools = await context.getTools();
    async function call(name, input = {}) {
      // Chromium 153 still takes JSON text, unlike the draft's newer any input.
      return JSON.parse(await context.executeTool(tools.find(tool => tool.name === name), JSON.stringify(input)));
    }
    const before = await call('three.scene.inspect');
    const ground = before.children.find(object => object.name === 'ground');
    const updated = await call('three.object.update', { uuid: ground.uuid, position: { x: 1, y: 0, z: 0 } });
    const after = await call('three.scene.inspect');
    const renderer = await call('three.renderer.inspect');
    dispatchEvent(new Event('pagehide'));
    return { before: ground, updated, after: after.children.find(object => object.uuid === ground.uuid), renderer, remaining: (await context.getTools()).length };
  });
  expect(result.before.position.x).toBe(0);
  expect(result.updated.position.x).toBe(1);
  expect(result.after).toEqual(result.updated);
  expect(result.renderer.size.width).toBeGreaterThan(0);
  expect(result.renderer.calls).toBeGreaterThan(0);
  expect(result.renderer.triangles).toBeGreaterThan(0);
  expect(result.remaining).toBe(0);
  expect(errors).toEqual([]);
});

test('native registration rollback preserves an existing library tool with the same name', async ({ page }) => {
  await page.addInitScript(() => {
    globalThis.existingToolReady = document.modelContext.registerTool({
      name: 'three.object.update',
      description: 'An existing application-owned tool',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => ({ owner: 'application' }),
    });
  });
  await page.goto('/');
  await expect(page.locator('#connection-status')).toHaveText('WebMCP registration failed');
  const result = await page.evaluate(async () => {
    await globalThis.existingToolReady;
    const tools = await document.modelContext.getTools();
    const existing = tools.find(tool => tool.name === 'three.object.update');
    return {
      names: tools.map(tool => tool.name),
      value: JSON.parse(await document.modelContext.executeTool(existing, '{}')),
    };
  });
  expect(result.names).toEqual(['three.object.update']);
  expect(result.value).toEqual({ owner: 'application' });
  await expect(page.locator('canvas')).toBeVisible();
});
