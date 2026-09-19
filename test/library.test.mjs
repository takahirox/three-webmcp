import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { Scene, Group, Mesh, BoxGeometry, MeshBasicMaterial, Matrix4 } from 'three';
import { exposeThreeWebMCP } from '../dist/index.js';

const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
afterEach(() => {
  if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
  else delete globalThis.document;
});

function context({ rejectName, delay } = {}) {
  const tools = new Map();
  const signals = [];
  const modelContext = {
    async registerTool(tool, { signal }) {
      if (tools.has(tool.name)) throw new Error('duplicate tool');
      if (tool.name === rejectName) throw new Error('registration denied');
      if (signal.aborted) throw signal.reason;
      tools.set(tool.name, tool);
      signals.push(signal);
      signal.addEventListener('abort', () => tools.delete(tool.name), { once: true });
      if (delay) await delay(signal);
    },
  };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { modelContext } });
  return { tools, signals, modelContext, call: (name, input = {}) => tools.get(name).execute(input) };
}

function fixture() {
  const scene = new Scene();
  scene.name = 'root';
  const parent = new Group();
  parent.position.x = 10;
  const cube = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
  cube.name = 'cube';
  parent.add(cube);
  scene.add(parent);
  return { scene, parent, cube };
}

test('SSR and unavailable WebMCP return safe, repeatable cleanup', async () => {
  for (const document of [undefined, {}, { modelContext: {} }]) {
    Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
    if (!document) delete globalThis.document;
    const dispose = exposeThreeWebMCP({ scene: new Scene() });
    assert.equal(await dispose.ready, false);
    dispose();
    dispose();
  }
});

test('inspect → identify → update → inspect with real Three.js objects', async () => {
  const api = context();
  const { scene, cube } = fixture();
  const dispose = exposeThreeWebMCP({ scene });
  assert.equal(await dispose.ready, true);
  assert.deepEqual([...api.tools.keys()], ['three.scene.inspect', 'three.object.update']);
  const before = await api.call('three.scene.inspect');
  const target = before.children[0].children[0];
  assert.equal(target.name, 'cube');
  assert.equal(target.type, 'Mesh');
  assert.equal(before.uuid, scene.uuid);
  assert.deepEqual(target.scale, { x: 1, y: 1, z: 1 });
  const updated = await api.call('three.object.update', {
    uuid: target.uuid,
    position: { x: 1, y: 2, z: 3 },
    rotation: { x: 0, y: Math.PI / 2, z: 0, order: 'ZYX' },
    scale: { x: 2, y: 3, z: 4 },
    visible: false,
  });
  const after = await api.call('three.scene.inspect');
  assert.deepEqual(after.children[0].children[0], updated);
  assert.equal(cube.position.x, 1); // Local, not world coordinates.
  assert.equal(cube.rotation.order, 'ZYX');
  assert.equal(cube.visible, false);
  assert.deepEqual(before.children[0].children[0].position, { x: 0, y: 0, z: 0 });
  await api.call('three.object.update', { uuid: cube.uuid, rotation: { x: 1, y: 0, z: 0 } });
  assert.equal(cube.rotation.order, 'ZYX');
  assert.equal(cube.position.x, 1);
  assert.equal(cube.scale.y, 3);
  assert.doesNotThrow(() => JSON.stringify(after));
  const stale = api.tools.get('three.object.update');
  dispose();
  dispose();
  assert.equal(api.tools.size, 0);
  assert.equal((await stale.execute({ uuid: cube.uuid, visible: true })).error.code, 'DISPOSED');
  assert.equal(cube.visible, false);
});

test('rejects invalid inputs atomically and limits UUID lookup to the exposed scene', async () => {
  const api = context();
  const { scene, cube } = fixture();
  const dispose = exposeThreeWebMCP({ scene });
  await dispose.ready;
  const before = await api.call('three.scene.inspect');
  const invalid = [
    null, [], {}, { uuid: cube.uuid }, { uuid: 3, visible: true },
    { uuid: cube.uuid, visible: 'false' },
    { uuid: cube.uuid, position: { x: 1, y: 2 } },
    { uuid: cube.uuid, position: { x: 1, y: 2, z: Infinity } },
    { uuid: cube.uuid, scale: { x: NaN, y: 1, z: 1 } },
    { uuid: cube.uuid, position: { x: 1, y: 2, z: 3 }, visible: null },
    { uuid: cube.uuid, rotation: { x: 0, y: 0, z: 0, order: 'bad' } },
    { uuid: cube.uuid, rotation: { x: 0, y: 0, z: 0, order: 1 } },
    { uuid: cube.uuid, visible: true, material: {} },
    { uuid: cube.uuid, scale: { x: 1, y: 1, z: 1, other: 1 } },
  ];
  for (const input of invalid) {
    const result = await api.call('three.object.update', input);
    assert.equal(result.error.code, 'INVALID_ARGUMENT', JSON.stringify(input));
    assert.deepEqual(await api.call('three.scene.inspect'), before);
  }
  const external = new Mesh();
  assert.equal((await api.call('three.object.update', { uuid: external.uuid, visible: false })).error.code, 'OBJECT_NOT_FOUND');
  assert.equal(external.visible, true);
  // Lookup follows the current graph rather than a registration-time cache.
  scene.remove(scene.children[0]);
  assert.equal((await api.call('three.object.update', { uuid: cube.uuid, visible: false })).error.code, 'OBJECT_NOT_FOUND');
  scene.add(external);
  assert.equal((await api.call('three.object.update', { uuid: external.uuid, visible: false })).visible, false);
  dispose();
});

test('transform updates refresh manual matrices; visibility alone preserves them', async () => {
  const api = context();
  const { scene, cube } = fixture();
  cube.matrixAutoUpdate = false;
  cube.matrix.makeTranslation(7, 8, 9);
  const dispose = exposeThreeWebMCP({ scene });
  await dispose.ready;
  await api.call('three.object.update', { uuid: cube.uuid, visible: false });
  assert.deepEqual(cube.matrix, new Matrix4().makeTranslation(7, 8, 9));
  await api.call('three.object.update', { uuid: cube.uuid, position: { x: 1, y: 2, z: 3 } });
  assert.deepEqual(cube.matrix, new Matrix4().makeTranslation(1, 2, 3));
  dispose();
});

test('renderer inspection returns detached live configuration and stats without rendering', async () => {
  const api = context();
  const renderer = {
    getSize: target => target.set(640, 480),
    getPixelRatio: () => 2,
    outputColorSpace: 'srgb',
    toneMapping: 0,
    info: { render: { calls: 2, triangles: 12 }, memory: { geometries: 1, textures: 2 } },
  };
  const dispose = exposeThreeWebMCP({ scene: new Scene(), renderer });
  await dispose.ready;
  const info = await api.call('three.renderer.inspect');
  assert.deepEqual(info, {
    size: { width: 640, height: 480 }, pixelRatio: 2, outputColorSpace: 'srgb', toneMapping: 0,
    calls: 2, triangles: 12, geometries: 1, textures: 2,
  });
  renderer.info.render.calls = 5;
  assert.equal(info.calls, 2);
  assert.equal((await api.call('three.renderer.inspect')).calls, 5);
  dispose();
});

test('registration failure rolls back only owned tools and is observable', async t => {
  t.mock.method(console, 'warn', () => {});
  const api = context({ rejectName: 'three.object.update' });
  api.tools.set('app.tool', {});
  const dispose = exposeThreeWebMCP({ scene: new Scene() });
  await assert.rejects(dispose.ready, /registration denied/);
  assert.deepEqual([...api.tools.keys()], ['app.tool']);
  assert.equal(console.warn.mock.callCount(), 1);
  dispose();
});

test('duplicate exposure never removes the first exposure, including partial collisions', async t => {
  t.mock.method(console, 'warn', () => {});
  const api = context();
  const first = exposeThreeWebMCP({ scene: new Scene() });
  await first.ready;
  const original = api.tools.get('three.scene.inspect');
  const second = exposeThreeWebMCP({ scene: new Scene() });
  await assert.rejects(second.ready, /duplicate/);
  second();
  assert.equal(api.tools.get('three.scene.inspect'), original);
  assert.equal(api.tools.size, 2);
  first();
  api.tools.set('three.object.update', original);
  const third = exposeThreeWebMCP({ scene: new Scene() });
  await assert.rejects(third.ready, /duplicate/);
  assert.equal(api.tools.size, 1);
  assert.equal(api.tools.get('three.object.update'), original);
});

test('cleanup during pending registration cancels work without leaking tools', async () => {
  const api = context({ delay: signal => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }) });
  const dispose = exposeThreeWebMCP({ scene: new Scene() });
  assert.equal(api.tools.size, 1);
  dispose();
  assert.equal(await dispose.ready, false);
  assert.equal(api.tools.size, 0);
  assert.ok(api.signals.every(signal => signal.aborted));
});

test('synchronous registration exceptions are handled', async t => {
  t.mock.method(console, 'warn', () => {});
  const api = context();
  api.modelContext.registerTool = () => { throw new Error('sync failure'); };
  const dispose = exposeThreeWebMCP({ scene: new Scene() });
  await assert.rejects(dispose.ready, /sync failure/);
  dispose();
});
