// Data-driven WorldDef -> three.js scene builder (Robot Builder Phase 5).
// Unlike robotThree.ts's materializeRobotScene, a world has no kinematic
// tree to walk -- every object is independently placed, so this is a flat
// map over world.objects. Reuses robotThree.ts's own geometryFor/
// applyTransform verbatim: a primitive shape and a position/rotation are
// the same concepts for a world object as for a robot body. See
// docs/decisions/robot-builder-world.md.

import * as THREE from "three";
import type { Material } from "../contracts/robotDef";
import type { WorldDef, WorldObject } from "../contracts/worldDef";
import { applyTransform, geometryFor } from "./robotThree";

const DEFAULT_COLOR: readonly [number, number, number] = [0.55, 0.55, 0.6];

function colorFor(material: Material | undefined): THREE.Color {
  const [r, g, b] = material?.color ?? DEFAULT_COLOR;
  return new THREE.Color(r, g, b);
}

function meshFor(object: WorldObject): THREE.Mesh {
  const mesh = new THREE.Mesh(geometryFor(object.geometry), new THREE.MeshStandardMaterial({ color: colorFor(object.material) }));
  mesh.name = `world-object:${object.id}`;
  return mesh;
}

/**
 * Maps a WorldDef to a three.js scene graph: one Mesh per object, directly
 * under a single root Group at its own transform -- no nesting, since world
 * objects are static and independent (no joints, no tree). Callers
 * (TestViewport.tsx) materialize this once and add it straight to the
 * scene: unlike a robot's bodies, nothing here ever moves, so there is no
 * per-frame pose sync to do.
 */
export function materializeWorldScene(world: WorldDef): THREE.Group {
  const root = new THREE.Group();
  root.name = "world-root";

  for (const object of world.objects) {
    const mesh = meshFor(object);
    applyTransform(mesh, object.transform);
    root.add(mesh);
  }

  return root;
}
