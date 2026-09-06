# Decision: CAD Kernel — Phase 7.1 (Feature tree data model)

**Date:** 2026-09-06

## Choice

The user chose the most ambitious of three presented options for Phase 7 (feature tree): a genuinely **reorderable, live-recomputing** tree — edit any step, at any position, and watch everything downstream recompute. That's large enough to need its own internal roadmap, split into four sub-phases. This is **7.1 only**: the data model (`Body.features`, forked into `contracts/robot-def/v2`), every existing CAD creator writing its own feature entry, and a new read-only `FeatureTreeList` panel. No editing, no recompute, no reordering yet — this sub-phase proves the schema and the write path end to end before the hard part (7.2: real topological identity via raw OpenCascade builders, verified empirically this session as achievable with no fork of replicad needed).

## `contracts/robot-def/v2`: a strict additive fork

Per the contract's own frozen-versioning policy (`v1/contract.md`: "Changes go to `vN+1/` with all three [mirrors] updated in the same commit"), `v1/` was copied wholesale to `v2/` and extended with one new optional `Body.features: Feature[]` field plus its supporting definitions (`Profile`, `CadPick`, `FilletChamferPick`, `BossOperation`, `Feature`). All `v1` examples/invalid fixtures carry over verbatim — `v2` is a strict superset, so nothing that validated before stops validating now.

`Feature` is a discriminated union covering every operation Build mode's CAD tools already perform: three **root** kinds (`extrude`/`revolve`/`loft` — collectively `BossOperation`, plus `box`/`cylinder` for when a modifier tool applies directly to a plain primitive body, since there's no Boss operation to record in that case) and four **modifier** kinds (`cut` — a nested `BossOperation` tool + position; `fillet_chamfer` — picks with a per-pick `operation`/`value`; `shell`/`draft` — picks with one shared `thickness`/`angle_deg`). The first entry in a body's own `features` is always a root; every later entry modifies the previous entry's own result.

One new validation rule: `body-features-without-cad-mesh` (error) — a body with non-empty `features` whose `visual`/`collision` isn't `cad_mesh` is invalid, mirroring the existing kebab-case rule-naming convention.

## `CadPick`/`FilletChamferPick.source_step`/`local_index`: forward-looking, deliberately unused this phase

Every pick already carries a `point` — the exact geometric descriptor (`Edge.pointAt(0.5)` or `Face.center`) every picking tool has computed since Phase 5/6. `source_step`/`local_index` are stored alongside it but read by nothing yet; they're reserved for Phase 7.2's real topological identity (OpenCascade's own `Modified`/`Generated`/`IsDeleted` history, propagated step to step — verified empirically this session, reachable through replicad's own exported `getOC()` with no fork needed). Storing them now, even unused, avoids a second contract fork once 7.2 needs them. Every current write path only ever has a single step preceding a pick-bearing feature (a fresh Boss shape, or a synthesized/existing root — see below), so `source_step` is uniformly `0` throughout this phase; that's a correct, honest placeholder for "the one step before this," not an approximation of something more precise that could be computed today.

## The synthesized-root problem: every modifier target is a bare primitive today

Every standalone modifier tool (Fillet/Chamfer, Shell, Draft, Cut) can only target a box or cylinder body — `cadTargetShape.ts`'s `shapeFromGeometry` already restricts to exactly those two exactly-reconstructable primitives (established in Phase 5/6), and once a modifier applies, the target's own `visual` becomes `cad_mesh`, permanently disqualifying it as a target for that same restriction again. So in every real call path, a target body has *never* been touched by a modifier before, meaning its `features` is always empty/absent at the moment a modifier first touches it — but it still has real, exactly-known prior geometry (a box's `size`, a cylinder's `radius`/`length`) that deserves to be the first recorded step, not silently dropped.

`robotEdits.ts`'s `replaceBodyGeometry` handles this once, generically: `implicitRootFeatures(geometry)` maps a bare box/cylinder `Geometry` straight into the matching `Feature` root (identical fields, different discriminant key — `type` vs. `operation`) and, when the target's own `features` is empty, prepends that synthesized root ahead of the caller's own modifier feature. A body with an already-recorded history instead gets that history extended untouched. A primitive with no exact `Feature` shape (sphere/cone/capsule/plane) yields no synthesized root at all — consistent with those types never being valid modifier targets in the first place, so this path is unreachable for them today; the function stays generically correct rather than special-cased to "can't happen."

## The Boss creators can already emit two features in one Apply

Extrude/Revolve/Boundary each support an *embedded* Fillet/Chamfer step on their own not-yet-baked shape (Phase 5) — one Apply click can bake a Boss shape *and* a fillet/chamfer together. `makeCadBody`/`replaceBodyGeometry` both take a `Feature[]` (not a single `Feature`) for exactly this reason: a Boss creator with picked edges builds `[rootFeature, filletChamferFeatureFromPicks(picks, 0)]` in one call, while every other creator passes a single-element array. `filletChamferFeatureFromPicks` (in `filletPicks.ts`, alongside the existing `parseFilletPicks` every one of these callers already uses) and `cadPicksFromFacePicks` (local to `CadFacePickEditor.tsx`) do the kernel-shaped-pick → contract-shaped-`CadPick` wrapping in one place rather than five times.

## `robotEdits.ts` stays cad-kernel-agnostic

`makeCadBody`/`replaceBodyGeometry` accept a plain `Feature[]` and never import from `cad/kernel.ts` or `cad/cadClient.ts` — each creator (which already imports those kernel-shaped types for its own preview/apply calls) builds the contract-shaped `Feature` itself. This preserves the module's own existing framing ("this module stays cad-kernel-agnostic") rather than introducing a new dependency for Phase 7.1's sake.

## `CadFacePickEditor.tsx`: a `buildFeature` prop, not a `kind` string

Shell and Draft share one editor component parameterized by `computeMesh`/`title`/etc. (Phase 6); Phase 7.1 adds one more parameter, `buildFeature: (picks: CadPick[], value: number) => Feature`, supplied by each of `BuilderPanel.tsx`'s two JSX call sites as a small closure (`{operation:"shell", picks, thickness: value}` / `{operation:"draft", picks, angle_deg: value}`) rather than a `kind` string the editor would switch on internally — keeps the editor itself ignorant of which two operations it's serving, matching how `computeMesh` already works.

## New read-only panel: `FeatureTreeList.tsx`

Renders nothing for an absent/empty `features` (today's status quo, unchanged for every non-CAD body and every `cad_mesh` body predating this phase); otherwise one line per feature, in order, naming the same tools/labels Build mode's own toolbar already uses (e.g. "Boundary" for a `loft`, "Extruded"/"Revolved"/"Boundary" for a `cut`'s own tool kind) so the list reads as a plain replay of what the student already clicked, not a second vocabulary. Wired into `BodyInspector.tsx` right below the existing "CAD part — baked mesh, not editable here" note, inside the same `cad_mesh`-only conditional. No interaction — nothing here is clickable, editable, or reorderable (7.3/7.4's job).

## Non-goals

- **No editing a stored feature, no recompute.** Phase 7.3's job.
- **No real topological identity resolution** — `source_step`/`local_index` are stored but never read. Phase 7.2's job.
- **No reordering/insertion/deletion of steps.** Phase 7.4's job.
- **No engine/physics changes** — `features` is inert data as far as `BuiltRobot`/MuJoCo are concerned; the C++/Python mirrors add faithful parse/serialize/validate only, no new runtime consumption.

## Verification

`apps/studio`: `npm run typecheck` and `npm run test` (600 passed across 61 files, including new/extended coverage in `robotEdits.test.ts`, all three Boss creators, all three Cut creators, `CadFilletChamferEditor.test.tsx`, `CadFacePickEditor.test.tsx`, `BodyInspector.test.tsx`, and the new `FeatureTreeList.test.tsx`). `runtime/python`: `pytest` (204 passed, 1 skipped). `engine`: `ctest` (13/13, including the extended `test_robot_def` binary). Full `scripts/check-studio-e2e.sh` run for real against a live dev server and headless Chrome — 4 new checks confirming the Construction history panel renders the right ordered labels for both an Extrude-with-embedded-fillet body and three separately-modified plain-box bodies (Fillet/Chamfer, Shell, Draft), each showing its synthesized Box root.
