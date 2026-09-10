// Competition Arena's own scoring engine -- evaluates a CompetitionDef's
// objectives against the robot's own already-exposed per-tick pose. Pure
// functions, no engine/DOM dependency, so this is unit-testable in plain
// Node (mirrors kernel.ts/executor.ts's own "pure logic, no WASM" posture
// where possible). See docs/decisions/competition-arena-definition-scoring.md
// for why avoid_obstacle_collision can't just read the engine's own
// `collided` flag (wall-boundary-only) and has to be computed here instead,
// from the robot's own pose plus the arena's own obstacle list -- both
// already exposed every tick with no new engine work.

import type { ObstacleDef } from "../lib/validateWorld";
import type { CompetitionDef, Objective } from "./competitionDef";

export interface ObjectiveOutcome {
  index: number;
  objective: Objective;
  points: number;
  achieved: boolean;
  /** Only meaningful for avoid_obstacle_collision -- how many separate hits so far. */
  hits: number;
  /** Only meaningful for a sequenced reach_zone (Competition Arena C4) --
   * true while at least one other reach_zone with a strictly lower
   * `sequence` hasn't been achieved yet. Always false for every other
   * objective, and for a reach_zone with no `sequence` at all (v0's own
   * always-reachable behavior, unchanged). Computed fresh every tick from
   * the PREVIOUS tick's outcomes -- see evaluateTick. */
  locked: boolean;
}

export type FinishReason = "time_up" | "stopped" | "program_ended";

export interface CompetitionRunState {
  elapsedSeconds: number;
  totalScore: number;
  outcomes: ObjectiveOutcome[];
  timeUp: boolean;
  finished: boolean;
  finishReason: FinishReason | null;
  /** Internal, one entry per obstacle in def.arena.obstacles, in the same
   * order -- an edge-triggered latch so a continuous overlap counts as one
   * hit, not one per tick. Not meant to be read by UI code (use `outcomes`
   * for the avoid_obstacle_collision objective's own aggregate `hits`
   * instead); exposed on the type only because evaluateTick returns a full
   * new state each tick and this needs to survive between calls. */
  collidingObstacles: boolean[];
}

/** Closest-point circle-vs-axis-aligned-box test: is a circle of radius `r`
 * centred at (cx, cy) overlapping `box` (whose own x,y is its own centre,
 * matching contracts/world/v1's own obstacle convention -- see
 * apps/studio/src/builder/worldThree.ts / WorldPanel.tsx for the same
 * centre-based placement already used elsewhere)? */
export function circleIntersectsAabb(cx: number, cy: number, r: number, box: ObstacleDef): boolean {
  const halfW = box.width / 2;
  const halfH = box.height / 2;
  const closestX = Math.max(box.x - halfW, Math.min(cx, box.x + halfW));
  const closestY = Math.max(box.y - halfH, Math.min(cy, box.y + halfH));
  const dx = cx - closestX;
  const dy = cy - closestY;
  return dx * dx + dy * dy <= r * r;
}

export function initRunState(def: CompetitionDef): CompetitionRunState {
  return {
    elapsedSeconds: 0,
    totalScore: 0,
    outcomes: def.objectives.map((objective, index) => ({ index, objective, points: 0, achieved: false, hits: 0, locked: false })),
    timeUp: false,
    finished: false,
    finishReason: null,
    collidingObstacles: def.arena.obstacles.map(() => false),
  };
}

/** One simulation tick's worth of scoring. Returns a new state (never
 * mutates `state`) so React-style state setters can use it directly. Once
 * `finished` is true, further calls are a no-op (returns `state` unchanged)
 * -- a finished run's own score never moves again. */
export function evaluateTick(
  def: CompetitionDef,
  state: CompetitionRunState,
  pose: { x: number; y: number; theta: number },
  dt: number,
): CompetitionRunState {
  if (state.finished) return state;

  const elapsedSeconds = state.elapsedSeconds + dt;
  const collidingObstacles = [...state.collidingObstacles];
  const outcomes = state.outcomes.map((outcome) => ({ ...outcome }));
  let timeUp = state.timeUp;

  for (const outcome of outcomes) {
    const objective = outcome.objective;
    if (objective.type === "reach_zone") {
      // Gated against the PREVIOUS tick's own outcomes (`state.outcomes`,
      // not the `outcomes` array being built this same tick) -- a zone
      // unlocking one tick (10ms) after its prerequisite is achieved is
      // imperceptible, and this sidesteps any dependency on the order
      // objectives happen to appear in the JSON. See
      // docs/decisions/competition-arena-definition-scoring.md.
      const locked =
        objective.sequence !== undefined &&
        state.outcomes.some(
          (other) =>
            other.objective.type === "reach_zone" &&
            other.objective.sequence !== undefined &&
            other.objective.sequence < objective.sequence! &&
            !other.achieved,
        );
      outcome.locked = locked;
      if (!outcome.achieved && !locked) {
        const dx = pose.x - objective.x;
        const dy = pose.y - objective.y;
        if (dx * dx + dy * dy <= objective.radius * objective.radius) {
          outcome.achieved = true;
          outcome.points = objective.points;
        }
      }
    } else if (objective.type === "avoid_obstacle_collision") {
      let hits = outcome.hits;
      def.arena.obstacles.forEach((box, obstacleIndex) => {
        const overlapping = circleIntersectsAabb(pose.x, pose.y, def.arena.robot_radius, box);
        if (overlapping && !collidingObstacles[obstacleIndex]) hits++;
        collidingObstacles[obstacleIndex] = overlapping;
      });
      outcome.hits = hits;
      outcome.points = -objective.penaltyPerHit * hits;
    } else if (objective.type === "time_limit") {
      if (!timeUp && elapsedSeconds >= objective.seconds) {
        timeUp = true;
        outcome.achieved = true;
      }
    }
  }

  const totalScore = outcomes.reduce((sum, outcome) => sum + outcome.points, 0);
  const finished = timeUp && !state.timeUp ? true : state.finished;

  return {
    elapsedSeconds,
    totalScore,
    outcomes,
    timeUp,
    finished,
    finishReason: finished && !state.finished ? "time_up" : state.finishReason,
    collidingObstacles,
  };
}

/** Marks a run finished for a reason other than its own time limit (Stop,
 * or the student's program returning on its own) -- a no-op if already
 * finished, so Stop after time-up doesn't overwrite "time_up" with
 * "stopped". */
export function finishRun(state: CompetitionRunState, reason: Exclude<FinishReason, "time_up">): CompetitionRunState {
  if (state.finished) return state;
  return { ...state, finished: true, finishReason: reason };
}
