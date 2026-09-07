# Decision: CAD Kernel — Phase 7.3 (edit-any-step + live recompute)

**Date:** 2026-09-07

## Scope

Per `cad-kernel-feature-tree-data-model.md`'s own roadmap, 7.3 is "wire the 7.1 panel to be interactive: click any step, reopen its own editor pre-filled, edit, recompute the whole chain from there via the 7.2 executor. Real 'rebuild error' UX when a downstream pick's edge/face genuinely no longer exists." This delivers exactly that, for all 9 feature kinds a body can record (box/cylinder root, extrude/revolve/loft root, cut, fillet_chamfer, shell, draft) — every one of `FeatureTreeList`'s own rows is now clickable and re-editable. It does **not** touch reordering, insertion, or deletion of a step — that's 7.4.

## The shared `editing` prop: one convention, nine components

Every creator/editor gained an optional `editing` prop instead of a parallel "edit mode" component per kind. Shape varies only by what each feature kind actually needs:

- `{feature, stepIndex, allFeatures, targetBodyId?, onApply}` — `targetBodyId` is included only where the component doesn't already carry a top-level target-body prop of its own (Boss root creators); Cut/FilletChamfer/FacePick editors already have one and reuse it.
- Present: the draft seeds from `feature`, create-only UI (embedded fillet section on a Boss creator, body-picking hint) hides, Apply calls `editing.onApply(builtFeature)` instead of the normal `makeCadBody`/`replaceBodyGeometry` path, and the panel's own title switches to "Edit X".
- Absent: every component behaves exactly as it did before this phase — this is additive, not a rewrite of the create path.

One new component was needed with no create-mode equivalent at all: `CadPrimitiveRootEditor.tsx`, for editing a body's own recorded `box`/`cylinder` root feature (a bare primitive is never "created" through a CAD creator in the first place — it's the Add Body default).

## The bug caught before it shipped: preview must replay the WHOLE chain, never the isolated step

The first pass through every edit-mode preview called the same single-shot per-operation function the create path already used (`extrudeRectangle`, `fillet(shape, picks)`, etc.) — this only shows what the edited step's own output looks like in isolation, never reflecting any downstream step (a shell/draft/cut recorded after it) that would still apply on top once Apply commits. A body with `[Box, Shell]` being edited at the Box step would preview a bare resized box, not the resized-and-still-shelled result Apply actually produces — a materially misleading preview.

Caught by spawning an independent Explore subagent specifically to verify the claim before continuing to build more components on the same flawed assumption, rather than discovering it later as a harder-to-diagnose UI complaint. Fixed by rewriting every edit-mode preview, in every one of the 9 components, to build `allFeatures.map((f, i) => i === stepIndex ? nextFeature : f)` and call `replayFeatures()` (executor.ts, Phase 7.2) on the whole array — the exact same function Apply itself uses via `recomputeFeatureStep`. Preview and commit now share one code path; they cannot silently diverge.

## Re-opening an existing step needs its own pickable geometry: prefix replay

A fillet_chamfer/shell/draft step's own picks were originally found on the shape as it existed right *before* that step ran. By the time any such step is recorded, the target body's current geometry is already a baked `cad_mesh` — there is no live B-rep left on the body itself to re-pick edges/faces from. `executor.ts` gained `previewEdgesAtStep(features, stepIndex)` / `previewFacesAtStep(features, stepIndex)`, each replaying `features.slice(0, stepIndex)` (a real prefix of the body's own recorded history) into a live shape purely to mesh its current edges/faces for that step's own editor to pick from — mirroring `kernel.ts`'s own `previewEdgesMesh`/`previewFacesMesh`, just against a replayed prefix instead of a single fresh primitive. Both are built on a newly-extracted `replayToShape(features)`, the shared core `replayFeaturesSync` and the two preview functions all now call.

## Real rebuild-error UX: attribution already existed, this phase surfaces it

Phase 7.2's `withStepContext` already wraps every step's own build/apply call inside `replayFeatures`, re-throwing as `"cad executor: step ${index} (${feature.operation}) failed to rebuild: ${message}"`. `recomputeFeatureStep.ts` (new) is the one function every edit-mode Apply calls through: it swaps the edited feature into the body's own array, calls `replayFeatures`, and on rejection returns `{ok: false, message}` instead of throwing — a plain, readable, already-step-attributed message, surfaced through the exact same generic error-message UI every other opaque OpenCascade failure in this codebase already uses (`.cad-status.error`). No special-casing was needed; 7.2's own design already produced the right message shape.

## Confirmed empirically (again): tolerance is tiny relative to a shape's own diagonal, so a same-axis edit almost always breaks a pick

Real-browser E2E testing in this phase surfaced (not a bug — a re-confirmation of a design already established in Phase 5/6, now observed for the first time in the specific shape "resize a root, keep a downstream pick"): `toleranceFor(solid) = diagonal * 0.005` (`kernel.ts`) is small enough that ANY edit moving a picked face/edge along the same axis its own position depends on will, in practice, always exceed it — even a "modest" change. Concretely: a 0.05m box shelled on its own −X face (recorded pick at `x = -0.025`, exactly half the box's own size) has that pick reliably broken by resizing Size X to 0.08 (`x` moves to −0.04, ~0.15 away vs. a tolerance on the order of `diagonal * 0.005 ≈ 0.0004`) — while resizing Size Y or Z, axes that face's own position never depends on, leaves the same pick fully intact. This is accepted, documented behavior, the same way Phase 5/6 documented adjacent-edge and parallel-face pick ambiguity rather than "fixing" it: a point-based geometric pick is inherently coupled to the exact geometry it was taken from, and an edit that moves that geometry along the pick's own axis is expected to require re-picking, not silently reinterpreted. `scripts/lib/studio-e2e-check.mjs`'s own edit-any-step section exercises both cases directly (Size Y/Z edit survives; Size X edit correctly surfaces a rebuild error).

## Non-goals

- **No reordering, insertion, or deletion of a step at any position.** Phase 7.4's job.
- **No change to the create path for any of the 9 components when `editing` is absent** — confirmed by the full pre-existing create-mode test suites for every one of them still passing unmodified.
- **No new topological-identity mechanism.** Still `resolveAfterOperation`'s history-first-then-geometric-fallback design from 7.2, unchanged.

## Verification

`apps/studio`: `npm run typecheck`, `npm run test` (all suites green, including 6 new tests in `recomputeFeatureStep.test.ts`, 3 in `executor.test.ts`'s new `previewEdgesAtStep`/`previewFacesAtStep` describe block, 3 in `cadClient.test.ts`, 3 in `FeatureTreeList.test.tsx`, 1 in `BodyInspector.test.tsx`, 3 each in all 9 creator/editor `.test.tsx` files, 6 in `BuilderPanel.test.tsx`'s new "Feature step editing" describe block), `npm run build`. Real-browser E2E (`scripts/check-studio-e2e.sh`) exercises the full click-to-edit flow end to end: opening the Box root editor pre-filled, a whole-chain preview through the warm CAD worker, Apply recomputing the chain with the Shell step surviving, re-opening to make an edit that breaks the Shell step's own pick, seeing the real rebuild-error message with Apply disabled, and Cancel leaving the document unchanged. No contract, Python, or C++ changes this phase — same posture as 7.2.
