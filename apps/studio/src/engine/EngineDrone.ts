import type { DroneCommand, DroneState } from "../contracts/robotApi";
import type { WorldDef } from "../lib/validateWorld";
import type { EngineModule } from "./loader";

/** The drone inside the WASM engine, speaking contract v2. Shares the car's
 * arena footprint (arena_width/height, robot_radius) so the world editor's
 * bounds apply to it too; the drone otherwise has its own handle and its
 * own pose, independent of any live EngineWorld instance. */
export class EngineDrone {
  private readonly module: EngineModule;
  private readonly handle: number;

  constructor(module: EngineModule, world: WorldDef, maxAltitude = 1.0) {
    this.module = module;
    this.handle = module._drone_create(
      world.arena_width,
      world.arena_height,
      world.robot_radius,
      maxAltitude,
      world.start.x,
      world.start.y,
      0.0,
      world.start.theta,
    );
  }

  apply(command: DroneCommand): void {
    switch (command.type) {
      case "drone_drive":
        this.module._drone_drive(this.handle, command.forward, command.vertical, command.yaw_rate);
        break;
      case "drone_stop":
        this.module._drone_stop(this.handle);
        break;
      case "drone_reset":
        this.module._drone_reset(this.handle);
        break;
    }
  }

  step(dt: number): void {
    this.module._drone_step(this.handle, dt);
  }

  state(): DroneState {
    return {
      tick: this.module._drone_tick(this.handle),
      pose: {
        x: this.module._drone_x(this.handle),
        y: this.module._drone_y(this.handle),
        z: this.module._drone_z(this.handle),
        theta: this.module._drone_theta(this.handle),
      },
      sensors: { distance: this.module._drone_distance(this.handle) },
      collided: this.module._drone_collided(this.handle) === 1,
    };
  }

  destroy(): void {
    this.module._drone_destroy(this.handle);
  }
}
