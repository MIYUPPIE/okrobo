import type { RobotDef } from "../contracts/robotDef";
import type { EngineBuiltRobot } from "../engine/EngineBuiltRobot";
import { ProgramStoppedError } from "./ProgramRunner";

// Executes a program against an arbitrary built robot (contracts/robot-def/v0),
// addressed by the student's own actuator/sensor ids rather than a fixed,
// hardcoded vocabulary -- the Robot Builder Phase 6 counterpart to
// ProgramRunner.ts's Car/Arm/Drone pipeline. See
// docs/decisions/robot-builder-programming.md for why this is a separate,
// simpler class rather than a unification of the two: MuJoCo actuators are
// continuous control (set-and-forget), not ProgramRunner's discrete,
// step-and-resolve kinematic movements, so there is no fullSteps/remainder
// precision to manage -- only `wait()` needs real tick coordination.

/** The surface handed to generated student code as `robot`, for a built robot. */
export interface BuiltRobotApi {
  /** Sets an actuator's control target immediately (no waiting for it to
   * arrive -- MuJoCo actuators are continuous control, unlike the Car's
   * discrete movements). Throws if `actuatorId` isn't one of the robot's
   * own actuator ids. */
  set(actuatorId: string, value: number): void;
  /** The named sensor's current reading (see EngineBuiltRobot.SensorReading
   * for each type's fixed width). Throws if `sensorId` isn't one of the
   * robot's own sensor ids. */
  read(sensorId: string): number[];
  /** Advances simulated time by `seconds` before the program continues. */
  wait(seconds: number): Promise<void>;
  /** Zeroes every actuator. */
  stop(): void;
  _checkpoint(): Promise<void>;
}

interface Wait {
  remaining: number;
  resolve: () => void;
  reject: (error: Error) => void;
}

export class BuiltProgramRunner {
  readonly api: BuiltRobotApi;
  private readonly actuatorIndexById = new Map<string, number>();
  private wait: Wait | null = null;
  private aborted = false;

  constructor(
    private readonly builtRobot: EngineBuiltRobot,
    robot: RobotDef,
  ) {
    robot.actuators.forEach((actuator, index) => this.actuatorIndexById.set(actuator.id, index));

    this.api = {
      set: (actuatorId, value) => {
        const index = this.actuatorIndexById.get(actuatorId);
        if (index === undefined) throw new Error(`unknown actuator: ${actuatorId}`);
        this.builtRobot.setActuatorCtrl(index, value);
      },
      read: (sensorId) => {
        const reading = this.builtRobot.sensorReadings().find((r) => r.id === sensorId);
        if (!reading) throw new Error(`unknown sensor: ${sensorId}`);
        return reading.values;
      },
      wait: (seconds) => this.startWait(Math.max(0, seconds)),
      stop: () => this.zeroActuators(),
      _checkpoint: async () => {
        if (this.aborted) throw new ProgramStoppedError();
        // Yield a macrotask so `while (true)` loops never freeze the UI.
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (this.aborted) throw new ProgramStoppedError();
      },
    };
  }

  /** Steps physics and advances any pending wait. Called once per animation
   * frame from TestViewport, replacing its own direct builtRobot.step(dt). */
  tick(dt: number): void {
    this.builtRobot.step(dt);
    const w = this.wait;
    if (w) {
      w.remaining -= dt;
      if (w.remaining <= 0) {
        this.wait = null;
        w.resolve();
      }
    }
  }

  get busy(): boolean {
    return this.wait !== null;
  }

  /** Allow a new program to run after a previous abort. */
  arm(): void {
    this.aborted = false;
  }

  /** Interrupt the program: a pending wait rejects, every actuator zeroes. */
  abort(): void {
    this.aborted = true;
    const w = this.wait;
    this.wait = null;
    this.zeroActuators();
    w?.reject(new ProgramStoppedError());
  }

  private zeroActuators(): void {
    for (let i = 0; i < this.builtRobot.actuatorCount(); i++) this.builtRobot.setActuatorCtrl(i, 0);
  }

  private startWait(seconds: number): Promise<void> {
    if (this.aborted) return Promise.reject(new ProgramStoppedError());
    if (this.wait) return Promise.reject(new Error("already waiting"));
    if (seconds <= 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
      this.wait = { remaining: seconds, resolve, reject };
    });
  }
}
