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

import { importSTLAsMesh, makeBox, makeCylinder, setManifold, setOC, sketchCircle, sketchRectangle, FaceFinder, type Edge, type Face, type Shape3D, type ShapeEdgeMesh, type ShapeMesh } from "replicad";
import type { OpenCascadeInstance } from "replicad-opencascadejs";
import opencascade from "replicad-opencascadejs";
import ManifoldModule from "manifold-3d";
import type { ManifoldToplevel } from "manifold-3d";

export interface CadMesh {
  vertices: number[];
  faces: number[];
}

// CAD Kernel Phase 5 (Fillet + Chamfer): replicad's own edge-export shape
// is already exactly what a "pickable edges" overlay needs ({lines,
// edgeGroups}) -- no renaming needed here the way CadMesh renames
// ShapeMesh's own `triangles` to `faces`, so it's re-exported as-is rather
// than duplicated.
export type { ShapeEdgeMesh };

// CAD Kernel Phase 6 (Shell + Draft): same reasoning -- replicad's own
// {vertices, triangles, normals, faceGroups} is exactly what a "pickable
// faces" overlay needs (faceGroups partitions the triangle-index list by
// which real B-rep face it came from), re-exported as-is.
export type { ShapeMesh };

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

/** CAD Kernel Phase 4/5: a Boss-style operation's own params -- one variant
 * per Boss tool (Extrude/Revolve/Boundary), carrying exactly what
 * extrudeMesh/revolveMesh/loftMesh already take. Originally named CutTool
 * (Phase 4, the cutting tool's own shape); Phase 5's Fillet/Chamfer needs
 * the identical union as one of FilletBaseShape's own variants (a fresh
 * Boss shape can be filleted before it's baked), so it's extracted under
 * this more general name -- CutTool stays as an alias, Cut's own public
 * shape is unchanged. */
export type BossOperation =
  | { operation: "extrude"; profile: Profile; depth: number }
  | { operation: "revolve"; profile: Profile; offset: number; angleDeg: number }
  | { operation: "loft"; startProfile: Profile; endProfile: Profile; height: number };

export type CutTool = BossOperation;

/** Builds a Boss operation as a live solid, stopping one step before
 * extrudeMesh/revolveMesh/loftMesh's own `.mesh()` + delete -- callers
 * that need to keep operating on the live solid (cutMesh's translate +
 * meshShape(), Phase 5's fillet/chamfer) do that step themselves. Caller
 * owns disposal. */
function buildBossSolid(op: BossOperation): Shape3D {
  if (op.operation === "extrude") {
    const sketch = makeProfileSketch(op.profile);
    const solid = sketch.extrude(op.depth, { origin: [0, 0, -op.depth / 2] });
    sketch.delete();
    return solid;
  }
  if (op.operation === "revolve") {
    const sketch = makeProfileSketch(op.profile, { origin: [op.offset, 0, 0] });
    const solid = sketch.revolve([0, 1, 0], { angle: op.angleDeg, origin: [0, 0, 0] });
    sketch.delete();
    return solid;
  }
  const start = makeProfileSketch(op.startProfile);
  const end = makeProfileSketch(op.endProfile, { plane: "XY", origin: [0, 0, op.height] });
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
  const untranslatedTool = buildBossSolid(tool);
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

/** CAD Kernel Phase 5 (Fillet + Chamfer): the shape a fillet/chamfer can
 * target -- either a fresh Boss operation (filleted before it's ever
 * baked) or a box/cylinder rebuilt exactly from its own analytic
 * parameters (a body already placed in the document, if its Geometry
 * happens to be one of these two types). Sphere has no edges at all;
 * cone/capsule would need a real profile-revolve reconstruction for one
 * marginal rim edge each -- not worth it this phase (see
 * docs/decisions/cad-kernel-fillet-chamfer.md). Box/cylinder verified
 * empirically to reconstruct with the exact same centered/axis convention
 * robotThree.ts's geometryFor already renders them with (box centered on
 * all 3 axes; cylinder centered on Y, three.js's own default, no rotation
 * applied there) -- zero approximation, zero axis-mismatch risk. */
export type FilletBaseShape = BossOperation | { operation: "box"; size: [number, number, number] } | { operation: "cylinder"; radius: number; length: number };

function buildFilletBaseSolid(shape: FilletBaseShape): Shape3D {
  if (shape.operation === "box") {
    const [sx, sy, sz] = shape.size;
    return makeBox([-sx / 2, -sy / 2, -sz / 2], [sx / 2, sy / 2, sz / 2]);
  }
  if (shape.operation === "cylinder") {
    return makeCylinder(shape.radius, shape.length, [0, -shape.length / 2, 0], [0, 1, 0]);
  }
  return buildBossSolid(shape);
}

/** A matching tolerance derived from the solid's own bounding-box diagonal
 * rather than a hardcoded absolute distance, so a geometric-descriptor
 * match (fillet/chamfer picks, and CAD Kernel Phase 6's shell/draft face
 * picks) stays reliable whether the shape is a 0.02-unit part or a
 * 10-unit one. Extracted once a third caller needed the identical
 * calculation. */
function toleranceFor(solid: Shape3D): number {
  const bounds = solid.boundingBox.bounds;
  const diagonal = Math.hypot(bounds[1][0] - bounds[0][0], bounds[1][1] - bounds[0][1], bounds[1][2] - bounds[0][2]);
  return Math.max(diagonal * 0.005, 1e-6);
}

/** One edge to round (fillet) or bevel (chamfer), identified by a
 * geometric descriptor point rather than the edge object itself or its
 * hashCode -- verified empirically that `Shape.hashCode` is NOT stable
 * across independent rebuilds of an identical solid (two separately-built,
 * geometrically identical boxes produced entirely different hash sets),
 * while a point on the edge (its true midpoint for a straight edge, any
 * interior polyline sample for a curved one -- never a shared vertex,
 * which is ambiguous between adjacent edges) reliably re-finds the same
 * edge via `EdgeFinder.near()` on a freshly rebuilt solid. `value` is the
 * fillet radius or chamfer distance. */
export interface FilletPick {
  point: [number, number, number];
  operation: "fillet" | "chamfer";
  value: number;
}

/** Applies every pick to `solid`, fillets first then chamfers (chained --
 * verified this works when both target different, non-adjacent edges of
 * the same base solid). Skips either call entirely when its own pick list
 * is empty, rather than relying on an untested "radius always null" no-op
 * path. Caller owns disposing the returned shape; `solid` itself is left
 * untouched (fillet/chamfer both return a new shape) and still needs its
 * own disposal by the caller too.
 *
 * Known limitation, verified empirically (see
 * docs/decisions/cad-kernel-fillet-chamfer.md): mixing a fillet and a
 * chamfer on two edges that share a vertex can fail with replicad's own
 * "Could not chamfer, no edge was selected" -- filleting the first edge
 * trims/moves its immediate neighbors (the blend surface replaces the
 * shared corner), so a chamfer descriptor recorded against the pristine
 * shape can no longer find that neighbor on the already-filleted result.
 * Non-adjacent picks are unaffected. This surfaces through the same
 * generic error-message path every other opaque WASM exception already
 * does -- no special handling added for it. */
function applyFilletPicks(solid: Shape3D, picks: FilletPick[]): Shape3D {
  const tolerance = toleranceFor(solid);

  const radiusFor = (targetOperation: FilletPick["operation"]) => {
    const matching = picks.filter((p) => p.operation === targetOperation);
    if (matching.length === 0) return null;
    return (edge: Edge) => {
      const point = edge.pointAt(0.5).toTuple();
      const hit = matching.find((p) => Math.hypot(point[0] - p.point[0], point[1] - p.point[1], point[2] - p.point[2]) < tolerance);
      return hit ? hit.value : null;
    };
  };

  let current = solid;
  const filletRadius = radiusFor("fillet");
  if (filletRadius) {
    const next = current.fillet(filletRadius);
    if (current !== solid) current.delete();
    current = next;
  }
  const chamferRadius = radiusFor("chamfer");
  if (chamferRadius) {
    const next = current.chamfer(chamferRadius);
    if (current !== solid) current.delete();
    current = next;
  }
  return current;
}

/** Assumes loadOC() has already resolved. See previewEdges's own doc. */
export function previewEdgesMesh(shape: FilletBaseShape): ShapeEdgeMesh {
  const solid = buildFilletBaseSolid(shape);
  try {
    return solid.meshEdges();
  } finally {
    solid.delete();
  }
}

/** Full pipeline (load OC, build the base shape, export its edges as
 * pickable lines) for direct Node use -- the same base shape a
 * fillet/chamfer call targets, before any picks are applied. Used to
 * render the "Edges" list/3D overlay a student picks from. */
export async function previewEdges(shape: FilletBaseShape): Promise<ShapeEdgeMesh> {
  await loadOC();
  return previewEdgesMesh(shape);
}

/** Assumes loadOC() has already resolved. See fillet's own doc. */
export function filletMesh(shape: FilletBaseShape, picks: FilletPick[]): CadMesh {
  const base = buildFilletBaseSolid(shape);
  const result = applyFilletPicks(base, picks);
  if (result !== base) base.delete();
  try {
    const mesh = result.mesh(DEFAULT_MESH_OPTIONS);
    return { vertices: mesh.vertices, faces: mesh.triangles };
  } finally {
    result.delete();
  }
}

/** Full pipeline (load OC, then build+fillet/chamfer+mesh) for direct Node
 * use. Only needs OpenCascade -- fillet/chamfer are live-B-rep operations,
 * Manifold (Cut's own mesh-boolean engine) never enters into this at all. */
export async function fillet(shape: FilletBaseShape, picks: FilletPick[]): Promise<CadMesh> {
  await loadOC();
  return filletMesh(shape, picks);
}

/** CAD Kernel Phase 6 (Shell + Draft): a picked face's descriptor point --
 * `Face.center`, always exact, never a mesh approximation. Verified this
 * matters here in a way it didn't for edges: a face's own mesh-
 * triangulated centroid (averaging the vertices in its ShapeMesh.faceGroups
 * triangle range) is a close match for a planar face, but for a curved
 * one (e.g. a cylinder's circumferential surface) it can land measurably
 * off the true center -- close enough to the matching tolerance below to
 * risk a wrong or failed match. So FacePreview carries real `Face.center`
 * values (read directly from the same live solid the mesh itself came
 * from) rather than deriving descriptors from the mesh client-side the
 * way edge descriptors are. No operation/value fields, unlike FilletPick:
 * Shell/Draft each apply one shared parameter to their whole pick set,
 * not a per-element one. */
export type FacePick = [number, number, number];

/** `centers[i]` corresponds to `mesh.faceGroups[i]` -- guaranteed by
 * construction (both read from the same live solid instance in the same
 * call, in `.faces`/`.mesh()`'s own matching order, verified empirically),
 * not re-derived independently. `mesh` is what a face-picking overlay
 * renders (one highlighted region per faceGroup); `centers` is what a
 * student's pick actually records. */
export interface FacePreview {
  mesh: ShapeMesh;
  centers: FacePick[];
}

/** Assumes loadOC() has already resolved. See previewFaces's own doc. */
export function previewFacesMesh(shape: FilletBaseShape): FacePreview {
  const solid = buildFilletBaseSolid(shape);
  try {
    const mesh = solid.mesh(DEFAULT_MESH_OPTIONS);
    const centers = solid.faces.map((f: Face) => f.center.toTuple() as FacePick);
    return { mesh, centers };
  } finally {
    solid.delete();
  }
}

/** Full pipeline (load OC, build the base shape, export its faces as
 * pickable regions plus their real centers) for direct Node use -- the
 * same base shape a shell/draft call targets. Used to render the "Faces"
 * list/3D overlay a student picks from. */
export async function previewFaces(shape: FilletBaseShape): Promise<FacePreview> {
  await loadOC();
  return previewFacesMesh(shape);
}

/** Selects an arbitrary set of picked faces via a logical OR across one
 * `.near(point, tolerance)` filter per pick -- verified this correctly
 * selects exactly the picked faces (including a single one) on an
 * independently rebuilt solid, unlike chaining `.near()` calls directly
 * (which would AND them, requiring one face near every point at once). */
function buildFaceFinder(picks: FacePick[], tolerance: number) {
  return (f: FaceFinder) => f.either(picks.map((p) => (finder: FaceFinder) => finder.near(p, tolerance)));
}

/** Assumes loadOC() has already resolved. See shell's own doc. */
export function shellMesh(shape: FilletBaseShape, picks: FacePick[], thickness: number): CadMesh {
  const solid = buildFilletBaseSolid(shape);
  try {
    const shelled = solid.shell(thickness, buildFaceFinder(picks, toleranceFor(solid)));
    try {
      const mesh = shelled.mesh(DEFAULT_MESH_OPTIONS);
      return { vertices: mesh.vertices, faces: mesh.triangles };
    } finally {
      shelled.delete();
    }
  } finally {
    solid.delete();
  }
}

/** Full pipeline (load OC, then build+shell+mesh) for direct Node use.
 * Hollows out `shape`, removing the picked faces and leaving a wall of
 * `thickness`. Only needs OpenCascade, same as fillet/chamfer. */
export async function shell(shape: FilletBaseShape, picks: FacePick[], thickness: number): Promise<CadMesh> {
  await loadOC();
  return shellMesh(shape, picks, thickness);
}

/** Assumes loadOC() has already resolved. See draft's own doc. */
export function draftMesh(shape: FilletBaseShape, picks: FacePick[], angleDeg: number): CadMesh {
  const solid = buildFilletBaseSolid(shape);
  try {
    const drafted = solid.draft(angleDeg, buildFaceFinder(picks, toleranceFor(solid)), "XY");
    try {
      const mesh = drafted.mesh(DEFAULT_MESH_OPTIONS);
      return { vertices: mesh.vertices, faces: mesh.triangles };
    } finally {
      drafted.delete();
    }
  } finally {
    solid.delete();
  }
}

/** Full pipeline (load OC, then build+draft+mesh) for direct Node use.
 * Tapers the picked faces by `angleDeg`, measured from a neutral plane
 * fixed at world "XY" (no UI control this phase -- mirrors how Revolve's
 * own axis is fixed without exposing it). Verified empirically: a picked
 * face parallel to this plane (e.g. a box's own top face) throws an
 * opaque WebAssembly.Exception -- there's no "away from the plane"
 * direction to taper. A side face (a box's vertical wall, or a
 * cylinder's curved side) works reliably. Surfaces through the same
 * generic error-message path every other opaque WASM exception already
 * does -- no special handling added for it (see
 * docs/decisions/cad-kernel-shell-draft.md). */
export async function draft(shape: FilletBaseShape, picks: FacePick[], angleDeg: number): Promise<CadMesh> {
  await loadOC();
  return draftMesh(shape, picks, angleDeg);
}
