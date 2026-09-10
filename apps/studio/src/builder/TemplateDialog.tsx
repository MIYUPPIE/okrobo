import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import type { RobotDef } from "../contracts/robotDef";
import { importRobotDef } from "./importRobot";
import { listPackRobots, type PackRobots } from "./packRobots";
import { TEMPLATE_OPTIONS } from "./robotTemplates";

// Build mode's "New Robot" picker (Robot Builder Phase 7), mirroring
// apps/studio/src/dialogs.tsx's OpenDialog shape exactly rather than
// inventing a new modal pattern -- this repo already has one, in active
// use for the project-open flow. Lives here (not in dialogs.tsx) since
// it's a Build-mode-specific concern, matching how worldExamples.ts/
// robotEdits.ts already keep builder-only pieces in this directory.
//
// Robot Builder Phase 8: a second section lists robot-def content found in
// installed packs, reusing this same picker rather than a separate "browse
// packs" screen -- one mental model for "pick a robot to start from."
// Loading is async (two IPC round-trips per installed pack); most packs
// today carry none (only lessons/worlds/URDF-robots exist yet), which is
// an expected, quiet empty state, not an error banner.
//
// Web persistence round (2026-09-10): a third section imports a robot-def
// JSON file (exportRobot.ts's own output, or one handed over by someone
// else) via a plain <input type="file">. This dialog is only ever opened
// from the empty robotDef===null state (App.tsx's single setDialog(
// "new-robot") call site) -- so importing here never risks silently
// clobbering an in-progress robot, the same safety every other row already
// has for free, no extra confirm step needed.

export function TemplateDialog({ onPick, onCancel }: { onPick: (robot: RobotDef) => void; onCancel: () => void }) {
  const [packRobots, setPackRobots] = useState<PackRobots[] | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    listPackRobots()
      .then((result) => {
        if (!cancelled) setPackRobots(result);
      })
      .catch(() => {
        if (!cancelled) setPackRobots([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleFileChosen = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file name after an error
    if (!file) return;
    try {
      const robot = await importRobotDef(file);
      setImportError(null);
      onPick(robot);
    } catch (error) {
      setImportError(`Couldn't import that file: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

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

        <h4 className="template-section-header">From your packs</h4>
        {packRobots === null ? (
          <p className="dialog-empty">Loading…</p>
        ) : packRobots.length === 0 ? (
          <p className="dialog-empty">No installed packs carry a built robot yet.</p>
        ) : (
          <ul className="project-list">
            {packRobots.map(({ pack, robots }) =>
              robots.map((robot, index) => (
                <li key={`${pack.id}:${index}`}>
                  <button className="project-row template-row" onClick={() => onPick(robot.make())}>
                    <span className="project-name">{robot.label}</span>
                    <span className="template-description">from {pack.name}</span>
                  </button>
                </li>
              )),
            )}
          </ul>
        )}

        <h4 className="template-section-header">From a file</h4>
        <ul className="project-list">
          <li>
            <button
              type="button"
              className="project-row template-row"
              onClick={() => fileInputRef.current?.click()}
            >
              <span className="project-name">Import a robot file…</span>
              <span className="template-description">Load a .robot-def.json file (from Export, or shared by someone else)</span>
            </button>
          </li>
        </ul>
        {importError && <p className="dialog-empty error">{importError}</p>}
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          aria-label="import robot file"
          style={{ display: "none" }}
          onChange={(e) => void handleFileChosen(e)}
        />

        <div className="dialog-actions">
          <button onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
