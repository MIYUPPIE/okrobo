import { ARM_JOINT_NAMES } from "../contracts/robotApi";
import type { EngineArm } from "../engine/EngineArm";
import type { EngineWorld } from "../engine/EngineWorld";

// Executes robot movements against the engine with the same semantics as the
// Python Robot API (runtime/python/okrobo/robot.py): blocking duration-based
// movements at fixed speeds, an exact partial step at the end of each
// movement, early stop on wall contact. The render loop feeds real time in
// through tick(); student programs await the returned promises.

export const PROGRAM_SPEED = 0.2; // m/s, matches Robot.SPEED
export const PROGRAM_TURN_SPEED = 0.1; // wheel m/s during turns, matches Robot.TURN_SPEED

export class ProgramStoppedError extends Error {
  constructor() {
    super("program stopped");
    this.name = "ProgramStoppedError";
  }
}

interface Movement {
  stepsLeft: number;
  remainder: number;
  resolve: () => void;
  reject: (error: Error) => void;
}

/** The surface handed to generated student code as `robot`. */
export interface RobotApi {
  forward(meters?: number): Promise<void>;
  backward(meters?: number): Promise<void>;
  turnLeft(degrees?: number): Promise<void>;
  turnRight(degrees?: number): Promise<void>;
  wait(seconds: number): Promise<void>;
  distance(): number;
  lidar(rays?: number, fovDegrees?: number): number[];
  /** RGB frame from the robot's camera (contract v2). */
  camera(width?: number, height?: number): { width: number; height: number; pixels: number[] };
  heading(): number;
  position(): [number, number];
  stop(): void;
  armMove(joint: number | string, degrees: number): Promise<void>;
  armMoveAll(degrees: number[]): Promise<void>;
  armAngles(): number[];
  armTip(): [number, number, number];
  _checkpoint(): Promise<void>;
}

export function armJointIndex(joint: number | string): number {
  if (typeof joint === "string") {
    const index = (ARM_JOINT_NAMES as readonly string[]).indexOf(joint.toLowerCase());
    if (index < 0) throw new Error(`unknown joint: ${joint}`);
    return index;
  }
  if (joint < 0 || joint >= ARM_JOINT_NAMES.length) throw new Error(`joint out of range: ${joint}`);
  return joint;
}

interface ArmWait {
  resolve: () => void;
  reject: (error: Error) => void;
}

export class ProgramRunner {
  readonly api: RobotApi;
  private movement: Movement | null = null;
  private armWait: ArmWait | null = null;
  private aborted = false;

  constructor(
    private readonly engine: EngineWorld,
    private readonly wheelBase: number,
    private readonly engineArm: EngineArm | null = null,
    private readonly dt = 0.01,
  ) {
    this.api = {
      forward: (meters = 0.1) => this.move(PROGRAM_SPEED, PROGRAM_SPEED, Math.abs(meters) / PROGRAM_SPEED),
      backward: (meters = 0.1) => this.move(-PROGRAM_SPEED, -PROGRAM_SPEED, Math.abs(meters) / PROGRAM_SPEED),
      turnLeft: (degrees = 90) => this.turn(degrees),
      turnRight: (degrees = 90) => this.turn(-degrees),
      wait: (seconds: number) => this.move(0, 0, Math.max(0, seconds)),
      distance: () => this.engine.state().sensors.distance,
      lidar: (rays = 9, fovDegrees = 180) => {
        if (rays < 1) return [];
        if (rays === 1) return [this.engine.ray(0)];
        const half = (fovDegrees * Math.PI) / 360;
        const step = (fovDegrees * Math.PI) / 180 / (rays - 1);
        return Array.from({ length: rays }, (_, i) => this.engine.ray(half - i * step));
      },
      camera: (width = 64, height = 48) => {
        const frame = this.engine.camera(width, height);
        if (!frame) throw new Error(`camera size ${width}x${height} is out of range`);
        // Plain numbers so the frame survives JSON on the way to Python.
        return { width: frame.width, height: frame.height, pixels: Array.from(frame.pixels) };
      },
      heading: () => (this.engine.state().pose.theta * 180) / Math.PI,
      position: () => {
        const { x, y } = this.engine.state().pose;
        return [x, y];
      },
      stop: () => this.engine.apply({ type: "stop" }),
      armMove: (joint, degrees) => {
        let index: number;
        try {
          index = armJointIndex(joint);
        } catch (error) {
          return Promise.reject(error);
        }
        return this.armCommand(() =>
          this.requireArm().apply({ type: "arm_target", joint: index, angle: (degrees * Math.PI) / 180 }),
        );
      },
      armMoveAll: (degrees) =>
        this.armCommand(() => {
          const arm = this.requireArm();
          degrees.forEach((value, joint) =>
            arm.apply({ type: "arm_target", joint, angle: (value * Math.PI) / 180 }),
          );
        }),
      armAngles: () => this.requireArm().state().joints.angles.map((a) => (a * 180) / Math.PI),
      armTip: () => {
        const { x, y, z } = this.requireArm().state().tip;
        return [x, y, z];
      },
      _checkpoint: async () => {
        if (this.aborted) throw new ProgramStoppedError();
        // Yield a macrotask so `while (true)` loops never freeze the UI.
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (this.aborted) throw new ProgramStoppedError();
      },
    };
  }

  /** Step both worlds. Called from the render loop with this frame's budget. */
  tick(steps: number): void {
    for (let i = 0; i < steps; i++) {
      this.engine.step(this.dt);
      this.engineArm?.step(this.dt);
      const m = this.movement;
      if (m) {
        m.stepsLeft -= 1;
        const collided = this.engine.state().collided;
        if (m.stepsLeft <= 0 || collided) {
          if (!collided && m.remainder > 1e-12) this.engine.step(m.remainder);
          this.finishMovement();
          m.resolve();
        }
      }
      const wait = this.armWait;
      if (wait && this.engineArm && !this.engineArm.state().moving) {
        this.armWait = null;
        wait.resolve();
      }
    }
  }

  get busy(): boolean {
    return this.movement !== null || this.armWait !== null;
  }

  /** Allow a new program to run after a previous abort. */
  arm(): void {
    this.aborted = false;
  }

  /** Interrupt the program: active movements reject, wheels and joints stop. */
  abort(): void {
    this.aborted = true;
    const m = this.movement;
    this.finishMovement();
    m?.reject(new ProgramStoppedError());
    const wait = this.armWait;
    this.armWait = null;
    this.engineArm?.apply({ type: "stop" });
    wait?.reject(new ProgramStoppedError());
  }

  private requireArm(): EngineArm {
    if (!this.engineArm) throw new Error("no arm in this world");
    return this.engineArm;
  }

  private armCommand(applyTargets: () => void): Promise<void> {
    if (this.aborted) return Promise.reject(new ProgramStoppedError());
    if (this.armWait) return Promise.reject(new Error("the arm is already moving"));
    applyTargets();
    if (!this.requireArm().state().moving) return Promise.resolve();
    return new Promise((resolve, reject) => {
      this.armWait = { resolve, reject };
    });
  }

  private finishMovement(): void {
    this.movement = null;
    this.engine.apply({ type: "stop" });
  }

  private turn(degrees: number): Promise<void> {
    if (degrees === 0) return Promise.resolve();
    const omega = (2 * PROGRAM_TURN_SPEED) / this.wheelBase;
    const duration = Math.abs((degrees * Math.PI) / 180) / omega;
    const wheel = degrees > 0 ? PROGRAM_TURN_SPEED : -PROGRAM_TURN_SPEED;
    return this.move(-wheel, wheel, duration);
  }

  private move(left: number, right: number, duration: number): Promise<void> {
    if (this.aborted) return Promise.reject(new ProgramStoppedError());
    if (this.movement) return Promise.reject(new Error("robot is already moving"));
    const fullSteps = Math.floor(duration / this.dt);
    const remainder = duration - fullSteps * this.dt;
    this.engine.apply({ type: "drive", left, right });
    if (fullSteps === 0) {
      // Movement shorter than one step: run it synchronously and finish.
      if (remainder > 1e-12) this.engine.step(remainder);
      this.engine.apply({ type: "stop" });
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      this.movement = { stepsLeft: fullSteps, remainder, resolve, reject };
    });
  }
}
