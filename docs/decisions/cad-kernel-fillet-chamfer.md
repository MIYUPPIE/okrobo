# Decision: CAD Kernel — Phase 5 (Fillet + Chamfer)

**Date:** 2026-09-05

## Choice

Add Fillet (rounding) and Chamfer (beveling) as a real, edge-picking feature, shipped two ways: (1) an optional step inside each Boss creator (Extrude/Revolve/Boundary) that lets a student round or bevel edges of the shape they're building, before Apply bakes it, and (2) a new standalone "Fillet/Chamfer" tool that targets an already-placed **box or cylinder** body. The user picked the wider of two scoped options via `AskUserQuestion` — the narrower one would have shipped (1) only.

## The real constraint: fillet/chamfer need a live B-rep, which only exists mid-creation

`Solid.fillet()`/`.chamfer()` are operations on a live `Shape3D` (an OpenCascade B-rep) — verified they don't exist at all on `MeshShape` (Cut's own mesh-native output) or on any baked `{vertices, faces}` mesh. Every body already in the document (from Boss/Cut, or from a plain primitive) has exactly this baked shape, no live solid behind it. So Fillet/Chamfer can only target:

- **A fresh Boss shape, before Apply bakes it** — the Boss creator still has the live solid.
- **A body whose exact analytic parameters are already known** — a box (`size`) or a cylinder (`radius`/`length`) rebuilds via replicad's own `makeBox`/`makeCylinder` primitives with **zero information loss** (it's the identical shape, not an approximation), verified to produce the exact same bounding box `robotThree.ts`'s `geometryFor` already renders (box centered on all 3 axes; cylinder centered on Y — three.js's own default axis, no rotation applied there).

Sphere/cone/capsule/plane bodies, and any already-baked `cad_mesh` body, are out of scope: sphere has no edges at all; cone/capsule would need a real profile-revolve reconstruction for one marginal rim edge each; an arbitrary `cad_mesh` body has no analytic definition to rebuild from at all (the same faceting-loss problem Phase 4 already rejected for Cut). Revisit once a real feature tree exists (Phase 7).

## Identifying a picked edge: a geometric descriptor point, not `hashCode`

The obvious identifier — `Shape.hashCode` — was tried and rejected empirically: two independently-built, geometrically identical boxes produced **entirely different hash sets**. hashCode is tied to the OCC object instance, not the shape's geometry, so it can't survive the rebuild every preview recompute needs (this kernel is stateless throughout — no live solid handle is kept alive across worker RPC calls, matching every other CAD operation shipped so far).

The reliable identifier: a **geometric descriptor point** on the edge, re-found via `EdgeFinder.near(point, tolerance)`.
- A straight edge (`Shape3D.meshEdges()`'s own 2-point polyline group) — its **true midpoint** (the average of the two endpoints) is a unique, interior point. Verified: `near()` on either endpoint itself matched 2-3 edges at once (they're shared vertices — genuinely ambiguous); the midpoint matched exactly 1.
- A curved edge (a many-point polyline group) — any interior polyline sample (not an endpoint) is likewise unique.
- Verified this descriptor **survives an independent rebuild**: recorded on one box instance, re-found via `near()` on a separately-constructed, geometrically identical box, and successfully filleted there.

`apps/studio/src/builder/filletPicks.ts`'s `edgeGroupDescriptor()` implements this rule; `kernel.ts`'s `applyFilletPicks` re-derives the match on the server side via the callback form of replicad's own `RadiusConfig` (`(edge) => radius | null`, matching `edge.pointAt(0.5)` against each recorded point within a tolerance derived from the solid's own bounding-box diagonal — not a hardcoded absolute distance, so it scales correctly whether the part is 0.02 units or 10).

Verified multiple edges with **different values** in one `.fillet()` call this way, and a **chained** `.fillet(...).chamfer(...)` targeting different edges of the same base solid.

## Known limitation: mixing fillet and chamfer on adjacent edges can fail

Verified empirically (see `kernel.ts`'s `applyFilletPicks` doc comment): filleting one edge trims/moves its immediately adjacent edges — the blend surface replaces the shared vertex, so a chamfer recorded against the *pristine* shape can no longer find that neighbor on the *already-filleted* result. Replicad itself throws a clear `Error: Could not chamfer, no edge was selected` in this case, which surfaces through the exact same generic error-message path every other opaque WASM exception already does — no special handling was added. Two edges that don't share a vertex are unaffected regardless of order. Not fixed this phase (it would need per-pick topology tracking through each intermediate operation); flagged here as a known, gracefully-handled edge case rather than silently ignored.

## Edge-picking UI: a real DOM list is the pick mechanism, not a 3D click

Every prior pick interaction in this codebase (Add Joint's parent/child pick, Cut's body pick) already ships with a **real DOM element as the canonical, E2E-tested input path** — `.hierarchy-row`s, clickable in tests without simulating exact 3D camera-projected coordinates. There's no equivalent per-*edge* DOM element to reuse, so this phase adds one: `apps/studio/src/builder/FilletEdgeList.tsx` renders one row per edge ("Edge 1", "Edge 2", …); an unpicked row's "Add" button records that edge's own descriptor point (defaulting to Fillet, a small default value); a picked row shows an Operation select (Fillet/Chamfer) and a Value input. `BuilderViewport.tsx` gets a companion `edgeOverlay` prop — colored `THREE.Line`s per edge, recolored for already-picked ones — as a **visual-only aid** (no raycasting added to the viewport at all), so a student can see which 3D edge each row refers to without the feature needing a new, riskier hit-testing layer.

## Kernel additions (`apps/studio/src/cad/kernel.ts`)

- `buildToolSolid` (Phase 4, Cut-specific naming) extracted to `buildBossSolid(op: BossOperation)` — pure rename; `CutTool` is now a type alias for the extracted `BossOperation` union, no change to Cut's own shape.
- `FilletBaseShape = BossOperation | {operation:"box"; size} | {operation:"cylinder"; radius; length}`, `FilletPick = {point, operation, value}`, `previewEdges`/`fillet` (async, mirroring `revolve`/`loft`/`cut`'s own pipeline shape). Fillet/Chamfer only ever need `loadOC()` — Manifold (Cut's own mesh-boolean engine) never enters into this at all, confirmed by the production build: no new WASM asset landed this phase.

## `useCadPreview` made generic

Every fillet/chamfer-capable creator needs a **second**, independent debounced preview — the base shape's own pickable edges (`ShapeEdgeMesh`), never rebuilt when picks change, alongside the existing `CadMesh` preview that does. `useCadPreview<T = CadMesh>` now serves both; every pre-Phase-5 call site keeps compiling unchanged via the default type param.

## `CadPreview` gained an optional `rotation`

A small, directly-relevant side-fix: the ghost-preview effect in `BuilderViewport.tsx` only ever set `.position`, never `.rotation` — so editing an already-rotated body in place (Cut, and now Fillet/Chamfer's standalone tool) rendered a visually misaligned ghost, even though the final baked result was always correct (the baked geometry stays body-local; the body's own transform, rotation included, still applies after Apply). Fixed for both Cut's three creators and the new `CadFilletChamferEditor` by passing `rotation: targetBody.transform.rotation_rpy` alongside `position`; the three Boss creators pass nothing (new bodies are always created unrotated).

## Non-goals

- **No fillet/chamfer on an already-baked `cad_mesh` body, or on sphere/cone/capsule/plane bodies.** Revisit once a live feature tree exists (Phase 7).
- **No raycast-based 3D edge clicking** — `FilletEdgeList`'s DOM rows are the real, tested pick path.
- **No fix for the adjacent-edge fillet+chamfer limitation** — documented, gracefully surfaced, not solved.
- **No recomputed mass/inertia, no undo beyond delete-and-redo.** Same accepted simplification Boss/Cut bodies already ship with.
- **No `contracts/robot-def` schema change, no Python/C++/engine changes** — `apps/studio` only, same as Phases 2-4.
