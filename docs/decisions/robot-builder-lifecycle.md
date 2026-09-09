# Decision: Robot Builder — robot lifecycle (D2)

**Date:** 2026-09-09

## Scope

Two connected gaps the user reported: no way to finish one robot and start building a new one without discarding the whole project (`App.tsx`'s `actionNew()` — File > New Project — was the only way to clear `robotDef`, and it also wipes Blocks/Python code, the world, and the project association), and no way to reuse a robot saved in a *different* project inside Simulate mode's built-robot picker (Robot Builder B2 only ever offered "the current document" or a pack robot).

## The existing project system already answers "multiple saved robots" — no new storage needed

Investigated directly before writing any code: `ProjectPayload` (`projects/api.ts`) is a flat, one-of-each-field bundle — one `blocks`, one `python`, one `world_custom`, one `robot_def`. `OpenDialog`/`NameDialog` (`dialogs.tsx`) already provide a complete "list of named saved things, open or delete" UI, reused verbatim by `TemplateDialog`/`CompetitionDialog`/`BuiltRobotDialog` already. Once a "clear just the robot" action exists, the natural workflow is already available for free: build a robot, Save As a new project named for it, clear the robot, build the next one, Save As again — `File > Open` is already the library. No `robots[]` array, no new backend concept, no new IPC command.

## `actionNewRobot()` — narrower than `actionNew()`, on purpose

```ts
const actionNewRobot = () => {
  setRobotDef(null);
  showNotice("robot cleared");
};
```
Deliberately does not touch `currentProject`, Blocks/Python code, or `world` — a student mid-way through an unrelated Python lesson on the Car shouldn't lose that work just because they also want to start a second robot design in the same project. Also deliberately does not touch `simulateBuilt` (Robot Builder B2's own state) — B2 already established `simulateBuilt` as an independent snapshot taken at pick time, unaffected by Build mode's own document changing underneath it; clearing `robotDef` here stays consistent with that existing boundary rather than reaching across it.

## A confirm step, and why this app's own "nothing else warns" pattern doesn't apply here

Investigated directly: neither `actionNew()` nor `openProjectById()` warns before silently discarding unsaved Blocks/Python/world edits anywhere in this app today — there is no dirty-check, no `confirm()`, anywhere. `actionNewRobot()` breaks that pattern on purpose: clearing an entire hand-built robot (potentially many bodies/joints/actuators/sensors, unlike a quick Blocks/Python edit) is a meaningfully larger, easier-to-regret action, and — critically — the trigger button is now *always visible* once a robot exists (unlike today's "+ New Robot," which only ever shows in the `robotDef === null` empty state, reachable at most once per project). A one-click, no-confirm version of this button sitting permanently in the header invites an accidental click in a way the rest of this app's lifecycle actions don't. The two-click "clear robot?" idiom already established for body/feature-step deletion (`BuilderPanel.tsx`) is reused directly, not invented.

## `listProjectRobots()` mirrors `packRobots.ts` exactly, with one simplification

`loadProject(id)` already returns the full, already-deserialized `ProjectPayload` in one IPC round trip — unlike packs, which need a separate manifest read to discover *which* files exist before reading each one. So `listProjectRobots()` is simpler: `listProjects()`, then `loadProject(id)` per entry, keeping only the ones with a non-null `robot_def`. Project files are still untrusted data on disk (the same posture `App.tsx`'s own `applyProjectRobotDef` already takes) — `parseRobotDef` is never skipped just because `ProjectPayload`'s own TS type already claims `RobotDef | null`; one corrupt project is skipped, logged, and never blanks the rest of the list, the same resilience `packRobots.ts`'s `robotsForPack` already established. The currently-open project is excluded via an `excludeProjectId` parameter — already covered by `BuiltRobotDialog`'s own "current robot" row, so listing it again would be a confusing duplicate.

## Non-goals (D2 specifically)

- No renaming or reorganizing of saved projects beyond what `OpenDialog`/`NameDialog` already do — this phase didn't need to touch either.
- `simulateBuilt` still doesn't persist through Save/Open — unchanged from B2, still a deliberate deferral.

## A real, honestly-stated verification limit

`App.tsx`'s entire File menu (New/Open/Save/Save As) is `disabled={!inDesktop}`, and `scripts/lib/studio-e2e-check.mjs` runs as a plain browser tab (`isTauri()` false) — so this harness can prove `actionNewRobot()` itself (pure in-memory state, no IPC) and that `BuiltRobotDialog`'s new "saved projects" section settles to its real empty state (since `listProjects()` rejects there, same as the packs section already does), but it cannot create a second real saved project with its own robot inside this harness to prove the actual cross-project pick end to end. That happy path is proven by `projectRobots.test.ts` (mocked IPC, corrupt-project-skip, exclude-current-project, fresh-object-per-`make()` cases) and `BuiltRobotDialog.test.tsx`'s own extended section — stated plainly, matching Robot Builder Phase 8's own established precedent for every other Tauri-only path.

## Verification

`apps/studio`: `npm run test` (850 passing, up from 838 — new `projectRobots.test.ts`, extended `BuiltRobotDialog.test.tsx`/`BuilderPanel.test.tsx`), `npm run typecheck`, `npm run build`. `./scripts/check-studio-e2e.sh` — the existing "Simulate mode: built robot" section gained one more check proving the saved-projects section settles cleanly. Manually verified in a real headless-Chrome session: building a robot, clicking "New Robot" once (confirm state, nothing cleared yet), clicking it again (robot cleared, back to the empty state), switching back to Simulate mode and confirming the Python tab's own content survived untouched.
