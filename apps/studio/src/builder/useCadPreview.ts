import { useEffect, useState, type DependencyList } from "react";
import type { CadMesh } from "../cad/cadClient";

// Shared debounce/cancel/status lifecycle for every CAD creation panel's
// live preview (Extrude/Revolve/Boundary -- Robot Builder CAD Kernel
// Phase 3). Extracted from CadExtrudeCreator.tsx's own original inline
// version once Revolve and Boundary needed the identical logic in the same
// phase -- three real call sites landing together, not a hypothetical
// future reuse. See docs/decisions/cad-kernel-revolve-boundary.md.
//
// Generic since CAD Kernel Phase 5 (Fillet + Chamfer): the identical
// debounce/cancel/status lifecycle also drives the edge-overlay preview
// (a ShapeEdgeMesh, not a CadMesh) every fillet/chamfer-capable creator
// needs alongside its existing mesh preview. Defaults to CadMesh so every
// pre-Phase-5 call site keeps compiling unchanged.

export const CAD_PREVIEW_DEBOUNCE_MS = 400;

export type CadPreviewStatus = "idle" | "loading" | "ready" | "error";

export type CadPreviewParseResult<T = CadMesh> = { ok: true; call: () => Promise<T> } | { ok: false; message: string };

export interface UseCadPreviewResult<T = CadMesh> {
  status: CadPreviewStatus;
  error: string;
  mesh: T | null;
}

/** `parse` re-runs on every dep change. A `{ok:false}` result (the
 * degenerate-input guard, e.g. zero width) surfaces its message
 * immediately with no debounce and no worker call. A `{ok:true}` result
 * debounces CAD_PREVIEW_DEBOUNCE_MS before calling `.call()`, discarding a
 * stale in-flight response if deps changed again before it resolved. */
export function useCadPreview<T = CadMesh>(parse: () => CadPreviewParseResult<T>, deps: DependencyList): UseCadPreviewResult<T> {
  const [status, setStatus] = useState<CadPreviewStatus>("idle");
  const [error, setError] = useState("");
  const [mesh, setMesh] = useState<T | null>(null);

  useEffect(() => {
    const parsed = parse();
    if (!parsed.ok) {
      setStatus("error");
      setError(parsed.message);
      setMesh(null);
      return;
    }

    let cancelled = false;
    setStatus("loading");
    const timer = setTimeout(() => {
      parsed
        .call()
        .then((result) => {
          if (cancelled) return;
          setMesh(result);
          setStatus("ready");
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setStatus("error");
          setError(err instanceof Error ? err.message : String(err));
          setMesh(null);
        });
    }, CAD_PREVIEW_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { status, error, mesh };
}
