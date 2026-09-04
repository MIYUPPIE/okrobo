// Compiles generated program code (from the Blockly JS generator) into an
// async function and runs it with `robot` in scope. Every robot call and
// every loop iteration awaits, so the runner (ProgramRunner, or Robot
// Builder Phase 6's BuiltProgramRunner) can interleave engine stepping and
// Stop can interrupt at any await point. Generic over the `robot` shape --
// this function only ever compiles and calls it, never inspects it -- so
// the same compiler serves both RobotApi (Car/Arm/Drone) and BuiltRobotApi
// (an arbitrary built robot) without change.

type ProgramFn<Api> = (robot: Api) => Promise<void>;

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
  ...args: string[]
) => ProgramFn<unknown>;

export function runProgram<Api>(code: string, robot: Api): Promise<void> {
  const fn = new AsyncFunction("robot", `"use strict";\n${code}`) as ProgramFn<Api>;
  return fn(robot);
}
