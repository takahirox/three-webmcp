import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RobotController } from '../examples/robot/controller.js';
import { robotTools, registerRobotTools } from '../examples/robot/tools.js';

const bytes = await readFile(new URL('../examples/public/models/RobotExpressive/RobotExpressive.glb', import.meta.url));
async function fixture(t) {
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const robot = new RobotController(gltf.scene, gltf.animations);
  t.after(() => robot.dispose());
  return robot;
}
function tick(robot, seconds) { for (let t = 0; t < seconds; t += 0.05) robot.update(0.05); }

test('actual robot asset exposes supported clips, expressions, and detached snapshots', async t => {
  const robot = await fixture(t);
  const state = robot.inspect();
  assert.equal(state.baseState, 'Idle');
  assert.ok(state.available.states.includes('Dance'));
  assert.ok(state.available.gestures.includes('Wave'));
  assert.deepEqual(state.available.expressions, ['Angry', 'Surprised', 'Sad']);
  state.available.states.length = 0;
  state.position.x = 999;
  state.expressions.Angry = 1;
  assert.equal(robot.inspect().position.x, 0);
  assert.equal(robot.inspect().expressions.Angry, 0);
  assert.equal(robot.inspect().available.states.length, 7);
});

test('gesture returns to the intended base state and obsolete completion cannot restore old state', async t => {
  const robot = await fixture(t);
  robot.command('state', { state: 'Dance' });
  robot.command('gesture', { name: 'Wave' });
  tick(robot, 6);
  assert.equal(robot.inspect().action.name, 'Dance');
  assert.equal(robot.inspect().gesture, null);
  robot.command('gesture', { name: 'Jump' });
  tick(robot, 0.1);
  robot.command('state', { state: 'Running' });
  tick(robot, 6);
  assert.equal(robot.inspect().action.name, 'Running');
  assert.equal(robot.inspect().baseState, 'Running');
});

test('rapid and repeated gestures retire old actions and keep exactly one finish listener', async t => {
  const robot = await fixture(t);
  for (let i = 0; i < 30; i++) {
    robot.command('gesture', { name: i % 3 === 0 ? 'Wave' : 'Jump' });
    robot.update(0.03);
  }
  assert.equal(robot.mixer._listeners.finished.length, 1);
  tick(robot, 6);
  assert.equal(robot.inspect().action.name, 'Idle');
  assert.equal(robot.retiring.size, 0);
  assert.equal([...robot.actions.values()].filter(action => action.isScheduled()).length, 1);
});

test('one-shot base states hold their final pose', async t => {
  const robot = await fixture(t);
  for (const state of ['Death', 'Sitting', 'Standing']) {
    robot.command('state', { state });
    tick(robot, 5);
    assert.deepEqual(robot.inspect().action, { name: state, status: 'held' });
    assert.equal(robot.active.paused, true);
  }
});

test('movement travels on XZ, faces its target, and arrives exactly without overshoot', async t => {
  const robot = await fixture(t);
  const accepted = robot.command('move', { x: 3, z: 4 });
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.state.movement.status, 'moving');
  robot.update(0.5);
  assert.ok(Math.abs(robot.root.position.x - 0.6) < 1e-8);
  assert.ok(Math.abs(robot.root.position.z - 0.8) < 1e-8);
  assert.ok(Math.abs(robot.root.rotation.y - Math.atan2(3, 4)) < 1e-8);
  tick(robot, 3);
  assert.deepEqual(robot.inspect().position, { x: 3, y: 0, z: 4 });
  assert.equal(robot.inspect().movement.status, 'completed');
  assert.equal(robot.inspect().baseState, 'Idle');
  const instant = robot.command('move', { x: 3, z: 4 });
  assert.equal(instant.state.movement.status, 'completed');
});

test('new movement supersedes old travel; stop and gesture cancel it without later drift', async t => {
  const robot = await fixture(t);
  robot.command('move', { x: 6, z: 0 });
  robot.update(0.25);
  const first = robot.inspect().movement.id;
  robot.command('move', { x: -2, z: 0, gait: 'Running' });
  tick(robot, 1);
  assert.equal(robot.inspect().position.x, -2);
  assert.equal(robot.inspect().movement.id, first + 1);
  robot.command('move', { x: 6, z: 0 });
  robot.update(0.25);
  robot.command('stop');
  const stopped = robot.inspect().position;
  tick(robot, 8);
  assert.deepEqual(robot.inspect().position, stopped);
  assert.equal(robot.inspect().movement.status, 'cancelled');
  robot.command('move', { x: 6, z: 0 });
  robot.command('gesture', { name: 'Wave' });
  tick(robot, 6);
  assert.deepEqual(robot.inspect().position, stopped);
  assert.equal(robot.inspect().baseState, 'Idle');
  assert.equal(robot.inspect().gesture, null);
});

test('turn stops travel and can face either a heading or a world target', async t => {
  const robot = await fixture(t);
  robot.command('move', { x: 6, z: 0 });
  robot.command('turn', { headingDegrees: -90 });
  tick(robot, 1);
  assert.equal(robot.inspect().headingDegrees, -90);
  assert.equal(robot.inspect().position.x, 0);
  robot.command('turn', { toward: { x: 10, z: 0 } });
  assert.equal(robot.inspect().headingDegrees, 90);
});

test('expressions affect actual morph targets and survive animation changes', async t => {
  const robot = await fixture(t);
  robot.command('expression', { name: 'Angry', weight: 0.7 });
  robot.command('gesture', { name: 'Wave' });
  tick(robot, 2);
  for (const { object, index } of robot.expressions.get('Angry').bindings) assert.equal(object.morphTargetInfluences[index], 0.7);
  assert.equal(robot.inspect().expressions.Angry, 0.7);
  assert.equal(robot.inspect().expressions.Sad, 0);
});

test('invalid commands preserve movement, animation, and expressions atomically', async t => {
  const robot = await fixture(t);
  robot.command('move', { x: 5, z: 4 });
  const before = robot.inspect();
  const invalid = [
    ['move', { x: NaN, z: 0 }], ['move', { x: 0, z: Infinity }], ['move', { x: 7, z: 0 }],
    ['move', { x: 0, z: 0, gait: 'Flying' }], ['move', { x: 0 }], ['move', { x: 0, z: 0, unexpected: 1 }],
    ['state', { state: 'Unknown' }], ['gesture', { name: 'WalkJump' }],
    ['expression', { name: 'Sad', weight: 2 }], ['expression', { name: 'Unknown', weight: 0 }],
    ['turn', {}], ['turn', { headingDegrees: Infinity }], ['turn', { toward: { x: 0, z: 0 } }],
    ['turn', { headingDegrees: 0, toward: { x: 1, z: 1 } }], ['turn', { toward: { x: 2 } }],
    ['stop', { extra: true }], ['gesture', null], ['state', []],
  ];
  for (const [operation, input] of invalid) {
    assert.throws(() => robot.command(operation, input), error => error.code === 'INVALID_ARGUMENT');
    assert.deepEqual(robot.inspect(), before, JSON.stringify([operation, input]));
  }
});

test('disposal is idempotent and stops animation, movement, and commands', async t => {
  const robot = await fixture(t);
  robot.command('move', { x: 5, z: 0 });
  robot.dispose(); robot.dispose();
  robot.update(4);
  assert.equal(robot.inspect().ready, false);
  assert.equal(robot.inspect().position.x, 0);
  assert.equal(robot.mixer._listeners.finished.length, 0);
  assert.throws(() => robot.command('stop'), error => error.code === 'DISPOSED');
});

test('WebMCP descriptors report loading/error and delegate to the same controller', async t => {
  let robot;
  let load = { status: 'loading', message: 'Loading robot' };
  const descriptors = robotTools(() => robot, () => load);
  const call = (name, input = {}) => descriptors.find(tool => tool.name === `robot.${name}`).execute(input);
  assert.equal((await call('inspect')).ready, false);
  assert.equal((await call('move', { x: 1, z: 0 })).error.code, 'MODEL_NOT_READY');
  load = { status: 'error', message: 'Failed to load' };
  assert.equal((await call('gesture', { name: 'Wave' })).error.code, 'MODEL_LOAD_FAILED');
  robot = await fixture(t);
  await call('state', { state: 'Dance' });
  assert.equal(robot.inspect().baseState, 'Dance');
  assert.equal((await call('move', { x: '1', z: 0 })).error.code, 'INVALID_ARGUMENT');
  assert.equal((await call('inspect', { extra: true })).error.code, 'INVALID_ARGUMENT');
  assert.equal(descriptors.filter(tool => tool.annotations.readOnlyHint).length, 1);
});

function context(failAt) {
  const registered = new Map();
  return { registered, async registerTool(tool, { signal }) {
    if (registered.has(tool.name) || tool.name === failAt) throw new Error('Name collision');
    if (signal.aborted) throw signal.reason;
    registered.set(tool.name, tool);
    signal.addEventListener('abort', () => registered.delete(tool.name), { once: true });
  } };
}

test('robot registration rolls back owned tools without removing a colliding tool', async () => {
  const ctx = context();
  ctx.registered.set('robot.move', { owner: 'app' });
  const tools = robotTools(() => null, () => ({ status: 'loading' }));
  const dispose = registerRobotTools(ctx, tools);
  await assert.rejects(dispose.ready, /collision/);
  assert.deepEqual([...ctx.registered.keys()], ['robot.move']);
  dispose();
  assert.equal(ctx.registered.get('robot.move').owner, 'app');
});

test('robot registration supports unsupported browsers and disposal during registration', async () => {
  const tools = robotTools(() => null, () => ({ status: 'loading' }));
  const unavailable = registerRobotTools(undefined, tools);
  assert.equal(await unavailable.ready, false);
  unavailable();
  const ctx = context();
  const dispose = registerRobotTools(ctx, tools);
  const stale = ctx.registered.get('robot.inspect');
  dispose();
  assert.equal(await dispose.ready, false);
  assert.equal(ctx.registered.size, 0);
  assert.equal((await stale.execute({})).error.code, 'DISPOSED');
  const next = registerRobotTools(ctx, tools);
  assert.equal(await next.ready, true);
  assert.equal(ctx.registered.size, 7);
  next(); next();
  assert.equal(ctx.registered.size, 0);
});
