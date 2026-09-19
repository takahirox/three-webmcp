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

## Robot playground

```sh
npm ci
npm run example
```

Open the printed local URL for the **robot playground** (`/`). The original **cube example** is still available at `/cube/`. The robot model is included locally, so neither demo needs a CDN or an AI API key. Both pages are included in `npm run example:build` under `example-dist/` (serve that directory over HTTP).

The robot is based on the [Three.js skinning and morphing example](https://threejs.org/examples/#webgl_animation_skinning_morph), with a control panel for states, gestures, expressions, travel, and turning. Click the floor to move, or enter an X/Z destination and choose Walk or Run. Manual controls and agent tools use exactly the same character controller. The panel shows changes made by an agent, too.

Try asking a connected agent:

> Walk to x=-3, z=0. Wait until you arrive, then face the camera and wave.

> Look surprised, jump, then dance.

> Run to x=4, z=2. Stop now.

### Robot tools

These tools belong to the demo, not the library's public API. The three common library tools are also available. Prefer robot tools for character behavior; direct bone/root edits through `three.object.update` may be overwritten by animation or travel.

| Tool | Input / behavior |
| --- | --- |
| `robot.inspect` | `{}`; readiness, supported actions, expression names, position, heading, active action, travel state, and camera position |
| `robot.state` | `{ "state": "Dance" }`; sets an animation in place and cancels travel/gestures |
| `robot.gesture` | `{ "name": "Wave" }`; plays once, then restores the base state |
| `robot.expression` | `{ "name": "Surprised", "weight": 0.8 }`; changes one expression independently |
| `robot.move` | `{ "x": -3, "z": 0, "gait": "Walking" }`; gait can also be `Running` |
| `robot.stop` | `{}`; stops travel/gestures and returns to Idle |
| `robot.turn` | `{ "headingDegrees": 90 }` or `{ "toward": { "x": 10, "z": 18 } }`; stops travel/gestures and faces that direction |

Coordinates are world units on the XZ ground plane, with each destination component limited to [-6, 6]. +X is stage-right, +Z is toward the stage front; Y is up. Heading 0° faces +Z, 90° faces +X. Walking travels at 2 units/second, running at 4. `robot.inspect` returns the camera's current position for “face me” instructions.

Commands return `{ accepted: true, state: ... }` immediately, **not when an animation or journey finishes**. Inspect `movement.status` (`idle`, `moving`, `completed`, `cancelled`), its `id` and `target` to observe travel. Inspect `gesture` (null after completion) and `action.status` (`looping`, `playing`, `held`) for animation completion. Poll at a modest rate, such as every 250 ms, before issuing the next sequential action.

A new move replaces the previous destination and cancels a gesture. Stop, turn, state changes, and gestures cancel current travel. A gesture returns to the selected base state; if that base state was Walking/Running it returns to Idle. Death, Sitting, and Standing play once and hold their final pose; other base states loop. Expressions are discovered from the model (Angry, Surprised, Sad), accept weights from 0 to 1, and remain independent of gestures. Invalid commands do not change state. Unsupported commands/values return `INVALID_ARGUMENT`; loading and failed models return `MODEL_NOT_READY` and `MODEL_LOAD_FAILED`.

Tools are discoverable during model loading, so an agent can inspect readiness and failures. Manual controls become enabled only when the model is ready. If WebMCP is unavailable or registration fails, manual controls still work. Leaving the page unregisters both tool sets; a browser back/forward-cache restore reconnects them.

### Connect an agent

**Opening the page does not automatically connect this conversation or any AI agent.** The demo provides page tools, not an embedded chat interface. Use an agent/browser integration that can discover tools in the same live tab; a separate browser opened by automation has a separate scene.

For local Chrome testing, enable `chrome://flags/#enable-webmcp-testing`, relaunch Chrome, and look for “WebMCP tools ready” on the demo. The [Model Context Tool Inspector](https://chromewebstore.google.com/detail/webmcp-model-context-tool/gbpdfapgefenggkahomfgkhfehlcenpd) can invoke tools manually; it is an optional developer tool, not a requirement of WebMCP itself. See the [Chrome WebMCP guide](https://developer.chrome.com/docs/ai/webmcp).

One way to connect a local Codex agent to your existing Chrome tab is [Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp). Enable remote debugging at `chrome://inspect/#remote-debugging`, then configure the connection, replacing the URL pattern with the origin/port printed by your dev server:

```sh
codex mcp add chrome-devtools -- npx -y chrome-devtools-mcp@latest \
  --autoConnect --allowedUrlPattern 'http://127.0.0.1:5173/*' \
  --no-usage-statistics
```

Once the agent has loaded that connection and Chrome has granted access, ask it to use `document.modelContext.getTools()` / `executeTool()` in the demo tab. This lets the agent call WebMCP via the browser connection. No Inspector extension is needed for this route. The integration can control the allowed pages, so restrict the URL pattern to your demo and turn off remote debugging when finished.

### Manual WebMCP check

In the robot page's browser console (Chromium 153):

```js
const context = document.modelContext;
const tools = await context.getTools();
const call = async (name, input = {}) => JSON.parse(await context.executeTool(
  tools.find(tool => tool.name === name), JSON.stringify(input),
));
await call('robot.inspect');
await call('robot.move', { x: -2, z: 0 });
// Inspect until movement.status === 'completed', then:
await call('robot.gesture', { name: 'Wave' });
await call('robot.expression', { name: 'Surprised', weight: 0.7 });
```

The model is CC0, by Tomás Laulhé with modifications by Don McCurdy. [Asset provenance and attribution](examples/public/models/RobotExpressive/README.md) and the [Three.js MIT notice](examples/public/THREE-LICENSE.txt) are included and copied into the example build.

## Cube example

Requires Node.js 22.12+ or 24+ for development.

```sh
npm ci
npm run example
```

Open `/cube/` at the local URL printed by Vite in a WebMCP-enabled browser. The page reports when its three tools are ready. Ask your WebMCP-capable agent:

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

CI runs the same checks, including the actual robot asset and native-browser control flow. Character behavior lives only in the demo; the library’s initial scope still excludes adding/removing objects, material or geometry editing, camera/light tools, animation controls, and application-specific extension APIs. See [Issue #3](https://github.com/takahirox/three-webmcp/issues/3) for the v0.1.0 scope and [Issue #1](https://github.com/takahirox/three-webmcp/issues/1) for the project vision.
