// Runtime validation of world files against contracts/world/v0/schema.json.
// World files arrive from packs (later: downloaded ones), so they are data
// to be checked, not trusted.

export interface WorldDef {
  name: string;
  description?: string;
  arena_width: number;
  arena_height: number;
  robot_radius: number;
  wheel_base: number;
  start: { x: number; y: number; theta: number };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function validateWorld(data: unknown): WorldDef {
  if (typeof data !== "object" || data === null) {
    throw new Error("world: not an object");
  }
  const d = data as Record<string, unknown>;

  if (typeof d.name !== "string" || d.name.length === 0) {
    throw new Error("world: missing name");
  }
  for (const key of ["arena_width", "arena_height", "robot_radius", "wheel_base"] as const) {
    if (!isFiniteNumber(d[key]) || (d[key] as number) <= 0) {
      throw new Error(`world '${d.name}': ${key} must be a positive number`);
    }
  }
  const start = d.start as Record<string, unknown> | undefined;
  if (
    typeof start !== "object" ||
    start === null ||
    !isFiniteNumber(start.x) ||
    !isFiniteNumber(start.y) ||
    !isFiniteNumber(start.theta)
  ) {
    throw new Error(`world '${d.name}': start must be {x, y, theta} numbers`);
  }

  const world = d as unknown as WorldDef;
  if (2 * world.robot_radius >= Math.min(world.arena_width, world.arena_height)) {
    throw new Error(`world '${world.name}': robot does not fit in the arena`);
  }
  const r = world.robot_radius;
  if (
    world.start.x < r ||
    world.start.x > world.arena_width - r ||
    world.start.y < r ||
    world.start.y > world.arena_height - r
  ) {
    throw new Error(`world '${world.name}': start pose is outside the arena`);
  }
  return world;
}
