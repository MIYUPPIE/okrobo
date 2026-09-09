# Competition Definition v0

A self-contained challenge: an arena plus a list of objectives a student's own robot program is scored against while it runs. Defined in [schema.json](schema.json), examples in [examples/](examples/), one fixture per validation rule in [invalid/](invalid/).

This is a Robot Builder Phase 8-style "structural document" contract, the same relationship `contracts/world/` has to `contracts/robot-api/`: `robot-api` is the message protocol between a controller and a running robot backend; `competition` is the static document describing a challenge to run that protocol against.

## Model

- `robot`: which robot kind this competition targets. Only `"car"` in v0 -- an explicit enum, not assumed, so `"arm"`/`"drone"` can be added later with no version fork. Robot-Builder-authored (custom) robots are out of scope for v0 entirely (see the project's own Competition Arena decision doc).
- `arena`: embedded inline, field-for-field identical to `contracts/world/v1/schema.json` -- not a reference to a separate world file. Nothing in the pack system today lets one content file reference another, and a competition is meant to be one portable document a student (or teacher) can share on its own, without also needing to track down a matching world file. The cost is duplication if the same arena is reused across several competitions; accepted as the simpler, more portable choice for v0.
- `objectives[]`: independent and unordered. Every objective is evaluated every tick; none gates another, and there is no notion of "must reach checkpoint 1 before checkpoint 2" yet (see Non-goals). Three kinds in v0:
  - `reach_zone`: a circle (`x`, `y`, `radius`) worth `points`, awarded once the first time the robot's own position enters it. Idempotent -- staying inside, or leaving and re-entering, never re-awards it.
  - `avoid_obstacle_collision`: deducts `penalty_per_hit` each time the robot's own collision circle (radius = `arena.robot_radius`) starts overlapping an obstacle box it wasn't already overlapping. Edge-triggered per obstacle: one continuous overlap costs one penalty, not one per simulation tick; leaving and re-entering the same obstacle counts again.
  - `time_limit`: ends the run once elapsed real time reaches `seconds`. At most one per competition -- the schema can't express "at most one array element of this kind," so the hand-written validator enforces it (`objective-duplicate-time-limit` in `invalid/`).

## Why this needs no engine or student-API change

Every other structural contract in this repo (`robot-def`, `world-def`) is hand-mirrored across TypeScript, Python, and C++, because the data it describes is consumed by all three (the sim math, the student's own program, or the compiled SDK). A competition is different: **the student's program never sees it**. A student still just calls `robot.forward()` / `robot.findColor()` exactly as in any other run -- the competition only changes which arena is loaded underneath, and an outer layer (`apps/studio/src/compete/score.ts`) watches the robot's own already-exposed per-tick pose (`EngineWorld.state()`) and evaluates objectives against it, entirely within the studio's own TypeScript layer. Nothing about the Python sidecar, the WASM engine, or the C++ SDK changes to support this. So `contracts/competition/v0` is deliberately **TypeScript-only** -- there is no `runtime/python/okrobo/competition.py` and no `engine/src/competition.{hpp,cpp}`, and there shouldn't be one added later unless a genuinely new consumer (e.g. a student-callable "what's my score right now?" API) appears.

Relatedly: `avoid_obstacle_collision` cannot be implemented by reading the engine's own `collided` flag (`engine/src/world.cpp`) -- that flag is wall-boundary-only (set only when the position clamp against the *arena walls* fires). A robot drives straight through an "obstacle" box today; obstacles only ever feed the ray-cast distance/lidar sensor. `avoid_obstacle_collision` is therefore computed independently, in `score.ts`, from the robot's own pose plus `arena.obstacles` -- both already available every tick with no new engine plumbing.

## Reference implementation and validation

The executable spec is `apps/studio/src/compete/competitionDef.ts` (`parseCompetitionDef`, `validateCompetitionDef`) -- reusing `apps/studio/src/lib/validateWorld.ts`'s own `WorldDef`/obstacle-parsing directly for the `arena` field, rather than a second, possibly-drifting copy of the same rules. `apps/studio/src/compete/competitionDef.test.ts` reads the same fixtures under `examples/` and `invalid/`.

Validation never throws: `validateCompetitionDef` always returns a list of issues (`{rule, severity, objective_index?, message}`), even an empty one. Parsing (`parseCompetitionDef`) still throws on malformed JSON shape -- a file-corruption/programmer error, not a design-time issue for a student or teacher to fix.

## Non-goals (v0)

- No ordered checkpoint sequences ("must reach zone A before zone B") -- objectives are independent. A future version may add a `sequence` field; deliberately deferred so the simpler unordered model ships and proves itself first.
- No Robot-Builder-authored (custom, CAD-designed) robots -- `robot` is `"car"` only.
- No multi-robot competitions, no AI opponents, no tournament/leaderboard concepts. Those are product-level features layered on top of a single competition run, not part of this document.

## Versioning

This directory is frozen once its one language mirror ships. Changes go to `v1/` with the mirror updated in the same commit.
