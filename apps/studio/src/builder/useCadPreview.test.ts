// @vitest-environment jsdom
//
// Same fake-timer technique CadExtrudeCreator.test.tsx already proved:
// vi.useFakeTimers() + vi.advanceTimersByTimeAsync, wrapped in act() so
// React actually flushes the debounced call's own state updates before
// each assertion (a bare advanceTimersByTimeAsync isn't enough -- the
// state update lands inside a .then()/.catch() outside any act() scope
// render()/fireEvent() already provide).
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CAD_PREVIEW_DEBOUNCE_MS, useCadPreview } from "./useCadPreview";

afterEach(() => vi.useRealTimers());

async function advanceTimers(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const mesh = { vertices: [0, 0, 0, 0.1, 0, 0, 0, 0.1, 0], faces: [0, 1, 2] };

describe("useCadPreview", () => {
  it("surfaces a parse error immediately, with no debounce and no call", async () => {
    const call = vi.fn();
    const { result } = renderHook(() => useCadPreview(() => ({ ok: false, message: "Width must be greater than 0" }), []));
    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("Width must be greater than 0");
    expect(call).not.toHaveBeenCalled();
  });

  it("debounces then resolves to ready with the mesh", async () => {
    vi.useFakeTimers();
    const call = vi.fn().mockResolvedValue(mesh);
    const { result } = renderHook(() => useCadPreview(() => ({ ok: true, call }), []));
    expect(result.current.status).toBe("loading");
    expect(call).not.toHaveBeenCalled(); // not yet -- still debouncing

    await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
    expect(call).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("ready");
    expect(result.current.mesh).toEqual(mesh);
  });

  it("surfaces a rejection's message and clears the mesh", async () => {
    vi.useFakeTimers();
    const call = vi.fn().mockRejectedValue(new Error("degenerate profile"));
    const { result } = renderHook(() => useCadPreview(() => ({ ok: true, call }), []));

    await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("degenerate profile");
    expect(result.current.mesh).toBeNull();
  });

  it("discards a stale in-flight response when deps change before it resolves", async () => {
    vi.useFakeTimers();
    let resolveFirst: (m: typeof mesh) => void = () => {};
    const firstCall = vi.fn().mockReturnValue(new Promise((resolve) => { resolveFirst = resolve; }));
    const secondMesh = { vertices: [1, 1, 1], faces: [0, 0, 0] };
    const secondCall = vi.fn().mockResolvedValue(secondMesh);

    const { result, rerender } = renderHook(({ dep }: { dep: number }) => useCadPreview(() => ({ ok: true, call: dep === 1 ? firstCall : secondCall }), [dep]), {
      initialProps: { dep: 1 },
    });

    // Let the first debounce fire and its call start (still pending).
    await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
    expect(firstCall).toHaveBeenCalledTimes(1);

    // Change deps before the first call resolves -- a fresh debounce+call starts.
    rerender({ dep: 2 });
    await advanceTimers(CAD_PREVIEW_DEBOUNCE_MS);
    expect(secondCall).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("ready");
    expect(result.current.mesh).toEqual(secondMesh);

    // The stale first call finally resolves -- must not clobber the newer result.
    await act(async () => {
      resolveFirst(mesh);
    });
    expect(result.current.mesh).toEqual(secondMesh);
  });
});
