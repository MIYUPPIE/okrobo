// Competitions shipped inside the app (the core pack). Bundled at build time
// so the studio has content on first launch with no network and no
// filesystem access -- the same offline-by-default rule
// apps/studio/src/packs/lessonSource.ts already follows for lessons.
// Downloaded packs add more competitions at runtime through packCompetitions.ts.

import { parseCompetitionDef, type CompetitionDef } from "./competitionDef";

const sources = import.meta.glob("../../../../packs/core/competitions/*.json", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export interface BundledCompetition {
  /** Pack-relative file name, used as a stable key. */
  file: string;
  label: string;
  make: () => CompetitionDef;
}

export function bundledCompetitions(): BundledCompetition[] {
  return Object.entries(sources)
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([path, source]) => {
      try {
        const competition = parseCompetitionDef(JSON.parse(source));
        return [{ file: path.split("/").pop() ?? path, label: competition.name, make: () => parseCompetitionDef(JSON.parse(source)) }];
      } catch (error) {
        // A malformed competition must never take the studio down with it.
        console.error(`skipping competition ${path}:`, error);
        return [];
      }
    });
}
