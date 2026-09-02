import type { Command, State } from "../contracts/robotApi";
import type { WorldDef } from "../lib/validateWorld";
import type { EngineModule } from "./loader";

/** A world instance inside the WASM engine, speaking contract v0. */
export class EngineWorld {
  private readonly module: EngineModule;
  private readonly handle: number;

  constructor(module: EngineModule, world: WorldDef) {
    this.module = module;
    this.handle = module._world_create(
      world.arena_width,
      world.arena_height,
      world.robot_radius,
      world.wheel_base,
      world.start.x,
      world.start.y,
      world.start.theta,
    );
  }

  apply(command: Command): void {
    switch (command.type) {
      case "drive":
        this.module._world_drive(this.handle, command.left, command.right);
        break;
      case "stop":
        this.module._world_stop(this.handle);
        break;
      case "reset":
        this.module._world_reset(this.handle);
        break;
    }
  }

  step(dt: number): void {
    this.module._world_step(this.handle, dt);
  }

  /** Distance to the wall along heading+offset radians (v1 lidar primitive). */
  ray(offset: number): number {
    return this.module._world_ray(this.handle, offset);
  }

  state(): State {
    return {
      tick: this.module._world_tick(this.handle),
      pose: {
        x: this.module._world_x(this.handle),
        y: this.module._world_y(this.handle),
        theta: this.module._world_theta(this.handle),
      },
      sensors: { distance: this.module._world_distance(this.handle) },
      collided: this.module._world_collided(this.handle) === 1,
    };
  }

  destroy(): void {
    this.module._world_destroy(this.handle);
  }
}
