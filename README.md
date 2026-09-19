# three-webmcp

Reusable WebMCP integration for Three.js applications.

> **Status:** Early-stage project. The API and toolset are still being designed.

## Overview

`three-webmcp` aims to make it easy for web applications built with [Three.js](https://threejs.org/) to expose their 3D capabilities to AI agents through WebMCP.

Three.js applications already have rich runtime APIs through objects such as scenes, objects, cameras, renderers, and materials. Without a shared integration layer, each application would need to design and implement its own WebMCP tools for common operations.

This project aims to provide that reusable integration layer.

## Vision

A Three.js application should be able to expose common 3D capabilities to AI agents with only a small amount of integration code.

Conceptually, usage could look like this:

```js
exposeThreeWebMCP({
  scene,
  camera,
  renderer,
});
```

The goal is to provide a common interface across different Three.js applications so that AI agents can understand and interact with Three.js scenes without needing application-specific knowledge for common operations.

## Goals

- Make WebMCP integration easy to add to existing Three.js applications.
- Provide reusable WebMCP tools for common Three.js operations.
- Provide a consistent interface across different Three.js applications.
- Allow applications to extend the common toolset with application-specific capabilities.
- Let application developers control which capabilities are exposed to AI agents.

## Intended experience

With `three-webmcp`, AI agents should eventually be able to perform tasks such as:

- Understand what objects exist in a scene.
- Inspect object state and properties.
- Move, modify, add, or remove objects.
- Inspect camera and renderer state.
- Investigate scene or renderer state when diagnosing problems.
- Use application-specific 3D capabilities exposed by the application.

## Principles

### Keep Three.js core unchanged

The WebMCP integration should be built on top of the public Three.js API without requiring changes to or a fork of Three.js itself.

### Keep integration simple

Developers should be able to integrate the library into an existing Three.js application with a small amount of code.

### Provide a common interface

Common Three.js operations should not require every application to invent its own WebMCP interface.

### Stay extensible

Applications should be able to expose their own domain-specific capabilities alongside the common Three.js tools.

### Keep exposure under application control

Applications should decide which capabilities are made available to AI agents rather than exposing everything automatically.
