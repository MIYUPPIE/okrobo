# Decision: CAD Kernel — Phase 3 (Revolve + Boundary)

**Date:** 2026-09-05

## Choice

Add two more real CAD operations to Build mode, reusing every piece of infrastructure Phase 2 already built: **Revolve** (a profile swept around the world Y axis — a lathe operation, e.g. a torus or a ring) and **Boundary** (a solid lofted between a Start and an End profile — e.g. a shape blending from a circle into a rectangle). Both route through the same `cad_mesh` contract, the same comlink Worker, and the same live-preview mechanism Extrude already proved out — this phase adds no new contract, Python, C++, or engine work, only `apps/studio` kernel/UI code.

## Two real geometry gotchas, found by running the code, not by reading documentation

`sketch.revolve(revolutionAxis, {origin, angle})`'s own doc comment says its `origin` "defaults to the sketch origin" — read literally, that sounds harmless. Empirically, it isn't: a profile placed at `{origin: [offset, 0, 0]}` and revolved with `origin` left at its default resolves to *that same offset point*, meaning the revolution axis runs straight through the profile's own center. For a full 360° sweep that's self-intersecting, and it threw a real (if unhelpfully opaque, bare `WebAssembly.Exception {}`) error the first time it was tried. The fix is one line — pass `origin: [0, 0, 0]` explicitly — and it was found only by writing a small scratch script, running it, getting the opaque throw, and bisecting the config down to this one field. `revolveMesh` (`apps/studio/src/cad/kernel.ts`) now always passes it explicitly, and its own doc comment records why, so nobody re-discovers this the hard way.

Separately, `Sketch.loftWith`'s own doc comment claims "all sketches will be deleted by this operation" — a real question for `loftMesh`, since calling `.delete()` a second time on an object OpenCascade's WASM bindings already freed would be a double-free. Verified directly: calling `.delete()` again on both the start and end sketches after a real `loftWith` call never throws, and the resulting solid stays fully usable either way. `loftMesh` deletes both explicitly regardless (matching `extrudeMesh`/`revolveMesh`'s own consistent "always clean up what you created" posture) — safe whether the doc comment turns out to be accurate or not.

## Offset must be at least the profile's own half-extent — enforced client-side, not just left to the worker

An `offset` smaller than the profile's own half-width (rectangle) or radius (circle) makes the revolution axis run through the profile itself — always self-intersecting, per the gotcha above. `CadRevolveCreator.tsx` rejects this locally (`"Offset must be at least half the width"` / `"...the radius"`) before ever calling the worker, the same posture Extrude's zero-dimension guard already established: a configuration that can never produce a valid solid never gets sent to OpenCascade in the first place.

## A shared `useCadPreview` hook, not a third copy of the debounce logic

`CadExtrudeCreator.tsx` already had a real, working ~25-line debounce/cancel/status lifecycle (parse locally → debounce → call the worker → track loading/ready/error, discarding a stale in-flight response). Revolve and Boundary need the *identical* lifecycle. Per this project's own repeated-success convention ("the third time is a command"), it was extracted into `apps/studio/src/builder/useCadPreview.ts` — and `CadExtrudeCreator` itself was retrofitted to use it, so all three creators now share one real, tested implementation instead of three near-identical copies. `CadExtrudeCreator.test.tsx`'s own suite re-ran unchanged after the retrofit, confirming it's a pure internal refactor with no external behavior change.

## Boundary allows independently-chosen Start/End profile shapes

The kernel cost of a cross-shape loft (circle → rectangle) versus a same-shape one (circle → circle) is zero — both were verified to produce real, correctly-bounded solids. There was no reason to artificially restrict `CadBoundaryCreator` to matching shapes, so Start and End are two fully independent profile pickers.

## Non-goals

- **No new profile shapes.** Rectangle/Circle only, matching Phases 1–2.
- **No sketch-plane picking, no arbitrary revolution axis.** Revolve always turns around the world Y axis through the origin; Boundary's End profile always sits directly above Start along Z.
- **No live re-editing of an Applied body's dimensions** — unchanged from Phase 2; still Phase 7's job.
- **No Cut (boolean) operations, no Fillet/Chamfer/Shell/Draft, no feature tree** — still Phases 4–7.
- **No `contracts/robot-def` schema change, no Python/C++/engine changes** — this phase is `apps/studio` only.
