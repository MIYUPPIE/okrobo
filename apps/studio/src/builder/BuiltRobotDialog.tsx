import { useEffect, useState } from "react";
import type { Issue, RobotDef } from "../contracts/robotDef";
import { listPackRobots, type PackRobots } from "./packRobots";
import { listProjectRobots, type ProjectRobot } from "./projectRobots";

// Simulate mode's own built-robot picker (Robot Builder B2/D2), mirroring
// apps/studio/src/compete/CompetitionDialog.tsx's own shape exactly -- a
// "current document + installed-pack section" split, same async-load
// posture (loading is two IPC round-trips per installed pack; most packs
// carry none, an expected quiet empty state, not an error). A third
// section (D2) reads back a robot saved in one of the student's OTHER
// projects -- the "multiple saved robots" answer this repo already had
// via Save As + Open, once this dialog needed a way to reach one.

export interface BuiltRobotDialogProps {
  /** Build mode's own in-progress document, or null if nothing has been
   * built yet this project. */
  currentRobotDef: RobotDef | null;
  /** validateRobotDef(currentRobotDef) -- passed in so this stays a dumb
   * picker with no validation logic of its own. */
  currentIssues: Issue[];
  /** The currently-open project's own id, if any -- excluded from the
   * "saved projects" section below since it's already covered by the
   * "current robot" row above. */
  currentProjectId?: string;
  onPick: (robot: RobotDef) => void;
  onCancel: () => void;
}

export function BuiltRobotDialog({ currentRobotDef, currentIssues, currentProjectId, onPick, onCancel }: BuiltRobotDialogProps) {
  const [packRobots, setPackRobots] = useState<PackRobots[] | null>(null);
  const [projectRobots, setProjectRobots] = useState<ProjectRobot[] | null>(null);
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

  useEffect(() => {
    let cancelled = false;
    listProjectRobots(currentProjectId)
      .then((result) => {
        if (!cancelled) setProjectRobots(result);
      })
      .catch(() => {
        if (!cancelled) setProjectRobots([]);
      });
    return () => {
      cancelled = true;
    };
  }, [currentProjectId]);

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

        <h4 className="template-section-header">From your saved projects</h4>
        {projectRobots === null ? (
          <p className="dialog-empty">Loading…</p>
        ) : projectRobots.length === 0 ? (
          <p className="dialog-empty">No other saved project carries a robot yet.</p>
        ) : (
          <ul className="project-list">
            {projectRobots.map((entry) => (
              <li key={entry.project.id}>
                <button className="project-row template-row" onClick={() => onPick(entry.make())}>
                  <span className="project-name">{entry.label}</span>
                  <span className="template-description">from "{entry.project.name}"</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="dialog-actions">
          <button onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
