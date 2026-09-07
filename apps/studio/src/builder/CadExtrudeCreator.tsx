import { useEffect, useMemo, useState } from "react";
import type { Body, Feature, RobotDef } from "../contracts/robotDef";
import type { CadEdgeOverlay, CadPreview, ShapeEdgeMesh } from "../cad/cadClient";
import { extrudeCircle, extrudeRectangle, fillet, previewEdges, replayFeatures } from "../cad/cadClient";
import { CadProfileDimensionFields, parseProfileDraft, positiveNumber, profileDraftFrom, type ProfileDraft, type ProfileShape } from "./CadProfileFields";
import { FilletEdgeList } from "./FilletEdgeList";
import { filletChamferFeatureFromPicks, parseFilletPicks, type FilletPickDraft } from "./filletPicks";
import { makeCadBody, nextBodyId } from "./robotEdits";
import { useCadPreview } from "./useCadPreview";

// Build mode's CAD part creation panel (Robot Builder CAD Kernel Phase 2:
// Sketch UI) -- shown in the inspector slot in place of BodyInspector while
// the "Extrude" tool is active (see BuilderPanel.tsx). Same draft/
// live-validate/Apply idiom BodyInspector.tsx/JointCreator.tsx already
// established, except "live-validate" is an async, debounced call into the
// real CAD kernel (through cadClient.ts's Worker) instead of a synchronous
// validateRobotDef diff -- OpenCascade genuinely computes a solid and meshes
// it, it doesn't just check field shapes. Two profiles only (Rectangle,
// Circle), matching exactly what the kernel supports; the user chose this
// parametric-dimensions form over a freeform 2D sketch canvas (no such
// canvas exists anywhere in this codebase). See
// docs/decisions/cad-kernel-sketch-ui.md. Profile fields (shape dropdown +
// width/height-or-radius) share their parse logic and dimension inputs
// with Revolve/Boundary/the Cut creators via ./CadProfileFields.tsx.

interface Draft {
  profile: ProfileDraft;
  depth: string;
}

const initialDraft: Draft = { profile: { shape: "rectangle", width: "0.05", height: "0.05", radius: "0.025" }, depth: "0.02" };

interface ParsedDraft {
  profile: { type: "rectangle"; width: number; height: number } | { type: "circle"; radius: number };
  depth: number;
}
type ParseResult = { ok: true; value: ParsedDraft } | { ok: false; message: string };

/** Validated locally, before ever calling the CAD worker -- OpenCascade
 * throws on degenerate input (e.g. zero width), so this both gives instant
 * feedback and avoids a wasted worker round-trip. */
function parseDraft(draft: Draft): ParseResult {
  const profile = parseProfileDraft(draft.profile);
  if (!profile.ok) return profile;
  const depth = positiveNumber(draft.depth, "Depth");
  if (!depth.ok) return depth;
  return { ok: true, value: { profile: profile.value, depth: depth.value } };
}

export interface CadExtrudeCreatorProps {
  robot: RobotDef;
  /** Positioning anchor -- the same `near` BuilderPanel's own addBody
   * already computes (selectedBody ?? last body ?? null). */
  near: Body | null;
  /** Called only once a real mesh is ready. The new id is exposed
   * explicitly (not left as "last item in bodies") since BuilderPanel
   * needs it to select the new body, mirroring "+ Add body"'s own
   * select-on-create UX. */
  onApply: (nextRobot: RobotDef, newBodyId: string) => void;
  onCancel: () => void;
  /** Fired on every settled debounce tick with the current live preview
   * (or null while invalid/erroring) plus the exact position the body will
   * land at -- BuilderViewport reads this back through BuilderPanel. */
  onPreviewChange: (preview: CadPreview | null) => void;
  /** CAD Kernel Phase 5 (Fillet + Chamfer): the edges picked so far on
   * this creator's own fresh shape, lifted to BuilderPanel the same way
   * cadPreview is -- see docs/decisions/cad-kernel-fillet-chamfer.md. */
  edgePicks: FilletPickDraft[];
  onEdgePicksChange: (next: FilletPickDraft[]) => void;
  onEdgeOverlayChange: (overlay: CadEdgeOverlay | null) => void;
  /** CAD Kernel Phase 7.3 (edit-any-step): when set, this creator is
   * editing an EXISTING recorded extrude root feature at `stepIndex` of
   * `allFeatures` (`targetBodyId`'s own body), not creating a new one --
   * draft state seeds from `feature`'s own params, the embedded Fillet/
   * Chamfer section is hidden (editing this step alone never adds a
   * second one -- that's still only ever authored fresh, via this same
   * creator's own create-mode Apply), the live preview replays the WHOLE
   * chain via the executor (`allFeatures` with this step replaced) rather
   * than just this step in isolation -- any step after it (a fillet,
   * shell, draft, cut...) still applies on top, so what's previewed here
   * is what Apply will actually produce, not a misleading isolated shape
   * -- and Apply calls `onApply` with the freshly parsed Feature instead
   * of creating a new body. See docs/decisions/cad-kernel-edit-any-step.md. */
  editing?: {
    feature: Extract<Feature, { operation: "extrude" }>;
    stepIndex: number;
    allFeatures: Feature[];
    targetBodyId: string;
    onApply: (nextFeature: Feature) => void;
  };
}

export function CadExtrudeCreator({ robot, near, onApply, onCancel, onPreviewChange, edgePicks, onEdgePicksChange, onEdgeOverlayChange, editing }: CadExtrudeCreatorProps) {
  const bodyId = useMemo(() => nextBodyId(robot), [robot]);
  const [draft, setDraft] = useState<Draft>(() => (editing ? { profile: profileDraftFrom(editing.feature.profile), depth: String(editing.feature.depth) } : initialDraft));
  const setProfile = (profile: ProfileDraft) => setDraft((d) => ({ ...d, profile }));

  const { status, error, mesh } = useCadPreview(() => {
    const parsed = parseDraft(draft);
    if (!parsed.ok) return parsed;
    const rootFeature: Feature = { operation: "extrude", profile: parsed.value.profile, depth: parsed.value.depth };
    if (editing) {
      const nextFeatures = editing.allFeatures.map((f, i) => (i === editing.stepIndex ? rootFeature : f));
      return { ok: true, call: () => replayFeatures(nextFeatures).then((r) => r.mesh) };
    }
    if (edgePicks.length === 0) {
      const call = () =>
        parsed.value.profile.type === "rectangle"
          ? extrudeRectangle({ width: parsed.value.profile.width, height: parsed.value.profile.height, depth: parsed.value.depth })
          : extrudeCircle({ radius: parsed.value.profile.radius, depth: parsed.value.depth });
      return { ok: true, call };
    }
    const picks = parseFilletPicks(edgePicks);
    if (!picks.ok) return picks;
    const shape = { operation: "extrude" as const, profile: parsed.value.profile, depth: parsed.value.depth };
    return { ok: true, call: () => fillet(shape, picks.value) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.profile, draft.depth, edgePicks, editing]);

  // Only reacts on a real settle (ready/error) -- skips "loading" so the
  // previous preview stays visible during a recompute instead of flickering
  // to nothing on every keystroke. Editing an existing step previews at the
  // target's own current position/rotation instead of a fresh `near`-relative
  // placement.
  useEffect(() => {
    if (status === "ready" && mesh) {
      if (editing) {
        const targetBody = robot.bodies.find((b) => b.id === editing.targetBodyId);
        if (targetBody) onPreviewChange({ mesh, position: targetBody.transform.position, rotation: targetBody.transform.rotation_rpy });
      } else {
        const body = makeCadBody(bodyId, near, mesh, []);
        onPreviewChange({ mesh, position: body.transform.position });
      }
    } else if (status === "error") {
      onPreviewChange(null);
    }
  }, [status, mesh, bodyId, near, onPreviewChange, editing, robot]);

  // CAD Kernel Phase 5: a second, independent preview -- this shape's own
  // pickable edges, recomputed only from the profile/dims (never from
  // edgePicks, so picking an edge never itself triggers a rebuild of the
  // overlay it's picked from). Never computed while editing an existing
  // step -- that mode never shows the embedded Fillet/Chamfer section.
  const edgesPreview = useCadPreview<ShapeEdgeMesh>(() => {
    if (editing) return { ok: false, message: "" };
    const parsed = parseDraft(draft);
    if (!parsed.ok) return parsed;
    const shape = { operation: "extrude" as const, profile: parsed.value.profile, depth: parsed.value.depth };
    return { ok: true, call: () => previewEdges(shape) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.profile, draft.depth, editing]);

  useEffect(() => {
    if (edgesPreview.status === "ready" && edgesPreview.mesh) {
      const body = makeCadBody(bodyId, near, { vertices: [], faces: [] }, []);
      onEdgeOverlayChange({ edgeMesh: edgesPreview.mesh, position: body.transform.position, rotation: [0, 0, 0] });
    } else if (edgesPreview.status === "error") {
      onEdgeOverlayChange(null);
    }
  }, [edgesPreview.status, edgesPreview.mesh, bodyId, near, onEdgeOverlayChange]);

  // Dimensions aren't locked behind a toggle -- changing them just clears
  // any picks (a stale pick's descriptor point won't match any edge of the
  // new shape anyway; this keeps the visible list/overlay in sync with
  // that, rather than leaving stale rows around).
  useEffect(() => {
    onEdgePicksChange([]);
    onEdgeOverlayChange(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.profile, draft.depth]);

  const apply = () => {
    if (status !== "ready" || !mesh) return;
    const parsed = parseDraft(draft);
    if (!parsed.ok) return;
    const rootFeature: Feature = { operation: "extrude", profile: parsed.value.profile, depth: parsed.value.depth };
    if (editing) {
      editing.onApply(rootFeature);
      return;
    }
    const picks = parseFilletPicks(edgePicks);
    const features: Feature[] = picks.ok && picks.value.length > 0 ? [rootFeature, filletChamferFeatureFromPicks(picks.value, 0)] : [rootFeature];
    const body = makeCadBody(bodyId, near, mesh, features);
    onApply({ ...robot, bodies: [...robot.bodies, body] }, body.id);
  };

  return (
    <div className="body-inspector cad-extrude-creator">
      <h4>{editing ? "Edit Extrude" : "New CAD part"}</h4>

      <section className="inspector-section">
        <h5>Profile</h5>
        <label>
          Shape
          <select aria-label="cad profile" value={draft.profile.shape} onChange={(e) => setProfile({ ...draft.profile, shape: e.target.value as ProfileShape })}>
            <option value="rectangle">Rectangle</option>
            <option value="circle">Circle</option>
          </select>
        </label>
      </section>

      <section className="inspector-section">
        <h5>Dimensions (m)</h5>
        <div className="inspector-grid">
          <CadProfileDimensionFields ariaPrefix="cad" draft={draft.profile} onChange={setProfile} />
          <label>
            Depth
            <input
              aria-label="cad depth"
              type="number"
              step="0.01"
              min="0"
              value={draft.depth}
              onChange={(e) => setDraft((d) => ({ ...d, depth: e.target.value }))}
            />
          </label>
        </div>
      </section>

      {!editing && edgesPreview.status === "ready" && <FilletEdgeList edgeMesh={edgesPreview.mesh} picks={edgePicks} onChange={onEdgePicksChange} />}

      {status === "loading" && <p className="cad-status">computing…</p>}
      {status === "error" && <p className="cad-status error">{error}</p>}

      <div className="inspector-actions">
        <button type="button" className="primary" onClick={apply} disabled={status !== "ready"}>
          Apply
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
