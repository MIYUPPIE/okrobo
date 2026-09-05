import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { RobotDef } from "../contracts/robotDef";
import { applyTransform, geometryFor, materializeRobotScene, resolveBodyId, setHighlighted } from "./robotThree";

const identity = { position: [0, 0, 0] as [number, number, number], rotation_rpy: [0, 0, 0] as [number, number, number] };
const inertia = { ixx: 0.01, iyy: 0.01, izz: 0.01 };

describe("geometryFor", () => {
  it("maps box to BoxGeometry with the right dimensions", () => {
    const geom = geometryFor({ type: "box", size: [0.2, 0.3, 0.4] });
    expect(geom).toBeInstanceOf(THREE.BoxGeometry);
    expect((geom as THREE.BoxGeometry).parameters).toMatchObject({ width: 0.2, height: 0.3, depth: 0.4 });
  });

  it("maps sphere/cylinder/capsule/cone/plane to the matching class", () => {
    expect(geometryFor({ type: "sphere", radius: 0.1 })).toBeInstanceOf(THREE.SphereGeometry);
    expect(geometryFor({ type: "cylinder", radius: 0.1, length: 0.2 })).toBeInstanceOf(THREE.CylinderGeometry);
    expect(geometryFor({ type: "capsule", radius: 0.1, length: 0.2 })).toBeInstanceOf(THREE.CapsuleGeometry);
    expect(geometryFor({ type: "cone", radius: 0.1, length: 0.2 })).toBeInstanceOf(THREE.ConeGeometry);
    expect(geometryFor({ type: "plane", size: [1, 2] })).toBeInstanceOf(THREE.PlaneGeometry);
  });

  it("falls back to a placeholder box for mesh geometry and for no geometry", () => {
    expect(geometryFor({ type: "mesh", path: "foo.glb", scale: [1, 1, 1] })).toBeInstanceOf(THREE.BoxGeometry);
    expect(geometryFor(undefined)).toBeInstanceOf(THREE.BoxGeometry);
  });

  // CAD Kernel Phase 1: real geometry, not a placeholder -- see
  // docs/decisions/cad-kernel-foundation.md.
  it("builds a real BufferGeometry from cad_mesh's baked vertex/face data", () => {
    const vertices = [0, 0, 0, 0.1, 0, 0, 0, 0.1, 0, 0, 0, 0.1]; // a tetrahedron
    const faces = [0, 1, 2, 0, 1, 3, 0, 2, 3, 1, 2, 3];
    const geom = geometryFor({ type: "cad_mesh", vertices, faces });
    expect(geom).toBeInstanceOf(THREE.BufferGeometry);
    expect(geom).not.toBeInstanceOf(THREE.BoxGeometry); // not the mesh-type placeholder
    expect(geom.getAttribute("position").count).toBe(4); // 4 vertices
    expect(geom.getIndex()?.count).toBe(12); // 4 faces * 3 indices
    expect(geom.getAttribute("normal")).toBeDefined(); // computeVertexNormals() ran
  });
});

describe("applyTransform", () => {
  it("sets position and rotation from a robot-def Transform", () => {
    const object = new THREE.Object3D();
    applyTransform(object, { position: [1, 2, 3], rotation_rpy: [0, Math.PI / 2, 0] });
    expect(object.position.toArray()).toEqual([1, 2, 3]);
    expect(object.rotation.x).toBeCloseTo(0);
    expect(object.rotation.y).toBeCloseTo(Math.PI / 2);
    expect(object.rotation.z).toBeCloseTo(0);
  });
});

describe("materializeRobotScene", () => {
  it("composes a joint's origin with the child body's own transform as two nested translations", () => {
    const robot: RobotDef = {
      id: "t",
      name: "t",
      description: "",
      root_placement: identity,
      bodies: [
        { id: "a", name: "A", transform: identity, mass: 1, inertia },
        { id: "b", name: "B", transform: { position: [0, 1, 0], rotation_rpy: [0, 0, 0] }, mass: 1, inertia },
      ],
      joints: [{ id: "j", name: "J", type: "fixed", parent: "a", child: "b", origin: { position: [0, 0, 1], rotation_rpy: [0, 0, 0] } }],
      actuators: [],
      sensors: [],
    };

    const { root, bodyGroupById } = materializeRobotScene(robot);
    root.updateMatrixWorld(true);

    const aWorld = new THREE.Vector3();
    bodyGroupById.get("a")!.getWorldPosition(aWorld);
    expect(aWorld.toArray()).toEqual([0, 0, 0]);

    const bWorld = new THREE.Vector3();
    bodyGroupById.get("b")!.getWorldPosition(bWorld);
    // joint origin [0,0,1] then body b's own transform [0,1,0] -> [0,1,1]
    expect(bWorld.toArray()).toEqual([0, 1, 1]);
  });

  it("renders every body when there are no joints at all (all disconnected roots)", () => {
    const robot: RobotDef = {
      id: "t",
      name: "t",
      description: "",
      root_placement: identity,
      bodies: [
        { id: "a", name: "A", transform: identity, mass: 1, inertia },
        { id: "b", name: "B", transform: identity, mass: 1, inertia },
      ],
      joints: [],
      actuators: [],
      sensors: [],
    };
    const { root, bodyGroupById } = materializeRobotScene(robot);
    expect(bodyGroupById.size).toBe(2);
    expect(root.children.length).toBe(2);
  });

  it("renders an unreachable (cyclic) body rather than dropping it", () => {
    const robot: RobotDef = {
      id: "t",
      name: "t",
      description: "",
      root_placement: identity,
      bodies: [
        { id: "a", name: "A", transform: identity, mass: 1, inertia },
        { id: "b", name: "B", transform: identity, mass: 1, inertia },
      ],
      joints: [
        { id: "j1", name: "J1", type: "fixed", parent: "a", child: "b", origin: identity },
        { id: "j2", name: "J2", type: "fixed", parent: "b", child: "a", origin: identity },
      ],
      actuators: [],
      sensors: [],
    };
    const { bodyGroupById } = materializeRobotScene(robot);
    expect(bodyGroupById.size).toBe(2);
  });

  it("sets userData.bodyId on each body group for hit-testing", () => {
    const robot: RobotDef = {
      id: "t",
      name: "t",
      description: "",
      root_placement: identity,
      bodies: [{ id: "a", name: "A", transform: identity, mass: 1, inertia }],
      joints: [],
      actuators: [],
      sensors: [],
    };
    const { bodyGroupById } = materializeRobotScene(robot);
    expect(bodyGroupById.get("a")!.userData.bodyId).toBe("a");
  });

  it("colors the mesh from body.material.color (0-1 float range), defaulting to gray", () => {
    const robot: RobotDef = {
      id: "t",
      name: "t",
      description: "",
      root_placement: identity,
      bodies: [
        { id: "a", name: "A", transform: identity, mass: 1, inertia, material: { color: [1, 0, 0] } },
        { id: "b", name: "B", transform: identity, mass: 1, inertia },
      ],
      joints: [],
      actuators: [],
      sensors: [],
    };
    const { bodyGroupById } = materializeRobotScene(robot);
    const meshA = bodyGroupById.get("a")!.children[0] as THREE.Mesh;
    const meshB = bodyGroupById.get("b")!.children[0] as THREE.Mesh;
    const colorA = (meshA.material as THREE.MeshStandardMaterial).color;
    const colorB = (meshB.material as THREE.MeshStandardMaterial).color;
    expect([colorA.r, colorA.g, colorA.b]).toEqual([1, 0, 0]);
    expect([colorB.r, colorB.g, colorB.b].map((v) => Number(v.toFixed(2)))).toEqual([0.6, 0.6, 0.6]);
  });
});

describe("resolveBodyId", () => {
  it("walks up from a mesh (raycaster hit) to its body group's id", () => {
    const group = new THREE.Group();
    group.userData.bodyId = "chassis";
    const mesh = new THREE.Mesh(new THREE.BoxGeometry());
    group.add(mesh);
    expect(resolveBodyId(mesh)).toBe("chassis");
  });

  it("returns null when nothing in the chain has a bodyId", () => {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry());
    expect(resolveBodyId(floor)).toBeNull();
    expect(resolveBodyId(null)).toBeNull();
  });
});

describe("setHighlighted", () => {
  it("sets and clears emissive color on the group's own mesh only", () => {
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    group.add(mesh);
    group.add(new THREE.Group()); // e.g. a nested joint-origin group for a child body

    setHighlighted(group, true);
    expect((mesh.material as THREE.MeshStandardMaterial).emissive.getHex()).toBe(0x2a6fb0);

    setHighlighted(group, false);
    expect((mesh.material as THREE.MeshStandardMaterial).emissive.getHex()).toBe(0x000000);
  });
});
