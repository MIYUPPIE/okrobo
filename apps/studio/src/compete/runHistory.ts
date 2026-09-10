// Remembers finished competition runs, browser-local -- the missing data
// layer underneath "what did I do on past runs" (nextphase.md's Competition
// Analytics/Readiness Score/Tournament Mode all assume this exists; nothing
// in this app persisted a run's own result before this). Mirrors
// projects/webStore.ts's own two conventions exactly: an injectable
// KeyValueStore (default: the real localStorage) rather than a bare global
// reference -- this repo's Node+vitest+jsdom combination doesn't reliably
// provide a working localStorage, see webStore.ts's own header comment --
// and one JSON blob per key.
//
// A run recorded here is local to this browser profile, same inherent
// limitation project storage already has; not attempting cross-device sync.

import type { FinishReason } from "./score";

export interface RunRecord {
  score: number;
  elapsedSeconds: number;
  finishReason: FinishReason;
  /** Date.now(), ms -- UI-only display data, never cross-checked against
   * anything else, unlike webStore's own deliberate whole-seconds
   * convention (which OpenDialog.tsx's formatting depends on). */
  timestamp: number;
}

/** The exact subset of the DOM `Storage` interface this module needs --
 * see webStore.ts's own identical interface for why this is injected
 * rather than referencing `localStorage` directly. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const MAX_RECORDS = 20;
const historyKey = (competitionId: string) => `okrobo:competition-runs:${competitionId}`;

function readHistory(competitionId: string, store: KeyValueStore): RunRecord[] {
  const raw = store.getItem(historyKey(competitionId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RunRecord[]) : [];
  } catch {
    return [];
  }
}

/** Appends `record`, most-recent-first, capped at the MAX_RECORDS most
 * recent (oldest dropped) so a long-lived browser profile can't grow this
 * unbounded. */
export function recordRun(competitionId: string, record: RunRecord, store: KeyValueStore = localStorage): void {
  const history = [record, ...readHistory(competitionId, store)].slice(0, MAX_RECORDS);
  store.setItem(historyKey(competitionId), JSON.stringify(history));
}

/** Most recent first. */
export function getRunHistory(competitionId: string, store: KeyValueStore = localStorage): RunRecord[] {
  return readHistory(competitionId, store);
}

/** The highest score ever recorded for this competition, or null if it's
 * never been run (or the recorded history is empty/corrupt). */
export function getBestScore(competitionId: string, store: KeyValueStore = localStorage): number | null {
  const history = readHistory(competitionId, store);
  if (history.length === 0) return null;
  return Math.max(...history.map((r) => r.score));
}
