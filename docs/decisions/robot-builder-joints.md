# Decision: joint authoring in Build mode

**Date:** 2026-09-05

## Choice

Give Build mode a real way to attach a new body to a parent with a joint — the gap every phase since Phase 2 restated as an accepted, deliberate non-goal ("Build mode's UI has no way to author joints or actuators yet"), and one the user hit directly. A new "Add Joint" toolbar tool, alongside Move/Rotate: while active, picking a parent then a child (via either the 3D viewport's raycast click or a `HierarchyList` row -- see below) replaces the inspector with a new `JointCreator` panel, mirroring `BodyInspector.tsx`'s own draft/live-validate/Apply idiom.

## Why the toolbar-tool-then-pick-two-bodies design, not drag-and-drop or a dropdown

Researched against this app's own patterns before designing anything new. `.builder-toolbar`'s existing Move/Rotate buttons are already exactly "a small set of mutually-exclusive tool buttons that change what a viewport click does" -- Add Joint extends that directly, reusing the exact raycasting/`resolveBodyId` machinery `BuilderViewport.tsx`'s `onPointerUp` already has. The two alternatives considered and rejected:

- **Drag-and-drop** (dragging a `HierarchyList` row onto another): zero precedent anywhere in this codebase -- no `dnd-kit`/`react-dnd`, no `draggable` attribute exists at all, confirmed by a repo-wide grep. Building an entire new interaction paradigm from scratch for one feature is disproportionate.
- **A parent dropdown inside `BodyInspector`**: `BodyInspector` is deliberately scoped to one body's own fields (its own doc comment); reasoning about cycle-avoidance is far more legible when the student can see which body is spatially near which in the 3D view than in a flat `<select>` of names.

## `HierarchyList` rows are a second, real input path -- not just a test shortcut

`handleJointPick` (`BuilderPanel.tsx`) is shared verbatim by both the 3D viewport's `jointPick` prop and `HierarchyList`'s `onSelect` (swapped to the same handler while the tool is active). This wasn't in the original plan, which specified 3D-viewport picking only -- added because it's a genuine, additive improvement (a real DOM-button alternative to raycasting, useful on its own merits for anyone who'd rather pick from the tree than hunt for a body in the 3D view) that also happens to solve a real testing problem honestly: `scripts/lib/studio-e2e-check.mjs` cannot compute where a body renders on screen to drive a coordinate-based 3D click, and this repo's own established discipline (see the gizmo-drag note in the same file) is to name that gap plainly rather than fake coverage for it. Wiring a second, already-real input path sidesteps the gap outright instead of leaving it unstated.

## Preserving the child's visual position, not teleporting it

Before a joint exists, both bodies are independent roots whose `transform` is root-relative. A joint's `origin` means something different: the child's pose *in the parent's frame*. Naively defaulting `origin` to identity would make the child jump the instant Apply is clicked -- almost never what the student intended after carefully positioning it with the gizmo. `robotEdits.ts`'s `computeJointOrigin(parent, child)` instead composes real `THREE.Matrix4`s (`origin = inverse(parentWorldMatrix) * childWorldMatrix`, not a naive position subtraction, since either body may already be rotated) so the child's world pose is bit-for-bit unchanged the moment the joint is added; `JointCreator` then resets the child's own `transform` to identity, matching how the shipped templates (`robotTemplates.ts`) already author a jointed child's mount point entirely through the joint's own origin. Verified with a self-checking test, not hand-computed literals that could just as easily encode an arithmetic mistake: `robotEdits.test.ts` asserts the actual invariant (`parent ∘ origin` reconstructs `child`, for unrotated, rotated, and doubly-rotated-and-offset pairs), plus one hand-derived 90°-rotation case cross-checked against it.

## Validation reuses the real rules via a diff, not a reimplementation

`validateRobotDef` already enforces every rule a new joint must satisfy (`joint-duplicate-id`, `joint-unknown-parent-body`/`-child-body`, `joint-self-loop`, `joint-missing-axis`, `joint-invalid-limits`, `joint-invalid-damping-friction`, `joint-duplicate-child`, `robot-cycle`). Rather than re-encoding which of these a UI should pre-check before allowing a pick (hard to communicate mid-pick, and easy to drift from the one true implementation), the flow always lets both picks complete and shows the form; Apply is gated by `issuesIntroducedBy(before, after)` (`robotEdits.ts`) -- any issue present after adding the draft joint that wasn't present before, matched by rule/element_kind/element_id. This sidesteps needing to predict in advance which specific element a rule like `robot-cycle` will attach its error to (`findCycle` can report it on any body in the loop) while still enforcing every rule through its one real implementation.

## Non-goals

- **No joint editing or deletion UI beyond what already existed.** Deleting a body already cascades its joints (`removeBody`, unchanged); there is no "edit an existing joint's axis/limits after creation" surface -- a student who wants to change a joint deletes the child body and re-creates it. A real, smaller gap for a future slice.
- **No multi-select or batch joint creation.** One parent, one child, one joint per Apply.
- **No visual axis/origin gizmo in the 3D view for the draft joint.** `JointCreator`'s numeric fields are the only way to fine-tune the computed origin/axis this slice, matching `BodyInspector`'s own existing numeric-fields-only precedent.
