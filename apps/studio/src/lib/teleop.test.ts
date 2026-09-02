import { describe, expect, it } from "vitest";
import { isTeleopKey, normalizeKey, teleopWheels } from "./teleop";

const SPEED = 0.2;
const TURN = 0.06;
const wheels = (keys: string[]) => teleopWheels(new Set(keys), SPEED, TURN);

describe("normalizeKey", () => {
  it("lowercases single printable characters", () => {
    expect(normalizeKey("W")).toBe("w");
    expect(normalizeKey("A")).toBe("a");
    expect(normalizeKey("d")).toBe("d");
  });

  it("leaves special keys untouched", () => {
    expect(normalizeKey("ArrowUp")).toBe("ArrowUp");
    expect(normalizeKey("Shift")).toBe("Shift");
    expect(normalizeKey("Enter")).toBe("Enter");
  });
});

describe("isTeleopKey", () => {
  it("recognizes arrows and WASD", () => {
    for (const key of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "w", "a", "s", "d"]) {
      expect(isTeleopKey(key)).toBe(true);
    }
  });

  it("rejects everything else, including uppercase WASD", () => {
    for (const key of ["W", "A", "Enter", "Shift", "q", ""]) {
      expect(isTeleopKey(key)).toBe(false);
    }
  });
});

describe("teleopWheels", () => {
  it("drives both wheels forward on ArrowUp or w", () => {
    expect(wheels(["ArrowUp"])).toEqual({ left: SPEED, right: SPEED });
    expect(wheels(["w"])).toEqual({ left: SPEED, right: SPEED });
  });

  it("drives both wheels backward on ArrowDown or s", () => {
    expect(wheels(["ArrowDown"])).toEqual({ left: -SPEED, right: -SPEED });
    expect(wheels(["s"])).toEqual({ left: -SPEED, right: -SPEED });
  });

  it("turns left: left wheel back, right wheel forward", () => {
    expect(wheels(["ArrowLeft"])).toEqual({ left: -TURN, right: TURN });
    expect(wheels(["a"])).toEqual({ left: -TURN, right: TURN });
  });

  it("turns right: left wheel forward, right wheel back", () => {
    expect(wheels(["ArrowRight"])).toEqual({ left: TURN, right: -TURN });
    expect(wheels(["d"])).toEqual({ left: TURN, right: -TURN });
  });

  it("combines forward with a turn for diagonal driving", () => {
    expect(wheels(["ArrowUp", "ArrowRight"])).toEqual({ left: SPEED + TURN, right: SPEED - TURN });
    expect(wheels(["w", "a"])).toEqual({ left: SPEED - TURN, right: SPEED + TURN });
  });

  it("cancels out when both keys of an opposite pair are held", () => {
    expect(wheels(["ArrowUp", "ArrowDown"])).toEqual({ left: 0, right: 0 });
    expect(wheels(["ArrowLeft", "ArrowRight"])).toEqual({ left: 0, right: 0 });
  });

  it("does not double-count an arrow key and its WASD equivalent", () => {
    // Holding both "w" and "ArrowUp" is still just "forward", not double speed.
    expect(wheels(["w", "ArrowUp"])).toEqual({ left: SPEED, right: SPEED });
  });

  it("returns zero for no keys held", () => {
    expect(wheels([])).toEqual({ left: 0, right: 0 });
  });

  it("ignores keys outside the teleop set", () => {
    expect(wheels(["q", "Shift", "Enter"])).toEqual({ left: 0, right: 0 });
  });
});
