// Reads contracts/competition/v0 documents back out of installed packs --
// the same two-IPC-round-trip shape apps/studio/src/builder/packRobots.ts
// already established: read_pack_file(id, "pack.json") to find out what
// competitions it declares, then read_pack_file(id, path) for each one.

import { parseCompetitionDef, type CompetitionDef } from "./competitionDef";
import { validateManifest } from "../packs/manifest";
import { type InstalledPack, listPacks, readPackFile } from "../projects/api";

export interface PackCompetition {
  label: string;
  make: () => CompetitionDef;
}

export interface PackCompetitions {
  pack: InstalledPack;
  competitions: PackCompetition[];
}

function decodeUtf8(bytes: number[]): string {
  return new TextDecoder().decode(new Uint8Array(bytes));
}

async function competitionsForPack(pack: InstalledPack): Promise<PackCompetition[]> {
  let manifest;
  try {
    const bytes = await readPackFile(pack.id, "pack.json");
    manifest = validateManifest(JSON.parse(decodeUtf8(bytes)));
  } catch (error) {
    console.error(`pack '${pack.id}': failed to read its manifest, skipping`, error);
    return [];
  }

  const competitions: PackCompetition[] = [];
  for (const path of manifest.contents.competitions) {
    try {
      const bytes = await readPackFile(pack.id, path);
      const text = decodeUtf8(bytes);
      // Parsed once here just to read the label; make() re-parses so each
      // call returns a fresh document, matching packRobots.ts's own
      // reasoning (and robotTemplates.ts/worldExamples.ts before it) --
      // never sharing one mutable instance across picks.
      const competition = parseCompetitionDef(JSON.parse(text));
      competitions.push({ label: competition.name, make: () => parseCompetitionDef(JSON.parse(text)) });
    } catch (error) {
      // One corrupt file in one pack should not blank the whole picker.
      console.error(`pack '${pack.id}': failed to load competition '${path}', skipping`, error);
    }
  }
  return competitions;
}

/** Every installed pack that carries at least one competition -- most packs
 * carry none (an expected, common result, not an error). */
export async function listPackCompetitions(): Promise<PackCompetitions[]> {
  const packs = await listPacks();
  const results: PackCompetitions[] = [];
  for (const pack of packs) {
    const competitions = await competitionsForPack(pack);
    if (competitions.length > 0) results.push({ pack, competitions });
  }
  return results;
}
