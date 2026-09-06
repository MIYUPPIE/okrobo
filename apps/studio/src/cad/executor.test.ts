// Gate test for CAD Kernel Phase 7.2's live-recompute executor: runs the
// real replicad + OpenCascade WASM module (no mocks), same posture as
// extrude.test.ts (see its own header comment for why -- no mocks, a
// longer timeout for the cold WASM load). Verifies replayFeatures's own
// raw-OpenCascade reimplementations of fillet/chamfer/shell/draft produce
// results IDENTICAL to kernel.ts's own single-shot convenience-wrapper
// calls (same underlying OpenCascade call sequence, verified by reading
// replicad's own source -- see docs/decisions/cad-kernel-live-recompute-executor.md),
// and directly exercises resolveAfterOperation's own two paths (history-
// informed, and the geometric near() fallback) against hand-built raw
// OpenCascade scenarios, including a genuine full-deletion case.

import { getOC, makeBox, makeCylinder, Solid, type Face } from "replicad";
import { describe, expect, it } from "vitest";
import { fillet, loadOC, shell, draft as kernelDraft, buildFilletBaseSolid, extrudeRectangle } from "./kernel";
import type { Feature, FilletChamferPick } from "../contracts/robotDef";
import { replayFeatures, replayFeaturesSync, resolveAfterOperation } from "./executor";

const TIMEOUT = 30_000;

function distance(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function edgePoint(solid: ReturnType<typeof buildFilletBaseSolid>, index: number): [number, number, number] {
  return solid.edges[index].pointAt(0.5).toTuple() as [number, number, number];
}

function facePoint(solid: ReturnType<typeof buildFilletBaseSolid>, index: number): [number, number, number] {
  return solid.faces[index].center.toTuple() as [number, number, number];
}

describe("replayFeatures: root-only", () => {
  it(
    "a lone box feature matches kernel.ts's own fillet() with no picks",
    async () => {
      const box: Feature = { operation: "box", size: [0.1, 0.06, 0.04] };
      const replayed = await replayFeatures([box]);
      const reference = await fillet({ operation: "box", size: [0.1, 0.06, 0.04] }, []);
      expect(replayed.mesh).toEqual(reference);
      expect(replayed.steps).toEqual([{ index: 0, feature: box, resolvedPicks: [] }]);
    },
    TIMEOUT,
  );

  it(
    "an extrude root matches kernel.ts's own extrudeRectangle exactly",
    async () => {
      const extrudeFeature: Feature = { operation: "extrude", profile: { type: "rectangle", width: 0.1, height: 0.06 }, depth: 0.04 };
      const replayed = await replayFeatures([extrudeFeature]);
      const reference = await extrudeRectangle(0.1, 0.06, 0.04);
      expect(replayed.mesh).toEqual(reference);
    },
    TIMEOUT,
  );

  it(
    "a cylinder root produces a real, non-degenerate mesh",
    async () => {
      const cylinderFeature: Feature = { operation: "cylinder", radius: 0.03, length: 0.08 };
      const { mesh } = await replayFeatures([cylinderFeature]);
      expect(mesh.vertices.length).toBeGreaterThan(0);
      expect(mesh.faces.length).toBeGreaterThan(0);
    },
    TIMEOUT,
  );

  it("throws when the first feature isn't a root kind", async () => {
    const cutOnly: Feature = { operation: "cut", tool: { operation: "extrude", profile: { type: "circle", radius: 0.01 }, depth: 0.1 }, position: [0, 0, 0] };
    await expect(replayFeatures([cutOnly])).rejects.toThrow(/must be a root kind/);
  });

  it("throws for an empty features list", async () => {
    await expect(replayFeatures([])).rejects.toThrow(/at least one feature/);
  });
});

describe("replayFeatures: fillet_chamfer matches kernel.ts's own fillet()", () => {
  it(
    "one fillet pick on a box produces the exact same mesh as kernel.ts's fillet()",
    async () => {
      await loadOC();
      const base = buildFilletBaseSolid({ operation: "box", size: [0.1, 0.06, 0.04] });
      const point = edgePoint(base, 0);
      base.delete();

      const features: Feature[] = [
        { operation: "box", size: [0.1, 0.06, 0.04] },
        { operation: "fillet_chamfer", picks: [{ source_step: 0, local_index: 0, point, operation: "fillet", value: 0.005 }] },
      ];
      const replayed = replayFeaturesSync(features);
      const reference = fillet({ operation: "box", size: [0.1, 0.06, 0.04] }, [{ point, operation: "fillet", value: 0.005 }]);
      const referenceMesh = await reference;
      expect(replayed.mesh).toEqual(referenceMesh);
      expect(replayed.steps[1].resolvedPicks).toEqual([{ status: "ok", point: expect.any(Array) }]);
    },
    TIMEOUT,
  );

  it(
    "one fillet + one chamfer on non-adjacent edges matches kernel.ts's fillet() exactly, resolving both picks",
    async () => {
      await loadOC();
      const base = buildFilletBaseSolid({ operation: "box", size: [0.1, 0.06, 0.04] });
      // Edges 1 and 6, the same non-adjacent pair verified safe to combine
      // in docs/decisions/cad-kernel-fillet-chamfer.md.
      const filletPoint = edgePoint(base, 1);
      const chamferPoint = edgePoint(base, 6);
      base.delete();

      const picks: FilletChamferPick[] = [
        { source_step: 0, local_index: 0, point: filletPoint, operation: "fillet", value: 0.004 },
        { source_step: 0, local_index: 1, point: chamferPoint, operation: "chamfer", value: 0.003 },
      ];
      const features: Feature[] = [{ operation: "box", size: [0.1, 0.06, 0.04] }, { operation: "fillet_chamfer", picks }];
      const replayed = replayFeaturesSync(features);
      const referenceMesh = await fillet({ operation: "box", size: [0.1, 0.06, 0.04] }, [
        { point: filletPoint, operation: "fillet", value: 0.004 },
        { point: chamferPoint, operation: "chamfer", value: 0.003 },
      ]);
      expect(replayed.mesh).toEqual(referenceMesh);
      expect(replayed.steps[1].resolvedPicks).toEqual([
        { status: "ok", point: expect.any(Array) },
        { status: "ok", point: expect.any(Array) },
      ]);
    },
    TIMEOUT,
  );
});

describe("replayFeatures: shell matches kernel.ts's own shell()", () => {
  it(
    "one removed face on a box matches kernel.ts's shell() exactly",
    async () => {
      await loadOC();
      const base = buildFilletBaseSolid({ operation: "box", size: [0.1, 0.06, 0.04] });
      const point = facePoint(base, 0);
      base.delete();

      const features: Feature[] = [
        { operation: "box", size: [0.1, 0.06, 0.04] },
        { operation: "shell", picks: [{ source_step: 0, local_index: 0, point }], thickness: 0.005 },
      ];
      const replayed = replayFeaturesSync(features);
      const referenceMesh = await shell({ operation: "box", size: [0.1, 0.06, 0.04] }, [point], 0.005);
      expect(replayed.mesh).toEqual(referenceMesh);
      // The removed face itself: verified empirically it becomes a real
      // rim face (not nothing) -- resolves "ok", not "deleted".
      expect(replayed.steps[1].resolvedPicks).toEqual([{ status: "ok", point: expect.any(Array) }]);
    },
    TIMEOUT,
  );
});

describe("replayFeatures: draft matches kernel.ts's own draft()", () => {
  it(
    "one drafted side face on a box matches kernel.ts's draft() exactly",
    async () => {
      await loadOC();
      const base = buildFilletBaseSolid({ operation: "box", size: [0.1, 0.06, 0.04] });
      // A side face (not top/bottom, which are parallel to the fixed "XY"
      // neutral plane and would throw -- same restriction kernel.ts's own
      // draft() already documents).
      const sideFace = base.faces.find((f: Face) => Math.abs((f.center.toTuple() as number[])[2]) < 1e-6);
      if (!sideFace) throw new Error("test setup: no side face found");
      const point = sideFace.center.toTuple() as [number, number, number];
      base.delete();

      const features: Feature[] = [
        { operation: "box", size: [0.1, 0.06, 0.04] },
        { operation: "draft", picks: [{ source_step: 0, local_index: 0, point }], angle_deg: 5 },
      ];
      const replayed = replayFeaturesSync(features);
      const referenceMesh = await kernelDraft({ operation: "box", size: [0.1, 0.06, 0.04] }, [point], 5);
      expect(replayed.mesh).toEqual(referenceMesh);
      expect(replayed.steps[1].resolvedPicks).toEqual([{ status: "ok", point: expect.any(Array) }]);
    },
    TIMEOUT,
  );
});

describe("replayFeatures: cut is a real B-rep boolean, chained live", () => {
  it(
    "a cut through a box produces a real, non-degenerate mesh with no picks to resolve",
    async () => {
      const features: Feature[] = [
        { operation: "box", size: [0.1, 0.06, 0.04] },
        {
          operation: "cut",
          tool: { operation: "extrude", profile: { type: "circle", radius: 0.01 }, depth: 0.2 },
          position: [0, 0, 0],
        },
      ];
      const { mesh, steps } = await replayFeatures(features);
      expect(mesh.vertices.length).toBeGreaterThan(0);
      expect(mesh.faces.length).toBeGreaterThan(0);
      expect(steps[1].resolvedPicks).toEqual([]);
    },
    TIMEOUT,
  );

  it("throws when a feature after the first isn't a modifier kind", async () => {
    const features: Feature[] = [
      { operation: "box", size: [0.1, 0.06, 0.04] },
      { operation: "box", size: [0.2, 0.2, 0.2] },
    ];
    await expect(replayFeatures(features)).rejects.toThrow(/must be a modifier kind/);
  });
});

describe("replayFeatures: a full multi-step chain (box -> shell -> draft)", () => {
  it(
    "replays a 3-step history end to end, every pick resolving ok, in order",
    async () => {
      await loadOC();
      const oc = getOC();

      const base = buildFilletBaseSolid({ operation: "box", size: [0.1, 0.06, 0.04] });
      const shellFacePoint = facePoint(base, 0);
      base.delete();

      // Build the same box -> shell chain via raw OpenCascade (mirroring
      // executor.ts's own applyShell exactly) to get a live intermediate
      // solid, so a real face on IT (not the original box) can be picked
      // for the draft step -- exactly what a real UI's own previewFaces
      // call would show after Apply-ing the shell.
      const preShell = buildFilletBaseSolid({ operation: "box", size: [0.1, 0.06, 0.04] });
      const toRemove = preShell.faces.find((f: Face) => distance(f.center.toTuple() as [number, number, number], shellFacePoint) < 0.01);
      if (!toRemove) throw new Error("test setup: shell face not found");
      const facesToRemove = new oc.NCollection_List_TopoDS_Shape();
      facesToRemove.Append(toRemove.wrapped);
      const shellBuilder = new oc.BRepOffsetAPI_MakeThickSolid();
      shellBuilder.MakeThickSolidByJoin(preShell.wrapped, facesToRemove, -0.005, 0.001, oc.BRepOffset_Mode.BRepOffset_Skin, false, false, oc.GeomAbs_JoinType.GeomAbs_Arc, false);
      const shelledSolid = new Solid(shellBuilder.Shape());
      // Any side face (not top/bottom, parallel to the fixed "XY" neutral
      // plane draft() uses) of the shelled result.
      const draftFace = shelledSolid.faces.find((f: Face) => Math.abs((f.center.toTuple() as number[])[2]) < 1e-6);
      if (!draftFace) throw new Error("test setup: no draftable side face found on the shelled result");
      const draftFacePoint = draftFace.center.toTuple() as [number, number, number];
      facesToRemove.delete();
      shellBuilder.delete();
      preShell.delete();
      shelledSolid.delete();

      const features: Feature[] = [
        { operation: "box", size: [0.1, 0.06, 0.04] },
        { operation: "shell", picks: [{ source_step: 0, local_index: 0, point: shellFacePoint }], thickness: 0.005 },
        { operation: "draft", picks: [{ source_step: 1, local_index: 0, point: draftFacePoint }], angle_deg: 5 },
      ];
      const replayed = replayFeaturesSync(features);
      expect(replayed.mesh.vertices.length).toBeGreaterThan(0);
      expect(replayed.steps).toHaveLength(3);
      expect(replayed.steps[0].resolvedPicks).toEqual([]);
      expect(replayed.steps[1].resolvedPicks.every((p) => p.status === "ok")).toBe(true);
      expect(replayed.steps[2].resolvedPicks.every((p) => p.status === "ok")).toBe(true);
    },
    TIMEOUT,
  );
});

describe("resolveAfterOperation: direct verification against hand-built raw OpenCascade scenarios", () => {
  it(
    "reports 'ok' with an updated point for a fillet's own directly-targeted edge",
    async () => {
      await loadOC();
      const oc = getOC();
      const box = makeBox([-0.5, -0.5, -0.5], [0.5, 0.5, 0.5]);
      const target = box.edges[0];
      const originalPoint = target.pointAt(0.5).toTuple() as [number, number, number];

      const builder = new oc.BRepFilletAPI_MakeFillet(box.wrapped, oc.ChFi3d_FilletShape.ChFi3d_Rational);
      builder.Add(0.1, target.wrapped);
      const result = new Solid(builder.Shape());

      const resolution = resolveAfterOperation(builder, target.wrapped, originalPoint, "edge", result, 0.01);
      expect(resolution.status).toBe("ok");

      builder.delete();
      box.delete();
      result.delete();
    },
    TIMEOUT,
  );

  it(
    "reports 'ok' with the SAME point for an edge untouched by the fillet",
    async () => {
      await loadOC();
      const oc = getOC();
      const box = makeBox([-0.5, -0.5, -0.5], [0.5, 0.5, 0.5]);
      const target = box.edges[0];
      const untouched = box.edges[6];
      const untouchedPoint = untouched.pointAt(0.5).toTuple() as [number, number, number];

      const builder = new oc.BRepFilletAPI_MakeFillet(box.wrapped, oc.ChFi3d_FilletShape.ChFi3d_Rational);
      builder.Add(0.1, target.wrapped);
      const result = new Solid(builder.Shape());

      const resolution = resolveAfterOperation(builder, untouched.wrapped, untouchedPoint, "edge", result, 0.01);
      expect(resolution).toEqual({ status: "ok", point: untouchedPoint });

      builder.delete();
      box.delete();
      result.delete();
    },
    TIMEOUT,
  );

  it(
    "reports 'deleted' when a cut tool entirely engulfs a face, leaving nothing to correspond to it",
    async () => {
      await loadOC();
      const oc = getOC();
      const target = makeBox([-0.5, -0.5, -0.5], [0.5, 0.5, 0.5]);
      const topFace = target.faces.find((f: Face) => Math.abs((f.center.toTuple() as number[])[2] - 0.5) < 1e-6);
      if (!topFace) throw new Error("test setup: no top face found");
      const originalPoint = topFace.center.toTuple() as [number, number, number];
      const tool = makeCylinder(5, 1, [0, 0, 0], [0, 0, 1]);

      const builder = new oc.BRepAlgoAPI_Cut(target.wrapped, tool.wrapped);
      builder.Build();
      builder.SimplifyResult(true, true, 0.001);
      const result = new Solid(builder.Shape());

      const resolution = resolveAfterOperation(builder, topFace.wrapped, originalPoint, "face", result, 0.01);
      expect(resolution).toEqual({ status: "deleted" });

      builder.delete();
      target.delete();
      tool.delete();
      result.delete();
    },
    TIMEOUT,
  );
});
