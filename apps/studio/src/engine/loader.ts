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
