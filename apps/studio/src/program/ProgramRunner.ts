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
  heading(): number;
  _checkpoint(): Promise<void>;
}

export class ProgramRunner {
  readonly api: RobotApi;
  private movement: Movement | null = null;
  private aborted = false;

  constructor(
    private readonly engine: EngineWorld,
    private readonly wheelBase: number,
    private readonly dt = 0.01,
  ) {
    this.api = {
      forward: (meters = 0.1) => this.move(PROGRAM_SPEED, PROGRAM_SPEED, Math.abs(meters) / PROGRAM_SPEED),
      backward: (meters = 0.1) => this.move(-PROGRAM_SPEED, -PROGRAM_SPEED, Math.abs(meters) / PROGRAM_SPEED),
      turnLeft: (degrees = 90) => this.turn(degrees),
      turnRight: (degrees = 90) => this.turn(-degrees),
      wait: (seconds: number) => this.move(0, 0, Math.max(0, seconds)),
      distance: () => this.engine.state().sensors.distance,
      heading: () => (this.engine.state().pose.theta * 180) / Math.PI,
      _checkpoint: async () => {
        if (this.aborted) throw new ProgramStoppedError();
        // Yield a macrotask so `while (true)` loops never freeze the UI.
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (this.aborted) throw new ProgramStoppedError();
      },
    };
  }

  /** Step the world. Called from the render loop with this frame's budget. */
  tick(steps: number): void {
    for (let i = 0; i < steps; i++) {
      this.engine.step(this.dt);
      const m = this.movement;
      if (!m) continue;
      m.stepsLeft -= 1;
      const collided = this.engine.state().collided;
      if (m.stepsLeft <= 0 || collided) {
        if (!collided && m.remainder > 1e-12) this.engine.step(m.remainder);
        this.finishMovement();
        m.resolve();
      }
    }
  }

  get busy(): boolean {
    return this.movement !== null;
  }

  /** Allow a new program to run after a previous abort. */
  arm(): void {
    this.aborted = false;
  }

  /** Interrupt the program: the active movement rejects, wheels stop. */
  abort(): void {
    this.aborted = true;
    const m = this.movement;
    this.finishMovement();
    m?.reject(new ProgramStoppedError());
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
