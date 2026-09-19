# three-webmcp

Expose an existing Three.js scene to AI agents through WebMCP, using tools for inspecting the scene, updating objects, and inspecting a WebGL renderer.

## Installation

```sh
npm install three three-webmcp
# TypeScript applications also need Three.js declarations:
npm install --save-dev @types/three
```

Version 0.1.0 is an ESM package with TypeScript declarations. It supports Three.js r186 (`>=0.186.0 <0.187.0`); Three.js is a peer dependency and is not bundled. Until the package is published, use the tarball produced by `npm pack` instead of the package name.

## Usage

```js
import { exposeThreeWebMCP } from 'three-webmcp';

// Pass the objects your application already owns.
const dispose = exposeThreeWebMCP({ scene, renderer });

// Optional: wait until every tool is registered and observe failures.
try {
  const supported = await dispose.ready;
  if (!supported) console.info('WebMCP is unavailable or registration was cancelled.');
} catch (error) {
  console.error('Could not register Three.js tools', error);
}

// On application teardown:
dispose();
```

`scene` is required; `renderer` is optional and currently supports `WebGLRenderer`. Without it, only the scene and object tools are registered. The application retains ownership of all Three.js objects and is responsible for rendering after changes (a continuous render loop is sufficient).

`dispose()` unregisters only this integration's tools, is safe to call repeatedly, and can be called while registration is pending. It does not dispose the scene, geometries, materials, or renderer. `dispose.ready` resolves to `true` after registration, or `false` if WebMCP is unavailable or cleanup interrupted registration. Registration failures roll back this integration's tools and reject `ready`; they also produce a console warning, so ignoring `ready` does not cause an unhandled rejection.

There is one tool set per document. A second integration or an existing tool with the same name causes registration to fail without removing the existing tools. Dispose the first integration before exposing another scene.

## WebMCP compatibility

The integration targets the [WebMCP draft dated September 17, 2026](https://webmachinelearning.github.io/webmcp/): `document.modelContext.registerTool()` returning a Promise, with an `AbortSignal` for unregistration. It does not target the older `navigator.modelContext` / `unregisterTool()` API or install a polyfill.

Use a browser implementing that API in a secure context (HTTPS or localhost), with WebMCP enabled and the `tools` permissions policy allowing access. Browser implementations and this draft are evolving. The browser test uses Playwright's pinned Chromium with `--enable-blink-features=WebMCP`.

In unsupported browsers and server-side rendering environments, calling `exposeThreeWebMCP()` safely returns an inert cleanup function and `ready` resolves to `false`. The rest of the Three.js application can continue normally.

## Tools

### `three.scene.inspect`

Input: `{}`. Returns a recursive snapshot of the scene, including the scene root. Each node contains:

```js
{
  uuid: '...', name: 'demo-cube', type: 'Mesh', visible: true,
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0, order: 'XYZ' },
  scale: { x: 1, y: 1, z: 1 },
  children: []
}
```

Transforms are local to the parent. Rotation uses Euler angles in radians; `visible` is the object's own flag, not effective visibility inherited from parents. Results are detached, JSON-serializable snapshots. Materials, geometries, and `userData` are not exposed. Scene inspection traverses the full scene, so response size grows with the graph.

### `three.object.update`

Input: a `uuid` from scene inspection and at least one property to change:

```json
{
  "uuid": "<UUID from three.scene.inspect>",
  "position": { "x": 1, "y": 0, "z": 0 },
  "rotation": { "x": 0, "y": 1.5707963267948966, "z": 0 },
  "scale": { "x": 1, "y": 1, "z": 1 },
  "visible": true
}
```

Each supplied vector must contain all three finite numeric components. Unspecified properties are preserved. Rotation optionally accepts `order` (`XYZ`, `YZX`, `ZXY`, `XZY`, `YXZ`, or `ZYX`); omitting it preserves the object's current order. Only objects currently in the exposed scene, including the root, can be updated.

The complete request is validated before any mutation. Unknown fields, invalid vectors, or invalid visibility values return `{ "error": { "code": "INVALID_ARGUMENT", "message": "..." } }`. An unknown UUID returns `OBJECT_NOT_FOUND`. Success returns the updated object's snapshot, including children.

Transform updates rebuild the object's local matrix, including when `matrixAutoUpdate` is disabled. World matrices follow the application's usual Three.js update/render cycle. Visibility-only updates preserve manually assigned matrices. The tool does not render a frame or override application animation logic.

### `three.renderer.inspect`

Registered only when a renderer is provided. Input: `{}`. Returns:

```js
{
  size: { width: 800, height: 600 }, // Logical pixels, not drawing-buffer pixels
  pixelRatio: 2,
  outputColorSpace: 'srgb',
  toneMapping: 0,                  // Three.js numeric constant
  calls: 1, triangles: 12,
  geometries: 1, textures: 0
}
```

Statistics are read from `renderer.info` without rendering or resetting counters. Their time window follows the renderer's `info.autoReset` setting. Both inspection tools have the read-only annotation; the update tool does not.

## Cube example

Requires Node.js 22.12+ or 24+ for development.

```sh
npm ci
npm run example
```

Open the local URL printed by Vite in a WebMCP-enabled browser. The page reports when its three tools are ready. Ask your WebMCP-capable agent:

> Inspect the scene, find demo-cube, move it to x=1, y=0, z=0, then inspect again and confirm the new position.

To exercise the same tool flow directly in Chromium 153:

```js
const context = document.modelContext;
const tools = await context.getTools();
const call = async (name, input = {}) => JSON.parse(await context.executeTool(
  tools.find(tool => tool.name === name), JSON.stringify(input),
));
const scene = await call('three.scene.inspect');
const cube = scene.children.find(object => object.name === 'demo-cube');
await call('three.object.update', {
  uuid: cube.uuid, position: { x: 1, y: 0, z: 0 },
});
console.log(await call('three.scene.inspect'));
console.log(await call('three.renderer.inspect'));
```

Chromium 153 takes JSON text for `executeTool` input. The latest draft instead specifies an object; on browsers implementing that revision, pass `input` directly. This difference affects the calling agent, not the library's registered tool callbacks. See [WebMCP issue #278](https://github.com/webmachinelearning/webmcp/issues/278).

## Development and validation

```sh
npm test                       # Build and library/lifecycle tests
npm run example:build          # Build the browser example
npx playwright install chromium
npm run test:browser           # Real WebMCP + WebGL end-to-end checks
npm pack                       # Build an installable ESM/declarations tarball
```

CI runs the same checks. The initial scope deliberately excludes adding/removing objects, material or geometry editing, camera/light tools, animation controls, and application-specific extension APIs. See [Issue #3](https://github.com/takahirox/three-webmcp/issues/3) for the v0.1.0 scope and [Issue #1](https://github.com/takahirox/three-webmcp/issues/1) for the project vision.
