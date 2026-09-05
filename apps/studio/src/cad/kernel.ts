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

/** CAD Kernel Phase 3 (Revolve + Boundary): the two profile shapes every
 * operation shares. Extrude's own extrudeRectangleMesh/extrudeCircleMesh
 * below predate this and are left exactly as they are (no reason to touch
 * already-shipped, tested code) -- revolveMesh/loftMesh use this instead of
 * a third/fourth hand-written sketchRectangle/sketchCircle branch. */
export type Profile = { type: "rectangle"; width: number; height: number } | { type: "circle"; radius: number };

// replicad's own PlaneConfig type isn't exported (only used unnamed in
// sketchRectangle/sketchCircle's own signatures) -- extracted via TS
// inference instead of hand-declaring an equivalent shape.
type PlaneConfig = Parameters<typeof sketchRectangle>[2];

function makeProfileSketch(profile: Profile, planeConfig?: PlaneConfig) {
  return profile.type === "rectangle" ? sketchRectangle(profile.width, profile.height, planeConfig) : sketchCircle(profile.radius, planeConfig);
}

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

/** CAD Kernel Phase 3: a profile swept around the world Y axis -- a lathe
 * operation (e.g. a torus from a circle profile, a ring from a rectangle
 * one). `offset` is the profile's distance from the axis (its own local
 * origin sits at world [offset,0,0]); `angleDeg` is how far around to
 * sweep (360 for a full revolve).
 *
 * The revolve's own `origin` config MUST be passed explicitly as
 * [0,0,0] -- empirically verified (see docs/decisions/cad-kernel-revolve-boundary.md):
 * left at its documented default, it resolves to the *sketch's own placed
 * origin* (i.e. [offset,0,0] itself), which runs the revolution axis
 * straight through the profile's center -- self-intersecting for a full
 * 360deg sweep, and a real (if opaquely reported) WASM exception. */
export function revolveMesh(profile: Profile, offset: number, angleDeg: number): CadMesh {
  const sketch = makeProfileSketch(profile, { origin: [offset, 0, 0] });
  const solid = sketch.revolve([0, 1, 0], { angle: angleDeg, origin: [0, 0, 0] });
  try {
    const mesh = solid.mesh(DEFAULT_MESH_OPTIONS);
    return { vertices: mesh.vertices, faces: mesh.triangles };
  } finally {
    solid.delete();
    sketch.delete();
  }
}

/** CAD Kernel Phase 3: a solid lofted between two profiles -- `startProfile`
 * at the default plane (z=0), `endProfile` a real `height` above it along
 * Z. Each profile can independently be a rectangle or a circle (e.g. a
 * circle-to-rectangle transition piece); the kernel cost of allowing that
 * is zero, so there's no reason to restrict it to matching shapes.
 *
 * `sketch.loftWith`'s own doc comment says it deletes both sketches
 * itself; empirically, calling `.delete()` on them again afterward never
 * throws and the resulting solid stays fully usable either way, so both
 * are deleted explicitly here for the same defensive symmetry
 * extrudeMesh/revolveMesh already have, regardless of which of the two is
 * actually true. */
export function loftMesh(startProfile: Profile, endProfile: Profile, height: number): CadMesh {
  const start = makeProfileSketch(startProfile);
  const end = makeProfileSketch(endProfile, { plane: "XY", origin: [0, 0, height] });
  const solid = start.loftWith(end, { ruled: false });
  try {
    const mesh = solid.mesh(DEFAULT_MESH_OPTIONS);
    return { vertices: mesh.vertices, faces: mesh.triangles };
  } finally {
    solid.delete();
    start.delete();
    end.delete();
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

/** Full pipeline (load OC, then revolve+mesh) for direct Node use. See
 * revolveMesh's own doc for the geometry conventions. */
export async function revolve(profile: Profile, offset: number, angleDeg: number): Promise<CadMesh> {
  await loadOC();
  return revolveMesh(profile, offset, angleDeg);
}

/** Full pipeline (load OC, then loft+mesh) for direct Node use. See
 * loftMesh's own doc for the geometry conventions. */
export async function loft(startProfile: Profile, endProfile: Profile, height: number): Promise<CadMesh> {
  await loadOC();
  return loftMesh(startProfile, endProfile, height);
}
