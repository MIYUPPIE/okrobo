# Decision: Robot Builder — actuator & sensor authoring (D1)

**Date:** 2026-09-09

## Scope

Before this, actuators and sensors existed only inside two hardcoded templates (`robotTemplates.ts`'s Rover and Simple Arm) — a student who started from "Blank" and built their own bodies/joints had no way to ever attach a working actuator or sensor to them, even though Test mode's `ActuatorPanel`/`SensorPanel` (Robot Builder Phases 3/4) are real, MuJoCo-backed physics. This closes that gap: two new toolbar tools, "Add Actuator" and "Add Sensor," plus a new Actuators/Sensors list for viewing, editing, and deleting what's already there.

## `JointCreator.tsx`'s pattern reused almost mechanically

`ActuatorCreator.tsx`/`SensorCreator.tsx` mirror `JointCreator.tsx`'s own draft/live-validate/Apply idiom exactly: a string-typed `Draft` state, a `useMemo` that builds a candidate `RobotDef` from the draft every render and computes `issuesIntroducedBy(validateRobotDef(robot), validateRobotDef(candidate))`, `Apply` disabled while any new issue is error-severity. `nextActuatorId`/`nextSensorId` mirror `nextJointId` exactly (`robotEdits.ts`). Both creators also support **editing** an existing entity (`existing` prop) — `Apply` then replaces it in place via `applyActuator`/`applySensor`'s own `replacingId` parameter, rather than appending a duplicate. This wasn't a stretch goal: this codebase's own CAD Kernel Phase 7.3 already established "click any existing step to edit it" as the expected consistency once a creator form exists at all.

## Actuator picking: a dropdown, not a viewport pick

Every other creator in Build mode (Joint, Fillet/Chamfer, Shell, Draft, the three Cut tools) targets something the student clicks in the 3D view. An actuator's "target" is a joint chosen from a short named list, not a spatial point — so `ActuatorCreator` skips the viewport-picking step entirely: clicking "Add Actuator" goes straight to the form, with a `<select>` over `robot.joints.filter(j => j.type !== "fixed")` (a `fixed` joint never moves; `validateRobotDef` already rejects actuating one, so it's filtered out of the choices rather than offered and rejected). `SensorCreator`, in contrast, DOES need a body pick (every sensor type except `encoder` mounts via body+transform), so it joins `TARGET_PICK_TOOLS` and reuses the exact same single-body-pick flow Fillet/Chamfer/Shell/Draft already established (`handleTargetPick`/`pickTargetId`/`applyTargetEditResult`/`cancelCadTool` — all reused unchanged, zero new picking machinery).

## `encoder` is the one sensor type that doesn't mount via transform

`SensorCreator` visually branches on `type === "encoder"`: the mount-position/rotation fields (meaningful for every other type — a real MJCF `<site>`) hide entirely, replaced by a joint `<select>` (`validateRobotDef`'s own `sensor-encoder-missing-joint` rule already requires this). The joint choices are filtered to ones connected to the already-picked mounting body (`j.parent === bodyId || j.child === bodyId`, excluding `fixed`) — the only ones a student would plausibly mean by "this body's own joint angle." If the picked body has no such joint, the empty select naturally produces `joint: undefined` in the draft, which `validateRobotDef` already flags via the same `sensor-encoder-missing-joint` rule — Apply stays disabled through the existing gate, no special-cased code needed.

## A live warning `validateRobotDef` doesn't cover

An actuator targeting a `ball`/`free` joint is schema-legal and `validateRobotDef` has no rule against it, but `docs/decisions/robot-builder-physics.md` already documented that MJCF has no matching actuator element for those joint types — the control silently does nothing in Test mode. `ActuatorCreator` shows a non-blocking warning banner (Apply stays enabled) when the selected target is `ball`/`free`, since this is real, useful information the validator itself can't provide.

## A new flat list, not an extension of `HierarchyList`

Neither actuators nor sensors have a tree position the way bodies do — they're flat lists keyed by joint/body id, not nodes in the kinematic tree `HierarchyList.tsx` already renders. `ActuatorSensorList.tsx` is a new, separate component rather than an extension, keeping `HierarchyList`'s existing body-only contract untouched. Its row shape mirrors `FeatureTreeList.tsx`'s own "click to edit, separate two-click delete" idiom exactly, reusing its `.feature-tree-row`/`.feature-tree-step`/`.feature-tree-delete` CSS directly — no new classes needed.

## A real user-reported bug this surfaced: disabled toolbar buttons gave no visual feedback

Reported directly after shipping: "actuator button not clicking." Root cause, confirmed in a real browser: `.builder-toolbar button` had no `:disabled` styling at all anywhere in `App.css` — a disabled button (e.g. "Add Actuator" before any non-fixed joint exists, the common case for a fresh "Blank" robot) looked pixel-identical to an enabled one, cursor included, so clicking it appeared to silently do nothing. This wasn't new to this phase — every existing toolbar tool (Add Joint, Extrude, etc.) already had the same gap — but "Add Actuator" is disabled by default for *every* freshly-built robot (a robot needs a joint before it can have an actuator at all), so this phase is what actually exposed it in practice. Fixed with a real `.builder-toolbar button:disabled` rule (dimmed opacity, `cursor: not-allowed`), verified in a real headless-Chrome session: the button now visibly reads as disabled with a fresh no-joint robot, and clicking it after a real hinge joint is added correctly opens the form.

## A real e2e-harness bug this surfaced (not an app bug)

Adding two new always-visible toolbar buttons shifted every subsequent toolbar button's on-screen position. `scripts/lib/studio-e2e-check.mjs`'s Build-mode sequence had several coordinate-based `page.clickText(".builder-toolbar button", ...)`/`page.clickText(".hierarchy-row", ...)` calls that happened to land correctly only because of specific pixel positions that no longer held once the toolbar grew — a latent race (documented in `cdp.mjs`'s own `evalClick` docstring: a coordinate computed then dispatched can miss if the DOM shifts in between) that this change was the first thing to actually expose. Fixed by converting every such call to `evalClickText`/`evalClick` (a real DOM `.click()`, immune to the race) — a systematic hardening pass, not a one-off patch, since the same race could otherwise resurface the next time any toolbar grows.

## Non-goals (D1 specifically)

- No `camera` sensor simulation — shown as a real, selectable type (parses/validates fine) but `SensorPanel.tsx` already has no reading for it; a permanent, previously-documented Phase 4 non-goal, not something this phase changes.
- No spatial (3D-click) picking for an actuator's target joint — a dropdown is the correct UI for "pick one of a short named list," not a gap to fix later.
- Reassigning an existing sensor to a *different* mounting body during an edit isn't supported — the mount is fixed at creation time; moving it means delete and re-add. A reasonable v0 limit, not a bug.

## Verification

`apps/studio`: `npm run test` (838 passing, up from 800 — new `ActuatorCreator.test.tsx`, `SensorCreator.test.tsx`, `ActuatorSensorList.test.tsx`, extended `robotEdits.test.ts`/`BuilderPanel.test.tsx`), `npm run typecheck`, `npm run build`. `./scripts/check-studio-e2e.sh` — a new, fully self-contained "Add Actuator / Add Sensor" section (adds its own fresh bodies and a hinge joint rather than depending on whatever joint types the long CAD-Kernel/Joint-Authoring sequence happened to leave behind) proves the real browser wiring: both toolbar tools, the pick flow, the new list's edit-prefill and two-click-delete — passed twice in a row for stability, alongside the full pre-existing suite (which needed the coordinate-click hardening above to keep passing).
