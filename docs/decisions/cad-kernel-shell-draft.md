# Decision: CAD Kernel — Phase 6 (Shell + Draft)

**Date:** 2026-09-06

## Choice

Add Shell (hollow out a body, removing picked faces, leaving a wall of a given thickness) and Draft (taper picked faces by an angle) as two new standalone tools, each targeting an already-placed **box or cylinder** body — the same exactly-reconstructable mechanism `CadFilletChamferEditor.tsx` already uses. Unlike Fillet/Chamfer (Phase 5), neither gets an embedded step inside the Boss creators (Extrude/Revolve/Boundary) this phase — the user chose that narrower scope via `AskUserQuestion`.

## Why no embedded Boss-creator step this time

Shell and Draft are both **global-parameter** operations: one thickness, or one angle, applied to the whole pick set — unlike Fillet/Chamfer's own per-edge value. Embedding either as a further optional step inside a Boss creator (on top of Phase 5's own optional Fillet/Chamfer step) raises real, unresolved ordering questions with no obvious default: does Shell run before or after a fillet already picked on the same shape? Do the fillet's own picked edges survive a Shell that removes or reshapes the faces they sit on? Rather than guess at an answer, the user picked the cleaner, narrower scope — both ship only as standalone tools this phase.

## Faces, not edges: `Face.center` matters more here than `Edge.pointAt(0.5)` did

Same live-B-rep constraint as Phase 5 (`Solid.shell()`/`.draft()` only exist on a `Shape3D`, never on a baked mesh), and the same core identification approach — a geometric descriptor point, re-found via `FaceFinder.near(point, tolerance)` on a freshly rebuilt solid, since `Shape.hashCode` is (again, verified) unstable across independent rebuilds.

The one real difference from edges: a face's own **mesh-triangulated centroid** (averaging the vertices in its `ShapeMesh.faceGroups` triangle range) is *not* a safe stand-in for the exact `Face.center` the way an edge's own polyline sample was safe for edges. Verified empirically: for a box's planar faces, the mesh centroid matches `Face.center` almost exactly (sub-micron noise) — but for a cylinder's curved side face, the mesh centroid was measurably off (~0.054 units on a bounding-box diagonal of ~11.7, uncomfortably close to the `diagonal * 0.005` matching tolerance). A tessellated curved surface's own vertex average doesn't land exactly at the analytic center the way a polyline sample lies exactly on its curve. So `kernel.ts`'s `previewFaces()` returns real `Face.center` values (read directly from the live solid) alongside the mesh, and `CadFaceOverlay`/`FacePickList` carry those exact centers through end to end — never re-deriving a descriptor from the mesh client-side.

## Multi-face selection: `.either()`, verified

`shell`/`draft` both need to select an *arbitrary set* of picked faces, not just one. Chaining `.near()` calls directly would `AND` them (requiring one face near every point at once) — the fix is `FaceFinder.either([...])`, a logical OR across one `.near(point, tolerance)` filter per pick. Verified this correctly selects exactly the picked faces (including a single one) on an independently rebuilt solid, for both shell (removing 1 or 2 faces) and draft (tapering 1 or 2 faces).

## A real, graceful-failure gotcha: draft vs. a parallel neutral plane

`.draft(angle, faceFinder, neutralPlane)` throws an opaque `WebAssembly.Exception` when a picked face is parallel to the neutral plane — there's no "away from the plane" direction to taper. Verified: a box's own top face (parallel to the default "XY" plane) throws; a side wall, or a cylinder's curved side, works reliably against that same plane. The tool fixes the neutral plane at world "XY" (no picker exposed this phase, mirroring how Revolve's own axis is fixed without exposing it) — the common case (tapering a box or cylinder's own side walls) just works, and a parallel pick surfaces a real error through the same generic error-message path every other opaque WASM exception in this codebase already uses. Not specially caught or prevented client-side.

## Kernel additions (`apps/studio/src/cad/kernel.ts`)

- `toleranceFor(solid)` extracted from `applyFilletPicks`'s own inline bounding-box-diagonal calculation — now shared by fillet/chamfer picks, shell, and draft (a third caller needing the identical formula).
- `FacePick = [number, number, number]` (no operation/value fields, unlike `FilletPick` — Shell/Draft apply one shared parameter, not a per-element one), `FacePreview = {mesh: ShapeMesh; centers: FacePick[]}` (`centers[i]` matches `mesh.faceGroups[i]` by construction — both read off the same live solid in one call), `previewFaces`/`shell`/`draft` (async, mirroring `previewEdges`/`fillet`'s own pipeline shape). All three only ever need `loadOC()` — confirmed via the production build landing no new WASM asset.

## UI: `FacePickList` (a toggle, not `FilletEdgeList`'s Add/configure) and one shared `CadFacePickEditor`

`FacePickList.tsx` mirrors `FilletEdgeList.tsx`'s role (the real, DOM-driven, E2E-tested pick path; the 3D viewport's own face overlay is a visual-only aid, same posture as the edge overlay, no raycasting) but simpler — a row is just a Select/Deselect toggle, no per-row Operation/Value fields. Shell and Draft are structurally identical standalone editors otherwise (pick some faces, author one shared numeric parameter, Apply replaces the target's geometry in place via the existing `replaceBodyGeometry`) — one shared `CadFacePickEditor.tsx`, parameterized by title/value-label/validation/which kernel call to make, serves both rather than two near-duplicate files.

## Non-goals

- **No embedded Shell/Draft step inside Extrude/Revolve/Boundary** — standalone tools only, per the scope decision above.
- **No neutral-plane picker for Draft** — fixed at world "XY"; a parallel pick throws a readable-enough error, not specially handled.
- **No shell/draft on sphere/cone/capsule/plane bodies or already-baked `cad_mesh` bodies** — same reasoning as Fillet/Chamfer (no exact reconstruction, or no live B-rep at all).
- **No recomputed mass/inertia, no undo beyond delete-and-redo.** Same accepted simplification every prior phase ships with.
- **No `contracts/robot-def` schema change, no Python/C++/engine changes** — `apps/studio` only.
