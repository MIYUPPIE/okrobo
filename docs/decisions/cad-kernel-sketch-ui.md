# Decision: CAD Kernel — Phase 2 (Sketch UI)

**Date:** 2026-09-05

## Choice

Give Build mode a real way to create a `cad_mesh` body for the first time — Phase 1 shipped the whole pipeline (kernel, geometry variant, render, collider) with deliberately zero UI. A new "Extrude" toolbar tool, alongside Move/Rotate/Add Joint: it opens a panel (`CadExtrudeCreator`) where a student picks a profile (Rectangle or Circle — the only two the kernel supports), types exact dimensions, watches a live 3D preview update as they type, and clicks Apply to add a real body. This is the first time the real browser Worker + real OpenCascade WASM (`apps/studio/src/cad/worker.ts`, built in Phase 1 specifically for this) gets exercised by anything other than a direct Node call.

## Parametric dimensions, not a freeform sketch canvas

Researched first: this codebase has zero precedent for 2D canvas drawing, dragging, or point-based sketching anywhere (repo-wide grep — no `dnd-kit`/`react-dnd`/Fabric/Konva/`draggable`, the same finding `docs/decisions/robot-builder-joints.md` already made when it considered and rejected drag-and-drop). Presented the resulting fork directly to the user: build a real freeform 2D sketch surface (click-points, drag, snap — a materially bigger feature, still only feeding the same two kernel profile shapes underneath), or a parametric form (pick Rectangle/Circle, type exact numbers, mirroring `BodyInspector`'s own existing numeric-field pattern for box/sphere/cylinder). **The user chose the parametric form.** It's also how professional CAD is actually used past the rough-draft stage — a dimensioned rectangle, not a freehand one.

## Routes through the real Worker, not Phase 1's direct-call path

Phase 1's `extrude.ts` calls `kernel.ts` directly on the main thread — deliberate, since nothing in a running tab called it yet and it needed to run under plain Node (the offline authoring script) and vitest's `node` test environment. A live tab is different: the ~23MB OpenCascade WASM would jank the UI thread on load and on every mesh compute. `apps/studio/src/cad/cadClient.ts` is the new comlink client Build mode actually calls — it lazily constructs exactly one `new Worker(new URL("./worker.ts", import.meta.url), {type:"module"})`, memoized for the session, so a student who never opens Extrude never pays the WASM cost, and one who does only pays it once. Confirmed via a real production build (`npm run build`): the worker (`worker-*.js`, ~274KB) and the WASM (`replicad_single-*.wasm`, ~23MB) both land as separate emitted assets, and the main bundle grew by only ~9KB from Phase 1's build (`cadClient.ts` + `CadExtrudeCreator.tsx` + comlink's small runtime) — the heavy kernel code stays out of it, fetched only on first real use.

## Live preview: a separate scene group, never touching raycasting

`BuilderViewport.tsx` gains a third effect (deps `[cadPreview]`, deliberately independent of the existing robot-rebuild effect) that renders a semi-transparent ghost mesh built from the same `geometryFor`'s `cad_mesh` branch `robotThree.ts` already has from Phase 1 (reused, not duplicated). This preview group is never added to `bodyGroupByIdRef` — the map the pointer-picking raycast intersects against — so it structurally cannot be hit by a click, deselected, or confused for a real body, by construction rather than by an extra exclusion check. `CadExtrudeCreator` computes the preview's position via the same `makeCadBody` helper Apply itself uses, so the previewed mesh and the eventually-applied body are the literal same object: Apply can never visually "jump" the part to a different spot than where it was just previewed.

## Client-side validation before the worker, not after

OpenCascade throws on degenerate input (a zero or negative width/height/radius/depth). `CadExtrudeCreator` validates every numeric field locally first — a bad value shows an inline error immediately, with no debounce wait and no worker round-trip at all. Only a fully valid draft, after a 400ms settle, calls into `cadClient`.

## Non-goals

- **No freeform 2D sketch canvas** — the user's explicit choice this phase; Rectangle/Circle parametric forms only.
- **No viewport plane-picking for sketch orientation/placement.** A new CAD body's position follows the exact same `near`-relative convention every other new body already uses (`makeDefaultBody`/`makeCadBody`); rotation is always identity. Repositioning after Apply uses the existing Move/Rotate gizmo, same as any other body.
- **No profile shape beyond Rectangle/Circle** — matches exactly what `kernel.ts` supports from Phase 1; no new kernel/replicad work this phase.
- **No live re-editing of an Applied `cad_mesh` body's dimensions.** `BodyInspector`'s Phase-1 "not editable here, CAD part" treatment is untouched — changing a CAD part after Apply still means deleting it and re-running Extrude. A live, re-editable feature tree is still Phase 7's job.
- **No Revolve/Boundary/Cut/Fillet/Chamfer/Shell/Draft** — unchanged, still Phases 3–6.
- **No `contracts/robot-def` schema change, and no changes to `runtime/python/`, `engine/`, or `scripts/generate-cad-examples.mjs`** — this phase is `apps/studio` UI only, layered entirely on what Phase 1 already shipped everywhere else.
