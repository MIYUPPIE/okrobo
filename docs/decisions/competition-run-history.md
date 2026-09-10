# Decision: Competition run history (best scores, remembered across sessions)

**Date:** 2026-09-10

## Scope

Closes the data-layer gap underneath three separate `nextphase.md` brainstorm items at once — Competition Analytics (#19), Competition Readiness Score (#21), and Tournament Mode (#17) — all of which assume some notion of "what happened on past runs." Before this, none existed: every `CompeteReport` was thrown away the instant a student left Compete mode. This slice remembers every finished run's score and surfaces it in exactly the two places a student would want it — the competition picker ("Best: 230" before you even start) and the end-of-run report ("New best!" actually meaning something) — without building a full history browser, leaderboard, or readiness-score formula. Those stay real future slices this lays groundwork for.

## `runHistory.ts` mirrors `webStore.ts`'s own two conventions exactly

An injectable `KeyValueStore` parameter (default: the real `localStorage`) rather than a bare global reference — this repo's Node+vitest+jsdom combination doesn't reliably provide a working `localStorage` (see the `node-vitest-localstorage-gotcha` memory / `webStore.ts`'s own header comment) — and one JSON blob per key (`okrobo:competition-runs:<competitionId>`), here holding a `RunRecord[]` capped at the 20 most recent so a long-lived browser profile can't grow this unbounded. A run recorded here is local to this browser profile, the same inherent limitation `webStore.ts`'s own project storage already has and already documents; not attempting cross-device sync.

## `App.tsx` records on `finished`, never inside the `setCompeteRun` updater

A new `useEffect` keyed on the primitive `competeRun?.finished` (not the whole object) — the exact convention the existing `useEffect(() => { if (competeRun?.timeUp) haltEverything(); }, [competeRun?.timeUp])` already uses, for the identical documented reason: a side effect reacting to a state transition belongs in an effect, never inside `setCompeteRun`'s own functional updater (Strict Mode can invoke that updater more than once to check purity). `CompeteReport`/`CompeteHud` stay pure presentational components reading only props — they never touch `runHistory.ts` themselves; `App.tsx` computes a `BestScoreInfo` (`{ previousBest, isNewBest }`) once, in the same effect that persists the record, and passes it down.

## A real bug this surfaced before it shipped: every first-ever run computed as "new best"

The first implementation computed `isNewBest: competeRun.totalScore > (previousBest ?? -Infinity)` — meaning a competition's genuinely first-ever run (no prior history, `previousBest === null`) trivially "beat" a nonexistent best (any finite score, including 0, is greater than `-Infinity`), showing "🎉 New best!" when nothing should show at all. `CompeteReport.test.tsx` didn't catch this because it tests the *rendering* logic against an explicitly-constructed `BestScoreInfo` prop, never the *computation* that builds one — and `App.tsx` itself carries no unit test file (this project's own established convention: the top-level shell is covered by the real-browser e2e suite instead, not unit tests). Caught by this feature's own new e2e check ("no best-score line yet on Sprint to the Zone's first-ever run this session") failing on the very first real-browser run. Fixed: `isNewBest: previousBest !== null && competeRun.totalScore > previousBest` — a first-ever run now correctly shows nothing, matching `CompeteReport`'s own tested behavior.

## Verification

`apps/studio`: `npm run test` (912 passing, up from 899 — new `runHistory.test.ts`, extended `CompeteReport.test.tsx`/`CompetitionDialog.test.tsx`), `npm run typecheck`, `npm run build`. `./scripts/check-studio-e2e.sh` gained a real two-competition-run round trip: run Sprint to the Zone once (confirms no best-score line appears on a genuine first run), reopen the picker (confirms the row now shows a real recorded best score), run it a second time (confirms the report now shows a best-score comparison line) — a permanent regression test for the actual `localStorage` round trip end to end, not just unit-tested in isolation. Passed three consecutive real-browser runs after the `isNewBest` fix. Full `./scripts/test-all.sh` green.

## Non-goals

- No history browser or per-run list beyond the single "best" figure — Competition Analytics, a real future slice.
- No cross-device sync — inherent to `localStorage`, same as `webStore.ts`'s own project storage.
- No tournament brackets, no readiness-scoring formula — this is the data layer those would eventually read from, not an attempt at either.
