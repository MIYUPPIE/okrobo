// Mirrors webStore.test.ts's own shape: an injected in-memory KeyValueStore
// rather than the real `localStorage` global -- this repo's Node+vitest
// combination doesn't reliably provide a working one (see runHistory.ts's
// own header comment).

import { beforeEach, describe, expect, it } from "vitest";
import { getBestScore, getRunHistory, recordRun, type KeyValueStore, type RunRecord } from "./runHistory";

function fakeStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
  };
}

function makeRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  return { score: 100, elapsedSeconds: 12.3, finishReason: "stopped", timestamp: 1_700_000_000_000, ...overrides };
}

let store: KeyValueStore;
beforeEach(() => {
  store = fakeStore();
});

describe("runHistory", () => {
  it("an untouched competition has no history and no best score", () => {
    expect(getRunHistory("sprint-to-the-zone", store)).toEqual([]);
    expect(getBestScore("sprint-to-the-zone", store)).toBeNull();
  });

  it("records a run and reads it back", () => {
    const record = makeRecord({ score: 150 });
    recordRun("sprint-to-the-zone", record, store);
    expect(getRunHistory("sprint-to-the-zone", store)).toEqual([record]);
    expect(getBestScore("sprint-to-the-zone", store)).toBe(150);
  });

  it("history is most-recent-first", () => {
    recordRun("sprint-to-the-zone", makeRecord({ score: 100, timestamp: 1 }), store);
    recordRun("sprint-to-the-zone", makeRecord({ score: 120, timestamp: 2 }), store);
    recordRun("sprint-to-the-zone", makeRecord({ score: 90, timestamp: 3 }), store);
    const history = getRunHistory("sprint-to-the-zone", store);
    expect(history.map((r) => r.score)).toEqual([90, 120, 100]);
  });

  it("best score is the max across all recorded runs, not just the latest", () => {
    recordRun("sprint-to-the-zone", makeRecord({ score: 100 }), store);
    recordRun("sprint-to-the-zone", makeRecord({ score: 250 }), store);
    recordRun("sprint-to-the-zone", makeRecord({ score: 180 }), store);
    expect(getBestScore("sprint-to-the-zone", store)).toBe(250);
  });

  it("caps history at the 20 most recent runs, dropping the oldest", () => {
    for (let i = 0; i < 25; i++) recordRun("sprint-to-the-zone", makeRecord({ score: i, timestamp: i }), store);
    const history = getRunHistory("sprint-to-the-zone", store);
    expect(history).toHaveLength(20);
    expect(history[0].score).toBe(24); // most recent
    expect(history[19].score).toBe(5); // oldest surviving (25 - 20)
    expect(history.some((r) => r.score < 5)).toBe(false); // the oldest 5 were dropped
  });

  it("different competitions have independent histories", () => {
    recordRun("sprint-to-the-zone", makeRecord({ score: 100 }), store);
    recordRun("maze-challenge", makeRecord({ score: 300 }), store);
    expect(getBestScore("sprint-to-the-zone", store)).toBe(100);
    expect(getBestScore("maze-challenge", store)).toBe(300);
  });

  it("a corrupted history entry falls back to empty rather than throwing", () => {
    store.setItem("okrobo:competition-runs:sprint-to-the-zone", "{not valid json");
    expect(getRunHistory("sprint-to-the-zone", store)).toEqual([]);
    expect(getBestScore("sprint-to-the-zone", store)).toBeNull();
  });
});
