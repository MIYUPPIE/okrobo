// TypeScript mirror of contracts/world-def/v0. Change only together with
// the contract (version bump) and the other mirrors
// (runtime/python/okrobo/world_def.py, engine/src/world_def.{hpp,cpp}).
//
// Reuses ./robotDef's own Transform/Geometry/Material types and
// parse/serialize helpers directly -- a position/rotation, a primitive
// shape, and a color are the same concepts for a world object as for a
// robot body, not independently invented ones. See
// docs/decisions/robot-builder-world.md.
//
// Unlike RobotDef, a WorldDef has no kinematic tree: every object is
// independently placed and static (no joints, no actuators, no sensors, no
// mass). parseWorldDef throws on malformed shape; validateWorldDef never
// throws -- always returns a (possibly empty) list of Issue.

import { geometryToJson, parseGeometry, parseTransform, transformToJson, type Geometry, type Material, type Transform } from "./robotDef";

export interface WorldObject {
  id: string;
  name: string;
  transform: Transform;
  geometry: Geometry;
  material?: Material;
}

export interface WorldDef {
  id: string;
  name: string;
  description: string;
  objects: WorldObject[];
}

export interface Issue {
  rule: string;
  severity: "error" | "warning";
  element_kind?: "object" | "world";
  element_id?: string;
  message: string;
}

// ---- parsing ----

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) throw new Error("world-def: expected an object");
  return value as Record<string, unknown>;
}

function parseMaterial(value: unknown): Material | undefined {
  if (value === undefined) return undefined;
  const m = asRecord(value);
  return Array.isArray(m.color) ? { color: m.color.map(Number) } : {};
}

function parseWorldObject(value: unknown): WorldObject {
  const o = asRecord(value);
  if (typeof o.id !== "string" || typeof o.name !== "string") throw new Error("world-def: object needs id and name");
  const geometry = parseGeometry(o.geometry);
  if (geometry === undefined) throw new Error(`world-def: object '${o.id}' needs geometry`);
  return {
    id: o.id,
    name: o.name,
    transform: parseTransform(o.transform),
    geometry,
    material: parseMaterial(o.material),
  };
}

export function parseWorldDef(data: unknown): WorldDef {
  const d = asRecord(data);
  if (typeof d.id !== "string" || typeof d.name !== "string") throw new Error("world-def: missing id or name");
  if (!Array.isArray(d.objects)) throw new Error(`world-def '${d.id}': missing objects`);
  return {
    id: d.id,
    name: d.name,
    description: typeof d.description === "string" ? d.description : "",
    objects: d.objects.map(parseWorldObject),
  };
}

// ---- serialization (round-trip) ----

function objectToJson(o: WorldObject): unknown {
  const out: Record<string, unknown> = { id: o.id, name: o.name, transform: transformToJson(o.transform), geometry: geometryToJson(o.geometry) };
  if (o.material?.color !== undefined) out.material = { color: o.material.color };
  return out;
}

export function worldDefToJson(world: WorldDef): unknown {
  return {
    id: world.id,
    name: world.name,
    description: world.description,
    objects: world.objects.map(objectToJson),
  };
}

// ---- validation ----

function geometryIsValid(g: Geometry): boolean {
  switch (g.type) {
    case "box":
      return g.size.every((v) => v > 0);
    case "plane":
      return g.size.every((v) => v > 0);
    case "sphere":
      return g.radius > 0;
    case "cylinder":
    case "capsule":
    case "cone":
      return g.radius > 0 && g.length > 0;
    case "mesh":
      return g.path.length > 0;
    case "cad_mesh":
      return (
        g.vertices.length > 0 &&
        g.vertices.length % 3 === 0 &&
        g.faces.length > 0 &&
        g.faces.length % 3 === 0 &&
        g.faces.every((index) => index < g.vertices.length / 3)
      );
  }
}

export function validateWorldDef(world: WorldDef): Issue[] {
  const issues: Issue[] = [];
  const seenIds = new Set<string>();

  for (const object of world.objects) {
    if (seenIds.has(object.id)) {
      issues.push({ rule: "object-duplicate-id", severity: "error", element_kind: "object", element_id: object.id, message: `Duplicate object id '${object.id}'` });
    } else {
      seenIds.add(object.id);
    }

    if (!geometryIsValid(object.geometry)) {
      issues.push({
        rule: "object-invalid-geometry",
        severity: "error",
        element_kind: "object",
        element_id: object.id,
        message: `Object '${object.id}': geometry size must be positive`,
      });
    }
  }

  return issues;
}
