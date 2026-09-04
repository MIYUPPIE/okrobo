import { robotDefToJson, type RobotDef } from "../contracts/robotDef";
import type { EngineModule } from "./loader";

export interface BodyPose {
  x: number;
  y: number;
  z: number;
  // MuJoCo's native quaternion order (w,x,y,z) -- reordered to three.js's
  // (x,y,z,w) at the one call site that needs it (TestViewport.tsx), not here.
  qw: number;
  qx: number;
  qy: number;
  qz: number;
}

/**
 * A simulated instance of an arbitrary built robot (contracts/robot-def/v0),
 * wrapping the WASM `built_*` exports. Bodies, joints, actuators only -- no
 * sensors (Phase 4). See docs/decisions/robot-builder-physics.md.
 */
export class EngineBuiltRobot {
  private readonly module: EngineModule;
  private readonly handle: number;

  /** Throws if `robot` can't be turned into a compilable physics model
   * (e.g. a `plane`-geometry body, or a non-root `free` joint -- see
   * docs/decisions/robot-builder-physics.md for why those can never work). */
  constructor(module: EngineModule, robot: RobotDef) {
    this.module = module;
    const bytes = new TextEncoder().encode(JSON.stringify(robotDefToJson(robot)));
    const ptr = module._malloc(bytes.length);
    module.HEAPU8.set(bytes, ptr);
    let handle: number;
    try {
      handle = module._built_create(ptr, bytes.length);
    } finally {
      module._free(ptr);
    }
    if (!handle) {
      throw new Error("failed to build robot for physics -- check the document's issues");
    }
    this.handle = handle;
  }

  /** Advances the simulation by dt. */
  step(dt: number): void {
    this.module._built_step(this.handle, dt);
  }

  actuatorCount(): number {
    return this.module._built_actuator_count(this.handle);
  }

  /** False if that actuator has no MJCF equivalent (targets a ball/free
   * joint) or the index is out of range -- a documented no-op, not an error. */
  setActuatorCtrl(index: number, value: number): boolean {
    return this.module._built_set_actuator_ctrl(this.handle, index, value) === 1;
  }

  /** One pose per body, in the RobotDef's bodies[] declaration order. Copied
   * out of the WASM heap (the engine reuses the same scratch buffer on the
   * next call), matching EngineWorld.camera()'s established idiom. */
  bodyPoses(): BodyPose[] {
    const count = this.module._built_sync_body_poses(this.handle);
    const bufferPtr = this.module._built_body_pose_buffer();
    const start = bufferPtr / 8; // HEAPF64 indexes in 8-byte doubles, bufferPtr is a byte address
    const doubles = this.module.HEAPF64.slice(start, start + count * 7);
    const poses: BodyPose[] = [];
    for (let i = 0; i < count; i++) {
      const base = i * 7;
      poses.push({
        x: doubles[base],
        y: doubles[base + 1],
        z: doubles[base + 2],
        qw: doubles[base + 3],
        qx: doubles[base + 4],
        qy: doubles[base + 5],
        qz: doubles[base + 6],
      });
    }
    return poses;
  }

  destroy(): void {
    this.module._built_destroy(this.handle);
  }
}
