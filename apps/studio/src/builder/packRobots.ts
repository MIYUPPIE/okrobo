// Reads contracts/robot-def/v0 documents back out of installed packs
// (Robot Builder Phase 8) -- the read-back half of the gap described in
// docs/decisions/robot-builder-packs.md: install_pack/list_packs already
// worked, but nothing ever opened an installed pack's own files. Two IPC
// round-trips per pack: read_pack_file(id, "pack.json") to find out what
// robot_defs it declares, then read_pack_file(id, path) for each one.

import { parseRobotDef, type RobotDef } from "../contracts/robotDef";
import { validateManifest } from "../packs/manifest";
import { type InstalledPack, listPacks, readPackFile } from "../projects/api";

export interface PackRobot {
  label: string;
  make: () => RobotDef;
}

export interface PackRobots {
  pack: InstalledPack;
  robots: PackRobot[];
}

function decodeUtf8(bytes: number[]): string {
  return new TextDecoder().decode(new Uint8Array(bytes));
}

async function robotsForPack(pack: InstalledPack): Promise<PackRobot[]> {
  let manifest;
  try {
    const bytes = await readPackFile(pack.id, "pack.json");
    manifest = validateManifest(JSON.parse(decodeUtf8(bytes)));
  } catch (error) {
    console.error(`pack '${pack.id}': failed to read its manifest, skipping`, error);
    return [];
  }

  const robots: PackRobot[] = [];
  for (const path of manifest.contents.robot_defs) {
    try {
      const bytes = await readPackFile(pack.id, path);
      const text = decodeUtf8(bytes);
      // Parsed once here just to read the label; make() re-parses so each
      // call returns a fresh document, matching every other template
      // source (robotTemplates.ts, worldExamples.ts) never sharing one
      // mutable instance across picks.
      const robot = parseRobotDef(JSON.parse(text));
      robots.push({ label: robot.name, make: () => parseRobotDef(JSON.parse(text)) });
    } catch (error) {
      // One corrupt file in one pack should not blank the whole picker.
      console.error(`pack '${pack.id}': failed to load robot-def '${path}', skipping`, error);
    }
  }
  return robots;
}

/** Every installed pack that carries at least one robot-def -- most packs
 * carry none today (only lessons/worlds/URDF-robots exist yet), which is
 * an expected, common result, not an error. */
export async function listPackRobots(): Promise<PackRobots[]> {
  const packs = await listPacks();
  const results: PackRobots[] = [];
  for (const pack of packs) {
    const robots = await robotsForPack(pack);
    if (robots.length > 0) results.push({ pack, robots });
  }
  return results;
}
