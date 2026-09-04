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
const enginePath = join(ROOT, "apps", "studio", "src", "generated", "okrobo_engine.js");

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

/** Build a world in the engine exactly as the world file describes it. */
function createWorld(startX, startY, startTheta) {
  const handle = engine._world_create(
    world.arena_width,
    world.arena_height,
    world.robot_radius,
    world.wheel_base,
    startX,
    startY,
    startTheta,
  );
  for (const obstacle of world.obstacles ?? []) {
    const [r, g, b] = obstacle.color ?? [200, 60, 60];
    engine._world_add_obstacle(
      handle,
      obstacle.x,
      obstacle.y,
      obstacle.width ?? 0.2,
      obstacle.height ?? 0.2,
      r,
      g,
      b,
    );
  }
  return handle;
}

const w = createWorld(world.start.x, world.start.y, world.start.theta);

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
  `parity: car ${wasmStates.length} states match the reference (max diff ${maxDiff.toExponential(2)}, tol ${TOLERANCE})`,
);

// ---- arm (contract v1) ----

const armScenarioPath = join(ROOT, "engine", "tests", "parity", "arm-scenario.json");
const armReference = execFileSync(
  "python3",
  ["-m", "okrobo.dump_trace", "--robot", "arm", "--scenario", armScenarioPath],
  { cwd: join(ROOT, "runtime", "python"), encoding: "utf8" },
)
  .trim()
  .split("\n");

const armScenario = JSON.parse(readFileSync(armScenarioPath, "utf8"));
const arm = engine._arm_create();
const armState = () => ({
  tick: engine._arm_tick(arm),
  joints: {
    angles: [0, 1, 2, 3].map((j) => engine._arm_angle(arm, j)),
    targets: [0, 1, 2, 3].map((j) => engine._arm_target(arm, j)),
  },
  moving: engine._arm_moving(arm) === 1,
  tip: { x: engine._arm_tip_x(arm), y: engine._arm_tip_y(arm), z: engine._arm_tip_z(arm) },
});

const armStates = [];
for (const phase of armScenario.phases) {
  const c = phase.command;
  if (c.type === "arm_target") engine._arm_set_target(arm, c.joint, c.angle);
  else if (c.type === "stop") engine._arm_stop(arm);
  else if (c.type === "reset") engine._arm_reset(arm);
  else throw new Error(`unknown arm command: ${c.type}`);
  armStates.push(armState());
  for (let i = 0; i < phase.steps; i++) {
    engine._arm_step(arm, armScenario.dt);
    armStates.push(armState());
  }
}
engine._arm_destroy(arm);

if (armReference.length !== armStates.length) {
  console.error(`arm parity: length mismatch ref=${armReference.length} wasm=${armStates.length}`);
  process.exit(1);
}

let armMaxDiff = 0;
for (let i = 0; i < armReference.length; i++) {
  const ref = JSON.parse(armReference[i]);
  const got = armStates[i];
  const diffs = [
    ["tick", Math.abs(ref.tick - got.tick)],
    ["moving", ref.moving === got.moving ? 0 : 1],
    ["tip.x", Math.abs(ref.tip.x - got.tip.x)],
    ["tip.y", Math.abs(ref.tip.y - got.tip.y)],
    ["tip.z", Math.abs(ref.tip.z - got.tip.z)],
  ];
  for (let j = 0; j < 4; j++) {
    diffs.push([`angles[${j}]`, Math.abs(ref.joints.angles[j] - got.joints.angles[j])]);
    diffs.push([`targets[${j}]`, Math.abs(ref.joints.targets[j] - got.joints.targets[j])]);
  }
  for (const [field, diff] of diffs) {
    armMaxDiff = Math.max(armMaxDiff, diff);
    if (diff > TOLERANCE) {
      console.error(`arm parity: mismatch at state ${i}, field ${field}, diff ${diff}`);
      console.error(`  ref:  ${JSON.stringify(ref)}`);
      console.error(`  wasm: ${JSON.stringify(got)}`);
      process.exit(1);
    }
  }
}

console.log(
  `parity: arm ${armStates.length} states match the reference (max diff ${armMaxDiff.toExponential(2)}, tol ${TOLERANCE})`,
);

// ---- arm graspable object (contract v3): real MuJoCo both sides ----
//
// A same-tolerance-as-everything-else field was not assumed safe here: the
// WASM build uses MuJoCo's portable scalar fallback (no AVX under
// Emscripten -- confirmed in the feasibility spike) while the native Python
// bindings may pick different SIMD on this machine, so the two solvers
// could in principle diverge at the level of floating-point operation
// order even while both stay physically correct. Measured, not assumed:
// this scenario's actual max diff is 5.55e-17 (machine epsilon), so
// PHYSICS_TOLERANCE matches the rest of this file's 1e-9 exactly rather
// than masking a real future regression behind a loose bound.
const PHYSICS_TOLERANCE = TOLERANCE;

const armPhysicsScenarioPath = join(ROOT, "engine", "tests", "parity", "arm-physics-scenario.json");
const armPhysicsReference = execFileSync(
  "python3",
  ["-m", "okrobo.dump_trace", "--robot", "arm", "--scenario", armPhysicsScenarioPath],
  { cwd: join(ROOT, "runtime", "python"), encoding: "utf8" },
)
  .trim()
  .split("\n");

const armPhysicsScenario = JSON.parse(readFileSync(armPhysicsScenarioPath, "utf8"));
const arm2 = engine._arm_create();
const armPhysicsState = () => ({
  tick: engine._arm_tick(arm2),
  moving: engine._arm_moving(arm2) === 1,
  tip: { x: engine._arm_tip_x(arm2), y: engine._arm_tip_y(arm2), z: engine._arm_tip_z(arm2) },
  holding: engine._arm_holding(arm2) === 1,
  object: {
    x: engine._arm_object_x(arm2),
    y: engine._arm_object_y(arm2),
    z: engine._arm_object_z(arm2),
  },
});

const armPhysicsStates = [];
for (const phase of armPhysicsScenario.phases) {
  const c = phase.command;
  if (c.type === "arm_target") engine._arm_set_target(arm2, c.joint, c.angle);
  else if (c.type === "arm_grip") engine._arm_grip(arm2);
  else if (c.type === "arm_release") engine._arm_release(arm2);
  else if (c.type === "stop") engine._arm_stop(arm2);
  else if (c.type === "reset") engine._arm_reset(arm2);
  else throw new Error(`unknown arm command: ${c.type}`);
  armPhysicsStates.push(armPhysicsState());
  for (let i = 0; i < phase.steps; i++) {
    engine._arm_step(arm2, armPhysicsScenario.dt);
    armPhysicsStates.push(armPhysicsState());
  }
}
engine._arm_destroy(arm2);

if (armPhysicsReference.length !== armPhysicsStates.length) {
  console.error(
    `arm physics parity: length mismatch ref=${armPhysicsReference.length} wasm=${armPhysicsStates.length}`,
  );
  process.exit(1);
}

let armPhysicsMaxDiff = 0;
for (let i = 0; i < armPhysicsReference.length; i++) {
  const ref = JSON.parse(armPhysicsReference[i]);
  const got = armPhysicsStates[i];
  const diffs = [
    ["tick", Math.abs(ref.tick - got.tick), TOLERANCE],
    ["moving", ref.moving === got.moving ? 0 : 1, TOLERANCE],
    ["holding", ref.holding === got.holding ? 0 : 1, TOLERANCE],
    ["tip.x", Math.abs(ref.tip.x - got.tip.x), TOLERANCE],
    ["tip.y", Math.abs(ref.tip.y - got.tip.y), TOLERANCE],
    ["tip.z", Math.abs(ref.tip.z - got.tip.z), TOLERANCE],
    ["object.x", Math.abs(ref.object.x - got.object.x), PHYSICS_TOLERANCE],
    ["object.y", Math.abs(ref.object.y - got.object.y), PHYSICS_TOLERANCE],
    ["object.z", Math.abs(ref.object.z - got.object.z), PHYSICS_TOLERANCE],
  ];
  for (const [field, diff, tol] of diffs) {
    armPhysicsMaxDiff = Math.max(armPhysicsMaxDiff, diff);
    if (diff > tol) {
      console.error(`arm physics parity: mismatch at state ${i}, field ${field}, diff ${diff} (tol ${tol})`);
      console.error(`  ref:  ${JSON.stringify(ref)}`);
      console.error(`  wasm: ${JSON.stringify(got)}`);
      process.exit(1);
    }
  }
}

console.log(
  `parity: arm physics ${armPhysicsStates.length} states match the reference ` +
    `(max diff ${armPhysicsMaxDiff.toExponential(2)}, tol ${PHYSICS_TOLERANCE} for the object, ${TOLERANCE} otherwise)`,
);

// ---- drone (contract v2) ----

const droneScenarioPath = join(ROOT, "engine", "tests", "parity", "drone-scenario.json");
const droneReference = execFileSync(
  "python3",
  ["-m", "okrobo.dump_trace", "--robot", "drone", "--scenario", droneScenarioPath],
  { cwd: join(ROOT, "runtime", "python"), encoding: "utf8" },
)
  .trim()
  .split("\n");

const droneScenario = JSON.parse(readFileSync(droneScenarioPath, "utf8"));
// Matches DroneConfig's defaults in _sim.py / drone.hpp: 2x2 arena, start (1,1,0,0).
const drone = engine._drone_create(2.0, 2.0, 0.1, 1.0, 1.0, 1.0, 0.0, 0.0);
const droneState = () => ({
  tick: engine._drone_tick(drone),
  pose: {
    x: engine._drone_x(drone),
    y: engine._drone_y(drone),
    z: engine._drone_z(drone),
    theta: engine._drone_theta(drone),
  },
  sensors: { distance: engine._drone_distance(drone) },
  collided: engine._drone_collided(drone) === 1,
});

const droneStates = [];
for (const phase of droneScenario.phases) {
  const c = phase.command;
  if (c.type === "drone_drive") engine._drone_drive(drone, c.forward, c.vertical, c.yaw_rate);
  else if (c.type === "drone_stop") engine._drone_stop(drone);
  else if (c.type === "drone_reset") engine._drone_reset(drone);
  else throw new Error(`unknown drone command: ${c.type}`);
  droneStates.push(droneState());
  for (let i = 0; i < phase.steps; i++) {
    engine._drone_step(drone, droneScenario.dt);
    droneStates.push(droneState());
  }
}
engine._drone_destroy(drone);

if (droneReference.length !== droneStates.length) {
  console.error(`drone parity: length mismatch ref=${droneReference.length} wasm=${droneStates.length}`);
  process.exit(1);
}

let droneMaxDiff = 0;
for (let i = 0; i < droneReference.length; i++) {
  const ref = JSON.parse(droneReference[i]);
  const got = droneStates[i];
  const diffs = [
    ["tick", Math.abs(ref.tick - got.tick)],
    ["pose.x", Math.abs(ref.pose.x - got.pose.x)],
    ["pose.y", Math.abs(ref.pose.y - got.pose.y)],
    ["pose.z", Math.abs(ref.pose.z - got.pose.z)],
    ["pose.theta", Math.abs(ref.pose.theta - got.pose.theta)],
    ["sensors.distance", Math.abs(ref.sensors.distance - got.sensors.distance)],
    ["collided", ref.collided === got.collided ? 0 : 1],
  ];
  for (const [field, diff] of diffs) {
    droneMaxDiff = Math.max(droneMaxDiff, diff);
    if (diff > TOLERANCE) {
      console.error(`drone parity: mismatch at state ${i}, field ${field}, diff ${diff}`);
      console.error(`  ref:  ${JSON.stringify(ref)}`);
      console.error(`  wasm: ${JSON.stringify(got)}`);
      process.exit(1);
    }
  }
}

console.log(
  `parity: drone ${droneStates.length} states match the reference (max diff ${droneMaxDiff.toExponential(2)}, tol ${TOLERANCE})`,
);

// ---- camera (contract v2): frames must match byte for byte ----

const CAMERA_WIDTH = 64;
const CAMERA_HEIGHT = 48;

const cameraReference = execFileSync(
  "python3",
  [
    "-m",
    "okrobo.dump_camera",
    "--world",
    worldPath,
    "--width",
    String(CAMERA_WIDTH),
    "--height",
    String(CAMERA_HEIGHT),
  ],
  { cwd: join(ROOT, "runtime", "python"), encoding: "utf8" },
)
  .trim()
  .split("\n");

let cameraFrames = 0;
for (const line of cameraReference) {
  const [x, y, theta, expectedHex] = line.split(" ");
  const camWorld = createWorld(Number(x), Number(y), Number(theta));
  const written = engine._world_render_camera(camWorld, CAMERA_WIDTH, CAMERA_HEIGHT);
  if (written !== CAMERA_WIDTH * CAMERA_HEIGHT * 3) {
    console.error(`camera parity: engine wrote ${written} bytes`);
    process.exit(1);
  }
  const address = engine._world_camera_buffer();
  const actual = Buffer.from(engine.HEAPU8.buffer, address, written).toString("hex");
  engine._world_destroy(camWorld);

  if (actual !== expectedHex) {
    // Report the first differing pixel rather than dumping the whole frame.
    let index = 0;
    while (index < actual.length && actual[index] === expectedHex[index]) index++;
    const pixel = Math.floor(index / 6);
    console.error(
      `camera parity: frame at pose (${x}, ${y}, ${theta}) differs at pixel ${pixel} ` +
        `(row ${Math.floor(pixel / CAMERA_WIDTH)}, column ${pixel % CAMERA_WIDTH})`,
    );
    console.error(`  ref:  ${expectedHex.slice(index - 6, index + 12)}`);
    console.error(`  wasm: ${actual.slice(index - 6, index + 12)}`);
    process.exit(1);
  }
  cameraFrames++;
}

console.log(
  `parity: camera ${cameraFrames} frames match the reference byte for byte ` +
    `(${CAMERA_WIDTH}x${CAMERA_HEIGHT})`,
);
