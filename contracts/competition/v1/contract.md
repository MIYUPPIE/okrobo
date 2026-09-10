# Competition Definition v1

A self-contained challenge: an arena plus a list of objectives a student's own robot program is scored against while it runs. Defined in [schema.json](schema.json), examples in [examples/](examples/), one fixture per validation rule in [invalid/](invalid/).

This is a Robot Builder Phase 8-style "structural document" contract, the same relationship `contracts/world/` has to `contracts/robot-api/`: `robot-api` is the message protocol between a controller and a running robot backend; `competition` is the static document describing a challenge to run that protocol against.

## Model

- `robot`: which robot kind this competition targets. Only `"car"` in v1 -- an explicit enum, not assumed, so `"arm"`/`"drone"` can be added later with no version fork. Robot-Builder-authored (custom) robots are out of scope entirely (see the project's own Competition Arena decision doc).
- `arena`: embedded inline, field-for-field identical to `contracts/world/v1/schema.json` -- not a reference to a separate world file. Nothing in the pack system today lets one content file reference another, and a competition is meant to be one portable document a student (or teacher) can share on its own, without also needing to track down a matching world file. The cost is duplication if the same arena is reused across several competitions; accepted as the simpler, more portable choice.
- `objectives[]`: every objective is evaluated every tick. Three kinds:
  - `reach_zone`: a circle (`x`, `y`, `radius`) worth `points`, awarded once the first time the robot's own position enters it. Idempotent -- staying inside, or leaving and re-entering, never re-awards it. **New in v1**: an optional `sequence` (non-negative integer) and an optional `label` (string). `sequence` orders zones -- omitted means "always immediately reachable" (v0's only behavior, unchanged, so every v0-shaped competition still works unmodified); when set, this zone can only be achieved once every *other* `reach_zone` objective with a strictly lower `sequence` has already been achieved. Zones sharing the same `sequence` value form a concurrently-reachable tier -- no ordering constraint between them, just a shared prerequisite. `label`, when present, is shown in the HUD/report instead of the generic "Reach the zone" wording (e.g. "Pickup zone", "Checkpoint 2").
  - `avoid_obstacle_collision`: deducts `penalty_per_hit` each time the robot's own collision circle (radius = `arena.robot_radius`) starts overlapping an obstacle box it wasn't already overlapping. Edge-triggered per obstacle: one continuous overlap costs one penalty, not one per simulation tick; leaving and re-entering the same obstacle counts again.
  - `time_limit`: ends the run once elapsed real time reaches `seconds`. At most one per competition -- the schema can't express "at most one array element of this kind," so the hand-written validator enforces it (`objective-duplicate-time-limit` in `invalid/`).

## Why this needs no engine or student-API change

Every other structural contract in this repo (`robot-def`, `world-def`) is hand-mirrored across TypeScript, Python, and C++, because the data it describes is consumed by all three (the sim math, the student's own program, or the compiled SDK). A competition is different: **the student's program never sees it**. A student still just calls `robot.forward()` / `robot.findColor()` exactly as in any other run -- the competition only changes which arena is loaded underneath, and an outer layer (`apps/studio/src/compete/score.ts`) watches the robot's own already-exposed per-tick pose (`EngineWorld.state()`) and evaluates objectives against it, entirely within the studio's own TypeScript layer. Nothing about the Python sidecar, the WASM engine, or the C++ SDK changes to support this, including the v1 sequencing addition -- it's still pure TypeScript arithmetic over already-exposed pose data. So `contracts/competition` is deliberately **TypeScript-only** -- there is no `runtime/python/okrobo/competition.py` and no `engine/src/competition.{hpp,cpp}`, and there shouldn't be one added later unless a genuinely new consumer (e.g. a student-callable "what's my score right now?" API) appears.

Relatedly: `avoid_obstacle_collision` cannot be implemented by reading the engine's own `collided` flag (`engine/src/world.cpp`) -- that flag is wall-boundary-only (set only when the position clamp against the *arena walls* fires). A robot drives straight through an "obstacle" box today; obstacles only ever feed the ray-cast distance/lidar sensor. `avoid_obstacle_collision` is therefore computed independently, in `score.ts`, from the robot's own pose plus `arena.obstacles` -- both already available every tick with no new engine plumbing.

## Reference implementation and validation

The executable spec is `apps/studio/src/compete/competitionDef.ts` (`parseCompetitionDef`, `validateCompetitionDef`) -- reusing `apps/studio/src/lib/validateWorld.ts`'s own `WorldDef`/obstacle-parsing directly for the `arena` field, rather than a second, possibly-drifting copy of the same rules. `apps/studio/src/compete/competitionDef.test.ts` reads the same fixtures under `examples/` and `invalid/`.

Validation never throws: `validateCompetitionDef` always returns a list of issues (`{rule, severity, objective_index?, message}`), even an empty one. Parsing (`parseCompetitionDef`) still throws on malformed JSON shape -- a file-corruption/programmer error, not a design-time issue for a student or teacher to fix.

Sequencing itself is scored in `apps/studio/src/compete/score.ts`: `ObjectiveOutcome` carries a `locked: boolean`, computed each tick from the *previous* tick's outcomes (not the array being built this same tick -- avoids an ordering dependency on how objectives happen to be arranged in the JSON; a zone unlocking one simulation tick, 10ms, after its prerequisite is achieved is imperceptible). A locked zone's distance check is skipped entirely. This same `locked` flag drives both the HUD's own objective list and the real ground-ring markers `Viewport3D.tsx` renders for every `reach_zone` (see `docs/decisions/competition-arena-definition-scoring.md`'s v1 addendum).

## Non-goals (v1)

- No arbitrary dependency graphs between objectives (`requires: string[]` against stable ids) -- `sequence` numbers are a simpler, sufficient model for linear/tiered progressions (a checkpoint race, a pickup-then-delivery) and match every real use case identified so far. A DAG model is a genuine future addition if a competition ever needs one objective to depend on two *different* prior objectives in a way a shared tier can't express.
- No unknown/procedurally-hidden mazes (fog-of-war arena geometry) -- every zone and obstacle is fully visible from the start, matching this app's existing arena rendering everywhere else. A "the robot must discover the layout itself" mode is real future scope, not this version.
- No Robot-Builder-authored (custom, CAD-designed) robots -- `robot` is `"car"` only.
- No multi-robot competitions, no AI opponents, no tournament/leaderboard concepts. Those are product-level features layered on top of a single competition run, not part of this document.

## Versioning

`v0` is frozen -- a historical reference nothing points at anymore, superseded by this directory. This directory is frozen once its one language mirror ships. Changes go to `v2/` with the mirror updated in the same commit.
