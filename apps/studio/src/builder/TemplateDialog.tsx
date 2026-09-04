import type { RobotDef } from "../contracts/robotDef";
import { TEMPLATE_OPTIONS } from "./robotTemplates";

// Build mode's "New Robot" picker (Robot Builder Phase 7), mirroring
// apps/studio/src/dialogs.tsx's OpenDialog shape exactly rather than
// inventing a new modal pattern -- this repo already has one, in active
// use for the project-open flow. Lives here (not in dialogs.tsx) since
// it's a Build-mode-specific concern, matching how worldExamples.ts/
// robotEdits.ts already keep builder-only pieces in this directory.

export function TemplateDialog({ onPick, onCancel }: { onPick: (robot: RobotDef) => void; onCancel: () => void }) {
  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <div className="dialog dialog-wide" onClick={(e) => e.stopPropagation()}>
        <h3>New robot</h3>
        <ul className="project-list">
          {TEMPLATE_OPTIONS.map((template) => (
            <li key={template.id}>
              <button className="project-row template-row" onClick={() => onPick(template.make())}>
                <span className="project-name">{template.label}</span>
                <span className="template-description">{template.description}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="dialog-actions">
          <button onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
