// Phase 3 acceptance, headless: a REAL python sidecar runs a REAL student
// file in a subprocess; robot calls cross the socketpair, the WebSocket, and
// the PythonBridge to drive the REAL WASM engine. Everything local.

import { type ChildProcess, spawn } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeRunner } from "../program/testEngine";
import { PythonBridge, type BridgeEvents } from "./PythonBridge";

const RUNTIME_DIR = new URL("../../../../runtime/python", import.meta.url).pathname;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let sidecar: ChildProcess;
let url = "";

beforeAll(async () => {
  sidecar = spawn("python3", ["-m", "okrobo.sidecar", "--port", "0"], {
    cwd: RUNTIME_DIR,
    stdio: ["ignore", "pipe", "pipe"],
  });
  url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("sidecar did not start")), 10000);
    let buffer = "";
    sidecar.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const match = /listening on (ws:\/\/[\d.]+:\d+)/.exec(buffer);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    sidecar.stderr?.on("data", (chunk: Buffer) => process.stderr.write(chunk));
    sidecar.on("exit", () => reject(new Error("sidecar exited early")));
  });
});

afterAll(() => {
  sidecar?.kill();
});

interface Capture {
  events: BridgeEvents;
  output: string[];
  done: { value: boolean; exitCode: number | null };
  connected: { value: boolean };
  ports: { value: unknown[] | null };
  hardware: { value: { connected: boolean; error?: string } | null };
}

function makeCapture(): Capture {
  const output: string[] = [];
  const done = { value: false, exitCode: null as number | null };
  const connected = { value: false };
  const ports = { value: null as unknown[] | null };
  const hardware = { value: null as { connected: boolean; error?: string } | null };
  return {
    output,
    done,
    connected,
    ports,
    hardware,
    events: {
      onStatus: (isConnected) => (connected.value = isConnected),
      onStarted: () => {},
      onOutput: (_stream, text) => output.push(text),
      onDone: (exitCode) => {
        done.value = true;
        done.exitCode = exitCode;
      },
      onPorts: (list) => (ports.value = list),
      onHardware: (status) => (hardware.value = status),
    },
  };
}

async function waitFor(condition: () => boolean, tickFn?: () => void, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("timed out waiting");
    tickFn?.();
    await sleep(5);
  }
}

describe("python sidecar end to end (real sidecar, real engine)", () => {
  it("an unmodified okrobo student file drives the WASM engine", async () => {
    const { engine, runner } = await makeRunner();
    const capture = makeCapture();
    const bridge = new PythonBridge(url, runner.api, capture.events);
    bridge.connect();
    await waitFor(() => capture.connected.value);

    bridge.run(
      [
        "from okrobo import Robot",
        "robot = Robot()",
        "robot.forward(0.25)",
        "print('distance:', round(robot.distance(), 3))",
        "robot.turn_left(90)",
        "robot.forward(0.25)",
        "x, y = robot.position()",
        "print('pose:', round(x, 3), round(y, 3), round(robot.heading()))",
      ].join("\n"),
    );
    await waitFor(
      () => capture.done.value,
      () => runner.tick(100),
    );

    expect(capture.done.exitCode).toBe(0);
    const stdout = capture.output.join("");
    expect(stdout).toContain("distance: 0.25");
    expect(stdout).toContain("pose: 1.25 1.25 90");
    expect(engine.state().pose.x).toBeCloseTo(1.25, 9);
    expect(engine.state().pose.y).toBeCloseTo(1.25, 9);

    bridge.dispose();
    engine.destroy();
  }, 30000);

  it("an unmodified okrobo Arm student file drives the WASM arm (v1)", async () => {
    const { engine, arm, runner } = await makeRunner();
    const capture = makeCapture();
    const bridge = new PythonBridge(url, runner.api, capture.events);
    bridge.connect();
    await waitFor(() => capture.connected.value);

    bridge.run(
      [
        "from okrobo import Arm",
        "arm = Arm()",
        "arm.move('base', 90)",
        "arm.move_all([90, 90, 0, 0])",
        "x, y, z = arm.tip()",
        "print('tip:', round(x, 3), round(y, 3), round(z, 3))",
        "print('angles:', [round(a) for a in arm.angles()])",
      ].join("\n"),
    );
    await waitFor(
      () => capture.done.value,
      () => runner.tick(100),
    );

    expect(capture.done.exitCode).toBe(0);
    const stdout = capture.output.join("");
    // base=90deg, arm straight up: tip directly above the base at 0.62 m.
    expect(stdout).toContain("tip: 0.0 0.0 0.62");
    expect(stdout).toContain("angles: [90, 90, 0, 0]");
    expect(arm.state().tip.z).toBeCloseTo(0.62, 6);

    bridge.dispose();
    arm.destroy();
    engine.destroy();
  }, 30000);

  it("a student vision program sees the arena through the sidecar (v2 camera)", async () => {
    const { engine, arm, runner } = await makeRunner();
    const capture = makeCapture();
    const bridge = new PythonBridge(url, runner.api, capture.events);
    bridge.connect();
    await waitFor(() => capture.connected.value);

    bridge.run(
      [
        "from okrobo import Robot",
        "from okrobo.vision import find_color",
        "robot = Robot()",
        "frame = robot.camera()",
        "print('frame:', frame.width, frame.height, len(frame.pixels))",
        "target = find_color(frame, 'red')",
        "print('bearing:', round(target.bearing, 1) if target else 'none')",
        "robot.forward(0.2)",
        "print('distance:', round(robot.distance(), 2))",
      ].join("\n"),
    );
    await waitFor(
      () => capture.done.value,
      () => runner.tick(100),
    );

    const stdout = capture.output.join("");
    expect(capture.done.exitCode, stdout).toBe(0);
    // The frame crossed the boundary intact: 64x48 RGB.
    expect(stdout).toContain("frame: 64 48 9216");
    // The red box is dead ahead, so the bearing is near zero...
    expect(stdout).toMatch(/bearing: -?0\.\d/);
    // ...and driving 0.2 m of the 0.5 m gap leaves 0.3 m.
    expect(stdout).toContain("distance: 0.3");

    bridge.dispose();
    arm.destroy();
    engine.destroy();
  }, 30000);

  it("lists serial ports and reports a failed hardware connect (v0 serial)", async () => {
    const { engine, arm, runner } = await makeRunner();
    const capture = makeCapture();
    const bridge = new PythonBridge(url, runner.api, capture.events);
    bridge.connect();
    await waitFor(() => capture.connected.value);

    bridge.listPorts();
    await waitFor(() => capture.ports.value !== null);
    expect(Array.isArray(capture.ports.value)).toBe(true);

    // No robot on a made-up port: the studio must be told, not left hanging.
    bridge.connectHardware("/dev/okrobo-does-not-exist");
    await waitFor(() => capture.hardware.value !== null, undefined, 25000);
    expect(capture.hardware.value?.connected).toBe(false);
    expect(capture.hardware.value?.error).toBeTruthy();

    bridge.dispose();
    arm.destroy();
    engine.destroy();
  }, 40000);

  it("stop kills an infinite student program", async () => {
    const { engine, runner } = await makeRunner();
    const capture = makeCapture();
    const bridge = new PythonBridge(url, runner.api, capture.events);
    bridge.connect();
    await waitFor(() => capture.connected.value);

    bridge.run(
      ["from okrobo import Robot", "robot = Robot()", "while True:", "    robot.wait(0.05)"].join("\n"),
    );
    await waitFor(
      () => runner.busy,
      () => runner.tick(10),
    );
    bridge.stop();
    runner.abort();
    await waitFor(
      () => capture.done.value,
      () => runner.tick(10),
    );
    expect(capture.done.exitCode).not.toBe(0);

    bridge.dispose();
    engine.destroy();
  }, 30000);
});
