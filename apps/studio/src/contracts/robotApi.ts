// TypeScript mirror of contracts/robot-api/v1 (v0 car + arm + lidar).
// Change only together with the contract (version bump) and the other sides.

export type Command =
  | { type: "drive"; left: number; right: number }
  | { type: "stop" }
  | { type: "reset" };

export type ArmCommand =
  | { type: "arm_target"; joint: number; angle: number }
  | { type: "stop" }
  | { type: "reset" };

export interface ArmState {
  tick: number;
  joints: { angles: number[]; targets: number[] };
  moving: boolean;
  tip: { x: number; y: number; z: number };
}

export const ARM_JOINT_NAMES = ["base", "shoulder", "elbow", "wrist"] as const;

/** Mirrors engine ArmConfig; used by the viewport for drawing only. */
export const DEFAULT_ARM = {
  baseHeight: 0.12,
  link1: 0.22,
  link2: 0.18,
  link3: 0.1,
  start: [0, Math.PI / 3, -Math.PI / 6, -Math.PI / 6],
} as const;

export interface Pose {
  x: number;
  y: number;
  /** radians, (-pi, pi], 0 faces +x, CCW positive */
  theta: number;
}

export interface State {
  tick: number;
  pose: Pose;
  sensors: { distance: number };
  collided: boolean;
}

/** Default world, mirrors engine WorldConfig. Used by the viewport for drawing. */
export const DEFAULT_WORLD = {
  arenaWidth: 2.0,
  arenaHeight: 2.0,
  robotRadius: 0.1,
  wheelBase: 0.12,
  start: { x: 1.0, y: 1.0, theta: 0.0 } satisfies Pose,
} as const;
