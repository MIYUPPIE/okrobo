# Decision: CAD Kernel — Phase 4 (Cut operations)

**Date:** 2026-09-05

## Choice

Add the boolean-subtraction counterpart to every Boss operation shipped so far: **Extruded Cut**, **Revolved Cut**, **Boundary Cut** — each removes a tool shape (built the same way its Boss counterpart builds a whole body) from an **existing** body, in place, rather than creating a new one. This looked architecturally blocked at first — Phases 1-3's `cad_mesh` bodies are baked, frozen triangle-mesh data, and a real boolean subtraction normally needs live B-rep solids on both sides, which baked data doesn't have. It isn't blocked: replicad exposes a second, mesh-native boolean path that sidesteps the B-rep question entirely.

## The real unlock: `MeshShape`, not `importSTL`

The obvious path — reconstruct a B-rep from the baked mesh via replicad's `importSTL`, then boolean against it — was rejected without needing to try it: `importSTL` builds a *faceted* B-rep approximation, so anything in the target that was originally curved (a cylinder, a torus) would come back polygonal, a real precision loss on top of what the bake already cost. The path actually used: replicad also ships `MeshShape`, a triangle-mesh-native shape backed by the [Manifold](https://github.com/elalish/manifold) library (a separate small mesh-boolean engine, not OpenCascade). `importSTLAsMesh` reconstructs a `MeshShape` directly from an STL blob — **zero additional precision loss**, since STL is itself a flat triangle format with nothing curved left to facet a second time. A freshly-built tool solid converts to a `MeshShape` via `.meshShape()` with no round-trip at all. `target.cut(tool)` runs the real boolean in Manifold; `.mesh()` gets the result back out as flat arrays. Confirmed end to end with a real scratch test before committing to the design: a baked box mesh reconstructed via `importSTLAsMesh`, a fresh off-center cylinder tool via `.meshShape()`, `target.cut(tool)`, re-meshed — a real 72-vertex result with a genuine hole, the box's own outer bounding box unchanged.

**New dependency: `manifold-3d`** (Apache-2.0, ~530KB WASM — confirmed via `npm view` before adding it, and again via the real production build, where it lands as its own `manifold-*.wasm` asset, ~532KB). Tiny next to OpenCascade's ~23MB; loaded lazily in the same Worker, same `loadManifold()`-mirrors-`loadOC()` pattern.

## `Solid.translate()` and cleanup, verified before writing `cutMesh`'s final body

Two real questions were resolved by a direct scratch call rather than assumed, matching this project's established discipline (the same posture that found the revolve-origin gotcha in Phase 3):
- **`translate()` returns a new object** — the pre-translate `Shape3D` is untouched and still needs its own `.delete()`. Verified: `translate() === original` is `false`.
- **The cut result stays fully usable after every input is deleted.** Verified: `targetMeshShape`, `toolMeshShape`, and the translated tool can all be deleted immediately after `cut()` returns, and `resultShape.mesh()` still produces the identical vertex count afterward. `cutMesh` deletes each input at its last use rather than holding everything until the end.

## Scope: "any body type" as a Cut target, not just already-`cad_mesh` bodies

The user chose this over restricting Cut to bodies already authored by Extrude/Revolve/Boundary — covering the actual common case (drilling a hole in a plain box) directly, since a student's first body is never a `cad_mesh` part. The bridge: `apps/studio/src/builder/geometryToMesh.ts` reuses `robotThree.ts`'s existing `geometryFor` (built for rendering every primitive type already) and reads its `BufferGeometry`'s position/index buffers back into the same flat `{vertices, faces}` shape the kernel already works with — no new tessellation code, no CAD kernel involved in this step at all. A body cut this way permanently becomes a baked `cad_mesh` part afterward (same as any Boss body) — there's no live feature tree yet (Phase 7) to remember it started as a box.

## `useCadPreview`/`CadProfileFields` retrofit, not three more copies

Each Cut creator needs the identical profile-authoring fields (Rectangle/Circle + dimensions) its Boss counterpart already has, plus a new Position (X/Y/Z, offset from the target's own local origin) block. Rather than writing the width/height-or-radius conditional block and its parse logic a 5th and 6th time, `apps/studio/src/builder/CadProfileFields.tsx` was extracted (the shared `parseProfileDraft`/`CadProfileDimensionFields`), and `CadExtrudeCreator`/`CadRevolveCreator`/`CadBoundaryCreator` were retrofitted to use it too — their own test suites re-ran unchanged afterward, confirming a pure internal refactor. Caught and fixed one real wording regression during the retrofit: the original `CadBoundaryCreator` produced "Start radius must be greater than 0" (lowercase field name after the prefix); the first draft of the shared function produced "Start Radius" (capitalized) — fixed before it could ship.

## A single-body pick, not a second copy of Add Joint's two-step

`BuilderViewport.tsx` gained a new `bodyPick` prop, structurally parallel to the existing `jointPick` (same miss-is-ignored, gizmo-stays-detached posture) but for exactly one pick, no parent-then-child. Kept as its own prop rather than unifying with `jointPick` — consistent with how Extrude/Revolve/Boundary each got their own toggle handler in `BuilderPanel.tsx` rather than a generic dispatcher forced onto already-shipped Add Joint code. A new `suppressedBodyId` prop hides the target's own real mesh while a Cut tool is previewing, so only the live cut-result ghost shows in its place — avoiding a confusing double-render of the original solid overlapping its own cut result.

## Non-goals

- **No recomputed mass/inertia after a Cut.** Same accepted simplification Boss bodies already ship with.
- **No undo of a Cut beyond deleting the body and re-adding it.** Still no live feature tree — Phase 7.
- **No cutting a body with another body already in the document.** Only a freshly-authored Extrude/Revolve/Boundary tool shape can be the cutting tool this phase, matching the roadmap's own framing.
- **No Fillet/Chamfer/Shell/Draft, no feature tree** — still Phases 5-7.
- **No `contracts/robot-def` schema change, no Python/C++/engine changes** — this phase is `apps/studio` only.
