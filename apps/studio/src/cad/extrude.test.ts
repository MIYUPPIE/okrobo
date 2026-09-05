// Gate test for the CAD Kernel Phase 1 pipeline: runs the real replicad +
// OpenCascade WASM module (no mocks) and asserts a real, non-degenerate
// mesh comes back. Loading OpenCascade's WASM is slow (a few seconds) --
// this is the one CAD Kernel test allowed a longer timeout, matching how
// EngineBuiltRobot.test.ts already treats its own WASM engine load.

import { describe, expect, it } from "vitest";
import { cut, extrudeCircle, extrudeRectangle, fillet, loft, previewEdges, revolve, type ShapeEdgeMesh } from "./extrude";

// A group's own true midpoint (2-point straight edge) or an interior
// polyline sample (many-point curved edge) -- never a shared vertex,
// mirroring kernel.ts's own applyFilletPicks doc. Kept test-local rather
// than imported from builder/filletPicks.ts (this module's own consumer),
// which would invert this app's cad -> builder dependency direction.
function edgeGroupDescriptor(edgeMesh: ShapeEdgeMesh, groupIndex: number): [number, number, number] {
  const group = edgeMesh.edgeGroups[groupIndex];
  if (group.count === 2) {
    const a = group.start * 3;
    const b = (group.start + 1) * 3;
    return [(edgeMesh.lines[a] + edgeMesh.lines[b]) / 2, (edgeMesh.lines[a + 1] + edgeMesh.lines[b + 1]) / 2, (edgeMesh.lines[a + 2] + edgeMesh.lines[b + 2]) / 2];
  }
  const mid = (group.start + Math.floor(group.count / 2)) * 3;
  return [edgeMesh.lines[mid], edgeMesh.lines[mid + 1], edgeMesh.lines[mid + 2]];
}

function meshRanges(mesh: { vertices: number[] }) {
  const xs = [];
  const ys = [];
  const zs = [];
  for (let i = 0; i < mesh.vertices.length; i += 3) {
    xs.push(mesh.vertices[i]);
    ys.push(mesh.vertices[i + 1]);
    zs.push(mesh.vertices[i + 2]);
  }
  const range = (values: number[]): [number, number] => [Math.min(...values), Math.max(...values)];
  return { x: range(xs), y: range(ys), z: range(zs) };
}

describe("extrudeRectangle", () => {
  it(
    "produces a real, non-degenerate mesh for a simple box extrusion",
    async () => {
      const mesh = await extrudeRectangle({ width: 0.2, height: 0.1, depth: 0.05 });

      expect(mesh.vertices.length).toBeGreaterThan(0);
      expect(mesh.vertices.length % 3).toBe(0);
      expect(mesh.faces.length).toBeGreaterThan(0);
      expect(mesh.faces.length % 3).toBe(0);

      const vertexCount = mesh.vertices.length / 3;
      for (const index of mesh.faces) {
        expect(Number.isInteger(index)).toBe(true);
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(vertexCount);
      }

      // A box extrusion is axis-aligned: every vertex should fall within the
      // requested half-extents (with a little slack for OpenCascade's own
      // meshing tolerance), and actually span close to the full range on
      // each axis -- not collapse to a point or a flat sheet.
      const xs = [];
      const ys = [];
      const zs = [];
      for (let i = 0; i < mesh.vertices.length; i += 3) {
        xs.push(mesh.vertices[i]);
        ys.push(mesh.vertices[i + 1]);
        zs.push(mesh.vertices[i + 2]);
      }
      const range = (values: number[]) => Math.max(...values) - Math.min(...values);
      expect(range(xs)).toBeGreaterThan(0.19);
      expect(range(xs)).toBeLessThan(0.21);
      expect(range(ys)).toBeGreaterThan(0.09);
      expect(range(ys)).toBeLessThan(0.11);
      expect(range(zs)).toBeGreaterThan(0.04);
      expect(range(zs)).toBeLessThan(0.06);
      // Centered on the body's own local origin, matching every other
      // geometry type's convention (box/cylinder/etc. sizes are full
      // extents centered at the body frame's origin).
      expect(Math.min(...zs)).toBeCloseTo(-0.025, 1);
      expect(Math.max(...zs)).toBeCloseTo(0.025, 1);
    },
    30_000,
  );
});

describe("extrudeCircle", () => {
  it(
    "produces a real, non-degenerate mesh for a cylinder extrusion",
    async () => {
      const mesh = await extrudeCircle({ radius: 0.05, depth: 0.1 });

      expect(mesh.vertices.length).toBeGreaterThan(0);
      expect(mesh.vertices.length % 3).toBe(0);
      expect(mesh.faces.length).toBeGreaterThan(0);
      expect(mesh.faces.length % 3).toBe(0);

      const vertexCount = mesh.vertices.length / 3;
      for (const index of mesh.faces) {
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(vertexCount);
      }

      // A circle of radius 0.05 extruded 0.1 deep: no vertex should stray
      // meaningfully outside that cylinder's bounding box.
      let maxRadius = 0;
      for (let i = 0; i < mesh.vertices.length; i += 3) {
        const x = mesh.vertices[i];
        const y = mesh.vertices[i + 1];
        maxRadius = Math.max(maxRadius, Math.hypot(x, y));
      }
      expect(maxRadius).toBeGreaterThan(0.04);
      expect(maxRadius).toBeLessThan(0.06);
    },
    30_000,
  );
});

// CAD Kernel Phase 3 (Revolve + Boundary). Real pipeline, no mocks -- see
// docs/decisions/cad-kernel-revolve-boundary.md for the empirically
// verified geometry conventions these assertions check against.
describe("revolve", () => {
  it(
    "produces a real torus from a circle profile offset from the axis, revolved 360deg",
    async () => {
      const mesh = await revolve({ profile: { type: "circle", radius: 0.02 }, offset: 0.05, angleDeg: 360 });
      expect(mesh.vertices.length).toBeGreaterThan(0);
      expect(mesh.faces.length % 3).toBe(0);

      const { x, y, z } = meshRanges(mesh);
      // A torus of tube radius 0.02 offset 0.05 from the Y axis: radial
      // extent (x and z) spans offset +/- radius, axial extent (y) spans
      // +/- radius.
      expect(x[1] - x[0]).toBeGreaterThan(0.13);
      expect(x[1] - x[0]).toBeLessThan(0.15);
      expect(z[1] - z[0]).toBeGreaterThan(0.13);
      expect(z[1] - z[0]).toBeLessThan(0.15);
      expect(y[1] - y[0]).toBeGreaterThan(0.03);
      expect(y[1] - y[0]).toBeLessThan(0.05);
    },
    30_000,
  );

  it(
    "produces a real solid (no hole) when offset equals half the profile's own extent",
    async () => {
      // Rectangle's near edge sits exactly on the axis -- no hole.
      const mesh = await revolve({ profile: { type: "rectangle", width: 0.04, height: 0.03 }, offset: 0.02, angleDeg: 360 });
      const { x, z } = meshRanges(mesh);
      expect(x[0]).toBeCloseTo(-0.04, 1);
      expect(x[1]).toBeCloseTo(0.04, 1);
      expect(z[0]).toBeCloseTo(-0.04, 1);
      expect(z[1]).toBeCloseTo(0.04, 1);
    },
    10_000,
  );

  it(
    "a partial angle produces a real, correctly-bounded partial revolve",
    async () => {
      const full = await revolve({ profile: { type: "circle", radius: 0.02 }, offset: 0.05, angleDeg: 360 });
      const half = await revolve({ profile: { type: "circle", radius: 0.02 }, offset: 0.05, angleDeg: 180 });
      // Half the sweep: fewer vertices than the full revolve, and confined
      // to one side of the axis (z <= 0, matching the sweep direction).
      expect(half.vertices.length).toBeLessThan(full.vertices.length);
      const { z } = meshRanges(half);
      expect(z[1]).toBeLessThanOrEqual(0.001);
    },
    10_000,
  );
});

describe("loft", () => {
  it(
    "produces a real solid blending a rectangle into a circle",
    async () => {
      const mesh = await loft({
        startProfile: { type: "rectangle", width: 0.06, height: 0.06 },
        endProfile: { type: "circle", radius: 0.02 },
        height: 0.08,
      });
      expect(mesh.vertices.length).toBeGreaterThan(0);
      expect(mesh.faces.length % 3).toBe(0);

      const { x, y, z } = meshRanges(mesh);
      // Bounded by the wider of the two profiles (the rectangle's own
      // half-extent, 0.03) in x/y, and spans the full requested height in z.
      expect(Math.max(Math.abs(x[0]), Math.abs(x[1]))).toBeGreaterThan(0.025);
      expect(Math.max(Math.abs(x[0]), Math.abs(x[1]))).toBeLessThan(0.035);
      expect(Math.max(Math.abs(y[0]), Math.abs(y[1]))).toBeGreaterThan(0.025);
      expect(Math.max(Math.abs(y[0]), Math.abs(y[1]))).toBeLessThan(0.035);
      expect(z[0]).toBeCloseTo(0, 2);
      expect(z[1]).toBeCloseTo(0.08, 1);
    },
    30_000,
  );

  it(
    "produces a real solid blending two circles of different radii",
    async () => {
      const mesh = await loft({
        startProfile: { type: "circle", radius: 0.04 },
        endProfile: { type: "circle", radius: 0.02 },
        height: 0.05,
      });
      const { z } = meshRanges(mesh);
      expect(z[0]).toBeCloseTo(0, 2);
      expect(z[1]).toBeCloseTo(0.05, 1);

      let maxRadius = 0;
      for (let i = 0; i < mesh.vertices.length; i += 3) {
        maxRadius = Math.max(maxRadius, Math.hypot(mesh.vertices[i], mesh.vertices[i + 1]));
      }
      // Bounded by the wider (start) circle's own radius.
      expect(maxRadius).toBeGreaterThan(0.035);
      expect(maxRadius).toBeLessThan(0.045);
    },
    10_000,
  );
});

// CAD Kernel Phase 4 (Cut). Real pipeline, no mocks -- see
// docs/decisions/cad-kernel-cut-operations.md for the empirically verified
// mesh-boolean approach (importSTLAsMesh + Manifold, not a B-rep
// reconstruction).
describe("cut", () => {
  it(
    "punches a real hole through a box with an off-center extruded cylinder tool, leaving its outer bounding box unchanged",
    async () => {
      const box = await extrudeRectangle({ width: 0.1, height: 0.1, depth: 0.1 });
      const result = await cut({
        targetMesh: box,
        tool: { operation: "extrude", profile: { type: "circle", radius: 0.015 }, depth: 0.2 },
        position: [0.03, 0, 0],
      });

      expect(result.vertices.length).toBeGreaterThan(box.vertices.length); // the hole adds real new internal geometry
      expect(result.faces.length % 3).toBe(0);

      const vertexCount = result.vertices.length / 3;
      for (const index of result.faces) {
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(vertexCount);
      }

      const { x, y, z } = meshRanges(result);
      // The tool punched all the way through -- the box's own outer extent
      // is unchanged, proving this is a real subtraction, not a shape swap.
      expect(x[1] - x[0]).toBeCloseTo(0.1, 1);
      expect(y[1] - y[0]).toBeCloseTo(0.1, 1);
      expect(z[1] - z[0]).toBeCloseTo(0.1, 1);
    },
    30_000,
  );

  it(
    "cuts with a revolved (torus) tool and a lofted tool, each producing a real, non-degenerate result",
    async () => {
      const box = await extrudeRectangle({ width: 0.1, height: 0.1, depth: 0.1 });

      const revolveCut = await cut({
        targetMesh: box,
        tool: { operation: "revolve", profile: { type: "circle", radius: 0.01 }, offset: 0.03, angleDeg: 360 },
        position: [0, 0, 0],
      });
      expect(revolveCut.vertices.length).toBeGreaterThan(0);
      expect(revolveCut.faces.length % 3).toBe(0);

      const loftCut = await cut({
        targetMesh: box,
        tool: {
          operation: "loft",
          startProfile: { type: "circle", radius: 0.02 },
          endProfile: { type: "circle", radius: 0.01 },
          height: 0.15,
        },
        position: [0, 0, -0.075],
      });
      expect(loftCut.vertices.length).toBeGreaterThan(0);
      expect(loftCut.faces.length % 3).toBe(0);
    },
    15_000,
  );
});

// CAD Kernel Phase 5 (Fillet + Chamfer). Real pipeline, no mocks -- see
// docs/decisions/cad-kernel-fillet-chamfer.md for the empirically verified
// edge-identification approach (a geometric descriptor point + near(),
// not Shape.hashCode, which isn't stable across independent rebuilds).
describe("previewEdges", () => {
  it(
    "exports a real, pickable edge list for a Boss (extrude) shape",
    async () => {
      const edges = await previewEdges({ operation: "extrude", profile: { type: "rectangle", width: 0.1, height: 0.06 }, depth: 0.04 });
      expect(edges.edgeGroups.length).toBe(12); // a box has exactly 12 edges
      expect(edges.lines.length).toBeGreaterThan(0);
      expect(edges.lines.length % 3).toBe(0);
    },
    30_000,
  );

  it(
    "exports a real edge list for a standalone box/cylinder primitive shape",
    async () => {
      const boxEdges = await previewEdges({ operation: "box", size: [0.1, 0.06, 0.04] });
      expect(boxEdges.edgeGroups.length).toBe(12);

      const cylEdges = await previewEdges({ operation: "cylinder", radius: 0.03, length: 0.08 });
      expect(cylEdges.edgeGroups.length).toBe(3); // seam + two circular rims
      // The two rims are real curves (many polyline points); the seam is a
      // straight 2-point segment.
      const counts = cylEdges.edgeGroups.map((g) => g.count).sort((a, b) => a - b);
      expect(counts[0]).toBe(2);
      expect(counts[1]).toBeGreaterThan(2);
      expect(counts[2]).toBeGreaterThan(2);
    },
    15_000,
  );
});

describe("fillet", () => {
  it(
    "rounds one edge and bevels another with different values in a single call",
    async () => {
      const shape = { operation: "extrude" as const, profile: { type: "rectangle" as const, width: 0.1, height: 0.06 }, depth: 0.04 };
      const edges = await previewEdges(shape);
      const base = await extrudeRectangle({ width: 0.1, height: 0.06, depth: 0.04 });

      const result = await fillet(shape, [
        { point: edgeGroupDescriptor(edges, 0), operation: "fillet", value: 0.01 },
        { point: edgeGroupDescriptor(edges, 5), operation: "chamfer", value: 0.005 },
      ]);

      expect(result.vertices.length).toBeGreaterThan(base.vertices.length); // real added geometry from both operations
      expect(result.faces.length % 3).toBe(0);
      const vertexCount = result.vertices.length / 3;
      for (const index of result.faces) {
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(vertexCount);
      }
      // Outer extent is unaffected by rounding/beveling corners -- still
      // bounded by the original box dimensions.
      const { x, y } = meshRanges(result);
      expect(x[1] - x[0])
        .toBeLessThanOrEqual(0.1 + 1e-6);
      expect(y[1] - y[0])
        .toBeLessThanOrEqual(0.06 + 1e-6);
    },
    30_000,
  );

  it(
    "rounds the rim of a standalone cylinder primitive body",
    async () => {
      const shape = { operation: "cylinder" as const, radius: 0.03, length: 0.08 };
      const edges = await previewEdges(shape);
      const rimIndex = edges.edgeGroups.findIndex((g) => g.count > 2);
      const result = await fillet(shape, [{ point: edgeGroupDescriptor(edges, rimIndex), operation: "fillet", value: 0.01 }]);
      expect(result.vertices.length).toBeGreaterThan(0);
      expect(result.faces.length % 3).toBe(0);
    },
    15_000,
  );

  it(
    "a fillet radius too large for its edge throws a catchable error",
    async () => {
      const shape = { operation: "box" as const, size: [0.1, 0.06, 0.04] as [number, number, number] };
      const edges = await previewEdges(shape);
      await expect(fillet(shape, [{ point: edgeGroupDescriptor(edges, 0), operation: "fillet", value: 10 }])).rejects.toBeTruthy();
    },
    15_000,
  );
});
