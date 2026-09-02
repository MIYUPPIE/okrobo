// Runtime validation of world files against contracts/world/v0/schema.json.
// World files arrive from packs (later: downloaded ones), so they are data
// to be checked, not trusted.

export interface ObstacleDef {
  x: number;
  y: number;
  width: number;
  height: number;
  /** rgb 0-255; what the camera sees and vision lessons look for. */
  color: [number, number, number];
  label?: string;
}

export interface WorldDef {
  name: string;
  description?: string;
  arena_width: number;
  arena_height: number;
  robot_radius: number;
  wheel_base: number;
  start: { x: number; y: number; theta: number };
  /** contracts/world/v1; a v0 world simply has none. */
  obstacles: ObstacleDef[];
}

const MAX_OBSTACLES = 16;

function validateObstacles(value: unknown, worldName: string): ObstacleDef[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`world '${worldName}': obstacles must be an array`);
  if (value.length > MAX_OBSTACLES) {
    throw new Error(`world '${worldName}': at most ${MAX_OBSTACLES} obstacles`);
  }
  return value.map((raw, index) => {
    const o = raw as Record<string, unknown>;
    if (typeof o !== "object" || o === null || !isFiniteNumber(o.x) || !isFiniteNumber(o.y)) {
      throw new Error(`world '${worldName}': obstacle ${index} needs numeric x and y`);
    }
    const size = (key: "width" | "height") => {
      const v = o[key];
      if (v === undefined) return 0.2;
      if (!isFiniteNumber(v) || v <= 0) {
        throw new Error(`world '${worldName}': obstacle ${index} ${key} must be positive`);
      }
      return v;
    };
    let color: [number, number, number] = [200, 60, 60];
    if (o.color !== undefined) {
      const raw = o.color;
      if (
        !Array.isArray(raw) ||
        raw.length !== 3 ||
        raw.some((c) => !isFiniteNumber(c) || c < 0 || c > 255)
      ) {
        throw new Error(`world '${worldName}': obstacle ${index} color must be three 0-255 values`);
      }
      color = [raw[0], raw[1], raw[2]] as [number, number, number];
    }
    return {
      x: o.x,
      y: o.y,
      width: size("width"),
      height: size("height"),
      color,
      label: typeof o.label === "string" ? o.label : undefined,
    };
  });
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

  const world = { ...d, obstacles: validateObstacles(d.obstacles, d.name) } as unknown as WorldDef;
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
