import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { WorldDef } from "../contracts/worldDef";
import { materializeWorldScene } from "./worldThree";

const identity = { position: [0, 0, 0] as [number, number, number], rotation_rpy: [0, 0, 0] as [number, number, number] };

describe("materializeWorldScene", () => {
  it("adds one mesh per object, flat under the root (no nesting -- objects are static and independent)", () => {
    const world: WorldDef = {
      id: "w",
      name: "W",
      description: "",
      objects: [
        { id: "a", name: "A", transform: identity, geometry: { type: "box", size: [1, 1, 1] } },
        { id: "b", name: "B", transform: identity, geometry: { type: "sphere", radius: 0.5 } },
      ],
    };
    const root = materializeWorldScene(world);
    expect(root.children.length).toBe(2);
    expect(root.children.every((child) => child instanceof THREE.Mesh)).toBe(true);
  });

  it("maps each object's geometry type to the matching three.js geometry class", () => {
    const world: WorldDef = {
      id: "w",
      name: "W",
      description: "",
      objects: [
        { id: "box", name: "Box", transform: identity, geometry: { type: "box", size: [1, 1, 1] } },
        { id: "cyl", name: "Cyl", transform: identity, geometry: { type: "cylinder", radius: 0.2, length: 1 } },
      ],
    };
    const [boxMesh, cylMesh] = materializeWorldScene(world).children as THREE.Mesh[];
    expect(boxMesh.geometry).toBeInstanceOf(THREE.BoxGeometry);
    expect(cylMesh.geometry).toBeInstanceOf(THREE.CylinderGeometry);
  });

  it("applies each object's own transform to its mesh", () => {
    const world: WorldDef = {
      id: "w",
      name: "W",
      description: "",
      objects: [{ id: "a", name: "A", transform: { position: [1, 2, 3], rotation_rpy: [0, Math.PI / 2, 0] }, geometry: { type: "box", size: [1, 1, 1] } }],
    };
    const [mesh] = materializeWorldScene(world).children as THREE.Mesh[];
    expect(mesh.position.toArray()).toEqual([1, 2, 3]);
    expect(mesh.rotation.y).toBeCloseTo(Math.PI / 2);
  });

  it("colors from object.material.color, defaulting to a neutral gray", () => {
    const world: WorldDef = {
      id: "w",
      name: "W",
      description: "",
      objects: [
        { id: "a", name: "A", transform: identity, geometry: { type: "box", size: [1, 1, 1] }, material: { color: [0, 1, 0] } },
        { id: "b", name: "B", transform: identity, geometry: { type: "box", size: [1, 1, 1] } },
      ],
    };
    const [meshA, meshB] = materializeWorldScene(world).children as THREE.Mesh[];
    const colorA = (meshA.material as THREE.MeshStandardMaterial).color;
    const colorB = (meshB.material as THREE.MeshStandardMaterial).color;
    expect([colorA.r, colorA.g, colorA.b]).toEqual([0, 1, 0]);
    expect([colorB.r, colorB.g, colorB.b].map((v) => Number(v.toFixed(2)))).toEqual([0.55, 0.55, 0.6]);
  });

  it("produces an empty root for a world with no objects", () => {
    const world: WorldDef = { id: "w", name: "W", description: "", objects: [] };
    expect(materializeWorldScene(world).children.length).toBe(0);
  });
});
