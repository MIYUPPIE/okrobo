// Loads the WASM engine built by scripts/build-engine-wasm.sh from
// public/engine/okrobo_engine.js. The file is generated (gitignored); when it
// is missing the studio falls back to the 2D placeholder view.

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

const ENGINE_URL = "/engine/okrobo_engine.js";

export async function loadEngine(): Promise<EngineModule> {
  const module = (await import(/* @vite-ignore */ ENGINE_URL)) as {
    default: () => Promise<EngineModule>;
  };
  return module.default();
}
