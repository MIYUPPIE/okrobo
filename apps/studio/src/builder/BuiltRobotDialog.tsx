import { useEffect, useState } from "react";
import type { Issue, RobotDef } from "../contracts/robotDef";
import { listPackRobots, type PackRobots } from "./packRobots";

// Simulate mode's own built-robot picker (Robot Builder B2), mirroring
// apps/studio/src/compete/CompetitionDialog.tsx's own shape exactly -- a
// "current document + installed-pack section" split, same async-load
// posture (loading is two IPC round-trips per installed pack; most packs
// carry none, an expected quiet empty state, not an error).

export interface BuiltRobotDialogProps {
  /** Build mode's own in-progress document, or null if nothing has been
   * built yet this project. */
  currentRobotDef: RobotDef | null;
  /** validateRobotDef(currentRobotDef) -- passed in so this stays a dumb
   * picker with no validation logic of its own. */
  currentIssues: Issue[];
  onPick: (robot: RobotDef) => void;
  onCancel: () => void;
}

export function BuiltRobotDialog({ currentRobotDef, currentIssues, onPick, onCancel }: BuiltRobotDialogProps) {
  const [packRobots, setPackRobots] = useState<PackRobots[] | null>(null);
  const errorCount = currentIssues.filter((i) => i.severity === "error").length;

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

  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <div className="dialog dialog-wide" onClick={(e) => e.stopPropagation()}>
        <h3>Choose a built robot</h3>
        {currentRobotDef ? (
          <ul className="project-list">
            <li>
              <button
                className="project-row template-row"
                disabled={errorCount > 0}
                title={errorCount > 0 ? "Fix the robot's issues in Build mode before simulating it" : undefined}
                onClick={() => onPick(currentRobotDef)}
              >
                <span className="project-name">{currentRobotDef.name}</span>
                <span className="template-description">
                  {errorCount > 0
                    ? `Your current Build-mode robot -- ${errorCount} issue${errorCount === 1 ? "" : "s"} to fix first`
                    : "Your current Build-mode robot"}
                </span>
              </button>
            </li>
          </ul>
        ) : (
          <p className="dialog-empty">No robot in this project yet -- build one first.</p>
        )}

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

        <div className="dialog-actions">
          <button onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
