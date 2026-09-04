// Uses the real compiled WASM module (no mock), mirroring
// EngineBuiltRobot.test.ts's own approach -- scripts/test-all.sh runs
// build-engine-wasm.sh before `npm run test`.

import { describe, expect, it } from "vitest";
import type { RobotDef } from "../contracts/robotDef";
import { EngineBuiltRobot } from "../engine/EngineBuiltRobot";
import { loadEngine } from "../engine/loader";
import { BuiltProgramRunner } from "./BuiltProgramRunner";
import { ProgramStoppedError } from "./ProgramRunner";

const identity = { position: [0, 0, 0] as [number, number, number], rotation_rpy: [0, 0, 0] as [number, number, number] };

/** A base + one hinge-jointed link, one servo actuator, one encoder sensor
 * on the same joint -- mirrors EngineBuiltRobot.test.ts's own minimal
 * actuator fixture, with a sensor added. */
function makeHingeArmDoc(): RobotDef {
  return {
    id: "runner-test",
    name: "Runner Test",
    description: "",
    root_placement: { position: [0, 0, 0.05], rotation_rpy: [0, 0, 0] },
    bodies: [
      {
        id: "base",
        name: "Base",
        transform: identity,
        mass: 0.5,
        inertia: { ixx: 0.01, iyy: 0.01, izz: 0.01 },
        visual: { type: "box", size: [0.1, 0.1, 0.05] },
        collision: { type: "box", size: [0.1, 0.1, 0.05] },
      },
      {
        id: "link1",
        name: "Link 1",
        transform: { position: [0.1, 0, 0], rotation_rpy: [0, 0, 0] },
        mass: 0.1,
        inertia: { ixx: 0.001, iyy: 0.001, izz: 0.001 },
        visual: { type: "box", size: [0.2, 0.04, 0.04] },
        collision: { type: "box", size: [0.2, 0.04, 0.04] },
      },
    ],
    joints: [
      {
        id: "joint1",
        name: "Joint 1",
        type: "hinge",
        parent: "base",
        child: "link1",
        origin: identity,
        axis: [0, 1, 0],
        limits: { lower: -3.14, upper: 3.14 },
        damping: 0.5,
      },
    ],
    actuators: [{ id: "shoulder", name: "Shoulder", type: "servo", target_joint: "joint1" }],
    sensors: [{ id: "shoulder_encoder", name: "Shoulder Encoder", type: "encoder", body: "link1", joint: "joint1", transform: identity }],
  };
}

function tick(runner: BuiltProgramRunner, seconds: number, dt = 0.01): void {
  for (let i = 0; i < Math.round(seconds / dt); i++) runner.tick(dt);
}

describe("BuiltProgramRunner", () => {
  it("set() by actuator id moves the body measurably", async () => {
    const module = await loadEngine();
    const doc = makeHingeArmDoc();
    const built = new EngineBuiltRobot(module, doc);
    const runner = new BuiltProgramRunner(built, doc);

    tick(runner, 1.5); // settle onto the floor, damp the un-actuated joint to rest
    const before = built.bodyPoses()[1];

    runner.api.set("shoulder", 1.5);
    tick(runner, 2.0);
    const after = built.bodyPoses()[1];

    const moved = Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z);
    expect(moved).toBeGreaterThan(0.03);
    built.destroy();
  });

  it("set() throws for an unknown actuator id", async () => {
    const module = await loadEngine();
    const doc = makeHingeArmDoc();
    const built = new EngineBuiltRobot(module, doc);
    const runner = new BuiltProgramRunner(built, doc);
    expect(() => runner.api.set("no-such-actuator", 1)).toThrow(/unknown actuator/);
    built.destroy();
  });

  it("read() by sensor id matches the underlying sensor reading", async () => {
    const module = await loadEngine();
    const doc = makeHingeArmDoc();
    const built = new EngineBuiltRobot(module, doc);
    const runner = new BuiltProgramRunner(built, doc);

    runner.api.set("shoulder", 1.0);
    tick(runner, 1.0);

    const expected = built.sensorReadings().find((r) => r.id === "shoulder_encoder");
    expect(runner.api.read("shoulder_encoder")).toEqual(expected?.values);
    built.destroy();
  });

  it("read() throws for an unknown sensor id", async () => {
    const module = await loadEngine();
    const doc = makeHingeArmDoc();
    const built = new EngineBuiltRobot(module, doc);
    const runner = new BuiltProgramRunner(built, doc);
    expect(() => runner.api.read("no-such-sensor")).toThrow(/unknown sensor/);
    built.destroy();
  });

  it("wait() resolves after roughly the requested simulated time", async () => {
    const module = await loadEngine();
    const doc = makeHingeArmDoc();
    const built = new EngineBuiltRobot(module, doc);
    const runner = new BuiltProgramRunner(built, doc);

    const dt = 0.01;
    const waitPromise = runner.api.wait(0.5);
    let steps = 0;
    while (runner.busy) {
      runner.tick(dt);
      steps += 1;
      if (steps > 1000) throw new Error("wait() never resolved");
    }
    await waitPromise;
    expect(steps).toBe(50); // 0.5s / 0.01s per tick
    built.destroy();
  });

  it("abort() rejects a pending wait with ProgramStoppedError and zeroes every actuator", async () => {
    const module = await loadEngine();
    const doc = makeHingeArmDoc();
    const built = new EngineBuiltRobot(module, doc);
    const runner = new BuiltProgramRunner(built, doc);

    tick(runner, 1.0);
    runner.api.set("shoulder", 1.5); // servo -> MJCF <position>, ctrl is a target angle in radians
    tick(runner, 0.5); // let it move measurably toward the 1.5 rad target

    const midway = built.sensorReadings().find((r) => r.id === "shoulder_encoder")!.values[0];
    expect(Math.abs(midway)).toBeGreaterThan(0.1); // genuinely moved off zero

    const waitPromise = runner.api.wait(5);
    runner.abort();
    await expect(waitPromise).rejects.toBeInstanceOf(ProgramStoppedError);
    expect(runner.busy).toBe(false);

    // abort() zeroes every actuator's ctrl -- for this servo actuator, ctrl=0
    // is a target angle of 0 rad (MJCF <position>'s own semantics, not a
    // generic "freeze in place"), so the joint should settle back near zero
    // rather than continuing toward the 1.5 rad target it had before abort.
    tick(runner, 1.5);
    const settled = built.sensorReadings().find((r) => r.id === "shoulder_encoder")!.values[0];
    expect(Math.abs(settled)).toBeLessThan(0.2);
    built.destroy();
  });

  it("arm() allows a new program to run after a previous abort", async () => {
    const module = await loadEngine();
    const doc = makeHingeArmDoc();
    const built = new EngineBuiltRobot(module, doc);
    const runner = new BuiltProgramRunner(built, doc);

    runner.abort();
    await expect(runner.api.wait(0.1)).rejects.toBeInstanceOf(ProgramStoppedError);

    runner.arm();
    const resumed = runner.api.wait(0.1);
    // Not a fixed tick(runner, 0.1): floating-point drift in the remaining-
    // seconds countdown can leave a sub-epsilon remainder after exactly 10
    // ticks of dt=0.01, same class of issue Math.floor(duration/dt) exists
    // to avoid elsewhere in this codebase (ProgramRunner.move()) -- loop
    // until busy actually clears, like the "resolves after roughly the
    // requested simulated time" case above.
    let steps = 0;
    while (runner.busy) {
      runner.tick(0.01);
      steps += 1;
      if (steps > 1000) throw new Error("wait() never resolved");
    }
    await expect(resumed).resolves.toBeUndefined();
    built.destroy();
  });
});
