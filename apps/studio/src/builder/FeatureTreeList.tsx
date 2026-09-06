import type { Feature, Profile } from "../contracts/robotDef";

// Build mode's read-only feature-tree panel (Robot Builder CAD Kernel Phase
// 7.1) -- renders a cad_mesh body's own ordered Feature[] construction
// history (see docs/decisions/cad-kernel-feature-tree-data-model.md), one
// row per step in the order it was applied. No interaction this sub-phase:
// nothing here is clickable, editable, or reorderable -- that's CAD Kernel
// Phase 7.3/7.4's job. Renders nothing for an absent/empty list, so a body
// with no recorded history (every non-CAD body, or a cad_mesh predating
// this phase) looks exactly like it did before this panel existed.

const round = (n: number) => Math.round(n * 1000) / 1000;

function profileLabel(profile: Profile): string {
  return profile.type === "rectangle" ? `${round(profile.width)}×${round(profile.height)}m rect` : `${round(profile.radius)}m radius circle`;
}

/** One short, human line per Feature kind -- mirrors the exact display
 * names Build mode's own toolbar/creators already use for each operation
 * (e.g. "Boundary" for a `loft`, "Extruded"/"Revolved"/"Boundary" for a
 * cut's own tool kind) so this list reads as a plain history of the same
 * tools the student already clicked, not a second vocabulary. */
function featureLabel(feature: Feature): string {
  switch (feature.operation) {
    case "extrude":
      return `Extrude (${profileLabel(feature.profile)}, depth ${round(feature.depth)}m)`;
    case "revolve":
      return `Revolve (${profileLabel(feature.profile)}, offset ${round(feature.offset)}m, ${round(feature.angle_deg)}°)`;
    case "loft":
      return `Boundary (${profileLabel(feature.start_profile)} → ${profileLabel(feature.end_profile)}, height ${round(feature.height)}m)`;
    case "box":
      return `Box (${feature.size.map(round).join(" × ")} m)`;
    case "cylinder":
      return `Cylinder (radius ${round(feature.radius)}m, length ${round(feature.length)}m)`;
    case "cut": {
      const toolLabel = feature.tool.operation === "extrude" ? "Extruded" : feature.tool.operation === "revolve" ? "Revolved" : "Boundary";
      return `Cut (${toolLabel})`;
    }
    case "fillet_chamfer": {
      const filletCount = feature.picks.filter((p) => p.operation === "fillet").length;
      const chamferCount = feature.picks.filter((p) => p.operation === "chamfer").length;
      const parts = [filletCount > 0 && `${filletCount} fillet${filletCount === 1 ? "" : "s"}`, chamferCount > 0 && `${chamferCount} chamfer${chamferCount === 1 ? "" : "s"}`].filter(
        Boolean,
      );
      return `Fillet/Chamfer (${parts.join(", ")})`;
    }
    case "shell":
      return `Shell (${feature.picks.length} face${feature.picks.length === 1 ? "" : "s"}, thickness ${round(feature.thickness)}m)`;
    case "draft":
      return `Draft (${feature.picks.length} face${feature.picks.length === 1 ? "" : "s"}, angle ${round(feature.angle_deg)}°)`;
  }
}

export interface FeatureTreeListProps {
  features: Feature[] | undefined;
}

export function FeatureTreeList({ features }: FeatureTreeListProps) {
  if (!features || features.length === 0) return null;

  return (
    <section className="inspector-section feature-tree-list">
      <h5>Construction history</h5>
      <ol>
        {features.map((feature, index) => (
          <li key={index}>{featureLabel(feature)}</li>
        ))}
      </ol>
    </section>
  );
}
