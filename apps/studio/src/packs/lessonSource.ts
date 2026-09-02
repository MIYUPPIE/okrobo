// Lessons shipped inside the app (the core pack). They are bundled at build
// time so the studio has content on first launch with no network and no
// filesystem access — the offline-by-default rule. Downloaded packs add more
// lessons at runtime through the pack store (Tauri side).

import { type Lesson, parseLesson } from "./lesson";

const sources = import.meta.glob("../../../../packs/core/lessons/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export interface LoadedLesson extends Lesson {
  /** Pack-relative file name, used as a stable key. */
  file: string;
  pack: string;
}

export function bundledLessons(): LoadedLesson[] {
  return Object.entries(sources)
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([path, source]) => {
      try {
        return [{ ...parseLesson(source), file: path.split("/").pop() ?? path, pack: "core" }];
      } catch (error) {
        // A malformed lesson must never take the studio down with it.
        console.error(`skipping lesson ${path}:`, error);
        return [];
      }
    });
}
