import { describe, expect, it } from "vitest";
import { geometryToMesh } from "./geometryToMesh";

function checkFacesReferenceRealVertices(mesh: { vertices: number[]; faces: number[] }) {
  expect(mesh.vertices.length % 3).toBe(0);
  expect(mesh.faces.length % 3).toBe(0);
  expect(mesh.faces.length).toBeGreaterThan(0);
  const vertexCount = mesh.vertices.length / 3;
  for (const index of mesh.faces) {
    expect(Number.isInteger(index)).toBe(true);
    expect(index).toBeGreaterThanOrEqual(0);
    expect(index).toBeLessThan(vertexCount);
  }
}

describe("geometryToMesh", () => {
  it("converts a box into a real flat triangle mesh matching its own dimensions", () => {
    const mesh = geometryToMesh({ type: "box", size: [0.2, 0.1, 0.05] });
    checkFacesReferenceRealVertices(mesh);

    const xs = [];
    for (let i = 0; i < mesh.vertices.length; i += 3) xs.push(mesh.vertices[i]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(0.2, 5);
  });

  it("converts a sphere into a real flat triangle mesh", () => {
    const mesh = geometryToMesh({ type: "sphere", radius: 0.05 });
    checkFacesReferenceRealVertices(mesh);
  });

  it("converts a cylinder into a real flat triangle mesh", () => {
    const mesh = geometryToMesh({ type: "cylinder", radius: 0.03, length: 0.1 });
    checkFacesReferenceRealVertices(mesh);
  });

  it("passes an existing cad_mesh body's geometry through (modulo float32 precision, same as the viewport's own render path)", () => {
    const vertices = [0, 0, 0, 0.1, 0, 0, 0, 0.1, 0, 0, 0, 0.1];
    const faces = [0, 1, 2, 0, 1, 3, 0, 2, 3, 1, 2, 3];
    const mesh = geometryToMesh({ type: "cad_mesh", vertices, faces });
    // geometryFor stores vertices in a Float32BufferAttribute (same as the
    // real viewport render), so a round-trip loses float64->float32
    // precision -- exact equality would be the wrong assertion here.
    expect(mesh.vertices).toHaveLength(vertices.length);
    for (let i = 0; i < vertices.length; i++) expect(mesh.vertices[i]).toBeCloseTo(vertices[i], 5);
    expect(mesh.faces).toEqual(faces);
  });

  it("falls back to the same placeholder box geometryFor uses for an undefined geometry", () => {
    const mesh = geometryToMesh(undefined);
    checkFacesReferenceRealVertices(mesh);
  });
});
