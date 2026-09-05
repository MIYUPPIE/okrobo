// Gate tests for cadClient.ts's wiring: a real browser Worker + comlink
// aren't available under vitest's node environment (confirmed in Phase 1 --
// see docs/decisions/cad-kernel-foundation.md), so both are mocked here.
// This only proves the client constructs/reuses one Worker correctly and
// delegates to the wrapped API -- the real replicad/OpenCascade pipeline
// itself is proven by extrude.test.ts (direct call) and the CAD E2E checks
// in scripts/lib/studio-e2e-check.mjs (through the real worker, in a real
// browser).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const wrapMock = vi.fn();
vi.mock("comlink", () => ({ wrap: wrapMock }));

class MockWorker {
  static instances: MockWorker[] = [];
  url: URL;
  options?: WorkerOptions;
  constructor(url: URL, options?: WorkerOptions) {
    this.url = url;
    this.options = options;
    MockWorker.instances.push(this);
  }
}

beforeEach(() => {
  MockWorker.instances = [];
  wrapMock.mockReset();
  vi.stubGlobal("Worker", MockWorker);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("cadClient", () => {
  it("constructs no Worker just from being imported", async () => {
    await import("./cadClient");
    expect(MockWorker.instances).toHaveLength(0);
    expect(wrapMock).not.toHaveBeenCalled();
  });

  it("constructs exactly one Worker (pointed at worker.ts, as a module) on first use, reused on later calls", async () => {
    const stubApi = {
      extrudeRectangle: vi.fn().mockResolvedValue({ vertices: [1], faces: [2] }),
      extrudeCircle: vi.fn().mockResolvedValue({ vertices: [3], faces: [4] }),
    };
    wrapMock.mockReturnValue(stubApi);
    const { extrudeRectangle, extrudeCircle } = await import("./cadClient");

    await extrudeRectangle({ width: 0.1, height: 0.2, depth: 0.05 });
    expect(MockWorker.instances).toHaveLength(1);
    expect(MockWorker.instances[0].url.pathname.endsWith("/worker.ts")).toBe(true);
    expect(MockWorker.instances[0].options).toEqual({ type: "module" });
    expect(wrapMock).toHaveBeenCalledTimes(1);

    await extrudeCircle({ radius: 0.05, depth: 0.05 });
    expect(MockWorker.instances).toHaveLength(1); // no second Worker
    expect(wrapMock).toHaveBeenCalledTimes(1); // no second wrap
  });

  it("delegates extrudeRectangle to the wrapped API with the parsed args and resolves its result", async () => {
    const stubApi = { extrudeRectangle: vi.fn().mockResolvedValue({ vertices: [1, 2, 3], faces: [0, 0, 0] }) };
    wrapMock.mockReturnValue(stubApi);
    const { extrudeRectangle } = await import("./cadClient");

    const mesh = await extrudeRectangle({ width: 0.1, height: 0.2, depth: 0.05 });
    expect(stubApi.extrudeRectangle).toHaveBeenCalledWith(0.1, 0.2, 0.05);
    expect(mesh).toEqual({ vertices: [1, 2, 3], faces: [0, 0, 0] });
  });

  it("delegates extrudeCircle to the wrapped API with the parsed args and resolves its result", async () => {
    const stubApi = { extrudeCircle: vi.fn().mockResolvedValue({ vertices: [4, 5, 6], faces: [1, 1, 1] }) };
    wrapMock.mockReturnValue(stubApi);
    const { extrudeCircle } = await import("./cadClient");

    const mesh = await extrudeCircle({ radius: 0.03, depth: 0.02 });
    expect(stubApi.extrudeCircle).toHaveBeenCalledWith(0.03, 0.02);
    expect(mesh).toEqual({ vertices: [4, 5, 6], faces: [1, 1, 1] });
  });

  it("propagates a rejection from the wrapped API", async () => {
    const stubApi = { extrudeRectangle: vi.fn().mockRejectedValue(new Error("degenerate profile")) };
    wrapMock.mockReturnValue(stubApi);
    const { extrudeRectangle } = await import("./cadClient");

    await expect(extrudeRectangle({ width: 0, height: 0.1, depth: 0.1 })).rejects.toThrow("degenerate profile");
  });

  // CAD Kernel Phase 3 (Revolve + Boundary).
  it("delegates revolve to the wrapped API with the parsed args and resolves its result", async () => {
    const stubApi = { revolve: vi.fn().mockResolvedValue({ vertices: [1, 2, 3], faces: [0, 0, 0] }) };
    wrapMock.mockReturnValue(stubApi);
    const { revolve } = await import("./cadClient");

    const mesh = await revolve({ profile: { type: "circle", radius: 0.02 }, offset: 0.05, angleDeg: 360 });
    expect(stubApi.revolve).toHaveBeenCalledWith({ type: "circle", radius: 0.02 }, 0.05, 360);
    expect(mesh).toEqual({ vertices: [1, 2, 3], faces: [0, 0, 0] });
  });

  it("delegates loft to the wrapped API with the parsed args and resolves its result", async () => {
    const stubApi = { loft: vi.fn().mockResolvedValue({ vertices: [4, 5, 6], faces: [1, 1, 1] }) };
    wrapMock.mockReturnValue(stubApi);
    const { loft } = await import("./cadClient");

    const startProfile = { type: "rectangle" as const, width: 0.06, height: 0.06 };
    const endProfile = { type: "circle" as const, radius: 0.02 };
    const mesh = await loft({ startProfile, endProfile, height: 0.08 });
    expect(stubApi.loft).toHaveBeenCalledWith(startProfile, endProfile, 0.08);
    expect(mesh).toEqual({ vertices: [4, 5, 6], faces: [1, 1, 1] });
  });

  // CAD Kernel Phase 4 (Cut).
  it("delegates cut to the wrapped API with the parsed args and resolves its result", async () => {
    const stubApi = { cut: vi.fn().mockResolvedValue({ vertices: [7, 8, 9], faces: [2, 2, 2] }) };
    wrapMock.mockReturnValue(stubApi);
    const { cut } = await import("./cadClient");

    const targetMesh = { vertices: [0, 0, 0, 0.1, 0, 0, 0, 0.1, 0], faces: [0, 1, 2] };
    const tool = { operation: "extrude" as const, profile: { type: "circle" as const, radius: 0.015 }, depth: 0.2 };
    const mesh = await cut({ targetMesh, tool, position: [0.03, 0, 0] });
    expect(stubApi.cut).toHaveBeenCalledWith(targetMesh, tool, [0.03, 0, 0]);
    expect(mesh).toEqual({ vertices: [7, 8, 9], faces: [2, 2, 2] });
  });

  // CAD Kernel Phase 5 (Fillet + Chamfer).
  it("delegates previewEdges to the wrapped API with the shape and resolves its result", async () => {
    const edgeMesh = { lines: [0, 0, 0, 1, 0, 0], edgeGroups: [{ start: 0, count: 2, edgeId: 1 }] };
    const stubApi = { previewEdges: vi.fn().mockResolvedValue(edgeMesh) };
    wrapMock.mockReturnValue(stubApi);
    const { previewEdges } = await import("./cadClient");

    const shape = { operation: "box" as const, size: [0.1, 0.06, 0.04] as [number, number, number] };
    const result = await previewEdges(shape);
    expect(stubApi.previewEdges).toHaveBeenCalledWith(shape);
    expect(result).toEqual(edgeMesh);
  });

  it("delegates fillet to the wrapped API with the shape and picks and resolves its result", async () => {
    const stubApi = { fillet: vi.fn().mockResolvedValue({ vertices: [1, 2, 3], faces: [0, 0, 0] }) };
    wrapMock.mockReturnValue(stubApi);
    const { fillet } = await import("./cadClient");

    const shape = { operation: "cylinder" as const, radius: 0.03, length: 0.08 };
    const picks = [{ point: [0.03, 0, 0] as [number, number, number], operation: "fillet" as const, value: 0.005 }];
    const mesh = await fillet(shape, picks);
    expect(stubApi.fillet).toHaveBeenCalledWith(shape, picks);
    expect(mesh).toEqual({ vertices: [1, 2, 3], faces: [0, 0, 0] });
  });
});
