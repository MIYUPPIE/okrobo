// CAD Kernel Phase 7.2: the live-recompute executor. Replays a whole
// Body.features[] history (contracts/robot-def/v2, CAD Kernel Phase 7.1)
// into ONE continuous live OpenCascade B-rep pipeline -- the previous
// step's own live Shape3D feeds directly into the next step's own
// operation, never round-tripping through a baked mesh mid-chain the way
// every single-shot kernel.ts function (and the standalone Cut creators'
// own geometryToMesh bridge) still does for a single isolated operation.
// This is what makes Cut a real B-rep boolean here (replicad's own
// Shape3D.cut(), operating on two live solids) instead of cutMesh's own
// Manifold mesh-boolean-via-STL-roundtrip -- that path stays exactly as
// it is for its own callers (the standalone Cut creators can target ANY
// existing body, cad_mesh included, which the executor's own root-replay
// approach cannot), this module is purely additive.
//
// The harder half: fillet_chamfer/shell/draft each need to know, once
// applied, whether their OWN picked edges/faces are still real,
// resolvable topology afterward -- the exact question CAD Kernel Phase
// 7.3 will need answered for a DOWNSTREAM pick once an upstream step gets
// edited (does the edge that pick pointed at still exist, and if it
// moved, where to). replicad's own `.fillet()`/`.chamfer()`/`.shell()`/
// `.draft()` convenience wrappers destroy their underlying OpenCascade
// builder object before returning (verified by reading replicad's own
// source) -- its `Modified()`/`Generated()`/`IsDeleted()` history is
// unreachable through that public API. So this module reimplements each
// of those four operations directly against the raw OpenCascade builder
// classes (reachable via replicad's own exported `getOC()`, no fork
// needed), keeping the builder alive just long enough to query that
// history before disposing it -- see resolveAfterOperation's own doc for
// the exact algorithm, verified empirically against real OpenCascade WASM
// for all five operations (fillet, chamfer, cut, shell, draft). See
// docs/decisions/cad-kernel-live-recompute-executor.md.

import { asDir, downcast, Edge, Face, getOC, makePlane, makePln, Solid, type Shape3D } from "replicad";
import type { NCollection_List_TopoDS_Shape, TopoDS_Edge, TopoDS_Face, TopoDS_Shape } from "replicad-opencascadejs";
import type { CadPick, Feature, FilletChamferPick } from "../contracts/robotDef";
import {
  buildBossSolid,
  buildFilletBaseSolid,
  DEFAULT_MESH_OPTIONS,
  loadOC,
  toleranceFor,
  type BossOperation as KernelBossOperation,
  type CadMesh,
  type FilletBaseShape,
} from "./kernel";

const DEG2RAD = Math.PI / 180;

function distance(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Drains an OpenCascade shape list into a plain array -- verified
 * empirically this binding exposes no iterator or indexed getter for
 * NCollection_List_TopoDS_Shape, only First()/RemoveFirst()/IsEmpty();
 * destructive, but always called on a fresh list returned by a single
 * Modified()/Generated() call, never shared state. */
function shapesFromList(list: NCollection_List_TopoDS_Shape): TopoDS_Shape[] {
  const shapes: TopoDS_Shape[] = [];
  while (!list.IsEmpty()) {
    shapes.push(list.First());
    list.RemoveFirst();
  }
  list.delete();
  return shapes;
}

/** One pick's resolved fate after the single operation that owned it was
 * applied -- "ok" with the pick's own up-to-date geometric point (possibly
 * different from what was recorded, if the operation moved/replaced the
 * underlying topology), or "deleted" when nothing in the operation's own
 * output corresponds to it at all. This is the exact primitive CAD Kernel
 * Phase 7.3 will need for a downstream pick once an upstream step is
 * edited -- exercised here for every pick against the very operation that
 * consumed it, not yet wired into a "recompute after an edit" flow (no UI
 * can trigger an edit yet; that's 7.3's own scope). */
export type PickResolution = { status: "ok"; point: [number, number, number] } | { status: "deleted" };

/** The minimal shape every OpenCascade "MakeShape"-family builder exposes
 * (BRepFilletAPI_MakeFillet/MakeChamfer, BRepOffsetAPI_MakeThickSolid,
 * BRepOffsetAPI_DraftAngle, and BRepAlgoAPI_Cut, all confirmed to extend
 * BRepBuilderAPI_MakeShape transitively in replicad-opencascadejs's own
 * generated bindings) -- narrowed to just the three history methods this
 * module actually calls. */
export interface HistorySource {
  Modified(shape: TopoDS_Shape): NCollection_List_TopoDS_Shape;
  Generated(shape: TopoDS_Shape): NCollection_List_TopoDS_Shape;
  IsDeleted(shape: TopoDS_Shape): boolean;
}

/** Modified()/Generated() return the general TopoDS_Shape base type, but
 * -- verified empirically, and geometrically obvious in hindsight -- the
 * CANDIDATE's own concrete kind does not always match the ORIGINAL
 * entity's kind: filleting/chamfering an EDGE replaces it with a new
 * blend/bevel FACE (the edge itself doesn't survive as an edge at all,
 * it "generates" a face). So each candidate's own real shape type
 * (`ShapeType()`) decides how to read its point -- an edge's own
 * `pointAt(0.5)`, or a face's own `center` -- rather than assuming it
 * matches the pick's original kind. replicad's own exported `downcast()`
 * performs the real OpenCascade-level type-narrowing cast a plain `as`
 * TypeScript cast can't (Embind's own binding rejects a TopoDS_Shape
 * instance where a TopoDS_Edge/TopoDS_Face is strictly expected). */
function pointOfRawShape(raw: TopoDS_Shape): [number, number, number] {
  const oc = getOC();
  const shapeType = raw.ShapeType();
  if (shapeType === oc.TopAbs_ShapeEnum.TopAbs_EDGE) {
    const edge = new Edge(downcast(raw) as TopoDS_Edge);
    const point = edge.pointAt(0.5).toTuple() as [number, number, number];
    edge.delete();
    return point;
  }
  if (shapeType === oc.TopAbs_ShapeEnum.TopAbs_FACE) {
    const face = new Face(downcast(raw) as TopoDS_Face);
    const point = face.center.toTuple() as [number, number, number];
    face.delete();
    return point;
  }
  throw new Error("cad executor: an operation's own history referenced a shape that's neither an edge nor a face");
}

/** Resolves what a specific, already-known raw edge or face became after
 * one operation, using that operation's own builder history when it has
 * any, falling back to a plain geometric near() rematch against the
 * operation's own OUTPUT shape when it doesn't.
 *
 * Verified empirically (all five operations, real OpenCascade WASM) that
 * these two paths are BOTH needed, for different reasons:
 * - BRepFilletAPI_MakeFillet/MakeChamfer and BRepOffsetAPI_DraftAngle only
 *   ever record history for entities their own operation actually touched
 *   -- Modified()/Generated() come back empty (and IsDeleted() comes back
 *   true, which is NOT the same as "genuinely removed") for anything
 *   untouched, even though that untouched entity plainly still exists,
 *   unchanged, in the output. The near() fallback correctly finds it.
 * - BRepOffsetAPI_MakeThickSolid (shell) DOES report a real, geometrically
 *   meaningful Modified() entry even for the face passed in as "to
 *   remove" -- it doesn't vanish without trace, it becomes the thin rim
 *   face connecting the opening's outer boundary to the offset inner
 *   wall. Trusting Modified()/Generated() here (not falling back to
 *   near(), which could easily miss a small rim face) is what correctly
 *   answers "this face's own single successor" instead.
 * - BRepAlgoAPI_Cut (used internally by replicad's own Shape3D.cut(), not
 *   reimplemented by this module since Cut carries no picks to resolve)
 *   reports Modified() for essentially every face, touched or not --
 *   consistent with the same history-first algorithm, never needs the
 *   near() fallback in practice.
 * - A genuinely fully-consumed entity (verified: a cut tool that entirely
 *   engulfs a face) reports empty Modified()/Generated() AND IsDeleted()
 *   true AND no near() match either -- correctly falls through to
 *   "deleted".
 *
 * When Modified()+Generated() together yield more than one candidate
 * (e.g. an operation splitting one face into several), the candidate
 * whose own point is geometrically closest to the original is chosen --
 * "wherever the picked spot itself ended up", not an arbitrary pick from
 * the list.
 *
 * Exported (alongside HistorySource) for direct testing against a
 * hand-built raw OpenCascade scenario -- mirrors kernel.ts's own
 * `*Mesh`-suffixed synchronous exports, callable without the async
 * loadOC() wrapper this module's own applyFilletChamfer/applyShell/
 * applyDraft/replayFeaturesSync already assume has resolved. */
export function resolveAfterOperation(
  builder: HistorySource,
  original: TopoDS_Shape,
  originalPoint: readonly [number, number, number],
  kind: "edge" | "face",
  output: Shape3D,
  tolerance: number,
): PickResolution {
  const candidates = [...shapesFromList(builder.Modified(original)), ...shapesFromList(builder.Generated(original))];
  if (candidates.length > 0) {
    let best: [number, number, number] | null = null;
    let bestDistance = Infinity;
    for (const raw of candidates) {
      const point = pointOfRawShape(raw);
      const d = distance(point, originalPoint);
      if (d < bestDistance) {
        bestDistance = d;
        best = point;
      }
    }
    return { status: "ok", point: best as [number, number, number] };
  }
  const pool = kind === "edge" ? output.edges : output.faces;
  const stillThere = pool.some((entity) => {
    const point = (kind === "edge" ? (entity as Edge).pointAt(0.5).toTuple() : (entity as Face).center.toTuple()) as [number, number, number];
    return distance(point, originalPoint) < tolerance;
  });
  return stillThere ? { status: "ok", point: [originalPoint[0], originalPoint[1], originalPoint[2]] } : { status: "deleted" };
}

function findEdgeNear(solid: Shape3D, point: readonly [number, number, number], tolerance: number): Edge {
  const match = solid.edges.find((e) => distance(e.pointAt(0.5).toTuple() as [number, number, number], point) < tolerance);
  if (!match) throw new Error(`cad executor: no edge found near [${point.join(", ")}]`);
  return match;
}

function findFaceNear(solid: Shape3D, point: readonly [number, number, number], tolerance: number): Face {
  const match = solid.faces.find((f) => distance(f.center.toTuple() as [number, number, number], point) < tolerance);
  if (!match) throw new Error(`cad executor: no face found near [${point.join(", ")}]`);
  return match;
}

/** One step's own outcome: which Feature it replayed, and (for
 * fillet_chamfer/shell/draft only -- root features and cut carry no
 * picks) how each of its own picks, in the same order as `feature.picks`,
 * resolved once this step's operation was applied. */
export interface FeatureStepResult {
  index: number;
  feature: Feature;
  resolvedPicks: PickResolution[];
}

export interface ReplayResult {
  mesh: CadMesh;
  steps: FeatureStepResult[];
}

function rootShapeFromFeature(feature: Feature): FilletBaseShape {
  switch (feature.operation) {
    case "extrude":
      return { operation: "extrude", profile: feature.profile, depth: feature.depth };
    case "revolve":
      return { operation: "revolve", profile: feature.profile, offset: feature.offset, angleDeg: feature.angle_deg };
    case "loft":
      return { operation: "loft", startProfile: feature.start_profile, endProfile: feature.end_profile, height: feature.height };
    case "box":
      return { operation: "box", size: feature.size };
    case "cylinder":
      return { operation: "cylinder", radius: feature.radius, length: feature.length };
    default:
      throw new Error(`cad executor: the first feature must be a root kind (extrude/revolve/loft/box/cylinder), got '${feature.operation}'`);
  }
}

function bossOperationFromTool(tool: Extract<Feature, { operation: "cut" }>["tool"]): KernelBossOperation {
  if (tool.operation === "extrude") return { operation: "extrude", profile: tool.profile, depth: tool.depth };
  if (tool.operation === "revolve") return { operation: "revolve", profile: tool.profile, offset: tool.offset, angleDeg: tool.angle_deg };
  return { operation: "loft", startProfile: tool.start_profile, endProfile: tool.end_profile, height: tool.height };
}

/** Cut carries no picks -- replicad's own live-B-rep Shape3D.cut() (used
 * by every real Boolean op in this codebase's own dependency, not a raw
 * OpenCascade builder) is all this needs, since there's no history to
 * harvest for anything. Keeping the whole chain in live B-rep (rather
 * than cutMesh's own Manifold-mesh-via-STL-roundtrip) is the point --
 * every later step's own edges/faces resolve reliably off a real solid. */
function applyCut(current: Shape3D, feature: Extract<Feature, { operation: "cut" }>): Shape3D {
  const untranslatedTool = buildBossSolid(bossOperationFromTool(feature.tool));
  const tool = untranslatedTool.translate(feature.position[0], feature.position[1], feature.position[2]);
  untranslatedTool.delete();
  const next = current.cut(tool);
  tool.delete();
  return next;
}

/** Fillets first, then chamfers -- matching kernel.ts's own
 * applyFilletPicks exactly, including its own documented limitation
 * (mixing fillet+chamfer on edges sharing a vertex can fail: filleting
 * one moves/trims its neighbor, so a chamfer pick's own recorded point
 * can no longer near()-match it on the already-filleted result). Reuses
 * raw oc.BRepFilletAPI_MakeFillet/MakeChamfer directly (mirroring
 * replicad's own internal filletShape/chamferShape implementations,
 * verified by reading replicad's own source) instead of
 * Shape3D.fillet()/.chamfer(), so each builder survives long enough to
 * resolve its own picks' history before being disposed. Every matched
 * Edge wrapper is kept alive (not deleted) until after that history
 * lookup -- its own raw handle is what Modified()/Generated() must be
 * queried with, and deleting the wrapper early would invalidate it. */
function applyFilletChamfer(current: Shape3D, feature: Extract<Feature, { operation: "fillet_chamfer" }>): { next: Shape3D; resolvedPicks: PickResolution[] } {
  const oc = getOC();
  const tolerance = toleranceFor(current);
  const resolvedPicks: PickResolution[] = new Array(feature.picks.length);

  const filletIndices = feature.picks.map((p, i) => [p, i] as const).filter(([p]) => p.operation === "fillet");
  let afterFillet = current;
  const filletEdges: Edge[] = [];
  if (filletIndices.length > 0) {
    const builder = new oc.BRepFilletAPI_MakeFillet(current.wrapped, oc.ChFi3d_FilletShape.ChFi3d_Rational);
    for (const [pick] of filletIndices) {
      const edge = findEdgeNear(current, pick.point, tolerance);
      filletEdges.push(edge);
      builder.Add(pick.value, edge.wrapped);
    }
    const resultRaw = builder.Shape();
    afterFillet = new Solid(resultRaw);
    filletIndices.forEach(([pick, i], j) => {
      resolvedPicks[i] = resolveAfterOperation(builder, filletEdges[j].wrapped, pick.point, "edge", afterFillet, tolerance);
    });
    builder.delete();
    for (const edge of filletEdges) edge.delete();
  }

  const chamferIndices = feature.picks.map((p, i) => [p, i] as const).filter(([p]) => p.operation === "chamfer");
  let result = afterFillet;
  const chamferEdges: Edge[] = [];
  if (chamferIndices.length > 0) {
    const chamferTolerance = toleranceFor(afterFillet);
    const builder = new oc.BRepFilletAPI_MakeChamfer(afterFillet.wrapped);
    for (const [pick] of chamferIndices) {
      const edge = findEdgeNear(afterFillet, pick.point, chamferTolerance);
      chamferEdges.push(edge);
      builder.Add(pick.value, edge.wrapped);
    }
    const resultRaw = builder.Shape();
    result = new Solid(resultRaw);
    chamferIndices.forEach(([pick, i], j) => {
      resolvedPicks[i] = resolveAfterOperation(builder, chamferEdges[j].wrapped, pick.point, "edge", result, chamferTolerance);
    });
    builder.delete();
    for (const edge of chamferEdges) edge.delete();
  }
  if (afterFillet !== current && afterFillet !== result) afterFillet.delete();

  return { next: result, resolvedPicks };
}

/** Raw oc.BRepOffsetAPI_MakeThickSolid, mirroring replicad's own internal
 * shellShape implementation (verified by reading replicad's own source)
 * so the builder survives long enough to resolve each picked face's own
 * history (verified empirically: even the removed/opening face itself
 * gets a real, meaningful Modified() entry -- the thin rim face left
 * around the opening, not nothing). Every matched Face wrapper is kept
 * alive until after that history lookup, same reasoning as
 * applyFilletChamfer's own edges. */
function applyShell(current: Shape3D, feature: Extract<Feature, { operation: "shell" }>): { next: Shape3D; resolvedPicks: PickResolution[] } {
  const oc = getOC();
  const tolerance = toleranceFor(current);
  const faces = feature.picks.map((pick) => findFaceNear(current, pick.point, tolerance));
  const facesToRemove = new oc.NCollection_List_TopoDS_Shape();
  for (const face of faces) facesToRemove.Append(face.wrapped);

  const builder = new oc.BRepOffsetAPI_MakeThickSolid();
  builder.MakeThickSolidByJoin(
    current.wrapped,
    facesToRemove,
    -feature.thickness,
    0.001,
    oc.BRepOffset_Mode.BRepOffset_Skin,
    false,
    false,
    oc.GeomAbs_JoinType.GeomAbs_Arc,
    false,
  );
  const resultRaw = builder.Shape();
  const next = new Solid(resultRaw);
  const resolvedPicks = feature.picks.map((pick, i) => resolveAfterOperation(builder, faces[i].wrapped, pick.point, "face", next, tolerance));
  facesToRemove.delete();
  builder.delete();
  for (const face of faces) face.delete();
  return { next, resolvedPicks };
}

/** Raw oc.BRepOffsetAPI_DraftAngle, mirroring replicad's own internal
 * draftShape implementation exactly (including its own plane/direction
 * disposal sequence and its use of ModifiedShape(originalShape) rather
 * than Shape() to read back the result -- verified by reading replicad's
 * own source). Neutral plane fixed at world "XY", same as kernel.ts's own
 * single-shot draft (no picker exposed, mirrors Revolve's own fixed
 * axis) -- a picked face parallel to it throws the same opaque
 * WebAssembly.Exception every other opaque WASM error in this codebase
 * already surfaces through, not specially handled here either. */
function applyDraft(current: Shape3D, feature: Extract<Feature, { operation: "draft" }>): { next: Shape3D; resolvedPicks: PickResolution[] } {
  const oc = getOC();
  const tolerance = toleranceFor(current);
  const faces = feature.picks.map((pick) => findFaceNear(current, pick.point, tolerance));
  const inputPlane = makePlane("XY");
  const plane = makePln(inputPlane.origin, inputPlane.zDir);
  const direction = asDir(inputPlane.zDir);
  const builder = new oc.BRepOffsetAPI_DraftAngle(current.wrapped);
  for (const face of faces) builder.Add(face.wrapped, direction, feature.angle_deg * DEG2RAD, plane, false);
  builder.Build();
  const resultRaw = builder.ModifiedShape(current.wrapped);
  const next = new Solid(resultRaw);
  const resolvedPicks = feature.picks.map((pick, i) => resolveAfterOperation(builder, faces[i].wrapped, pick.point, "face", next, tolerance));
  builder.delete();
  plane.delete();
  direction.delete();
  inputPlane.delete();
  for (const face of faces) face.delete();
  return { next, resolvedPicks };
}

/** Assumes loadOC() has already resolved. See replayFeatures's own doc. */
export function replayFeaturesSync(features: Feature[]): ReplayResult {
  if (features.length === 0) throw new Error("cad executor: replayFeatures needs at least one feature");

  let current = buildFilletBaseSolid(rootShapeFromFeature(features[0]));
  const steps: FeatureStepResult[] = [{ index: 0, feature: features[0], resolvedPicks: [] }];

  for (let i = 1; i < features.length; i++) {
    const feature = features[i];
    let next: Shape3D;
    let resolvedPicks: PickResolution[] = [];
    if (feature.operation === "cut") {
      next = applyCut(current, feature);
    } else if (feature.operation === "fillet_chamfer") {
      ({ next, resolvedPicks } = applyFilletChamfer(current, feature));
    } else if (feature.operation === "shell") {
      ({ next, resolvedPicks } = applyShell(current, feature));
    } else if (feature.operation === "draft") {
      ({ next, resolvedPicks } = applyDraft(current, feature));
    } else {
      throw new Error(`cad executor: feature at index ${i} must be a modifier kind (cut/fillet_chamfer/shell/draft), got '${feature.operation}'`);
    }
    current.delete();
    current = next;
    steps.push({ index: i, feature, resolvedPicks });
  }

  try {
    const mesh = current.mesh(DEFAULT_MESH_OPTIONS);
    return { mesh: { vertices: mesh.vertices, faces: mesh.triangles }, steps };
  } finally {
    current.delete();
  }
}

/** Full pipeline (load OC, then replay) for direct Node/Worker use --
 * regenerates a cad_mesh body's own baked mesh purely from its recorded
 * `features` history (CAD Kernel Phase 7.1), keeping the entire chain in
 * one live OpenCascade B-rep pipeline rather than the independent,
 * mesh-round-tripping single-shot calls each creator made when the body
 * was first authored. Only needs OpenCascade -- Cut here is a real B-rep
 * boolean (replicad's own Shape3D.cut()), not Manifold's mesh boolean, so
 * loadManifold() is never required. */
export async function replayFeatures(features: Feature[]): Promise<ReplayResult> {
  await loadOC();
  return replayFeaturesSync(features);
}

// Re-exported so callers (and tests) that only need the contract-level
// pick types don't need a second import from ../contracts/robotDef.
export type { CadPick, FilletChamferPick };
