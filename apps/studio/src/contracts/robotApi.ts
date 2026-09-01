// TypeScript mirror of contracts/robot-api/v0/schema.json.
// Change only together with the contract (version bump) and the other sides.

export type Command =
  | { type: "drive"; left: number; right: number }
  | { type: "stop" }
  | { type: "reset" };

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
