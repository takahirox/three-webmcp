import { AnimationMixer, Group, LoopOnce, LoopRepeat, MathUtils } from 'three';

export const STATES = ['Idle', 'Walking', 'Running', 'Dance', 'Death', 'Sitting', 'Standing'];
export const GESTURES = ['Jump', 'Yes', 'No', 'Wave', 'Punch', 'ThumbsUp'];
export const LIMIT = 6;
const HELD_STATES = new Set(['Death', 'Sitting', 'Standing']);
const SPEEDS = { Walking: 2, Running: 4 };
const BLEND = 0.22;

export class CommandError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
export function invalid(message) { throw new CommandError('INVALID_ARGUMENT', message); }
export function fields(input, allowed, required = allowed) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some(key => !allowed.includes(key))
    || required.some(key => !Object.hasOwn(input, key))) invalid(`Expected fields: ${allowed.join(', ') || 'none'}.`);
}
function finite(value, min, max, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    invalid(`${label} must be a finite number between ${min} and ${max}.`);
  }
}

/** Demo-owned character behavior; no browser or WebMCP dependency. */
export class RobotController {
  constructor(model, clips) {
    this.root = new Group();
    this.root.name = 'robot';
    this.root.add(model);
    this.model = model;
    this.mixer = new AnimationMixer(model);
    this.actions = new Map(clips.map(clip => [clip.name, this.mixer.clipAction(clip)]));
    this.states = STATES.filter(name => this.actions.has(name));
    this.gestures = GESTURES.filter(name => this.actions.has(name));
    for (const name of ['Idle', 'Walking', 'Running']) {
      if (!this.actions.has(name)) throw new Error(`Robot model is missing ${name}.`);
    }
    this.expressions = new Map();
    model.traverse(object => {
      for (const [name, index] of Object.entries(object.morphTargetDictionary ?? {})) {
        if (!object.morphTargetInfluences) continue;
        if (!this.expressions.has(name)) this.expressions.set(name, { weight: 0, bindings: [] });
        this.expressions.get(name).bindings.push({ object, index });
      }
    });
    this.baseState = 'Idle';
    this.gesture = null;
    this.actionStatus = 'looping';
    this.movement = { id: 0, status: 'idle', target: null, gait: null };
    this.retiring = new Map();
    this.disposed = false;
    // One lifetime listener; an old fading action must never restore stale state.
    this.onFinished = ({ action }) => {
      if (action !== this.active) return;
      if (this.gesture) {
        this.gesture = null;
        this.play(this.baseState);
      } else {
        this.actionStatus = 'held';
      }
    };
    this.mixer.addEventListener('finished', this.onFinished);
    this.play('Idle');
  }

  play(name) {
    const next = this.actions.get(name);
    const previous = this.active;
    this.retiring.delete(next);
    if (previous && previous !== next) {
      previous.fadeOut(BLEND);
      this.retiring.set(previous, this.mixer.time + BLEND);
    }
    const once = this.gestures.includes(name) || HELD_STATES.has(name);
    next.reset().setEffectiveTimeScale(1).setEffectiveWeight(1)
      .setLoop(once ? LoopOnce : LoopRepeat, once ? 1 : Infinity);
    next.clampWhenFinished = once;
    // Avoid fading a single restarted action to zero (e.g. Wave → Wave).
    if (previous && previous !== next) next.fadeIn(BLEND);
    next.play();
    this.active = next;
    this.actionStatus = once ? 'playing' : 'looping';
  }

  cancelMovement() {
    if (this.movement.status === 'moving') this.movement.status = 'cancelled';
  }

  command(operation, input = {}) {
    if (this.disposed) throw new CommandError('DISPOSED', 'The robot is no longer active.');
    // Validate before changing any animation, expression, or transform.
    switch (operation) {
      case 'state':
        fields(input, ['state']);
        if (!this.states.includes(input.state)) invalid(`Unknown state. Available: ${this.states.join(', ')}.`);
        this.cancelMovement();
        this.gesture = null;
        this.baseState = input.state;
        this.play(this.baseState);
        break;
      case 'gesture':
        fields(input, ['name']);
        if (!this.gestures.includes(input.name)) invalid(`Unknown gesture. Available: ${this.gestures.join(', ')}.`);
        this.cancelMovement();
        if (this.baseState in SPEEDS) this.baseState = 'Idle';
        this.gesture = input.name;
        this.play(input.name);
        break;
      case 'expression': {
        fields(input, ['name', 'weight']);
        if (!this.expressions.has(input.name)) invalid(`Unknown expression. Available: ${[...this.expressions.keys()].join(', ')}.`);
        finite(input.weight, 0, 1, 'weight');
        const expression = this.expressions.get(input.name);
        expression.weight = input.weight;
        for (const { object, index } of expression.bindings) object.morphTargetInfluences[index] = input.weight;
        break;
      }
      case 'move':
        fields(input, ['x', 'z', 'gait'], ['x', 'z']);
        finite(input.x, -LIMIT, LIMIT, 'x');
        finite(input.z, -LIMIT, LIMIT, 'z');
        if (input.gait !== undefined && !['Walking', 'Running'].includes(input.gait)) invalid('gait must be Walking or Running.');
        this.gesture = null;
        this.movement = { id: this.movement.id + 1, status: 'moving', target: { x: input.x, z: input.z }, gait: input.gait ?? 'Walking' };
        this.baseState = this.movement.gait;
        this.play(this.baseState);
        this.advanceMovement(0); // Already at the destination completes immediately.
        break;
      case 'stop':
        fields(input, []);
        this.cancelMovement();
        this.gesture = null;
        this.baseState = 'Idle';
        this.play('Idle');
        break;
      case 'turn': {
        fields(input, ['headingDegrees', 'toward'], []);
        if (Object.hasOwn(input, 'headingDegrees') === Object.hasOwn(input, 'toward')) invalid('Provide exactly one of headingDegrees or toward.');
        let heading;
        if (Object.hasOwn(input, 'headingDegrees')) {
          finite(input.headingDegrees, -180, 180, 'headingDegrees');
          heading = MathUtils.degToRad(input.headingDegrees);
        } else {
          fields(input.toward, ['x', 'z']);
          finite(input.toward.x, -100, 100, 'toward.x');
          finite(input.toward.z, -100, 100, 'toward.z');
          const dx = input.toward.x - this.root.position.x;
          const dz = input.toward.z - this.root.position.z;
          if (Math.hypot(dx, dz) < 1e-6) invalid('The facing target must differ from the robot position.');
          heading = Math.atan2(dx, dz);
        }
        this.command('stop');
        this.root.rotation.y = heading;
        break;
      }
      default: invalid('Unknown robot operation.');
    }
    return { accepted: true, state: this.inspect() };
  }

  advanceMovement(dt) {
    if (this.movement.status !== 'moving') return;
    const { target, gait } = this.movement;
    const position = this.root.position;
    const dx = target.x - position.x;
    const dz = target.z - position.z;
    const distance = Math.hypot(dx, dz);
    const step = SPEEDS[gait] * dt;
    if (distance > 1e-6) this.root.rotation.y = Math.atan2(dx, dz);
    if (distance <= Math.max(step, 1e-6)) {
      position.x = target.x;
      position.z = target.z;
      this.movement.status = 'completed';
      this.baseState = 'Idle';
      this.play('Idle');
    } else {
      position.x += dx / distance * step;
      position.z += dz / distance * step;
    }
  }

  update(dt) {
    if (this.disposed) return;
    if (!Number.isFinite(dt) || dt < 0) throw new Error('dt must be finite and nonnegative.');
    this.advanceMovement(dt);
    this.mixer.update(dt);
    for (const [action, stopAt] of this.retiring) {
      if (this.mixer.time >= stopAt) { action.stop(); this.retiring.delete(action); }
    }
    // Expressions remain independent even if a future asset animates morph weights.
    for (const { weight, bindings } of this.expressions.values()) {
      for (const { object, index } of bindings) object.morphTargetInfluences[index] = weight;
    }
  }

  inspect() {
    return {
      ready: !this.disposed,
      uuid: this.root.uuid,
      available: {
        states: [...this.states], gestures: [...this.gestures], expressions: [...this.expressions.keys()],
        expressionWeight: { min: 0, max: 1 },
        movement: { plane: 'XZ', bounds: { min: -LIMIT, max: LIMIT }, speeds: { ...SPEEDS } },
        coordinates: '+X right, +Z toward the front of the stage; Y up. World units; heading 0° faces +Z, 90° faces +X.',
      },
      baseState: this.baseState,
      action: { name: this.active.getClip().name, status: this.actionStatus },
      gesture: this.gesture,
      position: { x: this.root.position.x, y: this.root.position.y, z: this.root.position.z },
      headingDegrees: MathUtils.radToDeg(this.root.rotation.y),
      movement: { ...this.movement, target: this.movement.target ? { ...this.movement.target } : null },
      expressions: Object.fromEntries([...this.expressions].map(([name, value]) => [name, value.weight])),
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelMovement();
    this.mixer.removeEventListener('finished', this.onFinished);
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model);
    this.retiring.clear();
  }
}
