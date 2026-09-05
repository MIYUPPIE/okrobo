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

import { importSTLAsMesh, setManifold, setOC, sketchCircle, sketchRectangle, type Shape3D } from "replicad";
import type { OpenCascadeInstance } from "replicad-opencascadejs";
import opencascade from "replicad-opencascadejs";
import ManifoldModule from "manifold-3d";
import type { ManifoldToplevel } from "manifold-3d";

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

// manifold-3d's own Module() takes a differently-shaped locateFile than
// replicad-opencascadejs's (no path/prefix args) -- inferred via TS rather
// than hand-declared, same reasoning as kernel.ts's own PlaneConfig.
export type LoadManifoldOptions = NonNullable<Parameters<typeof ManifoldModule>[0]>;

let manifoldPromise: Promise<ManifoldToplevel> | null = null;

/** CAD Kernel Phase 4 (Cut): loads and initializes the Manifold WASM module
 * exactly once, memoized the same way loadOC() is. Manifold (~530KB) is a
 * separate library from OpenCascade (~23MB) -- a small, fast mesh-boolean
 * engine, not a B-rep kernel -- used only for Cut's real triangle-mesh
 * subtraction (see docs/decisions/cad-kernel-cut-operations.md). Called
 * with no arguments under Node (manifold-3d's own generated loader
 * resolves its .wasm sibling file the same way replicad-opencascadejs's
 * does); a browser Worker passes `locateFile` pointing at a bundled asset
 * URL (see worker.ts). */
export function loadManifold(options?: LoadManifoldOptions): Promise<ManifoldToplevel> {
  if (!manifoldPromise) {
    manifoldPromise = ManifoldModule(options).then((manifold) => {
      manifold.setup();
      setManifold(manifold);
      return manifold;
    });
  }
  return manifoldPromise;
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

/** CAD Kernel Phase 4 (Cut): builds an ASCII STL blob from flat
 * {vertices, faces} arrays -- the round-trip format that lets a body's
 * already-baked mesh become a real, boolean-operable MeshShape again (see
 * cutMesh's own doc). Degenerate (all-zero) facet normals are legal STL;
 * nothing downstream needs them. */
function meshToStlBlob(vertices: number[], faces: number[]): Blob {
  let text = "solid mesh\n";
  for (let i = 0; i < faces.length; i += 3) {
    const a = faces[i] * 3;
    const b = faces[i + 1] * 3;
    const c = faces[i + 2] * 3;
    text += "facet normal 0 0 0\nouter loop\n";
    text += `vertex ${vertices[a]} ${vertices[a + 1]} ${vertices[a + 2]}\n`;
    text += `vertex ${vertices[b]} ${vertices[b + 1]} ${vertices[b + 2]}\n`;
    text += `vertex ${vertices[c]} ${vertices[c + 1]} ${vertices[c + 2]}\n`;
    text += "endloop\nendfacet\n";
  }
  text += "endsolid mesh\n";
  return new Blob([text], { type: "model/stl" });
}

/** CAD Kernel Phase 4: the cutting tool's own shape -- one variant per
 * Boss operation (Extruded/Revolved/Boundary Cut), carrying exactly the
 * params extrudeMesh/revolveMesh/loftMesh already take. */
export type CutTool =
  | { operation: "extrude"; profile: Profile; depth: number }
  | { operation: "revolve"; profile: Profile; offset: number; angleDeg: number }
  | { operation: "loft"; startProfile: Profile; endProfile: Profile; height: number };

/** Builds the tool as a live solid, stopping one step before
 * extrudeMesh/revolveMesh/loftMesh's own `.mesh()` + delete -- cutMesh
 * still needs to translate and meshShape() it. Caller owns disposal. */
function buildToolSolid(tool: CutTool): Shape3D {
  if (tool.operation === "extrude") {
    const sketch = makeProfileSketch(tool.profile);
    const solid = sketch.extrude(tool.depth, { origin: [0, 0, -tool.depth / 2] });
    sketch.delete();
    return solid;
  }
  if (tool.operation === "revolve") {
    const sketch = makeProfileSketch(tool.profile, { origin: [tool.offset, 0, 0] });
    const solid = sketch.revolve([0, 1, 0], { angle: tool.angleDeg, origin: [0, 0, 0] });
    sketch.delete();
    return solid;
  }
  const start = makeProfileSketch(tool.startProfile);
  const end = makeProfileSketch(tool.endProfile, { plane: "XY", origin: [0, 0, tool.height] });
  const solid = start.loftWith(end, { ruled: false });
  start.delete();
  end.delete();
  return solid;
}

/** CAD Kernel Phase 4 (Cut): subtracts `tool` (positioned at `position`,
 * an offset from the target's own local origin) from `targetMesh` --
 * Extruded/Revolved/Boundary Cut's shared implementation, differing only
 * in `tool.operation`.
 *
 * `targetMesh` is baked, frozen data (an existing body's own visual/
 * collision geometry, converted to a flat mesh by the caller --
 * apps/studio/src/builder/geometryToMesh.ts bridges any Geometry type,
 * not just cad_mesh, to this shape) with no live B-rep behind it anymore.
 * Reconstructing a full B-rep from it (replicad's importSTL) would lose
 * precision -- anything originally curved gets faceted. Instead this uses
 * replicad's separate mesh-native boolean path: `importSTLAsMesh`
 * reconstructs a real, boolean-operable MeshShape (backed by the Manifold
 * library, not OpenCascade) with zero *additional* precision loss beyond
 * what was already baked in, since STL is itself a flat triangle format --
 * nothing curved to facet a second time. The freshly-built tool solid
 * converts to a MeshShape directly via `.meshShape()`, no round-trip
 * needed. Verified empirically end to end (see
 * docs/decisions/cad-kernel-cut-operations.md), including that
 * `Solid.translate()` returns a new object (the pre-translate one still
 * needs its own `.delete()`) and that the cut result stays fully usable
 * after every input is deleted, which is why cleanup happens as early as
 * each object's last use rather than all at the end. */
export async function cutMesh(targetMesh: CadMesh, tool: CutTool, position: readonly [number, number, number]): Promise<CadMesh> {
  const targetMeshShape = await importSTLAsMesh(meshToStlBlob(targetMesh.vertices, targetMesh.faces));
  const untranslatedTool = buildToolSolid(tool);
  const translatedTool = untranslatedTool.translate(position[0], position[1], position[2]);
  untranslatedTool.delete();
  const toolMeshShape = translatedTool.meshShape(DEFAULT_MESH_OPTIONS);
  translatedTool.delete();

  const resultShape = targetMeshShape.cut(toolMeshShape);
  targetMeshShape.delete();
  toolMeshShape.delete();
  try {
    const mesh = resultShape.mesh();
    return { vertices: mesh.vertices, faces: mesh.triangles };
  } finally {
    resultShape.delete();
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

/** Full pipeline (load OC and Manifold, then cut+mesh) for direct Node
 * use. See cutMesh's own doc for the geometry conventions. */
export async function cut(targetMesh: CadMesh, tool: CutTool, position: readonly [number, number, number]): Promise<CadMesh> {
  await Promise.all([loadOC(), loadManifold()]);
  return cutMesh(targetMesh, tool, position);
}
