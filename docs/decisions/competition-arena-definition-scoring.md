# Decision: Competition Arena — C1 (Definition + Scoring)

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

## Verification

`apps/studio`: `npm run test` (new: `competitionDef.test.ts`, `score.test.ts`, `packCompetitions.test.ts`, plus extensions to `ProgramRunner.test.ts`, `manifest.test.ts`, `store.test.ts`, `corePack.test.ts`), `npm run typecheck`, `npm run build`. No engine/WASM/Python changes this phase — `ctest`/`pytest` re-run clean as a pure regression check, not because anything there changed.
