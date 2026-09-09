// Runtime validation/serialization for contracts/competition/v0 -- see
// contract.md there for the model and the "why TypeScript-only" reasoning
// (no Python/C++ mirror: a competition's own arena/objectives are never seen
// by a student's program or the engine, only by this studio-side scoring
// layer). Reuses ../lib/validateWorld's own WorldDef/obstacle parsing for
// the embedded `arena` field directly, rather than a second, possibly-
// drifting copy of the same rules.

import { validateWorld, type WorldDef } from "../lib/validateWorld";

export type Objective =
  | { type: "reach_zone"; x: number; y: number; radius: number; points: number }
  | { type: "avoid_obstacle_collision"; penaltyPerHit: number }
  | { type: "time_limit"; seconds: number };

export interface CompetitionDef {
  id: string;
  name: string;
  description?: string;
  robot: "car";
  arena: WorldDef;
  objectives: Objective[];
}

export interface Issue {
  rule: string;
  severity: "error" | "warning";
  objective_index?: number;
  message: string;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

// Structural/type problems throw here (a malformed document, not a
// design-time issue for a student to fix) -- matches robotDef.ts's own
// parseGeometry/parseBossOperation precedent of throwing on an unknown
// discriminant. A numerically-present-but-semantically-invalid value (a
// zero/negative radius, a negative penalty) parses fine and is instead
// flagged by validateCompetitionDef below, mirroring robotDef.ts's own
// "body-invalid-mass" treatment (isFiniteNumber passes, positivity is a
// validate-time concern).
function parseObjective(value: unknown, index: number): Objective {
  if (typeof value !== "object" || value === null) {
    throw new Error(`competition: objective ${index} is not an object`);
  }
  const o = value as Record<string, unknown>;
  switch (o.type) {
    case "reach_zone": {
      if (!isFiniteNumber(o.x) || !isFiniteNumber(o.y)) {
        throw new Error(`competition: objective ${index} (reach_zone) needs numeric x and y`);
      }
      if (!isFiniteNumber(o.radius)) throw new Error(`competition: objective ${index} (reach_zone) needs a numeric radius`);
      if (!isFiniteNumber(o.points)) throw new Error(`competition: objective ${index} (reach_zone) needs numeric points`);
      return { type: "reach_zone", x: o.x, y: o.y, radius: o.radius, points: o.points };
    }
    case "avoid_obstacle_collision": {
      if (!isFiniteNumber(o.penalty_per_hit)) {
        throw new Error(`competition: objective ${index} (avoid_obstacle_collision) needs a numeric penalty_per_hit`);
      }
      return { type: "avoid_obstacle_collision", penaltyPerHit: o.penalty_per_hit };
    }
    case "time_limit": {
      if (!isFiniteNumber(o.seconds)) throw new Error(`competition: objective ${index} (time_limit) needs numeric seconds`);
      return { type: "time_limit", seconds: o.seconds };
    }
    default:
      throw new Error(`competition: objective ${index} has unknown type ${String(o.type)}`);
  }
}

export function parseCompetitionDef(data: unknown): CompetitionDef {
  if (typeof data !== "object" || data === null) throw new Error("competition: not an object");
  const d = data as Record<string, unknown>;

  if (typeof d.id !== "string" || d.id.length === 0) throw new Error("competition: missing id");
  if (typeof d.name !== "string" || d.name.length === 0) throw new Error(`competition '${d.id}': missing name`);
  if (d.robot !== "car") throw new Error(`competition '${d.id}': robot must be "car"`);
  if (typeof d.arena !== "object" || d.arena === null) throw new Error(`competition '${d.id}': missing arena`);
  // validateWorld throws its own descriptive errors for structural arena
  // problems (missing fields, too many obstacles, robot doesn't fit, etc.)
  // -- reused as-is rather than re-implemented.
  const arena = validateWorld(d.arena);
  if (!Array.isArray(d.objectives) || d.objectives.length === 0) {
    throw new Error(`competition '${d.id}': needs at least one objective`);
  }

  return {
    id: d.id,
    name: d.name,
    description: typeof d.description === "string" ? d.description : undefined,
    robot: "car",
    arena,
    objectives: d.objectives.map(parseObjective),
  };
}

/** Never throws -- always returns a (possibly empty) list of issues, same
 * convention as robotDef.ts's own validateRobotDef, so a future UI can show
 * every problem on a competition at once. */
export function validateCompetitionDef(def: CompetitionDef): Issue[] {
  const issues: Issue[] = [];
  let timeLimitCount = 0;

  def.objectives.forEach((objective, index) => {
    if (objective.type === "reach_zone") {
      if (objective.radius <= 0) {
        issues.push({ rule: "objective-reach-zone-invalid-radius", severity: "error", objective_index: index, message: `Objective ${index} (reach_zone): radius must be > 0` });
      }
      if (objective.points <= 0) {
        issues.push({ rule: "objective-reach-zone-invalid-points", severity: "error", objective_index: index, message: `Objective ${index} (reach_zone): points must be > 0` });
      }
    } else if (objective.type === "avoid_obstacle_collision") {
      if (objective.penaltyPerHit < 0) {
        issues.push({ rule: "objective-avoid-obstacle-negative-penalty", severity: "error", objective_index: index, message: `Objective ${index} (avoid_obstacle_collision): penalty_per_hit must be >= 0` });
      }
    } else if (objective.type === "time_limit") {
      timeLimitCount++;
      if (objective.seconds <= 0) {
        issues.push({ rule: "objective-time-limit-invalid-seconds", severity: "error", objective_index: index, message: `Objective ${index} (time_limit): seconds must be > 0` });
      }
    }
  });

  if (timeLimitCount > 1) {
    issues.push({ rule: "objective-duplicate-time-limit", severity: "error", message: "At most one time_limit objective is allowed" });
  }

  return issues;
}

function objectiveToJson(o: Objective): unknown {
  switch (o.type) {
    case "reach_zone":
      return { type: "reach_zone", x: o.x, y: o.y, radius: o.radius, points: o.points };
    case "avoid_obstacle_collision":
      return { type: "avoid_obstacle_collision", penalty_per_hit: o.penaltyPerHit };
    case "time_limit":
      return { type: "time_limit", seconds: o.seconds };
  }
}

export function competitionDefToJson(def: CompetitionDef): unknown {
  const out: Record<string, unknown> = {
    id: def.id,
    name: def.name,
    robot: def.robot,
    // WorldDef is already a plain, JSON-shaped object (same convention
    // RobotDef's own fields already follow) -- no separate serializer needed.
    arena: def.arena,
    objectives: def.objectives.map(objectiveToJson),
  };
  if (def.description !== undefined) out.description = def.description;
  return out;
}
