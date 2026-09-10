# Decision: Robot Builder — joint editing (D3)

**Date:** 2026-09-10

## The bug report, and why the first fix wasn't enough

After D1 shipped, the user reported "actuator button not clicking." The real bug at the time was real: `.builder-toolbar button` had no `:disabled` CSS anywhere in the app, so a disabled "Add Actuator" (the default state for any freshly-built robot, which starts with no joints at all) looked pixel-identical to an enabled one. That was fixed with a real `.builder-toolbar button:disabled` rule (see `robot-builder-actuator-sensor-authoring.md`) and verified in a real browser.

The user then reported it again: "alot still wrong" / "the actuator not working again." Reproducing the *exact*, most natural student flow in a real headless-Chrome session — Add Joint, pick two bodies, click Apply without ever touching the "Joint type" dropdown — showed why: `JointCreator.tsx`'s `initialDraft` defaults `type: "fixed"`. A `fixed` joint can't move, so `validateRobotDef` (correctly) rejects actuating one, and `BuilderPanel.tsx`'s own "Add Actuator" gate (correctly) keeps the button disabled. The student, having visibly added a joint, sees "Add Actuator" stay disabled with no explanation connecting the two — a second, deeper bug wearing the same symptom as the first.

Worse: there was no way to fix it. `HierarchyList.tsx` only ever rendered bodies — joints had no visible row, no click target, nothing. The only path back to a movable joint was deleting the child body (destroying anything else attached to it, including any other joints/actuators/sensors on that subtree) and rebuilding from scratch. For a beginner, that reads as "the tool is broken," not "I need to redo this differently."

## The fix: joints become a first-class editable entity, same as actuators/sensors already are

`robotEdits.ts` gains `applyJoint(robot, joint, replacingId)` / `deleteJoint(robot, id)`, mirroring `applyActuator`/`applySensor`/`deleteActuator`/`deleteSensor` exactly. `JointCreator.tsx` gains an `existing?: Joint` prop, mirroring `ActuatorCreator`/`SensorCreator`'s own edit-mode support: prefilling the draft from the existing joint (type-narrowed per the `Joint` discriminated union — `axis`/`limits`/`damping`/`friction` only apply to some joint types), replacing in place via `applyJoint` instead of appending, and — critically — **not** resetting the child body's transform a second time (that reset happens exactly once, at original creation, to keep the child's rendered pose unchanged; re-doing it on every edit would silently move the body).

`ActuatorSensorList.tsx` (D1's flat Actuators/Sensors list) gains a third section, **Joints**, listed *first* — a student who left one at the default "fixed" type needs to find and fix it here before Add Actuator's own gate will let them past, so it needs to be the first thing they see, not the last. Each row shows `Parent → Child (type)` and reuses the exact same click-to-edit / two-click-delete idiom the Actuators/Sensors rows already use.

## Distinguishing "no joint at all" from "only fixed joints exist"

Both states disable "Add Actuator," but they mean different things and need different next actions:

- **No joint at all** → "Add a hinge, slider, ball, or free joint first." (unchanged from D1)
- **A joint exists, but every one is `fixed`** → "Every joint on this robot is 'fixed' (fixed joints don't move) — edit one to a different type, or add a new hinge/slider/ball/free joint."

`BuilderPanel.tsx` computes `hasAnyJoint`/`hasMovableJoint` separately and branches the button's `title` on both, plus a new always-visible inline hint paragraph in the sidebar (not just a hover tooltip, since a student who doesn't think to hover a disabled button would otherwise never see the explanation at all) that only renders in the "only fixed joints" case. This is the actual content of the second bug report: the *first* fix made "disabled" visually readable; this fix makes "disabled" *actionable* instead of a dead end.

## Verification

A hand-written CDP script (`verify-realistic.mjs`, run via a throwaway dev-server+headless-Chrome harness — not part of the permanent suite) reproduced the user's exact original flow end to end: Blank robot → add a body → Add Joint → pick both → Apply without touching the type dropdown → confirmed "Add Actuator" disabled with the new specific message → clicked the joint row in the new Joints list → edited it to `hinge` → confirmed "Add Actuator" became enabled → opened it → Applied a real actuator → confirmed it appeared in the list. Every step passed.

Permanent coverage: `robotEdits.test.ts` (`applyJoint`/`deleteJoint`, 2 new describe blocks), `JointCreator.test.tsx` (new "editing an existing joint" describe block: prefill + header text, fixed→hinge replace-in-place, transform not reset on edit), `ActuatorSensorList.test.tsx` (rewritten with a `renderList` helper providing no-op defaults for all six callbacks; the pre-existing ambiguous `getByText("Joint 1")` assertions were tightened to `getByRole("button", { name: /^Joint 1/ })` once "Joint 1" started appearing in both a joint's own row and an actuator's target label), `BuilderPanel.test.tsx` (open-for-edit-prefilled, fixed→hinge-and-Apply-replaces-in-place, two-click delete, and the specific "distinguishes no-joint from only-fixed-joints" test asserting both the button's `title` and the new inline hint). `scripts/lib/studio-e2e-check.mjs`'s existing Add Actuator/Add Sensor section now deliberately leaves its fixture joint at the default "fixed" type (instead of immediately setting it to `hinge`) and walks through the full disabled-message → edit-in-list → hinge → enabled → real actuator sequence before continuing — passed twice in a row for stability, alongside the full 860-test suite and a clean `npm run build`.

## Non-goals

- Reassigning an existing joint's parent/child bodies during an edit isn't supported — same v0 limit D1 already accepted for sensor remounting; changing the pair means delete and re-add.
- No change to how a *brand-new* joint's default type is chosen. Defaulting to `fixed` is itself defensible (it's the only type guaranteed to introduce zero new validation issues against any pair of bodies, so a fresh joint always starts valid) — the actual bug was the missing way back out of it, which this phase fixes.
