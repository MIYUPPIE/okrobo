// Test helper: load the real WASM engine (built by scripts/build-engine-wasm.sh)
// through the app's own loader, so tests run against the production sim and
// cover the exact module-loading path the studio uses.

import arenaJson from "@packs/core/worlds/arena.json";
import { EngineArm } from "../engine/EngineArm";
import { EngineDrone } from "../engine/EngineDrone";
import { EngineWorld } from "../engine/EngineWorld";
import { type EngineModule, loadEngine } from "../engine/loader";
import { validateWorld } from "../lib/validateWorld";
import { ProgramRunner } from "./ProgramRunner";

export const ARENA = validateWorld(arenaJson);

let modulePromise: Promise<EngineModule> | null = null;

export function loadTestEngineModule(): Promise<EngineModule> {
  if (!modulePromise) {
    modulePromise = loadEngine().catch(() => {
      throw new Error(
        "WASM engine not built: run ./scripts/build-engine-wasm.sh first (test-all.sh does this)",
      );
    });
  }
  return modulePromise;
}

export async function makeRunner(): Promise<{
  engine: EngineWorld;
  arm: EngineArm;
  drone: EngineDrone;
  runner: ProgramRunner;
}> {
  const module = await loadTestEngineModule();
  const engine = new EngineWorld(module, ARENA);
  const arm = new EngineArm(module);
  const drone = new EngineDrone(module, ARENA);
  return { engine, arm, drone, runner: new ProgramRunner(engine, ARENA.wheel_base, arm, drone) };
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
