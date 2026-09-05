import { describe, expect, it } from "vitest";
import { DEFAULT_FILLET_VALUE, edgeGroupDescriptor, parseFilletPicks, type FilletPickDraft } from "./filletPicks";
import type { ShapeEdgeMesh } from "../cad/cadClient";

describe("edgeGroupDescriptor", () => {
  it("returns the true midpoint (average of the two endpoints) for a 2-point straight-edge group", () => {
    const edgeMesh: ShapeEdgeMesh = {
      lines: [0, 0, 0, /* seam */ 10, 0, 0],
      edgeGroups: [{ start: 0, count: 2, edgeId: 1 }],
    };
    expect(edgeGroupDescriptor(edgeMesh, 0)).toEqual([5, 0, 0]);
  });

  it("returns an interior polyline sample (not an endpoint) for a many-point curved-edge group", () => {
    const edgeMesh: ShapeEdgeMesh = {
      lines: [0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0, 4, 0, 0],
      edgeGroups: [{ start: 0, count: 5, edgeId: 2 }],
    };
    // Math.floor(5/2) = 2 -> the point at index 2, [2,0,0] -- interior,
    // not either endpoint ([0,0,0] or [4,0,0]).
    expect(edgeGroupDescriptor(edgeMesh, 0)).toEqual([2, 0, 0]);
  });

  it("reads the requested group out of a multi-group edge mesh using its own start offset", () => {
    const edgeMesh: ShapeEdgeMesh = {
      lines: [0, 0, 0, 1, 0, 0, /* group 1 */ 5, 5, 5, 7, 5, 5],
      edgeGroups: [
        { start: 0, count: 2, edgeId: 1 },
        { start: 2, count: 2, edgeId: 2 },
      ],
    };
    expect(edgeGroupDescriptor(edgeMesh, 1)).toEqual([6, 5, 5]);
  });
});

describe("parseFilletPicks", () => {
  it("parses an empty list to an empty list", () => {
    expect(parseFilletPicks([])).toEqual({ ok: true, value: [] });
  });

  it("parses multiple valid picks in order, preserving operation and point", () => {
    const drafts: FilletPickDraft[] = [
      { point: [1, 2, 3], operation: "fillet", value: "0.01" },
      { point: [4, 5, 6], operation: "chamfer", value: "0.005" },
    ];
    expect(parseFilletPicks(drafts)).toEqual({
      ok: true,
      value: [
        { point: [1, 2, 3], operation: "fillet", value: 0.01 },
        { point: [4, 5, 6], operation: "chamfer", value: 0.005 },
      ],
    });
  });

  it("rejects a non-positive value with a 1-based, human-readable label", () => {
    const drafts: FilletPickDraft[] = [
      { point: [1, 2, 3], operation: "fillet", value: "0.01" },
      { point: [4, 5, 6], operation: "chamfer", value: "0" },
    ];
    expect(parseFilletPicks(drafts)).toEqual({ ok: false, message: "Edge 2 value must be greater than 0" });
  });

  it("rejects a non-numeric value", () => {
    const drafts: FilletPickDraft[] = [{ point: [0, 0, 0], operation: "fillet", value: "abc" }];
    const result = parseFilletPicks(drafts);
    expect(result.ok).toBe(false);
  });
});

describe("DEFAULT_FILLET_VALUE", () => {
  it("is itself a valid, positive value", () => {
    const result = parseFilletPicks([{ point: [0, 0, 0], operation: "fillet", value: DEFAULT_FILLET_VALUE }]);
    expect(result.ok).toBe(true);
  });
});
