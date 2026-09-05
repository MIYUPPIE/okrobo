import { describe, expect, it } from "vitest";
import { shapeFromGeometry } from "./cadTargetShape";

describe("shapeFromGeometry", () => {
  it("maps a box geometry to a box FilletBaseShape", () => {
    expect(shapeFromGeometry({ type: "box", size: [0.1, 0.06, 0.04] })).toEqual({ operation: "box", size: [0.1, 0.06, 0.04] });
  });

  it("maps a cylinder geometry to a cylinder FilletBaseShape", () => {
    expect(shapeFromGeometry({ type: "cylinder", radius: 0.03, length: 0.08 })).toEqual({ operation: "cylinder", radius: 0.03, length: 0.08 });
  });

  it("returns null for a sphere (no exact reconstruction offered)", () => {
    expect(shapeFromGeometry({ type: "sphere", radius: 0.05 })).toBeNull();
  });

  it("returns null for undefined geometry", () => {
    expect(shapeFromGeometry(undefined)).toBeNull();
  });
});
