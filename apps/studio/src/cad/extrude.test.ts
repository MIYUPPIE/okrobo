// Gate test for the CAD Kernel Phase 1 pipeline: runs the real replicad +
// OpenCascade WASM module (no mocks) and asserts a real, non-degenerate
// mesh comes back. Loading OpenCascade's WASM is slow (a few seconds) --
// this is the one CAD Kernel test allowed a longer timeout, matching how
// EngineBuiltRobot.test.ts already treats its own WASM engine load.

import { describe, expect, it } from "vitest";
import { extrudeCircle, extrudeRectangle, loft, revolve } from "./extrude";

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
