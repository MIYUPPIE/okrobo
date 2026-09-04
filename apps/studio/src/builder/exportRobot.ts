// Exports a Build-mode robot as a standalone contracts/robot-def/v0 JSON
// file (Robot Builder Phase 8) -- the simplest, most shareable unit (email
// it, USB stick, drop it into a pack's robot_defs/ later). Two mechanisms,
// since this app runs both as a plain web app and as the Tauri desktop
// shell: neither had any existing file-save/download code to reuse (no
// Blob+<a download> anywhere in this repo, no save-dialog plugin before
// this phase) -- see docs/decisions/robot-builder-packs.md.

import { exportRobotFile, inDesktop } from "../projects/api";
import { robotDefToJson, type RobotDef } from "../contracts/robotDef";

function fileNameFor(robot: RobotDef): string {
  const stem = robot.id.trim().length > 0 ? robot.id.trim() : "robot";
  return `${stem}.robot-def.json`;
}

function exportInBrowser(robot: RobotDef): void {
  const contents = JSON.stringify(robotDefToJson(robot), null, 2);
  const blob = new Blob([contents], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileNameFor(robot);
  anchor.click();
  URL.revokeObjectURL(url);
}

async function exportOnDesktop(robot: RobotDef): Promise<void> {
  const { save } = await import("@tauri-apps/plugin-dialog");
  const path = await save({
    defaultPath: fileNameFor(robot),
    filters: [{ name: "Robot definition", extensions: ["json"] }],
  });
  if (!path) return; // student cancelled the dialog
  const contents = JSON.stringify(robotDefToJson(robot), null, 2);
  await exportRobotFile(path, contents);
}

/** Saves `robot` as a portable file -- a native "Save As" dialog on
 * desktop, a browser download otherwise. Resolves once the file is
 * written (desktop) or the download was triggered (browser); resolves
 * without writing anything if the student cancels the desktop dialog.
 * `desktop` defaults to the real `inDesktop` -- overridable so tests can
 * exercise both branches without mocking a module-level constant. */
export function exportRobotDef(robot: RobotDef, desktop: boolean = inDesktop): Promise<void> {
  if (desktop) return exportOnDesktop(robot);
  exportInBrowser(robot);
  return Promise.resolve();
}
