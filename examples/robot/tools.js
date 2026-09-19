import { fields, GESTURES, LIMIT, STATES } from './controller.js';

const number = (min, max) => ({ type: 'number', minimum: min, maximum: max });
const schema = (properties = {}, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });

/** getRobot and getLoadState let tools explain loading failures without exposing broken controls. */
export function robotTools(getRobot, getLoadState) {
  const definitions = [
    ['inspect', 'Inspect robot readiness, supported actions/expressions, current action, and movement completion. Inspect before choosing actions.', schema()],
    ['state', 'Set a base animation in place. Cancels movement and gestures. Walking/Running here animate in place; use robot.move for travel. Death/Sitting/Standing play once and hold their last pose.', schema({ state: { type: 'string', enum: STATES } })],
    ['gesture', 'Play a one-shot gesture, then return to the base state. Cancels travel and returns locomotion to Idle. A newer gesture or state replaces the previous gesture.', schema({ name: { type: 'string', enum: GESTURES } })],
    ['expression', 'Set one facial expression weight (0–1), independently of animation. Get supported names from robot.inspect.', schema({ name: { type: 'string' }, weight: number(0, 1) })],
    ['move', 'Walk or run to world X/Z coordinates on the ground, within -6 to 6. +X is right; +Z is toward the front of the stage. Replaces prior travel and gestures. Returns acceptance, not arrival: poll robot.inspect until movement.status is completed, then issue the next action.', schema({ x: number(-LIMIT, LIMIT), z: number(-LIMIT, LIMIT), gait: { type: 'string', enum: ['Walking', 'Running'], default: 'Walking' } }, ['x', 'z'])],
    ['stop', 'Immediately cancel travel and gestures and return to Idle.', schema()],
    ['turn', 'Stop movement/gestures and face an absolute heading in degrees (0 faces +Z, 90 faces +X), or a world X/Z target. Supply exactly one. The page camera position is available from robot.inspect.', {
      ...schema({ headingDegrees: number(-180, 180), toward: schema({ x: number(-100, 100), z: number(-100, 100) }) }, []),
      oneOf: [{ required: ['headingDegrees'] }, { required: ['toward'] }],
    }],
  ];
  return definitions.map(([operation, description, inputSchema]) => ({
    name: `robot.${operation}`, description, inputSchema,
    annotations: { readOnlyHint: operation === 'inspect' },
    execute: async (input = {}) => {
      try {
        const robot = getRobot();
        const load = getLoadState();
        if (operation === 'inspect') {
          fields(input, []);
          return { ...load, ...(robot ? robot.inspect() : { ready: false }) };
        }
        if (!robot) return { error: { code: load.status === 'error' ? 'MODEL_LOAD_FAILED' : 'MODEL_NOT_READY', message: load.message } };
        return robot.command(operation, input);
      } catch (cause) {
        return { error: { code: cause.code ?? 'COMMAND_FAILED', message: cause.message } };
      }
    },
  }));
}

/** Register demo tools using the same native WebMCP lifecycle as the library. */
export function registerRobotTools(context, tools) {
  const abort = new AbortController();
  let disposed = false;
  const dispose = () => { disposed = true; abort.abort(); };
  dispose.ready = (async () => {
    if (!context?.registerTool) return false;
    try {
      for (const tool of tools) {
        if (disposed) return false;
        await context.registerTool({ ...tool, execute: async input => abort.signal.aborted
          ? { error: { code: 'DISPOSED', message: 'Robot tools have been unregistered.' } } : tool.execute(input) }, { signal: abort.signal });
      }
      return !disposed;
    } catch (cause) {
      abort.abort();
      if (disposed) return false;
      throw cause;
    }
  })();
  // The owner consumes ready; also guard early disposal before it attaches a handler.
  void dispose.ready.catch(() => {});
  return dispose;
}
