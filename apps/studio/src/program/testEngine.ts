// Test helper: load the real WASM engine (built by scripts/build-engine-wasm.sh)
// so program tests run against the production sim, not a mock.

import arenaJson from "@packs/core/worlds/arena.json";
import { EngineArm } from "../engine/EngineArm";
import { EngineWorld } from "../engine/EngineWorld";
import type { EngineModule } from "../engine/loader";
import { validateWorld } from "../lib/validateWorld";
import { ProgramRunner } from "./ProgramRunner";

export const ARENA = validateWorld(arenaJson);

let modulePromise: Promise<EngineModule> | null = null;

export function loadTestEngineModule(): Promise<EngineModule> {
  if (!modulePromise) {
    const enginePath = new URL("../../public/engine/okrobo_engine.js", import.meta.url).pathname;
    modulePromise = import(/* @vite-ignore */ enginePath).then(
      (m: { default: () => Promise<EngineModule> }) => m.default(),
      () => {
        throw new Error(
          "WASM engine not built: run ./scripts/build-engine-wasm.sh first (test-all.sh does this)",
        );
      },
    );
  }
  return modulePromise;
}

export async function makeRunner(): Promise<{
  engine: EngineWorld;
  arm: EngineArm;
  runner: ProgramRunner;
}> {
  const module = await loadTestEngineModule();
  const engine = new EngineWorld(module, ARENA);
  const arm = new EngineArm(module);
  return { engine, arm, runner: new ProgramRunner(engine, ARENA.wheel_base, arm) };
}

/** Drive runner ticks until `done.value`, yielding so program promises settle. */
export async function driveUntil(
  runner: ProgramRunner,
  done: { value: boolean },
  onIteration?: () => void,
  maxIterations = 5000,
): Promise<void> {
  for (let i = 0; i < maxIterations; i++) {
    if (done.value) return;
    runner.tick(50);
    onIteration?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("program did not finish within the iteration budget");
}
