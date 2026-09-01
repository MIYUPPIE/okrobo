import { describe, expect, it } from "vitest";
import { planSteps } from "./fixedStep";

const DT = 0.01;

describe("planSteps", () => {
  it("runs one step when exactly one dt elapsed", () => {
    expect(planSteps(0, DT, DT, 100)).toEqual({ steps: 1, accumulator: 0 });
  });

  it("carries the remainder", () => {
    const plan = planSteps(0, 0.016, DT, 100);
    expect(plan.steps).toBe(1);
    expect(plan.accumulator).toBeCloseTo(0.006, 12);
  });

  it("accumulates across frames without losing time", () => {
    let acc = 0;
    let totalSteps = 0;
    for (let i = 0; i < 100; i++) {
      const plan = planSteps(acc, 0.016, DT, 100);
      acc = plan.accumulator;
      totalSteps += plan.steps;
    }
    // 1.6 s of real time at dt=0.01 -> 160 steps.
    expect(totalSteps).toBe(160);
  });

  it("runs zero steps when not enough time elapsed", () => {
    const plan = planSteps(0, 0.004, DT, 100);
    expect(plan.steps).toBe(0);
    expect(plan.accumulator).toBeCloseTo(0.004, 12);
  });

  it("caps steps and drops the backlog after a stall", () => {
    expect(planSteps(0, 5.0, DT, 100)).toEqual({ steps: 100, accumulator: 0 });
  });
});
