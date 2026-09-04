// Loads the WASM engine built by scripts/build-engine-wasm.sh from
// src/generated/okrobo_engine.js. The file is generated (gitignored), so it is
// referenced through import.meta.glob: Vite resolves it as a normal module in
// dev, build, and tests, and yields nothing (instead of failing the build)
// when the engine has not been compiled yet — the studio then shows its
// "engine not built" fallback.
//
// It must NOT live in public/: Vite's dev server refuses to serve public files
// as ES modules, which silently breaks `npm run dev` and `tauri dev`.

export interface EngineModule {
  _world_create(
    arenaWidth: number,
    arenaHeight: number,
    robotRadius: number,
    wheelBase: number,
    startX: number,
    startY: number,
    startTheta: number,
  ): number;
  _world_destroy(world: number): void;
  _world_drive(world: number, left: number, right: number): void;
  _world_stop(world: number): void;
  _world_reset(world: number): void;
  _world_step(world: number, dt: number): void;
  _world_tick(world: number): number;
  _world_x(world: number): number;
  _world_y(world: number): number;
  _world_theta(world: number): number;
  _world_distance(world: number): number;
  _world_collided(world: number): number;
  _world_ray(world: number, offset: number): number;
  _world_add_obstacle(
    world: number,
    x: number,
    y: number,
    width: number,
    height: number,
    r: number,
    g: number,
    b: number,
  ): void;
  _world_obstacle_count(world: number): number;
  _world_render_camera(world: number, width: number, height: number): number;
  _world_camera_buffer(): number;
  HEAPU8: Uint8Array;
  _arm_create(): number;
  _arm_destroy(arm: number): void;
  _arm_set_target(arm: number, joint: number, angle: number): void;
  _arm_stop(arm: number): void;
  _arm_reset(arm: number): void;
  _arm_step(arm: number, dt: number): void;
  _arm_tick(arm: number): number;
  _arm_angle(arm: number, joint: number): number;
  _arm_target(arm: number, joint: number): number;
  _arm_moving(arm: number): number;
  _arm_tip_x(arm: number): number;
  _arm_tip_y(arm: number): number;
  _arm_tip_z(arm: number): number;
  _arm_grip(arm: number): number;
  _arm_release(arm: number): void;
  _arm_holding(arm: number): number;
  _arm_object_x(arm: number): number;
  _arm_object_y(arm: number): number;
  _arm_object_z(arm: number): number;
  _drone_create(
    arenaWidth: number,
    arenaHeight: number,
    robotRadius: number,
    maxAltitude: number,
    startX: number,
    startY: number,
    startZ: number,
    startTheta: number,
  ): number;
  _drone_destroy(drone: number): void;
  _drone_drive(drone: number, forward: number, vertical: number, yawRate: number): void;
  _drone_stop(drone: number): void;
  _drone_reset(drone: number): void;
  _drone_step(drone: number, dt: number): void;
  _drone_tick(drone: number): number;
  _drone_x(drone: number): number;
  _drone_y(drone: number): number;
  _drone_z(drone: number): number;
  _drone_theta(drone: number): number;
  _drone_distance(drone: number): number;
  _drone_collided(drone: number): number;
  _drone_ray(drone: number, offset: number): number;
}

type EngineFactory = { default: () => Promise<EngineModule> };

const ENGINE_PATH = "../generated/okrobo_engine.js";
const engineModules = import.meta.glob<EngineFactory>("../generated/okrobo_engine.js");

export const ENGINE_MISSING_MESSAGE =
  "engine not built: run ./scripts/build-engine-wasm.sh, then reload";

export async function loadEngine(): Promise<EngineModule> {
  const load = engineModules[ENGINE_PATH];
  if (!load) throw new Error(ENGINE_MISSING_MESSAGE);
  return (await load()).default();
}
