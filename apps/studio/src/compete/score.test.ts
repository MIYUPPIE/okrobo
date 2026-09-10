import { describe, expect, it } from "vitest";
import type { WorldDef } from "../lib/validateWorld";
import type { CompetitionDef, Objective } from "./competitionDef";
import { circleIntersectsAabb, evaluateTick, finishRun, initRunState } from "./score";

const arena: WorldDef = {
  name: "Test Arena",
  arena_width: 10,
  arena_height: 10,
  robot_radius: 0.1,
  wheel_base: 0.15,
  start: { x: 0, y: 0, theta: 0 },
  obstacles: [
    { x: 1, y: 1, width: 0.4, height: 0.4, color: [200, 60, 60] },
    { x: 3, y: 3, width: 0.4, height: 0.4, color: [60, 200, 60] },
  ],
};

function makeDef(objectives: Objective[]): CompetitionDef {
  return { id: "test", name: "Test", robot: "car", arena, objectives };
}

describe("circleIntersectsAabb", () => {
  // box spans x:[0.8,1.2], y:[0.8,1.2] (centre-based, matching
  // contracts/world/v1's own obstacle placement -- confirmed against both
  // Viewport3D.tsx's mesh placement and engine/src/world.cpp's own ray-cast).
  const box = { x: 1, y: 1, width: 0.4, height: 0.4, color: [200, 60, 60] as [number, number, number] };

  it("outside", () => {
    expect(circleIntersectsAabb(2, 2, 0.1, box)).toBe(false);
  });

  it("just touching the edge counts as intersecting", () => {
    // Not testing an EXACT boundary (dist == r bit-for-bit): 1.3 - 1.2 in
    // IEEE754 double is 0.09999999999999998, not exactly 0.1 -- a boundary
    // assertion there would be racy against float rounding, not a real
    // behavior question. r=0.11 keeps this unambiguously inside.
    expect(circleIntersectsAabb(1.3, 1, 0.11, box)).toBe(true); // dist to edge = 0.1 < 0.11
  });

  it("overlapping a corner", () => {
    expect(circleIntersectsAabb(1.3, 1.3, 0.2, box)).toBe(true); // dist to corner ~0.1414 < 0.2
  });

  it("near a corner but not overlapping", () => {
    expect(circleIntersectsAabb(1.3, 1.3, 0.1, box)).toBe(false); // dist to corner ~0.1414 > 0.1
  });

  it("centre inside the box", () => {
    expect(circleIntersectsAabb(1, 1, 0.05, box)).toBe(true);
  });
});

describe("reach_zone", () => {
  const def = makeDef([{ type: "reach_zone", x: 5, y: 5, radius: 0.5, points: 100 }]);

  it("unreached scores 0", () => {
    const state = evaluateTick(def, initRunState(def), { x: 0, y: 0, theta: 0 }, 0.1);
    expect(state.outcomes[0].achieved).toBe(false);
    expect(state.totalScore).toBe(0);
  });

  it("reaching the zone awards its points once", () => {
    const state = evaluateTick(def, initRunState(def), { x: 5, y: 5, theta: 0 }, 0.1);
    expect(state.outcomes[0].achieved).toBe(true);
    expect(state.totalScore).toBe(100);
  });

  it("staying inside across many ticks does not double-award", () => {
    let state = initRunState(def);
    for (let i = 0; i < 10; i++) state = evaluateTick(def, state, { x: 5, y: 5, theta: 0 }, 0.1);
    expect(state.totalScore).toBe(100);
  });
});

// Competition Arena C4: ordered checkpoints (reach_zone's own `sequence`).
describe("reach_zone sequencing", () => {
  const pickup: Objective = { type: "reach_zone", x: 1, y: 1, radius: 0.5, points: 80, sequence: 0 };
  const delivery: Objective = { type: "reach_zone", x: 5, y: 5, radius: 0.5, points: 150, sequence: 1 };
  const def = makeDef([pickup, delivery]);

  it("a higher-sequence zone starts locked and cannot be achieved by standing in it", () => {
    let state = initRunState(def);
    for (let i = 0; i < 5; i++) state = evaluateTick(def, state, { x: 5, y: 5, theta: 0 }, 0.1);
    expect(state.outcomes[1].locked).toBe(true);
    expect(state.outcomes[1].achieved).toBe(false);
    expect(state.totalScore).toBe(0);
  });

  it("a lower-sequence zone is never locked", () => {
    const state = evaluateTick(def, initRunState(def), { x: 0, y: 0, theta: 0 }, 0.1);
    expect(state.outcomes[0].locked).toBe(false);
  });

  it("achieving the prerequisite unlocks the next zone one tick later, and it becomes achievable", () => {
    let state = initRunState(def);
    state = evaluateTick(def, state, { x: 1, y: 1, theta: 0 }, 0.1); // reach pickup
    expect(state.outcomes[0].achieved).toBe(true);
    expect(state.outcomes[1].locked).toBe(true); // still locked THIS tick (gated on the previous tick)

    state = evaluateTick(def, state, { x: 5, y: 5, theta: 0 }, 0.1); // now at delivery
    expect(state.outcomes[1].locked).toBe(false);
    expect(state.outcomes[1].achieved).toBe(true);
    expect(state.totalScore).toBe(230); // 80 + 150
  });

  it("standing in the locked zone before its prerequisite, then reaching the prerequisite, still requires re-entering (or already being there next tick)", () => {
    let state = initRunState(def);
    state = evaluateTick(def, state, { x: 5, y: 5, theta: 0 }, 0.1); // delivery first -- locked, no-op
    state = evaluateTick(def, state, { x: 1, y: 1, theta: 0 }, 0.1); // now reach pickup
    expect(state.outcomes[0].achieved).toBe(true);
    expect(state.outcomes[1].achieved).toBe(false); // robot isn't at delivery's position this tick

    state = evaluateTick(def, state, { x: 5, y: 5, theta: 0 }, 0.1); // back at delivery, now unlocked
    expect(state.outcomes[1].achieved).toBe(true);
  });

  it("equal sequence values form a concurrently-reachable tier -- neither is locked by the other", () => {
    const tierDef = makeDef([
      { type: "reach_zone", x: 1, y: 1, radius: 0.5, points: 50, sequence: 0 },
      { type: "reach_zone", x: 8, y: 8, radius: 0.5, points: 50, sequence: 0 },
    ]);
    let state = initRunState(tierDef);
    state = evaluateTick(tierDef, state, { x: 1, y: 1, theta: 0 }, 0.1);
    expect(state.outcomes[0].achieved).toBe(true);
    expect(state.outcomes[1].locked).toBe(false); // same tier, not gated by its sibling
  });

  it("a reach_zone with no sequence at all is never locked, regardless of any other objective (v0's own behavior, unchanged)", () => {
    const unorderedDef = makeDef([{ type: "reach_zone", x: 5, y: 5, radius: 0.5, points: 150 }]);
    const state = evaluateTick(unorderedDef, initRunState(unorderedDef), { x: 5, y: 5, theta: 0 }, 0.1);
    expect(state.outcomes[0].locked).toBe(false);
    expect(state.outcomes[0].achieved).toBe(true);
  });
});

describe("avoid_obstacle_collision", () => {
  const def = makeDef([{ type: "avoid_obstacle_collision", penaltyPerHit: 10 }]);

  it("one continuous overlap counts as one hit, not one per tick", () => {
    let state = initRunState(def);
    for (let i = 0; i < 5; i++) state = evaluateTick(def, state, { x: 1, y: 1, theta: 0 }, 0.1);
    expect(state.outcomes[0].hits).toBe(1);
    expect(state.totalScore).toBe(-10);
  });

  it("overlap, clear, overlap again counts as two hits", () => {
    let state = initRunState(def);
    state = evaluateTick(def, state, { x: 1, y: 1, theta: 0 }, 0.1); // hit obstacle 0
    state = evaluateTick(def, state, { x: 9, y: 9, theta: 0 }, 0.1); // clear of everything
    state = evaluateTick(def, state, { x: 1, y: 1, theta: 0 }, 0.1); // hit obstacle 0 again
    expect(state.outcomes[0].hits).toBe(2);
    expect(state.totalScore).toBe(-20);
  });

  it("two different obstacles overlapping in the same tick counts as two hits", () => {
    // A second arena where the two obstacles are close enough for one
    // robot position to overlap both simultaneously: box A spans
    // x:[0.8,1.2], box B spans x:[1.1,1.5], both y:[0.8,1.2] -- x=1.15
    // (radius 0.05) sits inside both at once.
    const closeArena: WorldDef = {
      name: "Close Arena",
      arena_width: 5,
      arena_height: 5,
      robot_radius: 0.05,
      wheel_base: 0.1,
      start: { x: 0, y: 0, theta: 0 },
      obstacles: [
        { x: 1, y: 1, width: 0.4, height: 0.4, color: [200, 60, 60] },
        { x: 1.3, y: 1, width: 0.4, height: 0.4, color: [60, 200, 60] },
      ],
    };
    const closeDef: CompetitionDef = {
      id: "close",
      name: "Close",
      robot: "car",
      arena: closeArena,
      objectives: [{ type: "avoid_obstacle_collision", penaltyPerHit: 10 }],
    };
    const state = evaluateTick(closeDef, initRunState(closeDef), { x: 1.15, y: 1, theta: 0 }, 0.1);
    expect(state.outcomes[0].hits).toBe(2);
    expect(state.totalScore).toBe(-20);
  });
});

describe("time_limit", () => {
  // 0.95, not 1 -- repeated addition of dt=0.1 accumulates to
  // 0.9999999999999999 (a well-known JS floating-point fact, not a bug),
  // so pinning the threshold at exactly 1.0 would make this test racy
  // against float rounding. 0.95 keeps both the "still under" (9 ticks,
  // ~0.9) and "now over" (10 ticks, ~0.9999...) checks unambiguous.
  const def = makeDef([{ type: "time_limit", seconds: 0.95 }]);

  it("accumulates elapsed time and flips timeUp/finished once the limit is reached", () => {
    let state = initRunState(def);
    for (let i = 0; i < 9; i++) state = evaluateTick(def, state, { x: 0, y: 0, theta: 0 }, 0.1);
    expect(state.timeUp).toBe(false);
    expect(state.finished).toBe(false);

    state = evaluateTick(def, state, { x: 0, y: 0, theta: 0 }, 0.1);
    expect(state.timeUp).toBe(true);
    expect(state.finished).toBe(true);
    expect(state.finishReason).toBe("time_up");
  });

  it("stays finished -- further ticks are a no-op", () => {
    let state = initRunState(def);
    for (let i = 0; i < 10; i++) state = evaluateTick(def, state, { x: 0, y: 0, theta: 0 }, 0.1);
    const finishedState = state;
    const nextState = evaluateTick(def, state, { x: 999, y: 999, theta: 0 }, 0.1);
    expect(nextState).toEqual(finishedState);
  });
});

describe("finishRun", () => {
  const def = makeDef([{ type: "reach_zone", x: 5, y: 5, radius: 0.5, points: 100 }]);

  it("marks a run finished with the given reason", () => {
    const state = finishRun(initRunState(def), "stopped");
    expect(state.finished).toBe(true);
    expect(state.finishReason).toBe("stopped");
  });

  it("is a no-op if already finished (never overwrites time_up with stopped)", () => {
    const def2 = makeDef([{ type: "time_limit", seconds: 0.05 }]);
    const timedUp = evaluateTick(def2, initRunState(def2), { x: 0, y: 0, theta: 0 }, 0.1);
    expect(timedUp.finishReason).toBe("time_up");
    const stopped = finishRun(timedUp, "stopped");
    expect(stopped.finishReason).toBe("time_up");
  });
});

describe("a full competition run through a scripted pose sequence", () => {
  it("hand-computed final score matches: +100 reach_zone, -10 one obstacle hit, time limit not reached", () => {
    const def = makeDef([
      { type: "reach_zone", x: 5, y: 5, radius: 0.3, points: 100 },
      { type: "avoid_obstacle_collision", penaltyPerHit: 10 },
      { type: "time_limit", seconds: 2 },
    ]);
    const poses = [
      { x: 0, y: 0, theta: 0 }, // nowhere near anything
      { x: 1, y: 1, theta: 0 }, // overlaps obstacle 0 -- one hit
      { x: 5, y: 5, theta: 0 }, // reaches the zone -- +100
      { x: 5, y: 5, theta: 0 }, // still in the zone -- not re-awarded
    ];
    let state = initRunState(def);
    for (const pose of poses) state = evaluateTick(def, state, pose, 0.1);

    expect(state.totalScore).toBe(90);
    expect(state.finished).toBe(false); // elapsed 0.4s, well under the 2s limit
    expect(state.outcomes[0].achieved).toBe(true);
    expect(state.outcomes[0].points).toBe(100);
    expect(state.outcomes[1].hits).toBe(1);
    expect(state.outcomes[1].points).toBe(-10);
    expect(state.outcomes[2].achieved).toBe(false);
  });
});
