// Data-driven RobotDef -> three.js scene builder. One function maps any
// valid RobotDef to a scene graph -- no per-robot-kind special-casing (that
// hardcoded style lives only in Viewport3D.tsx, for the fixed Car/Arm/Drone
// simulation path, and stays there untouched). Only three.js's math/
// Object3D/geometry classes are used here, never WebGLRenderer, so this is
// unit-testable in plain Node without a canvas.

import * as THREE from "three";
import type { Body, Geometry, RobotDef, Transform } from "../contracts/robotDef";
import { buildKinematicTree } from "./robotTree";

const DEFAULT_COLOR: readonly [number, number, number] = [0.6, 0.6, 0.6];
// Stand-in for `mesh` geometry (file loading is out of scope this slice)
// and for a body with no visual geometry at all -- still visible/selectable.
const PLACEHOLDER_SIZE = 0.06;

export function geometryFor(geometry: Geometry | undefined): THREE.BufferGeometry {
  if (geometry === undefined) return new THREE.BoxGeometry(PLACEHOLDER_SIZE, PLACEHOLDER_SIZE, PLACEHOLDER_SIZE);
  switch (geometry.type) {
    case "box":
      return new THREE.BoxGeometry(geometry.size[0], geometry.size[1], geometry.size[2]);
    case "sphere":
      return new THREE.SphereGeometry(geometry.radius, 24, 16);
    case "cylinder":
      return new THREE.CylinderGeometry(geometry.radius, geometry.radius, geometry.length, 24);
    case "capsule":
      return new THREE.CapsuleGeometry(geometry.radius, geometry.length, 4, 12);
    case "cone":
      return new THREE.ConeGeometry(geometry.radius, geometry.length, 24);
    case "plane":
      return new THREE.PlaneGeometry(geometry.size[0], geometry.size[1]);
    case "mesh":
      return new THREE.BoxGeometry(PLACEHOLDER_SIZE, PLACEHOLDER_SIZE, PLACEHOLDER_SIZE);
    case "cad_mesh": {
      // Real geometry, not a placeholder -- baked CAD-kernel output (see
      // docs/decisions/cad-kernel-foundation.md). No CAD kernel involved
      // here at all: just raw vertex/index data, the same cost as any other
      // three.js mesh. computeVertexNormals() since the schema doesn't
      // carry per-vertex normals (MuJoCo computes its own separately).
      const bufferGeometry = new THREE.BufferGeometry();
      bufferGeometry.setAttribute("position", new THREE.Float32BufferAttribute(geometry.vertices, 3));
      bufferGeometry.setIndex(geometry.faces);
      bufferGeometry.computeVertexNormals();
      return bufferGeometry;
    }
  }
}

/** Sets an Object3D's local position/rotation from a robot-def Transform.
 * Rotation is intrinsic XYZ Euler radians, matching the contract's own
 * convention (contracts/robot-def/v0/schema.json). */
export function applyTransform(object: THREE.Object3D, transform: Transform): void {
  object.position.set(transform.position[0], transform.position[1], transform.position[2]);
  object.rotation.set(transform.rotation_rpy[0], transform.rotation_rpy[1], transform.rotation_rpy[2], "XYZ");
}

function colorFor(body: Body): THREE.Color {
  const [r, g, b] = body.material?.color ?? DEFAULT_COLOR;
  return new THREE.Color(r, g, b);
}

function meshFor(body: Body): THREE.Mesh {
  const mesh = new THREE.Mesh(geometryFor(body.visual), new THREE.MeshStandardMaterial({ color: colorFor(body) }));
  mesh.name = `mesh:${body.id}`;
  return mesh;
}

export interface MaterializedScene {
  root: THREE.Group;
  bodyGroupById: Map<string, THREE.Group>;
}

/**
 * Maps an arbitrary RobotDef to a three.js scene graph: one Group per body
 * (holding its mesh, `userData.bodyId` set for hit-testing), nested as
 * `jointOriginGroup > bodyGroup` following the kinematic tree
 * (buildKinematicTree) -- the joint's own origin composes with the child
 * body's own transform as two separate, nested translations/rotations.
 *
 * Every body renders, including ones buildKinematicTree calls unreachable:
 * a mid-edit document with no joints yet (every body a disconnected root)
 * is the normal starting state, not an error, so nothing should vanish from
 * the view because of it -- unreachable bodies are parented directly under
 * `root` at their own transform, same as an ordinary root body.
 */
export function materializeRobotScene(robot: RobotDef): MaterializedScene {
  const tree = buildKinematicTree(robot);
  const bodyById = new Map(robot.bodies.map((b) => [b.id, b] as const));
  const bodyGroupById = new Map<string, THREE.Group>();

  const root = new THREE.Group();
  root.name = "robot-root";
  applyTransform(root, robot.root_placement);

  function attach(bodyId: string, parentObject: THREE.Object3D): void {
    // Already attached -- breaks cycles in childrenOf (a pure a<->b joint
    // cycle with no external root has no natural place to stop otherwise;
    // validateRobotDef already flags this as robot-cycle, but the renderer
    // still needs to terminate rather than recurse forever).
    if (bodyGroupById.has(bodyId)) return;
    const body = bodyById.get(bodyId);
    if (!body) return;

    const bodyGroup = new THREE.Group();
    bodyGroup.name = `body:${body.id}`;
    bodyGroup.userData.bodyId = body.id;
    bodyGroup.add(meshFor(body));
    applyTransform(bodyGroup, body.transform);
    bodyGroupById.set(body.id, bodyGroup);

    const joint = tree.parentJointOf.get(bodyId);
    if (joint) {
      const originGroup = new THREE.Group();
      originGroup.name = `joint-origin:${joint.id}`;
      applyTransform(originGroup, joint.origin);
      originGroup.add(bodyGroup);
      parentObject.add(originGroup);
    } else {
      parentObject.add(bodyGroup);
    }

    for (const childId of tree.childrenOf.get(bodyId) ?? []) attach(childId, bodyGroup);
  }

  for (const id of tree.rootIds) attach(id, root);
  for (const id of tree.unreachableIds) attach(id, root);

  return { root, bodyGroupById };
}

/** Walks an Object3D's parent chain for `userData.bodyId` (set on each
 * body's own Group by materializeRobotScene) -- resolves a raycaster hit,
 * which lands on the Mesh (a child of the body Group), back to a body id. */
export function resolveBodyId(object: THREE.Object3D | null): string | null {
  let current: THREE.Object3D | null = object;
  while (current) {
    const bodyId: unknown = current.userData.bodyId;
    if (typeof bodyId === "string") return bodyId;
    current = current.parent;
  }
  return null;
}

const HIGHLIGHT_EMISSIVE = new THREE.Color(0x2a6fb0);
const NO_EMISSIVE = new THREE.Color(0x000000);

export function setHighlighted(group: THREE.Group, highlighted: boolean): void {
  for (const child of group.children) {
    if (!(child instanceof THREE.Mesh)) continue;
    const material = child.material as THREE.MeshStandardMaterial;
    material.emissive = highlighted ? HIGHLIGHT_EMISSIVE : NO_EMISSIVE;
  }
}
