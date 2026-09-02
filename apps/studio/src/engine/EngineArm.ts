import type { ArmCommand, ArmState } from "../contracts/robotApi";
import type { EngineModule } from "./loader";

/** The 4-DOF arm inside the WASM engine, speaking contract v1. */
export class EngineArm {
  private readonly module: EngineModule;
  private readonly handle: number;

  constructor(module: EngineModule) {
    this.module = module;
    this.handle = module._arm_create();
  }

  apply(command: ArmCommand): void {
    switch (command.type) {
      case "arm_target":
        this.module._arm_set_target(this.handle, command.joint, command.angle);
        break;
      case "stop":
        this.module._arm_stop(this.handle);
        break;
      case "reset":
        this.module._arm_reset(this.handle);
        break;
    }
  }

  step(dt: number): void {
    this.module._arm_step(this.handle, dt);
  }

  state(): ArmState {
    const joints = [0, 1, 2, 3];
    return {
      tick: this.module._arm_tick(this.handle),
      joints: {
        angles: joints.map((j) => this.module._arm_angle(this.handle, j)),
        targets: joints.map((j) => this.module._arm_target(this.handle, j)),
      },
      moving: this.module._arm_moving(this.handle) === 1,
      tip: {
        x: this.module._arm_tip_x(this.handle),
        y: this.module._arm_tip_y(this.handle),
        z: this.module._arm_tip_z(this.handle),
      },
    };
  }

  destroy(): void {
    this.module._arm_destroy(this.handle);
  }
}
