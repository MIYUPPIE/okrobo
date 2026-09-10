# Decision: Competition Arena — C1-C3 (Definition + Scoring, Compete mode UI, real content)

**Date:** 2026-09-09

## Scope

The first of three sub-phases (C1-C3) scoping Competition Arena out of `nextphase.md`'s much larger "OKHUB FutureLab" brainstorm: a self-contained challenge (arena + objectives + scoring + time limit) a student runs their existing robot program against. C1 delivers exactly the definition contract and the pure scoring engine underneath it — no UI, no mode switch, no shipped content yet (C2/C3). This is the "prove the data model and the math first" phase, the same posture CAD Kernel Phase 7.1 took for the feature tree before any interactive UI existed.

## Deliberate deviation: TypeScript-only, no Python/C++ mirror

Every other structural contract in this repo (`robot-def`, `world-def`) is hand-mirrored across TypeScript, Python, and C++, because the data it describes is consumed by all three — the sim math, the student's own program, or the compiled SDK. A competition is different: **the student's program never sees it.** A student still just calls `robot.forward()` / `robot.findColor()` exactly as in any other run — the competition only changes which arena is loaded underneath, and scoring is computed entirely in `apps/studio/src/compete/score.ts`, watching the robot's own already-exposed per-tick pose from the outside. Nothing about the Python sidecar, the WASM engine, or the C++ SDK needs to know a competition exists. So `contracts/competition/v0` has one language mirror, deliberately, not an oversight — stated here so a future reader doesn't go looking for a missing `runtime/python/okrobo/competition.py`.

## Arena embedded, not referenced

`contracts/competition/v0`'s `arena` field is a full, embedded copy of `contracts/world/v1`'s own shape, not a reference to a separate world file by path. Nothing in the pack system today lets one content file reference another (`worlds`/`robots`/`lessons`/`robot_defs`/`world_defs` are all independent flat lists) — building that mechanism just for this would be new infrastructure with no other consumer yet. A competition is meant to be one portable document a student or teacher can share on its own, without also needing to track down a matching world file. The cost is duplication if the same arena gets reused across several competitions; accepted as the simpler, more self-contained choice for v0.

## Why `avoid_obstacle_collision` can't reuse the engine's own `collided` flag

Checked directly against `engine/src/world.cpp` before designing this: the Car/Drone `World`'s own `collided` flag is set only when the position clamp against the *arena walls* fires — a robot drives straight through an "obstacle" box today, since obstacles only ever feed the ray-cast distance/lidar sensor, never actual body collision. Reusing that flag for "avoid the obstacle" would silently score nothing. Instead, `score.ts`'s own `circleIntersectsAabb` computes overlap directly from the robot's own pose (already exposed every tick via `EngineWorld.state()`) and the arena's own obstacle list (already loaded) — no new engine work, and correct regardless of what the wall-collision flag does.

## Edge-triggered hit counting, not per-tick deduction

`avoid_obstacle_collision`'s penalty is deducted once per *continuous* overlap with a given obstacle, not once per simulation tick the robot happens to be inside it — a latch array (`collidingObstacles`, one entry per obstacle, in `CompetitionRunState`) tracks whether each obstacle was already being overlapped last tick. Without this, sitting inside a box for even a second (dozens of ticks at a typical frame rate) would rack up dozens of penalties for what a student would reasonably call "one crash." `reach_zone` gets the analogous idempotency treatment from the other direction: awarded once, on first touch, never re-scored for staying inside or re-entering.

## Independent, unordered objectives (v0)

Every objective in v0 (`reach_zone`, `avoid_obstacle_collision`, `time_limit`) is evaluated every tick independently — none gates another, and there's no "must reach checkpoint 1 before checkpoint 2" concept yet. Deliberately deferred (see Non-goals) so the simpler model ships and proves itself first; an ordered-sequence objective is a natural, contained addition once real students have used the unordered version.

## `ProgramRunner.tick()`'s new hook: additive, not a rewrite

`tick()` gained one new optional trailing parameter (`onStep?: (state, dt) => void`), called once per simulated step from inside the existing loop. Every call site that existed before this phase (`Viewport3D.tsx`'s own `runner.tick(plan.steps)`, `apps/studio/src/builder/TestViewport.tsx`'s `runner.tick(STEP_DT)`) passes no third argument and is byte-for-byte unaffected — proven by a regression test asserting the no-callback call shape behaves exactly as before. `this.engine.state()` is now computed once per iteration and reused for both the pre-existing movement/collision check and the new `onStep` call, instead of being called twice.

## Non-goals (C1 specifically)

- No UI at all — no Compete mode, no picker, no scoreboard. That's C2.
- No shipped competition content beyond the two round-trip test fixtures. That's C3.
- No ordered checkpoint sequences (see above).
- No Robot-Builder-authored robots, no arm/drone competitions — `robot` is `"car"` only.
- No AI opponents, tournaments, team mode, or an AI coach — see the Competition Arena plan's own full "explicitly out of scope" list for why each is deferred, and — for an AI coach specifically — the standing constraint that any such feature must route through local Claude Code, never a hosted LLM API.

## Verification (C1)

`apps/studio`: `npm run test` (new: `competitionDef.test.ts`, `score.test.ts`, `packCompetitions.test.ts`, plus extensions to `ProgramRunner.test.ts`, `manifest.test.ts`, `store.test.ts`, `corePack.test.ts`), `npm run typecheck`, `npm run build`. No engine/WASM/Python changes this phase — `ctest`/`pytest` re-run clean as a pure regression check, not because anything there changed.

---

## C2: Compete mode UI

The 3rd top-level `mode` in `App.tsx` (`"simulate" | "build" | "compete"`), reusing the exact same car-physics path Simulate mode already drives — same `engine`/`arm`/`drone`/`world`/`runner` state, same `<Viewport3D>` instance, same Blocks/Python/World/Lessons/C++ tabs. Nothing about a competition changes what the student's program can do; it only changes which arena is loaded and adds an outside-the-program scoring layer watching the pose Viewport3D already computes every tick.

### JSX structure: widen the existing Simulate block, not a parallel copy

The approved plan's own wording suggested Compete mode would get "its own JSX block," structurally parallel to Build mode's separate block. In practice, Build mode's separation exists because it mounts a *different* stack entirely (`BuilderPanel`/`BuilderViewport`, MuJoCo instead of the WASM car/drone engine, no Blocks/Python/World/Lessons/C++ tabs at all). Compete mode shares every one of those with Simulate mode — same engine, same runner, same code tabs — so giving it a separate block would have meant copying roughly 150 lines of sidebar/viewport/code-panel JSX verbatim and keeping two copies in sync forever after. Instead, `{mode === "simulate" && (...)}` widened to `{(mode === "simulate" || mode === "compete") && (...)}`, with only the `<aside className="sidebar">`'s own inner content branching per mode (robot switcher + hardware panel for Simulate; a competition-picker trigger + name/description for Compete). `<CompeteHud>`/`<CompeteReport>` are layered as siblings inside the shared `<main className="viewport">`, alongside the untouched `<Viewport3D>`. This reads as staying inside the plan's real intent (the plan's own correction was about `<Viewport3D>` not being unconditional, not about mandating duplicate markup), and keeps a single source of truth for the code-panel tabs.

### State and wiring added to `App.tsx`

- `competition: CompetitionDef | null`, `competeRun: CompetitionRunState | null`, `competeDialogOpen: boolean`.
- Picking a competition (`pickCompetition`) calls the existing `switchRobot("car")` (competitions are car-only) and `applyWorld(picked.arena)` (already rebuilds the engine via the existing `world`-keyed effect — no new engine-construction code), then seeds `competeRun` via `initRunState`.
- `onEngineStep` (only passed to `Viewport3D` while `mode === "compete"`) calls `evaluateTick` each simulated step; if `timeUp` just flipped, it calls the existing `haltEverything()` — the same abort path Stop already uses.
- Finalizing a run reuses three existing lifecycle points rather than inventing new ones: `run()`'s existing `.finally()` and the Python bridge's `onDone` both call `finishRun(..., "program_ended")`; `stop()` calls `finishRun(..., "stopped")`; `reset()` reseeds a fresh `initRunState`. A `modeRef` (kept current every render) is read inside the Python bridge's `onDone`, since that closure is created once per `[engine, runner]` change and would otherwise see a stale `mode`.
- The 3 run-bar buttons (Run/Stop/Reset) are disabled in Compete mode until a competition is actually chosen, in addition to the existing `engineStatus !== "ready"` guard.

### New components (`apps/studio/src/compete/`)

- `CompetitionDialog.tsx` — near-exact structural mirror of `builder/TemplateDialog.tsx`: a bundled section (`bundledCompetitions()`) plus an async installed-pack section (`listPackCompetitions()`), same empty-state/one-corrupt-pack-is-skipped posture.
- `CompeteHud.tsx` — a live scoreboard, CSS-positioned (`position: absolute`) inside `.viewport`, read-only against `competeRun`.
- `CompeteReport.tsx` — shown once `competeRun.finished`: score breakdown per objective, total, elapsed time, finish reason, "Run again" (→ `reset()`) / "Choose another competition" (clears `competition`/`competeRun`, reopens the picker).

## Non-goals (C2 specifically)

- No real shipped competition content yet — `bundledCompetitions()` returns `[]` until C3 adds files under `packs/core/competitions/`. The e2e Compete-mode section this phase covers only the empty-state picker, the disabled run-bar with nothing chosen, and switching back to Simulate; a real pick-and-play e2e path lands with C3.
- No ordered checkpoints, no arm/drone competitions, no AI opponents/tournaments/team mode/AI coach — unchanged from C1's own Non-goals.

## Verification (C2)

`apps/studio`: `npm run test` (new: `CompetitionDialog.test.tsx`, `CompeteHud.test.tsx`, `CompeteReport.test.tsx` — 787 total, up from 774), `npm run typecheck`, `npm run build` (852 modules). `./scripts/check-studio-e2e.sh` — real headless Chrome run, 5 new "Compete mode" checks pass alongside the full existing suite (see `scripts/lib/studio-e2e-check.mjs`'s own Compete-mode section for exactly what is and isn't provable without real competition content).

---

## C3: Real competition packs + a lesson

Three competitions in `packs/core/competitions/`, each using only C1's three objective types, grounded only in the Car's real sensors (lidar/distance, no line sensor exists, so nothing "line-following" is proposed):

- **Sprint to the Zone** — an open, obstacle-free 3x2 m arena, one `reach_zone`, a 60s `time_limit`. The "does the whole pipeline work at all" case.
- **Obstacle Slalom** — a 4x2 m corridor with three posts straddling the direct path, alternating side to side, so driving straight clips at least one; `reach_zone` + `avoid_obstacle_collision` (15/hit) + a 60s `time_limit`. Exercises the distance sensor for real avoidance, not just a decorative obstacle.
- **Precision Docking** — a 3x3 m arena with a three-sided bay (a 0.6 m gate) tucked in the corner; a small-radius (0.15 m) `reach_zone` deep inside it, `avoid_obstacle_collision` (20/hit), a generous 90s `time_limit`. The tight zone radius against the bay's own walls (0.05 m clearance at full points) is what makes "precision" real rather than nominal.

Plus `packs/core/lessons/05-welcome-to-compete-mode.md` (introduces Compete mode, points at Sprint to the Zone first, then a rough obstacle-dodge starter for Slalom) and a `packs/core/pack.json` version bump (1.0.0 → 1.1.0) adding both.

### A real correctness bug found while wiring this up: the compete clock ran before Run was pressed

`Viewport3D.tsx`'s own render loop steps both physics worlds every animation frame regardless of Run/Stop ("both worlds always step; wheels/joints only move when commanded" — true before this phase too, for the idle-camera-preview case). `onEngineStep` (added in C2) rode along on that same unconditional step call, which meant a competition's own clock started ticking the instant its arena loaded — before the student ever pressed Run — and kept ticking after Stop, since haltEverything() only zeroes wheel velocity, it doesn't stop world.step() itself.

Fixed with `competeActiveRef` (`apps/studio/src/App.tsx`): flipped true by each of `run()`'s three paths (cruise, Python, Blocks/C++ program) right as it starts driving, flipped false by `haltEverything()` and the program's own `.finally()`. `onEngineStep` now gates on it directly, so `evaluateTick` — and the clock it drives — only advances while something is actually driving the robot. A second, smaller fix rode along: the original code called `haltEverything()` from *inside* a `setCompeteRun` functional updater (to auto-stop on time-up) — React (Strict Mode especially) can invoke a state updater more than once per real event to check for purity, which could have double-fired that side effect. Moved to a `useEffect` keyed on `competeRun?.timeUp` instead, so the updater itself stays a pure state transition.

### e2e: a real pick-and-play run, not just the empty state

C2's own e2e section could only prove the empty-state picker (no bundled competitions existed yet). With real content now shipped, `scripts/lib/studio-e2e-check.mjs`'s Compete-mode section drives the full loop for real: picks "Sprint to the Zone" from the actual bundled list, presses Run, confirms the scoreboard's own clock advances live, presses Stop, and confirms a real report renders with a total-score line and at least one objective row. One test-harness gotcha surfaced and fixed here (not an app bug): a much earlier lesson's "Try this" step leaves the shared Blocks/Python `tab` state on Python for the rest of the suite, and Run on the Python tab correctly no-ops with no sidecar running in this harness — the same behavior Simulate mode would show. The Compete-mode section now reselects the Blocks tab first so the check is deterministic and sidecar-independent.

## Non-goals (C3 specifically)

- No further objective types, no checkpoints, no arm/drone competitions — unchanged from C1/C2.
- No installed-pack competition content is exercised by the e2e suite (no Tauri desktop harness here) — only the bundled ones. Installed-pack competitions are proven directly by `packCompetitions.test.ts` and `CompetitionDialog.test.tsx`'s own mocked pack-section tests instead.

## Verification (C3)

`apps/studio`: `npm run test` (787 passing, unchanged count — the 3 new competitions and the new lesson are exercised by `corePack.test.ts`'s existing loops, not new test files), `npm run typecheck`, `npm run build` (856 modules). `./scripts/check-studio-e2e.sh` — full real pick-Run-Stop-report loop passes in headless Chrome, plus the existing "Lessons tab lists at least the five core lessons" bump.

---

## C4: ordered checkpoints (Object Delivery Race, Maze Challenge)

Closes the deferral this doc's own C1 section named explicitly: "an ordered-sequence objective is a natural, contained addition once real students have used the unordered version." Two brainstorm items from `nextphase.md`'s Competition Mode section (#9 Object Delivery Race, #10 Maze Challenge) both need one thing v0 didn't have: "reach zone A before zone B is reachable at all."

### `contracts/competition/v0` → `v1`: a strict additive fork

Per this repo's own stated versioning policy (`v0` frozen once its one mirror ships, changes go to a new version — the same `robot-def`/`world` precedent) `reach_zone` gained two optional fields: `sequence` (non-negative integer) and `label` (string). Omitted `sequence` reproduces v0's only behavior exactly — always immediately reachable — so all 3 C3 competitions parse and behave identically once read as v1 documents, no changes needed to their own JSON. A `reach_zone` with `sequence` set can only be achieved once every *other* `reach_zone` with a strictly lower `sequence` has been achieved; equal values form a concurrently-reachable tier. A DAG-style `requires: string[]` model was considered and rejected as premature — every real use case identified (a pickup-then-delivery pair, a linear checkpoint chain) is a strictly-ordered or tiered sequence, which plain integers express with no added ceremony.

### `score.ts`: `locked`, gated against the PREVIOUS tick's outcomes

`ObjectiveOutcome` gained `locked: boolean`. Computed by checking `state.outcomes` — the state *entering* this tick, not the `outcomes` array being built this same tick — for any other `reach_zone` with a lower `sequence` that isn't yet achieved. This sidesteps a real correctness trap: gating against the in-progress array would make the result depend on which order objectives happen to be listed in the JSON (an earlier-indexed zone's achievement would already be visible to a later-indexed one's lock check within the same tick, but not the reverse), an accidental behavior nobody should have to know about to write a competition file. Gating against the previous tick means a zone unlocks one simulation tick (10ms) after its prerequisite — imperceptible, and independent of objective ordering. This one `locked` flag is computed exactly once per tick and reused by both `CompeteHud.tsx`'s own objective list and the new 3D ground markers below, rather than two independent (and possibly drifting) computations of the same fact.

### A real gap this surfaced: `reach_zone` had no visual representation at all

Before this phase, none of the 3 shipped competitions' zones appeared anywhere in `Viewport3D.tsx` — a student located them purely from the competition's own description text and arena landmarks (a post, a wall). Tolerable with one zone per competition; genuinely unplayable with 2-3 *ordered* zones a student can't see or tell apart. Fixed for every competition, not just the 2 new ones (a strict improvement, not scope creep, matching this project's own "MuJoCo object was invisible" lesson: a spatial feature isn't done until it's confirmed visible, not just numerically correct): a thin `THREE.RingGeometry` at each `reach_zone`'s own literal `radius` (so a student sees the actual scored boundary, not an arbitrary marker), colored locked (dim gray) / active (amber) / achieved (green).

Threading the live color required a small new pattern in `Viewport3D.tsx`: the whole scene (including these rings) is built once per `[..., competition]` change inside the component's single `useEffect` — cheap to do once per competition pick, too expensive to redo every tick just to recolor a ring. A new `zoneStatesRef` prop (mirroring `autopilotRef`'s own existing plain-mutable-ref convention in this exact component) is read every animate-loop frame instead, decoupling "how often the geometry rebuilds" from "how often the color updates." `App.tsx` populates it from a `useEffect` watching `competeRun` — deliberately *not* from inside the `setCompeteRun` functional updater itself, for the same reason C3's own `competeActiveRef` fix (above) moved `haltEverything()` out of that updater: React/Strict Mode can invoke an updater more than once to check for purity, and a ref mutation is a side effect that doesn't belong there.

### A real, pre-existing bug found by this phase's own e2e check: `engineStatus` didn't reset on a mid-session engine rebuild

Picking a *second* competition in the same session changes `world` (a new arena), which re-instantiates the WASM engine from scratch asynchronously (`App.tsx`'s own `[world]`-keyed effect: cleanup nulls `engine` synchronously, a fresh `loadEngine()` resolves it later). `engineStatus`, however, was only ever written by that same effect's own success/failure callback — never reset to `"loading"` when the effect *re-runs* — so it stayed stale at `"ready"` (from the previous engine) for the whole async rebuild window. `runBarDisabled` reads `engineStatus`, not `engine` itself, so Run stayed visually enabled and silently no-op'd (`run()`'s own `if (!engine || !runner) return;`) if clicked inside that window.

Found empirically, not hypothesized: this phase's own new e2e check ("pick Object Delivery Race, click Run, confirm the delivery zone renders locked") failed intermittently — roughly one run in three — with no exception, just the expected DOM state never appearing. Traced to this exact race after a hand-rolled CDP probe reproduced it reliably once the flow matched the real script closely enough (Sprint run → Stop → choose another → Object Delivery Race → Run, all in one session — the *first* competition pick in a session never hits this, since nothing async is competing with anything at that point). Fixed at the root: `setEngineStatus("loading")` now runs synchronously at the top of the `[world]` effect, before the async `loadEngine()` call, so the real UI now correctly disables Run/Reset/Compete's own entry points for the (usually sub-100ms, but real) rebuild window — a genuine, if narrow, user-facing fix, not just a test workaround. The e2e check itself was also hardened to wait for `.viewport-3d canvas` (not just the HUD title, which depends only on `competition`/`competeRun` and renders before the engine does) before clicking Run, mirroring the exact two-condition wait the original C2 Sprint check already used successfully.

### Content: two new competitions, hand-verified solvable

- **Object Delivery Race** — pickup zone (`sequence: 0`) then delivery zone (`sequence: 1`), a crate placed directly on the straight-line path between them so a naive drive doesn't clear it either.
- **Maze Challenge** — a single wall obstacle sized to seal off the direct route and the entire north side of the arena, leaving exactly one route (south around it) to Checkpoint 1, then east and north to the exit zone. Deliberately a "Beginner: known maze" (per `nextphase.md`'s own difficulty ladder) — fully visible from the start, no fog-of-war; an "unknown, must be discovered" mode is real future scope, not this phase.

The maze's own solvability isn't asserted by eye — `bundledCompetitions.test.ts` samples a hand-authored waypoint path through it using `score.ts`'s own `circleIntersectsAabb` (the exact function real runs are scored against, not a re-derived approximation), confirming the path clears the wall and the arena boundary with real margin (≥0.45 m against a 0.1 m robot radius) along its entire length, and that it reaches Checkpoint 1 before the exit zone. A screenshot pass in real headless Chrome additionally confirmed the ground markers render as designed (locked/active colors visibly distinct) and the maze geometry matches the intended layout, not just the JSON.

## Non-goals (C4 specifically)

- No arbitrary objective dependency graphs (`requires: string[]`) — `sequence` tiers cover every identified use case; a DAG model is a future addition if one ever needs an objective gated on two *different* prior objectives a shared tier can't express.
- No unknown/procedurally-generated mazes (fog-of-war) — every zone and obstacle stays fully visible, matching this app's arena rendering everywhere else.
- No arm/drone competitions, no AI opponents/tournaments/team mode/AI coach, no Robot-Builder-authored robots — unchanged from C1-C3's own Non-goals.

## Verification (C4)

`apps/studio`: `npm run test` (899 passing, up from 878 — new `bundledCompetitions.test.ts`, extended `competitionDef.test.ts`/`score.test.ts`/`CompeteHud.test.tsx`/`CompeteReport.test.tsx`), `npm run typecheck`, `npm run build`. `./scripts/check-studio-e2e.sh` — the 5-bundled-competition list, the delivery zone's locked→unlocked wiring, and the `engineStatus` fix all verified in real headless Chrome, 4 consecutive clean runs after the fix (down from a genuine ~1-in-3 flake before it). Two manual screenshot passes (Object Delivery Race, Maze Challenge) confirmed the ground markers and maze layout are visibly correct, not just numerically so.
