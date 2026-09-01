// Parity gate: the WASM engine must match the Python reference model
// (runtime/python/okrobo/_sim.py) state-for-state on the shared scenario.
// Run: node engine/tests/parity/parity.mjs   (after scripts/build-engine-wasm.sh)

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const TOLERANCE = 1e-9;

const worldPath = join(ROOT, "packs", "core", "worlds", "arena.json");
const scenarioPath = join(ROOT, "engine", "tests", "parity", "scenario.json");
const enginePath = join(ROOT, "apps", "studio", "public", "engine", "okrobo_engine.js");

// Reference trace from Python.
const referenceLines = execFileSync(
  "python3",
  ["-m", "okrobo.dump_trace", "--world", worldPath, "--scenario", scenarioPath],
  { cwd: join(ROOT, "runtime", "python"), encoding: "utf8" },
)
  .trim()
  .split("\n");

// Same scenario through the WASM engine.
const world = JSON.parse(readFileSync(worldPath, "utf8"));
const scenario = JSON.parse(readFileSync(scenarioPath, "utf8"));
const createEngineModule = (await import(enginePath)).default;
const engine = await createEngineModule();

const w = engine._world_create(
  world.arena_width,
  world.arena_height,
  world.robot_radius,
  world.wheel_base,
  world.start.x,
  world.start.y,
  world.start.theta,
);

const wasmState = () => ({
  tick: engine._world_tick(w),
  pose: { x: engine._world_x(w), y: engine._world_y(w), theta: engine._world_theta(w) },
  sensors: { distance: engine._world_distance(w) },
  collided: engine._world_collided(w) === 1,
});

const wasmStates = [];
for (const phase of scenario.phases) {
  const c = phase.command;
  if (c.type === "drive") engine._world_drive(w, c.left, c.right);
  else if (c.type === "stop") engine._world_stop(w);
  else if (c.type === "reset") engine._world_reset(w);
  else throw new Error(`unknown command type: ${c.type}`);
  wasmStates.push(wasmState());
  for (let i = 0; i < phase.steps; i++) {
    engine._world_step(w, scenario.dt);
    wasmStates.push(wasmState());
  }
}
engine._world_destroy(w);

// Compare.
if (referenceLines.length !== wasmStates.length) {
  console.error(`parity: length mismatch ref=${referenceLines.length} wasm=${wasmStates.length}`);
  process.exit(1);
}

let maxDiff = 0;
for (let i = 0; i < referenceLines.length; i++) {
  const ref = JSON.parse(referenceLines[i]);
  const got = wasmStates[i];
  const diffs = [
    ["tick", Math.abs(ref.tick - got.tick)],
    ["pose.x", Math.abs(ref.pose.x - got.pose.x)],
    ["pose.y", Math.abs(ref.pose.y - got.pose.y)],
    ["pose.theta", Math.abs(ref.pose.theta - got.pose.theta)],
    ["sensors.distance", Math.abs(ref.sensors.distance - got.sensors.distance)],
    ["collided", ref.collided === got.collided ? 0 : 1],
  ];
  for (const [field, diff] of diffs) {
    maxDiff = Math.max(maxDiff, diff);
    if (diff > TOLERANCE) {
      console.error(`parity: mismatch at state ${i}, field ${field}, diff ${diff}`);
      console.error(`  ref:  ${JSON.stringify(ref)}`);
      console.error(`  wasm: ${JSON.stringify(got)}`);
      process.exit(1);
    }
  }
}

console.log(
  `parity: ${wasmStates.length} states match the reference (max diff ${maxDiff.toExponential(2)}, tol ${TOLERANCE})`,
);
