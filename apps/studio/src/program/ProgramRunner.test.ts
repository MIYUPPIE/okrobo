import { describe, expect, it } from "vitest";
import { ProgramStoppedError } from "./ProgramRunner";
import { makeRunner } from "./testEngine";

describe("ProgramRunner movements (real WASM engine)", () => {
  it("forward moves the exact distance, matching the Python API", async () => {
    const { engine, runner } = await makeRunner();
    const move = runner.api.forward(0.1);
    runner.tick(100);
    await move;
    const state = engine.state();
    expect(state.pose.x).toBeCloseTo(1.1, 9);
    expect(state.pose.y).toBeCloseTo(1.0, 9);
    engine.destroy();
  });

  it("turnLeft lands exactly on the angle via the partial end step", async () => {
    const { engine, runner } = await makeRunner();
    const move = runner.api.turnLeft(90);
    runner.tick(100);
    await move;
    expect(runner.api.heading()).toBeCloseTo(90, 9);
    expect(engine.state().pose.x).toBeCloseTo(1.0, 9);
    engine.destroy();
  });

  it("forward stops early at the wall", async () => {
    // Faced north first: ARENA's own default start (1, 1, 0) has a real
    // obstacle directly ahead along +x since the engine's own obstacle
    // collision fix (a car now physically stops at an obstacle box, not
    // just the outer walls) -- north is clear of both of ARENA's boxes, so
    // this keeps testing the wall specifically, not an obstacle.
    const { engine, runner } = await makeRunner();
    const turn = runner.api.turnLeft(90);
    runner.tick(100);
    await turn;
    const move = runner.api.forward(5.0);
    runner.tick(3000);
    await move;
    expect(engine.state().pose.y).toBeCloseTo(1.9, 9);
    expect(runner.api.distance()).toBeCloseTo(0.0, 9);
    engine.destroy();
  });

  it("forward stops early at an obstacle, same as the outer wall", async () => {
    // ARENA's own red box sits at (1.7, 1.0), directly ahead of the (1, 1,
    // 0) default start -- the engine's real obstacle collision (previously
    // obstacles were visual/scoring-only, see docs/decisions/car-obstacle-
    // collision.md) now stops the car robot_radius short of its nearest
    // edge (1.6), same as it already does at the outer walls. Not
    // asserting `collided` here (mirrors the wall-stop test above, which
    // doesn't either): the flag is instantaneous, true only on a tick that
    // actively re-clamps a still-moving robot (proven directly, driving
    // continuously, by engine/tests/test_world.cpp's own test_obstacle_
    // stop) -- once ProgramRunner has already stopped the wheels here, a
    // resting robot at the exact boundary distance no longer re-clamps
    // every tick, so reading it this late would be checking the wrong
    // moment, not a real behavior question.
    const { engine, runner } = await makeRunner();
    const move = runner.api.forward(5.0);
    runner.tick(3000);
    await move;
    const state = engine.state();
    expect(state.pose.x).toBeCloseTo(1.5, 9);
    expect(state.pose.y).toBeCloseTo(1.0, 9);
    engine.destroy();
  });

  it("wait passes simulation time without moving", async () => {
    const { engine, runner } = await makeRunner();
    const before = engine.state();
    const move = runner.api.wait(0.5);
    runner.tick(60);
    await move;
    const after = engine.state();
    expect(after.tick).toBeGreaterThan(before.tick);
    expect(after.pose.x).toBeCloseTo(before.pose.x, 12);
    engine.destroy();
  });

  it("abort rejects the active movement and stops the wheels", async () => {
    const { engine, runner } = await makeRunner();
    const move = runner.api.forward(1.0);
    runner.tick(10);
    runner.abort();
    await expect(move).rejects.toBeInstanceOf(ProgramStoppedError);
    const stoppedAt = engine.state().pose.x;
    runner.tick(100);
    expect(engine.state().pose.x).toBeCloseTo(stoppedAt, 12);
    engine.destroy();
  });

  it("drone takeoff rises to the hover height, matching the Python API", async () => {
    const { engine, drone, runner } = await makeRunner();
    const move = runner.api.droneTakeoff(); // 0.4 m at 0.1 m/s = 4 s = 400 steps
    runner.tick(450);
    await move;
    expect(drone.state().pose.z).toBeCloseTo(0.4, 9);
    expect(drone.state().pose.x).toBeCloseTo(1.0, 9);
    engine.destroy();
    drone.destroy();
  });

  it("drone land descends exactly to the ground", async () => {
    const { engine, drone, runner } = await makeRunner();
    const takeoff = runner.api.droneTakeoff(0.5); // 5 s = 500 steps
    runner.tick(550);
    await takeoff;
    const land = runner.api.droneLand(); // another 5 s = 500 steps
    runner.tick(550);
    await land;
    expect(drone.state().pose.z).toBeCloseTo(0.0, 9);
    engine.destroy();
    drone.destroy();
  });

  it("drone forward moves the exact distance", async () => {
    const { engine, drone, runner } = await makeRunner();
    const move = runner.api.droneForward(0.2);
    runner.tick(100);
    await move;
    expect(drone.state().pose.x).toBeCloseTo(1.2, 9);
    expect(drone.state().pose.y).toBeCloseTo(1.0, 9);
    engine.destroy();
    drone.destroy();
  });

  it("drone turnRight lands exactly on the angle via the partial end step", async () => {
    const { engine, drone, runner } = await makeRunner();
    const move = runner.api.droneTurnRight(90);
    runner.tick(400);
    await move;
    expect(runner.api.droneHeading()).toBeCloseTo(-90, 6);
    expect(drone.state().pose.x).toBeCloseTo(1.0, 6);
    engine.destroy();
    drone.destroy();
  });

  it("drone forward stops early at the wall, mirroring the car", async () => {
    const { engine, drone, runner } = await makeRunner();
    const move = runner.api.droneForward(5.0);
    runner.tick(3000);
    await move;
    expect(drone.state().pose.x).toBeCloseTo(1.9, 9); // arena_width - robot_radius
    expect(runner.api.droneDistance()).toBeCloseTo(0.0, 9);
    engine.destroy();
    drone.destroy();
  });

  it("drone up stops early at the altitude ceiling", async () => {
    const { engine, drone, runner } = await makeRunner();
    // Ceiling is 1.0 m at 0.1 m/s = 10 s = 1000 steps to collide and stop early.
    const move = runner.api.droneUp(5.0);
    runner.tick(1100);
    await move;
    expect(runner.api.droneAltitude()).toBeCloseTo(1.0, 9); // default max_altitude
    engine.destroy();
    drone.destroy();
  });

  it("drone abort rejects the active movement and stops the rotors", async () => {
    const { engine, drone, runner } = await makeRunner();
    const move = runner.api.droneForward(1.0);
    runner.tick(10);
    runner.abort();
    await expect(move).rejects.toBeInstanceOf(ProgramStoppedError);
    const stoppedAt = drone.state().pose.x;
    runner.tick(100);
    expect(drone.state().pose.x).toBeCloseTo(stoppedAt, 9);
    engine.destroy();
    drone.destroy();
  });

  it("drone and car can each be mid-movement at once without interfering", async () => {
    const { engine, drone, runner } = await makeRunner();
    const carMove = runner.api.forward(0.1);
    const droneMove = runner.api.droneForward(0.1);
    runner.tick(100);
    await Promise.all([carMove, droneMove]);
    expect(engine.state().pose.x).toBeCloseTo(1.1, 9);
    expect(drone.state().pose.x).toBeCloseTo(1.1, 9);
    engine.destroy();
    drone.destroy();
  });

  it("findColor sees the shipped arena's red box straight ahead", async () => {
    const { engine, runner } = await makeRunner();
    const detection = runner.api.findColor("red");
    expect(detection).not.toBeNull();
    expect(detection?.color).toBe("red");
    expect(Math.abs(detection!.bearing)).toBeLessThan(3); // dead ahead
    engine.destroy();
  });

  it("findColor returns null for a colour behind the robot (outside the camera FOV)", async () => {
    const { engine, runner } = await makeRunner();
    // The shipped arena's blue box is behind the car's start heading.
    expect(runner.api.findColor("blue")).toBeNull();
    engine.destroy();
  });

  it("findColor returns null for a colour not present in the arena at all", async () => {
    const { engine, runner } = await makeRunner();
    expect(runner.api.findColor("green")).toBeNull();
    engine.destroy();
  });

  it("lidar min matches the closest of the full scan against the real engine", async () => {
    const { engine, runner } = await makeRunner();
    const scan = runner.api.lidar();
    expect(Math.min(...scan)).toBeCloseTo(Math.min(...runner.api.lidar(9, 180)), 9);
    // Straight ahead is the red box at 0.5 m; nothing in the 180-degree fan
    // ahead can be closer than that in the shipped arena.
    expect(Math.min(...scan)).toBeLessThanOrEqual(runner.api.distance());
    engine.destroy();
  });

  it("rejects new movements after abort until re-armed", async () => {
    const { engine, runner } = await makeRunner();
    runner.abort();
    await expect(runner.api.forward(0.1)).rejects.toBeInstanceOf(ProgramStoppedError);
    runner.arm();
    const move = runner.api.forward(0.1);
    runner.tick(100);
    await expect(move).resolves.toBeUndefined();
    engine.destroy();
  });

  // Competition Arena C1: tick()'s own new optional onStep hook (see
  // docs/decisions/competition-arena-definition-scoring.md).
  it("onStep fires exactly once per simulated step, with monotonically increasing tick and a constant dt", async () => {
    const { engine, runner } = await makeRunner();
    const seen: { tick: number; dt: number }[] = [];
    runner.tick(10, (state, dt) => seen.push({ tick: state.tick, dt }));
    expect(seen).toHaveLength(10);
    const dts = new Set(seen.map((s) => s.dt));
    expect(dts.size).toBe(1); // every call sees the same dt
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i].tick).toBeGreaterThan(seen[i - 1].tick);
    }
    engine.destroy();
  });

  it("tick(steps) with no callback behaves exactly as before -- a plain regression guard", async () => {
    const { engine, runner } = await makeRunner();
    const move = runner.api.forward(0.1);
    runner.tick(100); // no third argument, same call shape every existing site uses
    await move;
    expect(engine.state().pose.x).toBeCloseTo(1.1, 9);
    engine.destroy();
  });
});
