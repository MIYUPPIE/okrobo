import { robotDefToJson, type RobotDef, type Sensor, type SensorType } from "../contracts/robotDef";
import { worldDefToJson, type WorldDef } from "../contracts/worldDef";
import type { EngineModule } from "./loader";

function writeJsonPayload(module: EngineModule, data: unknown): { ptr: number; len: number } {
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  const ptr = module._malloc(bytes.length);
  module.HEAPU8.set(bytes, ptr);
  return { ptr, len: bytes.length };
}

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

export interface SensorReading {
  id: string;
  type: SensorType;
  /** Empty for `camera` (not implemented -- see
   * docs/decisions/robot-builder-sensors.md). Otherwise a fixed width per
   * type: 1 for encoder/distance/touch, 3 for gps, 6 for imu/force_torque,
   * the sensor's own resolved ray count for lidar. */
  values: number[];
}

/**
 * A simulated instance of an arbitrary built robot (contracts/robot-def/v0),
 * optionally tested in a static environment (contracts/world-def/v0),
 * wrapping the WASM `built_*` exports. Bodies, joints, actuators (Phase 3),
 * seven of the eight sensor types (Phase 4; no `camera`), and static world
 * objects (Phase 5). See docs/decisions/robot-builder-physics.md,
 * docs/decisions/robot-builder-sensors.md, and
 * docs/decisions/robot-builder-world.md.
 */
export class EngineBuiltRobot {
  private readonly module: EngineModule;
  private readonly handle: number;
  private readonly sensors: Sensor[];

  /** Throws if `robot` (plus `world`'s objects, when given) can't be
   * turned into a compilable physics model (e.g. a `plane`-geometry body,
   * or a non-root `free` joint -- see docs/decisions/robot-builder-physics.md
   * for why those can never work). `world` is optional (Robot Builder
   * Phase 5) -- omitting it means just the robot and the floor, exactly
   * Phase 3/4's behavior. */
  constructor(module: EngineModule, robot: RobotDef, world?: WorldDef) {
    this.module = module;
    this.sensors = robot.sensors;

    const robotPayload = writeJsonPayload(module, robotDefToJson(robot));
    const worldPayload = world ? writeJsonPayload(module, worldDefToJson(world)) : null;
    let handle: number;
    try {
      handle = module._built_create(robotPayload.ptr, robotPayload.len, worldPayload?.ptr ?? 0, worldPayload?.len ?? 0);
    } finally {
      module._free(robotPayload.ptr);
      if (worldPayload) module._free(worldPayload.ptr);
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

  /** One reading per robot.sensors entry, in declaration order. Copied out
   * of the WASM heap, same not-a-live-view idiom as bodyPoses(). */
  sensorReadings(): SensorReading[] {
    const total = this.module._built_sync_sensor_data(this.handle);
    const bufferPtr = this.module._built_sensor_data_buffer();
    const start = bufferPtr / 8;
    const doubles = this.module.HEAPF64.slice(start, start + total);
    const readings: SensorReading[] = [];
    let offset = 0;
    for (let i = 0; i < this.sensors.length; i++) {
      const sensor = this.sensors[i];
      const width = this.module._built_sensor_output_count(this.handle, i);
      readings.push({ id: sensor.id, type: sensor.type, values: Array.from(doubles.slice(offset, offset + width)) });
      offset += width;
    }
    return readings;
  }

  destroy(): void {
    this.module._built_destroy(this.handle);
  }
}
