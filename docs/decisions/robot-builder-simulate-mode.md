# Decision: Robot Builder — built robots in Simulate mode (B2)

**Date:** 2026-09-09

## Scope

A robot built in Build mode can now be picked and driven for real in the app's main Simulate mode — the same place Car/Arm/Drone already live — reusing B1's real Python execution entirely. Before this, a built robot only ever ran inside Build mode's own isolated Test tab.

## `RobotKind` stays untouched — an orthogonal `simulateBuilt` state instead

`docs/decisions/robot-builder-programming.md` ("Why `BlocksRobotKind` is a separate type from `RobotKind`") already recorded, back when this wasn't yet a stated goal: *"`RobotKind`... is used well beyond Blockly: `App.tsx`'s Simulate-mode robot picker, `LessonsPanel.tsx`, and `packs/lesson.ts`'s `Lesson.robot`... none of which can ever target a built robot."* That reasoning still holds and this decision does not reverse it — `RobotKind` (`"car"|"arm"|"drone"`) is not widened, and lessons/pack-content schema are untouched.

What changes instead: `App.tsx` gained a new, orthogonal state, `simulateBuilt: { robot: RobotDef; world: WorldDef | null } | null`, independent of `robot: RobotKind`. Car/Arm/Drone's own engine trio (`engine`/`arm`/`drone`/`runner`) stays exactly as always-resident as it already was — nothing about picking a built robot tears it down or depends on it. This is also the architecturally honest choice: Car/Arm/Drone are three *fixed*, always-available kinds multiplexed by one `ProgramRunner`; a built robot is fundamentally *on-demand* (a specific document the student picked, constructed and destroyed per pick, exactly like Build mode's own Test-mode `EngineBuiltRobot`/`BuiltProgramRunner` lifecycle) — not a 4th peer value in the same enum, a different kind of thing entirely.

## Reused wholesale, not re-implemented

- **`TestViewport.tsx`** renders directly inside Simulate mode's own `<main className="viewport">` in place of `<Viewport3D>` when `simulateBuilt` is set — the exact same component Build mode's Test tab already uses, not a ported copy. It already handles an arbitrary `RobotDef` + optional world-def generically.
- **The construction effect** mirrors `BuilderPanel.tsx`'s own Test-mode effect (`EngineBuiltRobot` + `BuiltProgramRunner`, `destroy()` on cleanup) almost verbatim, keyed on `simulateBuilt` itself (a fresh pick is a new object identity) rather than on the picked `RobotDef`'s own contents — so Build mode editing its own in-progress document never rebuilds Simulate mode's copy of it. A snapshot at pick time, the same reasoning Test mode's own effect documents for omitting `robot` from its deps.
- **Python execution** reuses B1's `PythonBridge<BuiltRobotApi>` + `executeBuiltRemoteRequest` unchanged — a second bridge instance, constructed/torn down alongside `builtRunner`, connecting to the same `SIDECAR_URL`.
- **Blocks/Python tabs** reuse the existing single `pythonCode`/`cppCode`/`jsCodeRef`/`pythonSourceRef` state and the already-existing `BlocksPanel`/`PythonPanel` components — `BlocksPanel` already fully supports `robot="built"` (`BlocksRobotKind` already included it), so this needed zero changes there.
- **The World tab** reuses `worldExamples.ts`'s own `WORLD_OPTIONS`-driven `<select>` (Empty/Obstacle Course/Ramp) — the same picker Build mode's Test tab already has — instead of the 2D-arena `WorldPanel`, since a built robot uses `contracts/world-def/v0` (3D, MuJoCo-collidable), a structurally different, differently-named `WorldDef` type from the Car/Drone arena's own `lib/validateWorld.ts` `WorldDef` — imported under an alias (`BuiltWorldDef`) everywhere both are in scope together, to avoid a real naming collision.
- **The picker** (`BuiltRobotDialog.tsx`) mirrors `TemplateDialog.tsx`/`CompetitionDialog.tsx`'s exact "current document + installed-pack section" shape, reusing `packRobots.ts`'s existing `listPackRobots()` unchanged (Phase 8 already built pack robot-def read-back).

## No `reset()` on `EngineBuiltRobot` — reconstruction stands in for it

Unlike `EngineWorld`/`EngineArm`/`EngineDrone`, `EngineBuiltRobot` has no `reset()` call — there was never a need for one in Test mode (Build mode's own Test tab has no Reset button; "exiting Test resets it" is its own documented behavior). Simulate mode's run-bar does have a Reset button, so B2's `reset()` re-identities the `simulateBuilt` object (`{ ...previous }`), which retriggers the same construction effect that a fresh pick would — a full, correct reconstruction back to the start state, reusing existing machinery rather than adding a new WASM export for a single button.

## Non-goals (B2 specifically)

- `simulateBuilt` does not persist through Save/Open (`ProjectPayload`) — a deliberate deferral, not an oversight. A saved project still only remembers Car/Arm/Drone's own state.
- No hardware/serial/camera panel for a built robot in Simulate mode — matches B1, a built robot has no physical counterpart.
- Competitions (Compete mode) still target the Car only — a built robot in a competition remains out of scope, named explicitly in the original Competition Arena plan's own "explicitly out of scope" list (C5).

## Verification

`apps/studio`: `npm run test` (800 passing, up from 792 — new `BuiltRobotDialog.test.tsx`), `npm run typecheck`, `npm run build`. `./scripts/check-studio-e2e.sh` — a new "Simulate mode: built robot" section proves the picker opens from the 4th sidebar entry, correctly gates an invalid document (the shared e2e document has real accumulated validation errors by this point in the run, itself a genuine proof the gate works, not a weaker substitute), and the packs section settles cleanly. The full happy path (a valid pick renders `TestViewport` inside Simulate mode, Run/Stop drive it for real via Blocks) is proven by `BuiltRobotDialog.test.tsx`'s own controlled fixture and was verified by hand in a real headless-Chrome session: Build mode → New Robot → Simple Arm template → Simulate mode → 🔧 Built robot… → pick it → real `TestViewport` renders → Run drives the default starter program → Stop → "Back to Car/Arm/Drone" restores the stock UI cleanly.
