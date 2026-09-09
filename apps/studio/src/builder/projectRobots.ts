// Reads contracts/robot-def/v0 documents back out of the student's OWN
// saved projects (Robot Builder D2) -- the "multiple saved robots" answer
// this repo already had, once BuiltRobotDialog needed a way to reach one
// that isn't the currently-open project. Mirrors packRobots.ts's own
// shape exactly, one IPC round trip per project (loadProject already
// returns the full payload, unlike packs' own two-step manifest-then-file
// read). Project files are untrusted data on disk (same posture
// App.tsx's own applyProjectRobotDef already takes) -- parseRobotDef is
// never skipped just because ProjectPayload's own TS type already says
// `RobotDef | null`.

import { parseRobotDef, type RobotDef } from "../contracts/robotDef";
import { listProjects, loadProject, type ProjectMeta } from "../projects/api";

export interface ProjectRobot {
  project: ProjectMeta;
  label: string;
  /** Re-parses a fresh document each call -- the same "never share one
   * mutable instance across picks" convention every other robot source
   * (packRobots.ts, robotTemplates.ts) already follows. */
  make: () => RobotDef;
}

/** Every saved project that carries a robot-def, excluding `excludeProjectId`
 * (the currently-open project -- already covered by BuiltRobotDialog's own
 * "current robot" row, so listing it again here would be a confusing
 * duplicate). Most projects carry no robot at all, an expected, common
 * result, not an error; one corrupt project is skipped, logged, and never
 * blanks the rest of the list -- the same resilience packRobots.ts's own
 * robotsForPack already established. */
export async function listProjectRobots(excludeProjectId?: string): Promise<ProjectRobot[]> {
  const metas = await listProjects();
  const results: ProjectRobot[] = [];
  for (const meta of metas) {
    if (meta.id === excludeProjectId) continue;
    try {
      const [, payload] = await loadProject(meta.id);
      if (!payload.robot_def) continue;
      const source = payload.robot_def;
      const robot = parseRobotDef(source);
      results.push({ project: meta, label: robot.name, make: () => parseRobotDef(source) });
    } catch (error) {
      console.error(`project '${meta.id}': failed to load its robot, skipping`, error);
    }
  }
  return results;
}
