// Gate test for the CAD Kernel Phase 1 pipeline: runs the real replicad +
// OpenCascade WASM module (no mocks) and asserts a real, non-degenerate
// mesh comes back. Loading OpenCascade's WASM is slow (a few seconds) --
// this is the one CAD Kernel test allowed a longer timeout, matching how
// EngineBuiltRobot.test.ts already treats its own WASM engine load.

import { describe, expect, it } from "vitest";
import { extrudeCircle, extrudeRectangle } from "./extrude";

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
