import { describe, expect, it } from "vitest";
import { driveUntil, makeRunner } from "./testEngine";

// Arm.grip()/release() against the REAL WASM engine (real MuJoCo once
// released, not a mock) — contract v3. Joint targets mirror
// engine/tests/test_arm_physics.cpp's reach_for_object(): found numerically
// against the default ArmConfig's forward kinematics, ~0.030 m from the
// object's start (0.30, 0, 0.03), comfortably inside the 0.05 m tolerance.

async function reachForObject(runner: Awaited<ReturnType<typeof makeRunner>>["runner"]) {
  const done = { value: false };
  runner.api.armMoveAll([0, 50, -104, -2]).then(() => (done.value = true));
  await driveUntil(runner, done);
}

describe("Arm.grip()/release() (real WASM engine, real MuJoCo physics)", () => {
  it("fails to grip when the tip is far from the object", async () => {
    const { engine, arm, drone, runner } = await makeRunner();
    expect(runner.api.armGrip()).toBe(false);
    expect(runner.api.armHolding()).toBe(false);
    arm.destroy();
    drone.destroy();
    engine.destroy();
  });

  it("grips within tolerance and the object tracks the tip while held", async () => {
    const { engine, arm, drone, runner } = await makeRunner();
    await reachForObject(runner);
    expect(runner.api.armGrip()).toBe(true);
    expect(runner.api.armHolding()).toBe(true);

    const tipBefore = runner.api.armTip();
    const objectBefore = runner.api.armObjectPosition();
    expect(objectBefore[0]).toBeCloseTo(tipBefore[0], 9);
    expect(objectBefore[2]).toBeCloseTo(tipBefore[2], 9);

    // Swing the base while holding: the object must follow, not stay behind.
    const done = { value: false };
    runner.api.armMove(0, 45).then(() => (done.value = true));
    await driveUntil(runner, done);

    expect(runner.api.armHolding()).toBe(true);
    const tipAfter = runner.api.armTip();
    const objectAfter = runner.api.armObjectPosition();
    expect(objectAfter[0]).toBeCloseTo(tipAfter[0], 9);
    expect(objectAfter[1]).toBeCloseTo(tipAfter[1], 9);
    expect(objectAfter[2]).toBeCloseTo(tipAfter[2], 9);
    expect(Math.abs(objectAfter[1])).toBeGreaterThan(0.05); // it actually moved

    arm.destroy();
    drone.destroy();
    engine.destroy();
  });

  it("release() drops the object and it falls and settles under real gravity", async () => {
    const { engine, arm, drone, runner } = await makeRunner();
    await reachForObject(runner);
    expect(runner.api.armGrip()).toBe(true);
    const heldZ = runner.api.armObjectPosition()[2]; // ~0.060

    runner.api.armRelease();
    expect(runner.api.armHolding()).toBe(false);

    runner.tick(150); // 1.5 s: comfortably past the ~0.08 s analytic fall time
    const settled = runner.api.armObjectPosition();

    expect(settled[2]).toBeLessThan(heldZ - 0.01); // it actually fell
    expect(settled[2]).toBeCloseTo(0.03, 1); // rests at the box's half-extent
    expect(settled[0]).toBeCloseTo(0.3, 1); // no lateral drift from a vertical drop
    expect(settled[1]).toBeCloseTo(0.0, 1);

    arm.destroy();
    drone.destroy();
    engine.destroy();
  });

  it("reset() returns the object to its start and clears the hold", async () => {
    const { engine, arm, drone, runner } = await makeRunner();
    await reachForObject(runner);
    runner.api.armGrip();
    runner.api.armRelease();
    runner.tick(150);

    arm.apply({ type: "reset" });
    expect(runner.api.armHolding()).toBe(false);
    const object = runner.api.armObjectPosition();
    expect(object[0]).toBeCloseTo(0.3, 9);
    expect(object[1]).toBeCloseTo(0.0, 9);
    expect(object[2]).toBeCloseTo(0.03, 9);

    arm.destroy();
    drone.destroy();
    engine.destroy();
  });
});
