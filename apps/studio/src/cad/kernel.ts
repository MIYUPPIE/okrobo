// CAD Kernel Phase 1: Foundation. The real replicad/OpenCascade integration
// -- sketch -> extrude -> mesh, producing flat {vertices, faces} data shaped
// exactly for robot-def v1's cad_mesh geometry variant (see
// contracts/robot-def/v1/schema.json and docs/decisions/cad-kernel-foundation.md).
//
// Deliberately portable to both plain Node (this repo's offline authoring
// script, scripts/generate-cad-examples.mjs, and this module's own gate
// test) and a browser Worker (./worker.ts) -- replicad-opencascadejs's own
// generated loader already resolves its .wasm file correctly under Node via
// import.meta.url + node:fs with no options at all, which is exactly the
// `loadOC()` no-argument default below. A browser build cannot rely on that
// same resolution (the .wasm needs to be an explicit Vite asset import), so
// worker.ts calls `loadOC({ locateFile })` instead with its own bundled
// asset URL. Nothing in apps/studio/src/builder/ imports this module or
// "replicad" at all this phase -- see the decision doc for why that keeps
// the CAD kernel's ~20MB WASM entirely out of the app's main bundle.

import { setOC, sketchCircle, sketchRectangle } from "replicad";
import type { OpenCascadeInstance } from "replicad-opencascadejs";
import opencascade from "replicad-opencascadejs";

export interface CadMesh {
  vertices: number[];
  faces: number[];
}

export interface LoadOCOptions {
  locateFile?: (path: string, prefix: string) => string;
  [key: string]: unknown;
}

let ocPromise: Promise<OpenCascadeInstance> | null = null;

/** Loads and initializes the OpenCascade WASM module exactly once (memoized
 * across every caller in this process/worker). Called with no arguments
 * under Node -- replicad-opencascadejs's own generated loader resolves its
 * .wasm sibling file via import.meta.url + node:fs on its own. A browser
 * Worker must instead pass `locateFile` pointing at a real bundled asset
 * URL (see worker.ts). */
export function loadOC(options: LoadOCOptions = {}): Promise<OpenCascadeInstance> {
  if (!ocPromise) {
    ocPromise = opencascade(options).then((oc) => {
      setOC(oc);
      return oc;
    });
  }
  return ocPromise;
}

const DEFAULT_MESH_OPTIONS = { tolerance: 0.01, angularTolerance: 0.3 };

/** Assumes loadOC() has already resolved -- callers needing the full,
 * loader-included pipeline should use extrudeRectangle/extrudeCircle below
 * instead. Split out so worker.ts can load OC with its own browser-specific
 * options once, then call this synchronously-shaped step per request. */
export function extrudeRectangleMesh(width: number, height: number, depth: number): CadMesh {
  const sketch = sketchRectangle(width, height);
  const solid = sketch.extrude(depth, { origin: [0, 0, -depth / 2] });
  try {
    const mesh = solid.mesh(DEFAULT_MESH_OPTIONS);
    return { vertices: mesh.vertices, faces: mesh.triangles };
  } finally {
    solid.delete();
    sketch.delete();
  }
}

export function extrudeCircleMesh(radius: number, depth: number): CadMesh {
  const sketch = sketchCircle(radius);
  const solid = sketch.extrude(depth, { origin: [0, 0, -depth / 2] });
  try {
    const mesh = solid.mesh(DEFAULT_MESH_OPTIONS);
    return { vertices: mesh.vertices, faces: mesh.triangles };
  } finally {
    solid.delete();
    sketch.delete();
  }
}

/** Full pipeline (load OC, then extrude+mesh a rectangle profile), for
 * direct Node use -- see ./extrude.ts's public API. */
export async function extrudeRectangle(width: number, height: number, depth: number): Promise<CadMesh> {
  await loadOC();
  return extrudeRectangleMesh(width, height, depth);
}

/** Full pipeline for a circle profile. See extrudeRectangle's own doc. */
export async function extrudeCircle(radius: number, depth: number): Promise<CadMesh> {
  await loadOC();
  return extrudeCircleMesh(radius, depth);
}
