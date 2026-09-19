import { Vector2, type EulerOrder, type Object3D, type Scene, type WebGLRenderer } from 'three';

export interface ExposeThreeWebMCPOptions {
  scene: Scene;
  renderer?: WebGLRenderer;
}

/** Callable cleanup function with an observable registration result. */
export interface ThreeWebMCPDispose {
  (): void;
  /** True when registered, false when unsupported or disposed during registration. */
  readonly ready: Promise<boolean>;
}

interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: boolean };
  execute(input: unknown): Promise<unknown>;
}

interface ModelContext {
  registerTool(tool: Tool, options: { signal: AbortSignal }): Promise<void>;
}

interface XYZ { x: number; y: number; z: number }
interface Snapshot {
  uuid: string;
  name: string;
  type: string;
  visible: boolean;
  position: XYZ;
  rotation: XYZ & { order: EulerOrder };
  scale: XYZ;
  children: Snapshot[];
}

function xyz(value: XYZ): XYZ {
  return { x: value.x, y: value.y, z: value.z };
}

function snapshot(object: Object3D): Snapshot {
  return {
    uuid: object.uuid,
    name: object.name,
    type: object.type,
    visible: object.visible,
    position: xyz(object.position),
    rotation: { ...xyz(object.rotation), order: object.rotation.order },
    scale: xyz(object.scale),
    children: object.children.map(snapshot),
  };
}

const orders = ['XYZ', 'YZX', 'ZXY', 'XZY', 'YXZ', 'ZYX'] as const;
const vectorProperties = { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } };
const vectorSchema = {
  type: 'object', properties: vectorProperties,
  required: ['x', 'y', 'z'], additionalProperties: false,
};
const emptySchema = { type: 'object', properties: {}, additionalProperties: false };

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validVector(value: unknown, rotation = false): value is XYZ & { order?: EulerOrder } {
  return record(value)
    && Object.keys(value).every(key => ['x', 'y', 'z', ...(rotation ? ['order'] : [])].includes(key))
    && ['x', 'y', 'z'].every(key => typeof value[key] === 'number' && Number.isFinite(value[key]))
    && (!('order' in value) || orders.includes(value.order as EulerOrder));
}

function error(code: string, message: string) {
  return { error: { code, message } };
}

function update(scene: Scene, input: unknown): unknown {
  if (!record(input) || Object.keys(input).some(key => !['uuid', 'position', 'rotation', 'scale', 'visible'].includes(key))) {
    return error('INVALID_ARGUMENT', 'Expected an object containing uuid and supported update fields only.');
  }
  if (typeof input.uuid !== 'string' || !input.uuid) {
    return error('INVALID_ARGUMENT', 'uuid must be a nonempty string.');
  }
  if (!['position', 'rotation', 'scale', 'visible'].some(key => key in input)) {
    return error('INVALID_ARGUMENT', 'Provide at least one of position, rotation, scale, or visible.');
  }
  for (const key of ['position', 'rotation', 'scale'] as const) {
    if (key in input && !validVector(input[key], key === 'rotation')) {
      return error('INVALID_ARGUMENT', `${key} must contain finite x, y, z numbers${key === 'rotation' ? ' and optionally a valid Euler order' : ''}.`);
    }
  }
  if ('visible' in input && typeof input.visible !== 'boolean') {
    return error('INVALID_ARGUMENT', 'visible must be a boolean.');
  }
  const object = scene.getObjectByProperty('uuid', input.uuid);
  if (!object) return error('OBJECT_NOT_FOUND', 'No object with this uuid exists in the exposed scene.');

  // Validate the entire request before mutating any state.
  for (const key of ['position', 'scale'] as const) {
    if (key in input) {
      const value = input[key] as XYZ;
      object[key].set(value.x, value.y, value.z);
    }
  }
  if ('rotation' in input) {
    const value = input.rotation as XYZ & { order?: EulerOrder };
    object.rotation.set(value.x, value.y, value.z, value.order ?? object.rotation.order);
  }
  if ('visible' in input) object.visible = input.visible as boolean;
  if (['position', 'rotation', 'scale'].some(key => key in input)) object.updateMatrix();
  return snapshot(object);
}

function toolsFor({ scene, renderer }: ExposeThreeWebMCPOptions): Tool[] {
  const tools: Tool[] = [
    {
      name: 'three.scene.inspect',
      description: 'Inspect the exposed Three.js scene graph. Transforms are local; Euler rotation is in radians.',
      inputSchema: emptySchema,
      annotations: { readOnlyHint: true },
      execute: async () => snapshot(scene),
    },
    {
      name: 'three.object.update',
      description: 'Update an object in the exposed scene by UUID. Supply complete x/y/z vectors in local coordinates; Euler angles are radians. Unspecified properties and rotation order are preserved.',
      inputSchema: {
        type: 'object',
        properties: {
          uuid: { type: 'string', minLength: 1 },
          position: vectorSchema,
          rotation: { ...vectorSchema, properties: { ...vectorProperties, order: { type: 'string', enum: orders } } },
          scale: vectorSchema,
          visible: { type: 'boolean' },
        },
        required: ['uuid'],
        anyOf: ['position', 'rotation', 'scale', 'visible'].map(key => ({ required: [key] })),
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false },
      execute: async input => update(scene, input),
    },
  ];
  if (renderer) {
    tools.push({
      name: 'three.renderer.inspect',
      description: 'Inspect WebGLRenderer size (logical pixels), pixel ratio, output color space, tone mapping, and current render/memory statistics. Does not render a frame or reset counters.',
      inputSchema: emptySchema,
      annotations: { readOnlyHint: true },
      execute: async () => {
        const size = renderer.getSize(new Vector2());
        return {
          size: { width: size.x, height: size.y },
          pixelRatio: renderer.getPixelRatio(),
          outputColorSpace: renderer.outputColorSpace,
          toneMapping: renderer.toneMapping,
          calls: renderer.info.render.calls,
          triangles: renderer.info.render.triangles,
          geometries: renderer.info.memory.geometries,
          textures: renderer.info.memory.textures,
        };
      },
    });
  }
  return tools;
}

/** Expose one scene per document using the current WebMCP imperative API. */
export function exposeThreeWebMCP(options: ExposeThreeWebMCPOptions): ThreeWebMCPDispose {
  const context = typeof document === 'undefined' ? undefined
    : (document as Document & { modelContext?: ModelContext }).modelContext;
  const controller = new AbortController();
  let disposed = false;
  const dispose = (() => {
    if (disposed) return;
    disposed = true;
    controller.abort();
  }) as ThreeWebMCPDispose;

  const ready = (async () => {
    if (!context || typeof context.registerTool !== 'function') return false;
    try {
      for (const tool of toolsFor(options)) {
        if (disposed) return false;
        await context.registerTool({
          ...tool,
          execute: async input => disposed || controller.signal.aborted
            ? error('DISPOSED', 'These tools are no longer active.') : tool.execute(input),
        }, { signal: controller.signal });
      }
      return !disposed;
    } catch (cause) {
      controller.abort();
      if (disposed) return false;
      throw cause;
    }
  })();
  Object.defineProperty(dispose, 'ready', { value: ready, enumerable: true });
  // The minimal API may ignore ready. Report errors without unhandled rejections.
  void ready.catch(cause => console.warn('three-webmcp: tool registration failed.', cause));
  return dispose;
}
