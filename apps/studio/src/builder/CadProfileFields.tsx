import type { Profile } from "../cad/cadClient";

// Shared by every CAD creation panel that authors a Rectangle/Circle
// profile (Extrude/Revolve/Boundary's own two profiles, and Phase 4's
// three Cut variants) -- extracted once the width/height-or-radius field
// block and its parse logic were about to be written a 5th and 6th time.
// Deliberately does NOT own the Shape <select> or its surrounding
// <section>: callers lay those out differently (Extrude/Revolve give
// Profile and Dimensions their own separate sections; Boundary merges
// shape+dims into one section per side), and neither is worth forcing into
// a shared shape at the cost of already-shipped aria-label/markup
// differences. See docs/decisions/cad-kernel-cut-operations.md.

export type ProfileShape = "rectangle" | "circle";

export interface ProfileDraft {
  shape: ProfileShape;
  width: string;
  height: string;
  radius: string;
}

export function positiveNumber(raw: string, label: string): { ok: true; value: number } | { ok: false; message: string } {
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value) || value <= 0) return { ok: false, message: `${label} must be greater than 0` };
  return { ok: true, value };
}

export type ProfileParseResult = { ok: true; value: Profile } | { ok: false; message: string };

/** Validated locally, before ever calling the CAD worker -- OpenCascade
 * throws on degenerate input (e.g. zero width). `labelPrefix` (e.g.
 * "Start"/"End") distinguishes which profile failed when a creator has
 * more than one (Boundary, producing "Start width"/"Start radius" --
 * lowercase field name after the prefix); omitted for a single-profile
 * creator (Extrude/Revolve/the single-profile Cut variants), matching
 * their own plain, capitalized "Width"/"Radius" error messages. */
export function parseProfileDraft(draft: ProfileDraft, labelPrefix?: string): ProfileParseResult {
  const label = (capitalized: string, lowercase: string) => (labelPrefix ? `${labelPrefix} ${lowercase}` : capitalized);
  if (draft.shape === "rectangle") {
    const width = positiveNumber(draft.width, label("Width", "width"));
    if (!width.ok) return width;
    const height = positiveNumber(draft.height, label("Height", "height"));
    if (!height.ok) return height;
    return { ok: true, value: { type: "rectangle", width: width.value, height: height.value } };
  }
  const radius = positiveNumber(draft.radius, label("Radius", "radius"));
  if (!radius.ok) return radius;
  return { ok: true, value: { type: "circle", radius: radius.value } };
}

export interface CadProfileDimensionFieldsProps {
  /** aria-label prefix for the width/height/radius inputs, e.g. "cad" ->
   * "cad width"/"cad height"/"cad radius", or "cad start" -> "cad start
   * width" for Boundary's own Start/End profiles. */
  ariaPrefix: string;
  draft: ProfileDraft;
  onChange: (next: ProfileDraft) => void;
}

/** Just the width/height-or-radius input pair matching the profile's own
 * shape. */
export function CadProfileDimensionFields({ ariaPrefix, draft, onChange }: CadProfileDimensionFieldsProps) {
  const setField = <K extends keyof ProfileDraft>(key: K, value: ProfileDraft[K]) => onChange({ ...draft, [key]: value });
  return draft.shape === "rectangle" ? (
    <>
      <label>
        Width
        <input
          aria-label={`${ariaPrefix} width`}
          type="number"
          step="0.01"
          min="0"
          value={draft.width}
          onChange={(e) => setField("width", e.target.value)}
        />
      </label>
      <label>
        Height
        <input
          aria-label={`${ariaPrefix} height`}
          type="number"
          step="0.01"
          min="0"
          value={draft.height}
          onChange={(e) => setField("height", e.target.value)}
        />
      </label>
    </>
  ) : (
    <label>
      Radius
      <input
        aria-label={`${ariaPrefix} radius`}
        type="number"
        step="0.01"
        min="0"
        value={draft.radius}
        onChange={(e) => setField("radius", e.target.value)}
      />
    </label>
  );
}
