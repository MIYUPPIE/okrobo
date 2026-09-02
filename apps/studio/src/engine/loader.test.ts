// Regression guard for the bug that broke `npm run dev` (and `tauri dev`)
// from Phase 1 to Phase 5: the generated engine lived in public/ and was
// imported as an ES module. Vite serves public/ files as static assets and
// refuses to transform them as modules, so the dev server failed with
// "This file is in /public ... should not be imported from source code"
// while the production build (which copies public/ verbatim) worked fine.
//
// Two invariants keep it from coming back: the engine resolves through the
// app's own loader, and no JavaScript module ever sits in public/.

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadEngine } from "./loader";

const PUBLIC_DIR = new URL("../../public", import.meta.url).pathname;

function filesUnder(dir: string): string[] {
  // public/ holds only generated content (Blockly's media), so on a fresh
  // clone it does not exist yet — which trivially satisfies this guard.
  if (!existsSync(dir)) return [];
  let found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found = found.concat(filesUnder(full));
    else found.push(full);
  }
  return found;
}

describe("engine loader", () => {
  it("loads the engine through the app's own module path", async () => {
    const module = await loadEngine();
    // A real instance: create a world and read back its contract state.
    const world = module._world_create(2, 2, 0.1, 0.12, 1, 1, 0);
    expect(module._world_x(world)).toBeCloseTo(1, 9);
    expect(module._world_distance(world)).toBeCloseTo(0.9, 9);
    module._world_destroy(world);
  });

  it("keeps JavaScript modules out of public/ (they break the dev server)", () => {
    const offenders = filesUnder(PUBLIC_DIR).filter((f) => /\.(js|mjs|cjs|ts)$/.test(f));
    expect(offenders).toEqual([]);
  });
});
