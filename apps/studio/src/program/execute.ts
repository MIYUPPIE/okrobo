import type { RobotApi } from "./ProgramRunner";

// Compiles generated program code (from the Blockly JS generator) into an
// async function and runs it with `robot` in scope. Every robot call and
// every loop iteration awaits, so the ProgramRunner can interleave engine
// stepping and Stop can interrupt at any await point.

type ProgramFn = (robot: RobotApi) => Promise<void>;

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
  ...args: string[]
) => ProgramFn;

export function runProgram(code: string, robot: RobotApi): Promise<void> {
  const fn = new AsyncFunction("robot", `"use strict";\n${code}`);
  return fn(robot);
}
