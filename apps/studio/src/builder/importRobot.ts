// The reciprocal of exportRobot.ts: loads a robot-def JSON file (produced
// by Export, or handed to a student by someone else) back into Build mode.
// Unlike Export, this needs no desktop/browser split -- a browser can't
// silently write to disk (Export needs a Blob download or a native save
// dialog), but reading a file the student explicitly picked via a plain
// <input type="file"> already works identically inside Tauri's webview, no
// Tauri API involved. See docs/decisions/robot-builder-web-persistence.md.

import { parseRobotDef, type RobotDef } from "../contracts/robotDef";

/** Reads and parses `file` as a contracts/robot-def/v0 JSON document.
 * Rejects with a plain Error on malformed JSON (from JSON.parse) or a
 * well-formed-but-wrong-shape document (from parseRobotDef, e.g. "robot-def:
 * missing id or name") -- both are surfaced to the caller the same way, no
 * validation gate beyond that: an imported robot can carry the same
 * live-fixable issues a hand-built one can, same as loading a project's own
 * robot_def already works (App.tsx's applyProjectRobotDef). */
export async function importRobotDef(file: File): Promise<RobotDef> {
  const text = await file.text();
  const data = JSON.parse(text);
  return parseRobotDef(data);
}
