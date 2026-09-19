import { expect, test } from '@playwright/test';

async function ready(page) {
  await page.goto('/');
  await expect(page.locator('#model-status')).toHaveText('Robot ready');
  await expect(page.locator('#connection-status')).toHaveText('WebMCP tools ready');
}
async function call(page, name, input = {}) {
  return page.evaluate(async ({ name, input }) => {
    const context = document.modelContext;
    const tool = (await context.getTools()).find(tool => tool.name === name);
    if (!tool) throw new Error(`Missing tool: ${name}`);
    return JSON.parse(await context.executeTool(tool, JSON.stringify(input)));
  }, { name, input });
}

test('native tools control the real robot: move, arrive, wave, expression, turn, inspect', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await ready(page);
  await page.screenshot({ path: test.info().outputPath('robot-desktop.png'), fullPage: true });
  const initial = await call(page, 'robot.inspect');
  expect(initial.available.expressions).toEqual(['Angry', 'Surprised', 'Sad']);
  expect(initial.available.gestures).toContain('Wave');
  const tree = await call(page, 'three.scene.inspect');
  const root = tree.children.find(object => object.uuid === initial.uuid);
  expect(root.name).toBe('robot');
  expect(root.children.length).toBeGreaterThan(0);
  const move = await call(page, 'robot.move', { x: -2, z: 1, gait: 'Running' });
  expect(move.accepted).toBe(true);
  expect(move.state.movement.status).toBe('moving');
  await expect.poll(async () => (await call(page, 'robot.inspect')).movement.status).toBe('completed');
  expect((await call(page, 'robot.inspect')).position).toEqual({ x: -2, y: 0, z: 1 });
  await call(page, 'robot.stop');
  await call(page, 'robot.gesture', { name: 'Wave' });
  await expect(page.locator('#action-label')).toHaveText('Wave');
  await expect.poll(async () => (await call(page, 'robot.inspect')).gesture, { timeout: 10000 }).toBe(null);
  // A focused manual slider must still reflect changes made by an agent.
  await page.getByRole('slider', { name: 'Surprised' }).focus();
  await call(page, 'robot.expression', { name: 'Surprised', weight: 0.8 });
  await expect(page.getByRole('slider', { name: 'Surprised' })).toHaveValue('0.8');
  await call(page, 'robot.turn', { toward: initial.cameraPosition && { x: initial.cameraPosition.x, z: initial.cameraPosition.z } });
  const after = await call(page, 'robot.inspect');
  expect(after.headingDegrees).toBeCloseTo(Math.atan2(initial.cameraPosition.x + 2, initial.cameraPosition.z - 1) * 180 / Math.PI);
  expect(after.expressions.Surprised).toBe(0.8);
  expect(after.baseState).toBe('Idle');
  await page.getByRole('slider', { name: 'Surprised' }).press('ArrowRight');
  expect((await call(page, 'robot.inspect')).expressions.Surprised).toBe(0.81);
  expect((await call(page, 'three.renderer.inspect')).triangles).toBeGreaterThan(100);
  expect(errors).toEqual([]);
});

test('manual and agent commands share state and newer commands cancel movement/gestures', async ({ page }) => {
  await ready(page);
  await page.getByRole('button', { name: 'Dance', exact: true }).click();
  expect((await call(page, 'robot.inspect')).baseState).toBe('Dance');
  await call(page, 'robot.state', { state: 'Walking' });
  await expect(page.getByRole('button', { name: 'Walking', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#target-x').fill('5');
  await page.locator('#target-z').fill('0');
  await page.getByRole('button', { name: 'Move to destination' }).click();
  await expect.poll(async () => (await call(page, 'robot.inspect')).position.x).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  const stopped = await call(page, 'robot.inspect');
  expect(stopped.movement.status).toBe('cancelled');
  await call(page, 'robot.gesture', { name: 'Wave' });
  await call(page, 'robot.gesture', { name: 'Jump' });
  await page.getByRole('button', { name: 'Dance', exact: true }).click();
  // Wait past both cancelled clips, then ensure no old completion took over.
  await page.waitForTimeout(4500);
  const later = await call(page, 'robot.inspect');
  expect(later.baseState).toBe('Dance');
  expect(later.action.name).toBe('Dance');
  expect(later.position).toEqual(stopped.position);
  expect((await call(page, 'robot.move', { x: 99, z: 0 })).error.code).toBe('INVALID_ARGUMENT');
  expect((await call(page, 'robot.inspect')).baseState).toBe('Dance');
});

test('manual controls work without WebMCP, including mobile layout', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => Object.defineProperty(document, 'modelContext', { value: undefined }));
  await page.goto('/');
  await expect(page.locator('#model-status')).toHaveText('Robot ready');
  await expect(page.locator('#connection-status')).toContainText('Manual mode');
  await page.screenshot({ path: test.info().outputPath('robot-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Wave', exact: true }).click();
  await expect(page.locator('#action-label')).toHaveText('Wave');
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.locator('#action-label')).toHaveText('Idle');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  expect(overflow).toBe(false);
});

test('tools expose loading and model errors without enabling broken controls', async ({ page }) => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/RobotExpressive.glb', async route => { await gate; await route.abort(); });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#connection-status')).toHaveText('WebMCP tools ready');
  expect((await call(page, 'robot.inspect')).status).toBe('loading');
  expect((await call(page, 'robot.gesture', { name: 'Wave' })).error.code).toBe('MODEL_NOT_READY');
  release();
  await expect(page.locator('#model-status')).toContainText('could not be loaded');
  expect((await call(page, 'robot.inspect')).ready).toBe(false);
  expect((await call(page, 'robot.move', { x: 1, z: 0 })).error.code).toBe('MODEL_LOAD_FAILED');
  await expect(page.getByRole('button', { name: 'Move to destination' })).toBeDisabled();
  await expect(page.locator('#stop')).toBeDisabled();
});

test('registration collision rolls back both tool sets but leaves manual controls and existing tool', async ({ page }) => {
  await page.addInitScript(() => {
    void document.modelContext.registerTool({ name: 'robot.move', description: 'Existing tool', execute: async () => ({ owner: 'app' }) });
  });
  await page.goto('/');
  await expect(page.locator('#connection-status')).toHaveText('WebMCP registration failed');
  await expect(page.locator('#model-status')).toHaveText('Robot ready');
  const names = await page.evaluate(async () => (await document.modelContext.getTools()).map(tool => tool.name));
  expect(names).toEqual(['robot.move']);
  expect(await call(page, 'robot.move')).toEqual({ owner: 'app' });
  await page.getByRole('button', { name: 'Dance', exact: true }).click();
  await expect(page.locator('#action-label')).toHaveText('Dance');
});

test('page lifecycle unregisters and restores all tools without duplicates', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  expect(await page.evaluate(async () => (await document.modelContext.getTools()).length)).toBe(0);
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expect.poll(async () => page.evaluate(async () => (await document.modelContext.getTools()).length)).toBe(10);
  expect((await call(page, 'robot.inspect')).ready).toBe(true);
});
